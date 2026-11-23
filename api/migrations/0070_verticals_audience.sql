-- 0070_verticals_audience.sql
-- X06 SEO Fixes (plan v3, owner decision Q1 (a), 23 Nov 2026):
--   verticals.audience — the default reader description for every site in a
--   Vertical. New-site setup copies it into the site's own "audience" site
--   setting; every AI text for the site uses that value for {{audience}}.
--   Shown and edited on the Verticals screen. Empty / NULL means the code
--   falls back to "readers interested in <vertical name>".
-- Additive only: one nullable column, then the Q1 defaults for the 9
-- existing Verticals (only where still empty, so a re-run changes nothing).

ALTER TABLE verticals ADD COLUMN audience TEXT;

UPDATE verticals SET audience = 'homeowners and renters looking after their homes' WHERE slug = 'home' AND (audience IS NULL OR audience = '');
UPDATE verticals SET audience = 'people who want to make smarter everyday money decisions' WHERE slug = 'finance' AND (audience IS NULL OR audience = '');
UPDATE verticals SET audience = 'people planning their next trip' WHERE slug = 'travel' AND (audience IS NULL OR audience = '');
UPDATE verticals SET audience = 'adults looking for clear, practical health information' WHERE slug = 'health' AND (audience IS NULL OR audience = '');
UPDATE verticals SET audience = 'parents raising young children' WHERE slug = 'parenting' AND (audience IS NULL OR audience = '');
UPDATE verticals SET audience = 'home cooks looking for easy, reliable recipes' WHERE slug = 'food' AND (audience IS NULL OR audience = '');
UPDATE verticals SET audience = 'everyday people choosing and using technology' WHERE slug = 'tech' AND (audience IS NULL OR audience = '');
UPDATE verticals SET audience = 'adults looking for practical ideas for everyday life' WHERE slug = 'lifestyle' AND (audience IS NULL OR audience = '');
UPDATE verticals SET audience = 'job seekers and people growing their careers' WHERE slug = 'jobs' AND (audience IS NULL OR audience = '');
