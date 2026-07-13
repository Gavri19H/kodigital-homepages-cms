// LeadGen §12.8 Google Maps — SERVER module (address/ZIP validation + geocode).
//
// Split-key discipline (§30.2), authored conventions:
//   • GOOGLE_MAPS_BROWSER_KEY — a REFERRER-RESTRICTED browser key, resolved
//     per-request via resolveBrowserMapsKey() for injection into the funnel
//     shell's Places Autocomplete (P7). It is NEVER a server key, NEVER cached,
//     NEVER long-lived in the shell HTML (P7 injects it per-request).
//   • GOOGLE_MAPS_SERVER_KEY — server-side geocode / Address Validation ONLY
//     (validateAddress below). NEVER enters the cached shell HTML.
// Both are encrypted wrangler secrets read via readEnvSecret; ABSENT secret ⇒
// that leg NO-OPs (never a hard failure) — the §30.2 absent-secret-no-op rule.
//
// KV ZIP cache: namespace `lg-zip:<zip>` in env.CACHE, TTL LG_ZIP_CACHE_TTL_S
// (30 days) — a ZIP→{city,state} lookup is checked before any API call and
// populated after a successful one. Maps-normalized address fields
// (street/city/state/zip) are PAYLOAD-ONLY (§30.3) — never analytics dims.
//
// This module is pure server logic + one bounded outbound fetch; a malformed /
// failed / timed-out response yields a typed result and NEVER throws into the
// caller (the funnel runtime must not break on a Maps hiccup — §28/§30.2).

import { readEnvSecret, type Env } from "../env";

export const GOOGLE_MAPS_BROWSER_KEY = "GOOGLE_MAPS_BROWSER_KEY";
export const GOOGLE_MAPS_SERVER_KEY = "GOOGLE_MAPS_SERVER_KEY";
export const ZIP_CACHE_NAMESPACE = "lg-zip:";
export const LG_ZIP_CACHE_TTL_S = 60 * 60 * 24 * 30; // 30 days
const MAPS_FETCH_TIMEOUT_MS = 3000;

// Normalized US ZIP: exactly 5 digits (the reference funnel's `/^\d{5}$/`).
const ZIP_RE = /^\d{5}$/;

export function validateZip(zip: unknown): boolean {
  return typeof zip === "string" && ZIP_RE.test(zip);
}

// The per-request browser key for shell injection (P7). Null when the secret is
// absent — the Maps leg then no-ops (Autocomplete simply isn't wired). NEVER
// returns the server key.
export function resolveBrowserMapsKey(env: Env): string | null {
  return readEnvSecret(env, GOOGLE_MAPS_BROWSER_KEY) ?? null;
}

// Distinct internal address fields (§12.8) — payload-only (§30.3).
export interface LeadgenNormalizedAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export type LeadgenAddressValidationStatus = "ok" | "invalid" | "no_op";

export interface LeadgenAddressValidationResult {
  status: LeadgenAddressValidationStatus;
  normalized?: LeadgenNormalizedAddress;
  city?: string;
  state?: string;
  // `cached` = the answer came from the KV ZIP cache (no API call this request).
  cached?: boolean;
}

interface ZipCacheEntry {
  city: string;
  state: string;
}

function zipCacheKey(zip: string): string {
  return `${ZIP_CACHE_NAMESPACE}${zip}`;
}

async function readZipCache(env: Env, zip: string): Promise<ZipCacheEntry | null> {
  try {
    const raw = await env.CACHE.get(zipCacheKey(zip));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as ZipCacheEntry).city === "string" &&
      typeof (parsed as ZipCacheEntry).state === "string"
    ) {
      return parsed as ZipCacheEntry;
    }
    // Corrupt entry: drop it, fall through to a fresh lookup (D1/KV rule).
    await env.CACHE.delete(zipCacheKey(zip));
    return null;
  } catch {
    return null;
  }
}

async function writeZipCache(env: Env, zip: string, entry: ZipCacheEntry): Promise<void> {
  try {
    await env.CACHE.put(zipCacheKey(zip), JSON.stringify(entry), {
      expirationTtl: LG_ZIP_CACHE_TTL_S,
    });
  } catch {
    // Cache write failures never break validation (fail-open).
  }
}

interface AddressInput {
  zip?: string;
  address?: string;
}

// Server-side address/ZIP validation + geocode (§12.8). Order:
//   1. reject a malformed ZIP up front → `invalid` (no API call).
//   2. absent GOOGLE_MAPS_SERVER_KEY ⇒ `no_op` (§30.2) — no API call.
//   3. ZIP KV cache hit ⇒ `ok` (+ cached) — no API call.
//   4. bounded fetch to the geocode API; parse city/state; populate the cache.
//   5. any failure/timeout/malformed response ⇒ `no_op`/`invalid`, never throw.
export async function validateAddress(
  env: Env,
  input: AddressInput,
): Promise<LeadgenAddressValidationResult> {
  const zip = input.zip;
  if (zip !== undefined && !validateZip(zip)) {
    return { status: "invalid" };
  }

  const serverKey = readEnvSecret(env, GOOGLE_MAPS_SERVER_KEY);
  if (serverKey === undefined) {
    // Absent secret ⇒ the whole validate/geocode leg no-ops (§30.2).
    return { status: "no_op" };
  }

  // ZIP cache leg (only when a ZIP is provided).
  if (validateZip(zip)) {
    const cached = await readZipCache(env, zip as string);
    if (cached) {
      return {
        status: "ok",
        city: cached.city,
        state: cached.state,
        normalized: { street: "", city: cached.city, state: cached.state, zip: zip as string },
        cached: true,
      };
    }
  }

  const parsed = await geocode(serverKey, input);
  if (parsed.status !== "ok" || !parsed.normalized) return parsed;

  if (validateZip(parsed.normalized.zip)) {
    await writeZipCache(env, parsed.normalized.zip, {
      city: parsed.normalized.city,
      state: parsed.normalized.state,
    });
  }
  return parsed;
}

// One bounded outbound call to the Geocoding API. Never throws — a network /
// timeout / non-2xx / malformed-JSON / zero-results outcome is typed.
async function geocode(
  serverKey: string,
  input: AddressInput,
): Promise<LeadgenAddressValidationResult> {
  const query = input.address ?? input.zip;
  if (!query) return { status: "no_op" };

  const url =
    "https://maps.googleapis.com/maps/api/geocode/json?address=" +
    encodeURIComponent(query) +
    "&key=" +
    encodeURIComponent(serverKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAPS_FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch {
    return { status: "no_op" }; // network error / timeout — leg no-ops
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) return { status: "no_op" };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { status: "no_op" };
  }

  return parseGeocodeBody(body);
}

// Extract the distinct internal address fields from a Geocoding response.
// Unrecognized shape / zero results ⇒ `invalid` (the address didn't resolve).
function parseGeocodeBody(body: unknown): LeadgenAddressValidationResult {
  if (!body || typeof body !== "object") return { status: "no_op" };
  const results = (body as { results?: unknown }).results;
  if (!Array.isArray(results) || results.length === 0) return { status: "invalid" };

  const components = (results[0] as { address_components?: unknown }).address_components;
  if (!Array.isArray(components)) return { status: "invalid" };

  let streetNumber = "";
  let route = "";
  let city = "";
  let state = "";
  let zip = "";
  for (const comp of components) {
    if (!comp || typeof comp !== "object") continue;
    const types = (comp as { types?: unknown }).types;
    const long = (comp as { long_name?: unknown }).long_name;
    const short = (comp as { short_name?: unknown }).short_name;
    if (!Array.isArray(types)) continue;
    const longName = typeof long === "string" ? long : "";
    const shortName = typeof short === "string" ? short : "";
    if (types.includes("street_number")) streetNumber = longName;
    else if (types.includes("route")) route = longName;
    else if (types.includes("locality")) city = longName;
    else if (types.includes("administrative_area_level_1")) state = shortName || longName;
    else if (types.includes("postal_code")) zip = longName;
  }

  const street = [streetNumber, route].filter((s) => s !== "").join(" ");
  return {
    status: "ok",
    city,
    state,
    normalized: { street, city, state, zip },
  };
}

// v3.1 §9 — the auction LOCATION FACET (PROPOSED). "Use in auction rules"
// turns a validated ZIP into a location the auction can target/exclude by
// state, city or ZIP (§9.1). This is a NEW available data shape, additive to
// the auction answer-rule evaluation namespace (auction-rules.ts reads a flat
// {state, city, zip, …} record) — a LATER wiring step merges the facet into
// that namespace. The auction ENGINE + configs + payload stay UNTOUCHED
// (§1.3 preserve list): this module only DERIVES the facet, it never evaluates
// or mutates a rule.
//
// Key discipline (§9.3): the facet "still derives server-side" even when the
// BROWSER key is absent — the browser key only powers the client
// validate/autocomplete legs; a bare validated ZIP is itself a location, and a
// server-side geocode (SERVER key) enriches it with state/city. So the derive
// accepts EITHER a raw answer ZIP (facet = { zip }) OR a server-side
// validateAddress result / normalized address (facet = { zip, state?, city? }).
// A ZIP that is not exactly 5 digits (§12.8) yields null — no facet.
export interface LeadgenLocationFacet {
  zip: string;
  state?: string;
  city?: string;
}

export function deriveLocationFacet(
  input: string | LeadgenAddressValidationResult | LeadgenNormalizedAddress | null | undefined,
): LeadgenLocationFacet | null {
  if (input === null || input === undefined) return null;

  // A bare answer ZIP string: the facet carries only the ZIP (no geocode ran).
  if (typeof input === "string") {
    return validateZip(input) ? { zip: input } : null;
  }
  if (typeof input !== "object") return null;

  const result = input as Partial<LeadgenAddressValidationResult>;
  const addr = input as Partial<LeadgenNormalizedAddress>;
  const normalized = result.normalized;

  // ZIP source order: the geocode-normalized ZIP, else a normalized-address ZIP.
  const zip =
    normalized !== undefined && typeof normalized.zip === "string"
      ? normalized.zip
      : typeof addr.zip === "string"
        ? addr.zip
        : undefined;
  if (!validateZip(zip)) return null;

  const facet: LeadgenLocationFacet = { zip: zip as string };
  const state =
    (typeof result.state === "string" && result.state !== "" ? result.state : undefined) ??
    (normalized !== undefined && typeof normalized.state === "string" && normalized.state !== ""
      ? normalized.state
      : undefined) ??
    (typeof addr.state === "string" && addr.state !== "" ? addr.state : undefined);
  const city =
    (typeof result.city === "string" && result.city !== "" ? result.city : undefined) ??
    (normalized !== undefined && typeof normalized.city === "string" && normalized.city !== ""
      ? normalized.city
      : undefined) ??
    (typeof addr.city === "string" && addr.city !== "" ? addr.city : undefined);
  if (state !== undefined) facet.state = state;
  if (city !== undefined) facet.city = city;
  return facet;
}
