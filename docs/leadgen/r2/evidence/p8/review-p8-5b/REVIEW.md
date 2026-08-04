# P8-4 + P8-5 scoped re-review — **FIX-FIRST**

Fresh-context Opus 5 reviewer. Drove the already-running instance on `:8901` as a CLIENT
(started/stopped nothing, never bound 8787). Authored five probe sections through the real
`POST /sections` route (`p8n_rr_fills probe`, `p8n_rr_partial probe`, `p8n_rr_err probe`,
`p8n_rr_grid probe`, `p8n_rr Wrong Vertical Probe`), drove the real Section Studio, the real
`PUT /variants/:id`, the real visitor funnel and the real `POST /lg/auction`, then **deleted
every probe section and restored funnel A's original 5 pages** (verified: the served visitor
page carries the byte-identical `data-lg-field` census it carried before I started).

Branch HEAD `3297c46`; `git show --stat 3297c46` = **1 file, 6245 insertions** (the gate log
only), so product code is `5ae95221`. Verified by my own hand.

## Gate-log audit (recomputed, nothing re-run)
`gate-logs/p8-phase-5-run3.log`, run 4 block (from line 3189):
`HEAD: 5ae95221…` == the product sha ✓ · `[status-empty=yes]` ✓ · five exit codes present and
0 (TYPECHECK 3197, VITEST 6043, VERIFY_ALL 6204, RUNTIME 6215, REGISTER 6226) ✓.
**Recomputed my own way** by parsing every `test/<path>.ts (N tests[ | M skipped])` line in the
main run: **499 files, 8342 tests, 30 skipped ⇒ 8312 passed** — exactly the summary
(`497 passed | 2 skipped (499)`, the 2 being the `↓` files). The second summary in the block
(`2 passed | 1 skipped (3)`, 11/19/30) is `verify:all`'s own 3-file run, separately accounted —
not an unaccounted shard. jargon `TOTAL: 0 hit(s) across 5 categories` ✓ · golden
`UNCLASSIFIED 0` ✓ · bundle `53063 bytes, 99.7%` = **185 free of 53,248** ✓ · register
`rows checked: 93 / TOTAL violations: 0`, independently recounted **93 data rows** (6 headers,
6 separators) ✓ · p3a `0 real lines across 11 fixtures` ✓. Zero-drift correction: `removed
pre-existing: 0`, `7739 vs 7692 (delta +47 = 43+1+3)`, and **8342 − 7739 = 603** so the
`7739 + 603 = 8342` arithmetic closes. The recorded instrument error (a first pass keyed on
basenames while the baseline keys on `test/<path>`, wrongly reporting all 471 files removed) is
correctly described and the corrected numbers are right. **No arithmetic problem in the log.**

## Per-clause verdict table

| Finding | What I drove | Measured | Verdict |
|---|---|---|---|
| **B-1** fills collision / buyer payload | Real Studio fills picker on a default 4-field Address and on a street+city Address, both viewports; then real "+ Add field → State"; then the real visitor walk to `POST /lg/auction` at 1280 **and** 375 | Direct path CLOSED: all 4 slots show `p8n_rr_town — already answered by Nearest town RR` disabled, and the auction carries `p8n_rr_town` **and** `p8n_rr_addr_city` under their own keys. **But the collision is still reachable in two clicks**: the `state` picker offered the sibling key ENABLED (slot not rendered), and adding the State row then renamed its visible box — `data-lg-field="p8n_rr_town2"` **twice**, and the auction body carries `"p8n_rr_town2":{"value":"RR-1-3-State"}` with the visitor's town answer **gone** and **no `…_addr2_state` key**. Identical at both viewports, zero warnings anywhere | **DEVIATES (BLOCKER-1)** · `b1-order-two-boxes-one-key-1280.png` |
| **M-1** selection badges | All selectable nodes of an authored grid section, badges enumerated structurally and intersected with every visible `.lg-label`, 1280 + 375 | `labelHits = []` for all three nodes at **both** viewports. Type badge y 26–47 above label y 69–85; container chip y 51–67 clear; Phone badge y 255–276 vs label y 280–296. Residual: the q_g2 badge overlaps q_g1's *"Yes"* answer button 62.2 × 9px | **PERFECT** (clause letter) · `m1-grid-selected-1280.png` |
| **M-5** save at 375 | Real `page.mouse.click` at the save button's centre, after dirtying `#lg-section-name` through the real control | 375: topbar **186.5px**, `elementFromPoint` = `BUTTON#lg-section-save`, real click → **PATCH + POST**, and the stored `section_name` came back **equal to my 375 stamp**. 1280: topbar **exactly 56px**, real click saves | **PERFECT** · `m5-realclick-375.png` |
| **M-2** vertical mismatch | Both call sites through the real `PUT /variants/:id` (`pages` and `sections` bodies) with a matching-activity / wrong-vertical section I authored | Byte-identical at both sites: *"'p8n_rr Wrong Vertical Probe' is a insurance section, but this quote's Verticals only include r2fix_vertical — pick a section in one of those verticals, or add insurance to the quote's Verticals."* No ULID. **But the ACTIVITY-mismatch sibling three lines above each fixed line still prints `section lgs_01KZ70EVP3VCDVCY8T3WWHPKY6 activity 'auto' does not match…`, and it short-circuits first** | **DEVIATES (MAJOR-1)** |
| **M-3 / M-4** canvas↔live parity | My own authored section (required FreeText + Address with required custom-regex City and required zip5 ZIP): real `POST /sections/preview` for 3 sim states vs the real hydrated visitor page driven with real Continue clicks; 5 answer keys × 3 states = 15 rows | `error` state: **5/5 rows agree**, non-vacuously (live paints 3 red required messages). **`validation_error` disagrees on the plain FreeText**: canvas `lg-error` + `aria-invalid=1` + visible *"The value has an invalid format."*, live nothing at all. `validation_success`: 2 rows = ADJ-P8-49 exactly, reproduced | **DEVIATES (MAJOR-2)** · `g3-live-error-1280.png` |
| **m-1** two new jargon messages | Both conditions through the real `PATCH /sections/:id` | *"A custom address rule's pattern must be at most 200 characters. Shorten it, or switch the rule off."* / *"…isn't something the browser can read. Fix the pattern, or switch the rule off."* No `(§` | **PERFECT** |
| **m-2** Maps job triple | Real save with Maps on and zero jobs | *"Maps is on but no job is selected ('Validate the answer', 'Use in auction rules' or 'Auto-complete the address') — it does nothing at runtime. Pick a job or turn Maps off."* — the operator's own checkbox labels | **PERFECT** |
| **m-3** R5 check universe | Source audit of `leadgen-p8-r5-copy.test.ts:48-57` + live `(§` sweep | 7 roots (sections.ts, quotes-handlers, funnel, activation, ui-rules-builder, ab, themes) + transitive closure; 0 `(§` in every driven response. **But the predicate is `/§/` + a hand-listed raw-id regex set with no `public_id`/ULID shape**, so MAJOR-1 sits inside the widened universe and the check is green | **PERFECT on the widening, MINOR on the predicate** |
| **m-4** 201-char custom rule | Served HTML attribute check + a programmatically-set 201-char City value on the real visitor page, both viewports | `maxlength="200"` emitted on the custom-rule input (`maxlength="5"` still only on zip5). 201 chars → `lg-error`, `aria-invalid="true"`, visible *"Enter at most 200 characters."*, Continue blocked, **0 auction posts**. Fail-closed confirmed | **PERFECT** · `m4-201char-1280.png` |
| **P8-4 F12** `offeredIn` single quotes | Source at HEAD | `offeredInSources` (`:1302`) matches `"key"` **and** `'key'`. The F12-corrected `styles.ts:2673-2681` comment's three greps all TRUE at HEAD: `['\"]section_slot` → 0, `-rl section_slot src/admin` → 5 files, `-rn` → 7 lines | **PERFECT** |
| **P8-4 F13 + F14** fixture honesty | Ran the touched file `test/leadgen-p8-m3-apply-template.test.ts` | `operatorSaves` is the single mirror (7 call sites); `:407` is the only `frame_config_json` PUT in the file; census reproduces **28 · 2 · 26**, shadowed = exactly the two operator-authorable leaves; the two legs end on **different after-shas from the same before-sha** (`88ed2f19 → f2b401bb` vs `→ 810c736f`) | **PERFECT** |

## Ruling on the `CHARACTERISATION:` name — **KEEP IT**
`test/leadgen-p8-m3-apply-template.test.ts:584`. The dispatch's premise is true (different
after-shas from one before-sha) but insufficient. The leg's write is `pointerOnlyApply`, a
**raw `h.sdb.prepare("UPDATE leadgen_funnels SET frame_template_id = …")` inside the test** —
it never touches the fixed handler. It is therefore **fix-invariant**: revert the whole M3
materialise change and this leg still passes with the same numbers. A `FAIL-BEFORE:` name
asserts sensitivity to the fix, which this leg structurally cannot have. Renaming it would
plant a false in-file claim of exactly the class this mission keeps catching. The current name
understates, its comment is accurate, and it should stay.

## Findings (listed first, ranked after)
1. B-1 reachable via the authoring-order path (`ui-section-studio.ts:9090`) — money path.
2. Activity-mismatch raw ULID at `quotes-handlers.ts:2853` / `:3163`.
3. `validation_error` canvas fabricates a format error for any non-address rule-less field (`preview-sim.ts:532`).
4. `content-schema.ts:3434` Title-Cases an unknown component type into a name that does not exist.
5. `payload.ts:696` keeps *"isn't a valid regular expression"*; `:689` says *"hang the server"* — two registers for one condition.
6. Type badge overlaps question 1's answer button 62.2 × 9px (label clause itself met).
7. R5 copy check's predicate cannot see a raw stored id (`leadgen-p8-r5-copy.test.ts:69-83`).
8. `P8-REGISTER.md:138` cites 27 · 2 · 25 while the shipped test measures 28 · 2 · 26.
9. `Create "<base>_<slot>"` still offered for a slot the Address does not render (pre-existing).

**BLOCKER** 1 · **MAJOR** 2, 3 · **MINOR** 4, 5, 6, 7, 8, 9.

## Scans
* **Deferral markers in added lines** (`\b(TODO|FIXME|HACK|XXX)\b`, "polish later", "for now",
  `defer(red)? to (v2|later|a follow-up)`, `simplified for (now|v1)`, `will be (done|added) later`):
  **0 hits**.
* **Reduced models, marker-free:** findings 1, 3, 5, 7 and 9. Findings 1 and 3 are the same
  shape — a rule stated generally and implemented over a narrower universe.
* **Security:** the 8 changed `src` files (excluding the generated bundle) add **no** SQL, no
  `innerHTML`/`outerHTML`/`eval`/`new Function`, no new route and no authz surface. Two
  `new RegExp` sites: `preview-sim.ts` `dropBooleanTagAttr` compiles a fixed literal name, and
  `validation.ts:546` now length-gates to ≤200 chars **before** `.test()` (ReDoS floor kept,
  and the branch flipped fail-open → fail-closed). The one new author-data interpolation
  (`describeVerticalMismatch` puts `section_name` into an operator message) reaches the board
  through `showInlineErr`, which uses `document.createTextNode` — no injection.
  `api/.dev.vars`'s two `GOOGLE_MAPS_*` values remain length 0.
* **Untouched surfaces:** nothing under `api/test-ui/__screenshots__/` was read, run or
  rebaselined. No deploy, no secret, no `--remote`.

## Already-surfaced rows I re-confirmed (not re-filed)
ADJ-P8-41 (activation 409s quote-wide — the preflight still reports *"Funnel 'P8-Charlie' needs
at least one page with a section."*), ADJ-P8-46's ruling (I agree: R6-2's sentence is
descriptive; read prescriptively it contradicts M4 in the same document, and the picker's
"shown, named, not claimable" treatment is the correct reading — see BLOCKER-1 for where it
stops), ADJ-P8-47 (the uniqueness universe at `content-schema.ts:3781` is literal
`internal_field` values only), ADJ-P8-48, ADJ-P8-49 (reproduced verbatim: canvas paints
`lg-valid` on both field shapes, live paints it nowhere).
