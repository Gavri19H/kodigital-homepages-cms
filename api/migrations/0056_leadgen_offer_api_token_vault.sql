-- LeadGen offer API-token vault. The operator pastes a provider token in the
-- admin UI; it is sealed with AES-256-GCM (HKDF-derived key, see
-- src/leadgen/offer-api-token.ts) BEFORE it reaches D1 and is opened only in
-- the Worker. No wrangler secret, no wrangler.toml allowlist entry, no deploy.
--
-- Additive and nullable: the legacy `api_token_secret_ref` column keeps working
-- for any row that already uses it (resolution prefers the vault).
--
--   api_token_cipher      base64(iv) "." base64(ciphertext) — NEVER returned by
--                         any API response or rendered into any page.
--   api_token_key_id      which key source sealed the row ('lgok2' dedicated
--                         key / 'lgok1' derived from LEADGEN_CONFIG_SIGNING_KEY),
--                         so decryption never guesses and a later dedicated key
--                         needs no migration.
--   api_token_updated_at  unix seconds of the last paste — the ONLY token fact
--                         the admin UI displays.
ALTER TABLE leadgen_offers ADD COLUMN api_token_cipher TEXT;
ALTER TABLE leadgen_offers ADD COLUMN api_token_key_id TEXT;
ALTER TABLE leadgen_offers ADD COLUMN api_token_updated_at INTEGER;
