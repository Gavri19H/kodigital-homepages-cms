// Admin dashboard template — legacy admin port (theiwise-legacy-readonly
// api/src/admin/templates/dashboard.ts) adapted for multi-site:
// the 7-card stats-grid (Sites card retained), Recent Articles table with
// the extra Site column, and Quick Actions with the multi-site "+ New Site"
// entry ahead of the legacy action set. Wrapped in adminLayout.

import { adminLayout } from "./layout";
import { escapeHtml } from "../types";

export interface DashboardStats {
  sites: number;
  totalArticles: number;
  published: number;
  drafts: number;
  pages: number;
  mediaFiles: number;
  categories: number;
}

export interface RecentArticle {
  id?: string;
  title: string;
  site?: string;
  status: string;
  updatedAt?: string;
}

export interface DashboardBranding {
  userEmail?: string;
}

interface StatEntry {
  key: keyof DashboardStats;
  label: string;
}

const STAT_ENTRIES: ReadonlyArray<StatEntry> = [
  { key: "sites", label: "Sites" },
  { key: "totalArticles", label: "Total Articles" },
  { key: "published", label: "Published" },
  { key: "drafts", label: "Drafts" },
  { key: "pages", label: "Pages" },
  { key: "mediaFiles", label: "Media Files" },
  { key: "categories", label: "Categories" },
];

function renderStatsGrid(stats: DashboardStats): string {
  const cards = STAT_ENTRIES.map((entry) => {
    const value = stats[entry.key] ?? 0;
    return `<div class="stat-card"><div class="stat-label">${escapeHtml(entry.label)}</div><div class="stat-value">${value}</div></div>`;
  }).join("");
  return `<div class="stats-grid">${cards}</div>`;
}

function renderArticleRow(article: RecentArticle): string {
  const title = escapeHtml(article.title);
  const site = escapeHtml(article.site ?? "");
  const status = escapeHtml(article.status);
  const updated = escapeHtml(article.updatedAt ?? "");
  const editHref = article.id !== undefined
    ? `/admin/articles/${encodeURIComponent(article.id)}`
    : null;
  const titleCell = editHref !== null
    ? `<a href="${editHref}">${title}</a>`
    : title;
  const actionsCell = editHref !== null
    ? `<a href="${editHref}" class="btn btn-secondary btn-sm">Edit</a>`
    : "";
  return `<tr><td>${titleCell}</td><td>${site}</td><td><span class="badge badge-${status}">${status}</span></td><td>${updated}</td><td class="table-actions">${actionsCell}</td></tr>`;
}

function renderRecentArticlesCard(recent: RecentArticle[]): string {
  const body = recent.length === 0
    ? `<div class="empty-state">
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <line x1="16" y1="13" x2="8" y2="13"></line>
      <line x1="16" y1="17" x2="8" y2="17"></line>
    </svg>
    <p>No articles yet</p>
    <a href="/admin/articles/new" class="btn btn-primary">Create Your First Article</a>
  </div>`
    : `<div class="table-wrapper">
    <table class="table">
      <thead><tr><th>Title</th><th>Site</th><th>Status</th><th>Last Updated</th><th>Actions</th></tr></thead>
      <tbody>${recent.map(renderArticleRow).join("")}</tbody>
    </table>
  </div>
  <div style="padding: 16px 0;">
    <a href="/admin/articles" class="btn btn-secondary">View All Articles</a>
  </div>`;
  return `<div class="card">
  <div class="card-header"><h2 class="card-title">Recent Articles</h2><a href="/admin/articles/new" class="btn btn-primary btn-sm">+ New Article</a></div>
  ${body}
</div>`;
}

function renderQuickActionsCard(): string {
  return `<div class="card">
  <div class="card-header"><h2 class="card-title">Quick Actions</h2></div>
  <div class="quick-actions">
    <a href="/admin/domains" class="btn btn-primary">+ New Site</a>
    <a href="/admin/articles/new" class="btn btn-secondary">+ New Article</a>
    <a href="/admin/pages/new" class="btn btn-secondary">+ New Page</a>
    <a href="/admin/media" class="btn btn-secondary">Upload Media</a>
    <a href="/admin/settings" class="btn btn-secondary">Settings</a>
  </div>
</div>`;
}

export function dashboardPage(
  stats: DashboardStats,
  recentArticles: RecentArticle[],
  branding: DashboardBranding = {},
): string {
  const content = `${renderStatsGrid(stats)}${renderRecentArticlesCard(recentArticles)}${renderQuickActionsCard()}`;
  return adminLayout({
    title: "Dashboard",
    activePath: "/admin",
    userEmail: branding.userEmail,
    content,
  });
}
