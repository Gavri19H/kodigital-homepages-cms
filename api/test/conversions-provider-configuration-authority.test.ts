import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { HAS_CONVERSIONS_CORE, coreUrl, importCore } from "./helpers/conversions-core-root";
import type { Env } from "../src/env";

// Core's declaration-free ESM modules. These were six STATIC imports of
// `../../../kodigital-conversions/...`, each suppressed with `@ts-expect-error`
// (so these symbols were already untyped — `any` below is the status quo, not a
// loosening). A static import of a repo that is not checked out is a hard
// COLLECTION failure, which is what CI hit: Core is a separate repository and
// `.github/workflows/deploy.yml` checks out only this one. Loading them in
// `beforeAll` instead lets the suite skip honestly, and resolves Core wherever
// it actually is rather than assuming `../../../` — see
// ./helpers/conversions-core-root. Every call site below is unchanged.
/* eslint-disable @typescript-eslint/no-explicit-any */
let createProviderConnectionCapabilityClient: any;
let createDeliveryRepository: any;
let createDeliveryRuntime: any;
let createProviderCredentialResolver: any;
let captureRuntimePlatformRoot: any;
let closeRuntimeAuthority: any;
let deriveRuntimeChild: any;
let acceptDeliveryOutcome: any;
let cancelDeliveries: any;
let prepareDeliveryDispatch: any;
let previewDestination: any;
let recoverExpiredLease: any;
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeAll(async () => {
  if (!HAS_CONVERSIONS_CORE) return;
  ({ createProviderConnectionCapabilityClient } = await importCore(
    "apps/core/src/provider-connection-capability.mjs",
  ));
  ({ createDeliveryRepository } = await importCore("apps/core/src/delivery-repository.mjs"));
  ({ createDeliveryRuntime } = await importCore("apps/core/src/delivery-runtime.mjs"));
  ({ createProviderCredentialResolver } = await importCore(
    "apps/core/src/provider-credential-resolver.mjs",
  ));
  ({ captureRuntimePlatformRoot, closeRuntimeAuthority, deriveRuntimeChild } = await importCore(
    "packages/security/protected-port-authority.mjs",
  ));
  ({
    acceptDeliveryOutcome,
    cancelDeliveries,
    prepareDeliveryDispatch,
    previewDestination,
    recoverExpiredLease,
  } = await importCore("packages/destination-core/index.mjs"));
});
import {
  canonicalJson,
  issuePermanentActorContext,
  signOperationScope,
} from "../src/admin/conversions/actor-envelope";
import {
  resolvePermanentConversionsActor,
  type PermanentConversionsAuthority,
} from "../src/admin/conversions/permanent-authority";
import {
  PROVIDER_EXECUTE_PATH,
  PROVIDER_EXECUTE_REQUEST_PURPOSE,
  PROVIDER_PREPARE_PATH,
  PROVIDER_PREPARE_REQUEST_PURPOSE,
  handleProviderConfigurationRequest,
} from "../src/admin/conversions/provider-configuration-authority";

const PRINCIPAL = "0198f0aa-0000-7000-8000-000000000001";
const WORKSPACE = "0198f0aa-0000-7000-8000-000000000002";
const CONNECTION = "0198f0aa-0000-7000-8000-000000000003";
const ALIAS = "0198f0aa-0000-7000-8000-000000000004";
const FLOW = "0198f0aa-0000-7000-8000-000000000005";
const DELIVERY = "a12d9e7c-4b31-5a00-8000-000000000006";
const NOW = 1_789_000_000;
const NONCE = "abcdefghijklmnop";
const E2E_EVENT = "0198f0aa-0000-7000-8000-000000000008";
const E2E_FLOW = "0198f0aa-0000-7000-8000-000000000009";
const RELEASE = "0198f0aa-0000-7000-8000-00000000000a";
const SYSTEM_EVENT = "0198f0aa-0000-7000-8000-00000000000b";
const EMPTY_PORT = Object.freeze({});

function nullRecord(entries: Array<readonly [string, unknown]>): Readonly<Record<string, unknown>> {
  const value = Object.create(null) as Record<string, unknown>;
  for (const [name, field] of entries) {
    Object.defineProperty(value, name, { value: field, enumerable: true });
  }
  return Object.freeze(value);
}

function runtimeDescriptor(entries: Array<readonly [string, unknown]> = [["fixture", "cms-provider-authority"]]) {
  return nullRecord(entries);
}

function runtimeRoot(
  namespace: string,
  ports: Record<string, unknown>,
  descriptor: Readonly<Record<string, unknown>>,
  roots: unknown[],
) {
  const root = captureRuntimePlatformRoot(namespace, Object.freeze(ports), descriptor);
  roots.push(root);
  return root;
}

async function invokeDestination(
  boundaryId: string,
  portKey: string,
  protectedInput: unknown,
  operation: (capability: unknown, descriptor: unknown, input: unknown) => Promise<unknown>,
  input: unknown,
) {
  const descriptor = runtimeDescriptor([["fixture", "cms-provider-authority-destination"]]);
  const root = captureRuntimePlatformRoot("destination", Object.freeze({
    DESTINATION_CANCELLATION_PORT: EMPTY_PORT,
    DESTINATION_OUTCOME_PORT: EMPTY_PORT,
    DESTINATION_PREPARATION_PORT: EMPTY_PORT,
    DESTINATION_PREVIEW_PORT: EMPTY_PORT,
    DESTINATION_RECOVERY_PORT: EMPTY_PORT,
    [portKey]: protectedInput,
  }), descriptor);
  try {
    return await operation(deriveRuntimeChild(root, boundaryId, descriptor), descriptor, input);
  } finally {
    closeRuntimeAuthority(root);
  }
}

function destinationRuntimePort() {
  return Object.freeze({
    preview(input: unknown, verification: unknown = null) {
      return invokeDestination(
        "destination.preview", "DESTINATION_PREVIEW_PORT", Object.freeze({ verification }),
        previewDestination, input,
      );
    },
    prepare(input: unknown, ports: unknown, verification: unknown = null) {
      return invokeDestination(
        "destination.prepare", "DESTINATION_PREPARATION_PORT", Object.freeze({ ports, verification }),
        prepareDeliveryDispatch, input,
      );
    },
    accept(input: unknown, ports: unknown) {
      return invokeDestination(
        "destination.accept", "DESTINATION_OUTCOME_PORT", ports,
        acceptDeliveryOutcome, input,
      );
    },
    cancel(input: unknown, ports: unknown) {
      return invokeDestination(
        "destination.cancel", "DESTINATION_CANCELLATION_PORT", ports,
        cancelDeliveries, input,
      );
    },
    recover(input: unknown, ports: unknown) {
      return invokeDestination(
        "destination.recover", "DESTINATION_RECOVERY_PORT", ports,
        recoverExpiredLease, input,
      );
    },
  });
}

function providerCapabilityClient(environment: Env, roots: unknown[], onExecute?: () => void) {
  const descriptor = runtimeDescriptor();
  const providerPort = Object.freeze({
    binding: Object.freeze({
      fetch(url: string, init: RequestInit) {
        if (new URL(url).pathname === PROVIDER_EXECUTE_PATH) onExecute?.();
        return handleProviderConfigurationRequest(new Request(url, init), environment, NOW);
      },
    }),
    prepare_request_hmac_key_b64url: environment.CMS_PROVIDER_PREPARE_REQUEST_HMAC_KEY_B64URL,
    prepare_response_hmac_key_b64url: environment.CMS_PROVIDER_PREPARE_RESPONSE_HMAC_KEY_B64URL,
    execute_request_hmac_key_b64url: environment.CMS_PROVIDER_EXECUTE_REQUEST_HMAC_KEY_B64URL,
    execute_response_hmac_key_b64url: environment.CMS_PROVIDER_EXECUTE_RESPONSE_HMAC_KEY_B64URL,
    issuer: "kodigital_cms_provider_authority",
    audience: "kodigital-conversions-core",
    environment: "test",
    clock: Object.freeze({ now: () => new Date(NOW * 1_000).toISOString() }),
    nonce: () => Buffer.alloc(32, 8),
  });
  const root = runtimeRoot("provider", {
    CMS_PROVIDER_AUTHORITY_PORT: EMPTY_PORT,
    PROVIDER_CAPTURE_PORT: EMPTY_PORT,
    PROVIDER_FETCH_PORT: providerPort,
  }, descriptor, roots);
  return createProviderConnectionCapabilityClient(root, descriptor);
}

function providerCredentialResolver(roots: unknown[]) {
  const descriptor = runtimeDescriptor();
  const root = runtimeRoot("credential_resolver", {
    CREDENTIAL_KEK: EMPTY_PORT,
    CREDENTIAL_RESOLVER_PORT: Object.freeze({ entries: [{
      credential_alias: {
        schema_version: "destination_provider_credential_alias.v1",
        credential_alias_id: ALIAS,
        purpose: "meta_access_token",
      },
      workspace_id: WORKSPACE,
      destination_connection_id: CONNECTION,
      adapter_type: "meta",
      secret_value: "isolated-meta-test-token",
    }] }),
  }, descriptor, roots);
  return createProviderCredentialResolver(root, descriptor);
}

type NodeStatement = {
  run(...values: unknown[]): { changes: number | bigint };
  get(...values: unknown[]): Record<string, unknown> | undefined;
  all(...values: unknown[]): Record<string, unknown>[];
};
type NodeSqlite = { exec(sql: string): void; prepare(sql: string): NodeStatement; close(): void };
type NodeDatabaseCtor = new (path: string) => NodeSqlite;

function nodeDatabaseCtor(): NodeDatabaseCtor | undefined {
  try {
    return (createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: NodeDatabaseCtor }).DatabaseSync;
  } catch {
    return undefined;
  }
}

const NodeDatabaseSync = nodeDatabaseCtor();

class CoreD1Statement {
  constructor(
    private readonly owner: CoreD1,
    readonly sql: string,
    readonly parameters: unknown[] = [],
  ) {}

  bind(...parameters: unknown[]): CoreD1Statement {
    return new CoreD1Statement(this.owner, this.sql, parameters);
  }

  async run(): Promise<unknown> { return this.owner.execute(this, false); }
  async all(): Promise<unknown> { return this.owner.execute(this, true); }
  async first(column?: string): Promise<unknown> {
    const result = this.owner.execute(this, true) as { results: Record<string, unknown>[] };
    const row = result.results[0] ?? null;
    return column === undefined || row === null ? row : row[column] ?? null;
  }
}

class CoreD1 {
  constructor(readonly database: NodeSqlite) {}
  prepare(sql: string): CoreD1Statement { return new CoreD1Statement(this, sql); }
  execute(statement: CoreD1Statement, query: boolean): unknown {
    const prepared = this.database.prepare(statement.sql);
    if (query) {
      return { success: true, results: prepared.all(...statement.parameters), meta: { changes: 0 } };
    }
    const result = prepared.run(...statement.parameters);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
  async batch(statements: CoreD1Statement[]): Promise<unknown[]> {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => this.execute(statement, false));
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
  close(): void { this.database.close(); }
}

function realCoreD1(): CoreD1 {
  if (NodeDatabaseSync === undefined) throw new Error("node:sqlite is required for the integrated runtime proof");
  const database = new NodeDatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  database.exec(readFileSync(coreUrl("migrations/d1/0011_delivery_runtime.sql"), "utf8"));
  database.exec(`
    CREATE UNIQUE INDEX uq_destination_deliveries_id_workspace
      ON destination_deliveries(delivery_id,workspace_id);
    CREATE TABLE delivery_source_account_bindings(
      delivery_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      event_version INTEGER NOT NULL CHECK(event_version>=1),
      state_fingerprint TEXT NOT NULL CHECK(length(state_fingerprint)=64),
      source_account_id TEXT NOT NULL,
      currency TEXT NOT NULL CHECK(length(currency)=3),
      created_at TEXT NOT NULL,
      FOREIGN KEY(delivery_id,workspace_id)
        REFERENCES destination_deliveries(delivery_id,workspace_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT
    ) STRICT;
  `);
  return new CoreD1(database);
}

function key(byte: number): string {
  return Buffer.alloc(32, byte).toString("base64url");
}

function hmac(payload: unknown, rawKey: string, purpose: string): string {
  return createHmac("sha256", Buffer.from(rawKey, "base64url"))
    .update(`${purpose}\n${canonicalJson(payload)}`).digest("base64url");
}

function snapshot(): string {
  return canonicalJson({
    schema_version: "destination_provider_connection_snapshot.v1",
    adapter_type: "meta",
    connection: {
      core_connection: {
        schema_version: "destination_connection.v1", adapter_type: "meta", adapter_major_version: 1,
        contract_variant: "meta.v1", workspace_id: WORKSPACE, destination_connection_id: CONNECTION,
        account_public_id: "account-1", status: "test_only", test_verified: false, credential_present: true,
      },
      dataset_id: "12345", action_source: "website",
      credential_alias: {
        schema_version: "destination_provider_credential_alias.v1",
        credential_alias_id: ALIAS,
        purpose: "meta_access_token",
      },
      test_event_code: "TEST123",
    },
    production_execution_released: false,
  });
}

function authority(): PermanentConversionsAuthority {
  return {
    principalId: PRINCIPAL,
    canonicalEmail: "operator@example.com",
    accessSubject: "cf-user-1",
    workspaceId: WORKSPACE,
    role: "administrator",
    cmsCapabilities: ["conversions.view", "connections.manage"],
    coreCapabilities: ["conversions.view", "connections.manage"],
    accountScope: [{ account_id: "account-1", currency: "USD" }],
    reportingCurrency: "USD",
    timeZone: "UTC",
  };
}

function authorityRow() {
  return {
    principal_id: PRINCIPAL, canonical_email: "operator@example.com", access_subject: "cf-user-1",
    is_accountable_owner: 0, workspace_id: WORKSPACE, role: "administrator",
    capabilities_json: '["conversions.view","connections.manage"]',
    account_scope_json: '[{"account_id":"account-1","currency":"USD"}]',
    reporting_currency: "USD", time_zone: "UTC",
    accountable_owner_principal_id: "0198f0aa-0000-7000-8000-000000000009",
  };
}

function providerRow(status: "test_only" | "disabled" = "test_only") {
  const raw = snapshot();
  const digest = createHash("sha256").update(raw).digest();
  return {
    workspace_id: WORKSPACE, destination_connection_id: CONNECTION, current_config_version: 1,
    current_snapshot_sha256: digest, head_status: status, head_row_version: 7,
    adapter_type: "meta", account_public_id: "account-1", snapshot_json: raw, snapshot_sha256: digest,
    credential_alias_id: ALIAS, credential_purpose: "meta_access_token", alias_id: ALIAS,
    alias_workspace_id: WORKSPACE, alias_destination_connection_id: CONNECTION, alias_adapter_type: "meta",
    alias_purpose: "meta_access_token", alias_status: "test_only", alias_secret_present: 1,
  };
}

function database(providerRows: Record<string, unknown>[] = [providerRow()]): D1Database {
  return {
    prepare(sql: string) {
      const rows = sql.includes("FROM conversion_admin_principals") ? [authorityRow()] : providerRows;
      return {
        bind() { return this; },
        async all<T>() { return { results: rows as T[], success: true, meta: {} }; },
      };
    },
  } as unknown as D1Database;
}

function realCmsDatabase(): NodeSqlite {
  if (NodeDatabaseSync === undefined) throw new Error("node:sqlite is required for the integrated authority proof");
  const db = new NodeDatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0042_conversions_authority.sql", import.meta.url), "utf8"));
  db.prepare(`INSERT INTO conversion_admin_principals(
    principal_id,canonical_email,access_subject,display_name,status,is_accountable_owner,created_at,updated_at
  ) VALUES(?,'owner@example.com','cf-owner','Guy Haikov','active',1,0,0)`).run(PRINCIPAL);
  db.prepare(`INSERT INTO conversion_workspaces(
    workspace_id,workspace_name,status,reporting_currency,time_zone,accountable_owner_principal_id,created_at,updated_at
  ) VALUES(?,'KODigital','active','USD','UTC',?,0,0)`).run(WORKSPACE, PRINCIPAL);
  db.prepare(`INSERT INTO conversion_workspace_memberships(
    principal_id,workspace_id,role,status,capabilities_json,account_scope_json,created_at,updated_at
  ) VALUES(?,?,'accountable_owner','active','["conversions.view","connections.manage"]',
    '[{"account_id":"account-1","currency":"USD"}]',0,0)`).run(PRINCIPAL, WORKSPACE);
  db.exec(readFileSync(new URL("../migrations/0043_conversion_provider_connections.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0044_conversion_provider_execution_releases.sql", import.meta.url), "utf8"));
  const raw = snapshot();
  const digest = createHash("sha256").update(raw).digest();
  db.prepare(`INSERT INTO conversion_provider_credential_aliases(
    credential_alias_id,workspace_id,destination_connection_id,adapter_type,purpose,status,secret_present,
    created_at,created_by_principal_id,updated_at,updated_by_principal_id,row_version
  ) VALUES(?,?,?,?,?,'test_only',1,0,?,0,?,1)`).run(
    ALIAS, WORKSPACE, CONNECTION, "meta", "meta_access_token", PRINCIPAL, PRINCIPAL,
  );
  db.prepare(`INSERT INTO conversion_provider_connection_versions(
    workspace_id,destination_connection_id,config_version,adapter_type,account_public_id,snapshot_json,
    snapshot_sha256,credential_alias_id,credential_purpose,created_at,created_by_principal_id
  ) VALUES(?,?,1,'meta','account-1',?,?,?,?,0,?)`).run(
    WORKSPACE, CONNECTION, raw, digest, ALIAS, "meta_access_token", PRINCIPAL,
  );
  db.prepare(`INSERT INTO conversion_provider_connection_heads(
    destination_connection_id,workspace_id,current_config_version,current_snapshot_sha256,status,updated_at,row_version
  ) VALUES(?,?,1,?,'test_only',0,1)`).run(CONNECTION, WORKSPACE, digest);
  return db;
}

function realD1(db: NodeSqlite): D1Database {
  return {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      return {
        bind(...values: unknown[]) { bindings = values; return this; },
        async all<T>() {
          return { results: db.prepare(sql).all(...bindings) as T[], success: true, meta: {} };
        },
      };
    },
  } as unknown as D1Database;
}

function env(providerRows?: Record<string, unknown>[]): Env {
  return {
    DB: database(providerRows), APP_ENV: "test", CONVERSIONS_PROXY_ENABLED: "true",
    CONVERSIONS_ACTOR_AUDIENCE: "kodigital-conversions-core", CONVERSIONS_ACTOR_ENVIRONMENT: "test",
    CONVERSIONS_ACTOR_SIGNING_KEY_B64URL: key(1),
    CMS_PROVIDER_PREPARE_REQUEST_HMAC_KEY_B64URL: key(2),
    CMS_PROVIDER_PREPARE_RESPONSE_HMAC_KEY_B64URL: key(3),
    CMS_PROVIDER_EXECUTE_REQUEST_HMAC_KEY_B64URL: key(4),
    CMS_PROVIDER_EXECUTE_RESPONSE_HMAC_KEY_B64URL: key(5),
  } as Env;
}

async function prepareRequest(environment: Env): Promise<Request> {
  const actor = await issuePermanentActorContext(environment, authority(), NOW * 1_000);
  const scope = await signOperationScope({
    schema_version: "connection_test_authorization_scope.v1", actor_id: PRINCIPAL, workspace_id: WORKSPACE,
    request_id: actor.requestId, route: `/api/admin/conversions/v1/connections/${CONNECTION}/test`, method: "POST",
    connection_id: CONNECTION, test_kind: "connectivity_probe", expected_side_effect_mode: "none", destination_class: "none",
  }, actor.signingKey);
  const payload = {
    schema_version: "destination_provider_connection_prepare_request.v1",
    actor_authorization_envelope: actor.envelope,
    actor_authorization_sha256: createHash("sha256").update(canonicalJson(actor.envelope)).digest("hex"),
    connection_test_authorization_scope: scope,
    workspace_id: WORKSPACE, destination_connection_id: CONNECTION, flow_version_id: FLOW, delivery_id: DELIVERY,
    issued_at: NOW, expires_at: NOW + 30, nonce: NONCE,
  };
  return new Request(`https://private.invalid${PROVIDER_PREPARE_PATH}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: canonicalJson({ payload, signature: hmac(payload, environment.CMS_PROVIDER_PREPARE_REQUEST_HMAC_KEY_B64URL!, PROVIDER_PREPARE_REQUEST_PURPOSE) }),
  });
}

function executeRequest(environment: Env, overrides: Record<string, unknown> = {}): Request {
  const raw = snapshot();
  const payload = {
    schema_version: "destination_provider_connection_execute_request.v1",
    workspace_id: WORKSPACE, destination_connection_id: CONNECTION, adapter_type: "meta", account_public_id: "account-1",
    delivery_id: DELIVERY, delivery_generation: 1, attempt_number: 1, native_id: DELIVERY,
    first_attempt_at: "2026-07-20T00:00:00.000Z", started_at: "2026-07-20T00:00:01.000Z",
    lease_token: key(9), lease_generation: 1, dispatch_pointer_sha256: "a".repeat(64),
    expected_config_version: 1, expected_snapshot_sha256: createHash("sha256").update(raw).digest("hex"),
    issued_at: NOW, expires_at: NOW + 30, nonce: NONCE,
    ...overrides,
  };
  return new Request(`https://private.invalid${PROVIDER_EXECUTE_PATH}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: canonicalJson({ payload, signature: hmac(payload, environment.CMS_PROVIDER_EXECUTE_REQUEST_HMAC_KEY_B64URL!, PROVIDER_EXECUTE_REQUEST_PURPOSE) }),
  });
}

// SKIPPED WHOLE WITHOUT A CONVERSIONS CORE CHECKOUT (Core is a separate repo;
// CI checks out only this one). What the skip costs: the integrated CMS<->Core
// provider-configuration proofs — CMS's prepare/execute authority driven against
// Core's REAL capability client, credential resolver, delivery repository and
// delivery runtime, over Core's REAL 0011_delivery_runtime.sql schema in an
// in-memory SQLite, under Core's protected-port authority. Nothing in this repo
// can substitute: the claim IS agreement with the other side. Every assertion is
// unchanged and runs verbatim whenever Core is present
// (CONVERSIONS_CORE_ROOT=<path to kodigital-conversions>).
describe.skipIf(!HAS_CONVERSIONS_CORE)("private provider configuration authority", () => {
  it("runs the real CMS D1 authority through a restarted Core delivery and one-winner provider outcome", async () => {
    const cmsDb = realCmsDatabase();
    const coreDb = realCoreD1();
    const roots: unknown[] = [];
    try {
      const environment = { ...env(), DB: realD1(cmsDb) } as Env;
      const permanent = await resolvePermanentConversionsActor(environment, {
        mode: "identity", email: "owner@example.com", sub: "cf-owner", claims: {},
      });
      const actor = await issuePermanentActorContext(environment, permanent, NOW * 1_000);
      const scope = await signOperationScope({
        schema_version: "connection_test_authorization_scope.v1",
        actor_id: PRINCIPAL,
        workspace_id: WORKSPACE,
        request_id: actor.requestId,
        route: `/api/admin/conversions/v1/connections/${CONNECTION}/test`,
        method: "POST",
        connection_id: CONNECTION,
        test_kind: "connectivity_probe",
        expected_side_effect_mode: "none",
        destination_class: "none",
      }, actor.signingKey);
      let providerCalls = 0;
      const capabilityClient = providerCapabilityClient(environment, roots, () => { providerCalls += 1; });
      let clockMillis = NOW * 1_000;
      let entropy = 0;
      const deliveryDescriptor = runtimeDescriptor([
        ["rate_burst", 10],
        ["rate_tokens_per_second", 1],
      ]);
      const deliveryState = nullRecord([
        ["clock", () => new Date(clockMillis++).toISOString()],
        ["random_bytes", () => Buffer.alloc(32, ++entropy)],
      ]);
      const repositoryRoot = runtimeRoot("delivery", {
        CORE_D1: coreDb,
        DELIVERY_CREDENTIAL_RESOLVER_PORT: EMPTY_PORT,
        DELIVERY_DESTINATION_PORT: EMPTY_PORT,
        DELIVERY_PROVIDER_AUTHORITY_PORT: EMPTY_PORT,
        DELIVERY_LOCAL_TRANSPORT_PORT: EMPTY_PORT,
        DELIVERY_QUEUE: EMPTY_PORT,
        DELIVERY_REPOSITORY_PORT: EMPTY_PORT,
        DELIVERY_STATE: deliveryState,
      }, deliveryDescriptor, roots);
      const repository = createDeliveryRepository(
        deriveRuntimeChild(repositoryRoot, "delivery.repository", deliveryDescriptor),
        deliveryDescriptor,
      );
      const credentialResolver = providerCredentialResolver(roots);
      const queued: unknown[] = [];
      const runtime = () => {
        const root = runtimeRoot("delivery", {
          CORE_D1: coreDb,
          DELIVERY_CREDENTIAL_RESOLVER_PORT: credentialResolver,
          DELIVERY_DESTINATION_PORT: destinationRuntimePort(),
          DELIVERY_PROVIDER_AUTHORITY_PORT: capabilityClient,
          DELIVERY_LOCAL_TRANSPORT_PORT: Object.freeze({
            fetch: async () => { throw new Error("local fake delivery must not use HTTP"); },
            local_base_url: "http://127.0.0.1/",
            production_enabled: false,
          }),
          DELIVERY_QUEUE: Object.freeze({ async send(command: unknown) { queued.push(command); } }),
          DELIVERY_REPOSITORY_PORT: repository,
          DELIVERY_STATE: deliveryState,
        }, deliveryDescriptor, roots);
        return createDeliveryRuntime(
          deriveRuntimeChild(root, "delivery.runtime", deliveryDescriptor), deliveryDescriptor,
        );
      };
      const occurredAt = new Date((NOW - 60) * 1_000).toISOString();
      const prepared = await runtime().prepareNamed({
        actor_authorization_envelope: actor.envelope,
        connection_test_authorization_scope: scope,
        destination_connection_id: CONNECTION,
        flow: {
          schema_version: "destination_flow.v1",
          adapter_type: "meta",
          adapter_major_version: 1,
          contract_variant: "meta.v1",
          workspace_id: WORKSPACE,
          flow_id: E2E_FLOW,
          flow_version_id: FLOW,
          destination_connection_id: CONNECTION,
          destination_event_name: "Purchase",
          mappings: [
            { destination_field: "event_id", canonical_field: "event_id", required: true, preview_classification: "safe" },
            { destination_field: "event_time", canonical_field: "occurred_at", required: true, preview_classification: "safe" },
            { destination_field: "event_source_url", canonical_field: "event_source_url", required: true, preview_classification: "safe" },
            { destination_field: "value", canonical_field: "value", required: false, preview_classification: "safe" },
            { destination_field: "currency", canonical_field: "currency", required: false, preview_classification: "safe" },
          ],
          batch_size: 1,
        },
        event: {
          schema_version: "destination_event.v1",
          workspace_id: WORKSPACE,
          event_id: E2E_EVENT,
          event_version: 1,
          state_fingerprint: "7".repeat(64),
          platform_account_id: "account-1",
          currency: "USD",
          occurred_at: occurredAt,
          canonical_event_pointer: {
            schema_version: "destination_pointer.v1",
            key: `events/${E2E_EVENT}.json`,
            sha256: "6".repeat(64),
            byte_count: 256,
          },
          canonical_fields: {
            event_id: E2E_EVENT,
            occurred_at: occurredAt,
            event_source_url: "https://example.test/checkout",
            value: "42.0000",
            currency: "USD",
          },
        },
        delivery_generation: 0,
        redelivery_authorization: null,
        preview_approval_seal: null,
      });
      expect(prepared).toMatchObject({ state: "attempt_started", code: "dispatch_prepared" });
      expect(await runtime().flushOutbox({})).toEqual({ discovered: 1, enqueued: 1 });
      expect(queued).toHaveLength(1);
      expect(Object.keys(queued[0] as Record<string, unknown>).sort()).toEqual([
        "adapter_type", "dispatch_pointer", "schema_version",
      ]);

      const restarted = runtime();
      const results = await Promise.all(Array.from({ length: 32 }, () => restarted.simulateNamedDispatch({
        dispatch_pointer: prepared.dispatch_pointer,
        fake_outcome: { kind: "response", status: 200, provider_request_id: "isolated-meta-1" },
      })));
      expect(providerCalls).toBe(1);
      expect(results.filter((result: { state?: string }) => result.state === "succeeded")).toHaveLength(1);
      expect(results.filter((result: { disposition?: string }) =>
        result.disposition === "not_claimed_no_dispatch")).toHaveLength(31);
      expect(await repository.readDelivery(prepared.delivery_id)).toMatchObject({
        state: "succeeded", provider_request_id: "isolated-meta-1", attempt_count: 1,
      });
      const outbox = coreDb.database.prepare(`SELECT status,completion_kind,dispatch_claimed_at,call_admitted_at
        FROM destination_dispatch_outbox WHERE delivery_id=?`).get(prepared.delivery_id) as Record<string, unknown>;
      expect(outbox).toMatchObject({ status: "completed", completion_kind: "provider_outcome" });
      expect(outbox.dispatch_claimed_at).not.toBeNull();
      expect(outbox.call_admitted_at).not.toBeNull();
      expect((await runtime().simulateNamedDispatch({
        dispatch_pointer: prepared.dispatch_pointer,
        fake_outcome: { kind: "response", status: 200 },
      })).disposition).toBe("not_claimed_no_dispatch");
      expect(providerCalls).toBe(1);

      const systemPrepared = await runtime().prepareSystem({
        source_authority: {
          source_command_id: "c".repeat(64),
          state_fingerprint: "7".repeat(64),
        },
        destination_connection_id: CONNECTION,
        flow: {
          schema_version: "destination_flow.v1",
          adapter_type: "meta",
          adapter_major_version: 1,
          contract_variant: "meta.v1",
          workspace_id: WORKSPACE,
          flow_id: E2E_FLOW,
          flow_version_id: FLOW,
          destination_connection_id: CONNECTION,
          destination_event_name: "Purchase",
          mappings: [
            { destination_field: "event_id", canonical_field: "event_id", required: true, preview_classification: "safe" },
            { destination_field: "event_time", canonical_field: "occurred_at", required: true, preview_classification: "safe" },
            { destination_field: "value", canonical_field: "value", required: false, preview_classification: "safe" },
            { destination_field: "currency", canonical_field: "currency", required: false, preview_classification: "safe" },
          ],
          batch_size: 1,
        },
        event: {
          schema_version: "destination_event.v1",
          workspace_id: WORKSPACE,
          event_id: SYSTEM_EVENT,
          event_version: 1,
          state_fingerprint: "7".repeat(64),
          platform_account_id: "account-1",
          currency: "USD",
          occurred_at: occurredAt,
          canonical_event_pointer: {
            schema_version: "destination_pointer.v1",
            key: `events/${SYSTEM_EVENT}.json`,
            sha256: "8".repeat(64),
            byte_count: 256,
          },
          canonical_fields: {
            event_id: SYSTEM_EVENT,
            occurred_at: occurredAt,
            value: "42.0000",
            currency: "USD",
          },
        },
        delivery_generation: 0,
        redelivery_authorization: null,
        preview_approval_seal: null,
      });
      expect(systemPrepared).toMatchObject({
        state: "attempt_started",
        code: "dispatch_prepared",
      });
      expect(await runtime().flushOutbox({})).toEqual({
        discovered: 1,
        enqueued: 1,
      });
      expect(queued).toHaveLength(2);
      expect(providerCalls).toBe(1);
    } finally {
      for (const root of roots.reverse()) closeRuntimeAuthority(root);
      coreDb.close();
      cmsDb.close();
    }
  });

  it("round-trips the real Core prepare and execute client against the real CMS authority", async () => {
    const environment = env();
    const roots: unknown[] = [];
    const actor = await issuePermanentActorContext(environment, authority(), NOW * 1_000);
    const scope = await signOperationScope({
      schema_version: "connection_test_authorization_scope.v1", actor_id: PRINCIPAL, workspace_id: WORKSPACE,
      request_id: actor.requestId, route: `/api/admin/conversions/v1/connections/${CONNECTION}/test`, method: "POST",
      connection_id: CONNECTION, test_kind: "connectivity_probe", expected_side_effect_mode: "none", destination_class: "none",
    }, actor.signingKey);
    const client = providerCapabilityClient(environment, roots);
    try {
      const prepared = await client.prepare({
        actor_authorization_envelope: actor.envelope,
        connection_test_authorization_scope: scope,
        workspace_id: WORKSPACE,
        destination_connection_id: CONNECTION,
        flow_version_id: FLOW,
        delivery_id: DELIVERY,
      });
      expect(prepared.capability).toMatchObject({
        schema_version: "destination_provider_connection_prepare_capability.v1",
        principal_id: PRINCIPAL,
        adapter_type: "meta",
        status: "test_only",
        production_execution_released: false,
      });
      const systemPrepared = await client.prepareDelivery({
        workspace_id: WORKSPACE,
        destination_connection_id: CONNECTION,
        flow_id: E2E_FLOW,
        flow_version_id: FLOW,
        event_id: E2E_EVENT,
        event_version: 1,
        source_command_id: "c".repeat(64),
        state_fingerprint: "d".repeat(64),
        delivery_id: DELIVERY,
      });
      expect(systemPrepared.capability).toMatchObject({
        schema_version: "destination_provider_delivery_prepare_capability.v1",
        workspace_id: WORKSPACE,
        destination_connection_id: CONNECTION,
        flow_id: E2E_FLOW,
        flow_version_id: FLOW,
        event_id: E2E_EVENT,
        event_version: 1,
        source_command_id: "c".repeat(64),
        state_fingerprint: "d".repeat(64),
        adapter_type: "meta",
        status: "test_only",
        production_execution_released: false,
      });
      const dispatchRecord = {
        delivery_id: DELIVERY,
        delivery_generation: 0,
        attempt_number: 1,
        native_id: DELIVERY,
        first_attempt_at: "2026-07-20T00:00:00.000Z",
        started_at: "2026-07-20T00:00:01.000Z",
        lease_token: key(9),
        lease_generation: 1,
        provider_connection_authority: {
          schema_version: "destination_provider_connection_authority.v1",
          authority: "kodigital_cms",
          workspace_id: WORKSPACE,
          destination_connection_id: CONNECTION,
          adapter_type: prepared.capability.adapter_type,
          account_public_id: prepared.capability.account_public_id,
          config_version: prepared.capability.config_version,
          snapshot_sha256: prepared.capability.snapshot_sha256,
        },
      };
      const executed = await client.execute({
        dispatch_record: dispatchRecord,
        dispatch_pointer: { sha256: createHash("sha256").update(canonicalJson(dispatchRecord)).digest("hex") },
      });
      expect(executed.capability).toMatchObject({
        schema_version: "destination_provider_connection_execute_capability.v1",
        delivery_id: DELIVERY,
        lease_token: key(9),
        expected_config_version: 1,
        status: "test_only",
        production_execution_released: false,
      });
      expect(executed.connection.credential_alias).toEqual({
        schema_version: "destination_provider_credential_alias.v1",
        credential_alias_id: ALIAS,
        purpose: "meta_access_token",
      });
    } finally {
      for (const root of roots.reverse()) closeRuntimeAuthority(root);
    }
  });

  it("issues a v2 execution capability only for the exact active immutable release", async () => {
    const cmsDb = realCmsDatabase();
    const roots: unknown[] = [];
    try {
      const raw = snapshot();
      const sourceHash = createHash("sha256").update(raw).digest();
      const approvalHash = Buffer.from("b".repeat(64), "hex");
      cmsDb.prepare(`INSERT INTO conversion_provider_execution_releases(
        release_id,workspace_id,destination_connection_id,config_version,source_snapshot_sha256,
        adapter_type,account_public_id,release_mode,approval_packet_sha256,status,
        activated_at,expires_at,activated_by_principal_id,updated_at,updated_by_principal_id,row_version
      ) VALUES(?,?,?,1,?,'meta','account-1','meta_test_event',?,'active',?,?,?, ?,?,1)`).run(
        RELEASE, WORKSPACE, CONNECTION, sourceHash, approvalHash,
        NOW - 1, NOW + 300, PRINCIPAL, NOW - 1, PRINCIPAL,
      );
      const environment = { ...env(), DB: realD1(cmsDb) } as Env;
      const response = await handleProviderConfigurationRequest(
        executeRequest(environment), environment, NOW,
      );
      expect(response.status).toBe(200);
      const wire = await response.json() as { payload: Record<string, unknown> };
      expect(wire.payload).toMatchObject({
        schema_version: "destination_provider_connection_execute_capability.v2",
        production_execution_released: true,
        release_id: RELEASE,
        release_row_version: 1,
        approval_packet_sha256: "b".repeat(64),
        release_expires_at: NOW + 300,
      });
      expect(wire.payload.snapshot_sha256).toBe(
        createHash("sha256").update(String(wire.payload.snapshot_json)).digest("hex"),
      );
      expect(JSON.parse(String(wire.payload.snapshot_json))).toMatchObject({
        schema_version: "destination_provider_connection_snapshot.v2",
        production_execution_released: true,
        adapter_type: "meta",
      });

      const client = providerCapabilityClient(environment, roots);
      const dispatchRecord = {
        delivery_id: DELIVERY,
        delivery_generation: 0,
        attempt_number: 1,
        native_id: DELIVERY,
        first_attempt_at: "2026-07-20T00:00:00.000Z",
        started_at: "2026-07-20T00:00:01.000Z",
        lease_token: key(9),
        lease_generation: 1,
        provider_connection_authority: {
          schema_version: "destination_provider_connection_authority.v1",
          authority: "kodigital_cms",
          workspace_id: WORKSPACE,
          destination_connection_id: CONNECTION,
          adapter_type: "meta",
          account_public_id: "account-1",
          config_version: 1,
          snapshot_sha256: createHash("sha256").update(raw).digest("hex"),
        },
      };
      const released = await client.executeReleased({
        dispatch_record: dispatchRecord,
        dispatch_pointer: {
          sha256: createHash("sha256").update(canonicalJson(dispatchRecord)).digest("hex"),
        },
      });
      expect(released.capability).toMatchObject({
        schema_version: "destination_provider_connection_execute_capability.v2",
        snapshot_sha256: wire.payload.snapshot_sha256,
        production_execution_released: true,
      });
      expect(released.snapshot).toMatchObject({
        schema_version: "destination_provider_connection_snapshot.v2",
        production_execution_released: true,
      });
    } finally {
      for (const root of roots.reverse()) closeRuntimeAuthority(root);
      cmsDb.close();
    }
  });

  it("verifies the full permanent actor/scope and returns a signed prepare capability", async () => {
    const environment = env();
    const response = await handleProviderConfigurationRequest(await prepareRequest(environment), environment, NOW);
    expect(response.status).toBe(200);
    const envelope = await response.json() as { payload: Record<string, unknown>; signature: string };
    expect(envelope.payload).toMatchObject({
      schema_version: "destination_provider_connection_prepare_capability.v1", principal_id: PRINCIPAL,
      workspace_id: WORKSPACE, destination_connection_id: CONNECTION, adapter_type: "meta",
      account_public_id: "account-1", config_version: 1, head_row_version: 7,
      status: "test_only", production_execution_released: false,
    });
    expect(envelope.payload).not.toHaveProperty("actor_authorization_envelope");
    expect(envelope.payload).not.toHaveProperty("credential_alias_id");
  });

  it("resolves pointer-bound execute state and signs authenticated configuration denials", async () => {
    const environment = env();
    const success = await handleProviderConfigurationRequest(executeRequest(environment), environment, NOW);
    expect(success.status).toBe(200);
    await expect(success.json()).resolves.toMatchObject({ payload: {
      schema_version: "destination_provider_connection_execute_capability.v1",
      delivery_id: DELIVERY, lease_token: key(9), expected_config_version: 1,
      status: "test_only", production_execution_released: false,
    } });
    const changedEnv = env([]);
    const changed = await handleProviderConfigurationRequest(executeRequest(changedEnv), changedEnv, NOW);
    expect(changed.status).toBe(200);
    await expect(changed.json()).resolves.toMatchObject({ payload: {
      schema_version: "destination_provider_connection_execute_denial.v1", code: "changed", nonce: NONCE,
    } });
    const disabledEnv = env([providerRow("disabled")]);
    const disabled = await handleProviderConfigurationRequest(await prepareRequest(disabledEnv), disabledEnv, NOW);
    expect(disabled.status).toBe(200);
    await expect(disabled.json()).resolves.toMatchObject({ payload: {
      schema_version: "destination_provider_connection_prepare_denial.v1", code: "disabled",
    } });
  });

  it("rejects bad HMAC, media, expiry and extra request members before D1 authority", async () => {
    const environment = env();
    const badHmac = executeRequest(environment);
    const parsed = await badHmac.json() as { payload: Record<string, unknown>; signature: string };
    const bad = new Request(badHmac.url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: canonicalJson({ ...parsed, signature: "x".repeat(43) }),
    });
    expect((await handleProviderConfigurationRequest(bad, environment, NOW)).status).toBe(403);
    expect((await handleProviderConfigurationRequest(executeRequest(environment, { expires_at: NOW }), environment, NOW)).status).toBe(403);
    expect((await handleProviderConfigurationRequest(executeRequest(environment, { caller_connection: {} }), environment, NOW)).status).toBe(400);
    expect((await handleProviderConfigurationRequest(executeRequest(environment, {
      delivery_id: "a12d9e7c-4b31-9000-8000-000000000006",
    }), environment, NOW)).status).toBe(400);
    expect((await handleProviderConfigurationRequest(executeRequest(environment, {
      native_id: "A12d9e7c-4b31-5a00-8000-000000000006",
    }), environment, NOW)).status).toBe(400);
    const media = new Request(`https://private.invalid${PROVIDER_EXECUTE_PATH}`, { method: "POST", body: "{}" });
    expect((await handleProviderConfigurationRequest(media, environment, NOW)).status).toBe(415);
    const query = new Request(`${executeRequest(environment).url}?override=1`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    expect((await handleProviderConfigurationRequest(query, environment, NOW)).status).toBe(404);
  });

  it("byte-bounds private request streams, cancels excess and rejects malformed UTF-8", async () => {
    const environment = env();
    let declaredPulls = 0;
    let declaredCancels = 0;
    const declaredBody = new ReadableStream<Uint8Array>({
      pull(controller) { declaredPulls += 1; controller.enqueue(Uint8Array.from([123])); },
      cancel() { declaredCancels += 1; },
    });
    const declared = new Request(`https://private.invalid${PROVIDER_PREPARE_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": "2097153" },
      body: declaredBody,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect((await handleProviderConfigurationRequest(declared, environment, NOW)).status).toBe(400);
    expect(declaredPulls).toBe(0);
    expect(declaredCancels).toBe(1);

    let chunkPulls = 0;
    let chunkCancels = 0;
    const chunkedBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunkPulls += 1;
        if (chunkPulls <= 4) controller.enqueue(new Uint8Array(700_000).fill(0x61));
        else controller.close();
      },
      cancel() { chunkCancels += 1; },
    }, { highWaterMark: 0 });
    const chunked = new Request(`https://private.invalid${PROVIDER_PREPARE_PATH}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: chunkedBody, duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect((await handleProviderConfigurationRequest(chunked, environment, NOW)).status).toBe(400);
    expect(chunkPulls).toBe(3);
    expect(chunkCancels).toBe(1);

    const malformedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([0x7b, 0xc3, 0x28, 0x7d]));
        controller.close();
      },
    });
    const malformed = new Request(`https://private.invalid${PROVIDER_PREPARE_PATH}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: malformedBody, duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect((await handleProviderConfigurationRequest(malformed, environment, NOW)).status).toBe(400);
  });
});
