// Plain-English wording for how long Meta sending stays approved. A "Testing"
// approval lasts one hour and a "Live" one a year; when it ends, sending stops,
// so the panel says when that happens and warns before (live) or after it does.
export type MetaSendingStatus = "disabled" | "test_only" | "live";

export interface MetaReleaseSummary {
  readonly expiresAt: number;
  readonly ended: boolean;
}

export interface MetaReleaseNotice {
  readonly until: string | null;
  readonly warning: string | null;
}

export const META_LIVE_RENEW_WARNING_DAYS = 30;

export function metaReleaseNotice(
  status: MetaSendingStatus,
  release: MetaReleaseSummary | null,
  nowMillis = Date.now(),
): MetaReleaseNotice {
  if (status === "disabled") return { until: null, warning: null };
  if (release === null) {
    return { until: null, warning: "Sending has stopped because the approval ended. Save again to renew." };
  }
  const endsMillis = release.expiresAt * 1_000;
  const when = status === "live"
    ? new Date(endsMillis).toLocaleDateString()
    : new Date(endsMillis).toLocaleString();
  if (release.ended || endsMillis <= nowMillis) {
    return { until: null, warning: `Sending has stopped because the approval ended on ${when}. Save again to renew.` };
  }
  if (status === "test_only") return { until: `Testing until ${when}`, warning: null };
  return {
    until: `Live until ${when}`,
    warning: endsMillis - nowMillis <= META_LIVE_RENEW_WARNING_DAYS * 86_400_000
      ? `Live sending ends on ${when}. Save again to renew.`
      : null,
  };
}
