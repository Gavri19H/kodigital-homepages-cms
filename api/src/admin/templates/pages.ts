// Admin Pages templates — CANONICAL renderer for /admin/pages.
//
// pagesListPage  — 7-column table + Site filter + Page-type filter; pages with
//                  NULL site_id render with a "Global template" badge in the
//                  Site or Global column.
// pageFormPage  — Page-type aware form. Non-legal page_types (about, generic,
//                  custom) require a site_id selector; legal templates
//                  (privacy-policy, terms, do-not-sell, contact, and the
//                  meta-label "legal") allow site_id NULL and render a
//                  "Global template" badge next to the page-type selector.
// New mode submits POST /api/admin/pages; edit mode submits PATCH
// /api/admin/pages/:id. Inline submit script is ES5-only.
//
// Two-templates split (RX4 / MQAFIX-4):
//   - api/src/admin/templates/pages.ts (THIS FILE) is the CANONICAL renderer.
//     api/src/admin/ui.ts mounts GET /admin/pages here via pagesListPage()
//     and the related new/edit forms via pageFormPage(). This is the only
//     template the application actually serves to browsers.
//   - api/src/admin/views/pages.ts is a LEGACY peer retained ONLY for the
//     T22 acceptance-test grep contract
//     (acceptance-tests/.../T22_pages_tab_site_aware.sh greps the views/
//     file for data-filter="site"/page_type/status). It is NOT imported
//     by any application code and renders no live route.
// The Site filter wire name is the canonical column name `site_id` (the
// legacy short form must not appear on any select). Enforced by
// api/test/pages-template.test.ts (T6.AC1 contract) and
// api/test/admin-pages-list-site-id-filter.test.ts (RX4.AC3 contract).
// Do NOT rename the Site filter select away from the canonical wire
// name without also updating both wire contracts.

import { adminLayout } from "./layout";
import { editorScripts } from "../../editor/editor-scripts";

export interface SiteOption {
  id: string;
  name?: string;
}

export interface PageListEntry {
  id?: string;
  title: string;
  slug?: string;
  site?: string;
  site_id?: string | null;
  page_type?: string;
  status?: string;
  show_in_footer?: boolean | number;
  updated_at?: string | null;
}

export interface PageFormValues {
  id?: string;
  title?: string;
  slug?: string;
  site_id?: string | null;
  page_type?: string;
  status?: string;
  show_in_footer?: boolean | number;
  content_json?: string;
  content_html?: string;
  seo_title?: string;
  seo_description?: string;
}

export interface PagesBranding {
  userEmail?: string;
}

const PAGE_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "generic", label: "generic" },
  { value: "about", label: "about" },
  { value: "privacy-policy", label: "privacy-policy" },
  { value: "terms", label: "terms" },
  { value: "do-not-sell", label: "do-not-sell" },
  { value: "contact", label: "contact" },
  { value: "legal", label: "legal" },
];

const STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "pending", label: "Pending" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
];

const LEGAL_PAGE_TYPES: ReadonlyArray<string> = [
  "privacy-policy",
  "terms",
  "do-not-sell",
  "contact",
  "legal",
];

function isLegalPageType(pt: string | undefined | null): boolean {
  if (!pt) { return false; }
  for (let i = 0; i < LEGAL_PAGE_TYPES.length; i++) {
    if (LEGAL_PAGE_TYPES[i] === pt) { return true; }
  }
  return false;
}

function escapeHtml(input: string | number | undefined | null): string {
  if (input === undefined || input === null) { return ""; }
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function selectedAttr(a: string | undefined | null, b: string): string {
  return (a ?? "") === b ? " selected" : "";
}

function renderSiteOptions(sites: ReadonlyArray<SiteOption>, selected?: string | null, includeBlank?: boolean, blankLabel?: string): string {
  const blank = includeBlank ? `<option value="">${escapeHtml(blankLabel ?? "All sites")}</option>` : "";
  const opts = sites.map(function (s: SiteOption): string {
    const value = escapeHtml(s.id);
    const label = escapeHtml(s.name ?? s.id);
    return `<option value="${value}"${selectedAttr(selected ?? "", s.id)}>${label}</option>`;
  }).join("");
  return blank + opts;
}

function renderPageTypeOptions(selected?: string | null, includeBlank?: boolean): string {
  const blank = includeBlank ? `<option value="">All page types</option>` : "";
  const opts = PAGE_TYPES.map(function (p): string {
    return `<option value="${escapeHtml(p.value)}"${selectedAttr(selected ?? "", p.value)}>${escapeHtml(p.label)}</option>`;
  }).join("");
  return blank + opts;
}

function renderStatusOptions(selected?: string | null, includeBlank?: boolean): string {
  const blank = includeBlank ? `<option value="">All statuses</option>` : "";
  const opts = STATUS_OPTIONS.map(function (s): string {
    return `<option value="${s.value}"${selectedAttr(selected ?? "", s.value)}>${escapeHtml(s.label)}</option>`;
  }).join("");
  return blank + opts;
}

function renderToolbar(sites: ReadonlyArray<SiteOption>): string {
  return `<div class="toolbar">
  <div class="toolbar-search"><input type="search" name="search" class="form-input" placeholder="Search pages..." /></div>
  <div class="toolbar-filters">
    <select name="site_id" class="form-select" aria-label="Site filter">
      ${renderSiteOptions(sites, "", true, "All sites")}
      <option value="__global__">Global only (templates)</option>
    </select>
    <select name="page_type" class="form-select" aria-label="Page type filter">${renderPageTypeOptions("", true)}</select>
    <select name="status" class="form-select" aria-label="Status filter">${renderStatusOptions("", true)}</select>
  </div>
  <a href="/admin/pages/new" class="btn btn-primary">+ New Page</a>
</div>`;
}

function renderPageRow(p: PageListEntry): string {
  const id = escapeHtml(p.id ?? "");
  const title = escapeHtml(p.title);
  const hasSite = p.site_id != null && p.site_id !== "";
  const siteCell = hasSite
    ? escapeHtml(p.site ?? p.site_id ?? "")
    : `<span class="badge global-template">Global template</span>`;
  const pageType = escapeHtml(p.page_type ?? "generic");
  const status = escapeHtml(p.status ?? "draft");
  const footer = p.show_in_footer ? "Yes" : "No";
  const updated = escapeHtml(p.updated_at ?? "");
  const editHref = id ? `/admin/pages/${id}/edit` : "/admin/pages";
  return `<tr data-page-id="${id}">
  <td>${title}</td>
  <td>${siteCell}</td>
  <td>${pageType}</td>
  <td><span class="badge">${status}</span></td>
  <td>${footer}</td>
  <td>${updated}</td>
  <td><a href="${editHref}" class="btn btn-sm btn-secondary">Edit</a></td>
</tr>`;
}

function renderPagesTable(pages: ReadonlyArray<PageListEntry>): string {
  const rows = pages.length === 0
    ? `<tr><td colspan="7" class="empty-state">No pages yet</td></tr>`
    : pages.map(renderPageRow).join("");
  return `<div class="card">
  <div class="table-wrapper">
    <table class="table pages-list" aria-label="Pages list">
      <thead><tr>
        <th scope="col">Title</th>
        <th scope="col">Site or Global</th>
        <th scope="col">Type</th>
        <th scope="col">Status</th>
        <th scope="col">Footer</th>
        <th scope="col">Updated</th>
        <th scope="col">Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>`;
}

export function pagesListPage(
  pages: ReadonlyArray<PageListEntry>,
  sites: ReadonlyArray<SiteOption>,
  branding: PagesBranding = {},
): string {
  const content = `${renderToolbar(sites)}${renderPagesTable(pages)}`;
  return adminLayout({
    title: "Pages",
    activePath: "/admin/pages",
    userEmail: branding.userEmail,
    content,
  });
}

function boolAttr(v: boolean | number | undefined): string {
  return v ? " checked" : "";
}

function renderPageForm(page: PageFormValues | null, sites: ReadonlyArray<SiteOption>): string {
  const isEdit = page !== null && typeof page.id === "string" && page.id.length > 0;
  const p: PageFormValues = page ?? {};
  const formMode = isEdit ? "edit" : "new";
  const pageId = escapeHtml(p.id ?? "");
  const titleVal = escapeHtml(p.title ?? "");
  const slugVal = escapeHtml(p.slug ?? "");
  const contentJsonVal = escapeHtml(p.content_json ?? "");
  const seoTitleVal = escapeHtml(p.seo_title ?? "");
  const seoDescVal = escapeHtml(p.seo_description ?? "");
  const pageTypeVal = p.page_type ?? "generic";
  const legal = isLegalPageType(pageTypeVal);
  const siteRequiredAttr = legal ? "" : " required";
  const siteAriaRequired = legal ? "false" : "true";
  const badgeHiddenAttr = legal ? "" : " hidden";
  return `<form id="page-form" class="page-form" data-mode="${formMode}" data-page-id="${pageId}">
  <div class="card">
    <div class="form-group">
      <label for="page-title" class="form-label">Title</label>
      <input id="page-title" name="title" type="text" class="form-input" value="${titleVal}" required />
    </div>
    <div class="form-group">
      <label for="page-slug" class="form-label">Slug</label>
      <input id="page-slug" name="slug" type="text" class="form-input" value="${slugVal}" />
    </div>
    <div class="form-group">
      <label for="page-type" class="form-label">Page type</label>
      <select id="page-type" name="page_type" class="form-select" required data-field="page_type">
        ${renderPageTypeOptions(pageTypeVal, false)}
      </select>
      <span id="page-global-badge" class="badge global-template" data-field="global_template_badge"${badgeHiddenAttr}>Global template</span>
    </div>
    <div class="form-group">
      <label for="page-site" class="form-label">Site</label>
      <select id="page-site" name="site_id" class="form-select"${siteRequiredAttr} aria-required="${siteAriaRequired}" data-field="site_id" data-required-when="non_legal">
        <option value="">Choose a site…</option>
        ${renderSiteOptions(sites, p.site_id ?? "", false)}
      </select>
      <small id="page-site-hint" class="form-hint" data-field="site_hint">Legal templates may be saved as global (no site).</small>
    </div>
    <div class="form-group">
      <label for="page-status" class="form-label">Status</label>
      <select id="page-status" name="status" class="form-select">
        ${renderStatusOptions(p.status ?? "draft", false)}
      </select>
    </div>
    <div class="form-group">
      <label for="page-show-in-footer" class="form-label"><input id="page-show-in-footer" name="show_in_footer" type="checkbox" value="1"${boolAttr(p.show_in_footer)} /> Show in footer</label>
    </div>
    <div class="form-group">
      <label for="page-content" class="form-label">Content (block JSON)</label>
      <textarea id="page-content" name="content_json" class="form-textarea" rows="8">${contentJsonVal}</textarea>
    </div>
  </div>
  <div class="card">
    <div class="card-header"><h3 class="card-title">SEO</h3></div>
    <div class="form-group">
      <label for="page-seo-title" class="form-label">SEO title</label>
      <input id="page-seo-title" name="seo_title" type="text" class="form-input" value="${seoTitleVal}" />
    </div>
    <div class="form-group">
      <label for="page-seo-description" class="form-label">SEO description</label>
      <textarea id="page-seo-description" name="seo_description" class="form-textarea" rows="3">${seoDescVal}</textarea>
    </div>
  </div>
  <p id="page-form-error" class="alert alert-error" hidden role="alert"></p>
  <p id="page-form-status" class="form-status" role="status" aria-live="polite"></p>
  <div class="form-actions">
    <button type="submit" class="btn btn-primary">${isEdit ? "Save changes" : "Create page"}</button>
    <a href="/admin/pages" class="btn btn-secondary">Cancel</a>
  </div>
</form>`;
}

const PAGE_FORM_SCRIPT = `
(function(){
  var form = document.getElementById('page-form');
  if (!form) { return; }
  var mode = form.getAttribute('data-mode');
  var pageId = form.getAttribute('data-page-id');
  var errEl = document.getElementById('page-form-error');
  var statusEl = document.getElementById('page-form-status');
  var siteSelect = document.getElementById('page-site');
  var pageTypeSelect = document.getElementById('page-type');
  var globalBadge = document.getElementById('page-global-badge');
  var LEGAL = { 'privacy-policy': 1, 'terms': 1, 'do-not-sell': 1, 'contact': 1, 'legal': 1 };
  function isLegal() { return pageTypeSelect && Object.prototype.hasOwnProperty.call(LEGAL, pageTypeSelect.value); }
  function setError(msg) { if (errEl) { errEl.hidden = !msg; errEl.textContent = msg || ''; } }
  function setStatus(msg) {
    if (!statusEl) { return; }
    while (statusEl.firstChild) { statusEl.removeChild(statusEl.firstChild); }
    if (msg) { statusEl.appendChild(document.createTextNode(msg)); }
  }
  function applyLegalState() {
    if (!siteSelect) { return; }
    if (isLegal()) {
      if (globalBadge) { globalBadge.removeAttribute('hidden'); }
      siteSelect.removeAttribute('required');
      siteSelect.setAttribute('aria-required', 'false');
      siteSelect.setAttribute('data-required-when', 'never');
    } else {
      if (globalBadge) { globalBadge.setAttribute('hidden', ''); }
      siteSelect.setAttribute('required', '');
      siteSelect.setAttribute('aria-required', 'true');
      siteSelect.setAttribute('data-required-when', 'non_legal');
    }
  }
  if (pageTypeSelect) {
    pageTypeSelect.addEventListener('change', function () {
      setError('');
      setStatus('');
      applyLegalState();
    });
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    setError('');
    if (siteSelect && !siteSelect.value && !isLegal()) {
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }
      setStatus('Site is required');
      setError('Site is required');
      siteSelect.focus();
      return;
    }
    var fd = new FormData(form);
    var body = {
      title: fd.get('title') || '',
      slug: fd.get('slug') || '',
      site_id: fd.get('site_id') || null,
      page_type: fd.get('page_type') || 'generic',
      status: fd.get('status') || 'draft',
      show_in_footer: fd.get('show_in_footer') ? 1 : 0,
      content_json: fd.get('content_json') || '',
      seo_title: fd.get('seo_title') || '',
      seo_description: fd.get('seo_description') || ''
    };
    var url = mode === 'edit' ? '/api/admin/pages/' + pageId : '/api/admin/pages';
    var method = mode === 'edit' ? 'PATCH' : 'POST';
    fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin'
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
    }).then(function (res) {
      if (res.ok) {
        window.location.href = '/admin/pages';
      } else {
        setError((res.body && res.body.error) || ('Error: ' + res.status));
      }
    }).catch(function () { setError('Network error'); });
  });
}());
`;

export function pageFormPage(
  page: PageFormValues | null,
  sites: ReadonlyArray<SiteOption> = [],
  branding: PagesBranding = {},
): string {
  const isEdit = page !== null && typeof page.id === "string" && page.id.length > 0;
  const title = isEdit ? "Edit Page" : "New Page";
  const content = renderPageForm(page, sites);
  return adminLayout({
    title,
    activePath: "/admin/pages",
    userEmail: branding.userEmail,
    content,
    scripts: editorScripts() + PAGE_FORM_SCRIPT,
  });
}
