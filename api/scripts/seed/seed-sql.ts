// [G1] seed:local SQL builder.
//
// Pure function: fixture data in (seed-fixture.ts), one deterministic SQL
// string out. Re-runnable by construction — EVERY statement is
// `INSERT OR REPLACE INTO` with an explicit primary key and explicit
// created_at/updated_at literals, so a second run rewrites the identical
// rows instead of appending or drifting (no unixepoch()/CURRENT_TIMESTAMP
// defaults are ever exercised). Verified by test/seed-local-sql.test.ts.
//
// Insert order respects FK direction: verticals -> sites -> domains ->
// categories -> site_categories -> media -> articles -> site_settings.

import {
  SEED_EPOCH,
  SEED_HOSTNAME,
  SEED_SITE_ID,
  seedArticles,
  seedCategories,
  seedMedia,
  seedSettings,
  seedVertical,
} from "./seed-fixture";

function sq(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function nn(value: number | null): string {
  return value === null ? "NULL" : String(value);
}

export function buildSeedSql(): string {
  const statements: string[] = [];

  statements.push(
    "INSERT OR REPLACE INTO verticals (id, slug, name, display_order, created_at) VALUES " +
      `(${seedVertical.id}, ${sq(seedVertical.slug)}, ${sq(seedVertical.name)}, 99, ${SEED_EPOCH});`,
  );

  statements.push(
    "INSERT OR REPLACE INTO sites (id, name, domain, vertical_slug, activity, status, settings_version, content_version, content_mode, last_provisioned_at, created_at, updated_at) VALUES " +
      `(${sq(SEED_SITE_ID)}, 'Seed Local Living', ${sq(SEED_HOSTNAME)}, ${sq(seedVertical.slug)}, 'main', 'active', 1, 1, 'manual', ${SEED_EPOCH}, ${SEED_EPOCH}, ${SEED_EPOCH});`,
  );

  statements.push(
    "INSERT OR REPLACE INTO domains (id, site_id, hostname, kind, is_primary, status, ssl_status, cf_route_id, attached_at, created_at, updated_at) VALUES " +
      `(9001, ${sq(SEED_SITE_ID)}, ${sq(SEED_HOSTNAME)}, 'canonical', 1, 'active', NULL, NULL, ${SEED_EPOCH}, ${SEED_EPOCH}, ${SEED_EPOCH});`,
  );

  for (const c of seedCategories) {
    const articleCount = seedArticles.filter((a) => a.categoryId === c.id).length;
    statements.push(
      "INSERT OR REPLACE INTO categories (id, slug, name, parent_id, featured_image_id, display_order, article_count) VALUES " +
        `(${c.id}, ${sq(c.slug)}, ${sq(c.name)}, NULL, NULL, ${c.displayOrder}, ${articleCount});`,
    );
    statements.push(
      "INSERT OR REPLACE INTO site_categories (site_id, category_id, display_order) VALUES " +
        `(${sq(SEED_SITE_ID)}, ${c.id}, ${c.displayOrder});`,
    );
  }

  for (const m of seedMedia) {
    statements.push(
      "INSERT OR REPLACE INTO media (id, filename, storage_key, mime_type, size_bytes, width, height, alt_text, folder, created_at) VALUES " +
        `(${m.id}, ${sq(m.filename)}, ${sq(m.storageKey)}, ${sq(m.mimeType)}, ${m.sizeBytes}, ${m.width}, ${m.height}, ${sq(m.altText)}, 'seed-local', ${SEED_EPOCH});`,
    );
  }

  for (const a of seedArticles) {
    statements.push(
      "INSERT OR REPLACE INTO articles (id, slug, title, content_json, content_html, category_id, status, published_at, scheduled_at, author_name, featured_image_id, is_featured, is_trending, created_at, updated_at, site_id, homepage_section, homepage_rank, seo_title, seo_description, ai_generation_id) VALUES " +
        `(${a.id}, ${sq(a.slug)}, ${sq(a.title)}, ${sq(a.contentJson)}, ${sq(a.contentHtml)}, ${a.categoryId}, 'published', ${a.publishedAt}, NULL, 'Seed Local Desk', ${a.mediaId}, ${a.isFeatured}, ${a.isTrending}, ${SEED_EPOCH}, ${SEED_EPOCH}, ${sq(SEED_SITE_ID)}, 'none', ${nn(a.homepageRank)}, NULL, NULL, NULL);`,
    );
  }

  for (const s of seedSettings) {
    statements.push(
      "INSERT OR REPLACE INTO site_settings (id, site_id, key, value) VALUES " +
        `(${s.id}, ${sq(SEED_SITE_ID)}, ${sq(s.key)}, ${sq(s.value)});`,
    );
  }

  return statements.join("\n") + "\n";
}
