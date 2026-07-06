// LeadGen DB/API type layer — generated from migrations 0036_leadgen_core.sql,
// 0037_leadgen_analytics_mirror.sql, 0038_leadgen_revenue_infra.sql and
// 0039_leadgen_conversion_dedupe.sql per contract 02 §7 (D1 schema) + 03 §8.5
// (Row vs API shape split). Every table gets a Row type and an API type.
//
// Convention (mirrors the admin/listicles row typing):
//  - `XxxRow` — exact D1 shape: snake_case keys in DDL column order, INTEGER
//    bools as `number`, JSON TEXT columns as `string` (`| null` when the
//    column is nullable), CHECK(col IN (...)) enums as exported string-literal
//    unions (reused by Row and API).
//  - `XxxApi` — the admin JSON shape: same snake stable keys, INTEGER bools as
//    `boolean`, `*_json` columns parsed — typed where the contract defines a
//    shape (07 §21.4 conditions, 07 §20 canonical Carrier fields, the §7.4
//    result-log payload comments), else `unknown` (which also admits null for
//    nullable columns, matching listicles' cast-at-use-site treatment of
//    opaque JSON).
//  - Tables whose row shape is already API-stable (no INTEGER bools, no
//    `*_json` columns) alias `Api = Row` — analytics mirrors and runtime logs
//    are served as-is, exactly how listicles serves its mirror rows.
//  - Purely declarative: no runtime mapping helpers here (listicles keeps its
//    row types declarative; handlers own Row→API mapping per 03 §8.5).

// ---------------------------------------------------------------------------
// Enums — string-literal unions derived from CHECK(col IN (...)) constraints
// ---------------------------------------------------------------------------

// leadgen_offers
export type LeadgenTrackingMethod = "s2s_postback" | "browser_side_pixel" | "script";
export type LeadgenOfferType = "cpc" | "cpl" | "cpa" | "cpi";
export type LeadgenBidSource = "response" | "static";
export type LeadgenRequestExecutionMode = "server" | "client";
export type LeadgenRequestMethod = "POST" | "GET" | "PUT";
export type LeadgenApiTokenPlacement = "header" | "payload" | "query";
export type LeadgenCapCountBy = "clicks" | "conversions";
export type LeadgenOfferStatus = "active" | "paused" | "archived";

// leadgen_offer_payload_schemas
export type LeadgenPayloadSchemaSource = "manual" | "auto_from_example";

// leadgen_offer_headers
export type LeadgenHeaderValueKind = "static" | "macro" | "secret_ref";

// leadgen_offer_region_rules (action is shared with leadgen_auction_rules)
export type LeadgenRegionDimension = "country" | "state" | "city" | "zip";
export type LeadgenRuleAction = "include_only" | "exclude" | "allow_list" | "block_list";

// leadgen_sections + leadgen_section_available_offers + leadgen_section_answer_maps
export type LeadgenContinueMode = "button" | "auto_advance";
export type LeadgenSectionStatus = "active" | "archived";
export type LeadgenMappingState = "selected" | "incomplete" | "complete" | "invalid";
export type LeadgenMappingStatus = "complete" | "incomplete" | "type_mismatch" | "orphaned";
export type LeadgenValidationStatus = "ok" | "error";

// leadgen_quotes / leadgen_funnels / leadgen_funnel_ab_tests / leadgen_funnel_variants
export type LeadgenQuoteStatus = "draft" | "active" | "archived";
export type LeadgenFunnelStatus = "draft" | "active" | "archived";
export type LeadgenAbTestStatus = "draft" | "running" | "stopped";
export type LeadgenFunnelVariantStatus = "active" | "archived";

// leadgen_funnel_rules
export type LeadgenFunnelRuleType =
  | "redirect_direct_offer"
  | "skip_section"
  | "show_section"
  | "eligibility"
  | "disqualification"
  | "auction_entry";

// leadgen_auctions (removal_scope is shared with leadgen_session_clicked_offers)
export type LeadgenAuctionType = "static" | "dynamic";
export type LeadgenWinnerLogic = "highest_bid" | "average_bid" | "sum_bids";
export type LeadgenFloorType = "percentage_of_max" | "absolute_bid";
export type LeadgenMultiOfferMode = "disabled" | "enabled" | "enabled_unique";
export type LeadgenRenderMode = "all_at_once" | "progressive";
export type LeadgenBackfillMode = "disabled" | "enabled" | "enabled_unique";
export type LeadgenBackfillTrigger = "on_slot_exhaustion" | "on_click" | "on_dismiss";
export type LeadgenRemovalScope = "offer" | "carrier";
export type LeadgenAuctionStatus = "active" | "paused" | "archived";

// leadgen_auction_rules
export type LeadgenRuleLevel = "offer" | "carrier";

// leadgen_auction_banners
export type LeadgenBannerMode = "manual" | "automatic";

// leadgen_provider_request_log
export type LeadgenEnvironment = "staging" | "production";

// leadgen_analytics_answer_distribution
export type LeadgenAnswerSource = "default_applied" | "user_selected" | "user_confirmed_default";

// leadgen_revenue_raw
export type LeadgenRevenueSource = "s2s_postback" | "api" | "script" | "in_site";
export type LeadgenBookingTrigger = "click" | "conversion";

// leadgen_revenue_unmatched
export type LeadgenUnmatchedRevenueStatus = "pending" | "matched" | "unattributed";

// ---------------------------------------------------------------------------
// Contract-defined parsed JSON shapes
// ---------------------------------------------------------------------------

// conditions_json (leadgen_funnel_rules + leadgen_auction_rules) — typed
// conditions per contract 07 §21.4: OR within a field, AND across fields.
export type LeadgenConditionOp =
  | "eq"
  | "neq"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "range"
  | "in"
  | "not_in";

export interface LeadgenRuleConditionGroup {
  field: string;
  op: LeadgenConditionOp;
  value?: unknown;
  values?: unknown[];
  from?: number;
  to?: number;
}

export interface LeadgenRuleConditions {
  groups: LeadgenRuleConditionGroup[];
}

// Canonical normalized Carrier (contract 07 §20): every provider response is
// normalized to this shape by the Offer's carrier_parse_json before banner
// mapping. Only carrier_key is guaranteed (07 §18 key derivation).
export interface LeadgenCarrier {
  carrier_key: string;
  carrier_name?: string | null;
  carrier_logo?: string | null;
  headline?: string | null;
  subheadline?: string | null;
  click_url?: string | null;
  bid?: number | null;
  bid_currency?: string | null;
  tracking_id?: string | null;
  disclaimer?: string | null;
}

// leadgen_auction_result_log explainability payloads (§7.4 DDL comments).
// Ids are public-id strings — the runtime/event currency per the analytics DDL.
export interface LeadgenAuctionConsideredOffer {
  offer_id: string;
  placement_id: string;
}

// reason ∈ rule/cap/region/timeout/no_bid/below_floor (free text in DDL).
export interface LeadgenAuctionExcludedOffer {
  offer_id: string;
  reason: string;
}

export interface LeadgenAuctionShownCarrier {
  carrier_key: string;
  offer_id: string;
  bid: number;
  slot: number;
}

export interface LeadgenAuctionWinner {
  offer_id: string;
  logic: LeadgenWinnerLogic;
  score: number;
}

// ---------------------------------------------------------------------------
// §7.1 Offers (0036)
// ---------------------------------------------------------------------------

// leadgen_offers
export interface LeadgenOfferRow {
  id: number;
  public_id: string;
  offer_name: string;
  provider: string | null;
  activity: string;
  vertical: string;
  tag: string | null;
  conversion_tracking_method: LeadgenTrackingMethod;
  offer_type: LeadgenOfferType;
  calls_provider_api: number;
  bid_source: LeadgenBidSource;
  request_execution_mode: LeadgenRequestExecutionMode;
  static_bid_value: number | null;
  static_bid_currency: string | null;
  static_order: number | null;
  banner_url_template: string | null;
  static_fallback_banner_url: string | null;
  request_method: LeadgenRequestMethod | null;
  endpoint_production: string | null;
  endpoint_staging: string | null;
  api_token_secret_ref: string | null;
  api_token_placement: LeadgenApiTokenPlacement | null;
  api_token_param_name: string | null;
  active_payload_schema_id: number | null;
  cap_enabled: number;
  cap_amount: number | null;
  cap_timezone: string | null;
  cap_count_by: LeadgenCapCountBy | null;
  cap_fallback_offer_id: number | null;
  cap_fallback_url: string | null;
  status: LeadgenOfferStatus;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

export interface LeadgenOfferApi {
  id: number;
  public_id: string;
  offer_name: string;
  provider: string | null;
  activity: string;
  vertical: string;
  tag: string | null;
  conversion_tracking_method: LeadgenTrackingMethod;
  offer_type: LeadgenOfferType;
  calls_provider_api: boolean;
  bid_source: LeadgenBidSource;
  request_execution_mode: LeadgenRequestExecutionMode;
  static_bid_value: number | null;
  static_bid_currency: string | null;
  static_order: number | null;
  banner_url_template: string | null;
  static_fallback_banner_url: string | null;
  request_method: LeadgenRequestMethod | null;
  endpoint_production: string | null;
  endpoint_staging: string | null;
  api_token_secret_ref: string | null;
  api_token_placement: LeadgenApiTokenPlacement | null;
  api_token_param_name: string | null;
  active_payload_schema_id: number | null;
  cap_enabled: boolean;
  cap_amount: number | null;
  cap_timezone: string | null;
  cap_count_by: LeadgenCapCountBy | null;
  cap_fallback_offer_id: number | null;
  cap_fallback_url: string | null;
  status: LeadgenOfferStatus;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

// leadgen_offer_placements
export interface LeadgenOfferPlacementRow {
  id: number;
  public_id: string;
  offer_id: number;
  placement_id: string;
  label: string | null;
  is_default: number;
  created_at: number;
}

export interface LeadgenOfferPlacementApi {
  id: number;
  public_id: string;
  offer_id: number;
  placement_id: string;
  label: string | null;
  is_default: boolean;
  created_at: number;
}

// leadgen_offer_payload_schemas
export interface LeadgenOfferPayloadSchemaRow {
  id: number;
  public_id: string;
  offer_id: number;
  version: number;
  schema_json: string;
  sample_response_json: string | null;
  carrier_parse_json: string | null;
  carrier_parse_version: number;
  source: LeadgenPayloadSchemaSource;
  created_by: string | null;
  created_at: number;
}

export interface LeadgenOfferPayloadSchemaApi {
  id: number;
  public_id: string;
  offer_id: number;
  version: number;
  schema_json: unknown;
  sample_response_json: unknown;
  carrier_parse_json: unknown;
  carrier_parse_version: number;
  source: LeadgenPayloadSchemaSource;
  created_by: string | null;
  created_at: number;
}

// leadgen_offer_headers — row shape is already API-stable.
export interface LeadgenOfferHeaderRow {
  id: number;
  offer_id: number;
  header_name: string;
  value_kind: LeadgenHeaderValueKind;
  value_text: string | null;
  created_at: number;
}

export type LeadgenOfferHeaderApi = LeadgenOfferHeaderRow;

// leadgen_offer_region_rules
export interface LeadgenOfferRegionRuleRow {
  id: number;
  public_id: string;
  offer_id: number;
  dimension: LeadgenRegionDimension;
  action: LeadgenRuleAction;
  values_json: string;
  priority: number;
  enabled: number;
  created_at: number;
}

export interface LeadgenOfferRegionRuleApi {
  id: number;
  public_id: string;
  offer_id: number;
  dimension: LeadgenRegionDimension;
  action: LeadgenRuleAction;
  values_json: unknown;
  priority: number;
  enabled: boolean;
  created_at: number;
}

// leadgen_offer_cap_counters — composite PK (offer_id, cap_date); API-stable.
export interface LeadgenOfferCapCounterRow {
  offer_id: number;
  cap_date: string;
  timezone: string;
  click_count: number;
  conversion_count: number;
  updated_at: number;
}

export type LeadgenOfferCapCounterApi = LeadgenOfferCapCounterRow;

// ---------------------------------------------------------------------------
// §7.2 Sections (0036)
// ---------------------------------------------------------------------------

// leadgen_sections
export interface LeadgenSectionRow {
  id: number;
  public_id: string;
  section_name: string;
  activity: string;
  vertical: string;
  headline_text: string;
  subheadline_text: string | null;
  image_json: string | null;
  content_json: string;
  content_html: string | null;
  continue_mode: LeadgenContinueMode;
  design_overrides_json: string | null;
  address_validation_enabled: number;
  section_mapping_version: number;
  content_version: number;
  status: LeadgenSectionStatus;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

export interface LeadgenSectionApi {
  id: number;
  public_id: string;
  section_name: string;
  activity: string;
  vertical: string;
  headline_text: string;
  subheadline_text: string | null;
  image_json: unknown;
  content_json: unknown;
  content_html: string | null;
  continue_mode: LeadgenContinueMode;
  design_overrides_json: unknown;
  address_validation_enabled: boolean;
  section_mapping_version: number;
  content_version: number;
  status: LeadgenSectionStatus;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

// leadgen_section_available_offers — composite PK (section_id, offer_id).
export interface LeadgenSectionAvailableOfferRow {
  section_id: number;
  offer_id: number;
  selected: number;
  mapping_state: LeadgenMappingState;
  required_fields_total: number;
  required_fields_mapped: number;
}

export interface LeadgenSectionAvailableOfferApi {
  section_id: number;
  offer_id: number;
  selected: boolean;
  mapping_state: LeadgenMappingState;
  required_fields_total: number;
  required_fields_mapped: number;
}

// leadgen_section_answer_maps
export interface LeadgenSectionAnswerMapRow {
  id: number;
  public_id: string;
  section_id: number;
  question_id: string;
  question_key: string;
  internal_field: string;
  answer_type: string;
  offer_id: number;
  payload_schema_id: number;
  payload_schema_public_id: string;
  offer_payload_field_path: string;
  provider_expected_type: string;
  output_value_map_json: string | null;
  transform_json: string | null;
  required_for_offer: number;
  default_value: string | null;
  fallback_value: string | null;
  mapping_status: LeadgenMappingStatus;
  validation_status: LeadgenValidationStatus;
  created_at: number;
}

export interface LeadgenSectionAnswerMapApi {
  id: number;
  public_id: string;
  section_id: number;
  question_id: string;
  question_key: string;
  internal_field: string;
  answer_type: string;
  offer_id: number;
  payload_schema_id: number;
  payload_schema_public_id: string;
  offer_payload_field_path: string;
  provider_expected_type: string;
  output_value_map_json: unknown;
  transform_json: unknown;
  required_for_offer: boolean;
  default_value: string | null;
  fallback_value: string | null;
  mapping_status: LeadgenMappingStatus;
  validation_status: LeadgenValidationStatus;
  created_at: number;
}

// ---------------------------------------------------------------------------
// §7.3 Quotes / Funnels / Variants / Activation (0036)
// ---------------------------------------------------------------------------

// leadgen_quotes
export interface LeadgenQuoteRow {
  id: number;
  public_id: string;
  quote_name: string;
  activity: string;
  verticals_json: string;
  status: LeadgenQuoteStatus;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

export interface LeadgenQuoteApi {
  id: number;
  public_id: string;
  quote_name: string;
  activity: string;
  verticals_json: unknown;
  status: LeadgenQuoteStatus;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

// leadgen_funnels — row shape is already API-stable.
export interface LeadgenFunnelRow {
  id: number;
  public_id: string;
  quote_id: number;
  funnel_name: string;
  active_ab_test_id: number | null;
  status: LeadgenFunnelStatus;
  created_at: number;
  updated_at: number;
}

export type LeadgenFunnelApi = LeadgenFunnelRow;

// leadgen_funnel_ab_tests — row shape is already API-stable.
export interface LeadgenFunnelAbTestRow {
  id: number;
  public_id: string;
  funnel_id: number;
  name: string;
  revision: number;
  status: LeadgenAbTestStatus;
  started_at: number | null;
  stopped_at: number | null;
  created_at: number;
}

export type LeadgenFunnelAbTestApi = LeadgenFunnelAbTestRow;

// leadgen_funnel_variants
export interface LeadgenFunnelVariantRow {
  id: number;
  public_id: string;
  funnel_id: number;
  ab_test_id: number | null;
  variant_label: string;
  is_control: number;
  traffic_allocation_bp: number;
  funnel_design_id: string;
  auction_id: number | null;
  lander_enabled: number;
  lander_headline: string | null;
  lander_subheadline: string | null;
  lander_body_json: string | null;
  lander_hero_media_id: number | null;
  lander_hero_media_url: string | null;
  lander_cta_json: string | null;
  content_version: number;
  status: LeadgenFunnelVariantStatus;
  created_at: number;
}

export interface LeadgenFunnelVariantApi {
  id: number;
  public_id: string;
  funnel_id: number;
  ab_test_id: number | null;
  variant_label: string;
  is_control: boolean;
  traffic_allocation_bp: number;
  funnel_design_id: string;
  auction_id: number | null;
  lander_enabled: boolean;
  lander_headline: string | null;
  lander_subheadline: string | null;
  lander_body_json: unknown;
  lander_hero_media_id: number | null;
  lander_hero_media_url: string | null;
  lander_cta_json: unknown;
  content_version: number;
  status: LeadgenFunnelVariantStatus;
  created_at: number;
}

// leadgen_funnel_variant_sections — row shape is already API-stable.
export interface LeadgenFunnelVariantSectionRow {
  id: number;
  variant_id: number;
  section_id: number;
  position: number;
  created_at: number;
}

export type LeadgenFunnelVariantSectionApi = LeadgenFunnelVariantSectionRow;

// leadgen_funnel_rules
export interface LeadgenFunnelRuleRow {
  id: number;
  public_id: string;
  variant_id: number;
  rule_type: LeadgenFunnelRuleType;
  conditions_json: string;
  conditions_hash: string;
  target_offer_id: number | null;
  target_section_id: number | null;
  redirect_url: string | null;
  redirect_url_allowlisted: number;
  priority: number;
  enabled: number;
  created_at: number;
}

export interface LeadgenFunnelRuleApi {
  id: number;
  public_id: string;
  variant_id: number;
  rule_type: LeadgenFunnelRuleType;
  conditions_json: LeadgenRuleConditions;
  conditions_hash: string;
  target_offer_id: number | null;
  target_section_id: number | null;
  redirect_url: string | null;
  redirect_url_allowlisted: boolean;
  priority: number;
  enabled: boolean;
  created_at: number;
}

// leadgen_site_quotes
export interface LeadgenSiteQuoteRow {
  id: number;
  site_id: string;
  quote_id: number;
  enabled: number;
  slug: string | null;
  settings_overrides_json: string | null;
  created_at: number;
  updated_at: number;
}

export interface LeadgenSiteQuoteApi {
  id: number;
  site_id: string;
  quote_id: number;
  enabled: boolean;
  slug: string | null;
  settings_overrides_json: unknown;
  created_at: number;
  updated_at: number;
}

// ---------------------------------------------------------------------------
// §7.4 Auction (0036)
// ---------------------------------------------------------------------------

// leadgen_auctions
export interface LeadgenAuctionRow {
  id: number;
  public_id: string;
  auction_name: string;
  quote_id: number | null;
  funnel_id: number | null;
  funnel_variant_id: number | null;
  auction_type: LeadgenAuctionType;
  banner_design_id: string;
  winner_logic: LeadgenWinnerLogic;
  floor_type: LeadgenFloorType;
  floor_value: number;
  mixed_payout_warn: number;
  multi_offer: LeadgenMultiOfferMode;
  surface_static_bid_offers: number;
  banner_slots_count: number;
  max_carriers_per_offer: number;
  max_total_carriers: number;
  render_mode: LeadgenRenderMode;
  backfill: LeadgenBackfillMode;
  backfill_source_offer_id: number | null;
  backfill_trigger: LeadgenBackfillTrigger;
  remove_clicked_offers: number;
  removal_scope: LeadgenRemovalScope;
  timeout_ms: number;
  carrier_normalization_version: number;
  banner_config_json: string | null;
  status: LeadgenAuctionStatus;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

export interface LeadgenAuctionApi {
  id: number;
  public_id: string;
  auction_name: string;
  quote_id: number | null;
  funnel_id: number | null;
  funnel_variant_id: number | null;
  auction_type: LeadgenAuctionType;
  banner_design_id: string;
  winner_logic: LeadgenWinnerLogic;
  floor_type: LeadgenFloorType;
  floor_value: number;
  mixed_payout_warn: boolean;
  multi_offer: LeadgenMultiOfferMode;
  surface_static_bid_offers: boolean;
  banner_slots_count: number;
  max_carriers_per_offer: number;
  max_total_carriers: number;
  render_mode: LeadgenRenderMode;
  backfill: LeadgenBackfillMode;
  backfill_source_offer_id: number | null;
  backfill_trigger: LeadgenBackfillTrigger;
  remove_clicked_offers: boolean;
  removal_scope: LeadgenRemovalScope;
  timeout_ms: number;
  carrier_normalization_version: number;
  banner_config_json: unknown;
  status: LeadgenAuctionStatus;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

// leadgen_auction_offers — composite PK (auction_id, offer_placement_id).
export interface LeadgenAuctionOfferRow {
  auction_id: number;
  offer_placement_id: number;
  offer_id: number;
  static_order: number | null;
  static_bid_override: number | null;
  enabled: number;
}

export interface LeadgenAuctionOfferApi {
  auction_id: number;
  offer_placement_id: number;
  offer_id: number;
  static_order: number | null;
  static_bid_override: number | null;
  enabled: boolean;
}

// leadgen_auction_rules
export interface LeadgenAuctionRuleRow {
  id: number;
  public_id: string;
  auction_id: number;
  rule_level: LeadgenRuleLevel;
  target_offer_id: number | null;
  action: LeadgenRuleAction;
  conditions_json: string;
  conditions_hash: string;
  carrier_match_json: string | null;
  strictly_override: number;
  priority: number;
  enabled: number;
  created_at: number;
}

export interface LeadgenAuctionRuleApi {
  id: number;
  public_id: string;
  auction_id: number;
  rule_level: LeadgenRuleLevel;
  target_offer_id: number | null;
  action: LeadgenRuleAction;
  conditions_json: LeadgenRuleConditions;
  conditions_hash: string;
  carrier_match_json: unknown;
  strictly_override: boolean;
  priority: number;
  enabled: boolean;
  created_at: number;
}

// leadgen_auction_banners
export interface LeadgenAuctionBannerRow {
  id: number;
  auction_id: number;
  mode: LeadgenBannerMode;
  field_map_json: string;
  created_at: number;
}

export interface LeadgenAuctionBannerApi {
  id: number;
  auction_id: number;
  mode: LeadgenBannerMode;
  field_map_json: unknown;
  created_at: number;
}

// leadgen_auction_result_log — bounded explainability log (pruned 7d).
export interface LeadgenAuctionResultLogRow {
  auction_instance_id: string;
  auction_result_id: string;
  auction_config_id: string;
  session_id: string | null;
  funnel_attempt_id: string | null;
  funnel_id: string | null;
  funnel_variant_id: string | null;
  banner_render_ids_json: string | null;
  offers_considered_json: string | null;
  offers_excluded_json: string | null;
  carriers_shown_json: string | null;
  winner_json: string | null;
  unfilled_reason: string | null;
  created_at: number;
}

export interface LeadgenAuctionResultLogApi {
  auction_instance_id: string;
  auction_result_id: string;
  auction_config_id: string;
  session_id: string | null;
  funnel_attempt_id: string | null;
  funnel_id: string | null;
  funnel_variant_id: string | null;
  banner_render_ids_json: string[] | null;
  offers_considered_json: LeadgenAuctionConsideredOffer[] | null;
  offers_excluded_json: LeadgenAuctionExcludedOffer[] | null;
  carriers_shown_json: LeadgenAuctionShownCarrier[] | null;
  winner_json: LeadgenAuctionWinner | null;
  unfilled_reason: string | null;
  created_at: number;
}

// leadgen_session_clicked_offers — composite PK (funnel_attempt_id, offer_id,
// carrier_key); row shape is already API-stable.
export interface LeadgenSessionClickedOfferRow {
  funnel_attempt_id: string;
  offer_id: number;
  carrier_key: string;
  session_id: string | null;
  auction_id: number | null;
  removal_scope: LeadgenRemovalScope;
  clicked_at: number;
}

export type LeadgenSessionClickedOfferApi = LeadgenSessionClickedOfferRow;

// leadgen_provider_request_log — redacted admin JSON + encrypted debug_ref.
export interface LeadgenProviderRequestLogRow {
  id: number;
  auction_instance_id: string | null;
  auction_request_id: string | null;
  provider_request_id: string | null;
  offer_public_id: string;
  placement_public_id: string | null;
  carrier_parse_version: number | null;
  environment: LeadgenEnvironment;
  status_code: number | null;
  latency_ms: number | null;
  request_headers_redacted_json: string | null;
  request_payload_redacted_json: string | null;
  response_redacted_json: string | null;
  parsed_carriers_json: string | null;
  debug_ref: string | null;
  provider_error_reason: string | null;
  error_text: string | null;
  created_at: number;
}

export interface LeadgenProviderRequestLogApi {
  id: number;
  auction_instance_id: string | null;
  auction_request_id: string | null;
  provider_request_id: string | null;
  offer_public_id: string;
  placement_public_id: string | null;
  carrier_parse_version: number | null;
  environment: LeadgenEnvironment;
  status_code: number | null;
  latency_ms: number | null;
  request_headers_redacted_json: unknown;
  request_payload_redacted_json: unknown;
  response_redacted_json: unknown;
  parsed_carriers_json: LeadgenCarrier[] | null;
  debug_ref: string | null;
  provider_error_reason: string | null;
  error_text: string | null;
  created_at: number;
}

// leadgen_debug_access_log — environment has no CHECK constraint here (audit
// rows may predate the enum); row shape is already API-stable.
export interface LeadgenDebugAccessLogRow {
  id: number;
  debug_ref: string;
  accessed_by: string;
  environment: string | null;
  accessed_at: number;
}

export type LeadgenDebugAccessLogApi = LeadgenDebugAccessLogRow;

// ---------------------------------------------------------------------------
// §7.5 Analytics mirrors (0037) — exactly 9, read-only. Mirror rows are
// already API-stable (snake keys, numeric metrics, no INTEGER bools and no
// *_json columns), so each Api aliases its Row — listicles serves mirror rows
// as-is the same way.
// ---------------------------------------------------------------------------

// leadgen_analytics_offer — PK (offer_public_id, date).
export interface LeadgenAnalyticsOfferRow {
  offer_public_id: string;
  date: string;
  offer_impressions: number;
  clicks: number;
  unique_clicks: number;
  conversions: number;
  revenue: number;
  synced_at: number;
}

export type LeadgenAnalyticsOfferApi = LeadgenAnalyticsOfferRow;

// leadgen_analytics_section — PK (section_public_id, date).
export interface LeadgenAnalyticsSectionRow {
  section_public_id: string;
  date: string;
  views: number | null;
  clicks: number | null;
  continued: number | null;
  validation_errors: number | null;
  default_applied: number | null;
  user_confirmed_default: number | null;
  user_selected: number | null;
  time_on_section_ms_sum: number | null;
  dropoffs: number | null;
  synced_at: number | null;
}

export type LeadgenAnalyticsSectionApi = LeadgenAnalyticsSectionRow;

// leadgen_analytics_answer_distribution — PK (section_public_id, question_key,
// answer_value_normalized, answer_source, date).
export interface LeadgenAnalyticsAnswerDistributionRow {
  section_public_id: string;
  question_key: string;
  answer_value_normalized: string;
  answer_source: LeadgenAnswerSource;
  date: string;
  count: number;
  continued_count: number;
  synced_at: number | null;
}

export type LeadgenAnalyticsAnswerDistributionApi = LeadgenAnalyticsAnswerDistributionRow;

// leadgen_analytics_quote — PK (quote_public_id, funnel_id, funnel_variant_id,
// site_id, traffic_source, date).
export interface LeadgenAnalyticsQuoteRow {
  quote_public_id: string;
  funnel_id: string;
  funnel_name: string | null;
  funnel_variant_id: string | null;
  funnel_ab_test_id: string | null;
  variant_label: string | null;
  site_id: string | null;
  traffic_source: string | null;
  date: string;
  visits: number | null;
  unique_visits: number | null;
  bounces: number | null;
  completions: number | null;
  clicks: number | null;
  conversions: number | null;
  unfilled: number | null;
  revenue: number | null;
  synced_at: number | null;
}

export type LeadgenAnalyticsQuoteApi = LeadgenAnalyticsQuoteRow;

// leadgen_analytics_quote_drilldown
export interface LeadgenAnalyticsQuoteDrilldownRow {
  quote_public_id: string;
  funnel_id: string;
  funnel_variant_id: string | null;
  site_id: string | null;
  traffic_source: string | null;
  device: string | null;
  state: string | null;
  section_public_id: string | null;
  section_index: number | null;
  question_key: string | null;
  answer_value_normalized: string | null;
  date: string;
  views: number | null;
  continued: number | null;
  clicks: number | null;
  conversions: number | null;
  revenue: number | null;
  synced_at: number | null;
}

export type LeadgenAnalyticsQuoteDrilldownApi = LeadgenAnalyticsQuoteDrilldownRow;

// leadgen_analytics_auction — PK (auction_public_id, date).
export interface LeadgenAnalyticsAuctionRow {
  auction_public_id: string;
  date: string;
  auctions: number | null;
  filled_auctions: number | null;
  unfilled_auctions: number | null;
  offer_impressions: number | null;
  carrier_impressions: number | null;
  carrier_clicks: number | null;
  bid_value_sum: number | null;
  eligible_bid_count: number | null;
  timeouts: number | null;
  below_floor: number | null;
  malformed: number | null;
  no_bid: number | null;
  provider_errors: number | null;
  latency_ms_sum: number | null;
  revenue: number | null;
  synced_at: number | null;
}

export type LeadgenAnalyticsAuctionApi = LeadgenAnalyticsAuctionRow;

// leadgen_analytics_auction_drilldown
export interface LeadgenAnalyticsAuctionDrilldownRow {
  auction_public_id: string;
  offer_public_id: string | null;
  carrier_key: string | null;
  device: string | null;
  state: string | null;
  date: string;
  offer_impressions: number | null;
  carrier_impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  bid_value_sum: number | null;
  revenue: number | null;
  carrier_filtered_reason: string | null;
  provider_error_reason: string | null;
  auction_unfilled_reason: string | null;
  synced_at: number | null;
}

export type LeadgenAnalyticsAuctionDrilldownApi = LeadgenAnalyticsAuctionDrilldownRow;

// leadgen_analytics_carrier — PK (auction_public_id, offer_public_id,
// carrier_key, date).
export interface LeadgenAnalyticsCarrierRow {
  auction_public_id: string;
  offer_public_id: string;
  carrier_key: string;
  carrier_name: string | null;
  date: string;
  carrier_impressions: number | null;
  clicks: number | null;
  unique_clicks: number | null;
  conversions: number | null;
  bid_value_sum: number | null;
  revenue: number | null;
  synced_at: number | null;
}

export type LeadgenAnalyticsCarrierApi = LeadgenAnalyticsCarrierRow;

// leadgen_analytics_provider_diagnostics — PK (offer_public_id,
// auction_public_id, provider_error_reason, date).
export interface LeadgenAnalyticsProviderDiagnosticsRow {
  offer_public_id: string;
  auction_public_id: string | null;
  date: string;
  requests: number | null;
  responses: number | null;
  timeouts: number | null;
  errors: number | null;
  no_bid: number | null;
  below_floor: number | null;
  latency_ms_sum: number | null;
  provider_error_reason: string | null;
  synced_at: number | null;
}

export type LeadgenAnalyticsProviderDiagnosticsApi = LeadgenAnalyticsProviderDiagnosticsRow;

// ---------------------------------------------------------------------------
// §7.6 Revenue infra (0038)
// ---------------------------------------------------------------------------

// leadgen_media_platforms
export interface LeadgenMediaPlatformRow {
  id: number;
  platform: string;
  enabled: number;
  postback_url_template: string;
  auth_secret_ref: string | null;
  event_name: string | null;
  value_multiplier: number;
  created_at: number;
}

export interface LeadgenMediaPlatformApi {
  id: number;
  platform: string;
  enabled: boolean;
  postback_url_template: string;
  auth_secret_ref: string | null;
  event_name: string | null;
  value_multiplier: number;
  created_at: number;
}

// leadgen_postback_log — UNIQUE (provider, external_txn_id).
export interface LeadgenPostbackLogRow {
  id: number;
  provider: string;
  external_txn_id: string;
  click_id: string | null;
  offer_public_id: string | null;
  event_ts: number | null;
  payload_redacted_json: string | null;
  debug_ref: string | null;
  received_at: number;
}

export interface LeadgenPostbackLogApi {
  id: number;
  provider: string;
  external_txn_id: string;
  click_id: string | null;
  offer_public_id: string | null;
  event_ts: number | null;
  payload_redacted_json: unknown;
  debug_ref: string | null;
  received_at: number;
}

// leadgen_revenue_raw — row shape is already API-stable.
export interface LeadgenRevenueRawRow {
  id: number;
  dt: string;
  click_id: string;
  offer_public_id: string | null;
  source: LeadgenRevenueSource;
  booking_trigger: LeadgenBookingTrigger;
  conversions: number;
  revenue: number;
  currency: string;
  received_at: number;
  synced_to_ch_at: number | null;
}

export type LeadgenRevenueRawApi = LeadgenRevenueRawRow;

// leadgen_revenue_unmatched — row shape is already API-stable.
export interface LeadgenRevenueUnmatchedRow {
  id: number;
  click_id: string;
  provider: string;
  external_txn_id: string | null;
  revenue: number;
  currency: string;
  revenue_usd: number | null;
  received_at: number;
  status: LeadgenUnmatchedRevenueStatus;
}

export type LeadgenRevenueUnmatchedApi = LeadgenRevenueUnmatchedRow;

// leadgen_event_dead_letter
export interface LeadgenEventDeadLetterRow {
  id: number;
  event_id: string;
  payload_json: string;
  reason: string;
  received_at: number;
}

export interface LeadgenEventDeadLetterApi {
  id: number;
  event_id: string;
  payload_json: unknown;
  reason: string;
  received_at: number;
}

// leadgen_fx_rates — PK (date, currency); row shape is already API-stable.
export interface LeadgenFxRateRow {
  date: string;
  currency: string;
  usd_rate: number;
}

export type LeadgenFxRateApi = LeadgenFxRateRow;

// ---------------------------------------------------------------------------
// §7.7 Conversion dedupe (0039)
// ---------------------------------------------------------------------------

// leadgen_conversion_log — UNIQUE (click_id, dedupe_key). `source` has no
// CHECK constraint in the DDL (DEFAULT 'in_site'), so it stays a plain string.
// Row shape is already API-stable.
export interface LeadgenConversionLogRow {
  id: number;
  click_id: string;
  dedupe_key: string;
  offer_public_id: string | null;
  source: string;
  revenue: number;
  currency: string;
  booked_at: number;
}

export type LeadgenConversionLogApi = LeadgenConversionLogRow;
