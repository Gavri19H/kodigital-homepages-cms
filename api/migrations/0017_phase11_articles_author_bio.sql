-- 0017_phase11_articles_author_bio.sql
-- T14d (rescue-3 article-editor parity): the ported article editor now
-- renders an Author Bio field alongside Author Name. The articles table
-- already carries author_name (0001 / recreated in 0007) and
-- featured_image_id; it never carried author_bio. Add it as a nullable TEXT
-- column — existing rows need no backfill (author bio is optional editorial
-- metadata surfaced by the public article byline view-model).

ALTER TABLE articles ADD COLUMN author_bio TEXT;
