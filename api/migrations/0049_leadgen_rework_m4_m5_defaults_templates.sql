-- 0049_leadgen_rework_m4_m5_defaults_templates.sql
-- LeadGen Rework P1 · M4 + M5 (contract §5-M4, §5-M5, §4.3-1, §4.3-14).
--
-- M4 — default funnel + board order (both ADDITIVE, no recreation):
--   * leadgen_quotes.default_funnel_id  — the funnel unmatched visitors enter
--     (§4.3-7); backfill = the quote's currently-active funnel, selected EXACTLY
--     as resolver.ts getActiveFunnelForQuote does today
--     (status='active' ORDER BY id ASC LIMIT 1) so the model is behavior-neutral
--     on the day it ships. Multiple ACTIVE funnels per quote become legal; §4.3
--     governs selection thereafter.
--   * leadgen_funnels.display_order — board column order; backfill = id (creation
--     order; within a quote, ascending id == the order funnels were created).
--
-- M5 — saved frame templates (§5-M5, §11D):
--   * NEW leadgen_frame_templates, seeded with the 6 built-ins whose defaults
--     are transcribed verbatim from FRAME_TEMPLATES (frames.ts:586-655). The
--     stored frame_json is parsed as JSON at runtime (never byte-compared), and
--     the round-trip test asserts JSON.parse(seed) deep-equals the live
--     FRAME_TEMPLATES[id].defaults — so a drift is caught structurally.
--   * is_default: 'centered' (id 1) seeded =1 (DEFAULT_FRAME_TEMPLATE_ID);
--     partial unique index enforces at most one =1 (§5-M5, §4.3-14 pattern).
--   * Template reference on BOTH axes (fixes the v1 A/B conflict): funnels
--     (base template) + funnel_variants (A/B override, NULL = inherit). Added
--     via ALTER ADD COLUMN here — AFTER the table exists — so the FK target is
--     real (the documented alternative to adding it in M1's recreation).

-- === M4: default funnel + board order =======================================
ALTER TABLE leadgen_quotes ADD COLUMN default_funnel_id INTEGER REFERENCES leadgen_funnels(id);
UPDATE leadgen_quotes
   SET default_funnel_id = (
     SELECT f.id FROM leadgen_funnels f
      WHERE f.quote_id = leadgen_quotes.id AND f.status = 'active'
      ORDER BY f.id ASC LIMIT 1
   )
 WHERE default_funnel_id IS NULL;

ALTER TABLE leadgen_funnels ADD COLUMN display_order INTEGER;
UPDATE leadgen_funnels SET display_order = id WHERE display_order IS NULL;

-- === M5: saved frame templates ==============================================
CREATE TABLE IF NOT EXISTS leadgen_frame_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,                    -- "lgft_…"
  name TEXT NOT NULL UNIQUE CHECK (length(name) <= 60),
  frame_json TEXT NOT NULL,                          -- FRAME_TEMPLATES[].defaults shape
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
-- At most one default template (§5-M5).
CREATE UNIQUE INDEX IF NOT EXISTS uq_lg_frame_templates_default
  ON leadgen_frame_templates(is_default) WHERE is_default = 1;

-- Seed the 6 built-ins. Explicit ids + INSERT OR IGNORE ⇒ idempotent (a re-run
-- conflicts on the PK and is skipped). public_id uses the 0042 idiom
-- (upper(hex(randomblob(13))) = 26 Crockford-conformant chars). name = the
-- FRAME_TEMPLATES label; the string template id ('centered', …) lives inside
-- frame_json.template.
INSERT OR IGNORE INTO leadgen_frame_templates (id, public_id, name, frame_json, is_default) VALUES
  (1, 'lgft_' || upper(hex(randomblob(13))), 'Centered card', '{"version":1,"template":"centered","compat":{"allow_section_chrome":false},"header":{"enabled":true,"logo_source":"site","logo_media_id":null,"logo_size":"m","logo_align":"center","tagline":null,"secure_badge":{"enabled":false,"text":null},"cta":{"enabled":false,"label":"","href":null,"tel":null},"disclosure_link":false,"sticky":true},"progress":{"style":"bar","position":"under_header","thickness":"m","width":"content","color_role":"brand_primary","show_label":false},"back":{"style":"text","position":"in_card","label":"Back","history_fallback":true},"disclosure":{"enabled":false,"location":"footer","link_label":"Advertising Disclosure","text":""},"footer":{"enabled":true,"show_on":"all","links_source":"site","links":[],"trust_text":null,"description":null,"show_logo":false,"hide_on_mobile":false},"trust_strip":{"enabled":false,"source":"manual","logos":[],"placement":"below_unit","mobile":"wrap"},"benefit_bar":{"enabled":false,"items":[],"placement":"below_unit"},"background":{"role":"page_background","image_media_id":null,"style":"flat"},"section_slot":{"max_width":"m","align":"center","card":"card","padding":"m","offset_y":"none","allow_section_card":true,"transition":"fade","continue_placement":"inside_unit","continue_style_role":"button_primary"},"mobile":{}}', 1),
  (2, 'lgft_' || upper(hex(randomblob(13))), 'Site header + footer', '{"version":1,"template":"header-footer","compat":{"allow_section_chrome":false},"header":{"enabled":true,"logo_source":"site","logo_media_id":null,"logo_size":"m","logo_align":"left","tagline":null,"secure_badge":{"enabled":true,"text":null},"cta":{"enabled":false,"label":"","href":null,"tel":null},"disclosure_link":false,"sticky":true},"progress":{"style":"bar","position":"under_header","thickness":"m","width":"content","color_role":"brand_primary","show_label":false},"back":{"style":"text","position":"in_card","label":"Back","history_fallback":true},"disclosure":{"enabled":false,"location":"footer","link_label":"Advertising Disclosure","text":""},"footer":{"enabled":true,"show_on":"all","links_source":"site","links":[],"trust_text":null,"description":null,"show_logo":true,"hide_on_mobile":false},"trust_strip":{"enabled":false,"source":"manual","logos":[],"placement":"below_unit","mobile":"wrap"},"benefit_bar":{"enabled":false,"items":[],"placement":"below_unit"},"background":{"role":"page_background","image_media_id":null,"style":"flat"},"section_slot":{"max_width":"m","align":"center","card":"bare","padding":"m","offset_y":"none","allow_section_card":true,"transition":"fade","continue_placement":"inside_unit","continue_style_role":"button_primary"},"mobile":{}}', 0),
  (3, 'lgft_' || upper(hex(randomblob(13))), 'Header + call CTA', '{"version":1,"template":"header-cta","compat":{"allow_section_chrome":false},"header":{"enabled":true,"logo_source":"site","logo_media_id":null,"logo_size":"m","logo_align":"center","tagline":null,"secure_badge":{"enabled":false,"text":null},"cta":{"enabled":false,"label":"","href":null,"tel":null},"disclosure_link":false,"sticky":true},"progress":{"style":"bar","position":"under_header","thickness":"m","width":"content","color_role":"brand_primary","show_label":false},"back":{"style":"text","position":"below_card","label":"Back","history_fallback":true},"disclosure":{"enabled":true,"location":"top_bar","link_label":"Advertising Disclosure","text":""},"footer":{"enabled":true,"show_on":"all","links_source":"site","links":[],"trust_text":null,"description":null,"show_logo":false,"hide_on_mobile":false},"trust_strip":{"enabled":false,"source":"manual","logos":[],"placement":"below_unit","mobile":"wrap"},"benefit_bar":{"enabled":false,"items":[],"placement":"below_unit"},"background":{"role":"page_background","image_media_id":null,"style":"flat"},"section_slot":{"max_width":"m","align":"center","card":"card","padding":"m","offset_y":"none","allow_section_card":true,"transition":"fade","continue_placement":"inside_unit","continue_style_role":"button_primary"},"mobile":{}}', 0),
  (4, 'lgft_' || upper(hex(randomblob(13))), 'Full background', '{"version":1,"template":"full-background","compat":{"allow_section_chrome":false},"header":{"enabled":true,"logo_source":"site","logo_media_id":null,"logo_size":"m","logo_align":"center","tagline":null,"secure_badge":{"enabled":false,"text":null},"cta":{"enabled":false,"label":"","href":null,"tel":null},"disclosure_link":false,"sticky":false},"progress":{"style":"dots","position":"above_unit","thickness":"m","width":"content","color_role":"brand_primary","show_label":false},"back":{"style":"text","position":"in_card","label":"Back","history_fallback":true},"disclosure":{"enabled":false,"location":"footer","link_label":"Advertising Disclosure","text":""},"footer":{"enabled":true,"show_on":"all","links_source":"site","links":[],"trust_text":null,"description":null,"show_logo":false,"hide_on_mobile":false},"trust_strip":{"enabled":false,"source":"manual","logos":[],"placement":"below_unit","mobile":"wrap"},"benefit_bar":{"enabled":false,"items":[],"placement":"below_unit"},"background":{"role":"brand_primary","image_media_id":null,"style":"brand"},"section_slot":{"max_width":"m","align":"center","card":"card","padding":"m","offset_y":"none","allow_section_card":true,"transition":"fade","continue_placement":"inside_unit","continue_style_role":"button_primary"},"mobile":{}}', 0),
  (5, 'lgft_' || upper(hex(randomblob(13))), 'White + trust bar', '{"version":1,"template":"white-trust","compat":{"allow_section_chrome":false},"header":{"enabled":true,"logo_source":"site","logo_media_id":null,"logo_size":"s","logo_align":"center","tagline":null,"secure_badge":{"enabled":false,"text":null},"cta":{"enabled":false,"label":"","href":null,"tel":null},"disclosure_link":false,"sticky":false},"progress":{"style":"bar","position":"under_header","thickness":"m","width":"content","color_role":"brand_primary","show_label":false},"back":{"style":"text","position":"in_card","label":"Back","history_fallback":true},"disclosure":{"enabled":false,"location":"footer","link_label":"Advertising Disclosure","text":""},"footer":{"enabled":true,"show_on":"all","links_source":"site","links":[],"trust_text":null,"description":null,"show_logo":false,"hide_on_mobile":false},"trust_strip":{"enabled":false,"source":"manual","logos":[],"placement":"footer","mobile":"wrap"},"benefit_bar":{"enabled":false,"items":[],"placement":"below_unit"},"background":{"role":"card_background","image_media_id":null,"style":"flat"},"section_slot":{"max_width":"m","align":"center","card":"bare","padding":"m","offset_y":"none","allow_section_card":true,"transition":"fade","continue_placement":"inside_unit","continue_style_role":"button_primary"},"mobile":{}}', 0),
  (6, 'lgft_' || upper(hex(randomblob(13))), 'Minimal', '{"version":1,"template":"minimal","compat":{"allow_section_chrome":false},"header":{"enabled":true,"logo_source":"site","logo_media_id":null,"logo_size":"m","logo_align":"center","tagline":null,"secure_badge":{"enabled":false,"text":null},"cta":{"enabled":false,"label":"","href":null,"tel":null},"disclosure_link":false,"sticky":true},"progress":{"style":"bar","position":"under_header","thickness":"m","width":"content","color_role":"brand_primary","show_label":false},"back":{"style":"text","position":"under_header_left","label":"Back","history_fallback":true},"disclosure":{"enabled":false,"location":"footer","link_label":"Advertising Disclosure","text":""},"footer":{"enabled":false,"show_on":"all","links_source":"site","links":[],"trust_text":null,"description":null,"show_logo":false,"hide_on_mobile":false},"trust_strip":{"enabled":false,"source":"manual","logos":[],"placement":"below_unit","mobile":"wrap"},"benefit_bar":{"enabled":false,"items":[],"placement":"below_unit"},"background":{"role":"page_background","image_media_id":null,"style":"flat"},"section_slot":{"max_width":"m","align":"center","card":"bare","padding":"m","offset_y":"none","allow_section_card":true,"transition":"fade","continue_placement":"inside_unit","continue_style_role":"button_primary"},"mobile":{}}', 0);

-- Template reference on both axes (§5-M5). Both NULLable; funnel backfill NULL
-- (a null funnel template ⇒ effectiveFrame uses frame_config_json.template as
-- today); variant NULL ⇒ inherit the funnel's.
ALTER TABLE leadgen_funnels ADD COLUMN frame_template_id INTEGER REFERENCES leadgen_frame_templates(id);
ALTER TABLE leadgen_funnel_variants ADD COLUMN frame_template_id INTEGER REFERENCES leadgen_frame_templates(id);
