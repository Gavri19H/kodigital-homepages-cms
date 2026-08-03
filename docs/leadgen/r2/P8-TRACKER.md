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
      Slices: S3.1 emitter+tokens+N18 (Opus) · S3.2 theme-UI minors N1/N7/N11/N20 (Sonnet, upgraded
      from Haiku: both owned files are inline-script islands) · S3.4 34-key sweep probe (Sonnet, the
      only slice permitted to touch the server) · S3.3 guard extend+re-predicate (Opus, after S3.1).
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

## Environment notes

Maps key: owner-supplied server key placed in gitignored api/.dev.vars (both BROWSER/SERVER
slots) 2026-08-03; source file /tmp/ch-creds.sh (nightly-wiped). Never committed, never printed.
Server ritual: wrangler dev :8901 (--ip 127.0.0.1, DEV_BYPASS_AUTH, ADMIN_HOST=127.0.0.1);
live fetches need Host: r2fix.e2e.test + Chrome UA. Playwright drives override PW_PORT (never 8787).
Fixture: quote lgq_01KZ271383Y0MPV4BM2WKKCC4W; funnels A lgf_…JE5 (default, theme thm_p8-repro),
B lgf_…SAVM, C "P8-Charlie" lgf_…G30E, D lgf_…BQ7X; sections: shared=1, buttons=2, address=5
(P8 Address Repro v3, position 0 of funnel A); site r2fix.e2e.test.

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
