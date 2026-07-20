// LeadGen public-ID minting (contract 02 §6.1 "Entity overview" + §6.3 "ID
// glossary" prefixes — 02 is the normative prefix table; where the 01 §3
// summary disagrees, 02 governs).
//
// Every leadgen entity keeps INTEGER PRIMARY KEY AUTOINCREMENT for internal
// FKs and a stable `public_id TEXT UNIQUE` = <prefix> + ULID. The public_id
// is what macros, tracked events, and the leadgen_analytics_* mirror tables
// key on — it must be stable, unique, and time-sortable.
//
// The ULID implementation is SELF-CONTAINED (no npm dependency, mirroring
// src/listicles/ids.ts per contract 01 §3 "reuse verbatim, re-implement
// identically"): Crockford base32, 26 chars (10 time chars from the 48-bit
// unix-ms timestamp + 16 random chars from 80 bits of crypto.getRandomValues
// entropy). Crockford's alphabet is ASCII-ordered, so ids minted at
// increasing millisecond timestamps sort lexicographically in mint order
// (SQLite ORDER BY public_id == chronological).

export const PUBLIC_ID_PREFIXES = {
  offer: "lgo_",
  offer_placement: "lgpl_",
  payload_schema_version: "lgp_",
  offer_region_rule: "lgrr_",
  section: "lgs_",
  answer_field_map: "lgm_",
  quote: "lgq_",
  funnel: "lgf_",
  funnel_ab_test: "lgx_",
  funnel_variant: "lgn_",
  funnel_rule: "lgfr_",
  auction: "lga_",
  auction_rule: "lgar_",
  link_click: "lgl_",
  // Round-4 P3a (D-3 pages model): a Funnel Variant's page container. Slots
  // (leadgen_funnel_page_slots) carry no public id -- addressed by their
  // plain integer id, the same convention target_offer_id/target_section_id
  // already use on leadgen_funnel_rules.
  funnel_page: "lgpg_",
} as const;

export type PublicIdKind = keyof typeof PUBLIC_ID_PREFIXES;

// Crockford base32 — excludes I, L, O, U to avoid ambiguity. ASCII-ordered
// (digits < uppercase letters), which is what makes ULIDs sortable as text.
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const ULID_LENGTH = 26;
export const ULID_TIME_LENGTH = 10;
export const ULID_RANDOM_LENGTH = 16;

// 48-bit millisecond timestamp → 10 Crockford chars (most significant first).
function encodeTime(now: number): string {
  if (!Number.isFinite(now) || now < 0) {
    throw new Error(`ulid: invalid timestamp ${now}`);
  }
  let time = Math.floor(now);
  const chars: string[] = new Array<string>(ULID_TIME_LENGTH);
  for (let i = ULID_TIME_LENGTH - 1; i >= 0; i--) {
    chars[i] = CROCKFORD_ALPHABET.charAt(time % 32);
    time = Math.floor(time / 32);
  }
  return chars.join("");
}

// 80 bits of CSPRNG entropy → 16 Crockford chars (5 bits per char).
function encodeRandom(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let out = "";
  let buffer = 0;
  let bitCount = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      out += CROCKFORD_ALPHABET.charAt((buffer >>> (bitCount - 5)) & 31);
      bitCount -= 5;
    }
  }
  return out;
}

// Mint a bare ULID. `now` is injectable for tests (time-ordering proofs);
// production callers use the default clock.
export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

// Mint a prefixed public id for one of the fifteen leadgen entity kinds:
// lgo_ lgpl_ lgp_ lgrr_ lgs_ lgm_ lgq_ lgf_ lgx_ lgn_ lgfr_ lga_ lgar_ lgl_ lgpg_
// (contract 02 §6.1 + §6.3; lgpg_ added round4 P3a, D-3 pages model).
export function mintPublicId(kind: PublicIdKind, now: number = Date.now()): string {
  return PUBLIC_ID_PREFIXES[kind] + ulid(now);
}

// True when `value` looks like a public id of the given kind (prefix + a
// well-formed 26-char Crockford ULID). Used by handlers that accept either
// an internal numeric id or a public id in the :id route param (03 §8.1).
export function isPublicId(kind: PublicIdKind, value: string): boolean {
  const prefix = PUBLIC_ID_PREFIXES[kind];
  if (!value.startsWith(prefix)) return false;
  const rest = value.slice(prefix.length);
  if (rest.length !== ULID_LENGTH) return false;
  for (const ch of rest) {
    if (CROCKFORD_ALPHABET.indexOf(ch) < 0) return false;
  }
  return true;
}
