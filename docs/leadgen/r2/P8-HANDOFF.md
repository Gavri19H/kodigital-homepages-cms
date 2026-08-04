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
- **P8-6 grounded, not started.** M8 **refuted by driving** (see below) — it is OUT. Remaining: N2, N3
  (`fieldLabel()` now `:2454`), N4 (BOTH `:1966` SSR + `:2450` island), N5, N8, N10 (exactly 2 sites:
  `ui-quotes.ts:655`, `ab.ts:157`), N13 (`ui-payload-builder.ts:2879` vs `:2880`), N19, + write the four §9 owner rows.

### In flight when context ran out
`F2` (agent) owns `presets.ts` (5 aria-label sites), `leadgen-r4a-pipeline.test.ts:432` (stale pin),
`sections.ts:161-162` (stale comment). Uncommitted work in the tree is its + S5.2c's — commit before gating.

## Next steps, in order
1. Land F2, commit.
2. **p3a recapture** (`npx tsx src/scripts/capture-p3a-presplit.ts` from `api/`), classify EVERY differing
   line, prove intended strings exist in `api/src`.
3. **P8-5 gate** (ritual below) → green at branch HEAD, clean tree.
4. Fresh-context **adversarial review** of P8-5 → must return SHIP **with the per-clause table**.
5. **P8-6**: dispatch its minors (all grounded, sites above), gate, review.
6. **CLOSE**: terminal battery (full unit + full Playwright, sharded, `PW_PORT` override; frozen suites
   `test-ui/leadgen-visual.spec.ts` + `test-ui/leadgen-v31-gate1c-baselines.spec.ts` enumerated as
   owner-pending expected-fails, **never rebaselined**) + owner-journey sweep + full-program review +
   final report + 3–5 lines to `.a2z/LEARNINGS.md`.
7. ONE squash PR to the base; then flip register rows to PASS only on SHIP.

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
6. **Never `git add -A`** (a Maps key leaked to a public repo that way). Stage explicit paths.
7. Implementers: no `git` at all, never start/stop servers, exclusive file ownership, ≤2–3 concurrent,
   report ≤40 lines. Island hazards: ES5 only, no backticks in emitted bodies/comments, no hex in island
   comments, several separate IIFEs, VM-manifest stubs for new island helpers.
8. **Only a review SHIP earns PASS** in the register. Write `DEVIATES(...)` until then.

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
