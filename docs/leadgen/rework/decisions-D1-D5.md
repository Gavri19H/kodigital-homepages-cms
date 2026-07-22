# Decisions D1–D5 — P0 Consolidated Review

## D1 — Runtime byte cap

Engine at 46,008/46,080; new visitor behavior needs ≈ +5KB ⇒ **recommend 51,200 (50 KiB), FINAL for this program, per-feature ledger** (precedent D-4/D-1). Cost ≈ 1ms parse on mid-range mobile.

**Decision:** ☑ RESOLVED at the P0 consolidated review (2026-07-22)

**Owner ruling: 51,200 bytes (50 KiB), FINAL for this program, per-feature byte ledger. (P0 consolidated review, 2026-07-22)**

**Downstream effect:** P2 runtime byte work + build cap constant.

---

## D2 — Existing routing rules

Migrate conditions/multiplier/redirect intact with target = their funnel (behavior-neutral today) + a re-pointing report (recommended) — or drop them (early-stage data).

**Decision:** ☑ RESOLVED at the P0 consolidated review (2026-07-22)

**Owner ruling: MIGRATE — conditions/multiplier/redirect intact, target = owning funnel (behavior-neutral), re-pointing report delivered. (2026-07-22)**

**Downstream effect:** M3 row migration content.

---

## D3 — Feed Name consumer

Mechanism ships end-to-end (rule → outcome/analytics/`ctx.feed_name` payload node); name the downstream consumer (offer payload field? S2S param?) for any wiring beyond the stamp.

**Decision:** ☑ RESOLVED at the P0 consolidated review (2026-07-22)

**Owner ruling: STAMP-ONLY — mechanism ships end-to-end (outcome/analytics/ctx.feed_name mappable); no additional consumer wired now; M11 formatCurrency NOT requested. (2026-07-22)**

**Downstream effect:** M10 wiring beyond stamp.

---

## D4 — Site logos

Code renders real logos + honest placeholder; uploading actual assets in Site settings is yours (or name the correct source if not `site_settings.logo_media_id`).

**Decision:** ☑ RESOLVED at the P0 consolidated review (2026-07-22)

**Owner ruling: site_settings.logo_media_id CONFIRMED as source; owner uploads real logo assets (operator-owned OP-2). (2026-07-22)**

**Downstream effect:** Data task, not code.

---

## D5 — Auction-domain rules UI

Relocates to the Auction tab (recommended) — or an "Advanced" drawer in the funnel tab.

**Decision:** ☑ RESOLVED at the P0 consolidated review (2026-07-22)

**Owner ruling: AUCTION TAB — the four auction-domain rule types relocate their UI to the Auction tab. (2026-07-22)**

**Downstream effect:** Where auction-domain rules UI renders.
