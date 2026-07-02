# Reference Layout Audit — Senior-Saving default listicle layout

**Status:** measured (visible desktop page) + blockers · **Baseline for:** `layout_style_id = "default"` · **Contract:** §14 / §30 of the Listicles CMS Design Contract.
**Reference URL:** `https://senior-saving.com/10-benefits-nb-hw-safe` (advertorial listicle).
**Tokens:** `api/src/public/listicle/layouts/default/tokens.ts` (`defaultListicleLayoutTokens`) — authoritative; do not replace with abstract theme values.

The default layout must reproduce the reference **1:1, end to end**. The **only** per-host brand element is the logo (from CMS/site settings). Header colour, Disclosure placement, typography, spacing, CTA rhythm, button styling, footer, article shell, and content behaviour are owned by the default layout unless a different layout style is selected. The host site theme cannot override default-layout tokens.

## Capture context
- Captured desktop viewport **1014×857**, rendered page width **1000px**, scrollbar **14px**.
- Effective article body **~968px** with **16px** side padding (NOT ~680px).
- Mobile (390px): **BLOCKER — not yet captured.**

## Measured (accepted) — desktop
| Region | Key values |
|---|---|
| Page | bg `#ffffff`, text `#2a2a2a`, `Arial, Helvetica, sans-serif` |
| Article container | max-width 968px, padding-x 16px, centered |
| Header | height 64px, bg `#ce2e35`, border-bottom 1px `#f4d1d3`, padding-x 20px, flex space-between |
| Logo slot | 226×36, object-fit contain, left @20px, top @15px (only per-host brand swap) |
| Disclosure trigger | top-right, white, 13px / line-height 16px, right offset 20px |
| H1 | centered, 38px / 48px line-height, weight 700, letter-spacing -0.4px, max-width 820px, mb 19px; first glyph top y=94 (30px gap under header) |
| Byline | centered row, 31px circular avatar, 16px gap, 12px bold `#4b5360`, mb 16px |
| Hero | x=16px, width ~967px, 2:1, object-fit cover, radius 5px, mb 22px |
| Body paragraph | 20px / 30px, `#2a2a2a`, weight 400, mb 15px; paragraph gap 14–16px |
| Lists | 20px / 30px, list-style none, checkmark marker `✔️`, bullet `•`, item mb 8px |

## Blocker register — resolve before Phase 6 acceptance
1. **Mobile capture (390px)** — capture the reference at 390px; populate `reference-layout-mobile.json` + `reference-mobile.png`; fill the `*Mobile` token values (headline 32px/39px, body 18px/27px are provisional).
2. **Disclosure interaction** — open the reference Disclosure and record whether it is anchor navigation / modal / dropdown / accordion / scroll-to-disclosure. Implement the measured behaviour; do NOT assume.
3. **Lower-page tokens** (measure from scrolled screenshots / computed CSS of Sections 1–5):
   - `sectionWrapper` spacing · `sectionHeading` size/margins · `sectionImage` aspect/radius parity with hero
   - `inlineLink` style (from visible provider links) · `choiceButton` exact visual styling
   - `textCta` (final text CTA) · `legalDisclosureBlock` · `footer` (logo, nav links, legal, copyright)

## Required captures (assets)
- `reference-desktop.png` — full captured desktop page (top + scrolled sections).
- `reference-mobile.png` — 390px capture (BLOCKER).
- `reference-layout-desktop.json` — measured desktop values (this folder).
- `reference-layout-mobile.json` — measured mobile values (BLOCKER stub in this folder).

## Acceptance rule
If any BLOCKER above remains unresolved, default-layout parity is **not** complete and **Phase 6 cannot be accepted**. Visual-regression tests (Playwright screenshot + computed-style diff) compare CMS output to the reference captures for every measured region and every resolved blocker.
