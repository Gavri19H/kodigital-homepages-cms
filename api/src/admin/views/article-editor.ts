// Phase 3 / T21: Admin Article editor view (site-aware).
//
// Renders /admin/articles/:id/edit (and /new) with a required Site
// selector. T21.AC2 (deferred behavioral):
//   GIVEN no site selected, WHEN the user attempts to save, THEN the
//   form blocks submit, emits an aria-live="polite" status message
//   "Site is required", and never issues the POST. WHEN a site IS
//   selected, THEN the category dropdown is filtered to categories
//   allocated to that site's vertical(s).
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

export function renderArticleEditorView(): string {
  const title = escapeHtml("Article editor");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta data-area="articles">
  <title>${title} | Kodigital CMS</title>
</head>
<body data-area="articles">
  <p data-marker="kodigital-admin-shell" hidden>shell</p>
  <header class="admin-header">
    <h1>${title}</h1>
  </header>

  <form id="article-editor-form"
        method="post"
        action="/api/admin/articles"
        data-action="submit-article">
    <p>
      <label for="article-site">Site</label>
      <select id="article-site"
              name="site_id"
              required
              aria-required="true"
              data-field="site_id">
        <option value="">Select a site</option>
      </select>
    </p>

    <p>
      <label for="article-title">Title</label>
      <input id="article-title" name="title" type="text" required>
    </p>

    <p>
      <label for="article-slug">Slug</label>
      <input id="article-slug" name="slug" type="text" required>
    </p>

    <p>
      <label for="article-category">Category</label>
      <select id="article-category"
              name="category_id"
              data-field="category_id"
              data-scoped-by="site_id">
        <option value="">Select a category</option>
      </select>
    </p>

    <p>
      <label for="article-status">Status</label>
      <select id="article-status" name="status">
        <option value="draft">draft</option>
        <option value="pending">pending</option>
        <option value="published">published</option>
        <option value="archived">archived</option>
      </select>
    </p>

    <p>
      <label for="article-homepage-section">Homepage section</label>
      <select id="article-homepage-section" name="homepage_section">
        <option value="none">none</option>
        <option value="hero">hero</option>
        <option value="featured">featured</option>
        <option value="trending">trending</option>
      </select>
    </p>

    <p>
      <label for="article-body">Body</label>
      <textarea id="article-body" name="body_md" rows="12"></textarea>
    </p>

    <div class="form-actions">
      <button type="submit" data-action="save-article">Save</button>
    </div>

    <p id="article-editor-status"
       role="status"
       aria-live="polite"
       data-field="status_message"></p>
  </form>

  <script>
    (function () {
      var form = document.getElementById('article-editor-form');
      var siteSelect = document.getElementById('article-site');
      var status = document.getElementById('article-editor-status');
      var categorySelect = document.getElementById('article-category');
      if (!form || !siteSelect || !status) { return; }

      function setStatus(msg) {
        while (status.firstChild) { status.removeChild(status.firstChild); }
        status.appendChild(document.createTextNode(msg));
      }

      form.addEventListener('submit', function (e) {
        if (!siteSelect.value) {
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

      siteSelect.addEventListener('change', function () {
        if (!categorySelect) { return; }
        setStatus('');
        var siteId = siteSelect.value;
        if (!siteId) {
          categorySelect.setAttribute('data-scope-pending', '1');
          return;
        }
        categorySelect.removeAttribute('data-scope-pending');
        categorySelect.setAttribute('data-scope-site-id', siteId);
      });
    }());
  </script>
</body>
</html>`;
}
