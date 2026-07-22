-- 0046_leadgen_rework_m1_variants.sql
-- LeadGen Rework P1 · M1 (contract §5-M1, §4.3-10 "no control concept anywhere").
--
-- Drops `is_control` from leadgen_funnel_variants. Selection semantics move to
-- §4.3-10: with no running test a funnel has exactly one active variant
-- (validation enforces this), so a "control" flag is meaningless in the new
-- model. A/B/C are plain variant_label values (validation-level, later slices).
--
-- CHECK/column-set change ⇒ FULL-TABLE RECREATION per
-- .claude/rules/d1-database-safety.md: CREATE new → INSERT OR IGNORE with
-- EXPLICIT ids (PKs preserved so every inbound FK stays valid) → DROP old →
-- RENAME → re-create every index.
--
-- SAFETY of the DROP/RENAME (verified before authoring):
--   * D1 applies migrations with `PRAGMA foreign_keys=OFF` (repo-documented in
--     0007/0008) — the inbound FKs (leadgen_funnel_pages.variant_id,
--     leadgen_funnel_variant_sections.variant_id, leadgen_funnel_rules.variant_id
--     + .target_funnel_variant_id, leadgen_auctions.funnel_variant_id) do NOT
--     block the DROP and are not cascade-deleted; their FK text re-binds by
--     name after the RENAME. Same technique 0043 used for leadgen_funnel_rules.
--   * Explicit `id` values are carried so PRIMARY KEYs are PRESERVED and
--     AUTOINCREMENT continues from the same high-water mark.
--   * INSERT OR IGNORE (not plain INSERT) matches the ritual: a re-run over an
--     already-migrated shape is a no-op, not a UNIQUE violation.
--   * Indexes on the ORIGINAL table (0036): exactly one named index —
--     idx_leadgen_variants_funnel(funnel_id, status) — recreated below. The
--     public_id UNIQUE (auto-index) is inline on the new table.
--
-- `frame_template_id` is NOT added here — it is added in 0049 (M5) via ALTER
-- ADD COLUMN, AFTER leadgen_frame_templates exists, so the FK target is real
-- (documented choice; the dispatch permits either location).

CREATE TABLE leadgen_funnel_variants_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,                   -- "lgn_…" == funnel_variant_id
  funnel_id INTEGER NOT NULL REFERENCES leadgen_funnels(id) ON DELETE CASCADE,   -- stable parent (issue 3)
  ab_test_id INTEGER REFERENCES leadgen_funnel_ab_tests(id) ON DELETE SET NULL,
  variant_label TEXT NOT NULL DEFAULT 'A',
  traffic_allocation_bp INTEGER NOT NULL DEFAULT 10000,   -- per-test Σ == 10000; UI shows %
  funnel_design_id TEXT NOT NULL DEFAULT 'default',
  auction_id INTEGER REFERENCES leadgen_auctions(id),
  lander_enabled INTEGER NOT NULL DEFAULT 0, lander_headline TEXT, lander_subheadline TEXT, lander_body_json TEXT,
  lander_hero_media_id INTEGER REFERENCES media(id), lander_hero_media_url TEXT, lander_cta_json TEXT,
  content_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  -- 0041 (v2.5 redesign contract 03 §3.1): sparse frame/theme override patch.
  frame_overrides_json TEXT
);

INSERT OR IGNORE INTO leadgen_funnel_variants_new
  (id, public_id, funnel_id, ab_test_id, variant_label, traffic_allocation_bp,
   funnel_design_id, auction_id, lander_enabled, lander_headline, lander_subheadline,
   lander_body_json, lander_hero_media_id, lander_hero_media_url, lander_cta_json,
   content_version, status, created_at, frame_overrides_json)
SELECT id, public_id, funnel_id, ab_test_id, variant_label, traffic_allocation_bp,
       funnel_design_id, auction_id, lander_enabled, lander_headline, lander_subheadline,
       lander_body_json, lander_hero_media_id, lander_hero_media_url, lander_cta_json,
       content_version, status, created_at, frame_overrides_json
FROM leadgen_funnel_variants;

DROP TABLE leadgen_funnel_variants;

ALTER TABLE leadgen_funnel_variants_new RENAME TO leadgen_funnel_variants;

-- Re-create the one named index the original table carried (0036:173).
CREATE INDEX IF NOT EXISTS idx_leadgen_variants_funnel ON leadgen_funnel_variants(funnel_id, status);
