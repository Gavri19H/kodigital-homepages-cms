// Admin AI Presets templates.
// presetsListPage — list of registered AI presets (id, label, model,
// scope) with a "+ New Preset" toolbar action; each row links to the
// /admin/presets/:id editor.
// presetFormPage — T12: create/edit form rebuilt to the legacy reference
// (MISSION W4 / "15.21.38.png"). renderPresets emits the reference fields:
// Name* (auto-derives slug) + Description, a REQUIRED name="category" use-case
// <select> (the routing key), split System + User prompt textareas,
// {{variable}} click-to-insert chips with auto-detect (no raw "Variables
// (JSON)" textarea), and a "Fields to Generate" content-mapping. Model
// selects are populated ONLY from the SUPPORTED_*_MODELS registry
// (api/src/ai/models.ts) — the same lists the write handlers validate
// against, so the form cannot offer a model the API would reject.
// New mode POSTs /api/admin/ai/presets; edit mode PUTs
// /api/admin/ai/presets/:id; the delete action DELETEs the same path.
// Renders inside the legacy adminLayout shell so the sidebar nav and
// brand 'KoDigital CMS' stay consistent with the other admin tabs.
// Inline script is ES5-only (var/function/promise chains).

import { adminLayout, escapeHtml } from "./layout";
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_TEXT_MODEL,
  SUPPORTED_IMAGE_MODELS,
  SUPPORTED_TEXT_MODELS,
} from "../../ai/models";
// T8: the inline client assets (styles + ES5 behaviour) for the rebuilt
// 2-column form live in their own module so this file stays render-only.
import { PRESET_FORM_SCRIPT, PRESET_FORM_STYLES } from "./presets-form-script";

export interface PresetListEntry {
  id?: string;
  slug?: string;
  label: string;
  // Human display name (falls back to slug in the data layer).
  name?: string;
  model?: string;
  scope?: string;
  category?: string;
  description?: string;
  usageCount?: number;
  variableCount?: number;
  isActive?: boolean;
  isSystem?: boolean;
}

// Mirrors the PresetRow wire shape from ./ai-presets (the prompt_presets
// columns the form round-trips through POST/PUT /api/admin/ai/presets).
export interface PresetFormEntry {
  id: number | string;
  slug: string;
  prompt_template: string;
  category: string | null;
  variables: string | null;
  is_system: number;
  is_active: number;
  text_model: string | null;
  image_model: string | null;
  name: string | null;
  description: string | null;
  system_prompt_template: string | null;
  user_prompt_template: string | null;
  content_mapping: string | null;
  // T4 reference columns (migration 0019). Optional so legacy callers that
  // build a PresetFormEntry without them still type-check; the form reads them
  // for the Custom Variables + Output Rules sections (T8).
  variables_schema?: string | null;
  output_rules?: string | null;
}

export interface PresetsBranding {
  userEmail?: string;
}

// Use-case category enum — the routing key generators select a preset by
// (legacy presets.ts:13-20). Rendered as a REQUIRED <select name="category">,
// NOT a freeform text input.
const USE_CASE_CATEGORIES: ReadonlyArray<[string, string]> = [
  ["title", "Title"],
  ["excerpt", "Excerpt"],
  ["outline", "Outline"],
  ["content", "Content"],
  ["seo", "SEO"],
  ["image", "Image"],
  ["custom", "Custom"],
];

// "Content Preset Mapping" (T8 reference set, legacy content-mapping
// :411-429): which outputs a preset produces. Stored as boolean flags in
// content_mapping. Image fields are NOT booleans here — they live in the Image
// options widget below and persist under content_mapping.image_prompts (each
// carries an operator-authored prompt, not just an on/off flag). The numeric
// Paragraph-count field is rendered separately (renderContentMap) and persists
// at content_mapping.paragraph_count.
const CONTENT_MAP_FIELDS: ReadonlyArray<[string, string]> = [
  ["title", "Title"],
  ["excerpt", "Excerpt"],
  ["content", "Body content"],
  ["meta_title", "Meta Title"],
  ["meta_description", "Meta Description"],
  ["author_name", "Author Name"],
  ["author_bio", "Author Bio"],
  ["generate_h2_subtitles", "Generate H2 Subtitles"],
  ["tags", "Tags"],
  ["enforce_json_schema", "Enforce JSON Schema"],
];

// Paragraph-type options for the Output Rules section (legacy preset form).
const PARAGRAPH_TYPE_OPTIONS: ReadonlyArray<[string, string]> = [
  ["", "—"],
  ["short", "Short paragraphs"],
  ["standard", "Standard paragraphs"],
  ["long", "Long-form paragraphs"],
];

// T4 operator image options. Each is a checkbox that reveals a user-prompt box;
// when enabled the prompt persists at content_mapping.image_prompts.<key> and
// generation routes that field through POST /api/admin/ai/image.
const IMAGE_PROMPT_FIELDS: ReadonlyArray<[string, string]> = [
  ["hero_image", "Hero image"],
  ["above_subheadline_image", "Above-subheadline image"],
];

// {{variable}} click-to-insert chips (legacy auto-detect Preview). Clicking a
// chip inserts the token into the focused prompt; detected vars are submitted
// as the structured `variables` payload — there is no raw name="variables" field.
const VARIABLE_CHIPS: ReadonlyArray<string> = [
  "topic",
  "vertical",
  "brand",
  "audience",
  "tone",
  "keyword",
];

// Use-case category -> human label (mirrors USE_CASE_CATEGORIES). Unknown
// values fall through to the raw category string.
function getCategoryLabel(category: string): string {
  for (const [val, label] of USE_CASE_CATEGORIES) {
    if (val === category) return label;
  }
  return category;
}

// Use-case category -> layout.ts badge palette class (ported from the legacy
// reference's getCategoryBadgeClass). Falls back to `badge-draft` (the neutral
// grey badge) for unknown / empty categories.
function getCategoryBadgeClass(category: string): string {
  switch (category) {
    case "title":
    case "excerpt":
    case "content":
      return "badge-published";
    case "outline":
    case "seo":
      return "badge-scheduled";
    case "image":
    case "custom":
    default:
      return "badge-draft";
  }
}

// One AI-presets list row (ported 1:1 from the legacy reference
// templates/presets.ts:90-115): Name (+ description snippet + System badge) /
// Category badge / Model / Variables / Uses / Status badge / Actions. User
// presets get Edit + Clone + Delete; system presets get only an
// Activate/Deactivate toggle (the write handler rejects every other field).
function renderPresetRow(p: PresetListEntry): string {
  const id = escapeHtml(p.id ?? "");
  const name = escapeHtml(p.name ?? p.label);
  const model = escapeHtml(p.model ?? "");
  const category = p.category ?? "";
  const description = p.description ?? "";
  const usageCount = escapeHtml(p.usageCount ?? 0);
  const variableCount = escapeHtml(p.variableCount ?? 0);
  const isActive = !!p.isActive;
  const isSystem = !!p.isSystem;

  const descSnippet = description !== ""
    ? `<div class="preset-desc">${escapeHtml(description.substring(0, 60))}${description.length > 60 ? "…" : ""}</div>`
    : "";
  const systemBadge = isSystem
    ? `<span class="badge badge-draft preset-system-badge">System</span>`
    : "";
  const nameCell = id !== ""
    ? `<a href="/admin/presets/${id}">${name}</a>`
    : name;
  const categoryCell = category !== ""
    ? `<span class="badge ${getCategoryBadgeClass(category)}">${escapeHtml(getCategoryLabel(category))}</span>`
    : "";
  const statusCell = isActive
    ? `<span class="badge badge-published">Active</span>`
    : `<span class="badge badge-draft">Inactive</span>`;
  const actionsCell = isSystem
    ? `<button type="button" class="btn btn-secondary btn-sm" data-toggle-active="${id}" data-current-active="${isActive ? "1" : "0"}">${isActive ? "Deactivate" : "Activate"}</button>`
    : `<a href="/admin/presets/${id}" class="btn btn-secondary btn-sm">Edit</a>
      <button type="button" class="btn btn-secondary btn-sm" data-clone-preset="${id}">Clone</button>
      <button type="button" class="btn btn-secondary btn-sm" data-toggle-active="${id}" data-current-active="${isActive ? "1" : "0"}">${isActive ? "Deactivate" : "Activate"}</button>
      <button type="button" class="btn btn-danger btn-sm" data-delete-preset="${id}" data-preset-name="${name}">Delete</button>`;

  return `<tr data-preset-id="${id}">
  <td>
    <div class="preset-name">${nameCell}</div>
    ${descSnippet}
    ${systemBadge}
  </td>
  <td>${categoryCell}</td>
  <td class="preset-model">${model}</td>
  <td>${variableCount}</td>
  <td>${usageCount}</td>
  <td>${statusCell}</td>
  <td class="table-actions">${actionsCell}</td>
</tr>`;
}

function renderPresetsTable(presets: ReadonlyArray<PresetListEntry>): string {
  const rows = presets.length === 0
    ? `<tr><td colspan="7" class="empty-state">No presets registered yet</td></tr>`
    : presets.map(renderPresetRow).join("");
  return `<div class="card">
  <div class="table-wrapper">
    <table class="table presets-list" aria-label="AI presets list">
      <thead><tr>
        <th scope="col">Name</th>
        <th scope="col">Category</th>
        <th scope="col">Model</th>
        <th scope="col">Variables</th>
        <th scope="col">Uses</th>
        <th scope="col">Status</th>
        <th scope="col">Actions</th>
      </tr></thead>
      <tbody id="presets-list-body" data-empty="No presets registered yet">${rows}</tbody>
    </table>
  </div>
</div>`;
}

// TODO: the reference list also has a search-box + category-filter toolbar.
// That needs a route change (GET /admin/presets must accept ?search / ?category
// query params and pass them through to listAdminPresets) — out of scope here.
function renderListToolbar(): string {
  return `<div class="toolbar">
  <a href="/admin/presets/new" class="btn btn-primary">+ New Preset</a>
</div>`;
}

// Inline behaviour for the list-page Actions (ES5 — matches ADMIN_SCRIPTS).
// Activate/Deactivate -> PUT /api/admin/ai/presets/:id { is_active };
// Clone -> GET the preset then POST /api/admin/ai/presets with a duplicated
// body; Delete -> DELETE /api/admin/ai/presets/:id (after confirmDelete).
// All three are registered in ai-api.ts (T21 [E4] CRUD route patterns).
const PRESETS_LIST_SCRIPT = `
(function () {
  function toggleActive(id, current) {
    var next = current === '1' ? 0 : 1;
    fetch('/api/admin/ai/presets/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: next })
    }).then(function (response) {
      if (response.ok) { window.location.reload(); return; }
      return response.json().then(function (data) {
        alert('Error: ' + ((data && data.error) || 'Failed to update preset'));
      });
    }).catch(function () { alert('Error: Failed to update preset'); });
  }

  function duplicatePreset(id) {
    fetch('/api/admin/ai/presets/' + id).then(function (response) {
      if (!response.ok) { throw new Error('Failed to fetch preset'); }
      return response.json();
    }).then(function (data) {
      var preset = data.item;
      var newPreset = {
        name: (preset.name || preset.slug) + ' (Copy)',
        slug: preset.slug + '-copy',
        description: preset.description,
        category: preset.category,
        prompt_template: preset.prompt_template,
        system_prompt_template: preset.system_prompt_template,
        user_prompt_template: preset.user_prompt_template,
        variables: preset.variables,
        variables_schema: preset.variables_schema,
        output_rules: preset.output_rules,
        content_mapping: preset.content_mapping,
        text_model: preset.text_model,
        image_model: preset.image_model,
        is_active: 0
      };
      return fetch('/api/admin/ai/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPreset)
      }).then(function (createResponse) {
        return createResponse.json().then(function (body) {
          if (createResponse.ok && body && body.item) {
            window.location.href = '/admin/presets/' + body.item.id;
          } else {
            alert('Error: ' + ((body && body.error) || 'Failed to duplicate preset'));
          }
        });
      });
    }).catch(function () { alert('Error: Failed to duplicate preset'); });
  }

  function deletePreset(id, name) {
    if (!window.confirmDelete('Are you sure you want to delete "' + name + '"?')) { return; }
    fetch('/api/admin/ai/presets/' + id, { method: 'DELETE' }).then(function (response) {
      if (response.ok || response.status === 204) { window.location.reload(); return; }
      return response.json().then(function (data) {
        alert('Error: ' + ((data && data.error) || 'Failed to delete preset'));
      });
    }).catch(function () { alert('Error: Failed to delete preset'); });
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) { return; }
    var toggleId = t.getAttribute('data-toggle-active');
    if (toggleId) { toggleActive(toggleId, t.getAttribute('data-current-active') || '0'); return; }
    var cloneId = t.getAttribute('data-clone-preset');
    if (cloneId) { duplicatePreset(cloneId); return; }
    var deleteId = t.getAttribute('data-delete-preset');
    if (deleteId) { deletePreset(deleteId, t.getAttribute('data-preset-name') || ''); return; }
  });
})();
`;

const PRESETS_LIST_STYLES = `
.preset-name{font-weight:500}
.preset-desc{font-size:12px;color:var(--c-muted);margin-top:2px}
.preset-system-badge{font-size:10px;margin-top:4px}
.preset-model{font-size:12px;color:var(--c-muted)}
`;

export function presetsListPage(
  presets: ReadonlyArray<PresetListEntry>,
  branding: PresetsBranding = {},
): string {
  const content = renderListToolbar() + renderPresetsTable(presets);
  return adminLayout({
    title: "AI Presets",
    activePath: "/admin/presets",
    userEmail: branding.userEmail,
    content,
    styles: PRESETS_LIST_STYLES,
    scripts: PRESETS_LIST_SCRIPT,
  });
}

function renderModelOptions(
  models: ReadonlyArray<string>,
  selected: string | null | undefined,
): string {
  return models.map((m) => {
    const sel = m === (selected ?? "") ? " selected" : "";
    return `<option value="${escapeHtml(m)}"${sel}>${escapeHtml(m)}</option>`;
  }).join("");
}

function renderCategoryOptions(selected: string | null | undefined): string {
  const cur = selected ?? "";
  const placeholder =
    `<option value="" disabled${cur === "" ? " selected" : ""}>Select a use case…</option>`;
  const opts = USE_CASE_CATEGORIES.map(([val, label]) => {
    const sel = val === cur ? " selected" : "";
    return `<option value="${escapeHtml(val)}"${sel}>${escapeHtml(label)}</option>`;
  }).join("");
  return placeholder + opts;
}

function renderVariableChips(dis: string): string {
  const chips = VARIABLE_CHIPS.map((v) =>
    `<button type="button" class="var-chip" data-var="${escapeHtml(v)}"${dis}>{{${escapeHtml(v)}}}</button>`
  ).join("");
  return `<div class="form-group">
  <label class="form-label">Variables</label>
  <div class="var-chips" id="preset-var-chips">${chips}</div>
  <p class="form-help">Click a chip to insert it into the focused prompt. Detected: <span id="preset-detected-vars" class="detected-vars">none</span></p>
</div>`;
}

function renderContentMap(
  mapping: string | null | undefined,
  dis: string,
): string {
  let selected: Record<string, unknown> = {};
  if (mapping) {
    // Pre-fill from a stored content_mapping JSON; corrupt JSON falls back to
    // an empty map rather than throwing during render.
    try {
      const parsed = JSON.parse(mapping);
      if (parsed && typeof parsed === "object") {
        selected = parsed as Record<string, unknown>;
      }
    } catch {
      selected = {};
    }
  }
  const items = CONTENT_MAP_FIELDS.map(([field, label]) => {
    const checked = selected[field] ? " checked" : "";
    return `<label class="cmap-item"><input type="checkbox" class="cmap-field" data-field="${escapeHtml(field)}" id="cmap-${escapeHtml(field)}"${checked}${dis} /> ${escapeHtml(label)}</label>`;
  }).join("");
  const pcRaw = selected.paragraph_count;
  const pcValue = typeof pcRaw === "number" && Number.isFinite(pcRaw)
    ? String(pcRaw)
    : "";
  return `<div class="form-group">
  <label class="form-label">Content Preset Mapping</label>
  <div class="content-map" id="preset-content-map">${items}</div>
  <div class="cmap-paragraph-count">
    <label for="cmap-paragraph_count" class="form-label">Paragraph count</label>
    <input id="cmap-paragraph_count" type="number" min="0" class="form-input" value="${escapeHtml(pcValue)}"${dis} />
  </div>
  <p class="form-help">Select which outputs this preset generates (content-mapping).</p>
</div>`;
}

// T8 Custom Variables: a repeatable editor for the declared {{variable}}
// contract (key / description / default / required). Persists to the
// variables_schema column as a JSON array of
// {key, description, default, required}. New mode renders one empty row so the
// four sub-fields are always visible; edit mode pre-fills rows from the stored
// variables_schema (corrupt JSON falls back to one empty row).
interface VariableSchemaEntry {
  key?: unknown;
  description?: unknown;
  default?: unknown;
  required?: unknown;
}

function parseVariablesSchema(
  raw: string | null | undefined,
): VariableSchemaEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as VariableSchemaEntry[]) : [];
  } catch {
    return [];
  }
}

function renderVariableRow(entry: VariableSchemaEntry, dis: string): string {
  const key = typeof entry.key === "string" ? entry.key : "";
  const desc = typeof entry.description === "string" ? entry.description : "";
  const def = typeof entry.default === "string" ? entry.default : "";
  const req = entry.required === true ? " checked" : "";
  return `<div class="cv-row">
  <input type="text" class="form-input cv-key" placeholder="key" value="${escapeHtml(key)}"${dis} />
  <input type="text" class="form-input cv-desc" placeholder="description" value="${escapeHtml(desc)}"${dis} />
  <input type="text" class="form-input cv-default" placeholder="default" value="${escapeHtml(def)}"${dis} />
  <label class="cv-required"><input type="checkbox" class="cv-required-input"${req}${dis} /> required</label>
  <button type="button" class="cv-remove" aria-label="Remove variable"${dis}>✕</button>
</div>`;
}

function renderCustomVariables(
  schema: string | null | undefined,
  dis: string,
): string {
  const entries = parseVariablesSchema(schema);
  const rows = (entries.length > 0 ? entries : [{}])
    .map((e) => renderVariableRow(e, dis))
    .join("");
  return `<div class="form-group">
  <label class="form-label">Custom Variables</label>
  <div class="cv-list" id="preset-variables-schema">${rows}</div>
  <div class="toolbar">
    <button type="button" id="preset-add-variable" class="btn btn-secondary"${dis}>+ Add variable</button>
  </div>
  <p class="form-help">Declared {{variable}} contract: key, description, default, required.</p>
</div>`;
}

// T8 Output Rules (paragraph-type / min / max / style / JSON-schema).
// Persists to output_rules as a one-element JSON array; edit mode reads the
// first rule object back into the fields.
interface OutputRule {
  paragraph_type?: unknown;
  min?: unknown;
  max?: unknown;
  style?: unknown;
  json_schema?: unknown;
}

function parseFirstOutputRule(raw: string | null | undefined): OutputRule {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0] && typeof parsed[0] === "object") {
      return parsed[0] as OutputRule;
    }
  } catch {
    return {};
  }
  return {};
}

function renderOutputRules(
  rules: string | null | undefined,
  dis: string,
): string {
  const rule = parseFirstOutputRule(rules);
  const pt = typeof rule.paragraph_type === "string" ? rule.paragraph_type : "";
  const min = typeof rule.min === "number" ? String(rule.min) : "";
  const max = typeof rule.max === "number" ? String(rule.max) : "";
  const style = typeof rule.style === "string" ? rule.style : "";
  const schema = typeof rule.json_schema === "string" ? rule.json_schema : "";
  const ptOptions = PARAGRAPH_TYPE_OPTIONS.map(([val, label]) => {
    const sel = val === pt ? " selected" : "";
    return `<option value="${escapeHtml(val)}"${sel}>${escapeHtml(label)}</option>`;
  }).join("");
  return `<div class="form-group">
  <label class="form-label">Output Rules</label>
  <div class="output-rules-grid">
    <div>
      <label for="or-paragraph-type" class="form-label">Paragraph type</label>
      <select id="or-paragraph-type" class="form-select"${dis}>${ptOptions}</select>
    </div>
    <div>
      <label for="or-style" class="form-label">Style</label>
      <input id="or-style" type="text" class="form-input" value="${escapeHtml(style)}" placeholder="e.g. journalistic"${dis} />
    </div>
    <div>
      <label for="or-min" class="form-label">Min</label>
      <input id="or-min" type="number" min="0" class="form-input" value="${escapeHtml(min)}"${dis} />
    </div>
    <div>
      <label for="or-max" class="form-label">Max</label>
      <input id="or-max" type="number" min="0" class="form-input" value="${escapeHtml(max)}"${dis} />
    </div>
    <div class="or-wide">
      <label for="or-json-schema" class="form-label">JSON schema</label>
      <textarea id="or-json-schema" class="form-textarea" placeholder='{"type":"object"}'${dis}>${escapeHtml(schema)}</textarea>
    </div>
  </div>
  <p class="form-help">Post-generation formatting + validation rules.</p>
</div>`;
}

// T8 Preview Variables: the {{token}} sample-value inputs the Test Preset
// button feeds. Populated client-side from the Custom Variables + detected
// prompt tokens; renders a placeholder note until variables exist.
function renderPreviewVariables(): string {
  return `<div class="form-group">
  <label class="form-label">Preview Variables</label>
  <div class="preview-vars" id="preset-preview-variables"></div>
  <p class="form-help">Sample values used by Test Preset to interpolate {{tokens}}.</p>
</div>`;
}

// T8 Test Preset: runs a sample generation against POST /api/admin/ai/chat
// using the User Prompt interpolated with the Preview Variables. The result
// (or error) lands in #preset-test-output.
function renderTestPreset(): string {
  return `<div class="form-group">
  <label class="form-label">Test Preset</label>
  <div class="toolbar">
    <button type="button" id="preset-test-run" class="btn btn-secondary">Run sample generation</button>
  </div>
  <pre class="test-output" id="preset-test-output" hidden aria-live="polite"></pre>
  <p class="form-help">Generates a sample with the current prompt + preview variables.</p>
</div>`;
}

// T4 image options: hero_image + above_subheadline_image. Each enabled field
// reveals a user-prompt box; the prompts persist at
// content_mapping.image_prompts.{hero_image,above_subheadline_image}. Pre-fills
// from a stored content_mapping.image_prompts object on edit.
function renderImageOptions(
  mapping: string | null | undefined,
  dis: string,
): string {
  let prompts: Record<string, unknown> = {};
  if (mapping) {
    try {
      const parsed = JSON.parse(mapping);
      const ip = parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>).image_prompts
        : null;
      if (ip && typeof ip === "object") {
        prompts = ip as Record<string, unknown>;
      }
    } catch {
      prompts = {};
    }
  }
  const items = IMAGE_PROMPT_FIELDS.map(([field, label]) => {
    const raw = prompts[field];
    const enabled = typeof raw === "string";
    const promptText = typeof raw === "string" ? raw : "";
    const checked = enabled ? " checked" : "";
    const hidden = enabled ? "" : " hidden";
    return `<div class="img-opt">
  <label class="img-opt-toggle"><input type="checkbox" class="img-opt-field" data-image="${escapeHtml(field)}" id="imgopt-${escapeHtml(field)}"${checked}${dis} /> ${escapeHtml(label)}</label>
  <textarea class="img-opt-prompt form-textarea" data-image-prompt="${escapeHtml(field)}" id="imgprompt-${escapeHtml(field)}" placeholder="Image prompt for ${escapeHtml(label.toLowerCase())}"${hidden}${dis}>${escapeHtml(promptText)}</textarea>
</div>`;
  }).join("");
  return `<div class="form-group">
  <label class="form-label">Image options</label>
  <div class="image-options" id="preset-image-options">${items}</div>
  <p class="form-help">Enable an image field to reveal its prompt; saved as content_mapping.image_prompts and generated via /api/admin/ai/image.</p>
</div>`;
}

// Reference preset form body (Name/Description/Category select/System+User
// prompts/{{var}} chips/content-map + model selects). AC3: presetFormPage
// composes the presets screen via renderPresets so the upgraded form is wired
// into the live template the route emits.
export function renderPresets(preset: PresetFormEntry | null): string {
  const isEdit = preset !== null;
  const isSystem = isEdit && preset.is_system === 1;
  const presetId = isEdit ? escapeHtml(preset.id) : "";
  // System presets: the write handler only accepts the is_active toggle
  // (403 otherwise), so every other control renders disabled.
  const dis = isSystem ? " disabled" : "";
  const systemNotice = isSystem
    ? `<p class="alert alert-warning">System preset — only the Active toggle can be changed.</p>`
    : "";
  const deleteButton = isEdit && !isSystem
    ? `<button type="button" id="preset-delete" class="btn btn-danger">Delete</button>`
    : "";
  const activeChecked = !isEdit || preset.is_active !== 0 ? " checked" : "";
  const userPrompt = isEdit
    ? escapeHtml(preset.user_prompt_template ?? preset.prompt_template)
    : "";
  return `<div class="card">
${systemNotice}<form id="preset-form" data-preset-id="${presetId}">
  <div class="preset-form-grid">
  <div class="form-group">
    <label for="preset-name" class="form-label">Name <span class="required">*</span></label>
    <input id="preset-name" name="name" type="text" class="form-input" value="${isEdit ? escapeHtml(preset.name) : ""}" required${dis} />
    <p class="form-help">A human label for this preset. The slug is derived automatically.</p>
  </div>
  <div class="form-group">
    <label for="preset-slug" class="form-label">Slug</label>
    <input id="preset-slug" name="slug" type="text" class="form-input" value="${isEdit ? escapeHtml(preset.slug) : ""}" required${dis} />
  </div>
  <div class="form-group">
    <label for="preset-description" class="form-label">Description</label>
    <textarea id="preset-description" name="description" class="form-textarea"${dis}>${isEdit ? escapeHtml(preset.description) : ""}</textarea>
  </div>
  <div class="form-group">
    <label for="preset-category" class="form-label">Category <span class="required">*</span></label>
    <select id="preset-category" name="category" class="form-select" required${dis}>${renderCategoryOptions(isEdit ? preset.category : null)}</select>
    <p class="form-help">Use-case category — the routing key generation selects this preset by.</p>
  </div>
  <div class="form-group span-2">
    <label for="preset-system-prompt" class="form-label">System Prompt</label>
    <textarea id="preset-system-prompt" name="system_prompt_template" class="form-textarea" data-prompt-field${dis}>${isEdit ? escapeHtml(preset.system_prompt_template) : ""}</textarea>
  </div>
  <div class="form-group span-2">
    <label for="preset-user-prompt" class="form-label">User Prompt</label>
    <textarea id="preset-user-prompt" name="user_prompt_template" class="form-textarea" data-prompt-field${dis}>${userPrompt}</textarea>
  </div>
  <div class="span-2">${renderVariableChips(dis)}</div>
  <div class="span-2">${renderCustomVariables(isEdit ? preset.variables_schema : null, dis)}</div>
  <div class="span-2">${renderOutputRules(isEdit ? preset.output_rules : null, dis)}</div>
  <div class="span-2">${renderContentMap(isEdit ? preset.content_mapping : null, dis)}</div>
  <div class="span-2">${renderImageOptions(isEdit ? preset.content_mapping : null, dis)}</div>
  <div>${renderPreviewVariables()}</div>
  <div>${renderTestPreset()}</div>
  <div class="form-group">
    <label for="preset-text-model" class="form-label">Text model</label>
    <select id="preset-text-model" name="text_model" class="form-select"${dis}>${renderModelOptions(SUPPORTED_TEXT_MODELS, isEdit ? preset.text_model : DEFAULT_TEXT_MODEL)}</select>
  </div>
  <div class="form-group">
    <label for="preset-image-model" class="form-label">Image model</label>
    <select id="preset-image-model" name="image_model" class="form-select"${dis}>${renderModelOptions(SUPPORTED_IMAGE_MODELS, isEdit ? preset.image_model : DEFAULT_IMAGE_MODEL)}</select>
  </div>
  <div class="form-group">
    <label class="form-label" for="preset-is-active"><input id="preset-is-active" name="is_active" type="checkbox"${activeChecked} /> Active</label>
  </div>
  </div>
  <p id="preset-form-error" class="alert alert-error" hidden role="alert"></p>
  <div class="toolbar">
    <button type="submit" class="btn btn-primary">${isEdit ? "Save preset" : "Create preset"}</button>
    <a href="/admin/presets" class="btn btn-secondary">Cancel</a>
    ${deleteButton}
  </div>
</form>
</div>`;
}

export function presetFormPage(
  preset: PresetFormEntry | null,
  branding: PresetsBranding = {},
): string {
  const isEdit = preset !== null;
  const title = isEdit ? "Edit AI Preset" : "New AI Preset";
  return adminLayout({
    title,
    activePath: "/admin/presets",
    userEmail: branding.userEmail,
    content: renderPresets(preset),
    styles: PRESET_FORM_STYLES,
    scripts: PRESET_FORM_SCRIPT,
  });
}
