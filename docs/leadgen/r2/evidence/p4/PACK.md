# P4 OWNER REVIEW PACK — ⑤ the five SLIDERS

Delivered 2026-07-30. Your D10 pause for this pack was **waived by your own instruction** ("approve,
continue and don't stop until the last P") — so it is delivered with unchanged rigor and collects at
the terminal gate rather than blocking. **Everything below was driven by a fresh-context reviewer
that authored each slider itself, dragged it with a real pointer, and measured the result.**

## The five side-by-sides — your image, then the built render

Open each pair together. Left: `docs/leadgen/source-of-truth/images/<pin>`. Right: the driven
render in `docs/leadgen/r2/evidence/p4/review/`.

| Type | Your pin | Built render (1280 · 375) | What the pin demands, and what it does |
|---|---|---|---|
| **single** | `Image11.png` (the "Value" slider) | `single-1280-rest.png` · `single-375-rest.png` · after-drag/keys | Big `$37` readout, fill, **one handle ON the track**, captions `$0`/`$100`. The handle sat ~20px BELOW the track before; measured now at **0.0px** from the track centre, at both widths. |
| **stepper** | `Image10.png` | `stepper-1280-rest.png` · `stepper-375-rest.png` · after-drag | **48×48 −/＋ buttons FLANKING** the `$170,000` readout (gaps 121.5/121.5 at 1280, 27.0/27.0 at 375), track+fill+handle below, captions `$5,000`/`$500,000` — the captions were **missing** entirely before. |
| **from_to** | `Image13.png` (+ `Image12.png`) | `from_to-1280-after-drag.png` · `from_to-375-after-keys.png` | **ONE track, TWO handles**, tooltip pills, end captions, and **two LABELLED inputs "From ($)" / "To ($)"**. Before: no visible handles, two bare unlabelled boxes, no `$`, no captions. |
| **dual_range** | `Image11.png` (the "Range" slider) | `dual_range-1280-after-drag.png` · `dual_range-375-rest.png` | ONE track, two handles, readouts `18`/`78`, captions — the fill spans **exactly** 18%…78% between the handles. Before: two stacked separate tracks with no readouts. |
| **radial** | `Image14.png` | `radial-1280-rest.png` · `radial-375-rest.png` · after-drag/keys | A real **176px circular dial** (140px at 375) with a live conic arc and a draggable ring handle; the centre value tracks the drag `45 → 25 → 50 → 55` with `--lg-deg` matching `value·360/span` at every sample. Before: **no dial at all** (a flat strip) and a **frozen** centre value. |

## The five drag recordings (§5.5)
`docs/leadgen/r2/evidence/p4/pack/` — `drag-single.webm` (3.6s), `drag-stepper.webm` (3.4s),
`drag-from_to.webm` (5.2s), `drag-dual_range.webm` (5.2s), `drag-radial.webm` (3.4s). The reviewer
extracted frames from each and confirmed real motion: `$37→$46→$82`, `$170,000→$265,000→$410,000`,
pills `$0/$100,000 → $25,000/$70,000` with the fill spanning between, `0/100 → 24/68`, and the
radial `45 → 33 → 50` with arc and ring handle following.

## Your other two sentences in #7
- **"You must give the user the option to pick his desired slider from sliders list!!! the slider
  type is not a theme decision"** → the picker offers all five as thumbnail cards; each selection
  persists its own `slider_type`; a grep of the theme surfaces finds **zero** slider-type controls.
  → `picker-1280.png`
- **"the currency is only a graphic feature"** → `$` toggled ON then OFF on all five types, every
  save HTTP 200 with **zero** error banners, and the stored `type`/`answer_type` unchanged each
  time. The Image9 save conflict is gone and stays gone. (The three output formats — currency
  string / number / number-as-string per offer — are P5's work, not this phase's.)

## What driving caught that tests did not
This phase is the contract's named "exists ≠ executed" case: all five renderers already existed and
passed tests while four of five were visually broken. Two further defects only appeared under a real
pointer:
1. **A typed value reached your buyer wrong.** On a from_to slider, typing an out-of-order number
   left the box showing `90000` while the payload carried `35000`. Fixed — then the *fix* made the
   "To" box impossible to type into (typing `60000` landed `100000` in the payload). Both are now
   closed, and the acceptance was widened from the reported bug to the whole interaction: type-up,
   type-down, clear-and-retype digit-by-digit, paste, and out-of-order, on both fields, at both
   viewports, each checked against the field, the on-screen rails **and** the provider row.
2. **A driven handle overflowed the 375 viewport by 18px** and clipped the value pill (clean at
   rest, broken when driven). Now swept across every handle position at both widths: zero overflow.

## Gate
typecheck 0 · **vitest 7,379/7,379 (445 files)** at the pre-fix-2 stamp, re-run clean after · all
verifiers 0 · runtime bundle **52,762** of your 53,248 cap (**486 B headroom**, P5's allocation
intact) · F5 clean · register 103 rows / 0 violations.

## For your eye / your ruling
- **ADJ-N21 — the one place the pins disagree with each other:** §6.8 (the binding design-pack
  anatomy) puts the value readout **above** the track; your Image11 shows it **below**, for both
  the single readout and the dual pills. The build followed §6.8. Both are defensible; this is
  yours to pick. Compare `single-1280-rest.png` and `dual_range-1280-after-drag.png` with Image11.
  Colour differences (navy vs Image10's green) are **not** a deviation — you ruled that theme owns
  colours.
- Older captures under `s4a/`, `s4b/` and `cleanup/` predate the last two fixes and are kept only as
  slice history — cite `review/`, `fixfirst/`, `fix2/` and `pack/` for current behavior.
