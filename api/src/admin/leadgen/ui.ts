// LeadGen admin UI shell routes (contract 01 §5 / 03 §9).
//
// Registered on `leadgenUi` and mounted from src/admin/router.ts right next
// to the listicles UI — so the existing `accessAuth` gate on /admin/* and
// the index.ts ADMIN_HOST 404 wall both apply unchanged (03 §9.1). Routes:
//
//   GET /admin/leadgen                 → 302 /admin/leadgen/offers (01 §5.2)
//   GET /admin/leadgen/offers          → Offers list + create modal +
//                                        analytics (03 §9.2 — LIVE, Phase-4
//                                        Stage B2; ui-offers.ts)
//   GET /admin/leadgen/offers/new      → the list with the create modal
//                                        auto-open (01 §5.2; static BEFORE
//                                        the :id param sibling)
//   GET /admin/leadgen/offers/:id/edit → the full-page offer editor
//   GET /admin/leadgen/sections        → Sections list scaffold (03 §9.3)
//   GET /admin/leadgen/quotes          → Quotes list scaffold (03 §9.4)
//   GET /admin/leadgen/auction         → Auction list scaffold (03 §9.5 —
//                                        the tab path is SINGULAR per 01 §5.2)
//
// The sections/quotes/auction /new|/:id/edit editor shells are deliberately
// NOT registered — each remaining entity's editor/modal ships in that
// entity's own phase, so those Create buttons render disabled with a visible
// phase note (the listicles Phase-3 pattern; no dead routes, no fake
// surfaces).
//
// Data access: pages render server-side by driving the JSON API in-process
// (`leadgenApi.request(...)` — the exact same handler + SQL path the XHR
// surface runs, no duplicated SQL). Scaffold analytics columns render as
// em-dashes until their endpoints ship; the live Offers list hydrates its
// analytics columns after paint (03 §9.1).

import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../../env";
import type { AccessAuthVariables } from "../../auth/access-auth";
import leadgenApi, { type Paging } from "./router";
import * as data from "../data";
import {
  adminLayout,
  escapeHtml,
} from "../templates/layout";
import {
  leadgenOffersListPage,
  leadgenOffersNewPage,
  leadgenOfferEditorPage,
} from "./ui-offers";
import {
  leadgenSectionsListPage,
  leadgenSectionsNewPage,
  leadgenSectionEditorPage,
} from "./ui-sections";
// v3.1 §10 (Concern 2) — Themes manager, Phase D. Reachable from the Section
// Builder's "Manage theme →" / "Preview theme:" affordances (§10.2); a
// standalone full page, not a tab of its own.
import { leadgenThemeManagerPage } from "./ui-theme-manager";
import {
  leadgenQuotesListPage,
  leadgenQuotesNewPage,
  leadgenQuoteEditorPage,
} from "./ui-quotes";
import {
  leadgenAuctionsListPage,
  leadgenAuctionsNewPage,
  leadgenAuctionEditorPage,
} from "./ui-auctions";

export type AdminEnv = { Bindings: Env; Variables: AccessAuthVariables };
export type UiContext = Context<AdminEnv>;

export const leadgenUi = new Hono<AdminEnv>();

// 03 §9.1: the leadgen admin surface is `private, no-store` on BOTH rows of
// the table — router.ts covers /api/admin/leadgen/*; this is the
// /admin/leadgen* HTML-shell half (same 3-line pattern). Registered on the
// two explicit path shapes (bare + wildcard — `/admin/leadgen/*` does not
// match `/admin/leadgen` itself in Hono) so mounting at "/" cannot leak the
// header onto unrelated admin routes.
const shellNoStore = async (
  c: UiContext,
  next: () => Promise<void>,
): Promise<void> => {
  await next();
  c.res.headers.set("Cache-Control", "private, no-store");
  c.res.headers.set("X-Content-Type-Options", "nosniff");
};
leadgenUi.use("/admin/leadgen", shellNoStore);
leadgenUi.use("/admin/leadgen/*", shellNoStore);

export function branding(c: UiContext): { userEmail?: string } {
  const access = c.get("access");
  const email =
    access && access.mode === "identity" ? access.email : undefined;
  return data.getAdminBranding(email);
}

export const EMPTY_PAGING: Paging = {
  page: 1,
  page_size: 25,
  total: 0,
  has_next: false,
  has_prev: false,
};

export type ApiResult<T> = { ok: true; body: T } | { ok: false; error: string };

// Drive the admin JSON API in-process. The sub-app is unauthenticated by
// itself (auth is layered on in admin/router.ts), so an internal request
// with the live env exercises the identical handler + SQL path the browser
// XHRs hit. Non-GET calls pass an init (the offers editor SSR never needs
// one — mutations stay browser-side).
export async function apiJson<T>(env: Env, path: string): Promise<ApiResult<T>> {
  const res = await leadgenApi.request(path, {}, env);
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
      : `LeadGen API error (HTTP ${res.status})`;
  return { ok: false, error: errText };
}

export function pageParam(c: UiContext): string {
  const raw = c.req.query("page") ?? "";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? String(Math.floor(n)) : "";
}

// ---------------------------------------------------------------------------
// Shared tab-shell building blocks (03 §9.1)
// ---------------------------------------------------------------------------

type LeadgenTab = "offers" | "sections" | "quotes" | "auction";

const TABS: ReadonlyArray<{ key: LeadgenTab; href: string; label: string }> = [
  { key: "offers", href: "/admin/leadgen/offers", label: "Offers" },
  { key: "sections", href: "/admin/leadgen/sections", label: "Sections" },
  { key: "quotes", href: "/admin/leadgen/quotes", label: "Quotes" },
  { key: "auction", href: "/admin/leadgen/auction", label: "Auction" },
];

// 01 §5.2 / 03 §9.1: four sub-tabs — Offers · Sections · Quotes · Auction.
export function renderLeadgenTabs(active: LeadgenTab): string {
  const items = TABS.map((t) => {
    const cls = t.key === active ? "leadgen-tab active" : "leadgen-tab";
    const aria = t.key === active ? ' aria-current="page"' : "";
    return `<a href="${t.href}" class="${cls}"${aria}>${escapeHtml(t.label)}</a>`;
  }).join("");
  return `<nav class="leadgen-tabs" aria-label="LeadGen sections">${items}</nav>`;
}

export const LEADGEN_STYLES = `
.leadgen-tabs{display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid var(--c-border)}
.leadgen-tab{padding:8px 16px;color:var(--c-muted);font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px}
.leadgen-tab:hover{color:var(--c-text);text-decoration:none}
.leadgen-tab.active{color:var(--c-primary);border-bottom-color:var(--c-primary)}
.lg-num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.lg-phase-note{align-self:center}
`;

// One adminLayout wrapper for every LeadGen page (title + base styles) —
// ui-offers.ts composes page-specific styles/scripts on top.
export function leadgenPageShell(options: {
  activePath: string;
  userEmail?: string;
  content: string;
  styles?: string;
  scripts?: string;
}): string {
  return adminLayout({
    title: "LeadGen",
    activePath: options.activePath,
    userEmail: options.userEmail,
    content: options.content,
    styles: LEADGEN_STYLES + (options.styles ?? ""),
    scripts: options.scripts ?? "",
  });
}

// Shared status-badge class mapping (layout.ts badge palette).
export function statusBadge(status: string): string {
  const cls =
    status === "active"
      ? "badge badge-published"
      : status === "paused"
        ? "badge badge-scheduled"
        : status === "archived"
          ? "badge badge-archived"
          : "badge badge-draft";
  return `<span class="${cls}">${escapeHtml(status)}</span>`;
}

// Phase-3 list scaffolding (renderToolbar / renderListTable / leadgenTabPage +
// the per-tab column tables) is retired: all four tabs are now LIVE with their
// own list pages (ui-offers / ui-sections / ui-quotes / ui-auctions). EM_DASH
// stays — the live list renderers import it.
export const EM_DASH = "—";

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// 01 §5.2: bare /admin/leadgen lands on the Offers tab.
leadgenUi.get("/admin/leadgen", (c) =>
  c.redirect("/admin/leadgen/offers", 302),
);

export interface ListBody<T> {
  items: T[];
  paging: Paging;
}

// Offers tab — LIVE (Phase-4 Stage B2, contract 03 §9.2 / 04 §10–§11).
// Editor shells registered static-before-param (01 §5.2): /offers/new
// precedes /offers/:id/edit.
leadgenUi.get("/admin/leadgen/offers", leadgenOffersListPage);
leadgenUi.get("/admin/leadgen/offers/new", leadgenOffersNewPage);
leadgenUi.get("/admin/leadgen/offers/:id/edit", leadgenOfferEditorPage);

// Sections tab — LIVE (Phase-5 Stage B, contract 03 §9.3 / 05 §12–§14).
// Editor shells registered static-before-param (01 §5.2): /sections/new
// precedes /sections/:id/edit.
leadgenUi.get("/admin/leadgen/sections", leadgenSectionsListPage);
leadgenUi.get("/admin/leadgen/sections/new", leadgenSectionsNewPage);
leadgenUi.get("/admin/leadgen/sections/:id/edit", leadgenSectionEditorPage);

// Themes manager — LIVE (Phase D, contract v3.1 §10). Standalone page, not a
// tab: reached from the Section Builder, never from the top-level nav.
leadgenUi.get("/admin/leadgen/themes", leadgenThemeManagerPage);

// Quotes tab — LIVE (Phase-7 Stage B, contract 03 §9.4 / 06 §15–§17).
// Editor shells registered static-before-param (01 §5.2): /quotes/new precedes
// /quotes/:id/edit.
leadgenUi.get("/admin/leadgen/quotes", leadgenQuotesListPage);
leadgenUi.get("/admin/leadgen/quotes/new", leadgenQuotesNewPage);
leadgenUi.get("/admin/leadgen/quotes/:id/edit", leadgenQuoteEditorPage);

// Auction tab — LIVE (Phase-9 Stage B, contract 03 §9.5 / 07 §18–§21). The tab
// path is SINGULAR /admin/leadgen/auction (01 §5.2) driving the plural
// /api/admin/leadgen/auctions entity endpoint (03 §8.2). Editor shells register
// static-before-param (01 §5.2): /auction/new precedes /auction/:id/edit.
leadgenUi.get("/admin/leadgen/auction", leadgenAuctionsListPage);
leadgenUi.get("/admin/leadgen/auction/new", leadgenAuctionsNewPage);
leadgenUi.get("/admin/leadgen/auction/:id/edit", leadgenAuctionEditorPage);
