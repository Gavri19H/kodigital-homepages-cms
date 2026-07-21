# LeadGen Round-4 Remediation — Traceability Register

Program truth: investigation report `LEADGEN-ROUND4-INVESTIGATION-2026-07-19.md` (workspace root, outside repo) +
the approved plan (7 phases). Conductor-only writes. Status ∈ {OPEN, PASS (executed evidence cited), BLOCKED (operator-owned)}.
Round-4 decision log (operator, 2026-07-19): D-1 cap 44,032 [AMENDED 2026-07-20: 45,056, then FINAL 46,080 — operator-approved consolidated amendment; funds same-screen pages + P4 checkpoint leg + margin; no further raises this program; P5/P6 add zero engine bytes by design] · D-2 routing rules reference-faithful (checkpoint, ≤1 hop,
route_funnel_variant + value_multiplier + redirect) · D-3 FULL pages model · D-6 listicles scrolling-class only ·
D-4/5/7 footer/AI-image/theme-v2 in full · flow-decided: phone presets, CTA slots, free-text floor, SVG sanitizer,
lifecycle parity.

| Row | Operator item / defect | Phase | Status |
|---|---|---|---|
| R4-01 | #1 list tables overflow unreachable (all LeadGen tabs + Listicles) | P1d | PASS (P1, evidence: phase log P1) |
| R4-02 | #2 actions parity: kebab + duplicate/archive/reactivate/usage/delete-guarded (sections/quotes/auctions) | P1c+P1d | PASS (P1, evidence: phase log P1) |
| R4-03 | #3 Question grid unusable from picker (seed drops rows; ghost grows invisible choices; no affordance) | P1a+P1b | PASS (P1, evidence: phase log P1) |
| R4-04 | #4A rules UX flow direction (source above → dependent below) | P4b | PASS (P4, evidence: phase log P4) |
| R4-05 | #4B/4C grid rows as rule condition sources end-to-end (via picker path) | P1a+P7fix | PASS (P7 8832bbc: shared collectKnownAnswerFields unifies studio/save/activation; acceptance Item-4 live green; fail-before/pass-after) |
| R4-06 | #4D complex rules AND/OR (ANY/ALL groups, client+server parity) | P2a+P2c | PASS (P2, evidence: phase log P2) |
| R4-07 | #4E every component mapped: Address sub-fields + NameFields as rule sources | P1a+P7fix | PASS (P7 8832bbc: activation now expands Address/Name/MQG + validates composed shapes — composed rules no longer skip validation) |
| R4-08 | #5 two "When answered" controls → one | P1a | PASS (P1, evidence: phase log P1) |
| R4-09 | #6A field chrome: label above + helper below + in-box error, ALL text-like inputs | P1b | PASS (P1, evidence: phase log P1) |
| R4-10 | #6B phone format author-defined (NANP/E.164-intl/IL/custom) | P2b+P2c | PASS (P2, evidence: phase log P2) |
| R4-11 | #6C/6D Address = real composite w/ Maps at component level, pre-mapped autofill roles | P1a+P1b | PASS (P1, evidence: phase log P1) |
| R4-12 | #7 single-column (1) authorable everywhere + clamp/validation alignment | P1b+P7fix | PASS (P7 61a6f35: both Columns pickers offer 1-5 + label fixed; acceptance Item-7 green). MultiChoiceCardGroup renderer clamp aligned 1..5 (P7fix-mcg 21e00e5, verified presets.ts) |
| R4-13 | #8 section-name affordance + plain-language save errors (no raw ids) | P1a+P1c | PASS (P1, evidence: phase log P1) |
| R4-14 | #9 "+ Add choice" out of layout flow (live==edit geometry) | P1a+P1b | PASS (P1, evidence: phase log P1) |
| R4-15 | #10A activity/verticals dropdowns on New Quote (existing endpoints) | P5b | PASS (P5, evidence: phase log P5) |
| R4-16 | #10B real site-logo preview + no-logo hint | P5a | PASS (P5, evidence: phase log P5) |
| R4-17 | #10C phone/CTA element: 4 slots, alignment, tel:, conditional display (page/answer/state/hour/day) | P2a+P5a | PASS (P5, evidence: phase log P5) |
| R4-18 | #10D progress bar v2: distinct styles incl. icon-on-track/%/numbered; editor layout fixed | P5a+P5b | PASS (P5, evidence: phase log P5) |
| R4-19 | #10E free-text elements above/below section, rich floor, page targeting | P5a | PASS (P5, evidence: phase log P5) |
| R4-20 | #10F brand-logos organizer + sanitized SVG upload | P5a+P5c | PASS (P5, evidence: phase log P5) |
| R4-21 | #10G rich elements: trust/benefit icon+text rows + hover tooltip + AI persona image (quota) | P5a+P5c | PASS (P5, evidence: phase log P5) |
| R4-22 | #10H footer v2 full builder (blocks, own palette/typography, per-site vars) | P5a | PASS (P5, evidence: phase log P5) |
| R4-23 | #10H-adj disclosure v2 (multi-location, per-location text/mode/align) | P5a | PASS (P5, evidence: phase log P5) |
| R4-24 | #10I theme v2: fonts (self-hosted), display-XXL, button ranges (Img38-40), presets+DELETE, theme A/B | P6a+P6b+P7fix | PASS (P7 fc41ae2: root cause was NOT cache — a frameless funnel ignored its theme; now a funnel with an explicit theme_id + null frame renders via a minimal headerless default frame so the PRESET theme applies; acceptance Item-10I live green, zero blast, legacy pin intact). RESIDUAL→R4-47 |
| R4-25 | #10J funnel structure panel broken layout | P3b | PASS (P3, evidence: phase log P3) |
| R4-26 | Restructure: Templates+Themes top tabs + 7 box pickers | P5b | PASS (P5, evidence: phase log P5) |
| R4-27 | Restructure: rules UNIFIED into funnel-builder (standalone tab removed) | P4b | PASS (P4, evidence: phase log P4) |
| R4-28 | Funnel delta A: page order changeable per funnel name | P3a+P3b | PASS (P3, evidence: phase log P3) |
| R4-29 | Funnel delta B: FULL pages model (multi-section pages, in-page A/B, in-page slot rules) | P3a+P3b | PASS (P3, evidence: phase log P3) |
| R4-30 | Funnel delta C: funnel-level A/B surfaced (Add variant, what-varies, allocation) | P6b | PASS (P6, evidence: phase log P6) |
| R4-31 | Funnel delta D: theme picker per funnel name | P6b | PASS (P6, evidence: phase log P6) |
| R4-32 | D-2 routing rules: checkpoint model, ≤1 hop, precedence ladder, server-validated checkpoint endpoint | P4a+P4b | PASS (P4, evidence: phase log P4) |
| R4-33 | A/B tab = whole-quote template-level testing | P6b | PASS (P6, evidence: phase log P6) |
| R4-34 | B-4.1 MQG save trap (orphan choices → unexplainable 400) | P1a+P1b | PASS (P1, evidence: phase log P1) |
| R4-35 | B-4.2 MQG row-1 headline mislabel in pickers | P1a | PASS (P1, evidence: phase log P1) |
| R4-36 | B-4.3 call button phone-only renders nothing | P1d | PASS (P1, evidence: phase log P1) |
| R4-37 | B-4.4 unreachable clipped columns (body overflow-x hidden) | P1d | PASS (P1, evidence: phase log P1) |
| R4-38 | B-4.5 quotes archive dead-end (no reactivate) | P1c+P1d | PASS (P1, evidence: phase log P1) |
| R4-39 | B-4.6 Address rule-invisibility + no internal_field seed + Accept type-swap allowed | P1a | PASS (P1, evidence: phase log P1) |
| R4-40 | B-4.7 "Numbered" progress style fake (== Bar) | P5a | PASS (P5, evidence: phase log P5) |
| R4-41 | B-4.8 columns stored-vs-rendered drift (no server validation; clamp mismatch) | P1b | PASS (P1, evidence: phase log P1) |
| R4-42 | B-4.9 headline_text raw-id jargon in save errors | P1c | PASS (P1, evidence: phase log P1) |
| R4-43 | D-1 cap raise 44,032 + per-feature byte ledger | P2a | PASS (P2, evidence: phase log P2) |
| R4-44 | §19.1 binding: page_plan_hash + checkpoint validation + re-issue on switch | P3a+P4a | PASS (P3+P4: signed binding, dual-accept, checkpoint validation + re-issue, completion pinning) |
| R4-45 | Round-4 acceptance journeys (sections + quotes suites, both engines) | P7a | PASS (P7 c80bdef: both engines real — chromium full journeys 11/9/5, firefox authoring legs 11/9/5 with liveLegChromiumOnly live-leg skips; conductor-confirmed both engines) |
| R4-46 | Gate1c visual baselines re-mint — DONE: 7/7 states re-minted + conductor-visual-confirmed healthy (each read by own eyes; cumulative P1/P5/P6 intended drift, no regression). Was — last minted @ d8da7b7 (round-3 close, pre-round-4); cumulative P1-P6 intended rendering drift (P1 section-builder rewrite + P5 frame elements + P6 fonts). Conductor visual-confirms each diff, re-mints all states, part of staging sign-off. NOT a P6 regression (P6 touched no Sections files; drift proven pre-P6 via mint history). NOT a CI gate (Playwright solo-only). | P7b | PASS (conductor-visual-confirmed re-mint) |
| R4-47 | INLINE-themed frameless funnel (theme via the inline Themes-tab editor, no saved-preset theme_id) still renders un-themed — same class as 10I, narrower. REACHABLE first-session flow (new funnel is frameless by default → inline theme edit writes theme_json w/ NO theme_id → un-themed live). The PRESET path IS fixed+live (fc41ae2, Item 10I green) — this residual is the INLINE-without-preset path only. Safe auto-frame for it needs the SQL-NULL-vs-corrupt distinction (R4-48) so it never breaks the corrupt-frame fail-safe. WORKAROUND (one click): save the inline theme as a preset → apply. Sign-off package carries the exact repro + workaround for the operator's ruling. | operator-decision | BLOCKED (operator: fix in a scoped follow-up, or accept the save-as-preset workaround) |
| R4-48 | Money-path fail-safe: fc41ae2's default-frame synthesis fires on parse-null (covers BOTH SQL-NULL and CORRUPT frame_config_json), so a corrupt frame + theme_id now renders framed instead of byte-legacy — weakening the leadgen-frame-serve invariant "a corrupt stored frame must never alter a revenue-serving page". Fix: gate synthesis on a TRUE SQL-NULL only; corrupt frame stays byte-legacy. | P7 | PASS (P7 0820437: synthesis gated on true SQL-NULL; corrupt frame stays byte-legacy; fail-before/pass-after; frame-serve+legacy-pin 11/11) |
| R4-OP1 | Production deploys (post-P1 optional; program end) | operator | BLOCKED |
| R4-OP2 | Staging hands-on acceptance (terminal gate) | operator | BLOCKED |
| R4-OP3 | OpenAI spend/quota + GOOGLE_MAPS_SERVER_KEY sign-off | operator | BLOCKED |

## Phase log

### P1 — unblock batch (2026-07-20)
- Slices: P1a ui-section-studio (ababbe9, dc06b55) · P1b presets/schema/styles (4b5a325, b75e66c) · P1c server/lifecycle (1009b90, 679f0f0, 4bc4600, 3943892, 42945b3) · P1d layout/lists/frame-CTA (e88ac01, 7b9c232, c0b957a, c371593).
- Conductor gates (own hand, explicit cwd, fresh D1): tsc 0 · vitest 394 files / 5,692 tests pass==total · P1 specs 29/29 (__p1a both engines, __p1b 6, __p1d 15) · adapted suites r4a-pipeline 9/9 + listicles-sections 5/5 · operator acceptance 24/24 both engines · verify:all green (bundle byte-identical 42,874/44,032 cap pending P2; jargon 0; golden 0 unclassified) · diff-scope == ownership tables · origin/main drift 0.
- Adversarial review (fresh Opus): FIX-FIRST (1 MAJOR gate-fidelity + 4 minor) → all five fixed in-phase (4 commits) → delta re-verify **SHIP**, all findings RESOLVED, no new conflict.
- Notable in-phase catches: Archive-button-wired-to-hard-DELETE safety bug; kebab clip/stacking → body portal; FK cascade harness-vs-prod divergence probe; TOCTOU closed via atomic conditional DELETE; duplicate collapses A/B to control.
- Disclosure for operator/staging: section DELETE is now a real hard delete when unreferenced (guarded 409 otherwise); append-only analytics rows for deleted sections survive by design.
- PR: https://github.com/Gavri19H/kodigital-homepages-cms/pull/124 · merge: 07cf9a9

### P2 — cap raise + runtime logic (2026-07-20)
- Slices: P2a cap+groups+ctx (ed53842, 8ae24e7, f53718a, ec675a6) · P2b phone presets + authoring widening (6945ed6, db0ed14) · P2c studio builders (0f9dfcf) · formatPhone warning (1d05d5e).
- Conductor gates (own hand): tsc 0 · vitest 397/5,766 pass==total · 40/40 phase+guard specs (cross-engine where registered) · operator acceptance 24/24 both engines · verify:all green · bundle 44,005/44,032 (freshness byte-identical) · diff-scope == ownership · drift 0.
- Byte ledger: 42,874 → +178 groups → +663 ctx → +269 phone → +21 ReDoS cap = 44,005 (27 spare). P2 consumed ~2× projections → **P3a MUST open with a measured ≥450B dead-code trim commit or STOP for a D-1 re-decision** (reviewer-acknowledged process gate).
- Adversarial review: FIX-FIRST (2 MAJOR: client-side ReDoS on custom phone regex; ledger exhaustion) + 4 minor → ReDoS closed save+runtime (fail-before proven), __ prefix reserved (3 surfaces), formatPhone×preset incoherence warning (existing Problems mechanism), ledger owned as the P3a trim gate → delta re-verify **SHIP**, no new conflict.
- Notes for P5a dispatch: ctx conditions must be scoped display-only OR the section-gating consequence explicitly accepted (reviewer minor-5). Non-NANP answers store the typed validated string (downstream normalization rides per-offer transforms; ties to the operator's open E.164 residue).
- PR: https://github.com/Gavri19H/kodigital-homepages-cms/pull/125 · merge: 11d78c5

### P3 — FULL pages model (2026-07-20)
- Slices: P3a backend+engine (16 commits: trim rounds -587B+-58B, 0042 migration+wrap, server plan resolution @ /lg/attempt signed binding, ctx emission (closes P2 seam), same-screen pages + one-Continue-per-page + maps-meta ownership (operator-definition corrections), atomic pre-minted writes, sections-replace coherence, fork/duplicate page fidelity, auction re-resolution REMOVED per review) · P3b structure panel v2 (02c527f, 3c38fae — pages-first rows, slot editors incl. ruled UI leg, 10J CSS fix).
- Operator D-1 amendments: 45,056 → FINAL 46,080 (consolidated; measured costs 3-5x projections). Bundle: 45,121/46,080 (959B headroom for P4).
- Conductor gates (own hand): tsc 0 · vitest 398/5,791 pass==total · 46+ phase/guard specs green · operator acceptance 24/24 both engines · verify:all green · deploy.yml 0042 anchor verified · drift 0.
- Adversarial review: FIX-FIRST (MAJOR-1 auction-side plan re-resolution FALSE-REJECTED legit conversions at hour boundaries — repro'd, removed as redundant-with-HMAC, no-false-reject regression pinned fail-before/pass-after; MAJOR-2 missing auction-side page-model matrix — added; fork flattening + ruled-UI leg minors) → delta re-verify **SHIP**, no new conflict.
- Verified-clean by review: wrap migration, byte-identical serve gate, slot-rule field-scope un-bypassable, signed binding evolution (v1-downgrade blocked), .bind() discipline, admin auth on new CRUD.
- PR: https://github.com/Gavri19H/kodigital-homepages-cms/pull/126 · merge: b1b01a6

### P4 — funnel routing rules (2026-07-20)
- Slices: P4a backend (fa50da3, 19be2bb, c20cc6c, a18724e, eb1969c, 32990e8, 51eb78e, b3abd57 + the P3a deflake f18f8c5 riding here) · P4b builder (99be8a1, 60dad9e).
- Delivered: rule model v2 (name/priority/status/ANY-ALL over the full field registry incl. MQG rows + state/device/UTM/hour/weekday); 0043 CHECK-recreation + 0044 redirect_pct (backfill 100 preserves live behavior); entry routing pre-A/B; server-validated /lg/ck checkpoint (binding-first, ≤1 hop, prefix resume, re-issued binding); S2S multiplier REPLACES base — proven through the REAL conversion path after the review caught a hand-injected false-green; completion pinned to routed_to_variant (stale origin tokens rejected); post-switch beacon re-stamp; redirect % gated + sticky; status/enabled coherent at every plane; the Image42 unified builder (by-NAME pickers, no raw ids, standalone Rules tab removed, rules embedded in the funnel builder).
- Conductor gates (own hand): tsc both configs 0 · vitest 399/5,864 pass==total (zero failures) · 34/34 phase+guard specs (P3a sticky spec root-caused: session-restore feature vs wrong test assumption — no product race) · acceptance 24/24 both engines · bundle 46,079/46,080 byte-identical freshness · deploy.yml 0043+0044 anchored · drift 0.
- Adversarial review: FIX-FIRST (MAJOR: value_multiplier dead in production behind a hand-injected green test — the exact producer→consumer false-green class; + completion-ownership, fallback-widening, answer-injection, migration-coverage minors; cap provenance clarified) → all fixed with fail-before/pass-after each → delta re-verify **SHIP**, no new conflict.
- Pre-deploy note: 0044 was authored+extended pre-merge on this branch only (never applied to any shared D1) — single-apply integrity holds.
- PR: https://github.com/Gavri19H/kodigital-homepages-cms/pull/127 · merge: 5dd0f11

### P5 — templates/frame elements + Quotes IA (2026-07-21)
- Slices: P5a frame elements (21e1245,0ea0c2d,8511af5,e095ead,f58f6c2,6b8cc46 + engine legs 6f2ce20/b011e51) · P5b Quotes IA (d5a2c0c,8790377,42eee29) · P5c security (dae707e,f71e1bf,19cb4ec).
- Delivered: free-text rich blocks (page-targeted, sanitized) · brand-logo strips · disclosure v2 (multi-location+hover) · CTA slots with LIVE conditional display (server-verdict + client applier) · FIVE distinct progress styles (numbered≠bar, R4-40 fixed) · footer block builder (own palette scope) · real site-logo preview + no-logo hint · trust/benefit rows · first-class ai_image/persona element · Templates+Themes TOP tabs + EIGHT box pickers · activity/verticals dropdowns · progress-editor layout fix. SVG sanitizer (allowlist re-serializer) closes ALL THREE upload routes + nosniff; AI persona gen with ATOMIC D1 quota (reserve-before-spend); free-text sink hardened to an allowlist re-serializer.
- ENV INCIDENT: original /private/tmp worktree destroyed by macOS midnight tmp-cleanup mid-phase; ALL commits recovered from main repo's git; rebuilt at durable /Users/guyhaikov/a2z-workspaces/kodigital-cms-round4-wt. Lesson saved (project-worktree-tmp-cleanup-hazard).
- Conductor gates (own hand): tsc both 0 · vitest 403/5,997 pass==total · every P5+guard spec green IN ISOLATION (socket-exhaustion flake on combined runs — environmental, drained between runs) · acceptance 24/24 both engines · bundle 46,008/46,080 byte-identical · 0045 anchored · drift 0.
- Adversarial review (security-weighted): FIX-FIRST (2 MAJOR both live-proven: free-text stored XSS via the shared strip-sanitizer — reviewer broke it 5 ways; persona quota check-then-increment race; + SVG attr-name emit minor) → allowlist re-serializer (articles sanitizer untouched) + atomic D1 quota + positive attr-name class → delta re-verify **SHIP** (reviewer's 23-payload run: 0 leaks).
- Verified-clean by review: SVG element/href/url() vectors (29/29 + attr-name); all 3 upload routes + nosniff; AI paths SVG-incapable; key never logged; ??/?. conversions falsy-safe; R4-40 genuinely distinct.
- PR: https://github.com/Gavri19H/kodigital-homepages-cms/pull/128 · merge: 9c8ed0b

### P6 — theme v2 (2026-07-21)
- Slices: P6a schema+fonts+resolver (2453dc8,7bc47e6,9b553ce,f8de6f4 + ThemeRecord widening 0992752) · P6b theme-manager UI (919e631 + v2-axes consumption f590f03).
- Delivered (D-7): SELF-HOSTED curated fonts (8 OFL families, WOFF2 data: @font-face, ZERO external requests — network-asserted) · display-XXL size ramp (~72px live, Image37) · button-style sub-schema (fill/outline+shadow/two-line-list/icon-card-selected — Images 38-40, computed-style-distinct) · display-vs-body clarity · presets carry the FULL v2 richness (ThemeRecord widened; resolveTokens record-branch byte-parity with inline) with save/apply/DELETE (in-use guard scans funnels AND variants) · per-funnel theme picker · one-click theme A/B fork · A/B tab reframed (Add-variant + what-varies + allocation). Runtime engine bundle byte-identical 46,008 (fonts are static, not in engine JS).
- Conductor gates (own hand): tsc both 0 · vitest 404/6,031 pass==total · all P6+guard specs green IN ISOLATION (socket-flake truncates combined runs — full counts verified via --list: __p6a 3/3, __p6b 8/8, __p5a 10/10, __p5b 7/7, acceptance 24/24 both engines) · verify:all clean · drift 0.
- PROCESS NOTE (conductor error, caught+recovered): P6a's ThemeRecord-widening round was dispatched onto the shared worktree while P6b's round sat UNCOMMITTED (P6b reported "tree clean" but hadn't committed) — a shared-worktree contention hazard. Recovery: snapshotted P6b's 6 files non-git before any concurrent git op, kept P6a committing surgically (add by explicit path, never -A), committed P6b's protected work, serialized the remaining round. No work lost; commit history coherent (verified by review). Lesson reinforced: [[feedback-no-parallel-git-stash-shared-worktree]].
- Adversarial review: **SHIP first pass** (rare) — every D-7 row proven at the real boundary, no false-green patterns; one non-blocking UX-comment observation (3+-arm fork drafts Σ≠10000, blocked at experiment-start gate — polish, not a defect).
- PR: https://github.com/Gavri19H/kodigital-homepages-cms/pull/129 · merge: 018a51b