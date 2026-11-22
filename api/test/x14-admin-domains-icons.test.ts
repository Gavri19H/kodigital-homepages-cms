// X14 (admin half) — Domains list: a 24×24 picture before each site's name.
// Preference: tab icon → uploaded logo (never the AI setup logo) → teal
// letter badge. The reader fetches every site's two keys in ONE query.
//
// Fails on the code before X14: rows rendered the bare site name and the
// reader never read site_settings.

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { domainsPage, siteIconHtml, type DomainEntry } from "../src/admin/templates/domains";
import * as data from "../src/admin/data";
import { makeFakeDb, buildEnv } from "./helpers/admin-test-kit";

function nameCell(html: string, siteId: string): string {
  const row = html.match(new RegExp(`<tr[^>]*data-site-id="${siteId}"[^>]*>(.*?)</tr>`));
  expect(row, `row for ${siteId}`).not.toBeNull();
  const cells = row![1]!.match(/<td[^>]*>.*?<\/td>/g)!;
  return cells[1]!; // Domain, Site name, ...
}

const base: DomainEntry = { id: "s", domain: "acme.example", name: "Acme" };

describe("X14 Domains list — site picture", () => {
  it("uses the tab icon first (even when an uploaded logo exists)", () => {
    const html = siteIconHtml({ ...base, favicon_media_id: "2026/11/22/icon.png", logo_media_id: "2026/08/18/logo.png" });
    expect(html).toBe(
      '<img class="site-icon" src="/media/2026/11/22/icon.png" width="24" height="24" alt="" loading="lazy" decoding="async" />',
    );
  });

  it("falls back to the uploaded logo when there is no tab icon", () => {
    const html = siteIconHtml({ ...base, favicon_media_id: "", logo_media_id: "2026/08/18/logo.png" });
    expect(html).toContain('src="/media/2026/08/18/logo.png"');
    expect(html).toContain('alt=""');
  });

  it("never uses the AI setup logo: shows the letter badge instead", () => {
    const html = siteIconHtml({ ...base, logo_media_id: "ai/site-1/logo/site-1.png" });
    expect(html).toBe('<span class="site-icon site-icon-letter" aria-hidden="true">A</span>');
  });

  it("shows the letter badge when the site has neither; a number media id is a real picture (served by /media/<id>)", () => {
    expect(siteIconHtml({ ...base, name: "zeta news" })).toBe(
      '<span class="site-icon site-icon-letter" aria-hidden="true">Z</span>',
    );
    expect(siteIconHtml({ ...base, logo_media_id: "7" })).toContain('src="/media/7"');
  });

  it("escapes the letter and the stored picture value", () => {
    expect(siteIconHtml({ ...base, name: "<b>" })).toContain(">&lt;</span>");
    const html = siteIconHtml({ ...base, favicon_media_id: 'x"onerror="alert(1)' });
    expect(html).not.toContain('"onerror="');
    expect(html).toContain("&quot;onerror=&quot;");
  });

  it("renders the picture before the name inside the Site name cell, for each row", () => {
    const html = domainsPage(
      [
        { id: "s1", domain: "one.example", name: "One", favicon_media_id: "2026/11/22/one.png" },
        { id: "s2", domain: "two.example", name: "Two", logo_media_id: "2026/08/18/two.png" },
        { id: "s3", domain: "three.example", name: "Three", logo_media_id: "ai/s3/logo/s3.png" },
      ],
      [],
    );
    const one = nameCell(html, "s1");
    expect(one).toMatch(/<img class="site-icon" src="\/media\/2026\/11\/22\/one\.png"[^>]*>.*One/);
    expect(nameCell(html, "s2")).toContain('src="/media/2026/08/18/two.png"');
    expect(nameCell(html, "s3")).toContain('<span class="site-icon site-icon-letter" aria-hidden="true">T</span>');
    expect(nameCell(html, "s3")).toContain('<span class="site-name-text">Three</span>');
    // Size/shape rules ship with the page.
    expect(html).toContain(".site-icon{flex:0 0 24px;width:24px;height:24px;border-radius:4px;object-fit:contain}");
    expect(html).toContain("background:#1ba8c8");
  });
});

describe("X14 Domains list — reader", () => {
  it("reads every site's favicon_media_id + logo_media_id in one query and maps them per row", async () => {
    const row = (hostname: string, site_id: string) => ({
      hostname,
      site_id,
      site_name: site_id,
      vertical_slug: "home",
      activity: "main",
      status: "active",
      created_at: 100,
      last_provisioned_at: 100,
    });
    const { db, calls } = makeFakeDb(
      [],
      [
        { match: "FROM domains d INNER JOIN sites s", rows: [row("a.example", "st_a"), row("b.example", "st_b"), row("c.example", "st_c")] },
        {
          match: "FROM site_settings",
          rows: [
            { site_id: "st_a", key: "favicon_media_id", value: "2026/11/22/a.png" },
            { site_id: "st_a", key: "logo_media_id", value: "2026/08/18/a-logo.png" },
            { site_id: "st_b", key: "logo_media_id", value: "2026/08/18/b-logo.png" },
          ],
        },
      ],
    );
    const dtos = await data.listAdminDomains(buildEnv(db));
    const settingsReads = calls.filter((c) => c.sql.indexOf("FROM site_settings") >= 0);
    expect(settingsReads.length).toBe(1);
    expect(settingsReads[0]!.sql).toContain("key IN ('favicon_media_id', 'logo_media_id')");
    const bySite = Object.fromEntries(dtos.map((d) => [d.site_id, d]));
    expect(bySite.st_a!.favicon_media_id).toBe("2026/11/22/a.png");
    expect(bySite.st_a!.logo_media_id).toBe("2026/08/18/a-logo.png");
    expect(bySite.st_b!.favicon_media_id).toBe("");
    expect(bySite.st_b!.logo_media_id).toBe("2026/08/18/b-logo.png");
    expect(bySite.st_c!.favicon_media_id).toBe("");
    expect(bySite.st_c!.logo_media_id).toBe("");
  });

  it("the production SQL runs on real SQLite and only returns the two keys", async () => {
    type Db = {
      exec(sql: string): void;
      prepare(sql: string): { all(...a: unknown[]): unknown[]; get(...a: unknown[]): unknown; run(...a: unknown[]): unknown };
      close(): void;
    };
    let Ctor: (new (p: string) => Db) | null = null;
    try {
      Ctor = (createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (p: string) => Db }).DatabaseSync;
    } catch {
      return; // Node without node:sqlite: the fake-DB case above is the portable proof.
    }
    const sdb = new Ctor!(":memory:");
    try {
      sdb.exec(`
        CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, vertical_slug TEXT, activity TEXT, status TEXT, created_at INTEGER, last_provisioned_at INTEGER);
        CREATE TABLE domains (id INTEGER PRIMARY KEY, site_id TEXT NOT NULL, hostname TEXT NOT NULL, is_primary INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE articles (id INTEGER PRIMARY KEY, site_id TEXT);
        CREATE TABLE site_settings (id INTEGER PRIMARY KEY, site_id TEXT, key TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(site_id, key));
        INSERT INTO sites VALUES ('st_a','Acme','home','main','active',100,100);
        INSERT INTO domains VALUES (1,'st_a','acme.example',1);
        INSERT INTO site_settings (site_id, key, value) VALUES
          ('st_a','favicon_media_id','2026/11/22/a.png'),
          ('st_a','logo_media_id','ai/st_a/logo/st_a.png'),
          ('st_a','site_name','Acme'),
          ('st_other','favicon_media_id','2026/11/22/other.png');
      `);
      const d1 = {
        prepare(sql: string) {
          let binds: unknown[] = [];
          const stmt = {
            bind(...a: unknown[]) { binds = a; return stmt; },
            async all() { return { results: sdb.prepare(sql).all(...binds), success: true, meta: {} }; },
            async first() { return sdb.prepare(sql).get(...binds) ?? null; },
            async run() { sdb.prepare(sql).run(...binds); return { success: true, meta: {} }; },
          };
          return stmt;
        },
      } as unknown as D1Database;
      const dtos = await data.listAdminDomains(buildEnv(d1));
      expect(dtos.length).toBe(1);
      expect(dtos[0]!.favicon_media_id).toBe("2026/11/22/a.png");
      expect(dtos[0]!.logo_media_id).toBe("ai/st_a/logo/st_a.png");
    } finally {
      sdb.close();
    }
  });
});
