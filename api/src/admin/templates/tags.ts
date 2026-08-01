// Admin Tags templates.
// tagsListPage — Site filter dropdown (All sites / Global only / per-site)
// + tags table with name/slug/site-or-global/article-count/actions columns.
// Rows whose site_id IS NULL render a "Global" indicator badge in the Site
// column. GET /api/admin/tags?site_id=<id> returns site tags + globals;
// site_id=__global__ returns NULL-only.

import {
  adminLayout,
  escapeHtml,
  renderListPager,
  listFilterScript,
  type ListPagerMeta,
} from "./layout";

export interface SiteOption {
  id: string;
  name?: string;
}

export interface TagListFilters {
  site_id?: string;
  search?: string;
}

export interface TagListEntry {
  id?: string;
  name: string;
  slug?: string;
  site?: string;
  site_id?: string | null;
  article_count?: number;
}

export interface TagsBranding {
  userEmail?: string;
  conversionsUiEnabled?: boolean;
}

function renderSiteOptions(sites: ReadonlyArray<SiteOption>, selected?: string | null): string {
  const globalSel = selected === "__global__" ? " selected" : "";
  const head = `<option value="">All sites</option><option value="__global__"${globalSel}>Global only</option>`;
  const opts = sites.map(function (s: SiteOption): string {
    const sel = (selected ?? "") === s.id ? " selected" : "";
    return `<option value="${escapeHtml(s.id)}"${sel}>${escapeHtml(s.name ?? s.id)}</option>`;
  }).join("");
  return head + opts;
}

function renderToolbar(sites: ReadonlyArray<SiteOption>, filters: TagListFilters = {}): string {
  return `<div class="toolbar">
  <div class="toolbar-search"><input type="search" name="search" class="form-input" placeholder="Search tags..." value="${escapeHtml(filters.search ?? "")}" /></div>
  <div class="toolbar-filters">
    <select id="filter-site" name="site_id" class="form-select" data-filter="site" aria-label="Site filter">
      ${renderSiteOptions(sites, filters.site_id ?? "")}
    </select>
  </div>
  <button type="button" id="open-new-tag-modal" class="btn btn-primary">+ New Tag</button>
</div>`;
}

// T30: per-site option list for the create modal. Tags MAY be global
// (tags.site_id NULL), so an explicit Global tier option is offered.
function renderModalSiteOptions(sites: ReadonlyArray<SiteOption>): string {
  const head = `<option value="">Global (all sites)</option>`;
  const opts = sites.map(function (s: SiteOption): string {
    return `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name ?? s.id)}</option>`;
  }).join("");
  return head + opts;
}

// T30: New Tag modal (domains.ts New-Site-modal precedent). Slug is
// optional — the POST handler derives one from the name when omitted.
function renderModal(sites: ReadonlyArray<SiteOption>): string {
  return `<div id="new-tag-modal" class="modal hidden" style="display:none;" role="dialog" aria-labelledby="new-tag-modal-title" aria-hidden="true">
  <div class="modal-content">
    <h2 id="new-tag-modal-title" class="modal-title">Add New Tag</h2>
    <form id="new-tag-form" data-action="submit-new-tag">
      <div class="form-group">
        <label for="new-tag-site" class="form-label">Site</label>
        <select id="new-tag-site" name="site_id" class="form-select">${renderModalSiteOptions(sites)}</select>
      </div>
      <div class="form-group">
        <label for="new-tag-name" class="form-label">Name</label>
        <input id="new-tag-name" name="name" type="text" class="form-input" autocomplete="off" required />
      </div>
      <div class="form-group">
        <label for="new-tag-slug" class="form-label">Slug (optional)</label>
        <input id="new-tag-slug" name="slug" type="text" class="form-input" autocomplete="off" />
      </div>
      <p id="new-tag-error" class="alert alert-error" hidden role="alert"></p>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">Create tag</button>
        <button type="button" id="new-tag-cancel" class="btn btn-secondary">Cancel</button>
      </div>
    </form>
  </div>
</div>`;
}

const MODAL_STYLES = '.modal{position:fixed;inset:0;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;z-index:1000}'
  + '.modal.hidden{display:none}'
  + '.modal-content{background:#fff;border-radius:8px;padding:24px;max-width:520px;width:90%;max-height:90vh;overflow-y:auto;box-shadow:0 10px 25px rgba(0,0,0,0.15)}'
  + '.modal-title{margin-bottom:16px;font-size:18px;font-weight:600}'
  + '.modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}';

// T30: list-page script — New Tag modal (POST /api/admin/tags) + row
// Delete (DELETE /api/admin/tags/:id, with the active site filter
// forwarded as ?site_id= so the server tenant-guard applies). ES5 only
// (var, .then(), no template literals). The modal closes ONLY after the
// POST responds — never on submit-click alone.
const TAGS_LIST_SCRIPT = `
(function () {
  var modal = document.getElementById('new-tag-modal');
  var opener = document.getElementById('open-new-tag-modal');
  var cancel = document.getElementById('new-tag-cancel');
  var form = document.getElementById('new-tag-form');

  function openModal() {
    modal.style.display = 'flex';
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
  }
  function closeModal() {
    modal.style.display = 'none';
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }
  function setError(msg) {
    var err = document.getElementById('new-tag-error');
    if (err) { err.hidden = !msg; err.textContent = msg || ''; }
  }
  function selectedSiteFilter() {
    var filter = document.getElementById('filter-site');
    var v = filter ? filter.value : '';
    return (v && v !== '__global__') ? v : '';
  }
  function onDeleteClick() {
    var id = this.getAttribute('data-delete-tag');
    var name = this.getAttribute('data-tag-name') || 'this tag';
    if (!id) { return; }
    if (!window.confirmDelete('Are you sure you want to delete "' + name + '"?')) { return; }
    var url = '/api/admin/tags/' + id;
    var siteId = selectedSiteFilter();
    if (siteId) { url += '?site_id=' + encodeURIComponent(siteId); }
    window.api('DELETE', url).then(function (data) {
      if (data && data.error) {
        window.showToast('Error: ' + data.error, 'error');
      } else {
        window.location.reload();
      }
    }).catch(function () {
      window.showToast('Error: Failed to delete tag', 'error');
    });
  }

  var deleteButtons = document.querySelectorAll('button[data-delete-tag]');
  var i;
  for (i = 0; i < deleteButtons.length; i++) {
    deleteButtons[i].addEventListener('click', onDeleteClick);
  }

  if (!modal || !opener || !form) { return; }
  opener.addEventListener('click', function () { setError(''); openModal(); });
  if (cancel) { cancel.addEventListener('click', closeModal); }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeModal(); } });
  modal.addEventListener('click', function (e) { if (e.target === modal) { closeModal(); } });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    setError('');
    var siteId = (document.getElementById('new-tag-site') || {}).value || '';
    var name = (document.getElementById('new-tag-name') || {}).value || '';
    var slug = (document.getElementById('new-tag-slug') || {}).value || '';
    if (!name) { setError('Name is required'); return; }
    var body = { name: name };
    if (slug) { body.slug = slug; }
    if (siteId) { body.site_id = siteId; }
    fetch('/api/admin/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin'
    }).then(function (r) {
      return r.json().then(function (b) { return { ok: r.ok, status: r.status, body: b }; });
    }).then(function (res) {
      if (res.ok) {
        closeModal();
        window.location.reload();
      } else {
        setError((res.body && res.body.error) || ('Error: ' + res.status));
      }
    }).catch(function () { setError('Network error'); });
  });
}());
`;

function renderTagRow(t: TagListEntry): string {
  const id = escapeHtml(t.id ?? "");
  const name = escapeHtml(t.name);
  const slug = escapeHtml(t.slug ?? "");
  const hasSite = t.site_id != null && t.site_id !== "";
  const siteCell = hasSite
    ? escapeHtml(t.site ?? t.site_id ?? "")
    : `<span class="badge global-template" data-global="true">Global</span>`;
  const count = escapeHtml(t.article_count ?? 0);
  // T31: tags match the reference — create + delete only, NO edit. The
  // /admin/tags/:id/edit route was never registered (dead link), so the
  // Edit action is removed entirely; the Actions cell is delete-only.
  return `<tr data-tag-id="${id}">
  <td>${name}</td>
  <td>${slug}</td>
  <td>${siteCell}</td>
  <td>${count}</td>
  <td>
    <button type="button" class="btn btn-danger btn-sm" data-delete-tag="${id}" data-tag-name="${name}">Delete</button>
  </td>
</tr>`;
}

function renderTagsTable(tags: ReadonlyArray<TagListEntry>): string {
  const rows = tags.length === 0
    ? `<tr><td colspan="5" class="empty-state">No tags yet</td></tr>`
    : tags.map(renderTagRow).join("");
  return `<div class="card">
  <div class="table-wrapper">
    <table class="table tags-list" aria-label="Tags list">
      <thead><tr>
        <th scope="col">Name</th>
        <th scope="col">Slug</th>
        <th scope="col">Site</th>
        <th scope="col">Articles</th>
        <th scope="col">Actions</th>
      </tr></thead>
      <tbody id="tags-list-body" data-empty="No tags yet">${rows}</tbody>
    </table>
  </div>
</div>`;
}

export function tagsListPage(
  tags: ReadonlyArray<TagListEntry>,
  sites: ReadonlyArray<SiteOption>,
  branding: TagsBranding = {},
  filters: TagListFilters = {},
  pageMeta?: ListPagerMeta,
): string {
  const pager = renderListPager(pageMeta, {
    site_id: filters.site_id,
    search: filters.search,
  });
  const content = `${renderToolbar(sites, filters)}${renderTagsTable(tags)}${renderModal(sites)}${pager}`;
  return adminLayout({
    title: "Tags",
    activePath: "/admin/tags",
    userEmail: branding.userEmail,
    conversionsUiEnabled: branding.conversionsUiEnabled,
    content,
    styles: MODAL_STYLES,
    scripts: TAGS_LIST_SCRIPT + listFilterScript,
  });
}
