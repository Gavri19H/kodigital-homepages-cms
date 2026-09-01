// OWNER 2026-09-01: "In the 'Leadgen' --> 'Offers' --> 'Payload' --> 'Source'
// --> add 'utm_campaign'" (screenshots: the Source dropdown's Traffic / URL
// group listed utm_source, utm_medium, utm_content, Traffic source, Placement,
// sub1-5, CPC, fbclid, fbc — and no utm_campaign).
//
// WHAT WAS ACTUALLY WRONG — bigger than a missing dropdown row. utm_campaign
// was absent from the WHOLE vocabulary:
//   * runtime-context.ts TRAFFIC_PARAM_KEYS never read it off the landing URL,
//     so the value did not exist anywhere in the request context;
//   * macros.ts CANONICAL_MACROS did not carry it, so no payload field and no
//     banner URL template could reference it (a schema save would reject it);
//   * and the RULES layer offered a "UTM Campaign" dimension that silently
//     evaluated utm_content — resolver.ts's own comment called it a
//     "documented substitution" and entryFlatCtx assigned it utm_content's
//     value. An operator routing on the campaign was testing the creative id.
//
// Checked before changing that alias: 0 rows in leadgen_auction_rules /
// leadgen_funnel_rules / leadgen_quote_routing_rules referenced utm_campaign in
// production, so no existing rule's meaning moved.
//
// These tests drive the REAL chain: landing URL -> runtime context -> canonical
// macros -> the payload a buyer receives, plus the rule-evaluation context.
import { describe, expect, it } from "vitest";
import { buildLeadgenRuntimeContext, contextToMacros } from "../src/leadgen/runtime-context";
import { CANONICAL_MACROS, isCanonicalMacro } from "../src/leadgen/macros";
import { buildPayload, validatePayloadSchema } from "../src/leadgen/payload";
import { parseUtmFromLandingUrl, ENTRY_KNOWN_SLOT_FIELDS } from "../src/public/leadgen/resolver";
import { ENTRY_KNOWN_ROUTING_FIELDS } from "../src/leadgen/rule-checkpoint";
import { PAYLOAD_SOURCE_GROUPS } from "../src/admin/leadgen/ui-payload-builder";

const LANDING =
  "https://insurissimo.com/lg/home-insurance?utm_source=facebook&utm_medium=paid_social" +
  "&utm_campaign=summer_sale&utm_content=ad_variant_a";

function ctxFor(url: string) {
  return buildLeadgenRuntimeContext(new Request(url, { headers: { "user-agent": "Mozilla/5.0 (iPhone)" } }), {
    session_id: "sess_1",
    page_view_id: "pv_1",
    funnel_attempt_id: "lgfa_1",
    quote: "lgq_1",
    funnel: "lgf_1",
    variant: "lgfv_1",
    now: 1_783_468_800_000,
  });
}

// The §11.5 normative schema shape: { version, root:{ type:"object", children } }
// with a dotted `path` per node.
function macroSchema(...macros: readonly string[]) {
  return {
    version: 1,
    root: {
      type: "object" as const,
      children: macros.map((m) => ({ path: m, name: m, type: "string" as const, source: "macro" as const, macro: m })),
    },
  };
}

describe("utm_campaign reaches the buyer (OWNER 2026-09-01)", () => {
  it("is read off the landing URL as its own param, beside the other three", () => {
    const traffic = ctxFor(LANDING).traffic;
    expect(traffic.utm_source).toBe("facebook");
    expect(traffic.utm_medium).toBe("paid_social");
    expect(traffic.utm_content).toBe("ad_variant_a");
    expect(traffic.utm_campaign).toBe("summer_sale");
  });

  it("projects into the canonical macros — the campaign, not the creative id", () => {
    const macros = contextToMacros(ctxFor(LANDING));
    expect(macros["utm_campaign"]).toBe("summer_sale");
    expect(macros["utm_content"]).toBe("ad_variant_a");
    // absent param ⇒ empty string, never fabricated and never borrowed from a
    // neighbouring UTM (the substitution this fix removed)
    const bare = contextToMacros(ctxFor("https://insurissimo.com/lg/home-insurance?utm_content=only_content"));
    expect(bare["utm_campaign"]).toBe("");
    expect(bare["utm_content"]).toBe("only_content");
  });

  it("is a canonical macro, so a payload schema that references it SAVES", () => {
    expect(CANONICAL_MACROS).toContain("utm_campaign");
    expect(isCanonicalMacro("utm_campaign")).toBe(true);
    const v = validatePayloadSchema(macroSchema("utm_campaign"));
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it("END TO END: the landing URL's campaign lands in the payload the buyer receives", () => {
    const schema = macroSchema("utm_campaign", "utm_content");
    expect(validatePayloadSchema(schema).ok).toBe(true);
    // the macros come from the REAL context builder over the REAL landing URL —
    // neither side of this boundary is hand-built
    const body = buildPayload(schema, { answers: {}, macros: contextToMacros(ctxFor(LANDING)) });
    expect(body).toEqual({ utm_campaign: "summer_sale", utm_content: "ad_variant_a" });
  });

  it("the payload builder's Source dropdown offers it under Traffic / URL", () => {
    const traffic = PAYLOAD_SOURCE_GROUPS.find((g) => g.group === "Traffic / URL");
    if (traffic === undefined) throw new Error("no Traffic / URL source group");
    // members carry the picker's option VALUE — "macro:<name>"
    const values = traffic.members.map((m) => m.value);
    expect(values).toContain("macro:utm_campaign");
    // it sits with the other UTMs, not appended after the sub-ids
    expect(values.indexOf("macro:utm_campaign")).toBe(values.indexOf("macro:utm_content") + 1);
  });
});

describe("the rules layer stops substituting utm_content for the campaign", () => {
  it("both rule field registries carry utm_campaign", () => {
    expect(ENTRY_KNOWN_SLOT_FIELDS.has("utm_campaign")).toBe(true);
    expect(ENTRY_KNOWN_ROUTING_FIELDS.has("utm_campaign")).toBe(true);
  });

  it("parseUtmFromLandingUrl returns the campaign itself", () => {
    expect(parseUtmFromLandingUrl(LANDING)).toEqual({
      utm_source: "facebook",
      utm_medium: "paid_social",
      utm_content: "ad_variant_a",
      utm_campaign: "summer_sale",
    });
    // a URL with a campaign and NO content: the old mirror would have made a
    // campaign rule see "" while a content rule saw "" too — now they differ
    expect(parseUtmFromLandingUrl("https://x.example/lg/a?utm_campaign=only_campaign")).toEqual({
      utm_campaign: "only_campaign",
    });
    expect(parseUtmFromLandingUrl("not a url")).toEqual({});
  });
});
