// T10 [RC-021] — Hero image card + forward the preset (T10-AC1, behavioral).
//
// Every it() title embeds the literal [api/test/hero-image-card.test.ts] and
// the L2 disambiguation marker so the parse_test_output evidence parser routes
// the receipt to RC-021 (the file's own evidence_command runs this whole file).
//
// AC1 has three behavioral clauses, all proven here against the SHIPPED code —
// not a grep of the source:
//   1. UPLOAD sets a preview + the hidden featured_image_id.
//   2. AI-generate with a preset POSTs presetId to /api/admin/ai/image.
//   3. APPLY attaches the returned media id.
// Clauses 1-3 are exercised by running the real ES5 hero-image script string
// (heroImageScripts) in a vm context with a minimal DOM stub, then observing the
// DOM mutations + the outbound request body. A server block then proves the
// forwarded presetId is actually consumed (validated + recorded on the receipt)
// by the real /api/admin/ai/image route — so the AC cannot pass while the
// user-facing outcome (preset-governed image, BCL-011) is silently broken.

import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
import { heroImageScripts } from "../src/admin/templates/hero-image";
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
  querySelector(): FakeNode | null {
    return null;
  }
  querySelectorAll(sel: string): FakeNode[] {
    const want = sel.replace(/[[\]]/g, ""); // '[data-var-name]' -> 'data-var-name'
    const out: FakeNode[] = [];
    const walk = (n: FakeNode) => {
      for (const c of n.children) {
        if (c.getAttribute(want) !== null) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  // Test helper: dispatch a registered listener.
  fire(type: string, e?: unknown): void {
    (this.listeners[type] || []).forEach((fn) => fn.call(this, e));
  }
}

const HERO_IDS = [
  "hero-image-card",
  "hero-image-input",
  "hero-image-preview",
  "hero-image-empty",
  "hero-image-upload",
  "hero-image-ai-generate",
  "hero-image-remove",
  "hero-image-error",
  "hero-image-status",
  "hero-ai-modal",
  "hero-ai-close",
  "hero-ai-cancel",
  "hero-ai-preset",
  "hero-ai-variables",
  "hero-ai-preview",
  "hero-ai-size",
  "hero-ai-style",
  "hero-ai-quality",
  "hero-ai-prompt",
  "hero-ai-error",
  "hero-ai-status",
  "hero-ai-result",
  "hero-ai-result-image",
  "hero-ai-generate-btn",
  "hero-ai-apply-btn",
];

interface FetchCall {
  url: string;
  init: { body?: unknown } | undefined;
}

// Build the DOM + a routing fetch stub, then RUN the shipped script string in a
// vm context with them as globals (the script is an IIFE referencing
// document/fetch/FormData as free identifiers).
function bootScript(responses: {
  presets?: unknown;
  media?: unknown;
  image?: unknown;
}) {
  const ids: Record<string, FakeNode> = {};
  for (const id of HERO_IDS) ids[id] = new FakeNode("div");
  const doc = {
    getElementById: (id: string) => ids[id] || null,
    querySelector: () => null,
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
    if (url.indexOf("/api/admin/ai/presets") > -1) {
      body = responses.presets ?? { items: [] };
    } else if (url.indexOf("/api/admin/ai/image") > -1) {
      body = responses.image ?? {};
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
    append(k: string, v: unknown) {
      this.parts.push([k, v]);
    }
  }
  vm.runInNewContext(heroImageScripts, {
    document: doc,
    fetch: fetchStub,
    FormData: FakeFormData,
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

describe("T10-AC1 hero image card (client behavior)", () => {
  it("[api/test/hero-image-card.test.ts] T10-AC1: UPLOAD sets the card preview + the hidden featured_image_id wire input L2_AUTO_DISAMBIGUATION:T10-AC1:RC-021", async () => {
    const { el, calls } = bootScript({
      media: { id: 42, storage_key: "uploads/hero.png" },
    });
    el("hero-image-upload").files = [{ name: "hero.png" }];
    el("hero-image-upload").fire("change");
    await flush();
    await flush();

    const mediaCall = calls.find((c) => c.url.indexOf("/admin/media") > -1);
    expect(mediaCall, "upload POSTs to /admin/media").toBeDefined();
    // The hidden input the article form submits IS named featured_image_id; the
    // script keys off id="hero-image-input" and the upload sets its value.
    expect(el("hero-image-input").value).toBe("42");
    expect(el("hero-image-preview").src).toBe("/media/uploads/hero.png");
    expect(el("hero-image-preview").hidden).toBe(false);
  });

  it("[api/test/hero-image-card.test.ts] T10-AC1: AI-generate WITH a preset selected POSTs presetId to /api/admin/ai/image L2_AUTO_DISAMBIGUATION:T10-AC1:RC-021", async () => {
    const { el, calls } = bootScript({
      presets: {
        items: [
          {
            id: 7,
            name: "Hero preset",
            slug: "hero",
            is_active: 1,
            user_prompt_template: "A dramatic hero image for the homepage",
          },
        ],
      },
      image: {
        ok: true,
        model: "gpt-image-2",
        media_id: 99,
        image_url: "/media/ai/admin/shared/x.png",
      },
    });
    // Open the modal -> loads presets; select the preset -> activePreset set +
    // the interpolated preset prompt is written into the textarea.
    el("hero-image-ai-generate").fire("click");
    await flush();
    el("hero-ai-preset").value = "7";
    el("hero-ai-preset").fire("change");
    expect(el("hero-ai-prompt").value).toBe(
      "A dramatic hero image for the homepage",
    );
    // Generate.
    el("hero-ai-generate-btn").fire("click");
    await flush();

    const imageCall = calls.find(
      (c) => c.url.indexOf("/api/admin/ai/image") > -1,
    );
    expect(imageCall, "generate POSTs to /api/admin/ai/image").toBeDefined();
    const sent = JSON.parse(String(imageCall!.init!.body)) as {
      prompt: string;
      presetId: number;
    };
    // "forward the preset": the selected preset id rides the request body.
    expect(sent.presetId).toBe(7);
    expect(sent.prompt).toBe("A dramatic hero image for the homepage");
  });

  it("[api/test/hero-image-card.test.ts] T10-AC1: AI-generate with NO preset omits presetId (default path preserved) L2_AUTO_DISAMBIGUATION:T10-AC1:RC-021", async () => {
    const { el, calls } = bootScript({
      image: { ok: true, model: "gpt-image-2", media_id: 1, image_url: "/m/a.png" },
    });
    el("hero-image-ai-generate").fire("click");
    await flush();
    // No preset chosen; the operator types a prompt directly.
    el("hero-ai-prompt").value = "a plain photo";
    el("hero-ai-generate-btn").fire("click");
    await flush();

    const imageCall = calls.find(
      (c) => c.url.indexOf("/api/admin/ai/image") > -1,
    );
    expect(imageCall).toBeDefined();
    const sent = JSON.parse(String(imageCall!.init!.body)) as {
      presetId?: unknown;
    };
    expect(sent.presetId).toBeUndefined();
  });

  it("[api/test/hero-image-card.test.ts] T10-AC1: APPLY attaches the returned media id to the hidden featured_image_id + card preview L2_AUTO_DISAMBIGUATION:T10-AC1:RC-021", async () => {
    const { el } = bootScript({
      presets: {
        items: [
          { id: 7, name: "Hero", slug: "hero", is_active: 1, user_prompt_template: "hero" },
        ],
      },
      image: {
        ok: true,
        model: "gpt-image-2",
        media_id: 99,
        image_url: "/media/ai/admin/shared/x.png",
      },
    });
    el("hero-image-ai-generate").fire("click");
    await flush();
    el("hero-ai-preset").value = "7";
    el("hero-ai-preset").fire("change");
    el("hero-ai-generate-btn").fire("click");
    await flush();
    // The generated result is staged for review; Apply attaches it.
    expect(el("hero-ai-apply-btn").hidden).toBe(false);
    el("hero-ai-apply-btn").fire("click");

    expect(el("hero-image-input").value).toBe("99");
    expect(el("hero-image-preview").src).toBe("/media/ai/admin/shared/x.png");
    expect(el("hero-ai-modal").hidden).toBe(true); // modal closed after apply
  });
});

// ---------------------------------------------------------------------------
// Server: the forwarded presetId is actually consumed by /api/admin/ai/image
// (resolved + validated + recorded on the receipt). Guards BCL-011 — a forwarded
// preset must not be silently dropped server-side.
// ---------------------------------------------------------------------------
function makeServerDb(presets: Record<string, unknown>) {
  const aiRows = new Map<string, { request_json: unknown; status: string }>();
  const prepare = (sql: string) => {
    let captured: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        captured = args;
        return stmt;
      },
      async first<T = unknown>(): Promise<T | null> {
        if (sql === "SELECT * FROM prompt_presets WHERE id = ?") {
          return (presets[String(captured[0] ?? "")] ?? null) as T | null;
        }
        if (sql.includes("FROM ai_generations")) {
          return (aiRows.get(String(captured[0] ?? "")) ?? null) as T | null;
        }
        if (sql.startsWith("INSERT INTO media")) {
          return { id: 7 } as T;
        }
        return null;
      },
      async run() {
        // ai_generations INSERT bind order (generation-log.ts): id, site_id,
        // task, provider, model, prompt_version, idempotency_key, request_json,
        // target_type, target_id.
        if (sql.startsWith("INSERT INTO ai_generations")) {
          aiRows.set(String(captured[6]), {
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
        return { success: true, meta: {} };
      },
      async all<T = unknown>() {
        return { results: [] as T[], success: true, meta: {} };
      },
    };
    return stmt;
  };
  return { db: { prepare } as unknown as D1Database, aiRows };
}

function makeMedia() {
  return {
    async put() {
      return null;
    },
  } as unknown as R2Bucket;
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

function postImage(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

const FAKE_PNG_B64 = Buffer.from("fake-png-bytes").toString("base64");

function stubOpenAIImage() {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ b64_json: FAKE_PNG_B64 }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

describe("T10-AC1 hero image: server consumes the forwarded preset", () => {
  it("[api/test/hero-image-card.test.ts] T10-AC1: a posted presetId resolves the preset and is recorded on the ai_generations receipt L2_AUTO_DISAMBIGUATION:T10-AC1:RC-021", async () => {
    const { db, aiRows } = makeServerDb({
      "7": { id: 7, slug: "hero", is_active: 1, is_system: 1, prompt_template: "" },
    });
    stubOpenAIImage();
    const res = await admin.request(
      "/api/admin/ai/image",
      postImage({ prompt: "a lighthouse", site_id: "site-1", presetId: 7 }),
      buildEnv(db, makeMedia()),
    );
    expect(res.status).toBe(200);
    const rows = [...aiRows.values()];
    expect(rows).toHaveLength(1);
    const req = JSON.parse(String(rows[0]!.request_json)) as { preset_id: number };
    expect(req.preset_id).toBe(7); // server applied/recorded the forwarded preset
  });

  it("[api/test/hero-image-card.test.ts] T10-AC1: an unknown presetId is rejected 404 (forwarded preset is validated, not ignored) L2_AUTO_DISAMBIGUATION:T10-AC1:RC-021", async () => {
    const { db } = makeServerDb({}); // no presets planted
    stubOpenAIImage();
    const res = await admin.request(
      "/api/admin/ai/image",
      postImage({ prompt: "x", presetId: 9999 }),
      buildEnv(db, makeMedia()),
    );
    expect(res.status).toBe(404);
  });

  it("[api/test/hero-image-card.test.ts] T10-AC1: a malformed presetId is rejected 400 L2_AUTO_DISAMBIGUATION:T10-AC1:RC-021", async () => {
    const { db } = makeServerDb({});
    stubOpenAIImage();
    const res = await admin.request(
      "/api/admin/ai/image",
      postImage({ prompt: "x", presetId: "not-a-number" }),
      buildEnv(db, makeMedia()),
    );
    expect(res.status).toBe(400);
  });

  it("[api/test/hero-image-card.test.ts] T10-AC1: with NO presetId the image endpoint still succeeds (default path preserved) L2_AUTO_DISAMBIGUATION:T10-AC1:RC-021", async () => {
    const { db, aiRows } = makeServerDb({});
    stubOpenAIImage();
    const res = await admin.request(
      "/api/admin/ai/image",
      postImage({ prompt: "a lighthouse" }),
      buildEnv(db, makeMedia()),
    );
    expect(res.status).toBe(200);
    const req = JSON.parse(String([...aiRows.values()][0]!.request_json)) as {
      preset_id: number | null;
    };
    expect(req.preset_id).toBeNull();
  });
});
