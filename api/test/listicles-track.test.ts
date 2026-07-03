// Listicles Phase 7 — POST /api/lst/track (§16 ingest, §24 fire-and-forget,
// §31.4 page_view_id, §31.6 idempotency + dead-letter, §31.8 quality flags).
//
// Driven through the REAL public router (the beacon registers before the
// site-context middleware — host-independent) with a planted-row fake D1 +
// a stateful fake KV + a stream-configured env whose firehose fetch is
// intercepted, so every emitted record is observable.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import publicRouter from "../src/public/router";
import type { PublicSiteVariables } from "../src/public/middleware";
import type { Env } from "../src/env";
import type {
  ListicleEvent,
  ListicleSessionRecord,
} from "../src/analytics/listicle-events";
import {
  MAX_LISTICLE_EVENTS_PER_REQUEST,
  MAX_LISTICLE_EVENT_BYTES,
} from "../src/analytics/listicle-track";

// --- harness -------------------------------------------------------------------

interface DeadLetterRow {
  event_id: string;
  payload_json: string;
  reason: string;
}

function makeDb(): { db: D1Database; deadLetters: DeadLetterRow[] } {
  const deadLetters: DeadLetterRow[] = [];
  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          binds = a;
          return stmt;
        },
        async first() {
          return null;
        },
        async all() {
          return { results: [], success: true, meta: {} };
        },
        async run() {
          if (sql.includes("INSERT INTO listicle_event_dead_letter")) {
            deadLetters.push({
              event_id: String(binds[0]),
              payload_json: String(binds[1]),
              reason: String(binds[2]),
            });
          }
          return { success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, deadLetters };
}

function makeKv(): { kv: KVNamespace; store: Map<string, string> } {
  const store = new Map<string, string>();
  const kv = {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list(opts?: { prefix?: string }) {
      const prefix = opts?.prefix ?? "";
      return {
        keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true,
        cacheStatus: null,
      };
    },
  } as unknown as KVNamespace;
  return { kv, store };
}

function makeEnv(db: D1Database, kv: KVNamespace, withStream: boolean): Env {
  const env = {
    DB: db,
    CACHE: kv,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "cms.kodigital.app",
    ADMIN_BASE_URL: "https://cms.kodigital.app",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "",
    OPENAI_IMAGE_MODEL: "",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
  } as Env;
  if (withStream) {
    (env as unknown as Record<string, unknown>).AWS_ACCESS_KEY_ID = "k";
    (env as unknown as Record<string, unknown>).AWS_SECRET_ACCESS_KEY = "s";
    (env as unknown as Record<string, unknown>).LISTICLE_EVENTS_FIREHOSE_STREAM = "listicle-events";
  }
  return env;
}

function app(): Hono<{ Bindings: Env; Variables: PublicSiteVariables }> {
  const a = new Hono<{ Bindings: Env; Variables: PublicSiteVariables }>();
  a.route("/", publicRouter);
  return a;
}

interface Captured {
  ctx: ExecutionContext;
  promises: Promise<unknown>[];
}

function ctxStub(): Captured {
  const promises: Promise<unknown>[] = [];
  return {
    promises,
    ctx: {
      waitUntil(p: Promise<unknown>) {
        promises.push(p);
      },
      passThroughOnException() {},
    } as unknown as ExecutionContext,
  };
}

async function settle(captured: Captured): Promise<void> {
  await Promise.all(captured.promises.map((p) => p.catch(() => undefined)));
  await Promise.all(captured.promises.map((p) => p.catch(() => undefined)));
}

// firehose interception (records → `sent`).
let sent: unknown[] = [];
let realFetch: typeof fetch;

beforeEach(() => {
  sent = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("firehose")) {
      const bodyText =
        input instanceof Request ? await input.clone().text() : String(init?.body ?? "{}");
      const body = JSON.parse(bodyText) as { Records: Array<{ Data: string }> };
      for (const record of body.Records) {
        sent.push(JSON.parse(Buffer.from(record.Data, "base64").toString("utf8")));
      }
      return new Response(JSON.stringify({ FailedPutCount: 0, RequestResponses: [] }), {
        status: 200,
      });
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://tenant.example.com/api/lst/track", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function pageView(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_type: "page_view",
    event_id: `ev-${Math.random().toString(36).slice(2)}`,
    session_id: "sid-1",
    site_id: "st_1",
    article_id: "art_1",
    lander_v: "ver_1",
    page_view_id: "pv-1",
    url: "https://tenant.example.com/list",
    referer: "https://ref.example.com/",
    timestamp: Date.now(),
    ...overrides,
  };
}

// --- 204 always ------------------------------------------------------------------

describe("POST /api/lst/track — always 204, no reflection (§24)", () => {
  it("valid single event → 204 empty body", async () => {
    const { db } = makeDb();
    const { kv } = makeKv();
    const captured = ctxStub();
    const res = await app().request(post(pageView()), undefined, makeEnv(db, kv, false), captured.ctx);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    await settle(captured);
  });

  it("malformed JSON / non-object / unknown type / empty body → 204, nothing echoed", async () => {
    const { db } = makeDb();
    const { kv } = makeKv();
    for (const body of ["{not json", '"just a string"', "17"]) {
      const captured = ctxStub();
      const res = await app().request(post(body), undefined, makeEnv(db, kv, false), captured.ctx);
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
    }
    const captured = ctxStub();
    const res = await app().request(
      post({ event_type: "totally_unknown", session_id: "<script>alert(1)</script>" }),
      undefined,
      makeEnv(db, kv, false),
      captured.ctx,
    );
    expect(res.status).toBe(204);
    expect(await res.text()).toBe(""); // hostile bytes never reflected
    await settle(captured);
  });

  it("works on ANY host (registered before the site-context middleware)", async () => {
    const { db } = makeDb();
    const { kv } = makeKv();
    const captured = ctxStub();
    const res = await app().request(
      new Request("https://never-registered-host.example/api/lst/track", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pageView()),
      }),
      undefined,
      makeEnv(db, kv, false),
      captured.ctx,
    );
    expect(res.status).toBe(204);
    await settle(captured);
  });
});

// --- cap 20 ------------------------------------------------------------------------

describe("batch cap (§24)", () => {
  it(`{events:[…]} accepts at most ${MAX_LISTICLE_EVENTS_PER_REQUEST} events`, async () => {
    const { db } = makeDb();
    const { kv } = makeKv();
    const captured = ctxStub();
    const events = Array.from({ length: 30 }, (_, i) =>
      pageView({ event_id: `ev-cap-${i}`, event_type: "section_impression" }),
    );
    const res = await app().request(
      post({ events }),
      undefined,
      makeEnv(db, kv, true),
      captured.ctx,
    );
    expect(res.status).toBe(204);
    await settle(captured);
    expect(sent.length).toBe(MAX_LISTICLE_EVENTS_PER_REQUEST);
  });
});

// --- KV seen-set dedupe (§31.6) -----------------------------------------------------

describe("event_id idempotency via the KV seen-set (§31.6)", () => {
  it("a replayed event_id is dropped pre-Firehose; the first copy lands", async () => {
    const { db } = makeDb();
    const { kv, store } = makeKv();
    const env = makeEnv(db, kv, true);
    const event = pageView({ event_id: "ev-dup-1", event_type: "offer_impression" });

    const first = ctxStub();
    await app().request(post(event), undefined, env, first.ctx);
    await settle(first);
    const afterFirst = sent.length;
    expect(afterFirst).toBe(1);
    expect(store.has("lst_seen:ev-dup-1")).toBe(true);

    const second = ctxStub();
    await app().request(post(event), undefined, env, second.ctx);
    await settle(second);
    expect(sent.length).toBe(afterFirst); // replay dropped
  });
});

// --- dead-letter (§31.6) -------------------------------------------------------------

describe("dead-letter on invalid/oversized (§31.6)", () => {
  it("invalid event_type → D1 listicle_event_dead_letter row + record_kind=dead_letter on the stream", async () => {
    const { db, deadLetters } = makeDb();
    const { kv } = makeKv();
    const captured = ctxStub();
    const res = await app().request(
      post({ event_type: "bogus_kind", event_id: "ev-bad-1" }),
      undefined,
      makeEnv(db, kv, true),
      captured.ctx,
    );
    expect(res.status).toBe(204);
    await settle(captured);
    expect(deadLetters.length).toBe(1);
    expect(deadLetters[0]?.event_id).toBe("ev-bad-1");
    expect(deadLetters[0]?.reason).toBe("invalid_event_type");
    const dl = sent.find(
      (r) => (r as { record_kind?: string }).record_kind === "dead_letter",
    ) as { reason: string } | undefined;
    expect(dl?.reason).toBe("invalid_event_type");
  });

  it("oversized event → dead-letter with reason=oversized (payload truncated)", async () => {
    const { db, deadLetters } = makeDb();
    const { kv } = makeKv();
    const captured = ctxStub();
    const res = await app().request(
      post(pageView({ event_id: "ev-big", sub1: "x".repeat(MAX_LISTICLE_EVENT_BYTES + 100) })),
      undefined,
      makeEnv(db, kv, true),
      captured.ctx,
    );
    expect(res.status).toBe(204);
    await settle(captured);
    expect(deadLetters.length).toBe(1);
    expect(deadLetters[0]?.reason).toBe("oversized");
    // no event record made it to the stream (only the dead-letter audit).
    expect(sent.filter((r) => (r as { record_kind?: string }).record_kind === "event").length).toBe(0);
  });

  // NIT-1: the cap is BYTES, not UTF-16 code units. A payload whose code-unit
  // length is UNDER the cap but whose UTF-8 byte length is OVER it must be
  // dead-lettered (a `.length` check would have wrongly ACCEPTED it).
  it("multibyte payload: code-units < cap but bytes > cap → oversized (byte semantics)", async () => {
    const { db, deadLetters } = makeDb();
    const { kv } = makeKv();
    // '€' = 1 UTF-16 code unit, 3 UTF-8 bytes. 8000 of them = 8000 code units
    // (< 16384 cap) but 24000 bytes (> cap).
    const multibyte = "€".repeat(8000);
    expect(multibyte.length).toBeLessThan(MAX_LISTICLE_EVENT_BYTES); // a .length check would pass it
    expect(new TextEncoder().encode(multibyte).length).toBeGreaterThan(MAX_LISTICLE_EVENT_BYTES);
    const captured = ctxStub();
    const res = await app().request(
      post(pageView({ event_id: "ev-mb", sub1: multibyte })),
      undefined,
      makeEnv(db, kv, true),
      captured.ctx,
    );
    expect(res.status).toBe(204);
    await settle(captured);
    expect(deadLetters.length).toBe(1);
    expect(deadLetters[0]?.reason).toBe("oversized");
    expect(sent.filter((r) => (r as { record_kind?: string }).record_kind === "event").length).toBe(0);
  });

  it("multibyte payload comfortably UNDER the byte cap is accepted", async () => {
    const { db, deadLetters } = makeDb();
    const { kv } = makeKv();
    // 3000 '€' = 9000 bytes — well under the 16384 cap.
    const captured = ctxStub();
    const res = await app().request(
      post(pageView({ event_id: "ev-mb-ok", sub1: "€".repeat(3000) })),
      undefined,
      makeEnv(db, kv, true),
      captured.ctx,
    );
    expect(res.status).toBe(204);
    await settle(captured);
    expect(deadLetters.length).toBe(0);
    const event = sent.find((r) => (r as { record_kind?: string }).record_kind === "event") as ListicleEvent;
    expect(event.event_id).toBe("ev-mb-ok");
  });
});

// --- server enrichment + §31.8 flags ---------------------------------------------------

describe("server enrichment + §31.8 quality flags", () => {
  it("ip/ua/device/os/browser/geo/received_at are SERVER-stamped (client claims overridden)", async () => {
    const { db } = makeDb();
    const { kv } = makeKv();
    const captured = ctxStub();
    const raw = new Request("https://tenant.example.com/api/lst/track", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.9",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
      body: JSON.stringify(pageView({ ip: "6.6.6.6", ua: "forged", device: "toaster", country: "XX" })),
    });
    Object.defineProperty(raw, "cf", {
      value: { country: "DE", regionCode: "BY", city: "Munich" },
    });
    const res = await app().request(raw, undefined, makeEnv(db, kv, true), captured.ctx);
    expect(res.status).toBe(204);
    await settle(captured);
    const event = sent.find(
      (r) => (r as { record_kind?: string }).record_kind === "event",
    ) as ListicleEvent;
    expect(event.ip).toBe("203.0.113.9");
    expect(event.device).toBe("desktop");
    expect(event.os).toBe("windows");
    expect(event.browser).toBe("chrome");
    expect(event.browser_version).toMatch(/^126/);
    expect(event.country).toBe("DE");
    expect(event.state).toBe("BY");
    expect(event.city).toBe("Munich");
    expect(event.received_at).toBeGreaterThan(0);
    expect(event.traffic_quality_flag).toBe("clean");
  });

  it("declared-bot UA → is_bot + flag=bot; ko_internal cookie → internal; ?preview=1 url → preview", async () => {
    const { db } = makeDb();
    const { kv } = makeKv();
    const env = makeEnv(db, kv, true);

    const bot = ctxStub();
    await app().request(
      post(pageView({ event_id: "ev-q-bot" }), { "user-agent": "curl/8.0" }),
      undefined,
      env,
      bot.ctx,
    );
    await settle(bot);

    const internal = ctxStub();
    await app().request(
      post(pageView({ event_id: "ev-q-int" }), {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
        Cookie: "ko_internal=1",
      }),
      undefined,
      env,
      internal.ctx,
    );
    await settle(internal);

    const preview = ctxStub();
    await app().request(
      post(
        pageView({
          event_id: "ev-q-prev",
          url: "https://tenant.example.com/list?preview=1",
        }),
        {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
        },
      ),
      undefined,
      env,
      preview.ctx,
    );
    await settle(preview);

    const byId = (id: string): ListicleEvent =>
      sent.find((r) => (r as ListicleEvent).event_id === id) as ListicleEvent;
    expect(byId("ev-q-bot").is_bot).toBe(true);
    expect(byId("ev-q-bot").traffic_quality_flag).toBe("bot");
    expect(byId("ev-q-int").is_internal).toBe(true);
    expect(byId("ev-q-int").traffic_quality_flag).toBe("internal");
    expect(byId("ev-q-prev").is_preview).toBe(true);
    expect(byId("ev-q-prev").traffic_quality_flag).toBe("preview");
  });
});

// --- sessions (§16) ---------------------------------------------------------------------

describe("listicles.sessions record on page_view (§16)", () => {
  it("a page_view emits event + session (record_kind discriminator); other types do not", async () => {
    const { db } = makeDb();
    const { kv } = makeKv();
    const captured = ctxStub();
    await app().request(
      post({
        events: [
          pageView({ event_id: "ev-s-1", utm_source: "nb", traffic_source: "newsbreak", fbclid: "f1" }),
          pageView({ event_id: "ev-s-2", event_type: "section_impression" }),
        ],
      }),
      undefined,
      makeEnv(db, kv, true),
      captured.ctx,
    );
    await settle(captured);
    const kinds = sent.map((r) => (r as { record_kind: string }).record_kind).sort();
    expect(kinds).toEqual(["event", "event", "session"]);
    const session = sent.find(
      (r) => (r as { record_kind: string }).record_kind === "session",
    ) as ListicleSessionRecord;
    expect(session.session_id).toBe("sid-1");
    expect(session.landing_url).toBe("https://tenant.example.com/list");
    expect(session.article_id).toBe("art_1");
    expect(session.lander_v).toBe("ver_1");
    expect(session.utm_source).toBe("nb");
    expect(session.traffic_source).toBe("newsbreak");
    expect(session.fbclid).toBe("f1");
    expect(session.page_view_id).toBe("pv-1");
    expect(session.traffic_quality_flag).toBe("clean");
    // §16 session columns all present.
    for (const column of [
      "session_id",
      "first_seen",
      "last_seen",
      "site_id",
      "landing_url",
      "article_id",
      "lander_v",
      "article_version_id",
      "traffic_source",
      "utm_source",
      "utm_medium",
      "utm_content",
      "placement",
      "cpc",
      "fbclid",
      "fbc",
      "device",
      "os",
      "os_version",
      "browser",
      "browser_version",
      "country",
      "state",
      "city",
      "ip",
      "ua",
      "url",
      "referer",
      "language",
    ]) {
      expect(session, `session column ${column}`).toHaveProperty(column);
    }
  });
});

// --- privacy + no-op ---------------------------------------------------------------------

describe("privacy + structured no-op", () => {
  it("Sec-GPC: 1 drops the batch (still 204, nothing emitted)", async () => {
    const { db, deadLetters } = makeDb();
    const { kv } = makeKv();
    const captured = ctxStub();
    const res = await app().request(
      post(pageView(), { "Sec-GPC": "1" }),
      undefined,
      makeEnv(db, kv, true),
      captured.ctx,
    );
    expect(res.status).toBe(204);
    await settle(captured);
    expect(sent.length).toBe(0);
    expect(deadLetters.length).toBe(0);
  });

  it("without creds/stream the pipeline is a structured no-op (204, no fetch)", async () => {
    const { db } = makeDb();
    const { kv } = makeKv();
    const captured = ctxStub();
    const res = await app().request(post(pageView()), undefined, makeEnv(db, kv, false), captured.ctx);
    expect(res.status).toBe(204);
    await settle(captured);
    expect(sent.length).toBe(0); // firehose never called
  });

  it("daily accept counter bumps per site at 204-time (reconciliation feed)", async () => {
    const { db } = makeDb();
    const { kv, store } = makeKv();
    const captured = ctxStub();
    await app().request(
      post({ events: [pageView({ event_id: "ev-c1" }), pageView({ event_id: "ev-c2", event_type: "page_reach" })] }),
      undefined,
      makeEnv(db, kv, false),
      captured.ctx,
    );
    await settle(captured);
    const date = new Date().toISOString().slice(0, 10);
    expect(store.get(`lst_rcpt:${date}:st_1`)).toBe("2");
  });
});
