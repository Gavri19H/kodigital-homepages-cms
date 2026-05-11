// Phase 3 / T25: Admin Media tab view (site-aware).
//
// Renders /admin/media with a Site filter dropdown that scopes the
// listing to a specific site OR the Global tier (site_id IS NULL).
// The T25.AC1 contract grep —
//   grep -cE 'data-filter="site"' api/src/admin/views/media.ts api/src/admin/views/tags.ts  >= 2
// — relies on the literal attribute string `data-filter="site"` appearing
// in this file exactly once. Do not move it onto a shared constant.
//
// Site filter behavioral contract (T25.AC2):
//   GIVEN media rows with site_id IN {A, B, NULL}, WHEN the Media tab
//   Site filter is set to 'A', THEN only A's media + global (NULL) media
//   are returned by GET /api/admin/media?site_id=A; explicit 'Global
//   only' selection returns only NULL.
//
// The two sentinel option values below back the two filter modes:
//   value=""           -> all sites (admin overview)
//   value="<siteId>"   -> site A + globals (site_id NULL fallback)
//   value="__global__" -> Global only (site_id IS NULL)
//
// Preserves the T10.AC1 smoke contract: <body data-area="media">, the
// marker 'kodigital-admin-shell', and the word 'Media' all appear in
// the rendered HTML.

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderMediaView(): string {
  const title = escapeHtml("Media");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta data-area="media">
  <title>${title} | Kodigital CMS</title>
</head>
<body data-area="media">
  <p data-marker="kodigital-admin-shell" hidden>shell</p>
  <header class="admin-header">
    <h1>${title}</h1>
    <nav aria-label="Admin sections">
      <a href="/admin">Home</a>
      <a href="/admin/articles">Articles</a>
      <a href="/admin/pages">Pages</a>
      <a href="/admin/media" aria-current="page">Media</a>
      <a href="/admin/domains">Domains</a>
    </nav>
  </header>

  <section class="media-toolbar" aria-label="Media filters">
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
      <label for="filter-kind">Kind</label>
      <select id="filter-kind"
              name="kind"
              data-filter="kind">
        <option value="">All kinds</option>
        <option value="image">image</option>
        <option value="video">video</option>
        <option value="document">document</option>
      </select>
    </p>

    <p>
      <a class="button" href="/admin/media/new" data-action="new-media">Upload media</a>
    </p>
  </section>

  <table class="media-list" aria-label="Media list">
    <thead>
      <tr>
        <th scope="col" data-col="preview">Preview</th>
        <th scope="col" data-col="filename">Filename</th>
        <th scope="col" data-col="site">Site</th>
        <th scope="col" data-col="kind">Kind</th>
        <th scope="col" data-col="size">Size</th>
        <th scope="col" data-col="uploaded_at">Uploaded</th>
        <th scope="col" data-col="actions">Actions</th>
      </tr>
    </thead>
    <tbody id="media-list-body" data-empty="No media yet"></tbody>
  </table>
</body>
</html>`;
}
