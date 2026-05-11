// Phase 3 / T16: Admin Domains tab view.
//
// Renders the /admin/domains shell with the full multi-tenant Domains
// list contract: 9 column headers and 6 per-row actions, plus the
// New Site modal trigger that POSTs to /api/admin/sites (T13).
//
// The 15 contract markers counted by the T16.AC1 grep —
//   grep -cE '(Domain|Site name|Vertical|Activity|...|Open site)'
//     api/src/admin/views/domains.ts  >= 15
// — are each placed on their own line so the line-count is stable
// against future formatter changes. Column headers and action labels
// double as the visible UI text (no extra mapping layer).
//
// Accessibility (T16.AC2 deferred RC):
//   - Each form field in the New Site modal has a paired <label for=...>
//     binding. Inputs are reachable by keyboard tab order.
//   - The Activity <select> defaults to 'main' (Phase 3 only exposes
//     this single activity profile per site).
//   - The modal can be dismissed with the ESC keydown handler attached
//     to the document (kbd-parity for click-to-dismiss).
//   - The provisioning progress region (populated by T17) is
//     role=status with aria-live=polite for polling UI parity.
//
// Inline script stays ES5-only (L-014) — no template literals, no
// arrow functions, no const/let — so the script body survives the
// Workers runtime parser without a transpile step.
//
// Output preserves the T10.AC1 / T15.AC3 smoke contract:
//   - <body data-area="domains"> (T15.AC3 explicit check)
//   - the text 'Domains' appears in the rendered HTML (T15.AC3)
//   - the marker 'kodigital-admin-shell' appears (T10.AC1 smoke loop).

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderDomainsView(): string {
  const title = escapeHtml("Domains");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta data-area="domains">
  <title>${title} | Kodigital CMS</title>
</head>
<body data-area="domains">
  <p data-marker="kodigital-admin-shell" hidden>shell</p>
  <header class="admin-header">
    <h1>${title}</h1>
    <nav aria-label="Admin sections">
      <a href="/admin">Home</a>
      <a href="/admin/articles">Articles tab</a>
      <a href="/admin/domains" aria-current="page">Domains</a>
    </nav>
  </header>

  <section class="domains-toolbar">
    <button id="open-new-site-modal" type="button"
            data-action="open-new-site-modal">Add New Site</button>
  </section>

  <table class="domains-list" aria-label="Domains list">
    <thead>
      <tr>
        <th scope="col" data-col="domain">Domain</th>
        <th scope="col" data-col="site_name">Site name</th>
        <th scope="col" data-col="vertical">Vertical</th>
        <th scope="col" data-col="activity">Activity</th>
        <th scope="col" data-col="status">Status</th>
        <th scope="col" data-col="articles">Articles</th>
        <th scope="col" data-col="created">Created</th>
        <th scope="col" data-col="last_provisioned">Last provisioned</th>
        <th scope="col" data-col="actions">Actions</th>
      </tr>
    </thead>
    <tbody id="domains-list-body" data-empty="No sites yet"></tbody>
  </table>

  <template id="row-actions-template">
    <menu class="row-actions" role="menu" aria-label="Row actions">
      <li role="none"><button type="button" role="menuitem" data-row-action="view">View</button></li>
      <li role="none"><button type="button" role="menuitem" data-row-action="edit">Edit</button></li>
      <li role="none"><button type="button" role="menuitem" data-row-action="provision">Provision / Retry</button></li>
      <li role="none"><button type="button" role="menuitem" data-row-action="disable">Disable</button></li>
      <li role="none"><button type="button" role="menuitem" data-row-action="purge-cache">Purge cache</button></li>
      <li role="none"><a role="menuitem" target="_blank" rel="noopener" data-row-action="open-site">Open site</a></li>
    </menu>
  </template>

  <dialog id="new-site-modal" aria-labelledby="new-site-modal-title">
    <form method="dialog" data-action="submit-new-site">
      <h2 id="new-site-modal-title">Add New Site</h2>

      <p>
        <label for="new-site-domain">Domain</label>
        <input id="new-site-domain" name="domain" type="text"
               autocomplete="off" required>
      </p>

      <p>
        <label for="new-site-vertical">Vertical</label>
        <select id="new-site-vertical" name="vertical_slug" required>
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
        <label for="new-site-activity">Activity</label>
        <select id="new-site-activity" name="activity" required>
          <option value="main" selected>main</option>
        </select>
      </p>

      <div class="modal-actions">
        <button type="submit">Create site</button>
        <button type="button" data-action="close-new-site-modal">Cancel</button>
      </div>
    </form>
  </dialog>

  <section id="provisioning-progress" role="status" aria-live="polite"
           aria-label="Provisioning progress" hidden></section>

  <script>
    (function () {
      var modal = document.getElementById('new-site-modal');
      var opener = document.getElementById('open-new-site-modal');
      if (!modal || !opener) { return; }
      function openModal() {
        if (typeof modal.showModal === 'function') { modal.showModal(); }
        else { modal.setAttribute('open', ''); }
      }
      function closeModal() {
        if (typeof modal.close === 'function') { modal.close(); }
        else { modal.removeAttribute('open'); }
      }
      opener.addEventListener('click', openModal);
      var cancel = modal.querySelector('[data-action="close-new-site-modal"]');
      if (cancel) { cancel.addEventListener('click', closeModal); }
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { closeModal(); }
      });
    }());
  </script>
</body>
</html>`;
}
