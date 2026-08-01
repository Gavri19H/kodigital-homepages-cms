import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import { ADMIN_ASSET_MANIFEST } from "../src/admin/conversions/asset-manifest.generated";
import { dashboardPage } from "../src/admin/templates/dashboard";
import { adminLayout } from "../src/admin/templates/layout";
import { listiclesOffersPage } from "../src/admin/listicles/ui-offers";
import { leadgenPageShell } from "../src/admin/leadgen/ui";
import { isConversionsUiEnabled, type Env } from "../src/env";

const API_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MANIFEST_ASSETS = [
  ADMIN_ASSET_MANIFEST.conversions.js,
  ADMIN_ASSET_MANIFEST.conversions.css,
  ADMIN_ASSET_MANIFEST.reporting.js,
  ADMIN_ASSET_MANIFEST.reporting.css,
] as const;

interface BindingCounter {
  calls: number;
}

function physicalAssetBinding(counter: BindingCounter = { calls: 0 }): Fetcher {
  return {
    fetch: async (input: RequestInfo | URL): Promise<Response> => {
      counter.calls += 1;
      const request = input instanceof Request ? input : new Request(input);
      const asset = MANIFEST_ASSETS.find((candidate) => candidate.url === new URL(request.url).pathname);
      if (asset === undefined) return new Response("Not Found", { status: 404 });
      const product = asset.url.includes("/reporting/") ? "reporting" : "conversions";
      const content = readFileSync(resolve(API_ROOT, "public/assets/admin", product, asset.fileName), "utf8");
      return new Response(content, { status: 200 });
    },
    connect: () => {
      throw new Error("connect is not supported by the test asset binding");
    },
  } as unknown as Fetcher;
}

function env(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    CACHE: { get: async () => null } as unknown as KVNamespace,
    MEDIA: {} as R2Bucket,
    ADMIN_ASSETS: physicalAssetBinding(),
    APP_ENV: "test",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "test",
    OPENAI_IMAGE_MODEL: "test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
    ...overrides,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertEnabledNav(html: string): void {
  expect(html).toContain('data-admin-nav-group="conversions"');
  expect(html).toContain("<span>Conversions</span>");
  for (const [path, label] of [
    ["/admin/conversions/flows", "Flows"],
    ["/admin/conversions/connections", "Connections"],
    ["/admin/conversions/activity", "Activity"],
    ["/admin/conversions/controls", "Controls"],
  ] as const) {
    expect(html).toContain(`href="${path}"`);
    expect(html).toContain(`<span>${label}</span>`);
  }
  expect(html).toContain('href="/admin/reporting"');
  expect(html).not.toContain('href="/admin/conversions" class="nav-item"');
}

describe("Conversions disabled route shell", () => {
  it("keeps every pre-existing adminLayout call byte-identical when the new options are absent", () => {
    const html = adminLayout({
      title: "Legacy Pin",
      activePath: "/admin/pages",
      userEmail: "legacy@example.com",
      content: "<p>legacy-content</p>",
      scripts: "var pagePin = true;",
      styles: ".pin{display:block}",
    });
    expect(Buffer.byteLength(html)).toBe(18147);
    expect(sha256(html)).toBe("0b35c0c8a3fb96ce7245fcaff55a4045bcd031ffa83c9e69e5cd3ccfa2cd69a0");
    expect(html).not.toContain("Conversions");
    expect(html).not.toContain('type="module"');
  });

  it("adds the mobile sidebar accessibility lifecycle only to the enabled layout", () => {
    const html = adminLayout({
      title: "Enabled navigation",
      content: '<a href="/visible-content">Visible content</a>',
      conversionsUiEnabled: true,
    });
    expect(html).toContain('aria-label="Toggle navigation" aria-controls="sidebar" aria-expanded="false"');
    expect(html).toContain("sidebar.setAttribute('inert', '')");
    expect(html).toContain("sidebar.setAttribute('aria-hidden', 'true')");
    expect(html).toContain("sidebar.removeAttribute('aria-hidden')");
    expect(html).toContain("event.key === 'Escape'");
    expect(html).toContain("menuBtn.setAttribute('aria-expanded', 'true')");
    expect(html).toContain("menuBtn.setAttribute('aria-expanded', 'false')");
    expect(html).toContain("media.addEventListener('change', syncViewport)");
    expect(html).toContain("@media (max-width:768px){.admin-sidebar{visibility:hidden}.admin-sidebar.open{visibility:visible}}");
    expect(html).toContain("@media (prefers-reduced-motion:reduce){.admin-sidebar{transition-duration:0s!important;animation-duration:0s!important}}");
    expect(html).toContain("motion.addEventListener('change', syncMotionPreference)");
    expect(html).toContain("focusFrame = window.requestAnimationFrame");
    expect(html).toContain("scheduleSidebarFocus();");

    const classicScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(classicScript).toBeDefined();
    expect(classicScript).not.toMatch(/\b(?:const|let|async)\b|=>/);

    const disabled = adminLayout({ title: "Disabled navigation", content: "" });
    expect(disabled).not.toContain('aria-controls="sidebar"');
    expect(disabled).not.toContain("sidebar.setAttribute('inert', '')");
    expect(disabled).not.toContain(".admin-sidebar{visibility:hidden}");
    expect(disabled).not.toContain("prefers-reduced-motion:reduce");
  });

  it("accepts only a trimmed, case-insensitive true literal and fails closed everywhere else", async () => {
    const accepted = ["true", "TRUE", " true "];
    for (const flag of accepted) {
      const requestEnv = env({ CONVERSIONS_UI_ENABLED: flag });
      expect(isConversionsUiEnabled(flag), flag).toBe(true);
      expect((await admin.request("/admin/conversions", {}, requestEnv)).status, flag).toBe(200);
      expect((await admin.request(ADMIN_ASSET_MANIFEST.conversions.js.url, {}, requestEnv)).status, flag).toBe(200);
      assertEnabledNav(adminLayout({ title: "Flag", content: "", conversionsUiEnabled: isConversionsUiEnabled(flag) }));
    }

    for (const flag of [undefined, "", "false", "0", "1", "yes", "on", "truth", "true false"] as const) {
      const requestEnv = env({ CONVERSIONS_UI_ENABLED: flag });
      expect(isConversionsUiEnabled(flag), String(flag)).toBe(false);
      expect((await admin.request("/admin/conversions", {}, requestEnv)).status, String(flag)).toBe(404);
      expect((await admin.request(ADMIN_ASSET_MANIFEST.conversions.js.url, {}, requestEnv)).status, String(flag)).toBe(404);
      const html = adminLayout({ title: "Flag", content: "", conversionsUiEnabled: isConversionsUiEnabled(flag) });
      expect(html, String(flag)).not.toContain('data-admin-nav-group="conversions"');
      expect(html, String(flag)).not.toContain('href="/admin/reporting"');
    }
  });

  it("keeps Access auth on both page roots and all four physical asset URLs", async () => {
    const locked = env({
      APP_ENV: "production",
      DEV_BYPASS_AUTH: "true",
      CONVERSIONS_UI_ENABLED: "true",
    });
    for (const path of ["/admin/conversions", "/admin/reporting", ...MANIFEST_ASSETS.map((asset) => asset.url)]) {
      expect((await admin.request(path, {}, locked)).status, path).toBe(401);
    }
  });

  it("serves exact enabled shells with separate product roots and manifest URLs", async () => {
    const enabled = env({ CONVERSIONS_UI_ENABLED: "true" });
    const cases = [
      ["/admin/conversions", "flows", "ko-conversions-root", ADMIN_ASSET_MANIFEST.conversions],
      ["/admin/conversions/flows", "flows", "ko-conversions-root", ADMIN_ASSET_MANIFEST.conversions],
      ["/admin/conversions/connections", "connections", "ko-conversions-root", ADMIN_ASSET_MANIFEST.conversions],
      ["/admin/conversions/activity", "activity", "ko-conversions-root", ADMIN_ASSET_MANIFEST.conversions],
      ["/admin/conversions/controls", "controls", "ko-conversions-root", ADMIN_ASSET_MANIFEST.conversions],
      ["/admin/reporting", "reports", "ko-reporting-root", ADMIN_ASSET_MANIFEST.reporting],
      ["/admin/conversions/flows/new", "flows", "ko-conversions-root", ADMIN_ASSET_MANIFEST.conversions],
      ["/admin/conversions/flows/flow_public_id", "flows", "ko-conversions-root", ADMIN_ASSET_MANIFEST.conversions],
      ["/admin/conversions/connections/new", "connections", "ko-conversions-root", ADMIN_ASSET_MANIFEST.conversions],
      ["/admin/conversions/connections/connection_public_id", "connections", "ko-conversions-root", ADMIN_ASSET_MANIFEST.conversions],
      ["/admin/conversions/activity/run_public_id", "activity", "ko-conversions-root", ADMIN_ASSET_MANIFEST.conversions],
      ["/admin/reporting/new", "reports", "ko-reporting-root", ADMIN_ASSET_MANIFEST.reporting],
      ["/admin/reporting/report_public_id", "reports", "ko-reporting-root", ADMIN_ASSET_MANIFEST.reporting],
    ] as const;
    for (const [path, page, rootId, assets] of cases) {
      const response = await admin.request(path, {}, enabled);
      expect(response.status, path).toBe(200);
      const html = await response.text();
      expect((html.match(/<h1\b/g) ?? []).length, path).toBe(1);
      expect(html).toContain(`id="${rootId}"`);
      expect(html).toContain(`data-page="${page}"`);
      expect(html).toContain('data-shell-state="dependency_unavailable"');
      expect(html).toContain('data-bootstrap-active="false"');
      assertEnabledNav(html);
      expect(html).toContain(`<link rel="stylesheet" href="${assets.css.url}">`);
      expect(html).toContain(`<script type="module" src="${assets.js.url}"></script>`);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-security-policy")).toContain("script-src 'self'");
      expect(response.headers.get("content-security-policy")).not.toContain("unsafe-eval");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }
    expect((await admin.request("/admin/conversions/unknown", {}, enabled)).status).toBe(404);
  });

  it("does not reflect query or route identifiers into shell markup", async () => {
    const marker = "INJECTED_MARKER_42";
    for (const path of [`/admin/conversions?state=${marker}&bootstrap=true`, `/admin/conversions/flows/${marker}`]) {
      const response = await admin.request(path, {}, env({ CONVERSIONS_UI_ENABLED: "true" }));
      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain(marker);
    }
  });

  it("proxies only the four manifest-pinned assets through ADMIN_ASSETS", async () => {
    const counter = { calls: 0 };
    const enabled = env({ CONVERSIONS_UI_ENABLED: "true", ADMIN_ASSETS: physicalAssetBinding(counter) });
    for (const asset of MANIFEST_ASSETS) {
      const response = await admin.request(asset.url, {}, enabled);
      expect(response.status, asset.url).toBe(200);
      expect(response.headers.get("content-type")).toBe(asset.contentType);
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(response.headers.get("etag")).toBe(asset.etag);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      const product = asset.url.includes("/reporting/") ? "reporting" : "conversions";
      expect(await response.text()).toBe(readFileSync(resolve(API_ROOT, "public/assets/admin", product, asset.fileName), "utf8"));
    }
    expect(counter.calls).toBe(4);

    for (const path of [
      "/assets/admin/conversions/not-generated.js",
      "/assets/admin/reporting/reporting.0000000000000000.js",
      "/assets/admin/other/file.js",
      `/assets/admin/conversions/${ADMIN_ASSET_MANIFEST.reporting.js.fileName}`,
    ]) {
      expect((await admin.request(path, {}, enabled)).status, path).toBe(404);
    }
    expect(counter.calls).toBe(4);
  });

  it("implements strict weak If-None-Match list and whole-field wildcard semantics for GET and HEAD before binding fetch", async () => {
    const asset = ADMIN_ASSET_MANIFEST.conversions.js;
    for (const method of ["GET", "HEAD"] as const) {
      for (const value of [
        asset.etag,
        `W/${asset.etag}`,
        `\t"other" \t,\t W/${asset.etag}\t`,
        `"opaque,comma", W/${asset.etag}`,
        "*",
        " \t*\t ",
      ]) {
        const counter = { calls: 0 };
        const response = await admin.request(
          asset.url,
          { method, headers: { "if-none-match": value } },
          env({ CONVERSIONS_UI_ENABLED: "true", ADMIN_ASSETS: physicalAssetBinding(counter) }),
        );
        expect(response.status, `${method} ${value}`).toBe(304);
        expect(response.headers.get("etag")).toBe(asset.etag);
        expect(await response.text()).toBe("");
        expect(counter.calls, `${method} ${value}`).toBe(0);
      }
    }

    for (const method of ["GET", "HEAD"] as const) {
      const counter = { calls: 0 };
      const response = await admin.request(
        asset.url,
        { method, headers: { "if-none-match": 'W/"different"' } },
        env({ CONVERSIONS_UI_ENABLED: "true", ADMIN_ASSETS: physicalAssetBinding(counter) }),
      );
      expect(response.status).toBe(200);
      expect(counter.calls).toBe(1);
      expect(await response.text()).toBe(method === "HEAD" ? "" : readFileSync(resolve(API_ROOT, "public/assets/admin/conversions", asset.fileName), "utf8"));
    }
  });

  it("treats malformed If-None-Match fields as non-matches for GET and HEAD", async () => {
    const asset = ADMIN_ASSET_MANIFEST.conversions.js;
    const malformed = [
      `W/   ${asset.etag}`,
      `W/\t${asset.etag}`,
      `*, "other"`,
      `"other", *`,
      `${asset.etag},`,
      `, ${asset.etag}`,
      `"other",, ${asset.etag}`,
      `bare, ${asset.etag}`,
      `"unterminated, ${asset.etag}`,
      `${asset.etag} trailing`,
      `w/${asset.etag}`,
      `${asset.etag}, W/ ${asset.etag}`,
      `"bad\\"quote", ${asset.etag}`,
    ];

    for (const method of ["GET", "HEAD"] as const) {
      for (const value of malformed) {
        const counter = { calls: 0 };
        const response = await admin.request(
          asset.url,
          { method, headers: { "if-none-match": value } },
          env({ CONVERSIONS_UI_ENABLED: "true", ADMIN_ASSETS: physicalAssetBinding(counter) }),
        );
        expect(response.status, `${method} ${value}`).toBe(200);
        expect(counter.calls, `${method} ${value}`).toBe(1);
        expect(await response.text(), `${method} ${value}`).toBe(
          method === "HEAD"
            ? ""
            : readFileSync(resolve(API_ROOT, "public/assets/admin/conversions", asset.fileName), "utf8"),
        );
      }
    }
  });

  it("fails safely when the static binding is missing or unhealthy", async () => {
    const missing = env({ CONVERSIONS_UI_ENABLED: "true", ADMIN_ASSETS: undefined });
    expect((await admin.request(ADMIN_ASSET_MANIFEST.conversions.js.url, {}, missing)).status).toBe(503);
    const unhealthy = env({
      CONVERSIONS_UI_ENABLED: "true",
      ADMIN_ASSETS: { fetch: async () => new Response("bad", { status: 500 }) } as unknown as Fetcher,
    });
    expect((await admin.request(ADMIN_ASSET_MANIFEST.reporting.css.url, {}, unhealthy)).status).toBe(503);
  });

  it("renders the gated navigation consistently in central, Listicles, and LeadGen shells", () => {
    const central = dashboardPage(
      { sites: 0, totalArticles: 0, published: 0, drafts: 0, pages: 0, mediaFiles: 0, categories: 0 },
      [],
      { conversionsUiEnabled: true },
    );
    const listicles = listiclesOffersPage(
      {
        offers: [],
        paging: { page: 1, page_size: 25, total: 0, has_next: false, has_prev: false },
        filters: { search: "", provider: "", vertical: "", activity: "", status: "", range: "30d" },
        filterOptions: { providers: [], verticals: [], activities: [] },
        timeframe: { key: "30d", from: "2026-01-01", to: "2026-01-30" },
        loadError: null,
      },
      { conversionsUiEnabled: true },
    );
    const leadgen = leadgenPageShell({
      activePath: "/admin/leadgen/offers",
      conversionsUiEnabled: true,
      content: "<p>LeadGen</p>",
    });
    for (const html of [central, listicles, leadgen]) assertEnabledNav(html);

    for (const html of [
      dashboardPage({ sites: 0, totalArticles: 0, published: 0, drafts: 0, pages: 0, mediaFiles: 0, categories: 0 }, []),
      leadgenPageShell({ activePath: "/admin/leadgen/offers", conversionsUiEnabled: false, content: "" }),
    ]) {
      expect(html).not.toContain('data-admin-nav-group="conversions"');
      expect(html).not.toContain('href="/admin/reporting"');
    }
  });
});
