import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AccessContext } from "../src/auth/access-auth";
import { conversionsBootstrapWarning } from "../src/admin/conversions/bootstrap-warning";
import type { Env } from "../src/env";

const PRINCIPAL_ID = "0198f0aa-0000-7000-8000-000000000001";
const WORKSPACE_ID = "0198f0aa-0000-7000-8000-000000000002";
const OWNER_ID = "0198f0aa-0000-7000-8000-000000000003";
const ORIGINAL = '<!doctype html><body><main><div class="admin-content"><p>content</p></div></main></body>';
const ACCESS: AccessContext = {
  mode: "identity", email: "operator@example.com", sub: "cf-user-1", claims: {},
};

function authorityRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    principal_id: PRINCIPAL_ID,
    canonical_email: "operator@example.com",
    access_subject: "cf-user-1",
    is_accountable_owner: 0,
    workspace_id: WORKSPACE_ID,
    role: "administrator",
    capabilities_json: '["conversions.view","connections.manage"]',
    account_scope_json: '[{"account_id":"account-1","currency":"USD"}]',
    reporting_currency: "USD",
    time_zone: "UTC",
    accountable_owner_principal_id: OWNER_ID,
    ...overrides,
  };
}

function environment(
  rows: ReadonlyArray<Record<string, unknown>> = [authorityRow()],
  { fail = false, reads = [] as string[] } = {},
): Env {
  return new Proxy({
    DB: {
      prepare(sql: string) {
        reads.push(`sql:${sql}`);
        return {
          bind(...bindings: unknown[]) {
            reads.push(`bindings:${JSON.stringify(bindings)}`);
            return {
              async all() {
                if (fail) throw new Error("isolated D1 failure");
                return { success: true, results: [...rows] };
              },
            };
          },
        };
      },
    },
  } as unknown as Env, {
    get(target, key, receiver) {
      if (typeof key === "string") reads.push(`env:${key}`);
      return Reflect.get(target as object, key, receiver);
    },
  });
}

function app({ duplicate = false } = {}): Hono<{
  Bindings: Env;
  Variables: { access: AccessContext };
}> {
  const testApp = new Hono<{ Bindings: Env; Variables: { access: AccessContext } }>();
  testApp.use("/admin/*", async (c, next) => {
    c.set("access", ACCESS);
    await next();
  });
  for (const path of ["/admin/conversions/*", "/admin/reporting/*"]) {
    testApp.use(path, conversionsBootstrapWarning);
    if (duplicate) testApp.use(path, conversionsBootstrapWarning);
  }
  testApp.get("/admin/*", (c) => {
    if (c.req.path.endsWith("/json")) return c.json({ ok: false }, 503);
    if (c.req.path.endsWith("/redirect")) return c.redirect("/admin/conversions", 302);
    return new Response(ORIGINAL, {
      headers: { "Content-Type": "text/html; charset=UTF-8", "Content-Length": "91" },
    });
  });
  return testApp;
}

function warningCount(html: string): number {
  return html.match(/data-conversions-bootstrap-warning="critical"/g)?.length ?? 0;
}

describe("Conversions permanent-authority warning", () => {
  it("keeps valid permanent authority byte-identical", async () => {
    const reads: string[] = [];
    const response = await app().request("https://cms.example/admin/conversions", {}, environment(undefined, { reads }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(ORIGINAL);
    expect(reads.some((entry) => entry.includes("p.status='active'")
      && entry.includes("m.status='active'") && entry.includes("w.status='active'"))).toBe(true);
  });

  it("renders exactly one non-secret critical block for every authority failure class", async () => {
    const failures = [
      environment([]),
      environment([authorityRow(), authorityRow({ workspace_id: "0198f0aa-0000-7000-8000-000000000004" })]),
      environment([authorityRow({ capabilities_json: "not-json" })]),
      environment([authorityRow({ reporting_currency: "usd" })]),
      environment([authorityRow()], { fail: true }),
    ];
    for (const bindings of failures) {
      const response = await app().request("https://cms.example/admin/reporting/example", {}, bindings);
      const html = await response.text();
      expect(warningCount(html)).toBe(1);
      expect(html).toContain("permanent Conversions authority is unavailable");
      expect(html).toContain("Production effects remain blocked");
      expect(html).not.toContain("operator@example.com");
      expect(html).not.toContain(WORKSPACE_ID);
      expect(response.headers.get("content-length")).toBeNull();
    }
  });

  it("is scoped to Conversions and Reporting HTML surfaces only", async () => {
    for (const path of [
      "/admin/conversions", "/admin/conversions/example", "/admin/reporting", "/admin/reporting/example",
    ]) {
      const reads: string[] = [];
      const bindings = environment([], { reads });
      expect(warningCount(await (await app().request(`https://cms.example${path}`, {}, bindings)).text())).toBe(1);
      expect(reads.filter((entry) => entry.startsWith("sql:"))).toHaveLength(2);
    }
    const bindings = environment([]);
    expect(await (await app().request("https://cms.example/admin/listicles", {}, bindings)).text()).toBe(ORIGINAL);
  });

  it("does not rewrite non-HTML, errors, redirects, or duplicate an existing middleware warning", async () => {
    const reads: string[] = [];
    const bindings = environment([], { reads });
    const json = await app().request("https://cms.example/admin/conversions/json", {}, bindings);
    expect(json.status).toBe(503);
    expect(await json.json()).toEqual({ ok: false });
    const redirect = await app().request("https://cms.example/admin/reporting/redirect", {}, bindings);
    expect(redirect.status).toBe(302);
    expect(reads.filter((entry) => entry.startsWith("sql:"))).toHaveLength(0);
    const html = await (await app({ duplicate: true }).request(
      "https://cms.example/admin/conversions/example", {}, bindings,
    )).text();
    expect(warningCount(html)).toBe(1);
  });

  it("never reads legacy bootstrap, config-map, proxy, or default-workspace bindings", async () => {
    const reads: string[] = [];
    await (await app().request("https://cms.example/admin/conversions", {}, environment([], { reads }))).text();
    expect(reads.filter((entry) => entry.startsWith("env:"))).toEqual(["env:DB", "env:DB"]);
    for (const forbidden of [
      "CONVERSIONS_BOOTSTRAP_EXPIRES_AT", "CONVERSIONS_ADMIN_EMAILS",
      "CONVERSIONS_ACTOR_ID_BY_EMAIL", "DEFAULT_WORKSPACE_ID", "CONVERSIONS_PROXY_ENABLED",
    ]) expect(reads).not.toContain(`env:${forbidden}`);
  });
});
