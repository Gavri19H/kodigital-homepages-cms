import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildConversionsAdminAssets } from "../scripts/build-conversions-admin";
import {
  buildConnectionCreateBody,
  parseExplicitAccountIds,
  unwrapConversionsUiContext,
  unwrapCoreControls,
  unwrapCorePage,
  unwrapCoreResultCollection,
  unwrapCreatedConnectionOrFlow,
  unwrapCreatedReport,
  unwrapCalculatedReportQueryRows,
  unwrapReportAdvancedResult,
  unwrapReportComparisonRows,
  unwrapReportDrillResult,
  unwrapReportQueryRows,
  withReportAccountIds,
} from "../src/admin/conversions/app/product-state";

const CONNECTION_ID = "0198f0aa-0000-7000-8000-000000000001";
const REPORT_ID = "0198f0aa-0000-7000-8000-000000000002";

function dataModule(source: string): string {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

describe("active conversions/reporting Core wire", () => {
  it("builds exact explicit-account bodies without widening permanent CMS authority", () => {
    expect(buildConnectionCreateBody({
      name: "Primary source",
      direction: "source",
      adapterType: "generic_api",
      accountId: "account.primary",
      currency: "USD",
      config: { adapter_type: "generic_api", base_url: "https://source.example.test" },
    })).toEqual({
      name: "Primary source",
      direction: "source",
      adapter_type: "generic_api",
      config_schema_version: 1,
      config: { adapter_type: "generic_api", base_url: "https://source.example.test" },
      account_id: "account.primary",
      currency: "USD",
    });
    expect(parseExplicitAccountIds("z-account, a-account")).toEqual(["a-account", "z-account"]);
    expect(() => parseExplicitAccountIds("a-account,a-account")).toThrow(/unique/u);
    expect(withReportAccountIds({ name: "Daily" }, ["z-account", "a-account"])).toEqual({
      name: "Daily",
      account_ids: ["a-account", "z-account"],
    });
  });

  it("decodes only the exact Core envelope and genuine resources", () => {
    expect(unwrapConversionsUiContext({
      schema_version: "cms_conversions_ui_context.v2",
      workspace_id: "0198f0aa-0000-7000-8000-000000000003",
      role: "administrator",
      capabilities: ["conversions.view", "connections.manage"],
      account_scope: [{ account_id: "kodigital-primary", currency: "USD" }],
      reporting_currency: "USD",
      time_zone: "Asia/Jerusalem",
      recipient_scope: [{
        recipient_id: "0198f0aa-0000-7000-8000-000000000004",
        display_label: "Owner",
      }],
    })).toEqual({
      workspaceId: "0198f0aa-0000-7000-8000-000000000003",
      role: "administrator",
      capabilities: ["conversions.view", "connections.manage"],
      accountScope: [{ accountId: "kodigital-primary", currency: "USD" }],
      reportingCurrency: "USD",
      timeZone: "Asia/Jerusalem",
      recipientScope: [{
        recipientId: "0198f0aa-0000-7000-8000-000000000004",
        displayLabel: "Owner",
      }],
    });
    expect(unwrapCorePage({ items: [{ connection_id: CONNECTION_ID }], next_cursor: null }))
      .toEqual({ items: [{ connection_id: CONNECTION_ID }], nextCursor: null });
    expect(unwrapCoreControls({ controls: [{ control_key: "production_execution", value: false }] }))
      .toEqual([{ control_key: "production_execution", value: false }]);
    expect(unwrapCoreResultCollection({ result: { outcome: "listed", items: [] } })).toEqual([]);
    expect(unwrapCreatedConnectionOrFlow({ result: { connection_id: CONNECTION_ID, name: "Primary" } }))
      .toMatchObject({ connection_id: CONNECTION_ID });
    expect(unwrapCreatedReport({ result: { report: { report_id: REPORT_ID, name: "Daily" } } }))
      .toMatchObject({ report_id: REPORT_ID });
    expect(unwrapReportQueryRows({
      result: { outcome: "completed", result: { rows: [{ day: "2026-07-20", conversions: 2 }] } },
      next_cursor: null,
    })).toEqual([{ day: "2026-07-20", conversions: 2 }]);
    expect(() => unwrapCorePage({ result: { items: [] } })).toThrow(/invalid response/u);
    expect(() => unwrapConversionsUiContext({
      schema_version: "cms_conversions_ui_context.v2",
      workspace_id: "0198f0aa-0000-7000-8000-000000000003",
      role: "administrator",
      capabilities: [],
      account_scope: [{ account_id: "manual-account", currency: "EUR" }],
      reporting_currency: "USD",
      time_zone: "UTC",
      recipient_scope: [],
    })).toThrow(/invalid response/u);
    expect(() => unwrapCoreControls({ result: { controls: [] } })).toThrow(/invalid response/u);
    expect(() => unwrapCreatedConnectionOrFlow({ result: { item: { connection_id: CONNECTION_ID } } }))
      .toThrow(/invalid response/u);
    expect(() => unwrapCreatedReport({ report: { report_id: REPORT_ID } })).toThrow(/invalid response/u);
    expect(() => unwrapReportQueryRows({
      result: { outcome: "async_required" },
      next_cursor: null,
    })).toThrow(/did not complete/u);
  });

  it("decodes calculated, comparison, subtotal and drill-through results from the real Core wire", () => {
    const query = {
      result: {
        outcome: "completed",
        result: { rows: [{ "dimension.day": "2026-07-20", "measure.qualified_count": "2" }] },
        calculated_result: {
          version: "report_calculated_query_result.v1",
          rows: [{ "calculated.qualified_share": "0.5000" }],
        },
        advanced_result: {
          version: "report_advanced_query_result.v1",
          top_n: 25,
          subtotals: [{
            level: 1,
            grouping: { "dimension.day": "2026-07-20" },
            values: { "measure.qualified_count": "2" },
          }],
          drill_through: {
            enabled: true,
            maximum_rows: 100,
            snapshot_sha256: "a".repeat(64),
          },
        },
      },
      comparison_result: {
        version: "report_comparison_query_result.v1",
        series: [{
          kind: "prior_period",
          date_range: {
            start: "2026-07-10T00:00:00.000Z",
            end: "2026-07-20T00:00:00.000Z",
          },
          query: {
            outcome: "completed",
            result: { rows: [{ "dimension.day": "2026-07-10" }] },
          },
        }],
      },
      next_cursor: null,
    };
    expect(unwrapCalculatedReportQueryRows(query)).toEqual([{
      "dimension.day": "2026-07-20",
      "measure.qualified_count": "2",
      "calculated.qualified_share": "0.5000",
    }]);
    expect(unwrapReportComparisonRows(query)).toEqual([{
      kind: "prior_period",
      dateRange: {
        start: "2026-07-10T00:00:00.000Z",
        end: "2026-07-20T00:00:00.000Z",
      },
      rows: [{ "dimension.day": "2026-07-10" }],
    }]);
    expect(unwrapReportAdvancedResult(query)).toEqual({
      topN: 25,
      subtotals: [{
        level: 1,
        grouping: { "dimension.day": "2026-07-20" },
        values: { "measure.qualified_count": "2" },
      }],
      drillThrough: {
        enabled: true,
        maximumRows: 100,
        snapshotSha256: "a".repeat(64),
      },
    });
    expect(unwrapReportDrillResult({ result: {
      outcome: "completed",
      detail_result: {
        version: "report_drill_through_result.v1",
        snapshot_sha256: "b".repeat(64),
        field_metadata: [{ field_id: "event_id", label: "Event ID" }],
        rows: [{ event_id: "evt_1" }],
        maximum_rows: 100,
      },
    } })).toEqual({
      fields: [{ fieldId: "event_id", label: "Event ID" }],
      rows: [{ event_id: "evt_1" }],
    });
    expect(() => unwrapReportAdvancedResult({
      ...query,
      result: {
        ...query.result,
        advanced_result: {
          ...query.result.advanced_result,
          snapshot_sha256: "not-a-hash",
        },
      },
    })).toThrow(/invalid response/u);
  });

  it("builds deterministic DOM-absent ESM with the exact exported builders and decoders", async () => {
    const first = await buildConversionsAdminAssets();
    const second = await buildConversionsAdminAssets();
    expect(second.manifestSource).toBe(first.manifestSource);
    expect(createHash("sha256").update(first.conversions.js.content).digest("hex"))
      .toBe(first.conversions.js.sha256);
    expect(createHash("sha256").update(first.reporting.js.content).digest("hex"))
      .toBe(first.reporting.js.sha256);

    const conversions = await import(dataModule(first.conversions.js.content));
    const reporting = await import(dataModule(first.reporting.js.content));
    expect(conversions.buildConnectionCreateBody({
      name: "Primary", direction: "source", adapterType: "generic_api",
      accountId: "account.primary", currency: "USD",
      config: { adapter_type: "generic_api", base_url: "https://source.example.test" },
    }).account_id).toBe("account.primary");
    expect(conversions.unwrapCreatedConnectionOrFlow({ result: { connection_id: CONNECTION_ID } }).connection_id)
      .toBe(CONNECTION_ID);
    expect(reporting.withReportAccountIds({ name: "Daily" }, "z-account,a-account").account_ids)
      .toEqual(["a-account", "z-account"]);
    expect(reporting.unwrapCreatedReport({ result: { report: { report_id: REPORT_ID } } }).report_id)
      .toBe(REPORT_ID);
    expect(reporting.unwrapReportQueryRows({ result: {
      outcome: "completed", result: { rows: [{ day: "2026-07-20" }] },
    }, next_cursor: null })).toEqual([{ day: "2026-07-20" }]);
  });
});
