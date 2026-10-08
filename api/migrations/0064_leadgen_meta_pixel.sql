-- LeadGen: Facebook (Meta) events for LeadGen funnels — browser pixel at the
-- funnel level, and the per-click event at the offer level (adapting 0058).
--
-- Owner, 2026-10-08: "we want to fire the browser side event to facebook, the
-- system should support it in the offer level, including the generated click
-- revenue value ... and also server side event". Rulings the same day:
--   R1 "Every click" — every banner click is its own event (no per-visitor
--      dedupe);
--   R2 "Offer + funnel, like [the reference funnel]" — offer level: Purchase
--      (configurable) on click, value = the click's bid x a multiplier
--      (default 1); funnel level: PageView on load, Lead after the first
--      answer, AddToCart when offers show. Browser + server events for the
--      click share ONE event id.
--
--   leadgen_funnels.meta_pixel_id
--       The funnel's Facebook pixel (dataset) id — digits only, NULL = no
--       pixel on this funnel's pages. Kill-safe: every existing funnel gets
--       NULL (nothing loads).
--   leadgen_offers.clickout_meta_value_multiplier
--       The value sent with an offer's click event, when the offer has no fixed
--       clickout_meta_value: the clicked card's USD bid x this multiplier.
--       Default 1 (the bid itself) for every existing row.
ALTER TABLE leadgen_funnels ADD COLUMN meta_pixel_id TEXT;
ALTER TABLE leadgen_offers ADD COLUMN clickout_meta_value_multiplier REAL NOT NULL DEFAULT 1;
--
-- The offer event's default name moves from "Lead" to "Purchase" for offers
-- switched on from now on (R2). A 0058 row that is ALREADY switched on with no
-- saved name meant "Lead"; pin it so no live offer changes event under the
-- operator. Conditional and idempotent (only NULL names on switched-on rows).
UPDATE leadgen_offers SET clickout_meta_event_name = 'Lead'
 WHERE clickout_meta_conversion = 1 AND clickout_meta_event_name IS NULL;
