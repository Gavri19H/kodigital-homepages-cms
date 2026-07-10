# 11 · Progress / Back / Footer / Disclosure Contract

Frame-owned chrome semantics. Renderers reuse the existing presets + engine hooks (no engine rewrite): the frame emits the SAME `data-lg-progress` / `data-lg-back` hook markup the v2.4 engine already drives.

## 11.1 Progress (D7)

- Rendered ONCE by the frame at `frame_config.progress.position`; style bar/dots/numbered/percent maps to `renderProgressBar`/`renderStepIndicator` presets with config-derived props.
- Semantics: progress = advancement through the **Funnel Variant’s section order** (existing engine `updateProgress` over visible, dependency-satisfied sections — unchanged; the frame just guarantees exactly one mount OUTSIDE the swapped section nodes, so it persists across slides).
- Placement inside the card (`in_card`) renders the mount at the top of the section slot (still one mount).
- Section Builder cannot place `ProgressBar`/`StepIndicator` (frame scope). A Section-local progress is possible ONLY via Advanced raw-node editing and renders with a “local progress (rare)” badge in the studio + preflight warning `local_progress_in_section`.

## 11.2 Back / Previous

- Frame renders one back affordance per `frame_config.back` (style/position/label); engine behavior unchanged (`setBackVisible`: hidden while `back_stack` empty ⇒ hidden on first Section; navigates to previous Section; `history_fallback:true` = browser history when the stack is empty and referrer is same-origin — additive engine tweak, default-safe).
- Tracking: existing `section_view(back)` event unchanged.
- Section-specific back logic remains only as the Advanced escape (same policy as §11.1).

## 11.3 Footer / legal / trust logos

- Footer rendered by the frame per `frame_config.footer` incl. `show_on` (all/first/final/never — “final” = the max-position Section AND the auction/banners view).
- Trust/brand logo strip per `frame_config.trust_strip` (placements: between progress and unit / below unit / footer). `source:"site_logo_set"` reads a `site_settings.trust_logo_media_ids` JSON list when present (additive settings key, optional).
- Local trust copy INSIDE the unit stays a Section concern (`TrustBar`/`LogoStrip`/`ReassuranceBadge` scope `both`).

## 11.4 Advertising disclosure

- Frame-owned per `frame_config.disclosure`: `top_bar` (slim bar above header), `header` (link in header, panel on click — existing `DisclosureLink` preset), `footer` (inline text), `modal` (link opens overlay panel; reuses the disclosure panel markup, `hidden` toggle — no new runtime dependency).
- Requiredness: if a site/vertical policy requires a disclosure (operator decision), preflight warning fires when `disclosure.enabled=false` for verticals listed in an optional `DISCLOSURE_REQUIRED_VERTICALS` env allowlist (default empty — no behavior change unless configured).

## 11.5 Continue (D10 — clarified ownership)

| Question | Owner | Mechanism |
|---|---|---|
| Is a Continue needed? | Section | `continue_mode = button \| auto_advance` (unchanged) |
| Default style | Funnel theme | `theme_json.button_defaults` + `section_slot.continue_style_role` |
| Default placement | Frame | `section_slot.continue_placement = inside_unit \| below_unit` — rendering per the single-control rule below |
| Label/style override | Section | existing `ContinueButton` node props + curated overrides |

**Single-control rule (C3, normative):** exactly ONE `[data-lg-continue]` control exists per rendered `<section data-lg-section>` element, in BOTH placements.

- `inside_unit`: the unit’s `ContinueButton` node renders the control at its authored position (today’s behavior).
- `below_unit`: the renderer SUPPRESSES the visual at the node position and emits the single control in a frame-styled slot at the END of the same section subtree (`sectionCtx.continue_placement`, `13 §13.1`) — visually below the unit card in the frame’s slot area, DOM-wise still inside the section element, so the engine’s per-section show/hide + validation binding is untouched and no control is ever shared across sections.
- Label/loading copy comes from the Section’s `ContinueButton` node when present, else theme defaults (`continue_style_role`).
- Duplicate `ContinueButton` nodes in one Section: the FIRST provides props; later ones render nothing and save emits warning `duplicate_continue` (surfaced in preflight, `14 §14.1`).
- Sections with `continue_mode = auto_advance` render NO continue control in either placement.
- Tests: `15 §15.1 continue-single-dom` asserts exactly one control per section element in both modes + the dedupe warning.

## 11.6 Runtime notes

All chrome renders server-side into the cached shell (visitor-invariant; branding is site-scoped, `10 §10.2`). The engine keeps owning show/hide/progress/back behavior via the existing §3.3 hooks — this contract only changes WHERE the hook markup is emitted (frame vs per-section). The engine’s section-scoped queries for back/continue are audited in Phase A to tolerate frame-level mounts (`querySelector` scope widened from section element to funnel root where required — exact touch list in `16` Phase A).
