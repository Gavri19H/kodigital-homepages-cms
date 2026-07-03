// Listicles admin UI — Sections + Articles list tabs (design contract
// §8 / §10 / §11). Phase 4: the Sections tab links to the LIVE Section
// editor (/admin/listicles/sections/new + /:id/edit — ui-section-editor.ts);
// the Articles Create button stays disabled until the Phase-5 builder
// (no dead routes, no fake surfaces).
//
// Shared anatomy with the Offers tab: tabs → toolbar → card/table with
// server-rendered management columns + after-paint analytics hydration
// (skeleton shimmer per cell, §8) → renderListPager. Articles are
// site-scoped and reuse the repo's "Site is required" select gate.
//
// Inline scripts are strict ES5 — asserted by test/listicles-ui-es5.test.ts.

import {
  adminLayout,
  escapeHtml,
  renderListPager,
  listFilterScript,
} from "../templates/layout";
import { SECTION_STATUSES } from "../../listicles/validation";
import type { Paging } from "./shared";
import {
  renderListiclesTabs,
  renderTimeframeSelect,
  renderDialogShell,
  renderAnalyticsHeaderCells,
  renderAnalyticsSkeletonCells,
  ENTITY_ANALYTICS_COLUMNS,
  ARTICLE_ANALYTICS_COLUMNS,
  statusBadgeClass,
  formatEpochDate,
  LISTICLES_STYLES,
  LST_SHARED_SCRIPT,
  type Timeframe,
} from "./ui-shared";
import type { ListiclesBranding } from "./ui-offers";

// ---------------------------------------------------------------------------
// Sections tab (§10 — list-only this phase)
// ---------------------------------------------------------------------------

export interface SectionListRow {
  id: number;
  public_id: string;
  section_name: string;
  status: string;
  updated_at: number;
  offers_count: number;
  articles_using: number;
}

export interface SectionsPageFilters {
  search: string;
  status: string;
  range: string;
}

export interface SectionsPageProps {
  sections: ReadonlyArray<SectionListRow>;
  paging: Paging;
  filters: SectionsPageFilters;
  timeframe: Timeframe;
  loadError: string | null;
}

const SECTION_COLUMN_COUNT = 5 + ENTITY_ANALYTICS_COLUMNS.length + 1;

function renderSectionsToolbar(props: SectionsPageProps): string {
  const f = props.filters;
  const statusOptions = ["", ...SECTION_STATUSES]
    .map((s) => {
      const sel = s === f.status ? " selected" : "";
      const label = s === "" ? "All statuses" : s;
      return `<option value="${escapeHtml(s)}"${sel}>${escapeHtml(label)}</option>`;
    })
    .join("");
  return `<div class="toolbar">
  <a href="/admin/listicles/sections/new" class="btn btn-primary">+ Create Section</a>
  <div class="toolbar-search"><input type="search" name="search" class="form-input" placeholder="Search sections…" value="${escapeHtml(f.search)}" aria-label="Search sections" /></div>
  <div class="toolbar-filters">
    <select name="status" class="form-select" aria-label="Status filter">${statusOptions}</select>
    ${renderTimeframeSelect(props.timeframe.key)}
  </div>
</div>`;
}

function renderSectionRow(s: SectionListRow): string {
  const name = escapeHtml(s.section_name);
  return `<tr data-entity-id="${s.id}" data-entity-name="${name}">
  <td>${name}</td>
  <td class="lst-num">${s.offers_count}</td>
  <td class="lst-num">${s.articles_using}</td>
  <td>${escapeHtml(formatEpochDate(s.updated_at))}</td>
  <td><span class="${statusBadgeClass(s.status)}">${escapeHtml(s.status)}</span></td>
  ${renderAnalyticsSkeletonCells(ENTITY_ANALYTICS_COLUMNS)}
  <td><div class="table-actions">
    <a class="btn btn-sm btn-secondary" href="/admin/listicles/sections/${s.id}/edit">Edit</a>
    <button type="button" class="btn btn-sm btn-outline" data-section-offers="${s.id}" data-section-name="${name}" title="View Offers used">Offers used</button>
    <button type="button" class="btn btn-sm btn-outline" data-section-usage="${s.id}" data-section-name="${name}" title="View usage in Articles">Usage in Articles</button>
    <button type="button" class="btn btn-sm btn-outline" data-lst-analytics-action>Analytics</button>
  </div></td>
</tr>`;
}

function renderSectionsTable(props: SectionsPageProps): string {
  const hasActiveFilters =
    props.filters.search !== "" || props.filters.status !== "";
  const empty = hasActiveFilters
    ? `<div class="empty-state"><p>No sections match the current filters.</p></div>`
    : `<div class="empty-state"><p>No sections yet.</p><a href="/admin/listicles/sections/new" class="btn btn-primary">+ Create Section</a></div>`;
  const rows =
    props.sections.length === 0
      ? `<tr><td colspan="${SECTION_COLUMN_COUNT}">${empty}</td></tr>`
      : props.sections.map(renderSectionRow).join("");
  return `<div class="card">
  <div class="table-wrapper">
    <table class="table sections-list" aria-label="Sections list"
      data-lst-analytics
      data-analytics-url-prefix="/api/admin/listicles/sections/"
      data-analytics-from="${escapeHtml(props.timeframe.from)}"
      data-analytics-to="${escapeHtml(props.timeframe.to)}">
      <thead><tr>
        <th scope="col">Section name</th>
        <th scope="col" class="lst-num">Offers</th>
        <th scope="col" class="lst-num">Articles using</th>
        <th scope="col">Updated</th>
        <th scope="col">Status</th>
        ${renderAnalyticsHeaderCells(ENTITY_ANALYTICS_COLUMNS)}
        <th scope="col">Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>`;
}

// Sections page script: the two §10 usage dialogs (Offers used / usage in
// Articles) over the Phase-2 endpoints. Strict ES5.
const SECTIONS_PAGE_SCRIPT = `
(function () {
  var getJson = window.lstUi.getJson;

  function renderListInto(bodyEl, items, toText, emptyText) {
    if (!items || items.length === 0) {
      var none = document.createElement('p');
      none.className = 'empty-state';
      none.appendChild(document.createTextNode(emptyText));
      bodyEl.appendChild(none);
      return;
    }
    var ul = document.createElement('ul');
    ul.className = 'lst-usage-list';
    var i, li;
    for (i = 0; i < items.length; i++) {
      li = document.createElement('li');
      li.appendChild(document.createTextNode(toText(items[i])));
      ul.appendChild(li);
    }
    bodyEl.appendChild(ul);
  }

  function loadDialog(title, url, listKey, toText, emptyText) {
    var bodyEl = window.lstUi.openDialog(title);
    if (!bodyEl) { return; }
    var loading = document.createElement('p');
    loading.appendChild(document.createTextNode('Loading\\u2026'));
    bodyEl.appendChild(loading);
    function showLoadError() {
      // §8 error state — never leave the dialog stuck on "Loading…".
      if (loading.parentNode) { loading.parentNode.removeChild(loading); }
      var err = document.createElement('p');
      err.className = 'alert alert-error';
      err.appendChild(document.createTextNode('Failed to load.'));
      bodyEl.appendChild(err);
      if (window.showToast) { window.showToast('Failed to load', 'error'); }
    }
    getJson('GET', url).then(function (res) {
      if (!res.ok || !res.body) {
        showLoadError();
        return;
      }
      if (loading.parentNode) { loading.parentNode.removeChild(loading); }
      renderListInto(bodyEl, res.body[listKey] || [], toText, emptyText);
    }).catch(showLoadError);
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) { return; }
    var offersBtn = t.closest('[data-section-offers]');
    if (offersBtn) {
      loadDialog(
        'Offers used \\u2014 ' + (offersBtn.getAttribute('data-section-name') || ''),
        '/api/admin/listicles/sections/' + encodeURIComponent(offersBtn.getAttribute('data-section-offers')) + '/offers',
        'offers',
        function (o) {
          var text = o.offer_name || o.public_id || String(o.id);
          if (o.link_role) { text += ' \\u00b7 ' + o.link_role; }
          if (o.occurrences) { text += ' \\u00d7' + o.occurrences; }
          return text;
        },
        'No offers are used by this section yet.'
      );
      return;
    }
    var usageBtn = t.closest('[data-section-usage]');
    if (usageBtn) {
      loadDialog(
        'Usage in Articles \\u2014 ' + (usageBtn.getAttribute('data-section-name') || ''),
        '/api/admin/listicles/sections/' + encodeURIComponent(usageBtn.getAttribute('data-section-usage')) + '/usage',
        'usage',
        function (u) {
          var text = u.article_name || u.public_id || String(u.id);
          if (u.status) { text += ' (' + u.status + ')'; }
          return text;
        },
        'No articles use this section yet.'
      );
    }
  });
}());
`;

export function listiclesSectionsPage(
  props: SectionsPageProps,
  branding: ListiclesBranding = {},
): string {
  const pager = renderListPager(
    {
      page: props.paging.page,
      per_page: props.paging.page_size,
      total: props.paging.total,
    },
    {
      search: props.filters.search,
      status: props.filters.status,
      range: props.filters.range,
    },
  );
  const loadErrorHtml = props.loadError
    ? `<p class="alert alert-error" role="alert">${escapeHtml(props.loadError)}</p>`
    : "";
  const content = `${renderListiclesTabs("sections")}
${loadErrorHtml}
${renderSectionsToolbar(props)}
${renderSectionsTable(props)}
${pager}
${renderDialogShell()}`;
  return adminLayout({
    title: "Listicles",
    activePath: "/admin/listicles/sections",
    userEmail: branding.userEmail,
    content,
    styles: LISTICLES_STYLES,
    scripts: LST_SHARED_SCRIPT + SECTIONS_PAGE_SCRIPT + listFilterScript,
  });
}

// ---------------------------------------------------------------------------
// Articles tab (§11 — list-only this phase; site-scoped)
// ---------------------------------------------------------------------------

export interface ArticleListRow {
  id: number;
  public_id: string;
  article_name: string;
  slug: string;
  status: string;
  version_count: number;
  experiment_status: string | null;
}

export interface ArticlesSiteOption {
  id: string;
  name?: string;
}

export interface ArticlesPageProps {
  articles: ReadonlyArray<ArticleListRow>;
  paging: Paging;
  sites: ReadonlyArray<ArticlesSiteOption>;
  selectedSiteId: string | null;
  search: string;
  range: string;
  timeframe: Timeframe;
  loadError: string | null;
}

// +1 leading expander column (§11 drilldown "+"), 4 management columns
// (name/slug/versions/status), the analytics columns, +1 actions column.
const ARTICLE_COLUMN_COUNT = 1 + 4 + ARTICLE_ANALYTICS_COLUMNS.length + 1;

// Phase 5: the Create button is a LIVE link to the Article builder and the
// toolbar gains the ?search= box (name/slug — DEV-10 closed).
function renderArticlesToolbar(props: ArticlesPageProps): string {
  const siteOptions = props.sites
    .map((s) => {
      const sel = s.id === props.selectedSiteId ? " selected" : "";
      return `<option value="${escapeHtml(s.id)}"${sel}>${escapeHtml(s.name ?? s.id)}</option>`;
    })
    .join("");
  return `<div class="toolbar">
  <a href="/admin/listicles/articles/new" class="btn btn-primary">+ Create Article</a>
  <div class="toolbar-search"><input type="search" name="search" class="form-input" placeholder="Search articles…" value="${escapeHtml(props.search)}" aria-label="Search articles" /></div>
  <div class="toolbar-filters">
    <select name="site_id" class="form-select" aria-label="Site filter" required aria-required="true">
      <option value="">Choose a site…</option>
      ${siteOptions}
    </select>
    ${renderTimeframeSelect(props.timeframe.key)}
  </div>
</div>`;
}

function renderArticleRow(a: ArticleListRow): string {
  const name = escapeHtml(a.article_name);
  const experiment =
    a.experiment_status === "running"
      ? ` <span class="badge badge-scheduled">A/B running</span>`
      : "";
  return `<tr data-entity-id="${a.id}" data-entity-name="${name}">
  <td class="lst-exp-col"><button type="button" class="btn btn-sm btn-outline lst-drill-toggle" data-lst-drill-toggle aria-expanded="false" aria-label="Toggle drilldown" title="Version, Page and candidate breakdown">+</button></td>
  <td>${name}${experiment}</td>
  <td>${escapeHtml(a.slug)}</td>
  <td class="lst-num">${a.version_count}</td>
  <td><span class="${statusBadgeClass(a.status)}">${escapeHtml(a.status)}</span></td>
  ${renderAnalyticsSkeletonCells(ARTICLE_ANALYTICS_COLUMNS)}
  <td><div class="table-actions">
    <a class="btn btn-sm btn-secondary" href="/admin/listicles/articles/${escapeHtml(a.public_id)}/edit">Edit</a>
    <button type="button" class="btn btn-sm btn-outline" data-lst-analytics-action>Analytics</button>
  </div></td>
</tr>`;
}

function renderArticlesTable(props: ArticlesPageProps): string {
  const empty =
    props.search !== ""
      ? `<div class="empty-state"><p>No articles match the current search.</p></div>`
      : `<div class="empty-state"><p>No listicle articles for this site yet.</p><a href="/admin/listicles/articles/new" class="btn btn-primary">+ Create Article</a></div>`;
  const rows =
    props.articles.length === 0
      ? `<tr><td colspan="${ARTICLE_COLUMN_COUNT}">${empty}</td></tr>`
      : props.articles.map(renderArticleRow).join("");
  return `<div class="card">
  <div class="table-wrapper">
    <table class="table articles-list" aria-label="Listicle articles list"
      data-lst-analytics
      data-analytics-url-prefix="/api/admin/listicles/articles/"
      data-analytics-pick="total"
      data-analytics-from="${escapeHtml(props.timeframe.from)}"
      data-analytics-to="${escapeHtml(props.timeframe.to)}">
      <thead><tr>
        <th scope="col" class="lst-exp-col" aria-label="Drilldown"></th>
        <th scope="col">Article name</th>
        <th scope="col">Slug</th>
        <th scope="col" class="lst-num">Versions</th>
        <th scope="col">Status</th>
        ${renderAnalyticsHeaderCells(ARTICLE_ANALYTICS_COLUMNS)}
        <th scope="col">Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>`;
}

// Repo "Site is required" gate: Articles are per-site (§4/§11); without a
// site there is nothing to list.
function renderSiteRequiredGate(): string {
  return `<div class="card">
  <div class="empty-state">
    <p>Site is required</p>
    <p class="form-help">Listicle articles are site-scoped. Create a site under Domains first.</p>
    <a href="/admin/domains" class="btn btn-primary">Go to Domains</a>
  </div>
</div>`;
}

// §18 manual backfill affordance: from/to + Rebuild button → POST
// /analytics/rebuild-range. Global (not per-article) so it rides once on the
// Articles analytics surface, above the table, available even behind the
// site gate. Toast + inline status on result; ES5-only wiring below.
function renderRebuildRangeControl(): string {
  return `<details class="lst-rebuild">
  <summary>Rebuild analytics range</summary>
  <div class="lst-rebuild-body">
    <label class="lst-rebuild-field">From<input type="date" class="form-input" data-lst-rebuild-from aria-label="Rebuild range from date" /></label>
    <label class="lst-rebuild-field">To<input type="date" class="form-input" data-lst-rebuild-to aria-label="Rebuild range to date" /></label>
    <button type="button" class="btn btn-sm btn-primary" data-lst-rebuild-run>Rebuild</button>
    <span class="form-status" data-lst-rebuild-status role="status" aria-live="polite"></span>
  </div>
</details>`;
}

// §11 Drilldown expander (strict ES5). A per-article "+" toggle async-hydrates
// the EXISTING GET /articles/:id/drilldown endpoint into a detail row nested
// Version → Page → candidate, with per-row metrics; rule_based pages add the
// matched_sessions / fallback_sessions / rule_match_rate columns. Reuses the
// shared getJson + .skel skeleton machinery; empty-state when zero; per-row
// error + Retry. The detail row carries no data-entity-id/data-metric so the
// LST_SHARED_SCRIPT analytics hydrator never touches it.
const ARTICLES_DRILLDOWN_SCRIPT = `
(function () {
  var lstUi = window.lstUi || {};
  var getJson = lstUi.getJson;

  function fmt(kind, v) {
    if (v === null || v === undefined) { return '\\u2014'; }
    var n = Number(v);
    if (!isFinite(n)) { return '\\u2014'; }
    if (kind === 'int') { return String(Math.round(n)); }
    if (kind === 'pct') { return (n * 100).toFixed(2) + '%'; }
    if (kind === 'dec') { return n.toFixed(2); }
    return String(v);
  }
  function txt(v) {
    if (v === null || v === undefined || v === '') { return '\\u2014'; }
    return String(v);
  }

  var BASE_COLS = [
    ['Section', 'section_public_id', 'text'],
    ['Candidate', 'page_candidate_id', 'text'],
    ['Reason', 'selection_reason', 'text'],
    ['Impr', 'impressions', 'int'],
    ['Clicks', 'clicks', 'int'],
    ['Uniq', 'unique_clicks', 'int'],
    ['Conv', 'conversions', 'int'],
    ['CTR', 'ctr', 'pct'],
    ['CVR', 'cvr', 'pct'],
    ['Rev', 'revenue', 'dec'],
    ['RPC', 'rpc', 'dec'],
    ['RPM', 'rpm', 'dec']
  ];
  var RULE_COLS = [
    ['Matched', 'matched_sessions', 'int'],
    ['Fallback', 'fallback_sessions', 'int'],
    ['Match rate', 'rule_match_rate', 'pct']
  ];

  function clearChildren(el) { while (el.firstChild) { el.removeChild(el.firstChild); } }

  function findTable(el) {
    var t = el;
    while (t && t.nodeName !== 'TABLE') { t = t.parentNode; }
    return t;
  }

  function drillUrl(table, id) {
    var prefix = table.getAttribute('data-analytics-url-prefix') || '';
    var from = table.getAttribute('data-analytics-from') || '';
    var to = table.getAttribute('data-analytics-to') || '';
    return prefix + encodeURIComponent(id) + '/drilldown?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
  }

  function showSkeleton(box) {
    clearChildren(box);
    var i, p, span;
    for (i = 0; i < 3; i++) {
      p = document.createElement('p');
      p.className = 'lst-drill-skel';
      span = document.createElement('span');
      span.className = 'skel';
      span.setAttribute('aria-hidden', 'true');
      p.appendChild(span);
      box.appendChild(p);
    }
  }

  function renderCandRow(tr, cols, cand) {
    var j, td;
    for (j = 0; j < cols.length; j++) {
      td = document.createElement('td');
      if (cols[j][2] === 'text') {
        td.appendChild(document.createTextNode(txt(cand[cols[j][1]])));
      } else {
        td.className = 'lst-num';
        td.appendChild(document.createTextNode(fmt(cols[j][2], cand[cols[j][1]])));
      }
      tr.appendChild(td);
    }
  }

  function renderDrill(box, body) {
    clearChildren(box);
    var dd = body && body.drilldown;
    var versions = (dd && dd.versions) || [];
    if (versions.length === 0) {
      var none = document.createElement('p');
      none.className = 'empty-state';
      none.appendChild(document.createTextNode('No drilldown analytics for this article in this range yet.'));
      box.appendChild(none);
      return;
    }
    var vi, pi, ci, k;
    for (vi = 0; vi < versions.length; vi++) {
      var ver = versions[vi];
      var vbox = document.createElement('div');
      vbox.className = 'lst-drill-version';
      var vh = document.createElement('h4');
      vh.appendChild(document.createTextNode('Version ' + txt(ver.article_version_id)));
      vbox.appendChild(vh);
      var pages = ver.pages || [];
      for (pi = 0; pi < pages.length; pi++) {
        var pg = pages[pi];
        var isRule = pg.page_selection_mode === 'rule_based';
        var cols = isRule ? BASE_COLS.concat(RULE_COLS) : BASE_COLS;
        var pbox = document.createElement('div');
        pbox.className = 'lst-drill-page';
        var ph = document.createElement('h5');
        ph.appendChild(document.createTextNode('Page ' + txt(pg.page_index) + ' \\u00b7 ' + txt(pg.page_selection_mode)));
        pbox.appendChild(ph);
        var tbl = document.createElement('table');
        tbl.className = 'lst-drill-table';
        var thead = document.createElement('thead');
        var htr = document.createElement('tr');
        var th;
        for (ci = 0; ci < cols.length; ci++) {
          th = document.createElement('th');
          if (cols[ci][2] !== 'text') { th.className = 'lst-num'; }
          th.appendChild(document.createTextNode(cols[ci][0]));
          htr.appendChild(th);
        }
        thead.appendChild(htr);
        tbl.appendChild(thead);
        var tbody = document.createElement('tbody');
        var cands = pg.candidates || [];
        for (k = 0; k < cands.length; k++) {
          var ctr = document.createElement('tr');
          renderCandRow(ctr, cols, cands[k]);
          tbody.appendChild(ctr);
        }
        tbl.appendChild(tbody);
        pbox.appendChild(tbl);
        vbox.appendChild(pbox);
      }
      box.appendChild(vbox);
    }
  }

  function showError(box, table, id) {
    clearChildren(box);
    var err = document.createElement('p');
    err.className = 'alert alert-error';
    err.appendChild(document.createTextNode('Failed to load drilldown.'));
    box.appendChild(err);
    var retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-sm btn-outline';
    retry.appendChild(document.createTextNode('Retry'));
    retry.onclick = function () { loadDrill(box, table, id); };
    box.appendChild(retry);
    if (window.showToast) { window.showToast('Failed to load drilldown', 'error'); }
  }

  function loadDrill(box, table, id) {
    showSkeleton(box);
    getJson('GET', drillUrl(table, id)).then(function (res) {
      if (!res.ok || !res.body || res.body.error) { showError(box, table, id); return; }
      renderDrill(box, res.body);
    }).catch(function () { showError(box, table, id); });
  }

  function setToggleLabel(btn, ch) {
    clearChildren(btn);
    btn.appendChild(document.createTextNode(ch));
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) { return; }
    var btn = t.closest('[data-lst-drill-toggle]');
    if (!btn) { return; }
    var row = btn.closest('tr');
    var table = findTable(row);
    if (!row || !table) { return; }
    var id = row.getAttribute('data-entity-id');
    if (!id) { return; }
    var expanded = btn.getAttribute('aria-expanded') === 'true';
    if (btn.lstDrillRow) {
      if (expanded) {
        btn.lstDrillRow.style.display = 'none';
        btn.setAttribute('aria-expanded', 'false');
        setToggleLabel(btn, '+');
      } else {
        btn.lstDrillRow.style.display = '';
        btn.setAttribute('aria-expanded', 'true');
        setToggleLabel(btn, '\\u2212');
      }
      return;
    }
    var tr = document.createElement('tr');
    tr.className = 'lst-drill-row';
    var td = document.createElement('td');
    td.colSpan = row.cells ? row.cells.length : 1;
    var box = document.createElement('div');
    box.className = 'lst-drill-box';
    td.appendChild(box);
    tr.appendChild(td);
    if (row.parentNode) { row.parentNode.insertBefore(tr, row.nextSibling); }
    btn.lstDrillRow = tr;
    btn.setAttribute('aria-expanded', 'true');
    setToggleLabel(btn, '\\u2212');
    loadDrill(box, table, id);
  });
}());
`;

// §18 rebuild-range wiring (strict ES5): POST the from/to window to the
// existing endpoint, toast + inline status the honest summary (configured:
// false ⇒ no-CH no-op locally), and re-hydrate analytics so newly-synced
// rows surface without a reload.
const ARTICLES_REBUILD_SCRIPT = `
(function () {
  var lstUi = window.lstUi || {};
  var getJson = lstUi.getJson;
  var REBUILD_URL = '/api/admin/listicles/analytics/rebuild-range';

  function setStatus(el, msg) {
    if (!el) { return; }
    while (el.firstChild) { el.removeChild(el.firstChild); }
    el.appendChild(document.createTextNode(msg || ''));
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) { return; }
    var btn = t.closest('[data-lst-rebuild-run]');
    if (!btn) { return; }
    var wrap = btn.closest('.lst-rebuild') || document;
    var fromEl = wrap.querySelector('[data-lst-rebuild-from]');
    var toEl = wrap.querySelector('[data-lst-rebuild-to]');
    var statusEl = wrap.querySelector('[data-lst-rebuild-status]');
    var from = fromEl ? fromEl.value : '';
    var to = toEl ? toEl.value : '';
    if (!from || !to) {
      setStatus(statusEl, 'Enter a from and a to date.');
      if (window.showToast) { window.showToast('Enter a from and a to date', 'error'); }
      return;
    }
    btn.disabled = true;
    setStatus(statusEl, 'Rebuilding\\u2026');
    getJson('POST', REBUILD_URL, { from: from, to: to }).then(function (res) {
      btn.disabled = false;
      if (!res.ok || !res.body || res.body.error) {
        var msg = (res.body && res.body.error) || 'Rebuild failed';
        var fields = res.body && res.body.fields;
        var fk;
        if (fields) { for (fk in fields) { if (fields.hasOwnProperty(fk)) { msg += ' \\u2014 ' + fields[fk]; break; } } }
        setStatus(statusEl, msg);
        if (window.showToast) { window.showToast(msg, 'error'); }
        return;
      }
      var rb = res.body.rebuild || {};
      var errs = (rb.errors && rb.errors.length) || 0;
      var rows = (rb.total_rows === null || rb.total_rows === undefined) ? 0 : rb.total_rows;
      var done, toastKind;
      if (rb.configured === false) {
        // honest no-op: no CH secret configured (dev / not-yet-activated).
        done = 'No ClickHouse configured \\u2014 mirror rebuild is a no-op here.';
        toastKind = 'success';
      } else if (errs > 0) {
        // §18 per-table isolation: some mirrors synced, some failed — never
        // report a partial CH failure as a clean success.
        done = 'Rebuilt ' + rows + ' rows, ' + errs + ' table(s) failed over ' + from + ' \\u2192 ' + to + '.';
        toastKind = 'error';
      } else {
        done = 'Rebuild complete: ' + rows + ' rows over ' + from + ' \\u2192 ' + to + '.';
        toastKind = 'success';
      }
      setStatus(statusEl, done);
      if (window.showToast) { window.showToast(done, toastKind); }
      if (lstUi.hydrateAll) { lstUi.hydrateAll(); }
    }).catch(function () {
      btn.disabled = false;
      setStatus(statusEl, 'Rebuild failed.');
      if (window.showToast) { window.showToast('Rebuild failed', 'error'); }
    });
  });
}());
`;

export function listiclesArticlesPage(
  props: ArticlesPageProps,
  branding: ListiclesBranding = {},
): string {
  const gated = props.selectedSiteId === null;
  const pager = gated
    ? ""
    : renderListPager(
        {
          page: props.paging.page,
          per_page: props.paging.page_size,
          total: props.paging.total,
        },
        {
          site_id: props.selectedSiteId ?? undefined,
          search: props.search,
          range: props.range,
        },
      );
  const loadErrorHtml = props.loadError
    ? `<p class="alert alert-error" role="alert">${escapeHtml(props.loadError)}</p>`
    : "";
  const body = gated ? renderSiteRequiredGate() : renderArticlesTable(props);
  const content = `${renderListiclesTabs("articles")}
${loadErrorHtml}
${renderArticlesToolbar(props)}
${renderRebuildRangeControl()}
${body}
${pager}
${renderDialogShell()}`;
  return adminLayout({
    title: "Listicles",
    activePath: "/admin/listicles/articles",
    userEmail: branding.userEmail,
    content,
    styles: LISTICLES_STYLES,
    scripts:
      LST_SHARED_SCRIPT +
      ARTICLES_DRILLDOWN_SCRIPT +
      ARTICLES_REBUILD_SCRIPT +
      listFilterScript,
  });
}
