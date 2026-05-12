// Admin UI router. Renders the 13 server-side HTML admin shell pages via
// the templates barrel (adminLayout + per-tab page renderers). Mounted by
// router.ts under /admin/* and protected by accessAuth upstream — this
// module itself does NOT register auth middleware. Schema-aware data
// helpers (T11, api/src/admin/data.ts) will replace the placeholder
// literals below once T11 lands; for T10 each route renders against
// empty/default data so the page surfaces its layout shell.

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

function emptyStats() {
  return {
    sites: 0,
    totalArticles: 0,
    published: 0,
    drafts: 0,
    pages: 0,
    mediaFiles: 0,
    categories: 0,
  };
}

// 1/13 — Dashboard. KoDigital CMS shell with 7-card stats grid +
// Recent Articles + Quick Actions. Placeholder data until T11 wires
// real D1 queries via api/src/admin/data.ts.
adminUi.get('/admin', (c) => {
  return c.html(
    dashboardPage(emptyStats(), [], { userEmail: getUserEmail(c) }),
  );
});

// 2/13 — Domains (Sites) listing + Create-Site modal.
adminUi.get('/admin/domains', (c) => {
  return c.html(domainsPage([], [], { userEmail: getUserEmail(c) }));
});

// 3/13 — Articles list (8-col table, 8 filters).
adminUi.get('/admin/articles', (c) => {
  return c.html(
    articlesListPage([], [], [], [], { userEmail: getUserEmail(c) }),
  );
});

// 4/13 — Article create form (site-required + homepage placement).
adminUi.get('/admin/articles/new', (c) => {
  return c.html(
    articleFormPage(null, [], [], { userEmail: getUserEmail(c) }),
  );
});

// 5/13 — Article edit form. The path-with-id form surfaces the same
// renderer as the new form; the actual article payload is fetched by
// T11 data helpers. Both /admin/articles/:id and /admin/articles/:id/edit
// resolve to the edit form so deep links from outside admin (e.g. from
// public previews) land on the editor without an extra hop.
adminUi.get('/admin/articles/:id', (c) => {
  const id = c.req.param('id');
  const article = { id, title: '', slug: '' };
  return c.html(
    articleFormPage(article, [], [], { userEmail: getUserEmail(c) }),
  );
});
adminUi.get('/admin/articles/:id/edit', (c) => {
  const id = c.req.param('id');
  const article = { id, title: '', slug: '' };
  return c.html(
    articleFormPage(article, [], [], { userEmail: getUserEmail(c) }),
  );
});

// 6/13 — Pages list (Site filter, Page-type filter, Global template
// badge for legal pages).
adminUi.get('/admin/pages', (c) => {
  return c.html(pagesListPage([], [], { userEmail: getUserEmail(c) }));
});

// 7/13 — Page create form.
adminUi.get('/admin/pages/new', (c) => {
  return c.html(pageFormPage(null, [], { userEmail: getUserEmail(c) }));
});

// 8/13 — Page edit form. Both /admin/pages/:id and
// /admin/pages/:id/edit surface the same renderer as the new form;
// payload comes from T11 helpers. Mirrors the articles bare-id +
// edit pair above.
adminUi.get('/admin/pages/:id', (c) => {
  const id = c.req.param('id');
  const page = { id, title: '', slug: '' };
  return c.html(pageFormPage(page, [], { userEmail: getUserEmail(c) }));
});
adminUi.get('/admin/pages/:id/edit', (c) => {
  const id = c.req.param('id');
  const page = { id, title: '', slug: '' };
  return c.html(pageFormPage(page, [], { userEmail: getUserEmail(c) }));
});

// 9/13 — Categories list (Site filter, Vertical multi-select).
adminUi.get('/admin/categories', (c) => {
  return c.html(
    categoriesListPage([], [], { userEmail: getUserEmail(c) }),
  );
});

// 10/13 — Tags list (Site filter, Global indicator).
adminUi.get('/admin/tags', (c) => {
  return c.html(tagsListPage([], [], { userEmail: getUserEmail(c) }));
});

// 11/13 — Media library list (Site filter, Kind filter).
adminUi.get('/admin/media', (c) => {
  return c.html(mediaListPage([], [], { userEmail: getUserEmail(c) }));
});

// 12/13 — AI Presets read-only list.
adminUi.get('/admin/presets', (c) => {
  return c.html(presetsListPage([], { userEmail: getUserEmail(c) }));
});

// 13/13 — Settings (per-site editor, 12 canonical keys). The
// `site_id` query param drives the initially selected site so the
// editor opens directly against a chosen site when linked from
// elsewhere in admin.
adminUi.get('/admin/settings', (c) => {
  const selectedSiteId = c.req.query('site_id') ?? null;
  return c.html(
    settingsPage([], {}, selectedSiteId, { userEmail: getUserEmail(c) }),
  );
});

// adminLayout is imported above so the editor barrel is exercised at
// type-check time even though the per-route handlers above call the
// higher-level page renderers (each of which wraps adminLayout
// internally). Keeping the symbol in scope here documents the
// contract that every admin GET MUST flow through adminLayout.
void adminLayout;
