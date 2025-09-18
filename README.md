# Dual Momentum Notifier

A small TypeScript/Node project that runs a simple Dual Momentum strategy using Yahoo Finance data and emails you the current allocation recommendation. It can also send an extra annual reminder for rebalancing a taxable account during a configurable window.

## What it does

- Fetches monthly prices for two equity assets (US and International) over a 12‑month lookback (skipping the most recent incomplete month) and compares their returns.
- If the winner’s return is positive, it recommends allocating 100% to the winner; otherwise, it recommends moving to bonds.
- Sends the recommendation to your email via Gmail (Nodemailer).
- Optionally, during a configurable “annual window” (first N days of a chosen month), it sends a second email reminding you to rebalance a taxable account.

## Tech

- TypeScript + ts-node (ESM)
- yahoo-finance2
- nodemailer
- dotenv (local env only; CI/host env vars take precedence)
- Vitest (tests)
- Prettier (formatting)

## Prerequisites

- Node.js 18+ recommended (ESM loader, fetch, etc.)
- A Gmail account with an App Password for SMTP
  - Google Account → Security → 2‑Step Verification → App passwords
  - Generate a 16‑character app password (Google may show it with spaces; store it without spaces in `.env`)

## Setup

1. Install dependencies

  ```zsh
  npm install
  ```

1. Create `.env` from the example and fill in values

  ```zsh
  cp .env.example .env
  ```

  Required:

- `EMAIL_FROM` — your Gmail address (the sender)
- `EMAIL_PASS` — your Gmail App Password (no spaces)
- `EMAIL_TO` — where to send the email

  Optional (annual taxable window):

- `TAXABLE_REBALANCE_MONTH` — month number 1–12 (default 1 = January)
- `TAXABLE_REBALANCE_WINDOW_DAYS` — first N days of that month to trigger the extra reminder (default 7)

## Run

- Development (ts-node + dotenv):

  ```zsh
  npm start
  ```

- Build and run compiled JS:

  ```zsh
  npm run build
  node dist/dualMomentum.js
  ```

## Tests

- Run once:

  ```zsh
  npm run test
  ```

- Watch mode:

  ```zsh
  npm run test:watch
  ```

## Formatting

- Format all files with Prettier:

  ```zsh
  npm run format
  ```

- Check formatting (useful in CI):

  ```zsh
  npm run format:check
  ```

## Configuration details

- Strategy assets (hard‑coded in `src/dualMomentum.ts`):
  - US: VOO
  - INTL: VXUS
  - Bonds: BND
- Lookback: 12 months (skipping the most recent month if `SKIP_LAST_MONTH` is true)
- Annual taxable rebalance window:
  - If today is within the first `TAXABLE_REBALANCE_WINDOW_DAYS` days of `TAXABLE_REBALANCE_MONTH`, an extra email with subject prefix `[Taxable Annual]` is sent.
  - If you prefer “only on the 1st,” set `TAXABLE_REBALANCE_WINDOW_DAYS=1`.

## Environment variables

- Local development loads from `.env` via `import "dotenv/config";`.
- In production/CI (e.g., GitHub Actions), set environment variables/secrets. Those take precedence—no `.env` is needed or used there.
- If your password truly contains spaces, quote it in `.env` like `EMAIL_PASS="my password"`. For Gmail App Passwords specifically, paste it without spaces.

## Scheduling (optional)

- Cron example (run daily at 6am):

  ```cron
  0 6 * * * /usr/bin/env -S bash -lc 'cd /path/to/dual-momentum && npm start >> run.log 2>&1'
  ```

- GitHub Actions: configure a workflow to run on a schedule and set `EMAIL_FROM`, `EMAIL_PASS`, `EMAIL_TO` as repository or environment secrets.

## Notes & Troubleshooting

- If TypeScript can’t find inputs (TS18003), ensure your sources live in `src/` and that `tsconfig.json` includes `src/**/*.ts`.
- If Nodemailer auth fails with Gmail, verify you’re using an App Password (not your normal password) and that 2FA is enabled.
- If Yahoo price history has too few points (e.g., brand new fund), the script throws an error to avoid bogus signals.

## License

This project is for educational purposes. No warranty. Consult your own advisor before making investment decisions.
