import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ERROR_REASON_MESSAGES, requestConversionsApi } from "../src/admin/conversions/app/api-client";
import {
  ACTION_SOURCE_CHANGED_NOTE,
  applyFieldTime,
  applyReceivedTime,
  applyRecommendedTime,
  applyTimeZone,
  applyVisitorConsent,
  applyVisitorLookup,
  consentEntry,
  defaultDestination,
  defaultFlowDraft,
  defaultTime,
  fixMetaActionSource,
  needsRecommendedTime,
  POSTBACK_MINIMUM_LINE,
  publishReviewSentence,
  sampleRecordInvalidSentence,
  TIME_FIELD_LABEL,
  TIME_FIELD_NOTE,
  TIME_HEADING,
  TIME_RECEIVED_LABEL,
  TIME_RECOMMENDED_BUTTON,
  TIME_ZONE_HELP,
  timeFieldOptions,
  timeSourceField,
  timeZoneOptions,
  usesReceivedTime,
} from "../src/admin/conversions/app/flow-draft-helpers";
import { coreUrl, HAS_CONVERSIONS_CORE } from "./helpers/conversions-core-root";

type Item = Record<string, unknown>;

const SOURCE = "0198f0aa-0000-7000-8000-000000000001";
const flows = readFileSync(new URL("../src/admin/conversions/app/flows.tsx", import.meta.url), "utf8");
const connections = readFileSync(new URL("../src/admin/conversions/app/connections.tsx", import.meta.url), "utf8");

function newDraft(timeZone = "Asia/Jerusalem"): Item {
  return { ...defaultFlowDraft({ timeZone, reportingCurrency: "USD" }, SOURCE), name: "Partner flow" };
}

function mappingFields(draft: Item): Item[] {
  return (draft.mapping as { fields: Item[] }).fields;
}

/** A draft saved before the forgiving time setting existed. */
function strictDraft(timezone = "UTC"): Item {
  const base = newDraft();
  return {
    ...base,
    mapping: { fields: [...mappingFields(base), {
      canonical_field: "occurred_at", source_field: "conv_time", fixed_value: null, required: true,
      transforms: [{ op: "timestamp", format: "iso_8601", timezone }],
    }] },
    time: { occurred_at_field: "occurred_at", input_format: "iso_8601", timezone, invalid_policy: "invalid" },
  };
}

describe("New Flow draft time", () => {
  it("uses the received time, forgiving reading and UTC, whatever the browser or workspace zone", () => {
    const expected = { occurred_at_field: null, input_format: "auto", timezone: "UTC", invalid_policy: "received_at" };
    expect(defaultTime()).toEqual(expected);
    for (const zone of ["Asia/Jerusalem", "America/New_York", "UTC"]) {
      expect(newDraft(zone).time).toEqual(expected);
    }
  });

  it("has no explicit occurred_at mapping entry", () => {
    expect(mappingFields(newDraft()).map((field) => field.canonical_field)).toEqual(["source_record_id"]);
  });
});

describe("Time choice helpers", () => {
  it("switches between the received time and a partner field without an occurred_at mapping entry", () => {
    const fromField = applyFieldTime(newDraft(), "conv_time");
    expect(fromField.time).toEqual({ occurred_at_field: "conv_time", input_format: "auto", timezone: "UTC", invalid_policy: "received_at" });
    expect(usesReceivedTime(fromField)).toBe(false);
    expect(timeSourceField(fromField)).toBe("conv_time");
    expect(needsRecommendedTime(fromField)).toBe(false);
    const back = applyReceivedTime(fromField);
    expect(back.time).toEqual(defaultTime());
    expect(usesReceivedTime(back)).toBe(true);
    expect(timeSourceField(back)).toBeNull();
  });

  it("keeps a strict draft's saved values until the recommended setting is chosen", () => {
    const strict = strictDraft("Europe/London");
    expect(needsRecommendedTime(strict)).toBe(true);
    // The explicit mapping entry is what the strict setting reads.
    expect(timeSourceField(strict)).toBe("conv_time");
    const renamed = applyFieldTime(strict, "event_time");
    expect(renamed.time).toEqual({ ...(strict.time as Item), occurred_at_field: "event_time" });
    expect(mappingFields(renamed).find((field) => field.canonical_field === "occurred_at")?.source_field).toBe("event_time");
    const recommended = applyRecommendedTime(strict, ["UTC", "Europe/London"]);
    expect(recommended.time).toEqual({ occurred_at_field: "conv_time", input_format: "auto", timezone: "Europe/London", invalid_policy: "received_at" });
    expect(mappingFields(recommended).some((field) => field.canonical_field === "occurred_at")).toBe(false);
    expect(needsRecommendedTime(recommended)).toBe(false);
    // A zone that is not on the list becomes UTC.
    expect((applyRecommendedTime(strictDraft("Not/AZone"), ["UTC"]).time as Item).timezone).toBe("UTC");
  });

  it("offers UTC first and keeps the saved zone on the list", () => {
    const zones = timeZoneOptions("Odd/Zone");
    expect(zones[0]).toBe("UTC");
    expect(zones).toContain("Europe/London");
    expect(zones).toContain("Odd/Zone");
    expect(new Set(zones).size).toBe(zones.length);
    expect((applyTimeZone(newDraft(), "Europe/London").time as Item).timezone).toBe("Europe/London");
  });

  it("offers the saved field, occurred_at and the mapped columns", () => {
    expect(timeFieldOptions(newDraft())).toEqual(["occurred_at", "id"]);
    expect(timeFieldOptions(applyFieldTime(newDraft(), "conv_time"))).toEqual(["conv_time", "occurred_at", "id"]);
  });
});

describe("Time step texts", () => {
  it("are the agreed plain-English texts", () => {
    expect(TIME_HEADING).toBe("When did the conversion happen?");
    expect(TIME_RECEIVED_LABEL).toBe("When we received it (recommended)");
    expect(TIME_FIELD_LABEL).toBe("From a field the partner sends");
    expect(TIME_FIELD_NOTE).toBe("We understand most date formats (for example 2026-11-03T14:05:00Z, 2026-11-03 14:05:00, or a Unix timestamp). If the time is missing or unreadable, we use the time we received it.");
    expect(TIME_ZONE_HELP).toBe("Used only when the partner's time has no time zone.");
    expect(TIME_RECOMMENDED_BUTTON).toBe("Use the recommended setting");
  });

  it("are what the Map fields step renders, with no free-text time inputs left", () => {
    expect(flows).toContain("<TimeEditor draft={draft} setDraft={setDraft} />");
    for (const name of ["TIME_HEADING", "TIME_RECEIVED_LABEL", "TIME_FIELD_LABEL", "TIME_FIELD_NOTE", "TIME_ZONE_HELP", "TIME_RECOMMENDED_BUTTON"]) {
      expect(flows).toContain(`{${name}}`);
    }
    expect(flows).toMatch(/type="radio" name="flow-time-source"/u);
    expect(flows).toContain("{strict && <div");
    expect(flows).not.toContain("Occurred-at canonical field");
    expect(flows).not.toContain("Input time format");
    expect(flows).not.toContain("IANA source time zone");
  });
});

describe("Facebook destinations saved as Website", () => {
  const isMeta = (id: unknown) => id === "meta-1";
  const withDestinations = (...destinations: Item[]): Item => ({ ...newDraft(), destinations });
  const website = (connectionId: string): Item => {
    const destination = defaultDestination(connectionId, connectionId === "meta-1");
    return { ...destination, mapping: { ...(destination.mapping as Item), action_source: "website" } };
  };

  it("switches only Facebook destinations from Website to Other", () => {
    const { draft, changed } = fixMetaActionSource(withDestinations(website("meta-1"), website("other-1")), isMeta);
    expect(changed).toBe(true);
    const destinations = draft.destinations as Item[];
    expect((destinations[0]?.mapping as Item).action_source).toBe("other");
    expect((destinations[1]?.mapping as Item).action_source).toBe("website");
  });

  it("leaves a draft with nothing to switch untouched", () => {
    const draft = withDestinations(defaultDestination("meta-1", true));
    const result = fixMetaActionSource(draft, isMeta);
    expect(result.changed).toBe(false);
    expect(result.draft).toBe(draft);
  });

  it("shows the agreed note and runs on load and on every save", () => {
    expect(ACTION_SOURCE_CHANGED_NOTE).toBe("Changed 'Where the conversion happened' to Other, which Facebook accepts.");
    expect(flows).toContain("{actionSourceNote && <p class=\"ko-disabled-reason\" role=\"status\">{ACTION_SOURCE_CHANGED_NOTE}</p>}");
    expect(flows).toContain("const fixed = fixMetaActionSource(loaded, isMetaIn(nextConnections));");
    expect(flows.match(/const current = currentForSave\(\);/gu)).toHaveLength(2);
  });
});

describe("Plain-English messages for the new checks", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("explains a test postback the Flow would refuse", () => {
    expect(sampleRecordInvalidSentence({ sample_index: 1, reason: "identity_missing", field: "id" })).toBe(
      "The test postback is missing something the Flow needs: the record id (field 'id'). Fix the partner link or the mapping, then send the test link again.",
    );
    expect(sampleRecordInvalidSentence({ sample_index: 2, reason: "time_missing", field: "conv_time" })).toBe(
      "The test postback is missing something the Flow needs: the conversion time (field 'conv_time'). Fix the partner link or the mapping, then send the test link again.",
    );
    expect(sampleRecordInvalidSentence({ sample_index: 1, reason: "time_invalid", field: "conv_time" })).toBe(
      "The test postback is missing something the Flow needs: a readable conversion time (field 'conv_time'). Fix the partner link or the mapping, then send the test link again.",
    );
    expect(sampleRecordInvalidSentence({ sample_index: null, reason: "flow_config_invalid", field: null })).toBe(
      "The test postback is missing something the Flow needs. Fix the partner link or the mapping, then send the test link again.",
    );
    expect(sampleRecordInvalidSentence(undefined)).not.toContain("code:");
    expect(publishReviewSentence("sample_record_invalid", "blocker", {
      sample_record_issue: { sample_index: 1, reason: "identity_missing", field: "id" },
    })).toBe(sampleRecordInvalidSentence({ reason: "identity_missing", field: "id" }));
    expect(flows).toContain('publishReviewSentence(String(code), "blocker", review)');
  });

  it("turns the draft-save reasons into plain English", async () => {
    expect(ERROR_REASON_MESSAGES).toEqual({
      visitor_lookup_consent_required: "Tick the consent box in 'Find our visitor' to send visitor details to Facebook.",
      time_timezone_invalid: "Choose a time zone from the list.",
    });
    for (const [reason, text] of Object.entries(ERROR_REASON_MESSAGES)) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
        error: { code: "validation_failed", message: "Request validation failed.", reason },
      }), { status: 422, headers: { "content-type": "application/json" } })));
      await expect(requestConversionsApi("flow.create:x", "/api/admin/conversions/v1/flows", { method: "POST", body: {} }))
        .rejects.toMatchObject({ status: 422, code: "validation_failed", message: text });
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: { code: "validation_failed", message: "Request validation failed." },
    }), { status: 422, headers: { "content-type": "application/json" } })));
    await expect(requestConversionsApi("flow.create:y", "/api/admin/conversions/v1/flows", { method: "POST", body: {} }))
      .rejects.toMatchObject({ message: "Request validation failed." });
  });

  it("tells partners what to send at minimum on the partner link", () => {
    expect(POSTBACK_MINIMUM_LINE).toBe(
      "At minimum, the partner must send the record id field (set in the Flow's Map fields step, usually id). The time field is needed only if the Flow takes the conversion time 'From a field the partner sends'.",
    );
    expect(POSTBACK_MINIMUM_LINE).toContain(TIME_FIELD_LABEL);
    expect(connections).toContain("<p>{POSTBACK_MINIMUM_LINE}</p>");
  });
});


function engineDrafts(): Record<string, Item> {
  const visitor = applyVisitorLookup(applyVisitorConsent(newDraft(), true), {
    key_source_field: "id", key_kind: "click_id", event_types: ["offer_click"],
    fill: ["fbc", "client_ip_address", "client_user_agent"],
  });
  return {
    fresh: newDraft(),
    fromField: applyFieldTime(newDraft(), "conv_time"),
    recommended: applyRecommendedTime(strictDraft("UTC")),
    badZone: applyTimeZone(newDraft(), "Mars/Base"),
    visitor,
    visitorNoConsent: { ...visitor, mapping: { fields: mappingFields(visitor).filter((field) => field.canonical_field !== "personal_data_consent") } },
  };
}

function runInCore(node: string, script: string, input: unknown): any { // eslint-disable-line @typescript-eslint/no-explicit-any
  return JSON.parse(execFileSync(node, ["--no-warnings", "--input-type=module", "--eval", script, JSON.stringify(input)], { encoding: "utf8" }));
}

// Skipped without a Conversions Core checkout (separate repository). Cost of the skip:
// the drafts this screen builds are not run through Core's real request schema,
// time check and per-record check.
describe.skipIf(!HAS_CONVERSIONS_CORE)("Drafts built by this screen, through Core's request schema and checks", () => {
  const result = HAS_CONVERSIONS_CORE ? runInCore(process.execPath, `
    const input = JSON.parse(process.argv.at(-1));
    const { parseRouteBody } = await import(input.request);
    const { canonicalTimestamp } = await import(input.canonical);
    const { flowRecordChecker } = await import(input.check);
    async function accepted(id, body) {
      try {
        await parseRouteBody(new Request("https://core.invalid/x", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        }), { body: "json", body_contract: { id, version: 1 } });
        return true;
      } catch { return false; }
    }
    // The same call Core's draft check makes for input_format 'auto'.
    function zoneAccepted(timezone) {
      try { canonicalTimestamp('2026-01-01 00:00:00', { format: 'auto', timezone }); return true; } catch { return false; }
    }
    const out = { schema: {}, zone: {}, records: {} };
    for (const [name, draft] of Object.entries(input.drafts)) {
      out.schema[name] = {
        create: await accepted("flows-create-request", draft),
        update: await accepted("flows-draft-update-request", { row_version: 1, ...draft }),
        newVersion: await accepted("flows-draft-create-request", draft),
      };
      out.zone[name] = zoneAccepted(draft.time.timezone);
    }
    out.schema.unknownPolicy = { create: await accepted("flows-create-request", { ...input.drafts.fresh, time: { ...input.drafts.fresh.time, invalid_policy: "received" } }) };
    out.schema.extraTimeKey = { create: await accepted("flows-create-request", { ...input.drafts.fresh, time: { ...input.drafts.fresh.time, format: "auto" } }) };
    const received = '2026-11-03T10:00:00.000Z';
    for (const name of ['fresh', 'fromField']) {
      // A stored draft also carries its ids, as Core reads it back.
      const stored = { ...input.drafts[name], flow_id: input.flowId, flow_version_id: input.versionId };
      const check = flowRecordChecker(stored, input.workspace, received);
      out.records[name] = {
        idOnly: check({ id: 'r1' }),
        noId: check({ conv_time: '2026-11-03T14:05:00Z' }),
        iso: check({ id: 'r1', conv_time: '2026-11-03T14:05:00Z' }),
        offset: check({ id: 'r1', conv_time: '2026-11-03T14:05:00.123456+0200' }),
        spaced: check({ id: 'r1', conv_time: '2026-11-03 14:05:00' }),
        epoch: check({ id: 'r1', conv_time: '1793714700' }),
        unreadable: check({ id: 'r1', conv_time: 'yesterday' }),
      };
    }
    process.stdout.write(JSON.stringify(out));
  `, {
    request: coreUrl("apps/core/src/request.mjs").href,
    canonical: coreUrl("packages/event-core/canonical.mjs").href,
    check: coreUrl("apps/core/src/flow-record-check.mjs").href,
    workspace: "0198f0aa-0000-7000-8000-0000000000aa",
    flowId: "0198f0aa-0000-7000-8000-0000000000bb",
    versionId: "0198f0aa-0000-7000-8000-0000000000cc",
    drafts: engineDrafts(),
  }) : null;

  it("accepts the default new-draft time object exactly as sent, on create, save and new version", () => {
    expect(defaultTime()).toEqual({ occurred_at_field: null, input_format: "auto", timezone: "UTC", invalid_policy: "received_at" });
    expect(result.schema.fresh).toEqual({ create: true, update: true, newVersion: true });
    expect(result.zone.fresh).toBe(true);
    // The schema is strict, so the exact object matters.
    expect(result.schema.unknownPolicy).toEqual({ create: false });
    expect(result.schema.extraTimeKey).toEqual({ create: false });
  });

  it("accepts a partner time field, the recommended setting and the visitor consent entry", () => {
    for (const name of ["fromField", "recommended", "visitor"]) {
      expect(result.schema[name], name).toEqual({ create: true, update: true, newVersion: true });
      expect(result.zone[name], name).toBe(true);
    }
  });

  it("refuses a time zone that is not a real one", () => {
    expect(result.zone.badZone).toBe(false);
  });

  it("needs only the record id from the partner, as the partner link says, and reads the listed formats", () => {
    for (const name of ["fresh", "fromField"]) {
      const records = result.records[name];
      for (const key of ["idOnly", "iso", "offset", "spaced", "epoch", "unreadable"]) expect(records[key], `${name}.${key}`).toBeNull();
      expect(records.noId).toMatchObject({ reason: "identity_missing" });
    }
  });
});

/**
 * Node that can run Core's in-memory database (it needs node:sqlite with setAuthorizer):
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

// Skipped without a Core checkout, or when no Node with node:sqlite setAuthorizer is available
// (set CONVERSIONS_CORE_NODE). Cost of the skip: the full draft check (consent and time zone
// reasons, stored time block) is covered only by the schema and check tests above.
describe.skipIf(CORE_NODE === null)("Drafts built by this screen, through Core's full draft routes", () => {
  const engine = CORE_NODE === null ? null : runInCore(CORE_NODE, `
    const input = JSON.parse(process.argv.at(-1));
    const { fetch } = await import(input.index);
    const fx = await import(input.fixtures);
    const { migratedD1 } = await import(input.d1);
    const env = fx.coreEnv(migratedD1());
    let n = 0;
    const call = async (path, method, body) => {
      const headers = fx.adminHeaders(fx.actorEnvelope(), { idempotency: method === 'GET' ? undefined : 'cms-time-' + (n += 1) });
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
    const sourceId = source.body.result.connection_id;
    const out = { source: source.status, create: {}, readTime: {}, update: {} };
    for (const [name, draft] of Object.entries(input.drafts)) {
      const body = { ...draft, name: 'Flow ' + name, primary_connection_id: sourceId, identity_namespace: 'flow-' + name.toLowerCase() };
      const created = await call('/flows', 'POST', body);
      out.create[name] = created;
      if (created.status !== 201) continue;
      const id = created.body.result.flow_id;
      const read = await call('/flows/' + id + '/drafts/1', 'GET');
      out.readTime[name] = read.body.result.time;
      const updated = await call('/flows/' + id + '/drafts/1', 'PATCH', { row_version: read.body.result.row_version, ...body, name: body.name + ' again' });
      out.update[name] = updated.status;
    }
    process.stdout.write(JSON.stringify(out));
  `, {
    index: coreUrl("apps/core/src/index.mjs").href,
    fixtures: coreUrl("packages/testing/lib/core-fixtures.mjs").href,
    d1: coreUrl("packages/testing/lib/d1-sqlite.mjs").href,
    drafts: engineDrafts(),
  });

  it("stores the new-draft time object exactly as sent, on create and on save", () => {
    expect(engine.source).toBe(201);
    expect(engine.create.fresh.status).toBe(201);
    expect(engine.readTime.fresh).toEqual(defaultTime());
    expect(engine.update.fresh).toBe(200);
  });

  it("stores a partner time field and the one-click recommended setting", () => {
    expect(engine.create.fromField.status).toBe(201);
    expect(engine.readTime.fromField).toEqual(applyFieldTime(newDraft(), "conv_time").time);
    expect(engine.update.fromField).toBe(200);
    expect(engine.create.recommended.status).toBe(201);
    expect(engine.readTime.recommended).toEqual({ occurred_at_field: "conv_time", input_format: "auto", timezone: "UTC", invalid_policy: "received_at" });
  });

  it("accepts the consent entry the consent box adds, and refuses the lookup without it", () => {
    expect(consentEntry()).toEqual({ canonical_field: "personal_data_consent", source_field: null, fixed_value: "true", required: false, transforms: [] });
    expect(engine.create.visitor.status).toBe(201);
    expect(engine.create.visitorNoConsent).toEqual({
      status: 422,
      body: { error: { code: "validation_failed", message: "Request validation failed.", reason: "visitor_lookup_consent_required" } },
    });
  });

  it("refuses a time zone that is not a real one with the reason the screen explains", () => {
    expect(engine.create.badZone).toEqual({
      status: 422,
      body: { error: { code: "validation_failed", message: "Request validation failed.", reason: "time_timezone_invalid" } },
    });
  });
});
