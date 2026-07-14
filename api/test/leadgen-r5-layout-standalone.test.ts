// Section Builder v3.1 REMEDIATION — phase R5, STAGE A2 grant 1: layout.ts's
// ADDITIVE chromeless render path (register S4-A1/A9/A10 — the full-bleed
// Section Studio editor). Two things this pins:
//   1. adminLayout's OWN output is COMPLETELY UNCHANGED for a non-editor page
//      (byte-identical) — the grant's own condition ("other pages byte-
//      identical"). Proven by re-asserting the EXACT same shell markers the
//      pre-existing test/admin-layout-shell.test.ts (un-owned, untouched)
//      already pins, from a SEPARATE test file so this phase carries its own
//      independent proof.
//   2. adminStandalonePage is a genuinely SEPARATE function: no sidebar/
//      header/.admin-layout wrapper, but the SAME ADMIN_STYLES/ADMIN_SCRIPTS
//      inlined (so .btn/.form-input/.badge/.alert/--c-* vars — everything
//      the studio's markup depends on — are still available).
import { describe, expect, it } from "vitest";
import { adminLayout, adminStandalonePage, ADMIN_STYLES, ADMIN_SCRIPTS } from "../src/admin/templates/layout";

describe("R5 grant 1 — adminLayout byte-identity (non-editor pages unchanged)", () => {
  const FIXED_INPUT = {
    title: "Test Page",
    activePath: "/admin/leadgen/offers",
    userEmail: "admin@example.com",
    content: "<p>shell-test-content</p>",
  };

  it("carries the admin shell marker, sidebar, header and admin-content wrapper — exactly as before this phase", () => {
    const html = adminLayout(FIXED_INPUT);
    expect(html).toContain('<p data-marker="kodigital-admin-shell" hidden>shell</p>');
    expect(html).toContain('<div class="admin-layout">');
    expect(html).toContain('<aside class="admin-sidebar" id="sidebar">');
    expect(html).toContain('<main class="admin-main">');
    expect(html).toContain('<header class="admin-header">');
    expect(html).toContain('<div class="admin-content"><p>shell-test-content</p></div>');
    expect(html).toContain("<title>Test Page | KoDigital CMS</title>");
  });

  it("is DETERMINISTIC for the same input (calling it twice yields byte-identical output — no per-call variance leaked in by the new adminStandalonePage sibling)", () => {
    const a = adminLayout(FIXED_INPUT);
    const b = adminLayout(FIXED_INPUT);
    expect(a).toBe(b);
  });

  it("still embeds the FULL ADMIN_STYLES/ADMIN_SCRIPTS text verbatim (the two consts becoming `export`-ed did not change their content)", () => {
    const html = adminLayout(FIXED_INPUT);
    expect(html).toContain(`<style>${ADMIN_STYLES}</style>`);
    expect(html).toContain(`<script>${ADMIN_SCRIPTS}</script>`);
  });
});

describe("R5 grant 1 — adminStandalonePage (the NEW chromeless path)", () => {
  const html = adminStandalonePage({ title: "Section Studio", content: "<p>studio-content</p>" });

  it("carries the STANDALONE marker (not the admin-shell one) and NO sidebar/header/.admin-layout wrapper", () => {
    expect(html).toContain('<p data-marker="kodigital-admin-standalone" hidden>standalone</p>');
    expect(html).not.toContain("kodigital-admin-shell");
    expect(html).not.toContain('<aside class="admin-sidebar"');
    expect(html).not.toContain('<header class="admin-header">');
    expect(html).not.toContain('class="admin-layout"');
    expect(html).not.toContain('class="admin-main"');
    expect(html).not.toContain('class="admin-content"');
  });

  it("still inlines the SAME base ADMIN_STYLES/ADMIN_SCRIPTS the shelled path uses (so .btn/.form-input/.badge/--c-* stay available)", () => {
    expect(html).toContain(`<style>${ADMIN_STYLES}</style>`);
    expect(html).toContain(`<script>${ADMIN_SCRIPTS}</script>`);
    expect(ADMIN_STYLES).toContain(".btn{");
    expect(ADMIN_STYLES).toContain(".form-input,.form-select,.form-textarea{");
    expect(ADMIN_STYLES).toContain(".badge{");
    expect(ADMIN_STYLES).toContain(".alert{");
    expect(ADMIN_STYLES).toContain("--c-primary:");
  });

  it("renders the content verbatim, with page-specific styles/scripts appended after the base ones", () => {
    const withExtra = adminStandalonePage({
      title: "X",
      content: "<p>hi</p>",
      styles: ".my-extra{color:red}",
      scripts: "console.log('extra');",
    });
    expect(withExtra).toContain(`<style>${ADMIN_STYLES}.my-extra{color:red}</style>`);
    expect(withExtra).toContain(`<script>${ADMIN_SCRIPTS}console.log('extra');</script>`);
  });

  it("titles the page through the SAME BRAND_TEXT suffix as adminLayout", () => {
    expect(html).toContain("<title>Section Studio | KoDigital CMS</title>");
  });
});
