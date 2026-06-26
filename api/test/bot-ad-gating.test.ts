// rescue-6 (agent-readiness M3 / ad IVT defense): botFromCfSignals decides
// whether a request is automated, from Cloudflare's request.cf signals. The
// router uses it to suppress ad tags (and bypass the human HTML cache) for
// bots. Cloaking-safe: verified SEARCH engines are NOT treated as bots.
import { describe, it, expect } from "vitest";
import { botFromCfSignals } from "../src/public/router";

describe("botFromCfSignals (agent-readiness M3 / ad IVT defense)", () => {
  it("treats a missing/empty cf (unit tests, local) as human", () => {
    expect(botFromCfSignals(undefined)).toBe(false);
    expect(botFromCfSignals({})).toBe(false);
  });

  it("does NOT suppress ads for verified SEARCH engines (cloaking-safe)", () => {
    expect(
      botFromCfSignals({
        verifiedBot: true,
        verifiedBotCategory: "Search Engine Crawler",
      }),
    ).toBe(false);
  });

  it("suppresses ads for verified AI crawlers", () => {
    expect(
      botFromCfSignals({ verifiedBot: true, verifiedBotCategory: "AI Crawler" }),
    ).toBe(true);
  });

  it("a verified bot with no category carries no AI signal -> not suppressed", () => {
    expect(botFromCfSignals({ verifiedBot: true })).toBe(false);
  });

  it("suppresses unverified low-score automation; humans + unavailable score pass", () => {
    expect(botFromCfSignals({ botManagement: { score: 5 } })).toBe(true);
    expect(botFromCfSignals({ botManagement: { score: 29 } })).toBe(true);
    expect(botFromCfSignals({ botManagement: { score: 30 } })).toBe(false);
    expect(botFromCfSignals({ botManagement: { score: 85 } })).toBe(false);
    expect(botFromCfSignals({ botManagement: { score: 0 } })).toBe(false);
  });
});
