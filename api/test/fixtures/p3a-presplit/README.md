# p3a-presplit parity fixtures

Re-captured at `5ccf40e` post-P2; the split's purity was adversarially proven at
`8d43e10`; from here the parity test (`test/leadgen-p3a-split-parity.test.ts`)
pins current SSR as a regression guard.

## What these are

Byte-exact SSR snapshots of every page `ui-quotes.ts` serves (List empty/seeded,
New, Editor + its six tab panels), produced by `src/scripts/capture-p3a-presplit.ts`
against the real admin router on the node:sqlite D1 harness. The parity test
re-renders the same seeded fixture through the current code and asserts
byte-identical output (modulo minted ids, `computed_at`, and the rolling
`data-analytics-from` / `data-analytics-to` window, which the test normalizes).

## Re-capture ritual

Run from `api/`:

    npx tsx src/scripts/capture-p3a-presplit.ts

Then `npx vitest run test/leadgen-p3a-split-parity.test.ts` → 12/12.

During P3b the funnel-builder tab's SSR is rebuilt into the board (§8.2), so the
`editor-panel-builder.html` and `editor-full.html` fixtures legitimately change —
re-capture them with this same command at the END of the board work. The parity
test keeps pinning the OTHER tabs (templates/themes/ab/activation/analytics + the
list/new/not-found pages) against accidental drift while the funnel tab is rebuilt.

2026-07-23 re-capture (P3b adversarial-review FIX-FIRST round): the S3b.2 rail
slice's own fix round changed `QUOTE_RULES_SCRIPT` bytes (an SSR/client
attribute-parity fix — the rail's client-side row builder now sets `data-qr-*`
hooks + `role`/`aria-label` the SSR renderer already emitted, closing a gap a new
round-trip journey found), which rides inside `editor-full.html` (that script tag
sits after every `data-panel` region, so it never touches the six tab-panel
fixtures — confirmed: only the "full page" case failed, all 6 "tab panel" cases
stayed green). Re-capture scope-verified byte-for-byte (ids normalized): every
changed byte fell strictly inside the trailing `<script>` region past the last
`data-panel="analytics"` boundary — zero panel markup changed. Re-captured with
this same ritual; see the git history for the exact `editor-full.html` diff.

2026-07-29 re-capture (R2 P2 leftovers round — joint recapture after S2a/S2b/S2c):
`editor-full.html` (never re-captured for either S2a or S2b individually — the
`README`'s own "re-capture at the END of the board work" convention was
followed for S2a/S2b too), `editor-panel-builder.html` and
`editor-panel-templates.html` changed; `editor-panel-themes.html` was already
current (S2b's own recapture — byte-identical, zero further drift) and
`editor-panel-ab.html` / `editor-panel-activation.html` /
`quotes-list-{empty,seeded}.html` changed ONLY in minted ids / the rolling
analytics window (normalized, zero structural change). Classification of
every real (normalized) content line, cross-referenced to each slice's own
commit: **1078 real lines total — 450 S2a (`fe00199`, self-audited "zero
unclassified" at capture time; embedded copy inside `editor-full.html` simply
hadn't caught up yet) / 330 S2b (`a3c35b5`, ditto — confirmed via a byte-exact
re-check that S2b's own already-committed `editor-panel-themes.html` needed
ZERO further changes) / 298 S2c (`5707915`: `normalizedThemePut` R7 fix,
`stripIncompleteImagesForPreview`, `initSiteSelectDefault`, the retired
embedded Template-picker popover + its `gotoTab('templates')` replacement,
the `abRuledSlotCtx` A/B + Ruled slot-editor refactor enabling funnel-page
scope, the extended `ab-slot`/`slot-rule` kebab actions, the builder panel's
`min-width:0` rail fix + funnel-chip "A/B this slot"/"Slot rule" kebab
entries, and the templates panel's per-quote `myQuoteDefaultTemplateId` /
"Set as this quote's default" D5 feature) / 0 unattributed**. Verified by
reconstructing each of `editor-full.html`'s six `data-panel` regions plus its
surrounding chrome and confirming the reconstruction is byte-for-byte the
original file (both before and after), so every changed byte anywhere in the
full page is accounted for by either a named panel's own diff or the
chrome diff — no possible hiding place for an unattributed change.

2026-07-29 re-capture (P2 gate-fix round — 18db5c6 + item-2 shared.ts CSS cleanup):
`18db5c6` removed the dead `scheduleMiniPreview`/`themeMiniOpen` mini-preview
cluster from `funnel.ts` (4 call-site removals + the 44-line function/var
cluster) and the orphaned `.lg-theme-minipreview` CSS rule from `shared.ts`;
this same gate-fix round additionally removed the sibling orphaned
`.lg-minipreview-frame` CSS rule (golden-allowlist/orphan-scan gate-fix,
conductor-coordinated). Re-capture changed 8 of the 11 fixtures (`editor-full`,
`editor-panel-ab`, `editor-panel-activation`, `editor-panel-builder`,
`quotes-list-empty`, `quotes-list-seeded`, `quotes-new`, `quotes-not-found`);
`editor-panel-templates/themes/analytics.html` were already current (zero
drift). Every changed line classified against the two source diffs, 104 lines
total: 53 map to the 18db5c6 removals (5× `.lg-theme-minipreview` CSS line +
4× `scheduleMiniPreview()` call sites + the 44-line dead cluster, all in
`editor-full.html` for the funnel-script lines since only that fixture embeds
the tab's `<script>`), 5 map to this round's own `.lg-minipreview-frame` CSS
removal (one per fixture embedding `LG_QUOTES_STYLES`), and the remaining 46
are minted-id/`computed_at` regeneration noise inherent to re-running the
capture script (crypto-random ULIDs; already normalized away by the test's
own `normalizeIds`/`ID_RE`/`COMPUTED_AT_RE`, not a content change) — 0 lines
outside these three buckets.

2026-07-29 re-capture (R2 P3 S3a — element J footer upgrade): `editor-panel-templates.html`
and `editor-full.html` changed (the G · Footer box's new toolbar/heading+list
type options/font-family selector/logo toggle/Pages-picker markup + the
island's collectFooterPickRows/fetchFooterPicks/extended collectFooterBlocks
JS) — every non-id-noise line traced to this round's own diff, zero
unattributed. `editor-panel-ab.html`, `editor-panel-activation.html`,
`editor-panel-builder.html` and `quotes-list-seeded.html` also re-captured
(the script mints fresh ULIDs every run) but changed ONLY in minted ids —
confirmed byte-for-byte identical otherwise; `editor-panel-themes.html` and
`editor-panel-analytics.html` were already current (zero drift).

## Rolling analytics window (CLOSED — normalized, does not drift)

The two `quotes-list-*.html` fixtures embed `resolveTimeframe`'s default rolling
window (`data-analytics-from` / `data-analytics-to`, last 30 days ending "today").
Those two attributes are wall-clock-derived, so a bare byte-diff would drift by
one day every calendar day after capture (this is why the 2 list-page cases
failed on 2026-07-23 against a 2026-07-22 capture — a date drift, not a renderer
change; all six editor-panel fixtures matched untouched). The parity test's
`ANALYTICS_DATE_RE` normalizer closes this the same way it normalizes minted ids
and `computed_at`: both attributes are replaced with a fixed placeholder on BOTH
the rendered output and the on-disk fixture before comparison, so only a real
structural difference can fail the assertion. Durability (not just "works today")
is proven by a dedicated test that fakes the system clock to a date far past this
README's capture day and re-renders the SAME list page live — the rendered HTML
visibly carries the NEW future dates (proving the fake clock took effect,
ruling out a vacuous pass) yet still compares byte-identical to the frozen
fixture. This fixture pair therefore never needs re-capture for date drift alone
(only for an actual renderer change, like every other fixture here).
