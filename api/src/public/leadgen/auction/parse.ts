// Provider response parsing → canonical Carrier normalization (contract 04
// §11.7 / issue 19 + 07 §18.8 carrier identity).
//
// Every provider response is normalized into the COMMON Carrier shape by
// the winning Offer's `carrier_parse_json` BEFORE the auction/banner layer
// ever sees it (04 §11.7): `carrier_key, carrier_name, carrier_logo, bid,
// bid_currency, click_url, tracking_id, headline?, subheadline?,
// disclaimer?, pricing_model`. Carrier identity follows 07 §18.8
// (normative): the provider-supplied stable id when present, else
// `slug(carrier_name)` (lowercase, trim, non-alphanumerics→`-`), plus the
// first-8 hex of SHA-256(logo_url) when slug disambiguation is needed —
// with `carrier_key_source` recording which route minted the key.
//
// parseProviderResponse NEVER throws: malformed input yields a typed
// `{ carriers: [], errors: [...] }` result with whole-response AND
// per-carrier error granularity — parsing failures feed the
// `malformed_response_rate` metric (07 §18.9) and "never throw into the
// auction" (04 §11.7).

import type { LeadgenCarrier } from "../../../admin/leadgen/db-types";

// ---------------------------------------------------------------------------
// Canonical Carrier (04 §11.7 field set + 07 §18.8 identity fields)
// ---------------------------------------------------------------------------

export type LeadgenCarrierKeySource = "provider_id" | "slug" | "slug_logo";

// db-types' LeadgenCarrier carries the shared field set; the parser output
// adds the 04 §11.7 `pricing_model` field and the 07 §18.8
// `carrier_key_source` identity marker (extension, not a fork — every
// LeadgenParsedCarrier is assignable to LeadgenCarrier).
export interface LeadgenParsedCarrier extends LeadgenCarrier {
  pricing_model?: string | null;
  carrier_key_source: LeadgenCarrierKeySource;
}

// ---------------------------------------------------------------------------
// carrier_parse_json config shape
// ---------------------------------------------------------------------------

// Field paths are dotted paths INTO one carrier item (numeric segments index
// arrays). A field may list several candidate paths — the first path that
// resolves to a usable value wins (the reference's multi-source fallback
// pattern, 01 §2.3).
export type LeadgenCarrierFieldPath = string | readonly string[];

export interface LeadgenCarrierParseConfig {
  // Dotted path to the carriers array within the provider response; ""/
  // absent = the response root. A single carrier OBJECT at that path is
  // accepted as a one-carrier array (single-quote providers).
  carriers_path?: string;
  fields: {
    // Feeds carrier_key when present (07 §18.8 carrier_key_source =
    // 'provider_id'); not itself a canonical Carrier output field.
    provider_id?: LeadgenCarrierFieldPath;
    carrier_name?: LeadgenCarrierFieldPath;
    carrier_logo?: LeadgenCarrierFieldPath;
    bid?: LeadgenCarrierFieldPath;
    bid_currency?: LeadgenCarrierFieldPath;
    click_url?: LeadgenCarrierFieldPath;
    tracking_id?: LeadgenCarrierFieldPath;
    headline?: LeadgenCarrierFieldPath;
    subheadline?: LeadgenCarrierFieldPath;
    disclaimer?: LeadgenCarrierFieldPath;
    pricing_model?: LeadgenCarrierFieldPath;
  };
}

// ---------------------------------------------------------------------------
// Typed, never-thrown errors
// ---------------------------------------------------------------------------

export type LeadgenParseErrorCode =
  | "config_invalid"
  | "empty_response"
  | "invalid_json"
  | "carriers_path_not_found"
  | "carriers_not_array"
  | "carrier_not_object"
  | "field_wrong_type"
  | "bid_invalid"
  | "carrier_key_underivable";

export interface LeadgenParseError {
  // "response" = the whole response failed/degraded; "carrier" = one item.
  scope: "response" | "carrier";
  code: LeadgenParseErrorCode;
  carrier_index?: number;
  field?: string;
  message: string;
}

export interface LeadgenParseResult {
  carriers: LeadgenParsedCarrier[];
  errors: LeadgenParseError[];
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Dotted-path extraction over objects/arrays: numeric segments index arrays,
// everything else keys objects. Any missing hop resolves undefined.
export function getAtPath(source: unknown, path: string): unknown {
  if (path === "") return source;
  let cursor: unknown = source;
  for (const segment of path.split(".")) {
    if (Array.isArray(cursor)) {
      if (!/^\d+$/.test(segment)) return undefined;
      cursor = cursor[Number(segment)];
    } else if (isRecord(cursor)) {
      cursor = cursor[segment];
    } else {
      return undefined;
    }
    if (cursor === undefined || cursor === null) {
      return cursor === null ? null : undefined;
    }
  }
  return cursor;
}

// Resolve a field's first usable candidate path (multi-source fallback).
function extractRaw(item: unknown, paths: LeadgenCarrierFieldPath): unknown {
  const list = typeof paths === "string" ? [paths] : paths;
  for (const path of list) {
    const value = getAtPath(item, path);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

// 07 §18.8 slug: lowercase, trim, non-alphanumerics→`-` (runs collapsed,
// edges stripped so "  Acme  Life! " and "acme-life" agree).
export function slugifyCarrierName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Synchronous SHA-256 (hex) — self-contained so carrier-key minting stays a
// pure synchronous function (crypto.subtle is async). Only the first 8 hex
// chars feed §18.8 slug disambiguation; the full digest is exported for
// direct test-vector verification.
// ---------------------------------------------------------------------------

const SHA256_K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

export function sha256Hex(input: string): string {
  const data = new TextEncoder().encode(input);
  const bitLen = data.length * 8;
  const padded = new Uint8Array((((data.length + 8) >> 6) + 1) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);

  const h: number[] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const w: number[] = new Array<number>(64).fill(0);

  const rotr = (x: number, n: number): number => ((x >>> n) | (x << (32 - n))) >>> 0;

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15] ?? 0;
      const w2 = w[i - 2] ?? 0;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0;
    }
    let a = h[0] ?? 0;
    let b = h[1] ?? 0;
    let c = h[2] ?? 0;
    let d = h[3] ?? 0;
    let e = h[4] ?? 0;
    let f = h[5] ?? 0;
    let g = h[6] ?? 0;
    let hh = h[7] ?? 0;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + (SHA256_K[i] ?? 0) + (w[i] ?? 0)) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = ((h[0] ?? 0) + a) >>> 0;
    h[1] = ((h[1] ?? 0) + b) >>> 0;
    h[2] = ((h[2] ?? 0) + c) >>> 0;
    h[3] = ((h[3] ?? 0) + d) >>> 0;
    h[4] = ((h[4] ?? 0) + e) >>> 0;
    h[5] = ((h[5] ?? 0) + f) >>> 0;
    h[6] = ((h[6] ?? 0) + g) >>> 0;
    h[7] = ((h[7] ?? 0) + hh) >>> 0;
  }
  return h.map((word) => word.toString(16).padStart(8, "0")).join("");
}

// ---------------------------------------------------------------------------
// Per-field extraction with type policing
// ---------------------------------------------------------------------------

// String field extraction: strings pass; numbers stringify ONLY for id-like
// fields (tracking_id / provider_id — providers commonly emit numeric ids);
// any other present-but-wrong type yields null + a per-carrier field error.
function extractString(
  item: unknown,
  paths: LeadgenCarrierFieldPath | undefined,
  field: string,
  index: number,
  numberOk: boolean,
  errors: LeadgenParseError[],
): string | null {
  if (paths === undefined) return null;
  const raw = extractRaw(item, paths);
  if (raw === undefined) return null;
  if (typeof raw === "string") return raw;
  if (numberOk && typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  errors.push({
    scope: "carrier",
    code: "field_wrong_type",
    carrier_index: index,
    field,
    message: `${field} must be a string`,
  });
  return null;
}

// Bid extraction (07 §18.4: zero/invalid/missing bids parse to 0 — an
// all-zero Offer is `no_bid` downstream, never a thrown error). A PRESENT
// but non-numeric/negative bid additionally records a per-carrier error
// (it feeds malformed_response_rate); an absent bid is silent 0.
function extractBid(
  item: unknown,
  paths: LeadgenCarrierFieldPath | undefined,
  index: number,
  errors: LeadgenParseError[],
): number {
  if (paths === undefined) return 0;
  const raw = extractRaw(item, paths);
  if (raw === undefined) return 0;
  let bid: number | null = null;
  if (typeof raw === "number" && Number.isFinite(raw)) bid = raw;
  else if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) bid = n;
  }
  if (bid === null || bid < 0) {
    errors.push({
      scope: "carrier",
      code: "bid_invalid",
      carrier_index: index,
      field: "bid",
      message: "bid is not a non-negative number; parsed as 0",
    });
    return 0;
  }
  return bid;
}

// ---------------------------------------------------------------------------
// parseProviderResponse
// ---------------------------------------------------------------------------

interface PendingCarrier {
  carrier: LeadgenParsedCarrier;
  slug: string | null; // non-null only for slug-derived keys (pre-disambiguation)
}

// Normalize one provider response into canonical Carriers. `config` is the
// Offer's parsed carrier_parse_json (validated here — a broken config is a
// typed response-scope error, never a throw); `rawResponse` is either the
// raw body STRING (JSON.parse'd here) or an already-parsed JSON value.
export function parseProviderResponse(
  config: unknown,
  rawResponse: unknown,
): LeadgenParseResult {
  const errors: LeadgenParseError[] = [];

  // --- config validation -----------------------------------------------
  if (!isRecord(config) || !isRecord(config["fields"])) {
    return {
      carriers: [],
      errors: [
        {
          scope: "response",
          code: "config_invalid",
          message: "carrier_parse_json must be an object with a fields map",
        },
      ],
    };
  }
  const parseConfig = config as unknown as LeadgenCarrierParseConfig;
  const fields = parseConfig.fields;

  // --- response body ------------------------------------------------------
  if (rawResponse === undefined || rawResponse === null || rawResponse === "") {
    return {
      carriers: [],
      errors: [{ scope: "response", code: "empty_response", message: "provider response is empty" }],
    };
  }
  let body: unknown = rawResponse;
  if (typeof rawResponse === "string") {
    try {
      body = JSON.parse(rawResponse);
    } catch {
      return {
        carriers: [],
        errors: [
          { scope: "response", code: "invalid_json", message: "provider response is not valid JSON" },
        ],
      };
    }
  }

  // --- carriers node -------------------------------------------------------
  const carriersPath = typeof parseConfig.carriers_path === "string" ? parseConfig.carriers_path : "";
  const node = getAtPath(body, carriersPath);
  if (node === undefined || node === null) {
    return {
      carriers: [],
      errors: [
        {
          scope: "response",
          code: "carriers_path_not_found",
          message: `no value at carriers_path '${carriersPath}'`,
        },
      ],
    };
  }
  let items: unknown[];
  if (Array.isArray(node)) {
    items = node;
  } else if (isRecord(node)) {
    items = [node]; // single-carrier providers return one object
  } else {
    return {
      carriers: [],
      errors: [
        {
          scope: "response",
          code: "carriers_not_array",
          message: `carriers_path '${carriersPath}' is not an array or object`,
        },
      ],
    };
  }

  // --- per-carrier extraction (partial failure keeps the rest) ------------
  const pending: PendingCarrier[] = [];
  items.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push({
        scope: "carrier",
        code: "carrier_not_object",
        carrier_index: index,
        message: "carrier item is not an object",
      });
      return;
    }

    const providerId = extractString(item, fields.provider_id, "provider_id", index, true, errors);
    const carrierName = extractString(item, fields.carrier_name, "carrier_name", index, false, errors);
    const carrier: LeadgenParsedCarrier = {
      carrier_key: "", // minted below (§18.8)
      carrier_key_source: "slug",
      carrier_name: carrierName,
      carrier_logo: extractString(item, fields.carrier_logo, "carrier_logo", index, false, errors),
      bid: extractBid(item, fields.bid, index, errors),
      bid_currency: extractString(item, fields.bid_currency, "bid_currency", index, false, errors),
      click_url: extractString(item, fields.click_url, "click_url", index, false, errors),
      tracking_id: extractString(item, fields.tracking_id, "tracking_id", index, true, errors),
      headline: extractString(item, fields.headline, "headline", index, false, errors),
      subheadline: extractString(item, fields.subheadline, "subheadline", index, false, errors),
      disclaimer: extractString(item, fields.disclaimer, "disclaimer", index, false, errors),
      pricing_model: extractString(item, fields.pricing_model, "pricing_model", index, false, errors),
    };

    // §18.8 identity: provider id → carrier_key as-is; else slug the name.
    if (providerId !== null && providerId.trim() !== "") {
      carrier.carrier_key = providerId.trim();
      carrier.carrier_key_source = "provider_id";
      pending.push({ carrier, slug: null });
      return;
    }
    const slug = carrierName === null ? "" : slugifyCarrierName(carrierName);
    if (slug === "") {
      // No stable id and no sluggable name: carrier identity is underivable
      // — the carrier is DROPPED (carrier_key is the one guaranteed field).
      errors.push({
        scope: "carrier",
        code: "carrier_key_underivable",
        carrier_index: index,
        message: "carrier has no provider id and no sluggable carrier_name",
      });
      return;
    }
    carrier.carrier_key = slug;
    carrier.carrier_key_source = "slug";
    pending.push({ carrier, slug });
  });

  // --- §18.8 slug disambiguation ------------------------------------------
  // When two slug-keyed carriers in the SAME response collide, each one
  // with a logo appends `-` + first-8 hex of SHA-256(logo_url) and becomes
  // carrier_key_source='slug_logo'. Identical name+logo carriers keep the
  // identical key on purpose — they ARE the same carrier; enabled_unique /
  // backfill_unique dedupe them downstream.
  const slugCounts = new Map<string, number>();
  for (const entry of pending) {
    if (entry.slug !== null) {
      slugCounts.set(entry.slug, (slugCounts.get(entry.slug) ?? 0) + 1);
    }
  }
  for (const entry of pending) {
    if (entry.slug === null) continue;
    if ((slugCounts.get(entry.slug) ?? 0) < 2) continue;
    const logo = entry.carrier.carrier_logo;
    if (typeof logo === "string" && logo !== "") {
      entry.carrier.carrier_key = `${entry.slug}-${sha256Hex(logo).slice(0, 8)}`;
      entry.carrier.carrier_key_source = "slug_logo";
    }
  }

  return { carriers: pending.map((entry) => entry.carrier), errors };
}
