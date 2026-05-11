// Phase 3 / T21: Admin Articles tab view (site-aware).
//
// Renders /admin/articles with the multi-tenant Articles list contract:
// a toolbar that exposes seven required filter controls, each tagged
// with a stable data-filter="<key>" attribute. The T21.AC1 contract
// grep —
//   grep -cE '(data-filter="site"|data-filter="vertical"|data-filter="category"|data-filter="status"|data-filter="featured"|data-filter="trending"|data-filter="published_date")'
//     api/src/admin/views/articles.ts  >= 7
// — relies on these literal attribute strings, so each filter control
// places its data-filter attribute on its own line. Do not merge them
// onto a single line and do not move them into a shared constant.
//
// Site selection rule (T21.AC2 deferred behavioral):
//   - The Site filter is required for cross-site authors.
//   - When a Site is selected, the Category filter is scoped to the
//     categories allocated to that site's vertical(s). The actual
//     scoping query lives server-side; this view exposes the controls.
//
// Preserves the T10.AC1 smoke contract: <body data-area="articles">,
// the marker 'kodigital-admin-shell', and the word 'Articles' appear
// in the rendered HTML.

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderArticlesView(): string {
  const title = escapeHtml("Articles");
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
    <nav aria-label="Admin sections">
      <a href="/admin">Home</a>
      <a href="/admin/articles" aria-current="page">Articles</a>
      <a href="/admin/domains">Domains</a>
    </nav>
  </header>

  <section class="articles-toolbar" aria-label="Articles filters">
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
      <label for="filter-category">Category</label>
      <select id="filter-category"
              name="category_id"
              data-filter="category">
        <option value="">All categories</option>
      </select>
    </p>

    <p>
      <label for="filter-status">Status</label>
      <select id="filter-status"
              name="status"
              data-filter="status">
        <option value="">All statuses</option>
        <option value="draft">draft</option>
        <option value="pending">pending</option>
        <option value="published">published</option>
        <option value="archived">archived</option>
      </select>
    </p>

    <p>
      <label for="filter-featured">Featured</label>
      <select id="filter-featured"
              name="featured"
              data-filter="featured">
        <option value="">Any</option>
        <option value="1">Featured</option>
        <option value="0">Not featured</option>
      </select>
    </p>

    <p>
      <label for="filter-trending">Trending</label>
      <select id="filter-trending"
              name="trending"
              data-filter="trending">
        <option value="">Any</option>
        <option value="1">Trending</option>
        <option value="0">Not trending</option>
      </select>
    </p>

    <p>
      <label for="filter-published-date">Published date</label>
      <input id="filter-published-date"
             name="published_date"
             type="date"
             data-filter="published_date">
    </p>
  </section>

  <table class="articles-list" aria-label="Articles list">
    <thead>
      <tr>
        <th scope="col" data-col="title">Title</th>
        <th scope="col" data-col="site">Site</th>
        <th scope="col" data-col="vertical">Vertical</th>
        <th scope="col" data-col="category">Category</th>
        <th scope="col" data-col="status">Status</th>
        <th scope="col" data-col="featured">Featured</th>
        <th scope="col" data-col="trending">Trending</th>
        <th scope="col" data-col="published_at">Published</th>
        <th scope="col" data-col="actions">Actions</th>
      </tr>
    </thead>
    <tbody id="articles-list-body" data-empty="No articles yet"></tbody>
  </table>
</body>
</html>`;
}
