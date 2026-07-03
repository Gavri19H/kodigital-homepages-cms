// Listicles admin UI — shared building blocks (design contract §4 / §8).
//
// Everything the three sub-tab pages (Offers · Sections · Articles) have in
// common lives here: the `renderListiclesTabs` sub-tab bar (§4), the shared
// page styles (tabs, per-cell analytics skeleton shimmer, modal/dialog,
// macro chips), the timeframe → date-range resolver that drives the
// analytics columns (§8), and the ONE shared inline ES5 script that
// hydrates analytics columns after paint via `window.api`-style fetches
// (§8 "Analytics loading") with per-row retry + a generic dialog helper.
//
// Every inline <script> string in this module is strict ES5 (var-only, no
// arrows/const/let/async/template literals) — asserted by
// test/listicles-ui-es5.test.ts using the admin-layout-shell mechanism.

import { escapeHtml } from "../templates/layout";

export type ListiclesTab = "offers" | "sections" | "articles";

const TABS: ReadonlyArray<{ key: ListiclesTab; href: string; label: string }> = [
  { key: "offers", href: "/admin/listicles/offers", label: "Offers" },
  { key: "sections", href: "/admin/listicles/sections", label: "Sections" },
  { key: "articles", href: "/admin/listicles/articles", label: "Articles" },
];

// §4: three sub-tabs via a shared helper — Offers · Sections · Articles.
export function renderListiclesTabs(active: ListiclesTab): string {
  const items = TABS.map((t) => {
    const cls = t.key === active ? "listicles-tab active" : "listicles-tab";
    const aria = t.key === active ? ' aria-current="page"' : "";
    return `<a href="${t.href}" class="${cls}"${aria}>${escapeHtml(t.label)}</a>`;
  }).join("");
  return `<nav class="listicles-tabs" aria-label="Listicles sections">${items}</nav>`;
}

// ---------------------------------------------------------------------------
// Timeframe (the toolbar select that drives the analytics range, §8/§9)
// ---------------------------------------------------------------------------

export interface Timeframe {
  key: string;
  from: string;
  to: string;
}

// Window sizes mirror shared.ts:parseDateRange's "last 30 days" default
// (29 days back + today == 30 calendar days).
const TIMEFRAME_DAYS_BACK: Readonly<Record<string, number>> = {
  today: 0,
  "7d": 6,
  "30d": 29,
  "90d": 89,
};

const TIMEFRAME_LABELS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
];

function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function resolveTimeframe(rangeParam: string | undefined): Timeframe {
  // typeof-number guard: a plain-object lookup resolves prototype-chain keys
  // (?range=constructor / ?range=__proto__) to functions/objects, and the
  // date math on those would throw a 500 — such keys fall back to the
  // default range instead.
  const key =
    rangeParam !== undefined &&
    typeof TIMEFRAME_DAYS_BACK[rangeParam] === "number"
      ? rangeParam
      : "30d";
  const now = new Date();
  const daysBack = TIMEFRAME_DAYS_BACK[key] ?? 29;
  return {
    key,
    from: utcDateString(new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000)),
    to: utcDateString(now),
  };
}

// The timeframe <select> rides inside .toolbar-filters so the layout's shared
// listFilterScript reloads the page with ?range=… on change — the server then
// recomputes from/to and re-embeds them on the table (URL == state).
export function renderTimeframeSelect(selectedKey: string): string {
  const options = TIMEFRAME_LABELS.map((t) => {
    const sel = t.key === selectedKey ? " selected" : "";
    return `<option value="${t.key}"${sel}>${escapeHtml(t.label)}</option>`;
  }).join("");
  return `<select name="range" class="form-select" aria-label="Analytics timeframe">${options}</select>`;
}

// ---------------------------------------------------------------------------
// Analytics columns (§8/§9/§11)
// ---------------------------------------------------------------------------

export interface AnalyticsColumn {
  metric: string;
  label: string;
}

// §9 offer/section analytics columns.
export const ENTITY_ANALYTICS_COLUMNS: ReadonlyArray<AnalyticsColumn> = [
  { metric: "impressions", label: "Impressions" },
  { metric: "clicks", label: "Clicks" },
  { metric: "unique_clicks", label: "Unique clicks" },
  { metric: "conversions", label: "Conversions" },
  { metric: "ctr", label: "CTR" },
  { metric: "cvr", label: "CVR" },
  { metric: "revenue", label: "Revenue" },
  { metric: "rpc", label: "RPC" },
  { metric: "rpm", label: "RPM" },
];

// §11 article summary-row analytics columns (adds visits + pps).
export const ARTICLE_ANALYTICS_COLUMNS: ReadonlyArray<AnalyticsColumn> = [
  { metric: "total_visits", label: "Total visits" },
  { metric: "unique_visits", label: "Unique visits" },
  { metric: "impressions", label: "Impressions" },
  { metric: "pps", label: "PPS" },
  { metric: "clicks", label: "Clicks" },
  { metric: "unique_clicks", label: "Unique clicks" },
  { metric: "conversions", label: "Conversions" },
  { metric: "ctr", label: "CTR" },
  { metric: "cvr", label: "CVR" },
  { metric: "revenue", label: "Revenue" },
  { metric: "rpc", label: "RPC" },
  { metric: "rpm", label: "RPM" },
];

export function renderAnalyticsHeaderCells(
  columns: ReadonlyArray<AnalyticsColumn>,
): string {
  return columns
    .map(
      (c) =>
        `<th scope="col" class="lst-num" data-metric-col="${c.metric}">${escapeHtml(c.label)}</th>`,
    )
    .join("");
}

// Per-cell skeleton shimmer placeholders — hydrated after paint (§8).
export function renderAnalyticsSkeletonCells(
  columns: ReadonlyArray<AnalyticsColumn>,
): string {
  return columns
    .map(
      (c) =>
        `<td class="lst-num" data-metric="${c.metric}"><span class="skel" aria-hidden="true"></span></td>`,
    )
    .join("");
}

// ---------------------------------------------------------------------------
// Generic dialog shell (usage / attribution / analytics / 409 dialogs)
// ---------------------------------------------------------------------------

export function renderDialogShell(): string {
  return `<div id="lst-dialog" class="modal hidden" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="lst-dialog-title" aria-hidden="true">
  <div class="modal-content">
    <h2 id="lst-dialog-title" class="modal-title"></h2>
    <div id="lst-dialog-body"></div>
    <div class="modal-actions"><button type="button" class="btn btn-secondary" data-dialog-close>Close</button></div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

export const LISTICLES_STYLES = `
.listicles-tabs{display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid var(--c-border)}
.listicles-tab{padding:8px 16px;color:var(--c-muted);font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px}
.listicles-tab:hover{color:var(--c-text);text-decoration:none}
.listicles-tab.active{color:var(--c-primary);border-bottom-color:var(--c-primary)}
.lst-num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.skel{display:inline-block;min-width:36px;height:12px;border-radius:4px;background:linear-gradient(90deg,#e5e7eb 25%,#f3f4f6 50%,#e5e7eb 75%);background-size:200% 100%;animation:lstShimmer 1.2s linear infinite}
@keyframes lstShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.modal{position:fixed;inset:0;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;z-index:1000}
.modal.hidden{display:none}
.modal-content{background:#fff;border-radius:8px;padding:24px;max-width:640px;width:92%;max-height:90vh;overflow-y:auto;box-shadow:0 10px 25px rgba(0,0,0,0.15)}
.modal-title{margin-bottom:16px;font-size:18px;font-weight:600}
.modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
.macro-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.macro-chip{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;padding:2px 8px;border:1px solid var(--c-border);border-radius:9999px;background:var(--c-bg-alt);color:var(--c-text);cursor:pointer}
.macro-chip:hover{border-color:var(--c-primary);color:var(--c-primary)}
.lst-phase-note{align-self:center}
.lst-usage-list{margin:8px 0 8px 18px}
.lst-usage-list li{margin-bottom:4px}
.lst-retry{margin-left:6px}
.lst-kv{width:100%;border-collapse:collapse;margin-top:8px}
.lst-kv th,.lst-kv td{padding:6px 8px;text-align:left;border-bottom:1px solid var(--c-border);font-size:13px}
.lst-kv td{text-align:right;font-variant-numeric:tabular-nums}
.lst-fallback-results{border:1px solid var(--c-border);border-radius:6px;margin-top:6px;display:flex;flex-direction:column}
.lst-fallback-results[hidden]{display:none}
.lst-fallback-result{display:block;width:100%;text-align:left;padding:8px 12px;border:0;background:none;font-size:13px;cursor:pointer}
.lst-fallback-result:hover{background:var(--c-bg-alt)}
.lst-fallback-selected{margin-top:6px;font-size:13px}
.form-status{min-height:18px;font-size:13px;color:var(--c-muted);margin-bottom:8px}
.lst-exp-col{width:34px;text-align:center}
.lst-drill-toggle{min-width:26px;padding:2px 8px;font-weight:700;line-height:1}
.lst-drill-row>td{background:var(--c-bg-alt);padding:12px 16px}
.lst-drill-box{display:flex;flex-direction:column;gap:14px}
.lst-drill-version>h4{font-size:14px;font-weight:600;margin-bottom:6px}
.lst-drill-page{margin:6px 0 6px 12px}
.lst-drill-page>h5{font-size:13px;font-weight:600;color:var(--c-muted);margin-bottom:4px}
.lst-drill-table{width:100%;border-collapse:collapse;font-size:12px}
.lst-drill-table th,.lst-drill-table td{padding:4px 8px;border-bottom:1px solid var(--c-border);text-align:left}
.lst-drill-table th.lst-num,.lst-drill-table td.lst-num{text-align:right;font-variant-numeric:tabular-nums}
.lst-drill-skel .skel{min-width:140px;height:14px}
.lst-rebuild{margin-bottom:16px;border:1px solid var(--c-border);border-radius:6px;padding:8px 12px}
.lst-rebuild>summary{cursor:pointer;font-size:13px;font-weight:500;color:var(--c-muted)}
.lst-rebuild-body{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin-top:10px}
.lst-rebuild-field{font-size:13px;display:flex;flex-direction:column;gap:4px}
`;

// ---------------------------------------------------------------------------
// Shared inline script (strict ES5)
// ---------------------------------------------------------------------------
//
// Exposes window.lstUi = { openDialog, closeDialog, showAnalyticsDialog,
// hydrateRow, hydrateAll, formats, getJson } and self-runs the after-paint
// analytics hydration for every `table[data-lst-analytics]`:
//   data-analytics-url-prefix  e.g. /api/admin/listicles/offers/
//   data-analytics-from / -to  YYYY-MM-DD range (server-resolved timeframe)
//   data-analytics-pick        optional sub-key of `analytics` (articles: total)
// Rows opt in via data-entity-id; cells via td[data-metric]. Failure state:
// inline em-dashes + a per-row Retry button + ONE error toast per table (§8).

export const LST_SHARED_SCRIPT = `
(function () {
  function fmtInt(v) { var n = Number(v); if (!isFinite(n)) { n = 0; } return String(Math.round(n)); }
  function fmtPct(v) { var n = Number(v); if (!isFinite(n)) { n = 0; } return (n * 100).toFixed(2) + '%'; }
  function fmtDec(v) { var n = Number(v); if (!isFinite(n)) { n = 0; } return n.toFixed(2); }
  var FORMATS = {
    impressions: fmtInt, clicks: fmtInt, unique_clicks: fmtInt, conversions: fmtInt,
    total_visits: fmtInt, unique_visits: fmtInt,
    ctr: fmtPct, cvr: fmtPct,
    pps: fmtDec, revenue: fmtDec, rpc: fmtDec, rpm: fmtDec
  };

  function clearChildren(el) { while (el.firstChild) { el.removeChild(el.firstChild); } }

  function getJson(method, url, body) {
    var options = { method: method, credentials: 'same-origin', headers: { 'Accept': 'application/json' } };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    return fetch(url, options).then(function (r) {
      return r.json().then(
        function (j) { return { ok: r.ok, status: r.status, body: j }; },
        function () { return { ok: r.ok, status: r.status, body: null }; }
      );
    });
  }

  function metricCells(row) { return row.querySelectorAll('td[data-metric]'); }

  function setSkeleton(row) {
    var cells = metricCells(row);
    var i, span;
    for (i = 0; i < cells.length; i++) {
      clearChildren(cells[i]);
      span = document.createElement('span');
      span.className = 'skel';
      span.setAttribute('aria-hidden', 'true');
      cells[i].appendChild(span);
    }
  }

  function setValues(row, metrics) {
    var cells = metricCells(row);
    var i, key, fmt, has;
    for (i = 0; i < cells.length; i++) {
      key = cells[i].getAttribute('data-metric');
      fmt = FORMATS[key] || fmtDec;
      has = metrics && metrics[key] !== undefined && metrics[key] !== null;
      clearChildren(cells[i]);
      cells[i].appendChild(document.createTextNode(has ? fmt(metrics[key]) : '\\u2014'));
    }
  }

  function setFailed(row) {
    var cells = metricCells(row);
    var i, btn;
    for (i = 0; i < cells.length; i++) {
      clearChildren(cells[i]);
      cells[i].appendChild(document.createTextNode('\\u2014'));
    }
    if (cells.length > 0) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm btn-outline lst-retry';
      btn.appendChild(document.createTextNode('Retry'));
      cells[0].appendChild(btn);
    }
  }

  function failRow(table, row, message) {
    setFailed(row);
    if (!table.getAttribute('data-analytics-toast-shown')) {
      table.setAttribute('data-analytics-toast-shown', '1');
      if (window.showToast) {
        window.showToast('Failed to load analytics' + (message ? ': ' + message : ''), 'error');
      }
    }
  }

  function analyticsUrl(table, id) {
    var prefix = table.getAttribute('data-analytics-url-prefix') || '';
    var from = table.getAttribute('data-analytics-from') || '';
    var to = table.getAttribute('data-analytics-to') || '';
    return prefix + encodeURIComponent(id) + '/analytics?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
  }

  function pickMetrics(table, body) {
    var pick = table.getAttribute('data-analytics-pick') || '';
    var metrics = (body && body.analytics) || {};
    if (pick && metrics[pick]) { metrics = metrics[pick]; }
    return metrics;
  }

  function hydrateRow(table, row) {
    var id = row.getAttribute('data-entity-id');
    if (!id) { return; }
    setSkeleton(row);
    getJson('GET', analyticsUrl(table, id)).then(function (res) {
      if (!res.ok || !res.body || res.body.error) {
        failRow(table, row, res.body && res.body.error);
        return;
      }
      setValues(row, pickMetrics(table, res.body));
    }).catch(function () {
      failRow(table, row, null);
    });
  }

  function hydrateTable(table) {
    table.removeAttribute('data-analytics-toast-shown');
    var rows = table.querySelectorAll('tbody tr[data-entity-id]');
    var i;
    for (i = 0; i < rows.length; i++) { hydrateRow(table, rows[i]); }
  }

  function hydrateAll() {
    var tables = document.querySelectorAll('table[data-lst-analytics]');
    var i;
    for (i = 0; i < tables.length; i++) { hydrateTable(tables[i]); }
  }

  // --- generic dialog -------------------------------------------------------
  function dialogRoot() { return document.getElementById('lst-dialog'); }

  function openDialog(title) {
    var root = dialogRoot();
    if (!root) { return null; }
    var titleEl = document.getElementById('lst-dialog-title');
    var bodyEl = document.getElementById('lst-dialog-body');
    if (titleEl) { titleEl.textContent = title || ''; }
    if (bodyEl) { clearChildren(bodyEl); }
    root.style.display = 'flex';
    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');
    return bodyEl;
  }

  function closeDialog() {
    var root = dialogRoot();
    if (!root) { return; }
    root.style.display = 'none';
    root.classList.add('hidden');
    root.setAttribute('aria-hidden', 'true');
  }

  // Analytics row action — reads range + url prefix from the row's own table
  // so the SAME handler serves offers, sections and articles tables.
  function showAnalyticsDialog(row) {
    var table = row;
    while (table && table.nodeName !== 'TABLE') { table = table.parentNode; }
    if (!table) { return; }
    var id = row.getAttribute('data-entity-id');
    var name = row.getAttribute('data-entity-name') || '';
    var from = table.getAttribute('data-analytics-from') || '';
    var to = table.getAttribute('data-analytics-to') || '';
    var bodyEl = openDialog('Analytics' + (name ? ' \\u2014 ' + name : ''));
    if (!bodyEl || !id) { return; }
    var rangeP = document.createElement('p');
    rangeP.className = 'form-help';
    rangeP.appendChild(document.createTextNode(from + ' \\u2192 ' + to));
    bodyEl.appendChild(rangeP);
    var loading = document.createElement('p');
    loading.appendChild(document.createTextNode('Loading\\u2026'));
    bodyEl.appendChild(loading);
    getJson('GET', analyticsUrl(table, id)).then(function (res) {
      if (loading.parentNode) { loading.parentNode.removeChild(loading); }
      if (!res.ok || !res.body || res.body.error) {
        var err = document.createElement('p');
        err.className = 'alert alert-error';
        err.appendChild(document.createTextNode('Failed to load analytics' + (res.body && res.body.error ? ': ' + res.body.error : '')));
        bodyEl.appendChild(err);
        return;
      }
      var metrics = pickMetrics(table, res.body);
      var kv = document.createElement('table');
      kv.className = 'lst-kv';
      var cells = metricCells(row);
      var i, key, tr, th, td, fmt;
      for (i = 0; i < cells.length; i++) {
        key = cells[i].getAttribute('data-metric');
        fmt = FORMATS[key] || fmtDec;
        tr = document.createElement('tr');
        th = document.createElement('th');
        th.appendChild(document.createTextNode(key));
        td = document.createElement('td');
        td.appendChild(document.createTextNode(metrics && metrics[key] !== undefined && metrics[key] !== null ? fmt(metrics[key]) : '\\u2014'));
        tr.appendChild(th);
        tr.appendChild(td);
        kv.appendChild(tr);
      }
      bodyEl.appendChild(kv);
    }).catch(function () {
      // §8 error state — never leave the dialog stuck on "Loading…".
      if (loading.parentNode) { loading.parentNode.removeChild(loading); }
      var err = document.createElement('p');
      err.className = 'alert alert-error';
      err.appendChild(document.createTextNode('Failed to load analytics.'));
      bodyEl.appendChild(err);
      if (window.showToast) { window.showToast('Failed to load analytics', 'error'); }
    });
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) { return; }
    if (t.closest('[data-dialog-close]')) { closeDialog(); return; }
    var root = dialogRoot();
    if (root && e.target === root) { closeDialog(); return; }
    var retry = t.closest('.lst-retry');
    if (retry) {
      var row = retry.closest('tr');
      var table = retry.closest('table');
      if (row && table) {
        table.removeAttribute('data-analytics-toast-shown');
        hydrateRow(table, row);
      }
      return;
    }
    var analyticsBtn = t.closest('[data-lst-analytics-action]');
    if (analyticsBtn) {
      var actionRow = analyticsBtn.closest('tr');
      if (actionRow) { showAnalyticsDialog(actionRow); }
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeDialog(); }
  });

  window.lstUi = {
    openDialog: openDialog,
    closeDialog: closeDialog,
    showAnalyticsDialog: showAnalyticsDialog,
    hydrateRow: hydrateRow,
    hydrateAll: hydrateAll,
    getJson: getJson,
    formats: FORMATS
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrateAll);
  } else {
    hydrateAll();
  }
}());
`;

// Shared status-badge class mapping (layout.ts badge palette).
export function statusBadgeClass(status: string): string {
  switch (status) {
    case "active":
    case "published":
      return "badge badge-published";
    case "paused":
    case "scheduled":
      return "badge badge-scheduled";
    case "archived":
      return "badge badge-archived";
    default:
      return "badge badge-draft";
  }
}

// unixepoch seconds → YYYY-MM-DD (server-side; keeps inline scripts static).
export function formatEpochDate(epochSeconds: number | null | undefined): string {
  if (typeof epochSeconds !== "number" || !Number.isFinite(epochSeconds) || epochSeconds <= 0) {
    return "";
  }
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}
