// LeadGen offer API-token vault — the operator pastes a provider token in the
// admin UI and NOTHING else happens by hand: no `wrangler secret put`, no
// wrangler.toml allowlist edit, no deploy. The value is encrypted with
// AES-256-GCM before it touches D1 and is decrypted only in the Worker, on the
// server side of a provider request.
//
// WHY a vault and not the legacy `api_token_secret_ref`: that column stores a
// wrangler secret NAME, so a token could only be configured by an engineer
// editing infrastructure and shipping a deploy (the name must ALSO be listed in
// LEADGEN_ALLOWED_OUTBOUND_SECRET_REFS, a wrangler.toml [vars] entry). The
// legacy path stays supported for rows that already use it — see
// resolveOfferApiToken's order — but no operator is ever asked for a name.
//
// KEY DERIVATION (never the raw secret as an AES key): HKDF-SHA256 over an
// existing ENCRYPTED Worker secret, with a fixed salt and a purpose-specific
// info string, so the derived encryption key is computationally independent of
// every other use of that secret. Two key sources are recognised, newest
// first, and each stored row records WHICH one sealed it (api_token_key_id):
//
//   lgok2  LEADGEN_OFFER_TOKEN_KEY     — a dedicated key, preferred when set
//   lgok1  LEADGEN_CONFIG_SIGNING_KEY  — already present in every environment
//
// So the feature works the moment this code deploys (lgok1), and adding a
// dedicated secret later needs no migration: new saves seal under lgok2 while
// lgok1 rows keep decrypting under lgok1. Rotating a key source WITHOUT
// re-saving makes those rows undecryptable by design — the resolution reports
// `key_missing`/`decrypt_failed` and the provider call fails CLOSED (never a
// tokenless request), and the operator re-pastes the token.
//
// The ciphertext format is the authored convention already used by the
// encrypted debug blobs (base64(iv) "." base64(ciphertext), 96-bit random IV).

import { readEnvSecret, type Env } from "../env";

/** Plaintext ceiling for an operator-pasted provider token. */
export const OFFER_API_TOKEN_VALUE_MAX = 1024;
/** Stored-blob ceiling: base64 of a 12-byte IV + ciphertext + 16-byte tag. */
export const OFFER_API_TOKEN_CIPHER_MAX = 2048;

export type OfferApiTokenKeyId = "lgok2" | "lgok1";

/** Newest key source first — encryption always seals under the first available. */
export const OFFER_API_TOKEN_KEY_IDS: readonly OfferApiTokenKeyId[] = ["lgok2", "lgok1"];

const KEY_SECRET_NAME: Readonly<Record<OfferApiTokenKeyId, string>> = {
  lgok2: "LEADGEN_OFFER_TOKEN_KEY",
  lgok1: "LEADGEN_CONFIG_SIGNING_KEY",
};

const HKDF_SALT = "leadgen.offer_api_token.salt.v1";
const HKDF_INFO = "leadgen.offer_api_token.aes256gcm.v1";

/** The three columns that make up a stored token. Never leaves the Worker. */
export interface OfferApiTokenVaultColumns {
  api_token_cipher: string | null;
  api_token_key_id: string | null;
}

export type OfferApiTokenFailureCode = "key_missing" | "cipher_malformed" | "decrypt_failed";

export type OfferApiTokenResolution =
  /** No token is stored on the row (the legacy secret_ref path may still apply). */
  | { kind: "absent" }
  | { kind: "stored"; value: string }
  | { kind: "failed"; code: OfferApiTokenFailureCode };

export type OfferApiTokenSealResult =
  | { ok: true; cipher: string; keyId: OfferApiTokenKeyId }
  | { ok: false; code: "key_missing" | "value_invalid" };

function isKeyId(value: unknown): value is OfferApiTokenKeyId {
  return value === "lgok2" || value === "lgok1";
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return undefined;
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    return undefined;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// HKDF-SHA256(secret) → a 256-bit AES-GCM key bound to THIS purpose. The raw
// secret is never used as key material directly, so the derived key cannot be
// used to attack (or be attacked through) the secret's other purpose.
async function deriveKey(
  env: Env,
  keyId: OfferApiTokenKeyId,
  usage: "encrypt" | "decrypt",
): Promise<CryptoKey | undefined> {
  const secret = readEnvSecret(env, KEY_SECRET_NAME[keyId]);
  if (secret === undefined) return undefined;
  const encoder = new TextEncoder();
  const ikm = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(HKDF_SALT),
      info: encoder.encode(HKDF_INFO),
    },
    ikm,
    256,
  );
  return crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, [usage]);
}

/** True when at least one key source is bound — i.e. a token CAN be stored. */
export function offerApiTokenVaultAvailable(env: Env): boolean {
  return OFFER_API_TOKEN_KEY_IDS.some((keyId) => readEnvSecret(env, KEY_SECRET_NAME[keyId]) !== undefined);
}

/**
 * Presence gate, no crypto: the row stores a token AND the key source that
 * sealed it is bound in THIS environment. Used where a boolean is all that is
 * wanted (payload previews decide whether to render a masked token node) — the
 * peer of using resolveAllowedOutboundSecretReference as a presence check for
 * the legacy path. It cannot detect a corrupt blob; only a real decrypt can,
 * and only the request path needs that.
 */
export function offerApiTokenSealed(env: Env, row: OfferApiTokenVaultColumns): boolean {
  const cipher = typeof row.api_token_cipher === "string" ? row.api_token_cipher.trim() : "";
  if (cipher === "" || !isKeyId(row.api_token_key_id)) return false;
  return readEnvSecret(env, KEY_SECRET_NAME[row.api_token_key_id]) !== undefined;
}

/**
 * Seal an operator-pasted token. Returns the ciphertext + the key id that
 * sealed it; both are stored, so decryption never has to guess. Absent every
 * key source the answer is `key_missing` — the caller MUST refuse the save
 * rather than store a plaintext token.
 */
export async function sealOfferApiToken(env: Env, plaintext: string): Promise<OfferApiTokenSealResult> {
  if (plaintext === "" || plaintext.length > OFFER_API_TOKEN_VALUE_MAX) {
    return { ok: false, code: "value_invalid" };
  }
  for (const keyId of OFFER_API_TOKEN_KEY_IDS) {
    const key = await deriveKey(env, keyId, "encrypt");
    if (key === undefined) continue;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext),
    );
    const cipher = `${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`;
    if (cipher.length > OFFER_API_TOKEN_CIPHER_MAX) return { ok: false, code: "value_invalid" };
    return { ok: true, cipher, keyId };
  }
  return { ok: false, code: "key_missing" };
}

/**
 * Resolve the token an offer row carries. `absent` means the row stores none —
 * callers then fall back to the legacy `api_token_secret_ref`. Every other
 * outcome is a typed failure: the provider request must proceed WITHOUT a token
 * only when the offer genuinely has none, never because decryption broke.
 */
export async function resolveOfferApiToken(
  env: Env,
  row: OfferApiTokenVaultColumns,
): Promise<OfferApiTokenResolution> {
  const cipher = typeof row.api_token_cipher === "string" ? row.api_token_cipher.trim() : "";
  if (cipher === "") return { kind: "absent" };
  if (!isKeyId(row.api_token_key_id)) return { kind: "failed", code: "cipher_malformed" };

  const parts = cipher.split(".");
  if (parts.length !== 2) return { kind: "failed", code: "cipher_malformed" };
  const iv = fromBase64(parts[0]!);
  const payload = fromBase64(parts[1]!);
  if (iv === undefined || iv.length !== 12 || payload === undefined || payload.length === 0) {
    return { kind: "failed", code: "cipher_malformed" };
  }

  const key = await deriveKey(env, row.api_token_key_id, "decrypt");
  if (key === undefined) return { kind: "failed", code: "key_missing" };
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, payload);
    const value = new TextDecoder().decode(plaintext);
    if (value === "") return { kind: "failed", code: "decrypt_failed" };
    return { kind: "stored", value };
  } catch {
    return { kind: "failed", code: "decrypt_failed" };
  }
}

/** Operator-facing message for a vault failure. Never names key material. */
export function offerApiTokenFailureMessage(code: OfferApiTokenFailureCode): string {
  if (code === "key_missing") return "the stored API token cannot be opened in this environment";
  if (code === "cipher_malformed") return "the stored API token is unreadable — re-enter it";
  return "the stored API token failed to decrypt — re-enter it";
}
