import { describe, expect, it } from "vitest";
import type { AccessContext } from "../src/auth/access-auth";
import type { Env } from "../src/env";
import {
  CMS_CONVERSIONS_CAPABILITIES,
  PermanentAuthorityError,
  parseCanonicalMembershipCapabilities,
  projectCoreActorCapabilities,
  resolvePermanentConversionsActor,
  type ConversionMembershipRole,
} from "../src/admin/conversions/permanent-authority";
import { issuePermanentActorContext } from "../src/admin/conversions/actor-envelope";

const PRINCIPAL = "0198f0aa-0000-7000-8000-000000000001";
const WORKSPACE = "0198f0aa-0000-7000-8000-000000000002";
const OWNER = "0198f0aa-0000-7000-8000-000000000009";
const KEY = "MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE";

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    principal_id: PRINCIPAL,
    canonical_email: "operator@example.com",
    access_subject: "cf-user-1",
    is_accountable_owner: 0,
    workspace_id: WORKSPACE,
    role: "administrator",
    capabilities_json: '["conversions.view","connections.manage","reporting.view","conversions.dashboard.revenue.read"]',
    account_scope_json: '[{"account_id":"account-1","currency":"USD"}]',
    reporting_currency: "USD",
    time_zone: "UTC",
    accountable_owner_principal_id: OWNER,
    ...overrides,
  };
}

function db(rows: Record<string, unknown>[] = [row()], failure = false): D1Database {
  return {
    prepare(sql: string) {
      expect(sql).toContain("p.status='active' AND m.status='active' AND w.status='active'");
      expect(sql).toContain("LIMIT 2");
      const placeholderLookup = sql.includes("deployment-held:");
      let capturedBindings: unknown[] = [];
      return {
        bind(...bindings: unknown[]) {
          capturedBindings = bindings;
          return this;
        },
        async all<T>() {
          if (failure) throw new Error("D1 unavailable");
          if (placeholderLookup) {
            expect(capturedBindings).toEqual(["operator@example.com"]);
            return {
              results: rows.filter((candidate) =>
                candidate.canonical_email === "operator@example.com"
                && candidate.access_subject === `deployment-held:${String(candidate.principal_id)}`) as T[],
              success: true,
              meta: {},
            };
          }
          expect(sql).toContain("p.canonical_email=?1 AND p.access_subject=?2");
          expect(capturedBindings).toEqual(["operator@example.com", "cf-user-1"]);
          return {
            results: rows.filter((candidate) =>
              candidate.canonical_email === "operator@example.com"
              && candidate.access_subject === "cf-user-1") as T[],
            success: true,
            meta: {},
          };
        },
      };
    },
  } as unknown as D1Database;
}

function env(database = db()): Env {
  return {
    DB: database,
    APP_ENV: "test",
    CONVERSIONS_PROXY_ENABLED: "true",
    CONVERSIONS_ACTOR_AUDIENCE: "kodigital-conversions-core",
    CONVERSIONS_ACTOR_ENVIRONMENT: "test",
    CONVERSIONS_ACTOR_SIGNING_KEY_B64URL: KEY,
  } as Env;
}

const access: AccessContext = { mode: "identity", email: "Operator@example.com", sub: "cf-user-1", claims: {} };

describe("permanent CMS conversions authority", () => {
  it("exhaustively enforces the 14-capability canonical catalog and role maxima", () => {
    const roles: ConversionMembershipRole[] = ["accountable_owner", "administrator", "reporter"];
    const counts = new Map<ConversionMembershipRole, number>();
    for (const role of roles) {
      let accepted = 0;
      for (let mask = 0; mask < 2 ** CMS_CONVERSIONS_CAPABILITIES.length; mask += 1) {
        const subset = CMS_CONVERSIONS_CAPABILITIES.filter((_, index) => (mask & (1 << index)) !== 0);
        const actual = parseCanonicalMembershipCapabilities(JSON.stringify(subset), role) !== undefined;
        const expected = role === "accountable_owner"
          || role === "administrator" && !subset.includes("ownership.manage")
          || role === "reporter" && subset.every((capability) => [
            "conversions.view", "reporting.view", "conversions.dashboard.revenue.read",
          ].includes(capability));
        expect(actual).toBe(expected);
        if (actual) accepted += 1;
      }
      counts.set(role, accepted);
    }
    expect(Object.fromEntries(counts)).toEqual({ accountable_owner: 16_384, administrator: 8_192, reporter: 8 });
    for (const malformed of [
      "not-json", "{}", '["connections.manage","conversions.view"]',
      '["connections.manage","connections.manage"]', '["Connections.Manage"]',
      '["unknown"]', '["connections.manage",1]', '[ "connections.manage" ]',
    ]) expect(parseCanonicalMembershipCapabilities(malformed, "accountable_owner")).toBeUndefined();
  });

  it("resolves exactly one current row and issues only the 13-capability permanent Core projection", async () => {
    const authority = await resolvePermanentConversionsActor(env(), access);
    expect(authority.coreCapabilities).toEqual(["conversions.view", "connections.manage", "reporting.view"]);
    expect(authority.cmsCapabilities).toContain("conversions.dashboard.revenue.read");
    expect(projectCoreActorCapabilities(authority.cmsCapabilities)).not.toContain("conversions.dashboard.revenue.read");
    const actor = await issuePermanentActorContext(env(), authority, 1_789_000_000_000);
    expect(actor.envelope.payload).toEqual({
      schema_version: "actor_context.v2",
      signature_algorithm: "HMAC-SHA-256",
      issuer: "kodigital_cms_authority",
      audience: "kodigital-conversions-core",
      environment: "test",
      actor_id: PRINCIPAL,
      actor_reference: "cf-user-1",
      actor_email: "operator@example.com",
      workspace_id: WORKSPACE,
      role: "administrator",
      capabilities: authority.coreCapabilities,
      account_scope: [{ account_id: "account-1", currency: "USD" }],
      reporting_currency: "USD",
      request_id: actor.requestId,
      bootstrap: false,
      issued_at: 1_789_000_000,
      expires_at: 1_789_000_060,
    });
  });

  it("fails closed for cardinality, disabled/malformed authority, absent sub and D1 failure", async () => {
    await expect(resolvePermanentConversionsActor(env(db([])), access)).rejects.toMatchObject({ kind: "forbidden" });
    await expect(resolvePermanentConversionsActor(env(db([row(), row()])), access)).rejects.toMatchObject({ kind: "forbidden" });
    await expect(resolvePermanentConversionsActor(env(db([row({ capabilities_json: "[]" })])), access))
      .rejects.toMatchObject({ kind: "forbidden" });
    const reporter = await resolvePermanentConversionsActor(env(db([row({
      role: "reporter",
      capabilities_json: '["conversions.view","reporting.view","conversions.dashboard.revenue.read"]',
    })])), access);
    expect(reporter.coreCapabilities).toEqual(["conversions.view", "reporting.view"]);
    const reporterActor = await issuePermanentActorContext(env(), reporter, 1_789_000_000_000);
    expect(reporterActor.envelope.payload).toMatchObject({
      role: "reporter", capabilities: ["conversions.view", "reporting.view"],
    });
    await expect(resolvePermanentConversionsActor(env(db([row({
      role: "reporter", capabilities_json: '["conversions.dashboard.revenue.read"]',
    })])), access)).rejects.toMatchObject({ kind: "forbidden" });
    await expect(resolvePermanentConversionsActor(env(), { ...access, sub: undefined }))
      .rejects.toBeInstanceOf(PermanentAuthorityError);
    await expect(resolvePermanentConversionsActor(env(db([], true)), access)).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("binds an exact deployment-held placeholder once to the verified Access subject", async () => {
    const stored = row({ access_subject: `deployment-held:${PRINCIPAL}` });
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const database = {
      prepare(sql: string) {
        const statement = {
          sql,
          bindings: [] as unknown[],
          bind(...bindings: unknown[]) {
            statement.bindings = bindings;
            return statement;
          },
          async all<T>() {
            if (sql.includes("deployment-held:")) {
              return { success: true, results: stored.access_subject === `deployment-held:${PRINCIPAL}`
                ? [stored as T] : [], meta: {} };
            }
            return { success: true, results: stored.access_subject === "cf-user-1"
              ? [stored as T] : [], meta: {} };
          },
        };
        statements.push(statement);
        return statement;
      },
      async batch(batch: Array<{ sql: string; bindings: unknown[] }>) {
        expect(batch).toHaveLength(2);
        expect(batch[0]!.sql).toContain("conversion_authority_subject_binding_audit");
        expect(batch[1]!.sql).toContain("UPDATE conversion_admin_principals");
        expect(batch[1]!.bindings[0]).toBe("cf-user-1");
        stored.access_subject = "cf-user-1";
        return [
          { success: true, meta: { changes: 1 }, results: [] },
          { success: true, meta: { changes: 1 }, results: [] },
        ];
      },
    } as unknown as D1Database;
    const authority = await resolvePermanentConversionsActor(
      env(database),
      { ...access, claims: { iat: Math.floor(Date.now() / 1000) - 1 } },
    );
    expect(authority.accessSubject).toBe("cf-user-1");
    expect(statements.filter(({ sql }) => sql.includes("SELECT p.principal_id"))).toHaveLength(3);
  });
});
