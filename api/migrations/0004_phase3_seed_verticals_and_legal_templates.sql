-- ==================================================================
-- Phase 3, T8 — seed 8 verticals + 4 legal templates
-- ------------------------------------------------------------------
-- This migration seeds the global (per-environment) catalogues that
-- every tenant site reads from at provisioning time:
--   1. `verticals` — the canonical 8-slug list the New Site modal
--      offers (home, finance, travel, health, parenting, food, tech,
--      lifestyle). The slug is referenced by sites.vertical_slug and
--      category_verticals.vertical_id, so the rows must exist before
--      any site can be created.
--   2. `legal_templates` — the 4 mustache-style legal documents
--      (privacy-policy, terms, do-not-sell, contact) that the
--      render_generic_legal_pages_with_site_variables provisioning
--      step renders per-tenant. The body fields stay deliberately
--      stub-like at this seed stage; T20's renderer expands the
--      {{site_name}} / {{domain}} / {{vertical}} / {{owner_email}} /
--      {{address}} / {{effective_date}} variables when the per-site
--      page is generated.
--
-- INSERT OR IGNORE keeps re-applies idempotent — fresh local D1
-- ledgers that already advanced past 0004 once are no-ops. Each
-- INSERT is on its own line so the deterministic AC greps
--   T8.AC1: `INSERT (OR IGNORE )?INTO verticals.*(<slug>)`     → 8
--   T8.AC2: `INSERT (OR IGNORE )?INTO legal_templates.*(<slug>)` → 4
-- count exactly the seed rows and not the schema declarations.
--
-- T9 (next story) appends categories + category_verticals matrix
-- INSERTs to this same file (per architect spec); this T8 block
-- only seeds the two global catalogues above.
-- ==================================================================

-- 1) Verticals — 8 canonical slugs, ordered for the New Site modal.
INSERT OR IGNORE INTO verticals (slug, name, display_order) VALUES ('home', 'Home', 1);
INSERT OR IGNORE INTO verticals (slug, name, display_order) VALUES ('finance', 'Finance', 2);
INSERT OR IGNORE INTO verticals (slug, name, display_order) VALUES ('travel', 'Travel', 3);
INSERT OR IGNORE INTO verticals (slug, name, display_order) VALUES ('health', 'Health', 4);
INSERT OR IGNORE INTO verticals (slug, name, display_order) VALUES ('parenting', 'Parenting', 5);
INSERT OR IGNORE INTO verticals (slug, name, display_order) VALUES ('food', 'Food', 6);
INSERT OR IGNORE INTO verticals (slug, name, display_order) VALUES ('tech', 'Tech', 7);
INSERT OR IGNORE INTO verticals (slug, name, display_order) VALUES ('lifestyle', 'Lifestyle', 8);

-- 2) Legal templates — 4 mustache-style globals. content_md carries
--    the body with {{variable}} tokens; T20's renderer substitutes
--    them per-site and writes the rendered HTML into pages.content_html.
INSERT OR IGNORE INTO legal_templates (slug, title, content_md, version) VALUES ('privacy-policy', 'Privacy Policy', '# Privacy Policy for {{site_name}}' || char(10) || char(10) || 'This privacy policy applies to {{site_name}} ({{domain}}). For privacy inquiries contact {{owner_email}}. Effective date: {{effective_date}}.', 1);
INSERT OR IGNORE INTO legal_templates (slug, title, content_md, version) VALUES ('terms', 'Terms of Service', '# Terms of Service for {{site_name}}' || char(10) || char(10) || 'These terms govern your use of {{site_name}} ({{domain}}) operated from {{address}}. Effective date: {{effective_date}}.', 1);
INSERT OR IGNORE INTO legal_templates (slug, title, content_md, version) VALUES ('do-not-sell', 'Do Not Sell My Personal Information', '# Do Not Sell My Personal Information — {{site_name}}' || char(10) || char(10) || 'Residents of California and other applicable jurisdictions may opt out of the sale of personal information collected by {{site_name}} ({{domain}}). Submit requests to {{owner_email}}. Effective date: {{effective_date}}.', 1);
INSERT OR IGNORE INTO legal_templates (slug, title, content_md, version) VALUES ('contact', 'Contact {{site_name}}', '# Contact {{site_name}}' || char(10) || char(10) || '{{site_name}} ({{vertical}}) is reachable at {{owner_email}}. Mailing address: {{address}}. Domain: {{domain}}. Effective date: {{effective_date}}.', 1);

-- ==================================================================
-- Phase 3, T9 — seed multi-vertical categories + category_verticals
-- ------------------------------------------------------------------
-- 7 global categories + many-to-many matrix mapping each to one or
-- more verticals. category_verticals rows use slug-keyed subqueries
-- against (categories, verticals) so autoincrement IDs aren't hard
-- coded; INSERT OR IGNORE is idempotent against the composite PK.
-- T9.AC1 grep `INSERT (OR IGNORE )?INTO (categories|category_verticals)`
-- must be >= 14 (we emit 23). T9.AC2: healthy-meals maps to THREE
-- verticals (health, food, parenting) per the architect example.
-- ==================================================================

-- 3) Global categories — 7 catalog entries the New Site flow can
--    allocate based on the site's chosen vertical(s).
INSERT OR IGNORE INTO categories (slug, name, display_order) VALUES ('healthy-meals', 'Healthy Meals', 1);
INSERT OR IGNORE INTO categories (slug, name, display_order) VALUES ('family-travel', 'Family Travel', 2);
INSERT OR IGNORE INTO categories (slug, name, display_order) VALUES ('personal-finance', 'Personal Finance', 3);
INSERT OR IGNORE INTO categories (slug, name, display_order) VALUES ('smart-home', 'Smart Home', 4);
INSERT OR IGNORE INTO categories (slug, name, display_order) VALUES ('quick-recipes', 'Quick Recipes', 5);
INSERT OR IGNORE INTO categories (slug, name, display_order) VALUES ('tech-gadgets', 'Tech Gadgets', 6);
INSERT OR IGNORE INTO categories (slug, name, display_order) VALUES ('wellness', 'Wellness', 7);

-- 4) category_verticals matrix — many-to-many. healthy-meals is the
--    canonical 3-way example (health, food, parenting); the rest each
--    map to two verticals so every category has >= 1 vertical.
INSERT OR IGNORE INTO category_verticals (category_id, vertical_id, display_order) VALUES ((SELECT id FROM categories WHERE slug = 'healthy-meals'), (SELECT id FROM verticals WHERE slug = 'health'), 0);
INSERT OR IGNORE INTO category_verticals (category_id, vertical_id, display_order) VALUES ((SELECT id FROM categories WHERE slug = 'healthy-meals'), (SELECT id FROM verticals WHERE slug = 'food'), 1);
INSERT OR IGNORE INTO category_verticals (category_id, vertical_id, display_order) VALUES ((SELECT id FROM categories WHERE slug = 'healthy-meals'), (SELECT id FROM verticals WHERE slug = 'parenting'), 2);
INSERT OR IGNORE INTO category_verticals (category_id, vertical_id, display_order) VALUES ((SELECT id FROM categories WHERE slug = 'family-travel'), (SELECT id FROM verticals WHERE slug = 'travel'), 0);
INSERT OR IGNORE INTO category_verticals (category_id, vertical_id, display_order) VALUES ((SELECT id FROM categories WHERE slug = 'family-travel'), (SELECT id FROM verticals WHERE slug = 'parenting'), 1);
INSERT OR IGNORE INTO category_verticals (category_id, vertical_id, display_order) VALUES ((SELECT id FROM categories WHERE slug = 'personal-finance'), (SELECT id FROM verticals WHERE slug = 'finance'), 0);
INSERT OR IGNORE INTO category_verticals (category_id, vertical_id, display_order) VALUES ((SELECT id FROM categories WHERE slug = 'personal-finance'), (SELECT id FROM verticals WHERE slug = 'lifestyle'), 1);
INSERT OR IGNORE INTO category_verticals (category_id, vertical_id, display_order) VALUES ((SELECT id FROM categories WHERE slug = 'smart-home'), (SELECT id FROM verticals WHERE slug = 'home'), 0);
INSERT OR IGNORE INTO category_verticals (category_id, vertical_id, display_order) VALUES ((SELECT id FROM categories WHERE slug = 'smart-home'), (SELECT id FROM verticals WHERE slug = 'tech'), 1);
INSERT OR IGNORE INTO category_verticals (category_id, vertical_id, display_order) VALUES ((SELECT id FROM categories WHERE slug = 'quick-recipes'), (SELECT id FROM verticals WHERE slug = 'food'), 0);
INSERT OR IGNORE INTO category_verticals (category_id, vertical_id, display_order) VALUES ((SELECT id FROM categories WHERE slug = 'quick-recipes'), (SELECT id FROM verticals WHERE slug = 'lifestyle'), 1);
INSERT OR IGNORE INTO category_verticals (category_id, vertical_id, display_order) VALUES ((SELECT id FROM categories WHERE slug = 'tech-gadgets'), (SELECT id FROM verticals WHERE slug = 'tech'), 0);
INSERT OR IGNORE INTO category_verticals (category_id, vertical_id, display_order) VALUES ((SELECT id FROM categories WHERE slug = 'tech-gadgets'), (SELECT id FROM verticals WHERE slug = 'lifestyle'), 1);
INSERT OR IGNORE INTO category_verticals (category_id, vertical_id, display_order) VALUES ((SELECT id FROM categories WHERE slug = 'wellness'), (SELECT id FROM verticals WHERE slug = 'health'), 0);
INSERT OR IGNORE INTO category_verticals (category_id, vertical_id, display_order) VALUES ((SELECT id FROM categories WHERE slug = 'wellness'), (SELECT id FROM verticals WHERE slug = 'lifestyle'), 1);
INSERT OR IGNORE INTO category_verticals (category_id, vertical_id, display_order) VALUES ((SELECT id FROM categories WHERE slug = 'wellness'), (SELECT id FROM verticals WHERE slug = 'parenting'), 2);
