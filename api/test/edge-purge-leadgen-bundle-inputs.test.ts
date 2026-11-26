import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import admin from "../src/admin/router";
import { leadgenBundleKey } from "../src/cache/cache-keys";
import { buildSiteSnapshot } from "../src/edge/snapshot";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { computeAttemptBindingExtras } from "../src/public/leadgen/attempt";
import { loadPreparedFunnelBundle } from "../src/public/leadgen/bundle";
import { attachOffer, ctxCapture, makeKvStub, seedAuction, seedAuctionOffer } from "./helpers/leadgen-analytics-harness";
import { addSite, createDb, env as sqliteEnv, type SqliteDb } from "./helpers/x06-a2-sqlite";

let db: SqliteDb;
let env: Env;
let capture: ReturnType<typeof ctxCapture>;
let live: ReturnType<typeof addQuote>;
const sites = ["alpha", "beta", "neighbor"];
const purgeTags = vi.fn(async (_tags: string[]) => ({ success: true, errors: [] }));

function addQuote() {
  const publicId = mintPublicId("quote");
  const quote = Number(db.prepare(`INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json, status)
    VALUES (?, 'Life', 'quote_funnel', '["life"]', 'active')`).run(publicId).lastInsertRowid);
  const funnel = Number(db.prepare(`INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status)
    VALUES (?, ?, 'Intake', 'active')`).run(mintPublicId("funnel"), quote).lastInsertRowid);
  const variantId = mintPublicId("funnel_variant");
  const variant = Number(db.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id) VALUES (?, ?)")
    .run(variantId, funnel).lastInsertRowid);
  return { publicId, quote, funnel, variantId, variant };
}

function activate(quote: number, site: string, slug: string, enabled = true) {
  db.prepare("INSERT INTO leadgen_site_quotes (quote_id, site_id, slug, enabled) VALUES (?, ?, ?, ?)")
    .run(quote, site, slug, Number(enabled));
}

beforeEach(() => {
  db = createDb();
  env = sqliteEnv(db);
  env.CACHE = makeKvStub().kv;
  // Preserve the shim's transaction and write metadata. D1 also returns the
  // rows of batched SELECTs and UPDATE ... RETURNING statements.
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = sql => {
    const stmt = prepare(sql);
    if (/^\s*(?:SELECT|WITH)\b|\bRETURNING\b/i.test(sql)) {
      stmt.run = async <T>() => {
        const result = await stmt.all<T>();
        const meta = db.prepare("SELECT changes() AS changes, last_insert_rowid() AS last_row_id").get() as
          Pick<D1Meta, "changes" | "last_row_id">;
        return { ...result, meta: { ...result.meta, ...meta } };
      };
    }
    return stmt;
  };
  capture = ctxCapture();
  purgeTags.mockClear();
  Object.assign(capture.ctx, { exports: { PublicPage: { purgeTags } } });
  for (const site of sites) {
    addSite(db, site, site, "health");
    db.prepare("INSERT INTO domains (site_id, hostname, status) VALUES (?, ?, 'active')").run(site, site + ".example");
  }
  live = addQuote();
  activate(live.quote, "alpha", "life");
  activate(live.quote, "beta", "second-site");
  activate(live.quote, "neighbor", "disabled", false);
});

afterEach(async () => {
  await Promise.all(capture.promises);
  db.close();
});

async function write(method: string, path: string, body?: unknown, status = 200) {
  const response = await admin.request("/api/admin/leadgen/" + path, {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }, env, capture.ctx);
  const data = await response.text();
  expect(response.status, data).toBe(status);
  return JSON.parse(data) as Record<string, unknown>;
}

async function prepared(variant = live.variantId) {
  const snapshot = await buildSiteSnapshot(env, "alpha.example");
  if (!snapshot) throw new Error("Missing alpha snapshot");
  const { builtAt: _builtAt, ...content } = snapshot;
  const version = createHash("sha256").update(JSON.stringify(content)).digest("hex");
  const key = leadgenBundleKey("alpha", variant, version);
  const bundle = await loadPreparedFunnelBundle(env, new Headers({ "x-cms-snap-version": version }), "alpha", variant);
  if (!bundle) throw new Error("Missing prepared funnel");
  expect(await env.CACHE.get(key)).toEqual(expect.any(String));
  return { key, bundle };
}

// Check the real site's version, immediate RPC, and durable second purge.
// Multiple changed quotes on a site must share one version bump and one RPC.
function expectChanges(reason: string, bySite: Record<string, string[]>) {
  const log = db.prepare("SELECT site_id, action, payload FROM cache_purge_log ORDER BY site_id")
    .all() as { site_id: string; action: string; payload: string }[];
  expect(log.map(row => row.site_id)).toEqual(Object.keys(bySite).sort());
  expect(purgeTags).toHaveBeenCalledTimes(log.length);
  for (const row of log) {
    const tags = [`snap:${row.site_id}`, `nf:${row.site_id}`,
      ...bySite[row.site_id]!.map(id => `quote:${row.site_id}:${id.toLowerCase()}`)].sort();
    const payload = JSON.parse(row.payload);
    expect(row.action).toBe("purge_tags_second");
    expect(payload.reason).toBe(reason);
    expect(payload.tags.sort()).toEqual(tags);
    expect(purgeTags.mock.calls.map(([sent]) => [...sent].sort())).toContainEqual(tags);
  }
  for (const site of sites) {
    expect(db.prepare("SELECT content_version FROM sites WHERE id = ?").get(site))
      .toEqual({ content_version: bySite[site] ? 2 : 1 });
  }
}

async function addSection(extra: Record<string, unknown> = {}) {
  const section = await write("POST", "sections", {
    section_name: "Coverage", activity: "quote_funnel", vertical: "life", headline_text: "Insured?",
    content_json: { components: [{ type: "TwoButtonYesNo", question_id: "q1", question_key: "insured",
      internal_field: "insured", answer_type: "boolean" }] }, ...extra,
  }, 201);
  return Number(section.id);
}

it("auction PATCH immediately rekeys the bundles for quotes using the new attempt binding", async () => {
  const shared = addQuote();
  activate(shared.quote, "alpha", "shared");
  const attribution = addQuote();
  activate(attribution.quote, "neighbor", "attribution");
  const auction = seedAuction(db);
  db.prepare("UPDATE leadgen_auctions SET quote_id = ? WHERE id = ?").run(attribution.quote, auction.id);
  db.prepare("UPDATE leadgen_funnel_variants SET auction_id = ? WHERE id IN (?, ?)").run(auction.id, live.variant, shared.variant);
  const before = await prepared();
  expect((await computeAttemptBindingExtras(env, before.bundle.resolved)).auction_config_version).toBe("1");

  await write("PATCH", "auctions/" + auction.public_id, { carrier_normalization_version: 2 });
  expectChanges("leadgen.auction.update", { alpha: [live.publicId, shared.publicId], beta: [live.publicId] });
  const after = await prepared();
  expect(after.key).not.toBe(before.key);
  expect((await computeAttemptBindingExtras(env, after.bundle.resolved)).auction_config_version).toBe("2");
  expect(after.bundle.resolved.variant.content_version).toBe(before.bundle.resolved.variant.content_version);
});

it("a runtime-only auction PATCH preserves a binding version published during its validation", async () => {
  const auction = seedAuction(db);
  db.prepare("UPDATE leadgen_funnel_variants SET auction_id = ? WHERE id = ?").run(auction.id, live.variant);
  const path = "auctions/" + auction.id;
  const prepare = env.DB.prepare.bind(env.DB);
  const interleave = vi.spyOn(env.DB, "prepare").mockImplementation(sql => {
    const stmt = prepare(sql);
    if (sql.includes("UPDATE leadgen_auctions SET")) {
      interleave.mockRestore();
      const run = stmt.run.bind(stmt);
      stmt.run = async <T>() => {
        await write("PATCH", path, { carrier_normalization_version: 2 });
        return run<T>();
      };
    }
    return stmt;
  });
  expect(await write("PATCH", path, { floor_value: 15 })).toMatchObject({ carrier_normalization_version: 2, floor_value: 15 });
  expectChanges("leadgen.auction.update", { alpha: [live.publicId], beta: [live.publicId] });
});

it("section PATCH refreshes stored metadata for direct placements and slotless shared pages", async () => {
  const shared = addQuote();
  activate(shared.quote, "alpha", "shared");
  const section = await addSection();
  const page = db.prepare("INSERT INTO leadgen_funnel_pages (public_id, quote_id, position) VALUES (?, ?, 0)")
    .run(mintPublicId("funnel_page"), shared.quote).lastInsertRowid;
  // The legacy shared-page reader follows page_id even for a variant-owned placement.
  db.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, page_id, section_id, position) VALUES (?, ?, ?, 0)")
    .run(live.variant, page, section);
  const before = await prepared(shared.variantId);
  expect(before.bundle.resolved.sections[0]?.section.section_name).toBe("Coverage");

  await write("PATCH", "sections/" + section, { section_name: "Coverage status" });
  expectChanges("leadgen.section.update", { alpha: [live.publicId, shared.publicId], beta: [live.publicId] });
  const after = await prepared(shared.variantId);
  expect(after.key).not.toBe(before.key);
  expect(after.bundle.resolved.sections[0]?.section.section_name).toBe("Coverage status");
  expect(after.bundle.resolved.variant.content_version).toBe(before.bundle.resolved.variant.content_version);
});

it("section PATCH removing an answer map refreshes the mapping version used by the attempt verifier", async () => {
  const offer = seedAuctionOffer(db);
  const field = { path: "data.insured", name: "insured", type: "boolean", required: true, source: "answer", internal_field: "insured" };
  await write("POST", `offers/${offer.offer_id}/payload-schemas`,
    { schema_json: { version: 1, root: { type: "object", children: [field] } } }, 201);
  const section = await addSection({ answer_maps: [{ question_id: "q1", offer_id: offer.offer_id,
    offer_payload_field_path: field.path, provider_expected_type: "boolean", required_for_offer: true,
    output_value_map: { true: true, false: false } }] });
  db.prepare("INSERT INTO leadgen_funnel_variant_sections (quote_id, section_id, position) VALUES (?, ?, 0)").run(live.quote, section);
  const before = await prepared();
  const beforeBinding = await computeAttemptBindingExtras(env, before.bundle.resolved);

  await write("PATCH", "sections/" + section, { answer_maps: [] });
  expectChanges("leadgen.section.update", { alpha: [live.publicId], beta: [live.publicId] });
  const after = await prepared();
  expect(after.key).not.toBe(before.key);
  const versions = Object.values(after.bundle.shell.answerMapVersions);
  expect(versions).toEqual(["0"]);
  expect(versions).not.toEqual(Object.values(before.bundle.shell.answerMapVersions));
  const afterBinding = await computeAttemptBindingExtras(env, after.bundle.resolved);
  expect(afterBinding.answer_mapping_hash).not.toBe(beforeBinding.answer_mapping_hash);
  expect(afterBinding.answer_mapping_hash).toBe(createHash("sha256").update(JSON.stringify(versions)).digest("hex"));
});

it.each([
  ["participant update", "leadgen.auction.offers"],
  ["offer edit", "leadgen.offer.update"],
  ["offer archive", "leadgen.offer.archive"],
] as const)("%s refreshes the bundle's tracking flag when the funnel has its own Meta pixel", async (action, reason) => {
  const auction = seedAuction(db);
  const offer = seedAuctionOffer(db);
  db.prepare("UPDATE leadgen_funnel_variants SET auction_id = ? WHERE id = ?").run(auction.id, live.variant);
  db.prepare("UPDATE leadgen_funnels SET meta_pixel_id = '123456' WHERE id = ?").run(live.funnel);
  if (action !== "participant update") attachOffer(db, auction.id, offer);
  if (action !== "offer edit") {
    db.prepare("UPDATE leadgen_offers SET clickout_meta_conversion = 1, clickout_meta_dataset_id = '654321' WHERE id = ?")
      .run(offer.offer_id);
  }
  const before = await prepared();
  expect(before.bundle.shell.clickEvents).toBe(action === "offer archive");
  if (action === "participant update") {
    await write("PUT", `auctions/${auction.id}/offers`, { offers: [{ offer_placement_id: offer.placement_id }] });
  } else if (action === "offer edit") {
    await write("PATCH", "offers/" + offer.offer_id, { clickout_meta_conversion: true, clickout_meta_dataset_id: "654321" });
  } else {
    await write("DELETE", "offers/" + offer.offer_id);
  }
  expectChanges(reason, { alpha: [live.publicId], beta: [live.publicId] });
  const after = await prepared();
  expect(after.key).not.toBe(before.key);
  expect(after.bundle.shell.clickEvents).toBe(!before.bundle.shell.clickEvents);
  expect(after.bundle.resolved.variant.content_version).toBe(before.bundle.resolved.variant.content_version);
});

it("runtime-only, rejected and unattached edits leave the existing bundle key in use", async () => {
  const auction = seedAuction(db);
  db.prepare("UPDATE leadgen_funnel_variants SET auction_id = ? WHERE id = ?").run(auction.id, live.variant);
  const before = await prepared();
  await write("PATCH", "auctions/" + auction.id, { floor_value: 15 });
  await write("PUT", `auctions/${auction.id}/banner`, { mode: "automatic", field_map: {} });
  await write("PATCH", "auctions/" + auction.id, { carrier_normalization_version: 0 }, 400);
  await write("PATCH", "auctions/" + auction.id, { carrier_normalization_version: 1 });
  await write("PATCH", "auctions/" + seedAuction(db).id, { carrier_normalization_version: 2 });
  await write("PATCH", "sections/" + await addSection(), { section_name: "Unused" });
  expectChanges("", {});
  expect((await prepared()).key).toBe(before.key);
});
