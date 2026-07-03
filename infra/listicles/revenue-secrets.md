# Listicles Phase 9 — revenue-pipeline secrets

The Phase-9 revenue pipeline (§19 inbound postbacks, §20 outbound S2S) uses ONLY
**encrypted Cloudflare Worker secrets** — set with `wrangler secret put`
(Dashboard / CI only), exactly like the AWS + ClickHouse credentials. **None of
these appear in `api/wrangler.toml`** (`[vars]` there is CI-overwritten and
world-readable). They are typed *optional* in `api/src/env.ts`, so the whole
revenue pipeline is **inert-safe**: absent a secret, that leg no-ops (a postback
`401`s, an S2S pixel is skipped) — never a hard failure, never a fake success.

Everything below is inert until BOTH the secret is set AND (for CH-dependent
legs) the ClickHouse secrets from `clickhouse-apply.md` are present.

---

## 1. Inbound postback shared secrets — `LISTICLE_PB_TOKEN_<PROVIDER>`

`POST /api/pb/:provider` authenticates each revenue provider with a per-provider
shared secret. `<PROVIDER>` is the **uppercased** `:provider` path segment.

| Route | Adapter | Secret name |
|---|---|---|
| `POST /api/pb/generic` | generic (standard fields + aliases) | `LISTICLE_PB_TOKEN_GENERIC` |
| `POST /api/pb/capi`    | CAPI-style (sub1→click_id, event_id→dedupe) | `LISTICLE_PB_TOKEN_CAPI` |

- The provider presents the token as the `X-Postback-Token` header (preferred)
  or a `?token=` query param. Compared **constant-time**.
- **No secret for a provider ⇒ every postback to it `401`s** (unverifiable) — it
  is never silently accepted.
- **Unknown provider ⇒ `404`.** A provider is "known" only if it has an entry in
  `POSTBACK_ADAPTERS` (a §24 posture — no open ingestion of arbitrary strings).
  A NEW revenue provider on the generic shape needs only: (a) its secret, and
  (b) a one-line `POSTBACK_ADAPTERS` alias to `genericAdapter` (a bespoke shape
  needs a small adapter). Then set its `LISTICLE_PB_TOKEN_<PROVIDER>`.

```bash
# from api/ :
npx wrangler secret put LISTICLE_PB_TOKEN_GENERIC
npx wrangler secret put LISTICLE_PB_TOKEN_CAPI
# staging / production:
npx wrangler secret put LISTICLE_PB_TOKEN_GENERIC --env staging
npx wrangler secret put LISTICLE_PB_TOKEN_GENERIC --env production
```

Generate a strong random token and give the SAME value to the provider's
postback config, e.g. `openssl rand -hex 32`.

---

## 2. Outbound S2S platform tokens — `LISTICLE_S2S_TOKEN_<PLATFORM>`

§20 fires an outbound pixel back to the media platform on a matched conversion.
Each `listicle_media_platforms` row names its token secret in its
`auth_secret_ref` column (the **NAME only** — the token value never enters the
D1 table or any admin response). Convention: `LISTICLE_S2S_TOKEN_<PLATFORM>`.

| Platform | Secret name (row `auth_secret_ref`) |
|---|---|
| facebook | `LISTICLE_S2S_TOKEN_FACEBOOK` |
| newsbreak / taboola / outbrain / google | `LISTICLE_S2S_TOKEN_NEWSBREAK`, `…_TABOOLA`, `…_OUTBRAIN`, `…_GOOGLE` |

- The token is exposed to the platform's `postback_url_template` as the
  `{auth_token}` macro (alongside `{click_id} {fbc} {fbclid} {value} {currency}
  {event_name}`), so the operator decides placement (query param / path).
- **No secret ⇒ `{auth_token}` resolves empty**; the pixel fires tokenless per
  its template (a failure is logged, never blocks ingestion).

```bash
npx wrangler secret put LISTICLE_S2S_TOKEN_FACEBOOK
npx wrangler secret put LISTICLE_S2S_TOKEN_FACEBOOK --env production
```

### Enabling a platform

Facebook is **seeded disabled** (`enabled=0`) by the daily maintenance run, so
nothing fires until an operator configures it. Manage platforms via the admin
JSON CRUD (Cloudflare-Access gated, `ADMIN_HOST` only):

```bash
# create (enabled=0 by default):
curl -X POST https://<ADMIN_HOST>/api/admin/listicles/media-platforms \
  -H 'content-type: application/json' \
  -d '{"platform":"facebook",
       "postback_url_template":"https://www.facebook.com/tr?ev={event_name}&cd[click_id]={click_id}&cd[fbc]={fbc}&cd[value]={value}&cd[currency]={currency}",
       "auth_secret_ref":"LISTICLE_S2S_TOKEN_FACEBOOK","event_name":"Purchase"}'

# enable once the token secret is set + the template is your real endpoint:
curl -X PATCH https://<ADMIN_HOST>/api/admin/listicles/media-platforms/facebook \
  -H 'content-type: application/json' -d '{"enabled":true}'
```

`auth_secret_ref` MUST be a secret **NAME** (`UPPER_SNAKE`); the CRUD rejects a
value-looking string so a raw token can never be persisted.

---

## 3. Currency / FX (§31.7)

Currency normalization reads the daily `listicle_fx_rates` table. **No live
FX-rate provider is wired** in this repo — the daily refresh seeds the `USD`
identity (`usd_rate=1`) only, so USD revenue always normalizes and non-USD
revenue stores native `revenue` + a `NULL revenue_usd` (flagged for backfill)
until a rate is seeded. To add rates without code: either seed rows directly, or
inject a static/adapter map at `refreshFxRates(env, { seededRates })`.

```bash
# seed a day's rates directly (USD-per-unit-of-currency):
npx wrangler d1 execute kodigital-homepages-cms-db --remote \
  --command "INSERT OR IGNORE INTO listicle_fx_rates (date,currency,usd_rate) VALUES ('2026-07-02','EUR',1.08),('2026-07-02','GBP',1.27)"
```

---

## 4. Inert-until-configured summary

| Leg | Requires | Absent behavior |
|---|---|---|
| Inbound postback auth | `LISTICLE_PB_TOKEN_<PROVIDER>` | `401` (never accepted) |
| Inbound → matched S2S / conversion-cap | CH secrets + click landed in CH | queued unmatched; no S2S/cap on the postback path |
| Browser conversion → S2S / in-site payout | an enabled `listicle_media_platforms` row (+ token) | no pixel; in-site payout still records if `payout_method='in_site'` |
| Outbound S2S token | `LISTICLE_S2S_TOKEN_<PLATFORM>` | tokenless fire per template |
| D1→CH revenue shipper / re-match / MV backfill | CH secrets (`clickhouse-apply.md`) | logged no-op; `revenue_raw` still staged in D1 |
| Non-USD `revenue_usd` | a `listicle_fx_rates` row | native stored, `revenue_usd` NULL (backfill) |
| Provider report/API channel (§19 script) | a configured report adapter | structured no-op (framework awaiting a source) |
