// LeadGen Phase 11 STAGE A — POST /lg/track (contract 08 §22.1 ingest, §22.5
// fire-and-forget + idempotency + dead-letter, §30.3 raw-PII suppression).
//
// Driven through the leadgen track router directly (the public-router MOUNT is
// Stage B) with a planted-row fake D1 + a stateful fake KV + a stream-configured
// env whose firehose fetch is intercepted, so every emitted record is
// observable. Proves: always 204 (no reflection); enrich + Firehose dispatch;
// FAIL-OPEN on a firehose error; absent-stream ⇒ structured no-op + no throw;
// the dead-letter path (D1 row + record_kind="dead_letter" stream record);
// raw answer PII is suppressed from the emitted event.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../src/env";
import { leadgenTrackRouter } from "../src/analytics/leadgen-track";
import { MAX_LEADGEN_EVENT_BYTES } from "../src/analytics/leadgen-track";

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
          if (sql.includes("INSERT INTO leadgen_event_dead_letter")) {
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
  } as unknown as KVNamespace;
  return { kv, store };
}

function makeEnv(db: D1Database, kv: KVNamespace, withStream: boolean): Env {
  const env = {
    DB: db,
    CACHE: kv,
    APP_ENV: "test",
  } as unknown as Env;
  if (withStream) {
    (env as unknown as Record<string, unknown>).AWS_ACCESS_KEY_ID = "k";
    (env as unknown as Record<string, unknown>).AWS_SECRET_ACCESS_KEY = "s";
    (env as unknown as Record<string, unknown>).LEADGEN_EVENTS_FIREHOSE_STREAM = "leadgen-events";
  }
  return env;
}

function app(): Hono<{ Bindings: Env }> {
  const a = new Hono<{ Bindings: Env }>();
  a.route("/", leadgenTrackRouter);
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

// firehose interception (records → `sent`; `failFirehose` makes fetch throw).
let sent: unknown[] = [];
let failFirehose = false;
let realFetch: typeof fetch;

beforeEach(() => {
  sent = [];
  failFirehose = false;
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("firehose")) {
      if (failFirehose) throw new Error("firehose down");
      const bodyText =
        input instanceof Request ? await input.clone().text() : String(init?.body ?? "{}");
      const body = JSON.parse(bodyText) as { Records: Array<{ Data: string }> };
      for (const record of body.Records) {
        sent.push(JSON.parse(Buffer.from(record.Data, "base64").toString("utf8")));
      }
      return new Response(JSON.stringify({ FailedPutCount: 0, RequestResponses: [] }), { status: 200 });
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://tenant.example.com/lg/track", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function quoteView(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_type: "quote_view",
    event_id: `ev-${Math.random().toString(36).slice(2)}`,
    session_id: "sid-1",
    site_id: "st_1",
    funnel_id: "lgf_1",
    funnel_attempt_id: "fa-1",
    page_view_id: "pv-1",
    url: "https://tenant.example.com/f",
    timestamp: Date.now(),
    ...overrides,
  };
}

// --- always 204 ----------------------------------------------------------------

describe("POST /lg/track — always 204, no reflection (§22.5)", () => {
  it("valid single event → 204 empty body", async () => {
    const { db } = makeDb();
    const { kv } = makeKv();
    const captured = ctxStub();
    const res = await app().request(post(quoteView()), undefined, makeEnv(db, kv, false), captured.ctx);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    await settle(captured);
  });

  it("malformed JSON / bare string / number / empty → 204, nothing echoed", async () => {
    const { db } = makeDb();
    const { kv } = makeKv();
    for (const body of ["{not json", '"just a string"', "17"]) {
      const captured = ctxStub();
      const res = await app().request(post(body), undefined, makeEnv(db, kv, true), captured.ctx);
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
      await settle(captured);
    }
  });

  it("Sec-GPC opt-out drops the batch → 204, nothing emitted", async () => {
    const { db } = makeDb();
    const { kv } = makeKv();
    const captured = ctxStub();
    const res = await app().request(
      post(quoteView(), { "Sec-GPC": "1" }),
      undefined,
      makeEnv(db, kv, true),
      captured.ctx,
    );
    expect(res.status).toBe(204);
    await settle(captured);
    expect(sent.length).toBe(0);
  });
});

// --- enrich + firehose dispatch ------------------------------------------------

describe("POST /lg/track — enrichment + Firehose dispatch (§22.1/§22.2)", () => {
  it("enriches server-owned columns and emits the event + a session record on quote_view", async () => {
    const { db } = makeDb();
    const { kv } = makeKv();
    const captured = ctxStub();
    const res = await app().request(
      post(quoteView({ event_id: "ev-fixed" }), {
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605",
        "cf-connecting-ip": "203.0.113.5",
      }),
      undefined,
      makeEnv(db, kv, true),
      captured.ctx,
    );
    expect(res.status).toBe(204);
    await settle(captured);

    const events = sent.filter((r) => (r as { record_kind?: string }).record_kind === "event");
    const sessions = sent.filter((r) => (r as { record_kind?: string }).record_kind === "session");
    expect(events.length).toBe(1);
    expect(sessions.length).toBe(1);
    const e = events[0] as Record<string, unknown>;
    expect(e.event_type).toBe("quote_view");
    expect(e.event_id).toBe("ev-fixed");
    expect(e.ip).toBe("203.0.113.5"); // server-enriched (overrides client)
    expect(e.ua).toContain("iPhone");
    expect(e.device).not.toBe(""); // parsed from UA
    expect(typeof e.received_at).toBe("number");
    expect(e.traffic_quality_flag).toBe("clean");
  });

  it("suppresses raw answer PII from the emitted event (§30.3)", async () => {
    const { db } = makeDb();
    const { kv } = makeKv();
    const captured = ctxStub();
    await app().request(
      post({
        event_type: "answer_click",
        event_id: "ev-a",
        answer_value_normalized: "homeowner",
        answer_value_raw: "123 Main St",
      }),
      undefined,
      makeEnv(db, kv, true),
      captured.ctx,
    );
    await settle(captured);
    const e = sent.find((r) => (r as { event_type?: string }).event_type === "answer_click") as Record<string, unknown>;
    expect(e).toBeDefined();
    expect(e.answer_value_raw).toBe(""); // suppressed
    expect(e.answer_value_normalized).toBe("homeowner"); // retained
  });

  it("KV seen-set drops an immediate duplicate event_id pre-Firehose (§22.5)", async () => {
    const { db } = makeDb();
    const { kv } = makeKv();
    const captured = ctxStub();
    const env = makeEnv(db, kv, true);
    await app().request(post(quoteView({ event_id: "dup-1" })), undefined, env, captured.ctx);
    await app().request(post(quoteView({ event_id: "dup-1" })), undefined, env, captured.ctx);
    await settle(captured);
    const events = sent.filter((r) => (r as { record_kind?: string }).record_kind === "event");
    expect(events.length).toBe(1); // the replay was dropped
  });
});

// --- fail-open + no-op ---------------------------------------------------------

describe("POST /lg/track — FAIL-OPEN + structured no-op (§22.1/§22.5)", () => {
  it("a Firehose error never breaks the beacon (still 204)", async () => {
    failFirehose = true;
    const { db } = makeDb();
    const { kv } = makeKv();
    const captured = ctxStub();
    const res = await app().request(post(quoteView()), undefined, makeEnv(db, kv, true), captured.ctx);
    expect(res.status).toBe(204);
    await settle(captured); // the rejected firehose promise is swallowed
  });

  it("absent stream var ⇒ no firehose call, no throw, still 204", async () => {
    const { db } = makeDb();
    const { kv } = makeKv();
    const captured = ctxStub();
    const res = await app().request(post(quoteView()), undefined, makeEnv(db, kv, false), captured.ctx);
    expect(res.status).toBe(204);
    await settle(captured);
    expect(sent.length).toBe(0);
  });
});

// --- dead-letter ---------------------------------------------------------------

describe("POST /lg/track — dead-letter path (§22.5)", () => {
  it("an unknown event_type → D1 dead-letter row + record_kind='dead_letter' stream record", async () => {
    const { db, deadLetters } = makeDb();
    const { kv } = makeKv();
    const captured = ctxStub();
    const res = await app().request(
      post({ event_type: "not_a_real_type", event_id: "bad-1" }),
      undefined,
      makeEnv(db, kv, true),
      captured.ctx,
    );
    expect(res.status).toBe(204);
    await settle(captured);
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0]?.reason).toBe("invalid_event_type");
    expect(deadLetters[0]?.event_id).toBe("bad-1");
    const dl = sent.filter((r) => (r as { record_kind?: string }).record_kind === "dead_letter");
    expect(dl).toHaveLength(1);
    expect((dl[0] as { reason?: string }).reason).toBe("invalid_event_type");
  });

  it("an oversized event → dead-lettered (oversized), never sent as an event", async () => {
    const { db, deadLetters } = makeDb();
    const { kv } = makeKv();
    const captured = ctxStub();
    const huge = "x".repeat(MAX_LEADGEN_EVENT_BYTES + 100);
    const res = await app().request(
      post(quoteView({ event_id: "big-1", answer_value_normalized: huge })),
      undefined,
      makeEnv(db, kv, true),
      captured.ctx,
    );
    expect(res.status).toBe(204);
    await settle(captured);
    expect(deadLetters.some((d) => d.reason === "oversized")).toBe(true);
    const events = sent.filter((r) => (r as { record_kind?: string }).record_kind === "event");
    expect(events.length).toBe(0);
  });

  it("a non-object array item → dead-lettered (not_an_object)", async () => {
    const { db, deadLetters } = makeDb();
    const { kv } = makeKv();
    const captured = ctxStub();
    const res = await app().request(
      post({ events: [42, "nope"] }),
      undefined,
      makeEnv(db, kv, true),
      captured.ctx,
    );
    expect(res.status).toBe(204);
    await settle(captured);
    expect(deadLetters.every((d) => d.reason === "not_an_object")).toBe(true);
    expect(deadLetters).toHaveLength(2);
  });
});
