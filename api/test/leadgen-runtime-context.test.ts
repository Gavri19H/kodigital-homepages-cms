// LeadGen canonical runtime context (fix-contract v2.4 04 §4.1–§4.5 —
// R2/R3/R8/B3/B5): ONE builder assembles request/cloudflare/traffic/offer/
// computed slices and projects them onto the EXISTING 33-macro registry
// (Rework M10 added `feed_name`).
// Covers the per-macro resolution table (every canonical macro → its
// context source or documented-empty), the §4.5 placement precedence, the
// M1 {referrer} alias, B5 overrides, builder purity, and the new
// `source:"placement"` payload leg.

import { describe, expect, it } from "vitest";
import {
  CANONICAL_MACROS,
  findUnknownMacros,
  normalizeTemplate,
  resolveMacros,
} from "../src/leadgen/macros";
import {
  buildLeadgenRuntimeContext,
  contextToMacros,
  type LeadgenRuntimeContextOpts,
} from "../src/leadgen/runtime-context";
import {
  buildPayload,
  validatePayloadSchema,
  type LeadgenPayloadNode,
  type LeadgenPayloadSchema,
} from "../src/leadgen/payload";

// 2026-07-08T14:00:00.123Z — fixed build instant (purity + fbc derivation).
const NOW = 1783519200123;

const WIN_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const LANDING_URL =
  "https://funnel.example.com/best-life-quotes" +
  "?utm_source=fb&utm_medium=paid&utm_content=creative7&utm_campaign=spring_life&traffic_source=meta" +
  "&placement=feed_top&sub1=s1&sub2=s2&sub3=s3&sub4=s4&sub5=s5&cpc=1.25&fbclid=CLICK123";

const REFERER = "https://ads.example.net/campaign";

// Same request.cf faking pattern as leadgen-runtime-guard.test.ts.
function makeRequest(
  url: string,
  init: { headers?: Record<string, string>; cf?: Record<string, unknown> } = {},
): Request {
  const r = new Request(url, { headers: init.headers });
  if (init.cf !== undefined) (r as unknown as { cf: unknown }).cf = init.cf;
  return r;
}

function fullRequest(): Request {
  return makeRequest(LANDING_URL, {
    headers: {
      "cf-connecting-ip": "203.0.113.9",
      "user-agent": WIN_CHROME_UA,
      referer: REFERER,
      "accept-language": "en-US,en;q=0.9",
    },
    cf: {
      country: "US",
      region: "California",
      regionCode: "CA",
      city: "Los Angeles",
      postalCode: "90001",
      timezone: "America/Los_Angeles",
      colo: "LAX",
    },
  });
}

function baseOpts(overrides: Partial<LeadgenRuntimeContextOpts> = {}): LeadgenRuntimeContextOpts {
  return {
    session_id: "sess_01H",
    page_view_id: "pv_01H",
    funnel_attempt_id: "lgfa_01H",
    quote: "lgq_01H",
    funnel: { public_id: "lgf_01H" },
    variant: { public_id: "lgfv_01H", variant_label: "B" },
    auction_config_id: "lga_01H",
    offer: { offer_id: "lgo_01H", offer_name: "Term Life Direct" },
    placement: "lgpl_01H",
    now: NOW,
    ...overrides,
  };
}

function schemaWith(nodes: LeadgenPayloadNode[]): LeadgenPayloadSchema {
  return { version: 1, root: { type: "object", children: nodes } };
}

describe("buildLeadgenRuntimeContext — slice construction (§4.1/§4.2)", () => {
  it("fills identity fields from opts (string refs and row refs both work)", () => {
    const ctx = buildLeadgenRuntimeContext(fullRequest(), baseOpts());
    expect(ctx.session_id).toBe("sess_01H");
    expect(ctx.page_view_id).toBe("pv_01H");
    expect(ctx.funnel_attempt_id).toBe("lgfa_01H");
    expect(ctx.quote_id).toBe("lgq_01H"); // bare public id
    expect(ctx.funnel_id).toBe("lgf_01H"); // row-shaped ref
    expect(ctx.funnel_variant_id).toBe("lgfv_01H");
    expect(ctx.auction_config_id).toBe("lga_01H");
  });

  it("reads the request slice from headers + url (language = first Accept-Language tag)", () => {
    const ctx = buildLeadgenRuntimeContext(fullRequest(), baseOpts());
    expect(ctx.request).toEqual({
      ip: "203.0.113.9",
      ua: WIN_CHROME_UA,
      url: LANDING_URL,
      referer: REFERER,
      language: "en-US",
    });
  });

  it("accepts the non-standard `referrer` header spelling (M1)", () => {
    const req = makeRequest(LANDING_URL, { headers: { referrer: REFERER } });
    const ctx = buildLeadgenRuntimeContext(req, baseOpts());
    expect(ctx.request.referer).toBe(REFERER);
  });

  it("reads the cloudflare slice through the shared cf reader (regionCode→region/state)", () => {
    const ctx = buildLeadgenRuntimeContext(fullRequest(), baseOpts());
    expect(ctx.cloudflare).toEqual({
      country: "US",
      region: "CA",
      state: "CA",
      city: "Los Angeles",
      postalCode: "90001",
      timezone: "America/Los_Angeles",
      colo: "LAX",
    });
  });

  it("falls back to the region display name when regionCode is absent (geoFromCf parity)", () => {
    const req = makeRequest(LANDING_URL, { cf: { country: "DE", region: "Bavaria" } });
    const ctx = buildLeadgenRuntimeContext(req, baseOpts());
    expect(ctx.cloudflare.state).toBe("Bavaria");
    expect(ctx.cloudflare.region).toBe("Bavaria");
  });

  it("reads traffic params from the landing URL and derives fbc from fbclid (fb.1.<now>.<fbclid>)", () => {
    const ctx = buildLeadgenRuntimeContext(fullRequest(), baseOpts());
    expect(ctx.traffic).toEqual({
      utm_source: "fb",
      utm_medium: "paid",
      utm_content: "creative7",
      utm_campaign: "spring_life",
      traffic_source: "meta",
      placement: "feed_top",
      sub1: "s1",
      sub2: "s2",
      sub3: "s3",
      sub4: "s4",
      sub5: "s5",
      cpc: "1.25",
      fbclid: "CLICK123",
      fbc: `fb.1.${NOW}.CLICK123`,
    });
  });

  it("preserves an explicit fbc param over the fbclid derivation", () => {
    const req = makeRequest("https://funnel.example.com/lp?fbclid=CLICK123&fbc=fb.1.111.CLICK123");
    const ctx = buildLeadgenRuntimeContext(req, baseOpts());
    expect(ctx.traffic.fbc).toBe("fb.1.111.CLICK123");
  });

  it("populates the offer slice; opts.placement (the placement in scope) wins over offer.placement_id", () => {
    const ctx = buildLeadgenRuntimeContext(fullRequest(), baseOpts());
    expect(ctx.offer).toEqual({
      offer_id: "lgo_01H",
      offer_name: "Term Life Direct",
      placement_id: "lgpl_01H",
    });

    const fromOfferRow = buildLeadgenRuntimeContext(
      fullRequest(),
      baseOpts({ placement: undefined, offer: { offer_id: "lgo_01H", placement_id: "lgpl_77" } }),
    );
    expect(fromOfferRow.offer?.placement_id).toBe("lgpl_77");

    const noOffer = buildLeadgenRuntimeContext(
      fullRequest(),
      baseOpts({ offer: undefined, placement: undefined }),
    );
    expect(noOffer.offer).toBeUndefined();
  });

  it("eagerly populates all 12 computed keys over the ONE captured now + visitor timezone", () => {
    const ctx = buildLeadgenRuntimeContext(fullRequest(), baseOpts());
    expect(Object.keys(ctx.computed)).toHaveLength(12);
    expect(ctx.computed["request_timestamp"]).toBe(1783519200);
    expect(ctx.computed["request_timestamp_ms"]).toBe(NOW);
    expect(ctx.computed["iso_timestamp"]).toBe("2026-07-08T14:00:00.123Z");
    expect(ctx.computed["timezone"]).toBe("America/Los_Angeles");
  });

  it("accepts a Hono-shaped source ({req:{raw}}) identically to a plain Request", () => {
    const req = fullRequest();
    const direct = buildLeadgenRuntimeContext(req, baseOpts());
    const honoShaped = buildLeadgenRuntimeContext({ req: { raw: req } }, baseOpts());
    expect(honoShaped).toEqual(direct);
  });

  it("is pure: same request + opts (same now) ⇒ deep-equal contexts", () => {
    const req = fullRequest();
    expect(buildLeadgenRuntimeContext(req, baseOpts())).toEqual(
      buildLeadgenRuntimeContext(req, baseOpts()),
    );
  });
});

describe("contextToMacros — the canonical-macro projection table (§4.3)", () => {
  it("emits EVERY canonical macro with its expected context source", () => {
    const ctx = buildLeadgenRuntimeContext(fullRequest(), baseOpts());

    // The full per-macro expectation table — one row per canonical macro.
    const expected: Record<string, string> = {
      click_id: "", // click-scoped: minted at /lg/lc only, documented-empty here
      utm_medium: "paid", // traffic
      utm_content: "creative7", // traffic
      // OWNER 2026-09-01: the fourth standard UTM, captured like the other three
      utm_campaign: "spring_life", // traffic
      utm_source: "fb", // traffic
      traffic_source: "meta", // traffic
      placement: "lgpl_01H", // §4.5: Offer placement in scope WINS over traffic param
      lander_v: "B", // variant_label via opts
      offer_id: "lgo_01H", // offer
      offer_name: "Term Life Direct", // offer
      page: "/best-life-quotes", // pathname of request.url
      device: "desktop", // parseClientUa(ua)
      os: "windows", // parseClientUa(ua)
      os_version: "10.0", // parseClientUa(ua)
      browser: "chrome", // parseClientUa(ua)
      browser_version: "125.0.0.0", // parseClientUa(ua)
      country: "US", // cloudflare
      state: "CA", // cloudflare (regionCode)
      city: "Los Angeles", // cloudflare
      ip: "203.0.113.9", // request
      ua: WIN_CHROME_UA, // request
      sub1: "s1", // traffic
      sub2: "s2", // traffic
      sub3: "s3", // traffic
      sub4: "s4", // traffic
      sub5: "s5", // traffic
      url: LANDING_URL, // request (full URL)
      referer: REFERER, // request
      language: "en-US", // request
      cpc: "1.25", // traffic
      session_id: "sess_01H", // session
      fbc: `fb.1.${NOW}.CLICK123`, // traffic (derived)
      fbclid: "CLICK123", // traffic
      feed_name: "", // M10 routing-outcome stamp: documented-empty here, baseOpts() passes no feed_name
    };

    // The table itself is TOTAL over the registry (no macro left unasserted).
    expect(Object.keys(expected).sort()).toEqual([...CANONICAL_MACROS].sort());
    expect(Object.keys(ctx.macros).sort()).toEqual([...CANONICAL_MACROS].sort());
    for (const name of CANONICAL_MACROS) {
      expect(ctx.macros[name], `macro {${name}}`).toBe(expected[name]);
    }
  });

  it("placement precedence (§4.5): traffic-param placement applies ONLY with no Offer placement", () => {
    const noOfferPlacement = buildLeadgenRuntimeContext(
      fullRequest(),
      baseOpts({ placement: undefined, offer: { offer_id: "lgo_01H" } }),
    );
    expect(noOfferPlacement.macros["placement"]).toBe("feed_top");

    const neither = buildLeadgenRuntimeContext(
      makeRequest("https://funnel.example.com/lp"),
      baseOpts({ placement: undefined, offer: undefined }),
    );
    expect(neither.macros["placement"]).toBe("");
  });

  it("{referrer} resolves through alias normalization to the referer value (M1)", () => {
    const ctx = buildLeadgenRuntimeContext(fullRequest(), baseOpts());
    expect(normalizeTemplate("https://x.example/?r={referrer}")).toBe("https://x.example/?r={referer}");
    expect(findUnknownMacros("https://x.example/?r={referrer}")).toEqual([]);
    expect(resolveMacros("https://x.example/?r={referrer}", ctx.macros)).toBe(
      `https://x.example/?r=${encodeURIComponent(REFERER)}`,
    );
  });

  it("a bare request yields the documented-empty projection (no fabricated values)", () => {
    const ctx = buildLeadgenRuntimeContext(
      makeRequest("https://funnel.example.com/lp"),
      baseOpts({
        quote: "lgq_x",
        funnel: "lgf_x",
        variant: "lgfv_x", // string ref carries no variant_label
        offer: undefined,
        placement: undefined,
        auction_config_id: undefined,
      }),
    );
    const nonEmpty: Record<string, string> = {
      page: "/lp",
      url: "https://funnel.example.com/lp",
      session_id: "sess_01H",
    };
    expect(Object.keys(ctx.macros).sort()).toEqual([...CANONICAL_MACROS].sort());
    for (const name of CANONICAL_MACROS) {
      expect(ctx.macros[name], `macro {${name}}`).toBe(nonEmpty[name] ?? "");
    }
    // Empty UA never fabricates a device family ("desktop"/"other").
    expect(ctx.macros["device"]).toBe("");
    expect(ctx.macros["browser"]).toBe("");
  });

  it("is exported standalone: projecting an already-built context is stable", () => {
    const ctx = buildLeadgenRuntimeContext(fullRequest(), baseOpts());
    expect(contextToMacros(ctx, { variant_label: "B" })).toEqual(ctx.macros);
  });
});

describe("opts.overrides — B5 simulated context (Test tool only)", () => {
  it("applies a flat override bag over the request/cloudflare/traffic slices before projection", () => {
    const ctx = buildLeadgenRuntimeContext(
      fullRequest(),
      baseOpts({ overrides: { country: "DE", ip: "198.51.100.7", utm_source: "sim_src" } }),
    );
    expect(ctx.cloudflare.country).toBe("DE");
    expect(ctx.request.ip).toBe("198.51.100.7");
    expect(ctx.traffic.utm_source).toBe("sim_src");
    // ...and the macros reflect the overridden slices.
    expect(ctx.macros["country"]).toBe("DE");
    expect(ctx.macros["ip"]).toBe("198.51.100.7");
    expect(ctx.macros["utm_source"]).toBe("sim_src");
    // Untouched values survive.
    expect(ctx.macros["city"]).toBe("Los Angeles");
    expect(ctx.macros["utm_medium"]).toBe("paid");
  });

  it("an overridden fbclid feeds the fbc derivation; an overridden timezone feeds computed", () => {
    const ctx = buildLeadgenRuntimeContext(
      makeRequest("https://funnel.example.com/lp"),
      baseOpts({ overrides: { fbclid: "SIM99", timezone: "Europe/Paris" } }),
    );
    expect(ctx.traffic.fbc).toBe(`fb.1.${NOW}.SIM99`);
    expect(ctx.macros["fbc"]).toBe(`fb.1.${NOW}.SIM99`);
    expect(ctx.computed["timezone"]).toBe("Europe/Paris");
  });
});

describe('payload source:"placement" (§4.5 storage extension)', () => {
  const placementNode = (extra: Partial<LeadgenPayloadNode> = {}): LeadgenPayloadNode => ({
    path: "data.placement_id",
    name: "placement_id",
    type: "string",
    source: "placement",
    ...extra,
  });

  it("validatePayloadSchema accepts source:'placement' (canonical v2.4 enum)", () => {
    const result = validatePayloadSchema(schemaWith([placementNode()]));
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("the source_invalid catalog now lists the six canonical sources", () => {
    const bad = schemaWith([{ path: "b", name: "b", type: "string", source: "cookie" as never }]);
    const error = validatePayloadSchema(bad).errors.find((e) => e.code === "source_invalid");
    expect(error?.message).toContain("answer|static|computed|macro|placement|token");
  });

  it("resolves from ctx.offer.placement_id", () => {
    const payload = buildPayload(schemaWith([placementNode()]), {
      answers: {},
      offer: { placement_id: "lgpl_9" },
    });
    expect(payload).toEqual({ data: { placement_id: "lgpl_9" } });
  });

  it("missing or empty placement routes through absent→default", () => {
    const schema = schemaWith([placementNode({ default: "none" })]);
    expect(buildPayload(schema, { answers: {} })).toEqual({ data: { placement_id: "none" } });
    expect(buildPayload(schema, { answers: {}, offer: {} })).toEqual({
      data: { placement_id: "none" },
    });
    expect(buildPayload(schema, { answers: {}, offer: { placement_id: "" } })).toEqual({
      data: { placement_id: "none" },
    });
    // No default ⇒ the node is simply omitted (never a crash).
    expect(buildPayload(schemaWith([placementNode()]), { answers: {} })).toEqual({});
  });

  it("an invalid (uncoercible) placement routes through invalid→fallback", () => {
    const schema = schemaWith([
      placementNode({ path: "data.slot", name: "slot", type: "number", fallback: 0 }),
    ]);
    expect(buildPayload(schema, { answers: {}, offer: { placement_id: "lgpl_9" } })).toEqual({
      data: { slot: 0 },
    });
  });

  it("bridges end-to-end from the canonical runtime context (macro + computed + placement)", () => {
    const ctx = buildLeadgenRuntimeContext(fullRequest(), baseOpts());
    const schema = schemaWith([
      { path: "meta.session", name: "session", type: "string", source: "macro", macro: "session_id" },
      { path: "meta.ts", name: "ts", type: "number", source: "computed", computed: "request_timestamp" },
      placementNode({ path: "meta.placement_id", name: "placement_id" }),
    ]);
    expect(validatePayloadSchema(schema).ok).toBe(true);
    const payload = buildPayload(schema, {
      answers: {},
      macros: ctx.macros,
      computed: ctx.computed,
      offer: ctx.offer,
    });
    expect(payload).toEqual({
      meta: { session: "sess_01H", ts: 1783519200, placement_id: "lgpl_01H" },
    });
  });
});
