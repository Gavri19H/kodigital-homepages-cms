-- 0008_phase5_ai_generations.sql
-- Phase 5/6 AI -- recreate `ai_generations` with the typed receipts shape
-- the Phase-5 AI work needs (idempotency_key UNIQUE + 5-state status +
-- typed prompt/request/response columns) and add the receipts FK column
-- `ai_generation_id` to `media`.
--
-- Why a CREATE-INSERT-DROP-RENAME rebuild instead of ALTER:
--   * The legacy ai_generations from 0002_phase3_multi_site_schema.sql
--     declares an inline CHECK constraint on `status` that admits only
--     ('stub','completed','failed'). The new Phase-5 contract widens
--     this to five states ('pending','success','failed','fallback',
--     'skipped_no_api_key') and removes the legacy 'stub' literal. D1
--     (SQLite) has no ALTER TABLE DROP CONSTRAINT and no ALTER TABLE
--     ALTER COLUMN, so the CHECK constraint cannot be widened in place.
--   * The same rebuild also widens the column set from the original
--     Phase-3 stub shape (id/site_id/kind/model/prompt/response/status/
--     cost_cents/created_at -- 9 columns) to the Phase-5 typed-receipts
--     shape (16 columns including idempotency_key, task, provider,
--     prompt_version, request_json, response_json, parsed_json,
--     target_type, target_id, error_message, updated_at).
--   * The pattern mirrors 0003_phase3_site_settings_restructure.sql and
--     0007_phase3r_drop_global_slug_unique.sql -- both use
--     CREATE *_new -> INSERT *_new SELECT FROM old -> DROP old ->
--     ALTER TABLE *_new RENAME TO old, then re-create any indexes the
--     read paths rely on.
--
-- D1 / SQLite mechanics:
--   * D1 migrations run with `PRAGMA foreign_keys=OFF` by default. The
--     existing FK references from articles.ai_generation_id and
--     pages.ai_generation_id (both declared in 0002) point AT
--     ai_generations(id) BY NAME -- once the rename completes, the FK
--     target is back in place under the original table name with the
--     same TEXT PRIMARY KEY shape, so existing referencing rows remain
--     logically consistent and SQLite re-resolves the FK clause to the
--     rebuilt table.
--   * The legacy table only ever held 'stub' rows in Phase 3 (no real
--     OpenAI traffic). The INSERT step maps 'stub' -> 'success' (the
--     closest Phase-5 equivalent for a row that completed without an
--     error) and synthesises the new NOT NULL columns from the legacy
--     row's `kind` / `model` / created_at so the rebuild is loss-less
--     against existing data even though Phase-3 in practice never
--     wrote any rows.

-- ==================================================================
-- ai_generations -- rebuild with the Phase-5 typed-receipts shape
-- ==================================================================

-- 1) Target shape -- 16 columns. Names match the Phase-5 wire contract
--    used by api/src/ai/generation-log.ts (T6) and the admin list page
--    (T10). idempotency_key is the UNIQUE business key the CRUD layer
--    uses for lookup; status is restricted to the 5-state CHECK set.
CREATE TABLE ai_generations_v2 (
  id TEXT PRIMARY KEY,
  site_id TEXT REFERENCES sites(id) ON DELETE SET NULL,
  task TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'openai',
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_json TEXT,
  response_json TEXT,
  parsed_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN (
      'pending',
      'success',
      'failed',
      'fallback',
      'skipped_no_api_key'
    )
  ),
  target_type TEXT,
  target_id TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 2) Carry the Phase-3 stub rows forward. The legacy table holds at most
--    'stub' status rows; map them to 'success' since they completed
--    without an error. Each synthesised NOT NULL value is derived from a
--    legacy column so the rebuild is loss-less for any existing row.
INSERT OR IGNORE INTO ai_generations_v2 (
  id,
  site_id,
  task,
  provider,
  model,
  prompt_version,
  idempotency_key,
  request_json,
  response_json,
  parsed_json,
  status,
  target_type,
  target_id,
  error_message,
  created_at,
  updated_at
)
SELECT
  id,
  site_id,
  COALESCE(kind, 'unknown'),
  'openai',
  COALESCE(model, 'legacy-stub'),
  'legacy:v0',
  'legacy:' || id,
  prompt,
  response,
  NULL,
  CASE status WHEN 'stub' THEN 'success' WHEN 'completed' THEN 'success' ELSE status END,
  NULL,
  NULL,
  NULL,
  created_at,
  created_at
FROM ai_generations;

-- 3) Drop the legacy table. SQLite drops every index attached to the
--    table (including any hidden auto-index for the old CHECK shape).
DROP TABLE ai_generations;

-- 4) Rename the rebuilt table back into place. Existing FK references
--    from articles.ai_generation_id and pages.ai_generation_id resolve
--    against the new shape (FKs are resolved by table name).
ALTER TABLE ai_generations_v2 RENAME TO ai_generations;

-- 5) UNIQUE index on idempotency_key -- the CRUD layer (T6) uses this as
--    the lookup key for resume / replay safety. A separate index (rather
--    than an inline UNIQUE column-level constraint) keeps the column
--    declaration uniform with the other text columns and lets a future
--    migration drop / recreate the constraint via DROP INDEX without a
--    second table rebuild.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_generations_idempotency_key
  ON ai_generations(idempotency_key);

-- 6) Covering indexes for the admin /admin/ai-generations list page
--    (T10) and the per-site audit views. site_id leads each composite
--    so per-tenant scans hit the index, matching the Phase-3 covering-
--    index doctrine for every site-scoped table.
CREATE INDEX IF NOT EXISTS idx_ai_generations_site_created
  ON ai_generations(site_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_generations_status
  ON ai_generations(status);
CREATE INDEX IF NOT EXISTS idx_ai_generations_task
  ON ai_generations(task);
CREATE INDEX IF NOT EXISTS idx_ai_generations_target
  ON ai_generations(target_type, target_id);

-- ==================================================================
-- media -- add the ai_generation_id receipts FK column
-- ==================================================================
--
-- Phase 5/6 image generators (T8) write the R2 storage_key + a media
-- row for every generated logo / feature image. The media row carries
-- a receipts FK to the ai_generations entry that produced it so the
-- admin UI can drill from a media tile to the (redacted) request /
-- response that generated it. The column is nullable because human-
-- uploaded media items have no AI generation receipt.
ALTER TABLE media ADD COLUMN ai_generation_id TEXT REFERENCES ai_generations(id);
CREATE INDEX IF NOT EXISTS idx_media_ai_generation_id ON media(ai_generation_id);
