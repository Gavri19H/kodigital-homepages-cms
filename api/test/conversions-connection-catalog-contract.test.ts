import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import {
  CONNECTION_ADAPTERS,
  CONNECTION_CONFIG_SECTIONS,
  credentialTypesForAdapter,
  defaultConnectionConfig,
  normalizeConnectionConfigField,
  type ConnectionAdapter,
} from "../src/admin/conversions/app/connection-catalog";

type JsonObject = Record<string, unknown>;

interface SchemaNode {
  readonly const?: unknown;
  readonly items?: SchemaNode;
  readonly oneOf?: ReadonlyArray<SchemaNode>;
  readonly properties?: Readonly<Record<string, SchemaNode>>;
  readonly required?: ReadonlyArray<string>;
}

interface AdminContractsFile {
  readonly body_contracts: Readonly<Record<string, SchemaNode>>;
}

const WORKSPACE = resolve(import.meta.dirname, "../../..");
const CORE_ROOT = resolve(WORKSPACE, "kodigital-conversions");

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function valueAtPath(value: JsonObject, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (!isObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function schemaAtPath(schema: SchemaNode, path: string): SchemaNode | undefined {
  let current: SchemaNode | undefined = schema;
  for (const segment of path.split(".")) current = current?.properties?.[segment];
  return current;
}

function expectValueKeysInSchema(value: unknown, schema: SchemaNode, path: string): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isObject(item) && schema.items !== undefined) {
        expectValueKeysInSchema(item, schema.items, `${path}[]`);
      }
    }
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childSchema = schema.properties?.[key];
    expect(childSchema, `${path}.${key} must exist in the Core schema`).toBeDefined();
    if (childSchema !== undefined) expectValueKeysInSchema(child, childSchema, `${path}.${key}`);
  }
}

function completedConfig(adapter: ConnectionAdapter): JsonObject {
  const config = structuredClone(defaultConnectionConfig(adapter, "Asia/Jerusalem"));
  if (adapter === "generic_api") {
    config.base_url = "https://source.example.test/v1/rows";
    config.approved_origins = ["https://source.example.test"];
  } else if (adapter === "managed_email") {
    config.allowed_sender_domains = ["reports.example.test"];
  } else if (adapter === "google_sheets") {
    config.spreadsheet_id = "spreadsheet-1";
    config.worksheet_id = "worksheet-1";
    config.worksheet_name = "Conversions";
  } else if (adapter === "microsoft_excel") {
    config.tenant_id = "tenant-1";
    config.site_id = "site-1";
    config.drive_id = "drive-1";
    config.item_id = "item-1";
    config.table_id = "table-1";
  } else if (adapter === "meta") {
    config.dataset_id = "dataset-1";
    config.api_version = "v25.0";
  } else if (adapter === "google_data_manager") {
    config.customer_id = "customer-1";
    config.destination_id = "destination-1";
    config.api_version = "v1";
    config.schema_version = "v1";
  } else if (adapter === "taboola") {
    config.advertiser_id = "advertiser-1";
  } else if (adapter === "outbrain") {
    config.marketer_id = "marketer-1";
  } else if (adapter === "newsbreak") {
    config.account_id = "account-1";
    config.pixel_id = "pixel-1";
    config.partner_id = "partner-1";
    config.endpoint_contract_version = "v1";
  } else if (adapter === "generic_https") {
    config.url = "https://destination.example.test/events";
  }
  return config;
}

function runNativeCoreValidation(input: {
  readonly bodies: ReadonlyArray<JsonObject>;
  readonly credentials: ReadonlyArray<{
    readonly adapter: ConnectionAdapter;
    readonly credentialType: string;
    readonly expected: boolean;
  }>;
}): { readonly bodyCount: number; readonly credentialCount: number; readonly result: "PASS" } {
  const payload = Buffer.from(JSON.stringify({
    ...input,
    requestModule: pathToFileURL(resolve(CORE_ROOT, "apps/core/src/request.mjs")).href,
    connectionModule: pathToFileURL(
      resolve(CORE_ROOT, "apps/core/src/connection-repository.mjs"),
    ).href,
  })).toString("base64url");
  const script = `
    const input = JSON.parse(Buffer.from(process.argv.at(-1), "base64url").toString("utf8"));
    const { parseRouteBody } = await import(input.requestModule);
    const {
      validateConnectionConfigForAdapter,
      validateConnectionCredentialTypeForAdapter,
    } = await import(input.connectionModule);
    const route = {
      body: "json",
      body_contract: { id: "connections-create-request", version: 1 },
    };
    for (const body of input.bodies) {
      if (validateConnectionConfigForAdapter(body.config, body.adapter_type) !== body.config) {
        throw new Error("semantic validator changed the config");
      }
      const request = new Request("https://core.invalid/api/admin/conversions/v1/connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const parsed = await parseRouteBody(request, route);
      if (JSON.stringify(parsed) !== JSON.stringify(body)) {
        throw new Error("Core body parser changed the request");
      }
    }
    for (const item of input.credentials) {
      let accepted = true;
      try {
        validateConnectionCredentialTypeForAdapter(item.adapter, item.credentialType);
      } catch {
        accepted = false;
      }
      if (accepted !== item.expected) {
        throw new Error(\`credential allowlist mismatch:\${item.adapter}:\${item.credentialType}\`);
      }
    }
    process.stdout.write(JSON.stringify({
      bodyCount: input.bodies.length,
      credentialCount: input.credentials.length,
      result: "PASS",
    }));
  `;
  return JSON.parse(execFileSync(
    process.execPath,
    ["--no-warnings", "--input-type=module", "--eval", script, payload],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  )) as { readonly bodyCount: number; readonly credentialCount: number; readonly result: "PASS" };
}

describe("Connections UI/Core closed-contract parity", () => {
  it("keeps all 13 UI adapters, defaults, and editable paths inside the exact Core schema", () => {
    const contracts = JSON.parse(readFileSync(
      resolve(CORE_ROOT, "packages/contracts/generated/admin-contracts.v1.json"),
      "utf8",
    )) as AdminContractsFile;
    const createSchema = contracts.body_contracts["connections-create-request"];
    const branches = createSchema?.properties?.config?.oneOf;
    expect(CONNECTION_ADAPTERS).toHaveLength(13);
    expect(branches).toHaveLength(13);

    for (const definition of CONNECTION_ADAPTERS) {
      const branch = branches?.find(
        (candidate) => candidate.properties?.adapter_type?.const === definition.value,
      );
      expect(branch, `${definition.value} must have one Core config branch`).toBeDefined();
      if (branch === undefined) continue;

      const defaults = defaultConnectionConfig(definition.value, "Asia/Jerusalem");
      expect(defaults.adapter_type).toBe(definition.value);
      for (const required of branch.required ?? []) {
        expect(
          Object.hasOwn(defaults, required),
          `${definition.value}.${required} must exist in the UI default`,
        ).toBe(true);
      }
      expectValueKeysInSchema(defaults, branch, definition.value);

      for (const section of CONNECTION_CONFIG_SECTIONS[definition.value]) {
        for (const field of section.fields) {
          expect(
            schemaAtPath(branch, field.path),
            `${definition.value}.${field.path} must exist in the Core schema`,
          ).toBeDefined();
          if (field.visibleWhen !== undefined) {
            expect(
              schemaAtPath(branch, field.visibleWhen.path),
              `${definition.value}.${field.visibleWhen.path} visibility source must exist`,
            ).toBeDefined();
          }
        }
      }
    }
  });

  it("turns every documented UI draft into a body accepted by Core schema and semantics", () => {
    const bodies = CONNECTION_ADAPTERS.map((definition) => ({
        name: `${definition.label} contract fixture`,
        direction: definition.direction,
        adapter_type: definition.value,
        config_schema_version: 1,
        config: completedConfig(definition.value),
        account_id: "kodigital-primary",
        currency: "USD",
      }));
    expect(runNativeCoreValidation({ bodies, credentials: [] })).toEqual({
      bodyCount: 13,
      credentialCount: 0,
      result: "PASS",
    });
  });

  it("keeps custom schedule intervals editable and removes them outside custom mode", () => {
    for (const definition of CONNECTION_ADAPTERS) {
      const defaults = defaultConnectionConfig(definition.value, "Asia/Jerusalem");
      const customScheduleTypes = CONNECTION_CONFIG_SECTIONS[definition.value]
        .flatMap((section) => section.fields)
        .filter((field) => field.options?.some((option) => option.value === "custom"));
      for (const typeField of customScheduleTypes) {
        const prefix = typeField.path.slice(0, -".type".length);
        const intervalPath = `${prefix}.interval_minutes`;
        const intervalField = CONNECTION_CONFIG_SECTIONS[definition.value]
          .flatMap((section) => section.fields)
          .find((field) => field.path === intervalPath);
        expect(intervalField?.visibleWhen).toEqual({
          path: typeField.path,
          equals: "custom",
        });

        const custom = normalizeConnectionConfigField(defaults, typeField.path, "custom");
        expect(valueAtPath(custom, intervalPath)).toBe(60);
        expect(valueAtPath(custom, `${prefix}.local_time`)).toBeNull();
        expect(valueAtPath(custom, `${prefix}.day_of_week`)).toBeNull();
        expect(valueAtPath(custom, `${prefix}.day_of_month`)).toBeNull();

        const adjusted = normalizeConnectionConfigField(custom, intervalPath, 90);
        expect(valueAtPath(adjusted, intervalPath)).toBe(90);
        const daily = normalizeConnectionConfigField(adjusted, typeField.path, "daily");
        expect(valueAtPath(daily, intervalPath)).toBeUndefined();
        expect(valueAtPath(daily, `${prefix}.local_time`)).toBe("09:00");
      }
    }

    const webhook = defaultConnectionConfig("inbound_webhook", "UTC");
    const status200 = normalizeConnectionConfigField(webhook, "response.status", 200);
    expect(valueAtPath(status200, "response.status")).toBe(200);
  });

  it("keeps every write-only credential choice inside Core's adapter allowlist", () => {
    const credentialTypes = [
      "bearer_token",
      "provider_token",
      "api_key",
      "basic",
      "hmac",
      "service_account",
    ] as const;

    const credentials = CONNECTION_ADAPTERS.flatMap((definition) => {
      const visible = credentialTypesForAdapter(definition.value);
      return credentialTypes.map((credentialType) => ({
        adapter: definition.value,
        credentialType,
        expected: visible.includes(credentialType),
      }));
    });
    expect(runNativeCoreValidation({ bodies: [], credentials })).toEqual({
      bodyCount: 0,
      credentialCount: 78,
      result: "PASS",
    });
  });
});
