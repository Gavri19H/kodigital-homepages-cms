// Send-only Offers (plan "Send-only Offers", 5 Nov 2026; migration 0068) —
// the money half of an ACCEPTED send-only lead, on the LIVE /lg/auction route
// only (serve-auction.ts; the Simulator / any dry run never calls this).
//
// For each send-only Offer whose Provider accepted the lead (engine.ts
// RunAuctionResult.send_only_accepted — every accepted Offer, even when only
// one banner shows or a card shows instead):
//
//   * D7 — a CPL Offer books its fixed price ONCE per funnel attempt and
//     Offer: recordInSitePayout (revenue-ingest.ts), click id = the funnel
//     attempt id, dedupe key = sendOnlyDedupeKey(offer), revenue / currency =
//     the Offer's static_bid_value / static_bid_currency. A CPA (or any other
//     type) books nothing.
//   * D13 — ONE `lead_sent` event per funnel attempt and Offer (CPL and CPA),
//     gated on the same once-only claim: a CPL Offer's "newly booked" result,
//     a CPA Offer's leadgen_conversion_log claim (claimInSiteConversionKey —
//     no revenue row). A retry of the same attempt books nothing more and
//     sends no second event.
//   * Only CLEAN traffic books or reports (team / preview never posted the
//     Offer at all — engine T8; bot traffic posts like every Offer but books
//     and reports nothing). recordInSitePayout refuses non-clean traffic too.
//   * An empty funnel attempt id books nothing (logged).
//
// GUARDRAILS C-009: the caller AWAITS this before the reply goes back — the
// conversion-log row is the input of the next retry's dedupe decision, so it
// must never be a fire-and-forget write. A booking error is logged with its
// context (console.error) and the visitor still gets the page; that Offer's
// lead_sent event is then not sent (nothing was booked for it).

import type { TrafficQualityFlags } from "../../analytics/listicle-quality";
import type { LeadgenEvent } from "../../analytics/leadgen-events";
import { sendOnlyDedupeKey } from "../../leadgen/send-only";
import { claimInSiteConversionKey, getOfferByPublicId, recordInSitePayout } from "../../leadgen/revenue-ingest";
import type { SendOnlyAcceptedLead } from "./auction/engine";

export interface SettleSendOnlyContext {
  // The anti-tamper-verified funnel attempt id (the booking's click id).
  funnel_attempt_id: string;
  traffic_quality: Pick<TrafficQualityFlags, "traffic_quality_flag">;
  now: Date;
}

export interface SendOnlySettleOutcome {
  offer_public_id: string;
  // "booked" (CPL, newly booked) / "claimed" (non-CPL, newly claimed) /
  // "duplicate" (a retry of this attempt) / "not_clean" / "no_attempt" /
  // "offer_missing" / "error".
  outcome: "booked" | "claimed" | "duplicate" | "not_clean" | "no_attempt" | "offer_missing" | "error";
}

export interface SendOnlySettleResult {
  // The lead_sent events to emit (one per newly booked / claimed Offer).
  events: LeadgenEvent[];
  outcomes: SendOnlySettleOutcome[];
}

function currencyOf(raw: string | null): string {
  const c = (raw ?? "").trim().toUpperCase();
  return c === "" ? "USD" : c;
}

// Never throws: every Offer is settled on its own (one Offer's failure never
// stops the next), and every failure is logged.
export async function settleSendOnlyLeads(
  db: D1Database,
  leads: readonly SendOnlyAcceptedLead[],
  ctx: SettleSendOnlyContext,
): Promise<SendOnlySettleResult> {
  const events: LeadgenEvent[] = [];
  const outcomes: SendOnlySettleOutcome[] = [];
  const dt = ctx.now.toISOString().slice(0, 10);
  for (const lead of leads) {
    const offerId = lead.offer_public_id;
    if (ctx.traffic_quality.traffic_quality_flag !== "clean") {
      outcomes.push({ offer_public_id: offerId, outcome: "not_clean" });
      continue;
    }
    if (ctx.funnel_attempt_id === "") {
      console.error(JSON.stringify({ event: "leadgen_send_only_no_attempt", offer_id: offerId, provider_request_id: lead.provider_request_id }));
      outcomes.push({ offer_public_id: offerId, outcome: "no_attempt" });
      continue;
    }
    const dedupeKey = sendOnlyDedupeKey(offerId);
    const isCpl = lead.offer_type === "cpl";
    let fresh = false;
    try {
      if (isCpl && (lead.bid_value === null || !(lead.bid_value > 0))) {
        // A CPL Offer with no fixed bid has no price to book (the admin
        // requires one for send-only); never write a $0 conversion for it.
        console.error(JSON.stringify({ event: "leadgen_send_only_no_bid", offer_id: offerId, funnel_attempt_id: ctx.funnel_attempt_id }));
        outcomes.push({ offer_public_id: offerId, outcome: "error" });
        continue;
      }
      if (isCpl) {
        const row = await getOfferByPublicId(db, offerId);
        if (row === null) {
          console.error(JSON.stringify({ event: "leadgen_send_only_offer_missing", offer_id: offerId, funnel_attempt_id: ctx.funnel_attempt_id }));
          outcomes.push({ offer_public_id: offerId, outcome: "offer_missing" });
          continue;
        }
        const booked = await recordInSitePayout(
          db,
          row,
          ctx.funnel_attempt_id,
          dedupeKey,
          dt,
          lead.bid_value as number,
          currencyOf(lead.bid_currency),
          true,
          ctx.now,
        );
        fresh = booked.recorded;
      } else {
        fresh = await claimInSiteConversionKey(db, ctx.funnel_attempt_id, dedupeKey, offerId);
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "leadgen_send_only_booking_failed",
          offer_id: offerId,
          offer_type: lead.offer_type,
          funnel_attempt_id: ctx.funnel_attempt_id,
          provider_request_id: lead.provider_request_id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      outcomes.push({ offer_public_id: offerId, outcome: "error" });
      continue;
    }
    if (!fresh) {
      outcomes.push({ offer_public_id: offerId, outcome: "duplicate" });
      continue;
    }
    outcomes.push({ offer_public_id: offerId, outcome: isCpl ? "booked" : "claimed" });
    // The lead_sent event (D13). Everything an auction event carries is
    // already on it (engine buildEvent); here: the money and the quality.
    const e: LeadgenEvent = { ...lead.event };
    e.record_kind = "event";
    e.event_type = "lead_sent";
    e.offer_type = lead.offer_type;
    // revenue = the booked amount in USD (fx-normalized the way the click
    // route normalizes click revenue; null on an FX miss, so the bid in its
    // own currency below stays the truth); 0 for a type that books nothing.
    e.revenue = isCpl ? (lead.bid_value === null ? 0 : lead.usd_bid) : 0;
    if (isCpl && lead.bid_value !== null && lead.usd_bid === null) {
      // No FX rate: the ledger holds the booking in its own currency, but the
      // event's USD revenue is unknown (reports count it as $0). Leave a trace.
      console.error(
        JSON.stringify({
          event: "leadgen_send_only_fx_missing",
          offer_id: offerId,
          funnel_attempt_id: ctx.funnel_attempt_id,
          bid_value: lead.bid_value,
          bid_currency: currencyOf(lead.bid_currency),
        }),
      );
    }
    e.booking_trigger = "lead";
    e.bid_value = lead.bid_value;
    e.bid_currency = currencyOf(lead.bid_currency);
    e.is_bot = false;
    e.is_internal = false;
    e.is_preview = false;
    e.traffic_quality_flag = "clean";
    events.push(e);
  }
  return { events, outcomes };
}
