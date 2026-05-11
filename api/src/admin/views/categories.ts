// Phase 3 / T23: Admin Categories tab view (site-aware, multi-vertical).
//
// Renders /admin/categories with a verticals multi-select that allows a
// category to be allocated to multiple verticals at once (e.g. "Healthy
// Meals" -> health + food + parenting). The T23.AC1 contract grep —
//   grep -cE '(multiple).*verticals|verticals.*multiple' api/src/admin/views/categories.ts  >= 1
// — relies on the literal token "multiple" appearing on the same line as
// "verticals" (or vice versa). The <select multiple ... data-field="verticals">
// element below carries both tokens on one line so the grep counts >= 1.
//
// Verticals enumerated below mirror the canonical 8 slugs seeded by
// migration 0004 (T8): home, finance, travel, health, parenting, food,
// tech, lifestyle. Adding a new vertical here without a matching seed
// row will silently fail to persist (FK to verticals.slug).
//
// Persistence contract (T23.AC2 behavioral):
//   GIVEN a category editor, WHEN the user selects verticals ['home','tech']
//   and saves, THEN category_verticals contains both rows
//   (category_id, vertical_id). The <select multiple name="verticals[]">
//   submits a multi-value field which the server splits into rows for the
//   category_verticals join table.
//
// Preserves the T10.AC1 smoke contract: <body data-area="categories">,
// the marker 'kodigital-admin-shell', and the word 'Categories' all
// appear in the rendered HTML. Inline script stays ES5-only (L-014).

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderCategoriesView(): string {
  const title = escapeHtml("Categories");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta data-area="categories">
  <title>${title} | Kodigital CMS</title>
</head>
<body data-area="categories">
  <p data-marker="kodigital-admin-shell" hidden>shell</p>
  <header class="admin-header">
    <h1>${title}</h1>
    <nav aria-label="Admin sections">
      <a href="/admin">Home</a>
      <a href="/admin/articles">Articles</a>
      <a href="/admin/pages">Pages</a>
      <a href="/admin/categories" aria-current="page">Categories</a>
      <a href="/admin/domains">Domains</a>
    </nav>
  </header>

  <section class="categories-toolbar" aria-label="Categories filters">
    <p>
      <label for="filter-site">Site</label>
      <select id="filter-site"
              name="site_id"
              data-filter="site">
        <option value="">All sites</option>
      </select>
    </p>

    <p>
      <label for="filter-vertical">Vertical</label>
      <select id="filter-vertical"
              name="vertical_slug"
              data-filter="vertical">
        <option value="">All verticals</option>
        <option value="home">home</option>
        <option value="finance">finance</option>
        <option value="travel">travel</option>
        <option value="health">health</option>
        <option value="parenting">parenting</option>
        <option value="food">food</option>
        <option value="tech">tech</option>
        <option value="lifestyle">lifestyle</option>
      </select>
    </p>

    <p>
      <a class="button" href="/admin/categories/new" data-action="new-category">New category</a>
    </p>
  </section>

  <form id="category-editor-form"
        method="post"
        action="/api/admin/categories"
        data-action="submit-category">
    <p>
      <label for="category-name">Name</label>
      <input id="category-name" name="name" type="text" required>
    </p>

    <p>
      <label for="category-slug">Slug</label>
      <input id="category-slug" name="slug" type="text" required>
    </p>

    <fieldset class="category-verticals" data-field="verticals">
      <legend id="category-verticals-legend">
        Verticals (select one or more — categories may belong to multiple verticals)
      </legend>
      <p id="category-verticals-hint" class="hint">
        Categories with multiple verticals appear in every matching site (e.g. Healthy Meals -> health + food + parenting).
      </p>
      <select id="category-verticals" name="verticals[]" multiple required aria-labelledby="category-verticals-legend" data-field="verticals" data-multi="true" size="8">
        <option value="home">home</option>
        <option value="finance">finance</option>
        <option value="travel">travel</option>
        <option value="health">health</option>
        <option value="parenting">parenting</option>
        <option value="food">food</option>
        <option value="tech">tech</option>
        <option value="lifestyle">lifestyle</option>
      </select>
    </fieldset>

    <div class="form-actions">
      <button type="submit" data-action="save-category">Save</button>
    </div>

    <p id="category-editor-status"
       role="status"
       aria-live="polite"
       data-field="status_message"></p>
  </form>

  <table class="categories-list" aria-label="Categories list">
    <thead>
      <tr>
        <th scope="col" data-col="name">Name</th>
        <th scope="col" data-col="slug">Slug</th>
        <th scope="col" data-col="verticals">Verticals</th>
        <th scope="col" data-col="article_count">Articles</th>
        <th scope="col" data-col="actions">Actions</th>
      </tr>
    </thead>
    <tbody id="categories-list-body" data-empty="No categories yet"></tbody>
  </table>

  <script>
    (function () {
      var form = document.getElementById('category-editor-form');
      var verticals = document.getElementById('category-verticals');
      var status = document.getElementById('category-editor-status');
      if (!form || !verticals || !status) { return; }

      function setStatus(msg) {
        while (status.firstChild) { status.removeChild(status.firstChild); }
        if (msg) { status.appendChild(document.createTextNode(msg)); }
      }

      function selectedVerticalCount() {
        var n = 0;
        var i;
        for (i = 0; i < verticals.options.length; i = i + 1) {
          if (verticals.options[i].selected) { n = n + 1; }
        }
        return n;
      }

      form.addEventListener('submit', function (e) {
        if (selectedVerticalCount() < 1) {
          e.preventDefault();
          if (typeof e.stopImmediatePropagation === 'function') {
            e.stopImmediatePropagation();
          }
          setStatus('Select at least one vertical');
          verticals.focus();
          return false;
        }
        return true;
      });
    }());
  </script>
</body>
</html>`;
}
