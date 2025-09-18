import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { isInTaxableAnnualWindow, requireEnv } from "./dualMomentum";

describe("isInTaxableAnnualWindow", () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    process.env = { ...OLD };
    process.env.TAXABLE_REBALANCE_MONTH = "9"; // September
    process.env.TAXABLE_REBALANCE_WINDOW_DAYS = "3"; // first 3 days
    // re-import module logic won't re-run for constants here, we test function behavior only
  });
  afterEach(() => {
    process.env = OLD;
  });

  it("returns true inside the window", () => {
    const d = new Date(2025, 8, 2); // 2025-09-02 (month 8 is Sep)
    expect(isInTaxableAnnualWindow(d)).toBe(true);
  });

  it("returns false outside the window days", () => {
    const d = new Date(2025, 8, 10); // Sep 10
    expect(isInTaxableAnnualWindow(d)).toBe(false);
  });

  it("returns false in a different month", () => {
    const d = new Date(2025, 0, 2); // Jan 2
    expect(isInTaxableAnnualWindow(d)).toBe(false);
  });
});

describe("requireEnv", () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    process.env = { ...OLD };
  });
  afterEach(() => {
    process.env = OLD;
  });

  it("returns the value when set", () => {
    process.env.EMAIL_FROM = "test@example.com";
    expect(requireEnv("EMAIL_FROM")).toBe("test@example.com");
  });

  it("throws when missing", () => {
    delete process.env.EMAIL_PASS;
    expect(() => requireEnv("EMAIL_PASS")).toThrow(/Missing required env var/);
  });
});
