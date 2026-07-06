// LeadGen Section question/answer builder UI (contract 05 §13 builder + §14.8
// inspector controls + §14.9 preview + §12.4/§12.11 mapping grid). Server-
// renders the editor's LEFT canvas (add/reorder components from the capability
// catalog), the RIGHT inspector (curated §14.8 style tokens + the answer→Offer
// mapping grid), the Desktop/Mobile preview toggle, and the states simulator
// (default/selected/error/dependency). All interaction is a single strict-ES5
// inline script (the layout.ts constraint the listicles pages hold too —
// asserted by the ES5 parse test). Every author value is escapeHtml-escaped;
// author content never flows into a style attribute (§14.10). The preview
// renders into a SANDBOXED iframe via srcdoc (the listicles preview pattern —
// never innerHTML).

import { escapeHtml } from "../templates/layout";
import { COMPONENT_CATALOG, type ComponentType } from "../../public/leadgen/components/registry";
import { CURATED_DESIGN_OVERRIDE_KEYS } from "../../public/leadgen/components/content-schema";

// ---------------------------------------------------------------------------
// Component capability palette (§13.1) — grouped by catalog category
// ---------------------------------------------------------------------------

type CatalogCategory = "chrome" | "affordance" | "question" | "control";

const CATEGORY_LABELS: Record<CatalogCategory, string> = {
  question: "Questions",
  affordance: "Copy & affordances",
  control: "Controls",
  chrome: "Funnel chrome",
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
  const groups: CatalogCategory[] = ["question", "affordance", "control", "chrome"];
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
  question_key: string;
  internal_field: string;
  offer_id: number;
  offer_payload_field_path: string;
  provider_expected_type: string;
  output_value_map_json: unknown;
  transform_json: unknown;
  required_for_offer: boolean;
  mapping_status: string;
}

// §12.11 field-level state → badge class + label.
function completenessBadge(status: string): string {
  const map: Record<string, { cls: string; label: string }> = {
    complete: { cls: "badge badge-published", label: "ok" },
    incomplete: { cls: "badge badge-scheduled", label: "missing required" },
    type_mismatch: { cls: "badge badge-draft", label: "type mismatch" },
    orphaned: { cls: "badge badge-archived", label: "orphaned" },
  };
  const chosen = map[status] ?? { cls: "badge badge-draft", label: status };
  return `<span class="${chosen.cls}" data-mapping-status="${escapeHtml(status)}">${escapeHtml(chosen.label)}</span>`;
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
  <td>${escapeHtml(valueMapSummary(m.output_value_map_json))}</td>
  <td>${escapeHtml(transformSummary(m.transform_json))}</td>
  <td>${m.required_for_offer ? "required" : "optional"}</td>
  <td>${completenessBadge(m.mapping_status)}</td>
  <td><button type="button" class="btn btn-sm btn-outline" data-mapping-test aria-label="Test generated payload">Test</button></td>
</tr>`;
}

export function renderMappingGrid(
  maps: ReadonlyArray<AnswerMapView>,
  offerLabelById: ReadonlyMap<number, string>,
): string {
  const headerCells = MAPPING_COLUMNS.map((c) => `<th scope="col">${escapeHtml(c)}</th>`).join("");
  const rows =
    maps.length === 0
      ? `<tr><td colspan="${MAPPING_COLUMNS.length}"><div class="empty-state"><p>No answer→Offer mappings yet.</p><p class="form-help">Pick an Offer and map a question to a payload field (§12.4).</p></div></td></tr>`
      : maps.map((m) => renderMappingRow(m, offerLabelById)).join("");
  return `<div class="lg-inspector-section" data-inspector-mapping>
  <h4 class="lg-inspector-heading">Answer → Offer mapping (§12.4 / §12.11)</h4>
  <div class="table-wrapper">
    <table class="table lg-mapping-grid" id="lg-mapping-grid" aria-label="Answer to Offer mapping">
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <button type="button" class="btn btn-sm btn-secondary" id="lg-mapping-add">+ Add mapping</button>
  <p id="lg-mapping-error" class="alert alert-error" hidden role="alert"></p>
</div>`;
}

export function renderInspector(
  maps: ReadonlyArray<AnswerMapView>,
  offerLabelById: ReadonlyMap<number, string>,
): string {
  return `<aside class="lg-inspector" id="lg-inspector" aria-label="Component inspector">
  <div class="lg-inspector-head"><h3 class="card-title">Inspector</h3><span class="form-help" id="lg-inspector-target">Select a component</span></div>
  ${renderInspectorTokens()}
  ${renderMappingGrid(maps, offerLabelById)}
</aside>`;
}

export type { AnswerMapView };

// ---------------------------------------------------------------------------
// Desktop/Mobile preview toggle + states simulator (§14.9)
// ---------------------------------------------------------------------------

export function renderPreviewToggle(): string {
  return `<div class="lg-preview-controls" data-lg-preview-controls>
  <div class="lg-viewport-toggle" role="group" aria-label="Preview viewport">
    <button type="button" class="btn btn-sm btn-secondary active" data-preview-viewport="desktop" aria-pressed="true">Desktop</button>
    <button type="button" class="btn btn-sm btn-secondary" data-preview-viewport="mobile" aria-pressed="false">Mobile</button>
    <button type="button" class="btn btn-sm btn-outline" id="lg-preview-refresh">Refresh preview</button>
  </div>
  <div class="lg-states-simulator" role="group" aria-label="State simulator (§14.9)">
    <span class="form-help">Simulate state:</span>
    <button type="button" class="btn btn-sm btn-outline active" data-sim-state="default" aria-pressed="true">Default</button>
    <button type="button" class="btn btn-sm btn-outline" data-sim-state="selected" aria-pressed="false">Selected</button>
    <button type="button" class="btn btn-sm btn-outline" data-sim-state="error" aria-pressed="false">Error</button>
    <button type="button" class="btn btn-sm btn-outline" data-sim-state="dependency" aria-pressed="false">Dependency</button>
  </div>
  <p id="lg-preview-error" class="alert alert-error" hidden role="alert"></p>
  <iframe id="lg-preview-frame" class="lg-preview-frame" title="Section preview (default funnel design)" sandbox="" data-viewport="desktop"></iframe>
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
.lg-preview-frame[data-viewport="mobile"]{max-width:375px}
.lg-viewport-toggle,.lg-states-simulator{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.lg-check{display:flex;align-items:center;gap:6px}
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
  var dirty = false;
  function markDirty() { dirty = true; }

  function newQuestionId() {
    return 'q_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
  }

  // --- palette: add a component from the capability catalog (§13) -----------
  var palette = document.querySelectorAll('[data-add-component]');
  var pi;
  for (pi = 0; pi < palette.length; pi++) {
    palette[pi].addEventListener('click', function () {
      var type = this.getAttribute('data-add-component');
      state.content.components.push({ type: type, question_id: newQuestionId() });
      markDirty();
      renderCanvas();
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
    var cards = document.querySelectorAll('.lg-canvas-card');
    var i;
    for (i = 0; i < cards.length; i++) {
      cards[i].setAttribute('data-selected', cards[i].getAttribute('data-question-id') === questionId ? 'true' : 'false');
    }
    var target = document.getElementById('lg-inspector-target');
    if (target) { target.textContent = 'Editing ' + questionId; }
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
  function runPreview() {
    var frame = document.getElementById('lg-preview-frame');
    var errEl = document.getElementById('lg-preview-error');
    if (errEl) { errEl.hidden = true; }
    fetch('/api/admin/leadgen/sections/preview', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ content_json: JSON.stringify(state.content) })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      if (!res.ok || !res.body || !res.body.preview) {
        if (errEl) { errEl.hidden = false; errEl.textContent = (res.body && res.body.error) || 'Preview failed'; }
        return;
      }
      if (frame) {
        frame.setAttribute('data-viewport', previewViewport);
        var html = previewViewport === 'mobile' ? res.body.preview.mobile : res.body.preview.desktop;
        // Sandboxed srcdoc document — the listicles preview pattern, never
        // innerHTML. The fragment is server-rendered + escaped by the presets.
        frame.setAttribute('srcdoc', '<style>' + res.body.preview.css + '</style>' + html);
      }
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

  // --- states simulator (§14.9) --------------------------------------------
  var simBtns = document.querySelectorAll('[data-sim-state]');
  var si;
  for (si = 0; si < simBtns.length; si++) {
    simBtns[si].addEventListener('click', function () {
      var stateName = this.getAttribute('data-sim-state');
      var frame = document.getElementById('lg-preview-frame');
      if (frame) { frame.setAttribute('data-sim-state', stateName); }
      var all = document.querySelectorAll('[data-sim-state]');
      var k;
      for (k = 0; k < all.length; k++) {
        var on = all[k] === this;
        all[k].setAttribute('aria-pressed', on ? 'true' : 'false');
        all[k].className = on ? 'btn btn-sm btn-outline active' : 'btn btn-sm btn-outline';
      }
    });
  }

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

  // --- Save (POST create / PATCH update) ------------------------------------
  function collectSection() {
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

  // watch scalar inputs for the dirty flag
  var watched = document.querySelectorAll('#lg-section-form input, #lg-section-form textarea, [data-inspector-override], [data-inspector-field]');
  var wi;
  for (wi = 0; wi < watched.length; wi++) {
    watched[wi].addEventListener('input', markDirty);
    watched[wi].addEventListener('change', markDirty);
  }

  runPreview();
}());
`;
