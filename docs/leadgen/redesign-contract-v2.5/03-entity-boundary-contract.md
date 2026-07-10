# 03 · Entity Boundary Contract (data + ownership)

## 3.1 Storage decision (D2 — argued from inspection)

Mission guidance: prefer existing JSON columns; add fields only if code inspection proves existing columns cannot support the model cleanly.

**Inspection verdict:** `leadgen_funnels` has **zero** JSON columns (`db-types.ts` LeadgenFunnelRow: id, public_id, quote_id, funnel_name, active_ab_test_id, status, timestamps). `leadgen_funnel_variants` JSON columns are lander-semantic (`lander_body_json`, `lander_cta_json`) — reusing them for frame data would overload unrelated semantics and break the lander feature. `leadgen_sections.design_overrides_json` is Section-scoped. `leadgen_site_quotes.settings_overrides_json` is activation-scoped (per-site), wrong owner for a funnel-wide frame. **Therefore an additive migration is REQUIRED** — this is the clean minimum:

### Migration `0041_leadgen_frame_theme.sql` (additive, forward-only, no backfill)

```sql
ALTER TABLE leadgen_funnels ADD COLUMN frame_config_json TEXT;          -- NULL = legacy frame
ALTER TABLE leadgen_funnels ADD COLUMN theme_json TEXT;                 -- NULL = base design only
ALTER TABLE leadgen_funnel_variants ADD COLUMN frame_overrides_json TEXT; -- NULL = no overrides
```

- Frame + theme live on the **Funnel** (stable identity) so every Variant of a Funnel shares one design language by default; Variants override narrowly for A/B (`frame_overrides_json` is a sparse deep-merge patch of `frame_config_json` + `theme_json.palette`, `13 §13.2`).
- `funnel_design_id` (on the Variant) is PRESERVED as the base visual design selector; unknown id → default (existing rule). It is not moved in v2.5 (moving it is a breaking change with no operator value).
- `NULL` semantics = exact current behavior (bare shell, chrome from Sections). No data migration, no behavior change for existing funnels until an operator configures a frame.
- Cache correctness: `frame_config_json`/`theme_json` edits MUST bump the served identity. Decision: saving frame/theme bumps `content_version` on every ACTIVE variant of the funnel (the existing shell/config cache axes already key on `content_version`; no new cache key axis).

## 3.2 Ownership tables (normative field map)

The mission’s conceptual fields map onto storage as follows (left = mission name, right = where it lives):

| Mission field | Storage |
|---|---|
| `funnel_design_id` | `leadgen_funnel_variants.funnel_design_id` (unchanged) |
| `funnel_theme_id` / global tokens | `leadgen_funnels.theme_json` (inline, versioned `{version:1}`) — no separate theme table in v2.5; named shareable themes are a later concern |
| `frame_layout_id` | `frame_config_json.template` |
| `frame_config_json`, `header_config_json`, `progress_config_json`, `back_nav_config_json`, `footer_config_json`, `disclosure_config_json`, `trust_bar_config_json`, `section_slot_config_json`, `mobile_frame_config_json`, `desktop_frame_config_json` | ONE column `leadgen_funnels.frame_config_json` with keyed groups (`header`, `progress`, `back`, `disclosure`, `footer`, `trust_strip`, `benefit_bar`, `background`, `section_slot`, `mobile`) — one column, one validator, one PUT |
| `default_component_styles_json` | `theme_json.button_defaults` / `theme_json.card_defaults` |
| `site_branding_policy_json` | `frame_config_json.header.logo_source` + `10 §10.3` policy fields |
| Section `canonical_question_headline` / `canonical_question_subheadline` | EXISTING `leadgen_sections.headline_text` / `subheadline_text` (renamed only in UI copy) |
| Section `question_unit_content_json` | EXISTING `leadgen_sections.content_json` |
| Section `local_design_overrides_json` | EXISTING `leadgen_sections.design_overrides_json` (activated in v2.5: Section-level role overrides, `09 §9.5`; today the column is unused while overrides live per component node) |
| Section `validation_json` / `dependencies_json` / `maps_config_json` | inside `content_json` nodes (existing model: per-node `conditional`, validation props, `props.maps`) — unchanged |
| `selected_offer_mappings`, `answer_mapping_version` | EXISTING `leadgen_section_available_offers`, `leadgen_section_answer_maps`, `section_mapping_version` — untouched |
| `local_continue_behavior` | EXISTING `leadgen_sections.continue_mode` |

## 3.3 `frame_config_json` schema (server-validated; unknown keys rejected)

Top level: `{ version: 1, template, compat, header, progress, back, disclosure, footer, trust_strip, benefit_bar, background, section_slot, mobile }`. Every group optional → template defaults apply (`04 §4.3`). All enums are closed sets; all colors are **role names** (`09`); all copy fields are plain text (escaped at render); media references are `media_id`s. Full field tables:

**`template`**: `"centered" | "header-footer" | "white-trust" | "full-background" | "header-cta" | "minimal"` (registry: `designs/frames.ts`, `04 §4.3`).

**`header`**: `enabled:bool=true` · `logo_source:"site"|"cms_fallback"|"manual"="site"` · `logo_media_id:string|null` (manual only) · `logo_size:"s"|"m"|"l"="m"` · `logo_align:"left"|"center"="center"` · `tagline:string|null` · `secure_badge:{enabled:bool=false, text:string|null}` · `cta:{enabled:bool=false, label, tel|href}` (SAFE_HREF rule reused) · `disclosure_link:bool=false` · `sticky:bool=true`.

**`progress`**: `style:"hidden"|"bar"|"dots"|"numbered"|"percent"="bar"` · `position:"top"|"under_header"|"above_unit"|"in_card"="under_header"` · `thickness:"s"|"m"|"l"="m"` · `width:"content"|"full"="content"` · `color_role:role="brand_primary"` · `show_label:bool=false`.

**`back`**: `style:"hidden"|"text"|"icon_text"|"button"="text"` · `position:"under_header_left"|"in_card"|"below_card"|"footer"="in_card"` · `label:string="Back"` · behavior fixed: previous Section per Variant order, hidden on first Section (engine already does this); `history_fallback:bool=true`.

**`disclosure`**: `enabled:bool=false` · `location:"top_bar"|"header"|"footer"|"modal"` · `link_label:string="Advertising Disclosure"` · `text:string` (panel copy).

**`footer`**: `enabled:bool=true` · `show_on:"all"|"first"|"final"|"never"="all"` · `links_source:"site"|"manual"="site"` (site → privacy/terms/contact from `site_settings`, `10 §10.3`) · `links:[{label,href}]` (manual) · `trust_text:string|null` · `description:string|null` · `show_logo:bool=false` · `hide_on_mobile:bool=false`.

**`trust_strip`**: `enabled:bool=false` · `source:"manual"|"site_logo_set"="manual"` · `logos:[{media_id, alt}]` (alt REQUIRED) · `placement:"below_unit"|"footer"|"between_progress_and_unit"` · `mobile:"wrap"|"scroll"|"hide"="wrap"`.

**`benefit_bar`**: `enabled:bool=false` · `items:[{icon, text}]` · `placement:"bottom"|"below_unit"`.

**`background`**: `role:role="page_background"` · `image_media_id:string|null` · `style:"flat"|"brand"|"brand_gradient"="flat"` (brand/gradient resolve via roles — no raw CSS).

**`section_slot`**: `max_width:"s"|"m"|"l"="m"` (maps to design `content.maxWidth` family) · `align:"center"` (fixed v2.5) · `card:"card"|"bare"="card"` · `padding:"s"|"m"|"l"="m"` · `offset_y:"none"|"s"|"m"="none"` · `allow_section_card:bool=true` (false = frame card suppresses a Section-level CardPanel wrapper visual doubling — WARNING surfaced, never silent deletion) · `transition:"fade"|"none"="fade"` (existing step fade token) · `continue_placement:"inside_unit"|"below_unit"="inside_unit"` · `continue_style_role:"button_primary"`.

**`mobile`**: sparse overrides `{ hide_footer?, progress_position?, logo_size?, trust_strip_mobile? }` — only keys listed here; everything else inherits (breakpoints come from the base design).

**`compat`** (Advanced-only, C2): `{ allow_section_chrome: bool = false }` — the per-Funnel legacy override. When `true`, Sections containing frame-scope components pass activation with warnings instead of blocking errors (`14 §14.1`). Surfaced only under Advanced in the Quote Builder (`04 §4.4`); no new table — it is a field of this existing column.

## 3.4 Canonical headline binding (D1 — schema change)

`LeadgenComponentNode` gains ONE optional field: `bind?: "section_headline" | "section_subheadline"`.

Validator rules (extend `validateSectionContent`; typed codes in parentheses):
- `bind:"section_headline"` legal ONLY on `type:"QuestionHeadline"`; `bind:"section_subheadline"` ONLY on `type:"Subheadline"` (`bind_type_mismatch`).
- At most ONE node per bind value per Section, whole tree (`duplicate_bind`).
- A bound node MUST NOT carry `props.text` (`bound_node_carries_text`) — its text is the Section column, resolved at render.
- Renderer: `renderSectionComponents(nodes, design)` gains an optional third arg `sectionCtx: { headline_text, subheadline_text }`; presets for the two types read bound text from ctx. Every call site (serve.ts, both preview handlers, content_html persist, studio canvas) passes it.
- Legacy: an UNBOUND `QuestionHeadline`/`Subheadline` with `props.text` stays valid and renders as today (no forced migration). Studio behavior for legacy nodes: `05 §5.2`.
- `previewVariantHandler` **stops emitting** the `<h2 class="lg-section-headline">` duplicate (AMENDS the current preview shape; parity with runtime is the point).
- New Sections are seeded with a bound `QuestionHeadline` + bound `Subheadline` as the first two nodes.
- Hiding: deleting the bound node hides the headline in the question unit; the canonical text remains (used by lists, `data-screen-label`, analytics). The studio shows a persistent “Headline hidden in this question unit — [Show it]” chip while absent (`05 §5.2`).

## 3.5 Component-scope field (D5 — catalog change)

`COMPONENT_CATALOG` entries gain `scope: "frame" | "unit" | "both"` (full assignment table in `08 §8.2`). Server enforcement: `validateSectionContent` emits WARNING `frame_scope_component` (non-blocking at save — a draft may hold legacy content) for `scope:"frame"` nodes; the Studio palette lists only `unit`/`both`. Rendering of legacy frame-scope nodes inside Sections is UNCHANGED (no silent suppression). **Severity escalation (C2):** at Quote publish/activation, `frame_scope_component` becomes a **blocking error** for every funnel that has a configured frame (`frame_config_json` non-NULL) unless that funnel’s `compat.allow_section_chrome` is `true` (`14 §14.1`) — the default therefore prevents double header/progress/footer/logo in live funnels.

## 3.6 Validation error/warning shape (all new/updated admin endpoints)

Responses keep the existing `{error, fields}` convention AND add:

```json
{ "problems": [ { "path": "frame.header.cta.href", "scope": "frame|theme|section|component|choice|mapping",
    "severity": "error|warning", "message": "human sentence, operator language",
    "fix_url": "/admin/leadgen/…#anchor" } ] }
```

`message` never contains raw JSON or internal ids; `fix_url` deep-links to the owning editor surface. Existing endpoints adopt `problems` additively when touched by this contract (frame/theme PUT, section save, preview, activation preflight).
