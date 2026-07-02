// Listicles Phase 2 — macro registry (contract §9.4 / §23).
// "33 tokens" == 32 CANONICAL macros + {clickid} accepted only as a
// normalization alias of {click_id}.

import { describe, expect, it } from "vitest";
import {
  CANONICAL_MACROS,
  MACRO_ALIASES,
  findUnknownMacros,
  normalizeTemplate,
  validateOfferUrlTemplate,
} from "../src/listicles/macros";

describe("macro registry — §9.4 token list", () => {
  it("has exactly 32 canonical macros", () => {
    expect(CANONICAL_MACROS).toHaveLength(32);
    expect(new Set(CANONICAL_MACROS).size).toBe(32);
  });

  it("carries every §9.4 token", () => {
    const expected = [
      "click_id", "utm_medium", "utm_content", "utm_source", "traffic_source",
      "placement", "lander_v", "offer_id", "offer_name", "page", "device",
      "os", "os_version", "browser", "browser_version", "country", "state",
      "city", "ip", "ua", "sub1", "sub2", "sub3", "sub4", "sub5", "url",
      "referer", "language", "cpc", "session_id", "fbc", "fbclid",
    ];
    expect([...CANONICAL_MACROS].sort()).toEqual([...expected].sort());
  });

  it("{clickid} is an alias of {click_id} (the contract's 33rd token)", () => {
    expect(MACRO_ALIASES.clickid).toBe("click_id");
    expect(CANONICAL_MACROS).not.toContain("clickid");
  });
});

describe("normalizeTemplate — alias normalization", () => {
  it("rewrites {clickid} to {click_id} and preserves everything else", () => {
    const input = "https://track.example.com/c?cid={clickid}&s={sub1}&v={lander_v}";
    expect(normalizeTemplate(input)).toBe(
      "https://track.example.com/c?cid={click_id}&s={sub1}&v={lander_v}",
    );
  });

  it("leaves canonical and unknown tokens byte-identical", () => {
    const input = "https://x.example/?a={click_id}&b={not_a_macro}";
    expect(normalizeTemplate(input)).toBe(input);
  });
});

describe("findUnknownMacros — unknown rejection input", () => {
  it("accepts all 32 canonical tokens plus the alias", () => {
    const all = CANONICAL_MACROS.map((name) => `{${name}}`).join("&");
    expect(findUnknownMacros(`https://x.example/?${all}&alias={clickid}`)).toEqual([]);
  });

  it("reports unknown tokens (deduplicated)", () => {
    expect(
      findUnknownMacros("https://x.example/?a={clickid2}&b={bogus}&c={bogus}"),
    ).toEqual(["clickid2", "bogus"]);
  });

  it("is case-sensitive — {Click_ID} is unknown, not a lenient match", () => {
    expect(findUnknownMacros("https://x.example/?a={Click_ID}")).toEqual(["Click_ID"]);
  });
});

describe("validateOfferUrlTemplate — §23 URL rules", () => {
  it("accepts an absolute https URL with macros and normalizes the alias", () => {
    const verdict = validateOfferUrlTemplate(
      "https://provider.example.com/offer?cid={clickid}&geo={country}",
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.errors).toEqual([]);
    expect(verdict.normalized).toBe(
      "https://provider.example.com/offer?cid={click_id}&geo={country}",
    );
  });

  it("rejects unknown macros", () => {
    const verdict = validateOfferUrlTemplate("https://provider.example.com/?x={mystery}");
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join(" ")).toContain("{mystery}");
  });

  it("rejects non-absolute and non-http(s) URLs", () => {
    for (const bad of [
      "/relative/path?c={click_id}",
      "ftp://provider.example.com/x",
      "javascript:alert(1)",
      "provider.example.com/no-scheme",
      "",
    ]) {
      expect(validateOfferUrlTemplate(bad).ok).toBe(false);
    }
  });

  it("preserves macros through validation (normalized output keeps every token)", () => {
    const template = "https://p.example/?a={click_id}&b={sub5}&c={fbclid}";
    const verdict = validateOfferUrlTemplate(template);
    expect(verdict.ok).toBe(true);
    for (const token of ["{click_id}", "{sub5}", "{fbclid}"]) {
      expect(verdict.normalized).toContain(token);
    }
  });
});
