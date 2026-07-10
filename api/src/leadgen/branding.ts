// LeadGen redesign v2.5 §10.1 — per-site branding resolution (site-logo
// inheritance). One shared helper so the funnel frame renders the SAME
// per-host branding the listicles already resolve from `site_settings`
// (canonical source: public/listicle/serve.ts `brandFromSettings`, mirrored
// here 1:1 for the logo ladder — that function is module-private and coupled
// to the listicle's request-time hostname, so the shared logic lives here and
// resolves the host identity from the sites row instead).
//
// §10.4 fallback ladder (logo): site media (`logo_media_id`, a media STORAGE
// KEY — the same value the logo panel writes and the homepage layout reads —
// resolved through the canonical mediaUrl() prefixer) → `site_logo_url`
// (only when isSafeUrl passes; a javascript: URI is skipped, never emitted)
// → null (the consumer renders the `site_name` text mark, then the CMS
// placeholder — frame-renderer legs, later slices).
//
// Branding is presentation chrome riding revenue-serving paths (funnel shell
// cache-miss, /lg/attempt, /lg/auction). It therefore NEVER throws: any
// storage failure degrades down the ladder to a safe projection instead of
// 500ing a funnel serve. Both reads are .bind()-parameterized single-binding
// statements (D1 100-binding rule trivially satisfied).

import { mediaUrl } from "../public/view-models/media-url";
import { isSafeUrl } from "../editor/sanitize";

export interface SiteBrandingLegalLink {
  label: string;
  href: string;
}

// §11.3 trust-logo set — one entry per resolvable id in the OPTIONAL
// `site_settings.trust_logo_media_ids` JSON list (additive settings key).
// `url` is pre-resolved through the same mediaUrl() prefixer as the logo
// ladder, so consumers never re-derive media routing.
export interface SiteBrandingTrustLogo {
  media_id: string;
  url: string;
}

// The §10.1 projection.
export interface SiteBranding {
  // site_settings.site_name (trimmed, non-empty) → the site's hostname
  // identity. The sites row carries no hostname column; its host identity is
  // `domain` (the canonical hostname, mirrored into domains.hostname at
  // provisioning) — the same fallback the listicle applies with its
  // request-time hostname.
  site_name: string;
  // §10.4 ladder: mediaUrl(logo_media_id) → safe site_logo_url → null.
  logo_url: string | null;
  // site_settings.tagline (trimmed, non-empty) ?? null.
  tagline: string | null;
  // privacy/terms/contact derived from site settings when present; a missing
  // signal OMITS the link (never an empty href). See deriveLegalLinks.
  legal_links: SiteBrandingLegalLink[];
  // §11.3 `trust_strip.source:"site_logo_set"` plumb: the OPTIONAL
  // `site_settings.trust_logo_media_ids` JSON list, defensively parsed.
  // Missing / corrupt / non-array / nothing resolvable → null (the frame
  // renders no strip — never a broken one). See parseTrustLogos.
  trust_logos: SiteBrandingTrustLogo[] | null;
}

interface SiteIdentityRow {
  name: string | null;
  domain: string | null;
}

function trimmed(value: string | undefined | null): string {
  return typeof value === "string" ? value.trim() : "";
}

// Legal links — the repo's site_settings carries NO privacy/terms URL keys;
// its only per-site legal-surface signals are `contact_email` and
// `privacy_email` (both seeded by the SAME provisioning step that seeds the
// legal pages themselves — site-provisioning/steps.ts DEFAULT_SETTING_SEED +
// legal-renderer.ts LEGAL_TEMPLATE_SLUGS ['privacy-policy','terms',
// 'do-not-sell','contact'], served at /page/:slug and the bare /:slug
// catch-all). Derivation:
//   * contact_email present  → Contact        → /contact
//   * privacy_email present  → Privacy policy → /privacy-policy
//                            → Terms of use   → /terms
// Labels + bare-slug href style mirror the listicle footer
// (listicle/layouts/default/components.ts renderListicleFooter); the terms
// href is grounded on the SEEDED slug `terms` (the listicle's /terms-of-use
// drifts from legal-renderer's slug and would 404 on provisioned sites).
// Missing signal → the link is omitted — never an empty or dead href.
function deriveLegalLinks(
  settings: Readonly<Record<string, string>>,
): SiteBrandingLegalLink[] {
  const links: SiteBrandingLegalLink[] = [];
  if (trimmed(settings.contact_email) !== "") {
    links.push({ label: "Contact", href: "/contact" });
  }
  if (trimmed(settings.privacy_email) !== "") {
    links.push({ label: "Privacy policy", href: "/privacy-policy" });
    links.push({ label: "Terms of use", href: "/terms" });
  }
  return links;
}

// §11.3 `site_settings.trust_logo_media_ids` — an OPTIONAL JSON list of media
// storage keys (the additive settings key; no admin surface writes it yet, so
// the parse is maximally defensive — riding revenue-serving paths it may see
// anything). Rules:
//   * missing / blank / corrupt JSON / non-array → null (dedicated try/catch,
//     d1-database-safety JSON.parse rule — never a throw into a serve);
//   * entries must be non-empty strings resolvable through mediaUrl();
//     anything else is SKIPPED (never a broken <img src>);
//   * nothing resolvable → null (consumer semantics: null = render nothing).
function parseTrustLogos(raw: string | undefined): SiteBrandingTrustLogo[] | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // corrupt settings value → the optional key is simply absent
  }
  if (!Array.isArray(parsed)) return null;
  const out: SiteBrandingTrustLogo[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "string") continue;
    const mediaId = entry.trim();
    if (mediaId === "") continue;
    const url = mediaUrl(mediaId);
    if (url !== null) out.push({ media_id: mediaId, url });
  }
  return out.length > 0 ? out : null;
}

// Mirrors listicle/serve.ts loadSiteSettings (module-private there): the full
// key/value set for one site — a single-binding parameterized read.
async function loadSiteSettings(
  db: D1Database,
  siteId: string,
): Promise<Record<string, string>> {
  const result = await db
    .prepare("SELECT key AS key, value AS value FROM site_settings WHERE site_id = ?")
    .bind(siteId)
    .all<{ key: string; value: string | null }>();
  const settings: Record<string, string> = {};
  for (const row of result.results ?? []) {
    if (typeof row.value === "string") settings[row.key] = row.value;
  }
  return settings;
}

// ---------------------------------------------------------------------------
// §10.2 branding-edit cache refresh (Phase D integration hardening)
// ---------------------------------------------------------------------------

// The site_settings keys the SiteBranding projection reads (resolveSiteBranding
// above): identity (site_name, tagline), the §10.4 logo ladder (logo_media_id,
// site_logo_url), the legal/contact keys deriveLegalLinks consumes
// (contact_email, privacy_email) and the §11.3 trust-logo set
// (trust_logo_media_ids). A settings save touching ANY of these changes what a
// served funnel shell bakes in — the §10.2 bump below must follow it.
export const LEADGEN_BRANDING_SETTINGS_KEYS: ReadonlySet<string> = new Set<string>([
  "site_name",
  "logo_media_id",
  "site_logo_url",
  "tagline",
  "contact_email",
  "privacy_email",
  "trust_logo_media_ids",
]);

// True when a settings save touches at least one SiteBranding input key.
export function touchesLeadGenBranding(keys: Iterable<string>): boolean {
  for (const key of keys) {
    if (LEADGEN_BRANDING_SETTINGS_KEYS.has(key)) return true;
  }
  return false;
}

// §10.2 cache correctness: the funnel shell is cached per site with
// `leadgen_site_quotes.updated_at` as the activation_version key segment
// (cache-keys.ts leadgenShellKey; serve.ts reads resolved.site_quote
// .updated_at). The shell BAKES the resolved site branding (header logo,
// site-name text mark, footer legal links, trust logos), and a branding-only
// settings edit moves NO other axis — so the settings save handler touches
// updated_at for that site's activation rows. ONE parameterized UPDATE, rows
// for that site_id only; zero activation rows → 0 changes (a no-op — exactly
// the "when a LeadGen activation exists" contract clause). This RIDES the
// existing activation_version axis (the same unixepoch() stamp the activation
// PUT/DELETE handlers write) — no new cache axis.
export async function bumpLeadGenActivationVersionForBranding(
  db: D1Database,
  siteId: string,
): Promise<number> {
  const result = await db
    .prepare("UPDATE leadgen_site_quotes SET updated_at = unixepoch() WHERE site_id = ?")
    .bind(siteId)
    .run();
  return Number(result.meta?.changes ?? 0);
}

// resolveSiteBranding — the §10.1 projection for one site_id. Never throws:
// a failed read logs and degrades down the §10.4 ladder (branding must never
// block a funnel serve; minimal-schema test harnesses without a
// site_settings table degrade the same way).
export async function resolveSiteBranding(
  db: D1Database,
  siteId: string,
): Promise<SiteBranding> {
  let settings: Record<string, string> = {};
  try {
    settings = await loadSiteSettings(db, siteId);
  } catch (err) {
    console.warn(
      `leadgen branding: site_settings read failed for site '${siteId}' — serving fallback branding`,
      err instanceof Error ? err.message : err,
    );
  }

  let site: SiteIdentityRow | null = null;
  try {
    site =
      (await db
        .prepare("SELECT name AS name, domain AS domain FROM sites WHERE id = ? LIMIT 1")
        .bind(siteId)
        .first<SiteIdentityRow>()) ?? null;
  } catch (err) {
    console.warn(
      `leadgen branding: sites read failed for site '${siteId}' — serving fallback branding`,
      err instanceof Error ? err.message : err,
    );
  }

  // site_name: settings.site_name → the sites row's host identity (domain) →
  // siteId (terminal non-empty defensive leg; a resolved activation implies
  // the sites row exists, so this leg is unreachable in practice).
  const settingName = trimmed(settings.site_name);
  const domain = trimmed(site?.domain);
  const siteName = settingName !== "" ? settingName : domain !== "" ? domain : siteId;

  // Logo ladder — byte-for-byte the brandFromSettings logic
  // (listicle/serve.ts): media storage key through mediaUrl(), else a SAFE
  // direct URL, else null.
  let logoUrl = mediaUrl(settings.logo_media_id);
  if (logoUrl === null) {
    const direct = trimmed(settings.site_logo_url);
    logoUrl = direct !== "" && isSafeUrl(direct) ? direct : null;
  }

  const tagline = trimmed(settings.tagline);

  return {
    site_name: siteName,
    logo_url: logoUrl,
    tagline: tagline !== "" ? tagline : null,
    legal_links: deriveLegalLinks(settings),
    trust_logos: parseTrustLogos(settings.trust_logo_media_ids),
  };
}
