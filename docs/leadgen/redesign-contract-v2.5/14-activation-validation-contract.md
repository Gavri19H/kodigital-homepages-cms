# 14 · Quote Activation and Validation Contract

The existing activation preflight (v2.4: recompute-on-activate, `computeQuoteActivationPreflight`, normative 409 report, mapping gates R5) is PRESERVED. v2.5 adds frame/theme/branding checks and adopts the `problems[]` shape (`03 §3.6`) alongside the existing report body (additive).

## 14.1 New preflight checks (per funnel/variant under the Quote)

| Check | Severity | Copy pattern (operator language) |
|---|---|---|
| `frame_config_json` fails schema validation (unknown template, bad enum, unsafe href) | **error** (blocks) | “The funnel’s page frame has an invalid setting: {sentence}. [Open Quote Builder]” |
| `theme_json` invalid (unknown role, malformed) | **error** | “The funnel theme has an invalid value: …” |
| Variant `frame_overrides_json` invalid | **error** | per-variant message |
| Site logo unresolvable while `header.logo_source="site"` | warning | `10 §10.4` copy + fix link to site Settings |
| Section contains frame-scope components (`frame_scope_component`) while the funnel HAS a configured frame AND `compat.allow_section_chrome` is **false** (default) | **error** (blocks, C2) | “Slide {n} ‘{name}’ contains page-frame elements (header/progress/footer/logo) that would render twice on the live page. Remove them ([Move to Quote frame]) or enable the legacy override under Advanced. [Review slide]” |
| Same, but `compat.allow_section_chrome` is **true** (Advanced legacy override, per funnel) | warning | “Legacy override is ON for this funnel: slide {n} keeps its own page chrome — it may appear twice. [Review]” |
| Multiple Continue buttons in one Section (`duplicate_continue`) | warning | “Slide {n} has more than one Continue button — only the first is shown.” |
| Section-local progress/back (Advanced escapes) | warning | `11 §11.1` |
| Bound headline missing AND no visible headline node in a Section | warning | “Slide {n} shows no question headline.” |
| Legacy hex literals in overrides | warning | count + “[Convert to theme colors]” |
| Contrast lint failures in theme (`09 §9.3`) | warning | role pair named |
| Trust-strip logo missing `alt` | **error** | accessibility copy |

Blocking policy: structural invalidity blocks (schema-invalid frame/theme/overrides, missing alt) **and so does double-chrome risk** (C2): `frame_scope_component` with a configured frame is the one UX-class error that ships a visibly broken live page, so it blocks by default; the per-funnel Advanced override `compat.allow_section_chrome` downgrades it to a warning. Everything stylistic remains a warning — activation stays operator-decidable. Mapping/R5 gates unchanged and still blocking. In draft/edit (Section save), `frame_scope_component` remains a WARNING — the escalation happens only at publish/activation.

## 14.2 Where verdicts surface

- Quote Builder top-bar publish chip (existing) re-labeled with counts: “Blocked (2 errors)” / “Ready (3 warnings)”.
- Activation tab lists `problems[]` grouped by scope with fix links (each `fix_url` deep-links: frame region, theme editor, Section studio node anchor `#q-{question_id}`, site settings).
- `PUT /quotes/:id/activation/:site_id` 409 body: existing normative report + `problems`.

## 14.3 Save-time validation (before preflight)

- `PUT /funnels/:id/frame|theme` and variant overrides validate synchronously (400 + `problems`) — an invalid frame is never persisted, so preflight structural errors can only arise from drift (registry/template changes), which the check still catches.
- `PATCH /sections/:id` continues its existing validation; new codes from `03 §3.4` (`bind_*`) are errors; `frame_scope_component` is a warning.

## 14.4 No-regression guarantees

Activating a legacy Quote (NULL frame/theme) produces zero NEW errors or warnings from this contract (all new checks are conditional on the new data existing — including the C2 chrome BLOCK, which requires a configured frame; with `frame_config_json` NULL, chrome-in-section stays a save-time warning only). Proven by a dedicated vitest fixture (`15 §15.2`).
