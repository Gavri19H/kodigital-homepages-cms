// LeadGen v3.1 contract §13 Gate 2 — String. "Assert every Appendix A string
// renders in its region; assert the forbidden vocabulary (raw type names,
// column names, token keys, hex, id prefixes, 'JSON', 'slide') is ABSENT
// from all normal surfaces (present only under Advanced / theme Advanced)."
//
// Split with the existing suites, per the phase's CONSOLIDATE-don't-
// duplicate instruction:
// - NEGATIVE half (forbidden vocabulary absence): api/test/
//   leadgen-glossary-lint.test.ts already proves this exhaustively (12 its)
//   across Section-studio + Quotes pages. Its OWN documented gap (confirmed
//   by direct grep of its corpus-building code): it never visits
//   `/admin/leadgen/themes`. This file's negative half fills EXACTLY that
//   gap — the Themes manager — using the SAME derived-matrix approach
//   (columns via PRAGMA table_info, catalog via COMPONENT_CATALOG, token
//   keys via FUNNEL_TOKEN_ROLES / CURATED_DESIGN_OVERRIDE_KEYS), not a
//   hand-maintained duplicate list.
// - POSITIVE half (every Appendix A string actually renders, verbatim, in
//   its region): NOT attempted by any existing suite (confirmed — the 5
//   existing leadgen-*-ui/lint files assert scattered strings incidentally,
//   never a systematic per-Appendix-A-bullet sweep). This is this file's
//   main new contribution.
//
// STUDIO side: renderSectionStudio(...) is PURE (no D1). THEMES side needs
// the D1+KV harness (leadgenThemeManagerPage requires a live Context) —
// duplicated per repo convention (see leadgen-v31-gate3-geometry.test.ts).
//
// A string that is CLIENT-POPULATED ONLY (no SSR trace at all — e.g. the
// Offers-tab's per-provider rows, the Advanced tab's live zip/q_zip/
// cmp_zip1 VALUES, which ui-sections.ts's route handler bootstraps via a
// data blob this module does not own) is NOT re-implemented here via a vm-
// probe (that machinery already exists, proven, in
// leadgen-section-studio-ui.test.ts — referenced in leadgen-v31-gate-map.md
// rather than duplicated). Each such string is called out in a comment at
// its assertion site instead of silently omitted.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import type { ThemeRecord } from "../src/public/leadgen/designs/theme";
import {
  renderSectionStudio,
  SECTION_STUDIO_SCRIPT,
  type StudioSectionView,
  type StudioMappingSummary,
} from "../src/admin/leadgen/ui-section-studio";
import { STUDIO_COLOR } from "../src/admin/leadgen/studio-tokens";
import { COMPONENT_CATALOG } from "../src/public/leadgen/components/registry";
import { getFunnelDesign } from "../src/public/leadgen/designs/registry";
import { renderSectionComponents, type LeadgenSectionRenderCtx } from "../src/public/leadgen/components/presets";
import { FUNNEL_TOKEN_ROLES } from "../src/public/leadgen/designs/theme";
import type { LeadgenComponentNode, LeadgenSectionContent } from "../src/public/leadgen/components/content-schema";

// ---------------------------------------------------------------------------
// §1.2 fixture (studio side — pure, no D1 needed). Same shape as the sibling
// gate files (independently duplicated per repo convention).
// ---------------------------------------------------------------------------

const ZIP_NODE: LeadgenComponentNode = {
  type: "ZIPInputQuestion",
  question_id: "q_zip",
  internal_field: "zip",
  answer_type: "string",
  required: true,
  props: {
    label: "ZIP code",
    placeholder: "Enter your ZIP code",
    helper: "We never share this",
    icon: "location",
    format: "us_zip",
    error_text: "Please enter a valid ZIP code",
  },
};
const FIXTURE_CONTENT: LeadgenSectionContent = {
  components: [
    { type: "QuestionHeadline", question_id: "q_bound_headline", bind: "section_headline" },
    { type: "Subheadline", question_id: "q_bound_subheadline", bind: "section_subheadline" },
    ZIP_NODE,
    { type: "ContinueButton", question_id: "q_cont", props: { label: "View My Quote" } },
  ],
};
const FIXTURE_VIEW: StudioSectionView = {
  public_id: "lgs_zip_fixture",
  section_name: "Zip",
  status: "active",
  activity: "Insurance",
  vertical: "Car",
  headline_text: "What's your ZIP code?",
  subheadline_text: "Rates differ by up to 40% based on ZIP code",
  continue_mode: "button",
  address_validation_enabled: false,
  content: FIXTURE_CONTENT,
};
const FIXTURE_SUMMARY: StudioMappingSummary = {
  publishable: true,
  status: "ok",
  required_missing_total: 0,
  required_mapped_total: 2,
  required_fields_total: 2,
};
const STATUS_PILL_HTML = `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:${STUDIO_COLOR.success};background:${STUDIO_COLOR.successTint};padding:3px 9px;border-radius:20px"><span style="width:6px;height:6px;border-radius:50%;background:${STUDIO_COLOR.success}"></span>Active</span>`;

const STUDIO_HTML = renderSectionStudio(FIXTURE_VIEW, FIXTURE_SUMMARY, STATUS_PILL_HTML, true, 2, false);

/** Assert every string in `strings` appears verbatim (toContain, i.e. as a
 * substring — the same idiom every existing leadgen-*-ui.test.ts uses for
 * tag-split copy, e.g. "...shows as " + a separate check for the "<b>Custom
 * </b>." tail) somewhere in `html`. Reports ALL missing strings in one
 * assertion (not just the first) so a failure is maximally informative. */
function assertAllPresent(html: string, strings: readonly string[], regionLabel: string): void {
  const missing = strings.filter((s) => !html.includes(s));
  expect(missing, `${regionLabel}: missing Appendix-A string(s): ${JSON.stringify(missing)}`).toEqual([]);
}

// ===========================================================================
// Appendix A — Top bar & strip
// ===========================================================================

describe("Gate 2 strings — Top bar & Question strip (Appendix A)", () => {
  it("top bar strings render", () => {
    assertAllPresent(
      STUDIO_HTML,
      ["Section", "Active", "Mapping 2 / 2 complete", "No issues", "Save", "Archive"],
      "top bar",
    );
  });

  it("question strip row 1 strings render", () => {
    assertAllPresent(
      STUDIO_HTML,
      ["The question", "Activity", "Vertical", "On answer", "Wait for Continue", "Go to next", "Google Maps: connected"],
      "question strip row 1",
    );
  });

  it("question strip row 2 strings render", () => {
    assertAllPresent(
      STUDIO_HTML,
      // The em-dash renders as the HTML entity &#8212; (confirmed by direct
      // read of ui-section-studio.ts) — a browser/screen-reader presents
      // this identically to a literal "—"; asserting the entity form is the
      // byte-accurate check against the SSR string.
      ["Question headline", "Subheadline", "optional", "Also shown on the canvas &#8212; edit in either place."],
      "question strip row 2",
    );
  });
});

// ===========================================================================
// Appendix A — Library
// ===========================================================================

describe("Gate 2 strings — Component library (Appendix A)", () => {
  it("library chrome strings render (group header labels)", () => {
    assertAllPresent(
      STUDIO_HTML,
      ["Add to this question", "Search components", "Suggested", "Answer fields", "Content", "Layout"],
      "library chrome",
    );
  });

  it("the 'Answer fields' group subcopy 'how visitors answer' renders on the group header (Appendix A / §5.2, golden :145)", () => {
    // ENFORCES the golden (was an E1 FINDING; FIXED in E2, F3): §5.2's
    // Answer-fields group carries the "how visitors answer" subcopy next to
    // its uppercase label (golden :145 — a right-aligned #BAC2CF span).
    // renderStudioLibrary now emits it for the answer-fields group.
    expect(STUDIO_HTML).toContain("how visitors answer");
    // it belongs to the Answer-fields group specifically — assert it renders
    // right after that group's label, not some other group's.
    expect(STUDIO_HTML).toMatch(/Answer fields<\/span>\s*<span[^>]*>how visitors answer<\/span>/);
  });

  it("all 20 tile labels render", () => {
    assertAllPresent(
      STUDIO_HTML,
      [
        "Short text", "Buttons", "Cards", "Continue", "Yes / No", "Dropdown", "Multi-select", "Number", "Amount",
        "Date", "Slider", "Contact", "Address", "Text", "Image / Logo", "Divider", "Card", "Columns", "Grid", "Spacer",
      ],
      "library tiles",
    );
  });

  it("the Content-group's explanatory callout renders verbatim (Appendix A / golden :220): 'Legal notes, reassurance lines & secure badges are just Text — pick a style in its settings. No separate blocks.'", () => {
    // ENFORCES the golden (was an E1 FINDING; FIXED in E2, F4): the dashed-
    // border callout directly below the Content group's tiles (golden :220).
    // The ampersand renders as the HTML entity &amp; and the em-dash as
    // &#8212; (repo convention — cf. "Size &amp; width", "Also shown on the
    // canvas &#8212;"); the copy is split by a <b>Text</b> span, so the two
    // contiguous text runs (before the &-clause / after the </b>) are the
    // byte-accurate substrings to assert.
    expect(STUDIO_HTML).toContain("Legal notes, reassurance lines &amp; secure badges are just");
    expect(STUDIO_HTML).toContain("pick a style in its settings. No separate blocks.");
  });

  it("the Quote-Builder frame callout renders the Appendix-A verbatim string (§5.2 line 269 / Appendix A line 653), not the pre-fix rephrase", () => {
    // ENFORCES the contract string (was an E1 FINDING; FIXED in E2, F5).
    // Gate 2's own definition (§13) is "assert every Appendix A string
    // renders" — Appendix A (line 653) + §5.2 body (line 269) BOTH read
    // "Header, footer, progress & background belong to the whole funnel —
    // set them once in the Quote Builder. Open →". (Recorded discrepancy:
    // the golden MOCKUP line 253 reads "Header, logo, progress, footer &
    // background ..." — a golden-vs-AppendixA inconsistency; Appendix A is
    // authoritative for string assertions per §13 Gate 2, and gate1-parity
    // does not assert this callout's copy, so converging to Appendix A is
    // correct. See gate-map Findings §5.) &amp;/&#8212;/&#8594; are the
    // repo's entity forms for & / em-dash / →.
    expect(STUDIO_HTML).toContain(
      "Header, footer, progress &amp; background belong to the whole funnel &#8212; set them once in the",
    );
    expect(STUDIO_HTML).toContain("Quote Builder");
    expect(STUDIO_HTML).toContain("Open &#8594;");
    // the pre-fix rephrase is gone
    expect(STUDIO_HTML).not.toContain("Looking for the page header");
  });

  it("the library search placeholder is EXACTLY 'Search components' — no trailing ellipsis (Appendix A / golden :108; E2 F6)", () => {
    // ENFORCES the exact Appendix-A string (was an E1 FINDING #6; FIXED in
    // E2, F6): the placeholder carried a trailing horizontal-ellipsis
    // character ("Search components…") absent from the golden/Appendix A.
    // The aria-label was already exact.
    expect(STUDIO_HTML).toContain('placeholder="Search components"');
    expect(STUDIO_HTML).not.toContain("Search components…"); // U+2026 HORIZONTAL ELLIPSIS
  });
});

// ===========================================================================
// Appendix A — Canvas / toolbar
// ===========================================================================

describe("Gate 2 strings — Canvas / toolbar (Appendix A)", () => {
  it("toolbar + breadcrumb + viewport + frame-hint strings render", () => {
    assertAllPresent(STUDIO_HTML, ["This section", "Desktop", "Mobile", "Frame hint", "Funnel frame"], "canvas toolbar");
  });

  it("frame-hint header/footer copy renders (SSR-visible by default — see Gate 1a finding on the default-ON mechanism)", () => {
    assertAllPresent(
      STUDIO_HTML,
      ["Funnel frame", "Advertising disclosure", "Terms", "Privacy"],
      "frame hint skeleton",
    );
  });

  it("drawer strings render: Mapping, Validation, Preview in a quote, Preview theme:, Expand", () => {
    assertAllPresent(
      STUDIO_HTML,
      ["Mapping", "Validation", "Preview in a quote", "Preview theme:", "Expand"],
      "bottom drawer",
    );
  });

  it("breadcrumb selection-name strings ('Short text', 'Question', 'Continue') are the client-populated breadcrumb's vocabulary — asserted at the SOURCE that drives it (SECTION_STUDIO_SCRIPT), since the SSR breadcrumb region ships empty (populated on selection)", () => {
    expect(SECTION_STUDIO_SCRIPT).toContain("Short text");
    expect(SECTION_STUDIO_SCRIPT).toContain("Continue");
  });
});

// ===========================================================================
// Appendix A — Inspector (static shell strings; per-selection dynamic values
// covered by the existing leadgen-section-studio-ui.test.ts vm-probe suite —
// referenced in leadgen-v31-gate-map.md, not duplicated here)
// ===========================================================================

describe("Gate 2 strings — Inspector (Appendix A)", () => {
  it("scope header eyebrow + pills render", () => {
    assertAllPresent(STUDIO_HTML, ["Editing", "Funnel frame", "This section", "This element"], "scope header");
  });

  it("the 5 tab labels render", () => {
    assertAllPresent(STUDIO_HTML, ["Content", "Style", "Rules", "Maps", "Offers"], "inspector tabs");
  });

  it("field Content-tab (Basics/Behavior/Answer-format/Connect-to-Offers) strings render", () => {
    assertAllPresent(
      STUDIO_HTML,
      [
        "Basics", "Field label", "only you see this", "Placeholder", "Helper text", "Leading icon", "Location pin",
        "Behavior", "Required", "Visitors must answer before they can continue.", "When answered", "Answer format",
        "Accept", "ZIP code (5 digits)", "If it&#8217;s wrong, say", // curly apostrophe entity (contract: "Curly apostrophes as shown")
      ],
      "field Content tab",
    );
    // "This answer fills Zip on all 2 Offers." + "Review mapping →" render
    // ONLY once GET /sections/:id/offers resolves client-side
    // (data-connect-offers-text ships EMPTY server-side, confirmed by direct
    // read) — proven by leadgen-section-studio-ui.test.ts's "§8.7 mapping
    // model E2" / "12 §12.1 panel decode" describes (mappingProbe helper).
    expect(STUDIO_HTML).toContain("Review mapping");
  });

  it("Style-tab strings render (Width/Height/Corners/Border color + theme note)", () => {
    assertAllPresent(
      STUDIO_HTML,
      [
        "Size &amp; width", "from theme: Navy", "Width", "Height", "Set by dragging on the canvas — overrides the preset",
        "Reset", "Presets keep every question in the funnel consistent.", "it becomes", "Custom", "and overrides the preset here.",
        "Appearance", "Corners", "Sharp", "Rounded", "Pill", "Border color", "Neutral", "Brand", "Accent",
        "Colors are theme roles, not fixed shades", "Manage theme",
      ],
      "Style tab",
    );
    // "Custom · ≈ 384 px" is the golden's FAKE demo value (§0 fidelity-vs-
    // function) — the built Style tab's Custom chip ships hidden/empty until
    // a REAL custom_px exists (data-width-custom-label, populated client-
    // side); asserting the literal "384" would assert a fake number, which
    // §0 explicitly forbids. The FORMAT ("≈ {n} px") is proven live-computed
    // by the existing Playwright drag-handle test (§7.1.3, referenced in
    // leadgen-v31-gate-map.md), never hardcoded here.
  });

  it("Rules-tab strings render", () => {
    assertAllPresent(STUDIO_HTML, ["When to show this", "Always show", "Add a condition"], "Rules tab");
    // "Show this when Currently insured is Yes" is a WORKED EXAMPLE the
    // golden hardcodes for illustration (contract's own Appendix A groups it
    // under "Rules & Offers tabs (added in v3.1)") — the real Rules tab's
    // condition sentence is LIVE-COMPUTED from whatever fields exist
    // (studio-cond-sentence, data-cond-sentence, populated by
    // collectRequiredWhen-adjacent island logic per §6.10) — proven by
    // leadgen-section-studio-ui.test.ts's "v3.1 §6.10 conditional builder"
    // describe, not re-asserted here as a literal.
  });

  it("Maps-tab strings render verbatim", () => {
    assertAllPresent(
      STUDIO_HTML,
      [
        "Google Maps", "Validate with Google Maps", "Uses this site&#8217;s Maps key. Per-field settings win over the funnel&#8217;s global toggle.",
        "What should Maps do?", "pick at least one", "Validate the answer", "Use in auction rules", "Auto-complete the address",
        "Pick at least one job for Maps, or turn it off — otherwise it does nothing at runtime.",
      ],
      "Maps tab",
    );
  });

  it("Advanced-disclosure labels render (values populated client-side — proven by leadgen-section-studio-ui.test.ts)", () => {
    assertAllPresent(STUDIO_HTML, ["Advanced", "Internal field", "Analytics label", "Component id"], "Advanced disclosure");
  });

  it("Continue's inherited tags render verbatim (Appendix C row 13 — §8.4/§8.5 'Inherited from the frame'): Position=Inside the question, tagged 'inherited'", () => {
    // R3b conductor erratum (S2-2 reclassified, deliverable 1): the golden
    // demo's "Bottom, full width" was ITS OWN demo funnel's placement value,
    // never a resolved fact this Studio could assert for every Section — the
    // binding contract is now "the REAL resolved value" (frames.ts's own
    // section_slot.continue_placement default, "inside_unit", surfaced
    // honestly instead of a fabricated string; register S2-2). The
    // Content-tab's OWN duplicate "Inherited from the frame" rows were also
    // REMOVED as part of the same fix (dead duplication of stale text) — only
    // the Style-tab's block carries this group now, so this is no longer a
    // "appears twice" pin, just the one live copy.
    assertAllPresent(
      STUDIO_HTML,
      ["Inherited from the frame", "Inside the question", ">inherited<"],
      "Continue inherited tags",
    );
  });
});

// ===========================================================================
// Appendix A — Rules & Offers tabs additions + forbidden-vocabulary
// consolidation pointer
// ===========================================================================

describe("Gate 2 strings — glossary-lint consolidation pointer", () => {
  it("this suite defers the forbidden-vocabulary NEGATIVE half (raw type names / column names / token keys / hex / id prefixes / 'JSON' / 'slide') for the STUDIO + QUOTES surfaces to the existing, passing leadgen-glossary-lint.test.ts + leadgen-hex-lint.test.ts — not re-implemented here", () => {
    // Calibration only, narrowly scoped to avoid false positives from
    // legitimately-exempt surfaces this file does NOT attempt to replicate
    // glossary-lint's nuanced stripping/exemption logic for (confirmed by
    // direct grep: "JSON" legitimately appears in the per-selection Advanced
    // disclosure — contract-allowed — AND in the drawer's "Sample answers
    // (JSON, keyed by internal field)" developer label, which glossary-lint's
    // OWN corpus already includes and already passes against — so a naive
    // blanket /\bJSON\b/ check here would produce a FALSE positive, not a
    // real new finding). The fixture's own internal identifiers, which have
    // no such exemption ambiguity, ARE a valid narrow spot-check:
    expect(STUDIO_HTML).not.toContain(">zip<"); // internal_field, Advanced-only
    expect(STUDIO_HTML).not.toContain(">q_zip<"); // question_key, Advanced-only
  });
});

// ---------------------------------------------------------------------------
// Themes-manager harness (D1 + KV — duplicated per repo convention).
// ---------------------------------------------------------------------------

type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    const nodeRequire = createRequire(import.meta.url);
    return (nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
    try {
      const getBuiltin = (process as unknown as { getBuiltinModule?: (n: string) => unknown }).getBuiltinModule;
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
  return {
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
          const r = sdb.prepare(sql).run(...binds) as { changes?: number; lastInsertRowid?: number | bigint };
          return {
            success: true,
            meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) },
          };
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      const out: unknown[] = [];
      try {
        for (const s of statements) out.push(await s.run());
        runSql(sdb, "COMMIT");
      } catch (err) {
        runSql(sdb, "ROLLBACK");
        throw err;
      }
      return out;
    },
  } as unknown as D1Database;
}

function makeKvStub(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string): Promise<string | null> {
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key: string, value: string): Promise<void> {
      store.set(key, value);
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    async list(): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor: string }> {
      return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
  "0040_leadgen_runtime_context.sql",
  "0041_leadgen_frame_theme.sql",
] as const;

function createDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
  );
  for (const file of LEADGEN_MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  return sdb;
}

function buildEnv(db: D1Database, kv: KVNamespace): Env {
  return {
    DB: db,
    CACHE: kv,
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
  } as unknown as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function newHarness(): { sdb: SqliteDb; env: Env } {
  const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb), makeKvStub()) };
}

const API = "/api/admin/leadgen";

function jsonInit(method: string, body?: unknown): RequestInit {
  return body === undefined
    ? { method }
    : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function jsonRes<T>(res: Response, label: string): Promise<T> {
  const body = (await res.json()) as T;
  expect(res.status, `${label}: ${JSON.stringify(body)}`).toBeLessThan(300);
  return body;
}

function themeBody(
  name: string,
  brand: string,
  accent: string,
  pageBg: string,
  card: string,
  text: string,
): Record<string, unknown> {
  return {
    name,
    roles: { brand_primary: brand, accent, page_bg: pageBg, card, text, success: "#0E7C3A", error: "#B23A2C" },
    typography: { headline_font: "Newsreader", body_font: "Inter", base_px: 16 },
    controls: { field_height: "medium", button_size: "m", corners: "rounded" },
  };
}

async function seedThemesFixture(env: Env): Promise<{ navy: ThemeRecord; bold: ThemeRecord; minimal: ThemeRecord }> {
  const navy = (
    await jsonRes<{ item: ThemeRecord }>(
      await admin.request(
        `${API}/themes`,
        jsonInit("POST", themeBody("Navy", "#1B3A5C", "#F5C518", "#F4F6F9", "#FFFFFF", "#1A1F36")),
        env,
      ),
      "create navy",
    )
  ).item;
  const bold = (
    await jsonRes<{ item: ThemeRecord }>(
      await admin.request(
        `${API}/themes`,
        jsonInit("POST", themeBody("Bold Yellow", "#13233B", "#F5C518", "#FFF7DE", "#FFFFFF", "#14181F")),
        env,
      ),
      "create bold",
    )
  ).item;
  const minimal = (
    await jsonRes<{ item: ThemeRecord }>(
      await admin.request(
        `${API}/themes`,
        jsonInit("POST", themeBody("Minimal", "#232A34", "#6B7486", "#FFFFFF", "#F6F8FA", "#14181F")),
        env,
      ),
      "create minimal",
    )
  ).item;

  const quote = await jsonRes<{
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  }>(
    await admin.request(
      `${API}/quotes`,
      jsonInit("POST", {
        quote_name: "Gate2 Strings Fixture",
        activity: "quote_funnel",
        verticals: ["auto"],
        funnel_name: "Auto Insurance",
      }),
      env,
    ),
    "create quote",
  );
  const autoFunnelId = quote.funnels[0]!.public_id;
  const variantAId = quote.funnels[0]!.variants[0]!.public_id;
  const variantB = await jsonRes<{ public_id: string }>(
    await admin.request(`${API}/funnels/${autoFunnelId}/variants`, jsonInit("POST", {}), env),
    "create variant B",
  );
  await jsonRes(
    await admin.request(`${API}/funnels/${autoFunnelId}/theme`, jsonInit("PUT", { theme_json: { theme_id: navy.id } }), env),
    "set funnel theme",
  );
  await jsonRes(
    await admin.request(`${API}/variants/${variantAId}`, jsonInit("PUT", { traffic_allocation_bp: 6000 }), env),
    "set variant A split",
  );
  await jsonRes(
    await admin.request(
      `${API}/variants/${variantB.public_id}`,
      jsonInit("PUT", { traffic_allocation_bp: 4000, frame_overrides_json: { theme_id: bold.id } }),
      env,
    ),
    "set variant B split+theme",
  );
  return { navy, bold, minimal };
}

async function getHtml(env: Env, path: string): Promise<{ status: number; html: string }> {
  const res = await admin.request(path, {}, env);
  return { status: res.status, html: await res.text() };
}

/** Depth-balanced extraction of a `<div ...>` region (duplicated from
 * leadgen-v31-gate1-tokens.test.ts per the repo's per-file convention —
 * needed here to scope the themes-manager forbidden-vocabulary sweep to
 * ITS OWN content, excluding the generic adminLayout page shell every
 * /admin/* page shares). */
function extractBalancedDivRegion(html: string, startMarker: string): string {
  const start = html.indexOf(startMarker);
  if (start === -1) throw new Error(`extractBalancedDivRegion: marker not found: ${JSON.stringify(startMarker)}`);
  const tags = [...html.matchAll(/<(\/?)div\b[^>]*>/g)].filter((m) => (m.index ?? -1) >= start);
  let depth = 0;
  for (const tag of tags) {
    depth += tag[1] === "" ? 1 : -1;
    if (depth === 0) return html.slice(start, (tag.index ?? 0) + tag[0].length);
  }
  throw new Error("extractBalancedDivRegion: unbalanced <div> tags — no matching close found");
}

/** Strip the Advanced disclosure sub-region (`id="tm-adv-body"`) — contract:
 * forbidden vocabulary is allowed "only under Advanced / theme Advanced".
 * Mirrors leadgen-glossary-lint.test.ts's own stripAdvanced() concept,
 * scoped to the themes manager's specific Advanced marker. */
function stripThemesAdvanced(tmShellHtml: string): string {
  const advanced = extractBalancedDivRegion(tmShellHtml, '<div id="tm-adv-body"');
  return tmShellHtml.replace(advanced, "");
}

// ===========================================================================
// Appendix A — Themes manager (+ remainder)
// ===========================================================================

describeDb("Gate 2 strings — Themes manager (Appendix A, D1+KV)", () => {
  it("top bar + shell strings render verbatim", async () => {
    const { env } = newHarness();
    await seedThemesFixture(env);
    const { html } = await getHtml(env, "/admin/leadgen/themes");
    assertAllPresent(
      html,
      ["Back to section", "Themes", "one look &amp; feel per funnel · A/B-testable in a quote", "New theme", "Your themes"],
      "themes top bar",
    );
    assertAllPresent(html, ["LIVE · A", "A/B · B"], "themes badges (fixture-dependent)");
  });

  it("CENTER editor strings render verbatim", async () => {
    const { env } = newHarness();
    await seedThemesFixture(env);
    const { html } = await getHtml(env, "/admin/leadgen/themes");
    assertAllPresent(
      html,
      [
        "Colors — semantic roles", "Brand primary", "Accent", "Page background", "Card", "Text", "Success",
        "Typography", "Headline font", "Body font",
        "Buttons &amp; inputs — the shared size language", "Field height", "Button size", "Corners",
        "Every question inherits these. A section can override a single field on its canvas — that field then shows as",
        "Advanced — exact hex &amp; tokens",
      ],
      "themes CENTER editor",
    );
    // role sublabels (Appendix A remainder)
    assertAllPresent(
      html,
      [
        "buttons · progress · selected", "highlights · recommended", "behind the card", "question surface",
        "headings &amp; body", "reassurance · valid",
        "Components reference these roles, never fixed shades — change one here and every question in the funnel reskins.",
      ],
      "themes role sublabels + note",
    );
  });

  it("RIGHT A/B panel strings render verbatim (Navy selected — has an A/B box + cross-funnel reference)", async () => {
    const { env } = newHarness();
    await seedThemesFixture(env);
    const { html } = await getHtml(env, "/admin/leadgen/themes");
    assertAllPresent(
      html,
      [
        "In this quote", "Auto Insurance", "A/B test · Theme", "Variant A", "Variant B",
        "Both variants share the same questions — only the theme differs. Promote the winner to 100% from the quote's",
        "Other funnels using this theme",
      ],
      "themes A/B panel",
    );
    // "IN THIS QUOTE" (all-caps, contract's literal spelling) is a
    // text-transform:uppercase CSS effect over the real source string "In
    // this quote" (confirmed by direct read of ui-theme-manager.ts:546) —
    // the byte-level source string is asserted above, not the CSS-rendered
    // all-caps form (a raw-HTML/regex suite cannot see computed CSS text-
    // transform; this matches the SAME documented caveat the existing
    // leadgen-theme-manager-ui.test.ts records for this exact string).
  });

  it("60% / 40% fixture-value split renders (contract §10.5: 'fixture data, not hardcodes')", async () => {
    const { env } = newHarness();
    await seedThemesFixture(env);
    const { html } = await getHtml(env, "/admin/leadgen/themes");
    expect(html).toContain("60%");
    expect(html).toContain("40%");
  });

  it("selecting Navy shows 'Home Insurance · Variant A' is NOT asserted here (out of THIS fixture's scope — proven by leadgen-theme-manager-ui.test.ts's own 2-funnel fixture); 'No others yet.' renders for a theme with no cross-funnel usage", async () => {
    const { env } = newHarness();
    const fx = await seedThemesFixture(env);
    const { html } = await getHtml(env, `/admin/leadgen/themes?theme=${fx.minimal.id}`);
    expect(html).toContain("Not assigned to a funnel yet");
    expect(html).toContain("No others yet.");
  });
});

// ===========================================================================
// Gate 2 — forbidden vocabulary on the Themes manager (the confirmed gap in
// the existing leadgen-glossary-lint.test.ts corpus — it never visits
// /admin/leadgen/themes). Derived matrices (not hand-maintained), matching
// glossary-lint's own established pattern.
// ===========================================================================

describeDb("Gate 2 strings — forbidden vocabulary on Themes manager (extends leadgen-glossary-lint.test.ts)", () => {
  // Every check below scopes to `.tm-shell` (the theme-manager's OWN
  // content — excludes the generic adminLayout page shell every /admin/*
  // page shares, matching Gate 1b's identical scoping decision) with the
  // Advanced disclosure stripped (contract: forbidden vocabulary is allowed
  // "only under Advanced / theme Advanced" — the 7 role-key data-role
  // attributes there are BY DESIGN, not a leak).
  async function normalSurfaceHtml(env: Env, path: string): Promise<string> {
    const { html } = await getHtml(env, path);
    return stripThemesAdvanced(extractBalancedDivRegion(html, '<div class="tm-shell">'));
  }

  it("no raw ComponentType identifier (COMPONENT_CATALOG key) appears on the themes normal surface", async () => {
    const { env } = newHarness();
    await seedThemesFixture(env);
    const normal = await normalSurfaceHtml(env, "/admin/leadgen/themes");
    const leaked = Object.keys(COMPONENT_CATALOG).filter((type) => normal.includes(`>${type}<`));
    expect(leaked, `raw type identifier(s) leaked: ${leaked.join(", ")}`).toEqual([]);
  });

  it("no FUNNEL_TOKEN_ROLES key (the 14-role admin vocabulary, e.g. 'brand_primary') appears as VISIBLE text outside Advanced", async () => {
    const { env } = newHarness();
    await seedThemesFixture(env);
    const normal = await normalSurfaceHtml(env, "/admin/leadgen/themes");
    const leaked = FUNNEL_TOKEN_ROLES.filter((role) => normal.includes(`>${role}<`));
    expect(leaked, `raw role key(s) leaked as visible text outside Advanced: ${leaked.join(", ")}`).toEqual([]);
  });

  it("the word 'JSON' never appears on the themes normal surface (Advanced excluded — contract's own allowlist)", async () => {
    const { env } = newHarness();
    await seedThemesFixture(env);
    const normal = await normalSurfaceHtml(env, "/admin/leadgen/themes");
    expect(normal).not.toMatch(/\bJSON\b/);
  });

  it("the word 'slide' never appears on the themes normal surface (C6: banned Section-Builder synonym)", async () => {
    const { env } = newHarness();
    await seedThemesFixture(env);
    const normal = await normalSurfaceHtml(env, "/admin/leadgen/themes");
    expect(normal).not.toMatch(/\bslide\b/i);
  });

  it("public-id prefixes (lgs_/lgn_/lgq_/lgf_/lgo_/thm_) never appear in normal-mode visible text (outside Advanced)", async () => {
    const { env } = newHarness();
    const fx = await seedThemesFixture(env);
    const normal = await normalSurfaceHtml(env, `/admin/leadgen/themes?theme=${fx.navy.id}`);
    // the ?theme=thm_xxx QUERY STRING itself legitimately carries the
    // prefix (a URL, not operator-facing copy) — scoped out by only
    // scanning text between '>' and '<' (a visible text-node heuristic).
    const textNodes = [...normal.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]!);
    const leaked = textNodes.filter((t) => /\b(lgs|lgn|lgq|lgf|lgo|thm)_/.test(t));
    expect(leaked, `id-prefixed value(s) leaked into visible text: ${JSON.stringify(leaked)}`).toEqual([]);
  });

  it("calibration — stripping Advanced actually removed the 7 role-key data-role hooks (else the checks above would trivially pass on an already-empty page)", async () => {
    const { env } = newHarness();
    await seedThemesFixture(env);
    const { html } = await getHtml(env, "/admin/leadgen/themes");
    const tmShell = extractBalancedDivRegion(html, '<div class="tm-shell">');
    const stripped = stripThemesAdvanced(tmShell);
    expect(tmShell).toContain('data-role="brand_primary"');
    expect(stripped).not.toContain('data-role="brand_primary"');
    expect(stripped.length).toBeLessThan(tmShell.length);
  });
});

// ===========================================================================
// Gate 2 strings — audit-round G (final 3-auditor FIX-FIRST):
//  FIX 3 — the Appendix-A "Canvas funnel preview" strings render through the
//    REAL shared preview renderer (renderSectionComponents — the SAME function
//    the runtime + studio canvas + section preview all call), including the
//    §8.1 helper line ("We never share this") and the leading pin, which the
//    pre-fix renderTextInput never emitted on ANY path.
//  FIX 2 — the THREE §7.3 affects sentences (Appendix A, golden :422-424)
//    render for their selections, byte-for-byte, with the #5C5015 bold color.
// ===========================================================================
const PREVIEW_DESIGN = getFunnelDesign(null);
const PREVIEW_NODES: LeadgenComponentNode[] = [
  { type: "QuestionHeadline", question_id: "q_h", bind: "section_headline" },
  { type: "Subheadline", question_id: "q_s", bind: "section_subheadline" },
  {
    type: "ZIPInputQuestion",
    question_id: "q_zip",
    internal_field: "zip",
    answer_type: "string",
    required: true,
    props: { label: "ZIP code", placeholder: "Enter your ZIP code", helper: "We never share this", icon: "location", format: "us_zip" },
  },
  { type: "ContinueButton", question_id: "q_cont", props: { label: "View My Quote" } },
];
const PREVIEW_CTX: LeadgenSectionRenderCtx = {
  headline_text: "What's your ZIP code?",
  subheadline_text: "Rates differ by up to 40% based on ZIP code",
};
const PREVIEW_HTML = renderSectionComponents(PREVIEW_NODES, PREVIEW_DESIGN, PREVIEW_CTX);

describe("Gate 2 strings — audit-round G FIX 3: Canvas funnel preview (REAL shared renderer)", () => {
  it("all 5 Appendix-A canvas-preview strings render through renderSectionComponents", () => {
    for (const s of [
      "We never share this", // §8.1 helper — the pre-fix bug: never rendered on ANY path
      "Enter your ZIP code", // field placeholder
      "What&#39;s your ZIP code?", // bound headline (ctx) — apostrophe SSR-escaped by esc()
      "Rates differ by up to 40% based on ZIP code", // bound subheadline (ctx)
      "View My Quote", // continue label
    ]) {
      expect(PREVIEW_HTML, `canvas preview must render: ${s}`).toContain(s);
    }
  });
  it("the §8.1 leading pin (Location) renders verbatim inside the field box (golden :323)", () => {
    expect(PREVIEW_HTML).toContain(
      '<path d="M12 21s7-6.6 7-12a7 7 0 10-14 0c0 5.4 7 12 7 12z" stroke="#8DA0B6" stroke-width="1.8"/>',
    );
    expect(PREVIEW_HTML).toContain('<circle cx="12" cy="9" r="2.4" stroke="#8DA0B6" stroke-width="1.8"/>');
    // the helper line carries the golden :326 style + text.
    expect(PREVIEW_HTML).toContain(
      '<div class="lg-field-help" style="font-size:12.5px;color:#96A0AF;margin-top:7px;padding-left:2px">We never share this</div>',
    );
  });
});

describe("Gate 2 strings — audit-round G FIX 2: the 3 §7.3 affects sentences (golden :422-424)", () => {
  it("all three verbatim sentence parts + the #5C5015 bold color ship in the island", () => {
    // field selection (Short text field family)
    expect(SECTION_STUDIO_SCRIPT).toContain("Changes here affect ");
    expect(SECTION_STUDIO_SCRIPT).toContain("this question only");
    expect(SECTION_STUDIO_SCRIPT).toContain(", everywhere this section is reused.");
    // bound headline selection
    expect(SECTION_STUDIO_SCRIPT).toContain("This is the same text as the ");
    expect(SECTION_STUDIO_SCRIPT).toContain(" box up top \\u2014 editing either updates both.");
    // continue selection (bare ampersand, byte-for-byte with the golden)
    expect(SECTION_STUDIO_SCRIPT).toContain("Color, size & position come from the ");
    expect(SECTION_STUDIO_SCRIPT).toContain(". Here you can override just the label.");
    // the bold segments and their #5C5015 color
    expect(SECTION_STUDIO_SCRIPT).toContain("'Question headline'");
    expect(SECTION_STUDIO_SCRIPT).toContain("'funnel frame'");
    expect(SECTION_STUDIO_SCRIPT).toContain("#5C5015");
  });
});
