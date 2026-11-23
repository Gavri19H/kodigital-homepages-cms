-- 0071_articles_seo_title_uncut.sql
-- X06 SEO Fixes (owner decision Q3, 19 Nov 2026): new-site setup saved each
-- starter Article's SEO title as the first 70 characters of its title, so
-- Google showed titles cut mid-word ("... Zero-Based, Envelope, an").
-- One-time fix: only rows whose seo_title is exactly the first 70 characters
-- of a LONGER title get the full title. On 23 Nov 2026 that matched exactly
-- 6 of 60 live Articles. Any other row, including SEO titles an operator
-- typed, is left as it is. updated_at is not touched. A re-run matches 0 rows.

UPDATE articles
SET seo_title = title
WHERE seo_title IS NOT NULL
  AND title IS NOT NULL
  AND length(title) > 70
  AND seo_title = substr(title, 1, 70);
