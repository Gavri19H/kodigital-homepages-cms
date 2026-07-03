-- 0035_listicles_conversion_dedupe.sql
-- Listicles CMS — durable in-site conversion idempotency (Design Contract
-- v1.2.2 §31.7 dedupe + §9.3 conversion-cap semantics).
--
-- WHY: the browser `conversion` MONEY path (in-site payout → a
-- listicle_revenue_raw row + the §9.3 conversion-cap increment) was guarded
-- ONLY by a best-effort KV seen-set. A replayed conversion — or one whose
-- event_id was server-minted (a fresh UUID per request, NOT replay-dedupable) —
-- double-booked the payout and double-burned the cap. This durable log gives
-- those money writes a UNIQUE dedupe key so a replay is a no-op.
--
-- dedupe_key (authored, documented — see revenue-ingest.ts / listicle-track.ts):
--   * the CLIENT-provided event_id when present (stable across the client's own
--     retry/replay), ELSE
--   * a deterministic derivation `${click_id}|${page_view_id}|${offer_public_id}`
--     (page_view_id is stable per page view; the whole tuple is stable across
--     replays of the SAME conversion).
--   A conversion with NEITHER a client event_id NOR a page_view_id has no stable
--   key: it is NEVER booked (the analytics event still emits) — money is never
--   written on an underivable/ephemeral key.
--
-- The UNIQUE (click_id, dedupe_key) is the authoritative guard; the in-site
-- revenue insert is gated on this row not yet existing (single atomic db.batch),
-- and the cap increment fires only when the booking row is newly created.
CREATE TABLE IF NOT EXISTS listicle_conversion_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  click_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  offer_public_id TEXT,
  source TEXT NOT NULL DEFAULT 'in_site',
  revenue REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  booked_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (click_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_listicle_convlog_click ON listicle_conversion_log(click_id);
