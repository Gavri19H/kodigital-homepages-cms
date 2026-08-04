# P8-4 fix-round re-review — F9 only — **FIX-FIRST**

Scope: fix round **F9** only (gate sha `25ea7b4`, branch HEAD `053992ac` = the run-5 gate-log
commit; `git diff 25ea7b46 053992ac --stat` touches only
`docs/leadgen/r2/gate-logs/p8-phase-4-run5.log`). F9's own diff is 6 files:
`api/src/public/leadgen/designs/default-funnel/styles.ts`,
`api/src/public/leadgen/designs/frames.ts`, `api/test/leadgen-glossary-lint.test.ts`,
`api/test/leadgen-p8-f9-bare-slot-templates.test.ts`,
`api/test/leadgen-p8-m3-apply-template.test.ts`,
`api/test/leadgen-r2-dead-controls-guard.test.ts`.

Drove the already-running instance on :8901 as a client (never started/stopped/bound it).
28 artifacts at 1280 **and** 375 in this directory. Everything authored was restored and
verified byte-identical (see "Restoration" at the end).

## Per-clause verdict table

| Owner clause / F9 claim | Drive evidence | Verdict |
|---|---|---|
| **F9-1a — the CSS for `section_slot.padding` / `section_slot.transition` is really reverted to pre-F8** (§4 R3) | `j16-visitor-restored-1280.png` / `-375.png` — the restored visitor page paints the white question card again; live sheet probe: `lg-slot-fade` **false**, `lg-frame-slot--pad-` **false**, `lg-frame-slot--bare` **true**, `@media` blocks **1**; `.lg-content` sampled at 60/120/200/400/800 ms = `opacity 1 / animationName none / padding-top 24px` at 1280 and `16px` at 375 — F8's 300 ms uncontrollable load fade is gone | **PERFECT** — `git diff 1d4f1a69^ 25ea7b46 -- styles.ts` is the `--bare` rule + comments only; nothing else of F8's slot CSS survives |
| **F9-1b — the two exemptions are honest: no operator control offers either key** (§4 R3 second branch) | `j5-builder-frame-panel-1280.png`, `j6-templates-tab-1280.png`, `j16-admin-templates-375.png` — live DOM walk of the whole quote editor at **1280 and 375**: `[data-frame-key]` = **28 controls / 18 distinct keys**, `section_slot` matches = **[]** on every one of the six tabs. No built-in `FrameTemplateDef` moves either key (all six saved rows carry `padding:"m"`, `transition:"fade"`); the only `section_slot` mention in the admin plane is the read at `quotes-tabs/templates.ts:2190` | **PERFECT (product)** — the keys are genuinely unauthorable; the guard that is supposed to keep that claim from rotting is where the defect is (**F9-A**, MAJOR) |
| **F9-2 — `--bare` is kept and honoured, and the result is deliberate, not broken** (§4 R3, *"a control that cannot be honoured must not be offered"*) | `j9-header-footer-question-1280/375.png`, `j9-white-trust-question-1280/375.png`, `j9-minimal-question-1280/375.png` vs `j9-centered-card-question-1280/375.png` — drove to the carrier question through the visible `[data-lg-continue]` (4 hops) on all four templates. Bare: card `background rgba(0,0,0,0)`, `border-color rgba(0,0,0,0)`, `border-radius 0px`, `box-shadow none`; card mode: `#fff` / `#E9EDF3` / `16px` / shadow. Layout is pixel-identical apart from the surface (padding `44/46/40` at 1280, `28/20/24` at 375 in **both** modes). Headline↔page contrast **12.2:1**, answer chips keep a white fill + orange border (**16.24:1**), `scrollWidth ≤ innerWidth` at both widths, 0 console errors | **PERFECT** — the bare pages read as deliberately bare, not unstyled; question and answers stay legible. (`ADJ-P8-36` frozen-baseline / `ADJ-P8-37` missing trust bar remain owner-pending, not re-filed) |
| **F9-3 — the prune no longer discards operator values; every chosen value is PRESERVED or NAMED** (M3) | Driven through the real routes on a from-scratch funnel (`RVW4C-8QK2 Prune Probe`) plus the real Quote-Builder Save, and the owner-facing dialog at `j12-apply-dialog-minimal-1280.png`, `j13-apply-dialog-minimal-375.png`, `j13-apply-dialog-agrees-1280/375.png`. Eight scenarios, invariant held in **all** of them (table below) | **PERFECT** |
| **F9-4 — the C6 glossary canary is re-founded and still detects an over-matching lint** (M9 / ADJ-P8-16) | Live scan of the real quote-builder page: visible text (4319 chars) **0** `\bslides?\b` hits, operator-facing attributes **0** hits. The `slider` carve-out is pinned by an explicit `toEqual([])`, and any widening of the scanner lights up `copyHits` over the real served page | **PERFECT (product claim)** — the calibration leg is now a string the test builds itself; acceptable because there is provably no product copy left to anchor on, and the leg that carries the claim uses the real served page with non-emptiness guards (**F9-E**, MINOR) |

### The M3 drive, scenario by scenario (real `POST /funnels/:id/apply-template`, real `PUT …/frame`, column read back from D1)

| # | Scenario (the dispatch's own list) | Result |
|---|---|---|
| C1 | pristine double apply (F-1's original case) | `replaced []` twice; column stays `{version, template}` |
| C2 | operator `header.logo_align=left` on a base that says center → apply a template whose base says **left** (agrees) | **PRESERVED** — column `{version, template:"header-footer", header:{logo_align:"left"}}`, served `left`, `replaced []`, dialog shows **no** customisation sentence (`j13-apply-dialog-agrees-*`) |
| C3 | …then apply a template whose base says center (overrules) | `replaced ["header.logo_align"]` + *"1 setting you had customised is replaced by this template."* — painted in the real dialog at 1280 and 375 |
| C5 | operator value **identical to the OLD base** → apply a template that moves it | `replaced ["header.logo_align"]` + the sentence (F4's value test would have missed this) |
| C6 | leaf set then **reset** | column back to `{version, template}`; next apply `replaced []`, no false sentence |
| C7 | **five applies in a row** with one authored leaf | preserved through the agreeing template, named exactly once when `white-trust` overrules it, silent thereafter |
| C8 | **operator edit between every apply** (`back.label` ×3) | named on every single apply |
| A1–A3 | **array leaf** (`footer.links`) authored by the operator, against a from-scratch saved template that carries a non-empty array | overruled → named + `changes`; identical → preserved in the column and served; a template with a blank list → "silence never erases", `footer.links_source` correctly named |

**The premise the fix rests on is true in the real product, driven:** the Quote Builder's Save
PUTs `{"version":1,"template":"centered","header":{"logo_align":"left"}}` — the stored column
plus exactly the one path the control wrote (`j10-builder-after-save-1280.png`; captured from the
real `PUT /api/admin/leadgen/funnels/lgf_01KZ271383F5X1SQ3DXTXKNJE5/frame` request body after
setting Logo → Alignment → Left in the Templates tab and pressing Save). So `authoredLeaves`'s
"presence is authorship" branch — not the wholesale blind-spot branch — is the one the product
actually takes.

## Gate-log audit (recomputed, nothing re-run)

`docs/leadgen/r2/gate-logs/p8-phase-4-run5.log`

* `HEAD: 25ea7b46c6ae0ec13b4804586c3872b703f287c9` == the gate sha; `[status-empty=yes]` at line 4.
* All five exit codes present and 0: `TYPECHECK_EXIT`, `VITEST_EXIT`, `VERIFY_ALL_EXIT`, `RUNTIME_EXIT`, `REGISTER_EXIT`.
* Recomputed from the raw summary: `Test Files 492 passed | 2 skipped (494)`, `Tests 8252 passed | 30 skipped (8282)`; 8252+30 = 8282 ✓; no `N failed` token anywhere in the vitest summary (the 561 `failed` matches in the log are all `[firehose] Sent N records, 0 failed` stdout).
* bundle `52930 bytes, 99.4%` of the 53,248 cap ✓ · jargon `TOTAL: 0 hit(s)` ✓ · golden `UNCLASSIFIED 0` / stale 0 ✓ · register `rows checked: 81 / TOTAL violations: 0` — independently recounted the register's data rows (93 table lines − 2×6 separators/headers) = **81** ✓.
* **Zero-drift, recomputed my own way** (per-file `test/… (N tests)` lines, run4 vs run5): run4 = 493 files / 8265; run5 = 494 files / 8282. **0 removed**, **1 added** (`leadgen-p8-f9-bare-slot-templates` = 14), **1 changed** (`leadgen-p8-m3-apply-template` 17→20). 8265 + 14 + 3 = **8282** ✓. `leadgen-glossary-lint` 12→12 and `leadgen-r2-dead-controls-guard` 63→63 — both edited by F9 without a count change, i.e. assertions changed in place (audited below). Against baseline `f240788`: `git diff --name-status` shows exactly **23 added `*.test.ts`** ✓, 0 deleted.
* `[R3 sweep] … inline theme_json=34 ThemeRecord=25 frame groups=67 element-F logo props=4 TOTAL=130` — 34+25+67+4 = **130** ✓; `SWEEP_EXEMPTIONS` = 6, exact-set assertion pinned.
* **The zero-drift arithmetic line is still tautological** (unchanged from the prior review's note): `baseline := total − new_file_tests`, so `7729 + 553 = 8282` cannot fail. The per-file removal/change list above it is the part with teeth, and I recomputed that independently.
* No rebaseline: `git diff f240788 25ea7b46 -- api/test-ui/__screenshots__` is **empty**. `api/src/admin/templates/**` byte-unchanged; `api/test/conversions-admin-shell.test.ts` unedited.
* No `wrangler deploy|secret`, no `--remote`, no `npm update|upgrade` in the diff. `api/.dev.vars`: `GOOGLE_MAPS_BROWSER_KEY` length 0, `GOOGLE_MAPS_SERVER_KEY` length 0.
* Deferral scan over F9's added lines (`\b(TODO|FIXME|HACK|XXX)\b`, "polish later", "for now", `defer(red)? to (v2|later|a follow-up)`, `simplified for (now|v1)`, `will be (done|added) later`): **0 hits**.
* Git-guardrail slip: F9's self-reported single read-only `git status --porcelain` leaves no artefact I can audit; the branch history `b7ce4db0 → 25ea7b46 → 053992ac` is linear with no amend/rebase/reset trace and the F9 commit touches exactly the 6 declared files.

### Test-pin audit (F9's four edited/added specs)

| Pin | Change | Weaker? |
|---|---|---|
| `dead-controls-guard` — SWEEP_EXEMPTIONS | +2 entries, exact-set assertion updated, +2 new measurement assertions. No assertion removed | No in coverage — but the new measurement is near-vacuous (**F9-A**) |
| `m3-apply-template` | +3 real-route legs (agreeing apply preserves, differs-from-every-base, "an apply never writes a leaf of its own"). Nothing removed | No — strictly stronger |
| `f9-bare-slot-templates` (new, 14) | Template set read from the real `FRAME_TEMPLATES`; config from real `effectiveFrame`; markup from real `renderQuoteFrame` + `renderSectionComponents`; sheet from real `funnelChromeCss`. Both directions (3 bare + 3 card) at desktop and mobile, each property asserted to be won **by the `--bare` selector** | New floor, not tautological |
| `glossary-lint` C6 | Replaces `hits.length > 0` over raw bytes (which was anchored on an identifier + a dead CSS class) with (1) three scanner assertions over strings the test builds and (2) a real-page claim over visible text + operator attributes + comment-stripped island literals, with four non-emptiness guards | Coverage stronger; calibration moved from real bytes to synthetic (**F9-E**) |

## FINDINGS — all listed, then ranked

### MAJOR

**F9-A — the assertion F9 added so the two new exemptions "cannot rot" does not see the shape
16 of the 18 real frame controls use, and its own "this is a measurement, not a broken regex"
calibration is satisfied by non-keys.**
Register row: §4 R3 / the M2 sweep row (`SWEEP_EXEMPTIONS`, the artifact that certifies both new
exemptions). File: `api/test/leadgen-r2-dead-controls-guard.test.ts:1595-1610`, and the reasons it
backs at `:1341` and `:1347`.

The added code scans `ADMIN_UI_SOURCES` for the **literal** attribute
`data-frame-key="…"`. Executed with the test's own file set (16 files), that regex returns
**9 matches**, and they are:

* `${escapeHtml(key)}` × 5 — the *un-interpolated template-literal source* of the generic helpers
  `frameCheck` / `frameSelect` / `frameInput` (`quotes-tabs/shared.ts:1115,1120,1125`) and the
  segmented/switch builders (`quotes-tabs/templates.ts:743,760`). These are not keys at all;
* `progress.style` × 2 (`templates.ts:716,725`) — the only genuine literal control emissions;
* `progress.style` × 1 and `progress.icon` × 1 (`templates.ts:1955,2009`) — **island
  `querySelector` strings**, not controls.

So `expect(anyFrameControls.length).toBeGreaterThan(5)` — the guard whose stated job is to prove
"the empty result above is a measurement and not a broken regex" — passes **only because the five
`${escapeHtml(key)}` placeholders are counted**. Drop them and the corpus is 4, below the
threshold. This test file elsewhere rejects "an identifier and a stylesheet name" as invalid
calibration evidence; raw template-literal syntax is a weaker anchor than either.

And the comment's factual claim — *"the claim is re-measured HERE, at the shape the frame panels
really use"* — is measurably false. Driven live at 1280 and 375, the quote editor renders **28
`[data-frame-key]` controls over 18 distinct keys**; only **2 of those 18** (`progress.style`,
`progress.icon`) are emitted as literal attributes. The other 16 (`header.logo_align`,
`header.logo_size`, `header.logo_source`, `background.style`, `background.image_media_id`,
`footer.enabled`, `footer.link_underline`, `footer.link_separator`,
`footer.typography_scope.font_family`, `footer.typography_scope.size`, `progress.align`,
`progress.position`, `progress.show_label`, `progress.thickness`, `progress.width`,
`progress.icon_media_id`) go through the helpers and are invisible to this scan.

Concrete failure scenario: a later round adds `frameSelect("Slot padding", "section_slot.padding",
FRAME_SLOT_PADDINGS)` to the Templates-tab slot panel. At runtime the page emits
`data-frame-key="section_slot.padding"` — a live operator control for a key that paints nothing,
i.e. exactly the dead control §4 R3 forbids. `sectionSlotControls` stays `[]` and this assertion
stays green, contradicting the exemption's own written promise (*"any
`data-frame-key="section_slot.padding"` control (the assertion below then goes red)"*).

Mitigating (stated so the fix can be scoped tightly, **not** a reason to soften): the
pre-existing per-exemption check `offeredIn(e.key)` at `:1579-1583` **would** catch that call site,
because the source carries the quoted path `"section_slot.padding"`. The exemption therefore
remains falsifiable in practice; what is broken is the new mechanism F9 introduced specifically to
prove it, plus the two claims written around it. Evidence: `j5-builder-frame-panel-1280.png`,
`j16-admin-templates-375.png` (18 distinct live keys, 0 `section_slot`) against the 9-match source
scan reproduced above.

### MINOR

**F9-B — an exemption reason states an executable grep that does not hold when executed.**
Both new reasons cite *"`grep -rn 'data-frame-key="section_slot' src` returns 0 hits"*
(`leadgen-r2-dead-controls-guard.test.ts:1341,1347`, echoed at
`designs/default-funnel/styles.ts:2661`). Run verbatim at HEAD it returns **1 hit** — the F9
comment in `styles.ts:2661` that makes the claim. Self-referential, and the substance is true
(I drove it: 0 controls), but a reason whose whole value is falsifiability should quote a command
that reproduces.

**F9-C — `frame-handlers.ts:676-679` now under-describes what the write does.**
It still reads *"computeTemplateApply now materialises the template's leaves over the funnel's
config and then PRUNES every leaf the template's own base already gives"*. After F9 that is false:
an operator-authored leaf the apply does not move is deliberately kept. F9 self-reported this;
confirmed. Documentation only — the code is right.

**F9-D — `frames.ts:2181-2186` still asserts the opposite of what the product does, on the exact
premise F9's design rests on.** It reads *"the Quote Builder PUTs its WHOLE hydrated frame back on
every Save (quotes-tabs/funnel.ts:1675 over hydrationBase()), so the funnel column is a COMPLETE
config the moment a funnel has ever been saved"*. Driven at HEAD (`j10-builder-after-save-1280.png`):
the real Save PUTs `{"version":1,"template":"centered","header":{"logo_align":"left"}}`. Two
comments in the same repository now contradict each other about whether the column is wholesale —
and the F9 note 60 lines above depends on the sparse answer being the true one. `hydrationBase()`
is confirmed to feed only `clientEffective()` (control population), never the PUT. Documentation
only, but load-bearing for the safety argument.

**F9-E — the C6 scanner calibration is now a string the test builds itself.**
`leadgen-glossary-lint.test.ts` calibrates `c6SlideScanner()` against
`"affects every slide and every component default"` and `"Progress counts the slides of this
funnel"` — both hand-built. F9 argues, and I confirmed by driving, that no operator copy
containing "slide" survives on that page (0 visible-text and 0 attribute hits over 4319 chars), so
there is nothing real left to anchor on; and the leg that carries the *product* claim does use the
real served page with four non-emptiness guards, so E11's "one real side" holds where it matters.
Accepted as the best available shape — recorded because it is weaker in kind than a real-copy
anchor and should not be treated as a precedent.

**F9-F — the `keep` veto re-introduces one leaf of funnel-column-over-variant-template
shadowing.** `resolveEffectiveFrameOnly` (`resolver.ts:1882-1887`) layers the funnel's
`frame_config_json` **above** `saved_template_defaults`, which itself resolves
`variant.frame_template_id ?? funnel.frame_template_id`. A leaf F9 now preserves in the funnel
column therefore cannot be moved by an A/B arm's own template. This is the deliberate price of not
destroying the operator's value (F9 states it as "one leaf, not a shadow of the whole template"),
F-2's committed leg still passes, and the prior review's A/B drive still holds — but it is a
behaviour change nothing in the register records. **Source-verified only; not driven end-to-end in
this review.** Recommend a register/ADJ note for the owner rather than a code change.

### Environment note (not a finding against F9)

The local D1 still carries `RVW82 Board 1785752227` (quote 2, 6 funnels) and the archived
`RV2B NULLFRAME probe` (quote 3) from earlier review sessions that reported full restoration.
Unrelated to F9; flagged only so the next drive is not judged against them.

## Restoration

Authored during this review, all through the product's own routes, all removed:
section 2's headline (`RVW4C-8QK2 Which carrier do you want a quote from?` → restored verbatim
via the section editor UI); funnel `RVW4C-8QK2 Prune Probe` (deleted); saved template
`RVW4C-8QK2 Array Template` (deleted); Funnel A's template pointer and column (unlinked + reset
to `{}`); the builder-authored `header.logo_align` (gone with the reset).
`leadgen_funnels` and `leadgen_frame_templates` both diff **IDENTICAL** against the pre-review
snapshots; row counts back to 12 funnels / 6 templates / 13 variants.
Residue that cannot be un-done: variant 1's monotonic `content_version` moved 1234 → 1245 (the
apply route's cache-busting bump). `git status --porcelain` shows only this evidence directory.

## Verdict

**FIX-FIRST** — every owner clause in F9's scope drives PERFECT, but **F9-A** is a MAJOR:
the guard F9 introduced so the two new exemptions "cannot rot" does not see the control shape
16 of the 18 real frame controls use, and the assertion that is supposed to prove it isn't a
broken regex is satisfied by five occurrences of the literal string `${escapeHtml(key)}`.
