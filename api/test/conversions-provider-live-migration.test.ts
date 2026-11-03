import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/admin/conversions/actor-envelope";

// 0065 rebuilds the provider heads and releases tables to widen two CHECKs.
// These proofs pin what a rebuild must never do: lose or alter a row, drift an
// index or trigger from 0043/0044, or leave a dangling foreign key.

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
const MIGRATION = (name: string) => readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), "utf8");

function connectionId(index: number): string {
  return `0198f0aa-0000-7000-8000-${String(100 + index).padStart(12, "0")}`;
}

function snapshot(connection: string, status: string): string {
  return canonicalJson({
    schema_version: "destination_provider_connection_snapshot.v1",
    adapter_type: "meta",
    connection: { core_connection: { destination_connection_id: connection, status }, dataset_id: "12345" },
    production_execution_released: false,
  });
}

function openSeeded(): Sqlite {
  const db = new DatabaseSync!(":memory:");
  db.exec(MIGRATION("0042_conversions_authority"));
  db.prepare(`INSERT INTO conversion_admin_principals(
    principal_id,canonical_email,access_subject,display_name,status,is_accountable_owner,created_at,updated_at
  ) VALUES(?,'owner@example.com','cf-owner','Owner','active',1,0,0)`).run(PRINCIPAL);
  db.prepare(`INSERT INTO conversion_workspaces(
    workspace_id,workspace_name,status,reporting_currency,time_zone,accountable_owner_principal_id,created_at,updated_at
  ) VALUES(?,'Workspace','active','USD','UTC',?,0,0)`).run(WORKSPACE, PRINCIPAL);
  db.exec(MIGRATION("0043_conversion_provider_connections"));
  db.exec(MIGRATION("0044_conversion_provider_execution_releases"));
  // Twelve destinations: alternating disabled/test_only heads, each with two
  // versions and a release history (one revoked, one active or expired).
  for (let index = 0; index < 12; index += 1) {
    const connection = connectionId(index);
    for (const version of [1, 2]) {
      const raw = snapshot(connection, version === 1 ? "disabled" : "test_only");
      db.prepare(`INSERT INTO conversion_provider_connection_versions(
        workspace_id,destination_connection_id,config_version,adapter_type,account_public_id,snapshot_json,
        snapshot_sha256,credential_alias_id,credential_purpose,created_at,created_by_principal_id
      ) VALUES(?,?,?,'meta','account-1',?,?,NULL,NULL,?,?)`).run(
        WORKSPACE, connection, version, raw, createHash("sha256").update(raw).digest(), index * 10 + version, PRINCIPAL,
      );
    }
    const head = snapshot(connection, "test_only");
    const headHash = createHash("sha256").update(head).digest();
    db.prepare(`INSERT INTO conversion_provider_connection_heads(
      destination_connection_id,workspace_id,current_config_version,current_snapshot_sha256,status,updated_at,row_version
    ) VALUES(?,?,2,?,?,?,?)`).run(connection, WORKSPACE, headHash, index % 2 === 0 ? "disabled" : "test_only", 1_000 + index, 1 + index);
    for (const [suffix, status] of [["a", "revoked"], ["b", index % 3 === 0 ? "expired" : "active"]] as const) {
      db.prepare(`INSERT INTO conversion_provider_execution_releases(
        release_id,workspace_id,destination_connection_id,config_version,source_snapshot_sha256,
        adapter_type,account_public_id,release_mode,approval_packet_sha256,status,
        activated_at,expires_at,activated_by_principal_id,updated_at,updated_by_principal_id,row_version
      ) VALUES(?,?,?,2,?,'meta','account-1','meta_test_event',?,?,?,?,?,?,?,?)`).run(
        `0198f0aa-0000-7000-8${suffix}00-${String(200 + index).padStart(12, "0")}`, WORKSPACE, connection, headHash,
        createHash("sha256").update(`${connection}${suffix}`).digest(), status,
        2_000 + index, 2_000 + index + 3_600, PRINCIPAL, 2_500 + index, PRINCIPAL, suffix === "a" ? 2 : 1,
      );
    }
  }
  return db;
}

const HEAD_COLUMNS = "destination_connection_id,workspace_id,current_config_version,hex(current_snapshot_sha256),status,updated_at,row_version";
const RELEASE_COLUMNS = `release_id,workspace_id,destination_connection_id,config_version,hex(source_snapshot_sha256),
  adapter_type,account_public_id,release_mode,hex(approval_packet_sha256),status,activated_at,expires_at,
  activated_by_principal_id,updated_at,updated_by_principal_id,row_version`;

function tableDigest(db: Sqlite, table: string, columns: string, order: string): { rows: number; sha256: string } {
  const rows = db.prepare(`SELECT ${columns} FROM ${table} ORDER BY ${order}`).all();
  return { rows: rows.length, sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
}

function schemaObjects(db: Sqlite, type: "index" | "trigger"): Record<string, string> {
  const rows = db.prepare(
    "SELECT name,sql FROM sqlite_master WHERE type=? AND sql IS NOT NULL AND (tbl_name=? OR tbl_name=?) ORDER BY name",
  ).all(type, "conversion_provider_connection_heads", "conversion_provider_execution_releases") as Array<{ name: string; sql: string }>;
  return Object.fromEntries(rows.map(({ name, sql }) => [name, sql]));
}

describeSqlite("0065 live provider migration", () => {
  it("keeps every head and release row byte-identical across the rebuild", () => {
    const db = openSeeded();
    const before = {
      heads: tableDigest(db, "conversion_provider_connection_heads", HEAD_COLUMNS, "destination_connection_id"),
      releases: tableDigest(db, "conversion_provider_execution_releases", RELEASE_COLUMNS, "release_id"),
      versions: tableDigest(db, "conversion_provider_connection_versions", "*", "destination_connection_id,config_version"),
    };
    expect(before.heads.rows).toBe(12);
    expect(before.releases.rows).toBe(24);
    db.exec(MIGRATION("0065_conversion_provider_live"));
    expect({
      heads: tableDigest(db, "conversion_provider_connection_heads", HEAD_COLUMNS, "destination_connection_id"),
      releases: tableDigest(db, "conversion_provider_execution_releases", RELEASE_COLUMNS, "release_id"),
      versions: tableDigest(db, "conversion_provider_connection_versions", "*", "destination_connection_id,config_version"),
    }).toEqual(before);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("PRAGMA integrity_check").all()).toEqual([{ integrity_check: "ok" }]);
    db.close();
  });

  it("recreates the 4 indexes and 5 triggers verbatim and leaves no _v2 table behind", () => {
    const db = openSeeded();
    const indexes = schemaObjects(db, "index");
    const triggers = schemaObjects(db, "trigger");
    expect(Object.keys(indexes)).toHaveLength(4);
    expect(Object.keys(triggers)).toHaveLength(5);
    db.exec(MIGRATION("0065_conversion_provider_live"));
    expect(schemaObjects(db, "index")).toEqual(indexes);
    expect(schemaObjects(db, "trigger")).toEqual(triggers);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%_v2'").all()).toEqual([]);
    for (const table of ["conversion_provider_connection_heads", "conversion_provider_execution_releases", "conversion_provider_change_audit"]) {
      expect((db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table) as { sql: string }).sql)
        .toMatch(/\) STRICT$/);
    }
    db.close();
  });

  it("keeps the recreated triggers and the one-active-release index enforcing", () => {
    const db = openSeeded();
    db.exec(MIGRATION("0065_conversion_provider_live"));
    expect(() => db.prepare("DELETE FROM conversion_provider_connection_heads").run()).toThrow(/protected/i);
    expect(() => db.prepare("UPDATE conversion_provider_connection_heads SET workspace_id=?").run(PRINCIPAL)).toThrow(/immutable/i);
    expect(() => db.prepare("DELETE FROM conversion_provider_execution_releases").run()).toThrow(/protected/i);
    expect(() => db.prepare("UPDATE conversion_provider_execution_releases SET expires_at=expires_at+1").run()).toThrow(/immutable/i);
    expect(() => db.prepare(
      "UPDATE conversion_provider_execution_releases SET status='active',row_version=row_version+1 WHERE status='revoked'",
    ).run()).toThrow(/cas/i);
    const active = db.prepare(
      "SELECT * FROM conversion_provider_execution_releases WHERE status='active' LIMIT 1",
    ).get() as Record<string, unknown>;
    expect(() => db.prepare(`INSERT INTO conversion_provider_execution_releases(
      release_id,workspace_id,destination_connection_id,config_version,source_snapshot_sha256,
      adapter_type,account_public_id,release_mode,approval_packet_sha256,status,
      activated_at,expires_at,activated_by_principal_id,updated_at,updated_by_principal_id,row_version
    ) VALUES('0198f0aa-0000-7000-8c00-000000000999',?,?,2,?,'meta','account-1','meta_live',?,'active',1,2,?,1,?,1)`).run(
      WORKSPACE, active.destination_connection_id, active.source_snapshot_sha256, active.approval_packet_sha256,
      PRINCIPAL, PRINCIPAL,
    )).toThrow(/UNIQUE/i);
    db.close();
  });

  it("adds an append-only change audit tied to a real version and release", () => {
    const db = openSeeded();
    db.exec(MIGRATION("0065_conversion_provider_live"));
    const insert = (auditId: string, version: number, releaseId: string | null, from: string | null, to: string) =>
      db.prepare(`INSERT INTO conversion_provider_change_audit(
        audit_id,workspace_id,destination_connection_id,principal_id,action,from_status,to_status,
        config_version,release_id,created_at
      ) VALUES(?,?,?,?,'meta_configure',?,?,?,?,5)`).run(auditId, WORKSPACE, connectionId(1), PRINCIPAL, from, to, version, releaseId);
    expect(() => insert("0198f0aa-0000-7000-8000-000000000a01", 2, "0198f0aa-0000-7000-8b00-000000000201", "test_only", "live"))
      .not.toThrow();
    expect(() => insert("0198f0aa-0000-7000-8000-000000000a02", 2, null, null, "disabled")).not.toThrow();
    expect(() => insert("0198f0aa-0000-7000-8000-000000000a03", 9, null, null, "live")).toThrow(/FOREIGN KEY/i);
    expect(() => insert("0198f0aa-0000-7000-8000-000000000a04", 2, "0198f0aa-0000-7000-8b00-000000000202", null, "live"))
      .toThrow(/FOREIGN KEY/i);
    expect(() => insert("0198f0aa-0000-7000-8000-000000000a05", 2, null, "paused", "live")).toThrow(/CHECK/i);
    expect(() => insert("0198f0aa-0000-4000-8000-000000000a06", 2, null, null, "live")).toThrow(/CHECK/i);
    expect(() => db.prepare("UPDATE conversion_provider_change_audit SET to_status='disabled'").run()).toThrow(/append_only/i);
    expect(() => db.prepare("DELETE FROM conversion_provider_change_audit").run()).toThrow(/append_only/i);
    expect((db.prepare("SELECT COUNT(*) AS n FROM conversion_provider_change_audit").get() as { n: number }).n).toBe(2);
    db.close();
  });
});
