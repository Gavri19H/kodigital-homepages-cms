// Listicles admin UI shell routes (design contract §4).
//
// Registered on `listicleUi` and mounted from src/admin/router.ts right next
// to the main adminUi — so the existing `accessAuth` gate on /admin/* and the
// index.ts ADMIN_HOST 404 wall both apply unchanged (§24). Routes:
//
//   GET /admin/listicles           → 302 /admin/listicles/offers
//   GET /admin/listicles/offers    → Offers list + analytics + Create-Offer modal
//   GET /admin/listicles/sections  → Sections list + analytics (list-only, Phase 4 note)
//   GET /admin/listicles/articles  → Articles list, site-scoped (list-only, Phase 5 note)
//
// The §4 sections|articles /new|/:id/edit shell routes are deliberately NOT
// registered this phase — the Section editor is Phase 4 and the Article
// builder is Phase 5 (§27); registering them now would create dead surfaces.
//
// Data access: the management columns render server-side (§8) by driving the
// Phase-2 JSON API in-process (`listicleApi.request(...)` — the exact same
// query code the XHR surface runs, no duplicated SQL). The only direct SQL
// here is the constant DISTINCT filter-option reads (fixed literals, no user
// input, so there is nothing to .bind()).

import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../../env";
import type { AccessAuthVariables } from "../../auth/access-auth";
import listicleApi from "./router";
import * as data from "../data";
import {
  OFFER_STATUSES,
  SECTION_STATUSES,
} from "../../listicles/validation";
import type { OfferRow } from "./offers-handlers";
import type { Paging } from "./shared";
import { resolveTimeframe } from "./ui-shared";
import { listiclesOffersPage } from "./ui-offers";
import {
  listiclesSectionsPage,
  listiclesArticlesPage,
  type SectionListRow,
  type ArticleListRow,
} from "./ui-lists";
import {
  listiclesSectionEditorPage,
  listiclesSectionNotFoundPage,
  type SectionEditorLinkInstance,
} from "./ui-section-editor";
import {
  listiclesArticleBuilderPage,
  listiclesArticleNotFoundPage,
  type BuilderExperiment,
  type BuilderVersion,
} from "./ui-article-builder";
import type { ArticleRowL } from "./articles-handlers";
import type { SectionRow } from "./sections-handlers";

type AdminEnv = { Bindings: Env; Variables: AccessAuthVariables };
type UiContext = Context<AdminEnv>;

export const listicleUi = new Hono<AdminEnv>();

// §24: the listicles admin surface is `private, no-store` on BOTH rows of the
// table — Phase 2 covered /api/admin/listicles/*; this is the /admin/listicles*
// HTML-shell half (same 3-line pattern as listicles/router.ts). Registered on
// the two explicit path shapes (bare + wildcard — `/admin/listicles/*` does
// not match `/admin/listicles` itself in Hono) so mounting at "/" cannot leak
// the header onto unrelated admin routes.
const shellNoStore = async (
  c: UiContext,
  next: () => Promise<void>,
): Promise<void> => {
  await next();
  c.res.headers.set("Cache-Control", "private, no-store");
  c.res.headers.set("X-Content-Type-Options", "nosniff");
};
listicleUi.use("/admin/listicles", shellNoStore);
listicleUi.use("/admin/listicles/*", shellNoStore);

function branding(c: UiContext): { userEmail?: string } {
  const access = c.get("access");
  const email =
    access && access.mode === "identity" ? access.email : undefined;
  return data.getAdminBranding(email);
}

const EMPTY_PAGING: Paging = {
  page: 1,
  page_size: 25,
  total: 0,
  has_next: false,
  has_prev: false,
};

type ApiResult<T> = { ok: true; body: T } | { ok: false; error: string };

// Drive the Phase-2 admin JSON API in-process. The sub-app is unauthenticated
// by itself (auth is layered on in admin/router.ts), so an internal request
// with the live env exercises the identical handler + SQL path the browser
// XHRs hit.
async function apiJson<T>(env: Env, path: string): Promise<ApiResult<T>> {
  const res = await listicleApi.request(path, {}, env);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.status === 200 && body !== null) {
    return { ok: true, body: body as T };
  }
  const errText =
    body !== null && typeof (body as { error?: unknown }).error === "string"
      ? ((body as { error: string }).error)
      : `Listicles API error (HTTP ${res.status})`;
  return { ok: false, error: errText };
}

function buildQuery(params: Record<string, string>): string {
  const parts: string[] = [];
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value !== undefined && value !== "") {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

function queryParam(c: UiContext, name: string): string {
  return c.req.query(name)?.trim() ?? "";
}

function sanitizeEnum(value: string, allowed: ReadonlyArray<string>): string {
  return allowed.includes(value) ? value : "";
}

function pageParam(c: UiContext): string {
  const raw = c.req.query("page") ?? "";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? String(Math.floor(n)) : "";
}

// DISTINCT filter options for the offers toolbar. `column` is a fixed literal
// from the union below (same pattern as shared.ts:readEntityMetrics); the
// statement carries no user input.
async function distinctOfferValues(
  db: D1Database,
  column: "provider" | "vertical" | "activity",
): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT DISTINCT ${column} AS v FROM listicle_offers ORDER BY v ASC LIMIT 200`,
    )
    .all<{ v: string }>();
  return (result.results ?? [])
    .map((r) => r.v)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
}

// §4: bare /admin/listicles lands on the Offers tab.
listicleUi.get("/admin/listicles", (c) =>
  c.redirect("/admin/listicles/offers", 302),
);

// §9: Offers tab — list + analytics + "Create an Offer".
listicleUi.get("/admin/listicles/offers", async (c) => {
  const timeframe = resolveTimeframe(c.req.query("range"));
  const filters = {
    search: queryParam(c, "search"),
    provider: queryParam(c, "provider"),
    vertical: queryParam(c, "vertical"),
    activity: queryParam(c, "activity"),
    status: sanitizeEnum(queryParam(c, "status"), OFFER_STATUSES),
    range: timeframe.key,
  };
  const qs = buildQuery({
    search: filters.search,
    provider: filters.provider,
    vertical: filters.vertical,
    activity: filters.activity,
    status: filters.status,
    page: pageParam(c),
  });
  const listed = await apiJson<{ offers: OfferRow[]; paging: Paging }>(
    c.env,
    `/api/admin/listicles/offers${qs}`,
  );
  const filterOptions = {
    providers: await distinctOfferValues(c.env.DB, "provider"),
    verticals: await distinctOfferValues(c.env.DB, "vertical"),
    activities: await distinctOfferValues(c.env.DB, "activity"),
  };
  return c.html(
    listiclesOffersPage(
      {
        offers: listed.ok ? listed.body.offers : [],
        paging: listed.ok ? listed.body.paging : EMPTY_PAGING,
        filters,
        filterOptions,
        timeframe,
        loadError: listed.ok ? null : listed.error,
      },
      branding(c),
    ),
  );
});

// §4/§10 Phase 4: the Section rich editor shell routes (replacing the
// Phase-3 disabled Create button — Sections only; Articles stay Phase 5).
listicleUi.get("/admin/listicles/sections/new", (c) =>
  c.html(
    listiclesSectionEditorPage({ mode: "new", section: null, linkInstances: [] }, branding(c)),
  ),
);

listicleUi.get("/admin/listicles/sections/:id/edit", async (c) => {
  const idParam = c.req.param("id") ?? "";
  const got = await apiJson<{
    section: SectionRow;
    link_instances: SectionEditorLinkInstance[];
  }>(c.env, `/api/admin/listicles/sections/${encodeURIComponent(idParam)}`);
  if (!got.ok) {
    return c.html(listiclesSectionNotFoundPage(branding(c)), 404);
  }
  return c.html(
    listiclesSectionEditorPage(
      {
        mode: "edit",
        section: got.body.section,
        linkInstances: got.body.link_instances ?? [],
      },
      branding(c),
    ),
  );
});

// §10: Sections tab — list + analytics (list-only this phase).
listicleUi.get("/admin/listicles/sections", async (c) => {
  const timeframe = resolveTimeframe(c.req.query("range"));
  const filters = {
    search: queryParam(c, "search"),
    status: sanitizeEnum(queryParam(c, "status"), SECTION_STATUSES),
    range: timeframe.key,
  };
  const qs = buildQuery({
    search: filters.search,
    status: filters.status,
    page: pageParam(c),
  });
  const listed = await apiJson<{ sections: SectionListRow[]; paging: Paging }>(
    c.env,
    `/api/admin/listicles/sections${qs}`,
  );
  return c.html(
    listiclesSectionsPage(
      {
        sections: listed.ok ? listed.body.sections : [],
        paging: listed.ok ? listed.body.paging : EMPTY_PAGING,
        filters,
        timeframe,
        loadError: listed.ok ? null : listed.error,
      },
      branding(c),
    ),
  );
});

// §4/§11 Phase 5: the Article builder shell routes (replacing the Phase-3
// disabled Create button). /new registers before /:id/edit (static-vs-param).
listicleUi.get("/admin/listicles/articles/new", async (c) => {
  const sites = await data.listAdminSites(c.env);
  return c.html(
    listiclesArticleBuilderPage(
      { mode: "new", sites, article: null, experiment: null, versions: [] },
      branding(c),
    ),
  );
});

listicleUi.get("/admin/listicles/articles/:id/edit", async (c) => {
  const idParam = c.req.param("id") ?? "";
  const got = await apiJson<{
    article: ArticleRowL;
    experiment: BuilderExperiment | null;
    versions: BuilderVersion[];
  }>(c.env, `/api/admin/listicles/articles/${encodeURIComponent(idParam)}/structure`);
  if (!got.ok) {
    return c.html(listiclesArticleNotFoundPage(branding(c)), 404);
  }
  const sites = await data.listAdminSites(c.env);
  return c.html(
    listiclesArticleBuilderPage(
      {
        mode: "edit",
        sites,
        article: got.body.article,
        experiment: got.body.experiment ?? null,
        versions: got.body.versions ?? [],
      },
      branding(c),
    ),
  );
});

// §11: Articles tab — site-scoped list + analytics. Site resolution mirrors
// admin/ui.ts: explicit ?site_id= wins, else the first available site; with
// no sites at all the "Site is required" gate renders instead of the table.
// ?search= (name/slug) passes through to the Phase-2 list API (DEV-10).
listicleUi.get("/admin/listicles/articles", async (c) => {
  const timeframe = resolveTimeframe(c.req.query("range"));
  const sites = await data.listAdminSites(c.env);
  const explicit = queryParam(c, "site_id");
  const firstSite = sites[0];
  const selectedSiteId =
    explicit !== ""
      ? explicit
      : firstSite !== undefined
        ? firstSite.id
        : null;
  const search = queryParam(c, "search");

  if (selectedSiteId === null) {
    return c.html(
      listiclesArticlesPage(
        {
          articles: [],
          paging: EMPTY_PAGING,
          sites,
          selectedSiteId: null,
          search,
          range: timeframe.key,
          timeframe,
          loadError: null,
        },
        branding(c),
      ),
    );
  }

  const qs = buildQuery({ site_id: selectedSiteId, search, page: pageParam(c) });
  const listed = await apiJson<{ articles: ArticleListRow[]; paging: Paging }>(
    c.env,
    `/api/admin/listicles/articles${qs}`,
  );
  return c.html(
    listiclesArticlesPage(
      {
        articles: listed.ok ? listed.body.articles : [],
        paging: listed.ok ? listed.body.paging : EMPTY_PAGING,
        sites,
        selectedSiteId,
        search,
        range: timeframe.key,
        timeframe,
        loadError: listed.ok ? null : listed.error,
      },
      branding(c),
    ),
  );
});
