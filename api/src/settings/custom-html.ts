// T23: Custom head/footer HTML + analytics/ad-header scripts — render +
// sanitize. This module is the single source of truth for the operator
// "custom HTML / script" settings, shared by BOTH:
//   * the admin PATCH boundary (admin/api.ts) — validateScriptField +
//     ALLOWED_SETTINGS_KEYS reject malicious input before it is stored, and
//   * the public render layer (public/templates/layout.ts via
//     public/render-pages.ts) — renderCustomHead/renderCustomFooter emit the
//     sanitized snippets into the LIVE <head>/footer.
//
// Defect this closes (BCL-045): custom_head_html/custom_footer_html were
// stored but never rendered (the layout had a stale "T15 to inject" comment),
// analytics_script/ad_header_script had no home at all, and the settings PATCH
// wrote raw values with NO sanitisation + NO key allowlist — a latent
// stored-XSS. Two field families now exist, with different rules:
//   * HTML fields  (custom_head_html, custom_footer_html): pure markup
//     (meta/link/style). <script> is NOT permitted here — reject at the
//     boundary, strip at render.
//   * SCRIPT fields (analytics_script, ad_header_script): operator-trusted
//     loader snippets that legitimately ARE <script>. <script> is permitted,
//     but inline event handlers (onerror=, onload=, …) and javascript: URIs
//     are forbidden in every field — those are the XSS vectors.
//
// Sanitisation uses String.replace() / RegExp.test() only (NO RegExp.exec) so
// the work is a pure, stateless transform that the unit proof can exercise
// directly without a DOM.

// The complete allow-list of site_settings keys the admin PATCH endpoint will
// accept. Any other key is rejected with 400 (AC2). Mirrors the canonical
// SETTING_KEYS in admin/templates/settings.ts plus the T15 parity keys, the
// T22 ad-config keys, and the two T23 script keys.
export const ALLOWED_SETTINGS_KEYS: ReadonlySet<string> = new Set<string>([
  // 12 canonical keys (admin/templates/settings.ts SETTING_KEYS)
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
  // T15 parity keys persisted through the same PATCH route
  "items_per_page",
  "site_logo_url",
  // rescue-6 (agent-readiness): official profile URLs -> Organization sameAs.
  "org_same_as",
  // T28: social-media profile URLs (rendered as footer links). Keys MUST match
  // SOCIAL_PLATFORMS in public/templates/components.ts and the admin form.
  "social_twitter_url",
  "social_facebook_url",
  "social_instagram_url",
  "social_linkedin_url",
  "social_youtube_url",
  // T23: custom analytics / ad-header script snippets (this story)
  "analytics_script",
  "ad_header_script",
  // T22 ad-config keys (operator-settable through the same PATCH route)
  // rescue-4 round-5 (issue 1): master on/off toggle the admin client ALWAYS
  // submits (the settings.ts ad-checkbox loop sets it on every save). Missing
  // here it 400'd EVERY settings save on EVERY tab ("unknown setting key:
  // 'ads_enabled'") -> the user-facing "Network error".
  "ads_enabled",
  "ad_provider",
  "adsense_publisher_id",
  "ad_unit_leaderboard",
  "ad_unit_in_feed",
  "ad_unit_rect",
  "ad_in_content_position",
  "ad_lazy_load",
  "ad_lazy_load_margin",
  "ad_disable_logged_in",
  "ad_excluded_pages",
  // rescue-4 round-5 (issue 2/3): Google Ad Manager (GPT) provider keys —
  // direct GAM/AdX serving, the sticky anchor unit, and the refresh-rate.
  "gam_network_code",
  "gam_unit_leaderboard",
  "gam_unit_in_feed",
  "gam_unit_rect",
  "gam_unit_in_content",
  "gam_unit_anchor",
  "ad_sticky_enabled",
  "ad_refresh_seconds",
]);

// Pure-HTML fields: rendered as markup, NO <script> allowed.
export const HTML_SETTINGS_KEYS: ReadonlySet<string> = new Set<string>([
  "custom_head_html",
  "custom_footer_html",
]);

// Script fields: operator analytics/ad loaders. <script> allowed; event
// handlers + javascript: URIs are not.
export const SCRIPT_SETTINGS_KEYS: ReadonlySet<string> = new Set<string>([
  "analytics_script",
  "ad_header_script",
]);

// Inline event-handler attribute (onerror=, onload=, onclick=, …). The
// leading [\s/] guard requires a real attribute boundary so substrings such
// as `reason=` / `person=` / `data-icon=` are NOT matched.
const EVENT_HANDLER_ATTR = /(^|[\s/])on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const EVENT_HANDLER_PROBE = /(^|[\s/])on[a-z]+\s*=/i;
// A `javascript:` scheme anywhere (href="javascript:…", url(javascript:…)).
const JS_URI = /javascript\s*:/gi;
const JS_URI_PROBE = /javascript\s*:/i;
// <script>…</script> blocks (and any stray opening/closing script tag).
const SCRIPT_BLOCK = /<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi;
const SCRIPT_TAG = /<\s*\/?\s*script\b[^>]*>/gi;
const SCRIPT_PROBE = /<\s*script\b/i;

export interface SanitizeOptions {
  // When true the value MAY contain <script> (analytics_script /
  // ad_header_script). When false (default) every <script> is stripped
  // (custom_head_html / custom_footer_html).
  allowScript?: boolean;
}

// sanitizeSettingsHtml — render-time defence. Strips inline event handlers and
// javascript: URIs from any snippet, and (unless allowScript) strips every
// <script> block. Returns "" for non-strings / empty input.
export function sanitizeSettingsHtml(
  input: string,
  options?: SanitizeOptions,
): string {
  if (typeof input !== "string" || input.length === 0) return "";
  const allowScript = options?.allowScript === true;
  let out = input;
  // 1. drop inline event-handler attributes, preserving the boundary char.
  out = out.replace(EVENT_HANDLER_ATTR, "$1");
  // 2. neutralise javascript: URIs.
  out = out.replace(JS_URI, "");
  // 3. strip <script> entirely for pure-HTML fields.
  if (!allowScript) {
    out = out.replace(SCRIPT_BLOCK, "");
    out = out.replace(SCRIPT_TAG, "");
  }
  return out.trim();
}

export interface ScriptFieldVerdict {
  ok: boolean;
  reason?: string;
}

// validateScriptField — PATCH-boundary gate. Rejects the XSS vectors before a
// value is ever stored: inline event handlers + javascript: URIs in ANY
// field, and <script> in a pure-HTML field. Legitimate analytics/ad loaders
// (a clean <script src="…">) and ordinary text settings pass.
export function validateScriptField(
  key: string,
  value: string,
): ScriptFieldVerdict {
  if (typeof value !== "string") {
    return { ok: false, reason: `value for '${key}' must be a string` };
  }
  if (EVENT_HANDLER_PROBE.test(value)) {
    return {
      ok: false,
      reason: `inline event handler attribute is not allowed in '${key}'`,
    };
  }
  if (JS_URI_PROBE.test(value)) {
    return { ok: false, reason: `javascript: URI is not allowed in '${key}'` };
  }
  if (HTML_SETTINGS_KEYS.has(key) && SCRIPT_PROBE.test(value)) {
    return {
      ok: false,
      reason: `<script> is not allowed in '${key}'; use analytics_script / ad_header_script`,
    };
  }
  return { ok: true };
}

function settingValue(
  settings: Readonly<Record<string, string>>,
  key: string,
): string {
  const raw = settings[key];
  return typeof raw === "string" ? raw : "";
}

// renderCustomHead — sanitized <head> additions, in the order the operator
// expects them: the custom HTML block, then the analytics snippet, then the
// ad-header snippet. Each block is sanitized via sanitizeSettingsHtml; empty
// snippets contribute nothing so the head stays byte-identical when unset.
export function renderCustomHead(
  settings: Readonly<Record<string, string>>,
): string {
  const parts: string[] = [];
  const head = sanitizeSettingsHtml(settingValue(settings, "custom_head_html"), {
    allowScript: false,
  });
  if (head.length > 0) parts.push(`<!-- custom_head_html -->\n${head}`);
  const analytics = sanitizeSettingsHtml(
    settingValue(settings, "analytics_script"),
    { allowScript: true },
  );
  if (analytics.length > 0) parts.push(`<!-- analytics_script -->\n${analytics}`);
  const adHeader = sanitizeSettingsHtml(
    settingValue(settings, "ad_header_script"),
    { allowScript: true },
  );
  if (adHeader.length > 0) parts.push(`<!-- ad_header_script -->\n${adHeader}`);
  return parts.join("\n");
}

// renderCustomFooter — sanitized footer markup from custom_footer_html (pure
// HTML, no <script>). Emitted just before </body> by renderLayout.
export function renderCustomFooter(
  settings: Readonly<Record<string, string>>,
): string {
  const footer = sanitizeSettingsHtml(
    settingValue(settings, "custom_footer_html"),
    { allowScript: false },
  );
  return footer.length > 0 ? `<!-- custom_footer_html -->\n${footer}` : "";
}
