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

// rescue-3 T7-AC2 / RC-022 — provisioning seeds a default_author_name setting.
//
// The 12-key create_site_settings seed deliberately does NOT carry
// default_author_name (so the T19 "12 canonical keys" contract is unchanged);
// the later generate_tagline_and_site_description step seeds it. After the
// settings-seeding sequence runs, a SELECT of default_author_name returns a
// brand-derived editorial name — never a user email — so T6's
// generate_15_homepage_articles can source the starter-article author from it.
//
// This fake models the SQL the two steps issue: the sites SELECT (both the
// name/domain and the loadSiteInfo id/name/domain/vertical_slug shapes), the
// ai_generations idempotency log (SELECT/INSERT/UPDATE), INSERT OR IGNORE +
// the ON CONFLICT upsert into site_settings.
interface T7SettingRow {
  site_id: string;
  key: string;
  value: string;
}

function makeT7FakeDb(site: {
  id: string;
  name: string;
  domain: string;
  vertical_slug: string;
}): { db: D1Database; settings: T7SettingRow[] } {
  const settings: T7SettingRow[] = [];
  const aiGenerations = new Map<string, Record<string, unknown>>();
  const find = (site_id: string, key: string) =>
    settings.find((r) => r.site_id === site_id && r.key === key);

  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...binds: unknown[]) {
          captured = binds;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.indexOf("FROM sites WHERE id = ?") >= 0) {
            const [id] = captured as [string];
            if (id !== site.id) return null;
            // Both create_site_settings (name/domain) and loadSiteInfo
            // (id/name/domain/vertical_slug) read the same row.
            return ({
              id: site.id,
              name: site.name,
              domain: site.domain,
              vertical_slug: site.vertical_slug,
            } as unknown) as T;
          }
          if (sql.indexOf("FROM ai_generations WHERE idempotency_key = ?") >= 0) {
            const [key] = captured as [string];
            return (aiGenerations.get(key) ?? null) as unknown as T | null;
          }
          return null;
        },
        async run() {
          if (sql.indexOf("INSERT OR IGNORE INTO site_settings") >= 0) {
            const [site_id, key, value] = captured as [string, string, string];
            if (!find(site_id, key)) settings.push({ site_id, key, value });
          } else if (
            sql.indexOf("INSERT INTO site_settings") >= 0 &&
            sql.indexOf("ON CONFLICT(site_id, key)") >= 0
          ) {
            const [site_id, key, value] = captured as [string, string, string];
            const existing = find(site_id, key);
            const guarded =
              sql.indexOf("site_settings.value IS NULL") >= 0 ||
              sql.indexOf("value = ''") >= 0;
            if (!existing) settings.push({ site_id, key, value });
            else if (!guarded || existing.value === "" || existing.value === null) {
              existing.value = value;
            }
          } else if (sql.indexOf("INSERT INTO ai_generations") >= 0) {
            const idempotency_key = captured[6] as string;
            if (!aiGenerations.has(idempotency_key)) {
              aiGenerations.set(idempotency_key, {
                id: captured[0],
                idempotency_key,
                status: "pending",
              });
            }
          } else if (sql.indexOf("UPDATE ai_generations") >= 0) {
            const idempotency_key = captured[captured.length - 1] as string;
            const r = aiGenerations.get(idempotency_key);
            if (r) {
              if (sql.indexOf("status = 'fallback'") >= 0) (r as { status: string }).status = "fallback";
              else if (sql.indexOf("status = 'success'") >= 0) (r as { status: string }).status = "success";
              else if (sql.indexOf("status = 'failed'") >= 0) (r as { status: string }).status = "failed";
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

describe("site-provisioning default_author_name seed (T7)", () => {
  // L2_AUTO_DISAMBIGUATION:T7-AC2:RC-022 [api/test/site-provisioning-create-site-settings.test.ts]
  it("provisioning seeds a default_author_name setting (brand-derived, not a user email) [api/test/site-provisioning-create-site-settings.test.ts] L2_AUTO_DISAMBIGUATION:T7-AC2:RC-022", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("fetch must not be called without OPENAI_API_KEY");
    }) as typeof fetch;
    try {
      const site = {
        id: "st_t7_author",
        name: "Acme Times",
        domain: "acme.example",
        vertical_slug: "personal-finance",
      };
      const { db, settings } = makeT7FakeDb(site);
      // The AI settings step validates OPENAI_TEXT_MODEL via getTextModel;
      // the shared buildEnv default ('gpt-test') is rejected, so use the
      // supported model. No OPENAI_API_KEY is set → deterministic fallback.
      const env = buildEnv(db, { OPENAI_TEXT_MODEL: "gpt-5.5" });
      const ctx = {
        env,
        db,
        job_id: "job_t7_author",
        site_id: site.id,
        step_order: 4,
      };

      // Seed the 12 canonical keys — default_author_name is NOT among them.
      await STEPS.create_site_settings({ ...ctx, step_order: 4 });
      expect(
        settings.find((r) => r.key === "default_author_name"),
      ).toBeUndefined();

      // The AI settings step seeds default_author_name.
      await STEPS.generate_tagline_and_site_description({
        ...ctx,
        step_order: 5,
      });

      const author = settings.find(
        (r) => r.site_id === site.id && r.key === "default_author_name",
      );
      expect(author).toBeTruthy();
      expect((author?.value ?? "").length).toBeGreaterThan(0);
      // Brand-derived editorial name — never a user email.
      expect(author?.value ?? "").not.toContain("@");
      expect(author?.value).toBe("Acme Times Editorial Team");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
