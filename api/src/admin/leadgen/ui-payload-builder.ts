// LeadGen Offers editor — the contract 04 §11 dynamic-payload surfaces,
// embedded in the offer editor's Payload / Request / Test tabs (Phase-4
// Stage B2). Pure server-rendered markup + ONE inline ES5 script island —
// the §9.1 "hydrate only where interaction requires it" carve-out: the
// builder tree, paste-example flow, schema save/copy/raw-JSON, header rows,
// and the §11.6 Test runner are the interactive islands.
//
//   * §11.1 manual builder — visual field tree (path/name/type/required/
//     source + per-source inputs incl. internal_field/value_map/transform),
//     live JSON preview, validation panel (client parse errors + the API's
//     typed schema_errors on save), "Test with sample answers", copy,
//     advanced raw-JSON toggle.
//   * §11.2 paste-example — POST /payload-schemas/from-example renders the
//     inferred schema back into the editable tree.
//   * §11.3–11.4 — headers (value_kind static|macro|secret_ref; the stored
//     value of a secret_ref row is the wrangler secret NAME, never a secret
//     value — §30.2), endpoints (production + staging), token placement,
//     request-execution-mode picker with the §10.3 client-mode warning.
//   * §11.6 Test tool — environment picker + sample answers → POST
//     /offers/:id/test; renders request payload / masked headers / response /
//     status / latency / parse errors / extracted carriers, plus
//     response-field macro chips with the §10.5 required-macro-without-source
//     flags. Secrets arrive pre-masked from the server ([REDACTED]).
//   * §11.1 "Test with sample answers" — the builder panel's DRY RUN:
//     POST /offers/:id/test with dry_run:true; the built payload + masked
//     headers + validation errors render inline in the Payload tab (no tab
//     switch, no outbound call, nothing persisted).
//   * §11.6/§11.7 response-parser authoring — the "Response parsing" panel
//     in the TEST tab (placement rationale on renderResponseParsingPanel):
//     edits { carriers_path, fields } over the canonical Carrier field set;
//     Save posts the builder's schema + carrier_parse_json to
//     /payload-schemas, creating the NEXT immutable version (§11.8); the
//     saved sample's inferred paths render as pick-source chips.
//
// Every dynamic interpolation goes through escapeHtml; the Test-result DOM
// is built exclusively with createElement/textContent (provider-controlled
// strings never meet innerHTML). Inline script is strict ES5.

import { escapeHtml } from "../templates/layout";
import { CANONICAL_MACROS } from "../../leadgen/macros";
import {
  LEADGEN_PAYLOAD_NODE_TYPES,
  LEADGEN_PAYLOAD_SOURCES,
} from "../../leadgen/payload";
import {
  LEADGEN_EXECUTION_MODES,
  LEADGEN_HEADER_VALUE_KINDS,
  LEADGEN_REQUEST_METHODS,
  LEADGEN_TOKEN_PLACEMENTS,
} from "../../leadgen/validation";
import type { LeadgenOfferApi, LeadgenOfferHeaderApi } from "./db-types";

// Embedded-JSON hardening: `<` can never terminate the carrier <script> tag.
export function jsonForScriptTag(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function fieldError(name: string): string {
  return `<span class="form-error" data-error-for="${name}" hidden></span>`;
}

function options(
  values: ReadonlyArray<string>,
  selected: string,
  blankLabel: string | null,
): string {
  const blank =
    blankLabel !== null ? `<option value="">${escapeHtml(blankLabel)}</option>` : "";
  const opts = values
    .map((v) => {
      const sel = v === selected ? " selected" : "";
      return `<option value="${escapeHtml(v)}"${sel}>${escapeHtml(v)}</option>`;
    })
    .join("");
  return blank + opts;
}

// ---------------------------------------------------------------------------
// §11.1 + §11.2 — Payload tab panel
// ---------------------------------------------------------------------------

export interface PayloadBuilderSchemaInfo {
  version: number;
  source: string;
  schema: unknown;
  // Parsed carrier_parse_json of the ACTIVE version (0036: the parser is a
  // COLUMN on the schema-version row, so it versions WITH the schema) — null
  // when the version carries none. Prefills the §11.6/§11.7 parse panel.
  carrier_parse: unknown;
  // Inferred field paths of the ACTIVE version's sample_response_json
  // (the §11.6 response_field_paths mechanics, computed at SSR) — the
  // pick-source chips beside the parse panel. Empty when no sample exists.
  sample_paths: readonly string[];
}

export interface PayloadPanelProps {
  offer: LeadgenOfferApi;
  activeSchema: PayloadBuilderSchemaInfo | null;
  schemasCount: number;
  loadError: string | null;
}

// One SSR'd <template> row the builder script clones per schema node —
// markup written once, rows always JS-built from the JSON state blob.
function renderNodeRowTemplate(): string {
  const sourceHelp: ReadonlyArray<{ source: string; body: string }> = [
    {
      source: "answer",
      body: `<label class="form-label">Internal field *</label>
      <input type="text" class="form-input" data-node-field="internal_field" placeholder="homeowner" />
      <label class="form-label">Value map (JSON object)</label>
      <input type="text" class="form-input" data-node-field="value_map" placeholder='{"true":true,"false":false}' />
      <label class="form-label">Transform pipeline (JSON array)</label>
      <input type="text" class="form-input" data-node-field="transform" placeholder='[{"kind":"trim"}]' />`,
    },
    {
      source: "static",
      body: `<label class="form-label">Static value (JSON or plain text) *</label>
      <input type="text" class="form-input" data-node-field="value" placeholder='"US" or 42 or true' />`,
    },
    {
      source: "computed",
      body: `<label class="form-label">Computed key *</label>
      <input type="text" class="form-input" data-node-field="computed" placeholder="request_timestamp" />`,
    },
    {
      source: "macro",
      body: `<label class="form-label">Canonical macro *</label>
      <select class="form-select" data-node-field="macro">${options(CANONICAL_MACROS, "", "Choose a macro…")}</select>`,
    },
    {
      source: "token",
      body: `<p class="form-help">API token node — the token value is resolved server-side at request time (§11.5); nothing to configure here.</p>`,
    },
  ];
  const sourceBlocks = sourceHelp
    .map(
      (s) =>
        `<div class="lg-node-source-block" data-source-only="${s.source}" hidden>${s.body}</div>`,
    )
    .join("");
  return `<template id="lg-node-template">
  <div class="lg-node-row">
    <div class="lg-node-grid">
      <div><label class="form-label">Path *</label>
        <input type="text" class="form-input" data-node-field="path" placeholder="data.home_own" /></div>
      <div><label class="form-label">Name *</label>
        <input type="text" class="form-input" data-node-field="name" placeholder="home_own" /></div>
      <div><label class="form-label">Type</label>
        <select class="form-select" data-node-field="type">${options(LEADGEN_PAYLOAD_NODE_TYPES, "string", null)}</select></div>
      <div><label class="form-label">Source</label>
        <select class="form-select" data-node-field="source">${options(LEADGEN_PAYLOAD_SOURCES, "answer", null)}</select></div>
    </div>
    <label class="form-label lg-node-required"><input type="checkbox" data-node-field="required" /> Required</label>
    ${sourceBlocks}
    <div class="lg-node-source-block" data-type-only="enum" hidden>
      <label class="form-label">Valid values (JSON array) *</label>
      <input type="text" class="form-input" data-node-field="valid_values" placeholder='["single","married"]' />
    </div>
    <details class="lg-node-advanced">
      <summary>Advanced (default / fallback / conditional)</summary>
      <div class="lg-node-grid">
        <div><label class="form-label">Default (when source absent)</label>
          <input type="text" class="form-input" data-node-field="default" /></div>
        <div><label class="form-label">Fallback (when value invalid)</label>
          <input type="text" class="form-input" data-node-field="fallback" /></div>
      </div>
      <label class="form-label">Conditional (JSON, §11.5 show/hide)</label>
      <input type="text" class="form-input" data-node-field="conditional" placeholder='{"when":"homeowner","op":"eq","value":true}' />
    </details>
    <div class="lg-node-actions"><button type="button" class="btn btn-sm btn-danger" data-node-remove>Remove field</button></div>
  </div>
</template>`;
}

// §11.1/§11.2: the Payload tab — manual builder + paste-example + preview +
// validation + save/copy/raw panels. State rides the #lg-payload-data blob;
// the builder script constructs the tree rows from it on load.
export function renderPayloadPanel(props: PayloadPanelProps): string {
  const active = props.activeSchema;
  const metaText =
    active !== null
      ? `Active schema: v${active.version} (${active.source})`
      : "No payload schema yet — build one below or paste an example.";
  const loadErrorHtml = props.loadError
    ? `<p class="alert alert-error" role="alert">${escapeHtml(props.loadError)}</p>`
    : "";
  const blob = jsonForScriptTag({
    active_schema: active,
    schemas_count: props.schemasCount,
  });
  return `<section class="lg-editor-panel" data-lg-tab-panel="payload" hidden>
  <div class="card">
    ${loadErrorHtml}
    <div class="card-header"><h3 class="card-title">Payload builder (§11.1)</h3>
      <span id="lg-payload-meta" class="form-help">${escapeHtml(metaText)}</span></div>
    <p class="form-help">Every save creates a NEW immutable schema version and makes it active (§11.8).</p>
    <details class="lg-example-panel" id="lg-example-panel">
      <summary>Paste an example provider payload (§11.2)</summary>
      <textarea id="lg-example-input" class="form-textarea" rows="6" placeholder='{"data":{"zip":"10001"},"meta":{"click_id":"abc"}}' aria-label="Example provider payload"></textarea>
      <span id="lg-example-error" class="form-error" hidden></span>
      <div class="modal-actions"><button type="button" id="lg-example-generate" class="btn btn-secondary">Generate schema from example</button></div>
    </details>
    <div class="lg-builder-grid">
      <div class="lg-builder-tree">
        <div id="lg-node-rows"></div>
        <button type="button" id="lg-node-add" class="btn btn-secondary">+ Add field</button>
      </div>
      <div class="lg-builder-side">
        <h4 class="form-label">Live JSON preview</h4>
        <pre id="lg-schema-preview" class="lg-json-pre" aria-label="Payload schema JSON preview"></pre>
        <h4 class="form-label">Validation</h4>
        <div id="lg-schema-validation" class="lg-validation-panel"><p class="form-help">No validation run yet — Save creates a version only when the schema validates (§11.8).</p></div>
      </div>
    </div>
    <div class="lg-builder-actions">
      <button type="button" id="lg-schema-save" class="btn btn-primary">Save schema version</button>
      <button type="button" id="lg-schema-copy" class="btn btn-outline">Copy JSON</button>
      <button type="button" id="lg-schema-raw-toggle" class="btn btn-outline">Advanced: raw JSON</button>
    </div>
    <div id="lg-schema-raw-wrap" hidden>
      <textarea id="lg-schema-raw" class="form-textarea" rows="10" aria-label="Raw schema JSON"></textarea>
      <span id="lg-schema-raw-error" class="form-error" hidden></span>
      <div class="modal-actions"><button type="button" id="lg-schema-raw-apply" class="btn btn-secondary">Apply raw JSON to the tree</button></div>
    </div>
    <div id="lg-dryrun-panel" class="lg-dryrun-panel">
      <h4 class="form-label">Test with sample answers (§11.1 — dry run)</h4>
      <p class="form-help">Builds the payload from the ACTIVE saved schema + your sample answers, with headers/token resolved and masked exactly like the Test tool (§11.6) — no request is sent, nothing is persisted or logged. Save the schema first to test unsaved edits.</p>
      <label for="lg-dryrun-answers" class="form-label">Sample answers (JSON object)</label>
      <textarea id="lg-dryrun-answers" class="form-textarea" rows="4" placeholder='{"zip":"10001","homeowner":true}' aria-label="Dry-run sample answers"></textarea>
      <span id="lg-dryrun-answers-error" class="form-error" hidden></span>
      <div class="modal-actions"><button type="button" id="lg-dryrun-run" class="btn btn-secondary">Test with sample answers</button></div>
      <p id="lg-dryrun-error" class="alert alert-error" hidden role="alert"></p>
      <div id="lg-dryrun-results" hidden>
        <div class="lg-test-grid">
          <div><h4 class="form-label">Built payload (masked)</h4><pre id="lg-dryrun-payload" class="lg-json-pre"></pre></div>
          <div><h4 class="form-label">Resolved headers (masked)</h4><pre id="lg-dryrun-headers" class="lg-json-pre"></pre></div>
        </div>
        <div id="lg-dryrun-notes"></div>
      </div>
    </div>
  </div>
  ${renderNodeRowTemplate()}
  <script type="application/json" id="lg-payload-data">${blob}</script>
</section>`;
}

// ---------------------------------------------------------------------------
// §11.3–11.4 + §10.3 — Request tab panel
// ---------------------------------------------------------------------------

const HEADER_KIND_HELP =
  "static = sent verbatim · macro = canonical-macro template · secret_ref = a wrangler secret NAME (the value is resolved server-side and never displayed, §30.2)";

function renderHeaderRow(header: LeadgenOfferHeaderApi | null): string {
  const name = header !== null ? escapeHtml(header.header_name) : "";
  const kind = header !== null ? header.value_kind : "static";
  const value = header !== null ? escapeHtml(header.value_text ?? "") : "";
  return `<div class="lg-header-row">
    <input type="text" class="form-input" data-header-field="header_name" placeholder="x-api-key" aria-label="Header name" value="${name}" />
    <select class="form-select" data-header-field="value_kind" aria-label="Header value kind">${options(LEADGEN_HEADER_VALUE_KINDS, kind, null)}</select>
    <input type="text" class="form-input" data-header-field="value_text" placeholder="value / {macro} / SECRET_NAME" aria-label="Header value" value="${value}" />
    <button type="button" class="btn btn-sm btn-danger" data-header-remove>Remove</button>
  </div>`;
}

// §11.3–11.4: headers + endpoints + token placement + the §10.3 execution
// mode picker. All fields feed the editor's PATCH; rows are a replace-set.
export function renderRequestPanel(
  offer: LeadgenOfferApi,
  headers: ReadonlyArray<LeadgenOfferHeaderApi>,
): string {
  const existingRows = headers.map((h) => renderHeaderRow(h)).join("");
  const clientWarningHidden = offer.request_execution_mode === "client" ? "" : " hidden";
  const modeInputs = LEADGEN_EXECUTION_MODES.map((mode) => {
    const checked = offer.request_execution_mode === mode ? " checked" : "";
    return `<label class="form-label lg-radio"><input type="radio" name="request_execution_mode" value="${mode}"${checked} /> ${mode === "server" ? "Server (default) — the Worker calls the provider; secrets resolve server-side" : "Client — the browser calls the provider (§10.3)"}</label>`;
  }).join("");
  return `<section class="lg-editor-panel" data-lg-tab-panel="request" hidden>
  <div class="card">
    <div class="card-header"><h3 class="card-title">Endpoints (§11.4)</h3></div>
    <div class="form-group">
      <label for="lg-endpoint-production" class="form-label">Production endpoint</label>
      <input id="lg-endpoint-production" name="endpoint_production" type="text" class="form-input" placeholder="https://provider.example/api/quotes" value="${escapeHtml(offer.endpoint_production ?? "")}" />
      ${fieldError("endpoint_production")}
    </div>
    <div class="form-group">
      <label for="lg-endpoint-staging" class="form-label">Staging endpoint (optional)</label>
      <input id="lg-endpoint-staging" name="endpoint_staging" type="text" class="form-input" placeholder="https://staging.provider.example/api/quotes" value="${escapeHtml(offer.endpoint_staging ?? "")}" />
      ${fieldError("endpoint_staging")}
    </div>
    <div class="form-group">
      <label for="lg-request-method" class="form-label">Request method</label>
      <select id="lg-request-method" name="request_method" class="form-select">${options(LEADGEN_REQUEST_METHODS, offer.request_method ?? "", "Default (POST)")}</select>
      ${fieldError("request_method")}
    </div>
  </div>
  <div class="card">
    <div class="card-header"><h3 class="card-title">Execution mode (§10.3)</h3></div>
    <div class="form-group">${modeInputs}${fieldError("request_execution_mode")}</div>
    <p id="lg-client-mode-warning" class="alert alert-warning"${clientWarningHidden}>Client mode: the request runs in the browser. No secret is ever exposed — remove secret_ref headers and the API token secret; endpoints must be https and CORS-enabled (validated on save).</p>
  </div>
  <div class="card">
    <div class="card-header"><h3 class="card-title">Headers (§11.3)</h3></div>
    <p class="form-help">${escapeHtml(HEADER_KIND_HELP)}</p>
    <div id="lg-headers-rows">${existingRows}</div>
    <button type="button" id="lg-header-add" class="btn btn-secondary">+ Add header</button>
    ${fieldError("headers")}
  </div>
  <div class="card">
    <div class="card-header"><h3 class="card-title">API token (§11.3)</h3></div>
    <div class="form-group">
      <label for="lg-token-placement" class="form-label">Token placement</label>
      <select id="lg-token-placement" name="api_token_placement" class="form-select">${options(LEADGEN_TOKEN_PLACEMENTS, offer.api_token_placement ?? "", "No token")}</select>
      ${fieldError("api_token_placement")}
    </div>
    <div class="form-group">
      <label for="lg-token-param" class="form-label">Header / query param name</label>
      <input id="lg-token-param" name="api_token_param_name" type="text" class="form-input" placeholder="authorization" value="${escapeHtml(offer.api_token_param_name ?? "")}" />
      ${fieldError("api_token_param_name")}
    </div>
    <div class="form-group">
      <label for="lg-token-secret" class="form-label">Token secret ref (wrangler secret name)</label>
      <input id="lg-token-secret" name="api_token_secret_ref" type="text" class="form-input" placeholder="PROVIDER_API_TOKEN" value="${escapeHtml(offer.api_token_secret_ref ?? "")}" />
      <span class="form-help">The secret NAME only — values live in Wrangler secrets and are never displayed (§30.2). Client-mode offers cannot use secret tokens (§10.3).</span>
      ${fieldError("api_token_secret_ref")}
    </div>
  </div>
  <template id="lg-header-template">${renderHeaderRow(null)}</template>
</section>`;
}

// ---------------------------------------------------------------------------
// §11.6 — Test tab panel (+ the §11.6/§11.7 response-parser authoring panel)
// ---------------------------------------------------------------------------

// The canonical Carrier field set (04 §11.7), one authoring row each. The
// identity row edits the config's `provider_id` source (it FEEDS carrier_key
// — 07 §18.8 carrier_key_source='provider_id'); carrier_key itself is
// derived, never authored.
const CARRIER_PARSE_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "provider_id", label: "Carrier key (provider_id)" },
  { key: "carrier_name", label: "Carrier name" },
  { key: "carrier_logo", label: "Carrier logo" },
  { key: "bid", label: "Bid" },
  { key: "bid_currency", label: "Bid currency" },
  { key: "click_url", label: "Click URL" },
  { key: "tracking_id", label: "Tracking id" },
  { key: "headline", label: "Headline" },
  { key: "subheadline", label: "Subheadline" },
  { key: "disclaimer", label: "Disclaimer" },
  { key: "pricing_model", label: "Pricing model" },
];

// Defensive read of the ACTIVE version's authored parse config into display
// text: a string path renders verbatim, a fallback array renders
// comma-joined (the first-wins §11.7 fallback chain).
function parseConfigDisplay(activeSchema: PayloadBuilderSchemaInfo | null): {
  carriersPath: string;
  fieldText: Record<string, string>;
} {
  const fieldText: Record<string, string> = {};
  let carriersPath = "";
  const cfg = activeSchema !== null ? activeSchema.carrier_parse : null;
  if (typeof cfg === "object" && cfg !== null && !Array.isArray(cfg)) {
    const rec = cfg as Record<string, unknown>;
    if (typeof rec["carriers_path"] === "string") carriersPath = rec["carriers_path"];
    const fields = rec["fields"];
    if (typeof fields === "object" && fields !== null && !Array.isArray(fields)) {
      for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
        if (typeof value === "string") {
          fieldText[key] = value;
        } else if (Array.isArray(value)) {
          fieldText[key] = value.filter((v): v is string => typeof v === "string").join(", ");
        }
      }
    }
  }
  return { carriersPath, fieldText };
}

// §11.6/§11.7 + 03 §9.2 "response parsing/carrier extraction". PLACEMENT
// DECISION: this panel lives in the TEST tab — §9.2's Dynamic grouping lists
// "response parsing/carrier extraction" immediately AFTER "Test tool", and
// §11.6 ties parser authoring to the sample_response_json the Test tool
// persists (its inferred field paths render here as pick-source chips). The
// Request tab is transport config (§11.3–11.4), not response semantics.
function renderResponseParsingPanel(activeSchema: PayloadBuilderSchemaInfo | null): string {
  const { carriersPath, fieldText } = parseConfigDisplay(activeSchema);
  const rows = CARRIER_PARSE_FIELDS.map((field) => {
    const value = fieldText[field.key] ?? "";
    return `<div class="lg-parse-row" data-parse-field="${field.key}">
      <span class="form-label">${escapeHtml(field.label)}</span>
      <input type="text" class="form-input" data-parse-input aria-label="${escapeHtml(field.label)} response paths" placeholder="dotted.path, fallback.path" value="${escapeHtml(value)}" />
    </div>`;
  }).join("");
  const samplePaths = activeSchema !== null ? activeSchema.sample_paths : [];
  const chips =
    samplePaths.length > 0
      ? samplePaths
          .map(
            (path) =>
              `<button type="button" class="macro-chip" data-parse-chip="${escapeHtml(path)}">${escapeHtml(path)}</button>`,
          )
          .join("")
      : `<p class="form-help">No sample response saved yet — run the Test tool; a 2xx JSON response is persisted as the sample and its field paths appear here (§11.6).</p>`;
  return `<div class="card">
    <div class="card-header"><h3 class="card-title">Response parsing (§11.6/§11.7)</h3>
      <span class="form-help">carrier_parse_json versions WITH the payload schema (§7.1 — a column on the schema-version row)</span></div>
    <p class="form-help">Maps the provider response onto the canonical Carrier fields (§11.7) before the auction/banner layer sees it. Each field takes one or more dotted paths — comma-separated, first match wins. Saving creates the NEXT immutable schema version carrying this parser (§11.8).</p>
    <div class="form-group">
      <label for="lg-parse-carriers-path" class="form-label">Carriers path</label>
      <input id="lg-parse-carriers-path" type="text" class="form-input" placeholder="carriers (empty = response root)" value="${escapeHtml(carriersPath)}" />
    </div>
    <div id="lg-parse-rows">${rows}</div>
    <h4 class="form-label">Pick-source chips (from the saved sample response)</h4>
    <p class="form-help">Click a chip to append its path to the last-focused field row (or copy it when none is focused).</p>
    <div id="lg-parse-chips" class="macro-chips">${chips}</div>
    <div class="modal-actions"><button type="button" id="lg-parse-save" class="btn btn-primary">Save response parser (new schema version)</button></div>
    <div id="lg-parse-errors"></div>
  </div>`;
}

export function renderTestPanel(
  offer: LeadgenOfferApi,
  activeSchema: PayloadBuilderSchemaInfo | null,
): string {
  const prodState = offer.endpoint_production ? "configured" : "not configured";
  const stagingState = offer.endpoint_staging ? "configured" : "not configured";
  return `<section class="lg-editor-panel" data-lg-tab-panel="test" hidden>
  <div class="card">
    <div class="card-header"><h3 class="card-title">Test tool (§11.6)</h3></div>
    <p class="form-help">Runs server-side so secrets stay masked ([REDACTED]) in everything echoed below (§30.2). A 2xx JSON response is persisted as the schema's sample response.</p>
    <div class="form-group">
      <label for="lg-test-environment" class="form-label">Environment</label>
      <select id="lg-test-environment" class="form-select">
        <option value="staging">staging (${escapeHtml(stagingState)})</option>
        <option value="production">production (${escapeHtml(prodState)})</option>
      </select>
    </div>
    <div class="form-group">
      <label for="lg-test-answers" class="form-label">Sample answers (JSON object)</label>
      <textarea id="lg-test-answers" class="form-textarea" rows="5" placeholder='{"zip":"10001","homeowner":true}'></textarea>
      <span id="lg-test-answers-error" class="form-error" hidden></span>
    </div>
    <div class="modal-actions"><button type="button" id="lg-test-run" class="btn btn-primary">Run test</button></div>
    <p id="lg-test-error" class="alert alert-error" hidden role="alert"></p>
    <div id="lg-test-results" hidden>
      <h4 class="form-label">Status</h4>
      <p id="lg-test-status-line" class="lg-test-status"></p>
      <div id="lg-test-notes"></div>
      <div class="lg-test-grid">
        <div><h4 class="form-label">Request payload sent</h4><pre id="lg-test-request-payload" class="lg-json-pre"></pre></div>
        <div><h4 class="form-label">Request headers (masked)</h4><pre id="lg-test-request-headers" class="lg-json-pre"></pre></div>
      </div>
      <h4 class="form-label">Response body</h4>
      <pre id="lg-test-response-body" class="lg-json-pre"></pre>
      <h4 class="form-label">Parse errors</h4>
      <div id="lg-test-parse-errors"></div>
      <h4 class="form-label">Extracted carriers</h4>
      <div id="lg-test-carriers"></div>
      <h4 class="form-label">Response fields (macro chips, §10.5)</h4>
      <p class="form-help">Click a chip to copy its {response:…} macro for the banner URL template.</p>
      <div id="lg-test-chips" class="macro-chips"></div>
      <div id="lg-test-macro-flags"></div>
    </div>
  </div>
  ${renderResponseParsingPanel(activeSchema)}
</section>`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

export const PAYLOAD_BUILDER_STYLES = `
.lg-builder-grid{display:grid;grid-template-columns:minmax(320px,3fr) minmax(260px,2fr);gap:16px;align-items:start}
@media (max-width:900px){.lg-builder-grid{grid-template-columns:1fr}}
.lg-node-row{border:1px solid var(--c-border);border-radius:6px;padding:12px;margin-bottom:8px;background:var(--c-bg)}
.lg-node-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:8px}
.lg-node-required{display:inline-flex;align-items:center;gap:6px;margin-bottom:8px}
.lg-node-source-block{margin-bottom:8px}
.lg-node-advanced{margin:8px 0;border:1px dashed var(--c-border);border-radius:6px;padding:6px 10px}
.lg-node-advanced>summary{cursor:pointer;font-size:12px;color:var(--c-muted)}
.lg-node-actions{display:flex;justify-content:flex-end}
.lg-json-pre{background:var(--c-bg-dark);border:1px solid var(--c-border);border-radius:6px;padding:10px;font-size:12px;max-height:320px;overflow:auto;white-space:pre-wrap;word-break:break-word}
.lg-validation-panel{border:1px solid var(--c-border);border-radius:6px;padding:10px;font-size:13px}
.lg-validation-panel .form-error{display:block}
.lg-builder-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.lg-example-panel{margin:12px 0;border:1px solid var(--c-border);border-radius:6px;padding:8px 12px}
.lg-example-panel>summary{cursor:pointer;font-weight:500}
.lg-header-row{display:grid;grid-template-columns:2fr 1fr 3fr auto;gap:8px;margin-bottom:8px;align-items:center}
@media (max-width:768px){.lg-header-row{grid-template-columns:1fr}}
.lg-radio{display:flex;align-items:center;gap:8px;font-weight:400}
.lg-test-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media (max-width:900px){.lg-test-grid{grid-template-columns:1fr}}
.lg-test-status{font-variant-numeric:tabular-nums;margin-bottom:8px}
.lg-dryrun-panel{margin-top:16px;border-top:1px solid var(--c-border);padding-top:12px}
.lg-parse-row{display:grid;grid-template-columns:200px 1fr;gap:8px;align-items:center;margin-bottom:6px}
@media (max-width:768px){.lg-parse-row{grid-template-columns:1fr}}
.lg-parse-row .form-label{margin:0}
#lg-parse-errors .form-error{display:block}
.lg-carriers-table{width:100%;border-collapse:collapse;font-size:12px}
.lg-carriers-table th,.lg-carriers-table td{padding:4px 8px;border-bottom:1px solid var(--c-border);text-align:left;word-break:break-all}
`;

// ---------------------------------------------------------------------------
// Inline script (strict ES5) — the payload/request/test interaction island
// ---------------------------------------------------------------------------
//
// Reads the offer identity from #lg-offer-editor data attributes and the
// schema state from the #lg-payload-data JSON blob. Uses window.lgUi.getJson
// (the shared leadgen fetch helper from ui-offers.ts — load order matters).

export const PAYLOAD_BUILDER_SCRIPT = `
(function () {
  var root = document.getElementById('lg-offer-editor');
  var rows = document.getElementById('lg-node-rows');
  if (!root || !rows || !window.lgUi) { return; }
  var getJson = window.lgUi.getJson;
  var offerId = root.getAttribute('data-offer-public-id') || root.getAttribute('data-offer-id') || '';
  var apiBase = '/api/admin/leadgen/offers/' + encodeURIComponent(offerId);
  var previewEl = document.getElementById('lg-schema-preview');
  var validationEl = document.getElementById('lg-schema-validation');
  var metaEl = document.getElementById('lg-payload-meta');
  var activeVersion = 0;

  function clearChildren(el) { while (el && el.firstChild) { el.removeChild(el.firstChild); } }
  function textP(parent, cls, text) {
    var p = document.createElement('p');
    if (cls) { p.className = cls; }
    p.appendChild(document.createTextNode(text));
    parent.appendChild(p);
    return p;
  }
  function copyText(text, label) {
    function done() { if (window.showToast) { window.showToast(label, 'success'); } }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {
        if (window.showToast) { window.showToast('Clipboard unavailable \\u2014 copy manually', 'warning'); }
      });
    } else if (window.showToast) {
      window.showToast('Clipboard unavailable \\u2014 copy manually', 'warning');
    }
  }

  // --- state blob -------------------------------------------------------------
  function readBlob() {
    var el = document.getElementById('lg-payload-data');
    if (!el) { return null; }
    try { return JSON.parse(el.textContent || el.innerText || 'null'); } catch (e) { return null; }
  }

  // --- node rows ---------------------------------------------------------------
  function rowField(row, name) { return row.querySelector('[data-node-field="' + name + '"]'); }

  function applySourceVisibility(row) {
    var sourceSel = rowField(row, 'source');
    var typeSel = rowField(row, 'type');
    var source = sourceSel ? sourceSel.value : 'answer';
    var type = typeSel ? typeSel.value : 'string';
    var blocks = row.querySelectorAll('[data-source-only]');
    var i;
    for (i = 0; i < blocks.length; i++) {
      blocks[i].hidden = blocks[i].getAttribute('data-source-only') !== source;
    }
    var typeBlocks = row.querySelectorAll('[data-type-only]');
    for (i = 0; i < typeBlocks.length; i++) {
      typeBlocks[i].hidden = typeBlocks[i].getAttribute('data-type-only') !== type;
    }
  }

  function setField(row, name, value) {
    var el = rowField(row, name);
    if (!el) { return; }
    if (el.type === 'checkbox') { el.checked = !!value; }
    else { el.value = value === undefined || value === null ? '' : String(value); }
  }

  // JSON-carrying row inputs render the stored JSON text form.
  function setJsonField(row, name, value) {
    if (value === undefined) { setField(row, name, ''); return; }
    try { setField(row, name, JSON.stringify(value)); } catch (e) { setField(row, name, ''); }
  }

  function addNodeRow(node) {
    var tpl = document.getElementById('lg-node-template');
    if (!tpl || !tpl.content) { return; }
    var frag = document.importNode(tpl.content, true);
    rows.appendChild(frag);
    var row = rows.lastElementChild;
    if (!row) { return; }
    if (node) {
      setField(row, 'path', node.path);
      setField(row, 'name', node.name);
      setField(row, 'type', node.type || 'string');
      setField(row, 'source', node.source || 'answer');
      setField(row, 'required', node.required === true);
      setField(row, 'internal_field', node.internal_field);
      setJsonField(row, 'value_map', node.value_map);
      setJsonField(row, 'transform', node.transform);
      setJsonField(row, 'value', node.value);
      setField(row, 'computed', node.computed);
      setField(row, 'macro', node.macro);
      setJsonField(row, 'valid_values', node.valid_values);
      setJsonField(row, 'default', node['default']);
      setJsonField(row, 'fallback', node.fallback);
      setJsonField(row, 'conditional', node.conditional);
    }
    applySourceVisibility(row);
  }

  function rebuildRows(schema) {
    clearChildren(rows);
    var children = schema && schema.root && schema.root.children;
    var i;
    if (children && children.length) {
      for (i = 0; i < children.length; i++) { addNodeRow(children[i]); }
    }
    refreshPreview();
  }

  // --- schema assembly ----------------------------------------------------------
  // value/default/fallback accept JSON first, else the raw text as a string;
  // value_map/transform/valid_values/conditional demand strict JSON.
  function looseJson(text) {
    var t = String(text || '');
    if (t.replace(/^\\s+|\\s+$/g, '') === '') { return undefined; }
    try { return JSON.parse(t); } catch (e) { return t; }
  }
  function strictJson(text, label, path, problems) {
    var t = String(text || '');
    if (t.replace(/^\\s+|\\s+$/g, '') === '') { return undefined; }
    try { return JSON.parse(t); } catch (e) {
      problems.push({ path: path, message: label + ' must be valid JSON' });
      return undefined;
    }
  }

  function buildSchema(problems) {
    var children = [];
    var rowEls = rows.querySelectorAll('.lg-node-row');
    var i, row, node, path, source, v;
    for (i = 0; i < rowEls.length; i++) {
      row = rowEls[i];
      path = (rowField(row, 'path') ? rowField(row, 'path').value : '').replace(/^\\s+|\\s+$/g, '');
      source = rowField(row, 'source') ? rowField(row, 'source').value : 'answer';
      node = {
        path: path,
        name: (rowField(row, 'name') ? rowField(row, 'name').value : '').replace(/^\\s+|\\s+$/g, ''),
        type: rowField(row, 'type') ? rowField(row, 'type').value : 'string',
        source: source
      };
      if (rowField(row, 'required') && rowField(row, 'required').checked) { node.required = true; }
      if (source === 'answer') {
        v = (rowField(row, 'internal_field') ? rowField(row, 'internal_field').value : '').replace(/^\\s+|\\s+$/g, '');
        if (v !== '') { node.internal_field = v; }
        v = strictJson(rowField(row, 'value_map') && rowField(row, 'value_map').value, 'value_map', path, problems);
        if (v !== undefined) { node.value_map = v; }
        v = strictJson(rowField(row, 'transform') && rowField(row, 'transform').value, 'transform', path, problems);
        if (v !== undefined) { node.transform = v; }
      } else if (source === 'static') {
        v = looseJson(rowField(row, 'value') && rowField(row, 'value').value);
        if (v !== undefined) { node.value = v; }
      } else if (source === 'computed') {
        v = (rowField(row, 'computed') ? rowField(row, 'computed').value : '').replace(/^\\s+|\\s+$/g, '');
        if (v !== '') { node.computed = v; }
      } else if (source === 'macro') {
        v = rowField(row, 'macro') ? rowField(row, 'macro').value : '';
        if (v !== '') { node.macro = v; }
      }
      if (node.type === 'enum') {
        v = strictJson(rowField(row, 'valid_values') && rowField(row, 'valid_values').value, 'valid_values', path, problems);
        if (v !== undefined) { node.valid_values = v; }
      }
      v = looseJson(rowField(row, 'default') && rowField(row, 'default').value);
      if (v !== undefined) { node['default'] = v; }
      v = looseJson(rowField(row, 'fallback') && rowField(row, 'fallback').value);
      if (v !== undefined) { node.fallback = v; }
      v = strictJson(rowField(row, 'conditional') && rowField(row, 'conditional').value, 'conditional', path, problems);
      if (v !== undefined) { node.conditional = v; }
      children.push(node);
    }
    return { version: activeVersion > 0 ? activeVersion : 1, root: { type: 'object', children: children } };
  }

  function refreshPreview() {
    if (!previewEl) { return; }
    var problems = [];
    var schema = buildSchema(problems);
    previewEl.textContent = JSON.stringify(schema, null, 2);
    var raw = document.getElementById('lg-schema-raw');
    var wrap = document.getElementById('lg-schema-raw-wrap');
    if (raw && wrap && !wrap.hidden) { raw.value = previewEl.textContent; }
    return schema;
  }

  function renderValidation(entries, okText) {
    if (!validationEl) { return; }
    clearChildren(validationEl);
    if (!entries || entries.length === 0) {
      textP(validationEl, 'form-help', okText || 'Schema is valid.');
      return;
    }
    var i, e, label;
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      label = (e.code ? '[' + e.code + '] ' : '') + (e.path ? e.path + ': ' : '') + (e.message || '');
      textP(validationEl, 'form-error', label);
    }
  }

  // --- wire the tree -------------------------------------------------------------
  rows.addEventListener('change', function (e) {
    var t = e.target;
    var row = t && t.closest ? t.closest('.lg-node-row') : null;
    if (row && t.getAttribute('data-node-field') === 'source') { applySourceVisibility(row); }
    if (row && t.getAttribute('data-node-field') === 'type') { applySourceVisibility(row); }
    refreshPreview();
  });
  rows.addEventListener('input', function () { refreshPreview(); });
  rows.addEventListener('click', function (e) {
    var t = e.target;
    var btn = t && t.closest ? t.closest('[data-node-remove]') : null;
    if (btn) {
      var row = btn.closest('.lg-node-row');
      if (row && row.parentNode) { row.parentNode.removeChild(row); }
      refreshPreview();
    }
  });
  var addBtn = document.getElementById('lg-node-add');
  if (addBtn) {
    addBtn.addEventListener('click', function () {
      addNodeRow(null);
      refreshPreview();
    });
  }

  // --- save a schema version (§11.8) ----------------------------------------------
  var saveBtn = document.getElementById('lg-schema-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      var problems = [];
      var schema = buildSchema(problems);
      if (problems.length > 0) { renderValidation(problems); return; }
      saveBtn.disabled = true;
      saveBtn.classList.add('lg-saving');
      getJson('POST', apiBase + '/payload-schemas', { schema_json: schema }).then(function (res) {
        saveBtn.disabled = false;
        saveBtn.classList.remove('lg-saving');
        if (res.ok && res.body && res.body.version) {
          activeVersion = res.body.version;
          if (metaEl) { metaEl.textContent = 'Active schema: v' + res.body.version + ' (' + (res.body.source || 'manual') + ')'; }
          renderValidation([], 'Schema is valid \\u2014 saved as v' + res.body.version + ' (now active).');
          if (window.showToast) { window.showToast('Payload schema v' + res.body.version + ' saved', 'success'); }
          refreshPreview();
          return;
        }
        var entries = (res.body && res.body.schema_errors) || [];
        if (entries.length === 0 && res.body && res.body.error) {
          entries = [{ message: res.body.error }];
        }
        renderValidation(entries);
        if (window.showToast) { window.showToast('Schema not saved \\u2014 fix validation errors', 'error'); }
      }).catch(function () {
        saveBtn.disabled = false;
        saveBtn.classList.remove('lg-saving');
        renderValidation([{ message: 'Network error \\u2014 the schema was not saved.' }]);
      });
    });
  }

  // --- §11.2 paste-example -----------------------------------------------------------
  var exampleBtn = document.getElementById('lg-example-generate');
  if (exampleBtn) {
    exampleBtn.addEventListener('click', function () {
      var input = document.getElementById('lg-example-input');
      var errEl = document.getElementById('lg-example-error');
      var raw = input ? input.value : '';
      if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
      if (String(raw).replace(/^\\s+|\\s+$/g, '') === '') {
        if (errEl) { errEl.hidden = false; errEl.textContent = 'Paste an example payload first.'; }
        return;
      }
      exampleBtn.disabled = true;
      getJson('POST', apiBase + '/payload-schemas/from-example', { example: raw }).then(function (res) {
        exampleBtn.disabled = false;
        if (res.ok && res.body && res.body.schema_json) {
          activeVersion = res.body.version || activeVersion;
          rebuildRows(res.body.schema_json);
          if (metaEl) { metaEl.textContent = 'Active schema: v' + res.body.version + ' (auto_from_example)'; }
          renderValidation([], 'Schema v' + res.body.version + ' generated from the example \\u2014 edit and save to create the next version.');
          if (window.showToast) { window.showToast('Schema generated from example', 'success'); }
          return;
        }
        var msg = (res.body && res.body.fields && res.body.fields.example) || (res.body && res.body.error) || 'Failed to generate schema';
        if (errEl) { errEl.hidden = false; errEl.textContent = msg; }
      }).catch(function () {
        exampleBtn.disabled = false;
        if (errEl) { errEl.hidden = false; errEl.textContent = 'Network error \\u2014 nothing was generated.'; }
      });
    });
  }

  // --- copy / raw JSON ------------------------------------------------------------------
  var copyBtn = document.getElementById('lg-schema-copy');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      copyText(previewEl ? previewEl.textContent : '', 'Schema JSON copied');
    });
  }
  var rawToggle = document.getElementById('lg-schema-raw-toggle');
  if (rawToggle) {
    rawToggle.addEventListener('click', function () {
      var wrap = document.getElementById('lg-schema-raw-wrap');
      var raw = document.getElementById('lg-schema-raw');
      if (!wrap) { return; }
      wrap.hidden = !wrap.hidden;
      if (!wrap.hidden && raw && previewEl) { raw.value = previewEl.textContent; }
    });
  }
  var rawApply = document.getElementById('lg-schema-raw-apply');
  if (rawApply) {
    rawApply.addEventListener('click', function () {
      var raw = document.getElementById('lg-schema-raw');
      var errEl = document.getElementById('lg-schema-raw-error');
      if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
      var parsed = null;
      try { parsed = JSON.parse(raw ? raw.value : ''); } catch (e) { parsed = null; }
      if (!parsed || !parsed.root || Object.prototype.toString.call(parsed.root.children) !== '[object Array]') {
        if (errEl) { errEl.hidden = false; errEl.textContent = 'Raw JSON must be a schema object with root.children[] (§11.5).'; }
        return;
      }
      rebuildRows(parsed);
      if (window.showToast) { window.showToast('Raw JSON applied to the tree', 'success'); }
    });
  }
  // --- §11.1 "Test with sample answers" (dry run — inline, no tab switch) -----
  // POSTs dry_run:true to the §11.6 endpoint: the payload is built and
  // headers/token resolved+masked exactly like a real test, but nothing is
  // sent, persisted or logged. Results + validation errors render right here
  // in the Payload tab.
  var dryrunBtn = document.getElementById('lg-dryrun-run');
  if (dryrunBtn) {
    dryrunBtn.addEventListener('click', function () {
      var answersEl = document.getElementById('lg-dryrun-answers');
      var answersErr = document.getElementById('lg-dryrun-answers-error');
      var topErr = document.getElementById('lg-dryrun-error');
      var results = document.getElementById('lg-dryrun-results');
      if (answersErr) { answersErr.hidden = true; answersErr.textContent = ''; }
      if (topErr) { topErr.hidden = true; topErr.textContent = ''; }
      if (results) { results.hidden = true; }
      var answers = {};
      var raw = answersEl ? String(answersEl.value || '') : '';
      if (raw.replace(/^\\s+|\\s+$/g, '') !== '') {
        try { answers = JSON.parse(raw); } catch (e) { answers = null; }
        if (answers === null || typeof answers !== 'object' || Object.prototype.toString.call(answers) === '[object Array]') {
          if (answersErr) { answersErr.hidden = false; answersErr.textContent = 'Sample answers must be a JSON object.'; }
          return;
        }
      }
      var envSel = document.getElementById('lg-test-environment');
      dryrunBtn.disabled = true;
      dryrunBtn.classList.add('lg-saving');
      getJson('POST', apiBase + '/test', {
        environment: envSel ? envSel.value : 'staging',
        sample_answers: answers,
        dry_run: true
      }).then(function (res) {
        dryrunBtn.disabled = false;
        dryrunBtn.classList.remove('lg-saving');
        if (!res.ok || !res.body) {
          var msg = 'Dry run failed (HTTP ' + res.status + ')';
          if (res.body && res.body.fields) {
            var k, parts = [];
            for (k in res.body.fields) {
              if (Object.prototype.hasOwnProperty.call(res.body.fields, k)) { parts.push(k + ': ' + res.body.fields[k]); }
            }
            if (parts.length > 0) { msg = parts.join(' \\u00b7 '); }
          } else if (res.body && res.body.error) { msg = res.body.error; }
          if (topErr) { topErr.hidden = false; topErr.textContent = msg; }
          return;
        }
        if (results) { results.hidden = false; }
        renderPre('lg-dryrun-payload', res.body.request ? res.body.request.payload : null);
        renderPre('lg-dryrun-headers', res.body.request ? res.body.request.headers : null);
        renderNotes('lg-dryrun-notes', res.body.notes || []);
      }).catch(function () {
        dryrunBtn.disabled = false;
        dryrunBtn.classList.remove('lg-saving');
        if (topErr) { topErr.hidden = false; topErr.textContent = 'Network error \\u2014 the dry run did not run.'; }
      });
    });
  }

  // --- request tab: header rows + client-mode warning --------------------------------------
  var headersRows = document.getElementById('lg-headers-rows');
  var headerAdd = document.getElementById('lg-header-add');
  if (headerAdd && headersRows) {
    headerAdd.addEventListener('click', function () {
      var tpl = document.getElementById('lg-header-template');
      if (tpl && tpl.content) { headersRows.appendChild(document.importNode(tpl.content, true)); }
    });
  }
  if (headersRows) {
    headersRows.addEventListener('click', function (e) {
      var t = e.target;
      var btn = t && t.closest ? t.closest('[data-header-remove]') : null;
      if (btn) {
        var row = btn.closest('.lg-header-row');
        if (row && row.parentNode) { row.parentNode.removeChild(row); }
      }
    });
  }
  var editorForm = document.getElementById('lg-editor-form');
  if (editorForm) {
    editorForm.addEventListener('change', function (e) {
      var t = e.target;
      if (t && t.name === 'request_execution_mode') {
        var warning = document.getElementById('lg-client-mode-warning');
        if (warning) { warning.hidden = t.value !== 'client'; }
      }
    });
  }

  // --- §11.6 Test runner ----------------------------------------------------------------------
  var runBtn = document.getElementById('lg-test-run');

  // Shared by the §11.6 runner (lg-test-notes) and the §11.1 dry run
  // (lg-dryrun-notes) — same typed §30.2 no-op notes, two containers.
  function renderNotes(boxId, notes) {
    var box = document.getElementById(boxId);
    if (!box) { return; }
    clearChildren(box);
    var i;
    for (i = 0; i < (notes || []).length; i++) {
      textP(box, 'alert alert-warning', '[' + notes[i].scope + '/' + notes[i].code + '] ' + (notes[i].message || ''));
    }
  }

  function renderPre(id, value) {
    var el = document.getElementById(id);
    if (!el) { return; }
    el.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }

  function renderParseErrors(errors) {
    var box = document.getElementById('lg-test-parse-errors');
    if (!box) { return; }
    clearChildren(box);
    if (!errors || errors.length === 0) {
      textP(box, 'form-help', 'No parse errors.');
      return;
    }
    var i;
    for (i = 0; i < errors.length; i++) {
      textP(box, 'form-error', JSON.stringify(errors[i]));
    }
  }

  var CARRIER_COLUMNS = ['carrier_key', 'carrier_name', 'bid', 'bid_currency', 'click_url', 'pricing_model'];

  function renderCarriers(carriers) {
    var box = document.getElementById('lg-test-carriers');
    if (!box) { return; }
    clearChildren(box);
    if (!carriers || carriers.length === 0) {
      textP(box, 'form-help', 'No carriers extracted.');
      return;
    }
    var table = document.createElement('table');
    table.className = 'lg-carriers-table';
    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    var i, j, th, tr, td, v;
    for (i = 0; i < CARRIER_COLUMNS.length; i++) {
      th = document.createElement('th');
      th.appendChild(document.createTextNode(CARRIER_COLUMNS[i]));
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    for (i = 0; i < carriers.length; i++) {
      tr = document.createElement('tr');
      for (j = 0; j < CARRIER_COLUMNS.length; j++) {
        td = document.createElement('td');
        v = carriers[i] ? carriers[i][CARRIER_COLUMNS[j]] : undefined;
        td.appendChild(document.createTextNode(v === undefined || v === null ? '\\u2014' : String(v)));
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    box.appendChild(table);
  }

  // §10.5: chips for every discovered response field; flag REQUIRED
  // {response:path} macros in the banner template with no source among them.
  function renderChips(paths) {
    var box = document.getElementById('lg-test-chips');
    var flags = document.getElementById('lg-test-macro-flags');
    if (!box) { return; }
    clearChildren(box);
    if (flags) { clearChildren(flags); }
    var i, chip;
    if (!paths || paths.length === 0) {
      textP(box, 'form-help', 'No response fields discovered (non-JSON or empty response).');
    } else {
      for (i = 0; i < paths.length; i++) {
        chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'macro-chip';
        chip.setAttribute('data-response-macro', paths[i]);
        chip.appendChild(document.createTextNode('{response:' + paths[i] + '}'));
        box.appendChild(chip);
      }
    }
    var bannerInput = document.querySelector('[name="banner_url_template"]');
    var template = bannerInput ? String(bannerInput.value || '') : '';
    var re = /\\{response:([A-Za-z0-9_.]+)(\\??)\\}/g;
    var m, required = [];
    while ((m = re.exec(template)) !== null) {
      if (m[2] !== '?' && required.indexOf(m[1]) === -1) { required.push(m[1]); }
    }
    var have = {};
    for (i = 0; i < (paths || []).length; i++) { have[paths[i]] = 1; }
    for (i = 0; i < required.length; i++) {
      if (!have[required[i]] && flags) {
        textP(flags, 'form-error', 'Required response macro {response:' + required[i] + '} has no source in the last test response (§10.5) \\u2014 the carrier would be dropped at runtime.');
      }
    }
  }

  var chipsBox = document.getElementById('lg-test-chips');
  if (chipsBox) {
    chipsBox.addEventListener('click', function (e) {
      var chip = e.target && e.target.closest ? e.target.closest('[data-response-macro]') : null;
      if (!chip) { return; }
      var token = '{response:' + chip.getAttribute('data-response-macro') + '}';
      copyText(token, 'Copied ' + token);
    });
  }

  if (runBtn) {
    runBtn.addEventListener('click', function () {
      var envSel = document.getElementById('lg-test-environment');
      var answersEl = document.getElementById('lg-test-answers');
      var answersErr = document.getElementById('lg-test-answers-error');
      var topErr = document.getElementById('lg-test-error');
      var results = document.getElementById('lg-test-results');
      if (answersErr) { answersErr.hidden = true; answersErr.textContent = ''; }
      if (topErr) { topErr.hidden = true; topErr.textContent = ''; }
      var answers = {};
      var raw = answersEl ? String(answersEl.value || '') : '';
      if (raw.replace(/^\\s+|\\s+$/g, '') !== '') {
        try { answers = JSON.parse(raw); } catch (e) { answers = null; }
        if (answers === null || typeof answers !== 'object' || Object.prototype.toString.call(answers) === '[object Array]') {
          if (answersErr) { answersErr.hidden = false; answersErr.textContent = 'Sample answers must be a JSON object.'; }
          return;
        }
      }
      runBtn.disabled = true;
      runBtn.classList.add('lg-saving');
      getJson('POST', apiBase + '/test', {
        environment: envSel ? envSel.value : 'staging',
        sample_answers: answers
      }).then(function (res) {
        runBtn.disabled = false;
        runBtn.classList.remove('lg-saving');
        if (!res.ok || !res.body) {
          var msg = 'Test failed (HTTP ' + res.status + ')';
          if (res.body && res.body.fields) {
            var k, parts = [];
            for (k in res.body.fields) {
              if (Object.prototype.hasOwnProperty.call(res.body.fields, k)) { parts.push(k + ': ' + res.body.fields[k]); }
            }
            if (parts.length > 0) { msg = parts.join(' \\u00b7 '); }
          } else if (res.body && res.body.error) { msg = res.body.error; }
          if (topErr) { topErr.hidden = false; topErr.textContent = msg; }
          return;
        }
        var body = res.body;
        if (results) { results.hidden = false; }
        var statusLine = document.getElementById('lg-test-status-line');
        if (statusLine) {
          statusLine.textContent =
            (body.method || '') + ' ' + (body.endpoint || '') +
            ' \\u2192 status ' + (body.response && body.response.status !== null ? body.response.status : 'n/a') +
            ' \\u00b7 ' + (body.response ? body.response.latency_ms : '?') + ' ms' +
            (body.provider_error_reason ? ' \\u00b7 ' + body.provider_error_reason : '');
        }
        renderNotes('lg-test-notes', body.notes || []);
        renderPre('lg-test-request-payload', body.request ? body.request.payload : null);
        renderPre('lg-test-request-headers', body.request ? body.request.headers : null);
        renderPre('lg-test-response-body', body.response ? body.response.body : null);
        renderParseErrors(body.parse ? body.parse.errors : []);
        renderCarriers(body.parse ? body.parse.carriers : []);
        renderChips(body.response_field_paths || []);
      }).catch(function () {
        runBtn.disabled = false;
        runBtn.classList.remove('lg-saving');
        if (topErr) { topErr.hidden = false; topErr.textContent = 'Network error \\u2014 the test did not run.'; }
      });
    });
  }

  // --- §11.6/§11.7 response-parser authoring ------------------------------------------------
  // Save = the SAME §11.8 versioning path as the schema Save button (the
  // parser is a column on the schema-version row): the builder tree +
  // carrier_parse_json ride one POST that creates the next active version.
  var parseRowsBox = document.getElementById('lg-parse-rows');
  var parseErrorsBox = document.getElementById('lg-parse-errors');
  var lastParseInput = null;
  if (parseRowsBox) {
    parseRowsBox.addEventListener('focusin', function (e) {
      var t = e.target;
      if (t && t.hasAttribute && t.hasAttribute('data-parse-input')) { lastParseInput = t; }
    });
  }
  var parseChips = document.getElementById('lg-parse-chips');
  if (parseChips) {
    parseChips.addEventListener('click', function (e) {
      var chip = e.target && e.target.closest ? e.target.closest('[data-parse-chip]') : null;
      if (!chip) { return; }
      var path = chip.getAttribute('data-parse-chip') || '';
      if (lastParseInput) {
        var current = String(lastParseInput.value || '').replace(/^\\s+|\\s+$/g, '');
        lastParseInput.value = current === '' ? path : current + ', ' + path;
        lastParseInput.focus();
      } else {
        copyText(path, 'Copied ' + path);
      }
    });
  }
  function renderParserSaveErrors(entries) {
    if (!parseErrorsBox) { return; }
    clearChildren(parseErrorsBox);
    var i, e, label;
    for (i = 0; i < (entries || []).length; i++) {
      e = entries[i];
      label = (e.code ? '[' + e.code + '] ' : '') + (e.path ? e.path + ': ' : '') + (e.message || '');
      textP(parseErrorsBox, 'form-error', label);
    }
  }
  // { carriers_path?, fields } — a comma-separated row becomes the §11.7
  // first-wins fallback array; a single path stays a string.
  function buildParseConfig() {
    var fields = {};
    var mapped = 0;
    var rowEls = parseRowsBox ? parseRowsBox.querySelectorAll('.lg-parse-row') : [];
    var i, j, key, input, parts, list, piece;
    for (i = 0; i < rowEls.length; i++) {
      key = rowEls[i].getAttribute('data-parse-field');
      input = rowEls[i].querySelector('[data-parse-input]');
      parts = String(input ? input.value : '').split(',');
      list = [];
      for (j = 0; j < parts.length; j++) {
        piece = parts[j].replace(/^\\s+|\\s+$/g, '');
        if (piece !== '') { list.push(piece); }
      }
      if (list.length === 1) { fields[key] = list[0]; mapped++; }
      else if (list.length > 1) { fields[key] = list; mapped++; }
    }
    var cpEl = document.getElementById('lg-parse-carriers-path');
    var carriersPath = cpEl ? String(cpEl.value || '').replace(/^\\s+|\\s+$/g, '') : '';
    var config = { fields: fields };
    if (carriersPath !== '') { config.carriers_path = carriersPath; }
    return { config: config, mapped: mapped };
  }
  var parseSave = document.getElementById('lg-parse-save');
  if (parseSave) {
    parseSave.addEventListener('click', function () {
      renderParserSaveErrors([]);
      var problems = [];
      var schema = buildSchema(problems);
      if (problems.length > 0) {
        renderParserSaveErrors(problems);
        if (window.showToast) { window.showToast('Fix the payload tree first \\u2014 the parser saves WITH the schema version', 'error'); }
        return;
      }
      var built = buildParseConfig();
      if (built.mapped === 0) {
        renderParserSaveErrors([{ message: 'Map at least one canonical Carrier field before saving (\\u00a711.7).' }]);
        return;
      }
      parseSave.disabled = true;
      parseSave.classList.add('lg-saving');
      getJson('POST', apiBase + '/payload-schemas', {
        schema_json: schema,
        carrier_parse_json: built.config
      }).then(function (res) {
        parseSave.disabled = false;
        parseSave.classList.remove('lg-saving');
        if (res.ok && res.body && res.body.version) {
          activeVersion = res.body.version;
          if (metaEl) { metaEl.textContent = 'Active schema: v' + res.body.version + ' (' + (res.body.source || 'manual') + ')'; }
          renderParserSaveErrors([]);
          if (window.showToast) { window.showToast('Response parser saved with schema v' + res.body.version + ' (now active)', 'success'); }
          refreshPreview();
          return;
        }
        var entries = (res.body && res.body.schema_errors) || [];
        if (entries.length === 0 && res.body && res.body.fields) {
          var k;
          for (k in res.body.fields) {
            if (Object.prototype.hasOwnProperty.call(res.body.fields, k)) {
              entries.push({ path: k, message: res.body.fields[k] });
            }
          }
        }
        if (entries.length === 0 && res.body && res.body.error) { entries = [{ message: res.body.error }]; }
        renderParserSaveErrors(entries);
        if (window.showToast) { window.showToast('Response parser not saved \\u2014 fix the errors', 'error'); }
      }).catch(function () {
        parseSave.disabled = false;
        parseSave.classList.remove('lg-saving');
        renderParserSaveErrors([{ message: 'Network error \\u2014 the parser was not saved.' }]);
      });
    });
  }

  // --- init -------------------------------------------------------------------------------------
  var blob = readBlob();
  if (blob && blob.active_schema && blob.active_schema.schema) {
    activeVersion = blob.active_schema.version || 0;
    rebuildRows(blob.active_schema.schema);
  } else {
    refreshPreview();
  }
}());
`;
