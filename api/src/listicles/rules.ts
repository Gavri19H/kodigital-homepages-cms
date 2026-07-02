// Rule-based page targeting: typed conditions model, evaluation, and the
// §15.5 conflict guard (design contract §15.4 / §15.5 / §23).
//
// Conditions are TYPED — set-membership dims and numeric time ranges are kept
// separate so evaluation and overlap detection treat each correctly:
//
//   { "sets":   { "country": ["US"], "device": ["mobile"], ... },
//     "ranges": { "hour": [6, 12] }  or  { "daypart": [[6, 12], [18, 22]] } }
//
// Evaluation order: priority ASC (lower = evaluated first), first match wins;
// a required fallback candidate (is_fallback, no rule row) catches the rest.

export const SET_DIMENSIONS = [
  "country",
  "state",
  "city",
  "device",
  "os",
  "browser",
  "traffic_source",
  "placement",
  "utm_source",
  "utm_medium",
  "utm_content",
  "language",
  "sub1",
  "sub2",
  "sub3",
  "sub4",
  "sub5",
] as const;

export type SetDimension = (typeof SET_DIMENSIONS)[number];

// Half-open hour-of-day interval [start, end): 0 <= start < end <= 24.
// Half-open is what makes "06:00–12:00 vs 12:00–18:00" NOT overlap while
// "06:00–12:00 vs 10:00–18:00" overlaps at exactly 10:00–12:00 (§15.5).
export type HourInterval = [number, number];

export interface RuleConditions {
  sets?: Partial<Record<SetDimension, string[]>>;
  // `hour` is a single interval; `daypart` is a list of intervals. Both
  // constrain the same time-of-day axis (§15.4 groups them as the range
  // dims), so evaluation/overlap normalizes hour+daypart into one interval
  // list per rule.
  ranges?: { hour?: HourInterval; daypart?: HourInterval[] };
}

// The evaluation context the client/edge supplies (window.__LST_CTX + ko_ctx
// cookie dims). Set dims are strings; `hour` is the local hour 0-23.
export type RuleContext = Partial<Record<SetDimension, string>> & {
  hour?: number;
};

const SET_DIMENSION_SET: ReadonlySet<string> = new Set(SET_DIMENSIONS);

// ---------------------------------------------------------------------------
// Parsing / shape validation
// ---------------------------------------------------------------------------

export type ParsedConditions =
  | { ok: true; conditions: RuleConditions }
  | { ok: false; error: string };

function parseInterval(raw: unknown, label: string): HourInterval | string {
  if (!Array.isArray(raw) || raw.length !== 2) {
    return `${label} must be a [start, end] pair`;
  }
  const start = raw[0];
  const end = raw[1];
  if (typeof start !== "number" || typeof end !== "number") {
    return `${label} bounds must be numbers`;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return `${label} bounds must be finite`;
  }
  if (start < 0 || end > 24 || start >= end) {
    return `${label} must satisfy 0 <= start < end <= 24`;
  }
  return [start, end];
}

// Parse an untrusted conditions payload (request body or stored
// conditions_json) into the typed model. Unknown set dims and malformed
// ranges are rejected — a rule that cannot be evaluated must not be saved.
export function parseConditions(raw: unknown): ParsedConditions {
  if (raw === null || raw === undefined) {
    return { ok: true, conditions: {} };
  }
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return { ok: false, error: "conditions_json is not valid JSON" };
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "conditions must be an object" };
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key !== "sets" && key !== "ranges") {
      return { ok: false, error: `unknown conditions key '${key}' (expected sets/ranges)` };
    }
  }

  const conditions: RuleConditions = {};

  if (obj.sets !== undefined) {
    if (typeof obj.sets !== "object" || obj.sets === null || Array.isArray(obj.sets)) {
      return { ok: false, error: "conditions.sets must be an object" };
    }
    const sets: Partial<Record<SetDimension, string[]>> = {};
    for (const [dim, rawValues] of Object.entries(obj.sets as Record<string, unknown>)) {
      if (!SET_DIMENSION_SET.has(dim)) {
        return { ok: false, error: `unknown set dimension '${dim}'` };
      }
      if (!Array.isArray(rawValues) || rawValues.length === 0) {
        return { ok: false, error: `sets.${dim} must be a non-empty array` };
      }
      const values: string[] = [];
      for (const v of rawValues) {
        if (typeof v !== "string" || v.trim() === "") {
          return { ok: false, error: `sets.${dim} values must be non-empty strings` };
        }
        values.push(v);
      }
      sets[dim as SetDimension] = values;
    }
    if (Object.keys(sets).length > 0) conditions.sets = sets;
  }

  if (obj.ranges !== undefined) {
    if (typeof obj.ranges !== "object" || obj.ranges === null || Array.isArray(obj.ranges)) {
      return { ok: false, error: "conditions.ranges must be an object" };
    }
    const rangesRaw = obj.ranges as Record<string, unknown>;
    for (const key of Object.keys(rangesRaw)) {
      if (key !== "hour" && key !== "daypart") {
        return { ok: false, error: `unknown range dimension '${key}' (expected hour/daypart)` };
      }
    }
    const ranges: { hour?: HourInterval; daypart?: HourInterval[] } = {};
    if (rangesRaw.hour !== undefined) {
      const parsed = parseInterval(rangesRaw.hour, "ranges.hour");
      if (typeof parsed === "string") return { ok: false, error: parsed };
      ranges.hour = parsed;
    }
    if (rangesRaw.daypart !== undefined) {
      if (!Array.isArray(rangesRaw.daypart) || rangesRaw.daypart.length === 0) {
        return { ok: false, error: "ranges.daypart must be a non-empty array of [start, end] pairs" };
      }
      const intervals: HourInterval[] = [];
      for (const rawInterval of rangesRaw.daypart) {
        const parsed = parseInterval(rawInterval, "ranges.daypart[]");
        if (typeof parsed === "string") return { ok: false, error: parsed };
        intervals.push(parsed);
      }
      ranges.daypart = intervals;
    }
    if (ranges.hour !== undefined || ranges.daypart !== undefined) {
      conditions.ranges = ranges;
    }
  }

  return { ok: true, conditions };
}

// ---------------------------------------------------------------------------
// Evaluation — priority asc, first match wins
// ---------------------------------------------------------------------------

// A rule's time-of-day constraint as a normalized interval list (hour and
// daypart share the axis). undefined == no time constraint ("any hour").
function timeIntervals(conditions: RuleConditions): HourInterval[] | undefined {
  const ranges = conditions.ranges;
  if (ranges === undefined) return undefined;
  const intervals: HourInterval[] = [];
  if (ranges.hour !== undefined) intervals.push(ranges.hour);
  if (ranges.daypart !== undefined) intervals.push(...ranges.daypart);
  return intervals.length > 0 ? intervals : undefined;
}

// Case-insensitive set-membership: geo/device/browser values arrive with
// inconsistent casing from CF request context vs. hand-authored rules.
function setContains(values: string[], ctxValue: string): boolean {
  const needle = ctxValue.toLowerCase();
  return values.some((v) => v.toLowerCase() === needle);
}

// A missing dimension = "any" (matches everything) — §15.5.
export function matchesConditions(conditions: RuleConditions, ctx: RuleContext): boolean {
  if (conditions.sets !== undefined) {
    for (const [dim, values] of Object.entries(conditions.sets)) {
      if (values === undefined) continue;
      const ctxValue = ctx[dim as SetDimension];
      if (typeof ctxValue !== "string" || !setContains(values, ctxValue)) {
        return false;
      }
    }
  }
  const intervals = timeIntervals(conditions);
  if (intervals !== undefined) {
    const hour = ctx.hour;
    if (typeof hour !== "number" || !Number.isFinite(hour)) return false;
    const inAny = intervals.some(([start, end]) => hour >= start && hour < end);
    if (!inAny) return false;
  }
  return true;
}

export interface EvaluableRule {
  priority: number;
  conditions: RuleConditions;
}

// First match wins over rules ordered by priority ASC. Ties keep the caller's
// array order (stable sort) — but equal-priority overlaps are BLOCKED at save
// time by the conflict guard, so a tie can only involve non-overlapping rules.
export function evaluateRules<T extends EvaluableRule>(rules: T[], ctx: RuleContext): T | null {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  for (const rule of ordered) {
    if (matchesConditions(rule.conditions, ctx)) return rule;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Overlap detection (§15.5 conflict guard)
// ---------------------------------------------------------------------------

// Interval intersection on the half-open [start, end) axis:
// 06:00–12:00 × 10:00–18:00 ⇒ 10:00–12:00; touching intervals (e.g.
// 06–10 × 10–18) do NOT overlap. Returns null when the intersection is empty.
export function intersectIntervals(a: HourInterval, b: HourInterval): HourInterval | null {
  const start = Math.max(a[0], b[0]);
  const end = Math.min(a[1], b[1]);
  return start < end ? [start, end] : null;
}

function formatHour(value: number): string {
  const whole = Math.floor(value);
  const minutes = Math.round((value - whole) * 60);
  const hh = String(whole).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function formatInterval(interval: HourInterval): string {
  return `${formatHour(interval[0])}-${formatHour(interval[1])}`;
}

function intersectValues(a: string[], b: string[]): string[] {
  const bLower = new Set(b.map((v) => v.toLowerCase()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of a) {
    const key = v.toLowerCase();
    if (bLower.has(key) && !seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

// Compute the audience overlap of two rules, per dimension:
//   * set dims by value-set intersection,
//   * the time axis (hour/daypart) by interval intersection,
//   * a missing dimension = "any" (overlaps everything) — the overlap on a
//     dim only ONE rule constrains is that rule's own values (they describe
//     exactly the shared audience on that axis).
// Returns null when ANY dimension has an empty intersection (no shared
// audience); otherwise the per-dimension overlap map for the §15.5 payload.
// Two fully-unconstrained rules overlap with an empty map ({}).
export function computeOverlap(
  a: RuleConditions,
  b: RuleConditions,
): Record<string, string[]> | null {
  const overlap: Record<string, string[]> = {};

  const aSets = a.sets ?? {};
  const bSets = b.sets ?? {};
  const dims = new Set<string>([...Object.keys(aSets), ...Object.keys(bSets)]);
  for (const dim of dims) {
    const aValues = aSets[dim as SetDimension];
    const bValues = bSets[dim as SetDimension];
    if (aValues !== undefined && bValues !== undefined) {
      const shared = intersectValues(aValues, bValues);
      if (shared.length === 0) return null; // disjoint on this dim — no overlap at all
      overlap[dim] = shared;
    } else {
      const specified = aValues ?? bValues;
      if (specified !== undefined) overlap[dim] = [...specified];
    }
  }

  const aTime = timeIntervals(a);
  const bTime = timeIntervals(b);
  if (aTime !== undefined && bTime !== undefined) {
    const shared: HourInterval[] = [];
    for (const ia of aTime) {
      for (const ib of bTime) {
        const hit = intersectIntervals(ia, ib);
        if (hit !== null) shared.push(hit);
      }
    }
    if (shared.length === 0) return null; // disjoint hours — no overlap at all
    overlap.hour = shared.map(formatInterval);
  } else {
    const specified = aTime ?? bTime;
    if (specified !== undefined) overlap.hour = specified.map(formatInterval);
  }

  return overlap;
}

// ---------------------------------------------------------------------------
// Conflict guard
// ---------------------------------------------------------------------------

export interface RuleGuardEntry {
  // Display key for the §15.5 payload — the candidate's Section name (falls
  // back to the candidate label upstream).
  candidate_key: string;
  priority: number;
  conditions: RuleConditions;
}

export interface RuleOverlapReport {
  candidate_a: string;
  candidate_b: string;
  overlap: Record<string, string[]>;
  reason: string;
}

export interface RuleConflictResult {
  // Equal-priority overlaps — BLOCK the save (§15.5).
  conflicts: RuleOverlapReport[];
  // Cross-priority overlaps — allowed, surfaced as override warnings.
  warnings: RuleOverlapReport[];
}

export function detectRuleConflicts(entries: RuleGuardEntry[]): RuleConflictResult {
  const conflicts: RuleOverlapReport[] = [];
  const warnings: RuleOverlapReport[] = [];
  for (let i = 0; i < entries.length; i++) {
    const a = entries[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < entries.length; j++) {
      const b = entries[j];
      if (b === undefined) continue;
      const overlap = computeOverlap(a.conditions, b.conditions);
      if (overlap === null) continue;
      if (a.priority === b.priority) {
        conflicts.push({
          candidate_a: a.candidate_key,
          candidate_b: b.candidate_key,
          overlap,
          reason: "Both rules can match the same user at the same priority.",
        });
      } else {
        // Lower priority value = evaluated first = wins the shared audience.
        const winner = a.priority < b.priority ? a : b;
        const loser = winner === a ? b : a;
        warnings.push({
          candidate_a: a.candidate_key,
          candidate_b: b.candidate_key,
          overlap,
          reason: `Rule '${winner.candidate_key}' can override Rule '${loser.candidate_key}' for these audiences.`,
        });
      }
    }
  }
  return { conflicts, warnings };
}

// The exact §15.5 blocking payload shape:
// { error: "Rule conflict", fields: { "page_<idx>.rules": [ {...}, ... ] } }
export interface RuleConflictPayload {
  error: "Rule conflict";
  fields: Record<string, RuleOverlapReport[]>;
}

export function buildConflictPayload(
  pageIndex: number,
  conflicts: RuleOverlapReport[],
): RuleConflictPayload {
  return {
    error: "Rule conflict",
    fields: { [`page_${pageIndex}.rules`]: conflicts },
  };
}

// ---------------------------------------------------------------------------
// conditions_hash
// ---------------------------------------------------------------------------

// Recursively sort object keys so logically-equal conditions serialize to the
// same string regardless of authoring order. Array ORDER is preserved (an
// authored detail — value arrays are compared as authored, not as sets).
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object" && value !== null) {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      out[key] = canonicalize(src[key]);
    }
    return out;
  }
  return value;
}

export function canonicalConditionsJson(conditions: RuleConditions): string {
  return JSON.stringify(canonicalize(conditions));
}

// conditions_hash == matched_rule_json_hash in analytics (contract §5.2 /
// §15.7). The contract specifies only that the two are EQUAL — the concrete
// algorithm is an authored detail of this implementation: SHA-256 (hex,
// lowercase) over the canonicalized (recursively key-sorted) conditions JSON.
// Any future producer of matched_rule_json_hash (the client selector beacon,
// Phase 5/6) MUST reuse this exact canonicalization + digest.
export async function conditionsHash(conditions: RuleConditions): Promise<string> {
  const json = canonicalConditionsJson(conditions);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
