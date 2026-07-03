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
  range: string;
  timeframe: Timeframe;
  loadError: string | null;
}

const ARTICLE_COLUMN_COUNT = 4 + ARTICLE_ANALYTICS_COLUMNS.length + 1;

function renderArticlesToolbar(props: ArticlesPageProps): string {
  const siteOptions = props.sites
    .map((s) => {
      const sel = s.id === props.selectedSiteId ? " selected" : "";
      return `<option value="${escapeHtml(s.id)}"${sel}>${escapeHtml(s.name ?? s.id)}</option>`;
    })
    .join("");
  return `<div class="toolbar">
  <button type="button" class="btn btn-primary" disabled aria-disabled="true" title="Article builder ships in Phase 5">+ Create Article</button>
  <span class="form-help lst-phase-note">Article builder ships in Phase 5</span>
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
  <td>${name}${experiment}</td>
  <td>${escapeHtml(a.slug)}</td>
  <td class="lst-num">${a.version_count}</td>
  <td><span class="${statusBadgeClass(a.status)}">${escapeHtml(a.status)}</span></td>
  ${renderAnalyticsSkeletonCells(ARTICLE_ANALYTICS_COLUMNS)}
  <td><div class="table-actions">
    <button type="button" class="btn btn-sm btn-outline" data-lst-analytics-action>Analytics</button>
  </div></td>
</tr>`;
}

function renderArticlesTable(props: ArticlesPageProps): string {
  const empty = `<div class="empty-state"><p>No listicle articles for this site yet.</p><p class="form-help">Article builder ships in Phase 5.</p></div>`;
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
${body}
${pager}
${renderDialogShell()}`;
  return adminLayout({
    title: "Listicles",
    activePath: "/admin/listicles/articles",
    userEmail: branding.userEmail,
    content,
    styles: LISTICLES_STYLES,
    scripts: LST_SHARED_SCRIPT + listFilterScript,
  });
}
