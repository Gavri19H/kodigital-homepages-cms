-- 0042_leadgen_pages.sql
-- LeadGen Round-4 D-3 (operator-locked, FULL pages model, plan roast MAJOR-4)
-- -- contract-delta: a page holds >=1 SECTION via one or more ordered SLOTS;
-- each slot resolves (fixed / rule-matched over ENTRY-KNOWN attributes only /
-- session-sticky A-B) to exactly ONE candidate section per attempt. Progress
-- counts PAGES; the auction fires after the LAST page.
--
-- Additive + forward-only; no destructive change to any existing column.
-- The migration WRAPS existing data: every CURRENT leadgen_funnel_variant_
-- sections row becomes its OWN page (page position == the row's own
-- position) with exactly one FIXED slot (position 0, no rules, no A/B)
-- referencing it -- so a pre-P3a funnel serves BYTE-IDENTICAL live section/
-- component HTML post-migration (round4 P3a migration gate; the page overlay
-- -- page_plan_hash, page_id stamps -- is purely additive).

CREATE TABLE IF NOT EXISTS leadgen_funnel_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,                     -- "lgpg_..." (the page_id)
  variant_id INTEGER NOT NULL REFERENCES leadgen_funnel_variants(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,                          -- page order within the variant (progress numerator/denominator)
  name TEXT,                                          -- optional author label (structure-panel display only)
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (variant_id, position)
);

-- Slots carry NO public_id (never exposed to the public runtime directly;
-- admin CRUD + server plan resolution address a slot by its plain integer
-- id, the same convention leadgen_funnel_rules uses for target_offer_id/
-- target_section_id raw-integer FKs).
CREATE TABLE IF NOT EXISTS leadgen_funnel_page_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL REFERENCES leadgen_funnel_pages(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,                          -- slot order within the page
  -- Bumped on any rules_json/ab_allocations_json edit -> a clean A/B
  -- re-bucket (§16.2 discipline) and a stale-config anti-tamper signal (a
  -- signed page_plan_hash minted against the OLD revision no longer matches
  -- a post-edit recomputation).
  slot_revision INTEGER NOT NULL DEFAULT 0,
  -- Ruled slot (entry-known attributes only -- state/device/utm_source/
  -- utm_medium/utm_content/hour/weekday; answer-field conditions are
  -- REJECTED at save with plain language, quotes-handlers.ts). Shape:
  --   { "cases": [ { "conditions": { "groups": [...] }, "section_id": N }, ... ],
  --     "default_section_id": N }
  -- Evaluated case-by-case in array order via the EXISTING §21.4 composed-
  -- group evaluator (leadgen/auction-rules.ts conditionsMatch); the first
  -- matching case wins, else default_section_id (REQUIRED for a ruled slot
  -- -- every slot must always resolve to exactly one section).
  rules_json TEXT,
  -- A/B slot. Shape: [ { "section_id": N, "bp": N }, ... ], Sigma(bp) == 10000.
  -- Session-sticky hash: page_id:slot_id:slot_revision:session_id.
  ab_allocations_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (page_id, position)
);

-- Additive nullable FKs on the pre-existing table. Every row carries BOTH
-- set after the backfill below runs (NULL only transiently, mid-migration,
-- before the backfill executes). A "fixed" slot has exactly one variant-
-- section row pointing at it; a "ruled"/"ab" slot has one row per candidate
-- section named in its rules_json/ab_allocations_json. NOTE: once a slot has
-- >1 candidate row, `position` on THIS table is no longer the serve order
-- (that is now leadgen_funnel_pages.position + leadgen_funnel_page_slots.
-- position) -- it remains only a per-variant uniqueness tiebreaker so the
-- pre-existing UNIQUE(variant_id, position) constraint stays satisfiable.
ALTER TABLE leadgen_funnel_variant_sections ADD COLUMN page_id INTEGER REFERENCES leadgen_funnel_pages(id) ON DELETE CASCADE;
ALTER TABLE leadgen_funnel_variant_sections ADD COLUMN slot_id INTEGER REFERENCES leadgen_funnel_page_slots(id) ON DELETE CASCADE;

-- WRAP (behavior-preserving): one page + one fixed slot per existing
-- variant-section row. public_id uses hex(randomblob(13)) -- 26 uppercase
-- hex chars, a Crockford-base32-conformant subset (0-9A-F excludes none of
-- the Crockford-excluded I/L/O/U), so it passes isPublicId("funnel_page", …)
-- exactly like a real ULID (not time-sortable, which is immaterial for a
-- one-time migration backfill). Correlated back to its source row via
-- (variant_id, position), which is unique on BOTH sides (the source table's
-- pre-existing UNIQUE(variant_id, position); the new pages table's own
-- identical constraint) -- no synthetic join key needed.
INSERT INTO leadgen_funnel_pages (public_id, variant_id, position, name, created_at)
SELECT 'lgpg_' || upper(hex(randomblob(13))), fvs.variant_id, fvs.position, NULL, unixepoch()
FROM leadgen_funnel_variant_sections fvs
WHERE fvs.page_id IS NULL;

INSERT INTO leadgen_funnel_page_slots (page_id, position, slot_revision, rules_json, ab_allocations_json, created_at)
SELECT p.id, 0, 0, NULL, NULL, unixepoch()
FROM leadgen_funnel_variant_sections fvs
JOIN leadgen_funnel_pages p ON p.variant_id = fvs.variant_id AND p.position = fvs.position
WHERE fvs.page_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM leadgen_funnel_page_slots s WHERE s.page_id = p.id);

UPDATE leadgen_funnel_variant_sections
SET page_id = (
      SELECT p.id FROM leadgen_funnel_pages p
      WHERE p.variant_id = leadgen_funnel_variant_sections.variant_id
        AND p.position = leadgen_funnel_variant_sections.position
    ),
    slot_id = (
      SELECT s.id FROM leadgen_funnel_page_slots s
      JOIN leadgen_funnel_pages p ON p.id = s.page_id
      WHERE p.variant_id = leadgen_funnel_variant_sections.variant_id
        AND p.position = leadgen_funnel_variant_sections.position
    )
WHERE page_id IS NULL;
