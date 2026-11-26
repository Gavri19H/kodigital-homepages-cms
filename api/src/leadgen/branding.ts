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
//
// R2 P3 D2 (fix-contract §5.4 item 2 / §7 D2) — element J's Pages-fed
// legal-links leg, ADDITIVE to the §10.1 projection above:
//   * `resolveSiteBranding`'s 3rd param (`legalPagePicks`, OPTIONAL) lets a
//     caller that knows a specific footer block's operator-picked page set
//     override `legal_links` with the D2 serve-time resolution below —
//     ABSENT/empty → byte-identical to today (deriveLegalLinks from
//     site_settings). This is the ONLY behavior change; every existing
//     caller that never passes the 3rd arg is unaffected.
//   * `resolvePickedLegalPageLinks` — the serve-time resolver: the operator
//     picks pages by a STABLE, PORTABLE identity, never by row id (row ids
//     are per-site and cannot cross sites). R2 P3 FIX-FIRST (BLOCKER-2): that
//     identity is now `slug` FIRST (per-site UNIQUE, shared across stock
//     sites) with `page_type` as the back-compat fallback — see
//     SiteBrandingLegalPagePick below for why page_type alone was wrong and
//     what the migration-safe rule is. At serve time, for the SERVING
//     site_id, each pick is looked up against THAT site's own `pages` rows —
//     so one saved pick set serves site A's privacy policy on site A and
//     site B's on site B. No match on the serving site → the pick's
//     `manual_url` fallback (when present AND safe) → otherwise OMITTED.
//     Never a dead or unsafe link (D2 + R2 minor-6).
//   * `listPickableLegalPages` — the picker's data source: one site's own
//     candidates (page_type ∈ LEGAL_PAGE_TYPES and/or show_in_footer=1,
//     non-archived) for the operator to choose from at authoring time.
//   * Safety: a pick's `manual_url` is the ONLY new operator-typed href this
//     module introduces (a resolved page's href is built from that site's
//     OWN slug, never operator text). It is gated by a byte-identical
//     re-declaration of the existing `SAFE_HREF_RE` class (canonical source
//     `public/leadgen/components/content-schema.ts`, sibling copy
//     `public/leadgen/designs/frames.ts:856` — the codebase's established
//     "re-declared per module, byte-identical" reuse rule, not a second/
//     different sanitizer) — so by the time a link reaches `legal_links` it
//     is ALREADY guaranteed to pass the same class every other footer href
//     passes, matching this module's existing invariant that `legal_links`
//     entries are always safe by construction.

import { mediaUrl } from "../public/view-models/media-url";
import { isSafeUrl } from "../editor/sanitize";
import { LEGAL_PAGE_TYPES } from "../admin/pages-crud-handlers";
import { withoutAiSetupLogo, siteFaviconUrl, siteBrandColor } from "../public/site-brand";

function parseBrandTokensSafe(raw: string | undefined): Record<string, string> {
  if (typeof raw !== "string" || raw === "") return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (v === null || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === "string") out[k] = x;
    return out;
  } catch {
    return {};
  }
}


export interface SiteBrandingLegalLink {
  label: string;
  href: string;
}

// D2 — one operator pick from the /admin/pages legal-links picker. `label`
// is author-controlled and rides UNCHANGED across every serving site (the
// "one saved template" reuse goal — Image28/Image45 show a fixed label row);
// only the HREF resolves per site. `page_type` is the stable cross-site
// identity (row ids are per-site and never portable). `manual_url` is the
// D2 fallback used ONLY when the serving site has no page of that type.
// R2 P3 FIX-FIRST (BLOCKER-2) — `slug` is the PRIMARY identity; `page_type`
// is the back-compat fallback. Why: `page_type` is NOT unique per site — a
// stock CMS site's provisioning step seeds contact / do-not-sell /
// privacy-policy / terms ALL with page_type 'legal', so the first-wins
// per-type map below sent four different picks to ONE page (silently, on the
// DEFAULT path). `slug` is UNIQUE per site (migration 0007
// idx_pages_site_slug_unique) yet SHARED across stock sites (the seeder
// writes the same LEGAL_TEMPLATE_SLUGS on every site), so it keeps D2's
// "one saved template, each site's own pages" semantic while telling the
// four 'legal' rows apart.
// BACK-COMPAT RULE (migration-safe, no data rewrite): resolution is
//   slug (when stored AND the serving site publishes it)
//   → page_type first-wins (EXACTLY the pre-fix behavior — the only path a
//     pre-fix pick, which stores no slug, can ever take)
//   → manual_url (SAFE_HREF-gated) → omitted.
export interface SiteBrandingLegalPagePick {
  page_type: string;
  label: string;
  slug?: string | null;
  manual_url?: string | null;
}

// The picker's one candidate row (listPickableLegalPages) — sourced from one
// REFERENCE site's own pages, for the operator to choose from at authoring
// time. `title` is display-only (the picker seeds its label input from it;
// the resolver never reads title).
export interface PickableLegalPage {
  page_type: string;
  slug: string;
  title: string;
  show_in_footer: boolean;
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
  // §10.4 ladder: mediaUrl(logo_media_id) → safe site_logo_url → null, then
  // the one logo rule (X14 v2 Q4): uploaded /media/ logos only — the AI-made
  // setup logo counts as none.
  logo_url: string | null;
  // X14 v2: the site's "Tab icon" (/media/ address) — null/absent = badge.
  favicon_url?: string | null;
  // X14 v2: the site's brand color (badge + browser color).
  brand_color?: string;
  // site_settings.tagline (trimmed, non-empty) ?? null.
  tagline: string | null;
  // privacy/terms/contact derived from site settings when present; a missing
  // signal OMITS the link (never an empty href). See deriveLegalLinks — UNLESS
  // resolveSiteBranding was called with a non-empty `legalPagePicks` 3rd arg
  // (D2, element J), in which case this is the resolvePickedLegalPageLinks
  // result instead (REPLACES, never merges with, the site_settings derivation).
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

// ---------------------------------------------------------------------------
// D2 — element J's Pages-fed legal-links picker + serve-time resolution
// (fix-contract §5.4 item 2 / §7 D2). See the file-header block above for the
// full design summary.
// ---------------------------------------------------------------------------

// A safe, non-executable link target. BYTE-IDENTICAL to the canonical
// SAFE_HREF_RE (public/leadgen/components/content-schema.ts — module-private
// there, re-declared per module by the codebase's OWN established reuse
// rule; sibling copy public/leadgen/designs/frames.ts:856, which documents
// the same "MUST stay byte-identical" discipline). This is NOT a second/
// different sanitizer — it is the SAME class, gating the ONE new
// operator-typed href this module introduces (a pick's `manual_url`
// fallback). A resolved page's own href is built from that site's stored
// slug, never from operator text, so it needs no gate.
const SAFE_HREF_RE = /^(https?:\/\/|\/(?!\/)|#|tel:|mailto:)/i;

// A picked slug is unique per site. A picked type is usable only when exactly
// one published page has that type. Read both sets in one round, including
// for long pick lists, using two bound JSON arrays of keys.
interface PublishedPageIndex {
  bySlug: ReadonlyMap<string, { slug: string }>;
  byType: ReadonlyMap<string, { slug: string }>;
  byTypeCount: ReadonlyMap<string, number>;
}
async function loadPublishedPages(
  db: D1Database,
  siteId: string,
  pageTypes: readonly string[],
  slugs: readonly string[],
): Promise<PublishedPageIndex> {
  const uniqueTypes = new Set(pageTypes.filter((t) => t.trim() !== ""));
  const uniqueSlugs = new Set(slugs.filter((s) => s.trim() !== ""));
  const byType = new Map<string, { slug: string }>();
  const byTypeCount = new Map<string, number>();
  const bySlug = new Map<string, { slug: string }>();
  if (uniqueTypes.size === 0 && uniqueSlugs.size === 0) return { bySlug, byType, byTypeCount };
  try {
    const result = await db
      .prepare(
        `SELECT page_type AS page_type, slug AS slug FROM pages
         WHERE site_id = ? AND status = 'published'
           AND (page_type IN (SELECT value FROM json_each(?)) OR slug IN (SELECT value FROM json_each(?)))
         ORDER BY show_in_footer DESC, display_order ASC, id ASC`,
      )
      .bind(siteId, JSON.stringify([...uniqueTypes]), JSON.stringify([...uniqueSlugs]))
      .all<{ page_type: string; slug: string }>();
    for (const row of result.results ?? []) {
      if (uniqueTypes.has(row.page_type)) {
        if (!byType.has(row.page_type)) byType.set(row.page_type, { slug: row.slug });
        byTypeCount.set(row.page_type, (byTypeCount.get(row.page_type) ?? 0) + 1);
      }
      bySlug.set(row.slug, { slug: row.slug });
    }
  } catch (err) {
    console.warn(
      `leadgen branding: pages read failed for site '${siteId}' — legal-page picks degrade to manual/omitted`,
      err instanceof Error ? err.message : err,
    );
    byType.clear();
    bySlug.clear();
    byTypeCount.clear();
  }
  return { bySlug, byType, byTypeCount };
}

// The D2 serve-time resolver. For the SERVING `siteId`, maps each pick's
// stable `page_type` identity to THAT site's own page (never another site's
// row) — so one saved pick set serves site A's privacy policy on site A and
// site B's on site B. Order follows `picks` (the operator's own authored
// order); the COUNT may be shorter, because a pick that cannot be resolved to
// exactly one page is omitted rather than guessed. Ladder per pick:
// slug (per-site UNIQUE) → page_type WHEN it identifies exactly one published
// row → `manual_url` when present AND SAFE_HREF_RE-safe → OMITTED (never a
// dead, unsafe, or wrong link — D2 + R2 minor-6 + the R2 P3 flake-fix
// ambiguity rule). A blank label is also omitted (never an empty anchor text).
export async function resolvePickedLegalPageLinks(
  db: D1Database,
  siteId: string,
  picks: readonly SiteBrandingLegalPagePick[],
): Promise<SiteBrandingLegalLink[]> {
  if (picks.length === 0) return [];
  const { bySlug, byType, byTypeCount } = await loadPublishedPages(
    db,
    siteId,
    picks.map((p) => p.page_type),
    picks.map((p) => trimmed(p.slug)),
  );
  const out: SiteBrandingLegalLink[] = [];
  for (const pick of picks) {
    const label = trimmed(pick.label);
    if (label === "") continue;
    // R2 P3 FIX-FIRST (BLOCKER-2) — slug first (per-site UNIQUE, tells the
    // four stock 'legal' rows apart).
    const slugKey = trimmed(pick.slug);
    const bySlugMatch = slugKey === "" ? undefined : bySlug.get(slugKey);
    if (bySlugMatch !== undefined) {
      out.push({ label, href: `/${bySlugMatch.slug}` });
      continue;
    }
    // page_type second — the leg the owner clause needs for a site that
    // RENAMED its page (its slug differs, its type does not).
    //
    // R2 P3 flake-fix (conductor ruling): that leg now requires the type to
    // identify EXACTLY ONE published row on the serving site. With
    // provisioning writing a canonical page_type per page
    // (site-provisioning/legal-renderer.ts legalPageTypeForSlug), a renamed
    // site holds exactly one row per type, so the renamed-site case is
    // preserved unchanged. When the type matches MORE THAN ONE published row
    // the old first-wins tie-break (show_in_footer DESC, display_order ASC,
    // id ASC) was never a resolution — it was a coin flip on a compliance
    // link, and it is how four distinct picks came to serve
    // /privacy-policy. Ambiguity therefore falls through to the pick's own
    // manual_url, and otherwise the link is OMITTED: a missing link is
    // visible to the operator in their own footer, while a wrong one is an
    // invisible legal failure for the visitor who clicks it.
    const typeMatch = byType.get(pick.page_type);
    const typeRows = byTypeCount.get(pick.page_type) ?? 0;
    if (typeMatch !== undefined && typeRows === 1) {
      out.push({ label, href: `/${typeMatch.slug}` });
      continue;
    }
    const manual = trimmed(pick.manual_url);
    if (manual !== "" && SAFE_HREF_RE.test(manual)) {
      out.push({ label, href: manual });
    }
  }
  return out;
}

// The picker's data source (one admin endpoint, footer-legal-pages-handlers.ts,
// reads this): one REFERENCE site's own candidates — page_type ∈
// LEGAL_PAGE_TYPES (pages-crud-handlers.ts, exported for this reuse) and/or
// show_in_footer=1, excluding archived. Never throws: a read failure yields
// an empty list (the picker simply shows no candidates, never a 500).
export async function listPickableLegalPages(
  db: D1Database,
  siteId: string,
): Promise<PickableLegalPage[]> {
  try {
    const legalTypes = Array.from(LEGAL_PAGE_TYPES);
    const placeholders = legalTypes.map(() => "?").join(",");
    const result = await db
      .prepare(
        `SELECT page_type AS page_type, slug AS slug, title AS title, show_in_footer AS show_in_footer
         FROM pages
         WHERE site_id = ? AND status <> 'archived' AND (page_type IN (${placeholders}) OR show_in_footer = 1)
         ORDER BY display_order ASC, title ASC`,
      )
      .bind(siteId, ...legalTypes)
      .all<{ page_type: string; slug: string; title: string; show_in_footer: number }>();
    return (result.results ?? []).map((row) => ({
      page_type: row.page_type,
      slug: row.slug,
      title: row.title,
      show_in_footer: row.show_in_footer === 1,
    }));
  } catch (err) {
    console.warn(
      `leadgen branding: pickable-pages read failed for site '${siteId}'`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
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
  // X14 v2: the tab icon and the brand color are baked into the funnel shell.
  "favicon_media_id",
  "brand_tokens_json",
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
//
// `legalPagePicks` (D2, OPTIONAL, 3rd arg): a specific element-J footer
// block's operator-picked page set, when the caller has one (it is
// funnel/footer-config-scoped, NOT a site_settings signal, so it cannot be
// loaded inside this per-site function — the caller supplies it). ABSENT or
// empty → byte-identical to pre-D2 behavior (deriveLegalLinks from
// site_settings). Non-empty → `legal_links` becomes EXCLUSIVELY the D2
// resolvePickedLegalPageLinks result for THIS site_id (replaces, never
// merges with, the site_settings derivation — the operator's curated pick
// set is a complete, deliberate choice).
export async function resolveSiteBranding(
  db: D1Database,
  siteId: string,
  legalPagePicks?: readonly SiteBrandingLegalPagePick[],
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

  return siteBrandingFromSettings(db, siteId, settings, site?.domain, legalPagePicks);
}

// A reverse variant lookup already has the settings and identity from its
// definition read. Only the published pages named by the effective footer
// can require a further read.
export async function siteBrandingFromSettings(
  db: D1Database,
  siteId: string,
  settings: Readonly<Record<string, string>>,
  siteDomain: string | null | undefined,
  legalPagePicks?: readonly SiteBrandingLegalPagePick[],
): Promise<SiteBranding> {
  // site_name: settings.site_name → the sites row's host identity (domain) →
  // siteId (terminal non-empty defensive leg; a resolved activation implies
  // the sites row exists, so this leg is unreachable in practice).
  const settingName = trimmed(settings.site_name);
  const domain = trimmed(siteDomain);
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

  const picks = legalPagePicks ?? [];
  const legalLinks =
    picks.length > 0 ? await resolvePickedLegalPageLinks(db, siteId, picks) : deriveLegalLinks(settings);

  return {
    site_name: siteName,
    logo_url: withoutAiSetupLogo(logoUrl),
    favicon_url: siteFaviconUrl(settings.favicon_media_id),
    brand_color: siteBrandColor(parseBrandTokensSafe(settings.brand_tokens_json)),
    tagline: tagline !== "" ? tagline : null,
    legal_links: legalLinks,
    trust_logos: parseTrustLogos(settings.trust_logo_media_ids),
  };
}
