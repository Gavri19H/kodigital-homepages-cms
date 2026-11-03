import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AccessAuthVariables } from "../src/auth/access-auth";
import type { Env } from "../src/env";
import { canonicalJson } from "../src/admin/conversions/actor-envelope";
import {
  PROVIDER_EXECUTE_PATH,
  PROVIDER_EXECUTE_REQUEST_PURPOSE,
  handleProviderConfigurationRequest,
} from "../src/admin/conversions/provider-configuration-authority";
import { validateProviderConnectionSnapshotJson } from "../src/admin/conversions/provider-credential-aliases";
import { getMetaProviderConfig, putMetaProviderConfig } from "../src/admin/conversions/provider-meta-config";
import { resolvePermanentConversionsActor } from "../src/admin/conversions/permanent-authority";
import { conversionsUi } from "../src/admin/conversions/router";

type Statement = { run(...values: unknown[]): { changes: number | bigint }; get(...values: unknown[]): unknown; all(...values: unknown[]): unknown[] };
type Sqlite = { exec(sql: string): void; prepare(sql: string): Statement; close(): void };
type DatabaseCtor = new (path: string) => Sqlite;

function databaseCtor(): DatabaseCtor | undefined {
  try {
    return (createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: DatabaseCtor }).DatabaseSync;
  } catch {
    return undefined;
  }
}

const DatabaseSync = databaseCtor();
const describeSqlite = DatabaseSync === undefined ? describe.skip : describe;
const OPERATOR = "0198f0aa-0000-7000-8000-000000000001";
const WORKSPACE = "0198f0aa-0000-7000-8000-000000000002";
const CONNECTION = "0198f0aa-0000-7000-8000-000000000003";
const REPORTER = "0198f0aa-0000-7000-8000-000000000004";
const OTHER_WORKSPACE = "0198f0aa-0000-7000-8000-000000000005";
const FOREIGN_CONNECTION = "0198f0aa-0000-7000-8000-000000000006";
const PATH = `/api/admin/conversions/provider-connections/${CONNECTION}/meta`;
const MIGRATION = (name: string) => readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), "utf8");

function key(byte: number): string {
  return Buffer.alloc(32, byte).toString("base64url");
}

function openDb(): Sqlite {
  const db = new DatabaseSync!(":memory:");
  db.exec(MIGRATION("0042_conversions_authority"));
  const principal = db.prepare(`INSERT INTO conversion_admin_principals(
    principal_id,canonical_email,access_subject,display_name,status,is_accountable_owner,created_at,updated_at
  ) VALUES(?,?,?,'Person','active',?,0,0)`);
  principal.run(OPERATOR, "operator@example.com", "cf-operator", 1);
  principal.run(REPORTER, "reporter@example.com", "cf-reporter", 0);
  const workspace = db.prepare(`INSERT INTO conversion_workspaces(
    workspace_id,workspace_name,status,reporting_currency,time_zone,accountable_owner_principal_id,created_at,updated_at
  ) VALUES(?,'Workspace','active','USD','UTC',?,0,0)`);
  workspace.run(WORKSPACE, OPERATOR);
  workspace.run(OTHER_WORKSPACE, OPERATOR);
  const membership = db.prepare(`INSERT INTO conversion_workspace_memberships(
    principal_id,workspace_id,role,status,capabilities_json,account_scope_json,created_at,updated_at
  ) VALUES(?,?,?,'active',?,'[{"account_id":"account-1","currency":"USD"}]',0,0)`);
  membership.run(OPERATOR, WORKSPACE, "accountable_owner", '["conversions.view","connections.manage"]');
  membership.run(REPORTER, WORKSPACE, "reporter", '["conversions.view"]');
  db.exec(MIGRATION("0043_conversion_provider_connections"));
  db.exec(MIGRATION("0044_conversion_provider_execution_releases"));
  db.exec(MIGRATION("0065_conversion_provider_live"));
  return db;
}

interface FakeStatement { sql: string; bindings: unknown[] }

// Minimal D1 over node:sqlite. batch() is one transaction, like D1.
function d1(db: Sqlite): D1Database {
  const statement = (sql: string): FakeStatement & Record<string, unknown> => {
    const self: FakeStatement & Record<string, unknown> = {
      sql,
      bindings: [],
      bind(...values: unknown[]) { self.bindings = values; return self; },
      async first<T>() { return (db.prepare(sql).get(...self.bindings) ?? null) as T | null; },
      async all<T>() { return { results: db.prepare(sql).all(...self.bindings) as T[], success: true, meta: {} }; },
      async run() { const result = db.prepare(sql).run(...self.bindings); return { success: true, meta: { changes: Number(result.changes) } }; },
    };
    return self;
  };
  return {
    prepare: statement,
    async batch(statements: FakeStatement[]) {
      db.exec("BEGIN");
      try {
        const results = statements.map(({ sql, bindings }) => {
          const result = db.prepare(sql).run(...bindings);
          return { success: true, meta: { changes: Number(result.changes) }, results: [] };
        });
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
}

function env(db: Sqlite, overrides: Partial<Env> = {}): Env {
  return {
    DB: d1(db), APP_ENV: "test", CONVERSIONS_UI_ENABLED: "true",
    CONVERSIONS_ACTOR_AUDIENCE: "kodigital-conversions-core",
    CMS_PROVIDER_EXECUTE_REQUEST_HMAC_KEY_B64URL: key(4),
    CMS_PROVIDER_EXECUTE_RESPONSE_HMAC_KEY_B64URL: key(5),
    ...overrides,
  } as Env;
}

function app(email = "operator@example.com", sub = "cf-operator") {
  const router = new Hono<{ Bindings: Env; Variables: AccessAuthVariables }>();
  router.use("*", async (c, next) => {
    c.set("access", { mode: "identity", email, sub, claims: { iat: 1_700_000_000 } });
    await next();
  });
  router.route("/", conversionsUi);
  return router;
}

function body(status: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: "cms_meta_provider_config.v1",
    status,
    dataset_id: "123456789",
    action_source: "website",
    test_event_code: status === "test_only" ? "TEST42" : null,
    expected_head_row_version: null,
    ...overrides,
  };
}

async function put(environment: Env, value: unknown, path = PATH, contentType = "application/json"): Promise<Response> {
  return app().request(path, {
    method: "PUT", headers: { "Content-Type": contentType }, body: JSON.stringify(value),
  }, environment);
}

function count(db: Sqlite, table: string, where = "1=1"): number {
  return Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n);
}

function tableCounts(db: Sqlite): Record<string, number> {
  return Object.fromEntries([
    "conversion_provider_credential_aliases", "conversion_provider_connection_versions",
    "conversion_provider_connection_heads", "conversion_provider_execution_releases",
    "conversion_provider_change_audit",
  ].map((table) => [table, count(db, table)]));
}

function operator(environment: Env) {
  return resolvePermanentConversionsActor(environment, {
    mode: "identity", email: "operator@example.com", sub: "cf-operator", claims: { iat: 1_700_000_000 },
  });
}

describeSqlite("Meta provider configuration endpoint (CMS writer)", () => {
  it("walks a connection from not configured to testing, live and off with one audit row per change", async () => {
    const db = openDb();
    const environment = env(db);
    const before = Math.floor(Date.now() / 1_000);

    const empty = await app().request(PATH, {}, environment);
    expect(empty.status).toBe(200);
    expect(empty.headers.get("cache-control")).toBe("no-store");
    expect(await empty.json()).toEqual({
      schema_version: "cms_meta_provider_config_view.v1", connection_id: CONNECTION, configured: false,
      status: "disabled", dataset_id: null, action_source: null, test_event_code: null,
      head_row_version: null, config_version: null, release: null,
    });

    const testing = await put(environment, body("test_only"));
    expect(testing.status).toBe(200);
    const testingView = await testing.json<Record<string, unknown>>();
    expect(testingView).toMatchObject({
      configured: true, status: "test_only", dataset_id: "123456789", action_source: "website",
      test_event_code: "TEST42", head_row_version: 1, config_version: 1,
      release: { release_mode: "meta_test_event" },
    });
    const testingRelease = testingView.release as { expires_at: number };
    expect(testingRelease.expires_at - before).toBeGreaterThanOrEqual(3_600);
    expect(testingRelease.expires_at - before).toBeLessThanOrEqual(3_602);
    const alias = db.prepare("SELECT * FROM conversion_provider_credential_aliases").get() as Record<string, unknown>;
    expect(alias).toMatchObject({ workspace_id: WORKSPACE, destination_connection_id: CONNECTION, status: "test_only", secret_present: 1 });

    const live = await put(environment, body("live", { expected_head_row_version: 1 }));
    expect(live.status).toBe(200);
    const liveView = await live.json<Record<string, unknown>>();
    expect(liveView).toMatchObject({
      status: "live", test_event_code: null, head_row_version: 2, config_version: 2,
      release: { release_mode: "meta_live" },
    });
    expect((liveView.release as { expires_at: number }).expires_at - before).toBeGreaterThanOrEqual(31_536_000);
    expect((liveView.release as { expires_at: number }).expires_at - before).toBeLessThanOrEqual(31_536_002);
    expect(count(db, "conversion_provider_credential_aliases")).toBe(1);
    expect(count(db, "conversion_provider_execution_releases", "status='active'")).toBe(1);
    expect(count(db, "conversion_provider_execution_releases", "status='revoked'")).toBe(1);

    const version = db.prepare(
      "SELECT * FROM conversion_provider_connection_versions WHERE config_version=2",
    ).get() as Record<string, unknown>;
    const snapshot = validateProviderConnectionSnapshotJson(version.snapshot_json, {
      adapterType: "meta", workspaceId: WORKSPACE, destinationConnectionId: CONNECTION,
      accountPublicId: CONNECTION, status: "live", credentialAliasId: String(alias.credential_alias_id),
    });
    expect(snapshot).toBeDefined();
    expect(Buffer.from(version.snapshot_sha256 as Uint8Array).toString("hex"))
      .toBe(createHash("sha256").update(String(version.snapshot_json)).digest("hex"));

    const off = await put(environment, body("disabled", { expected_head_row_version: 2 }));
    expect(off.status).toBe(200);
    expect(await off.json()).toMatchObject({
      status: "disabled", test_event_code: null, head_row_version: 3, config_version: 3, release: null,
    });
    expect(count(db, "conversion_provider_execution_releases", "status='active'")).toBe(0);
    const offVersion = db.prepare(
      "SELECT credential_alias_id,snapshot_json FROM conversion_provider_connection_versions WHERE config_version=3",
    ).get() as Record<string, unknown>;
    expect(offVersion.credential_alias_id).toBeNull();
    expect(validateProviderConnectionSnapshotJson(offVersion.snapshot_json, { status: "disabled" })).toBeDefined();

    const audit = db.prepare(`SELECT principal_id,action,from_status,to_status,config_version,release_id
      FROM conversion_provider_change_audit ORDER BY config_version`).all() as Array<Record<string, unknown>>;
    expect(audit.map(({ from_status, to_status, config_version }) => [from_status, to_status, config_version])).toEqual([
      [null, "test_only", 1], ["test_only", "live", 2], ["live", "disabled", 3],
    ]);
    expect(audit.every((row) => row.principal_id === OPERATOR && row.action === "meta_configure")).toBe(true);
    expect(audit[0]!.release_id).toEqual(expect.any(String));
    expect(audit[2]!.release_id).toBeNull();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  it("is accepted by the provider authority: a live write yields a released live execute capability", async () => {
    const db = openDb();
    const environment = env(db);
    await put(environment, body("test_only"));
    const view = await (await put(environment, body("live", { expected_head_row_version: 1 }))).json<Record<string, unknown>>();
    const version = db.prepare(
      "SELECT snapshot_sha256 FROM conversion_provider_connection_versions WHERE config_version=2",
    ).get() as { snapshot_sha256: Uint8Array };
    const now = Math.floor(Date.now() / 1_000);
    const payload = {
      schema_version: "destination_provider_connection_execute_request.v1",
      workspace_id: WORKSPACE, destination_connection_id: CONNECTION, adapter_type: "meta", account_public_id: CONNECTION,
      delivery_id: "a12d9e7c-4b31-5a00-8000-000000000006", delivery_generation: 1, attempt_number: 1, native_id: null,
      first_attempt_at: "2026-07-20T00:00:00.000Z", started_at: "2026-07-20T00:00:01.000Z",
      lease_token: key(9), lease_generation: 1, dispatch_pointer_sha256: "a".repeat(64),
      expected_config_version: 2, expected_snapshot_sha256: Buffer.from(version.snapshot_sha256).toString("hex"),
      issued_at: now, expires_at: now + 30, nonce: "abcdefghijklmnop",
    };
    const signature = createHmac("sha256", Buffer.from(key(4), "base64url"))
      .update(`${PROVIDER_EXECUTE_REQUEST_PURPOSE}\n${canonicalJson(payload)}`).digest("base64url");
    const response = await handleProviderConfigurationRequest(new Request(`https://private.invalid${PROVIDER_EXECUTE_PATH}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: canonicalJson({ payload, signature }),
    }), environment, now);
    expect(response.status).toBe(200);
    const wire = await response.json() as { payload: Record<string, unknown> };
    expect(wire.payload).toMatchObject({
      schema_version: "destination_provider_connection_execute_capability.v2",
      status: "live", production_execution_released: true,
      release_expires_at: (view.release as { expires_at: number }).expires_at,
    });
    expect(JSON.parse(String(wire.payload.snapshot_json))).toMatchObject({
      connection: { test_event_code: null, core_connection: { status: "live", credential_present: true } },
    });
    db.close();
  });

  it("refuses a stale row version and writes nothing", async () => {
    const db = openDb();
    const environment = env(db);
    await put(environment, body("test_only"));
    const counts = tableCounts(db);
    for (const expected of [null, 2, 7]) {
      const response = await put(environment, body("live", { expected_head_row_version: expected }));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "resource_changed" } });
    }
    expect(await put(environment, body("live", { expected_head_row_version: 5 }), PATH)).toHaveProperty("status", 409);
    expect(tableCounts(db)).toEqual(counts);
    db.close();
  });

  it.each(["live", "disabled"])("rolls the whole %s batch back when another change lands between reading and writing", async (status) => {
    const db = openDb();
    const base = env(db);
    await put(base, body("test_only"));
    const raw = base.DB;
    let raced = false;
    const racing = {
      prepare: raw.prepare.bind(raw),
      async batch(statements: D1PreparedStatement[]) {
        if (!raced) {
          raced = true;
          const authority = await resolvePermanentConversionsActor(base, {
            mode: "identity", email: "operator@example.com", sub: "cf-operator", claims: { iat: 1_700_000_000 },
          });
          await putMetaProviderConfig(base, authority, CONNECTION, body("disabled", { expected_head_row_version: 1 }));
        }
        return raw.batch(statements);
      },
    } as unknown as D1Database;
    // "disabled" writes the very same snapshot bytes as the racing change.
    const response = await put({ ...base, DB: racing }, body(status, { expected_head_row_version: 1 }));
    expect(response.status).toBe(409);
    expect(tableCounts(db)).toEqual({
      conversion_provider_credential_aliases: 1,
      conversion_provider_connection_versions: 2,
      conversion_provider_connection_heads: 1,
      conversion_provider_execution_releases: 1,
      conversion_provider_change_audit: 2,
    });
    expect(db.prepare("SELECT status,row_version FROM conversion_provider_connection_heads").get())
      .toEqual({ status: "disabled", row_version: 2 });
    db.close();
  });

  it("writes nothing (no version, release or audit row) when the head moves between reading and writing", async () => {
    const db = openDb();
    const base = env(db);
    await put(base, body("test_only"));
    const counts = tableCounts(db);
    const releaseBefore = db.prepare("SELECT release_id,status,row_version FROM conversion_provider_execution_releases").all();
    const raw = base.DB;
    const racing = {
      prepare: raw.prepare.bind(raw),
      async batch(statements: D1PreparedStatement[]) {
        // A concurrent writer bumps the head without adding a version, so no
        // primary key collides: only the row-version guard can stop this save.
        db.prepare("UPDATE conversion_provider_connection_heads SET row_version=row_version+1").run();
        return raw.batch(statements);
      },
    } as unknown as D1Database;
    const response = await put({ ...base, DB: racing }, body("live", { expected_head_row_version: 1 }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "resource_changed" } });
    expect(tableCounts(db)).toEqual(counts);
    expect(db.prepare("SELECT release_id,status,row_version FROM conversion_provider_execution_releases").all())
      .toEqual(releaseBefore);
    expect(db.prepare("SELECT status,row_version,current_config_version FROM conversion_provider_connection_heads").get())
      .toEqual({ status: "test_only", row_version: 2, current_config_version: 1 });
    db.close();
  });

  it("writes nothing when another first save lands between reading and writing", async () => {
    const db = openDb();
    const base = env(db);
    const raw = base.DB;
    let raced = false;
    const racing = {
      prepare: raw.prepare.bind(raw),
      async batch(statements: D1PreparedStatement[]) {
        if (!raced) {
          raced = true;
          await putMetaProviderConfig(base, await operator(base), CONNECTION, body("disabled"));
        }
        return raw.batch(statements);
      },
    } as unknown as D1Database;
    const response = await put({ ...base, DB: racing }, body("test_only"));
    expect(response.status).toBe(409);
    expect(tableCounts(db)).toEqual({
      conversion_provider_credential_aliases: 0,
      conversion_provider_connection_versions: 1,
      conversion_provider_connection_heads: 1,
      conversion_provider_execution_releases: 0,
      conversion_provider_change_audit: 1,
    });
    db.close();
  });

  it.each([
    ["test_only", 3_600, "meta_test_event"],
    ["live", 31_536_000, "meta_live"],
  ] as const)("saving %s again with the same status revokes the old approval and issues a new one", async (status, seconds, mode) => {
    const db = openDb();
    const environment = env(db);
    const authority = await operator(environment);
    const t0 = Date.UTC(2026, 10, 3, 12, 0, 0);
    const first = await putMetaProviderConfig(environment, authority, CONNECTION, body(status), t0);
    expect(first.release).toEqual({ release_mode: mode, expires_at: t0 / 1_000 + seconds, ended: false });
    const later = t0 + (seconds + 60) * 1_000;
    const expired = await getMetaProviderConfig(environment, authority, CONNECTION, later);
    expect(expired.release).toEqual({ release_mode: mode, expires_at: t0 / 1_000 + seconds, ended: true });
    const oldRelease = db.prepare("SELECT release_id FROM conversion_provider_execution_releases").get() as { release_id: string };

    const renewed = await putMetaProviderConfig(environment, authority, CONNECTION,
      body(status, { expected_head_row_version: 1 }), later);
    expect(renewed).toMatchObject({ status, head_row_version: 2, config_version: 2 });
    expect(renewed.release).toEqual({ release_mode: mode, expires_at: later / 1_000 + seconds, ended: false });
    expect(db.prepare("SELECT status,updated_at FROM conversion_provider_execution_releases WHERE release_id=?")
      .get(oldRelease.release_id)).toEqual({ status: "revoked", updated_at: later / 1_000 });
    expect(count(db, "conversion_provider_execution_releases", "status='active'")).toBe(1);
    expect(count(db, "conversion_provider_change_audit", `from_status='${status}' AND to_status='${status}'`)).toBe(1);
    db.close();
  });

  it("reports an approval marked expired as ended, and none at all once sending is off", async () => {
    const db = openDb();
    const environment = env(db);
    const authority = await operator(environment);
    const t0 = Date.UTC(2026, 10, 3, 12, 0, 0);
    await putMetaProviderConfig(environment, authority, CONNECTION, body("live"), t0);
    db.prepare(`UPDATE conversion_provider_execution_releases
      SET status='expired',updated_at=updated_at+1,row_version=row_version+1`).run();
    expect((await getMetaProviderConfig(environment, authority, CONNECTION, t0 + 5_000)).release)
      .toEqual({ release_mode: "meta_live", expires_at: t0 / 1_000 + 31_536_000, ended: true });
    await putMetaProviderConfig(environment, authority, CONNECTION, body("disabled", { expected_head_row_version: 1 }), t0 + 10_000);
    expect((await getMetaProviderConfig(environment, authority, CONNECTION, t0 + 10_000)).release).toBeNull();
    db.close();
  });

  it("validates the request strictly", async () => {
    const db = openDb();
    const environment = env(db);
    for (const invalid of [
      body("live", { test_event_code: "TEST42" }),
      body("test_only", { test_event_code: null }),
      body("disabled", { test_event_code: "TEST42" }),
      body("paused"),
      body("live", { dataset_id: "pixel-1" }),
      body("live", { action_source: "billboard" }),
      body("live", { expected_head_row_version: 0 }),
      body("live", { schema_version: "cms_meta_provider_config.v2" }),
      { ...body("live"), access_token: "secret" },
      (({ action_source: _, ...rest }) => rest)(body("live")),
      [],
    ]) {
      const response = await put(environment, invalid);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
    }
    expect((await put(environment, body("live"), PATH, "text/plain")).status).toBe(415);
    expect((await app().request(PATH, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: "{".repeat(5_000),
    }, environment)).status).toBe(400);
    expect(count(db, "conversion_provider_change_audit")).toBe(0);
    db.close();
  });

  it("requires the Connections permission, the UI release flag and a well-formed connection id", async () => {
    const db = openDb();
    const environment = env(db);
    const reporter = app("reporter@example.com", "cf-reporter");
    expect((await reporter.request(PATH, {}, environment)).status).toBe(403);
    expect((await reporter.request(PATH, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body("live")),
    }, environment)).status).toBe(403);
    expect((await app("stranger@example.com", "cf-stranger").request(PATH, {}, environment)).status).toBe(403);
    expect((await app().request(PATH, {}, env(db, { CONVERSIONS_UI_ENABLED: "false" }))).status).toBe(404);
    expect((await app().request("/api/admin/conversions/provider-connections/not-a-uuid/meta", {}, environment)).status)
      .toBe(404);
    expect((await app().request(PATH, { method: "POST" }, environment)).status).toBe(404);
    expect(count(db, "conversion_provider_change_audit")).toBe(0);
    db.close();
  });

  it("never shows or overwrites a connection configured under another workspace", async () => {
    const db = openDb();
    const raw = canonicalJson({ foreign: true });
    const digest = createHash("sha256").update(raw).digest();
    db.prepare(`INSERT INTO conversion_provider_connection_versions(
      workspace_id,destination_connection_id,config_version,adapter_type,account_public_id,snapshot_json,
      snapshot_sha256,credential_alias_id,credential_purpose,created_at,created_by_principal_id
    ) VALUES(?,?,1,'meta','account-9',?,?,NULL,NULL,0,?)`).run(OTHER_WORKSPACE, FOREIGN_CONNECTION, raw, digest, OPERATOR);
    db.prepare(`INSERT INTO conversion_provider_connection_heads(
      destination_connection_id,workspace_id,current_config_version,current_snapshot_sha256,status,updated_at,row_version
    ) VALUES(?,?,1,?,'disabled',0,1)`).run(FOREIGN_CONNECTION, OTHER_WORKSPACE, digest);
    const environment = env(db);
    const path = `/api/admin/conversions/provider-connections/${FOREIGN_CONNECTION}/meta`;
    expect((await app().request(path, {}, environment)).status).toBe(404);
    expect((await put(environment, body("live", { expected_head_row_version: 1 }), path)).status).toBe(404);
    expect(count(db, "conversion_provider_connection_versions")).toBe(1);
    db.close();
  });
});
