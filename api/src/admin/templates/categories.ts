// Admin Categories templates.
// categoriesListPage — Site filter + Vertical multi-select toolbar; categories
// table with name/slug/verticals/article-count/actions columns. Verticals
// reflect the canonical 8 slugs (home/finance/travel/health/parenting/food/
// tech/lifestyle) seeded by migration 0004 / T8. Multi-select allows a
// single category to belong to multiple verticals (e.g. "Healthy Meals" =>
// health + food + parenting), persisted via the category_verticals join.

import { adminLayout } from "./layout";

export interface SiteOption {
  id: string;
  name?: string;
}

export interface CategoryListEntry {
  id?: string;
  name: string;
  slug?: string;
  verticals?: ReadonlyArray<string>;
  article_count?: number;
  site?: string;
  site_id?: string | null;
}

export interface CategoriesBranding {
  userEmail?: string;
}

const VERTICAL_SLUGS: ReadonlyArray<string> = [
  "home",
  "finance",
  "travel",
  "health",
  "parenting",
  "food",
  "tech",
  "lifestyle",
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

function renderSiteOptions(sites: ReadonlyArray<SiteOption>, selected?: string | null): string {
  const blank = `<option value="">All sites</option><option value="__global__">Global only</option>`;
  const opts = sites.map(function (s: SiteOption): string {
    const sel = (selected ?? "") === s.id ? " selected" : "";
    return `<option value="${escapeHtml(s.id)}"${sel}>${escapeHtml(s.name ?? s.id)}</option>`;
  }).join("");
  return blank + opts;
}

function renderVerticalsToolbarOptions(): string {
  return VERTICAL_SLUGS.map(function (v: string): string {
    return `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`;
  }).join("");
}

function renderCategoryRow(c: CategoryListEntry): string {
  const id = escapeHtml(c.id ?? "");
  const name = escapeHtml(c.name);
  const slug = escapeHtml(c.slug ?? "");
  const verticals = (c.verticals ?? []).map(escapeHtml).join(", ");
  const count = escapeHtml(c.article_count ?? 0);
  const editHref = id ? `/admin/categories/${id}/edit` : "/admin/categories";
  return `<tr data-category-id="${id}">
  <td>${name}</td>
  <td>${slug}</td>
  <td>${verticals}</td>
  <td>${count}</td>
  <td><a href="${editHref}" class="btn btn-sm btn-secondary">Edit</a></td>
</tr>`;
}

function renderCategoriesTable(categories: ReadonlyArray<CategoryListEntry>): string {
  const rows = categories.length === 0
    ? `<tr><td colspan="5" class="empty-state">No categories yet</td></tr>`
    : categories.map(renderCategoryRow).join("");
  return `<div class="card">
  <div class="table-wrapper">
    <table class="table categories-list" aria-label="Categories list">
      <thead><tr>
        <th scope="col">Name</th>
        <th scope="col">Slug</th>
        <th scope="col">Verticals</th>
        <th scope="col">Articles</th>
        <th scope="col">Actions</th>
      </tr></thead>
      <tbody id="categories-list-body" data-empty="No categories yet">${rows}</tbody>
    </table>
  </div>
</div>`;
}

function renderToolbar(sites: ReadonlyArray<SiteOption>): string {
  return `<div class="toolbar">
  <div class="toolbar-search"><input type="search" name="search" class="form-input" placeholder="Search categories..." /></div>
  <div class="toolbar-filters">
    <select id="filter-site" name="site" class="form-select" data-filter="site" aria-label="Site filter">
      ${renderSiteOptions(sites, "")}
    </select>
    <select id="filter-verticals" name="verticals" class="form-select" multiple data-multi="true" data-field="verticals" size="3" aria-label="Verticals (select multiple)">
      ${renderVerticalsToolbarOptions()}
    </select>
  </div>
  <a href="/admin/categories/new" class="btn btn-primary">+ New Category</a>
</div>`;
}

export function categoriesListPage(
  categories: ReadonlyArray<CategoryListEntry>,
  sites: ReadonlyArray<SiteOption>,
  branding: CategoriesBranding = {},
): string {
  const content = `${renderToolbar(sites)}${renderCategoriesTable(categories)}`;
  return adminLayout({
    title: "Categories",
    activePath: "/admin/categories",
    userEmail: branding.userEmail,
    content,
  });
}
