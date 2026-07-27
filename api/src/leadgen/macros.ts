// LeadGen URL macro registry (contract 04 §10.5 + 01 §3 pattern-reuse table).
//
// Re-implements src/listicles/macros.ts IDENTICALLY (same 32 canonical
// macros, same {clickid} alias normalization, same validation guards:
// absolute http(s) only, no macro in the host/authority position, control
// chars rejected, unknown canonical macros rejected) and EXTENDS it with the
// LeadGen `{response:<dotted.path>}` macro family (04 §10.5 / issue 7):
//
//   * `{response:slug}`   — REQUIRED response macro: if the winning Offer's
//     parsed response has no value at `slug`, the carrier is DROPPED at
//     runtime (`carrier_filtered_reason='missing_required_response_field'`),
//     never silently resolved to empty.
//   * `{response:promo?}` — OPTIONAL response macro (`?` suffix): a missing
//     value resolves to the configured per-macro `safe_fallback` (default
//     empty string) and the carrier still renders.
//
// THIS PHASE ships the registry, response-macro syntax parsing, template
// analysis, and save-time template validation only. Runtime RESOLUTION of
// `{response:*}` against a live parsed response ships with the click
// resolver (01 §4.2 `click.ts`, /lg/lc) — `resolveMacros` therefore leaves
// response tokens byte-intact (their `:`/`.` characters never match the
// canonical token grammar).

export const CANONICAL_MACROS: readonly string[] = [
  "click_id",
  "utm_medium",
  "utm_content",
  "utm_source",
  "traffic_source",
  "placement",
  "lander_v",
  "offer_id",
  "offer_name",
  "page",
  "device",
  "os",
  "os_version",
  "browser",
  "browser_version",
  "country",
  "state",
  "city",
  "ip",
  "ua",
  "sub1",
  "sub2",
  "sub3",
  "sub4",
  "sub5",
  "url",
  "referer",
  "language",
  "cpc",
  "session_id",
  "fbc",
  "fbclid",
  // LeadGen Rework M10/D3 (stamp-only): the quote-scoped routing rule's
  // feed_name action, registered as a canonical macro exactly like every
  // other ctx-derived dimension above — so a schema SAVE (payload.ts
  // validatePayloadSchema, via isCanonicalMacro) accepts `source:"macro",
  // macro:"feed_name"`. Runtime resolves it from LeadGenRuntimeContext.feed_name
  // (runtime-context.ts contextToMacros); "" when no routing rule matched
  // (never fabricated, same unresolved-macro policy as every macro above).
  // CONDUCTOR-RATIFIED companion fix: ui-payload-builder.ts's
  // ADVANCED_MACRO_GROUPS (that file's own module-load drift guard —
  // ADVANCED_MACRO_SET.size === CANONICAL_MACROS.length — asserts EVERY
  // canonical macro is reachable through the Advanced picker) carries a
  // matching "feed_name" entry so this registration never breaks it.
  "feed_name",
] as const;

// Alias map — `{clickid}` → `{click_id}` (identical to listicles; normalized
// on save, also accepted at runtime) plus `{referrer}` → `{referer}` (M1,
// fix-contract v2.4 04 §4.3 — the common alternate spelling).
export const MACRO_ALIASES: Readonly<Record<string, string>> = {
  clickid: "click_id",
  referrer: "referer",
};

const CANONICAL_SET: ReadonlySet<string> = new Set(CANONICAL_MACROS);

// True when `name` is one of the canonical macro names (post-alias form; the
// original 32 + LeadGen Rework's additive `feed_name`, M10/D3). payload.ts
// uses this to validate `source:"macro"` schema nodes (04 §11.5).
export function isCanonicalMacro(name: string): boolean {
  return CANONICAL_SET.has(name);
}

// A canonical macro token is `{name}` where name is [a-zA-Z0-9_]+. Matching
// is case-sensitive against the (lowercase) registry: `{Click_ID}` is an
// unknown macro, not a lenient match — deterministic over forgiving.
// `{response:path}` tokens contain `:`/`.` so this grammar never matches
// them; the two token families are disjoint by construction.
const MACRO_TOKEN_RE = /\{([a-zA-Z0-9_]+)\}/g;

// A response macro token is `{response:<path>}` or `{response:<path>?}`.
// The inner text is captured loosely and validated against RESPONSE_PATH_RE
// so malformed paths produce a TYPED validation error instead of silently
// falling through as "not a token".
const RESPONSE_TOKEN_RE = /\{response:([^}]*)\}/g;

// Dotted path grammar: 1+ segments of [A-Za-z0-9_]+ joined by single dots.
// Purely-numeric segments are legal (array indices into the parsed response,
// e.g. `{response:carriers.0.slug}`).
const RESPONSE_PATH_RE = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/;

function macroNamesIn(template: string): string[] {
  const names: string[] = [];
  for (const match of template.matchAll(MACRO_TOKEN_RE)) {
    const name = match[1];
    if (typeof name === "string") names.push(name);
  }
  return names;
}

// Normalize alias tokens to their canonical form ({clickid} → {click_id}).
// Every other character — canonical macros, response macros, plain text —
// is preserved byte-for-byte.
export function normalizeTemplate(template: string): string {
  return template.replace(MACRO_TOKEN_RE, (token, name: string) => {
    const canonical = MACRO_ALIASES[name];
    return canonical !== undefined ? `{${canonical}}` : token;
  });
}

// Return the distinct unknown CANONICAL-grammar macro names in a template
// (post-alias normalization). Response tokens are a different grammar and
// are validated separately by validateBannerUrlTemplate.
export function findUnknownMacros(template: string): string[] {
  const unknown: string[] = [];
  for (const name of macroNamesIn(normalizeTemplate(template))) {
    if (!CANONICAL_SET.has(name) && !unknown.includes(name)) {
      unknown.push(name);
    }
  }
  return unknown;
}

// ---------------------------------------------------------------------------
// Runtime canonical-macro resolution (identical semantics to listicles)
// ---------------------------------------------------------------------------

// Substitute every CANONICAL macro token with its runtime value:
//   * alias-normalized first, so `{clickid}` resolves as `{click_id}`;
//   * every substituted value is encodeURIComponent-escaped — a macro value
//     can never smuggle a scheme/host/query-structure byte into the URL;
//   * UNRESOLVED-MACRO POLICY: a canonical-grammar macro with no runtime
//     value substitutes as the EMPTY STRING (deterministic over leaky);
//   * `{response:*}` tokens are LEFT INTACT — the P11 click resolver owns
//     their resolution (04 §10.5 required-drop / optional-fallback rules).
export function resolveMacros(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return normalizeTemplate(template).replace(MACRO_TOKEN_RE, (_token, name: string) => {
    const value = values[name];
    return typeof value === "string" ? encodeURIComponent(value) : "";
  });
}

// ---------------------------------------------------------------------------
// Response macro family — analysis (04 §10.5)
// ---------------------------------------------------------------------------

// One `{response:...}` reference discovered in a template. `required` is the
// §10.5 marking: no `?` suffix = required (missing value drops the carrier),
// `?` suffix = optional (missing value resolves to the safe_fallback).
export interface LeadgenResponseMacroRef {
  path: string;
  required: boolean;
  token: string;
}

// Per-macro safe_fallback configuration (04 §10.5): keyed by response path.
// Stored alongside the Offer's banner template config; consumed by the P11
// resolver via responseMacroFallback().
export type LeadgenResponseMacroFallbacks = Readonly<Record<string, string>>;

// The §10.5 default: an optional response macro with no configured
// safe_fallback resolves to the empty string.
export function responseMacroFallback(
  fallbacks: LeadgenResponseMacroFallbacks | null | undefined,
  path: string,
): string {
  const value = fallbacks?.[path];
  return typeof value === "string" ? value : "";
}

// Parse the inner text of one `{response:...}` token. Returns null when the
// path is malformed (empty, bad dots, `?` anywhere but the very end, ...).
function parseResponseInner(inner: string): { path: string; required: boolean } | null {
  const required = !inner.endsWith("?");
  const path = required ? inner : inner.slice(0, -1);
  if (!RESPONSE_PATH_RE.test(path)) return null;
  return { path, required };
}

// List every WELL-FORMED response macro a template references, deduplicated
// by (path, required) pair in first-appearance order — so a template that
// marks the same path both required AND optional yields two entries (and
// validateBannerUrlTemplate flags the conflict). Malformed tokens are not
// listed here; they surface as typed validation errors.
export function analyzeResponseMacros(template: string): LeadgenResponseMacroRef[] {
  const refs: LeadgenResponseMacroRef[] = [];
  for (const match of template.matchAll(RESPONSE_TOKEN_RE)) {
    const inner = match[1];
    if (typeof inner !== "string") continue;
    const parsed = parseResponseInner(inner);
    if (parsed === null) continue;
    const exists = refs.some((r) => r.path === parsed.path && r.required === parsed.required);
    if (!exists) {
      refs.push({ path: parsed.path, required: parsed.required, token: match[0] });
    }
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Banner URL template validation (04 §10.5 save-time guards)
// ---------------------------------------------------------------------------

export type LeadgenBannerUrlTemplateErrorCode =
  | "template_required"
  | "normalization_token_loss"
  | "unknown_macro"
  | "invalid_response_macro"
  | "conflicting_response_macro_requiredness"
  | "control_characters"
  | "not_absolute_http"
  | "macro_in_authority"
  | "unparseable_url";

export interface LeadgenBannerUrlTemplateError {
  code: LeadgenBannerUrlTemplateErrorCode;
  message: string;
  // The offending token/path where one exists (unknown macro, malformed or
  // conflicting response macro) — lets the admin UI point at the exact chip.
  token?: string;
}

export interface LeadgenBannerUrlTemplateVerdict {
  ok: boolean;
  // The alias-normalized template (what should be persisted when ok).
  normalized: string;
  errors: LeadgenBannerUrlTemplateError[];
  // Every well-formed response macro the template references, with its
  // §10.5 required/optional flag — the Test tool renders these as chips and
  // flags required macros with no source.
  response_macros: LeadgenResponseMacroRef[];
}

// 04 §10.5 validation guards ("unchanged" from the listicles baseline, plus
// the response-macro family):
//   1. absolute http(s) only — a macro can never supply the scheme/host;
//   2. no macro token (either family) in the host/authority position;
//   3. no C0/DEL control chars (WHATWG strips them at parse time, so they
//      would otherwise survive into a resolved provider URL);
//   4. unknown canonical macros rejected;
//   5. malformed `{response:...}` paths rejected;
//   6. the same response path marked both required and optional rejected
//      (required-missing drops the carrier, so a second optional marking of
//      the same path could never take effect — contradictory authoring).
export function validateBannerUrlTemplate(template: string): LeadgenBannerUrlTemplateVerdict {
  const errors: LeadgenBannerUrlTemplateError[] = [];
  const trimmed = template.trim();
  if (trimmed === "") {
    return {
      ok: false,
      normalized: "",
      errors: [{ code: "template_required", message: "banner_url_template is required" }],
      response_macros: [],
    };
  }

  const normalized = normalizeTemplate(trimmed);

  // Belt-and-braces (mirrors listicles): alias normalization only rewrites
  // token NAMES — the canonical token count must survive byte-for-byte.
  if (macroNamesIn(normalized).length !== macroNamesIn(trimmed).length) {
    errors.push({
      code: "normalization_token_loss",
      message: "macro normalization must preserve every macro token",
    });
  }

  for (const name of findUnknownMacros(normalized)) {
    errors.push({
      code: "unknown_macro",
      message: `unknown macro {${name}}`,
      token: `{${name}}`,
    });
  }

  // Response macro syntax: every `{response:...}` token must carry a
  // well-formed dotted path (optional trailing `?` only).
  for (const match of normalized.matchAll(RESPONSE_TOKEN_RE)) {
    const inner = match[1] ?? "";
    if (parseResponseInner(inner) === null) {
      errors.push({
        code: "invalid_response_macro",
        message: `malformed response macro ${match[0]} — expected {response:dotted.path} or {response:dotted.path?}`,
        token: match[0],
      });
    }
  }

  // Conflicting requiredness: `{response:slug}` + `{response:slug?}` in one
  // template is contradictory (see guard 6 above).
  const refs = analyzeResponseMacros(normalized);
  const seenPaths = new Map<string, boolean>();
  for (const ref of refs) {
    const prior = seenPaths.get(ref.path);
    if (prior !== undefined && prior !== ref.required) {
      errors.push({
        code: "conflicting_response_macro_requiredness",
        message: `response macro path '${ref.path}' is marked both required and optional`,
        token: ref.token,
      });
    } else {
      seenPaths.set(ref.path, ref.required);
    }
  }

  // No C0/DEL control chars — reject at SAVE so the resolver never has to
  // sanitize a stored bad row.
  if (/[\u0000-\u001f\u007f]/.test(normalized)) {
    errors.push({
      code: "control_characters",
      message: "banner_url_template must not contain control characters",
    });
  }

  // Absolute http(s) only — a macro cannot supply the scheme/host.
  if (!/^https?:\/\//i.test(normalized)) {
    errors.push({
      code: "not_absolute_http",
      message: "banner_url_template must be an absolute http(s) URL",
    });
  } else {
    // A token from EITHER family must not sit in the authority (host[:port])
    // position: `https://{sub1}/x` or `https://{response:host}/x` would let
    // a client-controlled value CHOOSE the destination host — a latent
    // open-redirect / host-choice vector. The authority is everything
    // between `://` and the first `/`, `?` or `#`; a `{` there is rejected.
    const authority = normalized.replace(/^https?:\/\//i, "").split(/[/?#]/, 1)[0] ?? "";
    if (authority.includes("{")) {
      errors.push({
        code: "macro_in_authority",
        message: "banner_url_template must not place a macro in the host/authority position",
      });
    }
    // The URL parse runs over a copy with every token (both families)
    // substituted by a benign value so `{...}` tokens — legal in query
    // strings, odd in hostnames — never fail WHATWG parsing on their own.
    const substituted = normalized
      .replace(RESPONSE_TOKEN_RE, "x")
      .replace(MACRO_TOKEN_RE, "x");
    try {
      const parsed = new URL(substituted);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        errors.push({
          code: "not_absolute_http",
          message: "banner_url_template must use the http or https scheme",
        });
      }
    } catch {
      errors.push({
        code: "unparseable_url",
        message: "banner_url_template is not a parseable URL",
      });
    }
  }

  return { ok: errors.length === 0, normalized, errors, response_macros: refs };
}
