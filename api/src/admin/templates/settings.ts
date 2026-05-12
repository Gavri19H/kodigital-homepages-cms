// Admin Settings template.
// settingsPage — required Site selector + per-site key/value editor for
// the 12 canonical site_settings keys (site_name, logo_media_id, tagline,
// site_description, brand_tokens_json, robots_txt_content, ads_txt_content,
// custom_head_html, custom_footer_html, newsletter_settings_json,
// contact_email, privacy_email). PATCH /api/admin/settings sends
// {site_id, values{}} and bumps sites.settings_version atomically.
// Brand text comes from adminLayout (KoDigital CMS); no legacy brand
// strings are emitted from this template.

import { adminLayout } from "./layout";

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

function escapeHtml(input: string | number | undefined | null): string {
  if (input === undefined || input === null) { return ""; }
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function renderSettingRow(key: string, value: string): string {
  const safeKey = escapeHtml(key);
  const safeVal = escapeHtml(value);
  return `<div class="form-group" data-setting-key="${safeKey}">
    <label for="setting-${safeKey}" class="form-label">${safeKey}</label>
    <input id="setting-${safeKey}" name="${safeKey}" type="text" class="form-input" data-field="setting_value" data-key="${safeKey}" value="${safeVal}" />
  </div>`;
}

function renderEditor(values: SettingsValueMap, selectedSiteId: string | null | undefined): string {
  const rows = SETTING_KEYS.map(function (k): string {
    const raw = values[k];
    const v = raw === undefined || raw === null ? "" : String(raw);
    return renderSettingRow(k, v);
  }).join("");
  return `<form id="settings-editor-form" class="settings-form" data-action="submit-settings" data-method="PATCH">
    <input type="hidden" id="settings-site-id" name="site_id" data-field="site_id" value="${escapeHtml(selectedSiteId ?? "")}" />
    <div class="card">
      <div class="card-header"><h3 class="card-title">Per-site settings</h3></div>
      ${rows}
    </div>
    <p id="settings-form-error" class="alert alert-error" hidden role="alert"></p>
    <p id="settings-editor-status" class="form-status" role="status" aria-live="polite" data-field="status_message"></p>
    <div class="form-actions">
      <button type="submit" class="btn btn-primary" data-action="save-settings">Save settings</button>
    </div>
  </form>`;
}

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
    var values = {};
    var keys = ['site_name','logo_media_id','tagline','site_description','brand_tokens_json','robots_txt_content','ads_txt_content','custom_head_html','custom_footer_html','newsletter_settings_json','contact_email','privacy_email'];
    for (var i = 0; i < keys.length; i = i + 1) {
      var v = fd.get(keys[i]);
      values[keys[i]] = v === null ? '' : String(v);
    }
    var body = { site_id: hidden.value, values: values };
    fetch('/api/admin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin'
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
    }).then(function (res) {
      if (res.ok) {
        setStatus('Saved');
      } else {
        setError((res.body && res.body.error) || ('Error: ' + res.status));
      }
    }).catch(function () { setError('Network error'); });
  });
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
    scripts: SETTINGS_SCRIPT,
  });
}
