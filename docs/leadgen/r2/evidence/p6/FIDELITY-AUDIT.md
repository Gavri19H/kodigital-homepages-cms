# P6 · F3 FIDELITY AUDIT — the two-way map between the owner's sentences and the proofs

Read-only documentary audit, 2026-07-30, branch `leadgen-r2-p6`. Nothing was re-driven and no suite
was re-run: this walks `docs/leadgen/source-of-truth/SOURCE-OF-TRUTH.md` clause by clause, matches
every imperative to its register row(s) in `docs/leadgen/source-of-truth/traceability.md`, and
verifies each cited artifact EXISTS on disk under `docs/leadgen/r2/evidence/` and is of the claimed
kind. Then it walks the acceptance artifacts the program added and names the sentence each serves.

## 1 · Verdict

**No — 4 owner imperatives have no real proof and 36 more are not closed by the register they are
mapped to (58 of 98 are SOUND).** The engineering is in far better shape than the bookkeeping: the substantive gaps are
few (4), but **21 owner-sentence rows — every #11C funnel-builder sentence and 4 of the 6 #11D
templates sentences — still carry P2-era `INCONCLUSIVE(step: P2 re-drive)` or `DEVIATES` statuses
even though P2 merged on 2026-07-29 (743d0c7)**, so at the terminal phase the register does not
assert that the owner's largest single clause is satisfied. Ranked list in §4.

## 2 · Table A — every owner sentence → its proof

Judgement key: **SOUND** = the cited artifact is a driven product artifact that demonstrates *that*
sentence · **WEAK** = a row exists but its evidence is thinner than its claim, uncited, single-plane,
or the row itself is not closed · **MISSING** = no row, or a row with no artifact.

Artifact paths are relative to `docs/leadgen/r2/evidence/`. `SoT/images` = `docs/leadgen/source-of-truth/images/`.

### A.1 #1 — "Question grid"

| # | Owner sentence (quoted) | Row | Status | Artifact | Judgement |
|---|---|---|---|---|---|
| I-01 | "Each one of this questions is answering **another field** for the offers payload" | SRC-1a | PASS | `p1/review/vg-poor-1280-04-q5-answered.png` + the provider-log row (5 distinct fields from one unit) | SOUND — driven visitor, payload read back |
| I-02 | "providing us another input on the user for the **analytics**" | — | — | — | **MISSING** — no row; no artifact anywhere shows a grid child's answer reaching the analytics plane (`leadgen_analytics_answer_distribution`). Contract §2 item 2 names "offers/analytics/routing"; offers and routing are proven, analytics is not. `analytics_id` appears only as fixture data in the grid tests |
| I-03 | "help us to decide the user jurney (the funnel) by the funnel rule (homeowner=yes -> funnel x…)" | SRC-11C-R (grid leg), ADJ-R2 | INCONCLUSIVE / PASS | `p1/review/a11-quote-board-rules-rail-1600.png`; two-arm drive w/ `matched_rule_hash` | WEAK — the drive is real and strong, but the owning row SRC-11C-R is still INCONCLUSIVE |
| I-04 | "you can't treat the whole component as one unit … labled as one unit, measured as one unit and routing the user as one unit" | SRC-1a | PASS | `p1/review/a1-container-inserted-1600.png` | SOUND |
| I-05 | "Each question in the component is independent field, with independent answers" | SRC-1a, SRC-2b | PASS | `p1/review/vg-poor-1280-04-q5-answered.png` | SOUND |
| I-06 | "inefendent **defaults!!** (right now only the first question has option for default)" | SRC-1b | PASS | `p1/review/a2-a3-live-default-1600.png`, `refix-b2-1280-03-after-continue-untouched.png` | SOUND — authored default becomes the answer, driven |
| I-07 | "if the user wants to deviate from the theme - independent style" | SRC-1c | PASS | `p1/review/refix-d4-hex-control-1600.png`, `refix-d4-hex-render-1280.png`/`-375.png`, `v-d4-deviation-closeup-1280.png` | SOUND — free hex on Q1 only, both viewports |
| I-08 | "and independent **rules**!" | SRC-1d | PASS | `p1/review/a3-dependency-editor-1600.png`, `a4-nonboolean-dependency-1600.png`, `refix-new-rename-live.png` | SOUND |
| I-09 | "why did you kept the main 'Helper text'?" | SRC-1e | PASS | `p1/review/a6-grid-editor-full-1600.png` (whole-page text scan → []) | SOUND |
| I-10 | "why you kept main 'Answer format'?" | SRC-1e | PASS | same | SOUND |
| I-11 | "what is it 'sub questions'????" | SRC-1e | PASS | same | SOUND |
| I-12 | "there is no 'Main question'!!! where did I define 'Main question'?????" | SRC-1e | PASS | same | SOUND |
| I-13 | "the '+Add a question' button, **for all the components**, should be small, **out of the component** and not to affect the componenent size/ structure!!!" | SRC-1f (grid) + SRC-3 (roster) | PASS / PASS | `p1/review/recon-after-insert-1280.png` (ghost w=120 vs grid 506, sibling, 506→506) | WEAK — the grid half is SOUND and measured; the "for all the components" half rests on SRC-3, whose own PASS text says "the FULL roster re-verification remains scheduled at P6" (see I-21) |

### A.1 #2 — the reference company (Image2/Image3)

| # | Owner sentence | Row | Status | Artifact | Judgement |
|---|---|---|---|---|---|
| I-14 | "the question is marked/checked and only being tracked after the user is clicking 'continue'" | SRC-2a | PASS | `p1/review/vg-poor-1280-06-before-continue.png`, `-07-after-continue.png` | SOUND — no click advanced; auction POSTed only on Continue |
| I-15 | "if the user is overiding the default, the user answer is the one that is being saved" | SRC-2a | PASS | same + payload row | SOUND |
| I-16 | "the 'credit score' question is a dropdown element - the user shuold be able to choose the wanted element per question" | SRC-2b | PASS | `p1/review/vg-poor-1280-04-q5-answered.png` (YesNo+Dropdown+Dropdown+YesNo+Buttons; 17 types offered) | SOUND |
| I-17 | "the user should be able to manage inner dippendancies between of questions inside the component" (+ A.4 "HOW DO I SET DROPDOWN???") | SRC-1d | PASS | `p1/review/a3-dependency-editor-1600.png` | SOUND — the AUTHORING path, in question terms |
| I-18 | "we defined that question, independently, as required, so the user can't click continue unless he answers this quesion" | SRC-2c (requirement text omits this leg) | PASS | no artifact isolates required-and-unanswered → blocked | **WEAK** — the only record is the pre-R2 baseline probe ("required-when-shown" PERFECT, `LEADGEN-R2-PROBE-VERDICTS.md:` clause 1 live dependent-dropdown). No R2 driven artifact shows Continue blocked on an unanswered required dependent question |
| I-19 | "if we set a 'default' and the user didn't change it - this is his answer and the 'required' rule is met" | SRC-2c | PASS | `p1/review/refix-b2-1280-03-after-continue-untouched.png` (+375 twin) | SOUND |
| I-20 | "if the user clicked 'no' … we need to ignore this question- it isn't relevant, so it doesn't exist and the answer is not required" | SRC-2c, ADJ-A1 | PASS | `p1/review/vg-no-1280-02-no-q2-hidden.png`, `refix-b3-1280-02-no-hidden.png` + provider-log row OMITS the field | SOUND — all three legs (hidden, not required, not billed) |

### A.1 #3 — "applied on all the components"

| # | Owner sentence | Row | Status | Artifact | Judgement |
|---|---|---|---|---|---|
| I-21 | "The logical flow I described above should be applied on all the components, you are not allowed to take care only in this component and ignore the rest" | SRC-3 | **PASS** | `p1/review/recon-after-insert-1280.png` — 1 grid "+ Add a question" + 3 "+ Add choice" ghosts | **WEAK ×2.** (a) The row is PASS while its own status text says "the FULL roster re-verification remains scheduled at P6" — a PASS ahead of its own named proof. The contract enumerates ~20 roster entries (8 repeatable + the Other-values editor + 11 non-repeatable, `LEADGEN-R2-FIX-CONTRACT.md:217-234`); 4 are evidenced. (b) The owner's sentence is "the logical flow I described above" — the whole of #1/#2 semantics — and the Requirement column narrows it to "add-affordance outside-rule". No row carries the wider reading |

### A.1 #4 — Image4

| # | Owner sentence | Row | Status | Artifact | Judgement |
|---|---|---|---|---|---|
| I-22 | "the √ inside the button for the chosen answer" | SRC-4 | PASS | `p1/review/vg-poor-1280-04-q5-answered.png`, `vg-poor-375-04-q5-answered.png`, `vg-poor-1280-04b-checkmark-closeup.png` | SOUND — in-grid, both viewports, contrast nit lifted |

### A.1 #5 — phone format

| # | Owner sentence | Row | Status | Artifact | Judgement |
|---|---|---|---|---|---|
| I-23 | "we need to define by ourselves what is a valid format … if the user define it this way - (2)-4-1 so the format is (__)-____-_" | SRC-5 | PASS | `p5/review/revF-phone-partial-1280.png`, `revF-phone-blocked-375.png`, `revF-phone-complete-1280.png` — all the **(3)-3-4** default | **WEAK (citation)** — the second, operator-defined mask the owner names is nowhere in SRC-5's citation. Artifacts for a second mask DO exist and are uncited: `p0/sweep-a/4b-phone-mask-b-fill-1280.png`/`-375.png`, `p0/review/spot-4b-mask-b-1280.png`/`-375.png`; the baseline probe rated `(2) 4-1` → `(__) ____-_` PERFECT. Fix = cite them |
| I-24 | "you took it litteraly and added 'Israel' as an option, just ridiculous" | — | — | — | **MISSING** — no row demands the country option's removal, and `api/src/public/leadgen/components/content-schema.ts:311` + `api/src/public/leadgen/config-dto.ts:300` still ship an `il` ("Israeli national") phone-format preset with its own message. Whether that is the same control the owner saw is unverified; the point is nothing in the register asked or answered |
| I-25 | "even more ridiculous is the fact that the 'costume' answer isn't functional" | SRC-5 (folded) | PASS | as I-23 | WEAK — the custom-format path is the same uncited leg as I-23 |
| I-26 | "when the user is filling the field with numbers, it automatically filling the numbers into the format" | SRC-5 | PASS | `p5/review/revF-phone-partial-1280.png` (`(201)-555-____` mid-entry) | SOUND |
| I-27 | "if the user is inserting less numbers … the 'continue' button will be blocked" | SRC-5 | PASS | `p5/review/revF-phone-blocked-375.png` ("Enter a complete phone number.") | SOUND |
| I-28 | "leave aside the international option right now" | — (negative) | — | satisfied by omission | SOUND — nothing built for it |

### A.1 #6 — the address

| # | Owner sentence | Row | Status | Artifact | Judgement |
|---|---|---|---|---|---|
| I-29 | "if I want it as a free text without validations or auto fill?" | SRC-6 | PASS | `p5/rereview/rr5-g1-freetext-1280.png`/`-375.png` | SOUND |
| I-30 | "if I want only street address?" | SRC-6 | PASS | `p5/rereview/rr5-g2-street-only-1280.png`/`-375.png` | SOUND |
| I-31 | "auto fill only for street address and city and … the user will insert the Zip by himself but to validate the Zip in a 5 digits zip validation?" | SRC-6, ADJ-A2 | PASS | `p5/rereview/rr5-g3-badzip-1280.png`, `rr5-g3-goodzip-cleared-1280.png`; `p5/review/revA-s3-badzip-1280.png`/`-375.png` | SOUND — visible message + block + clear-and-advance |
| I-32 | "the mapping of what is auto-filled per field should definatly be an option" | SRC-6, ADJ-A9, ADJ-N-tail | PASS | `p5/review/revC-log.txt` (per-field Mode; keyless collapse to Manual) | SOUND (thin) — carried by a log, not a screenshot of the per-field Mode control; the log is the right KIND for a config claim |
| I-33 | "Look at the screenshot! **I didn't even checked the 'Maps' feature!!!!**" | SRC-6 scenario (a), ADJ-A9 PASS, ADJ-N28 | PASS + INCONCLUSIVE(owner eye) | `p5/rereview/rr5-g1-freetext-1280.png`; `SoT/images/Image8.png` beside `p5/review/revA-s4-d3composite-1280.png` | SOUND — an unchecked-Maps address renders ONE plain box, no forced autocomplete; the residual reading of Image8 is surfaced to the owner (ADJ-N28), not silently chosen |
| I-34 | "every component that include more than one field- each field is potentially answering another offer field in different formats per offer!!!" | SRC-6B | PASS | `p5/rereview/rr1-picker-options-address.txt`, `rr1-picker-options-slider.txt`, `rr1-log.txt`, `rr3b-stale-mapping-1440.png` | SOUND — one ZIP sub-field → two offers → `"04686"` / `4686` read back from `leadgen_provider_request_log`; the sibling slider class covered too |
| — | *(D8 carve-out: the live Maps AUTOCOMPLETE leg)* | GATE-INCONC | INCONCLUSIVE(post-deploy) | — | **LEGITIMATE** — one of the two expected inconclusives |

### A.1 #7 — the sliders

| # | Owner sentence | Row | Status | Artifact | Judgement |
|---|---|---|---|---|---|
| I-35 | "You must give the user the option to pick his desired slider from sliders list!!!" | SRC-7 | PASS | `p4/review/picker-1280.png`, `rex5-census-all-five-1280.png`/`-375.png`; `p4/pack/drag-{single,stepper,from_to,dual_range,radial}.webm` | SOUND — five types authored, driven with real pointer drags + keyboard |
| I-36 | "the slider type is **not** a theme decision!!!!" | SRC-7 | PASS | `p4/review/rex5-census-all-five-1280.png` (zero slider-type controls on any theme surface) | SOUND |
| I-37 | "theme is only design language!!!! colors, fonts, sizes, but **not** component types in any way!!!!" | SRC-7, ADJ-N21 note | PASS | same | SOUND |
| I-38 | "if I add a '$' I can't save the section because of conflict between 'number' and 'currency'" | SRC-7 | PASS | `$` toggled on/off on all five, HTTP 200, unchanged type/answer_type | SOUND |
| I-39 | "the currency is only a graphic feature" | SRC-7, SRC-7B | PASS | `p5/rereview/rr1-log.txt` | SOUND |
| I-40 | "I can define that I want the currency will be passed to the offer in the auction" | SRC-7B (D9) | PASS | `p5/rereview/rr1-log.txt` — offer-1 `"$170,000"` verbatim from the provider log | SOUND |
| I-41 | "and I can define that only the number is sent" | SRC-7B | PASS | offer-2 `170000` | SOUND |
| I-42 | "and I can define that the number will be sent as string" | SRC-7B | PASS | offer-3 `"170000"`; `p5/rereview/rr2-b1-type-owned-by-format-1440.png` | SOUND — the type/transform atomic-write blocker is closed and the failure case (`{}`) is shown |
| I-43 | "so your conflict here, **and in any other component with the same dependency**, is just a low level slopy logic" | — | — | — | **MISSING** — no row sweeps the class beyond sliders. The only nearby record is ADJ-N24, filed OUT-OF-CONTRACT (a `PAYLOAD_NODE_TYPES` hand-copy), which is a different defect. `currency_affix` is validated Slider-only (`content-schema.ts:2153`); nothing states whether any sibling component carries the same display-vs-type dependency |

### A.1 #8 — the "Other" group

| # | Owner sentence | Row | Status | Artifact | Judgement |
|---|---|---|---|---|---|
| I-44 | "I want to add 'other' group - a dropdown element, inside the button, where the user can choose another option from a list of chioces inside the dropdown" | SRC-8 | PASS | `p5/rereview/rr4-f-other-buttons-cards-1280.png`/`-375.png`; `p5/review/revG-other-buttons-1280.png` | SOUND |
| I-45 | "A. When I clicked 'Enable other group' it overides the rest of the buttons" | SRC-8 (folded) | PASS | — | **WEAK (citation)** — SRC-8's PASS text never names the non-override leg. The proof exists and is uncited: baseline probe 4c "PERFECT (**base intact**…)" plus `p0/sweep-a/4c-buttons-other-1280.png`/`-375.png`, `4c-cards-other-1280.png`/`-375.png` |
| I-46 | "B. It create a button and not a dropdown, with the lable 'other', which is ridiculous" | SRC-8 | PASS | `p5/rereview/rr4-f-other-buttons-cards-1280.png` (a real `<select>`) | SOUND — and the option-text clipping found in-round was fixed |
| I-47 | "C. I need to have fields to add the dropdown values" | SRC-8, ADJ-A7 | PASS | `p5/rereview/rr4-e1-blank-other-row-1440.png`, `rr4-e2-value-no-label-1440.png`, `rr9-other-rows-removed-1440.png` | SOUND — and the silent-drop class was closed in both shapes |
| I-48 | "D. The same should apply for 'Cards' as well" | SRC-8 | PASS | `p5/review/revG-other-cards-1280.png` | SOUND |

### A.1 #9 / #10

| # | Owner sentence | Row | Status | Artifact | Judgement |
|---|---|---|---|---|---|
| I-49 | "why the cards are aligned to the left…" | SRC-9 | PASS | `p5/review/revD-cards-inserted-1600.png` | **WEAK (viewport/citation)** — one 1600 studio-canvas capture with TWO cards; the owner's Image16 complaint is about 5 cards. The E6 1280+375 pair exists and is uncited: `p0/sweep-a/4d-cards-centered-1280.png`/`-375.png` |
| I-50 | "…and the '+ add choice' is inside the component and widening it???" | SRC-9 | PASS | same (ghost width 98, `insideQuestion:false`) — visually confirmed in the capture | SOUND |
| I-51 | "dropdown component - why is there 'enable other group'??? what does it even mean????" | SRC-10 | PASS | `p5/review/revD-src10-dropdown-1600.png`; `p5/rereview/rr1-log.txt` (zero `data-pb-field="otherGroupEnabled"` served) | SOUND — including the Offers-payload-builder leftover |

### A.1 #11A / #11B

| # | Owner sentence | Row | Status | Artifact | Judgement |
|---|---|---|---|---|---|
| I-52 | "I chose a site - why I don't see its logo????" | SRC-11A, ADJ-R5 | PASS | `p2/review/r5-canvas-logo-1280.png`, `r5-site-settings-logo-1280.png`, `r5-templates-logo-375.png` | SOUND — root cause (preview body omitted `site_id`) named and driven both ways |
| I-53 | "the 'themes' and the templates are moving to the top bar, why you kept the old and wrong option in the funnel builder??????" | SRC-11B, ADJ-B4 | PASS | `p2/review/bd-template-chip-nav-1600.png` | SOUND — chip navigates; `popoverInBuilder:false` |

### A.1 #11C — the funnel builder (every row below is STALE at the terminal phase — see Finding 1)

| # | Owner sentence | Row | Status | Artifact | Judgement |
|---|---|---|---|---|---|
| I-54 | "How user is creating 10 different funnels??" | SRC-11C-N07 | INCONCLUSIVE(step: P2 ≥6-funnel drive) | `p0/review/board-funnel-builder-1440.png` | WEAK — the ≥6-funnel drive DID happen in P2 (`p2/review/bd-b3-1440..1680.png` with 6 funnels) but is uncited and the row was never closed |
| I-55 | "how he can see them side by side?" | SRC-11C-N06 | INCONCLUSIVE(step: P2 re-drive) | `p0/sweep-b/8c-three-funnels-1280.png`, `8c-drag-after-1280.png` | WEAK — real driven proof, row open |
| I-56 | "how the user defines a theme per funnel?" / ref-difference **D** "Theme picker per funnel name" | SRC-11C-D | INCONCLUSIVE(step: P2 re-drive) | `p0/sweep-b/11c-d-funnel-a-theme-1280.png`, `11c-d-funnel-b-theme-1280.png` | WEAK — P0-sweep only, 1280 only; the sweep's own REPORT.md says "the P2 packs capture the full 1280+375 pairs per E6" and P2 committed no artifact for this leg |
| I-57 | "why the user can choose the same page more than ones in the same funnel???" | SRC-11C-N08 | INCONCLUSIVE | `p0/sweep-b/8c-uniqueness-message-1280.png` (+ uncited `p2/review/bd-uniqueness-1600.png`) | WEAK |
| I-58 | "why I need the canvas in the middle of the page???" | SRC-11C-N04 | INCONCLUSIVE | `p0/review/board-funnel-builder-1440.png` | WEAK |
| I-59 | "the routing rules table has got out of its box - disaster!!!!!!" | SRC-11C-N09 | **DEVIATES** | `p0/review/board-funnel-builder-1440.png` | WEAK — contradicted by its own sibling ADJ-B3 **PASS** (`p2/review/bd-b3-1440/1600/1640/1680.png`, `bodyScrollW == innerWidth` at all four widths). The owner-sentence row was never flipped |
| I-60 | "there is no 'control' funnel!!!" | SRC-11C-N01 | INCONCLUSIVE | `p0/review/board-funnel-builder-1440.png` | WEAK |
| I-61 | "the first page is shared by **all** the funnels" | SRC-11C-N02 | INCONCLUSIVE | same ("Shared first page · SHARED · QUOTE-OWNED" card) | WEAK |
| I-62 | "we can do AB test for this page as well!" | SRC-11C-N03 | INCONCLUSIVE | `p0/sweep-b/11c-b-board-chips-1280.png` | WEAK |
| I-63 | "the funnel is decided per user answers durring the questionarie" | SRC-11C-R (checkpoint plane) | INCONCLUSIVE | `p1/review/a11-quote-board-rules-rail-1600.png` + two-arm drive with outcome rows | WEAK — the row's own text calls this leg "PROVEN" and still carries INCONCLUSIVE |
| I-64 | "or per the user parameters (UTMs/ Claudflare data such as device/os/time/day and so on)" | SRC-11C-R (entry plane) | INCONCLUSIVE | `p0/sweep-b/11c-r-utm-routed-1280.png`, `11c-r-device-routed-375.png`, `11c-r-utm-nonmatch-default-1280.png` | WEAK — P0-sweep only; P2's PACK claims a re-drive ("both entry-plane rules drive into their target funnels") with **no artifact committed in `p2/`** |
| I-65 | "kick out all the stupid and unusable components … the canvas, the canvas controllers on the top, the varient - all the things I put 'X' on them" | SRC-11C-N04 | INCONCLUSIVE | `p0/review/board-funnel-builder-1440.png` | WEAK |
| I-66 | "move the funnel strucutre to the center" | SRC-11C-N06 | INCONCLUSIVE | `p0/sweep-b/8c-three-funnels-1280.png` | WEAK |
| I-67 | "add in the left side all the available sections in draggable boxes" | SRC-11C-N05 | INCONCLUSIVE | `p0/sweep-b/8c-drag-after-1280.png` | WEAK |
| I-68 | "in the middle create different funnels side by side and drag sections boxes to the page of the wanted funnle" | SRC-11C-N06 | INCONCLUSIVE | `p0/sweep-b/8c-drag-before/after-1280.png` | WEAK |
| I-69 | "add button of 'add funnel', user should be able to add as many funnel he wants … there could be funnels that are not even in use … its fine" | SRC-11C-N07 | INCONCLUSIVE | `p0/review/board-funnel-builder-1440.png` | WEAK |
| I-70 | ref-difference **A** "the order of the pages could be changed and not only what pages we show per funnel name" | SRC-11C-A | INCONCLUSIVE(step: P2 re-drive) | `p0/sweep-b/11c-a-menu-*.png`, `11c-a-drag-*.png` (incl. post-reload) | WEAK — both legs persist after reload in the sweep, and P2 re-drove them (`p2/review/bd-reorder-drag-1600.png`, `bd-reorder-drag2-1600.png`, `bd-reorder-menu-1600.png`, all uncited). Row never closed |
| I-71 | ref-difference **B** "each page could include more than one section and we should be able to A/B test or creating in-funnel rules (show in CA this section in this page, and in the rest show this sectio)" | SRC-11C-B | **DEVIATES** | `p0/sweep-b/11c-b-*.png` | WEAK — the DEVIATES text names exactly the gap P2 then fixed (operator authoring path + generated sentence). P2's evidence exists and is uncited: `p2/review/sl-ab-dialog-1600.png`, `sl-ab-saved-1600.png`, `sl-ruled-dialog-1600.png`, `sl-ruled-live-desktop-1280.png`, `sl-ruled-live-mobile-375.png`, `rex-minor4-ruled-sentence-1600.png`. The `state=CA` **live-geo** sub-leg is legitimately GATE-INCONC |
| I-72 | ref-difference **C** "The AB test can be also in the funnel level and not only in the page level" | SRC-11C-C | INCONCLUSIVE(step: P2 both-arms re-drive) | `p0/sweep-b/11c-c-variant-config-1280.png`, `11c-c-visitor-entry-1280.png` (16 draws split 9/7) | WEAK — P0-sweep only; P2's PACK narrates "10/10 across 20 sessions" with **no artifact committed in `p2/`** |
| I-74 | "Unified the 'Rules' with this tab and show them in the right side where we define rules of what funnel name we are showing for each user" | SRC-11C-N10 | INCONCLUSIVE | `p0/review/board-funnel-builder-1440.png` | WEAK |
| I-75 | "the rules you build are using jargon, have no actions, and just poor poor execution" | SRC-11C-N11 | INCONCLUSIVE | `p0/sweep-b/8c-rules-modal-sentence-1280.png`, `8c-rules-modal-saved-card-1280.png` | WEAK — the jargon/actions fix is driven; row open. (Sibling ADJ-N8 records a residual raw-VALUE display, owner fix-or-defer) |
| I-76 | "**Image42** here it how it builds in the reference. look at the contract of this mission and to the basic definisions and analyse the differences" | SRC-11C-N12 | INCONCLUSIVE(step: P2 pack side-by-side vs Image42.png) | **—** | **MISSING** — the only row in the register with no artifact at all, and the named step was never executed: `grep -rn "Image42" docs/leadgen/r2/evidence/` returns **zero hits**. `SoT/images/Image42.png` exists; nothing was ever placed beside it |

### A.1 #11D — templates

| # | Owner sentence | Row | Status | Artifact | Judgement |
|---|---|---|---|---|---|
| I-77 | "I should be able to create as many templates I want, to save them, and to use them as presets in different 'Quotes'" | SRC-11D-N01 | INCONCLUSIVE | `p0/sweep-b/5d-template-two-created-1280.png`, `5d-apply-preview-confirm-1280.png` | WEAK — uncited P2 proof exists (`p2/review/n01-crossquote-templates-1600.png`, `r4-template-created-1440.png`); row never closed |
| I-78 | "The user should be able to define the 'default' template, but to A/B test different templates" | SRC-11D-N02 (+ ADJ-B2 **PASS**) | INCONCLUSIVE | `p0/sweep-b/5d-set-default-1280.png`, `5d-ab-templates-result-1280.png` | WEAK — ADJ-B2's PASS (`p2/review/d5-set-per-quote-default-1440.png`, migration 0055, three legs driven) already satisfies it; the owner-sentence row was never flipped |
| I-79 | "'The funnel layout elements (A)' should be aligned to the left, the funnel elemnts settings (B) shuold be aligned to the right, and in the middle should be a *CANVAS*" | SRC-11D | PASS | `p2/review/e-00-templates-3pane-1440.png`, `e-99-templates-after-all-1440.png` (+ per-element `e-A..e-I` canvas captures) | SOUND — all nine elements A–I move the canvas live |
| I-80 | "the canvas should include one section in the middle so the user could see a real reference of how is design is gonna look like in real life" | SRC-11D-N03 | **DEVIATES** | **—** | WEAK — contradicted by SRC-11D's own PASS ("ONE preview path on empty AND populated funnels"; `p2/review/e2-empty-templates-1440.png`, `e2-empty-templates-after-1440.png`). Stale row, no artifact |
| I-81 | "and to swich 'Themes' so he will see how it looks on different themes designs" | SRC-11D-N04 | **DEVIATES** | **—** | WEAK — contradicted by ADJ-B7 **PASS** (`p2/review/b7-templates-theme-switch-1440.png`, `b7-new-theme-affordance-1440.png`, `b7-frameless-theme-switch-canvas.png`). Stale row, no artifact |
| I-82 | "Add a 'I' 'funnel layout element' - progress bar - I clearly explained that I want different types of progress bars and to design them with a dedicated box!" | SRC-11D | PASS | `p2/review/p-bar-progress-crop.png`, `p-icon_on_track-progress-crop.png`, `p-dots-progress-crop.png`, `p-numbered-progress-crop.png`, `p-label-percent-crop.png` | SOUND — five styles, each stamping `lg-frame-progress--{style}` |

### A.1 #11E — themes

| # | Owner sentence | Row | Status | Artifact | Judgement |
|---|---|---|---|---|---|
| I-83 | "Add a real section to the canvas to the user could actually see the design he creates" | SRC-11E, ADJ-B5 | PASS | `p2/review/t-00-themes-3pane-1440.png`, `t2-sticky-after-scroll-1440.png`, `t-sec1/2/3-canvas.png`, `rex2-major1-01-harmony-1440.png`, `rex2-major1-02-advanced-hex-1440.png` | SOUND — three panes, ONE canvas, sticky proven by bounding box under a 1400px scroll, every rail affordance live |
| I-84 | "the buttons design not rich enough, I should be able to decide from rich veriaty of buttons, for example - Image23" | SRC-11E | PASS | `p2/review/rex-major2-themecard-visitor-1280.png`/`-375.png`, `img23-visitor-1280.png`/`-375.png` | SOUND — full-width stacked two-line cards + the Other row, both viewports, beside `SoT/images/Image23.png` |

### A.2 — the dropped footer task (element "J")

| # | Owner sentence | Row | Status | Artifact | Judgement |
|---|---|---|---|---|---|
| I-85 | "Add a bottom of the page template management." | SRC-J, SRC-R3 | PASS | `p3/review/rex3-img28-alpha-1280.png`/`-375.png` | SOUND — and the phase root-fixed "J could not render at all" + "one save silently wiped the footer" |
| I-86 | "this is **seperate template element**" (→ new element "J") | SRC-J (ruled: tile G upgraded IN PLACE), ADJ-N17 | PASS + DEVIATES(owner ruling) | `p3/review/rex3-img45-alpha-1280.png` | **WEAK (surfaced, not hidden)** — no surface names it "J"; the tile reads "G · Footer". Contract §5.4 minor-1 sanctions the in-place upgrade and ADJ-N17 puts the relabel to the owner. Honest, but the owner's literal word is unmet at CLOSE |
| I-87 | "should include - free text (rich toolbar)" | SRC-J | PASS | `p3/review/rex3-img45-alpha-1280.png`; `p3/image45-footer-1280.png` | SOUND — bold/italic/link modal/H1–H6/lists driven |
| I-88 | "links to legal pages (from the 'pages' tab) **that the user is choosing**" | SRC-J, GATE-LEGALTYPE | PASS + INCONCLUSIVE(owner runs the remediation) | `p3/review/rex3-img28-alpha-1280.png`; `p3/d2-two-site-hrefs.txt`; `p3/legal-page-type-remediation-DRAFT.sql` | SOUND — per-serving-site resolution, manual fallback, omission rather than mis-resolve. The production-row remediation is correctly owner-owned |
| I-89 | "Logo" | SRC-J | PASS | `p3/p3tail-item2-footer-logo-1280.png`/`-375.png` | SOUND — size-constrained (2000px asset → 128×32) |
| I-90 | "company details and other elenments" | SRC-J | PASS | `p3/image28-footer-1280.png` | SOUND |
| I-91 | "this template element could use different **color**, font and sizes then the main template" | SRC-J, ADJ-N16 | PASS + DEVIATES(owner ruling) | `p3/review/rex3-b1-after-textsize-save-1280.png`; `test/leadgen-footer-font-family.test.ts` | **WEAK** — font and sizes are independent; the COLOURS are role references into the main palette, so changing the main theme moves the footer. ADJ-N16 states this plainly and routes it to the owner. The owner's word "different color" is satisfied only in the contract-accepted sense |
| I-92 | "Here are some exmamples … Image28, **Image29, Image30, Image31**, Image45" | SRC-J | PASS | `p3/review/rex3-img28-alpha-{1280,375}.png`, `rex3-img45-alpha-{1280,375}.png` | **WEAK** — two of the five named examples are rebuilt and side-by-sided; Image29/30/31 are never referenced by any row, artifact or pack. `SoT/images/Image29–31.png` exist |

### A.3 — the 2026-07-27 rejection list, and A.4

| # | Owner sentence | Row | Status | Artifact | Judgement |
|---|---|---|---|---|---|
| I-93 | "templates canvas non-functional" | SRC-R1 | PASS | `p2/review/e-99-templates-after-all-1440.png`, `r5-canvas-logo-1280.png` | SOUND (via I-79/I-82) |
| I-94 | "themes tab layout (left section chooser by activity/vertical, sticky center canvas, right design elements, no duplicate canvases)" | SRC-R2 | PASS | `p2/review/t-00-themes-3pane-1440.png`, `t2-sticky-after-scroll-1440.png` | SOUND (via I-83) |
| I-95 | "footer element J" | SRC-R3 | PASS | `p3/review/rex3-img28-alpha-1280.png`, `rex3-img45-alpha-1280.png` | SOUND (naming caveat I-86) |
| I-96 | "sliders broken vs Image9–14 and picker ≠ render" | SRC-R4 | PASS | `p4/review/rex5-census-all-five-1280.png`; **cited `rex5-f5-picker-1280.png` DOES NOT EXIST** — the real file is `p4/review/rex4-f5-picker-1280.png` | SOUND with a **broken citation** (Finding 4) |
| I-97 | "question grid 'not even close'" | SRC-R5 | PASS | `p1/review/vg-poor-1280-04-q5-answered.png` beside `SoT/images/Screenshot 2026-07-27 at 18.30.25.png`; `refix-b2/b3` series | SOUND |
| I-98 | "address 'none of the issues fixed'" | SRC-R6 | PASS | `p5/rereview/rr5-g1..g4` set; `p5/review/revA-s1-freetext-375.png`, `revA-s3-badzip-375.png` | SOUND |
| I-99 | A.4 "if user chooses answer X to Question A, unhide and require this DROPDOWN — **HOW DO I SET DROPDOWN???**" — the AUTHORING path is acceptance | SRC-1d, SRC-2b, SRC-R5 | PASS | `p1/review/a3-dependency-editor-1600.png`, `a4-nonboolean-dependency-1600.png`, `refix-b1-label-typed.png` | SOUND — authored in the real studio, per-character typing, then driven |

*(I-73 is folded into I-56 — ref-difference D and "how the user defines a theme per funnel?" are the same demand.)*

## 3 · Table B — every acceptance artifact → the sentence it serves

Inventory = the 36 test/spec files **added** on the R2 chain (`git diff --name-status 4e95903~1..HEAD -- api/test api/test-ui`). All paths under `api/`.

| Artifact | SOURCE sentence it serves | Verdict |
|---|---|---|
| `test/leadgen-question-grid-schema.test.ts` | A.1 #1 "Each question … is independent field … inefendent defaults!!" (schema/registry/projection) | SOUND |
| `test/leadgen-question-grid-render.test.ts` | A.1 #1 dead parts + #2 dependency render | SOUND |
| `test/leadgen-question-grid-studio.test.ts` | A.1 #1 + A.4 "HOW DO I SET DROPDOWN???" — the authoring editor | SOUND |
| `test/leadgen-question-grid-runtime.test.ts` | A.1 #2 "if we set a 'default' … 'required' rule is met" / "it doesn't exist" | SOUND |
| `test/leadgen-question-grid-seams.test.ts` | A.1 #1 "help us to decide the user jurney (the funnel) by the funnel rule" | SOUND |
| `test/leadgen-question-grid-fixround.test.ts` | A.1 #1/#2 + §A.4 — the four review blockers, each pinned to the owner's words | SOUND |
| `test-ui/leadgen-r2p1-fixround-smoke.spec.ts` | A.1 #1/#2 driven on the 18.30.25 screen | SOUND (driven) |
| `test/leadgen-activation-preflight-r2.test.ts` | **no owner sentence** — probe defect ADJ-B1 ("every well-formed draft quote … activation 409s with NO reason surfaced") | SCAFFOLDING (enabler: every owner journey is undriveable while activation 409s; carries its own register row) |
| `test/leadgen-templates-canvas-r2.test.ts` | A.1 #11D "in the middle should be a *CANVAS*" + #11A logo | SOUND |
| `test/leadgen-themes-threepane-r2.test.ts` | A.1 #11E + A.3 "themes tab layout" | SOUND |
| `test/leadgen-board-defects-r2.test.ts` | A.1 #11B / #11C board sentences | SOUND |
| `test/leadgen-d5-per-quote-default.test.ts` | A.1 #11D "define the 'default' template, but to A/B test different templates" | SOUND |
| `test/leadgen-p2-fixfirst-r2.test.ts` | A.1 #11E Image23 + #11D canvas (the two review MAJORs) | SOUND |
| `test/leadgen-p2-tail.test.ts` | A.1 #11C-B slot A/B dialog + #11C-D theme one-save path | SOUND |
| `test/leadgen-element-j-r2.test.ts` | A.2 "Add a bottom of the page template management" | SOUND |
| `test/leadgen-element-j-pages-links.test.ts` | A.2 "links to legal pages (from the 'pages' tab) that the user is choosing" | SOUND |
| `test/leadgen-footer-font-family.test.ts` | A.2 "could use different color, **font** and sizes then the main template" | SOUND |
| `test/leadgen-p3-saved-template-footer.test.ts` | A.2 (a saved template must actually reach the served page) | SOUND |
| `test/leadgen-p3-fixround-footer.test.ts` | A.2 — the 2 BLOCKERS + 3 MAJORs on Image28/Image45 buildability | SOUND |
| `test-ui/leadgen-p3-fixround-footer.gesture.spec.ts` | A.2 "Here are some exmamples … Image28 … Image45", driven at 1280+375 | SOUND (driven) |
| `test/leadgen-p3-provisioning-legal-page-type.test.ts` | A.2 "legal pages **that the user is choosing**" (four picks were collapsing to one page) | SOUND |
| `test/leadgen-p3-checklist.test.ts` | A.2 "free text (rich toolbar)" — the editor offered a Checklist style the renderer ignored | SOUND (coherence inside a named clause, not new scope) |
| `test/leadgen-p3-fixround-footer-picker-coupling.test.ts` | A.2 (structural guard that the picker's DOM and its loader co-ship) | SCAFFOLDING |
| `test/leadgen-slider-anatomy-r2.test.ts` | A.1 #7A "pick his desired slider from sliders list" — §6.8 anatomy floor (self-declared NOT the acceptance) | SOUND (honest unit floor) |
| `test-ui/leadgen-r2p4-slider-drive.spec.ts` | A.1 #7A — five types authored + driven at 1280/375 | SOUND (driven) |
| `test-ui/leadgen-r2p4-s4b-slider-drive.spec.ts` | A.1 #7A — the five types MOVE (pointer + keyboard, measured) | SOUND (driven) |
| `test-ui/leadgen-r2p4-thumbnail-fix-drive.spec.ts` | A.1 #7A / A.3 "picker ≠ render" | SOUND (driven, both sides real) |
| `test-ui/leadgen-r2p4-drag-recordings.spec.ts` | A.1 #7A — the five drag recordings contract §5.5 names for the owner pack | SOUND (pack artifact) |
| `test-ui/leadgen-r2p4-fixfirst-drive.spec.ts` | A.1 #7A — a typed from_to value diverging from the billed answer | SOUND (driven, money path) |
| `test-ui/leadgen-r2p4-fixround2-drive.spec.ts` | A.1 #7A — the whole interaction matrix after the N-1 regression | SOUND (driven) |
| `test/leadgen-slider-currency-fields-r2.test.ts` | A.1 #7B "the currency is only a graphic feature" | SOUND |
| `test/leadgen-r2p5-transform-currency.test.ts` | A.1 #7B + D9 exact `$170,000` | SOUND (unit floor under a driven spec) |
| `test-ui/leadgen-r2p5-payload-seam-drive.spec.ts` | A.1 #7B three formats + #6 "every component that include more than one field" | SOUND (driven; the F1 rewrite removed the raw-JSON authoring shortcut — the E10/E11 class) |
| `test-ui/leadgen-r2p5-s5c-drive.spec.ts` | A.1 #6 Maps honesty + #5 standalone Phone (D6) + #7B control | SOUND (driven) |
| `test/leadgen-p5f3-address-labels-and-chrome.test.ts` | A.1 #6 "this is poorly designed with poor logic!!" — composite sub-field labels | SOUND |
| `test/leadgen-p5-tail-round.test.ts` | A.1 #6 "the mapping of what is auto-filled per field should definatly be an option" + the ADJ-R8 studio mirror | SOUND |

**No UNREQUESTED-SCOPE artifact found.** 34 of 36 name an owner sentence; the 2 exceptions are
scaffolding that carries its own register row or guards a named clause. The 50 *modified* test files
are pre-existing suites re-pinned to stay coherent (incl. four frozen byte-pins the P5 tracker
discloses and audits). One name collision worth flagging so it is not mistaken for mission work:
`api/test/leadgen-r2-canvas.test.ts` is **not** this mission — its header reads "Section Builder v3.1
REMEDIATION — phase R2", a different program's "R2"; it predates `4e95903`.

## 4 · Findings, ranked

**F-1 · 21 owner-sentence rows are still open at the terminal phase — the whole of A.1 #11C plus 4
of 6 A.1 #11D sentences.** 17 read `INCONCLUSIVE(step: P2 re-drive …)` and 4 read `DEVIATES`, all
seeded before P2 and never touched after P2 merged (743d0c7, 2026-07-29). Rows: `SRC-11C-A`,
`SRC-11C-C`, `SRC-11C-D`, `SRC-11C-R`, `SRC-11C-N01`–`N08`, `N10`, `N11`, `N12`, `SRC-11D-N01`,
`SRC-11D-N02` (inconclusive); `SRC-11C-B`, `SRC-11C-N09`, `SRC-11D-N03`, `SRC-11D-N04` (deviates).
Four of them are directly contradicted by a sibling row that PASSES the same thing — `N09` vs
`ADJ-B3` PASS, `11D-N02` vs `ADJ-B2` PASS, `11D-N04` vs `ADJ-B7` PASS, `11D-N03` vs `SRC-11D` PASS.
`traceability.md` is the mission's single recovery truth; on its own face the owner's biggest clause
is unsatisfied. **Mechanism (why 4 gates said "0 violations"):**
`.claude/skills/mission/scripts/check_register.py:97` accepts any INCONCLUSIVE whose text merely
matches `step:|post-deploy|cutover` — `"step: P2 re-drive"` satisfies it permanently, including
after P2 shipped; and the validator never flags `DEVIATES` at all.

**F-2 · Two of those sentences have no P2 evidence at all, only the P0 seed.** `SRC-11C-C`
(funnel-level A/B, both arms) and `SRC-11C-D` (theme per funnel) are carried solely by
`p0/sweep-b/11c-c-*.png` and `11c-d-*.png`. The P2 PACK narrates re-drives ("splits 10/10 across 20
sessions"; "two funnels render two different themes") but `docs/leadgen/r2/evidence/p2/` contains no
artifact for either. `SRC-11C-R`'s entry-plane leg is in the same position. The sweep's own
`p0/sweep-b/REPORT.md` states "Captures are 1280 throughout … This sweep SEEDS proof; the P2 packs
capture the full 1280+375 pairs per E6" — the 375 pairs were never captured.

**F-3 · `SRC-11C-N12` — the Image42 side-by-side was never produced.** The only register row with
`—` for evidence, its named step ("P2 pack side-by-side vs Image42.png") unexecuted:
`grep -rn "Image42" docs/leadgen/r2/evidence/` returns zero hits. `SoT/images/Image42.png` exists.
Owner sentence: "Image42 here it how it builds in the reference."

**F-4 · Two broken evidence citations (files do not exist on disk).**
`SRC-R4` cites `rex5-f5-picker-1280.png (p4/review)` — the file is `p4/review/rex4-f5-picker-1280.png`
(one-character id slip). `LEDGER-P4` cites `p4_radial-1280.png (p4/s4b)` — no such file; `p4/s4b/`
holds `radial-1280-after-drag.png` / `radial-1280-after-keys.png`. Every other cited artifact
resolves: **177 citations checked, 175 resolve in the hinted directory**, plus 3 deliberate
out-of-tree pointers (`SoT/images/Image8.png`, `SoT/images/Screenshot … 18.30.25.png`, the EV-619
incident record) that all exist.

**F-5 · `SRC-3` is PASS ahead of its own proof, and narrower than the owner's sentence.** The status
text itself says "the FULL roster re-verification remains scheduled at P6". Evidence covers 4 of the
~20 roster entries the contract enumerates (`LEADGEN-R2-FIX-CONTRACT.md:217-234`). Separately, the
Requirement column reduces "The logical flow I described above should be applied on all the
components" to the add-affordance rule alone; no row carries the wider reading.

**F-6 · A.1 #7's last clause has no row: "your conflict here, and in any other component with the
same dependency, is just a low level slopy logic."** `SRC-7` proves the `$` conflict is gone on the
five sliders; nothing states whether any sibling component carries the same display-vs-answer-type
dependency. `ADJ-N24` is a different defect (a duplicated `PAYLOAD_NODE_TYPES` list) and is filed
out-of-contract.

**F-7 · A.1 #1's analytics consumer is unproven.** "providing us another input on the user for the
**analytics**" has no row. Contract §2 item 2 names "offers/analytics/routing"; offers (provider
payload) and routing (rule + outcome row) are driven, analytics is not asserted anywhere.
`analytics_id` appears in the grid tests only as fixture data.

**F-8 · A.1 #5's operator-defined mask is uncited, and the "Israel" option is unaddressed.** `SRC-5`
cites only the `(3)-3-4` default drive; the owner explicitly names a second, operator-authored mask
`(2)-4-1 → (__)-____-_`. Artifacts for a second mask exist uncited (`p0/sweep-a/4b-phone-mask-b-*`,
`p0/review/spot-4b-mask-b-*`) and the baseline probe rated it PERFECT — a citation fix, not a build.
Separately, no row asks for the country option's removal and `config-dto.ts:300` /
`content-schema.ts:311` still ship an `il` phone-format preset.

**F-9 · Three PASS rows are cited only by an admin-plane or single-viewport capture where the E6
pair exists uncited.** `SRC-9` (cards centred) cites one 1600 studio capture showing TWO cards while
the owner's Image16 shows five, and `p0/sweep-a/4d-cards-centered-1280.png`/`-375.png` go uncited.
`SRC-8`'s non-override leg (the owner's #8-A) is never named in its PASS text although
`p0/sweep-a/4c-buttons-other-1280.png`/`-375.png` prove it. `SRC-2c` omits the "can't click continue
unless he answers" leg entirely — its only record is the pre-R2 baseline probe.

**F-10 · Two A.2 sentences are met only in a contract-accepted sense, both surfaced to the owner.**
"this is a **seperate template element**" → shipped as tile G upgraded in place, no surface says "J"
(`ADJ-N17`). "could use different **color** … then the main template" → the footer's colours are role
references into the main palette, so retheming the funnel moves them (`ADJ-N16`). Both are honest
open owner rulings, not hidden — listed here because at CLOSE the owner's literal words are unmet.

**F-11 · Three of the five A.2 example images were never built or side-by-sided.** Image28 and
Image45 are rebuilt and captured at 1280+375; Image29, Image30 and Image31 are named in the owner's
sentence, exist in `SoT/images/`, and appear in no row, artifact or pack.

**F-12 · Two INCONCLUSIVE rows are owner-eye items mislabelled.** `ADJ-N28` (Image8 autocomplete box)
and `ADJ-N21` (slider readout above vs below) resolve on an owner design ruling, not a post-deploy
step; the register's own vocabulary has `BLOCKED(owner)` for that. Both are correctly surfaced and
correctly not silently chosen — this is a labelling defect only.

**Legitimately open, not findings:** `GATE-INCONC` (the two expected inconclusives — the D8 Maps
autocomplete leg carved out inside `SRC-6`, and `SRC-11C-B`'s `state=CA` live-geo leg);
`GATE-LEGALTYPE` (production rows the owner must remediate or re-provision at cutover, with a
drafted idempotent SQL and a named post-check); `GATE-W89` (deploy-source reconciliation at cutover);
`ADJ-R1a` PASS on the owner's own hand-run read-only production SELECT. No `BLOCKED(owner)` row was
found hiding unfinished engineering. No PASS was found resting on a producer→consumer proof with both
sides hand-built — the one instance of that class (P5's raw-JSON payload authoring) was caught by the
phase's own review and rewritten to click the real control.

## 5 · Counts

| | |
|---|---|
| Owner imperatives found in SOURCE (A.1 #1–#11E, A.2, A.3, A.4) | **98** |
| **SOUND** — a real, driven artifact demonstrates that sentence | **58** |
| **WEAK** — a row exists but is not closed, is uncited, single-plane, or narrower than the sentence | **36** |
| **MISSING** — no row, or a row with no artifact | **4** (I-02 analytics · I-24 Israel option · I-43 "any other component with the same dependency" · I-76 Image42 side-by-side) |

Of the 36 WEAK, **26 are the F-1/F-2 stale-register class** (the 21 unclosed #11C imperatives, the 4
unclosed #11D imperatives, and I-03 which hangs off the same `SRC-11C-R` row) — bookkeeping the
register can close from evidence already committed, **except** `SRC-11C-C`, `SRC-11C-D` and
`SRC-11C-R`'s entry plane, which need the E6 1280+375 re-drive P2 promised and never committed. The
remaining 10 WEAK are substantive: I-13/I-21 (roster), I-18 (required-blocks-Continue), I-23/I-25
(operator-defined mask), I-45 (Other non-override), I-49 (cards centred), I-86/I-91/I-92 (footer).

Register census (125 rows): 51 SRC (30 PASS · 17 INCONCLUSIVE · 4 DEVIATES) · 60 ADJ · 3 GATE ·
10 DEC · 1 LEDGER — 115 non-decision rows, matching the P5 pack's stated count. 740 evidence files:
660 PNG, 5 drag recordings, 67 log/JSON/SQL, 8 PACK/REPORT markdown; no zero-byte artifact; every
sub-5KB PNG is a legitimate crop or a deliberate empty-state capture.
