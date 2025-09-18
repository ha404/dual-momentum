import "dotenv/config";
import yahooFinance from "yahoo-finance2";
import nodemailer from "nodemailer";

// ---- CONFIG ----
const ASSETS = {
  US: "VOO", // US Equities (S&P 500)
  INTL: "VXUS", // International Equities
  BONDS: "BND", // Bonds (safe asset)
} as const;

type Winner = "US" | "INTL";

const LOOKBACK_MONTHS = 12;
const SKIP_LAST_MONTH = true;

// ---- EMAIL CONFIG ----
function requireEnv(name: "EMAIL_FROM" | "EMAIL_TO" | "EMAIL_PASS"): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
const EMAIL_FROM = requireEnv("EMAIL_FROM");
const EMAIL_TO = requireEnv("EMAIL_TO");
const EMAIL_PASS = requireEnv("EMAIL_PASS");

// Annual taxable rebalance window config
const TAXABLE_REBALANCE_MONTH: number = (() => {
  const n = Number.parseInt(process.env.TAXABLE_REBALANCE_MONTH ?? "1", 10);
  return Number.isFinite(n) && n >= 1 && n <= 12 ? n : 1; // default January
})();
const TAXABLE_REBALANCE_WINDOW_DAYS: number = (() => {
  const n = Number.parseInt(process.env.TAXABLE_REBALANCE_WINDOW_DAYS ?? "7", 10);
  return Number.isFinite(n) && n > 0 && n <= 31 ? n : 7; // default 7-day window
})();

function isInTaxableAnnualWindow(d: Date): boolean {
  const month = d.getMonth() + 1; // 1-12
  const day = d.getDate(); // 1-31
  return month === TAXABLE_REBALANCE_MONTH && day <= TAXABLE_REBALANCE_WINDOW_DAYS;
}

// Type guard for numeric closes
function isNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

async function getReturn(ticker: string): Promise<number> {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - (LOOKBACK_MONTHS + 1));

  const history = await yahooFinance.historical(ticker, {
    period1: start,
    period2: end,
    interval: "1mo",
  });

  // Prefer adjClose; fall back to close if needed; filter to numbers
  let closes = history.map((h) => h.adjClose ?? h.close ?? null).filter(isNumber);

  if (SKIP_LAST_MONTH) {
    closes = closes.slice(0, -1); // drop last month
  }

  if (closes.length < 2) {
    throw new Error(`Insufficient price data for ${ticker}`);
  }

  const startPrice = closes[0]!;
  const endPrice = closes[closes.length - 1]!;

  return endPrice / startPrice - 1;
}

async function momentumStrategy(): Promise<string> {
  const usRet = await getReturn(ASSETS.US);
  const intlRet = await getReturn(ASSETS.INTL);

  const winner: Winner = usRet > intlRet ? "US" : "INTL";
  const winnerRet = Math.max(usRet, intlRet);

  if (winnerRet <= 0) {
    return `Move to Bonds (${ASSETS.BONDS}). Both weak.`;
  } else {
    return `Allocate 100% to ${winner} (${ASSETS[winner]}).`;
  }
}

async function sendEmail(
  message: string,
  opts?: { to?: string; subjectPrefix?: string },
): Promise<void> {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: EMAIL_FROM,
      pass: EMAIL_PASS,
    },
  });

  const subject = `${opts?.subjectPrefix ?? ""}Dual Momentum Rebalance - ${new Date()
    .toISOString()
    .slice(0, 10)}`;

  await transporter.sendMail({
    from: EMAIL_FROM,
    to: opts?.to ?? EMAIL_TO,
    subject,
    text: message,
  });
}

(async () => {
  try {
    const rec = await momentumStrategy();
    console.log("Recommendation:", rec);
    await sendEmail(rec);

    // If we're in the annual taxable rebalance window, send an extra signal
    if (isInTaxableAnnualWindow(new Date())) {
      const taxableMsg =
        "Annual taxable account rebalance window is open.\n\n" + `Recommendation: ${rec}`;
      await sendEmail(taxableMsg, { subjectPrefix: "[Taxable Annual] " });
    }
  } catch (err) {
    console.error("Error running strategy:", err);
    process.exit(1);
  }
})();
