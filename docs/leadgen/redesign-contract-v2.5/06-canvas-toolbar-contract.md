# 06 · Canvas and Toolbar Contract

One toolbar spec, two hosts: the Section Builder unit canvas and the Quote Builder frame canvas. The toolbar is **context-aware**: its control set is a pure function of the current selection (table §6.5). No control ever writes raw CSS; every write lands in a schema field (`03`) as a token/role/enum.

## 6.1 Anatomy (left → right)

1. **Selection breadcrumb** — e.g. `Question card › Answer grid › Choice “LLC”`; each crumb clickable (re-select ancestor). Root crumb names the scope (“This Section” / “Funnel frame”).
2. **Scope pills** — `Funnel frame · This Section · Component · Choice` — pills are enabled where applicable (in the Section Builder, “Funnel frame” pill deep-links to the Quote Builder with a tooltip; it never edits frame data in place). The active pill is highlighted; switching pills re-targets the inspector (`07 §7.2`). Wording rule C6: the Section Builder never says “slide” — that word belongs to the Quote Builder (a Section’s position in the selected Funnel Variant).
3. **Undo / Redo** — REQUIRED (resolves the mission’s “if feasible”: the studio island already owns the full content tree in memory, so a bounded history is cheap). In-memory stack, ≥ 30 steps, per open editor, covering content-tree + frame-config mutations; cleared on Save; keyboard ⌘Z/⇧⌘Z.
4. **Viewport toggle** — Desktop 1280 / Mobile 375 (server-rendered via existing `viewport` preview param — never CSS-scaled).
5. **Structure cluster** — Move ↑/↓ · Add before/after · Duplicate · Delete · **Group into** (Stack / Card panel / Grid / Columns) · **Ungroup** (dissolve container, children splice into parent).
6. **Layout cluster** (containers + grids) — align (start/center/end/stretch → Stack `align`) · direction (vertical/horizontal) · distribute = gap token (xs–xl) · columns d/t/m steppers · ratio presets (Columns) · width preset (CardPanel s/m/l/full) · padding token · radius/shadow/background tokens (CardPanel roles).
7. **Text cluster** (copy-bearing selections) — type role (Headline / Subheadline / Body / Helper / Legal — maps to the design type slots, never free font sizes) · font family (theme display/body only) · size step (s/m/l within the role) · weight (regular/semibold/bold) · text align · text color role swatch.
8. **Component cluster** — per-type quick controls (§6.5).
9. **Preset menu** — “Save selection as preset…” / apply preset (§6.6).

Grid/guides + snap toggles are NOT included (rejected): the model is an ordered token-value tree, not freeform x/y — alignment is expressed through container tokens, which is what keeps runtime parity and no-CSS guarantees. This resolves the mission’s grid/snap bullets by design substitution.

## 6.2 Canvas interaction (Section unit canvas)

Drag-drop from library with insertion indicators (kept) · click-select any node (selection outline + breadcrumb) · **inline text editing** on double-click for headline/subheadline/labels/helper (writes the bound column or `props`) · per-choice selection (click a card/button selects the CHOICE, not just the component) · inline choice ops: “+ Add choice” ghost tile at grid end, per-choice ✕, drag to reorder choices · container resize handles snap to width presets only · keyboard: arrows reorder, Del deletes, Esc walks up the ancestry.

## 6.3 Canvas interaction (Quote frame canvas)

Region click-select (`data-frame-region`) · no drag-drop (regions are fixed by template; arrangement changes via template switch) · region hover shows name tag · section-slot interior is inert with the “edit in Section Builder” affordance (`04 §4.1`) · all-slides preview mode disables editing (read-only stepper).

## 6.4 Choice-level editing (the F6 surface)

Selecting a choice shows toolbar cluster: image/icon swap · label inline edit · internal-value chip (opens Choices tab row) · badge toggle · disabled toggle · duplicate/delete choice · move left/right. The inspector simultaneously opens the Choices tab scrolled to that row (`07 §7.4`). Provider values are NOT on this cluster (per-Offer, Mapping tab — C1).

## 6.5 Context matrix (normative)

| Selection | Visible clusters |
|---|---|
| Nothing | breadcrumb(root) · scope pills · undo/redo · viewport |
| Bound headline / subheadline / copy node | + text cluster · structure |
| Choice component (grid/group/dropdown) | + structure · layout(columns/gap) · component (add choice, selected-state role, auto-advance chip) |
| Single choice | + choice cluster (§6.4) |
| Input component | + structure · component (required, placeholder, icon, validation shortcut) |
| Local container | + structure · layout cluster |
| Frame region (Quote Builder) | region cluster = that region’s inspector quick controls (progress style, logo size, …) |
| Frame root / template | template selector · theme button · viewport · preview mode |

## 6.6 Named presets (replaces the free-text `design_preset` input — F3)

“Save selection as preset” captures the node’s type + curated `design_overrides` + layout props (NEVER content/choices/mapping) under an operator-given name. Storage: KV `lg-component-presets` → `{name, component_type, overrides, props_subset, created_by, created_at}` list; admin-scoped, no migration. Apply = merge onto the selected node of the same type (mismatched type → disabled). The inspector Design tab’s preset control becomes a dropdown of saved presets for that type + “(none)”. The stored `design_preset` node field now holds the preset NAME as provenance only; render behavior comes from the applied override values (unchanged renderer semantics).

## 6.7 Feedback rules

Every toolbar write re-renders the canvas via the preview endpoint (existing pipeline) within one round-trip; failed validation surfaces the `problems[]` inline at the control (red outline + sentence). Drop-refusal + pending notes (existing studio affordances) are kept.
