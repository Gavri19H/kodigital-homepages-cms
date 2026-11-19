// F11 — "Redirect to offer" → "After the offer is shown" (plan:
// backlog/items/F11.html, contract backlog/CONTRACT-F11.md).
//
// The open instruction the auction engine produces when the FIRST matching
// funnel rule is a "Redirect to offer" rule with redirect_show_seconds set:
// the first matching such rule whose Offer has a card in this visitor's
// results (X16: rules whose Offer has none are passed over), when the visitor
// falls inside that rule's sticky "Redirect %" draw. serve-auction.ts hands it to
// renderRedirectScreen() (./screen.ts), which turns the normal banners_html into
// the redirect banner / animation-only screen that the page shell's small
// redirect script runs. Nothing here names a partner.
//
// Field names are a contract between the engine (producer), the screen
// renderer and the page script (consumers): add optional fields if needed, but
// never rename or remove one.

/** What "Stay here" / "Show me all offers" hides, from the Auction's
 *  "Remove clicked offers" + "Removal scope" (the Auction always wins). */
export type RedirectStayHides =
  | { mode: "none" } // "Remove clicked offers" off: the chosen card stays
  | { mode: "offer"; offer_public_id: string } // on + scope Offer: every card of the chosen Offer is hidden
  | { mode: "carrier"; carrier_key: string }; // on + scope Carrier: only the chosen card's Carrier is hidden

export type RedirectDisplay = "banner" | "animation";

export interface RedirectAfterInstruction {
  /** leadgen_funnel_rules.public_id of the rule that fired. */
  rule_public_id: string;
  /** The rule's target Offer. */
  offer_public_id: string;
  /** data-slot of the chosen card (the top card of that Offer). */
  slot: number;
  /** data-carrier-key of the chosen card. */
  carrier_key: string;
  /** The rule's redirect_show_seconds, 2..30. */
  seconds: number;
  /** The rule's redirect_display (NULL in the database = "banner"). */
  display: RedirectDisplay;
  /** The chosen card's brand name for "{brand}", or null (texts then say "your offer"). */
  brand: string | null;
  /** The chosen card's logo URL for "Logo on a bar", or null (falls back to the ring). */
  logo_url: string | null;
  stay_hides: RedirectStayHides;
  /** (Added by the engine build, optional.) The banner_render_id of the render
   *  the chosen card belongs to — the same value as its link's `brid` param
   *  and its `.lg-banners` wrapper's data-banner-render-id. With backfill the
   *  results hold two renders, so `brid` + `slot` together name the card. */
  banner_render_id?: string;
}

/** "Show the offer for (seconds)": whole numbers in this range (the save
 *  check and the engine both use it). The 2-second floor keeps the card on
 *  screen long enough (1 second) for its view to count before it opens. */
export const REDIRECT_SHOW_SECONDS_MIN = 2 as const;
export const REDIRECT_SHOW_SECONDS_MAX = 30 as const;

/** leadgen_auction_result_log.redirect_json (one per auction, NULL when no
 *  "After" rule matched first). rule_id / offer_id / outcome name the rule
 *  that decided: the first matching "After" rule whose Offer has a card
 *  ("opened" or "held_back"), or the first matching rule when none had one
 *  ("no_card"). X16: `passed_over` lists, in priority order, the matching
 *  rules whose Offer had no card and that were passed over before it (or
 *  after it, for "no_card"); absent when there were none. The read-out
 *  queries read only the first three fields. */
export interface RedirectLogRecord {
  rule_id: string;
  offer_id: string;
  outcome: "opened" | "held_back" | "no_card";
  passed_over?: Array<{ rule_id: string; offer_id: string }>;
}

/** The hidden redirect mark: a first-party cookie the page script sets just
 *  before it clicks the chosen card, and the click route (click.ts) reads.
 *  Value: `${brid}.${slot}` (the card link's own brid and slot params).
 *  Max-Age 30 s, Path=/, SameSite=Lax, Secure. Never in the link. */
export const REDIRECT_MARK_COOKIE = "lg_rc" as const;
export const REDIRECT_MARK_MAX_AGE_SECONDS = 30 as const;
