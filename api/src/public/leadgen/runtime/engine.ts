// LeadGen runtime — engine orchestrator (fix-contract v2.4 03 §3.2 engine.ts
// row; lifecycle §3.5 steps 1–8; preview duties 09 §9.1; A/B dims 10 §10.4).
//
// BUNDLE ENTRY: scripts/build-leadgen-runtime.ts esbuilds THIS file (IIFE,
// es2019, minified) into engine-bundle.generated.ts, served at
// GET /lg/runtime/{LEADGEN_TEMPLATE_VERSION}.js. The auto-boot at the bottom
// is guarded by typeof checks so importing this module under node stays
// inert (vitest tests the DOM-free cores directly; THIS module is exercised
// by the Group-1 Playwright suite).
//
// Shell contract consumed (03 §3.2 serve.ts row — a sibling slice renders it):
//   * <script type="application/json" id="lg-config"> — LeadgenPublicConfig;
//   * window.__LG_ASSIGNMENT__ — per-request A/B dims (bucket null; the
//     client recomputes it via the ab-hash.ts §16.2 contract, see
//     computeAssignmentBucket);
//   * window.__LG_PREHYDRATE_QUEUE__ — clicks queued by the inline stub
//     before hydration; REPLAYED on init;
//   * sections server-rendered as [data-lg-section] blocks with §3.3 hooks;
//   * `data-lg-preview="1"` → preview mode (09 §9.1): real beacons suppressed
//     (would-fire events postMessage'd to the parent for the Studio panel),
//     auction call disabled, validation/dependencies/state identical.
//
// 03 §3.9 hard boundaries: no framework; no localStorage (sessionStorage
// only); no non-/lg network calls; GA4 untouched; no Listicles state.

import {
  LgStateStore,
  scanForRestorableSnapshot,
  storageKeyForAttempt,
  type LgAnswerSource,
  type LgBindingTuple,
  type LgComponentConfig,
  type LgConditional,
  type LgPublicConfig,
  type LgSectionConfig,
  type LgStorageAdapter,
} from "./state";
import {
  conditionMet,
  buildCtxFields,
  evaluateComponents,
  hiddenAnswerFields,
  visibleSectionIndexes,
  type LgConditionGroup,
  type LgDependencyState,
} from "./dependencies";
import { formatKindFor, normalizePhoneE164, validateSection } from "./validation";
import { LgBeaconClient, ulidLike, type LgSendFn } from "./events";
import * as render from "./render";
import { wireMapsFields } from "./maps";
import {
  observeImpressions,
  postAuction,
  type LgAuctionRequest,
  type LgAuctionResponse,
} from "./auction-client";

export const LG_ENGINE_VERSION = "3"; // tracks LEADGEN_TEMPLATE_VERSION (cache-keys.ts)

const LG_ATTEMPT_URL = "/lg/attempt";
const SESSION_COOKIE = "ko_sid";
const SESSION_COOKIE_MAX_AGE = 1800; // listicle runtime.ts convention
const ANSWER_CHANGE_DEBOUNCE_MS = 400;
// §3.5.8: retry ×2 with backoff, then the inline notice.
const ATTEMPT_RETRY_DELAYS_MS = [800, 2400];
const AUCTION_RETRY_DELAYS_MS = [1000, 3000];
const FRIENDLY_ERROR =
  "We're having trouble loading the next step. Please check your connection and try again.";

// ---------------------------------------------------------------------------
// Browser adapters (kept OUT of the DOM-free cores)
// ---------------------------------------------------------------------------

function readCookie(name: string): string {
  try {
    const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    if (m === null) return "";
    try {
      return decodeURIComponent(m[1] ?? "");
    } catch {
      return m[1] ?? "";
    }
  } catch {
    return "";
  }
}

function randBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

// ko_sid: read the readable session cookie (Path=/, Max-Age=1800,
// SameSite=Lax — NOT httpOnly; experiment-pick.ts/listicle runtime
// convention); mint + set it when absent, exactly like the listicle client.
function resolveSessionId(): string {
  const existing = readCookie(SESSION_COOKIE);
  if (existing !== "") return existing;
  let sid = "";
  try {
    sid = crypto.randomUUID();
  } catch {
    sid = `ko-${Date.now().toString(36)}-${ulidLike(Date.now(), randBytes).slice(10).toLowerCase()}`;
  }
  try {
    document.cookie = `${SESSION_COOKIE}=${encodeURIComponent(sid)};path=/;max-age=${SESSION_COOKIE_MAX_AGE};SameSite=Lax`;
  } catch {
    /* cookie write best-effort */
  }
  return sid;
}

// 11 §11.2 history_fallback leg: true iff document.referrer is a same-origin
// URL (the only case a browser history.back() stays on this site). Guarded —
// a malformed referrer / sandboxed context yields false, never a throw.
function sameOriginReferrer(): boolean {
  try {
    const ref = document.referrer;
    return ref !== "" && new URL(ref).origin === location.origin;
  } catch {
    return false;
  }
}

// sessionStorage behind the adapter (private-mode access can throw — every
// call is guarded; a throwing storage degrades to "no persistence").
function sessionStorageAdapter(): LgStorageAdapter {
  return {
    get(key) {
      try {
        return window.sessionStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        window.sessionStorage.setItem(key, value);
      } catch {
        /* quota/privacy → volatile state */
      }
    },
    remove(key) {
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
    keys() {
      try {
        const out: string[] = [];
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const k = window.sessionStorage.key(i);
          if (k !== null) out.push(k);
        }
        return out;
      } catch {
        return [];
      }
    },
  };
}

// Real transport: navigator.sendBeacon first (survives unload), fetch
// keepalive fallback (03 §3.2 events.ts row).
function browserSender(): LgSendFn {
  return (url, body) => {
    try {
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        const blob = new Blob([body], { type: "application/json" });
        if (navigator.sendBeacon(url, blob)) return true;
      }
    } catch {
      /* fall through to fetch */
    }
    try {
      return fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        keepalive: true,
        body,
      }).then(
        (res) => res.ok || res.status === 204,
        () => false,
      );
    } catch {
      return false;
    }
  };
}

// Preview transport (09 §9.1): would-fire events go to the parent frame for
// the Studio "events that would fire" panel — NEVER to production ingest
// (10 §10.5). Message shape: { type: "lg-preview-event", events: [...] }.
function previewSender(): LgSendFn {
  return (_url, body) => {
    try {
      let events: unknown = [];
      try {
        events = (JSON.parse(body) as { events?: unknown }).events ?? [];
      } catch {
        events = [];
      }
      window.parent.postMessage({ type: "lg-preview-event", events }, "*");
      return true;
    } catch {
      return true; // preview transport never retries
    }
  };
}

// §16.2 client bucket recomputation (10 §10.4) — MUST equal ab-hash.ts
// abBucket: SHA-256 over `${test_id}:${revision}:${session_id}`, first 4
// digest bytes as a big-endian uint32, % 10000. crypto.subtle unavailable /
// failing → null (bucket rides as "" — never a wrong value).
export async function computeAssignmentBucket(
  abTestId: string,
  revision: number,
  sessionId: string,
): Promise<number | null> {
  try {
    const data = new TextEncoder().encode(`${abTestId}:${revision}:${sessionId}`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const b = new Uint8Array(digest);
    const word =
      (((b[0] ?? 0) << 24) | ((b[1] ?? 0) << 16) | ((b[2] ?? 0) << 8) | (b[3] ?? 0)) >>> 0;
    return word % 10000;
  } catch {
    return null;
  }
}

type LgAcquisitionKey =
  | "utm_source"
  | "utm_medium"
  | "utm_content"
  | "fbclid"
  | "cpc"
  | "placement"
  | "sub1"
  | "sub2"
  | "sub3"
  | "sub4"
  | "sub5";

function acquisitionParams(search: string): Partial<Record<LgAcquisitionKey, string>> {
  const out: Partial<Record<LgAcquisitionKey, string>> = {};
  try {
    const params = new URLSearchParams(search);
    const keys: LgAcquisitionKey[] = [
      "utm_source",
      "utm_medium",
      "utm_content",
      "fbclid",
      "cpc",
      "placement",
      "sub1",
      "sub2",
      "sub3",
      "sub4",
      "sub5",
    ];
    for (const key of keys) {
      const v = params.get(key);
      if (v !== null && v !== "") out[key] = v;
    }
  } catch {
    /* malformed search → no acquisition dims */
  }
  return out;
}

// ---------------------------------------------------------------------------
// /lg/attempt (§3.5.1 / §3.8) — vid + u ALWAYS (u persists the original
// landing traffic params server-side), no-store, retry ×2 (§3.5.8).
// ---------------------------------------------------------------------------

interface LgAttempt {
  funnel_attempt_id: string;
  signed_config_token: string;
  // The session id the server BOUND into the signed tuple (echoed by
  // /lg/attempt — minted server-side when the ko_sid cookie was absent, e.g.
  // cookie-blocked visitors). The engine must use EXACTLY this value for
  // /lg/auction or the v2 session binding rejects (422 tampered).
  session_id?: string;
  expires_at?: number;
  // 10C conditional-display ctx the server MAY echo (visitor geo/device) for
  // __state/__device rules — tolerant of absence (the emitting server leg is a
  // P3/P4 seam; until then a rule on those keys is fail-closed). Merged only
  // into the evaluation map, NEVER sent back to /lg/auction.
  ctx?: { state?: string; device?: string };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Tolerant parse of the OPTIONAL /lg/attempt ctx echo (10C). Only non-empty
// string state/device are adopted; anything else — or absence — yields null so
// the caller omits ctx and __state/__device stay fail-closed.
function parseAttemptCtx(raw: unknown): { state?: string; device?: string } | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: { state?: string; device?: string } = {};
  if (typeof r["state"] === "string" && r["state"] !== "") out.state = r["state"];
  if (typeof r["device"] === "string" && r["device"] !== "") out.device = r["device"];
  return out.state === undefined && out.device === undefined ? null : out;
}

async function fetchAttemptOnce(funnelVariantId: string): Promise<LgAttempt | null> {
  try {
    const url = `${LG_ATTEMPT_URL}?vid=${encodeURIComponent(funnelVariantId)}&u=${encodeURIComponent(location.href)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as Record<string, unknown>;
    if (typeof raw["funnel_attempt_id"] !== "string" || raw["funnel_attempt_id"] === "") return null;
    const ctx = parseAttemptCtx(raw["ctx"]);
    return {
      funnel_attempt_id: raw["funnel_attempt_id"],
      signed_config_token:
        typeof raw["signed_config_token"] === "string" ? raw["signed_config_token"] : "",
      ...(typeof raw["session_id"] === "string" && raw["session_id"] !== ""
        ? { session_id: raw["session_id"] }
        : {}),
      ...(typeof raw["expires_at"] === "number" ? { expires_at: raw["expires_at"] } : {}),
      ...(ctx !== null ? { ctx } : {}),
    };
  } catch {
    return null;
  }
}

async function fetchAttemptWithRetry(funnelVariantId: string): Promise<LgAttempt | null> {
  let attempt = await fetchAttemptOnce(funnelVariantId);
  for (let i = 0; attempt === null && i < ATTEMPT_RETRY_DELAYS_MS.length; i++) {
    await sleep(ATTEMPT_RETRY_DELAYS_MS[i] ?? 1000);
    attempt = await fetchAttemptOnce(funnelVariantId);
  }
  return attempt;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

interface LgAssignmentGlobal {
  funnel_ab_test_id?: string;
  funnel_ab_test_revision?: number;
  variant_label?: string;
  traffic_allocation_bp?: number;
  funnel_variant_id?: string;
  assignment_bucket?: number | null;
  assignment_reason?: string;
}

export class LgEngine {
  readonly preview: boolean;
  private readonly root: HTMLElement;
  private readonly config: LgPublicConfig;
  private readonly store: LgStateStore;
  private readonly beacons: LgBeaconClient;
  private readonly firedImpressions = new Set<string>();
  private readonly debounceTimers: Record<string, unknown> = {};
  private finalized = false;
  // 10C ctx (geo/device) captured from the /lg/attempt echo — merged into the
  // evaluation map by evalAnswers(), never persisted, never sent to /lg/auction.
  private ctx: { state?: string; device?: string } = {};

  constructor(root: HTMLElement, config: LgPublicConfig, preview: boolean) {
    this.root = root;
    this.config = config;
    this.preview = preview;
    this.store = new LgStateStore({ storage: sessionStorageAdapter(), now: () => Date.now() });
    this.beacons = new LgBeaconClient({
      send: preview ? previewSender() : browserSender(),
      now: () => Date.now(),
      rand: randBytes,
      schedule: (fn, ms) => setTimeout(fn, ms),
      cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    });
  }

  // ----- §3.5.1 init ------------------------------------------------------

  async init(): Promise<void> {
    const config = this.config;
    const sessionId = resolveSessionId();
    const pageViewId = ulidLike(Date.now(), randBytes);
    const tuple: LgBindingTuple = {
      funnel_variant_id: config.funnel_variant_id,
      section_order_hash: config.section_order_hash,
      content_version: config.content_version,
    };

    // A/B dims (10 §10.4): the spliced per-request assignment global wins;
    // the cacheable config carries the same variant-scoped values as backup.
    const assignment = (window as unknown as { __LG_ASSIGNMENT__?: LgAssignmentGlobal })
      .__LG_ASSIGNMENT__;
    const abTestId = assignment?.funnel_ab_test_id ?? config.funnel_ab_test_id;
    const abRevision = assignment?.funnel_ab_test_revision ?? config.funnel_ab_test_revision;
    const variantLabel = assignment?.variant_label ?? config.variant_label;
    const assignmentReason = assignment?.assignment_reason ?? config.assignment_reason;

    this.beacons.setEnvelope({
      session_id: sessionId,
      page_view_id: pageViewId,
      quote_id: config.quote_id,
      funnel_id: config.funnel_id,
      funnel_variant_id: config.funnel_variant_id,
      funnel_ab_test_id: abTestId,
      funnel_ab_test_revision: abRevision,
      variant_label: variantLabel,
      assignment_reason: assignmentReason,
      section_order_hash: config.section_order_hash,
      url: location.href,
      referer: document.referrer,
      language: typeof navigator !== "undefined" ? navigator.language || "" : "",
      ...acquisitionParams(location.search),
    });

    // §16.2 bucket recompute BEFORE the first beacon so every event carries
    // it (ab_hash path only; single_control has no bucket).
    if (abTestId !== "") {
      const bucket = await computeAssignmentBucket(abTestId, abRevision, sessionId);
      if (bucket !== null) this.beacons.setEnvelope({ assignment_bucket: String(bucket) });
    }

    // /lg/attempt (skipped in preview: the Studio iframe has no tenant
    // origin; the auction is disabled there anyway — 09 §9.1).
    let attemptFailed = false;
    let attempt: LgAttempt | null = null;
    if (this.preview) {
      attempt = {
        funnel_attempt_id: `att_preview_${ulidLike(Date.now(), randBytes)}`,
        signed_config_token: "",
      };
    } else {
      attempt = await fetchAttemptWithRetry(config.funnel_variant_id);
      if (attempt === null) attemptFailed = true;
    }

    // m2 (cookie-blocked visitors): the server ECHOES the session id it bound
    // into the signed tuple (minted server-side when no ko_sid cookie rode
    // the attempt request). Adopt it — /lg/auction must post EXACTLY the
    // bound value or the v2 session binding rejects — and keep the beacon
    // envelope on the same id for attribution consistency.
    const boundSessionId =
      attempt?.session_id !== undefined && attempt.session_id !== ""
        ? attempt.session_id
        : sessionId;
    this.store.bindIdentity({
      session_id: boundSessionId,
      page_view_id: pageViewId,
      funnel_attempt_id: attempt?.funnel_attempt_id ?? "",
      signed_config_token: attempt?.signed_config_token ?? "",
      tuple,
    });
    if (attempt !== null) {
      this.beacons.setEnvelope({
        funnel_attempt_id: attempt.funnel_attempt_id,
        ...(boundSessionId !== sessionId ? { session_id: boundSessionId } : {}),
      });
      // 10C: adopt the server ctx echo (geo/device) for __state/__device rules.
      if (attempt.ctx !== undefined) this.ctx = attempt.ctx;
    }

    // §3.5.1 restore iff same attempt-binding tuple (see state.ts header for
    // the cross-reload key mechanics). Skipped in preview (fresh every time).
    if (!this.preview && attempt !== null) {
      const storage = sessionStorageAdapter();
      const hit = scanForRestorableSnapshot(storage, tuple);
      if (hit !== null) {
        this.store.adoptSnapshot(hit.snapshot);
        if (hit.key !== storageKeyForAttempt(attempt.funnel_attempt_id)) {
          storage.remove(hit.key); // re-key the state under the new attempt id
        }
        this.persist();
      }
    }

    // Bind interaction, wire maps (E6: injects the Places SDK itself when the
    // shell spliced __LG_MAPS_KEY__ and a [data-lg-maps] field exists — then
    // re-runs the field wiring on ready), render the current step.
    this.bindListeners();
    wireMapsFields(this.root, {
      setAnswer: (field, value, meta) => {
        this.writeAnswer(field, value, {
          question_id: meta.question_id,
          section_public_id: this.currentSection()?.section_public_id ?? "",
        });
      },
      emit: (type, fields) => {
        this.beacons.enqueue(type, { ...this.sectionDims(this.currentSection()), ...fields });
      },
    });

    // Land on a VISIBLE section (the restored pointer may now be hidden).
    // section_view for it fires AFTER quote_view below (§3.5.1 ordering).
    const startIndex = this.normalizeSectionIndex(this.si);
    this.store.setSectionIndex(startIndex);
    this.enterSection(startIndex, null, /*fireView*/ false);

    // Hydration complete (§3.5.1): the anti-false-PASS suite keys on this.
    this.root.setAttribute("data-lg-ready", "1");

    // Funnel-entry beacons FIRST (§3.5.1 ordering): quote_view + the visible
    // section's section_view precede any replayed pre-hydration click, so a
    // replayed answer_click always sequences AFTER the view events.
    this.beacons.enqueue("quote_view", this.sectionDims(this.currentSection()));
    this.fireSectionView(this.currentSection(), null);

    // Replay clicks queued by the inline stub BEFORE hydration.
    this.replayPrehydrateQueue();

    if (attemptFailed) {
      // §3.5.8: never a blank page; the server HTML is already interactive,
      // the notice explains the degraded step. Beacons continue regardless.
      render.showRuntimeNotice(this.currentSectionEl() ?? this.root, FRIENDLY_ERROR);
    }

    // Final flush on page exit (sendBeacon path).
    try {
      addEventListener("pagehide", () => this.beacons.flush());
      addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") this.beacons.flush();
      });
    } catch {
      /* listeners best-effort */
    }

    this.exposeEngine();
  }

  // ----- config/derived helpers -------------------------------------------

  // The current step pointer — one read-alias for the store's section index
  // (read in ~6 places; the writer stays store.setSectionIndex).
  private get si(): number {
    return this.store.state.section_index;
  }

  // The {question_id, section_public_id} write-meta both answer handlers build
  // identically — one shape, two call sites.
  private answerMeta(
    questionId: string,
    section: LgSectionConfig | null,
  ): { question_id: string; section_public_id: string } {
    return { question_id: questionId, section_public_id: section?.section_public_id ?? "" };
  }

  private currentSection(): LgSectionConfig | null {
    return this.config.sections[this.si] ?? null;
  }

  private currentSectionEl(): HTMLElement | null {
    return render.sectionElementAt(this.root, this.si);
  }

  private sectionConfigFor(el: Element | null): LgSectionConfig | null {
    if (el === null) return null;
    const sectionEl = el.closest("[data-lg-section]");
    if (sectionEl === null) return this.currentSection();
    const id = sectionEl.getAttribute("data-lg-section-id") ?? "";
    const byId = this.config.sections.find((s) => s.section_public_id === id);
    if (byId !== undefined) return byId;
    const index = Number(sectionEl.getAttribute("data-lg-index"));
    return this.config.sections[Number.isNaN(index) ? -1 : index] ?? this.currentSection();
  }

  private sectionDims(section: LgSectionConfig | null): Record<string, unknown> {
    if (section === null) return {};
    return {
      section_id: section.section_public_id,
      section_index: section.section_index,
      continue_mode: section.continue_mode,
      section_mapping_version: section.section_mapping_version,
      answer_mapping_version: section.answer_mapping_version,
    };
  }

  private componentByQuestionId(
    section: LgSectionConfig | null,
    questionId: string,
  ): LgComponentConfig | null {
    const scan = (s: LgSectionConfig): LgComponentConfig | null =>
      s.components.find((component) => component.question_id === questionId) ?? null;
    if (section !== null) {
      const hit = scan(section);
      if (hit !== null) return hit;
    }
    for (const s of this.config.sections) {
      const hit = scan(s);
      if (hit !== null) return hit;
    }
    return null;
  }

  // The condition-evaluation map: the persisted answers UNION the 10C ctx
  // fields (__page/__hour/__weekday + __state/__device when the attempt echoed
  // them). ALL show/hide/require/continue/section-visibility reads go through
  // this ONE map so a component's visibility is computed identically everywhere
  // (never a divergence between what's shown and what's auction-projected). The
  // ctx keys live ONLY in this transient object — the store (which the auction
  // projection + persistence read) is never given a `__` key, so they can never
  // reach the wire nor a progress/answered count.
  private evalAnswers(): Record<string, unknown> {
    return {
      ...this.store.answerValues(),
      ...buildCtxFields({
        page: this.si,
        now: new Date(),
        state: this.ctx.state,
        device: this.ctx.device,
      }),
    };
  }

  private dependencyState(section: LgSectionConfig): LgDependencyState {
    return evaluateComponents(section.components, this.evalAnswers());
  }

  private hiddenFields(): Set<string> {
    return hiddenAnswerFields(this.config.sections, this.evalAnswers());
  }

  private visibleIndexes(): number[] {
    return visibleSectionIndexes(this.config.sections, this.evalAnswers());
  }

  private normalizeSectionIndex(wanted: number): number {
    const visible = this.visibleIndexes();
    if (visible.length === 0) return 0;
    if (visible.indexOf(wanted) !== -1) return wanted;
    for (const index of visible) if (index >= wanted) return index;
    return visible[visible.length - 1] ?? 0;
  }

  private persist(): void {
    if (this.preview) return; // preview never persists (fresh per srcdoc)
    this.store.persist(this.hiddenFields());
  }

  // ----- listeners ---------------------------------------------------------

  private bindListeners(): void {
    this.root.addEventListener("click", (raw) => {
      const target = raw.target;
      if (!(target instanceof Element)) return;
      const choice = target.closest("[data-lg-choice]");
      if (choice !== null && this.root.contains(choice)) {
        this.handleChoiceActivation(choice);
        return;
      }
      const other = target.closest("[data-lg-other-trigger]");
      if (other !== null) {
        render.openOtherPanel(other);
        return;
      }
      const cont = target.closest("[data-lg-continue]");
      if (cont !== null) {
        this.handleContinue();
        return;
      }
      const back = target.closest("[data-lg-back]");
      if (back !== null) {
        this.handleBack();
      }
    });

    const onInput = (raw: Event): void => {
      const target = raw.target;
      if (!(target instanceof Element) || target.closest("[data-lg-input]") === null) return;
      this.handleInputEvent(target);
    };
    this.root.addEventListener("input", onInput);
    this.root.addEventListener("change", onInput, true);
  }

  private replayPrehydrateQueue(): void {
    const queue = (window as unknown as { __LG_PREHYDRATE_QUEUE__?: unknown[] })
      .__LG_PREHYDRATE_QUEUE__;
    if (!Array.isArray(queue)) return;
    for (const item of queue.splice(0, queue.length)) {
      let el: Element | null = null;
      if (typeof item === "string") {
        try {
          el = this.root.querySelector(item) ?? document.querySelector(item);
        } catch {
          el = null;
        }
      } else if (item instanceof Element) {
        el = item;
      } else if (item !== null && typeof item === "object") {
        // The inline stub queues `{el, t}` (serve.ts LEADGEN_PREHYDRATE_JS) —
        // unwrap the element; string|Element items stay tolerated above.
        const wrapped = (item as { el?: unknown }).el;
        if (wrapped instanceof Element) el = wrapped;
      }
      if (el === null) continue;
      const choice = el.closest("[data-lg-choice]");
      if (choice !== null) this.handleChoiceActivation(choice);
      else if (el.closest("[data-lg-continue]") !== null) this.handleContinue();
      else if (el.closest("[data-lg-other-trigger]") !== null) render.openOtherPanel(el);
    }
  }

  // ----- answers (§3.4 / §3.5.3) ------------------------------------------

  private writeAnswer(
    internalField: string,
    value: unknown,
    meta: { question_id: string; section_public_id: string },
  ): LgAnswerSource {
    const write = this.store.recordUserAnswer(internalField, value, meta);
    this.afterAnswerMutation();
    return write.entry.answer_source;
  }

  private afterAnswerMutation(): void {
    const section = this.currentSection();
    if (section !== null) {
      const sectionEl = this.currentSectionEl();
      if (sectionEl !== null) {
        render.applyComponentVisibility(sectionEl, this.dependencyState(section).components);
        this.applyContinueVisibility(section, sectionEl);
      }
    }
    this.updateProgressUi();
    this.persist();
  }

  // P4c (register PC-12): section-level Continue visibility. `continue_
  // visible_when` is not part of the declared LgSectionConfig shape (kept a
  // hand-maintained LOCAL mirror per the state.ts module header) — it is
  // read here via a narrow, defensive cast, exactly like an untyped JSON
  // field the config legitimately carries. Absent ⇒ no-op (byte-identical
  // pre-P4c: Continue stays unconditionally visible).
  private applyContinueVisibility(section: LgSectionConfig, sectionEl: Element): void {
    const cond = (
      section as unknown as { continue_visible_when?: LgConditional | LgConditionGroup }
    ).continue_visible_when;
    if (cond === undefined) return;
    render.setContinueVisible(sectionEl, conditionMet(cond, this.evalAnswers()));
  }

  private handleChoiceActivation(choiceEl: Element): void {
    const questionEl = choiceEl.closest("[data-lg-question]");
    const questionId = questionEl?.getAttribute("data-lg-question") ?? "";
    const section = this.sectionConfigFor(choiceEl);
    const component = this.componentByQuestionId(section, questionId);
    const internalField =
      component?.internal_field ??
      choiceEl.closest("[data-lg-field]")?.getAttribute("data-lg-field") ??
      "";
    if (internalField === "") return;

    // Typed value: the attribute is a string; the config round-trips the
    // authored type (number/boolean choices stay typed for eq-parity).
    //
    // P4c INVESTIGATION NOTE — RESOLVED (conductor fix, register PC-12,
    // 2026-07-17): a TwoButtonYesNo carries no `choices` array, so
    // choiceConfig is always undefined for it and this fallback records the
    // RAW STRING "true"/"false" — never a real boolean — for a LIVE click,
    // while a conditional/requiredWhen/continue_visible_when authored through
    // ANY typed studio picker against a boolean `when` field stores a REAL
    // boolean (typedScalar's boolean branch). The RECORDING here is
    // DELIBERATELY left unchanged (ruling: fix the evaluator, not the
    // recording — coercing this fallback to a real boolean would change the
    // TYPE of value flowing into the auction payload, a money-path risk, and
    // would ripple through already-shipped E2E fixtures that assert the raw
    // string — leadgen-fix-p1-seed.ts, leadgen-p3a-placement.gesture.spec.ts
    // x2, leadgen-runtime-inputs.gesture.spec.ts). Instead the DEPENDENCY
    // EVALUATOR treats true≡"true"/false≡"false" for eq/neq/in/not_in, so a
    // picker-authored rule against this field's live-clicked string DOES fire
    // correctly (Show-if/Require-if/Continue-visibility all resolve through
    // it) — see runtime/dependencies.ts's module header for the full ruling.
    // FULL PARITY (same-day follow-up, commit eb06ddd): the identical
    // normalizeBoolShape treatment also landed in payload.ts's conditionalMet
    // (payload.ts:1089) — the SAME evaluator payload-build's node-drop and
    // auction-rules.ts's conditionsMatch (offer/carrier eligibility) share —
    // so client and server now agree on the full boolean/string equivalence
    // grid (see leadgen-runtime-engine.test.ts's dedicated cross-product).
    // There is no remaining server-side gap. leadgen-p3a-placement.gesture.
    // spec.ts's "grounded via a live debug probe" fixture and leadgen-p4c-
    // rules.gesture.spec.ts's choice-based workaround remain valid (string-
    // vs-string was never the broken case); leadgen-p4a-behavior.spec.ts /
    // the p4c-rules spec's leg 4 prove the previously-stuck boolean-picker-
    // vs-live-click case now reveals live.
    const attrValue = choiceEl.getAttribute("data-lg-choice") ?? "";
    const choiceConfig = component?.choices?.find((c) => String(c.value) === attrValue);
    let value: unknown = choiceConfig !== undefined ? choiceConfig.value : attrValue;

    // Multi-select components toggle membership (answer is an array).
    const multi = component?.answer_type === "array" || component?.props?.["multiple"] === true;
    if (multi) {
      const existing = this.store.getAnswer(internalField)?.value;
      const list = Array.isArray(existing) ? [...existing] : [];
      const pos = list.findIndex((v) => v === value);
      if (pos === -1) list.push(value);
      else list.splice(pos, 1);
      value = list;
    }

    const meta = this.answerMeta(questionId, section);
    const write = this.store.recordUserAnswer(internalField, value, meta);
    if (questionEl !== null) render.applySelectionClasses(questionEl, value);
    this.afterAnswerMutation();

    this.beacons.enqueue("answer_click", {
      ...this.sectionDims(section),
      question_id: questionId,
      question_key: component?.question_key ?? "",
      internal_field: internalField,
      answer_id: choiceConfig?.analytics_id ?? "",
      answer_value_normalized: Array.isArray(value) ? value.map(String).join(",") : String(value),
      answer_source: write.entry.answer_source,
    });

    // §3.5.4 auto-advance: single-question sections advance on answer_click
    // after validation; multi-question sections require Continue regardless.
    if (section !== null && section.continue_mode === "auto_advance" && !multi) {
      const deps = this.dependencyState(section);
      const interactive = section.components.filter(
        (c, i) =>
          (c.internal_field ?? "") !== "" && deps.components[i]?.visible === true,
      );
      if (interactive.length === 1 && this.sectionPasses(section)) {
        this.advance();
      }
    }
  }

  private handleInputEvent(target: Element): void {
    const input = target.closest("[data-lg-input]") ?? target;
    const fieldEl = input.closest("[data-lg-field]");
    const questionEl = input.closest("[data-lg-question]");
    const questionId = questionEl?.getAttribute("data-lg-question") ?? "";
    const section = this.sectionConfigFor(input);
    const component = this.componentByQuestionId(section, questionId);
    let internalField =
      fieldEl?.getAttribute("data-lg-field") ?? component?.internal_field ?? "";
    // PC-A2 (P4b): NameFieldsGroup carries no single internal_field, so its two
    // sub-inputs (data-name-field="first"/"last") were captured NOWHERE — the
    // group's answers were silently lost and its `required` never enforceable.
    // Map the sub-input's slot to the group's configured field (props.fields,
    // default first/last), so each sub-answer is recorded under its real field
    // (matching the server's answers.ts fieldsOf) and validateSection's
    // group-required check can see it. Address parts are filled via the Places
    // path (maps.ts setAnswer), so only the name slots need this capture bridge.
    if (internalField === "") {
      const slot = input.getAttribute("data-name-field");
      if ((slot === "first" || slot === "last") && component?.type === "NameFieldsGroup") {
        const fields = component.props?.["fields"];
        const idx = slot === "first" ? 0 : 1;
        const mapped = Array.isArray(fields) && typeof fields[idx] === "string" ? (fields[idx] as string) : slot;
        internalField = mapped;
      }
    }
    if (internalField === "") return;

    let value: unknown = "";
    if (input instanceof HTMLInputElement) {
      value = input.type === "checkbox" ? input.checked : input.value;
    } else if ("value" in input && typeof (input as { value: unknown }).value === "string") {
      value = (input as { value: string }).value;
    }

    // m12: ZIP-format inputs STORE the trimmed value at capture (" 90210" →
    // "90210") so the client-passing answer also passes the server's strict
    // /^\d{5}$/ — validation semantics on either side stay unchanged.
    if (component !== null && typeof value === "string" && formatKindFor(component) === "zip") {
      value = value.trim();
    }
    // PC-A4 (P4b): a VALID phone stores its E.164 normal form ("(415) 555-1234"
    // → "+14155551234") so the recorded/submitted answer is canonical. Only on
    // pass — an invalid entry keeps the raw text so the visitor sees what they
    // typed alongside the (now visible) error. Idempotent (E.164 re-normalizes
    // to itself); prior stored answers are untouched (never re-captured).
    if (component !== null && typeof value === "string" && formatKindFor(component) === "phone") {
      const e164 = normalizePhoneE164(value);
      if (e164 !== null) value = e164;
    }

    const meta = this.answerMeta(questionId, section);
    const write = this.store.recordUserAnswer(internalField, value, meta);
    // S2-3 (register §C): a range slider moves its own visible value text +
    // filled track live as it is dragged (input fires continuously).
    if (input instanceof HTMLInputElement && input.type === "range") {
      render.updateRangeDisplay(input);
    }
    // Editing clears the field's stale error immediately.
    const sectionEl = this.currentSectionEl();
    if (sectionEl !== null) render.setFieldError(sectionEl, internalField, null);
    this.afterAnswerMutation();

    // Debounced answer_change (§3.5.3).
    const pending = this.debounceTimers[internalField];
    if (pending !== undefined && pending !== null) {
      clearTimeout(pending as ReturnType<typeof setTimeout>);
    }
    this.debounceTimers[internalField] = setTimeout(() => {
      this.debounceTimers[internalField] = null;
      this.beacons.enqueue("answer_change", {
        ...this.sectionDims(section),
        question_id: questionId,
        question_key: component?.question_key ?? "",
        internal_field: internalField,
        answer_value_normalized: String(this.store.getAnswer(internalField)?.value ?? ""),
        answer_source: write.entry.answer_source,
      });
    }, ANSWER_CHANGE_DEBOUNCE_MS);
  }

  // ----- validation + navigation (§3.5.4–5) --------------------------------

  private sectionPasses(section: LgSectionConfig): boolean {
    const deps = this.dependencyState(section);
    const failures = validateSection(section.components, this.evalAnswers(), deps.components);
    const sectionEl = this.currentSectionEl();
    if (sectionEl !== null) render.clearFieldErrors(sectionEl);
    if (failures.length === 0) return true;

    const seen = new Set<string>();
    for (const failure of failures) {
      if (sectionEl !== null && !seen.has(failure.internal_field)) {
        render.setFieldError(sectionEl, failure.internal_field, failure.message);
      }
      if (!seen.has(failure.internal_field)) {
        seen.add(failure.internal_field);
        // One validation_error per failing field (§3.5.4); the rule code
        // rides answer_value_normalized (not an issue-31 reason column).
        this.beacons.enqueue("validation_error", {
          ...this.sectionDims(section),
          question_id: failure.question_id,
          internal_field: failure.internal_field,
          answer_value_normalized: failure.code,
        });
      }
    }
    return false;
  }

  private handleContinue(): void {
    const section = this.currentSection();
    if (section === null) return;
    this.beacons.enqueue("continue_click", this.sectionDims(section));
    if (!this.sectionPasses(section)) return;
    this.advance();
  }

  // 11 §11.2 history_fallback (v2.5, additive + default-safe): armed ONLY when
  // a frame-rendered back region carries data-history-fallback="true" (legacy
  // shells emit none → both legs below behave exactly as before) AND the
  // referrer is same-origin AND this is not the Studio preview iframe.
  private historyFallbackArmed(): boolean {
    if (this.preview) return false;
    if (this.root.querySelector('[data-history-fallback="true"]') === null) return false;
    return sameOriginReferrer();
  }

  private handleBack(): void {
    const previous = this.store.popBack();
    if (previous === undefined) {
      // §11.2: empty back stack + same-origin referrer → browser history.
      if (this.historyFallbackArmed()) {
        try {
          history.back();
        } catch {
          /* best-effort */
        }
      }
      return;
    }
    this.store.setSectionIndex(previous);
    this.enterSection(previous, "back");
    this.persist();
  }

  private advance(): void {
    const section = this.currentSection();
    const current = this.si;
    this.beacons.enqueue("section_continue", {
      ...this.sectionDims(section),
      continued_to_next_section: true,
    });

    const visible = this.visibleIndexes();
    const pos = visible.indexOf(current);
    const nextIndex =
      pos !== -1 ? visible[pos + 1] : visible.find((index) => index > current);

    if (nextIndex === undefined) {
      // §3.5.6: advancing past the LAST visible section — and never before —
      // triggers the auction.
      void this.finalize();
      return;
    }
    this.store.pushBack(current);
    this.store.setSectionIndex(nextIndex);
    this.enterSection(nextIndex, null);
    this.persist();
  }

  // Section entry (§3.5.2 + §3.4 defaults): apply defaults once, show the
  // section, progress/back/focus, section_view (nav="back" on back-nav).
  private enterSection(index: number, nav: "back" | null, fireView = true): void {
    const section = this.config.sections[index] ?? null;
    if (section !== null) this.applySectionDefaults(section);

    const sectionEl = render.showOnlySection(this.root, index);
    if (section !== null && sectionEl !== null) {
      render.applyComponentVisibility(sectionEl, this.dependencyState(section).components);
      this.applyContinueVisibility(section, sectionEl);
      // Restore selection classes for restored/default answers.
      for (const component of section.components) {
        const field = component.internal_field;
        if (field === undefined || field === "") continue;
        const entry = this.store.getAnswer(field);
        if (entry === undefined) continue;
        const questionEl = sectionEl.querySelector(
          `[data-lg-question="${component.question_id.replace(/["\\\]]/g, "\\$&")}"]`,
        );
        // E1-NEW-4 (register §E.2): paint the selected state for ANY answered
        // question on entry (restored OR default_applied). The old `component
        // .choices !== undefined` guard skipped TwoButtonYesNo — config-dto
        // never projects `choices` for it (its yes/no buttons carry data-lg-
        // choice but no choice array), so its default fired an
        // answer_default_applied beacon yet NEVER showed selected.
        // applySelectionClasses is a safe no-op on a question with no
        // [data-lg-choice] children (text/select/range), so dropping the guard
        // is both the fix and byte-lean (no regression for choice-array types,
        // which already matched entry.value against their choices).
        if (questionEl !== null) {
          render.applySelectionClasses(questionEl, entry.value);
        }
      }
      // 11 §11.6: back mounts may be FRAME-level (outside the swapped section
      // elements) since v2.5 — scope the visibility toggle to the funnel ROOT
      // so one state drives every [data-lg-back] mount (per-section legacy
      // mounts toggle identically; hidden sections make it a no-op visually).
      // §11.2: an armed history fallback keeps the affordance visible on an
      // empty stack (the click walks browser history instead).
      render.setBackVisible(
        this.root,
        this.store.state.back_stack.length > 0 || this.historyFallbackArmed(),
      );
      render.focusSection(sectionEl);
    }
    this.updateProgressUi();
    if (fireView) this.fireSectionView(section, nav);
  }

  private fireSectionView(section: LgSectionConfig | null, nav: "back" | null): void {
    this.beacons.enqueue("section_view", {
      ...this.sectionDims(section),
      ...(nav === "back" ? { nav: "back" } : {}),
    });
  }

  // §3.4: on section entry any default_answer is applied ONCE as
  // default_applied (+ answer_default_applied beacon).
  private applySectionDefaults(section: LgSectionConfig): void {
    for (const component of section.components) {
      const field = component.internal_field;
      if (field === undefined || field === "" || component.default_answer === undefined) continue;
      const write = this.store.applyDefault(field, component.default_answer.value, {
        question_id: component.question_id,
        section_public_id: section.section_public_id,
      });
      if (write !== null) {
        this.beacons.enqueue("answer_default_applied", {
          ...this.sectionDims(section),
          question_id: component.question_id,
          question_key: component.question_key ?? "",
          internal_field: field,
          answer_value_normalized: String(write.entry.value),
          answer_source: "default_applied",
        });
      }
    }
  }

  private updateProgressUi(): void {
    const visible = this.visibleIndexes();
    const pos = visible.indexOf(this.si);
    render.updateProgress(this.root, pos === -1 ? 1 : pos + 1, visible.length);
    // 11 §11.3 footer show_on: first = the first VISIBLE section (pos -1
    // normalizes to step 1, matching updateProgress); final = the last
    // visible section (the banners-view leg rides showCompletionState).
    render.updateFooterVisibility(this.root, pos <= 0, pos !== -1 && pos === visible.length - 1);
  }

  // ----- §3.6 auction -------------------------------------------------------

  private buildAuctionRequest(): LgAuctionRequest {
    const hidden = this.hiddenFields();
    const versions: Record<string, string> = {};
    for (const section of this.config.sections) {
      versions[section.section_public_id] = section.answer_mapping_version;
    }
    return {
      funnel_attempt_id: this.store.state.funnel_attempt_id,
      signed_config_token: this.store.state.signed_config_token,
      funnel_variant_id: this.config.funnel_variant_id,
      content_version: this.config.content_version,
      section_order_hash: this.config.section_order_hash,
      answers: this.store.auctionAnswers(hidden),
      answer_mapping_versions: versions,
      session_id: this.store.state.session_id,
      page_view_id: this.store.state.page_view_id,
    };
  }

  private async finalize(): Promise<void> {
    if (this.finalized) return; // §3.6 the auction call happens exactly once
    this.finalized = true;
    this.store.setAuction({ status: "pending" });

    if (this.preview) {
      // 09 §9.1: the auction call is DISABLED in preview; the would-fire
      // completion event still reaches the Studio panel via the transport.
      this.store.setAuction({ status: "unfilled" });
      render.showCompletionState(this.root, "unfilled");
      this.beacons.enqueue("quote_complete", { auction_unfilled_reason: "preview_disabled" });
      return;
    }

    const request = this.buildAuctionRequest();
    let outcome = await postAuction(request);
    for (
      let i = 0;
      !outcome.ok && (outcome.kind === "network" || outcome.kind === "malformed") &&
      i < AUCTION_RETRY_DELAYS_MS.length;
      i++
    ) {
      await sleep(AUCTION_RETRY_DELAYS_MS[i] ?? 1000);
      outcome = await postAuction(request);
    }

    if (!outcome.ok) {
      // §3.5.8: inline notice inside the funnel card; beacons continue.
      this.store.setAuction({ status: "error" });
      this.root.setAttribute("data-lg-auction", "error");
      render.showRuntimeNotice(this.currentSectionEl() ?? this.root, FRIENDLY_ERROR);
      this.finalized = outcome.kind === "tampered"; // network errors may retry via Continue
      return;
    }

    this.completeWithAuction(outcome.response);
  }

  private completeWithAuction(response: LgAuctionResponse): void {
    const filled = response.unfilled !== true && response.banners_html !== "";
    this.store.setAuction({
      status: filled ? "filled" : "unfilled",
      ...(response.auction_result_id !== "" ? { auction_result_id: response.auction_result_id } : {}),
      ...(response.banner_render_id !== "" ? { banner_render_id: response.banner_render_id } : {}),
    });

    render.showCompletionState(this.root, filled ? "filled" : "unfilled");
    const mount = filled ? render.injectBanners(this.root, response.banners_html) : null;

    // §3.5.6: quote_complete fires when the auction response is received —
    // filled or unfilled. State is cleared on quote_complete (§3.2 state row).
    this.beacons.enqueue("quote_complete", {
      auction_result_id: response.auction_result_id,
      banner_render_id: response.banner_render_id,
    });
    this.store.clearPersisted();

    // §3.6 impressions: ≥50% for ≥1s, exactly once per
    // (page_view_id, banner_render_id, slot_index) per event type.
    if (mount !== null && response.impressions.length > 0) {
      observeImpressions(mount, response.impressions, {
        pageViewId: this.store.state.page_view_id,
        firedSet: this.firedImpressions,
        fire: (imp) => {
          this.beacons.enqueue(imp.event_type, {
            offer_id: imp.offer_id,
            placement_id: imp.placement_id,
            carrier_key: imp.carrier_key ?? "",
            carrier_position: imp.slot_index,
            auction_result_id: imp.auction_result_id,
            banner_render_id: imp.banner_render_id,
          });
        },
      });
    }
  }

  // ----- test surface (§3.2 engine row) ------------------------------------

  private exposeEngine(): void {
    const engine = this;
    (window as unknown as { __LG_ENGINE__?: unknown }).__LG_ENGINE__ = {
      version: LG_ENGINE_VERSION,
      preview: this.preview,
      getState: () => ({
        session_id: engine.store.state.session_id,
        page_view_id: engine.store.state.page_view_id,
        funnel_attempt_id: engine.store.state.funnel_attempt_id,
        section_index: engine.si,
        back_stack: [...engine.store.state.back_stack],
        auction: { ...engine.store.state.auction },
      }),
      getAnswers: () => engine.store.answerValues(),
      getBeaconStats: () => ({
        sentBatches: engine.beacons.sentBatches,
        sentEvents: engine.beacons.sentEvents,
        droppedEvents: engine.beacons.droppedEvents,
        pending: engine.beacons.pendingCount(),
      }),
    };
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

export async function bootLeadgenRuntime(): Promise<void> {
  const byId = document.getElementById("lg-funnel-root");
  const mount = document.querySelector("[data-lg-mount]");
  const root =
    byId ??
    (mount !== null && mount.parentElement instanceof HTMLElement ? mount.parentElement : null) ??
    (mount instanceof HTMLElement ? mount : null);
  if (root === null) return;

  const configEl = document.getElementById("lg-config");
  let config: LgPublicConfig | null = null;
  if (configEl !== null) {
    // Dedicated try/catch: a corrupt inline config renders the notice, never
    // a blank page / thrown boot.
    try {
      config = JSON.parse(configEl.textContent ?? "") as LgPublicConfig;
    } catch {
      config = null;
    }
  }
  if (config === null || !Array.isArray(config.sections)) {
    render.showRuntimeNotice(root, FRIENDLY_ERROR);
    return;
  }

  const preview =
    root.getAttribute("data-lg-preview") === "1" ||
    document.querySelector('[data-lg-preview="1"]') !== null;

  const engine = new LgEngine(root, config, preview);
  try {
    await engine.init();
  } catch {
    // Any unexpected init failure degrades to the §3.5.8 notice — the
    // server-rendered first section stays visible either way.
    render.showRuntimeNotice(root, FRIENDLY_ERROR);
  }
}

// Auto-boot in a real browser only — importing this module under node/vitest
// stays inert (no DOM globals touched at module scope beyond typeof checks).
if (typeof window !== "undefined" && typeof document !== "undefined") {
  const start = (): void => {
    void bootLeadgenRuntime();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}
