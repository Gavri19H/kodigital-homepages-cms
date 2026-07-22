# LeadGen Rework — Traceability Register (v2)

**Program:** LeadGen Section & Funnel Builder Rework  
**Contract:** `/Users/guyhaikov/a2z-workspaces/LEADGEN-REWORK-03-CONTRACT-PLAN.md` v2  
**Ground SHA:** `b8c302e`

**Legend:** Status ∈ {OPEN, PASS, BLOCKED-operator}. PASS is written ONLY by the conductor, ONLY with executed evidence (command + real output) cited in the Evidence column. Implementers never write to this file.

**P1 entry gates — executed 2026-07-22 by the conductor (pre-P1 evidence, recorded here for recovery):**
- **E1 (M2 reader sweep):** `grep -rln "leadgen_funnel_pages\|leadgen_funnel_variant_sections" src/` → exactly the 6 contract-listed reader files (db-types, offers-handlers, quotes-handlers, sections-handlers, ui-sections, resolver) + 1 comment-only mention (`ui-quotes.ts:4243`, not a reader; keep the comment truthful in S1.6/P3). Contract M2 list confirmed complete. PASS.
- **E2 (M6 question_id proof):** executed the real `validateSectionContent` at b8c302e against `q_mig01::insured` on a valid ButtonAnswerGroup → `ok:true, errors:[]`; sibling pair of distinct `::` ids → `ok:true`; identical `::` ids → `duplicate_question_id` fires. `::`-projected ids pass save validation; M6 preserves ids byte-identically, fallback remap NOT needed. PASS.
- **E3 (baselines at b8c302e):** `npx vitest run` → **406 files / 6045 tests, all passed** (114.21s). `npx playwright test --list` → **586 tests / 72 files**. Zero pre-existing failures to triage. PASS.

---

## Acceptance Criteria (§11)

| Row ID | Contract Anchor | Requirement | Implementing Files | Proving Command/Test | Status | Evidence |
|--------|---|---|---|---|---|---|
| AC-01 | §11 #1 | Grid removed; N independent components; add-affordance outside boxes | tbd | tbd | OPEN | — |
| AC-02 | §11 #2A | Click marks; Continue validates; default/answer tracking | tbd | tbd | OPEN | — |
| AC-03 | §11 #2B | One screen two questions with per-question labels and mapping | tbd | tbd | OPEN | — |
| AC-04 | §11 #2C | Dependency visibility hides/unhides; blocks/unblocks Continue | tbd | tbd | OPEN | — |
| AC-05 | §11 #3 | Control matrix test; all types show exactly their controls | tbd | tbd | OPEN | — |
| AC-06 | §11 #4 | ✓-in-selected per theme and per question; pill/card render | tbd | tbd | OPEN | — |
| AC-07 | §11 #5 | Phone mask scaffold preview; runtime fill; Continue blocks; raw digits | tbd | tbd | OPEN | — |
| AC-08 | §11 #6 | Address: free-text, subsets, per-field modes, ZIP validation, Maps optional | tbd | tbd | OPEN | — |
| AC-09 | §11 #7 | Slider: five types, rendering, min/max/step, currency toggle, transforms | tbd | tbd | OPEN | — |
| AC-10 | §11 #8 | Other affordance: base choices untouched; Other dropdown; deselection logic | tbd | tbd | OPEN | — |
| AC-11 | §11 #9 | Card columns: min(authored, count); wrapped last row centered; ghost cell absent | tbd | tbd | OPEN | — |
| AC-12 | §11 #10 | Dropdown shows no Other-group control | tbd | tbd | OPEN | — |
| AC-13 | §11 #11A | Logo renders; placeholder chip without; never bare name | tbd | tbd | OPEN | — |
| AC-14 | §11 #11B | No Template/Theme buttons in builder; top tabs only; tests green | tbd | tbd | OPEN | — |
| AC-15 | §11 #11C | Builder: library-left, board-center, rules-right; first-match-wins; sticky outcome | tbd | tbd | OPEN | — |
| AC-16 | §11 #11D | Templates: create, save, reuse, A/B on funnel; apply with preview/confirm | tbd | tbd | OPEN | — |
| AC-17 | §11 #11E | Themes: live sample update; title+subtitle cards; ✓-selected selectable | tbd | tbd | OPEN | — |
| AC-18 | §11 Migrations | M6/M7/M9/M12: before/after reports; field-universe + answer-map invariants | tbd | tbd | OPEN | — |
| AC-19 | §11 Cross-cutting | Orphan scan green; engine within cap; suites pass by count; preflight checks; owner acceptance | tbd | tbd | OPEN | — |

---

## Data Migrations (§5)

| Row ID | Contract Anchor | Requirement | Implementing Files | Proving Command/Test | Status | Evidence |
|--------|---|---|---|---|---|---|
| M-01 | §5 M1 | Drop `is_control` from funnel_variants; deterministic order by label | tbd | tbd | OPEN | — |
| M-02 | §5 M2 | Shared first page: variant_id NULLable, quote_id NULLable; reader sweep enumerated | tbd | tbd | OPEN | — |
| M-03 | §5 M3 | Quote-scoped routing: new table, recreate outcomes, migrate old rows to new | tbd | tbd | OPEN | — |
| M-04 | §5 M4 | Default funnel + display_order on funnels; multiple active funnels legal | tbd | tbd | OPEN | — |
| M-05 | §5 M5 | Saved templates: new table, seed built-ins, variant-level override refs | tbd | tbd | OPEN | — |
| M-06 | §5 M6 | Grid to independent components: migration, question_id proof gate, field universe unchanged | tbd | tbd | OPEN | — |
| M-07 | §5 M7 | Slider collapse: RangeQuestion/CurrencyRangeQuestion to NumberRangeQuestion | tbd | tbd | OPEN | — |
| M-08 | §5 M8 | Phone mask: grammar validation, scaffold/digit_count/regex compile | tbd | tbd | OPEN | — |
| M-09 | §5 M9 | Address field set: props.fields[] ordered, per-field modes, validations | tbd | tbd | OPEN | — |
| M-10 | §5 M10 | OS entry context (ios/android/windows/macos/linux/other) from User-Agent | tbd | tbd | OPEN | — |
| M-11 | §5 M11 | (Optional) formatCurrency(symbol,decimals) transform kind | tbd | tbd | OPEN | — |
| M-12 | §5 M12 | OtherGroupSelector content retirement: nodes to ButtonAnswerGroup, choiceDisplay removed | tbd | tbd | OPEN | — |

---

## Routing Semantics (§4.3)

| Row ID | Contract Anchor | Requirement | Implementing Files | Proving Command/Test | Status | Evidence |
|--------|---|---|---|---|---|---|
| R-01 | §4.3-1 | Entities: one shared first page, N funnels, quote-scoped rules, default funnel | tbd | tbd | OPEN | — |
| R-02 | §4.3-2 | Shared first page evaluated first; entry rules never skip it | tbd | tbd | OPEN | — |
| R-03 | §4.3-3 | Checkpoint plane: entry-known vs answer-collected vs in-funnel (class c warning) | tbd | tbd | OPEN | — |
| R-04 | §4.3-4 | First match wins entirely; no merging across rules | tbd | tbd | OPEN | — |
| R-05 | §4.3-5 | At most one routing outcome per attempt | tbd | tbd | OPEN | — |
| R-06 | §4.3-6 | Outcome sticky; back-nav answer change does not re-route | tbd | tbd | OPEN | — |
| R-07 | §4.3-7 | Unmatched visitors enter default funnel when leaving shared page | tbd | tbd | OPEN | — |
| R-08 | §4.3-8 | Funnel switch resume at first page with unanswered required visible field | tbd | tbd | OPEN | — |
| R-09 | §4.3-9 | Actions: target_funnel, feed_name, value_multiplier, redirect_pct, redirect_target; ≥1 required | tbd | tbd | OPEN | — |
| R-10 | §4.3-10 | A/B: equal arms, hashed at funnel entry, no control semantics | tbd | tbd | OPEN | — |
| R-11 | §4.3-11 | Progress bar: shared + known/default funnel pages; recomputed after switch | tbd | tbd | OPEN | — |
| R-12 | §4.3-12 | Auction fires after last page of served variant; never on shared page alone | tbd | tbd | OPEN | — |
| R-13 | §4.3-13 | Section uniqueness: at most once per {shared ∪ any single funnel} | tbd | tbd | OPEN | — |
| R-14 | §4.3-14 | Delete guards: funnel (default/rule-targeted), template (in-use) | tbd | tbd | OPEN | — |
| R-15 | §4.3-15 | Activation preflight: default set+active, ≥1 page per funnel, uniqueness, rule targets | tbd | tbd | OPEN | — |

---

## Component Changes (§6.1–§6.10)

| Row ID | Contract Anchor | Requirement | Implementing Files | Proving Command/Test | Status | Evidence |
|--------|---|---|---|---|---|---|
| C-01 | §6.1 | Add-affordance immediately after component root, outside border, left-aligned | tbd | tbd | OPEN | — |
| C-02 | §6.2 | Inspector control matrix: per-type capability flags govern visibility | tbd | tbd | OPEN | — |
| C-03 | §6.3 | Per-question label + helper on answer-producing types; render chrome; ≤120 chars | tbd | tbd | OPEN | — |
| C-04 | §6.4 | Defaults for choice groups: YesNo, Buttons, IconCards, ImageCards via `defaultKindOf` | tbd | tbd | OPEN | — |
| C-05 | §6.5 | Other: enabled flag, label, 1..50 authored choices, deselection logic on base/other | tbd | tbd | OPEN | — |
| C-06 | §6.6 | Selected marker: wash/mark per choice/node; pill/button render mark | tbd | tbd | OPEN | — |
| C-07 | §6.7 | Card columns: min(authored, count); last row centered; no ghost cell | tbd | tbd | OPEN | — |
| C-08 | §6.8 | Slider types: single, stepper, from_to, dual_range, radial; sub-fields _min/_max | tbd | tbd | OPEN | — |
| C-09 | §6.9 | Phone mask: format input, scaffold preview, progressive fill, digit-only input | tbd | tbd | OPEN | — |
| C-10 | §6.10 | Address fields: ordered, per-field mode/validation/required, preset, Maps section | tbd | tbd | OPEN | — |

---

## UI Sections (§8.1–§8.10)

| Row ID | Contract Anchor | Requirement | Implementing Files | Proving Command/Test | Status | Evidence |
|--------|---|---|---|---|---|---|
| U-01 | §8.1 | Section studio deltas: grid removal, palette starter, label/default controls | tbd | tbd | OPEN | — |
| U-02 | §8.2 | Funnel builder: library-left, board-center (shared+funnels), rules-right | tbd | tbd | OPEN | — |
| U-03 | §8.3 | Templates tab: elements-left, live canvas, settings, theme/section picker | tbd | tbd | OPEN | — |
| U-04 | §8.4 | Themes tab: live sample, title+subtitle cards, ✓-selected, existing theme-v2 kept | tbd | tbd | OPEN | — |
| U-05 | §8.5 | A/B tab: consolidated test view, control vocabulary removed, delete-variant | tbd | tbd | OPEN | — |
| U-06 | §8.6 | Activation tab: preflight extended per §4.3-15 checks | tbd | tbd | OPEN | — |
| U-07 | §8.7 | Analytics tab: routed_to_funnel and feed_name join drilldown | tbd | tbd | OPEN | — |
| U-08 | §8.8 | Site logo: explicit placeholder chip (A-8); preview link to Site settings | tbd | tbd | OPEN | — |
| U-09 | §8.9 | Dead-code bar: every rebuilt-tab control wired or absent | tbd | tbd | OPEN | — |
| U-10 | §8.10 | P0 golden design pack: geometry, tokens, states, empty states, microcopy | tbd | tbd | OPEN | — |

---

## Removal Groups (§10)

| Row ID | Contract Anchor | Requirement | Implementing Files | Proving Command/Test | Status | Evidence |
|--------|---|---|---|---|---|---|
| X-01 | §10 inventory 1 | MultiQuestionGrid: schema, registry, config-dto, presets, studio, palette | tbd | tbd | OPEN | — |
| X-02 | §10 inventory 2 | OtherGroupSelector type: registry.ts:110, studio refs, presets refs | tbd | tbd | OPEN | — |
| X-03 | §10 inventory 3 | choiceDisplay + mainValues + splitChoicesForOtherGroup + renderOtherGroupTail + main checkboxes + searchable toggle | tbd | tbd | OPEN | — |
| X-04 | §10 inventory 4 | Phone country list + raw-regex custom path + dormant custom.mask slot | tbd | tbd | OPEN | — |
| X-05 | §10 inventory 5 | Address type-lock + fixed composite editor | tbd | tbd | OPEN | — |
| X-06 | §10 inventory 6 | Slider catalog triplet + toggleSliderFormat | tbd | tbd | OPEN | — |
| X-07 | §10 inventory 7 | is_control + all leadgen reads (7 files / ~50 reads per M1 inventory; listicles' is_control untouched) | tbd | tbd | OPEN | — |
| X-08 | §10 inventory 8 | route_funnel_variant + (control) labels + variant selector + fork + canvas controllers + Template/Theme buttons + Background inspector + rules-for-variant link | tbd | tbd | OPEN | — |
| X-09 | §10 inventory 9 | FRAME_TEMPLATES as sole templates (→seed rows) + stale "seven box pickers" comments | tbd | tbd | OPEN | — |
| X-10 | §10 inventory 10 | Test-file rewrites: named files rewritten; tests pass by count | tbd | tbd | OPEN | — |
| X-11 | §10 inventory 11 | Orphan scan green: unreferenced exports/handlers/CSS classes | tbd | tbd | OPEN | — |

---

## Appendix A Strings

| Row ID | Contract Anchor | Requirement | Implementing Files | Proving Command/Test | Status | Evidence |
|--------|---|---|---|---|---|---|
| STR-A1 | Appendix A-1 | Board empty column: "No pages yet…" | tbd | tbd | OPEN | — |
| STR-A2 | Appendix A-2 | Add-funnel stub: "+ Add funnel" / sub "Visitors reach…" | tbd | tbd | OPEN | — |
| STR-A3 | Appendix A-3 | Default chip: "Default" / tooltip "Visitors who match…" | tbd | tbd | OPEN | — |
| STR-A4 | Appendix A-4 | Uniqueness block: "'{section}' is already…" | tbd | tbd | OPEN | — |
| STR-A5 | Appendix A-5 | Delete guard (×2): "Can't delete…" / "…it is the target…" | tbd | tbd | OPEN | — |
| STR-A6 | Appendix A-6 | Unreachable warning: "This rule can never…" | tbd | tbd | OPEN | — |
| STR-A7 | Appendix A-7 | Phone incomplete: "Enter a complete phone…" | tbd | tbd | OPEN | — |
| STR-A8 | Appendix A-8 | Logo placeholder: "No logo — set it…" | tbd | tbd | OPEN | — |
| STR-A9 | Appendix A-9 | Canvas fixture: "Sample section…" | tbd | tbd | OPEN | — |
| STR-A10 | Appendix A-10 | Mask pattern error: "Format must be…" | tbd | tbd | OPEN | — |
| STR-A11 | Appendix A-11 | Rules ≥1 action: "Pick at least one…" | tbd | tbd | OPEN | — |

---

## Decisions (§13)

| Row ID | Contract Anchor | Requirement | Implementing Files | Proving Command/Test | Status | Evidence |
|--------|---|---|---|---|---|---|
| D-1 | §13 D1 | Runtime byte cap: recommend 51,200 (50 KiB), FINAL, per-feature ledger | tbd | tbd | BLOCKED-operator | — |
| D-2 | §13 D2 | Existing routing rules: migrate intact or drop (owner choice) | tbd | tbd | BLOCKED-operator | — |
| D-3 | §13 D3 | Feed Name consumer: name downstream use (offer field? S2S param?) | tbd | tbd | BLOCKED-operator | — |
| D-4 | §13 D4 | Site logos: code renders; uploads are owner task or name source | tbd | tbd | BLOCKED-operator | — |
| D-5 | §13 D5 | Auction-domain rules UI: relocate to Auction tab or Advanced drawer | tbd | tbd | BLOCKED-operator | — |

---

## Operator Responsibilities

| Row ID | Contract Anchor | Requirement | Implementing Files | Proving Command/Test | Status | Evidence |
|--------|---|---|---|---|---|---|
| OP-1 | §12, Deploy | Production deploy via workflow_dispatch; operator-owned | tbd | tbd | BLOCKED-operator | — |
| OP-2 | §13 D4 | Real logo asset uploads in Site settings or name source | tbd | tbd | BLOCKED-operator | — |
| OP-3 | §6, Runtime visual | Staging manual visual QA run | tbd | tbd | BLOCKED-operator | — |
| OP-4 | §11 Cross-cutting | Owner hands-on acceptance (terminal gate) | tbd | tbd | BLOCKED-operator | — |

---

## Summary

- **Total rows:** 97 (19 AC + 12 M + 15 R + 10 C + 10 U + 11 X + 11 STR + 5 D + 4 OP)
- **OPEN:** 88 rows (all implementation rows)
- **BLOCKED-operator:** 9 rows (5 decisions D-1..D-5 + 4 operator tasks OP-1..OP-4)
- **PASS:** 0 rows (conductor verifies; implementer never claims PASS)
