import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { resolvePermanentConversionsActor } from "../src/admin/conversions/permanent-authority";

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
const OWNER = "0198f0aa-0000-7000-8000-000000000001";
const ADMIN = "0198f0aa-0000-7000-8000-000000000002";
const DISABLED = "0198f0aa-0000-7000-8000-000000000003";
const WORKSPACE = "0198f0aa-0000-7000-8000-000000000004";

function emptyDb(): Sqlite {
  const db = new DatabaseSync!(":memory:");
  db.exec(readFileSync(new URL("../migrations/0042_conversions_authority.sql", import.meta.url), "utf8"));
  return db;
}

function seedOwner(db: Sqlite): void {
  db.prepare(`INSERT INTO conversion_admin_principals(
    principal_id,canonical_email,access_subject,display_name,status,is_accountable_owner,created_at,updated_at
  ) VALUES(?,'owner@example.com','cf-owner','Guy Haikov','active',1,0,0)`).run(OWNER);
  db.prepare(`INSERT INTO conversion_workspaces(
    workspace_id,workspace_name,status,reporting_currency,time_zone,accountable_owner_principal_id,created_at,updated_at
  ) VALUES(?,'KODigital','active','USD','Asia/Jerusalem',?,0,0)`).run(WORKSPACE, OWNER);
  db.prepare(`INSERT INTO conversion_workspace_memberships(
    principal_id,workspace_id,role,status,capabilities_json,account_scope_json,created_at,updated_at
  ) VALUES(?,?,'accountable_owner','active',?, ?,0,0)`).run(
    OWNER,
    WORKSPACE,
    '["conversions.view","connections.manage","ownership.manage"]',
    '[{"account_id":"account-1","currency":"USD"}]',
  );
}

function d1(db: Sqlite): D1Database {
  return {
    prepare(sql: string) {
      let binds: unknown[] = [];
      return {
        bind(...values: unknown[]) { binds = values; return this; },
        async all<T>() {
          return { results: db.prepare(sql).all(...binds) as T[], success: true, meta: {} };
        },
      };
    },
  } as unknown as D1Database;
}

describeSqlite("0042 permanent conversions authority migration", () => {
  it("creates exactly 3 seedless tables, 7 named indexes and 11 integrity triggers", () => {
    const db = emptyDb();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'conversion_%' ORDER BY name").all())
      .toHaveLength(3);
    expect(db.prepare(`SELECT name FROM sqlite_master
      WHERE type='index' AND (name LIKE 'idx_conversion_%' OR name LIKE 'uq_conversion_%') ORDER BY name`).all())
      .toHaveLength(7);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_conversion_%' ORDER BY name").all())
      .toHaveLength(11);
    for (const table of ["conversion_admin_principals", "conversion_workspaces", "conversion_workspace_memberships"]) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n).toBe(0);
    }
    db.close();
  });

  it("enforces active principal/workspace and accountable-owner integrity", () => {
    const db = emptyDb();
    seedOwner(db);
    db.prepare(`INSERT INTO conversion_admin_principals(
      principal_id,canonical_email,access_subject,display_name,status,is_accountable_owner,created_at,updated_at
    ) VALUES(?,'disabled@example.com','cf-disabled','Disabled','disabled',0,0,0)`).run(DISABLED);
    expect(() => db.prepare(`INSERT INTO conversion_workspace_memberships(
      principal_id,workspace_id,role,status,capabilities_json,account_scope_json,created_at,updated_at
    ) VALUES(?,?,'administrator','active','["connections.manage"]','[]',0,0)`).run(DISABLED, WORKSPACE))
      .toThrow(/active_authority_invalid/i);
    expect(() => db.prepare("UPDATE conversion_admin_principals SET status='disabled',updated_at=1 WHERE principal_id=?").run(OWNER))
      .toThrow(/protected/i);
    expect(() => db.prepare("UPDATE conversion_workspace_memberships SET status='suspended',updated_at=1 WHERE principal_id=?").run(OWNER))
      .toThrow(/protected/i);
    expect(() => db.prepare("DELETE FROM conversion_workspace_memberships WHERE principal_id=?").run(OWNER))
      .toThrow(/protected/i);
    db.close();
  });

  it("round-trips authority rows through a clean restore and the real permanent lookup", async () => {
    const source = emptyDb();
    seedOwner(source);
    const principals = source.prepare("SELECT * FROM conversion_admin_principals ORDER BY principal_id").all() as Array<Record<string, unknown>>;
    const workspaces = source.prepare("SELECT * FROM conversion_workspaces ORDER BY workspace_id").all() as Array<Record<string, unknown>>;
    const memberships = source.prepare("SELECT * FROM conversion_workspace_memberships ORDER BY principal_id,workspace_id").all() as Array<Record<string, unknown>>;

    const restored = emptyDb();
    for (const row of principals) restored.prepare(`INSERT INTO conversion_admin_principals(
      principal_id,canonical_email,access_subject,display_name,status,is_accountable_owner,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?)`).run(...Object.values(row));
    for (const row of workspaces) restored.prepare(`INSERT INTO conversion_workspaces(
      workspace_id,workspace_name,status,reporting_currency,time_zone,accountable_owner_principal_id,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?)`).run(...Object.values(row));
    for (const row of memberships) restored.prepare(`INSERT INTO conversion_workspace_memberships(
      principal_id,workspace_id,role,status,capabilities_json,account_scope_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?)`).run(...Object.values(row));

    expect(restored.prepare("SELECT * FROM conversion_admin_principals ORDER BY principal_id").all()).toEqual(principals);
    expect(restored.prepare("SELECT * FROM conversion_workspaces ORDER BY workspace_id").all()).toEqual(workspaces);
    expect(restored.prepare("SELECT * FROM conversion_workspace_memberships ORDER BY principal_id,workspace_id").all()).toEqual(memberships);

    const authority = await resolvePermanentConversionsActor({ DB: d1(restored) } as Env, {
      mode: "identity", email: "owner@example.com", sub: "cf-owner", claims: {},
    });
    expect(authority).toMatchObject({
      principalId: OWNER, workspaceId: WORKSPACE, role: "accountable_owner",
      coreCapabilities: ["conversions.view", "connections.manage", "ownership.manage"],
    });
    source.close();
    restored.close();
  });
});
