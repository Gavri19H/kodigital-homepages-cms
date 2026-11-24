import { expect, it, onTestFinished, vi } from "vitest";
import { D1Timing, sessionReadDb } from "../src/db/read-session";
import type { LeadgenSnapshotEntry } from "../src/edge/leadgen-select";
import type { ListicleSnapshotRow } from "../src/edge/listicle-select";
import { buildSiteSnapshot } from "../src/edge/snapshot";
import type { SiteSnapshot } from "../src/edge/types";
import type { Env } from "../src/env";
import {
  getActiveFunnelsForQuote, getQuoteById, loadFunnelEntryVariants, loadOfferEntryRedirectLocation, readQuoteRoutingRules,
} from "../src/public/leadgen/resolver";
import { controlVersion } from "../src/public/listicle/experiment-pick";
import { resolveSiteByHostname } from "../src/site/site-context";
import { addSite, createDb, env as sqliteEnv, type SqliteDb } from "./helpers/x06-a2-sqlite";

const siteId = "snapshot-site";
const host = siteId + ".example";

function publicId(prefix: string, n: number): string {
  return prefix + "_" + String(n).padStart(26, "0");
}

function seed(sql: SqliteDb) {
  addSite(sql, siteId, "Snapshot", "home");
  addSite(sql, "neighbor", "Neighbor", "home");
  sql.prepare("INSERT INTO domains (site_id, hostname, status) VALUES (?, ?, 'active')").run(siteId, host);
  sql.prepare("UPDATE sites SET content_version = 17, settings_version = 8, write_bookmark = ? WHERE id = ?")
    .run("last-publish", siteId);
  const setting = sql.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?)");
  setting.run(siteId, "site_timezone", " America/New_York ");
  setting.run(siteId, "site_language", " en-US ");

  const article = sql.prepare(`INSERT INTO listicle_articles (id, site_id, public_id, slug, article_name, status, active_experiment_id)
    VALUES (?, ?, ?, ?, 'Article', 'published', ?)`);
  const experiment = sql.prepare(`INSERT INTO listicle_article_experiments (id, article_id, public_id, name, status)
    VALUES (?, ?, ?, 'Test', 'running')`);
  const version = sql.prepare(`INSERT INTO listicle_article_versions
    (article_id, public_id, experiment_id, variant_label, is_control, traffic_allocation, status, headline, intro_paragraph)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Title', 'Intro')`);
  for (const [id, site, slug] of [[1, siteId, "z-guide"], [2, siteId, "a-guide"], [3, "neighbor", "z-guide"]] as const) {
    article.run(id, site, "art_" + id, slug, id);
    experiment.run(id, id, "exp_" + id);
    version.run(id, "ver_old_" + id, id, "Old", 0, 100, "archived");
    version.run(id, "ver_outside_" + id, null, "Outside", 0, 100, "active");
    version.run(id, "ver_z_" + id, id, "Z", 0, 25, "active");
    version.run(id, "ver_a_" + id, id, "A", 1, 75, "active");
  }

  const quote = sql.prepare(`INSERT INTO leadgen_quotes (id, public_id, quote_name, activity, verticals_json, status)
    VALUES (?, ?, 'Quote', 'quote_funnel', '["life"]', 'active')`);
  const activation = sql.prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, slug, enabled) VALUES (?, ?, ?, ?)");
  for (const id of [1, 2, 3, 4]) quote.run(id, publicId("lgq", id));
  activation.run(siteId, 1, "life", 1);
  activation.run(siteId, 2, null, 1);
  activation.run(siteId, 3, "disabled", 0);
  activation.run(siteId, 4, "bad/slug", 1);
  activation.run("neighbor", 3, "life", 1);

  const funnel = sql.prepare(`INSERT INTO leadgen_funnels (id, quote_id, public_id, funnel_name, display_order, status)
    VALUES (?, ?, ?, 'Funnel', ?, ?)`);
  funnel.run(11, 1, publicId("lgf", 11), null, "active");
  funnel.run(12, 1, publicId("lgf", 12), 1, "active");
  funnel.run(13, 1, publicId("lgf", 13), 0, "archived");
  funnel.run(21, 2, publicId("lgf", 21), 1, "active");
  funnel.run(22, 2, publicId("lgf", 22), 1, "active"); // Active funnel with no variants.
  funnel.run(31, 3, publicId("lgf", 31), 1, "active");
  sql.prepare("UPDATE leadgen_quotes SET default_funnel_id = ? WHERE id = ?").run(11, 1);
  const ab = sql.prepare(`INSERT INTO leadgen_funnel_ab_tests (funnel_id, public_id, name, revision, status)
    VALUES (?, ?, 'Split', ?, ?)`);
  ab.run(11, publicId("lgx", 11), 7, "running");
  ab.run(21, publicId("lgx", 21), 2, "running");
  ab.run(12, publicId("lgx", 12), 4, "stopped");
  const variant = sql.prepare(`INSERT INTO leadgen_funnel_variants (funnel_id, public_id, variant_label, traffic_allocation_bp, status)
    VALUES (?, ?, ?, ?, ?)`);
  for (const id of [11, 12, 13, 21, 31]) {
    variant.run(id, publicId("lgn", id * 10 + 1), "B", 7500, "active");
    variant.run(id, publicId("lgn", id * 10 + 2), "A", 2500, "active");
    variant.run(id, publicId("lgn", id * 10 + 3), "0", 10000, "archived");
  }

  const offer = sql.prepare(`INSERT INTO leadgen_offers
    (id, public_id, offer_name, activity, vertical, conversion_tracking_method, offer_type, banner_url_template)
    VALUES (?, ?, 'Offer', 'quote_funnel', 'life', 's2s_postback', 'cpc', ?)`);
  offer.run(1, publicId("lgo", 1), "https://offer.example/{click_id}");
  offer.run(2, publicId("lgo", 2), null);
  offer.run(3, publicId("lgo", 3), "https://other.example/go");
  const rule = sql.prepare(`INSERT INTO leadgen_quote_routing_rules
    (quote_id, public_id, rule_name, conditions_hash, priority, conditions_json, target_offer_id, redirect_pct, status)
    VALUES (?, ?, 'Rule', ?, ?, ?, ?, 75, ?)`);
  const entry = '{"groups":[{"field":"state","op":"eq","value":"CA"}]}';
  rule.run(1, publicId("lgqr", 1), "go", 3, entry, 1, "active");
  rule.run(1, publicId("lgqr", 2), "provider", 2, "malformed JSON", 2, "active");
  rule.run(1, publicId("lgqr", 3), "same offer", 3, entry, 1, "active");
  rule.run(1, publicId("lgqr", 4), "disabled", 1, entry, 3, "disabled");
  rule.run(2, publicId("lgqr", 5), "checkpoint", 2, '{"groups":[{"field":"age","op":"gt","value":18}]}', 3, "active");
  rule.run(2, publicId("lgqr", 6), "root", 4, entry, 1, "active");
  rule.run(3, publicId("lgqr", 7), "neighbor", 1, entry, 2, "active");
}

// Reference reads from 19bc4063. Keep them independent of the batched SQL and its assemblers.
async function previousListicles(db: D1Database, id: string) {
  const { results } = await db.prepare(`
    SELECT a.slug, a.public_id AS listicle_id, e.public_id AS experiment_id,
           CASE WHEN v.experiment_id = e.id THEN 1 ELSE 0 END AS is_arm,
           v.public_id, v.variant_label, v.is_control, v.traffic_allocation
    FROM listicle_articles a
    JOIN listicle_article_versions v ON v.article_id = a.id AND v.status = 'active'
    LEFT JOIN listicle_article_experiments e ON e.id = a.active_experiment_id AND e.status = 'running'
    WHERE a.site_id = ? AND a.status = 'published' ORDER BY a.id, v.id`).bind(id).all<ListicleSnapshotRow>();
  const bySlug = new Map<string, ListicleSnapshotRow[]>();
  for (const row of results) {
    const versions = bySlug.get(row.slug);
    if (versions) versions.push(row);
    else bySlug.set(row.slug, [row]);
  }
  function version({ public_id, variant_label, is_control, traffic_allocation }: ListicleSnapshotRow) {
    return { public_id, variant_label, is_control, traffic_allocation };
  }
  const entries: Record<string, unknown> = Object.create(null);
  for (const [slug, versions] of bySlug) {
    const control = controlVersion(versions)!;
    entries[slug] = {
      listicleId: control.listicle_id, publishedVersion: version(control),
      experiment: control.experiment_id === null ? null : {
        publicId: control.experiment_id, versions: versions.filter(v => v.is_arm === 1).map(version),
      },
    };
  }
  return entries;
}

async function previousLeadgen(db: D1Database, id: string) {
  const activations = await db.prepare("SELECT slug, quote_id FROM leadgen_site_quotes WHERE site_id = ? AND enabled = 1")
    .bind(id).all<{ slug: string | null; quote_id: number }>();
  const entries: Record<string, LeadgenSnapshotEntry> = Object.create(null);
  for (const { slug, quote_id } of activations.results) {
    if (slug === "" || slug?.includes("/")) continue;
    const quote = await getQuoteById(db, quote_id);
    if (quote === null) continue;
    const [activeFunnels, rules] = await Promise.all([getActiveFunnelsForQuote(db, quote.id), readQuoteRoutingRules(db, quote.id)]);
    const funnels = await Promise.all(activeFunnels.map(async ({ id }) => {
      const { abTest, variants } = await loadFunnelEntryVariants(db, id);
      return {
        id, abTest: abTest === null ? null : { public_id: abTest.public_id, revision: abTest.revision },
        variants: variants.map(({ public_id, variant_label, traffic_allocation_bp }) => ({ public_id, variant_label, traffic_allocation_bp })),
      };
    }));
    const offerLocations: Record<number, string | null> = {};
    for (const rule of rules) {
      const offer = rule.target_offer_id;
      if (rule.entry_only && offer !== null && !Object.hasOwn(offerLocations, offer)) {
        offerLocations[offer] = await loadOfferEntryRedirectLocation(db, offer);
      }
    }
    entries[slug ?? "/lg"] = { quoteId: quote.public_id, defaultFunnelId: quote.default_funnel_id ?? null, funnels, rules, offerLocations };
  }
  return entries;
}

async function previousSnapshot(env: Env, hostname: string): Promise<SiteSnapshot | null> {
  const db = sessionReadDb(env.DB, env.DB.withSession?.("first-primary"));
  const site = await resolveSiteByHostname(db, hostname, env);
  if (!site) return null;
  const id = site.site_id;
  const [versions, settings, listicles, leadgen] = await Promise.all([
    db.prepare("SELECT content_version, settings_version, write_bookmark FROM sites WHERE id = ?").bind(id)
      .first<{ content_version: number; settings_version: number; write_bookmark: string | null }>(),
    db.prepare("SELECT key, value FROM site_settings WHERE site_id = ? AND key IN ('site_timezone', 'site_language')")
      .bind(id).all<{ key: string; value: string | null }>(),
    previousListicles(db, id),
    previousLeadgen(db, id),
  ]);
  if (!versions) throw new Error("Missing versions for resolved site " + id);
  let timeZone = "";
  let language = "";
  for (const { key, value } of settings.results) {
    if (typeof value !== "string") continue;
    if (key === "site_timezone") timeZone = value.trim();
    if (key === "site_language") language = value.trim();
  }
  return {
    v: 1, siteId: id, hostname: site.hostname, status: site.status, contentVersion: versions.content_version,
    settingsVersion: versions.settings_version, writeBookmark: versions.write_bookmark,
    timeZone, language, listicles, leadgen, builtAt: Date.now(),
  };
}

function measuredEnv(sql: SqliteDb) {
  const env = sqliteEnv(sql);
  const timing = new D1Timing();
  const batches: number[] = [];
  const session: D1DatabaseSession = {
    prepare: env.DB.prepare.bind(env.DB),
    batch<T>(statements: D1PreparedStatement[]) {
      batches.push(statements.length);
      return Promise.all(statements.map(stmt => stmt.all<T>()));
    },
    getBookmark: () => null,
  };
  const withSession = vi.fn((_anchor?: string) => session);
  // Wrap the binding itself so measurement also sees calls outside the builder's optional timing argument.
  env.DB.withSession = withSession;
  env.DB = sessionReadDb(env.DB, undefined, timing);
  return { env, timing, batches, withSession };
}

it.each([
  { fixture: "one quote", slugs: ["life"], rounds: 7, calls: 14 },
  { fixture: "two quotes", slugs: ["/lg", "life"], rounds: 11, calls: 22 },
])("preserves existing snapshot fields byte for byte for $fixture in two rounds (previously $rounds rounds and $calls calls)", async ({ slugs, rounds, calls }) => {
  const sql = createDb();
  onTestFinished(() => sql.close());
  seed(sql);
  if (slugs.length === 1) {
    sql.prepare("UPDATE leadgen_site_quotes SET enabled = 0 WHERE site_id = ? AND slug IS NULL").run(siteId);
  }
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 10, 24));
  onTestFinished(() => clock.mockRestore());
  const before = measuredEnv(sql);
  const after = measuredEnv(sql);
  const expected = await previousSnapshot(before.env, host);
  const actual = await buildSiteSnapshot(after.env, host);
  expect(actual).toMatchObject({
    listicles: { "z-guide": { experiment: { publicId: "exp_1" } }, "a-guide": { experiment: { publicId: "exp_2" } } },
    leadgen: { life: { offerLocations: { 1: "/lg/lc/" + publicId("lgo", 1), 2: null } } },
  });
  expect(Object.keys(actual!.leadgen).sort()).toEqual(slugs);
  const { verticalSlug, ...existingFields } = actual!;
  expect(verticalSlug).toBe("home");
  expect(existingFields).toStrictEqual(expected);
  expect(JSON.stringify(existingFields)).toBe(JSON.stringify(expected));
  expect(after.withSession).toHaveBeenCalledExactlyOnceWith("first-primary");
  expect(before.timing).toMatchObject({ rounds, calls });
  expect(after.timing).toMatchObject({ rounds: 2, calls: 2 });
  expect(after.batches).toEqual([7]);
});
