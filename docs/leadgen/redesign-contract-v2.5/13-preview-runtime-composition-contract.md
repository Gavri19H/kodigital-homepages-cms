# 13 · Preview and Runtime Composition Contract

## 13.1 The one composition path (D3)

New pure module `src/public/leadgen/designs/frame.ts`:

```
renderQuoteFrame(input: {
  effectiveTokens,            // resolveTokens(design, theme, variantOverrides)  (09 §9.2)
  frame,                      // effective frame config: template defaults ⊕ funnel frame ⊕ variant overrides
  siteBranding,               // 10 §10.1
  sectionsHtml,               // the server-rendered <section data-lg-section> list (existing pipeline)
  bannersMountHtml,           // existing [data-lg-banners] mount
}) → string                   // full body inside #lg-funnel-root
```

- Pure over inputs (pinned locale) → visitor-invariant, cacheable.
- Region renderers REUSE existing presets by synthesizing nodes from config (e.g. progress region → `renderProgressBar({props:{mode,…}})`); header/footer/trust/disclosure likewise. Region wrappers stamp `data-frame-region` (admin canvas + tests key on it; harmless at runtime).
- Emits the SAME engine hooks as today (`data-lg-progress`, `data-lg-back`, `data-lg-banners`, sections untouched inside the slot).
- `sectionCtx` (`03 §3.4`) additionally carries `continue_placement`; `below_unit` suppresses the in-node Continue visual and emits the single end-of-section control per the `11 §11.5` single-control rule (C3).
- `frame === null` (legacy funnels) → `renderLegacyShell` = byte-compatible current markup (regression-pinned).

Chrome CSS: `funnelChromeCss(effectiveTokens, scope)` extended with frame-region rules; still one `<style>` block in the shell.

## 13.2 Effective-frame computation (shared helper)

`effectiveFrame(template, frame_config_json, frame_overrides_json)` = template defaults deep-merged with funnel config, then variant overrides (sparse deep-merge; arrays replaced whole). Exported from `designs/frames.ts`; used by serve, previews, and the Quote Builder’s `effective_frame` echo (`04 §4.8`) — one merge implementation.

## 13.3 Runtime (`serve.ts` changes)

`renderFunnelShell` becomes: resolve → load site branding (`10`) → `resolveTokens` → `effectiveFrame` → `renderQuoteFrame(...)` wrapping the existing sections render. Everything else (config blob, sentinels, prehydrate stub, engine script, cache keys incl. `content_version` axis) is UNCHANGED. Frame/theme edits reach visitors via the `03 §3.1` content_version bump.

## 13.4 Preview endpoints (parity by construction — same functions, never a fork)

| Endpoint | v2.5 behavior |
|---|---|
| `POST /api/admin/leadgen/variants/:id/preview` | EXTENDED: `{site_id?, viewport?, mode: "frame"\|"section"\|"all", section_public_id?, draft_frame_config?, draft_theme?}` → renders via `renderQuoteFrame`: `frame` = slot placeholder; `section` = chosen/current Section in slot; `all` = `pages[]` (one composed document per Section, correct per-step progress values). `draft_frame_config`/`draft_theme` substitute the stored config for THIS render only — nothing persists (template preview-before-apply, `04 §4.3`). `site_id` may be ANY CMS site (C4 — branding preview needs no activation). Response `{preview:{css, html \| pages[]}, config}`. Legacy body → legacy response byte-identical |
| `POST /api/admin/leadgen/sections/preview` | EXTENDED (additive): `{frame_context?: {funnel_public_id, variant_public_id?, site_id?}}` — when present, the unit renders INSIDE that funnel’s effective frame (same `renderQuoteFrame`); absent → unit-only (today’s behavior, byte-identical). Existing `design_id`/`viewport`/`sim` params unchanged and honored in-frame |
| Studio canvas | keeps consuming `/sections/preview` (unit-only in Build mode; `frame_context` in Preview-in-frame mode, `05 §5.3`) |

State sims (default/selected/error/dependency/validation/flow) remain server-rendered (`preview-sim.ts`) and compose inside the frame unchanged.

## 13.5 Parity obligations (tested in `15`)

1. For any (funnel, variant, section order, frame, theme, site): `variants/:id/preview mode:"section"` html ≡ the `/lg` shell’s body for the same inputs, modulo the documented per-request splices (Maps key, assignment, GA4) and preview marker attrs (`data-lg-preview`).
2. `sections/preview` WITH `frame_context` ≡ the same Section’s markup inside the runtime shell (node-for-node on the unit subtree + frame regions).
3. Token resolution used by admin canvas css == runtime css (same `resolveTokens` + `funnelChromeCss` call — asserted by string equality in vitest).

## 13.6 Composition order (restated, binding)

Design defaults → Funnel theme → Variant overrides → Section overrides → Component overrides → runtime state. No arbitrary CSS at any layer; all values roles/tokens/enums (`09`).
