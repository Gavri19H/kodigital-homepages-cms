# P8-4+P8-5+P8-6 Q-wave scoped re-review — **FIX-FIRST**

Fresh-context Opus 5 reviewer. Drove the already-running `:8901` instance as a CLIENT (started
and stopped nothing, never bound 8787). Authored my own content from scratch through the real
`POST /sections`, `POST /quotes`, `PATCH /funnels/:id`, `PUT /variants/:id`,
`PUT /quotes/:id/shared-page`, `POST /quotes/:id/routing-rules`,
`PUT|DELETE /quotes/:id/activation/:site_id`, `PATCH /themes/:id` and the real visitor funnel to
`POST /lg/auction`, with keys unique to this session (`p8n_rr2*`).

Branch HEAD `79b9195c`; `git show --stat 79b9195c` = **1 file, 6,326 insertions** (the gate log
only) → product code is `d866b4e1` (= `3029eb49` + the p3a recapture). Tree porcelain-clean.

## Gate-log audit (one line, recomputed, nothing re-run)
`gate-logs/p8-phase-6-run3.log` run 4 (line 3261 →): stamped `HEAD: d866b4e1…` == the product sha ✓ ·
`[status-empty=yes]` ✓ · five exits present and 0 · **I re-parsed every `test/<path>.ts (N tests[ | M
skipped])` line in the run-4 block myself: 499 files, 8,424 tests, 30 skipped ⇒ 8,394 passed** —
exactly the summary; bundle **53,141 of 53,248 = 107 free** (`LEADGEN_RUNTIME_JS_BYTES = 53141` in
the generated file, verified by my own hand) ✓ · register **97 rows / 0 violations** (re-ran
`check_register.py` myself: same) ✓ · zero-drift per-file deltas `43+12+12+11+9+5+4+4+3+1 = +104`
reconciles `7692 → 7796`, and `7796 + 628 = 8424` ✓ · run 3's 8 reds are exactly 2 legacy-pin,
2 p3a, **2 literal `Test timed out in 5000ms.`** (not assertion failures — verified at log
lines 3163/3176) and 2 CSS-pin assertion diffs whose only delta is the one new clip rule.
**p3a claim independently recomputed:** applying the suite's own three normalisers to the five
touched fixtures gives `editor-full +22/-6` and `editor-panel-builder +1/-1` = **30 real lines,
the other three fixtures 0** — exactly the commit's "2 + 28, zero unexplained". **No arithmetic
problem in the log.**

## Per-clause verdict table

| Item | What I drove | Measured | Verdict |
|---|---|---|---|
| **MAJOR-1** — A-4 scope taken from the surface that HOLDS the section, 5 sites | Authored `p8n_rr2_p0vucd Alpha/Bravo` + a quote + `p8n_rr2_p0vucd Funnel One`; drove all five sites through the real routes | (1) shared self-repeat → *"…Alpha' is already on the Shared first page…"*; (2) shared∪funnel → **"'…Bravo' is already in the funnel 'p8n_rr2_p0vucd Funnel One'…"**; (3) variant-save `sections[]` and (3b) `pages[].slots[]` → *"…is already on the Shared first page…"*; (4) variant internal repeat → *"…is already in this funnel…"*; (5) activation preflight (funnel → draft, save both, funnel → active, `GET /activation`) → **"'…Bravo' is on the Shared first page and in the funnel 'p8n_rr2_p0vucd Funnel One'…"**. Zero wrong-surface sentences | **PERFECT** |
| **MAJOR-2** — N8's `st_` id off the money path | Real `DELETE /quotes/:id/activation/st_cad9f863eb2444a1` via the real **Deactivate** button on the real Activation tab, at 1280 and 375, then restored | Green banner reads **`Deactivated for R2Fix Fixture Site.`** at both viewports; row label painted `" R2Fix Fixture Site"`; no `st_` anywhere. Restored (`PUT` 200, `/lg/r2fix` 200) | **PERFECT** · `rr2-m2-deactivate-1280.png` (green banner naming the site) |
| **MAJOR-3** — the rail can see a real answer field | Authored `p8n_rr2m3 Collide Addr` (Address `internal_field p8n_rr2m3_addr`, `maps.fills.zip → p8n_rr2m3_pcx`, sibling FreeText answering `p8n_rr2m3_pcx`) + a clean control; read the rail's own `#lg-qr-data` blob, the picker, and three real routing rules | `answer_fields` = `[…_addr, …_pcx, …]` — **`p8n_rr2m3_addr_zip` ABSENT**; `funnels[].pages[].fields` absent too; picker absent. Rule on the real key paints **"In a funnel" + "(removed field) is 94043" + "⚠ This rule can never apply before a visitor enters a funnel that asks these questions."** — verbatim the symptom the FIX-FIRST named | **DEVIATES (finding 1)** · `rr2-m3-rail-1280.png` |
| **MINOR-4** — help derived from the registries | Opened the real rule modal + added a real condition row, 1280 and 375; compared the helper to the two live `<select>`s | Helper: `Sources: answer fields (by name) · UTM Source · UTM Medium · UTM Campaign · UTM Content · Device · OS · State · Hour · Weekday. Operators: is (=) · is not (≠) · greater than (>) · less than (<) · at least (≥) · at most (≤) · between · in list · not in list · is empty · is not empty.` — **11 of 11 operators and 9 of 9 sources, byte-for-byte the picker's own option texts**, at both viewports, no overflow (`scrollWidth 375 == innerWidth 375`) | **PERFECT** · `rr2-rulemodal-375.png` |
| **MINOR-5** — typed `from_to` thumbs / min-drag | Real per-character `40` into "To ($)", blur, then a **real pointer press at the MIN handle's own centre** (`x=477` at 1280, `x=29` at 375 — the same coordinate the pre-fix drive used), then the full walk to `POST /lg/auction` | After typing: box 40, both rails 0, both handle boxes `x=463..491` (one blob), max rail clip resolves to `inset(0px 0px 0px calc(0% + 14px))` = the boundary sits **exactly on the shared handle centre**. Press at 477 → **max 40 → 50000**, and `POST /lg/auction` carries **`"p8n_fromto_band_max":{"value":"50000","answer_source":"user_selected"}`**. Same at 375. Only `x ≤ 476` reaches the min | **DEVIATES (finding 2)** · `rr2-fromto-typed40-375.png`, `rr2-fromto-afterdrag-1280.png` |
| **MINOR-6** — the article | Real `PUT /variants/:id` with a wrong-activity section, both body shapes | *"'G1 B1 after v2' is under the auto Activity, but this quote's Activity is r2fix_activity — pick a section under r2fix_activity, or change the quote's Activity to auto."* Byte-identical at both call sites; no article, no `is a auto` | **PERFECT** |
| **MINOR-7** — ADJ-P8-3 corrected | Read the row at HEAD and diffed it against `bcfde161` | The claim is corrected. But the replacement text contains an **unescaped `|`** (from `(?:from\|to)`) that splits the markdown row into 8 cells instead of 7, and the Status cell is garbled: `DEVIATES(… — no action, no owner **rulingture date**, or accept a daily-flaking parity suite)` | **DEVIATES (finding 4)** |
| **MINOR-9** — sweep bookkeeping | Grepped the whole tree at HEAD for the "9 sites … 8 fixed, 2 cleared" arithmetic | The 2 residual `target_section_id` sites still stand and their clearance evidence holds; **the inconsistent count is nowhere corrected in the repo** — it survives only in the reviewer's own REVIEW.md | **DEVIATES (finding 5, cosmetic)** |
| **raw-key class (Q7/Q8/Q9/Q10)** | Real `PATCH /themes/:id` × 12 bad enums; real `PATCH /sections/:id` palette + continue_mode; the real Themes manager Advanced pane at 1280 and 375; scanned all 865 `<option>`s of the real section-studio SSR | Theme validator: `'Corners' must be Sharp, Rounded or Pill…`, `'Headline font' must be Newsreader, Inter, …`, `'Brand primary' needs a colour…` — no tokens. Advanced pane: **14/14 rows human-labelled, 0 raw keys**, both viewports (closes the slice's own "no screenshot taken" caveat). Studio SSR: 24/865 raw-token option labels, all operator-authored values or numerals. **BUT** `sections.ts:162` still emits **`The palette entry for 'brand_primary' must be …`** — the list was humanised, the subject was not | **DEVIATES (finding 3)** · `rr2-advanced-pane-1280.png` |
| **ADJ-P8-52 residual** | Verified each named site at HEAD | `payload.ts:448,499,888,944`, `payload-builder-handlers.ts:175`, `frames.ts:1896` all still dump raw vocabularies; 6 `options(X, null, …)` in `ui-offers.ts` (row says 9 — see finding 6). Correctly BLOCKED for the owner, not narrowed | **PERFECT as an owner row** (count caveat, finding 6) |
| **the CSS byte pins** | Read all four pin sites + the diff | `leadgen-section-preview-frame.test.ts:1219-1231` strips ONE net-new rule via the file's existing `R2_P4_RANGE_NEW_RULES` idiom; the comparison target, the `toBe`, and `expect(actualPreview["css"]).toBe(funnelChromeCss(...))` are untouched; the rule is interpolated from `R2_P4_RQ.thumbSize` so a drift in either side fails. `legacy-shell.html` / `legacy-variant-preview.json` gain exactly the one rule, nothing else | **PERFECT** |
| **the timeout claim** | Read the raw run-3 output; audited the memoisation and the ledger | Both are literal `Error: Test timed out in 5000ms.` (log 3163, 3176) — zero assertions involved. `styleRule` is now an index keyed by **sheet CONTENT**, first-selector-wins (identical to the old loop's first `return`), same throw on miss, so two different sheets can never alias and the F12 claim-2 reverted-sheet leg gets its own index. Ledger arithmetic recomputed: `12+12+4+5+4+4+5+6+4+3+4+4+4+3+6+6 = 86` over 16 selects, `16 + 2 = 18` — the test asserts all three with `toBe` | **PERFECT** |

## Findings (listed first, ranked after)

1. **MAJOR-3's fix does not reach the surface the finding named — the driven symptom reproduces
   verbatim at HEAD.** Q3 threaded `collectKnownAnswerFields` (`content-schema.ts`), which feeds
   save-time validation, `validateQuestionGridDependencies` and
   `deriveRoutingRuleCheckpointPage` — all three now correct (I drove the last one: a rule on
   `p8n_rr2m3_addr_zip` stores `checkpoint_page: 0`, and on the clean control `1`). But the
   **rules rail** derives its universe from a completely different enumerator:
   `ui-quotes.ts:1030 internalFieldEntriesOf` → `:1057 quoteRailAnswerFields` (the picker +
   `answer_fields`) and `:1099 sectionFieldsByPublicId` → `:1121 funnelPageFieldSets` (the
   per-page sets `deriveRuleCheckpoint` consumes), wired at `:877`/`:919`/`:935`. That
   enumerator reads only `node.internal_field` and `node.children[].internal_field`, so it
   expands **no** Address role, **no** `NameFieldsGroup` first/last and **no** dual/from_to
   `_min`/`_max`. Driven on content I authored: the rail's `answer_fields` blob is
   `["p8n_rr2m3_addr2","p8n_rr2m3_othernote","p8n_rr2m3_addr","p8n_rr2m3_pcx",…]` with no
   `…_addr_zip`; the rule card paints *"In a funnel"*, *"(removed field) is 94043"* and
   *"⚠ This rule can never apply before a visitor enters a funnel that asks these questions."*
   about a field every visitor fills — while the sibling FreeText rule right below it correctly
   reads *"In funnel p8n_rr2m3 M3 Quote — Funnel A — page 1"* and
   *"p8n_rr2m3 Collide Addr · PCX sibling note is 94043"*. The **clean control**
   (`fills.zip → p8n_rr2m3_freezip`, no collision) is broken the same way, so this is not
   collision-specific. It reproduces on the SEED fixture too: the rail's page-0 field set for
   *R2Fix Fixture Quote — Funnel A* is `['p8_addr']` with no `p8_addr_*` role. SSR and island
   agree — both are wrong, so the N4-class "both sites or none" rule is not the escape.
   **INSIDE MAJOR-3 / REQ-R1 / M4.** `rr2-m3-rail-1280.png`, `rr2-m3-picker-1440.png`.
   Related: `quotes-handlers.ts:723-726`'s comment — *"the runtime + the (P3) builder display
   BOTH re-derive with the same pure module … The field universes are built from the SAME
   `collectKnownAnswerFields` expander"* — reads as covering the builder display, which it does
   not.

2. **MINOR-5's fix does not deliver its claim: pressing the visible min handle still destroys a
   typed max, all the way to the buyer payload.** `default-funnel/styles.ts:1127-1129` partitions
   the max rail at `calc(thumb/2 + (--lg-a + --lg-b) * (100% - thumb) / 200)`. When the handles
   coincide (`a == b`, the whole reason the rule exists) that boundary is **the shared handle's
   own centre** — the implementation says so itself (`leadgen-rework-runtime.test.ts`: *"the
   midpoint boundary sits exactly on them and each rail keeps one half of the shared thumb"*).
   Driven at HEAD after typing `40` into "To ($)": press at `handle-centre−7` and `−1` → min
   moves, 40 survives; press at **`handle-centre+0` (x=477, the exact coordinate the pre-fix
   drive used and the natural aim point), `+1`, `+7` → the MAX moves, 40 → 50000**, and the real
   `POST /lg/auction` carries `"p8n_fromto_band_max":{"value":"50000","answer_source":"user_selected"}`.
   Identical at 375. Separated handles (20000/60000) are unaffected — no regression, but no
   delivery either. **The in-file claims are false:** `styles.ts:1124` says *"MEASURED AFTER,
   **same drive**: down at 470 … moves the MIN"* — the "before" measurement at `:1103` presses
   **477**, so the after-drive silently moved the press point by 7px; `styles.ts:1112` and the
   `leadgen-section-preview-frame.test.ts:1005-1017` comment both present the 40→50000 loss as
   past tense. The two new unit tests only pin where `--lg-a`/`--lg-b` are published and
   explicitly state the hit test "is proven by the live drive above" — a live drive that aimed
   somewhere else. **INSIDE MINOR-5 / ADJ-P8-51 / Image11.**
   `rr2-fromto-typed40-375.png`, `rr2-fromto-afterdrag-1280.png`.

3. **Q6 humanised the palette refusal's LIST but not its SUBJECT, and the test it shipped drives
   the one role that cannot expose it.** `src/leadgen/sections.ts:162` emits
   `The palette entry for '${role}' must be a theme colour role (${themeRoleLabelList()}) …`.
   Driven live: `PATCH /sections/:id {design_overrides_json:{palette:{brand_primary:"bogus"}}}` →
   **`The palette entry for 'brand_primary' must be a theme colour role (Brand primary, Brand
   secondary, …)`** — the same sentence names the role twice, once as a storage key and once as
   the operator's word. `themeRoleLabel()` is defined 6 lines above and is not applied to
   `${role}`. The R5 copy check does not catch it because (a) `leadgen-p8-r5-copy.test.ts:494`
   drives `palette: { hotpink: …, accent: "not-a-role" }` — `accent` is the **only** one of the
   14 roles with no underscore, and (b) the widened predicate
   `/\b[a-z]{2,4}_[a-z0-9]{6,}\b/i` (`:100`) matches `card_background`/`text_primary`/
   `page_background` but **not** `brand_primary`, `surface_wash`, `button_primary_bg`,
   `button_primary_text`, `button_secondary_bg`, `brand_secondary` (prefix > 4 chars). So the
   predicate is inconsistent across the very vocabulary it was widened for, and swapping the
   drive's role to `card_background` would turn the suite red today. **INSIDE M5 / REQ-R5.**

4. **The ADJ-P8-3 correction broke its own register row.** `docs/leadgen/r2/P8-REGISTER.md:77`.
   The added text embeds an unescaped `|` (`/(data-analytics-(?:from|to))="[^"]*"/g`), which
   splits the row into 8 pipe-delimited cells where every other row has 7 — the description now
   renders as two columns and the table is ragged for that row. The Status cell is also garbled:
   `DEVIATES(row was stale; hazard already closed by 6bfb05fe — no action, no owner **rulingture
   date**, or accept a daily-flaking parity suite)` — the edit clipped "inject a fixed cap" out
   of the old `BLOCKED(… inject a fixed capture date, or accept …)` and left the tail dangling.
   `check_register.py` is not fooled (it scans every cell for a status pattern rather than
   indexing), so the gate is honestly green — this is a readability/claim-quality defect in a
   conductor-authored artifact, which is the exact class MINOR-7 was about.

5. **MINOR-9's arithmetic is confirmed but nowhere recorded.** The response says "Confirmed; the
   2 cleared sites' evidence holds" — I re-verified the 2 residual sites — but the "9 sites … 8
   fixed, 2 cleared" (= 10) count is not corrected anywhere in the repo at HEAD.

6. **ADJ-P8-52's residual (b) count is off by three.** The row says *"**9** unlabelled
   `options(X, null, …)` dropdowns, all in `admin/leadgen/ui-offers.ts`"*; at HEAD
   `grep -c "options([A-Za-z_]*, *null" src/admin/leadgen/ui-offers.ts` = **6** (of 17 total
   `options(` calls). Residual (a)'s six sites all verified present and correctly described.

## Scans

* **Deferral markers on added lines** (`\b(TODO|FIXME|HACK|XXX)\b`, "polish later", "for now",
  `defer(red)? to (v2|later|a follow-up)`, `simplified for (now|v1)`,
  `will be (done|added) later`, plus "later slice" / "out of scope for"): **0 hits** across all
  2,514 added lines of `api/src`, `api/test` and `docs`.
* **Reduced models, marker-free:** finding 1 (a rule threaded through 3 of 5 universe sites, the
  2 missed ones being the pair the operator actually reads), finding 2 (a partition that reaches
  half a thumb), finding 3 (half a sentence). Nothing else: no locked options, no dead controls,
  no placeholder content; every flow I drove was reachable from content I authored from scratch.
* **Every-consumer proof:** `sectionUniquenessMessages` gained a required `A4Scope` — all 4 call
  sites updated (`:2760`, `:2769`, `:2799`, `:6200`) and I drove all 5 reachable paths.
  `collectKnownAnswerFields`' signature is unchanged (it now wraps
  `knownAnswerFieldsIn(components, collectForeignAnswerKeyLookup(components))`), so its callers
  — `content-schema.ts` Pass 1, `quotes-handlers.ts` preflight + `deriveRoutingRuleCheckpointPage`
  — are source-compatible and two of them driven. `syncDualRange` moved `--lg-a`/`--lg-b` from
  `.lg-range-fill` to the `.lg-range` wrap: the only consumers are
  `default-funnel/styles.ts:1016`, `:1021` (pill transforms, inside the fill → still inherit) and
  `:1128` (the rails, siblings of the fill → now inherit); driven geometry confirms the pills and
  the max handle still track (`hMax x=626` after a drag to 50%), and the `banner-default` pack
  emits no `.lg-range-input-dual` CSS at all (pre-existing, unchanged). The 16 `FRAME_*` symbols
  Q9 dropped from `funnel.ts` appear there only inside the replacement comment (lines 22-25) —
  0 code references, including inside the ES5 island body. `advancedHexRow`'s signature is
  unchanged; `THEME_RECORD_*_TO_TOKEN_ROLE` / `funnelTokenRoleLabel` are new exports with the one
  new consumer driven.
* **Security:** the changed `src` files (excluding the generated bundle) add no SQL, no
  `innerHTML`/`outerHTML`/`eval`/`new Function`/`document.write`, no `new RegExp` on external
  input, no new route and no authz surface. The new island string reaches the DOM only through
  `showMsg` (`funnel.ts:854`, `el.textContent = text`); `siteRowName` reads
  `label.textContent`, never markup. `api/.dev.vars`'s two `GOOGLE_MAPS_*` values remain empty.
* **Silent failures:** none new. `siteRowName(row) || siteId` falls back to the raw id only if a
  row renders no `.lg-check`, which `activation.ts:317` always does — disclosed in the comment.
  The error path is honest: I forced it (`DELETE` 404 on an unactivated site) and the operator
  read the server's own reason. One pre-existing, out-of-class observation: `PATCH /themes/:id`
  with an unrecognised top-level group (`{"buttons":{…}}`) returns 200 and writes nothing.

## Already-surfaced rows re-confirmed (not re-filed)
ADJ-P8-52 (upheld as an owner row; count caveat in finding 6), ADJ-P8-51 (the underlying money
defect is finding 2), ADJ-P8-41 (activation refusal is quote-wide — hit it again on my own quote:
`409` with *"Cannot activate this Quote — fix the blocking issues listed in the Activation
preflight panel."*), ADJ-P8-46/47/47b/48/49/50. Not re-filed and not re-audited: BLOCKER-1, the
payload/facet/ZIP-report/visitor-blocked fixes, N3, N4, N5, N10, N13 — N3 and N4 were incidentally
re-confirmed correct by my rail drive.

## Ranking
**BLOCKER:** none. **MAJOR:** 1, 2, 3. **MINOR:** 4, 5, 6.

## Fixture disclosure (mine, not a product finding)
I drove the real Deactivate button on `st_cad9f863eb2444a1` twice (1280 + 375) and re-activated
via `PUT` each time; final state is `activated=true, enabled=true, slug=r2fix` and `/lg/r2fix`
serves 200 (the route 404s for a few seconds after a re-activation — poll it). **P8-Charlie still
has 1 page / 1 section where it originally had 0** (my predecessor's residue, unchanged by me).
Cleanup: 4 probe quotes archived and deleted where the API allowed; 3 sections
(`p8n_rr2m3 Collide Addr`, `p8n_rr2m3 Clean Addr`, `p8n_rr2_p0vucd Bravo`) could not be deleted
(`409`, still referenced by archived quotes) and remain in the section library; 3 throwaway
routing rules deleted (200 each). `thm_p8-repro` was PATCHed only with keys the handler rejects
or ignores — I re-read it and every stored value is unchanged.
