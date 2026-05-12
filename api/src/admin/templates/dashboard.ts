// Admin dashboard template.
// Renders 7-card stats-grid + Recent Articles card + Quick Actions card,
// wrapped in adminLayout. Quick Actions includes a + New Site link to
// /admin/domains.

import { adminLayout } from "./layout";

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

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderStatsGrid(stats: DashboardStats): string {
  const cards = STAT_ENTRIES.map((entry) => {
    const value = stats[entry.key] ?? 0;
    return `<div class="stat-card"><div class="stat-label">${escapeHtml(entry.label)}</div><div class="stat-value">${value}</div></div>`;
  }).join("");
  return `<div class="stats-grid">${cards}</div>`;
}

function renderRecentArticlesCard(recent: RecentArticle[]): string {
  const rows = recent.length === 0
    ? `<tr><td colspan="4" class="empty-state">No articles yet</td></tr>`
    : recent.map((article) => {
        const title = escapeHtml(article.title);
        const site = escapeHtml(article.site ?? "");
        const status = escapeHtml(article.status);
        const updated = escapeHtml(article.updatedAt ?? "");
        return `<tr><td>${title}</td><td>${site}</td><td><span class="badge">${status}</span></td><td>${updated}</td></tr>`;
      }).join("");
  return `<div class="card">
  <div class="card-header"><h3 class="card-title">Recent Articles</h3><a href="/admin/articles" class="btn btn-secondary btn-sm">View all</a></div>
  <div class="table-wrapper">
    <table class="table">
      <thead><tr><th>Title</th><th>Site</th><th>Status</th><th>Updated</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>`;
}

function renderQuickActionsCard(): string {
  return `<div class="card">
  <div class="card-header"><h3 class="card-title">Quick Actions</h3></div>
  <div class="quick-actions">
    <a href="/admin/domains" class="btn btn-primary">+ New Site</a>
    <a href="/admin/articles/new" class="btn btn-secondary">New Article</a>
    <a href="/admin/pages/new" class="btn btn-secondary">New Page</a>
    <a href="/admin/media" class="btn btn-secondary">Upload Media</a>
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
