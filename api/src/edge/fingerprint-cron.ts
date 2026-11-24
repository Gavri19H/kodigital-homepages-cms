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

// The id boundary and the aggregates come from the same D1 batch. It distinguishes
// records created in the same unixepoch() second on either side of a checkpoint.
const PURGE_RECORDS = `
  WITH boundary AS (SELECT COALESCE(MAX(id), 0) AS cursor, unixepoch() AS sampled_at FROM cache_purge_log)
  SELECT b.cursor, b.sampled_at, p.site_id, p.action, p.created_at, CASE WHEN p.site_id IS NULL THEN p.payload END AS payload
    FROM boundary b LEFT JOIN cache_purge_log p
      ON p.id > COALESCE(?, b.cursor) AND p.created_at >= ?
     AND p.action IN ('purge_tags', 'purge_tags_second') AND p.dry_run = 0 AND p.status IN ('pending', 'completed')`;

interface Fingerprints {
  sites: Record<string, string>;
  global: string;
}

interface Checkpoint extends Fingerprints {
  cursor: number;
  sampledAt: number;
  sweep: { tags: string[]; finishedAt: number } | null;
}

interface Part { site_id: string | null; source: string; value: string }
interface PurgeRecord {
  cursor: number;
  sampled_at: number;
  site_id: string | null;
  action: string | null;
  created_at: number | null;
  payload: string | null;
}

function isDigest(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(tag => typeof tag === "string");
}

function readCheckpoint(raw: string | null): Checkpoint | null {
  if (raw === null) return null;
  try {
    const saved = JSON.parse(raw) as Partial<Checkpoint> | null;
    if (!saved || !isDigest(saved.global) || !saved.sites || typeof saved.sites !== "object" ||
        Array.isArray(saved.sites) || !Object.values(saved.sites).every(isDigest)) return null;
    if (!Number.isSafeInteger(saved.cursor) || !Number.isSafeInteger(saved.sampledAt)) return null;
    const sweep = saved.sweep;
    if (sweep !== null && (!sweep || !Number.isSafeInteger(sweep.finishedAt) || !isStringArray(sweep.tags))) return null;
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

function coveredSiteTags(records: PurgeRecord[], sweep: Checkpoint["sweep"]): Set<string> {
  const tags = new Set<string>();
  for (const row of records) {
    if (row.site_id !== null) {
      tags.add(siteTag(row.site_id));
    } else if (row.payload) {
      // Fan-out writes and deleted sites can only identify their owners by tag.
      try {
        const payload = JSON.parse(row.payload);
        const rowTags: unknown = payload?.tags;
        if (!isStringArray(rowTags)) continue;
        // The primary retry carries our reason. The second receipt carries the
        // full ordered tag list. Neither is evidence for the next content edit.
        if (payload.reason === "fingerprint" || payload.reason === "version") continue;
        if (row.action === "purge_tags_second" && sweep && row.created_at !== null && row.created_at <= sweep.finishedAt &&
            rowTags.length === sweep.tags.length && rowTags.every((tag, i) => tag === sweep.tags[i])) continue;
        for (const tag of rowTags) {
          if (tag) tags.add(tag.toLowerCase());
        }
      } catch {
        // A malformed merged record cannot establish site coverage.
      }
    }
  }
  return tags;
}

export async function runFingerprintCron(env: Env, ctx: ExecutionContext | undefined): Promise<void> {
  try {
    const version = env.CF_VERSION_METADATA?.id;
    const [raw, oldVersion] = await Promise.all([
      env.CACHE.get(FINGERPRINT_KEY), version ? env.CACHE.get(VERSION_KEY) : null,
    ]);
    const previous = readCheckpoint(raw);
    const [coverage, ...groups] = await env.DB.batch([
      env.DB.prepare(PURGE_RECORDS).bind(previous?.cursor ?? null, previous?.sampledAt ?? 0),
      ...FINGERPRINTS.map(query => env.DB.prepare(query)),
    ]) as [D1Result<PurgeRecord>, ...D1Result<Part>[]];
    const boundary = coverage?.results[0];
    if (!boundary || !coverage.success || groups.length !== FINGERPRINTS.length || groups.some(group => !group.success)) {
      throw new Error("Incomplete fingerprint batch");
    }
    const current = await fingerprints(groups.flatMap(group => group.results));
    const owners = Object.keys(current.sites);
    const allIds = new Set([...owners, ...Object.keys(previous?.sites ?? {})]);
    const changed = previous ? [...allIds].filter(id => current.sites[id] !== previous.sites[id]) : [];
    const globalChanged = previous !== null && current.global !== previous.global;
    const versionChanged = Boolean(version && version !== oldVersion);
    const covered = coveredSiteTags(coverage.results, previous?.sweep ?? null);
    // A writer's receipt is a change record even when its aggregate did not move.
    // Consume it once so it cannot mask a future missed edit after any number of quiet or delayed ticks.
    if (previous && !changed.length && !globalChanged && !versionChanged && !covered.size) return;
    const missed = new Set(changed.filter(id => !covered.has(siteTag(id))));
    if (globalChanged && !covered.size) {
      for (const id of owners) missed.add(id);
    }
    if (missed.size) console.error(JSON.stringify({ t: "missed_write_path", sites: [...missed].sort() }));
    const targets = new Set(missed);
    if (versionChanged) for (const id of owners) targets.add(id);
    let sweep: Checkpoint["sweep"] = null;
    if (targets.size) {
      const tags = [...new Set([...targets].sort().map(siteTag))];
      await onPublicChange(env, ctx, {
        siteId: null, tags, reason: missed.size ? "fingerprint" : "version",
      });
      sweep = { tags, finishedAt: Math.floor(Date.now() / 1000) };
    }
    await env.CACHE.put(FINGERPRINT_KEY, JSON.stringify({
      ...current, cursor: boundary.cursor, sampledAt: boundary.sampled_at, sweep,
    } satisfies Checkpoint));
    if (versionChanged && version) await env.CACHE.put(VERSION_KEY, version);
  } catch (error) {
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
    console.error(JSON.stringify({ t: "fingerprint_cron_error", error: message }));
  }
}
