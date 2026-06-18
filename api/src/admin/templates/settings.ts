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

// T26: per-provider connection fields. Choosing a provider reveals exactly its
// own field group (data-newsletter-provider); the submit script composes the
// visible provider's values into newsletter_settings_json.config so the public
// form posts to that provider's real hosted-form action. Keys MUST match the
// reader in buildNewsletterForm (public/templates/components.ts).
interface NewsletterProviderField {
  key: string;
  label: string;
  placeholder: string;
}
const NEWSLETTER_PROVIDER_FIELDS: ReadonlyArray<[string, ReadonlyArray<NewsletterProviderField>]> = [
  ["mailchimp", [
    { key: "server", label: "Data center", placeholder: "us1" },
    { key: "account", label: "Account ID (u)", placeholder: "9e1f…" },
    { key: "list_id", label: "Audience / List ID", placeholder: "a1b2c3d4e5" },
  ]],
  ["convertkit", [
    { key: "form_id", label: "Form ID", placeholder: "1234567" },
  ]],
  ["buttondown", [
    { key: "username", label: "Username", placeholder: "your-newsletter" },
  ]],
  ["substack", [
    { key: "handle", label: "Publication handle", placeholder: "yourpub" },
  ]],
  ["custom", [
    { key: "action", label: "Form action URL (https)", placeholder: "https://…" },
    { key: "email_field", label: "Email field name", placeholder: "email" },
  ]],
];

// T24: curated style keywords for the operator-directed AI logo panel. The
// first option is empty so "no style preference" stays the default (the request
// then omits `style` and the prompt is undirected).
const LOGO_STYLE_OPTIONS: ReadonlyArray<[string, string]> = [
  ["", "Default"],
  ["minimalist", "Minimalist"],
  ["modern", "Modern"],
  ["geometric", "Geometric"],
  ["vintage", "Vintage"],
  ["playful", "Playful"],
  ["elegant", "Elegant"],
];

interface NewsletterConfig {
  enabled: boolean;
  provider: string;
  config: { [key: string]: string };
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
    return { enabled: false, provider: "", config: {} };
  }
  try {
    const parsed = JSON.parse(raw) as { enabled?: unknown; provider?: unknown; config?: unknown };
    const config: { [key: string]: string } = {};
    if (parsed.config !== null && typeof parsed.config === "object" && !Array.isArray(parsed.config)) {
      for (const [k, v] of Object.entries(parsed.config as Record<string, unknown>)) {
        if (typeof v === "string") config[k] = v;
      }
    }
    return {
      enabled: parsed.enabled === true || parsed.enabled === "true",
      provider: typeof parsed.provider === "string" ? parsed.provider : "",
      config,
    };
  } catch {
    return { enabled: false, provider: "", config: {} };
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
  // T24: operator-directed AI logo panel. The operator describes the logo and
  // picks a style + color scheme; "Generate with AI" POSTs a LogoRequest
  // ({prompt, style, colorScheme}) to /api/admin/ai/logo, which regenerates and
  // applies a directed mark. (Was: a single button POSTing only {site_id}.)
  const styleOpts = LOGO_STYLE_OPTIONS.map(function (pair: [string, string]): string {
    return `<option value="${escapeHtml(pair[0])}">${escapeHtml(pair[1])}</option>`;
  }).join("");
  const aiPanel = `<div class="ai-logo-panel" data-panel="ai-logo">
    <p class="form-hint">Describe the logo and pick a style and colors; AI generates a mark, saves it to the media library, and applies it to the selected site.</p>
    <div class="form-group" data-setting-key="ai_logo_prompt">
      <label class="form-label" for="ai-logo-prompt">Describe the logo</label>
      <textarea id="ai-logo-prompt" class="form-textarea" rows="3" placeholder="e.g. a minimalist mountain peak inside a circle"></textarea>
    </div>
    <div class="form-group" data-setting-key="ai_logo_style">
      <label class="form-label" for="ai-logo-style">Style</label>
      <select id="ai-logo-style" class="form-select">${styleOpts}</select>
    </div>
    <div class="form-group" data-setting-key="ai_logo_colors">
      <label class="form-label" for="ai-logo-colors">Color scheme</label>
      <input id="ai-logo-colors" type="text" class="form-input" placeholder="e.g. deep blue and gold" />
    </div>
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

// T25: friendly brand pickers instead of a raw brand_tokens_json textarea.
// The operator picks brand-family colors + fonts; the submit script composes
// them into brand_tokens_json (consumed by public/assets/public-css.ts via
// renderLayout's renderBrandTokensStyle). Per BCL-047 the per-site tokens
// OVERRIDE ONLY the brand family — primary/accent/background/text + heading/
// body fonts; every OTHER --tw-* token (sizes, radius, shadow, ink, rules,
// derived brand shades) stays the design-contract.md contract (E6). The
// contract defaults below MUST mirror public-css.ts; a value equal to the
// default composes to NO key, so that token stays the contract.
interface BrandColorField {
  key: string;
  id: string;
  label: string;
  def: string;
}

const BRAND_COLOR_FIELDS: ReadonlyArray<BrandColorField> = [
  { key: "tw-brand", id: "brand-color-primary", label: "Primary color", def: "#1ba8c8" },
  { key: "tw-accent", id: "brand-color-accent", label: "Accent color", def: "#f0a830" },
  { key: "tw-bg", id: "brand-color-background", label: "Background color", def: "#ffffff" },
  { key: "tw-text", id: "brand-color-text", label: "Text color", def: "#2a2f38" },
];

interface BrandFontField {
  key: string;
  id: string;
  label: string;
}

const BRAND_FONT_FIELDS: ReadonlyArray<BrandFontField> = [
  { key: "tw-font-display", id: "brand-font-heading", label: "Heading font" },
  { key: "tw-font-sans", id: "brand-font-body", label: "Body font" },
];

// Curated font stacks. The first option ("Theme default") composes to NO
// brand_tokens_json key, so the public --tw-font-* token stays the contract.
const BRAND_FONT_OPTIONS: ReadonlyArray<[string, string]> = [
  ["", "Theme default"],
  [`"Nunito", "Nunito Sans", system-ui`, "Nunito"],
  [`"Nunito Sans", "Inter", system-ui`, "Nunito Sans"],
  [`"Inter", system-ui, sans-serif`, "Inter"],
  [`Georgia, "Times New Roman", serif`, "Georgia"],
  [`"Playfair Display", Georgia, serif`, "Playfair Display"],
  [`system-ui, -apple-system, "Segoe UI", sans-serif`, "System UI"],
];

// Parse the stored brand_tokens_json (string) into a flat string map. Corrupt
// / non-object JSON falls back to {} (the hidden raw field still round-trips
// the original text). Non-string values are dropped — they cannot be a CSS
// token value anyway.
function parseBrandTokens(raw: string): Record<string, string> {
  if (raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

// A brand token may be stored with or without the leading `--` (both forms
// map onto the same CSS custom property in renderBrandTokensStyle).
function brandTokenValue(parsed: Record<string, string>, key: string): string | undefined {
  return parsed[key] ?? parsed["--" + key];
}

// The color picker (<input type="color">) requires a 6-digit hex; fall back to
// the contract default when the stored value is absent or not a simple hex.
function effectiveBrandColor(parsed: Record<string, string>, field: BrandColorField): string {
  const raw = brandTokenValue(parsed, field.key);
  if (typeof raw === "string" && /^#[0-9a-fA-F]{6}$/.test(raw)) {
    return raw.toLowerCase();
  }
  return field.def;
}

function renderBrandColorPicker(field: BrandColorField, parsed: Record<string, string>): string {
  const value = effectiveBrandColor(parsed, field);
  const id = escapeHtml(field.id);
  const safeKey = escapeHtml(field.key);
  return `<div class="form-group brand-token-field" data-setting-key="${safeKey}">
    <label for="${id}" class="form-label">${escapeHtml(field.label)}</label>
    <input id="${id}" type="color" class="form-color" data-brand-key="${safeKey}" value="${escapeHtml(value)}" />
  </div>`;
}

function renderBrandFontSelect(field: BrandFontField, parsed: Record<string, string>): string {
  const value = brandTokenValue(parsed, field.key) ?? "";
  const id = escapeHtml(field.id);
  const safeKey = escapeHtml(field.key);
  const known = BRAND_FONT_OPTIONS.some(function (o: [string, string]): boolean {
    return o[0] === value;
  });
  const opts = BRAND_FONT_OPTIONS.map(function (pair: [string, string]): string {
    const sel = pair[0] === value ? " selected" : "";
    return `<option value="${escapeHtml(pair[0])}"${sel}>${escapeHtml(pair[1])}</option>`;
  }).join("");
  // Preserve a custom (non-curated) stored font so it round-trips and stays
  // selected instead of being silently clobbered to the theme default.
  const extra = value.length > 0 && !known
    ? `<option value="${escapeHtml(value)}" selected>${escapeHtml(value)} (custom)</option>`
    : "";
  return `<div class="form-group brand-token-field" data-setting-key="${safeKey}">
    <label for="${id}" class="form-label">${escapeHtml(field.label)}</label>
    <select id="${id}" class="form-select" data-brand-key="${safeKey}">${opts}${extra}</select>
  </div>`;
}

function renderBrandTokensCard(values: SettingsValueMap): string {
  const raw = settingValue(values, "brand_tokens_json");
  const parsed = parseBrandTokens(raw);
  const colors = BRAND_COLOR_FIELDS.map(function (f: BrandColorField): string {
    return renderBrandColorPicker(f, parsed);
  }).join("");
  const fonts = BRAND_FONT_FIELDS.map(function (f: BrandFontField): string {
    return renderBrandFontSelect(f, parsed);
  }).join("");
  const hint = `<p class="form-hint">Pick brand colors and fonts. These override only the brand family on the public site; every other design token stays the theme contract.</p>`;
  // Hidden raw field preserves UNKNOWN brand_tokens_json keys for round-trip;
  // the submit script composes the pickers over it (no raw JSON editing).
  const hidden = `<input type="hidden" id="setting-brand_tokens_json" name="brand_tokens_json" data-field="setting_value" data-key="brand_tokens_json" value="${escapeHtml(raw)}" />`;
  return renderCard(
    "Brand Tokens",
    hint + `<div class="brand-token-grid">${colors}${fonts}</div>` + hidden,
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
  // T26: one hidden field group per provider. The reveal script shows only the
  // selected provider's group; only its values prefill from the stored config.
  const providerFields = NEWSLETTER_PROVIDER_FIELDS.map(function (
    entry: [string, ReadonlyArray<NewsletterProviderField>],
  ): string {
    const provider = entry[0];
    const active = cfg.provider === provider;
    const inputs = entry[1]
      .map(function (f: NewsletterProviderField): string {
        const fieldId = `newsletter_cfg_${provider}_${f.key}`;
        const value = active && typeof cfg.config[f.key] === "string" ? cfg.config[f.key] : "";
        return `<div class="form-group">
        <label for="${escapeHtml(fieldId)}" class="form-label">${escapeHtml(f.label)}</label>
        <input id="${escapeHtml(fieldId)}" type="text" class="form-input" data-newsletter-cfg-key="${escapeHtml(f.key)}" placeholder="${escapeHtml(f.placeholder)}" value="${escapeHtml(value)}" />
      </div>`;
      })
      .join("");
    const hiddenAttr = active ? "" : " hidden";
    return `<div class="newsletter-provider-fields" data-newsletter-provider="${escapeHtml(provider)}"${hiddenAttr}>${inputs}</div>`;
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
    ${providerFields}
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
.brand-token-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.brand-token-field .form-color { width: 56px; height: 36px; padding: 2px; border: 1px solid var(--c-border, #d9dde3); border-radius: 6px; cursor: pointer; background: #fff; }
@media (max-width: 600px) { .brand-token-grid { grid-template-columns: 1fr; } }
`;

// Exported so the inline client behavior (logo upload alignment + the directed
// AI-logo LogoRequest POST, T24) can be exercised in a vm with a DOM stub.
export const SETTINGS_SCRIPT = `
(function(){
  var form = document.getElementById('settings-editor-form');
  var filter = document.getElementById('filter-site');
  var hidden = document.getElementById('settings-site-id');
  var status = document.getElementById('settings-editor-status');
  var errEl = document.getElementById('settings-form-error');

  // T25: brand-family fields. id -> brand_tokens_json key + the design-contract
  // default. A color equal to its default (or an empty font select) composes to
  // NO key, so that token keeps the public-css.ts contract value. The keys
  // mirror BRAND_COLOR_FIELDS / BRAND_FONT_FIELDS in this module.
  var BRAND_FIELDS = [
    { id: 'brand-color-primary', key: 'tw-brand', def: '#1ba8c8' },
    { id: 'brand-color-accent', key: 'tw-accent', def: '#f0a830' },
    { id: 'brand-color-background', key: 'tw-bg', def: '#ffffff' },
    { id: 'brand-color-text', key: 'tw-text', def: '#2a2f38' },
    { id: 'brand-font-heading', key: 'tw-font-display', def: '' },
    { id: 'brand-font-body', key: 'tw-font-sans', def: '' }
  ];

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

  // ---- T26: reveal only the selected newsletter provider's fields ----
  var nlProviderSel = document.getElementById('newsletter_provider');
  var nlFieldGroups = document.querySelectorAll('.newsletter-provider-fields');
  function revealNewsletterProvider() {
    var sel = nlProviderSel ? nlProviderSel.value : '';
    var i;
    for (i = 0; i < nlFieldGroups.length; i = i + 1) {
      nlFieldGroups[i].hidden = nlFieldGroups[i].getAttribute('data-newsletter-provider') !== sel;
    }
  }
  if (nlProviderSel) {
    nlProviderSel.addEventListener('change', revealNewsletterProvider);
    revealNewsletterProvider();
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
    // T26: also collect the SELECTED provider's connection fields into config
    // so the public form posts to that provider's real hosted-form action.
    var nlEnabled = document.getElementById('newsletter_enabled');
    var nlProvider = document.getElementById('newsletter_provider');
    var nlConfig = {};
    var nlSelected = nlProvider ? nlProvider.value : '';
    var nlGroups = document.querySelectorAll('.newsletter-provider-fields');
    for (var ng = 0; ng < nlGroups.length; ng = ng + 1) {
      if (nlGroups[ng].getAttribute('data-newsletter-provider') !== nlSelected) { continue; }
      var nlInputs = nlGroups[ng].querySelectorAll('[data-newsletter-cfg-key]');
      for (var nf = 0; nf < nlInputs.length; nf = nf + 1) {
        var cfgKey = nlInputs[nf].getAttribute('data-newsletter-cfg-key');
        var cfgVal = String(nlInputs[nf].value || '');
        if (cfgKey && cfgVal) { nlConfig[cfgKey] = cfgVal; }
      }
    }
    updates['newsletter_settings_json'] = JSON.stringify({
      enabled: nlEnabled ? !!nlEnabled.checked : false,
      provider: nlProvider ? nlProvider.value : '',
      config: nlConfig
    });
    // T25: compose brand_tokens_json from the brand pickers (no raw JSON
    // editing). Start from the stored raw value so UNKNOWN keys round-trip;
    // write a brand-family key ONLY when the operator picked a non-default
    // value, so every other design token stays the theme contract.
    var brandHidden = document.getElementById('setting-brand_tokens_json');
    var brandObj = {};
    if (brandHidden && brandHidden.value) {
      try {
        var brandParsed = JSON.parse(brandHidden.value);
        if (brandParsed && typeof brandParsed === 'object') { brandObj = brandParsed; }
      } catch (be) { brandObj = {}; }
    }
    for (var bi = 0; bi < BRAND_FIELDS.length; bi = bi + 1) {
      var bf = BRAND_FIELDS[bi];
      var bel = document.getElementById(bf.id);
      // Drop any prior form of this brand key so we never leave a duplicate.
      if (brandObj.hasOwnProperty(bf.key)) { delete brandObj[bf.key]; }
      if (brandObj.hasOwnProperty('--' + bf.key)) { delete brandObj['--' + bf.key]; }
      var bv = bel ? String(bel.value || '') : '';
      if (bv && bv !== bf.def) { brandObj[bf.key] = bv; }
    }
    updates['brand_tokens_json'] = JSON.stringify(brandObj);
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
            // T24 render-fix: the public site reads logo_media_id, so write the
            // uploaded media reference there too (was only site_logo_url, which
            // the public side never read -> uploaded logo never showed). Store
            // the bare storage_key; the public mediaUrl() turns it into
            // /media/<key>.
            var logoIdInput = document.getElementById('setting-logo_media_id');
            if (logoIdInput) {
              logoIdInput.value = res.body.storage_key ? String(res.body.storage_key) : String(url);
            }
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
  var logoPromptEl = document.getElementById('ai-logo-prompt');
  var logoStyleEl = document.getElementById('ai-logo-style');
  var logoColorsEl = document.getElementById('ai-logo-colors');
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
      // T24: build the LogoRequest. site_id stays; the operator's description
      // (wire field 'prompt'), style, and colorScheme ride the body only when
      // set, so an undirected click is backward-compatible ({ site_id }).
      var logoBody = { site_id: hidden.value };
      var desc = logoPromptEl ? String(logoPromptEl.value || '').replace(/^\\s+|\\s+$/g, '') : '';
      var sty = logoStyleEl ? String(logoStyleEl.value || '').replace(/^\\s+|\\s+$/g, '') : '';
      var col = logoColorsEl ? String(logoColorsEl.value || '').replace(/^\\s+|\\s+$/g, '') : '';
      if (desc) { logoBody.prompt = desc; }
      if (sty) { logoBody.style = sty; }
      if (col) { logoBody.colorScheme = col; }
      fetch('/api/admin/ai/logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logoBody),
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
