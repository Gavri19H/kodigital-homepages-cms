// Phase 3 / T22: Admin Page editor view (site-aware).
//
// Renders /admin/pages/:id/edit (and /new) with a Page-type selector
// and a conditionally-required Site selector. T22.AC2 (behavioral):
//   GIVEN an About page editor with no site_id, WHEN the user attempts
//   to save, THEN the form blocks submit and surfaces an aria-live
//   "polite" status message "Site is required". Legal templates
//   (privacy-policy / terms / do-not-sell / contact) MAY save with
//   site_id NULL (global) and the UI surfaces a 'Global template'
//   badge — these are the four canonical slugs seeded by migration
//   0004 (T8) and any value not in this set requires a site_id.
//
// Inline script stays ES5-only (L-014) — no template literals, no
// arrow functions, no const/let — so it survives the Workers runtime
// parser without transpilation.

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderPageEditorView(): string {
  const title = escapeHtml("Page editor");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta data-area="pages">
  <title>${title} | Kodigital CMS</title>
</head>
<body data-area="pages">
  <p data-marker="kodigital-admin-shell" hidden>shell</p>
  <header class="admin-header">
    <h1>${title}</h1>
  </header>

  <form id="page-editor-form"
        method="post"
        action="/api/admin/pages"
        data-action="submit-page">
    <p>
      <label for="page-type">Page type</label>
      <select id="page-type"
              name="page_type"
              data-field="page_type"
              required>
        <option value="generic">generic</option>
        <option value="about">about</option>
        <option value="privacy-policy">privacy-policy</option>
        <option value="terms">terms</option>
        <option value="do-not-sell">do-not-sell</option>
        <option value="contact">contact</option>
      </select>
      <span id="page-global-badge"
            class="badge global-template"
            data-field="global_template_badge"
            hidden>Global template</span>
    </p>

    <p>
      <label for="page-site">Site</label>
      <select id="page-site"
              name="site_id"
              required
              aria-required="true"
              data-field="site_id"
              data-required-when="non_legal">
        <option value="">Select a site</option>
      </select>
      <small id="page-site-hint" data-field="site_hint">
        Legal templates may be saved as global (no site).
      </small>
    </p>

    <p>
      <label for="page-title">Title</label>
      <input id="page-title" name="title" type="text" required>
    </p>

    <p>
      <label for="page-slug">Slug</label>
      <input id="page-slug" name="slug" type="text" required>
    </p>

    <p>
      <label for="page-status">Status</label>
      <select id="page-status" name="status">
        <option value="draft">draft</option>
        <option value="pending">pending</option>
        <option value="published">published</option>
        <option value="archived">archived</option>
      </select>
    </p>

    <p>
      <label for="page-show-in-footer">Show in footer</label>
      <input id="page-show-in-footer"
             name="show_in_footer"
             type="checkbox"
             value="1">
    </p>

    <p>
      <label for="page-body">Body</label>
      <textarea id="page-body" name="body_md" rows="12"></textarea>
    </p>

    <div class="form-actions">
      <button type="submit" data-action="save-page">Save</button>
    </div>

    <p id="page-editor-status"
       role="status"
       aria-live="polite"
       data-field="status_message"></p>
  </form>

  <script>
    (function () {
      var form = document.getElementById('page-editor-form');
      var siteSelect = document.getElementById('page-site');
      var pageTypeSelect = document.getElementById('page-type');
      var status = document.getElementById('page-editor-status');
      var globalBadge = document.getElementById('page-global-badge');
      if (!form || !siteSelect || !pageTypeSelect || !status) { return; }

      // Canonical legal-template slugs (mirror migration 0004 / T8).
      var LEGAL_SLUGS = {
        'privacy-policy': 1,
        'terms': 1,
        'do-not-sell': 1,
        'contact': 1
      };

      function isLegalTemplate() {
        var v = pageTypeSelect.value;
        return Object.prototype.hasOwnProperty.call(LEGAL_SLUGS, v);
      }

      function setStatus(msg) {
        while (status.firstChild) { status.removeChild(status.firstChild); }
        if (msg) { status.appendChild(document.createTextNode(msg)); }
      }

      function applyLegalState() {
        if (isLegalTemplate()) {
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

      pageTypeSelect.addEventListener('change', function () {
        setStatus('');
        applyLegalState();
      });

      form.addEventListener('submit', function (e) {
        if (!siteSelect.value && !isLegalTemplate()) {
          e.preventDefault();
          if (typeof e.stopImmediatePropagation === 'function') {
            e.stopImmediatePropagation();
          }
          setStatus('Site is required');
          siteSelect.focus();
          return false;
        }
        return true;
      });

      applyLegalState();
    }());
  </script>
</body>
</html>`;
}
