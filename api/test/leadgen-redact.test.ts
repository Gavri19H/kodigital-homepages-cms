// LeadGen §30.3 redaction module (src/leadgen/redact.ts) — pure unit tests.
//
// Proves: the §30.3-derived PII key list (log clause ∪ S2S/CAPI hash list)
// hashes with the exact lowercased-trimmed SHA-256 the contract mandates
// ("sha256:"-prefixed, reusing the Stage-A sha256Hex), non-PII passes
// byte-identical (0/false/null included), PII-key SUBTREES force-hash,
// header masking is case-insensitive, maskPaths masks only existing token
// paths without mutating the input, and nothing here ever throws.

import { describe, expect, it } from "vitest";
import {
  REDACTED_VALUE,
  hashPiiValue,
  isPiiKey,
  maskPaths,
  maskSecretHeaders,
  redactPii,
} from "../src/leadgen/redact";
import { sha256Hex } from "../src/public/leadgen/auction/parse";

function h(value: string): string {
  return `sha256:${sha256Hex(value)}`;
}

describe("isPiiKey — the §30.3-derived key list", () => {
  it("matches every listed PII class across spelling variants", () => {
    const piiKeys = [
      "email",
      "Email",
      "email_address",
      "emailAddress",
      "phone",
      "phone_number",
      "phoneNumber",
      "first_name",
      "firstName",
      "last_name",
      "full_name",
      "name",
      "address",
      "street",
      "street_address",
      "address_line1",
      "address_line2",
      "dob",
      "date_of_birth",
      "birthdate",
      "zip",
      "zip_code",
      "zipCode",
      "postal_code",
      "postcode",
      "country",
    ];
    for (const key of piiKeys) {
      expect(isPiiKey(key), `${key} must be PII`).toBe(true);
    }
  });

  it("does not match non-PII keys", () => {
    for (const key of ["age", "home_own", "click_id", "city", "state", "plan", "carrier_name"]) {
      expect(isPiiKey(key), `${key} must NOT be PII`).toBe(false);
    }
  });
});

describe("redactPii — §30.3 'PII hashed or removed'", () => {
  it("hashes PII values lowercased + trimmed with the sha256: prefix", () => {
    const out = redactPii({ email: " Jane@X.COM ", age: 44 }) as Record<string, unknown>;
    expect(out["email"]).toBe(h("jane@x.com"));
    expect(out["age"]).toBe(44);
  });

  it("hashes numeric PII values (zip as a number) deterministically", () => {
    const out = redactPii({ zip: 90210 }) as Record<string, unknown>;
    expect(out["zip"]).toBe(h("90210"));
  });

  it("walks nested objects and arrays", () => {
    const out = redactPii({
      contact: { email: "a@b.c", phone: "555-0100" },
      drivers: [{ first_name: "Ann", age: 30 }],
      meta: { click_id: "ck_1" },
    }) as Record<string, unknown>;
    const contact = out["contact"] as Record<string, unknown>;
    expect(contact["email"]).toBe(h("a@b.c"));
    expect(contact["phone"]).toBe(h("555-0100"));
    const drivers = out["drivers"] as Array<Record<string, unknown>>;
    expect(drivers[0]?.["first_name"]).toBe(h("ann"));
    expect(drivers[0]?.["age"]).toBe(30);
    expect((out["meta"] as Record<string, unknown>)["click_id"]).toBe("ck_1");
  });

  it("force-hashes the WHOLE subtree under a PII key (address object leaks nothing)", () => {
    const out = redactPii({
      address: { line1: "5 Elm St", city: "Springfield", geo: [1.5, 2.5] },
    }) as Record<string, unknown>;
    const address = out["address"] as Record<string, unknown>;
    expect(address["line1"]).toBe(h("5 elm st"));
    expect(address["city"]).toBe(h("springfield"));
    expect(address["geo"]).toEqual([h("1.5"), h("2.5")]);
  });

  it("keeps 0 / false / null / empty containers byte-identical outside PII keys", () => {
    const input = { count: 0, ok: false, missing: null, list: [], obj: {} };
    expect(redactPii(input)).toEqual(input);
  });

  it("null under a PII key stays null (nothing to hash)", () => {
    const out = redactPii({ email: null }) as Record<string, unknown>;
    expect(out["email"]).toBeNull();
  });

  it("is deterministic (two runs deep-equal)", () => {
    const input = { email: "A@B.C", nested: { zip: "12345", n: 7 } };
    expect(redactPii(input)).toEqual(redactPii(input));
  });

  it("never throws: unserializable leaves redact, pathological depth degrades", () => {
    const fn = (): void => undefined;
    const out = redactPii({ cb: fn }) as Record<string, unknown>;
    expect(out["cb"]).toBe(REDACTED_VALUE);

    // 100-level nesting exceeds the recursion bound → degrades, never throws.
    let deep: Record<string, unknown> = { leaf: "x" };
    for (let i = 0; i < 100; i++) deep = { next: deep };
    expect(() => redactPii(deep)).not.toThrow();
    expect(JSON.stringify(redactPii(deep))).toContain(REDACTED_VALUE);
  });

  it("hashPiiValue matches the §30.3 S2S hash recipe exactly", () => {
    expect(hashPiiValue(" User@Example.COM ")).toBe(`sha256:${sha256Hex("user@example.com")}`);
  });
});

describe("maskSecretHeaders — §30.2 secret values never returned", () => {
  it("masks named headers case-insensitively, leaves the rest verbatim", () => {
    const out = maskSecretHeaders(
      { "X-Api-Key": "tok-123", "Content-Type": "application/json", "X-Trace": "t1" },
      new Set(["x-api-key"]),
    );
    expect(out).toEqual({
      "X-Api-Key": REDACTED_VALUE,
      "Content-Type": "application/json",
      "X-Trace": "t1",
    });
  });

  it("accepts mixed-case names in the secret set", () => {
    const out = maskSecretHeaders({ authorization: "Bearer t" }, new Set(["Authorization"]));
    expect(out["authorization"]).toBe(REDACTED_VALUE);
  });
});

describe("maskPaths — token-node masking inside built payloads", () => {
  it("masks the value at an existing dotted path (arrays included)", () => {
    const input = { auth: { api_token: "tok-9" }, drivers: [{ token: "d0" }] };
    const out = maskPaths(input, ["auth.api_token", "drivers.0.token"]) as Record<string, unknown>;
    expect((out["auth"] as Record<string, unknown>)["api_token"]).toBe(REDACTED_VALUE);
    expect(((out["drivers"] as unknown[])[0] as Record<string, unknown>)["token"]).toBe(
      REDACTED_VALUE,
    );
  });

  it("does not mutate the input and no-ops on missing paths", () => {
    const input = { auth: { api_token: "tok-9" } };
    const out = maskPaths(input, ["auth.api_token", "not.there"]) as Record<string, unknown>;
    expect(input.auth.api_token).toBe("tok-9"); // original untouched
    expect((out["auth"] as Record<string, unknown>)["api_token"]).toBe(REDACTED_VALUE);
    expect(out["not"]).toBeUndefined();
  });

  it("returns the value unchanged for an empty path list", () => {
    const input = { a: 1 };
    expect(maskPaths(input, [])).toBe(input);
  });
});
