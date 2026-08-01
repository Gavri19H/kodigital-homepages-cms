import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Statement = { run(...values: unknown[]): unknown; get(...values: unknown[]): unknown };
type Sqlite = { exec(sql: string): void; prepare(sql: string): Statement };
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
const PLACEHOLDER = `deployment-held:${PRINCIPAL}`;
const BOUND_SUBJECT = "cf-access-user-0001";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function migrated(): Sqlite {
  const database = new DatabaseSync!(":memory:");
  for (const name of [
    "0042_conversions_authority.sql",
    "0045_conversion_authority_subject_binding.sql",
  ]) {
    database.exec(readFileSync(resolve(import.meta.dirname, `../migrations/${name}`), "utf8"));
  }
  database.prepare(`INSERT INTO conversion_admin_principals(
    principal_id,canonical_email,access_subject,display_name,status,is_accountable_owner,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?)`).run(
    PRINCIPAL, "operator@example.com", PLACEHOLDER, "Operator", "active", 1, 1, 1,
  );
  database.prepare(`INSERT INTO conversion_workspaces(
    workspace_id,workspace_name,status,reporting_currency,time_zone,
    accountable_owner_principal_id,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?)`).run(
    WORKSPACE, "KODigital", "active", "USD", "UTC", PRINCIPAL, 1, 1,
  );
  database.prepare(`INSERT INTO conversion_workspace_memberships(
    principal_id,workspace_id,role,status,capabilities_json,account_scope_json,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?)`).run(
    PRINCIPAL, WORKSPACE, "accountable_owner", "active",
    '["conversions.view"]', '[{"account_id":"account-1","currency":"USD"}]', 1, 1,
  );
  return database;
}

describeSqlite("conversion authority verified-subject binding migration", () => {
  it("permits exactly one audited placeholder binding and makes both records immutable", () => {
    const database = migrated();
    database.prepare(`INSERT INTO conversion_authority_subject_binding_audit(
      principal_id,canonical_email,previous_subject_sha256,bound_subject_sha256,
      access_issued_at,bound_at,reason_code
    ) VALUES(?,?,?,?,?,?,?)`).run(
      PRINCIPAL, "operator@example.com", HASH_A, HASH_B, 2, 3,
      "verified_access_subject_binding",
    );
    database.prepare(`UPDATE conversion_admin_principals
      SET access_subject=?,updated_at=? WHERE principal_id=? AND access_subject=?`)
      .run(BOUND_SUBJECT, 3, PRINCIPAL, PLACEHOLDER);
    expect(database.prepare("SELECT access_subject FROM conversion_admin_principals").get())
      .toEqual({ access_subject: BOUND_SUBJECT });
    expect(() => database.prepare(`UPDATE conversion_admin_principals
      SET access_subject='other',updated_at=4 WHERE principal_id=?`).run(PRINCIPAL))
      .toThrow(/conversion_authority_subject_change_forbidden/u);
    expect(() => database.prepare(`UPDATE conversion_authority_subject_binding_audit
      SET bound_at=4 WHERE principal_id=?`).run(PRINCIPAL))
      .toThrow(/conversion_authority_subject_binding_immutable/u);
    expect(() => database.prepare("DELETE FROM conversion_authority_subject_binding_audit WHERE principal_id=?")
      .run(PRINCIPAL)).toThrow(/conversion_authority_subject_binding_immutable/u);
  });

  it("refuses an unaudited subject change", () => {
    const database = migrated();
    expect(() => database.prepare("UPDATE conversion_admin_principals SET access_subject=?,updated_at=2 WHERE principal_id=?")
      .run(BOUND_SUBJECT, PRINCIPAL)).toThrow(/conversion_authority_subject_change_forbidden/u);
  });
});
