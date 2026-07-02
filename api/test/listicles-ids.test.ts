// Listicles Phase 2 — public-id minting (contract §5 "ID strategy").
// Self-contained ULID: Crockford base32, 26 chars, time-ordered, CSPRNG.

import { describe, expect, it } from "vitest";
import {
  PUBLIC_ID_PREFIXES,
  ULID_LENGTH,
  isPublicId,
  mintPublicId,
  ulid,
  type PublicIdKind,
} from "../src/listicles/ids";

const CROCKFORD_RE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

describe("listicles ids — ULID shape", () => {
  it("mints 26-char Crockford base32 ULIDs (no I/L/O/U)", () => {
    for (let i = 0; i < 50; i++) {
      const id = ulid();
      expect(id).toHaveLength(ULID_LENGTH);
      expect(id).toMatch(CROCKFORD_RE);
    }
  });

  it("is time-ordered: ids minted at increasing timestamps sort lexicographically", () => {
    const t1 = ulid(1_700_000_000_000);
    const t2 = ulid(1_700_000_000_001);
    const t3 = ulid(1_800_000_000_000);
    expect(t1 < t2).toBe(true);
    expect(t2 < t3).toBe(true);
    // The 10 time chars are identical for the same millisecond.
    expect(ulid(123456789).slice(0, 10)).toBe(ulid(123456789).slice(0, 10));
  });

  it("randomness differs between mints in the same millisecond", () => {
    const a = ulid(1_700_000_000_000);
    const b = ulid(1_700_000_000_000);
    expect(a).not.toBe(b);
  });
});

describe("listicles ids — the nine entity prefixes (§5 + §30.7)", () => {
  const expected: Record<PublicIdKind, string> = {
    offer: "off_",
    section: "sec_",
    article: "art_",
    experiment: "exp_",
    version: "ver_",
    page: "pg_",
    candidate: "cand_",
    rule: "rule_",
    link_instance: "lnk_",
  };

  it("exposes exactly the nine contract prefixes", () => {
    expect(PUBLIC_ID_PREFIXES).toEqual(expected);
    expect(Object.keys(PUBLIC_ID_PREFIXES)).toHaveLength(9);
  });

  for (const [kind, prefix] of Object.entries(expected) as Array<[PublicIdKind, string]>) {
    it(`mintPublicId('${kind}') yields ${prefix}<26-char ULID>`, () => {
      const id = mintPublicId(kind);
      expect(id.startsWith(prefix)).toBe(true);
      expect(id.slice(prefix.length)).toMatch(CROCKFORD_RE);
      expect(isPublicId(kind, id)).toBe(true);
    });
  }

  it("isPublicId rejects wrong prefixes and malformed remainders", () => {
    expect(isPublicId("offer", mintPublicId("section"))).toBe(false);
    expect(isPublicId("offer", "off_short")).toBe(false);
    expect(isPublicId("offer", "off_" + "I".repeat(26))).toBe(false); // I not in Crockford
  });
});
