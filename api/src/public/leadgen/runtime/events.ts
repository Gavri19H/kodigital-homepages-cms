// LeadGen runtime — beacon client for POST /lg/track (fix-contract v2.4 03
// §3.2 events.ts row, envelope per §3.7 / 10 §10.4).
//
// DOM-FREE core: every effect is an injected adapter — `send(url, body)`
// (engine supplies navigator.sendBeacon→fetch(keepalive); preview supplies a
// postMessage transport per 09 §9.1), `now()`, `rand(n)` bytes, and a
// schedule/cancel timer pair — so vitest (node env) drives batching, caps,
// envelope completeness and retry/backoff directly (fake timers).
//
// Contract facts honored:
//   * batches of ≤ 20 events per POST — the server cap
//     (leadgen-track.ts MAX_LEADGEN_EVENTS_PER_REQUEST = 20; excess is
//     silently dropped server-side, so the client must never exceed it);
//   * client-minted `event_id`, ULID-shape (§22.5 idempotency key);
//   * retry queue with backoff whose TOTAL horizon stays WELL under the
//     10-minute KV seen-TTL (leadgen-track.ts LEADGEN_SEEN_TTL_SECONDS=600):
//     retries at 2s → 10s → 45s (≤ 57s cumulative, ≤ 3 attempts after the
//     first) — a replayed event_id always lands inside the dedupe window;
//   * the §3.7 common envelope is stamped on EVERY event (identity + A/B dims
//     from __LG_ASSIGNMENT__ via the engine, url/referer/language,
//     acquisition params) with per-event fields overlaid; the field names are
//     EXACTLY the ones the ingest copies (leadgenEventFromPayload) — e.g.
//     `timestamp` (epoch ms), `funnel_ab_test_revision` (number),
//     `assignment_bucket` (string). `variant_label`/`internal_field`/`nav`
//     also ride per §3.7/§3.5 (the ingest ignores unknown keys today;
//     they are contract-listed for the pipeline).
//
// The batch body is `{events:[…]}` — one of the three shapes /lg/track
// accepts. POST target: /lg/track (same-origin, 03 §3.9 no non-/lg calls).

// ---------------------------------------------------------------------------
// ULID-shape id (Crockford base32; 10 time chars + 16 random chars = 26).
// Local ~20-line generator — the server ids.ts is NEVER imported (03 §3.2).
// ---------------------------------------------------------------------------

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulidLike(timeMs: number, rand: (n: number) => Uint8Array): string {
  let t = Math.max(0, Math.floor(timeMs));
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD.charAt(t % 32) + time;
    t = Math.floor(t / 32);
  }
  const bytes = rand(10); // 80 bits → exactly 16 base32 chars
  let out = "";
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < 10; i++) {
    acc = (acc << 8) | (bytes[i] ?? 0);
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD.charAt((acc >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  return time + out;
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

// The §3.7 common dims stamped on every beacon. Keys match the ingest's
// accepted payload fields (analytics/leadgen-events.ts leadgenEventFromPayload).
export interface LgEnvelopeBase {
  session_id: string;
  page_view_id: string;
  funnel_attempt_id: string;
  quote_id: string;
  funnel_id: string;
  funnel_variant_id: string;
  funnel_ab_test_id: string;
  funnel_ab_test_revision: number;
  variant_label: string;
  assignment_bucket: string;
  assignment_reason: string;
  section_order_hash: string;
  url: string;
  referer: string;
  language: string;
  // Acquisition dims parsed from the landing URL (ride quote_view into the
  // leadgen.sessions record server-side; harmless on other events).
  utm_source: string;
  utm_medium: string;
  utm_content: string;
  fbclid: string;
  cpc: string;
  placement: string;
  sub1: string;
  sub2: string;
  sub3: string;
  sub4: string;
  sub5: string;
}

export function emptyEnvelopeBase(): LgEnvelopeBase {
  return {
    session_id: "",
    page_view_id: "",
    funnel_attempt_id: "",
    quote_id: "",
    funnel_id: "",
    funnel_variant_id: "",
    funnel_ab_test_id: "",
    funnel_ab_test_revision: 0,
    variant_label: "",
    assignment_bucket: "",
    assignment_reason: "",
    section_order_hash: "",
    url: "",
    referer: "",
    language: "",
    utm_source: "",
    utm_medium: "",
    utm_content: "",
    fbclid: "",
    cpc: "",
    placement: "",
    sub1: "",
    sub2: "",
    sub3: "",
    sub4: "",
    sub5: "",
  };
}

export type LgBeaconEvent = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

// `send` returns whether the batch was ACCEPTED for delivery (sendBeacon's
// queue semantics) — false/reject/throw enqueues a retry. It may be sync
// (sendBeacon) or async (fetch).
export type LgSendFn = (url: string, body: string) => boolean | Promise<boolean>;

export interface LgBeaconAdapters {
  send: LgSendFn;
  now: () => number;
  rand: (n: number) => Uint8Array;
  schedule: (fn: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
}

export interface LgBeaconOptions {
  url?: string; // default /lg/track
  maxBatch?: number; // default 20 — MUST NOT exceed the server cap
  flushDelayMs?: number; // micro-batching window, default 800ms
  retryDelaysMs?: number[]; // default [2000, 10000, 45000] — Σ 57s ≪ 600s TTL
}

export const LG_TRACK_URL = "/lg/track";
export const LG_MAX_BATCH = 20;
export const LG_DEFAULT_FLUSH_DELAY_MS = 800;
// Backoff horizon: 2s + 10s + 45s = 57s worst-case — WELL under the 10-minute
// (600s) KV seen-TTL, so every retried event_id still dedupes server-side.
export const LG_DEFAULT_RETRY_DELAYS_MS = [2000, 10000, 45000];

interface PendingRetry {
  events: LgBeaconEvent[];
  attempt: number; // number of FAILED attempts so far
  handle: unknown;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class LgBeaconClient {
  private readonly adapters: LgBeaconAdapters;
  private readonly url: string;
  private readonly maxBatch: number;
  private readonly flushDelayMs: number;
  private readonly retryDelaysMs: number[];

  private base: LgEnvelopeBase = emptyEnvelopeBase();
  private queue: LgBeaconEvent[] = [];
  private flushHandle: unknown = null;
  private retries: PendingRetry[] = [];

  // Introspection for tests + __LG_ENGINE__ state getters.
  sentBatches = 0;
  sentEvents = 0;
  droppedEvents = 0;

  constructor(adapters: LgBeaconAdapters, options: LgBeaconOptions = {}) {
    this.adapters = adapters;
    this.url = options.url ?? LG_TRACK_URL;
    this.maxBatch = Math.min(options.maxBatch ?? LG_MAX_BATCH, LG_MAX_BATCH);
    this.flushDelayMs = options.flushDelayMs ?? LG_DEFAULT_FLUSH_DELAY_MS;
    this.retryDelaysMs = options.retryDelaysMs ?? LG_DEFAULT_RETRY_DELAYS_MS;
  }

  // Engine updates identity dims as they resolve (attempt fetch, bucket
  // recompute) — subsequent events carry the newest values.
  setEnvelope(patch: Partial<LgEnvelopeBase>): void {
    this.base = { ...this.base, ...patch };
  }

  getEnvelope(): LgEnvelopeBase {
    return { ...this.base };
  }

  pendingCount(): number {
    return this.queue.length;
  }

  // Stamp the envelope + mint event_id/timestamp, then queue. Per-event
  // fields overlay the base (an event may override url etc. — never ids).
  enqueue(eventType: string, fields: Record<string, unknown> = {}): LgBeaconEvent {
    const event: LgBeaconEvent = {
      ...this.base,
      ...fields,
      event_type: eventType,
      event_id: ulidLike(this.adapters.now(), this.adapters.rand),
      timestamp: this.adapters.now(),
    };
    this.queue.push(event);
    if (this.queue.length >= this.maxBatch) {
      this.flush();
    } else if (this.flushHandle === null) {
      this.flushHandle = this.adapters.schedule(() => {
        this.flushHandle = null;
        this.flush();
      }, this.flushDelayMs);
    }
    return event;
  }

  // Drain the queue in ≤maxBatch chunks. Called on batch-full, the micro-batch
  // timer, and by the engine on pagehide/visibilitychange (final flush).
  flush(): void {
    if (this.flushHandle !== null) {
      this.adapters.cancel(this.flushHandle);
      this.flushHandle = null;
    }
    while (this.queue.length > 0) {
      const chunk = this.queue.splice(0, this.maxBatch);
      this.attemptSend(chunk, 0);
    }
  }

  private attemptSend(events: LgBeaconEvent[], attempt: number): void {
    let outcome: boolean | Promise<boolean>;
    try {
      outcome = this.adapters.send(this.url, JSON.stringify({ events }));
    } catch {
      outcome = false;
    }
    if (typeof outcome === "boolean") {
      this.settle(events, attempt, outcome);
      return;
    }
    outcome.then(
      (ok) => this.settle(events, attempt, ok),
      () => this.settle(events, attempt, false),
    );
  }

  private settle(events: LgBeaconEvent[], attempt: number, ok: boolean): void {
    if (ok) {
      this.sentBatches += 1;
      this.sentEvents += events.length;
      return;
    }
    // Bounded retry: delays [attempt] — after the last delay fails, the batch
    // is DROPPED (fire-and-forget posture; beacons must never accumulate
    // unbounded work or outlive the KV dedupe window).
    const delay = this.retryDelaysMs[attempt];
    if (delay === undefined) {
      this.droppedEvents += events.length;
      return;
    }
    const retry: PendingRetry = { events, attempt: attempt + 1, handle: null };
    retry.handle = this.adapters.schedule(() => {
      this.retries = this.retries.filter((r) => r !== retry);
      this.attemptSend(retry.events, retry.attempt);
    }, delay);
    this.retries.push(retry);
  }

  pendingRetryCount(): number {
    return this.retries.length;
  }
}
