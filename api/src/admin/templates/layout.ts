// Admin UI shell template.
// Brand: KoDigital CMS only. 9-entry sidebar nav: Dashboard, Domains, Articles,
// Pages, Media, Categories, Tags, AI Presets, Settings.

export interface AdminLayoutOptions {
  title: string;
  activePath?: string;
  userEmail?: string;
  content: string;
  scripts?: string;
  styles?: string;
}

interface NavEntry {
  href: string;
  label: string;
}

const NAV_ENTRIES: ReadonlyArray<NavEntry> = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/domains", label: "Domains" },
  { href: "/admin/articles", label: "Articles" },
  { href: "/admin/pages", label: "Pages" },
  { href: "/admin/media", label: "Media" },
  { href: "/admin/categories", label: "Categories" },
  { href: "/admin/tags", label: "Tags" },
  { href: "/admin/presets", label: "AI Presets" },
  { href: "/admin/settings", label: "Settings" },
];

const BRAND_TEXT = "KoDigital CMS";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isActive(activePath: string | undefined, href: string): boolean {
  if (!activePath) { return false; }
  if (activePath === href) { return true; }
  if (href !== "/admin" && activePath.startsWith(href + "/")) { return true; }
  return false;
}

function renderSidebar(activePath: string | undefined): string {
  const items = NAV_ENTRIES.map((item) => {
    const active = isActive(activePath, item.href);
    const cls = active ? "nav-item active" : "nav-item";
    return `<li><a href="${item.href}" class="${cls}"><span>${escapeHtml(item.label)}</span></a></li>`;
  }).join("");
  return `<aside class="admin-sidebar" id="sidebar">
  <div class="sidebar-header">
    <a href="/admin" class="logo"><span class="logo-text">${escapeHtml(BRAND_TEXT)}</span></a>
  </div>
  <nav class="sidebar-nav" aria-label="Admin sections"><ul>${items}</ul></nav>
  <div class="sidebar-footer"><a href="/" class="nav-item" target="_blank" rel="noopener">View Site</a></div>
</aside>`;
}

export function adminLayout(options: AdminLayoutOptions): string {
  const { title, activePath, userEmail, content, scripts = "", styles = "" } = options;
  const safeTitle = escapeHtml(title);
  const userBlock = userEmail
    ? `<span class="user-email">${escapeHtml(userEmail)}</span>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex,nofollow">
  <title>${safeTitle} | ${escapeHtml(BRAND_TEXT)}</title>
  <style>${ADMIN_STYLES}${styles}</style>
</head>
<body data-area="admin">
  <p data-marker="kodigital-admin-shell" hidden>shell</p>
  <div class="admin-layout">
    ${renderSidebar(activePath)}
    <main class="admin-main">
      <header class="admin-header">
        <h1 class="page-title">${safeTitle}</h1>
        <div class="header-actions">${userBlock}</div>
      </header>
      <div class="admin-content">${content}</div>
    </main>
  </div>
  <script>${ADMIN_SCRIPTS}${scripts}</script>
</body>
</html>`;
}

const ADMIN_STYLES = `
*{margin:0;padding:0;box-sizing:border-box}
:root{--c-primary:#2563eb;--c-primary-dark:#1d4ed8;--c-primary-light:#dbeafe;--c-bg:#fff;--c-bg-alt:#f9fafb;--c-bg-dark:#f3f4f6;--c-text:#111827;--c-muted:#6b7280;--c-border:#e5e7eb;--c-success:#10b981;--c-warning:#f59e0b;--c-error:#ef4444;--sidebar-w:250px;--header-h:60px}
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.5;color:var(--c-text);background:var(--c-bg-alt)}
a{color:var(--c-primary);text-decoration:none}
a:hover{text-decoration:underline}
html,body{height:100%;overflow-x:hidden}
.admin-layout{display:flex;min-height:100vh;position:relative}
.admin-sidebar{width:var(--sidebar-w);background:var(--c-bg);border-right:1px solid var(--c-border);display:flex;flex-direction:column;position:fixed;top:0;left:0;height:100vh;z-index:100;overflow-y:auto}
.sidebar-header{padding:16px;border-bottom:1px solid var(--c-border)}
.logo{display:flex;align-items:center;gap:12px;color:var(--c-text);font-weight:600;font-size:18px}
.logo:hover{text-decoration:none}
.logo-text{font-weight:600}
.sidebar-nav{flex:1;padding:16px 0;overflow-y:auto}
.sidebar-nav ul{list-style:none}
.nav-item{display:flex;align-items:center;gap:12px;padding:10px 16px;color:var(--c-muted);text-decoration:none}
.nav-item:hover{background:var(--c-bg-alt);color:var(--c-text);text-decoration:none}
.nav-item.active{background:var(--c-primary-light);color:var(--c-primary);font-weight:500}
.sidebar-footer{padding:16px 0;border-top:1px solid var(--c-border)}
.admin-main{flex:1;margin-left:var(--sidebar-w);min-height:100vh;display:flex;flex-direction:column}
.admin-header{height:var(--header-h);background:var(--c-bg);border-bottom:1px solid var(--c-border);display:flex;align-items:center;padding:0 24px;gap:16px;position:sticky;top:0;z-index:50}
.page-title{font-size:18px;font-weight:600;flex:1}
.header-actions{display:flex;align-items:center;gap:16px}
.user-email{color:var(--c-muted);font-size:13px}
.admin-content{flex:1;padding:24px;min-width:0;padding-bottom:100px}
.card{background:var(--c-bg);border:1px solid var(--c-border);border-radius:8px;padding:24px;margin-bottom:24px}
.card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.card-title{font-size:16px;font-weight:600}
.btn{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;font-size:14px;font-weight:500;border-radius:6px;border:1px solid transparent;cursor:pointer;text-decoration:none}
.btn:hover{text-decoration:none}
.btn-primary{background:var(--c-primary);color:#fff}
.btn-primary:hover{background:var(--c-primary-dark)}
.btn-secondary{background:var(--c-bg);border-color:var(--c-border);color:var(--c-text)}
.btn-secondary:hover{background:var(--c-bg-alt)}
.btn-danger{background:var(--c-error);color:#fff}
.btn-danger:hover{background:#dc2626}
.btn-sm{padding:4px 12px;font-size:13px}
.form-group{margin-bottom:16px}
.form-label{display:block;font-weight:500;margin-bottom:6px;color:var(--c-text)}
.form-input,.form-select,.form-textarea{width:100%;padding:8px 12px;font-size:14px;border:1px solid var(--c-border);border-radius:6px;background:var(--c-bg);color:var(--c-text)}
.form-input:focus,.form-select:focus,.form-textarea:focus{outline:none;border-color:var(--c-primary);box-shadow:0 0 0 3px var(--c-primary-light)}
.table-wrapper{overflow-x:auto}
.table{width:100%;border-collapse:collapse}
.table th,.table td{padding:12px 16px;text-align:left;border-bottom:1px solid var(--c-border)}
.table th{font-weight:600;background:var(--c-bg-alt);white-space:nowrap}
.badge{display:inline-flex;align-items:center;padding:2px 8px;font-size:12px;font-weight:500;border-radius:9999px}
.empty-state{text-align:center;padding:48px 24px;color:var(--c-muted)}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
.stat-card{background:var(--c-bg);border:1px solid var(--c-border);border-radius:8px;padding:20px}
.stat-label{font-size:13px;color:var(--c-muted);margin-bottom:4px}
.stat-value{font-size:28px;font-weight:600;color:var(--c-text)}
.toolbar{display:flex;gap:12px;align-items:center;margin-bottom:16px;flex-wrap:wrap}
.toolbar-search{flex:1;min-width:200px;max-width:300px}
.toolbar-filters{display:flex;gap:8px}
.alert{padding:12px 16px;border-radius:6px;margin-bottom:16px}
.alert-success{background:#d1fae5;color:#065f46;border:1px solid #a7f3d0}
.alert-error{background:#fee2e2;color:#991b1b;border:1px solid #fecaca}
.alert-warning{background:#fef3c7;color:#92400e;border:1px solid #fde68a}
@media (max-width:768px){.admin-sidebar{transform:translateX(-100%)}.admin-sidebar.open{transform:translateX(0)}.admin-main{margin-left:0}.admin-content{padding:16px}.stats-grid{grid-template-columns:1fr 1fr}}
`;

const ADMIN_SCRIPTS = `
(function(){
  function toggleSidebar(){var s=document.getElementById('sidebar');if(s){s.classList.toggle('open');}}
  window.toggleSidebar=toggleSidebar;
}());
`;
