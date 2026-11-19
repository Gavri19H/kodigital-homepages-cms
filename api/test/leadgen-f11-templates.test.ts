// F11 — Templates element "L · Redirect" (plan Section 3 G, Section 4 "Admin:
// Templates → L · Redirect", Section 8 "Templates → L · Redirect").
//
//   1. The tile "L · Redirect" shows after "J · Footer" (K stays free for F10),
//      and its panel offers every setting with the shared controls (role
//      strips, segmented buttons, toggles), plus the two preview buttons and
//      "Reset to defaults".
//   2. Through the REAL admin router (node:sqlite D1): every value saves and
//      reloads (PUT/GET /funnels/:id/frame); bad values are refused with a
//      plain message and nothing is stored; the canvas endpoint accepts a draft
//      carrying the block and returns the design tokens the preview reads.
//   3. The panel's own island: the defaults show on screen when nothing is
//      stored, and "Reset to defaults" — through the SAME change/click paths the
//      shared island writes from — leaves a block that resolves to the Theme
//      look on two Themes.
//   4. The preview twins (ES5, quotes-tabs/redirect-preview.ts) build the SAME
//      bytes as the server renderer for every look, and the preview drops the
//      sample offer's screen into the composed page's banners mount.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { renderTemplatesTabPanel } from "../src/admin/leadgen/quotes-tabs/templates";
import { redirectPreviewBoot, REDIRECT_PREVIEW_ISLAND_JS, REDIRECT_PREVIEW_BRAND } from "../src/admin/leadgen/quotes-tabs/redirect-preview";
import { FRAME_REDIRECT_ANIMATIONS, FRAME_SIZES, validateFrameConfig, type FrameRedirectConfig } from "../src/public/leadgen/designs/frames";
import { getFunnelDesign } from "../src/public/leadgen/designs/registry";
import { FUNNEL_TOKEN_ROLES, resolveTokens, type ThemeJson } from "../src/public/leadgen/designs/theme";
import { REDIRECT_LOOK_DEFAULTS, resolveRedirectLook } from "../src/public/leadgen/redirect/look";
import { renderRedirectMarkup, type RedirectMarkupInput } from "../src/public/leadgen/redirect/screen";
import { miniDocument, MiniNode } from "./helpers/mini-dom";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const PANEL = renderTemplatesTabPanel(true, []);

function islandSource(): string {
  const m = PANEL.match(/<script>([\s\S]*?)<\/script>/);
  expect(m, "the templates panel ships its inline island").not.toBeNull();
  return m![1] ?? "";
}

const EVERY_VALUE: Required<{ [K in keyof FrameRedirectConfig]: NonNullable<FrameRedirectConfig[K]> }> = {
  badge_on: false,
  badge_text: "Matched for {brand}",
  headline: "Good news",
  message_on: false,
  message: "{brand} is ready for you.",
  countdown_line: "Opening {brand} in {n}…",
  stay_label: "Not now",
  background_role: "surface_wash",
  border_role: "brand_primary",
  badge_role: "accent",
  badge_bg_role: "page_background",
  headline_role: "brand_primary",
  text_role: "text_primary",
  corners: "rounded",
  shadow: false,
  headline_size: "l",
  animation: "dots",
  animation_role: "accent",
  track_role: "surface_wash",
  animation_size: "s",
  show_seconds: false,
  only_headline: "Off to {brand}",
  only_message: "One moment, {n} seconds.",
  only_link: "See every offer",
};
const KEYS = Object.keys(EVERY_VALUE) as Array<keyof typeof EVERY_VALUE>;
const TEXT_KEYS = KEYS.filter((k) => typeof EVERY_VALUE[k] === "string" && !k.endsWith("_role") && !["corners", "headline_size", "animation", "animation_size"].includes(k));
const BOOL_KEYS = KEYS.filter((k) => typeof EVERY_VALUE[k] === "boolean");
const ROLE_KEYS = KEYS.filter((k) => k.endsWith("_role"));
const RADIO_KEYS = ["corners", "headline_size", "animation", "animation_size"] as const;

const BASE = getFunnelDesign(null);
const INSURISSIMO_THEME: ThemeJson = {
  palette: { brand_primary: "#0B6E4F", surface_wash: "#E3F4EC", border: "#C9DDD3", text_primary: "#14213D", text_muted: "#4F5D75" },
  typography: { display: "poppins", body: "manrope" },
  scales: { radius: "round" },
};
const THEMES = {
  "moneylantern-like": resolveTokens(BASE, {} as ThemeJson, null, null).design,
  "insurissimo-like": resolveTokens(BASE, INSURISSIMO_THEME, null, null).design,
};

// ===========================================================================
// 1 · the tile and the panel
// ===========================================================================

describe("F11 · Templates → \"L · Redirect\" tile and panel", () => {
  it("the tile shows after J · Footer, in its own Results page group; K stays free", () => {
    const tiles = [...PANEL.matchAll(/lg-tplbox-card-letter">([A-Z])<\/span>\s*<span>([^<]+)</g)].map((m) => `${m[1]}:${m[2]}`);
    expect(tiles.slice(-2)).toEqual(["J:Footer", "L:Redirect"]);
    expect(tiles.map((t) => t[0])).not.toContain("K");
    expect(PANEL).toContain('<div class="lg-tpl2-eyebrow">Results page</div>');
    expect(PANEL.indexOf('id="lg-tplbox-grid-results"')).toBeGreaterThan(PANEL.indexOf('id="lg-tplbox-grid-separate"'));
    const doc = miniDocument(PANEL);
    expect(doc.querySelectorAll('[data-tplbox-pick="redirect"]')).toHaveLength(1);
    expect(doc.querySelectorAll('[data-tplbox-panel="redirect"]')).toHaveLength(1);
  });

  it("offers every setting through the shared controls, in three groups, with the defaults shown", () => {
    const doc = miniDocument(PANEL);
    const panel = doc.querySelector('[data-tplbox-panel="redirect"]')!;
    expect(PANEL).toContain("<h3>L &middot; Redirect</h3>");
    expect(panel.querySelectorAll(".lg-tpl2-eyebrow").map((e) => e.textContent)).toEqual(["Banner", "Animation", "Animation only"]);
    for (const k of TEXT_KEYS) {
      const input = panel.querySelector(`input[data-frame-key="redirect.${k}"]`);
      expect(input, `text box for ${k}`).not.toBeNull();
      expect(input!.getAttribute("placeholder"), `${k} shows its default`).toBe(REDIRECT_LOOK_DEFAULTS[k]);
    }
    for (const k of BOOL_KEYS) {
      expect(panel.querySelector(`input[type="checkbox"][data-frame-key="redirect.${k}"]`), `toggle for ${k}`).not.toBeNull();
    }
    for (const k of ROLE_KEYS) {
      const strip = panel.querySelector(`[data-role-strip="redirect.${k}"]`);
      expect(strip, `role picker for ${k}`).not.toBeNull();
      expect(strip!.querySelectorAll("[data-role-pick]").map((b) => b.getAttribute("data-role-pick"))).toEqual([...FUNNEL_TOKEN_ROLES]);
    }
    const radios = (k: string): string[] => panel.querySelectorAll(`input[type="radio"][data-frame-key="redirect.${k}"]`).map((r) => r.getAttribute("value") as string);
    expect(radios("corners")).toEqual(["theme", "square", "rounded"]);
    expect(radios("headline_size")).toEqual([...FRAME_SIZES]);
    expect(radios("animation")).toEqual([...FRAME_REDIRECT_ANIMATIONS]);
    expect(radios("animation_size")).toEqual([...FRAME_SIZES]);
    const segLabels = panel.querySelectorAll(".lg-tpl2-seg-item span").map((s) => s.textContent);
    for (const label of ["Follow the Theme", "Square", "Rounded", "Countdown ring", "Progress bar", "Logo on a bar", "Spinner", "Dots"]) {
      expect(segLabels).toContain(label);
    }
    expect(panel.querySelector('[data-rd-preview="banner"]')?.textContent).toBe("Preview banner");
    expect(panel.querySelector('[data-rd-preview="animation"]')?.textContent).toBe("Preview animation only");
    expect(panel.querySelector("#lg-tpl-redirect-reset")?.textContent).toBe("Reset to defaults");
    // no inline layout styles in the panel's markup
    expect(PANEL.slice(PANEL.indexOf('data-tplbox-panel="redirect"'), PANEL.indexOf("lg-tpl-redirect-status"))).not.toMatch(/\sstyle="/);
  });

  it("the island carries the preview twins verbatim and stays old-style JavaScript", () => {
    const src = islandSource();
    expect(src).toContain(REDIRECT_PREVIEW_ISLAND_JS);
    expect(src).not.toMatch(/=>/);
    expect(src).not.toMatch(/\bconst\b|\blet\b/);
    expect(src).not.toContain("`");
    expect(() => new Function(src)).not.toThrow();
  });
});

// ===========================================================================
// 2 · save and reload through the real admin router
// ===========================================================================

type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    return (createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
    return null;
  }
}
const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

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
      const out: unknown[] = [];
      for (const s of statements) out.push(await s.run());
      return out;
    },
  } as unknown as D1Database;
}

function kvStub(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(k: string) { return store.get(k) ?? null; },
    async getWithMetadata(k: string) { return { value: store.get(k) ?? null, metadata: null }; },
    async put(k: string, v: string) { store.set(k, v); },
    async delete(k: string) { store.delete(k); },
    async list() { return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cursor: "" }; },
  } as unknown as KVNamespace;
}

const MIGRATIONS = [
  "0036_leadgen_core.sql", "0037_leadgen_analytics_mirror.sql", "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql", "0040_leadgen_runtime_context.sql", "0041_leadgen_frame_theme.sql",
  "0042_leadgen_pages.sql", "0043_leadgen_routing_rules.sql", "0044_leadgen_redirect_pct.sql",
  "0045_leadgen_persona_quota.sql", "0046_leadgen_rework_m1_variants.sql", "0047_leadgen_rework_m2_shared_pages.sql",
  "0048_leadgen_rework_m3_routing.sql", "0049_leadgen_rework_m4_m5_defaults_templates.sql",
  "0050_leadgen_rework_m6_grid_expansion.sql", "0051_leadgen_rework_m7_slider_collapse.sql",
  "0052_leadgen_rework_m9_address_fields.sql", "0053_leadgen_rework_m12_othergroup_retirement.sql",
] as const;

const API = "/api/admin/leadgen";
const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function fixture(): Promise<{ env: Env; funnel: string; variant: string }> {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "CREATE TABLE site_settings (site_id TEXT, key TEXT, value TEXT);",
  );
  for (const f of MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", f), "utf8"));
  const env = {
    DB: d1FromSqlite(sdb), CACHE: kvStub(), MEDIA: {} as R2Bucket, APP_ENV: "test",
    ADMIN_HOST: "cms.kodigital.app", ADMIN_BASE_URL: "https://cms.kodigital.app", ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false", HTML_CACHE_TTL_SECONDS: "300", OPENAI_TEXT_MODEL: "gpt-test", OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true", SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false", DEV_BYPASS_AUTH: "true",
    LEADGEN_CONFIG_SIGNING_KEY: "runtime-signing-key-test-only",
  } as unknown as Env;
  const res = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "F11 Look Quote", activity: "quote_funnel", verticals: ["life"] }), env);
  expect(res.status, await res.clone().text()).toBe(201);
  const created = (await res.json()) as { funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> };
  const section = mintPublicId("section");
  sdb
    .prepare("INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, 'S1', 'quote_funnel', 'life', 'Question?', ?, 'button', 0, 'active')")
    .run(section, JSON.stringify({ components: [{ type: "QuestionHeadline", question_id: "q_h", bind: "section_headline", props: {} }] }));
  return { env, funnel: created.funnels[0]!.public_id, variant: created.funnels[0]!.variants[0]!.public_id };
}

describeDb("F11 · L · Redirect saves and reloads through the funnel's real Save (PUT/GET /funnels/:id/frame)", () => {
  it("every value saves and reloads exactly; the effective frame carries it", async () => {
    const fx = await fixture();
    const put = await admin.request(`${API}/funnels/${fx.funnel}/frame`, jsonInit("PUT", { frame_config_json: { version: 1, template: "centered", redirect: EVERY_VALUE } }), fx.env);
    expect(put.status, await put.clone().text()).toBe(200);
    const get = await admin.request(`${API}/funnels/${fx.funnel}/frame`, {}, fx.env);
    const body = (await get.json()) as { frame_config: { redirect: unknown }; effective_frame: { redirect: unknown }; problems: unknown[] };
    expect(body.frame_config.redirect).toEqual(EVERY_VALUE);
    expect(body.effective_frame.redirect).toEqual(EVERY_VALUE);
    expect(body.problems).toEqual([]);
    // "Reset to defaults" and empty boxes (null) save too
    const reset = Object.fromEntries(TEXT_KEYS.map((k) => [k, null]));
    const put2 = await admin.request(`${API}/funnels/${fx.funnel}/frame`, jsonInit("PUT", { frame_config_json: { version: 1, template: "centered", redirect: { ...EVERY_VALUE, ...reset } } }), fx.env);
    expect(put2.status).toBe(200);
    const body2 = (await (await admin.request(`${API}/funnels/${fx.funnel}/frame`, {}, fx.env)).json()) as { frame_config: { redirect: Record<string, unknown> } };
    for (const k of TEXT_KEYS) expect(body2.frame_config.redirect[k], k).toBeNull();
  });

  it("a bad value is refused with a plain message and nothing is stored", async () => {
    const fx = await fixture();
    const bad: Array<[Record<string, unknown>, RegExp]> = [
      [{ countdown_line: "Taking you there" }, /countdown line must include \{n\}/],
      [{ headline: "x".repeat(121) }, /at most 120 characters/],
      [{ animation: "fireworks" }, /Countdown ring, Progress bar, Logo on a bar, Spinner, Dots/],
      [{ background_role: "#123456" }, /theme colour role/],
      [{ message: "Hi {first_name}" }, /only use the fill-ins \{brand\} and \{n\}/],
    ];
    for (const [redirect, message] of bad) {
      const res = await admin.request(`${API}/funnels/${fx.funnel}/frame`, jsonInit("PUT", { frame_config_json: { version: 1, template: "centered", redirect } }), fx.env);
      expect(res.status, JSON.stringify(redirect)).toBe(400);
      const body = (await res.json()) as { problems: Array<{ path: string; message: string }> };
      expect(body.problems.some((p) => p.path.startsWith("frame.redirect") && message.test(p.message)), JSON.stringify(body.problems)).toBe(true);
    }
    const body = (await (await admin.request(`${API}/funnels/${fx.funnel}/frame`, {}, fx.env)).json()) as { frame_config: unknown };
    expect(body.frame_config).toBeNull();
  });

  it("the Templates canvas accepts a draft carrying the block and returns the design tokens the preview reads", async () => {
    const fx = await fixture();
    const res = await admin.request(
      `${API}/variants/${fx.variant}/preview`,
      jsonInit("POST", { mode: "section", viewport: "desktop", sample_section: true, draft_frame_config: { version: 1, template: "centered", redirect: EVERY_VALUE } }),
      fx.env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { preview: { html: string; css: string }; config: { design_tokens: Record<string, unknown> } };
    expect((body.config.design_tokens["color"] as Record<string, string>)["primary"]).toBe("#1B3A5C");
    expect(body.preview.html).toContain('<div class="lg-banners" data-lg-banners hidden></div>');
    // the island's preview over this very response
    const twins = previewTwins();
    const out = twins.rdPreviewHtml(body.preview.html, "banner", EVERY_VALUE, body.config.design_tokens);
    const doc = miniDocument(out);
    const root = doc.querySelector("[data-lg-redirect]")!;
    expect(root.getAttribute("data-lg-rd-live")).toBe("");
    expect(root.className).toContain("lg-rd--loop");
    expect(doc.querySelector("[data-lg-banners]")?.hasAttribute("hidden")).toBe(false);
    expect(doc.querySelector(".lg-rd-headline")?.textContent).toBe("Good news");
    expect(doc.querySelector(".lg-rd-line")?.textContent).toBe(`Opening ${REDIRECT_PREVIEW_BRAND} in 5…`);
    expect(doc.querySelector("a.lg-banner[data-lg-rd-chosen]"), "a sample offer card").not.toBeNull();
    expect(out).toContain("lg-ra--dots");
    // a bad draft is refused on the canvas too (the operator sees why)
    const bad = await admin.request(
      `${API}/variants/${fx.variant}/preview`,
      jsonInit("POST", { mode: "section", sample_section: true, draft_frame_config: { version: 1, template: "centered", redirect: { countdown_line: "no seconds" } } }),
      fx.env,
    );
    expect(bad.status).toBe(400);
  });
});

// ===========================================================================
// 3 · the island: defaults on screen, "Reset to defaults"
// ===========================================================================

function sliceIslandFn(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  expect(at, `island declares function ${name}`).toBeGreaterThan(-1);
  let depth = 0;
  let i = src.indexOf("{", at);
  for (; i < src.length; i += 1) {
    const ch = src.charAt(i);
    if (ch === "{") depth += 1;
    else if (ch === "}" && --depth === 0) break;
  }
  return src.slice(at, i + 1);
}
function sliceIslandVar(src: string, name: string): string {
  const m = src.match(new RegExp(`^\\s*var ${name} = .*$`, "m"));
  expect(m, `island declares var ${name}`).not.toBeNull();
  return m![0].trim();
}

interface PanelDrive {
  doc: ReturnType<typeof miniDocument>;
  writes: Record<string, unknown>;
  paint(): void;
  reset(): void;
  status(): string;
}

// The panel's real markup + the island's real rd* functions. The shared
// island's write side (quotes-tabs/funnel.ts controlValueOf/writeConfigValue
// and its role-pick click) is mirrored as a recorder: change on a
// [data-frame-key] control → checkbox ? checked : (value === "" ? null : value)
// (radios only when checked); a click on a [data-role-pick] → its role.
function drivePanel(stored: Record<string, unknown> | null): PanelDrive {
  const src = islandSource();
  const doc = miniDocument(PANEL);
  (MiniNode.prototype as unknown as { dispatchEvent(ev: { type: string }): unknown }).dispatchEvent = function (this: MiniNode, ev: { type: string }) {
    return this.fire(ev.type);
  };
  const writes: Record<string, unknown> = {};
  doc.root.addEventListener("change", (ev) => {
    const el = ev.target;
    const key = el.getAttribute("data-frame-key");
    if (key === null || !key.startsWith("redirect.")) return;
    if (el.getAttribute("type") === "radio" && !el.checked) return;
    writes[key.slice(9)] = el.getAttribute("type") === "checkbox" ? el.checked : el.value === "" ? null : el.value;
  });
  doc.root.addEventListener("click", (ev) => {
    const pick = ev.target.getAttribute("data-role-pick");
    const pickFor = ev.target.getAttribute("data-role-pick-for") ?? "";
    if (pick !== null && pickFor.startsWith("redirect.")) writes[pickFor.slice(9)] = pick;
  });
  const fns = ["byId", "toArray", "clearChildren", "text", "isRecord", "getPath", "setPath", "deepClone", "syncRadioActiveClasses", "rdIsRecord", "rdControls", "rdDraft", "rdPaintDefaults", "rdFire", "rdStatus", "rdReset"];
  const body =
    [sliceIslandVar(src, "RD"), sliceIslandVar(src, "RD_TEXT_KEYS"), sliceIslandVar(src, "RD_BOOL_KEYS"), sliceIslandVar(src, "RD_RADIO_KEYS"), sliceIslandVar(src, "RD_ROLE_KEYS")].join("\n") +
    "\n" + fns.map((n) => sliceIslandFn(src, n)).join("\n") +
    "\nvar boot = __boot; var myFrame = __myFrame;\nfunction scheduleCanvasPreview() {}\n({ paint: rdPaintDefaults, reset: rdReset })";
  class FakeEvent {
    type: string;
    constructor(type: string) { this.type = type; }
  }
  const api = runInNewContext(body, {
    document: doc,
    window: { Event: FakeEvent },
    JSON,
    Object,
    __boot: { frame: { effective_frame: stored === null ? {} : { redirect: stored } } },
    __myFrame: {},
  }) as { paint(): void; reset(): void };
  return { doc, writes, paint: api.paint, reset: api.reset, status: () => doc.getElementById("lg-tpl-redirect-status")?.textContent ?? "" };
}

const sel = (d: PanelDrive, key: string): MiniNode[] => d.doc.querySelectorAll(`[data-frame-key="redirect.${key}"]`);
const selectedRole = (d: PanelDrive, key: string): string[] =>
  d.doc.querySelectorAll(`[data-role-strip="redirect.${key}"] [data-role-pick]`).filter((b) => b.className.includes("selected")).map((b) => b.getAttribute("data-role-pick") as string);

describe("F11 · the L · Redirect panel shows the defaults, and \"Reset to defaults\" brings back the Theme look", () => {
  it("with nothing stored, every toggle, segmented button and role swatch shows its default", () => {
    const d = drivePanel(null);
    d.paint();
    for (const k of BOOL_KEYS) expect(sel(d, k)[0]!.checked, k).toBe(REDIRECT_LOOK_DEFAULTS[k]);
    for (const k of RADIO_KEYS) {
      expect(sel(d, k).filter((r) => r.checked).map((r) => r.value), k).toEqual([REDIRECT_LOOK_DEFAULTS[k]]);
      expect(sel(d, k).find((r) => r.checked)!.parentNode!.className, `${k} button lit`).toContain("active");
    }
    for (const k of ROLE_KEYS) expect(selectedRole(d, k), k).toEqual([REDIRECT_LOOK_DEFAULTS[k]]);
    expect(d.writes, "painting the defaults writes nothing").toEqual({});
  });

  it("a stored value is left as the shared island populated it", () => {
    const d = drivePanel({ shadow: false, animation: "dots", background_role: "accent" });
    // what the shared island's populate leaves for these three
    sel(d, "shadow")[0]!.checked = false;
    for (const r of sel(d, "animation")) r.checked = r.value === "dots";
    for (const b of d.doc.querySelectorAll('[data-role-strip="redirect.background_role"] [data-role-pick]')) {
      b.className = b.getAttribute("data-role-pick") === "accent" ? "lg-role-swatch selected" : "lg-role-swatch";
    }
    d.paint();
    expect(sel(d, "shadow")[0]!.checked).toBe(false);
    expect(sel(d, "animation").filter((r) => r.checked).map((r) => r.value)).toEqual(["dots"]);
    expect(selectedRole(d, "background_role")).toEqual(["accent"]);
    expect(sel(d, "badge_on")[0]!.checked, "an unset key still shows its default").toBe(true);
  });

  it("Reset to defaults: every control goes back through the operator's own write paths, and the block IS the Theme look on two Themes", () => {
    const d = drivePanel(EVERY_VALUE as unknown as Record<string, unknown>);
    // a fully customised panel, as populate would show it
    for (const k of TEXT_KEYS) sel(d, k)[0]!.value = String(EVERY_VALUE[k]);
    for (const k of BOOL_KEYS) sel(d, k)[0]!.checked = EVERY_VALUE[k] as boolean;
    for (const k of RADIO_KEYS) for (const r of sel(d, k)) r.checked = r.value === EVERY_VALUE[k];
    d.reset();
    expect(Object.keys(d.writes).sort(), "every setting was written").toEqual([...KEYS].sort());
    for (const k of TEXT_KEYS) expect(d.writes[k], `${k}: empty box = the default`).toBeNull();
    for (const k of TEXT_KEYS) expect(sel(d, k)[0]!.value, k).toBe("");
    expect(validateFrameConfig({ version: 1, redirect: d.writes }).problems).toEqual([]);
    for (const [name, design] of Object.entries(THEMES)) {
      expect(resolveRedirectLook(d.writes, design), `${name}: the reset block is the Theme look`).toEqual(resolveRedirectLook(null, design));
      expect(resolveRedirectLook(EVERY_VALUE, design), `${name}: (and the customised block was not)`).not.toEqual(resolveRedirectLook(null, design));
    }
    expect(d.status()).toBe("Back to the Theme look. Save to keep it.");
  });
});

// ===========================================================================
// 4 · the preview twins build the server's bytes
// ===========================================================================

interface Twins {
  rdResolveLook(stored: unknown, design: unknown): unknown;
  rdMarkup(m: Record<string, unknown>): string;
  rdPreviewHtml(html: string, display: string, stored: unknown, design: unknown): string;
}
function previewTwins(): Twins {
  return runInNewContext(
    `var RD = ${JSON.stringify(redirectPreviewBoot())};\n${REDIRECT_PREVIEW_ISLAND_JS}\n({ rdResolveLook: rdResolveLook, rdMarkup: rdMarkup, rdPreviewHtml: rdPreviewHtml })`,
    {},
  ) as Twins;
}

describe("F11 · the Templates preview builds exactly what visitors are served", () => {
  const looks: Array<[string, unknown]> = [
    ["the defaults", null],
    ["every setting changed", EVERY_VALUE],
    ["badge and message off, square, shadow off", { badge_on: false, message_on: false, corners: "square", shadow: false }],
    ["escaping + fill-ins", { headline: "Tom & \"Jerry\" <i> {brand} {n}", message: "{brand} first", stay_label: "{n}s left" }],
    ["invalid stored values fall back", { animation: "nope", background_role: "#fff", countdown_line: "no seconds", headline: "  " }],
    ...FRAME_REDIRECT_ANIMATIONS.map((a): [string, unknown] => [`style ${a}`, { animation: a, show_seconds: a !== "bar" }]),
  ];
  const twins = previewTwins();
  for (const [name, stored] of looks) {
    for (const [themeName, design] of Object.entries(THEMES)) {
      for (const display of ["banner", "animation"] as const) {
        for (const brand of ["Beta Co", null]) {
          it(`${name} · ${themeName} · ${display} · ${brand === null ? "no brand" : "brand"}`, () => {
            const serverLook = resolveRedirectLook(stored, design);
            expect(twins.rdResolveLook(stored, design)).toEqual(JSON.parse(JSON.stringify(serverLook)));
            const input: RedirectMarkupInput = {
              display,
              look: serverLook,
              seconds: 7,
              brand,
              logo_url: "https://cdn.example.com/logo.png",
              cards_html: '<div class="lg-banners"><a class="lg-banner" data-lg-rd-chosen="1" href="/lg/lc/x?brid=B&amp;slot=1" data-slot="1">card</a></div>',
              slot: 1,
              brid: "B<&>",
              faid: "F",
              stay_mode: "carrier",
              stay_key: "k\"1",
            };
            expect(twins.rdMarkup({ ...input, look: twins.rdResolveLook(stored, design) })).toBe(renderRedirectMarkup(input));
          });
        }
      }
    }
  }
  it("no logo: Logo on a bar shows the ring on both sides", () => {
    const look = resolveRedirectLook({ animation: "logo_bar" }, THEMES["moneylantern-like"]);
    const input: RedirectMarkupInput = { display: "banner", look, seconds: 5, brand: null, logo_url: null, cards_html: "", slot: 1, brid: "B", faid: "", stay_mode: "none", stay_key: "" };
    const server = renderRedirectMarkup(input);
    expect(server).toContain("lg-ra--ring");
    expect(twins.rdMarkup({ ...input, look: twins.rdResolveLook({ animation: "logo_bar" }, THEMES["moneylantern-like"]) })).toBe(server);
  });
});
