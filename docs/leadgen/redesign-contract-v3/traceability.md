# LeadGen CMS Section Builder & Themes — Contract v3.1 Traceability

**Program**: LeadGen CMS Section Builder & Themes, Design-Locked Build Contract v3.1

**Target Repository**: Gavri19H/kodigital-homepages-cms

**Baseline SHA**: 4521647

**Contract Source**: Claude Design project file "LeadGen CMS - Section Builder Build Contract v3.1 Design-Locked.html"

**Adoption Date**: 2026-07-12

---

## Design Element Traceability Matrix

| Row | Design element | § | Storage | Gate | Status | Evidence |
|-----|---|---|---|---|---|---|
| 1 | Four-region shell & geometry | 2 | — | 1, 3 | PENDING | |
| 2 | Token set (color/type/space) | 3 | admin token module | 1, 3 | PENDING | |
| 3 | Canonical headline (strip ↔ canvas) | 4 | `headline_text`/`subheadline_text` | 2, 4 | PENDING | |
| 4 | Icon-tile library, merged Answer fields | 5 | — | 1, 2, 4 | PENDING | |
| 5 | Primitive collapse (Text/Image) | 5.3 | `props.role`/`props.source` | 4 | PENDING | |
| 6 | No disabled / no headline tiles | 5.4 | — | 4 | PENDING | |
| 7 | Direct-manipulation selection + handles | 6 | — | 1, 4 | PENDING | |
| 8 | Frame hint | 6.3 | — | 1 | PENDING | |
| 9 | Presets vs manual custom + Reset | 7 | `design_overrides.size` | 1, 4 | PENDING | |
| 10 | Scope header, pills, affects lines | 8.1 | — | 2 | PENDING | |
| 11 | Dynamic tab matrix | 8.2 | — | 4 | PENDING | |
| 12 | Field Content controls | 8.3 | node `props` | 2, 4 | PENDING | |
| 13 | Inheritance tags (continue/style) | 8.4-8.5 | theme (read) | 2 | PENDING | |
| 14 | Role-based color, no hex | 8.5 | `design_overrides` roles | 2, 4 | PENDING | |
| 15 | Offers per-Offer mapping | 8.7 | `section_answer_maps` | 4 | PENDING | |
| 16 | Advanced (ids/JSON only here) | 8.8 | read-mostly | 2 | PENDING | |
| 17 | Google Maps jobs + warning | 9 | `props.maps` | 2, 4 | PENDING | |
| 18 | Themes manager + roles + size language | 10 | `lg-funnel-themes` | 1, 2, 4 | PENDING | |
| 19 | A/B theme per variant | 10.1, 10.5 | `theme_json`/`frame_overrides_json` | 4 | PENDING | |
| 20 | Preview-theme switcher | 10.6 | preview `theme_id` | 1, 4 | PENDING | |
| 21 | Runtime = preview parity | 12 | shared renderer | 4 | PENDING | |
| 22 | Search synonyms (data-name) | 5.5 | — | 2, 4 | PENDING | |
| 23 | Insert semantics / Accept-swap | 5.6 | node `type` swap | 4 | PENDING | |
| 24 | Style tab per selection + enumerations | 8.5b | node `props`/`design_overrides` | 2, 4 | PENDING | |
| 25 | Markup parity vs Artifact D | 13 Gate 1a | — | 1 | PENDING | |
| 26 | Source-validated schema claims | 11.0 | cited lines | 4 | PENDING | |

---

## ERRATA

1. **§1.3 assumed migration 0041 not landed** → it landed on main and is byte-equal to §11.1; no migration work in this program.

2. **§11.5 `leadgen_sections.name`** → actual column is `section_name`.

3. **§10.1 "KV namespace lg-funnel-themes"** → implemented as key "lg-funnel-themes" in the shared CACHE KV binding, matching the cited v2.5.1 presets precedent (readComponentPresets / key "lg-component-presets").

4. **TextBlock/ImageBlock absent from the registry pre-build** → they are the new §5.3 primitives introduced by this program.

5. **The golden master's A/B assignment panel is read-only presentation** → theme assignment is storage/API only (PROPOSED per §0 rule); Gate 4 probes it at API level.

6. **§11.3's worked example nests `required` under `props`, but the repository's real, already-wired mechanism stores it at node top-level (`node.required`, read by hydration + the field renderers). The v3.1 schema validates the top-level field and REJECTS `props.required` as invalid — same repo-reality-over-contract-text precedent as erratum (2) (`name`→`section_name`). Contract §11.3's literal example would therefore fail validation; authoring must use top-level `required`. No Gate-4 storage probe tests `required` placement, so no acceptance impact.**

---

## CONTRACT GAPS (un-sourced values — resolve before the dependent gate)

Values the golden master and contract do not specify. Per §0.1 these are recorded as gaps, never invented in code. Until the dependent phase supplies a real design-token value, the resolver accepts and resolves them as DATA but emits NO fabricated dimension (the field falls through to base CSS).

| Gap | Contract ref | Current behavior | Resolve in |
|-----|--------------|-------------------|------------|
| Width preset `s` | §7.1/§8.5b | resolver returns preset name; no explicit width emitted | Phase B (Style-tab S/M/L width design tokens) |
| Width preset `m` | §7.1/§8.5b | same | Phase B |
| Width preset `l` | §7.1/§8.5b | same | Phase B |
| Height preset `small` | §7.1/§8.5b | resolver returns preset name; no explicit height emitted (golden `fieldBoxStyle` is padding-only `16px 18px`, no height term) | Phase B (Small/Medium/Large height design tokens) |
| Height preset `medium` | §7.1/§8.5b | same | Phase B |
| Height preset `large` | §7.1/§8.5b | same | Phase B |

GROUNDED and emitted exactly: width `full`→`width:100%` (golden `fieldWrapStyle` non-custom branch; = 100% of the 600 unit column, Appendix B); `custom_px`→explicit `{axis}:{px}px` (§7.2, clamp [200,600], snap 4px). Absent size → no style (byte-identical to pre-v3.1).

---

## OPERATOR-OWNED (Status: BLOCKED)

| Item | Gate | Status | Notes |
|------|------|--------|-------|
| Production deploy via workflow_dispatch | 1c | BLOCKED (operator) | Frozen-baseline design sign-off (manual visual QA of the 7 states); post-deploy D3/D4 behavioral verification required |
| GOOGLE_MAPS_BROWSER_KEY / GOOGLE_MAPS_SERVER_KEY production secrets | 9 | BLOCKED (operator) | Production secrets management; not in wrangler.toml |
| Live A/B theme activation on a real quote | 10 | BLOCKED (operator) | Live funnel variant assignment with theme override |
| Frozen-baseline design sign-off | 1c | BLOCKED (operator) | Manual visual QA of 7 required states before CI baseline lock |
