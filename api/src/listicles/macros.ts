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

  // Absolute http(s) only — a macro cannot supply the scheme/host.
  if (!/^https?:\/\//i.test(normalized)) {
    errors.push("offer_url_template must be an absolute http(s) URL");
  } else {
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
