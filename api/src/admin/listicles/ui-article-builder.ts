// Listicles Article builder (design contract §11 / §15.5 / §15.6 / §15.8 /
// §23 / §26 / §30.2 / §30.6 / §30.7) — Phase 5.
//
//   GET /admin/listicles/articles/new       → base + control-Version create
//   GET /admin/listicles/articles/:id/edit  → the full builder
//
// Edit anatomy: tabs → back link → base card (Site* / name / slug —
// per-site-uniqueness errors render field-keyed) → Versions rail (§11:
// control auto-created on create; versioning invisible until a second
// Version exists; "A/B this Article" creates a DRAFT experiment; per-Version
// traffic % with the Σ=100 indicator green ONLY at 100; exactly-one-control
// marker; start/stop) → per-Version editor (headline* / intro* / hero image
// via the reused media+AI card / layout_style / §30.2 byline editor / AI
// settings) → Pages builder (ordered pages; selection_mode single|ab_test|
// rule_based; §13-style Section picker; per-candidate traffic Σ=100 +
// stable ab_test_id; rule editor over the §15.4 dims as tag-input sets +
// hour/daypart ranges; exactly-one-fallback; Validate rules → §15.5
// conflict matrix — the SAME matrix renders when a save is blocked) →
// §30.6 Version preview (force Version/candidate, simulate rule dims,
// per-page CTA density, desktop/mobile) → View structure (read-only §7.1
// tree) → Publish.
//
// §15.6/§30.7 case c is surfaced EXACTLY where the 409s fire: a save hitting
// running_version_immutable / published_version_immutable opens the
// immutability dialog offering the two conformant paths — fork (new
// lander_v; optional explicit experiment join) or "start a new revision
// period" (same lander_v, explicit revision bump).
//
// Every inline script on this page is strict ES5 (var-only; DOM via
// createElement/createTextNode for user data) — asserted by
// test/listicles-builder-page.test.ts. The §12 block editor is NOT embedded
// here: sections are PICKED, not edited, in the builder.

import { adminLayout, escapeHtml } from "../templates/layout";
import {
  renderHeroImageCard,
  heroImageScripts,
  heroImageStyles,
} from "../templates/hero-image";
import { SET_DIMENSIONS } from "../../listicles/rules";
import {
  renderListiclesTabs,
  renderDialogShell,
  LISTICLES_STYLES,
  LST_SHARED_SCRIPT,
} from "./ui-shared";
import type { ListiclesBranding } from "./ui-offers";
import type { ArticleRowL, VersionRowL } from "./articles-handlers";
import type { StructurePage } from "./structure";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BuilderSiteOption {
  id: string;
  name?: string;
}

export interface BuilderExperiment {
  id: number;
  public_id: string;
  name: string;
  status: string;
}

export interface BuilderVersion extends VersionRowL {
  pages: StructurePage[];
}

export interface ArticleBuilderPageProps {
  mode: "new" | "edit";
  sites: ReadonlyArray<BuilderSiteOption>;
  article: ArticleRowL | null;
  experiment: BuilderExperiment | null;
  versions: ReadonlyArray<BuilderVersion>;
}

// ---------------------------------------------------------------------------
// Boot payload
// ---------------------------------------------------------------------------

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (raw === null || raw.trim() === "") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* stored garbage never breaks the builder shell */
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

function buildBoot(props: ArticleBuilderPageProps): Record<string, unknown> {
  return {
    mode: props.mode,
    setDimensions: SET_DIMENSIONS,
    sites: props.sites.map((s) => ({ id: s.id, name: s.name ?? s.id })),
    article: props.article,
    experiment: props.experiment,
    versions: props.versions.map((v) => ({
      public_id: v.public_id,
      experiment_id: v.experiment_id,
      variant_label: v.variant_label,
      is_control: v.is_control === 1,
      traffic_allocation: v.traffic_allocation,
      headline: v.headline,
      intro_paragraph: v.intro_paragraph,
      hero_media_id: v.hero_media_id,
      hero_media_url: v.hero_media_url,
      layout_style_id: v.layout_style_id,
      byline: parseJsonObject(v.byline_json),
      ai_settings: parseJsonObject(v.ai_settings_json),
      content_version: v.content_version,
      status: v.status,
      pages: v.pages.map((page) => ({
        public_id: page.public_id,
        page_index: page.page_index,
        selection_mode: page.selection_mode,
        ab_test_id: page.ab_test_id,
        rule_set_id: page.rule_set_id,
        candidates: page.candidates.map((cand) => ({
          public_id: cand.public_id,
          section_id: cand.section_id,
          section_name: cand.section_name,
          label: cand.label,
          traffic_allocation: cand.traffic_allocation,
          is_fallback: cand.is_fallback === 1,
          rule:
            cand.rule === null
              ? null
              : {
                  public_id: cand.rule.public_id,
                  priority: cand.rule.priority,
                  conditions_json: cand.rule.conditions_json,
                },
        })),
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const BUILDER_STYLES = `
.lst-builder-grid{display:grid;grid-template-columns:minmax(0,1fr) 440px;gap:24px;align-items:start}
@media (max-width:1280px){.lst-builder-grid{grid-template-columns:1fr}}
.lst-builder-side{position:sticky;top:76px;display:flex;flex-direction:column;gap:16px;max-height:calc(100vh - 92px);overflow-y:auto}
.lst-base-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
@media (max-width:900px){.lst-base-grid{grid-template-columns:1fr}}
.lst-actions-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:16px}
.lst-rail{display:flex;flex-direction:column;gap:6px}
.lst-rail-row{display:flex;gap:10px;align-items:center;padding:8px 10px;border:1px solid var(--c-border);border-radius:6px;cursor:pointer}
.lst-rail-row.active{border-color:var(--c-primary);background:var(--c-primary-light)}
.lst-rail-label{font-weight:700;min-width:20px}
.lst-rail-headline{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--c-muted);font-size:13px}
.lst-rail-alloc{width:64px}
.lst-rail-alloc input{width:100%}
.lst-exp-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}
.lst-sigma{font-weight:700;font-size:13px;padding:2px 10px;border-radius:9999px;border:1px solid var(--c-border)}
.lst-sigma-ok{color:#0a7a33;border-color:#0a7a33;background:#e7f6ec}
.lst-sigma-bad{color:#b42318;border-color:#b42318;background:#fdecea}
.lst-lock-note{font-size:12px;color:var(--c-muted)}
.lst-page-card{border:1px solid var(--c-border);border-radius:8px;padding:12px;margin-bottom:12px}
.lst-page-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.lst-page-title{font-weight:700}
.lst-page-abid{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--c-muted)}
.lst-page-tools{margin-left:auto;display:flex;gap:4px}
.lst-cand-table{width:100%;border-collapse:collapse;font-size:13px}
.lst-cand-table th,.lst-cand-table td{padding:6px;border-bottom:1px solid var(--c-border);text-align:left;vertical-align:top}
.lst-cand-alloc{width:70px}
.lst-rule-editor{background:var(--c-bg-alt);border:1px solid var(--c-border);border-radius:6px;padding:8px;margin-top:6px}
.lst-rule-row{display:flex;gap:6px;align-items:flex-start;margin-bottom:6px;flex-wrap:wrap}
.lst-rule-row .form-select{max-width:160px}
.lst-tags{display:flex;flex-wrap:wrap;gap:4px;flex:1;min-width:180px;border:1px solid var(--c-border);border-radius:6px;padding:3px 6px;background:#fff}
.lst-tag{display:inline-flex;align-items:center;gap:4px;background:var(--c-primary-light);border-radius:9999px;padding:1px 8px;font-size:12px}
.lst-tag button{border:0;background:none;cursor:pointer;color:var(--c-primary);font-size:12px;padding:0}
.lst-tags input{border:0;outline:none;flex:1;min-width:70px;font-size:12px;padding:3px 2px}
.lst-hour-inputs{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:12px}
.lst-hour-inputs input{width:58px}
.lst-mx-wrap{overflow-x:auto}
.lst-conflict-matrix{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
.lst-conflict-matrix th,.lst-conflict-matrix td{border:1px solid var(--c-border);padding:5px 7px;text-align:left;vertical-align:top}
.lst-conflict-matrix .lst-mx-hit{background:#fde68a;font-weight:600}
.lst-conflict-matrix tr.lst-mx-blocking .lst-mx-hit{background:#fecaca}
.lst-conflict-matrix tr.lst-mx-blocking td:first-child{border-left:3px solid #b42318}
.lst-conflict-matrix tr.lst-mx-warning td:first-child{border-left:3px solid #b45309}
.lst-mx-legend{font-size:12px;color:var(--c-muted);margin-top:4px}
#lst-conflict-out{margin-top:8px}
#lst-conflict-out[hidden]{display:none}
.lst-byline-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media (max-width:900px){.lst-byline-grid{grid-template-columns:1fr}}
#lst-b-avatar-preview{width:31px;height:31px;border-radius:9999px;object-fit:cover;display:inline-block;vertical-align:middle;margin-right:6px;background:var(--c-bg-alt)}
#lst-b-avatar-preview[hidden]{display:none}
.lst-pv-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.lst-pv-grid label{font-size:11px;color:var(--c-muted);display:block}
.lst-pv-grid input{width:100%;font-size:12px;padding:3px 6px}
.lst-pv-forces-row{display:flex;gap:6px;align-items:center;margin-bottom:4px;font-size:12px}
.lst-pv-forces-row select{flex:1}
.lst-pv-density-list{margin:6px 0 0 0;padding:0;list-style:none;font-size:12px}
.lst-pv-density-list li{padding:2px 0;border-bottom:1px dashed var(--c-border)}
.lst-pv-density-count{font-weight:700}
#lst-version-preview{border:0;width:100%;height:560px;background:#fff;display:block}
#lst-version-preview.lst-preview-mobile{width:390px}
.lst-preview-frame-wrap{border:1px solid var(--c-border);border-radius:8px;overflow:hidden;background:#f3f4f6;display:flex;justify-content:center}
.lst-preview-toolbar{display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
.lst-preview-note{font-size:11px;color:var(--c-muted);margin-top:6px}
.lst-structure-tree{margin:4px 0 4px 16px;font-size:13px}
.lst-structure-tree li{margin:2px 0}
#lst-builder-errors ul{margin:4px 0 4px 18px}
.lst-picker-content{max-width:560px}
.lst-picker-searchrow{display:flex;gap:8px;margin-bottom:8px}
.lst-picker-searchrow .form-input{flex:1}
.lst-picker-results{border:1px solid var(--c-border);border-radius:6px;max-height:320px;overflow-y:auto;display:flex;flex-direction:column}
.lst-picker-row{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 12px;border:0;border-bottom:1px solid var(--c-border);background:none;font-size:13px;cursor:pointer}
.lst-picker-row:last-child{border-bottom:0}
.lst-picker-row:hover,.lst-picker-row.active{background:var(--c-bg-alt)}
.lst-picker-row.active{outline:2px solid var(--c-primary);outline-offset:-2px}
.lst-picker-name{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lst-picker-meta{color:var(--c-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}
.lst-picker-empty{padding:16px;text-align:center;color:var(--c-muted);font-size:13px}
`;

// ---------------------------------------------------------------------------
// Markup helpers
// ---------------------------------------------------------------------------

function fieldError(name: string): string {
  return `<span class="form-error" data-error-for="${name}" hidden></span>`;
}

function renderSiteOptions(
  sites: ReadonlyArray<BuilderSiteOption>,
  selected: string | null,
): string {
  const opts = sites
    .map((s) => {
      const sel = s.id === selected ? " selected" : "";
      return `<option value="${escapeHtml(s.id)}"${sel}>${escapeHtml(s.name ?? s.id)}</option>`;
    })
    .join("");
  return `<option value="">Choose a site…</option>${opts}`;
}

// Base card (§11 "Article (base): Site*, Article name, Slug").
function renderBaseCard(props: ArticleBuilderPageProps): string {
  const a = props.article;
  return `<section class="card" id="lst-base-card">
  <div class="card-header"><h3 class="card-title">Article (base)</h3></div>
  <div class="lst-base-grid">
    <div class="form-group">
      <label for="lst-a-site" class="form-label">Site *</label>
      <select id="lst-a-site" name="site_id" class="form-select" required aria-required="true">${renderSiteOptions(props.sites, a?.site_id ?? null)}</select>
      ${fieldError("site_id")}
    </div>
    <div class="form-group">
      <label for="lst-a-name" class="form-label">Article name *</label>
      <input id="lst-a-name" name="article_name" type="text" class="form-input" required aria-required="true" value="${escapeHtml(a?.article_name ?? "")}" placeholder="Internal name" />
      ${fieldError("article_name")}
    </div>
    <div class="form-group">
      <label for="lst-a-slug" class="form-label">Slug *</label>
      <input id="lst-a-slug" name="slug" type="text" class="form-input" required aria-required="true" value="${escapeHtml(a?.slug ?? "")}" placeholder="best-senior-savings" />
      ${fieldError("slug")}
      <p class="form-help">Unique per site — the public URL.</p>
    </div>
  </div>
  ${props.mode === "edit" ? '<div class="lst-actions-row"><button type="button" id="lst-article-save" class="btn btn-secondary btn-sm">Save base</button></div>' : ""}
</section>`;
}

// Versions rail (§11 experiment & versions; §15.8 Σ=100 + one control).
function renderVersionsRail(): string {
  return `<section class="card" id="lst-versions-card">
  <div class="card-header"><h3 class="card-title">Versions</h3></div>
  <div id="lst-exp-summary" class="form-help"></div>
  <div id="lst-rail" class="lst-rail" aria-label="Article Versions"></div>
  <div class="lst-exp-bar">
    <button type="button" id="lst-ab-create" class="btn btn-sm btn-primary" hidden>A/B this Article</button>
    <span id="lst-exp-newname-wrap" hidden>
      <input id="lst-exp-name" type="text" class="form-input" placeholder="Experiment name" style="max-width:200px" />
      <button type="button" id="lst-exp-create-confirm" class="btn btn-sm btn-primary">Create A/B experiment</button>
    </span>
    <button type="button" id="lst-add-version" class="btn btn-sm btn-secondary" hidden>+ Add Version (fork)</button>
    <span id="lst-exp-sigma" class="lst-sigma" hidden></span>
    <button type="button" id="lst-exp-start" class="btn btn-sm btn-primary" hidden>Start experiment</button>
    <button type="button" id="lst-exp-stop" class="btn btn-sm btn-danger" hidden>Stop experiment</button>
  </div>
  <p class="form-help">Live traffic split must total exactly 100% across Versions (Σ indicator turns green only at 100). Exactly one Version is the control (§15.8).</p>
</section>`;
}

// §30.2 byline editor.
function renderBylineCard(): string {
  return `<section class="card" id="lst-byline-card">
  <div class="card-header"><h3 class="card-title">Byline (§30.2)</h3>
    <label class="lst-headline-toggle" for="lst-b-enabled" style="float:right"><input type="checkbox" id="lst-b-enabled" /> Enabled</label>
  </div>
  <div class="lst-byline-grid">
    <div class="form-group">
      <label for="lst-b-author" class="form-label">Author name</label>
      <input id="lst-b-author" type="text" class="form-input" placeholder="e.g. Sarah Mitchell" />
      ${fieldError("byline.author_name")}
    </div>
    <div class="form-group">
      <label for="lst-b-label" class="form-label">Label</label>
      <input id="lst-b-label" type="text" class="form-input" placeholder="Advertorial" />
      <p class="form-help">Defaults to “Advertorial”.</p>
    </div>
    <div class="form-group">
      <label for="lst-b-updated-label" class="form-label">Updated label</label>
      <input id="lst-b-updated-label" type="text" class="form-input" placeholder="Updated:" />
    </div>
    <div class="form-group">
      <label for="lst-b-updated-date" class="form-label">Updated date</label>
      <input id="lst-b-updated-date" type="text" class="form-input" placeholder="e.g. June 2026" />
    </div>
    <div class="form-group">
      <label for="lst-b-avatar-url" class="form-label">Author avatar</label>
      <div>
        <img id="lst-b-avatar-preview" src="" alt="" hidden />
        <input id="lst-b-avatar-url" type="text" class="form-input" style="display:inline-block;max-width:60%" placeholder="/media/… or https://…" />
        <input id="lst-b-avatar-file" type="file" accept="image/*" hidden />
        <button type="button" id="lst-b-avatar-upload" class="btn btn-sm btn-outline">Upload</button>
      </div>
      <input type="hidden" id="lst-b-avatar-media-id" value="" />
      ${fieldError("byline.author_avatar_url")}
      <p class="form-help">31px circular avatar in the rendered byline row.</p>
    </div>
  </div>
</section>`;
}

function renderAiCard(): string {
  return `<section class="card" id="lst-v-ai-card">
  <div class="card-header"><h3 class="card-title">AI settings</h3></div>
  <div class="lst-byline-grid">
    <div class="form-group">
      <label for="lst-v-ai-preset" class="form-label">Preset</label>
      <select id="lst-v-ai-preset" class="form-select"><option value="">No preset</option></select>
    </div>
    <div class="form-group">
      <label for="lst-v-ai-prompt" class="form-label">Prompt</label>
      <textarea id="lst-v-ai-prompt" class="form-textarea" rows="2" placeholder="Optional guidance stored with the Version (ai_settings)…"></textarea>
      ${fieldError("ai_settings")}
    </div>
  </div>
</section>`;
}

// Per-Version editor card (§11 Version fields). The §30.2 byline + AI cards
// are edit-only: POST /articles takes the base + control §23 fields; byline
// and AI settings persist through PUT /versions/:id on the edit screen.
function renderVersionEditor(props: ArticleBuilderPageProps): string {
  const heroCard = renderHeroImageCard(null, null);
  const isEdit = props.mode === "edit";
  const saveRow = isEdit
    ? `<div class="lst-actions-row">
    <button type="button" id="lst-version-save" class="btn btn-primary">Save Version</button>
    <span id="lst-version-revision" class="form-help"></span>
  </div>`
    : "";
  return `<section class="card" id="lst-version-card">
  <div class="card-header"><h3 class="card-title" id="lst-version-card-title">${isEdit ? "Version" : "Control Version (A)"}</h3></div>
  <div class="form-group">
    <label for="lst-v-headline" class="form-label">Headline *</label>
    <input id="lst-v-headline" type="text" class="form-input" required aria-required="true" placeholder="The article H1 for this Version" />
    ${fieldError("headline")}
  </div>
  <div class="form-group">
    <label for="lst-v-intro" class="form-label">Intro paragraph *</label>
    <textarea id="lst-v-intro" class="form-textarea" rows="3" required aria-required="true" placeholder="Opening paragraph(s) — blank line separates paragraphs"></textarea>
    ${fieldError("intro_paragraph")}
  </div>
  ${heroCard}
  ${fieldError("hero")}
  <div class="form-group">
    <label for="lst-v-layout" class="form-label">Layout style *</label>
    <select id="lst-v-layout" class="form-select">
      <option value="default">Default (reference advertorial)</option>
    </select>
    ${fieldError("layout_style_id")}
    <p class="form-help">Only the measured default layout ships for now (§14).</p>
  </div>
  ${isEdit ? renderBylineCard() : ""}
  ${isEdit ? renderAiCard() : ""}
  ${saveRow}
</section>`;
}

// Pages builder shell — rows render client-side from state (§11 pages
// builder + selection mode).
function renderPagesCard(): string {
  return `<section class="card" id="lst-pages-card">
  <div class="card-header"><h3 class="card-title">Pages</h3></div>
  <p class="form-help">Ordered Pages of the selected Version. Each Page serves ONE Section candidate chosen by its selection mode: single · ab_test (candidate traffic Σ=100, stable ab_test_id) · rule_based (priority rules + exactly one fallback; §15.5 conflict guard).</p>
  <div id="lst-pages-list"></div>
  <div class="lst-actions-row">
    <button type="button" id="lst-page-add" class="btn btn-sm btn-secondary">+ Add Page</button>
  </div>
  <div id="lst-conflict-out" hidden></div>
</section>`;
}

// §30.6 Version preview panel.
function renderPreviewPanel(): string {
  const dimInputs = SET_DIMENSIONS.map(
    (dim) =>
      `<span><label for="lst-pv-dim-${dim}">${escapeHtml(dim)}</label><input id="lst-pv-dim-${dim}" data-pv-dim="${dim}" type="text" class="form-input" /></span>`,
  ).join("");
  return `<section class="card" id="lst-pv-card">
  <div class="card-header"><h3 class="card-title">Version preview</h3></div>
  <div class="lst-preview-toolbar">
    <label for="lst-pv-version" class="form-label" style="margin:0">Force Version</label>
    <select id="lst-pv-version" class="form-select" style="max-width:180px"></select>
    <button type="button" id="lst-pv-desktop" class="btn btn-sm btn-primary" aria-pressed="true">Desktop</button>
    <button type="button" id="lst-pv-mobile" class="btn btn-sm btn-outline" aria-pressed="false">Mobile</button>
    <button type="button" id="lst-pv-run" class="btn btn-sm btn-secondary">Refresh</button>
    <span id="lst-pv-status" class="form-status" role="status" aria-live="polite"></span>
  </div>
  <div id="lst-pv-forces" aria-label="Force page candidates"></div>
  <details id="lst-pv-ctx">
    <summary class="form-help">Simulate rule audience (§15.4 dims + hour)</summary>
    <div class="lst-pv-grid">
      ${dimInputs}
      <span><label for="lst-pv-hour">hour (0-23)</label><input id="lst-pv-hour" type="number" min="0" max="23" class="form-input" /></span>
    </div>
  </details>
  <ul id="lst-pv-density" class="lst-pv-density-list" aria-label="Page CTA density"></ul>
  <div class="lst-preview-frame-wrap">
    <iframe id="lst-version-preview" title="Article Version preview (default layout tokens)" sandbox=""></iframe>
  </div>
  <p class="lst-preview-note">Full-page render in the §30.2 component order (header · Disclosure · title · byline · hero · intro · Sections · legal · footer). Content-accurate; pixel parity is gated on the §31.0 reference captures (Phase 6).</p>
</section>`;
}

// Section picker modal (the builder's §11 candidate picker — search over the
// sections list API; rows show section name + headline).
function renderSectionPickerModal(): string {
  return `<div id="lst-section-picker" class="modal hidden" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="lst-section-picker-title" aria-hidden="true">
  <div class="modal-content lst-picker-content">
    <h2 id="lst-section-picker-title" class="modal-title">Choose a Section</h2>
    <div class="lst-picker-searchrow">
      <input id="lst-section-picker-search" type="search" class="form-input" placeholder="Search sections by name or headline…" autocomplete="off" aria-label="Search sections" />
    </div>
    <p id="lst-section-picker-status" class="form-status" role="status" aria-live="polite"></p>
    <div id="lst-section-picker-results" class="lst-picker-results" role="listbox" aria-label="Section results"></div>
    <div class="modal-actions">
      <button type="button" id="lst-section-picker-cancel" class="btn btn-secondary">Cancel</button>
    </div>
  </div>
</div>`;
}

// §15.6/§30.7-case-c dialog — offered exactly where the 409s fire.
function renderImmutabilityModal(): string {
  return `<div id="lst-immutable-modal" class="modal hidden" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="lst-immutable-title" aria-hidden="true">
  <div class="modal-content">
    <h2 id="lst-immutable-title" class="modal-title">This Version is immutable</h2>
    <p id="lst-immutable-reason" class="form-help"></p>
    <div class="form-group">
      <label class="lst-headline-toggle"><input type="radio" name="lst-imm-choice" id="lst-imm-fork" value="fork" checked />
        <span><strong>Fork a new Version</strong> — a new <code>lander_v</code> (§15.6 case c): your edits land on a copy; the live arm's data never mixes across edits.</span>
      </label>
    </div>
    <div class="form-group" id="lst-imm-join-wrap" hidden>
      <label class="lst-headline-toggle" style="margin-left:24px"><input type="checkbox" id="lst-imm-join" />
        <span>Join the DRAFT experiment as a new variant (starts at 0% traffic; Σ=100 is re-validated at start)</span>
      </label>
    </div>
    <p id="lst-imm-standalone-note" class="form-help" style="margin-left:24px" hidden></p>
    <div class="form-group">
      <label class="lst-headline-toggle"><input type="radio" name="lst-imm-choice" id="lst-imm-revision" value="revision" />
        <span><strong>Start a new revision period</strong> — SAME <code>lander_v</code>, <code>content_version</code> bump (§30.7 case c, explicit operator action); analytics separate by <code>article_version_revision</code>.</span>
      </label>
    </div>
    <div class="modal-actions">
      <button type="button" id="lst-imm-cancel" class="btn btn-secondary">Cancel</button>
      <button type="button" id="lst-imm-confirm" class="btn btn-primary">Continue</button>
    </div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Conflict-matrix script (§15.5) — a standalone ES5 atom with a PURE model
// function (unit-tested via node:vm from the emitted string) + a DOM render.
// ---------------------------------------------------------------------------

export const CONFLICT_MATRIX_SCRIPT = `
(function () {
  // model: §15.5 payload rows -> { dims, rows } for a candidates × dimensions
  // grid. conflicts (equal priority) BLOCK -> red; warnings (cross-priority
  // "can override") -> amber. Cell values join the per-dimension overlap.
  function model(conflicts, warnings) {
    var dims = [];
    var seen = {};
    var rows = [];
    function addReport(report, blocking) {
      var overlap = report.overlap || {};
      var dim;
      for (dim in overlap) {
        if (Object.prototype.hasOwnProperty.call(overlap, dim) && !seen[dim]) {
          seen[dim] = true;
          dims.push(dim);
        }
      }
      var cells = {};
      for (dim in overlap) {
        if (!Object.prototype.hasOwnProperty.call(overlap, dim)) { continue; }
        var values = overlap[dim];
        cells[dim] = Object.prototype.toString.call(values) === '[object Array]' ? values.join(', ') : String(values);
      }
      rows.push({
        a: report.candidate_a || '',
        b: report.candidate_b || '',
        blocking: blocking,
        reason: report.reason || '',
        cells: cells
      });
    }
    var i;
    for (i = 0; i < (conflicts || []).length; i++) { addReport(conflicts[i], true); }
    for (i = 0; i < (warnings || []).length; i++) { addReport(warnings[i], false); }
    return { dims: dims, rows: rows };
  }

  function render(container, conflicts, warnings, title) {
    while (container.firstChild) { container.removeChild(container.firstChild); }
    var m = model(conflicts, warnings);
    if (m.rows.length === 0) { return m; }
    var h = document.createElement('p');
    h.className = 'alert ' + (conflicts && conflicts.length > 0 ? 'alert-error' : 'alert-warning');
    h.setAttribute('role', 'alert');
    h.appendChild(document.createTextNode(title || 'Rule conflict'));
    container.appendChild(h);
    var wrap = document.createElement('div');
    wrap.className = 'lst-mx-wrap';
    var table = document.createElement('table');
    table.className = 'lst-conflict-matrix';
    var thead = document.createElement('thead');
    var tr = document.createElement('tr');
    var headers = ['Candidate A', 'Candidate B'].concat(m.dims).concat(['Why']);
    var i, j, th;
    for (i = 0; i < headers.length; i++) {
      th = document.createElement('th');
      th.appendChild(document.createTextNode(headers[i]));
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    for (i = 0; i < m.rows.length; i++) {
      var row = m.rows[i];
      tr = document.createElement('tr');
      tr.className = row.blocking ? 'lst-mx-blocking' : 'lst-mx-warning';
      var td = document.createElement('td');
      td.appendChild(document.createTextNode(row.a));
      tr.appendChild(td);
      td = document.createElement('td');
      td.appendChild(document.createTextNode(row.b));
      tr.appendChild(td);
      for (j = 0; j < m.dims.length; j++) {
        td = document.createElement('td');
        var cell = row.cells[m.dims[j]];
        if (cell !== undefined && cell !== '') {
          td.className = 'lst-mx-hit';
          td.appendChild(document.createTextNode(cell));
        } else {
          td.appendChild(document.createTextNode('—'));
        }
        tr.appendChild(td);
      }
      td = document.createElement('td');
      td.appendChild(document.createTextNode(row.reason));
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
    var legend = document.createElement('p');
    legend.className = 'lst-mx-legend';
    legend.appendChild(document.createTextNode('Red rows: equal-priority overlaps — they BLOCK the save (ambiguous). Amber rows: cross-priority overlaps — allowed; the lower-priority rule wins the shared audience.'));
    container.appendChild(legend);
    return m;
  }

  window.lstConflictMatrix = { model: model, render: render };
}());
`;

// ---------------------------------------------------------------------------
// Section-picker script (ES5)
// ---------------------------------------------------------------------------

const SECTION_PICKER_SCRIPT = `
(function () {
  var root = document.getElementById('lst-section-picker');
  if (!root) { return; }
  var searchInput = document.getElementById('lst-section-picker-search');
  var resultsEl = document.getElementById('lst-section-picker-results');
  var statusEl = document.getElementById('lst-section-picker-status');
  var cancelBtn = document.getElementById('lst-section-picker-cancel');
  var getJson = window.lstUi.getJson;
  var current = null;
  var searchTimer = null;
  var requestSeq = 0;
  var visibleRows = [];
  var activeIndex = -1;

  function setStatus(msg) {
    while (statusEl.firstChild) { statusEl.removeChild(statusEl.firstChild); }
    if (msg) { statusEl.appendChild(document.createTextNode(msg)); }
  }

  function close() {
    current = null;
    root.style.display = 'none';
    root.classList.add('hidden');
    root.setAttribute('aria-hidden', 'true');
  }

  function select(section) {
    var cb = current && current.onSelect;
    close();
    if (cb) { cb(section); }
  }

  function setActive(index) {
    var i;
    for (i = 0; i < visibleRows.length; i++) {
      if (i === index) { visibleRows[i].className = 'lst-picker-row active'; }
      else { visibleRows[i].className = 'lst-picker-row'; }
    }
    activeIndex = index;
    if (index >= 0 && visibleRows[index] && visibleRows[index].scrollIntoView) {
      visibleRows[index].scrollIntoView({ block: 'nearest' });
    }
  }

  function renderResults(sections) {
    while (resultsEl.firstChild) { resultsEl.removeChild(resultsEl.firstChild); }
    visibleRows = [];
    activeIndex = -1;
    if (!sections || sections.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'lst-picker-empty';
      empty.appendChild(document.createTextNode('No active sections match.'));
      resultsEl.appendChild(empty);
      return;
    }
    var i;
    for (i = 0; i < sections.length; i++) {
      (function (section) {
        var row = document.createElement('button');
        row.type = 'button';
        row.className = 'lst-picker-row';
        row.setAttribute('role', 'option');
        var name = document.createElement('span');
        name.className = 'lst-picker-name';
        name.appendChild(document.createTextNode(section.section_name || ('#' + section.id)));
        row.appendChild(name);
        var meta = document.createElement('span');
        meta.className = 'lst-picker-meta';
        meta.appendChild(document.createTextNode(section.headline_text || ''));
        row.appendChild(meta);
        var pick = document.createElement('span');
        pick.className = 'lst-picker-select';
        pick.appendChild(document.createTextNode('Select'));
        row.appendChild(pick);
        row.addEventListener('click', function () { select(section); });
        resultsEl.appendChild(row);
        visibleRows.push(row);
        row._lstSection = section;
      }(sections[i]));
    }
  }

  function search() {
    var q = searchInput.value || '';
    var seq = ++requestSeq;
    setStatus('Searching\\u2026');
    getJson('GET', '/api/admin/listicles/sections?status=active&page_size=50&search=' + encodeURIComponent(q)).then(function (res) {
      if (seq !== requestSeq) { return; }
      setStatus('');
      if (!res.ok || !res.body) {
        setStatus('Search failed');
        return;
      }
      renderResults(res.body.sections || []);
    }).catch(function () {
      if (seq !== requestSeq) { return; }
      setStatus('Search failed');
    });
  }

  searchInput.addEventListener('input', function () {
    if (searchTimer) { window.clearTimeout(searchTimer); }
    searchTimer = window.setTimeout(search, 250);
  });

  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (visibleRows.length > 0) { setActive(Math.min(activeIndex + 1, visibleRows.length - 1)); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (visibleRows.length > 0) { setActive(Math.max(activeIndex - 1, 0)); } }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && visibleRows[activeIndex]) { select(visibleRows[activeIndex]._lstSection); }
    } else if (e.key === 'Escape') { close(); }
  });

  cancelBtn.addEventListener('click', close);
  root.addEventListener('click', function (e) { if (e.target === root) { close(); } });

  window.lstSectionPicker = {
    open: function (opts) {
      current = opts || {};
      var titleEl = document.getElementById('lst-section-picker-title');
      while (titleEl.firstChild) { titleEl.removeChild(titleEl.firstChild); }
      titleEl.appendChild(document.createTextNode((opts && opts.title) || 'Choose a Section'));
      root.style.display = 'flex';
      root.classList.remove('hidden');
      root.setAttribute('aria-hidden', 'false');
      searchInput.value = '';
      search();
      searchInput.focus();
    },
    close: close
  };
}());
`;

// ---------------------------------------------------------------------------
// NEW-mode script — base + control Version create (§11 "Creating an Article
// auto-creates one control Version").
// ---------------------------------------------------------------------------

const BUILDER_NEW_SCRIPT = `
(function () {
  var boot = window._lstBuilderBoot || {};
  if (boot.mode !== 'new') { return; }
  var getJson = window.lstUi.getJson;
  var form = document.getElementById('lst-builder-form');
  if (!form) { return; }
  var saveBtn = document.getElementById('lst-article-create');
  var statusEl = document.getElementById('lst-builder-status');
  var topError = document.getElementById('lst-builder-toperror');
  var dirty = false;
  var saving = false;

  function setText(el, msg) {
    if (!el) { return; }
    while (el.firstChild) { el.removeChild(el.firstChild); }
    if (msg) { el.appendChild(document.createTextNode(msg)); }
  }
  function setTopError(msg) { if (topError) { topError.hidden = !msg; setText(topError, msg || ''); } }
  function clearFieldErrors() {
    var els = form.querySelectorAll('.form-error');
    var i;
    for (i = 0; i < els.length; i++) { els[i].hidden = true; setText(els[i], ''); }
  }
  function setFieldError(name, message) {
    var el = form.querySelector('[data-error-for="' + name + '"]');
    if (el) { el.hidden = false; setText(el, message); return true; }
    return false;
  }

  form.addEventListener('input', function () { dirty = true; });
  form.addEventListener('change', function () { dirty = true; });
  window.addEventListener('beforeunload', function (e) {
    if (dirty && !saving) {
      e.preventDefault();
      e.returnValue = 'You have unsaved article changes.';
      return 'You have unsaved article changes.';
    }
    return undefined;
  });

  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }

  function collectHero() {
    var idEl = document.getElementById('hero-image-input');
    var previewEl = document.getElementById('hero-image-preview');
    var mediaId = idEl && idEl.value ? parseInt(idEl.value, 10) : NaN;
    var url = previewEl ? (previewEl.getAttribute('src') || '') : '';
    return {
      hero_media_id: isNaN(mediaId) ? null : mediaId,
      hero_media_url: url !== '' ? url : null
    };
  }

  document.getElementById('lst-article-create').addEventListener('click', function () {
    if (saving) { return; }
    clearFieldErrors();
    setTopError('');
    var hero = collectHero();
    var body = {
      site_id: val('lst-a-site'),
      article_name: val('lst-a-name'),
      slug: val('lst-a-slug'),
      headline: val('lst-v-headline'),
      intro_paragraph: val('lst-v-intro'),
      hero_media_id: hero.hero_media_id,
      hero_media_url: hero.hero_media_url,
      layout_style_id: val('lst-v-layout') || 'default'
    };
    saving = true;
    if (saveBtn) { saveBtn.disabled = true; }
    setText(statusEl, 'Saving\\u2026');
    getJson('POST', '/api/admin/listicles/articles', body).then(function (res) {
      saving = false;
      if (saveBtn) { saveBtn.disabled = false; }
      setText(statusEl, '');
      if (res.ok && res.body && res.body.article) {
        dirty = false;
        saving = true; // suppress the beforeunload guard through the redirect
        if (window.showToast) { window.showToast('Article created (control Version A)', 'success'); }
        window.location.href = '/admin/listicles/articles/' + encodeURIComponent(res.body.article.public_id) + '/edit';
        return;
      }
      if (res.body && res.body.fields) {
        var rest = [];
        var key;
        for (key in res.body.fields) {
          if (!Object.prototype.hasOwnProperty.call(res.body.fields, key)) { continue; }
          if (!setFieldError(key, res.body.fields[key])) { rest.push(key + ': ' + res.body.fields[key]); }
        }
        setTopError('The article was not created \\u2014 fix the highlighted problems.' + (rest.length ? ' (' + rest.join('; ') + ')' : ''));
        return;
      }
      setTopError((res.body && res.body.error) || ('Error ' + res.status));
    }).catch(function () {
      saving = false;
      if (saveBtn) { saveBtn.disabled = false; }
      setText(statusEl, '');
      setTopError('Network error \\u2014 the article was not created.');
    });
  });
}());
`;

// ---------------------------------------------------------------------------
// EDIT-mode script — the builder state machine (ES5).
// ---------------------------------------------------------------------------

const BUILDER_EDIT_SCRIPT = `
(function () {
  var boot = window._lstBuilderBoot || {};
  if (boot.mode !== 'edit') { return; }
  var getJson = window.lstUi.getJson;
  var S = {
    article: boot.article,
    experiment: boot.experiment,
    versions: boot.versions || [],
    active: 0,
    dirty: false,     // unsaved VERSION/base content (PUT-persisted state)
    expDirty: false,  // unsaved rail allocations/control (persisted by Start)
    saving: false
  };
  var DIMS = boot.setDimensions || [];
  var statusEl = document.getElementById('lst-builder-status');
  var topError = document.getElementById('lst-builder-toperror');
  var errorList = document.getElementById('lst-builder-errors');

  function setText(el, msg) {
    if (!el) { return; }
    while (el.firstChild) { el.removeChild(el.firstChild); }
    if (msg) { el.appendChild(document.createTextNode(msg)); }
  }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined && text !== null && text !== '') { node.appendChild(document.createTextNode(text)); }
    return node;
  }
  function setStatus(msg) { setText(statusEl, msg); }
  function setTopError(msg) { if (topError) { topError.hidden = !msg; setText(topError, msg || ''); } }
  function markDirty() { S.dirty = true; }
  function toast(msg, kind) { if (window.showToast) { window.showToast(msg, kind || 'success'); } }
  function activeVersion() { return S.versions[S.active]; }

  // ---- §8 unsaved-changes guard ------------------------------------------------
  window.addEventListener('beforeunload', function (e) {
    if ((S.dirty || S.expDirty) && !S.saving) {
      e.preventDefault();
      e.returnValue = 'You have unsaved builder changes.';
      return 'You have unsaved builder changes.';
    }
    return undefined;
  });
  var backLink = document.getElementById('lst-builder-back');
  if (backLink) {
    backLink.addEventListener('click', function (e) {
      if ((S.dirty || S.expDirty) && !window.confirm('Discard unsaved builder changes?')) {
        e.preventDefault();
        return;
      }
      S.dirty = false;
      S.expDirty = false;
    });
  }

  // ---- field errors -------------------------------------------------------------
  function clearErrors() {
    var els = document.querySelectorAll('.form-error');
    var i;
    for (i = 0; i < els.length; i++) { els[i].hidden = true; setText(els[i], ''); }
    if (errorList) { errorList.hidden = true; while (errorList.firstChild) { errorList.removeChild(errorList.firstChild); } }
    var pageErrs = document.querySelectorAll('[data-page-errors]');
    for (i = 0; i < pageErrs.length; i++) { setText(pageErrs[i], ''); pageErrs[i].hidden = true; }
  }
  function setFieldError(name, message) {
    var target = document.querySelector('[data-error-for="' + name + '"]');
    if (target) { target.hidden = false; setText(target, message); return true; }
    return false;
  }
  function renderErrors(fields, conflictsRendered) {
    var rest = [];
    var key, m;
    for (key in fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, key)) { continue; }
      var value = fields[key];
      if (Object.prototype.toString.call(value) === '[object Array]') { continue; } // §15.5 rows -> matrix
      m = key.match(/^page_(\\d+)\\./);
      if (m) {
        var box = document.querySelector('[data-page-errors="' + m[1] + '"]');
        if (box) {
          box.hidden = false;
          box.appendChild(el('div', 'form-error', key + ': ' + value));
          continue;
        }
      }
      if (!setFieldError(key, value)) { rest.push(key + ': ' + value); }
    }
    if (rest.length > 0 && errorList) {
      var ul = document.createElement('ul');
      var i;
      for (i = 0; i < rest.length; i++) { ul.appendChild(el('li', 'form-error', rest[i])); }
      errorList.appendChild(ul);
      errorList.hidden = false;
    }
    setTopError(conflictsRendered ? 'Rule conflict \\u2014 the save was blocked (§15.5). See the matrix below.' : 'The save was rejected \\u2014 fix the highlighted problems.');
  }

  // ---- §15.5 conflict matrix ------------------------------------------------------
  var conflictOut = document.getElementById('lst-conflict-out');
  function renderConflictPayload(body) {
    // fields entries that are ARRAYS are §15.5 overlap reports keyed
    // page_<idx>.rules; body.warnings carries cross-priority overlaps.
    var conflicts = [];
    var key;
    if (body && body.fields) {
      for (key in body.fields) {
        if (!Object.prototype.hasOwnProperty.call(body.fields, key)) { continue; }
        var value = body.fields[key];
        if (Object.prototype.toString.call(value) === '[object Array]') {
          var i;
          for (i = 0; i < value.length; i++) { conflicts.push(value[i]); }
        }
      }
    }
    var warnings = (body && body.warnings) || [];
    if (conflictOut && (conflicts.length > 0 || warnings.length > 0)) {
      conflictOut.hidden = false;
      window.lstConflictMatrix.render(conflictOut, conflicts, warnings,
        conflicts.length > 0 ? 'Rule conflict \\u2014 equal-priority overlapping rules block the save' : 'Cross-priority overlap warnings');
      conflictOut.scrollIntoView({ block: 'nearest' });
    }
    return conflicts.length > 0;
  }
  function clearConflicts() {
    if (conflictOut) { conflictOut.hidden = true; while (conflictOut.firstChild) { conflictOut.removeChild(conflictOut.firstChild); } }
  }

  // ---- base card -----------------------------------------------------------------
  var baseSave = document.getElementById('lst-article-save');
  if (baseSave) {
    baseSave.addEventListener('click', function () {
      clearErrors();
      setTopError('');
      var body = {
        site_id: document.getElementById('lst-a-site').value,
        article_name: document.getElementById('lst-a-name').value,
        slug: document.getElementById('lst-a-slug').value
      };
      setStatus('Saving\\u2026');
      getJson('PATCH', '/api/admin/listicles/articles/' + encodeURIComponent(S.article.public_id), body).then(function (res) {
        setStatus('');
        if (res.ok) { toast('Article base saved'); S.article = res.body.article; return; }
        if (res.body && res.body.fields) { renderErrors(res.body.fields, false); return; }
        setTopError((res.body && res.body.error) || ('Error ' + res.status));
      }).catch(function () { setStatus(''); setTopError('Network error \\u2014 not saved.'); });
    });
  }

  // ---- versions rail (§11/§15.8) ----------------------------------------------------
  var railEl = document.getElementById('lst-rail');
  var expSummary = document.getElementById('lst-exp-summary');
  var sigmaEl = document.getElementById('lst-exp-sigma');

  function experimentEditable() {
    return S.experiment !== null && S.experiment !== undefined && S.experiment.status === 'draft';
  }
  function experimentRunning() {
    return S.experiment !== null && S.experiment !== undefined && S.experiment.status === 'running';
  }

  function updateSigma() {
    if (!S.experiment) { sigmaEl.hidden = true; return; }
    var sum = 0;
    var i;
    for (i = 0; i < S.versions.length; i++) { sum += Number(S.versions[i].traffic_allocation) || 0; }
    sigmaEl.hidden = false;
    setText(sigmaEl, '\\u03a3 ' + sum + '%');
    sigmaEl.className = 'lst-sigma ' + (sum === 100 ? 'lst-sigma-ok' : 'lst-sigma-bad');
    var startBtn = document.getElementById('lst-exp-start');
    if (startBtn) { startBtn.disabled = sum !== 100; }
  }

  function renderRail() {
    while (railEl.firstChild) { railEl.removeChild(railEl.firstChild); }
    var i;
    for (i = 0; i < S.versions.length; i++) {
      (function (version, index) {
        var row = el('div', 'lst-rail-row' + (index === S.active ? ' active' : ''));
        row.setAttribute('data-version-index', String(index));
        row.setAttribute('data-lander-v', version.public_id);
        var radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'lst-exp-control';
        radio.title = 'Control';
        radio.checked = !!version.is_control;
        radio.disabled = !experimentEditable();
        radio.addEventListener('change', function () {
          var j;
          for (j = 0; j < S.versions.length; j++) { S.versions[j].is_control = j === index; }
          S.expDirty = true;
          renderRail();
        });
        row.appendChild(radio);
        row.appendChild(el('span', 'lst-rail-label', version.variant_label));
        if (version.is_control) { row.appendChild(el('span', 'badge badge-published', 'Control')); }
        row.appendChild(el('span', 'lst-rail-headline', version.headline + ' \\u00b7 ' + version.public_id + ' \\u00b7 rev ' + version.content_version));
        if (S.experiment) {
          var allocWrap = el('span', 'lst-rail-alloc');
          var alloc = document.createElement('input');
          alloc.type = 'number';
          alloc.min = '0';
          alloc.max = '100';
          alloc.className = 'form-input';
          alloc.value = String(version.traffic_allocation);
          alloc.setAttribute('aria-label', 'Traffic % for Version ' + version.variant_label);
          alloc.disabled = experimentRunning();
          alloc.addEventListener('input', function () {
            var v = parseInt(alloc.value, 10);
            version.traffic_allocation = isNaN(v) ? 0 : v;
            S.expDirty = true;
            updateSigma();
          });
          alloc.addEventListener('click', function (e) { e.stopPropagation(); });
          allocWrap.appendChild(alloc);
          row.appendChild(allocWrap);
          row.appendChild(el('span', '', '%'));
        }
        row.addEventListener('click', function (e) {
          if (e.target === radio || (e.target && e.target.nodeName === 'INPUT')) { return; }
          switchVersion(index);
        });
        railEl.appendChild(row);
      }(S.versions[i], i));
    }

    var abCreate = document.getElementById('lst-ab-create');
    var addVersion = document.getElementById('lst-add-version');
    var startBtn = document.getElementById('lst-exp-start');
    var stopBtn = document.getElementById('lst-exp-stop');
    abCreate.hidden = !!S.experiment;
    addVersion.hidden = !experimentEditable();
    startBtn.hidden = !experimentEditable();
    stopBtn.hidden = !experimentRunning();
    if (S.experiment) {
      setText(expSummary, 'Experiment \\u201c' + S.experiment.name + '\\u201d \\u00b7 ' + S.experiment.status + ' \\u00b7 ' + S.experiment.public_id +
        (experimentRunning() ? ' \\u2014 running Versions are immutable (§15.6): edits offer fork / new revision.' : ''));
    } else {
      setText(expSummary, 'No experiment \\u2014 the single control Version serves 100% of traffic.');
    }
    updateSigma();
  }

  // ---- version editor card ---------------------------------------------------------
  function vEl(id) { return document.getElementById(id); }

  function setHeroCard(mediaId, url) {
    var input = vEl('hero-image-input');
    var preview = vEl('hero-image-preview');
    var wrap = vEl('hero-image-preview-wrap');
    var empty = vEl('hero-image-empty');
    if (input) { input.value = mediaId === null || mediaId === undefined ? '' : String(mediaId); }
    if (preview) { preview.setAttribute('src', url || ''); }
    if (wrap) { wrap.hidden = !url; }
    if (empty) { empty.hidden = !!url; }
  }

  function loadVersionToDom(index) {
    var v = S.versions[index];
    setText(vEl('lst-version-card-title'), 'Version ' + v.variant_label + (v.is_control ? ' (control)' : '') + ' \\u2014 ' + v.public_id);
    setText(vEl('lst-version-revision'), 'content_version (revision): ' + v.content_version);
    vEl('lst-v-headline').value = v.headline || '';
    vEl('lst-v-intro').value = v.intro_paragraph || '';
    vEl('lst-v-layout').value = v.layout_style_id || 'default';
    setHeroCard(v.hero_media_id, v.hero_media_url || '');
    var b = v.byline || {};
    vEl('lst-b-enabled').checked = !!b.enabled;
    vEl('lst-b-author').value = b.author_name || '';
    vEl('lst-b-label').value = b.label || '';
    vEl('lst-b-updated-label').value = b.updated_label || '';
    vEl('lst-b-updated-date').value = b.updated_date || '';
    vEl('lst-b-avatar-url').value = b.author_avatar_url || '';
    vEl('lst-b-avatar-media-id').value = b.author_avatar_media_id ? String(b.author_avatar_media_id) : '';
    var avatarPreview = vEl('lst-b-avatar-preview');
    avatarPreview.hidden = !b.author_avatar_url;
    avatarPreview.setAttribute('src', b.author_avatar_url || '');
    var ai = v.ai_settings || {};
    vEl('lst-v-ai-prompt').value = ai.prompt || '';
    var presetSelect = vEl('lst-v-ai-preset');
    if (presetSelect) { presetSelect.value = ai.preset_id ? String(ai.preset_id) : ''; }
    renderPages();
  }

  function commitVersionFromDom(index) {
    var v = S.versions[index];
    v.headline = vEl('lst-v-headline').value;
    v.intro_paragraph = vEl('lst-v-intro').value;
    v.layout_style_id = vEl('lst-v-layout').value || 'default';
    var heroId = vEl('hero-image-input').value;
    var heroUrl = vEl('hero-image-preview').getAttribute('src') || '';
    v.hero_media_id = heroId === '' ? null : parseInt(heroId, 10);
    v.hero_media_url = heroUrl === '' ? null : heroUrl;
    var enabled = vEl('lst-b-enabled').checked;
    var author = vEl('lst-b-author').value;
    var label = vEl('lst-b-label').value;
    var updatedLabel = vEl('lst-b-updated-label').value;
    var updatedDate = vEl('lst-b-updated-date').value;
    var avatarUrl = vEl('lst-b-avatar-url').value;
    var avatarMedia = vEl('lst-b-avatar-media-id').value;
    if (enabled || author !== '' || avatarUrl !== '' || updatedDate !== '') {
      v.byline = { enabled: enabled, author_name: author, label: label, updated_label: updatedLabel, updated_date: updatedDate };
      if (avatarUrl !== '') { v.byline.author_avatar_url = avatarUrl; }
      if (avatarMedia !== '') { v.byline.author_avatar_media_id = parseInt(avatarMedia, 10); }
    } else {
      v.byline = null;
    }
    var preset = vEl('lst-v-ai-preset').value;
    var prompt = vEl('lst-v-ai-prompt').value.replace(/^\\s+|\\s+$/g, '');
    if (preset !== '' || prompt !== '') {
      v.ai_settings = {};
      if (preset !== '') { v.ai_settings.preset_id = parseInt(preset, 10); }
      if (prompt !== '') { v.ai_settings.prompt = prompt; }
    } else {
      v.ai_settings = null;
    }
  }

  function switchVersion(index) {
    if (index === S.active) { return; }
    commitVersionFromDom(S.active);
    S.active = index;
    renderRail();
    loadVersionToDom(index);
    renderPreviewControls();
  }

  // AI presets feed (shared endpoint; the card degrades quietly without it).
  (function loadPresets() {
    var select = vEl('lst-v-ai-preset');
    if (!select) { return; }
    getJson('GET', '/api/admin/ai/presets?active_only=true&per_page=200').then(function (res) {
      if (!res.ok || !res.body) { return; }
      var rows = res.body.items || res.body.presets || [];
      var i, opt;
      for (i = 0; i < rows.length; i++) {
        opt = document.createElement('option');
        opt.value = String(rows[i].id);
        opt.appendChild(document.createTextNode(rows[i].name || ('Preset #' + rows[i].id)));
        select.appendChild(opt);
      }
      var ai = activeVersion() && activeVersion().ai_settings;
      if (ai && ai.preset_id) { select.value = String(ai.preset_id); }
    }).catch(function () { /* optional */ });
  }());

  // Byline avatar upload — the same POST /admin/media the hero card uses.
  var avatarUploadBtn = vEl('lst-b-avatar-upload');
  var avatarFile = vEl('lst-b-avatar-file');
  if (avatarUploadBtn && avatarFile) {
    avatarUploadBtn.addEventListener('click', function () { avatarFile.click(); });
    avatarFile.addEventListener('change', function () {
      var file = avatarFile.files && avatarFile.files[0];
      if (!file) { return; }
      setStatus('Uploading avatar\\u2026');
      var fd = new FormData();
      fd.append('file', file);
      fetch('/admin/media', { method: 'POST', body: fd, credentials: 'same-origin' })
        .then(function (res) { return res.json().then(function (j) { return { ok: res.ok, body: j }; }); })
        .then(function (res) {
          setStatus('');
          if (!res.ok) { toast('Avatar upload failed', 'error'); return; }
          var url = res.body && res.body.storage_key ? '/media/' + res.body.storage_key : '';
          vEl('lst-b-avatar-url').value = url;
          vEl('lst-b-avatar-media-id').value = res.body && res.body.id ? String(res.body.id) : '';
          var preview = vEl('lst-b-avatar-preview');
          preview.hidden = url === '';
          preview.setAttribute('src', url);
          markDirty();
        })
        .catch(function () { setStatus(''); toast('Avatar upload failed', 'error'); });
    });
  }

  // ---- pages builder (§11/§15.4/§15.5/§23) --------------------------------------------
  var pagesList = document.getElementById('lst-pages-list');

  function makeTagInput(values, onChange) {
    // A tag-input set (§15.4 set dims): chips + a text entry; Enter or comma
    // commits a value, Backspace on empty removes the last chip.
    var wrap = el('span', 'lst-tags');
    function renderChips() {
      while (wrap.firstChild) { wrap.removeChild(wrap.firstChild); }
      var i;
      for (i = 0; i < values.length; i++) {
        (function (value, idx) {
          var chip = el('span', 'lst-tag', value);
          var x = el('button', '', '\\u00d7');
          x.type = 'button';
          x.title = 'Remove ' + value;
          x.addEventListener('click', function () {
            values.splice(idx, 1);
            renderChips();
            onChange();
          });
          chip.appendChild(x);
          wrap.appendChild(chip);
        }(values[i], i));
      }
      wrap.appendChild(entry);
    }
    var entry = document.createElement('input');
    entry.type = 'text';
    entry.setAttribute('aria-label', 'Add value');
    entry.placeholder = values.length === 0 ? 'value, value\\u2026' : '';
    function commit() {
      var raw = entry.value.replace(/^\\s+|\\s+$/g, '');
      if (raw === '') { return; }
      var parts = raw.split(',');
      var i, p;
      for (i = 0; i < parts.length; i++) {
        p = parts[i].replace(/^\\s+|\\s+$/g, '');
        if (p !== '') { values.push(p); }
      }
      entry.value = '';
      renderChips();
      onChange();
      entry.focus();
    }
    entry.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
      else if (e.key === 'Backspace' && entry.value === '' && values.length > 0) {
        values.pop();
        renderChips();
        onChange();
        entry.focus();
      }
    });
    entry.addEventListener('blur', commit);
    renderChips();
    return wrap;
  }

  function ruleModel(cand) {
    // Client rule model: { priority, sets: {dim: [values]}, hour: [s,e]|null,
    // dayparts: [[s,e],...] } — serialized to the §15.4 typed conditions.
    if (!cand._rule) {
      var parsed = { sets: {}, ranges: {} };
      if (cand.rule && cand.rule.conditions_json) {
        try { parsed = JSON.parse(cand.rule.conditions_json) || {}; } catch (e) { parsed = {}; }
      }
      var sets = {};
      var dim;
      var srcSets = parsed.sets || {};
      for (dim in srcSets) {
        if (Object.prototype.hasOwnProperty.call(srcSets, dim)) { sets[dim] = (srcSets[dim] || []).slice(); }
      }
      var ranges = parsed.ranges || {};
      cand._rule = {
        priority: cand.rule ? cand.rule.priority : 1,
        public_id: cand.rule ? cand.rule.public_id : null,
        sets: sets,
        hour: ranges.hour ? [ranges.hour[0], ranges.hour[1]] : null,
        dayparts: (ranges.daypart || []).slice()
      };
    }
    return cand._rule;
  }

  function ruleConditions(rule) {
    var conditions = {};
    var sets = {};
    var hasSets = false;
    var dim;
    for (dim in rule.sets) {
      if (Object.prototype.hasOwnProperty.call(rule.sets, dim) && rule.sets[dim].length > 0) {
        sets[dim] = rule.sets[dim];
        hasSets = true;
      }
    }
    if (hasSets) { conditions.sets = sets; }
    var ranges = {};
    var hasRanges = false;
    if (rule.hour && !isNaN(rule.hour[0]) && !isNaN(rule.hour[1])) { ranges.hour = rule.hour; hasRanges = true; }
    if (rule.dayparts && rule.dayparts.length > 0) { ranges.daypart = rule.dayparts; hasRanges = true; }
    if (hasRanges) { conditions.ranges = ranges; }
    return conditions;
  }

  function renderRuleEditor(page, cand, pageIdx, candIdx) {
    var rule = ruleModel(cand);
    var box = el('div', 'lst-rule-editor');
    var head = el('div', 'lst-rule-row');
    head.appendChild(el('span', 'form-label', 'Rule \\u00b7 priority'));
    var prio = document.createElement('input');
    prio.type = 'number';
    prio.className = 'form-input lst-rule-priority';
    prio.style.width = '70px';
    prio.value = String(rule.priority);
    prio.setAttribute('aria-label', 'Rule priority (lower evaluates first)');
    prio.addEventListener('input', function () {
      var v = parseInt(prio.value, 10);
      rule.priority = isNaN(v) ? 1 : v;
      markDirty();
    });
    head.appendChild(prio);
    head.appendChild(el('span', 'form-help', 'lower = evaluated first; first match wins (§15.4)'));
    box.appendChild(head);

    var dimsBox = el('div', 'lst-rule-dims');
    function renderDimRows() {
      while (dimsBox.firstChild) { dimsBox.removeChild(dimsBox.firstChild); }
      var dim;
      for (dim in rule.sets) {
        if (!Object.prototype.hasOwnProperty.call(rule.sets, dim)) { continue; }
        (function (d) {
          var row = el('div', 'lst-rule-row');
          row.setAttribute('data-rule-dim', d);
          row.appendChild(el('span', 'form-label', d));
          row.appendChild(makeTagInput(rule.sets[d], markDirty));
          var rm = el('button', 'btn btn-sm btn-outline', 'remove');
          rm.type = 'button';
          rm.addEventListener('click', function () {
            delete rule.sets[d];
            renderDimRows();
            markDirty();
          });
          row.appendChild(rm);
          dimsBox.appendChild(row);
        }(dim));
      }
      var addRow = el('div', 'lst-rule-row');
      var dimSelect = document.createElement('select');
      dimSelect.className = 'form-select lst-rule-add-dim';
      dimSelect.setAttribute('aria-label', 'Add a targeting dimension');
      var opt = document.createElement('option');
      opt.value = '';
      opt.appendChild(document.createTextNode('+ Add dimension\\u2026'));
      dimSelect.appendChild(opt);
      var i;
      for (i = 0; i < DIMS.length; i++) {
        if (Object.prototype.hasOwnProperty.call(rule.sets, DIMS[i])) { continue; }
        opt = document.createElement('option');
        opt.value = DIMS[i];
        opt.appendChild(document.createTextNode(DIMS[i]));
        dimSelect.appendChild(opt);
      }
      dimSelect.addEventListener('change', function () {
        if (dimSelect.value === '') { return; }
        rule.sets[dimSelect.value] = [];
        renderDimRows();
        markDirty();
      });
      addRow.appendChild(dimSelect);
      dimsBox.appendChild(addRow);
    }
    renderDimRows();
    box.appendChild(dimsBox);

    var hourRow = el('div', 'lst-hour-inputs');
    hourRow.appendChild(el('span', 'form-label', 'Hour range'));
    var hs = document.createElement('input');
    hs.type = 'number'; hs.min = '0'; hs.max = '24'; hs.className = 'form-input';
    hs.placeholder = 'from';
    hs.setAttribute('aria-label', 'Hour range start');
    var he = document.createElement('input');
    he.type = 'number'; he.min = '0'; he.max = '24'; he.className = 'form-input';
    he.placeholder = 'to';
    he.setAttribute('aria-label', 'Hour range end');
    if (rule.hour) { hs.value = String(rule.hour[0]); he.value = String(rule.hour[1]); }
    function syncHour() {
      var a = parseFloat(hs.value);
      var b = parseFloat(he.value);
      rule.hour = (!isNaN(a) && !isNaN(b)) ? [a, b] : null;
      markDirty();
    }
    hs.addEventListener('input', syncHour);
    he.addEventListener('input', syncHour);
    hourRow.appendChild(hs);
    hourRow.appendChild(el('span', '', '\\u2013'));
    hourRow.appendChild(he);
    hourRow.appendChild(el('span', 'form-help', 'half-open [from, to) \\u00b7 0\\u201324'));
    var addDaypart = el('button', 'btn btn-sm btn-outline', '+ daypart');
    addDaypart.type = 'button';
    addDaypart.title = 'Add an extra daypart interval';
    addDaypart.addEventListener('click', function () {
      rule.dayparts.push([6, 12]);
      renderPages();
      markDirty();
    });
    hourRow.appendChild(addDaypart);
    box.appendChild(hourRow);

    var d;
    for (d = 0; d < rule.dayparts.length; d++) {
      (function (idx) {
        var dpRow = el('div', 'lst-hour-inputs');
        dpRow.setAttribute('data-daypart-index', String(idx));
        dpRow.appendChild(el('span', 'form-label', 'daypart ' + (idx + 1)));
        var a = document.createElement('input');
        a.type = 'number'; a.min = '0'; a.max = '24'; a.className = 'form-input';
        a.value = String(rule.dayparts[idx][0]);
        var b = document.createElement('input');
        b.type = 'number'; b.min = '0'; b.max = '24'; b.className = 'form-input';
        b.value = String(rule.dayparts[idx][1]);
        function syncDp() {
          var x = parseFloat(a.value);
          var y = parseFloat(b.value);
          if (!isNaN(x) && !isNaN(y)) { rule.dayparts[idx] = [x, y]; markDirty(); }
        }
        a.addEventListener('input', syncDp);
        b.addEventListener('input', syncDp);
        var rm = el('button', 'btn btn-sm btn-outline', 'remove');
        rm.type = 'button';
        rm.addEventListener('click', function () {
          rule.dayparts.splice(idx, 1);
          renderPages();
          markDirty();
        });
        dpRow.appendChild(a);
        dpRow.appendChild(el('span', '', '\\u2013'));
        dpRow.appendChild(b);
        dpRow.appendChild(rm);
        box.appendChild(dpRow);
      }(d));
    }
    return box;
  }

  function pageSigma(page) {
    var sum = 0;
    var i;
    for (i = 0; i < page.candidates.length; i++) { sum += Number(page.candidates[i].traffic_allocation) || 0; }
    return sum;
  }

  function renderPages() {
    var v = activeVersion();
    while (pagesList.firstChild) { pagesList.removeChild(pagesList.firstChild); }
    if (!v) { return; }
    var i;
    for (i = 0; i < v.pages.length; i++) {
      (function (page, pageIdx) {
        var card = el('div', 'lst-page-card');
        card.setAttribute('data-page-index', String(page.page_index));
        var head = el('div', 'lst-page-head');
        head.appendChild(el('span', 'lst-page-title', 'Page ' + (page.page_index + 1)));
        var modeSelect = document.createElement('select');
        modeSelect.className = 'form-select lst-page-mode';
        modeSelect.setAttribute('aria-label', 'Selection mode for page ' + (page.page_index + 1));
        var modes = ['single', 'ab_test', 'rule_based'];
        var m, opt;
        for (m = 0; m < modes.length; m++) {
          opt = document.createElement('option');
          opt.value = modes[m];
          opt.appendChild(document.createTextNode(modes[m]));
          if (page.selection_mode === modes[m]) { opt.selected = true; }
          modeSelect.appendChild(opt);
        }
        modeSelect.addEventListener('change', function () {
          page.selection_mode = modeSelect.value;
          markDirty();
          renderPages();
        });
        head.appendChild(modeSelect);
        if (page.selection_mode === 'ab_test') {
          head.appendChild(el('span', 'lst-page-abid', 'ab_test_id: ' + (page.ab_test_id || '(on save)')));
          var sum = pageSigma(page);
          var sigma = el('span', 'lst-sigma ' + (sum === 100 ? 'lst-sigma-ok' : 'lst-sigma-bad'), '\\u03a3 ' + sum + '%');
          sigma.setAttribute('data-page-sigma', String(page.page_index));
          head.appendChild(sigma);
        }
        if (page.selection_mode === 'rule_based') {
          var validateBtn = el('button', 'btn btn-sm btn-outline lst-rule-validate', 'Validate rules');
          validateBtn.type = 'button';
          if (!page.public_id) {
            validateBtn.disabled = true;
            validateBtn.title = 'Save the Version once first \\u2014 Save runs the same §15.5 guard';
          }
          validateBtn.addEventListener('click', function () { validatePageRules(page); });
          head.appendChild(validateBtn);
        }
        var tools = el('span', 'lst-page-tools');
        var up = el('button', 'btn btn-sm btn-outline', '\\u2191');
        up.type = 'button'; up.title = 'Move page up';
        up.disabled = pageIdx === 0;
        up.addEventListener('click', function () { movePage(pageIdx, -1); });
        var down = el('button', 'btn btn-sm btn-outline', '\\u2193');
        down.type = 'button'; down.title = 'Move page down';
        down.disabled = pageIdx === v.pages.length - 1;
        down.addEventListener('click', function () { movePage(pageIdx, 1); });
        var rm = el('button', 'btn btn-sm btn-danger', 'Remove');
        rm.type = 'button';
        rm.addEventListener('click', function () {
          if (!window.confirm('Remove page ' + (page.page_index + 1) + '?')) { return; }
          v.pages.splice(pageIdx, 1);
          reindexPages();
          markDirty();
          renderPages();
        });
        tools.appendChild(up);
        tools.appendChild(down);
        tools.appendChild(rm);
        head.appendChild(tools);
        card.appendChild(head);

        var errBox = el('div', '', '');
        errBox.setAttribute('data-page-errors', String(page.page_index));
        errBox.hidden = true;
        card.appendChild(errBox);

        var table = document.createElement('table');
        table.className = 'lst-cand-table';
        var thead = document.createElement('thead');
        var htr = document.createElement('tr');
        var cols = ['Label', 'Section'];
        if (page.selection_mode === 'ab_test') { cols.push('Traffic %'); }
        if (page.selection_mode === 'rule_based') { cols.push('Fallback'); cols.push('Rule'); }
        cols.push('');
        var cIdx;
        for (cIdx = 0; cIdx < cols.length; cIdx++) {
          var th = document.createElement('th');
          th.appendChild(document.createTextNode(cols[cIdx]));
          htr.appendChild(th);
        }
        thead.appendChild(htr);
        table.appendChild(thead);
        var tbody = document.createElement('tbody');
        var j;
        for (j = 0; j < page.candidates.length; j++) {
          (function (cand, candIdx) {
            var tr = document.createElement('tr');
            tr.className = 'lst-cand-row';
            tr.setAttribute('data-cand-label', cand.label);
            var td = document.createElement('td');
            var labelInput = document.createElement('input');
            labelInput.type = 'text';
            labelInput.className = 'form-input';
            labelInput.style.width = '48px';
            labelInput.value = cand.label;
            labelInput.setAttribute('aria-label', 'Candidate label');
            labelInput.addEventListener('input', function () { cand.label = labelInput.value; markDirty(); });
            td.appendChild(labelInput);
            tr.appendChild(td);
            td = document.createElement('td');
            td.appendChild(document.createTextNode(cand.section_name || ('section #' + cand.section_id)));
            tr.appendChild(td);
            if (page.selection_mode === 'ab_test') {
              td = document.createElement('td');
              td.className = 'lst-cand-alloc';
              var alloc = document.createElement('input');
              alloc.type = 'number';
              alloc.min = '0'; alloc.max = '100';
              alloc.className = 'form-input lst-cand-alloc-input';
              alloc.value = cand.traffic_allocation === null || cand.traffic_allocation === undefined ? '' : String(cand.traffic_allocation);
              alloc.setAttribute('aria-label', 'Traffic % for candidate ' + cand.label);
              alloc.addEventListener('input', function () {
                var val = parseInt(alloc.value, 10);
                cand.traffic_allocation = isNaN(val) ? null : val;
                markDirty();
                var sigmaEl2 = card.querySelector('[data-page-sigma]');
                if (sigmaEl2) {
                  var s = pageSigma(page);
                  while (sigmaEl2.firstChild) { sigmaEl2.removeChild(sigmaEl2.firstChild); }
                  sigmaEl2.appendChild(document.createTextNode('\\u03a3 ' + s + '%'));
                  sigmaEl2.className = 'lst-sigma ' + (s === 100 ? 'lst-sigma-ok' : 'lst-sigma-bad');
                }
              });
              td.appendChild(alloc);
              tr.appendChild(td);
            }
            if (page.selection_mode === 'rule_based') {
              td = document.createElement('td');
              var fb = document.createElement('input');
              fb.type = 'radio';
              fb.name = 'lst-fallback-' + page.page_index;
              fb.className = 'lst-cand-fallback';
              fb.checked = !!cand.is_fallback;
              fb.setAttribute('aria-label', 'Fallback candidate (exactly one per rule_based page)');
              fb.addEventListener('change', function () {
                var k;
                for (k = 0; k < page.candidates.length; k++) { page.candidates[k].is_fallback = k === candIdx; }
                markDirty();
                renderPages();
              });
              td.appendChild(fb);
              tr.appendChild(td);
              td = document.createElement('td');
              if (!cand.is_fallback) {
                td.appendChild(renderRuleEditor(page, cand, pageIdx, candIdx));
              } else {
                td.appendChild(el('span', 'form-help', 'Catch-all \\u2014 serves everyone no rule matched.'));
              }
              tr.appendChild(td);
            }
            td = document.createElement('td');
            var replace = el('button', 'btn btn-sm btn-outline', 'Replace');
            replace.type = 'button';
            replace.title = 'Pick a different Section';
            replace.addEventListener('click', function () {
              window.lstSectionPicker.open({
                title: 'Replace the Section for candidate ' + cand.label,
                onSelect: function (section) {
                  cand.section_id = section.id;
                  cand.section_name = section.section_name;
                  markDirty();
                  renderPages();
                }
              });
            });
            var del = el('button', 'btn btn-sm btn-outline', '\\u00d7');
            del.type = 'button';
            del.title = 'Remove candidate';
            del.addEventListener('click', function () {
              page.candidates.splice(candIdx, 1);
              markDirty();
              renderPages();
            });
            td.appendChild(replace);
            td.appendChild(del);
            tr.appendChild(td);
            tbody.appendChild(tr);
          }(page.candidates[j], j));
        }
        table.appendChild(tbody);
        card.appendChild(table);

        var addCand = el('button', 'btn btn-sm btn-secondary lst-cand-add', '+ Add Section candidate');
        addCand.type = 'button';
        if (page.selection_mode === 'single' && page.candidates.length >= 1) {
          addCand.disabled = true;
          addCand.title = "a 'single' page carries exactly one Section candidate (§23)";
        }
        addCand.addEventListener('click', function () {
          window.lstSectionPicker.open({
            title: 'Add a Section candidate to page ' + (page.page_index + 1),
            onSelect: function (section) {
              var label = String.fromCharCode(65 + (page.candidates.length % 26));
              page.candidates.push({
                public_id: null,
                section_id: section.id,
                section_name: section.section_name,
                label: label,
                traffic_allocation: page.selection_mode === 'ab_test' ? 0 : null,
                is_fallback: false,
                rule: null
              });
              markDirty();
              renderPages();
            }
          });
        });
        card.appendChild(addCand);
        pagesList.appendChild(card);
      }(v.pages[i], i));
    }
  }

  function reindexPages() {
    var v = activeVersion();
    var i;
    for (i = 0; i < v.pages.length; i++) { v.pages[i].page_index = i; }
  }

  function movePage(index, delta) {
    var v = activeVersion();
    var target = index + delta;
    if (target < 0 || target >= v.pages.length) { return; }
    var tmp = v.pages[index];
    v.pages[index] = v.pages[target];
    v.pages[target] = tmp;
    reindexPages();
    markDirty();
    renderPages();
  }

  document.getElementById('lst-page-add').addEventListener('click', function () {
    var v = activeVersion();
    window.lstSectionPicker.open({
      title: 'Choose the Section for the new page',
      onSelect: function (section) {
        v.pages.push({
          public_id: null,
          page_index: v.pages.length,
          selection_mode: 'single',
          ab_test_id: null,
          rule_set_id: null,
          candidates: [{
            public_id: null,
            section_id: section.id,
            section_name: section.section_name,
            label: 'A',
            traffic_allocation: null,
            is_fallback: false,
            rule: null
          }]
        });
        markDirty();
        renderPages();
      }
    });
  });

  // ---- payload -------------------------------------------------------------------
  function candidatePayload(page, cand) {
    var out = {
      public_id: cand.public_id,
      section_id: cand.section_id,
      label: cand.label,
      is_fallback: !!cand.is_fallback
    };
    if (page.selection_mode === 'ab_test') { out.traffic_allocation = cand.traffic_allocation; }
    if (page.selection_mode === 'rule_based' && !cand.is_fallback) {
      var rule = ruleModel(cand);
      out.rule = {
        public_id: rule.public_id,
        priority: rule.priority,
        conditions: ruleConditions(rule)
      };
    }
    return out;
  }

  function versionPayload(v) {
    var pages = [];
    var i, j, page, cands;
    for (i = 0; i < v.pages.length; i++) {
      page = v.pages[i];
      cands = [];
      for (j = 0; j < page.candidates.length; j++) { cands.push(candidatePayload(page, page.candidates[j])); }
      pages.push({
        public_id: page.public_id,
        page_index: page.page_index,
        selection_mode: page.selection_mode,
        ab_test_id: page.ab_test_id,
        rule_set_id: page.rule_set_id,
        candidates: cands
      });
    }
    return {
      headline: v.headline,
      intro_paragraph: v.intro_paragraph,
      hero_media_id: v.hero_media_id,
      hero_media_url: v.hero_media_url,
      layout_style_id: v.layout_style_id,
      ai_settings: v.ai_settings,
      byline: v.byline,
      pages: pages
    };
  }

  function adoptSavedVersion(v, body) {
    if (body.version) {
      v.content_version = body.version.content_version;
      v.headline = body.version.headline;
      v.intro_paragraph = body.version.intro_paragraph;
      v.byline = null;
      if (body.version.byline_json) {
        try { v.byline = JSON.parse(body.version.byline_json); } catch (e) { v.byline = null; }
      }
    }
    if (body.pages) {
      var pages = [];
      var i, j, page, cands, cand;
      for (i = 0; i < body.pages.length; i++) {
        page = body.pages[i];
        cands = [];
        for (j = 0; j < page.candidates.length; j++) {
          cand = page.candidates[j];
          cands.push({
            public_id: cand.public_id,
            section_id: cand.section_id,
            section_name: cand.section_name,
            label: cand.label,
            traffic_allocation: cand.traffic_allocation,
            is_fallback: cand.is_fallback === 1 || cand.is_fallback === true,
            rule: cand.rule ? { public_id: cand.rule.public_id, priority: cand.rule.priority, conditions_json: cand.rule.conditions_json } : null
          });
        }
        pages.push({
          public_id: page.public_id,
          page_index: page.page_index,
          selection_mode: page.selection_mode,
          ab_test_id: page.ab_test_id,
          rule_set_id: page.rule_set_id,
          candidates: cands
        });
      }
      v.pages = pages;
    }
  }

  // ---- save + the §15.6/§30.7 immutability dialog -----------------------------------
  var immModal = document.getElementById('lst-immutable-modal');
  var pendingPayload = null;

  // A fork may join ONLY a DRAFT experiment the source belongs to (§15.8:
  // a running experiment's Σ=100 and arm set are locked — the server 409s
  // experiment_not_joinable; stopped experiments are history).
  function forkJoinAvailable() {
    var v = activeVersion();
    return !!(S.experiment && S.experiment.status === 'draft' &&
      v && v.experiment_id !== null && v.experiment_id !== undefined &&
      v.experiment_id === S.experiment.id);
  }

  function openImmutabilityDialog(reasonCode, message) {
    setText(document.getElementById('lst-immutable-reason'),
      (reasonCode === 'running_version_immutable'
        ? 'This Version belongs to a RUNNING experiment (§15.6).'
        : 'This Version belongs to a PUBLISHED article and your edit is behavioral (§30.7 case c).') +
      ' ' + (message || ''));
    var joinable = forkJoinAvailable();
    document.getElementById('lst-imm-join-wrap').hidden = !joinable;
    var note = document.getElementById('lst-imm-standalone-note');
    note.hidden = joinable;
    if (!joinable) {
      setText(note, 'The fork lands as a standalone DRAFT Version.' +
        (reasonCode === 'running_version_immutable'
          ? ' Joining a RUNNING experiment is not allowed (§15.8: its \\u03a3=100 split and arm set are locked while running) \\u2014 stop the experiment and compose a new draft to test the fork.'
          : ''));
    }
    immModal.style.display = 'flex';
    immModal.classList.remove('hidden');
    immModal.setAttribute('aria-hidden', 'false');
  }
  function closeImmutabilityDialog() {
    immModal.style.display = 'none';
    immModal.classList.add('hidden');
    immModal.setAttribute('aria-hidden', 'true');
  }
  document.getElementById('lst-imm-cancel').addEventListener('click', closeImmutabilityDialog);

  document.getElementById('lst-imm-confirm').addEventListener('click', function () {
    var v = activeVersion();
    var payload = pendingPayload;
    if (!payload) { closeImmutabilityDialog(); return; }
    var choice = document.getElementById('lst-imm-fork').checked ? 'fork' : 'revision';
    var join = !document.getElementById('lst-imm-join-wrap').hidden && document.getElementById('lst-imm-join').checked;
    closeImmutabilityDialog();
    setStatus('Working\\u2026');
    if (choice === 'revision') {
      getJson('POST', '/api/admin/listicles/versions/' + encodeURIComponent(v.public_id) + '/new-revision', payload).then(function (res) {
        setStatus('');
        if (res.ok) {
          adoptSavedVersion(v, res.body);
          S.dirty = false;
          toast('New revision period started \\u2014 same lander_v, revision ' + v.content_version);
          renderRail();
          loadVersionToDom(S.active);
          runPreview();
          return;
        }
        if (res.body && res.body.fields) {
          var blocked = renderConflictPayload(res.body);
          renderErrors(res.body.fields, blocked);
          return;
        }
        setTopError((res.body && res.body.error) || ('Error ' + res.status));
      }).catch(function () { setStatus(''); setTopError('Network error.'); });
      return;
    }
    // fork: clone (§15.6) → apply the pending edits onto the fork. The
    // pending payload still carries the SOURCE version's page/candidate/rule
    // public ids — those stay owned by the source, so they are STRIPPED and
    // the server mints fresh ones under the fork (ab_test_id/rule_set_id are
    // group ids, not unique — they ride along for §23 continuity). The edits
    // apply via new-revision: this dialog IS the explicit §30.7-case-c
    // operator action, and a plain PUT would re-trip the published-article
    // behavioral gate on the fork itself; the fresh fork never served, so
    // its bump to revision 2 mixes no data.
    var forkPayload = (function () {
      var copy = JSON.parse(JSON.stringify(payload));
      var i, j, page;
      for (i = 0; i < (copy.pages || []).length; i++) {
        page = copy.pages[i];
        page.public_id = null;
        for (j = 0; j < (page.candidates || []).length; j++) {
          page.candidates[j].public_id = null;
          if (page.candidates[j].rule) { page.candidates[j].rule.public_id = null; }
        }
      }
      return copy;
    }());
    getJson('POST', '/api/admin/listicles/versions/' + encodeURIComponent(v.public_id) + '/fork', { join_experiment: join }).then(function (res) {
      if (!res.ok || !res.body || !res.body.version) {
        setStatus('');
        setTopError((res.body && res.body.error) || 'Fork failed');
        return null;
      }
      var forkId = res.body.version.public_id;
      var url = '/api/admin/listicles/versions/' + encodeURIComponent(forkId) + '/new-revision';
      return getJson('POST', url, forkPayload).then(function (res2) {
        setStatus('');
        if (res2.ok) {
          S.dirty = false;
          S.saving = true;
          toast('Forked to a new Version (new lander_v: ' + forkId + ')');
          window.location.reload();
          return;
        }
        if (res2.body && res2.body.fields) {
          var blocked = renderConflictPayload(res2.body);
          renderErrors(res2.body.fields, blocked);
          return;
        }
        setTopError((res2.body && res2.body.error) || ('Error ' + res2.status));
      });
    }).catch(function () { setStatus(''); setTopError('Network error.'); });
  });

  var versionSaveBtn = document.getElementById('lst-version-save');
  versionSaveBtn.addEventListener('click', function () {
    if (S.saving) { return; }
    commitVersionFromDom(S.active);
    clearErrors();
    clearConflicts();
    setTopError('');
    var v = activeVersion();
    var payload = versionPayload(v);
    S.saving = true;
    versionSaveBtn.disabled = true;
    setStatus('Saving\\u2026');
    getJson('PUT', '/api/admin/listicles/versions/' + encodeURIComponent(v.public_id), payload).then(function (res) {
      S.saving = false;
      versionSaveBtn.disabled = false;
      setStatus('');
      if (res.ok) {
        adoptSavedVersion(v, res.body);
        S.dirty = false;
        toast('Version ' + v.variant_label + ' saved');
        if (res.body.warnings && res.body.warnings.length > 0 && conflictOut) {
          conflictOut.hidden = false;
          window.lstConflictMatrix.render(conflictOut, [], res.body.warnings, 'Cross-priority overlap warnings (§15.5 \\u2014 allowed, surfaced)');
        }
        renderRail();
        loadVersionToDom(S.active);
        runPreview();
        return;
      }
      if (res.status === 409 && res.body && (res.body.error === 'running_version_immutable' || res.body.error === 'published_version_immutable')) {
        pendingPayload = payload;
        openImmutabilityDialog(res.body.error, res.body.fields && res.body.fields.version);
        return;
      }
      if (res.body && res.body.fields) {
        var blocked = renderConflictPayload(res.body);
        renderErrors(res.body.fields, blocked);
        return;
      }
      setTopError((res.body && res.body.error) || ('Error ' + res.status));
    }).catch(function () {
      S.saving = false;
      versionSaveBtn.disabled = false;
      setStatus('');
      setTopError('Network error \\u2014 the Version was not saved.');
    });
  });

  // ---- Validate rules (POST /pages/:id/validate → §15.5 matrix) ---------------------
  function validatePageRules(page) {
    clearConflicts();
    var payload = {
      page_index: page.page_index,
      selection_mode: page.selection_mode,
      candidates: []
    };
    var j;
    for (j = 0; j < page.candidates.length; j++) { payload.candidates.push(candidatePayload(page, page.candidates[j])); }
    setStatus('Validating\\u2026');
    getJson('POST', '/api/admin/listicles/pages/' + encodeURIComponent(page.public_id) + '/validate', payload).then(function (res) {
      setStatus('');
      if (res.ok) {
        if (res.body.warnings && res.body.warnings.length > 0 && conflictOut) {
          conflictOut.hidden = false;
          window.lstConflictMatrix.render(conflictOut, [], res.body.warnings, 'Cross-priority overlap warnings (§15.5 \\u2014 allowed, surfaced)');
        } else {
          toast('No rule conflicts on page ' + (page.page_index + 1));
        }
        return;
      }
      if (res.body && res.body.fields) {
        var blocked = renderConflictPayload(res.body);
        if (!blocked) { renderErrors(res.body.fields, false); }
        return;
      }
      setTopError((res.body && res.body.error) || ('Error ' + res.status));
    }).catch(function () { setStatus(''); setTopError('Network error during validation.'); });
  }

  // ---- experiment actions -----------------------------------------------------------
  function requireCleanState() {
    if (S.dirty) {
      toast('Save (or discard) your Version edits first', 'warning');
      return false;
    }
    return true;
  }

  document.getElementById('lst-ab-create').addEventListener('click', function () {
    document.getElementById('lst-exp-newname-wrap').hidden = false;
    document.getElementById('lst-ab-create').hidden = true;
    document.getElementById('lst-exp-name').focus();
  });

  document.getElementById('lst-exp-create-confirm').addEventListener('click', function () {
    if (!requireCleanState()) { return; }
    var name = document.getElementById('lst-exp-name').value.replace(/^\\s+|\\s+$/g, '');
    if (name === '') {
      toast('Give the experiment a name', 'warning');
      return;
    }
    var control = null;
    var i;
    for (i = 0; i < S.versions.length; i++) { if (S.versions[i].is_control) { control = S.versions[i]; } }
    if (!control) { control = S.versions[0]; }
    var body = {
      name: name,
      status: 'draft',
      versions: [{ version_id: control.public_id, traffic_allocation: 100, is_control: true, variant_label: control.variant_label }]
    };
    setStatus('Creating experiment\\u2026');
    getJson('POST', '/api/admin/listicles/articles/' + encodeURIComponent(S.article.public_id) + '/experiments', body).then(function (res) {
      setStatus('');
      if (res.ok) {
        S.saving = true;
        toast('A/B experiment created (draft) \\u2014 add a Version and set the split');
        window.location.reload();
        return;
      }
      if (res.body && res.body.fields) { renderErrors(res.body.fields, false); return; }
      setTopError((res.body && res.body.error) || ('Error ' + res.status));
    }).catch(function () { setStatus(''); setTopError('Network error.'); });
  });

  document.getElementById('lst-add-version').addEventListener('click', function () {
    if (!requireCleanState()) { return; }
    var control = null;
    var i;
    for (i = 0; i < S.versions.length; i++) { if (S.versions[i].is_control) { control = S.versions[i]; } }
    if (!control) { control = S.versions[0]; }
    setStatus('Forking\\u2026');
    getJson('POST', '/api/admin/listicles/versions/' + encodeURIComponent(control.public_id) + '/fork', { join_experiment: true }).then(function (res) {
      setStatus('');
      if (res.ok) {
        S.saving = true;
        toast('Version added (forked from control \\u2014 new lander_v)');
        window.location.reload();
        return;
      }
      setTopError((res.body && res.body.error) || ('Error ' + res.status));
    }).catch(function () { setStatus(''); setTopError('Network error.'); });
  });

  document.getElementById('lst-exp-start').addEventListener('click', function () {
    if (!requireCleanState()) { return; }
    var entries = [];
    var i;
    for (i = 0; i < S.versions.length; i++) {
      entries.push({
        version_id: S.versions[i].public_id,
        traffic_allocation: Number(S.versions[i].traffic_allocation) || 0,
        is_control: !!S.versions[i].is_control,
        variant_label: S.versions[i].variant_label
      });
    }
    setStatus('Starting\\u2026');
    getJson('POST', '/api/admin/listicles/experiments/' + encodeURIComponent(S.experiment.public_id) + '/start', { versions: entries }).then(function (res) {
      setStatus('');
      if (res.ok) {
        S.saving = true;
        toast('Experiment running \\u2014 Versions are now immutable (§15.6)');
        window.location.reload();
        return;
      }
      if (res.body && res.body.fields) { renderErrors(res.body.fields, false); return; }
      setTopError((res.body && res.body.error) || ('Error ' + res.status));
    }).catch(function () { setStatus(''); setTopError('Network error.'); });
  });

  document.getElementById('lst-exp-stop').addEventListener('click', function () {
    if (!window.confirm('Stop the running experiment? Versions and history are kept (§5.3).')) { return; }
    setStatus('Stopping\\u2026');
    getJson('POST', '/api/admin/listicles/experiments/' + encodeURIComponent(S.experiment.public_id) + '/stop', {}).then(function (res) {
      setStatus('');
      if (res.ok) {
        S.saving = true;
        toast('Experiment stopped');
        window.location.reload();
        return;
      }
      setTopError((res.body && res.body.error) || ('Error ' + res.status));
    }).catch(function () { setStatus(''); setTopError('Network error.'); });
  });

  // ---- publish + view structure -------------------------------------------------------
  document.getElementById('lst-article-publish').addEventListener('click', function () {
    clearErrors();
    setTopError('');
    setStatus('Publishing\\u2026');
    getJson('POST', '/api/admin/listicles/articles/' + encodeURIComponent(S.article.public_id) + '/publish', {}).then(function (res) {
      setStatus('');
      if (res.ok) {
        S.article = res.body.article;
        toast('Article published');
        var badge = document.getElementById('lst-article-status');
        if (badge) {
          setText(badge, S.article.status);
          badge.className = 'badge badge-published';
        }
        return;
      }
      if (res.body && res.body.fields) { renderErrors(res.body.fields, false); return; }
      setTopError((res.body && res.body.error) || ('Error ' + res.status));
    }).catch(function () { setStatus(''); setTopError('Network error \\u2014 not published.'); });
  });

  document.getElementById('lst-view-structure').addEventListener('click', function () {
    var bodyEl = window.lstUi.openDialog('Structure \\u2014 ' + (S.article.article_name || ''));
    if (!bodyEl) { return; }
    var loading = el('p', '', 'Loading\\u2026');
    bodyEl.appendChild(loading);
    getJson('GET', '/api/admin/listicles/articles/' + encodeURIComponent(S.article.public_id) + '/structure').then(function (res) {
      if (loading.parentNode) { loading.parentNode.removeChild(loading); }
      if (!res.ok || !res.body) {
        bodyEl.appendChild(el('p', 'alert alert-error', 'Failed to load structure.'));
        return;
      }
      var versions = res.body.versions || [];
      var rootUl = el('ul', 'lst-structure-tree');
      rootUl.id = 'lst-structure-tree';
      var i, j, k;
      for (i = 0; i < versions.length; i++) {
        var version = versions[i];
        var vLi = el('li', '', 'Version ' + version.variant_label + (version.is_control ? ' (control)' : '') +
          ' \\u00b7 ' + version.public_id + ' \\u00b7 ' + version.traffic_allocation + '% \\u00b7 rev ' + version.content_version);
        var pUl = el('ul', 'lst-structure-tree');
        var pages = version.pages || [];
        for (j = 0; j < pages.length; j++) {
          var page = pages[j];
          var pLi = el('li', '', 'Page ' + (page.page_index + 1) + ' \\u00b7 ' + page.selection_mode +
            (page.ab_test_id ? ' \\u00b7 ' + page.ab_test_id : '') + (page.rule_set_id ? ' \\u00b7 ' + page.rule_set_id : ''));
          var cUl = el('ul', 'lst-structure-tree');
          var cands = page.candidates || [];
          for (k = 0; k < cands.length; k++) {
            var cand = cands[k];
            var text = cand.label + ' \\u2192 ' + cand.section_name;
            if (cand.traffic_allocation !== null && cand.traffic_allocation !== undefined) { text += ' \\u00b7 ' + cand.traffic_allocation + '%'; }
            if (cand.is_fallback) { text += ' \\u00b7 fallback'; }
            if (cand.rule) { text += ' \\u00b7 rule p' + cand.rule.priority; }
            cUl.appendChild(el('li', '', text));
          }
          pLi.appendChild(cUl);
          pUl.appendChild(pLi);
        }
        vLi.appendChild(pUl);
        rootUl.appendChild(vLi);
      }
      bodyEl.appendChild(rootUl);
    }).catch(function () {
      if (loading.parentNode) { loading.parentNode.removeChild(loading); }
      bodyEl.appendChild(el('p', 'alert alert-error', 'Failed to load structure.'));
    });
  });

  // ---- §30.6 Version preview ------------------------------------------------------------
  var pvVersionSelect = document.getElementById('lst-pv-version');
  var pvForces = document.getElementById('lst-pv-forces');
  var pvDensity = document.getElementById('lst-pv-density');
  var pvFrame = document.getElementById('lst-version-preview');
  var pvStatus = document.getElementById('lst-pv-status');
  var pvSeq = 0;
  var pvTimer = null;

  function previewedVersion() {
    var pid = pvVersionSelect.value;
    var i;
    for (i = 0; i < S.versions.length; i++) { if (S.versions[i].public_id === pid) { return S.versions[i]; } }
    return activeVersion();
  }

  function renderPreviewControls() {
    while (pvVersionSelect.firstChild) { pvVersionSelect.removeChild(pvVersionSelect.firstChild); }
    var i, opt;
    for (i = 0; i < S.versions.length; i++) {
      opt = document.createElement('option');
      opt.value = S.versions[i].public_id;
      opt.appendChild(document.createTextNode('Version ' + S.versions[i].variant_label + (S.versions[i].is_control ? ' (control)' : '') + ' \\u2014 ' + S.versions[i].public_id));
      if (i === S.active) { opt.selected = true; }
      pvVersionSelect.appendChild(opt);
    }
    renderForceSelects();
  }

  function renderForceSelects() {
    while (pvForces.firstChild) { pvForces.removeChild(pvForces.firstChild); }
    var v = previewedVersion();
    if (!v) { return; }
    var i, j;
    for (i = 0; i < v.pages.length; i++) {
      (function (page) {
        if (page.candidates.length < 2) { return; }
        var row = el('div', 'lst-pv-forces-row');
        row.appendChild(el('span', '', 'Page ' + (page.page_index + 1) + ' (' + page.selection_mode + ')'));
        var select = document.createElement('select');
        select.className = 'form-select';
        select.setAttribute('data-pv-force-page', String(page.page_index));
        var opt = document.createElement('option');
        opt.value = '';
        opt.appendChild(document.createTextNode('(auto \\u2014 mode semantics)'));
        select.appendChild(opt);
        for (j = 0; j < page.candidates.length; j++) {
          if (!page.candidates[j].public_id) { continue; } // unsaved candidates cannot be forced by id
          opt = document.createElement('option');
          opt.value = page.candidates[j].public_id;
          opt.appendChild(document.createTextNode(page.candidates[j].label + ' \\u2014 ' + page.candidates[j].section_name));
          select.appendChild(opt);
        }
        select.addEventListener('change', schedulePreview);
        row.appendChild(select);
        pvForces.appendChild(row);
      }(v.pages[i]));
    }
  }

  function collectPreviewBody() {
    var v = previewedVersion();
    var body = { force_candidates: {}, ctx: {} };
    if (v === activeVersion()) {
      commitVersionFromDom(S.active);
      body.version = versionPayload(v);
    }
    var selects = pvForces.querySelectorAll('[data-pv-force-page]');
    var i;
    for (i = 0; i < selects.length; i++) {
      if (selects[i].value !== '') { body.force_candidates[selects[i].getAttribute('data-pv-force-page')] = selects[i].value; }
    }
    var dims = document.querySelectorAll('[data-pv-dim]');
    for (i = 0; i < dims.length; i++) {
      var value = dims[i].value.replace(/^\\s+|\\s+$/g, '');
      if (value !== '') { body.ctx[dims[i].getAttribute('data-pv-dim')] = value; }
    }
    var hour = document.getElementById('lst-pv-hour').value;
    if (hour !== '') {
      var h = parseFloat(hour);
      if (!isNaN(h)) { body.ctx.hour = h; }
    }
    return { versionId: v.public_id, body: body };
  }

  function runPreview() {
    var req = collectPreviewBody();
    var seq = ++pvSeq;
    setText(pvStatus, 'Rendering\\u2026');
    getJson('POST', '/api/admin/listicles/versions/' + encodeURIComponent(req.versionId) + '/preview', req.body).then(function (res) {
      if (seq !== pvSeq) { return; }
      if (!res.ok || !res.body || !res.body.html) {
        setText(pvStatus, 'Preview unavailable');
        return;
      }
      setText(pvStatus, '');
      pvFrame.setAttribute('srcdoc', res.body.html);
      while (pvDensity.firstChild) { pvDensity.removeChild(pvDensity.firstChild); }
      var pages = res.body.pages || [];
      var i;
      for (i = 0; i < pages.length; i++) {
        var p = pages[i];
        var li = el('li', '');
        li.setAttribute('data-pv-density-page', String(p.page_index));
        li.appendChild(document.createTextNode('Page ' + (p.page_index + 1) + ' \\u00b7 ' + p.selection_mode + ' \\u00b7 ' +
          (p.chosen_section_name || '(none)') + ' \\u00b7 ' + p.selection_reason + ' \\u00b7 '));
        var count = el('span', 'lst-pv-density-count', String(p.cta_density) + ' CTAs');
        li.appendChild(count);
        pvDensity.appendChild(li);
      }
    }).catch(function () {
      if (seq !== pvSeq) { return; }
      setText(pvStatus, 'Preview unavailable');
    });
  }
  function schedulePreview() {
    if (pvTimer) { window.clearTimeout(pvTimer); }
    pvTimer = window.setTimeout(runPreview, 600);
  }

  document.getElementById('lst-pv-run').addEventListener('click', runPreview);
  pvVersionSelect.addEventListener('change', function () { renderForceSelects(); runPreview(); });
  document.getElementById('lst-pv-ctx').addEventListener('input', schedulePreview);

  function setPreviewMode(mobile) {
    if (mobile) { pvFrame.classList.add('lst-preview-mobile'); }
    else { pvFrame.classList.remove('lst-preview-mobile'); }
    var d = document.getElementById('lst-pv-desktop');
    var m = document.getElementById('lst-pv-mobile');
    d.className = mobile ? 'btn btn-sm btn-outline' : 'btn btn-sm btn-primary';
    d.setAttribute('aria-pressed', mobile ? 'false' : 'true');
    m.className = mobile ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
    m.setAttribute('aria-pressed', mobile ? 'true' : 'false');
  }
  document.getElementById('lst-pv-desktop').addEventListener('click', function () { setPreviewMode(false); });
  document.getElementById('lst-pv-mobile').addEventListener('click', function () { setPreviewMode(true); });

  // ---- dirty tracking over the whole builder form -------------------------------------
  var builderRoot = document.getElementById('lst-builder-root');
  function onAnyEdit(e) {
    if (!e.target || !e.target.closest) { return; }
    // Preview controls only SIMULATE; the versions card's rail edits are
    // EXPERIMENT state (persisted by Start — S.expDirty, set by their own
    // handlers) — neither dirties the PUT-persisted version content.
    if (e.target.closest('#lst-pv-card') || e.target.closest('#lst-versions-card')) { return; }
    markDirty();
  }
  if (builderRoot) {
    builderRoot.addEventListener('input', onAnyEdit);
    // selects + file inputs fire 'change' (the hero upload path).
    builderRoot.addEventListener('change', onAnyEdit);
  }

  // ---- boot ----------------------------------------------------------------------------
  renderRail();
  loadVersionToDom(S.active);
  renderPreviewControls();
  runPreview();
}());
`;

// ---------------------------------------------------------------------------
// Page assembly
// ---------------------------------------------------------------------------

export function listiclesArticleBuilderPage(
  props: ArticleBuilderPageProps,
  branding: ListiclesBranding = {},
): string {
  const boot = buildBoot(props);
  const bootScript = `window._lstBuilderBoot = ${safeBootJson(boot)};`;
  const isEdit = props.mode === "edit";
  const a = props.article;
  const title = isEdit ? `Edit Article` : "New Article";
  const statusBadge =
    isEdit && a
      ? `<span id="lst-article-status" class="badge ${a.status === "published" ? "badge-published" : "badge-draft"}">${escapeHtml(a.status)}</span>`
      : "";
  const actions = isEdit
    ? `<div class="lst-actions-row">
  ${statusBadge}
  <button type="button" id="lst-view-structure" class="btn btn-sm btn-outline">View structure</button>
  <button type="button" id="lst-article-publish" class="btn btn-sm btn-primary">Publish</button>
</div>`
    : "";
  const mainColumn = isEdit
    ? `${renderBaseCard(props)}
${renderVersionsRail()}
${renderVersionEditor(props)}
${renderPagesCard()}`
    : `${renderBaseCard(props)}
${renderVersionEditor(props)}
<div class="lst-actions-row">
  <button type="button" id="lst-article-create" class="btn btn-primary">Create Article</button>
  <a href="/admin/listicles/articles" class="btn btn-secondary">Cancel</a>
</div>
<p class="form-help">Creating an Article auto-creates its control Version (label A, 100%, control — §11). Pages, A/B and rules are built on the edit screen next.</p>`;
  const sideColumn = isEdit ? `<div class="lst-builder-side">${renderPreviewPanel()}</div>` : "";
  const content = `${renderListiclesTabs("articles")}
<p><a href="/admin/listicles/articles" id="lst-builder-back">&larr; Back to Articles</a></p>
<h2 class="card-title" style="margin-bottom:12px">${escapeHtml(title)}${isEdit && a ? ` — ${escapeHtml(a.article_name)}` : ""}</h2>
${actions}
<p id="lst-builder-toperror" class="alert alert-error" hidden role="alert"></p>
<div id="lst-builder-errors" hidden></div>
<p id="lst-builder-status" class="form-status" role="status" aria-live="polite"></p>
<div id="lst-builder-root" ${isEdit ? 'class="lst-builder-grid"' : ""}>
  <div class="lst-builder-main"${props.mode === "new" ? ' id="lst-builder-form"' : ""}>
    ${mainColumn}
  </div>
  ${sideColumn}
</div>
${renderSectionPickerModal()}
${renderImmutabilityModal()}
${renderDialogShell()}`;
  return adminLayout({
    title: "Listicles",
    activePath: "/admin/listicles/articles",
    userEmail: branding.userEmail,
    content,
    styles: LISTICLES_STYLES + heroImageStyles + BUILDER_STYLES,
    scripts:
      LST_SHARED_SCRIPT +
      CONFLICT_MATRIX_SCRIPT +
      SECTION_PICKER_SCRIPT +
      heroImageScripts +
      "\n" +
      bootScript +
      "\n" +
      BUILDER_NEW_SCRIPT +
      BUILDER_EDIT_SCRIPT,
  });
}

// 404 shell for /articles/:id/edit with an unknown id.
export function listiclesArticleNotFoundPage(branding: ListiclesBranding = {}): string {
  const content = `${renderListiclesTabs("articles")}
<div class="card"><div class="empty-state">
  <p>Article not found.</p>
  <a href="/admin/listicles/articles" class="btn btn-primary">Back to Articles</a>
</div></div>`;
  return adminLayout({
    title: "Listicles",
    activePath: "/admin/listicles/articles",
    userEmail: branding.userEmail,
    content,
    styles: LISTICLES_STYLES,
    scripts: LST_SHARED_SCRIPT,
  });
}
