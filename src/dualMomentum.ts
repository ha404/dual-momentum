import "dotenv/config";
import yahooFinance from "yahoo-finance2";
import nodemailer from "nodemailer";
import { pathToFileURL } from "node:url";

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
export function requireEnv(name: "EMAIL_FROM" | "EMAIL_TO" | "EMAIL_PASS"): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
const EMAIL_FROM = requireEnv("EMAIL_FROM");
const EMAIL_TO = requireEnv("EMAIL_TO");
const EMAIL_PASS = requireEnv("EMAIL_PASS");

// Annual taxable rebalance config is computed at call time (supports tests overriding env)
export function getTaxableConfig(): { month: number; windowDays: number } {
  const monthRaw = Number.parseInt(process.env.TAXABLE_REBALANCE_MONTH ?? "1", 10);
  const windowRaw = Number.parseInt(process.env.TAXABLE_REBALANCE_WINDOW_DAYS ?? "7", 10);
  const month = Number.isFinite(monthRaw) && monthRaw >= 1 && monthRaw <= 12 ? monthRaw : 1;
  const windowDays = Number.isFinite(windowRaw) && windowRaw > 0 && windowRaw <= 31 ? windowRaw : 7;
  return { month, windowDays };
}

export function isInTaxableAnnualWindow(d: Date): boolean {
  const { month, windowDays } = getTaxableConfig();
  const currentMonth = d.getMonth() + 1; // 1-12
  const day = d.getDate(); // 1-31
  return currentMonth === month && day <= windowDays;
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

export async function momentumStrategy(): Promise<string> {
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

export async function main(): Promise<void> {
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
}

// Only run when executed directly (not when imported in tests)
const thisFileUrl = import.meta.url;
const invokedUrl = pathToFileURL(process.argv[1] || "").href;
if (thisFileUrl === invokedUrl) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main();
}
