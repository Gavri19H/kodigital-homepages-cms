import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it } from "vitest";
import { computeAttemptBindingExtras, readLiveAttemptConfig } from "../src/public/leadgen/attempt";
import { computeSectionOrderHash } from "../src/public/leadgen/config-dto";
import { resolveActivatedFunnel, sectionsFromPages } from "../src/public/leadgen/resolver";
import {
  buildLeadgenEnv, createLeadgenDb, d1FromSqlite, loadDatabaseSync, makeKvStub, type SqliteDb,
} from "./helpers/leadgen-analytics-harness";

const site = "site-1";
const publicId = (prefix: string, n: number) => prefix + "_" + String(n).padStart(26, "0");
const variant = publicId("lgn", 1);

interface PageShape {
  direct?: number[];
  slots?: number[][];
}
interface Layout {
  legacy?: number[];
  pages?: PageShape[];
}

const slotted: PageShape = { slots: [[3, 1], [], [3, 2]], direct: [4] };
const variantLayouts: Record<string, Layout> = {
  absent: {},
  legacy: { legacy: [2, 3, 2, 1] },
  empty: { pages: [{}, { slots: [[]] }] },
  // Only quote-owned slotless pages turn direct attachments into fixed slots.
  direct: { pages: [{ direct: [2, 1, 2, 3] }, { direct: [4] }] },
  slotted: { pages: [slotted, { slots: [[4]] }], legacy: [1] },
};
const sharedLayouts = {
  ...variantLayouts,
  mixed: { pages: [{ direct: [4, 1] }, slotted, {}, { direct: [3] }] },
};

// Cross the two owners independently. A real page suppresses only its own
// owner's legacy fallback. Footer picks load site pages alongside the funnel.
const cases = Object.entries(sharedLayouts).flatMap(([sharedName, shared]) =>
  Object.entries(variantLayouts).flatMap(([armName, arm]) =>
    [false, true].map(footer => ({ sharedName, shared, armName, arm, footer }))));

let sql: SqliteDb;

beforeEach(() => {
  const DatabaseSync = loadDatabaseSync();
  if (!DatabaseSync) throw new Error("node:sqlite is required for section order parity");
  sql = createLeadgenDb(DatabaseSync);
  for (const file of ["0055_leadgen_quote_default_template.sql", "0061_leadgen_routing_present_only_offer.sql"]) {
    (sql.exec as (query: string) => void)(readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"));
  }
  sql.prepare("CREATE TABLE site_settings (site_id TEXT, key TEXT, value TEXT)").run();
  sql.prepare(`CREATE TABLE pages (id INTEGER PRIMARY KEY, site_id TEXT, slug TEXT, page_type TEXT,
    status TEXT, show_in_footer INTEGER, display_order INTEGER)`).run();
  sql.prepare("INSERT INTO pages VALUES (1, ?, 'policy', 'legal', 'published', 1, 0)").run(site);
  sql.prepare(`INSERT INTO leadgen_quotes (id, public_id, quote_name, activity, verticals_json, status)
    VALUES (1, ?, 'Life', 'quote_funnel', '["life"]', 'active')`).run(publicId("lgq", 1));
  sql.prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug) VALUES (?, 1, 1, 'life')").run(site);
  sql.prepare("INSERT INTO leadgen_funnels (id, public_id, quote_id, funnel_name, status) VALUES (1, ?, 1, 'Life', 'active')")
    .run(publicId("lgf", 1));
  sql.prepare(`INSERT INTO leadgen_auctions (id, public_id, auction_name, auction_type, carrier_normalization_version)
    VALUES (1, ?, 'Offers', 'static', 7)`).run(publicId("lga", 1));
  sql.prepare("INSERT INTO leadgen_funnel_variants (id, public_id, funnel_id, auction_id, content_version) VALUES (1, ?, 1, 1, 9)")
    .run(variant);
  const section = sql.prepare(`INSERT INTO leadgen_sections
    (id, public_id, section_name, activity, vertical, headline_text, content_json, content_version)
    VALUES (?, ?, 'Question', 'quote_funnel', 'life', 'Question', '{"components":[]}', ?)`);
  const mapping = sql.prepare(`INSERT INTO leadgen_section_answer_maps
    (id, public_id, section_id, question_id, question_key, internal_field, answer_type, offer_id,
     payload_schema_id, payload_schema_public_id, offer_payload_field_path, provider_expected_type)
    VALUES (?, ?, ?, 'q_zip', 'zip', 'zip', 'string', 1, 1, 'schema', 'zip', 'string')`);
  for (let n = 1; n <= 8; n++) {
    section.run(n, publicId("lgs", n), n + 10);
    if (n % 2 === 0) {
      for (const version of [n * 10, n * 10 + 1]) mapping.run(version, publicId("lgm", version), n);
    }
  }
});
afterEach(() => sql.close());

function seedLayout(owner: "shared" | "variant", layout: Layout) {
  const shared = owner === "shared";
  const quoteId = shared ? 1 : null;
  const variantId = shared ? null : 1;
  const page = sql.prepare("INSERT INTO leadgen_funnel_pages (id, public_id, quote_id, variant_id, position) VALUES (?, ?, ?, ?, ?)");
  const slot = sql.prepare(`INSERT INTO leadgen_funnel_page_slots
    (id, page_id, position, rules_json, ab_allocations_json) VALUES (?, ?, ?, ?, ?)`);
  const placement = sql.prepare(`INSERT INTO leadgen_funnel_variant_sections
    (quote_id, variant_id, section_id, page_id, slot_id, position) VALUES (?, ?, ?, ?, ?, ?)`);
  let nextPosition = 0;
  function attach(sections: number[], pageId: number | null, slotId: number | null) {
    // Candidate order follows the attachment ID. Direct and legacy order
    // follow position. Give the two orderings opposite values in every group.
    const insertionOrder = slotId === null ? [...sections].reverse() : sections;
    for (const [i, n] of insertionOrder.entries()) {
      placement.run(quoteId, variantId, shared ? n : n + 4, pageId, slotId, nextPosition + sections.length - 1 - i);
    }
    nextPosition += sections.length;
  }
  attach(layout.legacy ?? [], null, null);
  // Seed the last page and slot first so sorting by placement ID alone
  // also disagrees with the authored order across pages and slots.
  const pages = layout.pages ?? [];
  for (const [pagePos, shape] of [...pages.entries()].reverse()) {
    const pageId = (shared ? 100 : 10) + pages.length - pagePos;
    page.run(pageId, publicId("lgpg", pageId), quoteId, variantId, pagePos);
    attach(shape.direct ?? [], pageId, null);
    const slots = shape.slots ?? [];
    for (const [slotPos, candidates] of [...slots.entries()].reverse()) {
      const slotId = pageId * 10 + slots.length - slotPos;
      const [first, second] = candidates.map(n => shared ? n : n + 4);
      const rules = second !== undefined && slotPos === 0 ? JSON.stringify({
        cases: [{ conditions: { groups: [{ field: "state", op: "eq", value: "CA" }] }, section_id: second }],
        default_section_id: first,
      }) : null;
      const ab = second !== undefined && slotPos === 2
        ? JSON.stringify([{ section_id: second, bp: 6000 }, { section_id: first, bp: 4000 }]) : null;
      slot.run(slotId, pageId, slotPos, rules, ab);
      attach(candidates, pageId, slotId);
    }
  }
}

it.each(cases)("matches the resolver for shared=$sharedName, variant=$armName, footer picks=$footer", async ({
  shared, arm, footer,
}) => {
  seedLayout("variant", arm);
  seedLayout("shared", shared);
  if (footer) {
    const picks = [{ page_type: "legal", slug: "policy", label: "Policy" }];
    const frame = { footer: { enabled: true, blocks: [{ type: "link_row", links_source: "picked", picks }] } };
    sql.prepare("UPDATE leadgen_funnels SET frame_config_json = ? WHERE id = ?").run(JSON.stringify(frame), 1);
  }
  const db = d1FromSqlite(sql);
  const env = buildLeadgenEnv(db, makeKvStub().kv);
  const resolved = await resolveActivatedFunnel(env, { site_id: site, quote_slug: "life" });
  if (!resolved?.pages) throw new Error("Expected an active funnel with resolved pages");
  expect(resolved.site_branding?.legal_links).toEqual(footer ? [{ label: "Policy", href: "/policy" }] : []);
  const reference = { ...resolved, sections: sectionsFromPages(resolved.pages) };

  // Native D1 returns the SELECT rows in a batch. Keep the actual rows fed
  // to the signer so an ordering failure shows the misplaced section IDs.
  let sqlSections: unknown[] | undefined;
  db.batch = async <T>(statements: D1PreparedStatement[]) => {
    const results = await Promise.all(statements.map(stmt => stmt.all<T>()));
    sqlSections = results[1]?.results;
    return results;
  };
  const live = await readLiveAttemptConfig(db, site, variant);
  expect(sqlSections).toEqual(reference.sections.map(({ section }) => expect.objectContaining({
    public_id: section.public_id, content_version: section.content_version,
  })));
  expect(live?.binding).toEqual({
    funnel_variant_id: resolved.variant.public_id,
    content_version: resolved.variant.content_version,
    section_order_hash: computeSectionOrderHash(reference),
    ...await computeAttemptBindingExtras(env, reference),
  });
});
