// P8 B5 (contract §5 B5) — "in the middle create different funnels side by
// side and drag sections boxes to the page of the wanted funnle" /
// "how he can see them side by side?".
//
// Acceptance under test (contract §5 B5, verbatim): "at 1280 at least two
// funnel columns fully visible with 4 funnels; a section can be dragged into
// every column including ones requiring scroll (auto-scroll or an
// equivalent), or the attempt gives a visible reason; the shared column is
// genuinely pinned or the false comment is corrected; state the keyboard and
// touch position explicitly. Rails stay — both are owner-required."
//
// This file proves the code half. The product half was DRIVEN on the running
// worker at 375/1280/1440/1600/1920 (fully-visible funnel columns
// 0/0/0/1/2 BEFORE -> 1/2/2/2/3 AFTER, 5 funnels in the fixture; the shared
// band x 583 -> -1127 across a scroll BEFORE, 491 -> 491 AFTER; a real
// page.mouse drag auto-scrolling 862px to reach the 5th column; a real CDP
// touch drag; the keyboard picker adding to an off-screen funnel) — see the
// slice report. Nothing here hand-builds both sides of a boundary:
//   * the SSR half renders the REAL editor page through the admin router on
//     the node:sqlite D1 harness after seeding through the LANDED endpoints
//     (the leadgen-rework-board.test.ts pattern), so the board CSS + markup
//     under assertion are the bytes the browser receives;
//   * the island half EXECUTES functions sliced out of that same served
//     script in a node:vm sandbox (the leadgen-p2-tail.test.ts idiom) — the
//     real drag/keyboard code, never a re-implementation.

import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";

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
  "0036_leadgen_core.sql", "0037_leadgen_analytics_mirror.sql", "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql", "0040_leadgen_runtime_context.sql", "0041_leadgen_frame_theme.sql",
  "0042_leadgen_pages.sql", "0043_leadgen_routing_rules.sql", "0044_leadgen_redirect_pct.sql",
  "0045_leadgen_persona_quota.sql", "0046_leadgen_rework_m1_variants.sql", "0047_leadgen_rework_m2_shared_pages.sql",
  "0048_leadgen_rework_m3_routing.sql", "0049_leadgen_rework_m4_m5_defaults_templates.sql",
  "0050_leadgen_rework_m6_grid_expansion.sql", "0051_leadgen_rework_m7_slider_collapse.sql",
  "0052_leadgen_rework_m9_address_fields.sql", "0053_leadgen_rework_m12_othergroup_retirement.sql",
] as const;

function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-1','Site One','one.example.com');",
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

function seedSection(sdb: SqliteDb, name: string, vertical: string): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  const content = JSON.stringify({ components: [{ type: "TwoButtonYesNo", question_id: "q1", internal_field: "f", answer_type: "boolean" }] });
  sdb
    .prepare("INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, status) VALUES (?, ?, 'quote_funnel', ?, 'Headline', ?, 'button', 'active')")
    .run(publicId, name, vertical, content);
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number };
  return { id: row.id, public_id: publicId };
}

// ---- island slicing (test/leadgen-p2-tail.test.ts idiom) --------------------
function islandContaining(html: string, marker: string): string {
  const at = html.indexOf(marker);
  expect(at, `island containing ${marker}`).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<script>", at);
  const end = html.indexOf("</script>", at);
  return html.slice(start + "<script>".length, end);
}
function boardIsland(html: string): string {
  return islandContaining(html, "function dragEndAt(");
}
function sliceIslandFunction(island: string, name: string): string {
  const marker = `function ${name}(`;
  const start = island.indexOf(marker);
  expect(start, `island function ${name}`).toBeGreaterThan(-1);
  let depth = 0;
  let seenBody = false;
  for (let i = start; i < island.length; i += 1) {
    const ch = island[i];
    if (ch === "{") { depth += 1; seenBody = true; } else if (ch === "}") {
      depth -= 1;
      if (seenBody && depth === 0) return island.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced island function ${name}`);
}
function sliceIslandVar(island: string, name: string): string {
  const marker = `var ${name} = `;
  const start = island.indexOf(marker);
  expect(start, `island var ${name}`).toBeGreaterThan(-1);
  const end = island.indexOf("\n", start);
  return island.slice(start, end);
}
// D11: the click listener is an ANONYMOUS function expression (delegated on
// `document`, same idiom as every other click branch in this island), so it
// has no `function name(` marker sliceIslandFunction can key on. Same
// brace-counting, keyed on the addEventListener call instead. This exact
// literal ("document.addEventListener('click', function (ev) {") also opens
// the page's generic data-goto-tab delegator, earlier in the SAME
// QUOTE_EDITOR_SCRIPT -- searching from "function dragEndAt(" onward (the
// board's own, later in the file) skips that unrelated, earlier listener.
function sliceIslandClickHandler(island: string): string {
  const marker = "document.addEventListener('click', function (ev) {";
  const anchor = island.indexOf("function dragEndAt(");
  expect(anchor, "island anchor (dragEndAt)").toBeGreaterThan(-1);
  const markerAt = island.indexOf(marker, anchor);
  expect(markerAt, "island click handler (the board's, after dragEndAt)").toBeGreaterThan(-1);
  const start = markerAt + marker.length - 1; // index of the function's own opening '{'
  let depth = 0;
  let seenBody = false;
  for (let i = start; i < island.length; i += 1) {
    const ch = island[i];
    if (ch === "{") { depth += 1; seenBody = true; } else if (ch === "}") {
      depth -= 1;
      if (seenBody && depth === 0) return "function (ev) " + island.slice(start, i + 1);
    }
  }
  throw new Error("unbalanced island click handler");
}
const SANDBOX_BUILTINS = { JSON, Object, String, Boolean, Number, Math, isFinite, encodeURIComponent };

// A minimal element stub carrying only what the sliced drag code touches.
interface ColStub { className: string; attrs: Record<string, string>; getAttribute(k: string): string | null; closest(sel: string): ColStub | null }
function colStub(attrs: Record<string, string>, closestMap: Record<string, ColStub | null> = {}): ColStub {
  const el: ColStub = {
    className: "",
    attrs,
    getAttribute: (k: string) => (Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k]! : null),
    closest: (sel: string) => (Object.prototype.hasOwnProperty.call(closestMap, sel) ? closestMap[sel]! : null),
  };
  return el;
}

// P8-2 review F-10 (E11): the drop-reason test below used to hand-build BOTH
// sides — the {scope,pageEl,colEl} target AND the code that consumes it. It
// now runs the REAL sliced dropTargetUnder over stubs whose ATTRIBUTES are
// read off the SERVED element, so the producer of that shape is product code
// and its attribute names/values are the bytes the browser receives. Only
// document.elementFromPoint/closest — browser primitives with no node
// equivalent here — remain stubbed, and the titles below say so; the
// behavioural proof of the same journeys is the browser drive in the slice
// report (a real page.mouse cross-funnel drop, a real CDP touch drop).
function attrsOf(html: string, marker: string): Record<string, string> {
  const at = html.indexOf(marker);
  expect(at, `served element carrying ${marker}`).toBeGreaterThan(-1);
  const tag = html.slice(html.lastIndexOf("<", at), html.indexOf(">", at));
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-z-]+)="([^"]*)"/g)) out[m[1]!] = m[2]!;
  for (const m of tag.matchAll(/\s(data-[a-z-]+)(?=[\s>])/g)) if (!(m[1]! in out)) out[m[1]!] = "";
  return out;
}

// The board's own numbers, read out of the SERVED stylesheet (never retyped).
function cssTokens(html: string, mediaMax: number | null): Record<string, number> {
  const rule = mediaMax === null
    ? html.slice(html.indexOf(".lg-board-shell{--lg-rail-l"))
    : html.slice(html.indexOf(`@media (max-width:${mediaMax}px){.lg-board-shell{`));
  const body = rule.slice(0, rule.indexOf("}"));
  const out: Record<string, number> = {};
  for (const m of body.matchAll(/--(lg-[a-z-]+):(\d+)px/g)) out[m[1]!] = Number(m[2]);
  return out;
}

// ---------------------------------------------------------------------------
// P8-2 review #5 (F2) — the GESTURE PLATFORM.
//
// The MAJOR-A test this replaces hand-built BOTH sides of the boundary it
// claimed to prove: it constructed drag = { kind:'lib', el:libCard,
// moved:true } with no touch axis at all, then CALLED click({target:...})
// itself and asserted the click was swallowed. It asserted the very fact under
// test — that a click follows the gesture — so it could not fail for the path
// where none follows (a MOVED touch drag, where Chromium's 15px tap-slop
// threshold suppresses the compatibility click). That is E10/E11's false-green
// shape, and it is why 7,793 passing tests missed a guard that ate the
// operator's next real tap on every touch release.
//
// Here the product's own adapters run the whole gesture — dragSourceFor,
// startDrag, onDragMove/onTouchMove, onDragUp/onTouchEnd, endDrag, dragEndAt,
// clickWillReachLibCard and the board's real click listener, every one of them
// sliced out of the SERVED island. The harness supplies only the PLATFORM:
// hit-testing, event delivery, and the browser's own compatibility-click rule,
// each clause of it MEASURED in Chromium on the running worker rather than
// assumed —
//   * a mouse gesture always ends in a click, fired at the nearest common
//     ancestor of the press and release targets (startDrag's preventDefault on
//     MOUSEDOWN cancels focus/selection/native-drag, never the click):
//     measured 1 click reaching the card on a mouse release back on the source
//     card, 0 on a release anywhere else;
//   * a touch sequence ends in a compatibility click only when it did NOT move
//     (a moved touch is a drag, not a tap). Chromium's touchmove-slop suppressor
//     and tap-slop click threshold are the same 15px constant: below 15px of
//     travel the browser delivers a compatibility click and suppresses touchmove
//     entirely; at/above 15px it delivers touchmove and no click. Measured:
//     Δ 6–15 → 0 touchmoves, 1 click; Δ 16–18 → 1 touchmove, 0 clicks (touch@1280/375).
// Nothing here hand-fires a click: the platform decides from the gesture that
// was dispatched, and the product's real handlers are what run inside it.
//
// The two top-level entry listeners are anonymous 2-line bodies that
// sliceIslandFunction cannot key on, so press() reproduces them; the exact
// bytes reproduced are pinned by the "touch is wired end to end" test above
// ("var src = dragSourceFor(ev.target, false);" / "..., true);").
type Modality = "mouse" | "touch";
type Landing = "source-card" | "other-card" | "funnel-column" | "void";
interface Pt { x: number; y: number }
interface DragElStub extends ColStub { querySelector(sel: string): null }
function dragElStub(attrs: Record<string, string>, closestMap: Record<string, ColStub | null> = {}): DragElStub {
  return { ...colStub(attrs, closestMap), querySelector: () => null };
}
interface GestureOutcome {
  clicksOnLibCard: number;
  clicksDelivered: number;
  guardArmedAfterGesture: boolean;
  refusals: string[];
  pickersOpenedByGesture: number;
  pickersOpenedByNextTap: number;
  addedToBoard: unknown[];
}

function driveBoardGesture(html: string, opts: { modality: Modality; landing: Landing; nextTap: boolean }): GestureOutcome {
  const island = boardIsland(html);
  const far = FUNNELS[3]!;
  const isTouch = opts.modality === "touch";

  // --- the surfaces, carrying the SERVED elements' own attributes
  const cardAttrs = attrsOf(html, 'data-pin="8.2-library-card"');
  const sourceClosest: Record<string, ColStub | null> = {};
  const sourceCard = dragElStub(cardAttrs, sourceClosest);
  sourceClosest["[data-lib-card]"] = sourceCard;
  const otherClosest: Record<string, ColStub | null> = {};
  const otherCard = dragElStub({ ...cardAttrs, "data-section-public-id": "other" }, otherClosest);
  otherClosest["[data-lib-card]"] = otherCard;
  const farCol = colStub(attrsOf(html, `data-funnel-public-id="${far}"`));
  const gripStub = colStub({ "data-lib-grip": "" });
  const cardBody = colStub({}, { "[data-lib-card]": sourceCard });
  const cardGrip = colStub({}, { "[data-lib-card]": sourceCard, "[data-lib-grip]": gripStub });
  const otherBody = colStub({}, { "[data-lib-card]": otherCard });
  const colTarget = colStub({}, { "[data-funnel-col]": farCol });
  const bodyStub = colStub({});

  // --- the geometry the platform hit-tests: the rail and the board are
  // disjoint rectangles, exactly as they are on the served page.
  const inBox = (p: Pt, x0: number, y0: number, x1: number, y1: number) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
  const hitAt = (x: number, y: number): ColStub | null => {
    const p = { x, y };
    if (inBox(p, 24, 24, 44, 44)) return cardGrip;
    if (inBox(p, 20, 20, 260, 100)) return cardBody;
    if (inBox(p, 20, 120, 260, 200)) return otherBody;
    if (inBox(p, 500, 200, 900, 600)) return colTarget;
    return null;
  };
  const CARD_BODY_PT: Pt = { x: 140, y: 60 };
  const pressPt: Pt = isTouch ? { x: 34, y: 34 } : CARD_BODY_PT;
  const landingPt: Pt = opts.landing === "source-card" ? pressPt
    : opts.landing === "other-card" ? { x: 140, y: 160 }
      : opts.landing === "funnel-column" ? { x: 700, y: 400 }
        : { x: 700, y: 20 };

  const src = [
    sliceIslandVar(island, "TOUCH_MOVE_OPTS"),
    sliceIslandVar(island, "DROP_OUTSIDE_MESSAGE"),
    sliceIslandVar(island, "DROP_UNRESOLVED_MESSAGE"),
    sliceIslandVar(island, "DRAG_SKIP_SELECTOR"),
    sliceIslandFunction(island, "dragSourceFor"),
    sliceIslandFunction(island, "touchPoint"),
    sliceIslandFunction(island, "startDrag"),
    sliceIslandFunction(island, "dragMoveAt"),
    sliceIslandFunction(island, "onDragMove"),
    sliceIslandFunction(island, "onTouchMove"),
    sliceIslandFunction(island, "endDrag"),
    sliceIslandFunction(island, "onDragUp"),
    sliceIslandFunction(island, "onTouchEnd"),
    sliceIslandFunction(island, "onTouchCancel"),
    sliceIslandFunction(island, "dropTargetUnder"),
    sliceIslandFunction(island, "releaseOverLibCard"),
    sliceIslandFunction(island, "clickWillReachLibCard"),
    sliceIslandFunction(island, "dragEndAt"),
    "var openPopoverCalls = [];",
    "function openPopoverList(anchor, items, onPick) { openPopoverCalls.push({ anchor: anchor }); }",
    "function boardTargetItems() { return ['stub-target']; }",
    "function addSectionToBoardTarget() {}",
    "var handleClick = " + sliceIslandClickHandler(island) + ";",
    "__drive(dragSourceFor, startDrag, handleClick);",
  ].join("\n");

  const listeners: Record<string, Array<(ev: unknown) => void>> = {};
  const fire = (type: string, ev: unknown): void => { for (const fn of [...(listeners[type] ?? [])]) fn(ev); };
  const refusals: string[] = [];
  const addedToBoard: unknown[] = [];
  const clicksTo: Array<ColStub> = [];
  // sampled the instant the gesture ends and BEFORE the platform delivers any
  // click -- the click handler consumes the one-shot flag, so a later read
  // cannot tell "never armed" from "armed and consumed".
  const armedAtRelease: boolean[] = [];
  const TAP_SLOP = 15; // Chromium's tap slop (measured): past it the sequence is a drag, not a tap
  let seqDefaultPrevented = false;
  let movedBeyondTapSlop = false;
  let pressPoint: Pt = { x: 0, y: 0 };
  let pressHit: ColStub | null = null;

  const ctx: Record<string, unknown> = {
    ...SANDBOX_BUILTINS,
    suppressNextLibClick: false,
    drag: null,
    openMenuEl: null,
    abDialog: null,
    ruledDialog: null,
    document: {
      addEventListener: (type: string, fn: (ev: unknown) => void) => { (listeners[type] ??= []).push(fn); },
      removeEventListener: (type: string, fn: (ev: unknown) => void) => { listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn); },
      elementFromPoint: (x: number, y: number) => hitAt(x, y),
    },
    // browser-primitive decorations with no node equivalent (their own tests
    // above drive them): the ghost, the highlight sweep and the auto-scroller.
    ensureGhost: () => undefined,
    refreshDropTarget: () => null,
    autoScrollFor: () => undefined,
    stopAutoScroll: () => undefined,
    clearDropTargets: () => undefined,
    showInlineErr: (_el: unknown, msg: string) => { refusals.push(msg); },
    funnelByPublic: (pub: string) => (pub === far ? { public_id: far, pages: [{ page_id: "p1", slots: [] }] } : null),
    addSectionToShared: () => addedToBoard.push({ scope: "shared" }),
    addSectionToFunnelPage: (m: { public_id: string }, pi: number, pub: string) => addedToBoard.push({ funnel: m.public_id, pageIndex: pi, section: pub }),
    funnelOfEl: () => null,
    pageIndexOfEl: () => -1,
    saveFunnel: () => undefined,
    __drive: (
      dragSourceFor: (t: ColStub | null, isT: boolean) => { kind: string; el: ColStub } | null,
      startDrag: (kind: string, el: ColStub, ev: unknown, isT: boolean) => void,
      handleClick: (ev: unknown) => void,
    ): void => {
      const press = (pt: Pt): void => {
        seqDefaultPrevented = false;
        movedBeyondTapSlop = false;
        pressPoint = pt;
        pressHit = hitAt(pt.x, pt.y);
        const found = dragSourceFor(pressHit, isTouch);
        if (!found) { return; }
        const ev = isTouch
          ? { touches: [{ clientX: pt.x, clientY: pt.y }], changedTouches: [{ clientX: pt.x, clientY: pt.y }], cancelable: true, preventDefault: () => { seqDefaultPrevented = true; } }
          : { clientX: pt.x, clientY: pt.y, button: 0, preventDefault: () => undefined };
        startDrag(found.kind, found.el, ev, isTouch);
      };
      const move = (pt: Pt): void => {
        if (Math.abs(pt.x - pressPoint.x) > TAP_SLOP || Math.abs(pt.y - pressPoint.y) > TAP_SLOP) movedBeyondTapSlop = true;
        if (isTouch) fire("touchmove", { touches: [{ clientX: pt.x, clientY: pt.y }], cancelable: true, preventDefault: () => { seqDefaultPrevented = true; } });
        else fire("mousemove", { clientX: pt.x, clientY: pt.y });
      };
      const release = (pt: Pt): void => {
        const releaseHit = hitAt(pt.x, pt.y);
        if (isTouch) fire("touchend", { touches: [], changedTouches: [{ clientX: pt.x, clientY: pt.y }], cancelable: true, preventDefault: () => { seqDefaultPrevented = true; } });
        else fire("mouseup", { clientX: pt.x, clientY: pt.y });
        armedAtRelease.push(ctx["suppressNextLibClick"] === true);
        // ---- the PLATFORM's compatibility-click rule (see the note above)
        if (isTouch && (movedBeyondTapSlop || seqDefaultPrevented)) { return; }
        const target = pressHit !== null && pressHit === releaseHit ? releaseHit : bodyStub;
        clicksTo.push(target);
        handleClick({ target, stopPropagation: () => undefined });
      };

      press(pressPt);
      move({ x: pressPt.x + 20, y: pressPt.y + 20 });
      move({ x: 400, y: 300 });
      move(landingPt);
      release(landingPt);
      // read BEFORE the next tap: pickers the GESTURE itself opened
      (ctx["__split"] as unknown[]).push((ctx["openPopoverCalls"] as unknown[]).length);
      if (opts.nextTap) {
        // the operator's very next, SEPARATE gesture: a plain tap/click on the
        // card body. Nothing is hand-fired — a tap moves nothing, so nothing
        // calls preventDefault, so the platform delivers its click.
        press(CARD_BODY_PT);
        release(CARD_BODY_PT);
      }
    },
    __split: [] as unknown[],
  };
  runInNewContext(src, ctx);
  const pickers = (ctx["openPopoverCalls"] as unknown[]).length;
  const split = ctx["__split"] as unknown[];
  const byGesture = (split[0] as number | undefined) ?? 0;
  return {
    clicksOnLibCard: clicksTo.filter((t) => t.closest("[data-lib-card]") !== null).length,
    clicksDelivered: clicksTo.length,
    guardArmedAfterGesture: armedAtRelease[0] === true,
    refusals,
    pickersOpenedByGesture: byGesture,
    pickersOpenedByNextTap: pickers - byGesture,
    addedToBoard,
  };
}

let HTML = "";
let FUNNELS: string[] = [];
let SECTION_PUB = "";
let RULE_NAME = "";

describeDb("P8 B5 — funnels side by side, and every column reachable by drag / keyboard / touch", () => {
  beforeAll(async () => {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb));
    const credit = seedSection(sdb, "Credit Score", "car");
    const zip = seedSection(sdb, "ZIP code", "car");
    SECTION_PUB = credit.public_id;

    const cq = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "Side by side", activity: "quote_funnel", verticals: ["car"] }), env);
    expect(cq.status, `create quote: ${await cq.clone().text()}`).toBe(201);
    const quote = (await cq.json()) as { public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> };
    FUNNELS = [quote.funnels[0]!.public_id];
    // The acceptance is stated "with 4 funnels" — seed exactly that.
    for (const name of ["Funnel B", "Funnel C", "Funnel D"]) {
      const cf = await admin.request(`${API}/quotes/${quote.public_id}/funnels`, jsonInit("POST", { funnel_name: name }), env);
      expect(cf.status, `create ${name}: ${await cf.clone().text()}`).toBe(201);
      FUNNELS.push(((await cf.json()) as { public_id: string }).public_id);
    }
    const pv = await admin.request(`${API}/variants/${quote.funnels[0]!.variants[0]!.public_id}`, jsonInit("PUT", { pages: [{ name: null, slots: [{ kind: "fixed", section_id: credit.public_id }] }] }), env);
    expect(pv.status, `variant pages: ${await pv.clone().text()}`).toBe(200);
    const sp = await admin.request(`${API}/quotes/${quote.public_id}/shared-page`, jsonInit("POST", { sections: [{ section_id: zip.id }] }), env);
    expect(sp.status, `shared page: ${await sp.clone().text()}`).toBe(201);

    // P8-2 MAJOR-2: a REAL routing rule through the LANDED create endpoint (not
    // hand-built), long enough to exercise .lg-qr-name's truncation the same
    // way the review measured it (scrollWidth 451 / clientWidth 112 at 1280).
    RULE_NAME = "Route high-intent car shoppers from a paid campaign to the premium funnel";
    const cr = await admin.request(
      `${API}/quotes/${quote.public_id}/routing-rules`,
      jsonInit("POST", { rule_name: RULE_NAME, target_funnel_id: FUNNELS[0] }),
      env,
    );
    expect(cr.status, `create routing rule: ${await cr.clone().text()}`).toBe(201);

    HTML = await (await admin.request(`/admin/leadgen/quotes/${quote.public_id}/edit`, {}, env)).text();
    sdb.close();
  });

  // ---------------------------------------------------------------- geometry
  it("the four funnel columns render, and BOTH rails stay (no width was bought by deleting one)", () => {
    // the rendered column ELEMENTS (the attribute alone also appears in the
    // island's selectors, so count the column's own pin).
    expect((HTML.match(/data-pin="8\.2-funnel-column"/g) ?? []).length).toBe(4);
    expect(HTML).toContain('class="lg-board-left"');
    expect(HTML).toContain('class="lg-board-right"');
    expect(HTML).toContain("data-rules-rail");
  });

  it("ACCEPTANCE (1280): both rails + the shared band + TWO whole funnel columns fit the shell", () => {
    // The shell's own width at a 1280 viewport, measured on the running
    // worker: admin nav 250 + page padding 24+24 = 298 of chrome, shell 982.
    // (Chromium, /admin/leadgen/quotes/:id/edit, .lg-board-shell rect
    //  [274..1256].) Everything else below is read out of the SERVED CSS.
    const ADMIN_CHROME_1280 = 298;
    const shell = 1280 - ADMIN_CHROME_1280;
    const t = cssTokens(HTML, 1439);
    expect(Object.keys(t).sort(), "1280 lands in the <=1439 step").toEqual(
      ["lg-board-pad", "lg-col-gap", "lg-col-w", "lg-rail-l", "lg-rail-r"],
    );
    const centre = shell - t["lg-rail-l"]! - t["lg-rail-r"]! - 2 /* the two rail borders */;
    const visible = centre - 2 * t["lg-board-pad"]!;
    const twoColumns = 2 * t["lg-col-w"]! + t["lg-col-gap"]!;
    expect(visible, `centre ${visible}px must hold two ${t["lg-col-w"]}px columns + a ${t["lg-col-gap"]}px gap`).toBeGreaterThanOrEqual(twoColumns);
    // ... and the shared first page is NOT competing for that width (it is the
    // band above the scroller, asserted structurally below).
  });

  it("the lane + column widths are tokens that step down below the design-pack's 1600 reference", () => {
    const base = cssTokens(HTML, null);
    expect(base["lg-rail-l"], "design-pack left rail").toBe(292);
    expect(base["lg-rail-r"], "design-pack right rail").toBe(344);
    expect(base["lg-col-w"], "design-pack column").toBe(288);
    const mid = cssTokens(HTML, 1599);
    const narrow = cssTokens(HTML, 1439);
    expect(mid["lg-col-w"]!).toBeLessThan(base["lg-col-w"]!);
    expect(narrow["lg-col-w"]!).toBeLessThan(mid["lg-col-w"]!);
    expect(narrow["lg-rail-l"]!).toBeGreaterThan(0);
    expect(narrow["lg-rail-r"]!).toBeGreaterThan(0);
    expect(HTML, "columns consume the token").toContain(".lg-col{flex:0 0 var(--lg-col-w);width:var(--lg-col-w)");
    expect(HTML, "the rails consume the tokens").toContain(".lg-board-left{flex:0 0 var(--lg-rail-l);width:var(--lg-rail-l)");
    expect(HTML).toContain(".lg-board-right{flex:0 0 var(--lg-rail-r);width:var(--lg-rail-r)");
  });

  it("the shared first page is genuinely pinned: it renders ABOVE the scroller, not inside it, and its dead sticky is gone", () => {
    const centreAt = HTML.indexOf('<div class="lg-board-center">');
    const sharedAt = HTML.indexOf('class="lg-col-shared"');
    const boardAt = HTML.indexOf('<div class="lg-board" data-board');
    const colsAt = HTML.indexOf('<div class="lg-board-cols"');
    expect(centreAt).toBeGreaterThan(-1);
    expect(sharedAt, "shared band inside .lg-board-center").toBeGreaterThan(centreAt);
    expect(sharedAt, "shared band BEFORE the scrolling .lg-board").toBeLessThan(boardAt);
    expect(sharedAt, "shared band is not part of the scrolled column list").toBeLessThan(colsAt);
    expect(HTML).not.toContain(".lg-col-shared{position:sticky");
    // the hooks other code resolves through it are untouched
    expect(HTML).toContain("data-shared-col");
    expect(HTML).toContain("data-shared-page-card");
    expect(HTML).toContain("data-add-shared-section");
  });

  // ------------------------------------------------------------------ island
  it("island code (board + timer stubbed): holding a drag at the board's right edge auto-scrolls it; holding it mid-board does not", () => {
    const island = boardIsland(HTML);
    const src = [
      sliceIslandVar(island, "AUTO_SCROLL_EDGE"),
      sliceIslandVar(island, "AUTO_SCROLL_STEP"),
      sliceIslandVar(island, "AUTO_SCROLL_MS"),
      sliceIslandFunction(island, "stopAutoScroll"),
      sliceIslandFunction(island, "armAutoScroll"),
      sliceIslandFunction(island, "autoScrollFor"),
      "__capture(autoScrollFor, tick);",
    ].join("\n");

    const runEdge = (pointerX: number): number => {
      const board = { scrollLeft: 0, getBoundingClientRect: () => ({ left: 500, right: 990, top: 300, bottom: 800 }) };
      const drag: Record<string, unknown> = { x: pointerX, y: 500, scrollDir: 0 };
      let ticker: (() => void) | null = null;
      let timer: unknown = null;
      const win = {
        setInterval: (fn: () => void) => { ticker = fn; timer = 1; return 1; },
        clearInterval: () => { ticker = null; timer = null; },
      };
      runInNewContext(src, {
        ...SANDBOX_BUILTINS,
        board, drag, window: win, autoScrollTimer: null,
        refreshDropTarget: () => null,
        tick: () => { for (let i = 0; i < 40 && ticker !== null; i += 1) (ticker as () => void)(); },
        __capture: (fn: (x: number, y: number) => void, run: () => void) => { fn(pointerX, 500); run(); },
      });
      void timer;
      return board.scrollLeft;
    };

    expect(runEdge(975), "pointer inside the right edge zone -> the board scrolls itself").toBeGreaterThan(0);
    expect(runEdge(740), "pointer mid-board -> no auto-scroll").toBe(0);
    expect(runEdge(505), "pointer inside the left edge zone -> scrolls back (clamped at 0 here)").toBeLessThanOrEqual(0);
  });

  it("island code + REAL served attributes (DOM primitives stubbed): a drop on a funnel column that needed scrolling adds the section to THAT funnel; a drop on nothing gives a visible reason", () => {
    const island = boardIsland(HTML);
    const far = FUNNELS[3]!;
    const src = [
      sliceIslandVar(island, "DROP_OUTSIDE_MESSAGE"),
      sliceIslandVar(island, "DROP_UNRESOLVED_MESSAGE"),
      // the RESOLVER is the product's own, not a test-authored target shape
      sliceIslandFunction(island, "dropTargetUnder"),
      sliceIslandFunction(island, "releaseOverLibCard"),
      sliceIslandFunction(island, "clickWillReachLibCard"),
      sliceIslandFunction(island, "dragEndAt"),
      "__capture(dragEndAt);",
    ].join("\n");

    // the far column exactly as the server rendered it
    const farColAttrs = attrsOf(HTML, `data-funnel-public-id="${far}"`);
    expect(farColAttrs["data-pin"], "the stub carries the SERVED column's attributes").toBe("8.2-funnel-column");

    const drive = (hit: ColStub | null, dragOverride?: Record<string, unknown>): { added: unknown[]; errs: string[] } => {
      const added: unknown[] = [];
      const errs: string[] = [];
      const libEl = colStub({ "data-section-public-id": SECTION_PUB });
      runInNewContext(src, {
        ...SANDBOX_BUILTINS,
        drag: dragOverride ?? { kind: "lib", el: libEl, moved: true },
        document: { elementFromPoint: () => hit },
        endDrag: () => undefined,
        showInlineErr: (_el: unknown, msg: string) => { errs.push(msg); },
        funnelByPublic: (pub: string) => (pub === far ? { public_id: far, pages: [{ page_id: "p1", slots: [] }] } : null),
        addSectionToShared: () => added.push({ scope: "shared" }),
        addSectionToFunnelPage: (model: { public_id: string }, pageIndex: number, pub: string) => added.push({ funnel: model.public_id, pageIndex, section: pub }),
        funnelOfEl: () => null,
        pageIndexOfEl: () => -1,
        saveFunnel: () => undefined,
        __capture: (fn: (x: number, y: number) => void) => fn(900, 500),
      });
      return { added, errs };
    };

    const farCol = colStub(farColAttrs);
    const onFarColumn = drive(colStub({}, { "[data-funnel-col]": farCol }));
    expect(onFarColumn.added, "the section lands in the far column").toEqual([{ funnel: far, pageIndex: 0, section: SECTION_PUB }]);
    expect(onFarColumn.errs).toEqual([]);

    const onNothing = drive(null);
    expect(onNothing.added, "nothing is written").toEqual([]);
    expect(onNothing.errs.length, "the operator is told why").toBe(1);
    expect(onNothing.errs[0]).toContain("Dropped outside a funnel");

    // Same class, the other instance: a shared-page chip dragged back onto the
    // shared page used to be a no-op with no message at all.
    const sharedChip = colStub({ "data-chip-scope": "shared" });
    const sharedCard = colStub(attrsOf(HTML, 'class="lg-page-card" data-shared-page-card'));
    const sharedCol = colStub(attrsOf(HTML, 'data-pin="8.2-shared-first-page"'));
    expect(sharedCol.attrs["data-pin"], "the stub carries the SERVED band's attributes").toBe("8.2-shared-first-page");
    const sharedOnShared = drive(
      colStub({}, { "[data-shared-page-card]": sharedCard, "[data-shared-col]": sharedCol }),
      { kind: "chip", el: sharedChip, moved: true },
    );
    expect(sharedOnShared.added).toEqual([]);
    expect(sharedOnShared.errs.length, "the operator is told why").toBe(1);
    expect(sharedOnShared.errs[0]).toContain("keeps the order its sections were added in");
  });

  it("the keyboard can OPEN the menus that are the a11y equivalent of the chip/page move drags, and operate them", () => {
    const island = boardIsland(HTML);
    // Enter/Space on a focused board affordance (all role=button divs, which
    // — unlike <button> — synthesise no click of their own).
    expect(island).toContain("var btn = t.closest('[role=\"button\"]');");
    // P8-2 review #5 (F3): the delegation says it is "scoped to the board's OWN
    // surfaces", and now it is. ".lg-board-left" alone was not: the Themes
    // tab's chooser rail (quotes-tabs/themes.ts renderSectionChooserPane)
    // reuses that class and fills it with role=button cards that already own a
    // click AND a keydown handler, so Enter there fired TWICE (measured live:
    // click = 1 POST /sections/preview, Enter = 2). The pin discriminates the
    // two rails, and both are rendered here to prove they are distinguishable.
    expect(island).toContain(
      "btn.closest('[data-board],[data-shared-col],.lg-board-left[data-pin=\"8.2-left-library\"]')",
    );
    expect(island, "the unscoped selector is gone").not.toContain(
      "btn.closest('[data-board],[data-shared-col],.lg-board-left')",
    );
    expect(HTML, "the board's own rail carries the pin the scope keys on").toContain(
      '<div class="lg-board-left" data-pin="8.2-left-library">',
    );
    // The ambiguity is not hypothetical: the SAME served editor page carries
    // both rails (one per tab panel), so a document-level delegation keyed on
    // the class alone reaches the other tab's cards.
    const rails = Array.from(HTML.matchAll(/class="lg-board-left" data-pin="([^"]+)"/g)).map((m) => m[1]!);
    expect(rails.sort(), "two .lg-board-left rails ship in one page").toEqual(["8.2-left-library", "r2-theme-chooser"]);
    // ...and on a focused menu item.
    expect(island).toContain("var mi = t.closest('.lg-menu-item');");
    // ...which is only reachable because an opened menu gets real tab stops.
    const openMenuSrc = sliceIslandFunction(island, "openMenu");
    expect(openMenuSrc).toContain("setAttribute('tabindex', '0')");
    expect(openMenuSrc).toContain("mItems[0].focus()");
    // The popover the library card's Enter/Space opens focuses its first item.
    const popover = sliceIslandFunction(island, "openPopoverList");
    expect(popover).toContain("el.setAttribute('tabindex', '0');");
    expect(popover).toContain("if (focusFirst && tm.firstChild && tm.firstChild.focus) { tm.firstChild.focus(); }");
    // A menu that would open below the fold is flipped, not left unreachable.
    const position = sliceIslandFunction(island, "positionAt");
    expect(position).toContain("window.innerHeight");
  });

  it("island code (funnel model stubbed): the keyboard picker offers the shared page AND every funnel, and routes to the picked one (not the default)", () => {
    const island = boardIsland(HTML);
    const picked = FUNNELS[2]!;
    const src = [
      sliceIslandVar(island, "SHARED_TARGET_KEY"),
      sliceIslandFunction(island, "boardTargetItems"),
      sliceIslandFunction(island, "addSectionToBoardTarget"),
      "__capture(boardTargetItems, addSectionToBoardTarget);",
    ].join("\n");
    const model = FUNNELS.map((pub, i) => ({ public_id: pub, name: "Funnel " + i, is_default: i === 0, pages: [{ page_id: "p", slots: [] }] }));
    let items: Array<{ label: string; value: string }> = [];
    const added: unknown[] = [];
    runInNewContext(src, {
      ...SANDBOX_BUILTINS,
      orderedFunnels: () => model,
      funnelByPublic: (pub: string) => model.find((m) => m.public_id === pub) ?? null,
      addSectionToShared: () => added.push({ scope: "shared" }),
      addSectionToFunnelPage: (m: { public_id: string }, pageIndex: number, pub: string) => added.push({ funnel: m.public_id, pageIndex, section: pub }),
      __capture: (list: () => Array<{ label: string; value: string }>, pick: (s: string, k: string, el: unknown) => void) => {
        items = list();
        pick(SECTION_PUB, picked, null);
      },
    });
    expect(items.map((i) => i.value), "shared + EVERY funnel, in board order").toEqual(["__shared__", ...FUNNELS]);
    expect(items[1]!.label, "the default funnel is named as such").toContain("(default)");
    expect(added, "the picked funnel is the one written, not the default").toEqual([{ funnel: picked, pageIndex: 0, section: SECTION_PUB }]);
  });

  it("touch is wired end to end: the island registers the touch stream and the GRIPS claim the gesture", () => {
    const island = boardIsland(HTML);
    for (const ev of ["touchstart", "touchmove", "touchend", "touchcancel"]) {
      expect(island, `${ev} handler`).toContain(`'${ev}'`);
    }
    expect(island).toContain("addEventListener('touchstart'");
    expect(island).toContain("document.addEventListener('touchmove', onTouchMove, TOUCH_MOVE_OPTS)");
    expect(island).toContain("passive: false");
    // Without this the browser scrolls instead of handing us the gesture...
    expect(HTML).toContain(".lg-chip-grip,.lg-page-grip,.lg-lib-card .lg-grip{touch-action:none}");
    // ...and P8-2 F-2: it may NOT be the whole library card. The card is
    // essentially the entire left rail; claiming it stopped the rail
    // scrolling under a finger (measured 0px of travel on a 190px swipe,
    // a drag ghost, and a red "Dropped outside a funnel" on release).
    expect(HTML, "touch-action:none must not cover the whole library card").not.toMatch(
      /(^|[,{])\.lg-lib-card[,{][^}]*touch-action:none/,
    );
    expect(HTML, "the grip is a real hook the island can test for").toContain("data-lib-grip");
    // ONE source list for both input paths, told which input it is serving.
    expect(island).toContain("var src = dragSourceFor(ev.target, false);");
    expect(island).toContain("var src = dragSourceFor(ev.target, true);");
  });

  // ------------------------------------------------- P8-2 review round fixes
  it("F-2 island code (target stubbed): a finger drags a library card only from its grip; a mouse still drags the card body", () => {
    const island = boardIsland(HTML);
    const src = [
      sliceIslandVar(island, "DRAG_SKIP_SELECTOR"),
      sliceIslandFunction(island, "dragSourceFor"),
      "__capture(dragSourceFor);",
    ].join("\n");
    const card = colStub(attrsOf(HTML, 'data-pin="8.2-library-card"'));
    expect(card.attrs["data-lib-card"], "the stub is the SERVED library card").toBe("");
    const onBody = colStub({}, { "[data-lib-card]": card, "[data-lib-grip]": null });
    const onGrip = colStub({}, { "[data-lib-card]": card, "[data-lib-grip]": colStub({}) });

    const ask = (target: ColStub, isTouch: boolean): string | null => {
      let out: { kind: string } | null = null;
      runInNewContext(src, {
        ...SANDBOX_BUILTINS,
        __capture: (fn: (t: ColStub, b: boolean) => { kind: string } | null) => { out = fn(target, isTouch); },
      });
      return out === null ? null : (out as { kind: string }).kind;
    };

    expect(ask(onBody, true), "a finger on the card BODY is the rail's scroll gesture").toBe(null);
    expect(ask(onGrip, true), "a finger on the grip drags").toBe("lib");
    expect(ask(onBody, false), "a mouse has no scroll gesture to lose").toBe("lib");
    expect(ask(onGrip, false), "a mouse on the grip drags too").toBe("lib");
  });

  it("F-1 class check: EVERY board-decoration cleanup helper sweeps the whole document, not just .lg-board", () => {
    const island = boardIsland(HTML);
    // Alerts and drop highlights are anchored to surfaces on BOTH sides of the
    // .lg-board boundary — the shared first page is a band ABOVE the scroller
    // (asserted structurally above). A cleanup scoped narrower than the set of
    // surfaces its decoration can be anchored to leaves half of them on screen
    // forever: that is exactly how a refusal on the shared band survived every
    // later action and contradicted the next one.
    const names = Array.from(island.matchAll(/function (clear[A-Z]\w*)\(/g)).map((m) => m[1]!);
    expect(names, "both board-decoration sweeps live in this island").toEqual(
      expect.arrayContaining(["clearInlineErrs", "clearDropTargets"]),
    );
    const receivers: Array<[string, string]> = [];
    for (const n of names) {
      for (const m of sliceIslandFunction(island, n).matchAll(/(\w+)\.querySelectorAll\(/g)) receivers.push([n, m[1]!]);
    }
    expect(receivers.filter(([n]) => n === "clearInlineErrs").length, "the alert sweep").toBe(1);
    expect(receivers.filter(([n]) => n === "clearDropTargets").length, "the drop-highlight sweep").toBe(1);
    expect(receivers.filter(([, recv]) => recv !== "document"), "cleanup scoped narrower than the anchors").toEqual([]);
  });

  it("F-1 island code (document stubbed): clearInlineErrs removes an alert that lives OUTSIDE .lg-board", () => {
    const island = boardIsland(HTML);
    const src = [sliceIslandFunction(island, "clearInlineErrs"), "__capture(clearInlineErrs);"].join("\n");
    const removed: string[] = [];
    const alert = (where: string) => ({ where, parentNode: { removeChild: () => removed.push(where) } });
    const inBoard = alert("inside .lg-board");
    const onSharedBand = alert("shared band, outside .lg-board");
    runInNewContext(src, {
      ...SANDBOX_BUILTINS,
      document: { querySelectorAll: () => [inBoard, onSharedBand] },
      board: { querySelectorAll: () => [inBoard] },   // what the bug could see
      __capture: (fn: () => void) => fn(),
    });
    expect(removed, "both surfaces are swept").toEqual(["inside .lg-board", "shared band, outside .lg-board"]);
  });

  it("F-3 island code (layout stubbed): an anchored refusal goes INSIDE a row-mounted anchor, never beside it", () => {
    const island = boardIsland(HTML);
    const src = [
      sliceIslandFunction(island, "isRowFlow"),
      sliceIslandFunction(island, "placeInlineErr"),
      "__capture(placeInlineErr);",
    ].join("\n");
    // Beside a row item the alert became a lane column of its own: measured
    // 73px wide, nine one-word lines, and it pushed the funnel columns
    // sideways (x 503 -> 450, two fully-visible columns down to one).
    const run = (parentStyle: Record<string, string>, hasBody: boolean, bodyStyle: Record<string, string>) => {
      const inserted: Array<{ into: string }> = [];
      const body = { name: "col-body", firstChild: null as unknown, insertBefore: () => inserted.push({ into: "col-body" }) };
      const parent = { name: "parent", nodeType: 1, insertBefore: () => inserted.push({ into: "parent" }) };
      const anchor = {
        name: "anchor", nodeType: 1, parentNode: parent, nextSibling: null as unknown, firstChild: null as unknown,
        querySelector: (sel: string) => (hasBody && sel === ".lg-col-body" ? body : null),
        insertBefore: () => inserted.push({ into: "anchor" }),
      };
      const styles = new Map<unknown, Record<string, string>>([[parent, parentStyle], [body, bodyStyle], [anchor, bodyStyle]]);
      const p: Record<string, unknown> = { style: {} };
      runInNewContext(src, {
        ...SANDBOX_BUILTINS,
        board: { firstChild: null, insertBefore: () => inserted.push({ into: "board" }) },
        window: { getComputedStyle: (el: unknown) => styles.get(el) ?? { display: "block" } },
        __capture: (fn: (a: unknown, b: unknown) => void) => fn(p, anchor),
      });
      return { inserted, flex: (p["style"] as Record<string, string>)["flex"] };
    };

    const row = { display: "flex", flexDirection: "row" };
    const block = { display: "block" };
    const inLane = run(row, true, block);
    expect(inLane.inserted, "a column in the funnel lane hosts its own alert").toEqual([{ into: "col-body" }]);
    expect(inLane.flex, "a block host needs no basis override").toBeUndefined();

    const inWrapRow = run(row, false, row);
    expect(inWrapRow.inserted, "a card in the shared band hosts it too").toEqual([{ into: "anchor" }]);
    expect(inWrapRow.flex, "and it claims a whole row, not a slice of one").toBe("1 0 100%");

    const inColumn = run(block, true, block);
    expect(inColumn.inserted, "an anchor already in a column flow keeps the sibling placement").toEqual([{ into: "parent" }]);
  });

  it("F-9: a truncated library-card name still tells the operator which section it is", () => {
    // The rail tokens step 292 -> 256 -> 216, clipping .lg-lc-name to 137px at
    // 1280 while these names measure 164/188/196 — two similarly-prefixed
    // sections read identically on the drag source without a tooltip.
    expect(HTML, "the name carries its full text as a title").toContain('<span class="lg-lc-name" title="');
    const names = Array.from(HTML.matchAll(/<span class="lg-lc-name" title="([^"]*)">([^<]*)</g));
    expect(names.length, "every library card").toBeGreaterThan(0);
    for (const [, title, text] of names) expect(title, "the tooltip is the full name").toBe(text);
    expect(HTML).toContain("overflow:hidden;text-overflow:ellipsis");
  });

  // ------------------------------------------------- P8-2 FIX-ROUND-2 (N1)
  it("MAJOR-1 sibling: every board section chip (shared page + funnel page) carries its full name as a title, not just the library card", () => {
    // renderSectionChip is the ONE function behind the shared-page chip
    // (fixed/ruled/A-B), the shared page's legacy flat chip, AND every
    // funnel-page chip -- so this single served-HTML sweep covers all three
    // call sites at once. FAIL-BEFORE: 0 `.lg-sc-name` spans carried a title
    // attribute at all (the span was bare `<span class="lg-sc-name">`).
    const chips = Array.from(HTML.matchAll(/<span class="lg-sc-name" title="([^"]*)">([^<]*)</g));
    expect(chips.length, "every rendered section chip").toBeGreaterThan(0);
    for (const [, title, text] of chips) expect(title, "the tooltip is the full section name").toBe(text);
    expect(HTML, "bare (title-less) chips are gone").not.toContain('<span class="lg-sc-name">');
  });

  it("MAJOR-1 sibling: the funnel column's inline-rename name carries its full text as a title, and the shared column's static label carries one too (P8-2 MINOR-3: no unnamed exception left -- EVERY .lg-col-title does)", () => {
    // FAIL-BEFORE: the span was `... aria-label="Funnel name (click to
    // rename)">${name}</span>` -- no title, same clipped-with-no-tooltip
    // class as the library card and the section chip.
    const names = Array.from(HTML.matchAll(/<span class="lg-col-title" data-funnel-name[^>]*title="([^"]*)"[^>]*>([^<]*)</g));
    expect(names.length, "every funnel column").toBe(FUNNELS.length);
    for (const [, title, text] of names) expect(title, "the tooltip is the full funnel name").toBe(text);
    // P8-2 MINOR-3 (review #4): the shared-page column's OWN title used to be
    // a fixed dev label ("Shared first page") rendered WITHOUT a title -- a
    // harmless gap today (it is a fixed literal that never truncates,
    // measured scrollWidth 300 == clientWidth 300) but an UNNAMED exception
    // to "every ellipsis-styled .lg-col-title carries a title" all the same.
    // Closed by giving it one rather than special-casing it, so the
    // invariant holds with zero exceptions instead of one undocumented one.
    expect(HTML).toContain('<div class="lg-col-title-row"><span class="lg-col-title" title="Shared first page">Shared first page</span></div>');
    expect(HTML, "no bare (title-less) .lg-col-title survives").not.toContain('<span class="lg-col-title">Shared first page</span>');
  });

  // ------------------------------------------------- P8-2 FIX-ROUND-3 (MAJOR-2)
  it("MAJOR-2: a FOURTH truncated name, mounted from ui-rules-builder.ts's right rail (not a file this test's OTHER assertions touch) -- the rule name carries its full text as a title", () => {
    // FAIL-BEFORE: the SSR span was bare `<span class="lg-qr-name"
    // data-qr-name>${name}</span>` -- no title, same class of defect as the
    // library card / section chip / funnel name, missed because
    // ui-rules-builder.ts is mounted into the board (funnel.ts:731) by a file
    // nobody who fixed the first three "owned". RULE_NAME (73 chars) is a
    // REAL rule authored through the LANDED POST /routing-rules endpoint.
    const names = Array.from(HTML.matchAll(/<span class="lg-qr-name" data-qr-name title="([^"]*)">([^<]*)</g));
    expect(names.length, "every rendered routing-rule card").toBeGreaterThan(0);
    for (const [, title, text] of names) {
      expect(title, "the tooltip is the full rule name").toBe(RULE_NAME);
      expect(text, "the visible text is the same full name (CSS, not markup, does the clipping)").toBe(RULE_NAME);
    }
    expect(HTML, "bare (title-less) rule names are gone").not.toContain('<span class="lg-qr-name" data-qr-name>');
    expect(HTML, "the rail's own clipping rule is unchanged").toContain(
      ".lg-qr-name{flex:1 1 auto;min-width:0;font-size:13px;font-weight:700;color:#14233a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    );
  });

  it("D11 (island code, target stubbed): a click/tap on a board library card opens the target picker, matching the Themes chooser sibling; a click that follows a real drag from the SAME card does not also open it", () => {
    const island = boardIsland(HTML);
    // the SERVED library card, exactly as the drag code (F-2 test above) reads it.
    const libCard = colStub(attrsOf(HTML, 'data-pin="8.2-library-card"'));
    expect(libCard.attrs["data-lib-card"], "the stub is the SERVED library card").toBe("");
    const tapTarget = colStub({}, { "[data-lib-card]": libCard });

    const src = [
      "var openPopoverCalls = [];",
      "function openPopoverList(anchor, items, onPick) { openPopoverCalls.push({ anchor: anchor, items: items, onPick: onPick }); }",
      "function boardTargetItems() { return ['stub-target']; }",
      "function addSectionToBoardTarget() {}",
      "var handleClick = " + sliceIslandClickHandler(island) + ";",
      "__capture(handleClick);",
    ].join("\n");

    const drive = (suppressedBefore: boolean): { calls: number; suppressAfter: boolean; anchorIsCard: boolean } => {
      const ctx: Record<string, unknown> = {
        ...SANDBOX_BUILTINS,
        suppressNextLibClick: suppressedBefore,
        // Read (never written) by earlier, unrelated branches this click must
        // fall through before reaching data-lib-card (no A/B or ruled editor
        // dialog is open in this scenario).
        abDialog: null,
        ruledDialog: null,
        __capture: (fn: (ev: unknown) => void) => fn({ target: tapTarget, stopPropagation: () => undefined }),
      };
      runInNewContext(src, ctx);
      const calls = ctx["openPopoverCalls"] as Array<{ anchor: unknown }>;
      return { calls: calls.length, suppressAfter: ctx["suppressNextLibClick"] as boolean, anchorIsCard: calls[0]?.anchor === libCard };
    };

    const tapped = drive(false);
    expect(tapped.calls, "a plain tap/click opens the picker").toBe(1);
    expect(tapped.anchorIsCard, "the picker anchors on the tapped card").toBe(true);
    expect(tapped.suppressAfter, "no drag happened -- the flag stays false").toBe(false);

    const afterDrag = drive(true);
    expect(afterDrag.calls, "the click a real drag's mouseup can leave behind must NOT also open the picker").toBe(0);
    expect(afterDrag.suppressAfter, "the one-shot flag is consumed, not stuck suppressing forever").toBe(false);
  });

  // P8-2 review #5 — THE INVARIANT, driven through the product's own adapters
  // (driveBoardGesture above) on BOTH modalities. The guard is armed if and
  // only if a click will actually be delivered to a library card as a
  // consequence of the gesture that just ended.
  for (const modality of ["mouse", "touch"] as const) {
    it(`P8-2 MAJOR-A (${modality}): the one-shot click guard is armed if and only if this gesture actually delivers a click to a library card`, () => {
      // FAIL-BEFORE, in this order, one condition per review round:
      //   * "a drop target resolved" armed on the board landing (where no click
      //     can reach the rail) and left the source-card release unarmed, so
      //     the picker opened on top of the "Dropped outside" alert;
      //   * geometry alone (the condition this replaces) armed BOTH the mouse
      //     and the touch source-card releases -- but a moved touch gesture
      //     delivers no click at all (onTouchMove cancels it), so on touch the
      //     flag sat armed and ate the operator's next genuine tap. This test
      //     asserts `false` for the touch/source-card cell and `true` for the
      //     mouse one from the SAME table: geometry alone cannot satisfy both.
      const cells: Array<{ landing: Landing; clicks: number; armed: boolean; why: string }> = [
        { landing: "funnel-column", clicks: 0, armed: false, why: "landed on a funnel column: the board is disjoint from the rail, no click reaches a card" },
        { landing: "void", clicks: 0, armed: false, why: "dropped on nothing droppable: the click's common ancestor is above the rail" },
        { landing: "other-card", clicks: 0, armed: false, why: "released over a DIFFERENT library card: the common ancestor is the list, not a card" },
        {
          landing: "source-card",
          clicks: modality === "mouse" ? 1 : 0,
          armed: modality === "mouse",
          why: modality === "mouse"
            ? "released back on the SOURCE card: the platform's click lands inside it, so it must be swallowed"
            : "released back on the SOURCE card with a finger: a moved touch is a drag, not a tap, so no click follows it (measured 0) and arming would eat the operator's next real tap",
        },
      ];
      for (const cell of cells) {
        const out = driveBoardGesture(HTML, { modality, landing: cell.landing, nextTap: false });
        expect(out.clicksOnLibCard, `${modality} / ${cell.landing}: clicks the platform delivered to a library card`).toBe(cell.clicks);
        expect(out.guardArmedAfterGesture, `${modality} / ${cell.landing}: ${cell.why}`).toBe(cell.armed);
        // the guard is never armed by a gesture that also wrote to the board
        if (cell.landing === "funnel-column") expect(out.addedToBoard.length, "the board landing still adds the section").toBe(1);
      }
    });

    it(`P8-2 MAJOR-A + MAJOR-1 (${modality}, both halves wired together): a refused drag shows its reason and opens NO picker, and the operator's very next tap on the card opens exactly one`, () => {
      // FAIL-BEFORE (measured on the running worker before this fix, and
      // reproduced here): mouse@1280 next tap opened the picker, but
      // touch@1280 and touch@375 did NOT -- the guard armed on a touch release
      // that leaves no click behind swallowed the operator's next real tap.
      for (const landing of ["source-card", "void"] as const) {
        const out = driveBoardGesture(HTML, { modality, landing, nextTap: true });
        expect(out.refusals.length, `${modality} / ${landing}: the refused drop says why, exactly once`).toBe(1);
        expect(out.refusals[0]).toContain("Dropped outside a funnel");
        expect(out.pickersOpenedByGesture, `${modality} / ${landing}: the gesture itself never opens a picker on top of its own refusal`).toBe(0);
        expect(out.pickersOpenedByNextTap, `${modality} / ${landing}: the operator's next genuine tap opens the picker`).toBe(1);
        expect(out.guardArmedAfterGesture && out.clicksOnLibCard === 0, `${modality} / ${landing}: never armed with no click coming`).toBe(false);
        expect(out.addedToBoard, "a refused drop writes nothing").toEqual([]);
      }
    });
  }

  it("P8-2 MINOR-1: dragEndAt's '!f' branch (a resolved board target whose funnel is unknown) clears the one-shot click guard rather than leaving it stuck armed -- the third and last un-cleared no-reload path in this class (saveFunnel's and saveSharedSlots' own clears, above, are the other two)", () => {
    const island = boardIsland(HTML);
    const src = [
      sliceIslandVar(island, "DROP_OUTSIDE_MESSAGE"),
      sliceIslandVar(island, "DROP_UNRESOLVED_MESSAGE"),
      sliceIslandFunction(island, "dropTargetUnder"),
      sliceIslandFunction(island, "releaseOverLibCard"),
      sliceIslandFunction(island, "clickWillReachLibCard"),
      sliceIslandFunction(island, "dragEndAt"),
      "__capture(dragEndAt);",
    ].join("\n");
    const libEl = colStub({ "data-section-public-id": SECTION_PUB });
    const unknownCol = colStub({ "data-funnel-public-id": "unknown-funnel" });
    const ctx: Record<string, unknown> = {
      ...SANDBOX_BUILTINS,
      // Pre-armed as if a PRIOR release had left it set -- this proves the
      // branch itself clears the flag, not merely that this call never sets
      // it (armLibClickGuard is structurally false here: it can only be true
      // when dropTargetUnder found no target, and this scenario's target
      // DID resolve, to a funnel column dropTargetUnder read as valid).
      suppressNextLibClick: true,
      drag: { kind: "lib", el: libEl, moved: true },
      document: { elementFromPoint: () => colStub({}, { "[data-funnel-col]": unknownCol }) },
      endDrag: () => undefined,
      showInlineErr: () => undefined,
      funnelByPublic: () => null,
      addSectionToShared: () => undefined,
      addSectionToFunnelPage: () => undefined,
      __capture: (fn: (x: number, y: number) => void) => fn(900, 500),
    };
    runInNewContext(src, ctx);
    expect(ctx["suppressNextLibClick"], "FAIL-BEFORE true (stuck) / PASS-AFTER false: the !f path clears the guard").toBe(false);
  });
});
