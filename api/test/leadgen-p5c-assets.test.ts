import { describe, it, expect, vi, afterEach } from "vitest";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { LEADGEN_PERSONAS } from "../src/ai/generators/image";
import { personaQuotaPeriodYm } from "../src/admin/leadgen/assets-handlers";

// Round-4 P5c — asset endpoints (unit / integration through the REAL router).
//   POST /api/admin/leadgen/assets/brand-logo    (sanitized SVG / raster)
//   POST /api/admin/leadgen/assets/persona-image (quota-guarded generation)
//
// The D1 layer is a mock that records prepared calls, replays ai_generations
// rows on the idempotency SELECT, answers the media INSERT ... RETURNING id
// with a fake id, and models leadgen_persona_quota (migration 0045) with an
// in-memory Map keyed `${site_id}::${period_ym}`. The quota claim/refund
// handlers (`first()`/`run()`) contain NO `await` before mutating that Map,
// so — exactly like a real D1/SQLite single-statement UPDATE — the
// read-check-write is indivisible relative to every OTHER concurrently
// in-flight request, which is what makes the Promise.all race test below a
// faithful proof of the atomic-claim fix (MAJOR-2). R2 is a put-recording
// stub. CACHE is a Map-backed KV stub (unused by the quota path since the
// MAJOR-2 fix — kept only because Env requires the binding). Outbound OpenAI
// traffic is a stubbed global fetch — NO network, NO real API call, NO cost.

interface PreparedCall {
  sql: string;
  binds: unknown[];
  kind: "first" | "run" | "all";
}
interface FakeAiRow {
  id: unknown;
  idempotency_key: string;
  status: string;
  parsed_json: unknown;
  [k: string]: unknown;
}

function makeFakeDb(opts: { knownSites?: Set<string> | "all" } = {}) {
  const knownSites = opts.knownSites ?? "all";
  const calls: PreparedCall[] = [];
  const aiRows = new Map<string, FakeAiRow>();
  // leadgen_persona_quota (migration 0045), key `${site_id}::${period_ym}`.
  // Exposed to tests so they can pre-seed a boundary value or read the final
  // post-race count directly.
  const personaQuota = new Map<string, number>();
  let nextMediaId = 6;
  const prepare = (sql: string) => {
    let captured: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        captured = args;
        return stmt;
      },
      async first<T = unknown>(): Promise<T | null> {
        calls.push({ sql, binds: captured, kind: "first" });
        if (sql.includes("FROM ai_generations")) {
          return (aiRows.get(String(captured[0] ?? "")) ?? null) as T | null;
        }
        if (sql.includes("FROM sites")) {
          const id = String(captured[0] ?? "");
          const found = knownSites === "all" ? true : knownSites.has(id);
          return (found ? { id } : null) as unknown as T | null;
        }
        if (sql.startsWith("INSERT INTO media")) {
          return { id: nextMediaId++ } as unknown as T;
        }
        // --- leadgen_persona_quota: atomic claim / refund / read ---------
        // Every branch below is FULLY SYNCHRONOUS (no `await` before the Map
        // mutation) — the async keyword only affects the caller's await
        // point, not this function's internal execution, so this correctly
        // models a real D1 UPDATE's single-statement atomicity even under a
        // `Promise.all` of many concurrently-dispatched handler calls: only
        // one call's turn on the microtask queue can ever be "inside" this
        // branch's read-check-write at a time, exactly like SQLite
        // serializing writes to a row.
        if (sql.startsWith("UPDATE leadgen_persona_quota SET used = used + 1")) {
          const key = `${String(captured[0])}::${String(captured[1])}`;
          const limit = Number(captured[2]);
          const current = personaQuota.get(key) ?? 0;
          if (current < limit) {
            const next = current + 1;
            personaQuota.set(key, next);
            return { used: next } as unknown as T;
          }
          return null; // 0 rows affected — the claim is NOT granted.
        }
        if (sql.startsWith("UPDATE leadgen_persona_quota SET used = MAX(0, used - 1)")) {
          const key = `${String(captured[0])}::${String(captured[1])}`;
          const next = Math.max(0, (personaQuota.get(key) ?? 0) - 1);
          personaQuota.set(key, next);
          return { used: next } as unknown as T;
        }
        if (sql.startsWith("SELECT used FROM leadgen_persona_quota")) {
          const key = `${String(captured[0])}::${String(captured[1])}`;
          const current = personaQuota.get(key);
          return (current === undefined ? null : { used: current }) as unknown as T | null;
        }
        return null;
      },
      async run() {
        calls.push({ sql, binds: captured, kind: "run" });
        if (sql.startsWith("INSERT INTO ai_generations")) {
          const key = String(captured[6]);
          aiRows.set(key, {
            id: captured[0],
            idempotency_key: key,
            status: "pending",
            parsed_json: null,
          });
        }
        if (sql.startsWith("UPDATE ai_generations SET status = 'success'")) {
          const row = aiRows.get(String(captured[4]));
          if (row) {
            row.status = "success";
            row.parsed_json = captured[1];
          }
        }
        if (sql.startsWith("UPDATE ai_generations SET status = 'failed'")) {
          const row = aiRows.get(String(captured[2]));
          if (row) row.status = "failed";
        }
        if (sql.startsWith("INSERT INTO leadgen_persona_quota")) {
          // ON CONFLICT(site_id, period_ym) DO NOTHING — seed at 0 IFF the
          // row is absent; a pre-seeded value (a test's boundary setup)
          // survives untouched.
          const key = `${String(captured[0])}::${String(captured[1])}`;
          if (!personaQuota.has(key)) personaQuota.set(key, 0);
        }
        return { success: true, meta: {} };
      },
      async all<T = unknown>() {
        calls.push({ sql, binds: captured, kind: "all" });
        return { results: [] as T[], success: true, meta: {} };
      },
    };
    return stmt;
  };
  return { db: { prepare } as unknown as D1Database, calls, aiRows, personaQuota };
}

interface RecordedPut {
  key: string;
  value: ArrayBuffer;
  options: { httpMetadata?: { contentType?: string } } | undefined;
}
function makeFakeMedia() {
  const puts: RecordedPut[] = [];
  const bucket = {
    async put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }) {
      puts.push({ key, value, options });
      return null;
    },
  };
  return { media: bucket as unknown as R2Bucket, puts };
}

interface RecordedKvPut {
  key: string;
  value: string;
  options: { expirationTtl?: number } | undefined;
}
function makeFakeCache(opts: { forcedGet?: string } = {}) {
  const store = new Map<string, string>();
  const puts: RecordedKvPut[] = [];
  const cache = {
    async get(key: string): Promise<string | null> {
      if (opts.forcedGet !== undefined) return opts.forcedGet;
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }) {
      puts.push({ key, value, options });
      store.set(key, value);
    },
  };
  return { cache: cache as unknown as KVNamespace, store, puts };
}

function buildEnv(
  db: D1Database,
  media: R2Bucket,
  cache: KVNamespace,
  // & Record<...> so a test can also inject LEADGEN_PERSONA_MONTHLY_QUOTA —
  // an ad-hoc var the handler reads defensively (assets-handlers.ts
  // personaQuotaLimit) rather than a declared Env field.
  overrides: Partial<Env> & Record<string, unknown> = {},
): Env {
  return {
    DB: db,
    CACHE: cache,
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
    ...overrides,
  } as Env;
}

const FAKE_PNG_B64 = Buffer.from("fake-png-bytes").toString("base64");
function stubOpenAIFetch(payload: unknown, status = 200): ReturnType<typeof vi.fn> {
  const impl = vi.fn(
    async () => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", impl);
  return impl;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const BRAND_LOGO_URL = "/api/admin/leadgen/assets/brand-logo";
const PERSONA_URL = "/api/admin/leadgen/assets/persona-image";

function multipart(fields: { file?: File; site_id?: string }): RequestInit {
  const fd = new FormData();
  if (fields.file) fd.set("file", fields.file);
  if (fields.site_id) fd.set("site_id", fields.site_id);
  return { method: "POST", body: fd };
}
function postJson(body: unknown): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

const XMLNS = 'xmlns="http://www.w3.org/2000/svg"';

describe("POST /assets/brand-logo — SVG sanitize + raster pass", () => {
  it("stores a SANITIZED valid SVG (comment/PI stripped) and returns a media url", async () => {
    const { db, calls } = makeFakeDb();
    const { media, puts } = makeFakeMedia();
    const { cache } = makeFakeCache();
    // A valid SVG carrying an author comment + <?xml?> PI + no xmlns — the
    // sanitizer must strip the comment/PI and inject xmlns before storage.
    const svg = `<?xml version="1.0"?><!-- brand mark --><svg viewBox="0 0 24 24"><path d="M1 1 L2 2" fill="#f00"/></svg>`;
    const res = await admin.request(
      BRAND_LOGO_URL,
      multipart({ file: new File([svg], "logo.svg", { type: "image/svg+xml" }), site_id: "site-1" }),
      buildEnv(db, media, cache),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; media_id: number; storage_key: string; url: string; mime_type: string; sanitized: boolean };
    expect(body.ok).toBe(true);
    expect(body.sanitized).toBe(true);
    expect(body.mime_type).toBe("image/svg+xml");
    expect(body.url).toBe(`/media/${body.storage_key}`);
    // R2 stored the RE-SERIALIZED svg (no comment, no PI, xmlns injected).
    expect(puts).toHaveLength(1);
    const stored = new TextDecoder().decode(puts[0]!.value);
    expect(stored).not.toContain("<!--");
    expect(stored).not.toContain("<?xml");
    expect(stored).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(puts[0]!.options?.httpMetadata?.contentType).toBe("image/svg+xml");
    // media row: folder brand-logos, site scoped, ai_generation_id NULL.
    const ins = calls.find((c) => c.kind === "first" && c.sql.startsWith("INSERT INTO media"));
    expect(ins).toBeDefined();
    expect(ins!.binds[2]).toBe("image/svg+xml");
    expect(ins!.binds[5]).toBe("brand-logos");
    expect(ins!.binds[6]).toBe("site-1");
    expect(ins!.binds[7]).toBe(null);
  });

  it("degrades an UNKNOWN site_id to a global asset (site_id NULL) instead of failing", async () => {
    // media.site_id is a FK -> sites(id); an unknown id must not 500 a safe
    // upload — it stores as a global (NULL-scoped) asset.
    const { db, calls } = makeFakeDb({ knownSites: new Set<string>() }); // no site exists
    const { media, puts } = makeFakeMedia();
    const { cache } = makeFakeCache();
    const svg = `<svg ${XMLNS}><rect width="4" height="4"/></svg>`;
    const res = await admin.request(
      BRAND_LOGO_URL,
      multipart({ file: new File([svg], "logo.svg", { type: "image/svg+xml" }), site_id: "ghost-site" }),
      buildEnv(db, media, cache),
    );
    expect(res.status).toBe(200);
    expect(puts).toHaveLength(1);
    const ins = calls.find((c) => c.kind === "first" && c.sql.startsWith("INSERT INTO media"));
    expect(ins!.binds[6]).toBe(null); // degraded to global
  });

  it("rejects a malicious SVG with a plain-language 400 and stores NOTHING", async () => {
    const { db, calls } = makeFakeDb();
    const { media, puts } = makeFakeMedia();
    const { cache } = makeFakeCache();
    const svg = `<svg ${XMLNS}><script>alert(document.cookie)</script></svg>`;
    const res = await admin.request(
      BRAND_LOGO_URL,
      multipart({ file: new File([svg], "evil.svg", { type: "image/svg+xml" }), site_id: "site-1" }),
      buildEnv(db, media, cache),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("svg_rejected");
    expect(body.error).toMatch(/disallowed element: script/i);
    // No R2 put, no media INSERT for a rejected upload.
    expect(puts).toHaveLength(0);
    expect(calls.filter((c) => c.sql.startsWith("INSERT INTO media"))).toHaveLength(0);
  });

  it("passes a raster PNG through unchanged (image validation, not sanitized)", async () => {
    const { db } = makeFakeDb();
    const { media, puts } = makeFakeMedia();
    const { cache } = makeFakeCache();
    const bytes = Buffer.from("\x89PNG\r\n\x1a\n rest-of-a-png");
    const res = await admin.request(
      BRAND_LOGO_URL,
      multipart({ file: new File([bytes], "logo.png", { type: "image/png" }), site_id: "site-1" }),
      buildEnv(db, media, cache),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sanitized: boolean; mime_type: string };
    expect(body.sanitized).toBe(false);
    expect(body.mime_type).toBe("image/png");
    expect(puts).toHaveLength(1);
    expect(puts[0]!.options?.httpMetadata?.contentType).toBe("image/png");
    expect(puts[0]!.value.byteLength).toBe(bytes.byteLength);
  });

  it("400s an unsupported file type", async () => {
    const { db } = makeFakeDb();
    const { media, puts } = makeFakeMedia();
    const { cache } = makeFakeCache();
    const res = await admin.request(
      BRAND_LOGO_URL,
      multipart({ file: new File([Buffer.from("%PDF-1.4")], "x.pdf", { type: "application/pdf" }), site_id: "site-1" }),
      buildEnv(db, media, cache),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("unsupported_type");
    expect(puts).toHaveLength(0);
  });

  it("400s when no file field is present", async () => {
    const { db } = makeFakeDb();
    const { media } = makeFakeMedia();
    const { cache } = makeFakeCache();
    const res = await admin.request(BRAND_LOGO_URL, multipart({ site_id: "site-1" }), buildEnv(db, media, cache));
    expect(res.status).toBe(400);
  });
});

describe("POST /assets/persona-image — quota + cost safety (mocked client)", () => {
  it("501 when OPENAI_API_KEY is unset (no spend path)", async () => {
    const { db } = makeFakeDb();
    const { media, puts } = makeFakeMedia();
    const { cache } = makeFakeCache();
    const res = await admin.request(
      PERSONA_URL,
      postJson({ site_id: "site-1", persona_key: "young_woman" }),
      buildEnv(db, media, cache),
    );
    expect(res.status).toBe(501);
    expect(puts).toHaveLength(0);
  });

  it("400 for an unknown persona (validated BEFORE any call)", async () => {
    const { db } = makeFakeDb();
    const { media } = makeFakeMedia();
    const { cache } = makeFakeCache();
    const fetchSpy = stubOpenAIFetch({ data: [{ b64_json: FAKE_PNG_B64 }] });
    const res = await admin.request(
      PERSONA_URL,
      postJson({ site_id: "site-1", persona_key: "not_a_persona" }),
      buildEnv(db, media, cache, { OPENAI_API_KEY: "sk-test" }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; valid_personas: string[] };
    expect(body.code).toBe("unknown_persona");
    expect(body.valid_personas).toEqual(Object.keys(LEADGEN_PERSONAS));
    expect(fetchSpy).not.toHaveBeenCalled(); // never spent
  });

  it("400 when site_id is missing", async () => {
    const { db } = makeFakeDb();
    const { media } = makeFakeMedia();
    const { cache } = makeFakeCache();
    const res = await admin.request(
      PERSONA_URL,
      postJson({ persona_key: "young_woman" }),
      buildEnv(db, media, cache, { OPENAI_API_KEY: "sk-test" }),
    );
    expect(res.status).toBe(400);
  });

  it("generates: prompt carries persona + base scene, deterministic R2 key, quota bumps (atomic D1 claim)", async () => {
    const { db, calls, personaQuota } = makeFakeDb();
    const { media, puts } = makeFakeMedia();
    const { cache } = makeFakeCache();
    const fetchSpy = stubOpenAIFetch({ data: [{ b64_json: FAKE_PNG_B64 }] });
    const res = await admin.request(
      PERSONA_URL,
      postJson({ site_id: "site-1", persona_key: "young_woman" }),
      buildEnv(db, media, cache, { OPENAI_API_KEY: "sk-test" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; storage_key: string; url: string; persona_key: string; replay: boolean; quota: { used: number; limit: number } };
    expect(body.ok).toBe(true);
    expect(body.persona_key).toBe("young_woman");
    expect(body.replay).toBe(false);
    // deterministic per-(site,persona) key.
    expect(body.storage_key).toBe("ai/site-1/persona/young_woman.png");
    expect(body.url).toBe("/media/ai/site-1/persona/young_woman.png");
    expect(body.quota).toEqual({ used: 1, limit: 50 });
    // outbound prompt merged the persona fragment into the base scene.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/images/generations");
    const sent = JSON.parse(String(init.body)) as { model: string; prompt: string };
    expect(sent.model).toBe("gpt-image-2");
    expect(sent.prompt).toMatch(/young woman/i);
    expect(sent.prompt).toMatch(/portrait|landing page/i);
    // R2 stored the generated bytes under the deterministic key.
    expect(puts).toHaveLength(1);
    expect(puts[0]!.key).toBe("ai/site-1/persona/young_woman.png");
    // quota claimed atomically in D1 — the counter row now reads 1.
    expect(personaQuota.get(`site-1::${personaQuotaPeriodYm()}`)).toBe(1);
    // the claim UPDATE ran with a bound (never interpolated) limit.
    const claimCall = calls.find((c) => c.sql.startsWith("UPDATE leadgen_persona_quota SET used = used + 1"));
    expect(claimCall).toBeDefined();
    expect(claimCall!.binds).toEqual(["site-1", personaQuotaPeriodYm(), 50]);
    // a persona-image receipt row was written.
    expect(calls.some((c) => c.sql.startsWith("INSERT INTO ai_generations"))).toBe(true);
  });

  it("idempotency vs quota: a REPLAY (same site+persona) spends nothing and its claimed slot is refunded", async () => {
    // Regression for the coordinator's ruling: a re-request for a persona
    // image ALREADY generated for this (site, persona) must be served from
    // the recorded ai_generations/media row — zero new OpenAI calls — and
    // must NOT consume another unit of the site's monthly quota (the slot
    // claimed before the idempotent short-circuit was discovered is refunded).
    const { db, personaQuota } = makeFakeDb();
    const { media, puts } = makeFakeMedia();
    const { cache } = makeFakeCache();
    const fetchSpy = stubOpenAIFetch({ data: [{ b64_json: FAKE_PNG_B64 }] });
    const env = buildEnv(db, media, cache, { OPENAI_API_KEY: "sk-test" });

    const first = await admin.request(PERSONA_URL, postJson({ site_id: "site-replay", persona_key: "young_woman" }), env);
    const firstBody = (await first.json()) as { replay: boolean; quota: { used: number; limit: number } };
    expect(first.status).toBe(200);
    expect(firstBody.replay).toBe(false);
    expect(firstBody.quota).toEqual({ used: 1, limit: 50 });

    // Second call: SAME site + persona -> the idempotent short-circuit.
    const second = await admin.request(PERSONA_URL, postJson({ site_id: "site-replay", persona_key: "young_woman" }), env);
    const secondBody = (await second.json()) as { replay: boolean; quota: { used: number; limit: number }; storage_key: string };
    expect(second.status).toBe(200);
    expect(secondBody.replay).toBe(true);
    // quota back to its PRE-replay value — the claim it took was refunded.
    expect(secondBody.quota).toEqual({ used: 1, limit: 50 });
    expect(secondBody.storage_key).toBe("ai/site-replay/persona/young_woman.png");

    // Zero ADDITIONAL OpenAI calls and zero additional R2 puts on the replay.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(puts).toHaveLength(1);
    // The D1 counter nets to exactly 1 (claimed twice, refunded once).
    expect(personaQuota.get(`site-replay::${personaQuotaPeriodYm()}`)).toBe(1);
  });

  it("429 over quota — refuses BEFORE any OpenAI call (the atomic claim affects 0 rows)", async () => {
    const { db, personaQuota } = makeFakeDb();
    const { media, puts } = makeFakeMedia();
    const { cache } = makeFakeCache();
    // Seed the D1 counter row directly at the default limit — the INSERT-if-
    // absent step is a no-op (ON CONFLICT DO NOTHING) against a pre-seeded row.
    personaQuota.set(`site-1::${personaQuotaPeriodYm()}`, 50);
    const fetchSpy = stubOpenAIFetch({ data: [{ b64_json: FAKE_PNG_B64 }] });
    const res = await admin.request(
      PERSONA_URL,
      postJson({ site_id: "site-1", persona_key: "young_woman" }),
      buildEnv(db, media, cache, { OPENAI_API_KEY: "sk-test" }),
    );
    expect(res.status).toBe(429);
    const body = (await res.json()) as { code: string; quota: { used: number; limit: number } };
    expect(body.code).toBe("quota_exceeded");
    expect(body.quota).toEqual({ used: 50, limit: 50 });
    expect(fetchSpy).not.toHaveBeenCalled(); // no spend once over quota
    expect(puts).toHaveLength(0);
    // The claim did not move the counter (still exactly 50, no overspend).
    expect(personaQuota.get(`site-1::${personaQuotaPeriodYm()}`)).toBe(50);
  });

  it("quota decrements per generation across two distinct personas", async () => {
    const { db, personaQuota } = makeFakeDb();
    const { media } = makeFakeMedia();
    const { cache } = makeFakeCache();
    stubOpenAIFetch({ data: [{ b64_json: FAKE_PNG_B64 }] });
    const env = buildEnv(db, media, cache, { OPENAI_API_KEY: "sk-test" });
    const r1 = await admin.request(PERSONA_URL, postJson({ site_id: "site-x", persona_key: "young_woman" }), env);
    const r2 = await admin.request(PERSONA_URL, postJson({ site_id: "site-x", persona_key: "old_person" }), env);
    const b1 = (await r1.json()) as { quota: { used: number } };
    const b2 = (await r2.json()) as { quota: { used: number } };
    expect(b1.quota.used).toBe(1);
    expect(b2.quota.used).toBe(2);
    expect(personaQuota.get(`site-x::${personaQuotaPeriodYm()}`)).toBe(2);
  });

  it("MAJOR-2 fix — concurrent requests at the quota boundary: EXACTLY 1 succeeds, the rest 429, counter ends at exactly limit (no overspend)", async () => {
    // The adversarial-review scenario verbatim: N concurrent requests racing
    // the SAME atomic claim at used = limit - 1 (one slot remaining). The OLD
    // KV read-check-then-LATER-write design would have let ALL of them
    // through (every request reads the same stale `used` before the
    // multi-second OpenAI call ever runs); the D1 atomic-UPDATE claim must
    // let through EXACTLY the number of remaining slots — here, exactly 1.
    const { db, personaQuota } = makeFakeDb();
    const { media } = makeFakeMedia();
    const { cache } = makeFakeCache();
    stubOpenAIFetch({ data: [{ b64_json: FAKE_PNG_B64 }] });
    const env = buildEnv(db, media, cache, {
      OPENAI_API_KEY: "sk-test",
      LEADGEN_PERSONA_MONTHLY_QUOTA: "3",
    });

    const siteId = "site-race";
    const limit = 3;
    const key = `${siteId}::${personaQuotaPeriodYm()}`;
    // One slot remaining before the burst.
    personaQuota.set(key, limit - 1);

    // limit + 3 = 6 concurrent requests. DISTINCT personas so a "success" is
    // always a FRESH claim+generation, never masked by the separate
    // idempotent-replay mechanism (which is proven by its own test above).
    const personas = [
      "old_person",
      "young_salesman",
      "young_woman",
      "mid_age_professional",
      "friendly_advisor",
      "senior_expert",
    ];
    expect(personas).toHaveLength(limit + 3);

    const results = await Promise.all(
      personas.map((persona_key) =>
        admin.request(PERSONA_URL, postJson({ site_id: siteId, persona_key }), env),
      ),
    );
    const statuses = results.map((r) => r.status);
    const succeeded = statuses.filter((s) => s === 200);
    const rejected = statuses.filter((s) => s === 429);

    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(personas.length - 1);
    // The counter ends at EXACTLY `limit` — no overspend, no matter how many
    // requests raced the claim simultaneously.
    expect(personaQuota.get(key)).toBe(limit);
  });

  it("MAJOR-2 fix — refund path: an OpenAI failure releases the claimed slot back to its pre-claim value", async () => {
    const { db, personaQuota } = makeFakeDb();
    const { media, puts } = makeFakeMedia();
    const { cache } = makeFakeCache();
    // 400 is non-retriable so the client throws immediately; runImageGenerator
    // catches it and returns status:'failed' (T1/AC3 — never a silent
    // fallback). The handler must refund the slot it claimed before this call.
    stubOpenAIFetch({ error: { message: "bad request" } }, 400);
    const res = await admin.request(
      PERSONA_URL,
      postJson({ site_id: "site-refund", persona_key: "young_woman" }),
      buildEnv(db, media, cache, { OPENAI_API_KEY: "sk-test" }),
    );
    expect(res.status).toBe(502);
    expect(puts).toHaveLength(0);
    // Back to 0 — the pre-claim value — NOT left at 1.
    expect(personaQuota.get(`site-refund::${personaQuotaPeriodYm()}`)).toBe(0);
  });

  it("is gated by accessAuth (401 without bypass)", async () => {
    const { db } = makeFakeDb();
    const { media } = makeFakeMedia();
    const { cache } = makeFakeCache();
    const res = await admin.request(
      PERSONA_URL,
      postJson({ site_id: "site-1", persona_key: "young_woman" }),
      buildEnv(db, media, cache, { OPENAI_API_KEY: "sk-test", DEV_BYPASS_AUTH: undefined, APP_ENV: "test" }),
    );
    expect(res.status).toBe(401);
  });
});
