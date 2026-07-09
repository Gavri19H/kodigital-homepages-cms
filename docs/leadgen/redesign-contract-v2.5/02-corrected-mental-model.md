# 02 · Corrected Mental Model: Quote Frame vs Section Question Unit

## 2.1 The model (normative)

```
Quote (activity, verticals, activation on sites)
└─ Funnel (stable id lgf_…)            ← owns PAGE FRAME + FUNNEL THEME
   └─ Funnel Variant (lgn_…)           ← owns section ORDER + frame OVERRIDES (A/B)
      └─ ordered Section slots         ← each slot renders ONE Section's QUESTION UNIT
         └─ Section (reusable)         ← owns the question unit ONLY
            └─ Components / Choices    ← owns content + local styling + mapping metadata
```

**Composition rule (the sentence every surface obeys):** a visitor sees
`QuoteFrame(siteBranding, funnelTheme, frameConfig ⊕ variantFrameOverrides, progressState) ∘ SectionQuestionUnit(currentSection)` — the frame stays constant across slides; only the question unit changes.

## 2.2 Ownership split (binding)

| Concern | Owner | Never owned by |
|---|---|---|
| Site logo, header, tagline, secure badge, header CTA | Quote/Funnel frame | Section |
| Advertising disclosure, legal links, footer, trust/brand logo strips, benefit bar | Quote/Funnel frame | Section |
| Progress bar / step indicator (uses Variant section order) | Quote/Funnel frame | Section (Advanced-only local exception, `11 §11.2`) |
| Previous/Back | Quote/Funnel frame | Section (Advanced-only local exception) |
| Page background, global typography, palette, spacing, button/card defaults, breakpoints | Funnel theme | Section |
| Section-slot geometry (max width, card/bare, padding, transition, Continue placement default) | Quote/Funnel frame | Section |
| Question headline + subheadline (canonical text) | Section (columns) | Frame |
| Answer components, inputs, local media, helper/reassurance copy, local validation error slots | Section | Frame |
| Answer normalization, `internal_field`, Offer payload mapping, mapping version | Section | Frame |
| Validation rules, dependencies (IF/THEN), continue NEED (`continue_mode`) | Section | Frame |
| Per-choice content (label, value, icon/image/emoji, title/subtitle, badge, alt) | Component/Choice | Frame |
| Local containers INSIDE the unit (question card, answer grid, input group, spacer) | Section | — |
| Continue default style + placement | Frame (theme + section_slot) | — (Section may override copy/style locally, D10) |

## 2.3 Why this split (rationale, one paragraph)

A funnel converts when the shell is stable and trustworthy while questions change. Frame-per-Section authoring guarantees drift (slide 3 loses the disclosure, slide 5 doubles the progress bar) and multiplies work by the number of slides. Sections are reusable across Quotes; anything site- or funnel-specific baked into a Section (a logo, a footer) silently lies when the Section is reused. The frame is exactly the set of things that must not vary per slide; the unit is exactly the set that must.

## 2.4 Glossary (canonical language for ALL surfaces — admin UI copy, API fields, docs, tests)

| Term | Definition | Identifier |
|---|---|---|
| **Quote** | Top-level product: an activity’s lead-capture experience, activated on sites | `lgq_…` |
| **Funnel** | Stable flow identity under a Quote; owns Page Frame + Theme | `lgf_…` (`funnel_id`) |
| **Funnel Variant** | An A/B arm of a Funnel; owns section order + frame overrides | `lgn_…` (`funnel_variant_id`) — NEVER an alias of `funnel_id` |
| **Page Frame** | The persistent shell a Funnel wraps around every slide: header, disclosure, progress, back, background, trust, footer, section slot | `frame_config_json` |
| **Funnel Theme** | Curated design-language overrides over the base visual design: palette roles, typography, spacing/radius/shadow scales, button/card defaults | `theme_json` |
| **Frame Template** | A named arrangement of frame regions (e.g. `centered`, `header-cta`, `full-background`) | `frame_config_json.template` |
| **Section** | Reusable question-and-answer unit | `lgs_…` |
| **Question Unit** | The rendered form of a Section: canonical headline/subheadline + components | `content_json` (+ bound headline nodes) |
| **Section Slot** | The frame region where the current Question Unit is inserted | `frame_config_json.section_slot` |
| **Component** | One node in a Question Unit (question, input, choice grid, affordance, local container) | `question_id` |
| **Choice** | One selectable answer inside a choice component | `analytics_id` |
| **Internal Field** | The Section-side normalized answer name | `internal_field` |
| **Payload Field** | A field in an Offer’s provider payload schema | `offer_payload_field_path` |
| **Provider Value** | The provider-side output value a normalized answer maps to | `output_value_map` |
| **Mapping** | internal_field → payload field binding incl. value map + transform | `leadgen_section_answer_maps` |
| **Offer** | A monetizable provider integration (payload schema, placements, rules) | `off_…` |
| **Placement** | A provider feed id under an Offer | `placement_id` |
| **Auction** | The post-final-Section competition among Offer placements | `lga_…` |
| **Carrier** | A normalized provider response entity shown in a banner | `carrier_key` |
| **Banner** | A rendered auction result slot | `banner_render_id` |
| **Site Branding** | Per-site logo/name/legal read from `site_settings` at activation/serve | `site_id` |

Rules: (a) admin UI copy uses the **bold** terms above, never internal synonyms. **“Slide” is Quote-Builder-only vocabulary** meaning *a Section’s position in the selected Funnel Variant* (“Slide 3 of 5”, “Auction runs after this slide”); the **Section Builder always says “Section” / “question unit”**, and any surface where an edit could look local to one funnel must show reuse (“Used in 2 quotes” — from `/sections/:id/usage`); (b) no surface may introduce a new term for an existing concept; (c) API field names use the Identifier column vocabulary; (d) shared trust/logo/legal affordances are labeled “inside this question unit” (Section Builder) vs “funnel-wide” (Quote Builder) — `08 §8.3`. A term-consistency pass over `ui-*.ts` strings is part of Phase C acceptance (`16`), enforced by the `15 §15.2` lints.

## 2.5 Anti-model (explicitly rejected)

- ❌ A second free-form canvas for the frame (frame = structured regions; a canvas would recreate the drift problem at Quote level).
- ❌ Auto-suppressing chrome components found inside Sections at runtime (silent magic; instead: save warnings + preflight + migration assistant, `08 §8.6`).
- ❌ Treating `funnel_design_id` as the theme (it stays the BASE visual design; the theme is a curated override layer, `09 §9.2`).
- ❌ Storing resolved hex in overrides going forward (roles only; legacy hex tolerated read-only, D6).
