// LeadGen S19 auction runtime engine (contract 07 S19 steps 1-15 + S19.1
// anti-tamper + S19.2 explainability). Phase 10 STAGE B.
//
// This is the ORCHESTRATOR the `/lg/auction` route (runtime-routes.ts) and the
// `/auctions/:id/simulate` admin dry-run (auctions-handlers.ts) both drive. It
// COMPOSES the frozen engines -- it re-implements NONE of them:
//   * P9 auction-core: computeFloor / selectWinner / surfaceCarriers /
//     applyRemoveClicked / applyBackfill / backfillExhausted / toAuctionCarrier
//   * P9 auction-rules: evaluateOfferRules (offer participation) +
//     evaluateCarrierRules (carrier exclude PRE-floor, include-only POST-winner)
//   * P4 rules.ts evaluateRegionRules + caps.ts readCapStatus/capExceeded (READ
//     only -- the auction NEVER increments a cap; caps bump on click, P11)
//   * P4 payload.ts buildPayload (via fetch.ts) + parse.ts parseProviderResponse
//   * Stage-A fx.normalizeCarrierBidsToUsd, fetch.fetchProvidersParallel,
//     banner.renderBanners, explain.buildExplainTrace / toResultLogRow
//   * P7 attempt.verifyConfigToken + config-dto.computeSectionOrderHash,
//     answers.normalizeAnswers (server-side re-normalization -- never trust the
//     client's answer values, RED LINE 3)
//
// RED LINES honored here + at the route:
//   1. SECRET HANDLING (S30.2/S30.3). fetch.ts returns `redacted_log` (secrets
//      masked, PII hashed -- the ONLY thing that reaches D1) AND a separate
//      `debug` record carrying the FULL request incl. the secret IN CLEAR. This
//      engine passes `debug` through UNTOUCHED to the caller as `debug_record`;
//      persistAuctionResult encrypts it as an AES-GCM blob (KV lg-debug:<id>,
//      72h TTL) and stores ONLY an opaque debug_ref. The `debug` value NEVER
//      binds to a D1 column. Absent key => NO blob + NULL debug_ref.
//   2. ANTI-TAMPER (S19.1). runAuction step 1 (non-dry) validates the signed
//      binding BEFORE any provider call or FX/cap read: a mismatch => status
//      "tampered", http_status 422, traffic_quality_flag "tampered", NO provider
//      calls, NO writes.
//   3. NO CLIENT TRUST. Answers are re-normalized server-side from the section
//      content + the client-submitted raw answers (never the client values).
//
// dryRun=true (OQ-10): compute everything, WRITE NOTHING -- the caller does not
// call persistAuctionResult and no cap is incremented / no revenue booked.

import type { Env } from "../../../env";
import { ulid } from "../../../leadgen/ids";
import { verifyConfigToken, type ConfigTokenTuple } from "../attempt";
import { computeSectionOrderHash } from "../config-dto";
import type { ResolvedActivatedFunnel } from "../resolver";
import { normalizeAnswers, type LeadgenRawAnswers } from "../../../leadgen/answers";
import type { LeadgenSectionContent } from "../components/content-schema";
import {
  conditionsMatch,
  evaluateCarrierRules,
  evaluateOfferRules,
  type CarrierRuleInput,
  type LeadgenCarrierMatch,
  type OfferRuleInput,
} from "../../../leadgen/auction-rules";
import { evaluateRegionRules, type LeadgenRegionRuleInput } from "../../../leadgen/rules";
import { capExceeded, readCapStatus } from "../../../leadgen/caps";
import { normalizeCarrierBidsToUsd, type CarrierBidInput } from "../../../leadgen/fx";
import {
  applyBackfill,
  applyRemoveClicked,
  computeFloor,
  selectWinner,
  surfaceCarriers,
  toAuctionCarrier,
  type AuctionCarrier,
  type AuctionCoreSettings,
  type ClickedRef,
  type SurfacedCarrier,
  type SurfaceOffer,
} from "../../../leadgen/auction-core";
import {
  parseProviderResponse,
  slugifyCarrierName,
  type LeadgenParsedCarrier,
} from "./parse";
import { fetchProvidersParallel, type FetchProviderResult, type ParallelProviderRequest } from "./fetch";
import {
  renderBanners,
  type BannerRenderCarrier,
  type CarrierImpression,
  type RenderedBannerSlot,
} from "./banner";
import { getBannerDesign } from "../designs/registry";
import {
  buildExplainTrace,
  toResultLogRow,
  type AuctionExplainTrace,
  type AuctionResultLogRowInsert,
  type ExplainFilteredCarrier,
  type ExplainProviderRequested,
  type ExplainProviderResponded,
} from "./explain";
import { validatePayloadSchema, type LeadgenPayloadSchema } from "../../../leadgen/payload";
import {
  DEBUG_BLOB_TTL_SECONDS,
  DEBUG_ENCRYPTION_SECRET_NAME,
  DEBUG_REF_PREFIX,
  encryptDebugBlob,
  randomHex,
} from "../../../admin/leadgen/payload-builder-handlers";
import { readEnvSecret } from "../../../env";
import type {
  LeadgenAuctionConsideredOffer,
  LeadgenAuctionExcludedOffer,
  LeadgenAuctionRow,
  LeadgenAuctionRuleRow,
  LeadgenEnvironment,
  LeadgenFunnelRuleType,
  LeadgenOfferHeaderRow,
  LeadgenOfferRow,
  LeadgenRuleConditions,
} from "../../../admin/leadgen/db-types";

// ---------------------------------------------------------------------------
// Loaded auction bundle (READ-ONLY; safe to load in dry-run)
// ---------------------------------------------------------------------------

// One participating Offer + everything the pipeline needs to run it: the full
// Offer row, its resolved placement, headers, active payload schema (parsed +
// validated), carrier_parse config, and region rules.
export interface AuctionBundleOffer {
  offer: LeadgenOfferRow;
  placement_public_id: string | null;
  static_bid_override: number | null;
  static_order: number | null;
  headers: LeadgenOfferHeaderRow[];
  payload_schema: LeadgenPayloadSchema;
  carrier_parse_json: unknown;
  carrier_parse_version: number | null;
  region_rules: LeadgenRegionRuleInput[];
}

// One funnel rule (leadgen_funnel_rules) in the runtime shape used at step 4.
export interface AuctionFunnelRule {
  public_id: string;
  rule_type: LeadgenFunnelRuleType;
  conditions: LeadgenRuleConditions | null;
  target_offer_id: number | null;
  target_section_id: number | null;
  redirect_url: string | null;
  redirect_url_allowlisted: number;
  priority: number;
  enabled: number;
}

export interface AuctionBundle {
  auction: LeadgenAuctionRow;
  offers: AuctionBundleOffer[];
  // Raw S21 rules (both levels) -- split by rule_level at evaluation time.
  offer_rules: OfferRuleInput[];
  carrier_rules: CarrierRuleInput[];
  banner: { mode: "manual" | "automatic"; field_map_json: unknown } | null;
  banner_config_json: unknown;
  funnel_rules: AuctionFunnelRule[];
}

const EMPTY_SCHEMA: LeadgenPayloadSchema = { version: 1, root: { type: "object", children: [] } };

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

// Parse a stored schema_json into a usable LeadgenPayloadSchema; a broken /
// absent schema degrades to the empty schema (buildPayload -> {}), never throws.
function parseSchema(raw: string | null): LeadgenPayloadSchema {
  const parsed = parseJson(raw);
  if (parsed === null) return EMPTY_SCHEMA;
  const validation = validatePayloadSchema(parsed);
  return validation.ok ? (parsed as LeadgenPayloadSchema) : EMPTY_SCHEMA;
}

function parseConditions(raw: string | null): LeadgenRuleConditions | null {
  const parsed = parseJson(raw);
  if (parsed === null || typeof parsed !== "object") return null;
  const groups = (parsed as { groups?: unknown }).groups;
  return Array.isArray(groups) ? (parsed as LeadgenRuleConditions) : null;
}

// Load the full S19 bundle for an auction (READ-ONLY). `variantId` scopes the
// funnel rules (step 4). Every query is .bind()-parameterized over fixed tables.
export async function loadAuctionBundle(
  db: D1Database,
  auction: LeadgenAuctionRow,
  variantId: number | null,
): Promise<AuctionBundle> {
  // --- participating offers (enabled) + placement -------------------------
  const offerJoin = await db
    .prepare(
      `SELECT ao.static_order AS static_order, ao.static_bid_override AS static_bid_override,
              p.public_id AS placement_public_id, o.id AS offer_id
         FROM leadgen_auction_offers ao
         JOIN leadgen_offer_placements p ON p.id = ao.offer_placement_id
         JOIN leadgen_offers o ON o.id = ao.offer_id
        WHERE ao.auction_id = ? AND ao.enabled = 1 AND o.status = 'active'
        ORDER BY ao.static_order IS NULL, ao.static_order ASC, o.id ASC`,
    )
    .bind(auction.id)
    .all<{
      static_order: number | null;
      static_bid_override: number | null;
      placement_public_id: string;
      offer_id: number;
    }>();

  const offers: AuctionBundleOffer[] = [];
  for (const join of offerJoin.results ?? []) {
    const offer = await db
      .prepare("SELECT * FROM leadgen_offers WHERE id = ? LIMIT 1")
      .bind(join.offer_id)
      .first<LeadgenOfferRow>();
    if (offer === null) continue;

    const headers = await db
      .prepare("SELECT * FROM leadgen_offer_headers WHERE offer_id = ?")
      .bind(offer.id)
      .all<LeadgenOfferHeaderRow>();

    let payloadSchema: LeadgenPayloadSchema = EMPTY_SCHEMA;
    let carrierParseJson: unknown = null;
    let carrierParseVersion: number | null = null;
    if (offer.active_payload_schema_id !== null) {
      const schemaRow = await db
        .prepare(
          "SELECT schema_json, carrier_parse_json, carrier_parse_version FROM leadgen_offer_payload_schemas WHERE id = ? LIMIT 1",
        )
        .bind(offer.active_payload_schema_id)
        .first<{ schema_json: string; carrier_parse_json: string | null; carrier_parse_version: number }>();
      if (schemaRow !== null) {
        payloadSchema = parseSchema(schemaRow.schema_json);
        carrierParseJson = parseJson(schemaRow.carrier_parse_json);
        carrierParseVersion = schemaRow.carrier_parse_version;
      }
    }

    const regionRows = await db
      .prepare(
        "SELECT id, public_id, dimension, action, values_json, priority, enabled FROM leadgen_offer_region_rules WHERE offer_id = ? AND enabled = 1 ORDER BY priority ASC, id ASC",
      )
      .bind(offer.id)
      .all<{
        id: number;
        public_id: string;
        dimension: LeadgenRegionRuleInput["dimension"];
        action: LeadgenRegionRuleInput["action"];
        values_json: string;
        priority: number;
        enabled: number;
      }>();
    const region_rules: LeadgenRegionRuleInput[] = (regionRows.results ?? []).map((r) => {
      const values = parseJson(r.values_json);
      return {
        id: r.id,
        public_id: r.public_id,
        dimension: r.dimension,
        action: r.action,
        values: Array.isArray(values) ? (values.filter((v) => typeof v === "string") as string[]) : [],
        priority: r.priority,
        enabled: r.enabled,
      };
    });

    offers.push({
      offer,
      placement_public_id: join.placement_public_id,
      static_bid_override: join.static_bid_override,
      static_order: join.static_order,
      headers: headers.results ?? [],
      payload_schema: payloadSchema,
      carrier_parse_json: carrierParseJson,
      carrier_parse_version: carrierParseVersion,
      region_rules,
    });
  }

  // --- S21 auction rules (offer + carrier) --------------------------------
  const ruleRows = await db
    .prepare(
      "SELECT id, public_id, rule_level, target_offer_id, action, conditions_json, carrier_match_json, strictly_override, priority, enabled FROM leadgen_auction_rules WHERE auction_id = ? AND enabled = 1 ORDER BY priority ASC, id ASC",
    )
    .bind(auction.id)
    .all<LeadgenAuctionRuleRow>();

  // Map numeric target_offer_id -> the offer public_id the S21 offer-rule
  // evaluator keys on (its candidate ids are public_ids).
  const offerIdToPublic = new Map<number, string>();
  for (const b of offers) offerIdToPublic.set(b.offer.id, b.offer.public_id);

  const offer_rules: OfferRuleInput[] = [];
  const carrier_rules: CarrierRuleInput[] = [];
  for (const r of ruleRows.results ?? []) {
    const conditions = parseConditions(r.conditions_json);
    if (r.rule_level === "offer") {
      const targetPublic = r.target_offer_id === null ? "" : offerIdToPublic.get(r.target_offer_id) ?? "";
      offer_rules.push({
        rule_id: r.public_id,
        target_offer_id: targetPublic,
        action: r.action,
        conditions,
        strictly_override: r.strictly_override,
        priority: r.priority,
        enabled: r.enabled,
      });
    } else {
      const carrierMatch = parseJson(r.carrier_match_json);
      carrier_rules.push({
        rule_id: r.public_id,
        action: r.action,
        conditions,
        carrier_match: (carrierMatch as LeadgenCarrierMatch | null) ?? null,
        priority: r.priority,
        enabled: r.enabled,
      });
    }
  }

  // --- banner (mode + field_map) ------------------------------------------
  const bannerRow = await db
    .prepare("SELECT mode, field_map_json FROM leadgen_auction_banners WHERE auction_id = ? LIMIT 1")
    .bind(auction.id)
    .first<{ mode: "manual" | "automatic"; field_map_json: string }>();
  const banner = bannerRow === null ? null : { mode: bannerRow.mode, field_map_json: parseJson(bannerRow.field_map_json) };

  // --- funnel rules (step 4) ----------------------------------------------
  const funnel_rules: AuctionFunnelRule[] = [];
  if (variantId !== null) {
    const frRows = await db
      .prepare(
        "SELECT public_id, rule_type, conditions_json, target_offer_id, target_section_id, redirect_url, redirect_url_allowlisted, priority, enabled FROM leadgen_funnel_rules WHERE variant_id = ? AND enabled = 1 ORDER BY priority ASC, id ASC",
      )
      .bind(variantId)
      .all<{
        public_id: string;
        rule_type: LeadgenFunnelRuleType;
        conditions_json: string;
        target_offer_id: number | null;
        target_section_id: number | null;
        redirect_url: string | null;
        redirect_url_allowlisted: number;
        priority: number;
        enabled: number;
      }>();
    for (const r of frRows.results ?? []) {
      funnel_rules.push({
        public_id: r.public_id,
        rule_type: r.rule_type,
        conditions: parseConditions(r.conditions_json),
        target_offer_id: r.target_offer_id,
        target_section_id: r.target_section_id,
        redirect_url: r.redirect_url,
        redirect_url_allowlisted: r.redirect_url_allowlisted,
        priority: r.priority,
        enabled: r.enabled,
      });
    }
  }

  return { auction, offers, offer_rules, carrier_rules, banner, banner_config_json: parseJson(auction.banner_config_json), funnel_rules };
}

// ---------------------------------------------------------------------------
// S19.1 anti-tamper (RED LINE 2)
// ---------------------------------------------------------------------------

export interface AntiTamperInput {
  // The client-submitted binding.
  funnel_variant_id: string;
  funnel_attempt_id: string;
  section_order_hash: string;
  signed_config_token: string;
  // Optional additional S19.1 checks (the P7 HMAC token does NOT sign these --
  // see the reconciliation note below; present => equality-checked, mismatch =>
  // tamper; absent => skipped since P7 config-dto does not expose them yet).
  answer_mapping_versions?: readonly (string | number)[];
  auction_config_version?: string | number;
  session_id?: string | null;
}

export type AntiTamperReason =
  | "variant_mismatch"
  | "section_order_hash_mismatch"
  | "signed_token_invalid"
  | "answer_mapping_version_mismatch"
  | "auction_config_version_mismatch";

export type AntiTamperVerdict = { ok: true } | { ok: false; reason: AntiTamperReason };

// Validate the S19.1 binding against the freshly-RESOLVED funnel.
//
// TUPLE RECONCILIATION (S19.1 prose vs the P7 attempt.ts token, REPORTED):
//   S19.1 prose signs {funnel_variant_id, funnel_attempt_id, session_id,
//   auction_config_version}. The SHIPPED P7 token (attempt.ts / config-dto)
//   instead signs {funnel_variant_id, section_order_hash, content_version,
//   funnel_attempt_id}. verifyConfigToken's ACTUAL tuple is the cryptographic
//   authority here, so a forged variant / reordered sections (different
//   section_order_hash) / stale content_version / forged attempt id all break
//   the HMAC or the tuple equality => reject. The two prose-only fields are
//   handled thus:
//     * session_id -- NOT in the P7 signed tuple, so it CANNOT be a crypto gate;
//       it is used only for clicked-offer scoping + logging (never a tamper
//       reject). REPORTED as a reconciliation gap.
//     * answer_mapping_version(s) + auction_config_version -- checked as NON-
//       crypto equality here when the client sends them (they post-date the P7
//       token). answer_mapping_version(s) reconcile against the resolved
//       sections' section_mapping_version (the value /lg/config exposes);
//       auction_config_version reconciles against the auction's
//       carrier_normalization_version (the only per-auction version column --
//       /lg/config does not expose an auction version, so a well-behaved client
//       omits it and the check is skipped). Any mismatch => tamper.
export async function validateAntiTamper(
  env: Env,
  resolved: ResolvedActivatedFunnel,
  auction: LeadgenAuctionRow,
  input: AntiTamperInput,
): Promise<AntiTamperVerdict> {
  // (a) forged variant -- the client-declared variant must be the served one.
  if (input.funnel_variant_id !== resolved.variant.public_id) {
    return { ok: false, reason: "variant_mismatch" };
  }

  // (b) reordered sections / stale content -- the client-submitted hash must
  // equal the server recomputation (also bound cryptographically below).
  const serverHash = computeSectionOrderHash(resolved);
  if (input.section_order_hash !== serverHash) {
    return { ok: false, reason: "section_order_hash_mismatch" };
  }

  // (c) the signed HMAC binding -- verifyConfigToken's actual tuple.
  const tuple: ConfigTokenTuple = {
    funnel_variant_id: resolved.variant.public_id,
    section_order_hash: serverHash,
    content_version: resolved.variant.content_version,
    funnel_attempt_id: input.funnel_attempt_id,
  };
  // requireSigned: the live /lg/auction path (validateAntiTamper is invoked
  // ONLY on the non-dry money path) must FAIL CLOSED — an unsigned token is
  // rejected even when LEADGEN_CONFIG_SIGNING_KEY is absent, so a misconfigured
  // deploy can never silently void anti-tamper.
  const tokenOk = await verifyConfigToken(env, input.signed_config_token, tuple, { requireSigned: true });
  if (!tokenOk) return { ok: false, reason: "signed_token_invalid" };

  // (d) answer_mapping_version(s) -- reconcile against the resolved sections
  // (order-sensitive) when the client sends them.
  if (input.answer_mapping_versions !== undefined) {
    const serverVersions = resolved.sections.map((s) => s.section.section_mapping_version);
    const client = input.answer_mapping_versions;
    if (client.length !== serverVersions.length) {
      return { ok: false, reason: "answer_mapping_version_mismatch" };
    }
    for (let i = 0; i < serverVersions.length; i++) {
      if (String(client[i]) !== String(serverVersions[i])) {
        return { ok: false, reason: "answer_mapping_version_mismatch" };
      }
    }
  }

  // (e) auction_config_version -- reconcile against the auction's version proxy
  // when the client sends it.
  if (input.auction_config_version !== undefined) {
    if (String(input.auction_config_version) !== String(auction.carrier_normalization_version)) {
      return { ok: false, reason: "auction_config_version_mismatch" };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// runAuction -- S19 steps 1-15
// ---------------------------------------------------------------------------

export interface RunAuctionInput {
  resolved: ResolvedActivatedFunnel;
  bundle: AuctionBundle;
  environment: LeadgenEnvironment;
  // The anti-tamper binding (validated at step 1 when !dryRun).
  binding: AntiTamperInput;
  session_id: string | null;
  // The UNTRUSTED client raw answers (re-normalized server-side, RED LINE 3).
  raw_answers: LeadgenRawAnswers;
  // Request-derived rule dims (device/geo) merged into the S21.4 eval context.
  request_context?: Readonly<Record<string, unknown>>;
  // Already-clicked offers/carriers for this funnel_attempt (remove-clicked).
  clicked: readonly ClickedRef[];
  // Injectables for deterministic tests.
  mintId?: () => string;
  now?: number;
  // Optional pre-baked provider results (bypasses fetch; tests may pass these
  // instead of stubbing global fetch). When absent, providers are fetched.
  providerResultsOverride?: { auction_request_id: string; results: FetchProviderResult[] };
  // Admin dry-run (/simulate) only: use these ALREADY-normalized internal
  // answers directly instead of re-normalizing from the resolved sections. The
  // live /lg/auction route NEVER sets this -- it always re-normalizes the raw
  // client answers server-side (RED LINE 3). A dry-run is an admin config-
  // exploration tool (Cloudflare Access gated, writes nothing), so it may
  // supply the internal answer space directly.
  normalizedAnswersOverride?: Readonly<Record<string, unknown>>;
}

export type RunAuctionStatus = "ok" | "tampered" | "disqualified" | "redirect" | "unfilled" | "no_bid";

// A provider_request_log row to persist, plus the SEPARATE unredacted debug
// record (RED LINE 1) -- the caller encrypts `debug_record` into the AES blob
// and stores ONLY the resulting opaque debug_ref. `debug_record` NEVER binds to
// a D1 column.
export interface ProviderLogRowToPersist {
  auction_instance_id: string;
  auction_request_id: string;
  provider_request_id: string;
  offer_public_id: string;
  placement_public_id: string | null;
  carrier_parse_version: number | null;
  environment: LeadgenEnvironment;
  status_code: number | null;
  latency_ms: number | null;
  request_headers_redacted_json: string;
  request_payload_redacted_json: string;
  response_redacted_json: string | null;
  parsed_carriers_json: string;
  provider_error_reason: string | null;
  error_text: string | null;
  // ENCRYPT-ONLY -- the full unredacted request/response (secret in clear). The
  // caller AES-encrypts this; it is NEVER a D1 column value.
  debug_record: unknown;
}

export interface RunAuctionResult {
  status: RunAuctionStatus;
  http_status: number;
  traffic_quality_flag: "tampered" | null;
  auction_instance_id: string;
  auction_result_id: string;
  auction_config_id: string;
  // Banner render output (empty on tamper/disqualify).
  banners_css: string;
  banners_html: string;
  banners: RenderedBannerSlot[];
  banner_render_ids: string[];
  carrier_impressions: CarrierImpression[];
  // S19.2 trace + the persistable result-log row.
  explain: AuctionExplainTrace;
  result_log_row: AuctionResultLogRowInsert | null;
  provider_log_rows: ProviderLogRowToPersist[];
  // Set when a funnel rule redirects (status "redirect").
  redirect: { target_offer_id: number | null; redirect_url: string | null } | null;
  // Convenience aggregate of every reason a carrier was filtered post-parse.
  carriers_filtered: ExplainFilteredCarrier[];
}

function auctionSettings(auction: LeadgenAuctionRow): AuctionCoreSettings {
  return {
    winner_logic: auction.winner_logic,
    floor_type: auction.floor_type,
    floor_value: auction.floor_value,
    multi_offer: auction.multi_offer,
    surface_static_bid_offers: auction.surface_static_bid_offers !== 0,
    banner_slots_count: auction.banner_slots_count,
    max_carriers_per_offer: auction.max_carriers_per_offer,
    max_total_carriers: auction.max_total_carriers,
    backfill: auction.backfill,
    removal_scope: auction.removal_scope,
  };
}

// Section content_json -> the component list normalizeAnswers reads. Dedicated
// try/catch (D1 JSON-parse safety) -> an empty content on a corrupt blob.
function sectionContent(contentJson: string): LeadgenSectionContent {
  const parsed = parseJson(contentJson);
  if (parsed === null || typeof parsed !== "object") return { components: [] };
  const components = (parsed as { components?: unknown }).components;
  return { components: Array.isArray(components) ? components : [] } as LeadgenSectionContent;
}

// Which offer calls a provider (04 S10.2): calls_provider_api=1 (both
// request_dynamic_bid and request_static_bid). A static_no_request Offer
// (calls_provider_api=0) contributes a synthesized static carrier instead.
function callsProvider(offer: LeadgenOfferRow): boolean {
  return offer.calls_provider_api === 1;
}

// Synthesize the single canonical Carrier a static_no_request Offer contributes
// (07 S18.2 static surfacing) from its static config.
function staticCarrier(offer: LeadgenOfferRow, staticBidOverride: number | null): LeadgenParsedCarrier {
  const name = (offer.provider ?? offer.offer_name ?? "").trim();
  const key = name !== "" ? slugifyCarrierName(name) : offer.public_id;
  const bid = staticBidOverride ?? offer.static_bid_value ?? 0;
  return {
    carrier_key: key === "" ? offer.public_id : key,
    carrier_key_source: "slug",
    carrier_name: name === "" ? null : name,
    carrier_logo: null,
    bid: Number.isFinite(bid) && bid > 0 ? bid : 0,
    bid_currency: offer.static_bid_currency,
    click_url: offer.static_fallback_banner_url,
    tracking_id: null,
    headline: null,
    subheadline: null,
    disclaimer: null,
    pricing_model: "static",
  };
}

// The per-carrier working record threaded through the pipeline: the parsed
// canonical carrier + its Offer + the raw provider response context (for
// {response:*} click-url resolution) + the USD bid.
interface WorkingCarrier {
  parsed: LeadgenParsedCarrier;
  offer: AuctionBundleOffer;
  usd_bid: number;
  response_context: unknown;
}

// Run the S19 pipeline. Steps 1-15 in order. dryRun => compute everything, write
// nothing (the caller does not persist; no cap is incremented). Never throws.
export async function runAuction(
  env: Env,
  input: RunAuctionInput,
  opts: { dryRun: boolean },
): Promise<RunAuctionResult> {
  const mintId = input.mintId ?? ulid;
  const nowMs = input.now ?? Date.now();
  const auction = input.bundle.auction;
  const settings = auctionSettings(auction);

  // Step 2: mint the 1:1 instance + result ids up front (needed by the trace).
  const auctionInstanceId = mintId();
  const auctionResultId = mintId();
  const auctionConfigId = auction.public_id;

  const baseTrace = {
    auction_instance_id: auctionInstanceId,
    auction_result_id: auctionResultId,
    auction_config_id: auctionConfigId,
    session_id: input.session_id,
    funnel_attempt_id: input.binding.funnel_attempt_id,
    funnel_id: input.resolved.funnel.public_id,
    funnel_variant_id: input.resolved.variant.public_id,
  };

  const empty = (
    status: RunAuctionStatus,
    httpStatus: number,
    tampered: "tampered" | null,
    unfilledReason: string | null,
    redirect: RunAuctionResult["redirect"],
  ): RunAuctionResult => {
    const trace = buildExplainTrace({ ...baseTrace, unfilled_reason: unfilledReason });
    return {
      status,
      http_status: httpStatus,
      traffic_quality_flag: tampered,
      auction_instance_id: auctionInstanceId,
      auction_result_id: auctionResultId,
      auction_config_id: auctionConfigId,
      banners_css: "",
      banners_html: "",
      banners: [],
      banner_render_ids: [],
      carrier_impressions: [],
      explain: trace,
      // A tampered request writes NOTHING (RED LINE 2); a disqualify/redirect
      // still records the result log so analytics see the terminal state.
      result_log_row: status === "tampered" ? null : toResultLogRow(trace),
      provider_log_rows: [],
      redirect,
      carriers_filtered: [],
    };
  };

  // Step 1: anti-tamper (RED LINE 2). Skipped in dry-run (admin simulate has no
  // real client binding). A mismatch => 422, tampered flag, NO calls, NO writes.
  if (!opts.dryRun) {
    const verdict = await validateAntiTamper(env, input.resolved, auction, input.binding);
    if (!verdict.ok) {
      return empty("tampered", 422, "tampered", null, null);
    }
  }

  // Step 3: re-normalize answers server-side (RED LINE 3 -- never trust client
  // values). Merge each section's normalized answers into one internal space.
  // The admin dry-run may instead supply the internal answer space directly.
  const normalizedAnswers: Record<string, unknown> = {};
  if (input.normalizedAnswersOverride !== undefined) {
    for (const [field, value] of Object.entries(input.normalizedAnswersOverride)) normalizedAnswers[field] = value;
  } else {
    for (const rs of input.resolved.sections) {
      const content = sectionContent(rs.section.content_json);
      const { answers } = normalizeAnswers(content, input.raw_answers);
      for (const [field, value] of Object.entries(answers)) normalizedAnswers[field] = value;
    }
  }
  // The S21.4 evaluation namespace: request dims (device/geo) UNDER the
  // server-normalized answers -- the lead's DECLARED location (answered
  // state/zip/city) drives region + answer rules, while request dims (device,
  // and any geo dim the lead did not answer) fill the gaps. Client-submitted
  // answer VALUES are never trusted raw (they were re-normalized above).
  const ruleContext: Record<string, unknown> = { ...(input.request_context ?? {}), ...normalizedAnswers };
  const geo = {
    country: typeof ruleContext["country"] === "string" ? (ruleContext["country"] as string) : null,
    state: typeof ruleContext["state"] === "string" ? (ruleContext["state"] as string) : null,
    city: typeof ruleContext["city"] === "string" ? (ruleContext["city"] as string) : null,
    zip: typeof ruleContext["zip"] === "string" ? (ruleContext["zip"] as string) : null,
  };

  // Step 4: funnel rules (reuse the shared S21.4 condition evaluator + funnel.ts
  // redirect semantics). Only the AUCTION-GATING kinds are terminal here:
  // disqualification (-> no auction) and redirect_direct_offer (-> redirect, no
  // auction). skip_section/show_section are per-section navigation owned by the
  // P11 client engine and never gate the terminal auction. auction_entry: when
  // any exists, at least one must match for the auction to run.
  const funnelRules = [...input.bundle.funnel_rules].sort((a, b) => a.priority - b.priority);
  for (const fr of funnelRules) {
    if (fr.rule_type === "disqualification" && conditionsMatch(fr.conditions, ruleContext)) {
      return empty("disqualified", 200, null, "disqualified", null);
    }
    if (fr.rule_type === "redirect_direct_offer" && conditionsMatch(fr.conditions, ruleContext)) {
      return empty("redirect", 200, null, "redirect", {
        target_offer_id: fr.target_offer_id,
        redirect_url: fr.redirect_url_allowlisted === 1 ? fr.redirect_url : null,
      });
    }
  }
  const entryRules = funnelRules.filter((r) => r.rule_type === "auction_entry");
  if (entryRules.length > 0 && !entryRules.some((r) => conditionsMatch(r.conditions, ruleContext))) {
    return empty("disqualified", 200, null, "no_auction_entry", null);
  }

  // Step 5: offer participation -- region rules + caps (READ only) + offer-level
  // answer rules -> candidate Offers (+ chosen placement).
  const offersConsidered: LeadgenAuctionConsideredOffer[] = [];
  const offersExcluded: LeadgenAuctionExcludedOffer[] = [];
  const regionCapSurvivors: AuctionBundleOffer[] = [];
  for (const b of input.bundle.offers) {
    offersConsidered.push({ offer_id: b.offer.public_id, placement_id: b.placement_public_id ?? "" });
    // Region rules (Offer-scoped geo block).
    const region = evaluateRegionRules(b.region_rules, geo);
    if (!region.participate) {
      offersExcluded.push({ offer_id: b.offer.public_id, reason: region.blocked_by.reason });
      continue;
    }
    // Caps -- READ the counter, never increment at auction time (S10.6 bumps on
    // click, P11). A capped-out Offer does not participate.
    if (b.offer.cap_enabled === 1) {
      const status = await readCapStatus(env.DB, b.offer, new Date(nowMs));
      if (capExceeded(status, b.offer)) {
        offersExcluded.push({ offer_id: b.offer.public_id, reason: "cap" });
        continue;
      }
    }
    regionCapSurvivors.push(b);
  }

  // Offer-level answer rules (S21 include/exclude -- issue 4).
  const participation = evaluateOfferRules(input.bundle.offer_rules, {
    context: ruleContext,
    candidate_offer_ids: regionCapSurvivors.map((b) => b.offer.public_id),
  });
  for (const ex of participation.excluded) offersExcluded.push(ex);
  const participatingSet = new Set(participation.participating);
  const candidates = regionCapSurvivors.filter((b) => participatingSet.has(b.offer.public_id));

  // Steps 6-7: build payloads + fire provider requests in parallel (dynamic
  // Offers only). Static_no_request Offers skip the fetch.
  const dynamicCandidates = candidates.filter((b) => callsProvider(b.offer));
  const requests: ParallelProviderRequest[] = dynamicCandidates.map((b) => ({
    offer: b.offer,
    headers: b.headers,
    payloadSchema: b.payload_schema,
    ctx: {
      answers: normalizedAnswers,
      timeout_ms: auction.timeout_ms,
      carrier_parse_version: b.carrier_parse_version,
      placement_public_id: b.placement_public_id,
      mintId,
    },
  }));

  let fetchBatch: { auction_request_id: string; results: FetchProviderResult[] };
  if (input.providerResultsOverride !== undefined) {
    fetchBatch = input.providerResultsOverride;
  } else if (requests.length > 0) {
    fetchBatch = await fetchProvidersParallel(env, requests, input.environment, { mintId });
  } else {
    fetchBatch = { auction_request_id: mintId(), results: [] };
  }
  const auctionRequestId = fetchBatch.auction_request_id;

  // Provider log rows (redacted + SEPARATE debug record, RED LINE 1) + S19.2
  // requested/responded views. One row per dynamic request.
  const providersRequested: ExplainProviderRequested[] = [];
  const providersResponded: ExplainProviderResponded[] = [];
  const providerLogRows: ProviderLogRowToPersist[] = [];
  const resultByOffer = new Map<string, FetchProviderResult>();
  for (const result of fetchBatch.results) {
    resultByOffer.set(result.offer_public_id, result);
    providersRequested.push({
      offer_id: result.offer_public_id,
      provider_request_id: result.provider_request_id,
      environment: result.environment,
    });
    providersResponded.push({
      offer_id: result.offer_public_id,
      provider_request_id: result.provider_request_id,
      status: result.status,
      latency_ms: result.latency_ms,
      provider_error_reason: result.error_reason,
    });
  }

  // Step 8: parse each dynamic response -> canonical carriers; FX-normalize bids
  // to USD. Static Offers contribute their synthesized static carrier.
  const parsedByOffer = new Map<string, LeadgenParsedCarrier[]>();
  const bidInputs: CarrierBidInput[] = [];
  const carrierMeta = new Map<string, { offer: AuctionBundleOffer; parsed: LeadgenParsedCarrier; response_context: unknown }>();

  const metaKey = (offerPublicId: string, carrierKey: string): string => `${offerPublicId} ${carrierKey}`;

  for (const b of candidates) {
    if (callsProvider(b.offer)) {
      const result = resultByOffer.get(b.offer.public_id);
      const responseContext = result?.parsed ?? (result?.body ?? null);
      const parseResult = result === undefined
        ? { carriers: [], errors: [] }
        : parseProviderResponse(b.carrier_parse_json, result.parsed ?? result.body ?? "");
      parsedByOffer.set(b.offer.public_id, parseResult.carriers);
      for (const carrier of parseResult.carriers) {
        bidInputs.push({
          carrier_key: carrier.carrier_key,
          offer_public_id: b.offer.public_id,
          bid: typeof carrier.bid === "number" ? carrier.bid : 0,
          bid_currency: carrier.bid_currency,
        });
        carrierMeta.set(metaKey(b.offer.public_id, carrier.carrier_key), { offer: b, parsed: carrier, response_context: responseContext });
      }
    } else {
      const carrier = staticCarrier(b.offer, b.static_bid_override);
      parsedByOffer.set(b.offer.public_id, [carrier]);
      bidInputs.push({
        carrier_key: carrier.carrier_key,
        offer_public_id: b.offer.public_id,
        bid: typeof carrier.bid === "number" ? carrier.bid : 0,
        bid_currency: carrier.bid_currency,
      });
      carrierMeta.set(metaKey(b.offer.public_id, carrier.carrier_key), { offer: b, parsed: carrier, response_context: null });
    }
  }

  const usdBids = await normalizeCarrierBidsToUsd(env.DB, bidInputs, { onMissingRate: "zero" });
  const usdByKey = new Map<string, number>();
  for (const nb of usdBids) usdByKey.set(metaKey(nb.offer_public_id, nb.carrier_key), nb.usd_bid);

  // Assemble the working carrier set with USD bids.
  const working: WorkingCarrier[] = [];
  for (const b of candidates) {
    for (const carrier of parsedByOffer.get(b.offer.public_id) ?? []) {
      const usd = usdByKey.get(metaKey(b.offer.public_id, carrier.carrier_key)) ?? 0;
      const meta = carrierMeta.get(metaKey(b.offer.public_id, carrier.carrier_key));
      working.push({ parsed: carrier, offer: b, usd_bid: usd, response_context: meta?.response_context ?? null });
    }
  }

  // Step 10 (pre-floor half): carrier EXCLUDE rules -- excluded carriers must
  // NOT set the floor (S21). Record carrier_filtered_reason.
  const carriersFiltered: ExplainFilteredCarrier[] = [];
  const afterExclude: WorkingCarrier[] = [];
  for (const w of working) {
    const verdict = evaluateCarrierRules(input.bundle.carrier_rules, {
      carrier_key: w.parsed.carrier_key,
      carrier_name: w.parsed.carrier_name,
    }, ruleContext);
    if (verdict.excluded_pre_floor) {
      const reason = verdict.matched.find((m) => m.reason.startsWith("carrier_exclude") || m.reason.startsWith("carrier_block"))?.reason ?? "carrier_excluded";
      carriersFiltered.push({ carrier_key: w.parsed.carrier_key, offer_id: w.offer.offer.public_id, carrier_filtered_reason: reason });
      continue;
    }
    afterExclude.push(w);
  }

  // Step 9: floor (S18.3) over the surviving carriers (auction-wide).
  const floorCarriers: AuctionCarrier[] = afterExclude.map((w) =>
    toAuctionCarrier({ carrier_key: w.parsed.carrier_key }, w.offer.offer.public_id, w.usd_bid),
  );
  const floorResult = computeFloor(floorCarriers, settings.floor_type, settings.floor_value);
  const qualifiedKeys = new Set(floorResult.qualified.map((c) => metaKey(c.offer_public_id, c.carrier_key)));
  const belowFloorKeys = new Set(floorResult.below_floor.map((c) => metaKey(c.offer_public_id, c.carrier_key)));
  // Record below-floor carriers as filtered (available only for backfill).
  for (const w of afterExclude) {
    if (belowFloorKeys.has(metaKey(w.offer.offer.public_id, w.parsed.carrier_key))) {
      carriersFiltered.push({ carrier_key: w.parsed.carrier_key, offer_id: w.offer.offer.public_id, carrier_filtered_reason: "below_floor" });
    }
  }

  // Step 10 (post-winner half): carrier INCLUDE-ONLY restriction. Active when
  // any include rule's context matched; only carriers it matched survive.
  const qualifiedWorking = afterExclude.filter((w) => qualifiedKeys.has(metaKey(w.offer.offer.public_id, w.parsed.carrier_key)));
  const includeSurviving: WorkingCarrier[] = [];
  for (const w of qualifiedWorking) {
    const verdict = evaluateCarrierRules(input.bundle.carrier_rules, {
      carrier_key: w.parsed.carrier_key,
      carrier_name: w.parsed.carrier_name,
    }, ruleContext);
    if (verdict.include_only_active && !verdict.included_post_winner) {
      carriersFiltered.push({ carrier_key: w.parsed.carrier_key, offer_id: w.offer.offer.public_id, carrier_filtered_reason: "carrier_include_only_restriction" });
      continue;
    }
    includeSurviving.push(w);
  }

  // Step 11: winner logic (S18.4) over the eligible carriers grouped by Offer.
  const eligibleByOffer = new Map<string, AuctionCarrier[]>();
  for (const w of includeSurviving) {
    const list = eligibleByOffer.get(w.offer.offer.public_id) ?? [];
    list.push(toAuctionCarrier({ carrier_key: w.parsed.carrier_key }, w.offer.offer.public_id, w.usd_bid));
    eligibleByOffer.set(w.offer.offer.public_id, list);
  }
  // CPC Offers (bid_source=response) are the winner-logic candidates.
  const cpcOfferIds = new Set(candidates.filter((b) => b.offer.bid_source === "response").map((b) => b.offer.public_id));
  const winnerOffers = [...eligibleByOffer.entries()]
    .filter(([offerId]) => cpcOfferIds.has(offerId))
    .map(([offer_public_id, carriers]) => ({ offer_public_id, carriers }));
  const winner = selectWinner(winnerOffers, settings.winner_logic);

  // Step 11-12: surface (winner + multi_offer + static/CPL merge) + limits.
  const surfaceOffers: SurfaceOffer[] = [...eligibleByOffer.entries()].map(([offer_public_id, carriers]) => ({
    offer_public_id,
    carriers,
    bid_source: cpcOfferIds.has(offer_public_id) ? "cpc" : "static",
  }));
  let surfaced = surfaceCarriers(surfaceOffers, winner.winner, settings);

  // Step 13: remove-clicked (reuse applyRemoveClicked as the authority; keep
  // slot/source by intersecting on the survivor identity, then re-slot).
  if (auction.remove_clicked_offers === 1 && input.clicked.length > 0) {
    const survivorIds = new Set(
      applyRemoveClicked(surfaced, input.clicked, settings.removal_scope).map((c) => `${c.offer_public_id} ${c.carrier_key}`),
    );
    surfaced = surfaced
      .filter((s) => survivorIds.has(`${s.offer_public_id} ${s.carrier_key}`))
      .map((s, i) => ({ ...s, slot: i + 1 }));
  }

  // Step 14: render banners (winner + multi_offer + static). ONE banner_render_id.
  const design = getBannerDesign(auction.banner_design_id);
  const bannerConfig = {
    mode: input.bundle.banner?.mode ?? "automatic",
    field_map_json: input.bundle.banner?.field_map_json,
    banner_config_json: input.bundle.banner_config_json,
  };
  const bannerCtx = { auction_instance_id: auctionInstanceId, banner_design_id: auction.banner_design_id };

  const toRenderCarrier = (s: SurfacedCarrier): BannerRenderCarrier => {
    const meta = carrierMeta.get(metaKey(s.offer_public_id, s.carrier_key));
    return {
      carrier: meta?.parsed ?? { carrier_key: s.carrier_key, carrier_key_source: "slug" },
      offer_public_id: s.offer_public_id,
      slot: s.slot,
      source: s.source,
      bid: s.bid,
      banner_url_template: meta?.offer.offer.banner_url_template ?? null,
      response_context: meta?.response_context ?? null,
    };
  };

  const primaryRender = renderBanners(surfaced.map(toRenderCarrier), bannerCtx, bannerConfig, design, { mintId });
  const bannerRenderIds: string[] = [primaryRender.banner_render_id];
  const impressions: CarrierImpression[] = [...primaryRender.impressions];
  let cssOut = primaryRender.css;
  let htmlOut = primaryRender.html;
  const renderedSlots: RenderedBannerSlot[] = [...primaryRender.slots];
  // A banner drop (missing click_url / required response field) is a filtered
  // carrier (S29 dedicated reason).
  for (const d of primaryRender.dropped) {
    carriersFiltered.push({ carrier_key: d.carrier_key, offer_id: d.offer_public_id, carrier_filtered_reason: d.carrier_filtered_reason });
  }

  // Step 15: backfill on trigger. The auction-time trigger is
  // on_slot_exhaustion; on_click / on_dismiss are client-fired later (P11).
  let unfilledReason: string | null = null;
  if (settings.backfill !== "disabled" && auction.backfill_trigger === "on_slot_exhaustion") {
    const renderedKeys = new Set(renderedSlots.map((s) => `${s.offer_public_id} ${s.carrier_key}`));
    // Remaining pool = qualified-not-rendered, then below-floor (S18.3
    // "below-floor available only for backfill"), excluding clicked.
    const remainingWorking = [...includeSurviving, ...afterExclude.filter((w) => belowFloorKeys.has(metaKey(w.offer.offer.public_id, w.parsed.carrier_key)))]
      .filter((w) => !renderedKeys.has(`${w.offer.offer.public_id} ${w.parsed.carrier_key}`));
    let remaining: AuctionCarrier[] = remainingWorking.map((w) => toAuctionCarrier({ carrier_key: w.parsed.carrier_key }, w.offer.offer.public_id, w.usd_bid));
    if (auction.remove_clicked_offers === 1 && input.clicked.length > 0) {
      remaining = applyRemoveClicked(remaining, input.clicked, settings.removal_scope);
    }
    const backfill = applyBackfill({
      remaining,
      rendered: renderedSlots.map((s) => ({ carrier_key: s.carrier_key, offer_public_id: s.offer_public_id, bid: s.bid, source: s.source, slot: s.slot })),
      mode: settings.backfill,
      bannerSlotsCount: settings.banner_slots_count,
      maxTotalCarriers: settings.max_total_carriers,
    });
    unfilledReason = backfill.unfilled_reason;
    if (backfill.filled.length > 0) {
      const backfillRender = renderBanners(backfill.filled.map(toRenderCarrier), bannerCtx, bannerConfig, design, { mintId });
      bannerRenderIds.push(backfillRender.banner_render_id);
      impressions.push(...backfillRender.impressions);
      renderedSlots.push(...backfillRender.slots);
      cssOut = cssOut === "" ? backfillRender.css : cssOut;
      htmlOut = htmlOut + backfillRender.html;
      for (const d of backfillRender.dropped) {
        carriersFiltered.push({ carrier_key: d.carrier_key, offer_id: d.offer_public_id, carrier_filtered_reason: d.carrier_filtered_reason });
      }
    }
  }

  // Unfilled when no slot rendered and the pool was exhausted (S18.6). A pure
  // no_bid (every CPC Offer all-zero + nothing surfaced) is its own status.
  let status: RunAuctionStatus = "ok";
  if (renderedSlots.length === 0) {
    if (unfilledReason === null) unfilledReason = "all_carriers_shown";
    status = winner.winner === null && surfaced.length === 0 ? "no_bid" : "unfilled";
  }

  // Assemble the S19.2 trace + the persistable result-log row.
  const carriersShown = renderedSlots.map((s) => ({ carrier_key: s.carrier_key, offer_id: s.offer_public_id, bid: s.bid, slot: s.slot }));
  const trace = buildExplainTrace({
    ...baseTrace,
    offers_considered: offersConsidered,
    offers_excluded: offersExcluded,
    carriers_shown: carriersShown,
    winner: winner.winner === null ? null : { offer_id: winner.winner, logic: winner.logic, score: winner.score },
    banner_render_ids: bannerRenderIds,
    unfilled_reason: unfilledReason,
    carriers_filtered: carriersFiltered,
    providers_requested: providersRequested,
    providers_responded: providersResponded,
  });

  // Provider log rows (redacted + SEPARATE debug record, RED LINE 1). Stamp the
  // grouping ids + parsed carriers onto each redacted shape.
  for (const result of fetchBatch.results) {
    const parsed = parsedByOffer.get(result.offer_public_id) ?? [];
    providerLogRows.push({
      auction_instance_id: auctionInstanceId,
      auction_request_id: auctionRequestId,
      provider_request_id: result.redacted_log.provider_request_id,
      offer_public_id: result.redacted_log.offer_public_id,
      placement_public_id: result.redacted_log.placement_public_id,
      carrier_parse_version: result.redacted_log.carrier_parse_version,
      environment: result.environment,
      status_code: result.redacted_log.status_code,
      latency_ms: result.redacted_log.latency_ms,
      request_headers_redacted_json: result.redacted_log.request_headers_redacted_json,
      request_payload_redacted_json: result.redacted_log.request_payload_redacted_json,
      response_redacted_json: result.redacted_log.response_redacted_json,
      parsed_carriers_json: JSON.stringify(parsed),
      provider_error_reason: result.redacted_log.provider_error_reason,
      error_text: result.redacted_log.error_text,
      debug_record: result.debug,
    });
  }

  return {
    status,
    http_status: 200,
    traffic_quality_flag: null,
    auction_instance_id: auctionInstanceId,
    auction_result_id: auctionResultId,
    auction_config_id: auctionConfigId,
    banners_css: cssOut,
    banners_html: htmlOut,
    banners: renderedSlots,
    banner_render_ids: bannerRenderIds,
    carrier_impressions: impressions,
    explain: trace,
    result_log_row: toResultLogRow(trace),
    provider_log_rows: providerLogRows,
    redirect: null,
    carriers_filtered: carriersFiltered,
  };
}

// ---------------------------------------------------------------------------
// persistAuctionResult -- the S19 step-14/S28 non-blocking writes (RED LINE 1)
// ---------------------------------------------------------------------------
//
// Called ONLY for a non-dry run (dryRun writes nothing -- OQ-10) and ONLY when
// status is not "tampered" (a tampered request books no revenue/writes -- RED
// LINE 2). The caller registers this on ctx.waitUntil so it never blocks the
// response; every statement is individually try/caught so one write failure
// (fail-open, S28) never breaks the auction response or the sibling writes.
//
// RED LINE 1: for each provider row, the FULL unredacted `debug_record` (secret
// in clear) is AES-GCM encrypted into KV (lg-debug:<id>, 72h TTL) and ONLY the
// opaque debug_ref is stored on the D1 row. Absent LEADGEN_DEBUG_ENCRYPTION_KEY
// => NO blob + NULL debug_ref. The debug_record NEVER binds to a D1 column -- the
// redacted_* columns (secrets masked, PII hashed) are all that reach D1.
export async function persistAuctionResult(
  env: Env,
  result: RunAuctionResult,
): Promise<void> {
  const encryptionSecret = readEnvSecret(env, DEBUG_ENCRYPTION_SECRET_NAME);

  // Provider request log rows + encrypted debug blob.
  for (const row of result.provider_log_rows) {
    let debugRef: string | null = null;
    if (encryptionSecret !== undefined) {
      try {
        const ref = `${DEBUG_REF_PREFIX}${randomHex(16)}`;
        const blob = JSON.stringify({ ...(typeof row.debug_record === "object" && row.debug_record !== null ? row.debug_record : { debug: row.debug_record }), created_at: new Date().toISOString() });
        await env.CACHE.put(ref, await encryptDebugBlob(encryptionSecret, blob), { expirationTtl: DEBUG_BLOB_TTL_SECONDS });
        debugRef = ref;
      } catch {
        debugRef = null; // best-effort blob; the redacted row still lands
      }
    }
    try {
      await env.DB.prepare(
        `INSERT INTO leadgen_provider_request_log
           (auction_instance_id, auction_request_id, provider_request_id, offer_public_id,
            placement_public_id, carrier_parse_version, environment, status_code, latency_ms,
            request_headers_redacted_json, request_payload_redacted_json, response_redacted_json,
            parsed_carriers_json, debug_ref, provider_error_reason, error_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          row.auction_instance_id,
          row.auction_request_id,
          row.provider_request_id,
          row.offer_public_id,
          row.placement_public_id,
          row.carrier_parse_version,
          row.environment,
          row.status_code,
          row.latency_ms,
          row.request_headers_redacted_json,
          row.request_payload_redacted_json,
          row.response_redacted_json,
          row.parsed_carriers_json,
          debugRef,
          row.provider_error_reason,
          row.error_text,
        )
        .run();
    } catch {
      // fail-open (S28): a provider-log write failure never breaks the response.
    }
  }

  // The 1:1 auction result log (explainability). NULL result_log_row => nothing
  // to persist (tampered).
  const log = result.result_log_row;
  if (log !== null) {
    try {
      await env.DB.prepare(
        `INSERT INTO leadgen_auction_result_log
           (auction_instance_id, auction_result_id, auction_config_id, session_id,
            funnel_attempt_id, funnel_id, funnel_variant_id, banner_render_ids_json,
            offers_considered_json, offers_excluded_json, carriers_shown_json, winner_json, unfilled_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          log.auction_instance_id,
          log.auction_result_id,
          log.auction_config_id,
          log.session_id,
          log.funnel_attempt_id,
          log.funnel_id,
          log.funnel_variant_id,
          log.banner_render_ids_json,
          log.offers_considered_json,
          log.offers_excluded_json,
          log.carriers_shown_json,
          log.winner_json,
          log.unfilled_reason,
        )
        .run();
    } catch {
      // fail-open (S28).
    }
  }
}
