-- 0066_leadgen_redirect_after_shown.sql
-- LeadGen F11 (owner, 2026-08-24; plan approved "Final" 2026-11-11, updated
-- and approved again 2026-11-19): "Redirect to offer" can show the chosen
-- Offer in a "match" banner (or only an animation) with a countdown, then open
-- it, for any Offer. Four plain, additive ADD COLUMNs (no CHECK constraint is
-- touched, so the full-table-recreation ritual does not apply). Every existing
-- row keeps today's behavior: NULL / 0 means "nothing new happened".
--
--   leadgen_funnel_rules.redirect_show_seconds
--       NULL  = "Straight away, before the auction" (today's redirect).
--       2..30 = "After the offer is shown": the auction runs as normal, and the
--               results page shows the chosen Offer's card for this many
--               seconds, then opens it. The 2..30 range is enforced by the
--               admin save handler (a 2-second floor keeps the card's
--               >=1s impression rule satisfied before the page's own click).
--   leadgen_funnel_rules.redirect_display
--       What the visitor sees with "After the offer is shown": NULL or
--       'banner' = the redirect banner around the chosen card; 'animation' =
--       only the animation (no banner, no card). Closed values, checked by the
--       admin save handler. Ignored when redirect_show_seconds is NULL.
--   leadgen_auction_result_log.redirect_json
--       What an "After" rule did for this visitor's auction, NULL when no
--       "After" rule matched: {rule_id, offer_id, outcome} with outcome one of
--       "opened" | "held_back" | "no_card". Read-only evidence for comparing a
--       rule's two halves; nothing reads it to decide anything.
--   leadgen_analytics_offer.redirect_clicks
--       The ClickHouse lg_offer_daily mirror's new count: clicks the page made
--       when an "After" countdown ended (click_source = 'redirect'). They stay
--       included in `clicks`; visitor clicks = clicks - redirect_clicks.
ALTER TABLE leadgen_funnel_rules ADD COLUMN redirect_show_seconds INTEGER NULL;
ALTER TABLE leadgen_funnel_rules ADD COLUMN redirect_display TEXT NULL;
ALTER TABLE leadgen_auction_result_log ADD COLUMN redirect_json TEXT NULL;
ALTER TABLE leadgen_analytics_offer ADD COLUMN redirect_clicks INTEGER NOT NULL DEFAULT 0;
