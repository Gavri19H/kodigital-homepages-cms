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
  flattenGridChildren,
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
import { LgBeaconClient, ulidLike, type LgSendFn, type LgEnvelopeBase } from "./events";
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

// §4.2 (P6 S6.3 FIX-FIRST closure — MAJOR): the FULL non-answer-producing type
// class, used by hiddenFields() below to keep chrome/control/affordance/layout
// nodes from counting as "owners" of an internal_field for dependency-hiding
// purposes. Server parity: answers.ts fieldsOf drops this WHOLE class
// unconditionally (`if (produces === null) return [];`) — never one named
// type — and content-schema.ts's own save-gate comment (~:2959) says it
// straight: "Non-producing nodes (ValidationError, HelperText, …) legitimately
// REFERENCE a question's internal_field" (its uniqueness gate is
// `catalog.produces !== null`, nothing narrower), so ANY of these 29 types can
// be authored bound to a producing field's internal_field and reach save (a
// real POST /sections accepts it). The ORIGINAL closure-round fix here
// filtered only `type === "ValidationError"`, which under-covered the class —
// e.g. an always-visible HelperText bound to a hidden field's internal_field
// leaked that field's default into the auction projection exactly like
// ValidationError did (reviewer-reproduced MAJOR).
//
// This is a literal, NOT an import of registry.ts's COMPONENT_CATALOG (a
// ~27KB catalog of props/validation/capabilityExample text that would blow
// the engine's byte cap) — its membership is instead PINNED to the registry
// by a dedicated vitest coherence test (test/leadgen-rework-runtime.test.ts,
// "non-producing type list == registry produces===null") that imports
// COMPONENT_CATALOG directly (registry.ts has zero imports/worker-type refs,
// so it type-checks under tsconfig.runtime.json — confirmed by probe) and
// fails the build the instant a new produces:null type is added to the
// registry without a matching update here. R2 P1 §① closes exactly that: the
// registry's QuestionGrid entry is `produces: null` (the container itself
// answers no field) — this list was not updated when that entry landed
// (S1a, registry.ts only), so the coherence test failed the instant this
// slice touched engine.ts. Adding it here is a defense-in-depth no-op for
// hiddenFields() specifically (flattenGridChildren, state.ts, already
// removes the container from `section.components` at construction — by the
// time hiddenFields() filters this list, no "QuestionGrid" entry is ever
// present to filter), kept for the SAME reason every other produces:null
// type is listed: coherence with the registry, not live behavior here.
export const NON_ANSWER_PRODUCING_TYPES: readonly string[] = [
  "ProgressBar", "HeaderLogo", "BackButton", "DisclosureLink", "StepIndicator",
  "CategoryLabel", "QuestionHeadline", "Subheadline",
  "ContinueButton", "AutoAdvanceButton",
  "ReassuranceBadge", "SuccessState", "SecureFormBadge", "TrustBar", "LogoStrip",
  "HelperText", "ValidationError", "LegalNote", "TextBlock", "ImageBlock",
  "Stack", "GridContainer", "Columns", "CardPanel", "BackgroundPanel", "Spacer",
  "HeaderBar", "FooterBar", "QuestionGrid",
];

// ---------------------------------------------------------------------------
// Browser adapters (kept OUT of the DOM-free cores)
// ---------------------------------------------------------------------------

function readCookie(name: string): string {
  try {
    const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    if (m === null) return "";
    try {
      return decodeURIComponent(m[1] || "");
    } catch {
      return m[1] || "";
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
        events = (JSON.parse(body) as { events?: unknown }).events || [];
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
      (((b[0] || 0) << 24) | ((b[1] || 0) << 16) | ((b[2] || 0) << 8) | (b[3] || 0)) >>> 0;
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

// Round-4 P3a (D-3): one resolved slot winner off the /lg/attempt page_plan
// echo (attempt.ts ResolvedSlotWinner, mirrored locally — runtime/ stays
// dependency-free). slot_id rides as a NUMBER on the wire (resolver.ts's
// plain internal id); the engine stringifies it for the analytics dim.
interface LgPlanWinner {
  page_id: string;
  slot_id: number;
  section_public_id: string;
  assignment_reason: string;
}

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
  // into the evaluation map, NEVER sent back to /lg/auction. Always present
  // (parseAttemptCtx returns {} rather than a null/undefined this.ctx would
  // need an extra branch to distinguish from its OWN {} default).
  ctx: { state?: string; device?: string };
  // Round-4 P3a: the resolved page plan (flat, per-slot winners) — ABSENT
  // for a legacy/no-page-model funnel (byte-identical fallback: every
  // section counts as its own page, exactly pre-P3a).
  page_plan?: LgPlanWinner[];
  // Round-4 P4a (D-2): the ANCHOR section_public_id of every page at which to
  // POST /lg/ck (a mid-funnel routing rule's fields are all known
  // there) — the anchor is always `currentSection()`'s id when that page is
  // entered (P3a same-screen-page model), so the gate is a direct membership
  // check, no page-number lookup. ABSENT/empty when the variant has no
  // checkpoint-plane routing rules. Short key `cps` (see attempt.ts FunnelAttempt.cps).
  cps?: string[];
  // Round-4 P4a-adj (P5a runtime seam #1): the SERVER-evaluated conditional-CTA
  // verdict (attempt.ts FunnelAttempt.cc) — the ids of frame cta_slots[] whose
  // `condition` currently matches. The engine never evaluates a condition
  // itself; it only applies this id list (applyCtaVerdict).
  cc?: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Tolerant parse of the OPTIONAL /lg/attempt ctx echo (10C). Only non-empty
// string state/device are adopted; anything else (or absence) yields {} —
// byte-lean unconditional adoption (this.ctx's own default IS {}, so a
// null/undefined distinction here bought nothing) — so __state/__device stay
// fail-closed.
function parseAttemptCtx(raw: unknown): { state?: string; device?: string } {
  const r = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: { state?: string; device?: string } = {};
  if (typeof r["state"] === "string" && r["state"] !== "") out.state = r["state"];
  if (typeof r["device"] === "string" && r["device"] !== "") out.device = r["device"];
  return out;
}

// Round-4 P3a: tolerant parse of the OPTIONAL page_plan echo. Same-origin,
// server-authored (never attacker-shaped) — a shallow array/length sanity
// check is enough; every downstream read (String()/Map keys) degrades
// harmlessly on a stray malformed field rather than needing a deep guard.
function parseAttemptPagePlan(raw: unknown): LgPlanWinner[] | null {
  return Array.isArray(raw) && raw.length > 0 ? (raw as LgPlanWinner[]) : null;
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
    const pagePlan = parseAttemptPagePlan(raw["page_plan"]);
    return {
      funnel_attempt_id: raw["funnel_attempt_id"],
      signed_config_token:
        typeof raw["signed_config_token"] === "string" ? raw["signed_config_token"] : "",
      ...(typeof raw["session_id"] === "string" && raw["session_id"] !== ""
        ? { session_id: raw["session_id"] }
        : {}),
      ...(typeof raw["expires_at"] === "number" ? { expires_at: raw["expires_at"] } : {}),
      ctx: parseAttemptCtx(raw["ctx"]),
      ...(pagePlan !== null ? { page_plan: pagePlan } : {}),
      ...(Array.isArray(raw["cps"]) ? { cps: raw["cps"] as string[] } : {}),
      ...(Array.isArray(raw["cc"]) ? { cc: raw["cc"] as string[] } : {}),
    };
  } catch {
    return null;
  }
}

// Round-4 P4a (D-2): POST /lg/ck (no-store, same-origin). The server
// FIRST validates the signed binding (422 on tamper → treated as no switch);
// on a route match it returns the re-issued binding + target plan + resume.
// Any failure → null (the engine continues the current plan unrouted — fail-
// open for UX; the server re-derives the routing authoritatively at auction).
// Short wire keys (see maybeSwitch): sw=switched, k=re-issued token, v=target
// funnel_variant_id, so=section_order_hash, cv=content_version, ar=the
// routing_rule:<hash> assignment_reason (already server-computed; the client
// adopts it verbatim for post-switch analytics — 07 §16.3/P4a "completion
// belongs to the variant serving the last page"), pp=target page plan,
// r=resume section_public_id ("" => auction). A discriminated union so TS
// narrows every switch field to a required value after the `sw !== true`
// guard — no runtime `?? default` fallbacks (byte-lean; the server contract
// always emits them on a switch).
type LgCheckpointResult =
  | { sw: false; cc?: string[] }
  | { sw: true; k: string; v: string; so: string; cv: number; ar: string; pp: LgPlanWinner[]; r: string; cc?: string[] };

async function fetchAttemptWithRetry(funnelVariantId: string): Promise<LgAttempt | null> {
  let attempt = await fetchAttemptOnce(funnelVariantId);
  for (let i = 0; attempt === null && i < ATTEMPT_RETRY_DELAYS_MS.length; i++) {
    await sleep(ATTEMPT_RETRY_DELAYS_MS[i] || 1000);
    attempt = await fetchAttemptOnce(funnelVariantId);
  }
  return attempt;
}

// LeadGen Rework §6.9 — the compiled MASK contract a phone field carries when
// the author set a digit-group format (config-dto buildPhoneContract →
// client_validation.phone.{scaffold,digit_count}). Absent (legacy preset /
// no phone_format) ⇒ null, so a legacy phone keeps its byte-identical E.164
// path (L-192). Module-level (no `this`) so it is byte-cheap at each call.
function phoneMask(component: LgComponentConfig | null): { scaffold: string; count: number } | null {
  if (component === null) return null;
  const cv = component.client_validation;
  const phone = cv !== undefined && cv !== null ? (cv as Record<string, unknown>)["phone"] : undefined;
  if (phone === null || typeof phone !== "object") return null;
  const scaffold = (phone as Record<string, unknown>)["scaffold"];
  const count = (phone as Record<string, unknown>)["digit_count"];
  return typeof scaffold === "string" && scaffold !== "" && typeof count === "number"
    ? { scaffold, count }
    : null;
}

// Fill a mask scaffold ("(___) ___-____") left-to-right with `digits`: each
// "_" is a digit slot (content-schema parsePhoneMaskPattern, M8), every other
// char is a literal kept verbatim. Returns the display text + the caret index
// of the FIRST still-empty slot (§6.9 "caret always at the first empty slot";
// scaffold length when every slot is filled).
function fillMaskScaffold(scaffold: string, digits: string): { text: string; caret: number } {
  let text = "";
  let di = 0;
  let caret = -1;
  for (let i = 0; i < scaffold.length; i++) {
    const ch = scaffold.charAt(i);
    if (ch === "_") {
      if (di < digits.length) {
        text += digits.charAt(di);
        di++;
      } else {
        if (caret === -1) caret = text.length;
        text += "_";
      }
    } else {
      text += ch;
    }
  }
  return { text, caret: caret === -1 ? text.length : caret };
}

// ---------------------------------------------------------------------------
// §6.8 sliders — the MOVING half (R2 P4 S4b)
//
// S4a painted the five types' anatomy (presets.ts) and their CSS (styles.ts);
// the `single` and `stepper` shapes already move for free (the native input
// overlays its own track → `input` → render.updateRangeDisplay writes the fill
// width + `.lg-range-value` text, and the fill's child `.lg-range-handle`
// rides that width). The two shapes below have geometry the single-value
// updater cannot express, so the engine owns it:
//
//   from_to / dual_range — ONE track, TWO real range inputs. The fill must span
//     BETWEEN the two values (left AND width) and each handle's pill must read
//     its OWN handle. render.updateRangeDisplay is single-value (it writes
//     width from one input and would collapse the span), so these types are
//     routed here INSTEAD of it.
//   radial — the arc + ring handle are driven by ONE custom property,
//     `--lg-deg` on `.lg-range-radial-outer` (styles.ts: the conic-gradient
//     stop AND the handle's rotate() both read it). S4a's centre-value fix
//     made the CENTRE follow the value; this makes the ARC follow it too.
// ---------------------------------------------------------------------------

// Every numeric slider attribute is server-rendered (presets.ts always emits
// min/max/step); `|| fallback` covers a missing attr AND an empty one.
function attrNum(el: Element, name: string, fallback: number): number {
  return Number(el.getAttribute(name) || fallback);
}

const ARIA_NOW = "aria-valuenow";
const SEL_DIAL = ".lg-range-radial-outer";

// R2 P4 FIX-FIRST-2 (N-1): true ONLY while the dispatch in flight is an `input`
// event — the visitor is mid-keystroke. F-1 made syncDualRange mirror the
// clamped value into every from_to box INCLUDING the one being typed into, so
// the one-step anti-deadlock clamp was committed into that box on each
// keystroke and the caret jumped behind it: with From=35000, typing "6" rewrote
// the To box to "40000", the next "0" made "400000" → clamped to the max, and
// 60000 became unreachable (the buyer got 100000). The box being typed into is
// therefore left alone WHILE typing and reconciled on `change` (blur/Enter —
// the SAME listener, with typing back to false), which is where F-1's guarantee
// is observable: at COMMIT the box, the rails, the pills and the recorded
// answer all agree. Every other surface — rails, aria, pills, fill, and the
// RECORDED answer — still carries the clamped value on every keystroke, so a
// mid-typing submit can never bill an unclamped number. Module scope, like
// dialDrag: one engine per page, and it is set and cleared around a single
// synchronous handleInputEvent call.
let typing = false;

// CLAMP RULE (from_to + dual_range): the DRAGGED handle stops ONE `step` short
// of its neighbour; the neighbour NEVER moves. So min < max always holds (no
// crossing), and the two thumbs can never land on the same pixel — which would
// bury the lower one under the upper one's hit area and deadlock the pair
// (neither handle reachable again). Returns the CLAMPED value of the moved
// control so handleInputEvent records the clamp, never the raw crossing value;
// null = not a two-handle slider (caller falls back to updateRangeDisplay).
function syncDualRange(wrap: Element, moved: HTMLInputElement): string | null {
  const rail = wrap.querySelectorAll(".lg-range-input-dual") as unknown as HTMLInputElement[];
  const hi = rail[1];
  // A cleared from_to number field is left alone (never re-filled mid-typing).
  if (hi === undefined || moved.value === "") return null;
  const lo = rail[0] as HTMLInputElement;
  // from_to's two labelled number fields (the ONLY .lg-input inside a two-handle
  // wrapper); dual_range is handles-only, so this list is empty there.
  const num = wrap.querySelectorAll(".lg-input") as unknown as HTMLInputElement[];
  const min = attrNum(lo, "min", 0);
  const max = attrNum(lo, "max", 100);
  const step = attrNum(lo, "step", 1);
  const top = moved === hi || moved === num[1];
  const fit = (n: number): number => (n >= min ? (n > max ? max : n) : min);
  let a = fit(Number(top ? lo.value : moved.value));
  let b = fit(Number(top ? moved.value : hi.value));
  if (top) {
    if (b < a + step) b = fit(a + step);
  } else if (a > b - step) {
    a = fit(b - step);
  }
  // The fill + both pills are emitted by the SAME presets.ts template literal
  // that emitted the two rails found above, so they are never absent here.
  const span = max - min || 1;
  const pa = Math.round(((a - min) / span) * 100);
  const pb = Math.round(((b - min) / span) * 100);
  const fs = (wrap.querySelector(".lg-range-fill") as HTMLElement).style;
  fs.left = pa + "%";
  fs.width = pb - pa + "%";
  // R2 P4 FIX-FIRST (F-2): publish the two handle POSITIONS the fill was just
  // placed from. styles.ts's pill rules read them to slide each readout inward
  // in proportion to how close its handle is to that end of the track, so a
  // driven handle can never push its pill off the card (measured: the min pill
  // ran to x=393 at a 375 viewport). Same already-computed percentages, no new
  // geometry; unset (server render, both handles at the rails) the CSS
  // fallbacks 0/100 reproduce the at-rest anchoring byte-for-byte.
  fs.setProperty("--lg-a", `${pa}`);
  fs.setProperty("--lg-b", `${pb}`);
  // One pass per side (0 = min/left, 1 = max/right): the rail carries the
  // clamped value + aria; from_to's labelled number field mirrors it (R2 P4
  // FIX-FIRST F-1: never mirroring left the box reading a number that never
  // left the browser while the rail, the pill and the /lg/auction payload all
  // carried the clamped one — the visitor saw 90000, the buyer was billed
  // 35000) — every field EXCEPT one still being typed into, which is mirrored
  // at `change` instead (FIX-FIRST-2 / N-1, see `typing`). dual_range has no
  // such field, hence the undefined test. The handle's OWN pill carries its
  // readout, byte-identical to the server's formatRangeValue (presets.ts).
  const pill = wrap.querySelectorAll(".lg-range-handle-value");
  const cur = wrap.getAttribute("data-currency") || "";
  [a, b].forEach((v, i) => {
    const s = `${v}`;
    const rl = i ? hi : lo;
    rl.value = s;
    rl.setAttribute(ARIA_NOW, s);
    const nu = num[i];
    if (nu !== undefined && !(typing && nu === moved)) nu.value = s;
    (pill[i] as Element).textContent = cur + v.toLocaleString("en-US");
  });
  return `${top ? b : a}`;
}

// Route one changed slider control to its type's visual sync. Returns the
// clamped answer value (the two-handle types) or null (every other type — the
// caller then runs the single-value render.updateRangeDisplay).
//
// radial is handled inline: its ONE live property is `--lg-deg` on
// `.lg-range-radial-outer` — 0deg is 12 o'clock sweeping clockwise (the
// conic-gradient's own axis, which the ring handle's rotate() reads too), so a
// single write moves the arc AND the handle. `single`/`stepper` fall through to
// syncDualRange, which finds no `.lg-range-input-dual` rails and returns null —
// the same answer an explicit type test gives, for fewer bytes.
function syncSlider(input: HTMLInputElement): string | null {
  const wrap = input.closest(".lg-range");
  if (wrap === null) return null;
  const outer = wrap.querySelector(SEL_DIAL) as HTMLElement | null;
  if (outer === null) return syncDualRange(wrap, input);
  const min = attrNum(input, "min", 0);
  const span = attrNum(input, "max", 100) - min || 1;
  outer.style.setProperty("--lg-deg", Math.round(((Number(input.value) - min) / span) * 360) + "deg");
  return null;
}

// §6.8 radial: the dial under a pointer drag as [outer, input] (null = no
// drag). One engine per page, so module scope is the cheapest correct home.
let dialDrag: [Element, HTMLInputElement] | null = null;

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
  // Round-4 P3a: section_public_id -> [pageIndex, slotId, reason] (a tuple —
  // byte-lean, no object-literal keys). null when the attempt carried no
  // page_plan (legacy funnel — every section counts as its own page,
  // byte-identical to pre-P3a). pageIds[pageIndex] is the page's public_id
  // (analytics dim); pagesCount === pageIds.length.
  private planMeta: Map<string, [number, string, string]> | null = null;
  private pageIds: string[] = [];
  private pagesCount = 0;
  // Round-4 P4a (D-2): the server-computed checkpoint-page anchor section ids
  // to POST /lg/ck at. Short field name (`ckpts`) — private class
  // fields compile to a `__publicField` polyfill call per occurrence (esbuild
  // es2019 target has no native class-field syntax), so the string name
  // itself is repeated, unmangled, at every use site; the checkpoint-call
  // leg's byte budget makes this the same tradeoff as the wire-protocol short
  // keys elsewhere in this leg. A checkpoint SWITCH overwrites config's
  // binding fields in place (funnel_variant_id/section_order_hash/
  // content_version) so buildAuctionRequest + every config reader see the
  // TARGET, and CLEARS `ckpts` (below) — no separate "already switched" flag:
  // the ≤1-hop invariant means no further checkpoint is ever evaluated once
  // one has fired, so an emptied `ckpts` is both the resume-navigation input
  // AND the switched signal.
  private ckpts: string[] = [];

  constructor(root: HTMLElement, config: LgPublicConfig, preview: boolean) {
    this.root = root;
    this.config = config;
    // R2 P1 §① boot-time flatten (state.ts flattenGridChildren) — BEFORE
    // anything below reads a section's components, so every reader (this
    // class's own lookups + dependencies.ts/validation.ts) sees each grid
    // child as first-class with no further changes.
    for (const section of this.config.sections) {
      section.components = flattenGridChildren(section.components);
    }
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
        ctx: {},
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
      attempt && attempt.session_id !== undefined && attempt.session_id !== ""
        ? attempt.session_id
        : sessionId;
    this.store.bindIdentity({
      session_id: boundSessionId,
      page_view_id: pageViewId,
      funnel_attempt_id: (attempt && attempt.funnel_attempt_id) || "",
      signed_config_token: (attempt && attempt.signed_config_token) || "",
      tuple,
    });
    if (attempt !== null) {
      this.beacons.setEnvelope({
        funnel_attempt_id: attempt.funnel_attempt_id,
        ...(boundSessionId !== sessionId ? { session_id: boundSessionId } : {}),
      });
      // 10C: adopt the server ctx echo (geo/device) for __state/__device rules.
      this.ctx = attempt.ctx;
      // Round-4 P3a: build the page-plan lookup ONCE from the flat winners
      // list (page_id first-seen order == page order, matching resolver.ts's
      // own page.position ordering). P4a reuses applyPlan on a checkpoint switch.
      if (attempt.page_plan !== undefined) this.applyPlan(attempt.page_plan);
      // Round-4 P4a: the checkpoint pages to POST at (empty for a non-routing
      // funnel → the /lg/ck leg never fires, byte-neutral behavior).
      if (Array.isArray(attempt.cps)) this.ckpts = attempt.cps;
      // Round-4 P4a-adj: mint-time CTA verdict (entry-known conditions only).
      if (Array.isArray(attempt.cc)) this.applyCtaVerdict(attempt.cc);
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
      // Coordinator ruling (2026-07-20): stamp the section that OWNS the
      // edited field, not the anchor (this.currentSection()) — on a same-
      // screen multi-section page an Address on section 2 must not mis-
      // attribute to section 1's public id just because this.si still
      // points at the page's anchor. maps.ts hands back only the field NAME
      // (no DOM element to walk), so resolution is an internal_field lookup
      // across config.sections (inlined -- its one call site) — falls back
      // to the anchor only if no section declares the field at all (should
      // not happen for a validly authored funnel). `||` not `??`/`?.` -- a
      // resolved section is always a non-null object (never falsy-but-
      // defined), and the es2019 build target transpiles `?.`/`??` into far
      // costlier ternary chains than a plain `||`/explicit null check.
      setAnswer: (field, value, meta) => {
        const owner =
          this.config.sections.find((s) => s.components.some((c) => c.internal_field === field)) ||
          this.currentSection();
        this.writeAnswer(field, value, {
          question_id: meta.question_id,
          section_public_id: owner !== null ? owner.section_public_id : "",
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
    this.enterPage(null, /*fireView*/ false);

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
      render.showRuntimeNotice(this.currentSectionEl() || this.root, FRIENDLY_ERROR);
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
    return { question_id: questionId, section_public_id: (section && section.section_public_id) || "" };
  }

  private currentSection(): LgSectionConfig | null {
    return this.config.sections[this.si] || null;
  }

  private currentSectionEl(): HTMLElement | null {
    return render.sectionElementAt(this.root, this.si);
  }

  private sectionConfigFor(el: Element | null): LgSectionConfig | null {
    if (el === null) return null;
    const sectionEl = el.closest("[data-lg-section]");
    if (sectionEl === null) return this.currentSection();
    const id = sectionEl.getAttribute("data-lg-section-id") || "";
    const byId = this.config.sections.find((s) => s.section_public_id === id);
    if (byId !== undefined) return byId;
    const index = Number(sectionEl.getAttribute("data-lg-index"));
    return this.config.sections[Number.isNaN(index) ? -1 : index] || this.currentSection();
  }

  private sectionDims(section: LgSectionConfig | null): Record<string, unknown> {
    if (section === null) return {};
    // Round-4 P3a: page_id/slot_id/slot_assignment_reason ride alongside the
    // existing dims when this section resolved from a page plan (absent for
    // a legacy funnel — leadgen-events.ts defaults them to "").
    const meta = this.planMeta?.get(section.section_public_id);
    return {
      section_id: section.section_public_id,
      section_index: section.section_index,
      continue_mode: section.continue_mode,
      section_mapping_version: section.section_mapping_version,
      answer_mapping_version: section.answer_mapping_version,
      ...(meta !== undefined
        ? { page_id: this.pageIds[meta[0]] || "", slot_id: meta[1], slot_assignment_reason: meta[2] }
        : {}),
    };
  }

  // Round-4 P4a (D-2): post-switch beacon re-stamping (§16.3 attribution;
  // "completion belongs to the variant serving the last page" applies to the
  // full client event stream, not just the final auction call) uses the
  // EXISTING LgBeaconClient.setEnvelope (events.ts) — its own docstring is
  // written for exactly this: "Engine updates identity dims as they resolve
  // ... subsequent events carry the newest values." maybeSwitch calls it ONCE
  // on a switch; every call site below is UNCHANGED (`this.beacons.enqueue`),
  // so every subsequent event automatically merges the new funnel_variant_id/
  // assignment_reason/routed_from_variant — no per-call-site wrapper needed.

  private componentByQuestionId(
    section: LgSectionConfig | null,
    questionId: string,
  ): LgComponentConfig | null {
    const scan = (s: LgSectionConfig): LgComponentConfig | null =>
      s.components.find((component) => component.question_id === questionId) || null;
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
    // §4.2: a dependency-hidden component's answer is EXCLUDED from the auction
    // projection + persistence. hiddenAnswerFields treats a field as hidden only
    // when EVERY component owning that internal_field is hidden — but a
    // non-answer-producing node (NON_ANSWER_PRODUCING_TYPES above) can bind a
    // producing field's internal_field purely to reference it (an error slot,
    // helper/legal copy, …) while carrying no conditional of its own, so it is
    // always "visible" and would un-hide a field whose real producing input IS
    // hidden — leaking that input's default_applied / user answer into
    // /lg/auction + sessionStorage. Dropping the FULL non-producing class here
    // mirrors the server's produces-null answer-space model (answers.ts
    // fieldsOf). Consumers of this set: buildAuctionRequest → store.auctionAnswers,
    // and persist → store.serialize.
    const sections = this.config.sections.map((s) => ({
      ...s,
      components: s.components.filter((c) => !NON_ANSWER_PRODUCING_TYPES.includes(c.type)),
    }));
    return hiddenAnswerFields(sections, this.evalAnswers());
  }

  // Round-4 P3a: intersect dependency-visible indices with the resolved
  // plan's WINNING sections — a non-winning slot candidate (server-rendered
  // hidden, per the visitor-invariant shell design) is never walkable, never
  // counted, never auction-projected. planMeta null (legacy funnel /
  // attempt-fetch failure) -> no filter, byte-identical to pre-P3a.
  private visibleIndexes(): number[] {
    const all = visibleSectionIndexes(this.config.sections, this.evalAnswers());
    const meta = this.planMeta;
    if (meta === null) return all;
    return all.filter((i) => {
      const id = this.config.sections[i]?.section_public_id;
      return id !== undefined && meta.has(id);
    });
  }

  private normalizeSectionIndex(wanted: number): number {
    const visible = this.visibleIndexes();
    if (visible.length === 0) return 0;
    if (visible.indexOf(wanted) !== -1) return wanted;
    for (const index of visible) if (index >= wanted) return index;
    return visible[visible.length - 1] || 0;
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
      // §6.8 stepper: a −/＋ button steps its sibling range input.
      const step = target.closest("[data-lg-step]");
      if (step !== null && this.root.contains(step)) {
        this.handleStepper(step);
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
      // FIX-FIRST-2 (N-1): the ONE place the two dispatches differ. `input` =
      // mid-keystroke (syncDualRange must not rewrite the box under the caret);
      // `change` = the commit (blur/Enter) where it must. Cleared straight after
      // the synchronous call so the engine's other handleInputEvent callers
      // (mask keydown, dial drag, restore) always run in commit mode.
      typing = raw.type === "input";
      this.handleInputEvent(target);
      typing = false;
    };
    this.root.addEventListener("input", onInput);
    this.root.addEventListener("change", onInput, true);

    // §6.9 mask fill: Backspace on a masked phone clears the LAST FILLED DIGIT
    // (never a mask literal sitting before the caret). Drop it from the current
    // digits, rewrite the field, then route through the normal input path
    // (records the raw digits + re-fills + re-parks the caret). Non-mask fields
    // never match phoneMask → the browser's native Backspace is untouched.
    this.root.addEventListener("keydown", (raw) => {
      const ev = raw as { target?: unknown; key?: string; preventDefault?: () => void };
      if (ev.key !== "Backspace" || !(ev.target instanceof Element)) return;
      const input = ev.target.closest("[data-lg-input]");
      if (input === null || !(input instanceof HTMLInputElement)) return;
      const component = this.componentByQuestionId(
        this.sectionConfigFor(input),
        input.closest("[data-lg-question]")?.getAttribute("data-lg-question") ?? "",
      );
      const mask = phoneMask(component);
      if (mask === null) return;
      if (ev.preventDefault !== undefined) ev.preventDefault();
      input.value = fillMaskScaffold(mask.scaffold, input.value.replace(/\D/g, "").slice(0, -1)).text;
      this.handleInputEvent(input);
    });

    // §6.8 radial: the visitor grabs the RING, not an input — the real
    // <input type=range> is pointer-events:none/opacity:0 over the dial
    // (styles.ts) precisely so the dial's own pixels are the hit area. Grab =
    // jump to the angle under the pointer + focus the (still focusable) input,
    // so the SAME control then answers the native ↑↓←→/Home/End/PageUp/PageDown
    // keys the §6.8 keyboard rail requires and :focus-within paints the dial's
    // focus ring. Move/up ride the DOCUMENT so a drag that leaves the card
    // keeps tracking, exactly like a native thumb drag.
    // Map the pointer to the dragged dial's value: the angle from the dial's
    // CENTRE, clockwise from 12 o'clock (the SAME axis --lg-deg feeds — see
    // syncSlider), scaled across [min,max] and snapped to `step`. Routing the
    // result through the real input + handleInputEvent means the drag records,
    // re-renders the centre value, re-stamps aria-valuenow and re-draws the arc
    // through the EXACT path a keypress uses — one behaviour, not two.
    const dialTo = (ev: { clientX: number; clientY: number; buttons?: number }): void => {
      const grab = dialDrag;
      if (grab === null) return;
      // The button came up somewhere we never saw (the drag ended) — release.
      if (ev.buttons === 0) {
        dialDrag = null;
        return;
      }
      const input = grab[1];
      const box = grab[0].getBoundingClientRect();
      const turn =
        Math.atan2(ev.clientX - box.left - box.width / 2, box.top + box.height / 2 - ev.clientY) /
        (Math.PI * 2); // -0.5..0.5 of a turn, 0 = 12 o'clock, + = clockwise
      const min = attrNum(input, "min", 0);
      const max = attrNum(input, "max", 100);
      const step = attrNum(input, "step", 1) || 1;
      // turn ∈ [0,1) ⇒ the snap never falls below min; only the top edge can
      // overshoot (a span that is not a whole number of steps), so one Math.min
      // is the whole clamp here.
      const v =
        "" + Math.min(max, min + Math.round((((turn + 1) % 1) * (max - min)) / step) * step);
      if (v === input.value) return;
      input.value = v;
      this.handleInputEvent(input);
    };
    // The dial ring and its centre are the only pointer targets inside
    // `.lg-range-radial-outer` (the real input over them is pointer-events:none,
    // the handle too — styles.ts), so ONE closest() both hit-tests the dial and
    // hands back the element whose box the angle is measured from.
    this.root.addEventListener("pointerdown", (raw) => {
      const ev = raw as { target?: unknown; clientX: number; clientY: number };
      const t = ev.target;
      const outer = t instanceof Element ? t.closest(SEL_DIAL) : null;
      // EVERY pointerdown re-decides what (if anything) is being dragged, so a
      // press anywhere else releases a stale grab — the drag can never resume
      // on a dial the visitor already let go of.
      dialDrag = null;
      if (outer === null) return;
      const input = (outer.parentElement as Element).querySelector(
        ".lg-range-radial-input",
      ) as HTMLInputElement;
      dialDrag = [outer, input];
      // The (still focusable) input becomes the keyboard control for the dial
      // the visitor just grabbed, and paints :focus-within's ring (styles.ts).
      input.focus();
      dialTo(ev); // a real pointerdown carries buttons=1 — never the release edge
    });
    // The release edge is `buttons === 0` inside dialTo (covers pointerup,
    // pointercancel and a button let go outside the window) — one test on the
    // move stream instead of two more listeners.
    document.addEventListener("pointermove", dialTo as unknown as EventListener);
  }

  private replayPrehydrateQueue(): void {
    const queue = (window as unknown as { __LG_PREHYDRATE_QUEUE__?: unknown[] })
      .__LG_PREHYDRATE_QUEUE__;
    if (!Array.isArray(queue)) return;
    for (const item of queue.splice(0, queue.length)) {
      let el: Element | null = null;
      if (typeof item === "string") {
        try {
          el = this.root.querySelector(item) || document.querySelector(item);
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

  // Same-screen pages: an answer anywhere on the page can drive a
  // conditional ANYWHERE ELSE on the SAME page (both simultaneously on
  // screen), so every visible section of the current page re-checks its own
  // component/Continue visibility — not just the one the edit occurred in.
  // lastInPage (the page's one Continue-bearing section, coordinator ruling
  // 2026-07-20) is recomputed fresh -- an answer here can itself flip which
  // section is last-visible within the page.
  private afterAnswerMutation(): void {
    const pageIndices = this.currentPageIndices();
    const visible = this.visibleIndexes();
    let lastInPage: number | undefined;
    for (const i of pageIndices) if (visible.indexOf(i) !== -1) lastInPage = i;
    for (const i of pageIndices) {
      const section = this.config.sections[i];
      const sectionEl = section !== undefined ? render.sectionElementAt(this.root, i) : null;
      if (section === undefined || sectionEl === null) continue;
      render.applyComponentVisibility(sectionEl, this.dependencyState(section).components);
      this.applyContinueVisibility(section, sectionEl, i === lastInPage);
    }
    this.updateProgressUi();
    this.persist();
  }

  // Coordinator ruling (2026-07-20): a multi-section page shows Continue on
  // ONLY its LAST dependency-visible section — one gate per page, not N
  // (that single Continue already validates + advances the WHOLE page, see
  // handleContinue/advance). Single-section pages are the length-1 case
  // (isLastInPage is always true), unaffected. `isLastInPage` composes with
  // the section's own continue_visible_when — both must pass.
  //
  // P4c (register PC-12): section-level Continue visibility. `continue_
  // visible_when` is not part of the declared LgSectionConfig shape (kept a
  // hand-maintained LOCAL mirror per the state.ts module header) — it is
  // read here via a narrow, defensive cast, exactly like an untyped JSON
  // field the config legitimately carries. Absent ⇒ treated as "no condition
  // authored", i.e. visible whenever isLastInPage alone says so (pre-P4c:
  // Continue was unconditionally visible; now composed with the P3a
  // last-in-page gate above, so this can no longer stay a true no-op — an
  // explicit `true` here is what RE-shows a Continue this SAME feature may
  // have hidden on the section's prior turn as a non-last section).
  private applyContinueVisibility(section: LgSectionConfig, sectionEl: Element, isLastInPage: boolean): void {
    const cond = (
      section as unknown as { continue_visible_when?: LgConditional | LgConditionGroup }
    ).continue_visible_when;
    render.setContinueVisible(
      sectionEl,
      isLastInPage && (cond === undefined || conditionMet(cond, this.evalAnswers())),
    );
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
    const attrValue = choiceEl.getAttribute("data-lg-choice") || "";
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
    if (questionEl !== null) {
      render.applySelectionClasses(questionEl, value);
      // §6.5: choosing a BASE choice resets any authored "Other" select back to
      // its "Choose…" placeholder — the two share ONE answer domain (mutual
      // exclusion), so the picked Other option must stop DISPLAYING as selected.
      // presets.ts renders the <select> with data-lg-other-panel AND data-lg-input
      // on the SAME element, so this selects that element directly (a DESCENDANT
      // selector "[data-lg-other-panel] [data-lg-input]" never matched it, so the
      // reset silently no-op'd on the live funnel). No-op for a question with no
      // [data-lg-other-panel].
      const otherSel = questionEl.querySelector("[data-lg-other-panel]");
      if (otherSel !== null && "value" in otherSel) (otherSel as { value: string }).value = "";
    }
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
    // Round-4 P3a: auto-advance is authorable ONLY for single-SECTION pages
    // (a multi-slot page must always be walked via Continue, even when its
    // current section itself would otherwise qualify) — pageIndicesFor(...)
    // .length<=1 is a no-op true when planMeta is null (legacy: every
    // section IS its own page).
    if (
      section !== null &&
      section.continue_mode === "auto_advance" &&
      !multi &&
      this.pageIndicesFor(section.section_public_id).length <= 1
    ) {
      const deps = this.dependencyState(section);
      const interactive = section.components.filter(
        (c, i) =>
          (c.internal_field || "") !== "" && deps.components[i]?.visible === true,
      );
      if (interactive.length === 1 && this.sectionPassesAt(this.config.sections.indexOf(section), section)) {
        this.advance();
      }
    }
  }

  // §6.9 mask fill: reformat `input` to the scaffold filled with the caller's
  // `digits` (stripped to digits + truncated to the mask length), park the
  // caret at the first empty slot, and RETURN the raw digit string to record.
  // Direct DOM writes (value/caret): the fill UX is an engine concern —
  // render.ts owns no mask helper.
  private applyPhoneMask(
    input: HTMLInputElement,
    mask: { scaffold: string; count: number },
    digits: string,
  ): string {
    const raw = digits.replace(/\D/g, "").slice(0, mask.count);
    const filled = fillMaskScaffold(mask.scaffold, raw);
    input.value = filled.text;
    try {
      input.setSelectionRange(filled.caret, filled.caret);
    } catch {
      /* setSelectionRange unsupported on this input — the value is still correct */
    }
    return raw;
  }

  // §6.8 stepper: the −/＋ buttons step their sibling range input by its
  // REQUIRED `step` (clamped to min/max), then route through the normal input
  // path so the value records + the value text/fill + aria-valuenow update
  // exactly like a drag. data-lg-step = "dec" | "inc".
  private handleStepper(stepEl: Element): void {
    const input = stepEl.closest("[data-lg-question]")?.querySelector("[data-lg-input]");
    if (!(input instanceof HTMLInputElement)) return;
    const step = attrNum(input, "step", 1) || 1;
    const min = attrNum(input, "min", 0);
    const max = attrNum(input, "max", 100);
    // A NaN/blank current value lands on min (`NaN >= min` is false), exactly
    // as the pre-S4b Number.isFinite ladder did.
    const n = Number(input.value) + (stepEl.getAttribute("data-lg-step") === "dec" ? -step : step);
    input.value = "" + (n >= min ? (n > max ? max : n) : min);
    this.handleInputEvent(input);
  }

  // Round-4 P3a same-screen pages (D-3 operator amendment, 2026-07-20): every
  // config.sections index sharing sectionId's PAGE (structural — regardless
  // of current dependency visibility), in ascending order. planMeta null
  // (legacy funnel) degrades to [thatSection'sOwnIndex] — the byte-identical
  // single-section-page case every call site below composes over.
  private pageIndicesFor(sectionId: string): number[] {
    const meta = this.planMeta;
    if (meta === null) {
      const i = this.config.sections.findIndex((s) => s.section_public_id === sectionId);
      return i === -1 ? [] : [i];
    }
    const page = meta.get(sectionId)?.[0];
    if (page === undefined) return [];
    const out: number[] = [];
    for (let i = 0; i < this.config.sections.length; i++) {
      const id = this.config.sections[i]?.section_public_id;
      if (id !== undefined && meta.get(id)?.[0] === page) out.push(i);
    }
    return out;
  }

  private currentPageIndices(): number[] {
    const indices = this.pageIndicesFor(this.currentSection()?.section_public_id ?? "");
    return indices.length > 0 ? indices : [this.si];
  }

  // Round-4 P4a (D-2): (re)build the page-plan lookup from a flat winners list
  // (init AND a checkpoint switch share this — the P3 plan-application machinery).
  private applyPlan(winners: LgPlanWinner[]): void {
    const meta = new Map<string, [number, string, string]>();
    const ids: string[] = [];
    for (const w of winners) {
      let page = ids.indexOf(w.page_id);
      if (page === -1) page = ids.push(w.page_id) - 1;
      meta.set(w.section_public_id, [page, String(w.slot_id), w.assignment_reason]);
    }
    this.planMeta = meta;
    this.pageIds = ids;
    this.pagesCount = ids.length;
  }

  // Round-4 P4a-adj (P5a runtime seam #1, CTA visibility): trivial APPLIER —
  // the server already evaluated every conditional CTA's condition (attempt.ts
  // computeCtaVerdict); this never parses/evaluates a condition itself. Reuses
  // applyComponentVisibility UNCHANGED (its own `sectionEl.querySelector` works
  // over ANY Element, not just a section) against every [data-lg-cta-condition]
  // element found anywhere in the frame — display-only, never touches section
  // visibility/progress. Re-hides an id NOT in `cc` too (a prior verdict's
  // match can be superseded by a later one — see the checkpoint call site).
  private applyCtaVerdict(cc: string[]): void {
    render.applyComponentVisibility(
      this.root,
      Array.from(this.root.querySelectorAll("[data-lg-cta-condition]"), (el) => {
        const id = el.getAttribute("data-lg-node") || "";
        return { question_id: id, visible: cc.includes(id) };
      }),
    );
  }

  // Round-4 P4a (D-2): on a page-complete crossing a routing CHECKPOINT (and
  // not already switched — the ≤1-hop guard, checked by the ONE caller
  // handleContinue), POST answers to /lg/ck. On a switch outcome:
  // adopt the re-issued binding, swap the remaining page plan + re-baseline
  // progress (reusing applyPlan), stamp the target variant + routing reason
  // on subsequent events, and resume at the target's first unanswered-
  // required page (or finalize when all satisfied). OWNS its own fallback
  // (calls `advance()` itself on any non-switch outcome) so the caller is a
  // plain fire-and-forget — fail-open: any non-switch continues the CURRENT
  // plan unrouted (the server re-derives authoritatively at auction; the
  // server's OWN ≤1-hop check in leadgen_routing_outcomes is the
  // authoritative guard regardless of any client-side double-call). Short
  // wire keys (k/f/v/s/a request; sw/k/v/so/cv/pp/r response) — the P4a
  // /lg/ck protocol is server+engine-internal; short keys keep the
  // client leg inside its byte budget (esbuild does not mangle object keys).
  private async maybeSwitch(): Promise<void> {
    const store = this.store;
    const cfg = this.config;
    const ov = cfg.funnel_variant_id; // the ORIGIN variant — read once, reused below
    const sec = this.currentSection();
    const st = store.state;
    let out: LgCheckpointResult | null = null;
    // `currentSection()` is always the page's ANCHOR when entered (P3a
    // same-screen-page model — store.setSectionIndex is set to the page's
    // FIRST visible section) — a direct section-id membership check, no
    // page-number lookup needed (byte-lean; see checkpointPageAnchors).
    // Inlined (single call site) — credentials default to same-origin
    // (cookies ride); a POST is never served from / written to the HTTP
    // cache (both omitted). `res.ok` is deliberately NOT checked — EVERY
    // /lg/ck response (200/400/404/422) is valid JSON without a
    // `sw:true` field except an actual switch, so any non-2xx already falls
    // through the `out.sw !== true` check below; only a genuine network/parse
    // failure throws (caught). Any failure (gate/network/parse/non-switch) =>
    // out stays null => the ONE fallback below fires the unchanged
    // synchronous advance (fail-open).
    if (sec !== null && this.ckpts.includes(sec.section_public_id)) {
      try {
        const res = await fetch("/lg/ck", {
          method: "POST",
          body: JSON.stringify({
            k: st.signed_config_token,
            f: st.funnel_attempt_id,
            v: ov, // always the (pre-switch) entry variant
            s: st.session_id,
            a: store.auctionAnswers(this.hiddenFields()),
          }),
        });
        out = (await res.json()) as LgCheckpointResult;
      } catch {
        /* out stays null */
      }
    }
    // P4a-adj: a CTA verdict rides EVERY /lg/ck response (switch or not) —
    // a checkpoint page transition is the moment an answer-conditioned CTA
    // becomes evaluable at all (v1 semantics, see runtime-routes.ts).
    if (out !== null && out.cc !== undefined) this.applyCtaVerdict(out.cc);
    if (out === null || out.sw !== true) {
      this.advance();
      return;
    }
    // §16.3 attribution: patch the beacon envelope ONCE (LgBeaconClient.
    // setEnvelope, events.ts — its own docstring: "subsequent events carry the
    // newest values") with the TARGET funnel_variant_id + its routing
    // assignment_reason + the ORIGIN id (`ov`, captured above) — every event
    // from here on (continue_click, section_view, quote_complete, …)
    // automatically carries it via the UNCHANGED beacons.enqueue call sites
    // (§16.3 "completion belongs to the variant serving the last page"
    // applies to the full client event stream). `routed_from_variant` is NOT
    // part of events.ts's OWN LgEnvelopeBase (not this leg's file to extend)
    // — the `as Partial<LgEnvelopeBase>` assertion (type-only, erased, zero
    // runtime bytes) suppresses the excess-property literal check for this
    // ONE extra key; the runtime spread inside setEnvelope/enqueue still
    // copies it through to the actual wire payload unchanged (TS types never
    // affect what a plain object spread actually carries at runtime).
    this.beacons.setEnvelope({ funnel_variant_id: out.v, assignment_reason: out.ar, routed_from_variant: ov } as Partial<LgEnvelopeBase>);
    // Overwrite config's binding fields IN PLACE with the target's so the
    // auction (buildAuctionRequest) re-validates against the TARGET; the
    // re-issued token rides the store (a plain field write — memory-only, sent
    // ONLY to /lg/auction). store.tuple is intentionally NOT updated (never
    // read post-init; a mid-switch reload re-derives from the server).
    cfg.funnel_variant_id = out.v;
    cfg.section_order_hash = out.so;
    cfg.content_version = out.cv;
    st.signed_config_token = out.k;
    this.applyPlan(out.pp);
    this.ckpts = []; // ≤1-hop: no further checkpoint is ever evaluated after a switch
    if (out.r === "") {
      void this.finalize();
      return;
    }
    // `r` is a server-guaranteed WINNING section of the target plan (so it is in
    // planMeta → walkable); jump straight to it (a defensive Math.max clamps
    // a -1 "not found" up to 0 — the first — same as an explicit ternary,
    // fewer bytes).
    store.setSectionIndex(Math.max(cfg.sections.findIndex((s) => s.section_public_id === out.r), 0));
    this.enterPage(null);
    this.persist();
  }

  private handleInputEvent(target: Element): void {
    const input = target.closest("[data-lg-input]") || target;
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

    // §6.8 (S4b): a slider moves its own type-specific visuals here — BEFORE
    // the answer is recorded, so a from_to/dual handle dragged past its
    // neighbour records the CLAMPED value (syncDualRange's rule), never the raw
    // crossing one. A non-null return also means the two-handle geometry (fill
    // left+width, per-handle pills) is already written, so the single-value
    // render.updateRangeDisplay below MUST be skipped — it would rewrite the
    // fill's width from one handle and collapse the span.
    let dual: string | null = null;
    if (input instanceof HTMLInputElement) {
      dual = syncSlider(input);
      if (dual !== null) value = dual;
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
      const mask = phoneMask(component);
      if (mask !== null && input instanceof HTMLInputElement) {
        // §6.9: an authored mask drives the FILL UX — reformat the scaffold,
        // park the caret at the first empty slot, and RECORD THE RAW DIGITS
        // (never the scaffold display, never E.164): the compiled ^\d{n}$
        // contract gates completeness on exactly this raw digit string.
        value = this.applyPhoneMask(input, mask, value);
      } else {
        // Legacy preset / no mask → byte-identical E.164 normalization (L-192).
        const e164 = normalizePhoneE164(value);
        if (e164 !== null) value = e164;
      }
    }

    const meta = this.answerMeta(questionId, section);
    const write = this.store.recordUserAnswer(internalField, value, meta);
    // S2-3 (register §C): a range slider moves its own visible value text +
    // filled track live as it is dragged (input fires continuously).
    if (input instanceof HTMLInputElement && input.type === "range" && dual === null) {
      render.updateRangeDisplay(input);
    }
    // §6.8: keep aria-valuenow live on EVERY slider handle — updateRangeDisplay
    // covers the single .lg-range case; a from_to/dual role=slider handle (incl.
    // a number input outside a .lg-range) is stamped here so assistive tech
    // always reads the current value (role=slider + aria-valuemin/max are
    // server-static; aria-valuenow is the one dynamic axis the engine owns).
    if (input.getAttribute("role") === "slider") {
      input.setAttribute(ARIA_NOW, String(value));
    }
    // §6.5: an authored "Other" select records like a base choice; picking it
    // must DESELECT every base choice. The other value is unique vs the base
    // values (save-gate), so applySelectionClasses(value) clears them all.
    // Scoped to the panel's own question; no-op for any non-Other input.
    if (questionEl !== null && input.closest("[data-lg-other-panel]") !== null) {
      render.applySelectionClasses(questionEl, value);
    }
    // Editing clears the field's stale error immediately — the INPUT's own
    // section (same-screen pages: not necessarily this.si's anchor section).
    const sectionEl = input.closest("[data-lg-section]");
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

  // Validates ONE section AT A GIVEN INDEX (same-screen pages: the section
  // being checked is not necessarily this.si's anchor — every visible
  // section of the current page is checked in turn by handleContinue below).
  private sectionPassesAt(index: number, section: LgSectionConfig): boolean {
    const deps = this.dependencyState(section);
    const failures = validateSection(section.components, this.evalAnswers(), deps.components);
    const sectionEl = render.sectionElementAt(this.root, index);
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

  // Round-4 P3a same-screen pages (D-3 operator amendment): Continue gates
  // the WHOLE PAGE — every VISIBLE section of the current page must pass
  // (composing sectionPassesAt over each; a single-section/legacy page is
  // the length-1 case, byte-identical to pre-amendment). Every section's
  // errors paint (no early return), so the visitor sees every outstanding
  // field across the page in one pass, not one section at a time.
  private handleContinue(): void {
    const visible = this.visibleIndexes();
    const visibleInPage = this.currentPageIndices().filter((i) => visible.indexOf(i) !== -1);
    this.beacons.enqueue("continue_click", this.sectionDims(this.currentSection()));
    let allPass = true;
    for (const i of visibleInPage) {
      const section = this.config.sections[i];
      if (section === undefined) continue;
      if (!this.sectionPassesAt(i, section)) allPass = false;
    }
    if (!allPass) return;
    // Round-4 P4a (D-2): a routing-enabled funnel (checkpoint pages present)
    // routes the page-complete through the /lg/ck evaluation first
    // (it owns its own advance() fallback on any non-switch); every OTHER
    // funnel — AND this one once switched (maybeSwitch clears `ckpts`, the
    // ≤1-hop invariant) — takes the unchanged SYNCHRONOUS advance
    // (byte-neutral — no routing rules => `ckpts` is empty).
    this.ckpts.length > 0 ? void this.maybeSwitch() : this.advance();
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
    this.enterPage("back");
    this.persist();
  }

  // Round-4 P3a same-screen pages: advancing skips PAST the ENTIRE current
  // page (its structural last index, regardless of per-section visibility —
  // pageIndicesFor is ascending, so its own last entry IS that boundary) to
  // the next VISIBLE section, which by construction belongs to the NEXT
  // page. A single-section/legacy page's "structural last index" is just
  // itself, so this is byte-identical to the pre-amendment per-section walk.
  private advance(): void {
    const section = this.currentSection();
    const current = this.si;
    this.beacons.enqueue("section_continue", {
      ...this.sectionDims(section),
      continued_to_next_section: true,
    });

    const pageIndices = this.currentPageIndices();
    const lastOfPage = pageIndices[pageIndices.length - 1] ?? current;
    const nextIndex = this.visibleIndexes().find((i) => i > lastOfPage);

    if (nextIndex === undefined) {
      // §3.5.6: advancing past the LAST visible PAGE — and never before —
      // triggers the auction.
      void this.finalize();
      return;
    }
    this.store.pushBack(current);
    this.store.setSectionIndex(nextIndex);
    this.enterPage(null);
    this.persist();
  }

  // Round-4 P3a same-screen pages (D-3 operator amendment, 2026-07-20): show
  // EVERY dependency-visible section of the CURRENT page TOGETHER (this.si
  // is the page's anchor — set by the caller via store.setSectionIndex
  // immediately before calling this); a single-section/legacy page is the
  // length-1 case, byte-identical to the pre-amendment one-section-at-a-time
  // behavior. Applies defaults, shows the sections, progress/back/focus
  // (focus the FIRST shown section), section_view per shown section
  // (nav="back" on back-nav).
  private enterPage(nav: "back" | null, fireView = true): void {
    const visible = this.visibleIndexes();
    const visibleInPage = this.currentPageIndices().filter((i) => visible.indexOf(i) !== -1);

    for (const i of visibleInPage) {
      const section = this.config.sections[i];
      if (section !== undefined) this.applySectionDefaults(section);
    }

    const shownEls = render.showPageSections(this.root, visibleInPage);
    for (let k = 0; k < visibleInPage.length; k++) {
      const i = visibleInPage[k];
      const section = i !== undefined ? this.config.sections[i] : undefined;
      const sectionEl = shownEls[k];
      if (section === undefined || sectionEl === undefined) continue;
      render.applyComponentVisibility(sectionEl, this.dependencyState(section).components);
      this.applyContinueVisibility(section, sectionEl, k === visibleInPage.length - 1);
      // Restore selection classes for restored/default answers.
      for (const component of section.components) {
        const field = component.internal_field;
        if (field === undefined || field === "") continue;
        const entry = this.store.getAnswer(field);
        const questionEl = sectionEl.querySelector(
          `[data-lg-question="${component.question_id.replace(/["\\\]]/g, "\\$&")}"]`,
        );
        if (questionEl === null) continue;
        // §6.9: a masked phone always shows the fill scaffold — the EMPTY
        // template on first entry, or the recorded raw digits re-filled on
        // restore/back-nav (the visitor sees "(215) ___-____", never a bare
        // "215"). Legacy phones (no mask) fall through unchanged (L-192).
        const mask = phoneMask(component);
        if (mask !== null) {
          const inputEl = questionEl.querySelector("[data-lg-input]");
          if (inputEl instanceof HTMLInputElement) {
            inputEl.value = fillMaskScaffold(
              mask.scaffold,
              String(entry?.value ?? "").replace(/\D/g, ""),
            ).text;
          }
        }
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
        if (entry !== undefined) {
          render.applySelectionClasses(questionEl, entry.value);
        }
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
    if (shownEls[0] !== undefined) render.focusSection(shownEls[0]);
    this.updateProgressUi();
    if (fireView) {
      for (const i of visibleInPage) this.fireSectionView(this.config.sections[i] || null, nav);
    }
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

  // Round-4 P3a: progress counts PAGES (denominator = the resolved plan
  // length; numerator = the current section's page index) when a plan
  // exists — a multi-slot page's internal section-to-section transitions
  // keep the SAME page number (the visitor only sees it tick up crossing a
  // PAGE boundary). planMeta null (legacy) falls through to the unchanged
  // per-SECTION count, byte-identical to pre-P3a.
  private updateProgressUi(): void {
    const visible = this.visibleIndexes();
    const pos = visible.indexOf(this.si);
    const section = this.currentSection();
    // `||`/explicit checks not `?.`/`??` -- see the setAnswer hook's note
    // above (this file's es2019 build target transpiles chained `?.`/`??`
    // into far costlier ternary chains; this is a 3-link chain).
    const meta = this.planMeta !== null && section !== null ? this.planMeta.get(section.section_public_id) : undefined;
    const page = meta !== undefined ? meta[0] : undefined;
    const total = page !== undefined ? this.pagesCount : visible.length;
    const current = page !== undefined ? page + 1 : pos === -1 ? 1 : pos + 1;
    render.updateProgress(this.root, current, total);
    // 11 §11.3 footer show_on: first = the first VISIBLE section/page (pos -1
    // normalizes to step 1, matching updateProgress); final = the last one
    // (the banners-view leg rides showCompletionState). The `pos !== -1`
    // guard is load-bearing ONLY on the no-plan path (a plan-resolved
    // section is never pos-ambiguous).
    render.updateFooterVisibility(this.root, current <= 1, page !== undefined ? current === total : pos !== -1 && current === total, current);
  }

  // ----- §3.6 auction -------------------------------------------------------

  private buildAuctionRequest(): LgAuctionRequest {
    const hidden = this.hiddenFields();
    const versions: Record<string, string> = {};
    for (const section of this.config.sections) {
      versions[section.section_public_id] = section.answer_mapping_version;
    }
    // P4a (D-2): a checkpoint SWITCH already overwrote config's binding fields
    // in place with the target's, so these read the TARGET after a switch (the
    // re-issued token binds it; the server re-validates + re-derives from THERE,
    // never the client echo) and the origin variant before one — byte-identical
    // to pre-P4a on the no-switch path.
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
      render.showRuntimeNotice(this.currentSectionEl() || this.root, FRIENDLY_ERROR);
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
            carrier_key: imp.carrier_key || "",
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
      config = JSON.parse(configEl.textContent || "") as LgPublicConfig;
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
