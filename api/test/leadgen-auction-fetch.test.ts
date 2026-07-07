// LeadGen Phase 10 STAGE A — per-Offer provider fetch (contract 07 §19 steps
// 6-7). MOCKED outbound fetch (vi.stubGlobal). Proves: the success shape, the
// full error taxonomy each mapping to the right typed error_reason with NO
// throw (timeout via AbortError AND via the Promise.race timer, non-2xx,
// network, malformed), header static/macro/secret_ref resolution + secret
// MASKED in the redacted log shape + absent-secret typed no-op, token
// placement header/payload/query (real secret SENT, [REDACTED] in the log
// shape), and fetchProvidersParallel (allSettled: one timeout never sinks the
// batch). Mirrors the §11.6 Test-tool proxy's request build + masking exactly.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import {
  fetchProvider,
  fetchProvidersParallel,
  type FetchProviderContext,
  type ParallelProviderRequest,
} from "../src/public/leadgen/auction/fetch";
import type { LeadgenOfferRow, LeadgenOfferHeaderRow } from "../src/admin/leadgen/db-types";
import type { LeadgenPayloadSchema } from "../src/leadgen/payload";
import { sha256Hex } from "../src/public/leadgen/auction/parse";

const PROVIDER_TOKEN = "tok-SECRET-123";
const HEADER_SECRET = "hdr-SECRET-456";

function buildEnv(extra: Record<string, string> = {}): Env {
  return {
    LEADGEN_TEST_PROVIDER_TOKEN: PROVIDER_TOKEN,
    LEADGEN_TEST_HEADER_SECRET: HEADER_SECRET,
    ...extra,
  } as unknown as Env;
}

// A fully-formed dynamic server-mode Offer row; override per test.
function makeOffer(overrides: Partial<LeadgenOfferRow> = {}): LeadgenOfferRow {
  return {
    id: 1,
    public_id: "lgo_test",
    offer_name: "Dyn Offer",
    provider: null,
    activity: "quote_funnel",
    vertical: "life",
    tag: null,
    conversion_tracking_method: "s2s_postback",
    offer_type: "cpc",
    calls_provider_api: 1,
    bid_source: "response",
    request_execution_mode: "server",
    static_bid_value: null,
    static_bid_currency: null,
    static_order: null,
    banner_url_template: null,
    static_fallback_banner_url: null,
    request_method: "POST",
    endpoint_production: "https://api.provider.example.com/quotes",
    endpoint_staging: "https://staging.provider.example.com/quotes",
    api_token_secret_ref: "LEADGEN_TEST_PROVIDER_TOKEN",
    api_token_placement: "header",
    api_token_param_name: "X-Api-Token",
    active_payload_schema_id: 10,
    cap_enabled: 0,
    cap_amount: null,
    cap_timezone: null,
    cap_count_by: null,
    cap_fallback_offer_id: null,
    cap_fallback_url: null,
    status: "active",
    created_by: null,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

function makeHeaders(): LeadgenOfferHeaderRow[] {
  return [
    { id: 1, offer_id: 1, header_name: "X-Static", value_kind: "static", value_text: "fixed-value", created_at: 0 },
    { id: 2, offer_id: 1, header_name: "X-Macro", value_kind: "macro", value_text: "{offer_id}", created_at: 0 },
    { id: 3, offer_id: 1, header_name: "X-Secret", value_kind: "secret_ref", value_text: "LEADGEN_TEST_HEADER_SECRET", created_at: 0 },
  ];
}

function makeSchema(withTokenNode = false): LeadgenPayloadSchema {
  const children: LeadgenPayloadSchema["root"]["children"] = [
    { path: "contact.email", name: "email", type: "string", required: true, source: "answer", internal_field: "email" },
    { path: "meta.offer", name: "offer", type: "string", source: "macro", macro: "offer_id" },
    { path: "plan", name: "plan", type: "string", source: "static", value: "gold" },
  ];
  if (withTokenNode) {
    children.push({ path: "auth.api_token", name: "api_token", type: "string", source: "token" });
  }
  return { version: 1, root: { type: "object", children } };
}

function makeCtx(overrides: Partial<FetchProviderContext> = {}): FetchProviderContext {
  return {
    answers: { email: " John@X.com " },
    macros: { offer_id: "lgo_test" },
    timeout_ms: 2500,
    carrier_parse_version: 1,
    placement_public_id: "lgpl_1",
    ...overrides,
  };
}

interface CapturedFetch {
  url: string;
  init: RequestInit;
}

function stubFetch(handler: (url: string, init: RequestInit) => Promise<Response> | Response): CapturedFetch[] {
  const calls: CapturedFetch[] = [];
  vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const captured = { url: String(url), init: init ?? {} };
    calls.push(captured);
    return handler(captured.url, captured.init);
  });
  return calls;
}

const PROVIDER_BODY = { carriers: [{ name: "Acme Life", bid: 3.2, url: "https://p.example.com/click" }], email: "lead@x.com" };

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// success + secret masking
// ---------------------------------------------------------------------------

describe("fetchProvider — success + secret masking (§11.6 mirror / §30.2)", () => {
  it("sends real secrets OUTBOUND, returns a typed success result, masks every secret byte in the log shape", async () => {
    const calls = stubFetch(() => new Response(JSON.stringify(PROVIDER_BODY), { status: 200 }));
    const result = await fetchProvider(buildEnv(), makeOffer(), makeHeaders(), makeSchema(), makeCtx(), "staging");

    // outbound: real secret header + token header + resolved macro + static
    expect(calls).toHaveLength(1);
    const sent = calls[0];
    expect(sent?.url).toBe("https://staging.provider.example.com/quotes");
    expect(sent?.init.method).toBe("POST");
    const sentHeaders = sent?.init.headers as Record<string, string>;
    expect(sentHeaders["X-Static"]).toBe("fixed-value");
    expect(sentHeaders["X-Macro"]).toBe("lgo_test"); // {offer_id} resolved
    expect(sentHeaders["X-Secret"]).toBe(HEADER_SECRET); // real secret SENT
    expect(sentHeaders["X-Api-Token"]).toBe(PROVIDER_TOKEN); // real token SENT
    expect(sentHeaders["content-type"]).toBe("application/json");
    expect(sent?.init.signal).toBeInstanceOf(AbortSignal); // bounded-timeout wiring

    // typed success result
    expect(result.status).toBe(200);
    expect(result.error_reason).toBeNull();
    expect(result.timed_out).toBe(false);
    expect(result.parsed).toEqual(PROVIDER_BODY);
    expect(result.body).toBe(JSON.stringify(PROVIDER_BODY));
    expect(typeof result.provider_request_id).toBe("string");
    expect(result.provider_request_id.length).toBeGreaterThan(0);
    expect(result.notes).toEqual([]);

    // §30.2: the redacted LOG SHAPE masks every secret and hashes response PII
    const loggedHeaders = JSON.parse(result.redacted_log.request_headers_redacted_json) as Record<string, string>;
    expect(loggedHeaders["X-Static"]).toBe("fixed-value");
    expect(loggedHeaders["X-Macro"]).toBe("lgo_test");
    expect(loggedHeaders["X-Secret"]).toBe("[REDACTED]");
    expect(loggedHeaders["X-Api-Token"]).toBe("[REDACTED]");
    const loggedResponse = JSON.parse(String(result.redacted_log.response_redacted_json)) as { email: string };
    expect(loggedResponse.email).toBe(`sha256:${sha256Hex("lead@x.com")}`); // §30.3 PII hash

    // THE masking proof: no secret VALUE anywhere in the returned log shape
    const logBytes = JSON.stringify(result.redacted_log);
    expect(logBytes).not.toContain(PROVIDER_TOKEN);
    expect(logBytes).not.toContain(HEADER_SECRET);
    expect(result.redacted_log.carrier_parse_version).toBe(1);
    expect(result.redacted_log.placement_public_id).toBe("lgpl_1");
    expect(result.redacted_log.environment).toBe("staging");

    // the FULL debug record (encrypt-only) DOES carry the real bytes
    expect(result.debug.request_headers["X-Api-Token"]).toBe(PROVIDER_TOKEN);
    expect(result.debug.url).toBe("https://staging.provider.example.com/quotes");
  });

  it("routes environment=production to the production endpoint", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    const result = await fetchProvider(buildEnv(), makeOffer(), makeHeaders(), makeSchema(), makeCtx(), "production");
    expect(calls[0]?.url).toBe("https://api.provider.example.com/quotes");
    expect(result.environment).toBe("production");
  });
});

// ---------------------------------------------------------------------------
// error taxonomy — never throws
// ---------------------------------------------------------------------------

describe("fetchProvider — error taxonomy (never throws)", () => {
  it("non-2xx → error_reason http_<status>", async () => {
    stubFetch(() => new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    const result = await fetchProvider(buildEnv(), makeOffer(), makeHeaders(), makeSchema(), makeCtx(), "staging");
    expect(result.status).toBe(500);
    expect(result.error_reason).toBe("http_500");
    expect(result.redacted_log.provider_error_reason).toBe("http_500");
  });

  it("an aborted fetch (AbortError) → timeout, status null, no throw", async () => {
    stubFetch(() => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    });
    const result = await fetchProvider(buildEnv(), makeOffer(), makeHeaders(), makeSchema(), makeCtx(), "staging");
    expect(result.status).toBeNull();
    expect(result.error_reason).toBe("timeout");
    expect(result.timed_out).toBe(true);
    expect(typeof result.error_text).toBe("string");
  });

  it("a slow provider is dropped at the Promise.race timer → timeout (never blocks)", async () => {
    stubFetch(() => new Promise<Response>(() => {})); // never resolves
    const result = await fetchProvider(
      buildEnv(),
      makeOffer(),
      makeHeaders(),
      makeSchema(),
      makeCtx({ timeout_ms: 15 }),
      "staging",
    );
    expect(result.error_reason).toBe("timeout");
    expect(result.timed_out).toBe(true);
    expect(result.status).toBeNull();
  });

  it("a network failure → network_error", async () => {
    stubFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    const result = await fetchProvider(buildEnv(), makeOffer(), makeHeaders(), makeSchema(), makeCtx(), "staging");
    expect(result.error_reason).toBe("network_error");
    expect(result.timed_out).toBe(false);
  });

  it("a 200 non-JSON body → malformed_response, parsed undefined", async () => {
    stubFetch(() => new Response("<html>oops</html>", { status: 200 }));
    const result = await fetchProvider(buildEnv(), makeOffer(), makeHeaders(), makeSchema(), makeCtx(), "staging");
    expect(result.status).toBe(200);
    expect(result.error_reason).toBe("malformed_response");
    expect(result.parsed).toBeUndefined();
    expect(result.body).toBe("<html>oops</html>");
    expect(result.redacted_log.response_redacted_json).toBeNull();
  });

  it("a missing endpoint for the chosen environment → no_endpoint, NO fetch", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    const offer = makeOffer({ endpoint_staging: null });
    const result = await fetchProvider(buildEnv(), offer, makeHeaders(), makeSchema(), makeCtx(), "staging");
    expect(result.error_reason).toBe("no_endpoint");
    expect(result.status).toBeNull();
    expect(calls).toHaveLength(0); // never fetched
  });
});

// ---------------------------------------------------------------------------
// header + token resolution
// ---------------------------------------------------------------------------

describe("fetchProvider — header + token resolution (§11.3-11.4 / §30.2)", () => {
  it("absent secret ⇒ typed no-op note, the leg is NOT sent, the request still fires", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    const offer = makeOffer({ api_token_secret_ref: "LEADGEN_MISSING_TOKEN" });
    const headers: LeadgenOfferHeaderRow[] = [
      { id: 1, offer_id: 1, header_name: "X-Secret", value_kind: "secret_ref", value_text: "LEADGEN_MISSING_HDR", created_at: 0 },
    ];
    const result = await fetchProvider(buildEnv(), offer, headers, makeSchema(), makeCtx(), "staging");

    expect(calls).toHaveLength(1); // never a throw
    const sentHeaders = calls[0]?.init.headers as Record<string, string>;
    expect(sentHeaders["X-Secret"]).toBeUndefined();
    expect(sentHeaders["X-Api-Token"]).toBeUndefined();
    expect(result.notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: "token", code: "secret_absent", secret_ref: "LEADGEN_MISSING_TOKEN" }),
        expect.objectContaining({ scope: "header", code: "secret_absent", header_name: "X-Secret" }),
      ]),
    );
  });

  it("query placement: real token in the OUTBOUND url; the token VALUE is absent from the log shape", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    const offer = makeOffer({ api_token_placement: "query", api_token_param_name: "token" });
    const result = await fetchProvider(buildEnv(), offer, makeHeaders(), makeSchema(), makeCtx(), "staging");

    expect(calls[0]?.url).toBe(`https://staging.provider.example.com/quotes?token=${encodeURIComponent(PROVIDER_TOKEN)}`);
    // the provider_request_log row has NO url column → the token cannot leak there
    expect(JSON.stringify(result.redacted_log)).not.toContain(PROVIDER_TOKEN);
    expect(result.debug.url).toContain(encodeURIComponent(PROVIDER_TOKEN)); // encrypt-only record
  });

  it("payload placement: token node carries the real value outbound, [REDACTED] at its path in the log shape", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    const offer = makeOffer({ api_token_placement: "payload" });
    const result = await fetchProvider(buildEnv(), offer, makeHeaders(), makeSchema(true), makeCtx(), "staging");

    const sentPayload = JSON.parse(String(calls[0]?.init.body)) as { auth: { api_token: string } };
    expect(sentPayload.auth.api_token).toBe(PROVIDER_TOKEN); // real value SENT

    const loggedPayload = JSON.parse(result.redacted_log.request_payload_redacted_json) as { auth: { api_token: string } };
    expect(loggedPayload.auth.api_token).toBe("[REDACTED]"); // masked at its schema path
    expect(JSON.stringify(result.redacted_log)).not.toContain(PROVIDER_TOKEN);
    expect((result.debug.request_payload as { auth: { api_token: string } }).auth.api_token).toBe(PROVIDER_TOKEN);
  });

  it("header placement with no api_token_param_name → typed note, token not attached", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    const offer = makeOffer({ api_token_placement: "header", api_token_param_name: null });
    const result = await fetchProvider(buildEnv(), offer, makeHeaders(), makeSchema(), makeCtx(), "staging");
    expect(result.notes).toEqual(
      expect.arrayContaining([expect.objectContaining({ scope: "token", code: "token_param_name_missing" })]),
    );
    const sentHeaders = calls[0]?.init.headers as Record<string, string>;
    expect(JSON.stringify(sentHeaders)).not.toContain(PROVIDER_TOKEN);
  });
});

// ---------------------------------------------------------------------------
// fetchProvidersParallel — §19 step 7 grouping
// ---------------------------------------------------------------------------

describe("fetchProvidersParallel — §19 step 7 (allSettled, one timeout never sinks the batch)", () => {
  it("runs the set under ONE auction_request_id; a slow provider times out while the others succeed", async () => {
    // provider A: fast 200; provider B: never resolves (times out); provider C: fast 200
    vi.stubGlobal("fetch", async (url: RequestInfo | URL): Promise<Response> => {
      if (String(url).includes("slow")) return new Promise<Response>(() => {});
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const reqs: ParallelProviderRequest[] = [
      { offer: makeOffer({ public_id: "lgo_a", endpoint_staging: "https://a.example.com/x" }), headers: [], payloadSchema: makeSchema(), ctx: makeCtx({ timeout_ms: 15 }) },
      { offer: makeOffer({ public_id: "lgo_b", endpoint_staging: "https://slow.example.com/x" }), headers: [], payloadSchema: makeSchema(), ctx: makeCtx({ timeout_ms: 15 }) },
      { offer: makeOffer({ public_id: "lgo_c", endpoint_staging: "https://c.example.com/x" }), headers: [], payloadSchema: makeSchema(), ctx: makeCtx({ timeout_ms: 15 }) },
    ];

    const batch = await fetchProvidersParallel(buildEnv(), reqs, "staging");
    expect(typeof batch.auction_request_id).toBe("string");
    expect(batch.results).toHaveLength(3);
    expect(batch.results[0]?.offer_public_id).toBe("lgo_a");
    expect(batch.results[0]?.status).toBe(200);
    expect(batch.results[1]?.offer_public_id).toBe("lgo_b");
    expect(batch.results[1]?.error_reason).toBe("timeout"); // dropped, did NOT sink the batch
    expect(batch.results[2]?.status).toBe(200);
    // every provider_request_id is distinct within the group
    const ids = new Set(batch.results.map((r) => r.provider_request_id));
    expect(ids.size).toBe(3);
  });

  it("honors an injected auction_request_id (Stage B grouping)", async () => {
    stubFetch(() => new Response("{}", { status: 200 }));
    const batch = await fetchProvidersParallel(
      buildEnv(),
      [{ offer: makeOffer(), headers: [], payloadSchema: makeSchema(), ctx: makeCtx() }],
      "staging",
      { auctionRequestId: "areq_fixed" },
    );
    expect(batch.auction_request_id).toBe("areq_fixed");
  });
});
