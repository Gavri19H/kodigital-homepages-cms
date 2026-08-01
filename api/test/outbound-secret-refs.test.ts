import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import {
  resolveAllowedOutboundSecretReference,
  validateAllowedOutboundSecretReference,
} from "../src/env";

function env(values: Record<string, unknown>): Env {
  return values as unknown as Env;
}

describe("database-selected outbound secret references", () => {
  it("resolves only an exact allowlisted, non-empty binding", () => {
    const bindings = env({
      LEADGEN_ALLOWED_OUTBOUND_SECRET_REFS: " OFFER_TOKEN_ALPHA, OFFER_TOKEN_BETA ",
      OFFER_TOKEN_ALPHA: "alpha-secret",
      OFFER_TOKEN_ALPHABET: "must-not-match-by-prefix",
    });

    expect(resolveAllowedOutboundSecretReference(bindings, "OFFER_TOKEN_ALPHA")).toEqual({
      ok: true,
      name: "OFFER_TOKEN_ALPHA",
      value: "alpha-secret",
    });
    expect(resolveAllowedOutboundSecretReference(bindings, "OFFER_TOKEN_ALPHABET")).toEqual({
      ok: false,
      code: "not_allowed",
    });
    expect(resolveAllowedOutboundSecretReference(bindings, "OFFER_TOKEN_BETA")).toEqual({
      ok: false,
      code: "binding_missing",
    });
  });

  it("treats absent and blank bindings as missing", () => {
    const bindings = env({
      LEADGEN_ALLOWED_OUTBOUND_SECRET_REFS: "OFFER_TOKEN_ABSENT,OFFER_TOKEN_BLANK",
      OFFER_TOKEN_BLANK: "   ",
    });

    expect(resolveAllowedOutboundSecretReference(bindings, "OFFER_TOKEN_ABSENT")).toEqual({
      ok: false,
      code: "binding_missing",
    });
    expect(resolveAllowedOutboundSecretReference(bindings, "OFFER_TOKEN_BLANK")).toEqual({
      ok: false,
      code: "binding_missing",
    });
  });

  it.each([
    "AWS_SECRET_ACCESS_KEY",
    "CH_PASSWORD",
    "CLOUDFLARE_PROVISIONING_API_TOKEN",
    "CF_ACCESS_AUD",
    "OPENAI_API_KEY",
    "LEADGEN_CONFIG_SIGNING_KEY",
    "LEADGEN_DEBUG_ENCRYPTION_KEY",
    "GOOGLE_MAPS_SERVER_KEY",
    "LISTICLE_PB_TOKEN_GENERIC",
    "DATABASE_URL",
    "PREVIEW_SECRET",
    "ch_password",
  ])("rejects infrastructure binding %s even when allowlisted and present", (name) => {
    const bindings = env({
      LEADGEN_ALLOWED_OUTBOUND_SECRET_REFS: name,
      [name]: "infrastructure-secret",
    });

    expect(resolveAllowedOutboundSecretReference(bindings, name)).toEqual({
      ok: false,
      code: "infrastructure_reference",
    });
  });

  it.each([
    "CF_API_TOKEN",
    "GITHUB_TOKEN",
    "NPM_TOKEN",
    "SENTRY_AUTH_TOKEN",
    "CI_DEPLOY_TOKEN",
    "UNDECLARED_WORKER_BINDING",
    "offer_token_lowercase",
  ])("rejects binding outside the positive outbound namespace: %s", (name) => {
    const bindings = env({
      LEADGEN_ALLOWED_OUTBOUND_SECRET_REFS: name,
      [name]: "infrastructure-secret",
    });

    expect(resolveAllowedOutboundSecretReference(bindings, name)).toEqual({
      ok: false,
      code: "infrastructure_reference",
    });
  });

  it("rejects malformed names before allowlist lookup", () => {
    const bindings = env({
      LEADGEN_ALLOWED_OUTBOUND_SECRET_REFS: "OFFER-TOKEN-BAD",
      "OFFER-TOKEN-BAD": "secret",
    });

    expect(resolveAllowedOutboundSecretReference(bindings, "OFFER-TOKEN-BAD")).toEqual({
      ok: false,
      code: "invalid_syntax",
    });
  });

  it("rejects undeclared legacy namespaces and requires OFFER_TOKEN_ for an inventoried legacy ref when newly copied", () => {
    const bindings = env({
      LEADGEN_ALLOWED_OUTBOUND_SECRET_REFS:
        "LEGACY_PROVIDER_TOKEN,LEADGEN_S2S_TOKEN_FACEBOOK,OFFER_TOKEN_NEW_PROVIDER",
      LEGACY_PROVIDER_TOKEN: "legacy-secret",
      LEADGEN_S2S_TOKEN_FACEBOOK: "inventoried-legacy-secret",
      OFFER_TOKEN_NEW_PROVIDER: "new-secret",
    });

    expect(
      validateAllowedOutboundSecretReference(bindings, "LEGACY_PROVIDER_TOKEN", {
        requireNewPrefix: true,
      }),
    ).toEqual({ ok: false, code: "infrastructure_reference" });
    expect(
      validateAllowedOutboundSecretReference(bindings, "LEADGEN_S2S_TOKEN_FACEBOOK", {
        requireNewPrefix: true,
      }),
    ).toEqual({ ok: false, code: "prefix_required" });
    expect(
      resolveAllowedOutboundSecretReference(bindings, "OFFER_TOKEN_NEW_PROVIDER", {
        requireNewPrefix: true,
      }),
    ).toEqual({ ok: true, name: "OFFER_TOKEN_NEW_PROVIDER", value: "new-secret" });
  });

  it("permits an explicitly allowlisted bound legacy reference at runtime", () => {
    const bindings = env({
      LEADGEN_ALLOWED_OUTBOUND_SECRET_REFS: "LEADGEN_S2S_TOKEN_FACEBOOK",
      LEADGEN_S2S_TOKEN_FACEBOOK: "legacy-live-value",
    });

    expect(resolveAllowedOutboundSecretReference(bindings, "LEADGEN_S2S_TOKEN_FACEBOOK")).toEqual({
      ok: true,
      name: "LEADGEN_S2S_TOKEN_FACEBOOK",
      value: "legacy-live-value",
    });
  });
});
