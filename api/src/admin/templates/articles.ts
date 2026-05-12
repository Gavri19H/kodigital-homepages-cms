// Admin Articles templates.
// articlesListPage  — 8-column table + 8 filter controls + toolbar New button.
// articleFormPage  — site-required form with homepage fields + SEO fields.
// New-mode submits POST /api/admin/articles; edit-mode submits PATCH
// /api/admin/articles/:id. Form posts JSON via fetch().

import { adminLayout } from "./layout";

export interface SiteOption {
  id: string;
  name?: string;
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
  site_id?: string;
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
  site_id?: string;
  category_id?: string;
  status?: string;
  excerpt?: string;
  content_json?: string;
  content_html?: string;
  homepage_section?: string | null;
  homepage_rank?: number | null;
  is_featured?: boolean | number;
  is_trending?: boolean | number;
  seo_title?: string;
  seo_description?: string;
  published_at?: string | null;
}

export interface ArticlesBranding {
  userEmail?: string;
}

const HOMEPAGE_SECTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "— None —" },
  { value: "hero", label: "Hero" },
  { value: "featured", label: "Featured" },
  { value: "trending", label: "Trending" },
  { value: "secondary", label: "Secondary" },
];

const STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
];

function escapeHtml(input: string | number | undefined | null): string {
  if (input === undefined || input === null) { return ""; }
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function selectedAttr(a: string | undefined, b: string): string {
  return a === b ? " selected" : "";
}

function renderSiteOptions(sites: ReadonlyArray<SiteOption>, selected?: string, includeBlank?: boolean): string {
  const blank = includeBlank ? `<option value="">All sites</option>` : "";
  const opts = sites.map((s) => {
    const value = escapeHtml(s.id);
    const label = escapeHtml(s.name ?? s.id);
    return `<option value="${value}"${selectedAttr(selected, s.id)}>${label}</option>`;
  }).join("");
  return blank + opts;
}

function renderVerticalOptions(verticals: ReadonlyArray<VerticalOption>): string {
  const blank = `<option value="">All verticals</option>`;
  const opts = verticals.map((v) => {
    return `<option value="${escapeHtml(v.slug)}">${escapeHtml(v.label ?? v.slug)}</option>`;
  }).join("");
  return blank + opts;
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

function renderHomepageSectionOptions(selected?: string | null): string {
  return HOMEPAGE_SECTIONS.map((s) => {
    const sel = (selected ?? "") === s.value ? " selected" : "";
    return `<option value="${s.value}"${sel}>${escapeHtml(s.label)}</option>`;
  }).join("");
}

function renderToolbar(sites: ReadonlyArray<SiteOption>, verticals: ReadonlyArray<VerticalOption>, categories: ReadonlyArray<CategoryOption>): string {
  return `<div class="toolbar">
  <div class="toolbar-search"><input type="search" name="search" class="form-input" placeholder="Search articles..." /></div>
  <div class="toolbar-filters">
    <select name="site" class="form-select" aria-label="Site filter">${renderSiteOptions(sites, undefined, true)}</select>
    <select name="vertical" class="form-select" aria-label="Vertical filter">${renderVerticalOptions(verticals)}</select>
    <select name="category" class="form-select" aria-label="Category filter">${renderCategoryOptions(categories, undefined, true)}</select>
    <select name="status" class="form-select" aria-label="Status filter">${renderStatusOptions(undefined, true)}</select>
    <select name="featured" class="form-select" aria-label="Featured filter"><option value="">Any featured</option><option value="1">Featured only</option><option value="0">Not featured</option></select>
    <select name="trending" class="form-select" aria-label="Trending filter"><option value="">Any trending</option><option value="1">Trending only</option><option value="0">Not trending</option></select>
    <select name="published" class="form-select" aria-label="Published filter"><option value="">Any published</option><option value="1">Has published_at</option><option value="0">No published_at</option></select>
  </div>
  <a href="/admin/articles/new" class="btn btn-primary">+ New Article</a>
</div>`;
}

function renderArticleRow(a: ArticleListEntry): string {
  const id = escapeHtml(a.id ?? "");
  const title = escapeHtml(a.title);
  const site = escapeHtml(a.site ?? a.site_id ?? "");
  const category = escapeHtml(a.category ?? "");
  const status = escapeHtml(a.status ?? "draft");
  const homepage = escapeHtml(a.homepage_section ?? "");
  const published = escapeHtml(a.published_at ?? "");
  const updated = escapeHtml(a.updated_at ?? "");
  const editHref = id ? `/admin/articles/${id}/edit` : "/admin/articles";
  return `<tr data-article-id="${id}">
  <td>${title}</td>
  <td>${site}</td>
  <td>${category}</td>
  <td><span class="badge">${status}</span></td>
  <td>${homepage}</td>
  <td>${published}</td>
  <td>${updated}</td>
  <td><a href="${editHref}" class="btn btn-sm btn-secondary">Edit</a></td>
</tr>`;
}

function renderArticlesTable(articles: ReadonlyArray<ArticleListEntry>): string {
  const rows = articles.length === 0
    ? `<tr><td colspan="8" class="empty-state">No articles yet</td></tr>`
    : articles.map(renderArticleRow).join("");
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

export function articlesListPage(
  articles: ReadonlyArray<ArticleListEntry>,
  sites: ReadonlyArray<SiteOption>,
  verticals: ReadonlyArray<VerticalOption>,
  categories: ReadonlyArray<CategoryOption>,
  branding: ArticlesBranding = {},
): string {
  const content = `${renderToolbar(sites, verticals, categories)}${renderArticlesTable(articles)}`;
  return adminLayout({
    title: "Articles",
    activePath: "/admin/articles",
    userEmail: branding.userEmail,
    content,
  });
}

function boolAttr(v: boolean | number | undefined): string {
  return v ? " checked" : "";
}

function renderArticleForm(article: ArticleFormValues | null, sites: ReadonlyArray<SiteOption>, categories: ReadonlyArray<CategoryOption>): string {
  const isEdit = article !== null && typeof article.id === "string" && article.id.length > 0;
  const a: ArticleFormValues = article ?? {};
  const formMode = isEdit ? "edit" : "new";
  const articleId = escapeHtml(a.id ?? "");
  const titleVal = escapeHtml(a.title ?? "");
  const slugVal = escapeHtml(a.slug ?? "");
  const excerptVal = escapeHtml(a.excerpt ?? "");
  const contentJsonVal = escapeHtml(a.content_json ?? "");
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
        ${renderSiteOptions(sites, a.site_id, false)}
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
      <label for="article-excerpt" class="form-label">Excerpt</label>
      <textarea id="article-excerpt" name="excerpt" class="form-textarea" rows="2">${excerptVal}</textarea>
    </div>
    <div class="form-group">
      <label for="article-content" class="form-label">Content (block JSON)</label>
      <textarea id="article-content" name="content_json" class="form-textarea" rows="8">${contentJsonVal}</textarea>
    </div>
  </div>
  <div class="card">
    <div class="card-header"><h3 class="card-title">Homepage placement</h3></div>
    <div class="form-group">
      <label for="article-homepage-section" class="form-label">Homepage section</label>
      <select id="article-homepage-section" name="homepage_section" class="form-select">
        ${renderHomepageSectionOptions(a.homepage_section)}
      </select>
    </div>
    <div class="form-group">
      <label for="article-homepage-rank" class="form-label">Homepage rank</label>
      <input id="article-homepage-rank" name="homepage_rank" type="number" min="0" step="1" class="form-input" value="${escapeHtml(homepageRankVal)}" />
    </div>
    <div class="form-group">
      <label for="article-featured" class="form-label"><input id="article-featured" name="is_featured" type="checkbox" value="1"${boolAttr(a.is_featured)} /> Featured</label>
    </div>
    <div class="form-group">
      <label for="article-trending" class="form-label"><input id="article-trending" name="is_trending" type="checkbox" value="1"${boolAttr(a.is_trending)} /> Trending</label>
    </div>
    <div class="form-group">
      <label for="article-published-at" class="form-label">Published at</label>
      <input id="article-published-at" name="published_at" type="text" class="form-input" value="${publishedAtVal}" placeholder="YYYY-MM-DDTHH:MM:SSZ" />
    </div>
  </div>
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
  <p id="article-form-error" class="alert alert-error" hidden role="alert"></p>
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
  function setError(msg) { if (errEl) { errEl.hidden = !msg; errEl.textContent = msg || ''; } }
  function toBool(v) { return v === '1' || v === 'on' || v === true; }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    setError('');
    var fd = new FormData(form);
    var body = {
      title: fd.get('title') || '',
      slug: fd.get('slug') || '',
      site_id: fd.get('site_id') || '',
      category_id: fd.get('category_id') || null,
      status: fd.get('status') || 'draft',
      excerpt: fd.get('excerpt') || '',
      content_json: fd.get('content_json') || '',
      homepage_section: fd.get('homepage_section') || null,
      homepage_rank: fd.get('homepage_rank') ? Number(fd.get('homepage_rank')) : null,
      is_featured: toBool(fd.get('is_featured')) ? 1 : 0,
      is_trending: toBool(fd.get('is_trending')) ? 1 : 0,
      seo_title: fd.get('seo_title') || '',
      seo_description: fd.get('seo_description') || '',
      published_at: fd.get('published_at') || null
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
  const content = renderArticleForm(article, sites, categories);
  return adminLayout({
    title,
    activePath: "/admin/articles",
    userEmail: branding.userEmail,
    content,
    scripts: ARTICLE_FORM_SCRIPT,
  });
}
