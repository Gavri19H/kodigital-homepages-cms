-- 0047_leadgen_rework_m2_shared_pages.sql
-- LeadGen Rework P1 · M2 (contract §5-M2, §4.3-1 "one shared first page").
--
-- Adds a QUOTE-OWNED page axis so a Quote can own its shared first page (and
-- its sections) directly, not only through a variant. Both owner tables are
-- recreated with:
--   * variant_id  → NULLable (was NOT NULL),
--   * quote_id    → new, NULLable, REFERENCES leadgen_quotes(id) ON DELETE CASCADE,
--   * CHECK ((variant_id IS NULL) != (quote_id IS NULL))  — exactly ONE owner,
--   * UNIQUE(owner, position) delivered as TWO PARTIAL unique indexes, because
--     SQLite treats NULLs as DISTINCT in a plain UNIQUE(a,b) — a single
--     UNIQUE(variant_id,position) would NOT constrain quote-owned rows and vice
--     versa. One partial index per owner column enforces per-owner uniqueness.
--
-- Every EXISTING row is variant-owned (variant_id set, quote_id NULL) — the
-- CHECK passes and the variant partial index preserves the old
-- UNIQUE(variant_id, position) semantics byte-for-byte. Slots, in-page A/B,
-- slot rules, page_plan hash + signed bindings are unaffected: the slot table
-- (leadgen_funnel_page_slots) and the page_id/slot_id linkage columns carry
-- over unchanged; a quote-owned page resolves through the SAME slot machinery.
--
-- CHECK/NOT-NULL change ⇒ FULL-TABLE RECREATION (d1-database-safety):
--   * D1 runs migrations with foreign_keys=OFF (0007/0008) — the DROP is safe
--     against inbound/linkage FKs; ids are preserved (INSERT OR IGNORE with
--     explicit ids) so page_id/slot_id references stay valid after RENAME.
--   * Index inventory of the ORIGINAL tables (verified): both carried ONLY the
--     inline UNIQUE(variant_id, position) auto-index (+ pages' public_id UNIQUE)
--     — NO named CREATE INDEX to recreate. The new owner-aware partial indexes
--     replace the old auto-index below.
--   * P1 entry gate (contract §5-M2): the readers of these two tables'
--     variant_id (ui-sections.ts, db-types.ts, sections-handlers.ts,
--     quotes-handlers.ts, offers-handlers.ts, resolver.ts) are updated by the
--     P1 handler/resolver slices; this file owns the DDL + db-types.ts only.

-- === leadgen_funnel_pages ===================================================
CREATE TABLE leadgen_funnel_pages_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,                    -- "lgpg_..." (the page_id)
  variant_id INTEGER REFERENCES leadgen_funnel_variants(id) ON DELETE CASCADE,   -- NULLable owner axis
  quote_id INTEGER REFERENCES leadgen_quotes(id) ON DELETE CASCADE,              -- NULLable owner axis
  position INTEGER NOT NULL,                          -- page order within the owner
  name TEXT,                                          -- optional author label
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK ((variant_id IS NULL) != (quote_id IS NULL))  -- exactly one owner
);

INSERT OR IGNORE INTO leadgen_funnel_pages_new
  (id, public_id, variant_id, quote_id, position, name, created_at)
SELECT id, public_id, variant_id, NULL, position, name, created_at
FROM leadgen_funnel_pages;

DROP TABLE leadgen_funnel_pages;

ALTER TABLE leadgen_funnel_pages_new RENAME TO leadgen_funnel_pages;

CREATE UNIQUE INDEX uq_lg_pages_variant_pos
  ON leadgen_funnel_pages(variant_id, position) WHERE variant_id IS NOT NULL;
CREATE UNIQUE INDEX uq_lg_pages_quote_pos
  ON leadgen_funnel_pages(quote_id, position) WHERE quote_id IS NOT NULL;

-- === leadgen_funnel_variant_sections ========================================
-- Carries the 0036 columns + the 0042 page_id/slot_id linkage columns. No
-- public_id, no named index on the original — only the inline UNIQUE.
CREATE TABLE leadgen_funnel_variant_sections_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id INTEGER REFERENCES leadgen_funnel_variants(id) ON DELETE CASCADE,   -- NULLable owner axis
  quote_id INTEGER REFERENCES leadgen_quotes(id) ON DELETE CASCADE,              -- NULLable owner axis
  section_id INTEGER NOT NULL REFERENCES leadgen_sections(id),
  position INTEGER NOT NULL,                          -- auction runs after the MAX position (issue 10)
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  page_id INTEGER REFERENCES leadgen_funnel_pages(id) ON DELETE CASCADE,         -- 0042 pages linkage
  slot_id INTEGER REFERENCES leadgen_funnel_page_slots(id) ON DELETE CASCADE,    -- 0042 pages linkage
  CHECK ((variant_id IS NULL) != (quote_id IS NULL))  -- exactly one owner
);

INSERT OR IGNORE INTO leadgen_funnel_variant_sections_new
  (id, variant_id, quote_id, section_id, position, created_at, page_id, slot_id)
SELECT id, variant_id, NULL, section_id, position, created_at, page_id, slot_id
FROM leadgen_funnel_variant_sections;

DROP TABLE leadgen_funnel_variant_sections;

ALTER TABLE leadgen_funnel_variant_sections_new RENAME TO leadgen_funnel_variant_sections;

CREATE UNIQUE INDEX uq_lg_vsections_variant_pos
  ON leadgen_funnel_variant_sections(variant_id, position) WHERE variant_id IS NOT NULL;
CREATE UNIQUE INDEX uq_lg_vsections_quote_pos
  ON leadgen_funnel_variant_sections(quote_id, position) WHERE quote_id IS NOT NULL;
