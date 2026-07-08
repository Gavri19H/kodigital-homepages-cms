// Server-side Offer validators (contract 04 §10.1/§10.3/§10.4/§10.5/§10.6 +
// §11.8). Mirrors the listicles validation idiom: every validator returns
// FIELD-KEYED errors — the API failure envelope is { error, fields } (03
// §8.4) and these maps plug straight into `fields`.
//
// Validators are PURE (no DB access). Referential checks that need the
// database — "fallback offer exists & active", placement uniqueness against
// stored rows, schema-version existence — live in the Stage-B handlers,
// which merge their findings into the same field-keyed map. ONE deliberate
// exception (fix-contract v2.4 05 §5.1): evaluateDynamicOffersEligibility is
// the shared DB loader for the R4 gate so every admin surface (auction-offers
// PUT warnings, the R5 activation preflight) reads the identical inputs; the
// verdict itself stays the pure dynamicAuctionEligibility.

import type {
  LeadgenApiTokenPlacement,
  LeadgenBidSource,
  LeadgenCapCountBy,
  LeadgenHeaderValueKind,
  LeadgenOfferType,
  LeadgenRegionDimension,
  LeadgenRequestExecutionMode,
  LeadgenRequestMethod,
  LeadgenRuleAction,
  LeadgenTrackingMethod,
} from "../admin/leadgen/db-types";
import { validateBannerUrlTemplate } from "./macros";
import { validatePayloadSchema, type LeadgenPayloadSchemaValidation } from "./payload";

export type FieldErrors = Record<string, string>;

// ---------------------------------------------------------------------------
// Enum value sets — runtime arrays for the db-types unions. Each `satisfies`
// pins the array to the union derived from the 0036 DDL CHECK constraints,
// so a DDL/type drift breaks typecheck here instead of passing bad enums.
// ---------------------------------------------------------------------------

export const LEADGEN_TRACKING_METHODS = [
  "s2s_postback",
  "browser_side_pixel",
  "script",
] as const satisfies readonly LeadgenTrackingMethod[];

export const LEADGEN_OFFER_TYPES = [
  "cpc",
  "cpl",
  "cpa",
  "cpi",
] as const satisfies readonly LeadgenOfferType[];

export const LEADGEN_BID_SOURCES = [
  "response",
  "static",
] as const satisfies readonly LeadgenBidSource[];

export const LEADGEN_EXECUTION_MODES = [
  "server",
  "client",
] as const satisfies readonly LeadgenRequestExecutionMode[];

export const LEADGEN_REQUEST_METHODS = [
  "POST",
  "GET",
  "PUT",
] as const satisfies readonly LeadgenRequestMethod[];

export const LEADGEN_TOKEN_PLACEMENTS = [
  "header",
  "payload",
  "query",
] as const satisfies readonly LeadgenApiTokenPlacement[];

export const LEADGEN_CAP_COUNT_BY = [
  "clicks",
  "conversions",
] as const satisfies readonly LeadgenCapCountBy[];

export const LEADGEN_REGION_DIMENSIONS = [
  "country",
  "state",
  "city",
  "zip",
] as const satisfies readonly LeadgenRegionDimension[];

export const LEADGEN_RULE_ACTIONS = [
  "include_only",
  "exclude",
  "allow_list",
  "block_list",
] as const satisfies readonly LeadgenRuleAction[];

export const LEADGEN_HEADER_VALUE_KINDS = [
  "static",
  "macro",
  "secret_ref",
] as const satisfies readonly LeadgenHeaderValueKind[];

// ---------------------------------------------------------------------------
// Small shared helpers (listicles validation idiom)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// Admin toggles arrive as booleans from the UI or 0/1 from a Row echo.
function asToggle(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1) return true;
  if (value === 0) return false;
  return null;
}

function enumError(field: string, allowed: readonly string[]): string {
  return `${field} must be one of ${allowed.join("|")}`;
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

// Absolute http(s) URL gate for plain (macro-free) URL fields —
// static_fallback_banner_url, cap_fallback_url, endpoints.
export function isAbsoluteHttpUrl(value: string, httpsOnly = false): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const parsed = new URL(value);
    if (httpsOnly) return parsed.protocol === "https:";
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// §10.1 Create-Offer modal — required business fields
// ---------------------------------------------------------------------------

export interface LeadgenOfferCreateInput {
  offer_name: string;
  activity: string;
  vertical: string;
  conversion_tracking_method: LeadgenTrackingMethod;
  offer_type: LeadgenOfferType;
  placements: string[];
  calls_provider_api: boolean;
  bid_source: LeadgenBidSource;
  cap_enabled: boolean;
  tag: string | null;
  provider: string | null;
  static_bid_value: number | null;
  static_bid_currency: string | null;
  static_order: number | null;
}

export interface LeadgenOfferCreateResult {
  errors: FieldErrors;
  value: LeadgenOfferCreateInput | null;
}

// Validate the §10.1 create-modal payload. Required: offer_name, activity,
// vertical, conversion_tracking_method, offer_type, ≥1 placement,
// calls_provider_api, bid_source, cap_enabled. Optional: tag, provider,
// static bid fields (typed when present — completeness for go-live is
// validateStaticBidCompleteness's job; the modal creates a DRAFT and the
// heavy config editors open after, §10.1). Cap DETAIL fields likewise live
// in the Cap tab (validateOfferCapFields) — the modal carries the toggle.
export function validateOfferCreate(raw: unknown): LeadgenOfferCreateResult {
  const errors: FieldErrors = {};
  if (!isRecord(raw)) {
    return { errors: { body: "request body must be a JSON object" }, value: null };
  }

  const offerName = trimmedString(raw["offer_name"]);
  if (offerName === null) errors["offer_name"] = "offer_name is required";
  const activity = trimmedString(raw["activity"]);
  if (activity === null) errors["activity"] = "activity is required";
  const vertical = trimmedString(raw["vertical"]);
  if (vertical === null) errors["vertical"] = "vertical is required";

  const tracking = raw["conversion_tracking_method"];
  if (!isOneOf(tracking, LEADGEN_TRACKING_METHODS)) {
    errors["conversion_tracking_method"] = enumError(
      "conversion_tracking_method",
      LEADGEN_TRACKING_METHODS,
    );
  }
  const offerType = raw["offer_type"];
  if (!isOneOf(offerType, LEADGEN_OFFER_TYPES)) {
    errors["offer_type"] = enumError("offer_type", LEADGEN_OFFER_TYPES);
  }

  // ≥1 placement (provider placement/feed id — issue 29); duplicates are
  // rejected here because the DDL enforces UNIQUE (offer_id, placement_id).
  const placements: string[] = [];
  const rawPlacements = raw["placements"];
  if (!Array.isArray(rawPlacements) || rawPlacements.length === 0) {
    errors["placements"] = "at least one placement is required";
  } else {
    for (let i = 0; i < rawPlacements.length; i++) {
      const placement = trimmedString(rawPlacements[i]);
      if (placement === null) {
        errors[`placements[${i}]`] = "placement_id must be a non-empty string";
      } else if (placements.includes(placement)) {
        errors[`placements[${i}]`] = `duplicate placement_id '${placement}'`;
      } else {
        placements.push(placement);
      }
    }
  }

  const callsProviderApi = asToggle(raw["calls_provider_api"]);
  if (callsProviderApi === null) errors["calls_provider_api"] = "calls_provider_api is required";
  const bidSource = raw["bid_source"];
  if (!isOneOf(bidSource, LEADGEN_BID_SOURCES)) {
    errors["bid_source"] = enumError("bid_source", LEADGEN_BID_SOURCES);
  } else if (callsProviderApi === false && bidSource === "response") {
    // §10.2: a response-derived bid requires a provider call — the three
    // legal kinds are (0,static), (1,static), (1,response).
    errors["bid_source"] = "bid_source 'response' requires calls_provider_api";
  }
  const capEnabled = asToggle(raw["cap_enabled"]);
  if (capEnabled === null) errors["cap_enabled"] = "cap_enabled is required";

  // Optional fields — typed when present.
  const tag = raw["tag"] === undefined || raw["tag"] === null ? null : trimmedString(raw["tag"]);
  if (raw["tag"] !== undefined && raw["tag"] !== null && tag === null) {
    errors["tag"] = "tag must be a non-empty string";
  }
  const provider =
    raw["provider"] === undefined || raw["provider"] === null ? null : trimmedString(raw["provider"]);
  if (raw["provider"] !== undefined && raw["provider"] !== null && provider === null) {
    errors["provider"] = "provider must be a non-empty string";
  }

  let staticBidValue: number | null = null;
  if (raw["static_bid_value"] !== undefined && raw["static_bid_value"] !== null) {
    const v = raw["static_bid_value"];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      errors["static_bid_value"] = "static_bid_value must be a positive number";
    } else {
      staticBidValue = v;
    }
  }
  let staticBidCurrency: string | null = null;
  if (raw["static_bid_currency"] !== undefined && raw["static_bid_currency"] !== null) {
    staticBidCurrency = trimmedString(raw["static_bid_currency"]);
    if (staticBidCurrency === null) {
      errors["static_bid_currency"] = "static_bid_currency must be a non-empty string";
    }
  }
  let staticOrder: number | null = null;
  if (raw["static_order"] !== undefined && raw["static_order"] !== null) {
    const v = raw["static_order"];
    if (typeof v !== "number" || !Number.isInteger(v)) {
      errors["static_order"] = "static_order must be an integer";
    } else {
      staticOrder = v;
    }
  }

  if (Object.keys(errors).length > 0) return { errors, value: null };
  return {
    errors,
    value: {
      offer_name: offerName as string,
      activity: activity as string,
      vertical: vertical as string,
      conversion_tracking_method: tracking as LeadgenTrackingMethod,
      offer_type: offerType as LeadgenOfferType,
      placements,
      calls_provider_api: callsProviderApi as boolean,
      bid_source: bidSource as LeadgenBidSource,
      cap_enabled: capEnabled as boolean,
      tag,
      provider,
      static_bid_value: staticBidValue,
      static_bid_currency: staticBidCurrency,
      static_order: staticOrder,
    },
  };
}

// §10.2 completeness for a static-bid Offer at go-live: bid_source='static'
// needs the admin bid value + currency, and the PURE static kind
// (calls_provider_api=0) additionally needs a valid banner_url_template.
// Draft Offers may save without these (§10.1's draft-then-configure flow);
// this gate runs where liveness matters.
export function validateStaticBidCompleteness(offer: {
  calls_provider_api: number | boolean;
  bid_source: LeadgenBidSource;
  static_bid_value: number | null;
  static_bid_currency: string | null;
  banner_url_template: string | null;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (offer.bid_source !== "static") return errors;
  if (
    typeof offer.static_bid_value !== "number" ||
    !Number.isFinite(offer.static_bid_value) ||
    offer.static_bid_value <= 0
  ) {
    errors["static_bid_value"] = "static bid requires a positive static_bid_value";
  }
  if (trimmedString(offer.static_bid_currency) === null) {
    errors["static_bid_currency"] = "static bid requires static_bid_currency";
  }
  const callsProviderApi = asToggle(offer.calls_provider_api) === true;
  if (!callsProviderApi) {
    const template = trimmedString(offer.banner_url_template);
    if (template === null) {
      errors["banner_url_template"] = "a pure static Offer requires banner_url_template";
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// §10.5 banner URL template — field-keyed wrapper over macros.ts
// ---------------------------------------------------------------------------

// Validate an Offer's banner_url_template into the shared FieldErrors map
// (first typed error wins the field slot; the full typed list stays
// available via validateBannerUrlTemplate for the template editor UI).
export function validateOfferBannerTemplate(template: unknown): FieldErrors {
  const errors: FieldErrors = {};
  if (template === undefined || template === null) return errors;
  if (typeof template !== "string") {
    errors["banner_url_template"] = "banner_url_template must be a string";
    return errors;
  }
  const verdict = validateBannerUrlTemplate(template);
  if (!verdict.ok) {
    errors["banner_url_template"] = verdict.errors[0]?.message ?? "banner_url_template is invalid";
  }
  return errors;
}

// ---------------------------------------------------------------------------
// §10.3 client execution mode — typed save-errors
// ---------------------------------------------------------------------------

export interface LeadgenClientModeOfferInput {
  request_execution_mode: LeadgenRequestExecutionMode;
  api_token_secret_ref: string | null;
  endpoint_production: string | null;
  endpoint_staging: string | null;
}

export interface LeadgenClientModeHeaderInput {
  header_name: string;
  value_kind: LeadgenHeaderValueKind;
}

// A client-mode Offer runs its provider request in the BROWSER: no secret
// may ever reach it (09 §30.2 "Client-mode Offers reference no secret at
// all"). Violations are SAVE errors, not warnings:
//   * api_token_secret_ref must be absent;
//   * no header may use value_kind='secret_ref';
//   * endpoints must be https (browser-safe scheme).
// Server-mode Offers (the default) skip all three checks.
export function validateClientModeConstraints(
  offer: LeadgenClientModeOfferInput,
  headers: readonly LeadgenClientModeHeaderInput[],
): FieldErrors {
  const errors: FieldErrors = {};
  if (offer.request_execution_mode !== "client") return errors;

  if (trimmedString(offer.api_token_secret_ref) !== null) {
    errors["api_token_secret_ref"] =
      "client-mode Offers may not reference an api_token_secret_ref";
  }
  headers.forEach((header, index) => {
    if (header.value_kind === "secret_ref") {
      errors[`headers[${index}].value_kind`] =
        `client-mode Offers may not use a secret_ref header ('${header.header_name}')`;
    }
  });
  for (const field of ["endpoint_production", "endpoint_staging"] as const) {
    const endpoint = trimmedString(offer[field]);
    if (endpoint !== null && !isAbsoluteHttpUrl(endpoint, true)) {
      errors[field] = `client-mode ${field} must be an absolute https URL`;
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// §10.4 region-block rules
// ---------------------------------------------------------------------------

export interface LeadgenRegionRuleCreateInput {
  dimension: LeadgenRegionDimension;
  action: LeadgenRuleAction;
  values: string[];
  priority: number;
  enabled: boolean;
}

export interface LeadgenRegionRuleCreateResult {
  errors: FieldErrors;
  value: LeadgenRegionRuleCreateInput | null;
}

// D3 (07 §7.5): per-dimension region value validators. Country/state are
// ISO-3166-ish 2-letter codes (the UI supplies closed dropdowns; this is the
// server-side shape gate); ZIP is US 5-digit; city is free text (validated as
// non-empty upstream). Returns a human message naming the bad token, or null.
const ZIP_RE = /^\d{5}$/;
const ALPHA2_RE = /^[A-Za-z]{2}$/;
export function regionValueError(dimension: LeadgenRegionDimension, token: string): string | null {
  switch (dimension) {
    case "zip":
      return ZIP_RE.test(token) ? null : `zip "${token}" must be 5 digits`;
    case "country":
      return ALPHA2_RE.test(token) ? null : `country "${token}" must be a 2-letter ISO-3166-1 alpha-2 code`;
    case "state":
      return ALPHA2_RE.test(token) ? null : `state "${token}" must be a 2-letter code`;
    case "city":
      return null; // free text (non-empty already enforced)
    default:
      return null;
  }
}

// Validate one region rule: dimension/action from the DDL CHECK enums,
// values_json a non-empty array of non-empty strings + per-dimension format
// (D3). `values` accepts the parsed array or the raw values_json string.
export function validateRegionRule(raw: unknown): LeadgenRegionRuleCreateResult {
  const errors: FieldErrors = {};
  if (!isRecord(raw)) {
    return { errors: { body: "region rule must be a JSON object" }, value: null };
  }

  const dimension = raw["dimension"];
  if (!isOneOf(dimension, LEADGEN_REGION_DIMENSIONS)) {
    errors["dimension"] = enumError("dimension", LEADGEN_REGION_DIMENSIONS);
  }
  const action = raw["action"];
  if (!isOneOf(action, LEADGEN_RULE_ACTIONS)) {
    errors["action"] = enumError("action", LEADGEN_RULE_ACTIONS);
  }

  let rawValues: unknown = raw["values"] ?? raw["values_json"];
  if (typeof rawValues === "string") {
    try {
      rawValues = JSON.parse(rawValues);
    } catch {
      errors["values_json"] = "values_json must be valid JSON";
      rawValues = undefined;
    }
  }
  const values: string[] = [];
  if (rawValues !== undefined && errors["values_json"] === undefined) {
    if (!Array.isArray(rawValues) || rawValues.length === 0) {
      errors["values_json"] = "values_json must be a non-empty array of strings";
    } else {
      const dim = isOneOf(dimension, LEADGEN_REGION_DIMENSIONS) ? dimension : null;
      for (let i = 0; i < rawValues.length; i++) {
        const value = trimmedString(rawValues[i]);
        if (value === null) {
          errors[`values_json[${i}]`] = "region values must be non-empty strings";
        } else {
          // D3 (07 §7.5): per-dimension format validation — `zip:"not-a-zip"`
          // and malformed country/state codes can no longer save. Typed
          // `region_value_invalid` (dimension + offending token). City is
          // free text (trimmed non-empty, already checked).
          const invalid = dim !== null ? regionValueError(dim, value) : null;
          if (invalid !== null) {
            errors[`values_json[${i}]`] = `region_value_invalid: ${invalid}`;
          } else {
            values.push(value);
          }
        }
      }
    }
  } else if (rawValues === undefined && errors["values_json"] === undefined) {
    errors["values_json"] = "values_json is required";
  }

  let priority = 100; // DDL default
  if (raw["priority"] !== undefined && raw["priority"] !== null) {
    if (typeof raw["priority"] !== "number" || !Number.isInteger(raw["priority"])) {
      errors["priority"] = "priority must be an integer";
    } else {
      priority = raw["priority"];
    }
  }
  let enabled = true; // DDL default
  if (raw["enabled"] !== undefined && raw["enabled"] !== null) {
    const toggled = asToggle(raw["enabled"]);
    if (toggled === null) {
      errors["enabled"] = "enabled must be a boolean";
    } else {
      enabled = toggled;
    }
  }

  if (Object.keys(errors).length > 0) return { errors, value: null };
  return {
    errors,
    value: {
      dimension: dimension as LeadgenRegionDimension,
      action: action as LeadgenRuleAction,
      values,
      priority,
      enabled,
    },
  };
}

// ---------------------------------------------------------------------------
// §10.6 cap fields
// ---------------------------------------------------------------------------

// True when `tz` is a resolvable IANA timezone name (Intl is the same
// resolver caps.ts formats period keys with, so accept == derivable).
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface LeadgenCapFieldsInput {
  cap_enabled: number | boolean;
  cap_amount?: unknown;
  cap_timezone?: unknown;
  cap_count_by?: unknown;
  cap_fallback_offer_id?: unknown;
  cap_fallback_url?: unknown;
}

// §10.6: cap_enabled ⇒ cap_amount (positive integer, DDL INTEGER) +
// cap_timezone (resolvable IANA name) + cap_count_by (clicks|conversions).
// Fallbacks are optional either way; when present they must be typed
// (fallback-offer referential existence is a handler/DB check).
export function validateOfferCapFields(raw: LeadgenCapFieldsInput): FieldErrors {
  const errors: FieldErrors = {};
  const capEnabled = asToggle(raw.cap_enabled) === true;

  if (capEnabled) {
    const amount = raw.cap_amount;
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
      errors["cap_amount"] = "cap_enabled requires cap_amount to be a positive integer";
    }
    const tz = trimmedString(raw.cap_timezone);
    if (tz === null) {
      errors["cap_timezone"] = "cap_enabled requires cap_timezone";
    } else if (!isValidTimezone(tz)) {
      errors["cap_timezone"] = `'${tz}' is not a valid IANA timezone`;
    }
    if (!isOneOf(raw.cap_count_by, LEADGEN_CAP_COUNT_BY)) {
      errors["cap_count_by"] = enumError("cap_count_by", LEADGEN_CAP_COUNT_BY);
    }
  }

  if (raw.cap_fallback_offer_id !== undefined && raw.cap_fallback_offer_id !== null) {
    const id = raw.cap_fallback_offer_id;
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
      errors["cap_fallback_offer_id"] = "cap_fallback_offer_id must be a positive integer";
    }
  }
  if (raw.cap_fallback_url !== undefined && raw.cap_fallback_url !== null) {
    const url = trimmedString(raw.cap_fallback_url);
    if (url === null || !isAbsoluteHttpUrl(url)) {
      errors["cap_fallback_url"] = "cap_fallback_url must be an absolute http(s) URL";
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// §11.8 payload-schema publish gate — dynamic-auction eligibility
// ---------------------------------------------------------------------------

export type LeadgenOfferTestStatus = "untested" | "passed" | "failed";

export type LeadgenDynamicIneligibilityReason =
  | "no_active_schema"
  | "schema_validation_errors"
  | "test_untested"
  | "test_failed"
  // fix-contract v2.4 05 §5.1 additive block conditions (R4):
  | "endpoint_missing" // no endpoint configured for the SELECTED environment
  | "invalid_headers" // a headers row that cannot resolve (empty name / empty macro or secret ref)
  | "carrier_parse_missing" // dynamic Offer's active schema has no carrier_parse_json
  | "carrier_parse_invalid"; // carrier_parse_json present but not a usable parse config

export interface LeadgenDynamicEligibilityVerdict {
  eligible: boolean;
  reasons: LeadgenDynamicIneligibilityReason[];
}

// The 05 §5.1 additive inputs. Every field is OPTIONAL and its check runs only
// when the caller supplies it (undefined = not evaluated), so the original
// 4-code call sites keep their exact behavior — the extension is additive.
export interface LeadgenDynamicEligibilityExtras {
  // The endpoint for the SELECTED environment ("" / null = missing).
  endpoint?: string | null;
  // The Offer's header rows (leadgen_offer_headers projection).
  headers?: readonly { header_name: string; value_kind: string; value_text: string | null }[];
  // The PARSED carrier_parse_json of the active schema. `null` = the column is
  // NULL / unparseable (missing); a non-record or a config without a usable
  // `fields` object = invalid. Pass `undefined` to skip the check.
  carrier_parse?: unknown;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A header row that can never resolve at request time: an empty header name,
// or a macro/secret_ref row with no ref text (static rows may legitimately
// carry an empty value).
function headersInvalid(
  headers: readonly { header_name: string; value_kind: string; value_text: string | null }[],
): boolean {
  for (const row of headers) {
    if (row.header_name.trim() === "") return true;
    const valueText = (row.value_text ?? "").trim();
    if ((row.value_kind === "secret_ref" || row.value_kind === "macro") && valueText === "") return true;
  }
  return false;
}

// §11.8 + 05 §5.1: an Offer with calls_provider_api=1 cannot go live in a
// DYNAMIC auction while its active payload schema has validation errors, an
// untested/failed Test status, no endpoint for the selected environment,
// unresolvable headers, or a missing/invalid response parser. Pure verdict —
// P9/P10 (auction config save + runtime candidate selection) + the R5
// activation preflight consume it. Offers that do not call a provider are
// outside this gate (they carry no payload schema; their surfacing is the
// §18.2 static path). `cap_reached` is deliberately NOT here — caps are a
// runtime-only exclusion the engine surfaces in explainability (05 §5.1).
export function dynamicAuctionEligibility(
  offer: { calls_provider_api: number | boolean },
  schemaValidation: LeadgenPayloadSchemaValidation | null,
  lastTestStatus: LeadgenOfferTestStatus | null,
  extras?: LeadgenDynamicEligibilityExtras,
): LeadgenDynamicEligibilityVerdict {
  if (asToggle(offer.calls_provider_api) !== true) {
    return { eligible: true, reasons: [] };
  }
  const reasons: LeadgenDynamicIneligibilityReason[] = [];
  if (schemaValidation === null) {
    reasons.push("no_active_schema");
  } else if (!schemaValidation.ok) {
    reasons.push("schema_validation_errors");
  }
  if (lastTestStatus === null || lastTestStatus === "untested") {
    reasons.push("test_untested");
  } else if (lastTestStatus === "failed") {
    reasons.push("test_failed");
  }
  if (extras !== undefined) {
    if (extras.endpoint !== undefined) {
      const endpoint = typeof extras.endpoint === "string" ? extras.endpoint.trim() : "";
      if (endpoint === "") reasons.push("endpoint_missing");
    }
    if (extras.headers !== undefined && headersInvalid(extras.headers)) {
      reasons.push("invalid_headers");
    }
    if (extras.carrier_parse !== undefined) {
      if (extras.carrier_parse === null) {
        reasons.push("carrier_parse_missing");
      } else if (
        !isPlainRecord(extras.carrier_parse) ||
        !isPlainRecord((extras.carrier_parse as Record<string, unknown>)["fields"])
      ) {
        reasons.push("carrier_parse_invalid");
      }
    }
  }
  return { eligible: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// §5.1 shared admin-side eligibility loader (auctions PUT warnings + the R5
// activation preflight). The ENGINE evaluates the same pure verdict over its
// already-loaded auction bundle; this loader exists so every ADMIN surface
// reads the identical inputs (schema row, headers, Test status) one way.
// ---------------------------------------------------------------------------

export interface LeadgenOfferEligibilityRow {
  offer_id: number;
  offer_public_id: string;
  offer_name: string;
  verdict: LeadgenDynamicEligibilityVerdict;
}

// The Offer's Test status = the newest TEST-TOOL provider_request_log row
// (auction_instance_id IS NULL — runtime auction rows never flip an Offer's
// Test verdict; §5.1 test_untested/test_failed is the OPERATOR Test status):
// 2xx → passed; a non-null non-2xx status → failed; no rows OR a
// transport-error row (NULL status_code — the request never returned) →
// untested (m4: both non-passed codes block eligibility identically).
export const LEADGEN_TEST_STATUS_SUBSELECT = `(
  SELECT CASE WHEN prl.status_code >= 200 AND prl.status_code < 300 THEN 'passed'
              WHEN prl.status_code IS NULL THEN 'untested' ELSE 'failed' END
    FROM leadgen_provider_request_log prl
    WHERE prl.offer_public_id = o.public_id AND prl.auction_instance_id IS NULL
    ORDER BY prl.created_at DESC, prl.id DESC LIMIT 1)`;

// Evaluate §5.1 eligibility for a set of Offers by numeric id (chunked ≤80;
// every query .bind()-parameterized). Environment selects which endpoint must
// exist (the live runtime is production). Static Offers come back eligible.
export async function evaluateDynamicOffersEligibility(
  db: D1Database,
  offerIds: readonly number[],
  environment: "production" | "staging",
): Promise<Map<number, LeadgenOfferEligibilityRow>> {
  const out = new Map<number, LeadgenOfferEligibilityRow>();
  const unique = [...new Set(offerIds)];
  if (unique.length === 0) return out;

  interface OfferEligibilityQueryRow {
    id: number;
    public_id: string;
    offer_name: string;
    calls_provider_api: number;
    active_payload_schema_id: number | null;
    endpoint_production: string | null;
    endpoint_staging: string | null;
    schema_json: string | null;
    carrier_parse_json: string | null;
    last_test_status: LeadgenOfferTestStatus | null;
  }
  const rows: OfferEligibilityQueryRow[] = [];
  for (let i = 0; i < unique.length; i += 80) {
    const ids = unique.slice(i, i + 80);
    const marks = ids.map(() => "?").join(",");
    const res = await db
      .prepare(
        `SELECT o.id, o.public_id, o.offer_name, o.calls_provider_api, o.active_payload_schema_id,
                o.endpoint_production, o.endpoint_staging,
                s.schema_json AS schema_json, s.carrier_parse_json AS carrier_parse_json,
                ${LEADGEN_TEST_STATUS_SUBSELECT} AS last_test_status
           FROM leadgen_offers o
           LEFT JOIN leadgen_offer_payload_schemas s ON s.id = o.active_payload_schema_id
          WHERE o.id IN (${marks})`,
      )
      .bind(...ids)
      .all<OfferEligibilityQueryRow>();
    for (const r of res.results ?? []) rows.push(r);
  }

  // Headers per offer (chunked).
  const headersByOffer = new Map<number, { header_name: string; value_kind: string; value_text: string | null }[]>();
  const dynamicIds = rows.filter((r) => r.calls_provider_api === 1).map((r) => r.id);
  for (let i = 0; i < dynamicIds.length; i += 80) {
    const ids = dynamicIds.slice(i, i + 80);
    if (ids.length === 0) continue;
    const marks = ids.map(() => "?").join(",");
    const res = await db
      .prepare(
        `SELECT offer_id, header_name, value_kind, value_text FROM leadgen_offer_headers WHERE offer_id IN (${marks})`,
      )
      .bind(...ids)
      .all<{ offer_id: number; header_name: string; value_kind: string; value_text: string | null }>();
    for (const h of res.results ?? []) {
      const list = headersByOffer.get(h.offer_id) ?? [];
      list.push({ header_name: h.header_name, value_kind: h.value_kind, value_text: h.value_text });
      headersByOffer.set(h.offer_id, list);
    }
  }

  for (const r of rows) {
    let schemaValidation: LeadgenPayloadSchemaValidation | null = null;
    let carrierParse: unknown = null;
    if (r.active_payload_schema_id !== null && r.schema_json !== null) {
      let parsedSchema: unknown = null;
      try {
        parsedSchema = JSON.parse(r.schema_json) as unknown;
      } catch {
        parsedSchema = null;
      }
      schemaValidation = parsedSchema === null ? null : validatePayloadSchema(parsedSchema);
    }
    if (r.carrier_parse_json !== null) {
      try {
        carrierParse = JSON.parse(r.carrier_parse_json) as unknown;
      } catch {
        carrierParse = null;
      }
    }
    const endpoint = environment === "staging" ? r.endpoint_staging : r.endpoint_production;
    const verdict = dynamicAuctionEligibility(
      { calls_provider_api: r.calls_provider_api },
      schemaValidation,
      r.last_test_status,
      {
        endpoint,
        headers: headersByOffer.get(r.id) ?? [],
        carrier_parse: carrierParse,
      },
    );
    out.set(r.id, {
      offer_id: r.id,
      offer_public_id: r.public_id,
      offer_name: r.offer_name,
      verdict,
    });
  }
  return out;
}
