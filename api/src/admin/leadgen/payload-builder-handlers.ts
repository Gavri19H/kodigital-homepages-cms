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
import { buildPayload, inferSchemaFromExample, type LeadgenPayloadSchema } from "../../leadgen/payload";
import { REDACTED_VALUE, maskPaths, maskSecretHeaders, redactPii } from "../../leadgen/redact";
import { parseProviderResponse } from "../../public/leadgen/auction/parse";
import type { LeadgenOfferPayloadSchemaRow } from "./db-types";
import { readOfferHeaders, readJsonBody, resolveOfferRow, parseJsonColumn, type AdminContext } from "./offers-handlers";

// Bounded outbound timeout for the ADMIN test request (larger than the
// auction's timeout_ms budget on purpose — a human is diagnosing, not a
// funnel user waiting on render).
export const TEST_FETCH_TIMEOUT_MS = 10_000;

export const DEBUG_ENCRYPTION_SECRET_NAME = "LEADGEN_DEBUG_ENCRYPTION_KEY";
export const DEBUG_BLOB_TTL_SECONDS = 259_200; // 72 h — §30.3 retention via KV TTL
const DEBUG_REF_PREFIX = "lg-debug:";

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

// --- AES-GCM debug-blob encryption (WebCrypto; authored convention above) ---

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function encryptDebugBlob(secret: string, plaintext: string): Promise<string> {
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

function randomHex(bytes: number): string {
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

  let schema: LeadgenPayloadSchema;
  const parsedSchema = parseJsonColumn(schemaRow.schema_json);
  if (
    isRecord(parsedSchema) &&
    isRecord(parsedSchema["root"]) &&
    Array.isArray((parsedSchema["root"] as Record<string, unknown>)["children"])
  ) {
    schema = parsedSchema as unknown as LeadgenPayloadSchema;
  } else {
    return c.json({ error: "active payload schema is unreadable" }, 500);
  }

  const notes: LeadgenTestNote[] = [];

  // Canonical-macro runtime ctx for a TEST run: only the offer's own
  // identity macros have real values here; everything else resolves empty
  // (the macros.ts unresolved-macro policy) — there is no live session.
  const macroValues: Record<string, string> = {
    offer_id: offer.public_id,
    offer_name: offer.offer_name,
  };

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
  const maskedHeaders = maskSecretHeaders(sentHeaders, secretHeaderNames);
  const maskedPayload = maskPaths(payload, tokenPaths);
  const defaultPlacement = await c.env.DB.prepare(
    "SELECT public_id FROM leadgen_offer_placements WHERE offer_id = ? AND is_default = 1 LIMIT 1",
  )
    .bind(offer.id)
    .first<{ public_id: string }>();
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
      defaultPlacement?.public_id ?? null,
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
  });
}
