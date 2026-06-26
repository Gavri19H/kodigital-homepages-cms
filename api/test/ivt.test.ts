// rescue-6 (agent-readiness, IVT defense): the free open-source IVT layers.
// Layer 1 = server-side datacenter-ASN + declared-bot-UA signals feeding the
// bot gate (cloaking-safe: verified search engines are never suppressed).
// Layer 2 = the engagement-gated ad loader (no fill until a human signal).
import { describe, it, expect } from "vitest";
import { isDatacenterAsn, isDeclaredBotUA } from "../src/safety/ivt";
import { botFromCfSignals } from "../src/public/router";

describe("IVT Layer 1: datacenter ASN + declared-bot UA", () => {
  it("flags known datacenter/hosting ASNs, not eyeball ASNs", () => {
    expect(isDatacenterAsn(16509)).toBe(true); // AWS
    expect(isDatacenterAsn(14061)).toBe(true); // DigitalOcean
    expect(isDatacenterAsn(7922)).toBe(false); // Comcast (eyeball)
    expect(isDatacenterAsn(undefined)).toBe(false);
  });
  it("flags self-declaring bots + non-browser clients, not real browsers", () => {
    expect(isDeclaredBotUA("curl/8.4.0")).toBe(true);
    expect(isDeclaredBotUA("Mozilla/5.0 (compatible; SemrushBot/7~bl)")).toBe(true);
    expect(
      isDeclaredBotUA("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36"),
    ).toBe(false);
    expect(isDeclaredBotUA(undefined)).toBe(false);
  });
});

describe("botFromCfSignals with IVT signals", () => {
  it("suppresses ads for datacenter ASN / bot UA when NOT a verified bot", () => {
    expect(botFromCfSignals({ asn: 16509 })).toBe(true);
    expect(botFromCfSignals({}, "curl/8.4.0")).toBe(true);
    expect(
      botFromCfSignals(
        { asn: 7922 },
        "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36",
      ),
    ).toBe(false);
  });
  it("never suppresses a verified search engine, even from a datacenter ASN", () => {
    expect(
      botFromCfSignals(
        { verifiedBot: true, verifiedBotCategory: "Search Engine Crawler", asn: 16509 },
        "Googlebot/2.1",
      ),
    ).toBe(false);
  });
});
