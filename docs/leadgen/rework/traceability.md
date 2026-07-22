# LeadGen Rework — Traceability Register (v2)

**Program:** LeadGen Section & Funnel Builder Rework  
**Contract:** `/Users/guyhaikov/a2z-workspaces/LEADGEN-REWORK-03-CONTRACT-PLAN.md` v2  
**Ground SHA:** `b8c302e`

**Legend:** Status ∈ {OPEN, PASS, BLOCKED-operator}. PASS is written ONLY by the conductor, ONLY with executed evidence (command + real output) cited in the Evidence column. Implementers never write to this file.

**P1 entry gates — executed 2026-07-22 by the conductor (pre-P1 evidence, recorded here for recovery; product source is byte-identical b8c302e→989c54a — the P0 merge was docs-only — so this evidence remains valid at the P1 base):**
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
| M-01 | §5 M1 | Drop `is_control` from funnel_variants; deterministic order by label | api/migrations/0046 + db-types.ts + resolver.ts ordering | leadgen-rework-migrations.test.ts (14/14) + is_control grep 0 live reads | PASS | Recreation w/o is_control, ids+indexes preserved; order variant_label ASC,id ASC; conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |
| M-02 | §5 M2 | Shared first page: variant_id NULLable, quote_id NULLable; reader sweep enumerated | api/migrations/0047 + 6 reader files | migrations.test owner-axis CHECK + partial-unique proofs; E1 sweep | PASS | Owner axis (CHECK exactly-one) + per-owner UNIQUE via partial indexes; all 6 readers updated; conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |
| M-03 | §5 M3 | Quote-scoped routing: new table, recreate outcomes, migrate old rows to new | api/migrations/0048 + m3-rules-repointing.md | migrations.test (verbatim columns, CHECK→4, D2 rows, F-D outcomes, retry-safety fail-before/after) | PASS | leadgen_quote_routing_rules verbatim; outcomes recreated per F-D; D2 migration idempotent (review P2-2 fixed); ERRATUM: skip/show→slot-rules unimplementable as written (entry-known-only) — fail-closed abort guard; live table EMPTY (prod query 2026-07-22); conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |
| M-04 | §5 M4 | Default funnel + display_order on funnels; multiple active funnels legal | api/migrations/0049 + resolver.ts getActiveFunnelsForQuote | migrations.test backfill proofs + routing.test R-07 | PASS | default_funnel_id + display_order additive w/ backfills; set-returning actives; conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |
| M-05 | §5 M5 | Saved templates: new table, seed built-ins, variant-level override refs | P1 tables/CRUD + P2 effectiveFrame 4th-arg + threading (admin+ALL live serve sites) + content_version bump both endpoints | rework-handlers cache-coherence + rework-routing saved-template live-serve tests | PASS | END-TO-END complete across P1+P2; P2 gate 2026-07-23: tsc 0 · vitest 415f/6965t · bundle 50,037/51,200 (D1, ledgered) · verify:all 0 · geometry 8/8 chromium+firefox · adversarial SHIP FINAL after F1 (true last-row centering) + F2 (mobile cascade) fix rounds, reviewer live-browser re-proofs |
| M-06 | §5 M6 | Grid to independent components: migration, question_id proof gate, field universe unchanged | api/migrations/0050 + m6-report.md | content-migrations.test (32/32): type rule, ::-id preservation (E2), field-universe equality (projected; raw delta reported), answer-map invariance, idempotency | PASS | Grid→N components in place; E2-proven id preservation; content_html invalidated (review P2-3 fixed); conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |
| M-07 | §5 M7 | Slider collapse: RangeQuestion/CurrencyRangeQuestion to NumberRangeQuestion | api/migrations/0051 + answers.ts fieldsOf | content-migrations.test M7 + routing.test slider sub-fields | PASS | Triplet→NumberRangeQuestion + slider_type single + currency_affix; answer_type number; _min/_max in fieldsOf; NOTE config-dto/content-schema parity leg = P2 S2.1; conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |
| M-08 | §5 M8 | Phone mask: grammar validation, scaffold/digit_count/regex compile | content-schema grammar + config-dto compile + engine fill + studio builder + sections-handlers warning | mask grammar table + runtime fill suite + warning cases | PASS | P2 gate 2026-07-23: tsc 0 · vitest 415f/6965t · bundle 50,037/51,200 (D1, ledgered) · verify:all 0 · geometry 8/8 chromium+firefox · adversarial SHIP FINAL after F1 (true last-row centering) + F2 (mobile cascade) fix rounds, reviewer live-browser re-proofs |
| M-09 | §5 M9 | Address field set: props.fields[] ordered, per-field modes, validations | api/migrations/0052 + m9-report.md | content-migrations.test M9 (behavior-preserving, maps.fills untouched) | PASS | Explicit fields[] street/city/state/zip autofill+zip5; requiredness/labels investigated + preserved; conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |
| M-10 | §5 M10 | OS entry context (ios/android/windows/macos/linux/other) from User-Agent | resolver.ts deriveOs + serve.ts + runtime-routes + payload/events/runtime-context/fetch | routing.test os table (6 buckets, verbatim order) + feed_name end-to-end + shell-serve parity | PASS | os verbatim UA order at ALL entry-ctx sites; feed_name → outcome+events+ctx.feed_name (D3 stamp-only); canonical macro + ADVANCED_MACRO_GROUPS mirror; conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |
| M-11 | §5 M11 | (Optional) formatCurrency(symbol,decimals) transform kind | none — not requested | owner decision D3 | PASS | D3 ruling 2026-07-22: stamp-only, M11 NOT requested — no work required; row closed by decision |
| M-12 | §5 M12 | OtherGroupSelector content retirement: nodes to ButtonAnswerGroup, choiceDisplay removed | api/migrations/0053 + m12-report.md | content-migrations.test M12 (type flip, choiceDisplay strip, idempotent) | PASS | OtherGroupSelector→ButtonAnswerGroup all-base; choiceDisplay stripped grid-wide; conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |

---

## Routing Semantics (§4.3)

| Row ID | Contract Anchor | Requirement | Implementing Files | Proving Command/Test | Status | Evidence |
|--------|---|---|---|---|---|---|
| R-01 | §4.3-1 | Entities: one shared first page, N funnels, quote-scoped rules, default funnel | resolver.ts/attempt.ts/runtime-routes.ts/quotes-handlers.ts | leadgen-rework-routing.test.ts R-01 (real resolve/attempt/ck paths) + handlers.test | PASS | Reviewer-audited OK; conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |
| R-02 | §4.3-2 | Shared first page evaluated first; entry rules never skip it | resolver.ts/attempt.ts/runtime-routes.ts/quotes-handlers.ts | leadgen-rework-routing.test.ts R-02 (real resolve/attempt/ck paths) + handlers.test | PASS | Reviewer-audited OK; conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |
| R-03 | §4.3-3 | Checkpoint plane: entry-known vs answer-collected vs in-funnel (class c warning) | resolver.ts/attempt.ts/runtime-routes.ts/quotes-handlers.ts | leadgen-rework-routing.test.ts R-03 (real resolve/attempt/ck paths) + handlers.test | PASS | Reviewer-audited OK; conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |
| R-04 | §4.3-4 | First match wins entirely; no merging across rules | resolver.ts/attempt.ts/runtime-routes.ts/quotes-handlers.ts | leadgen-rework-routing.test.ts R-04 (real resolve/attempt/ck paths) + handlers.test | PASS | Reviewer-audited OK; conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |
| R-05 | §4.3-5 | At most one routing outcome per attempt | resolver.ts/attempt.ts/runtime-routes.ts/quotes-handlers.ts | leadgen-rework-routing.test.ts R-05 (real resolve/attempt/ck paths) + handlers.test | PASS | Reviewer-audited OK; conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |
| R-06 | §4.3-6 | Outcome sticky; back-nav answer change does not re-route | resolver.ts/attempt.ts/runtime-routes.ts/quotes-handlers.ts | leadgen-rework-routing.test.ts R-06 (real resolve/attempt/ck paths) + handlers.test | PASS | Reviewer-audited OK; conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |
| R-07 | §4.3-7 | Unmatched visitors enter default funnel when leaving shared page | resolver.ts/attempt.ts/runtime-routes.ts/quotes-handlers.ts | leadgen-rework-routing.test.ts R-07 (real resolve/attempt/ck paths) + handlers.test | PASS | Reviewer-audited OK; conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |
| R-08 | §4.3-8 | Funnel switch resume at first page with unanswered required visible field | resolver.ts/attempt.ts/runtime-routes.ts/quotes-handlers.ts | leadgen-rework-routing.test.ts R-08 (real resolve/attempt/ck paths) + handlers.test | PASS | Reviewer-audited OK; conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |
| R-09 | §4.3-9 | Actions: target_funnel, feed_name, value_multiplier, redirect_pct, redirect_target; ≥1 required | resolver.ts/attempt.ts/runtime-routes.ts/quotes-handlers.ts | leadgen-rework-routing.test.ts R-09 (real resolve/attempt/ck paths) + handlers.test | PASS | Reviewer-audited OK; conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |
| R-10 | §4.3-10 | A/B: equal arms, hashed at funnel entry, no control semantics | resolver.ts/attempt.ts/runtime-routes.ts/quotes-handlers.ts | leadgen-rework-routing.test.ts R-10 (real resolve/attempt/ck paths) + handlers.test | PASS | Reviewer-audited OK; conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |
| R-11 | §4.3-11 | Progress bar: shared + known/default funnel pages; recomputed after switch | P1 server denominator + S2.3 client recompute + parity suites | rework-routing R-11 + endpoint-parity/preview-parity + rework-runtime progress recompute | PASS | Server+client legs complete; P2 gate 2026-07-23: tsc 0 · vitest 415f/6965t · bundle 50,037/51,200 (D1, ledgered) · verify:all 0 · geometry 8/8 chromium+firefox · adversarial SHIP FINAL after F1 (true last-row centering) + F2 (mobile cascade) fix rounds, reviewer live-browser re-proofs |
| R-12 | §4.3-12 | Auction fires after last page of served variant; never on shared page alone | resolver.ts/attempt.ts/runtime-routes.ts/quotes-handlers.ts | leadgen-rework-routing.test.ts R-12 (real resolve/attempt/ck paths) + handlers.test | PASS | Reviewer-audited OK; conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |
| R-13 | §4.3-13 | Section uniqueness: at most once per {shared ∪ any single funnel} | resolver.ts/attempt.ts/runtime-routes.ts/quotes-handlers.ts | leadgen-rework-routing.test.ts R-13 (real resolve/attempt/ck paths) + handlers.test | PASS | Reviewer-audited OK; conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |
| R-14 | §4.3-14 | Delete guards: funnel (default/rule-targeted), template (in-use) | resolver.ts/attempt.ts/runtime-routes.ts/quotes-handlers.ts | leadgen-rework-routing.test.ts R-14 (real resolve/attempt/ck paths) + handlers.test | PASS | Reviewer-audited OK; conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |
| R-15 | §4.3-15 | Activation preflight: default set+active, ≥1 page per funnel, uniqueness, rule targets | resolver.ts/attempt.ts/runtime-routes.ts/quotes-handlers.ts | leadgen-rework-routing.test.ts R-15 (real resolve/attempt/ck paths) + handlers.test | PASS | Reviewer-audited OK; conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |

---

## Component Changes (§6.1–§6.10)

| Row ID | Contract Anchor | Requirement | Implementing Files | Proving Command/Test | Status | Evidence |
|--------|---|---|---|---|---|---|
| C-01 | §6.1 | Add-affordance immediately after component root, outside border, left-aligned | ui-section-studio.ts ghost row + cleanup + margin override | p2-studio gesture (a) both engines + ghost idempotence test | PASS | P2 gate 2026-07-23: tsc 0 · vitest 415f/6965t · bundle 50,037/51,200 (D1, ledgered) · verify:all 0 · geometry 8/8 chromium+firefox · adversarial SHIP FINAL after F1 (true last-row centering) + F2 (mobile cascade) fix rounds, reviewer live-browser re-proofs |
| C-02 | §6.2 | Inspector control matrix: per-type capability flags govern visibility | registry.ts COMPONENT_CAPABILITIES + studio cap() mechanism | leadgen-rework-matrix.test.ts 696/696 (12/12 rows Layer-B, independent transcription) | PASS | P2 gate 2026-07-23: tsc 0 · vitest 415f/6965t · bundle 50,037/51,200 (D1, ledgered) · verify:all 0 · geometry 8/8 chromium+firefox · adversarial SHIP FINAL after F1 (true last-row centering) + F2 (mobile cascade) fix rounds, reviewer live-browser re-proofs |
| C-03 | §6.3 | Per-question label + helper on answer-producing types; render chrome; ≤120 chars | content-schema + presets labelLine ext + studio Basics | rework-schema + rework-render A-6a byte-identity + matrix | PASS | P2 gate 2026-07-23: tsc 0 · vitest 415f/6965t · bundle 50,037/51,200 (D1, ledgered) · verify:all 0 · geometry 8/8 chromium+firefox · adversarial SHIP FINAL after F1 (true last-row centering) + F2 (mobile cascade) fix rounds, reviewer live-browser re-proofs |
| C-04 | §6.4 | Defaults for choice groups: YesNo, Buttons, IconCards, ImageCards via `defaultKindOf` | defaultKindOf 'choice' + schema validation + studio select | rework-schema (accept/∉/multi-reject) + matrix default_kind | PASS | P2 gate 2026-07-23: tsc 0 · vitest 415f/6965t · bundle 50,037/51,200 (D1, ledgered) · verify:all 0 · geometry 8/8 chromium+firefox · adversarial SHIP FINAL after F1 (true last-row centering) + F2 (mobile cascade) fix rounds, reviewer live-browser re-proofs |
| C-05 | §6.5 | Other: enabled flag, label, 1..50 authored choices, deselection logic on base/other | props.other schema + renderer chevron/select + engine mutual-deselect | rework-schema + rework-render + rework-runtime §6.5 both directions | PASS | P2 gate 2026-07-23: tsc 0 · vitest 415f/6965t · bundle 50,037/51,200 (D1, ledgered) · verify:all 0 · geometry 8/8 chromium+firefox · adversarial SHIP FINAL after F1 (true last-row centering) + F2 (mobile cascade) fix rounds, reviewer live-browser re-proofs |
| C-06 | §6.6 | Selected marker: wash/mark per choice/node; pill/button render mark | selected_marker axes + renderer resolution + styles.ts button rule | rework-render §6.6 (choice>node>theme + CSS paints) | PASS | P2 gate 2026-07-23: tsc 0 · vitest 415f/6965t · bundle 50,037/51,200 (D1, ledgered) · verify:all 0 · geometry 8/8 chromium+firefox · adversarial SHIP FINAL after F1 (true last-row centering) + F2 (mobile cascade) fix rounds, reviewer live-browser re-proofs |
| C-07 | §6.7 | Card columns: min(authored, count); last row centered; no ghost cell | min(authored,count) clamp + TRUE centered last row (custom-prop tracks) + mobile collapse intact | rework-render 64/64 exact geometry + p1-geometry mobile partial-row case (fail-before 6→1 track) | PASS | P2 gate 2026-07-23: tsc 0 · vitest 415f/6965t · bundle 50,037/51,200 (D1, ledgered) · verify:all 0 · geometry 8/8 chromium+firefox · adversarial SHIP FINAL after F1 (true last-row centering) + F2 (mobile cascade) fix rounds, reviewer live-browser re-proofs |
| C-08 | §6.8 | Slider types: single, stepper, from_to, dual_range, radial; sub-fields _min/_max | ONE slider entry + slider_type 5-enum + engine behaviors + aria + _min/_max parity | rework-schema + rework-runtime §6.8 + p2-studio (e) | PASS | P2 gate 2026-07-23: tsc 0 · vitest 415f/6965t · bundle 50,037/51,200 (D1, ledgered) · verify:all 0 · geometry 8/8 chromium+firefox · adversarial SHIP FINAL after F1 (true last-row centering) + F2 (mobile cascade) fix rounds, reviewer live-browser re-proofs |
| C-09 | §6.9 | Phone mask: format input, scaffold preview, progressive fill, digit-only input | M8 grammar (parsePhoneMaskPattern) + compile + fill UX + studio builder + lockstep twin + warning | rework-schema mask table (A-10 verbatim) + rework-runtime §6.9 (A-7) + p2-studio (b) + phone-format-warning 10/10 | PASS | P2 gate 2026-07-23: tsc 0 · vitest 415f/6965t · bundle 50,037/51,200 (D1, ledgered) · verify:all 0 · geometry 8/8 chromium+firefox · adversarial SHIP FINAL after F1 (true last-row centering) + F2 (mobile cascade) fix rounds, reviewer live-browser re-proofs |
| C-10 | §6.10 | Address fields: ordered, per-field mode/validation/required, preset, Maps section | fields[] schema/renderer/engine validation + field-set editor + keyless degrade | rework-schema + rework-runtime §6.10 + p2-studio (c) | PASS | P2 gate 2026-07-23: tsc 0 · vitest 415f/6965t · bundle 50,037/51,200 (D1, ledgered) · verify:all 0 · geometry 8/8 chromium+firefox · adversarial SHIP FINAL after F1 (true last-row centering) + F2 (mobile cascade) fix rounds, reviewer live-browser re-proofs |

---

## UI Sections (§8.1–§8.10)

| Row ID | Contract Anchor | Requirement | Implementing Files | Proving Command/Test | Status | Evidence |
|--------|---|---|---|---|---|---|
| U-01 | §8.1 | Section studio deltas: grid removal, palette starter, label/default controls | ui-section-studio.ts §8.1 deltas (grid editors/country list/type-lock removed; starter; matrix controls) | matrix 696 + rework-studio 25 + p2-studio gestures | PASS | P2 gate 2026-07-23: tsc 0 · vitest 415f/6965t · bundle 50,037/51,200 (D1, ledgered) · verify:all 0 · geometry 8/8 chromium+firefox · adversarial SHIP FINAL after F1 (true last-row centering) + F2 (mobile cascade) fix rounds, reviewer live-browser re-proofs |
| U-02 | §8.2 | Funnel builder: library-left, board-center (shared+funnels), rules-right | tbd | tbd | OPEN | — |
| U-03 | §8.3 | Templates tab: elements-left, live canvas, settings, theme/section picker | tbd | tbd | OPEN | — |
| U-04 | §8.4 | Themes tab: live sample, title+subtitle cards, ✓-selected, existing theme-v2 kept | tbd | tbd | OPEN | — |
| U-05 | §8.5 | A/B tab: consolidated test view, control vocabulary removed, delete-variant | tbd | tbd | OPEN | — |
| U-06 | §8.6 | Activation tab: preflight extended per §4.3-15 checks | tbd | tbd | OPEN | — |
| U-07 | §8.7 | Analytics tab: routed_to_funnel and feed_name join drilldown | tbd | tbd | OPEN | — |
| U-08 | §8.8 | Site logo: explicit placeholder chip (A-8); preview link to Site settings | tbd | tbd | OPEN | — |
| U-09 | §8.9 | Dead-code bar: every rebuilt-tab control wired or absent | tbd | tbd | OPEN | — |
| U-10 | §8.10 | P0 golden design pack: geometry, tokens, states, empty states, microcopy | docs/leadgen/rework/design-pack/*.html + strings.md | adversarial §8.10 checklist + conductor live measurements | PASS | 21/21 §8.10 items pinned (review SHIP after F1-F3 fixed); overflow 1280+375 = none on all 4 mocks (live-measured); strings 11/11 byte-verbatim; merged 989c54a (PR #131); owner design sign-off 2026-07-22 |

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
| STR-A4 | Appendix A-4 | Uniqueness block: "'{section}' is already…" | quotes-handlers.ts:2134 | handlers.test verbatim assert | PASS | Byte-exact incl. em-dash; conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |
| STR-A5 | Appendix A-5 | Delete guard (×2): "Can't delete…" / "…it is the target…" | quotes-handlers.ts:1928,1930 | handlers.test verbatim asserts (both forms, blockers named) | PASS | Byte-exact; conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |
| STR-A6 | Appendix A-6 | Unreachable warning: "This rule can never…" | tbd | tbd | OPEN | — |
| STR-A7 | Appendix A-7 | Phone incomplete: "Enter a complete phone…" | engine validation default message | rework-runtime §6.9 verbatim assert | PASS | Byte-exact; P2 gate 2026-07-23: tsc 0 · vitest 415f/6965t · bundle 50,037/51,200 (D1, ledgered) · verify:all 0 · geometry 8/8 chromium+firefox · adversarial SHIP FINAL after F1 (true last-row centering) + F2 (mobile cascade) fix rounds, reviewer live-browser re-proofs |
| STR-A8 | Appendix A-8 | Logo placeholder: "No logo — set it…" | tbd | tbd | OPEN | — |
| STR-A9 | Appendix A-9 | Canvas fixture: "Sample section…" | tbd | tbd | OPEN | — |
| STR-A10 | Appendix A-10 | Mask pattern error: "Format must be…" | parsePhoneMaskPattern error | rework-schema invalid-table verbatim asserts | PASS | Byte-exact; P2 gate 2026-07-23: tsc 0 · vitest 415f/6965t · bundle 50,037/51,200 (D1, ledgered) · verify:all 0 · geometry 8/8 chromium+firefox · adversarial SHIP FINAL after F1 (true last-row centering) + F2 (mobile cascade) fix rounds, reviewer live-browser re-proofs |
| STR-A11 | Appendix A-11 | Rules ≥1 action: "Pick at least one…" | quotes-handlers.ts:688 | handlers.test verbatim assert | PASS | Byte-exact; conductor gate 2026-07-22: tsc 0 · vitest 410f/6124t · db:reset 0001→0053 clean · verify:all exit 0 (bundle 46,008) · money-path 10f/311t · adversarial SHIP (final, delta re-verified) |

---

## Decisions (§13)

| Row ID | Contract Anchor | Requirement | Implementing Files | Proving Command/Test | Status | Evidence |
|--------|---|---|---|---|---|---|
| D-1 | §13 D1 | Runtime byte cap: recommend 51,200 (50 KiB), FINAL, per-feature ledger | decisions-D1-D5.md | P0 consolidated review | PASS | Owner 2026-07-22: 51,200 FINAL + per-feature ledger |
| D-2 | §13 D2 | Existing routing rules: migrate intact or drop (owner choice) | decisions-D1-D5.md | P0 consolidated review | PASS | Owner 2026-07-22: MIGRATE + re-pointing report |
| D-3 | §13 D3 | Feed Name consumer: name downstream use (offer field? S2S param?) | decisions-D1-D5.md | P0 consolidated review | PASS | Owner 2026-07-22: STAMP-ONLY (no extra consumer; M11 not requested) |
| D-4 | §13 D4 | Site logos: code renders; uploads are owner task or name source | decisions-D1-D5.md | P0 consolidated review | PASS | Owner 2026-07-22: logo_media_id CONFIRMED; uploads = OP-2 (operator) |
| D-5 | §13 D5 | Auction-domain rules UI: relocate to Auction tab or Advanced drawer | decisions-D1-D5.md | P0 consolidated review | PASS | Owner 2026-07-22: AUCTION TAB |

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
- **OPEN:** 86 rows (implementation rows)
- **BLOCKED-operator:** 4 rows (operator tasks OP-1..OP-4)
- **PASS:** 7 rows (U-10, M-11-by-decision, D-1..D-5) — conductor-written with executed evidence
