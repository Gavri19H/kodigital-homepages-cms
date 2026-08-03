# P8 Mission Tracker

Plan: approved 2026-08-03 (binding). Contract: `P8-DEFECT-CONTRACT.md` v3 @ f240788.
Base branch `reconcile/conversions-x-leadgen-r2`; one squash PR per phase; conductor merges on
gate + SHIP; owner deploys only at program end. Baseline: 7662/0/30 (471 files) · typecheck 0 ·
verify:all 0 · runtime 52,762 ≤ 53,248.

## Phases

- [ ] P8-1 Blockers I (B2, B3, B1, ThemeRecord re-verify) — branch `leadgen-r2-p8-1`
      Review #1 @ 43e7219 (Opus 5, fresh context, drove all journeys): **FIX-FIRST** — 3 blockers, 5 majors, 5 minors.
      B-1 branch HEAD red + gate log's green run was NOT HEAD (conductor error: the suite was re-run after the
      pin-fix commit but NOT after the cross-IIFE fix commit, which also left the p3a byte-pin stale).
      B-2 B3 is a symptom patch — the carry clears on any plain tab click, so chip→Activation→Themes→edit still
      writes to Funnel A (both chips); owner's original sentence reproduces. B-3 B1 fill writes the store but never
      the visible inputs, and stamps an unseen ZIP as user_selected on the money path (conductor wrongly blamed
      Google's key). M-1 roles.card certified ALIVE while MIS-TARGETED. M-2 conductor's after.md said 10px→9999px
      where its own artifact says 10px→20px. M-3 B3 row omitted its own recorded residuals. M-4 test arithmetic −1
      unexplained. M-5 no 375 evidence for B3.
      Confirmed clean by the review: §1 no-hardening (no new gates/validators), out-of-scope items untouched,
      all 5 test-pin re-mints legitimate, bundle ≤ cap, B2 verified on a key the conductor never used (incl.
      multi-funnel + variant-level override), direct chip path correct from all four chips.
      Fix round dispatched: F1 (B-2 root, Opus — tier-escalated after 2 failures), F2 (B-3 root, Opus),
      F3 (sweep verdicts: add MIS-TARGETED + DEAD, Sonnet).
      M-4 settled by measurement: baseline re-run at f240788 in a throwaway worktree = **7662 passed / 30 skipped
      (471 files)** — the contract's number is correct, so one PRE-EXISTING test stopped registering at HEAD
      (static it() blocks are +16 with zero removals; the 5 touched files match baseline per-file exactly).
      Per-file baseline map captured for an exact diff at the post-fix gate run.
- [ ] P8-2 Blockers II (B4, B5, M9.3)
- [ ] P8-3 Theme keys honoured (M2, N1, N7, N11, N18, N20 + 80-key sweep) — branch `leadgen-r2-p8-3` off base `6649879`
      **Conductor reproduction FIRST** (contract numbers are from an older sha and two have already been
      falsified): all six R3 claims re-measured by hand through the real PUT route, reading
      getComputedStyle on the first VISIBLE match — every claim reproduces, two of them STRONGER
      (radius/border_role targets match ZERO nodes, not 0×0; scales.shadow is dead not PARTIAL).
      Evidence `evidence/p8/m2/repro-before.{md,txt}`, probe `api/scripts/p8/repro-m2-inline.mjs`.
      ONE CAUSE under four of six: `.lg-question-card` reads a frozen literal token block
      (tokens.ts:79 → styles.ts:569-574) that no theme layer writes, while the whole `card_defaults`
      group resolves onto `.lg-card-panel`/`.lg-disclosure-panel` — components no driven page renders.
      Slices ran as 12, not the planned 3 — each new one answered a defect the previous one MEASURED:
      S3.1 emitter+tokens+N18 · S3.2 theme-UI minors · S3.4 the 34-key sweep instrument · S3.3 guard
      (129 keys, re-predicated) · S3.5 N1's 4th control (found unallocated by a scout) · S3.6 the 2
      palette defects the sweep found · S3.7 the false-choice design select at its producer · S3.8
      reach the 5 unmeasurable states · S3.9 the error role · S3.10 accent + 2 unreachable rules ·
      S3.11 role "Used by" text · S3.12 the last hardcoded sweep verdict.
      **Final inline sweep: 34/34 ALIVE, 0 DEAD, 0 MIS-TARGETED, 0 UNMEASURABLE** (3 identical runs).
      NOTE: S3.11 changes admin markup, so p3a needs a SECOND recapture before the gate.
- [ ] P8-4 Templates (M3, M1, M10, M9.1/.2/.4/.5, R7, N6, N9, N12, N17)
- [ ] P8-5 Studio truth (M5, M6, M7, M4, R6-2/3/4, N14, N15, N16, REQ-R5)
- [ ] P8-6 Sweep & surface (M8, N2–N5, N8, N10, N13, N19, OWNER rows)
- [ ] CLOSE (terminal battery + owner-journey sweep + full-program review + report)

## Dispatch cost log

| Phase | Dispatch | Model | Tokens | Duration | Outcome |
|---|---|---|---|---|---|
| intake | scout admin-plane | haiku | 90,093 | 277s | grounded, all refs ±5 lines |
| intake | scout runtime/tests | haiku | 103,361 | 235s | grounded; tally variances noted |
| P8-1 | S1.1 B2 (sonnet) | sonnet | 114,666 | 418s | code-complete; fail-before proven (version frozen → bumps) |
| P8-1 | S1.2 B3 (sonnet) | sonnet | — | — | dispatched |
| P8-1 | S1.3 B1 (sonnet) | sonnet | 187,110 | 983s | code-complete; flat convergence; bundle 52,948 ≤ cap; flagged 3 stale pins |
| P8-1 | S1.4 probe (sonnet) | sonnet | 253,597 | 1311s | probe delivered; impl run: 18 ALIVE / 0 DEAD / 7 UNMEASURABLE; fixture residue flagged |
| P8-1 | S1.5 pin re-mints (sonnet) | sonnet | 82,035 | 227s | 3 files re-minted vs real renderer bytes; 4 failed → 447/447 |
| P8-1 | fix: canvas-r2 pin (haiku) | haiku | 76,161 | 33s | pin follows carried-funnel resolver; 30/30 |
| P8-1 | fix: cross-IIFE ReferenceErrors (sonnet) | sonnet | 285,393 | 2131s | assembled-page structural regression; both ReferenceErrors reproduce pre-fix |
| P8-1 | REVIEW #1 (opus, fresh) | opus | 280,089 | 2134s | **FIX-FIRST** — 3 blockers, 5 majors, 5 minors; drove every journey |
| P8-1 | F3 sweep verdicts (sonnet) | sonnet | 186,127 | 1269s | MIS-TARGETED+DEAD added → 17/2/1/5; REJECTED the roles.error-is-dead instruction on evidence |
| P8-1 | F2 B-3 autofill root (opus) | opus | 162,838 | 1607s | autofill enters via the real keystroke path; unseen-ZIP money-path defect gone; bundle 52,948→52,674 |
| P8-1 | F1 B-2 identity root (opus) | opus | 269,030 | 1760s | hash-persisted target + named headers + pickers; found a THIRD wrong-funnel write path (Save chain) |
| P8-1 | F4 street-content (sonnet) | sonnet | 204,798 | 1158s | composite street gets street-only; found 2 new tests had ENCODED the bug; bundle 52,938 |
| P8-3 | scout: guard + key inventory | haiku | 78,838 | 120s | guard calls the REAL producers (worth extending); vitest env node, NO jsdom/CSS parser, no-new-deps → hand cascade resolver is the only route |
| P8-3 | scout: minors N1/N7/N11/N18/N20 | haiku | 103,344 | 173s | all sites grounded; N1's 4th control is in funnel.ts (NOT the theme files) — caught an unallocated item |
| P8-3 | S3.1 theme emitter + N18 (opus) | opus | 209,845 | 1024s | code-complete; spec 11 failed → 21 passed; bundle unchanged 52,938; 0 pins re-minted; 2 residuals surfaced |
| P8-3 | S3.2 theme-UI minors (sonnet) | sonnet | 291,657 | 1330s | code-complete; 12/12; N7 fixed at the STRING (cause is in unowned files) — conductor must measure the rendered width |
| P8-3 | S3.4 34-key inline sweep (sonnet) | sonnet | 251,595 | 1404s | instrument built + run: 34/34 keys, source-enumerated, count matches the contract; ALIVE 27 / DEAD 1 / MIS-TARGETED 1 / UNMEASURABLE 5; found 2 defects the contract missed |
| P8-3 | S3.6 palette.success + palette.card_background (opus) | opus | 113,736 | 607s | WIRED success to 3 enumerated real surfaces (not removed); card role now paints the card; precedence pinned both ways; 12 failed → 20 passed; blast radius 582 passed |
| P8-3 | S3.5 N1 base-design label (sonnet) | sonnet | 166,514 | 948s | **falsified the conductor's own brief premise on evidence** — the registry registers ONE design object under both keys, so it labelled honestly instead of inventing a visual split; 3 failed → 10 passed |
| P8-3 | S3.8 reach the 5 unmeasurable states (sonnet) | sonnet | 339,724 | 2217s | 4 of 5 resolved by AUTHORING the state through real operator routes; found `.lg-tscard[data-error]` has NO producer; flagged the probe's hardcoded palette.success verdict |
| P8-3 | S3.9 error role (opus) | opus | 188,927 | 1310s | error role wired to the state render.ts really produces; 6 failed → 16 passed; STOPPED on the dead rules rather than weaken unowned tests; corrected the conductor's accent premise |
| P8-3 | S3.10 accent role + dead data-error rules (opus) | opus | 164,805 | 934s | accent wired to the surfaces its own "Used by" names; both unreachable rules re-pointed; 2 fixtures re-minted; the 2 assertions made STRICTER (selector+value+not.toContain); 11 failed → 154 passed |
| P8-3 | S3.12 measure every sweep row (sonnet) | sonnet | 285,169 | 1919s | audited all 34 rows for hardcoded verdicts (exactly 1); **final sweep 34/34 ALIVE, 0/0/0**, stable across 3 runs; falsified its own brief's aria-invalid route empirically; fixture restore verified by GET |
| P8-3 | S3.3 guard extend + re-predicate (opus) | opus | 266,106 | 1984s | 129 keys enumerated from source (34+25+66+4; the 34+25 reconciles to R3's 59); 4 exemptions all "no control offers this", exact-set pinned; ZERO dead-and-offered; sabotage red-proof 7 failed → restore → 47 passed |

Two near-identical names that are DIFFERENT keys — do not conflate them in review:
`ThemeJson.spacing` (theme.ts:566, offered as the rail's "Spacing" control at themes.ts:255, ALIVE via
applySpacingScale theme.ts:1244) vs `ThemeRecord.spacing` (theme.ts:1008, dead BUT offered by no UI —
conductor-verified: ui-theme-manager.ts has no density control — so exempt, not an R3 breach). P8-1's
"spacing DEAD" finding was the second one. Same hazard: `palette.card_background` vs
`card_defaults.background_role` (S3.4's own flag).

## Environment notes

Maps key: owner-supplied server key placed in gitignored api/.dev.vars (both BROWSER/SERVER
slots) 2026-08-03; source file /tmp/ch-creds.sh (nightly-wiped). Never committed, never printed.
Server ritual: wrangler dev :8901 (--ip 127.0.0.1, DEV_BYPASS_AUTH, ADMIN_HOST=127.0.0.1);
live fetches need Host: r2fix.e2e.test + Chrome UA. Playwright drives override PW_PORT (never 8787).
Fixture: quote lgq_01KZ271383Y0MPV4BM2WKKCC4W; funnels A lgf_…JE5 (default, theme thm_p8-repro),
B lgf_…SAVM, C "P8-Charlie" lgf_…G30E, D lgf_…BQ7X; sections: shared=1, buttons=2, address=5
(P8 Address Repro v3, position 0 of funnel A); site r2fix.e2e.test.

## R3's actual root cause (confirmed independently by two slices, on two authoring axes)

**The base design freezes COPIES of role/scale values into component token slots, so a theme that
writes the role leaves the painted component untouched.** `questionCard.{background,border,
borderRadius,boxShadow}` are frozen literals shadowing `color.card` / `content.cardRadius` /
`cardPanel.border` / `design.shadow.*`; `successState.*`, `reassuranceBadge.*`,
`trustBar.iconColor` and `validation.successColor` are frozen `#0E7C3A` copies of `color.success`.
Every "dead" and "mis-targeted" theme key in R3 is an instance: the key wrote the role, the role
was never read, and the only selectors that DID read it belong to components no driven page
renders (`.lg-card-panel`, `.lg-disclosure-panel`). The contract's own framing — "dead controls"
— named the symptom; the cause is one shadowing pattern in the token layer.
Closure argument: the class is bounded by the 34 authorable inline keys, all 34 of which the
sweep measures — a frozen copy no authorable key targets is not an R3 breach.

Frozen suites live in `api/test-ui/` (Playwright, `playwright.config.ts:231 testDir:'./test-ui'`),
NOT in `api/test/` — so `npm test` never runs them and they are a CLOSE-phase concern:
`test-ui/leadgen-visual.spec.ts`, `test-ui/leadgen-v31-gate1c-baselines.spec.ts`
(screenshots under `test-ui/__screenshots__/`). Never rebaseline either one.

## Root-cause pass: why the SAME class surfaced four times (required after 2 non-converging FIX-FIRST rounds)

The defect class — "a surface shows or writes the wrong funnel/arm" — was found in four successive
rounds, each time one instance narrower. That is a METHOD failure, and it is the conductor's:

| Round | Fixed | What the NEXT round found | Why the brief missed it |
|---|---|---|---|
| 1 (S1.2/S1.6) | chip -> island read path | tab round-trip loses the carry | brief scoped to the reported sentence ("chip click writes wrong funnel") |
| 2 (F1/F5/F6/F7) | hash persistence + **all 32 entity-scoped REQUESTS** | the colour rail displays the editor funnel | **my enumeration brief said "requests that mutate or read entity-scoped state" — i.e. NETWORK calls. In-memory DISPLAY state was never in the set.** |
| 3 (G1) | colour rail follows the target | the same rail reads `workingOverrides` UNGATED in an arm-override session | G1's brief inherited the same universe: it fixed target-switching, not gate-parity between reads and writes |
| 4 (H1) | every display READ gated identically to its write, enumerated + structurally guarded | — | — |

THE LESSON, stated so it transfers: an enumeration is only as closed as the UNIVERSE it enumerates.
I asked for a closed set of network requests and treated the answer as a closed set of "ways this
surface can be wrong". Two universes existed — what the product WRITES and what the product SHOWS —
and gate-parity BETWEEN them was a third. A "closed set" claim must name its universe explicitly and
justify why that universe is the whole one.
Both universes are enumerated with structural guards (write-target closed-set test from F6;
read-gating guard from H1) — **but review #5 falsified the guard's own closure claim, and this
paragraph originally repeated it.** Its analyzer, run over the REAL served island, caught the control
evasion and MISSED five others, including the override radio read as
`querySelector('input[name="lg-ov-theme"]:checked')` — the very shape of the fifth instance, in the
idiom the product itself uses (`themes.ts overrideIsOn()`). So the honest statement is:
the guards cover the shapes they enumerate, NOT every way this class can recur.
That is the same error as the original, one level up: I wrote the lesson "a closed set is only as
closed as the universe it names" and then let a guard claim a universe it had not measured. The guard
is being widened to the spellings `renderOverrideSwitch` actually emits and to `themes.ts` (where the
rail lives), with any shape that cannot be detected soundly named in-file as out of coverage rather
than implied to be covered.
