import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import admin from "../src/admin/router";
import { leadgenPublicChange } from "../src/edge/leadgen-change";
import { onPublicChange } from "../src/edge/public-change";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { invalidateOnQuoteActivation, invalidateOnVariantPublish } from "../src/public/leadgen/invalidate";
import { addSite, createDb, env as sqliteEnv, type SqliteDb } from "./helpers/x06-a2-sqlite";

vi.mock("../src/edge/public-change", () => ({ onPublicChange: vi.fn() }));

const siteA = "Site-A";
const siteB = "Site-B";
const siteC = "Site-C";
const ctx = {
  waitUntil(promise: Promise<unknown>) { background.push(promise); },
  passThroughOnException() {}, props: {}, exports: {},
};
let db: SqliteDb;
let env: Env;
let background: Promise<unknown>[];
let quote: ReturnType<typeof seedQuote>;

function seedFunnel(quoteId: number) {
  const funnelPublicId = mintPublicId("funnel");
  const funnelId = Number(db.prepare(`INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status)
    VALUES (?, ?, 'Life funnel', 'active')`).run(funnelPublicId, quoteId).lastInsertRowid);
  const variantId = Number(db.prepare(`INSERT INTO leadgen_funnel_variants (public_id, funnel_id, status)
    VALUES (?, ?, 'active')`).run(mintPublicId("funnel_variant"), funnelId).lastInsertRowid);
  return { funnelId, funnelPublicId, variantId };
}

function seedQuote() {
  const publicId = mintPublicId("quote");
  const id = Number(db.prepare(`INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json, status)
    VALUES (?, 'Life quote', 'quote_funnel', '["life"]', 'active')`).run(publicId).lastInsertRowid);
  const funnel = seedFunnel(id);
  db.prepare("UPDATE leadgen_quotes SET default_funnel_id = ? WHERE id = ?").run(funnel.funnelId, id);
  return { id, publicId, ...funnel };
}

function activate(site: string, id: number, slug: string | null, enabled = true) {
  db.prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, slug, enabled) VALUES (?, ?, ?, ?)")
    .run(site, id, slug, Number(enabled));
}

function seedSharedPage() {
  return Number(db.prepare("INSERT INTO leadgen_funnel_pages (public_id, quote_id, position, name) VALUES (?, ?, 0, 'Intro')")
    .run(mintPublicId("funnel_page"), quote.id).lastInsertRowid);
}

function seedSection(name: string) {
  const content = JSON.stringify({ components: [{ type: "TwoButtonYesNo", question_id: name,
    question_key: name, internal_field: name, answer_type: "boolean" }] });
  return Number(db.prepare(`INSERT INTO leadgen_sections
    (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, status)
    VALUES (?, ?, 'quote_funnel', 'life', ?, ?, 'button', 'active')`)
    .run(mintPublicId("section"), name, name, content).lastInsertRowid);
}

function seedExperiment(status: "draft" | "running") {
  return Number(db.prepare("INSERT INTO leadgen_funnel_ab_tests (public_id, funnel_id, name, status) VALUES (?, ?, 'Split', ?)")
    .run(mintPublicId("funnel_ab_test"), quote.funnelId, status).lastInsertRowid);
}

async function write(method: string, path: string, body?: unknown, context: typeof ctx | null = ctx) {
  const response = await admin.request("/api/admin/leadgen/" + path, {
    method, headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env, context ?? undefined);
  await Promise.all(background);
  return response;
}

async function expectStatus(response: Response, status: number) {
  expect(response.status, await response.clone().text()).toBe(status);
}

// Assert the complete call list, including negative scope and duplicate calls.
// Expected tags are independent of the tag builder used by the implementation.
function expectPurges(quotesBySite: Record<string, string[]>, context: typeof ctx | null = ctx) {
  const calls = vi.mocked(onPublicChange).mock.calls.map(([, receivedCtx, change]) => {
    expect(receivedCtx).toBe(context ?? undefined);
    expect(change.reason).toMatch(/\S/);
    return { siteId: change.siteId, tags: [...change.tags].sort() };
  });
  expect(calls).toHaveLength(Object.keys(quotesBySite).length);
  for (const [siteId, ids] of Object.entries(quotesBySite)) {
    const tags = ids.map(id => `quote:${siteId}:${id}`.toLowerCase()).sort();
    expect(calls).toContainEqual({ siteId, tags });
  }
}

function expectSharedQuote(context: typeof ctx | null = ctx) {
  expectPurges({ [siteA]: [quote.publicId], [siteB]: [quote.publicId] }, context);
}

beforeEach(() => {
  db = createDb();
  env = sqliteEnv(db);
  background = [];
  const cache = new Map<string, string>();
  Object.assign(env.CACHE, {
    async get(key: string) { return cache.get(key) ?? null; },
    async put(key: string, value: string) { cache.set(key, value); },
    async delete(key: string) { cache.delete(key); },
    async list({ prefix }: { prefix: string }) {
      return { keys: [...cache.keys()].filter(key => key.startsWith(prefix)).map(name => ({ name })), list_complete: true };
    },
  });
  for (const site of [siteA, siteB, siteC]) addSite(db, site, site, "health");
  quote = seedQuote();
  activate(siteA, quote.id, null);
  activate(siteB, quote.id, "life");
  activate(siteC, quote.id, "disabled", false);
  vi.mocked(onPublicChange).mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  await Promise.all(background);
  db.close();
  vi.restoreAllMocks();
});

describe("quote writes", () => {
  const createBody = { quote_name: "New quote", activity: "quote_funnel", verticals: ["life"] };

  it.each(["create", "duplicate"])("%s purges only the new quote's site if activated at commit", async action => {
    // Neither endpoint copies activations. Model a publisher attaching the new
    // quote before its post-write lookup. The source still serves on two sites.
    db.prepare(`CREATE TRIGGER activate_new AFTER INSERT ON leadgen_quotes BEGIN
      INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug) VALUES ('Site-C', NEW.id, 1, 'new');
    END`).run();
    const path = action === "create" ? "quotes" : `quotes/${quote.id}/duplicate`;
    const response = await write("POST", path, createBody);
    await expectStatus(response, 201);
    const created = await response.json() as { public_id: string };
    expect(created.public_id).not.toBe(quote.publicId);
    expectPurges({ [siteC]: [created.public_id] });
  });

  it("creating and duplicating unactivated quotes purge no tenant", async () => {
    await expectStatus(await write("POST", "quotes", createBody), 201);
    await expectStatus(await write("POST", `quotes/${quote.id}/duplicate`), 201);
    expectPurges({});
  });

  it.each([
    ["edit", { quote_name: "Edited" }],
    ["archive", { status: "archived" }],
    ["set the quote's template", { default_template_id: 1 }],
    ["clear the quote's template", { default_template_id: null }],
  ] as const)("%s purges only the sites with an enabled activation", async (_action, body) => {
    db.prepare("INSERT INTO leadgen_quote_default_template (quote_public_id, frame_template_id) VALUES (?, 2)").run(quote.publicId);
    await expectStatus(await write("PATCH", "quotes/" + quote.publicId, body), 200);
    expectSharedQuote();
  });

  it("archiving through DELETE purges only a site activated after its live-history check", async () => {
    const other = seedQuote();
    db.prepare(`CREATE TRIGGER activate_before_archive BEFORE UPDATE OF status ON leadgen_quotes BEGIN
      INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug) VALUES ('Site-B', NEW.id, 1, 'late');
    END`).run();
    await expectStatus(await write("DELETE", "quotes/" + other.id), 200);
    expectPurges({ [siteB]: [other.publicId] });
  });

  it("an unused quote and a refused delete of a live quote purge no tenant", async () => {
    await expectStatus(await write("DELETE", "quotes/" + seedQuote().id), 200);
    await expectStatus(await write("DELETE", "quotes/" + quote.id), 409);
    expectPurges({});
  });

  it("a request without an execution context queues only the enabled sites", async () => {
    const real = await vi.importActual<typeof import("../src/edge/public-change")>("../src/edge/public-change");
    vi.mocked(onPublicChange).mockImplementation(real.onPublicChange);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expectStatus(await write("PATCH", "quotes/" + quote.id, { quote_name: "Updated" }, null), 200);
    expectSharedQuote(null);
    const pending = db.prepare("SELECT site_id, action, status, payload FROM cache_purge_log ORDER BY site_id, action")
      .all() as { site_id: string; action: string; status: string; payload: string }[];
    expect(pending.map(({ site_id, action, status }) => [site_id, action, status])).toEqual(
      [siteA, siteB].flatMap(site => [[site, "purge_tags", "pending"], [site, "purge_tags_second", "pending"]]),
    );
    for (const row of pending) {
      const site = row.site_id.toLowerCase();
      expect(JSON.parse(row.payload).tags.sort())
        .toEqual([`nf:${site}`, `quote:${site}:${quote.publicId.toLowerCase()}`, `snap:${site}`]);
    }
  });
});

describe("funnel and variant writes", () => {
  it.each(["create", "update", "pixel", "delete", "duplicate", "reorder", "default"])(
    "funnel %s purges the parent quote once per activated site", async action => {
      const sibling = seedFunnel(quote.id);
      const funnels = "funnels/" + sibling.funnelId;
      const quotes = "quotes/" + quote.id;
      const writes: Record<string, [string, string, unknown?, number?]> = {
        create: ["POST", quotes + "/funnels", { funnel_name: "Another" }, 201],
        update: ["PATCH", funnels, { funnel_name: "Changed" }],
        pixel: ["PATCH", funnels, { meta_pixel_id: "123456789012345" }],
        delete: ["DELETE", funnels],
        duplicate: ["POST", funnels + "/duplicate", {}, 201],
        reorder: ["PUT", quotes + "/funnel-order", { order: [sibling.funnelId, quote.funnelId] }],
        default: ["PUT", quotes + "/default-funnel", { funnel_id: sibling.funnelId }],
      };
      const [method, path, body, status = 200] = writes[action]!;
      await expectStatus(await write(method, path, body), status);
      if (action === "pixel") {
        expect(db.prepare("SELECT content_version FROM leadgen_funnel_variants WHERE id = ?").get(sibling.variantId))
          .toEqual({ content_version: 2 });
      }
      expectSharedQuote();
    });

  it.each(["quotes", "funnels"])("creating a variant through %s purges only its quote's enabled sites", async parent => {
    db.prepare("UPDATE leadgen_funnel_variants SET status = 'archived' WHERE id = ?").run(quote.variantId);
    const parentId = parent === "quotes" ? quote.id : quote.funnelId;
    await expectStatus(await write("POST", `${parent}/${parentId}/variants`, { variant_label: "New" }), 201);
    expectSharedQuote();
  });

  it("saving a variant purges only its quote's enabled sites after the version bump", async () => {
    const versionsAtPurge: unknown[] = [];
    vi.mocked(onPublicChange).mockImplementation(async () => {
      versionsAtPurge.push(db.prepare("SELECT content_version FROM leadgen_funnel_variants WHERE id = ?").get(quote.variantId));
    });
    await expectStatus(await write("PUT", "variants/" + quote.variantId, { lander_headline: "A different headline" }), 200);
    expect(versionsAtPurge).toEqual([{ content_version: 2 }, { content_version: 2 }]);
    expectSharedQuote();
  });

  it("forking a running arm purges its quote once on each enabled site", async () => {
    seedExperiment("running");
    await expectStatus(await write("POST", `variants/${quote.variantId}/fork`, {}), 201);
    expect(db.prepare("SELECT traffic_allocation_bp FROM leadgen_funnel_variants WHERE funnel_id = ? ORDER BY id")
      .all(quote.funnelId)).toEqual([{ traffic_allocation_bp: 5000 }, { traffic_allocation_bp: 5000 }]);
    expectSharedQuote();
  });

  it("deleting a variant resolves its quote through the surviving funnel on enabled sites", async () => {
    db.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label) VALUES (?, ?, 'B')")
      .run(mintPublicId("funnel_variant"), quote.funnelId);
    await expectStatus(await write("DELETE", "variants/" + quote.variantId), 200);
    expect(db.prepare("SELECT id FROM leadgen_funnel_variants WHERE id = ?").get(quote.variantId)).toBeUndefined();
    expectSharedQuote();
  });
});

describe("rules, shared pages and experiments", () => {
  it.each(["create", "update", "duplicate", "delete"])(
    "routing rule %s purges only this quote on its activated sites", async action => {
      const id = db.prepare(`INSERT INTO leadgen_quote_routing_rules
        (public_id, quote_id, rule_name, feed_name, conditions_json, conditions_hash)
        VALUES (?, ?, 'Existing', 'paid', '{"groups":[]}', 'hash')`)
        .run(mintPublicId("quote_routing_rule"), quote.id).lastInsertRowid;
      const rule = "routing-rules/" + id;
      const writes: Record<string, [string, string, unknown?, number?]> = {
        create: ["POST", `quotes/${quote.id}/routing-rules`, { rule_name: "Source", feed_name: "referral" }, 201],
        update: ["PATCH", rule, { feed_name: "referral" }],
        duplicate: ["POST", rule + "/duplicate", {}, 201],
        delete: ["DELETE", rule],
      };
      const [method, path, body, status = 200] = writes[action]!;
      await expectStatus(await write(method, path, body), status);
      expectSharedQuote();
    });

  it.each(["create", "update", "duplicate", "delete"])(
    "variant rule %s purges only its parent quote on enabled sites", async action => {
      const id = db.prepare(`INSERT INTO leadgen_funnel_rules
        (public_id, variant_id, rule_type, conditions_json, conditions_hash)
        VALUES (?, ?, 'eligibility', '{"groups":[]}', 'hash')`).run(mintPublicId("funnel_rule"), quote.variantId).lastInsertRowid;
      const rules = `variants/${quote.variantId}/rules`;
      const rule = rules + "/" + id;
      const writes: Record<string, [string, string, unknown?, number?]> = {
        create: ["POST", rules, { rule_type: "eligibility", conditions_json: { groups: [] } }, 201],
        update: ["PATCH", rule, { priority: 5 }],
        duplicate: ["POST", rule + "/duplicate", {}, 201],
        delete: ["DELETE", rule],
      };
      const [method, path, body, status = 200] = writes[action]!;
      await expectStatus(await write(method, path, body), status);
      expect(db.prepare("SELECT content_version FROM leadgen_funnel_variants WHERE id = ?").get(quote.variantId))
        .toEqual({ content_version: 2 });
      expectSharedQuote();
    });

  it.each(["create", "update", "upsert", "delete"])(
    "shared page %s purges only the quote's activated sites", async action => {
      if (action === "update" || action === "delete") seedSharedPage();
      const path = `quotes/${quote.id}/shared-page`;
      const method = action === "create" ? "POST" : action === "delete" ? "DELETE" : "PUT";
      const body = { name: "Welcome", sections: [{ section_id: seedSection("Welcome") }] };
      await expectStatus(await write(method, path, body), action === "create" ? 201 : 200);
      expectSharedQuote();
    });

  it.each(["quotes", "funnels"])("creating an A/B test through %s purges only the quote's activated sites", async parent => {
    const id = parent === "quotes" ? quote.id : quote.funnelId;
    await expectStatus(await write("POST", `${parent}/${id}/experiments`, { name: "Try a new form" }), 201);
    expectSharedQuote();
  });

  it.each(["start", "stop"])("A/B %s purges the experiment's quote on each activated site", async action => {
    const id = seedExperiment(action === "start" ? "draft" : "running");
    await expectStatus(await write("POST", `experiments/${id}/${action}`), 200);
    expect(db.prepare("SELECT status FROM leadgen_funnel_ab_tests WHERE id = ?").get(id))
      .toEqual({ status: action === "start" ? "running" : "stopped" });
    expectSharedQuote();
  });
});

describe("site activations", () => {
  it.each(["enable", "rename", "disable", "delete"])(
    "activation %s purges one quote on the edited site, including its former shell", async action => {
      // An unrelated quote on the same site and this quote on another site both survive.
      activate(siteA, seedQuote().id, "another-quote");
      if (action === "enable") db.prepare("DELETE FROM leadgen_site_quotes WHERE site_id = ? AND quote_id = ?").run(siteA, quote.id);
      const sharedPageId = seedSharedPage();
      db.prepare("INSERT INTO leadgen_funnel_variant_sections (quote_id, section_id, position, page_id) VALUES (?, ?, 0, ?)")
        .run(quote.id, seedSection("Shared"), sharedPageId);
      db.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (?, ?, 0)")
        .run(quote.variantId, seedSection("Own"));
      const path = `quotes/${quote.publicId}/activation/${siteA}`;
      const body = { enabled: action !== "disable", slug: "new-slug", settings_overrides: { ga4_id: "G-SITEA" } };
      const states: unknown[] = [];
      vi.mocked(onPublicChange).mockImplementation(async () => {
        states.push(db.prepare("SELECT enabled FROM leadgen_site_quotes WHERE site_id = ? AND quote_id = ?").get(siteA, quote.id));
      });
      await expectStatus(await write(action === "delete" ? "DELETE" : "PUT", path, body), 200);
      expect(states).toEqual([{ enabled: action === "enable" || action === "rename" ? 1 : 0 }]);
      expectPurges({ [siteA]: [quote.publicId] });
    });

  it("a legacy activation invalidator with just a site merges its current and formerly live quotes", async () => {
    const former = seedQuote();
    activate(siteA, former.id, "former", false);
    await invalidateOnQuoteActivation(env, siteA);
    expectPurges({ [siteA]: [quote.publicId, former.publicId] }, null);
  });

  it("a per-site variant publish resolves the public funnel ID and excludes disabled sites", async () => {
    const shell = `lg-shell:${siteA}:life:${quote.funnelPublicId}:variant:1:0`;
    const config = `lg-config:${siteA}:${quote.funnelPublicId}:variant:1:0`;
    await env.CACHE.put(shell, "old shell");
    await env.CACHE.put(config, "old config");
    const result = await invalidateOnVariantPublish(env, siteA, quote.funnelPublicId, ctx as ExecutionContext);
    expect(result.cache_keys_deleted).toBe(2);
    await invalidateOnVariantPublish(env, siteC, quote.funnelPublicId, ctx as ExecutionContext);
    expectPurges({ [siteA]: [quote.publicId] });
  });

  it("a section save without a request context purges its quote on enabled sites", async () => {
    // The shared batch shim calls run(), which drops RETURNING rows in
    // node:sqlite. D1 returns the IDs actually bumped in this transaction.
    const prepare = env.DB.prepare.bind(env.DB);
    vi.spyOn(env.DB, "prepare").mockImplementation(sql => {
      const stmt = prepare(sql);
      if (sql.includes("RETURNING id")) {
        stmt.run = async <T>() => {
          const result = await stmt.all<T>();
          return { ...result, meta: { ...result.meta, changes: result.results.length } };
        };
      }
      return stmt;
    });
    const sectionId = seedSection("Insurance");
    db.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (?, ?, 0)")
      .run(quote.variantId, sectionId);
    const content = { components: [{ type: "TwoButtonYesNo", question_id: "q1",
      question_key: "insured_q", internal_field: "currently_insured", answer_type: "boolean" }] };
    await expectStatus(await write("PATCH", "sections/" + sectionId, { content_json: content }, null), 200);
    expectSharedQuote(null);
  });

  it("a frame-template apply through the legacy version-bump caller queues only sites serving the quote", async () => {
    await expectStatus(await write("POST", `funnels/${quote.funnelId}/apply-template`, { template_id: 1 }, null), 200);
    expectSharedQuote(null);
  });
});

const themeBody = {
  name: "Ocean",
  roles: { brand_primary: "#0B5FFF", accent: "#123456", page_bg: "#F0F0F0", card: "#FFFFFF", text: "#101010",
    success: "#0E7C3A", error: "#B23A2C" },
  typography: { headline_font: "Newsreader", body_font: "Inter", base_px: 16 },
  controls: { field_height: "medium", button_size: "m", corners: "rounded" },
};
const themeId = "thm_ocean";
const themeRef = JSON.stringify({ theme_id: themeId }, null, 2);

function referenceTheme(funnelId: number) {
  db.prepare("UPDATE leadgen_funnels SET theme_json = ? WHERE id = ?").run(themeRef, funnelId);
}

describe("theme records reaching public shells", () => {
  it("a theme edit merges all version-bumped public quotes once per enabled site", async () => {
    await expectStatus(await write("POST", "themes", themeBody), 201);
    expectPurges({});
    const sibling = seedFunnel(quote.id);
    const second = seedQuote();
    activate(siteA, second.id, "another");
    const archived = seedQuote();
    activate(siteC, archived.id, "archived-funnel");
    referenceTheme(quote.funnelId);
    referenceTheme(sibling.funnelId);
    referenceTheme(archived.funnelId);
    db.prepare("UPDATE leadgen_funnels SET status = 'archived' WHERE id = ?").run(archived.funnelId);
    db.prepare("UPDATE leadgen_funnel_variants SET frame_overrides_json = ? WHERE id = ?").run(themeRef, second.variantId);
    const unrelated = seedQuote();
    activate(siteA, unrelated.id, "unrelated");
    db.prepare("UPDATE leadgen_funnels SET theme_json = ? WHERE id = ?").run("{broken", unrelated.funnelId);
    const oldShell = `lg-shell:${siteA}:life:${quote.funnelPublicId}:variant:1:0`;
    const otherShell = `lg-shell:${siteA}:unrelated:${unrelated.funnelPublicId}:variant:1:0`;
    await env.CACHE.put(oldShell, "old");
    await env.CACHE.put(otherShell, "keep");

    await expectStatus(await write("PATCH", "themes/" + themeId, { roles: { brand_primary: "#336699" } }), 200);
    expectPurges({ [siteA]: [quote.publicId, second.publicId], [siteB]: [quote.publicId] });
    expect(db.prepare("SELECT content_version FROM leadgen_funnel_variants ORDER BY id").all())
      .toEqual([2, 2, 2, 2, 1].map(content_version => ({ content_version })));
    expect(await env.CACHE.get(oldShell)).toBeNull();
    expect(await env.CACHE.get(otherShell)).toBe("keep");
  });

  it("creating a previously missing theme purges only the sites where its stored reference now resolves", async () => {
    referenceTheme(quote.funnelId);
    await expectStatus(await write("POST", "themes", themeBody), 201);
    expectSharedQuote();
  });

  it("deleting a theme purges the activated quotes attached between the usage check and the KV write", async () => {
    await expectStatus(await write("POST", "themes", themeBody), 201);
    const put = env.CACHE.put.bind(env.CACHE);
    vi.spyOn(env.CACHE, "put").mockImplementationOnce(async (...args) => {
      referenceTheme(quote.funnelId);
      return put(...args);
    });
    await expectStatus(await write("DELETE", "themes/" + themeId), 200);
    expectSharedQuote();
  });

  it("a byte-identical theme save, refused in-use delete and unused theme delete purge no site", async () => {
    await expectStatus(await write("POST", "themes", themeBody), 201);
    referenceTheme(quote.funnelId);
    await expectStatus(await write("PATCH", "themes/" + themeId, { name: themeBody.name }), 200);
    await expectStatus(await write("DELETE", "themes/" + themeId), 409);
    db.prepare("UPDATE leadgen_funnels SET theme_json = NULL WHERE id = ?").run(quote.funnelId);
    await expectStatus(await write("DELETE", "themes/" + themeId), 200);
    expectPurges({});
  });

  it("a committed theme change still purges its serving sites if legacy version propagation fails", async () => {
    await expectStatus(await write("POST", "themes", themeBody), 201);
    referenceTheme(quote.funnelId);
    db.prepare(`CREATE TRIGGER refuse_bump BEFORE UPDATE OF content_version ON leadgen_funnel_variants
      BEGIN SELECT RAISE(ABORT, 'failed version bump'); END`).run();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await write("PATCH", "themes/" + themeId, { roles: { brand_primary: "#336699" } });
    await expectStatus(response, 200);
    expect(await response.json()).toMatchObject({ cache_refresh_warning: expect.stringContaining("failed version bump") });
    expectSharedQuote();
  });
});

describe("shared leadgen change contract", () => {
  it("a quote save waits for the last enabled site's purge before returning", async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(onPublicChange).mockImplementation(async (_env, _ctx, change) => {
      if (change.siteId === siteB) await pending;
    });
    let responded = false;
    const response = write("PATCH", "quotes/" + quote.id, { quote_name: "Published" }).then(result => {
      responded = true;
      return result;
    });
    try {
      await vi.waitFor(() => expectSharedQuote());
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(responded).toBe(false);
      expect(db.prepare("SELECT quote_name FROM leadgen_quotes WHERE id = ?").get(quote.id)).toEqual({ quote_name: "Published" });
    } finally {
      release();
    }
    await expectStatus(await response, 200);
  });

  it("merges overlapping quote, funnel and variant IDs once for each serving site", async () => {
    const second = seedQuote();
    activate(siteA, second.id, "second");
    activate(siteC, second.id, null);
    await leadgenPublicChange(env, ctx as ExecutionContext, {
      quoteIds: [quote.id, quote.id], funnelIds: [quote.funnelId, second.funnelId],
      variantIds: [quote.variantId, second.variantId], reason: "shared content edit",
    });
    expectPurges({ [siteA]: [quote.publicId, second.publicId], [siteB]: [quote.publicId], [siteC]: [second.publicId] });
  });

  it("hands every changed quote to a single site purge even beyond 100 tags", async () => {
    const ids = [quote.id];
    const publicIds = [quote.publicId];
    for (let i = 0; i < 100; i++) {
      const extra = seedQuote();
      activate(siteA, extra.id, "extra-" + i);
      ids.push(extra.id);
      publicIds.push(extra.publicId);
    }
    await leadgenPublicChange(env, undefined, { quoteIds: ids, reason: "shared theme" });
    expectPurges({ [siteA]: publicIds, [siteB]: [quote.publicId] }, null);
  });

  it("a lookup failure after a quote save preserves the write and purges no unrelated tenant", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const prepare = env.DB.prepare.bind(env.DB);
    vi.spyOn(env.DB, "prepare").mockImplementation(sql => {
      if (sql.includes("WITH changed_quotes")) throw new Error("D1 scope lookup unavailable");
      return prepare(sql);
    });
    await expectStatus(await write("PATCH", "quotes/" + quote.id, { quote_name: "Saved" }), 200);
    expect(db.prepare("SELECT quote_name FROM leadgen_quotes WHERE id = ?").get(quote.id)).toEqual({ quote_name: "Saved" });
    expectPurges({});
  });

  it("a failed variant-rule batch rolls back and purges no tenant", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.prepare(`CREATE TRIGGER refuse_bump BEFORE UPDATE OF content_version ON leadgen_funnel_variants
      BEGIN SELECT RAISE(ABORT, 'failed version bump'); END`).run();
    await expectStatus(await write("POST", `variants/${quote.variantId}/rules`, { rule_type: "eligibility" }), 500);
    expect(db.prepare("SELECT id FROM leadgen_funnel_rules WHERE variant_id = ?").all(quote.variantId)).toEqual([]);
    expectPurges({});
  });

  it("a failed multi-part quote or funnel patch leaves both writes uncommitted and purges no site", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.prepare(`CREATE TRIGGER refuse_quote BEFORE UPDATE ON leadgen_quotes
      BEGIN SELECT RAISE(ABORT, 'quote write failed'); END`).run();
    await expectStatus(await write("PATCH", "quotes/" + quote.id, { default_template_id: 2 }), 500);
    expect(db.prepare("SELECT frame_template_id FROM leadgen_quote_default_template WHERE quote_public_id = ?")
      .all(quote.publicId)).toEqual([]);

    db.prepare(`CREATE TRIGGER refuse_pixel_version BEFORE UPDATE OF content_version ON leadgen_funnel_variants
      BEGIN SELECT RAISE(ABORT, 'version write failed'); END`).run();
    await expectStatus(await write("PATCH", "funnels/" + quote.funnelId, { funnel_name: "Changed", meta_pixel_id: "123456789" }), 500);
    expect(db.prepare("SELECT funnel_name, meta_pixel_id FROM leadgen_funnels WHERE id = ?").get(quote.funnelId))
      .toEqual({ funnel_name: "Life funnel", meta_pixel_id: null });
    expectPurges({});
  });
});
