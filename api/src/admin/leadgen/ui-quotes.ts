// LeadGen admin UI — Quotes tab (v2.5 redesign-contract 04 + 03 §9.4, Phase-B
// slice B2). The list (Create + filters + timeframe + after-paint analytics
// hydration) and the full-page editor at /admin/leadgen/quotes/:id/edit are
// LIVE. The editor keeps its six sub-tabs — Funnel builder (04 §4.1 FRAME
// STUDIO), Templates, Themes, A/B, Activation, Analytics — each now its own
// module under quotes-tabs/ (LEADGEN-REWORK-03 §12 P3a mechanical split: this
// file is the THIN COMPOSER — imports + List/New page routes + the Editor's
// top-level page assembly + routing between tabs. Behavior-frozen: zero
// rendered-output change, see test/leadgen-p3a-split-parity.test.ts). SSR
// drives the JSON API in-process via ui.ts's apiJson. Inline scripts are
// strict ES5 (layout.ts constraint, asserted by the ES5 parse test — NO
// backticks, NO arrow/const/let, template literals forbidden). Every author
// value is escapeHtml-escaped; JSON blobs are `<`-escaped.

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
import { listFunnelDesignOptions } from "./quotes-handlers";
import { type Paging } from "./router";
import { loadVariantPages, type ResolvedFunnelPage } from "../../public/leadgen/resolver";
import {
  RULES_BUILDER_SCRIPT,
  // P3b follow-up (§8.2 RIGHT rail, S3b.2's MOUNT CONTRACT): the composer
  // assembles QuoteRulesRailData (the "tab payload" this file already builds
  // answerFields/quoteDataBlob from) and adds QUOTE_RULES_SCRIPT to the page's
  // scripts bundle; renderQuoteRulesRail itself is called by the board
  // (quotes-tabs/funnel.ts renderBuilderPanel), not here.
  QUOTE_RULES_SCRIPT,
  type QuoteRulesRailAnswerField,
  type QuoteRulesRailData,
  type QuoteRulesRailFunnel,
} from "./ui-rules-builder";
import {
  type QuoteListItem,
  type RuleNode,
  type VariantNode,
  type SectionRef,
  type AbEntryNode,
  type RuledCaseNode,
  type PageSlotNode,
  type PageNode,
  type StructureBody,
  type BoardPage,
  type AvailableSection,
  type AuctionListItem,
  type ActivationBody,
  type FrameGetBody,
  type ThemeGetBody,
  type FrameTemplateItem,
  type OfferListItem,
  previewSiteOptions,
  LG_QUOTES_STYLES,
  primaryVariantOf,
  findSelectedVariant,
  renderSiteSelect,
  quoteDataBlob,
  renderMediaPickerModal,
} from "./quotes-tabs/shared";
import { renderBuilderPanel, QUOTE_EDITOR_SCRIPT } from "./quotes-tabs/funnel";
import { renderTemplatesTabPanel } from "./quotes-tabs/templates";
import { renderThemesTabPanel } from "./quotes-tabs/themes";
import { renderAbPanel } from "./quotes-tabs/ab";
import { renderPublishBadge, renderActivationPanel } from "./quotes-tabs/activation";
import { renderAnalyticsPanel } from "./quotes-tabs/analytics";
export {
  PREFLIGHT_BLOCK_CODE_LABELS,
  PROBLEM_SCOPE_ORDER,
  PROBLEM_SCOPE_LABELS,
  PREFLIGHT_PASS_CHECKS,
  ROLE_META,
  BENEFIT_BAR_ICONS,
  FRAME_REGION_LABELS,
  OVERRIDE_GROUP_LABELS,
} from "./quotes-tabs/shared";
export type { RulesBuilderData } from "./quotes-tabs/shared";
export { mappingDotStatus, MAPPING_DOT_TITLES } from "./quotes-tabs/funnel";
export { problemFixLabel } from "./quotes-tabs/activation";


// Resolve a slot's raw-integer section_id (rules_json / ab_allocations_json)
// to the candidate's public_id + name. The loader returns a slot's candidate
// rows in the SAME order preparePages inserted them (fvs.id ASC == insertion
// order == candidateSectionIds order): for an A/B slot that is exactly the
// allocation order; for a ruled slot it is the de-duplicated first-appearance
// order of [each case's section, then the default]. Replaying that de-dup here
// against the parsed rules gives an integer→candidate index that is faithful
// to what the backend stored — no separate id map is needed from the API.
function slotSectionRefIndex(slot: ResolvedFunnelPage["slots"][number]): Map<number, SectionRef> {
  const index = new Map<number, SectionRef>();
  if (slot.ab_allocations !== null) {
    // A/B: candidate k ↔ allocation k (index-aligned).
    slot.ab_allocations.forEach((alloc, k) => {
      const cand = slot.candidates[k];
      if (cand !== undefined) index.set(alloc.section_id, { section_id: cand.section.public_id, section_name: cand.section.section_name });
    });
    return index;
  }
  if (slot.rules !== null) {
    // Ruled: replay the loader's [unique case sections…, default] ordering.
    const order: number[] = [];
    for (const c of slot.rules.cases) if (!order.includes(c.section_id)) order.push(c.section_id);
    if (!order.includes(slot.rules.default_section_id)) order.push(slot.rules.default_section_id);
    order.forEach((sid, k) => {
      const cand = slot.candidates[k];
      if (cand !== undefined) index.set(sid, { section_id: cand.section.public_id, section_name: cand.section.section_name });
    });
    return index;
  }
  return index;
}


function buildPageNodes(pages: readonly ResolvedFunnelPage[]): PageNode[] {
  return pages.map((page) => ({
    name: page.name,
    slots: page.slots.map((slot): PageSlotNode => {
      const kind: PageSlotNode["kind"] = slot.rules !== null ? "ruled" : slot.ab_allocations !== null ? "ab" : "fixed";
      if (kind === "ab" && slot.ab_allocations !== null) {
        const refs = slotSectionRefIndex(slot);
        return {
          slot_revision: slot.slot_revision,
          kind,
          fixed: null,
          ruled: null,
          ab: slot.ab_allocations.map((alloc): AbEntryNode => {
            const ref = refs.get(alloc.section_id);
            return { section_id: ref?.section_id ?? "", section_name: ref?.section_name ?? "", bp: alloc.bp };
          }),
        };
      }
      if (kind === "ruled" && slot.rules !== null) {
        const refs = slotSectionRefIndex(slot);
        const emptyRef: SectionRef = { section_id: "", section_name: "" };
        return {
          slot_revision: slot.slot_revision,
          kind,
          fixed: null,
          ab: null,
          ruled: {
            cases: slot.rules.cases.map((c): RuledCaseNode => {
              const ref = refs.get(c.section_id) ?? emptyRef;
              return { conditions: c.conditions as { groups: unknown[] }, section_id: ref.section_id, section_name: ref.section_name };
            }),
            default_section: refs.get(slot.rules.default_section_id) ?? emptyRef,
          },
        };
      }
      // fixed: exactly one candidate.
      const cand = slot.candidates[0];
      return {
        slot_revision: slot.slot_revision,
        kind: "fixed",
        ab: null,
        ruled: null,
        fixed: cand !== undefined ? { section_id: cand.section.public_id, section_name: cand.section.section_name, num_id: cand.section.id } : { section_id: "", section_name: "" },
      };
    }),
  }));
}


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
  const name = escapeHtml(q.quote_name);
  // Round-4 A-2 (row R4-02/R4-38): Edit stays a direct link; Duplicate/Usage/
  // Archive-or-Reactivate/Delete move into the shared kebab (renderKebabOpen/
  // KEBAB_CLOSE, layout.ts — the offers-tab pattern promoted). Archive/
  // Reactivate are the PATCH {status} leg (patchQuoteHandler already accepts
  // "status"; never blocked) — Delete is the SEPARATE guarded DELETE
  // /quotes/:id (deleteQuoteHandler 409s "This quote has live history —
  // archive it instead" when site_activations/analytics_rows exist, else it
  // also archives). Duplicate → POST /quotes/:id/duplicate; Usage → GET
  // /quotes/:id/usage (new inline panel below, mirrors the Sections pattern).
  const archiveOrReactivate =
    q.status === "archived"
      ? `<button type="button" class="lg-kebab-item" role="menuitem" data-quote-reactivate="${escapeHtml(q.public_id)}" data-entity-name="${name}">Reactivate</button>`
      : `<button type="button" class="lg-kebab-item lg-kebab-danger" role="menuitem" data-quote-archive="${escapeHtml(q.public_id)}" data-entity-name="${name}">Archive</button>`;
  return `<tr data-entity-id="${escapeHtml(q.public_id)}" data-entity-name="${name}">
  <td>${name}</td>
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
  <td><div class="table-actions">
    <a href="/admin/leadgen/quotes/${escapeHtml(q.public_id)}/edit" class="btn btn-sm btn-secondary">Edit</a>
    ${renderKebabOpen(name)}<button type="button" class="lg-kebab-item" role="menuitem" data-quote-duplicate="${escapeHtml(q.public_id)}" data-entity-name="${name}">Duplicate</button>
    <button type="button" class="lg-kebab-item" role="menuitem" data-quote-usage="${escapeHtml(q.public_id)}" aria-expanded="false">Usage</button>
    ${archiveOrReactivate}
    <button type="button" class="lg-kebab-item lg-kebab-danger" role="menuitem" data-quote-delete="${escapeHtml(q.public_id)}" data-entity-name="${name}">Delete</button>${KEBAB_CLOSE}
  </div></td>
</tr>
<tr class="lg-usage-row" data-quote-usage-row="${escapeHtml(q.public_id)}" hidden>
  <td colspan="${QUOTE_LIST_COLUMNS.length}"><div class="lg-usage-panel" data-quote-usage-panel role="status" aria-live="polite"></div></td>
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

  // Round-4 A-2 kebab rollout (row R4-02/R4-38): Archive/Reactivate are the
  // unrestricted PATCH {status} leg; Delete is the SEPARATE guarded DELETE
  // (surfaces the server's plain-language 409 verbatim); Duplicate is a
  // fire-and-reload POST; Usage is a new inline expandable panel (mirrors
  // the Sections list's existing pattern, ui-sections.ts SECTION_LIST_SCRIPT).
  document.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) { return; }
    var dupId = el.getAttribute('data-quote-duplicate');
    if (dupId) {
      if (window.lgCloseKebabs) { window.lgCloseKebabs(); }
      fetch('/api/admin/leadgen/quotes/' + encodeURIComponent(dupId) + '/duplicate', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({})
      }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, body: j }; });
      }).then(function (res) {
        if (!res.ok) { window.alert((res.body && res.body.error) || 'Duplicate failed'); return; }
        window.location.reload();
      }).catch(function () { window.alert('Duplicate request failed'); });
      return;
    }
    var archiveId = el.getAttribute('data-quote-archive');
    if (archiveId) {
      if (window.lgCloseKebabs) { window.lgCloseKebabs(); }
      if (!window.confirm('Archive this Quote?')) { return; }
      fetch('/api/admin/leadgen/quotes/' + encodeURIComponent(archiveId), {
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
    var reactivateId = el.getAttribute('data-quote-reactivate');
    if (reactivateId) {
      if (window.lgCloseKebabs) { window.lgCloseKebabs(); }
      if (!window.confirm('Reactivate this Quote?')) { return; }
      fetch('/api/admin/leadgen/quotes/' + encodeURIComponent(reactivateId), {
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
    var deleteId = el.getAttribute('data-quote-delete');
    if (deleteId) {
      if (window.lgCloseKebabs) { window.lgCloseKebabs(); }
      var deleteName = el.getAttribute('data-entity-name') || 'this quote';
      if (!window.confirm('Delete ' + deleteName + '?')) { return; }
      fetch('/api/admin/leadgen/quotes/' + encodeURIComponent(deleteId), {
        method: 'DELETE', credentials: 'same-origin', headers: { 'Accept': 'application/json' }
      }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
      }).then(function (res) {
        if (!res.ok) { window.alert((res.body && res.body.error) || ('Delete failed (' + res.status + ')')); return; }
        window.location.reload();
      }).catch(function () { window.alert('Delete request failed'); });
      return;
    }
    var usageId = el.getAttribute('data-quote-usage');
    if (usageId) {
      if (window.lgCloseKebabs) { window.lgCloseKebabs(); }
      var panelRow = document.querySelector('[data-quote-usage-row="' + usageId + '"]');
      if (!panelRow) { return; }
      var wasHidden = panelRow.hidden;
      panelRow.hidden = !wasHidden;
      el.setAttribute('aria-expanded', wasHidden ? 'true' : 'false');
      if (!wasHidden) { return; }
      var panel = panelRow.querySelector('[data-quote-usage-panel]');
      if (!panel || panel.getAttribute('data-loaded') === 'true') { return; }
      panel.appendChild(document.createTextNode('Loading usage\\u2026'));
      fetch('/api/admin/leadgen/quotes/' + encodeURIComponent(usageId) + '/usage', {
        credentials: 'same-origin', headers: { 'Accept': 'application/json' }
      }).then(function (r) { return r.json(); }).then(function (body) {
        var kinds = (body && body.usage && body.usage.kinds) ? body.usage.kinds : [];
        var labels = { site_activations: 'Site activations', analytics_history: 'Analytics history' };
        clearChildren(panel);
        panel.setAttribute('data-loaded', 'true');
        var total = 0;
        var ki;
        for (ki = 0; ki < kinds.length; ki++) { total += Number(kinds[ki].count) || 0; }
        if (total === 0) {
          panel.appendChild(document.createTextNode('Not in use \\u2014 safe to delete or archive.'));
          return;
        }
        for (ki = 0; ki < kinds.length; ki++) {
          var kind = kinds[ki];
          if (!kind.count) { continue; }
          var head = document.createElement('p');
          head.appendChild(document.createTextNode((labels[kind.kind] || kind.kind) + ': ' + kind.count));
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
    <table class="table table--sticky-edges leadgen-quotes-list" aria-label="Quotes list" data-lg-analytics data-analytics-from="${escapeHtml(timeframe.from)}" data-analytics-to="${escapeHtml(timeframe.to)}">
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
      scripts: kebabMenuScript + QUOTE_LIST_SCRIPT + listFilterScript,
    }),
  );
}


// ---------------------------------------------------------------------------
// New-quote page (§10.1-style create → then editor)
// ---------------------------------------------------------------------------

// Round-4 P5b (10A): Activity becomes a select fed by the existing
// GET /activities; an inline "+ Add a new activity…" sentinel reveals a
// free-text escape hatch (the ONLY way to author a brand-new activity, since
// the select is otherwise a closed list of what already exists). Verticals
// becomes a multi-select fed by GET /verticals, with its OWN "+ Add" affordance
// that appends (and selects) a new <option> — never destroying the existing
// selection. The WIRE payload is UNCHANGED: `verticals` still sends a plain
// array of the selected/added strings (parseStringArray, quotes-handlers.ts,
// accepts exactly that shape) — only the AUTHORING affordance changes.
const QUOTE_NEW_SCRIPT = `
(function () {
  var form = document.getElementById('lg-quote-new-form');
  if (!form) { return; }
  var errBox = document.getElementById('lg-quote-new-error');
  var activitySel = document.getElementById('lg-q-activity');
  var activityNew = document.getElementById('lg-q-activity-new');
  if (activitySel && activityNew) {
    activitySel.addEventListener('change', function () {
      var isNew = activitySel.value === '__new__';
      // the SSR default is class="form-input lg-hidden" (display:none) — the
      // native .hidden property does not override that CSS class, so the
      // class itself must flip here (the file's established idiom, e.g.
      // togglePanel/showRegionPanel above).
      activityNew.className = isNew ? 'form-input' : 'form-input lg-hidden';
      if (isNew) { activityNew.focus(); }
    });
  }
  var verticalsSel = document.getElementById('lg-q-verticals');
  var vNewInput = document.getElementById('lg-q-verticals-new');
  var vAddBtn = document.getElementById('lg-q-verticals-add');
  function addVerticalOption(value) {
    var v = (value || '').replace(/^\\s+|\\s+$/g, '');
    if (!v || !verticalsSel) { return; }
    var opts = verticalsSel.options;
    var i;
    for (i = 0; i < opts.length; i++) { if (opts[i].value === v) { opts[i].selected = true; return; } }
    var opt = document.createElement('option');
    opt.value = v;
    opt.appendChild(document.createTextNode(v));
    opt.selected = true;
    verticalsSel.appendChild(opt);
  }
  if (vAddBtn && vNewInput) {
    vAddBtn.addEventListener('click', function () {
      addVerticalOption(vNewInput.value);
      vNewInput.value = '';
      vNewInput.focus();
    });
  }
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var name = (document.getElementById('lg-q-name').value || '').trim();
    var activity = activitySel ? activitySel.value : '';
    if (activity === '__new__') { activity = ((activityNew && activityNew.value) || '').trim(); }
    var verticals = [];
    if (verticalsSel) {
      var vOpts = verticalsSel.options;
      var j;
      for (j = 0; j < vOpts.length; j++) { if (vOpts[j].selected) { verticals.push(vOpts[j].value); } }
    }
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


export async function leadgenQuotesNewPage(c: UiContext): Promise<Response> {
  const [activitiesRes, verticalsRes] = await Promise.all([
    apiJson<{ items: string[] }>(c.env, "/api/admin/leadgen/activities"),
    apiJson<{ items: string[] }>(c.env, "/api/admin/leadgen/verticals"),
  ]);
  const activities = activitiesRes.ok ? activitiesRes.body.items : [];
  const verticals = verticalsRes.ok ? verticalsRes.body.items : [];
  const activityOptions = activities.map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join("");
  const verticalOptions = verticals.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
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
        <select id="lg-q-activity" name="activity" class="form-select" required aria-required="true">
          <option value="">Choose an activity&#8230;</option>
          ${activityOptions}
          <option value="__new__">+ Add a new activity&#8230;</option>
        </select>
        <input id="lg-q-activity-new" class="form-input lg-hidden" placeholder="New activity name" aria-label="New activity name" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="lg-q-verticals">Verticals * (select one or more)</label>
      <select id="lg-q-verticals" name="verticals" class="form-select" multiple size="5" required aria-required="true">${verticalOptions}</select>
      <div class="lg-list-row">
        <input id="lg-q-verticals-new" class="form-input" placeholder="Add a new vertical&#8230;" aria-label="New vertical name" />
        <button type="button" id="lg-q-verticals-add" class="btn btn-sm btn-secondary">+ Add</button>
      </div>
      <span class="form-help">Hold Ctrl/Cmd to select more than one, or type a new one and "+ Add".</span>
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


function quoteEditorHtml(
  structure: StructureBody,
  selected: VariantNode,
  designs: Array<{ id: string; label: string }>,
  auctions: AuctionListItem[],
  available: AvailableSection[],
  activation: ActivationBody | null,
  frame: FrameGetBody | null,
  theme: ThemeGetBody | null,
  templates: FrameTemplateItem[],
  // §10/S5.1: this used to be `routingData: RoutingBuilderData` (rules/offers/
  // sections/variants/field_pages/page_count) — every field EXCEPT `.fields`
  // fed ONLY the now-deleted renderRoutingRulesPanel (verified 0 other
  // consumers: renderBuilderPanel voided the whole object). `.fields` is the
  // one genuinely-consumed piece (renderTemplatesTabPanel's CTA condition
  // picker), so it is threaded directly under its real shape's name.
  answerFields: readonly QuoteRulesRailAnswerField[],
  // P3b follow-up (§8.2 RIGHT rail) — S3b.2's renderQuoteRulesRail input,
  // assembled by leadgenQuoteEditorPage (the SAME "tab payload" function that
  // already builds answerFields/quoteDataBlob) and threaded to the board.
  railData: QuoteRulesRailData,
  brand: { userEmail?: string },
  // FIX 8c: whether POST /api/admin/ai/image is usable — false hides the
  // picker's "Generate with AI" affordance (§8.4).
  aiImageAvailable = false,
): string {
  const q = structure.quote;
  const sites = previewSiteOptions(activation);
  const funnelPublicId =
    structure.funnels.find((f) => f.funnel_id === selected.funnel_id)?.public_id ??
    structure.funnels[0]?.public_id ??
    "";
  // Rework M1 replacement semantics — see primaryVariantOf's doc comment.
  const ownFunnel = structure.funnels.find((f) => f.funnel_id === selected.funnel_id) ?? null;
  const selectedIsControl = primaryVariantOf(ownFunnel?.variants ?? [selected])?.public_id === selected.public_id;
  const verticalChips = (Array.isArray(q.verticals_json) ? q.verticals_json : [])
    .map((v) => `<span class="lg-chip">${escapeHtml(v)}</span>`)
    .join("");

  // §4.1 top bar: name · status pill · Activity chip · verticals chips ·
  // publish chip · preview-site selector · Save · Publish (opens the
  // Activation tab, where the per-site preflight-gated activate lives). P3b
  // follow-up (§8.2/§10): the variant selector + "Fork this variant" are
  // REMOVED from this bar — the A/B tab (renderAbPanel) now owns variant
  // switching + creation, and the funnel board never exposes a raw variant.
  const head = `<div class="lg-editor-head">
    <a href="/admin/leadgen/quotes" class="btn btn-outline">&#8592; Quotes</a>
    <h2 class="lg-editor-title" id="lg-quote-title">${escapeHtml(q.quote_name)}</h2>
    <button type="button" class="btn btn-sm btn-outline" id="lg-quote-rename" aria-label="Rename this quote" title="Rename">&#9998;</button>
    <span class="lg-rename-editor lg-hidden" id="lg-quote-rename-editor">
      <input class="form-input" id="lg-quote-rename-input" aria-label="Quote name" />
      <button type="button" class="btn btn-sm btn-primary" id="lg-quote-rename-save">Save name</button>
      <button type="button" class="btn btn-sm btn-outline" id="lg-quote-rename-cancel">Cancel</button>
    </span>
    ${statusBadge(q.status)}
    <span class="lg-chip" data-quote-activity>Activity: <strong>${escapeHtml(q.activity)}</strong></span>
    ${verticalChips}
    ${renderPublishBadge(activation?.activation_preflight ?? null)}
    <span class="lg-editor-spacer"></span>
    <span class="lg-chip" id="lg-site-chip">Preview site: ${renderSiteSelect("lg-site-select", sites)}</span>
    <button type="button" id="lg-variant-save" class="btn btn-primary">Save</button>
    <button type="button" id="lg-publish-goto" class="btn btn-secondary" data-goto-tab="activation">Publish&#8230;</button>
  </div>
  <details class="lg-advanced"><summary>Advanced</summary>
    <p class="form-help">Reference id: <code class="lg-editor-pubid">${escapeHtml(q.public_id)}</code></p>
  </details>`;

  // Round-4 P4b (operator restructure spec): the standalone "Rules" top tab
  // is REMOVED — routing rules now live INSIDE the Funnel builder tab's
  // right-hand column (renderInspectorColumn -> renderRulesPanel). Four tabs,
  // not five. Round-4 P5b (operator restructure spec): "Templates" (the
  // per-element box-picker panels) and "Themes" (the moved theme editor) are
  // promoted to TOP tabs beside Funnel builder/A/B/Activation/Analytics —
  // inserted right after Funnel builder. The canvas toolbar's "Theme" quick-
  // access button JUMPS to the Themes tab (deliverable 1's explicit
  // instruction). §10/S5.1: the OLD canvas-embedded 6-arrangement template
  // picker (renderTemplatePicker, ONCE kept here as a "reported, deliberate
  // deviation" to avoid a canvas-visibility regression) is REMOVED —
  // confirmed zero real callers anywhere; the board's own §8.2 M5 per-
  // funnel-column template picker is the current, live mechanism (quotes-
  // tabs/funnel.ts's `data-template-picker` pickchip).
  const subtabs = `<nav class="lg-qtabs" aria-label="Quote editor tabs">
  <button type="button" class="lg-qtab active" data-tab="builder">Funnel builder</button>
  <button type="button" class="lg-qtab" data-tab="templates">Templates</button>
  <button type="button" class="lg-qtab" data-tab="themes">Themes</button>
  <button type="button" class="lg-qtab" data-tab="ab">A/B</button>
  <button type="button" class="lg-qtab" data-tab="activation">Activation</button>
  <button type="button" class="lg-qtab" data-tab="analytics">Analytics</button>
</nav>`;

  const content = `${renderLeadgenTabs("quotes")}
<div id="lg-quote-editor" data-quote-id="${q.id}" data-quote-public-id="${escapeHtml(q.public_id)}" data-variant-public-id="${escapeHtml(selected.public_id)}" data-variant-funnel-id="${escapeHtml(selected.funnel_id)}" data-variant-funnel-variant-id="${escapeHtml(selected.funnel_variant_id)}" data-funnel-public-id="${escapeHtml(funnelPublicId)}">
  ${head}
  <p id="lg-quote-error" class="alert alert-error" hidden role="alert"></p>
  <p id="lg-quote-ok" class="alert alert-success" hidden role="status"></p>
  ${subtabs}
  ${renderBuilderPanel(structure, selected, designs, auctions, available, templates, sites, railData)}
  ${renderTemplatesTabPanel(selectedIsControl, answerFields)}
  ${renderThemesTabPanel(selectedIsControl)}
  ${renderAbPanel(structure, selected)}
  ${renderActivationPanel(activation)}
  ${renderAnalyticsPanel()}
  ${renderMediaPickerModal(aiImageAvailable)}
  <script type="application/json" id="lg-quote-data">${quoteDataBlob(structure, selected, funnelPublicId, frame, theme, templates, sites, activation)}</script>
</div>`;

  return leadgenPageShell({
    activePath: "/admin/leadgen/quotes",
    userEmail: brand.userEmail,
    content,
    styles: LG_QUOTES_STYLES,
    // P3b follow-up: QUOTE_RULES_SCRIPT (§8.2 RIGHT rail island) added.
    // RULES_BUILDER_SCRIPT stays — renderQuoteRulesRail's own doc comment
    // documents it as a REQUIRED shared dependency (its Conditions section
    // mounts window.lgRulesBuilder). §10/S5.1: ROUTING_RULES_SCRIPT/
    // renderRoutingRulesPanel (the OLD per-variant rules panel this phase
    // removed from render — renderInspectorColumn/renderRulesPanel, deleted
    // with the board rewrite) were CONFIRMED unreachable dead code bound to
    // absent DOM (0 real call sites anywhere) and DELETED entirely, including
    // this concatenation.
    scripts: QUOTE_EDITOR_SCRIPT + RULES_BUILDER_SCRIPT + QUOTE_RULES_SCRIPT,
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

  // Round-4 P3b: attach the FULL page/slot tree to the SELECTED variant (the
  // one the structure panel renders). loadVariantPages is the canonical loader
  // — real pages when the variant has any, else its own synthetic
  // one-fixed-slot-per-section wrap (so a pre-page-model or freshly section-
  // saved variant still renders as ordered single-section pages that round-
  // trip byte-identically). See buildPageNodes.
  selected.pages = buildPageNodes(await loadVariantPages(c.env.DB, selected.id));

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

  // --- v2.5 §4.1 studio state (same in-process API the browser XHRs hit) ----
  const funnelPublicId =
    structure.funnels.find((f) => f.funnel_id === selected.funnel_id)?.public_id ??
    structure.funnels[0]?.public_id ??
    "";
  const encodedFunnel = encodeURIComponent(funnelPublicId);
  const frameRes = await apiJson<FrameGetBody>(c.env, `/api/admin/leadgen/funnels/${encodedFunnel}/frame`);
  const themeRes = await apiJson<ThemeGetBody>(c.env, `/api/admin/leadgen/funnels/${encodedFunnel}/theme`);
  const templatesRes = await apiJson<{ items: FrameTemplateItem[] }>(c.env, "/api/admin/leadgen/frame-templates");
  const offersRes = await apiJson<ListBody<OfferListItem>>(c.env, "/api/admin/leadgen/offers?page_size=200");
  // P3b follow-up (§8.2 RIGHT rail) — the quote's routing rules, for
  // QuoteRulesRailData (S3b.2's renderQuoteRulesRail input, assembled below).
  const routingRulesRes = await apiJson<{ items: QuoteRulesRailRuleWire[] }>(
    c.env,
    `/api/admin/leadgen/quotes/${encodedQuote}/routing-rules`,
  );

  // B3 rules-builder data: this variant's rules + the internal fields of the
  // activity's Sections (from their content_json components) + Offers.
  const available = sectionsRes.ok ? sectionsRes.body.items : [];
  const fields = quoteRailAnswerFields(available);
  // §10/S5.1: `fields` (QuoteRulesRailAnswerField[]) is threaded directly —
  // it used to ride inside a `RoutingBuilderData` wrapper object whose OTHER
  // six fields (rules/offers/sections/variants/field_pages/page_count) fed
  // ONLY the now-deleted renderRoutingRulesPanel (verified: renderBuilderPanel
  // voided the whole object; nothing else ever read them). The route_funnel_
  // variant same-funnel-anti-leak comment that used to live here described the
  // deleted panel's OWN variant-target picker — no longer applicable.
  const answerFields: QuoteRulesRailAnswerField[] = fields;

  // P3b follow-up (§8.2 RIGHT rail) — QuoteRulesRailData, the SAME "tab
  // payload assembly" point answerFields/quoteDataBlob already build from
  // (structure/available/offersRes all already loaded above; the ONLY new
  // fetch is the quote's routing rules).
  const quoteRoutingRules: QuoteRulesRailRuleWire[] = routingRulesRes.ok ? routingRulesRes.body.items : [];
  const sectionFieldsMap = sectionFieldsByPublicId(available);
  const sharedFieldSet = new Set<string>();
  for (const s of structure.shared_page?.sections ?? []) {
    for (const f of sectionFieldsMap.get(s.section_public_id) ?? []) sharedFieldSet.add(f);
  }
  const railFunnels: QuoteRulesRailFunnel[] = structure.funnels
    .slice()
    .sort((a, b) => (a.display_order ?? a.id) - (b.display_order ?? b.id))
    .map((f) => ({
      id: f.id,
      public_id: f.public_id,
      name: f.funnel_name,
      is_default: structure.quote.default_funnel_id !== null && structure.quote.default_funnel_id !== undefined && f.id === structure.quote.default_funnel_id,
      pages: funnelPageFieldSets(f.active_variant_pages, sectionFieldsMap),
    }));
  const railData: QuoteRulesRailData = {
    quote_public_id: structure.quote.public_id,
    rules: quoteRoutingRules.map((r) => ({
      public_id: r.public_id,
      rule_name: r.rule_name,
      priority: r.priority,
      status: r.status === "disabled" ? "disabled" : "active",
      match_mode: r.match_mode,
      conditions_json: r.conditions_json,
      target_funnel_id: r.target_funnel_id,
      feed_name: r.feed_name,
      value_multiplier: r.value_multiplier,
      redirect_pct: r.redirect_pct,
      target_offer_id: r.target_offer_id,
      redirect_url: r.redirect_url,
      redirect_url_allowlisted: r.redirect_url_allowlisted,
    })),
    funnels: railFunnels,
    default_funnel_id: structure.quote.default_funnel_id ?? null,
    shared_page_fields: Array.from(sharedFieldSet),
    answer_fields: fields,
    offers: (offersRes.ok ? offersRes.body.items : []).map((o) => ({ id: o.id, name: o.offer_name })),
    feed_values: Array.from(new Set(quoteRoutingRules.map((r) => r.feed_name).filter((v): v is string => typeof v === "string" && v !== ""))).sort(),
  };

  return c.html(
    quoteEditorHtml(
      structure,
      selected,
      listFunnelDesignOptions(),
      auctionsRes.ok ? auctionsRes.body.items : [],
      available,
      activationRes.ok ? activationRes.body : null,
      frameRes.ok ? frameRes.body : null,
      themeRes.ok ? themeRes.body : null,
      templatesRes.ok ? templatesRes.body.items : [],
      answerFields,
      railData,
      branding(c),
      typeof c.env.OPENAI_API_KEY === "string" && c.env.OPENAI_API_KEY !== "",
    ),
  );
}


// ---------------------------------------------------------------------------
// P3b follow-up (§8.2 RIGHT rail) — assembling S3b.2's QuoteRulesRailData.
// ---------------------------------------------------------------------------

// The wire shape /quotes/:id/routing-rules returns (quoteRoutingRuleRowToApi,
// quotes-handlers.ts): every LeadgenQuoteRoutingRuleRow column rides the
// `...row` spread verbatim except conditions_json (parsed) and
// redirect_url_allowlisted (boolean) — status stays the raw DB string (the
// CHECK-constrained 'active'|'disabled'), narrowed below the SAME defensive way.
interface QuoteRulesRailRuleWire {
  public_id: string;
  rule_name: string;
  priority: number;
  status: string;
  match_mode: string | null;
  conditions_json: unknown;
  target_funnel_id: number | null;
  feed_name: string | null;
  value_multiplier: number | null;
  redirect_pct: number | null;
  target_offer_id: number | null;
  redirect_url: string | null;
  redirect_url_allowlisted: boolean;
}

// R2 P1 §① — a QuestionGrid node has no internal_field of its own; each of
// its N children answers its OWN field (owner A.1 #1: "Each one of this
// questions is answering another field"). Both raw content_json walks below
// (the rules-rail answer-field picker + the per-section field map) must see
// those child fields, not just the top-level node's own. One level only — a
// grid child is schema-restricted to a leaf question type, never a nested
// grid, so this never needs to recurse further.
function internalFieldsOf(node: unknown): string[] {
  if (node === null || typeof node !== "object") return [];
  const out: string[] = [];
  const own = (node as { internal_field?: unknown }).internal_field;
  if (typeof own === "string" && own !== "") out.push(own);
  const children = (node as { children?: unknown }).children;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (child === null || typeof child !== "object") continue;
      const f = (child as { internal_field?: unknown }).internal_field;
      if (typeof f === "string" && f !== "") out.push(f);
    }
  }
  return out;
}

// The quote's rules-rail answer-field picker data (§8.2 RIGHT rail, B3
// rules-builder): every DISTINCT internal_field across the activity's
// available sections' content_json components (incl. a QuestionGrid's own
// children — R2 P1 §①), first-section-wins labeled. Extracted to its own
// function (was inline in the quote-editor GET handler) so it is
// unit-testable without the full request/response wiring.
export function quoteRailAnswerFields(available: readonly AvailableSection[]): QuoteRulesRailAnswerField[] {
  const fieldSeen = new Set<string>();
  const fields: QuoteRulesRailAnswerField[] = [];
  for (const section of available) {
    const content = section.content_json;
    const components =
      content !== null && typeof content === "object" && Array.isArray((content as { components?: unknown }).components)
        ? (content as { components: unknown[] }).components
        : [];
    for (const node of components) {
      for (const internalField of internalFieldsOf(node)) {
        if (fieldSeen.has(internalField)) continue;
        fieldSeen.add(internalField);
        fields.push({ internal_field: internalField, label: `${section.section_name} · ${internalField}` });
      }
    }
  }
  return fields;
}

// The SAME content_json → internal_field walk buildFieldPageMap performs,
// factored so the rail's per-funnel per-page fields AND its shared-page-fields
// projection can share ONE pass over `available` instead of a third
// hand-rolled copy of the same extraction.
export function sectionFieldsByPublicId(available: readonly AvailableSection[]): Map<string, string[]> {
  const sectionFields = new Map<string, string[]>();
  for (const s of available) {
    const content = s.content_json;
    const components =
      content !== null && typeof content === "object" && Array.isArray((content as { components?: unknown }).components)
        ? ((content as { components: unknown[] }).components)
        : [];
    const names: string[] = [];
    for (const node of components) {
      names.push(...internalFieldsOf(node));
    }
    sectionFields.set(s.public_id, names);
  }
  return sectionFields;
}

// One funnel's per-page field universe (RuleCheckpointFunnel's caller-built
// shape, rule-checkpoint.ts deriveRuleCheckpoint — QUOTE_RULES_SCRIPT mirrors
// it 1:1 client-side). Unions EVERY slot's candidate sections per page (fixed/
// ab/ruled alike — a page "could" collect a field if ANY resolution collects
// it), matching buildFieldPageMap's own refs union for the flat per-variant map.
function funnelPageFieldSets(
  pages: readonly BoardPage[] | undefined,
  sectionFields: Map<string, string[]>,
): QuoteRulesRailFunnel["pages"] {
  return (pages ?? []).map((page, idx) => {
    const fields = new Set<string>();
    for (const slot of page.slots) {
      for (const cand of slot.candidates) {
        for (const f of sectionFields.get(cand.section_id) ?? []) fields.add(f);
      }
    }
    return { position: idx, fields: Array.from(fields) };
  });
}
