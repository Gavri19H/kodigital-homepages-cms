// LeadGen §8.3 / §24c — `GET /lg/attempt` (no-store) support: mint the
// per-session `funnel_attempt_id` + the HMAC-signed `signed_config_token` that
// binds the session to the exact funnel config it was served. These are
// session-specific and MUST NOT sit in the cacheable `/lg/config` (§24c); the
// client posts BOTH to `/lg/auction`, which re-validates the binding at P10
// (§30.4 / §19.1 anti-tampering).
//
// TOKEN FORMAT (self-contained WebCrypto HMAC-SHA256, mirroring src/preview's
// grep-auditable `subtle.sign("HMAC", …)` idiom — the preview module is
// article-specific, so this reuses the PATTERN, not its code):
//   signed:   "v2." + base64url(payloadJSON) + "." + base64url(HMAC_SHA256)
//   unsigned: "unsigned." + base64url(payloadJSON)          (no signature seg)
// The scheme prefix makes a token self-describing: an unsigned token can NEVER
// be mistaken for a signed one (the §30.4 "never ship unsigned as signed"
// rule). payloadJSON is the signed tuple, canonical key order (fix-contract
// v2.4 05 §5.3 — the R9 v2 extension), plus non-tuple DATA fields:
//   { funnel_variant_id, section_order_hash, content_version,
//     funnel_attempt_id, session_id, answer_mapping_hash,
//     auction_config_version, landing_url }
// `landing_url` is the 04 §4.2 ATTEMPT-CONTEXT carrier: the funnel page's
// ORIGINAL URL (from /lg/attempt's `u` query param, same-origin Referer
// fallback). The token IS the attempt-context store — no new tables. The
// traffic slice (utm_*, traffic_source, placement, sub1–5, cpc, fbclid; fbc
// derived) is persisted as this URL's query string and re-parsed at auction /
// click time by the ONE canonical reader (runtime-context.ts) from the
// VERIFIED payload — never from the auction request URL. The HMAC covers the
// whole payload, so the persisted traffic is integrity-protected too.
//
// LEGACY v1 GRACE (05 §5.3): `/lg/auction` accepts v2 always; a `v1.` token
// ({funnel_variant_id, section_order_hash, content_version,
// funnel_attempt_id}) is accepted ONLY while the dated deploy-grace flag
// `LEADGEN_ACCEPT_V1_TOKENS` is "true"/"1" (default off — off in tests), for
// in-flight sessions across the deploy. Minting is ALWAYS v2.
//
// SIGNING SECRET: `LEADGEN_CONFIG_SIGNING_KEY`, resolved via readEnvSecret
// (dynamic string-key lookup, like the listicles per-provider secrets — so no
// Env interface change is needed in this phase; infra/Stage-B provisions it).
//
// ABSENT-SECRET DECISION (reported): when the key is UNSET, mint an EXPLICIT
// `unsigned.` token (dev/local fallback so the funnel is testable) — it is
// self-labelled unsigned, never a fake signature. verifyConfigToken then
// FAILS CLOSED: with a secret configured, an `unsigned.` token is REJECTED
// (production never accepts unsigned); without a secret, only the `unsigned.`
// dev token whose tuple matches is accepted, and a signed token is rejected
// (nothing to verify against). Production (secret present) is always signed.

import type { Env } from "../../env";
import { readEnvSecret } from "../../env";
import { ulid } from "../../leadgen/ids";
import { sha256Hex } from "./auction/parse";
import type { ResolvedActivatedFunnel } from "./resolver";
import { computeSectionOrderHash } from "./config-dto";

export const LEADGEN_CONFIG_SIGNING_KEY_NAME = "LEADGEN_CONFIG_SIGNING_KEY";
// Dated deploy-grace flag (05 §5.3): v1 tokens verify only while this env var
// is "true"/"1". Default (absent) = off — off in tests by construction.
export const LEADGEN_ACCEPT_V1_TOKENS_NAME = "LEADGEN_ACCEPT_V1_TOKENS";

const SIGNED_SCHEME = "v2";
const LEGACY_SIGNED_SCHEME = "v1";
const UNSIGNED_SCHEME = "unsigned";

// The exact v2 tuple `/lg/auction` re-validates (05 §5.3). content_version is
// a number; every other field is a string ("" when the dimension is unknown
// at mint time — "" is still BOUND: the auction-side recomputation must also
// be "" or the token rejects).
export interface ConfigTokenTuple {
  funnel_variant_id: string;
  section_order_hash: string;
  content_version: number;
  funnel_attempt_id: string;
  // v2 additions (R9): the session, the ordered per-section answer-mapping
  // state, and the auction config version are now CRYPTO-bound.
  session_id: string;
  answer_mapping_hash: string;
  auction_config_version: string;
}

// The legacy v1 tuple shape (grace-flag verification only — never minted).
type ConfigTokenTupleV1 = Pick<
  ConfigTokenTuple,
  "funnel_variant_id" | "section_order_hash" | "content_version" | "funnel_attempt_id"
>;

export interface FunnelAttempt {
  funnel_attempt_id: string;
  signed_config_token: string;
}

// Request-derived attempt context threaded by the /lg/attempt route (04 §4.2):
// the ko_sid session cookie value and the funnel page's ORIGINAL URL (`u`
// param / same-origin Referer). Both optional — a caller without them (unit
// harnesses, the legacy serve.ts handler) binds "" for each.
export interface MintAttemptContext {
  session_id?: string;
  landing_url?: string;
}

// ---------------------------------------------------------------------------
// base64url + WebCrypto HMAC-SHA256 (self-contained; src/preview idiom)
// ---------------------------------------------------------------------------

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function hmacSha256(secret: string, data: Uint8Array): Promise<Uint8Array> {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return new Uint8Array(sig);
}

// Constant-time byte compare (length-checked). Reusable by P10's `/lg/auction`
// validator — never short-circuits on the first differing byte.
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i]! ^ b[i]!);
  return diff === 0;
}

// Canonical payload serialization — FIXED key order so mint + any re-sign
// produce byte-identical payloads. The non-tuple `landing_url` DATA field
// (04 §4.2 attempt context) rides LAST, inside the signed bytes.
function serializePayload(tuple: ConfigTokenTuple, landingUrl: string): Uint8Array {
  const json = JSON.stringify({
    funnel_variant_id: tuple.funnel_variant_id,
    section_order_hash: tuple.section_order_hash,
    content_version: tuple.content_version,
    funnel_attempt_id: tuple.funnel_attempt_id,
    session_id: tuple.session_id,
    answer_mapping_hash: tuple.answer_mapping_hash,
    auction_config_version: tuple.auction_config_version,
    landing_url: landingUrl,
  });
  return new TextEncoder().encode(json);
}

// ---------------------------------------------------------------------------
// funnel_attempt_id
// ---------------------------------------------------------------------------

// A fresh per-funnel-pass ephemeral id. Deliberately NOT one of the 14 `lg_`
// entity public-id kinds (never minted via mintPublicId): it keys a session's
// auction suppression + result log, not a CMS entity. Shape: "att_" + ULID
// (time-sortable, 26 Crockford chars).
export function mintFunnelAttemptId(now: number = Date.now()): string {
  return `att_${ulid(now)}`;
}

// ---------------------------------------------------------------------------
// v2 binding extras (05 §5.3 — computed server-side at mint AND at verify)
// ---------------------------------------------------------------------------

export interface AttemptBindingExtras {
  // SHA-256 over the ORDERED per-section answer_mapping_versions of the
  // resolved variant. A section's answer_mapping_version :=
  // COALESCE(MAX(leadgen_section_answer_maps.id), 0) — the table carries no
  // dedicated version column (its rows are replace-set re-inserted on every
  // mapping save, so MAX(id) is a strictly-monotonic per-section version that
  // bumps on any remap; 05 §5.4's config-dto population reads the same table).
  answer_mapping_hash: string;
  // The variant's auction version proxy: leadgen_auctions.
  // carrier_normalization_version (the only per-auction version column — the
  // same proxy validateAntiTamper's legacy equality check reconciles). "" when
  // the variant has no auction.
  auction_config_version: string;
}

// Compute the v2 tuple extras from typed state. DB-optional + fail-open BY
// SYMMETRY: mint and verify both call THIS function on the same env, so a
// degraded read (no DB in a unit harness) binds the same value it later
// expects — never a spurious tamper.
export async function computeAttemptBindingExtras(
  env: Env,
  resolved: ResolvedActivatedFunnel,
): Promise<AttemptBindingExtras> {
  const db = (env as { DB?: D1Database }).DB;

  // Ordered per-section answer-mapping versions (0 when unmapped/unreadable).
  const versionBySection = new Map<number, number>();
  const sectionIds = resolved.sections.map((s) => s.section.id);
  if (db !== undefined && sectionIds.length > 0) {
    try {
      // Chunked IN(?) ≤80 (D1 100-binding rule).
      for (let i = 0; i < sectionIds.length; i += 80) {
        const ids = sectionIds.slice(i, i + 80);
        const marks = ids.map(() => "?").join(",");
        const rows = await db
          .prepare(
            `SELECT section_id, COALESCE(MAX(id), 0) AS v FROM leadgen_section_answer_maps WHERE section_id IN (${marks}) GROUP BY section_id`,
          )
          .bind(...ids)
          .all<{ section_id: number; v: number }>();
        for (const r of rows.results ?? []) versionBySection.set(r.section_id, r.v);
      }
    } catch {
      versionBySection.clear(); // degrade to all-0 (mint/verify symmetric)
    }
  }
  const orderedVersions = resolved.sections.map((s) => String(versionBySection.get(s.section.id) ?? 0));
  const answer_mapping_hash = sha256Hex(JSON.stringify(orderedVersions));

  let auction_config_version = "";
  if (db !== undefined && resolved.variant.auction_id !== null) {
    try {
      const row = await db
        .prepare("SELECT carrier_normalization_version FROM leadgen_auctions WHERE id = ? LIMIT 1")
        .bind(resolved.variant.auction_id)
        .first<{ carrier_normalization_version: number }>();
      if (row !== null) auction_config_version = String(row.carrier_normalization_version);
    } catch {
      auction_config_version = "";
    }
  }
  return { answer_mapping_hash, auction_config_version };
}

// ---------------------------------------------------------------------------
// mint + verify
// ---------------------------------------------------------------------------

// Build a token string for a payload. Signed when a secret is provided; an
// explicit `unsigned.` token otherwise (never a fake signature).
async function buildToken(
  secret: string | undefined,
  tuple: ConfigTokenTuple,
  landingUrl: string,
): Promise<string> {
  const payload = serializePayload(tuple, landingUrl);
  const payloadSeg = base64UrlEncode(payload);
  if (secret === undefined) {
    return `${UNSIGNED_SCHEME}.${payloadSeg}`;
  }
  const sig = await hmacSha256(secret, payload);
  return `${SIGNED_SCHEME}.${payloadSeg}.${base64UrlEncode(sig)}`;
}

// True when a token is a signed (`v2.` — or legacy `v1.`) token — a cheap
// scheme check for callers that want to assert signing without re-verifying.
export function isSignedToken(token: string): boolean {
  return token.startsWith(`${SIGNED_SCHEME}.`) || token.startsWith(`${LEGACY_SIGNED_SCHEME}.`);
}

// §8.3/§24c: mint `{ funnel_attempt_id, signed_config_token }` for a resolved
// funnel. The token binds the v2 tuple `/lg/auction` re-validates; the
// section_order_hash is computed by the SAME builder the config DTO uses
// (config-dto.computeSectionOrderHash) and the mapping/auction versions by the
// SAME computeAttemptBindingExtras the verifier uses, so the token can never
// bind a value the server-side recomputation doesn't reproduce.
export async function mintFunnelAttempt(
  env: Env,
  resolved: ResolvedActivatedFunnel,
  now: number = Date.now(),
  ctx?: MintAttemptContext,
): Promise<FunnelAttempt> {
  const secret = readEnvSecret(env, LEADGEN_CONFIG_SIGNING_KEY_NAME);
  const funnel_attempt_id = mintFunnelAttemptId(now);
  const extras = await computeAttemptBindingExtras(env, resolved);
  const tuple: ConfigTokenTuple = {
    funnel_variant_id: resolved.variant.public_id,
    section_order_hash: computeSectionOrderHash(resolved),
    content_version: resolved.variant.content_version,
    funnel_attempt_id,
    session_id: ctx?.session_id ?? "",
    answer_mapping_hash: extras.answer_mapping_hash,
    auction_config_version: extras.auction_config_version,
  };
  const signed_config_token = await buildToken(secret, tuple, ctx?.landing_url ?? "");
  return { funnel_attempt_id, signed_config_token };
}

// The decoded signed payload: the v2 tuple + the landing_url data field.
interface DecodedPayloadV2 {
  tuple: ConfigTokenTuple;
  landing_url: string;
}

function decodePayloadJson(payloadSeg: string): Record<string, unknown> | null {
  let bytes: Uint8Array;
  try {
    bytes = base64UrlDecode(payloadSeg);
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  return parsed as Record<string, unknown>;
}

function decodeTupleV2(payloadSeg: string): DecodedPayloadV2 | null {
  const p = decodePayloadJson(payloadSeg);
  if (p === null) return null;
  // L-124-style hardening: validate each claim by type, never truthiness.
  if (typeof p["funnel_variant_id"] !== "string") return null;
  if (typeof p["section_order_hash"] !== "string") return null;
  if (typeof p["content_version"] !== "number" || !Number.isFinite(p["content_version"])) return null;
  if (typeof p["funnel_attempt_id"] !== "string") return null;
  if (typeof p["session_id"] !== "string") return null;
  if (typeof p["answer_mapping_hash"] !== "string") return null;
  if (typeof p["auction_config_version"] !== "string") return null;
  return {
    tuple: {
      funnel_variant_id: p["funnel_variant_id"],
      section_order_hash: p["section_order_hash"],
      content_version: p["content_version"],
      funnel_attempt_id: p["funnel_attempt_id"],
      session_id: p["session_id"],
      answer_mapping_hash: p["answer_mapping_hash"],
      auction_config_version: p["auction_config_version"],
    },
    landing_url: typeof p["landing_url"] === "string" ? p["landing_url"] : "",
  };
}

function decodeTupleV1(payloadSeg: string): ConfigTokenTupleV1 | null {
  const p = decodePayloadJson(payloadSeg);
  if (p === null) return null;
  // Downgrade hardening: the HMAC covers the payload bytes only (not the
  // scheme prefix), so a valid v2 token re-labelled `v1.` would verify and
  // then skip the 3 v2-only equality checks under the grace flag. A payload
  // carrying ANY v2-only key is therefore NOT a v1 token — reject it.
  for (const v2OnlyKey of ["session_id", "answer_mapping_hash", "auction_config_version", "landing_url"]) {
    if (p[v2OnlyKey] !== undefined) return null;
  }
  if (typeof p["funnel_variant_id"] !== "string") return null;
  if (typeof p["section_order_hash"] !== "string") return null;
  if (typeof p["content_version"] !== "number" || !Number.isFinite(p["content_version"])) return null;
  if (typeof p["funnel_attempt_id"] !== "string") return null;
  return {
    funnel_variant_id: p["funnel_variant_id"],
    section_order_hash: p["section_order_hash"],
    content_version: p["content_version"],
    funnel_attempt_id: p["funnel_attempt_id"],
  };
}

function tupleEqualsV2(a: ConfigTokenTuple, b: ConfigTokenTuple): boolean {
  return (
    a.funnel_variant_id === b.funnel_variant_id &&
    a.section_order_hash === b.section_order_hash &&
    a.content_version === b.content_version &&
    a.funnel_attempt_id === b.funnel_attempt_id &&
    a.session_id === b.session_id &&
    a.answer_mapping_hash === b.answer_mapping_hash &&
    a.auction_config_version === b.auction_config_version
  );
}

function tupleEqualsV1(a: ConfigTokenTupleV1, b: ConfigTokenTuple): boolean {
  return (
    a.funnel_variant_id === b.funnel_variant_id &&
    a.section_order_hash === b.section_order_hash &&
    a.content_version === b.content_version &&
    a.funnel_attempt_id === b.funnel_attempt_id
  );
}

function v1GraceEnabled(env: Env): boolean {
  const flag = readEnvSecret(env, LEADGEN_ACCEPT_V1_TOKENS_NAME) ?? "";
  return flag === "true" || flag === "1";
}

export interface ConfigTokenVerification {
  ok: boolean;
  // The VERIFIED attempt-context landing URL (04 §4.2) — "" on failure, on a
  // v1 grace token (v1 carries no attempt context), and when the mint had none.
  landing_url: string;
}

const VERIFY_FAIL: ConfigTokenVerification = { ok: false, landing_url: "" };

// Verify a token against the EXACT expected v2 tuple and return the verified
// attempt-context payload (the auction path reads `landing_url` from HERE —
// never from its own request URL). Fails closed:
//   • `v2.` (signed): requires the secret; recomputes the HMAC over the
//     token's own payload bytes and constant-time-compares it to the token
//     signature, AND requires the decoded tuple to equal `expectedTuple`.
//   • `v1.` (legacy): accepted ONLY behind the LEADGEN_ACCEPT_V1_TOKENS grace
//     flag (default off); same HMAC discipline; equality over the 4 v1 fields.
//   • `unsigned.`: rejected when a secret is configured (production) or when
//     requireSigned; accepted in dev (no secret) ONLY when the decoded v2
//     tuple equals `expectedTuple`.
// Any tampered field (the 7 bound dimensions) breaks either the signature
// match or the tuple equality → reject.
export async function verifyConfigTokenDetailed(
  env: Env,
  token: string,
  expectedTuple: ConfigTokenTuple,
  opts?: { requireSigned?: boolean },
): Promise<ConfigTokenVerification> {
  const secret = readEnvSecret(env, LEADGEN_CONFIG_SIGNING_KEY_NAME);
  const parts = token.split(".");

  if (parts[0] === UNSIGNED_SCHEME) {
    // `requireSigned` FAILS CLOSED on the money path (`/lg/auction`): an
    // unsigned token is rejected regardless of secret presence, so a prod
    // deploy that forgot LEADGEN_CONFIG_SIGNING_KEY can NEVER silently void
    // anti-tamper (it would reject all auctions instead of accepting forged
    // bindings). The unsigned-accept branch below is the dev/local path only.
    if (opts?.requireSigned) return VERIFY_FAIL;
    if (parts.length !== 2) return VERIFY_FAIL;
    if (secret !== undefined) return VERIFY_FAIL; // production never accepts unsigned
    const decoded = decodeTupleV2(parts[1]!);
    if (decoded === null || !tupleEqualsV2(decoded.tuple, expectedTuple)) return VERIFY_FAIL;
    return { ok: true, landing_url: decoded.landing_url };
  }

  if (parts[0] === SIGNED_SCHEME || parts[0] === LEGACY_SIGNED_SCHEME) {
    const isLegacy = parts[0] === LEGACY_SIGNED_SCHEME;
    if (isLegacy && !v1GraceEnabled(env)) return VERIFY_FAIL; // v1 only behind the dated grace flag
    if (parts.length !== 3) return VERIFY_FAIL;
    if (secret === undefined) return VERIFY_FAIL; // nothing to verify against
    const payloadSeg = parts[1]!;
    const sigSeg = parts[2]!;
    let tokenSig: Uint8Array;
    let payloadBytes: Uint8Array;
    try {
      tokenSig = base64UrlDecode(sigSeg);
      payloadBytes = base64UrlDecode(payloadSeg);
    } catch {
      return VERIFY_FAIL;
    }
    const expectedSig = await hmacSha256(secret, payloadBytes);
    if (!timingSafeEqualBytes(expectedSig, tokenSig)) return VERIFY_FAIL;
    if (isLegacy) {
      const decoded = decodeTupleV1(payloadSeg);
      if (decoded === null || !tupleEqualsV1(decoded, expectedTuple)) return VERIFY_FAIL;
      return { ok: true, landing_url: "" }; // v1 carries no attempt context
    }
    const decoded = decodeTupleV2(payloadSeg);
    if (decoded === null || !tupleEqualsV2(decoded.tuple, expectedTuple)) return VERIFY_FAIL;
    return { ok: true, landing_url: decoded.landing_url };
  }

  return VERIFY_FAIL;
}

// Boolean projection of verifyConfigTokenDetailed — the historical signature
// (P10 engine + tests). Same fail-closed semantics.
export async function verifyConfigToken(
  env: Env,
  token: string,
  expectedTuple: ConfigTokenTuple,
  opts?: { requireSigned?: boolean },
): Promise<boolean> {
  return (await verifyConfigTokenDetailed(env, token, expectedTuple, opts)).ok;
}
