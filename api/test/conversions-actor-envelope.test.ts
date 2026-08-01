import { describe, expect, it } from "vitest";
import { HAS_CONVERSIONS_CORE, importCore } from "./helpers/conversions-core-root";
import type { AccessContext } from "../src/auth/access-auth";
import type { Env } from "../src/env";
import {
  BOOTSTRAP_CAPABILITIES,
  CF_ACCESS_BOOTSTRAP_ISSUER,
  ActorIssuanceError,
  createUuidV7,
  getBootstrapWarning,
  issueBootstrapActorContext,
  resolveBootstrapConfig,
} from "../src/admin/conversions/actor-envelope";

const ACTOR_ID = "0198f0aa-0000-7000-8000-000000000001";
const WORKSPACE_ID = "0198f0aa-0000-7000-8000-000000000002";
const NOW_SECONDS = 1_789_000_000;
const SIGNING_KEY_B64URL = "MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE";
const FIXTURE_DIGEST = "32a8e45b65de7251aafd2995c229321faf889edd9525b3d9fcb36f026d1d5538";

function isolatedRecord(fields: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return Object.freeze(Object.assign(Object.create(null), {
    fixtureLabel: "kodigital-isolated-test", fixtureDigest: FIXTURE_DIGEST, ...fields,
  })) as Readonly<Record<string, unknown>>;
}

function env(overrides: Partial<Env> = {}): Env {
  return {
    APP_ENV: "test",
    CONVERSIONS_PROXY_ENABLED: "true",
    CONVERSIONS_ADMIN_EMAILS: "operator@example.com",
    CONVERSIONS_ACTOR_ID_BY_EMAIL: JSON.stringify({ "operator@example.com": ACTOR_ID }),
    DEFAULT_WORKSPACE_ID: WORKSPACE_ID,
    CONVERSIONS_ACTOR_AUDIENCE: "kodigital-conversions-core",
    CONVERSIONS_ACTOR_ENVIRONMENT: "test",
    CONVERSIONS_BOOTSTRAP_EXPIRES_AT: new Date((NOW_SECONDS + 3_600) * 1_000).toISOString(),
    CONVERSIONS_ACTOR_SIGNING_KEY_B64URL: SIGNING_KEY_B64URL,
    ...overrides,
  } as Env;
}

function identity(email = "operator@example.com"): AccessContext {
  return { mode: "identity", email, sub: "cf-user-1", claims: {} };
}

describe("Conversions bootstrap actor context", () => {
  it("issues the frozen canonical bootstrap capabilities and a cryptographic UUIDv7 for at most 60 seconds", async () => {
    const issued = await issueBootstrapActorContext(env(), identity(), NOW_SECONDS * 1_000);
    expect(issued.envelope.payload).toMatchObject({
      issuer: CF_ACCESS_BOOTSTRAP_ISSUER,
      actor_id: ACTOR_ID,
      actor_email: "operator@example.com",
      workspace_id: WORKSPACE_ID,
      bootstrap: true,
      issued_at: NOW_SECONDS,
      expires_at: NOW_SECONDS + 60,
    });
    expect(issued.envelope.payload.capabilities).toEqual(BOOTSTRAP_CAPABILITIES);
    expect(issued.envelope.payload.capabilities).not.toContain("conversions.external_redelivery");
    expect(issued.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(issued.envelope.signature).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("clips lifetime at the fixed bootstrap expiry and rejects expired issuance", async () => {
    const clipped = await issueBootstrapActorContext(env({
      CONVERSIONS_BOOTSTRAP_EXPIRES_AT: new Date((NOW_SECONDS + 15) * 1_000).toISOString(),
    }), identity(), NOW_SECONDS * 1_000);
    expect(clipped.envelope.payload.expires_at).toBe(NOW_SECONDS + 15);
    await expect(issueBootstrapActorContext(env({
      CONVERSIONS_BOOTSTRAP_EXPIRES_AT: new Date(NOW_SECONDS * 1_000).toISOString(),
    }), identity(), NOW_SECONDS * 1_000)).rejects.toBeInstanceOf(ActorIssuanceError);
  });

  it("never mints for service-token, bypass/absent context, or an unlisted identity and normalizes only verified email", async () => {
    const service: AccessContext = { mode: "service-token", commonName: "automation", claims: {} };
    await expect(issueBootstrapActorContext(env(), service, NOW_SECONDS * 1_000)).rejects.toBeInstanceOf(ActorIssuanceError);
    await expect(issueBootstrapActorContext(env(), undefined, NOW_SECONDS * 1_000)).rejects.toBeInstanceOf(ActorIssuanceError);
    expect((await issueBootstrapActorContext(env(), identity("Operator@example.com"), NOW_SECONDS * 1_000)).envelope.payload.actor_email).toBe("operator@example.com");
    await expect(issueBootstrapActorContext(env(), identity("other@example.com"), NOW_SECONDS * 1_000)).rejects.toBeInstanceOf(ActorIssuanceError);
  });

  it("fails closed on malformed/ambiguous allowlists, actor maps, UUIDs, key, environment and expiry", () => {
    const invalid: Partial<Env>[] = [
      { CONVERSIONS_ADMIN_EMAILS: "operator@example.com,operator@example.com" },
      { CONVERSIONS_ADMIN_EMAILS: " Operator@example.com" },
      { CONVERSIONS_ACTOR_ID_BY_EMAIL: JSON.stringify({ "operator@example.com": ACTOR_ID, "extra@example.com": ACTOR_ID }) },
      { CONVERSIONS_ADMIN_EMAILS: "operator@example.com,second@example.com", CONVERSIONS_ACTOR_ID_BY_EMAIL: JSON.stringify({ "operator@example.com": ACTOR_ID, "second@example.com": ACTOR_ID }) },
      { DEFAULT_WORKSPACE_ID: "0198f0aa-0000-6000-8000-000000000002" },
      { CONVERSIONS_ACTOR_SIGNING_KEY_B64URL: "too-short" },
      { CONVERSIONS_ACTOR_ENVIRONMENT: "production" },
      { CONVERSIONS_BOOTSTRAP_EXPIRES_AT: "not-a-date" },
      { CONVERSIONS_BOOTSTRAP_EXPIRES_AT: "2099-01-01" },
      { CONVERSIONS_PROXY_ENABLED: "1" },
      { CONVERSIONS_PROXY_ENABLED: "TRUE" },
    ];
    for (const overrides of invalid) expect(resolveBootstrapConfig(env(overrides)).ok).toBe(false);
  });

  it("produces deterministic UUIDv7 layout under fixed entropy", () => {
    expect(createUuidV7(0x0198f0aa0000, new Uint8Array(16))).toBe("0198f0aa-0000-7000-8000-000000000000");
  });

  it("renders production warning severity only while a complete issuance configuration is active", () => {
    const production = env({
      APP_ENV: "production",
      CONVERSIONS_ACTOR_ENVIRONMENT: "production",
      CONVERSIONS_BOOTSTRAP_EXPIRES_AT: new Date((NOW_SECONDS + 13 * 86_400) * 1_000).toISOString(),
    });
    expect(getBootstrapWarning(production, NOW_SECONDS)).toBe("critical");
    expect(getBootstrapWarning(env(), NOW_SECONDS)).toBeUndefined();
    expect(getBootstrapWarning(production, NOW_SECONDS + 14 * 86_400)).toBeUndefined();
  });

  // SKIPPED WITHOUT A CONVERSIONS CORE CHECKOUT (see ./helpers/conversions-core-root).
  // What the skip costs: the cross-repo byte-match proving that CMS's own
  // WebCrypto envelope signature is identical to the one Core's frozen EV-037
  // runtime produces, and that Core's verifier accepts a CMS-issued envelope.
  // No in-repo test can stand in — the whole point is the OTHER side of the
  // boundary. Every assertion below is unchanged and runs verbatim whenever
  // Core is present (CONVERSIONS_CORE_ROOT=<path to kodigital-conversions>).
  it.skipIf(!HAS_CONVERSIONS_CORE)("byte-matches and passes the frozen EV-037 runtime verifier without a production runtime import", async () => {
    // The sibling runtime import is test-only by design; CMS production code
    // independently implements WebCrypto signing across the service boundary.
    const runtime = await importCore("packages/security/actor-envelope.mjs");
    const authority = await importCore("packages/security/protected-port-authority.mjs");
    const issued = await issueBootstrapActorContext(env(), identity(), NOW_SECONDS * 1_000);
    const runtimeEnvelope = runtime.issueActorEnvelope(issued.envelope.payload,
      authority.createIsolatedActorSigningCapability(isolatedRecord({ purpose: "actor" })));
    expect(issued.envelope.signature).toBe(runtimeEnvelope.signature);
    const verified = await runtime.verifyActorEnvelope(issued.envelope,
      authority.createIsolatedActorVerifierCapability(isolatedRecord({
      expectedIssuer: CF_ACCESS_BOOTSTRAP_ISSUER,
      expectedAudience: "kodigital-conversions-core",
      expectedEnvironment: "test",
      requiredSchemaVersion: "actor_context.v1",
      operationId: "connections.read",
      operationScope: null,
      nowSeconds: NOW_SECONDS,
      clockSkewSeconds: 0,
      replayOutcome: "accept",
    })));
    expect(verified.request_id).toBe(issued.requestId);
  });
});
