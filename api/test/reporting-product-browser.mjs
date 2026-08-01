import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { ADMIN_ASSET_MANIFEST } from "../src/admin/conversions/asset-manifest.generated.ts";
import { adminLayout } from "../src/admin/templates/layout.ts";

const WORKSPACE_ID = "018f0000-0000-7000-8000-000000000001";
const REPORT_ID = "018f0000-0000-7000-8000-000000000002";
const RECIPIENT_ID = "018f0000-0000-7000-8000-000000000003";
const EXPORT_IDS = Object.freeze({
  csv: "018f0000-0000-7000-8000-000000000010",
  xlsx: "018f0000-0000-7000-8000-000000000011",
  pdf: "018f0000-0000-7000-8000-000000000012",
});
const EXPORT_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x4b, 0x4f]);
const NOW = "2026-07-29T00:00:00.000Z";
const EXPIRES = "2026-08-05T00:00:00.000Z";

const apiRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const reportingJs = await readFile(join(
  apiRoot,
  "public/assets/admin/reporting",
  ADMIN_ASSET_MANIFEST.reporting.js.fileName,
));
const reportingCss = await readFile(join(
  apiRoot,
  "public/assets/admin/reporting",
  ADMIN_ASSET_MANIFEST.reporting.css.fileName,
));
const html = adminLayout({
  title: "Reporting browser contract proof",
  activePath: "/admin/reporting",
  userEmail: "browser-proof@kodigital.invalid",
  content: '<div id="ko-reporting-root" data-page="reports" data-shell-state="dependency_unavailable" data-bootstrap-active="false"></div>',
  stylesheets: [ADMIN_ASSET_MANIFEST.reporting.css.url],
  moduleScripts: [ADMIN_ASSET_MANIFEST.reporting.js.url],
  conversionsUiEnabled: true,
});

const requests = [];
const serverFailures = [];
const exportedFormats = new Map();
let savedReport = null;

function json(response, status, body) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function reportQuery(body) {
  const query = {
    result: {
      outcome: "completed",
      result: {
        rows: [{
          "dimension.day": "2026-07-01",
          "measure.qualified_count": 12,
          "measure.attributed_count": 9,
          "calculated.qualified_efficiency": "12.0000",
        }],
      },
    },
    next_cursor: null,
  };
  if (body?.comparisons?.includes("prior_period")) {
    query.comparison_result = {
      version: "report_comparison_query_result.v1",
      series: [{
        kind: "prior_period",
        date_range: { start: "2026-05-31", end: "2026-07-01" },
        query: {
          outcome: "completed",
          result: {
            rows: [{
              "dimension.day": "2026-05-31",
              "measure.qualified_count": 10,
              "measure.attributed_count": 8,
              "calculated.qualified_efficiency": "10.0000",
            }],
          },
        },
      }],
    };
  }
  return query;
}

async function bodyFrom(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function assertMutationHeaders(request) {
  assert.match(
    String(request.headers["idempotency-key"] ?? ""),
    /^(?:[0-9a-f-]{36}|ko-local-)/,
    "every browser mutation must carry an idempotency key",
  );
  assert.match(
    String(request.headers["content-type"] ?? ""),
    /^application\/json\b/,
    "every browser mutation must be JSON",
  );
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const path = `${requestUrl.pathname}${requestUrl.search}`;
    const method = request.method ?? "GET";

    if (method === "GET" && requestUrl.pathname === "/admin/reporting") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (method === "GET" && requestUrl.pathname === ADMIN_ASSET_MANIFEST.reporting.js.url) {
      response.writeHead(200, { "Content-Type": ADMIN_ASSET_MANIFEST.reporting.js.contentType });
      response.end(reportingJs);
      return;
    }
    if (method === "GET" && requestUrl.pathname === ADMIN_ASSET_MANIFEST.reporting.css.url) {
      response.writeHead(200, { "Content-Type": ADMIN_ASSET_MANIFEST.reporting.css.contentType });
      response.end(reportingCss);
      return;
    }
    if (method === "GET" && requestUrl.pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }

    const body = await bodyFrom(request);
    requests.push({
      method,
      path,
      body,
      idempotencyKey: request.headers["idempotency-key"] ?? null,
    });
    if (method !== "GET") assertMutationHeaders(request);

    if (method === "GET" && path === "/api/admin/conversions/v1/reports?limit=100") {
      json(response, 200, { items: [], next_cursor: null });
      return;
    }
    if (method === "GET" && path === "/api/admin/conversions/v1/report-recipients") {
      json(response, 200, {
        result: {
          outcome: "listed",
          items: [{
            recipient_id: RECIPIENT_ID,
            verification_status: "verified",
            display_label: "Approved reporting recipient",
          }],
        },
      });
      return;
    }
    if (method === "GET" && path === "/api/admin/conversions/ui-context") {
      json(response, 200, {
        schema_version: "cms_conversions_ui_context.v2",
        workspace_id: WORKSPACE_ID,
        role: "accountable_owner",
        capabilities: ["reports.read", "reports.write", "reports.exports.download"],
        account_scope: [{ account_id: "kodigital-primary", currency: "USD" }],
        reporting_currency: "USD",
        time_zone: "Asia/Jerusalem",
        recipient_scope: [{
          recipient_id: RECIPIENT_ID,
          display_label: "Approved reporting recipient",
        }],
      });
      return;
    }
    if (method === "POST" && path === "/api/admin/conversions/v1/reports/preview") {
      assert.equal(body.report_definition.report_version, "report_definition.v1");
      assert.equal(body.report_definition.query_definition.definition_version, "report_query_definition.v1");
      assert.equal(body.report_definition.display_definition.display_version, "report_display_definition.v1");
      assert.deepEqual(body.account_ids, ["kodigital-primary"]);
      assert.equal(body.timezone, "Asia/Jerusalem");
      assert.equal(body.filters[0].field_id, "dimension.product_type");
      assert.equal(body.filters[0].value, "quiz");
      assert.deepEqual(body.comparisons, ["prior_period"]);
      assert.equal(Object.hasOwn(body, "sql"), false);
      json(response, 200, reportQuery(body));
      return;
    }
    if (method === "POST" && path === "/api/admin/conversions/v1/reports") {
      assert.equal(body.name, "Browser-proven conversion report");
      assert.equal(body.report_definition.advanced_definition.calculated_measure_set.definitions[0].id, "calculated.qualified_efficiency");
      savedReport = {
        report_id: REPORT_ID,
        row_version: 1,
        name: body.name,
        dataset: body.dataset,
        updated_at: NOW,
        report_definition: body.report_definition,
      };
      json(response, 201, { result: { outcome: "created", report: savedReport } });
      return;
    }
    if (method === "POST" && path === `/api/admin/conversions/v1/reports/${REPORT_ID}/query`) {
      assert(savedReport, "report must be saved before its immutable query runs");
      assert.equal(body.report_row_version, 1);
      assert.deepEqual(Object.keys(body).sort(), [
        "concrete_date_range",
        "page_limit",
        "report_row_version",
      ]);
      json(response, 200, reportQuery(savedReport.report_definition.advanced_definition));
      return;
    }
    if (method === "POST" && path === "/api/admin/conversions/v1/exports") {
      assert(savedReport, "report must be saved before export admission");
      assert.deepEqual(Object.keys(body).sort(), ["format", "report_id", "report_row_version"]);
      assert.equal(body.report_id, REPORT_ID);
      assert.equal(body.report_row_version, 1);
      assert(["csv", "xlsx", "pdf"].includes(body.format));
      exportedFormats.set(EXPORT_IDS[body.format], body.format);
      json(response, 202, {
        result: {
          outcome: "queued",
          export: {
            export_id: EXPORT_IDS[body.format],
            format: body.format,
            status: "queued",
            requested_at: NOW,
            expires_at: EXPIRES,
            row_count: null,
            byte_count: null,
          },
        },
      });
      return;
    }
    const exportStatusMatch = requestUrl.pathname.match(/^\/api\/admin\/conversions\/v1\/exports\/([^/]+)$/);
    if (method === "GET" && exportStatusMatch && exportedFormats.has(exportStatusMatch[1])) {
      const exportId = exportStatusMatch[1];
      const format = exportedFormats.get(exportId);
      json(response, 200, {
        result: {
          outcome: "completed",
          export: {
            export_id: exportId,
            format,
            status: "completed",
            requested_at: NOW,
            expires_at: EXPIRES,
            row_count: 1,
            byte_count: EXPORT_BYTES.byteLength,
          },
          download: {
            path: `/api/admin/conversions/v1/exports/${exportId}/download`,
          },
        },
      });
      return;
    }
    const exportDownloadMatch = requestUrl.pathname.match(/^\/api\/admin\/conversions\/v1\/exports\/([^/]+)\/download$/);
    if (method === "GET" && exportDownloadMatch && exportedFormats.has(exportDownloadMatch[1])) {
      const format = exportedFormats.get(exportDownloadMatch[1]);
      response.writeHead(200, {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="browser-proof.${format}"`,
        "Content-Type": format === "xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/octet-stream",
      });
      response.end(EXPORT_BYTES);
      return;
    }
    if (method === "POST" && path === `/api/admin/conversions/v1/reports/${REPORT_ID}/schedules`) {
      assert.equal(body.enabled, false);
      assert.deepEqual(body.recipient_ids, [RECIPIENT_ID]);
      assert.equal(body.recurrence.type, "weekly");
      assert.equal(body.recurrence.timezone, "Asia/Jerusalem");
      assert.equal(body.recurrence.local_time, "10:30");
      assert.deepEqual(body.recurrence.weekdays, [2]);
      json(response, 201, {
        result: {
          outcome: "created",
          schedule: {
            schedule_id: "018f0000-0000-7000-8000-000000000020",
            report_row_version: 1,
            enabled: false,
            format: body.format,
            recipient_ids: body.recipient_ids,
            recurrence: body.recurrence,
          },
        },
      });
      return;
    }

    json(response, 404, { error: { code: "not_found", message: `Unexpected ${method} ${path}` } });
  } catch (error) {
    serverFailures.push(error);
    json(response, 500, { error: { code: "browser_contract_failure", message: String(error) } });
  }
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
assert(address && typeof address === "object");
const origin = `http://127.0.0.1:${address.port}`;

const browser = await chromium.launch({ headless: true });
const browserErrors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => browserErrors.push(error));
  page.on("console", (entry) => {
    if (entry.type() === "error") browserErrors.push(new Error(entry.text()));
  });
  page.on("request", (request) => {
    assert.equal(new URL(request.url()).origin, origin, "Reporting must use only same-origin browser requests");
  });

  await page.goto(`${origin}/admin/reporting`, { waitUntil: "networkidle" });
  await page.getByText("Saved reports, recipient status, and permanent account scope are current.").waitFor();

  const tabs = page.getByRole("tab");
  assert.equal(await tabs.count(), 4);
  assert.deepEqual(await tabs.allTextContents(), ["Library", "Builder", "Results", "Export & schedule"]);
  await page.getByRole("button", { name: "New blank report" }).click();
  assert.equal(new URL(page.url()).pathname, "/admin/reporting/new");
  await page.getByRole("heading", { name: "1. What should this report answer?" }).waitFor();

  const dataset = page.locator("label.ko-config-field").filter({ hasText: /^Dataset/ }).locator("select");
  await dataset.waitFor();
  assert.deepEqual(await dataset.locator("option").allTextContents(), [
    "Conversions — business outcomes and value",
    "Deliveries — external attempt and outcome health",
    "Runs — source ingestion quality and timing",
  ]);
  assert.equal(await page.getByLabel("Search groupings").count(), 1);
  assert.equal(await page.getByLabel("Search measures").count(), 1);
  assert.equal(await page.getByRole("radio").count(), 8);
  assert.equal(await page.getByRole("checkbox", { name: /Previous period/ }).count(), 1);
  assert.equal(await page.getByRole("checkbox", { name: /Same period last year/ }).count(), 1);

  await page.getByLabel("Report name").fill("Browser-proven conversion report");
  await page.getByLabel("Report timezone").fill("Asia/Jerusalem");
  await page.getByRole("button", { name: "Add calculated measure" }).click();
  await page.getByLabel("Label", { exact: true }).fill("Qualified efficiency");
  await page.getByRole("button", { name: "Add filter" }).click();
  await page.getByLabel("Filter 1 field").selectOption("dimension.product_type");
  await page.getByLabel("Filter 1 value").fill("quiz");
  await page.getByRole("checkbox", { name: /Previous period/ }).check();

  await page.getByRole("tab", { name: "Export & schedule" }).click();
  assert.equal(await page.getByRole("button", { name: "Create export" }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Enable schedule" }).isDisabled(), true);
  await page.getByRole("tab", { name: "Builder" }).click();

  await page.getByRole("button", { name: "Run preview" }).click();
  await page.getByText("Read-only preview completed with 1 row. Nothing was saved.").waitFor();
  assert.equal(await page.getByRole("tab", { name: "Results" }).getAttribute("aria-selected"), "true");
  await page.getByRole("cell", { name: "2026-07-01" }).waitFor();
  await page.getByRole("heading", { name: "Previous period" }).waitFor();

  await page.getByRole("tab", { name: "Builder" }).click();
  await page.getByRole("button", { name: "Save report" }).click();
  await page.getByText("Report saved with a stable URL and immutable definition hashes.").waitFor();
  assert.equal(new URL(page.url()).pathname, `/admin/reporting/${REPORT_ID}`);

  await page.getByRole("tab", { name: "Builder" }).click();
  assert.equal(await page.getByRole("button", { name: "Run saved report" }).isDisabled(), false);
  await page.getByRole("button", { name: "Run saved report" }).click();
  await page.getByText("Query completed with 1 row on this page.").waitFor();

  await page.getByRole("tab", { name: "Library" }).click();
  await page.getByRole("row", { name: /Browser-proven conversion report/ }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Open" }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Duplicate" }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Archive" }).count(), 1);

  await page.getByRole("tab", { name: "Export & schedule" }).click();
  const exportSection = page.locator("section.ko-config-section").filter({
    has: page.getByRole("heading", { name: "Export the saved definition" }),
  });
  const format = exportSection.locator("select").first();
  await format.waitFor();
  assert.deepEqual(await format.locator("option").allTextContents(), ["CSV", "XLSX", "PDF"]);
  for (const value of ["csv", "pdf", "xlsx"]) {
    await format.selectOption(value);
    await page.getByRole("button", { name: "Create export" }).click();
    await page.getByRole("heading", { name: `${value.toUpperCase()} export: queued` }).waitFor();
  }
  assert.deepEqual([...exportedFormats.values()].sort(), ["csv", "pdf", "xlsx"]);

  await page.getByRole("button", { name: "Refresh export status" }).click();
  await page.getByRole("heading", { name: "XLSX export: completed" }).waitFor();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download signed export" }).click(),
  ]);
  assert.equal(download.suggestedFilename(), "browser-proof.xlsx");
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), EXPORT_BYTES);

  const scheduleSection = page.locator("section.ko-config-section").filter({
    has: page.getByRole("heading", { name: "Schedule a report" }),
  });
  await scheduleSection.locator("label.ko-config-field").filter({ hasText: /^Recurrence/ }).locator("select").selectOption("weekly");
  await page.getByLabel("Schedule timezone").fill("Asia/Jerusalem");
  await page.getByLabel("Local time").fill("10:30");
  await scheduleSection.locator("label.ko-config-field").filter({ hasText: /^Weekday/ }).locator("select").selectOption("2");
  const saveSchedule = page.getByRole("button", { name: "Save disabled schedule" });
  assert.equal(await saveSchedule.isDisabled(), false);
  await saveSchedule.click();
  await page.getByText("Disabled schedule saved with its timezone, recurrence, format, immutable report version, and verified recipients.").waitFor();
  await page.getByText("Weekly on day 2 at 10:30 in Asia/Jerusalem").waitFor();
  assert.equal(await page.getByRole("button", { name: "Enable schedule" }).isDisabled(), true);

  assert.deepEqual(serverFailures, []);
  assert.deepEqual(browserErrors, []);
  assert.equal(
    requests.some((request) => request.method === "POST" && request.path.endsWith("/schedules") && request.body.enabled === false),
    true,
  );
  assert.equal(
    requests.some((request) => request.method === "GET" && request.path.endsWith("/download")),
    true,
  );
  assert.equal(
    requests.some((request) => request.path.includes("http") || request.path.includes("email")),
    false,
  );

  process.stdout.write(JSON.stringify({
    result: "PASS",
    bundle: ADMIN_ASSET_MANIFEST.reporting.js.fileName,
    tabs: ["Library", "Builder", "Results", "Export & schedule"],
    workflow: "preview -> immutable save -> saved query -> CSV/XLSX/PDF admission -> status -> private download -> disabled schedule",
    boundary: "all browser requests same-origin; all mutations idempotent; activation remained disabled",
  }) + "\n");
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
