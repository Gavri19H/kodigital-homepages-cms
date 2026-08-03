# N7 and N11 — conductor drive on the live admin editor

Branch `leadgen-r2-p8-3`, worker :8901, real Chromium at 1280, 2026-08-03.
Script `api/scripts/p8/drive-n7-n11.mjs`. Raw run: `n7-n11-drive.txt`.
Screenshots: `n7-n11-themes-rail-1280.png`, `n7-select-zoom-3x.png`.

Both items were driven rather than read, because neither can be settled by a lane: N7 was fixed by
shortening a string rather than by changing the width that clips it, and N11's honesty depends on an
island actually enabling the buttons it ships disabled.

## N7 — the select no longer truncates its own value

Measured on the real control: the selected option's label rendered in a canvas with the select's OWN
computed font (`14px Arial`), against the control's real content box.

| | width |
|---|---|
| control content box (`clientWidth 149 − padding 12 + 12`) | **125.00px** |
| `"Inherit from base design"` — the string before the fix | **150.19px** → clipped |
| `"Inherit from base"` — the string now shipped | **105.05px** → fits |

All 16 visible `[data-theme-key]` selects: **0 truncated of 16**. The 3× element screenshot shows the
full label with clear whitespace before the native chevron — no ellipsis.

### A false defect I produced and corrected

My first pass reported **"16 of 16 truncated"**. That was wrong, and it was my arithmetic, not the
product: the script subtracted an *assumed* 20px arrow from the content box AND compared
`Math.ceil(text)` against `Math.floor(available)`, stacking two roundings into a 1px shortfall that
does not exist. The element screenshot falsified it immediately. The script now compares against the
real content box, flags labels within 20px as "tight" rather than clipped, and carries the mistake in
its own header so the next person does not repeat it.

The cause of the original truncation is untouched and still lives outside this fix: the rail's
2-column grid (`quotes-tabs/shared.ts:548 .lg-scalars{grid-template-columns:repeat(2,1fr)}`) with
`admin/templates/layout.ts:469 .form-select{width:100%}`. The shipped fix shortens the string to fit
that column. It works — measured — but any future label longer than ~125px in this rail will clip
again, and the structural fix would be the column width. Stated so nobody records this as
"truncation solved" in general.

## N11 — the preset actions are honest

**With presets present (2 in the live store), driven:**

```
apply : disabled=false  title=""                                                   "Apply to this funnel"
ab    : disabled=false  title="Fork this variant with the picked preset as its theme, then set the traffic split"
help  : "Save the current look as a reusable preset from the Themes manager, then apply or delete any preset there. Presets are shared across every funnel."
```

Both actions are enabled, the A/B button's descriptive title is restored, and the help text is the
ready copy. Page errors during the drive: **none**.

**With zero presets:** proven through the real stack rather than here — `api/test/leadgen-p8-n-theme-ui.test.ts`
boots the real island over a real router and a real in-memory D1 holding no themes, which is the state
a fresh install is in. Driving it on this instance would have required deleting `thm_p8-repro`, the
record funnel A is bound to, and the create route does not restore a chosen id.

**The failure branch, read from the shipped island** (`quotes-tabs/themes.ts`, `refreshPresetAvailability`):
if the list read fails, the buttons stay disabled (their SSR default) and the copy becomes
*"Could not check for saved presets — reload the page to try again."* Unconfirmed never reads as ready.
That is deliberate and honest, but it does mean a failed read leaves the operator unable to apply a
preset until reload — flagged for the reviewer rather than treated as settled.
