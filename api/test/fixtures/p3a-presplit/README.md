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

2026-07-30 re-capture (R2 P6 terminal): exactly TWO fixtures changed —
`editor-panel-ab.html` and `editor-full.html`; the other nine were re-run through
the same ritual and restored byte-for-byte from their pre-capture bytes after a
normalized diff proved they carried ZERO content change (fresh ULIDs only), so
their sha256s are unchanged. 39 real (normalized) changed lines, all three hunks
classified, 0 unattributed:

* **hunk 1 — 4 lines, both fixtures** (`9ab6baa`, `ab.ts` +36/-1): the A/B tab's
  add-variant affordance now states the requirement before the failing action —
  `#lg-add-variant` gains `data-add-variant-state="no-test" disabled
  aria-disabled aria-describedby=lg-add-variant-why` + a `title`, plus the
  `data-ab-order` required-order line and the `data-add-variant-blocked` reason
  element. This is the only A/B-tab change; nothing else in
  `editor-panel-ab.html` moved.
* **hunk 2 — 17 lines, `editor-full.html` only** (`9449528`, `funnel.ts` +16/-1):
  `loadThemePresetOptions` moves its `var keep = sel.value` snapshot inside the
  `.then` (resolve time, not pre-fetch) + its 15-line rationale comment. This
  commit recaptured NO fixture, which is why the "full page is byte-identical"
  leg was already failing at `9ab6baa` before this round: the leg is **stale
  capture, not an unsound assertion and not a product defect**.
* **hunk 3 — 18 lines, `editor-full.html` only** (`9ab6baa`, `funnel.ts` +18):
  `addVariantBlockedReason()` + the guard it adds to `forkWithAllocation`, so the
  Themes tab's "A/B this theme" reads hunk 1's attribute and names the next step
  instead of prompting into the 409.

Hunks 2 and 3 live in the trailing `<script>` region outside every `data-panel`
div (`P6 D3 FIX` and `addVariantBlockedReason` appear in ZERO panel fixtures;
the only `data-panel=` occurrence past them is a JS string literal at full-page
line 6741), so no per-tab fixture can catch that class of change — only
`editor-full.html` — the same structural situation as the 2026-07-23 note above.
Determinism re-proven this round: the capture script was run twice and both
changed fixtures were byte-identical between runs after normalization, ruling
out any new un-normalized wall-clock/entropy source in the full page.

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

2026-08-02 re-capture (R2 F-3 — the two SIZE rails): exactly TWO fixtures
changed, `editor-panel-themes.html` and `editor-full.html`. The Themes rail's
"Button height" select gained an `s`/Small option (its vocabulary now reads the
exported `THEME_BUTTON_MIN_HEIGHTS`, widened to the full shared s/m/l ladder
instead of a hand-typed `["m","l"]`), a NEW "Fields" group with a "Field height"
select (`field_defaults.min_height`) was added below Buttons, and the shared
preset-resolve island gained its two new bridges
(`PRESET_BUTTON_SIZE_BRIDGE`/`PRESET_FIELD_HEIGHT_BRIDGE`) plus the corrected
"what the fork carries" comment. Both are needed because a preset's Field height
and Button size had NO inline counterpart and were silently discarded the moment
the operator's first rail edit forked `theme_json` (measured on the live page:
painted field 60px -> 44px, button 60px -> 52px, after editing one colour).
Scope-verified: `editor-panel-{ab,activation,analytics,builder,templates}`,
`quotes-list-{empty,seeded}`, `quotes-new` and `quotes-not-found` were
re-captured by the same ritual and RESTORED byte-for-byte from their pre-capture
bytes after the diff proved minted-id noise only — 12/12 green afterwards.

2026-08-02 re-capture (P7 D2 fallout — the dead-island removal's own fixture
debt, plus R1/R3): `87f64f0` changed the editor page twice (the ADJ-N8
rules-label value side, and the removal of the dead §4.1 frame-studio island)
and deliberately did NOT re-capture, leaving this fixture red. Re-captured
here together with this round's own three edits. NINE fixtures changed;
`editor-panel-analytics.html` and `editor-panel-themes.html` were re-captured
by the same ritual and came back byte-identical (sha256 unchanged, no restore
needed).

Every differing NORMALIZED line classified, five buckets, `editor-full.html`
487/487 attributed (39 hunks), **0 unexplained**:

| bucket | hunks | -del | +add | lines |
|---|---|---|---|---|
| 87f64f0 dead frame-studio island (canvas state, 11 `schedulePreview()` call sites, region click-select, the viewport/preview-mode/stepper toolbar, structure-panel slide selection) | 13 | 307 | 28 | 335 |
| 87f64f0 ADJ-N8 rules-label value side (`fmtValue`/`rowSentence`/`cardSentence`/`makeValueOf`/`valueText` + the choice map on `answerFields`) | 19 | 25 | 84 | 109 |
| R1 preview-safe images guard (`previewSafeImageHref` + `imageRowRenderable` in `quotes-tabs/templates.ts`, keeping the pinned no-source short-circuit verbatim) | 2 | 2 | 31 | 33 |
| R3 stale operator copy (the persona-image error no longer points at the deleted "canvas toolbar, above") | 1 | 1 | 5 | 6 |
| R3 dead CSS (`.lg-canvas-toolbar`, `.lg-slot-banner`, `.lg-structure-row button[data-select-slide]`, `.lg-step-controls` — grep-proven zero emitters) | 4 | 4 | 0 | 4 |

The four `quotes-*.html` list pages differ by exactly those 4 CSS lines and
nothing else (they embed `LG_QUOTES_STYLES`); `editor-panel-templates.html`
differs by exactly the 33-line R1 guard; `editor-panel-{ab,activation,
builder}.html` differ by minted ids only (0 normalized lines). The dead-CSS
removal note lives in TypeScript ABOVE the `LG_QUOTES_STYLES` template literal,
not inside it, so it costs 0 served bytes on every leadgen admin page.

2026-08-02 re-capture (P7 owner defect B2 — the dead funnel Preview button):
exactly ONE fixture changed, `editor-full.html`
(`88f5e69b…` -> `f4690b4c…`). `quotes-tabs/funnel.ts`'s `previewFunnel` read
`res.body.html || res.body.preview_html` from `POST /variants/:id/preview`, keys
that response has NEVER carried — it answers `{preview:{css,desktop,mobile,
section_count,auction_entry_position},config}` for an empty body and
`{preview:{css,html|pages,section_count},config}` for a v2.5 body — so every 200
produced `html === ''`, closed the freshly-opened tab and showed the generic
"Something went wrong. Please try again." banner. The read now takes
`res.body.preview` (the SAME nesting `templates.ts` and `themes.ts` have always
used) and wraps the returned markup + chrome CSS in a document for the new tab.

Classification: **18 real (normalized) lines, -3/+15, ALL inside `previewFunnel`,
0 unattributed** — the 3 deletions are the old `var html` / `!html` guard /
`Blob([html])` lines and the 15 additions are the new `res.body.preview` read,
the `p.desktop || p.html` pick, the 4-line document builder and 7 comment lines.
Same structural situation as the 2026-07-23 and 2026-07-30 notes: `previewFunnel`
sits in the trailing `<script>` region past every `data-panel` div, so no per-tab
fixture can catch it — only `editor-full.html`, and indeed only the "full page"
leg failed while all six tab-panel legs stayed green.

Scope-verified: `editor-panel-{ab,activation,builder}.html` and
`quotes-list-seeded.html` were re-captured by the same ritual and RESTORED
byte-for-byte from their pre-capture bytes after the classifier (which applies
this test's OWN `ID_RE`/`COMPUTED_AT_RE`/`ANALYTICS_DATE_RE` normalizers) proved
0 normalized differing lines — minted-ULID noise only; `editor-panel-
{analytics,templates,themes}.html`, `quotes-list-empty.html`, `quotes-new.html`
and `quotes-not-found.html` came back byte-identical with no restore needed. Ten
of the eleven sha256s are therefore unchanged from the previous capture. 12/12
green afterwards.
