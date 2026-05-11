import { describe, it, expect } from "vitest";
import { STEPS } from "../src/site-provisioning";
import type { Env } from "../src/env";

// T20 / Phase 3: render_generic_legal_pages_with_site_variables BEHAVIORAL AC.
// GIVEN legal_templates row 'privacy-policy' containing {{site_name}} and
// {{domain}}, WHEN the step runs for {name:'Acme', domain:'acme.example'},
// THEN pages.content_html contains 'Acme' + 'acme.example' and no '{{'.

interface PageRow {
  site_id: string; slug: string; title: string;
  content_json: string; content_html: string; page_type: string;
}
interface LegalTemplateRow {
  slug: string; title: string;
  content_html: string | null; content_md: string | null;
}
interface SettingRow { site_id: string | null; key: string; value: string }

function buildEnv(db: D1Database): Env {
  return {
    DB: db, CACHE: {} as KVNamespace, MEDIA: {} as R2Bucket,
    APP_ENV: "test", ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787", ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false", HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "gpt-test", OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
  } as Env;
}

function makeFakeDb(args: {
  site: { id: string; name: string; domain: string };
  templates: LegalTemplateRow[];
  settings?: SettingRow[];
}): { db: D1Database; pages: PageRow[] } {
  const { site, templates, settings = [] } = args;
  const pages: PageRow[] = [];
  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...binds: unknown[]) { captured = binds; return stmt; },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.indexOf("SELECT name, domain FROM sites WHERE id = ?") >= 0) {
            const [id] = captured as [string];
            if (id !== site.id) return null;
            return ({ name: site.name, domain: site.domain } as unknown) as T;
          }
          if (sql.indexOf("SELECT title, content_html, content_md FROM legal_templates") >= 0) {
            const [slug] = captured as [string];
            const found = templates.find((t) => t.slug === slug);
            return ((found ?? null) as unknown) as T;
          }
          return null;
        },
        async all<T = unknown>() {
          if (sql.indexOf("FROM site_settings WHERE site_id = ?") >= 0) {
            const [id] = captured as [string];
            const rows = settings.filter((r) => r.site_id === id);
            return { results: rows as unknown as T[], success: true, meta: {} };
          }
          return { results: [] as T[], success: true, meta: {} };
        },
        async run() {
          if (sql.indexOf("INSERT INTO pages") >= 0) {
            const [site_id, slug, title, content_json, content_html] = captured as [
              string, string, string, string, string,
            ];
            const row: PageRow = {
              site_id, slug, title, content_json, content_html,
              page_type: "legal",
            };
            const idx = pages.findIndex(
              (p) => p.site_id === site_id && p.slug === slug,
            );
            if (idx >= 0) pages[idx] = row;
            else pages.push(row);
          }
          return { success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, pages };
}

describe("legal-template renderer (T20)", () => {
  it("legal template renders variables", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("fetch must not be called during legal-template render");
    }) as typeof fetch;

    try {
      const site = { id: "st_t20", name: "Acme", domain: "acme.example" };
      const templates: LegalTemplateRow[] = [
        {
          slug: "privacy-policy",
          title: "Privacy Policy for {{site_name}}",
          content_html: null,
          content_md:
            "Privacy Policy for {{site_name}} at {{domain}}. " +
            "Contact {{contact_email}}; privacy {{privacy_email}}; " +
            "company {{company_name}}; effective {{effective_date}}. " +
            "Owner: {{owner_email}}. Address: {{address}}.",
        },
        {
          slug: "terms",
          title: "Terms for {{site_name}}",
          content_html: null,
          content_md: "Terms for {{site_name}} at {{domain}}.",
        },
        {
          slug: "do-not-sell",
          title: "Do Not Sell",
          content_html: null,
          content_md: "DNS for {{site_name}} ({{domain}}).",
        },
        {
          slug: "contact",
          title: "Contact {{site_name}}",
          content_html: null,
          content_md: "Reach {{site_name}} via {{contact_email}}.",
        },
      ];

      const { db, pages } = makeFakeDb({ site, templates });
      const env = buildEnv(db);

      const result = await STEPS.render_generic_legal_pages_with_site_variables({
        env,
        db,
        job_id: "job_t20",
        site_id: site.id,
        step_order: 7,
      });

      expect(result.status).toBe("completed");
      expect(fetchCalls).toBe(0);

      // BEHAVIORAL contract: privacy-policy contains site name + domain
      // and no opening-curly substring remains.
      const privacy = pages.find((p) => p.slug === "privacy-policy");
      expect(privacy).toBeTruthy();
      expect(privacy!.site_id).toBe(site.id);
      expect(privacy!.content_html.indexOf(site.name)).toBeGreaterThanOrEqual(0);
      expect(privacy!.content_html.indexOf(site.domain)).toBeGreaterThanOrEqual(0);
      expect(privacy!.content_html.indexOf("{{")).toBe(-1);

      // All 4 legal pages are rendered, all free of placeholders.
      expect(pages).toHaveLength(4);
      for (const p of pages) {
        expect(p.content_html.indexOf("{{")).toBe(-1);
        expect(p.title.indexOf("{{")).toBe(-1);
        expect(p.page_type).toBe("legal");
      }

      // contact_email derived from domain when site_settings absent.
      const contact = pages.find((p) => p.slug === "contact");
      expect(contact!.content_html.indexOf(`contact@${site.domain}`)).toBeGreaterThanOrEqual(
        0,
      );

      // Re-running the step is idempotent under (site_id, slug) upsert.
      const second = await STEPS.render_generic_legal_pages_with_site_variables({
        env,
        db,
        job_id: "job_t20",
        site_id: site.id,
        step_order: 7,
      });
      expect(second.status).toBe("completed");
      expect(pages).toHaveLength(4);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
