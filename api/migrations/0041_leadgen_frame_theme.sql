-- 0041_leadgen_frame_theme.sql
-- LeadGen v2.5.1 redesign — funnel frame + theme storage — contract 03 §3.1 (D2)
-- Additive only, forward-only, no backfill. NULL = exact current behavior
-- (bare shell, chrome from Sections; base design only; no variant overrides).

ALTER TABLE leadgen_funnels ADD COLUMN frame_config_json TEXT;          -- NULL = legacy frame
ALTER TABLE leadgen_funnels ADD COLUMN theme_json TEXT;                 -- NULL = base design only
ALTER TABLE leadgen_funnel_variants ADD COLUMN frame_overrides_json TEXT; -- NULL = no overrides
