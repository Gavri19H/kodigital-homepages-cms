# 06 · Payload Builder UX Contract (Phase 2 · B1–B12, C1, M2, B8-UI; R3/B3 UI halves)

**Problem:** the v2.3.7 contract promised “the most comfortable JSON creation UX possible for non-developers … visual field tree … no raw JSON required” (04 §11.1); the shipped editor is raw-JSON one-liners over a **complete and correct** model/runtime. This section specifies the visual editor exactly. Server model, storage enums (`answer|static|computed|macro|placement|token`), resolution order, and validation shapes are UNCHANGED — this is UI + a few additive handler affordances. Primary file: `admin/leadgen/ui-payload-builder.ts` (rebuilt); handlers: `payload-builder-handlers.ts`, `offers-handlers.ts` (no route changes; additive response fields only).

## 6.1 Shell — three panes

- **Left — Payload tree.** Every field as a tree node (`{icon by type} {label} {path-tail} {badges: required·mapped·error}`); nested objects/arrays expand/collapse. Toolbar: Add field · Add object · Add array · Search path (filters tree, highlights matches). Node row actions: duplicate, move up/down (drag optional), delete (confirm when node has children), collapse/expand. **Operators never type dotted paths in normal mode** — paths derive from tree position + field name; renaming a field rewrites descendants’ paths atomically (with a mapped-fields impact warning listing affected Section mappings).
- **Center — Field editor** for the selected node: name, label, type (`string · number · boolean · date · object · array`), source group (§6.2), then the per-type/per-source panels of §§6.3–6.10, required toggle, notes.
- **Right — always-visible column:** live JSON preview (read-only, pretty, current node highlighted), validation summary (§6.11 panel, compact), generated sample payload (from §6.12 generator), last Test status chip (`untested · passed <ts> · failed <ts>` with link to Test tab).
- **Advanced drawer** (per-field + schema-level): raw JSON for value_map/transform/conditional/schema — the ONLY place raw JSON exists. Gated behind an explicit “Advanced raw JSON” disclosure; edits round-trip into the visual editors; a raw edit the visual editor can’t represent flags the field “advanced-managed”.

## 6.2 Field source UX (grouped; storage enums unchanged)

Source picker = grouped list with plain names; selecting a group member sets `{source, macro|computed|…}` underneath:

| UI group | Members (→ storage) |
|---|---|
| **User answer** | Section/internal field picker (→ `source:"answer"`, `internal_field`) — searchable, grouped by Section, shows answer type + choice count |
| **Static value** | type-aware input: text / number / boolean toggle / date picker (→ `source:"static"`, `static_value`) |
| **Request / Cloudflare** | IP address·ip, User agent·ua, Referrer URL·referer, Current URL·url, Country·country, State/Region·state, City·city, Postal code·(cf postalCode via context; macro `city`/`state` siblings), Timezone·computed `timezone`, Language·language (→ `source:"macro"`) |
| **Traffic / URL** | utm_source, utm_medium, utm_content, traffic_source, placement (traffic param), sub1–sub5, cpc, fbclid, fbc (→ `source:"macro"`) |
| **Session** | session_id, page_view_id†, funnel_attempt_id† (→ `source:"macro"`; † resolved from runtime context — exposed as macros in the projection, `04` §4.3) |
| **Offer / Auction** | offer_id, offer_name, **Placement ID** (→ `source:"placement"`, `04` §4.5), auction_instance_id† |
| **Computed** | dropdown from `COMPUTED_REGISTRY` — label + description + example per option (→ `source:"computed"`, key) |
| **Secret token** | token ref picker (existing refs only), value always masked (→ `source:"token"`) |
| **Advanced macro** | full 32-macro list with `optgroup`s (M2) — visible only in Advanced mode |

Each group member shows inline help (“IP address — the visitor’s IP at request time, e.g. 203.0.113.7”). The flat 32-option `<select>` (`ui-payload-builder.ts:127–130`) is removed from normal mode.

## 6.3 Value Map — visual table (B1)

For `source:"answer"` fields with mapped values, a table modal (and inline compact view):

Columns: **Display label** (from Section choice) · **Internal normalized value** · **Provider output value** · **Output type** (string/number/boolean) · **Main choice?** (checkbox → `choiceDisplay.mainValues`) · **Other group?** (derived: not-main when Other enabled) · **Analytics label** · **Notes**.
Actions: Add value · Add many (multiline “internal=provider” paste) · Bulk paste · **Import CSV** (columns mapped on upload) · Search/filter · Sort by column · Mark as main · Move to Other · Duplicate · Delete. Footer: unmapped-internal-values warning (values present in the Section choices but absent here → will fall to default/fallback), “miss ⇒ invalid ⇒ fallback” reminder.
Storage: existing `output_value_map` JSON — the table is a projection; raw JSON only in the Advanced drawer.

## 6.4 Large valid-value lists + “Other” grouping (B9)

Schema/field metadata (stored in the schema node; mirrored to Section `content_json` choices where the Section renders it):
```ts
choiceDisplay: { mainValues: string[]; otherGroupEnabled: boolean;
                 otherGroupLabel: string;        // default "Other"
                 searchableOther: boolean; }
```
Section rendering (runtime + preview, Phase 1 render leg): show main values as normal choices + one “Other” choice; selecting Other opens the secondary panel (searchable when `searchableOther`); choosing a secondary value stores that REAL internal value → maps to its REAL provider output. **The literal string “Other” is never sent unless a mapping row’s provider output value is actually `"Other"`.** Editor affordances: “Mark as main” up to N (soft warn > 9), drag between groups, count chips (“8 main · 112 in Other”).

## 6.5 Free-text mode (B12)

Toggle **“Free text (no fixed answer list)”** on `source:"answer"` string fields: disables the value-map table + valid_values chips (visually, with explanation); keeps required/default/fallback; adds optional max length + pattern preset (none/letters/digits/custom); runtime sanitizes (trim, strip control chars) + type-coerces to string. Compatible with FreeTextQuestion/Email/Phone/ZIP components — mapping panel shows “free text” instead of a map status.

## 6.6 Date mode (B11)

Field type `date`: display input = date picker (Section side pairs with DateQuestion); **Provider output format picker:** `YYYY-MM-DD` · `MM/DD/YYYY` · `DD/MM/YYYY` · `ISO-8601` · `Unix timestamp` · `Custom format` (token help: YYYY MM DD HH mm ss). Emits the existing `formatDate` transform (UTC tokens, `payload.ts:521–534`) — no transform JSON typed. Panel shows: test sample date input + live “input → output” preview + validation preview (invalid date → fallback path).

## 6.7 Boolean output presets (B10)

For boolean-source fields, preset select emitting the value_map/`mapBoolean` transform: `true / false` (boolean) · `"1" / "0"` (string) · `1 / 0` (number) · `"Y" / "N"` · `"yes" / "no"` · **Custom** (two type-aware inputs). Preview chips show both outputs.

## 6.8 Object / array fields (B2 — runtime already correct)

**Type=object:** child-field builder (nested arbitrarily); per-child required/optional; “Preview generated JSON” for the subtree. **Type=array:** item type picker (string/number/boolean/date/object); item schema editor (object items get the full child builder); array **source**: Static list (chip editor) · Multi-select answer (MultiChoiceCardGroup field) · Repeated answer group (e.g. driver_1_*/driver_2_* collection) · Computed · Split string (source field + delimiter). Supports arrays of primitives and arrays of objects. Tree shows `items[]` as a child node. Storage stays the existing dotted-path model with numeric segments (`payload.ts:695–729`) — the UI hides path mechanics entirely.

## 6.9 Default / fallback builder (B1 cluster)

Two visual controls per field, input type ALWAYS matching field type:
- **Default when absent:** Disabled · Static value · Computed value (registry dropdown) · Copied from another field (tree picker).
- **Fallback when invalid:** same four options.
Kills the looseJson string-vs-JSON ambiguity: the UI writes typed values; legacy loose values are displayed with a normalize prompt.

## 6.10 Conditional builder (B1 cluster)

Visual IF/THEN rows over the EXISTING evaluator (`payload.ts:620–657` — ops `eq/neq/gt/lt/gte/lte/range/in/not_in`):
- Field dropdown: known internal fields (from linked Sections) + payload fields.
- Operator dropdown with human labels: `=` eq · `≠` neq · `>` gt · `<` lt · `≥` gte · `≤` lte · `between` range · `in list` in · `not in list` not_in · `is empty` / `is not empty` (sugar over eq/neq empty) · `contains` / `does not contain` **only if** the evaluator gains them — v2.4 does NOT extend the evaluator; unsupported operators are omitted from the dropdown (never disabled-but-visible).
- Value input typed by the field (dropdown for enums, toggle for booleans, two inputs for between, chips for lists).
- **AND rows** supported (evaluator supports conjunction); **OR groups** only if the current evaluator supports them — it does not ⇒ omitted, with help text “need OR? create a second field with its own condition”.
- Live preview sentence: *“Show this field when homeowner = true and state in [CA, TX].”*

## 6.11 Validation UX (B6)

Top summary: **“Schema has 5 issues.”** (live count; green check when clean). Error list rows: field path (pretty) · field label · issue code · human message · fix hint · **Jump** button. Jump: expands collapsed ancestors, scrolls the tree + center editor to the field, applies a highlight pulse, shows the inline error badge on the node and the offending control. Inline: per-node red badge + per-control message. Server shape (`schema_errors[{code,path,message}]`, `payload.ts:144–154`) is already sufficient — client adds label resolution + hints. **Save and Test are blocked while P0/P1-class schema errors exist** (blocking codes list documented in the panel footer).

## 6.12 Test tool (C1 = B4 + B5 + B7 + placement/env pickers)

Normal **Test** tab requires no raw JSON:
1. **Generated sample-answer form** from the ACTIVE schema + mappings: every required answer-source field present; enums → dropdown (first value preselected); booleans → the §6.7 preset pair; dates → date input (sample = today−30y for DOB-like, today otherwise); free text → placeholder-filled input; ZIP/address → test presets (e.g. `90210`, sample street). Regenerate button; edits persist per Offer (draft KV).
2. **Simulated runtime context panel** (B5): country/state/city/postal/timezone/ip/ua/url/referer/language + traffic params — defaulted to a realistic US profile; collapsed by default; values feed the SAME `buildLeadgenRuntimeContext` with `overrides` (`04` §4.7.2).
3. **Placement picker** (B3): visible whenever the Offer has >1 placement; defaults to the `is_default` placement; the used placement id is echoed in the result.
4. **Environment select:** staging / production (existing enum) with production requiring an explicit confirm.
5. **Pre-test validation gate** (B7): invalid schema → the §6.11 panel inline, typed 400, no provider call.
6. Result view unchanged (masked headers/tokens, response_field_paths chips, sample_response_json persisted on 2xx only) + now shows: resolved macro/computed values used (redacted), placement id, environment.
7. **Advanced:** raw JSON answers editor (round-trips with the form).

## 6.13 Tests (definitions in `11` §11.3)

Vitest: value-map projection round-trip (table ⇄ output_value_map); Other grouping (main/secondary storage + never-literal-Other rule); each boolean preset output; each date format incl. custom tokens + invalid-date→fallback; object child add/rename path rewrite; array item schemas per source type; condition builder emits evaluator-exact JSON for every supported op; default/fallback typed emission (+ looseJson normalization); macro grouping mapping (UI label → storage enum); computed dropdown = registry keys only; placement source emission; validation code→hint mapping. Playwright (Group 5): author a nested provider payload (object + array of objects + value map with main/Other + date + boolean + condition + default/fallback) with **zero raw JSON typed**; 5-error schema shows “Schema has 5 issues”, Jump focuses the exact field; Test tab auto-generates the form, context/placement/env pickers work, Test runs and renders masked results without touching JSON; Advanced drawer round-trips.

## 6.14 Acceptance

A non-technical operator: creates a nested schema visually; builds a value map with 8 main + 100 Other carriers via CSV import; configures date/boolean/free-text fields via pickers; sets conditions/defaults/fallbacks visually; sees “Schema has N issues” with click-to-focus; runs a passing Test from the generated form with simulated context + chosen placement + environment — **never typing JSON**. Raw JSON exists only behind Advanced. Storage formats unchanged (existing schemas load and re-save byte-equivalent when untouched).
