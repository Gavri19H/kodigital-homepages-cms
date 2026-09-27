-- The banner creative of a "Static — no provider request" Offer.
--
-- OWNER 2026-09-27: static Offers could only set a click URL, so their card
-- rendered as the Provider name alone ("Impact") over the CTA — a "thin"
-- creative beside provider-request Offers whose cards carry a logo, a brand
-- and copy from their response parser. These are the same five creative
-- fields, authored directly (a static Offer has no response to parse).
-- All NULL by default: an unedited Offer renders exactly as before (brand =
-- Provider, then Offer name). See src/leadgen/static-creative.ts.
ALTER TABLE leadgen_offers ADD COLUMN static_brand_name TEXT;
ALTER TABLE leadgen_offers ADD COLUMN static_logo_url TEXT;       -- https:// URL or a Media-library /media/<key> path
ALTER TABLE leadgen_offers ADD COLUMN static_headline TEXT;
ALTER TABLE leadgen_offers ADD COLUMN static_subheadline TEXT;
ALTER TABLE leadgen_offers ADD COLUMN static_disclaimer TEXT;
