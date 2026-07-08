// LeadGen Test tool — POST /api/admin/leadgen/offers/:id/test (contract 04
// §11.6, secrets/redaction per 09 §30.2–§30.3). Server-side by design
// ("protects secrets"): the Worker builds the payload from the ACTIVE
// payload schema + the admin's sample answers, resolves headers/token,
// fires the provider request with a bounded timeout, parses the response
// through the Offer's carrier_parse_json, persists sample_response_json on
// the active schema row, and writes ONE redacted
// leadgen_provider_request_log row.
//
// `dry_run: true` (04 §11.1 "Test with sample answers") runs the identical
// build/resolve/mask pipeline and stops short of the fetch: no outbound
// request, no sample persistence, no log row, no debug blob — the response
// carries the built payload + masked headers with null
// response/status/latency/carriers.
//
// Secret handling (§30.2 — normative):
//   * resolved via readEnvSecret(env, <name>); an ABSENT secret is a TYPED
//     no-op (`notes[]` entry) — that leg simply does not attach, NEVER a
//     throw, and the request still fires.
//   * secret VALUES are SENT to the provider but NEVER returned to the
//     frontend and NEVER stored in an admin-visible column: header values →
//     "[REDACTED]", the payload token node → "[REDACTED]" (masked at its
//     schema path), a query-placed token → "[REDACTED]" in the echoed URL.
//
// Debug blob (AUTHORED CONVENTION — §30.3 "full request/response stored only
// as an encrypted-at-rest blob referenced by an opaque debug_ref"):
//   * secret name `LEADGEN_DEBUG_ENCRYPTION_KEY` (encrypted wrangler secret,
//     Dashboard/CI only). ABSENT ⇒ NO blob is written and debug_ref stays
//     NULL — the leg no-ops per §30.2.
//   * PRESENT ⇒ the full unredacted request+response JSON is AES-256-GCM
//     encrypted via WebCrypto (key = SHA-256(secret); random 96-bit IV;
//     stored as base64(iv) + "." + base64(ciphertext)) and PUT into KV
//     (env.CACHE) under the opaque key `lg-debug:<32 hex chars of CSPRNG>`
//     with `expirationTtl: 259200` — the KV TTL enforces the §30.3 72-hour
//     debug-blob retention mechanically. debug_ref = that opaque key.

import { readEnvSecret } from "../../env";
import { ulid } from "../../leadgen/ids";
import { resolveMacros } from "../../leadgen/macros";
import {
  buildPayload,
  inferSchemaFromExample,
  validatePayloadSchema,
  type LeadgenPayloadNode,
  type LeadgenPayloadSchema,
} from "../../leadgen/payload";
import {
  buildLeadgenRuntimeContext,
  type LeadgenRuntimeContextOverrides,
} from "../../leadgen/runtime-context";
import { REDACTED_VALUE, maskPaths, maskSecretHeaders, redactPii } from "../../leadgen/redact";
import { parseProviderResponse } from "../../public/leadgen/auction/parse";
import type { LeadgenOfferPayloadSchemaRow, LeadgenOfferRow } from "./db-types";
import {
  readOfferHeaders,
  readJsonBody,
  readLinkedSectionFields,
  resolveOfferRow,
  parseJsonColumn,
  type AdminContext,
  type LeadgenLinkedSectionField,
} from "./offers-handlers";

// Bounded outbound timeout for the ADMIN test request (larger than the
// auction's timeout_ms budget on purpose — a human is diagnosing, not a
// funnel user waiting on render).
export const TEST_FETCH_TIMEOUT_MS = 10_000;

export const DEBUG_ENCRYPTION_SECRET_NAME = "LEADGEN_DEBUG_ENCRYPTION_KEY";
export const DEBUG_BLOB_TTL_SECONDS = 259_200; // 72 h — §30.3 retention via KV TTL
// Exported (P10 §19 reuse): the auction runtime encrypts its per-provider debug
// records with the SAME convention (no divergent crypto). The opaque debug_ref
// prefix + encryptDebugBlob + randomHex are the single shared implementation.
export const DEBUG_REF_PREFIX = "lg-debug:";

// A typed no-op note (§30.2): the leg that could not attach, and why. Never
// an HTTP failure — the test still runs without that leg.
export interface LeadgenTestNote {
  scope: "header" | "token";
  code: "secret_absent" | "token_param_name_missing" | "token_node_missing";
  header_name?: string;
  secret_ref?: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function is2xx(status: number | null): boolean {
  return status !== null && status >= 200 && status < 300;
}

// The B5 overridable simulated-context fields (fix-contract v2.4 04 §4.7.2):
// exactly the runtime-context override bag's keys. The Test tool is the ONLY
// surface that may pass overrides — public routes never accept them.
const TEST_OVERRIDE_KEYS = [
  "ip",
  "ua",
  "url",
  "referer",
  "language",
  "country",
  "region",
  "state",
  "city",
  "postalCode",
  "timezone",
  "colo",
  "utm_source",
  "utm_medium",
  "utm_content",
  "traffic_source",
  "placement",
  "sub1",
  "sub2",
  "sub3",
  "sub4",
  "sub5",
  "cpc",
  "fbclid",
  "fbc",
] as const;
const TEST_OVERRIDE_KEY_SET: ReadonlySet<string> = new Set(TEST_OVERRIDE_KEYS);

// Parse + validate the request's `overrides` object → the builder's typed
// bag. Unknown keys / non-string values are typed 400s (never silently
// dropped — the operator meant to simulate something).
function parseTestOverrides(raw: unknown): { overrides?: LeadgenRuntimeContextOverrides; error?: string } {
  if (raw === undefined) return {};
  if (!isRecord(raw)) return { error: "overrides must be an object of string fields" };
  const overrides: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!TEST_OVERRIDE_KEY_SET.has(key)) {
      return { error: `unknown override '${key}' (valid: ${TEST_OVERRIDE_KEYS.join(", ")})` };
    }
    if (typeof value !== "string") return { error: `override '${key}' must be a string` };
    overrides[key] = value;
  }
  return { overrides: overrides as LeadgenRuntimeContextOverrides };
}

// --- AES-GCM debug-blob encryption (WebCrypto; authored convention above) ---

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function encryptDebugBlob(secret: string, plaintext: string): Promise<string> {
  const keyMaterial = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, [
    "encrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`;
}

export function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += b.toString(16).padStart(2, "0");
  return out;
}

// ---------------------------------------------------------------------------
// POST /offers/:id/test — the §11.6 cycle
// ---------------------------------------------------------------------------

export async function testOfferHandler(c: AdminContext): Promise<Response> {
  const offer = await resolveOfferRow(c.env.DB, c.req.param("id") ?? "");
  if (offer === null) return c.json({ error: "Not Found" }, 404);

  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const environment = body["environment"];
  if (environment !== "staging" && environment !== "production") {
    return c.json(
      { error: "Validation failed", fields: { environment: "environment must be staging|production" } },
      400,
    );
  }
  const rawAnswers = body["sample_answers"];
  if (rawAnswers !== undefined && !isRecord(rawAnswers)) {
    return c.json(
      { error: "Validation failed", fields: { sample_answers: "sample_answers must be an object" } },
      400,
    );
  }
  const sampleAnswers: Record<string, unknown> = rawAnswers ?? {};

  // §11.1 "Test with sample answers" = a DRY RUN of this same cycle: build +
  // resolve + mask exactly like the live path, then stop short of the fetch.
  const rawDryRun = body["dry_run"];
  if (rawDryRun !== undefined && typeof rawDryRun !== "boolean") {
    return c.json(
      { error: "Validation failed", fields: { dry_run: "dry_run must be a boolean" } },
      400,
    );
  }
  const dryRun = rawDryRun === true;

  if (offer.calls_provider_api !== 1) {
    return c.json(
      {
        error: "Validation failed",
        fields: { offer: "offer does not call a provider API (calls_provider_api=0)" },
      },
      400,
    );
  }
  if (offer.active_payload_schema_id === null) {
    return c.json(
      { error: "Validation failed", fields: { offer: "offer has no active payload schema" } },
      400,
    );
  }
  const schemaRow = await c.env.DB.prepare(
    "SELECT * FROM leadgen_offer_payload_schemas WHERE id = ? LIMIT 1",
  )
    .bind(offer.active_payload_schema_id)
    .first<LeadgenOfferPayloadSchemaRow>();
  if (!schemaRow) {
    return c.json(
      { error: "Validation failed", fields: { offer: "offer has no active payload schema" } },
      400,
    );
  }

  // §11.6 environment routing: a missing endpoint for the CHOSEN environment
  // is a typed 400, never a fetch against the other environment.
  const endpoint =
    environment === "staging" ? offer.endpoint_staging : offer.endpoint_production;
  const trimmedEndpoint = typeof endpoint === "string" ? endpoint.trim() : "";
  if (trimmedEndpoint === "") {
    return c.json(
      {
        error: "Validation failed",
        fields: { environment: `offer has no ${environment} endpoint configured` },
      },
      400,
    );
  }

  // --- B7 pre-test validity gate (fix-contract v2.4 05 §5.5) ----------------
  // BEFORE any build/fetch the ACTIVE schema runs validatePayloadSchema:
  // BLOCKING-class errors → typed 400 with the §6.11 panel's schema_errors
  // shape (warning-class findings don't block — 05 §5.5). This also retires
  // the old unreadable-schema 500: a stored value that is not JSON / not the
  // §11.5 shape simply validates to schema_not_object / root_invalid.
  const parsedSchema = parseJsonColumn(schemaRow.schema_json);
  const schemaValidation = validatePayloadSchema(parsedSchema);
  if (!schemaValidation.ok) {
    return c.json(
      { error: "schema_validation_errors", schema_errors: schemaValidation.errors },
      400,
    );
  }
  // ok ⇒ no blocking error ⇒ the §11.5 structural invariants hold.
  const schema = parsedSchema as unknown as LeadgenPayloadSchema;

  const notes: LeadgenTestNote[] = [];

  // --- B5 simulated context (fix-contract v2.4 04 §4.7.2) -------------------
  // The Test tool builds its context through the SAME canonical builder the
  // runtime uses (buildLeadgenRuntimeContext) so Test and runtime can never
  // drift: defaults mirror runtime (this admin request's own ip/ua/cf/URL
  // slices stand in), and the operator may override the B5 field set.
  const overridesParse = parseTestOverrides(body["overrides"]);
  if (overridesParse.error !== undefined) {
    return c.json({ error: "Validation failed", fields: { overrides: overridesParse.error } }, 400);
  }

  // §4.5 placement in scope: the operator-selected placement
  // (`offer_placement_id`: lgp_ public id or numeric id, must belong to this
  // Offer) — default: the Offer's is_default placement. The provider-facing
  // `placement_id` column value feeds the macro/payload; the public_id goes to
  // the log row.
  interface PlacementRow { id: number; public_id: string; placement_id: string }
  let placementRow: PlacementRow | null = null;
  const placementRef = body["offer_placement_id"];
  if (placementRef !== undefined && placementRef !== null && placementRef !== "") {
    if (typeof placementRef === "number" && Number.isInteger(placementRef)) {
      placementRow = await c.env.DB.prepare(
        "SELECT id, public_id, placement_id FROM leadgen_offer_placements WHERE id = ? AND offer_id = ? LIMIT 1",
      )
        .bind(placementRef, offer.id)
        .first<PlacementRow>();
    } else if (typeof placementRef === "string") {
      placementRow = await c.env.DB.prepare(
        "SELECT id, public_id, placement_id FROM leadgen_offer_placements WHERE public_id = ? AND offer_id = ? LIMIT 1",
      )
        .bind(placementRef, offer.id)
        .first<PlacementRow>();
    }
    if (placementRow === null) {
      return c.json(
        { error: "Validation failed", fields: { offer_placement_id: "placement not found on this offer" } },
        400,
      );
    }
  } else {
    placementRow = await c.env.DB.prepare(
      "SELECT id, public_id, placement_id FROM leadgen_offer_placements WHERE offer_id = ? AND is_default = 1 LIMIT 1",
    )
      .bind(offer.id)
      .first<PlacementRow>();
  }

  const simulatedCtx = buildLeadgenRuntimeContext(c.req.raw, {
    session_id: "",
    page_view_id: "",
    funnel_attempt_id: "",
    quote: "",
    funnel: "",
    variant: "",
    offer: {
      offer_id: offer.public_id,
      offer_name: offer.offer_name,
      placement_id: placementRow?.placement_id ?? undefined,
    },
    ...(overridesParse.overrides !== undefined ? { overrides: overridesParse.overrides } : {}),
  });
  const macroValues: Record<string, string> = simulatedCtx.macros;

  const secretRef =
    typeof offer.api_token_secret_ref === "string" && offer.api_token_secret_ref.trim() !== ""
      ? offer.api_token_secret_ref.trim()
      : null;
  const tokenValue = secretRef !== null ? readEnvSecret(c.env, secretRef) : undefined;
  if (secretRef !== null && tokenValue === undefined) {
    // §30.2: absent secret ⇒ that leg no-ops, typed — never a throw.
    notes.push({
      scope: "token",
      code: "secret_absent",
      secret_ref: secretRef,
      message: `secret '${secretRef}' is not configured; token leg skipped`,
    });
  }

  const payload = buildPayload(schema, {
    answers: sampleAnswers,
    macros: macroValues,
    // §4.7.2 parity: computed + the offer/placement slice come from the SAME
    // simulated context — an identical simulated context therefore yields the
    // identical payload the runtime builder produces.
    computed: simulatedCtx.computed,
    ...(simulatedCtx.offer !== undefined ? { offer: simulatedCtx.offer } : {}),
    token: {
      ...(tokenValue !== undefined ? { value: tokenValue } : {}),
      api_token_placement: offer.api_token_placement,
      request_execution_mode: offer.request_execution_mode,
    },
  });
  const tokenPaths = schema.root.children
    .filter((node) => node.source === "token")
    .map((node) => node.path);

  // --- resolve headers (§11.3: static verbatim / macro template / secret) --
  const headerRows = await readOfferHeaders(c.env.DB, offer.id);
  const sentHeaders: Record<string, string> = {};
  const secretHeaderNames = new Set<string>();
  for (const row of headerRows) {
    const valueText = row.value_text ?? "";
    if (row.value_kind === "static") {
      sentHeaders[row.header_name] = valueText;
    } else if (row.value_kind === "macro") {
      sentHeaders[row.header_name] = resolveMacros(valueText, macroValues);
    } else {
      const resolved = valueText === "" ? undefined : readEnvSecret(c.env, valueText);
      if (resolved === undefined) {
        notes.push({
          scope: "header",
          code: "secret_absent",
          header_name: row.header_name,
          secret_ref: valueText,
          message: `secret '${valueText}' is not configured; header '${row.header_name}' skipped`,
        });
      } else {
        sentHeaders[row.header_name] = resolved;
        secretHeaderNames.add(row.header_name.toLowerCase());
      }
    }
  }

  // --- token placement (§11.3–11.4: header | payload | query) --------------
  let requestUrl = trimmedEndpoint;
  let displayUrl = trimmedEndpoint;
  const paramName =
    typeof offer.api_token_param_name === "string" && offer.api_token_param_name.trim() !== ""
      ? offer.api_token_param_name.trim()
      : null;
  if (offer.api_token_placement === "header" && tokenValue !== undefined) {
    if (paramName === null) {
      notes.push({
        scope: "token",
        code: "token_param_name_missing",
        message: "api_token_placement=header requires api_token_param_name; token leg skipped",
      });
    } else {
      sentHeaders[paramName] = tokenValue;
      secretHeaderNames.add(paramName.toLowerCase());
    }
  } else if (offer.api_token_placement === "query" && tokenValue !== undefined) {
    if (paramName === null) {
      notes.push({
        scope: "token",
        code: "token_param_name_missing",
        message: "api_token_placement=query requires api_token_param_name; token leg skipped",
      });
    } else {
      const sep = requestUrl.includes("?") ? "&" : "?";
      requestUrl = `${requestUrl}${sep}${encodeURIComponent(paramName)}=${encodeURIComponent(tokenValue)}`;
      displayUrl = `${displayUrl}${sep}${encodeURIComponent(paramName)}=${REDACTED_VALUE}`;
    }
  } else if (
    offer.api_token_placement === "payload" &&
    tokenValue !== undefined &&
    tokenPaths.length === 0
  ) {
    notes.push({
      scope: "token",
      code: "token_node_missing",
      message: "api_token_placement=payload but the active schema has no token node",
    });
  }

  const method = offer.request_method ?? "POST";
  const hasBody = method !== "GET";
  if (hasBody && !Object.keys(sentHeaders).some((name) => name.toLowerCase() === "content-type")) {
    sentHeaders["content-type"] = "application/json";
  }

  // --- §11.1 dry run: everything above ran EXACTLY like the live path -------
  // (schema/endpoint validation, payload build, header/token resolution,
  // typed notes, §30.2 masking). SKIPPED: the outbound fetch, the
  // sample_response_json persistence, the provider_request_log row, and the
  // debug blob — a dry run leaves NO trace beyond its response.
  // The simulated-context echo (additive — the Phase-2 Test-tab context panel
  // reads it): which placement + macro/computed values fed this build.
  const contextUsed = {
    placement_public_id: placementRow?.public_id ?? null,
    placement_id: placementRow?.placement_id ?? null,
    macros: macroValues,
    computed: simulatedCtx.computed,
  };

  if (dryRun) {
    return c.json({
      dry_run: true,
      environment,
      endpoint: displayUrl,
      method,
      request: {
        payload: maskPaths(payload, tokenPaths),
        headers: maskSecretHeaders(sentHeaders, secretHeaderNames),
      },
      response: { status: null, latency_ms: null, body: null },
      parse: { carriers: null, errors: [] },
      response_field_paths: [],
      notes,
      provider_error_reason: null,
      debug_ref: null,
      context_used: contextUsed,
    });
  }

  // --- bounded server-side fetch -------------------------------------------
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_FETCH_TIMEOUT_MS);
  const started = Date.now();
  let statusCode: number | null = null;
  let bodyText: string | null = null;
  let providerErrorReason: string | null = null;
  let errorText: string | null = null;
  try {
    const response = await fetch(requestUrl, {
      method,
      headers: sentHeaders,
      body: hasBody ? JSON.stringify(payload) : undefined,
      redirect: "manual",
      signal: controller.signal,
    });
    statusCode = response.status;
    bodyText = await response.text();
    if (!is2xx(statusCode)) providerErrorReason = `http_${statusCode}`;
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    providerErrorReason = name === "AbortError" ? "timeout" : "network_error";
    errorText = (err instanceof Error ? err.message : String(err)).slice(0, 200);
  } finally {
    clearTimeout(timer);
  }
  const latencyMs = Date.now() - started;

  // --- parse (§11.7 — typed, never throws) ---------------------------------
  let responseJson: unknown;
  let responseIsJson = false;
  if (bodyText !== null && bodyText !== "") {
    try {
      responseJson = JSON.parse(bodyText) as unknown;
      responseIsJson = true;
    } catch {
      responseIsJson = false;
    }
  }
  const parseResult = parseProviderResponse(parseJsonColumn(schemaRow.carrier_parse_json), bodyText ?? "");
  if (providerErrorReason === null && bodyText !== null && bodyText !== "" && !responseIsJson) {
    providerErrorReason = "malformed_response";
  }

  // --- persist sample_response_json (§11.6) --------------------------------
  // Only a 2xx JSON body becomes THE sample — an error page must never
  // clobber the sample the parser config was built against.
  if (is2xx(statusCode) && responseIsJson && bodyText !== null) {
    await c.env.DB.prepare(
      "UPDATE leadgen_offer_payload_schemas SET sample_response_json = ? WHERE id = ?",
    )
      .bind(bodyText, schemaRow.id)
      .run();
  }

  // Available response field paths for the §10.5 macro chips — the Stage-A
  // inferrer already enumerates every addressable leaf path.
  const responseFieldPaths = responseIsJson
    ? inferSchemaFromExample(responseJson).root.children.map((node) => node.path)
    : [];

  // --- encrypted debug blob (authored convention — see module header) ------
  let debugRef: string | null = null;
  const encryptionSecret = readEnvSecret(c.env, DEBUG_ENCRYPTION_SECRET_NAME);
  if (encryptionSecret !== undefined) {
    try {
      const ref = `${DEBUG_REF_PREFIX}${randomHex(16)}`;
      const blob = JSON.stringify({
        url: requestUrl,
        method,
        request_headers: sentHeaders,
        request_payload: payload,
        status_code: statusCode,
        response_body: bodyText,
        environment,
        created_at: new Date().toISOString(),
      });
      await c.env.CACHE.put(ref, await encryptDebugBlob(encryptionSecret, blob), {
        expirationTtl: DEBUG_BLOB_TTL_SECONDS,
      });
      debugRef = ref;
    } catch {
      debugRef = null; // blob leg is best-effort; the log row still lands
    }
  }

  // --- redacted provider-request log row (§30.3) ----------------------------
  // §4.5 explainability: the row records WHICH placement the Test used (the
  // operator-selected/default one resolved above — no second lookup).
  const maskedHeaders = maskSecretHeaders(sentHeaders, secretHeaderNames);
  const maskedPayload = maskPaths(payload, tokenPaths);
  await c.env.DB.prepare(
    `INSERT INTO leadgen_provider_request_log
       (provider_request_id, offer_public_id, placement_public_id, carrier_parse_version,
        environment, status_code, latency_ms, request_headers_redacted_json,
        request_payload_redacted_json, response_redacted_json, parsed_carriers_json,
        debug_ref, provider_error_reason, error_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      ulid(),
      offer.public_id,
      placementRow?.public_id ?? null,
      schemaRow.carrier_parse_version,
      environment,
      statusCode,
      latencyMs,
      JSON.stringify(maskedHeaders),
      JSON.stringify(redactPii(maskedPayload)),
      responseIsJson ? JSON.stringify(redactPii(responseJson)) : null,
      JSON.stringify(parseResult.carriers),
      debugRef,
      providerErrorReason,
      errorText,
    )
    .run();

  // --- the §11.6 response ----------------------------------------------------
  // "Exact payload sent" with ONE exception (§30.2 wins): secret-derived
  // bytes (token node value, secret headers, query token) are masked — a
  // secret is never returned to the frontend. Sample-answer values echo
  // exactly (the admin typed them). The stored LOG additionally PII-hashes
  // the payload/response; the ephemeral admin response does not.
  return c.json({
    dry_run: false,
    environment,
    endpoint: displayUrl,
    method,
    request: {
      payload: maskedPayload,
      headers: maskedHeaders,
    },
    response: {
      status: statusCode,
      latency_ms: latencyMs,
      body: responseIsJson ? responseJson : bodyText,
    },
    parse: {
      carriers: parseResult.carriers,
      errors: parseResult.errors,
    },
    response_field_paths: responseFieldPaths,
    notes,
    provider_error_reason: providerErrorReason,
    debug_ref: debugRef,
    context_used: contextUsed,
  });
}

// ---------------------------------------------------------------------------
// B4 — sample-answer generation (fix-contract v2.4 06 §6.12.1)
// POST /offers/:id/payload/sample-answers  → generate (draft-merged)
// PUT  /offers/:id/payload/sample-answers  → persist the operator's edits
// ---------------------------------------------------------------------------
//
// Generation reads the ACTIVE schema's `source:"answer"` nodes + the linked-
// Section component inventory (readLinkedSectionFields — the same loader the
// offer GET's builder_context projects) and emits one form field per
// internal_field with a §6.12.1-heuristic sample:
//   enums    → the FIRST valid value (options from the Section's choices,
//              else the node's value_map internal keys, else valid_values)
//   booleans → true
//   dates    → today−30y for DOB-like names (dob/birth), today otherwise
//   zip      → "90210"            address → a sample street string
//   numbers  → the component's numeric props.min when present, else 30
//   text     → a placeholder-ish sample (email/phone-shaped when the field
//              is email/phone-like so provider-side format checks pass)
//
// Draft persistence (per Offer): KV key `lg-testdraft:<lgo_…>` (env.CACHE,
// no TTL — one bounded key per Offer, overwritten on every PUT). The PUT
// body is `{answers: Record<internal_field, value>}`; the POST response
// merges a persisted draft OVER the generated samples BY KNOWN FIELD (a
// draft key whose field no longer exists in the ACTIVE schema is dropped —
// stale edits never resurrect removed fields). `answers[f]` and the matching
// `fields[].sample` always agree.
//
// RESPONSE SHAPE (PINNED — the §6.12 Test-tab form codes against exactly
// this):
//   { answers: Record<internal_field, sample_value>,
//     fields: [{ internal_field, label,
//                kind: "enum"|"boolean"|"date"|"zip"|"address"|"text"|"number",
//                options?: [{value, label}], sample, required: boolean,
//                source_path: string }] }

export const TEST_DRAFT_KV_PREFIX = "lg-testdraft:";
// MINOR-4: sample-answer draft bounds — a 64 KB serialized ceiling (typed 400
// over it) and a TTL so abandoned per-offer drafts expire (mirrors the
// §30.3 debug-blob KV-TTL discipline).
export const TEST_DRAFT_MAX_BYTES = 65_536;
export const TEST_DRAFT_TTL_SECONDS = 259_200; // 72 h

export type LeadgenSampleAnswerKind =
  | "enum"
  | "boolean"
  | "date"
  | "zip"
  | "address"
  | "text"
  | "number";

export interface LeadgenSampleAnswerOption {
  value: string | number | boolean;
  label: string;
}

export interface LeadgenSampleAnswerField {
  internal_field: string;
  label: string;
  kind: LeadgenSampleAnswerKind;
  options?: LeadgenSampleAnswerOption[];
  sample: unknown;
  required: boolean;
  source_path: string;
}

// Name heuristics (§6.12.1). DOB is a subset of the date-kind name test:
// "birthday"/"dob_date" are date-kind AND −30y; "policy_start_date" is
// date-kind at today.
const DOB_NAME_RE = /dob|birth/i;
const DATE_NAME_RE = /dob|birth|date/i;
const ZIP_NAME_RE = /zip|postal/i;
const ADDRESS_NAME_RE = /address|street/i;
const EMAIL_NAME_RE = /email/i;
const PHONE_NAME_RE = /phone/i;

function isoDateUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function isoDateUtcMinusYears(ms: number, years: number): string {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear() - years, d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

// The §6.2 answer-input option list for one field, in domain priority order:
// the Section component's authored choices (display labels included) → the
// node's value_map internal KEYS (the input domain the admin declared) → the
// node's valid_values (the domain when no map re-writes values).
function sampleOptionsFor(
  node: LeadgenPayloadNode,
  field: LeadgenLinkedSectionField | undefined,
): LeadgenSampleAnswerOption[] {
  if (field !== undefined && field.choices.length > 0) return field.choices;
  if (node.value_map !== undefined) {
    const keys = Object.keys(node.value_map);
    if (keys.length > 0) return keys.map((key) => ({ value: key, label: key }));
  }
  if (Array.isArray(node.valid_values) && node.valid_values.length > 0) {
    return node.valid_values
      .filter(
        (v): v is string | number | boolean =>
          typeof v === "string" || typeof v === "number" || typeof v === "boolean",
      )
      .map((v) => ({ value: v, label: String(v) }));
  }
  return [];
}

// Classify one answer field + generate its sample (heuristics table above).
// Precedence: boolean → enum → date → zip → address → number → text.
function classifySampleField(
  node: LeadgenPayloadNode,
  field: LeadgenLinkedSectionField | undefined,
  now: number,
): { kind: LeadgenSampleAnswerKind; options?: LeadgenSampleAnswerOption[]; sample: unknown } {
  const name = node.internal_field ?? "";
  if (
    node.type === "boolean" ||
    field?.answer_type === "boolean" ||
    field?.component_type === "TwoButtonYesNo"
  ) {
    return { kind: "boolean", sample: true };
  }
  const options = sampleOptionsFor(node, field);
  if (node.type === "enum" || options.length > 0) {
    return { kind: "enum", options, sample: options[0]?.value ?? "" };
  }
  const hasFormatDate = node.transform?.some((step) => step.kind === "formatDate") === true;
  if (field?.component_type === "DateQuestion" || hasFormatDate || DATE_NAME_RE.test(name)) {
    return {
      kind: "date",
      sample: DOB_NAME_RE.test(name) ? isoDateUtcMinusYears(now, 30) : isoDateUtc(now),
    };
  }
  if (field?.component_type === "ZIPInputQuestion" || ZIP_NAME_RE.test(name)) {
    return { kind: "zip", sample: "90210" };
  }
  if (field?.component_type === "AddressAutocompleteQuestion" || ADDRESS_NAME_RE.test(name)) {
    return { kind: "address", sample: "123 Main St" };
  }
  if (
    node.type === "number" ||
    field?.answer_type === "number" ||
    field?.answer_type === "currency"
  ) {
    const min = field?.props["min"];
    return { kind: "number", sample: typeof min === "number" && Number.isFinite(min) ? min : 30 };
  }
  if (field?.component_type === "EmailInputQuestion" || EMAIL_NAME_RE.test(name)) {
    return { kind: "text", sample: "sample@example.com" };
  }
  if (field?.component_type === "PhoneInputQuestion" || PHONE_NAME_RE.test(name)) {
    return { kind: "text", sample: "5551234567" };
  }
  return { kind: "text", sample: "Sample text" };
}

// Shared entry guard for both methods: the Offer must exist AND have an
// ACTIVE payload schema (404 otherwise — there is no form to generate or
// draft against), and generation additionally requires the schema readable
// with no BLOCKING-class errors (the same B7 gate as Test — typed 400,
// never a 500).
async function resolveSampleAnswerOffer(
  c: AdminContext,
): Promise<
  { response: Response } | { offer: LeadgenOfferRow; schemaRow: LeadgenOfferPayloadSchemaRow }
> {
  const offer = await resolveOfferRow(c.env.DB, c.req.param("id") ?? "");
  if (offer === null) return { response: c.json({ error: "Not Found" }, 404) };
  if (offer.active_payload_schema_id === null) {
    return { response: c.json({ error: "offer has no active payload schema" }, 404) };
  }
  const schemaRow = await c.env.DB.prepare(
    "SELECT * FROM leadgen_offer_payload_schemas WHERE id = ? LIMIT 1",
  )
    .bind(offer.active_payload_schema_id)
    .first<LeadgenOfferPayloadSchemaRow>();
  if (!schemaRow) {
    return { response: c.json({ error: "offer has no active payload schema" }, 404) };
  }
  return { offer, schemaRow };
}

// POST /offers/:id/payload/sample-answers — generate (draft merged over).
export async function generateSampleAnswersHandler(c: AdminContext): Promise<Response> {
  const resolved = await resolveSampleAnswerOffer(c);
  if ("response" in resolved) return resolved.response;
  const { offer, schemaRow } = resolved;

  const parsedSchema = parseJsonColumn(schemaRow.schema_json);
  const schemaValidation = validatePayloadSchema(parsedSchema);
  if (!schemaValidation.ok) {
    return c.json(
      { error: "schema_validation_errors", schema_errors: schemaValidation.errors },
      400,
    );
  }
  const schema = parsedSchema as unknown as LeadgenPayloadSchema;

  const linkedFields = await readLinkedSectionFields(c.env.DB, offer.id);
  const fieldByInternal = new Map<string, LeadgenLinkedSectionField>();
  for (const field of linkedFields) {
    if (!fieldByInternal.has(field.internal_field)) fieldByInternal.set(field.internal_field, field);
  }

  // One form field per internal_field, in SCHEMA order (mirrors the tree).
  // The first node carrying the field provides label/kind/source_path;
  // `required` ORs across every node the field feeds.
  const now = Date.now();
  const fields: LeadgenSampleAnswerField[] = [];
  const byInternal = new Map<string, LeadgenSampleAnswerField>();
  for (const node of schema.root.children) {
    if (node.source !== "answer") continue;
    const internalField = node.internal_field;
    if (typeof internalField !== "string" || internalField === "") continue;
    const existing = byInternal.get(internalField);
    if (existing !== undefined) {
      if (node.required === true) existing.required = true;
      continue;
    }
    const linked = fieldByInternal.get(internalField);
    const classified = classifySampleField(node, linked, now);
    const entry: LeadgenSampleAnswerField = {
      internal_field: internalField,
      label:
        typeof node.label === "string" && node.label.trim() !== "" ? node.label : internalField,
      kind: classified.kind,
      ...(classified.options !== undefined ? { options: classified.options } : {}),
      sample: classified.sample,
      required: node.required === true,
      source_path: node.path,
    };
    byInternal.set(internalField, entry);
    fields.push(entry);
  }

  // Draft merge (BY KNOWN FIELD — see module note).
  const draftRaw = await c.env.CACHE.get(`${TEST_DRAFT_KV_PREFIX}${offer.public_id}`);
  if (draftRaw !== null) {
    try {
      const draft = JSON.parse(draftRaw) as unknown;
      if (isRecord(draft) && isRecord(draft["answers"])) {
        const draftAnswers = draft["answers"];
        for (const entry of fields) {
          if (Object.prototype.hasOwnProperty.call(draftAnswers, entry.internal_field)) {
            entry.sample = draftAnswers[entry.internal_field];
          }
        }
      }
    } catch {
      /* corrupt draft ⇒ generation stands alone (D1-rule idiom: fall through
         to source, never fail the read) */
    }
  }

  const answers: Record<string, unknown> = {};
  for (const entry of fields) answers[entry.internal_field] = entry.sample;
  return c.json({ answers, fields });
}

// PUT /offers/:id/payload/sample-answers — persist the operator's edited
// answers as THE per-Offer draft. Accepts any record (Advanced raw-JSON
// edits may carry keys beyond the generated set — the POST merge simply
// ignores unknown keys).
export async function putSampleAnswersDraftHandler(c: AdminContext): Promise<Response> {
  const resolved = await resolveSampleAnswerOffer(c);
  if ("response" in resolved) return resolved.response;
  const { offer } = resolved;

  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);
  const answers = body["answers"];
  if (!isRecord(answers)) {
    return c.json(
      { error: "Validation failed", fields: { answers: "answers must be an object" } },
      400,
    );
  }
  // MINOR-4: bound the draft — it is operator-editable and KV-persisted. Cap
  // the serialized size (typed 400) and set a TTL so abandoned drafts expire
  // (mirrors the debug-blob discipline) rather than living forever.
  const serialized = JSON.stringify({ answers });
  if (serialized.length > TEST_DRAFT_MAX_BYTES) {
    return c.json(
      { error: "Validation failed", fields: { answers: `draft exceeds ${TEST_DRAFT_MAX_BYTES} bytes` } },
      400,
    );
  }
  await c.env.CACHE.put(`${TEST_DRAFT_KV_PREFIX}${offer.public_id}`, serialized, {
    expirationTtl: TEST_DRAFT_TTL_SECONDS,
  });
  return c.json({ answers });
}
