// Admin AI Presets templates.
// presetsListPage — list of registered AI presets (id, label, model,
// scope) with a "+ New Preset" toolbar action; each row links to the
// /admin/presets/:id editor.
// presetFormPage — T33 [B12] create/edit form for prompt_presets rows.
// Model selects are populated ONLY from the SUPPORTED_*_MODELS registry
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

export interface PresetListEntry {
  id?: string;
  label: string;
  model?: string;
  scope?: string;
  description?: string;
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
}

export interface PresetsBranding {
  userEmail?: string;
}

function renderPresetRow(p: PresetListEntry): string {
  const id = escapeHtml(p.id ?? "");
  const label = escapeHtml(p.label);
  const model = escapeHtml(p.model ?? "");
  const scope = escapeHtml(p.scope ?? "");
  const description = escapeHtml(p.description ?? "");
  const labelCell = id !== ""
    ? `<a href="/admin/presets/${id}">${label}</a>`
    : label;
  return `<tr data-preset-id="${id}">
  <td>${labelCell}</td>
  <td>${model}</td>
  <td>${scope}</td>
  <td>${description}</td>
</tr>`;
}

function renderPresetsTable(presets: ReadonlyArray<PresetListEntry>): string {
  const rows = presets.length === 0
    ? `<tr><td colspan="4" class="empty-state">No presets registered yet</td></tr>`
    : presets.map(renderPresetRow).join("");
  return `<div class="card">
  <div class="table-wrapper">
    <table class="table presets-list" aria-label="AI presets list">
      <thead><tr>
        <th scope="col">Label</th>
        <th scope="col">Model</th>
        <th scope="col">Scope</th>
        <th scope="col">Description</th>
      </tr></thead>
      <tbody id="presets-list-body" data-empty="No presets registered yet">${rows}</tbody>
    </table>
  </div>
</div>`;
}

function renderListToolbar(): string {
  return `<div class="toolbar">
  <a href="/admin/presets/new" class="btn btn-primary">+ New Preset</a>
</div>`;
}

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

// ES5-only inline submit script (var/function/promise chains — no
// const/let/arrow/optional-chaining). New mode (empty data-preset-id)
// POSTs /api/admin/ai/presets; edit mode PUTs
// /api/admin/ai/presets/:id. The submit button is disabled while the
// request is in flight and re-enabled on both branches; errors land in
// the #preset-form-error alert. Delete confirms, DELETEs, then returns
// to the list.
const PRESET_FORM_SCRIPT = '(function(){'
  + 'var form=document.getElementById("preset-form");'
  + 'if(!form){return;}'
  + 'var errorEl=document.getElementById("preset-form-error");'
  + 'function setError(msg){if(errorEl){errorEl.hidden=!msg;errorEl.textContent=msg||"";}}'
  + 'function fieldValue(id){var el=document.getElementById(id);return el?el.value:"";}'
  + 'form.addEventListener("submit",function(e){'
  + 'e.preventDefault();'
  + 'setError("");'
  + 'var presetId=form.getAttribute("data-preset-id")||"";'
  + 'var isEdit=presetId!=="";'
  + 'var activeEl=document.getElementById("preset-is-active");'
  + 'var body={slug:fieldValue("preset-slug"),prompt_template:fieldValue("preset-prompt-template"),category:fieldValue("preset-category")||null,variables:fieldValue("preset-variables")||null,text_model:fieldValue("preset-text-model"),image_model:fieldValue("preset-image-model"),is_active:(activeEl&&activeEl.checked)?1:0};'
  + 'var url=isEdit?"/api/admin/ai/presets/"+encodeURIComponent(presetId):"/api/admin/ai/presets";'
  + 'var method=isEdit?"PUT":"POST";'
  + 'var submit=form.querySelector("button[type=submit]");'
  + 'if(submit){submit.disabled=true;}'
  + 'fetch(url,{method:method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body),credentials:"same-origin"})'
  + '.then(function(r){return r.json().then(function(j){return{ok:r.ok,status:r.status,body:j};},function(){return{ok:r.ok,status:r.status,body:null};});})'
  + '.then(function(res){'
  + 'if(submit){submit.disabled=false;}'
  + 'if(res.ok){window.location.href="/admin/presets";}'
  + 'else{setError((res.body&&res.body.error)||("Error: "+res.status));}'
  + '})'
  + '.catch(function(){if(submit){submit.disabled=false;}setError("Network error");});'
  + '});'
  + 'var del=document.getElementById("preset-delete");'
  + 'if(del){del.addEventListener("click",function(){'
  + 'var presetId=form.getAttribute("data-preset-id")||"";'
  + 'if(!presetId){return;}'
  + 'if(!window.confirm("Delete this preset?")){return;}'
  + 'setError("");'
  + 'del.disabled=true;'
  + 'fetch("/api/admin/ai/presets/"+encodeURIComponent(presetId),{method:"DELETE",credentials:"same-origin"})'
  + '.then(function(r){'
  + 'if(r.ok){window.location.href="/admin/presets";return;}'
  + 'del.disabled=false;'
  + 'return r.json().then(function(j){setError((j&&j.error)||("Error: "+r.status));},function(){setError("Error: "+r.status);});'
  + '})'
  + '.catch(function(){del.disabled=false;setError("Network error");});'
  + '});}'
  + '}());';

export function presetFormPage(
  preset: PresetFormEntry | null,
  branding: PresetsBranding = {},
): string {
  const isEdit = preset !== null;
  const isSystem = isEdit && preset.is_system === 1;
  const title = isEdit ? "Edit AI Preset" : "New AI Preset";
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
  const content = `<div class="card">
${systemNotice}<form id="preset-form" data-preset-id="${presetId}">
  <div class="form-group">
    <label for="preset-slug" class="form-label">Slug</label>
    <input id="preset-slug" name="slug" type="text" class="form-input" value="${isEdit ? escapeHtml(preset.slug) : ""}" required${dis} />
  </div>
  <div class="form-group">
    <label for="preset-category" class="form-label">Category</label>
    <input id="preset-category" name="category" type="text" class="form-input" value="${isEdit ? escapeHtml(preset.category) : ""}"${dis} />
  </div>
  <div class="form-group">
    <label for="preset-prompt-template" class="form-label">Prompt template</label>
    <textarea id="preset-prompt-template" name="prompt_template" class="form-textarea" required${dis}>${isEdit ? escapeHtml(preset.prompt_template) : ""}</textarea>
  </div>
  <div class="form-group">
    <label for="preset-variables" class="form-label">Variables (JSON)</label>
    <textarea id="preset-variables" name="variables" class="form-textarea"${dis}>${isEdit ? escapeHtml(preset.variables) : ""}</textarea>
  </div>
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
  <p id="preset-form-error" class="alert alert-error" hidden role="alert"></p>
  <div class="toolbar">
    <button type="submit" class="btn btn-primary">${isEdit ? "Save preset" : "Create preset"}</button>
    <a href="/admin/presets" class="btn btn-secondary">Cancel</a>
    ${deleteButton}
  </div>
</form>
</div>`;
  return adminLayout({
    title,
    activePath: "/admin/presets",
    userEmail: branding.userEmail,
    content,
    scripts: PRESET_FORM_SCRIPT,
  });
}
