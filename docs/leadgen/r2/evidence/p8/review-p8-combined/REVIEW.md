# P8-5 wave 2 + P8-6 combined adversarial review — **FIX-FIRST**

Fresh-context Opus 5 reviewer. Drove the already-running `:8901` instance as a CLIENT
(started/stopped nothing, never bound 8787). Authored every probe through the real
`PATCH /sections/:id`, `PUT /variants/:id`, `PUT /quotes/:id/shared-page`,
`POST /quotes/:id/routing-rules`, `POST /sections/preview` and the real visitor funnel to
`POST /lg/auction`, with keys unique to this session (`p8n_cr_*`). Both probe sections
restored **byte-identical** (verified by JSON compare against the pre-drive snapshot).

Branch HEAD `bcfde161`; `git show --stat bcfde161` = **1 file, 6108 insertions** (the gate
log only), so product code is `5bbed2cf`. Verified by my own hand.

## Gate-log audit (recomputed, nothing re-run)
`gate-logs/p8-phase-6-run1.log` run 2 (line 3050 →): `HEAD: 5bbed2cf…` == the product sha ✓ ·
`[status-empty=yes]` ✓ · five exits present and 0 (TYPECHECK 3060, VITEST 5907, VERIFY_ALL
6067, RUNTIME 6077, REGISTER 6087) ✓. **Recomputed my own way** by parsing every
`test/<path>.ts (N tests[ | M skipped])` line in the run-2 vitest block: **499 files, 8383
tests, 30 skipped ⇒ 8353 passed** — exactly the summary; the 2 skipped files are the two `↓`
conversions files; the second summary (`2 passed | 1 skipped (3)`) is `verify:all`'s own
3-file run, separately accounted. jargon `TOTAL: 0` ✓ · golden `UNCLASSIFIED 0` ✓ · bundle
**53,124 of 53,248 = 124 free** ✓ · register **96 rows / 0 violations** ✓ · zero-drift:
`9+1+3+11+43+4+3+9+5 = +88` reconciles `7692 → 7780`, `new files 28 (+603)`, and
`7780 + 603 = 8383` ✓. **No arithmetic problem in the log.** Nothing under
`api/test-ui/__screenshots__/` was read, run or rebaselined (`git diff --name-only` = 0).

**p3a date-rollover check (asked specifically): CONFIRMED a rollover, not content.** The only
differing non-id lines in `quotes-list-empty.html` / `quotes-list-seeded.html` are
`data-analytics-from="2026-07-06"→"2026-07-07"` and `data-analytics-to="2026-08-04"→"2026-08-05"`
— a uniform +1 day on both ends of one 30-day window. The suite normalises exactly those two
attributes (`leadgen-p3a-split-parity.test.ts:228` `ANALYTICS_DATE_RE`), so the change is a
no-op for the gate. (See finding 7: that normaliser is *not* new.)

## Per-clause verdict table

| Clause | Owner anchor | What I drove | Measured | Verdict |
|---|---|---|---|---|
| **BLOCKER-1** fills TOCTTOU | *"the mapping of what is auto-filled per field should definatly be an option"* | Real `PATCH` stage A (street+city, `fills.state`→sibling `p8n_cr_town`) → stage B (`+ Add field → State`) → real visitor walk to `POST /lg/auction`, 1280 + 375 | Rendered keys `p8n_cr_addr_street / _city / _state / p8n_cr_town`, **0 duplicate keys**; auction body carries `"p8n_cr_addr_state":{"value":"CA"}` **and** `"p8n_cr_town":{"value":"CR-SIBLING-TOWN"}` | **PERFECT** · `B1-tocttou-hop0-375.png` (state + town both on screen as separate boxes) |
| **MAJOR-1** activity mismatch | *"the rules you build are using jargon, have no actions"* | Real `PUT /variants/:id` on **both** call sites (`sections[]` and `pages[].slots[]`) with a wrong-activity section | Byte-identical at both: `'G1 B1 after v2' is a auto section, but this quote's Activity is r2fix_activity — pick a section under r2fix_activity, or change the quote's Activity to auto.` No ULID; the sibling inactive/unknown/FK messages also speak | **DEVIATES (MINOR only)** — article agreement "is **a** auto section" (finding 6) |
| **MAJOR-2** canvas `validation_error` | *"the canvas should include one section in the middle so the user could see a real reference of how is design is gonna look like in real life"* | Real `POST /sections/preview {sim:{state:"validation_error"}}` vs a real visitor typing a failing value into each shape, 1280 + 375 | rule-less FreeText: canvas draws **nothing** (slot hidden, no message) == live nothing. `pattern` → both *"The value has an invalid format."*; Email → both *"Enter a valid email address."*; **ZIP (a branch the fix declares UNMEASURED)** → both *"Enter a valid 5-digit ZIP code."* 4/4 rows agree at both viewports | **PERFECT** · `g3-live-validation-1280.png` |
| **ADJ-P8-51** typed `from_to` | Image11 | Real per-character keystrokes "40" into "To ($)" on `min=0 max=100000 step=5000`, blur, then the full walk to `POST /lg/auction`, 1280 + 375 | Box keeps **40**, pill paints **$40**, auction carries `"p8n_cr_band_max":{"value":"40"}` at both viewports | **DEVIATES (MINOR)** — undisclosed second consequence: both thumbs land on one pixel and the min handle is buried (finding 5) · `t-fromto-typed40-1280.png` |
| **payload builder** stops offering an unrendered address key | §4 R3 corollary of *"the mapping of what is auto-filled per field should definatly be an option"* | Real `GET /offers/:id` `builder_context.linked_fields` across 3 authored states on a linked section | collide → `[street, addr_zip, pcx]` (the RESOLVED key, never both names); external fill (zip row unrendered) → `[street, pcx]`; plain rename → `[street, p8n_cr_freezip]` | **PERFECT** |
| **auction ZIP facet** | *"Turn the ZIP into a location the auction can target"* (§9) | Real stored `content_json` from the live API → real `collectMapsAuctionFields` + `normalizeAnswers` + `deriveAuctionFacet` with the answers a real visitor posted | collide: `zipField "p8n_cr_addr_zip"`, facet `{"zip":"94043"}` (not null, not the sibling's `"not-a-zip"`); no-fill control identical | **PERFECT** |
| **§12.8 ZIP report** | *"validate the Zip in a 5 digits zip validation"* | Real `POST /sections/:id/validate-payload` in the collision state | `zip_fields:["p8n_cr_addr_zip"]`, `checks:[{field:"p8n_cr_addr_zip",present:true,valid:true}]`, `malformed:[]` — the sibling's free text is no longer falsely flagged | **PERFECT** |
| **visitor typing a valid ZIP no longer blocked** (X1) | *"I want the user will insert the Zip by himself but to validate the Zip in a 5 digits zip validation"* | Real visitor: valid `94043` in the address ZIP box + garbage in the colliding sibling → Continue; then the **fail-closed control**: invalid `12` in the ZIP box, valid `99999` in the sibling, with and without the fill | Valid ZIP: advances, auction carries `p8n_cr_addr_zip:"94043"` (1280 + 375). Invalid ZIP: **blocked** in BOTH the no-fill control and the fill case — `aria-invalid=["p8n_cr_addr_zip"]`, visible *"CR: enter a 5-digit ZIP."* Fail-closed both directions | **PERFECT** · `zipctl-fill-invalid-1280.png`, `zipctl-noFill-invalid-1280.png` |
| **§9.5 shared-renderer invariant** | fix-contract 09 §9.5 | Source audit at HEAD + the invariant test's own predicate | `preview-sim.ts` carries no `data-component-type` and no direct presets import — but `preview-sim.ts:62 → config-dto.ts:36-40 → presets.ts` is a **new** transitive renderer dependency this wave created, and assertion (c) is a literal string check that no longer discriminates | **DEVIATES (MINOR)** (finding 8) |
| **N2** rules jargon | *"the rules you build are using jargon"* | Opened the real rule modal, added a real condition row, read the op `<select>` and the helper | Helper LIVE: `Operators: is · is not · greater than · less than · at least · at most.` (jargon tokens gone). Picker LIVE offers **11**: `is (=) · is not (≠) · greater than (>) · less than (<) · at least (≥) · at most (≤) · between · in list · not in list · is empty · is not empty` | **DEVIATES (MINOR)** — 6 of 11 (finding 4) · `n2-op-picker-1440.png` |
| **N3** removed-field fallback | *"the rules you build are using jargon"* | Authored a real routing rule on `p8n_cr_field_that_never_existed`; read SSR **and** the hydrated island | Both read `(removed field) is x`; zero raw ids; SSR `(removed field)` hits = 2 | **PERFECT** · `n3-n4-rail-1440.png` |
| **N4** page ordinal | *"the order of the pages could be changed"* | Real rule on `r2fix_carrier` (stored `checkpoint_page: 3`); read SSR **and** island against the board's own cards | Both read `In funnel R2Fix Fixture Quote — Funnel A — page 4`; board cards read PAGE 1…4; `— page 0` hits = 0; stored `checkpoint_page` untouched at 3 | **PERFECT** · `n3-n4-rail-1440.png` |
| **N5** basis points | *"the rules you build are using jargon"* | Real A/B panel on a quote I created, 1280 + 375 | `…split the traffic below (must sum to **100%**) before a test can start.` — regex sweep of the rendered panel for `basis point|10000|\bbp\b|control` = **null** at both viewports | **PERFECT** · `n5-n10-ab-1280.png` |
| **N8** create-A/B confirmation (+5 siblings) | *"The AB test can be also in the funnel level and not only in the page level."* | Clicked the real Create A/B test, waited through the real reload; then a 2nd reload; then the real Deactivate site button | After the reload a green banner reads *"A/B test created. It is not running yet - press Start A/B test."*; the 2nd reload shows nothing (one-shot holds). Deactivate: `Deactivated for st_cad9f863eb2444a1.` survives the reload and the DELETE really flipped `enabled` | **DEVIATES (MAJOR)** — the deactivate confirmation prints a raw site id (finding 2) · `n8-create-ab-confirm-1280.png`, `n8-deactivate-1440.png` |
| **N10** no "control" | *"there is no 'control' funnel!!!"* | Real `/quotes/new` at 1280 + 375 and the real A/B panel | `A funnel with one variant is created automatically (every Quote has at least one variant).`; A/B: `Every variant is treated the same — none of them is a baseline.` No `control` in either rendered surface (the surviving `control variant` hits are island **code comments**, not painted text) | **PERFECT** · `n10-quotes-new-1280.png`, `n5-n10-ab-1280.png` |
| **N13** Output-preview chip | *"I can define that only the number is sent, and I can define that the number will be sent as string"* | Real payload builder, real leaf node, real Output-format select, sample `170000` | `toNumber` → `170000 → 170000`; `toString` → `170000 → "170000"`; `formatCurrency` → `170000 → "$170,000"`. A number and a quoted string are now distinguishable | **PERFECT** · `n13-output-preview-1440.png` |
| **N19** A-4 refusal | *"why the user can choose the same page more than ones in the same funnel???"* | All four reachable A-4 paths through the real routes: variant-save (`sections[]` and `pages[]`), and shared-page-save (self-repeat, and a section that lives in a funnel) | variant-save → correct on both sides of the union, key `sections.uniqueness.1`, no fake array index. **shared-page-save → always claims "already on the Shared first page", even for a section that is in Funnel A and not on the shared page at all** | **DEVIATES (MAJOR)** (finding 1) |

## Findings (listed first, ranked after)

1. **N19's shared-page save path blames the wrong surface — the same defect, inverted.**
   `quotes-handlers.ts:2364-2379` derives `onSharedPage` from the ids being **submitted**, and
   `sharedPageUniquenessErrors:2694-2723` always passes the prospective shared list as
   `sharedIds`, so that path can never emit the funnel sentence. Driven:
   `PUT /quotes/lgq_01KZ271383Y0MPV4BM2WKKCC4W/shared-page {slots:[shared, RVW2D-Delta]}` →
   `'RVW2D Delta Unique Drop Probe 8842' is already on the Shared first page — every visitor
   sees that page first, so a section can appear once per funnel.` `GET /shared-page` shows the
   shared page holds only `R2Fix Fixture Shared Continue`; the named section is in **Funnel A**.
   The operator is sent to hunt a chip that is not on that page — verbatim the harm the fix's own
   comment describes. The test (`test/leadgen-rework-handlers.test.ts:540-557`, `:941-946`) only
   covers the variant-save direction, so the suite is green. **INSIDE N19.**
2. **N8 planted a new raw-system-id leak on the money path.**
   `quotes-tabs/funnel.ts:4757` (`'Deactivated for ' + siteId + '.'`) and `:4754`
   (`'Could not deactivate ' + siteId + '.'`) are new operator-visible strings from this wave.
   Driven: `Deactivated for st_cad9f863eb2444a1.` while the same card renders the site NAME
   "R2Fix Fixture Site". This is the exact class MAJOR-1 swept out of `quotes-handlers.ts` three
   commits earlier; the R5 copy check's predicate has no `st_`/public-id shape so `verify:all`
   is green. **INSIDE M5** (`REQ-R5` / *"the rules you build are using jargon"*).
3. **H1 moved the renderer without moving `collectKnownAnswerFields`, so the address's real ZIP
   key is now invisible to the rules universe.** Driven with `fills.zip → p8n_cr_pcx` and a
   sibling answering `p8n_cr_pcx`: the served page carries `data-lg-field="p8n_cr_addr_zip"`
   and the auction body carries it, but the rail's `answer_fields` blob contains only
   `p8n_cr_addr` and `p8n_cr_pcx`. Forcing a rule on `p8n_cr_addr_zip` stores with
   `checkpoint_page: null` and the rail paints *"This rule can never apply before a visitor
   enters a funnel that asks these questions."* — about a field visitors do answer. Verified at
   the source: `collectKnownAnswerFields([ADDR,SIB])` →
   `["addr","q_addr","addr_street","addr_city","addr_state","postal_code_x","q_sib"]`, no
   `addr_zip`. Before H1 renderer and universe agreed; H1 broke the agreement. Named only in a
   source comment (`presets.ts:3390-3399`), absent from the register. **INSIDE REQ-R1 / M4.**
4. **N2's new helper enumerates 6 of the picker's 11 operators** (`ui-rules-builder.ts:2226`,
   a hardcoded literal, not derived from `RULES_BUILDER_OPS:110-122`). Driven: the
   `select.lg-rb-op` 30px below offers `between`, `in list`, `not in list`, `is empty`,
   `is not empty` as well. Clause letter met; the sentence still misdescribes the tool.
5. **ADJ-P8-51's disclosure is incomplete: the typed path can put both `from_to` thumbs on one
   pixel and bury the min handle.** Driven: after typing 40, both visible rails read `0` with
   identical geometry (x 463 w 354); a real pointer drag starting on the min thumb moved the
   **max** to 50000 (`to` 40 → 50000) while `from` stayed 0. `engine.ts:549-573`'s rewritten
   CLAMP RULE still cites *"the two thumbs can never land on the same pixel — which would bury
   the lower one under the upper one's hit area and deadlock the pair"*, and
   `default-funnel/styles.ts:1024-1026` still says the clamp *"can land the two handles one
   `step` apart"*. Recoverable via the "From ($)" box (and `dual_range` has no typed path), but
   the register cell discloses only the invisible-thumb drift.
6. **Article agreement in the new M5 copy**: `quotes-handlers.ts:2896` emits *"is **a** auto
   section"* (and `:2879` *"is **a** insurance section"*) — the same live-grammar class the
   contract itself cites (`1 field need attention`, N16-4).
7. **Register row `ADJ-P8-3` is false at HEAD.** It says the p3a rolling-date flake is "Not
   fixed" and BLOCKED for the owner, but `test/leadgen-p3a-split-parity.test.ts:223-240` has
   carried `ANALYTICS_DATE_RE` plus a clock-faked 2027 durability proof since `6bfb05fe`
   (2026-07-23), before P8 began. Commit `17cc7fd1` compounds it by calling the rollover a
   "New normalisation axis, noted".
8. **§9.5's stated invariant is now true only of the literal import string.** This wave added
   `preview-sim.ts:62 → config-dto.ts:36-40 → presets.ts`. Leg (b) still discriminates, so the
   substance ("preview defines no component markup") holds; assertion (c)
   (`leadgen-parity.test.ts:101-103`) does not.
9. **Bookkeeping**: the raw-id sweep is reported as "9 sites … 8 fixed, 2 cleared" (8+2 = 10).
   At HEAD only 2 remain (`quotes-handlers.ts:3845`, `:4357`, both `target_section_id`); I
   independently confirmed 0 admin-UI producers for that field, so the clearance evidence holds
   — only the count is inconsistent.

**Ranking — BLOCKER:** none. **MAJOR:** 1, 2, 3. **MINOR:** 4, 5, 6, 7, 8, 9.

## ADJ-P8-46 ruling — audited, **UPHELD**
Contract §4 R6-2's headline is a defect report ("…and can collide"); its closing sentence
"The picker deliberately offers exactly the siblings that collide" states the shape of that
defect. §6 M4's requirement is "fills cannot collide". Read prescriptively the contract would
demand the defect it just reported. Driven support for the ruling as implemented: with the zip
row **unrendered** the external fill is preserved (§6.2 picker lists `[street, pcx]`, the fill
target untouched); with the row rendered the rename is declined and the picker says so.

## Scans
* **Deferral markers on added lines** (`\b(TODO|FIXME|HACK|XXX)\b`, "polish later", "for now",
  `defer(red)? to (v2|later|a follow-up)`, `simplified for (now|v1)`,
  `will be (done|added) later`): **0 hits**.
* **Reduced models, marker-free:** findings 3 and 4 (a rule stated generally, implemented over
  a narrower universe) and finding 1 (a two-sentence split applied to one side of a union).
  Nothing else: no locked options, no placeholder content, no dead controls, and every flow I
  drove was reachable from authored-from-scratch content.
* **Every-consumer proof:** `props.maps.fills` has exactly two readers —
  `runtime/validation.ts:131` (compiled config → fixed by X1's `projectInSection`) and
  `runtime/maps.ts:43-64` (the wire `data-lg-maps` → fixed by H1's `fillsForMapsConfig`); both
  verified. `projectSectionComponents` has 2 callers (`config-dto.ts:754`,
  `sections-handlers.ts:2194`), both on the fixed path; `expandPublicComponents` callers
  (`resolver.ts`, `runtime-routes.ts`, `quotes-handlers.ts`, the migration script) consume field
  universes, not fills. `leadgenAddressAnswerFields` / `leadgenAddressZipAnswerField` / `fieldsOf`
  all gained an OPTIONAL parameter (context-free callers byte-unchanged; verified by the
  measured examples in `presets.ts:3376-3399`, which reproduce exactly). `outputFormatJsonLiteral`
  has 4 call sites, all inside the panel it belongs to. `qrCheckpointLabel` has 1 caller.
  `syncDualRange`'s new `export` did not move the bundle (`verify:leadgen-runtime` byte-identical
  rebuild, 53,124). The one consumer that is NOT converged is finding 3.
* **Security:** the changed `src` files (excluding the generated bundle) add no SQL, no
  `innerHTML`/`outerHTML`/`eval`/`new Function`, no `new RegExp` on external input, no new
  route and no authz surface. Every new operator string reaches the DOM through `showMsg`
  (`el.textContent = text`) or `showInlineErr` (`createTextNode`). `drainFlash` reads
  sessionStorage and validates the slot id against a 2-item allowlist before painting;
  same-origin only, textContent only. `api/.dev.vars`'s two `GOOGLE_MAPS_*` values remain empty.
* **Silent failures:** the N8 sweep is the opposite — six fire-and-forget writes now read
  `r.ok`, carry `.catch` and re-enable their button; driven on create-A/B and deactivate. One
  residual shape: `flashAfterReload` parks the message **before** `window.location.reload()`,
  and the island's own `beforeunload` guard can cancel that reload when the editor is dirty —
  the parked line then paints on the next unrelated editor load in that tab. Not driven
  (needs a dirty editor + a cancelled dialog); recorded at that strength.

## Already-surfaced rows re-confirmed (not re-filed)
ADJ-P8-41 (activation is quote-wide — re-confirmed by driving: after N8's Deactivate,
re-activation returned `quote_activation_blocked` on *"Funnel 'P8-Charlie' needs at least one
page with a section."*), ADJ-P8-12 (a funnel's last page cannot be removed: both `{pages:[]}`
and `{sections:[]}` are refused), ADJ-P8-46 (upheld, above), ADJ-P8-47/47b, ADJ-P8-48,
ADJ-P8-49, ADJ-P8-29 (Studio inspector unreadable at 375 — the new fills-option sentence is
clipped there too, but the panel clipping is pre-existing and the key phrase is still legible).

## Fixture disclosure (mine, not a product finding)
Driving N8's Deactivate flipped `enabled = 0` for `st_cad9f863eb2444a1`; re-activation was
refused quote-wide (ADJ-P8-41), so I gave funnel **P8-Charlie** one page/section to re-activate
the site, and neither `PUT {pages:[]}` nor `PUT {sections:[]}` can take it back (ADJ-P8-12).
**P8-Charlie now has 1 section where it had 0.** `/lg/r2fix` serves 200 again. Both probe
sections restored byte-identical; two archived probe quotes named `p8n_cr_* Review Quote`
remain, plus two throwaway routing rules that were deleted (200 each).
