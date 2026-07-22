# Decisions D1–D5 — P0 Consolidated Review

## D1 — Runtime byte cap

Engine at 46,008/46,080; new visitor behavior needs ≈ +5KB ⇒ **recommend 51,200 (50 KiB), FINAL for this program, per-feature ledger** (precedent D-4/D-1). Cost ≈ 1ms parse on mid-range mobile.

**Decision:** ☐ PENDING — collected at the P0 consolidated review

**Owner ruling:**

**Downstream effect:** P2 runtime byte work + build cap constant.

---

## D2 — Existing routing rules

Migrate conditions/multiplier/redirect intact with target = their funnel (behavior-neutral today) + a re-pointing report (recommended) — or drop them (early-stage data).

**Decision:** ☐ PENDING — collected at the P0 consolidated review

**Owner ruling:**

**Downstream effect:** M3 row migration content.

---

## D3 — Feed Name consumer

Mechanism ships end-to-end (rule → outcome/analytics/`ctx.feed_name` payload node); name the downstream consumer (offer payload field? S2S param?) for any wiring beyond the stamp.

**Decision:** ☐ PENDING — collected at the P0 consolidated review

**Owner ruling:**

**Downstream effect:** M10 wiring beyond stamp.

---

## D4 — Site logos

Code renders real logos + honest placeholder; uploading actual assets in Site settings is yours (or name the correct source if not `site_settings.logo_media_id`).

**Decision:** ☐ PENDING — collected at the P0 consolidated review

**Owner ruling:**

**Downstream effect:** Data task, not code.

---

## D5 — Auction-domain rules UI

Relocates to the Auction tab (recommended) — or an "Advanced" drawer in the funnel tab.

**Decision:** ☐ PENDING — collected at the P0 consolidated review

**Owner ruling:**

**Downstream effect:** Where auction-domain rules UI renders.
