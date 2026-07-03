import { describe, it, expect } from "vitest";
import { adminLayout } from "../src/admin/templates/layout";
import { settingsPage } from "../src/admin/templates/settings";
import { pageFormPage } from "../src/admin/templates/pages";
import { categoriesListPage } from "../src/admin/templates/categories";

// T22 / [B1] adminLayout shell port acceptance:
//   T22.AC2 — brand is KoDigital CMS; no TheIWise residue in the shell
//   T22.AC3 — sidebar nav renders exactly 10 entries in contract order
//             (9 original entries + Listicles right after Pages, per the
//             Listicles design contract §4 — Phase 3)
//   T22.AC4 — toast / mobile-menu-btn / badge-draft markers present
//   T22.AC5 — the layout's inline <script> stays ES5: zero arrow/const/let
//             (script-extraction assertion, NOT a whole-file grep — the TS
//             module itself legitimately uses const/arrows outside the
//             script string)

const NAV_CONTRACT: ReadonlyArray<[string, string]> = [
  ["/admin", "Dashboard"],
  ["/admin/domains", "Domains"],
  ["/admin/articles", "Articles"],
  ["/admin/pages", "Pages"],
  ["/admin/listicles", "Listicles"],
  ["/admin/media", "Media"],
  ["/admin/categories", "Categories"],
  ["/admin/tags", "Tags"],
  ["/admin/presets", "AI Presets"],
  ["/admin/settings", "Settings"],
];

function renderShell(activePath?: string): string {
  return adminLayout({
    title: "Test Page",
    activePath,
    userEmail: "admin@example.com",
    content: "<p>shell-test-content</p>",
  });
}

// Extract ONLY the layout's own <script> payload from the rendered page
// (renderShell passes no page-level scripts, so the single <script> block
// is exactly the layout's ADMIN_SCRIPTS string).
function extractInlineScript(html: string): string {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  expect(m, "rendered shell must contain one inline <script> block").not.toBeNull();
  return m![1]!;
}

function extractSidebarNav(html: string): string {
  const m = html.match(/<nav class="sidebar-nav"[\s\S]*?<\/nav>/);
  expect(m, "rendered shell must contain the sidebar-nav block").not.toBeNull();
  return m![0]!;
}

describe("admin layout shell port (T22)", () => {
  // T22.AC3: nav order exact 10 entries (incl. Listicles after Pages, §4)
  it("renders exactly 10 sidebar-nav entries in contract order", () => {
    const nav = extractSidebarNav(renderShell("/admin"));
    const labels = Array.from(nav.matchAll(/<span>([^<]+)<\/span>/g)).map(
      (m) => m[1],
    );
    expect(labels).toEqual(NAV_CONTRACT.map(([, label]) => label));
    const hrefs = Array.from(nav.matchAll(/href="([^"]+)"/g)).map((m) => m[1]);
    expect(hrefs).toEqual(NAV_CONTRACT.map(([href]) => href));
  });

  it("marks exactly one nav entry active for a nested path", () => {
    const html = renderShell("/admin/articles");
    const activeCount = (html.match(/nav-item active/g) ?? []).length;
    expect(activeCount).toBe(1);
    expect(html).toContain('href="/admin/articles" class="nav-item active"');
  });

  // T22.AC2: KoDigital CMS branding, no legacy brand residue
  it("brands the shell as KoDigital CMS with no TheIWise residue", () => {
    const html = renderShell();
    expect(html).toContain("KoDigital CMS");
    expect(html).not.toContain("TheIWise");
    // shell markers other suites rely on stay intact
    expect(html).toContain('data-marker="kodigital-admin-shell"');
    expect(html).toContain('data-area="admin"');
  });

  // T22.AC4: ported shell feature markers
  it("ships toast + mobile-menu-btn + badge-draft markers", () => {
    const html = renderShell();
    expect(html).toContain("mobile-menu-btn");
    expect(html).toContain("badge-draft");
    expect(html).toContain("toast");
    const script = extractInlineScript(html);
    expect(script).toContain("function showToast");
    expect(script).toContain("toast-container");
  });

  // T22.AC5: inline script stays ES5 — script-extraction assertion
  it("keeps the layout inline script ES5: zero arrow/const/let", () => {
    const script = extractInlineScript(renderShell());
    expect(script).not.toMatch(/=>/);
    expect(script).not.toMatch(/\bconst\b/);
    expect(script).not.toMatch(/\blet\b/);
    // strict-ES5 extras: no async/await, no template literals
    expect(script).not.toMatch(/\basync\b/);
    expect(script).not.toMatch(/\bawait\b/);
    expect(script).not.toContain("`");
    // the ported helpers are actually present (extraction sanity)
    expect(script).toContain("function toggleSidebar");
    expect(script).toContain("function confirmDelete");
    expect(script).toContain("function generateSlug");
    expect(script).toContain("function api");
  });
});

// T15.AC2 — the admin layout shell (renderShell == adminLayout) wraps every
// admin tab including Settings. Rendering the Settings page proves the admin
// design chrome the Settings tab is composed inside actually renders, and the
// shell marks the Settings nav entry active for the Settings activePath.
describe("admin shell hosts the Settings tab (T15.AC2)", () => {
  it("composes the Settings page inside the admin shell chrome", () => {
    const html = settingsPage(
      [{ id: "st_a", name: "Site A" }],
      {},
      "st_a",
      { userEmail: "admin@example.com" },
    );
    // the admin design shell chrome that hosts every tab
    expect(html).toContain('data-marker="kodigital-admin-shell"');
    expect(html).toContain('data-area="admin"');
    expect(html).toContain('class="admin-sidebar"');
    expect(html).toContain('class="admin-content"');
    // the shell marks Settings as the active tab when hosting Settings
    expect(html).toContain('href="/admin/settings" class="nav-item active"');
    // the tab-specific Settings fields live inside that shell content region
    expect(html).toContain("settings-tabs");
  });

  it("renderShell emits the same chrome for the Settings activePath directly", () => {
    const html = renderShell("/admin/settings");
    expect(html).toContain('data-marker="kodigital-admin-shell"');
    expect(html).toContain('href="/admin/settings" class="nav-item active"');
    const activeCount = (html.match(/nav-item active/g) ?? []).length;
    expect(activeCount).toBe(1);
  });
});

// T16.AC2 — the admin layout shell (renderShell == adminLayout) wraps every
// admin tab including Pages. Rendering the Pages editor form proves the admin
// design chrome the Pages tab is composed inside actually renders, and the
// shell marks the Pages nav entry active for the Pages activePath. (The
// tab-specific layout Template select is asserted by T16.AC1's served-markup
// test in pages-template.test.ts.)
describe("admin shell hosts the Pages tab (T16.AC2)", () => {
  it("composes the Pages editor form inside the admin shell chrome", () => {
    const html = pageFormPage(null, [{ id: "st_a", name: "Site A" }], {
      userEmail: "admin@example.com",
    });
    // the admin design shell chrome that hosts every tab
    expect(html).toContain('data-marker="kodigital-admin-shell"');
    expect(html).toContain('data-area="admin"');
    expect(html).toContain('class="admin-sidebar"');
    expect(html).toContain('class="admin-content"');
    // the shell marks Pages as the active tab when hosting Pages
    expect(html).toContain('href="/admin/pages" class="nav-item active"');
    // the tab-specific Pages editor lives inside that shell content region
    expect(html).toContain('id="page-form"');
  });

  it("renderShell emits the same chrome for the Pages activePath directly", () => {
    const html = renderShell("/admin/pages");
    expect(html).toContain('data-marker="kodigital-admin-shell"');
    expect(html).toContain('href="/admin/pages" class="nav-item active"');
    const activeCount = (html.match(/nav-item active/g) ?? []).length;
    expect(activeCount).toBe(1);
  });
});

// T17.AC2 — the admin layout shell (renderShell == adminLayout) wraps every
// admin tab including Categories. Rendering the Categories page proves the
// admin design chrome the Categories tab is composed inside actually renders,
// and the shell marks the Categories nav entry active for the Categories
// activePath. (The tab-specific Description / Display-Order / Show-on-Homepage
// fields are asserted by T17.AC1's served-markup test in categories-fields.test.ts.)
describe("admin shell hosts the Categories tab (T17.AC2)", () => {
  it("composes the Categories page inside the admin shell chrome", () => {
    const html = categoriesListPage([], [{ id: "st_a", name: "Site A" }], {
      userEmail: "admin@example.com",
    });
    // the admin design shell chrome that hosts every tab
    expect(html).toContain('data-marker="kodigital-admin-shell"');
    expect(html).toContain('data-area="admin"');
    expect(html).toContain('class="admin-sidebar"');
    expect(html).toContain('class="admin-content"');
    // the shell marks Categories as the active tab when hosting Categories
    expect(html).toContain('href="/admin/categories" class="nav-item active"');
    // the tab-specific Categories editor form lives inside that shell content region
    expect(html).toContain('id="new-category-form"');
  });

  it("renderShell emits the same chrome for the Categories activePath directly", () => {
    const html = renderShell("/admin/categories");
    expect(html).toContain('data-marker="kodigital-admin-shell"');
    expect(html).toContain('href="/admin/categories" class="nav-item active"');
    const activeCount = (html.match(/nav-item active/g) ?? []).length;
    expect(activeCount).toBe(1);
  });
});
