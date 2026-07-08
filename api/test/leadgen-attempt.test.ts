// LeadGen §8.3 / §24c `/lg/attempt` token minting — unit tests. Proves the
// mint returns both ids, the signed v2 token (fix-contract v2.4 05 §5.3)
// verifies against the EXACT 7-field tuple and FAILS on any tampered field or
// tampered signature, the absent-secret path mints an explicit `unsigned.`
// token that fails closed when a secret is configured, and two attempts get
// distinct funnel_attempt_ids.

import { describe, expect, it } from "vitest";
import {
  computeAttemptBindingExtras,
  mintFunnelAttempt,
  verifyConfigToken,
  verifyConfigTokenDetailed,
  mintFunnelAttemptId,
  isSignedToken,
  timingSafeEqualBytes,
  type ConfigTokenTuple,
} from "../src/public/leadgen/attempt";
import { computeSectionOrderHash } from "../src/public/leadgen/config-dto";
import type { ResolvedActivatedFunnel, ResolvedFunnelSection } from "../src/public/leadgen/resolver";
import { mintPublicId } from "../src/leadgen/ids";
import type {
  LeadgenSectionRow,
  LeadgenFunnelRow,
  LeadgenFunnelVariantRow,
  LeadgenQuoteRow,
  LeadgenSiteQuoteRow,
} from "../src/admin/leadgen/db-types";
import type { Env } from "../src/env";

const SIGNED_ENV = { LEADGEN_CONFIG_SIGNING_KEY: "signing-key-test-only" } as unknown as Env;
const NO_SECRET_ENV = {} as unknown as Env;

function section(i: number): ResolvedFunnelSection {
  const s: LeadgenSectionRow = {
    id: i + 1,
    public_id: mintPublicId("section", 1_700_000_000_000 + i),
    section_name: "S",
    activity: "auto",
    vertical: "insurance",
    headline_text: "Q",
    subheadline_text: null,
    image_json: null,
    content_json: JSON.stringify({ components: [] }),
    content_html: null,
    continue_mode: "button",
    design_overrides_json: null,
    address_validation_enabled: 0,
    section_mapping_version: 1,
    content_version: 1,
    status: "active",
    created_by: null,
    created_at: 0,
    updated_at: 0,
  };
  return { position: i, section: s };
}

function buildResolved(): ResolvedActivatedFunnel {
  const quote: LeadgenQuoteRow = {
    id: 5,
    public_id: mintPublicId("quote"),
    quote_name: "Q",
    activity: "auto",
    verticals_json: "[]",
    status: "active",
    created_by: null,
    created_at: 0,
    updated_at: 0,
  };
  const funnel: LeadgenFunnelRow = {
    id: 7,
    public_id: mintPublicId("funnel"),
    quote_id: 5,
    funnel_name: "F",
    active_ab_test_id: null,
    status: "active",
    created_at: 0,
    updated_at: 0,
  };
  const variant: LeadgenFunnelVariantRow = {
    id: 9,
    public_id: mintPublicId("funnel_variant"),
    funnel_id: 7,
    ab_test_id: null,
    variant_label: "A",
    is_control: 1,
    traffic_allocation_bp: 10000,
    funnel_design_id: "default",
    auction_id: null,
    lander_enabled: 0,
    lander_headline: null,
    lander_subheadline: null,
    lander_body_json: null,
    lander_hero_media_id: null,
    lander_hero_media_url: null,
    lander_cta_json: null,
    content_version: 4,
    status: "active",
    created_at: 0,
  };
  const site_quote: LeadgenSiteQuoteRow = {
    id: 2,
    site_id: "site_1",
    quote_id: 5,
    enabled: 1,
    slug: null,
    settings_overrides_json: null,
    created_at: 0,
    updated_at: 0,
  };
  return {
    site_quote,
    quote,
    funnel,
    variant,
    sections: [section(0), section(1)],
    ga4_measurement_id: null,
    // attempt.ts binds the variant/hash/content_version regardless of A/B; the
    // single_control dims satisfy the resolved-bundle type.
    assignment: {
      funnel_ab_test_id: "",
      funnel_ab_test_revision: 0,
      variant_label: variant.variant_label,
      traffic_allocation_bp: variant.traffic_allocation_bp,
      assignment_bucket: null,
      assignment_reason: "single_control",
    },
  };
}

// The v2 expected tuple (05 §5.3): the mapping/auction extras come from the
// SAME computeAttemptBindingExtras the mint used (no-DB env ⇒ per-section "0"
// versions + "" auction version — symmetric by construction).
async function expectedTupleFor(
  env: Env,
  resolved: ResolvedActivatedFunnel,
  funnelAttemptId: string,
  sessionId = "",
): Promise<ConfigTokenTuple> {
  const extras = await computeAttemptBindingExtras(env, resolved);
  return {
    funnel_variant_id: resolved.variant.public_id,
    section_order_hash: computeSectionOrderHash(resolved),
    content_version: resolved.variant.content_version,
    funnel_attempt_id: funnelAttemptId,
    session_id: sessionId,
    answer_mapping_hash: extras.answer_mapping_hash,
    auction_config_version: extras.auction_config_version,
  };
}

describe("mintFunnelAttempt — signed (secret configured)", () => {
  it("returns a funnel_attempt_id (att_ prefix, NOT a public_id kind) + a signed v2 token", async () => {
    const resolved = buildResolved();
    const attempt = await mintFunnelAttempt(SIGNED_ENV, resolved);
    expect(attempt.funnel_attempt_id.startsWith("att_")).toBe(true);
    expect(attempt.funnel_attempt_id.startsWith("lg")).toBe(false);
    expect(isSignedToken(attempt.signed_config_token)).toBe(true);
    // 05 §5.3: minting is ALWAYS the v2 scheme.
    expect(attempt.signed_config_token.startsWith("v2.")).toBe(true);
  });

  it("the signed token verifies against the EXACT v2 tuple + returns the verified landing_url", async () => {
    const resolved = buildResolved();
    const attempt = await mintFunnelAttempt(SIGNED_ENV, resolved, Date.now(), {
      session_id: "sess-a",
      landing_url: "https://one.example.com/lg/life?utm_source=fb",
    });
    const tuple = await expectedTupleFor(SIGNED_ENV, resolved, attempt.funnel_attempt_id, "sess-a");
    const detailed = await verifyConfigTokenDetailed(SIGNED_ENV, attempt.signed_config_token, tuple);
    expect(detailed.ok).toBe(true);
    // 04 §4.2: the persisted attempt context comes back from the VERIFIED payload.
    expect(detailed.landing_url).toBe("https://one.example.com/lg/life?utm_source=fb");
    expect(await verifyConfigToken(SIGNED_ENV, attempt.signed_config_token, tuple)).toBe(true);
  });

  it("FAILS verification on ANY tampered tuple field (all 7 v2 fields)", async () => {
    const resolved = buildResolved();
    const attempt = await mintFunnelAttempt(SIGNED_ENV, resolved, Date.now(), { session_id: "sess-a" });
    const base = await expectedTupleFor(SIGNED_ENV, resolved, attempt.funnel_attempt_id, "sess-a");
    const token = attempt.signed_config_token;
    expect(await verifyConfigToken(SIGNED_ENV, token, { ...base, funnel_variant_id: mintPublicId("funnel_variant") })).toBe(false);
    expect(await verifyConfigToken(SIGNED_ENV, token, { ...base, section_order_hash: "deadbeef" })).toBe(false);
    expect(await verifyConfigToken(SIGNED_ENV, token, { ...base, content_version: base.content_version + 1 })).toBe(false);
    expect(await verifyConfigToken(SIGNED_ENV, token, { ...base, funnel_attempt_id: "att_other" })).toBe(false);
    // v2 additions (05 §5.3): session / mapping hash / auction version.
    expect(await verifyConfigToken(SIGNED_ENV, token, { ...base, session_id: "sess-FORGED" })).toBe(false);
    expect(await verifyConfigToken(SIGNED_ENV, token, { ...base, answer_mapping_hash: "0".repeat(64) })).toBe(false);
    expect(await verifyConfigToken(SIGNED_ENV, token, { ...base, auction_config_version: "999" })).toBe(false);
  });

  it("FAILS verification when the token signature is tampered", async () => {
    const resolved = buildResolved();
    const attempt = await mintFunnelAttempt(SIGNED_ENV, resolved);
    const tuple = await expectedTupleFor(SIGNED_ENV, resolved, attempt.funnel_attempt_id);
    const parts = attempt.signed_config_token.split(".");
    // Tamper the FIRST base64url char of the signature (mirrors the payload-
    // tamper test below). The LAST char of a no-padding 32-byte base64url
    // signature carries 2 unused padding bits, so an "A"↔"B" flip there can
    // decode to the IDENTICAL bytes (~1/16 of random signatures) — a
    // non-deterministic tamper. The first char encodes only real bits, so the
    // flip always changes byte 0 → the signature always differs.
    const firstChar = parts[2]!.slice(0, 1) === "A" ? "B" : "A";
    const tamperedSig = `${parts[0]}.${parts[1]}.${firstChar}${parts[2]!.slice(1)}`;
    expect(await verifyConfigToken(SIGNED_ENV, tamperedSig, tuple)).toBe(false);
  });

  it("FAILS verification when the token payload is tampered", async () => {
    const resolved = buildResolved();
    const attempt = await mintFunnelAttempt(SIGNED_ENV, resolved);
    const tuple = await expectedTupleFor(SIGNED_ENV, resolved, attempt.funnel_attempt_id);
    const parts = attempt.signed_config_token.split(".");
    const firstChar = parts[1]!.slice(0, 1) === "A" ? "B" : "A";
    const tamperedPayload = `${parts[0]}.${firstChar}${parts[1]!.slice(1)}.${parts[2]}`;
    expect(await verifyConfigToken(SIGNED_ENV, tamperedPayload, tuple)).toBe(false);
  });

  it("two attempts get distinct funnel_attempt_ids", async () => {
    const resolved = buildResolved();
    const a = await mintFunnelAttempt(SIGNED_ENV, resolved);
    const b = await mintFunnelAttempt(SIGNED_ENV, resolved);
    expect(a.funnel_attempt_id).not.toBe(b.funnel_attempt_id);
  });
});

describe("mintFunnelAttempt — absent secret (dev fallback, fails closed in prod)", () => {
  it("mints an EXPLICIT unsigned token (never a fake signature)", async () => {
    const resolved = buildResolved();
    const attempt = await mintFunnelAttempt(NO_SECRET_ENV, resolved);
    expect(attempt.signed_config_token.startsWith("unsigned.")).toBe(true);
    expect(isSignedToken(attempt.signed_config_token)).toBe(false);
  });

  it("an unsigned token verifies in dev (no secret) only when the tuple matches", async () => {
    const resolved = buildResolved();
    const attempt = await mintFunnelAttempt(NO_SECRET_ENV, resolved);
    const tuple = await expectedTupleFor(NO_SECRET_ENV, resolved, attempt.funnel_attempt_id);
    expect(await verifyConfigToken(NO_SECRET_ENV, attempt.signed_config_token, tuple)).toBe(true);
    expect(await verifyConfigToken(NO_SECRET_ENV, attempt.signed_config_token, { ...tuple, content_version: 99 })).toBe(false);
  });

  it("requireSigned FAILS CLOSED: an unsigned token is rejected even with NO secret (the money-path guard)", async () => {
    const resolved = buildResolved();
    const attempt = await mintFunnelAttempt(NO_SECRET_ENV, resolved);
    const tuple = await expectedTupleFor(NO_SECRET_ENV, resolved, attempt.funnel_attempt_id);
    // Without requireSigned (dev), the tuple-matching unsigned token is accepted…
    expect(await verifyConfigToken(NO_SECRET_ENV, attempt.signed_config_token, tuple)).toBe(true);
    // …but requireSigned (the live /lg/auction path) rejects it REGARDLESS of secret
    // presence, so a prod deploy that forgot the signing key fails CLOSED (rejects
    // all) instead of OPEN (accepting forged bindings).
    expect(await verifyConfigToken(NO_SECRET_ENV, attempt.signed_config_token, tuple, { requireSigned: true })).toBe(false);
    // And a genuinely signed token still passes requireSigned when the secret is present (no regression).
    const signed = await mintFunnelAttempt(SIGNED_ENV, resolved);
    const signedTuple = await expectedTupleFor(SIGNED_ENV, resolved, signed.funnel_attempt_id);
    expect(await verifyConfigToken(SIGNED_ENV, signed.signed_config_token, signedTuple, { requireSigned: true })).toBe(true);
  });

  it("PRODUCTION (secret configured) REJECTS an unsigned token", async () => {
    const resolved = buildResolved();
    const attempt = await mintFunnelAttempt(NO_SECRET_ENV, resolved);
    const tuple = await expectedTupleFor(SIGNED_ENV, resolved, attempt.funnel_attempt_id);
    expect(await verifyConfigToken(SIGNED_ENV, attempt.signed_config_token, tuple)).toBe(false);
  });

  it("a signed token cannot be verified without the secret (dev)", async () => {
    const resolved = buildResolved();
    const attempt = await mintFunnelAttempt(SIGNED_ENV, resolved);
    const tuple = await expectedTupleFor(NO_SECRET_ENV, resolved, attempt.funnel_attempt_id);
    expect(await verifyConfigToken(NO_SECRET_ENV, attempt.signed_config_token, tuple)).toBe(false);
  });
});

describe("primitives", () => {
  it("mintFunnelAttemptId is att_-prefixed and unique per call", () => {
    const a = mintFunnelAttemptId();
    const b = mintFunnelAttemptId();
    expect(a.startsWith("att_")).toBe(true);
    expect(a).not.toBe(b);
  });

  it("timingSafeEqualBytes: equal iff same length + bytes", () => {
    expect(timingSafeEqualBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(timingSafeEqualBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(timingSafeEqualBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
});
