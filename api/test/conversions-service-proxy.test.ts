import { Hono } from "hono";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { HAS_CONVERSIONS_CORE, coreUrl, importCore } from "./helpers/conversions-core-root";
import type { AccessAuthVariables, AccessContext } from "../src/auth/access-auth";
import type { Env } from "../src/env";
import {
  ACTOR_CONTEXT_HEADER,
  ACTOR_OPERATION_SCOPE_HEADER,
  ACTOR_REQUEST_ID_HEADER,
} from "../src/admin/conversions/actor-envelope";
import {
  CMS_ACTOR_ISSUER_BY_OPERATION,
  CMS_BOOTSTRAP_POLICY_BY_OPERATION,
  CMS_CANONICAL_TARGET_POLICY,
  CMS_PROXY_ROUTE_POLICIES,
  conversionsProxy,
} from "../src/admin/conversions/proxy";

const ACTOR_ID = "0198f0aa-0000-7000-8000-000000000001";
const WORKSPACE_ID = "0198f0aa-0000-7000-8000-000000000002";
const CONNECTION_ID = "0198f0aa-0000-7000-8000-000000000003";
const REPORT_ID = "0198f0aa-0000-7000-8000-000000000004";
const RECIPIENT_ID = "0198f0aa-0000-7000-8000-000000000005";
const OWNER_ID = "0198f0aa-0000-7000-8000-000000000009";
const EVENT_ID_V5 = "0198f0aa-0000-5000-8000-000000000007";
const DELIVERY_ID_V5 = "0198f0aa-0000-5000-8000-000000000008";
const ACCOUNT_SCOPE = Object.freeze([{ account_id: "account-1", currency: "USD" }]);
const ACCOUNT_SCOPE_SHA256 = createHash("sha256").update(JSON.stringify(ACCOUNT_SCOPE)).digest("hex");
interface CmsCoreFixture {
  fixture_version: string;
  signing_key_b64url: string;
  operation_scope: { payload: Record<string, JsonValue>; signature: string };
  request_body: { test_kind: string; sample_limit: number; expected_side_effect_mode: string };
}

interface AdminContractFixture {
  canonical_target_policy: typeof CMS_CANONICAL_TARGET_POLICY;
  operations: Record<string, { bootstrap_policy: "allowed" | "permanent_only" }>;
  routes: Array<{
    method: string;
    template: string;
    selector: string;
    operation?: string;
    operations?: string[];
  }>;
}

// Core's REAL fixtures, resolved independently of where this worktree lives —
// see ./helpers/conversions-core-root. Read eagerly ONLY when a Core checkout
// exists; otherwise these stay empty and the whole suite below is skipped, so
// no test ever observes the empty value. Types at the ~10 call sites are
// unchanged.
const CMS_CORE_FIXTURE = (HAS_CONVERSIONS_CORE
  ? JSON.parse(readFileSync(coreUrl("packages/testing/fixtures/cms-core-binding.v1.json"), "utf8"))
  : {}) as CmsCoreFixture;
const ADMIN_CONTRACT_FIXTURE = (HAS_CONVERSIONS_CORE
  ? JSON.parse(readFileSync(coreUrl("packages/contracts/generated/admin-contracts.v1.json"), "utf8"))
  : {}) as AdminContractFixture;
const SIGNING_KEY_B64URL = CMS_CORE_FIXTURE.signing_key_b64url;
const FIXTURE_DIGEST = "32a8e45b65de7251aafd2995c229321faf889edd9525b3d9fcb36f026d1d5538";

function isolatedRecord(fields: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return Object.freeze(Object.assign(Object.create(null), {
    fixtureLabel: "kodigital-isolated-test", fixtureDigest: FIXTURE_DIGEST, ...fields,
  })) as Readonly<Record<string, unknown>>;
}

function identity(): AccessContext {
  return { mode: "identity", email: "operator@example.com", sub: "cf-user-1", claims: {} };
}

function authorityRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    principal_id: ACTOR_ID,
    canonical_email: "operator@example.com",
    access_subject: "cf-user-1",
    is_accountable_owner: 0,
    workspace_id: WORKSPACE_ID,
    role: "administrator",
    capabilities_json: '["conversions.view","connections.manage"]',
    account_scope_json: '[]',
    reporting_currency: "USD",
    time_zone: "UTC",
    accountable_owner_principal_id: OWNER_ID,
    ...overrides,
  };
}

function authorityDb(rows: Record<string, unknown>[] = [authorityRow()]): D1Database {
  return {
    prepare() {
      return {
        bind() { return this; },
        async all<T>() { return { results: rows as T[], success: true, meta: {} }; },
      };
    },
  } as unknown as D1Database;
}

function env(core: Fetcher | undefined, overrides: Partial<Env> = {}): Env {
  return {
    DB: authorityDb(),
    APP_ENV: "test",
    CONVERSIONS_UI_ENABLED: "false",
    CONVERSIONS_PROXY_ENABLED: "true",
    CONVERSIONS_CORE: core,
    CONVERSIONS_ACTOR_AUDIENCE: "kodigital-conversions-core",
    CONVERSIONS_ACTOR_ENVIRONMENT: "test",
    CONVERSIONS_ACTOR_SIGNING_KEY_B64URL: SIGNING_KEY_B64URL,
    ...overrides,
  } as Env;
}

function app(access: AccessContext | undefined): Hono<{ Bindings: Env; Variables: AccessAuthVariables }> {
  const testApp = new Hono<{ Bindings: Env; Variables: AccessAuthVariables }>();
  testApp.use("*", async (c, next) => {
    if (access !== undefined) c.set("access", access);
    await next();
  });
  testApp.route("/", conversionsProxy);
  return testApp;
}

function core(handler: (request: Request) => Response | Promise<Response>): Fetcher {
  return { fetch: handler } as unknown as Fetcher;
}

function mutation(path: string, body: JsonValue, headers: Record<string, string> = {}): Request {
  return new Request(`https://cms.example${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "idem-0001",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

// SKIPPED WHOLE WITHOUT A CONVERSIONS CORE CHECKOUT (Core is a separate repo;
// `.github/workflows/deploy.yml` checks out only this one). Not a partial guard:
// the shared `env()` helper feeds EVERY test the HMAC signing key out of Core's
// own cms-core-binding.v1.json fixture, so with no Core there is no test here
// that still means what it claims. What the skip costs: the CMS<->Core proxy
// boundary proofs — route/operation/bootstrap-policy parity against Core's
// generated admin-contracts.v1.json, Core's EV-037 verifier accepting a
// CMS-signed envelope, and the end-to-end drive against Core's real
// apps/core/src/index.mjs with the shared raw key and exact Connection body.
// Nothing in this repo can substitute; the claim IS agreement with the other
// side. Every assertion is unchanged and runs verbatim whenever Core is present
// (CONVERSIONS_CORE_ROOT=<path to kodigital-conversions>).
describe.skipIf(!HAS_CONVERSIONS_CORE)("Conversions private service proxy", () => {
  it("locks the canonical target, complete 71-route seam and 61-operation authority policy to Core", () => {
    expect(CMS_CANONICAL_TARGET_POLICY).toEqual(ADMIN_CONTRACT_FIXTURE.canonical_target_policy);
    expect(CMS_PROXY_ROUTE_POLICIES).toHaveLength(71);
    expect(new Set(CMS_PROXY_ROUTE_POLICIES.map(({ method, template }) => `${method} ${template}`)).size).toBe(71);
    expect(CMS_PROXY_ROUTE_POLICIES.map(({ method, template, selector, operations }) => ({
      method,
      template,
      selector,
      operations: [...operations],
    }))).toEqual(ADMIN_CONTRACT_FIXTURE.routes.map(({ method, template, selector, operation, operations }) => ({
      method,
      template,
      selector,
      operations: operation === undefined ? operations : [operation],
    })));
    expect(Object.keys(CMS_BOOTSTRAP_POLICY_BY_OPERATION)).toHaveLength(61);
    expect(CMS_BOOTSTRAP_POLICY_BY_OPERATION).toEqual(Object.fromEntries(
      Object.entries(ADMIN_CONTRACT_FIXTURE.operations).map(([operation, policy]) => [operation, policy.bootstrap_policy]),
    ));
    expect(Object.values(CMS_ACTOR_ISSUER_BY_OPERATION).filter((issuer) => issuer === "permanent")).toHaveLength(60);
    expect(Object.values(CMS_ACTOR_ISSUER_BY_OPERATION).filter((issuer) => issuer === "denied")).toHaveLength(1);
    expect(Object.values(CMS_ACTOR_ISSUER_BY_OPERATION)).not.toContain("bootstrap");
  });

  it("keeps the proxy independent of the UI flag and forwards path/query only through the binding", async () => {
    let received: Request | undefined;
    const binding = core((request) => {
      received = request;
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", ETag: '"v1"' } });
    });
    const globalFetch = vi.spyOn(globalThis, "fetch");
    const response = await app(identity()).request(
      "https://cms.example/api/admin/conversions/v1/connections?cursor=a%2Bb",
      { headers: { Accept: "application/json", Authorization: "Bearer forged", Cookie: "CF_Authorization=jwt", Forwarded: "for=evil", "Idempotency-Key": "invalid-on-read", "X-KODigital-Actor-Context": "forged" } },
      env(binding),
    );
    expect(response.status).toBe(200);
    expect(globalFetch).not.toHaveBeenCalled();
    expect(received?.url).toBe("https://cms.example/api/admin/conversions/v1/connections?cursor=a%2Bb");
    expect(received?.headers.get("authorization")).toBeNull();
    expect(received?.headers.get("cookie")).toBeNull();
    expect(received?.headers.get("forwarded")).toBeNull();
    expect(received?.headers.get("idempotency-key")).toBeNull();
    expect(received?.headers.get(ACTOR_CONTEXT_HEADER)).toBeTruthy();
    expect(received?.headers.get(ACTOR_REQUEST_ID_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get("etag")).toBe('"v1"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    globalFetch.mockRestore();
  });

  it("forwards the complete canonical 256-account authority scope without truncation", async () => {
    const accountScope = Array.from({ length: 256 }, (_, index) => ({
      account_id: `a${String(index).padStart(3, "0")}${"x".repeat(124)}`,
      currency: "USD",
    }));
    let actorPayload: Record<string, JsonValue> | undefined;
    const binding = core((request) => {
      actorPayload = JSON.parse(request.headers.get(ACTOR_CONTEXT_HEADER)!).payload as Record<string, JsonValue>;
      return Response.json({ ok: true });
    });
    const response = await app(identity()).request(
      "https://cms.example/api/admin/conversions/v1/connections",
      {},
      env(binding, { DB: authorityDb([authorityRow({ account_scope_json: JSON.stringify(accountScope) })]) }),
    );
    expect(response.status).toBe(200);
    expect(actorPayload?.schema_version).toBe("actor_context.v2");
    expect(actorPayload?.account_scope).toEqual(accountScope);
  });

  it("treats literal-dot, encoded-dot and dot-dot aliases as one canonical signed binding target", async () => {
    const received: Request[] = [];
    const responses: Response[] = [];
    const binding = core((request) => {
      received.push(request.clone());
      return Response.json({ ok: true });
    });
    const canonicalPath = `/api/admin/conversions/v1/connections/${CONNECTION_ID}/test`;
    const query = "?cursor=a%2Bb&cursor=z";
    const aliases = [
      canonicalPath,
      `/api/admin/conversions/v1/connections/${CONNECTION_ID}/./test`,
      `/api/admin/conversions/v1/connections/${CONNECTION_ID}/%2e/test`,
      `/api/admin/conversions/v1/segment/%2e%2e/connections/${CONNECTION_ID}/test`,
      `/api/admin/conversions/v1/segment/%2E%2E/connections/${CONNECTION_ID}/test`,
      `/api/admin/conversions/v1/connections/${CONNECTION_ID}\\test`,
    ];
    const body = JSON.stringify({
      test_kind: "connectivity_probe",
      sample_limit: 1,
      expected_side_effect_mode: "none",
    });

    for (const alias of aliases) {
      expect(new URL(`https://cms.example${alias}${query}`).pathname).toBe(canonicalPath);
      responses.push(await app(identity()).request(new Request(`https://cms.example${alias}${query}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Idempotency-Key": "idem-alias-equivalence",
          "If-Match": '"v7"',
          Authorization: "Bearer forged",
          Cookie: "CF_Authorization=forged",
          [ACTOR_CONTEXT_HEADER]: "forged",
          [ACTOR_OPERATION_SCOPE_HEADER]: "forged",
          [ACTOR_REQUEST_ID_HEADER]: "forged",
        },
        body,
      }), undefined, env(binding)));
    }

    expect(responses.map(({ status }) => status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(received).toHaveLength(aliases.length);
    const stableSnapshots = [];
    for (let index = 0; index < received.length; index += 1) {
      const request = received[index]!;
      const actor = JSON.parse(request.headers.get(ACTOR_CONTEXT_HEADER)!);
      const scope = JSON.parse(request.headers.get(ACTOR_OPERATION_SCOPE_HEADER)!);
      const requestId = request.headers.get(ACTOR_REQUEST_ID_HEADER);
      expect(request.url).toBe(`https://cms.example${canonicalPath}${query}`);
      expect(request.method).toBe("POST");
      expect(await request.text()).toBe(body);
      expect(requestId).toBe(actor.payload.request_id);
      expect(requestId).toBe(scope.payload.request_id);
      expect(responses[index]!.headers.get(ACTOR_REQUEST_ID_HEADER)).toBe(requestId);
      expect(scope.payload).toMatchObject({
        route: canonicalPath,
        method: "POST",
        connection_id: CONNECTION_ID,
        test_kind: "connectivity_probe",
        expected_side_effect_mode: "none",
        destination_class: "none",
      });
      expect(request.headers.get("authorization")).toBeNull();
      expect(request.headers.get("cookie")).toBeNull();
      const { request_id: ignoredActorRequestId, issued_at: ignoredIssuedAt, expires_at: ignoredExpiresAt, ...actorPayload } = actor.payload;
      const { request_id: ignoredScopeRequestId, ...scopePayload } = scope.payload;
      stableSnapshots.push({
        actorPayload,
        scopePayload,
        headers: Object.fromEntries([...request.headers].filter(([name]) => ![
          ACTOR_CONTEXT_HEADER.toLowerCase(),
          ACTOR_OPERATION_SCOPE_HEADER.toLowerCase(),
          ACTOR_REQUEST_ID_HEADER.toLowerCase(),
        ].includes(name))),
      });
      void ignoredActorRequestId;
      void ignoredIssuedAt;
      void ignoredExpiresAt;
      void ignoredScopeRequestId;
    }
    for (const snapshot of stableSnapshots.slice(1)) expect(snapshot).toEqual(stableSnapshots[0]);
  });

  it("rejects retained target ambiguity and applies permanent authority after dot-dot normalization", async () => {
    let calls = 0;
    const binding = core(() => {
      calls += 1;
      return Response.json({ unexpected: true });
    });
    const retainedAmbiguity = [
      "/api/admin/conversions/v1//connections",
      "/api/admin/conversions/v1/connections/%252e/test",
      "/api/admin/conversions/v1/connections/%2Ftest",
      "/api/admin/conversions/v1/connections/%5Ctest",
      "/api/admin/conversions/v1/connections//test",
    ];
    for (const pathname of retainedAmbiguity) {
      expect((await app(identity()).request(`https://cms.example${pathname}`, {}, env(binding))).status).toBe(400);
    }
    const flowRun = `/api/admin/conversions/v1/flows/${CONNECTION_ID}/run`;
    for (const pathname of [
      `/api/admin/conversions/v1/connections/../flows/${CONNECTION_ID}/run`,
      `/api/admin/conversions/v1/connections/%2e%2e/flows/${CONNECTION_ID}/run`,
      `/api/admin/conversions/v1/connections/%2E%2E/flows/${CONNECTION_ID}/run`,
    ]) {
      expect(new URL(`https://cms.example${pathname}`).pathname).toBe(flowRun);
      expect((await app(identity()).request(mutation(pathname, { reason: "manual" }), undefined, env(binding))).status).toBe(200);
    }
    expect(calls).toBe(3);
  });

  it("fails closed for disabled flags, bypass/service-token identity, missing binding, config and allowlist", async () => {
    const binding = core(() => new Response("unexpected"));
    expect((await app(identity()).request("https://cms.example/api/admin/conversions/v1/connections", {}, env(binding, { CONVERSIONS_PROXY_ENABLED: "1" }))).status).toBe(404);
    expect((await app(undefined).request("https://cms.example/api/admin/conversions/v1/connections", {}, env(binding))).status).toBe(403);
    expect((await app({ mode: "service-token", commonName: "svc", claims: {} }).request("https://cms.example/api/admin/conversions/v1/connections", {}, env(binding))).status).toBe(403);
    expect((await app(identity()).request("https://cms.example/api/admin/conversions/v1/connections", {}, env(undefined))).status).toBe(503);
    expect((await app(identity()).request("https://cms.example/api/admin/conversions/v1/connections", {}, env(binding, { CONVERSIONS_ACTOR_SIGNING_KEY_B64URL: undefined }))).status).toBe(503);
    expect((await app(identity()).request("https://cms.example/api/admin/conversions/v1/connections", {}, env(binding, { DB: authorityDb([]) }))).status).toBe(403);
  });

  it("ignores forged actor identity/scope inputs and preserves mutation body bytes", async () => {
    let received: Request | undefined;
    const binding = core((request) => { received = request; return new Response(null, { status: 204 }); });
    const body = JSON.stringify({ name: "safe", email: "attacker@example.com" });
    const response = await app(identity()).request("https://cms.example/api/admin/conversions/v1/connections", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "idem-create",
        "X-Actor-Email": "attacker@example.com",
        [ACTOR_CONTEXT_HEADER]: "forged",
        [ACTOR_OPERATION_SCOPE_HEADER]: "forged",
      },
      body,
    }, env(binding));
    expect(response.status).toBe(204);
    const envelope = JSON.parse(received!.headers.get(ACTOR_CONTEXT_HEADER)!);
    expect(envelope.payload.actor_email).toBe("operator@example.com");
    expect(received!.headers.get(ACTOR_OPERATION_SCOPE_HEADER)).toBeNull();
    expect(await received!.text()).toBe(body);
  });

  it("requires idempotency, strict JSON, bounded bodies, supported methods/routes and unambiguous paths", async () => {
    const binding = core(() => new Response("unexpected"));
    const testApp = app(identity());
    const base = "https://cms.example/api/admin/conversions/v1";
    expect((await testApp.request(`${base}/connections`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, env(binding))).status).toBe(428);
    expect((await testApp.request(`${base}/connections`, { method: "POST", headers: { "Content-Type": "text/plain", "Idempotency-Key": "idem-0001" }, body: "{}" }, env(binding))).status).toBe(415);
    expect((await testApp.request(`${base}/connections`, { method: "PUT" }, env(binding))).status).toBe(400);
    expect((await testApp.request(`${base}/not-a-route`, {}, env(binding))).status).toBe(400);
    expect((await testApp.request(`${base}//connections`, {}, env(binding))).status).toBe(400);
    expect((await testApp.request(`${base}/connections/%252e%252e/test`, {}, env(binding))).status).toBe(400);
    expect((await testApp.request(`${base}/connections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "idem-0001" },
      body: JSON.stringify({ value: "x".repeat(1_048_576) }),
    }, env(binding))).status).toBe(413);
  });

  it("accepts canonical UUIDv5 Activity identities and the complete signed replay token", async () => {
    const received: Request[] = [];
    const binding = core((request) => {
      received.push(request.clone());
      return Response.json({ ok: true });
    });
    const testApp = app(identity());
    const base = "https://cms.example/api/admin/conversions/v1";
    expect((await testApp.request(
      `${base}/events/${EVENT_ID_V5}/history`, {}, env(binding),
    )).status).toBe(200);
    expect((await testApp.request(
      `${base}/deliveries/${DELIVERY_ID_V5}`, {}, env(binding),
    )).status).toBe(200);
    const selection = {
      mode: "reporting_only",
      destination_scope: [],
      filter: { kind: "event_ids", ids: [EVENT_ID_V5] },
      date_bound: { start: "2026-07-01", end: "2026-07-30" },
    };
    expect((await testApp.request(mutation(
      "/api/admin/conversions/v1/replays/preview", selection,
    ), undefined, env(binding))).status).toBe(200);
    expect((await testApp.request(mutation(
      "/api/admin/conversions/v1/replays",
      {
        ...selection,
        preview_token: `1789000300.${"a".repeat(64)}.${"A".repeat(43)}`,
        reason: "manual_replay",
        typed_count_confirmation: 1,
      },
    ), undefined, env(binding))).status).toBe(200);
    expect(received).toHaveLength(4);
  });

  it("derives a signed side-effect-free Connection-test scope and refuses client-selected external modes", async () => {
    let received: Request | undefined;
    const binding = core((request) => { received = request; return Response.json({ ok: true }); });
    const path = `/api/admin/conversions/v1/connections/${CONNECTION_ID}/test`;
    expect((await app(identity()).request(mutation(path, {
      test_kind: "connectivity_probe",
      sample_limit: 1,
      expected_side_effect_mode: "none",
    }), undefined, env(binding))).status).toBe(200);
    const scope = JSON.parse(received!.headers.get(ACTOR_OPERATION_SCOPE_HEADER)!);
    const envelope = JSON.parse(received!.headers.get(ACTOR_CONTEXT_HEADER)!);
    expect(envelope.payload).toMatchObject({ issuer: "kodigital_cms_authority", bootstrap: false });
    expect(scope.payload).toMatchObject({
      actor_id: ACTOR_ID,
      workspace_id: WORKSPACE_ID,
      request_id: envelope.payload.request_id,
      route: path,
      method: "POST",
      connection_id: CONNECTION_ID,
      test_kind: "connectivity_probe",
      expected_side_effect_mode: "none",
      destination_class: "none",
    });
    const runtime = await importCore("packages/security/actor-envelope.mjs");
    const authority = await importCore("packages/security/protected-port-authority.mjs");
    await expect(runtime.verifyActorEnvelope(envelope,
      authority.createIsolatedActorVerifierCapability(isolatedRecord({
      expectedIssuer: "kodigital_cms_authority",
      expectedAudience: "kodigital-conversions-core",
      expectedEnvironment: "test",
      requiredSchemaVersion: "actor_context.v2",
      operationId: "connections.test.side_effect_free",
      operationScope: scope,
      nowSeconds: envelope.payload.issued_at,
      clockSkewSeconds: 0,
      replayOutcome: "accept",
    })))).resolves.toMatchObject({ request_id: envelope.payload.request_id });
    expect((await app(identity()).request(mutation(path, {
      test_kind: "connectivity_probe",
      sample_limit: 1,
      expected_side_effect_mode: "sandbox",
    }), undefined, env(binding))).status).toBe(200);
    expect((await app(identity()).request(mutation(path, {
      test_kind: "connectivity_probe",
      sample_limit: 1,
      expected_side_effect_mode: "none",
      destination_class: "none",
    }), undefined, env(binding))).status).toBe(400);
    expect((await app(identity()).request(mutation(path, {
      test_kind: "connectivity_probe",
      sample_limit: 1_001,
      expected_side_effect_mode: "none",
    }), undefined, env(binding))).status).toBe(400);
  });

  it("derives exact schedule and recipient scopes while Core retains release-state enforcement", async () => {
    const scopes: unknown[] = [];
    const binding = core((request) => {
      scopes.push(JSON.parse(request.headers.get(ACTOR_OPERATION_SCOPE_HEADER)!));
      return Response.json({ ok: true });
    });
    const createPath = `/api/admin/conversions/v1/reports/${REPORT_ID}/schedules`;
    expect((await app(identity()).request(mutation(createPath, { enabled: false, recipient_ids: [RECIPIENT_ID] }), undefined, env(binding))).status).toBe(200);
    expect(scopes[0]).toMatchObject({ payload: { mutation: "schedule_create", enabled_transition: "created_disabled", delivery_class: "none", recipient_scope: [RECIPIENT_ID] } });
    expect((await app(identity()).request(mutation(createPath, { enabled: true, recipient_ids: [RECIPIENT_ID] }), undefined, env(binding))).status).toBe(200);
    expect(scopes[1]).toMatchObject({ payload: { mutation: "schedule_create", enabled_transition: "created_enabled", delivery_class: "scheduled_email", recipient_scope: [RECIPIENT_ID] } });
    const schedulePath = `/api/admin/conversions/v1/reports/${REPORT_ID}/schedules/0198f0aa-0000-7000-8000-000000000006`;
    const patchRequest = new Request(`https://cms.example${schedulePath}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "idem-patch" },
      body: JSON.stringify({ previous_enabled: false, enabled: false, recipient_ids: [RECIPIENT_ID] }),
    });
    expect((await app(identity()).request(patchRequest, undefined, env(binding))).status).toBe(200);
    expect(scopes[2]).toMatchObject({ payload: { mutation: "schedule_update", enabled_transition: "disabled_unchanged", recipient_scope: [RECIPIENT_ID] } });
    const archivePath = `/api/admin/conversions/v1/report-recipients/${RECIPIENT_ID}/archive`;
    expect((await app(identity()).request(mutation(archivePath, { row_version: 1 }), undefined, env(binding))).status).toBe(200);
    expect(scopes[3]).toMatchObject({ payload: { mutation: "recipient_archive", recipient_scope: [RECIPIENT_ID] } });
    expect((await app(identity()).request(mutation("/api/admin/conversions/v1/report-recipients", { recipient_id: RECIPIENT_ID }), undefined, env(binding))).status).toBe(200);
    expect(scopes[4]).toMatchObject({ payload: { mutation: "recipient_create", delivery_class: "verification_email", recipient_scope: [RECIPIENT_ID] } });
  });

  it("allows the recipient read route while keeping recipient creation permanent-only", async () => {
    let calls = 0;
    const binding = core(() => { calls += 1; return Response.json({ items: [] }); });
    const response = await app(identity()).request("https://cms.example/api/admin/conversions/v1/report-recipients", {}, env(binding));
    expect(response.status).toBe(200);
    expect(calls).toBe(1);
  });

  it("uses permanent CMS authority for every reachable operation and denies only production-external testing", async () => {
    let calls = 0;
    const allowedRequests: Request[] = [];
    const binding = core((request) => {
      calls += 1;
      allowedRequests.push(request.clone());
      return Response.json({ ok: true });
    });
    const scheduleId = "0198f0aa-0000-7000-8000-000000000006";
    const externalResponse = await app(identity()).request(mutation(
      `/api/admin/conversions/v1/connections/${CONNECTION_ID}/test`,
      { test_kind: "connectivity_probe", sample_limit: 1, expected_side_effect_mode: "production_external" },
    ), undefined, env(binding));
    expect(externalResponse.status).toBe(403);
    expect(calls).toBe(0);

    const permanentCases: Array<{ path: string; method?: "POST" | "PATCH"; body: JsonValue }> = [
      { path: `/api/admin/conversions/v1/connections/${CONNECTION_ID}/test`, body: { test_kind: "connectivity_probe", sample_limit: 1, expected_side_effect_mode: "sandbox" } },
      { path: `/api/admin/conversions/v1/flows/${CONNECTION_ID}/drafts/1/publish`, body: {} },
      { path: `/api/admin/conversions/v1/flows/${CONNECTION_ID}/resume`, body: {} },
      { path: `/api/admin/conversions/v1/flows/${CONNECTION_ID}/rollback`, body: {} },
      { path: `/api/admin/conversions/v1/flows/${CONNECTION_ID}/run`, body: {} },
      { path: `/api/admin/conversions/v1/deliveries/${CONNECTION_ID}/cancel`, body: {} },
      { path: "/api/admin/conversions/v1/replays/preview", body: { mode: "external_generation", destination_scope: [] } },
      { path: "/api/admin/conversions/v1/replays", body: { mode: "external_generation", destination_scope: [] } },
      { path: `/api/admin/conversions/v1/ownership/${CONNECTION_ID}/release`, body: {} },
      { path: `/api/admin/conversions/v1/reports/${REPORT_ID}/schedules`, body: { enabled: true, recipient_ids: [RECIPIENT_ID] } },
      { path: `/api/admin/conversions/v1/reports/${REPORT_ID}/schedules/${scheduleId}`, method: "PATCH", body: { previous_enabled: false, enabled: true, recipient_ids: [RECIPIENT_ID] } },
      { path: "/api/admin/conversions/v1/report-recipients", body: { recipient_id: RECIPIENT_ID } },
      { path: `/api/admin/conversions/v1/report-recipients/${RECIPIENT_ID}/verify`, body: { verification_code: "code" } },
      { path: "/api/admin/conversions/v1/controls/global_emergency_stop", method: "PATCH", body: { value: false, row_version: 1, reason: "manual" } },
      { path: "/api/admin/conversions/v1/controls/dashboard_conversion_revenue", method: "PATCH", body: { value: true, row_version: 1, reason: "manual" } },
    ];
    for (const testCase of permanentCases) {
      const response = await app(identity()).request(new Request(`https://cms.example${testCase.path}`, {
        method: testCase.method ?? "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "idem-permanent-only" },
        body: JSON.stringify(testCase.body),
      }), undefined, env(binding));
      expect(response.status, `${testCase.method ?? "POST"} ${testCase.path}`).toBe(200);
    }
    expect(calls).toBe(permanentCases.length);
    for (const request of allowedRequests) {
      const payload = JSON.parse(request.headers.get(ACTOR_CONTEXT_HEADER)!).payload;
      expect(payload).toMatchObject({
        schema_version: "actor_context.v2",
        issuer: "kodigital_cms_authority",
        role: "administrator",
        account_scope: [],
        reporting_currency: "USD",
        bootstrap: false,
      });
    }

    const disableBody = JSON.stringify({ value: false, row_version: 2, reason: "incident" });
    const disableResponse = await app(identity()).request(new Request(
      "https://cms.example/api/admin/conversions/v1/controls/dashboard_conversion_revenue?source=admin",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "idem-dashboard-disable" },
        body: disableBody,
      },
    ), undefined, env(binding));
    expect(disableResponse.status).toBe(200);
    expect(calls).toBe(permanentCases.length + 1);
    const disableRequest = allowedRequests.at(-1)!;
    expect(disableRequest.url).toBe("https://cms.example/api/admin/conversions/v1/controls/dashboard_conversion_revenue?source=admin");
    expect(disableRequest.headers.get(ACTOR_OPERATION_SCOPE_HEADER)).toBeNull();
    expect(await disableRequest.text()).toBe(disableBody);
  });

  it("forwards the five released local route bodies byte-exact under permanent actor v2", async () => {
    const received: Request[] = [];
    const binding = core((request) => {
      received.push(request.clone());
      return Response.json({ local: true });
    });
    const cases: Array<{ path: string; operation: string; body: Record<string, JsonValue> }> = [
      {
        path: "/api/admin/conversions/v1/ownership/claim-preview",
        operation: "ownership.claim.preview",
        body: {
          product_type: "leadgen",
          offer_scope: { type: "offer", value: "offer-1" },
          output_channel: "reporting",
          destination_platform: "meta",
          destination_account: "account-1",
          effective_from: "2026-07-21T00:00:00.000Z",
          owner_flow_id: CONNECTION_ID,
          owner_flow_version_id: REPORT_ID,
          reason: "manual",
        },
      },
      {
        path: `/api/admin/conversions/v1/ownership/${CONNECTION_ID}/activate`,
        operation: "ownership.activate",
        body: { preview_token: "preview-token", reason: "manual" },
      },
      {
        path: `/api/admin/conversions/v1/ownership/${CONNECTION_ID}/correct-preview`,
        operation: "ownership.correct.preview",
        body: {
          owner_flow_id: CONNECTION_ID,
          owner_flow_version_id: REPORT_ID,
          effective_from: "2026-07-21T00:00:00.000Z",
          effective_to: "2026-08-21T00:00:00.000Z",
          reason: "manual",
        },
      },
      {
        path: `/api/admin/conversions/v1/ownership/${CONNECTION_ID}/correct`,
        operation: "ownership.correct",
        body: { preview_token: "preview-token", reason: "manual" },
      },
      {
        path: "/api/admin/conversions/v1/migration/activate",
        operation: "migration.activate",
        body: { migration_id: "migration_001", expected_manifest_sha256: "a".repeat(64), reason: "manual" },
      },
    ];

    for (const testCase of cases) {
      const response = await app(identity()).request(mutation(testCase.path, testCase.body), undefined, env(binding));
      expect(response.status, testCase.path).toBe(200);
    }
    expect(received).toHaveLength(cases.length);
    for (let index = 0; index < cases.length; index += 1) {
      const expected = cases[index]!;
      const request = received[index]!;
      expect(request.url).toBe(`https://cms.example${expected.path}`);
      expect(await request.text()).toBe(JSON.stringify(expected.body));
      expect(JSON.parse(request.headers.get(ACTOR_CONTEXT_HEADER)!).payload).toMatchObject({
        schema_version: "actor_context.v2",
        issuer: "kodigital_cms_authority",
        role: "administrator",
        capabilities: ["conversions.view", "connections.manage"],
        account_scope: [],
        reporting_currency: "USD",
        bootstrap: false,
      });
      const route = CMS_PROXY_ROUTE_POLICIES.find(({ method, template }) => method === "POST" && template === expected.path.replace(CONNECTION_ID, ":claim_id"));
      expect(route?.operations).toEqual([expected.operation]);
    }
  });

  it("never follows redirects and strips response cookies, location, auth and internal headers", async () => {
    const binding = core(() => new Response(null, {
      status: 302,
      headers: {
        Location: "https://attacker.example",
        "Set-Cookie": "secret=value",
        Authorization: "secret",
        "X-Internal-Secret": "secret",
        ETag: '"safe"',
      },
    }));
    const response = await app(identity()).request("https://cms.example/api/admin/conversions/v1/connections", {}, env(binding));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("authorization")).toBeNull();
    expect(response.headers.get("x-internal-secret")).toBeNull();
    expect(response.headers.get("etag")).toBe('"safe"');
  });

  it("streams an authorized export download byte-exact with only safe attachment headers", async () => {
    const bytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]);
    const binding = core(() => new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="kodigital-report-${CONNECTION_ID}.xlsx"`,
        ETag: '"export-v1"',
        "Set-Cookie": "secret=value",
        Location: "https://attacker.example",
      },
    }));
    const response = await app(identity()).request(
      `https://cms.example/api/admin/conversions/v1/exports/${CONNECTION_ID}/download`,
      {},
      env(binding),
    );
    expect(response.status).toBe(200);
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(Array.from(bytes));
    expect(response.headers.get("content-type"))
      .toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(response.headers.get("content-disposition"))
      .toBe(`attachment; filename="kodigital-report-${CONNECTION_ID}.xlsx"`);
    expect(response.headers.get("etag")).toBe('"export-v1"');
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
  });

  it("captures the original service binding across the asynchronous signing boundary", async () => {
    let firstCalls = 0;
    let secondCalls = 0;
    const first = core(() => { firstCalls += 1; return Response.json({ source: "first" }); });
    const second = core(() => { secondCalls += 1; return Response.json({ source: "second" }); });
    const bindings = env(first);
    const pending = app(identity()).request("https://cms.example/api/admin/conversions/v1/connections", {}, bindings);
    bindings.CONVERSIONS_CORE = second;
    expect((await pending).status).toBe(200);
    expect(firstCalls).toBe(1);
    expect(secondCalls).toBe(0);
  });

  it("passes the actual Core binding boundary with the shared raw key, exact Connection body and schedule precondition", async () => {
    // Test-only sibling import: CMS production code remains repository- and
    // runtime-independent and calls only the configured Fetcher binding.
    const runtimeCore = await importCore("apps/core/src/index.mjs");
    const replayDb = {
      prepare: (sql: string) => ({
        bind() { return this; },
        async run() { return { success: true, results: [], meta: { changes: 1 } }; },
        async all() {
          return sql.includes("report_account_bindings")
            ? { success: true, results: [...ACCOUNT_SCOPE], meta: { changes: 0 } }
            : { success: true, results: [], meta: { changes: 0 } };
        },
        async first() {
          if (sql.includes("SELECT c.*") && sql.includes("FROM connections c")) {
            return {
              account_id: "account-1", currency: "USD",
              archived_at: null, adapter_type: "meta",
            };
          }
          if (sql.includes("connection_account_bindings")) {
            return { account_id: "account-1", currency: "USD" };
          }
          if (sql.includes("FROM connections")) {
            return { archived_at: null, adapter_type: "meta" };
          }
          if (/SELECT\s+account_scope_sha256\s+FROM report_definitions/.test(sql)) {
            return { account_scope_sha256: ACCOUNT_SCOPE_SHA256 };
          }
          if (sql.includes("FROM report_schedules s")) {
            throw new Error("UNMODELED_D1_SCHEDULE");
          }
          return null;
        },
      }),
      batch: async () => [{ meta: { changes: 1 } }, { meta: { changes: 1 } }],
    };
    const capturedConnectionRequests: Request[] = [];
    const binding = core((request) => {
      const isConnectionTest = request.url.includes("/connections/");
      if (isConnectionTest) capturedConnectionRequests.push(request.clone());
      const issuedActor = JSON.parse(request.headers.get(ACTOR_CONTEXT_HEADER)!);
      expect(issuedActor.payload).toMatchObject({
        schema_version: "actor_context.v2",
        issuer: "kodigital_cms_authority",
        role: "administrator",
        account_scope: ACCOUNT_SCOPE,
        reporting_currency: "USD",
        bootstrap: false,
      });
      return runtimeCore.fetch(request, {
        ACTOR_CONTEXT_HMAC_KEY_B64URL: SIGNING_KEY_B64URL,
        ACTOR_CONTEXT_ISSUER: "kodigital_cms_authority",
        ACTOR_CONTEXT_AUDIENCE: "kodigital-conversions-core",
        CORE_ENVIRONMENT: "test",
        CORE_RELEASE_STATE_V1_JSON: JSON.stringify({
          schema_version: "core_release_state.v1",
          environment: "test",
          production_permissions: [],
          local_test_permissions: [],
        }),
        CORE_D1: replayDb,
        CONNECTION_TEST_PORT: Object.freeze({}),
        CMS_PROVIDER_AUTHORITY_PORT: Object.freeze({}),
        CREDENTIAL_RESOLVER_PORT: Object.freeze({}),
      });
    });
    const integrationEnv = env(binding, {
      DB: authorityDb([authorityRow({
        capabilities_json: '["conversions.view","connections.manage","reporting.schedule"]',
        account_scope_json: JSON.stringify(ACCOUNT_SCOPE),
      })]),
    });

    expect(CMS_CORE_FIXTURE.fixture_version).toBe("cms_core_binding.v1");
    const connectionPath = String(CMS_CORE_FIXTURE.operation_scope.payload.route);
    const connectionResponse = await app(identity()).request(mutation(
      connectionPath,
      CMS_CORE_FIXTURE.request_body,
    ), undefined, integrationEnv);
    expect(connectionResponse.status).toBe(503);
    await expect(connectionResponse.json()).resolves.toMatchObject({ error: { code: "dependency_unavailable" } });
    await expect(capturedConnectionRequests[0]!.json()).resolves.toEqual(CMS_CORE_FIXTURE.request_body);
    const generatedScope = JSON.parse(capturedConnectionRequests[0]!.headers.get(ACTOR_OPERATION_SCOPE_HEADER)!);
    expect(generatedScope.payload).toMatchObject({
      ...CMS_CORE_FIXTURE.operation_scope.payload,
      request_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });

    const sandboxBody = {
      ...CMS_CORE_FIXTURE.request_body,
      expected_side_effect_mode: "sandbox",
    };
    const sandboxResponse = await app(identity()).request(mutation(
      connectionPath,
      sandboxBody,
    ), undefined, integrationEnv);
    expect(sandboxResponse.status).toBe(403);
    await expect(sandboxResponse.json()).resolves.toMatchObject({ error: { code: "forbidden" } });
    await expect(capturedConnectionRequests[1]!.json()).resolves.toEqual(sandboxBody);
    expect(JSON.parse(capturedConnectionRequests[1]!.headers.get(ACTOR_CONTEXT_HEADER)!).payload)
      .toMatchObject({ issuer: "kodigital_cms_authority", bootstrap: false });
    expect(JSON.parse(capturedConnectionRequests[1]!.headers.get(ACTOR_OPERATION_SCOPE_HEADER)!).payload)
      .toMatchObject({ expected_side_effect_mode: "sandbox", destination_class: "sandbox" });

    const schedulePath = `/api/admin/conversions/v1/reports/${REPORT_ID}/schedules/0198f0aa-0000-7000-8000-000000000006`;
    const scheduleResponse = await app(identity()).request(new Request(`https://cms.example${schedulePath}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "idem-core-schedule" },
      body: JSON.stringify({ previous_enabled: false, enabled: false, recipient_ids: [RECIPIENT_ID] }),
    }), undefined, integrationEnv);
    const schedulePayload = await scheduleResponse.json();
    expect(schedulePayload).toMatchObject({ error: { code: "dependency_unavailable" } });
    expect(scheduleResponse.status).toBe(503);

    const outOfScopeBinding = core((request) => runtimeCore.fetch(request, {
      ACTOR_CONTEXT_HMAC_KEY_B64URL: SIGNING_KEY_B64URL,
      ACTOR_CONTEXT_ISSUER: "kodigital_cms_authority",
      ACTOR_CONTEXT_AUDIENCE: "kodigital-conversions-core",
      CORE_ENVIRONMENT: "test",
      CORE_RELEASE_STATE_V1_JSON: JSON.stringify({
        schema_version: "core_release_state.v1",
        environment: "test",
        production_permissions: [],
        local_test_permissions: [],
      }),
      CORE_D1: replayDb,
    }));
    const outOfScopeEnv = env(outOfScopeBinding, {
      DB: authorityDb([authorityRow({
        capabilities_json: '["conversions.view","connections.manage","reporting.schedule"]',
        account_scope_json: "[]",
      })]),
    });
    const outOfScopeResponse = await app(identity()).request(new Request(`https://cms.example${schedulePath}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "idem-core-schedule-out-of-scope" },
      body: JSON.stringify({ previous_enabled: false, enabled: false, recipient_ids: [RECIPIENT_ID] }),
    }), undefined, outOfScopeEnv);
    expect(outOfScopeResponse.status).toBe(403);
    await expect(outOfScopeResponse.json()).resolves.toMatchObject({ error: { code: "forbidden" } });
  });
});
