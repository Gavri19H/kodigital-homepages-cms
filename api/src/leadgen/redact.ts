// LeadGen PII / secret log redaction (contract 09 §30.3, issue 25).
//
// Provider request/response logs are REDACTED BY DEFAULT before they touch
// `leadgen_provider_request_log`: values under PII-named keys are SHA-256
// hashed (§30.3 "PII hashed or removed" — hashing preserves joinability the
// same way the §30.3 S2S/CAPI hash list does: lowercased, trimmed, SHA-256),
// and secret-bearing header values are replaced with "[REDACTED]" (§30.2
// "never returned to the frontend"). The FULL unredacted blob lives only in
// the encrypted debug_ref KV leg (§30.3), never in an admin-visible column.
//
// The PII key list is derived from §30.3's two enumerations — the log clause
// ("email, phone, first/last/full name, address/street, dob, zip") plus the
// S2S/CAPI hash list ("email/zip/country/name") — with the common spelling
// variants of each. Keys match after normalization (lowercase, all
// non-alphanumerics stripped), so email / Email / email_address /
// emailAddress all hit the same entry.
//
// Every function here is PURE, deterministic, and NEVER throws — a redaction
// failure may never take down the Test tool / provider-request path that
// logs through it. Inputs are JSON-shaped values (post-JSON.parse), but
// arbitrary garbage (functions, symbols, pathological nesting) degrades to
// "[REDACTED]" instead of throwing.

import { sha256Hex } from "../public/leadgen/auction/parse";

export const REDACTED_VALUE = "[REDACTED]";

const PII_KEYS_NORMALIZED: ReadonlySet<string> = new Set([
  "email",
  "emailaddress",
  "phone",
  "phonenumber",
  "firstname",
  "lastname",
  "fullname",
  "name",
  "address",
  "street",
  "streetaddress",
  "addressline1",
  "addressline2",
  "dob",
  "dateofbirth",
  "birthdate",
  "zip",
  "zipcode",
  "postalcode",
  "postcode",
  "country",
]);

// Recursion bound: JSON.parse output is acyclic, but a pathological
// hand-built input must degrade to a redacted leaf, never overflow the stack.
const MAX_DEPTH = 64;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// True when `key` names PII per the §30.3-derived list above.
export function isPiiKey(key: string): boolean {
  return PII_KEYS_NORMALIZED.has(normalizeKey(key));
}

// The §30.3 hash: lowercased, trimmed, SHA-256 — "sha256:"-prefixed so a
// hashed value is self-describing inside a stored log row.
export function hashPiiValue(value: string | number | boolean): string {
  return `sha256:${sha256Hex(String(value).trim().toLowerCase())}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function walk(value: unknown, forceHash: boolean, depth: number): unknown {
  if (depth > MAX_DEPTH) return REDACTED_VALUE;
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") {
    return forceHash ? hashPiiValue(value as string | number | boolean) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => walk(item, forceHash, depth + 1));
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = walk(item, forceHash || isPiiKey(key), depth + 1);
    }
    return out;
  }
  // functions / symbols / bigints are not JSON-representable — redact.
  return REDACTED_VALUE;
}

// Deep-redact PII out of a JSON-shaped value: every scalar under a PII-named
// key becomes `sha256:<hash>` — at ANY depth, so an OBJECT under `address`
// force-hashes its whole subtree ({"address":{"line1":…,"city":…}} leaks
// nothing even though "line1"/"city" are not themselves listed keys).
// Everything else passes through byte-identical (0/false/null stay 0/false/
// null — never treated as absent).
export function redactPii(value: unknown): unknown {
  try {
    return walk(value, false, 0);
  } catch {
    return REDACTED_VALUE; // belt-and-braces: redaction NEVER throws
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Percent escapes are case-insensitive (`%2F` == `%2f`). Build a literal
// pattern that permits either hex case without making the unescaped secret
// bytes case-insensitive.
function encodedLiteralPattern(value: string): RegExp {
  let pattern = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? "";
    if (
      char === "%" &&
      index + 2 < value.length &&
      /^[0-9A-Fa-f]{2}$/.test(value.slice(index + 1, index + 3))
    ) {
      const hex = value.slice(index + 1, index + 3);
      pattern += "%";
      for (const digit of hex) {
        pattern += /[A-Fa-f]/.test(digit)
          ? `[${digit.toUpperCase()}${digit.toLowerCase()}]`
          : digit;
      }
      index += 2;
    } else {
      pattern += escapeRegex(char);
    }
  }
  return new RegExp(pattern, "g");
}

function formEncodeComponent(value: string): string {
  const params = new URLSearchParams();
  params.append("v", value);
  return params.toString().slice(2); // remove the fixed `v=` prefix
}

// Build the literal plus every URI/form encoding combination to depth two.
// The mixed combinations matter when a form-encoded value is embedded in a
// URI (or vice versa). URLSearchParams implements the actual HTML form
// algorithm, including ! ' ( ) ~, rather than the incomplete `%20` -> `+`
// approximation.
function secretEncodingVariants(secret: string): string[] {
  const variants = new Set<string>([secret]);
  let frontier = [secret];
  for (let depth = 0; depth < 2; depth += 1) {
    const next: string[] = [];
    for (const value of frontier) {
      for (const encoded of [encodeURIComponent(value), formEncodeComponent(value)]) {
        if (!variants.has(encoded)) {
          variants.add(encoded);
          next.push(encoded);
        }
      }
    }
    frontier = next;
  }
  return [...variants].sort((left, right) => right.length - left.length);
}

// Scrub resolved outbound credential VALUES from an arbitrary response text.
// Providers and proxies sometimes echo request URLs or authorization material
// inside a larger diagnostic string. Cover the literal, standards-compliant
// URI/form encodings, and every additional URI/form layer. Values are matched
// exactly and case-sensitively; only hex case inside percent escapes varies.
export function redactSecretText(
  text: string,
  secretValues: readonly string[],
): string {
  let output = text;
  const unique = [...new Set(secretValues.filter((value) => value !== ""))]
    .sort((left, right) => right.length - left.length);
  for (const secret of unique) {
    for (const variant of secretEncodingVariants(secret)) {
      output = output.replace(encodedLiteralPattern(variant), REDACTED_VALUE);
    }
  }
  return output;
}

function walkSecrets(value: unknown, secretValues: readonly string[], depth: number): unknown {
  if (depth > MAX_DEPTH) return REDACTED_VALUE;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactSecretText(value, secretValues);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((item) => walkSecrets(item, secretValues, depth + 1));
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const safeKey = redactSecretText(key, secretValues);
      out[safeKey] = walkSecrets(item, secretValues, depth + 1);
    }
    return out;
  }
  return REDACTED_VALUE;
}

// Deep-scrub response JSON before it enters any admin-visible response or D1
// projection. Internal parsing and the encrypt-only debug record retain the
// raw provider bytes; this function is for safe projections only.
export function redactSecretValues(
  value: unknown,
  secretValues: readonly string[],
): unknown {
  try {
    return walkSecrets(value, secretValues, 0);
  } catch {
    return REDACTED_VALUE;
  }
}

// Mask secret-bearing header VALUES (§30.2/§30.3: secret_ref-kind headers +
// the token header): names in `secretNames` (matched case-insensitively) →
// "[REDACTED]"; every other header passes verbatim.
export function maskSecretHeaders(
  headers: Readonly<Record<string, string>>,
  secretNames: ReadonlySet<string>,
): Record<string, string> {
  const lowered = new Set<string>();
  for (const secretName of secretNames) lowered.add(secretName.toLowerCase());
  const out: Record<string, string> = {};
  for (const [headerName, value] of Object.entries(headers)) {
    out[headerName] = lowered.has(headerName.toLowerCase()) ? REDACTED_VALUE : value;
  }
  return out;
}

// Replace the value at each EXISTING dotted path with "[REDACTED]" (numeric
// segments index arrays — the payload.ts path grammar). Used to mask the
// token node's value inside a built payload before it is echoed to the admin
// or logged (§30.2: the secret is SENT to the provider, never returned).
// Non-mutating (deep-clones first); a missing path is a silent no-op.
export function maskPaths(value: unknown, paths: readonly string[]): unknown {
  if (paths.length === 0) return value;
  let clone: unknown;
  try {
    clone = structuredClone(value);
  } catch {
    return REDACTED_VALUE; // unclonable input: mask everything, never throw
  }
  for (const path of paths) {
    const segments = path.split(".");
    let cursor: unknown = clone;
    for (let i = 0; i < segments.length - 1 && cursor !== undefined; i++) {
      const segment = segments[i] ?? "";
      if (Array.isArray(cursor)) {
        cursor = /^\d+$/.test(segment) ? cursor[Number(segment)] : undefined;
      } else if (isRecord(cursor)) {
        cursor = cursor[segment];
      } else {
        cursor = undefined;
      }
    }
    const leaf = segments[segments.length - 1] ?? "";
    if (Array.isArray(cursor)) {
      if (/^\d+$/.test(leaf) && Number(leaf) < cursor.length) {
        cursor[Number(leaf)] = REDACTED_VALUE;
      }
    } else if (isRecord(cursor) && leaf in cursor) {
      cursor[leaf] = REDACTED_VALUE;
    }
  }
  return clone;
}
