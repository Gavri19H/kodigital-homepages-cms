// T23 — Custom head/footer HTML + analytics/ad-header scripts: render +
// sanitize. Each backing it() embeds the literal evidence file path
// [api/test/custom-html-sanitize.test.ts] + the L2_AUTO_DISAMBIGUATION marker
// so the parse_test_output runner binds the row to its required_claim_id.
//
// vitest env is node (no jsdom, deps frozen) so the proof exercises the pure
// transforms (sanitizeSettingsHtml / validateScriptField), the render output
// (renderCustomHead/renderCustomFooter through renderLayout), and the LIVE
// admin PATCH boundary through the Hono router with a fake D1 — never a DOM.

import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import {
  ALLOWED_SETTINGS_KEYS,
  HTML_SETTINGS_KEYS,
  SCRIPT_SETTINGS_KEYS,
  sanitizeSettingsHtml,
  validateScriptField,
  renderCustomHead,
  renderCustomFooter,
} from "../src/settings/custom-html";
import { renderLayout } from "../src/public/templates/layout";

interface RecordedCall {
  sql: string;
  binds: unknown[];
}
interface PlantedRow {
  match: string;
  row: unknown | null;
}

function makeFakeDb(planted: PlantedRow[] = []): {
  db: D1Database;
  batches: RecordedCall[][];
} {
  const batches: RecordedCall[][] = [];
  function makeStmt(sql: string) {
    let captured: unknown[] = [];
    const stmt = {
      _sql: sql,
      _binds: () => captured,
      bind(...binds: unknown[]) {
        captured = binds;
        return stmt;
      },
      async first<T = unknown>(): Promise<T | null> {
        for (const entry of planted) {
          if (sql.indexOf(entry.match) >= 0) return (entry.row ?? null) as T | null;
        }
        return null;
      },
      async run() {
        return { success: true, meta: {} };
      },
      async all<T = unknown>() {
        return { results: [] as T[], success: true, meta: {} };
      },
    };
    return stmt;
  }
  const db = {
    prepare(sql: string) {
      return makeStmt(sql);
    },
    async batch(statements: ReturnType<typeof makeStmt>[]) {
      const rec: RecordedCall[] = statements.map((s) => ({
        sql: s._sql,
        binds: s._binds(),
      }));
      batches.push(rec);
      return statements.map(() => ({ success: true, meta: {} }));
    },
  } as unknown as D1Database;
  return { db, batches };
}

function buildEnv(db: D1Database): Env {
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
  };
}

async function patchSettings(
  db: D1Database,
  updates: Record<string, string>,
): Promise<Response> {
  return admin.request(
    "/api/admin/settings",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site_id: "st_a", updates }),
    },
    buildEnv(db),
  );
}

const SITE_ROW: PlantedRow = {
  match: "FROM sites WHERE id = ?",
  row: { id: "st_a", settings_version: 1 },
};

describe("custom head/footer HTML + analytics scripts: render + sanitize (T23)", () => {
  it("T23-AC1: custom head HTML + analytics snippet appear (sanitized via sanitizeSettingsHtml) in the live <head>/footer [api/test/custom-html-sanitize.test.ts] L2_AUTO_DISAMBIGUATION:T23-AC1:RC-041", () => {
    const settings = {
      custom_head_html: '<meta name="x-verify-token" content="kd-abc-123">',
      analytics_script:
        '<script async src="https://www.googletagmanager.com/gtag/js?id=G-TESTXYZ"></script>',
      ad_header_script: '<script>window.__adcfg = { v: 1 };</script>',
      custom_footer_html: '<p class="site-legal">(c) ACME Media</p>',
    };

    const customHead = renderCustomHead(settings);
    const customFooter = renderCustomFooter(settings);
    const html = renderLayout({
      site: { name: "ACME", hostname: "acme.example" },
      meta: { title: "Home" },
      body: "<p>hi</p>",
      customHead,
      customFooter,
    });

    // The stored snippets now render on the LIVE page (BCL-045 closed).
    const headPart = html.slice(0, html.indexOf("</head>"));
    const afterHead = html.slice(html.indexOf("</head>"));
    expect(headPart).toContain('name="x-verify-token"');
    expect(headPart).toContain(
      "https://www.googletagmanager.com/gtag/js?id=G-TESTXYZ",
    );
    expect(headPart).toContain("window.__adcfg");
    // custom_footer_html lands in the body, not the head.
    expect(afterHead).toContain('class="site-legal"');
    expect(headPart).not.toContain('class="site-legal"');

    // Sanitized: a clean snippet is untouched (no event handlers introduced,
    // no javascript: scheme present in the rendered output).
    expect(html).not.toContain("javascript:");
    expect(/(^|[\s/])on[a-z]+\s*=/i.test(html)).toBe(false);
  });

  it("T23-AC2: a <script>/onerror payload is stripped or rejected; settings PATCH enforces ALLOWED_SETTINGS_KEYS + validateScriptField [api/test/custom-html-sanitize.test.ts] L2_AUTO_DISAMBIGUATION:T23-AC2:RC-042", async () => {
    // (a) render-time STRIP: an onerror handler is removed (custom HTML field).
    const strippedHandler = sanitizeSettingsHtml(
      '<img src=x onerror="fetch(\'//evil\')">',
      { allowScript: false },
    );
    expect(strippedHandler).not.toContain("onerror");
    expect(strippedHandler).not.toContain("evil");

    // (b) render-time STRIP: a <script> is removed entirely from a pure-HTML
    //     field, while legitimate markup survives.
    const strippedScript = sanitizeSettingsHtml(
      '<script>steal()</script><meta name="ok">',
      { allowScript: false },
    );
    expect(strippedScript).not.toContain("<script");
    expect(strippedScript).not.toContain("steal");
    expect(strippedScript).toContain('name="ok"');

    // (c) render-time STRIP: a javascript: URI is neutralised.
    const strippedUri = sanitizeSettingsHtml(
      '<a href="javascript:doEvil()">x</a>',
      { allowScript: false },
    );
    expect(strippedUri).not.toContain("javascript:");

    // (d) analytics field keeps a clean <script src> but loses event handlers.
    const cleanAnalytics = sanitizeSettingsHtml(
      '<script src="https://cdn.example/a.js" onload="boot()"></script>',
      { allowScript: true },
    );
    expect(cleanAnalytics).toContain("https://cdn.example/a.js");
    expect(cleanAnalytics).not.toContain("onload");

    // validateScriptField verdicts (the PATCH-boundary gate).
    expect(validateScriptField("custom_head_html", "<script>x()</script>").ok).toBe(false);
    expect(validateScriptField("custom_head_html", "<img onerror=alert(1)>").ok).toBe(false);
    expect(validateScriptField("analytics_script", '<div onload="x()"></div>').ok).toBe(false);
    expect(validateScriptField("tagline", '<a href="javascript:bad()">x</a>').ok).toBe(false);
    expect(validateScriptField("analytics_script", '<script async src="https://x/y.js"></script>').ok).toBe(true);
    expect(validateScriptField("tagline", "Plain text tagline").ok).toBe(true);

    // ALLOWED_SETTINGS_KEYS / field families.
    expect(ALLOWED_SETTINGS_KEYS.has("custom_head_html")).toBe(true);
    expect(ALLOWED_SETTINGS_KEYS.has("analytics_script")).toBe(true);
    expect(ALLOWED_SETTINGS_KEYS.has("ad_header_script")).toBe(true);
    expect(ALLOWED_SETTINGS_KEYS.has("totally_unknown_key")).toBe(false);
    expect(HTML_SETTINGS_KEYS.has("custom_head_html")).toBe(true);
    expect(SCRIPT_SETTINGS_KEYS.has("analytics_script")).toBe(true);

    // LIVE PATCH boundary: an unknown key is REJECTED with 400 and no batch.
    const unknown = makeFakeDb([SITE_ROW]);
    const resUnknown = await patchSettings(unknown.db, { evil_key: "x" });
    expect(resUnknown.status).toBe(400);
    expect(unknown.batches.length).toBe(0);

    // LIVE PATCH boundary: a malicious custom_head_html is REJECTED, no batch.
    const xss = makeFakeDb([SITE_ROW]);
    const resXss = await patchSettings(xss.db, {
      custom_head_html: '<img src=x onerror="steal()">',
    });
    expect(resXss.status).toBe(400);
    expect(xss.batches.length).toBe(0);

    // LIVE PATCH boundary: a clean analytics snippet + meta is ACCEPTED (200,
    // exactly one atomic batch).
    const ok = makeFakeDb([SITE_ROW]);
    const resOk = await patchSettings(ok.db, {
      custom_head_html: '<meta name="ok">',
      analytics_script: '<script async src="https://x/y.js"></script>',
    });
    expect(resOk.status).toBe(200);
    expect(ok.batches.length).toBe(1);
  });

  it("rescue-4 round-5 (issue 1): ads_enabled + every ad-checkbox key the admin client always submits are allow-listed, so a settings save is not 400-rejected [api/test/custom-html-sanitize.test.ts]", async () => {
    // The admin settings client ALWAYS posts these three ad-checkbox keys on
    // every save (the settings.ts ad-checkbox loop), regardless of the visible
    // tab. A single missing key 400'd EVERY save ("unknown setting key:
    // 'ads_enabled'") -> the user-facing "Network error" on Ads, Analytics,
    // SEO, Social, every tab.
    for (const k of ["ads_enabled", "ad_lazy_load", "ad_disable_logged_in"]) {
      expect(ALLOWED_SETTINGS_KEYS.has(k), k + " must be allow-listed").toBe(true);
    }
    const fix = makeFakeDb([SITE_ROW]);
    const res = await patchSettings(fix.db, {
      ads_enabled: "1",
      ad_lazy_load: "1",
      ad_disable_logged_in: "",
      ad_provider: "adsense",
    });
    expect(res.status).toBe(200);
    expect(fix.batches.length).toBe(1);
  });
});
