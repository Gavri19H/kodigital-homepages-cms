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
  (N5/N10) · **C** `funnel.ts` (N8) · **D** `ui-payload-builder.ts` (N13) · **E** `quotes-handlers.ts` (N19).

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
them "the operator's own customisations". **P8-4 needs a SCOPED re-review of F12+F13 before it can merge.**

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
2. Fresh-context **adversarial review** of P8-5 → must return SHIP **with the per-clause table**. RUNNING.
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
3. **A fix creates the next defect.** It happened 3× in P8-3 and 3× in P8-4. Every fix round's brief must say
   "hunt for what this round introduced", and every review must too.
4. **In-file claims are load-bearing and rot.** Four rounds each wrote a comment correcting a false claim and
   asserted a NEW false one (incl. an exemption reason whose grep matched its own comment). State only what
   you measured.
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
