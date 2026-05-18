// RX4 / MQAFIX-4 — GET /admin/pages MUST render the Site filter as a
// <select name="site_id"> element (NOT name="site"), per the T6.AC1 spec
// literal that calls for the wire name `site_id`.
//
// AC3 BEHAVIORAL contract (.ralph/execution_stories.json#RX4.AC3):
//   GIVEN GET /admin/pages
//   THEN  HTML response body contains literal substring '<select' AND
//         'name="site_id"' together (regex test), proving the Site
//         filter is wired with the canonical `site_id` wire name and not
//         the legacy `site` name.
//
// AC1 (grep contract) + AC2 (no name="site" double-render) are static
// greps against api/src/admin/templates/pages.ts and are independently
// satisfied by the file's current content. This file closes the
// HTTP-level wire contract that the static grep alone cannot prove.
//
// The route under test is api/src/admin/ui.ts:130 (`adminUi.get('/admin/pages', ...)`).
// The renderer it calls is `pagesListPage` from
// api/src/admin/templates/pages.ts (the CANONICAL template — see header
// comments in both api/src/admin/templates/pages.ts and the legacy
// api/src/admin/views/pages.ts for the two-templates split rationale).

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/admin/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/admin/data")>();
  return {
    ...actual,
    listAdminPages: vi.fn(),
    listAdminSites: vi.fn(),
  };
});

import { adminUi } from "../src/admin/ui";
import * as data from "../src/admin/data";
import type { Env } from "../src/env";

function makeEnv(): Env {
  return {
    DB: {} as unknown as D1Database,
    CACHE: {} as unknown as KVNamespace,
    MEDIA: {} as unknown as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "cms.kodigital.app",
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

async function fetchPages(): Promise<{ status: number; body: string }> {
  const res = await adminUi.fetch(
    new Request("http://cms.kodigital.app/admin/pages"),
    makeEnv(),
  );
  return { status: res.status, body: await res.text() };
}

describe("RX4 pages list site_id filter wire contract", () => {
  beforeEach(() => {
    vi.mocked(data.listAdminPages).mockReset();
    vi.mocked(data.listAdminSites).mockReset();
    vi.mocked(data.listAdminPages).mockResolvedValue([]);
    vi.mocked(data.listAdminSites).mockResolvedValue([
      { id: "siteA", name: "Site A" },
      { id: "siteB", name: "Site B" },
    ]);
  });

  it("RX4.AC3: GET /admin/pages renders <select name=\"site_id\"> Site filter", async () => {
    const { status, body } = await fetchPages();
    expect(status).toBe(200);
    // AC3 literal regex: `<select` AND `name="site_id"` together.
    expect(body).toMatch(/<select\s+name="site_id"/);
  });

  it("RX4.AC2: GET /admin/pages does NOT render legacy <select name=\"site\"> (double-render guard)", async () => {
    const { status, body } = await fetchPages();
    expect(status).toBe(200);
    // The legacy wire name MUST NOT appear on a <select element.
    // Use a tight regex that requires `<select ... name="site"` with a
    // word boundary so it does not accidentally match `name="site_id"`.
    expect(body).not.toMatch(/<select[^>]*\sname="site"[\s>]/);
  });

  it("RX4: GET /admin/pages exposes both Site filter and Page-type filter on the toolbar", async () => {
    const { status, body } = await fetchPages();
    expect(status).toBe(200);
    // Two distinct <select> elements, both named per the canonical wire
    // contract — this is the same shape pages-template.test.ts asserts
    // at the unit level, lifted to the route level.
    expect(body).toMatch(/<select\s+name="site_id"/);
    expect(body).toMatch(/<select\s+name="page_type"/);
  });

  it("RX4: GET /admin/pages renders site rows from data.listAdminSites into the Site filter options", async () => {
    vi.mocked(data.listAdminSites).mockResolvedValue([
      { id: "siteA", name: "Acme" },
      { id: "siteB", name: "Beta" },
    ]);
    const { status, body } = await fetchPages();
    expect(status).toBe(200);
    expect(data.listAdminSites).toHaveBeenCalledTimes(1);
    expect(body).toContain('<option value="siteA"');
    expect(body).toContain("Acme");
    expect(body).toContain('<option value="siteB"');
    expect(body).toContain("Beta");
  });
});
