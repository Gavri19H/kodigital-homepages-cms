// OWNER 2026-09-08: ido@kodigital.io could not open /admin/conversions.
// Enrolling a person is a deployment-stage data mutation by design (0042 is
// "intentionally seedless"), so the enrolment lives in
// scripts/db/conversions-enroll-principal.sql and is run by hand.
//
// Hand-run SQL against production deserves the same proof as shipped code, and
// the failure mode is nasty: both JSON columns are compared by the resolver
// against JSON.stringify of its OWN normalised value, so a single space or a
// reordered capability silently downgrades the person to `forbidden` — the
// exact symptom we are fixing. This suite runs the REAL file against the REAL
// migrations over node:sqlite, then feeds the stored columns to the REAL
// exported parsers the resolver uses (E11: the producer is the actual .sql, the
// consumer is the actual validator — neither side is hand-built).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CMS_CONVERSIONS_CAPABILITIES,
  parseCanonicalAccountScope,
  parseCanonicalMembershipCapabilities,
  projectCoreActorCapabilities,
} from "../src/admin/conversions/permanent-authority";

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

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ENROL_SQL = readFileSync(join(TEST_DIR, "../scripts/db/conversions-enroll-principal.sql"), "utf8");
const AUTHORITY_MIGRATION = readFileSync(
  join(TEST_DIR, "../migrations/0042_conversions_authority.sql"),
  "utf8",
);

// Production's shape on 2026-09-08: one accountable owner, one active
// workspace, USD, one Meta account in scope.
const OWNER_ID = "019fa338-d9f4-71dd-8289-0f889785c4f5";
const WORKSPACE_ID = "019fa338-d9f4-7ec5-804b-858351aa271f";
const ACCOUNT_ID = "1586188322402777";

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function run(sdb: SqliteDb, sql: string): void {
  (sdb["exec"] as (s: string) => void)(sql);
}

function productionLikeDb(): SqliteDb {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  run(sdb, AUTHORITY_MIGRATION);
  sdb.prepare(
    `INSERT INTO conversion_admin_principals
       (principal_id,canonical_email,access_subject,display_name,status,is_accountable_owner,created_at,updated_at)
     VALUES (?,'guy@kodigital.io','a122e397-0b6a-5a1a-83e1-d7154d858c9e','Guy','active',1,1,1)`,
  ).run(OWNER_ID);
  sdb.prepare(
    `INSERT INTO conversion_workspaces
       (workspace_id,workspace_name,status,reporting_currency,time_zone,accountable_owner_principal_id,created_at,updated_at)
     VALUES (?,'KODigital','active','USD','UTC',?,1,1)`,
  ).run(WORKSPACE_ID, OWNER_ID);
  sdb.prepare(
    `INSERT INTO conversion_workspace_memberships
       (principal_id,workspace_id,role,status,capabilities_json,account_scope_json,created_at,updated_at)
     VALUES (?,?,'accountable_owner','active',?,?,1,1)`,
  ).run(
    OWNER_ID, WORKSPACE_ID,
    JSON.stringify(CMS_CONVERSIONS_CAPABILITIES),
    `[{"account_id":"${ACCOUNT_ID}","currency":"USD"}]`,
  );
  return sdb;
}

interface MembershipRow {
  role: string;
  status: string;
  capabilities_json: string;
  account_scope_json: string;
  workspace_id: string;
}

function enrolled(sdb: SqliteDb): { access_subject: string; principal_id: string; status: string } & MembershipRow {
  return sdb.prepare(
    `SELECT p.principal_id,p.access_subject,p.status,
            m.role,m.status AS m_status,m.capabilities_json,m.account_scope_json,m.workspace_id
       FROM conversion_admin_principals p
       JOIN conversion_workspace_memberships m ON m.principal_id=p.principal_id
      WHERE p.canonical_email='ido@kodigital.io'`,
  ).get() as never;
}

describeDb("scripts/db/conversions-enroll-principal.sql", () => {
  it("enrols one active administrator into the existing workspace", () => {
    const sdb = productionLikeDb();
    run(sdb, ENROL_SQL);
    const row = enrolled(sdb);
    expect(row.principal_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(row.status).toBe("active");
    expect(row.role).toBe("administrator");
    expect(row.workspace_id).toBe(WORKSPACE_ID);
    sdb.close();
  });

  it("seeds the deployment-held placeholder so the real Access subject binds on first visit", () => {
    // Inventing an access_subject by hand would lock the account out for good:
    // bindVerifiedAccessSubject only fires while the placeholder is present.
    const sdb = productionLikeDb();
    run(sdb, ENROL_SQL);
    const row = enrolled(sdb);
    expect(row.access_subject).toBe(`deployment-held:${row.principal_id}`);
    sdb.close();
  });

  it("stores both JSON columns in the exact canonical form the resolver demands", () => {
    const sdb = productionLikeDb();
    run(sdb, ENROL_SQL);
    const row = enrolled(sdb);

    // The real consumers. undefined from either one => `forbidden` at runtime.
    const capabilities = parseCanonicalMembershipCapabilities(row.capabilities_json, "administrator");
    expect(capabilities).toBeDefined();
    expect(capabilities).not.toContain("ownership.manage"); // rejected for administrator
    expect(capabilities).toHaveLength(CMS_CONVERSIONS_CAPABILITIES.length - 1);
    expect(projectCoreActorCapabilities(capabilities!)).toBeDefined();

    const scope = parseCanonicalAccountScope(row.account_scope_json, "USD");
    expect(scope).toEqual([{ account_id: ACCOUNT_ID, currency: "USD" }]);
    sdb.close();
  });

  it("is a no-op on re-run instead of a UNIQUE(canonical_email) failure", () => {
    const sdb = productionLikeDb();
    run(sdb, ENROL_SQL);
    const first = enrolled(sdb).principal_id;
    run(sdb, ENROL_SQL);
    run(sdb, ENROL_SQL);
    const principals = sdb.prepare(
      "SELECT COUNT(*) AS n FROM conversion_admin_principals WHERE canonical_email='ido@kodigital.io'",
    ).get() as { n: number };
    const memberships = sdb.prepare(
      "SELECT COUNT(*) AS n FROM conversion_workspace_memberships WHERE principal_id=?",
    ).get(first) as { n: number };
    expect(principals.n).toBe(1);
    expect(memberships.n).toBe(1);
    sdb.close();
  });

  it("leaves the accountable owner untouched", () => {
    const sdb = productionLikeDb();
    run(sdb, ENROL_SQL);
    const owner = sdb.prepare(
      "SELECT is_accountable_owner AS o, access_subject AS s FROM conversion_admin_principals WHERE principal_id=?",
    ).get(OWNER_ID) as { o: number; s: string };
    expect(owner.o).toBe(1);
    expect(owner.s).toBe("a122e397-0b6a-5a1a-83e1-d7154d858c9e");
    const owners = sdb.prepare(
      "SELECT COUNT(*) AS n FROM conversion_workspace_memberships WHERE role='accountable_owner' AND status='active'",
    ).get() as { n: number };
    expect(owners.n).toBe(1);
    sdb.close();
  });
});
