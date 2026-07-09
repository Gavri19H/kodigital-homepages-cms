# 00 · Executive Summary

**Contract name:** LeadGen CMS — Quote & Section Authoring Redesign Contract v2.5.1
**Type:** strict, implementation-ready **authoring-model correction contract**. It corrects the logical boundary between Quote/Funnel page design and Section question-unit design, and rebuilds both builders around that boundary. It does **not** change the runtime auction, analytics, payload, or activation architecture.
**Revision:** v2.5.1 is a targeted **consistency pass** over the directionally-approved v2.5 (changes C1–C7 below, full mapping in `17`). No architecture redesign; no new tables.
**Final status:** **READY FOR IMPLEMENTATION — AFTER USER APPROVAL.** Every row is *Specified*, nothing is implemented.

## Identity & sources of truth

| Item | Value |
|---|---|
| Target repo | `Gavri19H/kodigital-homepages-cms` · Worker `kodigital-homepages-cms-worker` |
| Inspection baseline | `main @ 7e3f290` (`7e3f2905a10e…`) — re-verify HEAD at kickoff; a newer main must be re-inspected before use |
| Prior contracts | v2.3.7 (`docs/leadgen/contract/*`, PRs #72–#87) · Operational Fix Contract v2.4 (`docs/leadgen/fix-contract-v2.4/*`) — both remain binding except where this contract explicitly amends them (each amendment is called out inline as **AMENDS v2.4 §x**) |
| Evidence basis | Direct code inspection of `api/src/admin/leadgen/*`, `api/src/public/leadgen/*`, `api/src/public/listicle/serve.ts` (branding precedent), `api/migrations/0036–0040`, docs. Findings table with file:line evidence in `01`. Operator screenshots remain **capability examples only** — never design references |
| Citation forms | `NN §x` = this package · `v2.4 NN §x` = fix-contract-v2.4 · `v2.3.7 NN §x` = original contract |

## The one-sentence problem

The v2.4 Section Studio made the Section canvas able to build **whole pages** (HeaderBar, FooterBar, BackgroundPanel, ProgressBar, HeaderLogo, BackButton placeable per Section), while the Quote Builder remained a **form** (a design `<select>`, ordered name rows, raw-JSON rule textareas) — so the page shell is authored in the wrong tool, per slide, with duplicated headline entry, hex-exposing token dropdowns, and no site branding inheritance.

## The correction (normative, detailed in `02`–`03`)

- A **Section** is the reusable **Question Unit**: question copy, answer controls, local media/helpers, validation, dependencies, Offer field mapping, local continue behavior. Nothing else.
- A **Quote/Funnel** owns the **Page Frame** and **Funnel Theme**: header + auto-bound site logo, advertising disclosure, progress, back/previous, footer/legal, trust strips, background, global typography/palette/spacing, section-slot geometry, responsive frame behavior.
- **Runtime composes** `QuoteFrame(siteBranding, funnelTheme, frameConfig, progressState, sectionSlot: SectionQuestionUnit(currentSection))` — one composition path shared byte-identically by runtime shell, Quote preview, and Section in-frame preview (`13`).
- Token priority (normative, `09`): design defaults → Funnel theme → Variant frame overrides → Section local overrides → Component overrides → runtime state.

## Ten binding decisions (each argued at its section)

| # | Decision | Where |
|---|---|---|
| D1 | ONE canonical Section headline/subheadline: the existing `leadgen_sections.headline_text`/`subheadline_text` columns stay canonical; canvas headline components become **bound nodes** (`bind:"section_headline"`) that render the column and edit it in place; the Quote-preview duplicate `<h2>` is removed | `03`, `05` |
| D2 | Frame + theme storage is an **additive migration 0041** — `leadgen_funnels.frame_config_json` + `leadgen_funnels.theme_json` + `leadgen_funnel_variants.frame_overrides_json`. Inspection proves no existing column can host them (`leadgen_funnels` has zero JSON columns). `NULL` = legacy frame (today’s bare shell) — zero backfill | `03`, `12` in `01` table |
| D3 | The frame is **config-driven regions**, not a second component canvas. `frame_config_json` describes header/progress/back/disclosure/footer/trust/background/section-slot; a new pure `designs/frame.ts` renders it by **reusing the existing chrome presets** (`renderProgressBar`, `renderHeaderLogo`, …) | `04`, `13` |
| D4 | Site logo auto-binds from `site_settings.logo_media_id` (fallback `site_logo_url`, then text `site_name`) — the exact listicle `brandFromSettings` HostLogo pattern; safe to bake into the shell because the shell cache key is already site-scoped (same argument as the baked GA4 id) | `10` |
| D5 | Component catalog gains a `scope: "frame"\|"unit"\|"both"` field. Frame-scope types leave the Section palette; their presets are reused by `frame.ts`. Legacy Sections containing them still render; save emits **warnings**, activation preflight surfaces them, and a one-click "Move to Quote frame" assistant migrates them | `08` |
| D6 | Color UX becomes **semantic roles** (Brand primary, Accent, Page background, …). `design_overrides` values become role names; legacy stored hex still resolves (values starting `#` = literal, flagged deprecated). Hex editing exists only in the theme’s Advanced token administration | `09` |
| D7 | Progress, Back, Footer, Disclosure, Trust logos are **frame regions** computed from Funnel Variant section order; Section-local variants remain possible only as explicit Advanced placements marked "local" | `11` |
| D8 | Choices deepen additively: `title`, `subtitle`, `badge`, `image_alt`, `emoji`, `disabled`, `aria_label` join `LeadgenChoice`; Image cards get media picker + upload + existing AI-image leg (`ai-api.ts` precedent) + alt-text requirement | `08` |
| D9 | Inspector becomes **scope-aware**: an explicit "what you are editing / what it affects" header, scope chips (Funnel frame · This slide · Selected component · Selected choice), operator language, ids/JSON only under Advanced | `07` |
| D10 | Continue: the Section keeps `continue_mode` (button/auto-advance); the frame owns default Continue placement + style; the Section may override label/style locally. **Exactly ONE `data-lg-continue` control per visible Section in both placements** (`11 §11.5`) | `05`, `11` |

## v2.5.1 consistency pass (what changed from v2.5)

| # | Change | Where |
|---|---|---|
| C1 | Provider output values are **per Offer** — the Choices tab never shows a universal provider value; editing lives in the Mapping tab, per-Offer rows only | `07 §7.3`, `12 §12.2`, `05 §5.5` |
| C2 | `frame_scope_component` stays a save warning in draft/edit but **blocks activation** when a Quote Frame is configured, unless the funnel’s Advanced legacy override `compat.allow_section_chrome` is set (JSON field in existing frame config — no new table) | `03 §3.3/3.5`, `14 §14.1`, `04 §4.4` |
| C3 | **Single-DOM Continue rule:** exactly one `data-lg-continue` per visible Section; `below_unit` moves the control to the end of the section subtree and suppresses the in-node visual | `11 §11.5`, `13 §13.1/13.4` |
| C4 | Quote preview site selector lists **all CMS sites** with activation badges (Active / Activation off / Not activated yet / CMS fallback); preview works pre-activation, servability unchanged | `10 §10.5`, `04 §4.6` |
| C5 | Frame template switching gets normative **merge rules** (content preserved, layout replaced), confirmation triggers, and **preview-before-apply** | `04 §4.3`, `13 §13.4` |
| C6 | Wording: Section Builder says “Section / question unit”; “slide” is Quote-Builder vocabulary for a Section’s position in a Funnel Variant; reuse is always shown | `02 §2.4`, `06 §6.1`, `07`, `15 §15.2` |
| C7 | Trust/logo/legal affordances are labeled **“inside this question unit”** in the Section Builder vs **“funnel-wide”** in the Quote Builder — same renderers, unmistakable scope | `08 §8.2/8.3`, `04 §4.4` |

## What does NOT change (binding preserve list)

`leadgen_` tables (additive columns only) · Offer payload schemas · Section answer maps (`leadgen_section_answer_maps`) · Quote → Funnel → Funnel Variant (`funnel_id lgf_` ≠ `funnel_variant_id lgn_`, never aliased) · Auction configs + engine · runtime event schema (§22) · the 9 D1 analytics mirrors ↔ 9 ClickHouse targets · `/lg/config` + `/lg/attempt` + attempt signing · site-level activation (`leadgen_site_quotes`) · Offer region rules vs Auction answer rules separation · v2.4 payload-builder, macro/computed, and runtime-engine work · server-rendered sections + hydration engine architecture (v2.4 Q1) · no arbitrary CSS · no raw JSON in normal designer flows · admin shell conventions.

## Package manifest

`00` this summary · `01` current UX/product failure analysis (+ evidence table) · `02` corrected mental model + glossary · `03` entity boundary + data/ownership contract · `04` Quote Builder redesign · `05` Section Builder redesign · `06` canvas + toolbar · `07` inspector · `08` component library · `09` theme/token/palette · `10` site branding + logo inheritance · `11` progress/back/footer/disclosure · `12` Offer mapping integration · `13` preview + runtime composition · `14` activation + validation · `15` testing & QA · `16` implementation phases · `17` traceability matrix · `18` final acceptance checklist.

Compiled document: **“LeadGen CMS — Quote & Section Authoring Redesign Contract v2.5.1 Full.html”.** On adoption, copy this package into the repo at `docs/leadgen/redesign-contract-v2.5/` (v2.5.1 supersedes v2.5 in place) and track progress in `17` + `docs/leadgen/traceability.md`.
