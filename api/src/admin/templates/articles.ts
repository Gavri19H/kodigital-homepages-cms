// Admin Articles templates (legacy admin port, multi-site adapted).
// articlesListPage  — 8-column table + 8 filter controls + toolbar New button.
//   Toolbar search is a GET form (legacy semantics); the Site filter uses
//   the site_id wire name so it drives the ?site_id= query the /admin/
//   articles handler resolves. Row actions: Edit link to the editor and a
//   Delete button wired to DELETE /api/admin/articles/:id (legacy
//   deleteArticle flow via the layout's confirmDelete/api/showToast
//   globals).
// articleFormPage  — site-required form with homepage fields + SEO fields.
// New-mode submits POST /api/admin/articles; edit-mode submits PATCH
// /api/admin/articles/:id. Form posts JSON via fetch(). The submit-block
// behaviors from views/article-editor.ts:122-133 are folded into the
// inline script (T26.AC3): with no site selected, submit is blocked
// (stopImmediatePropagation), the aria-live="polite" status region reads
// "Site is required", the Site select takes focus, and no request fires.
// The form page also mounts the AI assistant panel (T28 [B8], ./ai-panel)
// below the form — preset select fed by GET /api/admin/ai/presets, generate
// actions on POST /api/admin/ai/chat and /api/admin/ai/image.

import { adminLayout, escapeHtml, renderListPager, type ListPagerMeta } from "./layout";
import { editorScripts, editorStyles } from "../../editor/editor-scripts";
import {
  BLOCK_EDITOR_COLOR_TOKENS,
  blockEditorMountScript,
  renderBlockEditorField,
} from "../../editor/mount";
import {
  aiAssistantScripts,
  aiAssistantStyles,
  renderAIAssistantPanel,
} from "./ai-panel";
import {
  heroImageScripts,
  heroImageStyles,
  renderHeroImageCard,
} from "./hero-image";
import {
  renderWorkflowPanel,
  workflowPanelScripts,
  workflowPanelStyles,
} from "./workflow-panel";

export interface SiteOption {
  id: string;
  name?: string;
  // The site's vertical slug rides the <option> as data-vertical so the AI
  // panel's context resolution can fill {{vertical}} client-side.
  vertical?: string;
}

export interface VerticalOption {
  slug: string;
  label?: string;
}

export interface CategoryOption {
  id: string;
  name: string;
  site_id?: string | null;
}

export interface ArticleListEntry {
  id?: string;
  title: string;
  slug?: string;
  site?: string;
  site_id?: string | null;
  category?: string;
  status?: string;
  homepage_section?: string | null;
  published_at?: string | null;
  updated_at?: string | null;
  is_featured?: boolean | number;
  is_trending?: boolean | number;
}

export interface ArticleFormValues {
  id?: string;
  title?: string;
  slug?: string;
  site_id?: string | null;
  category_id?: string;
  status?: string;
  excerpt?: string;
  subtitle?: string;
  content_json?: string;
  content_html?: string;
  homepage_section?: string | null;
  homepage_rank?: number | null;
  is_featured?: boolean | number;
  is_trending?: boolean | number;
  featured_image_id?: number | string | null;
  featured_image_url?: string | null;
  seo_title?: string;
  seo_description?: string;
  published_at?: string | null;
  author_name?: string | null;
  author_bio?: string | null;
}

export interface ArticlesBranding {
  userEmail?: string;
  conversionsUiEnabled?: boolean;
}

// Active list-filter state (URL query params) so selects render their
// selected option after a filter-driven reload. site_id is the wire name
// for the per-site filter (?site_id=) the admin UI handler resolves.
export interface ArticleListFilters {
  site_id?: string;
  search?: string;
  vertical?: string;
  category?: string;
  status?: string;
  featured?: string;
  trending?: string;
  published?: string;
}

const STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
];

function selectedAttr(a: string | undefined, b: string): string {
  return a === b ? " selected" : "";
}

function renderSiteOptions(sites: ReadonlyArray<SiteOption>, selected?: string, includeBlank?: boolean): string {
  const blank = includeBlank ? `<option value="">All sites</option>` : "";
  const opts = sites.map((s) => {
    const value = escapeHtml(s.id);
    const label = escapeHtml(s.name ?? s.id);
    const vertical = escapeHtml(s.vertical ?? "");
    return `<option value="${value}" data-vertical="${vertical}"${selectedAttr(selected, s.id)}>${label}</option>`;
  }).join("");
  return blank + opts;
}

function renderVerticalOptions(verticals: ReadonlyArray<VerticalOption>, selected?: string): string {
  const blank = `<option value="">All verticals</option>`;
  const opts = verticals.map((v) => {
    return `<option value="${escapeHtml(v.slug)}"${selectedAttr(selected, v.slug)}>${escapeHtml(v.label ?? v.slug)}</option>`;
  }).join("");
  return blank + opts;
}

function binaryFilterOptions(selected: string | undefined, anyLabel: string, onLabel: string, offLabel: string): string {
  return `<option value="">${escapeHtml(anyLabel)}</option>` +
    `<option value="1"${selectedAttr(selected, "1")}>${escapeHtml(onLabel)}</option>` +
    `<option value="0"${selectedAttr(selected, "0")}>${escapeHtml(offLabel)}</option>`;
}

function renderCategoryOptions(categories: ReadonlyArray<CategoryOption>, selected?: string, includeBlank?: boolean): string {
  const blank = includeBlank ? `<option value="">All categories</option>` : `<option value="">— None —</option>`;
  const opts = categories.map((c) => {
    return `<option value="${escapeHtml(c.id)}"${selectedAttr(selected, c.id)}>${escapeHtml(c.name)}</option>`;
  }).join("");
  return blank + opts;
}

function renderStatusOptions(selected?: string, includeBlank?: boolean): string {
  const blank = includeBlank ? `<option value="">All statuses</option>` : "";
  const opts = STATUS_OPTIONS.map((s) => {
    return `<option value="${s.value}"${selectedAttr(selected, s.value)}>${escapeHtml(s.label)}</option>`;
  }).join("");
  return blank + opts;
}

function renderToolbar(sites: ReadonlyArray<SiteOption>, verticals: ReadonlyArray<VerticalOption>, categories: ReadonlyArray<CategoryOption>, filters: ArticleListFilters): string {
  return `<div class="toolbar">
  <div class="toolbar-search">
    <form method="get" action="/admin/articles">
      <input type="search" name="search" class="form-input" placeholder="Search articles..." value="${escapeHtml(filters.search ?? "")}" />
      <button type="submit" class="btn btn-secondary">Search</button>
    </form>
  </div>
  <div class="toolbar-filters">
    <select name="site_id" class="form-select" aria-label="Site filter">${renderSiteOptions(sites, filters.site_id, true)}</select>
    <select name="vertical" class="form-select" aria-label="Vertical filter">${renderVerticalOptions(verticals, filters.vertical)}</select>
    <select name="category" class="form-select" aria-label="Category filter">${renderCategoryOptions(categories, filters.category, true)}</select>
    <select name="status" class="form-select" aria-label="Status filter">${renderStatusOptions(filters.status, true)}</select>
    <select name="featured" class="form-select" aria-label="Featured filter">${binaryFilterOptions(filters.featured, "Any featured", "Featured only", "Not featured")}</select>
    <select name="trending" class="form-select" aria-label="Trending filter">${binaryFilterOptions(filters.trending, "Any trending", "Trending only", "Not trending")}</select>
    <select name="published" class="form-select" aria-label="Published filter">${binaryFilterOptions(filters.published, "Any published", "Has published_at", "No published_at")}</select>
  </div>
  <a href="/admin/articles/new" class="btn btn-primary">+ New Article</a>
</div>`;
}

function renderArticleRow(a: ArticleListEntry): string {
  const id = escapeHtml(a.id ?? "");
  const title = escapeHtml(a.title);
  const slug = escapeHtml(a.slug ?? "");
  const site = escapeHtml(a.site ?? a.site_id ?? "");
  const category = escapeHtml(a.category ?? "");
  const status = escapeHtml(a.status ?? "draft");
  const homepage = escapeHtml(a.homepage_section ?? "");
  const published = escapeHtml(a.published_at ?? "");
  const updated = escapeHtml(a.updated_at ?? "");
  const editHref = id ? `/admin/articles/${id}/edit` : "/admin/articles";
  return `<tr data-article-id="${id}">
  <td>
    <a href="${editHref}" class="article-title-link">${title}</a>
    <br /><small class="article-slug">/${slug}</small>
  </td>
  <td>${site}</td>
  <td>${category}</td>
  <td><span class="badge badge-${status}">${status}</span></td>
  <td>${homepage}</td>
  <td>${published}</td>
  <td>${updated}</td>
  <td class="table-actions">
    <a href="${editHref}" class="btn btn-secondary btn-sm">Edit</a>
    <button type="button" class="btn btn-danger btn-sm" data-delete-article="${id}" data-article-title="${title}">Delete</button>
  </td>
</tr>`;
}

function renderArticlesTable(articles: ReadonlyArray<ArticleListEntry>): string {
  if (articles.length === 0) {
    return `<div class="card">
  <div class="empty-state">
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
    </svg>
    <p>No articles found</p>
    <a href="/admin/articles/new" class="btn btn-primary">Create Your First Article</a>
  </div>
</div>`;
  }
  const rows = articles.map(renderArticleRow).join("");
  return `<div class="card">
  <div class="table-wrapper">
    <table class="table articles-list" aria-label="Articles list">
      <thead><tr>
        <th scope="col">Title</th>
        <th scope="col">Site</th>
        <th scope="col">Category</th>
        <th scope="col">Status</th>
        <th scope="col">Homepage section</th>
        <th scope="col">Published</th>
        <th scope="col">Updated</th>
        <th scope="col">Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>`;
}

const ARTICLES_LIST_STYLES = `
.toolbar-search form{display:flex;gap:8px}
.article-title-link{font-weight:500}
.article-slug{color:var(--c-muted)}
`;

// ES5 only (var, .then(), no template literals). Filter selects rewrite
// the URL query param matching their name (?site_id= for the Site
// filter); the search GET form carries the active site_id along via a
// hidden input; Delete row actions run the legacy confirmDelete ->
// DELETE /api/admin/articles/:id -> reload flow using the layout's
// api()/showToast globals.
const ARTICLES_LIST_SCRIPT = `
(function () {
  function applyFilter(select) {
    var url = new URL(window.location.href);
    if (select.value) {
      url.searchParams.set(select.name, select.value);
    } else {
      url.searchParams.delete(select.name);
    }
    url.searchParams.delete('page');
    window.location.href = url.toString();
  }
  var filterSelects = document.querySelectorAll('.toolbar-filters select');
  var i;
  for (i = 0; i < filterSelects.length; i++) {
    filterSelects[i].addEventListener('change', function () {
      applyFilter(this);
    });
  }
  var searchForm = document.querySelector('.toolbar-search form');
  var siteSelect = document.querySelector('select[name=site_id]');
  if (searchForm && siteSelect) {
    searchForm.addEventListener('submit', function () {
      if (!siteSelect.value) { return; }
      var hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = 'site_id';
      hidden.value = siteSelect.value;
      searchForm.appendChild(hidden);
    });
  }
  function onDeleteClick() {
    var id = this.getAttribute('data-delete-article');
    var title = this.getAttribute('data-article-title') || 'this article';
    if (!id) { return; }
    if (!window.confirmDelete('Are you sure you want to delete "' + title + '"?')) { return; }
    window.api('DELETE', '/api/admin/articles/' + id).then(function (data) {
      if (data && data.error) {
        window.showToast('Error: ' + data.error, 'error');
      } else {
        window.location.reload();
      }
    }).catch(function () {
      window.showToast('Error: Failed to delete article', 'error');
    });
  }
  var deleteButtons = document.querySelectorAll('button[data-delete-article]');
  for (i = 0; i < deleteButtons.length; i++) {
    deleteButtons[i].addEventListener('click', onDeleteClick);
  }
}());
`;

export function articlesListPage(
  articles: ReadonlyArray<ArticleListEntry>,
  sites: ReadonlyArray<SiteOption>,
  verticals: ReadonlyArray<VerticalOption>,
  categories: ReadonlyArray<CategoryOption>,
  branding: ArticlesBranding = {},
  filters: ArticleListFilters = {},
  pageMeta?: ListPagerMeta,
): string {
  const pager = renderListPager(pageMeta, {
    site_id: filters.site_id,
    search: filters.search,
    vertical: filters.vertical,
    category: filters.category,
    status: filters.status,
    featured: filters.featured,
    trending: filters.trending,
    published: filters.published,
  });
  const content = `${renderToolbar(sites, verticals, categories, filters)}${renderArticlesTable(articles)}${pager}`;
  return adminLayout({
    title: "Articles",
    activePath: "/admin/articles",
    userEmail: branding.userEmail,
    conversionsUiEnabled: branding.conversionsUiEnabled,
    content,
    styles: ARTICLES_LIST_STYLES,
    scripts: ARTICLES_LIST_SCRIPT,
  });
}

function boolAttr(v: boolean | number | undefined): string {
  return v ? " checked" : "";
}

// T14d: Author card. Author Name pre-fills from the signed-in admin's email
// in NEW mode (a convenience default — NOT auto-stored: it persists only when
// the editor submits the form, which carries author_name in its JSON body). In
// EDIT mode it shows the article's stored author_name. author_bio is the
// optional byline blurb (DB column added in migration 0017). Field names are
// the DB columns / handler-read keys (author_name, author_bio) — no rename.
function renderAuthorCard(a: ArticleFormValues, isEdit: boolean, branding: ArticlesBranding): string {
  const authorNameVal = escapeHtml(
    a.author_name ?? (isEdit ? "" : branding.userEmail ?? ""),
  );
  const authorBioVal = escapeHtml(a.author_bio ?? "");
  return `<div class="card">
    <div class="card-header"><h3 class="card-title">Author</h3></div>
    <div class="form-group">
      <label for="article-author-name" class="form-label">Author name</label>
      <input id="article-author-name" name="author_name" type="text" class="form-input" value="${authorNameVal}" required />
    </div>
    <div class="form-group">
      <label for="article-author-bio" class="form-label">Author bio</label>
      <textarea id="article-author-bio" name="author_bio" class="form-textarea" rows="3">${authorBioVal}</textarea>
    </div>
  </div>`;
}

// T14d: clean Display Options card. is_featured surfaces the article as the
// homepage hero; is_trending flags it for the trending rail. Field names map
// 1:1 to the DB columns / PATCH allow-list (is_featured, is_trending) — the
// clean labels replace the stripped "Featured"/"Trending" checkbox labels.
function renderDisplayOptions(a: ArticleFormValues): string {
  return `<div class="card">
    <div class="card-header"><h3 class="card-title">Display Options</h3></div>
    <div class="form-group">
      <label for="article-featured" class="form-label"><input id="article-featured" name="is_featured" type="checkbox" value="1"${boolAttr(a.is_featured)} /> Homepage hero</label>
    </div>
    <div class="form-group">
      <label for="article-trending" class="form-label"><input id="article-trending" name="is_trending" type="checkbox" value="1"${boolAttr(a.is_trending)} /> Trending</label>
    </div>
  </div>`;
}

function renderArticleForm(article: ArticleFormValues | null, sites: ReadonlyArray<SiteOption>, categories: ReadonlyArray<CategoryOption>, branding: ArticlesBranding = {}): string {
  const isEdit = article !== null && typeof article.id === "string" && article.id.length > 0;
  const a: ArticleFormValues = article ?? {};
  const formMode = isEdit ? "edit" : "new";
  const articleId = escapeHtml(a.id ?? "");
  const titleVal = escapeHtml(a.title ?? "");
  const slugVal = escapeHtml(a.slug ?? "");
  const excerptVal = escapeHtml(a.excerpt ?? "");
  const subtitleVal = escapeHtml(a.subtitle ?? "");
  const seoTitleVal = escapeHtml(a.seo_title ?? "");
  const seoDescVal = escapeHtml(a.seo_description ?? "");
  const homepageRankVal = a.homepage_rank == null ? "" : String(a.homepage_rank);
  const publishedAtVal = escapeHtml(a.published_at ?? "");
  return `<form id="article-form" class="article-form" data-mode="${formMode}" data-article-id="${articleId}">
  <div class="card">
    <div class="form-group">
      <label for="article-title" class="form-label">Title</label>
      <input id="article-title" name="title" type="text" class="form-input" value="${titleVal}" required />
    </div>
    <div class="form-group">
      <label for="article-slug" class="form-label">Slug</label>
      <input id="article-slug" name="slug" type="text" class="form-input" value="${slugVal}" />
    </div>
    <div class="form-group">
      <label for="article-site" class="form-label">Site</label>
      <select id="article-site" name="site_id" class="form-select" required>
        <option value="">Choose a site…</option>
        ${renderSiteOptions(sites, a.site_id ?? undefined, false)}
      </select>
    </div>
    <div class="form-group">
      <label for="article-category" class="form-label">Category</label>
      <select id="article-category" name="category_id" class="form-select">
        ${renderCategoryOptions(categories, a.category_id, false)}
      </select>
    </div>
    <div class="form-group">
      <label for="article-status" class="form-label">Status</label>
      <select id="article-status" name="status" class="form-select">
        ${renderStatusOptions(a.status, false)}
      </select>
    </div>
    <div class="form-group">
      <label for="article-subtitle" class="form-label">Subtitle (hero teaser)</label>
      <textarea id="article-subtitle" name="subtitle" class="form-textarea" rows="2" maxlength="160" placeholder="One short hook sentence shown under the title in the hero - a tease, not a summary.">${subtitleVal}</textarea>
    </div>
    <div class="form-group">
      <label for="article-excerpt" class="form-label">Excerpt</label>
      <textarea id="article-excerpt" name="excerpt" class="form-textarea" rows="2">${excerptVal}</textarea>
    </div>
    ${renderBlockEditorField(a.content_json)}
  </div>
  ${renderAuthorCard(a, isEdit, branding)}
  <div class="card">
    <div class="card-header"><h3 class="card-title">Homepage placement</h3></div>
    <div class="form-group">
      <label for="article-homepage-rank" class="form-label">Homepage rank</label>
      <input id="article-homepage-rank" name="homepage_rank" type="number" min="0" step="1" class="form-input" value="${escapeHtml(homepageRankVal)}" />
    </div>
    <div class="form-group">
      <label for="article-published-at" class="form-label">Published at</label>
      <input id="article-published-at" name="published_at" type="text" class="form-input" value="${publishedAtVal}" placeholder="YYYY-MM-DDTHH:MM:SSZ" />
    </div>
  </div>
  ${renderDisplayOptions(a)}
  <div class="card">
    <div class="card-header"><h3 class="card-title">SEO</h3></div>
    <div class="form-group">
      <label for="article-seo-title" class="form-label">SEO title</label>
      <input id="article-seo-title" name="seo_title" type="text" class="form-input" value="${seoTitleVal}" />
    </div>
    <div class="form-group">
      <label for="article-seo-description" class="form-label">SEO description</label>
      <textarea id="article-seo-description" name="seo_description" class="form-textarea" rows="3">${seoDescVal}</textarea>
    </div>
  </div>
  ${renderHeroImageCard(a.featured_image_id, a.featured_image_url)}
  ${renderWorkflowPanel(isEdit ? a.id : "", a.status)}
  <p id="article-form-error" class="alert alert-error" hidden role="alert"></p>
  <p id="article-form-status" class="form-status" role="status" aria-live="polite"></p>
  <div class="form-actions">
    <button type="submit" class="btn btn-primary">${isEdit ? "Save changes" : "Create article"}</button>
    <a href="/admin/articles" class="btn btn-secondary">Cancel</a>
  </div>
</form>`;
}

const ARTICLE_FORM_SCRIPT = `
(function(){
  var form = document.getElementById('article-form');
  if (!form) { return; }
  var mode = form.getAttribute('data-mode');
  var articleId = form.getAttribute('data-article-id');
  var errEl = document.getElementById('article-form-error');
  var statusEl = document.getElementById('article-form-status');
  var siteSelect = document.getElementById('article-site');
  function setError(msg) { if (errEl) { errEl.hidden = !msg; errEl.textContent = msg || ''; } }
  function setStatus(msg) {
    if (!statusEl) { return; }
    while (statusEl.firstChild) { statusEl.removeChild(statusEl.firstChild); }
    if (msg) { statusEl.appendChild(document.createTextNode(msg)); }
  }
  function toBool(v) { return v === '1' || v === 'on' || v === true; }
  if (siteSelect) {
    siteSelect.addEventListener('change', function () { setStatus(''); });
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    setError('');
    if (siteSelect && !siteSelect.value) {
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }
      setStatus('Site is required');
      siteSelect.focus();
      return;
    }
    var fd = new FormData(form);
    var body = {
      title: fd.get('title') || '',
      slug: fd.get('slug') || '',
      site_id: fd.get('site_id') || '',
      category_id: fd.get('category_id') || null,
      status: fd.get('status') || 'draft',
      excerpt: fd.get('excerpt') || '',
      subtitle: fd.get('subtitle') || '',
      content_json: fd.get('content_json') || '',
      homepage_rank: fd.get('homepage_rank') ? Number(fd.get('homepage_rank')) : null,
      is_featured: toBool(fd.get('is_featured')) ? 1 : 0,
      is_trending: toBool(fd.get('is_trending')) ? 1 : 0,
      featured_image_id: fd.get('featured_image_id') ? Number(fd.get('featured_image_id')) : null,
      seo_title: fd.get('seo_title') || '',
      seo_description: fd.get('seo_description') || '',
      published_at: fd.get('published_at') || null,
      author_name: fd.get('author_name') || '',
      author_bio: fd.get('author_bio') || ''
    };
    var url = mode === 'edit' ? '/api/admin/articles/' + articleId : '/api/admin/articles';
    var method = mode === 'edit' ? 'PATCH' : 'POST';
    fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin'
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
    }).then(function (res) {
      if (res.ok) {
        window.location.href = '/admin/articles';
      } else {
        setError((res.body && res.body.error) || ('Error: ' + res.status));
      }
    }).catch(function () { setError('Network error'); });
  });
}());
`;

export function articleFormPage(
  article: ArticleFormValues | null,
  sites: ReadonlyArray<SiteOption>,
  categories: ReadonlyArray<CategoryOption>,
  branding: ArticlesBranding = {},
): string {
  const isEdit = article !== null && typeof article.id === "string" && article.id.length > 0;
  const title = isEdit ? "Edit Article" : "New Article";
  const content = renderArticleForm(article, sites, categories, branding) + renderAIAssistantPanel();
  return adminLayout({
    title,
    activePath: "/admin/articles",
    userEmail: branding.userEmail,
    conversionsUiEnabled: branding.conversionsUiEnabled,
    content,
    styles: BLOCK_EDITOR_COLOR_TOKENS + editorStyles + aiAssistantStyles + heroImageStyles + workflowPanelStyles,
    scripts:
      editorScripts +
      blockEditorMountScript("Start writing your article...") +
      ARTICLE_FORM_SCRIPT +
      aiAssistantScripts +
      heroImageScripts +
      workflowPanelScripts,
  });
}
