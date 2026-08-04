// Admin UI shell template — ported from the legacy admin layout
// (theiwise-legacy-readonly api/src/admin/templates/layout.ts), rebranded.
// Brand: KoDigital CMS only. 11-entry sidebar nav: Dashboard, Domains, Articles,
// Pages, Listicles (design contract §4 — inserted right after Pages), LeadGen
// (LeadGen contract 01 §5.1 — right after Listicles), Media, Categories, Tags,
// AI Presets, Settings.
// The inline <script> payload MUST stay ES5 (no arrow/const/let/async) —
// asserted by test/admin-layout-shell.test.ts via script extraction.

export interface AdminLayoutOptions {
  title: string;
  activePath?: string;
  userEmail?: string;
  content: string;
  scripts?: string;
  styles?: string;
  stylesheets?: ReadonlyArray<string>;
  moduleScripts?: ReadonlyArray<string>;
  conversionsUiEnabled?: boolean;
}

interface NavEntry {
  href: string;
  label: string;
  icon: string;
}

// SVG icons ported from the legacy sidebar (one per nav entry; Domains is
// new — globe icon — since the legacy nav had no Domains entry).
const ICON_DASHBOARD = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`;
const ICON_DOMAINS = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;
const ICON_ARTICLES = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
const ICON_PAGES = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
// Listicles (design contract §4): numbered-list glyph in the same feather
// outline style as the other sidebar icons.
const ICON_LISTICLES = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>`;
// LeadGen (contract 01 §5.1): funnel/filter glyph in the same feather
// outline style as the other sidebar icons.
const ICON_LEADGEN = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>`;
const ICON_CONVERSIONS = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19V9"></path><path d="M10 19V5"></path><path d="M16 19v-7"></path><path d="M22 19V3"></path></svg>`;
const ICON_REPORTING = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"></path><path d="M7 16l4-4 3 3 5-7"></path></svg>`;
const ICON_MEDIA = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`;
const ICON_CATEGORIES = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
const ICON_TAGS = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>`;
const ICON_PRESETS = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"></path><circle cx="8" cy="14" r="1"></circle><circle cx="16" cy="14" r="1"></circle></svg>`;
const ICON_SETTINGS = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;
const ICON_EXTERNAL = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;

const NAV_ENTRIES: ReadonlyArray<NavEntry> = [
  { href: "/admin", label: "Dashboard", icon: ICON_DASHBOARD },
  { href: "/admin/domains", label: "Domains", icon: ICON_DOMAINS },
  { href: "/admin/articles", label: "Articles", icon: ICON_ARTICLES },
  { href: "/admin/pages", label: "Pages", icon: ICON_PAGES },
  { href: "/admin/listicles", label: "Listicles", icon: ICON_LISTICLES },
  { href: "/admin/leadgen", label: "LeadGen", icon: ICON_LEADGEN },
  { href: "/admin/media", label: "Media", icon: ICON_MEDIA },
  { href: "/admin/categories", label: "Categories", icon: ICON_CATEGORIES },
  { href: "/admin/tags", label: "Tags", icon: ICON_TAGS },
  { href: "/admin/presets", label: "AI Presets", icon: ICON_PRESETS },
  { href: "/admin/settings", label: "Settings", icon: ICON_SETTINGS },
];

const BRAND_TEXT = "KoDigital CMS";

const LOGO_BADGE = `<svg width="32" height="32" viewBox="0 0 32 32" fill="currentColor"><rect x="2" y="2" width="28" height="28" rx="4" fill="#2563eb"/><text x="16" y="22" text-anchor="middle" font-size="12" font-weight="bold" fill="white">KD</text></svg>`;

// Shared HTML-escaper for every admin template. T33 de-dup contract:
// this export is the ONLY escapeHtml definition under
// api/src/admin/templates/ — page templates import it from here instead
// of carrying per-file copies.
export function escapeHtml(input: string | number | undefined | null): string {
  if (input === undefined || input === null) { return ""; }
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// T32: shared list pager. Renders a Previous / page-of / Next control under
// a list table when the result set spans more than one page. `query` carries
// the active filter params so paging preserves the current filter state; the
// `page` key is always overwritten with the target page. Uses the
// `.pagination*` classes already defined in ADMIN_STYLES.
export interface ListPagerMeta {
  page: number;
  per_page: number;
  total: number;
}

export function renderListPager(
  meta: ListPagerMeta | undefined,
  query: Record<string, string | undefined> = {},
): string {
  if (!meta) { return ""; }
  const perPage = meta.per_page > 0 ? meta.per_page : 1;
  const totalPages = Math.max(1, Math.ceil(meta.total / perPage));
  if (meta.total <= perPage || totalPages <= 1) { return ""; }
  const page = Math.min(Math.max(1, meta.page), totalPages);
  const urlFor = (target: number): string => {
    const parts: string[] = [];
    for (const key of Object.keys(query)) {
      const value = query[key];
      if (key !== "page" && value !== undefined && value !== "") {
        parts.push(
          encodeURIComponent(key) + "=" + encodeURIComponent(value),
        );
      }
    }
    parts.push("page=" + String(target));
    return "?" + parts.join("&");
  };
  const start = (page - 1) * perPage + 1;
  const end = Math.min(meta.total, page * perPage);
  const prev = page > 1
    ? `<a href="${urlFor(page - 1)}" rel="prev">Previous</a>`
    : `<span class="disabled">Previous</span>`;
  const next = page < totalPages
    ? `<a href="${urlFor(page + 1)}" rel="next">Next</a>`
    : `<span class="disabled">Next</span>`;
  return `<nav class="pagination" aria-label="Pagination">
  <div class="pagination-info">Showing ${start}-${end} of ${meta.total}</div>
  <div class="pagination-links">${prev}<span class="current">Page ${page} of ${totalPages}</span>${next}</div>
</nav>`;
}

// T32: shared list-filter listener (ES5). Generic toolbar wiring for the
// Categories / Tags / Pages lists whose filter controls previously had NO
// listeners: each <select> in .toolbar-filters reloads the page with its
// name=value query param on change, and a bare (non-form) search input
// reloads on Enter. The Articles list keeps its own dedicated script (its
// search lives inside a GET <form>), so this is NOT added there.
export const listFilterScript = `
(function () {
  function applyFilter(name, value) {
    if (!name) { return; }
    var url = new URL(window.location.href);
    if (value) { url.searchParams.set(name, value); } else { url.searchParams.delete(name); }
    url.searchParams.delete('page');
    window.location.href = url.toString();
  }
  var selects = document.querySelectorAll('.toolbar-filters select');
  var i;
  for (i = 0; i < selects.length; i++) {
    selects[i].addEventListener('change', function () {
      applyFilter(this.name, this.value);
    });
  }
  var searchInput = document.querySelector('.toolbar-search input[name="search"]');
  if (searchInput && !searchInput.form) {
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyFilter('search', this.value);
      }
    });
  }
}());
`;

// Round-4 A-2 (row R4-02/R4-38): the SHARED kebab-actions component. The
// offers tab's own kebab (ui-offers.ts, "Edit" link + a &#8942; toggle
// opening Duplicate/Archive/Delete/Usage) is the reference this promotes for
// every OTHER list (sections/quotes/auctions/listicles) — offers keeps its
// own bespoke markup/script UNCHANGED (a working, already-tested
// implementation; nothing here re-binds its `data-offer-kebab-*` attributes,
// so the two can never double-fire on the same element). Consumers open with
// renderKebabOpen(name), append their own <button class="lg-kebab-item" …>
// menu items (each carrying its OWN per-entity data attribute the page's
// existing/extended click-delegation script reads), then close with
// KEBAB_CLOSE. Toggle/outside-click/Escape/one-open-at-a-time behavior is
// kebabMenuScript below — generic `data-kebab*` attributes, so it can never
// collide with offers' `data-offer-kebab-*` listener either.
//
// `data-kebab-target` links the toggle to its menu by a per-render-call
// unique id (kebabSeq below) — kebabMenuScript reparents the menu to <body>
// on open (see its own doc comment), so an ancestor-relative lookup
// (host.querySelector) stops finding it after the first open; the id-link
// survives the move (getElementById/attribute-selector query the whole
// document, not a subtree).
let kebabSeq = 0;
export function renderKebabOpen(name: string): string {
  kebabSeq += 1;
  const menuId = `lg-kebab-menu-${kebabSeq}`;
  return `<div class="lg-kebab" data-kebab><button type="button" class="btn btn-sm btn-outline lg-kebab-btn" data-kebab-toggle data-kebab-target="${menuId}" aria-haspopup="true" aria-expanded="false" aria-label="More actions for ${escapeHtml(name)}">&#8942;</button><div class="lg-kebab-menu" id="${menuId}" data-kebab-menu hidden role="menu">`;
}
export const KEBAB_CLOSE = `</div></div>`;

// The shared kebab toggle/close behavior (ES5 — same inline-script
// constraint as every other layout.ts script export): one menu open at a
// time, closes on outside click / Escape, and exposes window.lgCloseKebabs
// so a page's OWN action script can collapse the menu right after handling
// an item click (Duplicate/Archive/Delete/etc.) without re-implementing the
// open/close bookkeeping itself.
//
// Fix-round finding (P1d): a kebab menu left nested inside .table-wrapper
// loses BOTH ways: (1) CSS Overflow's "mixed overflow" rule computes
// overflow-y to auto the moment overflow-x is set to anything but visible
// (.table-wrapper{overflow-x:auto} — the A-1 fix itself), so a
// position:absolute menu extending past the wrapper's own box gets CLIPPED;
// (2) switching the menu to position:fixed escapes that clip, but NOT the
// STACKING context .admin-main{isolation:isolate} establishes — inside that
// context a later row's own table--sticky-edges last-column cell (the A-1
// sticky-actions-column fix) can still win the paint order against a
// same-context z-index, so the menu visually loses to a LOWER row's cell
// (reproduced live: Playwright's hit-test resolved a menu item's click
// coordinate to the NEXT row's <td>, not the menu). Fix: on open, reparent
// the menu DOM node itself to <body> (a "portal") — this removes it from
// every ancestor's overflow-clip AND stacking context in one step, not just
// from the clip. position:fixed + a live getBoundingClientRect() of the
// toggle then places it correctly regardless of where it re-renders or
// which row it belongs to. Closes on scroll (capture phase, since
// .table-wrapper's own scroll does not bubble to document) so a fixed,
// reparented menu never floats away, stale, from a toggle its wrapper has
// since scrolled out from under it.
export const kebabMenuScript = `
(function () {
  function resetMenuPosition(menu) {
    menu.style.position = '';
    menu.style.top = '';
    menu.style.right = '';
    menu.style.left = '';
  }
  function toggleForMenu(menu) {
    return document.querySelector('[data-kebab-target="' + menu.id + '"]');
  }
  function closeAllKebabMenus() {
    var open = document.querySelectorAll('[data-kebab-menu]:not([hidden])');
    var i, toggle;
    for (i = 0; i < open.length; i++) {
      open[i].hidden = true;
      resetMenuPosition(open[i]);
      toggle = toggleForMenu(open[i]);
      if (toggle) { toggle.setAttribute('aria-expanded', 'false'); }
    }
  }
  window.lgCloseKebabs = closeAllKebabMenus;
  function menuForToggle(toggle) {
    var id = toggle.getAttribute('data-kebab-target');
    return id ? document.getElementById(id) : null;
  }
  function openKebab(toggle, menu) {
    if (menu.parentNode !== document.body) { document.body.appendChild(menu); }
    var r = toggle.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = r.bottom + 'px';
    menu.style.right = (window.innerWidth - r.right) + 'px';
    menu.style.left = 'auto';
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) { return; }
    var toggle = t.closest('[data-kebab-toggle]');
    if (toggle) {
      var menu = menuForToggle(toggle);
      var wasHidden = menu ? menu.hidden : true;
      closeAllKebabMenus();
      if (menu && wasHidden) { openKebab(toggle, menu); }
      return;
    }
    // A click inside an (already reparented-to-<body>) open menu is never
    // an "outside click" even though it is no longer a descendant of
    // [data-kebab] — data-kebab-menu itself still identifies it.
    if (t.closest('[data-kebab-menu]')) { return; }
    if (!t.closest('[data-kebab]')) { closeAllKebabMenus(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' || e.keyCode === 27) { closeAllKebabMenus(); }
  });
  document.addEventListener('scroll', function () { closeAllKebabMenus(); }, true);
}());
`;

function isActive(activePath: string | undefined, href: string): boolean {
  if (!activePath) { return false; }
  if (activePath === href) { return true; }
  if (href !== "/admin" && activePath.startsWith(href + "/")) { return true; }
  return false;
}

function renderSidebar(activePath: string | undefined, conversionsUiEnabled = false): string {
  if (!conversionsUiEnabled) {
    const items = NAV_ENTRIES.map((item) => {
      const active = isActive(activePath, item.href);
      const cls = active ? "nav-item active" : "nav-item";
      return `<li><a href="${item.href}" class="${cls}">${item.icon}<span>${escapeHtml(item.label)}</span></a></li>`;
    }).join("");
    return `<aside class="admin-sidebar" id="sidebar">
  <div class="sidebar-header">
    <a href="/admin" class="logo">${LOGO_BADGE}<span class="logo-text">${escapeHtml(BRAND_TEXT)}</span></a>
  </div>
  <nav class="sidebar-nav" aria-label="Admin sections"><ul>${items}</ul></nav>
  <div class="sidebar-footer"><a href="/" class="nav-item" target="_blank" rel="noopener">${ICON_EXTERNAL}<span>View Site</span></a></div>
</aside>`;
  }
  const renderEntry = (item: NavEntry): string => {
    const active = isActive(activePath, item.href);
    const cls = active ? "nav-item active" : "nav-item";
    return `<li><a href="${item.href}" class="${cls}">${item.icon}<span>${escapeHtml(item.label)}</span></a></li>`;
  };
  const before = NAV_ENTRIES.slice(0, 6).map(renderEntry).join("");
  const after = NAV_ENTRIES.slice(6).map(renderEntry).join("");
  const conversionLinks = [
    { href: "/admin/conversions/flows", label: "Flows" },
    { href: "/admin/conversions/connections", label: "Connections" },
    { href: "/admin/conversions/activity", label: "Activity" },
    { href: "/admin/conversions/controls", label: "Controls" },
  ].map((item) => {
    const active = isActive(activePath, item.href);
    const cls = active ? "nav-item nav-subitem active" : "nav-item nav-subitem";
    const current = active ? ' aria-current="page"' : "";
    return `<li><a href="${item.href}" class="${cls}"${current}><span>${item.label}</span></a></li>`;
  }).join("");
  const reportingActive = isActive(activePath, "/admin/reporting");
  const reportingClass = reportingActive ? "nav-item active" : "nav-item";
  const reportingCurrent = reportingActive ? ' aria-current="page"' : "";
  const items = `${before}<li class="admin-nav-group" data-admin-nav-group="conversions">
    <div class="admin-nav-group-label">${ICON_CONVERSIONS}<span>Conversions</span></div>
    <ul class="admin-nav-sublist">${conversionLinks}</ul>
  </li><li><a href="/admin/reporting" class="${reportingClass}"${reportingCurrent}>${ICON_REPORTING}<span>Reporting</span></a></li>${after}`;
  return `<aside class="admin-sidebar" id="sidebar">
  <div class="sidebar-header">
    <a href="/admin" class="logo">${LOGO_BADGE}<span class="logo-text">${escapeHtml(BRAND_TEXT)}</span></a>
  </div>
  <nav class="sidebar-nav" aria-label="Admin sections"><ul>${items}</ul></nav>
  <div class="sidebar-footer"><a href="/" class="nav-item" target="_blank" rel="noopener">${ICON_EXTERNAL}<span>View Site</span></a></div>
</aside>`;
}

const MOBILE_MENU_BTN = `<button class="mobile-menu-btn" onclick="toggleSidebar()" aria-label="Toggle navigation"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg></button>`;
const CONVERSIONS_MOBILE_MENU_BTN = `<button class="mobile-menu-btn" onclick="toggleSidebar()" aria-label="Toggle navigation" aria-controls="sidebar" aria-expanded="false"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg></button>`;

export function adminLayout(options: AdminLayoutOptions): string {
  const {
    title,
    activePath,
    userEmail,
    content,
    scripts = "",
    styles = "",
    stylesheets = [],
    moduleScripts = [],
    conversionsUiEnabled = false,
  } = options;
  const safeTitle = escapeHtml(title);
  const userBlock = userEmail
    ? `<span class="user-email">${escapeHtml(userEmail)}</span>`
    : "";
  const stylesheetTags = stylesheets.length > 0
    ? "\n" + stylesheets.map((href) => `  <link rel="stylesheet" href="${escapeHtml(href)}">`).join("\n")
    : "";
  const moduleScriptTags = moduleScripts.length > 0
    ? "\n" + moduleScripts.map((src) => `  <script type="module" src="${escapeHtml(src)}"></script>`).join("\n")
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex,nofollow">
  <title>${safeTitle} | ${escapeHtml(BRAND_TEXT)}</title>
  <style>${ADMIN_STYLES}${styles}${conversionsUiEnabled ? CONVERSIONS_NAV_STYLES : ""}</style>${stylesheetTags}
</head>
<body data-area="admin">
  <p data-marker="kodigital-admin-shell" hidden>shell</p>
  <div class="admin-layout">
    ${renderSidebar(activePath, conversionsUiEnabled)}
    <main class="admin-main">
      <header class="admin-header">
        ${conversionsUiEnabled ? CONVERSIONS_MOBILE_MENU_BTN : MOBILE_MENU_BTN}
        <h1 class="page-title">${safeTitle}</h1>
        <div class="header-actions">${userBlock}</div>
      </header>
      <div class="admin-content">${content}</div>
    </main>
  </div>
  <script>${ADMIN_SCRIPTS}${conversionsUiEnabled ? CONVERSIONS_NAV_SCRIPTS : ""}${scripts}</script>${moduleScriptTags}
</body>
</html>`;
}

// R5 grant 1 (Section Builder v3.1 remediation, register S4-A1/A9/A10): an
// ADDITIVE chromeless render path — no sidebar/header/admin-layout wrapper —
// for pages that need to be a self-contained full-screen surface (the golden
// design's Section Studio editor). Reuses the SAME ADMIN_STYLES/ADMIN_SCRIPTS
// (so .btn/.form-input/.badge/.alert/.card/--c-* vars stay available — the
// studio depends on dozens of these) — only the sidebar/header markup and
// the .admin-layout/.admin-main/.admin-content wrapper divs are omitted.
// adminLayout's own output is COMPLETELY UNCHANGED (a separate function, not
// a branch of it) — proven byte-identical by a dedicated pin (see
// test/leadgen-r5-layout-standalone.test.ts).
export interface AdminStandalonePageOptions {
  title: string;
  content: string;
  scripts?: string;
  styles?: string;
}
export function adminStandalonePage(options: AdminStandalonePageOptions): string {
  const { title, content, scripts = "", styles = "" } = options;
  const safeTitle = escapeHtml(title);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex,nofollow">
  <title>${safeTitle} | ${escapeHtml(BRAND_TEXT)}</title>
  <style>${ADMIN_STYLES}${styles}</style>
</head>
<body data-area="admin-standalone">
  <p data-marker="kodigital-admin-standalone" hidden>standalone</p>
  ${content}
  <script>${ADMIN_SCRIPTS}${scripts}</script>
</body>
</html>`;
}

export const ADMIN_STYLES = `
*{margin:0;padding:0;box-sizing:border-box}
[hidden]{display:none!important}
:root{--c-primary:#2563eb;--c-primary-dark:#1d4ed8;--c-primary-light:#dbeafe;--c-bg:#fff;--c-bg-alt:#f9fafb;--c-bg-dark:#f3f4f6;--c-text:#111827;--c-muted:#6b7280;--c-border:#e5e7eb;--c-success:#10b981;--c-warning:#f59e0b;--c-error:#ef4444;--sidebar-w:250px;--header-h:60px}
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.5;color:var(--c-text);background:var(--c-bg-alt)}
a{color:var(--c-primary);text-decoration:none}
a:hover{text-decoration:underline}
html,body{height:100%;overflow-x:hidden}
.admin-layout{display:flex;min-height:100vh;position:relative}
.admin-sidebar{width:var(--sidebar-w);background:var(--c-bg);border-right:1px solid var(--c-border);display:flex;flex-direction:column;position:fixed;top:0;left:0;height:100vh;z-index:100;transition:transform .3s ease;overflow-y:auto;overscroll-behavior:contain}
.sidebar-header{padding:16px;border-bottom:1px solid var(--c-border)}
.logo{display:flex;align-items:center;gap:12px;color:var(--c-text);font-weight:600;font-size:18px}
.logo:hover{text-decoration:none}
.logo-text{font-weight:600}
.sidebar-logo-image{max-height:32px;max-width:120px;width:auto;height:auto;object-fit:contain}
.sidebar-nav{flex:1;padding:16px 0;overflow-y:auto}
.sidebar-nav ul{list-style:none}
.nav-item{display:flex;align-items:center;gap:12px;padding:10px 16px;color:var(--c-muted);text-decoration:none;transition:all .2s}
.nav-item:hover{background:var(--c-bg-alt);color:var(--c-text);text-decoration:none}
.nav-item.active{background:var(--c-primary-light);color:var(--c-primary);font-weight:500}
.sidebar-footer{padding:16px 0;border-top:1px solid var(--c-border)}
.admin-main{flex:1;min-width:0;margin-left:var(--sidebar-w);min-height:100vh;display:flex;flex-direction:column;isolation:isolate}
.admin-header{height:var(--header-h);background:var(--c-bg);border-bottom:1px solid var(--c-border);display:flex;align-items:center;padding:0 24px;gap:16px;position:sticky;top:0;z-index:50;backface-visibility:hidden;transform:translateZ(0)}
.mobile-menu-btn{display:none;background:none;border:none;padding:8px;cursor:pointer;color:var(--c-text)}
.page-title{font-size:18px;font-weight:600;flex:1}
.header-actions{display:flex;align-items:center;gap:16px}
.user-email{color:var(--c-muted);font-size:13px}
.admin-content{flex:1;padding:24px;min-width:0;padding-bottom:100px}
.card{background:var(--c-bg);border:1px solid var(--c-border);border-radius:8px;padding:24px;margin-bottom:24px}
.card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.card-title{font-size:16px;font-weight:600}
.btn{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;font-size:14px;font-weight:500;border-radius:6px;border:1px solid transparent;cursor:pointer;transition:all .2s;text-decoration:none}
.btn:hover{text-decoration:none}
.btn-primary{background:var(--c-primary);color:#fff}
.btn-primary:hover{background:var(--c-primary-dark)}
.btn-secondary{background:var(--c-bg);border-color:var(--c-border);color:var(--c-text)}
.btn-secondary:hover{background:var(--c-bg-alt)}
.btn-danger{background:var(--c-error);color:#fff}
.btn-danger:hover{background:#dc2626}
.btn-outline{background:transparent;border-color:var(--c-border);color:var(--c-text)}
.btn-outline:hover{background:var(--c-bg-alt);border-color:var(--c-muted)}
.btn-outline-primary{background:transparent;border-color:var(--c-primary);color:var(--c-primary)}
.btn-outline-primary:hover{background:var(--c-primary-light)}
.btn-outline-secondary{background:transparent;border-color:var(--c-border);color:var(--c-muted)}
.btn-outline-secondary:hover{background:var(--c-bg-alt);border-color:var(--c-muted);color:var(--c-text)}
.btn-sm{padding:4px 12px;font-size:13px}
.form-group{margin-bottom:16px}
.form-label{display:block;font-weight:500;margin-bottom:6px;color:var(--c-text)}
.form-input,.form-select,.form-textarea{width:100%;padding:8px 12px;font-size:14px;border:1px solid var(--c-border);border-radius:6px;background:var(--c-bg);color:var(--c-text);transition:border-color .2s,box-shadow .2s}
.form-input:focus,.form-select:focus,.form-textarea:focus{outline:none;border-color:var(--c-primary);box-shadow:0 0 0 3px var(--c-primary-light)}
.form-textarea{min-height:120px;resize:vertical}
.form-help{font-size:12px;color:var(--c-muted);margin-top:4px}
.form-error{font-size:12px;color:var(--c-error);margin-top:4px}
.table-wrapper{overflow-x:auto;width:100%;max-width:100%;min-width:0}
.table{width:100%;border-collapse:collapse}
.table th,.table td{padding:12px 16px;text-align:left;border-bottom:1px solid var(--c-border)}
.table th{font-weight:600;background:var(--c-bg-alt);white-space:nowrap}
.table tr:hover td{background:var(--c-bg-alt)}
.table-actions{display:flex;gap:8px}
/* Round-4 A-1 (list-overflow fix): the wrapper's own overflow-x:auto only
   engages once its ancestor chain is width-constrained (the flex-item
   min-width:0 above on .admin-main is the actual fix — this class is the
   per-table opt-in for the wide analytics tables so the first/actions
   columns stay reachable while the middle scrolls underneath them). Applied
   by each list page's <table> when it carries more columns than fit at
   1280-1440px (offers/sections/quotes/auction + Listicles sections/articles). */
.table--sticky-edges th:first-child,.table--sticky-edges td:first-child{position:sticky;left:0;z-index:1;background:var(--c-bg);box-shadow:1px 0 0 0 var(--c-border)}
.table--sticky-edges th:first-child{background:var(--c-bg-alt)}
.table--sticky-edges th:last-child,.table--sticky-edges td:last-child{position:sticky;right:0;z-index:1;background:var(--c-bg);box-shadow:-1px 0 0 0 var(--c-border)}
.table--sticky-edges th:last-child{background:var(--c-bg-alt)}
.table--sticky-edges tr:hover td:first-child,.table--sticky-edges tr:hover td:last-child{background:var(--c-bg-alt)}
/* Round-4 A-2 shared kebab-actions component (extracted from the offers
   reference implementation, ui-offers.ts's own local .lg-kebab* rules —
   those stay put unchanged there; this is the promoted, globally-available
   copy every OTHER list (sections/quotes/auctions/listicles) renders
   against via renderKebabOpen/KEBAB_CLOSE + kebabMenuScript below). */
.lg-kebab{position:relative;display:inline-block}
.lg-kebab-btn{line-height:1;font-weight:700}
.lg-kebab-menu{position:absolute;right:0;top:100%;z-index:100;min-width:180px;background:#fff;border:1px solid var(--c-border);border-radius:6px;box-shadow:0 8px 20px rgba(0,0,0,0.14);padding:4px;display:flex;flex-direction:column}
.lg-kebab-menu[hidden]{display:none}
.lg-kebab-item{display:block;width:100%;text-align:left;padding:8px 12px;border:0;background:none;font-size:13px;color:var(--c-text);text-decoration:none;cursor:pointer;border-radius:4px}
.lg-kebab-item:hover{background:var(--c-bg-alt)}
.lg-kebab-danger{color:var(--c-danger,#8a1f11)}
.badge{display:inline-flex;align-items:center;padding:2px 8px;font-size:12px;font-weight:500;border-radius:9999px}
.badge-draft{background:var(--c-bg-dark);color:var(--c-muted)}
.badge-published{background:#d1fae5;color:#065f46}
.badge-scheduled{background:#fef3c7;color:#92400e}
.badge-archived{background:#fee2e2;color:#991b1b}
.pagination{display:flex;align-items:center;justify-content:space-between;padding:16px 0;border-top:1px solid var(--c-border)}
.pagination-info{color:var(--c-muted);font-size:13px}
.pagination-links{display:flex;gap:4px}
.pagination-links a,.pagination-links span{padding:6px 12px;border:1px solid var(--c-border);border-radius:4px;font-size:13px;color:var(--c-text);text-decoration:none}
.pagination-links a:hover{background:var(--c-bg-alt);text-decoration:none}
.pagination-links span.current{background:var(--c-primary);border-color:var(--c-primary);color:#fff}
.pagination-links span.disabled{color:var(--c-muted);cursor:not-allowed}
.alert{padding:12px 16px;border-radius:6px;margin-bottom:16px}
.alert-success{background:#d1fae5;color:#065f46;border:1px solid #a7f3d0}
.alert-error{background:#fee2e2;color:#991b1b;border:1px solid #fecaca}
.alert-warning{background:#fef3c7;color:#92400e;border:1px solid #fde68a}
.empty-state{text-align:center;padding:48px 24px;color:var(--c-muted)}
.empty-state svg{margin-bottom:16px;opacity:.5}
.empty-state p{margin-bottom:16px}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
.stat-card{background:var(--c-bg);border:1px solid var(--c-border);border-radius:8px;padding:20px}
.stat-label{font-size:13px;color:var(--c-muted);margin-bottom:4px}
.stat-value{font-size:28px;font-weight:600;color:var(--c-text)}
.toolbar{display:flex;gap:12px;align-items:center;margin-bottom:16px;flex-wrap:wrap}
.toolbar-search{flex:1;min-width:200px;max-width:300px}
.toolbar-filters{display:flex;gap:8px}
@media (max-width:768px){.admin-sidebar{transform:translateX(-100%)}.admin-sidebar.open{transform:translateX(0)}.admin-main{margin-left:0}.mobile-menu-btn{display:block}.admin-content{padding:16px}.stats-grid{grid-template-columns:1fr 1fr}}
@media (max-width:480px){.stats-grid{grid-template-columns:1fr}.toolbar{flex-direction:column;align-items:stretch}.toolbar-search{max-width:none}}
`;

const CONVERSIONS_NAV_STYLES = `
.admin-nav-group{margin:4px 0}
.admin-nav-group-label{display:flex;align-items:center;gap:12px;padding:10px 16px;color:var(--c-text);font-weight:650}
.sidebar-nav .admin-nav-sublist{list-style:none;margin:0;padding:0}
.nav-subitem{padding:8px 16px 8px 48px;font-size:13px}
.admin-nav-group a:focus-visible,.sidebar-nav a[href="/admin/reporting"]:focus-visible{outline:3px solid #111827;outline-offset:-3px}
@media (max-width:768px){.admin-sidebar{visibility:hidden}.admin-sidebar.open{visibility:visible}}
@media (prefers-reduced-motion:reduce){.admin-sidebar{transition-duration:0s!important;animation-duration:0s!important}}
@media (forced-colors:active){.admin-nav-group a:focus-visible,.sidebar-nav a[href="/admin/reporting"]:focus-visible{outline-color:CanvasText}}
`;

// Enhanced-navigation-only lifecycle for the legacy off-canvas sidebar. This
// stays out of the default layout bytes and uses ES5 syntax like ADMIN_SCRIPTS.
// On mobile the closed sidebar is inert and absent from the accessibility
// tree; on desktop it is always restored before its toggle becomes hidden.
const CONVERSIONS_NAV_SCRIPTS = `
(function () {
  var sidebar = document.getElementById('sidebar');
  var menuBtn = document.querySelector('.mobile-menu-btn');
  if (!sidebar || !menuBtn) { return; }

  var media = window.matchMedia ? window.matchMedia('(max-width: 768px)') : null;
  var motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var wasMobile = media ? media.matches : window.innerWidth <= 768;
  var focusTimer = null;
  var focusFrame = null;
  var sidebarWasOpenAtClick = false;
  var lastFocusedElement = document.activeElement;

  function isMobile() {
    return media ? media.matches : window.innerWidth <= 768;
  }

  function prefersReducedMotion() {
    return motion ? motion.matches : false;
  }

  function setSidebarHidden(hidden) {
    if (hidden) {
      sidebar.setAttribute('inert', '');
      sidebar.setAttribute('aria-hidden', 'true');
      sidebar.inert = true;
    } else {
      sidebar.removeAttribute('inert');
      sidebar.removeAttribute('aria-hidden');
      sidebar.inert = false;
    }
  }

  function clearFocusDelay() {
    if (focusTimer !== null) {
      window.clearTimeout(focusTimer);
      focusTimer = null;
    }
    if (focusFrame !== null) {
      window.cancelAnimationFrame(focusFrame);
      focusFrame = null;
    }
  }

  function focusFirstSidebarLink() {
    var target;
    if (!isMobile() || !sidebar.classList.contains('open')) { return; }
    target = sidebar.querySelector('a[href]');
    if (target) { target.focus(); }
  }

  function scheduleSidebarFocus() {
    if (prefersReducedMotion()) {
      if (window.requestAnimationFrame) {
        focusFrame = window.requestAnimationFrame(function () {
          focusFrame = null;
          focusFirstSidebarLink();
        });
      } else {
        focusFirstSidebarLink();
      }
      return;
    }
    focusTimer = window.setTimeout(function () {
      focusTimer = null;
      focusFirstSidebarLink();
    }, 320);
  }

  function closeSidebar(restoreFocus) {
    clearFocusDelay();
    sidebar.classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
    if (restoreFocus || sidebar.contains(document.activeElement)) {
      menuBtn.focus();
    }
    setSidebarHidden(true);
  }

  function openSidebar() {
    clearFocusDelay();
    setSidebarHidden(false);
    sidebar.classList.add('open');
    menuBtn.setAttribute('aria-expanded', 'true');
    scheduleSidebarFocus();
  }

  function syncMotionPreference() {
    if (prefersReducedMotion() && sidebar.classList.contains('open')) {
      sidebar.style.transition = 'none';
      sidebar.offsetWidth;
      sidebar.style.removeProperty('transition');
    }
    if (isMobile() && sidebar.classList.contains('open') &&
        !sidebar.contains(document.activeElement)) {
      clearFocusDelay();
      scheduleSidebarFocus();
    }
  }

  function syncViewport() {
    var mobile = isMobile();
    if (mobile) {
      if (!wasMobile) {
        closeSidebar(sidebar.contains(document.activeElement) || sidebar.contains(lastFocusedElement));
      } else if (sidebar.classList.contains('open')) {
        setSidebarHidden(false);
        menuBtn.setAttribute('aria-expanded', 'true');
      } else {
        closeSidebar(false);
      }
    } else {
      clearFocusDelay();
      // A media-query transition from off-canvas to desktop would otherwise
      // leave a newly focused sidebar link briefly outside the viewport.
      sidebar.style.transition = 'none';
      sidebar.classList.remove('open');
      setSidebarHidden(false);
      menuBtn.setAttribute('aria-expanded', 'true');
      sidebar.offsetWidth;
      if (document.activeElement === menuBtn || (wasMobile && lastFocusedElement === menuBtn)) {
        var target = sidebar.querySelector('a[href]');
        if (target) { target.focus(); }
      }
      window.setTimeout(function () {
        sidebar.style.removeProperty('transition');
      }, 0);
    }
    wasMobile = mobile;
  }

  window.toggleSidebar = function () {
    if (!isMobile()) {
      syncViewport();
      return;
    }
    if (sidebar.classList.contains('open')) {
      closeSidebar(true);
    } else {
      openSidebar();
    }
  };

  document.addEventListener('focusin', function (event) {
    lastFocusedElement = event.target;
  });

  document.addEventListener('click', function () {
    sidebarWasOpenAtClick = isMobile() && sidebar.classList.contains('open');
  }, true);

  document.addEventListener('click', function (event) {
    if (sidebarWasOpenAtClick &&
        !sidebar.contains(event.target) &&
        !menuBtn.contains(event.target)) {
      closeSidebar(true);
    }
    sidebarWasOpenAtClick = false;
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && isMobile() && sidebar.classList.contains('open')) {
      event.preventDefault();
      closeSidebar(true);
    }
  });

  if (media && media.addEventListener) {
    media.addEventListener('change', syncViewport);
  } else {
    window.addEventListener('resize', syncViewport);
  }
  if (motion && motion.addEventListener) {
    motion.addEventListener('change', syncMotionPreference);
  } else if (motion && motion.addListener) {
    motion.addListener(syncMotionPreference);
  }
  syncViewport();
}());
`;

// Ported legacy admin script, converted to strict ES5: var-only bindings,
// no arrow functions, promise-based api() instead of async/await. Toast
// icons are fixed SVG constants parsed via DOMParser (no innerHTML); the
// caller-supplied message goes through textContent only. Exported (R5 grant
// 1) so adminStandalonePage can inline the SAME toast/confirmDelete/
// generateSlug/api() helpers a chromeless page may still want.
export const ADMIN_SCRIPTS = `
function toggleSidebar() {
  var s = document.getElementById('sidebar');
  if (s) { s.classList.toggle('open'); }
}
window.toggleSidebar = toggleSidebar;

document.addEventListener('click', function (e) {
  var sidebar = document.getElementById('sidebar');
  var menuBtn = document.querySelector('.mobile-menu-btn');
  if (sidebar && menuBtn && window.innerWidth <= 768 &&
      sidebar.classList.contains('open') &&
      !sidebar.contains(e.target) &&
      !menuBtn.contains(e.target)) {
    sidebar.classList.remove('open');
  }
});

function confirmDelete(message) {
  return confirm(message || 'Are you sure you want to delete this item?');
}
window.confirmDelete = confirmDelete;

function generateSlug(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\\w\\s-]/g, '')
    .replace(/\\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}
window.generateSlug = generateSlug;

function api(method, url, data) {
  var options = {
    method: method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (data) { options.body = JSON.stringify(data); }
  return fetch(url, options).then(function (response) {
    return response.json();
  });
}
window.api = api;

function showToast(message, type, duration) {
  type = type || 'info';
  duration = duration || 3000;
  var container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(container);
  }
  var toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.style.cssText = 'padding:12px 20px;border-radius:8px;font-size:14px;font-weight:500;box-shadow:0 4px 12px rgba(0,0,0,0.15);animation:toastSlideIn 0.3s ease;display:flex;align-items:center;gap:8px;max-width:320px;';
  if (type === 'success') {
    toast.style.background = '#10b981';
  } else if (type === 'error') {
    toast.style.background = '#ef4444';
  } else if (type === 'warning') {
    toast.style.background = '#f59e0b';
  } else {
    toast.style.background = '#3b82f6';
  }
  toast.style.color = 'white';
  var icons = {
    success: '<svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path></svg>',
    error: '<svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"></path></svg>',
    warning: '<svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path></svg>',
    info: '<svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"></path></svg>'
  };
  var iconDoc = new DOMParser().parseFromString(icons[type] || icons.info, 'image/svg+xml');
  toast.appendChild(document.importNode(iconDoc.documentElement, true));
  var label = document.createElement('span');
  label.textContent = message;
  toast.appendChild(label);
  container.appendChild(toast);
  setTimeout(function () {
    toast.style.animation = 'toastSlideOut 0.3s ease';
    setTimeout(function () {
      if (toast.parentNode) { toast.parentNode.removeChild(toast); }
    }, 300);
  }, duration);
}
window.showToast = showToast;

if (!document.getElementById('toast-animations')) {
  var toastStyle = document.createElement('style');
  toastStyle.id = 'toast-animations';
  toastStyle.textContent = '@keyframes toastSlideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}@keyframes toastSlideOut{from{transform:translateX(0);opacity:1}to{transform:translateX(100%);opacity:0}}';
  document.head.appendChild(toastStyle);
}

/* -------------------------------------------------------------------------
   R2 P8-3 FIX ROUND F10 -- THE CLIP REVEAL. One mechanism for the whole
   admin, because three consecutive fix rounds each wrote a longer operator
   string into a box nobody measured.

   A select element paints its selected option inside whatever box the layout
   gives it and CLIPS the overflow silently: no ellipsis, no tooltip, no
   scroll. (No angle-bracketed tag names in this comment on purpose -- it is
   served inline, and markup scanners read these bytes.)
   Measured on this build (driven, 127.0.0.1:8901, chromium):
     #lg-theme-preset-select  347.05px of text in a 288.00px box (+59.05 at
                              1280 AND 375), scrollWidth 363 > clientWidth 312
     #lg-theme-site-select    236.58 in 197.88 (+38.70 at 1280, +21.70 at 375)
     #lg-theme-target-select  469.77 in 186.00 (+283.77)
     #lg-tpl-section-select   531.80 in 226.00 (+305.80)
   and every one of them reported title="" -- the operator had NO way to read
   the rest.

   Where the text is product copy the fix is to make the copy fit (that is a
   per-string job and its regression is test/leadgen-p8-n-theme-ui.test.ts's
   clip invariant). Where the text is the operator's OWN data -- a site name, a
   funnel name, a section name, a saved preset name -- no box can be
   guaranteed wide enough, so the honest close is to hand them the full text:
   a title carrying the selected option verbatim, plus an ellipsis so the
   clipping is visible rather than a word cut mid-glyph.

   It is SELF-MEASURING (scrollWidth vs clientWidth of the real painted box),
   so it needs no list of controls, no list of strings and no container class:
   a select added tomorrow, on any admin page, in any container, is covered on
   the same terms. It adds nothing when the text already fits, and it is not a
   gate -- it blocks nothing and validates nothing.
   ------------------------------------------------------------------------- */
function lgSelectedOptionText(sel) {
  var idx = sel.selectedIndex;
  if (typeof idx !== 'number' || idx < 0 || !sel.options || !sel.options[idx]) { return ''; }
  return sel.options[idx].textContent || '';
}
function lgRevealClippedSelect(sel) {
  if (!sel || !sel.tagName || String(sel.tagName).toUpperCase() !== 'SELECT') { return; }
  var text = lgSelectedOptionText(sel);
  if (sel.scrollWidth > sel.clientWidth && text !== '') {
    sel.setAttribute('data-lg-clipped', '1');
    sel.setAttribute('title', text);
    if (sel.style) { sel.style.textOverflow = 'ellipsis'; }
  } else if (sel.getAttribute && sel.getAttribute('data-lg-clipped') === '1') {
    /* only ever withdraws the title THIS helper put there, so an authored
       title on some other control is never eaten. */
    sel.removeAttribute('data-lg-clipped');
    sel.removeAttribute('title');
    if (sel.style) { sel.style.textOverflow = ''; }
  }
}
function lgRevealClippedSelects(root) {
  var scope = root && root.querySelectorAll ? root : document;
  var all = scope.querySelectorAll ? scope.querySelectorAll('select') : [];
  var i;
  for (i = 0; i < all.length; i++) { lgRevealClippedSelect(all[i]); }
}
window.lgRevealClippedSelect = lgRevealClippedSelect;
window.lgRevealClippedSelects = lgRevealClippedSelects;

function lgSelectOfEvent(target) {
  var el = target;
  while (el && el.tagName) {
    if (String(el.tagName).toUpperCase() === 'SELECT') { return el; }
    el = el.parentNode;
  }
  return null;
}
function lgOnSelectEvent(e) {
  var sel = lgSelectOfEvent(e.target);
  if (sel) { lgRevealClippedSelect(sel); }
}
/* change: the operator picked a longer entry. focusin/mouseover: the moment
   before a tooltip could be shown, so a select an island filled after load is
   current by the time it is read. No polling, no timer. */
document.addEventListener('change', lgOnSelectEvent, true);
document.addEventListener('focusin', lgOnSelectEvent, true);
document.addEventListener('mouseover', lgOnSelectEvent, true);

/* An island that REPOPULATES a select (the theme-preset picker, the funnel
   picker, the section picker) changes the painted text without any user
   event. The observer reacts to exactly that -- option churn -- and is idle
   otherwise; the O(1) nodeName test keeps it off the hot path of pages that
   mutate heavily for other reasons. */
var lgRevealQueued = false;
function lgQueueReveal() {
  if (lgRevealQueued) { return; }
  lgRevealQueued = true;
  setTimeout(function () {
    lgRevealQueued = false;
    lgRevealClippedSelects(document);
  }, 0);
}
function lgTouchesASelect(rec) {
  if (rec.target && rec.target.nodeName === 'SELECT') { return true; }
  var lists = [rec.addedNodes, rec.removedNodes];
  var l, i, node;
  for (l = 0; l < lists.length; l++) {
    for (i = 0; lists[l] && i < lists[l].length; i++) {
      node = lists[l][i];
      if (!node || !node.nodeName) { continue; }
      if (node.nodeName === 'SELECT' || node.nodeName === 'OPTION') { return true; }
      if (node.getElementsByTagName && node.getElementsByTagName('select').length > 0) { return true; }
    }
  }
  return false;
}
if (typeof MutationObserver === 'function' && document.body) {
  new MutationObserver(function (records) {
    var i;
    for (i = 0; i < records.length; i++) {
      if (lgTouchesASelect(records[i])) { lgQueueReveal(); return; }
    }
  }).observe(document.body, { childList: true, subtree: true });
}
lgRevealClippedSelects(document);
`;
