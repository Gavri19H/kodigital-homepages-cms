import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import admin from "../src/admin/router";
import { leadgenPublicChange } from "../src/edge/leadgen-change";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { createDb, env as sqliteEnv, type SqliteDb } from "./helpers/x06-a2-sqlite";

vi.mock("../src/edge/leadgen-change", () => ({ leadgenPublicChange: vi.fn() }));

let db: SqliteDb;
let env: Env;
let background: Promise<unknown>[];
const ctx = {
  waitUntil(promise: Promise<unknown>) { background.push(promise); },
  passThroughOnException() {}, props: {}, exports: {},
};
const change = vi.mocked(leadgenPublicChange);

beforeEach(() => {
  db = createDb();
  env = sqliteEnv(db);
  // D1 returns rows from SELECT and UPDATE ... RETURNING in a batch. The
  // shared SQLite adapter normally executes each statement with run().
  env.DB.batch = async <T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> => {
    db.prepare("BEGIN").run();
    try {
      const results: D1Result<T>[] = [];
      for (const statement of statements) {
        const result = await statement.all<T>();
        const meta = db.prepare("SELECT changes() AS changes, last_insert_rowid() AS last_row_id")
          .get() as Pick<D1Meta, "changes" | "last_row_id">;
        results.push({ ...result, meta: { ...result.meta, ...meta } });
      }
      db.prepare("COMMIT").run();
      return results;
    } catch (err) {
      db.prepare("ROLLBACK").run();
      throw err;
    }
  };
  background = [];
  change.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  await Promise.all(background);
  db.close();
});

async function write(method: string, path: string, body?: unknown, status = 200, context: typeof ctx | null = ctx) {
  const res = await admin.request("/api/admin/leadgen/" + path, {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }, env, context ?? undefined);
  const data = await res.text();
  expect(res.status, data).toBe(status);
  return JSON.parse(data) as Record<string, unknown>;
}

function expectChange(scope: { quoteIds?: number[]; variantIds?: number[]; funnelIds?: number[] }, context: typeof ctx | null = ctx) {
  expect(change).toHaveBeenCalledTimes(1);
  const [receivedEnv, executionCtx, args] = change.mock.calls[0]!;
  expect(receivedEnv).toBe(env);
  expect(executionCtx).toBe(context ?? undefined);
  expect(args).toEqual({ ...scope, reason: expect.stringMatching(/\S/) });
}

function insert(sql: string, ...values: unknown[]): number {
  return Number(db.prepare(sql).run(...values).lastInsertRowid);
}

function addVariant(funnel: number, template: number | null = null) {
  return insert(`INSERT INTO leadgen_funnel_variants (public_id, funnel_id, frame_template_id)
    VALUES (?, ?, ?)`, mintPublicId("funnel_variant"), funnel, template);
}

function consumer() {
  const publicId = mintPublicId("quote");
  const quote = insert(`INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json, status)
    VALUES (?, 'Life quote', 'quote_funnel', '["life"]', 'active')`, publicId);
  const funnel = insert(`INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status)
    VALUES (?, ?, 'Life funnel', 'active')`, mintPublicId("funnel"), quote);
  return { publicId, quote, funnel, variant: addVariant(funnel) };
}

function version(variant: number) {
  return (db.prepare("SELECT content_version FROM leadgen_funnel_variants WHERE id = ?").get(variant) as { content_version: number }).content_version;
}

function addOffer(tracking = false) {
  const id = insert(`INSERT INTO leadgen_offers (public_id, offer_name, activity, vertical, conversion_tracking_method,
    offer_type, clickout_meta_conversion, clickout_meta_dataset_id)
    VALUES (?, 'Life offer', 'quote_funnel', 'life', 's2s_postback', 'cpc', ?, ?)`,
    mintPublicId("offer"), Number(tracking), tracking ? "123456789" : null);
  const placement = insert(`INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default)
    VALUES (?, ?, 'default', 1)`, mintPublicId("offer_placement"), id);
  return { id, placement };
}

function addAuction(variant: number) {
  const id = insert("INSERT INTO leadgen_auctions (public_id, auction_name, auction_type) VALUES (?, 'Life', 'static')", mintPublicId("auction"));
  db.prepare("UPDATE leadgen_funnel_variants SET auction_id = ? WHERE id = ?").run(id, variant);
  return id;
}

function linkOffer(auction: number, offer: ReturnType<typeof addOffer>, enabled = true) {
  db.prepare("INSERT INTO leadgen_auction_offers (auction_id, offer_placement_id, offer_id, enabled) VALUES (?, ?, ?, ?)")
    .run(auction, offer.placement, offer.id, Number(enabled));
}

const sectionContent = { components: [{
  type: "TwoButtonYesNo", question_id: "q1", question_key: "insured_q", internal_field: "insured", answer_type: "boolean",
}] };

async function addSection(extra: Record<string, unknown> = {}) {
  const data = await write("POST", "sections", {
    section_name: "Intake", activity: "quote_funnel", vertical: "life", headline_text: "Insured?",
    content_json: sectionContent, ...extra,
  }, 201);
  return Number(data.id);
}

function attachSection(section: number, variant: number) {
  db.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (?, ?, 0)")
    .run(variant, section);
}

describe("section shells", () => {
  it.each([
    ["content", { content: { components: [{ ...sectionContent.components[0], question_key: "new_key" }] } }],
    ["headline", { headline_text: "Currently insured?" }],
    ["subheadline", { subheadline_text: "Your current coverage" }],
    ["continue mode", { continue_mode: "auto_advance" }],
    ["appearance", { design_overrides: { columnsDefault: 3 } }],
    ["address validation", { address_validation_enabled: true }],
    ["answer maps", { answer_maps: [] }],
    ["offer selection", { selected_offers: [] }],
  ] as const)("changing %s refreshes direct and shared consumers once", async (_field, body) => {
    const direct = consumer();
    const shared = consumer();
    const second = addVariant(shared.funnel);
    const unrelated = consumer();
    const archived = consumer();
    const id = await addSection();
    attachSection(id, direct.variant);
    attachSection(id, shared.variant);
    attachSection(id, archived.variant);
    db.prepare("UPDATE leadgen_funnel_variants SET status = 'archived' WHERE id = ?").run(archived.variant);
    db.prepare("INSERT INTO leadgen_funnel_variant_sections (quote_id, section_id, position) VALUES (?, ?, 0)")
      .run(shared.quote, id);
    const variants = [direct.variant, shared.variant, second];
    const atPurge: number[][] = [];
    change.mockImplementation(async () => { atPurge.push(variants.map(version)); });
    await write("PATCH", "sections/" + id, body);
    expectChange({ variantIds: variants });
    expect(atPurge).toEqual([[2, 2, 2]]);
    expect([unrelated.variant, archived.variant].map(version)).toEqual([1, 1]);
  });

  it("refreshes a mapped section when a rename replaces its answer-map IDs", async () => {
    const { variant } = consumer();
    const offer = addOffer();
    const field = { path: "data.insured", name: "insured", type: "boolean", required: true, source: "answer", internal_field: "insured" };
    await write("POST", `offers/${offer.id}/payload-schemas`, { schema_json: { version: 1, root: { type: "object", children: [field] } } }, 201);
    const id = await addSection({ answer_maps: [{ question_id: "q1", offer_id: offer.id, offer_payload_field_path: field.path,
      provider_expected_type: "boolean", required_for_offer: true, output_value_map: { true: true, false: false } }] });
    attachSection(id, variant);
    const marker = () => (db.prepare("SELECT MAX(id) AS marker FROM leadgen_section_answer_maps WHERE section_id = ?")
      .get(id) as { marker: number }).marker;
    const before = marker();
    await write("PATCH", "sections/" + id, { section_name: "New library name" });
    expect(marker()).toBeGreaterThan(before);
    expectChange({ variantIds: [variant] });
  });

  it("picks up a placement added while the section save is being validated", async () => {
    const { variant } = consumer();
    const id = await addSection();
    const batch = env.DB.batch.bind(env.DB);
    vi.spyOn(env.DB, "batch").mockImplementationOnce(statements => {
      attachSection(id, variant);
      return batch(statements);
    });
    await write("PATCH", "sections/" + id, { headline_text: "New headline" });
    expectChange({ variantIds: [variant] });
    expect(version(variant)).toBe(2);
  });

  it("library-only writes, unattached content and refused deletes have no consumers to purge", async () => {
    const { variant } = consumer();
    const id = await addSection();
    attachSection(id, variant);
    await write("PATCH", "sections/" + id, { section_name: "Library name" });
    expectChange({ variantIds: [variant] });
    change.mockClear();
    await write("DELETE", "sections/" + id, undefined, 409);
    const copy = await write("POST", `sections/${id}/duplicate`, {}, 201);
    await write("PATCH", "sections/" + copy.id, { headline_text: "Unused headline" });
    await write("DELETE", "sections/" + copy.id);
    expect(change).not.toHaveBeenCalled();
    expect(version(variant)).toBe(1);
  });
});

describe("frames and templates", () => {
  const frame = { version: 1, template: "minimal" };
  const theme = { version: 1, scales: { radius: "round" } };
  it.each([
    ["PUT", "frame", { frame_config_json: frame }],
    ["PUT", "theme", { theme_json: theme }],
    ["POST", "apply-template", { template_id: 2 }],
    ["POST", "apply-template", { template_id: null }],
  ] as const)("%s %s forwards the request context on the existing version bump (%j)", async (method, route, body) => {
    const live = consumer();
    const unrelated = consumer();
    db.prepare("UPDATE leadgen_funnels SET frame_template_id = 1 WHERE id = ?").run(live.funnel);
    const updated = await write(method, `funnels/${live.funnel}/${route}`, body);
    expect(updated.bumped_variants).toBe(1);
    expectChange({ funnelIds: [live.funnel] });
    expect([live.variant, unrelated.variant].map(version)).toEqual([2, 1]);
  });

  it("identical frame and theme saves, dry runs and inactive funnels do not purge", async () => {
    const live = consumer();
    db.prepare("UPDATE leadgen_funnels SET frame_config_json = ?, theme_json = ? WHERE id = ?")
      .run(JSON.stringify(frame), JSON.stringify(theme), live.funnel);
    await write("PUT", `funnels/${live.funnel}/frame`, { frame_config_json: frame });
    await write("PUT", `funnels/${live.funnel}/theme`, { theme_json: theme });
    await write("POST", `funnels/${live.funnel}/apply-template`, { template_id: 2, dry_run: true });
    expect(version(live.variant)).toBe(1);
    db.prepare("UPDATE leadgen_funnels SET status = 'draft' WHERE id = ?").run(live.funnel);
    await write("PUT", `funnels/${live.funnel}/frame`, { frame_config_json: { version: 1, template: "centered" } });
    expect(version(live.variant)).toBe(2);
    expect(change).not.toHaveBeenCalled();
  });

  it("editing a template refreshes only effective variant, funnel and per-quote references", async () => {
    const explicit = consumer();
    const inherited = consumer();
    const fallback = consumer();
    const overridden = addVariant(inherited.funnel, 2);
    const unrelated = consumer();
    db.prepare("UPDATE leadgen_funnel_variants SET frame_template_id = 1 WHERE id = ?").run(explicit.variant);
    db.prepare("UPDATE leadgen_funnels SET frame_template_id = 1 WHERE id = ?").run(inherited.funnel);
    db.prepare("INSERT INTO leadgen_quote_default_template (quote_public_id, frame_template_id) VALUES (?, 1)").run(fallback.publicId);
    await write("PATCH", "frame-template-records/1", { frame_json: frame }, 200, null);
    expectChange({ variantIds: [explicit.variant, inherited.variant, fallback.variant] }, null);
    expect([explicit.variant, inherited.variant, fallback.variant, overridden, unrelated.variant].map(version)).toEqual([2, 2, 2, 1, 1]);
  });

  it("deleting a template used only through a per-quote fallback refreshes its shell when deletion succeeds", async () => {
    db.prepare("PRAGMA foreign_keys = OFF").run();
    const fallback = consumer();
    const overridden = addVariant(fallback.funnel, 2);
    db.prepare("INSERT INTO leadgen_quote_default_template (quote_public_id, frame_template_id) VALUES (?, 1)").run(fallback.publicId);
    await write("DELETE", "frame-template-records/1");
    expect(db.prepare("SELECT id FROM leadgen_frame_templates WHERE id = 1").get()).toBeUndefined();
    expectChange({ variantIds: [fallback.variant] });
    expect([fallback.variant, overridden].map(version)).toEqual([2, 1]);
  });

  it("library changes, global default swaps and refused deletes preserve existing shells", async () => {
    const live = consumer();
    db.prepare("UPDATE leadgen_funnels SET frame_template_id = 1 WHERE id = ?").run(live.funnel);
    const created = await write("POST", "frame-template-records", { name: "Library", frame_json: frame }, 201);
    const copy = await write("POST", `frame-template-records/${created.id}/duplicate`, {}, 201);
    await write("PATCH", "frame-template-records/1", { name: "Renamed" });
    await write("PUT", `frame-template-records/${created.id}/default`);
    await write("DELETE", "frame-template-records/" + copy.id);
    await write("DELETE", "frame-template-records/1", undefined, 409);
    expect(change).not.toHaveBeenCalled();
    expect(version(live.variant)).toBe(1);
  });
});

function redirectRule(quote: number, offer: number, field?: string, status = "active") {
  const groups = field ? [{ field, op: "eq", value: "one" }] : [];
  db.prepare(`INSERT INTO leadgen_quote_routing_rules (public_id, quote_id, rule_name, status, conditions_json,
    conditions_hash, target_offer_id, redirect_pct) VALUES (?, ?, 'Redirect', ?, ?, 'hash', ?, 100)`)
    .run(mintPublicId("quote_routing_rule"), quote, status, JSON.stringify({ groups }), offer);
}

describe("auction participants and offers", () => {
  it("refreshes the variants of an auction gaining or losing its last tracking offer", async () => {
    const live = consumer();
    const auction = addAuction(live.variant);
    const pixel = consumer();
    db.prepare("UPDATE leadgen_funnel_variants SET auction_id = ? WHERE id = ?").run(auction, pixel.variant);
    db.prepare("UPDATE leadgen_funnels SET meta_pixel_id = ? WHERE id = ?").run("\t123456\u00a0", pixel.funnel);
    const first = addOffer(true);
    const second = addOffer(true);
    const path = `auctions/${auction}/offers`;
    await write("PUT", path, { offers: [{ offer_placement_id: first.placement }] });
    expectChange({ variantIds: [live.variant, pixel.variant] });
    change.mockClear();
    await write("PUT", path, { offers: [{ offer_placement_id: second.placement, static_order: 2 }] });
    expect(change).not.toHaveBeenCalled();
    await write("PUT", path, { offers: [{ offer_placement_id: second.placement, enabled: false }] });
    expectChange({ variantIds: [live.variant, pixel.variant] });
    expect([live.variant, pixel.variant].map(version)).toEqual([3, 1]);
  });

  it("one offer save merges shell consumers and entry redirect quotes using their separate dependencies", async () => {
    const offer = addOffer();
    const shell = consumer();
    const shared = consumer();
    const checkpoint = consumer();
    const disabled = consumer();
    const covered = consumer();
    const coveredAuction = addAuction(covered.variant);
    linkOffer(addAuction(shell.variant), offer);
    linkOffer(coveredAuction, offer);
    linkOffer(coveredAuction, addOffer(true));
    redirectRule(shared.quote, offer.id);
    redirectRule(shared.quote, offer.id, "utm_source");
    redirectRule(checkpoint.quote, offer.id, "insured");
    redirectRule(disabled.quote, offer.id, undefined, "disabled");
    await write("PATCH", "offers/" + offer.id, {
      banner_url_template: "https://provider.example/first", clickout_meta_conversion: true, clickout_meta_dataset_id: "123456",
    });
    expectChange({ variantIds: [shell.variant], quoteIds: [shared.quote] });
    expect([shell.variant, shared.variant, covered.variant].map(version)).toEqual([2, 1, 1]);
    change.mockClear();
    await write("PATCH", "offers/" + offer.id, { banner_url_template: "https://provider.example/second", clickout_meta_dataset_id: "654321" });
    expect(change).not.toHaveBeenCalled();
    await write("PATCH", "offers/" + offer.id, { banner_url_template: null });
    expectChange({ quoteIds: [shared.quote] });
    expect(version(shell.variant)).toBe(2);
  });

  it("archiving an offer removes the click script only from auctions that relied on it", async () => {
    const offer = addOffer(true);
    const live = consumer();
    const disabled = consumer();
    linkOffer(addAuction(live.variant), offer);
    linkOffer(addAuction(disabled.variant), offer, false);
    redirectRule(disabled.quote, offer.id);
    await write("DELETE", "offers/" + offer.id);
    expectChange({ variantIds: [live.variant] });
    expect([live.variant, disabled.variant].map(version)).toEqual([2, 1]);
    change.mockClear();
    await write("DELETE", "offers/" + offer.id);
    expect(change).not.toHaveBeenCalled();
  });

  it("uses the tracking offers and redirect URL present when the edited offer commits", async () => {
    const live = consumer();
    const auction = addAuction(live.variant);
    const edited = addOffer(true);
    const other = addOffer(true);
    linkOffer(auction, edited);
    linkOffer(auction, other);
    redirectRule(live.quote, edited.id);
    const batch = env.DB.batch.bind(env.DB);
    vi.spyOn(env.DB, "batch").mockImplementationOnce(statements => {
      // A second publisher commits after validation, while the edited offer
      // still supplies the script. Our write removes the last contributor.
      db.prepare("UPDATE leadgen_offers SET status = 'archived' WHERE id = ?").run(other.id);
      db.prepare("UPDATE leadgen_offers SET banner_url_template = 'https://provider.example/' WHERE id = ?").run(edited.id);
      return batch(statements);
    });
    await write("PATCH", "offers/" + edited.id, { status: "archived", banner_url_template: null });
    expectChange({ variantIds: [live.variant], quoteIds: [live.quote] });
    expect(version(live.variant)).toBe(2);
  });

  it("auction settings, banner settings and provider-only edits leave a referenced shell alone", async () => {
    const live = consumer();
    const auction = addAuction(live.variant);
    const offer = addOffer(true);
    linkOffer(auction, offer);
    await write("PATCH", "auctions/" + auction, { floor_value: 12 });
    await write("PUT", `auctions/${auction}/banner`, { mode: "automatic", field_map: {} });
    await write("PATCH", "offers/" + offer.id, { provider: "New provider" });
    await write("PUT", `auctions/${auction}/offers`, { offers: [{ offer_placement_id: 99999 }] }, 400);
    expect(change).not.toHaveBeenCalled();
    expect(version(live.variant)).toBe(1);
  });
});
