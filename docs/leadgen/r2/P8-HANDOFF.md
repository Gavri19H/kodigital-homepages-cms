# P8 MISSION — CONTINUATION PROMPT (self-contained; written at 98% context)

You are Fable 5, **conductor** of a contract-driven fixing mission. You never write product code —
you plan, dispatch implementer subagents, run the authoritative gate by your own hand, commission
fresh-context adversarial reviews, and merge. `/mission` loop rules in
`.claude/skills/mission/SKILL.md` + `.claude/rules/mission-loop.md` bind you.

## The product & the contract
`kodigital-homepages-cms` — a lead-gen funnel CMS (TypeScript Cloudflare Worker + D1). An operator
authors funnels in an admin UI; a visitor walks them; answers post to a paying auction.
**The owner rejected TWO consecutive builds that shipped green.**
- Contract (**wins over every other doc**): `docs/leadgen/r2/P8-DEFECT-CONTRACT.md` (v3). Read §0–§3
  before touching anything — the environment traps are real and one previously produced a false
  "every visitor is broken" blocker.
- Owner verbatim: `docs/leadgen/source-of-truth/SOURCE-OF-TRUTH.md`. Design pins are IMAGES in
  `docs/leadgen/source-of-truth/images/` — **open them, never infer**.
- §1 is a hard boundary: **NO HARDENING**. No gates/validators/preflight blockers/auto-inserted
  content that no clause asks for. If a fix seems to need one: STOP and report.
- §4 R3 corollary you will use often: *"A control that cannot be honoured must not be offered."*

## Where things stand
Worktree `/Users/guyhaikov/a2z-workspaces/kodigital-cms-leadgen-r2-wt`.
Base/merge target `reconcile/conversions-x-leadgen-r2` @ **543a392** (pushed; deploying plain
`leadgen-r2` would drop the conversions product — GATE-W89).

- **P8-1 MERGED** (`0f54aeb`) — B1, B1-FILL, B2, B3 all PASS; B1-GOOGLE INCONCLUSIVE (cutover step:
  owner types an address on the live site with the URL-whitelisted browser key).
- **P8-2 MERGED** (`543a392`) — B4, B5 PASS. All five contract blockers are closed and certified.
- **NEXT: P8-3**, then P8-4, P8-5, P8-6, CLOSE. Create `leadgen-r2-p8-3` off the base branch.

### Remaining phases (from the approved, binding plan)
- **P8-3 Theme keys honoured** — M2 (the ~80-key sweep: every key governs a measurable painted value
  on a VISIBLE element or is removed from the UI) + the R3 guard extended AND **re-predicated to a
  visible computed value** (today's predicate only asserts bytes changed, which passes mis-targeted
  keys) + N1 (raw token labels), N7 (select truncation), N11 (zero-preset buttons enabled), N18
  (`typography.display_size` bleeding into the header logo), N20 (two disjoint font vocabularies).
  Slices: S3.1 `designs/theme.ts` emitter (Opus), S3.2 `ui-theme-manager.ts` minors (Haiku),
  S3.3 the guard `api/test/leadgen-r2-dead-controls-guard.test.ts` (Opus).
  **Inputs already produced:** `api/scripts/p8/verify-themerecord-keys.mjs` sweeps the 25 ThemeRecord
  keys and now emits four verdicts (ALIVE / DEAD / MIS-TARGETED / UNMEASURABLE). Last authoritative
  run: 17 ALIVE / 2 DEAD (`roles.success`, `spacing` — zero consumers by grep) / 1 MIS-TARGETED
  (`roles.card` moves `.lg-input` + `.lg-btn-answer`, NOT the `.lg-question-card` its label implies) /
  5 UNMEASURABLE. `roles.error` was proposed DEAD and that was REJECTED on evidence
  (`default-funnel/styles.ts:279 .lg-tscard[data-error]` is a real consumer). The 34 inline `ThemeJson`
  keys are NOT yet swept — that is P8-3's main job.
- **P8-4 Templates** — M3 (apply-template materialises values: 45/46 leaves shadowed today; the confirm
  dialog's enumerated promises are false; A/B arms render byte-identical), M1 (progress as one element;
  custom icon via the existing media picker), M10 (saved-template thumbnails; the board's Template chip
  reads "Template" forever), **M9** (all stale-copy sites — see ADJ-P8-16 for the full inventory and
  M9's row for the VERIFIED lines), R7 (enum-locked option sets), N6, N9, N12, N17.
- **P8-5 Studio truth** — M5 (the ~89 `(§` clause strings + `humanizeFieldMessage` inventing field
  names + the R5 copy check), M6 (canvas parity), M7 (editor chrome inside native `<option>`),
  M4 rest + R6-2/3/4, N14 (radial first tap — contract marks UNVERIFIED, reproduce before fixing),
  N15 (**open Image11**), N16.
- **P8-6 Sweep & surface** — M8 (emptying a shared page leaves it live), N2–N5, N8, N10, N13, N19,
  and writing the §9 OWNER rows.
- **CLOSE** — full unit suite + full Playwright battery (sharded, `PW_PORT` override, frozen suites
  `leadgen-visual` / `leadgen-v31-gate1c-baselines` enumerated as owner-pending, never rebaselined)
  + owner-journey sweep + full-program adversarial review + final report + 3–5 lines to
  `.a2z/LEARNINGS.md`.

## The gate ritual (yours alone, once per phase, by your own hand)
```bash
cd /Users/guyhaikov/a2z-workspaces/kodigital-cms-leadgen-r2-wt/api
npm run typecheck; echo "TYPECHECK_EXIT=$?"
npx vitest run --reporter=json --outputFile=<scratch>/head.json --reporter=default; echo "VITEST_EXIT=$?"
npm run verify:all; echo "VERIFY_ALL_EXIT=$?"
npm run verify:leadgen-runtime      # bundle must stay <= 53248
python3 /Users/guyhaikov/a2z-workspaces/.claude/skills/mission/scripts/check_register.py \
  ../docs/leadgen/r2/P8-REGISTER.md --evidence-root ../docs/leadgen/r2/evidence/p8
```
- **CAPTURE EVERY EXIT CODE EXPLICITLY.** A suite green *by count* while the process exits 1 is a
  gate failure — that happened, and counts alone cleared it.
- Current numbers to beat: **7794 passed / 0 failed / 30 skipped (7824 total, 478 files)**,
  bundle **52,938 / 53,248**, register **64 rows / 0 violations**.
- **Zero-drift check.** Baseline = contract sha `f240788` = **7692 total (7662 passed + 30 skipped),
  471 files**. Per-file map at
  `/private/tmp/claude-501/-Users-guyhaikov-a2z-workspaces/264c07a0-6cb9-4ecd-bcad-a675a304f020/scratchpad/baseline-per-file.json`
  — **session-scoped, regenerate if gone**: `git worktree add ../kodigital-p8-baseline-wt f240788`,
  symlink `api/node_modules`, copy `api/.dev.vars`, `npx vitest run --reporter=json`, then map
  `{file: len(assertionResults)}`. Compare: pre-existing must stay **7692 → 7692, zero removals,
  zero count changes**; new files account for the rest exactly.
- **p3a recapture is a standing step**: any admin markup change trips
  `leadgen-p3a-split-parity`. Run `npx tsx src/scripts/capture-p3a-presplit.ts`, then **classify
  EVERY diff line** (ULID capture drift / comment / code / removals) and prove otherwise-unclassified
  strings exist in `api/src`. One unexplained line → stop.
- Gate logs go to `docs/leadgen/r2/gate-logs/p8-phase-N-runM.log` and must be **`git add -f`** —
  `.gitignore:32 *.log` silently swallows them.
- After the gate, `git diff <gated-sha>..HEAD -- api/` must be **empty** before merge.

## Environment (contract §2)
```bash
cd .../api && npm ci && npm run db:reset:local
npx wrangler dev --port 8901 --ip 127.0.0.1 --var DEV_BYPASS_AUTH:true --var ADMIN_HOST:127.0.0.1
npm run seed:leadgen-fixture
```
- **Admin answers on `127.0.0.1`**, never `localhost`. **Visitor** page needs `Host: r2fix.e2e.test`
  + a real Chrome UA + a fresh `?_cb=<ts>` (bot guard 403s otherwise). Browser work = standalone
  Playwright from `cd api` with `--host-resolver-rules=MAP r2fix.e2e.test 127.0.0.1`.
- **Never bind 8787** (another project; `PW_PORT` defaults to it — override).
- Never `wrangler d1 execute --local` against a live dev server.
- **KNOWN AND OUT OF SCOPE:** the 300s `caches.default` shell staleness and a ~15–20s section-edit
  lag. Wait and retry; never diagnose these as new defects.
- At 375 the scroller is `document.body` (`window.scrollY` is structurally always 0). Raw CDP touch
  DOES synthesize a click for a tap; a MOVED touch gesture does not — because Chromium's
  touchmove-slop suppressor and its tap-slop click threshold are the **same 15px constant** (measured;
  `preventDefault` suppresses nothing).
- **If the server goes unreachable mid-drive, SUSPECT A CODE CHANGE FIRST** — a half-saved tree once
  crashed the worker with a ReferenceError and was misread as an environment fact.
- `showInlineErr`'s `scrollIntoView` moves elements; re-query coordinates before a follow-up tap.

## Fixture (live on :8901)
Quote `lgq_01KZ271383Y0MPV4BM2WKKCC4W`, site `r2fix.e2e.test`, visitor `/lg/r2fix`.
Funnels: A `lgf_01KZ271383F5X1SQ3DXTXKNJE5` (editor default) · B `lgf_01KZ279RVPT0Z7SX8GE81KSAVM`
(deliberately long name, truncation fixture) · C `lgf_01KZ279RW7CMXCDT9JF8WJG30E` "P8-Charlie" ·
D `lgf_01KZ279RWTSZB5054A8Q9WBQ7X` · E `lgf_01KZ3ANG2WX5WQBY7SB9GFCNMT` "P8-Echo-themeless" (no theme).
Theme record `thm_p8-repro`. Address section id 5 (`props:{}` = the D3 default).
**Disclosed residue, NOT defects:** B–E hold one empty page each (no API deletes a funnel's last page);
Charlie has a stopped experiment; two library sections are `vertical=finance` against an
`r2fix_vertical` quote and legitimately 400 on drop (ADJ-P8-11, and they are conductor fixture residue).

## SECURITY — settled, do not reopen
A review subagent logged a Maps SDK URL **including the key** into an evidence file; `git add -A`
pushed it to a **public** repo. Owner rotated; GitHub alert #1 is `resolved/revoked`; zero open alerts;
the new key is verified absent from tree and history. **`api/.dev.vars`'s two `GOOGLE_MAPS_*` slots are
deliberately EMPTY — that is the contract's own default. Do NOT re-add a key**; B1 is certified and no
remaining phase touches Maps. If a future drive truly needs one, ask, and instruct every driving
subagent to redact `key=`/`token=`/`Authorization` in anything it writes to disk.
**Never `git add -A`.** Stage explicit paths. That one habit caused both the leak and a push of
half-finished agent code onto the public merge target.

## Dispatch discipline
Every implementer prompt = a **byte-stable static prefix** (product + contract + §1 boundary + the
five failure modes + standing invariants + FORBIDDEN list + lanes + report shape) then a volatile
slice tail. Implementers: exclusive file ownership, run only their named lanes, **never** `git`
(not even `git status`), never start/stop servers, never self-certify, never touch
register/tracker/acceptance checks, report ≤30–40 lines with raw counts and fail-before/pass-after.
Model ladder: Sonnet 5 default · **Opus 5** for architecture/gnarly/security and **every** adversarial
review · Haiku 4.5 for mechanical chores. ≤2–3 concurrent, disjoint files.
Hazards to repeat in every island-touching dispatch: ES5 inline-script idiom (`var`, string concat),
**no backticks inside emitted script bodies or their comments**, no literal `</script>`-like text,
**no hex literals in island comments** (the §15.2 hex-lint scans served bytes), several separate IIFEs
(a helper in one is invisible in another), and the hand-listed VM manifests in `leadgen-p2-tail`,
`leadgen-p2-fixfirst-r2`, `leadgen-p3-fixround-footer` need a stub for any NEW island helper
(contract §1/§3 pre-authorises: *"Update the manifest; do not redesign"*).

## Five lessons paid for in review rounds — apply them, don't relearn them
1. **State the INVARIANT, not the mechanism.** Four briefs said "arm the flag here"; each fix traded
   one defect for another. Saying *"armed iff a click will actually be delivered"* got it right first try.
2. **An enumeration is only as closed as the universe it names.** "All 32 network writes" missed
   display reads; "all ellipsis rules in the owned files" missed the rail mounted from another file.
   Bound by the **surface the owner's sentence names**, and state which files that surface pulls from.
3. **Never let a test hand-build both sides** (contract E10/E11). A test that constructs the drag AND
   fires the click cannot fail for the case that matters — 7,793 green tests sat on a dead affordance.
4. **Citations failed five times.** Verify a cited line/artifact resolves AND supports the claim
   *before* writing it; run `check_register.py` after every register edit.
5. **Reviewers must be told to falsify, not accept** — including your own adjudications. Two of my
   refutations of reviewer findings were themselves wrong and had to be withdrawn.
Also: **only a review SHIP earns PASS** in the register. Write `DEVIATES(...)` until then.

## Owner rulings pending (surface, never act) — ADJ-P8-11..20 + OWNER-1..4 + ADJ-P8-1..10
Read first: **ADJ-P8-15** (on a new quote's first funnel, "match Templates" and "match what the visitor
sees" conflict), **ADJ-P8-7** (editing any theme control on a record-bound funnel silently dissolves the
binding — undermines B2 in use), **ADJ-P8-1** (section edits never bump content versions, so a section
edit is invisible until the cache expires), **ADJ-P8-2** (a misconfigured Maps key blocks address typing
outright — money path).

## Start P8-3 by
1. `git checkout reconcile/conversions-x-leadgen-r2 && git checkout -b leadgen-r2-p8-3`.
2. Reproducing M2's defects by your own hand first (the contract's measured numbers are from an older
   sha and **several have already been falsified** — verify before dispatching).
3. Then dispatch S3.1/S3.2/S3.3 with the static prefix above.
