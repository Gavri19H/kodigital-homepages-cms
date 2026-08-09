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
  type LeadgenBranding,
  type UiContext,
} from "./ui";
import { listFunnelDesignOptions } from "./quotes-handlers";
import { type Paging } from "./router";
import { loadVariantPages, type ResolvedFunnelPage } from "../../public/leadgen/resolver";
// R2 P8-6 FIX-FIRST S1 — the rules rail's answer-field universe is derived, not
// re-implemented (see sectionAnswerFieldEntries). `fieldsOf` is THE canonical
// per-node answer-key derivation (leadgen/answers.ts — normalizeAnswers' own,
// and the §6.2 per-offer picker's since P8-5 L1: offers-handlers.ts imports it
// under this same alias, so this is an established admin→leadgen seam, not a
// new layer crossing); collectAnswerKeyClaims + foreignAnswerKeysIn supply the
// section context that makes its Address branch name the key the MARKUP
// carries; flattenComponents is the shared container/QuestionGrid descent.
import { fieldsOf as leadgenAnswerFieldsOf } from "../../leadgen/answers";
import {
  collectAnswerKeyClaims,
  foreignAnswerKeysIn,
  // T1: the renderer's OWN per-role address key resolution — probed one role at
  // a time to recover which role a derived key answers (derivedFieldRole).
  leadgenAddressAnswerFields,
} from "../../public/leadgen/components/presets";
import {
  flattenComponents,
  leadgenComponentName,
  leadgenControlLabel,
  LEADGEN_ADDRESS_FIELD_KINDS,
  type LeadgenComponentNode,
} from "../../public/leadgen/components/content-schema";
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
  // ADJ-N8 — the value→label pairs the rail threads to every sentence surface.
  type RulesBuilderFieldChoice,
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
import { withRequestReadCache } from "./request-read-cache";
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
      conversionsUiEnabled: branding(c).conversionsUiEnabled,
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
    <span class="form-help">A funnel with one variant is created automatically (every Quote has at least one variant).</span>
  </form>
</div>`;
  return c.html(
    leadgenPageShell({
      activePath: "/admin/leadgen/quotes",
      userEmail: branding(c).userEmail,
      conversionsUiEnabled: branding(c).conversionsUiEnabled,
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
  brand: LeadgenBranding,
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
  ${renderThemesTabPanel(selectedIsControl, sites)}
  ${renderAbPanel(structure, selected)}
  ${renderActivationPanel(activation)}
  ${renderAnalyticsPanel()}
  ${renderMediaPickerModal(aiImageAvailable)}
  <script type="application/json" id="lg-quote-data">${quoteDataBlob(structure, selected, funnelPublicId, frame, theme, templates, sites, activation)}</script>
</div>`;

  return leadgenPageShell({
    activePath: "/admin/leadgen/quotes",
    userEmail: brand.userEmail,
    conversionsUiEnabled: brand.conversionsUiEnabled,
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


function quoteNotFoundPage(brand: LeadgenBranding): string {
  const content = `${renderLeadgenTabs("quotes")}
<div class="card"><div class="empty-state">
  <p>Quote not found.</p>
  <a href="/admin/leadgen/quotes" class="btn btn-primary">Back to Quotes</a>
</div></div>`;
  return leadgenPageShell({
    activePath: "/admin/leadgen/quotes",
    userEmail: brand.userEmail,
    conversionsUiEnabled: brand.conversionsUiEnabled,
    content,
    styles: LG_QUOTES_STYLES,
  });
}


// TEMPORARY PRODUCTION DIAGNOSTICS (kept for one more cycle so the SAME log
// line proves whether the overlap actually helped — local timing cannot show it:
// local D1 is in-process, ~0.2 ms a hop, so this page renders in 15 ms here and
// took 8.5-8.9 s in production). Remove once the numbers are confirmed.
let ISOLATE_WARM = false;

export async function leadgenQuoteEditorPage(c: UiContext): Promise<Response> {
  // This page renders by fanning out to nine internal API sub-requests that all
  // share this request's `env` and each re-resolve the same rows — measured 57
  // D1 round trips per render, the same statements 4-8x over, which in
  // production is 8.5-8.9 s of pure waiting. Give THIS request (and therefore
  // its sub-requests) a read cache, on a SHALLOW COPY of env so nothing leaks
  // between requests. See request-read-cache.ts for the write-invalidation,
  // cloning and batch-unwrapping rules.
  const baseEnv = c.env as unknown as { DB?: D1Database };
  if (baseEnv.DB !== undefined) {
    (c as unknown as { env: unknown }).env = { ...c.env, DB: withRequestReadCache(baseEnv.DB) };
  }
  const t0 = Date.now();
  const wasCold = !ISOLATE_WARM;
  ISOLATE_WARM = true;
  const marks: string[] = [];
  const timed = async <T>(label: string, run: () => Promise<T>): Promise<T> => {
    const s = Date.now();
    const out = await run();
    marks.push(`${label}=${Date.now() - s}`);
    return out;
  };
  const idParam = c.req.param("id") ?? "";
  const structureRes = await timed("structure", () =>
    apiJson<StructureBody>(c.env, `/api/admin/leadgen/quotes/${encodeURIComponent(idParam)}/structure`),
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
  selected.pages = buildPageNodes(await timed("variantPages", () => loadVariantPages(c.env.DB, selected.id)));

  const activity = structure.quote.activity;
  const encodedQuote = encodeURIComponent(structure.quote.public_id);

  // --- v2.5 §4.1 studio state (same in-process API the browser XHRs hit) ----
  const funnelPublicId =
    structure.funnels.find((f) => f.funnel_id === selected.funnel_id)?.public_id ??
    structure.funnels[0]?.public_id ??
    "";
  const encodedFunnel = encodeURIComponent(funnelPublicId);

  // These eight reads are INDEPENDENT of each other — every one only needs the
  // structure (already resolved above) for its quote/funnel id. They used to be
  // eight sequential `await`s, and since each is itself a chain of D1 round
  // trips, the page paid the SUM of all of them: measured 4.9 s median / 8.2 s
  // p95 in production for 41 ms of CPU, i.e. essentially all waiting. The funnel
  // board reloads this page after every add-section / add-page, so the operator
  // paid that per action. Issued together, the page waits for the SLOWEST read
  // instead of the total. Measured for the SAME quote: 8528-8874 ms serial vs
  // 6901 ms with these overlapped, and the deeper costs inside `structure` and
  // `activation` are overlapped in quotes-handlers.ts by the same reasoning.
  // Nothing about the RESULTS changes: same reads, same values, same order of
  // use below; the rendered page is byte-identical (verified by normalising the
  // per-render nonce and diffing the whole document).
  //
  // NOT done here, deliberately: a per-request D1 read cache to also DEDUPE the
  // rows these reads have in common. It was built, measured (58 -> 41 round
  // trips, byte-identical page) and then REMOVED, because wrapping the D1
  // binding in a Proxy broke `db.batch()` on the save path with
  // "batch is not a function" — the native binding does not tolerate a facade.
  // Deduping belongs in the loaders themselves, not around the binding.
  const [sectionsRes, auctionsRes, activationRes, frameRes, themeRes, templatesRes, offersRes, routingRulesRes] =
    await Promise.all([
      timed("sections", () => apiJson<ListBody<AvailableSection>>(c.env, `/api/admin/leadgen/sections?activity=${encodeURIComponent(activity)}&status=active&page_size=200`)),
      timed("auctions", () => apiJson<ListBody<AuctionListItem>>(c.env, `/api/admin/leadgen/auctions?page_size=200`)),
      timed("activation", () => apiJson<ActivationBody>(c.env, `/api/admin/leadgen/quotes/${encodedQuote}/activation?preflight=stored&variant=${encodeURIComponent(selected.public_id)}`)),
      timed("frame", () => apiJson<FrameGetBody>(c.env, `/api/admin/leadgen/funnels/${encodedFunnel}/frame`)),
      timed("theme", () => apiJson<ThemeGetBody>(c.env, `/api/admin/leadgen/funnels/${encodedFunnel}/theme`)),
      timed("templates", () => apiJson<{ items: FrameTemplateItem[] }>(c.env, "/api/admin/leadgen/frame-templates")),
      timed("offers", () => apiJson<ListBody<OfferListItem>>(c.env, "/api/admin/leadgen/offers?page_size=200")),
      // P3b follow-up (§8.2 RIGHT rail) — the quote's routing rules, for
      // QuoteRulesRailData (S3b.2's renderQuoteRulesRail input, assembled below).
      timed("routingRules", () => apiJson<{ items: QuoteRulesRailRuleWire[] }>(c.env, `/api/admin/leadgen/quotes/${encodedQuote}/routing-rules`)),
    ]);

  // B3 rules-builder data: this variant's rules + the internal fields of the
  // activity's Sections (from their content_json components) + Offers.
  // Owner-reported trap (2026-08-09): the library offered sections this quote
  // can NEVER use, and clicking one wedged the builder. The list is fetched by
  // ACTIVITY, but a save is validated against activity AND vertical, so in an
  // "Insurance" quote whose vertical is Car, every Home-vertical section was
  // offered and then refused by PUT /variants/:id with "'X' is in the home
  // Vertical, but this quote's Verticals only include car". Worse, the board
  // keeps the rejected section in its unsaved model, so EVERY later save —
  // including "+ Add page" — resent it and failed the same way, until a reload.
  // Offer only what the save will accept. Fail OPEN: a quote with no verticals
  // recorded keeps the whole activity list rather than showing an empty library.
  const quoteVerticals = new Set(
    (structure.quote.verticals_json ?? []).filter((v): v is string => typeof v === "string" && v !== ""),
  );
  const availableAll = sectionsRes.ok ? sectionsRes.body.items : [];
  const available =
    quoteVerticals.size === 0
      ? availableAll
      : availableAll.filter((s) => typeof s.vertical !== "string" || s.vertical === "" || quoteVerticals.has(s.vertical));
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

  const renderStart = Date.now();
  const html = quoteEditorHtml(
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
  );
  marks.push(`render=${Date.now() - renderStart}`);
  console.log(`[EDITORPERF] cold=${wasCold} total=${Date.now() - t0} ${marks.join(" ")} bytes=${html.length}`);
  return c.html(html);
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
// R2 P1 FIX-FIRST (MINOR 1) — each field WITH the question's own authored words.
// The rules rail renders `answer_fields[].label` verbatim into the rule-card
// sentence (ui-rules-builder qrFieldLabel → qrConditionChips), so a label built
// out of storage ids made the card read "rvw_credit_rvw7q3 is excellent_rvw7q3"
// — raw ids in an operator sentence (§12.4 "raw storage keys never surface").
// `props.label` is the question's OWN words (the same source the studio's grid
// rows and dependency sentences read); a question that has none falls back to
// its field id, so the rail is never blank (T1: DELIBERATE — see the fallback
// itself, in quoteRailAnswerFields).
// R2 P7 (register ADJ-N8) — the OTHER half of the same sentence. MINOR-1 fixed
// the FIELD side; the VALUE side kept printing the stored choice slug, so the
// card read "… is excellent_rvw7q3" — literally the jargon owner A.1 #11C
// named. The rail now carries each choice question's authored value→label map
// (`node.choices`, §13.1, plus the §6.5 "Other" group's own choices, which are
// equally selectable answers), and every sentence surface resolves through it.
interface SectionFieldEntry {
  internal_field: string;
  label: string | null;
  choices: RulesBuilderFieldChoice[];
}
function questionLabelOf(node: unknown): string | null {
  if (node === null || typeof node !== "object") return null;
  const props = (node as { props?: unknown }).props;
  if (props === null || typeof props !== "object") return null;
  const label = (props as { label?: unknown }).label;
  return typeof label === "string" && label.trim() !== "" ? label.trim() : null;
}
function pushChoices(raw: unknown, into: RulesBuilderFieldChoice[], seen: Set<string>): void {
  if (!Array.isArray(raw)) return;
  for (const c of raw) {
    if (c === null || typeof c !== "object") continue;
    const v = (c as { value?: unknown }).value;
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
    const label = (c as { label?: unknown }).label;
    if (typeof label !== "string" || label.trim() === "") continue;
    const key = String(v);
    if (seen.has(key)) continue;
    seen.add(key);
    into.push({ value: key, label: label.trim() });
  }
}
function questionChoicesOf(node: unknown): RulesBuilderFieldChoice[] {
  if (node === null || typeof node !== "object") return [];
  const out: RulesBuilderFieldChoice[] = [];
  const seen = new Set<string>();
  pushChoices((node as { choices?: unknown }).choices, out, seen);
  const props = (node as { props?: unknown }).props;
  if (props !== null && typeof props === "object") {
    const other = (props as { other?: unknown }).other;
    if (other !== null && typeof other === "object") {
      pushChoices((other as { choices?: unknown }).choices, out, seen);
    }
  }
  return out;
}
// R2 P8-6 FIX-FIRST T1 — the ROLE's word, never the key's.
//
// S1 built this suffix by TEXT ARITHMETIC on the derived key (strip a leading
// `{own}_`, humanize what is left). That is only ever right by coincidence: the
// key a derivation produces is not required to be `{own}_{role}`, and when it
// is not, the whole raw storage id became the operator's word — exactly the
// §12.4 leak the S1 label work existed to close. MEASURED before this fix
// (npx tsx over quoteRailAnswerFields, api/):
//   NameFieldsGroup props.fields ["p8n_mg_first","p8n_mg_last"]
//     → "Your name — P8n mg first" / "— P8n mg last"   (whole key, humanized)
//   Address internal_field "addr" + props.maps.fills.zip "p8n_mg_postal"
//     (authorable from the real Studio Maps tab, ui-section-studio.ts:3202-3211)
//     → "Where do you live? — P8n mg postal"
//   Address internal_field "p8n_mg" + the same fill → "— Postal"
// and the Studio names those same three keys "Name — First", "Name — Last",
// "Address — ZIP" (ui-section-studio.ts:5596-5615), so the rail and the Studio
// disagreed about one field.
//
// The role is NOT re-derived here from key shape: it is recovered by asking the
// SAME canonical derivation that minted the key which role it belongs to.
// leadgenAddressAnswerFields IS renderAddressAutocompleteQuestion's own
// resolution (props.maps.fills.<slot> override, the P8-5 H1 sibling-collision
// decline, `{base}_{slot}` otherwise), so probing it ONE role at a time — the
// same node, the same base, the same fills, the same foreignAnswerKeys, a
// single-entry fields[] — returns exactly the name that role's box carries in
// the real render. NameFieldsGroup parts are props.fields[0]/[1] (answers.ts
// asStringArray's own filter + its ["first","last"] fallback; the renderer emits
// data-name-field="first"/"last" and collectAnswerKeyClaims claims those two
// only), and a dual_range/from_to slider is `{base}_min`/`{base}_max`.
//
// SEAM (owner ask "reuse the Studio's labelling, not a fourth copy"): the
// Studio's sectionFieldLabels is ES5 BROWSER-ISLAND source living inside
// SECTION_STUDIO_SCRIPT — it reads client `state.content` through the island's
// own walkTree/typeLabel/trimStr. A server-side rail builder cannot call it
// without inverting the layer (server depending on the studio's browser
// runtime), and hoisting it into a shared module means editing
// ui-section-studio.ts, which this slice does not own. So the ROLE WORDS below
// are one copy of the Studio's own literals, pinned to the island source by
// test/leadgen-quotes-ui.test.ts's "the rail's role word IS the Studio's role
// word for the same field" — that test slices the SAME shipped island source
// into node:vm and asserts the derived role word (the text after " — ") on
// the rail's label matches the Studio's, across 12 sub-fields in 4 component
// shapes — a behavioral check of the role word, not a byte-for-byte diff of
// the whole label or file. The two cannot drift silently. Everything with an
// exported operator word already (min/max → leadgenControlLabel, the parent's
// type name → leadgenComponentName) reuses it instead of re-listing it.
const DERIVED_ROLE_WORDS: Readonly<Record<string, string>> = {
  // ui-section-studio.ts:5597 slRoles
  street: "Street",
  city: "City",
  state: "State",
  zip: "ZIP",
  // ui-section-studio.ts:5612-5613
  first: "First",
  last: "Last",
};

// The key ONE address role's box carries — leadgenAddressAnswerFields with a
// single-role fields[], so the resolution (and its collision decline) is the
// renderer's, not a copy. m9AddressRenderedFieldName reads base/fills/kind/
// foreign only, never the sibling specs, so a one-role probe is exact.
function addressRoleKey(
  node: LeadgenComponentNode,
  kind: string,
  foreign: ReadonlySet<string>,
): string | undefined {
  const probe = {
    ...node,
    props: { ...(node.props ?? {}), fields: [{ field: kind }] },
  } as LeadgenComponentNode;
  return leadgenAddressAnswerFields(probe, foreign)[0];
}

// Which role of its owning question this derived key answers, or null when the
// question type has no role vocabulary for it.
function derivedFieldRole(
  node: LeadgenComponentNode,
  own: string,
  field: string,
  foreign: ReadonlySet<string>,
): string | null {
  if (node.type === "AddressAutocompleteQuestion") {
    // LAST match wins, matching the Studio's own slRoles loop (it assigns
    // without breaking), so a fill that lands two roles on one key reads the
    // same word in both surfaces. full_address is judged after the slots — it
    // is the whole-address composite, not a role, and the Studio's loop has no
    // entry for it either.
    let role: string | null = null;
    for (const kind of LEADGEN_ADDRESS_FIELD_KINDS) {
      if (kind === "full_address") continue;
      if (addressRoleKey(node, kind, foreign) === field) role = kind;
    }
    if (role !== null) return role;
    return addressRoleKey(node, "full_address", foreign) === field ? "full_address" : null;
  }
  if (node.type === "NameFieldsGroup") {
    const raw = node.props?.["fields"];
    const authored = Array.isArray(raw)
      ? raw.filter((v): v is string => typeof v === "string" && v.trim() !== "")
      : [];
    const parts = authored.length > 0 ? authored : ["first", "last"];
    if (field === parts[0]) return "first";
    if (field === parts[1]) return "last";
    return null;
  }
  if (node.type === "NumberRangeQuestion" && own !== "") {
    if (field === own + "_min") return "min";
    if (field === own + "_max") return "max";
  }
  return null;
}

// A DERIVED sub-field has no node of its own, so it has no props.label to read:
// its operator words are the OWNING question's own words (falling back to that
// question's operator-facing type name, never a storage id — §12.4) plus the
// ROLE's word. "Where do you live? — ZIP", "Percent band — Max",
// "Your name — First".
//
// Two suffix-less cases, both deliberate: a lone `full_address` composite IS
// the whole question (its one key holds the entire address, so the question's
// own words already name it exactly), and a key whose role the derivation does
// not recognise falls back to the parent's words ALONE. The old fallback —
// humanizing the raw key — is the leak this function exists to prevent, so
// "unknown role" must degrade to a less specific TRUE label, never to a
// storage id.
function derivedSubFieldLabel(
  node: LeadgenComponentNode,
  own: string,
  field: string,
  foreign: ReadonlySet<string>,
): string {
  const parent =
    questionLabelOf(node) ?? leadgenComponentName(typeof node.type === "string" ? node.type : "");
  const role = derivedFieldRole(node, own, field, foreign);
  if (role === null || role === "full_address") return parent;
  return parent + " — " + (DERIVED_ROLE_WORDS[role] ?? leadgenControlLabel(role));
}

// ONE section's answer-field universe, in tree order — THE keys a visitor
// actually records, so a rule the operator writes against any of them CAN fire.
//
// R2 P8-6 FIX-FIRST S1 — this replaces a hand-rolled "node.internal_field +
// one level of node.children[].internal_field" walk that was the rail's whole
// universe. MEASURED before the fix (npx tsx over renderSectionComponents vs
// quoteRailAnswerFields/sectionFieldsByPublicId, api/):
//   Address (plain, internal_field p8_addr)   rendered p8_addr_street/_city/
//     /_state/_zip on the four [data-lg-field] input wraps — rail offered ONLY
//     ["p8_addr"] (the wrapper's hydration attribute, which records nothing);
//   Address + a props.maps.fills.zip collision  rail offered ONLY
//     ["p8n_rr2m3_addr","postal_code_x"], missing all four rendered roles —
//     so the ZIP every visitor answers read "(removed field)" / "This rule can
//     never apply" in the rail;
//   dual_range slider (base budget)            rendered budget_min/budget_max,
//     rail offered ONLY ["budget"];
//   NameFieldsGroup                            rail offered NOTHING (the group
//     carries no internal_field of its own);
//   a question nested two containers deep      rail offered NOTHING (the old
//     walk descended exactly one level).
// The clean control was as broken as the collision case — this was never an
// Address-collision edge, it was the whole multi-field/nesting class.
//
// The derivation is NOT re-implemented here. `fieldsOf` (leadgen/answers.ts) is
// the ONE canonical "which answer keys will the visitor record for this node",
// the same function normalizeAnswers runs over the submitted envelope and the
// same one the §6.2 per-offer picker calls (offers-handlers.ts
// readLinkedSectionFields) — its own comment names "the field universe, rules
// pickers and per-offer mapping" as its reach, and this rail IS that rules
// picker. It expands an Address into the keys the RENDERER emits, a
// NameFieldsGroup into props.fields[0]/[1] (what engine.ts handleInputEvent's
// data-name-field bridge records), a dual_range/from_to slider into
// {base}_min/{base}_max, and returns NOTHING for a non-producing node (a
// ValidationError REFERENCES a field, it never answers one).
// `collectAnswerKeyClaims` + `foreignAnswerKeysIn` (presets.ts) supply the
// section context that makes the Address branch name the ONE key the markup
// carries instead of hedging across both — a props.maps.fills.<slot> rename
// onto a key a SIBLING already answers is DECLINED by the renderer, so the box
// keeps {base}_{slot}. flattenComponents is the same descent every other
// field-universe consumer uses (containers to depth, QuestionGrid children —
// R2 P1 §① — never the container itself).
//
// Consequences, deliberate and matching the §6.2 picker's own P8-5 L1 ruling:
// an Address's BASE key and a dual slider's BASE key are no longer offered.
// Neither records an answer (both are wrapper hydration attributes — measured
// above), so a rule written against one could never fire; offering it is the
// over-claim that produced the "can never apply" report in the first place.
function sectionAnswerFieldEntries(components: readonly unknown[]): SectionFieldEntry[] {
  const nodes = components as readonly LeadgenComponentNode[];
  const claims = collectAnswerKeyClaims(nodes);
  const out: SectionFieldEntry[] = [];
  for (const leaf of flattenComponents(nodes)) {
    if (leaf === null || typeof leaf !== "object") continue;
    const own = typeof leaf.internal_field === "string" ? leaf.internal_field : "";
    // ONE section-context set per leaf: the derivation reads it to name the key
    // the markup carries, and derivedSubFieldLabel reads the SAME one to ask
    // which role that key belongs to (a second, differently-built set could
    // resolve a collision the other way and re-open the disagreement).
    const foreign = foreignAnswerKeysIn(claims, leaf);
    for (const spec of leadgenAnswerFieldsOf(leaf, foreign)) {
      if (spec.field === "") continue;
      out.push(
        spec.field === own
          ? { internal_field: spec.field, label: questionLabelOf(leaf), choices: questionChoicesOf(leaf) }
          : {
              internal_field: spec.field,
              // A derived sub-field carries no enum domain of its own ⇒ no
              // choices (the ADJ-N8 value side has nothing to resolve).
              label: derivedSubFieldLabel(leaf, own, spec.field, foreign),
              choices: [],
            },
      );
    }
  }
  return out;
}

// The `components` array of one section's stored content_json, or [] for any
// shape that is not one. ONE reader for both universes below (it was written
// out twice, which is how two callers of the same walk drift apart).
function sectionComponentsOf(section: AvailableSection): unknown[] {
  const content = section.content_json;
  return content !== null &&
    typeof content === "object" &&
    Array.isArray((content as { components?: unknown }).components)
    ? (content as { components: unknown[] }).components
    : [];
}

// The quote's rules-rail answer-field picker data (§8.2 RIGHT rail, B3
// rules-builder): every DISTINCT answer key a visitor can record across the
// activity's available sections' content_json components (a QuestionGrid's own
// children — R2 P1 §① — a container's nested questions, and every multi-field
// question's sub-fields: sectionAnswerFieldEntries above), first-section-wins
// labeled. Extracted to its own function (was inline in the quote-editor GET
// handler) so it is unit-testable without the full request/response wiring.
export function quoteRailAnswerFields(available: readonly AvailableSection[]): QuoteRulesRailAnswerField[] {
  const fieldSeen = new Set<string>();
  const fields: QuoteRulesRailAnswerField[] = [];
  for (const section of available) {
    for (const entry of sectionAnswerFieldEntries(sectionComponentsOf(section))) {
      if (fieldSeen.has(entry.internal_field)) continue;
      fieldSeen.add(entry.internal_field);
      // MINOR 1: the operator's own question words, never the storage id —
      // this string IS the rule card's subject (qrFieldLabel returns it
      // verbatim) and the picker's option text. Section-qualified, because
      // two sections may ask the same question.
      // ADJ-N8: the value side rides with the field side — `choices` is the
      // authored value→label map for a choice question, absent for every
      // free-text/number field (which keeps rendering its value verbatim).
      //
      // T1, DELIBERATE — the `?? entry.internal_field` below STAYS. A question
      // with NO authored props.label reaches the picker as its raw key
      // ("S · p8n_t1_plain", measured), and swapping that for the question's
      // operator type name was tried and REVERTED: measured, the rail has no
      // de-collision numbering (the Studio's sectionFieldLabels adds " (2)" to
      // a repeated base — driven, its picker shows "Address — ZIP (2)" for a
      // second address in one section, and this rail shows no such suffix), so
      // two label-less same-type questions in one section would both read
      // "S · Yes / No" — one unique key traded for two options an operator
      // cannot tell apart. While there is no de-collision here, the id IS the
      // only disambiguator, so it stays until that numbering lands. This is
      // the ONLY surface where the rail prints a storage key, and only when
      // the question carries no words of its own; a DERIVED sub-field never
      // does (derivedSubFieldLabel, above, always has the owning question's
      // words plus the role).
      fields.push(
        entry.choices.length > 0
          ? {
              internal_field: entry.internal_field,
              label: `${section.section_name} · ${entry.label ?? entry.internal_field}`,
              choices: entry.choices,
            }
          : {
              internal_field: entry.internal_field,
              label: `${section.section_name} · ${entry.label ?? entry.internal_field}`,
            },
      );
    }
  }
  return fields;
}

// Each available section's answer-field universe, keyed by public_id — the
// per-page field sets the rail's checkpoint derivation (funnelPageFieldSets →
// rule-checkpoint.ts deriveRuleCheckpoint) resolves "which page collects this
// field?" against, so a field missing HERE is what makes the rail tell an
// operator "This rule can never apply" about a field every visitor answers.
// Factored so the rail's per-funnel per-page fields AND its shared-page-fields
// projection share ONE pass over `available` instead of a third hand-rolled
// copy of the extraction.
//
// R2 P8-6 FIX-FIRST S1: the universe is sectionAnswerFieldEntries' (above) —
// the SAME one the picker offers, so the two halves of the rail cannot
// disagree about which fields exist. (The prior comment here claimed parity
// with a `buildFieldPageMap`; no such function exists anywhere in src/ or
// test/ — a rotted in-file claim, removed rather than re-asserted.)
export function sectionFieldsByPublicId(available: readonly AvailableSection[]): Map<string, string[]> {
  const sectionFields = new Map<string, string[]>();
  for (const s of available) {
    sectionFields.set(
      s.public_id,
      sectionAnswerFieldEntries(sectionComponentsOf(s)).map((e) => e.internal_field),
    );
  }
  return sectionFields;
}

// One funnel's per-page field universe (RuleCheckpointFunnel's caller-built
// shape, rule-checkpoint.ts deriveRuleCheckpoint — QUOTE_RULES_SCRIPT mirrors
// it 1:1 client-side). Unions EVERY slot's candidate sections per page (fixed/
// ab/ruled alike — a page "could" collect a field if ANY resolution collects
// it).
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
