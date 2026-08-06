# CLOSE findings — committed-spec debt surfaced by the terminal battery (pre-P8, disclosed)

Three distinct roots among the terminal battery's pre-existing reds and side effects. All
predate P8 (identical at baseline `f2407886` and HEAD under the clean comparable protocol);
none is silently deferred — each is a named register row for the owner's fix-or-defer ruling.

## 1. A spec overwrites committed screenshot baselines on every run (ADJ-P8-57)
`test-ui/leadgen-rework-p4-themes.gesture.spec.ts:307,311` calls
`locator.screenshot({ path: "test-ui/__screenshots__/leadgen-rework-p4/themes-canvas-{1280,375}.png" })`
— it writes the CURRENT render over the COMMITTED baseline files on every run (observed:
both PNGs dirty after every battery/comparable run; restored from HEAD each time, twice this
session, content-level diffs e.g. 5,915 → 14,774 bytes). Any run before a gate breaks the
`status-empty=yes` discipline; any accidental `git add -A` would silently rebaseline.
Fix shape if taken: write to `test-results/` (like every other capture in the file's suite).

## 2. Fixture-dependency 404s: a drive spec pins ids the seed never creates (ADJ-P8-58)
`test-ui/__r2-dead-controls-drive.spec.ts` (both tests) PATCHes a hardcoded `themes/${THEME}`
and PUTs `quotes/${QUOTE}/activation/${SITE}` → `{"error":"Not Found"}` / expected 200 got
404, identically at BOTH shas (comparable logs, base + head). The spec never reaches its
paint assertions, so it currently proves nothing about the dead-controls clause it was
written for (P8-3's 34/34-ALIVE sweep instrument is the live proof of that clause, three
identical runs — see the P8-3 rows). Fix shape if taken: self-seed via the real routes, the
convention every `p8n_*`-keyed spec follows.

## 3. Firefox-only height/corner drag class, pre-existing (ADJ-P8-59)
`forensic-live-probe.spec.ts:186` (P3 S/height N/S drag) and
`leadgen-canvas-interactions.gesture.spec.ts:184,226` ((iii) N/S height drag writes
height custom_px + chip; (iv) corner drag changes BOTH width and height) — red at BOTH shas,
firefox project only, same interaction family (real-input vertical/corner drags on the studio
canvas). Chromium legs pass. Yesterday's baseline run additionally showed
`canvas-interactions` at f=7 vs today's f=2 — the firefox gesture area is also
run-to-run unstable. Not P8-caused; needs its own root-cause session on the firefox
real-input path.

## 4. `leadgen-rework-p4-themes` Card-in-Answer-layout red, pre-existing (ADJ-P8-60)
`test-ui/leadgen-rework-p4-themes.gesture.spec.ts:279` ("picking Card in Answer layout
re-renders the canvas showing title/subtitle cards") — red at BOTH shas, BOTH engines, since
before P8-1. Cause unmeasured (pre-P8); the related #11E builder legs (green at base, red at
HEAD in the battery) had a DIFFERENT root — the theme-PATCH 500, fixed at CLOSE
(w1-theme-patch-500.md), after which #11E passes every run.

## 5. quote-builder ⑤→⑥ shared-seed order dependency + ② long-process dialog race (ADJ-P8-61)
Measured at CLOSE (W2b, bounded item): ⑥ fails 4/4 in full-file serial runs (two of them fully
fresh D1 + fresh wrangler) because ⑤ mutates the shared seed funnel's `trust_strip.enabled`
first, leaving ⑥'s confirm list nothing to name; ⑥ passes in isolation. ② timed out once under
a long-lived wrangler-dev process, 0/4 under fresh processes. The copy-drift halves (④
"slides"→"sections", the confirm-list sentences) were re-minted to `computeTemplateApply`'s
shipped wording at CLOSE; the order dependency and the race are spec-design debt.

## 6. Preset-corner specs joined ADJ-P8-36's blast radius (expected-fail pending the ruling)
`leadgen-r2p6-f1-preset-corners-drive.spec.ts` + `leadgen-r2p6-f1b-…-drive.spec.ts`: theme
apply succeeds and `questionCard.borderRadius` computes correctly, but themed-frameless
funnels synthesize onto `serve.ts` `NARROW_DEFAULT_THEMED_FRAME_CONFIG_JSON`
(`template:"minimal"`), whose `section_slot.card:"bare"` zeroes `.lg-question-card`
border-radius (P8-4 F8/F9) — the exact surface ADJ-P8-36 asks the owner to rule on. Fixing
either side pre-empts the ruling; both specs are expected-fail until it lands.
