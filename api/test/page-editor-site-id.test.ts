// Editor site-id contract — re-pointed at the PORTED templates (T26.AC3).
//
// Originally written against views/page-editor (T22.AC2). T26 folds the
// submit-block behaviors from views/article-editor.ts:122-133 into the
// ported editor scripts (templates/articles.ts + templates/pages.ts):
// with no site selected, submit is blocked (preventDefault +
// stopImmediatePropagation), the aria-live="polite" status region reads
// "Site is required", the Site select takes focus, and no request fires.
// With a site selected, the save persists through mock-D1 db.prepare.

import { describe, it, expect } from "vitest";
import admin from "../src/admin/router";
import { articleFormPage } from "../src/admin/templates/articles";
import { pageFormPage } from "../src/admin/templates/pages";
import { buildEnv, makeFakeDb } from "./helpers/admin-test-kit";

describe("page editor (T22.AC2, ported template)", () => {
  it("About page requires site_id; legal templates allow site_id NULL", () => {
    const html = pageFormPage(null, [{ id: "siteA", name: "Site A" }]);

    // Required Site selector
    expect(html).toMatch(/id="page-site"/);
    expect(html).toMatch(/aria-required="true"/);
    expect(html).toMatch(/name="site_id"/);

    // Submit-block status region
    expect(html).toMatch(/aria-live="polite"/);
    expect(html).toContain("Site is required");

    // Page-type select
    expect(html).toMatch(/id="page-type"/);
    expect(html).toMatch(/name="page_type"/);

    // Canonical legal-template slugs allowed to save with site_id NULL.
    const legalSlugs = ["privacy-policy", "terms", "do-not-sell", "contact"];
    for (const slug of legalSlugs) {
      expect(html).toContain(slug);
    }

    // "Global template" badge surfaced for legal templates.
    expect(html).toMatch(/id="page-global-badge"/);
    expect(html).toContain("Global template");

    // Submit-blocking handler is present in the inline script.
    expect(html).toMatch(/preventDefault/);
    expect(html).toMatch(/stopImmediatePropagation/);

    // Script encodes the four canonical legal slugs as the gate that
    // releases the site_id requirement.
    for (const slug of legalSlugs) {
      const pattern = new RegExp("'" + slug + "'\\s*:\\s*1");
      expect(html).toMatch(pattern);
    }
  });
});

describe("article editor site-id contract (T26.AC3)", () => {
  it("site-required save persists via mock-D1 db.prepare", async () => {
    const html = articleFormPage(
      null,
      [{ id: "siteA", name: "Site A" }],
      [],
    );

    // Folded views/article-editor.ts:122-133 behaviors in the ported
    // editor template: required Site select, polite status region with
    // the exact message, hard submit block, focus restoration.
    expect(html).toMatch(/id="article-site"/);
    expect(html).toMatch(/name="site_id"/);
    expect(html).toMatch(/aria-live="polite"/);
    expect(html).toContain("Site is required");
    expect(html).toMatch(/preventDefault/);
    expect(html).toMatch(/stopImmediatePropagation/);
    expect(html).toContain("siteSelect.focus()");

    // The save POST target is EXTRACTED from the rendered script and
    // replayed through the real admin router so template/router drift
    // fails here.
    const urlMatch = html.match(/: '(\/api\/admin\/articles)';/);
    expect(urlMatch).not.toBeNull();
    const postUrl = urlMatch?.[1] ?? "";

    const { db, calls } = makeFakeDb([
      { match: "SELECT id FROM sites WHERE id = ?", row: { id: "siteA" } },
      {
        match: "INSERT INTO articles",
        row: {
          id: 99,
          site_id: "siteA",
          slug: "hello",
          title: "Hello",
          category_id: null,
          status: "draft",
        },
      },
    ]);
    const res = await admin.request(
      postUrl,
      {
        method: "POST",
        body: JSON.stringify({ site_id: "siteA", slug: "hello", title: "Hello" }),
        headers: { "Content-Type": "application/json" },
      },
      buildEnv(db),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      article: { id: number; site_id: string };
    };
    expect(body.article.site_id).toBe("siteA");

    // Persistence proof: the site-required save flowed through mock-D1
    // db.prepare(INSERT INTO articles ...).bind(site_id, slug, ...).
    const ins = calls.find((c) => c.sql.startsWith("INSERT INTO articles"));
    expect(ins).toBeDefined();
    expect(ins?.binds[0]).toBe("siteA");
    expect(ins?.binds[1]).toBe("hello");
  });
});
