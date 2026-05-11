-- ==================================================================
-- Phase 3, T6 — restructure site_settings to (site_id, key) UNIQUE
-- ------------------------------------------------------------------
-- The Phase-1 schema declared site_settings(key PRIMARY KEY, value).
-- Phase 3 introduces per-site settings, so the table must grow a
-- nullable site_id column and the uniqueness must shift from a
-- bare `key` PK to the composite (site_id, key).
--
-- SQLite under D1 does not support ALTER TABLE DROP CONSTRAINT, and
-- the column-level PRIMARY KEY on `key` cannot be removed in place.
-- We therefore use the canonical D1-safe CREATE-INSERT-DROP-RENAME
-- pattern: build the target shape under a temporary name, copy rows
-- with site_id defaulted to NULL (the global tier), drop the legacy
-- table, then rename the new table into place. The (site_id, key)
-- read-path index is added by T7 (idx_settings_site_key).
-- ==================================================================

-- 1) Build the target shape under a temporary name. site_id is
--    nullable so the same key can exist once globally (site_id NULL)
--    and once per tenant (site_id = '<site>').
CREATE TABLE site_settings_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  UNIQUE(site_id, key)
);

-- 2) Migrate every pre-existing row into the new shape under the
--    global tier (site_id NULL). INSERT OR IGNORE protects the
--    UNIQUE(site_id, key) constraint if the legacy table ever held
--    a stray duplicate.
INSERT OR IGNORE INTO site_settings_new (site_id, key, value)
SELECT NULL, key, value FROM site_settings;

-- 3) Drop the legacy table. SQLite also drops any indexes that were
--    declared on the legacy (key, value) shape, so the forward-
--    declared idx_settings_site_key from migration 0002 (which is
--    structurally incompatible with the legacy shape anyway) is
--    cleared here. T7 re-creates idx_settings_site_key against the
--    new shape immediately after the rename.
DROP TABLE site_settings;

-- 4) Rename the new table into place. After this statement the live
--    table name is `site_settings` and its schema is
--    (id, site_id, key, value) with UNIQUE(site_id, key).
ALTER TABLE site_settings_new RENAME TO site_settings;

-- ==================================================================
-- Phase 3, T7 — idx_settings_site_key on the restructured site_settings
-- ------------------------------------------------------------------
-- After the rename above, `site_settings` carries the new
-- (id, site_id, key, value) shape with UNIQUE(site_id, key). The
-- per-site key/value read paths (admin Settings tab, public
-- site-context init, robots/ads-from-settings rendering) look rows up
-- by (site_id, key), so the planner needs a composite index leading
-- with site_id. We declare it here, immediately after the rename, so
-- the index is bound to the NEW table — the legacy table and any
-- indexes attached to it were dropped in step 3 above.
--
-- IF NOT EXISTS keeps re-applies idempotent: if a fresh local D1 has
-- already advanced the ledger past 0003 once, re-running the
-- migration set is a no-op for this statement.
-- ==================================================================
CREATE INDEX IF NOT EXISTS idx_settings_site_key ON site_settings(site_id, key);
