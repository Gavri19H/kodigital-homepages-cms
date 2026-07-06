# LeadGen — Measured Default Reference Funnel Design (insureprimo) + the two registries

## The default design is insureprimo. Screenshots are capability examples only.

- **Default visual design = insureprimo.** It is measured 1:1 from the insureprimo funnel stylesheet (`a2z-agent-demo/api/src/insureprimo/templates/funnel-styles*.ts` @ `b484748e96dc`) and shipped as `src/public/leadgen/designs/default-funnel/tokens.ts` (registry id `default` → insureprimo). Palette: navy `#1B3A5C` + orange `#E85D26`, fonts Literata (display) / Sora (body). This is the authoritative look.
- **The LendingTree screenshots are NOT a design reference.** They are **capability examples** — they demonstrate slides the *component capability registry* must be able to build (a currency range slider, an icon-card grid, a reassurance badge). What color/theme those slides render in is decided by the active visual design (insureprimo by default), not by the screenshots. A green/blue look would be a **separate** visual design added to the registry later; it does not change the default and does not live in insureprimo's token file.

## Two separate registries (do not conflate)

| Registry | File(s) | Owns | Selected by | Default |
|---|---|---|---|---|
| **Visual design registry** | `designs/registry.ts` + `designs/default-funnel/{tokens,styles}.ts` | theme + per-component **style** tokens (how things LOOK) | `funnel_design_id` per Quote variant | `insureprimo` |
| **Component capability registry** | `components/registry.ts` + `components/<Type>.ts` | the catalog of question/answer component **types** (WHAT they collect/validate/emit) | the Section builder (place any capability) | full catalog, always available |

A Section is authored from the **capability** registry; at render time each component reads the **active visual design's** style slots. Same capability, different skins. Adding a look ≠ adding a capability.

## Measured insureprimo tokens (authoritative default)

Full values are in `designs/default-funnel/tokens.ts`; layout geometry in `reference-design-desktop.json` / `reference-design-mobile.json`. Summary:

| Group | Value |
|---|---|
| palette | primary `#1B3A5C` / dark `#0F2440` / light `#2A5080`; accent `#E85D26`/hover `#D14E1C`; bg `#F5F7FA`; card `#FFFFFF`; text `#1A1F36`/`#4A5568`/`#718096`; border `#D2D9E5`; success `#0E7C3A`; error `#D32F2F`; primary-wash `#E8EEF4`; ghost `#F2F6FA` |
| type / spacing / radius | display Literata, body Sora; spacing `.25/.5/1/1.5/2/3rem`; radius `6/10/14/20/9999px`; shadow sm–xl + glow (navy-tinted) |
| header | white sticky, pad `1rem 1.5rem`, shadow-sm, content 600 centered; logo Literata 1.1rem/700 navy (accent span) |
| progress | height 8px, track `#E8EEF4`, **navy gradient fill** `#1B3A5C→#2A5080`, pill; 0.7rem/600 navy text |
| headline / subheadline | Literata 1.375rem→1.75rem/700, center, balance; sub 0.825rem `#4A5568` |
| button | pad 14/16, border 2px, radius-md, min-height 52px, easing `cubic-bezier(.34,1.56,.64,1)`; selected→navy; primary navy, max-w 320, hover `#0F2440`, disabled .6 |
| input / select | pad 1rem, border 2px `#D2D9E5`, radius-md, focus navy, error `#D32F2F`; select custom chevron `#5A6178` |
| card grid / card | grid 3-col; card border 2px radius-md; selected navy border + wash bg + 700; focus outline 2px navy |
| offer/banner card | radius-xl(20), border 2px; first-child recommended (accent border/bg/glow, logo 160×72, cta accent); cta navy uppercase; badge navy |
| transitions / breakpoints | step fade 0.3s; card .15s / btn .2s; progress .4s; ≥640 / ≤480 / ≤400 / ≤375 |

## Capability-component style slots (skinned in insureprimo palette)

These capability-registry components are not in the insureprimo funnel *code*, so insureprimo's visual design supplies their style slots **in its own palette** (navy/orange — never green/blue):

| Capability | insureprimo skin |
|---|---|
| CategoryLabel | uppercase 0.8125rem/700, letter-spacing 2px, **accent `#E85D26`** |
| RangeQuestion | value Literata 2.25rem; track 8px, **filled navy `#1B3A5C`**, unfilled `#E8EEF4`; thumb 28px navy + 3px white border + shadow; min/max 0.8125rem `#718096` |
| ContinueButton | the insureprimo navy primary button (not a blue pill) |
| ReassuranceBadge | **success `#0E7C3A`** border+icon+text, bg `#F2F6FA`, radius 10px |
| IconCardAnswerGrid | insureprimo card; **icons navy `#1B3A5C`**; selected navy border + wash bg |

## Acceptance
Visual-regression compares the rendered default funnel to the **insureprimo funnel** (screenshot + computed-style diff, masking dynamic content) on header / progress / headline / buttons / inputs / card grid / offer cards / states. Capability components (range, badge, category label, icon-card, address autocomplete) are asserted against the capability registry (`components/registry.ts`) — they must be buildable and correctly skinned by insureprimo tokens — with the screenshots used only as capability examples, not pixel targets.
