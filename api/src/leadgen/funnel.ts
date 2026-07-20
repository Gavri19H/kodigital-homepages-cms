// LeadGen §15 (quote/funnel builder), §15.5 (funnel rules), §17 (site
// activation) — PURE domain logic (no I/O). Consumed by Stage-B admin CRUD
// (save/publish validation) and by the Stage-C public serve; this module owns
// the invariants, never the persistence.
//
// Identity discipline (contract 06 §15.1, the G4 gate): a Funnel's stable id
// (`funnel_id` = `lgf_…`) and a Funnel Variant's id (`funnel_variant_id` =
// `lgn_…`) are DISTINCT entities and MUST NEVER be aliased/coerced into one
// another. This file expresses that as two nominal (branded) string types plus
// prefix-validating constructors, so a `FunnelVariantId` cannot be passed where
// a `FunnelId` is expected (compile error) and the runtime constructors reject
// a value carrying the wrong prefix.
//
// Design lineage is the reference-funnel / default-funnel (no product name in
// source, contract 09 §30.5).

import type {
  LeadgenFunnelRuleType,
  LeadgenConditionOp,
} from "../admin/leadgen/db-types";
import { isPublicId } from "./ids";
import { sha256Hex } from "../public/leadgen/auction/parse";

// ---------------------------------------------------------------------------
// §15.1 Quote / Funnel / Variant identity — nominal branded ids (G4)
// ---------------------------------------------------------------------------

declare const QUOTE_ID_BRAND: unique symbol;
declare const FUNNEL_ID_BRAND: unique symbol;
declare const FUNNEL_VARIANT_ID_BRAND: unique symbol;

// Three DISTINCT string subtypes. The brand key differs per type, so the
// structural type system refuses to assign one where another is expected —
// `funnel_id` and `funnel_variant_id` can never silently alias (contract 06
// §15.1 "funnel_id (stable) ≠ funnel_variant_id (variant), NEVER aliased").
export type QuoteId = string & { readonly [QUOTE_ID_BRAND]: true };
export type FunnelId = string & { readonly [FUNNEL_ID_BRAND]: true };
export type FunnelVariantId = string & { readonly [FUNNEL_VARIANT_ID_BRAND]: true };

export function isFunnelId(value: string): value is FunnelId {
  return isPublicId("funnel", value);
}

export function isFunnelVariantId(value: string): value is FunnelVariantId {
  return isPublicId("funnel_variant", value);
}

export function isQuoteId(value: string): value is QuoteId {
  return isPublicId("quote", value);
}

// Prefix-validating constructors. A value carrying the WRONG prefix (e.g. an
// `lgn_` passed as a funnel_id) throws — the runtime half of the no-alias
// invariant. Callers hold a proven-correct id after this returns.
export function toFunnelId(value: string): FunnelId {
  if (!isFunnelId(value)) {
    throw new Error(`not a funnel_id (expected lgf_ public id): ${JSON.stringify(value)}`);
  }
  return value;
}

export function toFunnelVariantId(value: string): FunnelVariantId {
  if (!isFunnelVariantId(value)) {
    throw new Error(
      `not a funnel_variant_id (expected lgn_ public id): ${JSON.stringify(value)}`,
    );
  }
  return value;
}

export function toQuoteId(value: string): QuoteId {
  if (!isQuoteId(value)) {
    throw new Error(`not a quote_id (expected lgq_ public id): ${JSON.stringify(value)}`);
  }
  return value;
}

export interface FunnelIdentity {
  quote_id: QuoteId;
  funnel_id: FunnelId;
  funnel_variant_id: FunnelVariantId;
}

// Assemble a proven-distinct identity triple. Validates every prefix AND that
// funnel_id !== funnel_variant_id as raw strings (defence in depth — the
// prefixes already differ, but an explicit inequality documents the intent).
export function resolveFunnelIdentity(
  quotePublicId: string,
  funnelPublicId: string,
  variantPublicId: string,
): FunnelIdentity {
  const funnel_id = toFunnelId(funnelPublicId);
  const funnel_variant_id = toFunnelVariantId(variantPublicId);
  if ((funnel_id as string) === (funnel_variant_id as string)) {
    throw new Error("funnel_id and funnel_variant_id must be distinct values");
  }
  return { quote_id: toQuoteId(quotePublicId), funnel_id, funnel_variant_id };
}

// ---------------------------------------------------------------------------
// §15.3 Funnel builder validation — contiguous positions; auction after MAX
// ---------------------------------------------------------------------------

// Minimal structural view of a variant→section row (leadgen_funnel_variant_
// sections): only `position` is load-bearing for builder validation.
export interface FunnelBuilderSection {
  position: number;
}

export type FunnelBuilderErrorCode =
  | "no_sections"
  | "negative_position"
  | "non_integer_position"
  | "duplicate_position"
  | "positions_not_contiguous";

export interface FunnelBuilderError {
  code: FunnelBuilderErrorCode;
  message: string;
  position?: number;
}

export interface FunnelBuilderValidation {
  ok: boolean;
  errors: FunnelBuilderError[];
  // The auction runs AFTER the section with the highest position (§15.3). null
  // when there are no sections (a variant with 0 sections cannot publish).
  auction_entry_position: number | null;
}

// The auction entry is ALWAYS the MAX-position section (§15.3 "no 'final'
// flag"). Returns null for an empty section set.
export function auctionEntryPosition(sections: readonly FunnelBuilderSection[]): number | null {
  if (sections.length === 0) return null;
  let max = sections[0]!.position;
  for (const s of sections) if (s.position > max) max = s.position;
  return max;
}

// Save/publish validation (§15.3): ≥1 section; positions are integers,
// non-negative, unique, and contiguous 0..n-1; the max-position section is the
// auction entry (there is no independent "final" flag, so an earlier section
// can never be the entry while later positions exist — the entry is derived,
// not stored).
export function validateFunnelBuilder(
  sections: readonly FunnelBuilderSection[],
): FunnelBuilderValidation {
  const errors: FunnelBuilderError[] = [];
  if (sections.length === 0) {
    errors.push({ code: "no_sections", message: "a funnel variant requires at least one section to publish" });
    return { ok: false, errors, auction_entry_position: null };
  }

  const seen = new Set<number>();
  for (const s of sections) {
    const p = s.position;
    if (!Number.isInteger(p)) {
      errors.push({ code: "non_integer_position", message: `position must be an integer, got ${p}`, position: p });
      continue;
    }
    if (p < 0) {
      errors.push({ code: "negative_position", message: `position must be >= 0, got ${p}`, position: p });
    }
    if (seen.has(p)) {
      errors.push({ code: "duplicate_position", message: `duplicate position ${p}`, position: p });
    }
    seen.add(p);
  }

  // Contiguous 0..n-1: the unique integer positions must be exactly the set
  // {0, 1, …, n-1}. A gap (e.g. [0,1,3]) or a non-zero start fails.
  const n = sections.length;
  for (let i = 0; i < n && errors.length === 0; i++) {
    if (!seen.has(i)) {
      errors.push({
        code: "positions_not_contiguous",
        message: `positions must be contiguous 0..${n - 1}; missing ${i}`,
        position: i,
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    auction_entry_position: auctionEntryPosition(sections),
  };
}

// ---------------------------------------------------------------------------
// §15.5 Funnel rules — redirect safety
// ---------------------------------------------------------------------------

const FUNNEL_RULE_TYPES: ReadonlySet<LeadgenFunnelRuleType> = new Set<LeadgenFunnelRuleType>([
  "redirect_direct_offer",
  "skip_section",
  "show_section",
  "eligibility",
  "disqualification",
  "auction_entry",
]);

// The canonical §21.4 condition-op vocabulary (shared with dependencies.ts /
// payload.ts). conditions_json on a funnel rule uses the SAME ops so a rule and
// a component dependency can never diverge on operator meaning.
const CONDITION_OPS: ReadonlySet<string> = new Set<LeadgenConditionOp>([
  "eq",
  "neq",
  "gt",
  "lt",
  "gte",
  "lte",
  "range",
  "in",
  "not_in",
]);

// Structural view of a funnel rule under validation (leadgen_funnel_rules).
// `redirect_url_allowlisted` accepts the DB INTEGER (0/1) or a bool; `redirect_
// pct` is `leadgen_funnel_rules.redirect_pct` (0044, REAL NULL) whose §15.5
// semantics use `?? 0` — an explicit 0 means "no redirect", absent (NULL)
// means "no redirect" too.
export interface FunnelRuleInput {
  rule_type: string;
  target_offer_id?: number | null;
  target_section_id?: number | null;
  redirect_url?: string | null;
  redirect_url_allowlisted?: number | boolean | null;
  conditions_json?: unknown;
  priority?: number | null;
  redirect_pct?: number | null;
}

export type FunnelRuleErrorCode =
  | "unknown_rule_type"
  | "redirect_offer_missing_target"
  | "raw_redirect_not_allowlisted"
  | "raw_redirect_url_invalid"
  | "raw_redirect_host_not_on_allowlist"
  | "conditions_invalid"
  | "condition_op_invalid"
  | "priority_invalid";

export interface FunnelRuleError {
  code: FunnelRuleErrorCode;
  message: string;
}

export interface FunnelRuleValidation {
  ok: boolean;
  errors: FunnelRuleError[];
}

// §15.5 `redirect_pct ?? 0`: an explicit 0 = no redirect; absent = no redirect.
// MUST use `??` not `||` so a legitimate 0 is not conflated with absent.
export function resolveRedirectPct(rule: Pick<FunnelRuleInput, "redirect_pct">): number {
  return rule.redirect_pct ?? 0;
}

// ---------------------------------------------------------------------------
// §15.5 redirect_pct — session-sticky percentage gate
// ---------------------------------------------------------------------------
//
// Same bucketing idiom as ab-hash.ts's abBucket (07 §16.2): SHA-256 over a
// colon-joined key, the first 4 digest bytes read big-endian as a uint32,
// `% 10000` -> a bucket in 0..9999. `sha256Hex` renders the digest as 8
// uint32 words each hex-padded to 8 chars, so the first 8 hex chars ARE the
// first digest word (see ab-hash.ts's own comment for the full derivation).
//
// Salted with a REDIRECT-SPECIFIC prefix + the rule's own identity (its
// conditions_hash or public_id — caller's choice via `ruleKey`) rather than
// reusing abBucket() directly: abBucket's signature (abTestPublicId,
// revision, sessionId) returns a VARIANT PICK over an allocation table, a
// different shape than the plain 0..100 threshold check a redirect rule
// needs. Keying on the rule's own identity (not e.g. the funnel/variant id)
// keeps a redirect rule's bucket space independent of any OTHER redirect
// rule's or A/B test's bucket space for the SAME session — no forced
// correlation between unrelated percentage gates.
export function redirectPctBucket(ruleKey: string, sessionId: string): number {
  const digest = sha256Hex(`redirect_pct:${ruleKey}:${sessionId}`);
  return parseInt(digest.slice(0, 8), 16) % 10000;
}

// §15.5 `redirect_pct ?? 0` gate for ONE matched redirect_direct_offer rule:
// does THIS session fall inside the redirect bucket? pct is authored 0..100.
//   • pct <= 0 (explicit 0, negative, absent/null/undefined) -> NEVER redirect
//     (resolveRedirectPct's `?? 0`, short-circuits before hashing).
//   • pct >= 100 -> ALWAYS redirect (short-circuits before hashing).
//   • otherwise -> a session-sticky, deterministic split: the SAME session
//     always gets the SAME verdict for the SAME rule (pure function of
//     exactly ruleKey + sessionId, no I/O, no clock, no randomness), and
//     across many sessions the split approximates pct% redirected.
// NOT YET WIRED into the runtime auction pipeline (api/src/public/leadgen/
// auction/engine.ts's redirect_direct_offer handling) — that file is outside
// this slice's ownership; see the phase report for the precise seam.
export function shouldRedirectForSession(
  pct: number | null | undefined,
  ruleKey: string,
  sessionId: string,
): boolean {
  const p = resolveRedirectPct({ redirect_pct: pct });
  if (p <= 0) return false;
  if (p >= 100) return true;
  return redirectPctBucket(ruleKey, sessionId) < p * 100;
}

function isTruthyFlag(v: number | boolean | null | undefined): boolean {
  return v === 1 || v === true;
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

// Validate conditions_json against the shared §21.4 typed-conditions shape:
// { groups: [{ field, op, value?/values?/from?/to? }, …] }. Returns typed
// errors (never throws). Empty/absent conditions are permitted here — presence
// of a malformed shape is what fails.
function validateRuleConditions(value: unknown, errors: FunnelRuleError[]): void {
  if (value === undefined || value === null) return;
  if (typeof value !== "object" || Array.isArray(value)) {
    errors.push({ code: "conditions_invalid", message: "conditions_json must be an object { groups: [...] }" });
    return;
  }
  const groups = (value as { groups?: unknown }).groups;
  if (!Array.isArray(groups)) {
    errors.push({ code: "conditions_invalid", message: "conditions_json.groups must be an array" });
    return;
  }
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (typeof g !== "object" || g === null || Array.isArray(g)) {
      errors.push({ code: "conditions_invalid", message: `conditions_json.groups[${i}] must be an object` });
      continue;
    }
    const group = g as Record<string, unknown>;
    if (typeof group["field"] !== "string" || group["field"].trim() === "") {
      errors.push({ code: "conditions_invalid", message: `conditions_json.groups[${i}].field is required` });
    }
    const op = group["op"];
    if (typeof op !== "string" || !CONDITION_OPS.has(op)) {
      errors.push({
        code: "condition_op_invalid",
        message: `conditions_json.groups[${i}].op must be one of ${[...CONDITION_OPS].join("|")}`,
      });
      continue;
    }
    if (op === "range" && (typeof group["from"] !== "number" || typeof group["to"] !== "number")) {
      errors.push({ code: "conditions_invalid", message: `conditions_json.groups[${i}] range op requires numeric from + to` });
    }
    if ((op === "in" || op === "not_in") && !Array.isArray(group["values"])) {
      errors.push({ code: "conditions_invalid", message: `conditions_json.groups[${i}] ${op} op requires a values array` });
    }
  }
}

// Validate a funnel rule (§15.5). `allowlist` is the admin-configured set of
// hosts a raw `redirect_url` may target. Rules:
//   • rule_type ∈ the six leadgen_funnel_rules kinds.
//   • redirect_direct_offer REQUIRES target_offer_id (the destination resolves
//     through the Offer's governed URL so macros/caps/tracking apply).
//   • a raw redirect_url is REJECTED unless redirect_url_allowlisted=1 AND its
//     host is on the admin allowlist (the ONLY path a raw URL is honored).
//   • conditions_json (when present) is a valid §21.4 typed-conditions object.
//   • priority (when present) is a finite integer.
export function validateFunnelRule(
  rule: FunnelRuleInput,
  allowlist: readonly string[],
): FunnelRuleValidation {
  const errors: FunnelRuleError[] = [];

  if (!FUNNEL_RULE_TYPES.has(rule.rule_type as LeadgenFunnelRuleType)) {
    errors.push({ code: "unknown_rule_type", message: `unknown rule_type ${JSON.stringify(rule.rule_type)}` });
    return { ok: false, errors };
  }

  if (rule.priority !== undefined && rule.priority !== null) {
    if (!Number.isInteger(rule.priority)) {
      errors.push({ code: "priority_invalid", message: "priority must be an integer" });
    }
  }

  validateRuleConditions(rule.conditions_json, errors);

  // redirect_direct_offer: the normal path uses target_offer_id.
  if (rule.rule_type === "redirect_direct_offer") {
    const hasOffer = rule.target_offer_id !== undefined && rule.target_offer_id !== null;
    if (!hasOffer) {
      errors.push({
        code: "redirect_offer_missing_target",
        message: "redirect_direct_offer requires target_offer_id (raw redirect_url is not the normal path)",
      });
    }
  }

  // A raw redirect_url is honored ONLY when allowlisted AND host ∈ allowlist.
  const rawUrl = typeof rule.redirect_url === "string" ? rule.redirect_url.trim() : "";
  if (rawUrl !== "") {
    if (!isTruthyFlag(rule.redirect_url_allowlisted)) {
      errors.push({
        code: "raw_redirect_not_allowlisted",
        message: "a raw redirect_url is only honored when redirect_url_allowlisted=1",
      });
    } else {
      let parsed: URL | null = null;
      try {
        parsed = new URL(rawUrl);
      } catch {
        parsed = null;
      }
      const scheme = parsed === null ? "" : parsed.protocol;
      const host = parsed === null ? "" : normalizeHost(parsed.hostname);
      // Contract 04 §10.5: a raw redirect_url MUST be an absolute http(s) URL.
      // A non-http(s) scheme (javascript:, data:, mailto:, …) or an empty host
      // is rejected BEFORE/independent of the allowlist check — otherwise an
      // empty-host URL like `javascript:alert(1)` (a VALID URL whose hostname is
      // "") would skip the host-on-allowlist check and validate regardless of
      // the allowlist. Such a URL can NEVER validate here.
      if (parsed === null || (scheme !== "http:" && scheme !== "https:") || host === "") {
        errors.push({
          code: "raw_redirect_url_invalid",
          message: `redirect_url must be an absolute http(s) URL with a host: ${rawUrl}`,
        });
      } else {
        const allowed = allowlist.map(normalizeHost);
        if (!allowed.includes(host)) {
          errors.push({
            code: "raw_redirect_host_not_on_allowlist",
            message: `redirect_url host '${host}' is not on the admin allowlist`,
          });
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// §17 Site activation validation — one enabled root per site; uniqueness
// ---------------------------------------------------------------------------

// Structural view of a leadgen_site_quotes row for activation validation.
export interface ActivationRowInput {
  id?: number | null;
  site_id: string;
  quote_id: number;
  enabled: number | boolean;
  slug?: string | null;
}

export type ActivationErrorCode = "root_conflict" | "duplicate_site_quote" | "duplicate_slug";

export interface ActivationError {
  code: ActivationErrorCode;
  message: string;
}

export interface ActivationValidation {
  ok: boolean;
  errors: ActivationError[];
}

function isEnabled(v: number | boolean): boolean {
  return v === 1 || v === true;
}

function isRoot(slug: string | null | undefined): boolean {
  return slug === null || slug === undefined;
}

// Validate activating/updating `newRow` against the site's existing
// leadgen_site_quotes rows (§17.1):
//   • uq_leadgen_sitequote_root — at most ONE enabled root (NULL slug) per
//     site: activating a SECOND enabled root while one is enabled errors.
//   • UNIQUE(site_id, quote_id) — a quote may be activated once per site.
//   • UNIQUE(site_id, slug) — a slug is unique per site.
// A row is "self" (an update, not a new conflicting row) only when both ids are
// present and equal; a fresh row (no id) conflicts with any matching existing
// row.
export function validateActivation(
  existingRows: readonly ActivationRowInput[],
  newRow: ActivationRowInput,
): ActivationValidation {
  const errors: ActivationError[] = [];

  const isSelf = (r: ActivationRowInput): boolean =>
    r.id !== undefined && r.id !== null && newRow.id !== undefined && newRow.id !== null && r.id === newRow.id;

  const others = existingRows.filter((r) => r.site_id === newRow.site_id && !isSelf(r));

  // UNIQUE(site_id, quote_id)
  if (others.some((r) => r.quote_id === newRow.quote_id)) {
    errors.push({
      code: "duplicate_site_quote",
      message: `quote ${newRow.quote_id} is already activated on site ${newRow.site_id}`,
    });
  }

  // UNIQUE(site_id, slug) — only meaningful for a non-null slug.
  if (!isRoot(newRow.slug) && others.some((r) => !isRoot(r.slug) && r.slug === newRow.slug)) {
    errors.push({
      code: "duplicate_slug",
      message: `slug '${newRow.slug}' is already used on site ${newRow.site_id}`,
    });
  }

  // uq_leadgen_sitequote_root — one enabled root (NULL slug) per site.
  if (isEnabled(newRow.enabled) && isRoot(newRow.slug)) {
    if (others.some((r) => isEnabled(r.enabled) && isRoot(r.slug))) {
      errors.push({
        code: "root_conflict",
        message: `site ${newRow.site_id} already has an enabled root activation (disable it or assign a slug)`,
      });
    }
  }

  return { ok: errors.length === 0, errors };
}
