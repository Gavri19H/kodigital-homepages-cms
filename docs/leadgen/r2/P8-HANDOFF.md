# P8 MISSION — CONTINUATION BRIEF (self-contained; rewritten at 98% context)

You are Fable 5, **conductor** of a contract-driven fixing mission. You never write product code — you
plan, dispatch implementer subagents, run the authoritative gate by your own hand, commission
fresh-context adversarial reviews, and merge. `.claude/skills/mission/SKILL.md` + `.claude/rules/mission-loop.md` bind you.

## Product & contract
`kodigital-homepages-cms` — lead-gen funnel CMS (TypeScript CF Worker + D1). An operator authors funnels;
a visitor walks them; answers post to a paying auction. **The owner rejected TWO builds that shipped green.**
- Contract (**wins over every other doc**): `docs/leadgen/r2/P8-DEFECT-CONTRACT.md`. Read §0–§3 first.
- Owner verbatim: `docs/leadgen/source-of-truth/SOURCE-OF-TRUTH.md`. Design pins are IMAGES in
  `docs/leadgen/source-of-truth/images/` — **open them, never infer**.
- §1 = hard boundary: **NO HARDENING**. No gate/validator/blocker no clause asks for. If a fix seems to
  need one: STOP and report.
- §4 R3 corollary, used constantly: *"A control that cannot be honoured must not be offered."*

## Where things stand
Worktree `/Users/guyhaikov/a2z-workspaces/kodigital-cms-leadgen-r2-wt`.
Base/merge target `reconcile/conversions-x-leadgen-r2` @ **528f161** (P8-1/2/3 merged; PR #140 = P8-3).
Current branch **`leadgen-r2-p8-5`** @ `dd65d07` — **carries BOTH P8-4 and P8-5** (P8-5 was branched off
P8-4's tip before P8-4 merged). They will merge as ONE squash PR with both clause tables. Deviation from
"one PR per phase", made for speed; gates and reviews were done per phase.

- **P8-4 code-complete, gate GREEN** (run6 `c507ea4`: 8252 passed/0 failed/30 skipped, 494 files;
  verify:all 0; bundle 52,930/53,248; register 0 violations). 4 slices + 12 fix rounds + 4 reviews.
- **P8-5 nearly complete.** M5 done (128 messages, residual ids 32→1, R5 check mutation-proven,
  the client humanizer DELETED). M6 canvas parity byte-equal on all 8 protected aspects. M7 done.
  M4/R6-2/3/4 done with the **buyer payload driven** (`other_option: false` across 22 bodies).
  N14 **refuted by driving**. N15 pills under handles. N16 4-of-5; aria-labels in flight (F2).
- **P8-6 grounded, not started.** M8 **refuted by driving** (see below) — it is OUT. The four §9 owner rows
  are already WRITTEN (`OWNER-1…4`, all `BLOCKED(owner ruling)`), so P8-6 is the eight minors only.
  **Sites RE-GROUNDED at `473b9f7`** (a scout re-verified every one; two of my earlier cites were wrong):
  | Item | Real site | Note |
  |---|---|---|
  | N2 | `ui-rules-builder.ts:2206` | `lg-qr-help` div: "Operators map to eq · neq · gt · lt · gte · lte." |
  | N3 | `ui-rules-builder.ts:2454-2458` | `fieldLabel()`; the raw-id fallback is `:2458` |
  | N4 | `ui-rules-builder.ts:1966` SSR **+** `:2450` island | both print `String(cp.pagePosition)` 0-indexed; must change together. **TRAP (conductor-verified):** fix the DISPLAY, never the value — the same `pagePosition` feeds the advisory `checkpoint_page` cache (`quotes-handlers.ts:767`), so `+1`-ing it inside `deriveRuleCheckpoint` (`src/leadgen/rule-checkpoint.ts:125`) would corrupt real routing data. Also note the board numbers by ORDINAL (`funnel.ts:403` `Page ${index + 1}`, array index) while `pagePosition` is the DB `position` column (shared page inserts at `position 0`, `quotes-handlers.ts:2478`); those coincide only while positions are dense, so match the board's ordinal, not raw+1. |
  | N5 | `quotes-tabs/ab.ts:157` | "stored as basis points, per-test Σ == 10000" |
  | N8 | **`quotes-tabs/funnel.ts:4534-4544`** (`:4542` `window.location.reload()`) | **NOT `ab.ts`** — my earlier cite was wrong. **TWO traps (conductor-verified):** (a) `showMsg` (`:862`) writes to a DOM node and `reload()` discards it a tick later — a message painted before the reload is NEVER seen, and there is **no post-reload flash idiom in this codebase** (`themes.ts:621-634` solved only the in-page case; the sole storage precedent is `ui-section-studio.ts:16521-16528`, `localStorage` in try/catch, ES5-safe). Naively calling `showMsg` then reloading is a false green — make the fail-before be exactly that. (b) The handler is `.then(function () { window.location.reload(); })` with **no `r.ok` check and no `.catch`**, so a FAILED create reloads identically to a successful one and the disabled button strands the operator. Same clause (the operator cannot tell what happened), so fix both — this is honesty in an existing flow, not a new gate. |
  | N10 | **`ui-quotes.ts:655` only** | **ONE operator-visible site, not 2.** `ab.ts:157` carries "Equal arms; no control" on N5's OWN line, so **N5+N10 must share one slice**; all other "control" hits are internal |
  | N13 | `ui-payload-builder.ts:2879` vs `:2880` | still adjacent; `String(out)` vs `outputFormatJsonLiteral(out)` |
  | N19 | `quotes-handlers.ts:2327` (`A4_SECTION_DUP`) | **Fully grounded by the conductor.** (a) *Wording*: rule A-4's scope is `{shared page ∪ any single funnel}` (comment `:2324-2325`), but the message says only *"already in this funnel"* — so a section sitting on the SHARED page is reported as being in the funnel. (b) *Index*: `:2654/:2659/:2683` key errors as `` `sections.${seen.size}` `` — a **dedupe counter**, not a position — while `:2819` keys the same `sections.N` namespace by the real array index `i`. Same key, two meanings. (c) **3 tests pin the exact string** and must be updated with before/after stated, never relaxed to a substring: `test/leadgen-rework-handlers.test.ts:517` + **`:766` (the shared-page collision — this is N19's own FAIL-BEFORE)**, `test/leadgen-p2-tail.test.ts:348,:372`. So slice **E owns `quotes-handlers.ts` + both of those test files.** |

  Slice map with exclusive ownership: **A** `ui-rules-builder.ts` (N2/N3/N4) · **B** `ab.ts`+`ui-quotes.ts`
  (N5/N10) · **C** `funnel.ts` (N8) · **D** `ui-payload-builder.ts` (N13) · **E** `quotes-handlers.ts`
  + `test/leadgen-rework-handlers.test.ts` + `test/leadgen-p2-tail.test.ts` (N19).

  **Three pinned-test traps, measured by the conductor before dispatch:**
  1. **A p3a recapture is MANDATORY for P8-6.** All three copy strings live in the byte-pin fixtures —
     `"Operators map to eq"` (N2) in `editor-full.html` + `editor-panel-builder.html`; `"basis points"` (N5)
     and `"Equal arms; no control"` (N10) in `editor-panel-ab.html` + `editor-full.html`. Recapture and
     **classify every differing line**; one unexplained line stops the phase.
  2. **N5 has TWO `ab.ts` hits, not one** — and a third for `"basis points"` in
     `src/public/listicle/ab-hash.ts`, which is the **listicles** product: **out of contract, do not touch.**
  3. **N10's `"Equal arms; no control"` is pinned by a Playwright gesture spec**
     (`test-ui/leadgen-rework-acceptance-routing.gesture.spec.ts`, runs on BOTH engines) — update it with
     before/after stated. And `"control variant"` occurs in `ui-quotes.ts`, `frame-handlers.ts` AND
     `quotes-tabs/themes.ts`; a scout judged only `ui-quotes.ts:655` operator-visible, so the slice must
     **re-verify each of the three by its own hand** rather than inherit that judgement (hard-won rule 2).

### P8-4 IS NOT YET SHIPPED — its last review returned FIX-FIRST
`evidence/p8/review-p8-4d/REVIEW.md` = **FIX-FIRST** (MAJOR-1, MAJOR-2, MINOR-1…5). `F12` (`bffd0d9b`)
landed after it with **no follow-up review**. Verified by the conductor's own hand at `473b9f7`:
MAJOR-1 closed (`offeredIn` now matches both quote styles, guard test `:1302`), MINOR-1 closed (both greps
re-measured: quoted `section_slot` = 0, unquoted = 5 files/7 hits, matching the comment), MINOR-3 closed
honestly (block renamed, and its "the contrast moved elsewhere" claim traces to a REAL driven FAIL-BEFORE
in the F9 F-B block), MINOR-4 closed (both narrow checks restored, quote-style-agnostic, `:1792`/`:1802`).
**MAJOR-2's register half is fixed but its in-file half and MINOR-2 are OPEN** → fix round **F13** dispatched
(owns `test/leadgen-p8-m3-apply-template.test.ts` only): `newSavedFunnel` omits the `template` stamp the real
Save always writes, and edits `header.tagline`/`back.label` — leaves NO operator can author (0 admin
occurrences; the live 6-tab census found 18 `[data-frame-key]` controls, neither among them) — while calling
them "the operator's own customisations". **Both are now CLOSED by F13+F14 (`4b938ef`).**

I scoped F13 to `newSavedFunnel`; it fixed that and reported the **same two classes at 3 more sites**, so F14
swept the whole file (hard-won rule 2 again — I named one site, there were four):
- *Class A — a fabricated saved column with no `template` stamp*: 4 sites folded into one `operatorSaves`
  mirror of `funnel.ts:1921-1933`; `:407` is now the ONLY `frame_config_json` PUT in the file. The j12 leg's
  assertion is now byte-identical to the driven log quoted 25 lines above it, **which it had been contradicting**.
- *Class B — an unauthorable leaf called "the operator's own customisation"*: `header.tagline` (0 hits in
  `src/admin`) and `back.label` (a normalisation map at `funnel.ts:2016`, not a control) replaced at 4 sites
  by `header.logo_align` and `background.image_media_id`, each proven against a real emitted control.
- Census **re-measured, not inherited**: comparable 28 · shadowed 2 · honoured 26. The reviewer's 27/2/25 was
  its own fixture's number; the run's wins.
- **Conductor-verified by my own hand at `4b938ef`**: `typecheck` exit 0 / 0 errors; the M3 lane **20 passed
  (20)**, exit 0. (I also mis-grepped `frame_config_json:` as 3 hits — `:252` is an interface field, `:281` a
  row projection; F14's "the only PUT" was the precise claim and mine was the loose read.)

**P8-4 still needs a SCOPED re-review of F12+F13+F14 before it can merge**, which must also rule on one thing
F14 deliberately left: the `CHARACTERISATION` leg may warrant its `FAIL-BEFORE` name back, now that the two
legs again end on **different after-shas from the same before-sha**. The label understates rather than
overstates and its comment is accurate, so it ships pending that ruling rather than risking a fifth
false-comment round on a rename.

### P8-5 GATE RUN 1 — done, FAILED, fix round `F3` dispatched
Log `docs/leadgen/r2/gate-logs/p8-phase-5-run1.log`, HEAD `60e7f75`, clean tree.
`typecheck 0` · **4 failed / 8300 passed / 30 skipped (8334, 499 files)** · bundle 52,930 OK ·
register 86 rows / 0 violations · **`VERIFY_ALL_EXIT=1`**.
p3a recapture already done and **clean — 0 real changes** in every fixture (ULID drift only), committed.

`F3` (agent, running) owns `leadgen-frame-legacy-pin.test.ts`, `leadgen-section-preview-frame.test.ts`,
`test/fixtures/leadgen-legacy-pin/**`, and the golden-regions allowlist. Its two jobs:
- **3 `preview.css` byte pins** moved by two INTENDED changes: N15's pill `bottom`→`top` at
  `default-funnel/styles.ts:981` (+ `:1043` clamp, `:1101` minmax margin) per Image11, and N16's
  `.studio-container-chip` `top:0`→`top:-18px`. Re-mint by hand (PIN_UPDATE is broken), add each moved
  rule to the test's own modulo list with a reason, never broaden the comparison.
- **1 unclassified golden-regions block** (`verify:all` prints `[UNCLASSIFIED — needs an allowlist entry]
  1 block(s)`), most likely M4's new custom address-validation control. Classify per the existing
  entries' convention; do NOT relax the census.

## Next steps, in order
1. ~~Land F3, commit, re-run the P8-5 gate~~ **DONE** — run2 GREEN at `67f8798`, clean tree
   (`typecheck 0` · 8304 passed / 0 failed / 30 skipped (8334, 499 files) · `verify:all` 0 with 0
   UNCLASSIFIED · bundle 52,930/53,248 · register 86 rows / 0 violations · zero-drift: **0 pre-existing
   removed**, 1 intended change, 28 new files +599, `7735 + 599 = 8334` closes).
2. ~~Fresh-context adversarial review of P8-5~~ **DONE — verdict FIX-FIRST.** Full transcript +
   58 driven artifacts: `evidence/p8/review-p8-5/REVIEW.md` (the reviewer was barred from authoring report
   files, so the conductor transcribed it; it exists nowhere else). It audited the gate log independently and
   **found no arithmetic problem**; M7 and N14 are PERFECT (N14's refutation confirmed, not re-filed), N15
   matches the pin across 12 driven states, and M6's core mechanism genuinely works. What failed:
   - **B-1 BLOCKER (inside M4/R6-2, money path):** the `fills` picker collides onto a sibling question's
     answer key. Save = HTTP 200, banner hidden. On the real `POST /lg/auction` the visitor's typed City
     value is **gone** — one key, two sources, last writer wins. `takenBy` (`ui-section-studio.ts:8880-8895`)
     dedupes only across the four fill slots. The picker's own "already filled by City" hint proves the phase
     knew the class and bounded the universe too narrowly.
   - **M-1 (inside N16):** symptom 1 is NOT fixed — the type badge still occludes the grid label by 62×13px
     of a 16px label, identically at 1280 and 375. The phase moved the *container* chip and left the *type*
     badge: one of two selection badges.
   - **M-2/M-3/M-4:** three register rows allocated to P8-5 were **never opened** — `quotes-handlers.ts`,
     `runtime/render.ts`, `preview-sim.ts` are byte-untouched. M-4 also exposes a **false green**:
     `test/leadgen-sections-api.test.ts:1098` asserts a *"visible required message"* with a substring check a
     `hidden` element satisfies.
   - **M-5:** the Section Studio **cannot be saved at 375** (topbar wraps under its fixed 56px height, opaque
     `.studio-settings` paints over the button; a real mouse click issues 0 PATCHes, a programmatic one
     works — which is why no test caught it). Pre-existing (`e460ab63`), but it is why three of the phase's
     own 375 claims have no evidence.
   - 7 minors; three became owner rows **ADJ-P8-43/44/45** (register now 89 rows / 0 violations).
   Fix slices dispatched: **G1** `ui-section-studio.ts` (B-1, M-1, M-5) · **G2** `quotes-handlers.ts` + its
   regression test (M-2) · **G3** `render.ts`+`preview-sim.ts`+`leadgen-sections-api.test.ts` (M-3, M-4).
   **G4** `content-schema.ts`+`leadgen-p8-r5-copy.test.ts` (m-1, m-2, m-3) · **G5** `presets.ts`+
   `runtime/validation.ts`+`payload.ts` (m-4 + the payload jargon G4 flagged). G3 and G5 both rebuild the
   bundle and must never run concurrently.

   **BYTE CAP is now the binding constraint.** 52,930 → **52,989** of 53,248 after G3's two rounds
   (+59). **259 bytes left.** `presets.ts` and `payload.ts` cost nothing (SSR, not in the bundle);
   `runtime/validation.ts` and `runtime/render.ts` do. Commit `render.ts` and
   `runtime/engine-bundle.generated.ts` **together at a consistent build** — the verifier asserts
   `freshness: byte-identical rebuild`, so a sha carrying one without the other is inconsistent.

   **OPEN FOLLOW-UPS from this round, neither measured — do NOT fix blind:**
   - **G3c**: `sim "validation_error"` on an authored ADDRESS still marks the GROUP. G3b's item-3 fix is
     scoped to the required-error path (`state === "error"`) it actually measured. Live would show the ZIP
     spec's own `validation.message`, not `PREVIEW_INVALID_MESSAGE` on the group. Same class as the two
     parity divergences already fixed, so it is inside M6 — measure it, then fix only if it reproduces.
     G3's warm retry is SPENT (G3b was it): this needs a FRESH lean dispatch.
   - A freshly PATCHed section once took **>20s** to reach the served shell (G3 raised its probe settle loop
     to 90s after a timeout). Worth knowing before anyone reads a slow drive as a product fault.
     **This then KILLED a reviewer**: a long silent wait produced no stream output for 600s and the watchdog
     failed the agent mid-drive. Tell every driving agent: **poll in short logged steps (~2s, print each
     attempt), never one long silent wait**; prefer `curl`/fetch assertions over browser waits unless the
     claim needs paint or a real click; and write findings to `REVIEW.md` incrementally so a stall cannot
     lose the whole run. Reusable probes already exist in `api/scripts/p8/` —
     `drive-g3-canvas-live-error.mjs` (canvas-vs-live, 5 scenarios × 8 rows), `probe-p85g1-b1.mjs` (fills
     collision), `probe-p85g1-money.mjs` (the auction walk), `probe-p85g1.mjs` (badge geometry + the 375
     save) — so no reviewer needs to rebuild the harness, only to verify its claims independently.
3. Land **F13**, then a **SCOPED re-review of P8-4** covering F12 + F13 (P8-4's last verdict was FIX-FIRST —
   see the section above; it cannot merge on that).
4. **P8-6**: dispatch its 5 slices (sites re-grounded above), gate, review.
5. **CLOSE**: terminal battery + owner-journey sweep + full-program review + final report + 3–5 lines to
   `.a2z/LEARNINGS.md`.

### Terminal battery — measured shape, plan before you start
`test-ui/` holds **101 `.spec.ts` files** and the config declares **chromium + firefox** projects
(`playwright.config.ts:257-269`), so the battery is ~200 file×project runs. The suite exceeds the 600s Bash
timeout as one run, so: **shard per file**, `PW_PORT=8931` (never 8787, never 8901 — that one is the
mission's own dev server), sum counts across an explicitly enumerated shard set, and name any shard you skip.
- Run **sequentially**, not in parallel: every shard drives the same dev server and the same local D1, so
  concurrent shards contend and flake. Kill strays and fresh-seed D1 between groups.
- **Do not re-run the whole battery at the baseline to classify failures** — that doubles a multi-hour run.
  Run it once at HEAD, then for each failing spec re-run **only that spec** at baseline `f240788` in a
  throwaway worktree to separate pre-existing from introduced.
- Frozen, **never rebaselined** (owner visual-QA stops, ADJ-P8-36): `test-ui/leadgen-visual.spec.ts`,
  `test-ui/leadgen-v31-gate1c-baselines.spec.ts` — enumerate as owner-pending expected-fails.
- Many specs predate this program (`listicles-*`, `__p1a…`, `r0a-drag-spike`) and their baseline colour is
  UNKNOWN. State it as unknown until measured; do not assume green.
5. ONE squash PR to the base; then flip register rows to PASS only on SHIP.

## The gate ritual (yours alone, once per phase)
```bash
cd .../kodigital-cms-leadgen-r2-wt/api
npm run typecheck; echo "TYPECHECK_EXIT=$?"
npx vitest run --reporter=json --outputFile=<scratch>/head.json --reporter=default; echo "VITEST_EXIT=$?"
npm run verify:all; echo "VERIFY_ALL_EXIT=$?"          # jargon gate lives here — it caught a real defect
npm run verify:leadgen-runtime                          # cap 53,248; currently 52,930
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/mission/scripts/check_register.py \
  ../docs/leadgen/r2/P8-REGISTER.md --evidence-root ../docs/leadgen/r2/evidence/p8
```
- **Capture every exit code.** A suite green BY COUNT while the process exits 1 is a gate failure — that
  happened, and only `VERIFY_ALL_EXIT` caught a re-introduced jargon defect at 7992 green.
- Stamp `git rev-parse HEAD` + a **clean** `git status --porcelain` into the log. `status-empty=NO` once
  invalidated a whole run.
- **Zero-drift**: baseline `f240788` = 7692 tests / 471 files; per-file map at
  `<scratchpad>/baseline-per-file.json` (session-scoped — regenerate via a throwaway worktree if gone).
  State the ACTUAL pre-existing sum vs 7692 with the delta attributed; do NOT derive baseline = total − new
  (a reviewer called that tautological).
- Gate logs → `docs/leadgen/r2/gate-logs/p8-phase-N-runM.log`, **`git add -f`** (`.gitignore:32 *.log`).

## Environment
`wrangler dev` runs on **:8901** (admin answers on `127.0.0.1`, never localhost). Visitor:
`http://r2fix.e2e.test:8901/lg/r2fix?_cb=<uniq>` with a real Chrome UA and chromium
`args:["--host-resolver-rules=MAP r2fix.e2e.test 127.0.0.1"]`. Never bind 8787.
Fixture quote `lgq_01KZ271383Y0MPV4BM2WKKCC4W`; funnels A `lgf_01KZ271383F5X1SQ3DXTXKNJE5` … C "P8-Charlie"
`…G30E`, E `…GFCNMT`. **Fixture has drifted** — reviewers/slices authored probe sections (`p8n_*`) and two
sections carry probe content; recoverable via `npm run db:reset:local` + reseed. Activation 409s quote-wide
because P8-Charlie is empty (ADJ-P8-41).

## Hard-won rules — apply, don't relearn
1. **Reproduce before you fix.** THREE contract claims were falsified by measurement (M1's alignment/position
   renders, **N14**, **M8**) and M3's magnitude was corrected **14×** (28 shadowed → 2) because a fixture
   hand-built a state the product never writes. Every brief must say so.
2. **An enumeration is only as closed as the universe it names.** Cost 4+ rounds: "all network writes" missed
   display reads; a box-fit invariant scoped to one container class missed the next container; the contract
   named 1 aria-label site, there are 5.
   **This is systemic, not anecdotal — measure it and dispatch for it.** In the P8-5 FIX-FIRST round ALONE,
   *four consecutive slices* each found their defect class at more sites than the finding named: F13 (1 named
   → 4 fixture sites), G2 (fix shipped with no regression protecting it), G3 (2 named parity divergences → 3
   more, one of them the same false-green class it had just fixed), G4 (2 named jargon sites → 2 more in its
   own file + 1 outside). The review itself found the phase had fixed one of *two* selection badges and
   bounded a collision check at *four of N* sources — the blocker.
   **So put this in every dispatch from the start, not as a follow-up round:** *"Sweep your owned files for
   this defect CLASS and **fix** it — not just list it — and report the sites you check and CLEAR as well as
   the ones you change."* Name the axes to sweep on (e.g. *messages echoing a raw id* + *lowercase fragments
   with no action*), not the instances.
   **Say "fix", not "report".** I wrote *"fix both X sites"* in step 1 and *"sweep and report"* in step 3, and
   the slice reasonably fixed two and listed four more — one of them **4 lines away with an identical shape**.
   That ambiguity alone cost a whole extra round. By the seventh occurrence the pattern is not the slices'
   judgement, it is the brief's wording.
3. **A fix creates the next defect.** It happened 3× in P8-3 and 3× in P8-4. Every fix round's brief must say
   "hunt for what this round introduced", and every review must too.
4. **In-file claims are load-bearing and rot.** Four rounds each wrote a comment correcting a false claim and
   asserted a NEW false one (incl. an exemption reason whose grep matched its own comment). State only what
   you measured.
4b. **A false green can survive its own fix.** Three assertions in `leadgen-sections-api.test.ts` were
   rewritten from document-wide `toContain` to slot-level reads — which fixed **WHICH ELEMENT** they read but
   not **WHAT VALUE** they expected. They kept asserting fabricated behaviour, in a stronger-looking idiom,
   and stayed green through two rounds until someone drove the live page. When you repair a weak assertion,
   re-derive the expected VALUE from the product, not just the selector.

4c. **Two claims of mine that were wrong, as warnings about conductor-authored briefs:** I twice told agents
   the parity probe reported *"0 disagreements across 5 scenarios × 8 rows"* when G3d had actually reported
   **4** (the known `lg-valid` rows, ADJ-P8-49); and I wrote a register census (27·2·25) that no shipped test
   produced. A brief or a register row is an in-file claim too — it rots the same way, and a subagent will
   reasonably build on it. Re-read the source report before quoting a number into a dispatch.

5. **The instrument is wrong as often as the product.** The paint predicate was wrong in BOTH directions
   (class-only credited, then class-only discarded; the real answer was resolving pseudo-elements); `offeredIn`
   was blind to single quotes; my own drive sampled `.lg-question-card` for a signal it can't carry.
6. **`presets.ts` is NOT in the runtime bundle** — I told slices it was, repeatedly, and it is false.
   `RUNTIME_ENTRY = runtime/engine.ts` (`scripts/build-leadgen-runtime.ts:39`); no `runtime/*.ts` imports
   `components/presets`; a 5-site edit rebuilt byte-identical. The byte gate ran clean without covering it.
   `presets.ts` is the server-side SSR renderer. The cap DOES bind `runtime/engine.ts` and `runtime/render.ts`.
7. **Never `git add -A`** (a Maps key leaked to a public repo that way). Stage explicit paths.
8. Implementers: no `git` at all, never start/stop servers, exclusive file ownership, ≤2–3 concurrent,
   report ≤40 lines. Island hazards: ES5 only, no backticks in emitted bodies/comments, no hex in island
   comments, several separate IIFEs, VM-manifest stubs for new island helpers.
9. **Only a review SHIP earns PASS** in the register. Write `DEVIATES(...)` until then. And check the
   review's actual verdict line before treating a phase as shipped — P8-4's 4th review said FIX-FIRST and
   the phase was carried forward for days as if it had shipped.
10. **Never edit `src/` while a reviewer is driving.** One dev server serves the whole worktree, so any src
    save hot-reloads it under the review's browser — that cost review #4 a finding (`MINOR-5`, the reviewed
    worktree mutated mid-review, `[status-empty=yes]` no longer reproducible). Test-only and doc-only
    rounds are safe to run concurrently; src slices wait for the verdict.

## Register
`docs/leadgen/r2/P8-REGISTER.md` — **86 rows / 0 violations**, validate after EVERY edit. 42 ADJ rows.
`check_register` R3 requires a behavioural PASS to cite a screenshot that exists — it correctly caught me
trying to PASS N18 on stylesheet bytes; that row is now `INCONCLUSIVE` with a named step.

**Owner rulings pending (ADJ-P8-27…42)** — the ones to read first:
- **ADJ-P8-36** honouring "Bare layout" moves 3 shipped templates and disagrees with a committed FROZEN
  baseline → owner visual QA (an owner-authority stop; nothing was rebaselined).
- **ADJ-P8-39** M3's defect was 2 leaves, not 28 — decide whether the materialise design stays.
- **ADJ-P8-27** a long-named theme can never be renamed or deleted (PATCH/DELETE 500).
- **ADJ-P8-42** renaming a choice on a live funnel now changes the buyer-facing value.
- **ADJ-P8-35** 155,567 bytes of `//` comments ship inside the 777KB editor page.
- **ADJ-P8-28** the Themes manager's font preview can never show the font (admin vendors no `@font-face`).

## Owner-owned, never cross
Deploy, secrets, production data, destructive git, budget caps, compliance scope, captcha/2FA, and
**manual visual QA incl. re-blessing any frozen baseline**. `api/.dev.vars`'s two `GOOGLE_MAPS_*` slots are
deliberately EMPTY — do NOT re-add a key.

## Operational: the dev server can die mid-run
`wrangler dev` on :8901 died during a slice's drive (`undici UND_ERR_HEADERS_TIMEOUT` on a PATCH). The
slice's probe still restored its fixture through `finally` (status 200) — **write probes that restore in
`finally`, not at the end of the happy path.** Restart is the CONDUCTOR's job (implementers never start or
stop servers):
```
cd .../kodigital-cms-leadgen-r2-wt/api
nohup npx wrangler dev --port 8901 --ip 127.0.0.1 --var DEV_BYPASS_AUTH:true --var ADMIN_HOST:127.0.0.1 > /tmp/wrangler-8901.log 2>&1 &
```
Then poll in short logged steps until `curl -H "Host: 127.0.0.1" http://127.0.0.1:8901/admin/leadgen/quotes`
returns 200. If a drive reports impossible results, check the server is alive before believing them.

## Operational: one backtick can fail the WHOLE project, not just its file
A slice put a backtick inside a comment that lives **inside an emitted island template literal**
(`ui-section-studio.ts`), which closed the literal early. `npm run typecheck` and `npx vitest run` then failed
**project-wide** — and the agent that noticed was working in two entirely different files. It self-cleared.
**If every command suddenly fails and the errors point somewhere you never touched, suspect a broken template
literal in an island file before you suspect your own change** — and check whether another slice is editing
that file concurrently. This is why the island hazard list ("ES5 only, no backticks in emitted bodies or
comments, no hex in island comments") is in every `ui-section-studio.ts` dispatch.

## Instrument hazard: `vitest run <file>` SILENTLY SKIPS a filename that does not exist, and exits 0
Confirmed by hand:
```
npx vitest run test/leadgen-answers.test.ts test/DOES-NOT-EXIST.test.ts   ->   EXIT=0
```
A slice caught this because a lane I wrote named `test/leadgen-payload-builder.test.ts`, which does not exist
(the real file is `…-builder-ui.test.ts`). Vitest ran 5 files where the command named 6 and still reported
success. **Any slice lane in this mission that mistyped a filename gave false confidence.** The phase GATE is
unaffected — it runs the whole suite with a bare `npx vitest run` — which is exactly why the gate, not the
lane, is authoritative.
**Rule: whenever a lane names specific files, count the `Test Files N passed` figure against the number of
files you named.** A mismatch is a broken command, not a pass. Put that instruction in the dispatch.

## Sequencing decision (2026-08-05): P8-6 runs BEFORE the review, and they share ONE review
P8-5's second fix wave and P8-6 now get a **single combined adversarial review**. Reasons, both real:
1. P8-4+P8-5+P8-6 already ship as ONE squash PR, so one review matching the PR is the honest unit.
2. A reviewer drives the shared `wrangler dev`, and ANY `src/` save hot-reloads it under their browser —
   that already cost a review a finding (`MINOR-5`). Serialising review-then-slices was adding a full
   idle review cycle per phase. Running the slices first and reviewing once removes it.
The cost is a bigger review scope; the brief must therefore enumerate BOTH waves' clauses explicitly.

## Where P8-5 ended (gate run 7 GREEN at `f074da37`)
`typecheck 0` · **8336 passed / 0 failed / 30 skipped (8366, 499 files)** · `verify:all` 0 ·
bundle **53,124 / 53,248 (124 free)** · register **96 rows / 0 violations** · p3a **0 real lines** ·
zero-drift **0 pre-existing removed**, +71 all additions, `7763 + 603 = 8366`.

Wave 2 (after review #2's FIX-FIRST) closed, all driven: the `fills` time-of-check hole (a pick for an
unrendered slot + "Add field" re-opened the collision), the activity-mismatch ULID that short-circuited
BEFORE the already-fixed vertical message, the canvas fabricating a `validation_error` on rule-less text,
and — found beyond the contract — a `from_to` typed value silently rewritten before the buyer saw it
(ADJ-P8-51), a payload builder offering an address key the page never renders, the auction ZIP facet
resolving to `null`, the operator's ZIP report inspecting the wrong box, and a **visitor blocked from
continuing** by a runtime validator reading a sibling's free text — fixed at the producer for **0 runtime
bytes** after the in-runtime fix was measured at +499 and correctly refused.
