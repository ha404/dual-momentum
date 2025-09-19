import "dotenv/config";
import yahooFinance from "yahoo-finance2";
import nodemailer from "nodemailer";
import { pathToFileURL } from "node:url";

// ---- CONFIG ----
const ASSETS = {
  US: "VOO", // US Equities (S&P 500)
  INTL: "VXUS", // International Equities
  BONDS: "BND", // Defensive (intermediate bonds)
} as const;

// Risk-free proxy for absolute momentum (T-Bills ETF)
const RISK_FREE_SYMBOL = "BIL"; // Change to SHV, SGOV etc. if desired

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

export interface MomentumResult {
  usReturn: number;
  intlReturn: number;
  riskFreeReturn: number;
  winner: Winner | null; // null if absolute momentum fails
  recommendation: string;
  absoluteFilterPassed: boolean;
}
// NOTE: Explanatory comments are embedded directly in the code below instead of
// generating a beginner help section at runtime (per user preference).

function toPercent(v: number, digits = 2): string {
  return (v * 100).toFixed(digits) + "%";
}

export async function momentumStrategy(): Promise<MomentumResult> {
  const [usReturn, intlReturn, riskFreeReturn] = await Promise.all([
    getReturn(ASSETS.US),
    getReturn(ASSETS.INTL),
    getReturn(RISK_FREE_SYMBOL),
  ]);

  // Relative momentum (winner among equities)
  const winner: Winner = usReturn > intlReturn ? "US" : "INTL";
  const winnerRet = Math.max(usReturn, intlReturn);

  // Absolute momentum (winner must beat risk-free)
  const absoluteFilterPassed = winnerRet > riskFreeReturn;

  let recommendation: string;
  let effectiveWinner: Winner | null = winner;
  if (!absoluteFilterPassed) {
    recommendation =
      `Move to Bonds (${ASSETS.BONDS}). Absolute momentum failed: ` +
      `${winner} 12m ${toPercent(winnerRet)} <= Risk-free (${toPercent(riskFreeReturn)}).`;
    effectiveWinner = null;
  } else {
    recommendation = `Allocate 100% to ${winner} (${ASSETS[winner]}). (Beats risk-free ${toPercent(riskFreeReturn)})`;
  }

  return {
    usReturn,
    intlReturn,
    riskFreeReturn,
    winner: effectiveWinner,
    recommendation,
    absoluteFilterPassed,
  };
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
    const result = await momentumStrategy();

    // These are the core outputs used for logging & emailing.
    // Returns are 12‑month total returns (skipping the current partial month) for:
    //   - US equities (VOO)
    //   - International equities (VXUS)
    //   - Risk‑free proxy (BIL) used for the Absolute Momentum filter.
    // We log which equity wins on a relative basis (higher return) *and* whether
    // that winning return beats the risk‑free return. If it does not, we move to bonds.
    const logLines = [
      `US (${ASSETS.US}) 12m: ${toPercent(result.usReturn)}`,
      `INTL (${ASSETS.INTL}) 12m: ${toPercent(result.intlReturn)}`,
      `Risk-free (${RISK_FREE_SYMBOL}) 12m: ${toPercent(result.riskFreeReturn)}`,
      `Absolute filter: ${result.absoluteFilterPassed ? "PASSED" : "FAILED"}`,
      `Recommendation: ${result.recommendation}`,
    ];
    console.log(logLines.join("\n"));

    // Email contains concise summary only.
    const baseEmailBody = `${logLines[0]}\n${logLines[1]}\n${logLines[2]}\n${logLines[3]}\n\n${result.recommendation}`;
    await sendEmail(baseEmailBody);

    // If we're in the annual taxable rebalance window, send an extra signal
    if (isInTaxableAnnualWindow(new Date())) {
      // Extra annual reminder during the configured taxable window.
      const taxableMsg =
        "Annual taxable account rebalance window is open.\n\n" +
        `US (${ASSETS.US}) 12m: ${toPercent(result.usReturn)}\n` +
        `INTL (${ASSETS.INTL}) 12m: ${toPercent(result.intlReturn)}\n` +
        `Risk-free (${RISK_FREE_SYMBOL}) 12m: ${toPercent(result.riskFreeReturn)}\n` +
        `Absolute filter: ${result.absoluteFilterPassed ? "PASSED" : "FAILED"}\n\n` +
        result.recommendation;
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
