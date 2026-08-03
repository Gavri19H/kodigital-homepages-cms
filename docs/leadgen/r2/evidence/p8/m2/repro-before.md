# M2 / R3 before-fix reproduction — conductor's own hand

Branch `leadgen-r2-p8-3` @ 6649879 (product code identical to the merged base 543a392), local
worker :8901, real Chromium, 2026-08-03. Probe `api/scripts/p8/repro-m2-inline.mjs`
(mission evidence tooling — never wired into CI). Raw run: `repro-before.txt`.

**Why re-measure at all.** The contract's R3 table was measured at an older sha, and comparable
contract numbers have already been falsified twice in earlier phases. Nothing was dispatched on
the strength of the contract's numbers alone.

## Method

Each key is written as a FULL inline `theme_json` through the real operator route
`PUT /api/admin/leadgen/funnels/lgf_01KZ271383F5X1SQ3DXTXKNJE5/theme`, the live visitor page is
loaded in a real Chromium on a fresh `?_cb`, and `getComputedStyle` is read on the **first
VISIBLE** matching element — walking to the page where that surface is actually rendered. Both
arms carry the same explicit palette, so the only difference between them is the key under test.

A first pass measured 0×0 nodes (`.lg-continue`, `.lg-btn-answer`, `input.lg-input` all exist in
the DOM on the first page but are not painted there) and was discarded: a computed value read off
an invisible element is exactly the false-green this contract exists to kill. The probe now
reports `matched` vs `visible` per reading and measures the first visible match.

## Result — all six of the contract's R3 claims reproduce

| Key | Arms | Element measured (visible box) | Reading A → B | Verdict |
|---|---|---|---|---|
| `button_defaults.casing` | none → upper | `.lg-continue` 320×52 · `.lg-btn-answer` 151×66 (3 visible) | `text-transform:none` → `none` | **DEAD** |
| `card_defaults.shadow` | none → xl | `.lg-question-card` 420×86 | `rgba(20,32,54,.1) 0 8px 28px` → identical | **DEAD** |
| `card_defaults.radius` | sm → full | `.lg-question-card` 420×86 | `16px` → `16px` | **DEAD** |
| `card_defaults.border_role` | error → success | `.lg-question-card` 420×86 | `rgb(233,237,243)` → identical | **DEAD** |
| `card_defaults.background_role` | error → success | `.lg-question-card` white → white; `input.lg-input` 326×54 (4 visible) `#D32F2F` → `#0E7C3A` | card constant, input moves | **MIS-TARGETED** |
| `scales.shadow` | none → high | `.lg-question-card` · `.lg-btn-answer` · `.lg-continue` | all three constant | **DEAD on every visible surface** |

## Two refinements to the contract's table — both stronger, neither weaker

1. `card_defaults.radius` and `card_defaults.border_role`: the contract records their real targets
   as present-but-invisible (`.lg-frame-disclosure--modal .lg-disclosure-panel` measured `_vis:false
   0×0`; `.lg-card-panel` "which no driven page renders"). On this fixture both selectors match
   **zero nodes**, not 0×0 — the element is absent entirely. So `radius` is not merely mis-targeted,
   it is dead in practice.
2. `scales.shadow` is recorded as PARTIAL. On every surface this fixture paints it is DEAD. It does
   have a real consumer the fixture never reaches — `styles.ts:168/172/176 .lg-card-grid .lg-card
   {box-shadow: shadow.lg}`, which requires `button_defaults.layout:"card"`. That reachability is
   an OPEN question at the time of writing, deliberately left unasserted here; the phase's 34-key
   sweep measures it.

## The single cause under four of the six

`.lg-question-card` — the only card a visitor ever sees — reads a **frozen literal token block**:

    tokens.ts:79   questionCard:{background:"#FFFFFF", border:"1px solid #E9EDF3",
                                 borderRadius:"16px", boxShadow:"0 8px 28px rgba(20,32,54,.10)", …}
    styles.ts:569-574   background/border/border-radius/box-shadow ← questionCard.*

No theme layer ever writes that block. Meanwhile the entire `card_defaults` group resolves onto a
different family — `design.color.card` (theme.ts:1290), `design.content.cardRadius` (:1291),
`design.cardPanel.border` (:1292), `EffectiveCardDefaults.shadow` (:1297) — whose only selectors are
`.lg-card-panel` / `.lg-disclosure-panel`, components no driven page renders. The operator edits
"Card corners / shadow / background / border" and paints a component that is not on the screen.

`button_defaults.casing` has its own one-line cause: theme.ts:1285 resolves it to
`EffectiveButtonDefaults.text_transform`, and **no CSS emitter reads that field** — the only two
`text-transform` emissions in the renderer are `categoryLabel.textTransform` (styles.ts:873) and
`banner.ctaTextTransform` (:1919), neither of which is a button.

`scales.shadow` shifts `design.shadow.*`; the visible card's frozen `boxShadow` literal never reads
`design.shadow.*`, so the scale has nothing to scale on that surface.
