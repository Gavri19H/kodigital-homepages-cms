# P8-6 merge gate — T1/T2 scoped re-review — **SHIP**

Fresh-context Opus 5 reviewer. Branch `leadgen-r2-p8-5` @ `e722dc89`; `git show --stat e722dc89`
= 1 file / 3,052 insertions (the gate log only) ⇒ product code is `b5fd713b`. Working tree
**porcelain-clean** at review start. Drove the already-running `:8901` instance as a client
(started/stopped nothing, never bound 8787). Authored two sections from scratch through the real
`POST /api/admin/leadgen/sections` with keys unique to this session (`p8n_ship_*`), plus my own
quote through `POST /api/admin/leadgen/quotes`. All deleted at the end — **zero residue**.

## Gate-log audit (one line, recomputed, nothing re-run)
`p8-phase-6-run6.log`: stamped `HEAD: b5fd713b…` == product sha ✓ · `[status-empty=yes]` ✓ ·
`TYPECHECK_EXIT=0 / VITEST_EXIT=0 / VERIFY_ALL_EXIT=0 / RUNTIME_EXIT=0 / REGISTER_EXIT=0` ✓ ·
**I re-parsed every `✓|↓ test/<path>.ts (N tests[ | M skipped])` line myself: 499 files / 8,439
tests / 30 skipped ⇒ 8,409 passed**, exactly the summary ✓ · bundle `size: OK (53181 bytes)` +
`freshness: OK (byte-identical rebuild)` at two independent points, 53,248 budget ⇒ 67 free ✓ ·
register TOTAL violations 0 (R2–R5 each 0) ✓ · zero-drift `removed pre-existing: 0`, 11 changed all
additions, `7810 + 629 = 8439` == discovered total ✓ · **p3a: the verdict line is present with NO
raw recapture section** — the identical unbacked line the predecessor filed as its finding 7,
carried forward unfixed (MINOR-5 below).

## Per-clause verdict table

| Clause | What I drove | Measured | Verdict |
|---|---|---|---|
| **T1 — the rail labels derived sub-fields by ROLE** | Authored `p8n_ship_labels` (Address `p8n_ship_home` + `maps.fills.zip → p8n_ship_postal`; NameFieldsGroup `["p8n_ship_na","p8n_ship_nb"]`; dual_range `p8n_ship_band`; two label-less FreeTexts) and `p8n_ship_collide` (Address with `fills.street = fills.city = "p8n_ship_both"`). Read the live `#lg-qr-data` blob and drove the real **+ New rule → + Add condition** picker at 1280 and 375 | All 15 derived keys read the ROLE: `p8n_ship_postal` → **"Where is the property? — ZIP"** (not "P8n ship postal"), `p8n_ship_na/nb` → **"— First"/"— Last"** (not "P8n ship na"), `p8n_ship_band_min/max` → **"— Min"/"— Max"**, address slots → "— Street/City/State". The predecessor's two named leaks are gone | **PERFECT** · `ship-dup-options-1280.png`, `ship-dup-options-375.png` |
| **T1 — rail vs Studio agree on the role word** | Same two sections opened in the real Section Studio; read its own shipped dependency picker | Studio: `Address — Street/City/State/ZIP`, `Name — First/Last`, and for the two-role fill collision **"Address — City"** vs the rail's **"Second address — City"** — the role word is identical on every comparable key, including the collision shape the unit test does NOT cover. T1's "LAST match wins, matching the Studio's own slRoles loop" claim **verified live** | **PERFECT** · `ship-studio-collide-1280.png`, `ship-studio-labels-1280.png` |
| **T1 — the re-founded guard** | Re-ran only the touched file (`npx vitest run test/leadgen-quotes-ui.test.ts`) | **31 passed (31)**. The guard is materially re-founded: opaque keys, no prefix allowlist, `given/family` now asserted to read First/Last, and a `node:vm` oracle slicing the SHIPPED island (`compared === 12` = 4+2+2+4, so a silently-skipped comparison goes red). Both carve-out directions are genuinely falsifiable | **PERFECT** (one residual blind spot → MINOR-2) |
| **The de-collision ruling + its carve-out** | Drove all four of the ruling's factual premises | (1) the rail has **no `(2)`** — driven, two bare "Extra names"; (2) the **Studio has one** — driven, `Name — First (2)`, `Text (2)`; (3) the type name alone **would** collide — `leadgenComponentName("FreeTextQuestion") === "Text"` for both label-less questions; (4) the id **does** disambiguate — `p8n_ship_plain1` / `p8n_ship_plain2` distinct. Every premise TRUE. **The ruling is UPHELD** | **PERFECT as ruled** (cost/benefit note → MINOR-4) |
| **T2 — the corrected comment** | Re-parsed the cited `after-fixedpoint.log` myself (22 rows) and diffed the block | **Exactly one row differs by viewport — F2, 1280=20000 vs 375=5000** — precisely what the correction says, and the old "identical on every row"/"min 5000" was indeed false. `styles.ts` is **comment-only**: 0 non-comment ± lines, verified by diff | **PERFECT** |
| **T2 — the residual-flake disclosure** | Ran the real probe **3 independent times**, F1–F4 × 1280/375 (24 real visitor sessions, 24 real `POST /lg/auction`) | **3/3 clean**: F1 40000/60000, F2 **5000**/60000, F3 20000/90000, F4 20000/70000 — identical at both viewports every run, and exactly the comment's stated landing values (40000 / 5000 / 90000 / 70000). The disclosure is **conservative** (it under-claims determinism); it does not overclaim | **PERFECT** · `ship-s2-fcases-3runs.log`, `ship-visitor-fromto-{1280,375}.png` |

## Findings (listed first, ranked after)

1. **T1's unknown-role branch collapses two sub-fields of ONE question into two byte-identical
   picker options.** `api/src/admin/leadgen/ui-quotes.ts` `derivedSubFieldLabel`:
   `if (role === null || role === "full_address") return parent;`. Driven: a NameFieldsGroup with
   `props.fields: ["p8n_ship_x1".."x4"]` renders **`Answer: p8n_ship_labels · Extra names` twice**
   (`ship-dup-options-1280.png`, rows 11-12). Pre-T1 they read distinctly
   ("Extra names — P8n ship x3"/"— P8n ship x4"). **This is the exact outcome the conductor's own
   ruling calls strictly worse than a raw id** ("two options an operator cannot tell apart"), so the
   two branches of one function now apply opposite policies. **Reachability measured: 0 of 25 live
   sections carry a ≥3-entry NameFieldsGroup, and the Studio has no control that authors
   `props.fields` at all** (its dedicated block authors labels/placeholders/helpers/icons;
   `internalFieldsOf` reads `[0]`/`[1]`). Enabling shape is already **ADJ-P8-54 (b)+(c)**, and
   fixing (b) removes this entirely — but neither row's text covers "one question's two sub-fields",
   and (c) is written as "two same-worded *questions*". **Amend ADJ-P8-54, no code change needed.**
2. **The re-founded guard is still blind to finding 1's axis.** Every new fixture uses a ≤2-entry
   NameFieldsGroup, and the row guard is only `recordableKeysOf(...).length > 0` — it never asserts
   rail-universe == rendered-keys for the new fixtures, so a fixture offering phantom keys passes.
   The guard was widened on the axis that failed and not on the axis the fix's new branch created.
3. **A new in-file claim names a test that does not exist.** `ui-quotes.ts:1092` cites
   `test/leadgen-quotes-ui.test.ts ("the rail's role words ARE the Studio's role words")`; the
   actual title is *"the rail's role word IS the Studio's role word for the same field"* (grep: 0
   hits for the cited string outside the comment). It also calls the pinning "byte-for-byte to the
   island source" when the test is behavioral. The **substance holds** — all six role words are
   exercised by the four oracle shapes — but the sentence is false as written.
4. **The ruling's stated binary is false, and its cost/benefit is inverted against live data.**
   The comment frames the choice as "the id, or two identical options". A third option exists and
   ships in this repo: the Studio's `sectionFieldLabels` counts/seen pass (~10 lines), and
   `quoteRailAnswerFields` already holds the whole list. Measured: keeping the id preserves a §12.4
   raw-id leak on **14 live label-less questions** to prevent a collision that occurs on **0 of 25
   live sections** (no section has two label-less same-type questions). The ruling is still the
   right *merge* call; the reasoning sentence overstates the constraint. Tracked by ADJ-P8-54(c).
5. **T2's corrected block has no committed evidence of its own, and one clause is self-contradicted.**
   "Re-run directly 5x … (5/5)" and "3 of those 5 runs" cite no artifact — the only cited log is the
   OLD run the comment correctly says contradicts the OLD claim. (My 3 independent runs corroborate
   every stated number, and this review's `ship-s2-fcases-3runs.log` now backs them.) Separately,
   "**never the same one twice**" (`styles.ts:1164`, repeated at `probe-s2-fixedpoint.mjs:19`) is
   contradicted by the conductor's own commit body, which lists the three flaky rows as
   "**(F3, F1, F3)**" — F3 twice.
6. **Gate-log completeness, carried forward.** `run6.log:3052` asserts "p3a recapture: 0 real diff
   lines across all 11 fixtures" with no raw section — the same unbacked line the predecessor filed
   for run5. The tree IS porcelain-clean now (the run5 dirty-fixture half is resolved) and all four
   p3a suites pass in the run, so the claim is consistent; it is still the only unbacked line.
7. **Informational, pre-existing text T2 did not touch:** the block's "hMin.cx, x=477 at 1280 and
   x=29 at 375" is true only for the min-at-0 rows — the cited log itself carries two distinct press
   points per viewport (477 **and 542.2**; 29 **and 92.4**), because hMin.cx moves with the min.
   The invariant the sentence exists to state (always hMin.cx, never cx-7) is true.

## Scans
* **Deferral markers on added lines** across the whole wave (`616c4bc0~1..b5fd713b`, `api/`):
  **0 hits** for `\b(TODO|FIXME|HACK|XXX)\b`, "polish later", "for now", `defer(red)? to
  (v2|later|a follow-up)`, `simplified for (now|v1)`, `will be (done|added) later`, plus "later
  slice"/"out of scope"/"not implemented"/"stub".
* **Reduced models, marker-free:** finding 1 (a label degraded to a non-identifying string when a
  disambiguator was available); the ruled label-less id fallback (a §12.4 reduction, now
  test-pinned, owner-registered); `DERIVED_ROLE_WORDS` is a 6-word copy of the Studio's literals
  rather than a shared module — the seam is argued in-file and pinned behaviorally by the oracle, so
  it cannot drift silently. **Nothing else:** no locked options, no dead controls (I drove the
  picker and the rule editor end-to-end), no placeholder content, no seed-only paths — every field I
  judged came from content I authored this session.
* **Every-consumer:** `derivedFieldRole` / `addressRoleKey` / `DERIVED_ROLE_WORDS` are
  module-private to `ui-quotes.ts`; `derivedSubFieldLabel`'s new 4th param has exactly **one** call
  site (`sectionAnswerFieldEntries`); `leadgenAddressAnswerFields` and `LEADGEN_ADDRESS_FIELD_KINDS`
  gain a consumer and change no signature; the `foreign` hoist passes the identical set the inline
  call built. No exported interface changed. Typecheck 0, `verify:all` 0, bundle byte-identical.
* **Security:** no SQL, no new route, no authz surface, no secrets, no `innerHTML`/`eval`/
  `new Function`, no `new RegExp` on external input. The new labels reach the DOM through the same
  `JSON.stringify(...).replace(/</g,"\\u003c")` rail blob as before. Test-only `node:vm
  runInNewContext` executes a SHIPPED constant, not external input; `sliceIslandFn` is
  indexOf/brace-counting, no regex ⇒ no ReDoS.
* **Silent failures:** none new. The `role === null` degradation is quiet (finding 1) but the
  affected rows still carry the honest "This rule can never apply before a visitor enters a funnel
  that asks these questions." warning — driven, visible in `ship-rail-picker-1280.png`.

## Ranking
**BLOCKER: none. MAJOR: none.** **MINOR: 1, 2, 3, 4, 5, 6, 7.**
Findings 1, 2 and 4 are **owner-row amendments to ADJ-P8-54** (not re-filed, not new rows).
Findings 3, 5, 6, 7 are documentation accuracy. No product code change is required to merge.

## Fixture disclosure (mine, not a product finding)
Authored and **fully removed**: sections `p8n_ship_labels` (`lgs_01KZ9C8K25F8J2EG68BFN5468D`) and
`p8n_ship_collide` (`lgs_01KZ9C9B8S442HG2816Y4EAGB4`), both `DELETE` 200 `"deleted":"hard"`; quote
`p8n_ship Label Quote` (`lgq_01KZ9C9PF9FQ5WPB8CW1NMYY2Z`), `DELETE` 200. A post-drive scan of all
sections returns **zero `p8n_ship` rows**. I saved no routing rule and mutated no existing quote,
section, funnel, theme or activation. I posted 24 real `POST /lg/auction` bodies against the
untouched `r2fix` fixture funnel (visitor traffic rows only). P8-Charlie untouched by me; its
pre-existing 1-section + 2-undeletable-section residue is disclosed, not chased.
