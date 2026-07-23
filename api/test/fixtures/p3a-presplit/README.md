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
