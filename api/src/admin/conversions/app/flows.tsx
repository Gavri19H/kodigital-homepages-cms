import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ConversionsApiError, requestConversionsApi } from "./api-client";
import { collectCorePages } from "./core-pages";
import {
  CoreWireError,
  isRecord,
  itemId,
  unwrapConversionsUiContext,
  unwrapCoreResult,
  type ConversionsUiContext,
} from "./product-state";
import { ShellFrame } from "./shell";

type Item = Record<string, unknown>;
type FlowRoute = { kind: "list" | "new" } | { kind: "detail"; id: string };

const FLOWS_PATH = "/api/admin/conversions/v1/flows";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_REASON = /^[a-z][a-z0-9_.:-]{0,127}$/;
const STEPS = [
  "Basics",
  "Primary source",
  "Preview real data",
  "Identify events",
  "Qualification",
  "Map fields",
  "Patch inputs",
  "Choose outputs",
  "Side-effect-free test",
  "Ownership and publish",
] as const;

function flowRoute(): FlowRoute {
  if (typeof window === "undefined") return { kind: "list" };
  const path = window.location.pathname;
  if (path === "/admin/conversions/flows/new") return { kind: "new" };
  const prefix = "/admin/conversions/flows/";
  if (path.startsWith(prefix)) {
    const id = decodeURIComponent(path.slice(prefix.length));
    if (UUID.test(id)) return { kind: "detail", id };
  }
  return { kind: "list" };
}

function message(error: unknown): string {
  return error instanceof ConversionsApiError || error instanceof CoreWireError
    ? error.message
    : "The service could not complete this request. Try again.";
}

function text(item: Item, key: string): string {
  const value = item[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "—";
}

function defaultOutcome(status = "invalid"): Item {
  return { status, effective_value_rule: status, value: null };
}

function defaultFlowDraft(context: ConversionsUiContext, sourceId: string): Item {
  return {
    name: "",
    description: "",
    product_scope: "both",
    activity_label: "Conversion",
    vertical_label: "All",
    offer_scope: { type: "all", value: "all" },
    primary_connection_id: sourceId,
    primary_config: {
      input_ordinal: 0,
      precedence: { business_version_field: null, business_version_kind: "none", input_priority: 100 },
    },
    identity_namespace: `flow-${crypto.randomUUID()}`,
    identity_fields: ["source_record_id"],
    normalization: {
      fields: [{ source_field: "id", transforms: [{ op: "trim" }, { op: "unicode_nfc" }] }],
    },
    rules: {
      ordered: [{
        id: "default_invalid",
        predicate: { op: "always" },
        outcome: defaultOutcome(),
        on_value_error: null,
      }],
      default_outcome: defaultOutcome(),
    },
    mapping: {
      fields: [{
        canonical_field: "source_record_id",
        source_field: "id",
        fixed_value: null,
        required: true,
        transforms: [{ op: "trim" }, { op: "unicode_nfc" }],
      }, {
        canonical_field: "occurred_at",
        source_field: "occurred_at",
        fixed_value: null,
        required: true,
        transforms: [{ op: "timestamp", format: "iso_8601", timezone: context.timeZone }],
      }],
    },
    time: {
      occurred_at_field: "occurred_at",
      input_format: "iso_8601",
      timezone: context.timeZone,
      invalid_policy: "invalid",
    },
    currency: {
      reporting_currency: context.reportingCurrency,
      source_currency_field: null,
      fixed_source_currency: context.reportingCurrency,
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
}

function exactDraft(value: unknown): Item {
  if (!isRecord(value) || typeof value.name !== "string"
      || typeof value.version !== "number" || typeof value.row_version !== "number"
      || !Array.isArray(value.identity_fields) || !isRecord(value.mapping)
      || !isRecord(value.rules) || !Array.isArray(value.patch_inputs)
      || !Array.isArray(value.destinations)) {
    throw new CoreWireError("invalid_response", "The service returned an invalid Flow draft.");
  }
  const {
    flow_id: ignoredFlow,
    flow_version_id: ignoredVersion,
    version: ignoredNumber,
    row_version: ignoredRow,
    status: ignoredStatus,
    config_hash: ignoredHash,
    created_at: ignoredCreated,
    ...body
  } = value;
  void ignoredFlow; void ignoredVersion; void ignoredNumber; void ignoredRow;
  void ignoredStatus; void ignoredHash; void ignoredCreated;
  return body;
}

function connectionName(connections: ReadonlyArray<Item>, id: string): string {
  return text(connections.find((item) => item.connection_id === id) ?? {}, "name");
}

async function loadCoreCollection(key: string, path: string): Promise<ReadonlyArray<Item>> {
  return collectCorePages((cursor, pageNumber) => {
    const parameters = new URLSearchParams({ limit: "100" });
    if (cursor !== null) parameters.set("cursor", cursor);
    return requestConversionsApi<unknown>(`${key}:page:${pageNumber}`, `${path}?${parameters.toString()}`);
  });
}

function FlowsList(props: { bootstrapActive: boolean }) {
  const [items, setItems] = useState<ReadonlyArray<Item>>([]);
  const [context, setContext] = useState<ConversionsUiContext | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const load = useCallback(async () => {
    setState("loading");
    try {
      const [contextPayload, nextItems] = await Promise.all([
        requestConversionsApi<unknown>("ui.context", "/api/admin/conversions/ui-context"),
        loadCoreCollection("flows.list", FLOWS_PATH),
      ]);
      setContext(unwrapConversionsUiContext(contextPayload));
      setItems(nextItems);
      setState("ready");
    } catch (cause) {
      setError(message(cause));
      setState("error");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const canManage = context?.capabilities.includes("flows.manage") === true;
  const visible = items.filter((item) => JSON.stringify(item).toLowerCase().includes(filter.toLowerCase()));
  return <ShellFrame section="flows" bootstrapActive={props.bootstrapActive}>
    <div class="ko-product-toolbar">
      <label class="ko-filter"><span>Filter Flows</span><input type="search" value={filter} onInput={(event) => setFilter(event.currentTarget.value)} /></label>
      <div class="ko-button-row"><button class="ko-button" type="button" onClick={() => void load()}>Refresh</button>{canManage ? <a class="ko-button ko-button--primary" href="/admin/conversions/flows/new">New Flow</a> : <button class="ko-button ko-button--primary" type="button" disabled>New Flow</button>}</div>
    </div>
    {context !== null && !canManage && <p class="ko-disabled-reason">You do not have the flows.manage capability required to create a Flow.</p>}
    {state === "loading" && <div class="ko-loading" role="status" aria-busy="true"><span class="ko-spinner" />Loading Flows…</div>}
    {state === "error" && <div class="ko-conversions-state ko-conversions-state--error" role="alert"><h3>Unable to load</h3><p>{error}</p><button class="ko-button" type="button" onClick={() => void load()}>Try again</button></div>}
    {state === "ready" && visible.length === 0 && <div class="ko-conversions-state"><h3>No matching Flows</h3><p>A Flow turns source rows into stable conversion events, applies qualification, and chooses internal and external outputs.</p></div>}
    {state === "ready" && visible.length > 0 && <div class="ko-resource-list"><table class="ko-resource-table"><thead><tr><th>Name</th><th>Status</th><th>Version</th><th>Updated</th></tr></thead><tbody>{visible.map((item) => {
      const id = itemId(item);
      return <tr key={id ?? JSON.stringify(item)}><th>{id ? <a href={`/admin/conversions/flows/${id}`}>{text(item, "name")}</a> : text(item, "name")}</th><td>{text(item, "status")}</td><td>{text(item, "latest_version")}</td><td>{text(item, "updated_at")}</td></tr>;
    })}</tbody></table></div>}
  </ShellFrame>;
}

function StringListEditor(props: {
  label: string;
  help: string;
  values: ReadonlyArray<string>;
  onChange: (values: string[]) => void;
}) {
  return <label class="ko-config-field"><span>{props.label}</span><input value={props.values.join(", ")} onInput={(event) => props.onChange(event.currentTarget.value.split(",").map((value) => value.trim()).filter(Boolean))} /><small>{props.help}</small></label>;
}

function MappingEditor(props: { draft: Item; setDraft: (draft: Item) => void }) {
  const mapping = props.draft.mapping as { fields: Item[] };
  const fields = mapping.fields;
  return <section class="ko-wizard-card"><h4>Canonical field mapping</h4><p>Each canonical field must come from exactly one source column or one safe fixed value. Identity, time, and money cannot be silently guessed.</p>
    {fields.map((field, index) => <div class="ko-mapping-row" key={`${field.canonical_field}-${index}`}>
      <label>Canonical field<input value={String(field.canonical_field ?? "")} onInput={(event) => {
        const next = fields.map((item, itemIndex) => itemIndex === index ? { ...item, canonical_field: event.currentTarget.value } : item);
        props.setDraft({ ...props.draft, mapping: { fields: next } });
      }} /></label>
      <label>Source column<input value={String(field.source_field ?? "")} onInput={(event) => {
        const value = event.currentTarget.value;
        const next = fields.map((item, itemIndex) => itemIndex === index ? { ...item, source_field: value || null, fixed_value: value ? null : item.fixed_value } : item);
        props.setDraft({ ...props.draft, mapping: { fields: next } });
      }} /></label>
      <label>Fixed value<input value={String(field.fixed_value ?? "")} onInput={(event) => {
        const value = event.currentTarget.value;
        const next = fields.map((item, itemIndex) => itemIndex === index ? { ...item, fixed_value: value || null, source_field: value ? null : item.source_field } : item);
        props.setDraft({ ...props.draft, mapping: { fields: next } });
      }} /></label>
      <label>Transforms<input value={(Array.isArray(field.transforms) ? field.transforms : []).map((transform) => isRecord(transform) ? String(transform.op ?? "") : "").join(", ")} onInput={(event) => {
        const transforms = event.currentTarget.value.split(",").map((value) => value.trim()).filter(Boolean).map((op) => ({ op }));
        const next = fields.map((item, itemIndex) => itemIndex === index ? { ...item, transforms } : item);
        props.setDraft({ ...props.draft, mapping: { fields: next } });
      }} /></label>
      <label class="ko-checkbox"><input type="checkbox" checked={field.required === true} onChange={(event) => {
        const next = fields.map((item, itemIndex) => itemIndex === index ? { ...item, required: event.currentTarget.checked } : item);
        props.setDraft({ ...props.draft, mapping: { fields: next } });
      }} /><span>Required</span></label>
      <button class="ko-button ko-button--small" type="button" disabled={fields.length <= 1} onClick={() => props.setDraft({ ...props.draft, mapping: { fields: fields.filter((_, itemIndex) => itemIndex !== index) } })}>Remove</button>
    </div>)}
    <button class="ko-button ko-button--small" type="button" onClick={() => props.setDraft({ ...props.draft, mapping: { fields: [...fields, { canonical_field: "", source_field: "", fixed_value: null, required: false, transforms: [] }] } })}>Add mapped field</button>
  </section>;
}

function QualificationEditor(props: { draft: Item; setDraft: (draft: Item) => void }) {
  const rules = props.draft.rules as { ordered: Item[]; default_outcome: Item };
  function updateRule(index: number, patch: Item) {
    props.setDraft({ ...props.draft, rules: { ...rules, ordered: rules.ordered.map((rule, itemIndex) => itemIndex === index ? { ...rule, ...patch } : rule) } });
  }
  return <section class="ko-wizard-card"><h4>Ordered qualification rules</h4><p>Rules run top to bottom; the first match decides whether a record is qualified, waiting, ignored, or invalid and how its effective value is calculated.</p>
    {rules.ordered.map((rule, index) => {
      const predicate = rule.predicate as Item;
      const outcome = rule.outcome as Item;
      return <fieldset class="ko-rule-card"><legend>Rule {index + 1}</legend>
        <label>Rule name<input value={String(rule.id ?? "")} onInput={(event) => updateRule(index, { id: event.currentTarget.value })} /></label>
        <label>Match<select value={String(predicate.op ?? "always")} onChange={(event) => {
          const op = event.currentTarget.value;
          updateRule(index, { predicate: op === "always" ? { op } : op === "is_empty" || op === "is_present" ? { op, field: "" } : { op, field: "", value: "" } });
        }}><option value="always">Always</option><option value="equals">Field equals</option><option value="not_equals">Field is not</option><option value="contains">Field contains</option><option value="is_empty">Field is empty</option><option value="is_present">Field is present</option><option value="number_gt">Number greater than</option><option value="number_lt">Number less than</option><option value="date_after">Date after</option><option value="date_before">Date before</option></select></label>
        {predicate.op !== "always" && <label>Canonical field<input value={String(predicate.field ?? "")} onInput={(event) => updateRule(index, { predicate: { ...predicate, field: event.currentTarget.value } })} /></label>}
        {!["always", "is_empty", "is_present"].includes(String(predicate.op)) && <label>Comparison value<input value={String(predicate.value ?? "")} onInput={(event) => updateRule(index, { predicate: { ...predicate, value: event.currentTarget.value } })} /></label>}
        <label>Outcome<select value={String(outcome.status ?? "invalid")} onChange={(event) => {
          const status = event.currentTarget.value;
          updateRule(index, { outcome: status === "qualified" ? { status, effective_value_rule: "actual_payout", value: { kind: "field", field: "payout_amount" } } : defaultOutcome(status) });
        }}><option value="qualified">Qualified</option><option value="waiting">Waiting</option><option value="ignored">Ignored</option><option value="invalid">Invalid</option></select></label>
        {outcome.status === "qualified" && <><label>Value rule<select value={String(outcome.effective_value_rule)} onChange={(event) => {
          const ruleName = event.currentTarget.value;
          const value = ruleName === "fixed_amount" ? { kind: "fixed", amount: "0.0000" } : ruleName === "bid_half" ? { kind: "multiply", field: "bid_amount", factor: "0.5" } : { kind: "field", field: ruleName === "actual_payout" ? "payout_amount" : "bid_amount" };
          updateRule(index, { outcome: { status: "qualified", effective_value_rule: ruleName, value } });
        }}><option value="actual_payout">Actual payout</option><option value="bid_full">Full bid</option><option value="bid_half">Half bid</option><option value="fixed_amount">Fixed amount</option></select></label>
        <label>{(outcome.value as Item)?.kind === "fixed" ? "Fixed amount" : "Value field"}<input value={String((outcome.value as Item)?.amount ?? (outcome.value as Item)?.field ?? "")} onInput={(event) => {
          const value = outcome.value as Item;
          updateRule(index, { outcome: { ...outcome, value: value.kind === "fixed" ? { ...value, amount: event.currentTarget.value } : { ...value, field: event.currentTarget.value } } });
        }} /></label></>}
        <button class="ko-button ko-button--small" type="button" disabled={rules.ordered.length <= 1} onClick={() => props.setDraft({ ...props.draft, rules: { ...rules, ordered: rules.ordered.filter((_, itemIndex) => itemIndex !== index) } })}>Remove rule</button>
      </fieldset>;
    })}
    <button class="ko-button ko-button--small" type="button" onClick={() => props.setDraft({ ...props.draft, rules: { ...rules, ordered: [...rules.ordered, { id: `rule_${rules.ordered.length + 1}`, predicate: { op: "always" }, outcome: defaultOutcome(), on_value_error: null }] } })}>Add rule</button>
    <label class="ko-config-field"><span>Mandatory default outcome</span><select value={String(rules.default_outcome.status)} onChange={(event) => props.setDraft({ ...props.draft, rules: { ...rules, default_outcome: defaultOutcome(event.currentTarget.value) } })}><option value="waiting">Waiting</option><option value="ignored">Ignored</option><option value="invalid">Invalid</option></select><small>Used only when no ordered rule matches.</small></label>
  </section>;
}

function FlowWizard(props: { bootstrapActive: boolean; route: Extract<FlowRoute, { kind: "new" | "detail" }> }) {
  const id = props.route.kind === "detail" ? props.route.id : null;
  const [context, setContext] = useState<ConversionsUiContext | null>(null);
  const [connections, setConnections] = useState<ReadonlyArray<Item>>([]);
  const [runs, setRuns] = useState<ReadonlyArray<Item>>([]);
  const [draft, setDraftState] = useState<Item | null>(null);
  const [flowState, setFlowState] = useState<Item | null>(null);
  const [version, setVersion] = useState(1);
  const [rowVersion, setRowVersion] = useState(0);
  const [step, setStep] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [sampleReference, setSampleReference] = useState("");
  const [patchSampleReferences, setPatchSampleReferences] = useState<Record<number, string>>({});
  const [previews, setPreviews] = useState<Record<string, Item>>({});
  const [publishToken, setPublishToken] = useState("");
  const [draftMutable, setDraftMutable] = useState(true);
  const [lifecycleAction, setLifecycleAction] = useState<"pause" | "resume" | "rollback" | null>(null);
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [rollbackTarget, setRollbackTarget] = useState("1");
  const draftRef = useRef<Item | null>(null);
  const evidenceGeneration = useRef(0);
  const sourceConnections = useMemo(() => connections.filter((item) => item.direction === "source" && item.status !== "archived"), [connections]);
  const destinationConnections = useMemo(() => connections.filter((item) => item.direction === "destination" && item.status !== "archived"), [connections]);
  const canManage = context?.capabilities.includes("flows.manage") === true;
  const canReviewPublish = context?.capabilities.includes("flows.publish") === true;
  const canCommitPublish = canReviewPublish
    && context?.capabilities.includes("ownership.manage") === true;
  const patchInputs = Array.isArray(draft?.patch_inputs) ? draft.patch_inputs as Item[] : [];
  const patchSamplesReady = patchInputs.every((_, index) => UUID.test(patchSampleReferences[index + 1] ?? ""));
  const invalidateEvidence = () => {
    evidenceGeneration.current += 1;
    setPreviews({});
    setPublishToken("");
  };
  const setDraft = (value: Item) => {
    draftRef.current = value;
    setDraftState(value);
    setDirty(true);
    setPatchSampleReferences({});
    invalidateEvidence();
  };

  const load = useCallback(async () => {
    evidenceGeneration.current += 1;
    setState("loading");
    try {
      const [contextPayload, nextConnections, nextRuns] = await Promise.all([
        requestConversionsApi<unknown>("ui.context", "/api/admin/conversions/ui-context"),
        loadCoreCollection("connections.for-flow", "/api/admin/conversions/v1/connections"),
        loadCoreCollection("runs.for-flow", "/api/admin/conversions/v1/runs"),
      ]);
      const nextContext = unwrapConversionsUiContext(contextPayload);
      setContext(nextContext);
      setConnections(nextConnections);
      setRuns(nextRuns);
      if (id === null) {
        const initial = defaultFlowDraft(nextContext, String(nextConnections.find((item) => item.direction === "source")?.connection_id ?? ""));
        draftRef.current = initial;
        setDraftState(initial);
        setDraftMutable(true);
      } else {
        const flowPayload = await requestConversionsApi<unknown>(`flow.read:${id}`, `${FLOWS_PATH}/${id}`);
        const flow = unwrapCoreResult(flowPayload);
        if (!isRecord(flow)) throw new CoreWireError("invalid_response", "The service returned an invalid Flow.");
        setFlowState(flow);
        const latestVersion = typeof flow.latest_version === "number" ? flow.latest_version : 1;
        setRollbackTarget(String(Math.max(1, latestVersion - 1)));
        const draftPayload = await requestConversionsApi<unknown>(`flow.draft.read:${id}:${latestVersion}`, `${FLOWS_PATH}/${id}/drafts/${latestVersion}`);
        const result = unwrapCoreResult(draftPayload);
        if (!isRecord(result)) throw new CoreWireError("invalid_response", "The service returned an invalid Flow draft.");
        const body = exactDraft(result);
        draftRef.current = body;
        setDraftState(body);
        setVersion(latestVersion);
        setRowVersion(Number(result.row_version));
        setDraftMutable(flow.latest_version_status === "draft");
      }
      setPreviews({});
      setPublishToken("");
      setPatchSampleReferences({});
      setDirty(false);
      setState("ready");
      setStatus("");
    } catch (error) {
      setStatus(message(error));
      setState("error");
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function persist({ navigate = false } = {}) {
    const current = draftRef.current;
    if (current === null || saving || !canManage || !draftMutable) return false;
    setSaving(true);
    setStatus("Saving draft…");
    try {
      const payload = await requestConversionsApi<unknown>(
        id === null ? `flow.create:${String(current.name)}` : `flow.autosave:${id}:${version}`,
        id === null ? FLOWS_PATH : `${FLOWS_PATH}/${id}/drafts/${version}`,
        { method: id === null ? "POST" : "PATCH", body: id === null ? current : { row_version: rowVersion, ...current } },
      );
      const result = unwrapCoreResult(payload);
      if (!isRecord(result) || typeof result.flow_id !== "string") throw new CoreWireError("invalid_response", "The service returned an invalid Flow save.");
      if (id === null) {
        setDirty(false);
        setStatus("Draft saved.");
        window.location.assign(`/admin/conversions/flows/${result.flow_id}`);
        return true;
      }
      if (typeof result.row_version === "number") setRowVersion(result.row_version);
      const savedCurrentDraft = draftRef.current === current;
      if (savedCurrentDraft) {
        setDirty(false);
        setStatus("Draft saved.");
        if (navigate) setStep((value) => Math.min(value + 1, STEPS.length - 1));
      } else {
        setDirty(true);
        setStatus("Earlier edits saved; saving your latest changes…");
      }
      return true;
    } catch (error) {
      setStatus(message(error));
      return false;
    } finally {
      setSaving(false);
    }
  }
  useEffect(() => {
    if (id === null || !dirty || saving || !canManage || !draftMutable) return;
    const timer = window.setTimeout(() => { void persist(); }, 1_000);
    return () => window.clearTimeout(timer);
  }, [canManage, dirty, draftMutable, id, saving, rowVersion, version]);

  async function createNextDraft() {
    const current = draftRef.current;
    if (id === null || current === null || saving || !canManage || draftMutable) return;
    setSaving(true);
    setStatus("Creating a new immutable draft version…");
    try {
      const payload = await requestConversionsApi<unknown>(
        `flow.draft.create:${id}:${version + 1}`,
        `${FLOWS_PATH}/${id}/drafts`,
        { method: "POST", body: current },
      );
      const result = unwrapCoreResult(payload);
      if (!isRecord(result) || typeof result.version !== "number"
          || typeof result.row_version !== "number") {
        throw new CoreWireError("invalid_response", "The service returned an invalid Flow draft.");
      }
      setVersion(result.version);
      setRowVersion(result.row_version);
      setDraftMutable(true);
      setDirty(false);
      setPatchSampleReferences({});
      invalidateEvidence();
      setStatus(`Draft version ${result.version} created.`);
    } catch (error) {
      setStatus(message(error));
    } finally {
      setSaving(false);
    }
  }

  async function preview(kind: "source-preview" | "rule-preview" | "destination-preview") {
    if (id === null || !UUID.test(sampleReference) || !patchSamplesReady
        || dirty || !canManage || !draftMutable) return;
    const generation = evidenceGeneration.current;
    setSaving(true);
    try {
      const payload = await requestConversionsApi<unknown>(`flow.${kind}:${id}:${version}`, `${FLOWS_PATH}/${id}/drafts/${version}/${kind}`, {
        method: "POST",
        body: {
          draft_row_version: rowVersion,
          sample_reference: sampleReference,
          patch_sample_references: patchInputs.map((_, index) => ({
            input_ordinal: index + 1,
            sample_reference: patchSampleReferences[index + 1],
          })),
          requested_sample_count: 25,
        },
      });
      if (generation !== evidenceGeneration.current) return;
      const result = unwrapCoreResult(payload);
      if (!isRecord(result) || typeof result.preview_hash !== "string"
          || result.evaluation_status !== "evaluated"
          || result.production_effects !== false) {
        throw new CoreWireError("invalid_response", "The service returned an invalid preview.");
      }
      setPreviews((current) => ({ ...current, [kind]: result }));
      setStatus(`${kind.replace("-", " ")} evaluated the archived sample with no production effects.`);
    } catch (error) {
      if (generation === evidenceGeneration.current) setStatus(message(error));
    } finally {
      setSaving(false);
    }
  }
  async function reviewPublish() {
    if (id === null || dirty || !canReviewPublish || !draftMutable) return;
    const generation = evidenceGeneration.current;
    setSaving(true);
    try {
      const payload = await requestConversionsApi<unknown>(`flow.publish-preview:${id}:${version}`, `${FLOWS_PATH}/${id}/drafts/${version}/publish-preview`, {
        method: "POST",
        body: {
          draft_row_version: rowVersion,
          source_preview_hash: String(previews["source-preview"]?.preview_hash ?? ""),
          rule_preview_hash: String(previews["rule-preview"]?.preview_hash ?? ""),
          destination_preview_hash: String(previews["destination-preview"]?.preview_hash ?? ""),
        },
      });
      if (generation !== evidenceGeneration.current) return;
      const result = unwrapCoreResult(payload);
      if (!isRecord(result) || !["ready", "blocked"].includes(String(result.decision))
          || (result.decision === "ready" && typeof result.preview_token !== "string")
          || (result.decision === "blocked" && result.preview_token !== null)
          || result.production_effects !== false) {
        throw new CoreWireError("invalid_response", "The service returned an invalid publish review.");
      }
      setPreviews((current) => ({ ...current, "publish-preview": result }));
      setPublishToken(result.decision === "ready" ? String(result.preview_token) : "");
      setStatus(result.decision === "ready"
        ? "Ownership and publish review is current for this exact draft."
        : "Publish review found blockers. Resolve them and run all previews again.");
    } catch (error) {
      if (generation === evidenceGeneration.current) setStatus(message(error));
    } finally {
      setSaving(false);
    }
  }
  async function publish() {
    if (id === null || publishToken === "" || !canCommitPublish || !draftMutable) return;
    setSaving(true);
    try {
      await requestConversionsApi(`flow.publish:${id}:${version}`, `${FLOWS_PATH}/${id}/drafts/${version}/publish`, {
        method: "POST", body: { preview_token: publishToken, reason: "operator_publish" },
      });
      await load();
      setStatus("Flow published disabled-first and paused.");
    } catch (error) {
      setStatus(message(error));
    } finally {
      setSaving(false);
    }
  }

  async function applyLifecycleAction() {
    if (id === null || lifecycleAction === null || saving || !canReviewPublish
        || !SAFE_REASON.test(lifecycleReason)) return;
    const targetVersion = Number(rollbackTarget);
    if (lifecycleAction === "rollback"
        && (!Number.isSafeInteger(targetVersion) || targetVersion < 1)) return;
    setSaving(true);
    setStatus(`${lifecycleAction === "pause" ? "Pausing" : lifecycleAction === "resume" ? "Resuming" : "Rolling back"} Flow…`);
    try {
      const body = lifecycleAction === "rollback"
        ? { row_version: rowVersion, target_version: targetVersion, reason: lifecycleReason }
        : { row_version: rowVersion, reason: lifecycleReason };
      const payload = await requestConversionsApi<unknown>(
        `flow.${lifecycleAction}:${id}:${rowVersion}`,
        `${FLOWS_PATH}/${id}/${lifecycleAction}`,
        { method: "POST", body },
      );
      const result = unwrapCoreResult(payload);
      if (!isRecord(result) || !["active", "paused"].includes(String(result.status))
          || typeof result.row_version !== "number") {
        throw new CoreWireError("invalid_response", "The service returned an invalid Flow lifecycle result.");
      }
      const success = lifecycleAction === "resume"
        ? "Flow is active after current readiness checks."
        : lifecycleAction === "rollback"
          ? "Flow rolled back disabled-first and remains paused."
          : "Flow is paused and pending deliveries were cancelled where still withdrawable.";
      setLifecycleAction(null);
      setLifecycleReason("");
      await load();
      setStatus(success);
    } catch (error) {
      setStatus(message(error));
    } finally {
      setSaving(false);
    }
  }

  function renderStep() {
    if (draft === null || context === null) return null;
    const primary = draft.primary_config as Item;
    const precedence = primary.precedence as Item;
    const normalization = draft.normalization as { fields: Item[] };
    const time = draft.time as Item;
    const currency = draft.currency as Item;
    const internal = draft.internal_outputs as Item;
    if (step === 0) return <section class="ko-wizard-card"><h4>What business conversion does this Flow represent?</h4><div class="ko-config-grid">
      <label class="ko-config-field"><span>Name</span><input required value={String(draft.name)} onInput={(event) => setDraft({ ...draft, name: event.currentTarget.value })} /><small>Operator-facing Flow name.</small></label>
      <label class="ko-config-field"><span>Description</span><textarea rows={3} value={String(draft.description ?? "")} onInput={(event) => setDraft({ ...draft, description: event.currentTarget.value })} /><small>Purpose and owner notes.</small></label>
      <label class="ko-config-field"><span>Product scope</span><select value={String(draft.product_scope)} onChange={(event) => setDraft({ ...draft, product_scope: event.currentTarget.value })}><option value="both">Listicles and LeadGen</option><option value="listicles">Listicles</option><option value="leadgen">LeadGen</option></select><small>Which product facts this Flow may create.</small></label>
      <label class="ko-config-field"><span>Activity label</span><input value={String(draft.activity_label)} onInput={(event) => setDraft({ ...draft, activity_label: event.currentTarget.value })} /><small>Versioned label shown in reporting.</small></label>
      <label class="ko-config-field"><span>Vertical label</span><input value={String(draft.vertical_label)} onInput={(event) => setDraft({ ...draft, vertical_label: event.currentTarget.value })} /><small>Versioned label shown in reporting.</small></label>
      <label class="ko-config-field"><span>Offer scope</span><select value={String((draft.offer_scope as Item).type)} onChange={(event) => setDraft({ ...draft, offer_scope: { type: event.currentTarget.value, value: event.currentTarget.value === "all" ? "all" : "" } })}><option value="all">All offers</option><option value="offer">One namespaced offer</option><option value="offer_group">One offer group</option></select><small>Publishing later claims this scope for each selected output.</small></label>
      {(draft.offer_scope as Item).type !== "all" && <label class="ko-config-field"><span>Offer or group reference</span><input value={String((draft.offer_scope as Item).value)} onInput={(event) => setDraft({ ...draft, offer_scope: { ...(draft.offer_scope as Item), value: event.currentTarget.value } })} /><small>Use the current CMS namespaced stable reference.</small></label>}
    </div></section>;
    if (step === 1) return <section class="ko-wizard-card"><h4>Choose the primary source</h4><p>The primary source owns initial event state. Patch sources cannot create or erase unowned identity.</p><div class="ko-config-grid">
      <label class="ko-config-field"><span>Source Connection</span><select value={String(draft.primary_connection_id)} onChange={(event) => setDraft({ ...draft, primary_connection_id: event.currentTarget.value })}><option value="">Select a source</option>{sourceConnections.map((connection) => <option value={String(connection.connection_id)}>{text(connection, "name")} · {text(connection, "adapter_type")}</option>)}</select><small>Only non-archived source Connections are shown.</small></label>
      <label class="ko-config-field"><span>Business version column</span><input value={String(precedence.business_version_field ?? "")} onInput={(event) => setDraft({ ...draft, primary_config: { ...primary, precedence: { ...precedence, business_version_field: event.currentTarget.value || null, business_version_kind: event.currentTarget.value ? "integer" : "none" } } })} /><small>Optional reliable source version used before received time.</small></label>
      <label class="ko-config-field"><span>Business version type</span><select value={String(precedence.business_version_kind)} onChange={(event) => setDraft({ ...draft, primary_config: { ...primary, precedence: { ...precedence, business_version_kind: event.currentTarget.value, business_version_field: event.currentTarget.value === "none" ? null : precedence.business_version_field || "version" } } })}><option value="none">None</option><option value="integer">Integer</option><option value="timestamp">Timestamp</option></select><small>Defines deterministic source precedence.</small></label>
      <label class="ko-config-field"><span>Input priority</span><input type="number" min={0} max={10_000} value={String(precedence.input_priority)} onInput={(event) => setDraft({ ...draft, primary_config: { ...primary, precedence: { ...precedence, input_priority: Number(event.currentTarget.value) } } })} /><small>Used only after explicit ownership and business version.</small></label>
    </div>{sourceConnections.length === 0 && <p class="ko-inline-error">Create and safely test a source Connection first.</p>}</section>;
    if (step === 2) {
      const eligibleRuns = runs.filter((run) => run.preview_sample_ready === true
        && (run.connection_id === draft.primary_connection_id || run.flow_id === id));
      return <section class="ko-wizard-card"><h4>Select archived real data</h4><p>Preview reads only the exact immutable archived sample, verifies its manifest and parser context, and evaluates this saved draft without creating events, reports, dashboard rows, deliveries, or external requests.</p>
        <label class="ko-config-field"><span>Archived sample</span><select value={sampleReference} onChange={(event) => {
          setSampleReference(event.currentTarget.value);
          invalidateEvidence();
          setStatus("Archived sample changed. Run every preview again.");
        }}><option value="">Select a recent source run</option>{eligibleRuns.map((run) => <option value={String(run.run_id)}>{text(run, "started_at")} · {text(run, "status")}</option>)}</select><small>A recent run is the bounded source-sample reference; changing it invalidates every prior preview and publish review.</small></label>
        {patchInputs.map((patch, index) => {
          const patchRuns = runs.filter((run) => run.preview_sample_ready === true
            && run.connection_id === patch.connection_id);
          return <label class="ko-config-field"><span>Patch input {index + 1} archived sample</span><select value={patchSampleReferences[index + 1] ?? ""} onChange={(event) => {
            const value = event.currentTarget.value;
            setPatchSampleReferences((current) => ({ ...current, [index + 1]: value }));
            invalidateEvidence();
            setStatus("Patch sample changed. Run every preview again.");
          }}><option value="">Select a recent patch-source run</option>{patchRuns.map((run) => <option value={String(run.run_id)}>{text(run, "started_at")} · {text(run, "status")}</option>)}</select><small>This immutable sample is evaluated in patch-input order after the primary sample.</small></label>;
        })}
        <button class="ko-button" type="button" disabled={id === null || dirty || !UUID.test(sampleReference) || !patchSamplesReady || saving} onClick={() => void preview("source-preview")}>Preview source</button>
        {id === null && <p class="ko-disabled-reason">Save the initial draft before previewing.</p>}{dirty && <p class="ko-disabled-reason">Wait for autosave or click Save draft before previewing.</p>}{eligibleRuns.length === 0 && <p class="ko-disabled-reason">No archived source run is available for this Connection yet.</p>}
        {previews["source-preview"] && <PreviewResult value={previews["source-preview"]} />}
      </section>;
    }
    if (step === 3) return <section class="ko-wizard-card"><h4>Define stable event identity</h4><p>These ordered canonical fields identify one logical conversion across snapshots, patches, and credential replacement. Changing them after publication creates a new identity namespace and requires migration review.</p><div class="ko-config-grid">
      <label class="ko-config-field"><span>Identity namespace</span><input value={String(draft.identity_namespace)} onInput={(event) => setDraft({ ...draft, identity_namespace: event.currentTarget.value })} /><small>Stable namespace for this logical source contract.</small></label>
      <StringListEditor label="Ordered identity fields" help="One to eight canonical fields; order is significant." values={draft.identity_fields as string[]} onChange={(values) => setDraft({ ...draft, identity_fields: values })} />
    </div><h4>Source normalization</h4>{normalization.fields.map((field, index) => <div class="ko-field-pair"><label>Source column<input value={String(field.source_field)} onInput={(event) => setDraft({ ...draft, normalization: { fields: normalization.fields.map((item, itemIndex) => itemIndex === index ? { ...item, source_field: event.currentTarget.value } : item) } })} /></label><label>Transforms<input value={(field.transforms as Item[]).map((item) => item.op).join(", ")} onInput={(event) => setDraft({ ...draft, normalization: { fields: normalization.fields.map((item, itemIndex) => itemIndex === index ? { ...item, transforms: event.currentTarget.value.split(",").map((value) => value.trim()).filter(Boolean).map((op) => ({ op })) } : item) } })} /></label></div>)}
      <button class="ko-button ko-button--small" type="button" onClick={() => setDraft({ ...draft, normalization: { fields: [...normalization.fields, { source_field: "", transforms: [] }] } })}>Add normalized source field</button>
    </section>;
    if (step === 4) return <QualificationEditor draft={draft} setDraft={setDraft} />;
    if (step === 5) return <><MappingEditor draft={draft} setDraft={setDraft} /><section class="ko-wizard-card"><h4>Time and currency</h4><div class="ko-config-grid">
      <label class="ko-config-field"><span>Occurred-at canonical field</span><input value={String(time.occurred_at_field)} onInput={(event) => setDraft({ ...draft, time: { ...time, occurred_at_field: event.currentTarget.value } })} /><small>Must be populated by mapping; current time is never substituted.</small></label>
      <label class="ko-config-field"><span>Input time format</span><input value={String(time.input_format)} onInput={(event) => setDraft({ ...draft, time: { ...time, input_format: event.currentTarget.value } })} /><small>Exact approved timestamp format.</small></label>
      <label class="ko-config-field"><span>Source time zone</span><input value={String(time.timezone)} onInput={(event) => setDraft({ ...draft, time: { ...time, timezone: event.currentTarget.value } })} /><small>IANA source time zone.</small></label>
      <label class="ko-config-field"><span>Reporting currency</span><output>{String(currency.reporting_currency)}</output><small>Inherited from permanent workspace authority.</small></label>
      <label class="ko-config-field"><span>Source currency column</span><input value={String(currency.source_currency_field ?? "")} onInput={(event) => setDraft({ ...draft, currency: { ...currency, source_currency_field: event.currentTarget.value || null, fixed_source_currency: event.currentTarget.value ? null : context.reportingCurrency } })} /><small>Leave blank to use the fixed workspace currency.</small></label>
      <label class="ko-config-field"><span>Conversion policy</span><select value={String(currency.conversion_policy)} onChange={(event) => setDraft({ ...draft, currency: { ...currency, conversion_policy: event.currentTarget.value } })}><option value="same_currency_only">Reject different currency</option><option value="daily_reporting_date_rate">Convert using reporting-date rate</option></select><small>Money never silently becomes zero. Foreign-currency rows block publish until the required reporting-date rates are available.</small></label>
    </div></section></>;
    if (step === 6) {
      const patches = draft.patch_inputs as Item[];
      return <section class="ko-wizard-card"><h4>Optional patch inputs</h4><p>Each patch declares one exact match key, its own stable row identity, fields it owns, explicit-null permission, and deterministic precedence.</p>{patches.map((patch, index) => {
        const adapterConfig = patch.adapter_config as Item;
        const patchPrecedence = adapterConfig.precedence as Item;
        const matching = patch.matching_key as Item;
        const sourceIdentity = patch.source_identity as Item;
        return <fieldset class="ko-rule-card"><legend>Patch input {index + 1}</legend>
          <label>Source Connection<select value={String(patch.connection_id)} onChange={(event) => setDraft({ ...draft, patch_inputs: patches.map((item, itemIndex) => itemIndex === index ? { ...item, connection_id: event.currentTarget.value } : item) })}>{sourceConnections.map((connection) => <option value={String(connection.connection_id)}>{text(connection, "name")}</option>)}</select></label>
          <label>Operation<select value={String(patch.operation)} onChange={(event) => setDraft({ ...draft, patch_inputs: patches.map((item, itemIndex) => itemIndex === index ? { ...item, operation: event.currentTarget.value } : item) })}><option value="patch">Patch existing event only</option><option value="upsert" disabled>Upsert unavailable until semantic proof is composed</option></select><small>Existing upsert drafts remain visible but cannot pass publish review.</small></label>
          <label>Match-key name<input value={String(matching.name)} onInput={(event) => setDraft({ ...draft, patch_inputs: patches.map((item, itemIndex) => itemIndex === index ? { ...item, matching_key: { ...matching, name: event.currentTarget.value } } : item) })} /></label>
          <label>Patch source match column<input value={String(matching.source_field)} onInput={(event) => setDraft({ ...draft, patch_inputs: patches.map((item, itemIndex) => itemIndex === index ? { ...item, matching_key: { ...matching, source_field: event.currentTarget.value } } : item) })} /></label>
          <label>Canonical match field<input value={String(matching.canonical_field)} onInput={(event) => setDraft({ ...draft, patch_inputs: patches.map((item, itemIndex) => itemIndex === index ? { ...item, matching_key: { ...matching, canonical_field: event.currentTarget.value } } : item) })} /></label>
          <StringListEditor label="Stable patch-row ID fields" help="Identifies one patch source row." values={sourceIdentity.stable_row_id_fields as string[]} onChange={(values) => setDraft({ ...draft, patch_inputs: patches.map((item, itemIndex) => itemIndex === index ? { ...item, source_identity: { stable_row_id_fields: values } } : item) })} />
          <StringListEditor label="Owned canonical fields" help="Patch cannot change identity, source record ID, or occurred-at." values={patch.owned_fields as string[]} onChange={(values) => setDraft({ ...draft, patch_inputs: patches.map((item, itemIndex) => itemIndex === index ? { ...item, owned_fields: values } : item) })} />
          <StringListEditor label="Explicit-null fields" help="Must be a subset of owned fields." values={patch.explicit_null_fields as string[]} onChange={(values) => setDraft({ ...draft, patch_inputs: patches.map((item, itemIndex) => itemIndex === index ? { ...item, explicit_null_fields: values } : item) })} />
          <label>Business version column<input value={String(patchPrecedence.business_version_field ?? "")} onInput={(event) => setDraft({ ...draft, patch_inputs: patches.map((item, itemIndex) => itemIndex === index ? { ...item, adapter_config: { ...adapterConfig, precedence: { ...patchPrecedence, business_version_field: event.currentTarget.value || null, business_version_kind: event.currentTarget.value ? "integer" : "none" } } } : item) })} /></label>
          <button class="ko-button ko-button--small" type="button" onClick={() => setDraft({ ...draft, patch_inputs: patches.filter((_, itemIndex) => itemIndex !== index) })}>Remove patch input</button>
        </fieldset>;
      })}<button class="ko-button ko-button--small" type="button" disabled={patches.length >= 3 || sourceConnections.length === 0} onClick={() => setDraft({ ...draft, patch_inputs: [...patches, {
        connection_id: String(sourceConnections[0]?.connection_id ?? ""),
        adapter_config: { input_ordinal: patches.length + 1, precedence: { business_version_field: null, business_version_kind: "none", input_priority: 90 - patches.length }, mapping: { fields: [{ canonical_field: "payout_amount", source_field: "payout", fixed_value: null, required: false, transforms: [{ op: "decimal" }] }] } },
        matching_key: { name: "click_id", source_field: "click_id", canonical_field: "click_id", transforms: [{ op: "trim" }] },
        source_identity: { stable_row_id_fields: ["id"] },
        owned_fields: ["payout_amount"], operation: "patch", explicit_null_fields: [],
      }] })}>Add patch input</button></section>;
    }
    if (step === 7) {
      const destinations = draft.destinations as Item[];
      return <section class="ko-wizard-card"><h4>Internal outputs</h4><div class="ko-output-options">
        <label class="ko-checkbox"><input type="checkbox" checked disabled /><span>Canonical storage (required)</span></label>
        <label class="ko-checkbox"><input type="checkbox" checked={internal.reporting === true} onChange={(event) => setDraft({ ...draft, internal_outputs: { ...internal, reporting: event.currentTarget.checked } })} /><span>Reporting</span></label>
        <label class="ko-checkbox"><input type="checkbox" checked={internal.dashboard === true} onChange={(event) => setDraft({ ...draft, internal_outputs: { ...internal, dashboard: event.currentTarget.checked, dashboard_revenue: event.currentTarget.checked ? internal.dashboard_revenue : false } })} /><span>Dashboard conversion overlay</span></label>
        <label class="ko-checkbox"><input type="checkbox" checked={internal.dashboard_revenue === true} disabled={internal.dashboard !== true} onChange={(event) => setDraft({ ...draft, internal_outputs: { ...internal, dashboard_revenue: event.currentTarget.checked } })} /><span>Dashboard revenue overlay</span></label>
      </div><h4>External destinations</h4><p>Each selected destination starts disabled. Preview shows the redacted payload, native identity, age-window decision, fan-out, and retry dedupe safety before publish.</p>
      {destinations.map((destination, index) => <fieldset class="ko-rule-card"><legend>Destination {index + 1}</legend>
        <label>Destination Connection<select value={String(destination.connection_id)} onChange={(event) => setDraft({ ...draft, destinations: destinations.map((item, itemIndex) => itemIndex === index ? { ...item, connection_id: event.currentTarget.value } : item) })}>{destinationConnections.map((connection) => <option value={String(connection.connection_id)}>{text(connection, "name")} · {text(connection, "adapter_type")}</option>)}</select></label>
        <label class="ko-checkbox"><input type="checkbox" checked={destination.enabled === true} onChange={(event) => setDraft({ ...draft, destinations: destinations.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: event.currentTarget.checked } : item) })} /><span>Eligible after publish and control activation</span></label>
        <label>Provider event name<input value={String((destination.mapping as Item).event_name)} onInput={(event) => setDraft({ ...draft, destinations: destinations.map((item, itemIndex) => itemIndex === index ? { ...item, mapping: { ...(item.mapping as Item), event_name: event.currentTarget.value } } : item) })} /></label>
        <label>Maximum event age seconds<input type="number" value={String((destination.delivery_policy as Item).maximum_age_seconds)} onInput={(event) => setDraft({ ...draft, destinations: destinations.map((item, itemIndex) => itemIndex === index ? { ...item, delivery_policy: { ...(item.delivery_policy as Item), maximum_age_seconds: Number(event.currentTarget.value) } } : item) })} /></label>
        <button class="ko-button ko-button--small" type="button" onClick={() => setDraft({ ...draft, destinations: destinations.filter((_, itemIndex) => itemIndex !== index) })}>Remove destination</button>
      </fieldset>)}
      <button class="ko-button ko-button--small" type="button" disabled={destinationConnections.length === 0 || destinations.length >= 6} onClick={() => setDraft({ ...draft, destinations: [...destinations, {
        connection_id: String(destinationConnections[0]?.connection_id ?? ""),
        enabled: false,
        event_filter: { qualification_statuses: ["qualified"], required_fields: ["event_id", "occurred_at"] },
        mapping: {
          event_name: "Purchase", event_id_field: "event_id", event_time_field: "occurred_at",
          value_field: "effective_value", currency_field: "currency", click_id_field: "click_id",
          source_url_field: null, action_source: "website", query_templates: [], header_templates: [], body_template: null,
        },
        delivery_policy: {
          batch_size: 100, maximum_attempts: 12, maximum_age_seconds: 604800,
          retry_profile: "bounded_24h", unknown_outcome_policy: "hold_for_review", dedupe_mode: "provider_native",
        },
      }] })}>Add destination</button>{destinationConnections.length === 0 && <p class="ko-disabled-reason">Create and test a destination Connection first.</p>}</section>;
    }
    if (step === 8) return <section class="ko-wizard-card"><h4>Side-effect-free rule and destination proof</h4><p>These previews evaluate the same archived sample through the rule engine and pure destination engine. They expose identity, arithmetic, suppression, fan-out, age, and dedupe readiness while preparing no dispatch and making no external request.</p>
      <div class="ko-button-row"><button class="ko-button" type="button" disabled={id === null || dirty || !UUID.test(sampleReference) || !patchSamplesReady || saving} onClick={() => void preview("rule-preview")}>Preview rules</button><button class="ko-button" type="button" disabled={id === null || dirty || !UUID.test(sampleReference) || !patchSamplesReady || saving} onClick={() => void preview("destination-preview")}>Preview destinations</button></div>
      {(!UUID.test(sampleReference) || !patchSamplesReady) && <p class="ko-disabled-reason">Return to Preview real data and select every required archived sample.</p>}
      {previews["rule-preview"] && <PreviewResult value={previews["rule-preview"]} />}{previews["destination-preview"] && <PreviewResult value={previews["destination-preview"]} />}
    </section>;
    const review = previews["publish-preview"];
    const allPreviews = ["source-preview", "rule-preview", "destination-preview"].every((key) => typeof previews[key]?.preview_hash === "string");
    return <section class="ko-wizard-card"><h4>Ownership review and publish</h4><p>An authoritative review must evaluate the exact archived sample, ownership, readiness, count/value arithmetic, suppression, and fan-out before it can issue a publish token.</p>
      <button class="ko-button" type="button" disabled={!allPreviews || dirty || saving || id === null || !canReviewPublish || !draftMutable} onClick={() => void reviewPublish()}>Review publish</button>
      {!allPreviews && <p class="ko-disabled-reason">Complete source, rule, and destination previews first.</p>}
      {!canReviewPublish && <p class="ko-disabled-reason">You do not have the flows.publish capability required for publish review.</p>}
      {review && <><dl class="ko-test-result"><dt>Decision</dt><dd>{text(review, "decision")}</dd><dt>Ownership scopes</dt><dd>{text(review, "ownership_scope_count")}</dd><dt>Ownership conflicts</dt><dd>{text(review, "ownership_conflict_count")}</dd><dt>Blockers</dt><dd>{Array.isArray(review.blockers) ? review.blockers.length : "—"}</dd><dt>Warnings</dt><dd>{Array.isArray(review.warnings) ? review.warnings.length : "—"}</dd><dt>Expires</dt><dd>{text(review, "expires_at")}</dd></dl>
        {Array.isArray(review.blockers) && review.blockers.length > 0 && <p class="ko-inline-error">Blocked: {review.blockers.map(String).join(", ")}</p>}
        {Array.isArray(review.warnings) && review.warnings.length > 0 && <p class="ko-disabled-reason">Warnings: {review.warnings.map(String).join(", ")}</p>}</>}
      <button class="ko-button ko-button--primary" type="button" disabled={publishToken === "" || saving || !canCommitPublish || !draftMutable} onClick={() => void publish()}>Publish exact reviewed draft</button>
      {publishToken === "" && <p class="ko-disabled-reason">A current successful publish review is required.</p>}
      {canReviewPublish && !canCommitPublish && <p class="ko-disabled-reason">Publishing also requires the ownership.manage capability.</p>}
    </section>;
  }

  return <ShellFrame section="flows" bootstrapActive={props.bootstrapActive}>
    <div class="ko-detail-header"><a href="/admin/conversions/flows">← All Flows</a><h3>{draft ? String(draft.name || "New Flow") : "Flow"}</h3><p>Ten contract steps from reusable source transport to immutable published conversion logic.</p></div>
    {state === "loading" && <div class="ko-loading" role="status" aria-busy="true"><span class="ko-spinner" />Loading Flow wizard…</div>}
    {state === "error" && <div class="ko-conversions-state ko-conversions-state--error" role="alert"><h3>Unable to load</h3><p>{status}</p><button class="ko-button" type="button" onClick={() => void load()}>Try again</button></div>}
    {state === "ready" && flowState !== null && ["active", "paused"].includes(String(flowState.status)) && <section class="ko-config-section" aria-labelledby="flow-lifecycle-heading">
      <h3 id="flow-lifecycle-heading">Flow lifecycle</h3>
      <p>Current state: <strong>{text(flowState, "status")}</strong>. Publish and rollback are disabled-first; resume rechecks the emergency stop, exact ownership claims, destination configuration, test status, and dedupe readiness.</p>
      <dl class="ko-test-result"><dt>Active version ID</dt><dd>{text(flowState, "active_version_id")}</dd><dt>Flow row version</dt><dd>{rowVersion}</dd></dl>
      <div class="ko-button-row">
        {flowState.status === "active" && <button class="ko-button ko-button--danger" type="button" disabled={saving || !canReviewPublish} onClick={() => { setLifecycleReason("operator_pause"); setLifecycleAction("pause"); }}>Pause Flow</button>}
        {flowState.status === "paused" && <button class="ko-button ko-button--primary" type="button" disabled={saving || !canReviewPublish || props.bootstrapActive} onClick={() => { setLifecycleReason("operator_resume"); setLifecycleAction("resume"); }}>Resume Flow</button>}
        {Number(flowState.latest_version) > 1 && <button class="ko-button" type="button" disabled={saving || !canReviewPublish || props.bootstrapActive} onClick={() => { setLifecycleReason("operator_rollback"); setLifecycleAction("rollback"); }}>Rollback Flow</button>}
      </div>
      {!canReviewPublish && <p class="ko-disabled-reason">You do not have the flows.publish capability required for Flow lifecycle actions.</p>}
      {props.bootstrapActive && <p class="ko-disabled-reason">Resume and rollback require permanent operator authority. Safe pause remains available.</p>}
    </section>}
    {state === "ready" && draft && <div class="ko-flow-wizard">
      <nav class="ko-step-rail" aria-label="Flow steps"><ol>{STEPS.map((label, index) => <li><button type="button" aria-current={step === index ? "step" : undefined} onClick={() => setStep(index)}><span>{index + 1}</span>{label}</button></li>)}</ol></nav>
      <main class="ko-step-content"><div class="ko-current-step"><span>Step {step + 1} of {STEPS.length}</span><h3>{STEPS[step]}</h3></div>
        {!draftMutable && <div class="ko-conversions-state"><h3>Published version {version} is immutable</h3><p>Create a new draft version before changing this Flow.</p><button class="ko-button ko-button--primary" type="button" disabled={saving || !canManage} onClick={() => void createNextDraft()}>Create new draft version</button>{!canManage && <p class="ko-disabled-reason">You do not have the flows.manage capability.</p>}</div>}
        {draftMutable && !canManage && step !== STEPS.length - 1 && <p class="ko-disabled-reason">This draft is read-only because you do not have the flows.manage capability.</p>}
        <fieldset class="ko-wizard-step-fieldset" disabled={saving || !draftMutable || (step !== STEPS.length - 1 && !canManage)}>{renderStep()}</fieldset>
        <div class="ko-wizard-actions"><button class="ko-button" type="button" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>Back</button><button class="ko-button ko-button--primary" type="button" disabled={saving || !draftMutable || !canManage || String(draft.name).trim() === "" || String(draft.primary_connection_id) === ""} onClick={() => void persist({ navigate: true })}>{saving ? "Saving…" : step === STEPS.length - 1 ? "Save draft" : "Save and continue"}</button><span role="status" aria-live="polite">{status}{dirty ? " Unsaved changes." : ""}</span></div>
      </main>
    </div>}
    {lifecycleAction !== null && <div class="ko-modal-backdrop" role="presentation">
      <section class="ko-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="flow-lifecycle-dialog-title">
        <h3 id="flow-lifecycle-dialog-title">Confirm Flow {lifecycleAction}</h3>
        {lifecycleAction === "pause" && <p>This stops new runs and atomically cancels pending or retry-wait deliveries. Attempts already started and successful side effects remain historical.</p>}
        {lifecycleAction === "resume" && <p>This can enable production Flow execution only after the server rechecks the global emergency stop, exact active ownership, and every current destination fact.</p>}
        {lifecycleAction === "rollback" && <><p>This replaces the active version and ownership claims but leaves the Flow paused. Resume is a separate, freshly checked action.</p>
          <label class="ko-config-field"><span>Published target version</span><input type="number" min={1} max={Math.max(1, Number(flowState?.latest_version ?? 1))} value={rollbackTarget} onInput={(event) => setRollbackTarget(event.currentTarget.value)} /></label></>}
        <label class="ko-config-field"><span>Audit reason code</span><input value={lifecycleReason} pattern="[a-z][a-z0-9_.:-]{0,127}" onInput={(event) => setLifecycleReason(event.currentTarget.value)} /></label>
        <div class="ko-button-row">
          <button class={`ko-button${lifecycleAction === "pause" ? " ko-button--danger" : " ko-button--primary"}`} type="button" disabled={saving || !SAFE_REASON.test(lifecycleReason) || (lifecycleAction === "rollback" && (!Number.isSafeInteger(Number(rollbackTarget)) || Number(rollbackTarget) < 1))} onClick={() => void applyLifecycleAction()}>Confirm {lifecycleAction}</button>
          <button class="ko-button" type="button" disabled={saving} onClick={() => { setLifecycleAction(null); setLifecycleReason(""); }}>Cancel</button>
        </div>
      </section>
    </div>}
  </ShellFrame>;
}

function PreviewResult(props: { value: Item }) {
  return <><p class="ko-disabled-reason">Side-effect-free archived-sample evaluation. Dispatch prepared: {text(props.value, "dispatch_prepared_count")}; external requests: {text(props.value, "external_requests_made")}.</p><dl class="ko-preview-summary"><dt>Seen</dt><dd>{text(props.value, "seen")}</dd><dt>Qualified</dt><dd>{text(props.value, "qualified")}</dd><dt>Waiting</dt><dd>{text(props.value, "waiting")}</dd><dt>Ignored</dt><dd>{text(props.value, "ignored")}</dd><dt>Invalid</dt><dd>{text(props.value, "invalid")}</dd><dt>Duplicate</dt><dd>{text(props.value, "duplicate")}</dd><dt>Ambiguous</dt><dd>{text(props.value, "ambiguous")}</dd><dt>Conflicts</dt><dd>{text(props.value, "conflict")}</dd><dt>Effective value</dt><dd>{text(props.value, "effective_value")}</dd>{props.value.destination_evaluation_status === "evaluated" && <><dt>Destinations ready</dt><dd>{text(props.value, "destination_ready_count")} / {text(props.value, "destination_count")}</dd><dt>Fan-out</dt><dd>{text(props.value, "fanout_count")}</dd><dt>Suppressed</dt><dd>{text(props.value, "suppression_count")}</dd></>}</dl></>;
}

export function FlowsApp(props: { bootstrapActive: boolean }) {
  const route = flowRoute();
  return route.kind === "list"
    ? <FlowsList bootstrapActive={props.bootstrapActive} />
    : <FlowWizard bootstrapActive={props.bootstrapActive} route={route} />;
}
