import { describe, it, expect } from "vitest";
import { STEPS } from "../src/site-provisioning";
import type { Env } from "../src/env";

// T19 / Phase 3: create_site_settings behavioral AC (T19.AC2).
//
// GIVEN a freshly-created site (no rows in site_settings for site_id),
// WHEN the create_site_settings step completes,
// THEN SELECT COUNT(*) FROM site_settings WHERE site_id=? returns 12,
// AND tagline + site_description contain deterministic stub values
//     referencing the site name,
// AND no AI/OpenAI/network call was made.

interface SettingRow {
  site_id: string | null;
  key: string;
  value: string;
}

function buildEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
    ...overrides,
  };
}

function makeFakeDb(site: { id: string; name: string; domain: string }): {
  db: D1Database;
  settings: SettingRow[];
} {
  const settings: SettingRow[] = [];
  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...binds: unknown[]) {
          captured = binds;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.indexOf("SELECT name, domain FROM sites WHERE id = ?") >= 0) {
            const [id] = captured as [string];
            if (id !== site.id) return null;
            return ({ name: site.name, domain: site.domain } as unknown) as T;
          }
          return null;
        },
        async run() {
          if (sql.indexOf("INSERT OR IGNORE INTO site_settings") >= 0) {
            const [site_id, key, value] = captured as [
              string | null,
              string,
              string,
            ];
            const exists = settings.find(
              (r) => r.site_id === site_id && r.key === key,
            );
            if (!exists) {
              settings.push({ site_id, key, value });
            }
          }
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, settings };
}

describe("site-provisioning create_site_settings (T19)", () => {
  it("create_site_settings seeds all 12 keys with deterministic stubs", async () => {
    // Stub fetch so an accidental network call would FAIL the test.
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("fetch must not be called during create_site_settings");
    }) as typeof fetch;

    try {
      const site = {
        id: "st_t19",
        name: "Acme Times",
        domain: "acme.example",
      };
      const { db, settings } = makeFakeDb(site);
      const env = buildEnv(db);

      const result = await STEPS.create_site_settings({
        env,
        db,
        job_id: "job_t19",
        site_id: site.id,
        step_order: 4,
      });

      expect(result.status).toBe("completed");
      expect(fetchCalls).toBe(0);

      // BEHAVIORAL: 12 rows for site_id, each carrying a known key.
      const seededForSite = settings.filter((r) => r.site_id === site.id);
      expect(seededForSite).toHaveLength(12);
      const keys = new Set(seededForSite.map((r) => r.key));
      const expected = [
        "site_name",
        "logo_media_id",
        "tagline",
        "site_description",
        "brand_tokens_json",
        "robots_txt_content",
        "ads_txt_content",
        "custom_head_html",
        "custom_footer_html",
        "newsletter_settings_json",
        "contact_email",
        "privacy_email",
      ];
      for (const k of expected) expect(keys.has(k)).toBe(true);

      // tagline + site_description must reference the site name.
      const tagline = seededForSite.find((r) => r.key === "tagline");
      const description = seededForSite.find(
        (r) => r.key === "site_description",
      );
      expect(tagline).toBeTruthy();
      expect(description).toBeTruthy();
      expect(tagline?.value.indexOf(site.name)).toBeGreaterThanOrEqual(0);
      expect(description?.value.indexOf(site.name)).toBeGreaterThanOrEqual(0);

      // contact_email + privacy_email derive from domain (no PII leakage
      // and no hardcoded admin address).
      const contact = seededForSite.find((r) => r.key === "contact_email");
      const privacy = seededForSite.find((r) => r.key === "privacy_email");
      expect(contact?.value).toBe(`contact@${site.domain}`);
      expect(privacy?.value).toBe(`privacy@${site.domain}`);

      // Re-running the step is idempotent under (site_id, key) UNIQUE.
      const second = await STEPS.create_site_settings({
        env,
        db,
        job_id: "job_t19",
        site_id: site.id,
        step_order: 4,
      });
      expect(second.status).toBe("completed");
      expect(settings.filter((r) => r.site_id === site.id)).toHaveLength(12);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
