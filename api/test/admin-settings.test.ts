// Phase 3 / T8.AC1: PATCH /api/admin/settings is strictly site-scoped and
// increments sites.settings_version atomically with the per-(site_id,key)
// UPSERT. The first test name below matches the RC-020 evidence runner
// `-t "PATCH /api/admin/settings increments settings_version"` filter
// exactly so the canonical runner binding is satisfied by name alone.
//
// Two distinct behaviours are pinned here:
//   1. version bump   — settings_version goes from N to N+1 for the target
//                       site and the UPSERT + bump ride one D1 batch.
//   2. site isolation — when site A is patched, every recorded SQL bind
//                       targets site A; nothing in the batch references
//                       site B's id, so site B's settings rows cannot be
//                       mutated by the round trip.

import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import {
  SETTING_KEYS,
  settingsPage,
  type SettingsValueMap,
} from "../src/admin/templates/settings";

interface RecordedCall {
  sql: string;
  binds: unknown[];
  via: "run" | "batch";
}

interface PlantedRow {
  match: string;
  row: unknown | null;
}

function makeFakeDb(planted: PlantedRow[] = []): {
  db: D1Database;
  calls: RecordedCall[];
  batches: RecordedCall[][];
} {
  const calls: RecordedCall[] = [];
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
        calls.push({ sql, binds: captured, via: "run" });
        for (const entry of planted) {
          if (sql.indexOf(entry.match) >= 0) {
            return (entry.row ?? null) as T | null;
          }
        }
        return null;
      },
      async run() {
        calls.push({ sql, binds: captured, via: "run" });
        return { success: true, meta: {} };
      },
      async all<T = unknown>() {
        calls.push({ sql, binds: captured, via: "run" });
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
      const batchRecord: RecordedCall[] = [];
      for (const s of statements) {
        const rec = { sql: s._sql, binds: s._binds(), via: "batch" as const };
        batchRecord.push(rec);
        calls.push(rec);
      }
      batches.push(batchRecord);
      return statements.map(() => ({ success: true, meta: {} }));
    },
  } as unknown as D1Database;
  return { db, calls, batches };
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

describe("admin settings PATCH (T8.AC1)", () => {
  it("PATCH /api/admin/settings increments settings_version", async () => {
    const { db, calls, batches } = makeFakeDb([
      {
        match: "FROM sites WHERE id = ?",
        row: { id: "st_a", settings_version: 7 },
      },
    ]);
    const res = await admin.request(
      "/api/admin/settings",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          site_id: "st_a",
          updates: { tagline: "Site A tagline." },
        }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      site_id: string;
      settings_version: number;
      updated_keys: string[];
    };
    expect(body.site_id).toBe("st_a");
    expect(body.settings_version).toBe(8);
    expect(body.updated_keys).toEqual(["tagline"]);

    // One D1 batch, two statements: UPSERT then version bump. Riding the
    // same batch is what makes the version + value transition atomic.
    expect(batches.length).toBe(1);
    const batch = batches[0];
    if (!batch) throw new Error("batch not recorded");
    expect(batch.length).toBe(2);

    const upsert = batch[0];
    if (!upsert) throw new Error("UPSERT statement missing");
    expect(upsert.sql).toMatch(/INSERT INTO site_settings/);
    expect(upsert.sql).toMatch(/ON CONFLICT\(site_id, key\)/);
    expect(upsert.binds).toEqual(["st_a", "tagline", "Site A tagline."]);

    const bump = batch[1];
    if (!bump) throw new Error("version-bump statement missing");
    expect(bump.sql).toMatch(/UPDATE sites SET settings_version = settings_version \+ 1/);
    expect(bump.binds).toEqual(["st_a"]);

    // The settings_version SELECT runs OUTSIDE the batch so the response
    // can report the post-bump number without a follow-up read.
    const lookup = calls.find((c) => c.sql.indexOf("FROM sites WHERE id = ?") >= 0);
    expect(lookup).toBeDefined();
    expect(lookup?.via).toBe("run");
  });

  it("PATCH /api/admin/settings does not touch other sites' settings rows", async () => {
    const { db, calls, batches } = makeFakeDb([
      {
        match: "FROM sites WHERE id = ?",
        row: { id: "st_a", settings_version: 3 },
      },
    ]);
    const res = await admin.request(
      "/api/admin/settings",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          site_id: "st_a",
          updates: {
            tagline: "A only.",
            contact_email: "a@example.test",
          },
        }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(200);

    // Every SQL fired by the handler must carry site_id="st_a" as the
    // first positional bind (settings UPSERT) or the only bind (version
    // bump + SELECT). No statement references site_id="st_b" because the
    // handler refuses to operate without a `site_id` body field — global
    // updates are not reachable through this route.
    for (const call of calls) {
      expect(call.binds).not.toContain("st_b");
    }

    // The batch contains exactly N UPSERTs + 1 version bump, all bound
    // to site A.
    expect(batches.length).toBe(1);
    const batch = batches[0];
    if (!batch) throw new Error("batch not recorded");
    expect(batch.length).toBe(3);
    const [upsert1, upsert2, bump] = batch;
    if (!upsert1 || !upsert2 || !bump) throw new Error("missing batch entries");
    expect(upsert1.binds[0]).toBe("st_a");
    expect(upsert2.binds[0]).toBe("st_a");
    expect(bump.binds).toEqual(["st_a"]);

    // No UPDATE/INSERT statement is allowed to omit the site_id WHERE
    // clause — i.e. a "global" write would lack the WHERE id = ? guard
    // on sites OR the (site_id, key) ON CONFLICT clause on site_settings.
    for (const call of calls) {
      if (call.sql.indexOf("UPDATE sites") >= 0) {
        expect(call.sql).toMatch(/WHERE id = \?/);
      }
      if (call.sql.indexOf("INSERT INTO site_settings") >= 0) {
        expect(call.sql).toMatch(/ON CONFLICT\(site_id, key\)/);
      }
    }
  });

  it("PATCH /api/admin/settings refuses request with no site_id (no global mutation reachable)", async () => {
    const { db, calls, batches } = makeFakeDb([]);
    const res = await admin.request(
      "/api/admin/settings",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          updates: { tagline: "Anywhere." },
        }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(400);
    // No batch shipped, no SQL fired — the 400 short-circuits before any
    // D1 round trip so a missing site_id cannot become a global write.
    expect(batches.length).toBe(0);
    expect(calls.length).toBe(0);
  });

  it("PATCH round-trips all 12 canonical keys for one site (12 UPSERTs + version bump in one batch)", async () => {
    const { db, batches } = makeFakeDb([
      {
        match: "FROM sites WHERE id = ?",
        row: { id: "st_a", settings_version: 4 },
      },
    ]);
    const updates: Record<string, string> = {};
    for (const key of SETTING_KEYS) {
      updates[key] = `probe_${key}`;
    }
    const res = await admin.request(
      "/api/admin/settings",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ site_id: "st_a", updates }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      site_id: string;
      settings_version: number;
      updated_keys: string[];
    };
    expect(body.site_id).toBe("st_a");
    expect(body.settings_version).toBe(5);
    expect(body.updated_keys).toEqual([...SETTING_KEYS]);

    // One atomic batch: one UPSERT per canonical key, then the version
    // bump as the final statement.
    expect(batches.length).toBe(1);
    const batch = batches[0];
    if (!batch) throw new Error("batch not recorded");
    expect(batch.length).toBe(SETTING_KEYS.length + 1);
    SETTING_KEYS.forEach((key, i) => {
      const upsert = batch[i];
      if (!upsert) throw new Error(`UPSERT for ${key} missing`);
      expect(upsert.sql).toMatch(/INSERT INTO site_settings/);
      expect(upsert.sql).toMatch(/ON CONFLICT\(site_id, key\)/);
      expect(upsert.binds).toEqual(["st_a", key, `probe_${key}`]);
    });
    const bump = batch[batch.length - 1];
    if (!bump) throw new Error("version-bump statement missing");
    expect(bump.sql).toMatch(/UPDATE sites SET settings_version = settings_version \+ 1/);
    expect(bump.binds).toEqual(["st_a"]);
  });
});

// T32 [B11] Settings port (per-site) — template contract.
// The page must render the required Site selector, the legacy card
// groups, one control per canonical key with values round-tripped, and
// its inline script must send the T24 wire shape {site_id, updates} to
// PATCH /api/admin/settings and target POST /api/admin/ai/logo for AI
// logo generation.
describe("settings template (T32 settings port per-site)", () => {
  const sites = [
    { id: "st_a", name: "Site A" },
    { id: "st_b", name: "Site B" },
  ];

  it("renders the required site selector with options and a hidden site_id bound to the selection", () => {
    const html = settingsPage(sites, {}, "st_b", { userEmail: "qa@example.test" });
    expect(html).toMatch(/<select id="filter-site"[^>]*name="site_id"[^>]*required/);
    expect(html).toContain('<option value="st_a"');
    expect(html).toMatch(/<option value="st_b" selected/);
    expect(html).toMatch(
      /<input type="hidden" id="settings-site-id" name="site_id"[^>]*value="st_b"/,
    );
  });

  it("renders one form control per canonical key and round-trips provided values", () => {
    const values: SettingsValueMap = {};
    for (const key of SETTING_KEYS) {
      values[key] = `probe_${key}`;
    }
    const html = settingsPage(sites, values, "st_a", {});
    for (const key of SETTING_KEYS) {
      expect(html).toContain(`name="${key}"`);
      expect(html).toContain(`probe_${key}`);
    }
  });

  it("renders the ported card headings (Site Information / Site Logo / ads.txt / robots.txt / Custom HTML)", () => {
    const html = settingsPage(sites, {}, "st_a", {});
    for (const heading of [
      "Site Information",
      "Site Logo",
      "ads.txt",
      "robots.txt",
      "Brand Tokens",
      "Newsletter",
      "Custom HTML",
    ]) {
      expect(html).toContain(`<h3 class="card-title">${heading}</h3>`);
    }
  });

  it("submits PATCH {site_id, updates} to /api/admin/settings and targets /api/admin/ai/logo for logo generation", () => {
    const html = settingsPage(sites, {}, "st_a", {});
    expect(html).toContain("'/api/admin/settings'");
    expect(html).toContain("method: 'PATCH'");
    expect(html).toContain("{ site_id: hidden.value, updates: updates }");
    expect(html).toContain("'/api/admin/ai/logo'");
    // T24: the AI-logo button now POSTs an operator-directed LogoRequest. The
    // body starts from { site_id } and conditionally carries prompt / style /
    // colorScheme (was a fixed JSON.stringify({ site_id: hidden.value })).
    expect(html).toContain("var logoBody = { site_id: hidden.value }");
    expect(html).toContain("JSON.stringify(logoBody)");
    expect(html).toContain("logoBody.prompt = desc");
    expect(html).toContain("logoBody.colorScheme = col");
  });

  it("escapes setting values so stored content cannot break out of the form HTML", () => {
    const html = settingsPage(
      sites,
      { site_name: '"><script>alert(1)</script>' },
      "st_a",
      {},
    );
    expect(html).not.toContain('"><script>alert(1)</script>');
    expect(html).toContain("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

// T15.AC1 — Settings tab full parity: the served Settings markup carries a
// Site Logo file upload (logoFileInput / site_logo_url) IN ADDITION to the
// existing AI-logo panel, an items_per_page control, a settings-tabs / tab-*
// layout, and structured newsletter fields (enabled + provider) instead of a
// raw newsletter_settings_json textarea.
describe("settings tab full parity (T15.AC1)", () => {
  const sites = [{ id: "st_a", name: "Site A" }];

  it("renders a Site Logo file upload (logoFileInput / site_logo_url) alongside the AI-logo panel", () => {
    const html = settingsPage(sites, {}, "st_a", {});
    // file upload control
    expect(html).toMatch(/<input[^>]*id="logoFileInput"[^>]*type="file"/);
    expect(html).toContain('name="site_logo_url"');
    // existing AI-logo panel is still present (not replaced)
    expect(html).toContain('class="ai-logo-panel"');
    expect(html).toContain('id="ai-logo-generate"');
  });

  it("renders an items_per_page control", () => {
    const html = settingsPage(sites, {}, "st_a", {});
    expect(html).toMatch(/<input[^>]*name="items_per_page"[^>]*type="number"/);
  });

  it("renders a settings-tabs / tab-* tabbed layout", () => {
    const html = settingsPage(sites, {}, "st_a", {});
    expect(html).toContain('class="settings-tabs"');
    expect(html).toMatch(/id="tab-[a-z]+"/);
    // every tab panel is reachable via a tab button
    expect(html).toMatch(/class="settings-tablist"/);
  });

  it("renders structured newsletter fields (enabled + provider), not a raw newsletter_settings_json textarea", () => {
    const html = settingsPage(sites, {}, "st_a", {});
    expect(html).toMatch(/id="newsletter_enabled"[^>]*type="checkbox"|type="checkbox"[^>]*id="newsletter_enabled"/);
    expect(html).toContain('id="newsletter_provider"');
    // the raw JSON textarea must be gone (a hidden input keeps the wire key)
    expect(html).not.toMatch(/<textarea[^>]*name="newsletter_settings_json"/);
    expect(html).toMatch(/<input type="hidden"[^>]*name="newsletter_settings_json"/);
  });

  it("prefills structured newsletter fields from stored newsletter_settings_json", () => {
    const html = settingsPage(
      sites,
      { newsletter_settings_json: '{"enabled":true,"provider":"mailchimp"}' },
      "st_a",
      {},
    );
    expect(html).toMatch(/id="newsletter_enabled"[^>]*checked/);
    expect(html).toMatch(/<option value="mailchimp" selected/);
  });

  it("tolerates corrupt newsletter_settings_json (falls back to disabled / no provider)", () => {
    const html = settingsPage(
      sites,
      { newsletter_settings_json: "not-json-at-all" },
      "st_a",
      {},
    );
    // no crash; checkbox unchecked, provider defaults to the blank option
    expect(html).not.toMatch(/id="newsletter_enabled"[^>]*checked/);
    expect(html).toMatch(/<option value="" selected/);
    // raw value still preserved in the hidden round-trip input
    expect(html).toContain('value="not-json-at-all"');
  });

  it("submit script sends items_per_page + site_logo_url and composes the structured newsletter into newsletter_settings_json", () => {
    const html = settingsPage(sites, {}, "st_a", {});
    // parity keys are collected by the submit script
    expect(html).toContain("'items_per_page'");
    expect(html).toContain("'site_logo_url'");
    // newsletter is composed from the structured controls, not the raw input
    expect(html).toContain("nlEnabled ? !!nlEnabled.checked : false");
    expect(html).toContain("nlProvider ? nlProvider.value : ''");
    // still the T24 wire shape to the settings endpoint
    expect(html).toContain("'/api/admin/settings'");
    expect(html).toContain("{ site_id: hidden.value, updates: updates }");
  });

  it("wires the logo file upload to POST /admin/media (multipart) and reflects the result", () => {
    const html = settingsPage(sites, {}, "st_a", {});
    expect(html).toContain("'/admin/media'");
    expect(html).toContain("fd.append('file', file)");
    expect(html).toContain("logoFileInput");
  });
});
