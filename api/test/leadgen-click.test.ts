// LeadGen Phase 11 STAGE A — /lg/lc click resolver logic (contract 07 §19 step
// 16, 04 §10.5 required/optional response macros, 04 §10.6 cap-on-click, 07
// §18.7 remove-clicked, 08 §22.3 carrier_click/offer_click).
//
// Proves the resolve→mint→side-effects flow: canonical + {response:*} macro
// resolution with the freshly-minted {click_id} injected; the lgl_ click_id;
// cap increment ONLY for cap_count_by='clicks'; the remove-clicked row written
// with the correct removal_scope; carrier_click + offer_click emitted; a 302
// target on success; NEVER a 302 to a javascript:/non-http URL; a required
// {response:*} macro missing at click time → safe no-redirect.

import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { resolveLeadgenClick, type LeadgenClickInput } from "../src/public/leadgen/click";
import type { LeadgenCapOffer } from "../src/leadgen/caps";
import type { LeadgenParsedCarrier } from "../src/public/leadgen/auction/parse";

// --- harness -------------------------------------------------------------------

interface DbCall {
  sql: string;
  binds: unknown[];
}

function makeDb(): { db: D1Database; calls: DbCall[] } {
  const calls: DbCall[] = [];
  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          binds = a;
          return stmt;
        },
        async first() {
          return null;
        },
        async all() {
          return { results: [], success: true, meta: {} };
        },
        async run() {
          calls.push({ sql, binds });
          return { success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, calls };
}

function makeEnv(db: D1Database): Env {
  // No AWS creds / stream → emitLeadgenRecords is a structured no-op; the built
  // events are asserted via the returned result.events.
  return { DB: db, APP_ENV: "test" } as unknown as Env;
}

function ctxStub(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext;
}

function capOffer(overrides: Partial<LeadgenCapOffer> = {}): LeadgenCapOffer {
  return {
    id: 5,
    cap_enabled: 1,
    cap_amount: 100,
    cap_timezone: "UTC",
    cap_count_by: "clicks",
    cap_fallback_offer_id: null,
    cap_fallback_url: null,
    ...overrides,
  };
}

function carrier(overrides: Partial<LeadgenParsedCarrier> = {}): LeadgenParsedCarrier {
  return {
    carrier_key: "acme",
    carrier_key_source: "slug",
    carrier_name: "Acme Life",
    carrier_logo: null,
    click_url: null,
    bid: 3.2,
    bid_currency: "USD",
    tracking_id: null,
    headline: null,
    subheadline: null,
    disclaimer: null,
    pricing_model: null,
    ...overrides,
  };
}

function baseInput(overrides: Partial<LeadgenClickInput> = {}): LeadgenClickInput {
  return {
    offer_public_id: "lgo_x",
    carrier_key: "acme",
    auction_instance_id: "aiid-1",
    banner_render_id: "brid-1",
    slot: 1,
    funnel_attempt_id: "fa-1",
    session_id: "sid-1",
    auction_id: 9,
    carrier: carrier(),
    banner_url_template: null,
    response_macro_fallbacks: null,
    response_context: null,
    canonical_macros: {},
    offer: capOffer(),
    removal_scope: "offer",
    now: 1_700_000_000_000,
    ...overrides,
  };
}

// --- resolution ----------------------------------------------------------------

describe("resolveLeadgenClick — URL resolution (§19 step 16 / §10.5)", () => {
  it("resolves banner_url_template with canonical + {response:*} + the injected {click_id}", async () => {
    const { db } = makeDb();
    const out = await resolveLeadgenClick(makeEnv(db), ctxStub(), baseInput({
      carrier: carrier({ click_url: null }),
      banner_url_template: "https://go.example.com/c?slug={response:slug}&promo={response:promo?}&cid={click_id}&s5={sub5}",
      response_macro_fallbacks: { promo: "none" },
      response_context: { slug: "acme" }, // promo absent → its safe_fallback
      canonical_macros: { sub5: "camp1" },
    }));
    expect(out.redirect).toBe(true);
    expect(out.click_id.startsWith("lgl_")).toBe(true);
    expect(out.destination_url).toBe(
      `https://go.example.com/c?slug=acme&promo=none&cid=${out.click_id}&s5=camp1`,
    );
    expect(out.unresolved_reason).toBeNull();
  });

  it("a usable provider http(s) click_url wins over the template", async () => {
    const { db } = makeDb();
    const out = await resolveLeadgenClick(makeEnv(db), ctxStub(), baseInput({
      carrier: carrier({ click_url: "https://p.example.com/direct?x=1" }),
      banner_url_template: "https://go.example.com/c?slug={response:slug}",
      response_context: { slug: "acme" },
    }));
    expect(out.redirect).toBe(true);
    expect(out.destination_url).toBe("https://p.example.com/direct?x=1");
  });

  it("a required {response:*} macro missing at click time → NO 302 (required_missing), events still fire", async () => {
    const { db } = makeDb();
    const out = await resolveLeadgenClick(makeEnv(db), ctxStub(), baseInput({
      carrier: carrier({ click_url: null }),
      banner_url_template: "https://go.example.com/c?slug={response:slug}",
      response_context: { other: "x" }, // slug required + MISSING
    }));
    expect(out.redirect).toBe(false);
    expect(out.destination_url).toBeNull();
    expect(out.unresolved_reason).toBe("required_missing");
    expect(out.events).toHaveLength(2); // the click still happened
  });

  it("NEVER 302s to a javascript: / non-http URL (no usable target → no_click_target)", async () => {
    const { db } = makeDb();
    const out = await resolveLeadgenClick(makeEnv(db), ctxStub(), baseInput({
      carrier: carrier({ click_url: "javascript:alert(1)" }),
      banner_url_template: null,
    }));
    expect(out.redirect).toBe(false);
    expect(out.destination_url).toBeNull();
    expect(out.unresolved_reason).toBe("no_click_target");
  });
});

// --- click_id mint -------------------------------------------------------------

describe("resolveLeadgenClick — click_id (§ids lgl_)", () => {
  it("mints an lgl_ click_id; an injected minter is honoured", async () => {
    const { db } = makeDb();
    const real = await resolveLeadgenClick(makeEnv(db), ctxStub(), baseInput({
      carrier: carrier({ click_url: "https://p.example.com/x" }),
    }));
    expect(real.click_id.startsWith("lgl_")).toBe(true);

    const injected = await resolveLeadgenClick(makeEnv(db), ctxStub(), baseInput({
      carrier: carrier({ click_url: "https://p.example.com/x" }),
      mintClickId: () => "lgl_FIXED",
    }));
    expect(injected.click_id).toBe("lgl_FIXED");
  });
});

// --- cap increment (§10.6) -----------------------------------------------------

describe("resolveLeadgenClick — cap increment on the click (§10.6)", () => {
  it("cap_count_by='clicks' → increments the offer counter", async () => {
    const { db, calls } = makeDb();
    const out = await resolveLeadgenClick(makeEnv(db), ctxStub(), baseInput({
      carrier: carrier({ click_url: "https://p.example.com/x" }),
      offer: capOffer({ cap_count_by: "clicks" }),
    }));
    expect(out.cap_incremented).toBe(true);
    const capCall = calls.find((c) => c.sql.includes("leadgen_offer_cap_counters"));
    expect(capCall).toBeDefined();
    expect(capCall?.sql).toContain("click_count"); // clicks-capped column bumps
  });

  it("cap_count_by='conversions' → does NOT increment on click", async () => {
    const { db, calls } = makeDb();
    const out = await resolveLeadgenClick(makeEnv(db), ctxStub(), baseInput({
      carrier: carrier({ click_url: "https://p.example.com/x" }),
      offer: capOffer({ cap_count_by: "conversions" }),
    }));
    expect(out.cap_incremented).toBe(false);
    expect(calls.find((c) => c.sql.includes("leadgen_offer_cap_counters"))).toBeUndefined();
  });
});

// --- remove-clicked (§18.7) ----------------------------------------------------

describe("resolveLeadgenClick — remove-clicked suppression row (§18.7)", () => {
  it("removal_scope='offer' → writes carrier_key '' (whole Offer), keyed on funnel_attempt_id", async () => {
    const { db, calls } = makeDb();
    const out = await resolveLeadgenClick(makeEnv(db), ctxStub(), baseInput({
      carrier: carrier({ click_url: "https://p.example.com/x" }),
      removal_scope: "offer",
    }));
    expect(out.clicked_recorded).toBe(true);
    const row = calls.find((c) => c.sql.includes("leadgen_session_clicked_offers"));
    expect(row).toBeDefined();
    // binds: [funnel_attempt_id, offer_id, carrier_key, session_id, auction_id, removal_scope]
    expect(row?.binds[0]).toBe("fa-1");
    expect(row?.binds[1]).toBe(5);
    expect(row?.binds[2]).toBe(""); // scope=offer → empty carrier_key
    expect(row?.binds[5]).toBe("offer");
    expect(row?.sql).toContain("ON CONFLICT");
  });

  it("removal_scope='carrier' → writes the specific carrier_key", async () => {
    const { db, calls } = makeDb();
    await resolveLeadgenClick(makeEnv(db), ctxStub(), baseInput({
      carrier: carrier({ click_url: "https://p.example.com/x" }),
      carrier_key: "acme",
      removal_scope: "carrier",
    }));
    const row = calls.find((c) => c.sql.includes("leadgen_session_clicked_offers"));
    expect(row?.binds[2]).toBe("acme");
    expect(row?.binds[5]).toBe("carrier");
  });
});

// --- events (§22.3) ------------------------------------------------------------

describe("resolveLeadgenClick — carrier_click + offer_click events (§22.3)", () => {
  it("emits both events stamped with the click_id + auction ids", async () => {
    const { db } = makeDb();
    const out = await resolveLeadgenClick(makeEnv(db), ctxStub(), baseInput({
      carrier: carrier({ click_url: "https://p.example.com/x", carrier_name: "Acme Life" }),
      mintClickId: () => "lgl_ABC",
      event_context: { funnel_id: "lgf_1", site_id: "st_1", quote_id: "lgq_1" },
    }));
    expect(out.events).toHaveLength(2);
    const carrierClick = out.events.find((e) => e.event_type === "carrier_click");
    const offerClick = out.events.find((e) => e.event_type === "offer_click");
    expect(carrierClick).toBeDefined();
    expect(offerClick).toBeDefined();
    for (const ev of out.events) {
      expect(ev.click_id).toBe("lgl_ABC");
      expect(ev.offer_id).toBe("lgo_x");
      expect(ev.carrier_key).toBe("acme");
      expect(ev.auction_instance_id).toBe("aiid-1");
      expect(ev.banner_render_id).toBe("brid-1");
      expect(ev.carrier_position).toBe(1);
      expect(ev.funnel_attempt_id).toBe("fa-1");
      // server-derived context merged
      expect(ev.funnel_id).toBe("lgf_1");
      expect(ev.site_id).toBe("st_1");
      // §30.3: no raw answer PII on click events
      expect(ev.answer_value_raw).toBe("");
    }
    expect(carrierClick?.carrier_name).toBe("Acme Life");
  });
});
