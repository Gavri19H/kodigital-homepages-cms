import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ERROR_REASON_MESSAGES, requestConversionsApi } from "../src/admin/conversions/app/api-client";
import {
  applyDestinationValue,
  applyDestinationValueChoice,
  applyRuleValueField,
  defaultDestination,
  defaultFlowDraft,
  destinationValueLabel,
  destinationValueOptions,
  destinationValueSelected,
  isAmountField,
  needsPurchaseValue,
  NO_VALUE_LABEL,
  PICK_AGAIN_LABEL,
  PICK_AGAIN_VALUE,
  publishReviewSentence,
  PURCHASE_VALUE_HELP,
  readAsAmount,
  ruleValueOptions,
  ruleValueSelected,
  sampleRecordInvalidSentence,
  VALUE_AMOUNT_NOTE,
} from "../src/admin/conversions/app/flow-draft-helpers";
import { coreUrl, HAS_CONVERSIONS_CORE } from "./helpers/conversions-core-root";

type Item = Record<string, unknown>;

const SOURCE = "0198f0aa-0000-7000-8000-000000000001";
const META = "0198f0aa-0000-7000-8000-0000000000dd";
const flows = readFileSync(new URL("../src/admin/conversions/app/flows.tsx", import.meta.url), "utf8");

function entry(canonical: string, source: string, transforms: Item[] = [{ op: "trim" }]): Item {
  return { canonical_field: canonical, source_field: source, fixed_value: null, required: false, transforms };
}

/** A new draft, as this screen builds it, with a payout column the user mapped by hand (not read as an amount yet). */
function newDraft(extra: Item[] = []): Item {
  const base: Item = { ...defaultFlowDraft({ timeZone: "UTC", reportingCurrency: "USD" }, SOURCE), name: "Value flow" };
  const fields = (base.mapping as { fields: Item[] }).fields;
  return { ...base, mapping: { fields: [...fields, entry("payout_amount", "payout"), ...extra] } };
}

function withDestination(draft: Item, connectionId = META): Item {
  return { ...draft, destinations: [{ ...defaultDestination(connectionId, true), enabled: true }] };
}

function fieldOf(draft: Item, name: string): Item | undefined {
  return (draft.mapping as { fields: Item[] }).fields.find((field) => field.canonical_field === name);
}

function destinationMapping(draft: Item): Item {
  return ((draft.destinations as Item[])[0] as Item).mapping as Item;
}

/** First rule qualifies with the actual payout read from the given field. */
function qualifyingRule(draft: Item, field: string): Item {
  const rules = draft.rules as { ordered: Item[]; default_outcome: Item };
  const qualified = {
    ...draft,
    rules: { ...rules, ordered: [{ ...rules.ordered[0], outcome: { status: "qualified", effective_value_rule: "actual_payout", value: { kind: "field", field: "payout_amount" } } }] },
  };
  return applyRuleValueField(qualified, 0, field);
}

describe("Value to send: choices", () => {
  it("lists the partner's report value, then amount fields, then other mapped fields to read as an amount", () => {
    const draft = newDraft([
      entry("bid_amount", "bid", [{ op: "trim" }, { op: "decimal" }]),
      entry("click_id", "clickid"),
      entry("note", "note", []),
    ]);
    expect(destinationValueOptions(draft)).toEqual(["effective_value", "bid_amount", "payout_amount", "note"]);
    expect(destinationValueLabel(draft, "effective_value")).toBe("Value from the partner's report (effective value)");
    expect(destinationValueLabel(draft, "bid_amount")).toBe("Field: bid_amount");
    expect(destinationValueLabel(draft, "payout_amount")).toBe("Field: payout_amount (we'll read it as an amount)");
    expect(isAmountField(draft, "bid_amount")).toBe(true);
    expect(isAmountField(draft, "payout_amount")).toBe(false);
  });

  it("reads a picked field as an amount, once, keeping its other steps", () => {
    const draft = withDestination(newDraft());
    const picked = applyDestinationValueChoice(draft, 0, "payout_amount");
    expect(destinationMapping(picked)).toMatchObject({ value_field: "payout_amount", currency_field: "currency" });
    expect(fieldOf(picked, "payout_amount")?.transforms).toEqual([{ op: "trim" }, { op: "decimal" }]);
    const again = applyDestinationValueChoice(picked, 0, "payout_amount");
    expect(fieldOf(again, "payout_amount")?.transforms).toEqual([{ op: "trim" }, { op: "decimal" }]);
    expect(destinationValueLabel(picked, "payout_amount")).toBe("Field: payout_amount");
    expect(destinationValueSelected(picked, destinationMapping(picked))).toBe("payout_amount");
  });

  it("leaves the mapping alone for the report value and for no value", () => {
    const draft = withDestination(newDraft());
    const effective = applyDestinationValueChoice(draft, 0, "effective_value");
    expect(effective.mapping).toEqual(draft.mapping);
    expect(destinationMapping(effective)).toMatchObject({ value_field: "effective_value", currency_field: "currency" });
    const none = applyDestinationValueChoice(draft, 0, "");
    expect(none.mapping).toEqual(draft.mapping);
    expect(destinationMapping(none)).toMatchObject({ value_field: null, currency_field: null });
    expect(destinationValueSelected(none, destinationMapping(none))).toBe("");
    expect(applyDestinationValueChoice(draft, 0, PICK_AGAIN_VALUE)).toBe(draft);
    expect(readAsAmount(draft, "not_mapped")).toBe(draft);
  });

  it("asks to pick again a saved field that is not read as an amount", () => {
    const draft = withDestination(newDraft());
    const raw = { ...draft, destinations: [{ ...(draft.destinations as Item[])[0], mapping: applyDestinationValue(destinationMapping(draft), "payout_amount") }] };
    expect(destinationValueSelected(raw, destinationMapping(raw))).toBe(PICK_AGAIN_VALUE);
    expect(PICK_AGAIN_LABEL).toBe("Pick the value again");
  });

  it("does not offer no value for a Facebook Purchase", () => {
    expect(needsPurchaseValue({ event_name: "Purchase" }, true)).toBe(true);
    expect(needsPurchaseValue({ event_name: "Lead" }, true)).toBe(false);
    expect(needsPurchaseValue({ event_name: "Purchase" }, false)).toBe(false);
    expect(PURCHASE_VALUE_HELP).toBe("Facebook needs an amount for Purchase.");
    expect(NO_VALUE_LABEL).toBe("Do not send a value");
  });
});

describe("Actual payout field", () => {
  it("offers mapped fields and the saved one, and reads the picked field as an amount", () => {
    const draft = newDraft([entry("bid_amount", "bid", [{ op: "decimal" }])]);
    expect(ruleValueOptions(draft, "payout_amount")).toEqual(["bid_amount", "payout_amount"]);
    expect(ruleValueOptions(draft, "patched_payout")).toEqual(["patched_payout", "bid_amount", "payout_amount"]);
    expect(ruleValueSelected(draft, "payout_amount")).toBe(PICK_AGAIN_VALUE);
    expect(ruleValueSelected(draft, "patched_payout")).toBe("patched_payout");
    const picked = qualifyingRule(draft, "payout_amount");
    const outcome = ((picked.rules as { ordered: Item[] }).ordered[0] as Item).outcome as Item;
    expect(outcome).toEqual({ status: "qualified", effective_value_rule: "actual_payout", value: { kind: "field", field: "payout_amount" } });
    expect(fieldOf(picked, "payout_amount")?.transforms).toEqual([{ op: "trim" }, { op: "decimal" }]);
    expect(ruleValueSelected(picked, "payout_amount")).toBe("payout_amount");
  });
});

describe("Plain messages for amounts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("explains the save refusal for a value field that is not an amount", async () => {
    expect(ERROR_REASON_MESSAGES.value_field_not_numeric).toBe("The value field must be an amount. Pick it again so we read it as an amount.");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: { code: "validation_failed", message: "Request validation failed.", reason: "value_field_not_numeric" },
    }), { status: 422, headers: { "content-type": "application/json" } })));
    await expect(requestConversionsApi("flow.save:value", "/api/admin/conversions/v1/flows", { method: "POST", body: {} }))
      .rejects.toMatchObject({ status: 422, message: "The value field must be an amount. Pick it again so we read it as an amount." });
  });

  it("names the missing or unreadable amount in the publish blocker", () => {
    expect(sampleRecordInvalidSentence({ reason: "value_missing", field: "payout" })).toBe(
      "The test postback is missing something the Flow needs: the amount (value) (field 'payout'). Fix the partner link or the mapping, then send the test link again.",
    );
    expect(publishReviewSentence("sample_record_invalid", "blocker", { sample_record_issue: { reason: "value_invalid", field: "payout" } })).toBe(
      "The test postback is missing something the Flow needs: a readable amount in the Flow's currency (field 'payout'). Fix the partner link or the mapping, then send the test link again.",
    );
  });

  it("shows the amount note, the Purchase help and the disabled no-value choice on the screen", () => {
    expect(VALUE_AMOUNT_NOTE).toBe("We read amounts like 12.50, 12,50 and $12.50. An amount in another currency than the Flow's is not sent.");
    expect(flows).toContain('<option value="" disabled={purchase}>{NO_VALUE_LABEL}</option>');
    expect(flows).toContain('{purchase && <small class="ko-disabled-reason">{PURCHASE_VALUE_HELP}</small>}<small>{VALUE_AMOUNT_NOTE}</small>');
    expect(flows).toContain("const purchase = needsPurchaseValue(destinationMapping, isMeta);");
    expect(flows).toContain("onChange={(event) => setDraft(applyDestinationValueChoice(draft, index, event.currentTarget.value))}");
    expect(flows).toContain("onChange={(event) => props.setDraft(applyRuleValueField(props.draft, index, event.currentTarget.value))}");
    expect(flows).toContain("{valueOptions.map((field) => <option value={field}>{destinationValueLabel(draft, field)}</option>)}");
  });
});

/**
 * Node that can run Core's in-memory database (node:sqlite with setAuthorizer):
 * CONVERSIONS_CORE_NODE when set, else this Node when it can.
 */
function coreNode(): string | null {
  const override = process.env.CONVERSIONS_CORE_NODE;
  if (override !== undefined && override !== "") return override;
  try {
    return execFileSync(process.execPath, ["--no-warnings", "-e",
      "process.stdout.write(typeof require('node:sqlite').DatabaseSync.prototype.setAuthorizer)"], { encoding: "utf8" }) === "function"
      ? process.execPath
      : null;
  } catch {
    return null;
  }
}
const CORE_NODE = HAS_CONVERSIONS_CORE ? coreNode() : null;

/** Drafts to run through Core; META is replaced there by the real Facebook connection id. */
function engineDrafts(): Record<string, Item> {
  const picked = applyDestinationValueChoice(withDestination(newDraft()), 0, "payout_amount");
  const raw = withDestination(newDraft());
  const rules = picked.rules as { ordered: Item[]; default_outcome: Item };
  return {
    reportValue: withDestination(newDraft()),
    // The value sent is the picked field; the rule qualifies every record with a fixed amount.
    picked: { ...picked, rules: { ...rules, ordered: [{ ...rules.ordered[0], outcome: { status: "qualified", effective_value_rule: "fixed_amount", value: { kind: "fixed", amount: "1.0000" } } }] } },
    // The value sent is the partner's report value, which the rule reads from the picked field.
    pickedForRule: qualifyingRule(withDestination(newDraft()), "payout_amount"),
    notAmount: { ...raw, destinations: [{ ...(raw.destinations as Item[])[0], mapping: applyDestinationValue(destinationMapping(raw), "payout_amount") }] },
  };
}

// Skipped without a Core checkout, or without a Node that has node:sqlite setAuthorizer
// (set CONVERSIONS_CORE_NODE). Cost of the skip: the value choices this screen builds are
// not run through Core's real draft save and per-record check.
describe.skipIf(CORE_NODE === null)("Value choices built by this screen, through Core's draft save and record check", () => {
  const engine = CORE_NODE === null ? null : JSON.parse(execFileSync(CORE_NODE, ["--no-warnings", "--input-type=module", "--eval", `
    const input = JSON.parse(process.argv.at(-1));
    const { fetch } = await import(input.index);
    const fx = await import(input.fixtures);
    const { migratedD1 } = await import(input.d1);
    const { flowRecordChecker } = await import(input.check);
    const env = fx.coreEnv(migratedD1());
    let n = 0;
    const call = async (path, method, body) => {
      const headers = fx.adminHeaders(fx.actorEnvelope(), { idempotency: method === 'GET' ? undefined : 'cms-value-' + (n += 1) });
      if (body !== undefined) headers.set('content-type', 'application/json');
      const response = await fetch(new Request('https://core.invalid/api/admin/conversions/v1' + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      }), env);
      return { status: response.status, body: await response.json() };
    };
    const source = await call('/connections', 'POST', {
      name: 'Partner link', direction: 'source', adapter_type: 'generic_api', config_schema_version: 1,
      config: fx.genericApiAdminConfig(), account_id: fx.CORE_ACCOUNT, currency: 'USD',
    });
    const meta = await call('/connections', 'POST', {
      name: 'Facebook', direction: 'destination', adapter_type: 'meta', config_schema_version: 1,
      config: { adapter_type: 'meta', dataset_id: 'dataset-test', api_version: 'v99.0-test', test_event_code: null },
      account_id: fx.CORE_ACCOUNT, currency: 'USD',
    });
    const sourceId = source.body.result.connection_id;
    const metaId = meta.body.result.connection_id;
    const out = { source: source.status, meta: meta.status, create: {}, update: {}, records: {} };
    for (const [name, draft] of Object.entries(input.drafts)) {
      const body = JSON.parse(JSON.stringify(draft).replaceAll(input.metaPlaceholder, metaId));
      Object.assign(body, { name: 'Flow ' + name, primary_connection_id: sourceId, identity_namespace: 'flow-' + name.toLowerCase() });
      const created = await call('/flows', 'POST', body);
      out.create[name] = created.status === 201 ? { status: 201 } : created;
      if (created.status !== 201) continue;
      const id = created.body.result.flow_id;
      const read = await call('/flows/' + id + '/drafts/1', 'GET');
      const updated = await call('/flows/' + id + '/drafts/1', 'PATCH', { row_version: read.body.result.row_version, ...body, name: body.name + ' again' });
      out.update[name] = updated.status;
      if (name !== 'picked' && name !== 'pickedForRule') continue;
      const stored = { ...read.body.result, flow_id: id, flow_version_id: read.body.result.flow_version_id ?? input.versionId };
      const check = flowRecordChecker(stored, input.workspace, '2026-11-03T10:00:00.000Z', new Map([[metaId, 'meta']]));
      out.records[name] = {};
      for (const [key, payout] of Object.entries(input.payouts)) {
        out.records[name][key] = check(payout === null ? { id: 'r1' } : { id: 'r1', payout });
      }
    }
    process.stdout.write(JSON.stringify(out));
  `, JSON.stringify({
    index: coreUrl("apps/core/src/index.mjs").href,
    fixtures: coreUrl("packages/testing/lib/core-fixtures.mjs").href,
    d1: coreUrl("packages/testing/lib/d1-sqlite.mjs").href,
    check: coreUrl("apps/core/src/flow-record-check.mjs").href,
    workspace: "0198f0aa-0000-7000-8000-0000000000aa",
    versionId: "0198f0aa-0000-7000-8000-0000000000cc",
    metaPlaceholder: META,
    drafts: engineDrafts(),
    payouts: { dot: "12.50", comma: "12,50", dollar: "$12.50", thousands: "1,234.56", missing: null, zero: "0", unreadable: "soon", euro: "€12.50" },
  })], { encoding: "utf8" }));

  it("saves the report value and a field picked as the value or the actual payout", () => {
    expect(engine.source).toBe(201);
    expect(engine.meta).toBe(201);
    for (const name of ["reportValue", "picked", "pickedForRule"]) {
      expect(engine.create[name], name).toEqual({ status: 201 });
      expect(engine.update[name], name).toBe(200);
    }
  });

  it("refuses a value field not read as an amount, with the reason the screen explains", () => {
    expect(engine.create.notAmount).toEqual({
      status: 422,
      body: { error: { code: "validation_failed", message: "Request validation failed.", reason: "value_field_not_numeric" } },
    });
    expect(Object.keys(ERROR_REASON_MESSAGES)).toContain("value_field_not_numeric");
  });

  it("reads the amounts the note lists, and refuses a missing or unreadable one for a Facebook Purchase", () => {
    for (const name of ["picked", "pickedForRule"]) {
      const records = engine.records[name];
      for (const key of ["dot", "comma", "dollar", "thousands"]) expect(records[key], `${name}.${key}`).toBeNull();
      expect(records.missing, name).toMatchObject({ reason: "value_missing", field: "payout" });
      expect(records.zero, name).toMatchObject({ reason: "value_missing" });
      expect(records.unreadable, name).toMatchObject({ reason: "value_invalid", field: "payout" });
      expect(records.euro, name).toMatchObject({ reason: "value_invalid" });
      expect(sampleRecordInvalidSentence(records.missing)).toContain("needs: the amount (value) (field 'payout')");
      expect(sampleRecordInvalidSentence(records.unreadable)).toContain("needs: a readable amount in the Flow's currency (field 'payout')");
    }
  });
});
