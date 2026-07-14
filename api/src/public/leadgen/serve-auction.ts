// LeadGen §19 runtime — POST /lg/auction (contract 03 §8.3, no-store; 07 §19 +
// §19.1 anti-tamper + §28 non-blocking; 09 §30.3/§30.4). Phase 10 STAGE B.
//
// The money-path funnel-terminal endpoint: the client POSTs its signed binding
// + raw answers after the last section; the server re-validates the binding
// (RED LINE 2 — a mismatch is 422 + traffic_quality_flag='tampered', NO provider
// calls, NO writes), re-normalizes the answers server-side (RED LINE 3 — never
// trust client values), runs the §19 auction (runAuction), and returns the
// rendered banners. Every write (result log + redacted provider log + the
// AES-encrypted debug_ref blob, RED LINE 1) is registered on ctx.waitUntil so it
// never blocks the response and fails open (§28).
//
// Served on TENANT hosts only (the /lg mount's publicSiteContextMiddleware 404s
// the admin host). The funnel is resolved from the request's funnel_variant_id
// via the P7 anti-leak reverse lookup (resolveActivatedFunnelByVariant) — a
// foreign / non-activated variant is a clean 404, never a config oracle.
//
// The response is no-store JSON carrying ONLY the rendered banners + a status
// (no explain trace, no provider internals, no secrets — the §19.2 trace is the
// admin-only /auctions/:id/simulate view). Backfill XOR obfuscation (§30.4) is
// DEFERRED (reported): the core §19 pipeline + backfill land here; the optional
// XOR wire-obfuscation of the backfill payload is a follow-up hardening.

import type { Context } from "hono";
import { readEnvSecret, type Env } from "../../env";
import type { PublicSiteVariables } from "../middleware";
import { readCookie } from "../listicle/experiment-pick";
import { resolveActivatedFunnelByVariant, type ResolvedActivatedFunnel } from "./resolver";
import { leadgenNoStoreHeaders } from "./serve";
import {
  loadAuctionBundle,
  persistAuctionResult,
  runAuction,
  type AntiTamperInput,
} from "./auction/engine";
import { emitLeadgenRecords } from "../../analytics/leadgen-events";
import type { ClickedRef } from "../../leadgen/auction-core";
// v3.1 §9 (S3-5 + S3-6): the server-side Maps validate leg + auction facet.
import {
  collectMapsAuctionFields,
  deriveAuctionFacet,
  normalizeAnswers,
  type LeadgenMapsFieldEnrichment,
  type LeadgenRawAnswers,
} from "../../leadgen/answers";
import { validateAddress, GOOGLE_MAPS_SERVER_KEY, type LeadgenLocationFacet } from "../../leadgen/maps";
import type { LeadgenSectionContent } from "./components/content-schema";
import type { LeadgenAuctionRow, LeadgenEnvironment } from "../../admin/leadgen/db-types";

type PublicContext = Context<{ Bindings: Env; Variables: PublicSiteVariables }>;

// The live funnel always calls provider PRODUCTION endpoints (staging is the
// admin Test tool / a simulate opt-in).
const RUNTIME_ENVIRONMENT: LeadgenEnvironment = "production";

function jsonNoStore(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), { status, headers: leadgenNoStoreHeaders() });
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Derive the SERVER-side rule dims (never trusted from the client body): device
// from the User-Agent, geo from the Cloudflare request properties. The lead's
// DECLARED geo (answered state/zip/city) is merged OVER these in the engine, so
// these only fill dims the lead did not answer (07 §21.4 device/geo).
function buildRequestContext(c: PublicContext): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};
  const ua = c.req.header("User-Agent") ?? "";
  if (ua !== "") {
    const lower = ua.toLowerCase();
    ctx["device"] = /mobi|android|iphone|ipod/.test(lower)
      ? "mobile"
      : /ipad|tablet/.test(lower)
        ? "tablet"
        : "desktop";
  }
  const cf = (c.req.raw as { cf?: Record<string, unknown> }).cf;
  if (isRecord(cf)) {
    if (typeof cf["country"] === "string") ctx["country"] = cf["country"];
    if (typeof cf["regionCode"] === "string") ctx["state"] = cf["regionCode"];
    if (typeof cf["city"] === "string") ctx["city"] = cf["city"];
    if (typeof cf["postalCode"] === "string") ctx["zip"] = cf["postalCode"];
  }
  return ctx;
}

// The active auction config for the resolved variant (variant.auction_id →
// leadgen_auctions). null when the variant has no/paused auction.
async function loadAuctionRow(db: D1Database, auctionId: number): Promise<LeadgenAuctionRow | null> {
  const row = await db
    .prepare("SELECT * FROM leadgen_auctions WHERE id = ? AND status = 'active' LIMIT 1")
    .bind(auctionId)
    .first<LeadgenAuctionRow>();
  return row ?? null;
}

// 03 §3.6: the client engine POSTs answers as
// Record<internal_field, {value, answer_source}>. Unwrap the envelope into the
// raw-value map normalizeAnswers consumes (RED LINE 3 re-normalizes them
// server-side regardless); bare raw values are accepted too (legacy shape).
function unwrapAnswers(raw: Record<string, unknown>): LeadgenRawAnswers {
  const out: Record<string, unknown> = {};
  for (const [field, entry] of Object.entries(raw)) {
    if (isRecord(entry) && "value" in entry) {
      out[field] = entry["value"];
    } else {
      out[field] = entry;
    }
  }
  return out as LeadgenRawAnswers;
}

// The already-clicked offers/carriers for this funnel attempt (07 §18.7 remove-
// clicked). Joined to the Offer public_id the engine keys on.
async function loadClickedOffers(db: D1Database, funnelAttemptId: string): Promise<ClickedRef[]> {
  if (funnelAttemptId === "") return [];
  const rows = await db
    .prepare(
      `SELECT o.public_id AS offer_public_id, c.carrier_key AS carrier_key
         FROM leadgen_session_clicked_offers c
         JOIN leadgen_offers o ON o.id = c.offer_id
        WHERE c.funnel_attempt_id = ?`,
    )
    .bind(funnelAttemptId)
    .all<{ offer_public_id: string; carrier_key: string }>();
  return (rows.results ?? []).map((r) => ({ offer_public_id: r.offer_public_id, carrier_key: r.carrier_key }));
}

// Parse a section's content_json to the component list the Maps legs read
// (dedicated try/catch — a corrupt blob yields no Maps fields, never throws;
// the D1 JSON-parse safety rule).
function sectionContentForMaps(contentJson: string): LeadgenSectionContent {
  try {
    const parsed = JSON.parse(contentJson) as unknown;
    if (isRecord(parsed) && Array.isArray(parsed["components"])) {
      return { components: parsed["components"] } as LeadgenSectionContent;
    }
  } catch {
    /* corrupt content_json — no Maps fields */
  }
  return { components: [] } as LeadgenSectionContent;
}

// v3.1 §9 (S3-5 + S3-6) — the server-side Maps legs, run on the money path
// BEFORE the auction payload build. Two effects, both fail-open and gated:
//   * GEOCODE: for each ZIP-family field carrying EITHER job (validate OR
//     auction — adversarial-review MAJOR F1: an auction-only field still
//     needs the server-side geocode to enrich its facet with state/city, §9
//     "Emits a resolved location facet (state/city/ZIP)" — gating this on
//     validate alone left an auction-only field ZIP-only even WITH the key,
//     contradicting the Maps-tab degradation note's own promise), run
//     validateAddress on the NORMALIZED ZIP. Absent GOOGLE_MAPS_SERVER_KEY ⇒
//     the whole leg is SKIPPED (no KV read, no fetch) so a keyless funnel
//     behaves byte-identically to pre-R4b; an `ok` result records its
//     {city,state} enrichment.
//   * VALIDATE (S3-5) drop: an `invalid` result DROPS the answer ONLY when the
//     field carries the validate job (the SAME "invalid answer is omitted"
//     discipline normalizeAnswers already uses — never a new rejection
//     channel) — validate is the only job with rejection semantics. An
//     auction-only field never drops on a malformed ZIP: it simply derives no
//     facet (deriveLocationFacet's own ZIP check yields null) and the answer
//     is kept. The drop rides the RAW answers the engine re-normalizes, so it
//     flows into BOTH the payload build (RED LINE 3) and the facet.
//   * FACET (S3-6): deriveAuctionFacet builds the ZIP location facet for the
//     auction-job fields (ZIP-only without the key OR on a geocode no_op;
//     state/city-enriched with a successful geocode).
// validateAddress is itself total (never throws), so this never throws either.
async function applyMapsAuctionLegs(
  env: Env,
  resolved: ResolvedActivatedFunnel,
  rawAnswers: LeadgenRawAnswers,
): Promise<{ rawAnswers: LeadgenRawAnswers; locationFacet: Record<string, unknown> | null }> {
  const hasServerKey = readEnvSecret(env, GOOGLE_MAPS_SERVER_KEY) !== undefined;
  const working: Record<string, unknown> = { ...rawAnswers };
  const enrichment: Record<string, LeadgenMapsFieldEnrichment> = {};

  // Validate leg — gated on the server key so a keyless funnel is a pure no-op.
  if (hasServerKey) {
    for (const rs of resolved.sections) {
      const content = sectionContentForMaps(rs.section.content_json);
      const fields = collectMapsAuctionFields(content);
      if (fields.length === 0) continue;
      const { answers } = normalizeAnswers(content, working as LeadgenRawAnswers);
      for (const f of fields) {
        // collectMapsAuctionFields only returns fields with validate and/or
        // auction true (never neither) — both jobs need the geocode; only
        // validate has rejection semantics (MAJOR F1 fix below).
        const zipVal = answers[f.zipField];
        if (typeof zipVal !== "string") continue;
        const result = await validateAddress(env, { zip: zipVal });
        if (result.status === "invalid") {
          // Only the VALIDATE job drops the answer on a malformed ZIP; an
          // auction-only field keeps it (no facet derives, but nothing is
          // rejected — auction carries no rejection semantics).
          if (f.validate) delete working[f.zipField]; // omit the invalid answer (drop discipline)
        } else if (result.status === "ok") {
          const e: LeadgenMapsFieldEnrichment = {};
          if (typeof result.city === "string" && result.city !== "") e.city = result.city;
          if (typeof result.state === "string" && result.state !== "") e.state = result.state;
          if (e.city !== undefined || e.state !== undefined) enrichment[f.zipField] = e;
        }
        // no_op ⇒ leave the answer intact (a geocode miss is not a rejection).
      }
    }
  }

  // Facet leg — derived from the (post-drop) answers + any server enrichment.
  let locationFacet: LeadgenLocationFacet | null = null;
  for (const rs of resolved.sections) {
    const content = sectionContentForMaps(rs.section.content_json);
    const { answers } = normalizeAnswers(content, working as LeadgenRawAnswers);
    locationFacet = deriveAuctionFacet(content, answers, enrichment);
    if (locationFacet !== null) break;
  }
  // Spread the facet into a fresh record so it merges as bare rule dims
  // ({zip,state,city}) in the engine's eval context (the interface itself has
  // no index signature).
  return {
    rawAnswers: working as LeadgenRawAnswers,
    locationFacet: locationFacet === null ? null : { ...locationFacet },
  };
}

// POST /lg/auction — the §19 runtime. no-store (§8.3). Non-blocking writes on
// ctx.waitUntil (§28). Never throws into the router.
export async function serveLeadgenAuction(c: PublicContext): Promise<Response> {
  const siteContext = c.get("siteContext");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonNoStore({ error: "Invalid JSON body" }, 400);
  }
  if (!isRecord(body)) return jsonNoStore({ error: "Invalid JSON body" }, 400);

  const variantId = asString(body["funnel_variant_id"]);
  if (variantId === "") return jsonNoStore({ error: "funnel_variant_id is required" }, 400);

  // P7 anti-leak reverse lookup: a foreign / non-activated variant → 404 (never
  // a cross-tenant config oracle).
  const resolved = await resolveActivatedFunnelByVariant(c.env, siteContext.siteId, variantId);
  if (resolved === null) return jsonNoStore({ error: "Not Found" }, 404);

  // The variant's auction config. No auction → nothing to run (200, empty).
  const auctionId = resolved.variant.auction_id;
  if (auctionId === null) return jsonNoStore({ status: "no_auction", banners: [], banners_html: "" }, 200);
  const auction = await loadAuctionRow(c.env.DB, auctionId);
  if (auction === null) return jsonNoStore({ status: "no_auction", banners: [], banners_html: "" }, 200);

  // The signed anti-tamper binding + the UNTRUSTED raw answers. session_id /
  // page_view_id are the POSTed values (04 §4.2 — session_id is v2
  // crypto-bound by the tuple, so a forged session rejects at step 1).
  const funnelAttemptId = asString(body["funnel_attempt_id"]);
  const sessionId = asString(body["session_id"]) || readCookie(c.req.header("Cookie") ?? null, "ko_sid") || null;
  const pageViewId = asString(body["page_view_id"]);
  // Legacy ARRAY shape only for the pre-v2 equality check; the 03 §3.6 Record
  // shape (section_public_id → version) is accepted but NOT equality-checked
  // here — the v2 answer_mapping_hash tuple field is its cryptographic gate.
  const answerMappingVersions = Array.isArray(body["answer_mapping_versions"])
    ? (body["answer_mapping_versions"] as unknown[]).filter((v): v is string | number => typeof v === "string" || typeof v === "number")
    : undefined;
  const auctionConfigVersion =
    typeof body["auction_config_version"] === "string" || typeof body["auction_config_version"] === "number"
      ? (body["auction_config_version"] as string | number)
      : undefined;
  const binding: AntiTamperInput = {
    funnel_variant_id: variantId,
    funnel_attempt_id: funnelAttemptId,
    section_order_hash: asString(body["section_order_hash"]),
    signed_config_token: asString(body["signed_config_token"]),
    ...(answerMappingVersions !== undefined ? { answer_mapping_versions: answerMappingVersions } : {}),
    ...(auctionConfigVersion !== undefined ? { auction_config_version: auctionConfigVersion } : {}),
    session_id: sessionId,
  };
  const rawAnswers = isRecord(body["answers"]) ? unwrapAnswers(body["answers"]) : {};

  const bundle = await loadAuctionBundle(c.env.DB, auction, resolved.variant.id);
  const clicked = await loadClickedOffers(c.env.DB, funnelAttemptId);
  const requestContext = buildRequestContext(c);

  // v3.1 §9 (S3-5 + S3-6): run the server-side Maps validate leg (drops invalid
  // ZIPs, gated on the server key) + derive the auction location facet, BEFORE
  // the auction runs — the (possibly filtered) answers feed the engine's
  // re-normalization/payload build, the facet feeds the middle tier of the eval
  // context (declared answer > facet > CF geo).
  const maps = await applyMapsAuctionLegs(c.env, resolved, rawAnswers);

  const result = await runAuction(
    c.env,
    {
      resolved,
      bundle,
      environment: RUNTIME_ENVIRONMENT,
      binding,
      session_id: sessionId,
      raw_answers: maps.rawAnswers,
      request_context: requestContext,
      location_facet: maps.locationFacet ?? undefined,
      // 04 §4.7 site 1: the live request feeds the canonical context builder's
      // request/cf slices; the traffic slice comes from the VERIFIED token's
      // landing_url inside the engine. Overrides are NEVER accepted here (B5
      // is the admin Test tool's alone — this public route reads none).
      runtime: { source: c.req.raw, page_view_id: pageViewId },
      clicked,
    },
    { dryRun: false },
  );

  // RED LINE 2: a tampered binding is 422 + tampered flag, NO writes.
  if (result.status === "tampered") {
    return jsonNoStore({ error: "auction binding validation failed", traffic_quality_flag: "tampered" }, 422);
  }

  // §28 non-blocking, fail-open writes: result log + redacted provider log + the
  // AES debug_ref blob (RED LINE 1). Registered on ctx.waitUntil; a harness
  // without an ExecutionContext lets the promise settle on its own.
  const writes = persistAuctionResult(c.env, result).catch(() => {
    /* fail-open (§28): a write failure never breaks the response */
  });
  try {
    c.executionCtx.waitUntil(writes);
  } catch {
    void writes;
  }

  // 10 §10.2: the SERVER emits the auction-path telemetry (auction_start,
  // per-offer request/response/timeout/error, carrier_eligible/filtered,
  // filled/unfilled — §5.4-stamped). Clients never own auction truth.
  // Fail-open like every beacon (emitLeadgenRecords no-ops without stream).
  try {
    emitLeadgenRecords(c.env, c.executionCtx, [...result.events]);
  } catch {
    /* fail-open: telemetry never breaks the auction response */
  }

  // 03 §3.6 response: banners_html (existing) + auction_result_id +
  // banner_render_id + impressions[] (R7 — the server half the client engine
  // beacons on viewability) + unfilled?:true.
  const unfilled = result.status === "unfilled" || result.status === "no_bid";
  return jsonNoStore(
    {
      status: result.status,
      auction_instance_id: result.auction_instance_id,
      auction_result_id: result.auction_result_id,
      banner_render_id: result.banner_render_ids[0] ?? "",
      banners_css: result.banners_css,
      banners_html: result.banners_html,
      banners: result.banners.map((b) => ({
        slot: b.slot,
        carrier_key: b.carrier_key,
        offer_public_id: b.offer_public_id,
        source: b.source,
        bid: b.bid,
        click_url: b.click_url,
      })),
      impressions: result.impression_rows,
      unfilled_reason: result.explain.unfilled_reason,
      ...(unfilled ? { unfilled: true as const } : {}),
      ...(result.redirect !== null ? { redirect: result.redirect } : {}),
    },
    200,
  );
}
