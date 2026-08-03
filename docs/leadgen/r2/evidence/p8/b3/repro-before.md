# B3 before-fix reproduction (conductor-driven, real browser)
HEAD f240788, wrangler dev :8901, Playwright Chromium 1280x900, 2026-08-03.

Fixture: 4 funnels in quote lgq_01KZ271383Y0MPV4BM2WKKCC4W —
A lgf_01KZ271383F5X1SQ3DXTXKNJE5 (default, editor-selected; theme = {theme_id: thm_p8-repro}),
B lgf_01KZ279RVPT0Z7SX8GE81KSAVM, C "P8-Charlie" lgf_01KZ279RW7CMXCDT9JF8WJG30E, D lgf_01KZ279RWTSZB5054A8Q9WBQ7X.

Drive: on the Funnel builder board, clicked the Theme chip on FUNNEL 3 (P8-Charlie) — every
chip is the static literal "Theme" (funnel.ts:447) — landed on the Themes tab, expanded the
Brand primary role row, clicked the success-green swatch.

Network (real requests, unfiltered): the island loaded and wrote FUNNEL A:
  GET  /api/admin/leadgen/funnels/lgf_01KZ271383F5X1SQ3DXTXKNJE5/theme -> 200
  PUT  /api/admin/leadgen/funnels/lgf_01KZ271383F5X1SQ3DXTXKNJE5/theme -> 200   <-- WRONG FUNNEL (A, not Charlie)

Storage after (GET both):
  funnel A theme.palette.brand_primary = "success"  <-- write landed on A, AND clobbered the
      {theme_id: thm_p8-repro} record reference into an inline palette (identity loss both ways)
  funnel C theme = null                              <-- Charlie untouched, no status message

Matches contract R6-1 verbatim ("The Themes island's only funnel source is
#lg-quote-editor[data-funnel-public-id]"). Screenshot: b3-before-wrong-target-1280.png
