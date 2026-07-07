// LeadGen admin UI — Quotes tab (contract 03 §9.4 + 06 §15–§17, Phase-7 Stage
// B). The Quotes tab goes LIVE: the list (Create + filters + timeframe +
// after-paint §15.6 analytics hydration) and the full-page editor at
// /admin/leadgen/quotes/:id/edit — five sub-tabs: Funnel builder (§15.2 opening
// lander + §15.3 ordered sections with the auction-entry = MAX position marked,
// no "final" flag + §15.4 design selector + auction FK picker), Rules (§15.5
// IF/THEN with redirect-safety), A/B (variant list + the P8 allocation note),
// Activation (§17 per-site enable/slug/preview-url), Analytics (§15.6 read-only).
// SSR drives the JSON API in-process via ui.ts's apiJson. Inline scripts are
// strict ES5 (layout.ts constraint, asserted by the ES5 parse test). Every
// author value is escapeHtml-escaped.

import { escapeHtml, renderListPager, listFilterScript } from "../templates/layout";
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
import { listFunnelDesignOptions } from "./quotes-handlers";
import type { Paging } from "./router";

// ---------------------------------------------------------------------------
// API shapes (quotes-handlers.ts)
// ---------------------------------------------------------------------------

interface QuoteListItem {
  id: number;
  public_id: string;
  quote_name: string;
  activity: string;
  verticals_json: string[];
  status: string;
  variant_count: number;
  active_sites_count: number;
  ab_status: string;
}

interface RuleNode {
  id: number;
  public_id: string;
  rule_type: string;
  conditions_json: unknown;
  target_offer_id: number | null;
  target_section_id: number | null;
  redirect_url: string | null;
  redirect_url_allowlisted: boolean;
  priority: number;
  enabled: boolean;
}

interface VariantSectionNode {
  position: number;
  section_id: number;
  section_public_id: string;
  section_name: string;
  activity: string;
  vertical: string;
  status: string;
}

interface VariantNode {
  id: number;
  public_id: string;
  funnel_id: string;
  funnel_variant_id: string;
  variant_label: string;
  is_control: boolean;
  traffic_allocation_bp: number;
  funnel_design_id: string;
  auction_id: number | null;
  lander_enabled: boolean;
  lander_headline: string | null;
  lander_subheadline: string | null;
  lander_hero_media_url: string | null;
  sections: VariantSectionNode[];
  rules: RuleNode[];
  auction_entry_position: number | null;
}

interface AbTestNode {
  id: number;
  public_id: string;
  funnel_id: number;
  name: string;
  revision: number;
  status: string;
  started_at: number | null;
  stopped_at: number | null;
}

interface FunnelNode {
  id: number;
  public_id: string;
  funnel_id: string;
  funnel_name: string;
  status: string;
  variants: VariantNode[];
  ab_tests: AbTestNode[];
}

interface StructureBody {
  quote: {
    id: number;
    public_id: string;
    quote_id: string;
    quote_name: string;
    activity: string;
    verticals_json: string[];
    status: string;
  };
  funnels: FunnelNode[];
}

interface AvailableSection {
  id: number;
  public_id: string;
  section_name: string;
  activity: string;
  vertical: string;
  status: string;
}

interface AuctionListItem {
  id: number;
  public_id: string;
  auction_name: string;
}

interface ActivationSite {
  site_id: string;
  site_name: string;
  domain: string | null;
  activated: boolean;
  enabled: boolean;
  slug: string | null;
  preview_url: string;
}

interface ActivationBody {
  quote_id: string;
  sites: ActivationSite[];
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const LG_QUOTES_STYLES = `
.lg-editor-head{display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap}
.lg-editor-title{margin:0;font-size:20px}
.lg-editor-pubid{color:var(--c-muted);font-size:12px}
.lg-editor-spacer{flex:1}
.lg-qtabs{display:flex;gap:4px;margin:12px 0;border-bottom:1px solid var(--c-border);flex-wrap:wrap}
.lg-qtab{padding:8px 14px;color:var(--c-muted);font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px;background:none;border-top:none;border-left:none;border-right:none;cursor:pointer}
.lg-qtab.active{color:var(--c-primary);border-bottom-color:var(--c-primary)}
.lg-qpanel{display:none}
.lg-qpanel.active{display:block}
.lg-scalars{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
@media (max-width:640px){.lg-scalars{grid-template-columns:1fr}}
.lg-section-row{display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--c-border);border-radius:6px;margin-bottom:6px}
.lg-section-row .lg-pos{font-variant-numeric:tabular-nums;color:var(--c-muted);min-width:2em}
.lg-section-row .lg-grow{flex:1}
.lg-auction-entry-mark{background:var(--c-warn-bg,#fff4e5);color:var(--c-warn,#8a5300);border:1px dashed var(--c-warn,#e0a04a);border-radius:6px;padding:8px;margin:6px 0;font-size:13px}
.lg-rule-row{border:1px solid var(--c-border);border-radius:6px;padding:10px;margin-bottom:8px}
.lg-rule-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
@media (max-width:640px){.lg-rule-grid{grid-template-columns:1fr}}
.lg-activation-row{display:flex;align-items:center;gap:10px;padding:8px;border-bottom:1px solid var(--c-border);flex-wrap:wrap}
.lg-ab-note{color:var(--c-muted);font-size:13px;margin:8px 0}
.lg-preview-frame{width:100%;height:520px;border:1px solid var(--c-border);border-radius:8px;background:#fff}
.lg-num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
`;

// ---------------------------------------------------------------------------
// List page (03 §9.4)
// ---------------------------------------------------------------------------

const QUOTE_LIST_COLUMNS: ReadonlyArray<{ label: string; numeric?: boolean; metric?: string }> = [
  { label: "Name" },
  { label: "Activity" },
  { label: "Verticals" },
  { label: "Variants", numeric: true },
  { label: "A/B status" },
  { label: "Active sites", numeric: true },
  { label: "Visits", numeric: true, metric: "visits" },
  { label: "Completion rate", numeric: true, metric: "completion_rate" },
  { label: "Avg RPS", numeric: true, metric: "avg_rps" },
  { label: "Unfilled rate", numeric: true, metric: "unfilled_rate" },
  { label: "Revenue", numeric: true, metric: "revenue" },
  { label: "Actions" },
];

function abBadge(status: string): string {
  const cls = status === "running" ? "badge badge-published" : "badge badge-draft";
  return `<span class="${cls}" data-ab-status="${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function renderQuoteListRow(q: QuoteListItem): string {
  const verticals = Array.isArray(q.verticals_json) ? q.verticals_json.join(", ") : "";
  return `<tr data-entity-id="${escapeHtml(q.public_id)}" data-entity-name="${escapeHtml(q.quote_name)}">
  <td>${escapeHtml(q.quote_name)}</td>
  <td>${escapeHtml(q.activity)}</td>
  <td>${escapeHtml(verticals)}</td>
  <td class="lg-num">${q.variant_count}</td>
  <td>${abBadge(q.ab_status)}</td>
  <td class="lg-num">${q.active_sites_count}</td>
  <td class="lg-num" data-metric="visits"><span class="skel" aria-hidden="true"></span></td>
  <td class="lg-num" data-metric="completion_rate"><span class="skel" aria-hidden="true"></span></td>
  <td class="lg-num" data-metric="avg_rps"><span class="skel" aria-hidden="true"></span></td>
  <td class="lg-num" data-metric="unfilled_rate"><span class="skel" aria-hidden="true"></span></td>
  <td class="lg-num" data-metric="revenue"><span class="skel" aria-hidden="true"></span></td>
  <td>
    <a href="/admin/leadgen/quotes/${escapeHtml(q.public_id)}/edit" class="btn btn-sm btn-secondary">Edit</a>
    <button type="button" class="btn btn-sm btn-danger" data-quote-archive="${escapeHtml(q.public_id)}"${q.status === "archived" ? " disabled" : ""}>Archive</button>
  </td>
</tr>`;
}

function renderQuotesToolbar(
  filters: { search: string; activity: string; status: string },
  activities: string[],
  timeframe: Timeframe,
): string {
  const options = (values: string[], selected: string): string =>
    values
      .map((v) => `<option value="${escapeHtml(v)}"${v === selected ? " selected" : ""}>${escapeHtml(v)}</option>`)
      .join("");
  return `<div class="toolbar">
  <a href="/admin/leadgen/quotes/new" class="btn btn-primary" data-create-quote>+ Create a Quote</a>
  <div class="toolbar-search"><input type="search" name="search" class="form-input" placeholder="Search quotes…" value="${escapeHtml(filters.search)}" aria-label="Search quotes" /></div>
  <div class="toolbar-filters">
    <select name="activity" class="form-select" aria-label="Activity"><option value="">All activities</option>${options(activities, filters.activity)}</select>
    <select name="status" class="form-select" aria-label="Status"><option value="">All statuses</option><option value="draft"${filters.status === "draft" ? " selected" : ""}>draft</option><option value="active"${filters.status === "active" ? " selected" : ""}>active</option><option value="archived"${filters.status === "archived" ? " selected" : ""}>archived</option></select>
    ${renderTimeframeSelect(timeframe.key)}
  </div>
</div>`;
}

// The list-page §15.6 analytics hydrator + archive action (strict ES5). Reads
// /quotes/:id/analytics (per-funnel), aggregates across funnels, fills cells.
const QUOTE_LIST_SCRIPT = `
(function () {
  function fmtInt(v) { var n = Number(v); if (!isFinite(n)) { n = 0; } return String(Math.round(n)); }
  function fmtMoney(v) { var n = Number(v); if (!isFinite(n)) { n = 0; } return n.toFixed(2); }
  function fmtPct(v) { var n = Number(v); if (!isFinite(n)) { return '\\u2014'; } return (n * 100).toFixed(2) + '%'; }

  function aggregate(funnels) {
    var totals = { visits: 0, completions: 0, unfilled: 0, revenue: 0 };
    var i;
    for (i = 0; i < funnels.length; i++) {
      totals.visits += Number(funnels[i].visits) || 0;
      totals.completions += Number(funnels[i].completions) || 0;
      totals.unfilled += Number(funnels[i].unfilled) || 0;
      totals.revenue += Number(funnels[i].revenue) || 0;
    }
    return totals;
  }

  function cellValue(key, t) {
    if (key === 'visits') { return fmtInt(t.visits); }
    if (key === 'revenue') { return fmtMoney(t.revenue); }
    if (key === 'completion_rate') { return t.visits > 0 ? fmtPct(t.completions / t.visits) : '\\u2014'; }
    if (key === 'avg_rps') { return t.visits > 0 ? fmtMoney(t.revenue / t.visits) : '\\u2014'; }
    if (key === 'unfilled_rate') { return t.visits > 0 ? fmtPct(t.unfilled / t.visits) : '\\u2014'; }
    return '\\u2014';
  }

  function clearChildren(el) { while (el.firstChild) { el.removeChild(el.firstChild); } }

  function fillRow(table, row) {
    var id = row.getAttribute('data-entity-id');
    if (!id) { return; }
    var from = table.getAttribute('data-analytics-from') || '';
    var to = table.getAttribute('data-analytics-to') || '';
    var url = '/api/admin/leadgen/quotes/' + encodeURIComponent(id) + '/analytics?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
    fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      var funnels = (res.ok && res.body && res.body.analytics && res.body.analytics.funnels) ? res.body.analytics.funnels : [];
      var totals = aggregate(funnels);
      var cells = row.querySelectorAll('td[data-metric]');
      var i, key;
      for (i = 0; i < cells.length; i++) {
        key = cells[i].getAttribute('data-metric');
        clearChildren(cells[i]);
        cells[i].appendChild(document.createTextNode(cellValue(key, totals)));
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

  document.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) { return; }
    var archiveId = el.getAttribute('data-quote-archive');
    if (archiveId) {
      if (!window.confirm('Archive this Quote?')) { return; }
      fetch('/api/admin/leadgen/quotes/' + encodeURIComponent(archiveId), {
        method: 'DELETE', credentials: 'same-origin', headers: { 'Accept': 'application/json' }
      }).then(function () { window.location.reload(); });
    }
  });
}());
`;

export async function leadgenQuotesListPage(c: UiContext): Promise<Response> {
  const page = pageParam(c);
  const search = c.req.query("search")?.trim() ?? "";
  const activity = c.req.query("activity")?.trim() ?? "";
  const status = c.req.query("status")?.trim() ?? "";
  const timeframe = resolveTimeframe(c.req.query("range"));

  const qs = new URLSearchParams();
  if (page !== "") qs.set("page", page);
  if (search !== "") qs.set("search", search);
  if (activity !== "") qs.set("activity", activity);
  if (status !== "") qs.set("status", status);
  const query = qs.toString();

  const listed = await apiJson<ListBody<QuoteListItem>>(
    c.env,
    `/api/admin/leadgen/quotes${query === "" ? "" : `?${query}`}`,
  );
  const activitiesRes = await apiJson<{ items: string[] }>(c.env, "/api/admin/leadgen/activities");

  const items = listed.ok ? listed.body.items : [];
  const paging: Paging = listed.ok ? listed.body.paging : EMPTY_PAGING;
  const rows =
    items.length === 0
      ? `<tr><td colspan="${QUOTE_LIST_COLUMNS.length}"><div class="empty-state"><p>No quotes yet.</p><p class="form-help">Create a Quote to build a funnel.</p></div></td></tr>`
      : items.map(renderQuoteListRow).join("");

  const headerCells = QUOTE_LIST_COLUMNS.map((col) => {
    const cls = col.numeric === true ? ' class="lg-num"' : "";
    return `<th scope="col"${cls}>${escapeHtml(col.label)}</th>`;
  }).join("");

  const loadErrorHtml = listed.ok
    ? ""
    : `<p class="alert alert-error" role="alert">${escapeHtml(listed.error)}</p>`;

  const content = `${renderLeadgenTabs("quotes")}
${loadErrorHtml}
${renderQuotesToolbar({ search, activity, status }, activitiesRes.ok ? activitiesRes.body.items : [], timeframe)}
<div class="card">
  <div class="table-wrapper">
    <table class="table leadgen-quotes-list" aria-label="Quotes list" data-lg-analytics data-analytics-from="${escapeHtml(timeframe.from)}" data-analytics-to="${escapeHtml(timeframe.to)}">
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>
${renderListPager({ page: paging.page, per_page: paging.page_size, total: paging.total }, { page })}`;

  return c.html(
    leadgenPageShell({
      activePath: "/admin/leadgen/quotes",
      userEmail: branding(c).userEmail,
      content,
      styles: LG_QUOTES_STYLES,
      scripts: QUOTE_LIST_SCRIPT + listFilterScript,
    }),
  );
}

// ---------------------------------------------------------------------------
// New-quote page (§10.1-style create → then editor)
// ---------------------------------------------------------------------------

const QUOTE_NEW_SCRIPT = `
(function () {
  var form = document.getElementById('lg-quote-new-form');
  if (!form) { return; }
  var errBox = document.getElementById('lg-quote-new-error');
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var name = (document.getElementById('lg-q-name').value || '').trim();
    var activity = (document.getElementById('lg-q-activity').value || '').trim();
    var vraw = (document.getElementById('lg-q-verticals').value || '').trim();
    var verticals = [];
    var parts = vraw.split(',');
    var i;
    for (i = 0; i < parts.length; i++) { var p = parts[i].trim(); if (p) { verticals.push(p); } }
    var payload = { quote_name: name, activity: activity, verticals: verticals };
    var btn = document.getElementById('lg-quote-new-save');
    if (btn) { btn.disabled = true; }
    fetch('/api/admin/leadgen/quotes', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      if (res.ok && res.body && res.body.public_id) {
        window.location.href = '/admin/leadgen/quotes/' + encodeURIComponent(res.body.public_id) + '/edit';
        return;
      }
      if (btn) { btn.disabled = false; }
      if (errBox) {
        var msg = (res.body && res.body.error) ? res.body.error : 'Create failed';
        errBox.textContent = msg;
        errBox.hidden = false;
      }
    }).catch(function () {
      if (btn) { btn.disabled = false; }
      if (errBox) { errBox.textContent = 'Network error'; errBox.hidden = false; }
    });
  });
}());
`;

export function leadgenQuotesNewPage(c: UiContext): Response {
  const content = `${renderLeadgenTabs("quotes")}
<div class="lg-editor-head">
  <a href="/admin/leadgen/quotes" class="btn btn-outline">&#8592; Quotes</a>
  <h2 class="lg-editor-title">New Quote</h2>
</div>
<p id="lg-quote-new-error" class="alert alert-error" hidden role="alert"></p>
<div class="card">
  <form id="lg-quote-new-form" novalidate>
    <div class="lg-scalars">
      <div class="form-group">
        <label class="form-label" for="lg-q-name">Quote name *</label>
        <input id="lg-q-name" name="quote_name" class="form-input" required aria-required="true" />
      </div>
      <div class="form-group">
        <label class="form-label" for="lg-q-activity">Activity *</label>
        <input id="lg-q-activity" name="activity" class="form-input" required aria-required="true" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="lg-q-verticals">Verticals * (comma-separated)</label>
      <input id="lg-q-verticals" name="verticals" class="form-input" required aria-required="true" placeholder="life, health" />
    </div>
    <button type="submit" id="lg-quote-new-save" class="btn btn-primary">Create Quote</button>
    <span class="form-help">A funnel + control variant are created automatically (§15.1: every Quote has ≥1 variant).</span>
  </form>
</div>`;
  return c.html(
    leadgenPageShell({
      activePath: "/admin/leadgen/quotes",
      userEmail: branding(c).userEmail,
      content,
      styles: LG_QUOTES_STYLES,
      scripts: QUOTE_NEW_SCRIPT,
    }),
  );
}

// ---------------------------------------------------------------------------
// Editor page (03 §9.4) — five-tab full-page editor
// ---------------------------------------------------------------------------

function findSelectedVariant(structure: StructureBody, wanted: string): VariantNode | null {
  let firstControl: VariantNode | null = null;
  let firstAny: VariantNode | null = null;
  for (const f of structure.funnels) {
    for (const v of f.variants) {
      if (firstAny === null) firstAny = v;
      if (firstControl === null && v.is_control) firstControl = v;
      if (v.public_id === wanted) return v;
    }
  }
  return firstControl ?? firstAny;
}

function renderVariantSelector(structure: StructureBody, selected: VariantNode): string {
  const opts: string[] = [];
  for (const f of structure.funnels) {
    for (const v of f.variants) {
      const label = `${f.funnel_name} · ${v.variant_label}${v.is_control ? " (control)" : ""}`;
      opts.push(
        `<option value="${escapeHtml(v.public_id)}"${v.public_id === selected.public_id ? " selected" : ""}>${escapeHtml(label)}</option>`,
      );
    }
  }
  return `<div class="form-group">
  <label class="form-label" for="lg-variant-select">Variant</label>
  <select id="lg-variant-select" class="form-select">${opts.join("")}</select>
</div>`;
}

// Funnel-builder panel (§15.2 lander + §15.3 ordered sections + §15.4 design +
// auction picker). The MAX-position section carries a visible auction-entry
// marker (no "final" flag).
function renderBuilderPanel(
  variant: VariantNode,
  designs: Array<{ id: string; label: string }>,
  auctions: AuctionListItem[],
  available: AvailableSection[],
): string {
  const designOptions = designs
    .map((d) => `<option value="${escapeHtml(d.id)}"${d.id === variant.funnel_design_id ? " selected" : ""}>${escapeHtml(d.label)}</option>`)
    .join("");
  const auctionOptions = [`<option value="">— none —</option>`]
    .concat(
      auctions.map(
        (a) => `<option value="${a.id}"${variant.auction_id === a.id ? " selected" : ""}>${escapeHtml(a.auction_name)}</option>`,
      ),
    )
    .join("");
  const addOptions = available
    .map((s) => `<option value="${s.id}" data-section-name="${escapeHtml(s.section_name)}" data-vertical="${escapeHtml(s.vertical)}">${escapeHtml(s.section_name)} (${escapeHtml(s.vertical)})</option>`)
    .join("");

  const maxPos = variant.auction_entry_position;
  const sectionRows = variant.sections
    .map((s) => renderSectionRow(s.section_id, s.section_public_id, s.section_name, s.vertical, s.position, s.position === maxPos))
    .join("");

  return `<div class="lg-qpanel active" data-panel="builder">
  <fieldset class="card">
    <legend>Opening lander (§15.2)</legend>
    <label class="lg-check"><input type="checkbox" id="lg-lander-enabled"${variant.lander_enabled ? " checked" : ""} /> Enable opening lander</label>
    <div class="lg-scalars">
      <div class="form-group"><label class="form-label" for="lg-lander-headline">Headline</label><input id="lg-lander-headline" class="form-input" value="${escapeHtml(variant.lander_headline ?? "")}" /></div>
      <div class="form-group"><label class="form-label" for="lg-lander-sub">Subheadline</label><input id="lg-lander-sub" class="form-input" value="${escapeHtml(variant.lander_subheadline ?? "")}" /></div>
      <div class="form-group"><label class="form-label" for="lg-lander-hero">Hero media URL</label><input id="lg-lander-hero" class="form-input" value="${escapeHtml(variant.lander_hero_media_url ?? "")}" /></div>
    </div>
  </fieldset>

  <fieldset class="card">
    <legend>Funnel design (§15.4)</legend>
    <select id="lg-funnel-design" class="form-select" aria-label="Funnel design">${designOptions}</select>
  </fieldset>

  <fieldset class="card">
    <legend>Auction attribution (optional FK — auctions authored in P9)</legend>
    <select id="lg-auction-id" class="form-select" aria-label="Auction">${auctionOptions}</select>
  </fieldset>

  <fieldset class="card">
    <legend>Ordered sections (§15.3 — auction runs after the MAX position; no "final" flag)</legend>
    <div class="toolbar">
      <select id="lg-add-section-select" class="form-select" aria-label="Add section">${addOptions || `<option value="">No sections for this activity</option>`}</select>
      <button type="button" id="lg-add-section" class="btn btn-secondary">Add section</button>
    </div>
    <div id="lg-section-list" data-max-position="${maxPos === null ? "" : maxPos}">${sectionRows || `<p class="form-help" data-empty-sections>No sections yet — add at least one to publish (§15.3).</p>`}</div>
  </fieldset>

  <template id="lg-section-row-tpl">${renderSectionRow(0, "", "", "", 0, false)}</template>
</div>`;
}

function renderSectionRow(
  sectionId: number,
  sectionPublicId: string,
  name: string,
  vertical: string,
  position: number,
  isAuctionEntry: boolean,
): string {
  const marker = isAuctionEntry
    ? `<div class="lg-auction-entry-mark" data-auction-entry="1">Auction runs after this section (§15.3 max position)</div>`
    : "";
  return `<div class="lg-section-row" data-section-id="${sectionId}" data-section-public-id="${escapeHtml(sectionPublicId)}">
  <span class="lg-pos" data-pos>${position}</span>
  <span class="lg-grow" data-section-name>${escapeHtml(name)}</span>
  <span class="form-help" data-vertical>${escapeHtml(vertical)}</span>
  <button type="button" class="btn btn-sm btn-outline" data-move-up aria-label="Move up">&#8593;</button>
  <button type="button" class="btn btn-sm btn-outline" data-move-down aria-label="Move down">&#8595;</button>
  <button type="button" class="btn btn-sm btn-danger" data-remove-section aria-label="Remove">Remove</button>
</div>${marker}`;
}

// Rules panel (§15.5).
function renderRuleRow(rule: RuleNode | null): string {
  const ruleTypes = ["redirect_direct_offer", "skip_section", "show_section", "eligibility", "disqualification", "auction_entry"];
  const selectedType = rule?.rule_type ?? "eligibility";
  const typeOptions = ruleTypes
    .map((t) => `<option value="${t}"${t === selectedType ? " selected" : ""}>${t}</option>`)
    .join("");
  const conditions = rule ? JSON.stringify(rule.conditions_json ?? { groups: [] }) : `{"groups":[]}`;
  return `<div class="lg-rule-row" data-rule-row>
  <div class="lg-rule-grid">
    <div class="form-group"><label class="form-label">Rule type</label><select class="form-select" data-rule-type>${typeOptions}</select></div>
    <div class="form-group"><label class="form-label">Target offer id (redirect_direct_offer)</label><input class="form-input" data-rule-target-offer value="${rule?.target_offer_id ?? ""}" /></div>
    <div class="form-group"><label class="form-label">Priority</label><input class="form-input" data-rule-priority value="${rule?.priority ?? 100}" /></div>
  </div>
  <div class="lg-rule-grid">
    <div class="form-group"><label class="form-label">Raw redirect URL (allowlist-gated)</label><input class="form-input" data-rule-redirect-url value="${escapeHtml(rule?.redirect_url ?? "")}" /></div>
    <div class="form-group"><label class="lg-check"><input type="checkbox" data-rule-allowlisted${rule?.redirect_url_allowlisted ? " checked" : ""} /> redirect_url_allowlisted</label></div>
    <div class="form-group"><label class="lg-check"><input type="checkbox" data-rule-enabled${rule === null || rule.enabled ? " checked" : ""} /> enabled</label></div>
  </div>
  <div class="form-group"><label class="form-label">Conditions JSON (§21.4)</label><textarea class="form-input" data-rule-conditions rows="2">${escapeHtml(conditions)}</textarea></div>
  <button type="button" class="btn btn-sm btn-danger" data-remove-rule>Remove rule</button>
</div>`;
}

function renderRulesPanel(variant: VariantNode): string {
  const rows = variant.rules.map((r) => renderRuleRow(r)).join("");
  return `<div class="lg-qpanel" data-panel="rules">
  <div class="card">
    <div class="toolbar"><button type="button" id="lg-add-rule" class="btn btn-secondary">+ Add rule</button></div>
    <p class="form-help">redirect_direct_offer uses a target offer (governed URL). A raw redirect URL is honored only when allowlisted AND its host is on the admin allowlist (§15.5).</p>
    <div id="lg-rule-list">${rows || `<p class="form-help" data-empty-rules>No rules.</p>`}</div>
  </div>
  <template id="lg-rule-row-tpl">${renderRuleRow(null)}</template>
</div>`;
}

// A/B panel (§16.2) — per-variant percent allocation (stored as basis points),
// a live Σ indicator, the test lifecycle (create / start / stop), and an
// assignment preview. Scoped to the SELECTED variant's funnel (its arms).
function renderAbPanel(structure: StructureBody, selected: VariantNode): string {
  const funnel =
    structure.funnels.find((f) => f.funnel_id === selected.funnel_id) ?? structure.funnels[0] ?? null;
  const variants = funnel?.variants ?? [];
  const tests = funnel?.ab_tests ?? [];
  const running = tests.find((t) => t.status === "running") ?? null;
  const activeTest = running ?? tests[0] ?? null; // ab_tests are newest-first

  // Per-variant percent input. UI shows % (bp/100); the client stores bp (%*100).
  const allocRows = variants
    .map((v) => {
      const pct = v.traffic_allocation_bp / 100;
      return `<div class="lg-alloc-row" data-variant="${escapeHtml(v.public_id)}">
    <span class="lg-alloc-label"><strong>${escapeHtml(v.variant_label)}</strong>${v.is_control ? " (control)" : ""}</span>
    <label class="lg-alloc-pct"><input type="number" class="form-input lg-alloc-input" data-alloc-input
      data-variant-id="${escapeHtml(v.public_id)}" data-variant-label="${escapeHtml(v.variant_label)}"
      min="0" max="100" step="0.01" value="${escapeHtml(String(pct))}" /> %</label>
    <code class="lg-editor-pubid">${escapeHtml(v.public_id)}</code>
  </div>`;
    })
    .join("");

  let lifecycle: string;
  if (running !== null) {
    lifecycle = `<span class="lg-ab-status" data-ab-status="running">Running · rev ${running.revision}</span>
      <button type="button" class="btn btn-outline" data-stop-experiment="${escapeHtml(running.public_id)}">Stop A/B test</button>`;
  } else if (activeTest !== null) {
    lifecycle = `<span class="lg-ab-status" data-ab-status="${escapeHtml(activeTest.status)}">${escapeHtml(activeTest.status)} · rev ${activeTest.revision}</span>
      <button type="button" class="btn btn-secondary" data-start-experiment="${escapeHtml(activeTest.public_id)}">Start A/B test</button>`;
  } else {
    lifecycle = `<button type="button" id="lg-create-experiment" class="btn btn-secondary" data-quote-public-id="${escapeHtml(structure.quote.public_id)}">Create A/B test</button>`;
  }

  const preview =
    activeTest !== null
      ? `<div class="card lg-ab-preview">
    <h3>Assignment preview (§16.2)</h3>
    <p class="form-help">Enter a sample session id to see which variant it deterministically buckets to (the same edge hash the runtime serves).</p>
    <div class="lg-ab-preview-row">
      <input type="text" class="form-input" id="lg-ab-preview-session" placeholder="sample ko_sid value" />
      <button type="button" class="btn btn-outline" data-preview-assignment="${escapeHtml(activeTest.public_id)}">Preview assignment</button>
    </div>
    <p class="form-help" id="lg-ab-preview-result" data-ab-preview-result></p>
  </div>`
      : "";

  return `<div class="lg-qpanel" data-panel="ab">
  <div class="card">
    <h3>Traffic allocation (§16.2)</h3>
    <p class="form-help">Each variant's share of traffic. Percentages must sum to <strong>100%</strong> (stored as basis points; per-test Σ == 10000) before a test can start.</p>
    <div id="lg-ab-variant-list" class="lg-alloc-list">${allocRows || `<p class="form-help">No variants.</p>`}</div>
    <p class="lg-alloc-summary">Σ = <strong data-alloc-sum>&mdash;</strong> <span data-alloc-sum-note class="form-help"></span></p>
    <div class="toolbar">
      <button type="button" id="lg-save-allocations" class="btn btn-primary">Save allocations</button>
      <button type="button" class="btn btn-outline" data-fork-variant="${escapeHtml(selected.public_id)}">Fork this variant</button>
      ${lifecycle}
    </div>
  </div>
  ${preview}
</div>`;
}

// Activation panel (§17 per-site).
function renderActivationPanel(activation: ActivationBody | null): string {
  const sites = activation?.sites ?? [];
  const rows = sites
    .map(
      (s) => `<div class="lg-activation-row" data-site-id="${escapeHtml(s.site_id)}">
  <label class="lg-check"><input type="checkbox" data-site-enabled${s.enabled ? " checked" : ""} /> ${escapeHtml(s.site_name)}</label>
  <input class="form-input" data-site-slug placeholder="slug (blank = root /lg)" value="${escapeHtml(s.slug ?? "")}" />
  <a href="${escapeHtml(s.preview_url)}" class="form-help" data-preview-url target="_blank" rel="noopener">${escapeHtml(s.preview_url)}</a>
  <button type="button" class="btn btn-sm btn-secondary" data-save-activation>Save</button>
  <button type="button" class="btn btn-sm btn-outline" data-deactivate>Deactivate</button>
</div>`,
    )
    .join("");
  return `<div class="lg-qpanel" data-panel="activation">
  <div class="card">
    <h3>Site activation (§17)</h3>
    <p class="form-help">At most one enabled root (blank slug) per site (§17.1). Activating a second root while one is enabled is rejected — disable it or set a slug.</p>
    <div id="lg-activation-list">${rows || `<p class="form-help" data-empty-activation>No sites available.</p>`}</div>
  </div>
</div>`;
}

// Analytics panel (§15.6 read-only) — filled after paint.
function renderAnalyticsPanel(): string {
  return `<div class="lg-qpanel" data-panel="analytics">
  <div class="card">
    <h3>Funnel analytics (§15.6)</h3>
    <div class="table-wrapper">
      <table class="table" id="lg-analytics-table" aria-label="Funnel analytics">
        <thead><tr>
          <th scope="col">Funnel</th><th scope="col" class="lg-num">Visits</th><th scope="col" class="lg-num">Bounce</th>
          <th scope="col" class="lg-num">Completion</th><th scope="col" class="lg-num">CVR (clicks)</th>
          <th scope="col" class="lg-num">CVR (completed)</th><th scope="col" class="lg-num">Avg RPC</th>
          <th scope="col" class="lg-num">Avg RPS</th><th scope="col" class="lg-num">Unfilled</th><th scope="col" class="lg-num">Revenue</th>
        </tr></thead>
        <tbody id="lg-analytics-body"><tr><td colspan="10" class="form-help">Loading…</td></tr></tbody>
      </table>
    </div>
  </div>
</div>`;
}

// The #lg-quote-data JSON state blob. `<`-escaped so a hostile author value can
// never break out of the <script type="application/json">.
function quoteDataBlob(structure: StructureBody, selected: VariantNode): string {
  const data = {
    quote_public_id: structure.quote.public_id,
    quote_id: structure.quote.quote_id,
    activity: structure.quote.activity,
    selected_variant: selected.public_id,
  };
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function quoteEditorHtml(
  structure: StructureBody,
  selected: VariantNode,
  designs: Array<{ id: string; label: string }>,
  auctions: AuctionListItem[],
  available: AvailableSection[],
  activation: ActivationBody | null,
  brand: { userEmail?: string },
): string {
  const q = structure.quote;
  const head = `<div class="lg-editor-head">
    <a href="/admin/leadgen/quotes" class="btn btn-outline">&#8592; Quotes</a>
    <h2 class="lg-editor-title">${escapeHtml(q.quote_name)}</h2>
    <code class="lg-editor-pubid">${escapeHtml(q.public_id)}</code>${statusBadge(q.status)}
    <span class="lg-editor-spacer"></span>
    <button type="button" id="lg-variant-preview" class="btn btn-outline">Preview</button>
    <button type="button" id="lg-variant-save" class="btn btn-primary">Save variant</button>
  </div>`;

  const subtabs = `<nav class="lg-qtabs" aria-label="Quote editor tabs">
  <button type="button" class="lg-qtab active" data-tab="builder">Funnel builder</button>
  <button type="button" class="lg-qtab" data-tab="rules">Rules</button>
  <button type="button" class="lg-qtab" data-tab="ab">A/B</button>
  <button type="button" class="lg-qtab" data-tab="activation">Activation</button>
  <button type="button" class="lg-qtab" data-tab="analytics">Analytics</button>
</nav>`;

  const content = `${renderLeadgenTabs("quotes")}
<div id="lg-quote-editor" data-quote-id="${q.id}" data-quote-public-id="${escapeHtml(q.public_id)}" data-variant-public-id="${escapeHtml(selected.public_id)}" data-variant-funnel-id="${escapeHtml(selected.funnel_id)}" data-variant-funnel-variant-id="${escapeHtml(selected.funnel_variant_id)}">
  ${head}
  <p id="lg-quote-error" class="alert alert-error" hidden role="alert"></p>
  <p id="lg-quote-ok" class="alert alert-success" hidden role="status"></p>
  ${renderVariantSelector(structure, selected)}
  ${subtabs}
  ${renderBuilderPanel(selected, designs, auctions, available)}
  ${renderRulesPanel(selected)}
  ${renderAbPanel(structure, selected)}
  ${renderActivationPanel(activation)}
  ${renderAnalyticsPanel()}
  <iframe id="lg-preview-iframe" class="lg-preview-frame" title="Funnel preview" sandbox="allow-same-origin" hidden></iframe>
  <script type="application/json" id="lg-quote-data">${quoteDataBlob(structure, selected)}</script>
</div>`;

  return leadgenPageShell({
    activePath: "/admin/leadgen/quotes",
    userEmail: brand.userEmail,
    content,
    styles: LG_QUOTES_STYLES,
    scripts: QUOTE_EDITOR_SCRIPT,
  });
}

function quoteNotFoundPage(brand: { userEmail?: string }): string {
  const content = `${renderLeadgenTabs("quotes")}
<div class="card"><div class="empty-state">
  <p>Quote not found.</p>
  <a href="/admin/leadgen/quotes" class="btn btn-primary">Back to Quotes</a>
</div></div>`;
  return leadgenPageShell({
    activePath: "/admin/leadgen/quotes",
    userEmail: brand.userEmail,
    content,
    styles: LG_QUOTES_STYLES,
  });
}

export async function leadgenQuoteEditorPage(c: UiContext): Promise<Response> {
  const idParam = c.req.param("id") ?? "";
  const structureRes = await apiJson<StructureBody>(
    c.env,
    `/api/admin/leadgen/quotes/${encodeURIComponent(idParam)}/structure`,
  );
  if (!structureRes.ok) return c.html(quoteNotFoundPage(branding(c)), 404);
  const structure = structureRes.body;

  const wanted = c.req.query("variant")?.trim() ?? "";
  const selected = findSelectedVariant(structure, wanted);
  if (selected === null) return c.html(quoteNotFoundPage(branding(c)), 404);

  const activity = structure.quote.activity;
  const encodedQuote = encodeURIComponent(structure.quote.public_id);
  const sectionsRes = await apiJson<ListBody<AvailableSection>>(
    c.env,
    `/api/admin/leadgen/sections?activity=${encodeURIComponent(activity)}&status=active&page_size=200`,
  );
  const auctionsRes = await apiJson<ListBody<AuctionListItem>>(
    c.env,
    `/api/admin/leadgen/auctions?page_size=200`,
  );
  const activationRes = await apiJson<ActivationBody>(
    c.env,
    `/api/admin/leadgen/quotes/${encodedQuote}/activation`,
  );

  return c.html(
    quoteEditorHtml(
      structure,
      selected,
      listFunnelDesignOptions(),
      auctionsRes.ok ? auctionsRes.body.items : [],
      sectionsRes.ok ? sectionsRes.body.items : [],
      activationRes.ok ? activationRes.body : null,
      branding(c),
    ),
  );
}

// ---------------------------------------------------------------------------
// Editor inline script (strict ES5) — tabs, section-order, rules, save,
// preview, activation, A/B lifecycle, unsaved-changes guard.
// ---------------------------------------------------------------------------

const QUOTE_EDITOR_SCRIPT = `
(function () {
  var root = document.getElementById('lg-quote-editor');
  if (!root) { return; }
  var dirty = false;
  function markDirty() { dirty = true; }

  var quotePublicId = root.getAttribute('data-quote-public-id') || '';
  var variantPublicId = root.getAttribute('data-variant-public-id') || '';

  function byId(id) { return document.getElementById(id); }
  function showMsg(id, text) { var el = byId(id); if (el) { el.textContent = text; el.hidden = false; } }
  function hideMsg(id) { var el = byId(id); if (el) { el.hidden = true; } }

  // --- variant switch: reload the editor scoped to the chosen variant -------
  var variantSelect = byId('lg-variant-select');
  if (variantSelect) {
    variantSelect.addEventListener('change', function () {
      window.location.href = '/admin/leadgen/quotes/' + encodeURIComponent(quotePublicId) + '/edit?variant=' + encodeURIComponent(this.value);
    });
  }

  // --- sub-tab switching ----------------------------------------------------
  var tabs = root.querySelectorAll('.lg-qtab');
  var panels = root.querySelectorAll('.lg-qpanel');
  function activate(name) {
    var i;
    for (i = 0; i < tabs.length; i++) {
      if (tabs[i].getAttribute('data-tab') === name) { tabs[i].className = 'lg-qtab active'; } else { tabs[i].className = 'lg-qtab'; }
    }
    for (i = 0; i < panels.length; i++) {
      if (panels[i].getAttribute('data-panel') === name) { panels[i].className = 'lg-qpanel active'; } else { panels[i].className = 'lg-qpanel'; }
    }
    if (name === 'analytics') { loadAnalytics(); }
  }
  var ti;
  for (ti = 0; ti < tabs.length; ti++) {
    tabs[ti].addEventListener('click', function () { activate(this.getAttribute('data-tab')); });
  }

  // --- section order --------------------------------------------------------
  var sectionList = byId('lg-section-list');
  function renumber() {
    if (!sectionList) { return; }
    var rows = sectionList.querySelectorAll('.lg-section-row');
    var i;
    // drop stale auction markers
    var marks = sectionList.querySelectorAll('.lg-auction-entry-mark');
    for (i = 0; i < marks.length; i++) { marks[i].parentNode.removeChild(marks[i]); }
    for (i = 0; i < rows.length; i++) {
      var pos = rows[i].querySelector('[data-pos]');
      if (pos) { pos.textContent = String(i); }
    }
    // mark the MAX-position (last) row as the auction entry (§15.3)
    if (rows.length > 0) {
      var last = rows[rows.length - 1];
      var mark = document.createElement('div');
      mark.className = 'lg-auction-entry-mark';
      mark.setAttribute('data-auction-entry', '1');
      mark.appendChild(document.createTextNode('Auction runs after this section (\\u00a715.3 max position)'));
      if (last.nextSibling) { last.parentNode.insertBefore(mark, last.nextSibling); } else { last.parentNode.appendChild(mark); }
    }
    var empty = sectionList.querySelector('[data-empty-sections]');
    if (empty) { empty.parentNode.removeChild(empty); }
  }

  var addSectionBtn = byId('lg-add-section');
  if (addSectionBtn) {
    addSectionBtn.addEventListener('click', function () {
      var sel = byId('lg-add-section-select');
      if (!sel || !sel.value) { return; }
      var opt = sel.options[sel.selectedIndex];
      var tpl = byId('lg-section-row-tpl');
      var frag = tpl.content ? document.importNode(tpl.content, true) : null;
      var row = frag ? frag.querySelector('.lg-section-row') : null;
      if (!row) { return; }
      row.setAttribute('data-section-id', sel.value);
      row.setAttribute('data-section-public-id', '');
      var nameEl = row.querySelector('[data-section-name]');
      if (nameEl) { nameEl.textContent = opt.getAttribute('data-section-name') || ''; }
      var vEl = row.querySelector('[data-vertical]');
      if (vEl) { vEl.textContent = opt.getAttribute('data-vertical') || ''; }
      sectionList.appendChild(row);
      renumber();
      markDirty();
    });
  }

  if (sectionList) {
    sectionList.addEventListener('click', function (ev) {
      var el = ev.target;
      if (!el || !el.getAttribute) { return; }
      var row = el;
      while (row && row.className !== undefined && String(row.className).indexOf('lg-section-row') < 0) { row = row.parentNode; }
      if (!row || !row.getAttribute) { return; }
      if (el.getAttribute('data-remove-section') !== null && el.getAttribute('data-remove-section') !== undefined && el.hasAttribute('data-remove-section')) {
        row.parentNode.removeChild(row);
        renumber();
        markDirty();
        return;
      }
      if (el.hasAttribute('data-move-up')) {
        var prev = row.previousElementSibling;
        while (prev && String(prev.className).indexOf('lg-section-row') < 0) { prev = prev.previousElementSibling; }
        if (prev) { row.parentNode.insertBefore(row, prev); renumber(); markDirty(); }
        return;
      }
      if (el.hasAttribute('data-move-down')) {
        var next = row.nextElementSibling;
        while (next && String(next.className).indexOf('lg-section-row') < 0) { next = next.nextElementSibling; }
        if (next) { row.parentNode.insertBefore(next, row); renumber(); markDirty(); }
        return;
      }
    });
  }

  // --- rules ----------------------------------------------------------------
  var ruleList = byId('lg-rule-list');
  var addRuleBtn = byId('lg-add-rule');
  if (addRuleBtn) {
    addRuleBtn.addEventListener('click', function () {
      var tpl = byId('lg-rule-row-tpl');
      var frag = tpl.content ? document.importNode(tpl.content, true) : null;
      var row = frag ? frag.querySelector('[data-rule-row]') : null;
      if (row) { ruleList.appendChild(row); markDirty(); }
      var empty = ruleList.querySelector('[data-empty-rules]');
      if (empty) { empty.parentNode.removeChild(empty); }
    });
  }
  if (ruleList) {
    ruleList.addEventListener('click', function (ev) {
      var el = ev.target;
      if (el && el.hasAttribute && el.hasAttribute('data-remove-rule')) {
        var row = el;
        while (row && row.getAttribute && !row.hasAttribute('data-rule-row')) { row = row.parentNode; }
        if (row && row.parentNode) { row.parentNode.removeChild(row); markDirty(); }
      }
    });
  }

  // --- collect + save (PUT /variants/:id) -----------------------------------
  function collectSections() {
    var out = [];
    if (!sectionList) { return out; }
    var rows = sectionList.querySelectorAll('.lg-section-row');
    var i;
    for (i = 0; i < rows.length; i++) {
      var sid = rows[i].getAttribute('data-section-id');
      out.push({ section_id: Number(sid), position: i });
    }
    return out;
  }
  function collectRules() {
    var out = [];
    if (!ruleList) { return out; }
    var rows = ruleList.querySelectorAll('[data-rule-row]');
    var i;
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      var conditions = { groups: [] };
      var cEl = r.querySelector('[data-rule-conditions]');
      if (cEl && cEl.value) { try { conditions = JSON.parse(cEl.value); } catch (e) { conditions = { groups: [] }; } }
      var offerEl = r.querySelector('[data-rule-target-offer]');
      var offerVal = offerEl && offerEl.value ? Number(offerEl.value) : null;
      var prioEl = r.querySelector('[data-rule-priority]');
      var urlEl = r.querySelector('[data-rule-redirect-url]');
      out.push({
        rule_type: r.querySelector('[data-rule-type]').value,
        target_offer_id: offerVal,
        redirect_url: urlEl && urlEl.value ? urlEl.value : null,
        redirect_url_allowlisted: r.querySelector('[data-rule-allowlisted]').checked,
        enabled: r.querySelector('[data-rule-enabled]').checked,
        priority: prioEl && prioEl.value ? Number(prioEl.value) : 100,
        conditions_json: conditions
      });
    }
    return out;
  }
  function collectPayload() {
    var auctionSel = byId('lg-auction-id');
    var auctionVal = auctionSel && auctionSel.value ? Number(auctionSel.value) : null;
    return {
      lander_enabled: byId('lg-lander-enabled').checked,
      lander_headline: byId('lg-lander-headline').value,
      lander_subheadline: byId('lg-lander-sub').value,
      lander_hero_media_url: byId('lg-lander-hero').value,
      funnel_design_id: byId('lg-funnel-design').value,
      auction_id: auctionVal,
      sections: collectSections(),
      rules: collectRules()
    };
  }
  var saveBtn = byId('lg-variant-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      hideMsg('lg-quote-error'); hideMsg('lg-quote-ok');
      saveBtn.disabled = true;
      fetch('/api/admin/leadgen/variants/' + encodeURIComponent(variantPublicId), {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(collectPayload())
      }).then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, body: j }; });
      }).then(function (res) {
        saveBtn.disabled = false;
        if (res.ok) { dirty = false; showMsg('lg-quote-ok', 'Saved.'); }
        else {
          var msg = (res.body && res.body.error) ? res.body.error : 'Save failed';
          if (res.body && res.body.fields) { msg = msg + ': ' + JSON.stringify(res.body.fields); }
          showMsg('lg-quote-error', msg);
        }
      }).catch(function () { saveBtn.disabled = false; showMsg('lg-quote-error', 'Network error'); });
    });
  }

  // --- preview (POST /variants/:id/preview → sandboxed iframe) ---------------
  var previewBtn = byId('lg-variant-preview');
  if (previewBtn) {
    previewBtn.addEventListener('click', function () {
      fetch('/api/admin/leadgen/variants/' + encodeURIComponent(variantPublicId) + '/preview', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({})
      }).then(function (r) { return r.json(); }).then(function (body) {
        var frame = byId('lg-preview-iframe');
        if (!frame || !body || !body.preview) { return; }
        frame.hidden = false;
        var doc = '<!doctype html><html><head><meta charset="utf-8"><style>' + (body.preview.css || '') + '</style></head><body>' + (body.preview.desktop || '') + '</body></html>';
        frame.setAttribute('srcdoc', doc);
      });
    });
  }

  // --- A/B (§16.2): allocation Σ, save, lifecycle (create/start/stop), preview -
  function allocInputs() { return root.querySelectorAll('[data-alloc-input]'); }
  function recomputeAllocSum() {
    var inputs = allocInputs();
    var sumBp = 0;
    var i;
    for (i = 0; i < inputs.length; i++) {
      var pct = parseFloat(inputs[i].value);
      if (isFinite(pct)) { sumBp += Math.round(pct * 100); }
    }
    var sumEl = root.querySelector('[data-alloc-sum]');
    var noteEl = root.querySelector('[data-alloc-sum-note]');
    if (sumEl) { sumEl.textContent = (sumBp / 100).toFixed(2) + '%'; }
    if (noteEl) {
      noteEl.textContent = sumBp === 10000 ? '(ok — sums to 100%)' : '(must equal 100% to start)';
    }
    return sumBp;
  }
  var allocList = byId('lg-ab-variant-list');
  if (allocList) {
    allocList.addEventListener('input', function (ev) {
      if (ev.target && ev.target.getAttribute && ev.target.getAttribute('data-alloc-input') !== null) { recomputeAllocSum(); }
    });
    recomputeAllocSum();
  }

  var saveAllocBtn = byId('lg-save-allocations');
  if (saveAllocBtn) {
    saveAllocBtn.addEventListener('click', function () {
      var inputs = allocInputs();
      var puts = [];
      var i;
      for (i = 0; i < inputs.length; i++) {
        var vid = inputs[i].getAttribute('data-variant-id');
        var pct = parseFloat(inputs[i].value);
        if (!vid || !isFinite(pct)) { continue; }
        var bp = Math.round(pct * 100);
        puts.push(fetch('/api/admin/leadgen/variants/' + encodeURIComponent(vid), {
          method: 'PUT', credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ traffic_allocation_bp: bp })
        }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); }));
      }
      saveAllocBtn.disabled = true;
      Promise.all(puts).then(function (results) {
        saveAllocBtn.disabled = false;
        var k;
        var failed = null;
        for (k = 0; k < results.length; k++) { if (!results[k].ok) { failed = results[k].body; break; } }
        if (failed) { showMsg('lg-quote-error', (failed && failed.fields && failed.fields.traffic_allocation_bp) ? failed.fields.traffic_allocation_bp : 'Allocation save failed'); }
        else { showMsg('lg-quote-ok', 'Allocations saved.'); recomputeAllocSum(); }
      });
    });
  }

  var createExpBtn = byId('lg-create-experiment');
  if (createExpBtn) {
    createExpBtn.addEventListener('click', function () {
      createExpBtn.disabled = true;
      fetch('/api/admin/leadgen/quotes/' + encodeURIComponent(quotePublicId) + '/experiments', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({})
      }).then(function (r) { return r.json(); }).then(function () { window.location.reload(); });
    });
  }

  document.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) { return; }

    var forkId = el.getAttribute('data-fork-variant');
    if (forkId) {
      fetch('/api/admin/leadgen/variants/' + encodeURIComponent(forkId) + '/fork', {
        method: 'POST', credentials: 'same-origin', headers: { 'Accept': 'application/json' }
      }).then(function (r) { return r.json(); }).then(function (body) {
        if (body && body.public_id) { window.location.href = '/admin/leadgen/quotes/' + encodeURIComponent(quotePublicId) + '/edit?variant=' + encodeURIComponent(body.public_id); }
      });
      return;
    }

    var startId = el.getAttribute('data-start-experiment');
    if (startId) {
      el.disabled = true;
      fetch('/api/admin/leadgen/experiments/' + encodeURIComponent(startId) + '/start', {
        method: 'POST', credentials: 'same-origin', headers: { 'Accept': 'application/json' }
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); }).then(function (res) {
        el.disabled = false;
        if (res.ok) { window.location.reload(); }
        else { showMsg('lg-quote-error', (res.body && res.body.fields && res.body.fields.traffic_allocation_bp) ? res.body.fields.traffic_allocation_bp : ((res.body && res.body.error) ? res.body.error : 'Start failed')); }
      });
      return;
    }

    var stopId = el.getAttribute('data-stop-experiment');
    if (stopId) {
      el.disabled = true;
      fetch('/api/admin/leadgen/experiments/' + encodeURIComponent(stopId) + '/stop', {
        method: 'POST', credentials: 'same-origin', headers: { 'Accept': 'application/json' }
      }).then(function () { window.location.reload(); });
      return;
    }

    var previewId = el.getAttribute('data-preview-assignment');
    if (previewId) {
      var sessEl = byId('lg-ab-preview-session');
      var resultEl = byId('lg-ab-preview-result');
      var sid = sessEl && sessEl.value ? sessEl.value : '';
      if (!sid) { if (resultEl) { resultEl.textContent = 'Enter a sample session id first.'; } return; }
      fetch('/api/admin/leadgen/experiments/' + encodeURIComponent(previewId) + '/assignment-preview?session_id=' + encodeURIComponent(sid), {
        credentials: 'same-origin', headers: { 'Accept': 'application/json' }
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); }).then(function (res) {
        if (!resultEl) { return; }
        if (res.ok && res.body && res.body.variant) {
          resultEl.textContent = 'Session "' + sid + '" maps to variant ' + res.body.variant.variant_label + ' (' + res.body.variant.funnel_variant_id + '), bucket ' + res.body.assignment_bucket + ' of 10000.';
        } else {
          resultEl.textContent = (res.body && res.body.error) ? res.body.error : 'Preview failed.';
        }
      });
      return;
    }
  });

  // --- activation (per-site PUT/DELETE) -------------------------------------
  var activationList = byId('lg-activation-list');
  if (activationList) {
    activationList.addEventListener('click', function (ev) {
      var el = ev.target;
      if (!el || !el.getAttribute) { return; }
      var row = el;
      while (row && row.getAttribute && !row.hasAttribute('data-site-id')) { row = row.parentNode; }
      if (!row || !row.getAttribute) { return; }
      var siteId = row.getAttribute('data-site-id');
      if (el.hasAttribute('data-save-activation')) {
        var enabled = row.querySelector('[data-site-enabled]').checked;
        var slugEl = row.querySelector('[data-site-slug]');
        var slug = slugEl && slugEl.value ? slugEl.value : null;
        fetch('/api/admin/leadgen/quotes/' + encodeURIComponent(quotePublicId) + '/activation/' + encodeURIComponent(siteId), {
          method: 'PUT', credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ enabled: enabled, slug: slug })
        }).then(function (r) {
          return r.json().then(function (j) { return { ok: r.ok, body: j }; });
        }).then(function (res) {
          if (res.ok) { showMsg('lg-quote-ok', 'Activation saved for ' + siteId); }
          else { showMsg('lg-quote-error', (res.body && res.body.error ? res.body.error : 'Activation failed') + (res.body && res.body.fields ? ': ' + JSON.stringify(res.body.fields) : '')); }
        });
        return;
      }
      if (el.hasAttribute('data-deactivate')) {
        fetch('/api/admin/leadgen/quotes/' + encodeURIComponent(quotePublicId) + '/activation/' + encodeURIComponent(siteId), {
          method: 'DELETE', credentials: 'same-origin', headers: { 'Accept': 'application/json' }
        }).then(function () { window.location.reload(); });
      }
    });
  }

  // --- analytics panel (§15.6 read-only) ------------------------------------
  var analyticsLoaded = false;
  function fmtPct(v) { var n = Number(v); if (!isFinite(n)) { return '\\u2014'; } return (n * 100).toFixed(2) + '%'; }
  function orDash(v) { if (v === null || v === undefined) { return '\\u2014'; } var n = Number(v); return isFinite(n) ? String(n) : '\\u2014'; }
  function money(v) { var n = Number(v); if (!isFinite(n)) { return '\\u2014'; } return n.toFixed(2); }
  function loadAnalytics() {
    if (analyticsLoaded) { return; }
    analyticsLoaded = true;
    fetch('/api/admin/leadgen/quotes/' + encodeURIComponent(quotePublicId) + '/analytics', {
      credentials: 'same-origin', headers: { 'Accept': 'application/json' }
    }).then(function (r) { return r.json(); }).then(function (body) {
      var tbody = byId('lg-analytics-body');
      if (!tbody) { return; }
      while (tbody.firstChild) { tbody.removeChild(tbody.firstChild); }
      var funnels = (body && body.analytics && body.analytics.funnels) ? body.analytics.funnels : [];
      if (funnels.length === 0) {
        var tr0 = document.createElement('tr');
        var td0 = document.createElement('td');
        td0.setAttribute('colspan', '10');
        td0.className = 'form-help';
        td0.appendChild(document.createTextNode('No analytics for this timeframe.'));
        tr0.appendChild(td0);
        tbody.appendChild(tr0);
        return;
      }
      var i;
      for (i = 0; i < funnels.length; i++) {
        var f = funnels[i];
        var tr = document.createElement('tr');
        var cells = [f.funnel_id, orDash(f.visits), fmtPct(f.bounce_rate), fmtPct(f.completion_rate), fmtPct(f.cvr_clicks), fmtPct(f.cvr_completed), money(f.avg_rpc), money(f.avg_rps), fmtPct(f.unfilled_rate), money(f.revenue)];
        var k;
        for (k = 0; k < cells.length; k++) {
          var td = document.createElement('td');
          if (k > 0) { td.className = 'lg-num'; }
          td.appendChild(document.createTextNode(String(cells[k])));
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
    });
  }

  // --- dirty tracking + unsaved-changes guard -------------------------------
  root.addEventListener('input', markDirty);
  root.addEventListener('change', function (ev) {
    if (ev.target && ev.target.id === 'lg-variant-select') { return; }
    markDirty();
  });
  window.addEventListener('beforeunload', function (e) {
    if (dirty) { e.preventDefault(); e.returnValue = ''; return ''; }
  });
}());
`;
