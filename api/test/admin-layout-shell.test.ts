import { describe, it, expect } from "vitest";
import { adminLayout } from "../src/admin/templates/layout";

// T22 / [B1] adminLayout shell port acceptance:
//   T22.AC2 — brand is KoDigital CMS; no TheIWise residue in the shell
//   T22.AC3 — sidebar nav renders exactly 9 entries in contract order
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
  // T22.AC3: nav order exact 9 entries
  it("renders exactly 9 sidebar-nav entries in contract order", () => {
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
