// Admin Categories templates.
// categoriesListPage — Site filter + Vertical multi-select toolbar; categories
// table with name/slug/verticals/article-count/actions columns. Verticals
// reflect the canonical 8 slugs (home/finance/travel/health/parenting/food/
// tech/lifestyle) seeded by migration 0004 / T8. Multi-select allows a
// single category to belong to multiple verticals (e.g. "Healthy Meals" =>
// health + food + parenting), persisted via the category_verticals join.

import { adminLayout, escapeHtml } from "./layout";

export interface SiteOption {
  id: string;
  name?: string;
}

export interface CategoryListEntry {
  id?: string;
  name: string;
  slug?: string;
  verticals?: ReadonlyArray<string>;
  article_count?: number;
  site?: string;
  site_id?: string | null;
}

export interface CategoriesBranding {
  userEmail?: string;
}

const VERTICAL_SLUGS: ReadonlyArray<string> = [
  "home",
  "finance",
  "travel",
  "health",
  "parenting",
  "food",
  "tech",
  "lifestyle",
];

function renderSiteOptions(sites: ReadonlyArray<SiteOption>, selected?: string | null): string {
  const blank = `<option value="">All sites</option><option value="__global__">Global only</option>`;
  const opts = sites.map(function (s: SiteOption): string {
    const sel = (selected ?? "") === s.id ? " selected" : "";
    return `<option value="${escapeHtml(s.id)}"${sel}>${escapeHtml(s.name ?? s.id)}</option>`;
  }).join("");
  return blank + opts;
}

function renderVerticalsToolbarOptions(): string {
  return VERTICAL_SLUGS.map(function (v: string): string {
    return `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`;
  }).join("");
}

function renderCategoryRow(c: CategoryListEntry): string {
  const id = escapeHtml(c.id ?? "");
  const name = escapeHtml(c.name);
  const slug = escapeHtml(c.slug ?? "");
  const verticals = (c.verticals ?? []).map(escapeHtml).join(", ");
  const count = escapeHtml(c.article_count ?? 0);
  const editHref = id ? `/admin/categories/${id}/edit` : "/admin/categories";
  return `<tr data-category-id="${id}">
  <td>${name}</td>
  <td>${slug}</td>
  <td>${verticals}</td>
  <td>${count}</td>
  <td>
    <a href="${editHref}" class="btn btn-sm btn-secondary">Edit</a>
    <button type="button" class="btn btn-danger btn-sm" data-delete-category="${id}" data-category-name="${name}">Delete</button>
  </td>
</tr>`;
}

function renderCategoriesTable(categories: ReadonlyArray<CategoryListEntry>): string {
  const rows = categories.length === 0
    ? `<tr><td colspan="5" class="empty-state">No categories yet</td></tr>`
    : categories.map(renderCategoryRow).join("");
  return `<div class="card">
  <div class="table-wrapper">
    <table class="table categories-list" aria-label="Categories list">
      <thead><tr>
        <th scope="col">Name</th>
        <th scope="col">Slug</th>
        <th scope="col">Verticals</th>
        <th scope="col">Articles</th>
        <th scope="col">Actions</th>
      </tr></thead>
      <tbody id="categories-list-body" data-empty="No categories yet">${rows}</tbody>
    </table>
  </div>
</div>`;
}

function renderToolbar(sites: ReadonlyArray<SiteOption>): string {
  return `<div class="toolbar">
  <div class="toolbar-search"><input type="search" name="search" class="form-input" placeholder="Search categories..." /></div>
  <div class="toolbar-filters">
    <select id="filter-site" name="site" class="form-select" data-filter="site" aria-label="Site filter">
      ${renderSiteOptions(sites, "")}
    </select>
    <select id="filter-verticals" name="verticals" class="form-select" multiple data-multi="true" data-field="verticals" size="3" aria-label="Verticals (select multiple)">
      ${renderVerticalsToolbarOptions()}
    </select>
  </div>
  <button type="button" id="open-new-category-modal" class="btn btn-primary">+ New Category</button>
</div>`;
}

// T30: per-site option list for the create modal (no All/Global rows —
// POST /api/admin/categories requires a concrete site_id).
function renderModalSiteOptions(sites: ReadonlyArray<SiteOption>): string {
  const head = `<option value="">Select a site…</option>`;
  const opts = sites.map(function (s: SiteOption): string {
    return `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name ?? s.id)}</option>`;
  }).join("");
  return head + opts;
}

// T30: New Category modal (domains.ts New-Site-modal precedent). The
// verticals multi-select is populated client-side from GET
// /api/admin/verticals because vertical ids are autoincrement — the
// POST body needs integer vertical_ids, not slugs.
function renderModal(sites: ReadonlyArray<SiteOption>): string {
  return `<div id="new-category-modal" class="modal hidden" style="display:none;" role="dialog" aria-labelledby="new-category-modal-title" aria-hidden="true">
  <div class="modal-content">
    <h2 id="new-category-modal-title" class="modal-title">Add New Category</h2>
    <form id="new-category-form" data-action="submit-new-category">
      <div class="form-group">
        <label for="new-category-site" class="form-label">Site</label>
        <select id="new-category-site" name="site_id" class="form-select" required>${renderModalSiteOptions(sites)}</select>
      </div>
      <div class="form-group">
        <label for="new-category-name" class="form-label">Name</label>
        <input id="new-category-name" name="name" type="text" class="form-input" autocomplete="off" required />
      </div>
      <div class="form-group">
        <label for="new-category-slug" class="form-label">Slug</label>
        <input id="new-category-slug" name="slug" type="text" class="form-input" autocomplete="off" required />
      </div>
      <div class="form-group">
        <label for="new-category-verticals" class="form-label">Verticals (select at least one)</label>
        <select id="new-category-verticals" name="vertical_ids" class="form-select" multiple data-multi="true" size="4" required></select>
      </div>
      <div class="form-group">
        <label for="new-category-description" class="form-label">Description</label>
        <textarea id="new-category-description" name="description" class="form-textarea" rows="3" placeholder="Optional category blurb"></textarea>
      </div>
      <div class="form-group">
        <label for="new-category-display-order" class="form-label">Display Order</label>
        <input id="new-category-display-order" name="display_order" type="number" class="form-input" value="0" min="0" />
      </div>
      <div class="form-group">
        <label for="new-category-show-on-homepage" class="form-label"><input id="new-category-show-on-homepage" name="show_on_homepage" type="checkbox" value="1" /> Show on homepage</label>
      </div>
      <p id="new-category-error" class="alert alert-error" hidden role="alert"></p>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">Create category</button>
        <button type="button" id="new-category-cancel" class="btn btn-secondary">Cancel</button>
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

// T30: list-page script — New Category modal (POST /api/admin/categories)
// + row Delete (DELETE /api/admin/categories/:id, with the active site
// filter forwarded as ?site_id= so the server tenant-guard applies).
// ES5 only (var, .then(), no template literals). The modal closes ONLY
// after the POST responds — never on submit-click alone.
const CATEGORIES_LIST_SCRIPT = `
(function () {
  var modal = document.getElementById('new-category-modal');
  var opener = document.getElementById('open-new-category-modal');
  var cancel = document.getElementById('new-category-cancel');
  var form = document.getElementById('new-category-form');

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
    var err = document.getElementById('new-category-error');
    if (err) { err.hidden = !msg; err.textContent = msg || ''; }
  }
  function loadVerticals() {
    var select = document.getElementById('new-category-verticals');
    if (!select || select.options.length > 0) { return; }
    window.api('GET', '/api/admin/verticals').then(function (data) {
      var rows = (data && data.resource) || [];
      var i;
      for (i = 0; i < rows.length; i++) {
        var opt = document.createElement('option');
        opt.value = String(rows[i].id);
        opt.textContent = rows[i].name || rows[i].slug;
        select.appendChild(opt);
      }
    }).catch(function () {
      setError('Failed to load verticals');
    });
  }
  function selectedSiteFilter() {
    var filter = document.getElementById('filter-site');
    var v = filter ? filter.value : '';
    return (v && v !== '__global__') ? v : '';
  }
  function onDeleteClick() {
    var id = this.getAttribute('data-delete-category');
    var name = this.getAttribute('data-category-name') || 'this category';
    if (!id) { return; }
    if (!window.confirmDelete('Are you sure you want to delete "' + name + '"?')) { return; }
    var url = '/api/admin/categories/' + id;
    var siteId = selectedSiteFilter();
    if (siteId) { url += '?site_id=' + encodeURIComponent(siteId); }
    window.api('DELETE', url).then(function (data) {
      if (data && data.error) {
        window.showToast('Error: ' + data.error, 'error');
      } else {
        window.location.reload();
      }
    }).catch(function () {
      window.showToast('Error: Failed to delete category', 'error');
    });
  }

  var deleteButtons = document.querySelectorAll('button[data-delete-category]');
  var i;
  for (i = 0; i < deleteButtons.length; i++) {
    deleteButtons[i].addEventListener('click', onDeleteClick);
  }

  if (!modal || !opener || !form) { return; }
  opener.addEventListener('click', function () { setError(''); loadVerticals(); openModal(); });
  if (cancel) { cancel.addEventListener('click', closeModal); }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeModal(); } });
  modal.addEventListener('click', function (e) { if (e.target === modal) { closeModal(); } });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    setError('');
    var siteId = (document.getElementById('new-category-site') || {}).value || '';
    var name = (document.getElementById('new-category-name') || {}).value || '';
    var slug = (document.getElementById('new-category-slug') || {}).value || '';
    var select = document.getElementById('new-category-verticals');
    var verticalIds = [];
    var j;
    if (select) {
      for (j = 0; j < select.options.length; j++) {
        if (select.options[j].selected) { verticalIds.push(parseInt(select.options[j].value, 10)); }
      }
    }
    var description = (document.getElementById('new-category-description') || {}).value || '';
    var orderEl = document.getElementById('new-category-display-order');
    var displayOrder = orderEl ? (parseInt(orderEl.value, 10) || 0) : 0;
    var homepageEl = document.getElementById('new-category-show-on-homepage');
    var showOnHomepage = (homepageEl && homepageEl.checked) ? 1 : 0;
    if (!siteId) { setError('Select a site'); return; }
    if (verticalIds.length === 0) { setError('Select at least one vertical'); return; }
    fetch('/api/admin/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_id: siteId, name: name, slug: slug, vertical_ids: verticalIds, description: description, display_order: displayOrder, show_on_homepage: showOnHomepage }),
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

export function categoriesListPage(
  categories: ReadonlyArray<CategoryListEntry>,
  sites: ReadonlyArray<SiteOption>,
  branding: CategoriesBranding = {},
): string {
  const content = `${renderToolbar(sites)}${renderCategoriesTable(categories)}${renderModal(sites)}`;
  return adminLayout({
    title: "Categories",
    activePath: "/admin/categories",
    userEmail: branding.userEmail,
    content,
    styles: MODAL_STYLES,
    scripts: CATEGORIES_LIST_SCRIPT,
  });
}
