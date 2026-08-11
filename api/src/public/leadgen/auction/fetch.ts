// LeadGen per-Offer provider fetch (contract 07 §19 steps 6-7). Stage-A
// building block the §19 engine composes: build the payload, resolve
// headers/token, fire ONE bounded-timeout provider request, and return a TYPED
// result plus the REDACTED provider_request_log row-shape for Stage B to
// persist. It NEVER throws into the caller — a timeout, network error, non-2xx,
// or malformed body is a typed `error_reason`, not an exception.
//
// This MIRRORS the §11.6 Test-tool proxy (admin/leadgen/payload-builder-
// handlers.ts) EXACTLY for request construction + secret masking, so the
// auction runtime and the Test tool can never diverge:
//   * headers (04 §11.3): value_kind static → verbatim; macro → resolveMacros;
//     secret_ref → narrow allowlist+binding resolver (any failure ⇒ typed
//     fail-closed result before fetch, never a tokenless request).
//   * token placement (04 §11.3-11.4): header | query (masked in the echoed
//     URL) | payload (injected by buildPayload's token node, server mode only).
//   * environment routing (04 §11.6): endpoint_production | endpoint_staging.
//   * §30.2 secret discipline: the resolved secret VALUES are SENT to the
//     provider but the RETURNED redacted-log shape masks every one of them
//     (secret headers → "[REDACTED]", the token payload node → "[REDACTED]" at
//     its schema path, a query token → "[REDACTED]" in the echoed URL) and
//     PII-hashes the payload/response (09 §30.3) via redact.ts.
//
// The bounded timeout is BOTH an AbortController (aborts the underlying fetch)
// AND a `Promise.race` against a timer set to the auction's `timeout_ms`
// (07 §28 "Promise.race + Promise.allSettled; a slow provider is dropped at
// timeout and never blocks render"). `fetchProvidersParallel` runs a set with
// `Promise.allSettled` under ONE `auction_request_id` (07 §19 step 7 grouping)
// so one slow/failed provider never sinks the batch.
//
// The FULL unredacted request/response record needed for the encrypted
// `debug_ref` blob (09 §30.3) is returned SEPARATELY as `debug` — clearly
// labelled encrypt-only, mirroring the §11.6 proxy's pre-encryption blob. The
// `redacted_log` shape itself is secret-free by construction.

import type { Env, OutboundSecretReferenceFailureCode } from "../../../env";
import { resolveAllowedOutboundSecretReference } from "../../../env";
import { ulid } from "../../../leadgen/ids";
// 0056: the operator-pasted token, sealed in D1. Preferred over the legacy
// wrangler-secret reference, which no admin screen asks for any more.
import { offerApiTokenFailureMessage, resolveOfferApiToken } from "../../../leadgen/offer-api-token";
import { resolveMacros } from "../../../leadgen/macros";
import {
  buildPayload,
  type LeadgenAnswerBinding,
  type LeadgenPayloadSchema,
} from "../../../leadgen/payload";
import {
  REDACTED_VALUE,
  maskPaths,
  maskSecretHeaders,
  redactPii,
  redactSecretText,
  redactSecretValues,
} from "../../../leadgen/redact";
import { safeErrorCode, safeErrorName } from "../../../safety/safe-error";
import type {
  LeadgenEnvironment,
  LeadgenOfferHeaderRow,
  LeadgenOfferRow,
} from "../../../admin/leadgen/db-types";

// The typed provider error taxonomy (mirrors the §11.6 proxy):
//   timeout            — the bounded AbortController/race fired,
//   network_error      — fetch rejected (DNS/TLS/connection),
//   malformed_response — a body arrived but is not valid JSON,
//   no_endpoint        — the chosen environment has no configured endpoint
//                        (config error: no request is made),
//   no_runtime_context — the caller supplied no runtime macro context
//                        (fix-contract v2.4 04 §4.7.1: context absence is a
//                        PROGRAMMING error → typed exclusion; a payload built
//                        against an empty macro set is never silently POSTed),
//   secret_reference_invalid — a configured credential reference is unsafe,
//                        disallowed, missing or empty (no request is made),
//   http_<status>      — a non-2xx HTTP status.
export type LeadgenProviderErrorReason =
  | "timeout"
  | "network_error"
  | "malformed_response"
  | "no_endpoint"
  | "no_runtime_context"
  | "secret_reference_invalid"
  | `http_${number}`;

// A typed diagnostic note (09 §30.2), structurally identical to the §11.6
// Test-tool note: the credential leg that failed and why. NEVER an exception;
// any credential-resolution note accompanies a fail-closed, pre-fetch result.
export interface LeadgenFetchNote {
  scope: "header" | "token";
  code:
    | "secret_absent"
    | "secret_not_allowed"
    | "secret_name_invalid"
    | "secret_infrastructure_reference"
    | "secret_prefix_required"
    | "secret_mode_invalid"
    // 0056: the offer carries a VAULTED token that could not be opened (key
    // rotated away / malformed row). Fails CLOSED — never a tokenless request.
    | "token_vault_unreadable"
    | "token_param_name_missing"
    | "token_node_missing";
  header_name?: string;
  secret_ref?: string;
  message: string;
}

// The redacted provider_request_log columns fetch.ts can fill (09 §30.3).
// Secret-free BY CONSTRUCTION: secret headers masked, the token payload node
// masked at its path, PII hashed. Stage B stamps the grouping ids
// (auction_instance_id / auction_request_id) and the post-parse
// parsed_carriers_json, then persists.
export interface LeadgenProviderRequestLogRedacted {
  provider_request_id: string;
  offer_public_id: string;
  placement_public_id: string | null;
  carrier_parse_version: number | null;
  environment: LeadgenEnvironment;
  status_code: number | null;
  latency_ms: number;
  request_headers_redacted_json: string;
  request_payload_redacted_json: string;
  response_redacted_json: string | null;
  provider_error_reason: string | null;
  error_text: string | null;
}

// The FULL unredacted request/response record — ENCRYPT-ONLY, for Stage B's
// AES-GCM `debug_ref` blob (09 §30.3). MUST NOT be persisted to any
// admin-visible column; only `redacted_log` may. Mirrors the §11.6 proxy blob.
export interface LeadgenProviderDebugRecord {
  url: string;
  method: string;
  request_headers: Record<string, string>;
  request_payload: Record<string, unknown>;
  status_code: number | null;
  response_body: string | null;
  environment: LeadgenEnvironment;
}

export interface FetchProviderResult {
  provider_request_id: string;
  offer_public_id: string;
  environment: LeadgenEnvironment;
  status: number | null;
  latency_ms: number;
  // Raw response text (null when the request never returned a body).
  body: string | null;
  // The JSON-parsed body, present ONLY when the body parsed as JSON. Stage B
  // feeds this (or `body`) to parseProviderResponse (§19 step 8).
  parsed?: unknown;
  error_reason: LeadgenProviderErrorReason | null;
  error_text: string | null;
  timed_out: boolean;
  notes: LeadgenFetchNote[];
  redacted_log: LeadgenProviderRequestLogRedacted;
  debug: LeadgenProviderDebugRecord;
}

// The runtime build + timeout context (07 §19 steps 6-7). `answers` are the
// server re-normalized answers (§19 step 3); `macros`/`computed` are the
// canonical runtime-context projections (04 §4.7.1 — REQUIRED at runtime: the
// engine builds them via buildLeadgenRuntimeContext; an absent `macros` is a
// programming error and yields the typed `no_runtime_context` exclusion, never
// a silent empty POST); `timeout_ms` is the auction's per-request bound
// (§18.1).
export interface FetchProviderContext {
  answers: Readonly<Record<string, unknown>>;
  // The Section-owned question→field bindings for THIS Offer, keyed by payload
  // field path (owner ruling 2026-08-12 — see leadgen/answer-bindings.ts). A
  // source:"answer" field with no binding resolves absent; the engine always
  // supplies the map (possibly empty), it is optional only for legacy harnesses.
  answer_bindings?: Readonly<Record<string, readonly LeadgenAnswerBinding[]>>;
  macros?: Readonly<Record<string, string>>;
  computed?: Readonly<Record<string, unknown>>;
  // The Offer in scope (04 §4.5) — buildPayload's source:"placement" resolves
  // from offer.placement_id. Bridged from LeadGenRuntimeContext.offer.
  offer?: Readonly<{ offer_id?: string; offer_name?: string; placement_id?: string }>;
  // LeadGen Rework M10/D3 (stamp-only): the routing feed_name for this
  // attempt (bridged from LeadGenRuntimeContext.feed_name — runtime-context.ts
  // resolveRoutingOutcomeDims), threaded into buildPayload's ctx.feed_name so
  // a macro:"feed_name" payload node can map it. A caller whose `macros`
  // already carries the canonical "feed_name" key (runtime-context.ts
  // contextToMacros populates one, same as every other canonical macro) does
  // not strictly need this — it is the SAME belt-and-suspenders fallback
  // payload.ts's resolveNode already applies when ctx.macros.feed_name is
  // absent (e.g. a caller supplying feed_name without the full macros object).
  feed_name?: string;
  timeout_ms: number;
  // Stamped onto the redacted log row (issue 21 / §7.4). Optional — Stage B
  // may fill them instead.
  carrier_parse_version?: number | null;
  placement_public_id?: string | null;
  // Injectable id factory for deterministic tests (default: ulid()).
  mintId?: () => string;
}

const DEFAULT_TIMEOUT_MS = 2_500; // 07 §18.1 leadgen_auctions.timeout_ms default

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function is2xx(status: number | null): boolean {
  return status !== null && status >= 200 && status < 300;
}

function boundedTimeout(timeoutMs: number): number {
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : DEFAULT_TIMEOUT_MS;
}

function secretFailureNoteCode(
  code: OutboundSecretReferenceFailureCode,
): LeadgenFetchNote["code"] {
  switch (code) {
    case "binding_missing":
      return "secret_absent";
    case "not_allowed":
      return "secret_not_allowed";
    case "invalid_syntax":
      return "secret_name_invalid";
    case "infrastructure_reference":
      return "secret_infrastructure_reference";
    case "prefix_required":
      return "secret_prefix_required";
  }
}

// Sentinel the timeout arm of the race resolves with (distinct from any
// Response). Boxed so a Response can never be mistaken for it.
const TIMEOUT_SENTINEL = { __lg_timeout: true } as const;

// Fire ONE provider request for a dynamic Offer (07 §19 steps 6-7). Builds the
// payload, resolves headers + token exactly like the §11.6 proxy, races a
// bounded timeout, and returns a typed result + the redacted log shape. NEVER
// throws.
export async function fetchProvider(
  env: Env,
  offer: LeadgenOfferRow,
  headers: readonly LeadgenOfferHeaderRow[],
  payloadSchema: LeadgenPayloadSchema,
  ctx: FetchProviderContext,
  environment: LeadgenEnvironment,
): Promise<FetchProviderResult> {
  const mintId = ctx.mintId ?? ulid;
  const providerRequestId = mintId();
  const notes: LeadgenFetchNote[] = [];
  // 04 §4.7.1: NO `?? {}` default — a missing runtime context is a programming
  // error (the engine always builds one via buildLeadgenRuntimeContext). The
  // typed no-call exclusion is returned after the log-shape builder below.
  const missingRuntimeContext = ctx.macros === undefined;
  const macroValues: Readonly<Record<string, string>> = ctx.macros ?? {};
  const serverMode = offer.request_execution_mode === "server";
  let secretResolutionFailed = false;
  const resolvedSecretValues = new Set<string>();

  const endpointRaw = environment === "staging" ? offer.endpoint_staging : offer.endpoint_production;
  const endpoint = typeof endpointRaw === "string" ? endpointRaw.trim() : "";

  // --- token secret (09 §30.2: absent ⇒ typed no-op, never a throw) --------
  const secretRef =
    typeof offer.api_token_secret_ref === "string" && offer.api_token_secret_ref.trim() !== ""
      ? offer.api_token_secret_ref.trim()
      : null;
  // Every configured reference is validated, even on an inconsistent
  // client-mode row. Client mode may reference no secret (§10.3), so a valid
  // binding on such a row still fails closed rather than producing a tokenless
  // server fetch.
  let tokenValue: string | undefined;
  // 0056 resolution ORDER: the vaulted token the operator pasted wins; the
  // legacy secret reference is consulted only when no token is stored. A vault
  // failure never silently degrades to the legacy path — it fails closed.
  const vaulted = await resolveOfferApiToken(env, offer);
  if (vaulted.kind === "failed") {
    secretResolutionFailed = true;
    notes.push({
      scope: "token",
      code: "token_vault_unreadable",
      message: offerApiTokenFailureMessage(vaulted.code),
    });
  } else if (vaulted.kind === "stored") {
    if (!serverMode) {
      secretResolutionFailed = true;
      notes.push({
        scope: "token",
        code: "secret_mode_invalid",
        message: "client-mode offers may not store an API token",
      });
    } else {
      tokenValue = vaulted.value;
      // Feeds the redaction set: the pasted token is masked in every log leg
      // exactly like a wrangler-resolved one.
      resolvedSecretValues.add(vaulted.value);
    }
  } else if (secretRef !== null) {
    const resolution = resolveAllowedOutboundSecretReference(env, secretRef);
    if (!resolution.ok) {
      secretResolutionFailed = true;
      notes.push({
        scope: "token",
        code: secretFailureNoteCode(resolution.code),
        secret_ref: secretRef,
        message: `outbound token reference rejected (${resolution.code})`,
      });
    } else if (!serverMode) {
      secretResolutionFailed = true;
      notes.push({
        scope: "token",
        code: "secret_mode_invalid",
        secret_ref: secretRef,
        message: "client-mode offers may not configure an outbound token reference",
      });
    } else {
      tokenValue = resolution.value;
      resolvedSecretValues.add(resolution.value);
    }
  }

  // --- build payload (04 §11.5 — token node injected only for payload placement + server mode)
  const payload = buildPayload(payloadSchema, {
    answers: ctx.answers,
    ...(ctx.answer_bindings !== undefined ? { answer_bindings: ctx.answer_bindings } : {}),
    macros: macroValues,
    ...(ctx.computed !== undefined ? { computed: ctx.computed } : {}),
    ...(ctx.offer !== undefined ? { offer: ctx.offer } : {}),
    ...(ctx.feed_name !== undefined ? { feed_name: ctx.feed_name } : {}),
    token: {
      ...(tokenValue !== undefined ? { value: tokenValue } : {}),
      api_token_placement: offer.api_token_placement,
      request_execution_mode: offer.request_execution_mode,
    },
  });
  const tokenPaths = payloadSchema.root.children
    .filter((node) => node.source === "token")
    .map((node) => node.path);

  // --- resolve headers (04 §11.3: static verbatim | macro | secret_ref) ----
  const sentHeaders: Record<string, string> = {};
  const secretHeaderNames = new Set<string>();
  for (const row of headers) {
    const valueText = row.value_text ?? "";
    if (row.value_kind === "static") {
      sentHeaders[row.header_name] = valueText;
    } else if (row.value_kind === "macro") {
      sentHeaders[row.header_name] = resolveMacros(valueText, macroValues);
    } else {
      // secret_ref
      const resolution =
        valueText === ""
          ? ({ ok: false, code: "invalid_syntax" } as const)
          : resolveAllowedOutboundSecretReference(env, valueText);
      if (!resolution.ok) {
        secretResolutionFailed = true;
        notes.push({
          scope: "header",
          code: secretFailureNoteCode(resolution.code),
          header_name: row.header_name,
          secret_ref: valueText,
          message: `outbound header reference rejected (${resolution.code})`,
        });
      } else if (!serverMode) {
        secretResolutionFailed = true;
        notes.push({
          scope: "header",
          code: "secret_mode_invalid",
          header_name: row.header_name,
          secret_ref: valueText,
          message: "client-mode offers may not configure an outbound secret header",
        });
      } else {
        sentHeaders[row.header_name] = resolution.value;
        secretHeaderNames.add(row.header_name.toLowerCase());
        resolvedSecretValues.add(resolution.value);
      }
    }
  }

  // --- token placement (04 §11.3-11.4: header | query | payload) -----------
  let requestUrl = endpoint;
  let displayUrl = endpoint;
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

  // The redacted-log + debug builder — used by both the no-endpoint early
  // return and the post-fetch return so the shape is minted identically.
  const buildResult = (
    status: number | null,
    bodyText: string | null,
    parsedJson: unknown,
    responseIsJson: boolean,
    errorReason: LeadgenProviderErrorReason | null,
    errorText: string | null,
    latencyMs: number,
    timedOut: boolean,
  ): FetchProviderResult => {
    const secretValues = [...resolvedSecretValues];
    const safeBodyText = bodyText === null ? null : redactSecretText(bodyText, secretValues);
    const safeParsedJson = responseIsJson
      ? redactSecretValues(parsedJson, secretValues)
      : undefined;
    const maskedHeaders = maskSecretHeaders(sentHeaders, secretHeaderNames);
    const maskedPayload = maskPaths(payload, tokenPaths);
    const redacted_log: LeadgenProviderRequestLogRedacted = {
      provider_request_id: providerRequestId,
      offer_public_id: offer.public_id,
      placement_public_id: ctx.placement_public_id ?? null,
      carrier_parse_version: ctx.carrier_parse_version ?? null,
      environment,
      status_code: status,
      latency_ms: latencyMs,
      request_headers_redacted_json: JSON.stringify(maskedHeaders),
      request_payload_redacted_json: JSON.stringify(redactPii(maskedPayload)),
      response_redacted_json: responseIsJson ? JSON.stringify(redactPii(safeParsedJson)) : null,
      provider_error_reason: errorReason,
      error_text: errorText,
    };
    const debug: LeadgenProviderDebugRecord = {
      url: requestUrl,
      method,
      request_headers: sentHeaders,
      request_payload: payload,
      status_code: status,
      response_body: bodyText,
      environment,
    };
    const result: FetchProviderResult = {
      provider_request_id: providerRequestId,
      offer_public_id: offer.public_id,
      environment,
      status,
      latency_ms: latencyMs,
      body: safeBodyText,
      error_reason: errorReason,
      error_text: errorText,
      timed_out: timedOut,
      notes,
      redacted_log,
      debug,
    };
    if (responseIsJson) result.parsed = safeParsedJson;
    return result;
  };

  // Section 18.7: a configured secret leg must never degrade to a request
  // without that credential. This gate is before every provider fetch.
  if (secretResolutionFailed) {
    return buildResult(
      null,
      null,
      undefined,
      false,
      "secret_reference_invalid",
      "outbound secret reference rejected",
      0,
      false,
    );
  }

  // --- 04 §4.7.1 context gate: a missing runtime context is a typed no-call
  // exclusion (never a silent empty-macro POST) — checked BEFORE the endpoint
  // so the reason names the actual defect.
  if (missingRuntimeContext) {
    return buildResult(null, null, undefined, false, "no_runtime_context", null, 0, false);
  }

  // --- environment routing: a missing endpoint is a typed no-op, never a fetch
  if (endpoint === "") {
    return buildResult(null, null, undefined, false, "no_endpoint", null, 0, false);
  }

  // --- bounded fetch: AbortController + Promise.race against a timer ---------
  const controller = new AbortController();
  const timeoutMs = boundedTimeout(ctx.timeout_ms);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const started = Date.now();
  let status: number | null = null;
  let bodyText: string | null = null;
  let errorReason: LeadgenProviderErrorReason | null = null;
  let errorText: string | null = null;
  let timedOut = false;
  try {
    const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(TIMEOUT_SENTINEL);
      }, timeoutMs);
    });
    const raced = await Promise.race([
      fetch(requestUrl, {
        method,
        headers: sentHeaders,
        body: hasBody ? JSON.stringify(payload) : undefined,
        redirect: "manual",
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);
    if ("__lg_timeout" in raced) {
      timedOut = true;
      errorReason = "timeout";
    } else {
      const responseStatus = raced.status;
      status = responseStatus;
      bodyText = await raced.text();
      if (!is2xx(responseStatus)) errorReason = `http_${responseStatus}`;
    }
  } catch (err) {
    const name = safeErrorName(err);
    if (name === "AbortError") {
      timedOut = true;
      errorReason = "timeout";
    } else {
      errorReason = "network_error";
    }
    errorText = safeErrorCode("provider_fetch_failed", err);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  const latencyMs = Date.now() - started;

  // --- classify the body (JSON vs malformed) --------------------------------
  let parsedJson: unknown;
  let responseIsJson = false;
  if (bodyText !== null && bodyText !== "") {
    try {
      parsedJson = JSON.parse(bodyText) as unknown;
      responseIsJson = true;
    } catch {
      responseIsJson = false;
    }
  }
  // A 2xx body that is not JSON is malformed (07 §18.9 malformed_response_rate);
  // only classify when no transport error already claimed the reason.
  if (errorReason === null && bodyText !== null && bodyText !== "" && !responseIsJson) {
    errorReason = "malformed_response";
  }

  return buildResult(
    status,
    bodyText,
    parsedJson,
    responseIsJson,
    errorReason,
    errorText,
    latencyMs,
    timedOut,
  );
}

// One provider request in a parallel batch. Each carries its own Offer config +
// build context (payload schema + macros with the Offer's own {offer_id} differ
// per Offer).
export interface ParallelProviderRequest {
  offer: LeadgenOfferRow;
  headers: readonly LeadgenOfferHeaderRow[];
  payloadSchema: LeadgenPayloadSchema;
  ctx: FetchProviderContext;
}

export interface ParallelProviderResult {
  // 07 §19 step 7: the one id that groups this run's provider_request_log rows.
  auction_request_id: string;
  results: FetchProviderResult[];
}

// Fire a whole candidate set in parallel (07 §19 step 7 + §28). ONE
// `auction_request_id` groups them; each request is independently
// timeout-bounded inside fetchProvider, so a slow provider is dropped at its
// own timeout and never blocks the batch. `Promise.allSettled` guarantees one
// provider's failure (even a defensive throw fetchProvider should never emit)
// can never sink the others. Order is preserved (results[i] ↔ requests[i]).
export async function fetchProvidersParallel(
  env: Env,
  requests: readonly ParallelProviderRequest[],
  environment: LeadgenEnvironment,
  opts?: { auctionRequestId?: string; mintId?: () => string },
): Promise<ParallelProviderResult> {
  const mintId = opts?.mintId ?? ulid;
  const auctionRequestId = opts?.auctionRequestId ?? mintId();

  const settled = await Promise.allSettled(
    requests.map((req) =>
      fetchProvider(env, req.offer, req.headers, req.payloadSchema, req.ctx, environment),
    ),
  );

  const results: FetchProviderResult[] = settled.map((outcome, index) => {
    if (outcome.status === "fulfilled") return outcome.value;
    // Defensive ONLY: fetchProvider is contracted never to reject. If a future
    // change ever lets one through, synthesize a network_error result so the
    // batch stays whole rather than propagating the rejection.
    const req = requests[index];
    const message = safeErrorCode("provider_fetch_failed", outcome.reason);
    return {
      provider_request_id: mintId(),
      offer_public_id: req?.offer.public_id ?? "",
      environment,
      status: null,
      latency_ms: 0,
      body: null,
      error_reason: "network_error",
      error_text: message,
      timed_out: false,
      notes: [],
      redacted_log: {
        provider_request_id: "",
        offer_public_id: req?.offer.public_id ?? "",
        placement_public_id: req?.ctx.placement_public_id ?? null,
        carrier_parse_version: req?.ctx.carrier_parse_version ?? null,
        environment,
        status_code: null,
        latency_ms: 0,
        request_headers_redacted_json: "{}",
        request_payload_redacted_json: "{}",
        response_redacted_json: null,
        provider_error_reason: "network_error",
        error_text: message,
      },
      debug: {
        url: "",
        method: req?.offer.request_method ?? "POST",
        request_headers: {},
        request_payload: {},
        status_code: null,
        response_body: null,
        environment,
      },
    } satisfies FetchProviderResult;
  });

  return { auction_request_id: auctionRequestId, results };
}
