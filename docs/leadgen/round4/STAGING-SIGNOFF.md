# LeadGen Round-4 — Staging Sign-Off Package

**Status:** all 7 phases merged/ready (P1–P6 merged PRs #124–#129; P7 = final PR). Full-program adversarial
audit returned SHIP. Register `docs/leadgen/round4/register.md` = 0 open implementation rows; the only non-PASS
rows are operator-owned/decision (below). This package + your hands-on retest + deploy are the terminal gate.

## What shipped (your round-4 report → live)

| # | You reported | Now (proven live, both engines) |
|---|---|---|
| 1 | List columns off-screen, no scrollbar (all LeadGen + Listicles) | Full width reachable at 1440px; sticky first/actions columns; unreachable-clip bug fixed |
| 2 | Sections/Quotes kept the old flat actions | Kebab everywhere: Duplicate / Usage / Archive↔Reactivate / guarded Delete (offers parity) |
| 3 | Question grid unusable ("+Add choice" did nothing) | From the picker: labeled rows render, add sub-question, per-row field mapping, defaults, → live "Tell us about the driver" |
| 4 | Rules jargon/no grid mapping/no AND-OR | Grid rows + Address/Name are rule sources (above→below); ANY/ALL groups; plain-language sentences |
| 5 | Two "When answered" controls | Exactly one |
| 6 | Address = Contact clone; one phone "valid" | Real composite + Maps field-mapping (street/city/state/zip); phone format per funnel (US/IL/International), enforced live |
| 7 | Couldn't set 1 column | 1-column authorable + honored live (all answer types) |
| 8 | Section name hidden; raw-id save errors | First-class name field; plain-language errors |
| 9 | "+Add choice" distorted the component | Out of the layout flow; live == edit geometry |
| 10A | Activity/Verticals free text | Dropdowns (existing endpoints) + add-new |
| 10B | Site logo showed "cc" | Real site logo in preview + "no logo set" hint |
| 10C | Phone rigidly under the logo | Placeable CTA (header-right/under-header/section-bottom/footer), tel:, conditional display (page/answer/state/hour/day) |
| 10D | Progress bar a mess, "numbered"==bar | 5 genuinely distinct styles (bar/percent/dots/numbered/icon-on-track), position/alignment |
| 10E | No free text above/below | Rich free-text blocks (bold/italic/link/✓-list), per-page targeting, typography |
| 10F | No brand-logo organizer | Brand-logo strip/grid + SVG upload (sanitized), size/order/page-targeting |
| 10G | No rich/AI elements | Trust rows + hover tooltips; AI persona-image element (author-time gen, quota) |
| 10H | No bottom-of-page builder | Footer block builder (about/links/logo/address/socials), own palette/typography; disclosure v2 (multi-location, hover) |
| 10I | Theme unclear, 3 fonts/sizes, weak buttons | Theme v2: 8 self-hosted fonts, display-XXL ramp, button styles (Img38-40), 14-role palette, presets+DELETE, per-funnel picker, theme A/B |
| 10J | Funnel structure broken | Structure panel v2 (pages-first, clean layout) |
| Restructure | Templates/Themes should be top tabs + box pickers | Templates + Themes top tabs; the 8 box pickers; funnel builder with unified routing rules |
| Funnel deltas | Pages≠sections; in-page A/B + rules; funnel-level A/B; per-funnel theme | FULL pages model (multi-section pages, slot rules, in-page A/B), reference-shaped routing rules, funnel/theme A/B |

Bonus: ~15 defects found beyond your list and fixed (MQG save-trap, call-button-phone-only, unreachable columns,
boolean-rules, a stored-XSS on funnel visitors via free text, a quota race, a corrupt-frame money-path fail-safe, …).

## Behavior changes to know before you retest
- **Section DELETE is now a real hard-delete when unreferenced** (guarded 409 + "archive instead" when a quote/rule
  uses it). Sections-list "Archive" is reversible (PATCH), as its confirm text always claimed.
- **New funnels default to a minimal themed frame** only when you've applied a theme — so a theme takes effect
  immediately. Untouched legacy funnels are unchanged.
- **Existing redirect rules were backfilled to 100%** so live redirect behavior is preserved; NEW redirect rules
  default to "no redirect" (0%) per the contract.

## OPERATOR-OWNED — your decisions/actions (the only non-PASS rows)
1. **R4-47 — inline-themed frameless funnel (a decision):** if you create a funnel, open the Themes tab, and edit
   colors/fonts **inline** (without saving as a preset or picking a Template), the theme won't render live yet.
   **One-click workaround today:** click "Save as preset" → apply it (renders correctly — this is the fixed path).
   A safe auto-fix is scoped (R4-48 already added the prerequisite) but needs its own small slice — **your call**
   whether to fix now or accept the workaround.
2. **R4-OP1 — production deploy:** operator-triggered. 4 new migrations must apply (0042 pages, 0043 routing rules,
   0044 redirect_pct, 0045 persona quota — all anchored in deploy.yml). Verify deployed-SHA == origin/main first.
3. **R4-OP2 — staging hands-on acceptance:** THE terminal definition of done. Includes the 7 re-minted admin
   visual states (Themes manager, section studio) — before/after in the PR.
4. **R4-OP3 — secrets/spend sign-off:** GOOGLE_MAPS_SERVER_KEY (Maps validation), OpenAI key + the persona-image
   monthly quota (default 50/site) — set/confirm in Dashboard.

## Proof (conductor-run, own hand)
tsc (both configs) 0 · vitest 406 files / 6,045 tests pass==total · the 25 round-4 operator journeys green on
BOTH engines (chromium full + firefox authoring, live legs skip-with-reason) · round-3 operator acceptance 24/24
both engines (no regression) · runtime bundle 46,008 / 46,080 byte-identical · verify:all (jargon 0, golden 0
unclassified) · SVG sanitizer + AI-quota + money-path (routing multiplier / redirect / auction) all adversarially
verified. Full-program audit: SHIP.
