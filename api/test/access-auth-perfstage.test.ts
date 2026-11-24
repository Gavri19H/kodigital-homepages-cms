import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { authStatusHandler, type AccessAuthVariables } from "../src/auth/access-auth";
import type { Env } from "../src/env";
import worker from "../src/index";
import { buildEnv, makeFakeDb } from "./helpers/admin-test-kit";

const host = "kodigital-homepages-cms-worker-perfstage.haikov1989.workers.dev";
const statusUrl = `https://${host}/api/admin/auth/status`;
const conductorIp = "192.0.2.207";
const perfstage: Env = {
  ...buildEnv(makeFakeDb().db),
  APP_ENV: "perfstage",
  PERFSTAGE: "true",
  DEV_BYPASS_AUTH: "true",
  ADMIN_ALLOW_IP: conductorIp,
  ADMIN_HOST: host,
  ADMIN_BASE_URL: `https://${host}`,
};

function authStatus(ip?: string, overrides: Partial<Env> = {}) {
  const headers = new Headers();
  if (ip !== undefined) headers.set("CF-Connecting-IP", ip);
  return worker.request(statusUrl, { headers }, { ...perfstage, ...overrides });
}

describe("perfstage admin bypass", () => {
  it("authenticates the conductor on the real Worker auth-status route", async () => {
    const response = await authStatus(conductorIp);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: true, mode: "dev-bypass" });
  });

  it("matches a complete address anywhere in a comma-separated allowlist", async () => {
    const response = await authStatus(conductorIp, { ADMIN_ALLOW_IP: `192.0.2.10,  ${conductorIp} , 192.0.2.11` });
    expect(response.status).toBe(200);
  });

  it.each([
    ["another IP", "192.0.2.10", {}],
    ["a partial IP", "192.0.2.20", {}],
    ["a missing connecting IP", undefined, {}],
    ["an empty IP and empty allowlist entries", "", { ADMIN_ALLOW_IP: ", " }],
    ["an empty allowlist", conductorIp, { ADMIN_ALLOW_IP: "" }],
    ["a missing allowlist", conductorIp, { ADMIN_ALLOW_IP: undefined }],
    ["a missing PERFSTAGE flag", conductorIp, { PERFSTAGE: undefined }],
    ["a nonliteral PERFSTAGE flag", conductorIp, { PERFSTAGE: "TRUE" }],
    ["a disabled dev bypass", conductorIp, { DEV_BYPASS_AUTH: "false" }],
  ] as const)("requires Access credentials with %s", async (_case, ip, overrides) => {
    const response = await authStatus(ip, overrides);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized: missing Cloudflare Access credentials" });
  });

  it("reports the verified identity when the client IP is outside the allowlist", async () => {
    const app = new Hono<{ Bindings: Env; Variables: AccessAuthVariables }>();
    app.get("/", c => {
      c.set("access", { mode: "identity", email: "admin@example.test", claims: {} });
      return authStatusHandler(c);
    });
    const response = await app.request("/", { headers: { "CF-Connecting-IP": "192.0.2.10" } }, perfstage);
    expect(await response.json()).toEqual({ authenticated: true, mode: "identity", email: "admin@example.test" });
  });

  it.each(["staging", "development"])("preserves the existing dev bypass for %s", async appEnv => {
    const response = await authStatus(undefined, {
      APP_ENV: appEnv, DEV_BYPASS_AUTH: "yes", PERFSTAGE: undefined, ADMIN_ALLOW_IP: undefined,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: true, mode: "dev-bypass" });
  });

  it("requires Access credentials in production even with all perfstage gates enabled", async () => {
    expect((await authStatus(conductorIp, { APP_ENV: "production" })).status).toBe(401);
  });
});
