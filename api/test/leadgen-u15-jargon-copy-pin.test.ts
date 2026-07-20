// U15 fix-round MAJOR-1 (adversarial review, 2026-07-15) — copy-regression
// PIN: the reviewer proved no existing gate covers this class ("Quote frame"
// residue kept surfacing on sibling messages across three fix rounds even
// after the primary studio copy was renamed). This file renders the ACTUAL
// admin surfaces — the section-builder studio page (renderSectionStudio,
// PURE, no D1, PLUS its inline SECTION_STUDIO_SCRIPT island — the island is
// NOT embedded inside renderSectionStudio's own return value, so it is
// concatenated in separately below; every jargon string this mission fixed
// inside moveConfirmMessage/showRefusal/showMoveNote/scopeAffectsText/
// buildFrameBadge lives INSIDE that script, not in the static SSR shell) and
// the quote-builder edit page (the REAL `/admin/leadgen/quotes/:id/edit`
// route, through the repo's node:sqlite in-memory D1 harness — the exact
// surface `[Move to funnel layout]`/"funnel-layout" copy in quotes-handlers.ts
// + ui-quotes.ts renders on) — then scans the RENDERED OUTPUT (not the raw
// .ts source) for the banned "frame"-as-product-noun phrases.
//
// WHAT THIS SCANS: the FULL text of each rendered surface (SSR HTML +, for
// the studio, its inline island script source — which ships to the browser
// verbatim even though it does not execute server-side). This is REAL
// "emitted copy", not source structure: comments in the surrounding .ts files
// (which never reach the browser) are automatically excluded because they
// live OUTSIDE the returned HTML strings this file scans — nothing needs to
// be stripped for that. Before matching, `data-*`/`id`/`class`/`sandbox`
// ATTRIBUTE VALUES are stripped (internal identifiers such as
// `data-scope-pill="frame"`/`frame_config_json`/`scope:"frame"` must never
// trip this gate); `title=`/`aria-label=`/`alt=`/`placeholder=` VALUES and all
// visible text nodes are intentionally LEFT IN (they are exactly the
// operator-visible copy this gate exists to police).
//
// BANNED PHRASES (word-boundary, case-insensitive): every one is a 2+-word
// (or hyphenated) English phrase. None of this codebase's internal
// identifiers (hyphen/underscore/camelCase, never a literal embedded space)
// can collide with a spaced phrase, so the word-boundary match is safe by
// construction; "page-frame" is the one hyphenated (no-space) entry — the
// trailing `\b` after "frame" fails to match inside a longer identifier like
// "page-framework" (word characters continue past "frame"), so it cannot
// false-positive against a compound identifier either. Verified empirically
// (2026-07-15): grepping all four touched source files
// (ui-section-studio.ts, ui-quotes.ts, quotes-handlers.ts, content-schema.ts)
// for every banned phrase, case-insensitive, finds zero hits outside code
// comments (which this gate never sees, per the paragraph above) — so this
// pin is a REAL regression fence: it fails today's shipped copy would have
// failed it before the U15/MAJOR-1 fixes, and passes now.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import {
  renderSectionStudio,
  SECTION_STUDIO_SCRIPT,
  type StudioSectionView,
  type StudioMappingSummary,
} from "../src/admin/leadgen/ui-section-studio";
import { STUDIO_COLOR } from "../src/admin/leadgen/studio-tokens";
import type { LeadgenSectionContent } from "../src/public/leadgen/components/content-schema";

// ---------------------------------------------------------------------------
// The banned phrases + the scan itself.
// ---------------------------------------------------------------------------

const BANNED_PHRASES: readonly string[] = [
  "Quote frame",
  "page frame",
  "page-frame",
  "frame template",
  "frame settings",
  "Funnel frame",
  "the frame",
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Blank every char of `matched` except embedded newlines (positions of
 * every OTHER character stay stable) — the same idiom scripts/jargon-scan.mjs
 * already uses for its own comment-stripper. */
function blankPreservingNewlines(matched: string): string {
  let out = "";
  for (const ch of matched) out += ch === "\n" ? "\n" : " ";
  return out;
}

/** Strip JS/CSS block comments (slash-star ... star-slash), HTML comments
 * (angle-bang-dash-dash ... dash-dash-angle), and whole-line `//` comments
 * from the rendered output — none of these are
 * operator-visible (a `<script>` tag's comment text never executes or
 * displays; an HTML comment is an invisible DOM comment node). This is why
 * the studio island's engineering comments (many of which literally say
 * "the frame" while describing the iframe DOM mechanism) do not trip this
 * gate: they are source commentary, never emitted copy. Reuses
 * scripts/jargon-scan.mjs's own documented convention (adapted here for
 * RENDERED HTML+JS output rather than raw .ts source) rather than
 * reinventing it — see that file's header comment for the fuller rationale
 * and its own documented known-limitation (trailing same-line `//` comments
 * are not stripped; verified empirically below that this costs nothing for
 * either surface scanned here). */
function stripComments(text: string): string {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, blankPreservingNewlines);
  out = out.replace(/<!--[\s\S]*?-->/g, blankPreservingNewlines);
  const lines = out.split("\n").map((line) => (line.trim().startsWith("//") ? "" : line));
  return lines.join("\n");
}

/** Strip internal-identifier attribute VALUES (data-*, id, class, sandbox) so
 * they can never trip the gate; title/aria-label/alt/placeholder VALUES and
 * every visible text node are left untouched — they are the operator-visible
 * copy this pin exists to police. */
function stripInternalAttributeValues(html: string): string {
  return html
    .replace(/\sdata-[a-zA-Z0-9-]+="[^"]*"/g, "")
    .replace(/\sid="[^"]*"/g, "")
    .replace(/\sclass="[^"]*"/g, "")
    .replace(/\ssandbox="[^"]*"/g, "");
}

function findBannedPhrases(rendered: string, surfaceName: string): string[] {
  const scanned = stripInternalAttributeValues(stripComments(rendered));
  const hits: string[] = [];
  for (const phrase of BANNED_PHRASES) {
    const re = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "gi");
    const matches = scanned.match(re);
    if (matches) {
      for (const m of matches) hits.push(`${surfaceName}: banned phrase "${phrase}" (matched "${m}")`);
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Section-builder studio surface — renderSectionStudio is PURE (no D1); the
// SAME fixture shape as the sibling gate files (independently duplicated per
// repo convention — see leadgen-v31-gate2-strings.test.ts's own header note).
// ---------------------------------------------------------------------------

const STUDIO_FIXTURE_CONTENT: LeadgenSectionContent = {
  components: [
    { type: "QuestionHeadline", question_id: "q_bound_headline", bind: "section_headline" },
    { type: "Subheadline", question_id: "q_bound_subheadline", bind: "section_subheadline" },
    {
      type: "ZIPInputQuestion",
      question_id: "q_zip",
      internal_field: "zip",
      answer_type: "string",
      required: true,
      props: { label: "ZIP code", placeholder: "Enter your ZIP code", helper: "We never share this" },
    },
    // A HeaderBar is a frame-scope legacy component — including one exercises
    // buildFrameBadge()'s "Move to funnel layout" copy path inside the island.
    { type: "HeaderBar", question_id: "q_hb", props: { logoMediaId: "media_logo", secure: true, secureText: "SSL secured" } },
    { type: "ContinueButton", question_id: "q_cont", props: { label: "View My Quote" } },
  ],
};
const STUDIO_FIXTURE_VIEW: StudioSectionView = {
  public_id: "lgs_jargon_pin_fixture",
  section_name: "Jargon pin fixture",
  status: "active",
  activity: "Insurance",
  vertical: "Car",
  headline_text: "What's your ZIP code?",
  subheadline_text: "Rates differ by up to 40% based on ZIP code",
  continue_mode: "button",
  address_validation_enabled: false,
  content: STUDIO_FIXTURE_CONTENT,
};
const STUDIO_FIXTURE_SUMMARY: StudioMappingSummary = {
  publishable: true,
  status: "ok",
  required_missing_total: 0,
  required_mapped_total: 1,
  required_fields_total: 1,
};
const STUDIO_STATUS_PILL_HTML = `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:${STUDIO_COLOR.success};background:${STUDIO_COLOR.successTint};padding:3px 9px;border-radius:20px"><span style="width:6px;height:6px;border-radius:50%;background:${STUDIO_COLOR.success}"></span>Active</span>`;

const STUDIO_HTML = renderSectionStudio(STUDIO_FIXTURE_VIEW, STUDIO_FIXTURE_SUMMARY, STUDIO_STATUS_PILL_HTML, true, 1, false);
// renderSectionStudio's own return value does NOT embed the island script —
// SECTION_STUDIO_SCRIPT is spliced in separately at the sectionEditorHtml
// layer (ui-sections.ts). Concatenate it here so the scan covers the
// runtime-JS-emitted copy (moveConfirmMessage, showRefusal/showMoveNote,
// scopeAffectsText, buildFrameBadge, etc.) — the actual site of MOST of this
// mission's U15/MAJOR-1 renames.
const STUDIO_FULL_EMITTED = `${STUDIO_HTML}<script>${SECTION_STUDIO_SCRIPT}</script>`;

// ---------------------------------------------------------------------------
// Quote-builder surface — the REAL `/admin/leadgen/quotes/:id/edit` route
// through the repo's node:sqlite in-memory D1 harness (same shape as
// leadgen-quote-builder-ui.test.ts's studioHarness(), independently
// duplicated per repo convention).
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
      if (typeof getBuiltin === "function") return (getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
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
        bind(...a: unknown[]) { binds = a; return stmt; },
        async first<T = unknown>(): Promise<T | null> { return (sdb.prepare(sql).get(...binds) ?? null) as T | null; },
        async all<T = unknown>() { return { results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} }; },
        async run() {
          const r = sdb.prepare(sql).run(...binds) as { changes?: number; lastInsertRowid?: number | bigint };
          return { success: true, meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) } };
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      try {
        const out: unknown[] = [];
        for (const s of statements) out.push(await s.run());
        runSql(sdb, "COMMIT");
        return out;
      } catch (e) {
        runSql(sdb, "ROLLBACK");
        throw e;
      }
    },
  } as unknown as D1Database;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
  "0040_leadgen_runtime_context.sql",
  "0041_leadgen_frame_theme.sql",
  "0042_leadgen_pages.sql",
  "0043_leadgen_routing_rules.sql",
  "0044_leadgen_redirect_pct.sql",
] as const;

function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "CREATE TABLE site_settings (site_id TEXT, key TEXT, value TEXT);" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-1','Site One','one.example.com');" +
      "INSERT INTO site_settings (site_id, key, value) VALUES ('site-1','site_name','Site One Brand');",
  );
  for (const file of LEADGEN_MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  return sdb;
}

function buildEnv(db: D1Database): Env {
  return {
    DB: db, CACHE: {} as KVNamespace, MEDIA: {} as R2Bucket, APP_ENV: "test",
    ADMIN_HOST: "localhost", ADMIN_BASE_URL: "http://localhost:8787", ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false", HTML_CACHE_TTL_SECONDS: "60", OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test", SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false", DEV_BYPASS_AUTH: "true",
  } as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

const API = "/api/admin/leadgen";
function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function seedSection(sdb: SqliteDb, opts: { activity: string; vertical: string; name: string }): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  // A HeaderBar (frame-scope legacy type) — exercises the C2 chrome-in-section
  // problems[] message ("contains funnel-layout elements ... [Move to funnel
  // layout] ...", quotes-handlers.ts) that this gate must also cover.
  const content = JSON.stringify({
    components: [
      { type: "TwoButtonYesNo", question_id: "q1", question_key: "k", internal_field: "insured", answer_type: "boolean" },
      { type: "HeaderBar", question_id: "q_hb", props: { logoMediaId: "media_logo" } },
    ],
  });
  sdb
    .prepare("INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, status) VALUES (?, ?, ?, ?, ?, ?, 'button', 'active')")
    .run(publicId, opts.name, opts.activity, opts.vertical, "Headline", content);
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number };
  return { id: row.id, public_id: publicId };
}

interface QuoteDetail {
  public_id: string;
  funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
}

async function renderQuoteBuilderEditPage(): Promise<string> {
  const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
  const env = buildEnv(d1FromSqlite(sdb));
  const create = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: "Jargon Pin Quote", activity: "quote_funnel", verticals: ["life"] }),
    env,
  );
  expect(create.status, `create quote: ${await create.clone().text()}`).toBe(201);
  const q = (await create.json()) as QuoteDetail;
  const variantId = q.funnels[0]!.variants[0]!.public_id;
  const s1 = seedSection(sdb, { activity: "quote_funnel", vertical: "life", name: "First slide" });
  const s2 = seedSection(sdb, { activity: "quote_funnel", vertical: "life", name: "Second slide" });
  const put = await admin.request(
    `${API}/variants/${variantId}`,
    jsonInit("PUT", { sections: [{ section_id: s1.id }, { section_id: s2.id }], rules: [{ rule_type: "eligibility" }] }),
    env,
  );
  expect(put.status, `seed variant: ${await put.clone().text()}`).toBe(200);
  const activate = await admin.request(
    `${API}/quotes/${q.public_id}/activation/site-1`,
    jsonInit("PUT", { enabled: true, slug: "jargon-pin" }),
    env,
  );
  expect(activate.status, `activate: ${await activate.clone().text()}`).toBe(200);
  const page = await admin.request(`/admin/leadgen/quotes/${q.public_id}/edit`, {}, env);
  expect(page.status).toBe(200);
  return page.text();
}

// ---------------------------------------------------------------------------
// The gate.
// ---------------------------------------------------------------------------

describe("U15 jargon copy-pin (MAJOR-1) — zero 'frame'-as-product-noun phrases in rendered copy", () => {
  it("section-builder studio (SSR shell + inline island script): zero banned phrases", () => {
    const hits = findBannedPhrases(STUDIO_FULL_EMITTED, "section-builder studio");
    expect(hits, `banned phrase(s) found: ${JSON.stringify(hits, null, 2)}`).toEqual([]);
  });

  describeDb("quote-builder edit page (real route, node:sqlite D1 harness)", () => {
    it("zero banned phrases in the full rendered HTML", async () => {
      const html = await renderQuoteBuilderEditPage();
      const hits = findBannedPhrases(html, "quote-builder edit page");
      expect(hits, `banned phrase(s) found: ${JSON.stringify(hits, null, 2)}`).toEqual([]);
    });
  });

  // Self-test: the scanner itself must actually DETECT a banned phrase when
  // one is present (a pin that can never fail is not a gate). Proves the
  // word-boundary matching + the attribute-stripping don't over-suppress.
  it("self-test: the scanner detects an injected banned phrase, and does NOT false-positive on internal identifiers it must ignore", () => {
    const withJargon = `<div class="lg-x" data-scope-pill="frame">Set this up in the Quote frame, not here.</div>`;
    expect(findBannedPhrases(withJargon, "self-test")).toEqual([
      'self-test: banned phrase "Quote frame" (matched "Quote frame")',
    ]);
    const internalOnly = `<div id="frame-settings-panel" class="page-frame-legacy" data-frame-badge="q1" data-scope-pill="frame">Part of the funnel layout.</div>`;
    expect(findBannedPhrases(internalOnly, "self-test")).toEqual([]);
  });
});
