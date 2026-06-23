-- Migration 0026 (rescue-4 round-3): add the "jobs" vertical + its 5
-- categories + the category_verticals matrix mapping each category to the
-- jobs vertical.
--
-- This mirrors the global-catalogue seed pattern established in 0004
-- (verticals / categories / category_verticals): the New Site modal offers
-- verticals.slug, sites.vertical_slug references it, and category_verticals
-- links categories to verticals via slug-keyed subqueries so the
-- autoincrement IDs are never hard-coded. The "jobs" vertical takes
-- display_order 9 (it sits after the 8 canonical verticals 0004 seeded:
-- home..lifestyle = 1..8). The 5 new categories take display_order 1..5 and
-- each maps to the jobs vertical with category_verticals.display_order 0..4.
--
-- Idempotency: every statement is INSERT OR IGNORE, so re-applying against a
-- local D1 ledger that already advanced past 0026 is a no-op (no duplicate
-- rows, no schema change). The category_verticals rows use the same
-- (SELECT id FROM categories WHERE slug=...) / (SELECT id FROM verticals
-- WHERE slug='jobs') subquery shape as 0004 so they resolve against whatever
-- IDs the engine assigned.

-- 1) The "jobs" vertical (display_order 9, after the 0004 canonical 8).
INSERT OR IGNORE INTO verticals (slug, name, display_order) VALUES ('jobs', 'Jobs & Employment', 9);

-- 2) Five jobs categories (display_order 1..5).
INSERT OR IGNORE INTO categories (slug, name, display_order) VALUES ('job-search', 'Job Search', 1);
INSERT OR IGNORE INTO categories (slug, name, display_order) VALUES ('career-growth', 'Career Growth', 2);
INSERT OR IGNORE INTO categories (slug, name, display_order) VALUES ('resumes-interviews', 'Resumes & Interviews', 3);
INSERT OR IGNORE INTO categories (slug, name, display_order) VALUES ('workplace-culture', 'Workplace & Culture', 4);
INSERT OR IGNORE INTO categories (slug, name, display_order) VALUES ('salary-benefits', 'Salary & Benefits', 5);

-- 3) category_verticals matrix — map each of the 5 categories to the jobs
--    vertical, display_order 0..4. Slug-keyed subqueries avoid hard-coded IDs.
INSERT OR IGNORE INTO category_verticals (category_id, vertical_id, display_order) VALUES ((SELECT id FROM categories WHERE slug='job-search'), (SELECT id FROM verticals WHERE slug='jobs'), 0);
INSERT OR IGNORE INTO category_verticals (category_id, vertical_id, display_order) VALUES ((SELECT id FROM categories WHERE slug='career-growth'), (SELECT id FROM verticals WHERE slug='jobs'), 1);
INSERT OR IGNORE INTO category_verticals (category_id, vertical_id, display_order) VALUES ((SELECT id FROM categories WHERE slug='resumes-interviews'), (SELECT id FROM verticals WHERE slug='jobs'), 2);
INSERT OR IGNORE INTO category_verticals (category_id, vertical_id, display_order) VALUES ((SELECT id FROM categories WHERE slug='workplace-culture'), (SELECT id FROM verticals WHERE slug='jobs'), 3);
INSERT OR IGNORE INTO category_verticals (category_id, vertical_id, display_order) VALUES ((SELECT id FROM categories WHERE slug='salary-benefits'), (SELECT id FROM verticals WHERE slug='jobs'), 4);
