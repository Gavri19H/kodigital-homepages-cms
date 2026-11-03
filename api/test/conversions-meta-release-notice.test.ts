import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { metaReleaseNotice } from "../src/admin/conversions/app/meta-release-notice";

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const DAY = 86_400_000;
const at = (millis: number) => Math.floor(millis / 1_000);

describe("Meta sending approval notice", () => {
  it("says how long Testing lasts, and warns once it has ended", () => {
    const ends = NOW + 30 * 60_000;
    expect(metaReleaseNotice("test_only", { expiresAt: at(ends), ended: false }, NOW)).toEqual({
      until: `Testing until ${new Date(ends).toLocaleString()}`, warning: null,
    });
    expect(metaReleaseNotice("test_only", { expiresAt: at(ends), ended: false }, ends + 1)).toEqual({
      until: null,
      warning: `Sending has stopped because the approval ended on ${new Date(ends).toLocaleString()}. Save again to renew.`,
    });
  });

  it("says how long Live lasts, warns within 30 days and after it has ended", () => {
    const far = NOW + 200 * DAY;
    expect(metaReleaseNotice("live", { expiresAt: at(far), ended: false }, NOW)).toEqual({
      until: `Live until ${new Date(far).toLocaleDateString()}`, warning: null,
    });
    const soon = NOW + 30 * DAY;
    const date = new Date(soon).toLocaleDateString();
    expect(metaReleaseNotice("live", { expiresAt: at(soon), ended: false }, NOW)).toEqual({
      until: `Live until ${date}`, warning: `Live sending ends on ${date}. Save again to renew.`,
    });
    expect(metaReleaseNotice("live", { expiresAt: at(soon), ended: true }, NOW)).toEqual({
      until: null, warning: `Sending has stopped because the approval ended on ${date}. Save again to renew.`,
    });
  });

  it("warns when sending is on but there is no approval, and says nothing when sending is off", () => {
    expect(metaReleaseNotice("live", null, NOW).warning).toBe(
      "Sending has stopped because the approval ended. Save again to renew.",
    );
    expect(metaReleaseNotice("disabled", null, NOW)).toEqual({ until: null, warning: null });
  });

  it("is shown in the Meta panel inside the existing warning box", () => {
    const source = readFileSync(new URL("../src/admin/conversions/app/connections.tsx", import.meta.url), "utf8");
    expect(source).toContain("metaReleaseNotice(view.status, view.release)");
    expect(source).toContain('class="ko-conversions-state ko-conversions-state--warning" role="alert"><p>{notice.warning}</p>');
  });
});
