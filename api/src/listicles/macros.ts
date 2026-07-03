// Canonical macro registry for Offer URL templates (design contract §9.4).
//
// The contract counts "33 tokens": the 32 CANONICAL macros below plus
// `{clickid}` which is accepted only as a normalization ALIAS of the
// canonical `{click_id}` (normalized on save; the click resolver also
// accepts it at runtime). Unknown macros are rejected at validation time
// (§23) so a typo'd token can never reach a provider URL unresolved.

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
] as const;

// Alias map — the only entry today is the contract's `{clickid}` → `{click_id}`
// normalization (§9.4 / §23). Keys and values are bare macro names (no braces).
export const MACRO_ALIASES: Readonly<Record<string, string>> = {
  clickid: "click_id",
};

const CANONICAL_SET: ReadonlySet<string> = new Set(CANONICAL_MACROS);

// A macro token is `{name}` where name is [a-zA-Z0-9_]+. Matching is
// case-sensitive against the (lowercase) registry: `{Click_ID}` is an
// unknown macro, not a lenient match — deterministic over forgiving.
const MACRO_TOKEN_RE = /\{([a-zA-Z0-9_]+)\}/g;

function macroNamesIn(template: string): string[] {
  const names: string[] = [];
  for (const match of template.matchAll(MACRO_TOKEN_RE)) {
    const name = match[1];
    if (typeof name === "string") names.push(name);
  }
  return names;
}

// Normalize alias tokens to their canonical form ({clickid} → {click_id}).
// Every other character of the template — including canonical macros — is
// preserved byte-for-byte.
export function normalizeTemplate(template: string): string {
  return template.replace(MACRO_TOKEN_RE, (token, name: string) => {
    const canonical = MACRO_ALIASES[name];
    return canonical !== undefined ? `{${canonical}}` : token;
  });
}

// Return the distinct unknown macro names in a template (post-alias
// normalization). Empty array == every token is registry-known.
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
// Runtime macro resolution (§7.3 / §9.4 — the /lc click resolver)
// ---------------------------------------------------------------------------

// Substitute every macro token with its runtime value:
//   * the template is alias-normalized first, so `{clickid}` resolves as
//     `{click_id}` at runtime too (§9.4 "resolver also accepts the alias");
//   * every substituted value is encodeURIComponent-escaped — a macro value
//     can never smuggle a scheme/host/query-structure byte into the provider
//     URL (§24 "macros only, resolved server-side");
//   * UNRESOLVED-MACRO POLICY (authored, documented): a macro with no
//     runtime value — unknown name (validation should have rejected it) or
//     an empty context dim — substitutes as the EMPTY STRING. Deterministic
//     over leaky: a provider never receives a literal `{token}`.
export function resolveMacros(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return normalizeTemplate(template).replace(MACRO_TOKEN_RE, (_token, name: string) => {
    const value = values[name];
    return typeof value === "string" ? encodeURIComponent(value) : "";
  });
}

export interface OfferUrlTemplateVerdict {
  ok: boolean;
  // The alias-normalized template (what should be persisted when ok).
  normalized: string;
  errors: string[];
}

// §23 Offer URL rules: valid ABSOLUTE http(s) URL; macros preserved through
// normalization; unknown macros rejected. The URL parse runs over a copy with
// every macro substituted by a benign value so `{...}` tokens (legal in query
// strings, odd in hostnames) never fail WHATWG parsing on their own.
export function validateOfferUrlTemplate(template: string): OfferUrlTemplateVerdict {
  const errors: string[] = [];
  const trimmed = template.trim();
  if (trimmed === "") {
    return { ok: false, normalized: "", errors: ["offer_url_template is required"] };
  }

  const normalized = normalizeTemplate(trimmed);

  // Macros preserved: normalization only rewrites alias names — token count
  // must survive. (Belt-and-braces; a regression here would corrupt saves.)
  if (macroNamesIn(normalized).length !== macroNamesIn(trimmed).length) {
    errors.push("macro normalization must preserve every macro token");
  }

  const unknown = findUnknownMacros(normalized);
  if (unknown.length > 0) {
    errors.push(`unknown macros: ${unknown.map((n) => `{${n}}`).join(", ")}`);
  }

  // No C0/DEL control chars (NIT-4 / root cause of MINOR-1): WHATWG strips
  // them on parse, so a template like `https://track.com/c\n?x=1` would pass
  // the parse guard yet inject a `\n` into the resolved provider URL. Reject
  // at SAVE so the resolver never has to sanitize a stored bad row.
  if (/[\u0000-\u001f\u007f]/.test(normalized)) {
    errors.push("offer_url_template must not contain control characters");
  }

  // Absolute http(s) only — a macro cannot supply the scheme/host.
  if (!/^https?:\/\//i.test(normalized)) {
    errors.push("offer_url_template must be an absolute http(s) URL");
  } else {
    // A macro token MUST NOT sit in the authority (host[:port]) position
    // (NIT-4): `https://{sub1}/x` would let a client-controlled dim CHOOSE
    // the destination host — a latent open-redirect / host-choice vector.
    // The authority is everything between `://` and the first `/`, `?` or
    // `#`; a `{` there is rejected. (Macros in path/query stay legal.)
    const authority = normalized.replace(/^https?:\/\//i, "").split(/[/?#]/, 1)[0] ?? "";
    if (authority.includes("{")) {
      errors.push("offer_url_template must not place a macro in the host/authority position");
    }
    const substituted = normalized.replace(MACRO_TOKEN_RE, "x");
    try {
      const parsed = new URL(substituted);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        errors.push("offer_url_template must use the http or https scheme");
      }
    } catch {
      errors.push("offer_url_template is not a parseable URL");
    }
  }

  return { ok: errors.length === 0, normalized, errors };
}
