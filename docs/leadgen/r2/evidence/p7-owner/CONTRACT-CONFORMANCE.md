# CONTRACT CONFORMANCE — the deployed build, clause by clause

Read-only documentary audit. **Nothing was run**: no server, no suite, no database. Every verdict
below is either (a) settled by reading the shipped source, or (b) explicitly marked **NEEDS-DRIVE**
where only driving the product can settle it.

- **Tree audited:** `kodigital-cms-leadgen-r2-wt`, branch `reconcile/conversions-x-leadgen-r2` @ `e3dc4c3`
  — the code now deployed to production.
- **Authority:** `docs/leadgen/source-of-truth/SOURCE-OF-TRUTH.md` (the owner's verbatim words).
- **Contract:** `LEADGEN-R2-FIX-CONTRACT.md` §1–§9 (binding body ends at `# BINDING TEXT ENDS HERE`).
- **Register:** `docs/leadgen/source-of-truth/traceability.md` — **every PASS treated as an unproven
  claim**, never as evidence.
- All file paths below are relative to `api/` unless stated.

**Every line number below was re-verified against committed `HEAD` (`git show HEAD:<path>`), not the
working tree.** A concurrent agent has UNCOMMITTED fixes in flight in the same worktree — at the time
of writing its diff already re-letters the footer tile `G → J` and extends the publish chip. Those
are working-tree changes only; **the deployed build is `HEAD`, and at `HEAD` the footer is `G` and the
chip is a bare span.** Rows this affects are marked *(fix in flight)*.

**Reconcile-merge check (done first, so the rest of this document is valid):** `git diff
leadgen-r2..HEAD -- api/src/public/leadgen api/src/admin/leadgen` touches 18 files, **none of them**
`templates.ts`, `themes.ts`, `funnel.ts`, `presets.ts`, `frames.ts`, `frame.ts`, `theme.ts` or
`ui-section-studio.ts`. The Conversions reconciliation did not move any owner-clause surface, so the
conformance verdicts apply to the deployed build exactly as they would to `leadgen-r2`.

**The bar applied.** A control that renders, saves and persists is not conformance. A verdict of
CONFORMS requires the sentence's *effect* to have a real consumer in the shipped path. Existence of a
renderer, a schema, a grep hit or a green test is never treated as proof.

---

## 1 · Counts

| | |
|---|---|
| Clauses examined (owner sentences + contract end-state items) | **84** |
| **CONFORMS** | **56** |
| **PARTIAL** | **16** |
| **ABSENT** | **4** |
| **NEEDS-DRIVE** (cannot be settled by reading code) | **8** |

---

## 2 · Clause-by-clause map

Legend — **CONFORMS**: the sentence's effect has a real consumer in the shipped path.
**PARTIAL**: built, but the sentence is only partly satisfied. **ABSENT**: no implementing surface.
**NEEDS-DRIVE**: the code is consistent with the demand but only driving settles it.

### A.1 #1 — "Question grid" (the container component)

| Clause | Owner's words (quoted) | Contract end state | Code surface (file · symbol) | Verdict | What is missing |
|---|---|---|---|---|---|
| SRC-1a | "you can't treat the whole component as one unit that is providing an answer to one filed, labled as one unit, measured as one unit and routing the user as one unit" | ONE container node whose children are independent-field questions (§2 item 1, D7) | `src/public/leadgen/components/registry.ts:135` `QuestionGrid` (category `question_group`, `children[] (question components only)`); studio `src/admin/leadgen/ui-section-studio.ts:2494` `[data-content-questiongrid-block]`; palette label `:351` `QuestionGrid: { label: "Question grid" }` | **CONFORMS** | — |
| NEW-1 | "providing us another input on the user for the **analytics**" | §2 item 2: each question records to its own field for "offers/analytics/routing" | Reader only: `src/admin/leadgen/sections-handlers.ts:2558–2615` selects `leadgen_analytics_answer_distribution`; the writer is the ClickHouse→D1 mirror, outside this worker | **NEEDS-DRIVE** | Offers and routing are wired; nothing in-repo shows a grid child's `question_key` reaching the distribution table. |
| SRC-11C-R (grid leg) | "help us to decide the user jurney (the funnel) by the funnel rule (for example, homeowner=yes -> funnel name=x…)" | checkpoint-plane routing keyed on a grid sub-question field | `src/public/leadgen/resolver.ts` `evaluateQuoteCheckpointRouting`; `src/public/leadgen/runtime-routes.ts` `recordRoutingOutcome`; `src/leadgen/auction-rules.ts` `conditionsMatch` | **CONFORMS** | — |
| SRC-1b | "inefendent **defaults!!** (right now only the first question has option for default)" | per-question default; a default counts as answered | grid row Default control (`ui-section-studio.ts` grid row builder); `src/leadgen/answers.ts` `normalizeAnswers` with `answer_source` (`default_applied`/`user_confirmed_default`); `src/public/leadgen/config-dto.ts` `defaultValue` projection | **CONFORMS** | — |
| SRC-1c | "if the user wants to deviate from the theme - independent style" | D4: full per-section override axes incl. free colours, per question | `ui-section-studio.ts:94` `COLOR_TYPED_OVERRIDE_KEYS`, `:1806`, island `:4409` `COLOR_OVERRIDE_KEYS = ['iconColor','featureColor','rangeColor','buttonBackground','buttonText']`; render consumer `presets.ts` `ovColor(node, …)` | **CONFORMS** | — |
| SRC-1d | "independent **rules**!" | per-question dependency authored in QUESTION terms, type-agnostic both sides | grid row dependency editor `ui-section-studio.ts:2508–2509` (`[data-grid-op-proto]`, `GRID_OP_OPTION_HTML`); runtime `src/public/leadgen/runtime/dependencies.ts` | **CONFORMS** | — |
| SRC-1e | "you left a lot of dead parts- … why did you kept the main 'Helper text'? … why you kept main 'Answer format'? what is it 'sub questions'???? there is no 'Main question'!!!" | no shared Helper/Answer-format/sub-questions/Main-question in the component editor | `ui-section-studio.ts:2485–2508` — the grid block carries a questions list and nothing else; the strings survive only on OTHER component editors (`:514` `{key:"helper", label:"Helper text"}`, `:2627` `Answer format` eyebrow), which the owner's sentence does not cover | **CONFORMS** | — |
| SRC-1f | "the '+Add a question' button … should be small, **out of the component** and not to affect the componenent size/ structure!!!" | small, OUTSIDE, non-widening | `ui-section-studio.ts:2503–2505` `[data-grid-add-question]` inside `.studio-add-ghost-row`; canvas twin `decorateChoiceCards` `:6634` inserts the ghost as a sibling after the component root; CSS `:1189–1193` | **CONFORMS** | — |

### A.1 #2 — the reference behaviour (Image2 / Image3)

| Clause | Owner's words | Contract end state | Code surface | Verdict | What is missing |
|---|---|---|---|---|---|
| SRC-2a | "the question is marked/checked and only being tracked after the user is clicking 'continue' … if the user is overiding the default, the user answer is the one that is being saved" | mark-then-continue; override wins | `src/public/leadgen/runtime/engine.ts` record-on-click + Continue validates/advances; `src/leadgen/answers.ts` `normalizeAnswers` `answer_source: user_selected` | **CONFORMS** | — |
| SRC-2b | "the 'credit score' question is a dropdown element - the user shuold be able to choose the wanted element per question" | mixed types per question inside one container | `ui-section-studio.ts:2507` `[data-grid-type-proto]` fed by `GRID_QUESTION_TYPE_OPTION_HTML` | **CONFORMS** | — |
| SRC-2c | "if we set a 'default' and the user didn't change it - this is his answer and the 'required' rule is met. but if the user clicked 'no' … we need to ignore this question- it isn't relevant, so it doesn't exist and the answer is not required" | required-with-default; dependency-hidden ⇒ not required, not validated, not persisted; label hides with the control | `src/public/leadgen/runtime/{dependencies,validation}.ts`; server-side visibility gate in `src/leadgen/answers.ts` | **PARTIAL** | Register row ADJ-N9 records that the server gate governs **defaults only** — a submitted value for a dependency-unmet question is still trusted, so "it doesn't exist" holds for real browsers but not for the money path against a crafted POST. |
| NEW-2 | "the user can't click continue unless he answers this quesion" | required blocks Continue when the dependency IS met | `src/public/leadgen/runtime/validation.ts` | **NEEDS-DRIVE** | The register's SRC-2c PASS text never names this leg; its only record is a pre-R2 baseline probe. |

### A.1 #3 — "applied on all the components"

| Clause | Owner's words | Contract end state | Code surface | Verdict | What is missing |
|---|---|---|---|---|---|
| SRC-3 | "The logical flow I described above should be applied on all the components, you are not allowed to take care only in this component and ignore the rest of the components as you did with the (bad) solution for the '+ add a question' where you (poorly) fixed it for one component and ignored the rest" | the outside-add-affordance rule proven on the full `registry.ts` roster (§2 item 4, ~20 enumerated entries) | `ui-section-studio.ts:6634` `decorateChoiceCards` is **type-generic** — it walks every `[data-question-id]` and gates on `typeMeta(...).choice === true`, so the ghost is structurally universal rather than per-type | **PARTIAL** | The add-affordance half is generic and sound. The owner's sentence is "**the logical flow** I described above" — independent fields, defaults, dependencies — and that flow exists **only inside the QuestionGrid container**: outside it, dependencies are still section-level element `conditional`s, not per-question rules. No clause row carries the wider reading. |

### A.1 #4 — the check mark

| Clause | Owner's words | Contract end state | Code surface | Verdict | What is missing |
|---|---|---|---|---|---|
| SRC-4 | "here is another buttons structure we need to support for the 'Question grid' buttons (the √ inside the button for the chosen answer)" | ✓ inside the selected button | `src/public/leadgen/components/presets.ts:489–523` `selectedMarkerMarkup` (`lg-check-hollow` resting + `lg-check-badge` filled), per-node `selected_marker` overriding the theme | **CONFORMS** | — |

### A.1 #5 — the phone format

| Clause | Owner's words | Contract end state | Code surface | Verdict | What is missing |
|---|---|---|---|---|---|
| SRC-5 | "somthing like field that looks this way (3)-3-4 … the numbers are dynamic, the put the numbers and it converted to this format - (___)-___-____ and if the user define it this way - (2)-4-1 so the format is (__)-____-_" | operator-defined digit-group mask; incomplete input blocks Continue | `ui-section-studio.ts:2271–2289` `renderPhoneFormatControls` (Format input, live scaffold preview, prefill chips, incomplete message `:2286`); grammar `parsePhoneMaskPattern` | **CONFORMS** | — |
| NEW-3 | "you took it litteraly and added 'Israel' as an option, just ridiculous" | the country-preset option is gone from authoring | `ui-section-studio.ts:2263–2270` states the country-preset trio + raw-regex path are **removed from the editor**; `config-dto.ts:300` / `content-schema.ts:316` keep an `il` preset as a **schema back-compat seam only** (nothing authors it) | **CONFORMS** | Residual only: the enum value still exists for legacy content. Not operator-visible. |
| NEW-4 | "even more ridiculous is the fact that the 'costume' answer isn't functional" | a custom format is functional | the Format input IS the custom path (`data-phone-mask-pattern`), validated with a verbatim error and refused on save | **CONFORMS** | — |

### A.1 #6 — the address

| Clause | Owner's words | Contract end state | Code surface | Verdict | What is missing |
|---|---|---|---|---|---|
| SRC-6 (a) | "if I want it as a free text without validations or auto fill?" | free-text-only address renders one box, no validation | `presets.ts` `readAddressFieldSpecs` `:3001` / `renderAddressFieldSet` | **CONFORMS** | — |
| SRC-6 (b) | "if I want only street address?" | street-only subset | same | **CONFORMS** | — |
| SRC-6 (c) | "if I want to auto fill only for street address and city and I want the user will insert the Zip by himself but to validate the Zip in a 5 digits zip validation?" | per-field autofill/manual mapping + zip5 with a **visible** message | `presets.ts:3050` `ADDRESS_DEFAULT_FIELD_SPECS`; per-sub-field error slot (`[data-lg-error-for="{base}_{kind}"]`, the P6-FIX-1 one-key-one-slot fix); `runtime/validation.ts` zip5 | **PARTIAL** | The manual-ZIP + visible-message half is real. The **street+city autofill half needs a live Google Maps key** and is carried as GATE-INCONC "MUST-RESOLVE post-deploy". **The build is now deployed and that gate has not been closed.** |
| SRC-6 (d) | "the mapping of what is auto-filled per field should definatly be an option" | per-field Mode option | `content-schema.ts` `LEADGEN_ADDRESS_FIELD_MODES`; keyless degrade `src/leadgen/maps.ts` + `runtime/maps.ts` | **CONFORMS** | — |
| ADJ-N28 | "Look at the screenshot! **I didn't even checked the 'Maps' feature!!!!**" (Image8) | conductor ruled: Image8 is the screenshot of the REJECTED build; the "Start typing your address…" box was deliberately NOT added | recorded ruling; no autocomplete input above the four fields | **NEEDS-DRIVE / owner-eye** | A conductor ruling stands in for an owner decision. Surfaced honestly, but unresolved. |
| SRC-6B | "every component that include more than one field- each field is potentially answering another offer field in different formats per offer!!!" | one sub-field → two offers in two formats, authored by clicking | `src/leadgen/answers.ts` `fieldsOf` as the one canonical derivation; offer picker projects it; `src/leadgen/payload.ts` `applyTransformPipeline` | **PARTIAL** | Register row ADJ-N34 records that `NameFieldsGroup` still projects **unprefixed** `first`/`last` keys, so two name groups in one section collide — the same multi-field class the owner's sentence names, left unfixed. |

### A.1 #7 — the sliders

| Clause | Owner's words | Contract end state | Code surface | Verdict | What is missing |
|---|---|---|---|---|---|
| SRC-7 (A) | "You must give the user the option to pick his desired slider from sliders list!!! the slider type is **not** a theme decision!!!" | five types pickable in the section studio; zero slider-type controls on any theme surface | `content-schema.ts:352` `LEADGEN_SLIDER_TYPES`; picker `ui-section-studio.ts:2294+` `renderSliderTypePicker` writing `props.slider_type`; renders `presets.ts:1004` `renderRange`, `:1098` `renderStepperRange`, `:1153` `renderDualTrackRange` (from_to + dual_range), `:1223` `renderRadialRange` | **CONFORMS** | — |
| **NEW-7** | "theme is only design language!!!! **colors, fonts, sizes**" — the positive half of the same sentence, and the ruling P6-FIX-6/7 were fixing | a theme's colour, font and **size** controls must actually paint | `theme.controls.corners` **is** now consumed (the R2 F-1 bridge, `theme.ts:1168–1181` `safeRecordCorners` → `applyRadiusScale`) and `field_height` is consumed (`presets.ts:2231`). **`theme.controls.button_size` is not.** It is written by `ui-theme-manager.ts:914`, validated at `themes-handlers.ts:203–220`, KV-shape-gated at `theme-store.ts:88`, resolved onto `EffectiveTokens.theme_controls` and threaded into `LeadgenSectionRenderCtx` — and the only function that receives `theme_controls` is `resolveFieldSize`, whose own doc at `content-schema.ts:668–672` states verbatim that `button_size` "**are not consumed by this resolver**". Every other hit in `src/` is a declaration, validator, comment or the literal default `presets.ts:2163` | **PARTIAL** | **The exact twin of the Corners defect the owner's own terminal review caught, in the same three-arm control group, still live.** An operator picks a Button size on a theme preset, it saves and persists, and no painted component reads it. |
| SRC-7 (anatomy) | Image10–Image14 anatomy | the §6.8 anatomy in use for all five | `presets.ts:1030–1054` emits `lg-range-value` / `lg-range-track` / `lg-range-fill` / handle / `rangeMinMax` captions | **CONFORMS (code)** / **NEEDS-DRIVE (fidelity)** | Whether the painted result matches Image10–14 is a pixel judgement no static read can make. Note the class vocabulary is `lg-range-*`, not the design-pack's `slider-*` — a doc/product pin mismatch (ADJ-N23), not a product defect. |
| ADJ-N21 | Image11 shows the value **below** the handle; §6.8 puts the readout **above** | owner picks | `presets.ts:1030` readout emitted before the track | **NEEDS-DRIVE / owner-eye** | Open owner decision, correctly surfaced, never resolved. |
| SRC-7 (B) | "if I add a '$' I can't save the section because of conflict between 'number' and 'currency' … the currency is only a graphic feature" | `$` display-only, never touching `node.type`/`answer_type` | `content-schema.ts` `currency_affix`; picker comment `ui-section-studio.ts:2292–2296` ("NEVER touches node.type / answer_type") | **CONFORMS** | — |
| SRC-7B | "I can define that I want the currency will be passed to the offer in the auction and I can define that only the number is sent, and I can define that the number will be sent as string" | three output formats per offer via `value_transform`, authored by clicking | `src/leadgen/payload.ts` `LEADGEN_TRANSFORM_KINDS` + `applyTransformStep`; control in `src/admin/leadgen/ui-payload-builder.ts` | **CONFORMS** | — |
| NEW-5 | "so your conflict here, **and in any other component with the same dependency**, is just a low level slopy logic" | the display-vs-answer-type conflict class eliminated everywhere, not only on sliders | no surface | **ABSENT** | No row and no code sweep states whether any sibling component still carries a display-affix-vs-`answer_type` dependency. ADJ-N24 is a different defect (a duplicated node-type list). |

### A.1 #8 / #9 / #10 — Other group, cards, dropdown

| Clause | Owner's words | Contract end state | Code surface | Verdict | What is missing |
|---|---|---|---|---|---|
| SRC-8 | "I want to add 'other' group - a dropdown element, inside the button … C. I need to have fields to add the dropdown values. D. The same should apply for 'Cards' as well" | authored-Other = a real `<select>` of operator values, on Buttons AND Cards, not overriding the other buttons | `presets.ts:470` `<select class="lg-input lg-other-select" data-lg-other-panel>`; triggers `:1476` (buttons) and `:1700` (cards); values editor `ui-section-studio.ts:2705` | **CONFORMS** | — |
| SRC-9 | "why the cards are aligned to the left and the '+ add choice' is inside the component and widening it???" | cards centred; add-choice outside | `decorateChoiceCards` `:6634` sibling ghost; card grid centring in `designs/default-funnel/styles.ts` | **NEEDS-DRIVE** | Centring is a painted property. The register's SRC-9 evidence is a single 1600 studio capture showing two cards where the owner's Image16 shows five. |
| SRC-10 | "dropdown component - why is there 'enable other group'??? what does it even mean????" | the block is gone from the dropdown editor and from the Offers payload builder | one `Enable "Other"` control survives at `ui-section-studio.ts:2705`, gated by the §6.2 capability matrix (dropdown types do not carry the capability); zero `data-pb-field="otherGroupEnabled"` in the payload builder | **CONFORMS** | — |

### A.1 #11A / #11B

| Clause | Owner's words | Contract end state | Code surface | Verdict | What is missing |
|---|---|---|---|---|---|
| SRC-11A | "I chose a site - why I don't see its logo????" | an authored `site_settings.logo_media_id` resolves and renders in the canvas | `src/leadgen/branding.ts` `resolveSiteBranding` logo ladder; `designs/frame.ts:97` `LOGO_FALLBACK_CHIP_TEXT` shown only when genuinely logo-less; preview body carries `site_id` (`templates.ts` `#lg-tpl-site-select` `:804`) | **CONFORMS** | — |
| SRC-11B | "the 'themes' and the templates are moving to the top bar, why you kept the old and wrong option in the funnel builder??????" | top-bar-only; the builder chip navigates, never edits inline | `src/admin/leadgen/ui-quotes.ts:750–757` tab bar (`builder / templates / themes / ab / activation / analytics`); builder chip `funnel.ts:447` `[data-theme-picker]` navigates | **CONFORMS** | — |

### A.1 #11C — the funnel builder

| Clause | Owner's words | Contract end state | Code surface | Verdict | What is missing |
|---|---|---|---|---|---|
| SRC-11C-N01 | "there is no 'control' funnel!!!" | no control-funnel concept in the builder | grep of `funnel.ts` returns no `Control` / `Varient` operator-visible string; only the internal `isControl` flag | **CONFORMS** | — |
| SRC-11C-N02 | "the first page is shared by **all** the funnels" | one shared first page column | `funnel.ts:368–369` `Shared · quote-owned` / `Shared first page` | **CONFORMS** | — |
| SRC-11C-N03 | "we can do AB test for this page as well!" | the shared first page is A/B-able | shared-column chip kebab → slot A/B editors (`funnel.ts:4510–4511`) | **CONFORMS** | — |
| SRC-11C-N04 | "kick out all the stupid and unusable components from the 'Funnel builder' - the canvas, the canvas controllers on the top, the varient" | none of them render in the builder | `renderBuilderPanel` `funnel.ts:669–720` emits board + library + rules rail + dialogs only — no iframe, no toolbar, no variant widget | **CONFORMS** | The *code* for those widgets is still shipped but unreachable — see §4. |
| SRC-11C-N05 | "add in the left side all the available sections in draggable boxes" | left library, draggable | `funnel.ts:240` `.lg-lib-card[data-lib-card]` with a drag grip | **CONFORMS** | — |
| SRC-11C-N06 | "in the middle create different funnels side by side and drag sections boxes to the page of the wanted funnle" | funnels side by side; drag persists | board columns + `slotToPut` chain (`funnel.ts:4694`) | **CONFORMS** | — |
| SRC-11C-N07 | "add button of 'add funnel', user should be able to add as many funnel he wants" | unbounded `+ Add funnel` | `funnel.ts:461–464` `[data-add-funnel]` `+ Add funnel` | **CONFORMS** | — |
| SRC-11C-N08 | "why the user can choose the same page more than ones in the same funnel???" | refused with a message | `src/admin/leadgen/quotes-handlers.ts:2327` — `'{section}' is already in this funnel — a section can appear once per funnel.` | **CONFORMS** | — |
| SRC-11C-N09 | "the routing rules table has got out of its box - disaster!!!!!!" | the rail stays in its box at every width | `funnel.ts:696` `<style data-pin="r2-b3-rail-fix">.lg-board-right{min-width:0}</style>`, rail `:708` | **CONFORMS** | — |
| SRC-11C-N10 | "Unified the 'Rules' with this tab and show them in the right side" | rules inside the funnel tab, right side; no standalone Rules tab | `funnel.ts:708` `.lg-board-right[data-rules-rail]`; `ui-quotes.ts:750–757` has no `rules` tab | **CONFORMS** | — |
| SRC-11C-N11 | "the rules you build are using jargon, have no actions" | plain-language sentences with actions | rules modal + card in `funnel.ts` / `ui-rules-builder.ts` | **PARTIAL** | ADJ-N8 (unfixed): the rules-rail card still renders the raw choice **value** (`"… is excellent_rvw7q3"`) on the VALUE side — the field side was fixed, the value side was deferred. That is literally the jargon the owner named. |
| SRC-11C-N12 | "Image42 here it how it builds in the reference" | the rule builder matches Image42 | `n12-rule-builder-modal-1280.png` produced a comparison, not a verdict | **NEEDS-DRIVE / owner-eye** | Named differences remain (one-line vs 5-row conditions, an extra Operator + Value-type select, a Match ALL/ANY segment Image42 does not expose). |
| SRC-11C-A | "the order of the pages could be changed and not only what pages we show per funnel name" | reorder by drag and by menu, persisted | `funnel.ts:4052` `movePage`, `:4513–4514` `page-up`/`page-down` | **CONFORMS** | — |
| SRC-11C-B | "each page could include more than one section and we should be able to A/B test or creating in-funnel rules (show in CA this section in this page, and in the rest show this sectio, for example)" | multi-section pages; per-slot A/B + ruled slots | slot model `funnel.ts:568`; ruled/AB editors `:4510–4511`; `ENTRY_KNOWN_SLOT_FIELDS` incl. `state` (`resolver.ts:107`) | **PARTIAL** | Everything authorable is built; the **`state=CA` live-geo leg** is GATE-INCONC "MUST-RESOLVE at the cutover sitting". **The build is deployed and that gate is still open.** |
| SRC-11C-C | "The AB test can be also in the funnel level and not only in the page level" | funnel-level A/B, both arms served | `traffic_allocation_bp` `funnel.ts:346`; fork `#lg-add-variant` (`ab.ts:162`) | **CONFORMS** | — |
| SRC-11C-D | "Theme picker per funnel name" | a theme picker per funnel column | `funnel.ts:447` `[data-theme-picker]` per column; `frame_overrides_json.theme_id` `:2900`/`:2943` | **CONFORMS** | — |
| SRC-11C-R | "the funnel is decided per user answers durring the questionarie or per the user parameters (UTMs/ Claudflare data such as device/os/time/day and so on)" | both routing planes | `resolver.ts:1370` entry plane / `:1420` checkpoint plane; outcomes in `leadgen_routing_outcomes` | **CONFORMS** | — |
| NEW-6 | "why I need the canvas in the middle of the page?? … why do I need it?" (of the FUNNEL BUILDER) | no canvas in the builder | the builder emits none — **but** `funnel.ts:3179–3651` still ships the whole canvas island (iframe, status, region-click, viewport toggle, step controls) and `schedulePreview()` still fires a real `POST /variants/:id/preview` on every frame/theme edit from 11 live call sites, discarding the response into a null element | **PARTIAL** | The owner cannot see it, but the deployed worker still pays the compose cost on every builder edit. See §4. |

### A.1 #11D — the Templates tab

| Clause | Owner's words | Contract end state | Code surface | Verdict | What is missing |
|---|---|---|---|---|---|
| SRC-11D (layout) | "'The funnel layout elements (A)' should be aligned to the left, the funnel elemnts settings (B) shuold be aligned to the right, and in the middle should be a *CANVAS* so the user will see what he is designing!!!" | 3-pane: elements LEFT, canvas CENTER, settings RIGHT | `templates.ts:2225–2238` — `.lg-tpl2-left` → `renderElementsList()`, `.lg-tpl2-center` → `renderCanvas()`, `.lg-tpl2-right` → `renderSettingsColumn()` | **CONFORMS** | — |
| SRC-11D (canvas) | "the canvas should include one section in the middle so the user could see a real reference of how is design is gonna look like in real life" | one real section rendered mid-frame, on EMPTY and populated funnels | `templates.ts:809` `#lg-tpl-canvas-iframe`; ONE preview path (`POST /variants/:id/preview`); empty-funnel sample composed through the real frame (`quotes-handlers.ts:4492+`) | **CONFORMS** | — |
| SRC-11D (themes) | "and to swich 'Themes' so he will see how it looks on different themes designs" | in-canvas theme switcher offering the real presets | `templates.ts:797` `#lg-tpl-theme-select` + `:800` `+ New theme…` | **CONFORMS** | — |
| SRC-11D-N01 | "I should be able to create as many templates I want, to save them, and to use them as presets in different 'Quotes' - it isn't possible in the current state" | unlimited templates; cross-quote presets | `templates.ts:827–842` template bar (`#lg-tpl-new-btn`, `#lg-tpl-apply-btn`) | **CONFORMS** | — |
| SRC-11D-N02 | "The user should be able to define the 'default' template, but to A/B test different templates" | per-quote default (D5, migration 0055) + template A/B | `#lg-tpl-ab-btn` `:840`; `PATCH /quotes/:id {default_template_id}` | **CONFORMS** | — |
| SRC-11D (progress) | "Add a 'I' 'funnel layout element' - progress bar - I clearly explained that I want different types of progress bars and to design them with a dedicated box!" | element **I** = Progress, five styles, dedicated design box | `templates.ts:747` `{ key:"progress", letter:"I", label:"Progress" }`; `:708–735` `renderTplBoxProgress` with `:667` `renderProgressTypePicker` (radiogroup) over `frames.ts:57` `FRAME_PROGRESS_STYLES` (bar/dots/numbered/percent/icon_on_track) + Position/Alignment/Thickness/Width/Color/Label | **CONFORMS** | The owner's element letter **I** is honoured exactly. |
| **SRC-11D (A–I reflect)** | "so the user will see what he is designing!!!" | §3 item 2: "**Every** Funnel-Layout element visibly updates the canvas the moment it is edited — Background (A) … Brand logos (**F**) … Progress (I)" | `onFrameKeyChange → setPath(myFrame,…) → scheduleCanvasPreview` (`templates.ts:1588+`) | **PARTIAL** | **Element F carries a dead control.** `frames.ts:452` declares `FrameBrandLogoItem.size` and `templates.ts:345` renders a Size `<select data-bl-item-size>` per logo, collected and hydrated at `funnel.ts:2440`/`:2471` — but `frame.ts:731–748` `renderBrandLogos` maps each item to `{ mediaId, alt }` and **drops `it.size`**, and `styles.ts` has no size class (only `--row`/`--grid`). Editing an F item's Size changes nothing, in the canvas or live. Also on **element A**: `FRAME_BACKGROUND_STYLES` offers flat / brand / brand_gradient, but `styles.ts:2383` emits a rule only for `brand_gradient` — flat and brand fall through to the same rule, so two of the three options paint identically. |

### A.1 #11E — the Themes tab

| Clause | Owner's words | Contract end state | Code surface | Verdict | What is missing |
|---|---|---|---|---|---|
| SRC-11E (layout) | A.3: "left section chooser by activity/vertical, sticky center canvas, right design elements, no duplicate canvases" | three panes, one canvas, sticky | `themes.ts:759–774` `.lg-theme-3pane` → `renderSectionChooserPane()` `:263` (search + `[data-lg-theme-filters]` pills) · `renderThemeCanvasPane()` `:287` (`position:sticky;top:84px`, one `#lg-theme-canvas-frame`) · `renderThemeRailPane()` `:313`; `themes.ts:25` records the `?embed=1` iframe removed | **CONFORMS** | — |
| SRC-11E (real section) | "Add a real section to the canvas to the user could actually see the design he creates" | a real chosen section renders under the draft theme | left chooser sets the preview target; canvas fed by the tab's own script | **CONFORMS** | — |
| SRC-11E (buttons) | "the buttons design not rich enough, I should be able to decide from rich veriaty of buttons, for example - Image23" | full-width two-line title+subtitle cards achievable via the theme | `themes.ts:198` `Answer layout` → `card: "Full-width cards (Image23)"`; per-choice `title`/`subtitle` in `presets.ts:598–617` | **CONFORMS** | — |
| ADJ-N41 | (admin surface) | — | theme-manager editor column measured 0px at 375 | **PARTIAL** | The same "invisible panel every suite stays green over" class that P6-FIX-5 fixed at 1280 survives at 375, unfixed. |

### A.2 — the footer / bottom-of-page element "J"

| Clause | Owner's words | Contract end state | Code surface | Verdict | What is missing |
|---|---|---|---|---|---|
| **SRC-J (identity)** *(fix in flight)* | **"this is seperate template element"** — and A.3 verbatim: **"footer element J"** | §5.4 minor-1 ruled the opposite: element J = **tile G upgraded in place**, one footer tile | `templates.ts:738–748` `TPLBOX_CARDS` = A Background · B Logo · C Phone/URL · D Disclosure · E Free text · F Brand logos · **G Footer** · H Images · I Progress. Panel heading `:530` `<h3>G &middot; Footer</h3>`. **The string "J" appears on no surface in `src/`.** | **ABSENT** | The owner asked for a **separate** element after I and calls it **J**; the product ships a re-labelled G and no tenth tile. Recorded as ADJ-N17 "owner fix-or-defer" and never fixed — this is the exact thing the owner has just re-reported. |
| SRC-J (rich text) | "free text (rich toolbar)" | rich-text blocks with bold/italic/links/headings/lists | `templates.ts:475–479` toolbar `data-footer-fmt="bold|italic|link"` (three buttons); heading is a separate block type with `:481` level 1–6 select; list is a separate block type with `:482` style + `:483` items | **CONFORMS** | Capability delivered. Note the toolbar itself has three actions — see §5 for the register's overstatement. |
| SRC-J (legal links) | "links to legal pages (from the 'pages' tab) **that the user is choosing**" | Pages-fed picker, per-serving-site resolution, manual fallback (D2) | `templates.ts:484–499` `linksource` = site / manual / **picked**, `[data-footer-picks-load]` → `:1433` `GET /sites/:site_id/legal-pages`; resolver `src/leadgen/branding.ts:349–360` over `LEGAL_PAGE_TYPES`; pick shape `frames.ts:249` (`page_type` + `slug` + `manual_url`) | **PARTIAL** | The code path is right, but **GATE-LEGALTYPE is still open**: existing production pages are all stamped `page_type='legal'`, and until the owner runs the drafted remediation the picker's distinct picks **omit** rather than resolve. On the deployed build a footer with picked legal links can render with links missing. |
| SRC-J (company details) | "company details" | a company-details block | `frames.ts:134–143` `about_paragraph`; relabelled "About paragraph / company details" (`templates.ts:467`) | **CONFORMS** | — |
| SRC-J (logo) | "Logo" | site logo or manual | `frames.ts:289` `logo_source`/`logo_media_id`/`logo_url`/`logo_alt`; editor `templates.ts:500–510` | **CONFORMS** | — |
| SRC-J (other elements) | "and other elenments" | additional block variety | `frames.ts:134–143` — 8 block types (about_paragraph, link_row, disclosure, logo, address, socials, heading, list) | **CONFORMS** | — |
| SRC-J (font, sizes) | "this template element could use different … font and sizes then the main template" | independent font family + sizes | `frames.ts:303–311` `FrameTypographyScope { size, font_family }` (closed enum `THEME_RECORD_FONT_NAMES`); controls `templates.ts:539–540` | **CONFORMS** | — |
| **SRC-J (colour)** | "this template element could use **different color** … then the main template" | independent colours | `frames.ts:298–302` `FramePaletteScope { background, text, link }` — all three typed **`FunnelTokenRole`**, i.e. references INTO the main template's 14-role palette; controls `templates.ts:535–537` `renderRoleStrip` | **PARTIAL** | The footer can pick a *different role*, but it cannot hold a colour the main template does not already define, and retheming the funnel moves the footer with it. The per-question override axis (SRC-1c) got free hex; the footer did not. Recorded as ADJ-N16, deferred. |
| SRC-J (renders) | "Add a bottom of the page template management" | renders at the bottom of every funnel page | `designs/frame.ts:1059` block composition, `:1257` `renderFooterRegion` call; `setFrameFooterVisibility` in the preview composer | **CONFORMS** | — |
| **SRC-J (pins)** | "Here are some exmamples of botton of the page possible templates- Image28, **Image29, Image30, Image31**, Image45" | five named examples | Image28 and Image45 were rebuilt and side-by-sided. `grep -rn "Image29\|Image30\|Image31"` across `docs/` and the contract returns **nothing** | **ABSENT** | Three of the five examples the owner named were never built, never compared, and appear in no row (ADJ-N42 records this as "owner fix-or-defer"). |

### A.3 — the six rejection points

| Clause | Owner's words | Contract end state | Code surface | Verdict | What is missing |
|---|---|---|---|---|---|
| SRC-R1 | "templates canvas non-functional" | the rejection is closed | see SRC-11D | **CONFORMS** | — |
| SRC-R2 | "themes tab layout …" | closed | see SRC-11E | **CONFORMS** | — |
| **SRC-R3** *(fix in flight)* | **"footer element J"** | closed | see SRC-J (identity) | **ABSENT** | The register marks this rejection point PASS. The owner has re-raised it verbatim. |
| SRC-R4 | "sliders broken vs Image9–14 and picker ≠ render" | closed | see SRC-7 | **NEEDS-DRIVE** | Anatomy is coded; the pixel fidelity vs Image10–14 is an owner-eye judgement, and ADJ-N21 is still open. |
| SRC-R5 | "question grid 'not even close'" | closed | see SRC-1a–1f | **CONFORMS** | — |
| SRC-R6 | "address 'none of the issues fixed'" | closed | see SRC-6 | **PARTIAL** | Closed except the Maps-autofill leg, still GATE-INCONC after deploy. |

### A.4 — the authoring path

| Clause | Owner's words | Contract end state | Code surface | Verdict | What is missing |
|---|---|---|---|---|---|
| SRC-1d (A.4) | "if user chooses answer X to Question A, unhide and require this DROPDOWN — **HOW DO I SET DROPDOWN???**" | the dependency AUTHORING path is acceptance, not just runtime | grid row dependency editor `ui-section-studio.ts:2508–2509` (trigger question by its own label, operator set, value picker fed by the trigger's authored values) | **CONFORMS** | — |

### Cross-cutting: the activation blocker (ADJ-B1) — the owner's second live complaint

| Clause | Owner's words / probe | Contract end state | Code surface | Verdict | What is missing |
|---|---|---|---|---|---|
| **ADJ-B1** *(fix in flight)* | probe verbatim: "every well-formed draft quote shows **'Blocked (N errors)'** … with NO reason surfaced anywhere in the UI" | §5.7 B1: "a well-formed quote activates, **OR** every blocking reason is visibly surfaced and addressable" | Chip: `quotes-tabs/activation.ts:153–158` `renderPublishBadge` → a plain `<span id="lg-publish-badge">` with **no href, no click handler, no `title`**, mounted in the persistent head bar at `ui-quotes.ts:726`. Reasons: `activation.ts:122–138` `renderPreflightPanelBody` → rendered **only inside `[data-panel="activation"]`** (`:176–186`), a different tab, reachable via the `Publish…` button at `ui-quotes.ts:730` | **PARTIAL** | The reasons exist and are addressable — but they are one tab away, and the chip the operator actually reads carries the count and nothing else. This is precisely "a message the operator cannot see without extra clicks", and it is what the owner just hit. |
| ADJ-N5 | (adjacent to "the rules you build are using jargon") | — | `quotes-tabs/shared.ts:423` `section: "Slides"` — a quote-level blocker is grouped under the heading **"Slides"** | **PARTIAL** | "Slides" is not the owner's vocabulary (the owner's words are pages and sections, #11C). Recorded, never fixed. |
| ADJ-N6 | — | — | the quote header chip still reads "draft" after a successful site activation | **PARTIAL** | Recorded, never fixed. |

---

## 3 · Named but never built

Things the owner named for which there is **no implementing surface at all**.

| # | The owner's words | Status |
|---|---|---|
| 1 | **"footer element J"** (A.3) / "this is **seperate** template element" (A.2) | No element J. `TPLBOX_CARDS` (`templates.ts:738–748`) runs A→I with the footer at **G**, and the panel heading reads `G · Footer` (`:530`). `grep -rn '"J"' src/admin/leadgen/quotes-tabs/templates.ts` finds no letter J. A conductor ruling (§5.4 minor-1) chose "upgrade G in place"; the owner's own letter says otherwise. |
| 2 | **"Image29, Image30, Image31"** (A.2) | Never built, never compared, cited in no row or pack. Only Image28 and Image45 were rebuilt. |
| 3 | **"providing us another input on the user for the analytics"** (A.1 #1) | The analytics distribution table is READ (`sections-handlers.ts:2558`) but nothing in-repo shows a grid child's answer reaching it. No row exists for this half of the sentence. |
| 4 | **"your conflict here, and in any other component with the same dependency, is just a low level slopy logic"** (A.1 #7) | The `$` conflict is proven gone on the five sliders. No surface, row or sweep addresses "any other component with the same dependency". |
| 5 | **"the user can't click continue unless he answers this quesion"** (A.1 #2) | The validator exists; no row names this leg and no artifact drives it. |

## 3b · Dead controls — authored, saved, persisted, never painted

The failure shape the theme "Corners" preset control had (P6-FIX-6). A full sweep of the authored
config vocabularies (`frames.ts` FrameConfig and every sub-config · `theme.ts`/`theme-store.ts`
ThemeRecord · `content-schema.ts`/`registry.ts` component props) against readers in the render path
(`frame.ts`, `default-funnel/styles.ts` + `tokens.ts`, `presets.ts`, `runtime/*`, `config-dto.ts`,
`src/leadgen/*`), with test/ and test-ui/ excluded from "a reader exists".

**Verified by my own hand** (these two touch owner clauses directly):

| Field | Control that writes it | Proof there is no painter |
|---|---|---|
| **`theme.controls.button_size`** | `ui-theme-manager.ts:914` `segmentedControl("controls","button_size",…)` | `resolveFieldSize` is the only consumer of `theme_controls`, and `content-schema.ts:668–672` says verbatim it does not consume `button_size`. No `.button_size` read in `frame.ts`, `styles.ts`, `presets.ts`, `runtime/*`, `config-dto.ts` or `src/leadgen/*`. |
| **`frame.brand_logos.items[].size`** | `templates.ts:345` `<select data-bl-item-size>` over `FRAME_SIZES`; collected `funnel.ts:2440`, hydrated `:2471` | `frame.ts:731–748` `renderBrandLogos` builds `{ mediaId, alt }` per item and never reads `it.size`; `styles.ts` emits only `.lg-frame-brand-logos--row` / `--grid`, no size class. Contrast `frame.images[].size`, which IS live (`frame.ts:798` → `lg-frame-image--{s,m,l}`). |

**Also found, lower owner impact** (each with its cited line; not independently re-verified beyond
the cited grep):

| Field | Status |
|---|---|
| `frame.background.style` `flat` vs `brand` | two of three offered options paint identically — `styles.ts:2383` has a rule for `brand_gradient` only. |
| `frame.section_slot.padding` | `frame.ts:627` emits `lg-frame-slot--pad-{s,m,l}`; `styles.ts:2504–2506` records the three rules were "REMOVED outright". |
| `frame.section_slot.transition` | `frame.ts:628` emits `lg-frame-slot--t-{fade,none}`; zero CSS rules. |
| `frame.section_slot.align` | emits `--align-center`; zero CSS rules; the enum is single-valued. |
| `frame.section_slot.card` | `styles.ts:2508` neutralised to `box-sizing` only; `--bare` has no rule. |
| `frame.section_slot.allow_section_card` | zero readers repo-wide; its own comment promises a warning that does not exist. |
| `ThemeRecord.spacing` | `theme.ts:743` — "Round-tripped only; never rendered". |
| `design_overrides.mobileBehavior` | `presets.ts:131` — "zero renderer consumers; the Design-tab control was removed in Phase C". |
| `FRAME_BACK_STYLES` value `icon_text` | `frame.ts:492` emits the class; `styles.ts` has only `--text` / `--button`, so it renders as `text`. |
| `ThemeRecordTypography.base_px` | the inverse defect — consumed at `theme.ts:1024`, but `ui-theme-manager.ts:1249` hardcodes `16` and no control exists. |
| `funnel.ts` imports 13 frame enums (`FRAME_BACK_STYLES/POSITIONS`, `FRAME_DISCLOSURE_LOCATIONS`, `FRAME_FOOTER_SHOW_ON`, `FRAME_TRUST_PLACEMENTS/MOBILE_MODES`, `FRAME_SLOT_CARDS/OFFSETS/TRANSITIONS`, …) | each occurs exactly once in the file — the import line. The controls they were imported for were never built. |

**Checked and genuinely consumed** (so this list is not read as a blanket indictment): every
`progress.*` key including `icon_on_track`; every `footer.*` key including `palette_scope.*`,
`typography_scope.{size,font_family}` (`--lg-footer-font` is read at `styles.ts:2841`),
`link_underline`, `link_separator` and every `blocks[]` field including `picks`;
`theme_json.scales.{spacing,radius,shadow}`; `theme.controls.{field_height,corners}`; `extra_roles`;
`button_style.{fill,layout,selected}`; every `design_overrides` key except `mobileBehavior`; all five
`slider_type` arms (`presets.ts:1277–1290`); `free_text` / `cta_slots` / `trust_rows` / `images`.

## 4 · Exists but cannot be reached

Surfaces present in the deployed worker that no route, tile or menu exposes to an operator. The
dominant finding is one cluster: **`funnel.ts`'s entire frame-studio canvas island survived the board
rewrite that deleted its DOM.** `renderBuilderPanel` (`funnel.ts:669–720`) emits board, library, rules
rail and dialogs — no iframe, no toolbar, no inspector, no banner.

| Surface | What it would do | Why it is unreachable |
|---|---|---|
| `funnel.ts:3179` `#lg-preview-iframe` (+ `setCanvasDoc` `:3234`, load listener `:3608`) | the builder's live canvas | `grep 'id="lg-preview-iframe"' src` → 0. The only emitted iframes are `#lg-tpl-canvas-iframe` and `#lg-theme-canvas-frame`. The variable is permanently `null`. |
| `funnel.ts:3545–3613` region-click island (`onCanvasClick`, `selectRegion`, the `[data-frame-region]` walk) | click a region to select its inspector | reachable only through `canvas.contentDocument`; the entry point sits inside `if (canvas)`. |
| `funnel.ts:3556` `[data-region-panel]`, `:3562` `#lg-inspector-hint` | per-region inspector | 0 emitters. The live twin is `data-tplbox-panel` in `templates.ts`. |
| `funnel.ts:3565–3578` `#lg-slot-banner` / `#lg-slot-banner-open` | "edit this section in Sections" deep link | 0 emitters; only caller is the dead `onCanvasClick`. CSS orphan `shared.ts:581`. |
| `funnel.ts:3628–3638` `[data-viewport-btn]`, `[data-preview-mode-btn]` | desktop/mobile + single/all-slide preview toggles | 0 emitters. CSS orphan `shared.ts:557`. |
| `funnel.ts:3634–3652` `#lg-step-controls` / `#lg-step-label` / `#lg-step-prev` / `#lg-step-next` | the slide stepper | 0 emitters. CSS orphan `shared.ts:640`. |
| `funnel.ts:1393–1394` `#lg-override-badge(-list)` | the arm's override chip | 0 emitters; called from three live paths incl. boot, silently returning at its guard. |
| `funnel.ts:774` `REGION_LABELS` ← `shared.ts:494`; `ui-quotes.ts:90` `import FRAME_REGION_LABELS` | region→label map | assigned and never read; serialized into every page's script payload. |
| `funnel.ts:3532` `#lg-theme-presets-frame`, `:3742` `#lg-theme-btn`, `:3855` `[data-fork-variant]`, `:1456`/`:1983` `[data-manual-logo]`, `:3714` `[data-select-slide]` | leftovers of the pre-rewrite UI | 0 emitters for each. |
| `quotes-handlers.ts:4487` `LG_SLOT_PLACEHOLDER_HTML` (emitted `:4830`, mode accepted at `:4899` `PREVIEW_MODES`) | the "This area is the Section's question unit — edit it in the Section Builder." strip §4 demanded be removed | no admin surface requests `mode:"frame"` any more (`themes.ts:160–165` records its removal), but the server will still render the string on request. |
| `router.ts:237` `PUT /frame-template-records/:id/default` | global default template | superseded by `PATCH /quotes/:id {default_template_id}` (`templates.ts:1893–1898`); no caller. |
| `router.ts:386–390` media-platforms CRUD; `router.ts:379` `POST /analytics/rebuild-range` | outbound S2S config; manual analytics backfill | no LeadGen page, tab or fetch calls either. The listicles twins ARE wired; LeadGen's are not. |

**Cost, not just clutter:** `schedulePreview()` has 11 live call sites and runs at boot
(`funnel.ts:3749`). `renderPreview` (`:3273`) still POSTs `/variants/:id/preview` on every frame or
theme edit in the builder tab and discards the whole composed response into the null canvas
(`setCanvasDoc:3235` returns immediately). Real network and real server compose, zero output.

## 5 · Register overstates

Rows whose PASS text claims more than the code supports.

| Row | The register says | The code says |
|---|---|---|
| **SRC-R3** | `PASS(the dropped task is built and driven — see SRC-J …)` for the anchor **"footer element J"** | `templates.ts:738–748` ships letter **G**; `:530` renders `G · Footer`; no surface names J. The rejection point the row declares closed is the one the owner re-raised on the live product. |
| **SRC-J** | `PASS(… rich toolbar formats (bold/italic/link/heading levels 1-6/lists) …)` | The toolbar is exactly three buttons (`templates.ts:476–478`, `data-footer-fmt="bold|italic|link"`). Heading level is a **block-type select** (`:481`) and list is a **separate block type** (`:482–483`) — capabilities, but not "toolbar formats". |
| **SRC-J** | `PASS(… independent font-family/sizes/colors …)` | Colours are `FunnelTokenRole` references into the main template's palette (`frames.ts:298–302`), so the footer cannot hold a colour the main template does not define. The register's own ADJ-N16 row concedes this; the SRC-J PASS text does not. |
| **ADJ-B1** | `PASS(… the reviewer authored its own quote, saw the reason surfaced …)` against the anchor "**NO reason surfaced anywhere in the UI**" | The reason renders only in `[data-panel="activation"]` (`activation.ts:176`). The chip the operator reads (`:153–158`) is a non-interactive `<span>` with no `title` and no link. "Surfaced somewhere" was accepted for "surfaced where the operator is". |
| **SRC-3** | `PASS(P1 leg: … the FULL roster re-verification remains scheduled at P6 …)` | A PASS whose own text defers its named proof. The contract enumerates ~20 roster entries (`LEADGEN-R2-FIX-CONTRACT.md:217–234`); the cited artifact covers 4. The generic `decorateChoiceCards` gate (`:6634`) makes the claim *structurally* likely — which is an argument, not the evidence the row cites. |
| **SRC-11D** | `PASS(… ALL NINE elements A–I change the canvas live …)` | Element **F**'s per-logo Size control is saved, hydrated and then dropped by `renderBrandLogos` (`frame.ts:731–748`); element **A**'s `flat` and `brand` styles paint identically (`styles.ts:2383`). "The element reflects" was proven at element granularity; two of the controls **inside** those elements paint nothing. |
| **P6-FIX-6 / P6-FIX-7** | `PASS(… ONE derivation for both paths via a compile-checked bridge, so renaming a corner value is a build error rather than a silent revert …)` | True and verified for `corners`. But the sibling control in the same group, `theme.controls.button_size`, was never checked and is still dead — `content-schema.ts:668–672` says so in its own words. The fix closed the reported instance, not the class. |
| **SRC-11E** | `PASS(… ONE canvas (no placeholder strip, no ?embed=1) …)` | True of the tab. The contract's implementing-surfaces clause says the string "③ must stop rendering"; `LG_SLOT_PLACEHOLDER_HTML` is still shipped and still emitted by the preview endpoint on `mode:"frame"` (`quotes-handlers.ts:4826–4831`), with `"frame"` still in `PREVIEW_MODES` (`:4899`). |
| **SRC-11C-N11** | `PASS(… rules read as plain sentences WITH actions …)` | The draft line and the saved card do. ADJ-N8 — unfixed, on the same rail — records the value side still printing `is excellent_rvw7q3`. The PASS does not mention that the row it depends on is open. |
| **LEDGER-P4** | `PASS(ACCEPTED on the documented reserve …)` | Honest, but note it records the slider slice at **1,732 B against a committed ≤1,500 B sub-budget** — a 232 B overrun absorbed from reserve under a conductor ruling. The cap itself is untouched, so this is disclosure, not a violation. |
| **ADJ-N38** (self-reported) | the register's own row records that `check_register.py:97` accepted any `INCONCLUSIVE` containing `step:` and never flagged `DEVIATES`, so **four phase gates reported "0 violations" over 21 unproven owner sentences** | Confirmed as written. The register also closes at **1 known false positive** (GATE-W89) rather than 0. |

## 6 · NEEDS-DRIVE — the input to the next round

Claims that only driving the product can settle. None of these is asserted either way above.

1. **Every element A–I visibly changes the Templates canvas on edit** — the `data-frame-key` wiring is
   generic; the per-key coverage is not statically provable.
2. **The five slider renders against Image10–Image14** — pixel fidelity, plus the open ADJ-N21 readout
   position decision.
3. **Cards centred (SRC-9)** — a painted property; the register's evidence is one 1600 studio capture
   with two cards where the owner's Image16 shows five.
4. **A grid child's answer reaching the analytics plane** (A.1 #1).
5. **Required-blocks-Continue on a dependency-met question** (A.1 #2).
6. **Image42 vs the shipped rule builder** (SRC-11C-N12) and **Image8 vs the shipped address**
   (ADJ-N28) — both are owner-eye rulings the program correctly refused to self-certify.

## 7 · Ranked deviations — what the owner sees first

1. **No element "J".** *(fix in flight)* The footer is tile **G** of A–I; the owner's own word appears nowhere
   (`templates.ts:738–748`, `:530`). Register rows SRC-J / SRC-R3 read PASS.
2. **"Blocked (N errors)" says nothing.** *(fix in flight)* The chip is a dead `<span>` in the head bar; the reasons
   live one tab away in the Activation panel (`activation.ts:153` vs `:176`).
3. **Three of the five footer examples were never built** — Image29 / Image30 / Image31 appear in no
   row, artifact or pack.
4. **Picked legal links can render missing on the live sites** until GATE-LEGALTYPE's drafted
   remediation is run — the build is deployed and the gate is still open.
5. **The Maps street+city autofill leg was never verified** (GATE-INCONC), and neither was the
   `state=CA` live-geo slot rule — both were "MUST-RESOLVE at cutover"; cutover has happened.
6. **Element F's per-logo Size control does nothing** — saved and hydrated, dropped by
   `renderBrandLogos` (`frame.ts:731–748`). Against §3's "**every** element … visibly updates the
   canvas the moment it is edited".
7. **The theme's Button-size control does nothing** — `theme.controls.button_size` has no painter,
   the identical dead-control shape as the Corners defect, in the same three-arm group.
8. **The footer's colours follow the main theme** — role references, not free colour, against
   "could use **different color** … then the main template" (`frames.ts:298–302`).
9. **The rules rail still prints raw choice values** (`is excellent_rvw7q3`) — the jargon the owner
   named, fixed on the field side only (ADJ-N8).
10. **A quote-level blocker is filed under the heading "Slides"** (`shared.ts:423`) — a word the owner
    never uses.
11. **The header chip still reads "draft" after a successful activation** (ADJ-N6).
12. **Background style flat vs brand paint identically** — two of the three options offered on
    element A produce the same output (`styles.ts:2383`).
13. **"The logical flow … applied on all the components"** is satisfied only for the add-affordance;
    per-question dependencies exist only inside the QuestionGrid container.
14. **A crafted POST can still assert a dependency-hidden answer** on the auction path (ADJ-N9) — real
    browsers omit it, so the owner will not see this, but the money path is not sealed.
15. **`NameFieldsGroup` projects unprefixed `first`/`last`**, so two name groups in one section collide
    (ADJ-N34) — the same multi-field class the owner's #6 sentence names.
16. **The theme-manager editor column is 0px wide at 375** (ADJ-N41) — the class P6-FIX-5 fixed at 1280.
17. **A dead canvas island still costs a compose POST per builder edit** (`funnel.ts:3273`, 11 call
    sites) — invisible to the owner, but real load on the deployed worker.

## 8 · Clauses that plainly conform

Stated so the list above is not read as a verdict on the whole build. These were checked against the
shipped code and are genuinely delivered, not merely present: the QuestionGrid container and all six
of its #1 sub-clauses; mark-then-continue and per-question types (#2); the ✓ inside the selected
button (#4); the operator-defined phone mask, with the "Israel" preset removed from authoring (#5);
the address subsets and per-field mode mapping (#6); the five slider types with `$` as display-only,
and the three per-offer output formats (#7 / #7B); the authored-Other dropdown on Buttons and Cards
(#8); the dropdown editor with no "other group" (#10); the logo seam (#11A); themes and templates as
top-bar tabs (#11B); fourteen of the eighteen funnel-board sentences, including "no control funnel",
the shared first page, side-by-side columns, unbounded `+ Add funnel`, the once-per-funnel refusal
with its verbatim message, the rules rail inside its box on the right, page reorder, funnel-level
A/B, theme-per-funnel and both routing planes (#11C); the Templates 3-pane with element **I** =
Progress carrying all five styles in a dedicated design box (#11D); the Themes three-pane with a
sticky single canvas and Image23's full-width two-line cards (#11E); and — apart from its letter,
its colour scope and the open legal-page gate — the footer's rich text, Pages-fed picker, company
details, logo, independent font and sizes (A.2).

The engineering is in far better shape than this document's deviation list suggests. What it is not
is *finished against the owner's own words*: the four ABSENT rows are all things a ruling decided
not to build, and every one of them was recorded as "owner fix-or-defer" and then never put in front
of the owner.
