// X06 "SEO Fixes", owner decision Q4: funnel pages (/lg/…) are ad landing
// pages. They are kept out of Google (<meta name="robots" content="noindex">)
// and the browser tab shows the site's public name, never the internal funnel
// name ("Business Loans Match", "Home Security Solutions | Short"). Nothing
// else on the funnel changes: the page body, the config the engine reads and
// the auction/offer/Meta path are untouched. The funnel page version moved
// 14 → 15 so cached funnel pages refresh.
//
// Drives the REAL chain: admin API creates + activates a funnel, then the
// public GET /lg/<slug> serves the shell (the legacy byte pin in
// leadgen-frame-legacy-pin.test.ts proves the rest of the bytes).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import app from "../src/index";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { LEADGEN_TEMPLATE_VERSION } from "../src/cache/cache-keys";
import { funnelTabTitle } from "../src/public/leadgen/serve";
import type { ResolvedActivatedFunnel } from "../src/public/leadgen/resolver";
import {
  API_ROOT,
  buildLeadgenEnv,
  createLeadgenDb,
  d1FromSqlite,
  loadDatabaseSync,
  type SqliteDb,
} from "./helpers/leadgen-analytics-harness";

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;
const API = "/api/admin/leadgen";
const HOST = "one.example.com";
const FUNNEL_NAME = "Business Loans Match | Short";

function exec(sdb: SqliteDb, sql: string): void {
  (sdb["exec"] as (s: string) => void)(sql);
}

function makeKv(): KVNamespace {
  const store = new Map<string, { value: string; metadata: unknown }>();
  return {
    async get(key: string) {
      return store.get(key)?.value ?? null;
    },
    async getWithMetadata(key: string) {
      const e = store.get(key);
      return e ? { value: e.value, metadata: e.metadata } : { value: null, metadata: null };
    },
    async put(key: string, value: string, opts?: { metadata?: unknown }) {
      store.set(key, { value, metadata: opts?.metadata ?? null });
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function seedSection(sdb: SqliteDb): number {
  const publicId = mintPublicId("section");
  const content = JSON.stringify({
    components: [{ type: "TwoButtonYesNo", question_id: "q1", question_key: "k", internal_field: "f", answer_type: "boolean" }],
  });
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, ?, 'quote_funnel', 'life', 'Headline', ?, 'button', 0, 'active')",
    )
    .run(publicId, `Section ${publicId.slice(-4)}`, content);
  return (sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number }).id;
}

async function harness(siteName: string | null): Promise<{ env: Env; sdb: SqliteDb }> {
  const sdb = createLeadgenDb(DatabaseSync!);
  exec(sdb, readFileSync(join(API_ROOT, "migrations", "0061_leadgen_routing_present_only_offer.sql"), "utf8"));
  exec(sdb, "CREATE TABLE site_settings (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, key TEXT NOT NULL, value TEXT NOT NULL);");
  if (siteName !== null) {
    sdb.prepare("INSERT INTO site_settings (site_id, key, value) VALUES ('site-1', 'site_name', ?)").run(siteName);
  }
  const env = buildLeadgenEnv(d1FromSqlite(sdb), makeKv(), { extra: { DEV_BYPASS_AUTH: "true" } });

  const createRes = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: FUNNEL_NAME, activity: "quote_funnel", verticals: ["life"] }),
    env,
  );
  expect(createRes.status, `create quote: ${await createRes.clone().text()}`).toBe(201);
  const quote = (await createRes.json()) as {
    id: number;
    public_id: string;
    funnels: Array<{ public_id: string; funnel_name?: string; variants: Array<{ public_id: string }> }>;
  };
  const variantId = quote.funnels[0]!.variants[0]!.public_id;
  const putRes = await admin.request(
    `${API}/variants/${variantId}`,
    jsonInit("PUT", { sections: [{ section_id: seedSection(sdb) }] }),
    env,
  );
  expect(putRes.status, `put sections: ${await putRes.clone().text()}`).toBe(200);
  const pagePublicId = mintPublicId("funnel_page");
  sdb.prepare("INSERT INTO leadgen_funnel_pages (public_id, quote_id, position, name) VALUES (?, ?, 0, NULL)").run(pagePublicId, quote.id);
  sdb
    .prepare(
      "INSERT INTO leadgen_funnel_variant_sections (quote_id, section_id, position, page_id) VALUES (?, ?, 0, (SELECT id FROM leadgen_funnel_pages WHERE public_id = ?))",
    )
    .run(quote.id, seedSection(sdb), pagePublicId);
  const actRes = await admin.request(
    `${API}/quotes/${quote.public_id}/activation/site-1`,
    jsonInit("PUT", { enabled: true, slug: "business-loans" }),
    env,
  );
  expect(actRes.status, `activate: ${await actRes.clone().text()}`).toBe(200);
  return { env, sdb };
}

async function shell(env: Env): Promise<{ html: string; head: string; body: string; res: Response }> {
  const res = await app.request(`http://${HOST}/lg/business-loans`, {}, env);
  expect(res.status, await res.clone().text()).toBe(200);
  const html = await res.text();
  const headEnd = html.indexOf("</head>");
  return { html, head: html.slice(0, headEnd), body: html.slice(headEnd), res };
}

function funnelNameOf(sdb: SqliteDb): string {
  return (sdb.prepare("SELECT funnel_name FROM leadgen_funnels LIMIT 1").get() as { funnel_name: string }).funnel_name;
}

describeDb("funnel page head (owner Q4)", () => {
  it("is kept out of Google: exactly one robots noindex tag in the head", async () => {
    const { env } = await harness("Money Lantern");
    const { head, body } = await shell(env);
    expect(head.match(/<meta name="robots"[^>]*>/g)).toEqual(['<meta name="robots" content="noindex">']);
    expect(body).not.toContain('name="robots"');
  });

  it("the tab title is the site's public name (escaped), and the internal funnel name is gone from the head", async () => {
    const { env, sdb } = await harness("Money & Lantern");
    const { head } = await shell(env);
    expect(head).toContain("<title>Money &amp; Lantern</title>");
    const internal = funnelNameOf(sdb);
    expect(internal.length).toBeGreaterThan(0);
    expect(head).not.toContain(`<title>${internal}`);
  });

  it("with no Site Name setting, the site's domain (never the funnel name)", async () => {
    const { env } = await harness(null);
    const { head } = await shell(env);
    expect(head).toContain(`<title>${HOST}</title>`);
  });

  it("the body carries the funnel's own identity and the head loads the deferred v16 runtime", async () => {
    const { env, sdb } = await harness("Money Lantern");
    const { head, body } = await shell(env);
    const config = /<script type="application\/json" id="lg-config">([\s\S]*?)<\/script>/.exec(body);
    expect(config).not.toBeNull();
    const parsed = JSON.parse(config![1]!) as { funnel_name?: string };
    // the config the engine reads (and analytics carries) keeps the internal name
    expect(JSON.stringify(parsed)).toContain(JSON.stringify(funnelNameOf(sdb)).slice(1, -1));
    expect(head.match(/<script src="\/lg\/runtime\/16\.js" defer onerror="[^"]+"><\/script>/g)).toHaveLength(1);
    expect(body).not.toContain('src="/lg/runtime/16.js"');
    expect(LEADGEN_TEMPLATE_VERSION).toBe(16);
  });

  it("the second request is served from the cache with the same head", async () => {
    const { env } = await harness("Money Lantern");
    const first = await shell(env);
    const second = await shell(env);
    expect(second.head).toBe(first.head);
  });
});

describe("funnelTabTitle fallbacks", () => {
  const base = { funnel: { funnel_name: "Internal Name" } } as unknown as ResolvedActivatedFunnel;
  it("site name → request host → funnel name (last resort only)", () => {
    expect(funnelTabTitle({ ...base, site_branding: { site_name: " Site " } } as unknown as ResolvedActivatedFunnel, "h.com")).toBe("Site");
    expect(funnelTabTitle({ ...base, site_branding: { site_name: "" } } as unknown as ResolvedActivatedFunnel, "h.com")).toBe("h.com");
    expect(funnelTabTitle(base, null)).toBe("Internal Name");
  });
});
