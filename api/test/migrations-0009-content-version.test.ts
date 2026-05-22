import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// T6 / Phase 7: assert the 0009 migration declares the content_version
// column on sites AND the six new read-path indexes the public router
// relies on. Parse the SQL statically (readFileSync + regex) so the
// check stays deterministic and runs without a local D1 binding — the
// post-apply PRAGMA table_info(sites) + index_list checks are owned by
// the deploy.yml `wrangler d1 migrations apply` step (executed on
// every push to main per the deploy-safety rule).

const MIGRATION_PATH = resolve(
  __dirname,
  "..",
  "migrations",
  "0009_phase7_content_version_and_indexes.sql",
);

const REQUIRED_INDEXES = [
  {
    name: "idx_articles_site_status_pub_desc",
    table: "articles",
    columns: "site_id, status, published_at DESC",
  },
  {
    name: "idx_articles_site_category_status_pub_desc",
    table: "articles",
    columns: "site_id, status, category_id, published_at DESC",
  },
  {
    name: "idx_articles_site_featured_rank",
    table: "articles",
    columns: "site_id, is_featured, homepage_rank",
  },
  {
    name: "idx_articles_site_trending_rank",
    table: "articles",
    columns: "site_id, is_trending, homepage_rank",
  },
  {
    name: "idx_media_site_created",
    table: "media",
    columns: "site_id, created_at DESC",
  },
  {
    name: "idx_article_tags_article",
    table: "article_tags",
    columns: "article_id, tag_id",
  },
] as const;

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

describe("0009_phase7_content_version_and_indexes.sql — T6 schema delta", () => {
  it("ALTERs sites to add content_version INTEGER NOT NULL DEFAULT 1", () => {
    const sql = readMigration();
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+sites\s+ADD\s+COLUMN\s+content_version\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+1\s*;/i,
    );
  });

  it("declares all six required Phase 7 read-path indexes", () => {
    const sql = readMigration();
    for (const { name, table, columns } of REQUIRED_INDEXES) {
      const re = new RegExp(
        `CREATE\\s+INDEX\\s+IF\\s+NOT\\s+EXISTS\\s+${name}\\s+ON\\s+${table}\\(${columns.replace(
          /\s+/g,
          "\\s*",
        )}\\)`,
        "i",
      );
      expect(sql).toMatch(re);
    }
  });

  it("uses CREATE INDEX IF NOT EXISTS (idempotent re-apply)", () => {
    const sql = readMigration();
    const indexLines = sql.match(/^CREATE\s+INDEX[^;]*;$/gim) ?? [];
    expect(indexLines.length).toBeGreaterThanOrEqual(REQUIRED_INDEXES.length);
    for (const line of indexLines) {
      expect(line).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/i);
    }
  });

  it("does not drop or recreate any existing table (no destructive ops)", () => {
    const sql = readMigration();
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+INDEX/i);
    expect(sql).not.toMatch(/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i);
  });

  it("uses .DEFAULT 1 (not 0) so first cache-key suffix is non-zero", () => {
    const sql = readMigration();
    const m = sql.match(
      /ALTER\s+TABLE\s+sites\s+ADD\s+COLUMN\s+content_version[^;]*DEFAULT\s+(\d+)/i,
    );
    expect(m).not.toBeNull();
    expect(m && Number(m[1])).toBe(1);
  });
});
