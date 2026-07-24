# LeadGen Rework — Runtime engine byte ledger (owner decision D1)

Owner decision **D1** (2026-07-22, binding) raised the visitor-runtime bundle cap from
**46,080** to **51,200** bytes (50 KiB, FINAL for this program) to fund the §7 visitor-facing
widgets. This ledger accounts for **every byte added** against that cap, per feature, with
**real measured deltas from `npm run build:leadgen-runtime` output** (never estimates).

The cap constant lives in `api/scripts/build-leadgen-runtime.ts`
(`export const MAX_BUNDLE_BYTES = 51200;`) and is consumed by `verify:leadgen-runtime`
(imported, not re-hardcoded) which fails CI above it.

## Baseline & total

| | Bytes | Source |
|---|---|---|
| P1 HEAD baseline (before P2 S2.3) | **46,008** | `engine-bundle.generated.ts` at `leadgen-rework/p1-data-server@4c9b534` |
| Final (all S2.3 widgets) | **50,037** | `npm run build:leadgen-runtime` |
| **Net added by S2.3** | **+4,029** | |
| D1 cap | **51,200** | |
| **Headroom remaining** | **1,163** | 97.7% of cap consumed |

## Per-feature measured deltas

Each delta is a real build measurement. Isolated features were measured by removing that
feature's code from the final tree, rebuilding, and diffing against the 50,037-byte final
(the exact method for the three `engine.ts` widget rows, which share the file); the two
`validation.ts` rows were measured incrementally from the 46,008 baseline (address-only via a
dead-coded `if (false && …)` isolation build). The rows sum exactly to the +4,029 net.

| # | Feature (contract anchor) | File(s) | Measured Δ | §7 estimate | How measured |
|---|---|---|---|---|---|
| 1 | Phone **mask fill UX** — scaffold fill, caret-at-first-empty-slot, Backspace-drops-last-digit, raw-digits recording, scaffold init on entry (§6.9) | `engine.ts` | **+1,412** | ~700 | 50,037 − 48,625 (build with mask code removed = engine-total 2,236 − other 162 − slider-widgets 662) |
| 2 | **Slider widgets** — stepper −/＋ buttons, aria-valuenow sync on every handle (§6.8) | `engine.ts` | **+662** | part of ~3,072 | 50,037 − 49,375 (build with stepper method + click branch + aria block removed) |
| 3 | **Slider bounds validation** — from_to/dual `min ≤ from ≤ to ≤ max` + both-required over `{base}_min`/`{base}_max` (§6.8) | `validation.ts` | **+939** | part of ~3,072 | 46,947 − 46,008 (validation build with the address branch dead-coded) |
| 4 | **Other-select** mutual exclusion — base-click clears the Other `<select>`; Other change deselects base choices (§6.5) | `engine.ts` | **+162** | ~307 | 50,037 − 49,875 (build with both Other-select blocks removed) |
| 5 | **Address per-field validation** — per-field required + `none`/`zip5`/`{regex,message}`, positional `fields[i]`↔`internal_fields[i]` (§6.10) | `validation.ts` | **+854** | ~410 | 47,801 − 46,947 (full-validation build minus the from_to-only build) |
| 6 | **Progress recompute + funnel-switch resume + auction trigger guard** (§4.3-8/-11/-12) | `engine.ts` | **+0** | ~512 | No new code: already wired by the Round-4 P4a `maybeSwitch`→`applyPlan`→`enterPage`→`updateProgressUi` machinery and `advance()`'s plan-filtered `visibleIndexes()`; the server (P1) stamps the plan denominator + switch-resume position. S2.3 proves these with tests only. |
| | **TOTAL** | | **+4,029** | ~5,000 | 50,037 − 46,008 |

### Notes on variance from §7 estimates
- **Sliders came in far under** the ~3 KB estimate (widgets 662 + bounds 939 = 1,601): the
  five types are built on the **native `<input type=range>`/`type=number>` substrate**
  (§9 "hand-rolled on native inputs … copying its keyboard/aria model"), so native drag +
  keyboard (arrows/home/end) + slider role are free; the engine adds only the stepper deltas,
  aria-valuenow sync, and bounds validation. Radial is treated as §6.8's `= single, circular
  rendering` (the SVG arc is server-side, uncapped); no pointer-arc geometry ships in the engine.
- **Mask (1,412) and address (854) came in ~2× estimate**: the caret model + Backspace keydown
  + scaffold init (mask), and the per-field regex/zip5 matrix (address), cost more than the
  round figures. Still well inside the D1 headroom.
- **Progress/resume/auction = 0**: those legs were already delivered by Round-4 P4a and P1;
  S2.3's job there is proof, not new bytes.

## P6 S6.3 — acceptance-phase runtime fixes (three §11 producer↔consumer divergences)

Three defects the §11 terminal journeys surfaced (unit tests hand-built config+DOM, so a
real producer↔consumer key/selector mismatch was invisible). All three fixes touch the
capped engine bundle. Deltas are real `npm run build:leadgen-runtime` measurements by
isolation build (revert one fix, rebuild, diff), same method as the S2.3 rows above.

| | Bytes | Source |
|---|---|---|
| S2.3 final (prior ledger total) | **50,037** | `npm run build:leadgen-runtime` |
| S6.3 final (all three fixes) | **50,435** | `npm run build:leadgen-runtime` |
| **Net added by S6.3** | **+398** | |
| D1 cap | **51,200** | |
| **Headroom remaining** | **765** | 98.5% of cap consumed |

| # | Fix (contract anchor) | File | Measured Δ | How measured |
|---|---|---|---|---|
| S6.3-1 | **Address per-field validation — answer-key derivation** (§6.10/M9 P0): `validateSection` derives each address sub-field's store key via the recorder's own convention (`props.maps.fills.<kind>` override else `{base}_{kind}`; `full_address`⇒base) instead of the positional `props.internal_fields` read the M9 studio never writes — so required/zip5 gate the value the DOM actually records. | `validation.ts` | **+327** | 50,364 (item-1-only build) − 50,037 |
| S6.3-2 | **Hidden-set answer-producer scope** (§4.2): `hiddenFields()` drops non-answer-producing `ValidationError` nodes (produces===null, server answers.ts `fieldsOf` parity) before computing the dependency-hidden set, so an always-visible error-slot binding can no longer un-hide a hidden input and leak its `default_applied`/user answer into `/lg/auction` + sessionStorage. | `engine.ts` | **+87** | 50,451 (item-1+2 build) − 50,364 |
| S6.3-3 | **Other-select display reset** (§6.5): base-choice click resets the authored Other `<select>` to its "Choose…" placeholder — the reset now selects the `[data-lg-other-panel]` element directly (presets renders `data-lg-other-panel`+`data-lg-input` on the SAME `<select>`; the old descendant selector `[data-lg-other-panel] [data-lg-input]` never matched, so the display never reset). | `engine.ts` | **−16** | 50,435 (final) − 50,451 (item-1+2 build) |
| | **TOTAL** | | **+398** | 50,435 − 50,037 |
