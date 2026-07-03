// Listicles Section editor page (design contract §10 / §12 / §13 / §23 /
// §30.5 / §30.6 / §30.9) — Phase 4.
//
//   GET /admin/listicles/sections/new       → create
//   GET /admin/listicles/sections/:id/edit  → edit
//
// Anatomy: tabs → back link → form (section_name · Section image card —
// the REUSED hero-image machinery (upload / AI presets), relabeled ·
// clickable headline → §13 Offer picker → chip · AI presets card · the rich
// content editor (the EXISTING BlockEditor with the listicle configuration))
// alongside the §30.6 CTA/Link Inventory + token-styled Section preview
// (desktop/mobile). Save drives the Phase-2 JSON API (POST/PATCH sections)
// and renders its field-keyed errors inline (§8 states; beforeunload +
// dirty-close confirm).
//
// Every script authored HERE is strict ES5. The one non-ES5 atom on the page
// is the shared `editorScripts` editor (embedded byte-identically — asserted
// by test/listicles-editor-es5.test.ts).

import { adminLayout, escapeHtml } from "../templates/layout";
import {
  renderHeroImageCard,
  heroImageScripts,
  heroImageStyles,
} from "../templates/hero-image";
import { BLOCK_EDITOR_COLOR_TOKENS, renderBlockEditorField } from "../../editor/mount";
import { editorScripts, editorStyles } from "../../editor/editor-scripts";
import {
  listicleEditorClientConfig,
  LISTICLE_HIGHLIGHTS,
  LISTICLE_TEXT_COLORS,
} from "../../editor/listicle-blocks";
import { curatedColorCss } from "../../public/listicle/layouts/default/tokens-to-css";
import {
  renderListiclesTabs,
  renderDialogShell,
  LISTICLES_STYLES,
  LST_SHARED_SCRIPT,
} from "./ui-shared";
import { renderOfferModal, OFFER_MODAL_SCRIPT, type ListiclesBranding } from "./ui-offers";
import {
  renderOfferPickerModal,
  OFFER_PICKER_SCRIPT,
  OFFER_PICKER_STYLES,
} from "./ui-offer-picker";
import type { SectionRow } from "./sections-handlers";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SectionEditorLinkInstance {
  public_id: string;
  block_id: string;
  link_role: string;
  offer_public_id: string;
  offer_name: string;
}

export interface SectionEditorPageProps {
  mode: "new" | "edit";
  section: SectionRow | null;
  linkInstances: ReadonlyArray<SectionEditorLinkInstance>;
}

// ---------------------------------------------------------------------------
// Boot payload (JSON handed to the ES5 page script)
// ---------------------------------------------------------------------------

interface ParsedImage {
  type?: string;
  media_id?: number;
  url?: string;
}

function parseImageJson(raw: string | null): ParsedImage | null {
  if (raw === null || raw.trim() === "") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as ParsedImage;
    }
  } catch {
    /* stored garbage never breaks the editor shell */
  }
  return null;
}

function parseAiSettings(raw: string | null): { preset_id?: number; prompt?: string } | null {
  if (raw === null || raw.trim() === "") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as { preset_id?: number; prompt?: string };
    }
  } catch {
    /* ignore */
  }
  return null;
}

// Serialize the boot payload so it is inert inside a <script> tag AND stays
// strict-ES5-safe (no backticks, no </script>, no U+2028/9 line breaks).
function safeBootJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/`/g, "\\u0060")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function buildBoot(props: SectionEditorPageProps): Record<string, unknown> {
  const section = props.section;
  const offerNames: Record<string, string> = {};
  let headlineOfferName = "";
  let headlineLinkInstanceId = "";
  let headlinePublicRef = "";
  for (const li of props.linkInstances) {
    if (li.offer_public_id) offerNames[li.offer_public_id] = li.offer_name;
    if (li.block_id === "__headline__") {
      headlineOfferName = li.offer_name;
      headlineLinkInstanceId = li.public_id;
      headlinePublicRef = li.offer_public_id;
    }
  }
  if (section?.headline_offer_id != null && headlineOfferName !== "") {
    offerNames[String(section.headline_offer_id)] = headlineOfferName;
  }
  return {
    mode: props.mode,
    sectionId: section?.public_id ?? "",
    config: listicleEditorClientConfig(),
    offerNames,
    headlineLinkInstanceId,
    headlinePublicRef,
    section: section
      ? {
          section_name: section.section_name,
          headline_text: section.headline_text,
          headline_offer_id: section.headline_offer_id,
          headline_offer_name: headlineOfferName,
          image: parseImageJson(section.image_json),
          ai_settings: parseAiSettings(section.ai_settings_json),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Section image card — the REUSED hero-image machinery, relabeled. The ids
// stay hero-image-* (the ES5 hero script binds to them); only user-visible
// copy changes. §10: image / GIF (an image/* upload) / AI image via presets.
// ---------------------------------------------------------------------------

function relabelSectionImage(text: string): string {
  return text
    .replace(/Hero image/g, "Section image")
    .replace(/hero image/g, "section image")
    .replace(/Apply to article/g, "Apply to section");
}

// ---------------------------------------------------------------------------
// Page styles
// ---------------------------------------------------------------------------

const SECTION_EDITOR_STYLES = `
.lst-editor-grid{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:24px;align-items:start}
@media (max-width:1200px){.lst-editor-grid{grid-template-columns:1fr}}
.lst-editor-side{position:sticky;top:76px;display:flex;flex-direction:column;gap:16px}
.lst-headline-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.lst-headline-row .form-input{flex:1;min-width:220px}
.lst-headline-toggle{display:inline-flex;gap:6px;align-items:center;font-size:13px;white-space:nowrap}
#lst-headline-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:9999px;background:var(--c-primary-light);border:1px solid var(--c-primary-light);font-size:12px;max-width:280px}
#lst-headline-chip[hidden]{display:none}
#lst-headline-chip .lst-chipname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
#lst-headline-chip button{border:0;background:none;color:var(--c-primary);cursor:pointer;font-size:12px;text-decoration:underline}
.lst-inv-table{width:100%;border-collapse:collapse;font-size:12px}
.lst-inv-table th,.lst-inv-table td{padding:4px 6px;border-bottom:1px solid var(--c-border);text-align:left;vertical-align:top}
.lst-inv-table th{font-weight:600;color:var(--c-muted);white-space:nowrap}
.lst-inv-id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:var(--c-muted);word-break:break-all}
.lst-inv-missing td{background:#fef2f2}
.lst-inv-state-ok{color:var(--c-success);font-weight:600}
.lst-inv-state-missing{color:var(--c-error);font-weight:600}
.lst-inv-actions{display:flex;gap:2px;flex-wrap:wrap}
.lst-inv-btn{border:1px solid var(--c-border);background:var(--c-bg);border-radius:4px;padding:1px 5px;font-size:11px;cursor:pointer}
.lst-inv-btn:hover{border-color:var(--c-primary);color:var(--c-primary)}
.lst-inv-toolbar{display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
.lst-inv-toolbar select{max-width:180px}
.lst-preview-toolbar{display:flex;gap:8px;align-items:center;margin-bottom:8px}
.lst-preview-frame-wrap{border:1px solid var(--c-border);border-radius:8px;overflow:hidden;background:#f3f4f6;display:flex;justify-content:center}
#lst-section-preview{border:0;width:100%;height:480px;background:#fff;display:block}
#lst-section-preview.lst-preview-mobile{width:390px}
.lst-preview-note{font-size:11px;color:var(--c-muted);margin-top:6px}
.lst-editor-actions{display:flex;gap:8px;align-items:center;margin-top:16px}
#lst-editor-errors ul{margin:4px 0 4px 18px}
/* The listicle block menu carries ~30 entries (types + 17 §30.5 presets):
   open it BELOW the add-block button, cap + scroll it, and lift it above the
   sticky admin header / side column. Page-scoped — other pages untouched. */
.lst-editor-main .block-menu{bottom:auto;top:100%;max-height:420px;overflow-y:auto;z-index:200}
`;

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

function fieldError(name: string): string {
  return `<span class="form-error" data-error-for="${name}" hidden></span>`;
}

function renderHeadlineCard(): string {
  return `<section class="card" id="lst-headline-card">
  <div class="card-header"><h3 class="card-title">Headline</h3></div>
  <div class="form-group">
    <label for="lst-headline-text" class="form-label">Headline text *</label>
    <div class="lst-headline-row">
      <input id="lst-headline-text" name="headline_text" type="text" class="form-input" required aria-required="true" placeholder="e.g. 1. The Senior Savings Program" />
      <label class="lst-headline-toggle" for="lst-headline-clickable">
        <input type="checkbox" id="lst-headline-clickable" /> Clickable headline
      </label>
      <span id="lst-headline-chip" hidden>
        <span class="lst-chipname" id="lst-headline-chip-name"></span>
        <button type="button" id="lst-headline-change">Change</button>
        <button type="button" id="lst-headline-remove">Remove</button>
      </span>
    </div>
    <input type="hidden" id="lst-headline-offer-id" name="headline_offer_id" value="" />
    ${fieldError("headline_text")}
    ${fieldError("headline_offer_id")}
    <p class="form-help">A clickable headline is a governed link: it references an Offer through the Offer modal — never a URL (§13).</p>
  </div>
</section>`;
}

function renderAiPresetsCard(): string {
  return `<section class="card" id="lst-ai-card">
  <div class="card-header"><h3 class="card-title">AI section</h3></div>
  <div class="form-group">
    <label for="lst-ai-preset" class="form-label">Preset</label>
    <select id="lst-ai-preset" class="form-select" aria-label="AI preset">
      <option value="">No preset</option>
    </select>
  </div>
  <div class="form-group">
    <label for="lst-ai-prompt" class="form-label">Prompt</label>
    <textarea id="lst-ai-prompt" class="form-textarea" rows="2" placeholder="Optional guidance stored with the section (ai_settings)…"></textarea>
    ${fieldError("ai_settings")}
  </div>
</section>`;
}

function renderInventoryPanel(): string {
  return `<section class="card" id="lst-cta-inventory-card">
  <div class="card-header"><h3 class="card-title">CTA / Link Inventory</h3></div>
  <div class="lst-inv-toolbar">
    <select id="lst-bulk-from" class="form-select" aria-label="Offer to replace"><option value="">Bulk replace: choose Offer…</option></select>
    <button type="button" id="lst-bulk-replace" class="btn btn-sm btn-outline">Replace across Section…</button>
  </div>
  <div class="table-wrapper">
    <table class="lst-inv-table" aria-label="Governed links inventory">
      <thead><tr>
        <th>#</th><th>Block</th><th>Role</th><th>Text</th><th>Offer</th><th>Style</th><th>Link id</th><th>State</th><th>Actions</th>
      </tr></thead>
      <tbody id="lst-inv-body"></tbody>
    </table>
  </div>
  <p class="form-help">Every governed link/button/image/text-CTA, in document order, keyed by its <code>link_instance_id</code> (§30.6). Ids mint on save.</p>
</section>`;
}

function renderPreviewPanel(): string {
  return `<section class="card" id="lst-preview-card">
  <div class="card-header"><h3 class="card-title">Section preview</h3></div>
  <div class="lst-preview-toolbar" role="group" aria-label="Preview viewport">
    <button type="button" id="lst-preview-desktop" class="btn btn-sm btn-primary" aria-pressed="true">Desktop</button>
    <button type="button" id="lst-preview-mobile" class="btn btn-sm btn-outline" aria-pressed="false">Mobile</button>
    <span id="lst-preview-status" class="form-status" role="status" aria-live="polite"></span>
  </div>
  <div class="lst-preview-frame-wrap">
    <iframe id="lst-section-preview" title="Section preview (default layout tokens)" sandbox=""></iframe>
  </div>
  <p class="lst-preview-note">Rendered inside the token-derived default SectionWrapper (§30.6). Content-accurate; pixel parity is gated on the §31.0 reference captures (Phase 6).</p>
</section>`;
}

function renderEditorForm(props: SectionEditorPageProps): string {
  const section = props.section;
  const name = section?.section_name ?? "";
  const image = section ? parseImageJson(section.image_json) : null;
  const imageCard = relabelSectionImage(
    renderHeroImageCard(image?.media_id ?? null, image?.url ?? null),
  );
  return `<form id="lst-section-form" novalidate data-mode="${props.mode}" data-section-id="${escapeHtml(section?.public_id ?? "")}">
  <p id="lst-editor-toperror" class="alert alert-error" hidden role="alert"></p>
  <div id="lst-editor-errors" hidden></div>
  <p id="lst-editor-status" class="form-status" role="status" aria-live="polite"></p>
  <div class="lst-editor-grid">
    <div class="lst-editor-main">
      <section class="card">
        <div class="form-group">
          <label for="lst-section-name" class="form-label">Section name *</label>
          <input id="lst-section-name" name="section_name" type="text" class="form-input" required aria-required="true" value="${escapeHtml(name)}" placeholder="Internal name, e.g. Senior Savings — intro offer" />
          ${fieldError("section_name")}
        </div>
      </section>
      ${imageCard}
      ${renderHeadlineCard()}
      ${renderAiPresetsCard()}
      <section class="card" id="lst-content-card">
        <div class="card-header"><h3 class="card-title">Content</h3></div>
        ${renderBlockEditorField(section?.content_json ?? "")}
        ${fieldError("content_json")}
      </section>
      <div class="lst-editor-actions">
        <button type="submit" id="lst-section-save" class="btn btn-primary">${props.mode === "edit" ? "Save Section" : "Create Section"}</button>
        <a href="/admin/listicles/sections" id="lst-section-cancel" class="btn btn-secondary">Cancel</a>
      </div>
    </div>
    <div class="lst-editor-side">
      ${renderInventoryPanel()}
      ${renderPreviewPanel()}
    </div>
  </div>
</form>`;
}

// ---------------------------------------------------------------------------
// Page script (strict ES5)
// ---------------------------------------------------------------------------

const SECTION_EDITOR_SCRIPT = `
(function () {
  var boot = window._lstEditorBoot || {};
  var form = document.getElementById('lst-section-form');
  if (!form) { return; }
  var getJson = window.lstUi.getJson;
  var mode = form.getAttribute('data-mode') || 'new';
  var sectionId = form.getAttribute('data-section-id') || '';
  var dirty = false;
  var saving = false;

  // Seed the shared offer-name cache before the editor renders its chips.
  window.lstOfferNames = window.lstOfferNames || {};
  var seedNames = boot.offerNames || {};
  var k;
  for (k in seedNames) {
    if (Object.prototype.hasOwnProperty.call(seedNames, k)) { window.lstOfferNames[k] = seedNames[k]; }
  }

  var nameInput = document.getElementById('lst-section-name');
  var headlineInput = document.getElementById('lst-headline-text');
  var headlineToggle = document.getElementById('lst-headline-clickable');
  var headlineChip = document.getElementById('lst-headline-chip');
  var headlineChipName = document.getElementById('lst-headline-chip-name');
  var headlineChange = document.getElementById('lst-headline-change');
  var headlineRemove = document.getElementById('lst-headline-remove');
  var headlineOfferInput = document.getElementById('lst-headline-offer-id');
  var topError = document.getElementById('lst-editor-toperror');
  var errorList = document.getElementById('lst-editor-errors');
  var statusEl = document.getElementById('lst-editor-status');
  var saveBtn = document.getElementById('lst-section-save');
  var cancelLink = document.getElementById('lst-section-cancel');
  var aiPresetSelect = document.getElementById('lst-ai-preset');
  var aiPromptInput = document.getElementById('lst-ai-prompt');
  var invBody = document.getElementById('lst-inv-body');
  var bulkFromSelect = document.getElementById('lst-bulk-from');
  var bulkReplaceBtn = document.getElementById('lst-bulk-replace');
  var previewFrame = document.getElementById('lst-section-preview');
  var previewStatus = document.getElementById('lst-preview-status');
  var previewDesktopBtn = document.getElementById('lst-preview-desktop');
  var previewMobileBtn = document.getElementById('lst-preview-mobile');
  var imageSource = ''; // '', 'image', 'ai_generated' — §5.2 image.type tracking

  function setText(el, msg) {
    if (!el) { return; }
    while (el.firstChild) { el.removeChild(el.firstChild); }
    if (msg) { el.appendChild(document.createTextNode(msg)); }
  }
  function setStatus(msg) { setText(statusEl, msg); }
  function setTopError(msg) { if (topError) { topError.hidden = !msg; setText(topError, msg || ''); } }
  function headlineOfferName(ref) {
    var names = window.lstOfferNames || {};
    return names[String(ref)] || String(ref);
  }

  // The headline stores the NUMERIC offer id (the §23 API contract) but the
  // inventory identifies offers by their off_… public id (one identity per
  // offer — §30.6 bulk replace must cover the headline too).
  var headlinePublicRef = boot.headlinePublicRef || '';

  // ---- prefill (edit mode) --------------------------------------------------
  var bootSection = boot.section || null;
  if (bootSection) {
    if (headlineInput) { headlineInput.value = bootSection.headline_text || ''; }
    if (bootSection.headline_offer_id) {
      if (headlineOfferInput) { headlineOfferInput.value = String(bootSection.headline_offer_id); }
      if (headlineToggle) { headlineToggle.checked = true; }
      if (headlineChip) { headlineChip.hidden = false; }
      setText(headlineChipName, bootSection.headline_offer_name || headlineOfferName(bootSection.headline_offer_id));
    }
    if (bootSection.image && bootSection.image.type) { imageSource = bootSection.image.type; }
    if (bootSection.ai_settings) {
      if (aiPromptInput) { aiPromptInput.value = bootSection.ai_settings.prompt || ''; }
    }
  }

  // ---- §10 clickable headline → §13 Offer picker → chip ----------------------
  function clearHeadlineOffer() {
    headlinePublicRef = '';
    if (headlineOfferInput) { headlineOfferInput.value = ''; }
    if (headlineChip) { headlineChip.hidden = true; }
    if (headlineToggle) { headlineToggle.checked = false; }
    dirty = true;
    refreshPanels();
  }
  function pickHeadlineOffer() {
    if (!window.lstOfferPicker) { return; }
    window.lstOfferPicker.open({
      title: 'Link the headline to an Offer',
      onSelect: function (offer) {
        window.lstOfferNames = window.lstOfferNames || {};
        window.lstOfferNames[String(offer.id)] = offer.offer_name;
        window.lstOfferNames[offer.public_id] = offer.offer_name;
        headlinePublicRef = offer.public_id || '';
        if (headlineOfferInput) { headlineOfferInput.value = String(offer.id); }
        if (headlineToggle) { headlineToggle.checked = true; }
        if (headlineChip) { headlineChip.hidden = false; }
        setText(headlineChipName, offer.offer_name);
        dirty = true;
        refreshPanels();
      }
    });
  }
  if (headlineToggle) {
    headlineToggle.addEventListener('change', function () {
      if (headlineToggle.checked) {
        if (!headlineOfferInput || headlineOfferInput.value === '') {
          headlineToggle.checked = false; // set only through the picker
          pickHeadlineOffer();
        }
      } else {
        clearHeadlineOffer();
      }
    });
  }
  if (headlineChange) { headlineChange.addEventListener('click', pickHeadlineOffer); }
  if (headlineRemove) { headlineRemove.addEventListener('click', clearHeadlineOffer); }

  // ---- §10 AI presets card ----------------------------------------------------
  var bootAi = bootSection && bootSection.ai_settings ? bootSection.ai_settings : null;
  if (aiPresetSelect) {
    getJson('GET', '/api/admin/ai/presets?active_only=true&per_page=200').then(function (res) {
      if (!res.ok || !res.body) { return; }
      var rows = res.body.items || res.body.presets || [];
      var i, row, opt;
      for (i = 0; i < rows.length; i++) {
        row = rows[i];
        opt = document.createElement('option');
        opt.value = String(row.id);
        opt.appendChild(document.createTextNode(row.name || ('Preset #' + row.id)));
        aiPresetSelect.appendChild(opt);
      }
      if (bootAi && bootAi.preset_id) { aiPresetSelect.value = String(bootAi.preset_id); }
    }).catch(function () { /* presets are optional; the card degrades quietly */ });
  }

  // ---- §5.2 image.type tracking (upload vs AI) --------------------------------
  var uploadInput = document.getElementById('hero-image-upload');
  if (uploadInput) { uploadInput.addEventListener('change', function () { imageSource = 'image'; dirty = true; }); }
  var aiApplyBtn = document.getElementById('hero-ai-apply-btn');
  if (aiApplyBtn) { aiApplyBtn.addEventListener('click', function () { imageSource = 'ai_generated'; dirty = true; }, true); }

  function collectImage() {
    var idEl = document.getElementById('hero-image-input');
    var previewEl = document.getElementById('hero-image-preview');
    var mediaId = idEl && idEl.value ? parseInt(idEl.value, 10) : NaN;
    var url = previewEl ? (previewEl.getAttribute('src') || '') : '';
    if (isNaN(mediaId) && url === '') { return null; }
    var type = imageSource;
    if (!type) { type = /\\.gif(\\?|$)/i.test(url) ? 'gif' : 'image'; }
    if (type === 'image' && /\\.gif(\\?|$)/i.test(url)) { type = 'gif'; }
    var image = { type: type };
    if (!isNaN(mediaId)) { image.media_id = mediaId; }
    if (url !== '') { image.url = url; }
    return image;
  }

  // ---- CTA / Link Inventory (§30.6) -------------------------------------------
  function governedRows() {
    var rows = [];
    var headlineNumeric = headlineOfferInput ? headlineOfferInput.value : '';
    if (headlineNumeric !== '') {
      rows.push({
        blockId: '__headline__', itemIndex: null, role: 'headline',
        text: headlineInput ? headlineInput.value : '',
        offer: headlinePublicRef || headlineNumeric,
        styleId: '', linkInstanceId: (boot.headlineLinkInstanceId || ''), missing: false, headline: true
      });
    }
    var editor = window.blockEditor;
    if (editor && editor.getGovernedElements) {
      var els = editor.getGovernedElements();
      var i;
      for (i = 0; i < els.length; i++) { rows.push(els[i]); }
    }
    return rows;
  }

  function invActionButton(label, title, action, row) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lst-inv-btn';
    btn.title = title;
    btn.setAttribute('data-inv-action', action);
    btn.setAttribute('data-block-id', row.blockId);
    btn.setAttribute('data-item-index', row.itemIndex === null || row.itemIndex === undefined ? '' : String(row.itemIndex));
    btn.appendChild(document.createTextNode(label));
    return btn;
  }

  var lastInventoryKey = '';
  function renderInventory() {
    if (!invBody) { return; }
    var rows = governedRows();
    // Skip the DOM rebuild when the governed model is UNCHANGED. This is a
    // correctness fix, not an optimization: pressing an inventory action
    // button blurs a focused editor field, whose 'change' event re-syncs the
    // model and refreshes this panel — rebuilding identical rows mid-click
    // would detach the pressed button and swallow the action.
    var key = '';
    var i, row;
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      key += [row.blockId, row.itemIndex, row.role, row.text, row.offer,
        headlineOfferName(row.offer), row.styleId, row.linkInstanceId, row.missing].join('\\u0001') + '\\u0002';
    }
    if (key === lastInventoryKey) { return; }
    lastInventoryKey = key;
    while (invBody.firstChild) { invBody.removeChild(invBody.firstChild); }
    var offers = {};
    var tr, td, actions;
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      if (row.offer) { offers[row.offer] = 1; }
      tr = document.createElement('tr');
      if (row.missing) { tr.className = 'lst-inv-missing'; }
      tr.setAttribute('data-inv-block', row.blockId);

      td = document.createElement('td');
      td.appendChild(document.createTextNode(String(i + 1)));
      tr.appendChild(td);

      td = document.createElement('td');
      td.appendChild(document.createTextNode(row.headline ? 'headline' : ('#' + (row.blockIndex + 1) + (row.itemIndex !== null && row.itemIndex !== undefined ? '.' + (row.itemIndex + 1) : ''))));
      tr.appendChild(td);

      td = document.createElement('td');
      td.appendChild(document.createTextNode(row.role));
      tr.appendChild(td);

      td = document.createElement('td');
      td.appendChild(document.createTextNode((row.text || '').slice(0, 40)));
      tr.appendChild(td);

      td = document.createElement('td');
      td.appendChild(document.createTextNode(row.offer ? headlineOfferName(row.offer) : '—'));
      tr.appendChild(td);

      td = document.createElement('td');
      td.appendChild(document.createTextNode(row.styleId || '—'));
      tr.appendChild(td);

      td = document.createElement('td');
      td.className = 'lst-inv-id';
      td.appendChild(document.createTextNode(row.linkInstanceId || '(on save)'));
      tr.appendChild(td);

      td = document.createElement('td');
      td.className = row.missing ? 'lst-inv-state-missing' : 'lst-inv-state-ok';
      td.appendChild(document.createTextNode(row.missing ? 'Missing Offer' : 'OK'));
      tr.appendChild(td);

      td = document.createElement('td');
      actions = document.createElement('span');
      actions.className = 'lst-inv-actions';
      if (row.headline) {
        actions.appendChild(invActionButton('Offer', 'Replace the headline Offer', 'headline-offer', row));
        actions.appendChild(invActionButton('×', 'Remove the headline link', 'headline-remove', row));
      } else {
        actions.appendChild(invActionButton('Offer', 'Edit / replace this Offer', 'offer', row));
        if (row.role === 'choice_button' || row.role === 'button' || row.role === 'final_text_cta' || row.role === 'linked_image') {
          actions.appendChild(invActionButton('⧉', 'Duplicate', 'dup', row));
        }
        actions.appendChild(invActionButton('↑', 'Move up', 'up', row));
        actions.appendChild(invActionButton('↓', 'Move down', 'down', row));
        actions.appendChild(invActionButton('→', 'Jump to block', 'jump', row));
      }
      td.appendChild(actions);
      tr.appendChild(td);
      invBody.appendChild(tr);
    }
    // Bulk-replace source options: the distinct Offers used right now.
    if (bulkFromSelect) {
      while (bulkFromSelect.options.length > 1) { bulkFromSelect.remove(1); }
      var ref, opt;
      for (ref in offers) {
        if (!Object.prototype.hasOwnProperty.call(offers, ref)) { continue; }
        opt = document.createElement('option');
        opt.value = ref;
        opt.appendChild(document.createTextNode(headlineOfferName(ref)));
        bulkFromSelect.appendChild(opt);
      }
    }
  }

  if (invBody) {
    invBody.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) { return; }
      var btn = t.closest('[data-inv-action]');
      if (!btn) { return; }
      var action = btn.getAttribute('data-inv-action');
      var blockId = btn.getAttribute('data-block-id');
      var itemIndex = btn.getAttribute('data-item-index');
      var editor = window.blockEditor;
      if (action === 'headline-offer') { pickHeadlineOffer(); return; }
      if (action === 'headline-remove') { clearHeadlineOffer(); return; }
      if (!editor) { return; }
      if (action === 'offer') { editor.setGovernedOffer(blockId, itemIndex === '' ? null : itemIndex); }
      else if (action === 'dup') { editor.duplicateGoverned(blockId, itemIndex === '' ? null : itemIndex); }
      else if (action === 'up') { editor.moveGoverned(blockId, itemIndex === '' ? null : itemIndex, -1); }
      else if (action === 'down') { editor.moveGoverned(blockId, itemIndex === '' ? null : itemIndex, 1); }
      else if (action === 'jump') { editor.jumpToBlock(blockId); }
    });
  }

  if (bulkReplaceBtn) {
    bulkReplaceBtn.addEventListener('click', function () {
      var from = bulkFromSelect ? bulkFromSelect.value : '';
      if (from === '') {
        if (window.showToast) { window.showToast('Choose the Offer to replace first', 'warning'); }
        return;
      }
      if (!window.lstOfferPicker) { return; }
      window.lstOfferPicker.open({
        title: 'Replace "' + headlineOfferName(from) + '" across the Section',
        onSelect: function (offer) {
          window.lstOfferNames = window.lstOfferNames || {};
          window.lstOfferNames[offer.public_id] = offer.offer_name;
          window.lstOfferNames[String(offer.id)] = offer.offer_name;
          var editor = window.blockEditor;
          if (editor) { editor.replaceOfferEverywhere(from, offer); }
          // The clickable headline participates in the bulk replace too.
          if (headlineOfferInput && headlineOfferInput.value !== '' &&
              (headlinePublicRef === from || headlineOfferInput.value === from)) {
            headlinePublicRef = offer.public_id || '';
            headlineOfferInput.value = String(offer.id);
            setText(headlineChipName, offer.offer_name);
          }
          dirty = true;
          refreshPanels();
        }
      });
    });
  }

  // ---- Section preview (§30.6) --------------------------------------------------
  var previewTimer = null;
  var previewSeq = 0;
  function schedulePreview() {
    if (previewTimer) { window.clearTimeout(previewTimer); }
    previewTimer = window.setTimeout(runPreview, 700);
  }
  function runPreview() {
    if (!previewFrame) { return; }
    var contentInput = document.getElementById('content_json');
    var contentJson = contentInput ? contentInput.value : '';
    var seq = ++previewSeq;
    setText(previewStatus, 'Rendering\\u2026');
    getJson('POST', '/api/admin/listicles/sections/preview', {
      headline_text: headlineInput ? headlineInput.value : '',
      headline_offer_id: headlineOfferInput && headlineOfferInput.value !== '' ? parseInt(headlineOfferInput.value, 10) : null,
      image_json: collectImage() ? JSON.stringify(collectImage()) : null,
      content_json: contentJson
    }).then(function (res) {
      if (seq !== previewSeq) { return; }
      if (!res.ok || !res.body || !res.body.html) {
        setText(previewStatus, 'Preview unavailable');
        return;
      }
      setText(previewStatus, '');
      previewFrame.setAttribute('srcdoc', res.body.html);
    }).catch(function () {
      if (seq !== previewSeq) { return; }
      setText(previewStatus, 'Preview unavailable');
    });
  }
  function setPreviewMode(mobile) {
    if (!previewFrame) { return; }
    if (mobile) { previewFrame.classList.add('lst-preview-mobile'); }
    else { previewFrame.classList.remove('lst-preview-mobile'); }
    if (previewDesktopBtn) {
      previewDesktopBtn.className = mobile ? 'btn btn-sm btn-outline' : 'btn btn-sm btn-primary';
      previewDesktopBtn.setAttribute('aria-pressed', mobile ? 'false' : 'true');
    }
    if (previewMobileBtn) {
      previewMobileBtn.className = mobile ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
      previewMobileBtn.setAttribute('aria-pressed', mobile ? 'true' : 'false');
    }
  }
  if (previewDesktopBtn) { previewDesktopBtn.addEventListener('click', function () { setPreviewMode(false); }); }
  if (previewMobileBtn) { previewMobileBtn.addEventListener('click', function () { setPreviewMode(true); }); }

  // ---- change plumbing -----------------------------------------------------------
  function refreshPanels() {
    renderInventory();
    schedulePreview();
  }
  window._lstOnEditorChange = function () {
    dirty = true;
    refreshPanels();
  };
  // Initial render happens from the mount script right after the editor boots.
  window._lstEditorReady = function () {
    dirty = false;
    refreshPanels();
  };
  form.addEventListener('input', function () { dirty = true; });
  form.addEventListener('change', function () { dirty = true; });
  if (headlineInput) { headlineInput.addEventListener('input', function () { renderInventory(); schedulePreview(); }); }

  // ---- §8 unsaved-changes guards ---------------------------------------------------
  window.addEventListener('beforeunload', function (e) {
    if (dirty && !saving) {
      e.preventDefault();
      e.returnValue = 'You have unsaved section changes.';
      return 'You have unsaved section changes.';
    }
    return undefined;
  });
  if (cancelLink) {
    cancelLink.addEventListener('click', function (e) {
      if (dirty && !window.confirm('Discard unsaved section changes?')) {
        e.preventDefault();
        return;
      }
      dirty = false;
    });
  }

  // ---- save (§8 Save state; §23 server errors render field-keyed) ------------------
  function clearFieldErrors() {
    var els = form.querySelectorAll('.form-error');
    var i;
    for (i = 0; i < els.length; i++) { els[i].hidden = true; setText(els[i], ''); }
    if (errorList) { errorList.hidden = true; while (errorList.firstChild) { errorList.removeChild(errorList.firstChild); } }
  }
  function setFieldError(name, message) {
    var el = form.querySelector('[data-error-for="' + name + '"]');
    if (el) { el.hidden = false; setText(el, message); return true; }
    return false;
  }
  function renderServerErrors(fields) {
    clearFieldErrors();
    var rest = [];
    var key, firstBlockIndex = -1, m;
    for (key in fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, key)) { continue; }
      if (!setFieldError(key, fields[key])) { rest.push(key + ': ' + fields[key]); }
      m = key.match(/^content\\.blocks\\[(\\d+)\\]/);
      if (m && firstBlockIndex === -1) { firstBlockIndex = parseInt(m[1], 10); }
    }
    if (rest.length > 0 && errorList) {
      var ul = document.createElement('ul');
      var i, li;
      for (i = 0; i < rest.length; i++) {
        li = document.createElement('li');
        li.className = 'form-error';
        li.appendChild(document.createTextNode(rest[i]));
        ul.appendChild(li);
      }
      errorList.appendChild(ul);
      errorList.hidden = false;
    }
    if (firstBlockIndex >= 0 && window.blockEditor && window.blockEditor.blocks[firstBlockIndex]) {
      window.blockEditor.jumpToBlock(window.blockEditor.blocks[firstBlockIndex].id);
    }
    setTopError('The section was not saved — fix the highlighted problems.');
    setStatus('Validation failed');
  }

  function collectBody() {
    var contentInput = document.getElementById('content_json');
    var contentJson = contentInput && contentInput.value ? contentInput.value : '';
    var content = null;
    try { content = contentJson ? JSON.parse(contentJson) : null; } catch (e) { content = null; }
    var aiPreset = aiPresetSelect && aiPresetSelect.value ? parseInt(aiPresetSelect.value, 10) : NaN;
    var aiPrompt = aiPromptInput ? aiPromptInput.value.replace(/^\\s+|\\s+$/g, '') : '';
    var ai = null;
    if (!isNaN(aiPreset) || aiPrompt !== '') {
      ai = {};
      if (!isNaN(aiPreset)) { ai.preset_id = aiPreset; }
      if (aiPrompt !== '') { ai.prompt = aiPrompt; }
    }
    var headlineOffer = headlineOfferInput && headlineOfferInput.value !== '' ? parseInt(headlineOfferInput.value, 10) : NaN;
    return {
      section_name: nameInput ? nameInput.value : '',
      headline_text: headlineInput ? headlineInput.value : '',
      headline_offer_id: isNaN(headlineOffer) ? null : headlineOffer,
      image: collectImage(),
      ai_settings: ai,
      content_json: content
    };
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (saving) { return; }
    clearFieldErrors();
    setTopError('');
    var body = collectBody();
    if (body.content_json === null) {
      setTopError('The content editor has no valid content yet.');
      return;
    }
    saving = true;
    if (saveBtn) { saveBtn.disabled = true; }
    setStatus('Saving\\u2026');
    var url = mode === 'edit'
      ? '/api/admin/listicles/sections/' + encodeURIComponent(sectionId)
      : '/api/admin/listicles/sections';
    var method = mode === 'edit' ? 'PATCH' : 'POST';
    getJson(method, url, body).then(function (res) {
      saving = false;
      if (saveBtn) { saveBtn.disabled = false; }
      if (res.ok) {
        dirty = false;
        saving = true; // suppress the beforeunload guard through the redirect
        setStatus('');
        window.showToast(mode === 'edit' ? 'Section saved' : 'Section created', 'success');
        window.setTimeout(function () { window.location.href = '/admin/listicles/sections'; }, 600);
        return;
      }
      if (res.body && res.body.fields) {
        renderServerErrors(res.body.fields);
        return;
      }
      setTopError((res.body && res.body.error) || ('Error ' + res.status));
      setStatus('Save failed');
    }).catch(function () {
      saving = false;
      if (saveBtn) { saveBtn.disabled = false; }
      setTopError('Network error \\u2014 the section was not saved.');
      setStatus('Save failed');
    });
  });
}());
`;

// The mount script: boots the SHARED BlockEditor with the listicle
// configuration, then hands control to the page script (initial inventory +
// preview render). Strict ES5.
const SECTION_EDITOR_MOUNT_SCRIPT = `
(function () {
  function boot() {
    var data = window._lstEditorBoot || {};
    if (window.initBlockEditor) {
      window.initBlockEditor('content-editor', {
        hiddenInputId: 'content_json',
        placeholder: 'Build the section content\\u2026',
        listicle: data.config || {},
        onChange: function () { if (window._lstOnEditorChange) { window._lstOnEditorChange(); } }
      });
      if (window._lstEditorReady) { window._lstEditorReady(); }
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}());
`;

// ---------------------------------------------------------------------------
// Page assembly
// ---------------------------------------------------------------------------

export function listiclesSectionEditorPage(
  props: SectionEditorPageProps,
  branding: ListiclesBranding = {},
): string {
  const boot = buildBoot(props);
  const bootScript = `window._lstEditorBoot = ${safeBootJson(boot)};`;
  const title = props.mode === "edit" ? "Edit Section" : "New Section";
  const content = `${renderListiclesTabs("sections")}
<p><a href="/admin/listicles/sections">&larr; Back to Sections</a></p>
<h2 class="card-title" style="margin-bottom:16px">${escapeHtml(title)}</h2>
${renderEditorForm(props)}
${renderOfferPickerModal()}
${renderOfferModal()}
${renderDialogShell()}`;
  // Curated colour tokens as CSS for the EDITOR surface (spans show their
  // colour while editing) — generated from the same maps the renderer uses.
  const editorColorCss = curatedColorCss(
    { textColors: LISTICLE_TEXT_COLORS, highlights: LISTICLE_HIGHLIGHTS },
    ".block-editor",
  );
  return adminLayout({
    title: "Listicles",
    activePath: "/admin/listicles/sections",
    userEmail: branding.userEmail,
    content,
    styles:
      LISTICLES_STYLES +
      BLOCK_EDITOR_COLOR_TOKENS +
      editorStyles +
      relabelSectionImage(heroImageStyles) +
      OFFER_PICKER_STYLES +
      SECTION_EDITOR_STYLES +
      editorColorCss,
    scripts:
      LST_SHARED_SCRIPT +
      editorScripts +
      OFFER_MODAL_SCRIPT +
      OFFER_PICKER_SCRIPT +
      relabelSectionImage(heroImageScripts) +
      "\n" +
      bootScript +
      "\n" +
      SECTION_EDITOR_SCRIPT +
      SECTION_EDITOR_MOUNT_SCRIPT,
  });
}

// 404 shell for /sections/:id/edit with an unknown id (no dead surface —
// a real page with a way back).
export function listiclesSectionNotFoundPage(branding: ListiclesBranding = {}): string {
  const content = `${renderListiclesTabs("sections")}
<div class="card"><div class="empty-state">
  <p>Section not found.</p>
  <a href="/admin/listicles/sections" class="btn btn-primary">Back to Sections</a>
</div></div>`;
  return adminLayout({
    title: "Listicles",
    activePath: "/admin/listicles/sections",
    userEmail: branding.userEmail,
    content,
    styles: LISTICLES_STYLES,
    scripts: LST_SHARED_SCRIPT,
  });
}
