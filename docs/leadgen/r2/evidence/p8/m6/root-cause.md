# M6 / R4 — the canvas is not a faithful preview because the engine never runs in it

Grounded before P8-5 was dispatched, so the slice fixes a cause rather than five symptoms.
All file:line verified at `c6fba70`.

## The one fact under most of the R4 table

The studio canvas is an `<iframe>` whose `srcdoc` carries
`<meta http-equiv="Content-Security-Policy" content="script-src 'none' …">` (`ui-section-studio.ts:1274`).
That is **deliberate** — its own comment at `:1269-1270` says so, and the iframe's
`sandbox="allow-same-origin allow-scripts"` (`:1627`) would otherwise permit scripts.

Consequence: **`engine.ts` never executes inside the canvas.** Both parity failures the contract lists
as separate rows are behaviours the client runtime performs, so neither can happen there:

| Contract row | The behaviour | Where it lives | Why the canvas misses it |
|---|---|---|---|
| authored `defaultValue:true` paints unselected (`lg-btn lg-btn-answer`, `aria-checked=false`) instead of `lg-selected` / `aria-checked=true` | `presets.ts` always emits `aria-checked="false"` (`:1465,:1541,:1687,:1820`); the swap is `applySelectionClasses` | `render.ts:92`, called from `engine.ts:1306/1645/1846` | engine never runs |
| dependency-hidden questions always painted | `applyComponentVisibility` | `render.ts:69`, called only from `engine.ts:1211/1442/1810` | engine never runs |

The live page loads the engine bundle as an ordinary script, so it does both. The canvas renders the
same server markup through the same `presets.ts` — it is the *runtime layer* that is absent, not the
renderer.

## The rest of the table is decoration the PARENT page injects

Not canvas rendering at all — the admin page reaches into the iframe's DOM after load (outside the
CSP-blocked `srcdoc`), so none of it has any equivalent in `presets.ts` / `serve.ts` / `engine.ts`:

- the `Yes / No`, `Searchable dropdown` and `Short text field` badges — one site, `ui-section-studio.ts:7338`
  (labels from `STUDIO_TYPE_META:341/:353`; the Address case via `acceptFormatOfNode:4919`)
- `+ Add choice` ghost — `:6686-6692`, inside `decorateChoiceCards:6634`
- the `fills: city` chip — `:7442-7453`

Entry points, for the comparison the fix must make: canvas `renderCanvasNow` (`:6501`) → POST
`/api/admin/leadgen/sections/preview` → `previewSectionHandler` (`sections-handlers.ts:1780`) → injected
at `:6541` → `applyCanvasDecoration()` (`:6542`, defined `:7399`). Live: `renderSectionComponents(...)`
(`serve.ts:722`) — the same shared `presets.ts` renderer.

## What this means for the fix

The owner's standard is *"the canvas should include one section in the middle so the user could see a
real reference of how is design is gonna look like in real life."* Two honest routes exist and the
slice must choose deliberately and say why:

1. **Reproduce the runtime's resting state server-side** for the preview — i.e. the preview endpoint
   emits the markup the engine would have produced at rest (selected defaults applied, dependency-hidden
   nodes withheld). No script in the canvas; parity by construction.
2. **Let the engine run in the canvas**, which means changing that deliberate CSP. That is a security
   posture decision, not a rendering one, and it is NOT to be taken unasked — if the slice believes it is
   the only route, it must STOP and report rather than loosen a CSP the product set on purpose.

Route 1 is the one that does not touch a security control. The chrome injections are separate and simply
must not be painted into a surface the owner reads as a preview of the live page.

Contract's own note, to keep the slice from over-reaching: the R4 table records address attributes,
slider value/position, currency affix, and phone/date/email as **identical** between canvas and live —
*"these are correct, leave them."*
