# 05 · Section Builder Redesign Contract

Evolves `ui-section-studio.ts` (URL `/admin/leadgen/sections/:id/edit` unchanged). The v2.4 studio architecture (server-rendered canvas via `POST /sections/preview`, island state tree, mapping panel, preview drawer) is PRESERVED; this contract re-scopes it to the question unit and fixes F1–F8.

## 5.1 Layout (exact panels)

**Top bar (kept, re-worded):** ← Sections · Section name · status pill · Activity dropdown · Vertical dropdown (existing D2 dropdown behavior) · mapping badge (“Mapping k/n Offers complete”) · issues chip · Save · Archive.

**Settings strip → “Question” strip (AMENDS v2.4 §8.1 settings form):**
- `Question headline *` — THE canonical editor for `headline_text`.
- `Subheadline` — canonical editor for `subheadline_text`.
- `Continue behavior` — radio: “Visitor taps Continue (validates first)” / “Advance automatically on answer” (values unchanged: `button`/`auto_advance`). Note: “The Continue button’s default style and position come from the Quote’s frame.”
- The legacy global Maps checkbox row stays (compat, per-field config wins — unchanged).
- REMOVED from this strip: nothing else; the strip never duplicates canvas content because of the binding below.

**Left:** component library, re-scoped (`08`). **Center:** unit canvas + toolbar (`06`). **Right:** scope-aware inspector (`07`). **Bottom drawer:** Mapping (`12`) · Validation issues (click-to-focus) · Preview & debug.

## 5.2 Canonical headline binding behavior (D1 — the F1 fix, normative UX)

- New Sections seed `content_json` with a **bound** `QuestionHeadline` (`bind:"section_headline"`) + bound `Subheadline` as nodes 1–2.
- The top-strip inputs and the bound canvas nodes are ONE value: typing in the strip live-updates the canvas render; inline-editing the bound node on canvas writes the strip input. One store (`headline_text` / `subheadline_text`), two views. There is NO second text field anywhere.
- Selecting a bound node shows inspector Content tab with the SAME single field, labeled “Question headline (shared with the Section header above)”.
- Deleting a bound node = hide in this question unit: canonical text kept; a persistent chip appears next to the strip input — “Hidden in this question unit · [Show]” — which re-inserts the bound node at the top.
- Legacy Sections: on load, if an unbound `QuestionHeadline` node’s `props.text` is byte-equal to `headline_text`, the studio offers a one-click banner “Link headline to the Section’s canonical headline” (sets `bind`, drops `props.text`); if texts differ, the banner shows both values and lets the operator pick which wins. Never auto-mutated on load; the change happens on Save.
- The palette items “Question headline” / “Subheadline” insert BOUND nodes when no bound node exists, else they are disabled with tooltip “This Section already shows its headline”. Free-text extra headlines are not insertable (CategoryLabel + HelperText cover kicker/support copy).

## 5.3 Modes (drawer + canvas states — kept, one addition)

1. **Build** (default) — unit canvas.
2. **Mapping** — `12`.
3. **Validation / Dependencies** — existing issue list + IF/THEN builder.
4. **Design overrides** — Section-level role overrides (`09 §9.5`).
5. **Preview in Quote frame** — NEW: frame picker (Quote → Funnel → Variant that includes or could include this Section) + site selector; renders the unit inside the chosen frame via the composition preview (`13 §13.4`). Empty state: “This Section isn’t used in any Quote yet — previewing in the default frame.”

## 5.4 Canvas scope (the F4 fix)

- The canvas renders the **question unit only** — no header/logo/progress/back/footer/background ever appears in Build mode. An optional “Frame hint” toggle draws a dimmed, non-interactive frame skeleton (generic) around the unit for spatial context; it is presentation-only and never editable here.
- Palette contains only `unit`/`both` scope items (`08 §8.2`). Local containers (Stack/Grid/Columns/CardPanel/Spacer) remain for INSIDE-unit structure.
- Legacy frame-scope nodes found in `content_json` render with an amber overlay badge: “Page-frame element — belongs to the Quote frame · [Move to Quote frame] [Keep (legacy)]”. Move action: removes the node and (when the Section is used by exactly one Funnel) writes the equivalent `frame_config_json` group after an explicit confirm that names the funnel; used-by-many → the action opens a picker listing the funnels, applying to the chosen one and simply deleting from the Section only after confirm. Keep = no change — but note (C2): while a funnel using this Section has a configured frame, **activation blocks** on these components unless that funnel’s Advanced legacy override is set (`14 §14.1`, `03 §3.3 compat`); the badge names this consequence.

## 5.5 Component depth (tailored editors — binding per type)

Every editor is reachable from the inspector tabs (`07`) and, for choice components, inline on the canvas (`06 §6.4`).

- **Button answer group:** choice rows (label · internal value · analytics label) · columns/stack · auto-advance flag reflects Section continue mode · selected-state style role. Provider values: per-Offer, in the Mapping tab only (C1, `12 §12.2`).
- **Two-button yes/no:** yes/no labels · boolean values fixed true/false · provider values per Offer (via mapping value map) · optional default answer + “user must confirm default” note (analytics `answer_source` semantics unchanged).
- **Icon card grid:** per-choice icon (curated icon picker) or emoji · title · subtitle · value · columns d/t/m · selected/hover/disabled styling via roles · mobile behavior.
- **Image card grid (F6 fix, full list):** per-choice image (media picker + upload + “Generate with AI” using the existing `ai-api` leg) · `image_alt` REQUIRED · title · subtitle · badge · value · analytics label (`analytics_id`, auto-suggested, editable in Advanced) · per-Offer provider values via the Mapping tab (read-only “Provider values: k/n Offers” chip here, C1) · disabled toggle · `aria_label` · selected/hover state roles · image fit (`cover|contain`) · columns d/t/m · mobile behavior · click behavior note bound to Section continue mode.
- **Dropdown / searchable dropdown:** choices w/ bulk paste (one per line `label = value`) · placeholder · default · searchable toggle (switches type) · Other-group (existing `choiceDisplay`).
- **Inputs (text/number/currency/email/phone/date/ZIP/address):** label · placeholder · icon (curated set) · required · min/max/format where typed · error message override · mapping chip · Maps config for ZIP/address (existing §8.8 UI).
- **Range / currency range:** min/max/step · display format · default · fill role · labels · provider output format (via mapping transform).
- **Local affordances:** helper text, reassurance badge (icon+text), secure badge, legal note, local media (media picker + alt), success state.

## 5.6 Activity / Vertical / Available Offers

Unchanged from v2.4 08 §8.2 (dropdowns fed by Offer-derived endpoints, explicit “+ New …” confirm, empty-state with fix links). Re-affirmed as binding here because mapping depth (`12`) depends on it.

## 5.7 Save path

`PATCH /sections/:id` body unchanged plus: `content_json` may now carry `bind` fields; server re-validates (`03 §3.4`), rebuilds derived indexes (existing behavior), persists `content_html` via the shared renderer WITH `sectionCtx`. Save returns `problems[]` (warnings incl. `frame_scope_component`).
