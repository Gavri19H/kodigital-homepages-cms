import { canonicalJson, isUuidV7 } from "./actor-envelope";

export const PROVIDER_ADAPTERS = Object.freeze([
  "meta", "google_data_manager", "newsbreak", "outbrain", "taboola",
] as const);
export type ProviderAdapter = (typeof PROVIDER_ADAPTERS)[number];
export type ProviderCredentialPurpose = "meta_access_token" | "google_oauth_access_token";

export interface ProviderCredentialAlias {
  readonly schema_version: "destination_provider_credential_alias.v1";
  readonly credential_alias_id: string;
  readonly purpose: ProviderCredentialPurpose;
}

export interface ValidatedProviderSnapshot {
  readonly value: Record<string, unknown>;
  readonly adapterType: ProviderAdapter;
  readonly workspaceId: string;
  readonly destinationConnectionId: string;
  readonly accountPublicId: string;
  readonly status: "disabled" | "test_only";
  readonly credentialAlias: ProviderCredentialAlias | null;
}

const SAFE_PUBLIC_ID = /^[!-~]{1,256}$/;
const ACCOUNT_ID = /^[A-Za-z0-9._-]{1,128}$/;
const ACCOUNT_TYPE = /^[A-Z][A-Z0-9_]{1,63}$/;
const DESTINATION_REFERENCE = /^[A-Za-z0-9._-]{1,128}$/;
const PRODUCT_DESTINATION = /^[A-Za-z0-9._:/-]{1,256}$/;
const DATASET_ID = /^[0-9]{1,32}$/;
const TEST_EVENT_CODE = /^[A-Za-z0-9_-]{1,64}$/;
const ACTION_SOURCE = new Set([
  "website", "app", "phone_call", "chat", "physical_store", "system_generated",
  "business_messaging", "other",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: ReadonlyArray<string>): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isAdapter(value: unknown): value is ProviderAdapter {
  return typeof value === "string" && (PROVIDER_ADAPTERS as ReadonlyArray<string>).includes(value);
}

function expectedPurpose(adapter: ProviderAdapter): ProviderCredentialPurpose | undefined {
  return adapter === "meta" ? "meta_access_token"
    : adapter === "google_data_manager" ? "google_oauth_access_token" : undefined;
}

export function parseProviderCredentialAlias(
  value: unknown,
  adapter: ProviderAdapter,
): ProviderCredentialAlias | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !hasExactKeys(value, ["schema_version", "credential_alias_id", "purpose"])
      || value.schema_version !== "destination_provider_credential_alias.v1"
      || !isUuidV7(value.credential_alias_id)
      || value.purpose !== expectedPurpose(adapter)) return undefined;
  return Object.freeze({
    schema_version: "destination_provider_credential_alias.v1",
    credential_alias_id: value.credential_alias_id,
    purpose: value.purpose as ProviderCredentialPurpose,
  });
}

function productAccount(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, ["account_id", "account_type"])
    && typeof value.account_id === "string" && ACCOUNT_ID.test(value.account_id)
    && typeof value.account_type === "string" && ACCOUNT_TYPE.test(value.account_type);
}

function validateCoreConnection(value: unknown, adapter: ProviderAdapter): {
  workspaceId: string;
  destinationConnectionId: string;
  accountPublicId: string;
  status: "disabled" | "test_only";
  credentialPresent: boolean;
} | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    "schema_version", "adapter_type", "adapter_major_version", "contract_variant",
    "workspace_id", "destination_connection_id", "account_public_id", "status",
    "test_verified", "credential_present",
  ]) || value.schema_version !== "destination_connection.v1" || value.adapter_type !== adapter
      || value.adapter_major_version !== 1 || value.contract_variant !== `${adapter}.v1`
      || !isUuidV7(value.workspace_id) || !isUuidV7(value.destination_connection_id)
      || typeof value.account_public_id !== "string" || !SAFE_PUBLIC_ID.test(value.account_public_id)
      || (value.status !== "disabled" && value.status !== "test_only")
      || value.test_verified !== false || typeof value.credential_present !== "boolean") return undefined;
  return {
    workspaceId: value.workspace_id,
    destinationConnectionId: value.destination_connection_id,
    accountPublicId: value.account_public_id,
    status: value.status,
    credentialPresent: value.credential_present,
  };
}

export function validateProviderConnectionSnapshotJson(
  snapshotJson: unknown,
  expected?: Partial<{
    adapterType: ProviderAdapter;
    workspaceId: string;
    destinationConnectionId: string;
    accountPublicId: string;
    status: "disabled" | "test_only";
    credentialAliasId: string | null;
    credentialPurpose: ProviderCredentialPurpose | null;
  }>,
): ValidatedProviderSnapshot | undefined {
  if (typeof snapshotJson !== "string" || snapshotJson.length < 2 || snapshotJson.length > 65_536) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(snapshotJson) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(value) || canonicalJson(value) !== snapshotJson || !hasExactKeys(value, [
    "schema_version", "adapter_type", "connection", "production_execution_released",
  ]) || value.schema_version !== "destination_provider_connection_snapshot.v1"
      || !isAdapter(value.adapter_type) || value.production_execution_released !== false
      || !isRecord(value.connection)) return undefined;
  const adapter = value.adapter_type;
  const connection = value.connection;
  let expectedKeys: ReadonlyArray<string>;
  if (adapter === "meta") {
    expectedKeys = ["core_connection", "dataset_id", "action_source", "credential_alias", "test_event_code"];
  } else if (adapter === "google_data_manager") {
    expectedKeys = ["core_connection", "destination_reference", "operating_account", "login_account",
      "linked_account", "product_destination_id", "credential_alias"];
  } else {
    expectedKeys = ["core_connection"];
  }
  if (!hasExactKeys(connection, expectedKeys)) return undefined;
  const core = validateCoreConnection(connection.core_connection, adapter);
  if (core === undefined) return undefined;
  const alias = parseProviderCredentialAlias(connection.credential_alias ?? null, adapter);
  if (alias === undefined) return undefined;
  if (adapter === "meta") {
    if (typeof connection.dataset_id !== "string" || !DATASET_ID.test(connection.dataset_id)
        || typeof connection.action_source !== "string" || !ACTION_SOURCE.has(connection.action_source)
        || (connection.test_event_code !== null
          && (typeof connection.test_event_code !== "string" || !TEST_EVENT_CODE.test(connection.test_event_code)))) return undefined;
    const active = core.status === "test_only";
    if ((alias !== null) !== active || core.credentialPresent !== active
        || (connection.test_event_code !== null) !== active) return undefined;
  } else if (adapter === "google_data_manager") {
    if (typeof connection.destination_reference !== "string" || !DESTINATION_REFERENCE.test(connection.destination_reference)
        || !productAccount(connection.operating_account)
        || (connection.login_account !== null && !productAccount(connection.login_account))
        || (connection.linked_account !== null && !productAccount(connection.linked_account))
        || typeof connection.product_destination_id !== "string"
        || !PRODUCT_DESTINATION.test(connection.product_destination_id)) return undefined;
    const active = core.status === "test_only";
    if ((alias !== null) !== active || core.credentialPresent !== active) return undefined;
  } else if (alias !== null || core.credentialPresent !== false) {
    return undefined;
  }
  if (expected?.adapterType !== undefined && expected.adapterType !== adapter
      || expected?.workspaceId !== undefined && expected.workspaceId !== core.workspaceId
      || expected?.destinationConnectionId !== undefined
        && expected.destinationConnectionId !== core.destinationConnectionId
      || expected?.accountPublicId !== undefined && expected.accountPublicId !== core.accountPublicId
      || expected?.status !== undefined && expected.status !== core.status
      || expected?.credentialAliasId !== undefined && expected.credentialAliasId !== (alias?.credential_alias_id ?? null)
      || expected?.credentialPurpose !== undefined && expected.credentialPurpose !== (alias?.purpose ?? null)) return undefined;
  return Object.freeze({
    value,
    adapterType: adapter,
    workspaceId: core.workspaceId,
    destinationConnectionId: core.destinationConnectionId,
    accountPublicId: core.accountPublicId,
    status: core.status,
    credentialAlias: alias,
  });
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function blobSha256Hex(value: unknown): string | undefined {
  let bytes: Uint8Array;
  if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
  else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  else if (Array.isArray(value) && value.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    bytes = Uint8Array.from(value as number[]);
  } else return undefined;
  return bytes.byteLength === 32
    ? [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("") : undefined;
}
