// X01 Part C (owner, 22 Nov 2026): the Verticals screen.
// verticalsListPage — one row per vertical: Name, Slug, Sites, Categories,
// Articles, Actions. Same Style A look as Categories (toolbar, card table,
// btn-danger "Delete", confirm, toast). "Add vertical" opens a modal (Name +
// Slug filled from the Name, editable) → POST /api/admin/verticals. "Delete"
// confirms with the number of Categories that lose the vertical →
// DELETE /api/admin/verticals/:id; a refusal (in use) shows the server's
// message in the error toast.
//
// Counts are real rows (see data.listAdminVerticalsWithUsage). Articles =
// Articles whose own vertical is this one, plus Articles with no own vertical
// whose Site uses it.

import { adminLayout, escapeHtml } from "./layout";

export interface VerticalListEntry {
  id: number;
  slug: string;
  name: string;
  site_count: number;
  category_count: number;
  article_count: number;
}

export interface VerticalsBranding {
  userEmail?: string;
  conversionsUiEnabled?: boolean;
}

function renderVerticalRow(v: VerticalListEntry): string {
  const id = escapeHtml(v.id);
  const name = escapeHtml(v.name);
  const slug = escapeHtml(v.slug);
  return `<tr data-vertical-id="${id}">
  <td>${name}</td>
  <td>${slug}</td>
  <td>${escapeHtml(v.site_count)}</td>
  <td>${escapeHtml(v.category_count)}</td>
  <td>${escapeHtml(v.article_count)}</td>
  <td>
    <button type="button" class="btn btn-danger btn-sm" data-delete-vertical="${id}" data-vertical-name="${name}" data-vertical-categories="${escapeHtml(v.category_count)}">Delete</button>
  </td>
</tr>`;
}

function renderVerticalsTable(verticals: ReadonlyArray<VerticalListEntry>): string {
  const rows = verticals.length === 0
    ? `<tr><td colspan="6" class="empty-state">No verticals yet</td></tr>`
    : verticals.map(renderVerticalRow).join("");
  return `<div class="card">
  <div class="table-wrapper">
    <table class="table verticals-list" aria-label="Verticals list">
      <thead><tr>
        <th scope="col">Name</th>
        <th scope="col">Slug</th>
        <th scope="col">Sites</th>
        <th scope="col">Categories</th>
        <th scope="col">Articles</th>
        <th scope="col">Actions</th>
      </tr></thead>
      <tbody id="verticals-list-body">${rows}</tbody>
    </table>
  </div>
</div>`;
}

function renderToolbar(): string {
  return `<div class="toolbar">
  <div class="toolbar-search"></div>
  <button type="button" id="open-new-vertical-modal" class="btn btn-primary">+ Add vertical</button>
</div>`;
}

function renderModal(): string {
  return `<div id="new-vertical-modal" class="modal hidden" style="display:none;" role="dialog" aria-labelledby="new-vertical-modal-title" aria-hidden="true">
  <div class="modal-content">
    <h2 id="new-vertical-modal-title" class="modal-title">Add vertical</h2>
    <form id="new-vertical-form" data-action="submit-new-vertical">
      <div class="form-group">
        <label for="new-vertical-name" class="form-label">Name</label>
        <input id="new-vertical-name" name="name" type="text" class="form-input" autocomplete="off" maxlength="80" required />
      </div>
      <div class="form-group">
        <label for="new-vertical-slug" class="form-label">Slug</label>
        <input id="new-vertical-slug" name="slug" type="text" class="form-input" autocomplete="off" maxlength="64" required />
        <small class="form-hint">Lowercase letters, numbers and dashes. Must be new.</small>
      </div>
      <p id="new-vertical-error" class="alert alert-error" hidden role="alert"></p>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">Add vertical</button>
        <button type="button" id="new-vertical-cancel" class="btn btn-secondary">Cancel</button>
      </div>
    </form>
  </div>
</div>`;
}

const VERTICALS_STYLES = '.modal{position:fixed;inset:0;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;z-index:1000}'
  + '.modal.hidden{display:none}'
  + '.modal-content{background:#fff;border-radius:8px;padding:24px;max-width:520px;width:90%;max-height:90vh;overflow-y:auto;box-shadow:0 10px 25px rgba(0,0,0,0.15)}'
  + '.modal-title{margin-bottom:16px;font-size:18px;font-weight:600}'
  + '.modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}'
  + '.form-hint{color:var(--c-muted);font-size:12px}';

// ES5 only (var, .then(), no template literals, no arrow functions) — the
// admin inline-script rule. The modal closes only after the POST answers.
// Slug follows the Name (layout's generateSlug) until the operator edits the
// Slug by hand. The slug regex is double-escaped for the TS template string.
const VERTICALS_LIST_SCRIPT = `
(function () {
  var SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  var modal = document.getElementById('new-vertical-modal');
  var opener = document.getElementById('open-new-vertical-modal');
  var cancel = document.getElementById('new-vertical-cancel');
  var form = document.getElementById('new-vertical-form');
  var nameEl = document.getElementById('new-vertical-name');
  var slugEl = document.getElementById('new-vertical-slug');
  var slugEdited = false;

  function openModal() {
    modal.style.display = 'flex';
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    if (nameEl) { nameEl.focus(); }
  }
  function closeModal() {
    modal.style.display = 'none';
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }
  function setError(msg) {
    var err = document.getElementById('new-vertical-error');
    if (err) { err.hidden = !msg; err.textContent = msg || ''; }
  }
  function slugFrom(text) {
    return window.generateSlug(text || '').replace(/_/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
  }

  function onDeleteClick() {
    var id = this.getAttribute('data-delete-vertical');
    var name = this.getAttribute('data-vertical-name') || 'this vertical';
    var cats = parseInt(this.getAttribute('data-vertical-categories') || '0', 10) || 0;
    if (!id) { return; }
    var msg = 'Delete vertical "' + name + '"? ' + cats + (cats === 1 ? ' Category loses' : ' Categories lose') + ' this vertical.';
    if (!window.confirmDelete(msg)) { return; }
    window.api('DELETE', '/api/admin/verticals/' + id).then(function (data) {
      if (data && data.error) {
        window.showToast('Error: ' + data.error, 'error');
      } else {
        window.location.reload();
      }
    }).catch(function () {
      window.showToast('Error: Failed to delete vertical', 'error');
    });
  }
  var deleteButtons = document.querySelectorAll('button[data-delete-vertical]');
  var i;
  for (i = 0; i < deleteButtons.length; i++) {
    deleteButtons[i].addEventListener('click', onDeleteClick);
  }

  if (!modal || !opener || !form || !nameEl || !slugEl) { return; }
  opener.addEventListener('click', function () {
    setError('');
    form.reset();
    slugEdited = false;
    openModal();
  });
  if (cancel) { cancel.addEventListener('click', closeModal); }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeModal(); } });
  modal.addEventListener('click', function (e) { if (e.target === modal) { closeModal(); } });
  nameEl.addEventListener('input', function () {
    if (!slugEdited) { slugEl.value = slugFrom(nameEl.value); }
  });
  slugEl.addEventListener('input', function () { slugEdited = slugEl.value.length > 0; });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    setError('');
    var name = (nameEl.value || '').replace(/^\\s+|\\s+$/g, '');
    var slug = (slugEl.value || '').replace(/^\\s+|\\s+$/g, '');
    if (!name) { setError('Name is required'); nameEl.focus(); return; }
    if (!SLUG_RE.test(slug)) {
      setError('Slug must use lowercase letters, numbers and dashes (for example: home-insurance)');
      slugEl.focus();
      return;
    }
    fetch('/api/admin/verticals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, slug: slug }),
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

export function verticalsListPage(
  verticals: ReadonlyArray<VerticalListEntry>,
  branding: VerticalsBranding = {},
): string {
  const content = `${renderToolbar()}${renderVerticalsTable(verticals)}${renderModal()}`;
  return adminLayout({
    title: "Verticals",
    activePath: "/admin/verticals",
    userEmail: branding.userEmail,
    conversionsUiEnabled: branding.conversionsUiEnabled,
    content,
    styles: VERTICALS_STYLES,
    scripts: VERTICALS_LIST_SCRIPT,
  });
}
