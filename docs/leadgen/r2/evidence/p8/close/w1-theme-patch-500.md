# CLOSE fix W1 — `PATCH /themes/:id` 500 (D1 LIKE pattern-length), root-caused + fixed

**Symptom (terminal battery, clean protocol):** `PATCH /api/admin/leadgen/themes/:id` threw an
UNHANDLED `D1_ERROR: LIKE or GLOB pattern too complex: SQLITE_ERROR` → 500, on
`thm_p6b-rich-preset-*` (`__p6b-theme-mgr`) and `thm_f3-preset-acc6-f3a-*`
(`leadgen-r2p7-f3-fork-survival-drive`, which also surfaced `{"error":"Internal Server Error"}`).

**Root cause** (`themes-handlers.ts:549`, stack in `/tmp/wr8951.log` at
`findFunnelsReferencingTheme`): D1's SQLite caps a LIKE **pattern at 50 bytes**. The needle
`%"theme_id":"${themeId}"%` is 15 bytes + the id, so any theme id ≥36 chars → 51 bytes → throw.
Measured through the real route: id length 35 → pattern 50 → **200**; id 36 → **500**.

**Why the battery caught it only at HEAD:** the needle is byte-identical at baseline
(`git show f2407886`), but there it was reachable only inside `scheduleThemeInvalidate`'s
`.catch(() => {})` — the same error was **silently swallowed**, i.e. theme invalidation was
dead for long-named themes with no trace. P8-1 (`0f54aeba`, B2) added the AWAITED scan for the
content_version bump, which turned the pre-existing swallowed throw into a route 500.

**Fix (working tree, gated at CLOSE):**
- `themeIdCandidatePattern()` builds the LIKE pattern bounded ≤50 bytes by construction
  (13-byte discriminator + UTF-8-clamped id prefix); truncation only WIDENS the candidate set
  and `referencesThemeId`'s exact JSON parse still decides membership (no false positives).
- `scheduleThemeInvalidate` now logs instead of swallowing; the awaited scan+bump is wrapped so
  the route still 200s with the failure surfaced as `cache_refresh_warning` in the body.
- Unit lane `test/leadgen-p8-b2-invalidate.test.ts`: fail-before `2 failed | 1 passed (3)`
  (both `expected 500 to be 200`), pass-after `3 passed (3)`; includes the prefix-collision
  case (`thm_<36>` vs `thm_<36>-2` share a truncated pattern; only the patched theme bumps).
- curl: the exact theme that 500'd → 200 with the merged record; an 84-char id PATCHes and
  DELETEs 200.

**Cascade re-greened (lane ritual, two runs each):** `__p6b-theme-mgr` 8/8 · 8/8,
`leadgen-r2p7-f3-fork-survival-drive` 3/3 · 3/3, `__p5a-frame` 10/10 · 10/10 (its
wrangler-d1 SELECT failure was this 500 upstream), builder #11E theme-PATCH legs pass every
run. `routing.gesture` 34/34 fresh; its repeat-run single red is the spec shelling out
`npx wrangler d1 execute --local` while the webServer holds the same SQLite →
`SQLITE_BUSY_SNAPSHOT` (harness concurrency, measured, not the LIKE bug).

**Read-only blast radius:** `leadgen-v31-themes-integration + p8-b2` 16/16;
`leadgen-v31-themes + p6a-theme + theme-manager-ui + p8-b4-themes-canvas` 127/127; tsc 0.
