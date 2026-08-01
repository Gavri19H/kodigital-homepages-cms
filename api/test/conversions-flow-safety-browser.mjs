import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const FLOW_ID = "0198f0aa-0000-7000-8000-000000000080";
const CONNECTION_ID = "0198f0aa-0000-7000-8000-000000000081";
const SAMPLE_A = "0198f0aa-0000-7000-8000-000000000082";
const SAMPLE_B = "0198f0aa-0000-7000-8000-000000000083";
const manifest = readFileSync(
  new URL("../src/admin/conversions/asset-manifest.generated.ts", import.meta.url),
  "utf8",
);
const assetName = manifest.match(/fileName: "(conversions\.[a-f0-9]{16}\.js)"/u)?.[1];
if (!assetName) throw new Error("active conversions asset is missing from the generated manifest");
const asset = readFileSync(new URL(`../public/assets/admin/conversions/${assetName}`, import.meta.url), "utf8");

const context = {
  schema_version: "cms_conversions_ui_context.v2",
  workspace_id: "0198f0aa-0000-7000-8000-000000000084",
  role: "administrator",
  capabilities: ["conversions.view", "flows.manage", "flows.publish", "ownership.manage"],
  account_scope: [{ account_id: "account_one", currency: "USD" }],
  reporting_currency: "USD",
  time_zone: "UTC",
  recipient_scope: [{
    recipient_id: "0198f0aa-0000-7000-8000-000000000085",
    display_label: "operator@example.test",
  }],
};

const draft = {
  flow_id: FLOW_ID,
  flow_version_id: "0198f0aa-0000-7000-8000-000000000086",
  version: 1,
  row_version: 1,
  status: "draft",
  config_hash: "1".repeat(64),
  created_at: "2026-07-29T00:00:00.000Z",
  name: "Browser safety Flow",
  description: "",
  product_scope: "both",
  activity_label: "Conversion",
  vertical_label: "All",
  offer_scope: { type: "all", value: "all" },
  primary_connection_id: CONNECTION_ID,
  primary_config: {
    input_ordinal: 0,
    precedence: {
      business_version_field: null,
      business_version_kind: "none",
      input_priority: 100,
    },
  },
  identity_namespace: "browser-safety",
  identity_fields: ["source_record_id"],
  normalization: { fields: [{ source_field: "id", transforms: [] }] },
  rules: {
    ordered: [],
    default_outcome: { status: "invalid", effective_value_rule: "invalid", value: null },
  },
  mapping: {
    fields: [{
      canonical_field: "source_record_id",
      source_field: "id",
      fixed_value: null,
      required: true,
      transforms: [],
    }],
  },
  time: {
    occurred_at_field: "occurred_at",
    input_format: "iso_8601",
    timezone: "UTC",
    invalid_policy: "invalid",
  },
  currency: {
    reporting_currency: "USD",
    source_currency_field: null,
    fixed_source_currency: "USD",
    conversion_policy: "same_currency_only",
  },
  patch_inputs: [],
  internal_outputs: {
    canonical_storage: true,
    reporting: true,
    dashboard: false,
    dashboard_revenue: false,
  },
  destinations: [],
};

const json = (body) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

const previewBodies = [];
const publishReviewBodies = [];
const publishBodies = [];
const lifecycleBodies = [];
let flowStatus = "draft";
let latestVersionStatus = "draft";
let rowVersion = 1;
let activeVersionId = null;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.resourceType() === "document") {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><body><div id="ko-conversions-root" data-page="flows" data-bootstrap-active="false"></div><script type="module" src="/assets/admin/conversions/${assetName}"></script></body></html>`,
      });
      return;
    }
    if (url.pathname === `/assets/admin/conversions/${assetName}`) {
      await route.fulfill({ status: 200, contentType: "text/javascript", body: asset });
      return;
    }
    if (url.pathname === "/api/admin/conversions/ui-context") {
      await route.fulfill(json(context));
      return;
    }
    if (url.pathname === "/api/admin/conversions/v1/connections") {
      await route.fulfill(json({
        items: [{
          connection_id: CONNECTION_ID,
          name: "Archived source",
          direction: "source",
          adapter_type: "generic_api",
          status: "active",
        }],
        next_cursor: null,
      }));
      return;
    }
    if (url.pathname === "/api/admin/conversions/v1/runs") {
      await route.fulfill(json({
        items: [SAMPLE_A, SAMPLE_B].map((run_id, index) => ({
          run_id,
          connection_id: CONNECTION_ID,
          flow_id: FLOW_ID,
          status: "completed",
          preview_sample_ready: true,
          started_at: `2026-07-29T00:0${index}:00.000Z`,
        })),
        next_cursor: null,
      }));
      return;
    }
    if (url.pathname === `/api/admin/conversions/v1/flows/${FLOW_ID}`) {
      await route.fulfill(json({
        result: {
          flow_id: FLOW_ID,
          name: draft.name,
          status: flowStatus,
          latest_version: 1,
          latest_version_status: latestVersionStatus,
          active_version_id: activeVersionId,
        },
      }));
      return;
    }
    if (url.pathname === `/api/admin/conversions/v1/flows/${FLOW_ID}/drafts/1`
        && request.method() === "GET") {
      await route.fulfill(json({
        result: {
          ...draft,
          row_version: rowVersion,
          status: latestVersionStatus,
        },
      }));
      return;
    }
    if (/\/(source-preview|rule-preview|destination-preview)$/u.test(url.pathname)
        && request.method() === "POST") {
      const body = request.postDataJSON();
      const kind = url.pathname.endsWith("/source-preview")
        ? "source-preview"
        : url.pathname.endsWith("/rule-preview")
          ? "rule-preview"
          : "destination-preview";
      previewBodies.push(body);
      const previewHash = kind === "source-preview"
        ? (body.sample_reference === SAMPLE_A ? "a".repeat(64) : "b".repeat(64))
        : kind === "rule-preview"
          ? "c".repeat(64)
          : "d".repeat(64);
      await route.fulfill(json({
        result: {
          schema_version: "flow_preview.v1",
          kind,
          flow_id: FLOW_ID,
          version: 1,
          row_version: rowVersion,
          config_hash: draft.config_hash,
          sample_reference: body.sample_reference,
          requested_sample_count: body.requested_sample_count,
          evaluation_status: "evaluated",
          seen: 1,
          qualified: 1,
          waiting: 0,
          ignored: 0,
          invalid: 0,
          duplicate: 0,
          ambiguous: 0,
          conflict: 0,
          effective_value: "12.5000",
          rows: [{ source_record_id: "archived-1", status: "qualified" }],
          preview_hash: previewHash,
          production_effects: false,
          dispatch_prepared_count: 0,
          external_requests_made: 0,
          ...(kind === "destination-preview" ? {
            destination_evaluation_status: "evaluated",
            destination_count: 0,
            destination_ready_count: 0,
            fanout_count: 0,
            suppression_count: 0,
          } : {}),
        },
      }));
      return;
    }
    if (url.pathname === `/api/admin/conversions/v1/flows/${FLOW_ID}/drafts/1/publish-preview`
        && request.method() === "POST") {
      const body = request.postDataJSON();
      publishReviewBodies.push(body);
      await route.fulfill(json({
        result: {
          schema_version: "flow_publish_review.v1",
          flow_id: FLOW_ID,
          flow_version_id: draft.flow_version_id,
          version: 1,
          row_version: rowVersion,
          config_hash: draft.config_hash,
          decision: "ready",
          blockers: [],
          warnings: [],
          ownership_scope_count: 2,
          ownership_conflict_count: 0,
          preview_token: "local-readiness-token",
          review_hash: "e".repeat(64),
          expires_at: "2026-07-29T01:00:00.000Z",
          production_effects: false,
        },
      }));
      return;
    }
    if (url.pathname === `/api/admin/conversions/v1/flows/${FLOW_ID}/drafts/1/publish`
        && request.method() === "POST") {
      publishBodies.push(request.postDataJSON());
      flowStatus = "paused";
      latestVersionStatus = "published";
      activeVersionId = draft.flow_version_id;
      rowVersion = 2;
      await route.fulfill(json({
        result: {
          flow_id: FLOW_ID,
          flow_version_id: draft.flow_version_id,
          version: 1,
          status: "paused",
          row_version: rowVersion,
          production_execution: false,
        },
      }));
      return;
    }
    if (url.pathname === `/api/admin/conversions/v1/flows/${FLOW_ID}/resume`
        && request.method() === "POST") {
      lifecycleBodies.push({ action: "resume", body: request.postDataJSON() });
      flowStatus = "active";
      rowVersion = 3;
      await route.fulfill(json({
        result: { flow_id: FLOW_ID, status: flowStatus, row_version: rowVersion },
      }));
      return;
    }
    if (url.pathname === `/api/admin/conversions/v1/flows/${FLOW_ID}/pause`
        && request.method() === "POST") {
      lifecycleBodies.push({ action: "pause", body: request.postDataJSON() });
      flowStatus = "paused";
      rowVersion = 4;
      await route.fulfill(json({
        result: {
          flow_id: FLOW_ID,
          status: flowStatus,
          row_version: rowVersion,
          cancelled_delivery_count: 1,
        },
      }));
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  await page.goto(`https://cms.test/admin/conversions/flows/${FLOW_ID}`);
  await page.getByRole("heading", { name: "Browser safety Flow" }).waitFor();
  await page.getByRole("button", { name: /Preview real data/u }).click();
  const sample = page.getByLabel("Archived sample");
  await sample.selectOption(SAMPLE_A);
  await page.getByRole("button", { name: "Preview source" }).click();
  await page.locator(".ko-preview-summary").waitFor();
  await page.getByText(/Side-effect-free archived-sample evaluation\. Dispatch prepared: 0; external requests: 0/u).waitFor();
  assert.deepEqual(previewBodies, [{
    draft_row_version: 1,
    sample_reference: SAMPLE_A,
    patch_sample_references: [],
    requested_sample_count: 25,
  }]);

  await sample.selectOption(SAMPLE_B);
  assert.equal(await page.locator(".ko-preview-summary").count(), 0);
  await page.getByText("Archived sample changed. Run every preview again.").waitFor();

  await sample.selectOption(SAMPLE_A);
  await page.getByRole("button", { name: "Preview source" }).click();
  await page.getByRole("button", { name: /Side-effect-free test/u }).click();
  await page.getByRole("button", { name: "Preview rules" }).click();
  await page.getByRole("button", { name: "Preview destinations" }).click();
  await page.getByText("Destinations ready").waitFor();
  assert.equal(await page.getByText(/external requests: 0/u).count(), 2);
  assert.equal(previewBodies.length, 4);

  await page.getByRole("button", { name: /Ownership and publish/u }).click();
  const review = page.getByRole("button", { name: "Review publish" });
  assert.equal(await review.isDisabled(), false);
  await review.click();
  await page.getByText("ready", { exact: true }).waitFor();
  const publish = page.getByRole("button", { name: "Publish exact reviewed draft" });
  assert.equal(await publish.isDisabled(), false);
  assert.deepEqual(publishReviewBodies, [{
    draft_row_version: 1,
    source_preview_hash: "a".repeat(64),
    rule_preview_hash: "c".repeat(64),
    destination_preview_hash: "d".repeat(64),
  }]);

  await publish.click();
  await page.getByRole("heading", { name: "Flow lifecycle" }).waitFor();
  await page.getByText(/Current state:\s*paused/u).waitFor();
  assert.deepEqual(publishBodies, [{
    preview_token: "local-readiness-token",
    reason: "operator_publish",
  }]);

  await page.getByRole("button", { name: "Resume Flow" }).click();
  await page.getByRole("dialog", { name: "Confirm Flow resume" }).waitFor();
  await page.getByRole("button", { name: "Confirm resume" }).click();
  await page.getByText(/Current state:\s*active/u).waitFor();

  await page.getByRole("button", { name: "Pause Flow" }).click();
  await page.getByRole("dialog", { name: "Confirm Flow pause" }).waitFor();
  await page.getByRole("button", { name: "Confirm pause" }).click();
  await page.getByText(/Current state:\s*paused/u).waitFor();
  assert.deepEqual(lifecycleBodies, [{
    action: "resume",
    body: { row_version: 2, reason: "operator_resume" },
  }, {
    action: "pause",
    body: { row_version: 3, reason: "operator_pause" },
  }]);

  process.stdout.write(JSON.stringify({
    result: "PASS",
    sample_change: "cleared all rendered preview state and required a fresh preview",
    semantic_previews: "source, rule, and destination evaluated with zero dispatch and external requests",
    publish_review: "ready token bound to the three exact preview hashes",
    lifecycle: "disabled-first publish, readiness-gated resume, and safe pause completed against local API intercepts",
  }) + "\n");
} finally {
  await browser.close();
}
