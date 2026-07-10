# 09 · Theme / Token / Palette Contract

## 9.1 Semantic roles (the ONLY color vocabulary in normal flows)

| Role | Label (UI) | Base mapping (default-funnel token) | Used by (shown in palette UI) |
|---|---|---|---|
| `brand_primary` | Brand primary | `color.primary` | buttons, progress fill, selected borders, logo text |
| `brand_secondary` | Brand secondary | `color.primaryLight` | gradients, secondary emphasis |
| `accent` | Accent | `color.accent` | category label, highlights, recommended |
| `success` | Success | `color.success` | reassurance, valid states |
| `error` | Error | `color.error` | validation errors |
| `page_background` | Page background | `page.backgroundColor` | frame background |
| `card_background` | Card background | `color.card` | question card, answer cards |
| `surface_wash` | Soft fill | `color.primaryWash` | selected fills, quiet panels |
| `border` | Border | `color.border` | card/input borders |
| `text_primary` | Text | `page.textColor` | headlines, labels |
| `text_muted` | Muted text | `page.textSecondaryColor` | subheadlines, helper, meta |
| `button_primary_bg` | Button | `primaryButton.background` | Continue/CTA background |
| `button_primary_text` | Button text | `primaryButton.color` | Continue/CTA text |
| `button_secondary_bg` | Secondary button | `color.primaryGhost` | back button-style, quiet buttons |

The mapping table is code (`designs/theme.ts`, `ROLE_TO_BASE_TOKEN`); every registered visual design must satisfy it (compile-time exhaustiveness like `REQUIRED_FIELDS`).

## 9.2 Resolution pipeline (normative, one pure function)

```
resolveTokens(baseDesign, theme_json?, frame_overrides_json?) → EffectiveTokens
```

Priority (mission §14, restated): 1 base visual design (`funnel_design_id`) → 2 Funnel theme (`theme_json.palette[role]`, typography, scales) → 3 Variant `frame_overrides_json.theme` → 4 Section `design_overrides_json` roles (`§9.5`) → 5 component `design_overrides` → 6 runtime state classes (selected/error/disabled — CSS, unchanged). Implementation: `resolveTokens` covers 1–3 server-side and feeds BOTH `funnelChromeCss(effective, scope)` and the presets; 4–5 stay per-node at render (existing mechanism, values now role refs). One function, used by runtime serve, both preview endpoints, and the admin canvases — drift is impossible by construction.

## 9.3 Theme editor (Quote Builder, `04 §4.2`)

- **Palette:** swatch grid — each role renders swatch + label + “Used by” line + inheritance source (“Base design” / “This funnel”). Editing offers: curated harmonies derived from the base design (base value, wash, dark/light steps) + custom hex ONLY inside “Advanced token administration” (collapsed, warning copy: “Custom colors skip the design system — check contrast.”). Contrast lint: WCAG AA check button-bg/button-text + text/page; failures = `problems[] warning`.
- **Typography:** display font + body font (curated list: the fonts already shipped by designs — Literata, Sora, system) · size scale s/m/l.
- **Scales:** spacing compact/regular/roomy · radius sharp/soft/round · shadow none/low/mid/high — each a multiplier/lookup over the base scales (defined in `designs/theme.ts`, e.g. radius sharp = one step down the base radius scale).
- **Button defaults:** bg role, text role, radius step, min-height m/l, casing none/upper. **Card defaults:** bg role, border role, radius step, shadow step.
- Live mini-preview strip (button + card + input + progress rendered via the real presets under the draft theme).

## 9.4 Component/Section color controls (the F3 fix)

- Design-tab color controls become **role swatch rows**: swatch + role label + inheritance tag; picking writes the ROLE NAME (e.g. `design_overrides.buttonBackground = "accent"`), never hex. “Reset to inherited” deletes the key.
- Renderer resolution: override value is looked up as a role first (`EffectiveTokens[role]`); a value starting with `#` is a **legacy literal** — rendered as-is, shown in the UI as “Custom color (legacy) — [Convert to a theme color]”, and reported by preflight as a warning. No bulk data migration.
- `CURATED_DESIGN_OVERRIDE_KEYS` unchanged (same 8 keys); only the VALUE vocabulary changes to roles. Content-schema validation adds: color-typed override values must be a known role OR `#hex` (legacy) (`invalid_override_value`).

## 9.5 Section-level overrides (activates `leadgen_sections.design_overrides_json`)

Sparse `{ palette?: {role: role-or-hex}, columnsDefault?, gapDefault? }` — applied between theme and component overrides (priority 4). Edited in the Section Builder “Design overrides” mode with the same swatch UI + a banner: “These apply wherever this Section is used — prefer the Quote theme for funnel-wide changes.”

## 9.6 Hex policy (binding summary)

Hex appears ONLY in: theme Advanced token administration, legacy-literal badges, and Advanced/debug tabs. Playwright asserts no `#[0-9a-f]{3,8}` text is rendered in normal-mode inspector/palette/toolbar surfaces (`15 §15.3`).
