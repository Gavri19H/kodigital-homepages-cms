// Admin Media templates.
// mediaListPage — Site filter dropdown (All sites / Global only / per-site)
// + Kind filter (image/video/document) + media table with
// preview/filename/site-or-global/kind/size/uploaded/actions columns. Media
// rows whose site_id IS NULL render a "Global" indicator badge in the
// Site column.

import { adminLayout } from "./layout";

export interface SiteOption {
  id: string;
  name?: string;
}

export interface MediaListEntry {
  id?: string;
  filename: string;
  preview_url?: string | null;
  site?: string;
  site_id?: string | null;
  kind?: string;
  size?: number | string | null;
  uploaded_at?: string | null;
}

export interface MediaBranding {
  userEmail?: string;
}

const KIND_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "image", label: "image" },
  { value: "video", label: "video" },
  { value: "document", label: "document" },
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
  const head = `<option value="">All sites</option><option value="__global__">Global only</option>`;
  const opts = sites.map(function (s: SiteOption): string {
    const sel = (selected ?? "") === s.id ? " selected" : "";
    return `<option value="${escapeHtml(s.id)}"${sel}>${escapeHtml(s.name ?? s.id)}</option>`;
  }).join("");
  return head + opts;
}

function renderKindOptions(): string {
  const head = `<option value="">All kinds</option>`;
  const opts = KIND_OPTIONS.map(function (k): string {
    return `<option value="${escapeHtml(k.value)}">${escapeHtml(k.label)}</option>`;
  }).join("");
  return head + opts;
}

function renderToolbar(sites: ReadonlyArray<SiteOption>): string {
  return `<div class="toolbar">
  <div class="toolbar-search"><input type="search" name="search" class="form-input" placeholder="Search media..." /></div>
  <div class="toolbar-filters">
    <select id="filter-site" name="site_id" class="form-select" data-filter="site" aria-label="Site filter">
      ${renderSiteOptions(sites, "")}
    </select>
    <select id="filter-kind" name="kind" class="form-select" data-filter="kind" aria-label="Kind filter">
      ${renderKindOptions()}
    </select>
  </div>
  <a href="/admin/media/new" class="btn btn-primary">Upload media</a>
</div>`;
}

function renderPreview(m: MediaListEntry): string {
  const url = m.preview_url ?? "";
  if (!url) { return `<span class="media-preview-placeholder" aria-hidden="true">·</span>`; }
  return `<img src="${escapeHtml(url)}" alt="${escapeHtml(m.filename)}" loading="lazy" width="64" height="64" class="media-preview" />`;
}

function renderMediaRow(m: MediaListEntry): string {
  const id = escapeHtml(m.id ?? "");
  const filename = escapeHtml(m.filename);
  const hasSite = m.site_id != null && m.site_id !== "";
  const siteCell = hasSite
    ? escapeHtml(m.site ?? m.site_id ?? "")
    : `<span class="badge global-template" data-global="true">Global</span>`;
  const kind = escapeHtml(m.kind ?? "");
  const size = escapeHtml(m.size ?? "");
  const uploaded = escapeHtml(m.uploaded_at ?? "");
  const editHref = id ? `/admin/media/${id}/edit` : "/admin/media";
  return `<tr data-media-id="${id}">
  <td>${renderPreview(m)}</td>
  <td>${filename}</td>
  <td>${siteCell}</td>
  <td>${kind}</td>
  <td>${size}</td>
  <td>${uploaded}</td>
  <td><a href="${editHref}" class="btn btn-sm btn-secondary">Edit</a></td>
</tr>`;
}

function renderMediaTable(items: ReadonlyArray<MediaListEntry>): string {
  const rows = items.length === 0
    ? `<tr><td colspan="7" class="empty-state">No media yet</td></tr>`
    : items.map(renderMediaRow).join("");
  return `<div class="card">
  <div class="table-wrapper">
    <table class="table media-list" aria-label="Media list">
      <thead><tr>
        <th scope="col">Preview</th>
        <th scope="col">Filename</th>
        <th scope="col">Site</th>
        <th scope="col">Kind</th>
        <th scope="col">Size</th>
        <th scope="col">Uploaded</th>
        <th scope="col">Actions</th>
      </tr></thead>
      <tbody id="media-list-body" data-empty="No media yet">${rows}</tbody>
    </table>
  </div>
</div>`;
}

export function mediaListPage(
  items: ReadonlyArray<MediaListEntry>,
  sites: ReadonlyArray<SiteOption>,
  branding: MediaBranding = {},
): string {
  const content = `${renderToolbar(sites)}${renderMediaTable(items)}`;
  return adminLayout({
    title: "Media",
    activePath: "/admin/media",
    userEmail: branding.userEmail,
    content,
  });
}
