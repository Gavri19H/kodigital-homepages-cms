# 04 · Quote Builder Redesign Contract

Rebuild `ui-quotes.ts` (route `/admin/leadgen/quotes/:id` unchanged) from a form into the funnel/page-frame design studio. Existing tabs Rules · A/B · Activation · Analytics are PRESERVED (Rules additionally adopts the v2.4 06 §6.10 visual condition builder in place of the raw JSON textarea — same evaluator, no schema change). The **Funnel builder** tab is replaced by the frame studio below.

## 4.1 Layout (exact panels)

**Top bar:** Quote name (inline edit) · status pill · Activity (read-only chip) · Verticals chips · **Funnel selector** · **Variant selector** (+ fork) · activation status chip · **Preview site selector** (`10 §10.5`) · Save · Publish/Activate (runs preflight, `14`).

**Left panel — Funnel structure:** ordered Section list (name, vertical chip, mapping-status dot, drag handle + ↑/↓, remove) · "+ Add Section" (picker filtered by Quote activity — existing derivation) · final-Section/auction marker (existing `§15.3 max position` rule, re-labeled “Auction runs after this slide”) · A/B variant switcher (arms + allocation, links to A/B tab) · link to Rules tab.

**Center — Frame canvas:** the REAL composed page: `renderQuoteFrame(...)` output in an iframe (`13 §13.3` preview endpoint), showing the currently-selected Section inside the section slot. Clickable regions — each frame region renders `data-frame-region="header|logo|disclosure|progress|back|background|trust_strip|benefit_bar|footer|section_slot"`; click selects the region, outlines it, and opens its inspector. Clicking inside the section slot shows a banner: “This area is the Section’s question unit — edit it in the Section Builder [Open Section]”.

**Right — Frame inspector:** context panel per selected region (`§4.4`). Header shows scope explicitly: “Editing: **Funnel frame — Progress** · affects every slide of this funnel” (`07` rules apply).

**Canvas toolbar (top of canvas):** Frame template selector (visual thumbnails) · Theme button (opens theme editor, `09 §9.3`) · Desktop/Mobile toggle (real widths 1280/375, reuses §8.9 semantics) · Preview mode: **Current slide / Step through all slides** (all-slides mode renders every Section sequentially in the SAME frame with working progress states) · Preview site selector (mirrors top bar) · A/B variant selector (mirrors top bar).

## 4.2 Funnel Theme (summary — normative detail in `09`)

Theme editor edits `theme_json`: palette roles (visual swatch grid) · typography (display/body from the curated font list + size scale s/m/l) · spacing scale (compact/regular/roomy) · radius scale (sharp/soft/round) · shadow level (none/low/mid/high) · button defaults (background role, text role, radius, min-height, casing) · card defaults (background role, border role, radius, shadow) · icon style. Every control shows a live mini-preview. Absent keys inherit from the base design (`funnel_design_id`).

## 4.3 Frame templates (registry `designs/frames.ts` — code, not DB)

Each template = named defaults for every `frame_config_json` group + a region arrangement. Minimum set (each maps to a capability pattern, `08 §8.7`):

| Template id | Arrangement (desktop) | Defaults highlights |
|---|---|---|
| `centered` | logo top-center → progress → centered card slot → trust strip → legal footer | Pattern A (reference-style) |
| `header-footer` | site header (logo+tagline+secure) → progress → bare slot → LARGE site footer | Pattern B |
| `header-cta` | disclosure top bar → logo center + call CTA → progress → slot → benefit bar → back link | Pattern C |
| `full-background` | brand background → logo → step dots → white card slot → legal footer | Pattern D |
| `white-trust` | white page → minimal header → slot → bottom trust bar | Pattern A/B hybrid |
| `minimal` | clean header → progress → back → bare slot, no footer | Pattern E |

### Template switching — merge + confirmation rules (C5)

Switching templates is a per-GROUP three-way merge (computed by the same `effectiveFrame` machinery, `13 §13.2`):

| Class | Fields | Rule on switch |
|---|---|---|
| **Operator content** | copy (tagline, back/CTA labels, disclosure text, trust text, footer description, benefit items), media (`logo_media_id`, trust logos + alts, background image), legal links, theme palette roles | **PRESERVED verbatim** |
| **Layout / position** | region positions, progress style+position defaults, `section_slot` geometry, alignment, spacing defaults, `sticky` | **REPLACED** by the new template’s defaults |
| **Region availability** | per-group `enabled` flags | preserved where the target template supports the region; unsupported-but-enabled → confirmation |

**Confirmation is REQUIRED when:** (a) an enabled region is not part of the target template — the dialog names exactly what stops rendering (“Benefit bar isn’t part of ‘centered’ — its 3 items are kept but won’t show”); (b) `section_slot.card` behavior changes (card ⇄ bare); (c) a manual logo or background image would stop rendering. **Data is never deleted by a switch** — unsupported groups stay in `frame_config_json` inert and revive on switching back.

**Preview-before-apply:** the template picker renders the composed result (current Section, current preview site, current viewport) BEFORE commit via `POST /variants/:id/preview` with the additive `draft_frame_config` body param (`13 §13.4`); nothing persists until Save. Unknown template id in STORED JSON → `centered` + warning (mirror of the design-registry fallback rule).

## 4.4 Region inspectors (exact controls; all copy plain-language)

- **Header:** on/off · logo source (Site logo (auto) / CMS fallback / Manual — manual is Advanced-gated and stamps `problems` warning “Manual logo overrides site branding”) · logo size s/m/l · alignment · tagline text · secure badge toggle+text · call CTA toggle+label+tel/href · show disclosure link · sticky.
- **Progress:** style (hidden/bar/dots/numbered/percent — visual radio thumbnails) · position · thickness · width · color role swatch · show label. Note under panel: “Progress counts the slides of this funnel variant automatically.”
- **Back:** style (hidden/text/icon+text/button) · position · label. Note: “Hidden automatically on the first slide.”
- **Disclosure:** on/off · location · link label · panel text (plain textarea, escaped).
- **Footer:** on/off · show on (every slide/first/final/never) · links source (From site settings / Manual list) · manual links editor (label+href rows) · trust text · description · show logo · hide on mobile.
- **Trust strip (labeled “funnel-wide”, C7):** on/off · source (manual/site logo set) · logo list (media picker rows + REQUIRED alt) · placement · mobile behavior.
- **Benefit bar (labeled “funnel-wide”):** on/off · items (icon picker + text) · placement.
- **Background:** role swatch · optional image (media picker) · flat/brand/brand-gradient.
- **Section slot:** max width · card/bare · padding · vertical offset · allow Section-local card · transition · Continue placement (inside unit/below unit) + Continue style role. Note: “Continue is only shown when the current Section uses button mode.”
- **Compatibility (Advanced, collapsed — C2):** “Allow slides to keep their own page chrome (legacy)” → `compat.allow_section_chrome` (`03 §3.3`). Consequence sentence shown inline: “ON: publishing warns instead of blocking when slides contain their own header/progress/footer — the live page may show them twice.”

Every inspector field maps 1:1 to a `frame_config_json` key (`03 §3.3`); no free CSS, no free hex, no raw JSON anywhere on this surface. **Scope labeling rule (C7):** shared affordances (trust points, logo rows, secure badge, legal note) are labeled **“funnel-wide” here** and **“inside this question unit” in the Section Builder** (`08 §8.3`) — same renderers, unmistakable scope.

## 4.5 Variant frame overrides (A/B)

When a non-control Variant is selected, region inspectors show an **override switch** per group: “Same as funnel (default) / Override for this variant”. Overrides write the sparse `frame_overrides_json`; overridden groups get a variant badge in the canvas. Theme palette roles may be overridden the same way (`frame_overrides_json.theme.palette.*`). The A/B tab lists overridden groups per arm.

## 4.6 Preview (summary — endpoint contract in `13 §13.3`)

Modes (all server-rendered through the ONE composition path): frame-only (slot placeholder) · current Section in frame · all Sections stepped (prev/next + real progress) · desktop/mobile · per-site branding (site selector = **ALL CMS sites with status badges**, `10 §10.5`) · per-variant. Preview uses the SAME `renderQuoteFrame` + `renderSectionComponents` code as `/lg` serving — parity by construction.

## 4.7 Save / dirty model

One Save button persists: funnel `frame_config_json` + `theme_json` (PUT `/funnels/:id/frame`, `/funnels/:id/theme`), variant `frame_overrides_json` + section order (existing PUT `/variants/:id` extended additively with `frame_overrides_json`). Unsaved-changes guard preserved. Save bumps `content_version` on active variants (`03 §3.1` cache rule) and re-runs the preflight chip.

## 4.8 API (repo route conventions — flat entity paths, AMENDS mission’s nested sketch)

| Route | Contract |
|---|---|
| `GET /api/admin/leadgen/funnels/:id/frame` | `{frame_config, effective_frame, template_defaults}` — `effective_frame` = template ⊕ stored config (what preview uses) |
| `PUT /api/admin/leadgen/funnels/:id/frame` | body `{frame_config_json}`; server validates schema `03 §3.3`; 400 + `problems[]` on violation; bumps variants’ `content_version` |
| `GET /api/admin/leadgen/funnels/:id/theme` | `{theme, effective_tokens}` (resolved role→value table for the editor swatches) |
| `PUT /api/admin/leadgen/funnels/:id/theme` | body `{theme_json}`; same validation/versioning rules |
| `GET /api/admin/leadgen/frame-templates` | registry projection: id, label, thumbnail HTML, per-group defaults |
| `POST /api/admin/leadgen/variants/:id/preview` | EXTENDED (additive body params): `{site_id?, viewport?, mode?: "frame"|"section"|"all", section_public_id?, draft_frame_config?, draft_theme?}` → `{preview:{css, html, pages?:[…]}, config}`; `draft_*` params render WITHOUT persisting (template preview-before-apply, §4.3); legacy body → byte-identical legacy response (regression-pinned) |
| `GET /api/admin/leadgen/sites/:site_id/branding` | `10 §10.5` |

Handlers live in `quotes-handlers.ts` (or a new `frame-handlers.ts` if size demands); routes registered static-before-param per `03 §8.1` discipline.
