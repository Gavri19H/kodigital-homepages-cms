// LeadGen v2.5.1 Phase B — DEV-57 registered runtime obligations (contract
// 11 §11.3 + 03 §3.3 mobile group + 10 SiteBranding projection):
//
//   1. `trust_strip.source:"site_logo_set"` PLUMB — the SiteBranding
//      projection gains `trust_logos` read from the OPTIONAL
//      `site_settings.trust_logo_media_ids` JSON list (defensive parse:
//      missing/corrupt/non-array/unresolvable → null; urls through the same
//      mediaUrl helper). Proven over a seeded node:sqlite D1 (the
//      leadgen-branding.test.ts harness pattern).
//   2. frame CONSUMES it — renderQuoteFrame renders the strip from
//      branding.trust_logos with the "<site name> logo <n>" alt fallback
//      (the settings list carries no alts); null/absent → the region renders
//      nothing; source:"manual" is unaffected. Includes one
//      producer→consumer leg (REAL resolveSiteBranding output into the
//      frame — never a hand-built projection only).
//   3. §3.3 `mobile` keys — logo_size / trust_strip_mobile /
//      progress_position emit `lg-frame--m-*` root modifier classes
//      (frame.ts mobileFrameClasses; progress classes only when the mount
//      actually moves) and the frameRegions-gated stylesheet carries the
//      matching rules INSIDE the single mobile media query — absent entirely
//      without the opt (legacy byte-stability, pinned elsewhere).
//
// The footer `show_on` ENGINE legs live in test/leadgen-frame-engine-sim.
// test.ts (the FakeElement harness is module-local there; the engine imports
// belong to the tsconfig.runtime.json DOM program, this file to the worker
// program — same split as leadgen-branding/leadgen-frame-render).

import { describe, expect, it } from "vitest";

import { renderQuoteFrame } from "../src/public/leadgen/designs/frame";
import type { RenderQuoteFrameInput } from "../src/public/leadgen/designs/frame";
import { LG_BANNERS_MOUNT_HTML } from "../src/public/leadgen/designs/frame";
import { effectiveFrame } from "../src/public/leadgen/designs/frames";
import type { FrameConfig, FrameTemplateId } from "../src/public/leadgen/designs/frames";
import { resolveTokens } from "../src/public/leadgen/designs/theme";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import {
  DEFAULT_FUNNEL_SCOPE,
  funnelChromeCss,
} from "../src/public/leadgen/designs/default-funnel/styles";
import { resolveSiteBranding } from "../src/leadgen/branding";
import type { SiteBranding } from "../src/leadgen/branding";

// --- node:sqlite harness (leadgen-branding.test.ts pattern) ------------------

type SqliteStatement = {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};
type SqliteDb = {
  prepare(sql: string): SqliteStatement;
  close(): void;
  [method: string]: unknown;
};
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    const nodeRequire = createRequire(import.meta.url);
    return (nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
    try {
      const getBuiltin = (process as unknown as {
        getBuiltinModule?: (name: string) => unknown;
      }).getBuiltinModule;
      if (typeof getBuiltin === "function") {
        return (getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
      }
    } catch {
      /* fall through */
    }
    return null;
  }
}

function runSql(sdb: SqliteDb, sql: string): void {
  (sdb["exec"] as (s: string) => void)(sql);
}

function d1FromSqlite(sdb: SqliteDb): D1Database {
  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          binds = a;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          return (sdb.prepare(sql).get(...binds) ?? null) as T | null;
        },
        async all<T = unknown>() {
          return { results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} };
        },
        async run() {
          const r = sdb.prepare(sql).run(...binds) as {
            changes?: number;
            lastInsertRowid?: number | bigint;
          };
          return {
            success: true,
            meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) },
          };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return db;
}

const TENANT_HOST = "one.example.com";

// Branding needs only sites + the 0003-shape site_settings table.
function createBrandingDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT);" +
      "CREATE TABLE site_settings (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, key TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(site_id, key));" +
      `INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','${TENANT_HOST}','insurance','active');`,
  );
  return sdb;
}

function setSetting(sdb: SqliteDb, siteId: string, key: string, value: string): void {
  sdb
    .prepare("INSERT OR REPLACE INTO site_settings (site_id, key, value) VALUES (?, ?, ?)")
    .run(siteId, key, value);
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;
const ctor = () => DatabaseSync as DatabaseSyncCtor;

async function brandingWith(trustSetting: string | null): Promise<SiteBranding> {
  const sdb = createBrandingDb(ctor());
  if (trustSetting !== null) setSetting(sdb, "site-1", "trust_logo_media_ids", trustSetting);
  return resolveSiteBranding(d1FromSqlite(sdb), "site-1");
}

// --- frame composition helpers (leadgen-frame-render.test.ts pattern) --------

const TOKENS = resolveTokens(defaultFunnelDesign);

const BRANDING: SiteBranding = {
  site_name: "Acme Insure",
  logo_url: "/media/site-logo.png",
  tagline: null,
  legal_links: [],
  trust_logos: [
    { media_id: "trust/a.png", url: "/media/trust/a.png" },
    { media_id: "trust/b.png", url: "/media/trust/b.png" },
  ],
};

const ROOT = {
  funnelId: "lgf_0000000000000000000OBLIG01",
  funnelVariantId: "lgn_0000000000000000000OBLIG02",
  quoteId: "lgq_0000000000000000000OBLIG03",
  contentVersion: 3,
};

const SECTIONS =
  '<section data-lg-section data-lg-section-id="lgs_0000000000000000000OBSEC01" data-lg-index="0"><h1 class="lg-headline">Q1</h1></section>';

function composed(
  template: FrameTemplateId,
  patch?: FrameConfig,
  over?: Partial<RenderQuoteFrameInput>,
): string {
  const { frame, problems } = effectiveFrame(template, patch ?? null);
  expect(problems).toEqual([]);
  return renderQuoteFrame({
    effectiveTokens: TOKENS,
    frame,
    siteBranding: BRANDING,
    sectionsHtml: SECTIONS,
    bannersMountHtml: LG_BANNERS_MOUNT_HTML,
    sectionCount: 1,
    root: ROOT,
    ...over,
  });
}

const rootTag = (html: string): string => html.slice(0, html.indexOf(">") + 1);

// ===========================================================================
// 1. §11.3 site_logo_set plumb — trust_logo_media_ids → SiteBranding.trust_logos
// ===========================================================================

describeDb("DEV-57 §11.3 — trust_logo_media_ids plumb (SiteBranding.trust_logos)", () => {
  it("valid JSON list of media keys → ordered {media_id, url} pairs through mediaUrl()", async () => {
    const branding = await brandingWith('["trust/a.png","trust/b.png"]');
    expect(branding.trust_logos).toEqual([
      { media_id: "trust/a.png", url: "/media/trust/a.png" },
      { media_id: "trust/b.png", url: "/media/trust/b.png" },
    ]);
  });

  it("missing key → null (the additive settings key is optional)", async () => {
    expect((await brandingWith(null)).trust_logos).toBeNull();
  });

  it("corrupt JSON → null (defensive parse, never a throw into a serve)", async () => {
    expect((await brandingWith("{not json[")).trust_logos).toBeNull();
  });

  it("non-array JSON → null", async () => {
    expect((await brandingWith('{"a":1}')).trust_logos).toBeNull();
  });

  it("empty list / nothing resolvable → null (consumer renders nothing)", async () => {
    expect((await brandingWith("[]")).trust_logos).toBeNull();
    expect((await brandingWith('["", "   "]')).trust_logos).toBeNull();
  });

  it("mixed entries: non-strings and blanks are SKIPPED; rooted/absolute refs pass mediaUrl unchanged", async () => {
    const branding = await brandingWith(
      '[42, "", "  ", "trust/ok.png", {"k":1}, "https://cdn.example.com/ext.svg", null]',
    );
    expect(branding.trust_logos).toEqual([
      { media_id: "trust/ok.png", url: "/media/trust/ok.png" },
      { media_id: "https://cdn.example.com/ext.svg", url: "https://cdn.example.com/ext.svg" },
    ]);
  });
});

// ===========================================================================
// 2. §11.3 frame consumer — trust_strip source:"site_logo_set"
// ===========================================================================

describe("DEV-57 §11.3 — trust_strip source:'site_logo_set' renders from siteBranding.trust_logos", () => {
  const SITE_SET: FrameConfig = { trust_strip: { enabled: true, source: "site_logo_set" } };

  it("renders the strip from the projection with the site-name+index alt fallback (list carries no alts)", () => {
    const html = composed("centered", SITE_SET);
    expect(html).toContain('data-frame-region="trust_strip"');
    expect(html).toContain(
      '<img class="lg-logo-strip-img" src="/media/trust/a.png" alt="Acme Insure logo 1" loading="lazy">',
    );
    expect(html).toContain(
      '<img class="lg-logo-strip-img" src="/media/trust/b.png" alt="Acme Insure logo 2" loading="lazy">',
    );
  });

  it("null trust_logos → the region renders nothing (as today)", () => {
    const html = composed("centered", SITE_SET, {
      siteBranding: { ...BRANDING, trust_logos: null },
    });
    expect(html).not.toContain('data-frame-region="trust_strip"');
    expect(html).not.toContain("lg-logo-strip");
  });

  it("absent siteBranding → the region renders nothing", () => {
    const html = composed("centered", SITE_SET, { siteBranding: undefined });
    expect(html).not.toContain('data-frame-region="trust_strip"');
  });

  it('source:"manual" is unaffected — renders the config logos, ignores the projection set', () => {
    const html = composed("centered", {
      trust_strip: {
        enabled: true,
        source: "manual",
        logos: [{ media_id: "m/logo.png", alt: "Manual alt" }],
      },
    });
    expect(html).toContain(
      '<img class="lg-logo-strip-img" src="/media/m/logo.png" alt="Manual alt" loading="lazy">',
    );
    expect(html).not.toContain("/media/trust/a.png");
  });

  it("producer→consumer: a REAL resolveSiteBranding projection feeds the strip end-to-end", async () => {
    if (DatabaseSync === null) return; // same skip condition as describeDb
    const sdb = createBrandingDb(ctor());
    setSetting(sdb, "site-1", "site_name", "Site One Brand");
    setSetting(sdb, "site-1", "trust_logo_media_ids", '["trust/real.png"]');
    const branding = await resolveSiteBranding(d1FromSqlite(sdb), "site-1");
    const html = composed("centered", SITE_SET, { siteBranding: branding });
    expect(html).toContain(
      '<img class="lg-logo-strip-img" src="/media/trust/real.png" alt="Site One Brand logo 1" loading="lazy">',
    );
  });
});

// ===========================================================================
// 3. §3.3 mobile keys — root class emission + frameRegions-gated CSS
// ===========================================================================

describe("DEV-57 §3.3 mobile keys — lg-frame--m-* class emission (frame.ts)", () => {
  it("logo_size / trust_strip_mobile / progress_position (moving) all emit their root modifier", () => {
    const tag = rootTag(
      composed("centered", {
        progress: { position: "under_header" },
        mobile: { logo_size: "s", trust_strip_mobile: "hide", progress_position: "above_unit" },
      }),
    );
    expect(tag).toContain(
      'class="lg-frame lg-frame--centered lg-frame--m-logo-s lg-frame--m-trust-hide lg-frame--m-progress-above_unit"',
    );
  });

  it("no mobile keys → no lg-frame--m-* classes (sparse group, template defaults)", () => {
    expect(rootTag(composed("centered"))).not.toContain("lg-frame--m-");
  });

  it("progress_position equal to the desktop position is a no-op (class not emitted)", () => {
    const tag = rootTag(
      composed("centered", {
        progress: { position: "above_unit" },
        mobile: { progress_position: "above_unit" },
      }),
    );
    expect(tag).not.toContain("lg-frame--m-progress-");
  });

  it("desktop in_card mount cannot be moved by CSS → class not emitted (D-phase engine leg)", () => {
    const tag = rootTag(
      composed("centered", {
        progress: { position: "in_card" },
        mobile: { progress_position: "top" },
      }),
    );
    expect(tag).not.toContain("lg-frame--m-progress-");
  });

  it("hide_footer stays the footer-region consumer (lg-frame-footer--m-hide, no root class)", () => {
    const html = composed("centered", { mobile: { hide_footer: true } });
    expect(rootTag(html)).not.toContain("lg-frame--m-");
    expect(html).toContain("lg-frame-footer--m-hide");
  });
});

describe("DEV-57 §3.3 mobile keys — frameRegions-gated CSS rules (styles.ts)", () => {
  const S = DEFAULT_FUNNEL_SCOPE;
  const cssDefault = funnelChromeCss(defaultFunnelDesign);
  const cssFrame = funnelChromeCss(defaultFunnelDesign, S, { frameRegions: true });
  const mediaIdx = cssFrame.indexOf("@media");

  it("without the frameRegions opt NO mobile-key rule exists (legacy byte-stability)", () => {
    expect(cssDefault).not.toContain("lg-frame--m-");
  });

  it("logo_size steps mirror the desktop s/m/l values inside the media query", () => {
    for (const sel of [
      `${S}.lg-frame--m-logo-s .lg-logo{font-size:0.95rem}`,
      `${S}.lg-frame--m-logo-l .lg-logo{font-size:1.35rem}`,
      `${S}.lg-frame--m-logo-s .lg-logo-img{max-height:24px!important}`,
      `${S}.lg-frame--m-logo-l .lg-logo-img{max-height:44px!important}`,
    ]) {
      expect(cssFrame).toContain(sel);
      expect(cssFrame.indexOf(sel)).toBeGreaterThan(mediaIdx);
    }
  });

  it("trust override outranks the strip's own mode (root modifier + region class; wrap/scroll restore display)", () => {
    expect(cssFrame).toContain(`${S}.lg-frame--m-trust-hide .lg-frame-trust{display:none}`);
    expect(cssFrame).toContain(`${S}.lg-frame--m-trust-wrap .lg-frame-trust{display:block}`);
    expect(cssFrame).toContain(
      `${S}.lg-frame--m-trust-scroll .lg-frame-trust .lg-logo-strip{flex-wrap:nowrap;overflow-x:auto;justify-content:flex-start}`,
    );
    expect(cssFrame).toContain(
      `${S}.lg-frame--m-trust-wrap .lg-frame-trust .lg-logo-strip{flex-wrap:wrap;overflow-x:visible;justify-content:center}`,
    );
  });

  it("progress re-arrangement: flex-column root + order rules for every target position", () => {
    expect(cssFrame).toContain(
      `${S}.lg-frame--m-progress-top,${S}.lg-frame--m-progress-under_header,${S}.lg-frame--m-progress-above_unit,${S}.lg-frame--m-progress-in_card{display:flex;flex-direction:column}`,
    );
    expect(cssFrame).toContain(
      `${S}.lg-frame--m-progress-top .lg-frame-progress,${S}.lg-frame--m-progress-under_header .lg-frame-header{order:-2}`,
    );
    expect(cssFrame).toContain(`${S}.lg-frame--m-progress-under_header .lg-frame-progress{order:-1}`);
    expect(cssFrame).toContain(
      `${S}.lg-frame--m-progress-above_unit .lg-frame-progress,${S}.lg-frame--m-progress-in_card .lg-frame-progress{order:1}`,
    );
    expect(cssFrame).toContain(
      `${S}.lg-frame--m-progress-above_unit .lg-frame-slot,${S}.lg-frame--m-progress-in_card .lg-frame-slot{order:2}`,
    );
  });

  it("still exactly ONE @media block (the single mobile query contract)", () => {
    expect(cssFrame.split("@media").length - 1).toBe(1);
  });
});
