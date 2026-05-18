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
} from './templates';
import * as data from './data';

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
  return c.html(
    articlesListPage(articles, sites, verticals, categories, branding(c)),
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
