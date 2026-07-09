# 07 · Inspector Contract

One inspector spec for both builders. The inspector is **scope-aware, human-language, and honest about blast radius**. It replaces the static 9-tab strip + “Select a component” head (`ui-section-studio.ts:958–979`).

## 7.1 Scope header (always visible, first element)

```
Editing: <selection name>                       ← operator words, never type ids
Scope:   [Funnel frame] [This Section] [Component] [Choice]   ← pills, active highlighted
Affects: <one sentence>                          ← the blast-radius line
```

Examples (binding copy patterns):
- Choice: “Editing: Answer choice **‘Sole Proprietor’** — affects this card only.”
- Component: “Editing: **Image answer cards** — affects this question on this slide.”
- Section: “Editing: **This Section (question unit)** — used in 2 quotes; changes apply everywhere it’s used.” (usage count from existing `/sections/:id/usage`).
- Frame region: “Editing: **Funnel frame — Footer** — affects every slide of this funnel.”
- Theme: “Editing: **Funnel theme** — affects every slide and every component default of this funnel.”

## 7.2 The six editing scopes (mission-required, mapped)

| # | Scope | Edited where | Storage |
|---|---|---|---|
| 1 | Quote/Funnel frame | Quote Builder region inspectors | `frame_config_json` (+ variant overrides) |
| 2 | Section / question unit | Section Builder, “This Section” pill | `headline_text`/`subheadline_text`, `continue_mode`, `design_overrides_json` (Section roles) |
| 3 | Selected component | Section Builder component tabs | node `props` / `design_overrides` |
| 4 | Selected answer choice | Choices tab / choice cluster | `choices[i]` fields |
| 5 | Mapping | Mapping tab / drawer (`12`) | `leadgen_section_answer_maps` |
| 6 | Advanced / debug | Advanced tab (per scope) | ids, raw node JSON (read-mostly) |

Selecting via canvas, breadcrumb, or pills always lands the inspector on the correct scope; a scope change is animated + announced (`aria-live`) so the operator SEES the retarget.

## 7.3 Tabs (dynamic per selection — never a fixed strip)

| Tab | Shown when | Contents |
|---|---|---|
| **Content** | copy-bearing selection | question headline/subheadline (bound, `05 §5.2`), helper text, placeholder, labels, local copy |
| **Choices** | choice-bearing component | row grid — **Section-owned fields only** (C1): display label · internal normalized value (auto-suggested from label, editable) · analytics label (`analytics_id`) · icon/emoji/image cell (picker) · title/subtitle · badge · main/Other grouping (existing `choiceDisplay`) · disabled · bulk paste · reorder. **No universal provider value exists here** — each row ends with a read-only “Provider values: k/n Offers” chip that expands to ONE ROW PER SELECTED OFFER and deep-links into that Offer’s value map (`12 §12.2`) |
| **Design** | any visual selection | preset dropdown (`06 §6.6`) · role swatch controls (`09 §9.4`) · columns/gap/width/radius/shadow token controls · mobile behavior. NO hex anywhere on this tab |
| **Validation** | question/input | required · min/max · type-specific format (email/phone/ZIP/date) · error message override |
| **Maps** | ZIP/address components | existing §8.8 field-level Maps config (unchanged) |
| **Dependencies** | any unit component | visual IF/THEN builder (existing evaluator; fields = this Section’s internal fields): show/hide/require/autofill when — sentence-rendered rows (“Show this question when **insured** is **Yes**”), no JSON |
| **Mapping** | answer-producing component | this component’s mapping status per selected Offer + quick-map (jump to `12`) + **per-Offer provider value maps** (`12 §12.2`) |
| **Advanced** | always, collapsed | `internal_field` (rename w/ mapping-impact warning), `question_key`, `analytics_id`s, component id, bind marker, raw node JSON (read-only view + explicit “Edit raw…” confirm), legacy hex values if present |

Frame regions use their own single-panel inspectors (`04 §4.4`) plus a per-region Advanced (raw group JSON, read-only).

## 7.4 Language rules (binding; enforced by copy review + Playwright string assertions)

- Labels use the `02 §2.4` glossary; forbidden on normal surfaces: raw type names (`IconCardAnswerGrid`), column names (`headline_text`), token keys (`primaryWash`), hex strings, public-id prefixes (`lgs_`, `lgn_`), and the word “JSON”. In the Section Builder, “slide” is additionally forbidden (C6) — say “Section” / “question unit”; “slide” is reserved for the Quote Builder (a Section’s position in the selected Funnel Variant).
- Every destructive/wide-effect control carries its consequence inline (“Renaming the internal field will unlink 3 Offer mappings — they’ll need remapping.”).
- Inherited values render as real values with an “inherited” tag + source (“Button color: **Brand primary** — from Funnel theme”), and a “Reset to inherited” affordance appears once overridden (`09 §9.4`).
- Normal designers see NO ids; Advanced is one collapsed section per scope, labeled “Advanced”.

## 7.5 Acceptance probes (verified in `15`)

Selecting a card choice shows the choice scope header within 100 ms; switching pills re-renders tabs; no tab shows for an inapplicable selection; the Advanced tab is collapsed by default and its opening is tracked (`section_advanced_opened` admin-side event, console-only — no schema change).
