import { describe, it, expect } from "vitest";
import { articleFormPage } from "../src/admin/templates/articles";

// T11 — Author fields + Display Options cleanup (no homepage_section).
//
// AC (T11-AC1, behavioral): the article editor FORM marks author_name
// required, renders the Featured + Trending toggles and a homepage_rank
// input, and has NO homepage_section control anywhere.
//
// These assertions run against the SAME articleFormPage() output the admin
// handler emits (full page incl. the inline submit script), so a pass proves
// the live editor — not an orphaned fragment. The negative checks scan the
// ENTIRE rendered page string, satisfying the AC's "anywhere": both the form
// <select> control AND the client submit body key are gone.

const sites = [{ id: "site-1", name: "Demo Site" }];

const newPage = articleFormPage(null, sites, [], {
  userEmail: "editor@kodigital.io",
});

const editPage = articleFormPage(
  {
    id: "42",
    title: "Existing",
    site_id: "site-1",
    author_name: "Jamie Reporter",
    author_bio: "Covers wellness.",
    homepage_rank: 3,
    is_featured: true,
    is_trending: false,
  },
  sites,
  [],
  { userEmail: "editor@kodigital.io" },
);

describe("T11 article form: author required + Display Options + no homepage_section", () => {
  it("AC1: the form marks author_name required, renders Featured + Trending toggles + a homepage_rank input, and has NO homepage_section control anywhere [api/test/article-display-options.test.ts] L2_AUTO_DISAMBIGUATION:T11-AC1:RC-022", () => {
    // (a) author_name is a REQUIRED control. The `required` attribute follows
    //     the value="" on the same <input>, so native constraint validation
    //     blocks submit when empty.
    expect(newPage).toMatch(
      /<input[^>]*name="author_name"[^>]*\brequired\b[^>]*>/,
    );
    expect(editPage).toMatch(
      /<input[^>]*name="author_name"[^>]*\brequired\b[^>]*>/,
    );
    // The new-mode pre-fill default and the edit-mode stored value both
    // survive the required attribute (regression on T14d behaviour).
    expect(newPage).toContain('value="editor@kodigital.io"');
    expect(editPage).toContain('value="Jamie Reporter"');

    // (b) Featured + Trending toggles are present (DB columns / PATCH
    //     allow-list keys is_featured / is_trending — wire names unchanged).
    expect(newPage).toContain('name="is_featured" type="checkbox" value="1"');
    expect(newPage).toContain('name="is_trending" type="checkbox" value="1"');
    // edit mode reflects stored state: featured checked, trending unchecked.
    expect(editPage).toContain(
      'name="is_featured" type="checkbox" value="1" checked',
    );
    expect(editPage).toContain('name="is_trending" type="checkbox" value="1" />');

    // (c) a homepage_rank number input is present and round-trips the value.
    expect(newPage).toContain('name="homepage_rank" type="number"');
    expect(editPage).toContain('name="homepage_rank" type="number"');
    expect(editPage).toMatch(/name="homepage_rank"[^>]*value="3"/);

    // (d) NO homepage_section control anywhere — neither the old <select>
    //     control nor the wire key in the client submit body. Scan the WHOLE
    //     rendered page (form + inline script) in both modes.
    expect(newPage).not.toContain("homepage_section");
    expect(editPage).not.toContain("homepage_section");
    expect(newPage).not.toContain("article-homepage-section");
    expect(newPage).not.toContain(">Homepage section<");
  });

  it("AC1 integration: the author + Display Options controls live in the real editor form, not an orphaned fragment [api/test/article-display-options.test.ts]", () => {
    // Same page the handler serves carries the form shell AND the controls —
    // proves wiring through renderArticleForm (negative_fail guard: AC must
    // not pass on a detached snippet while the live form is broken).
    expect(newPage).toContain('id="article-form"');
    expect(newPage).toContain('name="author_name"');
    expect(newPage).toContain("Display Options");
    expect(newPage).toContain("Homepage rank");
    // The page must not regress to a placeholder shell.
    expect(newPage).not.toContain("Phase 1 admin shell");
  });
});
