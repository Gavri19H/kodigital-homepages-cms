# LeadGen Round-4 Remediation — Traceability Register

Program truth: investigation report `LEADGEN-ROUND4-INVESTIGATION-2026-07-19.md` (workspace root, outside repo) +
the approved plan (7 phases). Conductor-only writes. Status ∈ {OPEN, PASS (executed evidence cited), BLOCKED (operator-owned)}.
Round-4 decision log (operator, 2026-07-19): D-1 cap 44,032 · D-2 routing rules reference-faithful (checkpoint, ≤1 hop,
route_funnel_variant + value_multiplier + redirect) · D-3 FULL pages model · D-6 listicles scrolling-class only ·
D-4/5/7 footer/AI-image/theme-v2 in full · flow-decided: phone presets, CTA slots, free-text floor, SVG sanitizer,
lifecycle parity.

| Row | Operator item / defect | Phase | Status |
|---|---|---|---|
| R4-01 | #1 list tables overflow unreachable (all LeadGen tabs + Listicles) | P1d | OPEN |
| R4-02 | #2 actions parity: kebab + duplicate/archive/reactivate/usage/delete-guarded (sections/quotes/auctions) | P1c+P1d | OPEN |
| R4-03 | #3 Question grid unusable from picker (seed drops rows; ghost grows invisible choices; no affordance) | P1a+P1b | OPEN |
| R4-04 | #4A rules UX flow direction (source above → dependent below) | P4b | OPEN |
| R4-05 | #4B/4C grid rows as rule condition sources end-to-end (via picker path) | P1a | OPEN |
| R4-06 | #4D complex rules AND/OR (ANY/ALL groups, client+server parity) | P2a+P2c | OPEN |
| R4-07 | #4E every component mapped: Address sub-fields + NameFields as rule sources | P1a | OPEN |
| R4-08 | #5 two "When answered" controls → one | P1a | OPEN |
| R4-09 | #6A field chrome: label above + helper below + in-box error, ALL text-like inputs | P1b | OPEN |
| R4-10 | #6B phone format author-defined (NANP/E.164-intl/IL/custom) | P2b+P2c | OPEN |
| R4-11 | #6C/6D Address = real composite w/ Maps at component level, pre-mapped autofill roles | P1a+P1b | OPEN |
| R4-12 | #7 single-column (1) authorable everywhere + clamp/validation alignment | P1b | OPEN |
| R4-13 | #8 section-name affordance + plain-language save errors (no raw ids) | P1a+P1c | OPEN |
| R4-14 | #9 "+ Add choice" out of layout flow (live==edit geometry) | P1a+P1b | OPEN |
| R4-15 | #10A activity/verticals dropdowns on New Quote (existing endpoints) | P5b | OPEN |
| R4-16 | #10B real site-logo preview + no-logo hint | P5a | OPEN |
| R4-17 | #10C phone/CTA element: 4 slots, alignment, tel:, conditional display (page/answer/state/hour/day) | P2a+P5a | OPEN |
| R4-18 | #10D progress bar v2: distinct styles incl. icon-on-track/%/numbered; editor layout fixed | P5a+P5b | OPEN |
| R4-19 | #10E free-text elements above/below section, rich floor, page targeting | P5a | OPEN |
| R4-20 | #10F brand-logos organizer + sanitized SVG upload | P5a+P5c | OPEN |
| R4-21 | #10G rich elements: trust/benefit icon+text rows + hover tooltip + AI persona image (quota) | P5a+P5c | OPEN |
| R4-22 | #10H footer v2 full builder (blocks, own palette/typography, per-site vars) | P5a | OPEN |
| R4-23 | #10H-adj disclosure v2 (multi-location, per-location text/mode/align) | P5a | OPEN |
| R4-24 | #10I theme v2: fonts (self-hosted), display-XXL, button ranges (Img38-40), presets+DELETE, theme A/B | P6a+P6b | OPEN |
| R4-25 | #10J funnel structure panel broken layout | P3b | OPEN |
| R4-26 | Restructure: Templates+Themes top tabs + 7 box pickers | P5b | OPEN |
| R4-27 | Restructure: rules UNIFIED into funnel-builder (standalone tab removed) | P4b | OPEN |
| R4-28 | Funnel delta A: page order changeable per funnel name | P3a+P3b | OPEN |
| R4-29 | Funnel delta B: FULL pages model (multi-section pages, in-page A/B, in-page slot rules) | P3a+P3b | OPEN |
| R4-30 | Funnel delta C: funnel-level A/B surfaced (Add variant, what-varies, allocation) | P6b | OPEN |
| R4-31 | Funnel delta D: theme picker per funnel name | P6b | OPEN |
| R4-32 | D-2 routing rules: checkpoint model, ≤1 hop, precedence ladder, server-validated checkpoint endpoint | P4a+P4b | OPEN |
| R4-33 | A/B tab = whole-quote template-level testing | P6b | OPEN |
| R4-34 | B-4.1 MQG save trap (orphan choices → unexplainable 400) | P1a+P1b | OPEN |
| R4-35 | B-4.2 MQG row-1 headline mislabel in pickers | P1a | OPEN |
| R4-36 | B-4.3 call button phone-only renders nothing | P1d | OPEN |
| R4-37 | B-4.4 unreachable clipped columns (body overflow-x hidden) | P1d | OPEN |
| R4-38 | B-4.5 quotes archive dead-end (no reactivate) | P1c+P1d | OPEN |
| R4-39 | B-4.6 Address rule-invisibility + no internal_field seed + Accept type-swap allowed | P1a | OPEN |
| R4-40 | B-4.7 "Numbered" progress style fake (== Bar) | P5a | OPEN |
| R4-41 | B-4.8 columns stored-vs-rendered drift (no server validation; clamp mismatch) | P1b | OPEN |
| R4-42 | B-4.9 headline_text raw-id jargon in save errors | P1c | OPEN |
| R4-43 | D-1 cap raise 44,032 + per-feature byte ledger | P2a | OPEN |
| R4-44 | §19.1 binding: page_plan_hash + checkpoint validation + re-issue on switch | P3a+P4a | OPEN |
| R4-45 | Round-4 acceptance journeys (sections + quotes suites, both engines) | P7a | OPEN |
| R4-OP1 | Production deploys (post-P1 optional; program end) | operator | BLOCKED |
| R4-OP2 | Staging hands-on acceptance (terminal gate) | operator | BLOCKED |
| R4-OP3 | OpenAI spend/quota + GOOGLE_MAPS_SERVER_KEY sign-off | operator | BLOCKED |

## Phase log
_(conductor appends per phase: gates run + counts, review verdict, PR, merge SHA)_
