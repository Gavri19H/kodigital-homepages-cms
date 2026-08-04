# N15 — what the owner's Image11 actually shows (opened, not inferred)

`docs/leadgen/source-of-truth/images/Image11.png`, opened by the conductor. The contract's N15 line
says **"Open the image"**, and the mission brief says design pins are images — *open them, never infer
them*. This file records what is in it so the implementing slice works from the pin, not from prose.

## The image

Two sliders, stacked, each under a small collapsible caret heading:

**"Value"** — a single-handle slider. The filled portion runs from the left end to the handle. Directly
**UNDER the handle** sits **`$37`** in bold, dark text. At the two track ends, **below** the track and
noticeably smaller and grey: **`0`** at the left, **`100`** at the right.

**"Range"** — a two-handle slider. The filled portion runs BETWEEN the two handles (the outer portions
are grey). Under the left handle: **`18%`** bold dark. Under the right handle: **`78%`** bold dark.
Again at the track ends, smaller and grey: **`0`** left, **`100`** right.

## What that pins, stated as requirements

1. **The current value sits UNDER its own handle and travels with it.** Not above the track. On a dual
   range there are two such labels, one per handle.
2. **The end labels are the SCALE (min and max), not the values.** They are visually subordinate —
   smaller and grey against the values' bold dark — and they stay put.
3. **Therefore the value must not be printed twice.** The contract measured the product showing pills
   `$0 | $1,000` AND end labels `$0 | $1,000` — i.e. the same pair rendered in both positions, with the
   scale never shown at all. Image11 shows the two roles are different information: `18% / 78%` are the
   values, `0 / 100` are the bounds.

## The contract's measurement, for the slice's fail-before

> `dual_range` pills measured `y=1332 h=23`, track `y=1370` — **15px above** the track; the owner's
> Image11 puts values **under** the handles. Values are also duplicated (pills `$0 | $1,000`, end labels
> `$0 | $1,000`).

Those numbers are from an older sha. Re-measure before fixing — comparable contract numbers have already
been falsified more than once on this mission.

## Enforcement, per the mission's design-pin rule

Two legs, and the second is a human judgement that is never automated: (a) DOM-anatomy assertions plus a
committed same-theme screenshot baseline (a self-diff), and (b) a human side-by-side against Image11.
**Never** an automated pixel-match against the owner's image.
