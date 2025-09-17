import yahooFinance from "yahoo-finance2";
import nodemailer from "nodemailer";

// ---- CONFIG ----
const ASSETS: Record<string, string> = {
  US: "VOO",      // US Equities (S&P 500)
  INTL: "VXUS",   // International Equities
  BONDS: "BND",   // Bonds (safe asset)
};

const LOOKBACK_MONTHS = 12;
const SKIP_LAST_MONTH = true;

// ---- EMAIL CONFIG ----
const EMAIL_FROM = process.env.EMAIL_FROM || "";
const EMAIL_TO = process.env.EMAIL_TO || "";
const EMAIL_PASS = process.env.EMAIL_PASS || "";

async function getReturn(ticker: string): Promise<number> {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - (LOOKBACK_MONTHS + 1));

  const history = await yahooFinance.historical(ticker, {
    period1: start,
    period2: end,
    interval: "1mo",
  });

  let closes = history.map(h => h.adjClose).filter(Boolean) as number[];

  if (SKIP_LAST_MONTH) {
    closes = closes.slice(0, -1); // drop last month
  }

  const startPrice = closes[0];
  const endPrice = closes[closes.length - 1];

  return (endPrice / startPrice) - 1;
}

async function momentumStrategy(): Promise<string> {
  const usRet = await getReturn(ASSETS.US);
  const intlRet = await getReturn(ASSETS.INTL);

  const winner = usRet > intlRet ? "US" : "INTL";
  const winnerRet = Math.max(usRet, intlRet);

  if (winnerRet <= 0) {
    return `Move to Bonds (${ASSETS.BONDS}). Both weak.`;
  } else {
    return `Allocate 100% to ${winner} (${ASSETS[winner]}).`;
  }
}

async function sendEmail(message: string): Promise<void> {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: EMAIL_FROM,
      pass: EMAIL_PASS,
    },
  });

  const subject = `Dual Momentum Rebalance - ${new Date()
    .toISOString()
    .slice(0, 10)}`;

  await transporter.sendMail({
    from: EMAIL_FROM,
    to: EMAIL_TO,
    subject,
    text: message,
  });
}

(async () => {
  try {
    const rec = await momentumStrategy();
    console.log("Recommendation:", rec);
    await sendEmail(rec);
  } catch (err) {
    console.error("Error running strategy:", err);
    process.exit(1);
  }
})();
