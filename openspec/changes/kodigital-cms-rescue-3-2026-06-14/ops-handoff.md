# Operator Ops Tasks — ship hand-off (kodigital-cms-rescue-3-2026-06-14)

These are operator-owned configuration steps that are NOT develop code.
The pipeline records them here; execution owner is the user (per
write-boundaries.md W4 `ops_execution_owner=user`). Verify before go-live.

## OPS-TASK-1 — Set `PREVIEW_SECRET` (T20-AC2 hand-off)

- **owner:** user
- **kind:** Cloudflare Worker secret (encrypted; Dashboard / wrangler only —
  MUST NOT appear in `wrangler.toml`, `.dev.vars`, or any committed file per
  deploy-safety.md).
- **why:** `GET /preview/:id` (api/src/preview/index.ts:116-119) requires
  `env.PREVIEW_SECRET` to verify the HMAC preview token. When the secret is
  unset the handler returns `500 {"error":"Preview is not configured"}`. The
  draft-render itself is ALREADY coded and correct — it emits
  `Cache-Control: private, no-store` + `X-Robots-Tag: noindex, nofollow`
  (api/src/preview/index.ts:147-150), so NO develop code is needed for the
  secret; only the operator configuration is outstanding.
- **command (user runs — pipeline MUST NOT run `wrangler secret put`):**
  ```
  npx wrangler secret put PREVIEW_SECRET
  ```
  Use the same HMAC secret value that mints preview links via
  `POST /api/admin/articles/:id/preview-link`.
- **verify after setting:** mint a preview link in the admin UI, open
  `/preview/:id?token=…`, confirm the draft renders (HTTP 200, not 500) and
  the response carries `X-Robots-Tag: noindex, nofollow` +
  `Cache-Control: private, no-store`.
