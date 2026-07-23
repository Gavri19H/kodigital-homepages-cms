# p3a-presplit parity fixtures

Re-captured at `5ccf40e` post-P2; the split's purity was adversarially proven at
`8d43e10`; from here the parity test (`test/leadgen-p3a-split-parity.test.ts`)
pins current SSR as a regression guard.

## What these are

Byte-exact SSR snapshots of every page `ui-quotes.ts` serves (List empty/seeded,
New, Editor + its six tab panels), produced by `src/scripts/capture-p3a-presplit.ts`
against the real admin router on the node:sqlite D1 harness. The parity test
re-renders the same seeded fixture through the current code and asserts
byte-identical output (modulo minted ids + `computed_at`, which the test
normalizes).

## Re-capture ritual

Run from `api/`:

    npx tsx src/scripts/capture-p3a-presplit.ts

Then `npx vitest run test/leadgen-p3a-split-parity.test.ts` → 11/11.

During P3b the funnel-builder tab's SSR is rebuilt into the board (§8.2), so the
`editor-panel-builder.html` and `editor-full.html` fixtures legitimately change —
re-capture them with this same command at the END of the board work. The parity
test keeps pinning the OTHER tabs (templates/themes/ab/activation/analytics + the
list/new/not-found pages) against accidental drift while the funnel tab is rebuilt.

## Known fragility (flag for the harness owner — outside P3b S3b.1 ownership)

The two `quotes-list-*.html` fixtures embed a rolling analytics window
(`data-analytics-from` / `data-analytics-to`, from `resolveTimeframe`'s default =
last 30 days ending "today"). Those two attributes are wall-clock-derived and the
parity test does NOT normalize them (it only normalizes ids + `computed_at`), so
these fixtures drift by one day every calendar day and must be re-captured on the
day the suite runs. This is why the 2 list-page cases failed on 2026-07-23 against
a 2026-07-22 capture — a date drift, not a renderer change (all six editor-panel
fixtures matched untouched). A durable fix is a `data-analytics-(from|to)`
normalizer in the parity test, which is not in this slice's file ownership.
