// Phase 5 / T7: small pure-string formatters used by Home + Article
// templates and view-models. These helpers are deliberately
// brand-agnostic — they MUST NOT inject site-specific copy.

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_WORDS = 200;

// Render a published-at timestamp as a short, locale-aware date.
// Accepts ISO-8601 strings, epoch-ms numbers, or Date instances.
// Returns "" when the input is missing or unparseable so callers can
// `${formatDate(...)}` into a template without leaking "Invalid Date".
export function formatDate(
  input: string | number | Date | null | undefined,
  locale: string = "en-US",
): string {
  if (input === null || input === undefined || input === "") return "";
  const d =
    input instanceof Date
      ? input
      : new Date(typeof input === "number" ? input : String(input));
  const t = d.getTime();
  if (Number.isNaN(t)) return "";
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(d);
  } catch {
    // Bad locale tag → fall back to a stable ISO-date slice.
    return d.toISOString().slice(0, 10);
  }
}

// Render an estimated read time from a body word-count or raw text.
// At ~200 wpm, "1 min read" is the floor (no zero-minute reads).
export function formatReadTime(words: number | string | null | undefined): string {
  let count = 0;
  if (typeof words === "number" && Number.isFinite(words)) {
    count = Math.max(0, Math.floor(words));
  } else if (typeof words === "string" && words.length > 0) {
    count = words.trim().split(/\s+/).filter(Boolean).length;
  }
  const minutes = Math.max(1, Math.ceil(count / MINUTE_WORDS));
  return `${minutes} min read`;
}

// Truncate a free-form excerpt to `limit` characters, appending a
// single "…" when truncation actually occurs. Per PART 11 spec for
// the AC: limit=12 yields a string of length ≤13 ending in "…".
export function truncateExcerpt(
  input: string | null | undefined,
  limit: number = 160,
): string {
  if (input === null || input === undefined) return "";
  const safeLimit = Math.max(0, Math.floor(limit));
  const text = String(input);
  if (text.length <= safeLimit) return text;
  return text.slice(0, safeLimit) + "…";
}

// Convenience: a published-at chip needs "Jan 5, 2026" PLUS a relative
// "2 days ago" tag in some templates. Kept here so brand strings stay
// out of the template layer.
export function formatRelativeDays(
  input: string | number | Date | null | undefined,
  now: Date = new Date(),
): string {
  if (input === null || input === undefined || input === "") return "";
  const d =
    input instanceof Date
      ? input
      : new Date(typeof input === "number" ? input : String(input));
  const t = d.getTime();
  if (Number.isNaN(t)) return "";
  const days = Math.floor((now.getTime() - t) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

// Used by build_(article|home)_view_model to derive a stable
// `dateline` string without forcing each view-model to pick a locale.
export function buildDateline(
  publishedAt: string | number | Date | null | undefined,
  readWords: number | string | null | undefined,
  locale: string = "en-US",
): string {
  const date = formatDate(publishedAt, locale);
  const read = formatReadTime(readWords);
  if (date && read) return `${date} · ${read}`;
  return date || read;
}
