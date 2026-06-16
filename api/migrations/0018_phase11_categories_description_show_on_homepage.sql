-- 0018_phase11_categories_description_show_on_homepage.sql
-- T17 (rescue-3 categories-tab parity): the ported Categories editor now
-- renders Description and Show-on-Homepage controls alongside Display Order.
-- The categories table already carries display_order (0001), but never
-- carried a description blurb or a homepage-visibility flag. Add them:
--   * description       -- optional editorial blurb for the category.
--   * show_on_homepage  -- 0/1 flag controlling homepage category surfacing.
-- Existing rows need no backfill: description is nullable; show_on_homepage
-- defaults to 0 (hidden), which preserves the pre-existing behaviour.

ALTER TABLE categories ADD COLUMN description TEXT;
ALTER TABLE categories ADD COLUMN show_on_homepage INTEGER NOT NULL DEFAULT 0;
