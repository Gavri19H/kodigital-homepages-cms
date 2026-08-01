import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { ConversionsApiError, requestConversionsApi } from "./api-client";
import {
  CoreWireError,
  isRecord,
  unwrapCoreControls,
  unwrapCorePage,
  unwrapCoreResult,
} from "./product-state";
import { ShellFrame } from "./shell";

type Item = Record<string, unknown>;
type Page = "switches" | "ownership";

const CONTROL_CATALOG = [
  {
    key: "global_emergency_stop",
    label: "Global emergency stop",
    stage: "All conversion processing and outbound effects",
    help: "When on, this is the final stop over every source, normalization, reporting, dashboard, destination, export, and replay stage.",
    inverted: true,
  },
  {
    key: "public_ingress_acceptance",
    label: "Accept inbound webhook batches",
    stage: "Public source intake",
    help: "Allows authenticated inbound webhooks to be durably accepted. Turning it off leaves existing accepted work intact.",
  },
  {
    key: "source_schedule_start",
    label: "Start scheduled sources",
    stage: "Generic API, spreadsheet, email, and internal source schedules",
    help: "Controls new scheduled source runs. Manual side-effect-free previews remain separate.",
  },
  {
    key: "parser_normalizer_consumption",
    label: "Parse and normalize accepted source work",
    stage: "Source parsing and canonical normalization",
    help: "Controls consumption after durable intake. Accepted raw work remains recoverable while paused.",
  },
  {
    key: "canonical_clickhouse_write",
    label: "Write canonical analytical state",
    stage: "ClickHouse canonical event state",
    help: "Controls the canonical analytical write stage. D1 projections never replace this authority.",
  },
  {
    key: "reporting_rollup",
    label: "Build custom reporting rollups",
    stage: "Reporting datasets and aggregates",
    help: "Controls reporting projection and rollup work without changing canonical event identity.",
  },
  {
    key: "destination_adapter_account",
    label: "Allow destination adapters",
    stage: "Meta, Google, Taboola, Outbrain, NewsBreak, and generic HTTPS",
    help: "Controls destination processing. Each Connection and release still needs its own authority.",
  },
  {
    key: "exports_scheduled_email",
    label: "Allow exports and scheduled report email",
    stage: "Export generation and verified-recipient delivery",
    help: "Controls export and scheduled email execution. It does not verify recipients or create schedules.",
  },
  {
    key: "dashboard_conversion_revenue",
    label: "Include qualified conversion revenue in the existing dashboard",
    stage: "Existing Meta dashboard additive revenue path",
    help: "Keeps the protected dashboard path unchanged when off. Turning it on requires the separately proven dashboard contract.",
  },
  {
    key: "replay_backfill",
    label: "Allow replay and backfill jobs",
    stage: "Reporting replay and controlled external redelivery",
    help: "Controls job execution after a previewed replay is accepted. It does not bypass typed confirmation or destination permission.",
  },
] as const;

function errorMessage(error: unknown): string {
  return error instanceof ConversionsApiError || error instanceof CoreWireError
    ? error.message : "Controls could not be loaded. Try again.";
}

function text(item: Item, key: string, fallback = "—"): string {
  const value = item[key];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value) : fallback;
}

function number(item: Item, key: string): number {
  return typeof item[key] === "number" ? item[key] as number : 0;
}

function controlByKey(items: ReadonlyArray<Item>, key: string): Item {
  return items.find((item) => item.control_key === key) ?? {
    control_key: key, value: false, row_version: 0, updated_at: null,
  };
}

function Preview(props: { value: Item }) {
  return <dl class="ko-activity-detail">{Object.entries(props.value).filter(([key]) => key !== "preview_token").map(([key, value]) => <div>
    <dt>{key.replaceAll("_", " ")}</dt>
    <dd>{typeof value === "object" ? <code>{JSON.stringify(value)}</code> : String(value ?? "Not available")}</dd>
  </div>)}</dl>;
}

export function ControlsApp(props: { bootstrapActive: boolean }) {
  const [page, setPage] = useState<Page>("switches");
  const [controls, setControls] = useState<ReadonlyArray<Item>>([]);
  const [claims, setClaims] = useState<ReadonlyArray<Item>>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<{ item: Item; next: boolean } | null>(null);
  const [reason, setReason] = useState("operator_reviewed");
  const [claim, setClaim] = useState<Item | null>(null);
  const [ownershipMode, setOwnershipMode] = useState<"release" | "correct">("release");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [ownerFlowId, setOwnerFlowId] = useState("");
  const [ownerFlowVersionId, setOwnerFlowVersionId] = useState("");
  const [preview, setPreview] = useState<Item | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [controlPayload, claimPayload] = await Promise.all([
        requestConversionsApi<unknown>("controls.list", "/api/admin/conversions/v1/controls", { signal }),
        requestConversionsApi<unknown>("ownership.list", "/api/admin/conversions/v1/ownership?limit=100", { signal }),
      ]);
      setControls(unwrapCoreControls(controlPayload));
      setClaims(unwrapCorePage(claimPayload).items);
      setMessage("Controls and ownership are current.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const activeClaims = useMemo(() => claims.filter((item) => item.status === "active"), [claims]);

  async function applyControl() {
    if (!pending) return;
    const key = text(pending.item, "control_key", "");
    setWorking(key);
    try {
      const payload = await requestConversionsApi<unknown>(
        `control.update:${key}:${text(pending.item, "row_version")}:${pending.next}`,
        `/api/admin/conversions/v1/controls/${key}`,
        { method: "PATCH", body: {
          value: pending.next,
          row_version: number(pending.item, "row_version"),
          reason,
        } },
      );
      const result = unwrapCoreResult(payload);
      if (!isRecord(result)) throw new CoreWireError("invalid_response", "The service returned an invalid control.");
      setControls((current) => [...current.filter((item) => item.control_key !== key), result]);
      setMessage(`${CONTROL_CATALOG.find((item) => item.key === key)?.label ?? key} changed and audited.`);
      setPending(null);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setWorking("");
    }
  }

  function openClaim(item: Item) {
    setClaim(item);
    setEffectiveFrom(text(item, "effective_from", "").slice(0, 10));
    setEffectiveTo((text(item, "effective_to", "") || new Date().toISOString()).slice(0, 10));
    setOwnerFlowId(text(item, "owner_flow_id", ""));
    setOwnerFlowVersionId(text(item, "owner_flow_version_id", ""));
    setPreview(null);
  }

  async function previewOwnership() {
    if (!claim) return;
    const id = text(claim, "claim_id", "");
    setWorking("ownership");
    setPreview(null);
    try {
      const path = ownershipMode === "release"
        ? `/api/admin/conversions/v1/ownership/${id}/release-preview`
        : `/api/admin/conversions/v1/ownership/${id}/correct-preview`;
      const body = ownershipMode === "release"
        ? {
          effective_to: `${effectiveTo}T00:00:00.000Z`,
          close_action: "withdraw_future_eligibility",
          reason,
        }
        : {
          owner_flow_id: ownerFlowId,
          owner_flow_version_id: ownerFlowVersionId,
          effective_from: `${effectiveFrom}T00:00:00.000Z`,
          effective_to: effectiveTo ? `${effectiveTo}T00:00:00.000Z` : null,
          reason,
        };
      const payload = await requestConversionsApi<unknown>(
        `ownership.${ownershipMode}.preview:${id}:${JSON.stringify(body)}`,
        path,
        { method: "POST", body },
      );
      const result = unwrapCoreResult(payload);
      if (!isRecord(result)) throw new CoreWireError("invalid_response", "The service returned an invalid ownership preview.");
      setPreview(result);
      setMessage("Ownership impact preview is fresh. No claim, reporting key, dashboard row, or delivery changed.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setWorking("");
    }
  }

  async function applyOwnership() {
    if (!claim || !preview) return;
    const id = text(claim, "claim_id", "");
    const previewToken = text(preview, "preview_token", "");
    if (!id || !previewToken) {
      setMessage("The ownership preview is incomplete. Refresh it before applying.");
      return;
    }
    setWorking("ownership-commit");
    try {
      const path = `/api/admin/conversions/v1/ownership/${id}/${ownershipMode === "release" ? "release" : "correct"}`;
      const payload = await requestConversionsApi<unknown>(
        `ownership.${ownershipMode}.commit:${id}:${text(preview, "preview_hash", "")}`,
        path,
        { method: "POST", body: { preview_token: previewToken, reason } },
      );
      const result = unwrapCoreResult(payload);
      if (!isRecord(result) || result.status !== "effects_queued") {
        throw new CoreWireError("invalid_response", "The service returned an invalid ownership result.");
      }
      setPreview(null);
      setClaim(null);
      setMessage("Ownership changed and audited. Reporting, dashboard, and pending-delivery effects are queued for reconciliation.");
      await load();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setWorking("");
    }
  }

  return <ShellFrame section="controls" bootstrapActive={props.bootstrapActive}>
    <div class="ko-product-toolbar">
      <div class="ko-view-tabs" role="tablist" aria-label="Control views">
        <button class={`ko-button${page === "switches" ? " ko-button--primary" : ""}`} type="button" role="tab" aria-selected={page === "switches"} onClick={() => setPage("switches")}>Operational switches</button>
        <button class={`ko-button${page === "ownership" ? " ko-button--primary" : ""}`} type="button" role="tab" aria-selected={page === "ownership"} onClick={() => setPage("ownership")}>Ownership</button>
      </div>
      <button class="ko-button" type="button" disabled={loading || working !== ""} onClick={() => void load()}>Refresh</button>
    </div>
    <p class="ko-product-live" role="status" aria-live="polite">{message}</p>
    {loading && <div class="ko-loading" aria-busy="true"><span class="ko-spinner" />Loading controls and ownership…</div>}

    {!loading && page === "switches" && <div class="ko-control-grid">
      {CONTROL_CATALOG.map((definition) => {
        const item = controlByKey(controls, definition.key);
        const on = item.value === true;
        const state = definition.inverted ? (on ? "STOPPED" : "Running") : (on ? "Enabled" : "Disabled");
        return <article class={`ko-control-card${definition.inverted && on ? " ko-control-card--critical" : ""}`}>
          <div><h3>{definition.label}</h3><p>{definition.help}</p></div>
          <dl><div><dt>Affected stage</dt><dd>{definition.stage}</dd></div>
            <div><dt>Current state</dt><dd><strong>{state}</strong></dd></div>
            <div><dt>Last changed</dt><dd>{text(item, "updated_at", "Never — using safe default")}</dd></div>
          </dl>
          <button class={`ko-button${definition.inverted || on ? " ko-button--danger" : " ko-button--primary"}`}
            type="button" disabled={working !== ""}
            onClick={() => { setPending({ item, next: !on }); setReason(definition.inverted ? "emergency_control_reviewed" : "operator_reviewed"); }}>
            {definition.inverted ? (on ? "Resume processing…" : "Stop everything…") : (on ? "Disable…" : "Enable…")}
          </button>
        </article>;
      })}
    </div>}

    {!loading && page === "ownership" && <section class="ko-config-section">
      <h3>Exclusive output ownership</h3>
      <p>An active claim decides which immutable Flow version owns a product/offer/output/destination interval. Corrections preview reporting recomputation, dashboard tombstones, pending cancellation, and successful deliveries that must remain historical.</p>
      {activeClaims.length === 0 ? <div class="ko-conversions-state"><h3>No active claims</h3><p>Publish preview must create a non-overlapping claim before a Flow can own output.</p></div>
        : <div class="ko-table-scroll"><table class="ko-resource-table"><thead><tr>
          <th>Product / offer</th><th>Output</th><th>Destination</th><th>Effective interval</th><th>Owner Flow</th><th>Inspect</th>
        </tr></thead><tbody>{activeClaims.map((item) => <tr key={text(item, "claim_id")}>
          <td>{text(item, "product_type")} / {isRecord(item.offer_scope) ? `${text(item.offer_scope, "type")}: ${text(item.offer_scope, "value")}` : "—"}</td>
          <td>{text(item, "output_channel")}</td><td>{text(item, "destination_platform")} / {text(item, "destination_account")}</td>
          <td>{text(item, "effective_from")} → {text(item, "effective_to", "open")}</td><td>{text(item, "owner_flow_id")}</td>
          <td><button class="ko-button ko-button--small" type="button" onClick={() => openClaim(item)}>Inspect / correct</button></td>
        </tr>)}</tbody></table></div>}
    </section>}

    {pending && <div class="ko-modal-backdrop" role="presentation">
      <section class="ko-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="control-confirm-title">
        <h3 id="control-confirm-title">Confirm operational control</h3>
        <p>You are changing <strong>{CONTROL_CATALOG.find((item) => item.key === pending.item.control_key)?.label}</strong> to <strong>{String(pending.next)}</strong>.</p>
        <label class="ko-config-field">Audit reason code<input value={reason} pattern="[a-z][a-z0-9_.:-]{0,127}" onInput={(event) => setReason(event.currentTarget.value)} /></label>
        <div class="ko-button-row">
          <button class="ko-button ko-button--danger" type="button" disabled={working !== "" || !/^[a-z][a-z0-9_.:-]{0,127}$/.test(reason)} onClick={() => void applyControl()}>Confirm change</button>
          <button class="ko-button" type="button" disabled={working !== ""} onClick={() => setPending(null)}>Cancel</button>
        </div>
      </section>
    </div>}

    {claim && <div class="ko-modal-backdrop" role="presentation">
      <section class="ko-confirm-dialog ko-activity-dialog" role="dialog" aria-modal="true" aria-labelledby="ownership-title">
        <h3 id="ownership-title">Ownership claim {text(claim, "claim_id")}</h3>
        <Preview value={claim} />
        <div class="ko-view-tabs">
          <button class={`ko-button${ownershipMode === "release" ? " ko-button--primary" : ""}`} type="button" onClick={() => { setOwnershipMode("release"); setPreview(null); }}>Close interval</button>
          <button class={`ko-button${ownershipMode === "correct" ? " ko-button--primary" : ""}`} type="button" onClick={() => { setOwnershipMode("correct"); setPreview(null); }}>Correct owner/interval</button>
        </div>
        {ownershipMode === "release" ? <label class="ko-config-field">New exclusive end<input type="date" value={effectiveTo} onInput={(event) => { setEffectiveTo(event.currentTarget.value); setPreview(null); }} /></label>
          : <div class="ko-config-grid">
            <label class="ko-config-field">Owner Flow ID<input value={ownerFlowId} onInput={(event) => { setOwnerFlowId(event.currentTarget.value); setPreview(null); }} /></label>
            <label class="ko-config-field">Owner Flow version ID<input value={ownerFlowVersionId} onInput={(event) => { setOwnerFlowVersionId(event.currentTarget.value); setPreview(null); }} /></label>
            <label class="ko-config-field">Effective from<input type="date" value={effectiveFrom} onInput={(event) => { setEffectiveFrom(event.currentTarget.value); setPreview(null); }} /></label>
            <label class="ko-config-field">Effective to<input type="date" value={effectiveTo} onInput={(event) => { setEffectiveTo(event.currentTarget.value); setPreview(null); }} /></label>
          </div>}
        <label class="ko-config-field">Reason code<input value={reason} onInput={(event) => setReason(event.currentTarget.value)} /></label>
        <button class="ko-button ko-button--primary" type="button" disabled={working !== "" || !effectiveTo || !reason} onClick={() => void previewOwnership()}>Preview complete impact</button>
        {preview && <div class="ko-replay-preview"><h4>Fresh impact preview</h4><Preview value={preview} />
          <button class="ko-button ko-button--danger" type="button"
            disabled={working !== "" || !text(preview, "preview_token", "") || !/^[a-z][a-z0-9_.:-]{0,127}$/.test(reason)}
            onClick={() => void applyOwnership()}>
            {working === "ownership-commit" ? "Applying…" : ownershipMode === "release" ? "Apply interval close" : "Apply correction"}
          </button>
          <p class="ko-disabled-reason">This consumes the fresh actor-bound preview. Core still refuses the change unless the exact production ownership permission is active.</p>
        </div>}
        <button class="ko-button" type="button" onClick={() => setClaim(null)}>Close</button>
      </section>
    </div>}
  </ShellFrame>;
}
