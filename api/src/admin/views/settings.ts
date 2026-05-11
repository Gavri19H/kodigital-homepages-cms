// Phase 3 / T24: Admin Settings tab view (site-scoped).
//
// Renders /admin/settings with a REQUIRED Site selector that scopes every
// setting key to the chosen site_id. The T24.AC1 contract grep —
//   grep -cE '(data-filter="site"|name="site_id")' api/src/admin/views/settings.ts
// — must count >= 1; the <select id="filter-site" name="site_id"
// data-filter="site"> below carries BOTH tokens (data-filter="site" on
// one line, name="site_id" on the same select). The view also carries a
// hidden form field `name="site_id"` so the PATCH payload always pins
// each update to its site_id (server-side it asserts the (site_id, key)
// uniqueness from migration 0003 / T6).
//
// Persistence contract (T24.AC2 behavioral):
//   GIVEN a site exists with settings_version=1, WHEN PATCH
//   /api/admin/settings updates 'tagline' for that site_id, THEN
//   site_settings row (site_id, 'tagline') value is updated AND
//   sites.settings_version is incremented to 2 in the same transaction
//   (D1 batch).
//
// The 12 canonical keys mirror the create_site_settings seed (T19 /
// steps.ts) so every site that completes provisioning has a row for
// each key. The editor lets an operator edit any subset and PATCH the
// changes back; the server enforces the (site_id, key) shape and bumps
// sites.settings_version exactly once per PATCH call.
//
// Preserves the T10.AC1 smoke contract: <body data-area="settings">,
// the marker 'kodigital-admin-shell', and the word 'Settings' all appear
// in the rendered HTML. Inline script stays ES5-only (L-014).

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Canonical 12 per-site setting keys (mirror create_site_settings seed
// in api/src/site-provisioning/steps.ts T19). Keep this list aligned
// with that seed — diverging will cause a freshly-provisioned site to
// expose fewer (or more) editable keys than the seed claims.
const SETTING_KEYS: ReadonlyArray<string> = [
  "site_name",
  "logo_media_id",
  "tagline",
  "site_description",
  "brand_tokens_json",
  "robots_txt_content",
  "ads_txt_content",
  "custom_head_html",
  "custom_footer_html",
  "newsletter_settings_json",
  "contact_email",
  "privacy_email",
];

function renderSettingRow(key: string): string {
  return `<tr data-setting-key="${escapeHtml(key)}">
        <th scope="row"><label for="setting-${escapeHtml(key)}">${escapeHtml(key)}</label></th>
        <td>
          <input id="setting-${escapeHtml(key)}"
                 name="${escapeHtml(key)}"
                 type="text"
                 data-field="setting_value"
                 data-key="${escapeHtml(key)}">
        </td>
      </tr>`;
}

export function renderSettingsView(): string {
  const title = escapeHtml("Settings");
  const rows = SETTING_KEYS.map(renderSettingRow).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta data-area="settings">
  <title>${title} | Kodigital CMS</title>
</head>
<body data-area="settings">
  <p data-marker="kodigital-admin-shell" hidden>shell</p>
  <header class="admin-header">
    <h1>${title}</h1>
    <nav aria-label="Admin sections">
      <a href="/admin">Home</a>
      <a href="/admin/articles">Articles</a>
      <a href="/admin/pages">Pages</a>
      <a href="/admin/categories">Categories</a>
      <a href="/admin/settings" aria-current="page">Settings</a>
      <a href="/admin/domains">Domains</a>
    </nav>
  </header>

  <section class="settings-toolbar" aria-label="Site selector">
    <p>
      <label for="filter-site">Site</label>
      <select id="filter-site"
              name="site_id"
              data-filter="site"
              required
              aria-required="true">
        <option value="">Select a site</option>
      </select>
      <small id="filter-site-hint">Settings are scoped to the chosen site.</small>
    </p>
  </section>

  <form id="settings-editor-form"
        method="post"
        action="/api/admin/settings"
        data-action="submit-settings"
        data-method="PATCH">
    <input type="hidden" id="settings-site-id" name="site_id" data-field="site_id" value="">

    <table class="settings-list" aria-label="Per-site settings">
      <thead>
        <tr>
          <th scope="col" data-col="key">Key</th>
          <th scope="col" data-col="value">Value</th>
        </tr>
      </thead>
      <tbody id="settings-rows" data-empty="Select a site to view settings">
        ${rows}
      </tbody>
    </table>

    <div class="form-actions">
      <button type="submit" data-action="save-settings">Save settings</button>
    </div>

    <p id="settings-editor-status"
       role="status"
       aria-live="polite"
       data-field="status_message"></p>
  </form>

  <script>
    (function () {
      var form = document.getElementById('settings-editor-form');
      var filter = document.getElementById('filter-site');
      var hidden = document.getElementById('settings-site-id');
      var status = document.getElementById('settings-editor-status');
      if (!form || !filter || !hidden || !status) { return; }

      function setStatus(msg) {
        while (status.firstChild) { status.removeChild(status.firstChild); }
        if (msg) { status.appendChild(document.createTextNode(msg)); }
      }

      filter.addEventListener('change', function () {
        hidden.value = filter.value;
        setStatus('');
      });

      form.addEventListener('submit', function (e) {
        if (!hidden.value) {
          e.preventDefault();
          if (typeof e.stopImmediatePropagation === 'function') {
            e.stopImmediatePropagation();
          }
          setStatus('Site is required');
          filter.focus();
          return false;
        }
        return true;
      });
    }());
  </script>
</body>
</html>`;
}

export { SETTING_KEYS };
