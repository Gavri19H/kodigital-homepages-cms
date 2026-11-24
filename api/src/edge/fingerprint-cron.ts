import type { Env } from "../env";
import { sha256Hex } from "../leadgen/meta-hash";
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
  // Shared listicle configuration
  `SELECT NULL AS site_id, 'listicle_sections' AS source, json_array(MAX(updated_at), COUNT(*), SUM(updated_at), SUM(content_version)) AS value
      FROM listicle_sections
    UNION ALL
    SELECT NULL, 'listicle_offers', json_array(MAX(updated_at), COUNT(*), SUM(updated_at)) FROM listicle_offers
    UNION ALL
    SELECT NULL, 'listicle_links', json_array(MAX(updated_at), COUNT(*), SUM(updated_at), SUM(id)) FROM listicle_section_link_instances
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

interface Fingerprints {
  sites: Record<string, string>;
  global: string;
}

interface Checkpoint extends Fingerprints {
  receiptCursor?: number;
  sweepReceipt?: number;
  cursor?: number;
  sampledAt?: number;
}

interface Part { site_id: string | null; source: string; value: string }

function isDigest(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function readCheckpoint(raw: string | null): Checkpoint | null {
  if (raw === null) return null;
  try {
    const saved = JSON.parse(raw) as Partial<Fingerprints> | null;
    if (!saved || !isDigest(saved.global) || !saved.sites || typeof saved.sites !== "object" ||
        Array.isArray(saved.sites) || !Object.values(saved.sites).every(isDigest)) return null;
    return saved as Checkpoint;
  } catch {
    // An unreadable baseline is rebuilt from this minute's complete D1 snapshot.
    return null;
  }
}

async function fingerprints(parts: Part[]): Promise<Fingerprints> {
  const bySite = new Map<string, string[]>();
  // Some listicle tables predate foreign keys to sites. Only the sites table
  // defines the roster, so orphaned content cannot keep a deleted site alive.
  for (const part of parts) {
    if (part.source === "site" && part.site_id !== null) bySite.set(part.site_id, []);
  }
  const global: string[] = [];
  for (const { site_id, source, value } of parts) {
    const values = site_id === null ? global : bySite.get(site_id);
    values?.push(source, value);
  }
  if (!global.length) throw new Error("Missing global fingerprint");
  // Only digests go into KV, including for settings that contain custom HTML.
  const sites = await Promise.all(Array.from(bySite, async ([id, values]) =>
    [id, await sha256Hex(JSON.stringify(values))] as const));
  return { sites: Object.fromEntries(sites), global: await sha256Hex(JSON.stringify(global)) };
}

function logReceiptError(error: unknown): void {
  console.error(JSON.stringify({ t: "fingerprint_receipt_error", error: String(error) }));
}

async function logMissedWrites(
  db: D1Database, previous: Checkpoint, receiptCursor: number, changed: Set<string>, globalChanged: boolean, owners: string[],
): Promise<void> {
  // Older checkpoints either carry a real row ID or the FX4a sentinel. In
  // the latter case use the recorded sample time, including its boundary second.
  const savedCursor = previous.receiptCursor ?? previous.cursor;
  const byId = Number.isSafeInteger(savedCursor) && savedCursor !== Number.MAX_SAFE_INTEGER;
  const lower = byId ? savedCursor! : 0;
  const covered = new Set<string>();
  let hasReceipt = false;
  if (receiptCursor > lower) {
    const receipts = await db.prepare(`SELECT site_id, payload FROM cache_purge_log
      WHERE id > ? AND id <= ? AND id != ? AND created_at >= ? AND dry_run = 0
        AND action IN ('purge_tags', 'purge_tags_second') AND status IN ('pending', 'completed', 'failed')`)
      .bind(lower, receiptCursor, previous.sweepReceipt ?? 0, byId ? 0 : previous.sampledAt ?? 0)
      .all<{ site_id: string | null; payload: string | null }>();
    for (const row of receipts.results) {
      if (row.site_id !== null) {
        covered.add(siteTag(row.site_id));
        hasReceipt = true;
        continue;
      }
      // Fan-out and deleted-site receipts identify their owners by tag.
      try {
        const data = JSON.parse(row.payload ?? "null");
        if (data?.reason === "fingerprint" || data?.reason === "version" || !Array.isArray(data?.tags)) continue;
        for (const tag of data.tags) {
          if (typeof tag !== "string" || !tag) continue;
          hasReceipt = true;
          const site = /^(?:site|snap|nf|listing):(.+)$/i.exec(tag);
          if (site) covered.add(siteTag(site[1]!));
        }
      } catch {
        // A malformed fan-out payload supplies no evidence of a writer.
      }
    }
  }
  // Shared configuration writers can record one receipt per activated tenant.
  const missed = new Set([...changed].filter(id => !covered.has(siteTag(id))));
  if (globalChanged && !hasReceipt) for (const id of owners) missed.add(id);
  if (missed.size) console.error(JSON.stringify({ t: "missed_write_path", sites: [...missed].sort() }));
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
      env.DB.prepare("SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name = ?), 0) AS id").bind("cache_purge_log"),
      ...FINGERPRINTS.map(query => env.DB.prepare(query)),
    ]) as [D1Result<{ id: number }>, ...D1Result<Part>[]];
    const receiptCursor = sequence?.results?.[0]?.id;
    if (receiptCursor === undefined || !sequence.success || groups.length !== FINGERPRINTS.length ||
        groups.some(group => !group.success || !Array.isArray(group.results))) {
      throw new Error("Incomplete fingerprint batch");
    }
    const current = await fingerprints(groups.flatMap(group => group.results));
    const owners = Object.keys(current.sites);
    const allIds = new Set([...owners, ...Object.keys(previous?.sites ?? {})]);
    const changed = new Set(previous ? [...allIds].filter(id => current.sites[id] !== previous.sites[id]) : []);
    const globalChanged = previous !== null && current.global !== previous.global;
    const versionChanged = Boolean(version && version !== oldVersion);
    if (previous && !changed.size && !globalChanged && !versionChanged && previous.receiptCursor === receiptCursor) return;
    if (previous && (changed.size || globalChanged)) {
      try {
        await logMissedWrites(env.DB, previous, receiptCursor, changed, globalChanged, owners);
      } catch (error) {
        logReceiptError(error);
      }
    }
    // Receipt coverage controls the alarm only. Every changed site is purged.
    if (globalChanged) for (const id of owners) changed.add(id);
    const targets = new Set(changed);
    if (versionChanged) for (const id of owners) targets.add(id);
    let consumed = receiptCursor;
    let sweepReceipt: number | undefined;
    if (targets.size) {
      const tags = [...new Set([...targets].sort().map(siteTag))];
      await onPublicChange(env, ctx, {
        siteId: null, tags, reason: changed.size ? "fingerprint" : "version",
      });
      // The second pass has no reason field. Exclude our own receipt on the
      // next run, without advancing past a concurrent publisher's receipt.
      try {
        const own = await env.DB.prepare(`SELECT id FROM cache_purge_log WHERE id > ? AND site_id IS NULL
          AND action = 'purge_tags_second' AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.tags') END = ?
          ORDER BY id DESC LIMIT 1`).bind(receiptCursor, JSON.stringify(tags)).first<{ id: number }>();
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
      sampledAt: Math.floor(Date.now() / 1000), sweep: null,
    }));
    if (versionChanged && version) await env.CACHE.put(VERSION_KEY, version);
  } catch (error) {
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
    console.error(JSON.stringify({ t: "fingerprint_cron_error", error: message }));
  }
}
