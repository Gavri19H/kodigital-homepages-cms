// Listicles Phase 4 — the Section save pipeline over REAL sqlite:
// validate (§23 + §30.5 shapes) → verify offers → resolve link instances →
// ENRICH content_json (every governed element gets its lnk_… id; offer refs
// canonicalize to off_… public ids) → render content_html through the
// LISTICLE renderers → rebuild the link graph — all in ONE batch. Plus the
// §30.6 preview endpoint and the §23 governed-grammar rejections.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

// --- node:sqlite harness (repo pattern) --------------------------------------

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
    return (nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
    try {
      const getBuiltin = (process as unknown as {
        getBuiltinModule?: (name: string) => unknown;
      }).getBuiltinModule;
      if (typeof getBuiltin === "function") {
        return (getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
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
          return (sdb.prepare(sql).get(...binds) ?? null) as T | null;
        },
        async all<T = unknown>() {
          return { results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} };
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
        for (const statement of statements) results.push(await statement.run());
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

function createDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
  );
  runSql(sdb, readFileSync(join(TEST_DIR, "../migrations/0032_listicles_core.sql"), "utf8"));
  runSql(sdb, readFileSync(join(TEST_DIR, "../migrations/0033_listicles_analytics_mirror.sql"), "utf8"));
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

function newHarness(): { sdb: SqliteDb; env: Env } {
  const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb)) };
}

function seedOffer(sdb: SqliteDb, publicId: string, name: string): number {
  sdb
    .prepare(
      `INSERT INTO listicle_offers
         (public_id, offer_name, provider, activity, vertical,
          conversion_tracking_method, offer_url_template, payout_method, status)
       VALUES (?, ?, 'prov', 'lead', 'pets', 's2s_postback',
               'https://t.example/c?c={click_id}', 'offsite', 'active')`,
    )
    .run(publicId, name);
  return (sdb.prepare("SELECT id FROM listicle_offers WHERE public_id = ?").get(publicId) as { id: number }).id;
}

interface StoredSection {
  section: {
    id: number;
    public_id: string;
    content_json: string;
    content_html: string;
    content_version: number;
  };
}

interface ContentDoc {
  blocks: Array<{ id?: string; type: string; data: Record<string, unknown> }>;
}

function phase4Blocks(): unknown[] {
  return [
    { id: "h1", type: "heading", data: { level: 2, text: "1. Top pick", offer_id: "off_head0001", layout_binding: "default.sectionHeading" } },
    { id: "p1", type: "paragraph", data: { text: "Copy", html: 'Try <a data-offer="off_inl00001">this</a> now <span data-lst-color="brand">red</span>' } },
    {
      id: "g1",
      type: "choice_button_group",
      data: {
        layout_binding: "default.choiceButtonGroup",
        prompt: "Where do you live?",
        items: [
          { id: "i1", link_instance_id: "", text: "CA", offer_id: "off_choice001", style_id: "reference-choice-button", layout_binding: "default.choiceButton" },
          { id: "i2", link_instance_id: "", text: "TX", offer_id: "off_choice001", style_id: "reference-choice-button", layout_binding: "default.choiceButton", analytics_label: "tx" },
          { id: "i3", link_instance_id: "", text: "NY", offer_id: "off_choice002", style_id: "reference-choice-button", layout_binding: "default.choiceButton" },
          { id: "i4", link_instance_id: "", text: "FL", offer_id: "off_choice001", style_id: "reference-choice-button", layout_binding: "default.choiceButton" },
          { id: "i5", link_instance_id: "", text: "WA", offer_id: "off_choice001", style_id: "reference-choice-button", layout_binding: "default.choiceButton" },
          { id: "i6", link_instance_id: "", text: "Other", offer_id: "off_choice002", style_id: "reference-choice-button", layout_binding: "default.choiceButton" },
        ],
      },
    },
    { id: "l1", type: "list", data: { style: "unordered", marker: "check", items: ["No fees", "Fast"], layout_binding: "default.listBlock" } },
    { id: "l2", type: "list", data: { style: "unordered", marker: "emoji", emoji: "⭐", items: ["Shiny"], layout_binding: "default.listBlock" } },
    { id: "img1", type: "linked_image", data: { image_url: "/media/pic.jpg", alt: "A pick", offer_id: "off_img00001", link_instance_id: "", layout_binding: "default.sectionImage" } },
    { id: "cta1", type: "final_text_cta", data: { link_instance_id: "", text: "See if you qualify", offer_id: "off_cta00001", layout_binding: "default.textCta" } },
    { id: "sp1", type: "spacer", data: { layout_binding: "default.sectionWrapper" } },
  ];
}

function seedPhase4Offers(sdb: SqliteDb): Record<string, number> {
  return {
    off_head0001: seedOffer(sdb, "off_head0001", "Headline Offer"),
    off_inl00001: seedOffer(sdb, "off_inl00001", "Inline Offer"),
    off_choice001: seedOffer(sdb, "off_choice001", "Choice One"),
    off_choice002: seedOffer(sdb, "off_choice002", "Choice Two"),
    off_img00001: seedOffer(sdb, "off_img00001", "Image Offer"),
    off_cta00001: seedOffer(sdb, "off_cta00001", "CTA Offer"),
  };
}

describeDb("Phase-4 section save — enrichment + listicle render (§30.5/§30.9)", () => {
  it("POST stores enriched content_json (every governed element has a lnk_… id) and the governed content_html", async () => {
    const { sdb, env } = newHarness();
    seedPhase4Offers(sdb);

    const res = await admin.request(
      "/api/admin/listicles/sections",
      jsonInit("POST", {
        section_name: "Phase 4 rich section",
        headline_text: "The very best",
        content_json: { blocks: phase4Blocks() },
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as StoredSection;
    const doc = JSON.parse(body.section.content_json) as ContentDoc;

    // §30.9: every governed element carries its link_instance_id.
    const heading = doc.blocks[0]!.data;
    expect(String(heading.link_instance_id)).toMatch(/^lnk_/);
    const para = doc.blocks[1]!.data;
    expect(String(para.html)).toMatch(/data-link-instance="lnk_/);
    const items = doc.blocks[2]!.data.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(6);
    for (const item of items) {
      expect(String(item.link_instance_id)).toMatch(/^lnk_/);
    }
    expect(String(doc.blocks[5]!.data.link_instance_id)).toMatch(/^lnk_/);
    expect(String(doc.blocks[6]!.data.link_instance_id)).toMatch(/^lnk_/);

    // content_html renders the GOVERNED grammar: attrs + rel, no href/lc.
    const html = body.section.content_html;
    expect(html).toContain('data-link-role="choice_button"');
    expect(html).toContain('data-link-role="final_text_cta"');
    expect(html).toContain('data-link-role="linked_image"');
    expect(html).toContain('data-link-role="inline"');
    expect(html).toContain('rel="sponsored nofollow noopener"');
    expect(html).toContain('data-marker="check"');
    expect(html).toContain("⭐");
    expect(html).toContain('data-lst-color="brand"');
    expect(html).not.toMatch(/\bhref=/);
    expect(html).not.toContain("/lc/");
    expect((html.match(/class="lst-choice-btn"/g) ?? []).length).toBe(6);

    // The DB link graph counts every governed element:
    // heading(inline) + para(inline) + 6 choice + image + cta = 10.
    const rows = sdb
      .prepare("SELECT link_role, COUNT(*) AS n FROM listicle_section_link_instances WHERE section_id = ? GROUP BY link_role ORDER BY link_role")
      .all(body.section.id) as Array<{ link_role: string; n: number }>;
    const byRole = new Map(rows.map((r) => [r.link_role, r.n]));
    expect(byRole.get("choice_button")).toBe(6);
    expect(byRole.get("inline")).toBe(2);
    expect(byRole.get("linked_image")).toBe(1);
    expect(byRole.get("final_text_cta")).toBe(1);
  });

  it("round-trip: re-PATCHing the enriched document keeps lnk_ ids AND content_version stable", async () => {
    const { sdb, env } = newHarness();
    seedPhase4Offers(sdb);
    const created = await admin.request(
      "/api/admin/listicles/sections",
      jsonInit("POST", {
        section_name: "Round trip",
        headline_text: "H",
        content_json: { blocks: phase4Blocks() },
      }),
      env,
    );
    const first = ((await created.json()) as StoredSection).section;

    // The client reloads the enriched doc and saves it back unchanged.
    const patched = await admin.request(
      `/api/admin/listicles/sections/${first.public_id}`,
      jsonInit("PATCH", { content_json: JSON.parse(first.content_json) }),
      env,
    );
    expect(patched.status).toBe(200);
    const second = ((await patched.json()) as StoredSection).section;
    expect(second.content_json).toBe(first.content_json); // byte-stable
    expect(second.content_version).toBe(first.content_version); // no-op save
  });

  it("§23/§30.5 rejections: unbound choice item · ungoverned anchor · unknown colour token · non-curated emoji · unknown block type", async () => {
    const { sdb, env } = newHarness();
    seedPhase4Offers(sdb);
    const post = (blocks: unknown[]): Request =>
      new Request("http://local/api/admin/listicles/sections", {
        ...jsonInit("POST", {
          section_name: "s",
          headline_text: "h",
          content_json: { blocks },
        }),
      } as RequestInit);

    const unbound = await admin.request(
      post([
        { id: "g", type: "choice_button_group", data: { items: [{ id: "i", text: "A", offer_id: "" }] } },
      ]),
      {},
      env,
    );
    expect(unbound.status).toBe(400);
    const unboundBody = (await unbound.json()) as { fields: Record<string, string> };
    expect(unboundBody.fields["content.blocks[0]"]).toContain("must reference an Offer");

    const ungoverned = await admin.request(
      post([{ id: "p", type: "paragraph", data: { html: "<a>bare link</a>" } }]),
      {},
      env,
    );
    expect(ungoverned.status).toBe(400);
    expect(((await ungoverned.json()) as { fields: Record<string, string> }).fields["content.blocks[0]"]).toContain(
      "Offer modal",
    );

    const badColor = await admin.request(
      post([{ id: "p", type: "paragraph", data: { html: '<span data-lst-color="hotpink">x</span>' } }]),
      {},
      env,
    );
    expect(badColor.status).toBe(400);
    expect(((await badColor.json()) as { fields: Record<string, string> }).fields["content.blocks[0]"]).toContain(
      "curated",
    );

    const badEmoji = await admin.request(
      post([{ id: "l", type: "list", data: { marker: "emoji", emoji: "🦖", items: ["x"] } }]),
      {},
      env,
    );
    expect(badEmoji.status).toBe(400);
    expect(((await badEmoji.json()) as { fields: Record<string, string> }).fields["content.blocks[0]"]).toContain(
      "curated emoji",
    );

    const badType = await admin.request(
      post([{ id: "x", type: "html", data: { html: "<p>raw</p>" } }]),
      {},
      env,
    );
    expect(badType.status).toBe(400);
    expect(((await badType.json()) as { fields: Record<string, string> }).fields["content.blocks[0]"]).toContain(
      "not a listicle content block",
    );
  });

  it("POST /sections/preview renders the token-styled document (lenient mid-edit)", async () => {
    const { env } = newHarness();
    const res = await admin.request(
      "/api/admin/listicles/sections/preview",
      jsonInit("POST", {
        headline_text: "Preview headline",
        headline_offer_id: null,
        content_json: {
          blocks: [
            { id: "p", type: "paragraph", data: { text: "Body" } },
            {
              id: "g",
              type: "choice_button_group",
              data: {
                prompt: "Q",
                // Mid-edit: one bound + one UNBOUND item — preview still renders.
                items: [
                  { id: "a", text: "Bound", offer_id: "off_whatever01", style_id: "reference-choice-button" },
                  { id: "b", text: "Unbound", offer_id: "" },
                ],
              },
            },
          ],
        },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const { html } = (await res.json()) as { html: string };
    expect(html).toContain('data-layout="default"');
    expect(html).toContain("lst-section");
    expect(html).toContain("Preview headline");
    expect(html).toContain("Bound");
    // Token-derived stylesheet (the §30.1 values ride the <style> block).
    expect(html).toContain("max-width:968px");
    expect(html).toContain("border-radius:6px");
    // Only the malformed-JSON case rejects.
    const bad = await admin.request(
      "/api/admin/listicles/sections/preview",
      jsonInit("POST", { content_json: "{not json" }),
      env,
    );
    expect(bad.status).toBe(400);
  });
});
