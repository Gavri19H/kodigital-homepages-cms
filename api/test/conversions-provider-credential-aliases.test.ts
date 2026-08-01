import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/admin/conversions/actor-envelope";
import {
  parseProviderCredentialAlias,
  validateProviderConnectionSnapshotJson,
} from "../src/admin/conversions/provider-credential-aliases";

const WORKSPACE = "0198f0aa-0000-7000-8000-000000000002";
const CONNECTION = "0198f0aa-0000-7000-8000-000000000003";
const ALIAS = "0198f0aa-0000-7000-8000-000000000004";

function core(adapter: string, status: "disabled" | "test_only", credential: boolean) {
  return {
    schema_version: "destination_connection.v1", adapter_type: adapter, adapter_major_version: 1,
    contract_variant: `${adapter}.v1`, workspace_id: WORKSPACE, destination_connection_id: CONNECTION,
    account_public_id: "account-1", status, test_verified: false, credential_present: credential,
  };
}

function snapshot(adapter: string, connection: Record<string, unknown>): string {
  return canonicalJson({
    schema_version: "destination_provider_connection_snapshot.v1",
    adapter_type: adapter,
    connection,
    production_execution_released: false,
  });
}

const metaAlias = {
  schema_version: "destination_provider_credential_alias.v1",
  credential_alias_id: ALIAS,
  purpose: "meta_access_token",
};
const googleAlias = { ...metaAlias, purpose: "google_oauth_access_token" };

describe("typed provider aliases and raw snapshots", () => {
  it("round-trips all five closed raw provider snapshots", () => {
    const fixtures = [
      snapshot("meta", {
        core_connection: core("meta", "test_only", true), dataset_id: "12345", action_source: "website",
        credential_alias: metaAlias, test_event_code: "TEST123",
      }),
      snapshot("google_data_manager", {
        core_connection: core("google_data_manager", "test_only", true), destination_reference: "dest-1",
        operating_account: { account_id: "123", account_type: "GOOGLE_ADS" }, login_account: null,
        linked_account: null, product_destination_id: "products/123", credential_alias: googleAlias,
      }),
      ...["newsbreak", "outbrain", "taboola"].map((adapter) => snapshot(adapter, {
        core_connection: core(adapter, "test_only", false),
      })),
    ];
    for (const fixture of fixtures) {
      const parsed = validateProviderConnectionSnapshotJson(fixture);
      expect(parsed).toBeDefined();
      expect(canonicalJson(parsed!.value)).toBe(fixture);
    }
  });

  it("keeps aliases provider/purpose scoped and rejects noncanonical, derived or credential-inventing shapes", () => {
    expect(parseProviderCredentialAlias(metaAlias, "meta")).toEqual(metaAlias);
    expect(parseProviderCredentialAlias(metaAlias, "google_data_manager")).toBeUndefined();
    expect(parseProviderCredentialAlias({ ...metaAlias, binding_name: "SECRET" }, "meta")).toBeUndefined();
    const valid = snapshot("newsbreak", { core_connection: core("newsbreak", "test_only", false) });
    expect(validateProviderConnectionSnapshotJson(` ${valid}`)).toBeUndefined();
    expect(validateProviderConnectionSnapshotJson(canonicalJson({
      ...JSON.parse(valid),
      public_settings: {},
    }))).toBeUndefined();
    expect(validateProviderConnectionSnapshotJson(snapshot("newsbreak", {
      core_connection: core("newsbreak", "test_only", true),
    }))).toBeUndefined();
  });
});
