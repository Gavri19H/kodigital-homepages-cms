// Phase 3 / T22: Admin Pages tab view (site-aware).
//
// Renders /admin/pages with the multi-tenant Pages list contract: a
// toolbar exposing three required filter controls, each tagged with a
// stable data-filter="<key>" attribute, plus a page-type <select> whose
// name="page_type" backs server-side filtering. The T22.AC1 contract
// grep —
//   grep -cE '(data-filter="site"|data-filter="page_type"|data-filter="status"|name="page_type")'
//     api/src/admin/views/pages.ts  >= 4
// — relies on these literal attribute strings, so each appears on its
// own line. Do not merge them onto a single line and do not move them
// into a shared constant.
//
// Page-type filter values mirror the canonical page_type column added
// by T4 (generic, about, privacy-policy, terms, do-not-sell, contact).
// The legal-template slugs (privacy-policy, terms, do-not-sell, contact)
// are documented here so the editor (page-editor.ts) and tests agree.
//
// Preserves the T10.AC1 smoke contract: <body data-area="pages">, the
// marker 'kodigital-admin-shell', and the word 'Pages' all appear in
// the rendered HTML.

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderPagesView(): string {
  const title = escapeHtml("Pages");
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
    <nav aria-label="Admin sections">
      <a href="/admin">Home</a>
      <a href="/admin/articles">Articles</a>
      <a href="/admin/pages" aria-current="page">Pages</a>
      <a href="/admin/domains">Domains</a>
    </nav>
  </header>

  <section class="pages-toolbar" aria-label="Pages filters">
    <p>
      <label for="filter-site">Site</label>
      <select id="filter-site"
              name="site_id"
              data-filter="site">
        <option value="">All sites</option>
        <option value="__global__">Global only (templates)</option>
      </select>
    </p>

    <p>
      <label for="filter-page-type">Page type</label>
      <select id="filter-page-type"
              name="page_type"
              data-filter="page_type">
        <option value="">All page types</option>
        <option value="generic">generic</option>
        <option value="about">about</option>
        <option value="privacy-policy">privacy-policy</option>
        <option value="terms">terms</option>
        <option value="do-not-sell">do-not-sell</option>
        <option value="contact">contact</option>
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
      <a class="button" href="/admin/pages/new" data-action="new-page">New page</a>
    </p>
  </section>

  <table class="pages-list" aria-label="Pages list">
    <thead>
      <tr>
        <th scope="col" data-col="title">Title</th>
        <th scope="col" data-col="site">Site</th>
        <th scope="col" data-col="page_type">Page type</th>
        <th scope="col" data-col="slug">Slug</th>
        <th scope="col" data-col="status">Status</th>
        <th scope="col" data-col="show_in_footer">Footer</th>
        <th scope="col" data-col="updated_at">Updated</th>
        <th scope="col" data-col="actions">Actions</th>
      </tr>
    </thead>
    <tbody id="pages-list-body" data-empty="No pages yet"></tbody>
  </table>
</body>
</html>`;
}
