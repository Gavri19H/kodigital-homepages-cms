// LeadGen admin UI — Offers tab (contract 03 §9.2 / 04 §10–§11, Phase-4
// Stage B2). The Offers tab goes LIVE: list + filters + timeframe +
// after-paint analytics hydration, the §10.1 Create-Offer modal
// (draft-then-configure), and the full-page editor at
// /admin/leadgen/offers/:id/edit with the conductor-ruled tab UNION of
// 03 §9.2 and 04 §10.1:
//
//   Basics                    always
//   Static                    bid_source='static' OR calls_provider_api=0
//   Payload / Request / Test  calls_provider_api=1  (ui-payload-builder.ts)
//   Region rules / Cap / Analytics   always
//
// §10.2 three-kind mode picker → the two DDL flags (0036 lines 13–16):
//   static_no_request   → calls_provider_api=0, bid_source='static'
//   request_static_bid  → calls_provider_api=1, bid_source='static'
//   request_dynamic_bid → calls_provider_api=1, bid_source='response'
//
// Structure mirrors admin/listicles/ui-offers.ts (the 03 §9.1 mandate):
// toolbar with Create top-left + filter selects + timeframe, table with
// status pills + per-cell analytics skeletons hydrated after paint
// (ratios NULL from the API render as em-dashes — §9.1 NULLIF guard),
// row actions, renderListPager, modal with inline field errors + top
// summary, dirty guards. SSR drives the JSON API in-process via ui.ts's
// apiJson. Inline scripts are strict ES5 (layout.ts constraint — the
// listicles pages hold it too, asserted by listicles-ui-es5.test.ts).

import {
  escapeHtml,
  renderListPager,
  listFilterScript,
  renderKebabOpen,
  KEBAB_CLOSE,
  kebabMenuScript,
} from "../templates/layout";
import {
  resolveTimeframe,
  renderTimeframeSelect,
  type Timeframe,
} from "../listicles/ui-shared";
import {
  LEADGEN_CAP_COUNT_BY,
  LEADGEN_OFFER_TYPES,
  LEADGEN_REGION_DIMENSIONS,
  LEADGEN_RULE_ACTIONS,
  LEADGEN_TRACKING_METHODS,
} from "../../leadgen/validation";
import { inferSchemaFromExample } from "../../leadgen/payload";
import {
  REGION_RULE_ACTION_LABELS,
  REGION_RULE_BEHAVIORS,
  REGION_RULE_PRIORITY_HELP,
  REGION_RULE_PRIORITY_LABEL,
  REGION_RULES_SECTION_HELP,
} from "../../leadgen/rules";
import type {
  LeadgenOfferApi,
  LeadgenOfferHeaderApi,
  LeadgenOfferPlacementApi,
  LeadgenOfferRegionRuleApi,
} from "./db-types";
import type { Paging } from "./router";
import {
  apiJson,
  branding,
  pageParam,
  renderLeadgenTabs,
  statusBadge,
  leadgenPageShell,
  EMPTY_PAGING,
  EM_DASH,
  type UiContext,
  type ListBody,
} from "./ui";
import {
  renderPayloadPanel,
  renderRequestPanel,
  renderTestPanel,
  PAYLOAD_BUILDER_SCRIPT,
  PAYLOAD_BUILDER_STYLES,
  type PayloadBuilderSchemaInfo,
} from "./ui-payload-builder";

// ---------------------------------------------------------------------------
// Shapes returned by the B1 offers API (offers-handlers.ts)
// ---------------------------------------------------------------------------

// The additive 05 §5.1 per-offer eligibility verdict riding GET/list
// responses (fix-contract v2.4, R4). SERVER-computed via the shared
// evaluateDynamicOffersEligibility loader — the UI never re-derives rules.
export interface OfferEligibilityVerdict {
  eligible: boolean;
  reasons: string[];
}

// GET /offers list items carry the default placement for the §9.2 column
// + the additive eligibility verdict for the §5.1 badge column
// + the additive §7.1 test-status field. The test-status field is read
// DEFENSIVELY (either spelling; absent → "Untested") so this UI stays green
// whichever side of the server slice merges first.
type OfferListItem = LeadgenOfferApi & {
  default_placement_id: string | null;
  default_placement_public_id: string | null;
  eligibility?: OfferEligibilityVerdict | null;
  test_status?: string | null;
  last_test_status?: string | null;
  last_test_ok?: boolean | null;
};

// GET /offers/:id detail — the mapped row + its three editor collections
// + the additive eligibility verdict for the §5.1 editor banner.
type OfferDetail = LeadgenOfferApi & {
  placements: LeadgenOfferPlacementApi[];
  headers: LeadgenOfferHeaderApi[];
  region_rules: LeadgenOfferRegionRuleApi[];
  eligibility?: OfferEligibilityVerdict | null;
};

interface OfferAnalyticsBody {
  analytics: {
    from: string;
    to: string;
    offer_impressions: number;
    clicks: number;
    unique_clicks: number;
    conversions: number;
    revenue: number;
    ctr: number | null;
    cvr: number | null;
    rpc: number | null;
    rpm: number | null;
  };
}

interface OfferCapBody {
  cap: {
    cap_enabled: boolean;
    cap_amount: number | null;
    cap_count_by: string | null;
    cap_timezone: string | null;
    cap_date: string;
    timezone: string;
    click_count: number;
    conversion_count: number;
    exceeded: boolean;
  };
}

interface PayloadSchemasBody {
  items: Array<{
    id: number;
    public_id: string;
    version: number;
    schema_json: unknown;
    // §7.1: both are columns on the schema-version row (parsed by the API) —
    // the §11.6/§11.7 response-parser panel + pick-source chips read them.
    carrier_parse_json: unknown;
    sample_response_json: unknown;
    source: string;
  }>;
}

// ---------------------------------------------------------------------------
// UI label maps (values are the validation.ts wire literals)
// ---------------------------------------------------------------------------

const TRACKING_METHOD_LABELS: Readonly<Record<string, string>> = {
  s2s_postback: "S2S postback",
  browser_side_pixel: "Browser-side pixel",
  script: "Script",
};

const OFFER_TYPE_LABELS: Readonly<Record<string, string>> = {
  cpc: "CPC",
  cpl: "CPL",
  cpa: "CPA",
  cpi: "CPI",
};

const CAP_COUNT_BY_LABELS: Readonly<Record<string, string>> = {
  clicks: "Clicks",
  conversions: "Conversions",
};

// 05 §5.1 (R4): plain-operator-English labels for ALL 8 eligibility reason
// codes (leadgen/validation.ts LeadgenDynamicIneligibilityReason). Shared by
// the Offer editor banner + list badge here, the Quotes preflight panel
// (offer_ineligible block fields) and the Auctions participating-picker
// warning chips — operators never see raw codes.
export const LEADGEN_ELIGIBILITY_REASON_LABELS: Readonly<Record<string, string>> = {
  no_active_schema: "No active payload schema",
  schema_validation_errors: "Active payload schema has validation errors",
  test_untested: "Provider test has not been run yet",
  test_failed: "Last provider test failed",
  endpoint_missing: "No endpoint configured for the live (production) environment",
  invalid_headers: "A request header cannot resolve (empty name or missing macro/secret reference)",
  carrier_parse_missing: "Response parsing (carrier parse) is not configured",
  carrier_parse_invalid: "Response parsing (carrier parse) configuration is invalid",
};

export function eligibilityReasonLabel(code: string): string {
  return LEADGEN_ELIGIBILITY_REASON_LABELS[code] ?? `Blocked (${code.replace(/_/g, " ")})`;
}

// §7.4 usage report — the SAME server payload drives the §7.2 delete guard
// (409 offer_in_use) and the §7.1 Usage panel (one query set, two consumers).
// The island renders the server's `usage.kinds` ARRAY directly, in server
// order, using each entry's own count/items/warning_only and a humanized
// label derived from the kind string. There is deliberately NO client-side
// kind list: buildOfferUsageReport (offers-handlers.ts) is the single source
// of truth, so the drift class (phantom kinds, missing kinds, wrong blocking
// flags) is structurally impossible.

// §7.3 duplicate — the three copy toggles, in the modal + banner order. Labels
// double as the "Duplicated from …" banner rows (what was / wasn't copied).
const OFFER_COPY_DIMENSION_LABELS: Readonly<Record<string, string>> = {
  copy_region_rules: "Region rules",
  copy_endpoint_config: "Endpoint & request config",
  copy_cap_settings: "Cap settings (copied disabled)",
};

// §10.2 mode picker options — value → the two flags per the 0036 DDL comment.
const OFFER_MODES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "static_no_request", label: "Static — no provider request" },
  { value: "request_static_bid", label: "Provider request · static bid (CPL)" },
  { value: "request_dynamic_bid", label: "Provider request · dynamic bid (CPC)" },
];

function offerMode(o: Pick<LeadgenOfferApi, "calls_provider_api" | "bid_source">): string {
  if (!o.calls_provider_api) return "static_no_request";
  return o.bid_source === "response" ? "request_dynamic_bid" : "request_static_bid";
}

const OFFER_STATUS_VALUES: ReadonlyArray<string> = ["active", "paused", "archived"];

// Curated IANA timezone choices for the cap window (server accepts any
// resolvable IANA name, so this list is a UI convenience, not a contract).
const CAP_TIMEZONES: ReadonlyArray<string> = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Jerusalem",
];

const BID_CURRENCIES: ReadonlyArray<string> = ["USD", "EUR", "GBP", "ILS"];

function options(
  values: ReadonlyArray<string>,
  labels: Readonly<Record<string, string>> | null,
  selected: string,
  blankLabel: string | null,
): string {
  const blank =
    blankLabel !== null ? `<option value="">${escapeHtml(blankLabel)}</option>` : "";
  const opts = values
    .map((v) => {
      const sel = v === selected ? " selected" : "";
      const label = labels !== null && labels[v] !== undefined ? labels[v] : v;
      return `<option value="${escapeHtml(v)}"${sel}>${escapeHtml(label)}</option>`;
    })
    .join("");
  return blank + opts;
}

function fieldError(name: string): string {
  return `<span class="form-error" data-error-for="${name}" hidden></span>`;
}

function queryParam(c: UiContext, name: string): string {
  return c.req.query(name)?.trim() ?? "";
}

function sanitizeEnum(value: string, allowed: ReadonlyArray<string>): string {
  return allowed.includes(value) ? value : "";
}

function buildQuery(params: Record<string, string>): string {
  const parts: string[] = [];
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value !== undefined && value !== "") {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

// DISTINCT provider options for the offers toolbar (fixed-literal SQL, the
// listicles ui.ts idiom). Providers stay a local read — 03 §8.2's Shared
// block defines endpoints only for /verticals + /activities, which the
// toolbar consumes through apiJson (see renderOffersList).
async function distinctOfferProviders(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare(
      "SELECT DISTINCT provider AS v FROM leadgen_offers WHERE provider IS NOT NULL ORDER BY v ASC LIMIT 200",
    )
    .all<{ v: string }>();
  return (result.results ?? [])
    .map((r) => r.v)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
}

// ---------------------------------------------------------------------------
// List page (03 §9.2)
// ---------------------------------------------------------------------------

interface OffersPageFilters {
  search: string;
  provider: string;
  vertical: string;
  activity: string;
  status: string;
  offer_type: string;
  dynamic: string;
  range: string;
}

interface OffersFilterOptions {
  providers: ReadonlyArray<string>;
  verticals: ReadonlyArray<string>;
  activities: ReadonlyArray<string>;
}

interface OffersPageProps {
  offers: ReadonlyArray<OfferListItem>;
  paging: Paging;
  filters: OffersPageFilters;
  filterOptions: OffersFilterOptions;
  timeframe: Timeframe;
  loadError: string | null;
  autoOpenCreate: boolean;
}

// §9.2 analytics columns, in contract order. `metric` keys match the §10.7
// analytics endpoint fields the after-paint hydration reads.
const OFFER_ANALYTICS_COLUMNS: ReadonlyArray<{ metric: string; label: string }> = [
  { metric: "offer_impressions", label: "Impressions" },
  { metric: "clicks", label: "Clicks" },
  { metric: "ctr", label: "CTR" },
  { metric: "conversions", label: "Conversions" },
  { metric: "cvr", label: "CVR" },
  { metric: "revenue", label: "Revenue" },
  { metric: "rpc", label: "RPC" },
  { metric: "rpm", label: "RPM" },
];

// 8 descriptive + the §5.1 eligibility badge + the §7.1 test-status chip
// + 8 analytics + actions.
const OFFER_COLUMN_COUNT = 10 + OFFER_ANALYTICS_COLUMNS.length + 1;

// §9.2 toolbar: + Create an Offer FIRST (top-left, opens the modal), then
// search, then the 6 filters + the timeframe select (all reload via the
// layout's shared listFilterScript).
function renderOffersToolbar(props: OffersPageProps): string {
  const f = props.filters;
  const o = props.filterOptions;
  return `<div class="toolbar">
  <button type="button" class="btn btn-primary" data-open-offer-modal>+ Create an Offer</button>
  <div class="toolbar-search"><input type="search" name="search" class="form-input" placeholder="Search offers…" value="${escapeHtml(f.search)}" aria-label="Search offers" /></div>
  <div class="toolbar-filters">
    <select name="provider" class="form-select" aria-label="Provider filter">${options(o.providers, null, f.provider, "All providers")}</select>
    <select name="vertical" class="form-select" aria-label="Vertical filter">${options(o.verticals, null, f.vertical, "All verticals")}</select>
    <select name="activity" class="form-select" aria-label="Activity filter">${options(o.activities, null, f.activity, "All activities")}</select>
    <select name="status" class="form-select" aria-label="Status filter">${options(OFFER_STATUS_VALUES, null, f.status, "All statuses")}</select>
    <select name="offer_type" class="form-select" aria-label="Offer type filter">${options(LEADGEN_OFFER_TYPES, OFFER_TYPE_LABELS, f.offer_type, "All offer types")}</select>
    <select name="dynamic" class="form-select" aria-label="Dynamic or static filter"><option value="">Dynamic + static</option><option value="1"${f.dynamic === "1" ? " selected" : ""}>Dynamic</option><option value="0"${f.dynamic === "0" ? " selected" : ""}>Static</option></select>
    ${renderTimeframeSelect(props.timeframe.key)}
  </div>
</div>`;
}

// §10.2: the badge follows calls_provider_api — the same axis the list API's
// `dynamic` filter binds to, so filtering "Dynamic" only ever shows
// Dynamic-badged rows (a CPL offer calls the provider ⇒ Dynamic).
function dynamicBadge(o: OfferListItem): string {
  return o.calls_provider_api
    ? '<span class="badge badge-scheduled">Dynamic</span>'
    : '<span class="badge badge-draft">Static</span>';
}

function capBadge(o: OfferListItem): string {
  if (!o.cap_enabled) return EM_DASH;
  const amount = o.cap_amount !== null ? `${o.cap_amount} ${o.cap_count_by ?? ""}`.trim() : "Cap";
  return `<span class="badge badge-scheduled">${escapeHtml(amount)}</span>`;
}

// 05 §5.1 list badge: SERVER-verdict-driven auction eligibility. Dynamic
// offers show Eligible/Blocked (blocked reasons ride the title as operator
// labels); static offers are outside the gate → a neutral dash.
function eligibilityBadge(o: OfferListItem): string {
  if (!o.calls_provider_api) {
    return `<span data-offer-eligibility="na">${EM_DASH}</span>`;
  }
  const verdict = o.eligibility ?? null;
  if (verdict === null) {
    return `<span data-offer-eligibility="unknown">${EM_DASH}</span>`;
  }
  if (verdict.eligible) {
    return `<span class="badge badge-published" data-offer-eligibility="eligible">Eligible</span>`;
  }
  const labels = verdict.reasons.map(eligibilityReasonLabel).join(" · ");
  return `<span class="badge badge-archived" data-offer-eligibility="blocked" title="${escapeHtml(labels)}">Blocked</span>`;
}

// §7.1 (F5): the per-row Test-status chip. The list API's additive field is
// consumed DEFENSIVELY — `test_status` (the canonical spelling), then the
// `last_test_status` / `last_test_ok` variants; anything absent or unknown
// renders the "Untested" state — so this column is safe in both merge orders
// of the parallel server slice. Exported for the defensive-rendering
// regression (leadgen-offers-ui.test.ts).
export function testStatusChip(o: OfferListItem): string {
  const raw =
    typeof o.test_status === "string"
      ? o.test_status
      : typeof o.last_test_status === "string"
        ? o.last_test_status
        : o.last_test_ok === true
          ? "passed"
          : o.last_test_ok === false
            ? "failed"
            : "";
  const status = raw === "passed" || raw === "failed" ? raw : "untested";
  const label = status === "passed" ? "Passed" : status === "failed" ? "Failed" : "Untested";
  const cls =
    status === "passed" ? "badge-published" : status === "failed" ? "badge-archived" : "badge-draft";
  return `<span class="badge ${cls}" data-offer-test-status="${status}">${label}</span>`;
}

function renderAnalyticsSkeletonCells(): string {
  return OFFER_ANALYTICS_COLUMNS.map(
    (col) =>
      `<td class="lg-num" data-metric="${col.metric}"><span class="skel" aria-hidden="true"></span></td>`,
  ).join("");
}

function renderOfferRow(o: OfferListItem): string {
  const name = escapeHtml(o.offer_name);
  const editHref = `/admin/leadgen/offers/${encodeURIComponent(o.public_id)}/edit`;
  return `<tr data-entity-id="${o.id}" data-entity-name="${name}" data-offer-public-id="${escapeHtml(o.public_id)}">
  <td>${name}</td>
  <td>${o.default_placement_id !== null ? escapeHtml(o.default_placement_id) : EM_DASH}</td>
  <td>${o.provider !== null ? escapeHtml(o.provider) : EM_DASH}</td>
  <td>${escapeHtml(o.vertical)} / ${escapeHtml(o.activity)}</td>
  <td>${escapeHtml(OFFER_TYPE_LABELS[o.offer_type] ?? o.offer_type)}</td>
  <td>${dynamicBadge(o)}</td>
  <td data-eligibility-cell>${eligibilityBadge(o)}</td>
  <td data-test-status-cell>${testStatusChip(o)}</td>
  <td>${capBadge(o)}</td>
  <td>${statusBadge(o.status)}</td>
  ${renderAnalyticsSkeletonCells()}
  <td><div class="table-actions">
    <a href="${editHref}" class="btn btn-sm btn-secondary">Edit</a>
    ${renderKebabOpen(name)}<a href="${editHref}" class="lg-kebab-item" role="menuitem">Edit</a>
        <button type="button" class="lg-kebab-item" role="menuitem" data-offer-duplicate="${escapeHtml(o.public_id)}" data-offer-name="${name}">Duplicate</button>
        <button type="button" class="lg-kebab-item" role="menuitem" data-offer-archive="${escapeHtml(o.public_id)}" data-offer-name="${name}">Archive</button>
        <button type="button" class="lg-kebab-item lg-kebab-danger" role="menuitem" data-offer-delete="${escapeHtml(o.public_id)}" data-offer-name="${name}">Delete</button>
        <button type="button" class="lg-kebab-item" role="menuitem" data-offer-usage="${escapeHtml(o.public_id)}" data-offer-name="${name}">Usage</button>${KEBAB_CLOSE}
  </div></td>
</tr>`;
}

function renderEmptyRow(hasActiveFilters: boolean): string {
  const inner = hasActiveFilters
    ? `<div class="empty-state"><p>No offers match the current filters.</p></div>`
    : `<div class="empty-state"><p>No offers yet.</p><button type="button" class="btn btn-primary" data-open-offer-modal>+ Create an Offer</button></div>`;
  return `<tr><td colspan="${OFFER_COLUMN_COUNT}">${inner}</td></tr>`;
}

function renderOffersTable(props: OffersPageProps): string {
  const f = props.filters;
  const hasActiveFilters =
    f.search !== "" || f.provider !== "" || f.vertical !== "" || f.activity !== "" ||
    f.status !== "" || f.offer_type !== "" || f.dynamic !== "";
  const rows =
    props.offers.length === 0
      ? renderEmptyRow(hasActiveFilters)
      : props.offers.map(renderOfferRow).join("");
  const analyticsHeaders = OFFER_ANALYTICS_COLUMNS.map(
    (col) => `<th scope="col" class="lg-num" data-metric-col="${col.metric}">${escapeHtml(col.label)}</th>`,
  ).join("");
  return `<div class="card">
  <div class="table-wrapper">
    <table class="table table--sticky-edges leadgen-offers-list" aria-label="Offers list"
      data-lg-analytics
      data-analytics-url-prefix="/api/admin/leadgen/offers/"
      data-analytics-from="${escapeHtml(props.timeframe.from)}"
      data-analytics-to="${escapeHtml(props.timeframe.to)}">
      <thead><tr>
        <th scope="col">Name</th>
        <th scope="col">Placement ID</th>
        <th scope="col">Provider</th>
        <th scope="col">Vertical / Activity</th>
        <th scope="col">Type</th>
        <th scope="col">Dynamic/Static</th>
        <th scope="col">Eligibility</th>
        <th scope="col">Test status</th>
        <th scope="col">Cap</th>
        <th scope="col">Status</th>
        ${analyticsHeaders}
        <th scope="col">Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// §10.1 Create-Offer modal
// ---------------------------------------------------------------------------

function renderModeRadios(idPrefix: string): string {
  return OFFER_MODES.map(
    (mode, index) =>
      `<label class="form-label lg-radio" for="${idPrefix}-${index}"><input id="${idPrefix}-${index}" type="radio" name="auction_mode" value="${mode.value}" required aria-required="true" /> ${escapeHtml(mode.label)}</label>`,
  ).join("");
}

// §10.1: REQUIRED business fields exactly — offer_name, activity, vertical,
// conversion_tracking_method, offer_type, ≥1 placement, the §10.2 mode
// picker, cap_enabled toggle. Optional: tag, provider, static-bid fields.
// The heavy config never rides the modal (draft-then-configure).
function renderCreateOfferModal(): string {
  return `<div id="lg-offer-modal" class="modal hidden" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="lg-offer-modal-title" aria-hidden="true">
  <div class="modal-content">
    <h2 id="lg-offer-modal-title" class="modal-title">Create an Offer</h2>
    <form id="lg-offer-form" novalidate>
      <p id="lg-offer-modal-error" class="alert alert-error" hidden role="alert"></p>
      <p id="lg-offer-modal-status" class="form-status" role="status" aria-live="polite"></p>
      <div class="form-group">
        <label for="lg-offer-name" class="form-label">Offer name *</label>
        <input id="lg-offer-name" name="offer_name" type="text" class="form-input" required aria-required="true" />
        ${fieldError("offer_name")}
      </div>
      <div class="form-group">
        <label for="lg-offer-activity" class="form-label">Activity *</label>
        <input id="lg-offer-activity" name="activity" type="text" class="form-input" required aria-required="true" />
        ${fieldError("activity")}
      </div>
      <div class="form-group">
        <label for="lg-offer-vertical" class="form-label">Vertical *</label>
        <input id="lg-offer-vertical" name="vertical" type="text" class="form-input" required aria-required="true" />
        ${fieldError("vertical")}
      </div>
      <div class="form-group">
        <label for="lg-offer-tracking-method" class="form-label">Conversion tracking method *</label>
        <select id="lg-offer-tracking-method" name="conversion_tracking_method" class="form-select" required aria-required="true">
          ${options(LEADGEN_TRACKING_METHODS, TRACKING_METHOD_LABELS, "", "Choose a tracking method…")}
        </select>
        ${fieldError("conversion_tracking_method")}
      </div>
      <div class="form-group">
        <label for="lg-offer-type" class="form-label">Offer type *</label>
        <select id="lg-offer-type" name="offer_type" class="form-select" required aria-required="true">
          ${options(LEADGEN_OFFER_TYPES, OFFER_TYPE_LABELS, "", "Choose an offer type…")}
        </select>
        ${fieldError("offer_type")}
      </div>
      <fieldset class="form-group">
        <legend class="form-label">Placement ids (provider placement/feed id) *</legend>
        <div id="lg-offer-placements">
          <div class="lg-placement-row"><input type="text" class="form-input" data-placement-input placeholder="pl-12345" required aria-required="true" aria-label="Placement id" /></div>
        </div>
        <button type="button" id="lg-offer-add-placement" class="btn btn-sm btn-secondary">+ Add placement</button>
        <span class="form-help">The first placement becomes the default.</span>
        ${fieldError("placements")}
      </fieldset>
      <fieldset class="form-group">
        <legend class="form-label">Auction mode (§10.2) *</legend>
        ${renderModeRadios("lg-offer-mode")}
        ${fieldError("auction_mode")}
      </fieldset>
      <div id="lg-offer-static-conditional" hidden>
        <div class="form-group">
          <label for="lg-offer-static-bid-value" class="form-label">Static bid value</label>
          <input id="lg-offer-static-bid-value" name="static_bid_value" type="number" step="0.01" min="0" class="form-input" />
          ${fieldError("static_bid_value")}
        </div>
        <div class="form-group">
          <label for="lg-offer-static-bid-currency" class="form-label">Static bid currency</label>
          <select id="lg-offer-static-bid-currency" name="static_bid_currency" class="form-select">${options(BID_CURRENCIES, null, "", "Choose a currency…")}</select>
          ${fieldError("static_bid_currency")}
        </div>
        <div class="form-group">
          <label for="lg-offer-static-order" class="form-label">Static order</label>
          <input id="lg-offer-static-order" name="static_order" type="number" step="1" class="form-input" />
          ${fieldError("static_order")}
        </div>
      </div>
      <div class="form-group">
        <label for="lg-offer-cap-enabled" class="form-label"><input id="lg-offer-cap-enabled" name="cap_enabled" type="checkbox" value="1" /> Enable offer cap</label>
        <span class="form-help">Cap amount / timezone / count-by are configured in the editor's Cap tab (§10.6).</span>
        ${fieldError("cap_enabled")}
      </div>
      <div class="form-group">
        <label for="lg-offer-tag" class="form-label">Tag</label>
        <input id="lg-offer-tag" name="tag" type="text" class="form-input" />
        ${fieldError("tag")}
      </div>
      <div class="form-group">
        <label for="lg-offer-provider" class="form-label">Provider</label>
        <input id="lg-offer-provider" name="provider" type="text" class="form-input" />
        ${fieldError("provider")}
      </div>
      <div class="modal-actions">
        <button type="submit" id="lg-offer-modal-save" class="btn btn-primary">Create Offer</button>
        <button type="button" id="lg-offer-modal-cancel" class="btn btn-secondary">Cancel</button>
      </div>
    </form>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// §7.3 Duplicate-Offer modal (A2)
// ---------------------------------------------------------------------------
//
// Fields per 07 §7.3: New Offer name (island prefills "<name> (copy)"), New
// default placement ID (REQUIRED — the island blocks submit when empty; source
// placement ids are never copied verbatim), ☑ Copy region rules (default ON),
// ☐ Copy cap settings ("copied disabled", default OFF), ☑ Copy endpoint/request
// config (refs only, default ON). [Create draft] POSTs the pinned body to
// /offers/:id/duplicate; success navigates to the new editor with the
// "Duplicated from <name>" banner (query-param driven, renderDuplicatedBanner).
function renderDuplicateModal(): string {
  return `<div id="lg-offer-duplicate-modal" class="modal hidden" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="lg-dup-title" aria-hidden="true">
  <div class="modal-content">
    <h2 id="lg-dup-title" class="modal-title">Duplicate offer</h2>
    <form id="lg-offer-duplicate-form" novalidate>
      <p id="lg-dup-error" class="alert alert-error" hidden role="alert"></p>
      <p id="lg-dup-status" class="form-status" role="status" aria-live="polite"></p>
      <p class="form-help">Creates a <strong>draft</strong> copy (status inactive, test status untested). Analytics, cap counters, provider logs, test results and revenue are never copied.</p>
      <div class="form-group">
        <label for="lg-dup-name" class="form-label">New offer name *</label>
        <input id="lg-dup-name" name="name" type="text" class="form-input" required aria-required="true" />
        ${fieldError("name")}
      </div>
      <div class="form-group">
        <label for="lg-dup-placement" class="form-label">New default placement ID *</label>
        <input id="lg-dup-placement" name="default_placement_id" type="text" class="form-input" placeholder="pl-12345" required aria-required="true" />
        <span class="form-help">Required — two offers must never serve the same provider feed id by accident. Any additional placements are copied as blank rows flagged &ldquo;needs value&rdquo;.</span>
        ${fieldError("default_placement_id")}
      </div>
      <fieldset class="form-group">
        <legend class="form-label">Copy from the source offer</legend>
        <label class="form-label lg-radio"><input id="lg-dup-copy-region" name="copy_region_rules" type="checkbox" value="1" checked /> Copy region rules</label>
        <label class="form-label lg-radio"><input id="lg-dup-copy-endpoint" name="copy_endpoint_config" type="checkbox" value="1" checked /> Copy endpoint &amp; request config <span class="form-help">(refs only — secrets never move)</span></label>
        <label class="form-label lg-radio"><input id="lg-dup-copy-cap" name="copy_cap_settings" type="checkbox" value="1" /> Copy cap settings <span class="form-help">(copied disabled)</span></label>
      </fieldset>
      <div class="modal-actions">
        <button type="submit" id="lg-dup-submit" class="btn btn-primary">Create draft</button>
        <button type="button" id="lg-dup-cancel" class="btn btn-secondary">Cancel</button>
      </div>
    </form>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// §7.2 Delete-Offer confirm modal (A1) — guarded hard delete
// ---------------------------------------------------------------------------
//
// Type-the-offer-name-to-confirm gate (Delete stays disabled until the typed
// name matches). Confirm → DELETE ?mode=hard. A 200 cascades own children; a
// 409 offer_in_use renders the §7.4 usage report as the "in use" modal (via
// the shared lg-dialog) with per-kind counts + links + an "Archive instead"
// primary action — the blocked state explains itself, never hidden.
function renderDeleteModal(): string {
  return `<div id="lg-offer-delete-modal" class="modal hidden" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="lg-del-title" aria-hidden="true">
  <div class="modal-content">
    <h2 id="lg-del-title" class="modal-title">Delete offer permanently</h2>
    <form id="lg-offer-delete-form" novalidate>
      <p id="lg-del-error" class="alert alert-error" hidden role="alert"></p>
      <p class="alert alert-error" role="alert">This permanently deletes the offer and its own children (placements, schema versions, region rules, own cap counters). This cannot be undone. Logs, revenue and analytics are never deleted.</p>
      <div class="form-group">
        <label for="lg-del-confirm" class="form-label">Type the offer name <strong data-delete-offer-name></strong> to confirm</label>
        <input id="lg-del-confirm" type="text" class="form-input" autocomplete="off" aria-label="Type the offer name to confirm deletion" />
      </div>
      <div class="modal-actions">
        <button type="submit" id="lg-del-submit" class="btn btn-danger" disabled aria-disabled="true">Delete permanently</button>
        <button type="button" id="lg-del-cancel" class="btn btn-secondary">Cancel</button>
      </div>
    </form>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Styles (offers list + editor)
// ---------------------------------------------------------------------------

const LG_OFFERS_STYLES = `
.skel{display:inline-block;min-width:36px;height:12px;border-radius:4px;background:linear-gradient(90deg,#e5e7eb 25%,#f3f4f6 50%,#e5e7eb 75%);background-size:200% 100%;animation:lgShimmer 1.2s linear infinite}
@keyframes lgShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.modal{position:fixed;inset:0;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;z-index:1000}
.modal.hidden{display:none}
.modal-content{background:#fff;border-radius:8px;padding:24px;max-width:640px;width:92%;max-height:90vh;overflow-y:auto;box-shadow:0 10px 25px rgba(0,0,0,0.15)}
.modal-title{margin-bottom:16px;font-size:18px;font-weight:600}
.modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
.form-status{min-height:18px;font-size:13px;color:var(--c-muted);margin-bottom:8px}
.macro-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.macro-chip{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;padding:2px 8px;border:1px solid var(--c-border);border-radius:9999px;background:var(--c-bg-alt);color:var(--c-text);cursor:pointer}
.macro-chip:hover{border-color:var(--c-primary);color:var(--c-primary)}
.lg-usage-list{margin:8px 0 8px 18px}
.lg-usage-list li{margin-bottom:4px}
.lg-retry{margin-left:6px}
.lg-radio{display:flex;align-items:center;gap:8px;font-weight:400}
.lg-placement-row{display:flex;gap:8px;margin-bottom:8px;align-items:center}
.lg-saving{position:relative;opacity:.85}
.lg-saving::after{content:'';width:12px;height:12px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;display:inline-block;margin-left:8px;animation:lgSpin .8s linear infinite}
@keyframes lgSpin{to{transform:rotate(360deg)}}
.lg-editor-head{display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.lg-editor-title{font-size:18px;font-weight:600}
.lg-editor-pubid{font-size:12px;color:var(--c-muted)}
.lg-editor-spacer{flex:1}
.lg-editor-tabs{display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid var(--c-border);flex-wrap:wrap}
.lg-editor-tab{padding:8px 16px;color:var(--c-muted);font-weight:500;border:0;background:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;font-size:14px}
.lg-editor-tab:hover{color:var(--c-text)}
.lg-editor-tab.active{color:var(--c-primary);border-bottom-color:var(--c-primary)}
.lg-rule-row{display:grid;grid-template-columns:1fr 1fr 2fr 90px auto auto;gap:8px;margin-bottom:8px;align-items:center}
@media (max-width:900px){.lg-rule-row{grid-template-columns:1fr}}
.lg-fallback-results{border:1px solid var(--c-border);border-radius:6px;margin-top:6px;display:flex;flex-direction:column}
.lg-fallback-results[hidden]{display:none}
.lg-fallback-result{display:block;width:100%;text-align:left;padding:8px 12px;border:0;background:none;font-size:13px;cursor:pointer}
.lg-fallback-result:hover{background:var(--c-bg-alt)}
.lg-fallback-selected{margin-top:6px;font-size:13px}
.lg-metric-null{color:var(--c-muted)}
.lg-eligibility-banner{border-radius:6px;padding:10px 12px;margin-bottom:12px;font-size:13px;border:1px solid transparent}
.lg-eligibility-banner.lg-eligible{background:var(--c-success-bg,#e8f7ee);color:var(--c-success,#186a3b);border-color:var(--c-success,#7dcb9a)}
.lg-eligibility-banner.lg-blocked{background:var(--c-danger-bg,#fdecea);color:var(--c-danger,#8a1f11);border-color:var(--c-danger,#e5a49a)}
.lg-eligibility-reasons{margin:6px 0 8px 18px}
.lg-eligibility-reasons li{margin-bottom:2px}
.lg-eligibility-links{display:flex;gap:8px;flex-wrap:wrap}
/* Product-fix round (S2.4 admin-UI, root-cause): the LOCAL .lg-kebab* rules
   that used to live here are REMOVED — they were a stale, pre-portal-fix
   copy that shadowed (via cascade order: page styles load AFTER
   ADMIN_STYLES) the shared, ALREADY-FIXED .lg-kebab-menu rule (z-index:100)
   layout.ts's ADMIN_STYLES provides globally. This offers row markup now
   renders via renderKebabOpen/KEBAB_CLOSE (the same shared component every
   other list — sections/auctions/quotes/listicles — already uses), so the
   shared CSS applies unshadowed. See LG_OFFERS_LIST_ACTIONS_SCRIPT's own
   comment for the full root-cause (a position:sticky last-column cell —
   .table--sticky-edges td:last-child — establishes its OWN stacking
   context, so a locally z-indexed absolute menu can never outrank a
   DIFFERENT row's own sticky cell once the menu's height overflows past its
   row; kebabMenuScript fixes this by reparenting the open menu to <body> +
   position:fixed, escaping every ancestor stacking context in one step). */
.lg-usage-kind{margin:10px 0}
.lg-usage-kind-head{display:flex;align-items:baseline;gap:8px;font-weight:600;font-size:13px}
.lg-usage-count{color:var(--c-muted);font-weight:400}
.lg-usage-warn-tag{font-size:11px;color:var(--c-warn,#8a5300);border:1px solid var(--c-warn,#e0a04a);border-radius:9999px;padding:0 8px}
.lg-usage-empty{color:var(--c-muted);font-size:13px;margin:2px 0 0 0}
.lg-usage-verdict{border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:13px;border:1px solid transparent}
.lg-usage-verdict.lg-eligible{background:var(--c-success-bg,#e8f7ee);color:var(--c-success,#186a3b);border-color:var(--c-success,#7dcb9a)}
.lg-usage-verdict.lg-blocked{background:var(--c-danger-bg,#fdecea);color:var(--c-danger,#8a1f11);border-color:var(--c-danger,#e5a49a)}
.lg-dup-banner{border-radius:6px;padding:10px 12px;margin-bottom:12px;font-size:13px;background:var(--c-info-bg,#eaf2fb);color:var(--c-info,#1c4e80);border:1px solid var(--c-info,#a9c9ea)}
.lg-dup-banner ul{margin:6px 0 0 18px}
.lg-region-values{display:flex;flex-direction:column;gap:6px;min-width:0}
.lg-chips{display:flex;flex-wrap:wrap;gap:6px}
.lg-chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:2px 4px 2px 10px;border:1px solid var(--c-border);border-radius:9999px;background:var(--c-bg-alt);color:var(--c-text)}
.lg-chip button{border:0;background:none;cursor:pointer;color:var(--c-muted);font-size:14px;line-height:1;padding:0 4px}
.lg-chip button:hover{color:var(--c-danger,#8a1f11)}
.lg-region-entry{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.lg-region-entry [hidden]{display:none}
.lg-region-paste{display:flex;flex-direction:column;gap:6px}
.lg-region-paste[hidden]{display:none}
.lg-region-invalid{color:var(--c-danger,#8a1f11);font-size:12px}
.lg-region-invalid[hidden]{display:none}
.lg-region-help{color:var(--c-muted);font-size:12px}
.lg-region-order{display:flex;flex-direction:column;gap:2px;font-size:11px;color:var(--c-muted)}
.lg-region-order input{width:90px}
`;

// ---------------------------------------------------------------------------
// Shared inline script (strict ES5) — window.lgUi
// ---------------------------------------------------------------------------
//
// The leadgen-scoped mirror of the listicles LST_SHARED_SCRIPT: getJson,
// generic dialog, and after-paint analytics hydration for every
// `table[data-lg-analytics]` (§9.1 loading skeletons; a NULL ratio from the
// API's NULLIF guards renders as an em-dash, never a fake 0).

const LG_SHARED_SCRIPT = `
(function () {
  function fmtInt(v) { var n = Number(v); if (!isFinite(n)) { n = 0; } return String(Math.round(n)); }
  function fmtPct(v) { var n = Number(v); if (!isFinite(n)) { n = 0; } return (n * 100).toFixed(2) + '%'; }
  function fmtDec(v) { var n = Number(v); if (!isFinite(n)) { n = 0; } return n.toFixed(2); }
  var FORMATS = {
    offer_impressions: fmtInt, clicks: fmtInt, unique_clicks: fmtInt, conversions: fmtInt,
    ctr: fmtPct, cvr: fmtPct,
    revenue: fmtDec, rpc: fmtDec, rpm: fmtDec
  };

  function clearChildren(el) { while (el.firstChild) { el.removeChild(el.firstChild); } }

  function getJson(method, url, body) {
    var options = { method: method, credentials: 'same-origin', headers: { 'Accept': 'application/json' } };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    return fetch(url, options).then(function (r) {
      return r.json().then(
        function (j) { return { ok: r.ok, status: r.status, body: j }; },
        function () { return { ok: r.ok, status: r.status, body: null }; }
      );
    });
  }

  function metricCells(row) { return row.querySelectorAll('td[data-metric]'); }

  function setValues(row, metrics) {
    var cells = metricCells(row);
    var i, key, fmt, has;
    for (i = 0; i < cells.length; i++) {
      key = cells[i].getAttribute('data-metric');
      fmt = FORMATS[key] || fmtDec;
      has = metrics && metrics[key] !== undefined && metrics[key] !== null;
      clearChildren(cells[i]);
      // NULL ratio (zero denominator) renders as an em-dash (§9.1).
      cells[i].appendChild(document.createTextNode(has ? fmt(metrics[key]) : '\\u2014'));
    }
  }

  function setFailed(row) {
    var cells = metricCells(row);
    var i, btn;
    for (i = 0; i < cells.length; i++) {
      clearChildren(cells[i]);
      cells[i].appendChild(document.createTextNode('\\u2014'));
    }
    if (cells.length > 0) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm btn-outline lg-retry';
      btn.appendChild(document.createTextNode('Retry'));
      cells[0].appendChild(btn);
    }
  }

  function failRow(table, row, message) {
    setFailed(row);
    if (!table.getAttribute('data-analytics-toast-shown')) {
      table.setAttribute('data-analytics-toast-shown', '1');
      if (window.showToast) {
        window.showToast('Failed to load analytics' + (message ? ': ' + message : ''), 'error');
      }
    }
  }

  function analyticsUrl(table, id) {
    var prefix = table.getAttribute('data-analytics-url-prefix') || '';
    var from = table.getAttribute('data-analytics-from') || '';
    var to = table.getAttribute('data-analytics-to') || '';
    return prefix + encodeURIComponent(id) + '/analytics?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
  }

  function hydrateRow(table, row) {
    var id = row.getAttribute('data-entity-id');
    if (!id) { return; }
    getJson('GET', analyticsUrl(table, id)).then(function (res) {
      if (!res.ok || !res.body || res.body.error) {
        failRow(table, row, res.body && res.body.error);
        return;
      }
      setValues(row, res.body.analytics || {});
    }).catch(function () {
      failRow(table, row, null);
    });
  }

  function hydrateAll() {
    var tables = document.querySelectorAll('table[data-lg-analytics]');
    var i, j, rows;
    for (i = 0; i < tables.length; i++) {
      tables[i].removeAttribute('data-analytics-toast-shown');
      rows = tables[i].querySelectorAll('tbody tr[data-entity-id]');
      for (j = 0; j < rows.length; j++) { hydrateRow(tables[i], rows[j]); }
    }
  }

  // --- generic dialog (usage panels) -----------------------------------------
  function dialogRoot() { return document.getElementById('lg-dialog'); }

  function openDialog(title) {
    var root = dialogRoot();
    if (!root) { return null; }
    var titleEl = document.getElementById('lg-dialog-title');
    var bodyEl = document.getElementById('lg-dialog-body');
    if (titleEl) { titleEl.textContent = title || ''; }
    if (bodyEl) { clearChildren(bodyEl); }
    root.style.display = 'flex';
    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');
    return bodyEl;
  }

  function closeDialog() {
    var root = dialogRoot();
    if (!root) { return; }
    root.style.display = 'none';
    root.classList.add('hidden');
    root.setAttribute('aria-hidden', 'true');
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) { return; }
    if (t.closest('[data-dialog-close]')) { closeDialog(); return; }
    var root = dialogRoot();
    if (root && e.target === root) { closeDialog(); return; }
    var retry = t.closest('.lg-retry');
    if (retry) {
      var row = retry.closest('tr');
      var table = retry.closest('table');
      if (row && table) {
        table.removeAttribute('data-analytics-toast-shown');
        hydrateRow(table, row);
      }
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeDialog(); }
  });

  window.lgUi = {
    openDialog: openDialog,
    closeDialog: closeDialog,
    hydrateAll: hydrateAll,
    getJson: getJson,
    formats: FORMATS
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrateAll);
  } else {
    hydrateAll();
  }
}());
`;

function renderLgDialogShell(): string {
  return `<div id="lg-dialog" class="modal hidden" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="lg-dialog-title" aria-hidden="true">
  <div class="modal-content">
    <h2 id="lg-dialog-title" class="modal-title"></h2>
    <div id="lg-dialog-body"></div>
    <div class="modal-actions"><button type="button" class="btn btn-secondary" data-dialog-close>Close</button></div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Create-Offer modal script (strict ES5)
// ---------------------------------------------------------------------------
//
// §9.6 behaviors: submit disabled + spinner while saving, client validation
// mirroring §10.1 (server stays authoritative — its field-keyed errors render
// inline + a top-of-modal summary), Escape/backdrop/Cancel discard guard,
// beforeunload dirty guard. On success → redirect to the editor
// (draft-then-configure, §10.1). Auto-opens when the page root carries
// data-autopen-create (the /offers/new route, 01 §5.2).

const LG_OFFER_MODAL_SCRIPT = `
(function () {
  var modal = document.getElementById('lg-offer-modal');
  var form = document.getElementById('lg-offer-form');
  if (!modal || !form) { return; }
  var saveBtn = document.getElementById('lg-offer-modal-save');
  var cancelBtn = document.getElementById('lg-offer-modal-cancel');
  var errEl = document.getElementById('lg-offer-modal-error');
  var statusEl = document.getElementById('lg-offer-modal-status');
  var staticConditional = document.getElementById('lg-offer-static-conditional');
  var placements = document.getElementById('lg-offer-placements');
  var dirty = false;

  // §10.2 mode → the two DDL flags (0036 lines 13–16).
  var MODE_FLAGS = {
    static_no_request: { calls_provider_api: false, bid_source: 'static' },
    request_static_bid: { calls_provider_api: true, bid_source: 'static' },
    request_dynamic_bid: { calls_provider_api: true, bid_source: 'response' }
  };
  // Server flag-combo errors surface on the mode picker's error slot.
  var ERROR_ALIASES = { calls_provider_api: 'auction_mode', bid_source: 'auction_mode' };

  function fieldByName(name) { return form.querySelector('[name="' + name + '"]'); }
  function setTopError(msg) { if (errEl) { errEl.hidden = !msg; errEl.textContent = msg || ''; } }
  function setStatus(msg) { if (statusEl) { statusEl.textContent = msg || ''; } }
  function setFieldError(name, message) {
    var key = name;
    if (!form.querySelector('[data-error-for="' + key + '"]') && ERROR_ALIASES[key]) { key = ERROR_ALIASES[key]; }
    var el = form.querySelector('[data-error-for="' + key + '"]');
    if (el) { el.hidden = !message; el.textContent = message || ''; return true; }
    return false;
  }
  function clearFieldErrors() {
    var els = form.querySelectorAll('.form-error');
    var i;
    for (i = 0; i < els.length; i++) { els[i].hidden = true; els[i].textContent = ''; }
  }
  function selectedMode() {
    var checked = form.querySelector('[name="auction_mode"]:checked');
    return checked ? checked.value : '';
  }

  // --- placements rows -------------------------------------------------------
  function addPlacementRow() {
    if (!placements) { return; }
    var row = document.createElement('div');
    row.className = 'lg-placement-row';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-input';
    input.setAttribute('data-placement-input', '');
    input.setAttribute('aria-label', 'Placement id');
    input.placeholder = 'pl-12345';
    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-sm btn-danger';
    remove.setAttribute('data-placement-remove', '');
    remove.appendChild(document.createTextNode('Remove'));
    row.appendChild(input);
    row.appendChild(remove);
    placements.appendChild(row);
    input.focus();
  }
  var addPlacementBtn = document.getElementById('lg-offer-add-placement');
  if (addPlacementBtn) { addPlacementBtn.addEventListener('click', function () { addPlacementRow(); dirty = true; }); }
  if (placements) {
    placements.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-placement-remove]') : null;
      if (btn) {
        var row = btn.closest('.lg-placement-row');
        if (row && row.parentNode) { row.parentNode.removeChild(row); }
        dirty = true;
      }
    });
  }
  function placementValues() {
    var inputs = placements ? placements.querySelectorAll('[data-placement-input]') : [];
    var out = [];
    var i, v;
    for (i = 0; i < inputs.length; i++) {
      v = String(inputs[i].value || '').replace(/^\\s+|\\s+$/g, '');
      if (v !== '') { out.push(v); }
    }
    return out;
  }

  // --- §10.2 static-bid conditional reveal -------------------------------------
  function applyModeState() {
    var mode = selectedMode();
    var flags = MODE_FLAGS[mode];
    if (staticConditional) {
      staticConditional.hidden = !(flags && flags.bid_source === 'static');
    }
  }
  form.addEventListener('change', function (e) {
    if (e.target && e.target.name === 'auction_mode') { applyModeState(); }
  });

  // --- open / close / reset ------------------------------------------------------
  function openModal() {
    modal.style.display = 'flex';
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
  }
  function closeModal() {
    modal.style.display = 'none';
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    dirty = false;
  }
  function resetForm() {
    form.reset();
    clearFieldErrors();
    setTopError('');
    setStatus('');
    if (placements) {
      var rows = placements.querySelectorAll('.lg-placement-row');
      var i;
      for (i = 1; i < rows.length; i++) {
        if (rows[i].parentNode) { rows[i].parentNode.removeChild(rows[i]); }
      }
    }
    applyModeState();
    dirty = false;
  }
  function openCreate() {
    resetForm();
    openModal();
    var first = document.getElementById('lg-offer-name');
    if (first) { first.focus(); }
  }
  function requestCloseModal() {
    if (dirty && !window.confirm('Discard unsaved offer changes?')) { return; }
    closeModal();
  }
  if (cancelBtn) { cancelBtn.addEventListener('click', requestCloseModal); }
  modal.addEventListener('click', function (e) { if (e.target === modal) { requestCloseModal(); } });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) { requestCloseModal(); }
  });

  form.addEventListener('input', function () { dirty = true; });
  form.addEventListener('change', function () { dirty = true; });
  window.addEventListener('beforeunload', function (e) {
    if (dirty && !modal.classList.contains('hidden')) {
      e.preventDefault();
      e.returnValue = 'You have unsaved offer changes.';
      return 'You have unsaved offer changes.';
    }
    return undefined;
  });

  // --- collect + client validation (§10.1 mirror; server authoritative) ---------
  function collectBody() {
    var fd = new FormData(form);
    var mode = selectedMode();
    var flags = MODE_FLAGS[mode] || null;
    var body = {
      offer_name: String(fd.get('offer_name') || ''),
      activity: String(fd.get('activity') || ''),
      vertical: String(fd.get('vertical') || ''),
      conversion_tracking_method: String(fd.get('conversion_tracking_method') || ''),
      offer_type: String(fd.get('offer_type') || ''),
      placements: placementValues(),
      calls_provider_api: flags ? flags.calls_provider_api : null,
      bid_source: flags ? flags.bid_source : '',
      cap_enabled: !!(fd.get('cap_enabled')),
      tag: fd.get('tag') && String(fd.get('tag')).replace(/^\\s+|\\s+$/g, '') !== '' ? String(fd.get('tag')) : null,
      provider: fd.get('provider') && String(fd.get('provider')).replace(/^\\s+|\\s+$/g, '') !== '' ? String(fd.get('provider')) : null,
      static_bid_value: null,
      static_bid_currency: null,
      static_order: null
    };
    if (flags && flags.bid_source === 'static') {
      var bv = parseFloat(String(fd.get('static_bid_value') || ''));
      if (!isNaN(bv)) { body.static_bid_value = bv; }
      var cur = String(fd.get('static_bid_currency') || '');
      if (cur !== '') { body.static_bid_currency = cur; }
      var so = parseInt(String(fd.get('static_order') || ''), 10);
      if (!isNaN(so)) { body.static_order = so; }
    }
    return body;
  }
  function validateClient(body) {
    var errors = {};
    function requireText(key, label) {
      if (!body[key] || String(body[key]).replace(/^\\s+|\\s+$/g, '') === '') { errors[key] = label + ' is required'; }
    }
    requireText('offer_name', 'Offer name');
    requireText('activity', 'Activity');
    requireText('vertical', 'Vertical');
    if (!body.conversion_tracking_method) { errors.conversion_tracking_method = 'Conversion tracking method is required'; }
    if (!body.offer_type) { errors.offer_type = 'Offer type is required'; }
    if (body.placements.length === 0) { errors.placements = 'At least one placement id is required'; }
    if (body.calls_provider_api === null) { errors.auction_mode = 'Choose an auction mode'; }
    return errors;
  }
  function renderErrors(errors) {
    clearFieldErrors();
    var keys = [];
    var k;
    for (k in errors) {
      if (Object.prototype.hasOwnProperty.call(errors, k)) { keys.push(k); }
    }
    if (keys.length === 0) { return false; }
    var i, unmatched = [];
    for (i = 0; i < keys.length; i++) {
      if (!setFieldError(keys[i], errors[keys[i]])) { unmatched.push(keys[i] + ': ' + errors[keys[i]]); }
    }
    var summary = 'Please fix the highlighted field' + (keys.length === 1 ? '' : 's') + ' (' + keys.length + ').';
    if (unmatched.length > 0) { summary += ' ' + unmatched.join(' \\u00b7 '); }
    setTopError(summary);
    setStatus('Validation failed');
    var firstField = fieldByName(keys[0]);
    if (firstField && firstField.focus) { firstField.focus(); }
    return true;
  }

  // --- submit: Saving… → redirect to the editor (draft-then-configure) -----------
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    setTopError('');
    setStatus('');
    var body = collectBody();
    if (renderErrors(validateClient(body))) { return; }
    if (saveBtn) { saveBtn.disabled = true; saveBtn.classList.add('lg-saving'); }
    setStatus('Saving\\u2026');
    window.lgUi.getJson('POST', '/api/admin/leadgen/offers', body).then(function (res) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.remove('lg-saving'); }
      if (res.ok && res.body && res.body.public_id) {
        dirty = false;
        setStatus('');
        if (window.showToast) { window.showToast('Offer created \\u2014 opening the editor', 'success'); }
        window.location.href = '/admin/leadgen/offers/' + encodeURIComponent(res.body.public_id) + '/edit';
        return;
      }
      if (res.body && res.body.fields && renderErrors(res.body.fields)) {
        setStatus('Validation failed');
        return;
      }
      setTopError((res.body && res.body.error) || ('Error ' + res.status));
      setStatus('Save failed');
    }).catch(function () {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.remove('lg-saving'); }
      setTopError('Network error \\u2014 the offer was not saved.');
      setStatus('Save failed');
    });
  });

  applyModeState();

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) { return; }
    if (t.closest('[data-open-offer-modal]')) { openCreate(); }
  });

  // 01 §5.2: /admin/leadgen/offers/new = the list with the modal auto-open.
  var pageRoot = document.getElementById('lg-offers-root');
  if (pageRoot && pageRoot.getAttribute('data-autopen-create') === '1') { openCreate(); }
}());
`;

// ---------------------------------------------------------------------------
// List row actions script (strict ES5) — archive + usage dialog
// ---------------------------------------------------------------------------

const LG_OFFERS_LIST_ACTIONS_SCRIPT = `
(function () {
  var getJson = window.lgUi.getJson;
  var API = '/api/admin/leadgen/offers/';

  // §7.4 labels derive from the kind string itself — the server's kinds array
  // is the single source of truth (no client-side kind list to drift).
  function humanizeKind(kind) {
    return String(kind || '').replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); });
  }
  // Only http(s) or root-relative links are honored (XSS: never javascript:).
  function safeLink(href) {
    var h = String(href || '');
    if (h.charAt(0) === '/' && h.charAt(1) !== '/') { return h; }
    if (h.indexOf('https://') === 0 || h.indexOf('http://') === 0) { return h; }
    return '';
  }
  function itemLabel(it) {
    if (!it) { return ''; }
    return String(it.name || it.public_id || (it.id !== undefined && it.id !== null ? it.id : '') || '');
  }

  // Render the §7.4 report into a dialog body. mode='blocked' (409 in-use)
  // adds the cannot-delete verdict + an "Archive instead" primary; mode='view'
  // (Usage action) shows the delete-eligibility verdict read-only. The server
  // emits usage.kinds as an ORDERED ARRAY ({kind, count, items[],
  // warning_only?}) — it is rendered directly, in server order, every kind
  // (count 0 → "None."); server-derived text via createTextNode.
  function renderUsage(bodyEl, usage, mode, offerId, offerName) {
    var elig = usage && usage.delete_eligibility ? usage.delete_eligibility : null;
    var eligible = elig ? !!elig.eligible : false;

    var verdict = document.createElement('div');
    verdict.className = 'lg-usage-verdict ' + (eligible ? 'lg-eligible' : 'lg-blocked');
    verdict.setAttribute('data-usage-verdict', eligible ? 'eligible' : 'blocked');
    if (mode === 'blocked') {
      verdict.appendChild(document.createTextNode('This offer is in use and cannot be deleted. Remove the references below, or archive it instead.'));
    } else {
      verdict.appendChild(document.createTextNode(eligible
        ? 'No references \\u2014 this offer can be permanently deleted.'
        : 'This offer is referenced and cannot be permanently deleted (it can be archived).'));
    }
    bodyEl.appendChild(verdict);

    var kinds = usage && usage.kinds ? usage.kinds : [];
    var i;
    for (i = 0; i < kinds.length; i++) {
      var entry = kinds[i] || {};
      var kind = String(entry.kind || '');
      var count = entry.count !== undefined && entry.count !== null ? Number(entry.count) : (entry.items ? entry.items.length : 0);
      var items = entry.items || [];

      var block = document.createElement('div');
      block.className = 'lg-usage-kind';
      block.setAttribute('data-usage-kind', kind);

      var head = document.createElement('div');
      head.className = 'lg-usage-kind-head';
      head.appendChild(document.createTextNode(humanizeKind(kind)));
      var cnt = document.createElement('span');
      cnt.className = 'lg-usage-count';
      cnt.appendChild(document.createTextNode('(' + count + ')'));
      head.appendChild(cnt);
      if (entry.warning_only) {
        var wtag = document.createElement('span');
        wtag.className = 'lg-usage-warn-tag';
        wtag.appendChild(document.createTextNode('does not block delete'));
        head.appendChild(wtag);
      }
      block.appendChild(head);

      if (!items || items.length === 0) {
        var none = document.createElement('p');
        none.className = 'lg-usage-empty';
        none.appendChild(document.createTextNode('None.'));
        block.appendChild(none);
      } else {
        var ul = document.createElement('ul');
        ul.className = 'lg-usage-list';
        var j;
        for (j = 0; j < items.length; j++) {
          var li = document.createElement('li');
          var href = safeLink(items[j] ? items[j].link : '');
          if (href) {
            var a = document.createElement('a');
            a.setAttribute('href', href);
            a.appendChild(document.createTextNode(itemLabel(items[j])));
            li.appendChild(a);
          } else {
            li.appendChild(document.createTextNode(itemLabel(items[j])));
          }
          ul.appendChild(li);
        }
        block.appendChild(ul);
      }
      bodyEl.appendChild(block);
    }

    if (mode === 'blocked') {
      var actions = document.createElement('div');
      actions.className = 'modal-actions';
      var archive = document.createElement('button');
      archive.type = 'button';
      archive.className = 'btn btn-primary';
      archive.setAttribute('data-usage-archive', offerId || '');
      archive.setAttribute('data-offer-name', offerName || '');
      archive.appendChild(document.createTextNode('Archive instead'));
      actions.appendChild(archive);
      bodyEl.appendChild(actions);
    }
  }

  // §9.6 archive — reversible status flip (the default DELETE archives).
  function onArchive(id, name) {
    if (!window.confirm('Archive offer "' + name + '"? It can be re-activated from the editor.')) { return; }
    getJson('DELETE', API + encodeURIComponent(id)).then(function (res) {
      if (res.ok) {
        window.showToast('Offer archived', 'success');
        window.setTimeout(function () { window.location.reload(); }, 600);
        return;
      }
      window.showToast('Failed to archive offer' + (res.body && res.body.error ? ': ' + res.body.error : ''), 'error');
    }).catch(function () { window.showToast('Failed to archive offer', 'error'); });
  }

  // §7.1 Usage row action — the full §7.4 report (read-only "where is this used").
  function showUsage(id, name) {
    var bodyEl = window.lgUi.openDialog('Usage' + (name ? ' \\u2014 ' + name : ''));
    if (!bodyEl) { return; }
    var loading = document.createElement('p');
    loading.appendChild(document.createTextNode('Loading\\u2026'));
    bodyEl.appendChild(loading);
    getJson('GET', API + encodeURIComponent(id) + '/usage').then(function (res) {
      if (loading.parentNode) { loading.parentNode.removeChild(loading); }
      if (!res.ok || !res.body || !res.body.usage) {
        var err = document.createElement('p');
        err.className = 'alert alert-error';
        err.appendChild(document.createTextNode('Failed to load usage.'));
        bodyEl.appendChild(err);
        return;
      }
      renderUsage(bodyEl, res.body.usage, 'view', id, name);
    }).catch(function () {
      if (loading.parentNode) { loading.parentNode.removeChild(loading); }
      if (window.showToast) { window.showToast('Failed to load usage', 'error'); }
    });
  }

  // --- §7.2 delete (type-name-to-confirm → DELETE ?mode=hard → 409 usage) ------
  var delModal = document.getElementById('lg-offer-delete-modal');
  var delForm = document.getElementById('lg-offer-delete-form');
  var delInput = document.getElementById('lg-del-confirm');
  var delSubmit = document.getElementById('lg-del-submit');
  var delError = document.getElementById('lg-del-error');
  var delNameEls = delModal ? delModal.querySelectorAll('[data-delete-offer-name]') : [];
  var delTarget = { id: '', name: '' };
  function openModal(m) { if (m) { m.style.display = 'flex'; m.classList.remove('hidden'); m.setAttribute('aria-hidden', 'false'); } }
  function closeModal(m) { if (m) { m.style.display = 'none'; m.classList.add('hidden'); m.setAttribute('aria-hidden', 'true'); } }
  function syncDeleteEnabled() {
    if (!delSubmit) { return; }
    var match = delInput && String(delInput.value || '') === delTarget.name && delTarget.name !== '';
    delSubmit.disabled = !match;
    delSubmit.setAttribute('aria-disabled', match ? 'false' : 'true');
  }
  function openDelete(id, name) {
    delTarget = { id: id, name: name || '' };
    var i;
    for (i = 0; i < delNameEls.length; i++) {
      while (delNameEls[i].firstChild) { delNameEls[i].removeChild(delNameEls[i].firstChild); }
      delNameEls[i].appendChild(document.createTextNode(delTarget.name));
    }
    if (delInput) { delInput.value = ''; }
    if (delError) { delError.hidden = true; delError.textContent = ''; }
    syncDeleteEnabled();
    openModal(delModal);
    if (delInput) { delInput.focus(); }
  }
  if (delInput) { delInput.addEventListener('input', syncDeleteEnabled); }
  if (delForm) {
    delForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (delSubmit && delSubmit.disabled) { return; }
      if (delSubmit) { delSubmit.disabled = true; delSubmit.classList.add('lg-saving'); }
      getJson('DELETE', API + encodeURIComponent(delTarget.id) + '?mode=hard').then(function (res) {
        if (delSubmit) { delSubmit.classList.remove('lg-saving'); }
        if (res.ok) {
          if (window.showToast) { window.showToast('Offer deleted', 'success'); }
          closeModal(delModal);
          window.setTimeout(function () { window.location.reload(); }, 600);
          return;
        }
        if (res.status === 409 && res.body && res.body.usage) {
          closeModal(delModal);
          var bodyEl = window.lgUi.openDialog('Cannot delete \\u2014 ' + delTarget.name);
          if (bodyEl) { renderUsage(bodyEl, res.body.usage, 'blocked', delTarget.id, delTarget.name); }
          return;
        }
        syncDeleteEnabled();
        if (delError) { delError.hidden = false; delError.textContent = (res.body && res.body.error) || ('Error ' + res.status); }
      }).catch(function () {
        if (delSubmit) { delSubmit.classList.remove('lg-saving'); }
        syncDeleteEnabled();
        if (delError) { delError.hidden = false; delError.textContent = 'Network error \\u2014 the offer was not deleted.'; }
      });
    });
  }
  var delCancel = document.getElementById('lg-del-cancel');
  if (delCancel) { delCancel.addEventListener('click', function () { closeModal(delModal); }); }

  // --- §7.3 duplicate (prefill "<name> (copy)"; require placement id) ----------
  var dupModal = document.getElementById('lg-offer-duplicate-modal');
  var dupForm = document.getElementById('lg-offer-duplicate-form');
  var dupName = document.getElementById('lg-dup-name');
  var dupPlacement = document.getElementById('lg-dup-placement');
  var dupSubmit = document.getElementById('lg-dup-submit');
  var dupError = document.getElementById('lg-dup-error');
  var dupStatus = document.getElementById('lg-dup-status');
  var dupTarget = { id: '', name: '' };
  function dupFieldError(name, msg) {
    var el = dupForm ? dupForm.querySelector('[data-error-for="' + name + '"]') : null;
    if (el) { el.hidden = !msg; el.textContent = msg || ''; }
  }
  function openDuplicate(id, name) {
    dupTarget = { id: id, name: name || '' };
    if (dupName) { dupName.value = (name || 'Offer') + ' (copy)'; }
    if (dupPlacement) { dupPlacement.value = ''; }
    if (document.getElementById('lg-dup-copy-region')) { document.getElementById('lg-dup-copy-region').checked = true; }
    if (document.getElementById('lg-dup-copy-endpoint')) { document.getElementById('lg-dup-copy-endpoint').checked = true; }
    if (document.getElementById('lg-dup-copy-cap')) { document.getElementById('lg-dup-copy-cap').checked = false; }
    dupFieldError('name', ''); dupFieldError('default_placement_id', '');
    if (dupError) { dupError.hidden = true; dupError.textContent = ''; }
    if (dupStatus) { dupStatus.textContent = ''; }
    openModal(dupModal);
    if (dupPlacement) { dupPlacement.focus(); }
  }
  // §7.3 success path over the REAL 201 body: the new offer rides
  // res.body.offer (offerRowToApi fields — public_id lives THERE, not at the
  // top level) and the blank-placement count is res.body.copied
  // .extra_placements_blanked (a NUMBER). Returns the navigation URL for the
  // new editor (the query params drive the server-rendered "Duplicated from
  // <name>" banner: copied/skipped = the operator's copy intent; pending =
  // the blanked-placement count), or null when the response is not a
  // duplicate success (the caller falls through to the error paths).
  function duplicateResultNav(res, fromName, copyRegion, copyEndpoint, copyCap) {
    if (!(res && res.ok && res.body && res.body.offer && res.body.offer.public_id)) { return null; }
    var copied = [];
    var skipped = [];
    (copyRegion ? copied : skipped).push('copy_region_rules');
    (copyEndpoint ? copied : skipped).push('copy_endpoint_config');
    (copyCap ? copied : skipped).push('copy_cap_settings');
    var summary = res.body.copied;
    var pending = summary && summary.extra_placements_blanked !== undefined && summary.extra_placements_blanked !== null
      ? Number(summary.extra_placements_blanked) : null;
    var qs = '?duplicated_from=' + encodeURIComponent(fromName) +
      '&copied=' + encodeURIComponent(copied.join(',')) +
      '&skipped=' + encodeURIComponent(skipped.join(','));
    if (pending !== null && isFinite(pending)) { qs += '&pending=' + encodeURIComponent(String(pending)); }
    return '/admin/leadgen/offers/' + encodeURIComponent(res.body.offer.public_id) + '/edit' + qs;
  }
  // Applies the success navigation (toast + window.location). Returns false
  // (and touches nothing) for non-success responses.
  function applyDuplicateResult(res, fromName, copyRegion, copyEndpoint, copyCap) {
    var nav = duplicateResultNav(res, fromName, copyRegion, copyEndpoint, copyCap);
    if (nav === null) { return false; }
    if (window.showToast) { window.showToast('Draft created \\u2014 opening the editor', 'success'); }
    window.location.href = nav;
    return true;
  }
  if (dupForm) {
    dupForm.addEventListener('submit', function (e) {
      e.preventDefault();
      dupFieldError('name', ''); dupFieldError('default_placement_id', '');
      if (dupError) { dupError.hidden = true; dupError.textContent = ''; }
      var nameVal = dupName ? String(dupName.value || '').replace(/^\\s+|\\s+$/g, '') : '';
      var placementVal = dupPlacement ? String(dupPlacement.value || '').replace(/^\\s+|\\s+$/g, '') : '';
      var bad = false;
      if (nameVal === '') { dupFieldError('name', 'A name is required'); bad = true; }
      // §7.3: default placement id is REQUIRED — block submit when empty.
      if (placementVal === '') { dupFieldError('default_placement_id', 'A new default placement ID is required'); bad = true; }
      if (bad) { if (dupStatus) { dupStatus.textContent = 'Validation failed'; } return; }
      var copyRegion = !!(document.getElementById('lg-dup-copy-region') && document.getElementById('lg-dup-copy-region').checked);
      var copyEndpoint = !!(document.getElementById('lg-dup-copy-endpoint') && document.getElementById('lg-dup-copy-endpoint').checked);
      var copyCap = !!(document.getElementById('lg-dup-copy-cap') && document.getElementById('lg-dup-copy-cap').checked);
      var body = {
        name: nameVal,
        default_placement_id: placementVal,
        copy_region_rules: copyRegion,
        copy_cap_settings: copyCap,
        copy_endpoint_config: copyEndpoint
      };
      if (dupSubmit) { dupSubmit.disabled = true; dupSubmit.classList.add('lg-saving'); }
      if (dupStatus) { dupStatus.textContent = 'Creating draft\\u2026'; }
      getJson('POST', API + encodeURIComponent(dupTarget.id) + '/duplicate', body).then(function (res) {
        if (dupSubmit) { dupSubmit.disabled = false; dupSubmit.classList.remove('lg-saving'); }
        if (applyDuplicateResult(res, dupTarget.name, copyRegion, copyEndpoint, copyCap)) { return; }
        if (res.body && res.body.fields) {
          var k;
          for (k in res.body.fields) { if (Object.prototype.hasOwnProperty.call(res.body.fields, k)) { dupFieldError(k, res.body.fields[k]); } }
          if (dupStatus) { dupStatus.textContent = 'Validation failed'; }
          return;
        }
        if (dupError) { dupError.hidden = false; dupError.textContent = (res.body && res.body.error) || ('Error ' + res.status); }
        if (dupStatus) { dupStatus.textContent = 'Failed'; }
      }).catch(function () {
        if (dupSubmit) { dupSubmit.disabled = false; dupSubmit.classList.remove('lg-saving'); }
        if (dupError) { dupError.hidden = false; dupError.textContent = 'Network error \\u2014 the offer was not duplicated.'; }
        if (dupStatus) { dupStatus.textContent = 'Failed'; }
      });
    });
  }
  var dupCancel = document.getElementById('lg-dup-cancel');
  if (dupCancel) { dupCancel.addEventListener('click', function () { closeModal(dupModal); }); }

  // --- kebab menus ---------------------------------------------------------
  // Product-fix round (S2.4 admin-UI): ROOT-CAUSE was a stacking-context trap,
  // not a z-index magnitude problem. NOTE (L-185): no backticks in this
  // comment — this whole script is a backtick-delimited TS template literal,
  // and a literal backtick anywhere inside it (even in a comment) closes the
  // outer literal early and breaks tsc. .table--sticky-edges gives EVERY
  // row's LAST td (the actions cell housing this kebab) position:sticky,
  // z-index:1 (layout.ts) — and position:sticky ALWAYS establishes a NEW
  // stacking context. A menu that is position:absolute INSIDE that sticky
  // cell has its z-index scoped LOCALLY to that cell's own stacking context;
  // it can never outrank a DIFFERENT row's sticky cell (also z-index:1, but a
  // PEER in the table's outer stacking context) once the open menu's height
  // overflows past its own row into the row below — the later row wins on DOM
  // order at the same z-index, and its OPAQUE background (layout.ts's
  // background:var(--c-bg)) then intercepts BOTH the paint and the pointer
  // hit-test for the menu items underneath (reproduced live: Playwright's
  // click on data-offer-delete resolved to the NEXT row's td). This is the
  // EXACT bug layout.ts's kebabMenuScript already fixes for every other list
  // (sections/auctions/quotes/listicles) by reparenting the open menu to
  // body (position:fixed) on open — escaping every ancestor stacking
  // context, sticky or not, in one step. This row's own kebab now renders via
  // renderKebabOpen/KEBAB_CLOSE (generic data-kebab-toggle/data-kebab-menu/
  // data-kebab attributes) and kebabMenuScript (embedded below) owns open/
  // close/portal — never re-implemented locally. window.lgCloseKebabs is the
  // shared close-on-action hook every other list's own click script already
  // uses (ui-sections.ts et al.) — offers now matches that same idiom.
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) { return; }
    var dupBtn = t.closest('[data-offer-duplicate]');
    if (dupBtn) { if (window.lgCloseKebabs) { window.lgCloseKebabs(); } openDuplicate(dupBtn.getAttribute('data-offer-duplicate'), dupBtn.getAttribute('data-offer-name') || ''); return; }
    var delBtn = t.closest('[data-offer-delete]');
    if (delBtn) { if (window.lgCloseKebabs) { window.lgCloseKebabs(); } openDelete(delBtn.getAttribute('data-offer-delete'), delBtn.getAttribute('data-offer-name') || 'this offer'); return; }
    var archiveBtn = t.closest('[data-offer-archive]');
    if (archiveBtn) { if (window.lgCloseKebabs) { window.lgCloseKebabs(); } onArchive(archiveBtn.getAttribute('data-offer-archive'), archiveBtn.getAttribute('data-offer-name') || 'this offer'); return; }
    var usageBtn = t.closest('[data-offer-usage]');
    if (usageBtn) { if (window.lgCloseKebabs) { window.lgCloseKebabs(); } showUsage(usageBtn.getAttribute('data-offer-usage'), usageBtn.getAttribute('data-offer-name') || ''); return; }
    var usageArchive = t.closest('[data-usage-archive]');
    if (usageArchive) { window.lgUi.closeDialog(); onArchive(usageArchive.getAttribute('data-usage-archive'), usageArchive.getAttribute('data-offer-name') || 'this offer'); return; }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (dupModal && !dupModal.classList.contains('hidden')) { closeModal(dupModal); }
      if (delModal && !delModal.classList.contains('hidden')) { closeModal(delModal); }
    }
  });
  if (dupModal) { dupModal.addEventListener('click', function (e) { if (e.target === dupModal) { closeModal(dupModal); } }); }
  if (delModal) { delModal.addEventListener('click', function (e) { if (e.target === delModal) { closeModal(delModal); } }); }
}());
`;

// ---------------------------------------------------------------------------
// List page assembly + route handlers
// ---------------------------------------------------------------------------

function offersListHtml(props: OffersPageProps, brand: { userEmail?: string }): string {
  const pager = renderListPager(
    {
      page: props.paging.page,
      per_page: props.paging.page_size,
      total: props.paging.total,
    },
    {
      search: props.filters.search,
      provider: props.filters.provider,
      vertical: props.filters.vertical,
      activity: props.filters.activity,
      status: props.filters.status,
      offer_type: props.filters.offer_type,
      dynamic: props.filters.dynamic,
      range: props.filters.range,
    },
  );
  const loadErrorHtml = props.loadError
    ? `<p class="alert alert-error" role="alert">${escapeHtml(props.loadError)}</p>`
    : "";
  const content = `<div id="lg-offers-root"${props.autoOpenCreate ? ' data-autopen-create="1"' : ""}>
${renderLeadgenTabs("offers")}
${loadErrorHtml}
${renderOffersToolbar(props)}
${renderOffersTable(props)}
${pager}
${renderCreateOfferModal()}
${renderDuplicateModal()}
${renderDeleteModal()}
${renderLgDialogShell()}
</div>`;
  return leadgenPageShell({
    activePath: "/admin/leadgen/offers",
    userEmail: brand.userEmail,
    content,
    styles: LG_OFFERS_STYLES,
    scripts: kebabMenuScript + LG_SHARED_SCRIPT + LG_OFFER_MODAL_SCRIPT + LG_OFFERS_LIST_ACTIONS_SCRIPT + listFilterScript,
  });
}

async function renderOffersList(c: UiContext, autoOpenCreate: boolean): Promise<Response> {
  const timeframe = resolveTimeframe(c.req.query("range"));
  const filters: OffersPageFilters = {
    search: queryParam(c, "search"),
    provider: queryParam(c, "provider"),
    vertical: queryParam(c, "vertical"),
    activity: queryParam(c, "activity"),
    status: sanitizeEnum(queryParam(c, "status"), OFFER_STATUS_VALUES),
    offer_type: sanitizeEnum(queryParam(c, "offer_type"), LEADGEN_OFFER_TYPES),
    dynamic: sanitizeEnum(queryParam(c, "dynamic"), ["1", "0"]),
    range: timeframe.key,
  };
  const qs = buildQuery({
    search: filters.search,
    provider: filters.provider,
    vertical: filters.vertical,
    activity: filters.activity,
    status: filters.status,
    offer_type: filters.offer_type,
    dynamic: filters.dynamic,
    page: pageParam(c),
  });
  const listed = await apiJson<ListBody<OfferListItem>>(
    c.env,
    `/api/admin/leadgen/offers${qs}`,
  );
  // Vertical/activity dropdowns consume the 03 §8.2 Shared endpoints (the
  // cross-entity union), same in-process apiJson path the browser would hit;
  // a failed read degrades to an empty option list, never a page error.
  const verticals = await apiJson<{ items: string[] }>(c.env, "/api/admin/leadgen/verticals");
  const activities = await apiJson<{ items: string[] }>(c.env, "/api/admin/leadgen/activities");
  const filterOptions: OffersFilterOptions = {
    providers: await distinctOfferProviders(c.env.DB),
    verticals: verticals.ok ? verticals.body.items : [],
    activities: activities.ok ? activities.body.items : [],
  };
  return c.html(
    offersListHtml(
      {
        offers: listed.ok ? listed.body.items : [],
        paging: listed.ok ? listed.body.paging : EMPTY_PAGING,
        filters,
        filterOptions,
        timeframe,
        loadError: listed.ok ? null : listed.error,
        autoOpenCreate,
      },
      branding(c),
    ),
  );
}

// GET /admin/leadgen/offers — the live §9.2 list page.
export async function leadgenOffersListPage(c: UiContext): Promise<Response> {
  return renderOffersList(c, false);
}

// GET /admin/leadgen/offers/new — the list with the create modal auto-open
// (01 §5.2 registers both editor shells; `new` is the modal entry point).
export async function leadgenOffersNewPage(c: UiContext): Promise<Response> {
  return renderOffersList(c, true);
}

// ---------------------------------------------------------------------------
// Editor page (BINDING-RULING tab union)
// ---------------------------------------------------------------------------

type EditorTabKey =
  | "basics"
  | "static"
  | "payload"
  | "request"
  | "test"
  | "region"
  | "cap"
  | "analytics";

interface EditorTabDef {
  key: EditorTabKey;
  label: string;
  visible: (o: LeadgenOfferApi) => boolean;
}

// The conductor-resolved UNION of 03 §9.2 and 04 §10.1, conditioned on the
// §10.2 flags. Hidden tabs stay in the DOM (`hidden` attr) so the mode
// picker can reveal them live without a reload.
const EDITOR_TABS: ReadonlyArray<EditorTabDef> = [
  { key: "basics", label: "Basics", visible: () => true },
  {
    key: "static",
    label: "Static",
    visible: (o) => o.bid_source === "static" || !o.calls_provider_api,
  },
  { key: "payload", label: "Payload", visible: (o) => o.calls_provider_api },
  { key: "request", label: "Request", visible: (o) => o.calls_provider_api },
  { key: "test", label: "Test", visible: (o) => o.calls_provider_api },
  { key: "region", label: "Region rules", visible: () => true },
  { key: "cap", label: "Cap", visible: () => true },
  { key: "analytics", label: "Analytics", visible: () => true },
];

function renderEditorTabBar(offer: LeadgenOfferApi): string {
  const buttons = EDITOR_TABS.map((tab) => {
    const active = tab.key === "basics" ? " active" : "";
    const hidden = tab.visible(offer) ? "" : " hidden";
    return `<button type="button" class="lg-editor-tab${active}" data-lg-tab-btn="${tab.key}"${hidden} role="tab" aria-selected="${tab.key === "basics" ? "true" : "false"}">${escapeHtml(tab.label)}</button>`;
  }).join("");
  return `<div class="lg-editor-tabs" role="tablist" aria-label="Offer editor sections">${buttons}</div>`;
}

// One placements-editor row (03 §9.2 Basics "placement id"; the §10.1
// replace-set the editor Save PATCHes). Rows carrying a data-placement-
// public-id are PRESERVED server-side; template rows mint a new lgpl_.
// Interaction idiom mirrors the headers editor (template + data-*-field).
//
// F13: duplicated offers' extra placements carry the `__needs_value__N`
// sentinel (duplicateOfferHandler — the NOT NULL column's "blank" stand-in).
// The sentinel is an internal marker, never operator content: the input
// renders EMPTY with a "needs value" placeholder + a visible row hint. The
// row keeps its sentinel in data-placement-sentinel so an UNRELATED Save
// round-trips the pending row unchanged (collectPlacements) instead of
// silently dropping it from the replace-set; saves are never hard-blocked.
const NEEDS_VALUE_SENTINEL_RE = /^__needs_value__/;

function renderPlacementEditorRow(p: LeadgenOfferPlacementApi | null): string {
  const isSentinel = p !== null && NEEDS_VALUE_SENTINEL_RE.test(p.placement_id);
  const sentinelAttr = isSentinel && p !== null ? ` data-placement-sentinel="${escapeHtml(p.placement_id)}"` : "";
  const publicId = p !== null ? ` data-placement-public-id="${escapeHtml(p.public_id)}"` : "";
  const placementId = p !== null && !isSentinel ? escapeHtml(p.placement_id) : "";
  const placeholder = isSentinel ? "needs value" : "pl-12345";
  const label = p !== null && p.label !== null ? escapeHtml(p.label) : "";
  const checked = p !== null && p.is_default ? " checked" : "";
  const hint = isSentinel
    ? `<span class="form-error lg-placement-needs-value" data-placement-needs-value-hint role="alert">Needs a value &mdash; copied blank from the source offer; set a real placement ID.</span>`
    : "";
  return `<div class="lg-placement-row"${publicId}${sentinelAttr}>
    <input type="text" class="form-input" data-placement-field="placement_id" placeholder="${placeholder}" aria-label="Placement id" value="${placementId}" />
    <input type="text" class="form-input" data-placement-field="label" placeholder="Label (optional)" aria-label="Placement label" value="${label}" />
    <label class="form-label lg-radio"><input type="radio" name="placement_default" data-placement-field="is_default"${checked} /> Default</label>
    <button type="button" class="btn btn-sm btn-danger" data-placement-remove>Remove</button>
    ${hint}
  </div>`;
}

function renderBasicsPanel(o: OfferDetail): string {
  const placementRows = o.placements.map((p) => renderPlacementEditorRow(p)).join("");
  const mode = offerMode(o);
  const modeRadios = OFFER_MODES.map((m, index) => {
    const checked = m.value === mode ? " checked" : "";
    return `<label class="form-label lg-radio" for="lg-edit-mode-${index}"><input id="lg-edit-mode-${index}" type="radio" name="auction_mode" value="${m.value}"${checked} /> ${escapeHtml(m.label)}</label>`;
  }).join("");
  return `<section class="lg-editor-panel" data-lg-tab-panel="basics">
  <div class="card">
    <div class="card-header"><h3 class="card-title">Basics</h3></div>
    <div class="form-group">
      <label for="lg-edit-name" class="form-label">Offer name *</label>
      <input id="lg-edit-name" name="offer_name" type="text" class="form-input" required aria-required="true" value="${escapeHtml(o.offer_name)}" />
      ${fieldError("offer_name")}
    </div>
    <div class="form-group">
      <label for="lg-edit-provider" class="form-label">Provider</label>
      <input id="lg-edit-provider" name="provider" type="text" class="form-input" value="${escapeHtml(o.provider ?? "")}" />
      ${fieldError("provider")}
    </div>
    <div class="form-group">
      <label for="lg-edit-tag" class="form-label">Tag</label>
      <input id="lg-edit-tag" name="tag" type="text" class="form-input" value="${escapeHtml(o.tag ?? "")}" />
      ${fieldError("tag")}
    </div>
    <div class="form-group">
      <label for="lg-edit-activity" class="form-label">Activity *</label>
      <input id="lg-edit-activity" name="activity" type="text" class="form-input" required aria-required="true" value="${escapeHtml(o.activity)}" />
      ${fieldError("activity")}
    </div>
    <div class="form-group">
      <label for="lg-edit-vertical" class="form-label">Vertical *</label>
      <input id="lg-edit-vertical" name="vertical" type="text" class="form-input" required aria-required="true" value="${escapeHtml(o.vertical)}" />
      ${fieldError("vertical")}
    </div>
    <div class="form-group">
      <label for="lg-edit-tracking" class="form-label">Conversion tracking method</label>
      <select id="lg-edit-tracking" name="conversion_tracking_method" class="form-select">${options(LEADGEN_TRACKING_METHODS, TRACKING_METHOD_LABELS, o.conversion_tracking_method, null)}</select>
      ${fieldError("conversion_tracking_method")}
    </div>
    <div class="form-group">
      <label for="lg-edit-offer-type" class="form-label">Offer type</label>
      <select id="lg-edit-offer-type" name="offer_type" class="form-select">${options(LEADGEN_OFFER_TYPES, OFFER_TYPE_LABELS, o.offer_type, null)}</select>
      ${fieldError("offer_type")}
    </div>
    <fieldset class="form-group">
      <legend class="form-label">Auction mode (§10.2)</legend>
      ${modeRadios}
      <span class="form-help">Changing the mode reveals/hides the Static and Payload/Request/Test tabs.</span>
      ${fieldError("auction_mode")}
    </fieldset>
    <div class="form-group">
      <label for="lg-edit-status" class="form-label">Status</label>
      <select id="lg-edit-status" name="status" class="form-select">${options(OFFER_STATUS_VALUES, null, o.status, null)}</select>
      ${fieldError("status")}
    </div>
    <fieldset class="form-group">
      <legend class="form-label">Placements (§10.1 — provider placement/feed id)</legend>
      <div id="lg-placements-rows">${placementRows}</div>
      <button type="button" id="lg-placement-add" class="btn btn-sm btn-secondary">+ Add placement</button>
      <span class="form-help">At least one placement; exactly one is the default (§10.1). A placement participating in an auction cannot be removed.</span>
      ${fieldError("placements")}
    </fieldset>
  </div>
  <template id="lg-placement-editor-template">${renderPlacementEditorRow(null)}</template>
</section>`;
}

function renderStaticPanel(o: OfferDetail): string {
  const hidden = o.bid_source === "static" || !o.calls_provider_api ? "" : " hidden";
  return `<section class="lg-editor-panel" data-lg-tab-panel="static"${hidden} hidden>
  <div class="card">
    <div class="card-header"><h3 class="card-title">Static bid + banner (§10.2 / §10.5)</h3></div>
    <div class="form-group">
      <label for="lg-edit-bid-value" class="form-label">Static bid value</label>
      <input id="lg-edit-bid-value" name="static_bid_value" type="number" step="0.01" min="0" class="form-input" value="${o.static_bid_value !== null ? escapeHtml(String(o.static_bid_value)) : ""}" />
      ${fieldError("static_bid_value")}
    </div>
    <div class="form-group">
      <label for="lg-edit-bid-currency" class="form-label">Static bid currency</label>
      <select id="lg-edit-bid-currency" name="static_bid_currency" class="form-select">${options(BID_CURRENCIES, null, o.static_bid_currency ?? "", "Choose a currency…")}</select>
      ${fieldError("static_bid_currency")}
    </div>
    <div class="form-group">
      <label for="lg-edit-static-order" class="form-label">Static order</label>
      <input id="lg-edit-static-order" name="static_order" type="number" step="1" class="form-input" value="${o.static_order !== null ? escapeHtml(String(o.static_order)) : ""}" />
      ${fieldError("static_order")}
    </div>
    <div class="form-group">
      <label for="lg-edit-banner-template" class="form-label">Banner URL template (§10.5)</label>
      <textarea id="lg-edit-banner-template" name="banner_url_template" class="form-textarea" rows="2" placeholder="https://provider.example/c?cid={click_id}&amp;slug={response:slug}">${escapeHtml(o.banner_url_template ?? "")}</textarea>
      <span class="form-help">Resolves the 32 canonical macros + {response:&lt;path&gt;}. A required response macro missing at runtime drops the carrier; suffix ? marks a macro optional (e.g. {response:promo?}).</span>
      ${fieldError("banner_url_template")}
    </div>
    <div class="form-group">
      <label for="lg-edit-fallback-banner" class="form-label">Static fallback banner URL</label>
      <input id="lg-edit-fallback-banner" name="static_fallback_banner_url" type="text" class="form-input" value="${escapeHtml(o.static_fallback_banner_url ?? "")}" />
      ${fieldError("static_fallback_banner_url")}
    </div>
  </div>
</section>`;
}

// §7.5 D1: the FROZEN rule-action enum surfaces as TWO plain behaviors. New
// rows write include_only/exclude ONLY; legacy allow_list/block_list rows
// display identically (the pairs are formally declared identical — v2.4
// erratum to 04 §10.4). Labels, canonical behavior values and alias
// normalization all come from leadgen/rules.ts (REGION_RULE_ACTION_LABELS /
// REGION_RULE_BEHAVIORS) — the ONE source; nothing is inlined here.
const REGION_ACTION_BEHAVIOR_VALUES: ReadonlyArray<string> = REGION_RULE_BEHAVIORS.map(
  (behavior) => behavior.value,
);

function normalizeRegionAction(action: string): string {
  for (const behavior of REGION_RULE_BEHAVIORS) {
    if (behavior.value === action || (behavior.aliases as readonly string[]).includes(action)) {
      return behavior.value;
    }
  }
  return "";
}

// §7.5 D3 geo: Country = ISO-3166-1 alpha-2; State = code (US states + DC and
// CA provinces baseline), filtered by country. Curated + extensible — the
// server region validators (validation.ts) remain the source of truth.
const ISO_ALPHA2_COUNTRIES: ReadonlyArray<[string, string]> = [
  ["US", "United States"], ["CA", "Canada"], ["GB", "United Kingdom"], ["IE", "Ireland"],
  ["AU", "Australia"], ["NZ", "New Zealand"], ["DE", "Germany"], ["FR", "France"],
  ["ES", "Spain"], ["IT", "Italy"], ["PT", "Portugal"], ["NL", "Netherlands"],
  ["BE", "Belgium"], ["LU", "Luxembourg"], ["CH", "Switzerland"], ["AT", "Austria"],
  ["SE", "Sweden"], ["NO", "Norway"], ["DK", "Denmark"], ["FI", "Finland"],
  ["PL", "Poland"], ["CZ", "Czechia"], ["GR", "Greece"], ["RO", "Romania"],
  ["MX", "Mexico"], ["BR", "Brazil"], ["AR", "Argentina"], ["CL", "Chile"],
  ["CO", "Colombia"], ["JP", "Japan"], ["KR", "South Korea"], ["CN", "China"],
  ["HK", "Hong Kong"], ["SG", "Singapore"], ["IN", "India"], ["ID", "Indonesia"],
  ["PH", "Philippines"], ["MY", "Malaysia"], ["TH", "Thailand"], ["VN", "Vietnam"],
  ["ZA", "South Africa"], ["AE", "United Arab Emirates"], ["SA", "Saudi Arabia"],
  ["IL", "Israel"], ["TR", "Turkey"],
];

const STATES_BY_COUNTRY: Readonly<Record<string, ReadonlyArray<[string, string]>>> = {
  US: [
    ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
    ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"],
    ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"],
    ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"],
    ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
    ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
    ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"],
    ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"],
    ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
    ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"],
    ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
  ],
  CA: [
    ["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"], ["NB", "New Brunswick"],
    ["NL", "Newfoundland and Labrador"], ["NS", "Nova Scotia"], ["NT", "Northwest Territories"],
    ["NU", "Nunavut"], ["ON", "Ontario"], ["PE", "Prince Edward Island"], ["QC", "Quebec"],
    ["SK", "Saskatchewan"], ["YT", "Yukon"],
  ],
};

function renderRegionCountryOptions(): string {
  return (
    `<option value="">Country…</option>` +
    ISO_ALPHA2_COUNTRIES.map(
      ([code, name]) => `<option value="${escapeHtml(code)}">${escapeHtml(name)} (${escapeHtml(code)})</option>`,
    ).join("")
  );
}

function renderRegionStateCountryOptions(): string {
  return Object.keys(STATES_BY_COUNTRY)
    .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
    .join("");
}

// The lg-region-geo bootstrap island: states-by-country for the D3 state
// dropdown's client-side "filtered by country" rebuild + the country alpha-2
// code list, so pasted country/state tokens validate against the SAME closed
// sets the dropdowns offer (F10 — the zip path's client validation, extended
// to every closed-set dimension).
function renderRegionGeoIsland(): string {
  const json = JSON.stringify({
    countries: ISO_ALPHA2_COUNTRIES.map(([code]) => code),
    states: STATES_BY_COUNTRY,
  }).replace(/</g, "\\u003c");
  return `<script type="application/json" id="lg-region-geo">${json}</script>`;
}

// §7.5 D1/D2/D3. The row keeps a HIDDEN canonical values field (comma-joined —
// the collectRegionRules replace-set + legacy SSR contract) that the D3 chip
// editor (LG_REGION_EDITOR_SCRIPT) reads + writes. dimension drives which entry
// control is shown; action shows the two frozen behaviors; priority is labeled
// "Evaluation order".
function renderRegionRuleRow(rule: LeadgenOfferRegionRuleApi | null): string {
  const publicId = rule !== null ? ` data-rule-public-id="${escapeHtml(rule.public_id)}"` : "";
  const dimension = rule !== null ? rule.dimension : "";
  const action = rule !== null ? normalizeRegionAction(rule.action) : "";
  const values =
    rule !== null && Array.isArray(rule.values_json)
      ? rule.values_json.filter((v): v is string => typeof v === "string").join(", ")
      : "";
  const priority = rule !== null ? String(rule.priority) : "100";
  const enabled = rule === null || rule.enabled ? " checked" : "";
  const usStates = STATES_BY_COUNTRY["US"] ?? [];
  return `<div class="lg-rule-row" data-region-rule${publicId}>
    <select class="form-select" data-rule-field="dimension" aria-label="Rule dimension">${options(LEADGEN_REGION_DIMENSIONS, null, dimension, "Dimension…")}</select>
    <select class="form-select" data-rule-field="action" aria-label="Region behavior">${options(REGION_ACTION_BEHAVIOR_VALUES, REGION_RULE_ACTION_LABELS, action, "Choose a behavior…")}</select>
    <div class="lg-region-values" data-region-values>
      <input type="hidden" data-rule-field="values" value="${escapeHtml(values)}" />
      <div class="lg-chips" data-region-chips aria-live="polite"></div>
      <div class="lg-region-entry" data-region-entry>
        <select class="form-select" data-region-input="country" aria-label="Country (ISO alpha-2)" hidden>${renderRegionCountryOptions()}</select>
        <select class="form-select" data-region-state-country aria-label="State filter — country" hidden>${renderRegionStateCountryOptions()}</select>
        <select class="form-select" data-region-input="state" aria-label="State / province" hidden>${usStates.map(([code, name]) => `<option value="${escapeHtml(code)}">${escapeHtml(name)} (${escapeHtml(code)})</option>`).join("")}</select>
        <input type="text" class="form-input" data-region-input="text" placeholder="Add value…" aria-label="Region value" />
        <button type="button" class="btn btn-sm btn-secondary" data-region-add>Add</button>
        <button type="button" class="btn btn-sm btn-outline" data-region-paste-toggle>Paste multiple</button>
      </div>
      <div class="lg-region-paste" data-region-paste hidden>
        <textarea class="form-textarea" rows="3" data-region-paste-box placeholder="Paste values separated by commas or new lines" aria-label="Paste multiple region values"></textarea>
        <div><button type="button" class="btn btn-sm btn-secondary" data-region-paste-apply>Add pasted values</button></div>
      </div>
      <p class="lg-region-invalid form-error" data-region-invalid hidden></p>
    </div>
    <label class="form-help lg-region-order"><span>${escapeHtml(REGION_RULE_PRIORITY_LABEL)}</span><input type="number" class="form-input" data-rule-field="priority" step="1" min="0" aria-label="${escapeHtml(REGION_RULE_PRIORITY_LABEL)}" value="${escapeHtml(priority)}" /></label>
    <label class="form-label lg-radio"><input type="checkbox" data-rule-field="enabled"${enabled} /> Enabled</label>
    <button type="button" class="btn btn-sm btn-danger" data-rule-remove>Remove</button>
  </div>`;
}

// §7.5 / §10.4: Offer rules = PROVIDER region-block ONLY. Answer-based Offer
// participation lives in the Auction editor — the section header help draws the
// line. Priority help states the §7.5 D2 evaluation-order semantics.
function renderRegionPanel(o: OfferDetail): string {
  const rows = o.region_rules.map((r) => renderRegionRuleRow(r)).join("");
  return `<section class="lg-editor-panel" data-lg-tab-panel="region" hidden>
  <div class="card">
    <div class="card-header"><h3 class="card-title">Region rules (§10.4)</h3></div>
    <p class="form-help" data-region-scope-help>${escapeHtml(REGION_RULES_SECTION_HELP)}</p>
    <p class="form-help" data-region-order-help>${escapeHtml(REGION_RULE_PRIORITY_LABEL)}: ${escapeHtml(REGION_RULE_PRIORITY_HELP)}</p>
    <div id="lg-region-rows">${rows}</div>
    <button type="button" id="lg-region-add" class="btn btn-secondary">+ Add region rule</button>
    ${fieldError("region_rules")}
  </div>
  <template id="lg-rule-template">${renderRegionRuleRow(null)}</template>
  ${renderRegionGeoIsland()}
</section>`;
}

function renderCapPanel(o: OfferDetail, cap: OfferCapBody["cap"] | null, capError: string | null): string {
  const capChecked = o.cap_enabled ? " checked" : "";
  const capHidden = o.cap_enabled ? "" : " hidden";
  const statusCard =
    cap !== null
      ? `<div class="stat-card"><div class="stat-label">Counter for ${escapeHtml(cap.cap_date)} (${escapeHtml(cap.timezone)})</div>
      <div class="stat-value">${cap.click_count} clicks · ${cap.conversion_count} conversions</div>
      <div class="form-help">${cap.exceeded ? "CAP EXCEEDED — fallback/drop applies at auction time" : "Under cap"}</div></div>`
      : `<p class="alert alert-error" role="alert">${escapeHtml(capError ?? "Cap status unavailable")}</p>`;
  return `<section class="lg-editor-panel" data-lg-tab-panel="cap" hidden>
  <div class="card">
    <div class="card-header"><h3 class="card-title">Cap (§10.6)</h3></div>
    ${statusCard}
    <div class="form-group">
      <label for="lg-edit-cap-enabled" class="form-label"><input id="lg-edit-cap-enabled" name="cap_enabled" type="checkbox" value="1"${capChecked} /> Enable offer cap</label>
      ${fieldError("cap_enabled")}
    </div>
    <div id="lg-cap-conditional"${capHidden}>
      <div class="form-group">
        <label for="lg-edit-cap-amount" class="form-label">Cap amount *</label>
        <input id="lg-edit-cap-amount" name="cap_amount" type="number" step="1" min="1" class="form-input" value="${o.cap_amount !== null ? escapeHtml(String(o.cap_amount)) : ""}" />
        ${fieldError("cap_amount")}
      </div>
      <div class="form-group">
        <label for="lg-edit-cap-timezone" class="form-label">Cap timezone *</label>
        <select id="lg-edit-cap-timezone" name="cap_timezone" class="form-select">${options(CAP_TIMEZONES, null, o.cap_timezone ?? "", "Choose a timezone…")}</select>
        ${fieldError("cap_timezone")}
      </div>
      <div class="form-group">
        <label for="lg-edit-cap-count-by" class="form-label">Count cap by *</label>
        <select id="lg-edit-cap-count-by" name="cap_count_by" class="form-select">${options(LEADGEN_CAP_COUNT_BY, CAP_COUNT_BY_LABELS, o.cap_count_by ?? "", "Choose…")}</select>
        ${fieldError("cap_count_by")}
      </div>
      <fieldset class="form-group">
        <legend class="form-label">When capped, fall back to…</legend>
        <label for="lg-cap-fallback-search" class="form-label">Fallback offer</label>
        <input id="lg-cap-fallback-search" type="search" class="form-input" placeholder="Search active offers…" autocomplete="off" aria-label="Search fallback offers" />
        <div id="lg-cap-fallback-results" class="lg-fallback-results" hidden></div>
        <p id="lg-cap-fallback-selected" class="lg-fallback-selected" hidden></p>
        <input type="hidden" id="lg-cap-fallback-offer-id" name="cap_fallback_offer_id" value="${o.cap_fallback_offer_id !== null ? escapeHtml(String(o.cap_fallback_offer_id)) : ""}" />
        ${fieldError("cap_fallback_offer_id")}
        <label for="lg-edit-cap-fallback-url" class="form-label">Fallback URL (absolute http(s), optional)</label>
        <input id="lg-edit-cap-fallback-url" name="cap_fallback_url" type="text" class="form-input" placeholder="https://…" value="${escapeHtml(o.cap_fallback_url ?? "")}" />
        ${fieldError("cap_fallback_url")}
      </fieldset>
    </div>
  </div>
</section>`;
}

// 05 §5.1 site 1 (R4): the PERSISTENT auction-eligibility banner on DYNAMIC
// offers (calls_provider_api). Server-verdict-driven — renders the additive
// `eligibility` field off the offer GET; never re-derives rules client-side.
// Blocked → "Blocked: <operator label per reason>" + fix links into the
// schema editor (Payload) tab and the Test tab. Static offers: no banner.
function renderEligibilityBanner(o: OfferDetail): string {
  if (!o.calls_provider_api) return "";
  const verdict = o.eligibility ?? null;
  if (verdict === null) return "";
  if (verdict.eligible) {
    return `<div class="lg-eligibility-banner lg-eligible" data-eligibility-banner="eligible" role="status">Eligible for live auction</div>`;
  }
  const reasons = verdict.reasons
    .map(
      (code) =>
        `<li data-eligibility-reason="${escapeHtml(code)}">${escapeHtml(eligibilityReasonLabel(code))}</li>`,
    )
    .join("");
  return `<div class="lg-eligibility-banner lg-blocked" data-eligibility-banner="blocked" role="alert">
  <strong>Blocked from live auction:</strong>
  <ul class="lg-eligibility-reasons">${reasons}</ul>
  <div class="lg-eligibility-links">
    <button type="button" class="btn btn-sm btn-secondary" data-eligibility-fix="payload">Open Payload Schema</button>
    <button type="button" class="btn btn-sm btn-secondary" data-eligibility-fix="test">Open Test tab</button>
  </div>
</div>`;
}

// §7.3: the post-duplicate banner. Driven by the query params the duplicate
// island appends on navigation (copied/skipped = the operator's copy intent;
// pending = the response summary's blank-placement count) — server-rendered so
// it survives the full page load into the new editor.
interface DuplicatedInfo {
  from: string;
  copied: string[];
  skipped: string[];
  pending: number | null;
}

function parseDuplicatedInfo(c: UiContext): DuplicatedInfo | null {
  const from = queryParam(c, "duplicated_from");
  if (from === "") return null;
  const split = (name: string): string[] =>
    queryParam(c, name)
      .split(",")
      .map((s) => s.trim())
      .filter((s) => OFFER_COPY_DIMENSION_LABELS[s] !== undefined);
  const pendingRaw = queryParam(c, "pending");
  const pendingNum = pendingRaw === "" ? Number.NaN : Number.parseInt(pendingRaw, 10);
  return {
    from,
    copied: split("copied"),
    skipped: split("skipped"),
    pending: Number.isFinite(pendingNum) ? pendingNum : null,
  };
}

function renderDuplicatedBanner(info: DuplicatedInfo | null): string {
  if (info === null) return "";
  const lines = (keys: string[], copied: boolean): string =>
    keys
      .map(
        (k) =>
          `<li data-dup-${copied ? "copied" : "skipped"}="${escapeHtml(k)}">${escapeHtml(OFFER_COPY_DIMENSION_LABELS[k] ?? k)}: ${copied ? "copied" : "not copied"}</li>`,
      )
      .join("");
  const items = lines(info.copied, true) + lines(info.skipped, false);
  const pending =
    info.pending !== null && info.pending > 0
      ? `<li data-dup-pending="${info.pending}">${info.pending} additional placement${info.pending === 1 ? "" : "s"} copied blank &mdash; set a value before going live</li>`
      : "";
  return `<div class="lg-dup-banner" data-dup-banner role="status">
  <strong>Duplicated from ${escapeHtml(info.from)}</strong> &mdash; a new draft (test status untested; blocked from live auction until tested).
  <ul>${items}${pending}</ul>
</div>`;
}

function fmtMetricInt(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? String(Math.round(v)) : EM_DASH;
}
function fmtMetricPct(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : EM_DASH;
}
function fmtMetricDec(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(2) : EM_DASH;
}

// §10.7 read-only analytics: all nine metrics, NULL ratios render em-dashes.
function renderAnalyticsPanel(
  analytics: OfferAnalyticsBody["analytics"] | null,
  analyticsError: string | null,
  timeframe: Timeframe,
): string {
  const cards =
    analytics !== null
      ? `<p class="form-help">${escapeHtml(analytics.from)} → ${escapeHtml(analytics.to)}</p>
  <div class="stats-grid">
    <div class="stat-card"><div class="stat-label">Impressions</div><div class="stat-value">${fmtMetricInt(analytics.offer_impressions)}</div></div>
    <div class="stat-card"><div class="stat-label">Clicks</div><div class="stat-value">${fmtMetricInt(analytics.clicks)}</div></div>
    <div class="stat-card"><div class="stat-label">Unique clicks</div><div class="stat-value">${fmtMetricInt(analytics.unique_clicks)}</div></div>
    <div class="stat-card"><div class="stat-label">Conversions</div><div class="stat-value">${fmtMetricInt(analytics.conversions)}</div></div>
    <div class="stat-card"><div class="stat-label">CTR</div><div class="stat-value">${fmtMetricPct(analytics.ctr)}</div></div>
    <div class="stat-card"><div class="stat-label">CVR</div><div class="stat-value">${fmtMetricPct(analytics.cvr)}</div></div>
    <div class="stat-card"><div class="stat-label">Revenue</div><div class="stat-value">${fmtMetricDec(analytics.revenue)}</div></div>
    <div class="stat-card"><div class="stat-label">RPC</div><div class="stat-value">${fmtMetricDec(analytics.rpc)}</div></div>
    <div class="stat-card"><div class="stat-label">RPM</div><div class="stat-value">${fmtMetricDec(analytics.rpm)}</div></div>
  </div>`
      : `<p class="alert alert-error" role="alert">${escapeHtml(analyticsError ?? "Analytics unavailable")}</p>`;
  return `<section class="lg-editor-panel" data-lg-tab-panel="analytics" hidden>
  <div class="card">
    <div class="card-header"><h3 class="card-title">Analytics (§10.7 — read-only)</h3>
      <div class="toolbar-filters">${renderTimeframeSelect(timeframe.key)}</div></div>
    ${cards}
  </div>
</section>`;
}

// ---------------------------------------------------------------------------
// Editor inline script (strict ES5)
// ---------------------------------------------------------------------------
//
// Tab switching + mode-driven tab visibility, the §9.6 unsaved-changes guard,
// Save (PATCH with nested headers[]/region_rules[]/placements[] replace-sets
// — the B1 contract + the §10.1 placements editor), archive confirm, cap
// conditional + fallback picker.

const LG_EDITOR_SCRIPT = `
(function () {
  var root = document.getElementById('lg-offer-editor');
  var form = document.getElementById('lg-editor-form');
  if (!root || !form) { return; }
  var getJson = window.lgUi.getJson;
  var offerId = root.getAttribute('data-offer-public-id') || '';
  var selfNumericId = root.getAttribute('data-offer-id') || '';
  var apiUrl = '/api/admin/leadgen/offers/' + encodeURIComponent(offerId);
  var saveBtn = document.getElementById('lg-editor-save');
  var archiveBtn = document.getElementById('lg-editor-archive');
  var errEl = document.getElementById('lg-editor-error');
  var statusEl = document.getElementById('lg-editor-status');
  var dirty = false;

  var MODE_FLAGS = {
    static_no_request: { calls_provider_api: false, bid_source: 'static' },
    request_static_bid: { calls_provider_api: true, bid_source: 'static' },
    request_dynamic_bid: { calls_provider_api: true, bid_source: 'response' }
  };
  var ERROR_ALIASES = { calls_provider_api: 'auction_mode', bid_source: 'auction_mode' };

  function setTopError(msg) { if (errEl) { errEl.hidden = !msg; errEl.textContent = msg || ''; } }
  function setStatus(msg) { if (statusEl) { statusEl.textContent = msg || ''; } }
  function setFieldError(name, message) {
    var key = name;
    if (!document.querySelector('[data-error-for="' + key + '"]') && ERROR_ALIASES[key]) { key = ERROR_ALIASES[key]; }
    var el = document.querySelector('[data-error-for="' + key + '"]');
    if (el) { el.hidden = !message; el.textContent = message || ''; return true; }
    return false;
  }
  function clearFieldErrors() {
    var els = document.querySelectorAll('.form-error[data-error-for]');
    var i;
    for (i = 0; i < els.length; i++) { els[i].hidden = true; els[i].textContent = ''; }
  }
  function fieldValue(name) {
    var el = form.querySelector('[name="' + name + '"]');
    return el ? String(el.value || '') : '';
  }
  function trimmedOrNull(name) {
    var v = fieldValue(name).replace(/^\\s+|\\s+$/g, '');
    return v === '' ? null : v;
  }
  function numberOrNull(name, integer) {
    var raw = fieldValue(name).replace(/^\\s+|\\s+$/g, '');
    if (raw === '') { return null; }
    var n = integer ? parseInt(raw, 10) : parseFloat(raw);
    return isNaN(n) ? null : n;
  }
  function selectedMode() {
    var checked = form.querySelector('[name="auction_mode"]:checked');
    return checked ? checked.value : 'static_no_request';
  }

  // --- tabs + mode-driven visibility (the BINDING-RULING union) ---------------
  var TAB_VISIBILITY = {
    basics: function () { return true; },
    static: function (flags) { return flags.bid_source === 'static' || !flags.calls_provider_api; },
    payload: function (flags) { return flags.calls_provider_api; },
    request: function (flags) { return flags.calls_provider_api; },
    test: function (flags) { return flags.calls_provider_api; },
    region: function () { return true; },
    cap: function () { return true; },
    analytics: function () { return true; }
  };
  function tabButtons() { return document.querySelectorAll('[data-lg-tab-btn]'); }
  function tabPanels() { return document.querySelectorAll('[data-lg-tab-panel]'); }
  function activateTab(key) {
    var btns = tabButtons();
    var panels = tabPanels();
    var i, k;
    for (i = 0; i < btns.length; i++) {
      k = btns[i].getAttribute('data-lg-tab-btn');
      if (k === key) { btns[i].classList.add('active'); btns[i].setAttribute('aria-selected', 'true'); }
      else { btns[i].classList.remove('active'); btns[i].setAttribute('aria-selected', 'false'); }
    }
    for (i = 0; i < panels.length; i++) {
      panels[i].hidden = panels[i].getAttribute('data-lg-tab-panel') !== key;
    }
  }
  function applyModeVisibility() {
    var flags = MODE_FLAGS[selectedMode()] || MODE_FLAGS.static_no_request;
    var btns = tabButtons();
    var i, k, visible, activeHidden = false;
    for (i = 0; i < btns.length; i++) {
      k = btns[i].getAttribute('data-lg-tab-btn');
      visible = TAB_VISIBILITY[k] ? TAB_VISIBILITY[k](flags) : true;
      btns[i].hidden = !visible;
      if (!visible && btns[i].classList.contains('active')) { activeHidden = true; }
    }
    if (activeHidden) { activateTab('basics'); }
  }
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-lg-tab-btn]') : null;
    if (btn && !btn.hidden) { activateTab(btn.getAttribute('data-lg-tab-btn')); }
    // 05 5.1 eligibility-banner fix links: jump to the schema editor
    // (Payload) tab / the Test tab.
    var fix = e.target && e.target.closest ? e.target.closest('[data-eligibility-fix]') : null;
    if (fix) { activateTab(fix.getAttribute('data-eligibility-fix')); }
  });
  form.addEventListener('change', function (e) {
    if (e.target && e.target.name === 'auction_mode') { applyModeVisibility(); }
  });
  window.lgEditorTabs = { activate: activateTab };

  // --- §9.6 unsaved-changes guard -----------------------------------------------
  form.addEventListener('input', function () { dirty = true; });
  form.addEventListener('change', function () { dirty = true; });
  window.addEventListener('beforeunload', function (e) {
    if (dirty) {
      e.preventDefault();
      e.returnValue = 'You have unsaved offer changes.';
      return 'You have unsaved offer changes.';
    }
    return undefined;
  });

  // --- cap conditional + fallback picker ------------------------------------------
  var capToggle = document.getElementById('lg-edit-cap-enabled');
  var capConditional = document.getElementById('lg-cap-conditional');
  function applyCapState() {
    if (capConditional) { capConditional.hidden = !(capToggle && capToggle.checked); }
  }
  if (capToggle) { capToggle.addEventListener('change', applyCapState); }

  var fallbackSearch = document.getElementById('lg-cap-fallback-search');
  var fallbackResults = document.getElementById('lg-cap-fallback-results');
  var fallbackSelected = document.getElementById('lg-cap-fallback-selected');
  var fallbackIdInput = document.getElementById('lg-cap-fallback-offer-id');
  function clearFallbackResults() {
    if (!fallbackResults) { return; }
    while (fallbackResults.firstChild) { fallbackResults.removeChild(fallbackResults.firstChild); }
    fallbackResults.hidden = true;
  }
  function selectFallback(id, label) {
    if (fallbackIdInput) { fallbackIdInput.value = id ? String(id) : ''; }
    if (fallbackSelected) {
      while (fallbackSelected.firstChild) { fallbackSelected.removeChild(fallbackSelected.firstChild); }
      if (label) {
        fallbackSelected.appendChild(document.createTextNode('Fallback offer: ' + label + ' '));
        var clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'btn btn-sm btn-outline';
        clearBtn.setAttribute('data-fallback-clear', '');
        clearBtn.appendChild(document.createTextNode('Clear'));
        fallbackSelected.appendChild(clearBtn);
        fallbackSelected.hidden = false;
      } else {
        fallbackSelected.hidden = true;
      }
    }
    clearFallbackResults();
  }
  var searchTimer = null;
  function runFallbackSearch() {
    if (!fallbackSearch || !fallbackResults) { return; }
    var q = fallbackSearch.value || '';
    getJson('GET', '/api/admin/leadgen/offers/search?q=' + encodeURIComponent(q)).then(function (res) {
      clearFallbackResults();
      if (!res.ok || !res.body) { return; }
      var items = res.body.items || [];
      var i, o, btn, shown = 0;
      for (i = 0; i < items.length && shown < 8; i++) {
        o = items[i];
        if (String(o.id) === String(selfNumericId)) { continue; } // an offer cannot be its own fallback
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'lg-fallback-result';
        btn.setAttribute('data-fallback-offer-id', String(o.id));
        btn.setAttribute('data-fallback-offer-name', o.offer_name || '');
        btn.appendChild(document.createTextNode(
          (o.offer_name || '') + ' \\u00b7 ' + (o.provider || '') + ' \\u00b7 ' + (o.vertical || '')
        ));
        fallbackResults.appendChild(btn);
        shown++;
      }
      fallbackResults.hidden = shown === 0;
    }).catch(function () {
      clearFallbackResults();
      if (window.showToast) { window.showToast('Failed to search offers', 'error'); }
    });
  }
  if (fallbackSearch) {
    fallbackSearch.addEventListener('input', function () {
      if (searchTimer) { window.clearTimeout(searchTimer); }
      searchTimer = window.setTimeout(runFallbackSearch, 250);
    });
  }
  if (fallbackResults) {
    fallbackResults.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-fallback-offer-id]') : null;
      if (btn) {
        selectFallback(btn.getAttribute('data-fallback-offer-id'), btn.getAttribute('data-fallback-offer-name'));
        dirty = true;
      }
    });
  }
  if (fallbackSelected) {
    fallbackSelected.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-fallback-clear]') : null;
      if (btn) { selectFallback('', ''); dirty = true; }
    });
  }
  // Resolve a persisted fallback id to its display name asynchronously.
  if (fallbackIdInput && fallbackIdInput.value) {
    selectFallback(fallbackIdInput.value, 'Offer #' + fallbackIdInput.value);
    getJson('GET', '/api/admin/leadgen/offers/' + encodeURIComponent(fallbackIdInput.value)).then(function (res) {
      if (res.ok && res.body && res.body.offer_name) {
        selectFallback(res.body.id, res.body.offer_name);
      }
    }).catch(function () {
      // handled state: the 'Offer #<id>' placeholder label stands
    });
  }

  // --- region rule rows ---------------------------------------------------------------
  var regionRows = document.getElementById('lg-region-rows');
  var regionAdd = document.getElementById('lg-region-add');
  if (regionAdd && regionRows) {
    regionAdd.addEventListener('click', function () {
      var tpl = document.getElementById('lg-rule-template');
      if (tpl && tpl.content) { regionRows.appendChild(document.importNode(tpl.content, true)); }
      dirty = true;
    });
  }
  if (regionRows) {
    regionRows.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-rule-remove]') : null;
      if (btn) {
        var row = btn.closest('.lg-rule-row');
        if (row && row.parentNode) { row.parentNode.removeChild(row); }
        dirty = true;
      }
    });
  }

  // --- placement rows (§10.1 replace-set; the headers-editor idiom) ---------------------
  var placementRows = document.getElementById('lg-placements-rows');
  var placementAdd = document.getElementById('lg-placement-add');
  if (placementAdd && placementRows) {
    placementAdd.addEventListener('click', function () {
      var tpl = document.getElementById('lg-placement-editor-template');
      if (tpl && tpl.content) { placementRows.appendChild(document.importNode(tpl.content, true)); }
      dirty = true;
    });
  }
  if (placementRows) {
    placementRows.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-placement-remove]') : null;
      if (btn) {
        var row = btn.closest('.lg-placement-row');
        if (row && row.parentNode) { row.parentNode.removeChild(row); }
        dirty = true;
      }
    });
  }

  // --- collect the PATCH body (allow-listed scalars + the two replace-sets) --------------
  function collectHeaders() {
    var out = [];
    var rows = document.querySelectorAll('#lg-headers-rows .lg-header-row');
    var i, row, name, kind, value;
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      name = row.querySelector('[data-header-field="header_name"]');
      kind = row.querySelector('[data-header-field="value_kind"]');
      value = row.querySelector('[data-header-field="value_text"]');
      name = name ? String(name.value || '').replace(/^\\s+|\\s+$/g, '') : '';
      if (name === '') { continue; } // blank rows are skipped, not errors
      out.push({
        header_name: name,
        value_kind: kind ? kind.value : 'static',
        value_text: value ? String(value.value || '') : ''
      });
    }
    return out;
  }
  // §10.1 placements: rows with a data-placement-public-id are preserved
  // server-side, blank-placement_id rows are skipped (the headers idiom).
  // F13 exception: a duplicated "needs value" row (data-placement-sentinel)
  // whose input is STILL empty round-trips its sentinel placement_id, so an
  // unrelated Save keeps the pending row alive instead of silently deleting
  // it from the replace-set (typing a real value replaces the sentinel; the
  // row's Remove button deletes it deliberately). Saves are never blocked.
  // Client mirror of the server invariants — the server stays authoritative.
  function collectPlacements(errors) {
    var out = [];
    var rows = document.querySelectorAll('#lg-placements-rows .lg-placement-row');
    var i, row, pid, label, def, pub, defaults;
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      pid = row.querySelector('[data-placement-field="placement_id"]');
      label = row.querySelector('[data-placement-field="label"]');
      def = row.querySelector('[data-placement-field="is_default"]');
      pub = row.getAttribute('data-placement-public-id');
      pid = pid ? String(pid.value || '').replace(/^\\s+|\\s+$/g, '') : '';
      if (pid === '' && pub && row.getAttribute('data-placement-sentinel')) {
        pid = String(row.getAttribute('data-placement-sentinel'));
      }
      if (pid === '') { continue; }
      var item = {
        placement_id: pid,
        label: label && String(label.value || '').replace(/^\\s+|\\s+$/g, '') !== '' ? String(label.value).replace(/^\\s+|\\s+$/g, '') : null,
        is_default: !!(def && def.checked)
      };
      if (pub) { item.public_id = pub; }
      out.push(item);
    }
    if (out.length === 0) {
      errors['placements'] = 'At least one placement is required';
      return out;
    }
    defaults = 0;
    for (i = 0; i < out.length; i++) { if (out[i].is_default) { defaults++; } }
    if (defaults !== 1) { errors['placements'] = 'Exactly one placement must be the default'; }
    return out;
  }
  function collectRegionRules(errors) {
    var out = [];
    var rows = document.querySelectorAll('#lg-region-rows .lg-rule-row');
    var i, row, dimension, action, valuesRaw, priority, enabled, publicId, values, j, parts;
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      dimension = row.querySelector('[data-rule-field="dimension"]');
      action = row.querySelector('[data-rule-field="action"]');
      valuesRaw = row.querySelector('[data-rule-field="values"]');
      priority = row.querySelector('[data-rule-field="priority"]');
      enabled = row.querySelector('[data-rule-field="enabled"]');
      publicId = row.getAttribute('data-rule-public-id');
      values = [];
      parts = String(valuesRaw ? valuesRaw.value : '').split(',');
      for (j = 0; j < parts.length; j++) {
        var v = parts[j].replace(/^\\s+|\\s+$/g, '');
        if (v !== '') { values.push(v); }
      }
      if ((!dimension || dimension.value === '') && (!action || action.value === '') && values.length === 0) {
        continue; // fully blank row — skip
      }
      if (!dimension || dimension.value === '') { errors['region_rules'] = 'Every region rule needs a dimension'; }
      if (!action || action.value === '') { errors['region_rules'] = 'Every region rule needs an action'; }
      if (values.length === 0) { errors['region_rules'] = 'Every region rule needs at least one value'; }
      var rule = {
        dimension: dimension ? dimension.value : '',
        action: action ? action.value : '',
        values: values,
        priority: priority && !isNaN(parseInt(priority.value, 10)) ? parseInt(priority.value, 10) : 100,
        enabled: !!(enabled && enabled.checked)
      };
      if (publicId) { rule.public_id = publicId; }
      out.push(rule);
    }
    return out;
  }
  function collectBody(errors) {
    var flags = MODE_FLAGS[selectedMode()] || MODE_FLAGS.static_no_request;
    var capEnabled = !!(capToggle && capToggle.checked);
    var body = {
      offer_name: fieldValue('offer_name'),
      provider: trimmedOrNull('provider'),
      tag: trimmedOrNull('tag'),
      activity: fieldValue('activity'),
      vertical: fieldValue('vertical'),
      conversion_tracking_method: fieldValue('conversion_tracking_method'),
      offer_type: fieldValue('offer_type'),
      calls_provider_api: flags.calls_provider_api,
      bid_source: flags.bid_source,
      status: fieldValue('status'),
      static_bid_value: numberOrNull('static_bid_value', false),
      static_bid_currency: trimmedOrNull('static_bid_currency'),
      static_order: numberOrNull('static_order', true),
      banner_url_template: trimmedOrNull('banner_url_template'),
      static_fallback_banner_url: trimmedOrNull('static_fallback_banner_url'),
      request_method: trimmedOrNull('request_method'),
      endpoint_production: trimmedOrNull('endpoint_production'),
      endpoint_staging: trimmedOrNull('endpoint_staging'),
      request_execution_mode: (form.querySelector('[name="request_execution_mode"]:checked') || { value: 'server' }).value,
      api_token_placement: trimmedOrNull('api_token_placement'),
      api_token_param_name: trimmedOrNull('api_token_param_name'),
      api_token_secret_ref: trimmedOrNull('api_token_secret_ref'),
      cap_enabled: capEnabled,
      cap_amount: capEnabled ? numberOrNull('cap_amount', true) : null,
      cap_timezone: capEnabled ? trimmedOrNull('cap_timezone') : null,
      cap_count_by: capEnabled ? trimmedOrNull('cap_count_by') : null,
      cap_fallback_offer_id: null,
      cap_fallback_url: capEnabled ? trimmedOrNull('cap_fallback_url') : null,
      headers: collectHeaders(),
      region_rules: collectRegionRules(errors),
      placements: collectPlacements(errors)
    };
    if (capEnabled && fallbackIdInput && fallbackIdInput.value) {
      var fb = parseInt(fallbackIdInput.value, 10);
      if (!isNaN(fb) && fb > 0) { body.cap_fallback_offer_id = fb; }
    }
    return body;
  }
  function validateClient(body) {
    var errors = {};
    function requireText(key, label) {
      if (!body[key] || String(body[key]).replace(/^\\s+|\\s+$/g, '') === '') { errors[key] = label + ' is required'; }
    }
    requireText('offer_name', 'Offer name');
    requireText('activity', 'Activity');
    requireText('vertical', 'Vertical');
    if (body.cap_enabled) {
      if (body.cap_amount === null || body.cap_amount <= 0) { errors.cap_amount = 'Cap amount (a positive integer) is required when the cap is enabled'; }
      if (!body.cap_timezone) { errors.cap_timezone = 'Cap timezone is required when the cap is enabled'; }
      if (!body.cap_count_by) { errors.cap_count_by = 'Count-by is required when the cap is enabled'; }
    }
    return errors;
  }
  function renderErrors(errors) {
    clearFieldErrors();
    var keys = [];
    var k;
    for (k in errors) {
      if (Object.prototype.hasOwnProperty.call(errors, k)) { keys.push(k); }
    }
    if (keys.length === 0) { return false; }
    var i, unmatched = [];
    for (i = 0; i < keys.length; i++) {
      if (!setFieldError(keys[i], errors[keys[i]])) { unmatched.push(keys[i] + ': ' + errors[keys[i]]); }
    }
    var summary = 'Please fix the highlighted field' + (keys.length === 1 ? '' : 's') + ' (' + keys.length + ').';
    if (unmatched.length > 0) { summary += ' ' + unmatched.join(' \\u00b7 '); }
    setTopError(summary);
    setStatus('Validation failed');
    return true;
  }

  // --- Save (§9.6: disable + spinner while saving) -----------------------------------------
  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      setTopError('');
      setStatus('');
      var errors = {};
      var body = collectBody(errors);
      var clientErrors = validateClient(body);
      var k;
      for (k in clientErrors) {
        if (Object.prototype.hasOwnProperty.call(clientErrors, k)) { errors[k] = clientErrors[k]; }
      }
      if (renderErrors(errors)) { return; }
      saveBtn.disabled = true;
      saveBtn.classList.add('lg-saving');
      setStatus('Saving\\u2026');
      getJson('PATCH', apiUrl, body).then(function (res) {
        saveBtn.disabled = false;
        saveBtn.classList.remove('lg-saving');
        if (res.ok) {
          dirty = false;
          setStatus('Saved');
          window.showToast('Offer saved', 'success');
          window.setTimeout(function () { window.location.reload(); }, 600);
          return;
        }
        if (res.body && res.body.fields) {
          // §7.5: typed region_value_invalid (dimension+token) surfaces inline
          // on the offending region rule row (window.lgRegionErrors).
          if (window.lgRegionErrors) { window.lgRegionErrors(res.body.fields); }
          if (renderErrors(res.body.fields)) { setStatus('Validation failed'); return; }
        }
        setTopError((res.body && res.body.error) || ('Error ' + res.status));
        setStatus('Save failed');
      }).catch(function () {
        saveBtn.disabled = false;
        saveBtn.classList.remove('lg-saving');
        setTopError('Network error \\u2014 the offer was not saved.');
        setStatus('Save failed');
      });
    });
  }

  // --- Archive (§9.6 destructive confirm; reversible status flip) ---------------------------
  if (archiveBtn) {
    archiveBtn.addEventListener('click', function () {
      var name = root.getAttribute('data-offer-name') || 'this offer';
      if (!window.confirm('Archive offer "' + name + '"? It can be re-activated from the Basics tab.')) { return; }
      getJson('DELETE', apiUrl).then(function (res) {
        if (res.ok) {
          dirty = false;
          window.showToast('Offer archived', 'success');
          window.setTimeout(function () { window.location.reload(); }, 600);
          return;
        }
        window.showToast('Failed to archive offer' + (res.body && res.body.error ? ': ' + res.body.error : ''), 'error');
      }).catch(function () {
        window.showToast('Failed to archive offer', 'error');
      });
    });
  }

  applyCapState();
  applyModeVisibility();
  activateTab('basics');
}());
`;

// ---------------------------------------------------------------------------
// §7.5 D3 region chip editor (strict ES5) — Country/State/City/ZIP entry
// ---------------------------------------------------------------------------
//
// Progressive-enhancement island over the region-rule rows: reads + writes the
// HIDDEN canonical data-rule-field="values" input (comma-joined — the contract
// LG_EDITOR_SCRIPT.collectRegionRules consumes), so the two islands never
// couple beyond that field. Country/State come from dropdowns (State filtered
// by country via the lg-region-geo island); City/ZIP are free-text chips; ZIP
// is client-validated /^\\d{5}$/; Country/State tokens validate against the
// SAME closed sets the dropdowns use (the lg-region-geo island's alpha-2
// country list + the union of its state codes); "Paste multiple" splits on
// comma/newline with per-token validation and lists rejected tokens inline.
// window.lgRegionErrors surfaces the server's typed region_value_invalid
// (dimension+token) inline.

const LG_REGION_EDITOR_SCRIPT = `
(function () {
  var rowsHost = document.getElementById('lg-region-rows');
  if (!rowsHost) { return; }
  var geo = { states: {} };
  var geoEl = document.getElementById('lg-region-geo');
  if (geoEl) { try { geo = JSON.parse(geoEl.textContent || '{}') || { states: {} }; } catch (e) { geo = { states: {} }; } }
  if (!geo.states) { geo.states = {}; }

  var ZIP_RE = /^\\d{5}$/;

  // F10: the CLOSED sets the dropdowns are built from (lg-region-geo island):
  // country = the ISO alpha-2 list; state = the union of every per-country
  // state/province code. Pasted or typed country/state tokens must be members
  // — invalid tokens are rejected + listed exactly like the zip path.
  function buildGeoSets(g) {
    var sets = { country: {}, state: {} };
    var i, k, list;
    var countries = (g && g.countries) || [];
    for (i = 0; i < countries.length; i++) { sets.country[String(countries[i]).toUpperCase()] = true; }
    var states = (g && g.states) || {};
    for (k in states) {
      if (!Object.prototype.hasOwnProperty.call(states, k)) { continue; }
      list = states[k] || [];
      for (i = 0; i < list.length; i++) {
        if (list[i] && list[i][0] !== undefined) { sets.state[String(list[i][0]).toUpperCase()] = true; }
      }
    }
    return sets;
  }
  var geoSets = buildGeoSets(geo);

  function trim(s) { return String(s === null || s === undefined ? '' : s).replace(/^\\s+|\\s+$/g, ''); }
  function fireChange(el) {
    if (!el) { return; }
    var ev;
    if (typeof Event === 'function') { ev = new Event('change', { bubbles: true }); }
    else { ev = document.createEvent('Event'); ev.initEvent('change', true, false); }
    el.dispatchEvent(ev);
  }
  function closest(el, sel) { return el && el.closest ? el.closest(sel) : null; }
  function rowOf(el) { return closest(el, '[data-region-rule]'); }
  function hiddenOf(row) { return row ? row.querySelector('[data-rule-field="values"]') : null; }
  function chipsOf(row) { return row ? row.querySelector('[data-region-chips]') : null; }
  function dimOf(row) { var s = row ? row.querySelector('[data-rule-field="dimension"]') : null; return s ? s.value : ''; }
  function invalidOf(row) { return row ? row.querySelector('[data-region-invalid]') : null; }
  function clearInvalid(row) { var el = invalidOf(row); if (el) { el.hidden = true; el.textContent = ''; } }
  function showInvalid(row, msg) { var el = invalidOf(row); if (el) { el.hidden = false; el.textContent = msg; } }

  function valuesOf(row) {
    var h = hiddenOf(row);
    var parts = (h ? String(h.value || '') : '').split(',');
    var out = [], i, v;
    for (i = 0; i < parts.length; i++) { v = trim(parts[i]); if (v !== '') { out.push(v); } }
    return out;
  }
  function renderChips(row) {
    var host = chipsOf(row);
    if (!host) { return; }
    while (host.firstChild) { host.removeChild(host.firstChild); }
    var vals = valuesOf(row), i;
    for (i = 0; i < vals.length; i++) {
      var chip = document.createElement('span');
      chip.className = 'lg-chip';
      chip.appendChild(document.createTextNode(vals[i]));
      var x = document.createElement('button');
      x.type = 'button';
      x.setAttribute('data-region-chip-remove', vals[i]);
      x.setAttribute('aria-label', 'Remove ' + vals[i]);
      x.appendChild(document.createTextNode('\\u00d7'));
      chip.appendChild(x);
      host.appendChild(chip);
    }
  }
  function writeValues(row, vals) { var h = hiddenOf(row); if (h) { h.value = vals.join(', '); } }
  function setValues(row, vals) { writeValues(row, vals); renderChips(row); var h = hiddenOf(row); if (h) { fireChange(h); } }

  function normalizeToken(dim, token) {
    var t = trim(token);
    if (t === '') { return ''; }
    if (dim === 'country' || dim === 'state') { return t.toUpperCase(); }
    return t;
  }
  function validToken(dim, token) {
    if (token === '') { return false; }
    if (dim === 'zip') { return ZIP_RE.test(token); }
    // Country/State are closed sets (the same lists the dropdowns render);
    // tokens are already uppercased by normalizeToken. An empty set (island
    // blob missing) fails closed for these dims — the dropdowns are the
    // canonical entry path.
    if (dim === 'country') { return geoSets.country[token] === true; }
    if (dim === 'state') { return geoSets.state[token] === true; }
    return true;
  }
  function hasValue(vals, token) { var i; for (i = 0; i < vals.length; i++) { if (vals[i] === token) { return true; } } return false; }

  function addValue(row, rawToken) {
    var dim = dimOf(row);
    var token = normalizeToken(dim, rawToken);
    if (token === '') { return false; }
    if (!validToken(dim, token)) {
      showInvalid(row, 'Rejected \\u2014 "' + trim(rawToken) + '" is not a valid ' + (dim || 'value') +
        (dim === 'zip' ? ' (5 digits)' : (dim === 'country' ? ' (ISO alpha-2 code)' : (dim === 'state' ? ' (state/province code)' : ''))));
      return false;
    }
    var vals = valuesOf(row);
    if (!hasValue(vals, token)) { vals.push(token); setValues(row, vals); }
    return true;
  }

  function pasteMultiple(row) {
    var box = row.querySelector('[data-region-paste-box]');
    if (!box) { return; }
    var dim = dimOf(row);
    var tokens = String(box.value || '').split(/[,\\n\\r]+/);
    var vals = valuesOf(row);
    var i, token, norm, invalid = [];
    for (i = 0; i < tokens.length; i++) {
      token = trim(tokens[i]);
      if (token === '') { continue; }
      norm = normalizeToken(dim, token);
      if (validToken(dim, norm)) { if (!hasValue(vals, norm)) { vals.push(norm); } }
      else { invalid.push(token); }
    }
    setValues(row, vals);
    if (invalid.length > 0) { showInvalid(row, 'Rejected ' + invalid.length + ' invalid ' + (dim || 'value') + ' token(s): ' + invalid.join(', ')); }
    else { clearInvalid(row); }
    box.value = '';
  }

  function rebuildStates(row) {
    var cSel = row.querySelector('[data-region-state-country]');
    var sSel = row.querySelector('[data-region-input="state"]');
    if (!cSel || !sSel) { return; }
    var list = geo.states[cSel.value || 'US'] || [];
    while (sSel.firstChild) { sSel.removeChild(sSel.firstChild); }
    var i, opt;
    for (i = 0; i < list.length; i++) {
      opt = document.createElement('option');
      opt.value = list[i][0];
      opt.appendChild(document.createTextNode(list[i][1] + ' (' + list[i][0] + ')'));
      sSel.appendChild(opt);
    }
  }
  function show(el, on) { if (el) { el.hidden = !on; } }
  function applyDimension(row) {
    var dim = dimOf(row);
    show(row.querySelector('[data-region-input="country"]'), dim === 'country');
    show(row.querySelector('[data-region-state-country]'), dim === 'state');
    show(row.querySelector('[data-region-input="state"]'), dim === 'state');
    var text = row.querySelector('[data-region-input="text"]');
    show(text, dim === 'city' || dim === 'zip' || dim === '');
    if (text) { text.placeholder = dim === 'zip' ? '90210' : (dim === 'city' ? 'City name' : 'Add value\\u2026'); }
    if (dim === 'state') { rebuildStates(row); }
    clearInvalid(row);
  }
  function currentEntryValue(row) {
    var dim = dimOf(row), el;
    if (dim === 'country') { el = row.querySelector('[data-region-input="country"]'); }
    else if (dim === 'state') { el = row.querySelector('[data-region-input="state"]'); }
    else { el = row.querySelector('[data-region-input="text"]'); }
    return el ? el.value : '';
  }
  function clearEntry(row) { var t = row.querySelector('[data-region-input="text"]'); if (t) { t.value = ''; } }

  function initAll() {
    var list = rowsHost.querySelectorAll('[data-region-rule]');
    var i;
    for (i = 0; i < list.length; i++) { applyDimension(list[i]); renderChips(list[i]); }
  }

  rowsHost.addEventListener('click', function (e) {
    var t = e.target;
    if (!t) { return; }
    var rm = closest(t, '[data-region-chip-remove]');
    if (rm) {
      var row = rowOf(rm), token = rm.getAttribute('data-region-chip-remove');
      var vals = valuesOf(row), out = [], i;
      for (i = 0; i < vals.length; i++) { if (vals[i] !== token) { out.push(vals[i]); } }
      setValues(row, out); clearInvalid(row);
      return;
    }
    var add = closest(t, '[data-region-add]');
    if (add) { var r1 = rowOf(add); if (addValue(r1, currentEntryValue(r1))) { clearEntry(r1); } return; }
    var pt = closest(t, '[data-region-paste-toggle]');
    if (pt) { var box = rowOf(pt).querySelector('[data-region-paste]'); if (box) { box.hidden = !box.hidden; } return; }
    var pa = closest(t, '[data-region-paste-apply]');
    if (pa) { pasteMultiple(rowOf(pa)); return; }
  });
  rowsHost.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) { return; }
    if (t.getAttribute('data-rule-field') === 'dimension') { applyDimension(rowOf(t)); }
    else if (t.getAttribute('data-region-state-country') !== null) { rebuildStates(rowOf(t)); }
  });
  rowsHost.addEventListener('keydown', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) { return; }
    if (t.getAttribute('data-region-input') === 'text' && (e.key === 'Enter' || e.keyCode === 13)) {
      e.preventDefault();
      var row = rowOf(t);
      if (addValue(row, currentEntryValue(row))) { clearEntry(row); }
    }
  });
  var addRuleBtn = document.getElementById('lg-region-add');
  if (addRuleBtn) { addRuleBtn.addEventListener('click', function () { window.setTimeout(initAll, 0); }); }

  // §7.5: surface the server's typed region_value_invalid (dimension+token)
  // inline on the offending row (clears stale messages first).
  window.lgRegionErrors = function (fields) {
    var list = rowsHost.querySelectorAll('[data-region-rule]'), i;
    for (i = 0; i < list.length; i++) { clearInvalid(list[i]); }
    if (!fields) { return; }
    var k;
    for (k in fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, k)) { continue; }
      var v = fields[k], msg = '', isRegion = false, dim = '', token = '';
      if (v && typeof v === 'object') {
        if (v.code === 'region_value_invalid' || v.dimension || v.token) { isRegion = true; dim = v.dimension || ''; token = v.token || ''; }
        msg = v.message || ('Invalid ' + (dim || 'region') + ' value' + (token ? ': ' + token : ''));
      } else {
        msg = String(v === null || v === undefined ? '' : v);
        if (k.indexOf('region') !== -1 || msg.indexOf('region_value_invalid') !== -1) { isRegion = true; }
      }
      if (!isRegion) { continue; }
      var idx = -1, m = k.match(/region_rules\\[?(\\d+)\\]?/) || k.match(/\\.(\\d+)\\./);
      if (m) { idx = parseInt(m[1], 10); }
      if (idx >= 0 && list[idx]) { showInvalid(list[idx], msg); }
      else { for (i = 0; i < list.length; i++) { showInvalid(list[i], msg); } }
    }
  };

  initAll();
}());
`;

// ---------------------------------------------------------------------------
// Editor page assembly + route handler
// ---------------------------------------------------------------------------

interface EditorPageData {
  offer: OfferDetail;
  activeSchema: PayloadBuilderSchemaInfo | null;
  schemasCount: number;
  schemasError: string | null;
  cap: OfferCapBody["cap"] | null;
  capError: string | null;
  analytics: OfferAnalyticsBody["analytics"] | null;
  analyticsError: string | null;
  timeframe: Timeframe;
  duplicated: DuplicatedInfo | null;
}

function offerEditorHtml(data: EditorPageData, brand: { userEmail?: string }): string {
  const o = data.offer;
  const content = `${renderLeadgenTabs("offers")}
<div id="lg-offer-editor" data-offer-id="${o.id}" data-offer-public-id="${escapeHtml(o.public_id)}" data-offer-name="${escapeHtml(o.offer_name)}">
  <div class="lg-editor-head">
    <a href="/admin/leadgen/offers" class="btn btn-outline">&#8592; Offers</a>
    <h2 class="lg-editor-title">${escapeHtml(o.offer_name)}</h2>
    <code class="lg-editor-pubid">${escapeHtml(o.public_id)}</code>
    ${statusBadge(o.status)}
    <span class="lg-editor-spacer"></span>
    <button type="button" id="lg-editor-save" class="btn btn-primary">Save</button>
    <button type="button" id="lg-editor-archive" class="btn btn-danger"${o.status === "archived" ? " disabled" : ""}>Archive</button>
  </div>
  <p id="lg-editor-error" class="alert alert-error" hidden role="alert"></p>
  <p id="lg-editor-status" class="form-status" role="status" aria-live="polite"></p>
  ${renderDuplicatedBanner(data.duplicated)}
  ${renderEligibilityBanner(o)}
  ${renderEditorTabBar(o)}
  <form id="lg-editor-form" novalidate>
    ${renderBasicsPanel(o)}
    ${renderStaticPanel(o)}
    ${renderRequestPanel(o, o.headers)}
    ${renderRegionPanel(o)}
    ${renderCapPanel(o, data.cap, data.capError)}
  </form>
  ${renderPayloadPanel({
    offer: o,
    activeSchema: data.activeSchema,
    schemasCount: data.schemasCount,
    loadError: data.schemasError,
  })}
  ${renderTestPanel(o, data.activeSchema)}
  ${renderAnalyticsPanel(data.analytics, data.analyticsError, data.timeframe)}
</div>`;
  return leadgenPageShell({
    activePath: "/admin/leadgen/offers",
    userEmail: brand.userEmail,
    content,
    styles: LG_OFFERS_STYLES + PAYLOAD_BUILDER_STYLES,
    scripts:
      LG_SHARED_SCRIPT +
      LG_EDITOR_SCRIPT +
      LG_REGION_EDITOR_SCRIPT +
      PAYLOAD_BUILDER_SCRIPT +
      listFilterScript,
  });
}

// Mirrors listiclesSectionNotFoundPage: an in-shell 404 page, HTTP 404.
function leadgenOfferNotFoundPage(brand: { userEmail?: string }): string {
  const content = `${renderLeadgenTabs("offers")}
<div class="card"><div class="empty-state">
  <p>Offer not found.</p>
  <a href="/admin/leadgen/offers" class="btn btn-primary">Back to Offers</a>
</div></div>`;
  return leadgenPageShell({
    activePath: "/admin/leadgen/offers",
    userEmail: brand.userEmail,
    content,
    styles: LG_OFFERS_STYLES,
    scripts: LG_SHARED_SCRIPT,
  });
}

// Resolve the offer's ACTIVE payload schema from the versions list (§11.8 —
// the active pointer is offer.active_payload_schema_id; newest-first list).
// Carries the version's carrier_parse_json for the §11.6/§11.7 parse panel
// and the sample's inferred field paths (the response_field_paths mechanics,
// computed at SSR) for its pick-source chips.
function pickActiveSchema(
  offer: OfferDetail,
  items: PayloadSchemasBody["items"],
): PayloadBuilderSchemaInfo | null {
  if (items.length === 0) return null;
  const active =
    offer.active_payload_schema_id !== null
      ? items.find((s) => s.id === offer.active_payload_schema_id)
      : undefined;
  const chosen = active ?? items[0];
  if (chosen === undefined) return null;
  return {
    version: chosen.version,
    source: chosen.source,
    schema: chosen.schema_json,
    carrier_parse: chosen.carrier_parse_json ?? null,
    sample_paths:
      chosen.sample_response_json !== null && chosen.sample_response_json !== undefined
        ? inferSchemaFromExample(chosen.sample_response_json).root.children.map((node) => node.path)
        : [],
  };
}

// GET /admin/leadgen/offers/:id/edit — the full-page editor (accepts the
// numeric id or the lgo_ public id; unknown/foreign/malformed → the 404 page).
export async function leadgenOfferEditorPage(c: UiContext): Promise<Response> {
  const idParam = c.req.param("id") ?? "";
  const got = await apiJson<OfferDetail>(
    c.env,
    `/api/admin/leadgen/offers/${encodeURIComponent(idParam)}`,
  );
  if (!got.ok) {
    return c.html(leadgenOfferNotFoundPage(branding(c)), 404);
  }
  const offer = got.body;
  const timeframe = resolveTimeframe(c.req.query("range"));
  const encodedId = encodeURIComponent(offer.public_id);

  const schemas = await apiJson<PayloadSchemasBody>(
    c.env,
    `/api/admin/leadgen/offers/${encodedId}/payload-schemas`,
  );
  const cap = await apiJson<OfferCapBody>(c.env, `/api/admin/leadgen/offers/${encodedId}/cap`);
  const analytics = await apiJson<OfferAnalyticsBody>(
    c.env,
    `/api/admin/leadgen/offers/${encodedId}/analytics?from=${encodeURIComponent(timeframe.from)}&to=${encodeURIComponent(timeframe.to)}`,
  );

  return c.html(
    offerEditorHtml(
      {
        offer,
        activeSchema: schemas.ok ? pickActiveSchema(offer, schemas.body.items) : null,
        schemasCount: schemas.ok ? schemas.body.items.length : 0,
        schemasError: schemas.ok ? null : schemas.error,
        cap: cap.ok ? cap.body.cap : null,
        capError: cap.ok ? null : cap.error,
        analytics: analytics.ok ? analytics.body.analytics : null,
        analyticsError: analytics.ok ? null : analytics.error,
        timeframe,
        duplicated: parseDuplicatedInfo(c),
      },
      branding(c),
    ),
  );
}
