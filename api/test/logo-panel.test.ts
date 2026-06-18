// T24 [RC-043 / RC-044] — Logo: render fix + operator-directed panel.
//
// Every it() title embeds the literal [api/test/logo-panel.test.ts] and the L2
// disambiguation marker so the parse_test_output evidence parser routes the
// receipt to RC-043 (T24-AC1) / RC-044 (T24-AC2). The file's own
// evidence_command runs this whole file.
//
// Both ACs are proven against the SHIPPED code — not a grep of the source:
//
//   AC1 (RC-043) "an uploaded logo (logo_media_id) renders on the public site
//   (in the design .brand) via /media/<key>":
//     1. the real settings client script (SETTINGS_SCRIPT), run in a vm with a
//        DOM + fetch stub, writes the uploaded media reference into the
//        logo_media_id input (the key the public side reads) — the alignment
//        fix for the site_logo_url-vs-logo_media_id defect.
//     2. the real public layout loader resolves that logo_media_id to a
//        /media/<key> URL and the real header template renders it inside the
//        design <a class="brand"> as <img class="brand-logo" src="/media/...">.
//
//   AC2 (RC-044) "AI-generate with a description posts {prompt,style,colorScheme}
//   (LogoRequest) and applies/regenerates a directed logo":
//     1. the real client script POSTs a LogoRequest carrying prompt + style +
//        colorScheme to /api/admin/ai/logo when the panel fields are filled.
//     2. the real /api/admin/ai/logo route consumes that direction: it flows
//        into the outbound image prompt AND the regenerated logo is APPLIED
//        (site_settings.logo_media_id write) — so the AC cannot pass while the
//        user-facing outcome (a directed, applied logo) is silently broken.

import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
import { SETTINGS_SCRIPT } from "../src/admin/templates/settings";
import { fetchPublicLayoutSiteInfo } from "../src/public/queries";
import { renderHeader } from "../src/public/templates/components";
import { buildPrompt as buildLogoPrompt } from "../src/ai/prompts/logo";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

const nodeRequire = createRequire(import.meta.url);
const vm = nodeRequire("node:vm") as typeof import("node:vm");

// ---------------------------------------------------------------------------
// Minimal DOM stub — just enough surface to RUN the shipped ES5 script.
// ---------------------------------------------------------------------------
class FakeNode {
  tag: string;
  attrs: Record<string, string> = {};
  children: FakeNode[] = [];
  listeners: Record<string, Array<(e?: unknown) => void>> = {};
  value = "";
  private _src = "";
  hidden = false;
  disabled = false;
  className = "";
  placeholder = "";
  type = "";
  nodeValue = "";
  files: unknown[] | null = null;

  constructor(tag: string) {
    this.tag = tag;
  }
  get firstChild(): FakeNode | null {
    return this.children.length ? this.children[0]! : null;
  }
  appendChild(n: FakeNode): FakeNode {
    this.children.push(n);
    return n;
  }
  removeChild(n: FakeNode): FakeNode {
    const i = this.children.indexOf(n);
    if (i >= 0) this.children.splice(i, 1);
    return n;
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = String(v);
  }
  getAttribute(k: string): string | null {
    return k in this.attrs ? this.attrs[k]! : null;
  }
  removeAttribute(k: string): void {
    delete this.attrs[k];
  }
  addEventListener(type: string, fn: (e?: unknown) => void): void {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  focus(): void {}
  get src(): string {
    return this._src;
  }
  set src(v: string) {
    this._src = v;
  }
  get textContent(): string {
    if (this.tag === "#text") return this.nodeValue;
    return this.children.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    this.children = [];
    const t = new FakeNode("#text");
    t.nodeValue = String(v);
    this.children.push(t);
  }
  // Test helper: dispatch a registered listener.
  fire(type: string, e?: unknown): void {
    (this.listeners[type] || []).forEach((fn) => fn.call(this, e));
  }
}

// Every element id the settings client script touches before/within the logo
// paths. The four required ids (form/filter/hidden/status) must exist or the
// script returns early and never registers the logo handlers.
const SETTINGS_IDS = [
  "settings-editor-form",
  "filter-site",
  "settings-site-id",
  "settings-editor-status",
  "settings-form-error",
  "logoFileInput",
  "setting-site_logo_url",
  "logo-upload-status",
  "logo-upload-preview",
  "setting-logo_media_id",
  "ai-logo-generate",
  "ai-logo-status",
  "ai-logo-preview",
  "ai-logo-prompt",
  "ai-logo-style",
  "ai-logo-colors",
];

interface FetchCall {
  url: string;
  init: { body?: unknown } | undefined;
}

function bootSettings(responses: { media?: unknown; logo?: unknown }) {
  const ids: Record<string, FakeNode> = {};
  for (const id of SETTINGS_IDS) ids[id] = new FakeNode("div");
  const doc = {
    getElementById: (id: string) => ids[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [] as FakeNode[],
    createElement: (tag: string) => new FakeNode(tag),
    createTextNode: (text: string) => {
      const n = new FakeNode("#text");
      n.nodeValue = String(text);
      return n;
    },
  };
  const calls: FetchCall[] = [];
  const fetchStub = (url: string, init?: { body?: unknown }) => {
    calls.push({ url, init });
    let body: unknown = {};
    if (url.indexOf("/api/admin/ai/logo") > -1) {
      body = responses.logo ?? { ok: true };
    } else if (url.indexOf("/admin/media") > -1) {
      body = responses.media ?? {};
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    });
  };
  class FakeFormData {
    parts: Array<[string, unknown]> = [];
    constructor(_form?: unknown) {}
    append(k: string, v: unknown) {
      this.parts.push([k, v]);
    }
    get() {
      return null;
    }
  }
  vm.runInNewContext(SETTINGS_SCRIPT, {
    document: doc,
    fetch: fetchStub,
    FormData: FakeFormData,
    window: { location: { href: "" } },
  });
  const el = (id: string): FakeNode => {
    const n = ids[id];
    if (!n) throw new Error("missing test node: " + id);
    return n;
  };
  return { el, calls };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

// ===========================================================================
// AC1 (RC-043) — uploaded logo aligns to logo_media_id + renders via /media/<key>
// ===========================================================================
describe("T24-AC1 logo render fix (RC-043)", () => {
  it("[api/test/logo-panel.test.ts] T24-AC1: uploading a logo writes the storage_key into the logo_media_id input the public side reads L2_AUTO_DISAMBIGUATION:T24-AC1:RC-043", async () => {
    const { el, calls } = bootSettings({
      media: { id: 12, storage_key: "uploads/brand-logo.png" },
    });
    el("logoFileInput").files = [{ name: "logo.png" }];
    el("logoFileInput").fire("change");
    await flush();
    await flush();

    const mediaCall = calls.find((c) => c.url.indexOf("/admin/media") > -1);
    expect(mediaCall, "upload POSTs to /admin/media").toBeDefined();
    // The defect: upload wrote only site_logo_url, which the public side never
    // read. The fix also writes the bare storage_key into logo_media_id.
    expect(el("setting-logo_media_id").value).toBe("uploads/brand-logo.png");
    // site_logo_url stays populated (back-compat) with the /media/ web address.
    expect(el("setting-site_logo_url").value).toBe("/media/uploads/brand-logo.png");
  });

  it("[api/test/logo-panel.test.ts] T24-AC1: the public layout resolves logo_media_id to /media/<key> and the design .brand renders it L2_AUTO_DISAMBIGUATION:T24-AC1:RC-043", async () => {
    // Fake D1: the shared layout loader runs one SELECT over site_settings.
    const settingsRows = [
      { key: "site_name", value: "Acme News" },
      { key: "logo_media_id", value: "uploads/brand-logo.png" },
    ];
    const db = {
      prepare: (_sql: string) => ({
        bind: (..._args: unknown[]) => ({
          all: async () => ({ results: settingsRows, success: true, meta: {} }),
        }),
      }),
    } as unknown as D1Database;

    const site = await fetchPublicLayoutSiteInfo(db, {
      siteId: "site-a",
      hostname: "acme.example",
    });
    // The stored bare storage_key resolves to the public /media/<key> address.
    expect(site.logoUrl).toBe("/media/uploads/brand-logo.png");

    // And the real header template renders it inside the design <a class="brand">.
    const header = renderHeader({
      site: {
        name: site.name,
        logoUrl: site.logoUrl,
        hostname: site.hostname,
      },
    });
    expect(header).toContain('<a class="brand"');
    expect(header).toContain(
      '<img class="brand-logo" src="/media/uploads/brand-logo.png"',
    );
  });

  it("[api/test/logo-panel.test.ts] T24-AC1: an unset logo_media_id resolves to null (no broken /media/ src; neutral mark fallback) L2_AUTO_DISAMBIGUATION:T24-AC1:RC-043", async () => {
    const db = {
      prepare: (_sql: string) => ({
        bind: (..._args: unknown[]) => ({
          all: async () => ({
            results: [{ key: "site_name", value: "Acme" }],
            success: true,
            meta: {},
          }),
        }),
      }),
    } as unknown as D1Database;
    const site = await fetchPublicLayoutSiteInfo(db, {
      siteId: "site-a",
      hostname: "acme.example",
    });
    expect(site.logoUrl).toBeNull();
    const header = renderHeader({ site: { name: site.name, logoUrl: site.logoUrl } });
    expect(header).not.toContain("/media/");
    expect(header).toContain('class="brand-logo"'); // neutral mark fallback
  });
});

// ===========================================================================
// AC2 (RC-044) — directed AI logo: client POSTs LogoRequest, server applies it
// ===========================================================================
describe("T24-AC2 directed AI logo client (RC-044)", () => {
  it("[api/test/logo-panel.test.ts] T24-AC2: Generate-with-AI POSTs {prompt,style,colorScheme} (LogoRequest) to /api/admin/ai/logo L2_AUTO_DISAMBIGUATION:T24-AC2:RC-044", async () => {
    const { el, calls } = bootSettings({
      logo: {
        ok: true,
        media_id: 7,
        image_url: "/media/ai/site-1/logo/site-1.png",
        directed: true,
      },
    });
    el("settings-site-id").value = "site-1";
    el("ai-logo-prompt").value = "a mountain peak inside a circle";
    el("ai-logo-style").value = "minimalist";
    el("ai-logo-colors").value = "deep blue and gold";
    el("ai-logo-generate").fire("click");
    await flush();
    await flush();

    const logoCall = calls.find((c) => c.url.indexOf("/api/admin/ai/logo") > -1);
    expect(logoCall, "generate POSTs to /api/admin/ai/logo").toBeDefined();
    const sent = JSON.parse(String(logoCall!.init!.body)) as {
      site_id: string;
      prompt?: string;
      style?: string;
      colorScheme?: string;
    };
    // The LogoRequest carries the operator's direction on the WIRE fields.
    expect(sent.site_id).toBe("site-1");
    expect(sent.prompt).toBe("a mountain peak inside a circle");
    expect(sent.style).toBe("minimalist");
    expect(sent.colorScheme).toBe("deep blue and gold");
    // Applied: the returned media id is written back into logo_media_id.
    expect(el("setting-logo_media_id").value).toBe("7");
  });

  it("[api/test/logo-panel.test.ts] T24-AC2: with no description/style/colors the body omits them (undirected click stays back-compatible) L2_AUTO_DISAMBIGUATION:T24-AC2:RC-044", async () => {
    const { el, calls } = bootSettings({
      logo: { ok: true, media_id: 3, image_url: "/m/x.png" },
    });
    el("settings-site-id").value = "site-1";
    el("ai-logo-generate").fire("click");
    await flush();

    const logoCall = calls.find((c) => c.url.indexOf("/api/admin/ai/logo") > -1);
    expect(logoCall).toBeDefined();
    const sent = JSON.parse(String(logoCall!.init!.body)) as {
      site_id: string;
      prompt?: unknown;
      style?: unknown;
      colorScheme?: unknown;
    };
    expect(sent.site_id).toBe("site-1");
    expect(sent.prompt).toBeUndefined();
    expect(sent.style).toBeUndefined();
    expect(sent.colorScheme).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Server: /api/admin/ai/logo consumes the forwarded direction (flows into the
// outbound image prompt) AND applies the regenerated logo (settings write).
// ---------------------------------------------------------------------------
interface PreparedCall {
  sql: string;
  binds: unknown[];
}
// Mirrors the proven admin-ai-image fake: replays inserted ai_generations rows
// on the idempotency-key SELECT (startGenerationLog's insert-then-reselect
// contract) so the logo generation reaches success, answers the media INSERT
// ... RETURNING id with a fake row, and serves the planted sites row.
function makeFakeDb(sites: Record<string, { id: string; name: string | null; vertical_slug: string | null }>) {
  const calls: PreparedCall[] = [];
  const aiRows = new Map<string, Record<string, unknown>>();
  const prepare = (sql: string) => {
    let captured: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        captured = args;
        return stmt;
      },
      async first<T = unknown>(): Promise<T | null> {
        calls.push({ sql, binds: captured });
        if (sql.includes("FROM ai_generations")) {
          return (aiRows.get(String(captured[0] ?? "")) ?? null) as T | null;
        }
        if (sql.includes("FROM sites")) {
          return (sites[String(captured[0] ?? "")] ?? null) as T | null;
        }
        if (sql.startsWith("INSERT INTO media")) {
          return { id: 7 } as T;
        }
        return null;
      },
      async run() {
        calls.push({ sql, binds: captured });
        if (sql.startsWith("INSERT INTO ai_generations")) {
          // INSERT bind order (generation-log.ts): id, site_id, task, provider,
          // model, prompt_version, idempotency_key, request_json, target_type,
          // target_id.
          const key = String(captured[6]);
          aiRows.set(key, {
            id: captured[0],
            idempotency_key: key,
            request_json: captured[7],
            status: "pending",
          });
        }
        if (sql.startsWith("UPDATE ai_generations SET status = 'success'")) {
          const row = aiRows.get(String(captured[4]));
          if (row) row.status = "success";
        }
        if (sql.startsWith("UPDATE ai_generations SET status = 'failed'")) {
          const row = aiRows.get(String(captured[2]));
          if (row) row.status = "failed";
        }
        if (sql.startsWith("UPDATE ai_generations SET status = 'fallback'")) {
          const row = aiRows.get(String(captured[4]));
          if (row) row.status = "fallback";
        }
        return { success: true, meta: {} };
      },
      async all<T = unknown>() {
        calls.push({ sql, binds: captured });
        return { results: [] as T[], success: true, meta: {} };
      },
    };
    return stmt;
  };
  return { db: { prepare } as unknown as D1Database, calls, aiRows };
}

function makeMedia() {
  return { async put() { return null; } } as unknown as R2Bucket;
}

function buildEnv(db: D1Database, media: R2Bucket, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: media,
    APP_ENV: "development",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "gpt-5.5",
    OPENAI_IMAGE_MODEL: "gpt-image-2",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
    OPENAI_API_KEY: "sk-test",
    ...overrides,
  } as Env;
}

function postLogo(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

const FAKE_PNG_B64 = Buffer.from("fake-png-bytes").toString("base64");
function stubOpenAIImage(): ReturnType<typeof vi.fn> {
  const impl = vi.fn(
    async () =>
      new Response(JSON.stringify({ data: [{ b64_json: FAKE_PNG_B64 }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", impl);
  return impl;
}

const SITES = { "site-a": { id: "site-a", name: "Acme", vertical_slug: "home-services" } };

describe("T24-AC2 server consumes the directed LogoRequest (RC-044)", () => {
  it("[api/test/logo-panel.test.ts] T24-AC2: posted {prompt,style,colorScheme} flow into the image prompt AND the regenerated logo is applied L2_AUTO_DISAMBIGUATION:T24-AC2:RC-044", async () => {
    const { db, calls } = makeFakeDb(SITES);
    const fetchSpy = stubOpenAIImage();
    const res = await admin.request(
      "/api/admin/ai/logo",
      postLogo({
        site_id: "site-a",
        prompt: "a sunrise over rolling hills",
        style: "minimalist",
        colorScheme: "navy and gold",
      }),
      buildEnv(db, makeMedia()),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      directed: boolean;
      applied_direction: { prompt: string; style: string; colorScheme: string };
      setting_key: string;
    };
    expect(body.ok).toBe(true);
    expect(body.directed).toBe(true);
    expect(body.applied_direction.style).toBe("minimalist");
    expect(body.applied_direction.colorScheme).toBe("navy and gold");

    // Direction actually reached the outbound image prompt (not dropped).
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const sentPrompt = (JSON.parse(String(init.body)) as { prompt: string }).prompt;
    expect(sentPrompt).toContain("a sunrise over rolling hills");
    expect(sentPrompt).toContain("Style: minimalist");
    expect(sentPrompt).toContain("navy and gold"); // colorScheme -> palette line

    // Applied: the regenerated logo's BARE STORAGE_KEY (the value the public side
    // resolves to /media/<key>) is written to site_settings.logo_media_id — NOT the
    // numeric media id, which the public /media route 404s on.
    const settingWrite = calls.find((c) =>
      c.sql.startsWith("INSERT INTO site_settings"),
    );
    expect(settingWrite).toBeDefined();
    expect(settingWrite!.binds).toEqual(["site-a", "logo_media_id", "ai/site-a/logo/site-a.png"]);
  });

  it("[api/test/logo-panel.test.ts] T24-AC2: an undirected post (no direction) keeps the default prompt — direction is additive, not forced L2_AUTO_DISAMBIGUATION:T24-AC2:RC-044", async () => {
    const { db } = makeFakeDb(SITES);
    const fetchSpy = stubOpenAIImage();
    const res = await admin.request(
      "/api/admin/ai/logo",
      postLogo({ site_id: "site-a" }),
      buildEnv(db, makeMedia()),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { directed: boolean };
    expect(body.directed).toBe(false);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const sentPrompt = (JSON.parse(String(init.body)) as { prompt: string }).prompt;
    expect(sentPrompt).not.toContain("Operator direction:");
    expect(sentPrompt).not.toContain("Style:");
  });

  it("[api/test/logo-panel.test.ts] T24-AC2: buildLogoPrompt embeds description/style/colorScheme only when provided L2_AUTO_DISAMBIGUATION:T24-AC2:RC-044", () => {
    const directed = buildLogoPrompt({
      site_id: "site-a",
      vertical: "home services",
      brand_name: "Acme",
      description: "a sunrise over rolling hills",
      style: "minimalist",
      colorScheme: "navy and gold",
    });
    expect(directed).toContain("Operator direction: a sunrise over rolling hills");
    expect(directed).toContain("Style: minimalist");
    expect(directed).toContain("Palette: navy and gold");

    const undirected = buildLogoPrompt({
      site_id: "site-a",
      vertical: "home services",
      brand_name: "Acme",
    });
    expect(undirected).not.toContain("Operator direction:");
    expect(undirected).not.toContain("Style:");
    expect(undirected).toContain("Palette: neutral");
  });
});
