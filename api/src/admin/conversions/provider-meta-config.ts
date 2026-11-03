// The only CMS writer of Meta provider configuration (Part A, A5). One PUT
// writes, in a single D1 batch: the credential alias (first activation only),
// a new immutable configuration version, the revocation of any active release,
// a new release for the chosen mode, one append-only audit row and, last, the
// head (optimistic row-version check). Every statement is guarded by the head
// still being exactly as read, so a lost race writes nothing at all. Nothing is proxied to Core here; the
// engine reads this state through the signed provider-authority endpoints.
import type { Env } from "../../env";
import { canonicalJson, createUuidV7, isUuidV7 } from "./actor-envelope";
import type { PermanentConversionsAuthority } from "./permanent-authority";
import {
  blobSha256Hex,
  sha256Hex,
  validateProviderConnectionSnapshotJson,
  type ProviderConnectionStatus,
} from "./provider-credential-aliases";

export const META_CONFIG_REQUEST_SCHEMA = "cms_meta_provider_config.v1";
export const META_CONFIG_VIEW_SCHEMA = "cms_meta_provider_config_view.v1";
export const META_TEST_EVENT_RELEASE_SECONDS = 3_600;
export const META_LIVE_RELEASE_SECONDS = 31_536_000;
const MAX_BODY_BYTES = 4_096;
const REQUEST_KEYS = Object.freeze([
  "schema_version", "status", "dataset_id", "action_source", "test_event_code", "expected_head_row_version",
]);
const DATASET_ID = /^[0-9]{1,32}$/;
const TEST_EVENT_CODE = /^[A-Za-z0-9_-]{1,64}$/;
const ACTION_SOURCES = new Set([
  "website", "app", "phone_call", "chat", "physical_store", "system_generated",
  "business_messaging", "other",
]);
const STATUSES = new Set<ProviderConnectionStatus>(["disabled", "test_only", "live"]);

export type MetaConfigErrorCode =
  | "invalid_request" | "not_found" | "resource_changed" | "credential_alias_inactive" | "unavailable";

export class MetaProviderConfigError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 415 | 503, readonly code: MetaConfigErrorCode) {
    super("meta provider configuration request rejected");
    this.name = "MetaProviderConfigError";
  }
}

export interface MetaProviderConfigView {
  readonly schema_version: typeof META_CONFIG_VIEW_SCHEMA;
  readonly connection_id: string;
  readonly configured: boolean;
  readonly status: ProviderConnectionStatus;
  readonly dataset_id: string | null;
  readonly action_source: string | null;
  readonly test_event_code: string | null;
  readonly head_row_version: number | null;
  readonly config_version: number | null;
  // The latest approval that is not revoked (active or expired). Shown only
  // while sending is on, so the panel can say when sending stops or stopped.
  readonly release: null | {
    readonly release_mode: "meta_test_event" | "meta_live";
    readonly expires_at: number;
    readonly ended: boolean;
  };
}

interface MetaConfigRequest {
  status: ProviderConnectionStatus;
  dataset_id: string;
  action_source: string;
  test_event_code: string | null;
  expected_head_row_version: number | null;
}

interface CurrentState {
  head: null | {
    workspaceId: string;
    status: ProviderConnectionStatus;
    rowVersion: number;
    configVersion: number;
    snapshotJson: string;
  };
  maxConfigVersion: number;
  foreignVersions: number;
  alias: null | { aliasId: string; workspaceId: string; status: unknown; secretPresent: unknown };
  release: null | { releaseMode: unknown; expiresAt: unknown; status: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g)!, (part) => Number.parseInt(part, 16));
}

export function parseMetaProviderConfigRequest(value: unknown): MetaConfigRequest {
  if (!isRecord(value)) throw new MetaProviderConfigError(400, "invalid_request");
  const keys = Object.keys(value).sort();
  const wanted = [...REQUEST_KEYS].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])
      || value.schema_version !== META_CONFIG_REQUEST_SCHEMA
      || typeof value.status !== "string" || !STATUSES.has(value.status as ProviderConnectionStatus)
      || typeof value.dataset_id !== "string" || !DATASET_ID.test(value.dataset_id)
      || typeof value.action_source !== "string" || !ACTION_SOURCES.has(value.action_source)
      || (value.status === "test_only"
        ? typeof value.test_event_code !== "string" || !TEST_EVENT_CODE.test(value.test_event_code)
        : value.test_event_code !== null)
      || (value.expected_head_row_version !== null
        && (!Number.isSafeInteger(value.expected_head_row_version)
          || (value.expected_head_row_version as number) < 1
          || (value.expected_head_row_version as number) > 2_147_483_647))) {
    throw new MetaProviderConfigError(400, "invalid_request");
  }
  return {
    status: value.status as ProviderConnectionStatus,
    dataset_id: value.dataset_id,
    action_source: value.action_source,
    test_event_code: value.test_event_code as string | null,
    expected_head_row_version: value.expected_head_row_version as number | null,
  };
}

export async function readMetaProviderConfigBody(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(type)) throw new MetaProviderConfigError(415, "invalid_request");
  let text: string;
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength < 2 || bytes.byteLength > MAX_BODY_BYTES) throw new Error("size");
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw new MetaProviderConfigError(400, "invalid_request");
  }
}

async function loadState(env: Env, workspaceId: string, connectionId: string): Promise<CurrentState> {
  try {
    const [head, versions, alias, release] = await Promise.all([
      env.DB.prepare(`SELECT h.workspace_id,h.status,h.row_version,h.current_config_version,
       h.current_snapshot_sha256,v.adapter_type,v.snapshot_json,v.snapshot_sha256
FROM conversion_provider_connection_heads h
JOIN conversion_provider_connection_versions v
  ON v.destination_connection_id=h.destination_connection_id
 AND v.config_version=h.current_config_version
WHERE h.destination_connection_id=?1`).bind(connectionId).first<Record<string, unknown>>(),
      env.DB.prepare(`SELECT COALESCE(MAX(config_version),0) AS max_version,
       COALESCE(SUM(CASE WHEN workspace_id!=?2 OR adapter_type!='meta' THEN 1 ELSE 0 END),0) AS foreign_versions
FROM conversion_provider_connection_versions WHERE destination_connection_id=?1`)
        .bind(connectionId, workspaceId).first<Record<string, unknown>>(),
      env.DB.prepare(`SELECT credential_alias_id,workspace_id,status,secret_present
FROM conversion_provider_credential_aliases
WHERE destination_connection_id=?1 AND adapter_type='meta' AND purpose='meta_access_token'
ORDER BY credential_alias_id LIMIT 2`).bind(connectionId).all<Record<string, unknown>>(),
      env.DB.prepare(`SELECT release_mode,expires_at,status FROM conversion_provider_execution_releases
WHERE destination_connection_id=?1 AND status IN ('active','expired')
ORDER BY status='active' DESC,activated_at DESC,release_id DESC LIMIT 1`).bind(connectionId).first<Record<string, unknown>>(),
    ]);
    if (versions === null || !Number.isSafeInteger(versions.max_version)
        || !Number.isSafeInteger(versions.foreign_versions)) throw new Error("versions");
    if (!alias.success || !Array.isArray(alias.results) || alias.results.length > 1) throw new Error("alias");
    const aliasRow = alias.results[0];
    let headState: CurrentState["head"] = null;
    if (head !== null) {
      const headHash = blobSha256Hex(head.current_snapshot_sha256);
      if (head.adapter_type !== "meta" || head.workspace_id !== workspaceId) {
        throw new MetaProviderConfigError(404, "not_found");
      }
      if (typeof head.snapshot_json !== "string" || headHash === undefined
          || headHash !== blobSha256Hex(head.snapshot_sha256)
          || await sha256Hex(head.snapshot_json) !== headHash
          || !STATUSES.has(head.status as ProviderConnectionStatus)
          || !Number.isSafeInteger(head.row_version) || !Number.isSafeInteger(head.current_config_version)) {
        throw new Error("head");
      }
      headState = {
        workspaceId: head.workspace_id,
        status: head.status as ProviderConnectionStatus,
        rowVersion: head.row_version as number,
        configVersion: head.current_config_version as number,
        snapshotJson: head.snapshot_json,
      };
    }
    return {
      head: headState,
      maxConfigVersion: versions.max_version as number,
      foreignVersions: versions.foreign_versions as number,
      alias: aliasRow === undefined ? null : {
        aliasId: String(aliasRow.credential_alias_id),
        workspaceId: String(aliasRow.workspace_id),
        status: aliasRow.status,
        secretPresent: aliasRow.secret_present,
      },
      release: release === null ? null : {
        releaseMode: release.release_mode, expiresAt: release.expires_at, status: release.status,
      },
    };
  } catch (error) {
    if (error instanceof MetaProviderConfigError) throw error;
    throw new MetaProviderConfigError(503, "unavailable");
  }
}

function viewFromState(
  workspaceId: string,
  connectionId: string,
  state: CurrentState,
  nowSeconds: number,
): MetaProviderConfigView {
  // A connection id configured under another workspace (or another provider)
  // is invisible here, never overwritten.
  if (state.foreignVersions > 0 || (state.alias !== null && state.alias.workspaceId !== workspaceId)) {
    throw new MetaProviderConfigError(404, "not_found");
  }
  if (state.head === null) {
    return Object.freeze({
      schema_version: META_CONFIG_VIEW_SCHEMA, connection_id: connectionId, configured: false,
      status: "disabled", dataset_id: null, action_source: null, test_event_code: null,
      head_row_version: null, config_version: null, release: null,
    });
  }
  const snapshot = validateProviderConnectionSnapshotJson(state.head.snapshotJson, {
    adapterType: "meta",
    workspaceId: state.head.workspaceId,
    destinationConnectionId: connectionId,
    status: state.head.status,
  });
  if (snapshot === undefined) throw new MetaProviderConfigError(503, "unavailable");
  const connection = snapshot.value.connection as Record<string, unknown>;
  const release = state.head.status !== "disabled" && state.release !== null
    && (state.release.releaseMode === "meta_test_event" || state.release.releaseMode === "meta_live")
    && Number.isSafeInteger(state.release.expiresAt)
    ? {
      release_mode: state.release.releaseMode,
      expires_at: state.release.expiresAt as number,
      ended: state.release.status !== "active" || (state.release.expiresAt as number) <= nowSeconds,
    } as const
    : null;
  return Object.freeze({
    schema_version: META_CONFIG_VIEW_SCHEMA,
    connection_id: connectionId,
    configured: true,
    status: state.head.status,
    dataset_id: connection.dataset_id as string,
    action_source: connection.action_source as string,
    test_event_code: connection.test_event_code as string | null,
    head_row_version: state.head.rowVersion,
    config_version: state.head.configVersion,
    release,
  });
}

export async function getMetaProviderConfig(
  env: Env,
  authority: PermanentConversionsAuthority,
  connectionId: string,
  nowMillis = Date.now(),
): Promise<MetaProviderConfigView> {
  if (!isUuidV7(connectionId)) throw new MetaProviderConfigError(404, "not_found");
  return viewFromState(authority.workspaceId, connectionId, await loadState(env, authority.workspaceId, connectionId),
    Math.floor(nowMillis / 1_000));
}

export function metaSnapshotJson(
  workspaceId: string,
  connectionId: string,
  request: MetaConfigRequest,
  aliasId: string | null,
): string {
  const active = request.status !== "disabled";
  return canonicalJson({
    schema_version: "destination_provider_connection_snapshot.v1",
    adapter_type: "meta",
    connection: {
      core_connection: {
        schema_version: "destination_connection.v1",
        adapter_type: "meta",
        adapter_major_version: 1,
        contract_variant: "meta.v1",
        workspace_id: workspaceId,
        destination_connection_id: connectionId,
        account_public_id: connectionId,
        status: request.status,
        test_verified: false,
        credential_present: active,
      },
      dataset_id: request.dataset_id,
      action_source: request.action_source,
      credential_alias: active ? {
        schema_version: "destination_provider_credential_alias.v1",
        credential_alias_id: aliasId,
        purpose: "meta_access_token",
      } : null,
      test_event_code: request.status === "test_only" ? request.test_event_code : null,
    },
    production_execution_released: false,
  });
}

function isConflict(error: unknown): boolean {
  const message = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : "";
  return /UNIQUE constraint|PRIMARY KEY|FOREIGN KEY constraint|SQLITE_CONSTRAINT/i.test(message);
}

export async function putMetaProviderConfig(
  env: Env,
  authority: PermanentConversionsAuthority,
  connectionId: string,
  body: unknown,
  nowMillis = Date.now(),
): Promise<MetaProviderConfigView> {
  if (!isUuidV7(connectionId)) throw new MetaProviderConfigError(404, "not_found");
  const request = parseMetaProviderConfigRequest(body);
  const workspaceId = authority.workspaceId;
  const principalId = authority.principalId;
  const nowSeconds = Math.floor(nowMillis / 1_000);
  const state = await loadState(env, workspaceId, connectionId);
  viewFromState(workspaceId, connectionId, state, nowSeconds);
  if ((state.head === null) !== (request.expected_head_row_version === null)
      || (state.head !== null && state.head.rowVersion !== request.expected_head_row_version)) {
    throw new MetaProviderConfigError(409, "resource_changed");
  }
  const active = request.status !== "disabled";
  if (active && state.alias !== null && (state.alias.status !== "test_only" || state.alias.secretPresent !== 1)) {
    throw new MetaProviderConfigError(409, "credential_alias_inactive");
  }
  const aliasId = active ? state.alias?.aliasId ?? createUuidV7(nowMillis) : null;
  const snapshotJson = metaSnapshotJson(workspaceId, connectionId, request, aliasId);
  const snapshotHash = hexBytes(await sha256Hex(snapshotJson));
  const configVersion = state.maxConfigVersion + 1;
  if (configVersion > 2_147_483_647) throw new MetaProviderConfigError(409, "resource_changed");
  const releaseId = active ? createUuidV7(nowMillis) : null;
  const releaseMode = request.status === "live" ? "meta_live" : "meta_test_event";
  const releaseSeconds = request.status === "live" ? META_LIVE_RELEASE_SECONDS : META_TEST_EVENT_RELEASE_SECONDS;
  const approvalHash = hexBytes(await sha256Hex(
    `${canonicalJson(body)}\n${principalId}\n${String(nowSeconds)}`,
  ));
  const db = env.DB;
  // Optimistic lock: every statement below is a no-op unless the head is still
  // exactly as read (same row version, or still absent on a first save). The
  // head change runs last, so within the batch the guard sees the same head for
  // every statement; if the head moved, nothing is written and the head change
  // reports 0 rows, which becomes resource_changed.
  const guardValues: unknown[] = state.head === null ? [connectionId] : [connectionId, workspaceId, state.head.rowVersion];
  const guard = (n: number): string => state.head === null
    ? `NOT EXISTS(SELECT 1 FROM conversion_provider_connection_heads WHERE destination_connection_id=?${n})`
    : `EXISTS(SELECT 1 FROM conversion_provider_connection_heads
  WHERE destination_connection_id=?${n} AND workspace_id=?${n + 1} AND row_version=?${n + 2})`;
  const statements: D1PreparedStatement[] = [];
  if (active && state.alias === null) {
    statements.push(db.prepare(`INSERT INTO conversion_provider_credential_aliases(
  credential_alias_id,workspace_id,destination_connection_id,adapter_type,purpose,status,secret_present,
  created_at,created_by_principal_id,updated_at,updated_by_principal_id,row_version
) SELECT ?1,?2,?3,'meta','meta_access_token','test_only',1,?4,?5,?4,?5,1 WHERE ${guard(6)}`)
      .bind(aliasId, workspaceId, connectionId, nowSeconds, principalId, ...guardValues));
  }
  statements.push(db.prepare(`INSERT INTO conversion_provider_connection_versions(
  workspace_id,destination_connection_id,config_version,adapter_type,account_public_id,snapshot_json,
  snapshot_sha256,credential_alias_id,credential_purpose,created_at,created_by_principal_id
) SELECT ?1,?2,?3,'meta',?2,?4,?5,?6,?7,?8,?9 WHERE ${guard(10)}`).bind(workspaceId, connectionId, configVersion,
    snapshotJson, snapshotHash, aliasId, active ? "meta_access_token" : null, nowSeconds, principalId, ...guardValues));
  statements.push(db.prepare(`UPDATE conversion_provider_execution_releases
SET status='revoked',updated_at=max(updated_at,?2),updated_by_principal_id=?3,row_version=row_version+1
WHERE destination_connection_id=?1 AND status='active' AND ${guard(4)}`)
    .bind(connectionId, nowSeconds, principalId, ...guardValues));
  if (active) {
    statements.push(db.prepare(`INSERT INTO conversion_provider_execution_releases(
  release_id,workspace_id,destination_connection_id,config_version,source_snapshot_sha256,
  adapter_type,account_public_id,release_mode,approval_packet_sha256,status,
  activated_at,expires_at,activated_by_principal_id,updated_at,updated_by_principal_id,row_version
) SELECT ?1,?2,?3,?4,?5,'meta',?3,?6,?7,'active',?8,?9,?10,?8,?10,1 WHERE ${guard(11)}`)
      .bind(releaseId, workspaceId, connectionId, configVersion, snapshotHash, releaseMode, approvalHash,
        nowSeconds, nowSeconds + releaseSeconds, principalId, ...guardValues));
  }
  statements.push(db.prepare(`INSERT INTO conversion_provider_change_audit(
  audit_id,workspace_id,destination_connection_id,principal_id,action,from_status,to_status,
  config_version,release_id,created_at
) SELECT ?1,?2,?3,?4,'meta_configure',?5,?6,?7,?8,?9 WHERE ${guard(10)}`)
    .bind(createUuidV7(nowMillis), workspaceId, connectionId, principalId, state.head?.status ?? null,
      request.status, configVersion, releaseId, nowSeconds, ...guardValues));
  const headIndex = statements.length;
  if (state.head === null) {
    statements.push(db.prepare(`INSERT INTO conversion_provider_connection_heads(
  destination_connection_id,workspace_id,current_config_version,current_snapshot_sha256,status,updated_at,row_version
) SELECT ?1,?2,?3,?4,?5,?6,1 WHERE ${guard(7)}`)
      .bind(connectionId, workspaceId, configVersion, snapshotHash, request.status, nowSeconds, ...guardValues));
  } else {
    statements.push(db.prepare(`UPDATE conversion_provider_connection_heads
SET current_config_version=?3,current_snapshot_sha256=?4,status=?5,updated_at=max(updated_at,?6),
    row_version=row_version+1
WHERE destination_connection_id=?1 AND workspace_id=?2 AND row_version=?7`)
      .bind(connectionId, workspaceId, configVersion, snapshotHash, request.status, nowSeconds, state.head.rowVersion));
  }
  let results: D1Result[];
  try {
    results = await db.batch(statements);
  } catch (error) {
    throw isConflict(error)
      ? new MetaProviderConfigError(409, "resource_changed")
      : new MetaProviderConfigError(503, "unavailable");
  }
  // The head did not move from what we read; every guarded statement was a no-op.
  if (results[headIndex]?.meta?.changes !== 1) throw new MetaProviderConfigError(409, "resource_changed");
  return getMetaProviderConfig(env, authority, connectionId, nowMillis);
}
