// LeadGen R2 P8-3 — SLICE S3.2 "the theme controls say what they mean".
// Owner verbatim (SOURCE-OF-TRUTH.md): "theme is only design language!!!!
// colors, fonts, sizes" — the operator is a marketer, not an engineer.
// Contract minors N1/N7/N11/N20 (§7), against the REAL rendered admin
// markup produced by the REAL render functions (renderThemesTabPanel for the
// rail; the real admin router for the standalone Themes manager page) — never
// a hand-assembled string — and, for N11's runtime behaviour, the REAL served
// island script executed in a node:vm sandbox wired to the REAL admin router
// over a REAL node:sqlite D1 (the repo's existing island-probe idiom, e.g.
// test/leadgen-p2-fixfirst-r2.test.ts's bootThemesIsland).
//
//   N1  — Button corners / Card corners / Card shadow showed raw enum
//         members (sm|md|lg|xl|full / none|sm|md|lg|xl) as the visible
//         option text. Fixed with the SAME existing mechanism every other
//         rail control already uses (themeSelect's optional label map) —
//         never a second one. (The contract also named a "Base visual
//         design" control with raw `default`/`default-funnel` options — found
//         at quotes-tabs/funnel.ts:555, OUTSIDE this slice's owned files; not
//         touched here, reported to the conductor instead.)
//   N7  — no select shows a truncated version of its own value.
//   N11 — "Apply to this funnel" / "A/B this theme" offered themselves as
//         ready even with ZERO saved presets (contract §4 R3 corollary: "a
//         control that cannot be honoured must not be offered"). Proved
//         BIDIRECTIONALLY: zero presets (disabled + honest copy) AND at
//         least one preset (enabled + the original copy).
//   N20 — the rail (THEME_FONT_IDS) and the standalone Themes manager
//         (THEME_RECORD_FONT_NAMES) offered two disjoint font vocabularies;
//         fonts.generated.ts's LEADGEN_SELF_HOSTED_FONT_FAMILIES is the only
//         8 the renderer actually serves.
//
// ===========================================================================
// FIX ROUND F3 — WHAT CHANGED IN THIS FILE, AND WHY THE OLD PINS WERE WEAK
// ===========================================================================
// A fresh-context adversarial review drove EVERY option of every theme select
// and found F2 had RE-CREATED N7's defect: the phase's own new labels
// overflowed the same box the old string had ("Literata (shows as default
// font)" 191.43px in a 125.00px content box, +66.43px; "Bigger + check badge"
// +10.82px; the manager's "Inter (shows as default font)" 181.2px in a 107.00px
// box, +74.2px).
//
// RETIRED, and what covers its claim now — stated in-file per the standing
// invariant. The old N7 test asserted ONE fact: that 16 selects carry the
// SHORTENED blank text "Inherit from base". That test could not fail for the
// case that matters (it never looked at a box, and it never looked at the
// other 11 options of each select), which is exactly how the overflow shipped
// green twice. It is NOT deleted — it is now the FIRST leg of the N7 block
// below, unchanged in strictness (same regex, same count of 16). What it could
// never prove is proved by the NEW leg beside it: THE BOX INVARIANT — for
// every select in the real rendered markup, for EVERY option it carries, the
// option's text must be narrower than that select's own content box, at every
// container width the layout can take. No hard-coded list of today's strings
// appears in that leg; both the option set and the box arithmetic are read out
// of the real artifacts (the real render functions, the real LG_QUOTES_STYLES /
// ADMIN_STYLES sheets, the real inline styles), so a longer label written
// tomorrow, or a revert of either grid rule, fails HERE.
//
// HOW THE BOX INVARIANT AVOIDS E10/E11 (a test that hand-builds both sides).
// vitest's environment is "node": jsdom/happy-dom are NOT installed and there
// is no CSS engine or font metrics (no-new-deps), so this cannot be a live
// cascade measurement — the conductor's and the reviewer's DRIVEN runs are the
// behavioural proof (E6). What this leg contributes is the arithmetic that the
// driven runs cannot re-derive cheaply, with neither side hand-built:
//   - the OPTION SET and the SELECT SET come from the REAL render functions
//     (renderThemesTabPanel; the REAL admin router's Themes-manager page);
//   - the BOX comes from the REAL stylesheets and the REAL inline styles those
//     same renders emit — parsed, never re-typed;
// (FIX ROUND F12 later re-scoped the clip reveal out of the CROSS-PRODUCT
// admin shell into src/admin/leadgen/clip-reveal.ts, and states the 141 -> 63
// retirement arithmetic F10 left unstated — see "F12 BLAST RADIUS" and "F12
// RETIREMENT LEDGER" below.)
//   - the TEXT WIDTH comes from a per-character advance model that is
//     CALIBRATED AGAINST REAL MEASURED PIXELS: the 29 strings the reviewer
//     measured in the running product (docs/leadgen/r2/evidence/p8/
//     review-p8-3/r-n7-deep.txt, r-manager.txt, r-themes-rail.txt). The
//     calibration is itself asserted below — for every sample, in the bucket
//     that produced it, the model must be >= the browser's own number — so the
//     estimate is conservative over the character classes those samples
//     contain (it over-states every real sample by 5.6%..26.8%, i.e. it fails
//     early, never late). It is NOT conservative for every possible string:
//     see "THE CHARACTER-CLASS LIMIT" at CALIBRATION for the measured
//     counter-examples and for the leg that keeps this file's own arithmetic
//     inside the calibrated repertoire.
//
// FIX ROUND F14 — WHAT CHANGED IN THIS FILE. NOTHING RETIRED, NOTHING
// WEAKENED: 102 legs before, 110 after, the same 102 still asserting exactly
// what they asserted. The 8 new ones are
//   * 6 for review-p8-3d MAJOR-1 (the reveal destroying a product-authored
//     `title`). They are shaped to fail on DESTRUCTION, not on absence, which
//     is the shape F13's `clipped-without-title` metric could not have: they
//     count readings in which the author's own sentence is missing from the
//     element. Against the F13 body all 6 fail (measured this round: "Tests 6
//     failed | 104 passed"); against these bytes all 6 pass. One of them takes
//     the author title out of the REAL served /admin/leadgen/sections/new
//     markup so neither side of that boundary is typed here (E11).
//   * 2 for review-p8-3d MINOR-1 (the width model's false absolute): the four
//     driven under-statements are pinned as KNOWN, and the box arithmetic is
//     required to stay inside the character repertoire the model is calibrated
//     on.
// The reveal harness also grew: the inline style now REFLECTS into the style
// attribute as chromium's CSSOM does, so the F13 residue (`style=""` left on
// an element the product rendered without one) is visible in the node lane
// instead of only in a drive.
// ===========================================================================

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import admin from "../src/admin/router";
import { renderThemesTabPanel } from "../src/admin/leadgen/quotes-tabs/themes";
import { QUOTE_EDITOR_SCRIPT } from "../src/admin/leadgen/quotes-tabs/funnel";
import { LG_QUOTES_STYLES } from "../src/admin/leadgen/quotes-tabs/shared";
import type { PreviewSiteOption } from "../src/admin/leadgen/quotes-tabs/shared";
import { ADMIN_SCRIPTS, ADMIN_STYLES } from "../src/admin/templates/layout";
import { LG_CLIP_REVEAL_SCRIPT } from "../src/admin/leadgen/clip-reveal";
import { THEME_FONT_IDS, THEME_FONT_STACKS, THEME_RECORD_FONT_NAMES, THEME_RECORD_FONT_STACKS, resolveTokens } from "../src/public/leadgen/designs/theme";
import { DEFAULT_FUNNEL_SCOPE, funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { LEADGEN_SELF_HOSTED_FONT_FAMILIES } from "../src/public/leadgen/designs/fonts.generated";
import type { Env } from "../src/env";

// P8-6 slice V1 — WHY THE LEGS BELOW THAT CALL coveredSelects() NAME AN
// EXPLICIT PER-TEST TIMEOUT INSTEAD OF RELYING ON vitest's 5000ms DEFAULT.
// The conductor's authoritative full-suite gate went red on ONE leg here
// (F12 RETIREMENT LEDGER's "restores claim 1") with "Test timed out in
// 5000ms", re-run in isolation immediately after at 110/110 — a LOAD-
// DEPENDENT flake, not a regression. MEASURED THIS ROUND, before any change:
// the 8 legs that call coveredSelects() (the box-arithmetic sweep over the
// two live surfaces) were 652-1169ms alone, and 1.4-3.6s under a synthetic
// 24-way CPU-bound contention rig (`node -e "while(true){}"` x24 on this
// 12-core box, i.e. 2x oversubscription) — everything else in this file
// stayed under 90ms even at that contention level. THIS ROUND ALSO MADE THE
// WORK ITSELF CHEAPER, not just more patient: resolveContentBox's per-pixel
// sweep (up to ~1200 steps per select) used to redo a whole hop's
// declaration lookups AND, for a flex hop, its ENTIRE sibling scan
// (topLevelChildren -> sliceAnyElement -> per-sibling textWidthPx) on every
// single step, even though none of that depends on the sweep's own width —
// see resolveHop's comment above resolveContentBox. Hoisting the width-
// independent half out of the sweep (same arithmetic, same order, same
// answer — 110/110 unchanged before/after) took the same 8 legs to
// 16-91ms alone and a WORST OF 250ms under the identical 24-way rig (3
// consecutive runs, 110/110 each). That is roughly a 60-150x margin under
// synthetic 2x-core contention, which is why 5000ms would almost certainly
// no longer be crossed even without this timeout — but the conductor's own
// full-suite rig is bigger and noisier than 24 busy loops on one dev box,
// and "probably enough headroom now" is exactly the kind of claim this file
// keeps not trusting from itself elsewhere. The budget below is therefore an
// INSTRUMENT correction on top of the real fix, not a substitute for it: it
// changes NOTHING about what any leg asserts or how strictly, only how long
// vitest waits before calling contention a failure. It is applied ONLY to
// the 8 legs that were ever measured heavy — every other leg keeps the
// 5000ms default, so a genuine future regression in a currently-cheap leg
// still fails loudly and quickly instead of being silently absorbed by a
// blanket bump.
const HEAVY_LEG_TIMEOUT_MS = 15_000;

// --- node:sqlite harness (repo pattern — duplicated per test file, e.g. ---
// --- test/leadgen-theme-manager-ui.test.ts, leadgen-p2-fixfirst-r2.test.ts)

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
          return { success: true, meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) } };
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
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
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
  "0042_leadgen_pages.sql",
  "0043_leadgen_routing_rules.sql",
  "0044_leadgen_redirect_pct.sql",
  "0045_leadgen_persona_quota.sql",
  "0046_leadgen_rework_m1_variants.sql",
  "0047_leadgen_rework_m2_shared_pages.sql",
  "0048_leadgen_rework_m3_routing.sql",
  "0049_leadgen_rework_m4_m5_defaults_templates.sql",
  "0050_leadgen_rework_m6_grid_expansion.sql",
  "0051_leadgen_rework_m7_slider_collapse.sql",
  "0052_leadgen_rework_m9_address_fields.sql",
  "0053_leadgen_rework_m12_othergroup_retirement.sql",
] as const;

function createDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(sdb, "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);");
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
const API = "/api/admin/leadgen";

function newHarness(): { sdb: SqliteDb; env: Env } {
  const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb), makeKvStub()) };
}
function jsonInit(method: string, body?: unknown): RequestInit {
  return body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
async function json<T>(res: Response, label: string): Promise<T> {
  const body = (await res.json()) as T;
  expect(res.status, `${label}: ${JSON.stringify(body)}`).toBeLessThan(300);
  return body;
}
async function getHtml(env: Env, path: string): Promise<{ status: number; html: string }> {
  const res = await admin.request(path, {}, env);
  return { status: res.status, html: await res.text() };
}
function presetBody(name: string, headlineFont: string, bodyFont: string): Record<string, unknown> {
  return {
    name,
    roles: { brand_primary: "#1B3A5C", accent: "#F5C518", page_bg: "#F4F6F9", card: "#FFFFFF", text: "#1A1F36", success: "#0E7C3A", error: "#B23A2C" },
    typography: { headline_font: headlineFont, body_font: bodyFont, base_px: 16 },
    controls: { field_height: "medium", button_size: "m", corners: "rounded" },
  };
}
interface ThemeCreateResponse {
  item: { id: string };
}

// --- markup extraction: find ONE <select>...</select> by an attribute it --
// --- carries, so an assertion is scoped to the exact control under test ---
function selectBlock(html: string, marker: string): string {
  const at = html.indexOf(marker);
  expect(at, `marker ${marker}`).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<select", at);
  const end = html.indexOf("</select>", at) + "</select>".length;
  expect(start, `<select for ${marker}`).toBeGreaterThan(-1);
  return html.slice(start, end);
}

// ===========================================================================
// N1 — raw enum tokens are no longer the visible label (rail, pure SSR)
// ===========================================================================

describe("N1 — theme rail: Button/Card corners + Card shadow show design words, not raw enum members", () => {
  const html = renderThemesTabPanel(true);

  it("Button corners: sm/md/lg/xl/full render as Small/Medium/Large/Extra large/Fully round; every stored VALUE is unchanged", () => {
    const block = selectBlock(html, 'data-theme-key="button_defaults.radius"');
    expect(block).toContain('value="sm"');
    expect(block).toContain('value="md"');
    expect(block).toContain('value="lg"');
    expect(block).toContain('value="xl"');
    expect(block).toContain('value="full"');
    expect(block).toContain(">Small<");
    expect(block).toContain(">Medium<");
    expect(block).toContain(">Large<");
    expect(block).toContain(">Extra large<");
    expect(block).toContain(">Fully round<");
    expect(block).not.toContain(">sm<");
    expect(block).not.toContain(">md<");
    expect(block).not.toContain(">lg<");
    expect(block).not.toContain(">xl<");
    expect(block).not.toContain(">full<");
  });

  it("Card corners: the SAME label map (no second mechanism invented)", () => {
    const block = selectBlock(html, 'data-theme-key="card_defaults.radius"');
    expect(block).toContain('value="sm"');
    expect(block).toContain(">Small<");
    expect(block).not.toContain(">sm<");
    expect(block).not.toContain(">full<");
  });

  it("Card shadow: none/sm/md/lg/xl render as None/Small/Medium/Large/Extra large", () => {
    const block = selectBlock(html, 'data-theme-key="card_defaults.shadow"');
    expect(block).toContain('value="none"');
    expect(block).toContain(">None<");
    expect(block).toContain('value="xl"');
    expect(block).toContain(">Extra large<");
    expect(block).not.toContain(">none<");
    expect(block).not.toContain(">xl<");
  });

  it("ADJACENT DEFECT (not in this slice's owned files): the contract's third named control, 'Base visual design', lives at quotes-tabs/funnel.ts:555 (<select id=\"lg-funnel-design\">), rendering raw design ids via designOptions — reported, not fixed here", () => {
    expect(html).not.toContain('id="lg-funnel-design"');
  });
});

// ===========================================================================
// N7 — NO SELECT SHOWS A TRUNCATED VERSION OF ITS OWN VALUE
//
// The machinery below is shared by both surfaces (rail + Themes manager).
// Everything it consumes is parsed out of a real artifact; nothing about
// today's particular strings is written down.
// ===========================================================================

// --- 1. TEXT WIDTH: a per-character advance model, calibrated against ------
// --- REAL measured pixels from the driven product, PER FONT FAMILY. --------
//
// FIX ROUND F13 (review-p8-3c MAJOR-1) — WHY THIS GREW A FAMILY AXIS. The F3
// model had ONE proportional table, fitted to 29 samples that were all
// measured in the admin UI font (driven: `.form-select`'s computed
// font-family on /admin/leadgen/quotes is `Arial`). The Themes manager's two
// font selects are the one control in the product that PAINTS IN THE FAMILY IT
// NAMES, and in the monospace stack the model under-stated the browser by
// 38.9px — "Roboto Mono (shows as default font)" modelled 255.08px while
// chromium laid out 294px in a 282px box. A green invariant over a clipped
// control is worse than no invariant, so the model now takes the family the
// select really declares.
// THE NEW SAMPLES ARE DRIVEN, not derived: an offscreen 14px span on the real
// /admin/leadgen/themes page (fonts settled via document.fonts.ready) laid out
// each string in each real stack and reported getBoundingClientRect().width.
// Three buckets came out of those 247 measurements:
//   mono  — every glyph the same advance. Measured 0.60029em/char at the
//           widest across every string in `'Roboto Mono',monospace` (294.06px
//           / 35 chars / 14px), so MONO_ADVANCE_EM is a flat 0.62 and the
//           proportional table is not used at all for this bucket.
//   serif — Georgia/Times fallbacks ('Fraunces'/'Playfair Display'/'Literata'
//           -> Georgia, 'Newsreader' -> serif). Worst measured/model ratio
//           1.0770 ("Inter" at 31.06px vs 28.84px modelled).
//   sans  — the admin UI font and every system-ui fallback. Worst ratio
//           1.0222 ("Inter" 29.48px in system-ui).
// BUCKET_FACTOR is the multiplier applied to the proportional table so the
// model does not under-state a width the browser really produced for the
// samples and character classes it is calibrated on, with headroom over the
// worst ratio in each bucket; the calibration block below asserts exactly
// that, per sample, per bucket.
// THE CHARACTER-CLASS LIMIT (FIX ROUND F14, review-p8-3d MINOR-1). The
// sentence above used to read "never UNDER-states a width the browser really
// produced", full stop. That absolute is false and this file has been bitten
// twice by an in-file claim wider than its evidence, so here is the measured
// truth. The table classifies A-Z as `upper`, the listed punctuation as
// narrow/semi/wide, and EVERYTHING ELSE as `normal` (0.62em), so it can
// under-state in TWO ways: (a) a glyph wider than 0.62em that no list names
// falls into the catch-all, and (b) a class is an AVERAGE, so a string made of
// the widest members of one class can exceed it. Driven this
// round at 14px on /admin/leadgen/themes (offscreen span, fonts settled),
// model vs browser: "%"x20 182.28 vs 256.08 (1.405x UNDER, sans, case a);
// "ÄÖÜÑÇÆØÅÐÞ" 91.14 vs 101.22 (1.111x — accented capitals miss the A-Z
// class, case a); a 12-character CJK string 104.16 vs 166.61 (1.600x, mono,
// case a); and "Q"x20 211.68 vs 213.02 (1.006x — case b: Q is the widest
// capital and `upper` is one number for all 26, so a pathological all-Q label
// beats it by 1.3px over 20 characters). The two in-use strings measured in
// the same run stay conservative ("Inherit from base" 119.80 vs 109.66;
// "Roboto Mono (shows as default font)" 303.80 vs 294.06).
// IMPACT TODAY IS ZERO AND THAT IS ASSERTED, not assumed: the 218 real option
// texts these two surfaces render use only alphanumerics plus space ' ( ) + -
// — … (driven census this round; the reviewer's own 2,234-string harvest
// across 14 routes under-stated 0 times), and the leg "the model is only ever
// applied inside the repertoire it was calibrated on" below fails the day a
// percent sign, an accented capital or a CJK glyph enters an offered string —
// which is the moment this model needs re-measuring rather than trusting.
// WHAT IT STILL CANNOT MODEL, stated rather than implied: these are THIS
// engine's fallback metrics (chromium/macOS: the mono stack resolves to the
// system monospace and every "self-hosted" family falls back too, because the
// ADMIN pages vendor no @font-face — that is itself why the not-served label
// exists). A different platform's monospace or serif can be wider than the
// factors above, and no node-side model can know that. The engine-independent
// half of the guarantee is the clip reveal, which measures the REAL painted
// box in the operator's own browser (LG_CLIP_REVEAL_SCRIPT, executed below),
// and the driven runs at 1280 and 375 are the behavioural proof (E6).
type FontBucket = "sans" | "serif" | "mono";
const ADVANCE = { narrow: 0.22, semi: 0.3, wide: 0.95, upper: 0.72, ellipsis: 0.95, normal: 0.62 };
const NARROW_CHARS = "iljI|!.,;:'`";
const SEMI_CHARS = "ftr()[]{}/\\-– ";
const WIDE_CHARS = "mwMW—@";
const MONO_ADVANCE_EM = 0.62;
const BUCKET_FACTOR: Record<FontBucket, number> = { sans: 1.05, serif: 1.12, mono: 1 };
const WIDEST_BUCKET: FontBucket = "mono";

// The family a declaration resolves to, by the generic/known families it
// names — read off the REAL `font-family` declaration, never a list of
// "the selects I think are monospace".
function bucketOf(fontFamily: string | null): FontBucket {
  if (fontFamily === null) return "sans";
  const f = fontFamily.toLowerCase();
  if (f.includes("mono")) return "mono";
  if (f.includes("serif") && !f.includes("sans-serif")) return "serif";
  if (/\b(georgia|times|newsreader|literata|fraunces|playfair)\b/.test(f)) return "serif";
  return "sans";
}

function textWidthPx(text: string, fontPx: number, bucket: FontBucket = "sans"): number {
  if (bucket === "mono") return [...text].length * MONO_ADVANCE_EM * fontPx;
  let em = 0;
  for (const ch of text) {
    if (NARROW_CHARS.includes(ch)) em += ADVANCE.narrow;
    else if (SEMI_CHARS.includes(ch)) em += ADVANCE.semi;
    else if (WIDE_CHARS.includes(ch)) em += ADVANCE.wide;
    else if (ch === "…") em += ADVANCE.ellipsis;
    else if (ch >= "A" && ch <= "Z") em += ADVANCE.upper;
    else em += ADVANCE.normal;
  }
  return em * fontPx * BUCKET_FACTOR[bucket];
}

// Every row below is a REAL width a driven browser reported for that exact
// string at font-size 14px in that bucket's real stack. Rows 1-27 are the
// reviewer's original admin-UI (Arial) measurements, transcribed from
// docs/leadgen/r2/evidence/p8/review-p8-3/{r-n7-deep,r-themes-rail,
// r-manager}.txt; the rows after them are F13's own per-family run described
// above. The model is only ever allowed to be CONSERVATIVE: >= the browser's
// own number, in the bucket that produced it.
const CALIBRATION: ReadonlyArray<readonly [string, number, FontBucket]> = [
  ["Inherit from base", 105.05, "sans"],
  ["Literata (shows as default font)", 191.43, "sans"],
  ["Sora (shows as default font)", 174.31, "sans"],
  ["System (shows as default font)", 191.41, "sans"],
  ["Bigger + check badge", 135.82, "sans"],
  ["R2Fix Fixture Site — Active", 171.15, "sans"],
  ["— choose a funnel —", 134.63, "sans"],
  ["Default Funnel Design", 138.52, "sans"],
  ["R2Fix Fixture Quote — Funnel A", 174.06, "sans"],
  ["Flat", 23.34, "sans"],
  ["Site logo (auto)", 94.94, "sans"],
  ["Small", 35.01, "sans"],
  ["Center", 42.02, "sans"],
  ["Under the header", 108.96, "sans"],
  ["Choose a preset…", 116.73, "sans"],
  ["Brand primary", 87.92, "sans"],
  ["Poppins", 52, "sans"],
  ["Space Grotesk", 94.8, "sans"],
  ["Fraunces", 59.4, "sans"],
  ["Playfair Display", 98.5, "sans"],
  ["Manrope", 57, "sans"],
  ["DM Sans", 57.4, "sans"],
  ["Work Sans", 68.8, "sans"],
  ["Lexend", 46.2, "sans"],
  ["Newsreader (shows as default font)", 229.3, "sans"],
  ["Inter (shows as default font)", 181.2, "sans"],
  ["Roboto Mono (shows as default font)", 238.2, "sans"],
  // F13, driven this round — the same strings in the system-ui sans fallback
  // every "self-hosted" preview stack really paints in on an admin page (the
  // widest sans measured; Arial above is narrower).
  ["Inter", 29.48, "sans"],
  ["Playfair Display", 98.5, "sans"],
  ["Space Grotesk", 94.78, "sans"],
  ["Roboto Mono (shows as default font)", 238.25, "sans"],
  ["Newsreader (shows as default font)", 229.31, "sans"],
  ["Shows as default font", 139.09, "sans"],
  // F13, driven this round — serif: 'Fraunces'/'Playfair Display'/'Literata'
  // fall back to Georgia, 'Newsreader' to the default serif.
  ["Inter", 31.06, "serif"],
  ["Playfair Display", 97.91, "serif"],
  ["Space Grotesk", 88, "serif"],
  ["Newsreader", 73.98, "serif"],
  ["Roboto Mono (shows as default font)", 228.61, "serif"],
  ["Newsreader (shows as default font)", 217.72, "serif"],
  ["Inherit from base", 107.95, "serif"],
  // F13, driven this round — mono: the bucket that falsified the old model.
  ["Inter", 42.02, "mono"],
  ["Roboto Mono", 92.42, "mono"],
  ["Playfair Display", 134.42, "mono"],
  ["Space Grotesk", 109.22, "mono"],
  ["Newsreader", 84.02, "mono"],
  ["Roboto Mono (shows as default font)", 294.06, "mono"],
  ["Newsreader (shows as default font)", 285.66, "mono"],
  ["Inter (shows as default font)", 243.64, "mono"],
  ["Shows as default font", 176.44, "mono"],
  ["Inherit from base", 142.83, "mono"],
];

// FIX ROUND F14 (MINOR-1) — THE REPERTOIRE THE MODEL IS CALIBRATED ON. Not a
// hand-written allowlist of "characters I think are fine": it is exactly the
// characters the model classifies explicitly (the three advance lists, the
// ellipsis and the A-Z `upper` class), the a-z/0-9 the `normal` class was
// fitted to, and every character that appears in a CALIBRATION string — i.e.
// every character a real browser has already measured through this model. A
// character outside it lands in the 0.62em catch-all with nothing behind it,
// which is where the measured 1.006x..1.600x under-statements live.
const MODELLED_CHARS: ReadonlySet<string> = new Set([
  ...NARROW_CHARS,
  ...SEMI_CHARS,
  ...WIDE_CHARS,
  "…",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  ..."abcdefghijklmnopqrstuvwxyz",
  ..."0123456789",
  ...CALIBRATION.flatMap(([text]) => [...text]),
]);
function unmodelledCharacters(text: string): string[] {
  return [...new Set([...text].filter((ch) => !MODELLED_CHARS.has(ch)))];
}

// --- 2. MARKUP: pull the real <select>s and their real <option>s out of -----
// --- whatever HTML the real renderer produced. -----------------------------
interface ParsedOption {
  attrs: string;
  value: string;
  text: string;
  hidden: boolean;
  selected: boolean;
}
interface ParsedSelect {
  attrs: string;
  options: ParsedOption[];
}

function decodeEntities(raw: string): string {
  return raw
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
function attr(attrs: string, name: string): string | null {
  return attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;
}

function parseSelects(html: string): ParsedSelect[] {
  return [...html.matchAll(/<select([^>]*)>([\s\S]*?)<\/select>/g)].map((m) => ({
    attrs: m[1] as string,
    options: [...(m[2] as string).matchAll(/<option([^>]*)>([\s\S]*?)<\/option>/g)].map((o) => ({
      attrs: o[1] as string,
      value: decodeEntities(attr(o[1] as string, "value") ?? ""),
      text: decodeEntities(o[2] as string),
      hidden: /\shidden(\s|$|=)/.test(o[1] as string),
      selected: /\sselected(\s|$|=)/.test(o[1] as string),
    })),
  }));
}

// Slice one balanced <div>…</div> starting at `from`.
function sliceElement(html: string, from: number): string {
  let depth = 0;
  for (const m of html.slice(from).matchAll(/<(\/?)div\b[^>]*?(\/?)>/g)) {
    if (m[2] === "/") continue;
    depth += m[1] === "/" ? -1 : 1;
    if (depth === 0) return html.slice(from, from + (m.index as number) + m[0].length);
  }
  throw new Error("unbalanced element while slicing the real markup");
}

// The <select>s inside every container carrying `className`, found
// STRUCTURALLY (by the container, in the real markup) rather than by naming
// today's controls — a control added to that grid tomorrow is covered too.
function selectsInsideClass(html: string, className: string): ParsedSelect[] {
  const out: ParsedSelect[] = [];
  for (const m of html.matchAll(new RegExp(`<div[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`, "g"))) {
    out.push(...parseSelects(sliceElement(html, m.index as number)));
  }
  return out;
}

// --- 3. CSS: read the boxes out of the real sheets / real inline styles ----
// PERFORMANCE ONLY (P8-6 gate run 3) — NO SEMANTIC CHANGE. styleRule used to
// re-flatten the sheet (a full ~80KB string copy) and re-scan it end-to-end on
// EVERY lookup, and declFor calls it once per class per sheet inside a
// try/catch; one coveredSelects() sweep therefore ran it thousands of times
// over the two real sheets. That put the N7 CLIP INVARIANT and F12 RETIREMENT
// LEDGER legs at 4.1-4.7s against vitest's 5000ms default, so they TIMED OUT
// under gate load while passing in isolation. The parse is now memoised per
// sheet. The index keeps the FIRST rule that lists a selector, which is
// exactly what the old loop's first `return` did, and an absent selector still
// throws the same Error — so every caller sees identical values. Keyed by
// sheet CONTENT, never by position, so the F12 claim-2 leg's REVERTED sheet
// gets its own index instead of reusing the real sheet's (a stale hit there
// would silently defeat that leg's fail-before bottle).
const STYLE_RULE_INDEX = new Map<string, Map<string, string>>();
function styleRuleIndex(sheet: string): Map<string, string> {
  const cached = STYLE_RULE_INDEX.get(sheet);
  if (cached !== undefined) return cached;
  // strip @media preludes so the brace pairs of the inner rules balance
  const flat = sheet.replace(/@media[^{]*\{/g, "");
  const index = new Map<string, string>();
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const block = (m[2] as string).trim();
    for (const selector of (m[1] as string).split(",")) {
      const key = selector.trim();
      if (!index.has(key)) index.set(key, block);
    }
  }
  STYLE_RULE_INDEX.set(sheet, index);
  return index;
}
function styleRule(sheet: string, selector: string): string {
  const block = styleRuleIndex(sheet).get(selector);
  if (block === undefined) throw new Error(`selector not found in the real stylesheet: ${selector}`);
  return block;
}
function decl(block: string, prop: string): string {
  for (const part of block.split(";")) {
    const at = part.indexOf(":");
    if (at > -1 && part.slice(0, at).trim() === prop) return part.slice(at + 1).trim();
  }
  throw new Error(`declaration "${prop}" not found in: ${block}`);
}
function px(value: string): number {
  const m = value.match(/(-?\d+(?:\.\d+)?)px/);
  if (m === null) throw new Error(`not a px length: ${value}`);
  return Number(m[1]);
}
// `padding: <v>` shorthand -> the horizontal total (left + right).
function paddingX(shorthand: string): number {
  const parts = shorthand.trim().split(/\s+/).map(px);
  return (parts.length === 1 ? (parts[0] as number) : (parts[1] as number)) * 2;
}
// How many columns `grid-template-columns` yields in a `containerW` container.
// Supports BOTH the fixed shape the defect shipped with (`repeat(N,1fr)` /
// `1fr 1fr`) and the auto-fit/minmax shape that fixes it, so a REVERT is
// computed correctly — and fails — instead of being silently unsupported.
function columnCount(spec: string, containerW: number, gap: number): number {
  const fixed = spec.match(/^repeat\(\s*(\d+)\s*,/);
  if (fixed !== null) return Number(fixed[1]);
  const auto = spec.match(/^repeat\(\s*auto-(?:fit|fill)\s*,\s*minmax\(\s*(\d+(?:\.\d+)?)px/);
  if (auto !== null) return Math.max(1, Math.floor((containerW + gap) / (Number(auto[1]) + gap)));
  const tracks = spec.trim().split(/\s+/);
  if (tracks.every((t) => t.endsWith("fr"))) return tracks.length;
  throw new Error(`unsupported grid-template-columns: ${spec}`);
}
function inlineStyleOf(html: string, marker: string): string {
  const at = html.indexOf(marker);
  expect(at, `marker ${marker}`).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at)).match(/style="([^"]*)"/)?.[1] ?? "";
}
function styleValue(style: string, prop: string): string {
  return decl(style, prop);
}

describe("N7 machinery — the width model does not under-state a width the real browser produced, inside the repertoire it is calibrated on", () => {
  for (const [text, measured, bucket] of CALIBRATION) {
    it(`[${bucket}] "${text}" — model >= ${measured}px measured live`, () => {
      expect(textWidthPx(text, 14, bucket)).toBeGreaterThanOrEqual(measured);
    });
  }

  // FIX ROUND F13 (MAJOR-1) — the leg that would have caught the defect: the
  // family axis has to CHANGE the answer, and it has to change it in the
  // direction the browser measured. Without a bucket the old model returned
  // 255.08px for the string chromium laid out at 294.06px in the monospace
  // stack; the same call in the mono bucket returns >= that. A future edit
  // that collapses the buckets back to one table fails HERE, not in the
  // product.
  it("EXECUTED: the family axis is real — the mono bucket is wider than the default for the string that falsified the one-table model", () => {
    const label = "Roboto Mono (shows as default font)";
    const sansOnly = textWidthPx(label, 14, "sans");
    const mono = textWidthPx(label, 14, "mono");
    expect(sansOnly).toBeLessThan(294.06); // the old model's blind spot, reproduced
    expect(mono).toBeGreaterThanOrEqual(294.06); // …and closed
    expect(bucketOf("'Roboto Mono',monospace")).toBe("mono");
    expect(bucketOf("Newsreader,serif")).toBe("serif");
    expect(bucketOf("'Poppins',system-ui,sans-serif")).toBe("sans");
    expect(bucketOf(null)).toBe("sans");
  });

  // FIX ROUND F14 (review-p8-3d MINOR-1) — the retired absolute, kept honest.
  // Each row is a string a real browser laid out this round (offscreen 14px
  // span on /admin/leadgen/themes, fonts settled) beside what this model
  // returns for it. The model is BELOW the browser for all four, which is the
  // whole reason the comment now states a repertoire instead of "never". Three
  // are case (a) — a glyph with no class — and are therefore caught by the
  // repertoire leg in the CLIP INVARIANT block; the "Q" row is case (b), a
  // pathological distribution INSIDE the A-Z class, which no repertoire check
  // can see and which is written down here instead of implied. If a future
  // edit widens the classes so one of these becomes conservative, this leg
  // fails and the numbers in the comment above must be re-measured, not
  // quietly kept.
  it("EXECUTED: the model's stated limit is real — these four strings under-state, by the amounts driven this round", () => {
    const cases: ReadonlyArray<readonly [string, number, FontBucket, "no class for the glyph" | "widest member of a class"]> = [
      ["%".repeat(20), 256.08, "sans", "no class for the glyph"],
      ["ÄÖÜÑÇÆØÅÐÞ", 101.22, "sans", "no class for the glyph"],
      ["日本語のテキストサンプル", 166.61, "mono", "no class for the glyph"],
      ["Q".repeat(20), 213.02, "sans", "widest member of a class"],
    ];
    for (const [text, real, bucket, kind] of cases) {
      expect(textWidthPx(text, 14, bucket), `${text} is a KNOWN under-statement (${kind})`).toBeLessThan(real);
      expect(unmodelledCharacters(text).length > 0, `${text}: ${kind}`).toBe(kind === "no class for the glyph");
    }
    // …and every string the product really renders through this model is
    // inside the repertoire, so the box arithmetic never runs on case (a).
    for (const text of ["Inherit from base", "Roboto Mono (shows as default font)", "Bigger + check badge", "Seed Local Living — Not activated yet", "Choose a preset…"]) {
      expect(unmodelledCharacters(text), text).toEqual([]);
    }
  });
});

describe("N7 — the shared blank option is short enough not to be its own truncation", () => {
  it("every themeSelect-based control (16 of them) uses the shortened 'Inherit from base' text; the stored value is still the empty (inherit) string", () => {
    const html = renderThemesTabPanel(true);
    // Scoped to the RENDERED <option> element itself (not the whole page):
    // a pre-existing, unrelated island comment (P8-1 F6's own FAIL-BEFORE
    // narrative, quoting the OLD text as history) still contains the phrase
    // "Inherit from base design" in prose, so a page-wide substring check
    // would be a false positive here — the option markup is the actual claim.
    expect(html).not.toMatch(/<option value="">Inherit from base design<\/option>/);
    const occurrences = html.match(/<option value="">Inherit from base<\/option>/g) ?? [];
    expect(occurrences.length).toBe(16);
  });
});

// ===========================================================================
// N7 — THE CLIP INVARIANT (FIX ROUND F10). ONE mechanism, three surfaces.
//
// WHAT THIS REPLACES, AND WHY. F3 shipped two box invariants: one over the
// rail's `.lg-scalars` grids, one over the manager's typography grid. Both
// were correct and both were BLIND, because each was scoped to the CONTAINER
// CLASS the reported instance happened to live in. Review #2 then measured a
// string written by F5 into `#lg-theme-preset-select` — same panel, same tab,
// different container (`.lg-preset-apply-row`) — overflowing by +59.05px at
// 1280 AND 375. A universe named by container class is not the universe the
// operator sees. NOTHING IS RETIRED: every assertion those two blocks made is
// made here, over a strictly larger set (they covered 18 selects between them;
// this covers every select the three surfaces render, currently 24), with the
// same conservative width model and the same declaration-derived boxes.
//
// THE INVARIANT. Every operator-facing control that can clip its own text, on
// the Themes rail, the Themes manager and the quote-editor board, either
//   (A) shows every PRODUCT-AUTHORED string it can hold in full, inside its
//       own content box, at every width its layout can take; or
//   (B) can hold OPERATOR data (a site, funnel, section or preset name — a
//       length no box can bound), in which case the product must hand the
//       operator the full text anyway: src/admin/leadgen/clip-reveal.ts's
//       reveal (title + ellipsis, driven by the element's OWN
//       scrollWidth/clientWidth, measured in a state its own styling cannot
//       change — see the F13 block below).
// A select is put in (B) by MEASUREMENT, not by a list: the same surface is
// rendered twice through the real code with two different real data sets and
// the option texts are diffed. A select whose texts move with the data is
// data-bearing; one whose texts do not is product-authored. So a control added
// tomorrow is classified by what it does, not by whether someone remembered it.
//
// WHAT THE UNIVERSE OF STRINGS IS. Not "the options in the SSR markup" — that
// is precisely what missed the BLOCKER, whose string is written by an island
// at runtime and appears nowhere in the markup. For every select the universe
// is: its real SSR option texts, PLUS every string literal the REAL served
// island script assigns to a `.textContent` inside the function that resolves
// that select by id. `#lg-theme-preset-select` therefore carries funnel.ts's
// two placeholder literals, and a longer replacement fails HERE.
//
// SURFACE COVERAGE — stated exactly, because a coverage claim wider than the
// code is the same failure as a box claim wider than the browser. The BOX leg
// enumerates TWO surfaces, the two whose renderers this slice owns:
//   S1 the Themes tab     — renderThemesTabPanel (quotes-tabs/themes.ts): the
//                           16 rail scalars, the funnel picker, the preview-
//                           site picker, the Advanced role picker and the
//                           preset picker = 20 controls.
//   S2 the Themes manager — the REAL admin route /admin/leadgen/themes: both
//                           font selects = 2 controls.
// WHERE THE REVEAL LEG (B) ACTUALLY REACHES — FIX ROUND F13 (MINOR-3),
// RESTATED, because the previous wording had been false since F12 and it was
// load-bearing for ~70 un-boxed selects. It is NOT in templates/layout.ts's
// ADMIN_SCRIPTS and has not been since F12 (the block below asserts that
// constant carries none of it — it is the CROSS-PRODUCT shell). It is
// page-global per page, and the set of pages is exactly the pages built by
// src/admin/leadgen/ui.ts's leadgenPageShell / leadgenStandalonePageShell —
// i.e. EVERY leadgen admin route and no other product's, which F13 (MAJOR-2)
// widened from F12's two hand-picked renderers. This file does not take that
// on trust: the F13 COVERAGE block below drives the REAL admin router for the
// real leadgen routes and requires the reveal's bytes in each served page.
// WHAT IS DELIBERATELY NOT IN THE BOX LEG, and why (each also in
// OUT_OF_COVERAGE below, with its measured overflow): the whole
// /admin/leadgen/quotes/:id/edit page composes SIX tab panels from five
// renderers and serves 70 more selects, most of them from files this slice
// does not own and from inspector containers whose width no declaration in an
// owned file pins. Putting a box under those here would be arithmetic dressed
// as coverage — the paper-audit failure this contract names. They are covered
// behaviourally by (B) instead — that page is a leadgenPageShell page, which
// the coverage block proves by route — and that was DRIVEN, not assumed:
// #lg-tpl-target-select (+283.77px) and #lg-tpl-section-select (+305.80px)
// both went from title="" / text-overflow:clip to the full operator name in a
// title plus an ellipsis, at 1280 and at 375.
//
// HOW THIS AVOIDS E10/E11. vitest's environment is "node": no jsdom, no CSS
// engine, no font metrics (no-new-deps). So this is not a cascade measurement
// and never claims to be — the DRIVEN runs are the behavioural proof (E6).
// What it contributes is the arithmetic the driven runs cannot re-derive
// cheaply, with NEITHER side hand-built: the select set and the option set
// come from the real renderers/real routes, the literals from the real served
// island bytes, the boxes from the real stylesheets and the real inline
// styles, and the width model is calibrated against 29 pixel widths the real
// browser produced (CALIBRATION above), asserted never to under-state one.
// ===========================================================================

// --- the real ancestor chain of a select, out of the real markup ----------
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
interface RawEl {
  tag: string;
  attrs: string;
  start: number;
  end: number;
}
// Only the MARKUP: <script>/<style> bodies and comments are not elements, and
// a tag name mentioned inside one is not a control the operator can see.
function markupOnly(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, (m) => " ".repeat(m.length))
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, (m) => " ".repeat(m.length))
    .replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length));
}
// Every <select> in `html`, each with the open-element stack above it.
function selectsWithChain(rawHtml: string): Array<{ select: ParsedSelect; chain: RawEl[]; at: number }> {
  const html = markupOnly(rawHtml); // offsets preserved (blanked, never removed)
  const stack: RawEl[] = [];
  const out: Array<{ select: ParsedSelect; chain: RawEl[]; at: number }> = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g)) {
    const closing = m[1] === "/";
    const tag = (m[2] as string).toLowerCase();
    const attrs = m[3] as string;
    const at = m.index as number;
    if (tag === "select" && !closing) {
      const block = html.slice(at, html.indexOf("</select>", at) + "</select>".length);
      out.push({ select: parseSelects(block)[0] as ParsedSelect, chain: stack.slice(), at });
      continue; // options are parsed above; never push <select> itself
    }
    if (VOID_TAGS.has(tag) || m[4] === "/") continue;
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if ((stack[i] as RawEl).tag === tag) {
          stack.length = i;
          break;
        }
      }
    } else {
      stack.push({ tag, attrs, start: at, end: -1 });
    }
  }
  return out;
}
// One balanced element of ANY tag starting at `from` (sliceElement above is
// <div>-only and stays as it is — its own callers depend on that).
function sliceAnyElement(html: string, from: number): string {
  const open = html.slice(from).match(/^<([a-zA-Z][\w-]*)/);
  if (open === null) throw new Error("not an element start");
  const tag = (open[1] as string).toLowerCase();
  if (VOID_TAGS.has(tag)) return html.slice(from, html.indexOf(">", from) + 1);
  let depth = 0;
  const re = new RegExp(`<(/?)${tag}\\b((?:"[^"]*"|'[^']*'|[^>"'])*?)(/?)>`, "g");
  for (const m of html.slice(from).matchAll(re)) {
    if (m[3] === "/") continue;
    depth += m[1] === "/" ? -1 : 1;
    if (depth === 0) return html.slice(from, from + (m.index as number) + m[0].length);
  }
  throw new Error(`unbalanced <${tag}> while slicing the real markup`);
}
// The top-level element children of one element's markup, each carrying its
// ABSOLUTE offset in the page so "which child holds my select" is an index
// comparison, never a substring guess.
function topLevelChildren(elementHtml: string, baseOffset: number): Array<{ html: string; tag: string; attrs: string; from: number; to: number }> {
  const innerAt = elementHtml.indexOf(">") + 1;
  const inner = elementHtml.slice(innerAt, elementHtml.lastIndexOf("<"));
  const kids: Array<{ html: string; tag: string; attrs: string; from: number; to: number }> = [];
  let i = 0;
  while (i < inner.length) {
    const next = inner.indexOf("<", i);
    if (next === -1) break;
    const open = inner.slice(next).match(/^<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/);
    if (open === null) {
      i = next + 1;
      continue;
    }
    const slice = sliceAnyElement(inner, next);
    const from = baseOffset + innerAt + next;
    kids.push({ html: slice, tag: (open[1] as string).toLowerCase(), attrs: open[2] as string, from, to: from + slice.length });
    i = next + slice.length;
  }
  return kids;
}

// --- declarations for one element, from the real sheets + real inline style -
function classesOf(attrs: string): string[] {
  return (attr(attrs, "class") ?? "").split(/\s+/).filter((c) => c !== "");
}
function declFor(attrs: string, prop: string, sheets: readonly string[]): string | null {
  const inline = attr(attrs, "style");
  if (inline !== null) {
    try {
      return decl(inline, prop);
    } catch {
      /* fall through to the class rules */
    }
  }
  for (const cls of classesOf(attrs)) {
    for (const sheet of sheets) {
      try {
        return decl(styleRule(sheet, `.${cls}`), prop);
      } catch {
        /* this class does not carry it */
      }
    }
  }
  return null;
}
function pxOr(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  try {
    return px(value);
  } catch {
    return fallback;
  }
}
function chromeX(attrs: string, sheets: readonly string[]): number {
  const pad = declFor(attrs, "padding", sheets);
  const border = declFor(attrs, "border", sheets);
  return (pad === null ? 0 : paddingX(pad)) + (border === null ? 0 : pxOr(border, 0) * 2);
}
function fontPxOf(attrs: string, sheets: readonly string[], fallback: number): number {
  return pxOr(declFor(attrs, "font-size", sheets), fallback);
}
function visibleText(elementHtml: string): string {
  return decodeEntities(elementHtml.replace(/<[^>]*>/g, "")).trim();
}
// `flex: <grow> <shrink> <basis>` -> the basis in px, when it has one.
function flexBasisPx(attrs: string, sheets: readonly string[]): number | null {
  const spec = declFor(attrs, "flex", sheets);
  if (spec === null) return null;
  const m = spec.trim().match(/(?:^|\s)(\d+(?:\.\d+)?)px\s*$/);
  return m === null ? null : Number(m[1]);
}

// --- the box: resolve DOWN the real chain from the nearest anchored --------
// --- ancestor to the select's own content box. -----------------------------
// An ANCHOR is an ancestor whose own width is pinned by a declaration
// (min-width/max-width, or a flex basis with a min-width) — the only honest
// place to start without a layout engine. Everything below it is resolved from
// the real declarations of each hop: padding/border, grid tracks, flex lines.
interface BoxResult {
  content: number;
  at: number;
  anchor: string;
}
// PERFORMANCE ONLY (P8-6 slice V1) — NO SEMANTIC CHANGE. Everything a "hop"
// needs (its own chrome, its grid spec, its flex siblings' widths…) is a pure
// function of that element's OWN attrs/markup and `sheets` — NONE of it reads
// `anchorW`/`width` — except the two spots marked below, which genuinely do
// and stay inside the sweep. The sweep below used to recompute a hop's WHOLE
// declaration lookup (chromeX/grid/gap/display, and for a flex hop the entire
// sibling scan: topLevelChildren -> sliceAnyElement -> per-sibling
// textWidthPx) on EVERY one of up to ~1200 anchorW steps, for every select —
// measured this round at 21 of 22 selects needing the sweep, 4501 total
// iterations, ~800ms of a ~810ms resolveContentBox total (profiled with
// console.time around the loop, reverted before commit). Hoisting the
// width-INDEPENDENT half to run ONCE per hop turns that into O(chain) once
// plus O(range) of only integer arithmetic, and cannot change which anchorW
// is picked as worst: `resolveHop` computes byte-for-byte the same values the
// old inline code computed for a given (el, sheets, html), in the same order,
// and the sweep still recomputes the two genuinely width-dependent pieces
// (columnCount's `width` argument; `mineHypo` in the claims-full-line branch,
// and the `alone` comparisons that read it) fresh on every step.
interface ResolvedHop {
  chromeX: number;
  grid: string | null;
  gap: number;
  isFlex: boolean;
  wraps: boolean;
  siblingW: number;
  gapsTotal: number;
  mineBasis: number | null;
  claimsFullLine: boolean;
  mineTextWidth: number;
  nextHypo: number;
}
function resolveHop(html: string, entry: { at: number }, el: RawEl, sheets: readonly string[]): ResolvedHop {
  const grid = declFor(el.attrs, "grid-template-columns", sheets);
  const gap = pxOr(declFor(el.attrs, "gap", sheets), 0);
  const isFlex = grid === null && (declFor(el.attrs, "display", sheets) ?? "").indexOf("flex") > -1;
  let wraps = false;
  let siblingW = 0;
  let gapsTotal = 0;
  let mineBasis: number | null = null;
  let claimsFullLine = false;
  let mineTextWidth = 0;
  let nextHypo = 0;
  if (isFlex) {
    const kids = topLevelChildren(sliceAnyElement(html, el.start), el.start);
    wraps = (declFor(el.attrs, "flex-wrap", sheets) ?? "nowrap") === "wrap";
    const mineIdx = kids.findIndex((k) => entry.at >= k.from && entry.at < k.to);
    const others = kids.filter((_k, n) => n !== mineIdx);
    for (const k of others) {
      const basis = flexBasisPx(k.attrs, sheets);
      const maxW = declFor(k.attrs, "max-width", sheets);
      const wAttr = attr(k.attrs, "width"); // svg/img chevrons and icons
      if (basis !== null) siblingW += basis;
      else if (maxW !== null && /px/.test(maxW)) siblingW += px(maxW);
      else if (wAttr !== null && /^\d+$/.test(wAttr)) siblingW += Number(wAttr) + chromeX(k.attrs, sheets);
      else siblingW += textWidthPx(visibleText(k.html), fontPxOf(k.attrs, sheets, 14)) + chromeX(k.attrs, sheets);
    }
    gapsTotal = gap * Math.max(0, kids.length - 1);
    // The line-break decision needs MY OWN hypothetical width too, not
    // just the siblings': a child declared width:100% (every .form-select)
    // already claims the whole line, which is exactly why the browser puts
    // it alone on one and gives it the full width — .lg-list-row measured
    // 292px of a 292px line, .lg-preset-apply-row 314 of 314. Comparing
    // siblings alone said "it shares", and under-stated both boxes by more
    // than half.
    const mineEl = mineIdx === -1 ? null : (kids[mineIdx] as { attrs: string; html: string });
    mineBasis = mineEl === null ? null : flexBasisPx(mineEl.attrs, sheets);
    claimsFullLine = mineEl !== null && (declFor(mineEl.attrs, "width", sheets) === "100%" || /class="[^"]*\bform-select\b/.test(mineEl.html) || mineEl.html.startsWith("<select"));
    mineTextWidth = textWidthPx(visibleText(mineEl?.html ?? ""), fontPxOf(mineEl?.attrs ?? "", sheets, 14));
    const nextOther = others.length > 0 ? (others[0] as { attrs: string; html: string }) : null;
    nextHypo = nextOther === null ? 0 : (flexBasisPx(nextOther.attrs, sheets) ?? textWidthPx(visibleText(nextOther.html), fontPxOf(nextOther.attrs, sheets, 14)) + chromeX(nextOther.attrs, sheets));
  }
  return { chromeX: chromeX(el.attrs, sheets), grid, gap, isFlex, wraps, siblingW, gapsTotal, mineBasis, claimsFullLine, mineTextWidth, nextHypo };
}

function resolveContentBox(html: string, entry: { select: ParsedSelect; chain: RawEl[]; at: number }, sheets: readonly string[]): BoxResult | null {
  let anchorIdx = -1;
  for (let i = entry.chain.length - 1; i >= 0; i -= 1) {
    const el = entry.chain[i] as RawEl;
    const min = declFor(el.attrs, "min-width", sheets);
    const max = declFor(el.attrs, "max-width", sheets);
    if ((min !== null && /px/.test(min)) || (max !== null && /px/.test(max)) || flexBasisPx(el.attrs, sheets) !== null) {
      anchorIdx = i;
      break;
    }
  }
  const selectMax = declFor(entry.select.attrs, "max-width", sheets);
  const selectChrome = chromeX(entry.select.attrs, sheets);
  // A select capped by its OWN max-width needs no ancestor: the cap IS the box
  // (its content is always wider than the cap, or it would not be capped).
  if (selectMax !== null && /px/.test(selectMax)) {
    return { content: px(selectMax) - selectChrome, at: px(selectMax), anchor: "own max-width" };
  }
  if (anchorIdx === -1) return null;

  const anchor = entry.chain[anchorIdx] as RawEl;
  const anchorMin = pxOr(declFor(anchor.attrs, "min-width", sheets), flexBasisPx(anchor.attrs, sheets) ?? 0);
  const anchorMax = pxOr(declFor(anchor.attrs, "max-width", sheets), Math.max(anchorMin, 1200));
  if (anchorMin <= 0) return null;

  const hops: ResolvedHop[] = [];
  for (let i = anchorIdx; i < entry.chain.length; i += 1) hops.push(resolveHop(html, entry, entry.chain[i] as RawEl, sheets));

  let worst: BoxResult | null = null;
  for (let anchorW = anchorMin; anchorW <= anchorMax; anchorW += 1) {
    let width = anchorW;
    for (const hop of hops) {
      width -= hop.chromeX;
      if (hop.grid !== null) {
        const cols = columnCount(hop.grid, width, hop.gap);
        width = (width - hop.gap * (cols - 1)) / cols;
        continue;
      }
      if (hop.isFlex) {
        const mineHypo = hop.mineBasis !== null ? hop.mineBasis : hop.claimsFullLine ? width : hop.mineTextWidth;
        const alone = hop.wraps && (mineHypo >= width || mineHypo + hop.gap + hop.nextHypo > width);
        width = alone ? width : width - hop.siblingW - hop.gapsTotal;
        continue;
      }
    }
    width -= selectChrome;
    if (worst === null || width < worst.content) worst = { content: width, at: anchorW, anchor: (attr(anchor.attrs, "id") ?? attr(anchor.attrs, "data-pin") ?? attr(anchor.attrs, "class") ?? anchor.tag) };
  }
  return worst;
}

// --- the string universe: SSR options + the island literals written in -----
// The real served script, sliced to the function body that resolves this
// select by id, then every string literal assigned to a `.textContent`.
// `literals` are product copy (they must FIT); `writesData` means the island
// also assigns something that is NOT a literal — an operator's own name — so
// no box can bound this control and it needs the reveal instead. The harvest
// is scoped to the enclosing function, which is deliberately conservative: it
// may attribute a sibling element's literal to this select, and that can only
// ever make the fit check stricter, never blinder.
function islandTextWrites(script: string, selectId: string): { literals: string[]; writesData: boolean } {
  const out: string[] = [];
  let writesData = false;
  for (const ref of script.matchAll(new RegExp(`['"]${selectId.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}['"]`, "g"))) {
    const fnAt = script.lastIndexOf("function", ref.index as number);
    if (fnAt === -1) continue;
    const bodyAt = script.indexOf("{", fnAt);
    let depth = 0;
    let end = bodyAt;
    for (let i = bodyAt; i < script.length; i += 1) {
      if (script[i] === "{") depth += 1;
      else if (script[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const body = script.slice(bodyAt, end);
    for (const w of body.matchAll(/\.(?:textContent|text|innerText)\s*=\s*([^;]+);/g)) {
      const rhs = w[1] as string;
      let stripped = rhs;
      for (const lit of rhs.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) {
        const raw = (lit[1] ?? lit[2]) as string;
        out.push(raw.replace(/\\u([0-9a-fA-F]{4})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))).replace(/\\'/g, "'"));
        stripped = stripped.replace(lit[0] as string, "");
      }
      // anything left after removing the literals is an expression: data.
      if (/[A-Za-z_$][\w$]*/.test(stripped.replace(/\b(?:true|false|null|undefined)\b/g, ""))) writesData = true;
    }
  }
  return { literals: [...new Set(out)], writesData };
}

// ===========================================================================
// N20 (rail half) — fresh (self-hosted) fonts first, legacy last, labelled
// ===========================================================================

describe("N20 — theme rail: fresh self-hosted fonts sort first, legacy (not self-hosted) sort last and say so", () => {
  it("Display font: all 8 self-hosted ids precede all 3 legacy ids; every id (fresh AND legacy) stays a selectable value", () => {
    const html = renderThemesTabPanel(true);
    const block = selectBlock(html, 'data-theme-key="typography.display"');
    for (const id of ["poppins", "space_grotesk", "fraunces", "playfair", "manrope", "dm_sans", "work_sans", "lexend"]) {
      expect(block, id).toContain(`value="${id}"`);
    }
    for (const id of ["literata", "sora", "system"]) {
      expect(block, id).toContain(`value="${id}"`);
    }
    expect(block).toContain(">Poppins<");
    // FIX ROUND F2: "(legacy)" was engineering jargon printed to a marketer
    // (jargon-scan.mjs's gate correctly rejected it) — re-pinned to the
    // plain-English outcome label. Strictness unchanged: still an exact
    // substring pin on the rendered <option> text, still asserting the same
    // fresh-first/unavailable-last ordering below.
    expect(block).toContain(">Literata (shows as default font)<");
    expect(block).toContain(">Sora (shows as default font)<");
    expect(block).toContain(">System (shows as default font)<");
    const lastFreshAt = block.indexOf(">Lexend<");
    const firstLegacyAt = block.indexOf("(shows as default font)");
    expect(lastFreshAt).toBeGreaterThan(-1);
    expect(firstLegacyAt).toBeGreaterThan(lastFreshAt);
  });

  it("Body font: the SAME ordering (one shared list, not a per-field re-derivation)", () => {
    const html = renderThemesTabPanel(true);
    const block = selectBlock(html, 'data-theme-key="typography.body"');
    expect(block.indexOf(">Manrope<")).toBeGreaterThan(-1);
    expect(block.indexOf("(shows as default font)")).toBeGreaterThan(block.indexOf(">Manrope<"));
  });
});

// ===========================================================================
// N11 — "Apply to this funnel" / "A/B this theme" are honest about presets
// (contract §4 R3 corollary). DRIVEN through the REAL served island script.
// ===========================================================================

// FIX ROUND F3 (MINOR-9) — the island no longer issues its OWN catalog GET
// (the reviewer measured 4x GET /api/admin/leadgen/themes on one tab load; the
// 4th was this island's). It now derives availability from the picker
// quotes-tabs/funnel.ts already fills. So the harness below gained two things:
//   - a REAL option list on #lg-theme-preset-select. Its BOOT state is the
//     select the REAL renderer emitted (parsed out of renderThemesTabPanel's
//     own markup, marker attribute included) — not a hand-typed stand-in — so
//     dropping data-lg-preset-ssr from the SSR breaks these tests;
//   - a pumpable window.setTimeout, because the island watches that select
//     instead of awaiting a promise.
// funnel.ts's populate step is the PRODUCER of the later states and is outside
// this slice's owned files; `repopulatePicker` below reproduces exactly the
// shape it was measured writing (one placeholder + one option per catalog
// item, funnel.ts:3940-3951) and is fed by the REAL catalog endpoint's REAL
// response through the REAL admin router — so the item COUNT that decides the
// state is never hand-invented (E11: the island side and the data side are
// both real; only funnel.ts's DOM-writing hop is simulated, and it is named).
// The zero-preset placeholder EXACTLY as quotes-tabs/funnel.ts writes it,
// harvested from the real exported island source and never re-typed, so this
// harness cannot drift from its producer.
function zeroStatePlaceholderLiteral(): string {
  const literals = islandTextWrites(QUOTE_EDITOR_SCRIPT, "lg-theme-preset-select").literals;
  const zero = literals.filter((t) => /^no .*preset/i.test(t));
  expect(zero.length, `funnel.ts must write exactly one zero-state placeholder literal; found ${JSON.stringify(literals)}`).toBe(1);
  return zero[0] as string;
}

interface MinimalIslandHandle {
  elementById(id: string): Record<string, unknown>;
  settle(): Promise<void>;
  pumpTimers(rounds?: number): Promise<void>;
  repopulatePicker(optionTexts: readonly string[]): void;
  fetchedUrls(): string[];
  pendingTimers(): number;
}

function bootThemesIslandMinimal(env: Env, withObserver = false): MinimalIslandHandle {
  const html = renderThemesTabPanel(true);
  const script = html.slice(html.lastIndexOf("<script>") + "<script>".length, html.lastIndexOf("</script>"));

  const pending: Array<Promise<unknown>> = [];
  const urls: string[] = [];
  const timers: Array<() => void> = [];
  const stableById: Record<string, Record<string, unknown>> = {};
  const el = (): Record<string, unknown> => ({
    textContent: "",
    className: "",
    style: {},
    firstChild: null,
    value: "",
    appendChild() {},
    removeChild() {},
    setAttribute() {},
    getAttribute: () => null,
    addEventListener() {},
    querySelectorAll: () => [],
    focus() {},
  });
  const option = (text: string, ssrMarker: boolean): Record<string, unknown> => ({
    textContent: text,
    value: "",
    getAttribute: (n: string) => (ssrMarker && n === "data-lg-preset-ssr" ? "1" : null),
  });

  // The picker's BOOT option list, read off the REAL emitted markup.
  const ssrPicker = parseSelects(html).find((s) => attr(s.attrs, "id") === "lg-theme-preset-select");
  expect(ssrPicker, "the real markup must carry #lg-theme-preset-select").toBeDefined();
  const pickerEl = el();
  pickerEl["options"] = (ssrPicker as ParsedSelect).options.map((o) => option(o.text, attr(o.attrs, "data-lg-preset-ssr") === "1"));
  stableById["lg-theme-preset-select"] = pickerEl;

  const root = { getAttribute: (n: string) => (n === "data-is-control" ? "true" : null), querySelectorAll: () => [] };
  const editorRoot = { getAttribute: () => null };
  const document = {
    querySelector(sel: string) {
      if (sel === "[data-lg-themes-tab]") return root;
      if (sel === "#lg-quote-editor") return editorRoot;
      return null;
    },
    getElementById(id: string) {
      if (stableById[id] === undefined) stableById[id] = el();
      return stableById[id]!;
    },
    createElement: () => el(),
    createTextNode: () => ({}),
    addEventListener() {},
  };
  const win = {
    setTimeout(fn: () => void) {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
  };
  const fetchShim = (url: string, init?: RequestInit): Promise<Response> => {
    urls.push(url);
    const p = Promise.resolve(admin.request(`http://localhost${url}`, init as RequestInit, env));
    pending.push(p);
    return p;
  };

  // F10 (MINOR-2/MINOR-5): the island now WATCHES the picker instead of
  // polling it, so the sandbox carries a real (minimal) MutationObserver whose
  // callbacks repopulatePicker() fires — the same childList churn
  // quotes-tabs/funnel.ts's clearChildren()+appendChild() produces on the real
  // page. Engines without it fall back to the timer, which the legs above
  // still exercise (this stub is only installed when `observed` is asked for).
  const observers: Array<{ target: unknown; cb: () => void }> = [];
  function MutationObserverStub(this: Record<string, unknown>, cb: () => void) {
    (this as { observe: (t: unknown) => void }).observe = (t: unknown) => {
      observers.push({ target: t, cb });
    };
  }
  runInNewContext(script, {
    document,
    window: win,
    fetch: fetchShim,
    MutationObserver: withObserver ? MutationObserverStub : undefined,
    JSON,
    Object,
    String,
    Boolean,
    Number,
  });

  return {
    elementById(id) {
      if (stableById[id] === undefined) stableById[id] = el();
      return stableById[id]!;
    },
    async settle() {
      for (let i = 0; i < 25; i += 1) {
        await Promise.allSettled(pending.slice());
        await new Promise((r) => setTimeout(r, 0));
      }
    },
    async pumpTimers(rounds = 3) {
      for (let i = 0; i < rounds; i += 1) {
        const due = timers.splice(0, timers.length);
        for (const fn of due) fn();
        await new Promise((r) => setTimeout(r, 0));
      }
    },
    repopulatePicker(optionTexts) {
      pickerEl["options"] = optionTexts.map((t) => option(t, false));
      for (const o of observers) {
        if (o.target === pickerEl) o.cb();
      }
    },
    fetchedUrls() {
      return urls.slice();
    },
    pendingTimers() {
      return timers.length;
    },
  };
}

describeDb("N11 — zero presets: both actions render disabled, and stay disabled once confirmed", () => {
  it("SSR default already agrees (disabled + neutral copy) before anything resolves", () => {
    const html = renderThemesTabPanel(true);
    expect(html).toContain('id="lg-theme-preset-apply" disabled');
    expect(html).toContain('id="lg-theme-ab-this" disabled');
    expect(html).toContain('id="lg-theme-preset-help">Checking for saved presets');
    // …and the picker's SSR placeholder carries the marker that lets the
    // island tell "not loaded yet" from "loaded, and empty" WITHOUT a request.
    expect(html).toContain('<option value="" data-lg-preset-ssr="1">');
  });

  it("EXECUTED: an unresolved picker (the SSR marker still present) never reads as ready — fail closed", async () => {
    const { env } = newHarness();
    const island = bootThemesIslandMinimal(env);
    await island.settle();
    await island.pumpTimers(2);
    expect(island.elementById("lg-theme-preset-apply")["disabled"]).not.toBe(false);
    expect(island.elementById("lg-theme-ab-this")["disabled"]).not.toBe(false);
  });

  it("EXECUTED: with the REAL catalog confirmed EMPTY, the buttons stay disabled, the reason is ON SCREEN (not only in a title), and the help line is flagged", async () => {
    const { env } = newHarness();
    const list = await json<{ items: unknown[] }>(await admin.request(`${API}/themes`, jsonInit("GET"), env), "real catalog (empty)");
    expect(list.items.length).toBe(0);

    const island = bootThemesIslandMinimal(env);
    await island.settle();
    // funnel.ts's own zero-state shape, READ OUT of the real served island
    // rather than re-typed here (F10: a hand-typed copy of the producer's
    // string is the E11 "both sides hand-built" trap, and it is exactly what
    // went stale the moment BLOCKER-1's fix shortened that literal).
    island.repopulatePicker([zeroStatePlaceholderLiteral()]);
    await island.pumpTimers(2);

    const applyBtn = island.elementById("lg-theme-preset-apply");
    const abBtn = island.elementById("lg-theme-ab-this");
    const helpEl = island.elementById("lg-theme-preset-help");
    expect(applyBtn["disabled"]).toBe(true);
    expect(abBtn["disabled"]).toBe(true);
    expect(String(helpEl["textContent"])).toContain("No presets saved yet");
    expect(String(applyBtn["title"])).toContain("No presets saved yet");
    // MAJOR-2: the reason is on the page, carried by a class that paints it.
    expect(String(helpEl["className"])).toContain("lg-preset-help-blocked");
  });
});

// ---------------------------------------------------------------------------
// MINOR-2 + MINOR-5 (review-p8-3b) — THE FAILED STATE IS RECOVERABLE, AND THE
// POLL IS BOUNDED. FAIL-BEFORE (source-confirmed by the reviewer):
// refreshPresetAvailability called applyPresetState('failed') after
// PRESET_UNKNOWN_LIMIT (25) x PRESET_TICK_MS (400ms) = 10s and RETURNED
// WITHOUT RESCHEDULING, so a catalog that resolved at 10.1s left both buttons
// dead beside a populated picker for the life of the page; and in every other
// state it re-armed a 400ms timer forever. Both legs below are EXECUTED
// against the REAL served island in the vm sandbox.
// ---------------------------------------------------------------------------
describeDb("MINOR-2/MINOR-5 — a late catalog recovers the dead state, and the settled island keeps no timer", () => {
  it("EXECUTED: after the 10s unknown window has latched 'failed', a picker that fills LATER re-enables both actions", async () => {
    const { env } = newHarness();
    const island = bootThemesIslandMinimal(env, true);
    await island.settle();
    // burn past PRESET_UNKNOWN_LIMIT while the picker still shows the SSR
    // marker: the island gives up and says so.
    await island.pumpTimers(30);
    expect(String(island.elementById("lg-theme-preset-help")["textContent"])).toContain("Could not check");
    expect(island.elementById("lg-theme-preset-apply")["disabled"]).toBe(true);
    expect(island.pendingTimers(), "the failed state must not keep re-arming the fast tick").toBe(0);

    // …then the slow catalog lands and funnel.ts fills the picker.
    island.repopulatePicker(["Choose a preset…", "Arrived Late Preset"]);
    expect(island.elementById("lg-theme-preset-apply")["disabled"], "a late catalog must un-stick the buttons").toBe(false);
    expect(island.elementById("lg-theme-ab-this")["disabled"]).toBe(false);
    expect(String(island.elementById("lg-theme-preset-help")["textContent"])).not.toContain("Could not check");
  });

  it("EXECUTED: once the state is settled the island holds NO pending timer at all — the watcher replaced the poll", async () => {
    const { env } = newHarness();
    const island = bootThemesIslandMinimal(env, true);
    await island.settle();
    island.repopulatePicker(["Choose a preset…", "Ready Preset"]);
    await island.pumpTimers(3);
    expect(island.elementById("lg-theme-preset-apply")["disabled"]).toBe(false);
    expect(island.pendingTimers(), "a settled island must not keep polling every 400ms").toBe(0);
  });
});

describeDb("N11 — at least one preset: both actions become available and the copy reverts to the original", () => {
  it("EXECUTED: with the REAL catalog non-empty, the buttons enable, the blocked flag is cleared and the help text is the pre-existing wording (byte-identical to before this fix)", async () => {
    const { env } = newHarness();
    await json<ThemeCreateResponse>(await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Ready Preset", "Inter", "Inter")), env), "create preset");
    const list = await json<{ items: Array<{ name: string }> }>(await admin.request(`${API}/themes`, jsonInit("GET"), env), "real catalog (1 preset)");
    expect(list.items.length).toBe(1);

    const island = bootThemesIslandMinimal(env);
    await island.settle();
    island.repopulatePicker(["Choose a preset…", ...list.items.map((i) => i.name)]);
    await island.pumpTimers(2);

    const applyBtn = island.elementById("lg-theme-preset-apply");
    const abBtn = island.elementById("lg-theme-ab-this");
    const helpEl = island.elementById("lg-theme-preset-help");
    expect(applyBtn["disabled"]).toBe(false);
    expect(abBtn["disabled"]).toBe(false);
    expect(String(helpEl["textContent"])).toBe(
      "Save the current look as a reusable preset from the Themes manager, then apply or delete any preset there. Presets are shared across every funnel.",
    );
    expect(String(helpEl["className"])).not.toContain("lg-preset-help-blocked");
    expect(String(abBtn["title"])).toContain("Fork this variant with the picked preset");
  });
});

// ---------------------------------------------------------------------------
// MINOR-9 — this island must not add a catalog read of its own.
// ---------------------------------------------------------------------------
describeDb("MINOR-9 — the Themes tab island issues ZERO GET /api/admin/leadgen/themes of its own", () => {
  it("EXECUTED: across boot and both preset states, the island's own request log contains no catalog read", async () => {
    const { env } = newHarness();
    await json<ThemeCreateResponse>(await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Counted Preset", "Inter", "Inter")), env), "create preset");
    const island = bootThemesIslandMinimal(env);
    await island.settle();
    island.repopulatePicker(["Choose a preset…", "Counted Preset"]);
    await island.pumpTimers(3);
    await island.settle();

    const catalogReads = island.fetchedUrls().filter((u) => u === "/api/admin/leadgen/themes" || u.startsWith("/api/admin/leadgen/themes?"));
    expect(catalogReads.length, `island fetched: ${JSON.stringify(island.fetchedUrls())}`).toBe(0);
    // …and the availability it shows is still correct, so the count above is
    // not "zero because the feature stopped working".
    expect(island.elementById("lg-theme-preset-apply")["disabled"]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MAJOR-2 — "disabled" must be VISIBLE, not just a property. Measured
// FAIL-BEFORE (reviewer, both states, 1280 and 375): colour, background,
// border, opacity, filter and text-decoration were IDENTICAL between enabled
// and disabled, and cursor read `pointer` in BOTH.
// ---------------------------------------------------------------------------
describe("MAJOR-2 — the disabled preset actions are painted as unavailable by the real sheets", () => {
  // Resolved INSIDE each test on purpose: deleting the rule must show up as a
  // red assertion naming the missing selector, never as a collection crash
  // that reports "no tests".
  const base = (): string => styleRule(ADMIN_STYLES, ".btn");
  const off = (): string => styleRule(LG_QUOTES_STYLES, ".lg-preset-apply-row .btn:disabled");

  it("the base .btn really is the enabled look this compares against (cursor:pointer, no disabled state of its own)", () => {
    expect(decl(base(), "cursor")).toBe("pointer");
    expect(() => styleRule(ADMIN_STYLES, ".btn:disabled")).toThrow();
  });

  for (const prop of ["background", "border-color", "color", "opacity", "cursor", "box-shadow"]) {
    it(`the disabled rule declares "${prop}"`, () => {
      expect(decl(off(), prop).length).toBeGreaterThan(0);
    });
  }

  it("cursor differs from the enabled state (the single property the reviewer called out by name)", () => {
    expect(decl(off(), "cursor")).not.toBe(decl(base(), "cursor"));
    expect(decl(off(), "cursor")).toBe("not-allowed");
  });

  it("the on-screen reason has a rule that actually paints it (colour + background + border), so it reads as a blocked state at a glance", () => {
    const blocked = styleRule(LG_QUOTES_STYLES, ".lg-preset-help-blocked");
    for (const prop of ["color", "background", "border"]) expect(decl(blocked, prop).length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// N20 (manager half) — the standalone Themes manager offers the SAME 8-family
// fresh vocabulary as the rail, legacy sorted last; a legacy value already
// stored stays selected and rendered, byte-identical.
// ===========================================================================

function fontSelectBlockById(html: string, id: string): string {
  const marker = `id="${id}"`;
  const at = html.indexOf(marker);
  expect(at, `select#${id}`).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<select", at);
  const end = html.indexOf("</select>", at) + "</select>".length;
  return html.slice(start, end);
}

describeDb("N20 — Themes manager: fresh-first ordering, legacy labelled and still selectable", () => {
  // FIX ROUND F2: "(legacy)" was engineering jargon printed to a marketer
  // (jargon-scan.mjs's gate correctly rejected it) — every pin below is
  // re-minted to the plain-English outcome label at the SAME strictness
  // (exact substring match on the rendered <option> text; same selected/
  // ordering claims).
  // FIX ROUND F13 (BLOCKER-2) — SAME CLAIM, MEASURED PLACE. This leg used to
  // pin the qualifier INSIDE the option text (">Newsreader (shows as default
  // font)<"). That pin is what kept N7's own defect on screen: these two
  // selects paint in the family they name, and in the monospace stack the
  // string is 294px in a 282px box (driven, +12px at 1280 AND 375, title=null
  // at load and after document.fonts.ready, the `)` cut). The CLAIM is
  // unchanged and is asserted at FULL strength below — the stored family stays
  // selected, sorted after the fresh eight, and the operator is still told the
  // family is not served, in the SAME WORDS — but the words are now where they
  // cannot be clipped: the <optgroup> heading the dropdown shows over that
  // family, and the caption under the control. Both are read out of the REAL
  // served page, and the leg after this one holds the old label against the
  // real box so the regression can never come back unnoticed.
  it("a preset storing a NOT-SERVED font (Newsreader) keeps it SELECTED, sorted after the fresh choices, and still tells the operator it shows as the default font", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Legacy Font Preset", "Newsreader", "Roboto Mono")), env),
      "create legacy-font preset",
    );
    const { html } = await getHtml(env, `/admin/leadgen/themes?theme=${created.item.id}`);
    const headlineBlock = fontSelectBlockById(html, "tm-headline-font");
    expect(headlineBlock).toContain('value="Newsreader" selected');
    // the option text is the family, and ONLY the family — nothing the box
    // cannot show.
    expect(headlineBlock).toContain(">Newsreader<");
    expect(headlineBlock, "the suffix must not be back on the option text").not.toContain("(shows as default font)");
    // …the qualifier is carried ONCE, as the heading of the group that holds
    // the not-served families, and the stored family is inside that group.
    const group = headlineBlock.slice(headlineBlock.indexOf("<optgroup"), headlineBlock.indexOf("</optgroup>"));
    expect(group, "the not-served group must be present when one is stored").toContain('label="Shows as default font"');
    expect(group).toContain('value="Newsreader" selected');
    expect(group).toContain('value="Inter"');
    expect(group).toContain('value="Roboto Mono"');
    // …and again under the control, where an operator who never opens the
    // dropdown still reads it.
    expect(html).toContain('data-tm-font-note="tm-headline-font"');
    expect(html.slice(html.indexOf('data-tm-font-note="tm-headline-font"'))).toContain(">Shows as default font<");
    // fresh-first: a self-hosted family's option index precedes the group.
    expect(headlineBlock.indexOf(">Poppins<")).toBeGreaterThan(-1);
    expect(headlineBlock.indexOf(">Poppins<")).toBeLessThan(headlineBlock.indexOf("<optgroup"));

    const bodyBlock = fontSelectBlockById(html, "tm-body-font");
    expect(bodyBlock).toContain('value="Roboto Mono" selected');
    expect(bodyBlock).toContain(">Roboto Mono<");
    expect(bodyBlock).not.toContain("(shows as default font)");
    expect(bodyBlock.slice(bodyBlock.indexOf("<optgroup"))).toContain('label="Shows as default font"');
    expect(html).toContain('data-tm-font-note="tm-body-font"');
  });

  it("EXECUTED (BLOCKER-2 fail-before, bottled): the OLD suffixed label does not fit the manager's REAL box in the family it names, and the NEW label does", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Clip Fail Before Preset", "Roboto Mono", "Roboto Mono")), env),
      "create preset",
    );
    const covered = await coveredSelects(env, created.item.id);
    const headline = covered.find((c) => c.key === "tm-headline-font") as CoveredSelect;
    expect(headline.box, "the manager font select must still resolve a box").not.toBeNull();
    const box = (headline.box as BoxResult).content;
    // The family axis found it: the manager paints this control in the family
    // it names, so it is measured in the widest metric it can take.
    expect(headline.familyMovesWithData, "the two real renders must declare different families").toBe(true);
    expect(headline.bucket).toBe("mono");
    // FAIL-BEFORE: F2's label, through the SAME arithmetic, over the SAME box.
    const oldLabel = "Roboto Mono (shows as default font)";
    expect(textWidthPx(oldLabel, headline.fontPx, headline.bucket)).toBeGreaterThan(box);
    // PASS-AFTER: every string this control really carries now fits.
    for (const text of headline.strings) {
      expect(textWidthPx(text, headline.fontPx, headline.bucket), `${text} vs ${box.toFixed(2)}px`).toBeLessThanOrEqual(box);
    }
    expect(headline.strings).toContain("Roboto Mono");
    expect(headline.strings.some((s) => s.includes("shows as default font"))).toBe(false);
  }, HEAVY_LEG_TIMEOUT_MS);

  it("a preset storing a FRESH self-hosted font (Poppins/Lexend) keeps it SELECTED with NO legacy suffix, and renders the SAME 8 words the rail offers", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Fresh Font Preset", "Poppins", "Lexend")), env),
      "create fresh-font preset",
    );
    const { html } = await getHtml(env, `/admin/leadgen/themes?theme=${created.item.id}`);
    const headlineBlock = fontSelectBlockById(html, "tm-headline-font");
    expect(headlineBlock).toContain('value="Poppins" selected');
    expect(headlineBlock).not.toContain("Poppins (shows as default font)");
    for (const name of ["Space Grotesk", "Fraunces", "Playfair Display", "Manrope", "DM Sans", "Work Sans", "Lexend"]) {
      expect(headlineBlock, name).toContain(name);
    }
    const bodyBlock = fontSelectBlockById(html, "tm-body-font");
    expect(bodyBlock).toContain('value="Lexend" selected');
    expect(bodyBlock).not.toContain("Lexend (shows as default font)");
  });
});

// ===========================================================================
// FIX ROUND F3 additions
// ===========================================================================

// The font selects the manager renders, parsed out of the REAL page.
function managerFontSelects(html: string): ParsedSelect[] {
  const wanted = ["tm-headline-font", "tm-body-font"];
  const found = parseSelects(html).filter((s) => wanted.includes(attr(s.attrs, "id") ?? ""));
  expect(found.length, "both manager font selects must be in the real page").toBe(2);
  return found;
}
// A control's OFFERED vocabulary = the options a human can actually pick:
// everything that is not hidden and not the blank "inherit" placeholder.
function offeredTexts(select: ParsedSelect): string[] {
  return select.options.filter((o) => !o.hidden && o.value !== "").map((o) => o.text);
}

// ===========================================================================
// N7 — THE CLIP INVARIANT, EXECUTED over all three surfaces at once.
// (Machinery + the coverage statement are at the top of the N7 section.)
// ===========================================================================

// A select this enumeration finds but cannot place a box around. Every entry
// carries the reason IN FILE; the leg below FAILS if an entry ever becomes
// resolvable, so this can never quietly become a parking lot.
const OUT_OF_COVERAGE: ReadonlyArray<{ id: string; reason: string }> = [
  {
    id: "lg-site-select",
    reason:
      "the quote-editor page header's site picker (ui-quotes.ts:730, a file this slice does not own; it is on the board surface, not inside either enumerated one). It sits in a .lg-chip inside .lg-editor-head, a wrapping row whose width is the admin content box, which no declaration in any owned file pins — there is no honest anchor to resolve from. DATA-BEARING (operator site names), so the clip reveal covers it. Driven: widest entry -33.84px at 1280 (fits) and +2.47px at 375, which the element's own scrollWidth reports as no overflow at all, so the reveal correctly stays silent.",
  },
  {
    id: "lg-tpl-target-select",
    reason:
      "the Templates tab's funnel picker (quotes-tabs/templates.ts:894). Not this slice's file and not one of the three covered surfaces. Measured +283.77px with operator funnel names; data-bearing, so the page-global clip reveal covers it — driven after this round it reports title='R2C3 Bravo Extremely Long Funnel Column Name…' and text-overflow:ellipsis. Reported to the conductor as an adjacent surface, not silently absorbed.",
  },
  {
    id: "lg-tpl-section-select",
    reason:
      "the Templates tab's section picker (quotes-tabs/templates.ts:862). Same file, same reason; measured +305.80px with operator section names and likewise closed by the page-global reveal.",
  },
  {
    id: "lg-tpl-theme-select",
    reason: "the Templates tab's theme switcher (quotes-tabs/templates.ts:858). Not owned, not a covered surface; driven -68.86px (fits).",
  },
  {
    id: "lg-tpl-site-select",
    reason: "the Templates tab's site picker (quotes-tabs/templates.ts:865). Not owned, not a covered surface; driven -3.22px (fits) and data-bearing, so the reveal covers the unbounded case.",
  },
];

interface CoveredSelect {
  surface: string;
  key: string;
  select: ParsedSelect;
  box: BoxResult | null;
  strings: string[];
  dataBearing: boolean;
  fontPx: number;
  // F13 (MAJOR-1): which font metric this control's text is really laid out
  // in, MEASURED from the real declaration on both renders — not listed.
  bucket: FontBucket;
  familyMovesWithData: boolean;
}

async function coveredSelects(
  env: Env,
  themeId: string,
  // F12: the sheet set is a parameter ONLY so the mutation leg below can feed
  // the reverted grid rule and prove this arithmetic still fails for the
  // regression it claims to catch. Every caller but that one passes the real
  // sheets, and the default IS the real pair.
  sheets: readonly string[] = [LG_QUOTES_STYLES, ADMIN_STYLES],
): Promise<CoveredSelect[]> {
  const siteA: PreviewSiteOption[] = [
    { site_id: "s1", site_name: "R2Fix Fixture Site", badge: "Active" },
    { site_id: "s2", site_name: "Seed Local Living", badge: "Not activated yet" },
  ];
  const siteB: PreviewSiteOption[] = [
    { site_id: "s1", site_name: "Zzz Other Site", badge: "Active" },
    { site_id: "s2", site_name: "Another Longer Site Name Entirely", badge: "Not activated yet" },
  ];
  // The islands as SERVED, never re-typed: every <script> body the surface
  // itself emits, plus (for the Themes tab, which is mounted inside the quote
  // editor) that page's own script — the one that fills the preset picker.
  const scriptsOf = (html: string): string => [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1] as string).join("\n");
  const railA = renderThemesTabPanel(true, siteA);
  const managerHtml = (await getHtml(env, `/admin/leadgen/themes?theme=${themeId}`)).html;
  // FIX ROUND F13 — S2's differential is a REAL second data set now. F10/F12
  // rendered the manager page against ITSELF (alt === html), which the
  // retirement ledger disclosed as a residual: with one render, neither the
  // data axis nor the family axis can move, so both were answered by default.
  // The alt render is a SECOND theme created through the REAL POST route,
  // storing two VENDORED families — so the manager's font selects paint in a
  // different stack in the two renders, which is exactly how the family axis
  // below discovers that it is data-driven.
  const altTheme = await json<ThemeCreateResponse>(
    await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Clip Invariant Alt Preset", "Poppins", "Lexend")), env),
    "create alt preset",
  );
  const managerAltHtml = (await getHtml(env, `/admin/leadgen/themes?theme=${altTheme.item.id}`)).html;

  const surfaces: Array<{ name: string; html: string; alt: string; script: string; fallbackFont: number }> = [
    {
      name: "S1 Themes tab (renderThemesTabPanel)",
      html: railA,
      alt: renderThemesTabPanel(true, siteB),
      script: scriptsOf(railA) + "\n" + QUOTE_EDITOR_SCRIPT,
      fallbackFont: px(decl(styleRule(ADMIN_STYLES, ".form-select"), "font-size")),
    },
    {
      name: "S2 Themes manager (/admin/leadgen/themes)",
      html: managerHtml,
      alt: managerAltHtml,
      script: scriptsOf(managerHtml),
      fallbackFont: 14,
    },
  ];

  const out: CoveredSelect[] = [];
  for (const surface of surfaces) {
    const keyOf = (attrs: string): string => attr(attrs, "id") ?? attr(attrs, "data-theme-key") ?? "";
    const altById = new Map(selectsWithChain(surface.alt).map((e) => [keyOf(e.select.attrs), e.select.options.map((o) => o.text).join(" ")]));
    const altFamilyById = new Map(selectsWithChain(surface.alt).map((e) => [keyOf(e.select.attrs), declFor(e.select.attrs, "font-family", sheets)]));
    for (const entry of selectsWithChain(surface.html)) {
      const id = attr(entry.select.attrs, "id") ?? "";
      const key = id !== "" ? id : (attr(entry.select.attrs, "data-theme-key") ?? "(unkeyed)");
      const ssrTexts = entry.select.options.map((o) => o.text);
      const island = id === "" ? { literals: [] as string[], writesData: false } : islandTextWrites(surface.script, id);
      // DATA-BEARING is MEASURED, never listed: either the SAME renderer with
      // DIFFERENT real data produced different option texts, or the real
      // island assigns a non-literal (an operator's own name) into it.
      const dataBearing = altById.get(key) !== ssrTexts.join(" ") || island.writesData;
      // F13 (MAJOR-1): the FONT the text is laid out in, on the same terms as
      // the data axis — from the real declaration on both renders. If the two
      // real renders declare different families for the same control, its
      // metric follows the operator's data, so it is checked in the widest
      // bucket the model knows rather than in whichever family this fixture
      // happened to store.
      const family = declFor(entry.select.attrs, "font-family", sheets);
      const familyMovesWithData = altFamilyById.has(key) && altFamilyById.get(key) !== family;
      out.push({
        surface: surface.name,
        key,
        select: entry.select,
        box: resolveContentBox(surface.html, entry, sheets),
        // The product-authored universe: SSR options that do NOT move with the
        // data, plus every literal the real island writes into this select.
        strings: [...new Set([...(dataBearing ? [] : ssrTexts), ...island.literals])],
        dataBearing,
        fontPx: pxOr(declFor(entry.select.attrs, "font-size", sheets), surface.fallbackFont),
        bucket: familyMovesWithData ? WIDEST_BUCKET : bucketOf(family),
        familyMovesWithData,
      });
    }
  }
  return out;
}

describeDb("N7 CLIP INVARIANT — every select on the covered surfaces shows its own product text in full", () => {
  it("EXECUTED: the enumeration reaches the whole surface set, and every select is either boxed or named out of coverage", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Clip Invariant Preset", "Newsreader", "Roboto Mono")), env),
      "create preset",
    );
    const all = await coveredSelects(env, created.item.id);

    // The enumeration is real: the two surfaces together render the 16 rail
    // scalars + the 4 other Themes-tab selects + the 2 manager font selects.
    expect(all.length, all.map((c) => c.key).join(", ")).toBe(22);
    expect(all.filter((c) => c.key.startsWith("typography.") || c.key.startsWith("scales.") || c.key.startsWith("button_defaults.") || c.key.startsWith("card_defaults.") || c.key.startsWith("field_defaults.")).length).toBe(16);
    for (const id of ["lg-theme-target-select", "lg-theme-site-select", "lg-theme-hex-role", "lg-theme-preset-select", "tm-headline-font", "tm-body-font"]) {
      expect(all.some((c) => c.key === id), `the enumeration missed ${id}`).toBe(true);
    }

    const unplaced = all.filter((c) => c.box === null).map((c) => `${c.key} (${c.surface})`);
    const excused = new Set(OUT_OF_COVERAGE.map((o) => o.id));
    expect(
      unplaced.filter((u) => !excused.has(u.split(" ")[0] as string)),
      "a select on a covered surface has no resolvable box: give it one, or add it to OUT_OF_COVERAGE with a written reason",
    ).toEqual([]);
  }, HEAVY_LEG_TIMEOUT_MS);

  it("EXECUTED: no product-authored string is wider than the box that shows it, at the narrowest width its layout can take", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Clip Invariant Preset", "Newsreader", "Roboto Mono")), env),
      "create preset",
    );
    const all = await coveredSelects(env, created.item.id);

    const overflowing: string[] = [];
    let checked = 0;
    for (const c of all) {
      if (c.box === null) continue;
      for (const text of c.strings) {
        checked += 1;
        const w = textWidthPx(text, c.fontPx, c.bucket);
        if (w > c.box.content) {
          overflowing.push(`${c.key}: "${text}" ${w.toFixed(2)}px [${c.bucket}] > ${c.box.content.toFixed(2)}px (anchor ${c.box.anchor} at ${c.box.at}px, ${c.surface})`);
        }
      }
    }
    // THE INVARIANT, first, so a regression's own message is the one that
    // names the offending string, its width and its box.
    expect(overflowing).toEqual([]);
    // …and it was not vacuous. The enumeration is not hollow and nothing was
    // skipped in silence: the number of strings measured IS the number the
    // covered selects carry (a floor of 100 so an empty universe cannot pass),
    // and both halves really came from the real artifacts — the rail's SSR
    // options AND funnel.ts's island literals for the picker.
    const boxed = all.filter((c) => c.box !== null);
    expect(boxed.length).toBe(all.length);
    expect(checked).toBe(boxed.reduce((n, c) => n + c.strings.length, 0));
    expect(checked).toBeGreaterThanOrEqual(100);
    const picker = all.find((c) => c.key === "lg-theme-preset-select") as CoveredSelect;
    expect(picker.strings, "funnel.ts's zero-state literal must reach this check").toContain("No presets yet");
    expect(picker.strings).toContain("Choose a preset…");
  }, HEAVY_LEG_TIMEOUT_MS);

  // FIX ROUND F14 (review-p8-3d MINOR-1) — the box arithmetic is only ever
  // applied inside the repertoire the model was calibrated on. The leg above
  // compares a MODELLED width against a real box; a string built from glyphs
  // the model has no class for is modelled 1.1x..1.6x too NARROW (measured, see
  // the CALIBRATION comment), so a green box result for such a string would be
  // exactly the "green over a clipped control" failure this phase keeps
  // hitting. This does not widen the model and does not block anything in the
  // product: it fails the TEST the day an offered string leaves the calibrated
  // repertoire, which is the day the model needs re-measuring.
  it("EXECUTED: every string the box arithmetic measures is inside the calibrated character repertoire", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Clip Invariant Preset", "Newsreader", "Roboto Mono")), env),
      "create preset",
    );
    const all = await coveredSelects(env, created.item.id);
    const outside: string[] = [];
    let checked = 0;
    for (const c of all) {
      if (c.box === null) continue;
      for (const text of c.strings) {
        checked += 1;
        const bad = unmodelledCharacters(text);
        if (bad.length > 0) outside.push(`${c.key}: "${text}" uses ${bad.map((ch) => `${ch} (U+${(ch.codePointAt(0) as number).toString(16).toUpperCase()})`).join(", ")}`);
      }
    }
    expect(outside, "re-measure the width model against these glyphs before trusting a box result for them").toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(100);
    // …and the check is not vacuous: the same function does reject the glyphs
    // the browser measured this round as under-stated.
    expect(unmodelledCharacters("100% match")).toEqual(["%"]);
    expect(unmodelledCharacters("Ärger")).toEqual(["Ä"]);
  }, HEAVY_LEG_TIMEOUT_MS);

  it("EXECUTED: every select that can hold OPERATOR data is covered by the clip reveal, and the reveal is on the page that renders it", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Clip Invariant Preset", "Newsreader", "Roboto Mono")), env),
      "create preset",
    );
    const all = await coveredSelects(env, created.item.id);
    // Detected by re-rendering the SAME surface with DIFFERENT real data —
    // never by a list of "the ones I think take names".
    const bearing = all.filter((c) => c.dataBearing).map((c) => c.key);
    expect(bearing, "the differential render must catch the site picker").toContain("lg-theme-site-select");
    for (const key of bearing) {
      expect(OUT_OF_COVERAGE.some((o) => o.id === key) || all.find((c) => c.key === key)?.box !== null, `${key} is data-bearing and unplaced`).toBe(true);
    }
    // …and the mechanism that covers them is served on the real page.
    const { html } = await getHtml(env, `/admin/leadgen/themes?theme=${created.item.id}`);
    expect(html).toContain("function lgRevealClippedSelect(");
    expect(html).toContain("sel.scrollWidth > sel.clientWidth");
  }, HEAVY_LEG_TIMEOUT_MS);

  it("the OUT_OF_COVERAGE list is honest: every excused select is really unplaceable or really outside the covered surfaces", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Clip Invariant Preset", "Newsreader", "Roboto Mono")), env),
      "create preset",
    );
    const all = await coveredSelects(env, created.item.id);
    for (const row of OUT_OF_COVERAGE) {
      expect(row.reason.length, `${row.id} needs a written reason`).toBeGreaterThan(80);
      const hit = all.find((c) => c.key === row.id);
      // Stale-residual leg: an excused id that this enumeration now places
      // must be REMOVED from the list, not left standing.
      expect(hit === undefined || hit.box === null, `${row.id} is now resolvable — delete its OUT_OF_COVERAGE row`).toBe(true);
    }
  }, HEAVY_LEG_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// THE CLIP REVEAL, EXECUTED — the REAL served LG_CLIP_REVEAL_SCRIPT bytes run
// in a node:vm against a select whose painted box is the one THIS FILE
// computes from the real declarations, so neither side of the boundary is
// hand-built: the script is the real artifact, the overflow condition is the
// real arithmetic.
//
// FIX ROUND F13 — WHY THE OLD HARNESS COULD NOT FAIL FOR THE CASE THAT
// MATTERED, AND WHAT REPLACES IT. F10/F12's `runReveal` gave the sandbox a
// select whose `scrollWidth` was a FIXED NUMBER. The code under test writes
// `style.textOverflow`, and on a plain object that write can never feed back
// into `scrollWidth` — so all four "EXECUTED" legs were green while the real
// browser oscillated: in chromium, `text-overflow: ellipsis` on a <select>
// collapses scrollWidth to clientWidth, so the very next event read "it fits"
// and stripped the title while the text was still clipped (driven fail-before
// on #tm-headline-font, identical at 1280 and 375: 294/282 title=null ->
// 282/282 title set -> 294/282 title NULL -> 282/282 title set). That is the
// E10/E11 shape — both sides of the boundary hand-built — inside the very
// block written to stop false greens.
// THE HARNESS NOW MODELS THE FEEDBACK LOOP the browser really has:
// `scrollWidth` is a GETTER over the element's own style bag — natural width
// while text-overflow is anything but `ellipsis`, collapsed to clientWidth
// while it is `ellipsis` — which is chromium's measured behaviour, reproduced
// from the numbers above. The code under test can therefore perturb its own
// measurement exactly as it does in the product, and the F12 predicate FAILS
// these legs — verified by hand this round by putting `return sel.scrollWidth
// > sel.clientWidth;` back as the whole of lgOverflows and re-running this
// block: "Tests 1 failed | 8 passed", the failure being "sweep 1 changed the
// state: expected { title: null, clipped: null, …(1) } to deeply equal
// { …(3) }". The natural width is not a magic number either: it is textWidthPx
// over the real option string in the real bucket.
// WHAT THE LANE STILL CANNOT DO, stated plainly: node has no layout engine
// (vitest environment "node", no jsdom, no-new-deps), so this models
// chromium's rule rather than executing it. The proof that the rule is what
// chromium does, and that the product is now stable under real hovers, is the
// DRIVE (E6/E10) — 13 consecutive readings on /admin/leadgen/offers at 375
// (load + 6 sweeps + 6 interleaved change/focusin/mouseover) all reporting
// title="All providers", data-lg-clipped=1, text-overflow:ellipsis, plus 4
// real mouse hovers with the same result.
// ---------------------------------------------------------------------------
interface RevealHarness {
  attrs: Record<string, string>;
  style: Record<string, string>;
  sel: { clientWidth: number; scrollWidth: number; options: Array<{ textContent: string }>; naturalWidth: number };
  win: Record<string, unknown>;
  listeners: Record<string, (e: unknown) => void>;
  winListeners: Record<string, (e: unknown) => void>;
  observers: Array<{ options: Record<string, boolean>; cb: (records: unknown[]) => void }>;
  fontsReady: () => Promise<void>;
  state: () => { title: string | null; clipped: string | null; textOverflow: string };
  // FIX ROUND F14 — the element's whole attribute map IN ORDER. JS objects keep
  // string keys in insertion order, so this is the node-lane stand-in for
  // `outerHTML`: it moves if a value changes, if an attribute is added or
  // removed, AND if an attribute is removed and re-added (which in a browser
  // moves it to the end of the tag). Its real-browser counterpart is the driven
  // outerHTML comparison quoted in clip-reveal.ts's F14 block.
  snapshot: () => string;
}

// A select that measures like the browser: the painted text is `optionText` in
// the real width model, and an applied ellipsis hides the overflow from
// scrollWidth exactly as chromium does. `authorTitle` is a tooltip THE PRODUCT
// rendered before this script ever ran (ui-section-studio.ts:15594 / :2601 are
// the two real ones); it is written into the attribute map first, exactly as
// the markup does.
function revealHarness(clientW: number, optionText: string, bucket: FontBucket = "sans", fontPx = 14, authorTitle: string | null = null): RevealHarness {
  const attrs: Record<string, string> = {};
  if (authorTitle !== null) attrs["title"] = authorTitle;
  // The inline style REFLECTS into the style attribute, as chromium's CSSOM
  // does: writing a property serialises the declarations back into the
  // attribute, and clearing the last one leaves the attribute present but
  // EMPTY — which is how F13 left a `style=""` residue on an element that was
  // rendered without one (driven: `… aria-label="Offer payload field"
  // style="">` after the reveal withdrew).
  const styleBag: Record<string, string> = {};
  const style: Record<string, string> = Object.defineProperty({} as Record<string, string>, "textOverflow", {
    enumerable: true,
    get: (): string => styleBag["textOverflow"] ?? "",
    set: (v: string): void => {
      styleBag["textOverflow"] = v;
      attrs["style"] = Object.entries(styleBag)
        .filter(([, val]) => val !== "")
        .map(([k, val]) => `${k === "textOverflow" ? "text-overflow" : k}: ${val};`)
        .join(" ");
    },
  });
  const options = [{ textContent: optionText }];
  const sel = {
    tagName: "SELECT",
    clientWidth: clientW,
    selectedIndex: 0,
    options,
    style,
    get naturalWidth(): number {
      return Math.max(clientW, Math.ceil(textWidthPx(options[0]!.textContent, fontPx, bucket)));
    },
    get scrollWidth(): number {
      return style["textOverflow"] === "ellipsis" ? clientW : this.naturalWidth;
    },
    setAttribute(n: string, v: string) {
      attrs[n] = v;
    },
    getAttribute: (n: string) => attrs[n] ?? null,
    removeAttribute(n: string) {
      delete attrs[n];
    },
  };
  const listeners: Record<string, (e: unknown) => void> = {};
  const winListeners: Record<string, (e: unknown) => void> = {};
  const observers: Array<{ options: Record<string, boolean>; cb: (records: unknown[]) => void }> = [];
  let resolveFonts: () => void = () => {};
  const fontsPromise = new Promise<void>((r) => {
    resolveFonts = r;
  });
  const doc = {
    getElementById: () => null,
    querySelectorAll: () => [sel],
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
    addEventListener(type: string, fn: (e: unknown) => void) {
      listeners[type] = fn;
    },
    head: { appendChild() {} },
    body: {},
    fonts: { ready: fontsPromise },
  };
  const win: Record<string, unknown> = {
    addEventListener(type: string, fn: (e: unknown) => void) {
      winListeners[type] = fn;
    },
  };
  function MutationObserverStub(this: Record<string, unknown>, cb: (records: unknown[]) => void) {
    (this as { observe: (t: unknown, o: Record<string, boolean>) => void }).observe = (_t: unknown, o: Record<string, boolean>) => {
      observers.push({ options: o, cb });
    };
  }
  runInNewContext(LG_CLIP_REVEAL_SCRIPT, {
    document: doc,
    window: win,
    MutationObserver: MutationObserverStub,
    setTimeout: (fn: () => void) => {
      fn();
      return 0;
    },
    String,
    Object,
    Number,
    Boolean,
    JSON,
    fetch: () => Promise.resolve({}),
  });
  return {
    attrs,
    style,
    sel: sel as unknown as RevealHarness["sel"],
    win,
    listeners,
    winListeners,
    observers,
    async fontsReady() {
      resolveFonts();
      await fontsPromise;
      await new Promise((r) => setTimeout(r, 0));
    },
    state: () => ({ title: attrs["title"] ?? null, clipped: attrs["data-lg-clipped"] ?? null, textOverflow: style["textOverflow"] ?? "" }),
    snapshot: () => JSON.stringify(attrs),
  };
}

describe("N7 CLIP REVEAL — the real leadgen script hands over text a select cannot show", () => {
  const LONG = "No presets yet — create one from the Themes manager";

  it("EXECUTED: a select whose own box cannot show its selected option gets that option verbatim as a title, plus an ellipsis", () => {
    const h = revealHarness(312, LONG);
    expect(h.state()).toEqual({ title: LONG, clipped: "1", textOverflow: "ellipsis" });
  });

  it("EXECUTED: a select that fits is left completely alone — no title, no ellipsis, no attribute", () => {
    const h = revealHarness(312, "No presets saved yet");
    expect(h.state()).toEqual({ title: null, clipped: null, textOverflow: "" });
  });

  // THE BLOCKER-1 REGRESSION, kept in a bottle: the reveal's own ellipsis
  // collapses the measurement, so a mechanism that re-reads the raw
  // scrollWidth withdraws what it just set. Run it 8 times and interleave the
  // three real events; every reading must be the same reading.
  it("EXECUTED: IDEMPOTENT — 8 sweeps and 6 interleaved change/focusin/mouseover events leave the SAME state, never an alternating one", () => {
    const h = revealHarness(312, LONG);
    const revealed = { title: LONG, clipped: "1", textOverflow: "ellipsis" };
    const seen: Array<Record<string, unknown>> = [h.state()];
    const sweep = h.win["lgRevealClippedSelects"] as (root: unknown) => void;
    for (let i = 0; i < 8; i += 1) {
      sweep(null);
      seen.push(h.state());
      expect(h.state(), `sweep ${i + 1} changed the state`).toEqual(revealed);
    }
    for (const type of ["mouseover", "focusin", "change", "mouseover", "change", "focusin"]) {
      (h.listeners[type] as (e: unknown) => void)({ target: h.sel });
      seen.push(h.state());
      expect(h.state(), `event ${type} changed the state`).toEqual(revealed);
    }
    // …and the whole run really produced ONE distinct state (an alternating
    // mechanism produces two).
    expect(new Set(seen.map((s) => JSON.stringify(s))).size, JSON.stringify(seen)).toBe(1);
    expect(seen.length).toBe(15);
  });

  it("EXECUTED: idempotent in the OTHER direction too — a fitting select stays untouched over 8 sweeps and 3 events", () => {
    const h = revealHarness(312, "Short");
    const sweep = h.win["lgRevealClippedSelects"] as (root: unknown) => void;
    for (let i = 0; i < 8; i += 1) {
      sweep(null);
      expect(h.state()).toEqual({ title: null, clipped: null, textOverflow: "" });
    }
    for (const type of ["mouseover", "focusin", "change"]) {
      (h.listeners[type] as (e: unknown) => void)({ target: h.sel });
      expect(h.state()).toEqual({ title: null, clipped: null, textOverflow: "" });
    }
  });

  it("EXECUTED: the reveal is withdrawn when a genuinely shorter value is selected — measured in the state its own styling cannot change", () => {
    const h = revealHarness(312, "Seed Local Living — Not activated yet with a much longer trailing badge");
    expect(h.state().title).toBe("Seed Local Living — Not activated yet with a much longer trailing badge");
    h.sel.options[0]!.textContent = "R2Fix";
    (h.win["lgRevealClippedSelects"] as (root: unknown) => void)(null);
    expect(h.state()).toEqual({ title: null, clipped: null, textOverflow: "" });
    // …and it stays withdrawn (the withdrawal is idempotent as well).
    (h.win["lgRevealClippedSelects"] as (root: unknown) => void)(null);
    expect(h.state()).toEqual({ title: null, clipped: null, textOverflow: "" });
  });

  it("EXECUTED: it reacts to the events an island-filled select actually produces (change / focusin / mouseover), with no timer of its own", () => {
    const h = revealHarness(312, "Short");
    for (const type of ["change", "focusin", "mouseover"]) expect(typeof h.listeners[type], type).toBe("function");
    h.sel.options[0]!.textContent = LONG;
    (h.listeners["change"] as (e: unknown) => void)({ target: h.sel });
    expect(h.state()).toEqual({ title: LONG, clipped: "1", textOverflow: "ellipsis" });
  });

  // ---------------------------------------------------------------------
  // FIX ROUND F13 (MAJOR-3) — the three transitions review #3 measured the
  // reveal missing. Each is EXECUTED here against the real bytes, and each
  // was re-measured in the product afterwards (numbers in the legs).
  // ---------------------------------------------------------------------
  it("EXECUTED (transition 1): an option's text changing IN PLACE is seen — both mutation-record shapes, childList-on-OPTION and characterData", () => {
    const h = revealHarness(312, "Short");
    expect(h.state().title).toBeNull();
    const observer = h.observers[0] as { options: Record<string, boolean>; cb: (records: unknown[]) => void };
    expect(observer.options["characterData"], "the observer must ask for characterData or a text edit is invisible").toBe(true);
    expect(observer.options["subtree"]).toBe(true);

    // (a) `option.textContent = x` — chromium delivers a CHILDLIST record
    // targeted at the OPTION (driven: 128/128 -> 581/131 on the offers page).
    h.sel.options[0]!.textContent = LONG;
    observer.cb([{ type: "childList", target: { nodeName: "OPTION", parentNode: { nodeName: "SELECT" } }, addedNodes: [{ nodeName: "#text" }], removedNodes: [] }]);
    expect(h.state()).toEqual({ title: LONG, clipped: "1", textOverflow: "ellipsis" });

    // (b) `textNode.data = x` — a CHARACTERDATA record targeted at the TEXT
    // NODE itself; neither shape implies the other.
    const h2 = revealHarness(312, "Short");
    h2.sel.options[0]!.textContent = LONG;
    h2.observers[0]!.cb([{ type: "characterData", target: { nodeName: "#text", parentNode: { nodeName: "OPTION" } }, addedNodes: [], removedNodes: [] }]);
    expect(h2.state()).toEqual({ title: LONG, clipped: "1", textOverflow: "ellipsis" });

    // …and an unrelated text edit elsewhere on the page still does NOT sweep.
    const h3 = revealHarness(312, LONG);
    h3.attrs["title"] = "";
    delete h3.attrs["title"];
    h3.style["textOverflow"] = "";
    delete h3.attrs["data-lg-clipped"];
    h3.observers[0]!.cb([{ type: "characterData", target: { nodeName: "#text", parentNode: { nodeName: "DIV" } }, addedNodes: [], removedNodes: [] }]);
    expect(h3.state().title, "a paragraph's text changing must not trigger a sweep").toBeNull();
  });

  it("EXECUTED (transition 2): a RESIZE that starts a clip is seen — one window listener into the same coalescing queue", () => {
    const h = revealHarness(400, "Seed Local Living — Not activated yet");
    expect(h.state().title, "wide enough at first").toBeNull();
    expect(typeof h.winListeners["resize"], "the reveal must listen for resize").toBe("function");
    h.sel.clientWidth = 180; // the same select after 1280 -> 375
    (h.winListeners["resize"] as (e: unknown) => void)({});
    expect(h.state()).toEqual({ title: "Seed Local Living — Not activated yet", clipped: "1", textOverflow: "ellipsis" });
  });

  it("EXECUTED (transition 3): a WEB FONT settling after the boot sweep is seen — document.fonts.ready re-measures", async () => {
    // What is under test is the WIRING: the reveal must re-sweep when
    // document.fonts.ready resolves. The widening itself is modelled by making
    // the painted string wider, which is what a wider family does to the same
    // text. (Today no admin page vendors a face — driven:
    // document.fonts.size === 0 on /admin/leadgen/themes — so this leg is the
    // proof that the hook exists, not a claim that it fires there now; the
    // manager's own load-state title was BLOCKER-1's double sweep.)
    const h = revealHarness(200, "Roboto Mono");
    expect(h.state().title, "fits in the boot metric").toBeNull();
    h.sel.options[0]!.textContent = "Roboto Mono (a wider family arrived)";
    await h.fontsReady();
    expect(h.state()).toEqual({ title: "Roboto Mono (a wider family arrived)", clipped: "1", textOverflow: "ellipsis" });
  });

  // ---------------------------------------------------------------------
  // FIX ROUND F14 (review-p8-3d MAJOR-1) — THE REVEAL DOES NOT OWN `title`.
  // F13 widened the reveal to every leadgen admin route; two selects on
  // /admin/leadgen/sections/:id/edit already carry a tooltip the PRODUCT set
  // (ui-section-studio.ts:15594 `pathSel.title = f.path`, promised to the
  // operator in the help copy at :3263; and the SSR title on
  // #lg-content-type-swap at :2601), and the reveal overwrote then deleted it.
  // WHY NO F13 LEG COULD FAIL FOR IT: every metric in this file and in the
  // driven runs counted `clipped-without-title`, i.e. MISSING titles. A
  // destroyed title is PRESENT and WRONG, so it passed every count. The legs
  // below are shaped the other way round — they count readings in which the
  // author's own sentence is absent from the element, which is 0 only if the
  // reveal never overwrites and never deletes it.
  // FAIL-BEFORE (driven, both bodies against the same real element): with the
  // F13 body restored, the real Mapping drawer at 375 went
  // title="lead.r2fix_carrier" -> "Street address line one and two — text
  // (required)" -> null, 10 of 10 readings without the author's text, and the
  // withdrawn element kept a `style=""` residue; with these bytes, 0 of 52.
  // ---------------------------------------------------------------------
  const AUTHORED = "lead.r2fix_carrier";
  const FIELD_LABEL = "Street address line one and two — text (required)";
  const SHORT_LABEL = "Carrier";

  it("EXECUTED: a select the PRODUCT titled keeps that sentence verbatim — the clipped text is ADDED, never substituted", () => {
    const h = revealHarness(178, FIELD_LABEL, "sans", 14, AUTHORED);
    const s = h.state();
    expect(s.clipped).toBe("1");
    expect(s.textOverflow).toBe("ellipsis");
    // The deliberate choice, asserted rather than described: a COMPOSITION,
    // author's sentence first and exactly as written, then the text the box
    // cut. Both facts reach the operator; neither is silently replaced.
    expect(s.title).toBe(`${AUTHORED}\n${FIELD_LABEL}`);
    expect((s.title as string).startsWith(AUTHORED), "the author's sentence must lead").toBe(true);
    expect(s.title).toContain(FIELD_LABEL);
    // …and it is recoverable from the element itself, not only by string
    // surgery on the composition.
    expect(h.attrs["data-lg-title-own"]).toBe(AUTHORED);
  });

  it("EXECUTED: 6 clip/unclip cycles with the three real events interleaved DESTROY the author's sentence 0 times, and the run has exactly one clipped state and one resting state", () => {
    const h = revealHarness(178, SHORT_LABEL, "sans", 14, AUTHORED);
    const resting = h.snapshot();
    expect(h.state()).toEqual({ title: AUTHORED, clipped: null, textOverflow: "" });
    const sweep = h.win["lgRevealClippedSelects"] as (root: unknown) => void;
    const clippedStates = new Set<string>();
    const restStates = new Set<string>([resting]);
    let destroyed = 0;
    let readings = 1;
    for (let i = 0; i < 6; i += 1) {
      h.sel.options[0]!.textContent = FIELD_LABEL;
      sweep(null);
      for (const type of ["mouseover", "focusin", "change"]) (h.listeners[type] as (e: unknown) => void)({ target: h.sel });
      readings += 1;
      clippedStates.add(h.snapshot());
      if (!String(h.state().title).startsWith(AUTHORED)) destroyed += 1;
      h.sel.options[0]!.textContent = SHORT_LABEL;
      sweep(null);
      for (const type of ["mouseover", "focusin", "change"]) (h.listeners[type] as (e: unknown) => void)({ target: h.sel });
      readings += 1;
      restStates.add(h.snapshot());
      if (h.state().title !== AUTHORED) destroyed += 1;
    }
    expect(destroyed, "a reading in which the product's own tooltip had been overwritten or deleted").toBe(0);
    expect(readings).toBe(13);
    expect(clippedStates.size, [...clippedStates].join(" | ")).toBe(1);
    expect(restStates.size, [...restStates].join(" | ")).toBe(1);
    expect([...restStates][0], "every resting reading is the element the product rendered").toBe(resting);
  });

  it("EXECUTED: withdrawal leaves the element exactly as the product rendered it — same attributes, same values, same order, no style residue", () => {
    const h = revealHarness(178, SHORT_LABEL, "sans", 14, AUTHORED);
    const rendered = JSON.stringify({ title: AUTHORED });
    expect(h.snapshot()).toBe(rendered);
    const sweep = h.win["lgRevealClippedSelects"] as (root: unknown) => void;
    h.sel.options[0]!.textContent = FIELD_LABEL;
    sweep(null);
    // while revealed: the author's title is stashed, the composition is shown,
    // and the title attribute keeps its ORIGINAL position in the element.
    expect(h.snapshot()).toBe(
      JSON.stringify({ title: `${AUTHORED}\n${FIELD_LABEL}`, "data-lg-title-own": AUTHORED, "data-lg-clipped": "1", style: "text-overflow: ellipsis;" }),
    );
    h.sel.options[0]!.textContent = SHORT_LABEL;
    sweep(null);
    expect(h.snapshot(), "the reveal's contribution must be fully reversible").toBe(rendered);
  });

  it("EXECUTED: the same reversibility for a select the product did NOT title — the reveal's own attributes go, including the style attribute it created", () => {
    const h = revealHarness(312, "Short");
    expect(h.snapshot(), "the product rendered a bare select").toBe("{}");
    const sweep = h.win["lgRevealClippedSelects"] as (root: unknown) => void;
    h.sel.options[0]!.textContent = LONG;
    sweep(null);
    expect(h.snapshot()).toBe(JSON.stringify({ "data-lg-clipped": "1", title: LONG, style: "text-overflow: ellipsis;" }));
    h.sel.options[0]!.textContent = "Short";
    sweep(null);
    // F13 left `style=""` behind here (driven), which is a byte the product
    // never wrote.
    expect(h.snapshot()).toBe("{}");
  });

  it("EXECUTED: when the author's tooltip IS the clipped text, it is shown once, not twice", () => {
    const h = revealHarness(178, FIELD_LABEL, "sans", 14, FIELD_LABEL);
    expect(h.state().title).toBe(FIELD_LABEL);
    expect(h.attrs["data-lg-title-own"]).toBe(FIELD_LABEL);
  });
});

// ---------------------------------------------------------------------------
// FIX ROUND F14 — E11: the author title under test is the one the REAL route
// serves. The producer side is the real admin router's own markup for
// /admin/leadgen/sections/new (the route F13 newly took responsibility for),
// the consumer side is the real LG_CLIP_REVEAL_SCRIPT bytes; neither is typed
// out here.
// ---------------------------------------------------------------------------
describeDb("F14 — the tooltip the reveal must not destroy comes from the real served page", () => {
  it("EXECUTED: the real route serves a product-titled select, and the real reveal bytes compose that exact sentence instead of replacing it", async () => {
    const { env } = newHarness();
    const { status, html } = await getHtml(env, "/admin/leadgen/sections/new");
    expect(status).toBe(200);

    const titled = [...html.matchAll(/<select((?:"[^"]*"|[^>"])*?)>([\s\S]*?)<\/select>/g)]
      .map((m) => ({ attrs: m[1] as string, body: m[2] as string }))
      .filter((s) => attr(s.attrs, "title") !== null);
    expect(titled.length, "the route must still render a select the product itself titled").toBeGreaterThanOrEqual(1);
    const real = titled[0] as { attrs: string; body: string };
    const authored = decodeEntities(attr(real.attrs, "title") as string);
    const firstOption = decodeEntities((real.body.match(/<option[^>]*>([\s\S]*?)<\/option>/) ?? ["", ""])[1] as string);
    expect(authored.length).toBeGreaterThan(0);
    expect(firstOption.length).toBeGreaterThan(0);

    // the OTHER real author title on this page is the island's, which the same
    // served bytes carry (ui-section-studio.ts:15594) — named here so a rename
    // does not quietly leave this class untested.
    expect(html, "the mapping drawer's author title must still be set by the served island").toContain("pathSel.title = f.path");

    // the REAL script, over that REAL title, in a box too narrow for the option
    const h = revealHarness(40, firstOption, "sans", 14, authored);
    expect(h.state().title).toBe(`${authored}\n${firstOption}`);
    expect(h.attrs["data-lg-title-own"]).toBe(authored);
    h.sel.clientWidth = 4000;
    (h.win["lgRevealClippedSelects"] as (root: unknown) => void)(null);
    expect(h.state()).toEqual({ title: authored, clipped: null, textOverflow: "" });
    expect(h.snapshot()).toBe(JSON.stringify({ title: authored }));
  });
});

// ---------------------------------------------------------------------------
// F13 COVERAGE + BLAST RADIUS — the reveal runs on EVERY leadgen admin page
// and changes NOTHING for any other product.
// `test/conversions-admin-shell.test.ts` owns the other half of this claim (an
// adminLayout call that does not opt in is byte-identical, 20312 / sha
// b7d6e8df…); it is READ-ONLY and unedited.
//
// WHAT CHANGED FROM F12, AND WHY THE OLD LEG WAS TOO NARROW. F12 asserted the
// bytes on TWO renderers (renderThemesTabPanel and the manager page) and the
// register row read from that "three other leadgen pages have no reveal, and
// none of them clips". Review #3 measured ELEVEN select-bearing leadgen routes
// without it, three of them clipping (offers 7/10 at 375, sections 4/4,
// auction 2/3 — and Section Studio's #lg-preview-theme by +35px at BOTH widths
// on an operator-authored name). So the include moved up to ui.ts's two
// leadgen shells, and the leg below stopped asserting renderer fragments: it
// drives the REAL admin router for the real routes and requires the real
// served bytes in each. A route added tomorrow through the same shells is
// covered; a route that stops using them fails here.
// ---------------------------------------------------------------------------
describeDb("F13 — the clip reveal is leadgen-scoped: out of the cross-product shell, on every leadgen page", () => {
  it("the SHARED admin shell (templates/layout.ts ADMIN_SCRIPTS) carries no part of the reveal", () => {
    for (const token of [
      "lgRevealClippedSelect",
      "lgRevealClippedSelects",
      "data-lg-clipped",
      "sel.scrollWidth > sel.clientWidth",
      "lgTouchesASelect",
    ]) {
      expect(ADMIN_SCRIPTS, `ADMIN_SCRIPTS must not carry "${token}" — it ships on every conversions page too`).not.toContain(token);
    }
  });

  it("EXECUTED: every leadgen admin route the real router serves carries the reveal verbatim, exactly once", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Blast Radius Preset", "Poppins", "Lexend")), env),
      "create preset",
    );
    const routes = [
      "/admin/leadgen/offers",
      "/admin/leadgen/offers/new",
      "/admin/leadgen/sections",
      "/admin/leadgen/sections/new",
      "/admin/leadgen/quotes",
      "/admin/leadgen/quotes/new",
      "/admin/leadgen/auction",
      "/admin/leadgen/auction/new",
      `/admin/leadgen/themes?theme=${created.item.id}`,
      `/admin/leadgen/themes?theme=${created.item.id}&embed=1`,
    ];
    const missing: string[] = [];
    const doubled: string[] = [];
    for (const route of routes) {
      const { status, html } = await getHtml(env, route);
      expect(status, route).toBe(200);
      if (!html.includes(LG_CLIP_REVEAL_SCRIPT)) missing.push(route);
      const copies = html.split("function lgRevealClippedSelect(").length - 1;
      if (copies !== 1) doubled.push(`${route} (${copies} copies)`);
    }
    expect(missing, "a leadgen admin route served without the clip reveal").toEqual([]);
    expect(doubled, "one copy per page — the shells are the single include site").toEqual([]);
    expect(routes.length).toBe(10);
  });

  it("EXECUTED: the quote-editor page — which carries the Themes rail and 70 more selects — is one of them, with the panel itself no longer including its own copy", () => {
    const panel = renderThemesTabPanel(true);
    // The panel is mounted INSIDE the editor page (ui-quotes.ts:769), which is
    // a leadgenPageShell page, so its own include would now be a second copy.
    expect(panel).not.toContain("function lgRevealClippedSelect(");
    const lastScript = panel.slice(panel.lastIndexOf("<script>") + "<script>".length, panel.lastIndexOf("</script>"));
    expect(lastScript, "every existing harness slices this panel's LAST script and expects the tab island").toContain("refreshPresetAvailability");
    expect(lastScript).not.toContain("lgRevealClippedSelect");
  });

  it("the emitted body keeps the island rules: ES5 only, and NO comment bytes (rationale stays in the TypeScript, which never ships)", () => {
    expect(LG_CLIP_REVEAL_SCRIPT).not.toMatch(/\b(?:const|let|async|class)\b|=>/);
    expect(LG_CLIP_REVEAL_SCRIPT).not.toContain("/*");
    expect(LG_CLIP_REVEAL_SCRIPT).not.toContain("//");
    expect(LG_CLIP_REVEAL_SCRIPT).not.toContain("0x");
  });

  it("EXECUTED: a second include installs nothing — one listener set per page, whatever includes it", () => {
    let added = 0;
    const win: Record<string, unknown> = {};
    const doc = {
      getElementById: () => null,
      querySelectorAll: () => [],
      addEventListener() {
        added += 1;
      },
      head: { appendChild() {} },
      body: {},
    };
    const sandbox = { document: doc, window: win, setTimeout: (fn: () => void) => (fn(), 0), String, Object, Number, Boolean, JSON };
    runInNewContext(LG_CLIP_REVEAL_SCRIPT, sandbox);
    const afterFirst = added;
    expect(afterFirst).toBeGreaterThan(0);
    runInNewContext(LG_CLIP_REVEAL_SCRIPT, sandbox);
    expect(added, "the install guard must make the second include a no-op").toBe(afterFirst);
  });
});

// ===========================================================================
// F12 RETIREMENT LEDGER — the arithmetic F10 did not state.
//
// THE NUMBERS. This file went 141 tests (gate run4/run5) -> 63 (gate run6):
// net -78. F10's report named only what it ADDED (+2 recovery, +4 reveal). The
// full arithmetic is 141 - 88 + 10 = 63, and the 10 added legs are the 4 clip-
// invariant legs, the 4 clip-reveal legs and the 2 recovery legs.
//
// WHAT THE 88 RETIRED LEGS WERE, AND WHAT EACH CLAIMED. They were F3's TWO
// container-scoped box invariants:
//   (R) 87 legs on the rail block — 1 STRUCTURAL leg ("the rail really is the
//       container this arithmetic describes": the `.lg-scalars` grids hold
//       exactly the 16 scalar selects) plus 86 per-option legs, one per
//       <option> of those 16 selects (12+12+4+5+4+4+5+6+4+3+4+4+4+3+6+6 = 86).
//       Claim per per-option leg: THIS option's text is narrower than THIS
//       select's own content box, at the narrowest width the `.lg-scalars`
//       grid can give it.
//   (M)  1 leg on the manager block — ONE leg that looped both typography-grid
//       font selects (#tm-headline-font, #tm-body-font) internally. Claim:
//       every option either select carries fits its own content box.
//   FIX ROUND F13 (review-p8-3c MINOR-1) — the decomposition above USED TO
//   read "(R) 86 + (M) 2". The total, 88, was right and is unchanged; the
//   attribution was wrong in both halves, and a ledger whose whole purpose is
//   to account for each retired claim may not miscount them. Recounted at
//   8f57f27, the commit that retired them: the rail describe emitted 87 `it`s
//   (the structural one is restored as Leg 1 below, which is why it must be
//   named here), the manager describe emitted 1.
//
// WHERE EACH CLAIM IS COVERED NOW. Both claims are made by the single clip-
// invariant leg "no product-authored string is wider than the box that shows
// it", over 22 selects (the 16 scalars + 4 other Themes-tab controls + the 2
// manager font selects) instead of 18 — same conservative width model, same
// declaration-derived boxes, same narrowest-width sweep. Nothing about the
// claims is weaker; what was lost is only per-case granularity in the failure
// message, and TWO structural properties that the consolidation left implicit
// and this ledger RESTORES as executed legs:
//   1. The retired legs checked their options UNCONDITIONALLY. The clip
//      invariant checks a select's SSR option texts only while the select is
//      classified product-authored — a select that ever measures DATA-BEARING
//      has its SSR texts dropped from the universe by design (that is the (B)
//      branch: no box can bound operator data). Correct for a site picker,
//      silent coverage loss for a scalar. Leg 1 below pins the 18 selects the
//      retired legs covered as product-authored AND boxed, so they can never
//      leave the checked universe unnoticed.
//   2. The retired rail legs read their box out of the `.lg-scalars` rule, so
//      a revert of that rule failed them by construction. Leg 2 below feeds
//      the reverted rule (`repeat(2,1fr)`, the shape the defect shipped with)
//      back through the SAME arithmetic and requires it to name overflows —
//      a fail-before kept in a bottle, so the invariant can never go vacuous.
//   3. FIX ROUND F13 (MINOR-2) — one claim the retired rail legs made that the
//      consolidation genuinely DID drop: they resolved their box through the
//      SHARED `.form-select` rule and therefore asserted
//      `decl(formSelect,"width") === "100%"`. Nothing re-asserted it, and the
//      replacement machinery short-circuits `claimsFullLine` on the class NAME
//      (resolveContentBox), so if templates/layout.ts's cross-product rule
//      ever became `width:auto` this arithmetic would keep assuming a
//      full-line box and silently OVER-state every measurement instead of
//      failing. Leg 3 below restores it, on the real sheet, and pins the
//      reason.
// PREVIOUS RESIDUAL, now CLOSED (F13): F10/F12 rendered surface S2's
// differential against ITSELF (alt === html), so S2's data-bearing detection
// could not fire and its answer was true by construction. coveredSelects now
// renders the manager a SECOND time for a SECOND theme created through the
// real POST route (two vendored families), so the differential is real on both
// surfaces. The outcome the retired (M) claim needs is unchanged and is now
// EARNED rather than assumed: the font selects' option texts do not move with
// the theme, so they stay product-authored and stay in the checked universe
// (Leg 1 pins it) — while the FONT the manager paints them in does move, which
// is how the family axis discovers it must measure them in the widest bucket.
// ===========================================================================
describeDb("F12 RETIREMENT LEDGER — every claim the 88 consolidated legs made is still enforced", () => {
  it("EXECUTED (restores claim 1): the 18 selects F3's two box blocks covered are all still boxed AND still product-authored, so none of their 86+22 option texts can silently leave the universe", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Ledger Preset", "Newsreader", "Roboto Mono")), env),
      "create preset",
    );
    const all = await coveredSelects(env, created.item.id);

    // (R) the rail half — rebuilt STRUCTURALLY from the real markup, by the
    // same container class F3 scoped to, never from a list of today's keys.
    const railScalars = selectsInsideClass(renderThemesTabPanel(true), "lg-scalars");
    expect(railScalars.length, "the `.lg-scalars` grids no longer hold the 16 selects the retired legs covered").toBe(16);
    expect(railScalars.reduce((n, s) => n + s.options.length, 0), "the retired rail legs were one per option").toBe(86);

    // (M) the manager half.
    const { html: managerHtml } = await getHtml(env, `/admin/leadgen/themes?theme=${created.item.id}`);
    const managerFonts = managerFontSelects(managerHtml);

    const retiredUniverse: Array<{ key: string; texts: string[] }> = [
      ...railScalars.map((s) => ({ key: attr(s.attrs, "data-theme-key") ?? "(unkeyed)", texts: s.options.map((o) => o.text) })),
      ...managerFonts.map((s) => ({ key: attr(s.attrs, "id") ?? "(unkeyed)", texts: s.options.map((o) => o.text) })),
    ];
    expect(retiredUniverse.length).toBe(18);

    for (const row of retiredUniverse) {
      const covered = all.find((c) => c.key === row.key);
      expect(covered, `${row.key} was covered by a retired leg and is not in the clip invariant's enumeration`).toBeDefined();
      const c = covered as CoveredSelect;
      expect(c.box, `${row.key} lost its resolvable box`).not.toBeNull();
      expect(c.dataBearing, `${row.key} now measures data-bearing, which DROPS its option texts from the checked universe`).toBe(false);
      for (const text of row.texts) {
        expect(c.strings, `${row.key}: option "${text}" is no longer checked by the clip invariant`).toContain(text);
      }
    }
  }, HEAVY_LEG_TIMEOUT_MS);

  it("EXECUTED (restores claim 2): with `.lg-scalars` reverted to the shape the defect shipped with, the SAME arithmetic still names the overflows", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Ledger Preset", "Newsreader", "Roboto Mono")), env),
      "create preset",
    );
    const FIXED = ".lg-scalars{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}";
    const REVERTED = ".lg-scalars{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}";
    expect(LG_QUOTES_STYLES, "the real sheet must still carry the fixed rule this leg reverts").toContain(FIXED);
    const reverted = LG_QUOTES_STYLES.replace(FIXED, REVERTED);
    expect(reverted, "the mutation must actually change the sheet, or this leg proves nothing").not.toBe(LG_QUOTES_STYLES);

    const overflowing: string[] = [];
    for (const c of await coveredSelects(env, created.item.id, [reverted, ADMIN_STYLES])) {
      if (c.box === null) continue;
      for (const text of c.strings) {
        if (textWidthPx(text, c.fontPx, c.bucket) > c.box.content) overflowing.push(`${c.key}: "${text}"`);
      }
    }
    // Reproduced this round: 31 named overflows, the same number F10's own
    // evidence reported for this exact revert, the first three being
    // typography.display "Inherit from base" / "Space Grotesk" /
    // "Playfair Display". The count is not pinned (a label edit may legitimately move it); what is
    // pinned is that the reverted grid FAILS, and that the failures are the
    // rail scalars whose boxes that rule sets.
    expect(overflowing.length, "the reverted grid rule must still be caught").toBeGreaterThan(0);
    expect(overflowing.some((o) => o.startsWith("typography."))).toBe(true);
  }, HEAVY_LEG_TIMEOUT_MS);

  it("EXECUTED (restores claim 3, MINOR-2): the SHARED .form-select rule still declares width:100%, which is the premise the box arithmetic short-circuits on", () => {
    const formSelect = styleRule(ADMIN_STYLES, ".form-select");
    expect(decl(formSelect, "width"), "the retired rail legs asserted this and the consolidation dropped it").toBe("100%");
    // …and the premise is really load-bearing: resolveContentBox gives a
    // .form-select the whole flex line BECAUSE of this declaration. If the
    // shared rule stopped claiming the line, every box below it would be
    // over-stated (measurements too generous = a silent green), which is the
    // failure this leg exists to make loud.
    const rail = renderThemesTabPanel(true);
    const scalars = selectsInsideClass(rail, "lg-scalars");
    expect(scalars.length).toBe(16);
    for (const s of scalars) expect(classesOf(s.attrs), "the rail scalars are the .form-select consumers this premise covers").toContain("form-select");
  });
});

// ---------------------------------------------------------------------------
// MINOR-1 / N20 — ONE FONT VOCABULARY. The reviewer measured 8 of 11 names
// converged and six still split (the rail OFFERED Literata/Sora/System, the
// manager OFFERED Newsreader/Inter/Roboto Mono). Both halves are read out of
// the REAL rendered markup of the two surfaces and compared as SETS — never a
// hand-typed roster of "the names I expect".
// ---------------------------------------------------------------------------
describeDb("MINOR-1 — the rail and the Themes manager OFFER the same font vocabulary", () => {
  it("EXECUTED: the offered set on both surfaces is exactly the families fonts.generated.ts actually vendors", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Vocabulary Preset", "Poppins", "Lexend")), env),
      "create preset",
    );
    const { html: managerHtml } = await getHtml(env, `/admin/leadgen/themes?theme=${created.item.id}`);
    const railHtml = renderThemesTabPanel(true, []);

    const railFontSelects = parseSelects(railHtml).filter((s) => ["typography.display", "typography.body"].includes(attr(s.attrs, "data-theme-key") ?? ""));
    expect(railFontSelects.length).toBe(2);

    const served = [...LEADGEN_SELF_HOSTED_FONT_FAMILIES].sort();
    for (const select of railFontSelects) {
      expect(offeredTexts(select).sort(), `rail ${attr(select.attrs, "data-theme-key")}`).toEqual(served);
    }
    for (const select of managerFontSelects(managerHtml)) {
      expect(offeredTexts(select).sort(), `manager ${attr(select.attrs, "id")}`).toEqual(served);
    }
    // …and the two surfaces offer them in the SAME order, not merely the same
    // set (one vocabulary, one reading order).
    expect(offeredTexts(railFontSelects[0] as ParsedSelect)).toEqual(offeredTexts(managerFontSelects(managerHtml)[0] as ParsedSelect));
  });

  // FIX ROUND F13 (BLOCKER-2) — the two surfaces now say the not-served
  // sentence in DIFFERENT PLACES, so this leg pins that they still say the
  // SAME WORDS. Both halves are sliced out of the two REAL renders; neither is
  // typed twice. (Why the places differ, in one line: the manager knows its
  // stored family server-side and un-hides that option, so a group heading has
  // something to stand over and the caption has something to describe; the
  // rail's three not-served ids stay hidden permanently — quotes-tabs/funnel.ts
  // assigns `.value` after hydration — so a heading there would stand over
  // nothing and the closed control is the only place the words can appear. The
  // rail's box shows them in full: driven, +0px across all 90 rail options at
  // 1280 and 375.)
  // FIX ROUND F14 (review-p8-3d MINOR-4) — AND WHY THE REGISTER DIFFERS, since
  // "same words, different shapes" is what the review actually measured: the
  // manager's is a standalone heading and a caption, which are sentences of
  // their own and start with a capital; the rail's is a mid-string
  // parenthetical inside an option label, which does not. That is why the
  // comparison below normalises case — deliberately, not by accident — and why
  // it still pins the WORDS byte-for-byte. Converging the presentation itself
  // is measured shut in both directions (ui-theme-manager.ts's
  // FONT_NOT_SERVED_NOTE block states the arithmetic: 294px in a 282px box one
  // way, a heading over permanently hidden options the other), and the rail's
  // markup is in quotes-tabs/themes.ts, which this slice does not own.
  it("EXECUTED: the not-served sentence is the SAME on both surfaces — in the rail's option text, in the manager's group heading and caption", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Converged Words Preset", "Newsreader", "Roboto Mono")), env),
      "create preset",
    );
    const { html: managerHtml } = await getHtml(env, `/admin/leadgen/themes?theme=${created.item.id}`);
    const railHtml = renderThemesTabPanel(true, []);

    // the rail's words, taken from a real rendered option
    const railOption = parseSelects(railHtml)
      .find((s) => attr(s.attrs, "data-theme-key") === "typography.display")
      ?.options.find((o) => o.value === "literata");
    expect(railOption, "the rail must still carry the stored-value option").toBeDefined();
    const railPhrase = ((railOption as ParsedOption).text.match(/\(([^)]+)\)/) ?? [])[1];
    expect(railPhrase, `the rail option text must carry the qualifier: ${(railOption as ParsedOption).text}`).toBeDefined();

    // the manager's words, taken from the real group heading and the real
    // caption of the real page
    const groupLabel = (managerHtml.match(/<optgroup label="([^"]+)"/) ?? [])[1];
    expect(groupLabel, "the manager must carry a not-served group heading").toBeDefined();
    const caption = (managerHtml.match(/data-tm-font-note="tm-headline-font"[^>]*>([^<]+)</) ?? [])[1];
    expect(caption, "the manager must carry the caption under the control").toBeDefined();

    const norm = (s: string): string => s.trim().toLowerCase();
    expect(norm(groupLabel as string)).toBe(norm(railPhrase as string));
    expect(norm(caption as string)).toBe(norm(railPhrase as string));
    expect(norm(railPhrase as string)).toBe("shows as default font");
    // …and the manager says it for the family that is really stored, not as a
    // permanent decoration: a theme on a vendored family has neither.
    const fresh = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Converged Words Fresh Preset", "Poppins", "Lexend")), env),
      "create fresh preset",
    );
    const { html: freshHtml } = await getHtml(env, `/admin/leadgen/themes?theme=${fresh.item.id}`);
    expect(freshHtml).not.toContain("<optgroup");
    expect(freshHtml).not.toContain("data-tm-font-note");
    expect(freshHtml).not.toContain("Shows as default font");
  });

  it("EXECUTED: a preset already storing a non-vendored family keeps it selectable, visible and rendering exactly as today", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Stored Legacy Preset", "Newsreader", "Roboto Mono")), env),
      "create preset storing two non-vendored families",
    );
    const { html } = await getHtml(env, `/admin/leadgen/themes?theme=${created.item.id}`);
    const [headline, body] = managerFontSelects(html);

    const headlineStored = (headline as ParsedSelect).options.find((o) => o.value === "Newsreader");
    expect(headlineStored, "the stored family must still be an option").toBeDefined();
    expect((headlineStored as ParsedOption).selected).toBe(true);
    expect((headlineStored as ParsedOption).hidden).toBe(false); // visible BECAUSE it is the stored value
    const bodyStored = (body as ParsedSelect).options.find((o) => o.value === "Roboto Mono");
    expect((bodyStored as ParsedOption).selected).toBe(true);
    expect((bodyStored as ParsedOption).hidden).toBe(false);
    // the OTHER non-vendored families are present as values but not offered
    const inter = (headline as ParsedSelect).options.find((o) => o.value === "Inter");
    expect((inter as ParsedOption).hidden).toBe(true);

    // "renders exactly as today": the stored names still resolve through the
    // untouched THEME_RECORD_FONT_STACKS table.
    expect(THEME_RECORD_FONT_STACKS["Newsreader"]).toBe("'Newsreader',Georgia,serif");
    expect(THEME_RECORD_FONT_STACKS["Roboto Mono"]).toBe("'Roboto Mono',monospace");
    // every enum value is still accepted storage — nothing was removed
    for (const name of THEME_RECORD_FONT_NAMES) {
      expect((headline as ParsedSelect).options.some((o) => o.value === name), `manager dropped the value "${name}"`).toBe(true);
    }
  });

  it("EXECUTED: on the rail, a funnel already storing a non-vendored id still has that option AND still paints the same font stack through the REAL renderer", () => {
    const railHtml = renderThemesTabPanel(true, []);
    const display = parseSelects(railHtml).find((s) => attr(s.attrs, "data-theme-key") === "typography.display") as ParsedSelect;

    for (const id of THEME_FONT_IDS) {
      const opt = display.options.find((o) => o.value === id);
      expect(opt, `the rail dropped the stored value "${id}"`).toBeDefined();
    }
    // …the three non-vendored ones are present but NOT offered
    for (const id of ["literata", "sora", "system"]) {
      expect((display.options.find((o) => o.value === id) as ParsedOption).hidden, `${id} must not be offered afresh`).toBe(true);
    }

    // The render half, through the REAL resolveTokens + funnelChromeCss pair —
    // not a lookup-table read: a funnel storing `literata` still emits the
    // identical family stack in the generated stylesheet.
    const css = funnelChromeCss(resolveTokens(defaultFunnelDesign, { typography: { display: "literata" } }, null, null).design, DEFAULT_FUNNEL_SCOPE, {
      frameRegions: true,
    });
    expect(THEME_FONT_STACKS.literata).toBe("'Literata',Georgia,serif");
    expect(css).toContain(THEME_FONT_STACKS.literata);
  });
});
