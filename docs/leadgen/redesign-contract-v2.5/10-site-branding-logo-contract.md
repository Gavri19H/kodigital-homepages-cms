# 10 · Site Branding and Logo Inheritance Contract

## 10.1 Source of truth

Per-site branding already exists in `site_settings` (key/value per `site_id`): `site_name`, `logo_media_id`, `site_logo_url`, `tagline`, `contact_email`, `privacy_email`, social links. Listicles already resolve it per host (`listicle/serve.ts brandFromSettings`). LeadGen adopts the SAME resolution — new shared helper `src/leadgen/branding.ts`:

```
resolveSiteBranding(db, site_id) → {
  site_name,                       // site_settings.site_name, fallback hostname
  logo_url,                        // mediaUrl(logo_media_id) → site_logo_url (isSafeUrl) → null
  tagline,                         // site_settings.tagline ?? null
  legal_links: [{label, href}],    // privacy/terms/contact derived from site settings when present
}
```

## 10.2 Runtime binding (D4)

- `resolveActivatedFunnel` (resolver.ts) additionally loads site branding for the resolved `site_id`; `renderQuoteFrame` receives it and renders the header logo per `frame_config_json.header.logo_source`:
  - `"site"` (default): `logo_url` image, else `site_name` text-logo (existing `renderHeaderLogo` text leg), else the CMS fallback mark.
  - `"cms_fallback"`: the configured CMS placeholder logo (env/media constant).
  - `"manual"`: `header.logo_media_id` (Advanced-gated; preflight notes it).
- **Cache correctness:** the baked logo is safe because the shell cache key is already site-scoped (`lg-shell:{site_id}:…`) — the exact argument the baked GA4 id uses (serve.ts). A branding EDIT must refresh: `PUT`s to the site settings logo keys are followed by the existing activation `updated_at` bump path when a LeadGen activation exists for that site (implementation: settings save handler touches `leadgen_site_quotes.updated_at` for that site — one UPDATE; this rides the existing `activation_version` cache axis, no new axis).
- Footer `links_source:"site"` renders the site’s privacy/terms/contact; missing → the group is omitted (never empty anchors).

## 10.3 Sharing one Quote across sites

Same funnel/frame/theme; branding swaps per activated site at serve time (key-scoped shells make this free). Site-specific overrides beyond branding stay in `leadgen_site_quotes.settings_overrides_json` (unchanged). A `site_branding_policy` is intentionally minimal in v2.5: `header.logo_source` + footer `links_source` are the policy switches; per-site theme overrides are OUT (revisit only if operators demand).

## 10.4 Fallback ladder + preflight

logo: site media → site url → site_name text mark → CMS placeholder. Preflight (`14`): activation on a site with NO resolvable logo AND `logo_source:"site"` → warning “Site ‘x’ has no logo — the funnel will show the site name as text” + fix link to that site’s Settings.

## 10.5 Admin surfaces

- `GET /api/admin/leadgen/sites/:site_id/branding` → the `resolveSiteBranding` projection + `has_logo:bool` (used by preview selectors and preflight copy). Reuses admin auth; read-only.
- **Preview site selector** (Quote Builder toolbar + Section in-frame preview, C4): options = **ALL CMS sites** (activated ones listed first), each with a status badge — **Active** (enabled activation) · **Activation off** (row exists, disabled) · **Not activated yet** (no row) — plus a “CMS fallback branding” entry. Previewing under ANY site’s branding is allowed BEFORE activation (branding is read-only `site_settings` data); the selector changes preview only — the runtime stays inactive until an activation exists, and nothing here creates one. Selecting a site threads `site_id` into the preview endpoints (`13 §13.3–13.4`); the canvas re-renders with that site’s logo/name/links.
- Manual logo override in the header inspector is behind Advanced with the tracked warning (`04 §4.4`).
