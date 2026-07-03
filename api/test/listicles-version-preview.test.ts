// Listicles Phase 5 — §30.6 Article Version preview: full-page §30.2
// component order, rule-simulation via the REAL rules.ts semantics, forced
// candidates, and the per-page CTA-density readout from the §30.7 ledger.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import {
  choosePreviewCandidate,
  parsePreviewContext,
  versionPreviewChromeCss,
} from "../src/admin/listicles/version-preview";

// --- node:sqlite harness (repo pattern + transactional batch) ---------------

type SqliteStatement = {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};
type SqliteDb = {
  prepare(sql: string): SqliteStatement;
  close(): void;
  [method: string]: unknown;
};
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    const nodeRequire = createRequire(import.meta.url);
    const mod = nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
    return mod.DatabaseSync;
  } catch {
    try {
      const getBuiltin = (process as unknown as {
        getBuiltinModule?: (name: string) => unknown;
      }).getBuiltinModule;
      if (typeof getBuiltin === "function") {
        const mod = getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
        return mod.DatabaseSync;
      }
    } catch {
      /* fall through */
    }
    return null;
  }
}

function runSql(sdb: SqliteDb, sql: string): void {
  (sdb["exec"] as (s: string) => void)(sql);
}

function d1FromSqlite(sdb: SqliteDb): D1Database {
  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          binds = a;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          const r = sdb.prepare(sql).get(...binds);
          return (r ?? null) as T | null;
        },
        async all<T = unknown>() {
          const rows = sdb.prepare(sql).all(...binds);
          return { results: rows as T[], success: true, meta: {} };
        },
        async run() {
          sdb.prepare(sql).run(...binds);
          return { success: true, meta: {} };
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      const results: unknown[] = [];
      try {
        for (const statement of statements) {
          results.push(await statement.run());
        }
        runSql(sdb, "COMMIT");
      } catch (err) {
        runSql(sdb, "ROLLBACK");
        throw err;
      }
      return results;
    },
  } as unknown as D1Database;
  return db;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

function createListiclesDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, storage_key TEXT);",
  );
  runSql(sdb, readFileSync(join(TEST_DIR, "../migrations/0032_listicles_core.sql"), "utf8"));
  runSql(sdb, readFileSync(join(TEST_DIR, "../migrations/0033_listicles_analytics_mirror.sql"), "utf8"));
  sdb.prepare("INSERT INTO sites (id, name) VALUES (?, ?)").run("st_test", "Preview Site");
  return sdb;
}

function buildEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
  };
}

function jsonInit(method: string, body?: unknown): RequestInit {
  if (body === undefined) return { method };
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

interface Harness {
  sdb: SqliteDb;
  env: Env;
}

function newHarness(): Harness {
  const ctor = DatabaseSync as DatabaseSyncCtor;
  const sdb = createListiclesDb(ctor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb)) };
}

// Seed an OFFER + a RICH section through the REAL sections API so the §30.7
// link-instance LEDGER rows exist (they are the §30.6 CTA-density source):
// clickable headline (1) + a 2-button choice group (2) + a final CTA (1) = 4.
async function seedRichSection(h: Harness, name: string): Promise<number> {
  const offerRes = await admin.request(
    "/api/admin/listicles/offers",
    jsonInit("POST", {
      offer_name: `Offer for ${name}`,
      provider: "prov",
      activity: "lead",
      vertical: "finance",
      conversion_tracking_method: "browser_side_pixel",
      offer_url_template: "https://x.example/c?cid={click_id}",
      payout_method: "offsite",
    }),
    h.env,
  );
  expect(offerRes.status).toBe(201);
  const offer = ((await offerRes.json()) as { offer: { id: number } }).offer;

  const sectionRes = await admin.request(
    "/api/admin/listicles/sections",
    jsonInit("POST", {
      section_name: name,
      headline_text: `${name} headline`,
      headline_offer_id: offer.id,
      content_json: {
        blocks: [
          { type: "paragraph", data: { text: "Some copy." } },
          {
            type: "choice_button_group",
            data: {
              layout_binding: "default.choiceButtonGroup",
              items: [
                { text: "Yes", offer_id: offer.id },
                { text: "No", offer_id: offer.id },
              ],
            },
          },
          {
            type: "final_text_cta",
            data: { text: "See if you qualify", offer_id: offer.id, layout_binding: "default.textCta" },
          },
        ],
      },
    }),
    h.env,
  );
  expect(sectionRes.status).toBe(201);
  const section = ((await sectionRes.json()) as { section: { id: number } }).section;
  return section.id;
}

// A PLAIN section (no governed links → CTA density 0).
function seedPlainSection(h: Harness, publicId: string, name: string): number {
  h.sdb
    .prepare(
      "INSERT INTO listicle_sections (public_id, section_name, headline_text, content_json) VALUES (?, ?, ?, '{\"blocks\":[{\"type\":\"paragraph\",\"data\":{\"text\":\"plain\"}}]}')",
    )
    .run(publicId, name, `${name} headline`);
  const row = h.sdb
    .prepare("SELECT id FROM listicle_sections WHERE public_id = ?")
    .get(publicId) as { id: number };
  return row.id;
}

async function seedArticle(h: Harness): Promise<{ articleId: string; versionId: string }> {
  const res = await admin.request(
    "/api/admin/listicles/articles",
    jsonInit("POST", {
      site_id: "st_test",
      article_name: "Preview Article",
      slug: "preview-article",
      headline: "Preview Headline",
      intro_paragraph: "First paragraph.\n\nSecond paragraph.",
      hero_media_url: "https://img.example/hero.jpg",
      layout_style_id: "default",
    }),
    h.env,
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as {
    article: { public_id: string };
    version: { public_id: string };
  };
  return { articleId: body.article.public_id, versionId: body.version.public_id };
}

interface PreviewPageOut {
  page_index: number;
  selection_mode: string;
  chosen_candidate_id: string | null;
  chosen_section_id: number | null;
  chosen_section_name: string;
  selection_reason: string;
  rule_id: string | null;
  cta_density: number;
}

async function callPreview(
  h: Harness,
  versionId: string,
  body: Record<string, unknown>,
): Promise<{ html: string; pages: PreviewPageOut[] }> {
  const res = await admin.request(
    `/api/admin/listicles/versions/${versionId}/preview`,
    jsonInit("POST", body),
    h.env,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { html: string; pages: PreviewPageOut[] };
}

describeDb("POST /versions/:id/preview (§30.6)", () => {
  it("renders the FULL page in the §30.2 component order with token-derived chrome", async () => {
    const h = newHarness();
    const seed = await seedArticle(h);
    const richId = await seedRichSection(h, "Rich Section");

    const put = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}`,
      jsonInit("PUT", {
        headline: "Preview Headline",
        intro_paragraph: "First paragraph.\n\nSecond paragraph.",
        hero_media_url: "https://img.example/hero.jpg",
        layout_style_id: "default",
        byline: {
          enabled: true,
          author_name: "Sarah Mitchell",
          label: "Advertorial",
          updated_label: "Updated:",
          updated_date: "June 2026",
        },
        pages: [
          { page_index: 0, selection_mode: "single", candidates: [{ section_id: richId, label: "A" }] },
        ],
      }),
      h.env,
    );
    expect(put.status).toBe(200);

    const { html } = await callPreview(h, seed.versionId, {});
    // §30.2 order: header → title → byline → hero → intro → sections →
    // legal → footer (indexOf strictly increasing).
    const markers = [
      'class="lst-header"',
      'class="lst-logo-slot"',
      'class="lst-disclosure-trigger"',
      'class="lst-title"',
      'class="lst-byline"',
      'class="lst-hero"',
      'class="lst-intro"',
      'class="lst-section"',
      'class="lst-legal"',
      'class="lst-footer"',
    ];
    let last = -1;
    for (const marker of markers) {
      const at = html.indexOf(marker);
      expect(at, `§30.2 order: ${marker} present after previous marker`).toBeGreaterThan(last);
      last = at;
    }
    // Content accuracy: headline, byline text, intro paragraphs, the
    // governed section markup, the site name in the logo slot.
    expect(html).toContain("Preview Headline");
    expect(html).toContain("Advertorial · By Sarah Mitchell · Updated: June 2026");
    expect(html).toContain("<p>First paragraph.</p>");
    expect(html).toContain("<p>Second paragraph.</p>");
    expect(html).toContain("Preview Site");
    expect(html).toContain('class="lst-choice-btn"');
    expect(html).toContain('data-link-role="final_text_cta"');
    // Token-derived chrome: red 64px header + byline avatar sizing rules.
    expect(html).toContain("background-color:#ce2e35");
    expect(html).toContain("height:64px");
    expect(html).toContain('[data-layout="default"] .lst-byline');
    // Sandbox-safety: srcdoc consumers get a full standalone document.
    expect(html).toMatch(/^<!DOCTYPE html>/);
  });

  it("simulates rule audiences via the REAL evaluation semantics + forces candidates + reports CTA density from the ledger", async () => {
    const h = newHarness();
    const seed = await seedArticle(h);
    const richId = await seedRichSection(h, "Section C"); // 4 governed links
    const plainD = seedPlainSection(h, "sec_d", "Section D");
    const plainE = seedPlainSection(h, "sec_e", "Section E");

    // The §26 rule example verbatim: CA+mobile → C, newsbreak → D, fallback → E.
    const put = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}`,
      jsonInit("PUT", {
        headline: "Preview Headline",
        intro_paragraph: "Intro.",
        hero_media_url: "https://img.example/hero.jpg",
        layout_style_id: "default",
        pages: [
          {
            page_index: 0,
            selection_mode: "rule_based",
            candidates: [
              {
                section_id: richId,
                label: "C",
                rule: { priority: 1, conditions: { sets: { state: ["CA"], device: ["mobile"] } } },
              },
              {
                section_id: plainD,
                label: "D",
                rule: { priority: 2, conditions: { sets: { traffic_source: ["newsbreak"] } } },
              },
              { section_id: plainE, label: "E", is_fallback: true },
            ],
          },
        ],
      }),
      h.env,
    );
    expect(put.status).toBe(200);

    // CA + mobile → C (rule_match) with the ledger CTA density (4).
    const ca = await callPreview(h, seed.versionId, { ctx: { state: "CA", device: "mobile" } });
    expect(ca.pages[0]?.chosen_section_name).toBe("Section C");
    expect(ca.pages[0]?.selection_reason).toBe("rule_match");
    expect(ca.pages[0]?.rule_id).toMatch(/^rule_/);
    expect(ca.pages[0]?.cta_density).toBe(4);
    expect(ca.html).toContain('data-cta-density="4"');

    // CA on desktop does NOT match C (device dim unsatisfied) → newsbreak? no
    // → fallback E.
    const caDesktop = await callPreview(h, seed.versionId, { ctx: { state: "CA", device: "desktop" } });
    expect(caDesktop.pages[0]?.chosen_section_name).toBe("Section E");
    expect(caDesktop.pages[0]?.selection_reason).toBe("fallback");
    expect(caDesktop.pages[0]?.cta_density).toBe(0);

    // newsbreak traffic → D (rule_match).
    const nb = await callPreview(h, seed.versionId, { ctx: { traffic_source: "newsbreak" } });
    expect(nb.pages[0]?.chosen_section_name).toBe("Section D");
    expect(nb.pages[0]?.selection_reason).toBe("rule_match");

    // No context → fallback E.
    const none = await callPreview(h, seed.versionId, {});
    expect(none.pages[0]?.chosen_section_name).toBe("Section E");
    expect(none.pages[0]?.selection_reason).toBe("fallback");

    // Forcing a candidate wins over the rules (§30.6 "force Page candidate").
    const structure = await admin.request(
      `/api/admin/listicles/articles/${seed.articleId}/structure`,
      jsonInit("GET"),
      h.env,
    );
    const structureBody = (await structure.json()) as {
      versions: Array<{
        public_id: string;
        pages: Array<{ page_index: number; candidates: Array<{ public_id: string; label: string }> }>;
      }>;
    };
    const cands = structureBody.versions[0]?.pages[0]?.candidates ?? [];
    const dCand = cands.find((cand) => cand.label === "D");
    expect(dCand).toBeTruthy();
    const forced = await callPreview(h, seed.versionId, {
      ctx: { state: "CA", device: "mobile" },
      force_candidates: { "0": dCand?.public_id },
    });
    expect(forced.pages[0]?.chosen_section_name).toBe("Section D");
    expect(forced.pages[0]?.selection_reason).toBe("forced");
  });

  it("previews LIVE builder state (version override) without requiring a save; ab_test unforced shows the first candidate honestly", async () => {
    const h = newHarness();
    const seed = await seedArticle(h);
    const richId = await seedRichSection(h, "Live Section");
    const plain = seedPlainSection(h, "sec_live_b", "Plain B");

    // No PUT — the stored version has NO pages; the override carries the
    // mid-edit state (lenient parse, §30.6 preview never blocks).
    const out = await callPreview(h, seed.versionId, {
      version: {
        headline: "Live headline override",
        intro_paragraph: "Live intro",
        pages: [
          {
            page_index: 0,
            selection_mode: "ab_test",
            candidates: [
              { section_id: richId, label: "A", traffic_allocation: 70 },
              { section_id: plain, label: "B", traffic_allocation: 30 },
            ],
          },
        ],
      },
    });
    expect(out.html).toContain("Live headline override");
    expect(out.pages[0]?.selection_mode).toBe("ab_test");
    expect(out.pages[0]?.chosen_section_name).toBe("Live Section");
    // The preview NEVER pretends a sticky hash ran (§15.7 reasons are for
    // tracked runtime picks — Phase 7); it says what it did.
    expect(out.pages[0]?.selection_reason).toBe("ab_first_preview");
    expect(out.pages[0]?.cta_density).toBe(4);

    const empty = await callPreview(h, seed.versionId, {
      version: { headline: "x", intro_paragraph: "y", pages: [] },
    });
    expect(empty.pages).toHaveLength(0);
  });
});

describe("preview pure helpers", () => {
  it("parsePreviewContext keeps only §15.4 set dims + a valid hour", () => {
    const ctx = parsePreviewContext({
      state: "CA",
      device: "mobile",
      bogus_dim: "x",
      hour: 13,
      country: "  ",
    });
    expect(ctx).toEqual({ state: "CA", device: "mobile", hour: 13 });
    expect(parsePreviewContext({ hour: 99 })).toEqual({});
    expect(parsePreviewContext(null)).toEqual({});
  });

  it("choosePreviewCandidate: priority asc first-match, fallback, forced, single_default", () => {
    const page = {
      page_index: 0,
      selection_mode: "rule_based",
      ab_test_id: null,
      candidates: [
        {
          public_id: "cand_c",
          section_id: 1,
          label: "C",
          is_fallback: false,
          rule: { public_id: "rule_c", priority: 1, conditions: { sets: { state: ["CA"] } } },
        },
        {
          public_id: "cand_d",
          section_id: 2,
          label: "D",
          is_fallback: false,
          rule: {
            public_id: "rule_d",
            priority: 2,
            conditions: { sets: { traffic_source: ["newsbreak"] } },
          },
        },
        { public_id: "cand_e", section_id: 3, label: "E", is_fallback: true, rule: null },
      ],
    };
    const match = choosePreviewCandidate(page, { state: "CA" }, null);
    expect(match?.candidate.label).toBe("C");
    expect(match?.reason).toBe("rule_match");
    expect(match?.rule_id).toBe("rule_c");

    const fallback = choosePreviewCandidate(page, { state: "TX" }, null);
    expect(fallback?.candidate.label).toBe("E");
    expect(fallback?.reason).toBe("fallback");

    const forced = choosePreviewCandidate(page, { state: "CA" }, "cand_d");
    expect(forced?.candidate.label).toBe("D");
    expect(forced?.reason).toBe("forced");

    const single = choosePreviewCandidate(
      { page_index: 0, selection_mode: "single", ab_test_id: null, candidates: [page.candidates[0]!] },
      {},
      null,
    );
    expect(single?.reason).toBe("single_default");
  });

  it("versionPreviewChromeCss derives the §30.1 chrome from tokens (no hand-written measured values)", () => {
    const css = versionPreviewChromeCss();
    expect(css).toContain('[data-layout="default"] .lst-header{height:64px');
    expect(css).toContain("background-color:#ce2e35");
    expect(css).toContain("border-bottom:1px solid #f4d1d3");
    // byline: 31px avatar, 16px gap, 12px bold #4b5360 (§30.2).
    expect(css).toContain("width:31px");
    expect(css).toContain("gap:16px");
    expect(css).toContain("font-size:12px");
    expect(css).toContain("color:#4b5360");
    // headline mobile override lands in the mobile block (24px/32px — the
    // MEASURED 390px variant; the provisional 32px/39px was corrected by the
    // 2026-07-03 capture).
    expect(css).toContain("@media (max-width: 767px)");
    expect(css).toContain("font-size:24px");
  });
});
