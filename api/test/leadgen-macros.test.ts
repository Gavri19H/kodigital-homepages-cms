// LeadGen Phase 4 — URL macro registry + {response:*} family (contract 04
// §10.5 + 01 §3 pattern reuse). The canonical half re-implements the
// listicles registry IDENTICALLY ("33 tokens" == 32 canonical + the
// {clickid} alias); the LeadGen half adds response macros with required/
// optional (`?`) marking, safe_fallback support, and template analysis.

import { describe, expect, it } from "vitest";
import {
  CANONICAL_MACROS,
  MACRO_ALIASES,
  analyzeResponseMacros,
  findUnknownMacros,
  isCanonicalMacro,
  normalizeTemplate,
  resolveMacros,
  responseMacroFallback,
  validateBannerUrlTemplate,
} from "../src/leadgen/macros";

describe("macro registry — 32 canonical tokens + alias (04 §10.5 / 01 §3)", () => {
  it("has exactly 32 canonical macros", () => {
    expect(CANONICAL_MACROS).toHaveLength(32);
    expect(new Set(CANONICAL_MACROS).size).toBe(32);
  });

  it("carries the exact listicles token set (identical re-implementation)", () => {
    const expected = [
      "click_id", "utm_medium", "utm_content", "utm_source", "traffic_source",
      "placement", "lander_v", "offer_id", "offer_name", "page", "device",
      "os", "os_version", "browser", "browser_version", "country", "state",
      "city", "ip", "ua", "sub1", "sub2", "sub3", "sub4", "sub5", "url",
      "referer", "language", "cpc", "session_id", "fbc", "fbclid",
    ];
    expect([...CANONICAL_MACROS].sort()).toEqual([...expected].sort());
  });

  it("{clickid} is an alias of {click_id}, not a 33rd canonical token", () => {
    expect(MACRO_ALIASES.clickid).toBe("click_id");
    expect(CANONICAL_MACROS).not.toContain("clickid");
  });

  it("isCanonicalMacro answers for every canonical name and rejects others", () => {
    for (const name of CANONICAL_MACROS) expect(isCanonicalMacro(name)).toBe(true);
    expect(isCanonicalMacro("clickid")).toBe(false);
    expect(isCanonicalMacro("response")).toBe(false);
    expect(isCanonicalMacro("Click_ID")).toBe(false);
  });
});

describe("normalizeTemplate — alias normalization", () => {
  it("rewrites {clickid} to {click_id} and preserves everything else", () => {
    const input = "https://track.example.com/c?cid={clickid}&s={sub1}&v={lander_v}";
    expect(normalizeTemplate(input)).toBe(
      "https://track.example.com/c?cid={click_id}&s={sub1}&v={lander_v}",
    );
  });

  it("leaves canonical, unknown AND response tokens byte-identical", () => {
    const input = "https://x.example/?a={click_id}&b={not_a_macro}&c={response:slug}&d={response:promo?}";
    expect(normalizeTemplate(input)).toBe(input);
  });
});

describe("findUnknownMacros — unknown canonical rejection input", () => {
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

  it("does NOT flag response tokens (a disjoint grammar, validated separately)", () => {
    expect(findUnknownMacros("https://x.example/?s={response:slug}&p={response:deep.path?}")).toEqual([]);
  });
});

describe("resolveMacros — canonical runtime substitution", () => {
  it("substitutes values with encodeURIComponent escaping", () => {
    const out = resolveMacros("https://p.example/?geo={state}&src={utm_source}", {
      state: "New York",
      utm_source: "a&b=c",
    });
    expect(out).toBe("https://p.example/?geo=New%20York&src=a%26b%3Dc");
  });

  it("resolves the {clickid} alias through {click_id}", () => {
    expect(resolveMacros("https://p.example/?c={clickid}", { click_id: "k1" })).toBe(
      "https://p.example/?c=k1",
    );
  });

  it("substitutes an unresolved canonical macro as the empty string", () => {
    expect(resolveMacros("https://p.example/?c={click_id}&x={sub1}", {})).toBe(
      "https://p.example/?c=&x=",
    );
  });

  it("leaves {response:*} tokens intact for the P11 click resolver", () => {
    expect(resolveMacros("https://p.example/?s={response:slug}&c={click_id}", { click_id: "k" })).toBe(
      "https://p.example/?s={response:slug}&c=k",
    );
  });
});

describe("analyzeResponseMacros — §10.5 required/optional analysis", () => {
  it("lists every response macro with its required/optional flag", () => {
    const refs = analyzeResponseMacros(
      "https://p.example/x?s={response:slug}&promo={response:promo?}&d={response:deep.data.0.code}",
    );
    expect(refs).toEqual([
      { path: "slug", required: true, token: "{response:slug}" },
      { path: "promo", required: false, token: "{response:promo?}" },
      { path: "deep.data.0.code", required: true, token: "{response:deep.data.0.code}" },
    ]);
  });

  it("deduplicates repeated references by (path, required) pair", () => {
    const refs = analyzeResponseMacros(
      "https://p.example/?a={response:slug}&b={response:slug}&c={response:slug?}",
    );
    expect(refs).toHaveLength(2);
    expect(refs.filter((r) => r.path === "slug" && r.required)).toHaveLength(1);
    expect(refs.filter((r) => r.path === "slug" && !r.required)).toHaveLength(1);
  });

  it("skips malformed tokens (they surface as validation errors instead)", () => {
    expect(analyzeResponseMacros("https://p.example/?a={response:}&b={response:a..b}")).toEqual([]);
  });

  it("returns empty for templates without response macros", () => {
    expect(analyzeResponseMacros("https://p.example/?c={click_id}")).toEqual([]);
  });
});

describe("responseMacroFallback — §10.5 per-macro safe_fallback", () => {
  it("returns the configured fallback for a path", () => {
    expect(responseMacroFallback({ promo: "SAVE10" }, "promo")).toBe("SAVE10");
  });

  it("defaults to the empty string when unconfigured / absent", () => {
    expect(responseMacroFallback({ promo: "SAVE10" }, "other")).toBe("");
    expect(responseMacroFallback(null, "promo")).toBe("");
    expect(responseMacroFallback(undefined, "promo")).toBe("");
  });
});

describe("validateBannerUrlTemplate — §10.5 guards", () => {
  it("accepts an absolute https URL mixing canonical + response macros", () => {
    const verdict = validateBannerUrlTemplate(
      "https://provider.example.com/offer?cid={clickid}&geo={country}&s={response:slug}&p={response:promo?}",
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.errors).toEqual([]);
    // The alias is normalized; response tokens survive byte-for-byte.
    expect(verdict.normalized).toBe(
      "https://provider.example.com/offer?cid={click_id}&geo={country}&s={response:slug}&p={response:promo?}",
    );
    // Analysis rides on the verdict for the Test-tool macro chips.
    expect(verdict.response_macros).toEqual([
      { path: "slug", required: true, token: "{response:slug}" },
      { path: "promo", required: false, token: "{response:promo?}" },
    ]);
  });

  it("rejects an empty template with template_required", () => {
    const verdict = validateBannerUrlTemplate("   ");
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.map((e) => e.code)).toEqual(["template_required"]);
  });

  it("rejects unknown canonical macros with the offending token", () => {
    const verdict = validateBannerUrlTemplate("https://p.example/?x={mystery}");
    expect(verdict.ok).toBe(false);
    const error = verdict.errors.find((e) => e.code === "unknown_macro");
    expect(error?.token).toBe("{mystery}");
  });

  it("rejects non-absolute and non-http(s) URLs", () => {
    for (const bad of [
      "/relative/path?c={click_id}",
      "ftp://provider.example.com/x",
      "javascript:alert(1)",
      "provider.example.com/no-scheme",
    ]) {
      const verdict = validateBannerUrlTemplate(bad);
      expect(verdict.ok, JSON.stringify(bad)).toBe(false);
      expect(verdict.errors.some((e) => e.code === "not_absolute_http")).toBe(true);
    }
  });

  it("rejects embedded control characters (\\n / \\r / \\t / \\0)", () => {
    for (const bad of [
      "https://track.example/c\n?cid={click_id}",
      "https://track.example/c\r?cid={click_id}",
      "https://track.example/c\t?cid={click_id}",
      "https://track.example/c\u0000?cid={click_id}",
    ]) {
      const verdict = validateBannerUrlTemplate(bad);
      expect(verdict.ok, JSON.stringify(bad)).toBe(false);
      expect(verdict.errors.some((e) => e.code === "control_characters")).toBe(true);
    }
  });

  it("rejects a macro in the host/authority position (host-choice vector)", () => {
    for (const bad of [
      "https://{sub1}/x",
      "https://{country}.track.example/c?cid={click_id}",
      "http://{utm_source}:8080/x",
      "https://{response:host}/x",
      "https://{response:host?}.p.example/x",
    ]) {
      const verdict = validateBannerUrlTemplate(bad);
      expect(verdict.ok, JSON.stringify(bad)).toBe(false);
      expect(verdict.errors.some((e) => e.code === "macro_in_authority")).toBe(true);
    }
  });

  it("still ACCEPTS macros in path/query (only the authority is forbidden)", () => {
    expect(
      validateBannerUrlTemplate("https://track.example/c/{sub1}?cid={click_id}&geo={country}").ok,
    ).toBe(true);
    expect(validateBannerUrlTemplate("https://track.example/{response:slug}?c={click_id}").ok).toBe(true);
  });

  it("rejects malformed response macro paths", () => {
    for (const bad of [
      "https://p.example/?a={response:}",
      "https://p.example/?a={response:?}",
      "https://p.example/?a={response:.slug}",
      "https://p.example/?a={response:slug.}",
      "https://p.example/?a={response:a..b}",
      "https://p.example/?a={response:a?b}",
      "https://p.example/?a={response:a b}",
    ]) {
      const verdict = validateBannerUrlTemplate(bad);
      expect(verdict.ok, JSON.stringify(bad)).toBe(false);
      expect(verdict.errors.some((e) => e.code === "invalid_response_macro")).toBe(true);
    }
  });

  it("rejects the same response path marked both required and optional", () => {
    const verdict = validateBannerUrlTemplate(
      "https://p.example/?a={response:slug}&b={response:slug?}",
    );
    expect(verdict.ok).toBe(false);
    expect(
      verdict.errors.some((e) => e.code === "conflicting_response_macro_requiredness"),
    ).toBe(true);
  });

  it("preserves every token through validation (normalized output)", () => {
    const verdict = validateBannerUrlTemplate(
      "https://p.example/?a={click_id}&b={sub5}&c={fbclid}&d={response:slug}",
    );
    expect(verdict.ok).toBe(true);
    for (const token of ["{click_id}", "{sub5}", "{fbclid}", "{response:slug}"]) {
      expect(verdict.normalized).toContain(token);
    }
  });
});
