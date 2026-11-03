import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversionsApiError, requestConversionsApi } from "../src/admin/conversions/app/api-client";
import {
  ACTION_SOURCE_OPTIONS,
  CONNECTION_CONFIG_SECTIONS,
  defaultConnectionConfig,
  isConfigFieldShown,
  META_DEFAULT_ACTION_SOURCE,
  metaActionSourceWarning,
  normalizeConnectionConfigField,
} from "../src/admin/conversions/app/connection-catalog";
import {
  defaultDestination,
  defaultFlowDraft,
  draftBodyForSave,
  publishReviewSentence,
} from "../src/admin/conversions/app/flow-draft-helpers";
import { CONVERSIONS_CORE_ROOT, HAS_CONVERSIONS_CORE } from "./helpers/conversions-core-root";

type Item = Record<string, unknown>;

const connections = readFileSync(new URL("../src/admin/conversions/app/connections.tsx", import.meta.url), "utf8");
const flows = readFileSync(new URL("../src/admin/conversions/app/flows.tsx", import.meta.url), "utf8");

describe("Facebook: where the conversion happened", () => {
  it("defaults to Other with a plain label and does not offer Website", () => {
    expect(META_DEFAULT_ACTION_SOURCE).toBe("other");
    expect(ACTION_SOURCE_OPTIONS).toContainEqual({ value: "other", label: "Other (a partner reported it)" });
    expect(ACTION_SOURCE_OPTIONS.map((option) => option.value)).not.toContain("website");
    expect(ACTION_SOURCE_OPTIONS.map((option) => option.label)).not.toContain("Website");
    expect(connections).toContain("useState(META_DEFAULT_ACTION_SOURCE)");
    expect(connections).toContain("next.actionSource ?? META_DEFAULT_ACTION_SOURCE");
    expect(connections).not.toMatch(/useState\("website"\)|\?\? "website"/u);
  });

  it("warns only for a connection saved earlier as Website, and blocks saving it again", () => {
    expect(metaActionSourceWarning("website")).toBe(
      "This connection is set to Website, which Facebook can't accept here. Choose Other and save.",
    );
    for (const option of ACTION_SOURCE_OPTIONS) {
      expect(metaActionSourceWarning(option.value)).toBeNull();
    }
    expect(connections).toContain("const actionSourceWarning = metaActionSourceWarning(actionSource);");
    expect(connections).toMatch(/actionSourceWarning !== null && <div class="ko-conversions-state ko-conversions-state--warning" role="alert">/u);
    // A saved Website value is shown as it is, but cannot be picked again.
    expect(connections).toContain('{actionSource === "website" && <option value="website" disabled>Website (not accepted)</option>}');
    expect(connections).toMatch(/const missing = actionSourceWarning !== null\s+\? "Choose Other for Where the conversion happened\."/u);
  });

  it("has no Flow-level choice that the sender would ignore", () => {
    expect(flows).not.toContain("ACTION_SOURCE_OPTIONS");
    expect(flows).not.toMatch(/action_source: event\.currentTarget\.value/u);
    expect(flows).toContain("Where the conversion happened is set on the Facebook connection");
    expect((defaultDestination("c1", true).mapping as Item).action_source).toBe("other");
  });
});

describe("Publish review blockers in plain English", () => {
  it("explains each known blocker with the action to take", () => {
    expect(publishReviewSentence("ownership_conflict")).toBe(
      "Another Flow already sends conversions for these offers. In Basics → Offers, choose only this partner's offers.",
    );
    expect(publishReviewSentence("connection_test_not_current")).toBe(
      "Run the connection test again (Connections → this connection → Run test).",
    );
    expect(publishReviewSentence("source_input_not_ready")).toBe(
      "Open the partner link once (Connections → Try the link) to create a preview sample.",
    );
    for (const code of [
      "destination_not_ready", "ownership_scope_unresolved", "ownership_claim_set_not_exact",
      "source_preview_not_ready", "rule_preview_not_ready", "destination_preview_not_ready",
      "connection_facts_changed", "identity_uniqueness_bounded_sample_only",
      "sample_contains_invalid_rows", "sample_contains_duplicate_commands",
    ]) {
      const sentence = publishReviewSentence(code);
      expect(sentence).not.toContain(code);
      expect(sentence).not.toContain("_");
    }
  });

  it("explains the Facebook page-address blocker whatever its exact code", () => {
    for (const code of ["meta_website_requires_page_address", "meta_event_source_url_required", "destination_source_url_missing"]) {
      const sentence = publishReviewSentence(code);
      expect(sentence).toContain("Facebook needs the page address for Website conversions");
      expect(sentence).toContain("Open the Facebook connection this Flow sends to (Connections → that connection → Sending to the ad platform)");
      expect(sentence).toContain("set Where the conversion happened to Other");
    }
  });

  it("keeps unknown codes and asks to contact support", () => {
    expect(publishReviewSentence("brand_new_code")).toBe(
      "Something blocks publishing (code: brand_new_code). Contact support with this code.",
    );
    expect(publishReviewSentence("brand_new_warning", "warning")).toBe(
      "Something needs a look (code: brand_new_warning). Contact support with this code.",
    );
  });

  it("shows sentences, not raw codes, on the publish step", () => {
    expect(flows).toContain("publishReviewSentence(String(code))");
    expect(flows).toContain('publishReviewSentence(String(code), "warning")');
    expect(flows).not.toContain('review.blockers.map(String).join(", ")');
  });
});

describe("Flow draft description round trip", () => {
  it("always sends text for the description", () => {
    expect(draftBodyForSave({ name: "A", description: null }).description).toBe("");
    expect(draftBodyForSave({ name: "A" }).description).toBe("");
    expect(draftBodyForSave({ name: "A", description: "notes" }).description).toBe("notes");
    expect(draftBodyForSave({ name: "A", description: null }).name).toBe("A");
  });

  it("uses the save body on create, autosave and new draft version", () => {
    expect(flows).toContain("body: id === null ? draftBodyForSave(current) : { row_version: rowVersion, ...draftBodyForSave(current) }");
    expect(flows).toContain('{ method: "POST", body: draftBodyForSave(current) }');
    expect(flows).not.toMatch(/body: current\b/u);
  });

  // Skipped without a Conversions Core checkout (separate repository). Cost of the skip:
  // the read-then-save body is not checked against Core's real request schema.
  it.skipIf(!HAS_CONVERSIONS_CORE)("a draft read with no description saves back through Core's request check", () => {
    const read = {
      ...defaultFlowDraft({ timeZone: "UTC", reportingCurrency: "USD" }, "0198f0aa-0000-7000-8000-000000000001"),
      name: "Round trip",
      description: null,
    };
    const result = JSON.parse(execFileSync(process.execPath, ["--no-warnings", "--input-type=module", "--eval", `
      const input = JSON.parse(process.argv.at(-1));
      const { parseRouteBody } = await import(input.module);
      async function accepted(id, body) {
        try {
          await parseRouteBody(new Request("https://core.invalid/x", {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
          }), { body: "json", body_contract: { id, version: 1 } });
          return true;
        } catch { return false; }
      }
      process.stdout.write(JSON.stringify({
        rawUpdate: await accepted("flows-draft-update-request", { row_version: 1, ...input.raw }),
        savedUpdate: await accepted("flows-draft-update-request", { row_version: 1, ...input.saved }),
        savedCreate: await accepted("flows-create-request", input.saved),
        savedNewVersion: await accepted("flows-draft-create-request", input.saved),
      }));
    `, JSON.stringify({
      module: pathToFileURL(resolve(CONVERSIONS_CORE_ROOT ?? "", "apps/core/src/request.mjs")).href,
      raw: read,
      saved: draftBodyForSave(read),
    })], { encoding: "utf8" })) as Record<string, boolean>;
    expect(result).toEqual({ rawUpdate: false, savedUpdate: true, savedCreate: true, savedNewVersion: true });
  });
});

describe("Duplicate connection name", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("tells the user to choose another name", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: { code: "connection_name_taken", message: "name taken" } }),
      { status: 409, headers: { "content-type": "application/json" } },
    )));
    const failure = await requestConversionsApi("dup", "/api/admin/conversions/v1/connections", { method: "POST", body: {} })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConversionsApiError);
    expect((failure as ConversionsApiError).code).toBe("connection_name_taken");
    expect((failure as ConversionsApiError).message).toBe("A connection with this name already exists. Choose another name.");
  });

  it("keeps the general message for other conflicts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: { code: "resource_changed" } }),
      { status: 409, headers: { "content-type": "application/json" } },
    )));
    await expect(requestConversionsApi("other", "/api/admin/conversions/v1/connections", { method: "POST", body: {} }))
      .rejects.toThrow("This item changed. Refresh it before trying again.");
  });
});

describe("Token in the link hides the signature fields", () => {
  const fields = CONNECTION_CONFIG_SECTIONS.inbound_webhook.flatMap((section) => section.fields);
  const shown = (config: Item) => fields.filter((field) => isConfigFieldShown("inbound_webhook", field, config)).map((field) => field.path);
  const base = defaultConnectionConfig("inbound_webhook", "UTC");

  it("hides the timestamp and signature fields for Token in the link", () => {
    const link = normalizeConnectionConfigField(base, "auth.mode", "query_token");
    expect(shown(link)).not.toContain("auth.timestamp_header");
    expect(shown(link)).not.toContain("auth.signature_header");
    expect(shown(link)).toContain("auth.authorization_header");
  });

  it("still shows them for the signed setup", () => {
    const signed = normalizeConnectionConfigField(base, "auth.mode", "hmac");
    expect(shown(signed)).toContain("auth.timestamp_header");
    expect(shown(signed)).toContain("auth.signature_header");
  });

  it("is what the editor uses to pick fields", () => {
    expect(connections).toContain(".filter((field) => isConfigFieldShown(props.adapter, field, props.config))");
  });
});
