// Admin Settings template — T32 [B11] Settings port (per-site) +
// T15 full parity restore.
// settingsPage — required Site selector + per-site editor laid out in a
// tabbed layout (settings-tabs / tab-* panels). It edits the 12 canonical
// site_settings keys (site_name, logo_media_id, tagline, site_description,
// brand_tokens_json, robots_txt_content, ads_txt_content, custom_head_html,
// custom_footer_html, newsletter_settings_json, contact_email, privacy_email)
// plus two T15 parity keys persisted through the same arbitrary-key PATCH
// route: items_per_page (listing page size) and site_logo_url (uploaded
// logo URL).
//
// T15 parity additions vs the legacy reference:
//   * Site Logo card carries BOTH a file upload (logoFileInput ->
//     POST /admin/media multipart `file` -> sets the hidden site_logo_url)
//     AND the existing AI-logo panel (ai-logo-panel / ai-logo-generate ->
//     POST /api/admin/ai/logo).
//   * an items_per_page number control.
//   * a settings-tabs / tab-* tabbed layout grouping the legacy cards.
//   * the Newsletter card uses structured fields (newsletter_enabled +
//     newsletter_provider) instead of a raw newsletter_settings_json
//     textarea; the submit script composes those into the canonical
//     newsletter_settings_json JSON value (a hidden input keeps the raw
//     JSON for round-trip).
//
// Saving sends PATCH /api/admin/settings with {site_id, updates:{key:value}}
// (the T24 wire shape) and the handler bumps sites.settings_version
// atomically. Brand text comes from adminLayout (KoDigital CMS); no legacy
// brand strings are emitted from this template.

import { adminLayout, escapeHtml } from "./layout";

export interface SiteOption {
  id: string;
  name?: string;
}

export type SettingsValueMap = { [key: string]: string | number | null | undefined };

export interface SettingsBranding {
  userEmail?: string;
}

export const SETTING_KEYS: ReadonlyArray<string> = [
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

// T15 parity keys (items_per_page, site_logo_url) are persisted alongside
// the 12 canonical keys via the same arbitrary-key PATCH route. They are
// kept OUT of SETTING_KEYS so the canonical-key contract (handler +
// round-trip tests) is unchanged; the submit script lists them explicitly.

const NEWSLETTER_PROVIDERS: ReadonlyArray<[string, string]> = [
  ["", "None"],
  ["mailchimp", "Mailchimp"],
  ["convertkit", "ConvertKit"],
  ["buttondown", "Buttondown"],
  ["substack", "Substack"],
  ["custom", "Custom"],
];

interface NewsletterConfig {
  enabled: boolean;
  provider: string;
}

function settingValue(values: SettingsValueMap, key: string): string {
  const raw = values[key];
  return raw === undefined || raw === null ? "" : String(raw);
}

// Parse the stored newsletter_settings_json into the structured fields.
// Corrupt / non-JSON values fall back to disabled + no provider (the raw
// value is still preserved in the hidden input for round-trip).
function parseNewsletter(raw: string): NewsletterConfig {
  if (raw.length === 0) {
    return { enabled: false, provider: "" };
  }
  try {
    const parsed = JSON.parse(raw) as { enabled?: unknown; provider?: unknown };
    return {
      enabled: parsed.enabled === true || parsed.enabled === "true",
      provider: typeof parsed.provider === "string" ? parsed.provider : "",
    };
  } catch {
    return { enabled: false, provider: "" };
  }
}

function renderSiteOptions(sites: ReadonlyArray<SiteOption>, selected?: string | null): string {
  const blank = `<option value="">Select a site</option>`;
  const opts = sites.map(function (s: SiteOption): string {
    const sel = (selected ?? "") === s.id ? " selected" : "";
    return `<option value="${escapeHtml(s.id)}"${sel}>${escapeHtml(s.name ?? s.id)}</option>`;
  }).join("");
  return blank + opts;
}

function renderSiteSelector(sites: ReadonlyArray<SiteOption>, selectedSiteId?: string | null): string {
  return `<div class="toolbar">
  <div class="toolbar-filters">
    <label for="filter-site" class="form-label">Site</label>
    <select id="filter-site" name="site_id" class="form-select" data-filter="site" required aria-required="true">
      ${renderSiteOptions(sites, selectedSiteId)}
    </select>
    <small id="filter-site-hint" class="form-hint">Settings are scoped to the chosen site.</small>
  </div>
</div>`;
}

function renderTextField(key: string, label: string, value: string, hint?: string): string {
  const safeKey = escapeHtml(key);
  const hintHtml = hint ? `<small class="form-hint">${escapeHtml(hint)}</small>` : "";
  return `<div class="form-group" data-setting-key="${safeKey}">
    <label for="setting-${safeKey}" class="form-label">${escapeHtml(label)}</label>
    <input id="setting-${safeKey}" name="${safeKey}" type="text" class="form-input" data-field="setting_value" data-key="${safeKey}" value="${escapeHtml(value)}" />
    ${hintHtml}
  </div>`;
}

function renderTextareaField(
  key: string,
  label: string,
  value: string,
  rows: number,
  hint?: string,
  mono?: boolean,
): string {
  const safeKey = escapeHtml(key);
  const cls = mono === true ? "form-textarea form-textarea--mono" : "form-textarea";
  const hintHtml = hint ? `<small class="form-hint">${escapeHtml(hint)}</small>` : "";
  return `<div class="form-group" data-setting-key="${safeKey}">
    <label for="setting-${safeKey}" class="form-label">${escapeHtml(label)}</label>
    <textarea id="setting-${safeKey}" name="${safeKey}" rows="${rows}" class="${cls}" data-field="setting_value" data-key="${safeKey}">${escapeHtml(value)}</textarea>
    ${hintHtml}
  </div>`;
}

function renderCard(title: string, body: string): string {
  return `<div class="card">
    <div class="card-header"><h3 class="card-title">${escapeHtml(title)}</h3></div>
    ${body}
  </div>`;
}

function renderSiteInformationCard(values: SettingsValueMap): string {
  return renderCard(
    "Site Information",
    renderTextField("site_name", "Site Name", settingValue(values, "site_name")) +
      renderTextField("tagline", "Tagline", settingValue(values, "tagline")) +
      renderTextareaField(
        "site_description",
        "Site Description",
        settingValue(values, "site_description"),
        3,
        "Used for SEO and social sharing.",
      ) +
      renderTextField(
        "contact_email",
        "Contact Email",
        settingValue(values, "contact_email"),
        "Shown on the public contact surface.",
      ) +
      renderTextField(
        "privacy_email",
        "Privacy Email",
        settingValue(values, "privacy_email"),
        "Used in privacy/legal pages.",
      ),
  );
}

// T15: Display preferences — items_per_page listing page size.
function renderDisplayCard(values: SettingsValueMap): string {
  const value = settingValue(values, "items_per_page");
  return renderCard(
    "Display",
    `<div class="form-group" data-setting-key="items_per_page">
      <label for="setting-items_per_page" class="form-label">Items per page</label>
      <input id="setting-items_per_page" name="items_per_page" type="number" min="1" max="100" step="1" class="form-input" data-field="setting_value" data-key="items_per_page" value="${escapeHtml(value)}" placeholder="10" />
      <small class="form-hint">Number of articles shown per page on listing and category pages.</small>
    </div>`,
  );
}

function renderSiteLogoCard(values: SettingsValueMap): string {
  const logoUrl = settingValue(values, "site_logo_url");
  const previewImg = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="Current logo" />`
    : "";
  // T15: file upload (logoFileInput -> POST /admin/media -> site_logo_url).
  const fileUpload = `<div class="form-group" data-setting-key="site_logo_url">
    <label class="form-label" for="logoFileInput">Upload logo</label>
    <input id="logoFileInput" type="file" accept="image/*" class="form-input" />
    <input type="hidden" id="setting-site_logo_url" name="site_logo_url" data-field="setting_value" data-key="site_logo_url" value="${escapeHtml(logoUrl)}" />
    <p id="logo-upload-status" class="form-status" role="status" aria-live="polite"></p>
    <div id="logo-upload-preview" class="site-logo-preview" aria-hidden="false">${previewImg}</div>
    <small class="form-hint">Upload a logo image; it is stored in the media library and applied to this site.</small>
  </div>`;
  const aiPanel = `<div class="ai-logo-panel" data-panel="ai-logo">
    <p class="form-hint">Generate a logo with AI for the selected site. The generated image is saved to the media library and applied to this site automatically.</p>
    <div class="form-actions">
      <button type="button" id="ai-logo-generate" class="btn btn-secondary" data-action="generate-logo">Generate with AI</button>
    </div>
    <p id="ai-logo-status" class="form-status" role="status" aria-live="polite"></p>
    <div id="ai-logo-preview" class="ai-logo-preview" aria-hidden="false"></div>
  </div>`;
  return renderCard(
    "Site Logo",
    renderTextField(
      "logo_media_id",
      "Logo Media ID",
      settingValue(values, "logo_media_id"),
      "Media library id of the logo image.",
    ) + fileUpload + aiPanel,
  );
}

function renderAdsTxtCard(values: SettingsValueMap): string {
  return renderCard(
    "ads.txt",
    renderTextareaField(
      "ads_txt_content",
      "ads.txt Content",
      settingValue(values, "ads_txt_content"),
      8,
      "Authorizes ad exchanges to sell your ad inventory. One entry per line: domain, publisher-id, relationship, certification-id.",
      true,
    ),
  );
}

function renderRobotsTxtCard(values: SettingsValueMap): string {
  return renderCard(
    "robots.txt",
    renderTextareaField(
      "robots_txt_content",
      "robots.txt Content",
      settingValue(values, "robots_txt_content"),
      8,
      "Directives for search engine crawlers. Use {{DOMAIN}} as a placeholder for the site domain.",
      true,
    ),
  );
}

function renderBrandTokensCard(values: SettingsValueMap): string {
  return renderCard(
    "Brand Tokens",
    renderTextareaField(
      "brand_tokens_json",
      "Brand Tokens (JSON)",
      settingValue(values, "brand_tokens_json"),
      6,
      "Per-site design token overrides as JSON.",
      true,
    ),
  );
}

// T15: structured Newsletter fields (enabled + provider) instead of a raw
// newsletter_settings_json textarea. A hidden input keeps the canonical
// newsletter_settings_json value for round-trip; the submit script composes
// the structured fields back into it.
function renderNewsletterCard(values: SettingsValueMap): string {
  const raw = settingValue(values, "newsletter_settings_json");
  const cfg = parseNewsletter(raw);
  const checked = cfg.enabled ? " checked" : "";
  const opts = NEWSLETTER_PROVIDERS.map(function (pair: [string, string]): string {
    const sel = cfg.provider === pair[0] ? " selected" : "";
    return `<option value="${escapeHtml(pair[0])}"${sel}>${escapeHtml(pair[1])}</option>`;
  }).join("");
  const body = `<div class="form-group" data-setting-key="newsletter_enabled">
      <label class="form-check">
        <input type="checkbox" id="newsletter_enabled" name="newsletter_enabled" data-field="newsletter_enabled"${checked} />
        <span>Enabled</span>
      </label>
      <small class="form-hint">Show the newsletter signup on public pages.</small>
    </div>
    <div class="form-group" data-setting-key="newsletter_provider">
      <label for="newsletter_provider" class="form-label">Provider</label>
      <select id="newsletter_provider" name="newsletter_provider" class="form-select" data-field="newsletter_provider">${opts}</select>
      <small class="form-hint">Email service provider used for newsletter delivery.</small>
    </div>
    <input type="hidden" id="setting-newsletter_settings_json" name="newsletter_settings_json" data-field="setting_value" data-key="newsletter_settings_json" value="${escapeHtml(raw)}" />`;
  return renderCard("Newsletter", body);
}

function renderCustomHtmlCard(values: SettingsValueMap): string {
  return renderCard(
    "Custom HTML",
    renderTextareaField(
      "custom_head_html",
      "Custom Head HTML",
      settingValue(values, "custom_head_html"),
      4,
      "Injected into <head> on public pages (fonts, meta tags).",
      true,
    ) +
      renderTextareaField(
        "custom_footer_html",
        "Custom Footer HTML",
        settingValue(values, "custom_footer_html"),
        4,
        "Injected before </body> on public pages (scripts, widgets).",
        true,
      ),
  );
}

interface TabDef {
  key: string;
  label: string;
}

const SETTINGS_TABS: ReadonlyArray<TabDef> = [
  { key: "general", label: "General" },
  { key: "logo", label: "Logo" },
  { key: "seo", label: "SEO & Files" },
  { key: "newsletter", label: "Newsletter" },
  { key: "advanced", label: "Advanced" },
];

function renderTablist(): string {
  const buttons = SETTINGS_TABS.map(function (tab: TabDef, i: number): string {
    const active = i === 0;
    const cls = active ? "settings-tab active" : "settings-tab";
    return `<button type="button" class="${cls}" data-tab="${escapeHtml(tab.key)}" role="tab" aria-controls="tab-${escapeHtml(tab.key)}" aria-selected="${active ? "true" : "false"}">${escapeHtml(tab.label)}</button>`;
  }).join("");
  return `<div class="settings-tablist" role="tablist">${buttons}</div>`;
}

function renderTabPanel(key: string, first: boolean, body: string): string {
  const safeKey = escapeHtml(key);
  const hidden = first ? "" : " hidden";
  return `<div id="tab-${safeKey}" class="settings-tabpanel" role="tabpanel" data-tabpanel="${safeKey}"${hidden}>${body}</div>`;
}

function renderTabs(values: SettingsValueMap): string {
  const panels =
    renderTabPanel("general", true, renderSiteInformationCard(values) + renderDisplayCard(values)) +
    renderTabPanel("logo", false, renderSiteLogoCard(values)) +
    renderTabPanel(
      "seo",
      false,
      renderAdsTxtCard(values) + renderRobotsTxtCard(values) + renderBrandTokensCard(values),
    ) +
    renderTabPanel("newsletter", false, renderNewsletterCard(values)) +
    renderTabPanel("advanced", false, renderCustomHtmlCard(values));
  return `<div class="settings-tabs" data-component="settings-tabs">
    ${renderTablist()}
    ${panels}
  </div>`;
}

function renderEditor(values: SettingsValueMap, selectedSiteId: string | null | undefined): string {
  return `<form id="settings-editor-form" class="settings-form" data-action="submit-settings" data-method="PATCH">
    <input type="hidden" id="settings-site-id" name="site_id" data-field="site_id" value="${escapeHtml(selectedSiteId ?? "")}" />
    ${renderTabs(values)}
    <p id="settings-form-error" class="alert alert-error" hidden role="alert"></p>
    <p id="settings-editor-status" class="form-status" role="status" aria-live="polite" data-field="status_message"></p>
    <div class="form-actions">
      <button type="submit" class="btn btn-primary" data-action="save-settings">Save settings</button>
    </div>
  </form>`;
}

const SETTINGS_STYLES = `
.form-textarea--mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.ai-logo-panel { margin-top: 12px; padding: 12px; border: 1px solid var(--c-border, #d9dde3); border-radius: 8px; }
.ai-logo-preview { margin-top: 8px; }
.ai-logo-preview img { max-height: 60px; max-width: 240px; object-fit: contain; border: 1px solid var(--c-border, #d9dde3); border-radius: 6px; padding: 4px; }
.site-logo-preview { margin-top: 8px; }
.site-logo-preview img { max-height: 60px; max-width: 240px; object-fit: contain; border: 1px solid var(--c-border, #d9dde3); border-radius: 6px; padding: 4px; }
.form-check { display: flex; align-items: center; gap: 8px; font-weight: 500; }
.form-check input { width: auto; }
.settings-tablist { display: flex; flex-wrap: wrap; gap: 4px; border-bottom: 1px solid var(--c-border, #e5e7eb); margin-bottom: 24px; }
.settings-tab { background: none; border: none; border-bottom: 2px solid transparent; padding: 10px 16px; font-size: 14px; font-weight: 500; color: var(--c-muted, #6b7280); cursor: pointer; }
.settings-tab:hover { color: var(--c-text, #111827); }
.settings-tab.active { color: var(--c-primary, #2563eb); border-bottom-color: var(--c-primary, #2563eb); }
`;

const SETTINGS_SCRIPT = `
(function(){
  var form = document.getElementById('settings-editor-form');
  var filter = document.getElementById('filter-site');
  var hidden = document.getElementById('settings-site-id');
  var status = document.getElementById('settings-editor-status');
  var errEl = document.getElementById('settings-form-error');

  // ---- Tabbed layout (settings-tabs / tab-*) ----
  var tabs = document.querySelectorAll('.settings-tab');
  var panels = document.querySelectorAll('.settings-tabpanel');
  function activateTab(target) {
    var i;
    for (i = 0; i < tabs.length; i = i + 1) {
      var on = tabs[i].getAttribute('data-tab') === target;
      tabs[i].className = on ? 'settings-tab active' : 'settings-tab';
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    for (i = 0; i < panels.length; i = i + 1) {
      panels[i].hidden = panels[i].getAttribute('data-tabpanel') !== target;
    }
  }
  for (var t = 0; t < tabs.length; t = t + 1) {
    tabs[t].addEventListener('click', function () {
      activateTab(this.getAttribute('data-tab'));
    });
  }

  if (!form || !filter || !hidden || !status) { return; }
  function setStatus(msg) {
    while (status.firstChild) { status.removeChild(status.firstChild); }
    if (msg) { status.appendChild(document.createTextNode(msg)); }
  }
  function setError(msg) { if (errEl) { errEl.hidden = !msg; errEl.textContent = msg || ''; } }
  filter.addEventListener('change', function () {
    hidden.value = filter.value;
    setStatus('');
    setError('');
    if (filter.value) {
      window.location.href = '/admin/settings?site_id=' + encodeURIComponent(filter.value);
    }
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    setError('');
    if (!hidden.value) {
      setStatus('Site is required');
      setError('Site is required');
      filter.focus();
      return;
    }
    var fd = new FormData(form);
    var updates = {};
    var keys = ['site_name','logo_media_id','tagline','site_description','brand_tokens_json','robots_txt_content','ads_txt_content','custom_head_html','custom_footer_html','newsletter_settings_json','contact_email','privacy_email','items_per_page','site_logo_url'];
    for (var i = 0; i < keys.length; i = i + 1) {
      var v = fd.get(keys[i]);
      updates[keys[i]] = v === null ? '' : String(v);
    }
    // T15: compose the structured newsletter fields into the canonical
    // newsletter_settings_json value (overrides the hidden raw input).
    var nlEnabled = document.getElementById('newsletter_enabled');
    var nlProvider = document.getElementById('newsletter_provider');
    updates['newsletter_settings_json'] = JSON.stringify({
      enabled: nlEnabled ? !!nlEnabled.checked : false,
      provider: nlProvider ? nlProvider.value : ''
    });
    var body = { site_id: hidden.value, updates: updates };
    fetch('/api/admin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin'
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
    }).then(function (res) {
      if (res.ok) {
        setStatus('Saved (settings version ' + res.body.settings_version + ')');
      } else {
        setError((res.body && res.body.error) || ('Error: ' + res.status));
      }
    }).catch(function () { setError('Network error'); });
  });

  // ---- T15: Site Logo file upload (logoFileInput -> POST /admin/media) ----
  var logoFile = document.getElementById('logoFileInput');
  var logoUrlHidden = document.getElementById('setting-site_logo_url');
  var logoUploadStatus = document.getElementById('logo-upload-status');
  var logoUploadPreview = document.getElementById('logo-upload-preview');
  function setLogoUploadStatus(msg) {
    if (!logoUploadStatus) { return; }
    while (logoUploadStatus.firstChild) { logoUploadStatus.removeChild(logoUploadStatus.firstChild); }
    if (msg) { logoUploadStatus.appendChild(document.createTextNode(msg)); }
  }
  if (logoFile) {
    logoFile.addEventListener('change', function () {
      var file = logoFile.files && logoFile.files[0];
      if (!file) { return; }
      setError('');
      setLogoUploadStatus('Uploading\\u2026');
      var fd = new FormData();
      fd.append('file', file);
      fetch('/admin/media', { method: 'POST', body: fd, credentials: 'same-origin' })
        .then(function (r) {
          return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
        })
        .then(function (res) {
          if (res.ok && res.body) {
            var url = res.body.storage_key ? '/media/' + res.body.storage_key : (res.body.image_url || res.body.url || '');
            if (logoUrlHidden) { logoUrlHidden.value = String(url); }
            if (logoUploadPreview) {
              while (logoUploadPreview.firstChild) { logoUploadPreview.removeChild(logoUploadPreview.firstChild); }
              if (url) {
                var img = document.createElement('img');
                img.src = String(url);
                img.alt = 'Logo preview';
                logoUploadPreview.appendChild(img);
              }
            }
            setLogoUploadStatus('Logo uploaded');
          } else {
            setLogoUploadStatus((res.body && res.body.error) || ('Upload failed (HTTP ' + res.status + ')'));
          }
        })
        .catch(function () { setLogoUploadStatus('Network error during upload'); });
    });
  }

  // ---- AI logo generation (POST /api/admin/ai/logo) ----
  var logoBtn = document.getElementById('ai-logo-generate');
  var logoStatus = document.getElementById('ai-logo-status');
  var logoPreview = document.getElementById('ai-logo-preview');
  var logoInput = document.getElementById('setting-logo_media_id');
  function setLogoStatus(msg) {
    if (!logoStatus) { return; }
    while (logoStatus.firstChild) { logoStatus.removeChild(logoStatus.firstChild); }
    if (msg) { logoStatus.appendChild(document.createTextNode(msg)); }
  }
  if (logoBtn) {
    logoBtn.addEventListener('click', function () {
      setError('');
      if (!hidden.value) {
        setLogoStatus('Site is required');
        setError('Site is required');
        filter.focus();
        return;
      }
      logoBtn.disabled = true;
      setLogoStatus('Generating logo...');
      fetch('/api/admin/ai/logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: hidden.value }),
        credentials: 'same-origin'
      }).then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
      }).then(function (res) {
        logoBtn.disabled = false;
        if (res.ok && res.body && res.body.ok) {
          if (logoInput) { logoInput.value = String(res.body.media_id); }
          if (logoPreview) {
            while (logoPreview.firstChild) { logoPreview.removeChild(logoPreview.firstChild); }
            var aimg = document.createElement('img');
            aimg.src = String(res.body.image_url);
            aimg.alt = 'Generated logo preview';
            logoPreview.appendChild(aimg);
          }
          setLogoStatus('Logo generated and applied (media #' + String(res.body.media_id) + ').');
        } else {
          setLogoStatus((res.body && res.body.error) || ('Error: ' + res.status));
        }
      }).catch(function () {
        logoBtn.disabled = false;
        setLogoStatus('Network error');
      });
    });
  }
}());
`;

export function settingsPage(
  sites: ReadonlyArray<SiteOption>,
  values: SettingsValueMap = {},
  selectedSiteId: string | null | undefined = null,
  branding: SettingsBranding = {},
): string {
  const content = `${renderSiteSelector(sites, selectedSiteId)}${renderEditor(values, selectedSiteId)}`;
  return adminLayout({
    title: "Settings",
    activePath: "/admin/settings",
    userEmail: branding.userEmail,
    content,
    styles: SETTINGS_STYLES,
    scripts: SETTINGS_SCRIPT,
  });
}
