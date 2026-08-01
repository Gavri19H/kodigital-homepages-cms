import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/admin/conversions/actor-envelope";

type Statement = { run(...values: unknown[]): unknown; get(...values: unknown[]): unknown; all(...values: unknown[]): unknown[] };
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
const PRINCIPAL = "0198f0aa-0000-7000-8000-000000000001";
const WORKSPACE = "0198f0aa-0000-7000-8000-000000000002";
const CONNECTION = "0198f0aa-0000-7000-8000-000000000003";
const ALIAS = "0198f0aa-0000-7000-8000-000000000004";

function openDb(): Sqlite {
  const db = new DatabaseSync!(":memory:");
  db.exec(readFileSync(new URL("../migrations/0042_conversions_authority.sql", import.meta.url), "utf8"));
  db.prepare(`INSERT INTO conversion_admin_principals(
    principal_id,canonical_email,access_subject,display_name,status,is_accountable_owner,created_at,updated_at
  ) VALUES(?,'owner@example.com','cf-owner','Owner','active',1,0,0)`).run(PRINCIPAL);
  db.prepare(`INSERT INTO conversion_workspaces(
    workspace_id,workspace_name,status,reporting_currency,time_zone,accountable_owner_principal_id,created_at,updated_at
  ) VALUES(?,'Workspace','active','USD','UTC',?,0,0)`).run(WORKSPACE, PRINCIPAL);
  db.prepare(`INSERT INTO conversion_workspace_memberships(
    principal_id,workspace_id,role,status,capabilities_json,account_scope_json,created_at,updated_at
  ) VALUES(?,?,'accountable_owner','active','["connections.manage"]','[{"account_id":"account-1","currency":"USD"}]',0,0)`)
    .run(PRINCIPAL, WORKSPACE);
  db.exec(readFileSync(new URL("../migrations/0043_conversion_provider_connections.sql", import.meta.url), "utf8"));
  return db;
}

function metaSnapshot(): string {
  return canonicalJson({
    schema_version: "destination_provider_connection_snapshot.v1",
    adapter_type: "meta",
    connection: {
      core_connection: {
        schema_version: "destination_connection.v1",
        adapter_type: "meta",
        adapter_major_version: 1,
        contract_variant: "meta.v1",
        workspace_id: WORKSPACE,
        destination_connection_id: CONNECTION,
        account_public_id: "account-1",
        status: "test_only",
        test_verified: false,
        credential_present: true,
      },
      dataset_id: "12345",
      action_source: "website",
      credential_alias: {
        schema_version: "destination_provider_credential_alias.v1",
        credential_alias_id: ALIAS,
        purpose: "meta_access_token",
      },
      test_event_code: "TEST123",
    },
    production_execution_released: false,
  });
}

function seed(db: Sqlite): void {
  const snapshot = metaSnapshot();
  const hash = createHash("sha256").update(snapshot).digest();
  db.prepare(`INSERT INTO conversion_provider_credential_aliases(
    credential_alias_id,workspace_id,destination_connection_id,adapter_type,purpose,status,secret_present,
    created_at,created_by_principal_id,updated_at,updated_by_principal_id,row_version
  ) VALUES(?,?,?,?,?,'test_only',1,0,?,0,?,1)`).run(ALIAS, WORKSPACE, CONNECTION, "meta", "meta_access_token", PRINCIPAL, PRINCIPAL);
  db.prepare(`INSERT INTO conversion_provider_connection_versions(
    workspace_id,destination_connection_id,config_version,adapter_type,account_public_id,snapshot_json,
    snapshot_sha256,credential_alias_id,credential_purpose,created_at,created_by_principal_id
  ) VALUES(?,?,1,'meta','account-1',?,?,?,?,0,?)`).run(WORKSPACE, CONNECTION, snapshot, hash, ALIAS, "meta_access_token", PRINCIPAL);
  db.prepare(`INSERT INTO conversion_provider_connection_heads(
    destination_connection_id,workspace_id,current_config_version,current_snapshot_sha256,status,updated_at,row_version
  ) VALUES(?,?,1,?,'test_only',0,1)`).run(CONNECTION, WORKSPACE, hash);
}

describeSqlite("0043 provider authority migration", () => {
  it("creates exactly 3 strict tables, 4 named indexes and 7 named triggers without rows or production state", () => {
    const db = openDb();
    const names = (type: string) => db.prepare(
      `SELECT name FROM sqlite_master WHERE type=? AND name LIKE 'conversion_provider_%' ORDER BY name`,
    ).all(type) as Array<{ name: string }>;
    expect(names("table")).toHaveLength(3);
    expect((db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_conversion_provider_%' ORDER BY name",
    ).all())).toHaveLength(4);
    expect((db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_conversion_provider_%'").all())).toHaveLength(7);
    for (const table of names("table")) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${table.name}`).get() as { n: number }).n).toBe(0);
      expect((db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table.name) as { sql: string }).sql).toMatch(/\) STRICT$/);
    }
    const ddl = names("table").map(({ name }) => (db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(name) as { sql: string }).sql).join("\n");
    expect(ddl).not.toContain("production_enabled");
    db.close();
  });

  it("enforces typed alias scope, immutable versions/identities, protected deletes and legal CAS", () => {
    const db = openDb();
    seed(db);
    expect(() => db.prepare("UPDATE conversion_provider_connection_versions SET account_public_id='changed'").run()).toThrow(/immutable/i);
    expect(() => db.prepare("DELETE FROM conversion_provider_connection_heads").run()).toThrow(/protected/i);
    expect(() => db.prepare("UPDATE conversion_provider_credential_aliases SET destination_connection_id=?").run(
      "0198f0aa-0000-7000-8000-000000000008",
    )).toThrow(/immutable/i);
    expect(() => db.prepare("UPDATE conversion_provider_credential_aliases SET status='disabled',row_version=3,updated_at=1").run()).toThrow(/cas/i);
    expect(() => db.prepare("UPDATE conversion_provider_credential_aliases SET status='disabled',secret_present=0,row_version=2,updated_at=1,updated_by_principal_id=?").run(PRINCIPAL)).not.toThrow();
    expect(() => db.prepare(`INSERT INTO conversion_provider_credential_aliases(
      credential_alias_id,workspace_id,destination_connection_id,adapter_type,purpose,status,secret_present,
      created_at,created_by_principal_id,updated_at,updated_by_principal_id,row_version
    ) VALUES('0198f0aa-0000-7000-8000-000000000008',?,?,'meta','google_oauth_access_token','test_only',1,0,?,0,?,1)`)
      .run(WORKSPACE, "0198f0aa-0000-7000-8000-000000000008", PRINCIPAL, PRINCIPAL)).toThrow(/CHECK/i);
    db.close();
  });
});

describeSqlite("0044 provider execution release migration", () => {
  it("is seedless, strict, immutable and releases only one exact active Meta configuration", () => {
    const db = openDb();
    seed(db);
    db.exec(readFileSync(
      new URL("../migrations/0044_conversion_provider_execution_releases.sql", import.meta.url),
      "utf8",
    ));
    expect((db.prepare(
      "SELECT COUNT(*) AS n FROM conversion_provider_execution_releases",
    ).get() as { n: number }).n).toBe(0);
    expect((db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='conversion_provider_execution_releases'",
    ).get() as { sql: string }).sql).toMatch(/\) STRICT$/);
    const sourceHash = createHash("sha256").update(metaSnapshot()).digest();
    const approvalHash = Buffer.from("a".repeat(64), "hex");
    const insert = `INSERT INTO conversion_provider_execution_releases(
      release_id,workspace_id,destination_connection_id,config_version,source_snapshot_sha256,
      adapter_type,account_public_id,release_mode,approval_packet_sha256,status,
      activated_at,expires_at,activated_by_principal_id,updated_at,updated_by_principal_id,row_version
    ) VALUES(?,?,?,1,?,'meta','account-1','meta_test_event',?,'active',100,400,?,100,?,1)`;
    db.prepare(insert).run(
      "0198f0aa-0000-7000-8000-000000000009",
      WORKSPACE, CONNECTION, sourceHash, approvalHash, PRINCIPAL, PRINCIPAL,
    );
    expect(() => db.prepare(insert).run(
      "0198f0aa-0000-7000-8000-00000000000a",
      WORKSPACE, CONNECTION, sourceHash, approvalHash, PRINCIPAL, PRINCIPAL,
    )).toThrow(/UNIQUE/i);
    expect(() => db.prepare(
      "UPDATE conversion_provider_execution_releases SET account_public_id='changed'",
    ).run()).toThrow(/immutable/i);
    expect(() => db.prepare(
      `UPDATE conversion_provider_execution_releases
       SET status='revoked',updated_at=101,updated_by_principal_id=?,row_version=2`,
    ).run(PRINCIPAL)).not.toThrow();
    expect(() => db.prepare(
      "DELETE FROM conversion_provider_execution_releases",
    ).run()).toThrow(/protected/i);
    db.close();
  });
});
