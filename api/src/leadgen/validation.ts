// Server-side Offer validators (contract 04 §10.1/§10.3/§10.4/§10.5/§10.6 +
// §11.8). Mirrors the listicles validation idiom: every validator returns
// FIELD-KEYED errors — the API failure envelope is { error, fields } (03
// §8.4) and these maps plug straight into `fields`.
//
// Validators are PURE (no DB access). Referential checks that need the
// database — "fallback offer exists & active", placement uniqueness against
// stored rows, schema-version existence — live in the Stage-B handlers,
// which merge their findings into the same field-keyed map.

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
import type { LeadgenPayloadSchemaValidation } from "./payload";

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

// Validate one region rule: dimension/action from the DDL CHECK enums,
// values_json a non-empty array of non-empty strings. `values` accepts the
// parsed array or the raw values_json string (handlers pass either).
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
      for (let i = 0; i < rawValues.length; i++) {
        const value = trimmedString(rawValues[i]);
        if (value === null) {
          errors[`values_json[${i}]`] = "region values must be non-empty strings";
        } else {
          values.push(value);
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
  | "test_failed";

export interface LeadgenDynamicEligibilityVerdict {
  eligible: boolean;
  reasons: LeadgenDynamicIneligibilityReason[];
}

// §11.8: an Offer with calls_provider_api=1 cannot go live in a DYNAMIC
// auction while its active payload schema has validation errors or an
// untested/failed Test status. Pure verdict — P9/P10 (auction config save +
// runtime candidate selection) consume it. Offers that do not call a
// provider are outside this gate (they carry no payload schema; their
// surfacing is the §18.2 static path).
export function dynamicAuctionEligibility(
  offer: { calls_provider_api: number | boolean },
  schemaValidation: LeadgenPayloadSchemaValidation | null,
  lastTestStatus: LeadgenOfferTestStatus | null,
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
  return { eligible: reasons.length === 0, reasons };
}
