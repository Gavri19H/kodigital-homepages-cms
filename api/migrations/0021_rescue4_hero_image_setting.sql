-- Migration 0021 (Rescue 4 / T18): register the site-level hero-image setting.
--
-- Defect (BCL-056): there was no site-level hero-image setting — the homepage
-- hero could only borrow a featured article's image, so a tenant with no
-- suitable lead article had an imageless banner. The public Home view-model
-- (buildHomeViewModel) now reads a `hero_image_media_id` key from the
-- per-site key/value `site_settings` table (the same place logo_media_id,
-- tagline and brand_tokens_json live) and resolves it to /media/<storage_key>
-- to fill the full-bleed `.hero-bg` banner; an unset/empty value falls back
-- to the lead article's image.
--
-- `site_settings` is a (site_id, key, value) key/value store with
-- UNIQUE(site_id, key) (migration 0003), so the new setting needs no schema
-- change. This migration MATERIALISES the key for every existing site with an
-- empty default value so the operator Settings UI surfaces the field and the
-- view-model read finds a row. The empty default resolves to null in
-- mediaUrl(), i.e. "no site hero set" → fall back to the lead article.
--
-- Idempotency: INSERT OR IGNORE against the UNIQUE(site_id, key) index — a
-- re-apply inserts nothing and never duplicates a row. A site that already
-- carries a non-empty hero_image_media_id (set via the admin UI) is left
-- untouched: OR IGNORE skips the conflicting (site_id, 'hero_image_media_id')
-- pair rather than overwriting the operator's value.
INSERT OR IGNORE INTO site_settings (site_id, key, value)
SELECT id, 'hero_image_media_id', ''
FROM sites;
