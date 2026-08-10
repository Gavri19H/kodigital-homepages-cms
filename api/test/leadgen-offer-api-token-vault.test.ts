// Offer API-token vault (migration 0056) — the operator pastes a provider token
// in the admin UI and nothing else happens by hand.
//
// The headline test is a REAL producer → consumer proof: the token is stored by
// the REAL admin PATCH route over the REAL migrations, read back out of D1 with
// the same `SELECT *` the auction engine uses, and the REAL fetchProvider is
// what proves the provider request carries it. Neither side is hand-built (the
// false-green class this repo has been bitten by: a fixture row on one side and
// a fixture expectation on the other proves nothing about the wiring).
//
// The rest of the suite pins the properties the credential path depends on:
// ciphertext at rest, fresh IV per save, no plaintext anywhere in an API
// response, fail-CLOSED on a rotated key, blank-save preserves, explicit
// removal clears, client mode refuses.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { fetchProvider } from "../src/public/leadgen/auction/fetch";
import type { LeadgenOfferRow } from "../src/admin/leadgen/db-types";
import {
  offerApiTokenSealed,
  resolveOfferApiToken,
  sealOfferApiToken,
} from "../src/leadgen/offer-api-token";
import { offerRowToApi } from "../src/admin/leadgen/offers-handlers";
import { REDACTED_VALUE } from "../src/leadgen/redact";

// --- node:sqlite harness (repo pattern) ------------------------------------
type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    return (createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
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
      } catch (e) {
        runSql(sdb, "ROLLBACK");
        throw e;
      }
      return out;
    },
  } as unknown as D1Database;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(TEST_DIR, "..", "migrations");

// EVERY leadgen migration in filename order (0036 → latest), so this suite
// always runs against the schema the product actually deploys — a hardcoded
// list is what lets a new column go untested.
function leadgenMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) >= 36)
    .sort();
}

function createDb(ctor: DatabaseSyncCtor): SqliteDb {
  const sdb = new ctor(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
  );
  for (const f of leadgenMigrationFiles()) runSql(sdb, readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  return sdb;
}

// The vault's key source in every environment (production has this secret set;
// LEADGEN_OFFER_TOKEN_KEY is the optional dedicated upgrade).
const SIGNING_KEY = "vault-test-signing-key-do-not-reuse";

function buildEnv(db: D1Database, extra: Record<string, unknown> = {}): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
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
    LEADGEN_CONFIG_SIGNING_KEY: SIGNING_KEY,
    ...extra,
  } as unknown as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

interface Harness {
  sdb: SqliteDb;
  env: Env;
}
function newHarness(extra: Record<string, unknown> = {}): Harness {
  const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb), extra) };
}

const API = "/api/admin/leadgen";

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// A dynamic server-mode offer created through the REAL create route.
async function createDynamicOffer(env: Env): Promise<{ public_id: string }> {
  const res = await admin.request(
    `${API}/offers`,
    jsonInit("POST", {
      offer_name: "Vault Provider",
      activity: "quote_funnel",
      vertical: "life",
      conversion_tracking_method: "s2s_postback",
      offer_type: "cpc",
      calls_provider_api: true,
      bid_source: "response",
      placements: [`pl-${mintPublicId("offer").slice(-8)}`],
      cap_enabled: false,
    }),
    env,
  );
  expect(res.status, await res.clone().text()).toBe(201);
  const body = (await res.json()) as { offer?: { public_id: string }; public_id?: string };
  const publicId = body.offer?.public_id ?? body.public_id;
  expect(typeof publicId).toBe("string");
  return { public_id: publicId as string };
}

async function patchOffer(env: Env, publicId: string, body: unknown): Promise<{ status: number; json: Record<string, unknown>; raw: string }> {
  const res = await admin.request(`${API}/offers/${publicId}`, jsonInit("PATCH", body), env);
  const raw = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* non-JSON body stays visible through `raw` */
  }
  return { status: res.status, json, raw };
}

// The engine's own read: `SELECT * FROM leadgen_offers WHERE id = ?`
// (public/leadgen/auction/engine.ts). Reading the row the SAME way is what
// makes the runtime leg below a real consumer instead of a fixture.
function readOfferRow(sdb: SqliteDb, publicId: string): LeadgenOfferRow {
  const row = sdb.prepare("SELECT * FROM leadgen_offers WHERE public_id = ?").get(publicId);
  expect(row, `offer ${publicId} must exist`).toBeTruthy();
  return row as LeadgenOfferRow;
}

const EMPTY_SCHEMA = { version: 1, root: { type: "object" as const, children: [] } };

describeDb("LeadGen offer API-token vault (0056)", () => {
  const PASTED = "sk_live_9f2c7ab41d6e4f80b3aa";

  it("END TO END: the operator pastes a token in the admin API, D1 holds only ciphertext, and the REAL provider request carries the plaintext", async () => {
    const { sdb, env } = newHarness();
    const offer = await createDynamicOffer(env);

    // --- PRODUCER: the real PATCH route the Request tab calls ---------------
    const saved = await patchOffer(env, offer.public_id, {
      endpoint_production: "https://api.provider.example.com/quotes",
      request_method: "POST",
      api_token_placement: "header",
      api_token_param_name: "authorization",
      api_token_value: PASTED,
    });
    expect(saved.status, saved.raw).toBe(200);

    // The response may never carry the token OR its ciphertext.
    expect(saved.raw).not.toContain(PASTED);
    expect(saved.raw).not.toContain("api_token_cipher");
    expect(saved.raw).not.toContain("api_token_key_id");

    // --- AT REST: ciphertext, not the token --------------------------------
    const stored = readOfferRow(sdb, offer.public_id);
    expect(typeof stored.api_token_cipher).toBe("string");
    expect(stored.api_token_cipher).not.toContain(PASTED);
    expect(stored.api_token_cipher).toMatch(/^[A-Za-z0-9+/]+={0,2}\.[A-Za-z0-9+/]+={0,2}$/);
    expect(stored.api_token_key_id).toBe("lgok1");
    expect(typeof stored.api_token_updated_at).toBe("number");
    // Nothing wrote the plaintext into a neighbouring column either.
    expect(JSON.stringify(stored)).not.toContain(PASTED);

    // --- CONSUMER: the REAL runtime request path ---------------------------
    let sentAuthorization: string | null = null;
    let sentUrl = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sentUrl = typeof input === "string" ? input : String((input as Request).url ?? input);
      const headers = new Headers(init?.headers ?? {});
      sentAuthorization = headers.get("authorization");
      return new Response(JSON.stringify({ bid: 4.25 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;
    let result: Awaited<ReturnType<typeof fetchProvider>>;
    try {
      result = await fetchProvider(env, stored, [], EMPTY_SCHEMA, { answers: {}, macros: {}, timeout_ms: 2500 }, "production");
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(sentUrl).toBe("https://api.provider.example.com/quotes");
    expect(sentAuthorization).toBe(PASTED);
    expect(result.error_reason).toBeNull();

    // The ADMIN-VISIBLE leg is masked: a vaulted token is redacted exactly like
    // a wrangler-resolved one. (`result.debug` is the encrypt-only record that
    // rides the AES-GCM debug_ref blob — it carries the real header BY DESIGN
    // and is never written to an admin-visible column, so it is not asserted
    // secret-free here.)
    expect(result.redacted_log.request_headers_redacted_json).not.toContain(PASTED);
    expect(JSON.parse(result.redacted_log.request_headers_redacted_json)).toMatchObject({
      authorization: REDACTED_VALUE,
    });
  });

  it("a blank api_token_value LEAVES the saved token alone (an ordinary save must not wipe a credential)", async () => {
    const { sdb, env } = newHarness();
    const offer = await createDynamicOffer(env);
    await patchOffer(env, offer.public_id, { api_token_value: PASTED });
    const first = readOfferRow(sdb, offer.public_id);
    expect(first.api_token_cipher).not.toBeNull();

    // The editor posts every field on save; the token box is blank because the
    // value is never rendered back into it.
    const again = await patchOffer(env, offer.public_id, {
      offer_name: "Vault Provider Renamed",
      api_token_value: null,
      api_token_clear: false,
    });
    expect(again.status, again.raw).toBe(200);
    const second = readOfferRow(sdb, offer.public_id);
    expect(second.offer_name).toBe("Vault Provider Renamed");
    expect(second.api_token_cipher).toBe(first.api_token_cipher);
    expect(second.api_token_key_id).toBe(first.api_token_key_id);
  });

  it("api_token_clear removes the stored token; a save that both pastes and clears is refused", async () => {
    const { sdb, env } = newHarness();
    const offer = await createDynamicOffer(env);
    await patchOffer(env, offer.public_id, { api_token_value: PASTED });

    const conflict = await patchOffer(env, offer.public_id, { api_token_value: "another", api_token_clear: true });
    expect(conflict.status).toBe(400);
    expect((conflict.json["fields"] as Record<string, string>)["api_token_value"]).toContain("one request");
    expect(readOfferRow(sdb, offer.public_id).api_token_cipher).not.toBeNull();

    const cleared = await patchOffer(env, offer.public_id, { api_token_clear: true });
    expect(cleared.status, cleared.raw).toBe(200);
    const row = readOfferRow(sdb, offer.public_id);
    expect(row.api_token_cipher).toBeNull();
    expect(row.api_token_key_id).toBeNull();
    expect(row.api_token_updated_at).toBeNull();
  });

  it("a re-paste re-seals with a FRESH IV (no ciphertext reuse) and both decrypt to the pasted value", async () => {
    const { sdb, env } = newHarness();
    const offer = await createDynamicOffer(env);
    await patchOffer(env, offer.public_id, { api_token_value: PASTED });
    const first = readOfferRow(sdb, offer.public_id);
    await patchOffer(env, offer.public_id, { api_token_value: PASTED });
    const second = readOfferRow(sdb, offer.public_id);

    expect(second.api_token_cipher).not.toBe(first.api_token_cipher);
    await expect(resolveOfferApiToken(env, first)).resolves.toEqual({ kind: "stored", value: PASTED });
    await expect(resolveOfferApiToken(env, second)).resolves.toEqual({ kind: "stored", value: PASTED });
  });

  it("the offer API projection reports presence only — never the ciphertext, never the key id", async () => {
    const { sdb, env } = newHarness();
    const offer = await createDynamicOffer(env);
    await patchOffer(env, offer.public_id, { api_token_value: PASTED });

    const projected = offerRowToApi(readOfferRow(sdb, offer.public_id)) as unknown as Record<string, unknown>;
    expect(projected["api_token_present"]).toBe(true);
    expect(typeof projected["api_token_updated_at"]).toBe("number");
    expect("api_token_cipher" in projected).toBe(false);
    expect("api_token_key_id" in projected).toBe(false);

    // …and the same holds through the real GET route.
    const res = await admin.request(`${API}/offers/${offer.public_id}`, {}, env);
    const raw = await res.text();
    expect(raw).not.toContain(PASTED);
    expect(raw).not.toContain("api_token_cipher");
    expect(raw).toContain('"api_token_present":true');
  });

  it("a client-mode offer may not store a token (the browser would receive it)", async () => {
    const { sdb, env } = newHarness();
    const offer = await createDynamicOffer(env);
    const res = await patchOffer(env, offer.public_id, {
      request_execution_mode: "client",
      endpoint_production: "https://api.provider.example.com/quotes",
      api_token_value: PASTED,
    });
    expect(res.status).toBe(400);
    expect((res.json["fields"] as Record<string, string>)["api_token_value"]).toContain("client-mode");
    expect(readOfferRow(sdb, offer.public_id).api_token_cipher).toBeNull();
  });

  it("the vault columns are not directly patchable — a client cannot write its own ciphertext", async () => {
    const { env } = newHarness();
    const offer = await createDynamicOffer(env);
    const res = await patchOffer(env, offer.public_id, { api_token_cipher: "AAAA.BBBB", api_token_key_id: "lgok1" });
    expect(res.status).toBe(400);
    const fields = res.json["fields"] as Record<string, string>;
    expect(fields["api_token_cipher"]).toContain("not an updatable field");
    expect(fields["api_token_key_id"]).toContain("not an updatable field");
  });

  it("fails CLOSED when the key source rotates away: no token is sent and the request is refused", async () => {
    const { sdb, env } = newHarness();
    const offer = await createDynamicOffer(env);
    await patchOffer(env, offer.public_id, {
      endpoint_production: "https://api.provider.example.com/quotes",
      api_token_placement: "header",
      api_token_param_name: "authorization",
      api_token_value: PASTED,
    });
    const stored = readOfferRow(sdb, offer.public_id);

    // Same row, an environment whose signing key was rotated.
    const rotated = buildEnv(d1FromSqlite(sdb), { LEADGEN_CONFIG_SIGNING_KEY: "a-different-signing-key" });
    await expect(resolveOfferApiToken(rotated, stored)).resolves.toEqual({ kind: "failed", code: "decrypt_failed" });

    let called = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof globalThis.fetch;
    let result: Awaited<ReturnType<typeof fetchProvider>>;
    try {
      result = await fetchProvider(rotated, stored, [], EMPTY_SCHEMA, { answers: {}, macros: {}, timeout_ms: 2500 }, "production");
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(called).toBe(false);
    expect(result.notes.some((n) => n.code === "token_vault_unreadable")).toBe(true);
  });

  it("the vault NEVER falls back to the legacy secret reference when a stored token is unreadable", async () => {
    const { env } = newHarness({
      LEADGEN_ALLOWED_OUTBOUND_SECRET_REFS: "OFFER_TOKEN_LEGACY",
      OFFER_TOKEN_LEGACY: "legacy-binding-value",
    });
    const row = {
      api_token_cipher: "not-base64!.also-not",
      api_token_key_id: "lgok1",
      api_token_secret_ref: "OFFER_TOKEN_LEGACY",
      api_token_placement: "header",
      api_token_param_name: "authorization",
      request_execution_mode: "server",
      endpoint_production: "https://api.provider.example.com/quotes",
      endpoint_staging: null,
      request_method: "POST",
    } as unknown as LeadgenOfferRow;

    let sentAuthorization: string | null = "unset";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentAuthorization = new Headers(init?.headers ?? {}).get("authorization");
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof globalThis.fetch;
    let result: Awaited<ReturnType<typeof fetchProvider>>;
    try {
      result = await fetchProvider(env, row, [], EMPTY_SCHEMA, { answers: {}, macros: {}, timeout_ms: 2500 }, "production");
    } finally {
      globalThis.fetch = originalFetch;
    }
    // The legacy binding resolves fine — and is still NOT used, because a
    // broken vault row must not silently downgrade to a different credential.
    expect(sentAuthorization).toBe("unset");
    expect(result.notes.some((n) => n.code === "token_vault_unreadable")).toBe(true);
  });

  it("resolution shapes: absent when nothing is stored, cipher_malformed on a broken blob, key_missing when no key source is bound", async () => {
    const { env } = newHarness();
    await expect(
      resolveOfferApiToken(env, { api_token_cipher: null, api_token_key_id: null }),
    ).resolves.toEqual({ kind: "absent" });
    await expect(
      resolveOfferApiToken(env, { api_token_cipher: "   ", api_token_key_id: "lgok1" }),
    ).resolves.toEqual({ kind: "absent" });
    await expect(
      resolveOfferApiToken(env, { api_token_cipher: "onlyonepart", api_token_key_id: "lgok1" }),
    ).resolves.toEqual({ kind: "failed", code: "cipher_malformed" });
    await expect(
      resolveOfferApiToken(env, { api_token_cipher: "AAAA.BBBB", api_token_key_id: "bogus" }),
    ).resolves.toEqual({ kind: "failed", code: "cipher_malformed" });

    const sealed = await sealOfferApiToken(env, PASTED);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;
    const keyless = buildEnv(env.DB, { LEADGEN_CONFIG_SIGNING_KEY: undefined });
    await expect(
      resolveOfferApiToken(keyless, { api_token_cipher: sealed.cipher, api_token_key_id: sealed.keyId }),
    ).resolves.toEqual({ kind: "failed", code: "key_missing" });
    // …and the same environment refuses to STORE rather than storing plaintext.
    await expect(sealOfferApiToken(keyless, PASTED)).resolves.toEqual({ ok: false, code: "key_missing" });
  });

  it("a dedicated LEADGEN_OFFER_TOKEN_KEY takes over new saves without orphaning rows sealed under the signing key", async () => {
    const { env } = newHarness();
    const underSigningKey = await sealOfferApiToken(env, PASTED);
    expect(underSigningKey.ok && underSigningKey.keyId).toBe("lgok1");

    const dedicated = buildEnv(env.DB, { LEADGEN_OFFER_TOKEN_KEY: "a-dedicated-vault-key" });
    const underDedicated = await sealOfferApiToken(dedicated, PASTED);
    expect(underDedicated.ok && underDedicated.keyId).toBe("lgok2");
    if (!underSigningKey.ok || !underDedicated.ok) return;

    // Both rows keep opening in the environment that has both secrets.
    await expect(
      resolveOfferApiToken(dedicated, { api_token_cipher: underSigningKey.cipher, api_token_key_id: "lgok1" }),
    ).resolves.toEqual({ kind: "stored", value: PASTED });
    await expect(
      resolveOfferApiToken(dedicated, { api_token_cipher: underDedicated.cipher, api_token_key_id: "lgok2" }),
    ).resolves.toEqual({ kind: "stored", value: PASTED });
    // …and the two ciphertexts are genuinely different keys, not the same one twice.
    await expect(
      resolveOfferApiToken(env, { api_token_cipher: underDedicated.cipher, api_token_key_id: "lgok2" }),
    ).resolves.toEqual({ kind: "failed", code: "key_missing" });
  });

  it("offerApiTokenSealed is a presence gate: stored + key bound, no decrypt", async () => {
    const { env } = newHarness();
    const sealed = await sealOfferApiToken(env, PASTED);
    if (!sealed.ok) throw new Error("seal failed");
    expect(offerApiTokenSealed(env, { api_token_cipher: sealed.cipher, api_token_key_id: "lgok1" })).toBe(true);
    expect(offerApiTokenSealed(env, { api_token_cipher: null, api_token_key_id: null })).toBe(false);
    expect(offerApiTokenSealed(env, { api_token_cipher: sealed.cipher, api_token_key_id: "lgok2" })).toBe(false);
  });

  it("an over-long token is refused (nothing half-stored)", async () => {
    const { sdb, env } = newHarness();
    const offer = await createDynamicOffer(env);
    const res = await patchOffer(env, offer.public_id, { api_token_value: "x".repeat(1025) });
    expect(res.status).toBe(400);
    expect((res.json["fields"] as Record<string, string>)["api_token_value"]).toContain("1024");
    expect(readOfferRow(sdb, offer.public_id).api_token_cipher).toBeNull();
  });
});
