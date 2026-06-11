// Admin Settings template — T32 [B11] Settings port (per-site).
// settingsPage — required Site selector + per-site editor for the 12
// canonical site_settings keys (site_name, logo_media_id, tagline,
// site_description, brand_tokens_json, robots_txt_content,
// ads_txt_content, custom_head_html, custom_footer_html,
// newsletter_settings_json, contact_email, privacy_email), laid out in
// the legacy card groups (Site Information / Site Logo / ads.txt /
// robots.txt / Brand Tokens / Newsletter / Custom HTML).
// Saving sends PATCH /api/admin/settings with {site_id, updates:{key:value}}
// (the T24 wire shape) and the handler bumps sites.settings_version
// atomically. The Site Logo card carries the AI logo panel: POST
// /api/admin/ai/logo with {site_id}; the endpoint generates, stores the
// media row, writes logo_media_id itself, and returns
// {ok, media_id, image_url} which the panel reflects into the form.
// Brand text comes from adminLayout (KoDigital CMS); no legacy brand
// strings are emitted from this template.

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

function settingValue(values: SettingsValueMap, key: string): string {
  const raw = values[key];
  return raw === undefined || raw === null ? "" : String(raw);
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

function renderSiteLogoCard(values: SettingsValueMap): string {
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
    ) + aiPanel,
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

function renderNewsletterCard(values: SettingsValueMap): string {
  return renderCard(
    "Newsletter",
    renderTextareaField(
      "newsletter_settings_json",
      "Newsletter Settings (JSON)",
      settingValue(values, "newsletter_settings_json"),
      4,
      "Newsletter provider configuration as JSON.",
      true,
    ),
  );
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

function renderEditor(values: SettingsValueMap, selectedSiteId: string | null | undefined): string {
  return `<form id="settings-editor-form" class="settings-form" data-action="submit-settings" data-method="PATCH">
    <input type="hidden" id="settings-site-id" name="site_id" data-field="site_id" value="${escapeHtml(selectedSiteId ?? "")}" />
    ${renderSiteInformationCard(values)}
    ${renderSiteLogoCard(values)}
    ${renderAdsTxtCard(values)}
    ${renderRobotsTxtCard(values)}
    ${renderBrandTokensCard(values)}
    ${renderNewsletterCard(values)}
    ${renderCustomHtmlCard(values)}
    <p id="settings-form-error" class="alert alert-error" hidden role="alert"></p>
    <p id="settings-editor-status" class="form-status" role="status" aria-live="polite" data-field="status_message"></p>
    <div class="form-actions">
      <button type="submit" class="btn btn-primary" data-action="save-settings">Save settings</button>
    </div>
  </form>`;
}

const SETTINGS_STYLES = `
.form-textarea--mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.ai-logo-panel { margin-top: 12px; padding: 12px; border: 1px solid var(--border, #d9dde3); border-radius: 8px; }
.ai-logo-preview { margin-top: 8px; }
.ai-logo-preview img { max-height: 60px; max-width: 240px; object-fit: contain; border: 1px solid var(--border, #d9dde3); border-radius: 6px; padding: 4px; }
`;

const SETTINGS_SCRIPT = `
(function(){
  var form = document.getElementById('settings-editor-form');
  var filter = document.getElementById('filter-site');
  var hidden = document.getElementById('settings-site-id');
  var status = document.getElementById('settings-editor-status');
  var errEl = document.getElementById('settings-form-error');
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
    var keys = ['site_name','logo_media_id','tagline','site_description','brand_tokens_json','robots_txt_content','ads_txt_content','custom_head_html','custom_footer_html','newsletter_settings_json','contact_email','privacy_email'];
    for (var i = 0; i < keys.length; i = i + 1) {
      var v = fd.get(keys[i]);
      updates[keys[i]] = v === null ? '' : String(v);
    }
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
            var img = document.createElement('img');
            img.src = String(res.body.image_url);
            img.alt = 'Generated logo preview';
            logoPreview.appendChild(img);
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
