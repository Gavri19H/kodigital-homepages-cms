// §14 layout registry — verbatim interface + unknown-id fallback.

import { describe, it, expect } from "vitest";
import { getLayout, LAYOUTS } from "../src/public/listicle/layouts/registry";
import { defaultLayout } from "../src/public/listicle/layouts/default/components";

describe("§14 layout registry", () => {
  it("LAYOUTS carries the default layout under its id", () => {
    expect(LAYOUTS.default).toBe(defaultLayout);
    expect(defaultLayout.id).toBe("default");
  });

  it("getLayout returns the requested layout for a known id", () => {
    expect(getLayout("default")).toBe(defaultLayout);
  });

  it("unknown id → default (§14)", () => {
    expect(getLayout("brand-new-style")).toBe(defaultLayout);
    expect(getLayout("")).toBe(defaultLayout);
  });

  it("the §14 interface members exist with the contract shapes", () => {
    const layout = getLayout("default");
    expect(typeof layout.id).toBe("string");
    expect(typeof layout.name).toBe("string");
    expect(typeof layout.cssVars).toBe("object");
    expect(typeof layout.renderShell).toBe("function");
    expect(typeof layout.renderPage).toBe("function");
    expect(typeof layout.renderSection).toBe("function");
  });

  it("cssVars carry the drift-resolved layout identity", () => {
    const vars = getLayout("default").cssVars;
    expect(vars["--lst-header-bg"]).toBe("#e0072b"); // measured live header (DEV-13)
    expect(vars["--lst-font-family"]).toContain("Inter");
    expect(vars["--lst-cta-bg"]).toBe("#f8020e"); // measured choice-button bg
  });

  it("renderSection wraps the body and emits the O3 divider element", () => {
    const html = getLayout("default").renderSection("<p>body</p>");
    expect(html).toContain('<section class="lst-section"><p>body</p></section>');
    expect(html).toContain('<hr class="lst-divider">');
  });

  it("renderPage stamps the §15.7 page identity attributes", () => {
    const html = getLayout("default").renderPage(
      {
        pageIndex: 2,
        selectionMode: "ab_test",
        abTestId: "ab_1",
        ruleSetId: null,
        defaultCandidateId: "cand_X",
      },
      "<div>cand</div>",
    );
    expect(html).toContain('data-page-index="2"');
    expect(html).toContain('data-selection-mode="ab_test"');
    expect(html).toContain('data-ab-test-id="ab_1"');
    expect(html).toContain('data-default-cand="cand_X"');
    expect(html).toContain("<div>cand</div>");
  });

  it("renderShell composes title/byline/hero/intro/pages in §30.2 order", () => {
    const html = getLayout("default").renderShell({
      headline: "Line one\nLine two",
      bylineHtml: '<div class="lst-byline">B</div>',
      heroHtml: '<div class="lst-hero">H</div>',
      introHtml: "<p>intro</p>",
      pagesHtml: '<div class="lst-page">P</div>',
    });
    const title = html.indexOf("lst-title");
    const byline = html.indexOf("lst-byline");
    const hero = html.indexOf("lst-hero");
    const intro = html.indexOf("lst-intro");
    const page = html.indexOf("lst-page");
    expect(title).toBeGreaterThan(-1);
    expect(byline).toBeGreaterThan(title);
    expect(hero).toBeGreaterThan(byline);
    expect(intro).toBeGreaterThan(hero);
    expect(page).toBeGreaterThan(intro);
    // The measured two-line heading pattern: one heading element per line,
    // weight via <strong>.
    expect(html).toContain("<h2 class=\"lst-title-line\"><strong>Line one</strong></h2>");
    expect(html).toContain("<h2 class=\"lst-title-line\"><strong>Line two</strong></h2>");
  });
});
