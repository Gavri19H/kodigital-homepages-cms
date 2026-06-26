// rescue-6 (agent-readiness M4 / CCPA wiring): when a visitor has opted out of
// "sale/sharing", the ad manager script must restrict data processing — GAM via
// setPrivacySettings({restrictDataProcessing}) and AdSense via
// requestNonPersonalizedAds. The router passes restrictAdData for opted-out
// requests; here we assert the script emission directly.
import { describe, it, expect } from "vitest";
import { parseAdsConfig, renderAdManagerScript } from "../src/public/ads";

const GAM = parseAdsConfig({
  ads_enabled: "1",
  ad_provider: "gam",
  gam_network_code: "23456789",
  gam_unit_leaderboard: "home_leaderboard",
});

const ADSENSE = parseAdsConfig({
  ads_enabled: "1",
  ad_provider: "adsense",
  adsense_publisher_id: "ca-pub-1234567890123456",
});

describe("CCPA ad-data restriction (agent-readiness M4)", () => {
  it("GAM: opted-out emits Restrict Data Processing; default does not", () => {
    expect(renderAdManagerScript(GAM, true)).toContain("restrictDataProcessing");
    expect(renderAdManagerScript(GAM, false)).not.toContain("restrictDataProcessing");
    // default (no second arg) is personalized
    expect(renderAdManagerScript(GAM)).not.toContain("restrictDataProcessing");
  });

  it("AdSense: opted-out requests non-personalized ads; default does not", () => {
    expect(renderAdManagerScript(ADSENSE, true)).toContain("requestNonPersonalizedAds");
    expect(renderAdManagerScript(ADSENSE, false)).not.toContain("requestNonPersonalizedAds");
    expect(renderAdManagerScript(ADSENSE)).not.toContain("requestNonPersonalizedAds");
  });
});
