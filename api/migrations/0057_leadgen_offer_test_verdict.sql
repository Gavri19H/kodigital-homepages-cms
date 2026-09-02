-- OWNER 2026-09-03: "No results at all appear now, when the funnel is
-- complete." Both of his live Offers were excluded from the auction BEFORE any
-- provider call with reason `test_untested`, so nothing was ever surfaced and
-- the visitor got an empty page.
--
-- WHY: §5.1 eligibility (validation.ts dynamicAuctionEligibility) requires a
-- passing provider Test, and `last_test_status` was DERIVED at read time from
-- the newest Test-tool row in `leadgen_provider_request_log`:
--
--   SELECT CASE WHEN prl.status_code BETWEEN 200 AND 299 THEN 'passed' … END
--     FROM leadgen_provider_request_log prl
--    WHERE prl.offer_public_id = o.public_id AND prl.auction_instance_id IS NULL
--    ORDER BY prl.created_at DESC LIMIT 1
--
-- …but that table is PRUNED to 7 days by the §30.3 retention cron
-- (retention.ts PROVIDER_LOG_RETENTION_SECONDS = 7 * 24 * 3600). So every
-- dynamic Offer in this product silently went ineligible exactly 7 days after
-- its last Test run, and the funnel went blank with no operator-visible
-- warning. His data shows it exactly: the oldest surviving row in that table
-- equals now-7d, his last FILLED auction was 2026-08-30 08:35 and every
-- auction from 2026-09-01 15:43 onward carries
-- offers_excluded_json=[{…,"reason":"test_untested"},{…,"reason":"test_untested"}]
-- with zero provider_request_log rows.
--
-- A gate that decides whether an Offer may earn money must not read a log with
-- a TTL. The verdict now lives on the Offer row, written when a Test runs and
-- when a live auction call succeeds, and is never pruned.
--
--   last_test_status  'passed' | 'failed' | NULL (never tested)
--   last_test_at      unix seconds of the call that produced the verdict
--   last_test_source  'test' (Test tool) | 'auction' (a live provider call)
ALTER TABLE leadgen_offers ADD COLUMN last_test_status TEXT;
ALTER TABLE leadgen_offers ADD COLUMN last_test_at INTEGER;
ALTER TABLE leadgen_offers ADD COLUMN last_test_source TEXT;

-- BACKFILL from whatever the 7-day window still holds, so an Offer that is
-- demonstrably working does not need a fresh Test click to keep serving. A
-- Test-tool row wins over an auction row at the same recency (ORDER BY the
-- IS NULL flag first), and only a 2xx/non-2xx row can produce a verdict — a
-- transport-error row (status_code IS NULL) stays NULL exactly as the old
-- read-time CASE treated it as 'untested'.
UPDATE leadgen_offers SET
  last_test_status = (
    SELECT CASE WHEN prl.status_code >= 200 AND prl.status_code < 300 THEN 'passed' ELSE 'failed' END
      FROM leadgen_provider_request_log prl
     WHERE prl.offer_public_id = leadgen_offers.public_id
       AND prl.status_code IS NOT NULL
     ORDER BY (prl.auction_instance_id IS NULL) DESC, prl.created_at DESC, prl.id DESC
     LIMIT 1),
  last_test_at = (
    SELECT prl.created_at
      FROM leadgen_provider_request_log prl
     WHERE prl.offer_public_id = leadgen_offers.public_id
       AND prl.status_code IS NOT NULL
     ORDER BY (prl.auction_instance_id IS NULL) DESC, prl.created_at DESC, prl.id DESC
     LIMIT 1),
  last_test_source = (
    SELECT CASE WHEN prl.auction_instance_id IS NULL THEN 'test' ELSE 'auction' END
      FROM leadgen_provider_request_log prl
     WHERE prl.offer_public_id = leadgen_offers.public_id
       AND prl.status_code IS NOT NULL
     ORDER BY (prl.auction_instance_id IS NULL) DESC, prl.created_at DESC, prl.id DESC
     LIMIT 1)
WHERE EXISTS (
  SELECT 1 FROM leadgen_provider_request_log prl
   WHERE prl.offer_public_id = leadgen_offers.public_id
     AND prl.status_code IS NOT NULL);
