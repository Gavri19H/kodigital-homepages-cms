// LeadGen Section question/answer builder UI (contract 05 §13 builder + §14.8
// inspector controls + §14.9 preview + §12.4/§12.11 mapping grid). Server-
// renders the editor's LEFT canvas (add/reorder components from the capability
// catalog), the RIGHT inspector (curated §14.8 style tokens + the answer→Offer
// mapping grid), the Desktop/Mobile preview toggle, and the states simulator
// (default/selected/error/dependency/validation_success/validation_error —
// every sim SERVER-rendered via the §9.2 preview params, never a cosmetic
// outer-iframe attribute). All interaction is a single strict-ES5
// inline script (the layout.ts constraint the listicles pages hold too —
// asserted by the ES5 parse test). Every author value is escapeHtml-escaped;
// author content never flows into a style attribute (§14.10). The preview
// renders into a SANDBOXED iframe via srcdoc (the listicles preview pattern —
// never innerHTML).

import { escapeHtml } from "../templates/layout";
import { COMPONENT_CATALOG, type ComponentType } from "../../public/leadgen/components/registry";
import { CURATED_DESIGN_OVERRIDE_KEYS } from "../../public/leadgen/components/content-schema";
import { FUNNEL_DESIGNS } from "../../public/leadgen/designs/registry";

// ---------------------------------------------------------------------------
// Component capability palette (§13.1) — grouped by catalog category
// ---------------------------------------------------------------------------

type CatalogCategory = "chrome" | "affordance" | "question" | "control" | "layout";

const CATEGORY_LABELS: Record<CatalogCategory, string> = {
  question: "Questions",
  affordance: "Copy & affordances",
  control: "Controls",
  chrome: "Funnel chrome",
  // §8.5 layout containers + layout leaves (E4).
  layout: "Layout",
};

// A readable label from the PascalCase catalog type (no banned tokens — the
// catalog keys are the lineage-safe names).
function humanizeType(type: string): string {
  return type.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

interface PaletteEntry {
  type: ComponentType;
  category: CatalogCategory;
  produces: string;
}

function paletteEntries(): PaletteEntry[] {
  return (Object.keys(COMPONENT_CATALOG) as ComponentType[]).map((type) => {
    const entry = COMPONENT_CATALOG[type];
    return {
      type,
      category: entry.category as CatalogCategory,
      produces: entry.produces === null ? "—" : String(entry.produces),
    };
  });
}

// The palette: one "add" button per catalog type, grouped by category. The
// canvas script appends the matching node on click (add-component, §13).
export function renderComponentPalette(): string {
  const groups: CatalogCategory[] = ["question", "layout", "affordance", "control", "chrome"];
  const sections = groups
    .map((cat) => {
      const items = paletteEntries()
        .filter((e) => e.category === cat)
        .map(
          (e) =>
            `<button type="button" class="lg-palette-item" data-add-component="${escapeHtml(e.type)}" title="produces: ${escapeHtml(e.produces)}">` +
            `<span class="lg-palette-type">${escapeHtml(humanizeType(e.type))}</span>` +
            `<span class="lg-palette-produces">${escapeHtml(e.produces)}</span>` +
            `</button>`,
        )
        .join("");
      return `<div class="lg-palette-group"><h4 class="lg-palette-heading">${escapeHtml(CATEGORY_LABELS[cat])}</h4><div class="lg-palette-items">${items}</div></div>`;
    })
    .join("");
  return `<div class="lg-palette" aria-label="Component capability catalog">${sections}</div>`;
}

// ---------------------------------------------------------------------------
// Palette-add seed templates (§13) — the authorable-field skeleton a freshly
// added component carries so the inspector can complete it toward validity.
// Derived from the components/registry.ts COMPONENT_CATALOG `props` contract:
// an `internal_field` / `required` / `choices…` prop becomes an editable node
// field, and `answer_type` is seeded from the catalog `produces`. Serialized
// into a JSON blob the ES5 builder reads on palette click (never a live look-up
// of the catalog on the client).
// ---------------------------------------------------------------------------

function seedTemplateForType(type: ComponentType): Record<string, unknown> {
  const entry = COMPONENT_CATALOG[type];
  const props = entry.props as readonly string[];
  const seed: Record<string, unknown> = {};
  let hasChoices = false;
  for (const prop of props) {
    if (prop === "internal_field") seed["internal_field"] = "";
    else if (prop === "required") seed["required"] = false;
    else if (prop.indexOf("choices") === 0) hasChoices = true;
  }
  if (hasChoices) seed["choices"] = [];
  if (entry.produces !== null) seed["answer_type"] = entry.produces;
  return seed;
}

export function componentSeedTemplates(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const type of Object.keys(COMPONENT_CATALOG) as ComponentType[]) {
    out[type] = seedTemplateForType(type);
  }
  return out;
}

// The #lg-component-seeds JSON blob. `<`-escaped so it can never break out of
// the <script type="application/json"> element (the #lg-section-data pattern).
export function renderComponentSeedData(): string {
  return `<script type="application/json" id="lg-component-seeds">${JSON.stringify(componentSeedTemplates()).replace(/</g, "\\u003c")}</script>`;
}

// ---------------------------------------------------------------------------
// Builder canvas (LEFT) — the ordered component list (§13, add/reorder)
// ---------------------------------------------------------------------------

interface CanvasNode {
  type: string;
  question_id: string;
  question_key: string | null;
  internal_field: string | null;
  answer_type: string | null;
}

function canvasNodesOf(content: unknown): CanvasNode[] {
  if (typeof content !== "object" || content === null) return [];
  const components = (content as { components?: unknown }).components;
  if (!Array.isArray(components)) return [];
  const out: CanvasNode[] = [];
  for (const node of components) {
    if (typeof node !== "object" || node === null) continue;
    const n = node as Record<string, unknown>;
    if (typeof n["type"] !== "string" || typeof n["question_id"] !== "string") continue;
    out.push({
      type: n["type"],
      question_id: n["question_id"],
      question_key: typeof n["question_key"] === "string" ? n["question_key"] : null,
      internal_field: typeof n["internal_field"] === "string" ? n["internal_field"] : null,
      answer_type: typeof n["answer_type"] === "string" ? n["answer_type"] : null,
    });
  }
  return out;
}

function renderCanvasCard(node: CanvasNode): string {
  const meta = [node.internal_field ? `field: ${node.internal_field}` : "", node.answer_type ? `type: ${node.answer_type}` : ""]
    .filter((s) => s !== "")
    .join(" · ");
  return `<li class="lg-canvas-card" draggable="true" data-question-id="${escapeHtml(node.question_id)}" data-component-type="${escapeHtml(node.type)}" tabindex="0">
  <div class="lg-canvas-card-head">
    <span class="lg-canvas-type">${escapeHtml(humanizeType(node.type))}</span>
    <span class="lg-canvas-key">${escapeHtml(node.question_key ?? node.question_id)}</span>
  </div>
  <div class="lg-canvas-meta">${escapeHtml(meta)}</div>
  <div class="lg-canvas-actions">
    <button type="button" class="btn btn-sm btn-outline" data-canvas-up aria-label="Move up">&#8593;</button>
    <button type="button" class="btn btn-sm btn-outline" data-canvas-down aria-label="Move down">&#8595;</button>
    <button type="button" class="btn btn-sm btn-outline" data-canvas-select>Inspect</button>
    <button type="button" class="btn btn-sm btn-danger" data-canvas-remove aria-label="Remove component">Remove</button>
  </div>
</li>`;
}

// The LEFT canvas: the ordered component list + the empty state. The builder
// script maintains the authoritative content model in a JSON state blob.
export function renderBuilderCanvas(content: unknown): string {
  const nodes = canvasNodesOf(content);
  const cards = nodes.map(renderCanvasCard).join("");
  const empty = `<li class="lg-canvas-empty"><p>No components yet.</p><p class="form-help">Add a component from the catalog on the left.</p></li>`;
  return `<div class="lg-canvas" data-lg-canvas>
  <div class="lg-canvas-head"><h3 class="card-title">Question / answer builder</h3></div>
  <ol class="lg-canvas-list" id="lg-canvas-list" aria-label="Section components">${cards === "" ? empty : cards}</ol>
</div>`;
}

// ---------------------------------------------------------------------------
// Inspector (RIGHT) — §14.8 curated style tokens + §12.4/§12.11 mapping grid
// ---------------------------------------------------------------------------

// The §14.8 tokenized style controls. Every override key is one of the curated
// set (content-schema CURATED_DESIGN_OVERRIDE_KEYS) — never free CSS.
const INSPECTOR_TOKEN_CONTROLS: ReadonlyArray<{ key: string; label: string; kind: "text" | "number" }> = [
  { key: "iconColor", label: "Icon color token", kind: "text" },
  { key: "columns", label: "Card columns (2–5)", kind: "number" },
  { key: "featureColor", label: "Feature color token", kind: "text" },
  { key: "rangeColor", label: "Range fill token", kind: "text" },
  { key: "buttonBackground", label: "Button background token", kind: "text" },
  { key: "buttonText", label: "Button text token", kind: "text" },
  { key: "gridGap", label: "Answer-grid gap token", kind: "text" },
  { key: "mobileBehavior", label: "Mobile behavior", kind: "text" },
];

function renderInspectorTokens(): string {
  // Only the curated keys reach the inspector (§14.8 "unknown keys rejected";
  // §14.10 no-arbitrary-CSS): the fixed list is filtered against the imported
  // curated set so an accidental non-curated key can never render a control.
  const curated: ReadonlySet<string> = new Set(CURATED_DESIGN_OVERRIDE_KEYS);
  const controls = INSPECTOR_TOKEN_CONTROLS.filter((c) => curated.has(c.key))
    .map(
      (c) =>
        `<div class="form-group lg-inspector-field">
      <label class="form-label" for="lg-inspector-${escapeHtml(c.key)}">${escapeHtml(c.label)}</label>
      <input id="lg-inspector-${escapeHtml(c.key)}" class="form-input" type="${c.kind === "number" ? "number" : "text"}" data-inspector-override="${escapeHtml(c.key)}" />
    </div>`,
    )
    .join("");
  return `<div class="lg-inspector-section" data-inspector-tokens>
  <h4 class="lg-inspector-heading">Style tokens (§14.8 — curated, no arbitrary CSS)</h4>
  <div class="form-group lg-inspector-field">
    <label class="form-label" for="lg-inspector-preset">Component style preset</label>
    <input id="lg-inspector-preset" class="form-input" type="text" data-inspector-field="design_preset" placeholder="preset name" />
  </div>
  <div class="form-group lg-inspector-field">
    <label class="form-label" for="lg-inspector-icon">Icon selector</label>
    <input id="lg-inspector-icon" class="form-input" type="text" data-inspector-field="icon" placeholder="icon id / glyph" />
  </div>
  ${controls}
  <div class="form-group lg-inspector-field">
    <label class="lg-check"><input type="checkbox" data-inspector-field="badge_enabled" /> Reassurance badge enabled</label>
    <input class="form-input" type="text" data-inspector-field="badge_text" placeholder="Badge text (§14.7)" />
  </div>
  <div class="form-group lg-inspector-field">
    <label class="form-label" for="lg-inspector-helper">Helper text</label>
    <input id="lg-inspector-helper" class="form-input" type="text" data-inspector-field="helper_text" />
  </div>
</div>`;
}

// The §13.1 answer/content authoring controls the inspector COLLECTS back into
// the selected node (internal_field / required / valid_values / a primary text
// prop / the §12.3 inline conditional / the per-choice list). These are the
// node CONTENT fields (distinct from the §14.8 style tokens above); the ES5
// builder reads each `data-inspector-field` / `data-inspector-cond` /
// `data-choice-field` back into `state.content` so collectSection serializes a
// real authored node.
const CONDITION_OP_OPTIONS: ReadonlyArray<string> = [
  "eq",
  "neq",
  "gt",
  "lt",
  "gte",
  "lte",
  "range",
  "in",
  "not_in",
];

function renderInspectorAuthoring(): string {
  const opOptions = CONDITION_OP_OPTIONS.map((op) => `<option value="${escapeHtml(op)}">${escapeHtml(op)}</option>`).join("");
  return `<div class="lg-inspector-section" data-inspector-authoring>
  <h4 class="lg-inspector-heading">Answer / content (§13.1)</h4>
  <div class="form-group lg-inspector-field">
    <label class="form-label" for="lg-inspector-internal-field">Internal field (normalized answer name)</label>
    <input id="lg-inspector-internal-field" class="form-input" type="text" data-inspector-field="internal_field" placeholder="e.g. currently_insured" />
  </div>
  <div class="form-group lg-inspector-field">
    <label class="lg-check"><input type="checkbox" data-inspector-field="required" /> Required</label>
  </div>
  <div class="form-group lg-inspector-field">
    <label class="form-label" for="lg-inspector-text">Primary text / content</label>
    <input id="lg-inspector-text" class="form-input" type="text" data-inspector-field="text" placeholder="headline / label / copy" />
  </div>
  <div class="form-group lg-inspector-field">
    <label class="form-label" for="lg-inspector-valid-values">Valid values (comma-separated)</label>
    <input id="lg-inspector-valid-values" class="form-input" type="text" data-inspector-field="valid_values" placeholder="e.g. yes, no, maybe" />
  </div>
  <fieldset class="form-group lg-inspector-field lg-inspector-conditional">
    <legend class="form-label">Inline dependency (§12.3)</legend>
    <input class="form-input" type="text" data-inspector-cond="when" placeholder="show when field…" />
    <select class="form-input" data-inspector-cond="op" aria-label="Condition operator">${opOptions}</select>
    <input class="form-input" type="text" data-inspector-cond="value" placeholder="equals value" />
  </fieldset>
  <div class="form-group lg-inspector-field">
    <label class="form-label">Choices (§13.1 per-choice label / value / analytics_id / icon / description)</label>
    <div class="lg-choice-list" data-inspector-choices></div>
    <button type="button" class="btn btn-sm btn-secondary" id="lg-choice-add">+ Add choice</button>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Mapping grid (§12.4 columns + §12.11 field-level states)
// ---------------------------------------------------------------------------

const MAPPING_COLUMNS: ReadonlyArray<string> = [
  "Question",
  "Internal field",
  "Mapped Offer",
  "Offer field path",
  "Expected type",
  "Valid values",
  "Value transform",
  "Required",
  "Completeness",
  "Test payload",
];

interface AnswerMapView {
  question_id: string;
  question_key: string;
  internal_field: string;
  // The normalized answer_type (§12.7) — drives the §12.11 type_mismatch text
  // ("answer type X not coercible to Y").
  answer_type: string;
  offer_id: number;
  offer_payload_field_path: string;
  provider_expected_type: string;
  // §8.5 API names (parsed JSON columns), matching the B1 read/write vocabulary.
  output_value_map: unknown;
  value_transform: unknown;
  required_for_offer: boolean;
  default_value: string | null;
  fallback_value: string | null;
  mapping_status: string;
  // The pinned versioned schema's public_id (`lgp_…`) — named in the §12.11
  // `orphaned` cell copy ("…no longer exists in schema <id>").
  payload_schema_public_id?: string;
}

// The §12.11 semantic four-state, derived 1:1 from the DDL-storable
// mapping_status column. The DB stores `incomplete` for §12.11 `missing_required`
// (sections.ts toMappingStatusColumn maps missing_required→incomplete), so
// `incomplete` decodes back to `missing_required`; the other three are identical.
type CompletenessCellState = "ok" | "missing_required" | "type_mismatch" | "orphaned";

function completenessStateOf(mappingStatus: string): CompletenessCellState {
  switch (mappingStatus) {
    case "complete":
      return "ok";
    case "type_mismatch":
      return "type_mismatch";
    case "orphaned":
      return "orphaned";
    default:
      return "missing_required"; // "incomplete"
  }
}

// §12.11 field-level error UI states (mapping grid). Each cell shows one of:
//   ok               → green check
//   missing_required → red "map required field"
//   type_mismatch    → amber "answer type X not coercible to Y"
//   orphaned         → gray "Offer field no longer exists in schema <version>"
// The `data-mapping-status` (DB value) attribute is preserved for back-compat;
// `data-mapping-cell` carries the §12.11 semantic state so tests + CSS target it.
function completenessCell(m: AnswerMapView): string {
  const state = completenessStateOf(m.mapping_status);
  // §12.11 names the schema "vN"; the answer-map row pins the versioned
  // schema's stable public_id (lgp_…), which uniquely identifies that version.
  const schemaRef = m.payload_schema_public_id ? ` ${m.payload_schema_public_id}` : "";
  const cells: Record<CompletenessCellState, { cls: string; text: string; prefix: string }> = {
    ok: { cls: "lg-cell lg-cell-ok badge badge-published", text: "ok", prefix: "&#10003; " },
    missing_required: { cls: "lg-cell lg-cell-missing badge badge-scheduled", text: "map required field", prefix: "" },
    type_mismatch: {
      cls: "lg-cell lg-cell-mismatch badge badge-draft",
      text: `answer type ${m.answer_type === "" ? "?" : m.answer_type} not coercible to ${m.provider_expected_type}`,
      prefix: "",
    },
    orphaned: { cls: "lg-cell lg-cell-orphaned badge badge-archived", text: `Offer field no longer exists in schema${schemaRef}`, prefix: "" },
  };
  const chosen = cells[state];
  return `<span class="${chosen.cls}" data-mapping-status="${escapeHtml(m.mapping_status)}" data-mapping-cell="${state}" title="${escapeHtml(chosen.text)}">${chosen.prefix}${escapeHtml(chosen.text)}</span>`;
}

function transformSummary(transformJson: unknown): string {
  if (!Array.isArray(transformJson)) return "—";
  const kinds = transformJson
    .map((s) => (typeof s === "object" && s !== null ? String((s as { kind?: unknown }).kind ?? "") : ""))
    .filter((k) => k !== "");
  return kinds.length > 0 ? kinds.join(" → ") : "—";
}

function valueMapSummary(mapJson: unknown): string {
  if (typeof mapJson !== "object" || mapJson === null) return "—";
  const keys = Object.keys(mapJson as Record<string, unknown>);
  return keys.length > 0 ? keys.map((k) => `${k}→${String((mapJson as Record<string, unknown>)[k])}`).join(", ") : "—";
}

function renderMappingRow(m: AnswerMapView, offerLabelById: ReadonlyMap<number, string>): string {
  const offerLabel = offerLabelById.get(m.offer_id) ?? `#${m.offer_id}`;
  return `<tr data-mapping-offer="${m.offer_id}" data-mapping-field="${escapeHtml(m.offer_payload_field_path)}">
  <td>${escapeHtml(m.question_key)}</td>
  <td><code>${escapeHtml(m.internal_field)}</code></td>
  <td>${escapeHtml(offerLabel)}</td>
  <td><code>${escapeHtml(m.offer_payload_field_path)}</code></td>
  <td>${escapeHtml(m.provider_expected_type)}</td>
  <td>${escapeHtml(valueMapSummary(m.output_value_map))}</td>
  <td>${escapeHtml(transformSummary(m.value_transform))}</td>
  <td>${m.required_for_offer ? "required" : "optional"}</td>
  <td>${completenessCell(m)}</td>
  <td><button type="button" class="btn btn-sm btn-outline" data-mapping-test aria-label="Test generated payload">Test</button></td>
</tr>`;
}

// §12.11 / §35: the section-level publish verdict + "N required mappings
// missing" summary. Derived (in ui-sections) from the persisted
// leadgen_section_available_offers rows — the SAME derived truth
// sectionValidationStatus consumes (publishable ⇔ no invalid Offer AND every
// provider-required field mapped).
interface MappingSummary {
  publishable: boolean;
  status: "ok" | "error";
  required_missing_total: number;
}

// The publish-gate badge + missing-required count (§12.11 "a Section with any
// error row cannot be included in a published Quote").
function renderMappingSummary(summary: MappingSummary): string {
  const badge = summary.publishable
    ? `<span class="badge badge-published" data-publishable="true">Publishable</span>`
    : `<span class="badge badge-archived" data-publishable="false">Blocked from publish (§12.11)</span>`;
  const missing =
    summary.required_missing_total > 0
      ? `<span class="lg-mapping-missing" data-required-missing="${summary.required_missing_total}">${summary.required_missing_total} required mapping${summary.required_missing_total === 1 ? "" : "s"} missing</span>`
      : `<span class="lg-mapping-missing" data-required-missing="0">All required fields mapped</span>`;
  return `<div class="lg-mapping-summary" data-mapping-summary>${badge}${missing}</div>`;
}

export function renderMappingGrid(
  maps: ReadonlyArray<AnswerMapView>,
  offerLabelById: ReadonlyMap<number, string>,
  summary: MappingSummary,
): string {
  const headerCells = MAPPING_COLUMNS.map((c) => `<th scope="col">${escapeHtml(c)}</th>`).join("");
  const rows =
    maps.length === 0
      ? `<tr><td colspan="${MAPPING_COLUMNS.length}"><div class="empty-state"><p>No answer→Offer mappings yet.</p><p class="form-help">Pick an Offer and map a question to a payload field (§12.4).</p></div></td></tr>`
      : maps.map((m) => renderMappingRow(m, offerLabelById)).join("");
  return `<div class="lg-inspector-section" data-inspector-mapping>
  <h4 class="lg-inspector-heading">Answer → Offer mapping (§12.4 / §12.11)</h4>
  ${renderMappingSummary(summary)}
  <div class="table-wrapper">
    <table class="table lg-mapping-grid" id="lg-mapping-grid" aria-label="Answer to Offer mapping">
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <button type="button" class="btn btn-sm btn-secondary" id="lg-mapping-add">+ Add mapping</button>
  <p id="lg-mapping-error" class="alert alert-error" hidden role="alert"></p>
  <pre id="lg-mapping-test-result" class="lg-mapping-test-result" hidden aria-live="polite"></pre>
</div>`;
}

export function renderInspector(
  maps: ReadonlyArray<AnswerMapView>,
  offerLabelById: ReadonlyMap<number, string>,
  summary: MappingSummary,
): string {
  return `<aside class="lg-inspector" id="lg-inspector" aria-label="Component inspector">
  <div class="lg-inspector-head"><h3 class="card-title">Inspector</h3><span class="form-help" id="lg-inspector-target">Select a component</span></div>
  ${renderInspectorAuthoring()}
  ${renderInspectorTokens()}
  ${renderMappingGrid(maps, offerLabelById, summary)}
</aside>`;
}

export type { AnswerMapView, MappingSummary };

// ---------------------------------------------------------------------------
// Desktop/Mobile preview toggle + states simulator (§14.9)
// ---------------------------------------------------------------------------

// §8.9 design picker options — one entry per DISTINCT registered design (the
// registry aliases `default` → the default design's canonical id). Value ""
// = omit design_id (the server resolves its default, §14.1).
function designPickerOptions(): string {
  const ids = [...new Set(Object.values(FUNNEL_DESIGNS).map((d) => d.id))];
  return ids
    .map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`)
    .join("");
}

export function renderPreviewToggle(): string {
  return `<div class="lg-preview-controls" data-lg-preview-controls>
  <div class="lg-viewport-toggle" role="group" aria-label="Preview viewport">
    <button type="button" class="btn btn-sm btn-secondary active" data-preview-viewport="desktop" aria-pressed="true">Desktop</button>
    <button type="button" class="btn btn-sm btn-secondary" data-preview-viewport="mobile" aria-pressed="false">Mobile</button>
    <button type="button" class="btn btn-sm btn-outline" id="lg-preview-refresh">Refresh preview</button>
    <label class="form-help" for="lg-preview-design">Design:</label>
    <select id="lg-preview-design" class="form-input lg-preview-design" data-preview-design aria-label="Preview under a funnel design (§8.9)">
      <option value="" selected>Default design</option>
      ${designPickerOptions()}
    </select>
  </div>
  <div class="lg-states-simulator" role="group" aria-label="State simulator (§14.9)">
    <span class="form-help">Simulate state:</span>
    <button type="button" class="btn btn-sm btn-outline active" data-sim-state="default" aria-pressed="true">Default</button>
    <button type="button" class="btn btn-sm btn-outline" data-sim-state="selected" aria-pressed="false">Selected</button>
    <button type="button" class="btn btn-sm btn-outline" data-sim-state="error" aria-pressed="false">Error</button>
    <button type="button" class="btn btn-sm btn-outline" data-sim-state="dependency" aria-pressed="false">Dependency</button>
    <button type="button" class="btn btn-sm btn-outline" data-sim-state="validation_success" aria-pressed="false">Validation success</button>
    <button type="button" class="btn btn-sm btn-outline" data-sim-state="validation_error" aria-pressed="false">Validation error</button>
  </div>
  <div class="lg-dependency-panel" data-dependency-panel hidden>
    <label class="form-label" for="lg-dependency-answers">Sample answers (JSON, keyed by internal field) — drives the dependency/selected/error/validation sims (§9.2)</label>
    <textarea id="lg-dependency-answers" class="form-input" data-dependency-answers rows="3" aria-label="Sample answers for the state sims" placeholder='{ "currently_insured": true }'></textarea>
    <button type="button" class="btn btn-sm btn-secondary" id="lg-dependency-apply">Apply sample answers</button>
    <p class="lg-dependency-status" data-dependency-status role="status" aria-live="polite"></p>
  </div>
  <p id="lg-preview-error" class="alert alert-error" hidden role="alert"></p>
  <iframe id="lg-preview-frame" class="lg-preview-frame" title="Section preview" sandbox=""></iframe>
</div>`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

export const QUESTION_BUILDER_STYLES = `
.lg-editor-grid{display:grid;grid-template-columns:240px 1fr 380px;gap:16px;align-items:start}
@media (max-width:1023px){.lg-editor-grid{grid-template-columns:1fr}}
.lg-palette-group{margin-bottom:16px}
.lg-palette-heading{font-size:12px;text-transform:uppercase;letter-spacing:1px;color:var(--c-muted);margin:0 0 6px}
.lg-palette-items{display:flex;flex-direction:column;gap:4px}
.lg-palette-item{display:flex;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--c-border);border-radius:6px;background:var(--c-surface);cursor:pointer;text-align:left}
.lg-palette-item:hover{border-color:var(--c-primary)}
.lg-palette-produces{color:var(--c-muted);font-size:11px;font-variant-numeric:tabular-nums}
.lg-canvas-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.lg-canvas-card{border:1px solid var(--c-border);border-radius:8px;padding:10px;background:var(--c-surface)}
.lg-canvas-card[data-selected="true"]{border-color:var(--c-primary);box-shadow:0 0 0 2px rgba(27,58,92,.15)}
.lg-canvas-card-head{display:flex;justify-content:space-between;gap:8px;font-weight:600}
.lg-canvas-key{color:var(--c-muted);font-weight:400}
.lg-canvas-meta{color:var(--c-muted);font-size:12px;margin:4px 0}
.lg-canvas-actions{display:flex;gap:4px;flex-wrap:wrap}
.lg-inspector-heading{font-size:13px;margin:0 0 8px}
.lg-inspector-section{border-top:1px solid var(--c-border);padding-top:12px;margin-top:12px}
.lg-mapping-grid td,.lg-mapping-grid th{font-size:12px;vertical-align:top}
.lg-preview-frame{border:1px solid var(--c-border);border-radius:8px;width:100%;min-height:360px;margin-top:8px;background:#fff}
/* §9.2: mobile sizing is server-driven — the srcdoc wrapper (lg-preview-mobile)
   carries the design's mobile max-width; this plain class only narrows the
   iframe ELEMENT so in-document media queries evaluate at a real 375px, and it
   is applied by the island on re-render (never a cosmetic attribute hack). */
.lg-preview-frame-mobile{max-width:375px}
.lg-viewport-toggle,.lg-states-simulator{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.lg-preview-design{width:auto;font-size:12px;padding:4px 6px}
.lg-check{display:flex;align-items:center;gap:6px}
.lg-choice-list{display:flex;flex-direction:column;gap:4px;margin-bottom:6px}
.lg-choice-row{display:flex;gap:4px;flex-wrap:wrap;align-items:center}
.lg-choice-row .form-input{flex:1 1 90px;min-width:0}
.lg-inspector-conditional{display:flex;gap:4px;flex-wrap:wrap;border:0;padding:0;margin:0}
.lg-mapping-grid .form-input{font-size:11px;padding:4px 6px;min-width:70px}
.lg-mapping-test-result{background:var(--c-surface);border:1px solid var(--c-border);border-radius:6px;padding:8px;font-size:11px;overflow:auto;max-height:220px;white-space:pre-wrap;margin-top:8px}
/* §12.11 field-level cell colors — green ok / red missing / amber mismatch / gray orphaned. */
.lg-cell{font-size:11px}
.lg-cell-ok{color:#0f5132;background:#d1e7dd;border-color:#badbcc}
.lg-cell-missing{color:#842029;background:#f8d7da;border-color:#f5c2c7}
.lg-cell-mismatch{color:#664d03;background:#fff3cd;border-color:#ffecb5}
.lg-cell-orphaned{color:#41464b;background:#e2e3e5;border-color:#d3d6d8}
.lg-mapping-summary{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 8px}
.lg-mapping-missing{font-size:12px;color:var(--c-muted)}
.lg-dependency-panel{border:1px dashed var(--c-border);border-radius:6px;padding:8px;margin-bottom:8px}
.lg-dependency-panel textarea{width:100%;font-family:var(--font-mono,monospace);font-size:12px;margin-bottom:6px}
.lg-dependency-status{font-size:12px;margin:6px 0 0}
.lg-dependency-status[data-continue-blocked="true"]{color:#842029}
`;

// ---------------------------------------------------------------------------
// The strict-ES5 builder script (add/reorder/select/preview/states/maps)
// ---------------------------------------------------------------------------

// One IIFE. No arrow/const/let/async/await/backtick (layout.ts ES5 constraint,
// asserted by the parse test). It owns the authoritative content model in a
// state object seeded from the #lg-section-data JSON blob, wires the palette
// (add), the canvas (reorder/remove/select), the inspector, the Desktop/Mobile
// preview (POST /sections/preview → a SANDBOXED iframe srcdoc, never
// innerHTML), the states simulator, the Google-Maps toggle, Save (POST/PATCH),
// the §9.6 unsaved-changes guard + archive confirm.
export const QUESTION_BUILDER_SCRIPT = `
(function () {
  var dataEl = document.getElementById('lg-section-data');
  if (!dataEl) { return; }
  var state;
  try { state = JSON.parse(dataEl.textContent || '{}'); } catch (e) { state = {}; }
  if (!state.content || !state.content.components) { state.content = { components: [] }; }
  if (!state.answer_maps) { state.answer_maps = []; }

  // Catalog-derived seed templates (the authorable-field skeleton per type).
  var componentSeeds = {};
  var seedEl = document.getElementById('lg-component-seeds');
  if (seedEl) { try { componentSeeds = JSON.parse(seedEl.textContent || '{}'); } catch (e2) { componentSeeds = {}; } }

  var selectedQuestionId = null;
  var PROVIDER_TYPES = ['string', 'number', 'boolean', 'enum', 'object', 'array'];
  var dirty = false;
  function markDirty() { dirty = true; }

  function cloneJson(v) { try { return JSON.parse(JSON.stringify(v)); } catch (e) { return {}; } }
  function trimStr(s) { if (s === undefined || s === null) { return ''; } return String(s).trim(); }

  function newQuestionId() {
    return 'q_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
  }

  // --- palette: add a component from the capability catalog (§13) -----------
  var palette = document.querySelectorAll('[data-add-component]');
  var pi;
  for (pi = 0; pi < palette.length; pi++) {
    palette[pi].addEventListener('click', function () {
      var type = this.getAttribute('data-add-component');
      // Seed the new node with the catalog-required authorable fields so the
      // inspector can complete it toward validity (internal_field / choices /
      // required / answer_type).
      var seed = componentSeeds[type];
      var node = seed ? cloneJson(seed) : {};
      node.type = type;
      node.question_id = newQuestionId();
      state.content.components.push(node);
      markDirty();
      renderCanvas();
      selectComponent(node.question_id);
    });
  }

  function moveComponent(index, delta) {
    var target = index + delta;
    if (target < 0 || target >= state.content.components.length) { return; }
    var tmp = state.content.components[index];
    state.content.components[index] = state.content.components[target];
    state.content.components[target] = tmp;
    markDirty();
    renderCanvas();
  }

  function findIndex(questionId) {
    var i;
    for (i = 0; i < state.content.components.length; i++) {
      if (state.content.components[i].question_id === questionId) { return i; }
    }
    return -1;
  }

  function selectComponent(questionId) {
    selectedQuestionId = questionId;
    var cards = document.querySelectorAll('.lg-canvas-card');
    var i;
    for (i = 0; i < cards.length; i++) {
      cards[i].setAttribute('data-selected', cards[i].getAttribute('data-question-id') === questionId ? 'true' : 'false');
    }
    var target = document.getElementById('lg-inspector-target');
    if (target) { target.textContent = 'Editing ' + questionId; }
    populateInspector();
  }

  function selectedNode() {
    if (selectedQuestionId === null) { return null; }
    var at = findIndex(selectedQuestionId);
    return at > -1 ? state.content.components[at] : null;
  }

  function renderCanvas() {
    // Client keeps the model + a lightweight DOM sync (add/remove/reorder)
    // built entirely with createElement/textContent (never innerHTML). The
    // server re-renders authoritatively on the next load.
    var list = document.getElementById('lg-canvas-list');
    if (!list) { return; }
    while (list.firstChild) { list.removeChild(list.firstChild); }
    var i;
    for (i = 0; i < state.content.components.length; i++) {
      list.appendChild(buildCard(state.content.components[i], i));
    }
    if (state.content.components.length === 0) {
      var empty = document.createElement('li');
      empty.className = 'lg-canvas-empty';
      empty.appendChild(document.createTextNode('No components yet. Add one from the catalog.'));
      list.appendChild(empty);
    }
  }

  function buildCard(node, index) {
    var li = document.createElement('li');
    li.className = 'lg-canvas-card';
    li.setAttribute('data-question-id', node.question_id);
    li.setAttribute('data-component-type', node.type);
    li.setAttribute('tabindex', '0');
    var head = document.createElement('div');
    head.className = 'lg-canvas-card-head';
    var typeSpan = document.createElement('span');
    typeSpan.className = 'lg-canvas-type';
    typeSpan.textContent = node.type;
    head.appendChild(typeSpan);
    li.appendChild(head);
    var actions = document.createElement('div');
    actions.className = 'lg-canvas-actions';
    actions.appendChild(actionButton('Up', function () { moveComponent(index, -1); }));
    actions.appendChild(actionButton('Down', function () { moveComponent(index, 1); }));
    actions.appendChild(actionButton('Inspect', function () { selectComponent(node.question_id); }));
    actions.appendChild(actionButton('Remove', function () {
      var at = findIndex(node.question_id);
      if (at > -1) { state.content.components.splice(at, 1); markDirty(); renderCanvas(); }
    }));
    li.appendChild(actions);
    return li;
  }

  function actionButton(label, handler) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm btn-outline';
    btn.textContent = label;
    btn.addEventListener('click', handler);
    return btn;
  }

  // Wire the server-rendered canvas buttons (first paint) too.
  var canvasList = document.getElementById('lg-canvas-list');
  if (canvasList) {
    canvasList.addEventListener('click', function (ev) {
      var card = ev.target && ev.target.closest ? ev.target.closest('.lg-canvas-card') : null;
      if (!card) { return; }
      var qid = card.getAttribute('data-question-id');
      var idx = findIndex(qid);
      if (ev.target.hasAttribute('data-canvas-up')) { moveComponent(idx, -1); }
      else if (ev.target.hasAttribute('data-canvas-down')) { moveComponent(idx, 1); }
      else if (ev.target.hasAttribute('data-canvas-remove')) {
        if (idx > -1) { state.content.components.splice(idx, 1); markDirty(); renderCanvas(); }
      } else if (ev.target.hasAttribute('data-canvas-select')) { selectComponent(qid); }
    });
  }

  // --- Desktop/Mobile preview (POST /sections/preview → sandboxed iframe) ----
  var previewViewport = 'desktop';
  // §14.9 states simulator: which state the preview renders. 'dependency' drives
  // the §12.3 conditional preview (sample answers hide/show components live).
  var simState = 'default';

  // Sample answers for the §12.3 dependency preview (JSON keyed by internal
  // field). Empty / unparseable → {} (no dependency filtering).
  function sampleAnswers() {
    var el = document.getElementById('lg-dependency-answers');
    if (!el) { return {}; }
    var t = trimStr(el.value);
    if (t === '') { return {}; }
    try { var parsed = JSON.parse(t); return (parsed && typeof parsed === 'object') ? parsed : {}; } catch (e) { return {}; }
  }

  // Reflect the server's dependency verdict (visible count + continue gate)
  // into the aria-live status line.
  function renderDependencyStatus(dep) {
    var el = document.querySelector('[data-dependency-status]');
    if (!el) { return; }
    while (el.firstChild) { el.removeChild(el.firstChild); }
    if (!dep) { el.setAttribute('data-continue-blocked', 'false'); return; }
    var visible = dep.visible_question_ids || [];
    var blocking = dep.blocking_question_ids || [];
    var msg = 'Visible: ' + visible.length + ' component(s). ';
    msg = msg + (dep.continue_blocked ? ('Continue BLOCKED — required: ' + blocking.join(', ')) : 'Continue allowed.');
    el.appendChild(document.createTextNode(msg));
    el.setAttribute('data-continue-blocked', dep.continue_blocked ? 'true' : 'false');
  }

  function runPreview() {
    var frame = document.getElementById('lg-preview-frame');
    var errEl = document.getElementById('lg-preview-error');
    if (errEl) { errEl.hidden = true; }
    // §9.2 parameterized body: the viewport rides the request (the server
    // returns that viewport's markup as preview.html) and EVERY sim is
    // server-rendered — the client never paints state onto the iframe.
    var requestBody = { content_json: JSON.stringify(state.content), viewport: previewViewport, sim: { state: simState } };
    // Non-default sims are answers-driven (dependency show/hide, selected
    // choices, required-but-empty errors, validation states) — the sample-
    // answers affordance feeds sim.answers.
    if (simState !== 'default') { requestBody.sim.answers = sampleAnswers(); }
    // §8.9 design picker: empty value ⇒ omit design_id (server default).
    var designSel = document.getElementById('lg-preview-design');
    if (designSel && trimStr(designSel.value) !== '') { requestBody.design_id = trimStr(designSel.value); }
    fetch('/api/admin/leadgen/sections/preview', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(requestBody)
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      if (!res.ok || !res.body || !res.body.preview) {
        if (errEl) { errEl.hidden = false; errEl.textContent = (res.body && res.body.error) || 'Preview failed'; }
        return;
      }
      if (frame) {
        // Mobile sizing comes from the SERVER wrapper inside the srcdoc; the
        // iframe element only swaps a plain width class on re-render (§9.2 —
        // the data-viewport attribute hack is gone).
        frame.className = previewViewport === 'mobile' ? 'lg-preview-frame lg-preview-frame-mobile' : 'lg-preview-frame';
        var html = res.body.preview.html || (previewViewport === 'mobile' ? res.body.preview.mobile : res.body.preview.desktop);
        // Sandboxed srcdoc document — the listicles preview pattern, never
        // innerHTML. The fragment is server-rendered + escaped by the presets.
        frame.setAttribute('srcdoc', '<style>' + res.body.preview.css + '</style>' + html);
      }
      renderDependencyStatus(res.body.dependencies || null);
    }).catch(function () {
      if (errEl) { errEl.hidden = false; errEl.textContent = 'Preview request failed'; }
    });
  }
  var viewportBtns = document.querySelectorAll('[data-preview-viewport]');
  var vi;
  for (vi = 0; vi < viewportBtns.length; vi++) {
    viewportBtns[vi].addEventListener('click', function () {
      previewViewport = this.getAttribute('data-preview-viewport');
      var all = document.querySelectorAll('[data-preview-viewport]');
      var k;
      for (k = 0; k < all.length; k++) {
        var isActive = all[k] === this;
        all[k].className = isActive ? 'btn btn-sm btn-secondary active' : 'btn btn-sm btn-secondary';
        all[k].setAttribute('aria-pressed', isActive ? 'true' : 'false');
      }
      runPreview();
    });
  }
  var refreshBtn = document.getElementById('lg-preview-refresh');
  if (refreshBtn) { refreshBtn.addEventListener('click', runPreview); }
  // §8.9 design picker → re-render under the chosen design (server-resolved).
  var designPicker = document.getElementById('lg-preview-design');
  if (designPicker) { designPicker.addEventListener('change', runPreview); }

  // --- states simulator (§14.9 / §9.2: server-rendered sims only) -----------
  var simBtns = document.querySelectorAll('[data-sim-state]');
  var si;
  for (si = 0; si < simBtns.length; si++) {
    simBtns[si].addEventListener('click', function () {
      var stateName = this.getAttribute('data-sim-state');
      simState = stateName;
      // Every non-default sim is answers-driven — reveal the sample-answers
      // panel for all of them (dependency/selected/error/validation states).
      var panel = document.querySelector('[data-dependency-panel]');
      if (panel) { panel.hidden = (stateName === 'default'); }
      var all = document.querySelectorAll('[data-sim-state]');
      var k;
      for (k = 0; k < all.length; k++) {
        var on = all[k] === this;
        all[k].setAttribute('aria-pressed', on ? 'true' : 'false');
        all[k].className = on ? 'btn btn-sm btn-outline active' : 'btn btn-sm btn-outline';
      }
      // Re-render: the SERVER renders the chosen state into the markup (§9.2).
      runPreview();
    });
  }

  // --- §12.3 dependency preview controls: Apply button + live re-eval --------
  var depApply = document.getElementById('lg-dependency-apply');
  if (depApply) { depApply.addEventListener('click', runPreview); }
  var depAnswers = document.getElementById('lg-dependency-answers');
  if (depAnswers) { depAnswers.addEventListener('change', runPreview); }

  // --- Google-Maps toggle (§12.8) — the key is a secret, never embedded -----
  var mapsToggle = document.getElementById('lg-address-validation');
  if (mapsToggle) {
    mapsToggle.addEventListener('change', function () {
      state.address_validation_enabled = this.checked;
      markDirty();
    });
  }

  // --- continue-mode + default-boolean controls (§12.5/§12.6) ---------------
  var continueRadios = document.querySelectorAll('input[name="continue_mode"]');
  var ci;
  for (ci = 0; ci < continueRadios.length; ci++) {
    continueRadios[ci].addEventListener('change', function () {
      if (this.checked) { state.continue_mode = this.value; markDirty(); }
    });
  }

  // --- inspector: collect edits back into the selected node (§14.8/§13.1) ---
  function ensureObj(node, key) {
    if (!node[key] || typeof node[key] !== 'object') { node[key] = {}; }
    return node[key];
  }
  function setOrDelete(obj, key, value) {
    if (value === undefined || value === null || value === '') { delete obj[key]; } else { obj[key] = value; }
  }
  function cleanupEmpty(node, key) {
    var o = node[key];
    if (o && typeof o === 'object') {
      var has = false, k;
      for (k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) { has = true; break; } }
      if (!has) { delete node[key]; }
    }
  }
  function splitCsv(s) {
    var parts = (s || '').split(','), out = [], i, t;
    for (i = 0; i < parts.length; i++) { t = trimStr(parts[i]); if (t !== '') { out.push(t); } }
    return out;
  }

  function collectInspectorField(input) {
    var node = selectedNode();
    if (!node) { return; }
    var field = input.getAttribute('data-inspector-field');
    if (!field) { return; }
    if (field === 'required') { node.required = !!input.checked; }
    else if (field === 'internal_field') { setOrDelete(node, 'internal_field', input.value); }
    else if (field === 'design_preset') { setOrDelete(node, 'design_preset', input.value); }
    else if (field === 'valid_values') {
      var list = splitCsv(input.value);
      if (list.length > 0) { node.valid_values = list; } else { delete node.valid_values; }
    } else {
      var props = ensureObj(node, 'props');
      if (input.type === 'checkbox') { props[field] = !!input.checked; }
      else if (input.value === '') { delete props[field]; }
      else { props[field] = input.value; }
      cleanupEmpty(node, 'props');
    }
    markDirty();
  }

  function collectInspectorOverride(input) {
    var node = selectedNode();
    if (!node) { return; }
    var key = input.getAttribute('data-inspector-override');
    if (!key) { return; }
    var ov = ensureObj(node, 'design_overrides');
    if (input.value === '') { delete ov[key]; }
    else if (input.type === 'number') { var n = Number(input.value); ov[key] = isNaN(n) ? input.value : n; }
    else { ov[key] = input.value; }
    cleanupEmpty(node, 'design_overrides');
    markDirty();
  }

  function collectConditional() {
    var node = selectedNode();
    if (!node) { return; }
    var whenEl = document.querySelector('[data-inspector-cond="when"]');
    var opEl = document.querySelector('[data-inspector-cond="op"]');
    var valEl = document.querySelector('[data-inspector-cond="value"]');
    var whenVal = whenEl ? trimStr(whenEl.value) : '';
    if (whenVal === '') { delete node.conditional; }
    else { node.conditional = { when: whenVal, op: opEl ? opEl.value : 'eq', value: valEl ? valEl.value : '' }; }
    markDirty();
  }

  // --- per-choice editor (§13.1 label/value/analytics_id/icon/description) --
  var CHOICE_FIELDS = ['label', 'value', 'analytics_id', 'icon', 'description'];
  function choiceContainer() { return document.querySelector('[data-inspector-choices]'); }

  function buildChoiceRow(choice) {
    var wrap = document.createElement('div');
    wrap.className = 'lg-choice-row';
    wrap.setAttribute('data-choice-row', '');
    var i, inp, val;
    for (i = 0; i < CHOICE_FIELDS.length; i++) {
      inp = document.createElement('input');
      inp.className = 'form-input';
      inp.setAttribute('data-choice-field', CHOICE_FIELDS[i]);
      inp.setAttribute('placeholder', CHOICE_FIELDS[i]);
      val = choice ? choice[CHOICE_FIELDS[i]] : undefined;
      inp.value = (val === undefined || val === null) ? '' : String(val);
      inp.addEventListener('input', collectChoices);
      inp.addEventListener('change', collectChoices);
      wrap.appendChild(inp);
    }
    var rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn btn-sm btn-danger';
    rm.setAttribute('data-choice-remove', '');
    rm.textContent = 'Remove';
    rm.addEventListener('click', function () {
      if (wrap.parentNode) { wrap.parentNode.removeChild(wrap); }
      collectChoices();
    });
    wrap.appendChild(rm);
    return wrap;
  }

  function renderChoiceEditor(node) {
    var c = choiceContainer();
    if (!c) { return; }
    while (c.firstChild) { c.removeChild(c.firstChild); }
    var choices = (node && node.choices && node.choices.length) ? node.choices : [];
    var i;
    for (i = 0; i < choices.length; i++) { c.appendChild(buildChoiceRow(choices[i])); }
  }

  function collectChoices() {
    var node = selectedNode();
    if (!node) { return; }
    var c = choiceContainer();
    if (!c) { return; }
    var rows = c.querySelectorAll('[data-choice-row]');
    var choices = [], i, j, inputs, choice, f, v;
    for (i = 0; i < rows.length; i++) {
      inputs = rows[i].querySelectorAll('[data-choice-field]');
      choice = {};
      for (j = 0; j < inputs.length; j++) {
        f = inputs[j].getAttribute('data-choice-field');
        v = inputs[j].value;
        if (v !== '') { choice[f] = v; }
      }
      choices.push(choice);
    }
    if (choices.length > 0) { node.choices = choices; } else { delete node.choices; }
    markDirty();
  }

  function inspectorFieldValue(node, field) {
    if (!node) { return ''; }
    if (field === 'required') { return node.required === true; }
    if (field === 'internal_field') { return node.internal_field; }
    if (field === 'design_preset') { return node.design_preset; }
    if (field === 'valid_values') { return (node.valid_values && node.valid_values.length) ? node.valid_values.join(', ') : ''; }
    return node.props ? node.props[field] : '';
  }

  function populateInspector() {
    var node = selectedNode();
    var fieldInputs = document.querySelectorAll('[data-inspector-field]');
    var i, el, field, val;
    for (i = 0; i < fieldInputs.length; i++) {
      el = fieldInputs[i];
      field = el.getAttribute('data-inspector-field');
      val = inspectorFieldValue(node, field);
      if (el.type === 'checkbox') { el.checked = !!val; }
      else { el.value = (val === undefined || val === null) ? '' : String(val); }
    }
    var ovInputs = document.querySelectorAll('[data-inspector-override]');
    var oel, key, oval;
    for (i = 0; i < ovInputs.length; i++) {
      oel = ovInputs[i];
      key = oel.getAttribute('data-inspector-override');
      oval = (node && node.design_overrides) ? node.design_overrides[key] : undefined;
      oel.value = (oval === undefined || oval === null) ? '' : String(oval);
    }
    var whenEl = document.querySelector('[data-inspector-cond="when"]');
    var opEl = document.querySelector('[data-inspector-cond="op"]');
    var valEl = document.querySelector('[data-inspector-cond="value"]');
    var cond = (node && node.conditional) ? node.conditional : null;
    if (whenEl) { whenEl.value = (cond && cond.when) ? cond.when : ''; }
    if (opEl) { opEl.value = (cond && cond.op) ? cond.op : 'eq'; }
    if (valEl) { valEl.value = (cond && cond.value !== undefined && cond.value !== null) ? String(cond.value) : ''; }
    renderChoiceEditor(node);
  }

  // --- §12.4/§12.11 answer to Offer mapping grid (add/edit/remove into state)
  function mappingTbody() {
    var grid = document.getElementById('lg-mapping-grid');
    return grid ? grid.getElementsByTagName('tbody')[0] : null;
  }
  function jsonText(v) { if (v === undefined || v === null) { return ''; } try { return JSON.stringify(v); } catch (e) { return ''; } }
  function jsonOrNull(text) {
    var t = trimStr(text);
    if (t === '') { return null; }
    try { return JSON.parse(t); } catch (e) { return null; }
  }
  function appendCell(tr, child) { var td = document.createElement('td'); td.appendChild(child); tr.appendChild(td); }
  function mapInput(field, value, kind) {
    var el = document.createElement('input');
    el.className = 'form-input';
    el.setAttribute('data-map-field', field);
    if (kind === 'checkbox') { el.type = 'checkbox'; el.checked = !!value; }
    else { el.type = (kind === 'number') ? 'number' : 'text'; el.value = (value === undefined || value === null) ? '' : String(value); }
    el.addEventListener('input', collectMappings);
    el.addEventListener('change', collectMappings);
    return el;
  }
  function mapSelect(field, value) {
    var el = document.createElement('select');
    el.className = 'form-input';
    el.setAttribute('data-map-field', field);
    var i, opt;
    for (i = 0; i < PROVIDER_TYPES.length; i++) {
      opt = document.createElement('option');
      opt.value = PROVIDER_TYPES[i];
      opt.textContent = PROVIDER_TYPES[i];
      if (PROVIDER_TYPES[i] === value) { opt.selected = true; }
      el.appendChild(opt);
    }
    el.addEventListener('change', collectMappings);
    return el;
  }

  function buildMappingRow(edge, index) {
    var tr = document.createElement('tr');
    tr.setAttribute('data-map-row', String(index));
    if (edge && edge.offer_id) { tr.setAttribute('data-mapping-offer', String(edge.offer_id)); }
    appendCell(tr, mapInput('question_id', edge ? edge.question_id : '', 'text'));
    appendCell(tr, mapInput('internal_field', edge ? edge.internal_field : '', 'text'));
    appendCell(tr, mapInput('offer_id', edge ? edge.offer_id : '', 'number'));
    appendCell(tr, mapInput('offer_payload_field_path', edge ? edge.offer_payload_field_path : '', 'text'));
    appendCell(tr, mapSelect('provider_expected_type', edge ? edge.provider_expected_type : 'string'));
    appendCell(tr, mapInput('output_value_map', jsonText(edge ? edge.output_value_map : null), 'text'));
    appendCell(tr, mapInput('value_transform', jsonText(edge ? edge.value_transform : null), 'text'));
    appendCell(tr, mapInput('required_for_offer', edge ? edge.required_for_offer : false, 'checkbox'));
    appendCell(tr, mapInput('default_value', edge ? edge.default_value : '', 'text'));
    appendCell(tr, mapInput('fallback_value', edge ? edge.fallback_value : '', 'text'));
    var td = document.createElement('td');
    var testBtn = document.createElement('button');
    testBtn.type = 'button';
    testBtn.className = 'btn btn-sm btn-outline';
    testBtn.setAttribute('data-mapping-test', '');
    testBtn.textContent = 'Test';
    testBtn.addEventListener('click', function () { testMapping(index); });
    var rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.className = 'btn btn-sm btn-danger';
    rmBtn.setAttribute('data-map-remove', '');
    rmBtn.textContent = 'Remove';
    rmBtn.addEventListener('click', function () { removeMapping(index); });
    td.appendChild(testBtn);
    td.appendChild(rmBtn);
    tr.appendChild(td);
    return tr;
  }

  function renderMaps() {
    var tbody = mappingTbody();
    if (!tbody) { return; }
    while (tbody.firstChild) { tbody.removeChild(tbody.firstChild); }
    var i;
    if (!state.answer_maps.length) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.setAttribute('colspan', '11');
      td.appendChild(document.createTextNode('No answer to Offer mappings yet. Click "+ Add mapping".'));
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    for (i = 0; i < state.answer_maps.length; i++) {
      tbody.appendChild(buildMappingRow(state.answer_maps[i], i));
    }
  }

  function readMapRow(row) {
    var inputs = row.querySelectorAll('[data-map-field]');
    var edge = {}, j, inp, field, n;
    for (j = 0; j < inputs.length; j++) {
      inp = inputs[j];
      field = inp.getAttribute('data-map-field');
      if (field === 'required_for_offer') { edge[field] = !!inp.checked; }
      else if (field === 'offer_id') { n = parseInt(inp.value, 10); edge[field] = isNaN(n) ? null : n; }
      else if (field === 'output_value_map' || field === 'value_transform') { edge[field] = jsonOrNull(inp.value); }
      else { edge[field] = inp.value; }
    }
    return edge;
  }

  function collectMappings() {
    var tbody = mappingTbody();
    if (!tbody) { return; }
    var rows = tbody.querySelectorAll('tr[data-map-row]');
    var maps = [], i;
    for (i = 0; i < rows.length; i++) { maps.push(readMapRow(rows[i])); }
    state.answer_maps = maps;
    markDirty();
  }

  function removeMapping(index) {
    collectMappings();
    if (index > -1 && index < state.answer_maps.length) { state.answer_maps.splice(index, 1); }
    renderMaps();
    markDirty();
  }

  function testMapping(index) {
    collectMappings();
    var errEl = document.getElementById('lg-mapping-error');
    var resEl = document.getElementById('lg-mapping-test-result');
    if (errEl) { errEl.hidden = true; }
    if (!state.public_id) {
      if (errEl) { errEl.hidden = false; errEl.textContent = 'Save the Section first to test the generated payload.'; }
      return;
    }
    var edge = state.answer_maps[index];
    var offerIds = (edge && edge.offer_id) ? [edge.offer_id] : [];
    fetch('/api/admin/leadgen/sections/' + encodeURIComponent(state.public_id) + '/validate-payload', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ answers: {}, offer_ids: offerIds })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      if (!res.ok || !res.body) {
        if (errEl) { errEl.hidden = false; errEl.textContent = (res.body && res.body.error) || 'Test failed'; }
        return;
      }
      if (resEl) { resEl.hidden = false; resEl.textContent = JSON.stringify(res.body.offers || [], null, 2); }
    }).catch(function () {
      if (errEl) { errEl.hidden = false; errEl.textContent = 'Test request failed'; }
    });
  }

  // --- Save (POST create / PATCH update) ------------------------------------
  function collectSection() {
    collectMappings();
    var nameEl = document.getElementById('lg-section-name');
    var actEl = document.getElementById('lg-section-activity');
    var verEl = document.getElementById('lg-section-vertical');
    var headEl = document.getElementById('lg-section-headline');
    var subEl = document.getElementById('lg-section-subheadline');
    return {
      section_name: nameEl ? nameEl.value : '',
      activity: actEl ? actEl.value : '',
      vertical: verEl ? verEl.value : '',
      headline_text: headEl ? headEl.value : '',
      subheadline_text: subEl ? subEl.value : null,
      continue_mode: state.continue_mode || 'button',
      address_validation_enabled: !!state.address_validation_enabled,
      content_json: JSON.stringify(state.content),
      answer_maps: state.answer_maps
    };
  }

  var saveBtn = document.getElementById('lg-section-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      var errEl = document.getElementById('lg-section-error');
      if (errEl) { errEl.hidden = true; }
      saveBtn.disabled = true;
      var isNew = !state.public_id;
      var url = isNew ? '/api/admin/leadgen/sections' : '/api/admin/leadgen/sections/' + encodeURIComponent(state.public_id);
      fetch(url, {
        method: isNew ? 'POST' : 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(collectSection())
      }).then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, body: j }; });
      }).then(function (res) {
        saveBtn.disabled = false;
        if (!res.ok) {
          if (errEl) { errEl.hidden = false; errEl.textContent = (res.body && res.body.error) || 'Save failed'; }
          return;
        }
        dirty = false;
        if (res.body && res.body.public_id) {
          window.location.href = '/admin/leadgen/sections/' + encodeURIComponent(res.body.public_id) + '/edit';
        } else {
          window.location.reload();
        }
      }).catch(function () {
        saveBtn.disabled = false;
        if (errEl) { errEl.hidden = false; errEl.textContent = 'Save request failed'; }
      });
    });
  }

  // --- archive confirm (§9.6) ----------------------------------------------
  var archiveBtn = document.getElementById('lg-section-archive');
  if (archiveBtn) {
    archiveBtn.addEventListener('click', function () {
      if (!state.public_id) { return; }
      if (!window.confirm('Archive this Section? It can be reactivated later.')) { return; }
      fetch('/api/admin/leadgen/sections/' + encodeURIComponent(state.public_id), {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' }
      }).then(function () { dirty = false; window.location.href = '/admin/leadgen/sections'; });
    });
  }

  // --- §9.6 unsaved-changes guard ------------------------------------------
  window.addEventListener('beforeunload', function (ev) {
    if (dirty) { ev.preventDefault(); ev.returnValue = ''; return ''; }
  });

  // watch scalar form inputs for the dirty flag
  var watched = document.querySelectorAll('#lg-section-form input, #lg-section-form textarea');
  var wi;
  for (wi = 0; wi < watched.length; wi++) {
    watched[wi].addEventListener('input', markDirty);
    watched[wi].addEventListener('change', markDirty);
  }

  // inspector collect wiring: every edit flows back into the selected node.
  var fieldEls = document.querySelectorAll('[data-inspector-field]');
  var fe;
  for (fe = 0; fe < fieldEls.length; fe++) {
    fieldEls[fe].addEventListener('input', function () { collectInspectorField(this); });
    fieldEls[fe].addEventListener('change', function () { collectInspectorField(this); });
  }
  var ovEls = document.querySelectorAll('[data-inspector-override]');
  var oe;
  for (oe = 0; oe < ovEls.length; oe++) {
    ovEls[oe].addEventListener('input', function () { collectInspectorOverride(this); });
    ovEls[oe].addEventListener('change', function () { collectInspectorOverride(this); });
  }
  var condEls = document.querySelectorAll('[data-inspector-cond]');
  var ce;
  for (ce = 0; ce < condEls.length; ce++) {
    condEls[ce].addEventListener('input', collectConditional);
    condEls[ce].addEventListener('change', collectConditional);
  }
  var choiceAdd = document.getElementById('lg-choice-add');
  if (choiceAdd) {
    choiceAdd.addEventListener('click', function () {
      var c = choiceContainer();
      if (c) { c.appendChild(buildChoiceRow({})); }
    });
  }

  // mapping grid: "+ Add mapping" appends an editable edge into state.
  var mappingAdd = document.getElementById('lg-mapping-add');
  if (mappingAdd) {
    mappingAdd.addEventListener('click', function () {
      collectMappings();
      state.answer_maps.push({ question_id: '', internal_field: '', offer_id: null, offer_payload_field_path: '', provider_expected_type: 'string', output_value_map: null, value_transform: null, required_for_offer: false, default_value: null, fallback_value: null });
      renderMaps();
      markDirty();
    });
  }

  renderMaps();
  runPreview();
}());
`;
