# P8-4+P8-5+P8-6 merge gate — S-wave scoped re-review — **FIX-FIRST**

Fresh-context Opus 5 reviewer. Drove the already-running `:8901` instance as a CLIENT (started
and stopped nothing, never bound 8787). Authored my own content from scratch through the real
`POST /sections`, `POST /quotes`, `PUT /variants/:id`, `POST /quotes/:id/routing-rules` and the
real visitor funnel to `POST /lg/auction`, with keys unique to this session (`p8n_mg_*`).

Branch HEAD `e7d94e2c`; `git show --stat e7d94e2c` = **1 file, 3,060 insertions** (the gate log
only) → product code is `b906840f`. Working tree at review time: **5 modified p3a fixtures**
(ULID-only, mtime 18:13:28 — the post-gate recapture, see finding 7).

## Gate-log audit (one line, recomputed, nothing re-run)
`gate-logs/p8-phase-6-run5.log`: stamped `HEAD: b906840f…` == the product sha ✓ · `[status-empty=yes]` ✓ ·
five exits present and 0 ✓ · **I re-parsed every ` ✓|↓ test/<path>.ts (N tests[ | M skipped])` line
in the vitest block myself: 499 files (497 ✓ + 2 ↓), 8,437 tests, 30 skipped ⇒ 8,407 passed** —
exactly the summary, and the run's own JSON report (`head-p86e.json`, still on disk) reads
`numTotalTests 8437 / passed 8407 / failed 0 / pending 30` ✓ · bundle: I measured the emitted
string myself — `Buffer.byteLength(LEADGEN_RUNTIME_JS)` = **53,181** == the declared constant,
budget 53,248 ⇒ **67 free, nothing overflowed** ✓ · register: re-ran `check_register.py` myself,
**98 rows / 0 violations** ✓ · zero-drift deltas `43+16+12+11+9+8+5+4+4+3+1 = 116`, `7692+116 = 7808`,
`7808+629 = 8437` ✓ · **p3a: the log carries the verdict line but NO raw section** — I recomputed it
independently with the suite's own three normalisers (`ID_RE`/`COMPUTED_AT_RE`/`ANALYTICS_DATE_RE`):
**0 real diff lines across all 5 dirty fixtures**, claim TRUE but unbacked in the log (finding 7).

## Per-clause verdict table

| Clause | What I drove | Measured | Verdict |
|---|---|---|---|
| **MAJOR-1** — the rules rail's field universe equals the page's | Authored `p8n_mg_universe` (Address `p8n_mg_addr`, NameFieldsGroup `["p8n_mg_first","p8n_mg_last"]`, from_to `p8n_mg_band`, a question **two containers deep**, a QuestionGrid child, a plain FreeText) + `p8n_mg_labels` (DEFAULT NameFieldsGroup, Address with `maps.fills.zip → p8n_mg_postal`, dual_range `p8n_mg_pct`); read the rail's own `#lg-qr-data`; saved 7 real routing rules; walked the real visitor funnel to `POST /lg/auction` | Picker = **45 fields**, per-page sets = the same set, `pageUnion − picker = ∅`. All four Address roles, `p8n_mg_first`/`_last`, `p8n_mg_band_min`/`_max`, `p8n_mg_deep` (2 containers), `p8n_mg_grid1` all offered; base keys `p8n_mg_addr`/`p8n_mg_band` absent. Rule cards resolve to real pages ("— page 1", "— page 2"). **E11 producer side, live:** `POST /lg/auction` carries `p8_addr_street/_city/_state/_zip`, `p8n_radial_age`, `r2fix_carrier` and (S2 probe) `p8n_fromto_band_min/_max` — **never a base key**. Both viewports, no overflow (375: `scrollWidth 375 == innerWidth 375`) | **PERFECT** · `mg-rail-1280.png`, `mg-rail-375.png`, `mg-visitor-address-375.png` |
| **MAJOR-1 side effect — the labels the fix introduced** | Same drive; read the picker option text and the rule-card subject for every derived sub-field | `Where do you live? — Zip/Street/City/State` ✓, `Budget — Min/Max` ✓, default name group `Your name — First/Last` ✓ — **but** an operator-named name field reads **"Your name — P8n mg first"** and a maps-renamed ZIP slot reads **"Where do you live? — P8n mg postal"**: the whole storage key, title-cased, as the operator's word. The Studio's own island labels the identical fields "Address — ZIP" / "Name — First" (`ui-section-studio.ts:5596-5615`) | **DEVIATES (finding 1)** · `mg-rail-rawid-1280.png`, `mg-rail-rawid-375.png` |
| **ADJ-P8-53 consequence** — a saved rule on an Address/slider BASE key now reads "(removed field)" | Saved real rules on `p8n_mg_addr` and `p8n_mg_band` via `POST /quotes/:id/routing-rules`, then read the rail at 1280 and 375 | Both cards paint **"In a funnel" · "(removed field) is 94043" / "(removed field) at least 40" · "⚠ This rule can never apply before a visitor enters a funnel that asks these questions."** The accuracy claim is **independently confirmed by the live wire**: neither base key appears in any `POST /lg/auction` body I captured. Registered, owner-owned | **CONFIRMED as registered** (not re-filed) · `mg-rail-rawid-1280.png` |
| **MAJOR-2** — the `from_to` partition holds at coincident handles | Re-ran `scripts/p8/probe-s2-fixedpoint.mjs MERGEGATE 1280,375` at the same fixed press point (hMin.cx = 477 / 29) — **22 rows, my own run** | Typed max=40 + press 477/29 + drag RIGHT → `POST /lg/auction` carries **max 40** (was 50000) at both viewports ✓; coincident 20000/20000 drag LEFT → **max 20000** (was 25000) ✓; ordering-conflict → 20000/20000 ✓; declared max 100000 ✓; above-max 200000 → 100000 ✓; separated 20000/60000 → 40000 / 90000 / 70000 ✓. Boundary formula verified by hand: `max(midpoint, min-thumb right edge)`, and the live `clip-path` resolves to `inset(0px 0px 0px calc(14px + max(20% − 5.6px, 20% + 8.4px)))` at coincidence = the min's right edge | **PERFECT on behaviour** |
| **MAJOR-2 stated limitation** — coincident + rightward drag records nothing | Same probe rows G (1280+375), plus a dedicated coincident drive: typed 20000/100 → 20000/20000, screenshot, then `focus(max rail)` + 3× ArrowRight | G posts **20000/20000** in and out at both viewports — the gesture is inert, exactly as `styles.ts:1170-1178` states plainly. The escape hatch is real: the max rail (`aria-label="To"`, no `tabindex=-1`) takes focus and ArrowRight raises it 20000 → **35000**, and the wire carries 35000 | **PERFECT — the comment says what the product does, and it is the honest trade** · `mg-fromto-coincident-1280.png`, `mg-fromto-coincident-375.png` |
| **MAJOR-2 in-file evidence claim** | Diffed the comment's stated AFTER numbers against the conductor's OWN cited log and against my run | `styles.ts:1156` "**22 rows, 1280 and 375 identical on every row**" and `:1164-1165` "min 40000 / **min 5000** / max 90000 / max 70000" are **false**: `evidence/p8/s2/after-fixedpoint.log` itself records 1280 `F2 … drag MIN LEFT to 5%` → **20000**, 375 → 5000. My run reproduces that AND gets 1280 `H` = 20000 where the conductor's log says 5000 — the probe is **nondeterministic at 1280**. The product is fine (a 20-step/50ms drag lowers the min at 1280: 20000 → 5000; ArrowLeft likewise) | **DEVIATES (finding 3)** · `s2-mergegate-22rows.log` |
| **MAJOR-3** — the palette refusal names its SUBJECT | Live `POST /api/admin/leadgen/sections` with `palette:{brand_primary,surface_wash,button_primary_bg,accent,text_muted:"bogus"}` on the real route | **`The palette entry for 'Brand primary' must be a theme colour role (Brand primary, Brand secondary, Accent, Success, Error, Page background, Card background, Soft fill, Border, Text, Muted text, Button, Button text, Secondary button) or a #hex colour like #1A2B3C. Pick a role, or enter a hex value.`** — and `'Soft fill'`, `'Button'`, `'Accent'`, `'Muted text'`. Subject humanised, list humanised, **zero raw role ids**. The new per-role assertion (`indexOf(role) === -1`) is discriminating for all 14 (no label contains its own lowercase id); the widened predicate `/\b[a-z]{2,7}(?:_[a-z0-9]{2,}){1,}\b/i` is a strict superset of the old one and matches all 10 underscore-bearing roles | **PERFECT** |
| **MAJOR-3 exemption ruling** — the two echoed-unknown-key messages | Live-drove the same route with `design_overrides.bogus_key` | Server returns **`'bogus_key' is not a style setting you can override. Remove it — the Design tab lists the settings this Section supports.`** — byte-identical to `COPY_ECHO_EXEMPTIONS[0].message`. **I concur it is not a leak**: `bogus_key` is the operator's own input and no curated label exists to substitute (`CURATED_DESIGN_OVERRIDE_KEYS` has no entry). The exemption **cannot absorb a future site**: it matches on the EXACT full message (not a value substring), is pinned by `toEqual([…])` set-equality to exactly two rows, `CLAUSE_REF` is still checked before the `continue`, and both falsifiable directions are asserted | **PERFECT** |

## Findings (listed first, ranked after)

1. **The MAJOR-1 fix introduced raw storage ids into the rules rail's operator copy — the exact
   jargon class the owner rejected.** `api/src/admin/leadgen/ui-quotes.ts:1053-1058`:
   `const tail = own !== "" && field.startsWith(own + "_") ? field.slice(own.length + 1) : field;`
   — when the derived key is not `{own}_{suffix}` the WHOLE key becomes the operator-facing tail.
   Two operator-reachable shapes, both driven with keys I authored this session:
   * a NameFieldsGroup whose `props.fields` are namespaced → picker option and rule-card subject
     read **"p8n_mg_universe · Your name — P8n mg first"**;
   * an Address whose `props.maps.fills.zip` points at a sibling key → **"p8n_mg_labels · Where do
     you live? — P8n mg postal"**. That slot is authored from the real Studio **Maps tab** fill
     picker (`ui-section-studio.ts:3202-3211`), not only from the API; the seeded `p8n_rr2m3 Clean
     Addr` reproduces it as "Address — P8n rr2m3 freezip".
   The ROLE is known to the derivation (`leadgenAddressAnswerFields` produced that key *for the zip
   slot*; a name slot is index 0/1) and is thrown away in favour of text arithmetic on the key.
   **The product already contains the correct derivation** — the Studio island at
   `ui-section-studio.ts:5596-5615` matches `slFills[role]` / `props.fields[0|1]` and labels the
   identical fields **"Address — ZIP"** and **"Name — First"**. So the rail and the Studio now
   disagree about the same field's name. Violates the function's own contract ("plus the role,
   humanized"), MINOR-1's anchor ("the operator's own question words, never the storage id — this
   string IS the rule card's subject") and M5/R5/§12.4.
   **INSIDE MAJOR-1 / M5 / REQ-R5.** `mg-rail-rawid-1280.png`, `mg-rail-rawid-375.png`.

2. **The unit test that claims finding 1 is impossible is written on a fixture engineered to hide
   it.** `api/test/leadgen-quotes-ui.test.ts:971-989` — *"every offered field reads in the
   operator's own words — never a bare storage id"* — drives `S1_NAME_GROUP` with
   `props: { fields: ["given","family"] }` (`:899`), the one shape whose raw keys humanize into
   role-looking words ("Given"/"Family"), and its guard loop only excludes the literal prefixes
   `"p8_addr_"` and `"budget_"` — neither of which the name group uses. `S1_ADDRESS_COLLIDE`
   (`:882`, `fills.zip → postal_code_x`) IS in the 6-shape universe but is NOT in the label test.
   Substituting the product's own default `["first","last"]` keeps the test green; substituting any
   namespaced pair makes the product emit the raw key while the test still asserts the opposite.
   Green-but-wrong. **INSIDE MAJOR-1.**

3. **`styles.ts`'s MEASURED-AFTER block states two numbers its own cited evidence file
   contradicts, and the instrument behind them is nondeterministic.**
   `api/src/public/leadgen/designs/default-funnel/styles.ts:1156` — *"22 rows, 1280 and 375
   identical on every row"* — and `:1164-1165` — *"the separated 20000/60000 drags unchanged in all
   four directions (min 40000 / **min 5000** / max 90000 / max 70000)"*.
   `docs/leadgen/r2/evidence/p8/s2/after-fixedpoint.log`, the file the comment names, records
   1280 `F2 separated 20000/60000: drag MIN LEFT to 5%` → **20000**, 375 → 5000. My independent
   22-row run at HEAD reproduces 1280 F2 = 20000 and additionally records 1280 `H` = 20000 where
   the conductor's log records 5000. **The product is NOT broken** — I re-drove the same gesture
   with 20 moves × `steps:3` × 50 ms and the min goes 20000 → 5000 at 1280, and ArrowLeft on the
   focused min rail does the same — so `probe-s2-fixedpoint.mjs`'s 10-move/20 ms drag is the flaky
   part. But a false "MEASURED AFTER" number in a product source comment is the *same class* the
   previous round's MAJOR-2 was raised for (an after-number its evidence does not support), and the
   next reader cannot reproduce the stated table. **INSIDE MAJOR-2 / ADJ-P8-51.**
   `s2-mergegate-22rows.log`.

4. **Two conductor-authored claims name a field pair the product never produces.**
   `docs/leadgen/r2/P8-REGISTER.md:157` (ADJ-P8-53) says the rail previously offered "neither
   `given`/`family`", and `ui-quotes.ts:1052` gives **"Your name — Given"** as an example output.
   The NameFieldsGroup default is `["first","last"]` (`api/src/leadgen/answers.ts:329`); driven, the
   picker reads **"Your name — First" / "— Last"**. `given`/`family` exists only inside the test
   fixture of finding 2. Claim rot in the row the owner is being asked to rule on.

5. **`gap`'s new zero-branch also fires on an EMPTY number box.**
   `api/src/public/leadgen/runtime/engine.ts:642-643` —
   `const gap = moved === own || (own !== undefined && Number(own.value) === other) ? 0 : step;`.
   `Number("") === 0`, so a `from_to` whose moved side's labelled box has been cleared and whose
   neighbour sits at the declared minimum takes the zero-gap branch and can land exactly ON its
   neighbour instead of one step short. Narrow (both ends at the bottom of the range) and
   **not driven — UNVERIFIED in practice**, stated as code analysis only.

6. **Pre-existing, OUTSIDE the S wave:** `ui-quotes.ts:1163/1168` still falls back to
   `entry.label ?? entry.internal_field`, so a BASE field whose question carries no `props.label`
   prints its raw key. Driven, unchanged by this wave:
   `r2fix_carrier | R2Fix Fixture Carrier Buttons · r2fix_carrier`. Owner-row candidate, not an
   S-wave regression.

7. **Gate-log completeness + tree hygiene.** `p8-phase-6-run5.log:3060` asserts *"p3a recapture:
   ZERO real diffs across all 11 fixtures"* but the log contains no `=== p3a ===` section and no raw
   recapture output — the only unbacked line in an otherwise fully-raw log. I recomputed it myself
   and it is TRUE (0 real normalized diff lines across the 5 dirty fixtures). Separately: that
   recapture left the tree **dirty** (5 fixtures, ULID-only, mtime 18:13:28 — after the 18:09:36 gate
   start, before the 18:14:13 log commit). `[status-empty=yes]` is honest for the moment it was
   taken; the squash PR must discard those 5 fixture edits (or the "porcelain-clean" premise for the
   next gate is already false).

## Scans

* **Deferral markers on added lines** (`\b(TODO|FIXME|HACK|XXX)\b`, "polish later", "for now",
  `defer(red)? to (v2|later|a follow-up)`, `simplified for (now|v1)`, `will be (done|added) later`,
  plus "later slice" / "out of scope for" / "not implemented" / "stub"): **0 hits** across the whole
  S-wave diff (`api/src`, `api/test`, `api/scripts`, `docs`); the only matches are the predecessor's
  own REVIEW.md prose describing its scan.
* **Reduced models, marker-free:** finding 1 (a label derived by string arithmetic on the key when
  the role is already in hand, and already derived correctly 4,500 lines away in the same repo).
  Nothing else: no locked options, no dead controls, no placeholder content; every flow I judged was
  reached from content I authored from scratch, and the ADJ-P8-53 base-key inertness was confirmed on
  the live wire rather than from the register row.
* **Every-consumer proof:** `internalFieldEntriesOf` / `internalFieldsOf` are **gone** from
  `ui-quotes.ts` with **0 remaining code references** anywhere in `api/src`/`api/test` (the
  `ui-section-studio.ts` hits are its own separate island-side `internalFieldsOf()` at `:5470` plus
  comments). `quoteRailAnswerFields` / `sectionFieldsByPublicId` keep their signatures; consumers are
  `ui-quotes.ts:885`/`:900` (driven end-to-end above) and three test files, all green in the run-5
  log. The three new imports (`fieldsOf`, `collectAnswerKeyClaims`+`foreignAnswerKeysIn`,
  `flattenComponents`+`leadgenComponentName`+`leadgenControlLabel`) add no cycle (typecheck 0,
  `verify:all` 0). The clip-path change's consumers are the 4 CSS pins — the two fixtures gain
  exactly the one rule. `syncDualRange` regenerated the runtime bundle byte-identically
  (`freshness: OK`), 53,181 measured by hand.
* **Security:** the changed `src` files (excluding the generated bundle) add **no** SQL, no
  `innerHTML`/`outerHTML`/`eval`/`new Function`/`document.write`, no `new RegExp` on external input,
  no new route and no authz surface. The new operator-authored label reaches the DOM through the
  rail's JSON blob, which is `JSON.stringify(...).replace(/</g,"\\u003c")` at
  `ui-rules-builder.ts:2361` before the `<script>` interpolation, so a `</script>` in a section name
  cannot break out. The widened `RAW_ID_IN_COPY` regex is test-only and non-backtracking (`_` is
  outside `[a-z0-9]`, so the group boundaries are forced — no ReDoS). No secrets added.
* **Silent failures:** none new. The rail's `(removed field)` path surfaces a reason and a warning
  rather than swallowing; the palette refusal names the setting; `POST /quotes/:id/routing-rules`
  accepts a field outside the picker universe (that is how a pre-existing rule survives) and the rail
  then reports it honestly.

## Ranking
**BLOCKER:** none. **MAJOR:** 1, 2, 3. **MINOR:** 4, 5, 6, 7.

## Fixture disclosure (mine, not a product finding)
Authored and cleaned up: quote `lgq_01KZ98BA45P7Q425J4F5CHK02X` (**archived**, `DELETE` 200) and its
7 routing rules (`DELETE /routing-rules/:id` 200 each). Two sections —
`p8n_mg_universe` (`lgs_01KZ98A70M95BTHXA7KNRRC3SD`) and `p8n_mg_labels`
(`lgs_01KZ98EX9KFQDT2XJ4CZ0CB9MH`) — **could not be deleted** ("This section is used by quotes —
archive it instead", still referenced by the archived quote) and remain in the r2fix_activity
section library; same residue class as my predecessor's three. I posted ~6 real
`POST /lg/auction` bodies against the untouched `r2fix` fixture funnel (visitor traffic rows only);
`/lg/r2fix` serves **200** at the end of my drive. I changed no activation, no theme and no
fixture section. P8-Charlie is untouched by me.
