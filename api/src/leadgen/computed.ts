// LeadGen computed variable registry (fix-contract v2.4 04 §4.4 — R3/B8).
//
// THE registry is the ONLY source of computed keys: payload.ts save-time
// validation rejects any `source:"computed"` key outside this table
// (`computed_unknown_key`), and the runtime context builder
// (runtime-context.ts) populates `ctx.computed` exclusively from these
// resolvers. The Phase-2 admin dropdown renders each entry as
// `label — description (example)` — free-text computed keys are gone.
//
// Resolvers are PURE over the LeadgenComputedInput: `now` is the ms-epoch
// captured ONCE per context build (so every computed field of one payload
// agrees on the instant), `timezone` is the visitor timezone from
// `request.cf` (cloudflare.timezone), "" when the edge did not supply one.
// The `*_est` pair formats in `America/New_York` via Intl, which applies
// EST/EDT (daylight-saving) automatically.

import { hourInTimezone } from "../analytics/listicle-quality";

export type LeadgenComputedOutputType = "string" | "number";

// The resolver input (04 §4.2 "COMPUTED_REGISTRY resolvers over
// (now, cloudflare.timezone)").
export interface LeadgenComputedInput {
  // ms epoch, captured once per context build.
  now: number;
  // Visitor IANA timezone (cloudflare.timezone), "" when absent.
  timezone: string;
}

export interface LeadgenComputedVar {
  key: string;
  label: string;
  description: string;
  outputType: LeadgenComputedOutputType;
  example: string;
  resolver: (ctx: LeadgenComputedInput) => string | number;
}

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

// Lowercase English weekday in an IANA timezone. Mirrors hourInTimezone's
// documented fail-safe: an invalid/absent tz falls back to UTC.
function dayOfWeekInTimezone(tz: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz === "" ? "UTC" : tz,
      weekday: "long",
    })
      .format(at)
      .toLowerCase();
  } catch {
    return DAY_NAMES[at.getUTCDay()] ?? "";
  }
}

const EASTERN_TZ = "America/New_York";

// Shared resolver bodies for the contract's alias rows (unix_timestamp is an
// alias of request_timestamp; current_date_utc of today_date_utc) — aliases
// can never drift because they ARE the same function.
const resolveRequestTimestamp = (ctx: LeadgenComputedInput): number => Math.floor(ctx.now / 1000);
const resolveTodayDateUtc = (ctx: LeadgenComputedInput): string =>
  new Date(ctx.now).toISOString().slice(0, 10);

// The 12 computed variables — EXACTLY the 04 §4.4 table.
const COMPUTED_VARS: readonly LeadgenComputedVar[] = [
  {
    key: "request_timestamp",
    label: "Request timestamp (s)",
    description: "Unix epoch seconds at request time",
    outputType: "number",
    example: "1783468800",
    resolver: resolveRequestTimestamp,
  },
  {
    key: "request_timestamp_ms",
    label: "Request timestamp (ms)",
    description: "Unix epoch milliseconds at request time",
    outputType: "number",
    example: "1783468800123",
    resolver: (ctx) => ctx.now,
  },
  {
    key: "unix_timestamp",
    label: "Unix timestamp",
    description: "Alias of request_timestamp (epoch seconds)",
    outputType: "number",
    example: "1783468800",
    resolver: resolveRequestTimestamp,
  },
  {
    key: "iso_timestamp",
    label: "ISO-8601 timestamp",
    description: "Request time as an ISO-8601 UTC string",
    outputType: "string",
    example: "2026-07-08T14:00:00.000Z",
    resolver: (ctx) => new Date(ctx.now).toISOString(),
  },
  {
    key: "today_date_utc",
    label: "Today’s date (UTC)",
    description: "Request date in UTC (YYYY-MM-DD)",
    outputType: "string",
    example: "2026-07-08",
    resolver: resolveTodayDateUtc,
  },
  {
    key: "current_date_utc",
    label: "Current date (UTC)",
    description: "Alias of today_date_utc (YYYY-MM-DD)",
    outputType: "string",
    example: "2026-07-08",
    resolver: resolveTodayDateUtc,
  },
  {
    key: "current_datetime_utc",
    label: "Current datetime (UTC)",
    description: "Request datetime in UTC (YYYY-MM-DD HH:mm:ss)",
    outputType: "string",
    example: "2026-07-08 14:00:00",
    resolver: (ctx) => new Date(ctx.now).toISOString().slice(0, 19).replace("T", " "),
  },
  {
    key: "current_hour_utc",
    label: "Current hour (UTC)",
    description: "Hour of day in UTC (0–23)",
    outputType: "number",
    example: "14",
    resolver: (ctx) => new Date(ctx.now).getUTCHours(),
  },
  {
    key: "current_hour_est",
    label: "Current hour (EST)",
    description: "Hour of day in America/New_York, DST-aware (0–23)",
    outputType: "number",
    example: "9",
    resolver: (ctx) => hourInTimezone(EASTERN_TZ, new Date(ctx.now)),
  },
  {
    key: "current_day_of_week_utc",
    label: "Day of week (UTC)",
    description: "Lowercase English weekday in UTC",
    outputType: "string",
    example: "wednesday",
    resolver: (ctx) => DAY_NAMES[new Date(ctx.now).getUTCDay()] ?? "",
  },
  {
    key: "current_day_of_week_est",
    label: "Day of week (EST)",
    description: "Lowercase English weekday in America/New_York, DST-aware",
    outputType: "string",
    example: "wednesday",
    resolver: (ctx) => dayOfWeekInTimezone(EASTERN_TZ, new Date(ctx.now)),
  },
  {
    key: "timezone",
    label: "Visitor timezone",
    description: "Visitor IANA timezone from the Cloudflare edge, empty when unknown",
    outputType: "string",
    example: "Europe/Berlin",
    resolver: (ctx) => ctx.timezone,
  },
] as const;

export const COMPUTED_REGISTRY: Readonly<Record<string, LeadgenComputedVar>> = Object.fromEntries(
  COMPUTED_VARS.map((v) => [v.key, v]),
);

// Registry key list in table order (validation messages + the Phase-2
// grouped dropdown).
export const LEADGEN_COMPUTED_KEYS: readonly string[] = COMPUTED_VARS.map((v) => v.key);

const COMPUTED_KEY_SET: ReadonlySet<string> = new Set(LEADGEN_COMPUTED_KEYS);

// Set-backed guard (never `key in COMPUTED_REGISTRY` — prototype-chain names
// like "constructor" must not read as registry hits).
export function isLeadgenComputedKey(key: string): boolean {
  return COMPUTED_KEY_SET.has(key);
}

// Resolve EVERY registry key over one input — the eager-all-12 population
// the context builder uses (see runtime-context.ts for the eager-vs-lazy
// note). Pure: same input ⇒ same output.
export function resolveAllComputed(input: LeadgenComputedInput): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const v of COMPUTED_VARS) {
    out[v.key] = v.resolver(input);
  }
  return out;
}
