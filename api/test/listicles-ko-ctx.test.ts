// ko_ctx acquisition cookie (§9.4/§16) — build/merge/serialize/parse
// round-trip, fbc derivation from fbclid, traffic_source fallback, language
// precedence (register Q8), clamping, and corrupt-cookie degradation.

import { describe, expect, it } from "vitest";
import {
  buildKoCtx,
  parseKoCtx,
  serializeKoCtxCookie,
  buildFbcFromFbclid,
  primaryLanguageTag,
  KO_CTX_COOKIE,
  KO_CTX_MAX_AGE_SECONDS,
} from "../src/public/listicle/ko-ctx";

const NOW = 1_760_000_000_000;

function build(query: Record<string, string>, existingRaw = "", extras: Partial<Parameters<typeof buildKoCtx>[0]> = {}) {
  return buildKoCtx({
    existing: parseKoCtx(existingRaw),
    query,
    landerV: "ver_1",
    siteLanguage: "",
    acceptLanguage: null,
    nowMs: NOW,
    ...extras,
  });
}

describe("capture on landing (§9.4 landing-time dims)", () => {
  it("captures utm_*, traffic_source, placement, cpc, fbclid, sub1–5 + lander_v", () => {
    const ctx = build({
      utm_source: "nbk",
      utm_medium: "cpc",
      utm_content: "ad1",
      traffic_source: "newsbreak",
      placement: "feed",
      cpc: "0.42",
      fbclid: "FB123",
      sub1: "a",
      sub2: "b",
      sub3: "c",
      sub4: "d",
      sub5: "e",
    });
    expect(ctx).toMatchObject({
      utm_source: "nbk",
      utm_medium: "cpc",
      utm_content: "ad1",
      traffic_source: "newsbreak",
      placement: "feed",
      cpc: "0.42",
      fbclid: "FB123",
      sub1: "a",
      sub5: "e",
      lander_v: "ver_1",
    });
  });

  it("fbc derives from fbclid per the fb.1.<ts>.<fbclid> format when absent; an explicit fbc wins", () => {
    expect(build({ fbclid: "XYZ" }).fbc).toBe(`fb.1.${NOW}.XYZ`);
    expect(buildFbcFromFbclid("XYZ", 5)).toBe("fb.1.5.XYZ");
    expect(build({ fbclid: "XYZ", fbc: "fb.1.1.orig" }).fbc).toBe("fb.1.1.orig");
  });

  it("traffic_source falls back to utm_source when no dedicated param arrives", () => {
    expect(build({ utm_source: "taboola" }).traffic_source).toBe("taboola");
    expect(build({ utm_source: "taboola", traffic_source: "direct-buy" }).traffic_source).toBe("direct-buy");
  });

  it("language precedence: ?language/?lang → site_language → Accept-Language → absent", () => {
    expect(build({ language: "fr" }).language).toBe("fr");
    expect(build({ lang: "de" }).language).toBe("de");
    expect(build({}, "", { siteLanguage: "es" }).language).toBe("es");
    expect(build({}, "", { acceptLanguage: "en-US,en;q=0.9" }).language).toBe("en-US");
    expect(build({}).language).toBeUndefined();
  });

  it("primaryLanguageTag parses the first tag and rejects junk", () => {
    expect(primaryLanguageTag("en-US,en;q=0.9")).toBe("en-US");
    expect(primaryLanguageTag("pt-BR")).toBe("pt-BR");
    expect(primaryLanguageTag("!!;;")).toBe("");
    expect(primaryLanguageTag(null)).toBe("");
  });

  it("values are length-clamped (cookie stays small)", () => {
    const ctx = build({ utm_source: "x".repeat(1000) });
    expect((ctx.utm_source ?? "").length).toBe(200);
  });
});

describe("merge semantics (internal navigation preserves acquisition)", () => {
  it("params win; absent params preserve prior captured values; lander_v refreshes", () => {
    const first = build({ utm_source: "nbk", placement: "feed" });
    const cookie = serializeKoCtxCookie(first);
    const rawValue = cookie.split(";")[0]?.split("=").slice(1).join("=") ?? "";
    const second = buildKoCtx({
      existing: parseKoCtx(rawValue),
      query: { placement: "sidebar" }, // fresh placement only
      landerV: "ver_2",
      siteLanguage: "",
      acceptLanguage: null,
      nowMs: NOW + 1000,
    });
    expect(second.utm_source).toBe("nbk"); // preserved
    expect(second.placement).toBe("sidebar"); // param wins
    expect(second.lander_v).toBe("ver_2"); // refreshed
  });
});

describe("serialize/parse round-trip + hardening", () => {
  it("round-trips through the cookie encoding with the 30-day/Path=/ attributes", () => {
    const ctx = build({ utm_source: "nbk", fbclid: "F1" });
    const cookie = serializeKoCtxCookie(ctx);
    expect(cookie.startsWith(`${KO_CTX_COOKIE}=`)).toBe(true);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Max-Age=${KO_CTX_MAX_AGE_SECONDS}`);
    expect(cookie).toContain("SameSite=Lax");
    expect(KO_CTX_MAX_AGE_SECONDS).toBe(30 * 24 * 3600);
    const rawValue = cookie.split(";")[0]?.split("=").slice(1).join("=") ?? "";
    expect(parseKoCtx(rawValue)).toEqual(ctx);
  });

  it("corrupt / hostile cookie values degrade to {} (never throw)", () => {
    expect(parseKoCtx("{not json")).toEqual({});
    expect(parseKoCtx("%7Bbroken")).toEqual({});
    expect(parseKoCtx('["array"]')).toEqual({});
    expect(parseKoCtx('"str"')).toEqual({});
    expect(parseKoCtx("")).toEqual({});
    expect(parseKoCtx(null)).toEqual({});
    // non-string values are dropped.
    expect(parseKoCtx(encodeURIComponent(JSON.stringify({ utm_source: 5, ok: "v" })))).toEqual({ ok: "v" });
  });
});
