import { describe, it, expect, vi, beforeEach } from "vitest";

// T2 contract: every admin route handler in api/src/admin/ui.ts MUST
// resolve real data via api/src/admin/data.ts and pass it to the page
// renderer (never empty arrays). Each route is exercised here with the
// matching data.ts wrapper mocked to return non-empty fixtures so the
// rendered HTML contains a row from the wrapper (not the template's
// empty-state placeholder). Test names all start with
// "admin ui handlers pass real data to templates" to satisfy the
// typed-contract test_name_regex `^admin ui handlers pass real data to
// templates`.

vi.mock("../src/admin/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/admin/data")>();
  return {
    ...actual,
    getDashboardStats: vi.fn(),
    getRecentArticles: vi.fn(),
    listAdminSites: vi.fn(),
    listAdminDomains: vi.fn(),
    listAdminVerticals: vi.fn(),
    listAdminArticles: vi.fn(),
    listArticlesForSite: vi.fn(),
    getAdminArticle: vi.fn(),
    listAdminPages: vi.fn(),
    getAdminPage: vi.fn(),
    listAdminCategories: vi.fn(),
    listAdminTags: vi.fn(),
    listAdminMedia: vi.fn(),
    listAdminPresets: vi.fn(),
    listAdminSettings: vi.fn(),
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

function resetMocks(): void {
  vi.mocked(data.getDashboardStats).mockReset();
  vi.mocked(data.getRecentArticles).mockReset();
  vi.mocked(data.listAdminSites).mockReset();
  vi.mocked(data.listAdminDomains).mockReset();
  vi.mocked(data.listAdminVerticals).mockReset();
  vi.mocked(data.listAdminArticles).mockReset();
  vi.mocked(data.listArticlesForSite).mockReset();
  vi.mocked(data.getAdminArticle).mockReset();
  vi.mocked(data.listAdminPages).mockReset();
  vi.mocked(data.getAdminPage).mockReset();
  vi.mocked(data.listAdminCategories).mockReset();
  vi.mocked(data.listAdminTags).mockReset();
  vi.mocked(data.listAdminMedia).mockReset();
  vi.mocked(data.listAdminPresets).mockReset();
  vi.mocked(data.listAdminSettings).mockReset();

  // Default empties so unrelated calls do not return undefined and crash
  // the renderer; tests override the specific calls they care about.
  vi.mocked(data.getDashboardStats).mockResolvedValue({
    sites: 0,
    totalArticles: 0,
    published: 0,
    drafts: 0,
    pages: 0,
    mediaFiles: 0,
    categories: 0,
  });
  vi.mocked(data.getRecentArticles).mockResolvedValue([]);
  vi.mocked(data.listAdminSites).mockResolvedValue([]);
  vi.mocked(data.listAdminDomains).mockResolvedValue([]);
  vi.mocked(data.listAdminVerticals).mockResolvedValue([]);
  vi.mocked(data.listAdminArticles).mockResolvedValue([]);
  vi.mocked(data.listArticlesForSite).mockResolvedValue([]);
  vi.mocked(data.getAdminArticle).mockResolvedValue(null);
  vi.mocked(data.listAdminPages).mockResolvedValue([]);
  vi.mocked(data.getAdminPage).mockResolvedValue(null);
  vi.mocked(data.listAdminCategories).mockResolvedValue([]);
  vi.mocked(data.listAdminTags).mockResolvedValue([]);
  vi.mocked(data.listAdminMedia).mockResolvedValue([]);
  vi.mocked(data.listAdminPresets).mockResolvedValue([]);
  vi.mocked(data.listAdminSettings).mockResolvedValue({});
}

async function fetchAdmin(path: string): Promise<{ status: number; body: string }> {
  const res = await adminUi.fetch(
    new Request(`http://cms.kodigital.app${path}`),
    makeEnv(),
  );
  return { status: res.status, body: await res.text() };
}

describe("admin ui handlers pass real data to templates", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("admin ui handlers pass real data to templates: dashboard renders stats from data.getDashboardStats", async () => {
    vi.mocked(data.getDashboardStats).mockResolvedValue({
      sites: 7,
      totalArticles: 42,
      published: 30,
      drafts: 12,
      pages: 5,
      mediaFiles: 9,
      categories: 4,
    });
    vi.mocked(data.getRecentArticles).mockResolvedValue([
      {
        id: "1",
        title: "Recent-Wiring-Probe",
        site: "siteA",
        status: "published",
        updatedAt: "2026-05-15",
      },
    ]);

    const { status, body } = await fetchAdmin("/admin");

    expect(status).toBe(200);
    expect(data.getDashboardStats).toHaveBeenCalledTimes(1);
    expect(data.getRecentArticles).toHaveBeenCalledTimes(1);
    // 7 sites stat from the mocked stats must be rendered into the grid.
    expect(body).toContain(">7<");
    expect(body).toContain("Recent-Wiring-Probe");
  });

  it("admin ui handlers pass real data to templates: domains route lists rows from data.listAdminDomains", async () => {
    vi.mocked(data.listAdminDomains).mockResolvedValue([
      {
        domain: "demo-acme.example",
        site_name: "Demo Acme",
        vertical: "finance",
        activity: "credit-cards",
        status: "active",
        articles: 4,
        created: "2026-05-01",
        last_provisioned: "2026-05-10",
      },
    ]);
    vi.mocked(data.listAdminVerticals).mockResolvedValue([
      { slug: "finance", label: "Finance" },
    ]);

    const { status, body } = await fetchAdmin("/admin/domains");

    expect(status).toBe(200);
    expect(data.listAdminDomains).toHaveBeenCalledTimes(1);
    expect(data.listAdminVerticals).toHaveBeenCalledTimes(1);
    expect(body).toContain("demo-acme.example");
    expect(body).toContain("Demo Acme");
  });

  it("admin ui handlers pass real data to templates: articles route calls listArticlesForSite with resolved site_id", async () => {
    vi.mocked(data.listAdminSites).mockResolvedValue([
      { id: "siteA", name: "Site A" },
      { id: "siteB", name: "Site B" },
    ]);
    vi.mocked(data.listArticlesForSite).mockResolvedValue([
      {
        id: "10",
        title: "Articles-Wiring-Probe",
        slug: "wiring-probe",
        site: "Site A",
        site_id: "siteA",
        category: "",
        status: "published",
        homepage_section: null,
        is_featured: false,
        is_trending: false,
        published_at: "2026-05-12",
        updated_at: "2026-05-13",
      },
    ]);

    const { status, body } = await fetchAdmin("/admin/articles");

    expect(status).toBe(200);
    expect(data.listArticlesForSite).toHaveBeenCalledTimes(1);
    expect(data.listArticlesForSite).toHaveBeenCalledWith(
      expect.any(Object),
      "siteA",
    );
    expect(body).toContain("Articles-Wiring-Probe");
    expect(body).not.toContain("No articles yet");
  });

  it("admin ui handlers pass real data to templates: articles route honors ?site_id= override when resolving the per-site wrapper", async () => {
    vi.mocked(data.listAdminSites).mockResolvedValue([
      { id: "siteA", name: "Site A" },
      { id: "siteB", name: "Site B" },
    ]);
    vi.mocked(data.listArticlesForSite).mockResolvedValue([
      {
        id: "20",
        title: "Override-Wiring-Probe",
        slug: "override-probe",
        site: "Site B",
        site_id: "siteB",
        category: "",
        status: "draft",
        homepage_section: null,
        is_featured: false,
        is_trending: false,
        published_at: null,
        updated_at: "2026-05-14",
      },
    ]);

    const { status, body } = await fetchAdmin("/admin/articles?site_id=siteB");

    expect(status).toBe(200);
    expect(data.listArticlesForSite).toHaveBeenCalledWith(
      expect.any(Object),
      "siteB",
    );
    expect(body).toContain("Override-Wiring-Probe");
  });

  it("admin ui handlers pass real data to templates: pages route lists rows from data.listAdminPages", async () => {
    vi.mocked(data.listAdminPages).mockResolvedValue([
      {
        id: "1",
        title: "About-Wiring-Probe",
        slug: "about",
        site: "Site A",
        site_id: "siteA",
        page_type: "about",
        status: "published",
        show_in_footer: false,
        updated_at: "2026-05-12",
      },
    ]);
    vi.mocked(data.listAdminSites).mockResolvedValue([
      { id: "siteA", name: "Site A" },
    ]);

    const { status, body } = await fetchAdmin("/admin/pages");

    expect(status).toBe(200);
    expect(data.listAdminPages).toHaveBeenCalledTimes(1);
    expect(body).toContain("About-Wiring-Probe");
    expect(body).not.toContain("No pages yet");
  });

  it("admin ui handlers pass real data to templates: categories route lists rows from data.listAdminCategories", async () => {
    vi.mocked(data.listAdminCategories).mockResolvedValue([
      {
        id: "1",
        name: "Categories-Wiring-Probe",
        slug: "wiring-probe",
        article_count: 3,
        display_order: 0,
        show_on_homepage: 0,
        verticals: [],
      },
    ]);
    vi.mocked(data.listAdminSites).mockResolvedValue([
      { id: "siteA", name: "Site A" },
    ]);

    const { status, body } = await fetchAdmin("/admin/categories");

    expect(status).toBe(200);
    expect(data.listAdminCategories).toHaveBeenCalledTimes(1);
    expect(body).toContain("Categories-Wiring-Probe");
  });

  it("admin ui handlers pass real data to templates: tags route lists rows from data.listAdminTags", async () => {
    vi.mocked(data.listAdminTags).mockResolvedValue([
      {
        id: "1",
        name: "Tags-Wiring-Probe",
        slug: "wiring-probe",
        site_id: "siteA",
        article_count: 5,
      },
    ]);
    vi.mocked(data.listAdminSites).mockResolvedValue([
      { id: "siteA", name: "Site A" },
    ]);

    const { status, body } = await fetchAdmin("/admin/tags");

    expect(status).toBe(200);
    expect(data.listAdminTags).toHaveBeenCalledTimes(1);
    expect(body).toContain("Tags-Wiring-Probe");
  });

  it("admin ui handlers pass real data to templates: media route lists rows from data.listAdminMedia", async () => {
    vi.mocked(data.listAdminMedia).mockResolvedValue([
      {
        id: "1",
        filename: "Media-Wiring-Probe.png",
        preview_url: "/media/probe.png",
        site_id: "siteA",
        kind: "image",
        size: 1024,
        uploaded_at: "2026-05-12",
      },
    ]);
    vi.mocked(data.listAdminSites).mockResolvedValue([
      { id: "siteA", name: "Site A" },
    ]);

    const { status, body } = await fetchAdmin("/admin/media");

    expect(status).toBe(200);
    expect(data.listAdminMedia).toHaveBeenCalledTimes(1);
    expect(body).toContain("Media-Wiring-Probe.png");
  });

  it("admin ui handlers pass real data to templates: settings route fetches site settings via data.listAdminSettings", async () => {
    vi.mocked(data.listAdminSites).mockResolvedValue([
      { id: "siteA", name: "Site A" },
    ]);
    vi.mocked(data.listAdminSettings).mockResolvedValue({
      site_name: "Settings-Wiring-Probe",
      tagline: "Hello",
    });

    const { status, body } = await fetchAdmin("/admin/settings");

    expect(status).toBe(200);
    expect(data.listAdminSettings).toHaveBeenCalledTimes(1);
    expect(data.listAdminSettings).toHaveBeenCalledWith(
      expect.any(Object),
      "siteA",
    );
    expect(body).toContain("Settings-Wiring-Probe");
  });

  it("admin ui handlers pass real data to templates: presets route lists rows from data.listAdminPresets", async () => {
    vi.mocked(data.listAdminPresets).mockResolvedValue([
      {
        id: "1",
        slug: "wiring-probe",
        label: "Presets-Wiring-Probe",
        name: "Presets-Wiring-Probe",
        model: "",
        scope: "system",
        category: "title",
        description: "summary",
        usageCount: 0,
        variableCount: 0,
        isActive: true,
        isSystem: true,
      },
    ]);

    const { status, body } = await fetchAdmin("/admin/presets");

    expect(status).toBe(200);
    expect(data.listAdminPresets).toHaveBeenCalledTimes(1);
    expect(body).toContain("Presets-Wiring-Probe");
    // The empty-state row would be `<td ... class="empty-state">No presets ...`
    // while a real row uses `<tr data-preset-id="1">`.
    expect(body).not.toMatch(/class="empty-state">No presets/);
    expect(body).toContain('data-preset-id="1"');
  });
});
