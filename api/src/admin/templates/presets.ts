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
  name: string | null;
  description: string | null;
  system_prompt_template: string | null;
  user_prompt_template: string | null;
  content_mapping: string | null;
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

// "Fields to Generate" content-mapping: which TEXT outputs a preset produces
// (legacy content-mapping :411-429). Stored as boolean flags in content_mapping.
// Image fields are NOT booleans here — they live in the Image options widget
// below and persist under content_mapping.image_prompts (each carries an
// operator-authored prompt, not just an on/off flag).
const CONTENT_MAP_FIELDS: ReadonlyArray<[string, string]> = [
  ["title", "Title"],
  ["excerpt", "Excerpt"],
  ["content", "Body content"],
  ["meta_description", "SEO meta description"],
  ["tags", "Tags"],
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
  return `<div class="form-group">
  <label class="form-label">Fields to Generate</label>
  <div class="content-map" id="preset-content-map">${items}</div>
  <p class="form-help">Select which outputs this preset generates (content-mapping).</p>
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
  <div class="form-group">
    <label for="preset-system-prompt" class="form-label">System Prompt</label>
    <textarea id="preset-system-prompt" name="system_prompt_template" class="form-textarea" data-prompt-field${dis}>${isEdit ? escapeHtml(preset.system_prompt_template) : ""}</textarea>
  </div>
  <div class="form-group">
    <label for="preset-user-prompt" class="form-label">User Prompt</label>
    <textarea id="preset-user-prompt" name="user_prompt_template" class="form-textarea" data-prompt-field${dis}>${userPrompt}</textarea>
  </div>
  ${renderVariableChips(dis)}
  ${renderContentMap(isEdit ? preset.content_mapping : null, dis)}
  ${renderImageOptions(isEdit ? preset.content_mapping : null, dis)}
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
}

// Scoped styles for the chips + content-map widgets, injected via the layout's
// `styles` slot so the shared admin layout stylesheet is untouched.
const PRESET_FORM_STYLES = `
.required{color:var(--c-error)}
.var-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:4px}
.var-chip{font-family:monospace;font-size:12px;padding:4px 10px;border:1px solid var(--c-border);border-radius:9999px;background:var(--c-bg-alt);color:var(--c-primary);cursor:pointer}
.var-chip:hover{background:var(--c-primary-light)}
.var-chip:disabled{opacity:.5;cursor:not-allowed}
.detected-vars{font-family:monospace;color:var(--c-text)}
.content-map{display:flex;flex-wrap:wrap;gap:12px}
.cmap-item{display:flex;align-items:center;gap:6px;font-weight:400}
.image-options{display:flex;flex-direction:column;gap:12px}
.img-opt{display:flex;flex-direction:column;gap:6px}
.img-opt-toggle{display:flex;align-items:center;gap:6px;font-weight:400}
.img-opt-prompt[hidden]{display:none}
`;

// ES5-only inline submit script (var/function/promise chains — no
// const/let/arrow/optional-chaining/template-literals). New mode (empty
// data-preset-id) POSTs /api/admin/ai/presets; edit mode PUTs
// /api/admin/ai/presets/:id. Name auto-derives the slug (until the slug is
// edited); {{var}} chips insert into the focused prompt; variables are
// auto-detected from both prompts; the content-map checkboxes serialize to
// content_mapping. The submit button is disabled while in flight; errors land
// in the #preset-form-error alert. Delete confirms, DELETEs, returns to list.
const PRESET_FORM_SCRIPT = `(function(){
var form=document.getElementById("preset-form");
if(!form){return;}
var errorEl=document.getElementById("preset-form-error");
function setError(msg){if(errorEl){errorEl.hidden=!msg;errorEl.textContent=msg||"";}}
function fieldValue(id){var el=document.getElementById(id);return el?el.value:"";}
var nameEl=document.getElementById("preset-name");
var slugEl=document.getElementById("preset-slug");
if(nameEl&&slugEl){
nameEl.addEventListener("input",function(){
if(slugEl.getAttribute("data-touched")==="1"){return;}
if(window.generateSlug){slugEl.value=window.generateSlug(nameEl.value);}
});
slugEl.addEventListener("input",function(){slugEl.setAttribute("data-touched","1");});
}
var lastPrompt=document.getElementById("preset-user-prompt");
function detectVarList(){
var text=fieldValue("preset-system-prompt")+" "+fieldValue("preset-user-prompt");
var matches=text.match(/\\{\\{\\s*[\\w.-]+\\s*\\}\\}/g)||[];
var found=[];var k;
for(k=0;k<matches.length;k++){
var varName=matches[k].replace(/[{}\\s]/g,"");
if(varName&&found.indexOf(varName)<0){found.push(varName);}
}
return found;
}
function refreshDetected(){
var el=document.getElementById("preset-detected-vars");
if(!el){return;}
var list=detectVarList();
el.textContent=list.length?list.join(", "):"none";
}
var prompts=form.querySelectorAll("[data-prompt-field]");
var pi;
for(pi=0;pi<prompts.length;pi++){
(function(t){
t.addEventListener("focus",function(){lastPrompt=t;});
t.addEventListener("input",refreshDetected);
}(prompts[pi]));
}
var chips=form.querySelectorAll(".var-chip");
var ci;
for(ci=0;ci<chips.length;ci++){
chips[ci].addEventListener("click",function(e){
var chip=e.currentTarget;
var token="{{"+(chip.getAttribute("data-var")||"")+"}}";
if(lastPrompt){
var start=lastPrompt.selectionStart;
if(typeof start==="number"){
var v=lastPrompt.value;
lastPrompt.value=v.slice(0,start)+token+v.slice(lastPrompt.selectionEnd);
lastPrompt.selectionStart=lastPrompt.selectionEnd=start+token.length;
}else{lastPrompt.value=lastPrompt.value+token;}
lastPrompt.focus();
}
refreshDetected();
});
}
refreshDetected();
function collectContentMap(){
var boxes=form.querySelectorAll(".cmap-field");
var map={};var any=false;var bi;
for(bi=0;bi<boxes.length;bi++){
var f=boxes[bi].getAttribute("data-field");
if(f){map[f]=boxes[bi].checked?true:false;if(boxes[bi].checked){any=true;}}
}
var imgBoxes=form.querySelectorAll(".img-opt-field");
var imgMap={};var imgAny=false;var ib;
for(ib=0;ib<imgBoxes.length;ib++){
var key=imgBoxes[ib].getAttribute("data-image");
if(key&&imgBoxes[ib].checked){
var ta=form.querySelector('[data-image-prompt="'+key+'"]');
imgMap[key]=ta?ta.value:"";
imgAny=true;
}
}
if(imgAny){map.image_prompts=imgMap;any=true;}
return any?JSON.stringify(map):null;
}
function wireImageOptions(){
var imgBoxes=form.querySelectorAll(".img-opt-field");
var ii;
for(ii=0;ii<imgBoxes.length;ii++){
(function(box){
function sync(){
var key=box.getAttribute("data-image");
var ta=form.querySelector('[data-image-prompt="'+key+'"]');
if(ta){ta.hidden=!box.checked;}
}
box.addEventListener("change",sync);
sync();
}(imgBoxes[ii]));
}
}
wireImageOptions();
function collectVariables(){
var list=detectVarList();
return list.length?JSON.stringify(list):null;
}
form.addEventListener("submit",function(e){
e.preventDefault();
setError("");
var presetId=form.getAttribute("data-preset-id")||"";
var isEdit=presetId!=="";
var activeEl=document.getElementById("preset-is-active");
var body={name:fieldValue("preset-name")||null,slug:fieldValue("preset-slug"),description:fieldValue("preset-description")||null,category:fieldValue("preset-category")||null,system_prompt_template:fieldValue("preset-system-prompt")||null,user_prompt_template:fieldValue("preset-user-prompt")||null,variables:collectVariables(),content_mapping:collectContentMap(),text_model:fieldValue("preset-text-model"),image_model:fieldValue("preset-image-model"),is_active:(activeEl&&activeEl.checked)?1:0};
var url=isEdit?"/api/admin/ai/presets/"+encodeURIComponent(presetId):"/api/admin/ai/presets";
var method=isEdit?"PUT":"POST";
var submit=form.querySelector("button[type=submit]");
if(submit){submit.disabled=true;}
fetch(url,{method:method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body),credentials:"same-origin"})
.then(function(r){return r.json().then(function(j){return{ok:r.ok,status:r.status,body:j};},function(){return{ok:r.ok,status:r.status,body:null};});})
.then(function(res){
if(submit){submit.disabled=false;}
if(res.ok){window.location.href="/admin/presets";}
else{setError((res.body&&res.body.error)||("Error: "+res.status));}
})
.catch(function(){if(submit){submit.disabled=false;}setError("Network error");});
});
var del=document.getElementById("preset-delete");
if(del){del.addEventListener("click",function(){
var presetId=form.getAttribute("data-preset-id")||"";
if(!presetId){return;}
if(!window.confirm("Delete this preset?")){return;}
setError("");
del.disabled=true;
fetch("/api/admin/ai/presets/"+encodeURIComponent(presetId),{method:"DELETE",credentials:"same-origin"})
.then(function(r){
if(r.ok){window.location.href="/admin/presets";return;}
del.disabled=false;
return r.json().then(function(j){setError((j&&j.error)||("Error: "+r.status));},function(){setError("Error: "+r.status);});
})
.catch(function(){del.disabled=false;setError("Network error");});
});}
}());`;

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
