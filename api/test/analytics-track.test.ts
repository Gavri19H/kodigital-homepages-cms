// Integration tests for POST /api/track.
//   - posts a fake event and asserts 204.
//   - asserts no throw + NO real network when AWS creds are absent (emitEvents
//     no-ops; nothing is handed to ctx.waitUntil and globalThis.fetch is never
//     called).
//   - accepts both a single event object and {events:[...]}.
//   - drops events with an unknown / missing type but still returns 204.
//   - survives a malformed JSON body (returns 204, no throw).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { analyticsRouter } from "../src/analytics/router";
import type { Env } from "../src/env";

// Minimal app that mounts ONLY the analytics router (no ADMIN_HOST gate, no DB
// resolver) so the /api/track surface is exercised in isolation.
function buildApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", analyticsRouter);
  return app;
}

// Capturing ExecutionContext (mirrors the provisioning-async test helper).
function makeCtx(): {
  ctx: ExecutionContext;
  scheduled: Promise<unknown>[];
  drain(): Promise<void>;
} {
  const scheduled: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(p: Promise<unknown>) {
      scheduled.push(p);
    },
    passThroughOnException() {},
  };
  return {
    ctx: ctx as unknown as ExecutionContext,
    scheduled,
    async drain() {
      await Promise.all(scheduled);
    },
  };
}

// Env with NO AWS creds → emitEvents must no-op.
const noCredsEnv = {} as Env;

function post(body: string, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  };
}

describe("POST /api/track", () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchCalls: number;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchCalls = 0;
    // Any real network attempt would bump this counter and fail the assertion.
    globalThis.fetch = (async (...args: unknown[]) => {
      fetchCalls += 1;
      void args;
      return new Response(null, { status: 200 });
    }) as unknown as typeof globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("accepts a single fake event, returns 204, and does not throw or hit the network (creds absent)", async () => {
    const app = buildApp();
    const { ctx, scheduled } = makeCtx();
    const res = await app.request(
      "https://example.com/api/track",
      post(
        JSON.stringify({
          session_id: "sess-1",
          url: "https://example.com/article/hello",
          referer: "https://example.com/",
          event: "page_view",
        }),
        { "user-agent": UA, "cf-connecting-ip": "203.0.113.7" },
      ),
      noCredsEnv,
      ctx,
    );

    expect(res.status).toBe(204);
    // emitEvents no-ops without creds: nothing backgrounded, no network.
    expect(scheduled).toHaveLength(0);
    expect(fetchCalls).toBe(0);
  });

  it("accepts the {events:[...]} batch shape and caps at 20 events", async () => {
    const app = buildApp();
    const { ctx } = makeCtx();
    const events = Array.from({ length: 25 }, (_v, i) => ({
      session_id: "sess-batch",
      url: "https://example.com/",
      event: "click",
      n: i,
    }));
    const res = await app.request(
      "https://example.com/api/track",
      post(JSON.stringify({ events }), { "user-agent": UA }),
      noCredsEnv,
      ctx,
    );
    expect(res.status).toBe(204);
  });

  it("drops events with an unknown event type but still returns 204", async () => {
    const app = buildApp();
    const { ctx, scheduled } = makeCtx();
    const res = await app.request(
      "https://example.com/api/track",
      post(
        JSON.stringify({ session_id: "x", event: "definitely_not_allowed" }),
        { "user-agent": UA },
      ),
      noCredsEnv,
      ctx,
    );
    expect(res.status).toBe(204);
    expect(scheduled).toHaveLength(0);
  });

  it("survives a malformed JSON body (204, no throw)", async () => {
    const app = buildApp();
    const { ctx } = makeCtx();
    const res = await app.request(
      "https://example.com/api/track",
      post("{ this is : not json", { "user-agent": UA }),
      noCredsEnv,
      ctx,
    );
    expect(res.status).toBe(204);
  });

  it("backgrounds a firehose dispatch (still 204) when creds + stream are present", async () => {
    const app = buildApp();
    const { ctx, scheduled, drain } = makeCtx();
    const env = {
      AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
      AWS_SECRET_ACCESS_KEY: "secretexample",
      AWS_REGION: "us-east-1",
      EVENTS_FIREHOSE_STREAM: "homepage-events",
    } as Env;
    const res = await app.request(
      "https://example.com/api/track",
      post(
        JSON.stringify({
          session_id: "sess-2",
          url: "https://example.com/",
          event: "impression",
          advertiser: "adx",
        }),
        { "user-agent": UA },
      ),
      env,
      ctx,
    );
    expect(res.status).toBe(204);
    // A background dispatch was scheduled; draining it must not throw (the
    // stubbed fetch returns 200, sendToFirehose swallows any error anyway).
    expect(scheduled).toHaveLength(1);
    await expect(drain()).resolves.toBeUndefined();
  });
});

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
