-- 0013_phase10_media_admin_crud_columns.sql
-- T31 ([B10] Media library port): the ported admin media library writes
-- three columns the 0001 media table never carried (the legacy media
-- table had them; the Phase-1 port dropped them):
--   caption     — shown with the image, sent by the upload modal
--   uploaded_by — Access identity email recorded at upload time
--   updated_at  — PUT /api/admin/media/:id metadata-update timestamp
-- All three are nullable; existing rows need no backfill.

ALTER TABLE media ADD COLUMN caption TEXT;
ALTER TABLE media ADD COLUMN uploaded_by TEXT;
ALTER TABLE media ADD COLUMN updated_at INTEGER;
