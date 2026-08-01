import { useCallback, useEffect, useState } from "preact/hooks";
import { ConversionsApiError, requestConversionsApi } from "./api-client";
import {
  CoreWireError,
  isRecord,
  unwrapConversionsUiContext,
  unwrapCorePage,
  unwrapCoreResult,
} from "./product-state";
import { ShellFrame } from "./shell";

type Item = Record<string, unknown>;
type View = "runs" | "events" | "deliveries" | "replay";
type ReplayMode = "reporting_only" | "external_redelivery";
type ReplayFilter = "all" | "event_ids" | "delivery_ids";

const RUN_OUTCOMES = [
  ["records_changed", "Changed"],
  ["records_noop", "No-op"],
  ["records_duplicate", "Duplicate"],
  ["records_waiting", "Waiting"],
  ["records_ignored", "Ignored"],
  ["records_invalid", "Invalid"],
  ["records_stale", "Stale"],
  ["records_conflict", "Conflict"],
  ["records_ambiguous", "Ambiguous match"],
  ["records_quarantined", "Quarantined"],
] as const;

const DELIVERY_STATES = [
  "pending", "leased", "attempt_started", "succeeded", "retry_wait",
  "terminal_failure", "outcome_unknown", "cancelled",
] as const;

function errorMessage(error: unknown): string {
  return error instanceof ConversionsApiError || error instanceof CoreWireError
    ? error.message
    : "Activity could not be loaded. Try again.";
}

function text(item: Item, key: string, fallback = "—"): string {
  const value = item[key];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value) : fallback;
}

function number(item: Item, key: string): number {
  return typeof item[key] === "number" ? item[key] as number : 0;
}

function today(offsetDays = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function listPath(
  path: string,
  filters: Readonly<Record<string, string>>,
  cursor: string | null = null,
): string {
  const query = new URLSearchParams({ limit: "50" });
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
  if (cursor) query.set("cursor", cursor);
  return `${path}?${query}`;
}

function KeyValue(props: { item: Item; keys?: ReadonlyArray<string> }) {
  const keys = props.keys ?? Object.keys(props.item);
  return <dl class="ko-activity-detail">
    {keys.filter((key) => Object.hasOwn(props.item, key)).map((key) => <div key={key}>
      <dt>{key.replaceAll("_", " ")}</dt>
      <dd>{typeof props.item[key] === "object"
        ? <code>{JSON.stringify(props.item[key])}</code>
        : String(props.item[key] ?? "Not available")}</dd>
    </div>)}
  </dl>;
}

export function ActivityApp(props: { bootstrapActive: boolean }) {
  const [view, setView] = useState<View>("runs");
  const [runs, setRuns] = useState<ReadonlyArray<Item>>([]);
  const [events, setEvents] = useState<ReadonlyArray<Item>>([]);
  const [deliveries, setDeliveries] = useState<ReadonlyArray<Item>>([]);
  const [runCursor, setRunCursor] = useState<string | null>(null);
  const [eventCursor, setEventCursor] = useState<string | null>(null);
  const [deliveryCursor, setDeliveryCursor] = useState<string | null>(null);
  const [connections, setConnections] = useState<ReadonlyArray<Item>>([]);
  const [health, setHealth] = useState<Item | null>(null);
  const [capabilities, setCapabilities] = useState<ReadonlyArray<string>>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [runOutcome, setRunOutcome] = useState("");
  const [deliveryState, setDeliveryState] = useState("");
  const [eventDeliveryState, setEventDeliveryState] = useState("");
  const [detail, setDetail] = useState<Item | null>(null);
  const [detailTitle, setDetailTitle] = useState("");
  const [issues, setIssues] = useState<ReadonlyArray<Item>>([]);
  const [detailNextCursor, setDetailNextCursor] = useState<string | null>(null);

  const [replayMode, setReplayMode] = useState<ReplayMode>("reporting_only");
  const [filterKind, setFilterKind] = useState<ReplayFilter>("all");
  const [selectedIds, setSelectedIds] = useState<ReadonlyArray<string>>([]);
  const [destinationIds, setDestinationIds] = useState<ReadonlyArray<string>>([]);
  const [startDate, setStartDate] = useState(today(-7));
  const [endDate, setEndDate] = useState(today(1));
  const [preview, setPreview] = useState<Item | null>(null);
  const [typedCount, setTypedCount] = useState("");
  const [reason, setReason] = useState("operator_reviewed");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setMessage("Loading runs, records, deliveries, and permissions…");
    try {
      const [runPayload, eventPayload, deliveryPayload, connectionPayload, contextPayload, healthPayload] = await Promise.all([
        requestConversionsApi<unknown>("activity.runs", listPath(
          "/api/admin/conversions/v1/runs", { outcome: runOutcome },
        ), { signal }),
        requestConversionsApi<unknown>("activity.events", listPath(
          "/api/admin/conversions/v1/events", { delivery_state: eventDeliveryState },
        ), { signal }),
        requestConversionsApi<unknown>("activity.deliveries", listPath(
          "/api/admin/conversions/v1/deliveries", { state: deliveryState },
        ), { signal }),
        requestConversionsApi<unknown>("activity.connections", "/api/admin/conversions/v1/connections?limit=100", { signal }),
        requestConversionsApi<unknown>("activity.context", "/api/admin/conversions/ui-context", { signal }),
        requestConversionsApi<unknown>("activity.health", "/api/admin/conversions/v1/activity/health", { signal }),
      ]);
      const runPage = unwrapCorePage(runPayload);
      const eventPage = unwrapCorePage(eventPayload);
      const deliveryPage = unwrapCorePage(deliveryPayload);
      const healthResult = unwrapCoreResult(healthPayload);
      if (!isRecord(healthResult)) throw new CoreWireError("invalid_response", "The service returned invalid Activity health.");
      setRuns(runPage.items);
      setRunCursor(runPage.nextCursor);
      setEvents(eventPage.items);
      setEventCursor(eventPage.nextCursor);
      setDeliveries(deliveryPage.items);
      setDeliveryCursor(deliveryPage.nextCursor);
      setConnections(unwrapCorePage(connectionPayload).items);
      setCapabilities(unwrapConversionsUiContext(contextPayload).capabilities);
      setHealth(healthResult);
      setMessage("Activity is current.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [deliveryState, eventDeliveryState, runOutcome]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function loadMore(kind: "runs" | "events" | "deliveries") {
    const cursor = kind === "runs" ? runCursor : kind === "events" ? eventCursor : deliveryCursor;
    if (!cursor) return;
    const path = kind === "runs"
      ? listPath("/api/admin/conversions/v1/runs", { outcome: runOutcome }, cursor)
      : kind === "events"
        ? listPath("/api/admin/conversions/v1/events", { delivery_state: eventDeliveryState }, cursor)
        : listPath("/api/admin/conversions/v1/deliveries", { state: deliveryState }, cursor);
    setWorking(true);
    try {
      const payload = await requestConversionsApi<unknown>(`activity.${kind}.more:${cursor}`, path);
      const page = unwrapCorePage(payload);
      if (kind === "runs") {
        setRuns((current) => [...current, ...page.items]);
        setRunCursor(page.nextCursor);
      } else if (kind === "events") {
        setEvents((current) => [...current, ...page.items]);
        setEventCursor(page.nextCursor);
      } else {
        setDeliveries((current) => [...current, ...page.items]);
        setDeliveryCursor(page.nextCursor);
      }
      setMessage(page.nextCursor ? "Loaded the next Activity page." : "All matching Activity is loaded.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setWorking(false);
    }
  }

  const destinations = connections.filter((connection) => connection.direction === "destination"
    && connection.archived_at === null);
  const externalAllowed = capabilities.includes("conversions.external_redelivery");

  function resetPreview() {
    setPreview(null);
    setTypedCount("");
  }

  function setReplayFilter(next: ReplayFilter) {
    setFilterKind(next);
    setSelectedIds([]);
    resetPreview();
  }

  function toggleId(id: string, checked: boolean, setter: (value: ReadonlyArray<string>) => void, current: ReadonlyArray<string>) {
    setter((checked ? [...current, id] : current.filter((value) => value !== id)).sort());
    resetPreview();
  }

  async function openRun(run: Item) {
    const id = text(run, "run_id", "");
    if (!id) return;
    setWorking(true);
    setDetailTitle(`Run ${id}`);
    try {
      const [runPayload, issuePayload] = await Promise.all([
        requestConversionsApi<unknown>(`activity.run:${id}`, `/api/admin/conversions/v1/runs/${id}`),
        requestConversionsApi<unknown>(`activity.issues:${id}`, `/api/admin/conversions/v1/runs/${id}/issues?limit=100`),
      ]);
      const result = unwrapCoreResult(runPayload);
      if (!isRecord(result)) throw new CoreWireError("invalid_response", "The service returned an invalid run.");
      setDetail(result);
      const issuePage = unwrapCorePage(issuePayload);
      setIssues(issuePage.items);
      setDetailNextCursor(issuePage.nextCursor);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setWorking(false);
    }
  }

  async function openEvent(event: Item) {
    const id = text(event, "event_id", "");
    if (!id) return;
    setWorking(true);
    setDetailTitle(`Event ${id}`);
    try {
      const payload = await requestConversionsApi<unknown>(
        `activity.event-history:${id}`,
        `/api/admin/conversions/v1/events/${id}/history?limit=100`,
      );
      const page = unwrapCorePage(payload);
      setDetail({ ...event, history: page.items });
      setDetailNextCursor(page.nextCursor);
      setIssues([]);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setWorking(false);
    }
  }

  async function openDelivery(delivery: Item) {
    const id = text(delivery, "delivery_id", "");
    if (!id) return;
    setWorking(true);
    setDetailTitle(`Delivery ${id}`);
    try {
      const payload = await requestConversionsApi<unknown>(
        `activity.delivery:${id}`,
        `/api/admin/conversions/v1/deliveries/${id}`,
      );
      const result = unwrapCoreResult(payload);
      if (!isRecord(result)) throw new CoreWireError("invalid_response", "The service returned an invalid delivery.");
      setDetail(result);
      setDetailNextCursor(null);
      setIssues([]);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setWorking(false);
    }
  }

  async function loadMoreHistory() {
    if (!detail || !detailNextCursor) return;
    const id = text(detail, "event_id", "");
    const history = Array.isArray(detail.history)
      ? detail.history.filter(isRecord)
      : [];
    if (!id) return;
    setWorking(true);
    try {
      const payload = await requestConversionsApi<unknown>(
        `activity.event-history.more:${id}:${detailNextCursor}`,
        `/api/admin/conversions/v1/events/${id}/history?limit=100&cursor=${encodeURIComponent(detailNextCursor)}`,
      );
      const page = unwrapCorePage(payload);
      setDetail({ ...detail, history: [...history, ...page.items] });
      setDetailNextCursor(page.nextCursor);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setWorking(false);
    }
  }

  async function cancelDelivery() {
    const id = detail && text(detail, "delivery_id", "");
    if (!id || !detail) return;
    setWorking(true);
    try {
      const payload = await requestConversionsApi<unknown>(
        `activity.delivery.cancel:${id}:${text(detail, "row_version")}`,
        `/api/admin/conversions/v1/deliveries/${id}/cancel`,
        { method: "POST", body: {
          row_version: number(detail, "row_version"),
          reason: reason || "operator_cancelled",
        } },
      );
      const result = unwrapCoreResult(payload);
      if (!isRecord(result)) throw new CoreWireError("invalid_response", "The service returned an invalid cancellation.");
      setMessage("The pending delivery was cancelled. No provider call was made.");
      await load();
      setDetail(null);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setWorking(false);
    }
  }

  const replayBody = {
    mode: replayMode,
    destination_scope: replayMode === "external_redelivery" ? destinationIds : [],
    filter: { kind: filterKind, ids: filterKind === "all" ? [] : selectedIds },
    date_bound: { start: startDate, end: endDate },
  };

  async function previewReplay() {
    setWorking(true);
    setPreview(null);
    setMessage("Calculating an immutable replay preview…");
    try {
      const payload = await requestConversionsApi<unknown>(
        `activity.replay.preview:${JSON.stringify(replayBody)}`,
        "/api/admin/conversions/v1/replays/preview",
        { method: "POST", body: replayBody },
      );
      const result = unwrapCoreResult(payload);
      if (!isRecord(result) || result.schema_version !== "replay_preview.v2"
          || typeof result.preview_token !== "string") {
        throw new CoreWireError("invalid_response", "The service did not return a fresh replay preview.");
      }
      setPreview(result);
      setMessage("Replay preview ready. Nothing has been replayed or sent.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setWorking(false);
    }
  }

  async function commitReplay() {
    if (!preview) return;
    setWorking(true);
    setMessage("Submitting the exact previewed replay…");
    try {
      const payload = await requestConversionsApi<unknown>(
        `activity.replay.commit:${text(preview, "preview_token")}`,
        "/api/admin/conversions/v1/replays",
        { method: "POST", body: {
          ...replayBody,
          preview_token: preview.preview_token,
          reason,
          typed_count_confirmation: Number(typedCount),
        } },
      );
      const result = unwrapCoreResult(payload);
      if (!isRecord(result)) throw new CoreWireError("invalid_response", "The service returned an invalid replay job.");
      setMessage(`Replay job ${text(result, "replay_id")} was accepted with generation ${text(result, "generation")}.`);
      setPreview(null);
      setTypedCount("");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setWorking(false);
    }
  }

  return <ShellFrame section="activity" bootstrapActive={props.bootstrapActive}>
    <div class="ko-product-toolbar">
      <div class="ko-view-tabs" role="tablist" aria-label="Activity views">
        {(["runs", "events", "deliveries", "replay"] as const).map((key) => <button
          type="button" role="tab" aria-selected={view === key}
          class={`ko-button${view === key ? " ko-button--primary" : ""}`}
          onClick={() => { setView(key); setDetail(null); }}
        >{key === "events" ? "Records" : key[0].toUpperCase() + key.slice(1)}</button>)}
      </div>
      <button class="ko-button" type="button" disabled={loading || working} onClick={() => void load()}>Refresh all</button>
    </div>
    <p class="ko-product-live" role="status" aria-live="polite">{message}</p>
    {loading && <div class="ko-loading" aria-busy="true"><span class="ko-spinner" />Loading complete activity…</div>}
    {!loading && health && <section class="ko-config-section" aria-labelledby="activity-health">
      <h3 id="activity-health">Operational health</h3>
      <p>{text(health, "actionable_error", text(health, "status") === "healthy"
        ? "Processing is healthy." : "No completed source work is available yet.")}</p>
      <KeyValue item={health} keys={[
        "status", "last_success_at", "backlog_count", "oldest_work_at",
        "next_retry_at", "upstream_lag_seconds",
      ]} />
    </section>}

    {!loading && view === "runs" && <section class="ko-config-section" aria-labelledby="activity-runs">
      <h3 id="activity-runs">Source runs</h3>
      <p>Every accepted source outcome remains visible. Select a result type to find runs that contain it.</p>
      <label class="ko-config-field">Record result
        <select value={runOutcome} onChange={(event) => setRunOutcome(event.currentTarget.value)}>
          <option value="">All outcomes</option>
          {RUN_OUTCOMES.map(([key, label]) => <option value={key}>{label}</option>)}
        </select>
      </label>
      <div class="ko-table-scroll"><table class="ko-resource-table">
        <thead><tr><th>Started</th><th>Flow</th><th>Status</th><th>Seen</th><th>Accepted</th><th>Changed</th><th>Waiting</th><th>Invalid</th><th>Open</th></tr></thead>
        <tbody>{runs.map((run) => <tr key={text(run, "run_id")}>
          <td>{text(run, "started_at")}</td><td>{text(run, "flow_id")}</td><td>{text(run, "status")}</td>
          <td>{text(run, "records_seen")}</td><td>{text(run, "records_accepted")}</td>
          <td>{text(run, "records_changed")}</td><td>{text(run, "records_waiting")}</td>
          <td>{text(run, "records_invalid")}</td>
          <td><button class="ko-button ko-button--small" type="button" disabled={working} onClick={() => void openRun(run)}>Inspect</button></td>
        </tr>)}</tbody>
      </table></div>
      {runCursor && <button class="ko-button" type="button" disabled={working} onClick={() => void loadMore("runs")}>Load more runs</button>}
    </section>}

    {!loading && view === "events" && <section class="ko-config-section" aria-labelledby="activity-events">
      <h3 id="activity-events">Canonical record identities</h3>
      <p>Each row is one stable event identity. Open it to see its immutable state fingerprint, canonical pointer, and delivery history.</p>
      <label class="ko-config-field">Delivery state
        <select value={eventDeliveryState} onChange={(event) => setEventDeliveryState(event.currentTarget.value)}>
          <option value="">All canonical records</option>
          {DELIVERY_STATES.map((state) => <option value={state}>{state.replaceAll("_", " ")}</option>)}
        </select>
      </label>
      <div class="ko-table-scroll"><table class="ko-resource-table">
        <thead><tr><th>Event</th><th>Version</th><th>Account</th><th>Deliveries</th><th>Pending</th><th>Successful</th><th>Unknown</th><th>Open</th></tr></thead>
        <tbody>{events.map((event) => <tr key={text(event, "event_id")}>
          <td>{text(event, "event_id")}</td><td>{text(event, "event_version")}</td>
          <td>{text(event, "source_account_id")}</td><td>{text(event, "delivery_count")}</td>
          <td>{text(event, "pending_deliveries")}</td><td>{text(event, "successful_deliveries")}</td>
          <td>{text(event, "unknown_deliveries")}</td>
          <td><button class="ko-button ko-button--small" type="button" disabled={working} onClick={() => void openEvent(event)}>History</button></td>
        </tr>)}</tbody>
      </table></div>
      {eventCursor && <button class="ko-button" type="button" disabled={working} onClick={() => void loadMore("events")}>Load more records</button>}
    </section>}

    {!loading && view === "deliveries" && <section class="ko-config-section" aria-labelledby="activity-deliveries">
      <h3 id="activity-deliveries">Destination deliveries</h3>
      <p>Provider attempts, retry state, unknown outcomes, and cancellation eligibility are shown separately from reporting replay.</p>
      <label class="ko-config-field">Delivery state
        <select value={deliveryState} onChange={(event) => setDeliveryState(event.currentTarget.value)}>
          <option value="">All states</option>{DELIVERY_STATES.map((state) => <option value={state}>{state.replaceAll("_", " ")}</option>)}
        </select>
      </label>
      <div class="ko-table-scroll"><table class="ko-resource-table">
        <thead><tr><th>Updated</th><th>Event</th><th>Destination</th><th>State</th><th>Attempts</th><th>Generation</th><th>Open</th></tr></thead>
        <tbody>{deliveries.map((delivery) => <tr key={text(delivery, "delivery_id")}>
          <td>{text(delivery, "updated_at")}</td><td>{text(delivery, "event_id")}</td>
          <td>{text(delivery, "destination_connection_id")}</td><td>{text(delivery, "state")}</td>
          <td>{text(delivery, "attempt_count")}</td><td>{text(delivery, "delivery_generation")}</td>
          <td><button class="ko-button ko-button--small" type="button" disabled={working} onClick={() => void openDelivery(delivery)}>Inspect</button></td>
        </tr>)}</tbody>
      </table></div>
      {deliveryCursor && <button class="ko-button" type="button" disabled={working} onClick={() => void loadMore("deliveries")}>Load more deliveries</button>}
    </section>}

    {!loading && view === "replay" && <section class="ko-config-section" aria-labelledby="activity-replay">
      <h3 id="activity-replay">Preview and replay exact records</h3>
      <p>Reporting-only replay is the default and cannot contact a provider. External redelivery is a separate generation and requires its separate permission, explicit destinations, a fresh preview, and typed count.</p>
      <div class="ko-config-grid">
        <label class="ko-config-field">Mode<select value={replayMode} onChange={(event) => {
          setReplayMode(event.currentTarget.value as ReplayMode); setDestinationIds([]); resetPreview();
        }}>
          <option value="reporting_only">Rebuild reporting only — no provider call</option>
          <option value="external_redelivery" disabled={!externalAllowed}>Redeliver externally — new generation</option>
        </select><small>{externalAllowed ? "Your permanent authority allows both modes." : "External redelivery is unavailable because its separate capability is absent."}</small></label>
        <label class="ko-config-field">Record selector<select value={filterKind} onChange={(event) => setReplayFilter(event.currentTarget.value as ReplayFilter)}>
          <option value="all">All eligible records in date range</option>
          <option value="event_ids">Selected event IDs</option>
          <option value="delivery_ids">Selected delivery IDs</option>
        </select><small>The preview freezes this exact selector and current delivery generations.</small></label>
        <label class="ko-config-field">Start date<input type="date" value={startDate} onInput={(event) => { setStartDate(event.currentTarget.value); resetPreview(); }} /></label>
        <label class="ko-config-field">End date (exclusive)<input type="date" value={endDate} onInput={(event) => { setEndDate(event.currentTarget.value); resetPreview(); }} /></label>
      </div>
      {filterKind !== "all" && <fieldset class="ko-selection-list"><legend>{filterKind === "event_ids" ? "Events included" : "Deliveries included"}</legend>
        {(filterKind === "event_ids" ? events : deliveries).map((item) => {
          const id = text(item, filterKind === "event_ids" ? "event_id" : "delivery_id", "");
          return <label><input type="checkbox" checked={selectedIds.includes(id)} onChange={(event) => toggleId(id, event.currentTarget.checked, setSelectedIds, selectedIds)} /> <code>{id}</code></label>;
        })}
      </fieldset>}
      {replayMode === "external_redelivery" && <fieldset class="ko-selection-list"><legend>Exact external destinations</legend>
        {destinations.map((connection) => {
          const id = text(connection, "connection_id", "");
          return <label><input type="checkbox" checked={destinationIds.includes(id)} onChange={(event) => toggleId(id, event.currentTarget.checked, setDestinationIds, destinationIds)} /> {text(connection, "name")} <code>{id}</code></label>;
        })}
      </fieldset>}
      <div class="ko-button-row">
        <button class="ko-button ko-button--primary" type="button" disabled={working || startDate >= endDate
          || (filterKind !== "all" && selectedIds.length === 0)
          || (replayMode === "external_redelivery" && destinationIds.length === 0)}
        onClick={() => void previewReplay()}>Preview exact replay</button>
      </div>
      {preview && <div class="ko-replay-preview">
        <h4>Immutable preview</h4>
        <KeyValue item={preview} keys={["event_count", "delivery_count", "already_successful", "outcome_unknown", "pending", "value", "generations", "expires_at"]} />
        <label class="ko-config-field">Reason code<input value={reason} pattern="[a-z][a-z0-9_.:-]{0,127}" onInput={(event) => setReason(event.currentTarget.value)} /><small>Recorded in the audit trail.</small></label>
        <label class="ko-config-field">Type the exact delivery count: {text(preview, "delivery_count")}<input inputMode="numeric" value={typedCount} onInput={(event) => setTypedCount(event.currentTarget.value)} /></label>
        <button class="ko-button ko-button--danger" type="button" disabled={working
          || Number(typedCount) !== number(preview, "delivery_count")
          || !/^[a-z][a-z0-9_.:-]{0,127}$/.test(reason)}
        onClick={() => void commitReplay()}>{replayMode === "reporting_only" ? "Replay reporting" : "Redeliver externally"}</button>
      </div>}
    </section>}

    {detail && <div class="ko-modal-backdrop" role="presentation" onClick={(event) => {
      if (event.currentTarget === event.target) setDetail(null);
    }}>
      <section class="ko-confirm-dialog ko-activity-dialog" role="dialog" aria-modal="true" aria-labelledby="activity-detail-title">
        <h3 id="activity-detail-title">{detailTitle}</h3>
        <KeyValue item={detail} />
        {issues.length > 0 && <section><h4>Run issues</h4>{issues.map((issue) => <article class="ko-issue-card">
          <strong>{text(issue, "severity")}: {text(issue, "code")}</strong>
          <p>{text(issue, "plain_message")}</p>
          <p>Raw pointer: <code>{text(issue, "raw_pointer")}</code></p>
        </article>)}</section>}
        {detailNextCursor && text(detail, "event_id", "") && <button
          class="ko-button" type="button" disabled={working}
          onClick={() => void loadMoreHistory()}
        >Load more history</button>}
        {text(detail, "delivery_id", "") && ["pending", "retry_wait"].includes(text(detail, "state")) && <section class="ko-danger-zone ko-config-section">
          <h4>Cancel pending delivery</h4>
          <p>This is available only before a provider attempt is sent. Successful or unknown outcomes cannot be cancelled.</p>
          <label class="ko-config-field">Reason code<input value={reason} onInput={(event) => setReason(event.currentTarget.value)} /></label>
          <button class="ko-button ko-button--danger" type="button" disabled={working || !reason} onClick={() => void cancelDelivery()}>Cancel pending delivery</button>
        </section>}
        <button class="ko-button" type="button" onClick={() => setDetail(null)}>Close</button>
      </section>
    </div>}
  </ShellFrame>;
}
