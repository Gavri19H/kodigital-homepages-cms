import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { ConversionsApiError, requestConversionsApi } from "./api-client";
import {
  adapterDefinition,
  adaptersForDirection,
  CONNECTION_CONFIG_SECTIONS,
  credentialTypesForAdapter,
  defaultConnectionConfig,
  normalizeConnectionConfigField,
  type ConfigField,
  type ConnectionAdapter,
  type ConnectionDirection,
} from "./connection-catalog";
import {
  CoreWireError,
  isRecord,
  itemId,
  unwrapConversionsUiContext,
  unwrapCorePage,
  unwrapCoreResult,
  type ConversionsUiContext,
} from "./product-state";
import { loadConnectionArchiveImpacts } from "./connection-archive-impact";
import { ShellFrame } from "./shell";

type Item = Record<string, unknown>;
type RouteMode = { readonly kind: "list" | "new" } | { readonly kind: "detail"; readonly id: string };

const CONNECTIONS_PATH = "/api/admin/conversions/v1/connections";
const UI_CONTEXT_PATH = "/api/admin/conversions/ui-context";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function routeMode(): RouteMode {
  if (typeof window === "undefined") return { kind: "list" };
  const path = window.location.pathname;
  if (path === "/admin/conversions/connections/new") return { kind: "new" };
  const prefix = "/admin/conversions/connections/";
  if (path.startsWith(prefix)) {
    const id = decodeURIComponent(path.slice(prefix.length));
    if (UUID.test(id)) return { kind: "detail", id };
  }
  return { kind: "list" };
}

function errorMessage(error: unknown): string {
  return error instanceof ConversionsApiError || error instanceof CoreWireError
    ? error.message
    : "The service could not complete this request. Try again.";
}

function scalar(item: Item, key: string): string {
  const value = item[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "—";
}

function getPath(config: Item, path: string): unknown {
  let current: unknown = config;
  for (const segment of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function pairKeys(path: string): readonly [string, string] {
  return path === "query_templates" || path === "header_templates"
    ? ["name", "value_template"]
    : ["source_field", "target_field"];
}

function ConfigFieldEditor(props: {
  field: ConfigField;
  config: Item;
  onChange: (path: string, value: unknown) => void;
}) {
  const value = getPath(props.config, props.field.path);
  const id = `connection-config-${props.field.path.replaceAll(".", "-")}`;
  if (props.field.kind === "pairs") {
    const [firstKey, secondKey] = pairKeys(props.field.path);
    const pairs = Array.isArray(value) ? value.filter(isRecord) : [];
    return (
      <fieldset class="ko-config-field ko-config-pairs">
        <legend>{props.field.label}</legend>
        <p>{props.field.help}</p>
        {pairs.map((pairValue, index) => (
          <div class="ko-pair-row" key={`${props.field.path}-${index}`}>
            <label>
              <span>{props.field.pairLabels?.[0] ?? "Source"}</span>
              <input
                value={String(pairValue[firstKey] ?? "")}
                onInput={(event) => {
                  const next = pairs.map((item, itemIndex) => itemIndex === index
                    ? { ...item, [firstKey]: event.currentTarget.value }
                    : item);
                  props.onChange(props.field.path, next);
                }}
              />
            </label>
            <label>
              <span>{props.field.pairLabels?.[1] ?? "Target"}</span>
              <input
                value={String(pairValue[secondKey] ?? "")}
                onInput={(event) => {
                  const next = pairs.map((item, itemIndex) => itemIndex === index
                    ? { ...item, [secondKey]: event.currentTarget.value }
                    : item);
                  props.onChange(props.field.path, next);
                }}
              />
            </label>
            <button
              class="ko-button ko-button--small"
              type="button"
              onClick={() => props.onChange(props.field.path, pairs.filter((_, itemIndex) => itemIndex !== index))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          class="ko-button ko-button--small"
          type="button"
          onClick={() => props.onChange(props.field.path, [...pairs, { [firstKey]: "", [secondKey]: "" }])}
        >
          Add row
        </button>
      </fieldset>
    );
  }
  if (props.field.kind === "static") {
    return (
      <div class="ko-config-field">
        <span class="ko-static-label">{props.field.label}</span>
        <output id={id}>{typeof value === "boolean" ? (value ? "Yes" : "No") : String(value ?? "—")}</output>
        <small>{props.field.help}</small>
      </div>
    );
  }
  if (props.field.kind === "boolean") {
    return (
      <label class="ko-config-field ko-checkbox">
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(event) => props.onChange(props.field.path, event.currentTarget.checked)}
        />
        <span>{props.field.label}<small>{props.field.help}</small></span>
      </label>
    );
  }
  let display = "";
  if (props.field.kind === "csv" && Array.isArray(value)) display = value.join(", ");
  else if (value !== null && value !== undefined) display = String(value);
  const update = (raw: string) => {
    if (props.field.kind === "number") {
      props.onChange(props.field.path, raw === "" && props.field.nullable ? null : Number(raw));
      return;
    }
    if (props.field.kind === "csv") {
      const values = raw.split(",").map((item) => item.trim()).filter(Boolean);
      props.onChange(
        props.field.path,
        props.field.path.includes("statuses") ? values.map((item) => Number(item)) : values,
      );
      return;
    }
    if (props.field.kind === "select") {
      props.onChange(props.field.path, typeof value === "number" ? Number(raw) : raw);
      return;
    }
    props.onChange(props.field.path, raw === "" && props.field.nullable ? null : raw);
  };
  return (
    <label class="ko-config-field" for={id}>
      <span>{props.field.label}</span>
      {props.field.kind === "select" ? (
        <select id={id} value={display} onChange={(event) => update(event.currentTarget.value)}>
          {props.field.options?.map((option) => <option value={option.value}>{option.label}</option>)}
        </select>
      ) : props.field.kind === "textarea" ? (
        <textarea id={id} value={display} onInput={(event) => update(event.currentTarget.value)} rows={4} />
      ) : (
        <input
          id={id}
          type={props.field.kind === "number" ? "number" : props.field.kind === "url" ? "url" : "text"}
          value={display}
          min={props.field.minimum}
          max={props.field.maximum}
          onInput={(event) => update(event.currentTarget.value)}
          autocomplete="off"
        />
      )}
      <small>{props.field.help}</small>
    </label>
  );
}

function ConfigEditor(props: {
  adapter: ConnectionAdapter;
  config: Item;
  onChange: (config: Item) => void;
}) {
  return (
    <div class="ko-config-editor">
      {CONNECTION_CONFIG_SECTIONS[props.adapter].map((section) => (
        <section class="ko-config-section" aria-labelledby={`config-${props.adapter}-${section.title.replaceAll(" ", "-")}`}>
          <h3 id={`config-${props.adapter}-${section.title.replaceAll(" ", "-")}`}>{section.title}</h3>
          <p>{section.description}</p>
          <div class="ko-config-grid">
            {section.fields
              .filter((field) => field.visibleWhen === undefined
                || getPath(props.config, field.visibleWhen.path) === field.visibleWhen.equals)
              .map((field) => (
              <ConfigFieldEditor
                key={field.path}
                field={field}
                config={props.config}
                onChange={(path, value) => props.onChange(
                  normalizeConnectionConfigField(props.config, path, value),
                )}
              />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ConnectionsList(props: { bootstrapActive: boolean }) {
  const [items, setItems] = useState<ReadonlyArray<Item>>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("");
  const load = useCallback(async () => {
    setState("loading");
    try {
      const payload = await requestConversionsApi<unknown>("connections.list", CONNECTIONS_PATH);
      setItems(unwrapCorePage(payload).items);
      setState("ready");
      setMessage("");
    } catch (error) {
      setState("error");
      setMessage(errorMessage(error));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const visible = items.filter((item) => JSON.stringify(item).toLowerCase().includes(filter.toLowerCase()));
  return (
    <ShellFrame section="connections" bootstrapActive={props.bootstrapActive}>
      <div class="ko-product-toolbar">
        <label class="ko-filter"><span>Filter connections</span><input type="search" value={filter} onInput={(event) => setFilter(event.currentTarget.value)} /></label>
        <div class="ko-button-row">
          <button class="ko-button" type="button" onClick={() => void load()}>Refresh</button>
          <a class="ko-button ko-button--primary" href="/admin/conversions/connections/new">New connection</a>
        </div>
      </div>
      {state === "loading" && <div class="ko-loading" role="status" aria-busy="true"><span class="ko-spinner" />Loading connections…</div>}
      {state === "error" && <div class="ko-conversions-state ko-conversions-state--error" role="alert"><h3>Unable to load</h3><p>{message}</p><button class="ko-button" type="button" onClick={() => void load()}>Try again</button></div>}
      {state === "ready" && visible.length === 0 && <div class="ko-conversions-state" role="status"><h3>No matching connections</h3><p>Create a source or destination Connection to define reusable transport and authentication.</p></div>}
      {state === "ready" && visible.length > 0 && (
        <div class="ko-resource-list">
          <table class="ko-resource-table">
            <thead><tr><th>Name</th><th>Direction</th><th>Adapter</th><th>State</th><th>Last test</th></tr></thead>
            <tbody>{visible.map((item) => {
              const id = itemId(item);
              const adapter = adapterDefinition(scalar(item, "adapter_type"));
              return <tr key={id ?? JSON.stringify(item)}>
                <th>{id === null ? scalar(item, "name") : <a href={`/admin/conversions/connections/${encodeURIComponent(id)}`}>{scalar(item, "name")}</a>}</th>
                <td>{scalar(item, "direction")}</td>
                <td>{adapter?.label ?? scalar(item, "adapter_type")}</td>
                <td>{scalar(item, "status")}</td>
                <td>{scalar(item, "last_test_status")}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}
    </ShellFrame>
  );
}

interface EditorModel {
  readonly name: string;
  readonly description: string;
  readonly direction: ConnectionDirection;
  readonly adapter: ConnectionAdapter;
  readonly accountId: string;
  readonly currency: string;
  readonly config: Item;
  readonly rowVersion: number;
}

function blankEditor(context: ConversionsUiContext): EditorModel {
  const account = context.accountScope[0];
  return {
    name: "",
    description: "",
    direction: "source",
    adapter: "generic_api",
    accountId: account?.accountId ?? "",
    currency: account?.currency ?? context.reportingCurrency,
    config: defaultConnectionConfig("generic_api", context.timeZone),
    rowVersion: 0,
  };
}

function editorFromItem(item: Item): EditorModel {
  const adapter = scalar(item, "adapter_type") as ConnectionAdapter;
  const direction = scalar(item, "direction") as ConnectionDirection;
  const config = item.config;
  if (!adapterDefinition(adapter) || !isRecord(config)
      || (direction !== "source" && direction !== "destination")
      || typeof item.row_version !== "number") {
    throw new CoreWireError("invalid_response", "The service returned an invalid Connection.");
  }
  return {
    name: scalar(item, "name") === "—" ? "" : scalar(item, "name"),
    description: scalar(item, "description") === "—" ? "" : scalar(item, "description"),
    direction,
    adapter,
    accountId: scalar(item, "account_id"),
    currency: scalar(item, "currency"),
    config,
    rowVersion: item.row_version,
  };
}

function CredentialPanel(props: {
  id: string;
  adapter: ConnectionAdapter;
  credentialPresent: boolean;
  credentialVersion: number | null;
  canManageCredentials: boolean;
  onSaved: () => void;
}) {
  const types = credentialTypesForAdapter(props.adapter);
  const [type, setType] = useState(types[0] ?? "");
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setType(types[0] ?? "");
    setFirst("");
    setSecond("");
  }, [props.adapter]);
  async function save(event: Event) {
    event.preventDefault();
    if (!props.canManageCredentials) return;
    setSaving(true);
    try {
      let credentialFields: Item;
      if (type === "basic") credentialFields = { credential_type: type, username: first, password: second };
      else if (type === "hmac") credentialFields = { credential_type: type, secret: first };
      else if (type === "service_account") credentialFields = { credential_type: type, client_email: first, private_key: second };
      else credentialFields = { credential_type: type, token: first };
      await requestConversionsApi(`connection.credentials:${props.id}`, `${CONNECTIONS_PATH}/${props.id}/credentials`, {
        method: "POST",
        body: {
          credential_schema_version: 1,
          credential_fields: credentialFields,
          replace_reason: props.credentialPresent ? "operator_replacement" : "initial_setup",
        },
      });
      setFirst("");
      setSecond("");
      setMessage("Credential saved. Its value was discarded from this screen.");
      props.onSaved();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }
  async function oauth() {
    if (!props.canManageCredentials) return;
    setSaving(true);
    try {
      const payload = await requestConversionsApi<unknown>(
        `connection.oauth:${props.id}`,
        `${CONNECTIONS_PATH}/${props.id}/oauth/start`,
        { method: "POST", body: { redirect_uri: `${window.location.origin}/admin/conversions/connections/${props.id}` } },
      );
      const result = unwrapCoreResult(payload);
      if (!isRecord(result) || typeof result.authorization_url !== "string") throw new CoreWireError("invalid_response", "The service returned an invalid OAuth start.");
      window.location.assign(result.authorization_url);
    } catch (error) {
      setMessage(errorMessage(error));
      setSaving(false);
    }
  }
  const oauthAdapter = props.adapter === "google_sheets" || props.adapter === "microsoft_excel";
  return (
    <section class="ko-config-section" aria-labelledby="connection-credentials-heading">
      <h3 id="connection-credentials-heading">Authentication</h3>
      <p>
        {props.credentialPresent
          ? `A write-only credential is present (version ${props.credentialVersion ?? "unknown"}). Its value can never be viewed or copied.`
          : "No credential is stored. Saving one is separate from the non-secret Connection configuration."}
      </p>
      {!props.canManageCredentials && <p>You do not have the connections.credentials capability.</p>}
      {oauthAdapter && <button class="ko-button" type="button" disabled={saving || !props.canManageCredentials} onClick={() => void oauth()}>Connect with provider</button>}
      {types.length > 0 && (
        <form class="ko-credential-form" onSubmit={save}>
          <label>Credential type<select disabled={!props.canManageCredentials} value={type} onChange={(event) => setType(event.currentTarget.value)}>{types.map((value) => <option value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
          <label>
            {type === "basic" ? "Username" : type === "service_account" ? "Service-account email" : type === "hmac" ? "HMAC secret" : "Token"}
            <input disabled={!props.canManageCredentials} type={type === "basic" || type === "service_account" ? "text" : "password"} value={first} onInput={(event) => setFirst(event.currentTarget.value)} autocomplete="off" required />
          </label>
          {(type === "basic" || type === "service_account") && <label>{type === "basic" ? "Password" : "Private key"}<textarea disabled={!props.canManageCredentials} value={second} onInput={(event) => setSecond(event.currentTarget.value)} required rows={4} autocomplete="off" /></label>}
          <button class="ko-button" type="submit" disabled={saving || !props.canManageCredentials || first.length < 1 || ((type === "basic" || type === "service_account") && second.length < 1)}>Save credentials</button>
        </form>
      )}
      {types.length === 0 && !oauthAdapter && <p>No per-Connection credential is required for this adapter.</p>}
      <p role="status" aria-live="polite">{message}</p>
    </section>
  );
}

function ConnectionEditor(props: { bootstrapActive: boolean; mode: Extract<RouteMode, { kind: "new" | "detail" }> }) {
  const [context, setContext] = useState<ConversionsUiContext | null>(null);
  const [model, setModel] = useState<EditorModel | null>(null);
  const [resource, setResource] = useState<Item | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<Item | null>(null);
  const [impacts, setImpacts] = useState<ReadonlyArray<Item> | null>(null);
  const id = props.mode.kind === "detail" ? props.mode.id : null;
  const load = useCallback(async () => {
    setState("loading");
    try {
      const contextPayload = await requestConversionsApi<unknown>("ui.context", UI_CONTEXT_PATH);
      const nextContext = unwrapConversionsUiContext(contextPayload);
      setContext(nextContext);
      if (id === null) {
        setModel(blankEditor(nextContext));
        setResource(null);
      } else {
        const payload = await requestConversionsApi<unknown>(`connection.read:${id}`, `${CONNECTIONS_PATH}/${id}`);
        const result = unwrapCoreResult(payload);
        if (!isRecord(result)) throw new CoreWireError("invalid_response", "The service returned an invalid Connection.");
        setResource(result);
        setModel(editorFromItem(result));
      }
      setState("ready");
      setMessage("");
    } catch (error) {
      setState("error");
      setMessage(errorMessage(error));
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const definition = model === null ? undefined : adapterDefinition(model.adapter);
  const adapters = useMemo(() => model === null ? [] : adaptersForDirection(model.direction), [model?.direction]);
  const canManage = context?.capabilities.includes("connections.manage") === true;
  const canManageCredentials = context?.capabilities.includes("connections.credentials") === true;

  function changeDirection(direction: ConnectionDirection) {
    if (model === null || context === null) return;
    const adapter = adaptersForDirection(direction)[0]!.value;
    setModel({ ...model, direction, adapter, config: defaultConnectionConfig(adapter, context.timeZone) });
  }
  function changeAdapter(adapter: ConnectionAdapter) {
    if (model === null || context === null) return;
    setModel({ ...model, adapter, config: defaultConnectionConfig(adapter, context.timeZone) });
  }
  async function save(event: Event) {
    event.preventDefault();
    if (model === null) return;
    setSaving(true);
    setMessage("Saving…");
    try {
      const body = {
        ...(id === null ? {} : { row_version: model.rowVersion }),
        name: model.name.trim(),
        ...(model.description.trim() === "" ? {} : { description: model.description.trim() }),
        direction: model.direction,
        adapter_type: model.adapter,
        config_schema_version: 1,
        config: model.config,
        ...(id === null ? { account_id: model.accountId, currency: model.currency } : {}),
      };
      const payload = await requestConversionsApi<unknown>(
        id === null ? `connection.create:${model.name}` : `connection.update:${id}`,
        id === null ? CONNECTIONS_PATH : `${CONNECTIONS_PATH}/${id}`,
        { method: id === null ? "POST" : "PATCH", body },
      );
      const result = unwrapCoreResult(payload);
      if (!isRecord(result) || typeof result.connection_id !== "string") throw new CoreWireError("invalid_response", "The service returned an invalid Connection.");
      if (id === null) {
        window.location.assign(`/admin/conversions/connections/${encodeURIComponent(result.connection_id)}`);
        return;
      }
      setResource(result);
      setModel(editorFromItem(result));
      setMessage("Connection saved.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }
  async function testConnection() {
    if (id === null) return;
    setSaving(true);
    setMessage("Running a side-effect-free test…");
    try {
      const payload = await requestConversionsApi<unknown>(`connection.test:${id}`, `${CONNECTIONS_PATH}/${id}/test`, {
        method: "POST",
        body: { test_kind: "connectivity_probe", sample_limit: 10, expected_side_effect_mode: "none" },
      });
      const result = unwrapCoreResult(payload);
      if (!isRecord(result)) throw new CoreWireError("invalid_response", "The service returned an invalid test result.");
      setTestResult(result);
      setMessage("Side-effect-free test completed.");
      await load();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }
  async function prepareArchive() {
    if (id === null) return;
    setSaving(true);
    try {
      setImpacts(await loadConnectionArchiveImpacts(id));
      setMessage("");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }
  async function archive() {
    if (id === null || model === null) return;
    setSaving(true);
    try {
      await requestConversionsApi(`connection.archive:${id}`, `${CONNECTIONS_PATH}/${id}/archive`, {
        method: "POST",
        body: { row_version: model.rowVersion, reason: "operator_archive" },
      });
      window.location.assign("/admin/conversions/connections");
    } catch (error) {
      setMessage(errorMessage(error));
      setImpacts(null);
      setSaving(false);
    }
  }

  return (
    <ShellFrame section="connections" bootstrapActive={props.bootstrapActive}>
      <div class="ko-detail-header">
        <a href="/admin/conversions/connections">← All connections</a>
        <h3>{id === null ? "New connection" : model?.name ?? "Connection"}</h3>
        {definition && <p>{definition.purpose}</p>}
      </div>
      {state === "loading" && <div class="ko-loading" role="status" aria-busy="true"><span class="ko-spinner" />Loading Connection editor…</div>}
      {state === "error" && <div class="ko-conversions-state ko-conversions-state--error" role="alert"><h3>Unable to load</h3><p>{message}</p><button class="ko-button" type="button" onClick={() => void load()}>Try again</button></div>}
      {state === "ready" && model !== null && context !== null && (
        <>
          <form class="ko-connection-editor" onSubmit={save}>
            <section class="ko-config-section" aria-labelledby="connection-basics-heading">
              <h3 id="connection-basics-heading">Connection basics</h3>
              <p>A Connection defines reusable transport and authentication only. Mapping, identity, rules, schedules that change business meaning, and outputs belong to a Flow.</p>
              <div class="ko-config-grid">
                <label class="ko-config-field"><span>Name</span><input required maxLength={256} value={model.name} onInput={(event) => setModel({ ...model, name: event.currentTarget.value })} /><small>A clear operator-facing name.</small></label>
                <label class="ko-config-field"><span>Description</span><textarea rows={3} maxLength={2_048} value={model.description} onInput={(event) => setModel({ ...model, description: event.currentTarget.value })} /><small>Optional purpose or ownership note.</small></label>
                <label class="ko-config-field"><span>Direction</span><select value={model.direction} disabled={id !== null} onChange={(event) => changeDirection(event.currentTarget.value as ConnectionDirection)}><option value="source">Source: bring data into KODigital</option><option value="destination">Destination: send eligible events out</option></select><small>Direction cannot be changed after creation.</small></label>
                <label class="ko-config-field"><span>Adapter</span><select value={model.adapter} disabled={id !== null} onChange={(event) => changeAdapter(event.currentTarget.value as ConnectionAdapter)}>{adapters.map((adapter) => <option value={adapter.value}>{adapter.label}</option>)}</select><small>{definition?.purpose}</small></label>
                <label class="ko-config-field"><span>KODigital account</span><select value={model.accountId} disabled={id !== null} onChange={(event) => {
                  const account = context.accountScope.find((candidate) => candidate.accountId === event.currentTarget.value);
                  setModel({ ...model, accountId: event.currentTarget.value, currency: account?.currency ?? context.reportingCurrency });
                }}>{context.accountScope.map((account) => <option value={account.accountId}>{account.accountId} · {account.currency}</option>)}</select><small>This is selected from your permanent CMS authority; it is not a Facebook or provider account.</small></label>
                <div class="ko-config-field"><span class="ko-static-label">Reporting currency</span><output>{model.currency}</output><small>Inherited from the selected authorized KODigital account.</small></div>
              </div>
              {context.accountScope.length === 0 && <p class="ko-inline-error" role="alert">No authorized KODigital account is available. Creation is blocked.</p>}
            </section>
            {id !== null && model.adapter === "managed_email" && <section class="ko-generated-endpoint"><h3>Generated recipient</h3><p>The service must return the approved recipient address before this source can be used. The opaque Connection token is <code>{scalar(resource ?? {}, "public_id")}</code>.</p></section>}
            {id !== null && model.adapter === "inbound_webhook" && <section class="ko-generated-endpoint"><h3>Generated webhook path</h3><code>/v1/in/{scalar(resource ?? {}, "public_id")}</code><p>Share the full approved public hostname and the separately generated credential only after ingress activation is explicitly authorized.</p></section>}
            <ConfigEditor adapter={model.adapter} config={model.config} onChange={(config) => setModel({ ...model, config })} />
            <div class="ko-sticky-actions">
              <button class="ko-button ko-button--primary" type="submit" disabled={saving || !canManage || model.name.trim() === "" || model.accountId === ""}>{saving ? "Saving…" : id === null ? "Save draft" : "Save changes"}</button>
              {!canManage && <span>You do not have the connections.manage capability.</span>}
              <span role="status" aria-live="polite">{message}</span>
            </div>
          </form>
          {id !== null && resource !== null && (
            <>
              <CredentialPanel
                id={id}
                adapter={model.adapter}
                credentialPresent={resource.credential_present === true}
                credentialVersion={typeof resource.credential_version === "number" ? resource.credential_version : null}
                canManageCredentials={canManageCredentials}
                onSaved={() => void load()}
              />
              <section class="ko-config-section" aria-labelledby="connection-test-heading">
                <h3 id="connection-test-heading">Test connection</h3>
                <p>This reads connectivity and a bounded sample only. It records no live conversion and sends no destination event.</p>
                <button class="ko-button" type="button" disabled={saving || !canManage} onClick={() => void testConnection()}>Run side-effect-free test</button>
                {testResult && <dl class="ko-test-result"><dt>Status</dt><dd>{scalar(testResult, "status")}</dd><dt>Code</dt><dd>{scalar(testResult, "code")}</dd><dt>Message</dt><dd>{scalar(testResult, "message")}</dd></dl>}
              </section>
              <section class="ko-config-section ko-danger-zone" aria-labelledby="connection-archive-heading">
                <h3 id="connection-archive-heading">Archive Connection</h3>
                <p>Archiving stops this Connection from being selected by new drafts. Existing Flow references must be reviewed first.</p>
                <button class="ko-button" type="button" disabled={saving || !canManage} onClick={() => void prepareArchive()}>Review archive impact</button>
              </section>
            </>
          )}
        </>
      )}
      {impacts !== null && (
        <div class="ko-modal-backdrop" role="presentation">
          <section class="ko-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="archive-dialog-title">
            <h3 id="archive-dialog-title">Archive this Connection?</h3>
            {impacts.length === 0 ? <p>No currently listed Flow references this Connection.</p> : <>
              <p>The following Flow records contain this Connection and may require replacement:</p>
              <ul>{impacts.map((flow) => <li>{scalar(flow, "name")} ({scalar(flow, "status")})</li>)}</ul>
            </>}
            <p>This does not delete credentials, history, or prior run evidence.</p>
            <div class="ko-button-row"><button class="ko-button ko-button--danger" type="button" disabled={saving || !canManage || impacts.length > 0} onClick={() => void archive()}>Archive Connection</button><button class="ko-button" type="button" onClick={() => setImpacts(null)}>Cancel</button></div>
          </section>
        </div>
      )}
    </ShellFrame>
  );
}

export function ConnectionsApp(props: { bootstrapActive: boolean }) {
  const mode = routeMode();
  return mode.kind === "list"
    ? <ConnectionsList bootstrapActive={props.bootstrapActive} />
    : <ConnectionEditor bootstrapActive={props.bootstrapActive} mode={mode} />;
}
