# CLOSE terminal battery — comparable-run classification (2026-08-05)

## Why this run exists
The first terminal Playwright battery (101 specs at HEAD `cddb77a0`/`5bdb8975`, sequential
against one long-lived server+D1) measured **733 passed / 59 failed / 24 skipped, 30 specs
with ≥1 failure**. Classifying its reds against baseline required a sound comparison: the
101-spec run accumulated D1/fixture state across specs while the baseline ran only the 30
failing specs — asymmetric pollution that could manufacture "regressions". A machine restart
then killed the first comparable re-run and the session scratchpad holding the raw battery
logs; the numbers above survive in the session transcript
(`~/.claude/projects/-Users-guyhaikov-a2z-workspaces/264c07a0-*.jsonl`, 18:20–18:36 UTC).

## Comparable protocol (both sides identical, re-executed 2026-08-05 ~19:45–20:02 UTC)
Per side: fresh D1 (`npm run db:reset:local`) → `wrangler dev` up → `seed:leadgen-fixture` →
server killed → the same 30 specs alphabetically, ONE `npx playwright test test-ui/<spec>
--reporter=line` per spec (playwright spawns its own webServer on PW_PORT).
- baseline `f2407886` in `kodigital-cms-p8-baseline-wt`, PW_PORT=8941
- HEAD `5bdb8975` (product == merged base `cddb77a0`, diff is docs-only) in the mission
  worktree, PW_PORT=8951
Runner: `/Users/guyhaikov/a2z-workspaces/p8-close-rerun/runner.sh` (durable, with per-spec
logs under `p8-close-rerun/{base,head}/`). In-repo copies: `comparable-base30-summary.tsv`,
`comparable-head30-summary.tsv`, `classification.txt` (this dir).

## Result
TOTAL failures — head-30: **51**, base-30: **12**.
- FROZEN 2 (owner-pending, never rebaselined; identical failures both shas)
- PASS-AT-HEAD 3 — the 101-run's red was state pollution for `__p1b-render` and
  `leadgen-r2p1-fixround-smoke`; `listicles-manual-qa` is red at BASE and green at HEAD
  (P8 fixed it)
- PRE-EXISTING 5 (red at baseline too; three distinct roots — see ADJ-P8-58/59/60)
- FLAKY-BASE 2 (`leadgen-operator-acceptance` PC-7, `leadgen-quote-builder` ④ — base colour
  differs between yesterday's and today's baseline runs)
- **INTRODUCED 18** — green at baseline in BOTH baseline runs, red at HEAD under clean
  conditions. Real browser-level drift: the per-phase gates ran the unit suite only, so
  three phases of copy/behaviour changes shipped without any browser-level check.

## Root map of the 18 (conductor-verified before dispatch)
- `PATCH /api/admin/leadgen/themes/:id` 500 — D1 LIKE pattern-length regression
  (w1-theme-patch-500.md): spanned `__p6b-theme-mgr`, `leadgen-r2p7-f3-fork-survival`,
  `__p5a-frame`, builder #11E legs, and the routing spec's empty SELECT.
- footer `links_source` dropped on the frame round-trip (patterns-v25 root + 5 §15.4
  cascades) — W2a slice.
- Stale pins on deliberately-shipped P8 behaviour, each re-mint citing the shipped
  evidence: apply-template `{dry_run:true}` preview interception (#11D + p4-templates),
  jargon-sweep copy (s5c, r6-activation-preflight, PC-7 message), the shipped `custom`
  progress-icon enum (`__r2-logo-progress-drive`), G3c per-subfield validation parity
  (`leadgen-studio-patterns` ×2), P8-4 Templates-tab markup (create/rename/set-default legs),
  P8-3 radius/geometry (r2p6 presets, themefix 1600 measurement first).
