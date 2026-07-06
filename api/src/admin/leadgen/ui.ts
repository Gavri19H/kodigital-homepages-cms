// LeadGen admin UI shell routes (contract 01 §5 / 03 §9 — Phase-3 shells).
//
// Registered on `leadgenUi` and mounted from src/admin/router.ts right next
// to the listicles UI — so the existing `accessAuth` gate on /admin/* and
// the index.ts ADMIN_HOST 404 wall both apply unchanged (03 §9.1). Routes:
//
//   GET /admin/leadgen           → 302 /admin/leadgen/offers (01 §5.2)
//   GET /admin/leadgen/offers    → Offers list scaffold (03 §9.2)
//   GET /admin/leadgen/sections  → Sections list scaffold (03 §9.3)
//   GET /admin/leadgen/quotes    → Quotes list scaffold (03 §9.4)
//   GET /admin/leadgen/auction   → Auction list scaffold (03 §9.5 — the tab
//                                  path is SINGULAR per contract 01 §5.2)
//
// The 01 §5.2 /new|/:id/edit editor shells are deliberately NOT registered
// this phase — each entity's editor/modal ships in that entity's own phase,
// so the Create buttons render disabled with a visible phase note (the
// listicles Phase-3 pattern; no dead routes, no fake surfaces).
//
// Data access: the list scaffolds render server-side by driving the Phase-3
// JSON API in-process (`leadgenApi.request(...)` — the exact same handler +
// SQL path the XHR surface runs, no duplicated SQL). Derived columns
// (placements, counts) and analytics columns render as em-dashes until their
// endpoints ship.

import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../../env";
import type { AccessAuthVariables } from "../../auth/access-auth";
import leadgenApi, { type Paging } from "./router";
import * as data from "../data";
import {
  adminLayout,
  escapeHtml,
  renderListPager,
} from "../templates/layout";
import type {
  LeadgenOfferApi,
  LeadgenSectionApi,
  LeadgenQuoteApi,
  LeadgenAuctionApi,
} from "./db-types";

type AdminEnv = { Bindings: Env; Variables: AccessAuthVariables };
type UiContext = Context<AdminEnv>;

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

// Drive the Phase-3 admin JSON API in-process. The sub-app is unauthenticated
// by itself (auth is layered on in admin/router.ts), so an internal request
// with the live env exercises the identical handler + SQL path the browser
// XHRs hit.
async function apiJson<T>(env: Env, path: string): Promise<ApiResult<T>> {
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

function pageParam(c: UiContext): string {
  const raw = c.req.query("page") ?? "";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? String(Math.floor(n)) : "";
}

function pageQuery(page: string): string {
  return page !== "" ? `?page=${encodeURIComponent(page)}` : "";
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
function renderLeadgenTabs(active: LeadgenTab): string {
  const items = TABS.map((t) => {
    const cls = t.key === active ? "leadgen-tab active" : "leadgen-tab";
    const aria = t.key === active ? ' aria-current="page"' : "";
    return `<a href="${t.href}" class="${cls}"${aria}>${escapeHtml(t.label)}</a>`;
  }).join("");
  return `<nav class="leadgen-tabs" aria-label="LeadGen sections">${items}</nav>`;
}

const LEADGEN_STYLES = `
.leadgen-tabs{display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid var(--c-border)}
.leadgen-tab{padding:8px 16px;color:var(--c-muted);font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px}
.leadgen-tab:hover{color:var(--c-text);text-decoration:none}
.leadgen-tab.active{color:var(--c-primary);border-bottom-color:var(--c-primary)}
.lg-num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.lg-phase-note{align-self:center}
`;

// Shared status-badge class mapping (layout.ts badge palette).
function statusBadge(status: string): string {
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

// 03 §9.1: Create button top-left, disabled this phase (each editor ships in
// its entity's own phase), above the toolbar-filters placeholder that the
// analytics filter row + timeframe control fill in later phases.
function renderToolbar(createLabel: string, phaseNote: string): string {
  return `<div class="toolbar">
  <button type="button" class="btn btn-primary" disabled aria-disabled="true" title="${escapeHtml(phaseNote)}">+ ${escapeHtml(createLabel)}</button>
  <span class="form-help lg-phase-note">${escapeHtml(phaseNote)}</span>
  <div class="toolbar-filters"></div>
</div>`;
}

interface ListColumn {
  label: string;
  numeric?: boolean;
}

function renderHeaderCells(columns: ReadonlyArray<ListColumn>): string {
  return columns
    .map((col) => {
      const cls = col.numeric === true ? ' class="lg-num"' : "";
      return `<th scope="col"${cls}>${escapeHtml(col.label)}</th>`;
    })
    .join("");
}

const EM_DASH = "—";

function dashCell(numeric: boolean): string {
  return numeric ? `<td class="lg-num">${EM_DASH}</td>` : `<td>${EM_DASH}</td>`;
}

function dashCells(count: number): string {
  return new Array<string>(count).fill(dashCell(true)).join("");
}

interface ListTableProps {
  tableClass: string;
  ariaLabel: string;
  columns: ReadonlyArray<ListColumn>;
  rows: ReadonlyArray<string>;
  emptyEntity: string;
  phaseNote: string;
}

// Shared list-scaffold card: §9 column headers + rows (zero rows until the
// entity's create surface ships) + the listicles empty-state pattern.
function renderListTable(props: ListTableProps): string {
  const empty = `<div class="empty-state"><p>No ${escapeHtml(props.emptyEntity)} yet.</p><p class="form-help">${escapeHtml(props.phaseNote)}.</p></div>`;
  const rows =
    props.rows.length === 0
      ? `<tr><td colspan="${props.columns.length}">${empty}</td></tr>`
      : props.rows.join("");
  return `<div class="card">
  <div class="table-wrapper">
    <table class="table ${props.tableClass}" aria-label="${escapeHtml(props.ariaLabel)}">
      <thead><tr>${renderHeaderCells(props.columns)}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>`;
}

interface LeadgenBranding {
  userEmail?: string;
}

interface TabPageProps {
  tab: LeadgenTab;
  createLabel: string;
  phaseNote: string;
  table: string;
  paging: Paging;
  page: string;
  loadError: string | null;
}

function leadgenTabPage(props: TabPageProps, brand: LeadgenBranding): string {
  const loadErrorHtml = props.loadError
    ? `<p class="alert alert-error" role="alert">${escapeHtml(props.loadError)}</p>`
    : "";
  const pager = renderListPager(
    {
      page: props.paging.page,
      per_page: props.paging.page_size,
      total: props.paging.total,
    },
    { page: props.page },
  );
  const content = `${renderLeadgenTabs(props.tab)}
${loadErrorHtml}
${renderToolbar(props.createLabel, props.phaseNote)}
${props.table}
${pager}`;
  return adminLayout({
    title: "LeadGen",
    activePath: `/admin/leadgen/${props.tab}`,
    userEmail: brand.userEmail,
    content,
    styles: LEADGEN_STYLES,
  });
}

// ---------------------------------------------------------------------------
// Offers tab (03 §9.2 list columns)
// ---------------------------------------------------------------------------

const OFFER_COLUMNS: ReadonlyArray<ListColumn> = [
  { label: "Name" },
  { label: "Placement ID" },
  { label: "Provider" },
  { label: "Vertical / Activity" },
  { label: "Type" },
  { label: "Dynamic/Static" },
  { label: "Cap" },
  { label: "Status" },
  { label: "Impressions", numeric: true },
  { label: "Clicks", numeric: true },
  { label: "CTR", numeric: true },
  { label: "Conversions", numeric: true },
  { label: "CVR", numeric: true },
  { label: "Revenue", numeric: true },
  { label: "RPC", numeric: true },
  { label: "RPM", numeric: true },
  { label: "Actions" },
];

function renderOfferRow(o: LeadgenOfferApi): string {
  return `<tr data-entity-id="${o.id}" data-entity-name="${escapeHtml(o.offer_name)}">
  <td>${escapeHtml(o.offer_name)}</td>
  ${dashCell(false)}
  <td>${o.provider !== null ? escapeHtml(o.provider) : EM_DASH}</td>
  <td>${escapeHtml(o.vertical)} / ${escapeHtml(o.activity)}</td>
  <td>${escapeHtml(o.offer_type)}</td>
  <td><span class="badge badge-draft">${o.bid_source === "response" ? "Dynamic" : "Static"}</span></td>
  <td>${o.cap_enabled ? '<span class="badge badge-scheduled">Cap</span>' : EM_DASH}</td>
  <td>${statusBadge(o.status)}</td>
  ${dashCells(8)}
  <td>${EM_DASH}</td>
</tr>`;
}

// ---------------------------------------------------------------------------
// Sections tab (03 §9.3 list columns)
// ---------------------------------------------------------------------------

const SECTION_COLUMNS: ReadonlyArray<ListColumn> = [
  { label: "Name" },
  { label: "Activity / Vertical" },
  { label: "Questions", numeric: true },
  { label: "Mapped Offers", numeric: true },
  { label: "Mapping completeness" },
  { label: "Status" },
  { label: "Views", numeric: true },
  { label: "Continue rate", numeric: true },
  { label: "Validation-error rate", numeric: true },
  { label: "Actions" },
];

function renderSectionRow(s: LeadgenSectionApi): string {
  return `<tr data-entity-id="${s.id}" data-entity-name="${escapeHtml(s.section_name)}">
  <td>${escapeHtml(s.section_name)}</td>
  <td>${escapeHtml(s.activity)} / ${escapeHtml(s.vertical)}</td>
  ${dashCells(2)}
  ${dashCell(false)}
  <td>${statusBadge(s.status)}</td>
  ${dashCells(3)}
  <td>${EM_DASH}</td>
</tr>`;
}

// ---------------------------------------------------------------------------
// Quotes tab (03 §9.4 list columns)
// ---------------------------------------------------------------------------

const QUOTE_COLUMNS: ReadonlyArray<ListColumn> = [
  { label: "Name" },
  { label: "Activity" },
  { label: "Verticals" },
  { label: "Variants", numeric: true },
  { label: "A/B status" },
  { label: "Active sites", numeric: true },
  { label: "Visits", numeric: true },
  { label: "Completion rate", numeric: true },
  { label: "Avg RPS", numeric: true },
  { label: "Unfilled rate", numeric: true },
  { label: "Revenue", numeric: true },
  { label: "Actions" },
];

function quoteVerticals(q: LeadgenQuoteApi): string {
  return Array.isArray(q.verticals_json)
    ? q.verticals_json.filter((v): v is string => typeof v === "string").join(", ")
    : EM_DASH;
}

function renderQuoteRow(q: LeadgenQuoteApi): string {
  return `<tr data-entity-id="${q.id}" data-entity-name="${escapeHtml(q.quote_name)}">
  <td>${escapeHtml(q.quote_name)}</td>
  <td>${escapeHtml(q.activity)}</td>
  <td>${escapeHtml(quoteVerticals(q))}</td>
  ${dashCell(true)}
  ${dashCell(false)}
  ${dashCells(6)}
  <td>${EM_DASH}</td>
</tr>`;
}

// ---------------------------------------------------------------------------
// Auction tab (03 §9.5 list columns)
// ---------------------------------------------------------------------------

const AUCTION_COLUMNS: ReadonlyArray<ListColumn> = [
  { label: "Name" },
  { label: "Quote" },
  { label: "Type" },
  { label: "Winner logic" },
  { label: "Offers", numeric: true },
  { label: "Multi-offer / Backfill" },
  { label: "Auctions", numeric: true },
  { label: "Fill rate", numeric: true },
  { label: "Avg imp/auction", numeric: true },
  { label: "Avg bid", numeric: true },
  { label: "Avg RPC", numeric: true },
  { label: "Revenue", numeric: true },
  { label: "Actions" },
];

function renderAuctionRow(a: LeadgenAuctionApi): string {
  return `<tr data-entity-id="${a.id}" data-entity-name="${escapeHtml(a.auction_name)}">
  <td>${escapeHtml(a.auction_name)}</td>
  ${dashCell(false)}
  <td>${escapeHtml(a.auction_type)}</td>
  <td>${escapeHtml(a.winner_logic)}</td>
  ${dashCell(true)}
  <td>${escapeHtml(a.multi_offer)} / ${escapeHtml(a.backfill)}</td>
  ${dashCells(6)}
  <td>${EM_DASH}</td>
</tr>`;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// 01 §5.2: bare /admin/leadgen lands on the Offers tab.
leadgenUi.get("/admin/leadgen", (c) =>
  c.redirect("/admin/leadgen/offers", 302),
);

interface ListBody<T> {
  items: T[];
  paging: Paging;
}

leadgenUi.get("/admin/leadgen/offers", async (c) => {
  const page = pageParam(c);
  const listed = await apiJson<ListBody<LeadgenOfferApi>>(
    c.env,
    `/api/admin/leadgen/offers${pageQuery(page)}`,
  );
  return c.html(
    leadgenTabPage(
      {
        tab: "offers",
        createLabel: "Create an Offer",
        phaseNote: "Offer editor ships in a later phase",
        table: renderListTable({
          tableClass: "leadgen-offers-list",
          ariaLabel: "Offers list",
          columns: OFFER_COLUMNS,
          rows: (listed.ok ? listed.body.items : []).map(renderOfferRow),
          emptyEntity: "offers",
          phaseNote: "Offer editor ships in a later phase",
        }),
        paging: listed.ok ? listed.body.paging : EMPTY_PAGING,
        page,
        loadError: listed.ok ? null : listed.error,
      },
      branding(c),
    ),
  );
});

leadgenUi.get("/admin/leadgen/sections", async (c) => {
  const page = pageParam(c);
  const listed = await apiJson<ListBody<LeadgenSectionApi>>(
    c.env,
    `/api/admin/leadgen/sections${pageQuery(page)}`,
  );
  return c.html(
    leadgenTabPage(
      {
        tab: "sections",
        createLabel: "Create a Section",
        phaseNote: "Section editor ships in a later phase",
        table: renderListTable({
          tableClass: "leadgen-sections-list",
          ariaLabel: "Sections list",
          columns: SECTION_COLUMNS,
          rows: (listed.ok ? listed.body.items : []).map(renderSectionRow),
          emptyEntity: "sections",
          phaseNote: "Section editor ships in a later phase",
        }),
        paging: listed.ok ? listed.body.paging : EMPTY_PAGING,
        page,
        loadError: listed.ok ? null : listed.error,
      },
      branding(c),
    ),
  );
});

leadgenUi.get("/admin/leadgen/quotes", async (c) => {
  const page = pageParam(c);
  const listed = await apiJson<ListBody<LeadgenQuoteApi>>(
    c.env,
    `/api/admin/leadgen/quotes${pageQuery(page)}`,
  );
  return c.html(
    leadgenTabPage(
      {
        tab: "quotes",
        createLabel: "Create a Quote",
        phaseNote: "Quote editor ships in a later phase",
        table: renderListTable({
          tableClass: "leadgen-quotes-list",
          ariaLabel: "Quotes list",
          columns: QUOTE_COLUMNS,
          rows: (listed.ok ? listed.body.items : []).map(renderQuoteRow),
          emptyEntity: "quotes",
          phaseNote: "Quote editor ships in a later phase",
        }),
        paging: listed.ok ? listed.body.paging : EMPTY_PAGING,
        page,
        loadError: listed.ok ? null : listed.error,
      },
      branding(c),
    ),
  );
});

// The Auction tab path is SINGULAR (01 §5.2); it drives the plural
// /api/admin/leadgen/auctions entity endpoint (03 §8.2).
leadgenUi.get("/admin/leadgen/auction", async (c) => {
  const page = pageParam(c);
  const listed = await apiJson<ListBody<LeadgenAuctionApi>>(
    c.env,
    `/api/admin/leadgen/auctions${pageQuery(page)}`,
  );
  return c.html(
    leadgenTabPage(
      {
        tab: "auction",
        createLabel: "Create an Auction",
        phaseNote: "Auction editor ships in a later phase",
        table: renderListTable({
          tableClass: "leadgen-auctions-list",
          ariaLabel: "Auctions list",
          columns: AUCTION_COLUMNS,
          rows: (listed.ok ? listed.body.items : []).map(renderAuctionRow),
          emptyEntity: "auctions",
          phaseNote: "Auction editor ships in a later phase",
        }),
        paging: listed.ok ? listed.body.paging : EMPTY_PAGING,
        page,
        loadError: listed.ok ? null : listed.error,
      },
      branding(c),
    ),
  );
});
