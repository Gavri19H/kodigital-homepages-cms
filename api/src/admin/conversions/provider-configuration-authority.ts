import type { Env } from "../../env";
import {
  ACTOR_CONTEXT_SCHEMA_VERSION,
  ACTOR_CONTEXT_SIGNATURE_ALGORITHM,
  CONNECTION_TEST_SCOPE_VERSION,
  KODIGITAL_CMS_AUTHORITY_ISSUER,
  canonicalJson,
  isUuidV7,
} from "./actor-envelope";
import {
  CORE_ACTOR_CAPABILITIES,
  PermanentAuthorityError,
  resolvePermanentConversionsActorIdentity,
  type PermanentConversionsAuthority,
} from "./permanent-authority";
import {
  blobSha256Hex,
  sha256Hex,
  validateProviderConnectionSnapshotJson,
  type ProviderAdapter,
  type ProviderCredentialPurpose,
} from "./provider-credential-aliases";

export const PROVIDER_PREPARE_PATH = "/v1/provider-configuration/prepare";
export const PROVIDER_DELIVERY_PREPARE_PATH = "/v1/provider-configuration/prepare-delivery";
export const PROVIDER_EXECUTE_PATH = "/v1/provider-configuration/execute";
export const PROVIDER_AUTHORITY_ISSUER = "kodigital_cms_provider_authority";
export const PROVIDER_PREPARE_REQUEST_PURPOSE = "kodigital.cms-provider-prepare.request.v1";
export const PROVIDER_PREPARE_RESPONSE_PURPOSE = "kodigital.cms-provider-prepare.response.v1";
export const PROVIDER_DELIVERY_PREPARE_REQUEST_PURPOSE =
  "kodigital.cms-provider-delivery-prepare.request.v1";
export const PROVIDER_DELIVERY_PREPARE_RESPONSE_PURPOSE =
  "kodigital.cms-provider-delivery-prepare.response.v1";
export const PROVIDER_EXECUTE_REQUEST_PURPOSE = "kodigital.cms-provider-execute.request.v1";
export const PROVIDER_EXECUTE_RESPONSE_PURPOSE = "kodigital.cms-provider-execute.response.v1";

const PREPARE_REQUEST_KEYS = Object.freeze([
  "schema_version", "actor_authorization_envelope", "actor_authorization_sha256",
  "connection_test_authorization_scope", "workspace_id", "destination_connection_id",
  "flow_version_id", "delivery_id", "issued_at", "expires_at", "nonce",
]);
const DELIVERY_PREPARE_REQUEST_KEYS = Object.freeze([
  "schema_version", "workspace_id", "destination_connection_id", "flow_id",
  "flow_version_id", "event_id", "event_version", "source_command_id",
  "state_fingerprint", "delivery_id", "issued_at", "expires_at", "nonce",
]);
const EXECUTE_REQUEST_KEYS = Object.freeze([
  "schema_version", "workspace_id", "destination_connection_id", "adapter_type", "account_public_id",
  "delivery_id", "delivery_generation", "attempt_number", "native_id", "first_attempt_at", "started_at",
  "lease_token", "lease_generation", "dispatch_pointer_sha256", "expected_config_version",
  "expected_snapshot_sha256", "issued_at", "expires_at", "nonce",
]);
const ACTOR_PAYLOAD_KEYS = Object.freeze([
  "schema_version", "signature_algorithm", "issuer", "audience", "environment", "actor_id",
  "actor_reference", "actor_email", "workspace_id", "role", "capabilities", "account_scope",
  "reporting_currency", "request_id", "issued_at", "expires_at", "bootstrap",
]);
const CONNECTION_SCOPE_KEYS = Object.freeze([
  "schema_version", "actor_id", "workspace_id", "request_id", "route", "method", "connection_id",
  "test_kind", "expected_side_effect_mode", "destination_class",
]);
const BASE64URL_SHA256 = /^[A-Za-z0-9_-]{43}$/;
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const NONCE = /^[A-Za-z0-9_-]{16,128}$/;
const SAFE_ACCOUNT = /^[!-~]{1,256}$/;
const SAFE_TEST_KIND = /^[a-z][a-z0-9._:-]{0,127}$/;
const UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROVIDER_RESPONSE_MAX_SECONDS = 30;
const textEncoder = new TextEncoder();
const MAX_SIGNED_BODY_BYTES = 2_097_152;

type JsonRecord = Record<string, unknown>;
type SignedEnvelope = { payload: JsonRecord; signature: string };

interface ProviderRow {
  workspace_id: unknown;
  destination_connection_id: unknown;
  current_config_version: unknown;
  current_snapshot_sha256: unknown;
  head_status: unknown;
  head_row_version: unknown;
  adapter_type: unknown;
  account_public_id: unknown;
  snapshot_json: unknown;
  snapshot_sha256: unknown;
  credential_alias_id: unknown;
  credential_purpose: unknown;
  alias_id: unknown;
  alias_workspace_id: unknown;
  alias_destination_connection_id: unknown;
  alias_adapter_type: unknown;
  alias_purpose: unknown;
  alias_status: unknown;
  alias_secret_present: unknown;
  release_id: unknown;
  release_workspace_id: unknown;
  release_destination_connection_id: unknown;
  release_config_version: unknown;
  release_source_snapshot_sha256: unknown;
  release_adapter_type: unknown;
  release_account_public_id: unknown;
  release_mode: unknown;
  release_approval_packet_sha256: unknown;
  release_status: unknown;
  release_activated_at: unknown;
  release_expires_at: unknown;
  release_activated_by_principal_id: unknown;
  release_row_version: unknown;
}

interface VerifiedActor {
  envelope: SignedEnvelope;
  sha256: string;
  principalId: string;
  canonicalEmail: string;
  accessSubject: string;
  workspaceId: string;
  requestId: string;
  role: PermanentConversionsAuthority["role"];
  capabilities: ReadonlyArray<string>;
  accountScope: PermanentConversionsAuthority["accountScope"];
  reportingCurrency: string;
}

interface VerifiedScope {
  sha256: string;
  connectionId: string;
  sideEffectMode: "none" | "sandbox";
}

export class ProviderAuthorityError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 415 | 503) {
    super("provider authority request rejected");
    this.name = "ProviderAuthorityError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: JsonRecord, expected: ReadonlyArray<string>): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function decodeKey(value: unknown): Uint8Array | undefined {
  if (typeof value !== "string" || !BASE64URL_SHA256.test(value)) return undefined;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=");
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return bytes.byteLength === 32 ? bytes : undefined;
  } catch {
    return undefined;
  }
}

function base64Url(value: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

async function hmac(payload: unknown, key: Uint8Array, purpose: string, domain = "\n"): Promise<string> {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(await crypto.subtle.sign("HMAC", imported,
    textEncoder.encode(`${purpose}${domain}${canonicalJson(payload)}`)));
}

async function verifyHmac(payload: unknown, signature: unknown, key: Uint8Array, purpose: string, domain = "\n"): Promise<boolean> {
  if (typeof signature !== "string" || !BASE64URL_SHA256.test(signature)) return false;
  const signatureBytes = decodeKey(signature);
  if (signatureBytes === undefined) return false;
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", imported, signatureBytes,
    textEncoder.encode(`${purpose}${domain}${canonicalJson(payload)}`));
}

async function readSignedRequest(request: Request, expectedPath: string): Promise<SignedEnvelope> {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== expectedPath || url.search !== "" || url.hash !== ""
      || url.username !== "" || url.password !== "") throw new ProviderAuthorityError(404);
  if (request.headers.get("content-type") !== "application/json") throw new ProviderAuthorityError(415);
  const length = request.headers.get("content-length");
  if (length !== null) {
    let declared: bigint;
    try {
      if (!/^(?:0|[1-9][0-9]*)$/.test(length)) throw new Error("invalid");
      declared = BigInt(length);
    } catch {
      try { await request.body?.cancel(); } catch { /* Preserve the request rejection. */ }
      throw new ProviderAuthorityError(400);
    }
    if (declared > BigInt(MAX_SIGNED_BODY_BYTES)) {
      try { await request.body?.cancel(); } catch { /* Preserve the request rejection. */ }
      throw new ProviderAuthorityError(400);
    }
  }
  if (request.body === null) throw new ProviderAuthorityError(400);
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const chunks: string[] = [];
  let bytes = 0;
  let complete = false;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)
          || bytes + part.value.byteLength > MAX_SIGNED_BODY_BYTES) {
        try { await reader.cancel(); } catch { /* Preserve the request rejection. */ }
        throw new ProviderAuthorityError(400);
      }
      bytes += part.value.byteLength;
      chunks.push(decoder.decode(part.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    complete = true;
  } catch (error) {
    if (!complete) {
      try { await reader.cancel(); } catch { /* Preserve the original rejection. */ }
    }
    if (error instanceof ProviderAuthorityError) throw error;
    throw new ProviderAuthorityError(400);
  } finally {
    reader.releaseLock();
  }
  const text = chunks.join("");
  if (bytes < 2) throw new ProviderAuthorityError(400);
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new ProviderAuthorityError(400);
  }
  if (!isRecord(value) || !exactKeys(value, ["payload", "signature"]) || canonicalJson(value) !== text
      || !isRecord(value.payload) || typeof value.signature !== "string") throw new ProviderAuthorityError(400);
  return { payload: value.payload, signature: value.signature };
}

function validateRequestTime(payload: JsonRecord, nowSeconds: number): void {
  if (!Number.isSafeInteger(payload.issued_at) || !Number.isSafeInteger(payload.expires_at)
      || (payload.issued_at as number) < 0 || (payload.expires_at as number) <= (payload.issued_at as number)
      || (payload.expires_at as number) - (payload.issued_at as number) > 30
      || nowSeconds < (payload.issued_at as number) || nowSeconds >= (payload.expires_at as number)
      || typeof payload.nonce !== "string" || !NONCE.test(payload.nonce)) throw new ProviderAuthorityError(403);
}

type ProviderResponseKind = "prepare" | "deliveryPrepare" | "execute";

function responseConfig(env: Env, kind: ProviderResponseKind): { key: Uint8Array; purpose: string; audience: string } {
  const key = decodeKey(kind === "execute"
    ? env.CMS_PROVIDER_EXECUTE_RESPONSE_HMAC_KEY_B64URL
    : env.CMS_PROVIDER_PREPARE_RESPONSE_HMAC_KEY_B64URL);
  if (key === undefined || typeof env.CONVERSIONS_ACTOR_AUDIENCE !== "string"
      || !/^[a-z][a-z0-9._:-]{0,127}$/.test(env.CONVERSIONS_ACTOR_AUDIENCE)) {
    throw new ProviderAuthorityError(503);
  }
  return {
    key,
    purpose: kind === "prepare"
      ? PROVIDER_PREPARE_RESPONSE_PURPOSE
      : kind === "deliveryPrepare"
        ? PROVIDER_DELIVERY_PREPARE_RESPONSE_PURPOSE
        : PROVIDER_EXECUTE_RESPONSE_PURPOSE,
    audience: env.CONVERSIONS_ACTOR_AUDIENCE,
  };
}

async function signedResponse(env: Env, kind: ProviderResponseKind, payload: JsonRecord): Promise<Response> {
  const config = responseConfig(env, kind);
  const envelope = { payload, signature: await hmac(payload, config.key, config.purpose) };
  return new Response(canonicalJson(envelope), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

async function signedDenial(
  env: Env,
  kind: ProviderResponseKind,
  requestPayload: JsonRecord,
  code: "disabled" | "changed" | "identity_mismatch" | "credential_alias_inactive",
  nowSeconds: number,
): Promise<Response> {
  const config = responseConfig(env, kind);
  const common = capabilityTail(env, config.audience, nowSeconds, requestPayload.nonce as string);
  const payload: JsonRecord = kind === "prepare" ? {
    schema_version: "destination_provider_connection_prepare_denial.v1",
    code,
    workspace_id: requestPayload.workspace_id,
    destination_connection_id: requestPayload.destination_connection_id,
    delivery_id: requestPayload.delivery_id,
    ...common,
  } : kind === "deliveryPrepare" ? {
    schema_version: "destination_provider_delivery_prepare_denial.v1",
    code,
    workspace_id: requestPayload.workspace_id,
    destination_connection_id: requestPayload.destination_connection_id,
    delivery_id: requestPayload.delivery_id,
    source_command_id: requestPayload.source_command_id,
    ...common,
  } : {
    ...requestPayload,
    schema_version: "destination_provider_connection_execute_denial.v1",
    code,
    ...common,
  };
  return signedResponse(env, kind, payload);
}

function capabilityTail(
  env: Env,
  audience: string,
  nowSeconds: number,
  nonce: string,
  maximumExpiresAt = nowSeconds + PROVIDER_RESPONSE_MAX_SECONDS,
): JsonRecord {
  const expiresAt = Math.min(nowSeconds + PROVIDER_RESPONSE_MAX_SECONDS, maximumExpiresAt);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowSeconds) {
    throw new ProviderAuthorityError(403);
  }
  return {
    issuer: PROVIDER_AUTHORITY_ISSUER,
    audience,
    environment: env.APP_ENV,
    issued_at: nowSeconds,
    expires_at: expiresAt,
    nonce,
  };
}

async function verifyPermanentActor(env: Env, value: unknown, expectedSha: unknown, nowSeconds: number): Promise<VerifiedActor> {
  if (!isRecord(value) || !exactKeys(value, ["payload", "signature"]) || !isRecord(value.payload)
      || !exactKeys(value.payload, ACTOR_PAYLOAD_KEYS) || typeof value.signature !== "string") {
    throw new ProviderAuthorityError(403);
  }
  const payload = value.payload;
  const actorKey = decodeKey(env.CONVERSIONS_ACTOR_SIGNING_KEY_B64URL);
  if (actorKey === undefined || !await verifyHmac(payload, value.signature, actorKey, "", "")) {
    throw new ProviderAuthorityError(actorKey === undefined ? 503 : 403);
  }
  const envelopeSha = await sha256Hex(canonicalJson(value));
  const validRole = payload.role === "accountable_owner"
    || payload.role === "administrator" || payload.role === "reporter";
  const validCurrency = typeof payload.reporting_currency === "string"
    && /^[A-Z]{3}$/.test(payload.reporting_currency);
  const accountScope = Array.isArray(payload.account_scope) ? payload.account_scope : undefined;
  let priorAccountId = "";
  const validAccountScope = accountScope !== undefined && accountScope.length <= 256
    && accountScope.every((entry) => {
      if (!isRecord(entry) || !exactKeys(entry, ["account_id", "currency"])
          || typeof entry.account_id !== "string"
          || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(entry.account_id)
          || entry.currency !== payload.reporting_currency
          || (priorAccountId !== "" && entry.account_id <= priorAccountId)) return false;
      priorAccountId = entry.account_id;
      return true;
    });
  if (typeof expectedSha !== "string" || expectedSha !== envelopeSha || !HEX_SHA256.test(expectedSha)
      || payload.schema_version !== ACTOR_CONTEXT_SCHEMA_VERSION
      || payload.signature_algorithm !== ACTOR_CONTEXT_SIGNATURE_ALGORITHM
      || payload.issuer !== KODIGITAL_CMS_AUTHORITY_ISSUER
      || payload.audience !== env.CONVERSIONS_ACTOR_AUDIENCE || payload.environment !== env.APP_ENV
      || payload.bootstrap !== false || !isUuidV7(payload.actor_id) || !isUuidV7(payload.workspace_id)
      || !isUuidV7(payload.request_id) || typeof payload.actor_reference !== "string"
      || typeof payload.actor_email !== "string" || !Array.isArray(payload.capabilities)
      || !payload.capabilities.every((item) => typeof item === "string")
      || !validRole || !validCurrency || !validAccountScope
      || !Number.isSafeInteger(payload.issued_at) || !Number.isSafeInteger(payload.expires_at)
      || (payload.expires_at as number) - (payload.issued_at as number) > 60
      || nowSeconds < (payload.issued_at as number) || nowSeconds >= (payload.expires_at as number)) {
    throw new ProviderAuthorityError(403);
  }
  return {
    envelope: { payload, signature: value.signature },
    sha256: envelopeSha,
    principalId: payload.actor_id,
    canonicalEmail: payload.actor_email,
    accessSubject: payload.actor_reference,
    workspaceId: payload.workspace_id,
    requestId: payload.request_id,
    role: payload.role as PermanentConversionsAuthority["role"],
    capabilities: payload.capabilities as string[],
    accountScope: accountScope as PermanentConversionsAuthority["accountScope"],
    reportingCurrency: payload.reporting_currency as string,
  };
}

async function verifyConnectionScope(env: Env, value: unknown, actor: VerifiedActor): Promise<VerifiedScope> {
  if (!isRecord(value) || !exactKeys(value, ["payload", "signature"]) || !isRecord(value.payload)
      || !exactKeys(value.payload, CONNECTION_SCOPE_KEYS) || typeof value.signature !== "string") {
    throw new ProviderAuthorityError(403);
  }
  const key = decodeKey(env.CONVERSIONS_ACTOR_SIGNING_KEY_B64URL);
  if (key === undefined || !await verifyHmac(value.payload, value.signature, key, "kodigital-admin-operation-scope.v1", "\0")) {
    throw new ProviderAuthorityError(key === undefined ? 503 : 403);
  }
  const payload = value.payload;
  const none = payload.expected_side_effect_mode === "none" && payload.destination_class === "none";
  const sandbox = payload.expected_side_effect_mode === "sandbox" && payload.destination_class === "sandbox";
  if (payload.schema_version !== CONNECTION_TEST_SCOPE_VERSION || payload.actor_id !== actor.principalId
      || payload.workspace_id !== actor.workspaceId || payload.request_id !== actor.requestId
      || payload.method !== "POST" || !isUuidV7(payload.connection_id)
      || payload.route !== `/api/admin/conversions/v1/connections/${String(payload.connection_id)}/test`
      || typeof payload.test_kind !== "string" || !SAFE_TEST_KIND.test(payload.test_kind)
      || (!none && !sandbox)) throw new ProviderAuthorityError(403);
  return {
    sha256: await sha256Hex(canonicalJson(value)),
    connectionId: payload.connection_id,
    sideEffectMode: sandbox ? "sandbox" : "none",
  };
}

function compareAuthority(actor: VerifiedActor, authority: PermanentConversionsAuthority): boolean {
  return actor.capabilities.length === authority.coreCapabilities.length
    && actor.capabilities.every((capability, index) => capability === authority.coreCapabilities[index])
    && actor.capabilities.includes("connections.manage")
    && actor.capabilities.every((capability) => (CORE_ACTOR_CAPABILITIES as ReadonlyArray<string>).includes(capability))
    && actor.role === authority.role
    && actor.reportingCurrency === authority.reportingCurrency
    && canonicalJson(actor.accountScope) === canonicalJson(authority.accountScope);
}

const PROVIDER_SELECT = `SELECT h.workspace_id,h.destination_connection_id,h.current_config_version,
       h.current_snapshot_sha256,h.status AS head_status,h.row_version AS head_row_version,
       v.adapter_type,v.account_public_id,v.snapshot_json,v.snapshot_sha256,
       v.credential_alias_id,v.credential_purpose,
       a.credential_alias_id AS alias_id,a.workspace_id AS alias_workspace_id,
       a.destination_connection_id AS alias_destination_connection_id,
       a.adapter_type AS alias_adapter_type,a.purpose AS alias_purpose,
       a.status AS alias_status,a.secret_present AS alias_secret_present,
       r.release_id,r.workspace_id AS release_workspace_id,
       r.destination_connection_id AS release_destination_connection_id,
       r.config_version AS release_config_version,
       r.source_snapshot_sha256 AS release_source_snapshot_sha256,
       r.adapter_type AS release_adapter_type,r.account_public_id AS release_account_public_id,
       r.release_mode,r.approval_packet_sha256 AS release_approval_packet_sha256,
       r.status AS release_status,r.activated_at AS release_activated_at,
       r.expires_at AS release_expires_at,
       r.activated_by_principal_id AS release_activated_by_principal_id,
       r.row_version AS release_row_version
FROM conversion_provider_connection_heads h
JOIN conversion_provider_connection_versions v
  ON v.destination_connection_id=h.destination_connection_id
 AND v.config_version=h.current_config_version
 AND v.snapshot_sha256=h.current_snapshot_sha256
 AND v.workspace_id=h.workspace_id
JOIN conversion_workspaces w ON w.workspace_id=h.workspace_id AND w.status='active'
LEFT JOIN conversion_provider_credential_aliases a
  ON a.credential_alias_id=v.credential_alias_id
 AND a.workspace_id=v.workspace_id
 AND a.destination_connection_id=v.destination_connection_id
 AND a.adapter_type=v.adapter_type
 AND a.purpose=v.credential_purpose
LEFT JOIN conversion_provider_execution_releases r
  ON r.workspace_id=v.workspace_id
 AND r.destination_connection_id=v.destination_connection_id
 AND r.config_version=v.config_version
 AND r.source_snapshot_sha256=v.snapshot_sha256
 AND r.adapter_type=v.adapter_type
 AND r.account_public_id=v.account_public_id
 AND r.status='active'`;

async function providerRows(env: Env, where: string, bindings: ReadonlyArray<unknown>): Promise<ProviderRow[]> {
  try {
    const result = await env.DB.prepare(`${PROVIDER_SELECT}\n${where}\nORDER BY h.destination_connection_id\nLIMIT 2`)
      .bind(...bindings).all<ProviderRow>();
    if (!result.success || !Array.isArray(result.results)) throw new Error("provider query failed");
    return result.results;
  } catch {
    throw new ProviderAuthorityError(503);
  }
}

async function validateProviderRow(row: ProviderRow): Promise<{
  workspaceId: string; destinationConnectionId: string; adapterType: ProviderAdapter;
  accountPublicId: string; configVersion: number; snapshotSha256: string; snapshotJson: string;
  headRowVersion: number; status: "disabled" | "test_only";
} | undefined> {
  const headHash = blobSha256Hex(row.current_snapshot_sha256);
  const versionHash = blobSha256Hex(row.snapshot_sha256);
  if (!isUuidV7(row.workspace_id) || !isUuidV7(row.destination_connection_id)
      || !Number.isSafeInteger(row.current_config_version) || (row.current_config_version as number) < 1
      || !Number.isSafeInteger(row.head_row_version) || (row.head_row_version as number) < 1
      || (row.head_status !== "disabled" && row.head_status !== "test_only")
      || typeof row.adapter_type !== "string" || typeof row.account_public_id !== "string"
      || !SAFE_ACCOUNT.test(row.account_public_id) || typeof row.snapshot_json !== "string"
      || headHash === undefined || versionHash === undefined || headHash !== versionHash
      || await sha256Hex(row.snapshot_json) !== headHash) return undefined;
  const snapshot = validateProviderConnectionSnapshotJson(row.snapshot_json, {
    adapterType: row.adapter_type as ProviderAdapter,
    workspaceId: row.workspace_id,
    destinationConnectionId: row.destination_connection_id,
    accountPublicId: row.account_public_id,
    status: row.head_status,
    credentialAliasId: row.credential_alias_id as string | null,
    credentialPurpose: row.credential_purpose as ProviderCredentialPurpose | null,
  });
  if (snapshot === undefined) return undefined;
  if (snapshot.credentialAlias === null) {
    if (row.credential_alias_id !== null || row.credential_purpose !== null || row.alias_id !== null) return undefined;
  } else if (row.alias_id !== snapshot.credentialAlias.credential_alias_id
      || row.alias_workspace_id !== row.workspace_id
      || row.alias_destination_connection_id !== row.destination_connection_id
      || row.alias_adapter_type !== row.adapter_type || row.alias_purpose !== snapshot.credentialAlias.purpose
      || row.alias_status !== "test_only" || row.alias_secret_present !== 1) return undefined;
  return {
    workspaceId: row.workspace_id,
    destinationConnectionId: row.destination_connection_id,
    adapterType: row.adapter_type as ProviderAdapter,
    accountPublicId: row.account_public_id,
    configVersion: row.current_config_version as number,
    snapshotSha256: headHash,
    snapshotJson: row.snapshot_json,
    headRowVersion: row.head_row_version as number,
    status: row.head_status,
  };
}

function validateProviderRelease(
  row: ProviderRow,
  provider: {
    workspaceId: string; destinationConnectionId: string; adapterType: ProviderAdapter;
    accountPublicId: string; configVersion: number; snapshotSha256: string;
  },
  nowSeconds: number,
): {
  releaseId: string; approvalPacketSha256: string; rowVersion: number; expiresAt: number;
} | undefined {
  const sourceHash = blobSha256Hex(row.release_source_snapshot_sha256);
  const approvalHash = blobSha256Hex(row.release_approval_packet_sha256);
  if (!isUuidV7(row.release_id)
      || row.release_workspace_id !== provider.workspaceId
      || row.release_destination_connection_id !== provider.destinationConnectionId
      || row.release_config_version !== provider.configVersion
      || sourceHash !== provider.snapshotSha256
      || row.release_adapter_type !== provider.adapterType
      || row.release_account_public_id !== provider.accountPublicId
      || row.release_mode !== "meta_test_event"
      || row.release_status !== "active"
      || approvalHash === undefined
      || !Number.isSafeInteger(row.release_activated_at)
      || !Number.isSafeInteger(row.release_expires_at)
      || (row.release_activated_at as number) > nowSeconds
      || (row.release_expires_at as number) <= nowSeconds
      || (row.release_expires_at as number) - (row.release_activated_at as number) > 3600
      || !isUuidV7(row.release_activated_by_principal_id)
      || !Number.isSafeInteger(row.release_row_version)
      || (row.release_row_version as number) < 1) return undefined;
  return {
    releaseId: row.release_id,
    approvalPacketSha256: approvalHash,
    rowVersion: row.release_row_version as number,
    expiresAt: row.release_expires_at as number,
  };
}

function releasedProviderSnapshotJson(snapshotJson: string): string {
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(snapshotJson) as unknown;
  } catch {
    throw new ProviderAuthorityError(503);
  }
  if (!isRecord(snapshot)
      || snapshot.schema_version !== "destination_provider_connection_snapshot.v1"
      || snapshot.production_execution_released !== false) {
    throw new ProviderAuthorityError(503);
  }
  return canonicalJson({
    ...snapshot,
    schema_version: "destination_provider_connection_snapshot.v2",
    production_execution_released: true,
  });
}

async function prepare(request: Request, env: Env, nowSeconds: number): Promise<Response> {
  const envelope = await readSignedRequest(request, PROVIDER_PREPARE_PATH);
  if (!exactKeys(envelope.payload, PREPARE_REQUEST_KEYS)
      || envelope.payload.schema_version !== "destination_provider_connection_prepare_request.v1") {
    throw new ProviderAuthorityError(400);
  }
  const key = decodeKey(env.CMS_PROVIDER_PREPARE_REQUEST_HMAC_KEY_B64URL);
  if (key === undefined) throw new ProviderAuthorityError(503);
  if (!await verifyHmac(envelope.payload, envelope.signature, key, PROVIDER_PREPARE_REQUEST_PURPOSE)) {
    throw new ProviderAuthorityError(403);
  }
  validateRequestTime(envelope.payload, nowSeconds);
  if (!isUuidV7(envelope.payload.workspace_id) || !isUuidV7(envelope.payload.destination_connection_id)
      || !isUuidV7(envelope.payload.flow_version_id) || typeof envelope.payload.delivery_id !== "string"
      || !CANONICAL_UUID.test(envelope.payload.delivery_id)) {
    throw new ProviderAuthorityError(400);
  }
  const actor = await verifyPermanentActor(env, envelope.payload.actor_authorization_envelope,
    envelope.payload.actor_authorization_sha256, nowSeconds);
  const scope = await verifyConnectionScope(env, envelope.payload.connection_test_authorization_scope, actor);
  if (actor.workspaceId !== envelope.payload.workspace_id
      || scope.connectionId !== envelope.payload.destination_connection_id) throw new ProviderAuthorityError(403);
  let authority: PermanentConversionsAuthority;
  try {
    authority = await resolvePermanentConversionsActorIdentity(env, {
      principalId: actor.principalId,
      canonicalEmail: actor.canonicalEmail,
      accessSubject: actor.accessSubject,
      workspaceId: actor.workspaceId,
    });
  } catch (error) {
    if (error instanceof PermanentAuthorityError) throw new ProviderAuthorityError(error.kind === "forbidden" ? 403 : 503);
    throw error;
  }
  if (!compareAuthority(actor, authority)) throw new ProviderAuthorityError(403);
  const rows = await providerRows(env,
    "WHERE h.workspace_id=?1 AND h.destination_connection_id=?2",
    [actor.workspaceId, scope.connectionId]);
  if (rows.length !== 1) return signedDenial(env, "prepare", envelope.payload, "identity_mismatch", nowSeconds);
  if (rows[0]!.head_status === "disabled") {
    return signedDenial(env, "prepare", envelope.payload, "disabled", nowSeconds);
  }
  const provider = await validateProviderRow(rows[0]!);
  if (provider === undefined || provider.status !== "test_only") {
    const aliasInactive = rows[0]!.credential_alias_id !== null
      && (rows[0]!.alias_status !== "test_only" || rows[0]!.alias_secret_present !== 1);
    return signedDenial(env, "prepare", envelope.payload,
      aliasInactive ? "credential_alias_inactive" : "identity_mismatch", nowSeconds);
  }
  if (!authority.accountScope.some(({ account_id }) => account_id === provider.accountPublicId)) {
    return signedDenial(env, "prepare", envelope.payload, "identity_mismatch", nowSeconds);
  }
  const config = responseConfig(env, "prepare");
  return signedResponse(env, "prepare", {
    schema_version: "destination_provider_connection_prepare_capability.v1",
    actor_authorization_sha256: actor.sha256,
    principal_id: actor.principalId,
    actor_request_id: actor.requestId,
    operation_scope_sha256: scope.sha256,
    workspace_id: provider.workspaceId,
    destination_connection_id: provider.destinationConnectionId,
    flow_version_id: envelope.payload.flow_version_id,
    delivery_id: envelope.payload.delivery_id,
    adapter_type: provider.adapterType,
    account_public_id: provider.accountPublicId,
    config_version: provider.configVersion,
    snapshot_sha256: provider.snapshotSha256,
    snapshot_json: provider.snapshotJson,
    head_row_version: provider.headRowVersion,
    status: "test_only",
    production_execution_released: false,
    ...capabilityTail(env, config.audience, nowSeconds, envelope.payload.nonce as string),
  });
}

async function prepareDelivery(request: Request, env: Env, nowSeconds: number): Promise<Response> {
  const envelope = await readSignedRequest(request, PROVIDER_DELIVERY_PREPARE_PATH);
  const payload = envelope.payload;
  if (!exactKeys(payload, DELIVERY_PREPARE_REQUEST_KEYS)
      || payload.schema_version !== "destination_provider_delivery_prepare_request.v1") {
    throw new ProviderAuthorityError(400);
  }
  const key = decodeKey(env.CMS_PROVIDER_PREPARE_REQUEST_HMAC_KEY_B64URL);
  if (key === undefined) throw new ProviderAuthorityError(503);
  if (!await verifyHmac(
    payload,
    envelope.signature,
    key,
    PROVIDER_DELIVERY_PREPARE_REQUEST_PURPOSE,
  )) {
    throw new ProviderAuthorityError(403);
  }
  validateRequestTime(payload, nowSeconds);
  if (![payload.workspace_id, payload.destination_connection_id, payload.flow_id,
    payload.flow_version_id, payload.event_id]
    .every((value) => typeof value === "string" && isUuidV7(value))
      || typeof payload.delivery_id !== "string"
      || !CANONICAL_UUID.test(payload.delivery_id)
      || !Number.isSafeInteger(payload.event_version)
      || (payload.event_version as number) < 1
      || typeof payload.source_command_id !== "string"
      || !HEX_SHA256.test(payload.source_command_id)
      || typeof payload.state_fingerprint !== "string"
      || !HEX_SHA256.test(payload.state_fingerprint)) {
    throw new ProviderAuthorityError(400);
  }
  const rows = await providerRows(env,
    "WHERE h.workspace_id=?1 AND h.destination_connection_id=?2",
    [payload.workspace_id, payload.destination_connection_id]);
  if (rows.length !== 1) {
    return signedDenial(env, "deliveryPrepare", payload, "identity_mismatch", nowSeconds);
  }
  if (rows[0]!.head_status === "disabled") {
    return signedDenial(env, "deliveryPrepare", payload, "disabled", nowSeconds);
  }
  const provider = await validateProviderRow(rows[0]!);
  if (provider === undefined || provider.status !== "test_only") {
    const aliasInactive = rows[0]!.credential_alias_id !== null
      && (rows[0]!.alias_status !== "test_only" || rows[0]!.alias_secret_present !== 1);
    return signedDenial(env, "deliveryPrepare", payload,
      aliasInactive ? "credential_alias_inactive" : "identity_mismatch", nowSeconds);
  }
  const config = responseConfig(env, "deliveryPrepare");
  return signedResponse(env, "deliveryPrepare", {
    ...payload,
    schema_version: "destination_provider_delivery_prepare_capability.v1",
    adapter_type: provider.adapterType,
    account_public_id: provider.accountPublicId,
    config_version: provider.configVersion,
    snapshot_sha256: provider.snapshotSha256,
    snapshot_json: provider.snapshotJson,
    head_row_version: provider.headRowVersion,
    status: "test_only",
    production_execution_released: false,
    ...capabilityTail(env, config.audience, nowSeconds, payload.nonce as string),
  });
}

function validUtc(value: unknown): value is string {
  if (typeof value !== "string" || !UTC_MILLIS.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

async function execute(request: Request, env: Env, nowSeconds: number): Promise<Response> {
  const envelope = await readSignedRequest(request, PROVIDER_EXECUTE_PATH);
  const payload = envelope.payload;
  if (!exactKeys(payload, EXECUTE_REQUEST_KEYS)
      || payload.schema_version !== "destination_provider_connection_execute_request.v1") {
    throw new ProviderAuthorityError(400);
  }
  const key = decodeKey(env.CMS_PROVIDER_EXECUTE_REQUEST_HMAC_KEY_B64URL);
  if (key === undefined) throw new ProviderAuthorityError(503);
  if (!await verifyHmac(payload, envelope.signature, key, PROVIDER_EXECUTE_REQUEST_PURPOSE)) {
    throw new ProviderAuthorityError(403);
  }
  validateRequestTime(payload, nowSeconds);
  if (!isUuidV7(payload.workspace_id) || !isUuidV7(payload.destination_connection_id)
      || typeof payload.delivery_id !== "string" || !CANONICAL_UUID.test(payload.delivery_id)
      || typeof payload.lease_token !== "string"
      || !BASE64URL_SHA256.test(payload.lease_token)
      || typeof payload.adapter_type !== "string" || typeof payload.account_public_id !== "string"
      || !SAFE_ACCOUNT.test(payload.account_public_id)
      || !Number.isSafeInteger(payload.delivery_generation) || (payload.delivery_generation as number) < 0
      || !Number.isSafeInteger(payload.attempt_number) || (payload.attempt_number as number) < 1
      || (payload.native_id !== null
        && (typeof payload.native_id !== "string" || !CANONICAL_UUID.test(payload.native_id)))
      || !validUtc(payload.first_attempt_at) || !validUtc(payload.started_at)
      || !Number.isSafeInteger(payload.lease_generation) || (payload.lease_generation as number) < 1
      || typeof payload.dispatch_pointer_sha256 !== "string" || !HEX_SHA256.test(payload.dispatch_pointer_sha256)
      || !Number.isSafeInteger(payload.expected_config_version) || (payload.expected_config_version as number) < 1
      || typeof payload.expected_snapshot_sha256 !== "string" || !HEX_SHA256.test(payload.expected_snapshot_sha256)) {
    throw new ProviderAuthorityError(400);
  }
  const rows = await providerRows(env,
    `WHERE h.workspace_id=?1 AND h.destination_connection_id=?2
 AND v.adapter_type=?3 AND v.account_public_id=?4
 AND h.current_config_version=?5 AND h.current_snapshot_sha256=?6`,
    [payload.workspace_id, payload.destination_connection_id, payload.adapter_type, payload.account_public_id,
      payload.expected_config_version, Uint8Array.from((payload.expected_snapshot_sha256 as string).match(/../g)!, (part) => Number.parseInt(part, 16))]);
  if (rows.length !== 1) return signedDenial(env, "execute", payload, "changed", nowSeconds);
  if (rows[0]!.head_status === "disabled") {
    return signedDenial(env, "execute", payload, "disabled", nowSeconds);
  }
  const provider = await validateProviderRow(rows[0]!);
  if (provider === undefined || provider.status !== "test_only"
      || provider.adapterType !== payload.adapter_type || provider.accountPublicId !== payload.account_public_id
      || provider.configVersion !== payload.expected_config_version
      || provider.snapshotSha256 !== payload.expected_snapshot_sha256) {
    const aliasInactive = rows[0]!.credential_alias_id !== null
      && (rows[0]!.alias_status !== "test_only" || rows[0]!.alias_secret_present !== 1);
    return signedDenial(env, "execute", payload,
      aliasInactive ? "credential_alias_inactive" : "identity_mismatch", nowSeconds);
  }
  const release = validateProviderRelease(rows[0]!, provider, nowSeconds);
  if (release === undefined) {
    const config = responseConfig(env, "execute");
    return signedResponse(env, "execute", {
      ...payload,
      schema_version: "destination_provider_connection_execute_capability.v1",
      snapshot_json: provider.snapshotJson,
      head_row_version: provider.headRowVersion,
      status: "test_only",
      production_execution_released: false,
      ...capabilityTail(env, config.audience, nowSeconds, payload.nonce as string),
    });
  }
  const snapshotJson = releasedProviderSnapshotJson(provider.snapshotJson);
  const snapshotSha256 = await sha256Hex(snapshotJson);
  const config = responseConfig(env, "execute");
  return signedResponse(env, "execute", {
    ...payload,
    schema_version: "destination_provider_connection_execute_capability.v2",
    snapshot_json: snapshotJson,
    snapshot_sha256: snapshotSha256,
    head_row_version: provider.headRowVersion,
    status: "test_only",
    production_execution_released: true,
    release_id: release.releaseId,
    release_row_version: release.rowVersion,
    approval_packet_sha256: release.approvalPacketSha256,
    release_expires_at: release.expiresAt,
    ...capabilityTail(
      env, config.audience, nowSeconds, payload.nonce as string, release.expiresAt,
    ),
  });
}

export async function handleProviderConfigurationRequest(
  request: Request,
  env: Env,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<Response> {
  try {
    const path = new URL(request.url).pathname;
    if (path === PROVIDER_PREPARE_PATH) return await prepare(request, env, nowSeconds);
    if (path === PROVIDER_DELIVERY_PREPARE_PATH) {
      return await prepareDelivery(request, env, nowSeconds);
    }
    if (path === PROVIDER_EXECUTE_PATH) return await execute(request, env, nowSeconds);
    throw new ProviderAuthorityError(404);
  } catch (error) {
    const status = error instanceof ProviderAuthorityError ? error.status : 503;
    return new Response(canonicalJson({ error: status === 503 ? "service_unavailable" : "request_rejected" }), {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
}
