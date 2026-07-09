// LeadGen analytics — §10.2 event PRODUCER coverage (fix-contract v2.4).
//
// THE §10.2 acceptance, made executable: every member of the FROZEN
// `LEADGEN_EVENT_TYPES` vocabulary (31 types) has a real producer with a passing
// emission test — so adding a 32nd type without a producer FAILS CI.
//
// Two lockstep layers:
//   * COMPILE-TIME — `LEADGEN_PRODUCER_MAP: Record<LeadgenEventType, …>` (see
//     src/analytics/leadgen-producers.ts) forces one entry per type; `tsc` fails
//     on a type with no producer entry.
//   * RUN-TIME (this file) — a generated assertion iterates the vocabulary,
//     checks each maps, verifies the claimed emission-site `source_marker` still
//     exists in its `source_file`, then EXECUTES the producer surface and observes
//     the event actually emitted / accepted.
//
// Evidence route per event (proof_kind):
//   * server_emitted        → drive runAuction / resolveLeadgenClick /
//                             ingestProviderPostback; observe the emitted event.
//   * server_impression_row → drive runAuction; observe the impression row the
//                             server hands the client engine (03 §3.6 / R7).
//   * client_beacon         → the frozen runtime engine SOURCE enqueues it +
//                             POST /lg/track ACCEPTS the type (never dead-letters).
//   * deferred_no_surface   → DEV-32: no public producer yet; the admin config
//                             surface exists + /lg/track already accepts the type
//                             (documented-conditional; NEVER a fake producer).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, afterEach, vi } from "vitest";
import { Hono } from "hono";
import type { Env } from "../src/env";
import { LEADGEN_EVENT_TYPES, type LeadgenEventType } from "../src/analytics/leadgen-events";
import {
  LEADGEN_PRODUCER_MAP,
  LEADGEN_DEFERRED_PRODUCER_EVENTS,
  type LeadgenProducerProofKind,
} from "../src/analytics/leadgen-producers";
import { leadgenTrackRouter } from "../src/analytics/leadgen-track";
import { loadAuctionBundle, runAuction } from "../src/public/leadgen/auction/engine";
import { resolveLeadgenClick, type LeadgenClickInput } from "../src/public/leadgen/click";
import { ingestProviderPostback } from "../src/public/leadgen/postback";
import type { LeadgenParsedCarrier } from "../src/public/leadgen/auction/parse";
import {
  API_ROOT,
  loadDatabaseSync,
  createLeadgenDb,
  d1FromSqlite,
  makeKvStub,
  buildLeadgenEnv,
  stubLeadgenFetch,
  carrierBody,
  ctxCapture,
  settle,
  seedAuction,
  seedAuctionOffer,
  attachOffer,
  seedRedirectRule,
  makeResolved,
  seedPostbackOffer,
  fakeChClient,
  POSTBACK_TOKEN,
  NO_BINDING,
  type SqliteDb,
  type DatabaseSyncCtor,
} from "./helpers/leadgen-analytics-harness";

const ALL_TYPES = [...LEADGEN_EVENT_TYPES] as LeadgenEventType[];

function eventsWithProofKind(kind: LeadgenProducerProofKind): LeadgenEventType[] {
  return ALL_TYPES.filter((t) => LEADGEN_PRODUCER_MAP[t].proof_kind === kind);
}
function eventsWithSurfacePrefix(prefix: string): LeadgenEventType[] {
  return ALL_TYPES.filter(
    (t) => LEADGEN_PRODUCER_MAP[t].proof_kind === "server_emitted" && LEADGEN_PRODUCER_MAP[t].surface.startsWith(prefix),
  );
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

// stubLeadgenFetch installs a global fetch via vi.stubGlobal; restore after each.
afterEach(() => {
  vi.unstubAllGlobals();
});

// ===========================================================================
// Lockstep: the producer map covers exactly the frozen vocabulary
// ===========================================================================

describe("§10.2 producer map — lockstep over the frozen LEADGEN_EVENT_TYPES", () => {
  it("maps EXACTLY the 31 event types (a 32nd type without a producer fails here + at tsc)", () => {
    const mapKeys = Object.keys(LEADGEN_PRODUCER_MAP).sort();
    const vocab = [...LEADGEN_EVENT_TYPES].sort();
    expect(mapKeys).toEqual(vocab);
    expect(mapKeys.length).toBe(31);
  });

  it("partitions the vocabulary into the four proof routes with no gap and no overlap", () => {
    const kinds: LeadgenProducerProofKind[] = [
      "server_emitted",
      "server_impression_row",
      "client_beacon",
      "deferred_no_surface",
    ];
    const seen = new Set<string>();
    for (const k of kinds) for (const t of eventsWithProofKind(k)) seen.add(t);
    expect([...seen].sort()).toEqual([...LEADGEN_EVENT_TYPES].sort());
    // Route sizes (documents the coverage shape): 15 server-emitted, 2 impression
    // rows, 12 client beacons, 2 DEV-32 deferred.
    expect(eventsWithProofKind("server_emitted").length).toBe(15);
    expect(eventsWithProofKind("server_impression_row").length).toBe(2);
    expect(eventsWithProofKind("client_beacon").length).toBe(12);
    expect(eventsWithProofKind("deferred_no_surface").length).toBe(2);
  });

  it("every producer's claimed emission-site source_marker still exists in its source_file", () => {
    for (const t of ALL_TYPES) {
      const p = LEADGEN_PRODUCER_MAP[t];
      const content = readFileSync(join(API_ROOT, p.source_file), "utf8");
      expect(
        content.includes(p.source_marker),
        `producer of "${t}": marker ${JSON.stringify(p.source_marker)} missing from ${p.source_file}`,
      ).toBe(true);
    }
  });
});

// ===========================================================================
// client_beacon route: POST /lg/track ACCEPTS every client-beacon type
// (never dead-letters it) — proven against a stub D1 (no sqlite needed).
// ===========================================================================

describe("§10.2 client-beacon producers — /lg/track accepts every client event type", () => {
  interface DeadLetterRow {
    event_id: string;
    reason: string;
  }
  function makeStubDb(): { db: D1Database; deadLetters: DeadLetterRow[] } {
    const deadLetters: DeadLetterRow[] = [];
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
            if (sql.includes("INSERT INTO leadgen_event_dead_letter")) {
              deadLetters.push({ event_id: String(binds[0]), reason: String(binds[2]) });
            }
            return { success: true, meta: {} };
          },
        };
        return stmt;
      },
    } as unknown as D1Database;
    return { db, deadLetters };
  }

  function trackApp(): Hono<{ Bindings: Env }> {
    const a = new Hono<{ Bindings: Env }>();
    a.route("/", leadgenTrackRouter);
    return a;
  }

  function post(body: unknown): Request {
    return new Request("https://tenant.example.com/lg/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // Drive one event type through /lg/track; return the emitted stream records.
  async function trackOne(eventType: string): Promise<{ records: Array<Record<string, unknown>>; deadLetters: DeadLetterRow[] }> {
    const stub = stubLeadgenFetch();
    const { db, deadLetters } = makeStubDb();
    const { kv } = makeKvStub();
    const env = buildLeadgenEnv(db, kv, { firehose: true });
    const cap = ctxCapture();
    const res = await trackApp().request(
      post({ event_type: eventType, event_id: `ev-${eventType}-${Math.random().toString(36).slice(2)}`, session_id: "sid-1", page_view_id: "pv-1", url: "https://tenant.example.com/f" }),
      undefined,
      env,
      cap.ctx,
    );
    expect(res.status).toBe(204);
    await settle(cap.promises);
    return { records: stub.firehoseRecords as unknown as Array<Record<string, unknown>>, deadLetters };
  }

  it("accepts each client_beacon type as record_kind='event' with NO invalid_event_type dead-letter", async () => {
    const clientEvents = eventsWithProofKind("client_beacon");
    expect(clientEvents.length).toBe(12);
    for (const t of clientEvents) {
      const { records, deadLetters } = await trackOne(t);
      const accepted = records.some((r) => r.record_kind === "event" && r.event_type === t);
      expect(accepted, `/lg/track did not accept client event "${t}" as an event`).toBe(true);
      expect(
        deadLetters.some((d) => d.reason === "invalid_event_type"),
        `/lg/track dead-lettered client event "${t}" as invalid_event_type`,
      ).toBe(false);
    }
  });

  it("also accepts the server-built impression rows the client beacons (carrier_impression / offer_impression)", async () => {
    // The server BUILDS carrier_impression / offer_impression rows (proven in the
    // auction test); the client engine beacons them on viewability (§10.6). Prove
    // /lg/track accepts those beacon types too — so they never dead-letter.
    const impressionEvents = eventsWithProofKind("server_impression_row");
    expect(impressionEvents.sort()).toEqual(["carrier_impression", "offer_impression"]);
    for (const t of impressionEvents) {
      const { records, deadLetters } = await trackOne(t);
      expect(records.some((r) => r.record_kind === "event" && r.event_type === t), `/lg/track did not accept "${t}"`).toBe(true);
      expect(deadLetters.some((d) => d.reason === "invalid_event_type")).toBe(false);
    }
  });
});

// ===========================================================================
// deferred_no_surface (DEV-32): documented-conditional — the admin config
// surface exists + /lg/track already ACCEPTS the type (so a future public
// opening-lander beacon will not dead-letter). NEVER a fake producer.
// ===========================================================================

describe("§10.2 DEV-32 deferred opening-lander producers — documented-conditional", () => {
  it("the deferred set is EXACTLY the two opening-lander events (no other type may defer)", () => {
    expect(eventsWithProofKind("deferred_no_surface").sort()).toEqual([...LEADGEN_DEFERRED_PRODUCER_EVENTS].sort());
    // Each deferred entry documents DEV-32 and points at the admin config surface.
    for (const t of LEADGEN_DEFERRED_PRODUCER_EVENTS) {
      const p = LEADGEN_PRODUCER_MAP[t];
      expect(p.proof_kind).toBe("deferred_no_surface");
      expect(p.note ?? "").toContain("DEV-32");
      // The admin lander editor (config surface) genuinely exists.
      const editor = readFileSync(join(API_ROOT, p.source_file), "utf8");
      expect(editor.includes(p.source_marker)).toBe(true);
    }
  });

  it("/lg/track ACCEPTS the deferred types today (a future lander beacon will not dead-letter)", async () => {
    const stub = stubLeadgenFetch();
    const deadLetters: string[] = [];
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
            if (sql.includes("INSERT INTO leadgen_event_dead_letter")) deadLetters.push(String(binds[2]));
            return { success: true, meta: {} };
          },
        };
        return stmt;
      },
    } as unknown as D1Database;
    const { kv } = makeKvStub();
    const env = buildLeadgenEnv(db, kv, { firehose: true });
    const a = new Hono<{ Bindings: Env }>();
    a.route("/", leadgenTrackRouter);
    const cap = ctxCapture();
    await a.request(
      new Request("https://tenant.example.com/lg/track", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: LEADGEN_DEFERRED_PRODUCER_EVENTS.map((t, i) => ({ event_type: t, event_id: `lander-${i}` })) }),
      }),
      undefined,
      env,
      cap.ctx,
    );
    await settle(cap.promises);
    for (const t of LEADGEN_DEFERRED_PRODUCER_EVENTS) {
      const accepted = (stub.firehoseRecords as unknown as Array<Record<string, unknown>>).some(
        (r) => r.record_kind === "event" && r.event_type === t,
      );
      expect(accepted, `/lg/track rejected deferred type "${t}"`).toBe(true);
    }
    expect(deadLetters.includes("invalid_event_type")).toBe(false);
  });
});

// ===========================================================================
// server_emitted — click resolver (carrier_click / offer_click) — stub D1
// ===========================================================================

describe("§10.2 click-resolver producers — carrier_click / offer_click", () => {
  function makeClickEnv(): Env {
    const db = {
      prepare() {
        const stmt = {
          bind() {
            return stmt;
          },
          async first() {
            return null;
          },
          async all() {
            return { results: [], success: true, meta: {} };
          },
          async run() {
            return { success: true, meta: {} };
          },
        };
        return stmt;
      },
    } as unknown as D1Database;
    return { DB: db, APP_ENV: "test" } as unknown as Env;
  }
  function ctxNoop(): ExecutionContext {
    return { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  }
  const carrier: LeadgenParsedCarrier = {
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
  };
  function clickInput(overrides: Partial<LeadgenClickInput> = {}): LeadgenClickInput {
    return {
      offer_public_id: "lgo_x",
      carrier_key: "acme",
      auction_instance_id: "aiid-1",
      banner_render_id: "brid-1",
      slot: 1,
      funnel_attempt_id: "fa-1",
      session_id: "sid-1",
      auction_id: 9,
      carrier,
      banner_url_template: null,
      response_macro_fallbacks: null,
      response_context: null,
      canonical_macros: {},
      offer: null,
      removal_scope: "offer",
      now: 1_700_000_000_000,
      ...overrides,
    };
  }

  it("a carrier-scoped click emits carrier_click; an offer-level click emits offer_click", async () => {
    const carrierScoped = await resolveLeadgenClick(makeClickEnv(), ctxNoop(), clickInput({ carrier_key: "acme" }));
    expect(carrierScoped.events.map((e) => e.event_type)).toContain("carrier_click");
    expect(carrierScoped.events.some((e) => e.event_type === "offer_click")).toBe(false);

    const offerLevel = await resolveLeadgenClick(makeClickEnv(), ctxNoop(), clickInput({ carrier_key: "" }));
    expect(offerLevel.events.map((e) => e.event_type)).toContain("offer_click");
    expect(offerLevel.events.some((e) => e.event_type === "carrier_click")).toBe(false);

    // Proves EXACTLY the click-resolver server_emitted producers in the map.
    expect(eventsWithSurfacePrefix("Click resolver").sort()).toEqual(["carrier_click", "offer_click"]);
  });
});

// ===========================================================================
// server_emitted (auction + redirect) + server_impression_row — real runAuction
// ===========================================================================

describeDb("§10.2 auction-path producers — runAuction emits every auction + redirect + impression event", () => {
  function harness(): { sdb: SqliteDb; env: Env } {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const { kv } = makeKvStub();
    return { sdb, env: buildLeadgenEnv(d1FromSqlite(sdb), kv) };
  }

  async function eventsFrom(
    env: Env,
    sdb: SqliteDb,
    seed: (sdb: SqliteDb) => { auction: ReturnType<typeof seedAuction> },
  ): Promise<{ eventTypes: Set<string>; impressionTypes: Set<string> }> {
    const { auction } = seed(sdb);
    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(
      env,
      { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] },
      { dryRun: true },
    );
    return {
      eventTypes: new Set(result.events.map((e) => e.event_type)),
      impressionTypes: new Set(result.impression_rows.map((r) => r.event_type)),
    };
  }

  it("emits all 9 auction-lifecycle events, both redirect events, and both impression rows", async () => {
    const seen = new Set<string>();
    const impressions = new Set<string>();

    // Happy path (2 dynamic offers bidding) → start, offer_request, offer_response,
    // carrier_eligible, filled + carrier_impression / offer_impression rows.
    {
      const { sdb, env } = harness();
      stubLeadgenFetch(() => new Response(carrierBody([{ name: "Acme", bid: 12 }]), { status: 200 }));
      const out = await eventsFrom(env, sdb, (db) => {
        const auction = seedAuction(db, { multi_offer: "enabled" });
        attachOffer(db, auction.id, seedAuctionOffer(db), 0);
        attachOffer(db, auction.id, seedAuctionOffer(db), 1);
        return { auction };
      });
      out.eventTypes.forEach((t) => seen.add(t));
      out.impressionTypes.forEach((t) => impressions.add(t));
    }
    // Timeout → auction_offer_timeout.
    {
      const { sdb, env } = harness();
      stubLeadgenFetch(() => new Promise<Response>(() => {}));
      const out = await eventsFrom(env, sdb, (db) => {
        const auction = seedAuction(db, { timeout_ms: 20 });
        attachOffer(db, auction.id, seedAuctionOffer(db), 0);
        return { auction };
      });
      out.eventTypes.forEach((t) => seen.add(t));
    }
    // Malformed 200 → auction_offer_error.
    {
      const { sdb, env } = harness();
      stubLeadgenFetch(() => new Response("<html>not json</html>", { status: 200 }));
      const out = await eventsFrom(env, sdb, (db) => {
        const auction = seedAuction(db);
        attachOffer(db, auction.id, seedAuctionOffer(db), 0);
        return { auction };
      });
      out.eventTypes.forEach((t) => seen.add(t));
    }
    // Below-floor → auction_carrier_filtered (+ eligible + filled).
    {
      const { sdb, env } = harness();
      stubLeadgenFetch(() => new Response(carrierBody([{ name: "High", bid: 20, logo: "https://l/h.png" }, { name: "Low", bid: 2, logo: "https://l/l.png" }]), { status: 200 }));
      const out = await eventsFrom(env, sdb, (db) => {
        const auction = seedAuction(db, { floor_type: "absolute_bid", floor_value: 10, multi_offer: "enabled" });
        attachOffer(db, auction.id, seedAuctionOffer(db), 0);
        return { auction };
      });
      out.eventTypes.forEach((t) => seen.add(t));
    }
    // Unfilled (no carriers) → auction_unfilled.
    {
      const { sdb, env } = harness();
      stubLeadgenFetch(() => new Response(JSON.stringify({ carriers: [] }), { status: 200 }));
      const out = await eventsFrom(env, sdb, (db) => {
        const auction = seedAuction(db);
        attachOffer(db, auction.id, seedAuctionOffer(db), 0);
        return { auction };
      });
      out.eventTypes.forEach((t) => seen.add(t));
    }
    // Redirect rule → redirect_rule_triggered + direct_offer_redirect.
    {
      const { sdb, env } = harness();
      stubLeadgenFetch(() => new Response(carrierBody([{ name: "Acme", bid: 12 }]), { status: 200 }));
      const out = await eventsFrom(env, sdb, (db) => {
        const auction = seedAuction(db, { multi_offer: "enabled" });
        const offer = seedAuctionOffer(db);
        attachOffer(db, auction.id, offer, 0);
        seedRedirectRule(db, 1, offer.offer_id);
        return { auction };
      });
      out.eventTypes.forEach((t) => seen.add(t));
    }

    // Every auction-surface + redirect-surface server_emitted event was observed.
    for (const t of eventsWithSurfacePrefix("Auction path")) {
      expect(seen.has(t), `auction event "${t}" was not emitted by runAuction`).toBe(true);
    }
    for (const t of eventsWithSurfacePrefix("Redirect/funnel rules")) {
      expect(seen.has(t), `redirect event "${t}" was not emitted by runAuction`).toBe(true);
    }
    // Both impression rows are built by the server (03 §3.6 / R7).
    for (const t of eventsWithProofKind("server_impression_row")) {
      expect(impressions.has(t), `impression row "${t}" was not built by the server auction`).toBe(true);
    }

    // Route membership is exactly the map's (guards a mis-surfaced entry).
    expect(eventsWithSurfacePrefix("Auction path").length).toBe(9);
    expect(eventsWithSurfacePrefix("Redirect/funnel rules").length).toBe(2);
  });
});

// ===========================================================================
// server_emitted — provider postback (conversion / revenue_received)
// ===========================================================================

describeDb("§10.2 monetization producers — provider postback emits conversion + revenue_received", () => {
  it("a CH-matched booked conversion emits BOTH conversion and revenue_received on the stream", async () => {
    const stub = stubLeadgenFetch(); // firehose captured; S2S/other fetch → 200
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const { kv } = makeKvStub();
    const env = buildLeadgenEnv(d1FromSqlite(sdb), kv, { firehose: true });
    seedPostbackOffer(sdb, "lgo_x", "cpl");

    const cap = ctxCapture();
    const req = new Request("http://one.example.com/lg/pb/testprov", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Postback-Token": POSTBACK_TOKEN },
      body: JSON.stringify({ external_txn_id: "txn-1", click_id: "lgl_click_1", offer_public_id: "lgo_x", revenue: 12.5, currency: "USD" }),
    });
    const res = await ingestProviderPostback(env, cap.ctx, "testprov", req, { chClient: fakeChClient() });
    expect(res.status).toBe(200);
    await settle(cap.promises);

    const streamed = stub.firehoseRecords as unknown as Array<Record<string, unknown>>;
    const conv = streamed.find((r) => r.event_type === "conversion");
    const rev = streamed.find((r) => r.event_type === "revenue_received");
    expect(conv, "conversion event was not emitted by the postback").toBeDefined();
    expect(rev, "revenue_received event was not emitted by the postback").toBeDefined();
    expect((conv as Record<string, unknown>).click_id).toBe("lgl_click_1");
    expect((rev as Record<string, unknown>).revenue).toBe(12.5);

    // Proves EXACTLY the postback server_emitted producers in the map.
    expect(eventsWithSurfacePrefix("Postback").sort()).toEqual(["conversion", "revenue_received"]);
  });
});
