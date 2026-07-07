// LeadGen §8.3 / §4.3 — the PUBLIC `/lg/*` runtime router (Phase 7 Stage C).
// Mounted from index.ts next to analyticsRouter (BEFORE the ADMIN_HOST safety
// net + publicRouter's `/:slug` catch-all), so the reserved `/lg` head never
// collides with the public content router — exactly how analyticsRouter mounts
// ahead of publicRouter.
//
// Served on TENANT hosts only: publicSiteContextMiddleware resolves host→site
// and 404s the ADMIN_HOST (its resolveSiteContextFromRequest short-circuits the
// admin host to null), so mounting ahead of the admin-host net is safe — an
// admin-host /lg request gets the middleware's safe 404, never a shell.
//
// The middleware is scoped to `/lg` + `/lg/*` (NOT `*`): mounted at "/", this
// router must run its host→site resolution ONLY for /lg requests and otherwise
// fall through cleanly to the next app (the admin-host net, then publicRouter).
//
// Reserved head: /lg/attempt + /lg/config (P7), /lg/auction (P10), /lg/track +
// /lg/lc (P11 Stage B), and now /lg/pb/:provider + /lg/px/:token (P13 Stage B)
// are all registered BEFORE the single-segment /lg/:quote_slug param route so
// the slug catch never swallows them. /lg/pb + /lg/auction run the §30.4
// runtimeRequestGuard (blocklist → rate limit → bot) BEFORE any money write /
// provider fetch; a block returns the guard's typed status (no-store) and the
// auction/ingest never runs.

import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../../env";
import { publicSiteContextMiddleware, type PublicSiteVariables } from "../middleware";
import { serveFunnelShell, serveLeadgenConfig, serveLeadgenAttempt } from "./serve";
import { serveLeadgenAuction } from "./serve-auction";
import { runtimeRequestGuard, type GuardOutcome } from "./runtime-guard";
import { ingestProviderPostback, ingestBrowserPixel } from "./postback";
import { leadgenTrackRouter } from "../../analytics/leadgen-track";
import { resolveLeadgenClick, type LeadgenClickInput } from "./click";
import type { LeadgenCapOffer } from "../../leadgen/caps";
import type { LeadgenParsedCarrier } from "./auction/parse";
import type { LeadgenEvent } from "../../analytics/leadgen-events";

type PublicContext = Context<{ Bindings: Env; Variables: PublicSiteVariables }>;

const leadgenPublicRouter = new Hono<{ Bindings: Env; Variables: PublicSiteVariables }>();

// host→site for every /lg* route (admin host → safe 404 upstream).
leadgenPublicRouter.use("/lg", publicSiteContextMiddleware);
leadgenPublicRouter.use("/lg/*", publicSiteContextMiddleware);

// ---------------------------------------------------------------------------
// /lg/lc — the P11 governed click resolver route (§19 step 16 / §4.3 no-store).
// ---------------------------------------------------------------------------

// Hono's c.executionCtx GETTER throws where no ExecutionContext exists (unit-
// test harnesses); the resolver's Firehose emit rides waitUntil, so the context
// is captured once behind a no-op fallback (the listicles/leadgen idiom).
function safeExecutionCtx(c: { executionCtx: ExecutionContext }): ExecutionContext {
  try {
    return c.executionCtx;
  } catch {
    return {
      waitUntil(): void {
        /* no-op outside workerd */
      },
      passThroughOnException(): void {
        /* no-op */
      },
    } as unknown as ExecutionContext;
  }
}

// Dedicated JSON parse (D1 JSON-parse safety) — a corrupt blob degrades to null,
// never throws (the click must resolve fail-open).
function parseJsonSafe(raw: string | null): unknown {
  if (raw === null || raw === "") return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

// Pick the winning carrier out of a persisted parsed_carriers_json array by its
// carrier_key. Its http(s) click_url is the resolver's primary destination
// (07 §20 "a usable provider click_url wins"); its name/bid stamp the events.
function findParsedCarrier(parsedCarriersJson: string | null, carrierKey: string): LeadgenParsedCarrier | null {
  const parsed = parseJsonSafe(parsedCarriersJson);
  if (!Array.isArray(parsed)) return null;
  for (const entry of parsed) {
    if (
      entry !== null &&
      typeof entry === "object" &&
      (entry as { carrier_key?: unknown }).carrier_key === carrierKey
    ) {
      return entry as LeadgenParsedCarrier;
    }
  }
  return null;
}

// The click context the /lg/lc resolver needs, loaded from persistence by the
// opaque ids the governed banner href carries (ck/aiid/brid/slot/faid + the
// path offer_id). ALL reads are .bind()-parameterized over fixed tables and
// fail-open (a load miss degrades to a null field; the resolver still mints the
// click_id, counts the click, and either 302s or safely does not).
interface LoadedClickContext {
  offer: LeadgenCapOffer | null;
  banner_url_template: string | null;
  carrier: LeadgenParsedCarrier | null;
  response_context: unknown;
  removal_scope: "offer" | "carrier";
  auction_id: number | null;
  session_id: string | null;
  event_context: Partial<LeadgenEvent>;
}

// SOURCE OF THE CLICK CONTEXT (documented, §19 step 16 / RED LINE 1):
//   * OFFER (banner_url_template + the §10.6 cap projection + the numeric id the
//     clicked row FKs) ← leadgen_offers by public_id.
//   * WINNING CARRIER + {response:*} CONTEXT ← leadgen_provider_request_log by
//     (auction_instance_id, offer_public_id): parsed_carriers_json yields the
//     carrier (its provider click_url WINS when http(s)); response_redacted_json
//     is the durable, non-sensitive projection {response:<path>} resolves over
//     (redactPii passes non-PII body fields through byte-identical; the FULL raw
//     response is NEVER persisted unredacted — RED LINE 1 keeps it in the 72h AES
//     debug blob only). A required {response:*} whose field is absent there
//     resolves required-missing → safe non-302 (the click still counts), which is
//     exactly §10.5's click-time required-missing semantics.
//   * removal_scope + numeric auction id + funnel/variant/session event dims ←
//     leadgen_auction_result_log by auction_instance_id → leadgen_auctions by its
//     auction_config_id (public_id).
// Request-derived canonical macros beyond {click_id} (which the resolver injects
// from the freshly-minted id) are NOT carried on the governed href, so a
// banner_url_template referencing other canonical macros resolves them empty at
// click time — the dominant destination is the provider click_url or a
// {response:*}+{click_id} template, neither of which needs them.
async function loadLeadgenClickContext(
  db: D1Database,
  params: { offerPublicId: string; auctionInstanceId: string; carrierKey: string },
): Promise<LoadedClickContext> {
  const out: LoadedClickContext = {
    offer: null,
    banner_url_template: null,
    carrier: null,
    response_context: null,
    removal_scope: "offer",
    auction_id: null,
    session_id: null,
    event_context: {},
  };

  // Offer: the cap projection (LeadgenCapOffer) + banner_url_template + a couple
  // of safe event dims. `id` is the FK for the remove-clicked row.
  if (params.offerPublicId !== "") {
    try {
      const row = await db
        .prepare(
          "SELECT id, banner_url_template, offer_name, provider, cap_enabled, cap_amount, cap_timezone, cap_count_by, cap_fallback_offer_id, cap_fallback_url FROM leadgen_offers WHERE public_id = ? LIMIT 1",
        )
        .bind(params.offerPublicId)
        .first<{
          id: number;
          banner_url_template: string | null;
          offer_name: string;
          provider: string | null;
          cap_enabled: number;
          cap_amount: number | null;
          cap_timezone: string | null;
          cap_count_by: "clicks" | "conversions" | null;
          cap_fallback_offer_id: number | null;
          cap_fallback_url: string | null;
        }>();
      if (row !== null) {
        out.offer = {
          id: row.id,
          cap_enabled: row.cap_enabled,
          cap_amount: row.cap_amount,
          cap_timezone: row.cap_timezone,
          cap_count_by: row.cap_count_by,
          cap_fallback_offer_id: row.cap_fallback_offer_id,
          cap_fallback_url: row.cap_fallback_url,
        };
        out.banner_url_template = row.banner_url_template;
        out.event_context.offer_id = params.offerPublicId;
        out.event_context.offer_name = row.offer_name;
        if (row.provider !== null) out.event_context.provider = row.provider;
      }
    } catch {
      // fail-open: an offer-load miss just leaves the resolver without a cap /
      // template (a usable carrier click_url can still 302).
    }
  }

  // Winning carrier + {response:*} context from the redacted provider log.
  if (params.auctionInstanceId !== "" && params.offerPublicId !== "") {
    try {
      const row = await db
        .prepare(
          "SELECT parsed_carriers_json, response_redacted_json FROM leadgen_provider_request_log WHERE auction_instance_id = ? AND offer_public_id = ? LIMIT 1",
        )
        .bind(params.auctionInstanceId, params.offerPublicId)
        .first<{ parsed_carriers_json: string | null; response_redacted_json: string | null }>();
      if (row !== null) {
        out.carrier = findParsedCarrier(row.parsed_carriers_json, params.carrierKey);
        out.response_context = parseJsonSafe(row.response_redacted_json);
      }
    } catch {
      // fail-open.
    }
  }

  // Result log → funnel/variant/session dims + auction_config_id → the auction's
  // removal_scope + numeric id.
  if (params.auctionInstanceId !== "") {
    try {
      const row = await db
        .prepare(
          "SELECT auction_config_id, session_id, funnel_id, funnel_variant_id FROM leadgen_auction_result_log WHERE auction_instance_id = ? LIMIT 1",
        )
        .bind(params.auctionInstanceId)
        .first<{
          auction_config_id: string | null;
          session_id: string | null;
          funnel_id: string | null;
          funnel_variant_id: string | null;
        }>();
      if (row !== null) {
        out.session_id = row.session_id;
        if (row.funnel_id !== null) out.event_context.funnel_id = row.funnel_id;
        if (row.funnel_variant_id !== null) out.event_context.funnel_variant_id = row.funnel_variant_id;
        if (row.auction_config_id !== null) {
          out.event_context.auction_config_id = row.auction_config_id;
          const auction = await db
            .prepare("SELECT id, removal_scope FROM leadgen_auctions WHERE public_id = ? LIMIT 1")
            .bind(row.auction_config_id)
            .first<{ id: number; removal_scope: "offer" | "carrier" }>();
          if (auction !== null) {
            out.auction_id = auction.id;
            out.removal_scope = auction.removal_scope === "carrier" ? "carrier" : "offer";
          }
        }
      }
    } catch {
      // fail-open.
    }
  }

  return out;
}

// GET /lg/lc/:offer_id — resolve the governed click, mint the click_id, count it
// (cap + remove-clicked + carrier_click/offer_click), and 302 to the resolved
// destination. NEVER 302 to a broken/non-http URL: a required-missing / unsafe /
// no-target resolution returns a safe 204 no-redirect (the click STILL counted).
// no-store (§4.3). Tenant-host only (the /lg mount middleware 404s the admin host).
async function serveLeadgenClick(c: PublicContext): Promise<Response> {
  const offerPublicId = c.req.param("offer_id") ?? "";
  const carrierKey = c.req.query("ck") ?? "";
  const auctionInstanceId = c.req.query("aiid") ?? "";
  const bannerRenderId = c.req.query("brid") ?? "";
  const slotRaw = c.req.query("slot") ?? "";
  const funnelAttemptId = c.req.query("faid") ?? "";
  const slot = /^\d+$/.test(slotRaw) ? Number(slotRaw) : null;

  const execCtx = safeExecutionCtx(c);
  const ctx = await loadLeadgenClickContext(c.env.DB, { offerPublicId, auctionInstanceId, carrierKey });

  const input: LeadgenClickInput = {
    offer_public_id: offerPublicId,
    carrier_key: carrierKey,
    auction_instance_id: auctionInstanceId,
    banner_render_id: bannerRenderId,
    slot,
    funnel_attempt_id: funnelAttemptId,
    session_id: ctx.session_id,
    auction_id: ctx.auction_id,
    carrier: ctx.carrier,
    banner_url_template: ctx.banner_url_template,
    response_macro_fallbacks: null,
    response_context: ctx.response_context,
    canonical_macros: {},
    offer: ctx.offer,
    removal_scope: ctx.removal_scope,
    event_context: ctx.event_context,
  };

  const result = await resolveLeadgenClick(c.env, execCtx, input);

  // 302 to the resolved destination (no-store). The Response ctor THROWS on a
  // control char in Location — resolveLeadgenClick already gates to a safe
  // http(s) URL, but the construction is guarded so a click never 500s.
  if (result.redirect && result.destination_url !== null) {
    try {
      return new Response(null, {
        status: 302,
        headers: {
          Location: result.destination_url,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      // fall through to the safe no-redirect — the click was already counted.
    }
  }
  // required-missing / unsafe / no-target → safe non-302 (never a broken URL).
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

// POST /lg/track — the P11 beacon. Reuses the Stage-A leadgenTrackRouter handler
// verbatim (fire-and-forget, always 204, fail-open, §22.5) and stamps the §4.3
// no-store posture onto the mount (the handler itself is header-agnostic). The
// /lg/* middleware above already ran (tenant-host; admin host → 404) before this
// direct route, so the beacon is public + tenant-scoped + never body-reflecting.
async function serveLeadgenTrack(c: PublicContext): Promise<Response> {
  let execCtx: ExecutionContext | undefined;
  try {
    execCtx = c.executionCtx;
  } catch {
    execCtx = undefined;
  }
  const res = await leadgenTrackRouter.fetch(c.req.raw, c.env, execCtx);
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(res.body, { status: res.status, headers });
}

// §30.4 guard-block response: the guard's typed status (403 blocklist/bot, 429
// rate-limit), no-store, no body reflection — returned BEFORE the auction runs /
// any money write happens (mirrors serve-auction's no-provider-call posture).
function guardBlockResponse(guard: Extract<GuardOutcome, { ok: false }>): Response {
  return new Response(JSON.stringify({ error: "blocked", reason: guard.reason }), {
    status: guard.status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// POST /lg/auction with the §30.4 guard retrofitted FIRST: a block short-circuits
// to the guard's status (no-store) WITHOUT running the auction (no provider call,
// no writes) — exactly serve-auction.ts's tamper/no-auction posture.
async function serveLeadgenAuctionGuarded(c: PublicContext): Promise<Response> {
  const guard = await runtimeRequestGuard(c.env, c.req.raw);
  if (!guard.ok) return guardBlockResponse(guard);
  return serveLeadgenAuction(c);
}

// POST/GET /lg/pb/:provider — the §25 provider postback. The §30.4 guard runs
// FIRST (before any money write); a block returns the guard's status no-store.
async function serveLeadgenPostback(c: PublicContext): Promise<Response> {
  // §30.4 guard with skipBotDetection: a provider postback is a datacenter IP +
  // non-browser UA, so the browser-IVT bot arm would 403 every legitimate
  // tokened provider (silent revenue loss). blocklist + rate-limit still run;
  // the per-provider token (§30.2) is this endpoint's legitimate-vs-abuse auth.
  const guard = await runtimeRequestGuard(c.env, c.req.raw, { skipBotDetection: true });
  if (!guard.ok) return guardBlockResponse(guard);
  const provider = c.req.param("provider") ?? "";
  return ingestProviderPostback(c.env, safeExecutionCtx(c), provider, c.req.raw);
}

// GET /lg/px/:token — the §27 browser pixel (no guard per §30.4, which scopes the
// guard to /lg/auction + /lg/pb; the pixel books only CLEAN traffic + a 1x1 GIF).
async function serveLeadgenPixel(c: PublicContext): Promise<Response> {
  const token = c.req.param("token") ?? "";
  return ingestBrowserPixel(c.env, safeExecutionCtx(c), token, c.req.raw);
}

// Static/two-segment /lg heads BEFORE the single-segment /lg/:quote_slug param
// route so `attempt` / `config/:id` / `auction` / `track` and the 3-segment
// `lc/:offer_id` + `pb/:provider` + `px/:token` are never swallowed by the slug
// catch. /lg/auction (P10 §19) + /lg/track (P11 §22) + /lg/pb (P13 §25) are POST
// + no-store; /lg/lc (P11 §19.16) + /lg/px (P13 §27) are GET.
leadgenPublicRouter.get("/lg/attempt", (c) => serveLeadgenAttempt(c));
leadgenPublicRouter.get("/lg/config/:funnel_variant_id", (c) => serveLeadgenConfig(c));
leadgenPublicRouter.post("/lg/auction", (c) => serveLeadgenAuctionGuarded(c));
leadgenPublicRouter.post("/lg/track", (c) => serveLeadgenTrack(c));
leadgenPublicRouter.get("/lg/lc/:offer_id", (c) => serveLeadgenClick(c));
// P13 §25/§27: the revenue-intake routes, registered BEFORE /lg/:quote_slug.
leadgenPublicRouter.post("/lg/pb/:provider", (c) => serveLeadgenPostback(c));
leadgenPublicRouter.get("/lg/pb/:provider", (c) => serveLeadgenPostback(c));
leadgenPublicRouter.get("/lg/px/:token", (c) => serveLeadgenPixel(c));
leadgenPublicRouter.get("/lg", (c) => serveFunnelShell(c, null));
leadgenPublicRouter.get("/lg/:quote_slug", (c) => serveFunnelShell(c, c.req.param("quote_slug")));

export { leadgenPublicRouter };
export default leadgenPublicRouter;
