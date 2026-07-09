// LeadGen analytics — event PRODUCER coverage map (fix-contract v2.4 · 10 §10.2).
//
// The §10.2 acceptance: EVERY member of `LEADGEN_EVENT_TYPES` (the frozen 31-type
// vocabulary, analytics/leadgen-events.ts) has a real producer with a passing
// emission test — so adding a 32nd type without a producer FAILS CI.
//
// This module realizes the lockstep in TWO complementary ways:
//   1. COMPILE-TIME — `LEADGEN_PRODUCER_MAP: Record<LeadgenEventType, …>` forces
//      one entry per event type. Add a 32nd type to `LEADGEN_EVENT_TYPES` and
//      `tsc --noEmit` fails here until a producer entry is authored.
//   2. RUN-TIME (test/leadgen-analytics-producers.test.ts) — a generated
//      assertion iterates `LEADGEN_EVENT_TYPES`, checks each maps here, verifies
//      the claimed emission-site `source_marker` still exists in `source_file`,
//      and then EXECUTES the producer surface (drives runAuction / the click
//      resolver / the provider postback / POST /lg/track) and observes the event
//      actually emitted / accepted.
//
// This module carries NO runtime behavior — it is a typed description of where
// each event is produced. It imports only the event-type union (a type) and does
// NOT touch the frozen runtime bundle (src/public/leadgen/runtime/).

import type { LeadgenEventType } from "./leadgen-events";

// How an event's producer is PROVEN by the §10.2 test (evidence route per event).
export type LeadgenProducerProofKind =
  // Server surface emits the event object into an `emitLeadgenRecords(...)`
  // batch. The test drives the real surface and observes the emitted event.
  | "server_emitted"
  // The SERVER builds the impression ROW (03 §3.6 / R7) returned to the client
  // engine, which beacons it on viewability. The test drives runAuction and
  // observes the impression_row; POST /lg/track proves the type is accepted.
  | "server_impression_row"
  // Client beacon only: the frozen runtime engine SOURCE enqueues/emits the
  // event; the server never owns it. Proof = source lists it + POST /lg/track
  // accepts the type (never dead-letters it) — the §10.2 client-event route.
  | "client_beacon"
  // DEV-32: NO producer surface exists yet (the public opening-lander surface
  // was never built; the admin editor configures `lander_*` but no public
  // serve/resolver reads it). §10.2 qualifies these "only when a funnel is
  // configured with an opening lander" — documented-conditional, NEVER a fake
  // producer. Proof = the admin config surface exists + POST /lg/track already
  // ACCEPTS the type (so the beacon will not dead-letter once the surface ships).
  | "deferred_no_surface";

export interface LeadgenProducer {
  // The §10.2 producer surface (human-readable, matches the contract table).
  surface: string;
  // Contract phase that owns the producer ("1" | "exists" | "deferred").
  phase: string;
  // Repo-relative (to api/) source file that emits (or, for deferred, configures)
  // the event. The test reads this file and asserts `source_marker` is present.
  source_file: string;
  // A literal substring that MUST appear in `source_file` — the enforced anchor
  // for the emission-site claim (guards deletion / drift of the producer).
  source_marker: string;
  // Documentation pointer "file:line" for humans (line may drift; the enforced
  // proof is `source_marker`, not this line number).
  emission_site: string;
  // The evidence route the §10.2 test uses to prove this producer.
  proof_kind: LeadgenProducerProofKind;
  // Optional rationale (e.g. the DEV-32 deferral).
  note?: string;
}

const ENGINE = "src/public/leadgen/auction/engine.ts";
const RUNTIME_ENGINE = "src/public/leadgen/runtime/engine.ts";
const RUNTIME_MAPS = "src/public/leadgen/runtime/maps.ts";
const CLICK = "src/public/leadgen/click.ts";
const POSTBACK = "src/public/leadgen/postback.ts";
const LANDER_EDITOR = "src/admin/leadgen/ui-quotes.ts";

// One entry per LeadgenEventType — the `Record<LeadgenEventType, …>` type makes
// this exhaustive at compile time (a missing key fails `tsc`).
export const LEADGEN_PRODUCER_MAP: Record<LeadgenEventType, LeadgenProducer> = {
  // --- funnel / quote lifecycle — runtime engine client beacons (§10.2 row 1) --
  quote_view: {
    surface: "Runtime engine (client beacon → /lg/track)",
    phase: "1",
    source_file: RUNTIME_ENGINE,
    source_marker: 'enqueue("quote_view"',
    emission_site: `${RUNTIME_ENGINE}:483`,
    proof_kind: "client_beacon",
  },
  opening_lander_view: {
    surface: "Opening-lander surface (only when a funnel configures an opening lander)",
    phase: "deferred",
    source_file: LANDER_EDITOR,
    source_marker: "lander_enabled",
    emission_site: `${LANDER_EDITOR}:596 (admin config only — no public emitter)`,
    proof_kind: "deferred_no_surface",
    note:
      "DEV-32: no PUBLIC opening-lander surface exists (v2.3.7 built lander rendering " +
      "admin-preview-only; the public serve/resolver never read lander_*). §10.2 qualifies " +
      "this 'only when a funnel is configured with an opening lander'. Documented-conditional: " +
      "the admin editor configures the lander and /lg/track ALREADY accepts the type (so the " +
      "future client beacon will not dead-letter). NOT a fake producer.",
  },
  opening_lander_cta_click: {
    surface: "Opening-lander surface (only when a funnel configures an opening lander)",
    phase: "deferred",
    source_file: LANDER_EDITOR,
    source_marker: "lander_enabled",
    emission_site: `${LANDER_EDITOR}:596 (admin config only — no public emitter)`,
    proof_kind: "deferred_no_surface",
    note:
      "DEV-32: as opening_lander_view — the public lander surface that would beacon the CTA " +
      "click does not exist yet (the whole lander, incl. its CTA, is gated by lander_enabled). " +
      "Documented-conditional, never a fake producer.",
  },
  section_view: {
    surface: "Runtime engine (client beacon → /lg/track)",
    phase: "1",
    source_file: RUNTIME_ENGINE,
    source_marker: 'enqueue("section_view"',
    emission_site: `${RUNTIME_ENGINE}:890`,
    proof_kind: "client_beacon",
  },
  answer_click: {
    surface: "Runtime engine (client beacon → /lg/track)",
    phase: "1",
    source_file: RUNTIME_ENGINE,
    source_marker: 'enqueue("answer_click"',
    emission_site: `${RUNTIME_ENGINE}:713`,
    proof_kind: "client_beacon",
  },
  answer_change: {
    surface: "Runtime engine (client beacon → /lg/track)",
    phase: "1",
    source_file: RUNTIME_ENGINE,
    source_marker: 'enqueue("answer_change"',
    emission_site: `${RUNTIME_ENGINE}:779`,
    proof_kind: "client_beacon",
  },
  answer_default_applied: {
    surface: "Runtime engine (client beacon → /lg/track)",
    phase: "1",
    source_file: RUNTIME_ENGINE,
    source_marker: 'enqueue("answer_default_applied"',
    emission_site: `${RUNTIME_ENGINE}:907`,
    proof_kind: "client_beacon",
  },
  continue_click: {
    surface: "Runtime engine (client beacon → /lg/track)",
    phase: "1",
    source_file: RUNTIME_ENGINE,
    source_marker: 'enqueue("continue_click"',
    emission_site: `${RUNTIME_ENGINE}:822`,
    proof_kind: "client_beacon",
  },
  section_continue: {
    surface: "Runtime engine (client beacon → /lg/track)",
    phase: "1",
    source_file: RUNTIME_ENGINE,
    source_marker: 'enqueue("section_continue"',
    emission_site: `${RUNTIME_ENGINE}:838`,
    proof_kind: "client_beacon",
  },
  validation_error: {
    surface: "Runtime engine (client beacon → /lg/track)",
    phase: "1",
    source_file: RUNTIME_ENGINE,
    source_marker: 'enqueue("validation_error"',
    emission_site: `${RUNTIME_ENGINE}:808`,
    proof_kind: "client_beacon",
  },
  address_autofill: {
    surface: "Runtime engine — Maps island (client beacon → /lg/track)",
    phase: "1",
    source_file: RUNTIME_MAPS,
    source_marker: '"address_autofill"',
    emission_site: `${RUNTIME_MAPS}:201`,
    proof_kind: "client_beacon",
  },
  address_validation_success: {
    surface: "Runtime engine — Maps island (client beacon → /lg/track)",
    phase: "1",
    source_file: RUNTIME_MAPS,
    source_marker: '"address_validation_success"',
    emission_site: `${RUNTIME_MAPS}:208`,
    proof_kind: "client_beacon",
  },
  address_validation_error: {
    surface: "Runtime engine — Maps island (client beacon → /lg/track)",
    phase: "1",
    source_file: RUNTIME_MAPS,
    source_marker: '"address_validation_error"',
    emission_site: `${RUNTIME_MAPS}:173`,
    proof_kind: "client_beacon",
  },
  quote_complete: {
    surface: "Runtime engine (client beacon → /lg/track)",
    phase: "1",
    source_file: RUNTIME_ENGINE,
    source_marker: 'enqueue("quote_complete"',
    emission_site: `${RUNTIME_ENGINE}:997`,
    proof_kind: "client_beacon",
  },

  // --- auction lifecycle — server (§10.2 row 3; client never owns auction truth) -
  auction_start: {
    surface: "Auction path (server, serve-auction.ts/engine)",
    phase: "1",
    source_file: ENGINE,
    source_marker: 'pushEvent("auction_start"',
    emission_site: `${ENGINE}:963`,
    proof_kind: "server_emitted",
  },
  auction_offer_request: {
    surface: "Auction path (server, serve-auction.ts/engine)",
    phase: "1",
    source_file: ENGINE,
    source_marker: 'pushEvent("auction_offer_request"',
    emission_site: `${ENGINE}:1195`,
    proof_kind: "server_emitted",
  },
  auction_offer_response: {
    surface: "Auction path (server, serve-auction.ts/engine)",
    phase: "1",
    source_file: ENGINE,
    source_marker: 'pushEvent("auction_offer_response"',
    emission_site: `${ENGINE}:1207`,
    proof_kind: "server_emitted",
  },
  auction_offer_timeout: {
    surface: "Auction path (server, serve-auction.ts/engine)",
    phase: "1",
    source_file: ENGINE,
    source_marker: 'pushEvent("auction_offer_timeout"',
    emission_site: `${ENGINE}:1197`,
    proof_kind: "server_emitted",
  },
  auction_offer_error: {
    surface: "Auction path (server, serve-auction.ts/engine)",
    phase: "1",
    source_file: ENGINE,
    source_marker: 'pushEvent("auction_offer_error"',
    emission_site: `${ENGINE}:1202`,
    proof_kind: "server_emitted",
  },
  auction_carrier_eligible: {
    surface: "Auction path (server, serve-auction.ts/engine)",
    phase: "1",
    source_file: ENGINE,
    source_marker: 'pushEvent("auction_carrier_eligible"',
    emission_site: `${ENGINE}:1322`,
    proof_kind: "server_emitted",
  },
  auction_carrier_filtered: {
    surface: "Auction path (server, serve-auction.ts/engine)",
    phase: "1",
    source_file: ENGINE,
    source_marker: 'pushEvent("auction_carrier_filtered"',
    emission_site: `${ENGINE}:1045`,
    proof_kind: "server_emitted",
  },
  auction_filled: {
    surface: "Auction path (server, serve-auction.ts/engine)",
    phase: "1",
    source_file: ENGINE,
    source_marker: 'pushEvent("auction_filled"',
    emission_site: `${ENGINE}:1510`,
    proof_kind: "server_emitted",
  },
  auction_unfilled: {
    surface: "Auction path (server, serve-auction.ts/engine)",
    phase: "1",
    source_file: ENGINE,
    source_marker: 'pushEvent("auction_unfilled"',
    emission_site: `${ENGINE}:1525`,
    proof_kind: "server_emitted",
  },

  // --- impressions — SERVER builds the row (03 §3.6 / R7); client beacons it -----
  carrier_impression: {
    surface: "Runtime engine (client beacon); server builds the impression row (03 §3.6/R7)",
    phase: "1",
    source_file: ENGINE,
    source_marker: 'event_type: "carrier_impression"',
    emission_site: `${ENGINE}:1486`,
    proof_kind: "server_impression_row",
  },
  offer_impression: {
    surface: "Runtime engine (client beacon); server builds the impression row (03 §3.6/R7)",
    phase: "1",
    source_file: ENGINE,
    source_marker: 'event_type: "offer_impression"',
    emission_site: `${ENGINE}:1497`,
    proof_kind: "server_impression_row",
  },

  // --- click resolver — server (§10.2 row 4, existing at click.ts) --------------
  carrier_click: {
    surface: "Click resolver (server, click.ts)",
    phase: "exists",
    source_file: CLICK,
    source_marker: '"carrier_click"',
    emission_site: `${CLICK}:313`,
    proof_kind: "server_emitted",
  },
  offer_click: {
    surface: "Click resolver (server, click.ts)",
    phase: "exists",
    source_file: CLICK,
    source_marker: '"offer_click"',
    emission_site: `${CLICK}:314`,
    proof_kind: "server_emitted",
  },

  // --- monetization — postback / revenue ingest (server, §10.2 row 6) -----------
  conversion: {
    surface: "Postback / revenue ingest (server, postback.ts)",
    phase: "1",
    source_file: POSTBACK,
    source_marker: 'buildRevenueEvent("conversion"',
    emission_site: `${POSTBACK}:221`,
    proof_kind: "server_emitted",
  },
  revenue_received: {
    surface: "Postback / revenue ingest (server, postback.ts / revenue-recon.ts)",
    phase: "1",
    source_file: POSTBACK,
    source_marker: 'buildRevenueEvent("revenue_received"',
    emission_site: `${POSTBACK}:222`,
    proof_kind: "server_emitted",
  },

  // --- redirect / funnel rules — server, where the rule triggers (§10.2 row 5) --
  redirect_rule_triggered: {
    surface: "Redirect/funnel rules (server, engine funnel-rule loop)",
    phase: "1",
    source_file: ENGINE,
    source_marker: 'pushEvent("redirect_rule_triggered"',
    emission_site: `${ENGINE}:1007`,
    proof_kind: "server_emitted",
  },
  direct_offer_redirect: {
    surface: "Redirect/funnel rules (server, engine funnel-rule loop)",
    phase: "1",
    source_file: ENGINE,
    source_marker: 'pushEvent("direct_offer_redirect"',
    emission_site: `${ENGINE}:1009`,
    proof_kind: "server_emitted",
  },
};

// The DEV-32 documented-conditional set — the ONLY events allowed to carry
// `deferred_no_surface`. The §10.2 test pins this set exactly, so a NEW type
// cannot silently ride the deferral: any other type marked deferred (or either
// of these losing its deferral without a real producer) fails the test.
export const LEADGEN_DEFERRED_PRODUCER_EVENTS: readonly LeadgenEventType[] = [
  "opening_lander_view",
  "opening_lander_cta_click",
];
