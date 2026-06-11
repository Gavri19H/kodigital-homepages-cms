// Admin UI router. Renders the 13 server-side HTML admin shell pages via
// the templates barrel (adminLayout + per-tab page renderers). Mounted by
// router.ts under /admin/* and protected by accessAuth upstream — this
// module itself does NOT register auth middleware. Each route resolves
// live data through api/src/admin/data.ts (T2 wiring) and passes the
// resulting DTOs to the page renderer. Per-route site_id filtering is
// resolved from ?site_id= query (falling back to the first available
// site) so the page is never rendered against an empty data set when a
// site exists.

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../env';
import type { AccessAuthVariables } from '../auth/access-auth';
import {
  adminLayout,
  dashboardPage,
  domainsPage,
  articlesListPage,
  articleFormPage,
  pagesListPage,
  pageFormPage,
  categoriesListPage,
  tagsListPage,
  mediaListPage,
  settingsPage,
  presetsListPage,
  aiGenerationsListPage,
  aiGenerationDetailPage,
  aiGenerationNotFoundPage,
  type AiGenerationListEntry,
  type AiGenerationDetailEntry,
} from './templates';
import * as data from './data';
import type { AiGenerationRow } from '../ai/generation-log';

type AdminEnv = { Bindings: Env; Variables: AccessAuthVariables };
type AdminContext = Context<AdminEnv>;

export const adminUi = new Hono<AdminEnv>();

function getUserEmail(c: AdminContext): string | undefined {
  const access = c.get('access');
  if (access && access.mode === 'identity') {
    return access.email;
  }
  return undefined;
}

function branding(c: AdminContext): { userEmail?: string } {
  return data.getAdminBranding(getUserEmail(c));
}

async function resolveSiteId(
  c: AdminContext,
  sites: ReadonlyArray<{ id: string }>,
): Promise<string | null> {
  const q = c.req.query('site_id');
  if (q !== undefined && q.length > 0) return q;
  const first = sites[0];
  return first !== undefined ? first.id : null;
}

// 1/13 — Dashboard. KoDigital CMS shell with 7-card stats grid +
// Recent Articles + Quick Actions.
adminUi.get('/admin', async (c) => {
  const stats = await data.getDashboardStats(c.env);
  const recent = await data.getRecentArticles(c.env);
  return c.html(dashboardPage(stats, recent, branding(c)));
});

// 2/13 — Domains (Sites) listing + Create-Site modal.
adminUi.get('/admin/domains', async (c) => {
  const domainsList = await data.listAdminDomains(c.env);
  const verticals = await data.listAdminVerticals(c.env);
  // Map the data DTO (site_name) onto the template DomainEntry (name)
  // per the WARN-FIX-3 site_name -> name migration that landed in
  // api/src/admin/templates/domains.ts.
  const entries = domainsList.map((d) => ({
    domain: d.domain,
    name: d.site_name,
    vertical: d.vertical,
    activity: d.activity,
    status: d.status,
    articles: d.articles,
    created: d.created,
    last_provisioned: d.last_provisioned,
  }));
  return c.html(domainsPage(entries, verticals, branding(c)));
});

// 3/13 — Articles list (8-col table, 8 filters). Articles are listed
// site-scoped via data.ts:listArticlesForSite with the resolved site_id;
// when no site exists yet the global list is used as a fallback so the
// shell still renders something useful (T2.AC2 binds the per-site path
// when at least one site is seeded).
adminUi.get('/admin/articles', async (c) => {
  const sites = await data.listAdminSites(c.env);
  const verticals = await data.listAdminVerticals(c.env);
  const categories = await data.listAdminCategories(c.env);
  const siteId = await resolveSiteId(c, sites);
  const articles = siteId !== null
    ? await data.listArticlesForSite(c.env, siteId)
    : await data.listAdminArticles(c.env);
  // Active filter state round-trips into the toolbar so selects render
  // their selected option after a filter-driven reload (?site_id= is the
  // wire name resolveSiteId consumes; the rest are URL params the
  // toolbar script maintains).
  return c.html(
    articlesListPage(articles, sites, verticals, categories, branding(c), {
      site_id: siteId ?? undefined,
      search: c.req.query('search'),
      vertical: c.req.query('vertical'),
      category: c.req.query('category'),
      status: c.req.query('status'),
      featured: c.req.query('featured'),
      trending: c.req.query('trending'),
      published: c.req.query('published'),
    }),
  );
});

// 4/13 — Article create form (site-required + homepage placement).
adminUi.get('/admin/articles/new', async (c) => {
  const sites = await data.listAdminSites(c.env);
  const categories = await data.listAdminCategories(c.env);
  return c.html(articleFormPage(null, sites, categories, branding(c)));
});

// 5/13 — Article edit form. Both /admin/articles/:id and
// /admin/articles/:id/edit resolve to the edit form so deep links from
// outside admin (e.g. from public previews) land on the editor without
// an extra hop.
async function renderArticleEdit(c: AdminContext): Promise<Response> {
  const id = c.req.param('id');
  const numericId = Number(id);
  const article = Number.isFinite(numericId)
    ? await data.getAdminArticle(c.env, numericId)
    : null;
  const sites = await data.listAdminSites(c.env);
  const categories = await data.listAdminCategories(c.env);
  return c.html(articleFormPage(article, sites, categories, branding(c)));
}
adminUi.get('/admin/articles/:id', renderArticleEdit);
adminUi.get('/admin/articles/:id/edit', renderArticleEdit);

// 6/13 — Pages list (Site filter, Page-type filter, Global template
// badge for legal pages).
adminUi.get('/admin/pages', async (c) => {
  const pages = await data.listAdminPages(c.env);
  const sites = await data.listAdminSites(c.env);
  return c.html(pagesListPage(pages, sites, branding(c)));
});

// 7/13 — Page create form.
adminUi.get('/admin/pages/new', async (c) => {
  const sites = await data.listAdminSites(c.env);
  return c.html(pageFormPage(null, sites, branding(c)));
});

// 8/13 — Page edit form. Both /admin/pages/:id and
// /admin/pages/:id/edit surface the same renderer.
async function renderPageEdit(c: AdminContext): Promise<Response> {
  const id = c.req.param('id');
  const numericId = Number(id);
  const page = Number.isFinite(numericId)
    ? await data.getAdminPage(c.env, numericId)
    : null;
  const sites = await data.listAdminSites(c.env);
  return c.html(pageFormPage(page, sites, branding(c)));
}
adminUi.get('/admin/pages/:id', renderPageEdit);
adminUi.get('/admin/pages/:id/edit', renderPageEdit);

// 9/13 — Categories list (Site filter, Vertical multi-select).
adminUi.get('/admin/categories', async (c) => {
  const categories = await data.listAdminCategories(c.env);
  const sites = await data.listAdminSites(c.env);
  return c.html(categoriesListPage(categories, sites, branding(c)));
});

// 10/13 — Tags list (Site filter, Global indicator).
adminUi.get('/admin/tags', async (c) => {
  const tags = await data.listAdminTags(c.env);
  const sites = await data.listAdminSites(c.env);
  return c.html(tagsListPage(tags, sites, branding(c)));
});

// 11/13 — Media library list (Site filter, Kind filter).
adminUi.get('/admin/media', async (c) => {
  const media = await data.listAdminMedia(c.env);
  const sites = await data.listAdminSites(c.env);
  return c.html(mediaListPage(media, sites, branding(c)));
});

// 12/13 — AI Presets read-only list.
adminUi.get('/admin/presets', async (c) => {
  const presets = await data.listAdminPresets(c.env);
  return c.html(presetsListPage(presets, branding(c)));
});

// T10 — AI Generations list shell. The HTML page is a thin wrapper
// around the JSON list endpoint at GET /api/admin/ai-generations; the
// initial render reads up to `page_size` rows directly from D1 so
// deep-linked visits do not require a follow-up XHR. Pagination uses
// `page` + `page_size` query params; client-side JS is intentionally
// minimal — the link-only pagination shell is server-rendered.
adminUi.get('/admin/ai-generations', async (c) => {
  const url = new URL(c.req.url);
  const pageRaw = parseInt(url.searchParams.get('page') ?? '1', 10);
  const sizeRaw = parseInt(url.searchParams.get('page_size') ?? '25', 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const pageSize = Number.isFinite(sizeRaw) && sizeRaw > 0 && sizeRaw <= 100 ? sizeRaw : 25;
  const offset = (page - 1) * pageSize;
  const list = await c.env.DB.prepare(
    'SELECT id, task, model, prompt_version, status, target_type, created_at, error_message FROM ai_generations ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
  )
    .bind(pageSize, offset)
    .all<AiGenerationListEntry>();
  const totalRow = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM ai_generations',
  ).first<{ n: number }>();
  const total = totalRow ? Number(totalRow.n) : 0;
  return c.html(
    aiGenerationsListPage(
      list.results ?? [],
      {
        page,
        page_size: pageSize,
        total,
        prev_url: page > 1 ? `/admin/ai-generations?page=${page - 1}&page_size=${pageSize}` : null,
        next_url:
          offset + pageSize < total
            ? `/admin/ai-generations?page=${page + 1}&page_size=${pageSize}`
            : null,
      },
      { userEmail: getUserEmail(c) },
    ),
  );
});

// T10 — AI Generation detail shell. /admin/ai-generations/:id renders
// the full row from ai_generations (provider, model, prompt_version,
// target_type/id, idempotency_key, the three JSON payloads, error).
// The :id segment matches the typed `ai_generations.id` column and is
// surfaced in the template as `data-ai-generation-id` so other admin
// tabs can deep-link via the canonical column name.
adminUi.get('/admin/ai-generations/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    'SELECT id, site_id, task, provider, model, prompt_version, idempotency_key, status, target_type, target_id, request_json, response_json, parsed_json, error_message, created_at, updated_at FROM ai_generations WHERE id = ? LIMIT 1',
  )
    .bind(id)
    .first<AiGenerationRow>();
  if (!row) {
    return c.html(
      aiGenerationNotFoundPage(id, { userEmail: getUserEmail(c) }),
      404,
    );
  }
  const detail: AiGenerationDetailEntry = {
    id: row.id,
    site_id: row.site_id,
    task: row.task,
    provider: row.provider,
    model: row.model,
    prompt_version: row.prompt_version,
    idempotency_key: row.idempotency_key,
    status: row.status,
    target_type: row.target_type,
    target_id: row.target_id,
    request_json: row.request_json,
    response_json: row.response_json,
    parsed_json: row.parsed_json,
    error_message: row.error_message,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  return c.html(
    aiGenerationDetailPage(detail, { userEmail: getUserEmail(c) }),
  );
});

// 13/13 — Settings (per-site editor, 12 canonical keys). The `site_id`
// query param drives the initially selected site so the editor opens
// directly against a chosen site when linked from elsewhere in admin.
adminUi.get('/admin/settings', async (c) => {
  const sites = await data.listAdminSites(c.env);
  const first = sites[0];
  const selectedSiteId = c.req.query('site_id')
    ?? (first !== undefined ? first.id : null);
  const values = await data.listAdminSettings(c.env, selectedSiteId);
  return c.html(settingsPage(sites, values, selectedSiteId, branding(c)));
});

// adminLayout is imported above so the editor barrel is exercised at
// type-check time even though the per-route handlers above call the
// higher-level page renderers (each of which wraps adminLayout
// internally). Keeping the symbol in scope here documents the
// contract that every admin GET MUST flow through adminLayout.
void adminLayout;
