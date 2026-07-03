# Reference Layout Audit — Senior-Saving default listicle layout

**Status:** measured (desktop top-page baseline + §31.0 lower-page/mobile/Disclosure captures) · **LIVE-PAGE DRIFT DETECTED** (see drift register) · **Baseline for:** `layout_style_id = "default"` · **Contract:** §14 / §30 / §31.0 of the Listicles CMS Design Contract.
**Reference URL:** `https://senior-saving.com/10-benefits-nb-hw-safe` (advertorial listicle).
**Tokens:** `api/src/public/listicle/layouts/default/tokens.ts` (`defaultListicleLayoutTokens`) — authoritative; do not replace with abstract theme values.

The default layout must reproduce the reference **1:1, end to end**. The **only** per-host brand element is the logo (from CMS/site settings). Header colour, Disclosure placement, typography, spacing, CTA rhythm, button styling, footer, article shell, and content behaviour are owned by the default layout unless a different layout style is selected. The host site theme cannot override default-layout tokens.

## Capture context
- **Baseline pass (§30.1):** desktop viewport **1014×857**, rendered page width **1000px**, classic scrollbar **14px** → article body ~968px, 16px side padding.
- **§31.0 pass (2026-07-03, this audit):** Playwright Chrome, computed CSS + bounding boxes after `document.fonts.ready`, CSS px:
  - Desktop verification + lower-page: **1014×857**, overlay scrollbar (0px) → content width **982px** (vs 967px baseline — environment difference, not drift). Full page height 10507px.
  - Mobile: **390×844**, content width **358px**, full page height 12621px.
  - Disclosure interaction: clicked live trigger, dismissal matrix tested (outside click / Escape / re-click).
- Live page is a Next.js/Tailwind app (Strapi-backed `comparison-cms`); colors arrive as **inline styles and CSS variables** (`--listicle-cta-secondary-color: #f8020e`, header/footer inline `background-color`), fonts via `next/font` (**Inter**, Arial-metric fallback).

## Live-page drift register (2026-07-03) — §30.1 baseline vs live, BOTH recorded, baseline NOT overwritten
The live page no longer matches several already-measured §30.1 top-page values. Geometry anchors held (header 64px, hero 2:1 at y=242, byline row/avatar positions, content x=16); type, colors and radii drifted. Several baseline values look screenshot-pixel-derived (31px avatar, 38px headline, `#ce2e35` red — consistent with a display-P3→sRGB pixel sample of the live `#e0072b`), while this pass reads computed CSS. **Contract owner must decide: re-baseline the §30.1 top-page package or pin the contract to the baseline design.** The §31.1 computed-style assertion list references the stale values (e.g. choice button `#ce2e35 … radius6 min-height52`) and needs the same decision.

| Region | §30.1 baseline (kept) | Live 2026-07-03 (measured) |
|---|---|---|
| Page font | `Arial, Helvetica, sans-serif` | Inter via next/font (fallback is Arial-metric-adjusted) |
| Header bg | `#ce2e35` | `#e0072b` (inline style on `<header>`) |
| Header border-bottom | 1px `#f4d1d3` | none (0px) |
| Header padding-x | 20px | 16px (logo at x=16) |
| Logo slot | 226×36 @ (20,15) | 232.7×40 @ (16,12) — `h-10 w-auto`; identical at 390px (no downscale) |
| Disclosure trigger font | 13px/16px | 12px/16px below 1024px; 14px ≥1024px (`text-xs lg:text-sm`) |
| Headline | one `h1` 38px/48px w700, ls −0.4px, max-w 820px, mb 19px, glyph top y=94 | two `h2` 36px/40px (+4px py → 48px line pitch), w700 via `<strong>`, ls normal, max-w none, margins 0, glyph top y=86 |
| Byline | avatar 31px; text 12px/15px w700 `#4b5360` | avatar 30px; `h5` 12px/18px w600 `#4b5563` (gap 16px + centering confirmed) |
| Hero | radius 5px, mb 22px | radius 8px (`rounded-lg` on img), margins 0 with 16px visual gaps (2:1 + y=242 confirmed) |
| Body paragraph | 20px/30px `#2a2a2a`, mb 15px, gap 14–16px | 18px/30px; intro `#333333`, in-section `#2c2c2c`; margins 0 + 6px paddings → 12px gap |

## Measured (accepted) — desktop baseline (§30.1, unchanged)
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

## Measured — §31.0 blocker resolutions (2026-07-03, live computed CSS)
All eight lower-page groups + Disclosure interaction + mobile are now **measured** in `tokens.ts` (`status: "measured"`, `measuredAt: "2026-07-03"`). Values are coherent with the 2026-07-03 live page (see drift register). Provisional-default cross-check included per §31.0.

| Group | Measured values | vs §31.0 provisional |
|---|---|---|
| `disclosureInteraction` | **Dropdown panel** anchored to the trigger: absolute below (8px offset), right-aligned; 288px wide, white, black 16px/24px text, 16px padding, radius 4px, shadow-lg; **no** animation / focus trap / backdrop / scroll-lock; dismiss = **outside click only** (Escape does NOT close; trigger re-click keeps it open) | provisional interim was "anchor scroll to #disclosure" — **corrected: dropdown** |
| `sectionWrapper` | section divs carry **no margins**; separation = `<hr>` divider mt **32px** / mb **20px**, 3px line `#e5e7eb`; heading wrapper pt 4px / mb 8px; 6 sections | provisional mt32/mb28 on the wrapper — corrected: rhythm lives on the divider (32/20) |
| `sectionHeading` | `h3` inside `<a>` (**linked**), **22.4px/29.6px** at both capture viewports (stylesheet `lg:` 27.2px/40.8px ≥1024px), w700, `#2c2c2c`, py 4px, margins 0; hover underline + `#374151`; no own font-family (inherits page font); **all 6 headings start with a numbered badge span** (`#d1d5db`, px 6px, radius 8px, inline-flex, mr 6px, own line-height 24.6px/35.8px). Section 6's heading alone is `hidden sm:block` with no mobile counterpart (**no heading at 390px**) | provisional 28px/34px mt28 mb16 — corrected |
| `sectionImage` | **16:9** (982×552.4 / 358×201.4), radius **2px on wrapper** (`rounded-sm overflow-hidden`, img 0), object-cover center; margins 0; 8px below heading, 16px above paragraph | provisional "2:1 radius 5px mt12 mb20 (matches hero)" — **corrected: does NOT match hero** (hero is 2:1 radius 8px) |
| `inlineLink` | `#3b82f6`, w400, **underlined**, 18px/30px (inherits paragraph); hover `#1d4ed8` still underlined (`text-blue-500 underline hover:text-blue-700`) | provisional `#ce2e35` w700 no-underline hover `#b9272e` — corrected completely |
| `choiceButton` | bg **`#f8020e`** (from `:root --listicle-cta-secondary-color`), `#ffffff`, border 1px `#b9c6ce`, radius **8px**, padding **10/20**, label 18px/28px w700 (inner `<p>` with 6px py; button element 16px/24px), rendered height **62px** (no min-height set; 62px is the single-element equivalent), width 100% of grid column (no max-width), mt 4px; hover = **scale(1.05)**, 200ms, colors unchanged; **no active rule** | provisional `#ce2e35`/18px/24px/radius 6/pad 14/18/min-h 52/max-w 720/hover `#b9272e` — corrected on every point except white text + w700 + full-width |
| `choiceButtonGroup` | **grid** (not flex column), gap 8px, mt 8px, mb 0; 6- and 3-button groups `grid-cols-1 lg:grid-cols-3` (1 col at 1014px & 390px, 3 cols ≥1024px); 2- and 4-button groups `grid-cols-2` at all measured widths; counts by section **6/2/4/4/–/3** (page has **six** sections; section 5 has no group — contract counts 6/2/4/4/3 confirmed for the 5 groups); each group followed by a full-width button-styled `<a>` CTA (`my-2`) | provisional flex-column gap8 mt16 mb20 — corrected |
| `textCta` | **inline** link inside the closing paragraph ("… ➝ Check Eligibility Here"): `#3b82f6` 18px/30px w400 underlined, hover `#1d4ed8` — **identical to inlineLink**; no distinct final-CTA style exists | provisional `#ce2e35` 20px w700 block no-underline mt16 mb22 — corrected |
| `legalDisclosureBlock` | 16px/24px `#000000` w400, paragraph py 6px, inside a full-width white `pt-4 pb-4` band between last divider and footer (a second band with an empty paragraph follows) | provisional 14px/21px `#4b4b4b` mt32 mb24 — corrected |
| `footer` | bg **`#000002`** (inline), white text; inner `p-4 md:py-8` → px 16px, py 32px ≥768px / 16px at 390px; logo = same white asset `h-10 w-auto` → **232.7×40** (mb 16px stacked, 0 in row layout); nav links 14px/20px **w500 `#ffffff`**, no underline → hover underline, gap 24px ≥768px / 16px below, `Contact · Privacy policy · Terms of use`; hr `#9ca3af` my 24px (32px ≥1024px); legal 14px/20px `#ffffff` justify, mb 16px; copyright 14px/20px `#ffffff`, pb 69px <1024px / 40px ≥1024px | provisional white bg / `#2a2a2a` links / 12px `#555` legal / logo 180px — corrected completely |

## Measured — mobile 390×844 (2026-07-03)
Full values in `reference-layout-mobile.json` + `*Mobile` token fields. Highlights:
- Header identical to desktop: 64px `#e0072b`; logo **not** downscaled (232.7×40 @ 16,12); Disclosure trigger 12px/16px, right offset 16px.
- Headline = mobile-only `<div class="text-2xl py-1"><strong>` variant (desktop `h2` pair hidden <640px): **24px/32px** + 4px py, centered, `#2c2c2c`; 2 authored lines wrap to **4 rendered lines**. (Provisional 32px/39px corrected.)
- Byline: avatar 30px, gap 16px, 12px/18px w600 `#4b5563`. Hero: 358×179 (2:1), radius 8px, 16px gaps.
- Body: **18px/30px** (no mobile downscale; provisional 27px line-height corrected), py 6px.
- Section heading: same 22.4px/29.6px (no `sm:` variant); wraps to 2 lines. Section 6 renders **no heading** at mobile (authoring variant).
- Buttons: identical styling (62px tall); 1-col stacked for 6/3-button groups, **2-col grid** for 2/4-button groups (175px columns).
- Legal band/footer: as desktop but footer inner py 16px, links row wraps under logo (ul mb 24px), copyright pb 69px.

## Disclosure interaction (§30.4 blocker 2) — RESOLVED
Measured behaviour (2026-07-03): **dropdown panel**, not anchor/modal/accordion/scroll-to. Click the header "Disclosure" `<p>` → a 288px white panel appears instantly (no animation), absolutely positioned below the trigger, right-aligned, radius 4px, `shadow-lg`, 16px padding, black 16px/24px text (advertising-compensation copy). No backdrop, no focus trap, no scroll lock, no `#` navigation. Dismiss: click outside only; Escape does not close; re-clicking the trigger keeps it open. Same pattern at 390px. Evidence: `reference-desktop-disclosure-open.png`.

## Required captures (assets) — all present
- `reference-desktop.png` — full desktop page (1014×10507).
- `reference-desktop-sections.png` / `reference-desktop-sections-2.png` — scrolled Section-1 evidence (heading+image; question+6 buttons+CTA+divider).
- `reference-desktop-footer.png` — legal band + footer.
- `reference-desktop-disclosure-open.png` — Disclosure dropdown open.
- `reference-mobile.png` — full mobile page (390×12621).
- `reference-layout-desktop.json` — baseline + `lowerPage` (§31.0 groups) + `drift2026_07_03`.
- `reference-layout-mobile.json` — full measured mobile values.

## Blocker register — §30.4/§31.0
1. ~~**Mobile capture (390px)**~~ — **RESOLVED 2026-07-03** (`reference-layout-mobile.json`, `reference-mobile.png`, `*Mobile` tokens).
2. ~~**Disclosure interaction**~~ — **RESOLVED 2026-07-03**: measured **dropdown** (see above); implement the measured behaviour.
3. ~~**Lower-page tokens**~~ — **RESOLVED 2026-07-03**: all 8 groups measured (table above).

## New open items (surfaced by this pass — NOT §31.0 blockers)
- **O1 — Top-page baseline drift:** live page vs §30.1 baseline (drift register above). Decide: re-baseline the top-page package (then §31.1's assertion list + `page`/`header`/`articleHeadline`/`byline`/`heroImage`/`bodyParagraph` tokens update together) or pin the contract to the baseline design. Until decided, top-page tokens and 2026-07-03 groups have **mixed provenance**.
- **O2 — §31.1 stale assertions:** the computed-style list (choice button `#ce2e35 … radius6 min-height52`, H1 38/48, paragraph 20/30, hero radius 5) references pre-drift values; update alongside O1.
- **O3 — `.lst-spacer` source:** `tokens-to-css.ts` derives the spacer height from `sectionWrapper.marginTop`, which measured **0px** (the rhythm lives on the hr divider: 32px/20px/3px `#e5e7eb`). The renderer needs a real divider element (or a remapped spacer source) to reproduce the measured inter-section rhythm.
- **O4 — Dynamic content for visual regression:** byline "Updated:" renders the **current date**; offer links carry per-request query params; section images are user-supplied (maskable per §31.1). Mask/parametrize these.
- **O5 — `lg:` (≥1024px) variants:** capture viewports (1014/390) sit below the reference's 1024px breakpoint. Stylesheet-derived ≥1024px values are recorded in token `measured` notes (heading 27.2/40.8, 3-col button grids, container px-8, footer hr my-8, copyright pb-10) but are **not live-measured**; a ≥1024px capture pass would be needed to assert them.
- **O6 — Scroll-to-top FAB (observed, not measured):** a fixed blue circular scroll-up button appears bottom-right when the desktop page is scrolled (visible in `reference-desktop-sections*.png`). Not part of any §30.2 component or §31.0 group — flagged for a contract-owner scope decision; UNMEASURED beyond the screenshots.

## Acceptance rule
The three §30.4/§31.0 BLOCKERs are resolved with live measurements. Default-layout parity acceptance additionally requires resolving **O1/O2** (which reference state is "the reference"?) — flagged to the contract owner rather than silently re-baselined. Visual-regression tests (Playwright screenshot + computed-style diff) compare CMS output to the reference captures for every measured region; §31.1 thresholds apply once O1/O2 are decided.
