// Admin Tags templates.
// tagsListPage — Site filter dropdown (All sites / Global only / per-site)
// + tags table with name/slug/site-or-global/article-count/actions columns.
// Rows whose site_id IS NULL render a "Global" indicator badge in the Site
// column. GET /api/admin/tags?site_id=<id> returns site tags + globals;
// site_id=__global__ returns NULL-only.

import { adminLayout } from "./layout";

export interface SiteOption {
  id: string;
  name?: string;
}

export interface TagListEntry {
  id?: string;
  name: string;
  slug?: string;
  site?: string;
  site_id?: string | null;
  article_count?: number;
}

export interface TagsBranding {
  userEmail?: string;
}

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
  const head = `<option value="">All sites</option><option value="__global__">Global only</option>`;
  const opts = sites.map(function (s: SiteOption): string {
    const sel = (selected ?? "") === s.id ? " selected" : "";
    return `<option value="${escapeHtml(s.id)}"${sel}>${escapeHtml(s.name ?? s.id)}</option>`;
  }).join("");
  return head + opts;
}

function renderToolbar(sites: ReadonlyArray<SiteOption>): string {
  return `<div class="toolbar">
  <div class="toolbar-search"><input type="search" name="search" class="form-input" placeholder="Search tags..." /></div>
  <div class="toolbar-filters">
    <select id="filter-site" name="site" class="form-select" data-filter="site" aria-label="Site filter">
      ${renderSiteOptions(sites, "")}
    </select>
  </div>
  <a href="/admin/tags/new" class="btn btn-primary">+ New Tag</a>
</div>`;
}

function renderTagRow(t: TagListEntry): string {
  const id = escapeHtml(t.id ?? "");
  const name = escapeHtml(t.name);
  const slug = escapeHtml(t.slug ?? "");
  const hasSite = t.site_id != null && t.site_id !== "";
  const siteCell = hasSite
    ? escapeHtml(t.site ?? t.site_id ?? "")
    : `<span class="badge global-template" data-global="true">Global</span>`;
  const count = escapeHtml(t.article_count ?? 0);
  const editHref = id ? `/admin/tags/${id}/edit` : "/admin/tags";
  return `<tr data-tag-id="${id}">
  <td>${name}</td>
  <td>${slug}</td>
  <td>${siteCell}</td>
  <td>${count}</td>
  <td><a href="${editHref}" class="btn btn-sm btn-secondary">Edit</a></td>
</tr>`;
}

function renderTagsTable(tags: ReadonlyArray<TagListEntry>): string {
  const rows = tags.length === 0
    ? `<tr><td colspan="5" class="empty-state">No tags yet</td></tr>`
    : tags.map(renderTagRow).join("");
  return `<div class="card">
  <div class="table-wrapper">
    <table class="table tags-list" aria-label="Tags list">
      <thead><tr>
        <th scope="col">Name</th>
        <th scope="col">Slug</th>
        <th scope="col">Site</th>
        <th scope="col">Articles</th>
        <th scope="col">Actions</th>
      </tr></thead>
      <tbody id="tags-list-body" data-empty="No tags yet">${rows}</tbody>
    </table>
  </div>
</div>`;
}

export function tagsListPage(
  tags: ReadonlyArray<TagListEntry>,
  sites: ReadonlyArray<SiteOption>,
  branding: TagsBranding = {},
): string {
  const content = `${renderToolbar(sites)}${renderTagsTable(tags)}`;
  return adminLayout({
    title: "Tags",
    activePath: "/admin/tags",
    userEmail: branding.userEmail,
    content,
  });
}
