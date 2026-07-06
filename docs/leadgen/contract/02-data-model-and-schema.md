# LeadGen CMS — Contract 02 · Data Model & D1 Schema (v2.3.7 · FINAL)

**Status: READY TO BUILD — ready to build.** Covers **§6 Data model** and **§7 D1 schema**. DDL is normative and reproduced verbatim in `migrations/`. SQL contains **no banned product name**; the lineage is *reference funnel* / *default funnel*.

---

## 6. Data model

### 6.1 Entity overview
| Entity | Table | Scope | `public_id` |
|---|---|---|---|
| Offer | `leadgen_offers` | Global | `lgo_` |
| Offer placement (≥1 per Offer; exactly one default) | `leadgen_offer_placements` | Global | `lgpl_` |
| Offer payload schema (versioned; carries parser version) | `leadgen_offer_payload_schemas` | Global | `lgp_` |
| Offer header | `leadgen_offer_headers` | Global | — |
| Offer **region** rule (region-block only) | `leadgen_offer_region_rules` | Global | `lgrr_` |
| Offer cap counter | `leadgen_offer_cap_counters` | Global | — |
| Section | `leadgen_sections` | Global | `lgs_` |
| Section available/selected Offers (+ mapping state) | `leadgen_section_available_offers` | Global | — |
| Section answer map | `leadgen_section_answer_maps` | Global | `lgm_` |
| Quote | `leadgen_quotes` | Global | `lgq_` |
| **Funnel (stable)** | **`leadgen_funnels`** | Global | **`lgf_` = `funnel_id`** |
| Funnel A/B test | `leadgen_funnel_ab_tests` | Global | `lgx_` |
| Funnel **variant** (A/B unit) | `leadgen_funnel_variants` | Global | `lgn_` = `funnel_variant_id` |
| Variant section order | `leadgen_funnel_variant_sections` | Global | — |
| Funnel rule | `leadgen_funnel_rules` | Global | `lgfr_` |
| Site activation | `leadgen_site_quotes` | Per-site | — |
| Auction config | `leadgen_auctions` | Global | `lga_` |
| Auction participating placement | `leadgen_auction_offers` | Global | — |
| Auction rule (offer-level **incl. answer-based** + carrier-level) | `leadgen_auction_rules` | Global | `lgar_` |
| Auction banner config | `leadgen_auction_banners` | Global | — |
| Auction result / explainability (bounded) | `leadgen_auction_result_log` | Runtime | — |
| Clicked-offer suppression (per funnel attempt) | `leadgen_session_clicked_offers` | Runtime | — |
| Provider request log (redacted + debug_ref) | `leadgen_provider_request_log` | Runtime | — |
| Analytics mirrors (read-only) — **exactly 9** | `leadgen_analytics_*` | Global | — |
| Revenue infra | `leadgen_media_platforms`, `_postback_log`, `_revenue_raw`, `_revenue_unmatched`, `_conversion_log`, `_fx_rates`, `_event_dead_letter` | Global | — |
| debug_ref access audit | `leadgen_debug_access_log` | Runtime | — |

### 6.2 Hierarchy: Quote → Funnel → Funnel Variant (issue 3)
- **Quote** (`quote_id`=`lgq_`) — the named offering.
- **Funnel** (`leadgen_funnels`, **`funnel_id`=`lgf_`, STABLE**) — a distinct flow of a Quote. **`funnel_id` is NOT `funnel_variant_id`.** Analytics group by the stable `funnel_id` and drill into `funnel_variant_id`.
- **Funnel variant** (`leadgen_funnel_variants`, `funnel_variant_id`=`lgn_`) — one A/B'd version of a Funnel; the immutable-while-running unit.
`funnel_name` lives on `leadgen_funnels` (stable). Every runtime event/auction request/analytics row carries **both** `funnel_id` (stable) and `funnel_variant_id`.

### 6.3 ID glossary
`quote_id`(`lgq_`) · **`funnel_id`(`lgf_`, stable)** · `funnel_variant_id`(`lgn_`) · `auction_config_id`(`lga_`) · `auction_instance_id`(one run) · `auction_request_id`(one provider wave) · `provider_request_id`(one call) · `auction_result_id`(1:1 instance) · `banner_render_id`(one rendered set) · `funnel_attempt_id`(one user pass) · `click_id`(`lgl_`). **`auctions` metric = `countDistinct(auction_instance_id)`.**

### 6.4 Impression semantics (issue 11)
- **`carrier_impression`** — a specific carrier/banner slot was shown (exact slot). Keyed per `banner_render_id` + `carrier_key`.
- **`offer_impression`** — **at least one** visible carrier/banner from an Offer was shown in an auction, **deduped by `(auction_instance_id, offer_id)`** (one per Offer per auction run, regardless of how many of its carriers rendered).
`leadgen_analytics_offer.impressions` = `offer_impression`; `leadgen_analytics_carrier.impressions` = `carrier_impression`.

### 6.5 Invariants
Global assets not per-site; one enabled root activation (NULL slug) per site. Running variants immutable (edit → fork). Auction runs after the **last section by position** (no "final" flag). Ratios computed at read (NULLIF). Money deduped. A/B allocation = basis points, Σ=10000 (UI %). Every Offer has exactly one **default placement** row (seeded on Offer create); auctions join a **concrete** placement.

---

## 7. D1 schema (v2.3 FINAL — additive `0036`–`0039`)

### 7.1 `0036` — Offers
```sql
CREATE TABLE IF NOT EXISTS leadgen_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,                  -- {offer_id} ("lgo_…")
  offer_name TEXT NOT NULL, provider TEXT,
  activity TEXT NOT NULL, vertical TEXT NOT NULL, tag TEXT,
  conversion_tracking_method TEXT NOT NULL CHECK (conversion_tracking_method IN ('s2s_postback','browser_side_pixel','script')),
  offer_type TEXT NOT NULL CHECK (offer_type IN ('cpc','cpl','cpa','cpi')),
  -- operator picks ONE mode (see 04 §10.2); it maps to the two flags below:
  --   static_no_request        -> calls_provider_api=0, bid_source=static
  --   request_static_bid       -> calls_provider_api=1, bid_source=static  (CPL: response gives URL only)
  --   request_dynamic_bid      -> calls_provider_api=1, bid_source=response (CPC)
  calls_provider_api INTEGER NOT NULL DEFAULT 0,
  bid_source TEXT NOT NULL DEFAULT 'static' CHECK (bid_source IN ('response','static')),
  request_execution_mode TEXT NOT NULL DEFAULT 'server' CHECK (request_execution_mode IN ('server','client')),
  static_bid_value REAL, static_bid_currency TEXT, static_order INTEGER,
  banner_url_template TEXT, static_fallback_banner_url TEXT,
  request_method TEXT CHECK (request_method IN ('POST','GET','PUT')),
  endpoint_production TEXT, endpoint_staging TEXT,
  api_token_secret_ref TEXT, api_token_placement TEXT CHECK (api_token_placement IN ('header','payload','query')), api_token_param_name TEXT,
  active_payload_schema_id INTEGER REFERENCES leadgen_offer_payload_schemas(id),
  cap_enabled INTEGER NOT NULL DEFAULT 0, cap_amount INTEGER, cap_timezone TEXT,
  cap_count_by TEXT CHECK (cap_count_by IN ('clicks','conversions')),
  cap_fallback_offer_id INTEGER REFERENCES leadgen_offers(id), cap_fallback_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  created_by TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_leadgen_offers_vertical ON leadgen_offers(vertical, activity);

-- One Offer -> N placements; exactly one default (seeded on Offer create). Auctions join a concrete placement.
CREATE TABLE IF NOT EXISTS leadgen_offer_placements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,                   -- "lgpl_…"
  offer_id INTEGER NOT NULL REFERENCES leadgen_offers(id) ON DELETE CASCADE,
  placement_id TEXT NOT NULL, label TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (offer_id, placement_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_leadgen_offerplacement_default ON leadgen_offer_placements(offer_id) WHERE is_default = 1;

CREATE TABLE IF NOT EXISTS leadgen_offer_payload_schemas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,                   -- "lgp_…" == payload_schema_version
  offer_id INTEGER NOT NULL REFERENCES leadgen_offers(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  schema_json TEXT NOT NULL, sample_response_json TEXT,
  carrier_parse_json TEXT,                           -- normalize response -> common Carrier fields (§19)
  carrier_parse_version INTEGER NOT NULL DEFAULT 1,  -- response_parser_version (issue 21); stamped on events
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto_from_example')),
  created_by TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (offer_id, version)
);

CREATE TABLE IF NOT EXISTS leadgen_offer_headers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id INTEGER NOT NULL REFERENCES leadgen_offers(id) ON DELETE CASCADE,
  header_name TEXT NOT NULL,
  value_kind TEXT NOT NULL CHECK (value_kind IN ('static','macro','secret_ref')),
  value_text TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- OFFER RULES = PROVIDER REGION-BLOCK ONLY (issue 5). Answer-based participation is in leadgen_auction_rules.
CREATE TABLE IF NOT EXISTS leadgen_offer_region_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,                   -- "lgrr_…"
  offer_id INTEGER NOT NULL REFERENCES leadgen_offers(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL CHECK (dimension IN ('country','state','city','zip')),
  action TEXT NOT NULL CHECK (action IN ('include_only','exclude','allow_list','block_list')),
  values_json TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 100, enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_leadgen_offerregion_offer ON leadgen_offer_region_rules(offer_id, priority);

CREATE TABLE IF NOT EXISTS leadgen_offer_cap_counters (
  offer_id INTEGER NOT NULL REFERENCES leadgen_offers(id) ON DELETE CASCADE,
  cap_date TEXT NOT NULL, timezone TEXT NOT NULL,
  click_count INTEGER NOT NULL DEFAULT 0, conversion_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (offer_id, cap_date)
);
```

### 7.2 `0036` — Sections
```sql
CREATE TABLE IF NOT EXISTS leadgen_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,                   -- "lgs_…"
  section_name TEXT NOT NULL, activity TEXT NOT NULL, vertical TEXT NOT NULL,
  headline_text TEXT NOT NULL, subheadline_text TEXT, image_json TEXT,
  content_json TEXT NOT NULL, content_html TEXT,
  continue_mode TEXT NOT NULL DEFAULT 'button' CHECK (continue_mode IN ('button','auto_advance')),
  design_overrides_json TEXT, address_validation_enabled INTEGER NOT NULL DEFAULT 0,
  section_mapping_version INTEGER NOT NULL DEFAULT 1, content_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_leadgen_sections_vertical ON leadgen_sections(vertical, activity);

CREATE TABLE IF NOT EXISTS leadgen_section_available_offers (
  section_id INTEGER NOT NULL REFERENCES leadgen_sections(id) ON DELETE CASCADE,
  offer_id INTEGER NOT NULL REFERENCES leadgen_offers(id),
  selected INTEGER NOT NULL DEFAULT 0,
  mapping_state TEXT NOT NULL DEFAULT 'incomplete' CHECK (mapping_state IN ('selected','incomplete','complete','invalid')),
  required_fields_total INTEGER NOT NULL DEFAULT 0, required_fields_mapped INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (section_id, offer_id)
);

CREATE TABLE IF NOT EXISTS leadgen_section_answer_maps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,                   -- "lgm_…" == answer_mapping_version key component
  section_id INTEGER NOT NULL REFERENCES leadgen_sections(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL, question_key TEXT NOT NULL, internal_field TEXT NOT NULL, answer_type TEXT NOT NULL,
  offer_id INTEGER NOT NULL REFERENCES leadgen_offers(id),
  payload_schema_id INTEGER NOT NULL REFERENCES leadgen_offer_payload_schemas(id),
  payload_schema_public_id TEXT NOT NULL, offer_payload_field_path TEXT NOT NULL, provider_expected_type TEXT NOT NULL,
  output_value_map_json TEXT, transform_json TEXT, required_for_offer INTEGER NOT NULL DEFAULT 0,
  default_value TEXT, fallback_value TEXT,
  mapping_status TEXT NOT NULL DEFAULT 'incomplete' CHECK (mapping_status IN ('complete','incomplete','type_mismatch','orphaned')),
  validation_status TEXT NOT NULL DEFAULT 'error' CHECK (validation_status IN ('ok','error')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_leadgen_ansmap_section ON leadgen_section_answer_maps(section_id);
```

### 7.3 `0036` — Quotes / Funnels / Variants / Activation
```sql
CREATE TABLE IF NOT EXISTS leadgen_quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,                   -- "lgq_…" == quote_id
  quote_name TEXT NOT NULL, activity TEXT NOT NULL, verticals_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  created_by TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- STABLE FUNNEL entity (issue 3). funnel_id = public_id. Analytics group by this.
CREATE TABLE IF NOT EXISTS leadgen_funnels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,                   -- "lgf_…" == funnel_id (STABLE)
  quote_id INTEGER NOT NULL REFERENCES leadgen_quotes(id) ON DELETE CASCADE,
  funnel_name TEXT NOT NULL,
  active_ab_test_id INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_leadgen_funnels_quote ON leadgen_funnels(quote_id, status);

CREATE TABLE IF NOT EXISTS leadgen_funnel_ab_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,                   -- "lgx_…" == funnel_ab_test_id
  funnel_id INTEGER NOT NULL REFERENCES leadgen_funnels(id) ON DELETE CASCADE,
  name TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','stopped')),
  started_at INTEGER, stopped_at INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_leadgen_abtest_running ON leadgen_funnel_ab_tests(funnel_id) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS leadgen_funnel_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,                   -- "lgn_…" == funnel_variant_id
  funnel_id INTEGER NOT NULL REFERENCES leadgen_funnels(id) ON DELETE CASCADE,   -- stable parent (issue 3)
  ab_test_id INTEGER REFERENCES leadgen_funnel_ab_tests(id) ON DELETE SET NULL,
  variant_label TEXT NOT NULL DEFAULT 'A', is_control INTEGER NOT NULL DEFAULT 1,
  traffic_allocation_bp INTEGER NOT NULL DEFAULT 10000,   -- per-test Σ == 10000; UI shows %
  funnel_design_id TEXT NOT NULL DEFAULT 'default',
  auction_id INTEGER REFERENCES leadgen_auctions(id),
  lander_enabled INTEGER NOT NULL DEFAULT 0, lander_headline TEXT, lander_subheadline TEXT, lander_body_json TEXT,
  lander_hero_media_id INTEGER REFERENCES media(id), lander_hero_media_url TEXT, lander_cta_json TEXT,
  content_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_leadgen_variants_funnel ON leadgen_funnel_variants(funnel_id, status);

CREATE TABLE IF NOT EXISTS leadgen_funnel_variant_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id INTEGER NOT NULL REFERENCES leadgen_funnel_variants(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL REFERENCES leadgen_sections(id),
  position INTEGER NOT NULL,                          -- auction runs after the MAX position (issue 10)
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (variant_id, position)
);

CREATE TABLE IF NOT EXISTS leadgen_funnel_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,                   -- "lgfr_…"
  variant_id INTEGER NOT NULL REFERENCES leadgen_funnel_variants(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('redirect_direct_offer','skip_section','show_section','eligibility','disqualification','auction_entry')),
  conditions_json TEXT NOT NULL, conditions_hash TEXT NOT NULL,
  target_offer_id INTEGER REFERENCES leadgen_offers(id),          -- normal redirect target (issue 11)
  target_section_id INTEGER REFERENCES leadgen_sections(id),
  redirect_url TEXT, redirect_url_allowlisted INTEGER NOT NULL DEFAULT 0,   -- raw URL only when allowlisted
  priority INTEGER NOT NULL DEFAULT 100, enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS leadgen_site_quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL, quote_id INTEGER NOT NULL REFERENCES leadgen_quotes(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0, slug TEXT, settings_overrides_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (site_id, quote_id), UNIQUE (site_id, slug)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_leadgen_sitequote_root ON leadgen_site_quotes(site_id) WHERE slug IS NULL AND enabled = 1;
```

### 7.4 `0036` — Auction
```sql
CREATE TABLE IF NOT EXISTS leadgen_auctions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,                   -- "lga_…" == auction_config_id
  auction_name TEXT NOT NULL,
  quote_id INTEGER REFERENCES leadgen_quotes(id),                        -- required attribution
  funnel_id INTEGER REFERENCES leadgen_funnels(id),                      -- OPTIONAL stable funnel (issue 4)
  funnel_variant_id INTEGER REFERENCES leadgen_funnel_variants(id),      -- OPTIONAL variant
  auction_type TEXT NOT NULL CHECK (auction_type IN ('static','dynamic')),
  banner_design_id TEXT NOT NULL DEFAULT 'default',
  winner_logic TEXT NOT NULL DEFAULT 'highest_bid' CHECK (winner_logic IN ('highest_bid','average_bid','sum_bids')),
  floor_type TEXT NOT NULL DEFAULT 'percentage_of_max' CHECK (floor_type IN ('percentage_of_max','absolute_bid')),
  floor_value REAL NOT NULL DEFAULT 10,
  -- issue 20: in a MIXED cpc/cpl/cpa/cpi auction, percentage_of_max compares USD-normalized bids of
  -- DIFFERENT payout types; the admin UI warns and recommends absolute_bid (or per-type floors) for mixed sets.
  mixed_payout_warn INTEGER NOT NULL DEFAULT 1,
  multi_offer TEXT NOT NULL DEFAULT 'disabled' CHECK (multi_offer IN ('disabled','enabled','enabled_unique')),
  surface_static_bid_offers INTEGER NOT NULL DEFAULT 1,
  banner_slots_count INTEGER NOT NULL DEFAULT 5, max_carriers_per_offer INTEGER NOT NULL DEFAULT 3, max_total_carriers INTEGER NOT NULL DEFAULT 10,
  render_mode TEXT NOT NULL DEFAULT 'all_at_once' CHECK (render_mode IN ('all_at_once','progressive')),
  backfill TEXT NOT NULL DEFAULT 'disabled' CHECK (backfill IN ('disabled','enabled','enabled_unique')),
  backfill_source_offer_id INTEGER REFERENCES leadgen_offers(id),
  backfill_trigger TEXT NOT NULL DEFAULT 'on_slot_exhaustion' CHECK (backfill_trigger IN ('on_slot_exhaustion','on_click','on_dismiss')),
  remove_clicked_offers INTEGER NOT NULL DEFAULT 0,
  removal_scope TEXT NOT NULL DEFAULT 'offer' CHECK (removal_scope IN ('offer','carrier')),
  timeout_ms INTEGER NOT NULL DEFAULT 2500, carrier_normalization_version INTEGER NOT NULL DEFAULT 1,
  banner_config_json TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  created_by TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Participating placements. offer_placement_id is CONCRETE + NOT NULL (issue 18); PK uses it.
CREATE TABLE IF NOT EXISTS leadgen_auction_offers (
  auction_id INTEGER NOT NULL REFERENCES leadgen_auctions(id) ON DELETE CASCADE,
  offer_placement_id INTEGER NOT NULL REFERENCES leadgen_offer_placements(id),
  offer_id INTEGER NOT NULL REFERENCES leadgen_offers(id),   -- denormalized for query; derivable from placement
  static_order INTEGER, static_bid_override REAL, enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (auction_id, offer_placement_id)
);
CREATE INDEX IF NOT EXISTS idx_leadgen_auctionoffers_offer ON leadgen_auction_offers(offer_id);

CREATE TABLE IF NOT EXISTS leadgen_auction_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,                   -- "lgar_…"
  auction_id INTEGER NOT NULL REFERENCES leadgen_auctions(id) ON DELETE CASCADE,
  rule_level TEXT NOT NULL CHECK (rule_level IN ('offer','carrier')),
  target_offer_id INTEGER REFERENCES leadgen_offers(id),
  action TEXT NOT NULL CHECK (action IN ('include_only','exclude','allow_list','block_list')),
  conditions_json TEXT NOT NULL, conditions_hash TEXT NOT NULL,   -- answer-based Offer participation lives here (issue 5)
  carrier_match_json TEXT, strictly_override INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 100, enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_leadgen_auctionrules_auction ON leadgen_auction_rules(auction_id, rule_level, priority);

CREATE TABLE IF NOT EXISTS leadgen_auction_banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_id INTEGER NOT NULL REFERENCES leadgen_auctions(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'automatic' CHECK (mode IN ('manual','automatic')),
  field_map_json TEXT NOT NULL,   -- MODEL A: maps ONLY canonical Carrier fields (each Offer parser normalizes to Carrier first); one map per auction
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (auction_id)
);

-- Explainability / recent auction result (issue 12; bounded, pruned 7d).
CREATE TABLE IF NOT EXISTS leadgen_auction_result_log (
  auction_instance_id TEXT PRIMARY KEY,
  auction_result_id TEXT NOT NULL, auction_config_id TEXT NOT NULL,
  session_id TEXT, funnel_attempt_id TEXT, funnel_id TEXT, funnel_variant_id TEXT,
  banner_render_ids_json TEXT,               -- [banner_render_id,...]
  offers_considered_json TEXT,               -- [{offer_id, placement_id}]
  offers_excluded_json TEXT,                 -- [{offer_id, reason}]  (rule/cap/region/timeout/no_bid/below_floor)
  carriers_shown_json TEXT,                  -- [{carrier_key, offer_id, bid, slot}]
  winner_json TEXT,                          -- {offer_id, logic, score}
  unfilled_reason TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_leadgen_auctionresult_created ON leadgen_auction_result_log(created_at);

-- Remove-clicked suppression scoped to the FUNNEL ATTEMPT (issue 19): a clicked Offer stays
-- suppressed for the rest of that user's pass (across backfill + re-auctions), not just one instance.
CREATE TABLE IF NOT EXISTS leadgen_session_clicked_offers (
  funnel_attempt_id TEXT NOT NULL,
  offer_id INTEGER NOT NULL, carrier_key TEXT NOT NULL DEFAULT '',   -- '' when removal_scope='offer'
  session_id TEXT, auction_id INTEGER, removal_scope TEXT NOT NULL DEFAULT 'offer' CHECK (removal_scope IN ('offer','carrier')),
  clicked_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (funnel_attempt_id, offer_id, carrier_key)
);
CREATE INDEX IF NOT EXISTS idx_leadgen_clicked_attempt ON leadgen_session_clicked_offers(funnel_attempt_id, clicked_at);

-- Provider request log: redacted admin JSON + encrypted debug_ref (issue 16/25).
CREATE TABLE IF NOT EXISTS leadgen_provider_request_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_instance_id TEXT, auction_request_id TEXT, provider_request_id TEXT,
  offer_public_id TEXT NOT NULL, placement_public_id TEXT,
  carrier_parse_version INTEGER,             -- response_parser_version used (issue 21)
  environment TEXT NOT NULL CHECK (environment IN ('staging','production')),
  status_code INTEGER, latency_ms INTEGER,
  request_headers_redacted_json TEXT, request_payload_redacted_json TEXT, response_redacted_json TEXT, parsed_carriers_json TEXT,
  debug_ref TEXT, provider_error_reason TEXT, error_text TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_leadgen_provlog_instance ON leadgen_provider_request_log(auction_instance_id);

-- debug_ref access audit (issue 16).
CREATE TABLE IF NOT EXISTS leadgen_debug_access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  debug_ref TEXT NOT NULL, accessed_by TEXT NOT NULL, environment TEXT, accessed_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_leadgen_debugaccess_ref ON leadgen_debug_access_log(debug_ref);
```
> **Retention:** `leadgen_provider_request_log` redacted rows 7d; encrypted `debug_ref` blobs 72h; `leadgen_auction_result_log` 7d; `leadgen_session_clicked_offers` at funnel-attempt end / 24h. A bounded cron prunes; `debug_ref` reads insert a `leadgen_debug_access_log` row.

### 7.5 `0037` — analytics mirrors (exactly 9; issue 10)
`leadgen_analytics_offer`, `leadgen_analytics_section`, `leadgen_analytics_answer_distribution`, `leadgen_analytics_quote`, `leadgen_analytics_quote_drilldown`, `leadgen_analytics_auction`, `leadgen_analytics_auction_drilldown`, `leadgen_analytics_carrier`, `leadgen_analytics_provider_diagnostics`.
```sql
CREATE TABLE IF NOT EXISTS leadgen_analytics_offer (
  offer_public_id TEXT NOT NULL, date TEXT NOT NULL,
  offer_impressions INTEGER NOT NULL DEFAULT 0,   -- deduped (auction_instance_id, offer_id) (§6.4)
  clicks INTEGER NOT NULL DEFAULT 0, unique_clicks INTEGER NOT NULL DEFAULT 0, conversions INTEGER NOT NULL DEFAULT 0,
  revenue REAL NOT NULL DEFAULT 0, synced_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (offer_public_id, date)
);
CREATE TABLE IF NOT EXISTS leadgen_analytics_section (
  section_public_id TEXT NOT NULL, date TEXT NOT NULL,
  views INTEGER, clicks INTEGER, continued INTEGER, validation_errors INTEGER,
  default_applied INTEGER, user_confirmed_default INTEGER, user_selected INTEGER,
  time_on_section_ms_sum INTEGER, dropoffs INTEGER, synced_at INTEGER,
  PRIMARY KEY (section_public_id, date)
);
CREATE TABLE IF NOT EXISTS leadgen_analytics_answer_distribution (
  section_public_id TEXT NOT NULL, question_key TEXT NOT NULL, answer_value_normalized TEXT NOT NULL,
  answer_source TEXT NOT NULL DEFAULT 'user_selected' CHECK (answer_source IN ('default_applied','user_selected','user_confirmed_default')),
  date TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, continued_count INTEGER NOT NULL DEFAULT 0, synced_at INTEGER,
  PRIMARY KEY (section_public_id, question_key, answer_value_normalized, answer_source, date)
);
CREATE TABLE IF NOT EXISTS leadgen_analytics_quote (
  quote_public_id TEXT NOT NULL, funnel_id TEXT NOT NULL DEFAULT '', funnel_name TEXT DEFAULT '',
  funnel_variant_id TEXT DEFAULT '', funnel_ab_test_id TEXT DEFAULT '', variant_label TEXT DEFAULT '',
  site_id TEXT DEFAULT '', traffic_source TEXT DEFAULT '', date TEXT NOT NULL,
  visits INTEGER, unique_visits INTEGER, bounces INTEGER, completions INTEGER,
  clicks INTEGER, conversions INTEGER, unfilled INTEGER, revenue REAL, synced_at INTEGER,
  PRIMARY KEY (quote_public_id, funnel_id, funnel_variant_id, site_id, traffic_source, date)
);
CREATE TABLE IF NOT EXISTS leadgen_analytics_quote_drilldown (
  quote_public_id TEXT NOT NULL, funnel_id TEXT NOT NULL DEFAULT '', funnel_variant_id TEXT DEFAULT '',
  site_id TEXT DEFAULT '', traffic_source TEXT DEFAULT '', device TEXT DEFAULT '', state TEXT DEFAULT '',
  section_public_id TEXT DEFAULT '', section_index INTEGER, question_key TEXT DEFAULT '', answer_value_normalized TEXT DEFAULT '',
  date TEXT NOT NULL, views INTEGER, continued INTEGER, clicks INTEGER, conversions INTEGER, revenue REAL, synced_at INTEGER,
  PRIMARY KEY (quote_public_id, funnel_id, funnel_variant_id, site_id, traffic_source, device, state, section_public_id, question_key, answer_value_normalized, date)
);
CREATE TABLE IF NOT EXISTS leadgen_analytics_auction (
  auction_public_id TEXT NOT NULL, date TEXT NOT NULL,
  auctions INTEGER, filled_auctions INTEGER, unfilled_auctions INTEGER,   -- auctions = countDistinct(auction_instance_id)
  offer_impressions INTEGER, carrier_impressions INTEGER, carrier_clicks INTEGER,
  bid_value_sum REAL, eligible_bid_count INTEGER,
  timeouts INTEGER, below_floor INTEGER, malformed INTEGER, no_bid INTEGER, provider_errors INTEGER,
  latency_ms_sum INTEGER, revenue REAL, synced_at INTEGER,
  PRIMARY KEY (auction_public_id, date)
);
CREATE TABLE IF NOT EXISTS leadgen_analytics_auction_drilldown (
  auction_public_id TEXT NOT NULL, offer_public_id TEXT DEFAULT '', carrier_key TEXT DEFAULT '',
  device TEXT DEFAULT '', state TEXT DEFAULT '', date TEXT NOT NULL,
  offer_impressions INTEGER, carrier_impressions INTEGER, clicks INTEGER, conversions INTEGER, bid_value_sum REAL, revenue REAL,
  carrier_filtered_reason TEXT DEFAULT '', provider_error_reason TEXT DEFAULT '', auction_unfilled_reason TEXT DEFAULT '', synced_at INTEGER,
  PRIMARY KEY (auction_public_id, offer_public_id, carrier_key, device, state, carrier_filtered_reason, provider_error_reason, auction_unfilled_reason, date)
);
CREATE TABLE IF NOT EXISTS leadgen_analytics_carrier (
  auction_public_id TEXT NOT NULL, offer_public_id TEXT NOT NULL, carrier_key TEXT NOT NULL, carrier_name TEXT DEFAULT '', date TEXT NOT NULL,
  carrier_impressions INTEGER, clicks INTEGER, unique_clicks INTEGER, conversions INTEGER, bid_value_sum REAL, revenue REAL, synced_at INTEGER,
  PRIMARY KEY (auction_public_id, offer_public_id, carrier_key, date)
);
CREATE TABLE IF NOT EXISTS leadgen_analytics_provider_diagnostics (
  offer_public_id TEXT NOT NULL, auction_public_id TEXT DEFAULT '', date TEXT NOT NULL,
  requests INTEGER, responses INTEGER, timeouts INTEGER, errors INTEGER, no_bid INTEGER, below_floor INTEGER,
  latency_ms_sum INTEGER, provider_error_reason TEXT DEFAULT '', synced_at INTEGER,
  PRIMARY KEY (offer_public_id, auction_public_id, provider_error_reason, date)
);
```

### 7.6 `0038` — revenue infra
```sql
CREATE TABLE IF NOT EXISTS leadgen_media_platforms (
  id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 0,
  postback_url_template TEXT NOT NULL, auth_secret_ref TEXT, event_name TEXT DEFAULT 'Purchase',
  value_multiplier REAL NOT NULL DEFAULT 1, created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS leadgen_postback_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, external_txn_id TEXT NOT NULL,
  click_id TEXT, offer_public_id TEXT, event_ts INTEGER, payload_redacted_json TEXT, debug_ref TEXT,
  received_at INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE (provider, external_txn_id)
);
CREATE INDEX IF NOT EXISTS idx_leadgen_pblog_click ON leadgen_postback_log(click_id);
CREATE TABLE IF NOT EXISTS leadgen_revenue_raw (
  id INTEGER PRIMARY KEY AUTOINCREMENT, dt TEXT NOT NULL, click_id TEXT NOT NULL, offer_public_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('s2s_postback','api','script','in_site')),
  booking_trigger TEXT NOT NULL DEFAULT 'conversion' CHECK (booking_trigger IN ('click','conversion')),
  conversions INTEGER NOT NULL DEFAULT 0, revenue REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
  received_at INTEGER NOT NULL DEFAULT (unixepoch()), synced_to_ch_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_leadgen_revraw_unsynced ON leadgen_revenue_raw(synced_to_ch_at) WHERE synced_to_ch_at IS NULL;
CREATE TABLE IF NOT EXISTS leadgen_revenue_unmatched (
  id INTEGER PRIMARY KEY AUTOINCREMENT, click_id TEXT NOT NULL, provider TEXT NOT NULL, external_txn_id TEXT,
  revenue REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD', revenue_usd REAL,
  received_at INTEGER NOT NULL DEFAULT (unixepoch()),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','matched','unattributed'))
);
CREATE TABLE IF NOT EXISTS leadgen_event_dead_letter (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL, payload_json TEXT NOT NULL, reason TEXT NOT NULL,
  received_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS leadgen_fx_rates (date TEXT NOT NULL, currency TEXT NOT NULL, usd_rate REAL NOT NULL, PRIMARY KEY (date, currency));
```

### 7.7 `0039` — conversion dedupe
```sql
CREATE TABLE IF NOT EXISTS leadgen_conversion_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, click_id TEXT NOT NULL, dedupe_key TEXT NOT NULL,
  offer_public_id TEXT, source TEXT NOT NULL DEFAULT 'in_site', revenue REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
  booked_at INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE (click_id, dedupe_key)
);
```

### 7.8 Seed + manifest
Seed 5 disabled `leadgen_media_platforms`. On Offer create, seed one `leadgen_offer_placements` row with `is_default=1`. Manifest: `0036` core (offers+placements+schemas+headers+region-rules+cap-counters+sections+available-offers+answer-maps+quotes+funnels+ab-tests+variants+variant-sections+funnel-rules+site-quotes+auctions+auction-offers+auction-rules+auction-banners+result-log+clicked-offers+provider-log+debug-access); `0037` 9 mirrors; `0038` revenue; `0039` dedupe. Additive, forward-only.
