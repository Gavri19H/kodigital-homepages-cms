// Phase 3 / T25: Admin Tags tab view (site-aware).
//
// Renders /admin/tags with a Site filter dropdown that scopes the
// listing to a specific site OR the Global tier (site_id IS NULL).
// The T25.AC1 contract grep —
//   grep -cE 'data-filter="site"' api/src/admin/views/media.ts api/src/admin/views/tags.ts  >= 2
// — relies on the literal attribute string `data-filter="site"` appearing
// in this file exactly once. Do not move it onto a shared constant.
//
// Site filter behavioral contract (mirrors T25.AC2 for tags):
//   GIVEN tag rows with site_id IN {A, B, NULL}, WHEN the Tags tab
//   Site filter is set to 'A', THEN only A's tags + global (NULL)
//   tags are returned by GET /api/admin/tags?site_id=A; explicit
//   'Global only' selection returns only NULL.
//
// Preserves the T10.AC1 smoke contract: <body data-area="tags">, the
// marker 'kodigital-admin-shell', and the word 'Tags' all appear in
// the rendered HTML.

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderTagsView(): string {
  const title = escapeHtml("Tags");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta data-area="tags">
  <title>${title} | Kodigital CMS</title>
</head>
<body data-area="tags">
  <p data-marker="kodigital-admin-shell" hidden>shell</p>
  <header class="admin-header">
    <h1>${title}</h1>
    <nav aria-label="Admin sections">
      <a href="/admin">Home</a>
      <a href="/admin/articles">Articles</a>
      <a href="/admin/pages">Pages</a>
      <a href="/admin/tags" aria-current="page">Tags</a>
      <a href="/admin/domains">Domains</a>
    </nav>
  </header>

  <section class="tags-toolbar" aria-label="Tags filters">
    <p>
      <label for="filter-site">Site</label>
      <select id="filter-site"
              name="site_id"
              data-filter="site">
        <option value="">All sites</option>
        <option value="__global__">Global only</option>
      </select>
    </p>

    <p>
      <a class="button" href="/admin/tags/new" data-action="new-tag">New tag</a>
    </p>
  </section>

  <table class="tags-list" aria-label="Tags list">
    <thead>
      <tr>
        <th scope="col" data-col="name">Name</th>
        <th scope="col" data-col="slug">Slug</th>
        <th scope="col" data-col="site">Site</th>
        <th scope="col" data-col="article_count">Articles</th>
        <th scope="col" data-col="actions">Actions</th>
      </tr>
    </thead>
    <tbody id="tags-list-body" data-empty="No tags yet"></tbody>
  </table>
</body>
</html>`;
}
