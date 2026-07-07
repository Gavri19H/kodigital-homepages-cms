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
//   signed:   "v1." + base64url(payloadJSON) + "." + base64url(HMAC_SHA256)
//   unsigned: "unsigned." + base64url(payloadJSON)          (no signature seg)
// The scheme prefix makes a token self-describing: an unsigned token can NEVER
// be mistaken for a signed one (the §30.4 "never ship unsigned as signed"
// rule). payloadJSON is the signed tuple, canonical key order:
//   { funnel_variant_id, section_order_hash, content_version, funnel_attempt_id }
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
// dev token whose tuple matches is accepted, and a `v1.` token is rejected
// (nothing to verify against). Production (secret present) is always signed.

import type { Env } from "../../env";
import { readEnvSecret } from "../../env";
import { ulid } from "../../leadgen/ids";
import type { ResolvedActivatedFunnel } from "./resolver";
import { computeSectionOrderHash } from "./config-dto";

export const LEADGEN_CONFIG_SIGNING_KEY_NAME = "LEADGEN_CONFIG_SIGNING_KEY";

const SIGNED_SCHEME = "v1";
const UNSIGNED_SCHEME = "unsigned";

// The exact tuple `/lg/auction` re-validates at P10 (§30.4). content_version is
// a number; the other three are strings.
export interface ConfigTokenTuple {
  funnel_variant_id: string;
  section_order_hash: string;
  content_version: number;
  funnel_attempt_id: string;
}

export interface FunnelAttempt {
  funnel_attempt_id: string;
  signed_config_token: string;
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

// Canonical tuple serialization — FIXED key order so mint + any re-sign produce
// byte-identical payloads.
function serializeTuple(tuple: ConfigTokenTuple): Uint8Array {
  const json = JSON.stringify({
    funnel_variant_id: tuple.funnel_variant_id,
    section_order_hash: tuple.section_order_hash,
    content_version: tuple.content_version,
    funnel_attempt_id: tuple.funnel_attempt_id,
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
// mint + verify
// ---------------------------------------------------------------------------

// Build a token string for a tuple. Signed when a secret is provided; an
// explicit `unsigned.` token otherwise (never a fake signature).
async function buildToken(secret: string | undefined, tuple: ConfigTokenTuple): Promise<string> {
  const payload = serializeTuple(tuple);
  const payloadSeg = base64UrlEncode(payload);
  if (secret === undefined) {
    return `${UNSIGNED_SCHEME}.${payloadSeg}`;
  }
  const sig = await hmacSha256(secret, payload);
  return `${SIGNED_SCHEME}.${payloadSeg}.${base64UrlEncode(sig)}`;
}

// True when a token is a signed (`v1.`) token — a cheap scheme check for
// callers that want to assert signing without re-verifying.
export function isSignedToken(token: string): boolean {
  return token.startsWith(`${SIGNED_SCHEME}.`);
}

// §8.3/§24c: mint `{ funnel_attempt_id, signed_config_token }` for a resolved
// funnel. The token binds the tuple `/lg/auction` re-validates at P10; the
// section_order_hash is computed by the SAME builder the config DTO uses
// (config-dto.computeSectionOrderHash), so the token can never bind a hash the
// client's config doesn't carry.
export async function mintFunnelAttempt(
  env: Env,
  resolved: ResolvedActivatedFunnel,
  now: number = Date.now(),
): Promise<FunnelAttempt> {
  const secret = readEnvSecret(env, LEADGEN_CONFIG_SIGNING_KEY_NAME);
  const funnel_attempt_id = mintFunnelAttemptId(now);
  const tuple: ConfigTokenTuple = {
    funnel_variant_id: resolved.variant.public_id,
    section_order_hash: computeSectionOrderHash(resolved),
    content_version: resolved.variant.content_version,
    funnel_attempt_id,
  };
  const signed_config_token = await buildToken(secret, tuple);
  return { funnel_attempt_id, signed_config_token };
}

function decodeTuple(payloadSeg: string): ConfigTokenTuple | null {
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
  const p = parsed as Record<string, unknown>;
  // L-124-style hardening: validate each claim by type, never truthiness.
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

function tupleEquals(a: ConfigTokenTuple, b: ConfigTokenTuple): boolean {
  return (
    a.funnel_variant_id === b.funnel_variant_id &&
    a.section_order_hash === b.section_order_hash &&
    a.content_version === b.content_version &&
    a.funnel_attempt_id === b.funnel_attempt_id
  );
}

// Verify a token against the EXACT expected tuple (P10 reuses this at
// `/lg/auction`). Fails closed:
//   • `v1.` (signed): requires the secret; recomputes the HMAC over the token's
//     own payload bytes and constant-time-compares it to the token signature,
//     AND requires the decoded tuple to equal `expectedTuple`.
//   • `unsigned.`: rejected when a secret is configured (production); accepted
//     in dev (no secret) ONLY when the decoded tuple equals `expectedTuple`.
// Any tampered field (variant id, hash, content_version, attempt id) breaks
// either the signature match or the tuple equality → false.
export async function verifyConfigToken(
  env: Env,
  token: string,
  expectedTuple: ConfigTokenTuple,
  opts?: { requireSigned?: boolean },
): Promise<boolean> {
  const secret = readEnvSecret(env, LEADGEN_CONFIG_SIGNING_KEY_NAME);
  const parts = token.split(".");

  if (parts[0] === UNSIGNED_SCHEME) {
    // `requireSigned` FAILS CLOSED on the money path (`/lg/auction`): an
    // unsigned token is rejected regardless of secret presence, so a prod
    // deploy that forgot LEADGEN_CONFIG_SIGNING_KEY can NEVER silently void
    // anti-tamper (it would reject all auctions instead of accepting forged
    // bindings). The unsigned-accept branch below is the dev/local path only.
    if (opts?.requireSigned) return false;
    if (parts.length !== 2) return false;
    if (secret !== undefined) return false; // production never accepts unsigned
    const decoded = decodeTuple(parts[1]!);
    return decoded !== null && tupleEquals(decoded, expectedTuple);
  }

  if (parts[0] === SIGNED_SCHEME) {
    if (parts.length !== 3) return false;
    if (secret === undefined) return false; // nothing to verify against
    const payloadSeg = parts[1]!;
    const sigSeg = parts[2]!;
    let tokenSig: Uint8Array;
    let payloadBytes: Uint8Array;
    try {
      tokenSig = base64UrlDecode(sigSeg);
      payloadBytes = base64UrlDecode(payloadSeg);
    } catch {
      return false;
    }
    const expectedSig = await hmacSha256(secret, payloadBytes);
    if (!timingSafeEqualBytes(expectedSig, tokenSig)) return false;
    const decoded = decodeTuple(payloadSeg);
    return decoded !== null && tupleEquals(decoded, expectedTuple);
  }

  return false;
}
