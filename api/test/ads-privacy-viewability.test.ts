// rescue-7: programmatic hardening of the GAM client script —
//   #8 lazy-load uses the current setConfig({lazyLoad}) API (enableLazyLoad
//      is deprecated);
//   #6 auto-refresh is viewability-gated (refresh only slots that fired GPT's
//      impressionViewable, re-armed each cycle, under a per-slot cap);
//   #5 each GPT slot div carries data-gpt-type so CSS can reserve its height.
// Asserted against the REAL emitted script/markup (no source grep).
import { describe, it, expect } from "vitest";
import {
  parseAdsConfig,
  renderAdManagerScript,
  renderGamSlot,
} from "../src/public/ads";

const GAM = parseAdsConfig({
  ads_enabled: "1",
  ad_provider: "gam",
  gam_network_code: "22649417900",
  gam_unit_leaderboard: "/22649417900/Home_Leaderboard",
  gam_unit_in_feed: "/22649417900/Home_In-Feed",
  gam_unit_rect: "/22649417900/Home_Rectangle",
  ad_lazy_load: "1",
  ad_refresh_seconds: "30",
  ad_sticky_enabled: "1",
  gam_unit_anchor: "/22649417900/Home_Anchor",
});

describe("ads.ts programmatic hardening (rescue-7)", () => {
  it("#8: uses setConfig({lazyLoad}) and NOT the deprecated enableLazyLoad", () => {
    const s = renderAdManagerScript(GAM);
    expect(s).toContain("setConfig({lazyLoad:{");
    expect(s).toContain("fetchMarginPercent:100");
    expect(s).not.toContain("enableLazyLoad");
  });

  it("#6: refresh is viewability-gated — impressionViewable listener, re-arm, per-slot cap", () => {
    const s = renderAdManagerScript(GAM);
    expect(s).toContain("addEventListener('impressionViewable'");
    expect(s).toContain("d.vw"); // only refresh slots that became viewable
    expect(s).toContain("d.rc<rcap"); // per-slot refresh cap
    expect(s).toContain("d.vw=false"); // re-arm: must be viewed again before next refresh
    // defined entries are initialized with the viewable/refresh-count fields
    expect(s).toContain("vw:false,rc:0");
  });

  it("#6: refresh fully off (no listener, no timer) when ad_refresh_seconds=0", () => {
    const noRefresh = parseAdsConfig({
      ads_enabled: "1",
      ad_provider: "gam",
      gam_network_code: "22649417900",
      gam_unit_leaderboard: "/22649417900/Home_Leaderboard",
      ad_refresh_seconds: "0",
    });
    const s = renderAdManagerScript(noRefresh);
    expect(s).not.toContain("impressionViewable");
    expect(s).not.toContain("setInterval");
  });

  it("#5: GAM slot div carries data-gpt-type for per-breakpoint height reservation", () => {
    expect(renderGamSlot(GAM, "leaderboard")).toContain('data-gpt-type="leaderboard"');
    expect(renderGamSlot(GAM, "in-feed")).toContain('data-gpt-type="in-feed"');
    expect(renderGamSlot(GAM, "rect")).toContain('data-gpt-type="rect"');
  });

  it("regression: lazy-on still omits SRA (singleRequest) — they remain mutually exclusive", () => {
    expect(renderAdManagerScript(GAM)).not.toContain("singleRequest");
  });

  it("regression: CCPA restrictDataProcessing still wired off the restrictAdData arg", () => {
    expect(renderAdManagerScript(GAM, true)).toContain("restrictDataProcessing");
    expect(renderAdManagerScript(GAM, false)).not.toContain("restrictDataProcessing");
  });
});
