# B3 after-fix — conductor-driven acceptance (contract §5 B3 / R6-1)

Branch `leadgen-r2-p8-1`, local worker :8901, real Chromium 1280x900, 2026-08-03.
Screenshots: `b3-before-wrong-target-1280.png` (defect), `b3-after-correct-target-1280.png` (fixed).

Contract: *"from funnel C's chip, change a colour; prove funnel C changed and funnels A/B/D did
not, in storage **and** on their live pages. Same for the Template chip."*

## The drive

Clicked the Theme chip on funnel column 3 (P8-Charlie, `lgf_…G30E`), expanded Brand primary,
clicked the success-green swatch. Chips now carry per-funnel identity, and the carry lands:

```
#lg-quote-editor data-carried-funnel-public-id  = lgf_01KZ279RW7CMXCDT9JF8WJG30E   (Charlie)
#lg-quote-editor data-carried-variant-public-id = lgn_01KZ279RW7WYQ9361MMFF0D2SW
active tab = Themes ; console errors = 0
```

Network (real requests):
```
GET /api/admin/leadgen/funnels/lgf_01KZ279RW7CMXCDT9JF8WJG30E/theme -> 200
PUT /api/admin/leadgen/funnels/lgf_01KZ279RW7CMXCDT9JF8WJG30E/theme -> 200   <-- Charlie, the clicked funnel
```
Before the fix the identical journey issued GET+PUT against **funnel A** (`repro-before.md`).

## Isolation — storage

| Funnel | Stored theme after Charlie's edit |
|---|---|
| A (editor-selected default) | `theme_id=thm_p8-repro` — record reference INTACT (before the fix this journey clobbered A's reference into an inline palette) |
| B | `null` — untouched |
| C Charlie | inline palette `brand_primary=success` — the edit landed here |
| D | `null` — untouched |

## Isolation — live pages (served config per funnel variant)

| Funnel | Served `design_tokens.color.primary` |
|---|---|
| A | `#AB1234` (its own theme record, unchanged by Charlie's edit) |
| B | `#1B3A5C` (default) |
| C Charlie | `#0E7C3A` — the edit reached Charlie's live serve path |
| D | `#1B3A5C` (default) |

Funnel A's live shell also still emits `--lg-primary:#AB1234`. (`#0E7C3A` does appear in A's
sheet as A's OWN `--lg-success` role value — checked explicitly so it is not misread as leakage.)

## The chip label (same clause)

`funnel.ts:447`'s static literal `"Theme"` is gone: funnel A's chip renders `thm_p8-repro`
(its actual theme) and B/C/D render `Default`. A `{theme_id}` pointer renders the id, not a
friendly name — no theme-name catalog is reachable in the board's data without adding a fetch,
so the honest id is shown; recorded as a residual rather than papered over.

## Template chip

Both chips carry identity; the Templates island resolves carried-first / editor-default at all
three funnel-scoped call sites (canvas preview, apply-template, A/B templates). Its canvas
preview PAYLOAD (`draft_frame_config`/`draft_theme`/`site_id`) still derives from the
editor-default funnel's boot state — only the target variant follows the carry. Recorded as a
residual; the B4 work in P8-2 owns that canvas.

## Defect found by driving, fixed in-phase (not by any test)

The first implementation passed every unit test while being COMPLETELY DEAD in the browser:
the page emits its client JS as several separate IIFEs, and the carry helpers were defined in a
different IIFE from their call sites — the real console showed
`ReferenceError: clearCarriedChipFunnel is not defined` and `ReferenceError: root is not defined`,
the chip click did not even switch tabs. Fixed by making each emitted scope self-sufficient
(call-time `#lg-quote-editor` lookup). The new regression asserts, over the REAL assembled page,
that every carry identifier referenced in a script block is defined in that same block — it
reproduces both ReferenceErrors on the pre-fix code.
