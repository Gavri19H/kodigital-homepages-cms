import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AccessAuthVariables } from "../src/auth/access-auth";
import { conversionsUi } from "../src/admin/conversions/router";
import type { Env } from "../src/env";

const PRINCIPAL = "0198f0aa-0000-7000-8000-000000000001";
const WORKSPACE = "0198f0aa-0000-7000-8000-000000000002";
const OWNER = "0198f0aa-0000-7000-8000-000000000009";

function database(): D1Database {
  return {
    prepare(sql: string) {
      expect(sql).toContain("p.canonical_email=?1 AND p.access_subject=?2");
      let bindings: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          bindings = values;
          return this;
        },
        async all<T>() {
          expect(bindings).toEqual(["operator@example.com", "cf-user-1"]);
          return {
            success: true,
            meta: {},
            results: [{
              principal_id: PRINCIPAL,
              canonical_email: "operator@example.com",
              access_subject: "cf-user-1",
              is_accountable_owner: 0,
              workspace_id: WORKSPACE,
              role: "administrator",
              capabilities_json: '["conversions.view","connections.manage","reporting.view"]',
              account_scope_json: '[{"account_id":"kodigital-primary","currency":"USD"}]',
              reporting_currency: "USD",
              time_zone: "Asia/Jerusalem",
              accountable_owner_principal_id: OWNER,
            } as T],
          };
        },
      };
    },
  } as unknown as D1Database;
}

function app() {
  const router = new Hono<{ Bindings: Env; Variables: AccessAuthVariables }>();
  router.use("*", async (c, next) => {
    c.set("access", {
      mode: "identity",
      email: "operator@example.com",
      sub: "cf-user-1",
      claims: { iat: 1_789_000_000 },
    });
    await next();
  });
  router.route("/", conversionsUi);
  return router;
}

describe("Conversions CMS UI context", () => {
  it("projects only permanent workspace, capability, account, currency, and time-zone context", async () => {
    const response = await app().request(
      "/api/admin/conversions/ui-context",
      {},
      { DB: database(), CONVERSIONS_UI_ENABLED: "true" } as Env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json<Record<string, unknown>>();
    expect(body).toEqual({
      schema_version: "cms_conversions_ui_context.v2",
      workspace_id: WORKSPACE,
      role: "administrator",
      capabilities: ["conversions.view", "connections.manage", "reporting.view"],
      account_scope: [{ account_id: "kodigital-primary", currency: "USD" }],
      reporting_currency: "USD",
      time_zone: "Asia/Jerusalem",
      recipient_scope: [{
        recipient_id: PRINCIPAL,
        display_label: "operator@example.com",
      }],
    });
    expect(JSON.stringify(body)).toContain("operator@example.com");
    expect(JSON.stringify(body)).not.toContain("cf-user-1");
    expect(JSON.stringify(body)).toContain(PRINCIPAL);
  });

  it("fails closed when the UI release flag is off", async () => {
    const response = await app().request(
      "/api/admin/conversions/ui-context",
      {},
      { DB: database(), CONVERSIONS_UI_ENABLED: "false" } as Env,
    );
    expect(response.status).toBe(404);
  });
});
