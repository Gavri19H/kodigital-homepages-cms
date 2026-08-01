import { Hono } from "hono";
import type { Context } from "hono";
import type { AccessAuthVariables } from "../../auth/access-auth";
import { isConversionsProxyEnabled, type Env } from "../../env";
import {
  ACTOR_CONTEXT_HEADER,
  ACTOR_OPERATION_SCOPE_HEADER,
  ACTOR_REQUEST_ID_HEADER,
  ActorIssuanceError,
  CONNECTION_TEST_SCOPE_VERSION,
  REPORT_DELIVERY_SCOPE_VERSION,
  issuePermanentActorContext,
  isUuidV7,
  signOperationScope,
  type IssuedActorContext,
} from "./actor-envelope";
import {
  PermanentAuthorityError,
  resolvePermanentConversionsActor,
} from "./permanent-authority";

type ProxyEnv = { Bindings: Env; Variables: AccessAuthVariables };
type ProxyContext = Context<ProxyEnv>;

export const conversionsProxy = new Hono<ProxyEnv>();

const API_PREFIX = "/api/admin/conversions/v1";
const MAX_REQUEST_BODY_BYTES = 32_768;
// actor_context.v2 can carry the complete canonical 256-account CMS scope.
// The bounded authority parser caps its source JSON at 65,536 bytes.
const MAX_ACTOR_HEADER_BYTES = 65_536;
const MAX_OPERATION_SCOPE_HEADER_BYTES = 8_192;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const SAFE_TEST_KIND = /^[a-z][a-z0-9._:-]{0,127}$/;
const JSON_CONTENT_TYPE = /^application\/json$/i;

export const CMS_CANONICAL_TARGET_POLICY = Object.freeze({
  version: 1,
  pathname_source: "whatwg_request_url_pathname",
  route_operation_scope_source: "same_normalized_pathname",
  cms_request_id_header: ACTOR_REQUEST_ID_HEADER.toLowerCase(),
  raw_pre_normalization_path_available: false,
} as const);

export const CMS_BOOTSTRAP_POLICY_BY_OPERATION = Object.freeze({
  "connections.read": "allowed",
  "connections.create": "allowed",
  "connections.update": "allowed",
  "connections.credentials.write": "allowed",
  "connections.test.side_effect_free": "allowed",
  "connections.test.sandbox": "permanent_only",
  "connections.test.production_external": "permanent_only",
  "connections.oauth.start": "allowed",
  "connections.oauth.complete": "allowed",
  "connections.archive": "allowed",
  "flows.read": "allowed",
  "flows.draft.write": "allowed",
  "flows.preview": "allowed",
  "flows.publish.preview": "allowed",
  "flows.publish.commit": "permanent_only",
  "flows.pause": "allowed",
  "flows.resume": "permanent_only",
  "flows.rollback": "permanent_only",
  "flows.archive": "allowed",
  "ownership.read": "allowed",
  "ownership.claim.preview": "allowed",
  "ownership.activate": "permanent_only",
  "ownership.release.preview": "allowed",
  "ownership.release": "permanent_only",
  "ownership.correct.preview": "allowed",
  "ownership.correct": "permanent_only",
  "activity.read": "allowed",
  "runs.manual.start": "permanent_only",
  "activity.replay.reporting_only.preview": "allowed",
  "activity.replay.reporting_only.commit": "allowed",
  "activity.external_generation.preview": "permanent_only",
  "activity.external_generation.commit": "permanent_only",
  "activity.delivery.cancel": "permanent_only",
  "reports.read": "allowed",
  "reports.query": "allowed",
  "reports.create": "allowed",
  "reports.update": "allowed",
  "reports.duplicate": "allowed",
  "reports.archive": "allowed",
  "reports.exports.create": "allowed",
  "reports.exports.read": "allowed",
  "reports.exports.download": "allowed",
  "reports.schedules.read": "allowed",
  "reports.schedules.create.disabled": "allowed",
  "reports.schedules.create.enabled": "permanent_only",
  "reports.schedules.update.disabled": "allowed",
  "reports.schedules.update.sending": "permanent_only",
  "reports.schedules.disable": "allowed",
  "reports.schedules.delete": "allowed",
  "reports.recipients.read": "allowed",
  "reports.recipients.create": "permanent_only",
  "reports.recipients.verify": "permanent_only",
  "reports.recipients.archive": "allowed",
  "controls.read": "allowed",
  "controls.update": "permanent_only",
  "controls.dashboard_conversion_revenue.enable": "permanent_only",
  "controls.dashboard_conversion_revenue.disable": "allowed",
  "uploads.read": "allowed",
  "uploads.init": "allowed",
  "uploads.complete": "allowed",
  "migration.activate": "permanent_only",
} as const);

type CmsOperation = keyof typeof CMS_BOOTSTRAP_POLICY_BY_OPERATION;
type RouteSelector =
  | "fixed"
  | "connection_test"
  | "replay"
  | "report_schedule_create"
  | "report_schedule_update"
  | "report_schedule_delete"
  | "report_recipient_create"
  | "report_recipient_verify"
  | "report_recipient_archive"
  | "control_update";

export interface CmsProxyRoutePolicy {
  readonly method: string;
  readonly template: string;
  readonly selector: RouteSelector;
  readonly operations: ReadonlyArray<CmsOperation>;
}

function routePolicy(
  method: string,
  template: string,
  selector: RouteSelector,
  ...operations: CmsOperation[]
): CmsProxyRoutePolicy {
  return Object.freeze({ method, template, selector, operations: Object.freeze(operations) });
}

// This is a production-owned copy of the complete Core route/operation seam.
// A test-only cross-repository assertion byte-compares its semantic fields to
// the generated Core catalog so drift fails before any binding activation.
export const CMS_PROXY_ROUTE_POLICIES = Object.freeze([
  routePolicy("GET", `${API_PREFIX}/connections`, "fixed", "connections.read"),
  routePolicy("POST", `${API_PREFIX}/connections`, "fixed", "connections.create"),
  routePolicy("GET", `${API_PREFIX}/connections/:connection_id`, "fixed", "connections.read"),
  routePolicy("PATCH", `${API_PREFIX}/connections/:connection_id`, "fixed", "connections.update"),
  routePolicy("POST", `${API_PREFIX}/connections/:connection_id/credentials`, "fixed", "connections.credentials.write"),
  routePolicy("POST", `${API_PREFIX}/connections/:connection_id/test`, "connection_test", "connections.test.side_effect_free", "connections.test.sandbox", "connections.test.production_external"),
  routePolicy("POST", `${API_PREFIX}/connections/:connection_id/oauth/start`, "fixed", "connections.oauth.start"),
  routePolicy("POST", `${API_PREFIX}/connections/:connection_id/oauth/complete`, "fixed", "connections.oauth.complete"),
  routePolicy("POST", `${API_PREFIX}/connections/:connection_id/archive`, "fixed", "connections.archive"),
  routePolicy("GET", `${API_PREFIX}/flows`, "fixed", "flows.read"),
  routePolicy("POST", `${API_PREFIX}/flows`, "fixed", "flows.draft.write"),
  routePolicy("GET", `${API_PREFIX}/flows/:flow_id`, "fixed", "flows.read"),
  routePolicy("POST", `${API_PREFIX}/flows/:flow_id/drafts`, "fixed", "flows.draft.write"),
  routePolicy("GET", `${API_PREFIX}/flows/:flow_id/drafts/:version`, "fixed", "flows.read"),
  routePolicy("PATCH", `${API_PREFIX}/flows/:flow_id/drafts/:version`, "fixed", "flows.draft.write"),
  routePolicy("POST", `${API_PREFIX}/flows/:flow_id/drafts/:version/source-preview`, "fixed", "flows.preview"),
  routePolicy("POST", `${API_PREFIX}/flows/:flow_id/drafts/:version/rule-preview`, "fixed", "flows.preview"),
  routePolicy("POST", `${API_PREFIX}/flows/:flow_id/drafts/:version/destination-preview`, "fixed", "flows.preview"),
  routePolicy("POST", `${API_PREFIX}/flows/:flow_id/drafts/:version/publish-preview`, "fixed", "flows.publish.preview"),
  routePolicy("POST", `${API_PREFIX}/flows/:flow_id/drafts/:version/publish`, "fixed", "flows.publish.commit"),
  routePolicy("POST", `${API_PREFIX}/flows/:flow_id/pause`, "fixed", "flows.pause"),
  routePolicy("POST", `${API_PREFIX}/flows/:flow_id/resume`, "fixed", "flows.resume"),
  routePolicy("POST", `${API_PREFIX}/flows/:flow_id/rollback`, "fixed", "flows.rollback"),
  routePolicy("POST", `${API_PREFIX}/flows/:flow_id/run`, "fixed", "runs.manual.start"),
  routePolicy("POST", `${API_PREFIX}/flows/:flow_id/archive`, "fixed", "flows.archive"),
  routePolicy("GET", `${API_PREFIX}/runs`, "fixed", "activity.read"),
  routePolicy("GET", `${API_PREFIX}/runs/:run_id`, "fixed", "activity.read"),
  routePolicy("GET", `${API_PREFIX}/runs/:run_id/issues`, "fixed", "activity.read"),
  routePolicy("GET", `${API_PREFIX}/activity/health`, "fixed", "activity.read"),
  routePolicy("GET", `${API_PREFIX}/events`, "fixed", "activity.read"),
  routePolicy("GET", `${API_PREFIX}/events/:event_id/history`, "fixed", "activity.read"),
  routePolicy("GET", `${API_PREFIX}/deliveries`, "fixed", "activity.read"),
  routePolicy("GET", `${API_PREFIX}/deliveries/:delivery_id`, "fixed", "activity.read"),
  routePolicy("POST", `${API_PREFIX}/deliveries/:delivery_id/cancel`, "fixed", "activity.delivery.cancel"),
  routePolicy("POST", `${API_PREFIX}/replays/preview`, "replay", "activity.replay.reporting_only.preview", "activity.external_generation.preview"),
  routePolicy("POST", `${API_PREFIX}/replays`, "replay", "activity.replay.reporting_only.commit", "activity.external_generation.commit"),
  routePolicy("GET", `${API_PREFIX}/replays/:replay_id`, "fixed", "activity.read"),
  routePolicy("GET", `${API_PREFIX}/ownership`, "fixed", "ownership.read"),
  routePolicy("POST", `${API_PREFIX}/ownership/claim-preview`, "fixed", "ownership.claim.preview"),
  routePolicy("GET", `${API_PREFIX}/ownership/:claim_id`, "fixed", "ownership.read"),
  routePolicy("POST", `${API_PREFIX}/ownership/:claim_id/activate`, "fixed", "ownership.activate"),
  routePolicy("POST", `${API_PREFIX}/ownership/:claim_id/release-preview`, "fixed", "ownership.release.preview"),
  routePolicy("POST", `${API_PREFIX}/ownership/:claim_id/release`, "fixed", "ownership.release"),
  routePolicy("POST", `${API_PREFIX}/ownership/:claim_id/correct-preview`, "fixed", "ownership.correct.preview"),
  routePolicy("POST", `${API_PREFIX}/ownership/:claim_id/correct`, "fixed", "ownership.correct"),
  routePolicy("GET", `${API_PREFIX}/reports`, "fixed", "reports.read"),
  routePolicy("POST", `${API_PREFIX}/reports`, "fixed", "reports.create"),
  routePolicy("POST", `${API_PREFIX}/reports/preview`, "fixed", "reports.query"),
  routePolicy("GET", `${API_PREFIX}/reports/:report_id`, "fixed", "reports.read"),
  routePolicy("PATCH", `${API_PREFIX}/reports/:report_id`, "fixed", "reports.update"),
  routePolicy("POST", `${API_PREFIX}/reports/:report_id/query`, "fixed", "reports.query"),
  routePolicy("POST", `${API_PREFIX}/reports/:report_id/drill-through`, "fixed", "reports.query"),
  routePolicy("POST", `${API_PREFIX}/reports/:report_id/duplicate`, "fixed", "reports.duplicate"),
  routePolicy("POST", `${API_PREFIX}/reports/:report_id/archive`, "fixed", "reports.archive"),
  routePolicy("GET", `${API_PREFIX}/reports/:report_id/schedules`, "fixed", "reports.schedules.read"),
  routePolicy("POST", `${API_PREFIX}/reports/:report_id/schedules`, "report_schedule_create", "reports.schedules.create.disabled", "reports.schedules.create.enabled"),
  routePolicy("PATCH", `${API_PREFIX}/reports/:report_id/schedules/:schedule_id`, "report_schedule_update", "reports.schedules.update.disabled", "reports.schedules.update.sending", "reports.schedules.disable"),
  routePolicy("DELETE", `${API_PREFIX}/reports/:report_id/schedules/:schedule_id`, "report_schedule_delete", "reports.schedules.delete"),
  routePolicy("POST", `${API_PREFIX}/exports`, "fixed", "reports.exports.create"),
  routePolicy("GET", `${API_PREFIX}/exports/:export_id`, "fixed", "reports.exports.read"),
  routePolicy("GET", `${API_PREFIX}/exports/:export_id/download`, "fixed", "reports.exports.download"),
  routePolicy("GET", `${API_PREFIX}/report-recipients`, "fixed", "reports.recipients.read"),
  routePolicy("POST", `${API_PREFIX}/report-recipients`, "report_recipient_create", "reports.recipients.create"),
  routePolicy("POST", `${API_PREFIX}/report-recipients/:recipient_id/verify`, "report_recipient_verify", "reports.recipients.verify"),
  routePolicy("POST", `${API_PREFIX}/report-recipients/:recipient_id/archive`, "report_recipient_archive", "reports.recipients.archive"),
  routePolicy("GET", `${API_PREFIX}/controls`, "fixed", "controls.read"),
  routePolicy("PATCH", `${API_PREFIX}/controls/:control_key`, "control_update", "controls.update", "controls.dashboard_conversion_revenue.enable", "controls.dashboard_conversion_revenue.disable"),
  routePolicy("POST", `${API_PREFIX}/uploads/init`, "fixed", "uploads.init"),
  routePolicy("POST", `${API_PREFIX}/uploads/:upload_id/complete`, "fixed", "uploads.complete"),
  routePolicy("GET", `${API_PREFIX}/uploads/:upload_id`, "fixed", "uploads.read"),
  routePolicy("POST", `${API_PREFIX}/migration/activate`, "fixed", "migration.activate"),
] as const);

const ROUTE_PARAMETER_PATTERNS = Object.freeze({
  connection_id: "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
  flow_id: "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
  run_id: "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
  event_id: "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
  delivery_id: "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
  replay_id: "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
  claim_id: "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
  report_id: "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
  schedule_id: "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
  export_id: "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
  recipient_id: "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
  upload_id: "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
  version: "[1-9][0-9]{0,9}",
  control_key: "[a-z][a-z0-9_]{0,127}",
});

function compileRouteTemplate(template: string): RegExp {
  const source = template.split("/").map((segment) => {
    if (!segment.startsWith(":")) return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = ROUTE_PARAMETER_PATTERNS[segment.slice(1) as keyof typeof ROUTE_PARAMETER_PATTERNS];
    if (pattern === undefined) throw new Error("invalid CMS proxy route parameter");
    return pattern;
  }).join("/");
  return new RegExp(`^${source}$`);
}

const COMPILED_PROXY_ROUTES = Object.freeze(CMS_PROXY_ROUTE_POLICIES.map((policy) => Object.freeze({
  policy,
  pattern: compileRouteTemplate(policy.template),
})));

const REQUEST_HEADER_ALLOWLIST = new Set([
  "accept",
  "content-type",
  "idempotency-key",
  "if-match",
  "if-none-match",
]);
const RESPONSE_HEADER_ALLOWLIST = new Set([
  "content-disposition",
  "content-type",
  "etag",
  "last-modified",
  "retry-after",
]);

type JsonRecord = Record<string, unknown>;

export type CmsActorIssuer = "permanent" | "denied";

export const CMS_ACTOR_ISSUER_BY_OPERATION: Readonly<Record<CmsOperation, CmsActorIssuer>> = Object.freeze(
  Object.fromEntries(Object.keys(CMS_BOOTSTRAP_POLICY_BY_OPERATION).map((operation) => [
    operation,
    operation === "connections.test.production_external" ? "denied" : "permanent",
  ])) as Record<CmsOperation, CmsActorIssuer>,
);

interface OperationSelection {
  readonly operation: CmsOperation;
  readonly scope?: JsonRecord;
}

class ProxyRequestError extends Error {
  constructor(readonly status: number) {
    super("invalid proxy request");
    this.name = "ProxyRequestError";
  }
}

function safeResponse(status: number): Response {
  const message = status === 403
    ? "Forbidden"
    : status === 404
      ? "Not Found"
      : status === 413
        ? "Payload Too Large"
        : status === 415
          ? "Unsupported Media Type"
          : status === 428
            ? "Precondition Required"
            : status === 503
              ? "Service Unavailable"
              : "Bad Request";
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=UTF-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function resolveCanonicalRoute(pathname: string, method: string): CmsProxyRoutePolicy | undefined {
  if (!pathname.startsWith(`${API_PREFIX}/`) || pathname.length > 512
      || pathname.includes("%") || pathname.includes("\\") || pathname.includes("//")
      || pathname.split("/").some((segment) => segment === "." || segment === "..")) {
    return undefined;
  }
  return COMPILED_PROXY_ROUTES.find(({ policy, pattern }) => policy.method === method && pattern.test(pathname))?.policy;
}

function isMutation(method: string): boolean {
  return method === "POST" || method === "PATCH" || method === "DELETE";
}

async function readBoundedBody(request: Request): Promise<ArrayBuffer> {
  if (request.body === null) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The safe 413 result does not depend on upstream cancellation.
        }
        throw new ProxyRequestError(413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

async function readJsonBody(request: Request, method: string): Promise<{ bytes?: ArrayBuffer; json?: JsonRecord }> {
  const transferEncoding = request.headers.get("transfer-encoding");
  const contentLength = request.headers.get("content-length");
  if (transferEncoding !== null) throw new ProxyRequestError(400);
  if (contentLength !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(contentLength)) throw new ProxyRequestError(400);
    const length = Number(contentLength);
    if (!Number.isSafeInteger(length)) throw new ProxyRequestError(400);
    if (length > MAX_REQUEST_BODY_BYTES) throw new ProxyRequestError(413);
  }
  const mutation = isMutation(method);
  if (!mutation) {
    if (contentLength !== null && contentLength !== "0") throw new ProxyRequestError(400);
    if (request.headers.has("content-type")) throw new ProxyRequestError(415);
    return {};
  }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey === null || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
    throw new ProxyRequestError(428);
  }
  if (method === "DELETE") {
    if (contentLength !== null && contentLength !== "0") throw new ProxyRequestError(400);
    if (request.headers.has("content-type")) throw new ProxyRequestError(415);
    return {};
  }
  const contentType = request.headers.get("content-type");
  if (contentType === null || !JSON_CONTENT_TYPE.test(contentType)) throw new ProxyRequestError(415);
  const bytes = await readBoundedBody(request);
  if (contentLength !== null && Number(contentLength) !== bytes.byteLength) throw new ProxyRequestError(400);
  if (bytes.byteLength === 0) throw new ProxyRequestError(400);
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)) as unknown;
  } catch {
    throw new ProxyRequestError(400);
  }
  if (!isRecord(json)) throw new ProxyRequestError(400);
  return { bytes, json };
}

function uuidList(value: unknown, minimum: number, maximum: number): ReadonlyArray<string> {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum || !value.every(isUuidV7)) {
    throw new ProxyRequestError(400);
  }
  const result = [...value].sort();
  if (new Set(result).size !== result.length) throw new ProxyRequestError(400);
  return result;
}

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function canonicalUuidList(value: unknown, minimum: number, maximum: number): ReadonlyArray<string> {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum
      || !value.every((item) => typeof item === "string" && CANONICAL_UUID.test(item))) {
    throw new ProxyRequestError(400);
  }
  const result = [...value].sort();
  if (new Set(result).size !== result.length) throw new ProxyRequestError(400);
  return result;
}

function requireExactBodyKeys(body: JsonRecord | undefined, expected: ReadonlyArray<string>): JsonRecord {
  if (body === undefined) throw new ProxyRequestError(400);
  const actual = Object.keys(body).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new ProxyRequestError(400);
  }
  return body;
}

function selectOperation(
  pathname: string,
  route: CmsProxyRoutePolicy,
  body: JsonRecord | undefined,
): OperationSelection {
  const method = route.method;
  if (route.selector === "fixed") {
    const operation = route.operations[0];
    if (operation === undefined) throw new ProxyRequestError(503);
    return { operation };
  }
  if (route.selector === "report_recipient_create") {
    body = requireExactBodyKeys(body, ["recipient_id"]);
    if (!isUuidV7(body.recipient_id)) throw new ProxyRequestError(400);
    return { operation: "reports.recipients.create", scope: {
      schema_version: REPORT_DELIVERY_SCOPE_VERSION,
      route: pathname,
      method,
      mutation: "recipient_create",
      enabled_transition: "not_applicable",
      delivery_class: "verification_email",
      recipient_scope: [body.recipient_id],
    } };
  }
  if (route.selector === "report_recipient_verify") {
    const matched = pathname.match(new RegExp(`^${API_PREFIX}/report-recipients/([0-9a-f-]+)/verify$`));
    const recipientId = matched?.[1];
    if (!isUuidV7(recipientId)) throw new ProxyRequestError(400);
    return { operation: "reports.recipients.verify", scope: {
      schema_version: REPORT_DELIVERY_SCOPE_VERSION,
      route: pathname,
      method,
      mutation: "recipient_verify",
      enabled_transition: "not_applicable",
      delivery_class: "verification_email",
      recipient_scope: [recipientId],
    } };
  }
  const scheduleCreate = pathname.match(new RegExp(`^${API_PREFIX}/reports/([0-9a-f-]+)/schedules$`));
  if (route.selector === "report_schedule_create" && scheduleCreate !== null) {
    const legacy = !isRecord(body) || !Object.hasOwn(body, "recurrence");
    body = requireExactBodyKeys(body, legacy
      ? ["enabled", "recipient_ids"]
      : ["enabled", "recipient_ids", "recurrence", "format"]);
    if (typeof body.enabled !== "boolean") throw new ProxyRequestError(400);
    if (!legacy && (!isRecord(body.recurrence)
        || !["csv", "xlsx", "pdf"].includes(String(body.format)))) {
      throw new ProxyRequestError(400);
    }
    const operation = body.enabled
      ? "reports.schedules.create.enabled"
      : "reports.schedules.create.disabled";
    return { operation, scope: {
      schema_version: REPORT_DELIVERY_SCOPE_VERSION,
      route: pathname,
      method,
      mutation: "schedule_create",
      enabled_transition: body.enabled ? "created_enabled" : "created_disabled",
      delivery_class: body.enabled ? "scheduled_email" : "none",
      recipient_scope: uuidList(body.recipient_ids, 1, 25),
    } };
  }
  const scheduleMutation = pathname.match(new RegExp(`^${API_PREFIX}/reports/([0-9a-f-]+)/schedules/([0-9a-f-]+)$`));
  if (route.selector === "report_schedule_update" && scheduleMutation !== null) {
    body = requireExactBodyKeys(body, ["previous_enabled", "enabled", "recipient_ids"]);
    if (typeof body.enabled !== "boolean" || typeof body.previous_enabled !== "boolean") throw new ProxyRequestError(400);
    const transition = body.previous_enabled && !body.enabled
      ? "enabled_to_disabled"
      : !body.previous_enabled && !body.enabled
        ? "disabled_unchanged"
        : !body.previous_enabled && body.enabled ? "disabled_to_enabled" : "enabled_unchanged";
    const operation = transition === "enabled_to_disabled"
      ? "reports.schedules.disable"
      : transition === "disabled_unchanged"
        ? "reports.schedules.update.disabled"
        : "reports.schedules.update.sending";
    // previous_enabled is an optimistic precondition, not an authorization
    // assertion. Core must compare it with stored state inside the same
    // authorized mutation transaction before applying the change.
    const recipientScope = transition === "enabled_to_disabled"
      ? uuidList(body.recipient_ids, 0, 0)
      : uuidList(body.recipient_ids, 1, 25);
    return { operation, scope: {
      schema_version: REPORT_DELIVERY_SCOPE_VERSION,
      route: pathname,
      method,
      mutation: "schedule_update",
      enabled_transition: transition,
      delivery_class: body.enabled ? "scheduled_email" : "none",
      recipient_scope: recipientScope,
    } };
  }
  if (route.selector === "report_schedule_delete" && scheduleMutation !== null) {
    return { operation: "reports.schedules.delete", scope: {
      schema_version: REPORT_DELIVERY_SCOPE_VERSION,
      route: pathname,
      method,
      mutation: "schedule_delete",
      enabled_transition: "deleted",
      delivery_class: "none",
      recipient_scope: [],
    } };
  }
  const recipientArchive = pathname.match(new RegExp(`^${API_PREFIX}/report-recipients/([0-9a-f-]+)/archive$`));
  if (route.selector === "report_recipient_archive" && recipientArchive !== null) {
    const recipientId = recipientArchive[1];
    if (!isUuidV7(recipientId)) throw new ProxyRequestError(400);
    return { operation: "reports.recipients.archive", scope: {
      schema_version: REPORT_DELIVERY_SCOPE_VERSION,
      route: pathname,
      method,
      mutation: "recipient_archive",
      enabled_transition: "not_applicable",
      delivery_class: "none",
      recipient_scope: [recipientId],
    } };
  }
  const connectionTest = pathname.match(new RegExp(`^${API_PREFIX}/connections/([0-9a-f-]+)/test$`));
  if (route.selector === "connection_test" && connectionTest !== null) {
    body = requireExactBodyKeys(body, ["test_kind", "sample_limit", "expected_side_effect_mode"]);
    const connectionId = connectionTest[1];
    if (!isUuidV7(connectionId) || typeof body?.test_kind !== "string" || !SAFE_TEST_KIND.test(body.test_kind)) {
      throw new ProxyRequestError(400);
    }
    if (!Number.isSafeInteger(body.sample_limit)
        || (body.sample_limit as number) < 1 || (body.sample_limit as number) > 1_000) {
      throw new ProxyRequestError(400);
    }
    if (typeof body.expected_side_effect_mode !== "string") throw new ProxyRequestError(400);
    if (body.expected_side_effect_mode !== "none" && body.expected_side_effect_mode !== "sandbox"
        && body.expected_side_effect_mode !== "production_external") throw new ProxyRequestError(400);
    const sideEffectMode = body.expected_side_effect_mode;
    const operation: CmsOperation = sideEffectMode === "none"
      ? "connections.test.side_effect_free"
      : sideEffectMode === "sandbox" ? "connections.test.sandbox" : "connections.test.production_external";
    return { operation, scope: {
      schema_version: CONNECTION_TEST_SCOPE_VERSION,
      route: pathname,
      method,
      connection_id: connectionId,
      test_kind: body.test_kind,
      expected_side_effect_mode: sideEffectMode,
      destination_class: sideEffectMode === "sandbox" ? "sandbox" : sideEffectMode === "none" ? "none" : "external",
    } };
  }
  if (route.selector === "replay") {
    if (body === undefined) throw new ProxyRequestError(400);
    const phase = pathname === `${API_PREFIX}/replays/preview` ? "preview" : "commit";
    const legacy = Object.keys(body).length === 2;
    const replayBody = requireExactBodyKeys(body, legacy
      ? ["mode", "destination_scope"]
      : phase === "preview"
        ? ["mode", "destination_scope", "filter", "date_bound"]
        : [
          "mode", "destination_scope", "filter", "date_bound",
          "preview_token", "reason", "typed_count_confirmation",
        ]);
    if (typeof replayBody.mode !== "string") throw new ProxyRequestError(400);
    const operation: CmsOperation | undefined = replayBody.mode === "reporting_only"
      ? `activity.replay.reporting_only.${phase}`
      : replayBody.mode === "external_redelivery" || replayBody.mode === "external_generation"
        ? `activity.external_generation.${phase}` as CmsOperation : undefined;
    if (operation === undefined) throw new ProxyRequestError(400);
    const destinationScope = replayBody.mode === "reporting_only" || (legacy && replayBody.mode === "external_generation")
      ? uuidList(replayBody.destination_scope, 0, 0)
      : uuidList(replayBody.destination_scope, 1, 6);
    const suppliedDestinationScope = replayBody.destination_scope as unknown[];
    if (destinationScope.some((value, index) => value !== suppliedDestinationScope[index])) {
      throw new ProxyRequestError(400);
    }
    if (!legacy) {
      if (!isRecord(replayBody.filter) || !isRecord(replayBody.date_bound)) throw new ProxyRequestError(400);
      const filter = requireExactBodyKeys(replayBody.filter, ["kind", "ids"]);
      const dateBound = requireExactBodyKeys(replayBody.date_bound, ["start", "end"]);
      if (filter.kind !== "all" && filter.kind !== "event_ids"
          && filter.kind !== "delivery_ids") throw new ProxyRequestError(400);
      const ids = canonicalUuidList(filter.ids, filter.kind === "all" ? 0 : 1, 100);
      const suppliedIds = filter.ids as unknown[];
      if ((filter.kind === "all") !== (ids.length === 0)
          || ids.some((value, index) => value !== suppliedIds[index])
          || typeof dateBound.start !== "string" || typeof dateBound.end !== "string"
          || !/^\d{4}-\d{2}-\d{2}$/.test(dateBound.start)
          || !/^\d{4}-\d{2}-\d{2}$/.test(dateBound.end)
          || dateBound.start >= dateBound.end) throw new ProxyRequestError(400);
      if (phase === "commit" && (
        typeof replayBody.preview_token !== "string"
        || !/^[0-9]{1,12}\.[0-9a-f]{64}\.[A-Za-z0-9_-]{43}$/.test(replayBody.preview_token)
        || typeof replayBody.reason !== "string" || !/^[a-z][a-z0-9_.:-]{0,127}$/.test(replayBody.reason)
        || !Number.isSafeInteger(replayBody.typed_count_confirmation)
        || (replayBody.typed_count_confirmation as number) < 0
        || (replayBody.typed_count_confirmation as number) > 100
      )) throw new ProxyRequestError(400);
    }
    // Core derives and validates the unsigned replay scope from the exact body.
    // A client/CMS operation-scope header is deliberately absent for replay.
    return { operation };
  }
  if (route.selector === "control_update") {
    body = requireExactBodyKeys(body, ["value", "row_version", "reason"]);
    if (typeof body.value !== "boolean") throw new ProxyRequestError(400);
    const controlKey = pathname.slice(`${API_PREFIX}/controls/`.length);
    const operation = controlKey === "dashboard_conversion_revenue"
      ? body.value
        ? "controls.dashboard_conversion_revenue.enable"
        : "controls.dashboard_conversion_revenue.disable"
      : "controls.update";
    return { operation };
  }
  throw new ProxyRequestError(503);
}

async function deriveOperationScope(
  selection: OperationSelection,
  actor: IssuedActorContext,
): Promise<unknown | undefined> {
  if (selection.scope === undefined) return undefined;
  const { schema_version, ...scope } = selection.scope;
  return signOperationScope({
    schema_version,
    actor_id: actor.envelope.payload.actor_id,
    workspace_id: actor.envelope.payload.workspace_id,
    request_id: actor.requestId,
    ...scope,
  }, actor.signingKey);
}

function outboundHeaders(
  incoming: Headers,
  method: string,
  actorHeader: string,
  requestId: string,
  operationScope?: string,
): Headers {
  const headers = new Headers();
  for (const [name, value] of incoming) {
    const normalizedName = name.toLowerCase();
    if (normalizedName === "idempotency-key" && !isMutation(method)) continue;
    if (REQUEST_HEADER_ALLOWLIST.has(normalizedName)) headers.set(name, value);
  }
  headers.set(ACTOR_CONTEXT_HEADER, actorHeader);
  headers.set(ACTOR_REQUEST_ID_HEADER, requestId);
  if (operationScope !== undefined) headers.set(ACTOR_OPERATION_SCOPE_HEADER, operationScope);
  return headers;
}

function safeUpstreamResponse(upstream: Response, method: string, requestId: string): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    [ACTOR_REQUEST_ID_HEADER]: requestId,
  });
  for (const [name, value] of upstream.headers) {
    if (RESPONSE_HEADER_ALLOWLIST.has(name.toLowerCase())) headers.set(name, value);
  }
  const bodyForbidden = method === "HEAD" || upstream.status === 204 || upstream.status === 205 || upstream.status === 304;
  return new Response(bodyForbidden ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

async function proxyRequest(c: ProxyContext): Promise<Response> {
  if (!isConversionsProxyEnabled(c.env.CONVERSIONS_PROXY_ENABLED)) return safeResponse(404);
  const access = c.get("access");
  if (access?.mode !== "identity") return safeResponse(403);
  const core = c.env.CONVERSIONS_CORE;
  if (core === undefined || typeof core.fetch !== "function") return safeResponse(503);
  const method = c.req.method.toUpperCase();
  // Workers/Hono expose a WHATWG URL, not the raw pre-normalization request
  // target. Its normalized pathname is therefore the sole CMS target used for
  // route selection, permanent authority, signed scope and binding dispatch.
  const canonicalUrl = new URL(c.req.url);
  const canonicalPathname = canonicalUrl.pathname;
  const route = resolveCanonicalRoute(canonicalPathname, method);
  if (route === undefined) return safeResponse(400);

  let parsed: { bytes?: ArrayBuffer; json?: JsonRecord };
  try {
    parsed = await readJsonBody(c.req.raw, method);
  } catch (error) {
    return safeResponse(error instanceof ProxyRequestError ? error.status : 400);
  }

  try {
    // Route/body grammar selects one closed operation before any actor exists.
    // Issuance therefore cannot influence selection, and caller-supplied actor,
    // operation and scope headers remain ignored.
    const selection = selectOperation(canonicalPathname, route, parsed.json);
    const issuer = CMS_ACTOR_ISSUER_BY_OPERATION[selection.operation];
    if (issuer === undefined) throw new ProxyRequestError(503);
    if (issuer === "denied") throw new ProxyRequestError(403);
    const authority = await resolvePermanentConversionsActor(c.env, access);
    const actor = await issuePermanentActorContext(c.env, authority);
    const operationScope = await deriveOperationScope(selection, actor);
    const actorHeader = JSON.stringify(actor.envelope);
    const operationScopeHeader = operationScope === undefined ? undefined : JSON.stringify(operationScope);
    if (textByteLength(actorHeader) > MAX_ACTOR_HEADER_BYTES
        || (operationScopeHeader !== undefined && textByteLength(operationScopeHeader) > MAX_OPERATION_SCOPE_HEADER_BYTES)) {
      return safeResponse(503);
    }
    const headers = outboundHeaders(c.req.raw.headers, method, actorHeader, actor.requestId, operationScopeHeader);
    const outbound = new Request(canonicalUrl.href, {
      method,
      headers,
      body: parsed.bytes,
      redirect: "manual",
    });
    let upstream: Response;
    try {
      upstream = await core.fetch(outbound);
    } catch {
      return safeResponse(503);
    }
    return safeUpstreamResponse(upstream, method, actor.requestId);
  } catch (error) {
    if (error instanceof ProxyRequestError) return safeResponse(error.status);
    if (error instanceof ActorIssuanceError) return safeResponse(error.kind === "forbidden" ? 403 : 503);
    if (error instanceof PermanentAuthorityError) return safeResponse(error.kind === "forbidden" ? 403 : 503);
    return safeResponse(503);
  }
}

function textByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

conversionsProxy.all("/api/admin/conversions/v1/*", proxyRequest);
