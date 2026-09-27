-- LeadGen: fire a Meta (Facebook) conversion when a visitor CLICKS OUT of a
-- "Static — no provider request" Offer (calls_provider_api = 0).
--
-- Source ask (marketing, 2026-09-17): partners with no API give us no
-- conversion signal at all, so the Meta campaigns sending that traffic have
-- nothing to optimise on. The clickout is the only signal we own. This is a
-- MEDIA signal only — it books no LeadGen revenue, writes no conversion row and
-- never touches the matched-conversion S2S path (§26), which keeps firing only
-- on a real /lg/pb or /lg/px conversion.
--
-- Kill-safe by construction: every existing Offer gets 0 (do not fire). The
-- Meta dataset (pixel) and the Conversions API token are NOT stored here — they
-- are the ones LeadGen's media platform row `facebook` already owns
-- (leadgen_media_platforms.postback_url_template + auth_secret_ref), so there
-- is still exactly one place a Meta identifier lives.
--
--   clickout_meta_conversion       0 | 1 — the switch (runtime also requires
--                                  calls_provider_api = 0)
--   clickout_meta_event_name       Meta standard event name; NULL = 'Lead'
--   clickout_meta_value            value reported to Meta per clickout; NULL =
--                                  none (a click is not a sale — never guess)
--   clickout_meta_test_event_code  Meta Events Manager "Test events" code;
--                                  set it to see a test click arrive live,
--                                  clear it to go live
ALTER TABLE leadgen_offers ADD COLUMN clickout_meta_conversion INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leadgen_offers ADD COLUMN clickout_meta_event_name TEXT;
ALTER TABLE leadgen_offers ADD COLUMN clickout_meta_value REAL;
ALTER TABLE leadgen_offers ADD COLUMN clickout_meta_test_event_code TEXT;
