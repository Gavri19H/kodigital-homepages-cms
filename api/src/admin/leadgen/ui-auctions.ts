// LeadGen admin UI — the contract 03 §9.5 **Auction** tab (Phase 9 Stage B):
// the LIST (Create + filters + timeframe + §18.9 analytics columns) and the
// full-page EDITOR (Settings / Participating Offers / Rules / Banner builder /
// Simulator[P10 placeholder] / Analytics).
//
// Server-rendered; every page drives the JSON API in-process via apiJson (the
// exact handler + SQL the XHR surface hits — no duplicated SQL). Inline scripts
// are strict ES5 (no arrow/const/let/async/await/backtick — leadgen-auctions-
// ui.test.ts token-scans + node --checks them). All author/API text is
// escapeHtml-escaped; the editor carries an unsaved-changes guard. The tab path
// is SINGULAR /admin/leadgen/auction (01 §5.2) driving the plural /auctions API.

import {
  escapeHtml,
  renderListPager,
  listFilterScript,
  renderKebabOpen,
  KEBAB_CLOSE,
  kebabMenuScript,
} from "../templates/layout";
import { resolveTimeframe, renderTimeframeSelect, type Timeframe } from "../listicles/ui-shared";
import {
  apiJson,
  branding,
  EMPTY_PAGING,
  leadgenPageShell,
  pageParam,
  renderLeadgenTabs,
  statusBadge,
  type ListBody,
  type UiContext,
} from "./ui";
import type { Paging } from "./router";
import { CANONICAL_CARRIER_FIELDS } from "../../public/leadgen/designs/banner-default/styles";
import { BANNER_DESIGNS } from "../../public/leadgen/designs/registry";
import { LEADGEN_ELIGIBILITY_REASON_LABELS } from "./ui-offers";
import type { LeadgenAuctionApi, LeadgenAuctionRuleApi } from "./db-types";
// Rework §13-D5: the four auction-domain funnel-rule types' editor is RELOCATED
// to the Auction tab via the NEW self-contained, REST-driven
// renderRelocatedRulesEditor/RELOCATED_RULES_SCRIPT (ui-rules-builder.ts) — its
// OWN quote/funnel/variant picker + CRUD wiring against GET/POST
// /variants/:id/rules, PATCH/DELETE /variants/:id/rules/:rule_id, POST
// .../duplicate, reusing the SAME reusable §21.4 condition-builder mount
// (window.lgRulesBuilder / RULES_BUILDER_SCRIPT). §10/S5.1: the ORIGINAL
// per-variant condition-envelope editor this comment used to describe
// (renderRoutingRulesPanel + ROUTING_RULES_SCRIPT) had ZERO real callers left
// in any served page by the time of this removal sweep (the quote/variant
// editor's own concatenation of it targeted DOM the board rewrite had already
// deleted) — it was removed entirely, not "kept because a physical move was
// TDZ-blocked." The relocated editor here was ALREADY the real §13-D5
// replacement; nothing in this file changes as a result.
import {
  RULES_BUILDER_SCRIPT,
  renderRelocatedRulesEditor,
  RELOCATED_RULES_SCRIPT,
  type RelocatedRuleQuote,
} from "./ui-rules-builder";

// ---------------------------------------------------------------------------
// Shared shapes (the API responses this UI consumes)
// ---------------------------------------------------------------------------

interface AuctionListItem extends LeadgenAuctionApi {
  quote_name: string | null;
  quote_public_id: string | null;
  participating_count: number;
}

interface QuoteOption {
  id: number;
  public_id: string;
  quote_name: string;
  activity: string;
  verticals_json: string[] | unknown;
}

interface ParticipatingOffer {
  offer_placement_id: number;
  offer_id: number;
  offer_public_id: string | null;
  offer_name: string | null;
  provider: string | null;
  activity: string | null;
  vertical: string | null;
  offer_type: string | null;
  offer_status: string | null;
  cap_enabled: boolean;
  placement_public_id: string | null;
  placement_external_id: string | null;
  schema_version: number | null;
  last_test_status: string | null;
  static_order: number | null;
  static_bid_override: number | null;
  enabled: boolean;
}

interface BannerConfig {
  auction_id: number;
  mode: string;
  field_map_json: unknown;
  banner_config_json: unknown;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const LG_AUCTIONS_STYLES = `
.lg-editor-head{display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap}
.lg-editor-title{margin:0;font-size:20px}
.lg-editor-pubid{color:var(--c-muted);font-size:12px}
.lg-editor-spacer{flex:1}
.lg-atabs{display:flex;gap:4px;margin:12px 0;border-bottom:1px solid var(--c-border);flex-wrap:wrap}
.lg-atab{padding:8px 14px;color:var(--c-muted);font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px;background:none;border-top:none;border-left:none;border-right:none;cursor:pointer}
.lg-atab.active{color:var(--c-primary);border-bottom-color:var(--c-primary)}
.lg-apanel{display:none}
.lg-apanel.active{display:block}
.lg-scalars{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
@media (max-width:640px){.lg-scalars{grid-template-columns:1fr}}
.lg-floor-input{display:flex;align-items:center;gap:6px}
.lg-affix{color:var(--c-muted);font-weight:600}
.lg-warn{background:var(--c-warn-bg,#fff4e5);color:var(--c-warn,#8a5300);border:1px solid var(--c-warn,#e0a04a);border-radius:6px;padding:10px 12px;margin:8px 0;font-size:13px}
.lg-part-row{display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--c-border);border-radius:6px;margin-bottom:6px;flex-wrap:wrap}
.lg-part-row .lg-grow{flex:1;min-width:140px}
.lg-elig-warn{display:inline-block;background:var(--c-danger-bg,#fdecea);color:var(--c-danger,#8a1f11);border:1px solid var(--c-danger,#e5a49a);border-radius:9999px;padding:2px 10px;font-size:12px}
.lg-static-only{display:none}
.lg-auction-static .lg-static-only{display:inline-flex}
.lg-rule-row{border:1px solid var(--c-border);border-radius:6px;padding:10px;margin-bottom:8px}
.lg-rule-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
@media (max-width:640px){.lg-rule-grid{grid-template-columns:1fr}}
.lg-banner-mode-panel{display:none}
.lg-banner-mode-panel.active{display:block}
.lg-fieldmap-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.lg-fieldmap-row .lg-fieldmap-key{min-width:140px;font-weight:600}
.lg-num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.lg-sim-summary{font-weight:600;margin:10px 0 4px}
.lg-sim-offer{border:1px solid var(--c-border);border-radius:6px;padding:10px 12px;margin:8px 0}
.lg-sim-offer-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px}
.lg-sim-eligible{font-size:12px;padding:2px 10px;border-radius:9999px;background:var(--c-success-bg,#e8f7ee);color:var(--c-success,#186a3b);border:1px solid var(--c-success,#7dcb9a)}
.lg-sim-excluded{font-size:12px;padding:2px 10px;border-radius:9999px;background:var(--c-danger-bg,#fdecea);color:var(--c-danger,#8a1f11);border:1px solid var(--c-danger,#e5a49a)}
.lg-sim-reason{color:var(--c-danger,#8a1f11);font-size:13px;margin:2px 0}
.lg-sim-fields{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:4px 0}
.lg-sim-chip{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;padding:2px 8px;border:1px solid var(--c-border);border-radius:9999px;background:var(--c-bg-alt)}
.lg-sim-payload{background:var(--c-bg-alt,#f5f6f8);border:1px solid var(--c-border);border-radius:6px;padding:10px;font-size:12px;overflow-x:auto;white-space:pre;max-height:280px}
`;

// ---------------------------------------------------------------------------
// List page (03 §9.5)
// ---------------------------------------------------------------------------

interface ListColumn {
  label: string;
  numeric?: boolean;
  metric?: string;
}

const AUCTION_LIST_COLUMNS: ReadonlyArray<ListColumn> = [
  { label: "Name" },
  { label: "Quote" },
  { label: "Type" },
  { label: "Winner logic" },
  { label: "Offers", numeric: true },
  { label: "Multi-offer / Backfill" },
  { label: "Auctions", numeric: true, metric: "auctions" },
  { label: "Fill rate", numeric: true, metric: "fill_rate" },
  { label: "Avg imp/auction", numeric: true, metric: "avg_imp_per_auction" },
  { label: "Avg bid", numeric: true, metric: "avg_bid" },
  { label: "Avg RPC", numeric: true, metric: "avg_rpc" },
  { label: "Revenue", numeric: true, metric: "revenue" },
  { label: "Actions" },
];

const EM_DASH = "—";

function renderAuctionListRow(a: AuctionListItem): string {
  const quoteLabel = a.quote_name ?? EM_DASH;
  const name = escapeHtml(a.auction_name);
  const analyticsCells = AUCTION_LIST_COLUMNS.filter((col) => col.metric !== undefined)
    .map((col) => `<td class="lg-num" data-metric="${escapeHtml(col.metric ?? "")}">${EM_DASH}</td>`)
    .join("");
  // Round-4 A-2 (row R4-02/R4-38): Edit stays a direct link; Usage/Archive-
  // or-Reactivate/Delete move into the shared kebab (renderKebabOpen/
  // KEBAB_CLOSE, layout.ts). No Duplicate — auctions have no duplicate
  // endpoint (router.ts). Archive/Reactivate are the unrestricted PATCH
  // {status} leg (patchAuctionHandler/buildAuctionSettings already accept
  // "status"); Delete is the SEPARATE guarded DELETE /auctions/:id
  // (deleteAuctionHandler 409s "This auction is used by a live funnel
  // variant — archive it instead" when referenced, else it also archives).
  const archiveOrReactivate =
    a.status === "archived"
      ? `<button type="button" class="lg-kebab-item" role="menuitem" data-auction-reactivate="${escapeHtml(a.public_id)}" data-entity-name="${name}">Reactivate</button>`
      : `<button type="button" class="lg-kebab-item lg-kebab-danger" role="menuitem" data-auction-archive="${escapeHtml(a.public_id)}" data-entity-name="${name}">Archive</button>`;
  return `<tr data-entity-id="${escapeHtml(a.public_id)}" data-entity-name="${name}">
  <td>${name}</td>
  <td>${escapeHtml(quoteLabel)}</td>
  <td>${escapeHtml(a.auction_type)}</td>
  <td>${escapeHtml(a.winner_logic)}</td>
  <td class="lg-num">${a.participating_count}</td>
  <td>${escapeHtml(a.multi_offer)} / ${escapeHtml(a.backfill)}</td>
  ${analyticsCells}
  <td><div class="table-actions">
    <a href="/admin/leadgen/auction/${escapeHtml(a.public_id)}/edit" class="btn btn-sm btn-secondary">Edit</a>
    ${renderKebabOpen(name)}<button type="button" class="lg-kebab-item" role="menuitem" data-auction-usage="${escapeHtml(a.public_id)}" aria-expanded="false">Usage</button>
    ${archiveOrReactivate}
    <button type="button" class="lg-kebab-item lg-kebab-danger" role="menuitem" data-auction-delete="${escapeHtml(a.public_id)}" data-entity-name="${name}">Delete</button>${KEBAB_CLOSE}
  </div></td>
</tr>
<tr class="lg-usage-row" data-auction-usage-row="${escapeHtml(a.public_id)}" hidden>
  <td colspan="${AUCTION_LIST_COLUMNS.length}"><div class="lg-usage-panel" data-auction-usage-panel role="status" aria-live="polite"></div></td>
</tr>`;
}

function renderAuctionsToolbar(
  filters: { search: string; type: string; status: string },
  timeframe: Timeframe,
): string {
  const typeOpt = (val: string, label: string): string =>
    `<option value="${escapeHtml(val)}"${val === filters.type ? " selected" : ""}>${escapeHtml(label)}</option>`;
  const statusOpt = (val: string, label: string): string =>
    `<option value="${escapeHtml(val)}"${val === filters.status ? " selected" : ""}>${escapeHtml(label)}</option>`;
  return `<div class="toolbar">
  <a href="/admin/leadgen/auction/new" class="btn btn-primary" data-create-auction>+ Create an Auction</a>
  <form class="toolbar-filters" data-list-filter method="get">
    <input type="search" name="search" class="form-input" placeholder="Search auctions…" value="${escapeHtml(filters.search)}" aria-label="Search auctions" />
    <select name="type" class="form-select" aria-label="Auction type">${typeOpt("", "All types")}${typeOpt("static", "Static")}${typeOpt("dynamic", "Dynamic")}</select>
    <select name="status" class="form-select" aria-label="Status">${statusOpt("", "All statuses")}${statusOpt("active", "Active")}${statusOpt("paused", "Paused")}${statusOpt("archived", "Archived")}</select>
    ${renderTimeframeSelect(timeframe.key)}
  </form>
</div>`;
}

export async function leadgenAuctionsListPage(c: UiContext): Promise<Response> {
  const page = pageParam(c);
  const search = c.req.query("search")?.trim() ?? "";
  const type = c.req.query("type")?.trim() ?? "";
  const status = c.req.query("status")?.trim() ?? "";
  const timeframe = resolveTimeframe(c.req.query("range"));

  const qs = new URLSearchParams();
  if (page !== "") qs.set("page", page);
  if (search !== "") qs.set("search", search);
  if (type !== "") qs.set("type", type);
  if (status !== "") qs.set("status", status);
  const query = qs.toString();

  const listed = await apiJson<ListBody<AuctionListItem>>(
    c.env,
    `/api/admin/leadgen/auctions${query === "" ? "" : `?${query}`}`,
  );

  const items = listed.ok ? listed.body.items : [];
  const paging: Paging = listed.ok ? listed.body.paging : EMPTY_PAGING;
  const rows =
    items.length === 0
      ? `<tr><td colspan="${AUCTION_LIST_COLUMNS.length}"><div class="empty-state"><p>No auctions yet.</p><p class="form-help">Create an Auction to configure winner logic, participating offers, rules, and banners.</p></div></td></tr>`
      : items.map(renderAuctionListRow).join("");

  const headerCells = AUCTION_LIST_COLUMNS.map((col) => {
    const cls = col.numeric === true ? ' class="lg-num"' : "";
    return `<th scope="col"${cls}>${escapeHtml(col.label)}</th>`;
  }).join("");

  const loadErrorHtml = listed.ok
    ? ""
    : `<p class="alert alert-error" role="alert">${escapeHtml(listed.error)}</p>`;

  const content = `${renderLeadgenTabs("auction")}
${loadErrorHtml}
${renderAuctionsToolbar({ search, type, status }, timeframe)}
<div class="card">
  <div class="table-wrapper">
    <table class="table table--sticky-edges leadgen-auctions-list" aria-label="Auctions list" data-lg-analytics data-analytics-from="${escapeHtml(timeframe.from)}" data-analytics-to="${escapeHtml(timeframe.to)}">
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>
${renderListPager({ page: paging.page, per_page: paging.page_size, total: paging.total }, { page })}`;

  return c.html(
    leadgenPageShell({
      activePath: "/admin/leadgen/auction",
      userEmail: branding(c).userEmail,
      content,
      styles: LG_AUCTIONS_STYLES,
      scripts: kebabMenuScript + AUCTION_LIST_SCRIPT + listFilterScript,
    }),
  );
}

const AUCTION_LIST_SCRIPT = `
(function () {
  function fmtInt(v) { var n = Number(v); if (!isFinite(n)) { return '\\u2014'; } return String(Math.round(n)); }
  function fmtMoney(v) { var n = Number(v); if (!isFinite(n)) { return '\\u2014'; } return n.toFixed(2); }
  function fmtPct(v) { var n = Number(v); if (v === null || v === undefined || !isFinite(n)) { return '\\u2014'; } return (n * 100).toFixed(2) + '%'; }

  var FMT = { auctions: 'int', fill_rate: 'pct', avg_imp_per_auction: 'money', avg_bid: 'money', avg_rpc: 'money', revenue: 'money' };
  function cellText(key, value) {
    if (value === null || value === undefined) { return '\\u2014'; }
    var f = FMT[key] || 'money';
    if (f === 'int') { return fmtInt(value); }
    if (f === 'pct') { return fmtPct(value); }
    return fmtMoney(value);
  }

  function clearChildren(el) { while (el.firstChild) { el.removeChild(el.firstChild); } }

  function fillRow(table, row) {
    var id = row.getAttribute('data-entity-id');
    if (!id) { return; }
    var from = table.getAttribute('data-analytics-from') || '';
    var to = table.getAttribute('data-analytics-to') || '';
    var url = '/api/admin/leadgen/auctions/' + encodeURIComponent(id) + '/analytics?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
    fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      var a = (res.ok && res.body && res.body.analytics) ? res.body.analytics : {};
      var cells = row.querySelectorAll('td[data-metric]');
      var i, key;
      for (i = 0; i < cells.length; i++) {
        key = cells[i].getAttribute('data-metric');
        clearChildren(cells[i]);
        cells[i].appendChild(document.createTextNode(cellText(key, a[key])));
      }
    }).catch(function () {
      var cells = row.querySelectorAll('td[data-metric]');
      var i;
      for (i = 0; i < cells.length; i++) { clearChildren(cells[i]); cells[i].appendChild(document.createTextNode('\\u2014')); }
    });
  }

  var tables = document.querySelectorAll('table[data-lg-analytics]');
  var t, rows, j;
  for (t = 0; t < tables.length; t++) {
    rows = tables[t].querySelectorAll('tbody tr[data-entity-id]');
    for (j = 0; j < rows.length; j++) { fillRow(tables[t], rows[j]); }
  }

  // Round-4 A-2 kebab rollout (row R4-02/R4-38): Archive/Reactivate are the
  // unrestricted PATCH {status} leg (previously Archive silently DELETEd
  // with no res.ok check at all — a blocked/failed archive reloaded the page
  // with no error shown; fixed here as part of the restructure); Delete is
  // the SEPARATE guarded DELETE (surfaces the server's plain-language 409
  // verbatim); Usage is a new inline expandable panel (mirrors the Sections
  // list's existing pattern, ui-sections.ts SECTION_LIST_SCRIPT). No
  // Duplicate — auctions have no duplicate endpoint.
  document.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) { return; }
    var archiveId = el.getAttribute('data-auction-archive');
    if (archiveId) {
      if (window.lgCloseKebabs) { window.lgCloseKebabs(); }
      if (!window.confirm('Archive this Auction?')) { return; }
      fetch('/api/admin/leadgen/auctions/' + encodeURIComponent(archiveId), {
        method: 'PATCH', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ status: 'archived' })
      }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, body: j }; });
      }).then(function (res) {
        if (!res.ok) { window.alert((res.body && res.body.error) || 'Archive failed'); return; }
        window.location.reload();
      }).catch(function () { window.alert('Archive request failed'); });
      return;
    }
    var reactivateId = el.getAttribute('data-auction-reactivate');
    if (reactivateId) {
      if (window.lgCloseKebabs) { window.lgCloseKebabs(); }
      if (!window.confirm('Reactivate this Auction?')) { return; }
      fetch('/api/admin/leadgen/auctions/' + encodeURIComponent(reactivateId), {
        method: 'PATCH', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ status: 'active' })
      }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, body: j }; });
      }).then(function (res) {
        if (!res.ok) { window.alert((res.body && res.body.error) || 'Reactivate failed'); return; }
        window.location.reload();
      }).catch(function () { window.alert('Reactivate request failed'); });
      return;
    }
    var deleteId = el.getAttribute('data-auction-delete');
    if (deleteId) {
      if (window.lgCloseKebabs) { window.lgCloseKebabs(); }
      var deleteName = el.getAttribute('data-entity-name') || 'this auction';
      if (!window.confirm('Delete ' + deleteName + '?')) { return; }
      fetch('/api/admin/leadgen/auctions/' + encodeURIComponent(deleteId), {
        method: 'DELETE', credentials: 'same-origin', headers: { 'Accept': 'application/json' }
      }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
      }).then(function (res) {
        if (!res.ok) { window.alert((res.body && res.body.error) || ('Delete failed (' + res.status + ')')); return; }
        window.location.reload();
      }).catch(function () { window.alert('Delete request failed'); });
      return;
    }
    var usageId = el.getAttribute('data-auction-usage');
    if (usageId) {
      if (window.lgCloseKebabs) { window.lgCloseKebabs(); }
      var panelRow = document.querySelector('[data-auction-usage-row="' + usageId + '"]');
      if (!panelRow) { return; }
      var wasHidden = panelRow.hidden;
      panelRow.hidden = !wasHidden;
      el.setAttribute('aria-expanded', wasHidden ? 'true' : 'false');
      if (!wasHidden) { return; }
      var panel = panelRow.querySelector('[data-auction-usage-panel]');
      if (!panel || panel.getAttribute('data-loaded') === 'true') { return; }
      panel.appendChild(document.createTextNode('Loading usage\\u2026'));
      fetch('/api/admin/leadgen/auctions/' + encodeURIComponent(usageId) + '/usage', {
        credentials: 'same-origin', headers: { 'Accept': 'application/json' }
      }).then(function (r) { return r.json(); }).then(function (body) {
        var kinds = (body && body.usage && body.usage.kinds) ? body.usage.kinds : [];
        clearChildren(panel);
        panel.setAttribute('data-loaded', 'true');
        var total = 0;
        var ki;
        for (ki = 0; ki < kinds.length; ki++) { total += Number(kinds[ki].count) || 0; }
        if (total === 0) {
          panel.appendChild(document.createTextNode('Not referenced by any live funnel variant \\u2014 safe to delete or archive.'));
          return;
        }
        for (ki = 0; ki < kinds.length; ki++) {
          var kind = kinds[ki];
          if (!kind.count) { continue; }
          var head = document.createElement('p');
          head.appendChild(document.createTextNode('Funnel variants referencing this auction: ' + kind.count));
          panel.appendChild(head);
          var items = kind.items || [];
          if (items.length > 0) {
            var list = document.createElement('ul');
            var ii;
            for (ii = 0; ii < items.length; ii++) {
              var li = document.createElement('li');
              li.appendChild(document.createTextNode(items[ii].name || items[ii].public_id || String(items[ii].id)));
              list.appendChild(li);
            }
            panel.appendChild(list);
          }
        }
      }).catch(function () {
        clearChildren(panel);
        panel.appendChild(document.createTextNode('Failed to load usage.'));
      });
    }
  });
}());
`;

// ---------------------------------------------------------------------------
// New-auction page (§10.1-style create → then editor)
// ---------------------------------------------------------------------------

export async function leadgenAuctionsNewPage(c: UiContext): Promise<Response> {
  // Quote attribution picker feed — any quote is attributable (draft quotes are
  // still being built; the auction attributes to the Quote, not its lifecycle).
  const quotesRes = await apiJson<ListBody<QuoteOption>>(
    c.env,
    "/api/admin/leadgen/quotes?page_size=200",
  );
  const quotes = quotesRes.ok ? quotesRes.body.items : [];
  const quoteOptions = quotes
    .map((q) => `<option value="${q.id}">${escapeHtml(q.quote_name)} (${escapeHtml(q.activity)})</option>`)
    .join("");

  const content = `${renderLeadgenTabs("auction")}
<div class="lg-editor-head">
  <a href="/admin/leadgen/auction" class="btn btn-outline">&#8592; Auctions</a>
  <h2 class="lg-editor-title">New Auction</h2>
</div>
<p id="lg-auction-new-error" class="alert alert-error" hidden role="alert"></p>
<div class="card">
  <form id="lg-auction-new-form" novalidate>
    <div class="lg-scalars">
      <div class="form-group">
        <label class="form-label" for="lg-a-name">Auction name *</label>
        <input id="lg-a-name" name="auction_name" class="form-input" required aria-required="true" />
      </div>
      <div class="form-group">
        <label class="form-label" for="lg-a-quote">Quote attribution *</label>
        <select id="lg-a-quote" name="quote_id" class="form-select" required aria-required="true">
          <option value="">Select a Quote…</option>
          ${quoteOptions}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="lg-a-type">Auction type *</label>
      <select id="lg-a-type" name="auction_type" class="form-select">
        <option value="static">Static (no provider request)</option>
        <option value="dynamic">Dynamic (provider bids)</option>
      </select>
    </div>
    <button type="submit" id="lg-auction-new-save" class="btn btn-primary">Create Auction</button>
    <span class="form-help">The full winner logic, participating offers, rules, and banner are configured in the editor (§18–§21).</span>
  </form>
</div>`;
  return c.html(
    leadgenPageShell({
      activePath: "/admin/leadgen/auction",
      userEmail: branding(c).userEmail,
      content,
      styles: LG_AUCTIONS_STYLES,
      scripts: AUCTION_NEW_SCRIPT,
    }),
  );
}

const AUCTION_NEW_SCRIPT = `
(function () {
  var form = document.getElementById('lg-auction-new-form');
  if (!form) { return; }
  var errBox = document.getElementById('lg-auction-new-error');
  function showErr(text) { if (errBox) { errBox.textContent = text; errBox.hidden = false; } }
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var name = (document.getElementById('lg-a-name').value || '').trim();
    var quoteRaw = (document.getElementById('lg-a-quote').value || '').trim();
    var type = (document.getElementById('lg-a-type').value || 'static').trim();
    if (!name) { showErr('Auction name is required.'); return; }
    if (!quoteRaw) { showErr('Quote attribution is required.'); return; }
    var payload = { auction_name: name, quote_id: parseInt(quoteRaw, 10), auction_type: type };
    var btn = document.getElementById('lg-auction-new-save');
    if (btn) { btn.disabled = true; }
    fetch('/api/admin/leadgen/auctions', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      if (res.ok && res.body && res.body.public_id) {
        window.location.href = '/admin/leadgen/auction/' + encodeURIComponent(res.body.public_id) + '/edit';
      } else {
        if (btn) { btn.disabled = false; }
        var msg = (res.body && res.body.error) ? res.body.error : 'Create failed.';
        showErr(msg);
      }
    }).catch(function () { if (btn) { btn.disabled = false; } showErr('Network error.'); });
  });
}());
`;

// ---------------------------------------------------------------------------
// Editor page (03 §9.5) — six-tab full-page editor
// ---------------------------------------------------------------------------

function selectField(
  id: string,
  label: string,
  current: string,
  options: ReadonlyArray<[string, string]>,
  dataAttr = "",
): string {
  const opts = options
    .map(([val, text]) => `<option value="${escapeHtml(val)}"${val === current ? " selected" : ""}>${escapeHtml(text)}</option>`)
    .join("");
  return `<div class="form-group">
  <label class="form-label" for="${id}">${escapeHtml(label)}</label>
  <select id="${id}" class="form-select"${dataAttr}>${opts}</select>
</div>`;
}

function numberField(id: string, label: string, value: number, step = "1", min = "0"): string {
  return `<div class="form-group">
  <label class="form-label" for="${id}">${escapeHtml(label)}</label>
  <input id="${id}" type="number" class="form-input" step="${escapeHtml(step)}" min="${escapeHtml(min)}" value="${escapeHtml(String(value))}" />
</div>`;
}

function toggleField(id: string, label: string, ischecked: boolean): string {
  return `<div class="form-group">
  <label class="lg-check"><input type="checkbox" id="${id}"${ischecked ? " checked" : ""} /> ${escapeHtml(label)}</label>
</div>`;
}

// §18.3 floor: BOTH labels + the %-suffix / currency-prefix are rendered; the
// pair for the CURRENT floor_type is shown, the other hidden. The editor script
// toggles them when floor_type changes ("Floor (% of top bid)" `%`-suffixed vs
// "Floor (minimum bid)" currency-prefixed).
function renderFloorField(floorType: string, floorValue: number): string {
  const isPct = floorType !== "absolute_bid";
  return `<div class="form-group" data-floor-group>
  <label class="form-label">
    <span data-floor-label-pct${isPct ? "" : " hidden"}>Floor (% of top bid)</span>
    <span data-floor-label-abs${isPct ? " hidden" : ""}>Floor (minimum bid)</span>
  </label>
  <div class="lg-floor-input">
    <span class="lg-affix" data-floor-prefix${isPct ? " hidden" : ""}>$</span>
    <input id="lg-a-floor-value" type="number" class="form-input" step="0.01" min="0" value="${escapeHtml(String(floorValue))}" />
    <span class="lg-affix" data-floor-suffix${isPct ? "" : " hidden"}>%</span>
  </div>
</div>`;
}

function bannerDesignOptions(current: string): ReadonlyArray<[string, string]> {
  const keys = Object.keys(BANNER_DESIGNS);
  const seen = new Set<string>();
  const opts: Array<[string, string]> = [];
  if (!keys.includes(current)) opts.push([current, `${current} (current)`]);
  for (const k of keys) {
    if (seen.has(k)) continue;
    seen.add(k);
    opts.push([k, k]);
  }
  return opts;
}

function renderSettingsPanel(a: LeadgenAuctionApi, participating: ParticipatingOffer[], quoteName: string | null, quoteOptions: string): string {
  // mixed_payout_warn (§18.1): the participating set mixes payout types.
  const payoutTypes = Array.from(new Set(participating.map((p) => p.offer_type).filter((t): t is string => typeof t === "string")));
  const mixed = payoutTypes.length > 1;
  const showWarn = a.mixed_payout_warn && mixed;
  const warnBanner = showWarn
    ? `<div class="lg-warn" data-mixed-payout-warn>Mixed payout types (${escapeHtml(payoutTypes.join(", "))}) in the participating set. <code>percentage_of_max</code> compares USD-normalized bids of different payout types — recommend <strong>absolute_bid</strong> (or per-type floors) for a mixed set (§18.1).</div>`
    : "";

  return `<div class="lg-apanel active" data-panel="settings">
  ${warnBanner}
  <fieldset class="card">
    <legend>Attribution &amp; type (§18.1)</legend>
    <div class="lg-scalars">
      <div class="form-group">
        <label class="form-label" for="lg-a-name">Auction name</label>
        <input id="lg-a-name" class="form-input" value="${escapeHtml(a.auction_name)}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="lg-a-quote">Quote attribution${quoteName ? ` — <span class="form-help">${escapeHtml(quoteName)}</span>` : ""}</label>
        <select id="lg-a-quote" class="form-select">${quoteOptions}</select>
      </div>
    </div>
    <div class="lg-scalars">
      ${selectField("lg-a-type", "Auction type", a.auction_type, [["static", "Static"], ["dynamic", "Dynamic"]], " data-auction-type")}
      ${selectField("lg-a-winner", "Winner logic (§18.4)", a.winner_logic, [["highest_bid", "Highest bid"], ["average_bid", "Average bid"], ["sum_bids", "Sum of bids"]])}
    </div>
  </fieldset>

  <fieldset class="card">
    <legend>Floor (§18.3)</legend>
    <div class="lg-scalars">
      ${selectField("lg-a-floor-type", "Floor type", a.floor_type, [["percentage_of_max", "Percentage of top bid"], ["absolute_bid", "Absolute bid"]], " data-floor-type")}
      ${renderFloorField(a.floor_type, a.floor_value)}
    </div>
  </fieldset>

  <fieldset class="card">
    <legend>Surfacing, multi-offer &amp; limits (§18.5)</legend>
    <div class="lg-scalars">
      ${selectField("lg-a-multi", "Multi-offer", a.multi_offer, [["disabled", "Disabled (winner only)"], ["enabled", "Enabled (all, bid order)"], ["enabled_unique", "Enabled (unique by carrier)"]])}
      ${selectField("lg-a-render", "Render mode", a.render_mode, [["all_at_once", "All at once"], ["progressive", "Progressive"]])}
    </div>
    ${toggleField("lg-a-surface-static", "Surface static/CPL-bid offers alongside the winner (§18.2)", a.surface_static_bid_offers)}
    <div class="lg-scalars">
      ${numberField("lg-a-slots", "Banner slots count", a.banner_slots_count)}
      ${numberField("lg-a-max-per-offer", "Max carriers per offer", a.max_carriers_per_offer)}
    </div>
    <div class="lg-scalars">
      ${numberField("lg-a-max-total", "Max total carriers", a.max_total_carriers)}
      ${numberField("lg-a-timeout", "Provider timeout (ms)", a.timeout_ms, "1", "0")}
    </div>
  </fieldset>

  <fieldset class="card">
    <legend>Backfill (§18.6)</legend>
    <div class="lg-scalars">
      ${selectField("lg-a-backfill", "Backfill", a.backfill, [["disabled", "Disabled"], ["enabled", "Enabled"], ["enabled_unique", "Enabled (unique by carrier)"]])}
      ${selectField("lg-a-backfill-trigger", "Backfill trigger", a.backfill_trigger, [["on_slot_exhaustion", "On slot exhaustion"], ["on_click", "On click"], ["on_dismiss", "On dismiss"]])}
    </div>
    ${numberField("lg-a-backfill-source", "Backfill source offer id (blank/0 = all remaining)", a.backfill_source_offer_id ?? 0, "1", "0")}
  </fieldset>

  <fieldset class="card">
    <legend>Remove-clicked (§18.7) &amp; normalization</legend>
    ${toggleField("lg-a-remove-clicked", "Remove clicked offers", a.remove_clicked_offers)}
    <div class="lg-scalars">
      ${selectField("lg-a-removal-scope", "Removal scope", a.removal_scope, [["offer", "Offer (whole clicked offer)"], ["carrier", "Carrier (only the clicked carrier)"]])}
      ${numberField("lg-a-norm-version", "Carrier normalization version (§18.8)", a.carrier_normalization_version, "1", "1")}
    </div>
  </fieldset>

  <fieldset class="card">
    <legend>Banner design &amp; warnings</legend>
    <div class="lg-scalars">
      ${selectField("lg-a-banner-design", "Banner design", a.banner_design_id, bannerDesignOptions(a.banner_design_id))}
      ${toggleField("lg-a-mixed-warn", "Warn on mixed payout types (§18.1)", a.mixed_payout_warn)}
    </div>
  </fieldset>
</div>`;
}

function renderParticipatingRow(p: ParticipatingOffer): string {
  const schemaV = p.schema_version === null || p.schema_version === undefined ? EM_DASH : `v${p.schema_version}`;
  const lastTest = p.last_test_status ?? "untested";
  return `<div class="lg-part-row" data-placement-id="${p.offer_placement_id}" data-offer-id="${p.offer_id}" data-offer-public-id="${escapeHtml(p.offer_public_id ?? "")}">
  <span class="lg-grow" data-offer-name>${escapeHtml(p.offer_name ?? String(p.offer_id))}</span>
  <span class="form-help">${escapeHtml(p.provider ?? "")}</span>
  <span class="form-help" data-offer-type>${escapeHtml(p.offer_type ?? "")}</span>
  ${statusBadge(p.offer_status ?? "active")}
  <span class="form-help" title="Cap">${p.cap_enabled ? "cap on" : "no cap"}</span>
  <span class="form-help" title="Schema version">${escapeHtml(schemaV)}</span>
  <span class="form-help" data-last-test title="Last test">${escapeHtml(lastTest)}</span>
  <label class="lg-static-only form-help">order <input type="number" class="form-input" data-static-order min="0" step="1" value="${p.static_order === null ? "" : escapeHtml(String(p.static_order))}" style="width:70px" /></label>
  <label class="lg-static-only form-help">bid <input type="number" class="form-input" data-static-bid min="0" step="0.01" value="${p.static_bid_override === null ? "" : escapeHtml(String(p.static_bid_override))}" style="width:80px" /></label>
  <label class="lg-check"><input type="checkbox" data-part-enabled${p.enabled ? " checked" : ""} /> enabled</label>
  <button type="button" class="btn btn-sm btn-danger" data-remove-participating>Remove</button>
</div>`;
}

function renderParticipatingPanel(a: LeadgenAuctionApi, participating: ParticipatingOffer[], activity: string, verticals: string[]): string {
  const rows = participating.map(renderParticipatingRow).join("");
  const empty = participating.length === 0 ? `<p class="form-help" data-participating-empty>No participating offers yet — search and add offers matching the Quote's activity/vertical.</p>` : "";
  const vertOptions = verticals.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  return `<div class="lg-apanel" data-panel="participating">
  <div class="card">
    <h3>Participating Offers (§18.5)</h3>
    <div class="toolbar" data-offer-picker data-activity="${escapeHtml(activity)}">
      <input type="search" id="lg-a-offer-search" class="form-input" placeholder="Search offers…" aria-label="Search offers to add" />
      <select id="lg-a-offer-vertical" class="form-select" aria-label="Filter by vertical"><option value="">Any vertical</option>${vertOptions}</select>
      <button type="button" class="btn btn-secondary" id="lg-a-offer-search-btn">Search</button>
    </div>
    <ul id="lg-a-offer-results" class="lg-picker-results" aria-live="polite"></ul>
    <div id="lg-a-participating-list" class="lg-auction-${escapeHtml(a.auction_type)}">
      ${empty}${rows}
    </div>
    <button type="button" class="btn btn-primary" id="lg-a-participating-save">Save participating offers</button>
    <p id="lg-a-participating-msg" class="form-help" hidden></p>
    <p class="form-help" data-eligibility-note>Ineligible dynamic offers do not block saving this auction (drafts may reference not-yet-ready offers), but they block activating any Quote this auction serves (05 §5.1/§5.2).</p>
  </div>
</div>`;
}

function renderRuleRow(r: LeadgenAuctionRuleApi): string {
  const conditions = JSON.stringify(r.conditions_json ?? { groups: [] });
  const carrierMatch = r.carrier_match_json === null || r.carrier_match_json === undefined ? "" : JSON.stringify(r.carrier_match_json);
  return `<div class="lg-rule-row" data-rule-id="${escapeHtml(r.public_id)}" data-rule-level="${escapeHtml(r.rule_level)}">
  <div class="lg-rule-grid">
    <span><strong>${escapeHtml(r.rule_level)}</strong> rule</span>
    <span>THEN <strong>${escapeHtml(r.action)}</strong></span>
    <span>priority ${r.priority}${r.strictly_override ? " · strictly_override" : ""}${r.enabled ? "" : " · disabled"}</span>
  </div>
  ${r.rule_level === "offer" ? `<p class="form-help">target offer id: ${r.target_offer_id ?? EM_DASH}</p>` : `<p class="form-help">carrier match: <code>${escapeHtml(carrierMatch || "{}")}</code></p>`}
  <p class="form-help">IF (§21.4): <code>${escapeHtml(conditions)}</code></p>
  <button type="button" class="btn btn-sm btn-danger" data-delete-rule="${escapeHtml(r.public_id)}">Delete rule</button>
</div>`;
}

function renderRulesPanel(rules: LeadgenAuctionRuleApi[]): string {
  const offerRules = rules.filter((r) => r.rule_level === "offer");
  const carrierRules = rules.filter((r) => r.rule_level === "carrier");
  const rulesHtml =
    rules.length === 0
      ? `<p class="form-help" data-rules-empty>No rules yet.</p>`
      : `<h4>Offer-level (§21)</h4>${offerRules.map(renderRuleRow).join("") || `<p class="form-help">None.</p>`}
<h4>Carrier-level (§21)</h4>${carrierRules.map(renderRuleRow).join("") || `<p class="form-help">None.</p>`}`;
  return `<div class="lg-apanel" data-panel="rules">
  <div class="card">
    <h3>Rules (§21) — offer-level &amp; carrier-level IF/THEN</h3>
    <div id="lg-a-rules-list">${rulesHtml}</div>
  </div>
  <div class="card" id="lg-a-rule-builder">
    <h4>Add a rule</h4>
    <div class="lg-rule-grid">
      <div class="form-group">
        <label class="form-label" for="lg-r-level">Rule level</label>
        <select id="lg-r-level" class="form-select" data-rule-level-select><option value="offer">Offer-level</option><option value="carrier">Carrier-level</option></select>
      </div>
      <div class="form-group">
        <label class="form-label" for="lg-r-action">THEN action</label>
        <select id="lg-r-action" class="form-select"><option value="include_only">include_only</option><option value="exclude">exclude</option><option value="allow_list">allow_list</option><option value="block_list">block_list</option></select>
      </div>
      <div class="form-group">
        <label class="form-label" for="lg-r-priority">Priority</label>
        <input id="lg-r-priority" type="number" class="form-input" step="1" value="100" />
      </div>
    </div>
    <div class="form-group" data-rule-offer-field>
      <label class="form-label" for="lg-r-target-offer">Target offer id (offer-level)</label>
      <input id="lg-r-target-offer" type="number" class="form-input" step="1" min="1" />
    </div>
    <div class="form-group" data-rule-carrier-field hidden>
      <label class="form-label" for="lg-r-carrier-match">Carrier match JSON (carrier-level)</label>
      <textarea id="lg-r-carrier-match" class="form-input" rows="2" placeholder='{"carrier_keys":["acme"]}'></textarea>
    </div>
    <div class="form-group">
      <label class="form-label" for="lg-r-conditions">IF — conditions JSON (§21.4 groups[])</label>
      <textarea id="lg-r-conditions" class="form-input" rows="3">{"groups":[]}</textarea>
    </div>
    <label class="lg-check"><input type="checkbox" id="lg-r-strictly" /> strictly_override</label>
    <label class="lg-check"><input type="checkbox" id="lg-r-enabled" checked /> enabled</label>
    <div><button type="button" class="btn btn-primary" id="lg-a-rule-add">Add rule</button></div>
    <p id="lg-a-rule-msg" class="form-help" hidden></p>
  </div>
</div>`;
}

function renderBannerPanel(banner: BannerConfig): string {
  const mode = banner.mode === "manual" ? "manual" : "automatic";
  const fieldMap = (banner.field_map_json && typeof banner.field_map_json === "object") ? (banner.field_map_json as Record<string, unknown>) : {};
  const config = (banner.banner_config_json && typeof banner.banner_config_json === "object") ? (banner.banner_config_json as Record<string, unknown>) : {};
  const cfg = (key: string): string => {
    const v = config[key];
    return typeof v === "string" ? v : "";
  };
  const fieldMapRows = CANONICAL_CARRIER_FIELDS.map((field) => {
    const slot = typeof fieldMap[field] === "string" ? (fieldMap[field] as string) : "";
    return `<div class="lg-fieldmap-row">
    <span class="lg-fieldmap-key">${escapeHtml(field)}</span>
    <input class="form-input" data-fieldmap-key="${escapeHtml(field)}" placeholder="banner slot id (blank = unmapped)" value="${escapeHtml(slot)}" />
  </div>`;
  }).join("");
  return `<div class="lg-apanel" data-panel="banner">
  <div class="card">
    <h3>Banner builder (§20)</h3>
    <div class="form-group">
      <label class="form-label">Mode</label>
      <label class="lg-check"><input type="radio" name="lg-banner-mode" value="manual" data-banner-mode${mode === "manual" ? " checked" : ""} /> Manual (static banner_config_json)</label>
      <label class="lg-check"><input type="radio" name="lg-banner-mode" value="automatic" data-banner-mode${mode === "automatic" ? " checked" : ""} /> Automatic (canonical Carrier field → slot map)</label>
    </div>

    <div class="lg-banner-mode-panel${mode === "manual" ? " active" : ""}" data-banner-panel="manual">
      <div class="lg-scalars">
        <div class="form-group"><label class="form-label" for="lg-b-headline">Headline</label><input id="lg-b-headline" class="form-input" data-banner-config="headline" value="${escapeHtml(cfg("headline"))}" /></div>
        <div class="form-group"><label class="form-label" for="lg-b-subheadline">Subheadline</label><input id="lg-b-subheadline" class="form-input" data-banner-config="subheadline" value="${escapeHtml(cfg("subheadline"))}" /></div>
      </div>
      <div class="lg-scalars">
        <div class="form-group"><label class="form-label" for="lg-b-logo">Logo URL</label><input id="lg-b-logo" class="form-input" data-banner-config="logo" value="${escapeHtml(cfg("logo"))}" /></div>
        <div class="form-group"><label class="form-label" for="lg-b-cta">CTA</label><input id="lg-b-cta" class="form-input" data-banner-config="cta" value="${escapeHtml(cfg("cta"))}" /></div>
      </div>
      <div class="form-group"><label class="form-label" for="lg-b-legal">Legal</label><input id="lg-b-legal" class="form-input" data-banner-config="legal" value="${escapeHtml(cfg("legal"))}" /></div>
    </div>

    <div class="lg-banner-mode-panel${mode === "automatic" ? " active" : ""}" data-banner-panel="automatic">
      <p class="form-help">Maps ONLY the canonical normalized Carrier fields → banner slot ids (§20). Saved provider sample responses configure each Offer's parser, not raw auction maps.</p>
      <div id="lg-a-fieldmap">${fieldMapRows}</div>
    </div>

    <button type="button" class="btn btn-primary" id="lg-a-banner-save">Save banner</button>
    <p id="lg-a-banner-msg" class="form-help" hidden></p>
  </div>
</div>`;
}

// §7.6 (S1) simulate trace — a DRY-RUN readout. POSTs sample answers/context
// to /auctions/:id/simulate and renders, per considered offer, the additive
// fields: redacted payload_preview (pretty), parser id + carrier parse
// version, expected response fields, placement id used, and the eligibility
// verdict + exclusion reason (via the reused eligibilityLabel). Nothing is
// WRITTEN in dry-run (no logs, revenue or cap increments) — but the
// staging-environment carrier resolve DOES fire (DEV-40 MAJOR-5), so the
// note must not claim "no provider calls".
function renderSimulatorPanel(): string {
  return `<div class="lg-apanel" data-panel="simulator">
  <div class="card">
    <h3>Simulator (§19.2 dry-run)</h3>
    <p class="form-help" data-simulator-dryrun>Dry-run explainability trace against sample answers. No writes; staging-only carrier resolve.</p>
    <div class="form-group">
      <label class="form-label" for="lg-sim-answers">Sample answers (JSON, optional)</label>
      <textarea id="lg-sim-answers" class="form-textarea" rows="4" data-sim-answers placeholder='{"zip":"90210"}' aria-label="Sample answers JSON"></textarea>
    </div>
    <div class="form-group">
      <label class="form-label" for="lg-sim-context">Request context (JSON, optional)</label>
      <textarea id="lg-sim-context" class="form-textarea" rows="2" data-sim-context placeholder='{"state":"CA"}' aria-label="Request context JSON"></textarea>
    </div>
    <button type="button" class="btn btn-primary" id="lg-a-simulate">Run simulation (dry-run)</button>
    <p id="lg-sim-msg" class="form-help" hidden></p>
    <div id="lg-sim-results" data-simulate-results hidden></div>
  </div>
</div>`;
}

function renderAnalyticsPanel(): string {
  return `<div class="lg-apanel" data-panel="analytics">
  <div class="card">
    <h3>Auction analytics (§18.9)</h3>
    <div class="table-wrapper">
      <table class="table" id="lg-a-analytics-table" aria-label="Auction analytics">
        <thead><tr>
          <th scope="col">Auctions</th><th scope="col" class="lg-num">Impressions</th><th scope="col" class="lg-num">Avg imp/auction</th>
          <th scope="col" class="lg-num">Avg bid</th><th scope="col" class="lg-num">Avg RPC</th><th scope="col" class="lg-num">Avg clicks/auction</th>
          <th scope="col" class="lg-num">Fill rate</th><th scope="col" class="lg-num">Unfilled rate</th><th scope="col" class="lg-num">Timeout rate</th>
          <th scope="col" class="lg-num">Below-floor rate</th><th scope="col" class="lg-num">Malformed rate</th><th scope="col" class="lg-num">No-bid rate</th>
          <th scope="col" class="lg-num">Carrier CTR</th><th scope="col" class="lg-num">Avg latency</th><th scope="col" class="lg-num">Provider error rate</th><th scope="col" class="lg-num">Revenue</th>
        </tr></thead>
        <tbody id="lg-a-analytics-body"><tr><td colspan="16" class="form-help">Loading…</td></tr></tbody>
      </table>
    </div>
  </div>
</div>`;
}

function auctionDataBlob(a: LeadgenAuctionApi): string {
  const data = { auction_public_id: a.public_id, auction_id: a.id, auction_type: a.auction_type };
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function auctionEditorHtml(
  a: LeadgenAuctionApi,
  participating: ParticipatingOffer[],
  rules: LeadgenAuctionRuleApi[],
  banner: BannerConfig,
  quoteName: string | null,
  quoteOptions: string,
  activity: string,
  verticals: string[],
  brand: { userEmail?: string },
  relocatedQuotes: RelocatedRuleQuote[],
  defaultQuotePublicId: string | null,
): string {
  const head = `<div class="lg-editor-head">
    <a href="/admin/leadgen/auction" class="btn btn-outline">&#8592; Auctions</a>
    <h2 class="lg-editor-title">${escapeHtml(a.auction_name)}</h2>
    <code class="lg-editor-pubid">${escapeHtml(a.public_id)}</code>${statusBadge(a.status)}
    <span class="lg-editor-spacer"></span>
    <button type="button" id="lg-a-save" class="btn btn-primary">Save settings</button>
  </div>`;

  const subtabs = `<nav class="lg-atabs" aria-label="Auction editor tabs">
  <button type="button" class="lg-atab active" data-tab="settings">Settings</button>
  <button type="button" class="lg-atab" data-tab="participating">Participating Offers</button>
  <button type="button" class="lg-atab" data-tab="rules">Rules</button>
  <button type="button" class="lg-atab" data-tab="banner">Banner builder</button>
  <button type="button" class="lg-atab" data-tab="simulator">Simulator</button>
  <button type="button" class="lg-atab" data-tab="analytics">Analytics</button>
</nav>`;

  const content = `${renderLeadgenTabs("auction")}
<div id="lg-auction-editor" data-auction-id="${a.id}" data-auction-public-id="${escapeHtml(a.public_id)}" data-auction-type="${escapeHtml(a.auction_type)}">
  ${head}
  <p id="lg-auction-error" class="alert alert-error" hidden role="alert"></p>
  <p id="lg-auction-ok" class="alert alert-success" hidden role="status"></p>
  ${subtabs}
  ${renderSettingsPanel(a, participating, quoteName, quoteOptions)}
  ${renderParticipatingPanel(a, participating, activity, verticals)}
  ${renderRulesPanel(rules)}
  ${renderRelocatedFunnelRulesPanel(relocatedQuotes, defaultQuotePublicId)}
  ${renderBannerPanel(banner)}
  ${renderSimulatorPanel()}
  ${renderAnalyticsPanel()}
  <script type="application/json" id="lg-auction-data">${auctionDataBlob(a)}</script>
</div>`;

  return leadgenPageShell({
    activePath: "/admin/leadgen/auction",
    userEmail: brand.userEmail,
    content,
    styles: LG_AUCTIONS_STYLES,
    // §13-D5: RULES_BUILDER_SCRIPT (window.lgRulesBuilder, the shared §21.4
    // condition builder) + RELOCATED_RULES_SCRIPT (the relocated editor's OWN
    // picker + REST-driven CRUD) power the panel mounted above.
    scripts: AUCTION_EDITOR_SCRIPT + RULES_BUILDER_SCRIPT + RELOCATED_RULES_SCRIPT,
  });
}

function auctionNotFoundPage(brand: { userEmail?: string }): string {
  const content = `${renderLeadgenTabs("auction")}
<div class="card"><div class="empty-state">
  <p>Auction not found.</p>
  <a href="/admin/leadgen/auction" class="btn btn-primary">Back to Auctions</a>
</div></div>`;
  return leadgenPageShell({
    activePath: "/admin/leadgen/auction",
    userEmail: brand.userEmail,
    content,
    styles: LG_AUCTIONS_STYLES,
  });
}

function parseVerticals(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string");
  return [];
}

export async function leadgenAuctionEditorPage(c: UiContext): Promise<Response> {
  const idParam = c.req.param("id") ?? "";
  const auctionRes = await apiJson<LeadgenAuctionApi>(c.env, `/api/admin/leadgen/auctions/${encodeURIComponent(idParam)}`);
  if (!auctionRes.ok) return c.html(auctionNotFoundPage(branding(c)), 404);
  const a = auctionRes.body;

  const encoded = encodeURIComponent(a.public_id);
  const offersRes = await apiJson<{ items: ParticipatingOffer[] }>(c.env, `/api/admin/leadgen/auctions/${encoded}/offers`);
  const rulesRes = await apiJson<{ items: LeadgenAuctionRuleApi[] }>(c.env, `/api/admin/leadgen/auctions/${encoded}/rules`);
  const bannerRes = await apiJson<BannerConfig>(c.env, `/api/admin/leadgen/auctions/${encoded}/banner`);
  const quotesRes = await apiJson<ListBody<QuoteOption>>(c.env, "/api/admin/leadgen/quotes?page_size=200");

  const quotes = quotesRes.ok ? quotesRes.body.items : [];
  const attributedQuote = quotes.find((q) => q.id === a.quote_id) ?? null;
  const activity = attributedQuote?.activity ?? "";
  const verticals = attributedQuote ? parseVerticals(attributedQuote.verticals_json) : [];
  const quoteOptions = quotes
    .map((q) => `<option value="${q.id}"${q.id === a.quote_id ? " selected" : ""}>${escapeHtml(q.quote_name)} (${escapeHtml(q.activity)})</option>`)
    .join("");
  // §13-D5 wiring round: the relocated rules editor's quote/funnel/variant
  // picker reuses this SAME already-loaded quotes list (id/public_id/quote_
  // name/activity — the shape RelocatedRuleQuote mirrors exactly); the auction's
  // OWN attributed quote pre-selects (common case), any quote stays reachable.
  const relocatedQuotes: RelocatedRuleQuote[] = quotes.map((q) => ({
    id: q.id,
    public_id: q.public_id,
    quote_name: q.quote_name,
    activity: q.activity,
  }));
  const defaultQuotePublicId = attributedQuote?.public_id ?? null;

  const banner: BannerConfig = bannerRes.ok ? bannerRes.body : { auction_id: a.id, mode: "automatic", field_map_json: {}, banner_config_json: null };

  return c.html(
    auctionEditorHtml(
      a,
      offersRes.ok ? offersRes.body.items : [],
      rulesRes.ok ? rulesRes.body.items : [],
      banner,
      attributedQuote?.quote_name ?? null,
      quoteOptions,
      activity,
      verticals,
      branding(c),
      relocatedQuotes,
      defaultQuotePublicId,
    ),
  );
}

// ---------------------------------------------------------------------------
// Editor inline script (strict ES5) — tabs, floor-label switch, settings save,
// participating picker + replace-set save, rule add/delete, banner mode + save,
// analytics load, unsaved-changes guard.
// ---------------------------------------------------------------------------

const AUCTION_EDITOR_SCRIPT = `
(function () {
  var root = document.getElementById('lg-auction-editor');
  if (!root) { return; }
  var auctionId = root.getAttribute('data-auction-public-id') || '';
  var apiBase = '/api/admin/leadgen/auctions/' + encodeURIComponent(auctionId);
  var dirty = false;
  function markDirty() { dirty = true; }
  function byId(id) { return document.getElementById(id); }
  function showMsg(id, text, ok) { var el = byId(id); if (el) { el.textContent = text; el.hidden = false; el.className = ok ? 'alert alert-success' : 'alert alert-error'; } }
  function hide(id) { var el = byId(id); if (el) { el.hidden = true; } }
  function val(id) { var el = byId(id); return el ? (el.value || '') : ''; }
  function numVal(id) { var v = val(id).trim(); if (v === '') { return null; } var n = Number(v); return isFinite(n) ? n : null; }
  function isChecked(id) { var el = byId(id); return el ? !!el.checked : false; }
  function setHidden(sel, hidden) { var el = root.querySelector(sel); if (el) { if (hidden) { el.setAttribute('hidden', 'hidden'); } else { el.removeAttribute('hidden'); } } }
  function makeEl(tag, cls) { var e = document.createElement(tag); if (cls) { e.className = cls; } return e; }

  // --- sub-tab switching ----------------------------------------------------
  var tabs = root.querySelectorAll('.lg-atab');
  var panels = root.querySelectorAll('.lg-apanel');
  function activate(name) {
    var i;
    for (i = 0; i < tabs.length; i++) { tabs[i].className = tabs[i].getAttribute('data-tab') === name ? 'lg-atab active' : 'lg-atab'; }
    for (i = 0; i < panels.length; i++) { panels[i].className = panels[i].getAttribute('data-panel') === name ? 'lg-apanel active' : 'lg-apanel'; }
    if (name === 'analytics') { loadAnalytics(); }
  }
  var ti;
  for (ti = 0; ti < tabs.length; ti++) {
    tabs[ti].addEventListener('click', function () { activate(this.getAttribute('data-tab')); });
  }

  // --- floor label switch (§18.3) -------------------------------------------
  var floorType = byId('lg-a-floor-type');
  function syncFloor() {
    var isPct = (floorType ? floorType.value : 'percentage_of_max') !== 'absolute_bid';
    setHidden('[data-floor-label-pct]', !isPct);
    setHidden('[data-floor-label-abs]', isPct);
    setHidden('[data-floor-suffix]', !isPct);
    setHidden('[data-floor-prefix]', isPct);
  }
  if (floorType) { floorType.addEventListener('change', function () { syncFloor(); markDirty(); }); }
  syncFloor();

  // --- static-only participating inputs follow auction_type -----------------
  var typeSel = byId('lg-a-type');
  var partList = byId('lg-a-participating-list');
  function syncStatic() {
    if (!partList) { return; }
    var tp = typeSel ? typeSel.value : root.getAttribute('data-auction-type');
    partList.className = 'lg-auction-' + tp;
  }
  if (typeSel) { typeSel.addEventListener('change', function () { syncStatic(); markDirty(); }); }
  syncStatic();

  // dirty tracking on any input/change within the editor
  root.addEventListener('input', markDirty);
  root.addEventListener('change', markDirty);

  // --- Settings save (PATCH every §18.1 field) ------------------------------
  function saveSettings() {
    var payload = {
      auction_name: val('lg-a-name').trim(),
      quote_id: numVal('lg-a-quote'),
      auction_type: val('lg-a-type'),
      winner_logic: val('lg-a-winner'),
      floor_type: val('lg-a-floor-type'),
      floor_value: numVal('lg-a-floor-value'),
      multi_offer: val('lg-a-multi'),
      render_mode: val('lg-a-render'),
      surface_static_bid_offers: isChecked('lg-a-surface-static'),
      banner_slots_count: numVal('lg-a-slots'),
      max_carriers_per_offer: numVal('lg-a-max-per-offer'),
      max_total_carriers: numVal('lg-a-max-total'),
      timeout_ms: numVal('lg-a-timeout'),
      backfill: val('lg-a-backfill'),
      backfill_trigger: val('lg-a-backfill-trigger'),
      remove_clicked_offers: isChecked('lg-a-remove-clicked'),
      removal_scope: val('lg-a-removal-scope'),
      carrier_normalization_version: numVal('lg-a-norm-version'),
      banner_design_id: val('lg-a-banner-design'),
      mixed_payout_warn: isChecked('lg-a-mixed-warn')
    };
    var bs = numVal('lg-a-backfill-source');
    payload.backfill_source_offer_id = (bs && bs > 0) ? bs : null;
    hide('lg-auction-error'); hide('lg-auction-ok');
    fetch(apiBase, {
      method: 'PATCH', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (res.ok) { dirty = false; showMsg('lg-auction-ok', 'Settings saved.', true); }
        else { showMsg('lg-auction-error', (res.body && res.body.error) ? res.body.error : 'Save failed.', false); }
      }).catch(function () { showMsg('lg-auction-error', 'Network error.', false); });
  }
  var saveBtn = byId('lg-a-save');
  if (saveBtn) { saveBtn.addEventListener('click', saveSettings); }

  // --- Participating offers: picker + replace-set save ----------------------
  function addParticipatingRow(offer) {
    if (!partList) { return; }
    var empty = partList.querySelector('[data-participating-empty]');
    if (empty && empty.parentNode) { empty.parentNode.removeChild(empty); }
    if (partList.querySelector('[data-placement-id="' + offer.placement_id + '"]')) { return; }
    var row = makeEl('div', 'lg-part-row');
    row.setAttribute('data-placement-id', String(offer.placement_id));
    row.setAttribute('data-offer-id', String(offer.offer_id));

    var name = makeEl('span', 'lg-grow');
    name.setAttribute('data-offer-name', 'y');
    name.appendChild(document.createTextNode(offer.offer_name || String(offer.offer_id)));

    var type = makeEl('span', 'form-help');
    type.setAttribute('data-offer-type', 'y');
    type.appendChild(document.createTextNode(offer.offer_type || ''));

    var orderLabel = makeEl('label', 'lg-static-only form-help');
    orderLabel.appendChild(document.createTextNode('order '));
    var orderInput = makeEl('input', 'form-input');
    orderInput.type = 'number'; orderInput.min = '0'; orderInput.step = '1';
    orderInput.setAttribute('data-static-order', 'y'); orderInput.style.width = '70px';
    orderLabel.appendChild(orderInput);

    var bidLabel = makeEl('label', 'lg-static-only form-help');
    bidLabel.appendChild(document.createTextNode('bid '));
    var bidInput = makeEl('input', 'form-input');
    bidInput.type = 'number'; bidInput.min = '0'; bidInput.step = '0.01';
    bidInput.setAttribute('data-static-bid', 'y'); bidInput.style.width = '80px';
    bidLabel.appendChild(bidInput);

    var enLabel = makeEl('label', 'lg-check');
    var enInput = makeEl('input', '');
    enInput.type = 'checkbox'; enInput.checked = true; enInput.setAttribute('data-part-enabled', 'y');
    enLabel.appendChild(enInput); enLabel.appendChild(document.createTextNode(' enabled'));

    var rm = makeEl('button', 'btn btn-sm btn-danger');
    rm.type = 'button'; rm.setAttribute('data-remove-participating', 'y');
    rm.appendChild(document.createTextNode('Remove'));

    row.appendChild(name); row.appendChild(type); row.appendChild(orderLabel);
    row.appendChild(bidLabel); row.appendChild(enLabel); row.appendChild(rm);
    partList.appendChild(row);
    markDirty();
  }

  function pickOffer(offer) {
    // /offers/search returns offers, not placements; resolve the default
    // placement (offer detail is ordered is_default-first) then add the row.
    fetch('/api/admin/leadgen/offers/' + encodeURIComponent(offer.id), { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (detail) {
        var placements = (detail && detail.placements) ? detail.placements : [];
        var def = placements.length > 0 ? placements[0] : null;
        var k;
        for (k = 0; k < placements.length; k++) { if (placements[k].is_default) { def = placements[k]; break; } }
        if (!def) { return; }
        addParticipatingRow({ placement_id: def.id, offer_id: offer.id, offer_name: offer.offer_name, offer_type: offer.offer_type });
      });
  }

  function runOfferSearch() {
    var picker = root.querySelector('[data-offer-picker]');
    if (!picker) { return; }
    var activity = picker.getAttribute('data-activity') || '';
    var q = val('lg-a-offer-search').trim();
    var vertical = val('lg-a-offer-vertical').trim();
    var url = '/api/admin/leadgen/offers/search?q=' + encodeURIComponent(q) + '&activity=' + encodeURIComponent(activity);
    if (vertical) { url += '&vertical=' + encodeURIComponent(vertical); }
    var results = byId('lg-a-offer-results');
    fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var items = (j && j.items) ? j.items : [];
        if (!results) { return; }
        while (results.firstChild) { results.removeChild(results.firstChild); }
        var i;
        for (i = 0; i < items.length; i++) {
          (function (offer) {
            var li = makeEl('li', '');
            var b = makeEl('button', 'btn btn-sm btn-outline');
            b.type = 'button';
            b.appendChild(document.createTextNode('Add ' + (offer.offer_name || offer.public_id)));
            b.addEventListener('click', function () { pickOffer(offer); });
            li.appendChild(b);
            results.appendChild(li);
          }(items[i]));
        }
      });
  }
  var searchBtn = byId('lg-a-offer-search-btn');
  if (searchBtn) { searchBtn.addEventListener('click', runOfferSearch); }

  root.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) { return; }
    if (el.getAttribute('data-remove-participating') !== null) {
      var row = el;
      while (row && row.className && row.className.indexOf('lg-part-row') < 0) { row = row.parentNode; }
      if (row && row.parentNode) { row.parentNode.removeChild(row); markDirty(); }
    }
  });

  // --- 05 5.1 site 2: per-offer eligibility warnings off the PUT response ---
  // Operator labels for the 8 reason codes; chips are rebuilt on every save
  // (createTextNode only — no HTML injection). Ineligible offers block QUOTE
  // activation, never this auction save.
  var ELIGIBILITY_REASON_LABELS = ${JSON.stringify(LEADGEN_ELIGIBILITY_REASON_LABELS)};
  function eligibilityLabel(code) { return ELIGIBILITY_REASON_LABELS[code] || String(code || '').replace(/_/g, ' '); }

  function clearEligibilityChips() {
    if (!partList) { return; }
    var chips = partList.querySelectorAll('[data-offer-warning]');
    var i;
    for (i = 0; i < chips.length; i++) { if (chips[i].parentNode) { chips[i].parentNode.removeChild(chips[i]); } }
  }

  // m10: rows are matched by ATTRIBUTE EQUALITY (querySelectorAll + exact
  // getAttribute compare), never by interpolating the id into a CSS selector
  // string — a quote/bracket in a public id can neither throw nor mismatch.
  function findRowByAttr(attr, value) {
    if (!partList) { return null; }
    var rows = partList.querySelectorAll('[' + attr + ']');
    var k;
    for (k = 0; k < rows.length; k++) {
      if (rows[k].getAttribute(attr) === String(value)) { return rows[k]; }
    }
    return null;
  }

  function renderEligibilityWarnings(warnings, items) {
    clearEligibilityChips();
    if (!partList || !warnings) { return 0; }
    // warnings carry the offer PUBLIC id; rows are matched on it directly
    // (data-offer-public-id) with a numeric-id fallback via the items map.
    var publicToNumeric = {};
    var i;
    if (items) {
      for (i = 0; i < items.length; i++) {
        if (items[i] && items[i].offer_public_id) { publicToNumeric[items[i].offer_public_id] = items[i].offer_id; }
      }
    }
    var shown = 0;
    for (i = 0; i < warnings.length; i++) {
      var w = warnings[i];
      if (!w || !w.offer_id) { continue; }
      var row = findRowByAttr('data-offer-public-id', w.offer_id);
      if (!row && publicToNumeric[w.offer_id] !== undefined) {
        row = findRowByAttr('data-offer-id', publicToNumeric[w.offer_id]);
      }
      if (!row) { continue; }
      var reasons = w.reasons || [];
      var labels = [];
      var j;
      for (j = 0; j < reasons.length; j++) { labels.push(eligibilityLabel(reasons[j])); }
      var chip = makeEl('span', 'lg-elig-warn');
      chip.setAttribute('data-offer-warning', w.offer_id);
      chip.appendChild(document.createTextNode('Ineligible: ' + labels.join(' \\u00b7 ')));
      row.appendChild(chip);
      shown++;
    }
    return shown;
  }

  function saveParticipating() {
    if (!partList) { return; }
    var rows = partList.querySelectorAll('.lg-part-row');
    var offers = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var pid = parseInt(rows[i].getAttribute('data-placement-id'), 10);
      var orderEl = rows[i].querySelector('[data-static-order]');
      var bidEl = rows[i].querySelector('[data-static-bid]');
      var enEl = rows[i].querySelector('[data-part-enabled]');
      var entry = { offer_placement_id: pid, enabled: enEl ? !!enEl.checked : true };
      if (orderEl && orderEl.value !== '') { entry.static_order = parseInt(orderEl.value, 10); }
      if (bidEl && bidEl.value !== '') { entry.static_bid_override = Number(bidEl.value); }
      offers.push(entry);
    }
    fetch(apiBase + '/offers', {
      method: 'PUT', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ offers: offers })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        var el2 = byId('lg-a-participating-msg');
        var warned = 0;
        if (res.ok) {
          warned = renderEligibilityWarnings(res.body && res.body.warnings, res.body && res.body.items);
        }
        if (el2) {
          el2.hidden = false;
          el2.textContent = res.ok
            ? (warned > 0
              ? 'Saved. ' + warned + ' offer(s) are ineligible for live auction \\u2014 they block QUOTE activation, not this save.'
              : 'Participating offers saved.')
            : ((res.body && res.body.error) ? res.body.error : 'Save failed.');
        }
        if (res.ok) { dirty = false; }
      });
  }
  var partSave = byId('lg-a-participating-save');
  if (partSave) { partSave.addEventListener('click', saveParticipating); }

  // --- Rules add/delete -----------------------------------------------------
  var ruleLevelSel = byId('lg-r-level');
  function syncRuleFields() {
    var lvl = ruleLevelSel ? ruleLevelSel.value : 'offer';
    setHidden('[data-rule-offer-field]', lvl !== 'offer');
    setHidden('[data-rule-carrier-field]', lvl !== 'carrier');
  }
  if (ruleLevelSel) { ruleLevelSel.addEventListener('change', syncRuleFields); }
  syncRuleFields();

  function parseJsonField(id, fallback) {
    var raw = val(id).trim();
    if (raw === '') { return fallback; }
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  function addRule() {
    var lvl = val('lg-r-level');
    var conditions = parseJsonField('lg-r-conditions', { groups: [] });
    if (conditions === null) { showMsg('lg-a-rule-msg', 'Conditions must be valid JSON.', false); return; }
    var payload = {
      rule_level: lvl,
      action: val('lg-r-action'),
      conditions_json: conditions,
      priority: numVal('lg-r-priority'),
      strictly_override: isChecked('lg-r-strictly'),
      enabled: isChecked('lg-r-enabled')
    };
    if (lvl === 'offer') { payload.target_offer_id = numVal('lg-r-target-offer'); }
    else {
      var cm = parseJsonField('lg-r-carrier-match', {});
      if (cm === null) { showMsg('lg-a-rule-msg', 'Carrier match must be valid JSON.', false); return; }
      payload.carrier_match_json = cm;
    }
    fetch(apiBase + '/rules', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); })
      .then(function (res) {
        if (res.ok) { dirty = false; window.location.reload(); }
        else {
          var msg = (res.body && res.body.error) ? res.body.error : 'Add failed.';
          showMsg('lg-a-rule-msg', (res.status === 409 ? 'Conflict: ' : '') + msg, false);
        }
      });
  }
  var ruleAddBtn = byId('lg-a-rule-add');
  if (ruleAddBtn) { ruleAddBtn.addEventListener('click', addRule); }

  root.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) { return; }
    var delId = el.getAttribute('data-delete-rule');
    if (delId) {
      if (!window.confirm('Delete this rule?')) { return; }
      fetch(apiBase + '/rules/' + encodeURIComponent(delId), {
        method: 'DELETE', credentials: 'same-origin', headers: { 'Accept': 'application/json' }
      }).then(function () { dirty = false; window.location.reload(); });
    }
  });

  // --- Banner mode toggle + save --------------------------------------------
  var modeRadios = root.querySelectorAll('[data-banner-mode]');
  function currentBannerMode() {
    var i;
    for (i = 0; i < modeRadios.length; i++) { if (modeRadios[i].checked) { return modeRadios[i].value; } }
    return 'automatic';
  }
  function syncBannerMode() {
    var mode = currentBannerMode();
    var mp = root.querySelector('[data-banner-panel="manual"]');
    var ap = root.querySelector('[data-banner-panel="automatic"]');
    if (mp) { mp.className = mode === 'manual' ? 'lg-banner-mode-panel active' : 'lg-banner-mode-panel'; }
    if (ap) { ap.className = mode === 'automatic' ? 'lg-banner-mode-panel active' : 'lg-banner-mode-panel'; }
  }
  var mri;
  for (mri = 0; mri < modeRadios.length; mri++) { modeRadios[mri].addEventListener('change', function () { syncBannerMode(); markDirty(); }); }
  syncBannerMode();

  function saveBanner() {
    var mode = currentBannerMode();
    var payload = { mode: mode };
    if (mode === 'automatic') {
      var map = {};
      var inputs = root.querySelectorAll('[data-fieldmap-key]');
      var i;
      for (i = 0; i < inputs.length; i++) {
        var k = inputs[i].getAttribute('data-fieldmap-key');
        var fv = (inputs[i].value || '').trim();
        if (fv !== '') { map[k] = fv; }
      }
      payload.field_map_json = map;
    } else {
      var config = {};
      var cfgInputs = root.querySelectorAll('[data-banner-config]');
      var j;
      for (j = 0; j < cfgInputs.length; j++) {
        var ck = cfgInputs[j].getAttribute('data-banner-config');
        var cv = (cfgInputs[j].value || '').trim();
        if (cv !== '') { config[ck] = cv; }
      }
      payload.banner_config_json = config;
    }
    fetch(apiBase + '/banner', {
      method: 'PUT', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json().then(function (j2) { return { ok: r.ok, body: j2 }; }); })
      .then(function (res) {
        var el3 = byId('lg-a-banner-msg');
        if (el3) { el3.hidden = false; el3.textContent = res.ok ? 'Banner saved.' : ((res.body && res.body.error) ? res.body.error : 'Save failed.'); }
        if (res.ok) { dirty = false; }
      });
  }
  var bannerSave = byId('lg-a-banner-save');
  if (bannerSave) { bannerSave.addEventListener('click', saveBanner); }

  // --- Analytics load (§18.9) -----------------------------------------------
  var analyticsLoaded = false;
  function fmtNum(v, digits) { if (v === null || v === undefined) { return '\\u2014'; } var n = Number(v); if (!isFinite(n)) { return '\\u2014'; } return n.toFixed(digits); }
  function fmtPct2(v) { if (v === null || v === undefined) { return '\\u2014'; } var n = Number(v); if (!isFinite(n)) { return '\\u2014'; } return (n * 100).toFixed(2) + '%'; }
  function loadAnalytics() {
    if (analyticsLoaded) { return; }
    analyticsLoaded = true;
    fetch(apiBase + '/analytics', { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var a2 = (j && j.analytics) ? j.analytics : {};
        var body = byId('lg-a-analytics-body');
        if (!body) { return; }
        var cells = [
          String(a2.auctions || 0), fmtNum(a2.impressions, 0), fmtNum(a2.avg_imp_per_auction, 2),
          fmtNum(a2.avg_bid, 2), fmtNum(a2.avg_rpc, 2), fmtNum(a2.avg_clicks_per_auction, 2),
          fmtPct2(a2.fill_rate), fmtPct2(a2.unfilled_rate), fmtPct2(a2.timeout_rate),
          fmtPct2(a2.below_floor_rate), fmtPct2(a2.malformed_response_rate), fmtPct2(a2.no_bid_rate),
          fmtPct2(a2.carrier_ctr), fmtNum(a2.average_latency, 0), fmtPct2(a2.provider_error_rate), fmtNum(a2.revenue, 2)
        ];
        while (body.firstChild) { body.removeChild(body.firstChild); }
        var tr = document.createElement('tr');
        var i;
        for (i = 0; i < cells.length; i++) {
          var td = document.createElement('td');
          td.className = 'lg-num';
          td.appendChild(document.createTextNode(cells[i]));
          tr.appendChild(td);
        }
        body.appendChild(tr);
      });
  }

  // --- §7.6 simulate (S1) — dry-run explainability trace --------------------
  function parseSimJson(id) {
    var raw = val(id).replace(/^\\s+|\\s+$/g, '');
    if (raw === '') { return {}; }
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  function prettyJson(v) { try { return JSON.stringify(v, null, 2); } catch (e) { return String(v); } }
  function simChips(parent, values) {
    var i;
    for (i = 0; i < values.length; i++) {
      var c = makeEl('span', 'lg-sim-chip');
      c.appendChild(document.createTextNode(String(values[i])));
      parent.appendChild(c);
    }
  }
  // Per considered Offer: verdict + reason(s), parser id + version, expected
  // response fields, and the redacted payload preview (server-masked).
  function renderSimOffer(host, offer) {
    var card = makeEl('div', 'lg-sim-offer');
    card.setAttribute('data-sim-offer', offer.offer_id || '');
    var head = makeEl('div', 'lg-sim-offer-head');
    var title = makeEl('strong');
    title.appendChild(document.createTextNode(offer.offer_id || '(offer)'));
    head.appendChild(title);
    if (offer.placement_id) {
      var pl = makeEl('span', 'form-help');
      pl.appendChild(document.createTextNode('placement ' + offer.placement_id));
      head.appendChild(pl);
    }
    var elig = offer.eligibility;
    var excluded = !!offer.excluded_reason || (elig && elig.eligible === false);
    var verdict = makeEl('span', excluded ? 'lg-sim-excluded' : 'lg-sim-eligible');
    verdict.setAttribute('data-sim-verdict', excluded ? 'excluded' : 'eligible');
    verdict.appendChild(document.createTextNode(excluded ? 'Excluded' : 'Eligible'));
    head.appendChild(verdict);
    card.appendChild(head);

    var reasons = [];
    if (offer.excluded_reason) { reasons.push(offer.excluded_reason); }
    if (elig && elig.reasons && elig.reasons.length) { reasons = reasons.concat(elig.reasons); }
    if (reasons.length) {
      var rp = makeEl('p', 'lg-sim-reason');
      var rt = [], ri;
      for (ri = 0; ri < reasons.length; ri++) { rt.push(eligibilityLabel(reasons[ri])); }
      rp.appendChild(document.createTextNode('Reason: ' + rt.join(' \\u00b7 ')));
      card.appendChild(rp);
    }
    if (offer.parser_id || offer.carrier_parse_version) {
      var pp = makeEl('p', 'form-help');
      pp.appendChild(document.createTextNode('Parser: ' + (offer.parser_id || '\\u2014') + (offer.carrier_parse_version ? ' (v' + offer.carrier_parse_version + ')' : '')));
      card.appendChild(pp);
    }
    if (offer.expected_response_fields && offer.expected_response_fields.length) {
      var ef = makeEl('div', 'lg-sim-fields');
      var lbl = makeEl('span', 'form-help');
      lbl.appendChild(document.createTextNode('Expected response fields: '));
      ef.appendChild(lbl);
      simChips(ef, offer.expected_response_fields);
      card.appendChild(ef);
    }
    if (offer.payload_preview !== undefined && offer.payload_preview !== null) {
      var plabel = makeEl('p', 'form-help');
      plabel.appendChild(document.createTextNode('Payload preview (redacted):'));
      card.appendChild(plabel);
      var pre = makeEl('pre', 'lg-sim-payload');
      pre.setAttribute('data-sim-payload', '');
      pre.appendChild(document.createTextNode(typeof offer.payload_preview === 'string' ? offer.payload_preview : prettyJson(offer.payload_preview)));
      card.appendChild(pre);
    }
    host.appendChild(card);
  }
  function renderSimulate(body) {
    var host = byId('lg-sim-results');
    if (!host) { return; }
    while (host.firstChild) { host.removeChild(host.firstChild); }
    host.hidden = false;
    var summary = makeEl('p', 'lg-sim-summary');
    summary.appendChild(document.createTextNode('Status: ' + (body.status || '\\u2014') +
      (body.winner && body.winner.offer_id ? ' \\u00b7 winner ' + body.winner.offer_id : '') +
      (body.unfilled_reason ? ' \\u00b7 unfilled: ' + body.unfilled_reason : '')));
    host.appendChild(summary);
    var note = makeEl('p', 'form-help');
    note.setAttribute('data-sim-dryrun-note', '');
    note.appendChild(document.createTextNode('Dry-run \\u2014 no writes; staging-only carrier resolve.'));
    host.appendChild(note);
    // S1 (07 §7.6): the per-offer explainability (redacted payload_preview,
    // parser id/version, expected fields, exclusion reason) rides the additive
    // offers_payload_explain array — NOT offers_considered (which is only
    // offer_id + placement_id). Read the explain array; fall back to the bare
    // considered list only when the server omits it.
    var considered = (body.offers_payload_explain && body.offers_payload_explain.length)
      ? body.offers_payload_explain
      : (body.offers_considered || []);
    if (!considered.length) {
      var none = makeEl('p', 'form-help');
      none.appendChild(document.createTextNode('No offers considered.'));
      host.appendChild(none);
      return;
    }
    var i;
    for (i = 0; i < considered.length; i++) { renderSimOffer(host, considered[i]); }
  }
  function runSimulate() {
    var answers = parseSimJson('lg-sim-answers');
    var context = parseSimJson('lg-sim-context');
    if (answers === null) { showMsg('lg-sim-msg', 'Sample answers must be valid JSON.', false); return; }
    if (context === null) { showMsg('lg-sim-msg', 'Request context must be valid JSON.', false); return; }
    hide('lg-sim-msg');
    var btn = byId('lg-a-simulate');
    if (btn) { btn.disabled = true; }
    fetch(apiBase + '/simulate', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ sample_answers: answers, context: context })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); })
      .then(function (res) {
        if (btn) { btn.disabled = false; }
        if (!res.ok) { showMsg('lg-sim-msg', (res.body && res.body.error) ? res.body.error : ('Error ' + res.status), false); return; }
        renderSimulate(res.body || {});
      }).catch(function () {
        if (btn) { btn.disabled = false; }
        showMsg('lg-sim-msg', 'Simulation failed.', false);
      });
  }
  var simBtn = byId('lg-a-simulate');
  if (simBtn) { simBtn.addEventListener('click', runSimulate); }

  // --- unsaved-changes guard ------------------------------------------------
  window.addEventListener('beforeunload', function (ev) {
    if (dirty) { ev.preventDefault(); ev.returnValue = ''; return ''; }
  });
}());
`;



// ---------------------------------------------------------------------------
// D5 mount, wiring round — the relocated four-type editor (renderRelocated
// RulesEditor + RELOCATED_RULES_SCRIPT, DEFINED in ui-rules-builder.ts and
// imported above) mounted in the Auction editor Rules tab, bound to REAL data:
// S1.4 landed the variant-scoped rule CRUD (GET/POST /variants/:id/rules,
// PATCH/DELETE /variants/:id/rules/:rule_id, POST .../duplicate pre-existing).
// The panel carries its OWN quote -> funnel -> variant picker (populated from
// EXISTING endpoints only -- GET /quotes/:id/funnels, GET /sections?activity=,
// GET /offers -- no new read endpoint needed) since the Auction tab has no
// variant context of its own.
// ---------------------------------------------------------------------------
export function renderRelocatedFunnelRulesPanel(
  quotes: RelocatedRuleQuote[],
  defaultQuotePublicId: string | null,
): string {
  return `<div class="lg-apanel" data-panel="rules" data-pin="d5-funnel-eligibility-rules">
  <h3>Funnel eligibility rules</h3>
  <p class="form-help">Relocated from the funnel builder (\u00a713-D5): rules that gate who is eligible, disqualified, enters the auction, or is redirected to a direct offer. Pick the quote, funnel and variant to manage.</p>
  ${renderRelocatedRulesEditor({ quotes, default_quote_public_id: defaultQuotePublicId })}
</div>`;
}
