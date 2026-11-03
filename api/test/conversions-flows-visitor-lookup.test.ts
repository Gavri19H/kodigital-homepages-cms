import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversionsApiError, requestConversionsApi } from "../src/admin/conversions/app/api-client";
import {
  applyDestinationKind,
  applyDestinationValue,
  applyVisitorConsent,
  applyVisitorLookup,
  defaultDestination,
  destinationValueLabel,
  destinationValueOptions,
  hasVisitorConsent,
  initialVisitorLookup,
  mappingSourceFields,
  parseEventTypes,
  readVisitorLookup,
  visitorLookupBlocker,
  type VisitorLookup,
} from "../src/admin/conversions/app/flow-draft-helpers";
import { unwrapConversionsUiContext } from "../src/admin/conversions/app/product-state";

type Item = Record<string, unknown>;

const CONSENT = {
  canonical_field: "personal_data_consent",
  source_field: null,
  fixed_value: "true",
  required: false,
  transforms: [],
};

function draft(extra: Item[] = []): Item {
  return {
    name: "Flow",
    mapping: {
      fields: [
        { canonical_field: "source_record_id", source_field: "id", fixed_value: null, required: true, transforms: [] },
        { canonical_field: "click_id", source_field: "clickid", fixed_value: null, required: false, transforms: [] },
        { canonical_field: "payout_amount", source_field: "payout", fixed_value: null, required: false, transforms: [] },
        ...extra,
      ],
    },
  };
}

function fields(value: Item): Item[] {
  return (value.mapping as { fields: Item[] }).fields;
}

const SPEC: VisitorLookup = {
  key_source_field: "clickid",
  key_kind: "click_id",
  event_types: ["lead_submitted"],
  fill: ["fbc", "client_ip_address", "client_user_agent"],
};

describe("Find our visitor draft logic", () => {
  it("lists mapping source columns once, without the columns the box adds", () => {
    expect(mappingSourceFields(draft([
      { canonical_field: "other", source_field: "id", fixed_value: null, required: false, transforms: [] },
      { canonical_field: "fbc", source_field: "kd_visitor_fbc", fixed_value: null, required: false, transforms: [] },
      { canonical_field: "fixed", source_field: null, fixed_value: "x", required: false, transforms: [] },
    ]))).toEqual(["id", "clickid", "payout"]);
  });

  it("starts with the first column, click ID, no actions and all three details", () => {
    expect(initialVisitorLookup(draft())).toEqual({
      key_source_field: "id",
      key_kind: "click_id",
      event_types: [],
      fill: ["fbc", "client_ip_address", "client_user_agent"],
    });
  });

  it("blocks turning on until consent, a key column, an action and a detail are chosen", () => {
    expect(visitorLookupBlocker(draft(), SPEC)).toBe("Tick the agreement box first.");
    const consented = applyVisitorConsent(draft(), true);
    expect(visitorLookupBlocker(consented, SPEC)).toBeNull();
    expect(visitorLookupBlocker(consented, { ...SPEC, key_source_field: "missing" })).toMatch(/column/u);
    expect(visitorLookupBlocker(consented, { ...SPEC, event_types: [] })).toMatch(/at least one visitor action/u);
    expect(visitorLookupBlocker(consented, { ...SPEC, event_types: ["Bad Type"] })).toMatch(/not valid/u);
    expect(visitorLookupBlocker(consented, {
      ...SPEC,
      event_types: Array.from({ length: 21 }, (_, index) => `type_${index}`),
    })).toMatch(/at most 20/u);
    expect(visitorLookupBlocker(consented, { ...SPEC, fill: [] })).toMatch(/at least one detail/u);
  });

  it("adds the consent entry when ticked and removes it when unticked", () => {
    const consented = applyVisitorConsent(draft(), true);
    expect(hasVisitorConsent(consented)).toBe(true);
    expect(fields(consented).at(-1)).toEqual(CONSENT);
    expect(fields(applyVisitorConsent(consented, true)).filter(
      (field) => field.canonical_field === "personal_data_consent",
    )).toHaveLength(1);
    expect(fields(applyVisitorConsent(consented, false))).toEqual(fields(draft()));
  });

  it("turning on stores the lookup and adds only the missing detail entries", () => {
    const ownFbc = { canonical_field: "fbc", source_field: "fbclid_cookie", fixed_value: null, required: false, transforms: [] };
    const on = applyVisitorLookup(applyVisitorConsent(draft([ownFbc]), true), SPEC);
    expect(on.visitor_lookup).toEqual(SPEC);
    expect(readVisitorLookup(on)).toEqual(SPEC);
    expect(fields(on).filter((field) => field.canonical_field === "fbc")).toEqual([ownFbc]);
    expect(fields(on)).toContainEqual({
      canonical_field: "client_ip_address",
      source_field: "kd_visitor_client_ip_address",
      fixed_value: null,
      required: false,
      transforms: [],
    });
    expect(fields(on)).toContainEqual({
      canonical_field: "client_user_agent",
      source_field: "kd_visitor_client_user_agent",
      fixed_value: null,
      required: false,
      transforms: [],
    });
    expect(fields(on)).toContainEqual(CONSENT);
    expect(applyVisitorLookup(on, SPEC)).toEqual(on);
  });

  it("keeps the saved detail order fixed and drops entries for details no longer chosen", () => {
    const on = applyVisitorLookup(applyVisitorConsent(draft(), true), {
      ...SPEC,
      fill: ["client_user_agent", "fbc"],
    });
    expect((on.visitor_lookup as Item).fill).toEqual(["fbc", "client_user_agent"]);
    const narrowed = applyVisitorLookup(on, { ...SPEC, fill: ["fbc"] });
    expect(fields(narrowed).map((field) => field.canonical_field)).not.toContain("client_user_agent");
    expect(fields(narrowed).map((field) => field.source_field)).toContain("kd_visitor_fbc");
  });

  it("turning off clears the lookup and removes only the entries the box added", () => {
    const ownIp = { canonical_field: "client_ip_address", source_field: "ip", fixed_value: null, required: false, transforms: [] };
    const on = applyVisitorLookup(applyVisitorConsent(draft([ownIp]), true), SPEC);
    const off = applyVisitorLookup(on, null);
    expect(off.visitor_lookup).toBeNull();
    expect(readVisitorLookup(off)).toBeNull();
    expect(fields(off)).toEqual([...fields(draft([ownIp])), CONSENT]);
  });

  it("unticking consent also turns the lookup off", () => {
    const on = applyVisitorLookup(applyVisitorConsent(draft(), true), SPEC);
    const off = applyVisitorConsent(on, false);
    expect(off.visitor_lookup).toBeNull();
    expect(fields(off)).toEqual(fields(draft()));
  });

  it("reads a saved lookup without fill as all three details", () => {
    expect(readVisitorLookup({ visitor_lookup: { key_source_field: "a", key_kind: "session_id", event_types: ["x"] } }))
      .toEqual({ key_source_field: "a", key_kind: "session_id", event_types: ["x"], fill: ["fbc", "client_ip_address", "client_user_agent"] });
    expect(readVisitorLookup({ visitor_lookup: null })).toBeNull();
    expect(readVisitorLookup({})).toBeNull();
    expect(readVisitorLookup({ visitor_lookup: { key_source_field: "a", key_kind: "email", event_types: [] } })).toBeNull();
  });

  it("reads the event-type list and rejects unusable answers", () => {
    expect(parseEventTypes({ result: { event_types: ["lead", "lead", "Bad", 4, "purchase_done"] } }))
      .toEqual(["lead", "purchase_done"]);
    expect(parseEventTypes({ result: {} })).toBeNull();
    expect(parseEventTypes({ error: { code: "dependency_unavailable" } })).toBeNull();
    expect(parseEventTypes(null)).toBeNull();
  });
});

describe("Destination value field logic", () => {
  it("offers the rule value first, then each mapped field that can hold money, once", () => {
    expect(destinationValueOptions(draft([
      { canonical_field: "effective_value", source_field: "x", fixed_value: null, required: false, transforms: [] },
      { canonical_field: "", source_field: "y", fixed_value: null, required: false, transforms: [] },
    ]))).toEqual(["effective_value", "payout_amount"]);
  });

  it("hides fields that can never be a money value", () => {
    const withVisitor = applyVisitorLookup(applyVisitorConsent(draft([
      { canonical_field: "session_id", source_field: "sid", fixed_value: null, required: false, transforms: [] },
      { canonical_field: "funnel_attempt_id", source_field: "aid", fixed_value: null, required: false, transforms: [] },
      { canonical_field: "attempt_id", source_field: "att", fixed_value: null, required: false, transforms: [] },
      { canonical_field: "click_ref", source_field: "cref", fixed_value: null, required: false, transforms: [] },
      { canonical_field: "bid_amount", source_field: "bid", fixed_value: null, required: false, transforms: [] },
    ]), true), {
      key_source_field: "clickid", key_kind: "click_id", event_types: ["purchase"],
      fill: ["fbc", "client_ip_address", "client_user_agent"],
    });
    const options = destinationValueOptions(withVisitor);
    expect(options).toEqual(["effective_value", "payout_amount", "bid_amount"]);
    for (const hidden of ["fbc", "client_ip_address", "client_user_agent", "personal_data_consent", "click_id", "session_id", "attempt_id", "funnel_attempt_id", "source_record_id", "click_ref"]) {
      expect(options).not.toContain(hidden);
    }
  });

  it("names each value choice in plain words", () => {
    const labelled = draft([
      { canonical_field: "bid_amount", source_field: "bid", fixed_value: null, required: false, transforms: [], label: "Partner bid" },
    ]);
    expect(destinationValueLabel(labelled, "effective_value")).toBe("Value from the partner's report (effective value)");
    expect(destinationValueLabel(labelled, "bid_amount")).toBe("Partner bid");
    expect(destinationValueLabel(labelled, "payout_amount")).toBe("Field: payout_amount");
  });

  it("keeps the currency in step with the value", () => {
    const mapping = { event_name: "Purchase", value_field: "effective_value", currency_field: "currency" };
    expect(applyDestinationValue(mapping, "payout_amount")).toEqual({ ...mapping, value_field: "payout_amount", currency_field: "currency" });
    expect(applyDestinationValue(mapping, "")).toEqual({ ...mapping, value_field: null, currency_field: null });
    expect(applyDestinationValue(mapping, null)).toEqual({ ...mapping, value_field: null, currency_field: null });
  });

  it("clears the click ID field for Meta and restores it otherwise", () => {
    const meta = applyDestinationKind({ click_id_field: "click_id", action_source: "website" }, true);
    expect(meta).toEqual({ click_id_field: null, action_source: "website" });
    expect(applyDestinationKind({ click_id_field: "click_id" }, true)).toEqual({ click_id_field: null, action_source: "website" });
    expect(applyDestinationKind(meta, false)).toEqual({ click_id_field: "click_id", action_source: "website" });
  });

  it("builds new destinations with the rule value, currency and the right click ID field", () => {
    const other = defaultDestination("c1", false);
    expect(other.mapping).toEqual({
      event_name: "Purchase", event_id_field: "event_id", event_time_field: "occurred_at",
      value_field: "effective_value", currency_field: "currency", click_id_field: "click_id",
      source_url_field: null, action_source: "website", query_templates: [], header_templates: [], body_template: null,
    });
    expect((defaultDestination("c2", true).mapping as Item).click_id_field).toBeNull();
    expect(defaultDestination("c2", true).enabled).toBe(false);
  });
});

describe("Local API paths and page context for these screens", () => {
  afterEach(() => vi.unstubAllGlobals());

  const META_PATH = "/api/admin/conversions/provider-connections/0198f0aa-0000-7000-8000-000000000001/meta";

  it("allows GET and PUT only on the exact Meta sending-settings path", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestConversionsApi("t1", META_PATH)).resolves.toEqual({ ok: true });
    await expect(requestConversionsApi("t2", META_PATH, { method: "PUT", body: {} })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(META_PATH);
    for (const [path, method] of [
      [META_PATH, "POST"],
      [META_PATH, "DELETE"],
      ["/api/admin/conversions/v1/connections", "PUT"],
      ["/api/admin/conversions/provider-connections/0198f0aa-0000-7000-8000-000000000001/google", "GET"],
      ["/api/admin/conversions/provider-connections/not-a-uuid/meta", "GET"],
      [`${META_PATH}?x=1`, "GET"],
      [`${META_PATH}/../x`, "GET"],
    ] as const) {
      await expect(requestConversionsApi(`bad:${path}:${method}`, path, { method, body: method === "GET" ? undefined : {} }))
        .rejects.toBeInstanceOf(ConversionsApiError);
    }
    // A refused path never reaches the network.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("accepts the optional link address in the page context and nothing else new", () => {
    const base = {
      schema_version: "cms_conversions_ui_context.v2",
      workspace_id: "0198f0aa-0000-7000-8000-000000000003",
      role: "administrator",
      capabilities: [],
      account_scope: [{ account_id: "kodigital-primary", currency: "USD" }],
      reporting_currency: "USD",
      time_zone: "UTC",
      recipient_scope: [{ recipient_id: "0198f0aa-0000-7000-8000-000000000004", display_label: "Owner" }],
    };
    expect(unwrapConversionsUiContext(base).postbackOrigin).toBeUndefined();
    expect(unwrapConversionsUiContext({ ...base, postback_origin: "https://post.example.test" }).postbackOrigin)
      .toBe("https://post.example.test");
    expect(unwrapConversionsUiContext({ ...base, postback_origin: null }).postbackOrigin).toBeNull();
    for (const bad of ["http://post.example.test", "https://post.example.test/path", "", 5]) {
      expect(() => unwrapConversionsUiContext({ ...base, postback_origin: bad })).toThrow(/invalid response/u);
    }
    expect(() => unwrapConversionsUiContext({ ...base, other_key: "x" })).toThrow(/invalid response/u);
  });
});
