# Product-Core Remediation Register (program of 2026-07-16)

Truth file for the Section Builder product-core remediation. Evidence base:
`/Users/guyhaikov/a2z-workspaces/SECTION-BUILDER-PRODUCT-CORE-INVESTIGATION-2026-07-16.md`
(six-stream investigation, adversarially roasted, all citations verified). Plan of record:
`~/.claude/plans/use-the-claude-design-mcp-elegant-alpaca.md` (approved 2026-07-16).
Rows are closed ONLY by the conductor after own-hand gate verification + phase review SHIP.
Status vocabulary: OPEN · FIXED-PENDING-REVIEW · CLOSED (evidence cited) · BLOCKED-OPERATOR.

## Decision log (operator, LOCKED 2026-07-16)
- **R-A** Theme = design language BETWEEN components; freedom INSIDE (per-element size/color/position + deliberate off-theme overrides).
- **R-B** Drag = defining custom locations (components AND elements), not slot exchange.
- **D1** Positioning = structured placement (drag-beside→columns, alignment/size tokens/nudge; auto mobile stacking; NOT arbitrary-pixel).
- **D2** Multi-question grid (Image9 reference) = build now (P5).
- **D3** Enforcement = CLIENT-SIDE ("block the user continue option until valid answer is inserted"); no server mirror by operator ruling; direct-API traffic unvalidated by design.
- **D4** Runtime cap raised to 43,008 B (42 KiB), gates re-armed at the new value (lands first commit of P4).
- Icon set = Tabler (MIT), curated build-time subset (conductor decision per solve-don't-ask).

## A. Operator items (their 12, from the 2026-07-16 message + Images 1–14)
| Row | Item | Phase | Proving gate | Status |
|---|---|---|---|---|
| PC-1 | Buttons: reference 2-col grid, gutters, centered, sized (Image1 vs 2) | P1a | geometry gate: 2-col, equal ±1px, gap==token, centered (both engines, studio+live) | FIXED (review SHIP; geometry gate both engines) — operator staging pending |
| PC-2 | Drag = defining custom locations (R-B) | P3a+P3b | both-engine gesture: form/break element rows, alignment applied, saved-model + rendered proof | OPEN |
| PC-3 | Yes/No reference-quality + default inter-component spacing (Image3 vs 4) | P1a | yes/no equal cells; EVERY adjacent pair gap == theme token (P10 probe inverted) | FIXED (review SHIP; every-pair floor incl. CardPanel/BackgroundPanel) — operator staging pending |
| PC-4 | Contact per-field controls; When-answered conflicts; Required tested; Accept criteria (Image5) | P4a/P4b/P4d | NameFieldsGroup per-field props render; stuck-funnel unauthorable; required+format block Continue with visible message; criteria matrices | OPEN |
| PC-5 | Date: helper, dynamic Min/Max (today/+7d/year), validated static input (Image6) | P4b | date-type gate: token bounds resolve, garbage unauthorable, range blocks with message | OPEN |
| PC-6 | "If it's wrong, say" proven | P4b | custom message renders on failure with zero extra authoring (error-slot-by-default gate) | OPEN |
| PC-7 | Number Step logic (502 trap; step on text fields) | P4b | step only on number, stepper/nearest-valid UX, Accept-swap cleans stale props | OPEN |
| PC-8 | Deletion: toast-without-removal; sharpen delete UX (Image7) | P4d (+P1c toast placement) | delete==removal always; choice-delete atomic; undo works; toast anchored at canvas | OPEN |
| PC-9 | "New Section" overlaps button (Image8) | P1c | create-flow chrome gate: no overlap at any viewport | FIXED (review SHIP; no-overlap gate 1280/1600) — operator staging pending |
| PC-10 | Multi-question grid w/ defaults (Image9 vs 10) | P5a | component renders labels/rows/defaults per reference; per-row answers live | OPEN |
| PC-11 | Cards: layout control, responsive, icon library, icon sizes (Image11 vs 12/13) | P1a+P1b+P2 | 48px icons, square cells, columns, responsive (P1) + per-element style freedom (P2) | FIXED (P1+P2 reviews SHIP) — operator staging pending |
| PC-12 | Rules: names not ids; show/hide; when-answered interplay; conditional continue (Image14) | P4c (+P4a) | sentence-builder w/ display names; Carrier scenario live; conditional Continue; conflict save-rules | OPEN |

## B. Additional defects (found by the investigation's active hunt)
| Row | Defect | Phase | Status |
|---|---|---|---|
| PC-A1 | auto_advance + ≥2 visible interactive = stuck funnel (live-proven) | P4a | OPEN |
| PC-A2 | Errors invisible without hand-authored ValidationError node | P4b | OPEN |
| PC-A3 | Step min-anchored rejection trap | P4b | OPEN |
| PC-A4 | Phone = any 7–15 digits (no NANP) | P4b | OPEN |
| PC-A5 | Garbage date bounds save silently + disable native constraint | P4b | OPEN |
| PC-A6 | Containers unselectable on canvas | P3b | OPEN |
| PC-A7 | Choice Backspace deletes whole group | P4d | OPEN |
| PC-A8 | NameFieldsGroup hides field-family controls (subfields not selectable; no per-field props) | P4d | OPEN |
| PC-A9 | Silent-failure pattern: preview fetch no-op; invalidation swallowed | P1c | FIXED (review SHIP; preview-failure banner+retry; server-side invalidation half stays P4) — operator staging pending |
| PC-A10 | Three-way drift: registry vs inspector table vs renderer (Range/SearchableDropdown helper; TextBlock icon; fictional date validation claim) | P4d (+P4b date) | OPEN |
| PC-A11 | Dead engine state: continue_blocked/blocking_question_ids computed, never read | P4a (remove or wire) | OPEN |
| PC-A12 | MultiChoiceCardGroup ignores authored columns (hardcoded 2) | P1a | FIXED (review SHIP; authored columns honored) — operator staging pending |

## C. Phase log
_(appended by the conductor per phase: branch, slices, gate outcomes with counts, review verdict, PR)_

**P2 (2026-07-17) — per-element theme freedom (axiom R-A). Adversarial review: FIX-FIRST (1 MAJOR + 3 minors + 1 pre-existing discovery) → all fixed in-phase → re-review SHIP.** Branch `product-core/p2-element-freedom`, 4 commits (schema+renderer 3eae79a · effect gate 1e5596c · styles seam + studio popover f964b14 · fix round d69ea9d). Delivered: `LeadgenChoice.style` (+yes/noStyle) — per-element size/color/text-color/emphasis with palette-role vocabulary + off-theme hex escape; diff-only cascade theme←node←choice (anti-Wix regression suite proves roles follow palette re-points while hex freezes); state-PERSISTENT per-choice paint (authored colors hold through hover/selected — review MAJOR killed the 1.09:1 invisible-hover-label; measured 3.49:1 after); studio palette-first popover + Off-theme badge + per-property reset; align-items scoped to authored sizes only. BONUS pre-existing defect fixed: live selection paint was INERT (runtime `.lg-selected` vs CSS `[aria-checked]` mismatch) — selectors fixed CSS-side, click-to-paint regression live. Conductor gates at final HEAD: tsc 0 · vitest 5,366/5,366 (378) · Playwright 352 listed, conductor shards 133+109+110 green · bundle BYTE-IDENTICAL 40,908 · census/jargon clean · back-compat byte gate green (unstyled content renders identically). Operator staging note: authored color pairings are free per R-A — a studio contrast hint is a candidate polish item.

**P1 (2026-07-17) — layout system + rhythm + Tabler icons + editor chrome. Adversarial review: SHIP (initial SHIP w/ 1 MINOR + coverage note → both fixed in-phase → re-review FINAL SHIP).** Branch `product-core/p1-layout`, 15 commits (P1b icons 47d939b · P1a layout ef9037a/ce17564 + collapse-emulation d39946e + tidy 57b26fe · P1c chrome 781eb09 + PW_PORT sweep 2a03dfb · consolidated baselines/firefox 70c324a/61d5831/b22e9b7 · [hidden] fix 8d13ba9 · re-mint caaa18c · gate calibration a81fb92 · CardPanel floor + 9-surface coverage a543bd8). Conductor gates at final HEAD: tsc 0 · vitest 5,337/5,337 (376) · Playwright 330 listed (per-shard verified) · verify:all green (runtime BYTE-IDENTICAL 40,908 · jargon 0 · census 0 unclassified/0 stale). THREE bonus product defects found+fixed in-phase with fail-before evidence: (1) conditionally-hidden grid components rendered VISIBLE live (author display beats UA [hidden] — terminal scoped guard + 9-surface gate); (2) Back button visible on step 1 (same class; baselines had certified the bug); (3) the v25 visual gate was blind to element-sized regressions (ratio budget ≈2,345px → absolute 200px with executed fail-proof + 3× stability). Known-accepted: Stack/Grid/Columns own their internal gaps by design; live gesture legs chromium-only (documented engine constraint); patterns-v25 livePages diagnostic cascade recorded for follow-up. Operator staging acceptance = the terminal gate before deploy.

## D. Operator-owned (BLOCKED, never PASS)
Deploy per phase/close · staging hands-on acceptance (TERMINAL definition of done) · off-theme-badge + new-copy sign-off · manual QA · P1 live-render change ships only after staging sign-off.
