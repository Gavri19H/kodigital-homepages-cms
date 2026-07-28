# LeadGen R2 — Traceability Register (single recovery truth)

Seeded by Execution-Plan Step 0.3 from Contract §8 at **imperative-sentence granularity** (F1/M-6).
Anchors quote the owner verbatim (fragments of `SOURCE-OF-TRUTH.md`); probe lines quote
`LEADGEN-R2-PROBE-VERDICTS.md` (2026-07-27). Only the conductor writes rows, and only after its own
gate run + adversarial SHIP. Status vocabulary: `PASS(evidence)` / `DEVIATES(finding)` /
`BLOCKED(owner)` / `INCONCLUSIVE(step: …)`. Validator: `check_register.py` must exit 0 at every
phase merge and at CLOSE. Owner-gate column: P1/P4 packs are OWNER-BLOCKING (D10); all other packs
async (PACK DELIVERED → OWNER-APPROVED only by the owner's dated reply).

## SRC rows — owner imperatives

| ID | Anchor (owner verbatim) | Requirement | Phase | Owner gate | Status | Evidence |
|---|---|---|---|---|---|---|
| SRC-1a | "you can't treat the whole component as one unit that is providing an answer to one filed" | ① ONE container component whose children are independent-field questions | P1 | P1 pack OWNER-BLOCKING + `Screenshot 2026-07-27 at 18.30.25.png` | DEVIATES(probe: "no such component; only flat sections + element-level Rules") | — |
| SRC-1b | "inefendent **defaults!!** (right now only the first question has option for default)" | independent default per question; default control live (A3) | P1 | P1 pack | DEVIATES(probe: "Default-choice select ignores in-session choice edits until save+reload") | — |
| SRC-1c | "if the user wants to deviate from the theme - independent style" | per-question style deviation, D4 full axes incl. free colors | P1 | P1 pack | DEVIATES(probe: "size/corners/border only; colors locked to 3 theme roles"; replay: corners/border/width DO render live — re-scope to the constrained axes after a fresh drive) | — |
| SRC-1d | "independent **rules**!" | per-question dependencies authored in QUESTION terms, type-agnostic both sides | P1 | P1 pack | DEVIATES(probe: "expressible only as a section-level element rule … shows the SECTION HEADLINE") | — |
| SRC-1e | "you left a lot of dead parts- … there is no 'Main question'!!!" | no shared Helper text / Answer format / sub-questions / Main question | P1 | P1 pack | DEVIATES(probe: dead parts present in the component editor) | — |
| SRC-1f | "the '+Add a question' button, for all the components, should be small, **out of the component** and not to affect the componenent size/ structure!!!" | + Add a question small, OUTSIDE, non-widening | P1 | P1 pack | DEVIATES(probe: "affordance does not exist") | — |
| SRC-2a | "the question is marked/checked and only being tracked after the user is clicking 'continue' … if the user is overiding the default, the user answer is the one that is being saved" | mark-then-continue; override wins | P1 (reuse) | P1 pack | INCONCLUSIVE(step: P0 baseline sweep re-drive — probe rated PERFECT, in-use re-proof required) | — |
| SRC-2b | "the 'credit score' question is a dropdown element - the user shuold be able to choose the wanted element per question" | mixed types per question inside the container | P1 | P1 pack | DEVIATES(probe: primitives PERFECT but homeless — no container to hold mixed-type questions) | — |
| SRC-2c | "if we set a 'default' and the user didn't change it - this is his answer and the 'required' rule is met. but if the user clicked 'no' … we need to ignore this question" | required-with-default; dependency-hidden ⇒ not required/validated/persisted; label hides too (A1) | P1 | P1 pack | DEVIATES(probe: "the hidden question's LABEL stays visible as an orphan") | — |
| SRC-3 | "should be applied on all the components, you are not allowed to take care only in this component and ignore the rest" | add-affordance outside-rule proven on the FULL registry roster | P1 + P6 re-verify | per-component roster list | DEVIATES(probe: rule applied nowhere; roster acceptance per Contract §2 #4) | — |
| SRC-4 | "the √ inside the button for the chosen answer" | ✓ inside selected grid button; lift faint-contrast nit | P1 | P1 pack | INCONCLUSIVE(step: P0 baseline sweep re-drive — probe 4a PERFECT "contrast subtle") | — |
| SRC-5 | "somthing like field that looks this way (3)-3-4 … converted to this format - (___)-___-____" | phone mask re-prove; standalone tile = D6 (ADJ-A6) | P5 | P5 pack (async) | INCONCLUSIVE(step: P0 baseline sweep re-drive — probe 4b PERFECT incl. verbatim block message) | — |
| SRC-6 | "if I want to auto fill only for street address and city and I want the user will insert the Zip by himself but to validate the Zip in a 5 digits zip validation?" | ⑥ subsets; composite-by-default (D3); zip5 visible message; keyless-degrade honesty; live autofill leg per D8 | P5 | P5 pack (async) + `Image8.png` | DEVIATES(probe: "zip5 … blocks SILENTLY"; "visitor gets ONE bare input"; autofill unauthorable keyless) | — |
| SRC-6B | "every component that include more than one field- each field is potentially answering another offer field in different formats per offer!!!" | one address sub-field → TWO offers in TWO output formats via value_transform | P5 (after SRC-7B) | 2-offer/2-format payload | DEVIATES(no operator-facing output-format control exists; transforms are advanced/raw-JSON only) | — |
| SRC-7 | "You must give the user the option to pick his desired slider from sliders list!!! the slider type is **not** a theme decision!!!" | ⑤ five slider types render the §6.8 anatomy in use; picker == render; `$` display-only | P4 | P4 pack OWNER-BLOCKING + Image10.png/Image11.png/Image12.png/Image13.png/Image14.png | DEVIATES(probe 2b/2c: "four of five renders don't deliver it" — detached handle / bare inputs / stacked tracks / no dial) | — |
| SRC-7B | "I can define that I want the currency will be passed to the offer in the auction and I can define that only the number is sent, and I can define that the number will be sent as string" | currency-string/number/number-as-string per offer via value_transform; D9 exact string `$170,000` | P5 | 3-format payload table | DEVIATES(no currency-format transform kind; TRANSFORM_KINDS duplicated in two files) | — |
| SRC-8 | "I want to add 'other' group - a dropdown element, inside the button … I need to have fields to add the dropdown values. D. The same should apply for 'Cards' as well" | authored-Other dropdown re-prove (Buttons+Cards) | P5 | P5 pack (async) | INCONCLUSIVE(step: P0 baseline sweep re-drive — probe 4c PERFECT; ADJ-A7 frictions tracked separately) | — |
| SRC-9 | "why the cards are aligned to the left and the '+ add choice' is inside the component and widening it???" | cards centered; add-choice outside re-prove | P5 | P5 pack (async) | INCONCLUSIVE(step: P0 baseline sweep re-drive — probe 4d PERFECT; ADJ-A5 tracked separately) | — |
| SRC-10 | "dropdown component - why is there 'enable other group'??? what does it even mean????" | dropdown editor clean re-prove; Offers-Payload-Builder leftover removed | P5 | P5 pack (async) | INCONCLUSIVE(step: P0 baseline sweep re-drive — probe 4e PERFECT; leftover control on payload builder) | — |
| SRC-11A | "I chose a site - why I don't see its logo????" | ② logo resolves in canvas (8a + R5 site_id seam) | P2 | P2 pack (async) + `Image18.png` | DEVIATES(probe 8a: authored logo still shows "No logo — set it in Site settings") | — |
| SRC-11B | "the 'themes' and the templates are moving to the top bar" | top-bar-only re-prove | P2 | P2 pack (async) | INCONCLUSIVE(step: P0 baseline sweep re-drive — probe 8b PERFECT) | — |
| SRC-11C-A | "the order of the pages could be changed and not only what pages we show per funnel name" | page reorder (drag + menu equivalent) persists; board reachable ≥6 funnels, no rail occlusion @1600/1640/1680 | P2 | P2 pack (async) | INCONCLUSIVE(step: P0 baseline sweep seed + P2 re-drive — probe 8c "page-reorder-by-drag UNCONFIRMED"; ADJ-B3 occlusion) | — |
| SRC-11C-B | "each page could include more than one section and we should be able to A/B test or creating in-funnel rules (show in CA this section in this page, and in the rest show this sectio, for example)" | multi-section pages; per-slot A/B + ruled slots | P2 | P2 pack (async) | INCONCLUSIVE(step: P0 sweep seed + P2 live drive via device/utm_content; state=CA unit + authoring-UI proof; state=CA LIVE-geo leg resolves post-deploy at the cutover sitting — GATE-INCONC) | — |
| SRC-11C-C | "The AB test can be also in the funnel level and not only in the page level" | funnel-level A/B; both arms served | P2 | P2 pack (async) | INCONCLUSIVE(step: P0 sweep seed + P2 both-arms drive) | — |
| SRC-11C-D | "Theme picker per funnel name" | theme-per-funnel; two funnels render two themes | P2 | P2 pack (async) | INCONCLUSIVE(step: P0 sweep seed + P2 two-funnel two-theme drive) | — |
| SRC-11C-R | "the funnel is decided per user answers durring the questionarie or per the user parameters (UTMs/ Claudflare data such as device/os/time/day and so on)" | routing via leadgen_quote_routing_rules: answers=CHECKPOINT plane; params=ENTRY plane; outcomes recorded | P1 (grid leg) + P2 | P1/P2 packs | INCONCLUSIVE(step: P1 grid checkpoint-rule drive + P2 UTM & device entry-rule drives → leadgen_routing_outcomes) | — |
| SRC-11D | "'The funnel layout elements (A)' should be aligned to the left, the funnel elemnts settings (B) shuold be aligned to the right, and in the middle should be a *CANVAS*" + "I want different types of progress bars and to design them with a dedicated box!" | ② 3-pane; ONE preview path; every element A–I reflects live; 5 progress styles selectable + visually distinct | P2 | P2 pack (async; `Image22.png` = BEFORE-reference only) | DEVIATES(probe 5a/5b/5c: "0/9 elements reflect any edit" on empty path; only Background on populated; dead chip; single-option dropdowns) | — |
| SRC-11E | "Add a real section to the canvas to the user could actually see the design he creates. the buttons design not rich enough … for example - Image23" | ③ three-pane; sticky center canvas; one canvas; Image23 two-line buttons | P2 | P2 pack (async) + `Image23.png` | DEVIATES(probe 6a/6b/6c: placeholder canvas; TWO stacked canvases; not sticky; "title+subtitle two-line buttons are NOT achievable via theme") | — |
| SRC-J | "Add a bottom of the page template management. this is seperate template element, and should include - free text (rich toolbar), links to legal pages (from the 'pages' tab) that the user is choosing, Logo, company details and other elenments. this template element could use different color, font and sizes then the main template" | ④ element J = upgrade of Footer G in place | P3 | P3 pack (async) + `Image28.png`/`Image45.png` | DEVIATES(probe 7a: "MISSING: rich-text toolbar (plain textarea), Pages-tab link picker …, independent font family") | — |
| SRC-R1 | "templates canvas non-functional" | ② rebuild proves the rejection point closed | P2 | P2 pack (async) | DEVIATES(probe 5a/5b/5c) | — |
| SRC-R2 | "themes tab layout (left section chooser by activity/vertical, sticky center canvas, right design elements, no duplicate canvases)" | ③ rebuild proves the rejection point closed | P2 | P2 pack (async) | DEVIATES(probe 6a: single column; two canvases; not sticky) | — |
| SRC-R3 | "footer element J" | ④ proves the rejection point closed | P3 | P3 pack (async) | DEVIATES(probe 7a: G ≠ J) | — |
| SRC-R4 | "sliders broken vs Image9–14 and picker ≠ render" | ⑤ proves the rejection point closed | P4 | P4 pack OWNER-BLOCKING | DEVIATES(probe 2b: 4/5 renders deviate) | — |
| SRC-R5 | "question grid 'not even close'" | ① proves the rejection point closed | P1 | P1 pack OWNER-BLOCKING | DEVIATES(probe 1: container model absent) | — |
| SRC-R6 | "address 'none of the issues fixed'" | ⑥ proves the rejection point closed | P5 | P5 pack (async) | DEVIATES(probe 3: composite/DEFAULT/zip5 deviate) | — |

## ADJ rows — adjacent defects (probe + replay verbatim anchors; fix ALL, none deferred)

| ID | Anchor (probe/replay verbatim) | Fix | Phase | Status | Evidence |
|---|---|---|---|---|---|
| ADJ-B1 | "every well-formed draft quote shows 'Blocked (N errors)' and activation 409s (quote_activation_blocked) with NO reason surfaced anywhere in the UI" | S0-B1: root-cause BOTH surfaces (silent preflight render AND wrongful block decision); well-formed quote activates OR reasons surfaced+addressable | P0 | DEVIATES(probe B1 SEVERE; replay: state-specific — a minimal well-formed quote DID activate, reinforcing the both-surfaces mandate) | — |
| ADJ-A1 | "dependency-hidden question keeps its visible label while the control hides" | label hides with control | P1 | DEVIATES(probe A1) | — |
| ADJ-A2 | "Silent zip5 block: no error text anywhere (aria-invalid red border only)" | visible zip5 message | P5 | DEVIATES(probe A2) | — |
| ADJ-A3 | "Default-choice select ignores in-session choice edits until save+reload" | live default control; fail-before/pass-after regression | P1 | DEVIATES(probe A3) | — |
| ADJ-A4 | "Rule-builder 'when' list mislabels the first question with the SECTION HEADLINE" | question label in when-list; regression; extends to every sibling via props.label (replay R2) | P1 | DEVIATES(probe A4) | — |
| ADJ-A5 | "Studio 'No issues' chip vs server-only icon rule → save 400 the operator can't predict" | surface server rule in issues chip | P5 | DEVIATES(probe A5) | — |
| ADJ-A6 | "No standalone Phone component (Contact stack only)" | D6: surface Phone palette tile (reuse type+mask) | P5 | DEVIATES(probe A6; D6 RULED yes) | — |
| ADJ-A7 | "empty-label value rows silently dropped on save; unstyled truncated native select 'Choose..'" | preserve-or-reject with message; style select; regression | P5 | DEVIATES(probe A7) | — |
| ADJ-A8 | "Address inspector shows a 4-field set for a component whose visitor render is one bare input (inspector/product mismatch)" | subsumed by SRC-6 composite-by-default (D3) | P5 | DEVIATES(probe A8 — closes with SRC-6) | — |
| ADJ-A9 | "Maps-enabled section requires picking a 'job' at activation (409) — friction/discoverability" | preflight UX + keyless honesty | P5 | DEVIATES(probe A9) | — |
| ADJ-A10 | "Activity/vertical lists start EMPTY locally; '+ create' flow works but with raw JS prompts" | studio modals replace prompt() | P2 | DEVIATES(probe A10) | — |
| ADJ-B2 | "Template 'Set as default' is global across all quotes (owner decision: intended?)" | D5: per-quote default table (migration 0055) + global fallback | P2 | DEVIATES(probe B2; D5 RULED per-quote) | — |
| ADJ-B3 | "At 1600–1680px the 3rd funnel card is occluded by the fixed rules rail" | responsive fix; regression at 1600/1640/1680px | P2 | DEVIATES(probe B3) | — |
| ADJ-B4 | "Funnel-card 'Template' chip: no observable effect (its Theme sibling navigates)" | wire or remove | P2 | DEVIATES(probe B4) | — |
| ADJ-B5 | "Themes canvas not sticky on a ~3,814px page" | subsumed by ③ sticky canvas | P2 | DEVIATES(probe B5 — closes with SRC-R2) | — |
| ADJ-B6 | "'Live server preview' chip is a no-op" | remove dead chip | P2 | DEVIATES(probe B6) | — |
| ADJ-B7 | "Templates canvas theme/section dropdowns each show 1 option with no affordance to create a theme from there" | real presets in dropdown + create affordance | P2 | DEVIATES(probe B7) | — |
| ADJ-R1 | "recorded answers change domain, so pre-existing conditionals / routing comparands / offer value_maps keyed on the authored values no longer match" | (a) P0 read-only production data-consistency inventory; (b) P1 invariant: 2-choice conversion preserves recorded values | P0 + P1 | DEVIATES(replay 2026-07-28; bench probes at mission-skill-bench/results/control-C-GRID/) | — |
| ADJ-R2 | "a rule authored on a question inside a grouped container never evaluates … while the identical flat control arm routes" | container-nested questions first-class across the field universe; two-arm routing drive | P1 | DEVIATES(replay: non-recursive seams named — fieldToPageIndex, computeResumeSection, checkpointKnownFields, answerFields/sectionFieldsByPublicId, sectionFieldLabels) | — |
| ADJ-R3 | "'Questions on one screen' always splices into state.content.components …, leaving a selected container empty" | starter honors the selected container | P1 | DEVIATES(replay) | — |
| ADJ-R4 | "'+ New template' posts boot.frame.effective_frame (the page-load snapshot) instead of the island's live draft" | template create serializes the live draft (myFrame) | P2 | DEVIATES(replay; fail-before/pass-after) | — |
| ADJ-R5 | "the Templates-tab preview request body omits site_id … the canvas renders the no-logo chip even when site_settings.logo_media_id is set" | preview body includes site_id (funnel.ts sibling is the working pattern) | P2 | DEVIATES(replay) | — |
| ADJ-R6 | "the no-sections preview error path calls showError('lg-tpl-canvas-status_UNUSED','') … a failed preview renders a blank canvas with no feedback" | real status id + visible message | P2 | DEVIATES(replay) | — |
| ADJ-R7 | "subsequent control edits send theme_id together with inline overrides and the validator rejects the combination, so theme controls stop applying" | normalize preset-based theme payload (validator = designs/theme.ts theme_id-exclusive branch) | P2 | DEVIATES(replay) | — |
| ADJ-R8 | "after a click the pixels show selection but aria-checked never updates — Yes/No, Buttons and Cards alike" | selection state reaches assistive tech | P5 | DEVIATES(replay) | — |
| ADJ-N1 | S0-C finding: "testRun.status_code, a field that does not exist on POST /offers/:id/test's real response (the status is nested at response.status)" — the Test-tool assertion in test-ui/leadgen-fix-p1-seed.ts is a silent no-op | OUT-OF-CONTRACT defect (in no owner clause) — surfaced for the owner's fix-or-defer ruling, never silently deferred | owner ruling | DEVIATES(found 2026-07-28 by the S0-C build; test-infra only, no product impact) | — |
| ADJ-N2 | Sweep-A finding: "aria-invalid never set on failed Phone/Email validation — setFieldError's querySelector targets a void input that can't have descendants" | OUT-OF-CONTRACT defect (a11y error signal; the owner's #5 demands the visible block, which works) — owner fix-or-defer; natural home = P5 beside A2's visible-message work if ruled fix | owner ruling | DEVIATES(found 2026-07-28 by sweep-A; visible block message itself works — see 4b-phone-mask-a-blocked-1280.png) | — |
| ADJ-N3 | Sweep-A finding: "raw-API PATCH /sections/:id … doesn't reliably propagate to live /lg SSR (40s+), Studio UI Save converged instantly" — scheduleSectionContentInvalidate called without await (sections-handlers.ts:1173, the fire-and-forget class) | OUT-OF-CONTRACT defect — owner fix-or-defer; natural home = P5 (sections-handlers.ts is P5-owned). Mission-operational rule meanwhile: API-authored drives poll for convergence before verdicts | owner ruling | DEVIATES(found 2026-07-28 by sweep-A; reproduced 8s+ no-convergence via curl poll) | — |

**Ground-truth refinement (S0-C, 2026-07-28 — binds P4/P5 payload-acceptance setups):** a live
`/lg/auction` calls a provider (and writes `leadgen_provider_request_log`) only when the offer is
wired into the AUCTION entity (`PUT /auctions/:id/offers` → `leadgen_auction_offers`) AND the offer
has a PASSED Test-tool run; the section-level `leadgen_section_answer_maps` rows are admin-side
config the live path does not read directly. The S0-C fixture seeds the full emitting chain. Every
P4/P5 payload-read acceptance setup must include the auction wiring + Test-tool pass, and P5's
SRC-7B/SRC-6B value_transform work re-verifies WHERE transforms apply on the LIVE path (the driven
three-format payloads are the proof either way).

## DEC rows — owner decisions (RULED 2026-07-28; all recommendations accepted verbatim)

| ID | Decision | Ruling | Where applied |
|---|---|---|---|
| DEC-D1 | Engine byte cap 51,200 → 53,248; ledger grid ≤250 / sliders ≤1,500 / other ≤250 / reserve 415; overflow = owner cap decision | RULED 2026-07-28 (yes) | P0 S0-D up-front |
| DEC-D2 | Element-J legal links | RULED (per-site pages resolved at serve time + manual fallback) | P3 S3b |
| DEC-D3 | Address default when unconfigured | RULED (full 4-field composite) | P5 S5a |
| DEC-D4 | Per-question style-deviation axes | RULED (reuse full per-section override axes incl. free colors) | P1 |
| DEC-D5 | Template default scope | RULED (per-quote default table, migration 0055, global fallback; seeds NEW funnels only) | P2 S2c |
| DEC-D6 | Standalone Phone tile | RULED (yes — surface tile, reuse type+mask) | P5 S5c |
| DEC-D7 | Grid data model | RULED (container node whose children are EXISTING question node types; content_json; NO migration) | P1 S1a |
| DEC-D8 | Maps keys | RULED+AMENDED 2026-07-28: production carries GOOGLE_MAPS_BROWSER_KEY + GOOGLE_MAPS_SERVER_KEY (verified via wrangler secret list); no owner action; autofill leg INCONCLUSIVE-pending-key locally, MUST-RESOLVE post-deploy | P5 / P6 |
| DEC-D9 | Currency-string exact byte shape | RULED (visitor-facing `$170,000` — asserted verbatim in the P5 SRC-7B acceptance) | P5 |
| DEC-D10 | P1 + P4 packs OWNER-BLOCKING | RULED (yes; owner-directed-fix loop on reject) | P1 / P4 gates |

## GATE rows

| ID | Anchor | Requirement | Phase | Status | Evidence |
|---|---|---|---|---|---|
| GATE-INCONC | "show in CA this section in this page" + D8 Maps autofill leg (`Image8.png`) | The two MUST-RESOLVE INCONCLUSIVE rows (SRC-11C-B state=CA live-geo; SRC-6 autofill) are verified post-deploy in the cutover sitting or owner-waived in writing — never silently closed | P6 | INCONCLUSIVE(step: post-deploy cutover sitting — named steps + named evidence per Plan P6 checklist item 2) | — |

## Phase tracker (conductor-written at each merge)

| Phase | Scope | State | Branch | Merged sha | Review verdict | Pack | Cost (tokens / duration) |
|---|---|---|---|---|---|---|---|
| P0 | Step 0 + S0-B1 + S0-C + S0-D + baseline sweep + R1a | IN FLIGHT | leadgen-r2-p0 | — | — | async | — |
| P1 | ① Question-Grid | pending | — | — | — | OWNER-BLOCKING | — |
| P2 | ② Templates + ③ Themes | pending | — | — | — | async | — |
| P3 | ④ Footer J | pending | — | — | — | async | — |
| P4 | ⑤ Sliders | pending | — | — | — | OWNER-BLOCKING | — |
| P5 | ⑥ Address + SRC-7B/6B + adjacents | pending | — | — | — | async | — |
| P6 | Terminal + cutover | pending | — | — | — | owner gates 4–5 | — |
