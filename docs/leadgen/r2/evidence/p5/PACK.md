# P5 OWNER REVIEW PACK — ⑥ the ADDRESS, the per-offer FORMATS, and the last adjacents

Delivered 2026-07-30 (async per F6 — merges on adversarial SHIP; your eye collects at the terminal
gate). This is the last build phase. Evidence: `docs/leadgen/r2/evidence/p5/` — `review/` (the first
fresh-context review, 53 artifacts) and `rereview/` (the scoped re-review after the fixes, 51).

Everything below was **authored as an operator and driven as a visitor** on a live instance by a
fresh-context reviewer who re-ran your scenarios itself. Nothing here rests on a passing test.

---

## ⑥ The address — "one of your worst executions"

Your sentence asked four questions. Each is now a thing you can author, and each was driven:

| You asked | What you get now |
|---|---|
| "if I want it as a free text without validations or auto fill?" | ONE box. No validation, no autofill. → `rr5-g1-freetext-1280.png` / `-375.png` |
| "if I want only street address?" | ONE box, street only. → `rr5-g2-street-only-1280.png` / `-375.png` |
| "auto fill only for street address and city … the user will insert the Zip by himself but to validate the Zip in a 5 digits zip validation?" | Exactly that — and a bad ZIP now **says so out loud**: "Enter a valid 5-digit ZIP code." in red under the field, Continue blocked. The probe found it *"blocks SILENTLY, red border only."* → `rr5-g3-badzip-1280.png`, then `rr5-g3-goodzip-cleared-1280.png` |
| "the mapping of what is auto-filled per field should definatly be an option" | Per-field Mode is authored per sub-field, and honours what you set. |

**Two more things the drives caught that you did not have to report:**

1. **An unconfigured address used to render ONE bare input** while the studio inspector showed four
   fields — the inspector and the product disagreed. It now renders the full four-field composite
   (your D3 ruling), and the two agree. → `rr5-g4-d3-composite-filled-1280.png` / `-375.png`
2. **The four boxes had no visible labels.** The only naming was placeholder text, which vanishes the
   moment a visitor types — so a filled address read as four anonymous boxes: *911 Marlowe Terrace /
   Weehawken / NJ / 07086*. Each sub-field now carries a persistent label. Compare the pre-fix
   `review/revA-s4-d3composite-1280.png` with `rereview/rr5-g4-d3-composite-filled-1280.png`.

**Image8 — a call I made that you can overturn.** The reviewer read Image8 as a design target and
asked for a separate "Start typing your address…" box above the fields. I declined: Image8 is the
screenshot of the **rejected** build — its inspector shows "Validate with Google Maps" *unchecked*
while the canvas still forces that autocomplete and a rigid auto-fill group, which is what you were
pointing at ("I didn't even checked the 'Maps' feature!!!!"). Building it would reproduce your
complaint. So P5 shipped the labels and not the box. **ADJ-N28** carries it for your ruling — open
`images/Image8.png` beside `rr5-g4-d3-composite-filled-1280.png`.

---

## #7B — "the currency is only a graphic feature"

Three shapes, each picked by **clicking the control** (never raw JSON), one visitor, slider
165,000 → 170,000, read back from the live auction log:

| Offer | You picked | Buyer received |
|---|---|---|
| 1 | Currency string | **`"$170,000"`** |
| 2 | Number | `170000` |
| 3 | Number as string | `"170000"` |

**This was the phase's blocker, and it is the one to understand.** Before the fix, offer 1 sent
**nothing at all** — the field was silently dropped — and offer 3 sent an unquoted number. Meanwhile
the control's preview chip read `170000 → $170,000` and the validator read "✓ No issues." Three admin
surfaces agreed with each other and disagreed with what the buyer actually got.

All three now match the dispatched rows byte-for-byte, **including the failure case**: an invalid
value shows "invalid → fallback (field omitted)" and the provider genuinely receives `{}`. There is
also no longer any way to store a format the control can't show you — the old trick (pick the format,
then switch the type) is closed, and a contradiction forced through the Advanced drawer is displayed,
flagged, and refuses to save. → `rr1-log.txt`, `rr2-b1-type-owned-by-format-1440.png`,
`rr2c-rawjson-contradiction-1440.png`, `rr7-invalid-fallback-chips-1440.png`

---

## "every component that include more than one field"

Your second #6 sentence, which no earlier phase had implemented. Both classes are now authorable
**by clicking**, with zero raw JSON:

- **Address** — the offer field picker offers `_street` / `_city` / `_state` / `_zip` and **not** the
  bare base (the visitor never records a base key). One ZIP sub-field → two offers → `"04686"`
  (string) and `4686` (number).
- **Sliders** — the same gap existed on the five types P4 just rebuilt for you. A from_to slider now
  offers `_min` / `_max`; single/stepper/radial still offer their single field. `_min` and `_max` →
  two offers → `"$10,535"` and `400550`, from a visitor who moved the slider.

Delivered structurally rather than per-component: the picker now reads the **one** function that
decides what a visitor actually records, so what you can map always equals what arrives. A mapping to
a field that no longer exists is flagged "(not on a linked Section)", never silently blanked.

---

## What driving caught that no test could

1. **Saving a payload schema silently destroyed the offer's response-parsing config.** Change an
   output format, hit Save, and the offer could no longer be activated — a 409 that never explained
   itself. On your live auction money path. Same journey, before and after: **409
   `carrier_parse_missing` → 200 with all 8 preflight checks green.**
2. **An "Other" value row you added and left blank was silently discarded** — chip said "No issues",
   save returned 200, row gone on reload. Now it's a visible, blocking issue. Fixing it exposed a
   second defect: "+ Add value" never re-collected the list, so a fresh row was invisible to the chip.
3. **Then the same silent drop, one door over:** enable "Other", remove every row, save — and the
   checkbox quietly unchecked itself. Found by the re-review, fixed rather than deferred, because it
   sits inside the very clause about silent drops.
4. **A test was passing on fake data** — its fixture used component types that don't exist in the
   catalog and that the product's own validator refuses to save. It only ever passed because the old
   code echoed field names without checking. It is now pinned against the real validator.

## Re-proved, unchanged (the clauses you had rated fine)

Phone mask `(3)-3-4` with its block message · the "Other" dropdown on **both** Buttons and Cards
(and its option text no longer clipped) · cards centred with "+ add choice" outside · the dropdown
inspector clean, with the leftover control also gone from the Offers payload builder. One journey
from each earlier phase was re-driven too: the P1 grid default, the P3 footer, a P4 slider drag.

## Gate

typecheck 0 · **vitest 7,435 / 7,435 (448 files)** · verify:all 0 · orphan-scan 0 · runtime bundle
**52,762** of your 53,248 cap (**486 B headroom** — eleven fix commits added **zero** runtime bytes) ·
F5 deferral scan zero hits · register 115 rows / 0 violations. Two fresh-context reviews: the first
returned FIX-FIRST (1 blocker, 3 major, 6 minor), the second re-drove every fixed journey and returned
**SHIP**.

## For your ruling

- **ADJ-N28** — the Image8 autocomplete box (above). The one I'd most like you to look at.
- **ADJ-N34** — `NameFieldsGroup` projects unprefixed `first`/`last`, so two name groups in one
  section would collide. Pre-existing and outside every clause, but it is the same class as the
  address seam this phase just proved, and the `{base}_{slot}` pattern is ready to apply.
- **ADJ-N26/N27/N29/N30/N31/N32/N33** — dead CSS whose removal would churn frozen legacy pins;
  `aria-checked` on `<option>`; a `carrier_parse_version` nothing increments; a stale mapping flagged
  in the picker but not counted by the validator; a stale v2.4 doc line; the Sample-payload panel
  being a shape illustration rather than a value promise; and picking a format on an unmapped number
  field hiding the value-map panel.
- **Still owner-owned at cutover:** the Maps autocomplete leg (your production keys exist but cannot
  be read locally — D8 carved it out; no local key was used and no autofill was faked) and the
  `state=CA` live-geo rule.
