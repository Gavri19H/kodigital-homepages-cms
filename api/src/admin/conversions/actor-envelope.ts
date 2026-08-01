import type { AccessContext } from "../../auth/access-auth";
import { isConversionsProxyEnabled, type Env } from "../../env";
import type { PermanentConversionsAuthority } from "./permanent-authority";

export const ACTOR_CONTEXT_HEADER = "X-KODigital-Actor-Context";
export const ACTOR_REQUEST_ID_HEADER = "X-KODigital-Request-ID";
export const ACTOR_OPERATION_SCOPE_HEADER = "X-KODigital-Operation-Scope";
export const ACTOR_CONTEXT_SCHEMA_VERSION = "actor_context.v2";
export const BOOTSTRAP_ACTOR_CONTEXT_SCHEMA_VERSION = "actor_context.v1";
export const ACTOR_CONTEXT_SIGNATURE_ALGORITHM = "HMAC-SHA-256";
export const CF_ACCESS_BOOTSTRAP_ISSUER = "cf_access_bootstrap";
export const KODIGITAL_CMS_AUTHORITY_ISSUER = "kodigital_cms_authority";
export const REPORT_DELIVERY_SCOPE_VERSION = "report_delivery_authorization_scope.v1";
export const CONNECTION_TEST_SCOPE_VERSION = "connection_test_authorization_scope.v1";

export const BOOTSTRAP_CAPABILITIES = Object.freeze([
  "conversions.view",
  "connections.manage",
  "connections.credentials",
  "flows.manage",
  "flows.publish",
  "ownership.manage",
  "activity.replay",
  "controls.manage",
  "reporting.view",
  "reporting.manage",
  "reporting.export",
  "reporting.schedule",
] as const);

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EMAIL = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const SAFE_NAME = /^[a-z][a-z0-9._:-]{0,127}$/;
const ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const CURRENCY = /^[A-Z]{3}$/;
const ENVIRONMENTS = new Set(["development", "test", "staging", "production"]);
const textEncoder = new TextEncoder();
const CMS_CAPABILITY_CATALOG = Object.freeze([
  "conversions.view", "connections.manage", "connections.credentials", "flows.manage", "flows.publish",
  "ownership.manage", "activity.replay", "conversions.external_redelivery", "controls.manage",
  "reporting.view", "reporting.manage", "reporting.export", "reporting.schedule",
  "conversions.dashboard.revenue.read",
] as const);
const CORE_CAPABILITY_CATALOG = Object.freeze(CMS_CAPABILITY_CATALOG.slice(0, 13));
const REPORTER_CAPABILITIES = new Set([
  "conversions.view", "reporting.view", "conversions.dashboard.revenue.read",
]);

export type BootstrapWarning = "active" | "critical";

export interface ActorContextPayload {
  schema_version: typeof BOOTSTRAP_ACTOR_CONTEXT_SCHEMA_VERSION;
  signature_algorithm: typeof ACTOR_CONTEXT_SIGNATURE_ALGORITHM;
  issuer: typeof CF_ACCESS_BOOTSTRAP_ISSUER;
  audience: string;
  environment: string;
  actor_id: string;
  actor_reference: string;
  actor_email: string;
  workspace_id: string;
  capabilities: ReadonlyArray<(typeof BOOTSTRAP_CAPABILITIES)[number]>;
  request_id: string;
  issued_at: number;
  expires_at: number;
  bootstrap: true;
}

export interface PermanentActorContextPayload {
  schema_version: typeof ACTOR_CONTEXT_SCHEMA_VERSION;
  signature_algorithm: typeof ACTOR_CONTEXT_SIGNATURE_ALGORITHM;
  issuer: typeof KODIGITAL_CMS_AUTHORITY_ISSUER;
  audience: string;
  environment: string;
  actor_id: string;
  actor_reference: string;
  actor_email: string;
  workspace_id: string;
  role: PermanentConversionsAuthority["role"];
  capabilities: PermanentConversionsAuthority["coreCapabilities"];
  account_scope: PermanentConversionsAuthority["accountScope"];
  reporting_currency: string;
  request_id: string;
  issued_at: number;
  expires_at: number;
  bootstrap: false;
}

export type AnyActorContextPayload = ActorContextPayload | PermanentActorContextPayload;

export interface SignedEnvelope<T> {
  payload: T;
  signature: string;
}

interface BootstrapConfig {
  actorIdsByEmail: ReadonlyMap<string, string>;
  audience: string;
  environment: string;
  workspaceId: string;
  expiresAt: number;
  signingKey: Uint8Array;
}

export type BootstrapConfigResult =
  | { ok: true; config: BootstrapConfig }
  | { ok: false };

export class ActorIssuanceError extends Error {
  constructor(readonly kind: "forbidden" | "unavailable" = "unavailable") {
    super("actor context unavailable");
    this.name = "ActorIssuanceError";
  }
}

export function isUuidV7(value: unknown): value is string {
  return typeof value === "string" && UUID_V7.test(value);
}

function parseEmails(raw: string | undefined): ReadonlyArray<string> | undefined {
  if (typeof raw !== "string" || raw === "") return undefined;
  const emails = raw.split(",");
  if (emails.length < 1 || emails.length > 100) return undefined;
  const seen = new Set<string>();
  for (const email of emails) {
    // Deployment values are canonical, not normalized on behalf of an
    // operator. This makes whitespace/case ambiguity fail closed.
    if (email !== email.trim().toLowerCase() || !EMAIL.test(email) || seen.has(email)) return undefined;
    seen.add(email);
  }
  return Object.freeze(emails);
}

function parseActorMap(raw: string | undefined, emails: ReadonlyArray<string>): ReadonlyMap<string, string> | undefined {
  if (typeof raw !== "string" || raw.length < 2 || raw.length > 16_384) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const prototype = Object.getPrototypeOf(parsed);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const records = parsed as Record<string, unknown>;
  const keys = Object.keys(records).sort();
  const expected = [...emails].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return undefined;
  const result = new Map<string, string>();
  const actorIds = new Set<string>();
  for (const email of emails) {
    const actorId = records[email];
    if (!isUuidV7(actorId) || actorIds.has(actorId)) return undefined;
    actorIds.add(actorId);
    result.set(email, actorId);
  }
  return result;
}

function parseExpiry(raw: string | undefined): number | undefined {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(raw)) return undefined;
  const millis = Date.parse(raw);
  if (!Number.isFinite(millis) || millis % 1000 !== 0 || new Date(millis).toISOString() !== raw) return undefined;
  const seconds = millis / 1000;
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : undefined;
}

function parseSigningKey(raw: string | undefined): Uint8Array | undefined {
  if (typeof raw !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return undefined;
  let binary: string;
  try {
    binary = atob(raw.replace(/-/g, "+").replace(/_/g, "/") + "=");
  } catch {
    return undefined;
  }
  if (binary.length !== 32) return undefined;
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return base64Url(bytes.buffer) === raw ? bytes : undefined;
}

function parseCanonicalMembershipCapabilitiesForIssuance(
  raw: string,
  role: PermanentConversionsAuthority["role"],
): ReadonlyArray<string> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || JSON.stringify(parsed) !== raw) return undefined;
  let prior = -1;
  for (const value of parsed) {
    const index = typeof value === "string" ? CMS_CAPABILITY_CATALOG.indexOf(value as never) : -1;
    if (index <= prior || index < 0
        || role === "administrator" && value === "ownership.manage"
        || role === "reporter" && !REPORTER_CAPABILITIES.has(value as string)) return undefined;
    prior = index;
  }
  return Object.freeze([...parsed] as string[]);
}

function parseCanonicalAccountScopeForIssuance(
  raw: string,
  reportingCurrency: string,
): PermanentConversionsAuthority["accountScope"] | undefined {
  if (!CURRENCY.test(reportingCurrency)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length > 256 || JSON.stringify(parsed) !== raw) return undefined;
  const result: Array<{ account_id: string; currency: string }> = [];
  let prior = "";
  for (const item of parsed) {
    if (item === null || typeof item !== "object" || Array.isArray(item)
        || Object.getPrototypeOf(item) !== Object.prototype
        || Object.keys(item).sort().join("\0") !== "account_id\0currency") return undefined;
    const record = item as Record<string, unknown>;
    if (typeof record.account_id !== "string" || !ACCOUNT_ID.test(record.account_id)
        || prior !== "" && record.account_id <= prior
        || record.currency !== reportingCurrency) return undefined;
    result.push(Object.freeze({ account_id: record.account_id, currency: reportingCurrency }));
    prior = record.account_id;
  }
  return Object.freeze(result);
}

export function resolveBootstrapConfig(env: Env): BootstrapConfigResult {
  if (!isConversionsProxyEnabled(env.CONVERSIONS_PROXY_ENABLED)) return { ok: false };
  const emails = parseEmails(env.CONVERSIONS_ADMIN_EMAILS);
  if (emails === undefined) return { ok: false };
  const actorIdsByEmail = parseActorMap(env.CONVERSIONS_ACTOR_ID_BY_EMAIL, emails);
  if (actorIdsByEmail === undefined) return { ok: false };
  if (!isUuidV7(env.DEFAULT_WORKSPACE_ID)) return { ok: false };
  if (typeof env.CONVERSIONS_ACTOR_AUDIENCE !== "string" || !SAFE_NAME.test(env.CONVERSIONS_ACTOR_AUDIENCE)) {
    return { ok: false };
  }
  if (typeof env.CONVERSIONS_ACTOR_ENVIRONMENT !== "string"
      || !ENVIRONMENTS.has(env.CONVERSIONS_ACTOR_ENVIRONMENT)
      || env.CONVERSIONS_ACTOR_ENVIRONMENT !== env.APP_ENV) {
    return { ok: false };
  }
  const expiresAt = parseExpiry(env.CONVERSIONS_BOOTSTRAP_EXPIRES_AT);
  if (expiresAt === undefined) return { ok: false };
  const signingKey = parseSigningKey(env.CONVERSIONS_ACTOR_SIGNING_KEY_B64URL);
  if (signingKey === undefined) return { ok: false };
  return {
    ok: true,
    config: {
      actorIdsByEmail,
      audience: env.CONVERSIONS_ACTOR_AUDIENCE,
      environment: env.CONVERSIONS_ACTOR_ENVIRONMENT,
      workspaceId: env.DEFAULT_WORKSPACE_ID,
      expiresAt,
      signingKey,
    },
  };
}

export function getBootstrapWarning(env: Env, nowSeconds = Math.floor(Date.now() / 1000)): BootstrapWarning | undefined {
  if (env.APP_ENV !== "production") return undefined;
  const result = resolveBootstrapConfig(env);
  if (!result.ok || result.config.expiresAt <= nowSeconds) return undefined;
  return result.config.expiresAt - nowSeconds <= 14 * 24 * 60 * 60 ? "critical" : "active";
}

function base64Url(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

// RFC 8785-compatible for the bounded JSON values in the frozen actor/scope
// contracts. Keys are UTF-16 lexicographically sorted exactly like EV-037.
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return Object.is(value, -0) ? "0" : JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new ActorIssuanceError();
}

async function signCanonical(payload: unknown, key: Uint8Array, domain = ""): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, textEncoder.encode(domain + canonicalJson(payload)));
  return base64Url(signature);
}

export async function signOperationScope<T>(payload: T, key: Uint8Array): Promise<SignedEnvelope<T>> {
  const signature = await signCanonical(payload, key, "kodigital-admin-operation-scope.v1\0");
  return { payload, signature };
}

export function createUuidV7(nowMillis = Date.now(), entropy?: Uint8Array): string {
  if (!Number.isSafeInteger(nowMillis) || nowMillis < 0 || nowMillis > 0xffffffffffff) throw new ActorIssuanceError();
  const bytes = entropy === undefined ? crypto.getRandomValues(new Uint8Array(16)) : new Uint8Array(entropy);
  if (bytes.byteLength !== 16) throw new ActorIssuanceError();
  let time = nowMillis;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = time & 0xff;
    time = Math.floor(time / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface IssuedActorContext {
  envelope: SignedEnvelope<AnyActorContextPayload>;
  requestId: string;
  signingKey: Uint8Array;
}

function resolvePermanentSigningConfig(env: Env): {
  audience: string;
  environment: string;
  signingKey: Uint8Array;
} | undefined {
  if (!isConversionsProxyEnabled(env.CONVERSIONS_PROXY_ENABLED)
      || typeof env.CONVERSIONS_ACTOR_AUDIENCE !== "string"
      || !SAFE_NAME.test(env.CONVERSIONS_ACTOR_AUDIENCE)
      || typeof env.CONVERSIONS_ACTOR_ENVIRONMENT !== "string"
      || !ENVIRONMENTS.has(env.CONVERSIONS_ACTOR_ENVIRONMENT)
      || env.CONVERSIONS_ACTOR_ENVIRONMENT !== env.APP_ENV) return undefined;
  const signingKey = parseSigningKey(env.CONVERSIONS_ACTOR_SIGNING_KEY_B64URL);
  return signingKey === undefined ? undefined : {
    audience: env.CONVERSIONS_ACTOR_AUDIENCE,
    environment: env.CONVERSIONS_ACTOR_ENVIRONMENT,
    signingKey,
  };
}

export async function issuePermanentActorContext(
  env: Env,
  authority: PermanentConversionsAuthority,
  nowMillis = Date.now(),
): Promise<IssuedActorContext> {
  const config = resolvePermanentSigningConfig(env);
  if (config === undefined) throw new ActorIssuanceError();
  const capabilityIndexes = authority.coreCapabilities.map((capability) => CORE_CAPABILITY_CATALOG.indexOf(capability));
  const canonicalMembership = JSON.stringify(authority.cmsCapabilities);
  const canonicalAccountScope = JSON.stringify(authority.accountScope);
  const roleValid = authority.role === "accountable_owner"
    || authority.role === "administrator"
    || authority.role === "reporter";
  const revalidatedMembership = roleValid
    ? parseCanonicalMembershipCapabilitiesForIssuance(canonicalMembership, authority.role)
    : undefined;
  const revalidatedAccountScope = parseCanonicalAccountScopeForIssuance(
    canonicalAccountScope,
    authority.reportingCurrency,
  );
  const expectedCoreCapabilities = revalidatedMembership === undefined
    ? []
    : CORE_CAPABILITY_CATALOG.filter((capability) => revalidatedMembership.includes(capability));
  if (!isUuidV7(authority.principalId) || !isUuidV7(authority.workspaceId)
      || !EMAIL.test(authority.canonicalEmail) || authority.canonicalEmail !== authority.canonicalEmail.trim().toLowerCase()
      || !/^[!-~]{1,255}$/.test(authority.accessSubject)
      || revalidatedMembership === undefined
      || JSON.stringify(revalidatedMembership) !== canonicalMembership
      || revalidatedAccountScope === undefined
      || JSON.stringify(revalidatedAccountScope) !== canonicalAccountScope
      || JSON.stringify(authority.coreCapabilities) !== JSON.stringify(expectedCoreCapabilities)
      || authority.coreCapabilities.length < 1
      || capabilityIndexes.some((index, position) => index < 0 || (position > 0 && index <= capabilityIndexes[position - 1]!))) {
    throw new ActorIssuanceError("forbidden");
  }
  const issuedAt = Math.floor(nowMillis / 1_000);
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) throw new ActorIssuanceError();
  const requestId = createUuidV7(nowMillis);
  const payload: PermanentActorContextPayload = {
    schema_version: ACTOR_CONTEXT_SCHEMA_VERSION,
    signature_algorithm: ACTOR_CONTEXT_SIGNATURE_ALGORITHM,
    issuer: KODIGITAL_CMS_AUTHORITY_ISSUER,
    audience: config.audience,
    environment: config.environment,
    actor_id: authority.principalId,
    actor_reference: authority.accessSubject,
    actor_email: authority.canonicalEmail,
    workspace_id: authority.workspaceId,
    role: authority.role,
    capabilities: authority.coreCapabilities,
    account_scope: authority.accountScope,
    reporting_currency: authority.reportingCurrency,
    request_id: requestId,
    issued_at: issuedAt,
    expires_at: issuedAt + 60,
    bootstrap: false,
  };
  const signature = await signCanonical(payload, config.signingKey);
  return { envelope: { payload, signature }, requestId, signingKey: config.signingKey };
}

export async function issueBootstrapActorContext(
  env: Env,
  access: AccessContext | undefined,
  nowMillis = Date.now(),
): Promise<IssuedActorContext> {
  if (access?.mode !== "identity") throw new ActorIssuanceError("forbidden");
  const configResult = resolveBootstrapConfig(env);
  if (!configResult.ok) throw new ActorIssuanceError();
  const config = configResult.config;
  const email = access.email.trim().toLowerCase();
  // Normalize only the verified claim. The proxy never obtains actor identity
  // from request headers, cookies, query parameters or JSON bodies.
  if (!EMAIL.test(email)) throw new ActorIssuanceError("forbidden");
  const actorId = config.actorIdsByEmail.get(email);
  if (actorId === undefined) throw new ActorIssuanceError("forbidden");
  const issuedAt = Math.floor(nowMillis / 1000);
  const expiresAt = Math.min(issuedAt + 60, config.expiresAt);
  if (expiresAt <= issuedAt) throw new ActorIssuanceError();
  const requestId = createUuidV7(nowMillis);
  const payload: ActorContextPayload = {
    schema_version: BOOTSTRAP_ACTOR_CONTEXT_SCHEMA_VERSION,
    signature_algorithm: ACTOR_CONTEXT_SIGNATURE_ALGORITHM,
    issuer: CF_ACCESS_BOOTSTRAP_ISSUER,
    audience: config.audience,
    environment: config.environment,
    actor_id: actorId,
    actor_reference: `cf_access:${actorId}`,
    actor_email: email,
    workspace_id: config.workspaceId,
    capabilities: BOOTSTRAP_CAPABILITIES,
    request_id: requestId,
    issued_at: issuedAt,
    expires_at: expiresAt,
    bootstrap: true,
  };
  const signature = await signCanonical(payload, config.signingKey);
  return { envelope: { payload, signature }, requestId, signingKey: config.signingKey };
}
