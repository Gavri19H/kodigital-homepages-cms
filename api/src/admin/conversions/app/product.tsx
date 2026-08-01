import { useCallback, useEffect, useReducer, useState } from "preact/hooks";
import type { SectionKey } from "./shell";
import { ShellFrame } from "./shell";
import { ConversionsApiError, requestConversionsApi } from "./api-client";
import { ConnectionsApp } from "./connections";
import { FlowsApp } from "./flows";
import { ActivityApp } from "./activity";
import { ControlsApp } from "./controls";
import { defaultConnectionConfig, type ConnectionAdapter } from "./connection-catalog";
import {
  buildConnectionCreateBody,
  CoreWireError,
  initialProductState,
  itemId,
  itemLabel,
  productReducer,
  unwrapCoreControls,
  unwrapCorePage,
  unwrapCreatedConnectionOrFlow,
} from "./product-state";

type Item = Record<string, unknown>;

const SECTION = {
  connections: { noun: "connection", endpoint: "/api/admin/conversions/v1/connections" },
  flows: { noun: "flow", endpoint: "/api/admin/conversions/v1/flows" },
  activity: { noun: "run", endpoint: "/api/admin/conversions/v1/runs" },
  controls: { noun: "control", endpoint: "/api/admin/conversions/v1/controls" },
} as const;

function message(error: unknown): string {
  return error instanceof ConversionsApiError || error instanceof CoreWireError
    ? error.message : "The local service could not be reached. Try again.";
}

function field(item: Item, ...keys: string[]): string {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
  }
  return "—";
}

function rowsFor(section: Exclude<SectionKey, "reports">, item: Item): ReadonlyArray<[string, string]> {
  if (section === "connections") return [
    ["Name", itemLabel(item, "Unnamed connection")],
    ["Type", field(item, "connection_type", "type")],
    ["State", field(item, "status", "state")],
  ];
  if (section === "flows") return [
    ["Name", itemLabel(item, "Unnamed flow")],
    ["Version", field(item, "published_version", "draft_version", "version")],
    ["State", field(item, "status", "state")],
  ];
  if (section === "activity") return [
    ["Run", itemLabel(item, "Run")],
    ["Trigger", field(item, "trigger_type", "trigger")],
    ["State", field(item, "status", "state")],
  ];
  return [
    ["Control", itemLabel(item, "Control")],
    ["Value", field(item, "value", "enabled")],
    ["Version", field(item, "row_version", "version")],
  ];
}

function CreatePanel(props: {
  section: "connections" | "flows";
  onClose: () => void;
  onCreated: (item: Item) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState(props.section === "connections" ? "generic_api" : "scheduled");
  const [connectionId, setConnectionId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const endpoint = SECTION[props.section].endpoint;
  async function submit(event: Event) {
    event.preventDefault();
    setSaving(true);
    setStatus("Saving locally…");
    try {
      const payload = await requestConversionsApi<unknown>(
        `${props.section}.create:${name}`,
        endpoint,
        {
          method: "POST",
          body: props.section === "connections"
            ? buildConnectionCreateBody({
              name,
              direction: "source",
              adapterType: kind,
              accountId,
              currency,
              config: defaultConnectionConfig(kind as ConnectionAdapter, "UTC"),
            })
            : {
              name, product_scope: "both", activity_label: "Conversion", vertical_label: "All",
              offer_scope: { type: "all", value: "all" }, primary_connection_id: connectionId,
              primary_config: {}, identity_namespace: "kodigital", identity_fields: [],
              normalization: {}, rules: [], mapping: {}, time: {}, currency: {}, patch_inputs: [],
              internal_outputs: {}, destinations: [],
            },
        },
      );
      const created = unwrapCreatedConnectionOrFlow(payload);
      props.onCreated(created);
      setStatus(`${SECTION[props.section].noun} saved.`);
      props.onClose();
    } catch (error) {
      setStatus(message(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form class="ko-product-form" onSubmit={submit} aria-label={`Create ${SECTION[props.section].noun}`}>
      <h3>New {SECTION[props.section].noun}</h3>
      <label>
        Name
        <input value={name} onInput={(event) => setName(event.currentTarget.value)} required maxLength={120} />
      </label>
      {props.section === "connections" && <>
        <label>
          Account ID
          <input value={accountId} onInput={(event) => setAccountId(event.currentTarget.value)} required pattern="[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}" maxLength={128} autocomplete="off" />
        </label>
        <label>
          Currency
          <input value={currency} onInput={(event) => setCurrency(event.currentTarget.value.toUpperCase())} required pattern="[A-Z]{3}" minLength={3} maxLength={3} autocomplete="off" />
        </label>
      </>}
      <label>
        {props.section === "connections" ? "Connection type" : "Trigger"}
        <select value={kind} onChange={(event) => setKind(event.currentTarget.value)}>
          {props.section === "connections" ? (
            <><option value="generic_api">Generic API</option><option value="managed_email">Managed email</option><option value="inbound_webhook">Inbound webhook</option></>
          ) : (
            <><option value="scheduled">Scheduled</option><option value="event">Event</option><option value="manual">Manual</option></>
          )}
        </select>
      </label>
      {props.section === "flows" && <label>
        Source connection ID
        <input value={connectionId} onInput={(event) => setConnectionId(event.currentTarget.value)} required pattern="[0-9a-f-]{36}" />
      </label>}
      <p class="ko-form-help">Credentials and activation are never entered on this local screen.</p>
      <div class="ko-button-row">
        <button class="ko-button ko-button--primary" type="submit" disabled={saving || name.trim().length === 0 || (props.section === "flows" && connectionId.length !== 36) || (props.section === "connections" && (accountId.length === 0 || !/^[A-Z]{3}$/.test(currency)))}>
          {saving ? "Saving…" : "Save draft"}
        </button>
        <button class="ko-button" type="button" onClick={props.onClose}>Cancel</button>
      </div>
      <p class="ko-conversions-sr-only" role="status" aria-live="polite">{status}</p>
    </form>
  );
}

export function ProductApp(props: {
  section: Exclude<SectionKey, "reports">;
  bootstrapActive: boolean;
}) {
  if (props.section === "connections") {
    return <ConnectionsApp bootstrapActive={props.bootstrapActive} />;
  }
  if (props.section === "flows") {
    return <FlowsApp bootstrapActive={props.bootstrapActive} />;
  }
  if (props.section === "activity") {
    return <ActivityApp bootstrapActive={props.bootstrapActive} />;
  }
  if (props.section === "controls") {
    return <ControlsApp bootstrapActive={props.bootstrapActive} />;
  }
  const config = SECTION[props.section];
  const [model, dispatch] = useReducer(productReducer<Item>, initialProductState<Item>());
  const [showCreate, setShowCreate] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  const [filter, setFilter] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    dispatch({ type: "load" });
    try {
      const payload = await requestConversionsApi<unknown>(`${props.section}.list`, config.endpoint, { signal });
      const items = props.section === "controls"
        ? unwrapCoreControls(payload)
        : unwrapCorePage(payload).items;
      dispatch({ type: "loaded", items });
      setLiveMessage(items.length === 0 ? `No ${config.noun}s found.` : `${items.length} ${config.noun}s loaded.`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      dispatch({ type: "failed", message: message(error) });
      setLiveMessage("Loading failed.");
    }
  }, [config.endpoint, config.noun, props.section]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const visible = model.items.filter((item) => JSON.stringify(item).toLowerCase().includes(filter.toLowerCase()));
  async function safeAction(item: Item) {
    const id = itemId(item);
    if (id === null) return;
    try {
      if (props.section === "connections") {
        await requestConversionsApi(`connection.test:${id}`, `${config.endpoint}/${id}/test`, {
          method: "POST",
          body: { test_kind: "connectivity_probe", sample_limit: 1, expected_side_effect_mode: "none" },
        });
        setLiveMessage("The side-effect-free connection test completed.");
      } else if (props.section === "activity") {
        await requestConversionsApi(`replay.preview:${id}`, "/api/admin/conversions/v1/replays/preview", {
          method: "POST",
          body: { mode: "reporting_only", destination_scope: [] },
        });
        setLiveMessage("Reporting-only replay preview created. No delivery was sent.");
      }
    } catch (error) {
      setLiveMessage(message(error));
    }
  }

  return (
    <ShellFrame section={props.section} bootstrapActive={props.bootstrapActive}>
      <div class="ko-product-toolbar">
        <label class="ko-filter">
          <span>Filter {config.noun}s</span>
          <input type="search" value={filter} onInput={(event) => setFilter(event.currentTarget.value)} />
        </label>
        <div class="ko-button-row">
          <button class="ko-button" type="button" onClick={() => void load()}>Refresh</button>
          {(props.section === "connections" || props.section === "flows") && (
            <button class="ko-button ko-button--primary" type="button" onClick={() => setShowCreate(true)}>
              New {config.noun}
            </button>
          )}
        </div>
      </div>
      {showCreate && (props.section === "connections" || props.section === "flows") && (
        <CreatePanel
          section={props.section}
          onClose={() => setShowCreate(false)}
          onCreated={(item) => dispatch({ type: "prepend", item })}
        />
      )}
      <div class="ko-product-live" role="status" aria-live="polite">{liveMessage}</div>
      {model.state === "loading" && (
        <div class="ko-loading" aria-busy="true" role="status"><span class="ko-spinner" />Loading {config.noun}s…</div>
      )}
      {model.state === "error" && (
        <div class="ko-conversions-state ko-conversions-state--error" role="alert">
          <h3>Unable to load</h3><p>{model.message}</p>
          <button class="ko-button" type="button" onClick={() => void load()}>Try again</button>
        </div>
      )}
      {model.state === "empty" && (
        <div class="ko-conversions-state" role="status">
          <h3>No {config.noun}s yet</h3>
          <p>{props.section === "activity" ? "Runs will appear here after a local preview." : "Create a draft to get started."}</p>
        </div>
      )}
      {(model.state === "ready" || model.state === "empty") && visible.length > 0 && (
        <div class="ko-resource-list">
          <table class="ko-resource-table">
            <caption class="ko-conversions-sr-only">{config.noun} list</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Details</th><th scope="col">State</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {visible.map((item, index) => {
                const rows = rowsFor(props.section, item);
                const id = itemId(item);
                return (
                  <tr key={id ?? index}>
                    <th scope="row">{rows[0][1]}</th><td>{rows[1][1]}</td><td>{rows[2][1]}</td>
                    <td>
                      {(props.section === "connections" || props.section === "activity") ? (
                        <button class="ko-button ko-button--small" type="button" disabled={id === null} onClick={() => void safeAction(item)}>
                          {props.section === "connections" ? "Test safely" : "Preview replay"}
                        </button>
                      ) : (
                        <button class="ko-button ko-button--small" type="button" disabled title="Activation is unavailable in local mode.">
                          {props.section === "controls" ? "Change" : "Publish"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div class="ko-resource-cards" aria-label={`${config.noun} cards`}>
            {visible.map((item, index) => (
              <article class="ko-resource-card" key={itemId(item) ?? index}>
                {rowsFor(props.section, item).map(([label, value]) => <p><strong>{label}</strong><span>{value}</span></p>)}
              </article>
            ))}
          </div>
        </div>
      )}
    </ShellFrame>
  );
}
