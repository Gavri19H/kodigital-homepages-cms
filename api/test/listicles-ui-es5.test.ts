// Listicles Phase 3 — every inline admin <script> on the new pages is ES5
// (design contract §25 "ES5-only inline scripts").
//
// Two complementary mechanisms, mirroring the repo's existing gates:
//   1. admin-layout-shell.test.ts style: script-extraction + zero
//      arrow/const/let/async/await/template-literal assertions.
//   2. admin-inline-scripts-parse.test.ts style: parse the EMITTED bytes
//      with `node --check` (pure syntax parse) so a server-side template
//      escape bug cannot ship a client-side SyntaxError.
//
// The templates are pure functions, so pages render from fixture DTOs with
// no DB. Both populated and empty variants are exercised (different rows =>
// different emitted markup).

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listiclesOffersPage, type OffersPageProps } from "../src/admin/listicles/ui-offers";
import {
  listiclesSectionsPage,
  listiclesArticlesPage,
  type SectionsPageProps,
  type ArticlesPageProps,
} from "../src/admin/listicles/ui-lists";
import { LST_SHARED_SCRIPT, resolveTimeframe } from "../src/admin/listicles/ui-shared";
import type { OfferRow } from "../src/admin/listicles/offers-handlers";

const timeframe = resolveTimeframe("30d");

const paging = { page: 1, page_size: 25, total: 1, has_next: false, has_prev: false };
const emptyPaging = { page: 1, page_size: 25, total: 0, has_next: false, has_prev: false };

const offerFixture: OfferRow = {
  id: 7,
  public_id: "off_fixture01",
  offer_name: "Fixture Offer <&>",
  provider: "prov",
  activity: "lead",
  vertical: "finance",
  tag: "t1",
  conversion_tracking_method: "s2s_postback",
  offer_url_template: "https://x.example/c?cid={click_id}",
  payout_method: "in_site",
  payout_currency: "USD",
  payout_value: 12.5,
  cap_enabled: 1,
  cap_amount: 100,
  cap_timezone: "UTC",
  cap_count_by: "clicks",
  cap_fallback_offer_id: null,
  cap_fallback_url: "/fallback",
  status: "active",
  created_by: null,
  created_at: 1700000000,
  updated_at: 1700000000,
};

const offersProps: OffersPageProps = {
  offers: [offerFixture],
  paging,
  filters: { search: "", provider: "", vertical: "", activity: "", status: "", range: "30d" },
  filterOptions: { providers: ["prov"], verticals: ["finance"], activities: ["lead"] },
  timeframe,
  loadError: null,
};

const sectionsProps: SectionsPageProps = {
  sections: [
    {
      id: 3,
      public_id: "sec_fixture01",
      section_name: "Fixture Section",
      status: "active",
      updated_at: 1700000000,
      offers_count: 2,
      articles_using: 1,
    },
  ],
  paging,
  filters: { search: "", status: "", range: "30d" },
  timeframe,
  loadError: null,
};

const articlesProps: ArticlesPageProps = {
  articles: [
    {
      id: 4,
      public_id: "art_fixture01",
      article_name: "Fixture Article",
      slug: "fixture-article",
      status: "draft",
      version_count: 1,
      experiment_status: null,
    },
  ],
  paging,
  sites: [{ id: "st_a", name: "Site A" }],
  selectedSiteId: "st_a",
  range: "30d",
  timeframe,
  loadError: null,
};

const PAGES: ReadonlyArray<[string, string]> = [
  ["offers", listiclesOffersPage(offersProps, { userEmail: "a@b.c" })],
  [
    "offers-empty",
    listiclesOffersPage(
      { ...offersProps, offers: [], paging: emptyPaging, loadError: "boom" },
      {},
    ),
  ],
  ["sections", listiclesSectionsPage(sectionsProps, {})],
  [
    "sections-empty",
    listiclesSectionsPage({ ...sectionsProps, sections: [], paging: emptyPaging }, {}),
  ],
  ["articles", listiclesArticlesPage(articlesProps, {})],
  [
    "articles-gated",
    listiclesArticlesPage(
      { ...articlesProps, articles: [], paging: emptyPaging, sites: [], selectedSiteId: null },
      {},
    ),
  ],
];

const SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

function extractScripts(html: string): string[] {
  const blocks: string[] = [];
  for (const match of html.matchAll(SCRIPT_RE)) {
    blocks.push(match[1] ?? "");
  }
  return blocks;
}

describe("listicles admin pages — ES5-only inline scripts (§25)", () => {
  for (const [label, html] of PAGES) {
    it(`${label}: every inline <script> block is ES5 (no arrow/const/let/async/await/backtick)`, () => {
      const scripts = extractScripts(html);
      expect(scripts.length, `${label} must ship at least one inline script block`).toBeGreaterThan(0);
      for (const script of scripts) {
        expect(script).not.toMatch(/=>/);
        expect(script).not.toMatch(/\bconst\b/);
        expect(script).not.toMatch(/\blet\b/);
        expect(script).not.toMatch(/\basync\b/);
        expect(script).not.toMatch(/\bawait\b/);
        expect(script).not.toContain("`");
      }
    });
  }

  it("the shared hydration script atom is ES5 and self-contained", () => {
    expect(LST_SHARED_SCRIPT).not.toMatch(/=>/);
    expect(LST_SHARED_SCRIPT).not.toMatch(/\bconst\b/);
    expect(LST_SHARED_SCRIPT).not.toMatch(/\blet\b/);
    expect(LST_SHARED_SCRIPT).toContain("window.lstUi");
  });
});

// --- node --check parse gate (admin-inline-scripts-parse mechanism) ---------

const scratchDir = mkdtempSync(join(tmpdir(), "listicles-script-parse-"));
let fileSeq = 0;

function parseError(label: string, source: string): string | null {
  const file = join(scratchDir, `${++fileSeq}-${label.replace(/[^\w-]/g, "_")}.js`);
  writeFileSync(file, source, "utf-8");
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    return null;
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? String(err);
    return `${label}: ${stderr.split("\n").slice(0, 5).join("\n")}`;
  }
}

describe("listicles admin pages — emitted inline scripts parse (node --check)", () => {
  for (const [label, html] of PAGES) {
    it(`${label}: every emitted inline <script> parses as standalone JavaScript`, () => {
      const scripts = extractScripts(html);
      const errors: string[] = [];
      scripts.forEach((script, i) => {
        const err = parseError(`${label}-script${i + 1}`, script);
        if (err) errors.push(err);
      });
      expect(errors, errors.join("\n\n")).toEqual([]);
    });
  }
});
