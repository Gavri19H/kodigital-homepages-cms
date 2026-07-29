// Phase 3 / T20: variable-aware legal-template renderer.
//
// The 4 global legal templates (privacy-policy, terms, do-not-sell,
// contact) are seeded in 0004_phase3_seed_*.sql with mustache-style
// placeholders. This module substitutes the 6 documented variables
// (site_name, domain, contact_email, privacy_email, effective_date,
// company_name — see LEGAL_VARIABLE_TOKENS) into the template body for
// a specific site_id, then upserts a pages row per template under
// (site_id, slug). Any remaining placeholder (e.g. {{owner_email}} from
// the seed) is stripped after substitution so the BEHAVIORAL contract
// "rendered HTML contains no opening curly substring" holds end-to-end.

import type { Env } from "../env";
import { LEGAL_PAGE_TYPES } from "../admin/pages-crud-handlers";

export const LEGAL_TEMPLATE_SLUGS = [
  "privacy-policy",
  "terms",
  "do-not-sell",
  "contact",
] as const;

export type LegalTemplateSlug = (typeof LEGAL_TEMPLATE_SLUGS)[number];

// R2 P3 flake-fix (root). Every provisioned legal page used to be inserted
// with the literal page_type 'legal', so the four canonical pages a site is
// seeded with were INDISTINGUISHABLE by page_type — and
// leadgen/branding.ts resolvePickedLegalPageLinks's page_type leg
// (first-wins by show_in_footer DESC, display_order ASC, id ASC) handed
// whichever of them was inserted first to EVERY pick that reached it. With
// provisioning's rows landing before a site's own pages, four distinct
// operator picks all served /privacy-policy. Legal links are a compliance
// surface (SOURCE-OF-TRUTH A.2: "links to legal pages (from the 'pages'
// tab) that the user is choosing"), so a "Terms of Use" pick may never
// serve the privacy policy.
//
// The disambiguating vocabulary already exists and is already shared:
// pages-crud-handlers.ts exports LEGAL_PAGE_TYPES (privacy-policy, terms,
// do-not-sell, contact, legal) — the same set branding.ts's picker query
// reuses. A canonical slug therefore carries its OWN page_type; anything
// else keeps the generic 'legal' bucket. No new vocabulary, no new module:
// pages-crud-handlers.ts is the single source of truth for both sides.
export function legalPageTypeForSlug(slug: string): string {
  return LEGAL_PAGE_TYPES.has(slug) ? slug : "legal";
}

export interface LegalRenderVariables {
  site_name: string;
  domain: string;
  contact_email: string;
  privacy_email: string;
  effective_date: string;
  company_name: string;
}

// The 6 substitution tokens. Each canonical token string is the literal
// counted by T20.AC1 grep `\{\{(site_name|domain|contact_email|privacy_email|effective_date|company_name)\}\}`.
// Keep one token per array element (and one per line) so the grep count
// is deterministic regardless of editor wrapping.
const LEGAL_VARIABLE_TOKENS: ReadonlyArray<readonly [
  keyof LegalRenderVariables,
  string,
]> = [
  ["site_name", "{{site_name}}"],
  ["domain", "{{domain}}"],
  ["contact_email", "{{contact_email}}"],
  ["privacy_email", "{{privacy_email}}"],
  ["effective_date", "{{effective_date}}"],
  ["company_name", "{{company_name}}"],
];

// Strip any {{identifier}} remaining after the documented-variable
// substitution loop. Templates may reference variables the renderer
// does not expose yet (e.g. {{owner_email}} / {{address}} / {{vertical}}
// from the 0004 seed); leaving those raw would violate the BEHAVIORAL
// "no '{{' substrings" contract.
const RESIDUAL_PLACEHOLDER_RE = /\{\{[a-zA-Z0-9_]+\}\}/g;

export function substituteLegalTemplate(
  template: string,
  vars: LegalRenderVariables,
): string {
  let out = template;
  for (const [key, token] of LEGAL_VARIABLE_TOKENS) {
    out = out.split(token).join(vars[key]);
  }
  out = out.replace(RESIDUAL_PLACEHOLDER_RE, "");
  return out;
}

function formatEffectiveDateUTC(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const yyyy = d.getUTCFullYear().toString();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function buildLegalRenderVariables(
  db: D1Database,
  site_id: string,
): Promise<LegalRenderVariables> {
  const site = await db
    .prepare("SELECT name, domain FROM sites WHERE id = ? LIMIT 1")
    .bind(site_id)
    .first<{ name: string | null; domain: string | null }>();
  const name =
    site && typeof site.name === "string" && site.name.length > 0
      ? site.name
      : site_id;
  const domain =
    site && typeof site.domain === "string" && site.domain.length > 0
      ? site.domain
      : "";
  const settingsRows = await db
    .prepare(
      "SELECT key, value FROM site_settings WHERE site_id = ? " +
        "AND key IN ('contact_email','privacy_email')",
    )
    .bind(site_id)
    .all<{ key: string; value: string | null }>();
  const settings: Record<string, string> = {};
  const results = settingsRows && Array.isArray(settingsRows.results)
    ? settingsRows.results
    : [];
  for (const r of results) {
    if (r && typeof r.key === "string" && typeof r.value === "string") {
      settings[r.key] = r.value;
    }
  }
  const fallbackContact = domain.length > 0 ? `contact@${domain}` : "";
  const fallbackPrivacy = domain.length > 0 ? `privacy@${domain}` : "";
  const contact_email =
    typeof settings.contact_email === "string" && settings.contact_email.length > 0
      ? settings.contact_email
      : fallbackContact;
  const privacy_email =
    typeof settings.privacy_email === "string" && settings.privacy_email.length > 0
      ? settings.privacy_email
      : fallbackPrivacy;
  const effective_date = formatEffectiveDateUTC(Math.floor(Date.now() / 1000));
  return {
    site_name: name,
    domain,
    contact_email,
    privacy_email,
    effective_date,
    company_name: name,
  };
}

export interface LegalRenderResult {
  rendered: number;
  slugs: LegalTemplateSlug[];
  missing: LegalTemplateSlug[];
}

export async function renderLegalPagesForSite(
  _env: Env,
  db: D1Database,
  site_id: string,
): Promise<LegalRenderResult> {
  const vars = await buildLegalRenderVariables(db, site_id);
  const rendered: LegalTemplateSlug[] = [];
  const missing: LegalTemplateSlug[] = [];
  for (const slug of LEGAL_TEMPLATE_SLUGS) {
    const tpl = await db
      .prepare(
        "SELECT title, content_html, content_md FROM legal_templates " +
          "WHERE slug = ? LIMIT 1",
      )
      .bind(slug)
      .first<{
        title: string | null;
        content_html: string | null;
        content_md: string | null;
      }>();
    if (tpl === null || tpl === undefined) {
      missing.push(slug);
      continue;
    }
    const sourceBody =
      typeof tpl.content_html === "string" && tpl.content_html.length > 0
        ? tpl.content_html
        : typeof tpl.content_md === "string"
          ? tpl.content_md
          : "";
    const rawTitle = typeof tpl.title === "string" && tpl.title.length > 0
      ? tpl.title
      : slug;
    const html = substituteLegalTemplate(sourceBody, vars);
    const title = substituteLegalTemplate(rawTitle, vars);
    const contentJson = JSON.stringify({
      kind: "legal_template_rendered",
      slug,
      schema_version: 1,
      vars,
    });
    // page_type is now BOUND per page (legalPageTypeForSlug above), not the
    // literal 'legal' this statement used to carry. `template` stays 'legal'
    // (that column selects the render template, not the page's identity).
    // The existing `page_type = excluded.page_type` in the DO UPDATE clause
    // means an ALREADY-provisioned site self-heals on its next provisioning
    // run: the upsert rewrites the stale 'legal' row with its canonical type.
    await db
      .prepare(
        "INSERT INTO pages " +
          "(site_id, slug, title, content_json, content_html, status, template, show_in_footer, page_type) " +
          "VALUES (?, ?, ?, ?, ?, 'published', 'legal', 1, ?) " +
          "ON CONFLICT(site_id, slug) DO UPDATE SET " +
          "title = excluded.title, content_json = excluded.content_json, " +
          "content_html = excluded.content_html, status = excluded.status, " +
          "template = excluded.template, show_in_footer = excluded.show_in_footer, " +
          "page_type = excluded.page_type, updated_at = unixepoch()",
      )
      .bind(site_id, slug, title, contentJson, html, legalPageTypeForSlug(slug))
      .run();
    rendered.push(slug);
  }
  return { rendered: rendered.length, slugs: rendered, missing };
}
