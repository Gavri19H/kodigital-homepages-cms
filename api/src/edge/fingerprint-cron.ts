import { listicleBlocksToHtml } from "../editor/listicle-blocks";
import type { Env } from "../env";
import { sha256Hex } from "../leadgen/meta-hash";
import { collectOfferRefs } from "../public/listicle/governed-url";
import { onPublicChange } from "./public-change";
import { siteTag } from "./tags";

const FINGERPRINT_KEY = "edge:fp:v1";
const VERSION_KEY = "edge:ver:v1";

// A NULL owner contributes to the shared fingerprint (including legacy global pages and redirects).
// Keep the aggregates separate by table. A busy table's timestamp must not hide another table's edit.
// For small mutable tables without an update clock, include the ordered public fields or revision.
const FINGERPRINTS = [
  // Tenant content
  `SELECT s.id AS site_id, 'site' AS source, json_array(s.name, s.domain, s.status, s.vertical_slug, v.name) AS value
      FROM sites s LEFT JOIN verticals v ON v.slug = s.vertical_slug
    UNION ALL
    SELECT site_id, 'articles', json_array(MAX(updated_at), COUNT(*), SUM(updated_at))
      FROM articles WHERE status = 'published' AND site_id IS NOT NULL GROUP BY site_id
    UNION ALL
    SELECT site_id, 'pages', json_array(MAX(updated_at), COUNT(*), SUM(updated_at))
      FROM pages WHERE status = 'published' GROUP BY site_id
    UNION ALL
    SELECT site_id, 'media', json_array(MAX(COALESCE(updated_at, created_at)), COUNT(*), SUM(COALESCE(updated_at, created_at)))
      FROM media GROUP BY site_id
    UNION ALL
    SELECT site_id, 'domains', json_array(MAX(updated_at), COUNT(*), SUM(updated_at))
      FROM domains WHERE status = 'active' GROUP BY site_id
    ORDER BY site_id, source`,
  // Settings and taxonomy
  `SELECT site_id, 'settings' AS source, json_group_array(json_array(key, value) ORDER BY key) AS value
      FROM site_settings WHERE site_id IS NOT NULL GROUP BY site_id
    UNION ALL
    SELECT site_id, 'redirects', json_group_array(json_array(source_path, destination_path, status_code) ORDER BY id)
      FROM redirects WHERE is_active = 1 GROUP BY site_id
    UNION ALL
    SELECT site_id, 'tags', json_group_array(json_array(id, slug, name) ORDER BY id) FROM tags GROUP BY site_id
    UNION ALL
    SELECT a.site_id, 'article_tags', json_array(COUNT(*), SUM(at.article_id), SUM(at.tag_id), SUM(at.article_id * at.tag_id))
      FROM article_tags at JOIN articles a ON a.id = at.article_id
      WHERE a.status = 'published' AND a.site_id IS NOT NULL GROUP BY a.site_id
    UNION ALL
    SELECT site_id, 'site_categories', json_group_array(json_array(category_id, display_order) ORDER BY category_id)
      FROM site_categories GROUP BY site_id
    ORDER BY site_id, source`,
  // Shared categories and site activations
  `SELECT NULL AS site_id, 'categories' AS source, json_group_array(json_array(id, slug, name, description, parent_id, featured_image_id,
      display_order, show_on_homepage) ORDER BY id) AS value
      FROM categories
    UNION ALL
    SELECT site_id, 'activations', json_array(MAX(updated_at), COUNT(*), SUM(updated_at))
      FROM leadgen_site_quotes WHERE enabled = 1 GROUP BY site_id
    UNION ALL
    SELECT site_id, 'listicles', json_array(MAX(updated_at), COUNT(*), SUM(updated_at))
      FROM listicle_articles WHERE status = 'published' GROUP BY site_id
    ORDER BY site_id, source`,
  // Site-owned listicle configuration
  `WITH version_sites AS (
    SELECT v.id, a.site_id FROM listicle_article_versions v JOIN listicle_articles a ON a.id = v.article_id
    WHERE a.status = 'published'
  ), page_sites AS (
    SELECT p.id, v.site_id FROM listicle_pages p JOIN version_sites v ON v.id = p.article_version_id
  )
    SELECT a.site_id AS site_id, 'experiments' AS source, json_array(MAX(e.created_at), COUNT(*),
      json_group_array(json_array(e.id, e.status, e.started_at, e.stopped_at) ORDER BY e.id)) AS value
      FROM listicle_article_experiments e JOIN listicle_articles a ON a.id = e.article_id
      WHERE a.status = 'published' GROUP BY a.site_id
    UNION ALL
    SELECT s.site_id, 'listicle_versions', json_array(MAX(v.created_at), COUNT(*),
      json_group_array(json_array(v.id, v.content_version, v.experiment_id, v.is_control, v.traffic_allocation, v.status) ORDER BY v.id))
      FROM listicle_article_versions v JOIN version_sites s ON s.id = v.id GROUP BY s.site_id
    UNION ALL
    SELECT s.site_id, 'listicle_pages', json_array(MAX(p.created_at), COUNT(*), SUM(p.id))
      FROM listicle_pages p JOIN version_sites s ON s.id = p.article_version_id GROUP BY s.site_id
    UNION ALL
    SELECT s.site_id, 'listicle_candidates', json_array(MAX(c.created_at), COUNT(*), SUM(c.id))
      FROM listicle_page_section_candidates c JOIN page_sites s ON s.id = c.page_id GROUP BY s.site_id
    UNION ALL
    SELECT s.site_id, 'listicle_rules', json_array(MAX(r.created_at), COUNT(*), SUM(r.id))
      FROM listicle_page_rules r JOIN page_sites s ON s.id = r.page_id GROUP BY s.site_id
    ORDER BY site_id, source`,
  // Shared listicle configuration. Keep the v1 totals and the public resource
  // revisions needed to find consumers of edits, deletions and moved links.
  `SELECT NULL AS site_id, 'listicle_sections' AS source, json_array(MAX(updated_at), COUNT(*), SUM(updated_at), SUM(content_version)) AS value,
      json_group_object(id, updated_at || '/' || content_version) AS members
      FROM listicle_sections
    UNION ALL
    SELECT NULL, 'listicle_offers', json_array(MAX(updated_at), COUNT(*), SUM(updated_at)),
      json_group_object(id || ':' || public_id, CAST(updated_at AS TEXT)) FROM listicle_offers
    UNION ALL
    SELECT NULL, 'listicle_links', json_array(MAX(updated_at), COUNT(*), SUM(updated_at), SUM(id)),
      json_group_object(id || ':' || section_id, CAST(updated_at AS TEXT)) FROM listicle_section_link_instances
    ORDER BY site_id, source`,
  // Leadgen entry and routing
  `SELECT NULL AS site_id, 'quotes' AS source, json_array(MAX(updated_at), COUNT(*), SUM(updated_at)) AS value
      FROM leadgen_quotes
    UNION ALL
    SELECT NULL, 'funnels', json_array(MAX(updated_at), COUNT(*), SUM(updated_at)) FROM leadgen_funnels
    UNION ALL
    SELECT NULL, 'variants', json_array(MAX(created_at), COUNT(*),
      json_group_array(json_array(id, content_version, status, ab_test_id, traffic_allocation_bp) ORDER BY id)) FROM leadgen_funnel_variants
    UNION ALL
    SELECT NULL, 'ab_tests', json_array(MAX(created_at), COUNT(*), SUM(revision), MAX(started_at), MAX(stopped_at)) FROM leadgen_funnel_ab_tests
    UNION ALL
    SELECT NULL, 'quote_rules', json_array(MAX(created_at), COUNT(*), json_group_array(json_array(id, quote_id, priority, status,
      conditions_hash, match_mode, checkpoint_page, target_funnel_id, feed_name, value_multiplier, redirect_pct, target_offer_id,
      redirect_url, redirect_url_allowlisted, force_offer_id) ORDER BY id)) FROM leadgen_quote_routing_rules
    ORDER BY site_id, source`,
  // Leadgen rules and pages
  `SELECT NULL AS site_id, 'funnel_rules' AS source, json_array(MAX(created_at), COUNT(*), json_group_array(json_array(id, variant_id, priority, status,
      enabled, conditions_hash, match_mode, rule_type, checkpoint_page, target_offer_id, target_section_id, target_funnel_variant_id,
      value_multiplier, redirect_url, redirect_url_allowlisted, redirect_pct, redirect_show_seconds, redirect_display) ORDER BY id)) AS value
      FROM leadgen_funnel_rules
    UNION ALL
    SELECT NULL, 'sections', json_array(MAX(updated_at), COUNT(*), SUM(updated_at), SUM(content_version)) FROM leadgen_sections
    UNION ALL
    SELECT NULL, 'placements', json_array(MAX(created_at), COUNT(*),
      json_group_array(json_array(id, variant_id, quote_id, section_id, position, page_id, slot_id) ORDER BY id)) FROM leadgen_funnel_variant_sections
    UNION ALL
    SELECT NULL, 'funnel_pages', json_array(MAX(created_at), COUNT(*),
      json_group_array(json_array(id, variant_id, quote_id, position, name) ORDER BY id)) FROM leadgen_funnel_pages
    UNION ALL
    SELECT NULL, 'slots', json_array(MAX(created_at), COUNT(*), SUM(slot_revision), SUM(id)) FROM leadgen_funnel_page_slots
    ORDER BY site_id, source`,
  // Leadgen themes and offers
  `SELECT NULL AS site_id, 'answer_maps' AS source, json_array(MAX(created_at), COUNT(*), SUM(id)) AS value
      FROM leadgen_section_answer_maps
    UNION ALL
    SELECT NULL, 'frames', json_array(MAX(updated_at), COUNT(*), SUM(updated_at)) FROM leadgen_frame_templates
    UNION ALL
    SELECT NULL, 'default_frames', json_group_array(json_array(quote_public_id, frame_template_id) ORDER BY quote_public_id)
      FROM leadgen_quote_default_template
    UNION ALL
    SELECT NULL, 'offers', json_array(MAX(updated_at), COUNT(*), SUM(updated_at)) FROM leadgen_offers
    ORDER BY site_id, source`,
  // Auction configuration
  `SELECT NULL AS site_id, 'auctions' AS source, json_array(MAX(updated_at), COUNT(*), SUM(updated_at)) AS value
      FROM leadgen_auctions
    UNION ALL
    SELECT NULL, 'auction_offers', json_group_array(json_array(auction_id, offer_placement_id, offer_id, static_order,
      static_bid_override, enabled) ORDER BY auction_id, offer_placement_id) FROM leadgen_auction_offers
    UNION ALL
    SELECT NULL, 'auction_rules', json_array(MAX(created_at), COUNT(*), json_group_array(json_array(id, auction_id,
      rule_level, target_offer_id, action, conditions_hash, carrier_match_json, strictly_override, priority, enabled,
      traffic_share_pct, tiers_json) ORDER BY id)) FROM leadgen_auction_rules
    UNION ALL
    SELECT NULL, 'auction_banners', json_array(MAX(created_at), COUNT(*),
      json_group_array(json_array(id, auction_id, mode, field_map_json) ORDER BY id)) FROM leadgen_auction_banners
    ORDER BY site_id, source`,
];

interface Fingerprints<T> {
  sites: Record<string, T>;
  global: T;
}

type SourceDigests = Record<string, string>;

interface Checkpoint extends Fingerprints<string> {
  sources?: Fingerprints<SourceDigests>;
  listicleMembers?: Record<string, SourceDigests>;
  receiptCursor?: number;
  sweepReceipt?: number;
  cursor?: number;
  sampledAt?: number;
}

interface Part { site_id: string | null; source: string; value: string; members?: string }

function isDigest(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDigestMap(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(isDigest);
}

function readCheckpoint(raw: string | null): Checkpoint | null {
  if (raw === null) return null;
  try {
    const saved = JSON.parse(raw) as Checkpoint | null;
    if (!saved || !isDigest(saved.global) || !isDigestMap(saved.sites)) return null;
    const sources = saved.sources;
    if (sources && (!isDigestMap(sources.global) || !isRecord(sources.sites) ||
        !Object.keys(saved.sites).every(id => isDigestMap(sources.sites[id])))) delete saved.sources;
    const members = saved.listicleMembers;
    if (members && !["listicle_sections", "listicle_links", "listicle_offers"].every(source => {
      const revisions = members[source];
      return isRecord(revisions) && Object.values(revisions).every(v => typeof v === "string");
    })) delete saved.listicleMembers;
    return saved;
  } catch {
    // An unreadable baseline is rebuilt from this minute's complete D1 snapshot.
    return null;
  }
}

async function fingerprints(parts: Part[], previous: Checkpoint | null) {
  const bySite = new Map<string, Part[]>();
  // Some listicle tables predate foreign keys to sites. Only the sites table
  // defines the roster, so orphaned content cannot keep a deleted site alive.
  for (const part of parts) {
    if (part.source === "site" && part.site_id !== null) bySite.set(part.site_id, []);
  }
  const global: Part[] = [];
  for (const part of parts) {
    const values = part.site_id === null ? global : bySite.get(part.site_id);
    values?.push(part);
  }
  if (!global.length) throw new Error("Missing global fingerprint");
  // Keep the v1 aggregate readable during a split. Hash individual sources only
  // when their owner's aggregate moves or its checkpoint predates source coverage.
  async function sample(rows: Part[], oldDigest?: string, oldSources?: SourceDigests) {
    const digest = await sha256Hex(JSON.stringify(rows.flatMap(({ source, value }) => [source, value])));
    if (digest === oldDigest && oldSources) return { digest, sources: oldSources };
    const sources = await Promise.all(rows.map(async ({ source, value }) => [source, await sha256Hex(value)] as const));
    return { digest, sources: Object.fromEntries(sources) };
  }
  const sites = await Promise.all(Array.from(bySite, async ([id, rows]) =>
    [id, await sample(rows, previous?.sites[id], previous?.sources?.sites[id])] as const));
  const shared = await sample(global, previous?.global, previous?.sources?.global);
  const listicleMembers: Record<string, SourceDigests> = {};
  for (const part of global) {
    if (part.members) listicleMembers[part.source] = JSON.parse(part.members);
  }
  return {
    sites: Object.fromEntries(sites.map(([id, s]) => [id, s.digest])),
    global: shared.digest,
    sources: { sites: Object.fromEntries(sites.map(([id, s]) => [id, s.sources])), global: shared.sources },
    listicleMembers,
  };
}

function logReceiptError(error: unknown): void {
  console.error(JSON.stringify({ t: "fingerprint_receipt_error", error: String(error) }));
}

type Family = "content" | "site" | "listicle" | "quote";
const sourceFamilies: Record<string, Family> = {
  articles: "content", pages: "content", media: "content", redirects: "content", tags: "content",
  article_tags: "content", site_categories: "content",
  site: "site", settings: "site", domains: "site", categories: "site",
  listicles: "listicle", experiments: "listicle", listicle_versions: "listicle", listicle_pages: "listicle",
  listicle_candidates: "listicle", listicle_rules: "listicle", listicle_sections: "listicle",
  listicle_offers: "listicle", listicle_links: "listicle",
  activations: "quote", quotes: "quote", funnels: "quote", variants: "quote", ab_tests: "quote",
  quote_rules: "quote", funnel_rules: "quote", sections: "quote", placements: "quote", funnel_pages: "quote",
  slots: "quote", answer_maps: "quote", frames: "quote", default_frames: "quote", offers: "quote",
  auctions: "quote", auction_offers: "quote", auction_rules: "quote", auction_banners: "quote",
};

type ReceiptFamily = Family | "global site" | "media.upload" | "site.create";
type Coverage = Map<string | null, Set<ReceiptFamily>>;

async function writerCoverage(db: D1Database, previous: Checkpoint, receiptCursor: number): Promise<Coverage> {
  // Older checkpoints used the Worker's finish time. With a real ID cursor,
  // only apply a time cutoff once it comes from the D1 sample itself.
  const savedCursor = previous.receiptCursor ?? previous.cursor;
  const byId = Number.isSafeInteger(savedCursor) && savedCursor !== Number.MAX_SAFE_INTEGER;
  const lower = byId ? savedCursor! : 0;
  const since = previous.sources || !byId ? previous.sampledAt ?? 0 : 0;
  const covered: Coverage = new Map();
  if (receiptCursor <= lower) return covered;
  const receipts = await db.prepare(`SELECT site_id, payload FROM cache_purge_log
      WHERE id > ? AND id <= ? AND id != ? AND created_at >= ? AND dry_run = 0
        AND action IN ('purge_tags', 'purge_tags_second') AND status IN ('pending', 'completed', 'failed')`)
    .bind(lower, receiptCursor, previous.sweepReceipt ?? 0, since)
    .all<{ site_id: string | null; payload: string | null }>();
  if (!receipts.success) throw new Error("Incomplete fingerprint receipts");

  function cover(site: string | null, family: ReceiptFamily) {
    const families = covered.get(site) ?? new Set<ReceiptFamily>();
    families.add(family);
    covered.set(site, families);
  }
  const unscopedListicles = new Set<string>();
  for (const row of receipts.results) {
    let data: unknown;
    try {
      data = JSON.parse(row.payload ?? "null");
    } catch {
      continue;
    }
    if (!isRecord(data) || data.retry_of || data.reason === "fingerprint" || data.reason === "version") continue;
    const tags = data.receipt_tags ?? data.tags;
    if (!Array.isArray(tags) || !tags.every(tag => typeof tag === "string")) continue;
    const owner = row.site_id?.toLowerCase() ?? null;
    for (const tag of tags) {
      const [prefix, id, member] = tag.toLowerCase().split(":", 3);
      if (!id) continue;
      if (prefix === "listicle" || prefix === "quote") {
        // Listicle IDs and legacy quote IDs are public IDs. Current quote tags
        // also encode the owning site, including on a NULL-site fan-out row.
        const site = prefix === "quote" && member ? id : owner;
        if (owner !== null && site !== owner) continue;
        if (site !== null) cover(site, prefix);
        if (prefix === "quote") cover(null, prefix);
        if (prefix === "listicle" && site === null) unscopedListicles.add(id);
      } else if (owner === null || owner === id) {
        if (prefix === "site") {
          cover(id, "site");
          cover(id, "content");
          if (owner === null) cover(id, "global site");
        } else if (prefix === "listing" || (prefix === "slug" && member)) {
          cover(id, "content");
        } else if (prefix === "nf" && data.reason === "media.upload") {
          // A new asset's writer only invalidates negative entries.
          cover(id, "media.upload");
        }
      }
      if (owner !== null && prefix === "host" && data.reason === "site.create") cover(owner, "site.create");
    }
  }
  if (unscopedListicles.size) {
    const owners = await db.prepare(`SELECT DISTINCT site_id FROM listicle_articles
      WHERE public_id COLLATE NOCASE IN (SELECT value FROM json_each(?))`)
      .bind(JSON.stringify([...unscopedListicles])).all<{ site_id: string }>();
    if (!owners.success) throw new Error("Incomplete listicle receipt owners");
    for (const row of owners.results) cover(row.site_id.toLowerCase(), "listicle");
  }
  return covered;
}

function changedSources(before: SourceDigests = {}, after: SourceDigests = {}): string[] {
  const sources = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...sources].filter(source => before[source] !== after[source]);
}

function changedListicleResources(before: Record<string, SourceDigests> | undefined, after: Record<string, SourceDigests>) {
  const sections = new Set<number>();
  const offers = new Set<string>();
  if (before) {
    for (const id of changedSources(before.listicle_sections, after.listicle_sections)) sections.add(Number(id));
    // A deleted or moved link still identifies its previous section in the checkpoint.
    for (const key of changedSources(before.listicle_links, after.listicle_links)) {
      sections.add(Number(key.slice(key.indexOf(":") + 1)));
    }
    for (const key of changedSources(before.listicle_offers, after.listicle_offers)) {
      const separator = key.indexOf(":");
      offers.add(key.slice(0, separator));
      offers.add(key.slice(separator + 1));
    }
  }
  return { sections, offers };
}

async function listicleConsumers(db: D1Database, sections: Set<number>, offers: Set<string>): Promise<Set<string>> {
  const sites = new Set<string>();
  const rows = await db.prepare(`SELECT s.id, json_group_array(DISTINCT a.site_id) AS sites,
      CASE WHEN s.headline_text <> '' THEN s.headline_offer_id END AS headline_offer_id,
      CASE WHEN ? THEN s.content_json END AS blocks
    FROM listicle_page_section_candidates c
    JOIN listicle_sections s ON s.id = c.section_id
    JOIN listicle_pages p ON p.id = c.page_id
    JOIN listicle_article_versions v ON v.id = p.article_version_id
    JOIN listicle_articles a ON a.id = v.article_id
    WHERE a.status = 'published' AND v.status = 'active'
      AND (c.section_id IN (SELECT value FROM json_each(?)) OR ?)
    GROUP BY s.id`).bind(offers.size, JSON.stringify([...sections]), offers.size)
    .all<{ id: number; sites: string; headline_offer_id: number | null; blocks: string | null }>();
  if (!rows.success) throw new Error("Incomplete listicle consumers");
  for (const row of rows.results) {
    if (!sections.has(row.id) && (row.headline_offer_id === null || !offers.has(String(row.headline_offer_id)))) {
      // Older sections may reference an offer only in their stored blocks.
      try {
        if (!collectOfferRefs(listicleBlocksToHtml(row.blocks)).some(ref => offers.has(ref))) continue;
      } catch {
        continue; // The public renderer cannot produce an offer link from these blocks.
      }
    }
    for (const id of JSON.parse(row.sites) as string[]) sites.add(id);
  }
  return sites;
}

function missedSites(
  previous: Checkpoint, current: Fingerprints<SourceDigests>, changed: string[], globalChanged: boolean, coverage: Coverage,
): Set<string> {
  const missed = new Set<string>();
  for (const id of changed) {
    const receipts = coverage.get(id.toLowerCase());
    const sources = current.sites[id];
    if (!sources && receipts?.has("site")) continue; // A recorded site deletion includes all its former sources.
    // An aggregate-only checkpoint cannot distinguish a settings edit from an
    // article edit. Only a whole-site receipt establishes coverage on upgrade.
    const changes = previous.sources ? changedSources(previous.sources.sites[id], sources) : ["site"];
    for (const source of changes) {
      if (source === "media" && receipts?.has("media.upload")) continue;
      if (source === "site" && !previous.sites[id] && receipts?.has("site.create")) continue;
      if (!receipts?.has(sourceFamilies[source] ?? "site")) missed.add(id);
    }
  }
  if (globalChanged) {
    const changes = previous.sources ? changedSources(previous.sources.global, current.global) : ["categories"];
    for (const source of changes) {
      const family = sourceFamilies[source] ?? "site";
      // Shared listicle revisions are checked against their consuming sites separately.
      if (family === "listicle" && previous.listicleMembers) continue;
      if (family === "quote" && coverage.get(null)?.has("quote")) continue;
      for (const [id, sources] of Object.entries(current.sites)) {
        if (family === "quote" && !sources.activations) continue;
        if (family === "listicle" && (!sources.listicles || coverage.get(id.toLowerCase())?.has("listicle"))) continue;
        if ((family === "site" || family === "content") && coverage.get(id.toLowerCase())?.has("global site")) continue;
        missed.add(id);
      }
    }
  }
  return missed;
}

export async function runFingerprintCron(env: Env, ctx: ExecutionContext | undefined): Promise<void> {
  try {
    const version = env.CF_VERSION_METADATA?.id;
    const [raw, oldVersion] = await Promise.all([
      env.CACHE.get(FINGERPRINT_KEY), version ? env.CACHE.get(VERSION_KEY) : null,
    ]);
    const previous = readCheckpoint(raw);
    // Sample the AUTOINCREMENT high-water mark in the same transaction as the
    // digests. Quiet minutes need neither purge-log rows nor a wall-clock guess.
    const [sequence, ...groups] = await env.DB.batch([
      env.DB.prepare("SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name = ?), 0) AS id, unixepoch() AS sampled_at")
        .bind("cache_purge_log"),
      ...FINGERPRINTS.map(query => env.DB.prepare(query)),
    ]) as [D1Result<{ id: number; sampled_at: number }>, ...D1Result<Part>[]];
    const boundary = sequence?.results?.[0];
    if (!boundary || !sequence.success || groups.length !== FINGERPRINTS.length ||
        groups.some(group => !group.success || !Array.isArray(group.results))) {
      throw new Error("Incomplete fingerprint batch");
    }
    const receiptCursor = boundary.id;
    const current = await fingerprints(groups.flatMap(group => group.results), previous);
    const owners = Object.keys(current.sites);
    const allIds = new Set([...owners, ...Object.keys(previous?.sites ?? {})]);
    const changed = previous ? [...allIds].filter(id => current.sites[id] !== previous.sites[id]) : [];
    const globalChanged = previous !== null && current.global !== previous.global;
    const { sections, offers } = changedListicleResources(previous?.listicleMembers, current.listicleMembers);
    const resourcesChanged = sections.size > 0 || offers.size > 0;
    const versionChanged = Boolean(version && version !== oldVersion);
    if (previous?.sources && previous.listicleMembers && !changed.length && !globalChanged && !resourcesChanged &&
        !versionChanged && previous.receiptCursor === receiptCursor) return;
    let missed = new Set<string>();
    if (previous && (changed.length || globalChanged || resourcesChanged)) {
      try {
        const coverage = await writerCoverage(env.DB, previous, receiptCursor);
        missed = missedSites(previous, current.sources, changed, globalChanged, coverage);
        if (resourcesChanged) {
          for (const id of await listicleConsumers(env.DB, sections, offers)) {
            if (Object.hasOwn(current.sites, id) && !coverage.get(id.toLowerCase())?.has("listicle")) missed.add(id);
          }
        }
      } catch (error) {
        logReceiptError(error);
        return; // Retry the same interval when D1 can establish the writer's scope.
      }
    }
    if (missed.size) console.error(JSON.stringify({ t: "missed_write_path", sites: [...missed].sort() }));
    const targets = new Set(missed);
    if (versionChanged) for (const id of owners) targets.add(id);
    let consumed = receiptCursor;
    let sweepReceipt: number | undefined;
    if (targets.size) {
      const tags = [...new Set([...targets].sort().map(siteTag))];
      const reason = missed.size ? "fingerprint" : "version";
      // onPublicChange advances the primary bookmark for every site tag before purging its snapshot.
      await onPublicChange(env, ctx, { siteId: null, tags, reason });
      // Consume our own receipt without advancing past a concurrent publisher's.
      try {
        const own = await env.DB.prepare(`SELECT id FROM cache_purge_log WHERE id > ? AND site_id IS NULL
          AND action = 'purge_tags_second' AND CASE WHEN json_valid(payload) THEN
            json_extract(payload, '$.reason') = ? AND json_extract(payload, '$.tags') = ? END
          ORDER BY id DESC LIMIT 1`).bind(receiptCursor, reason, JSON.stringify(tags)).first<{ id: number }>();
        if (own?.id === receiptCursor + 1) consumed = own.id;
        else sweepReceipt = own?.id;
      } catch (error) {
        logReceiptError(error);
      }
    }
    // Older Workers sharing the v1 key require these fields. A cursor beyond all
    // D1 receipt IDs also makes them compare these digests without suppressing a purge.
    await env.CACHE.put(FINGERPRINT_KEY, JSON.stringify({
      ...current, receiptCursor: consumed, sweepReceipt, cursor: Number.MAX_SAFE_INTEGER,
      sampledAt: boundary.sampled_at, sweep: null,
    }));
    if (versionChanged && version) await env.CACHE.put(VERSION_KEY, version);
  } catch (error) {
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
    console.error(JSON.stringify({ t: "fingerprint_cron_error", error: message }));
  }
}
