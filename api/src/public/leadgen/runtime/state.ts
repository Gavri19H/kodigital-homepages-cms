// LeadGen runtime — answer store + persistence (fix-contract v2.4 03 §3.4).
//
// DOM-FREE by design (03 §3.10 / slice testability): every effect goes through
// injected adapters (storage get/set/remove/keys + now()), so vitest (node env)
// tests this module directly. The engine wraps window.sessionStorage behind the
// adapter; NO localStorage ever (03 §3.9).
//
// §3.4 normative shape implemented EXACTLY (LgAnswerSource / LgAnswerEntry /
// LgRuntimeState). Answer-source transitions (§3.4 defaults paragraph):
//   * on section entry a config `default_answer` is applied ONCE as
//     "default_applied";
//   * a user click on the SAME value converts it to "user_confirmed_default";
//   * a different value → "user_selected".
// Serialization EXCLUDES dependency-hidden answers (they stay in memory for
// back-nav, §3.5.3); persistence key is `lg:{funnel_attempt_id}`; state is
// cleared on quote_complete (§3.2 state.ts row).
//
// Restore-on-reload (§3.5.1 "restore sessionStorage state iff same
// attempt-binding tuple"): /lg/attempt is no-store and mints a FRESH
// funnel_attempt_id per load, and the signed_config_token is held in MEMORY
// only (§3.4) — so a reload cannot re-find state by the new attempt key.
// The store therefore scans `lg:*` entries and adopts the one whose PERSISTED
// binding tuple {funnel_variant_id, section_order_hash, content_version}
// equals the current config's tuple (attempt id necessarily differs across
// reloads; the tuple is what proves "same funnel shape" — 05 §5.3 binding
// minus the per-load ids). A tuple mismatch (new content version / different
// variant) discards the stale entry. This also keeps A/B identity stable
// across reload (10 §10.4): same ko_sid ⇒ same variant ⇒ same tuple.

// ---------------------------------------------------------------------------
// Public-config mirror types (the #lg-config JSON — config-dto.ts shapes)
// ---------------------------------------------------------------------------

// Mirror of config-dto.ts PublicSectionComponent / PublicSectionConfig /
// LeadgenPublicConfig with the exact field names the DTO serializes. Kept
// LOCAL to runtime/ (no server imports): the bundle must stay dependency-free
// and the runtime tsconfig covers only this directory.

export type LgConditionOp =
  | "eq"
  | "neq"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "range"
  | "in"
  | "not_in";

export interface LgConditional {
  when: string;
  op: LgConditionOp;
  value?: unknown;
  values?: unknown[];
  from?: number;
  to?: number;
}

export interface LgChoice {
  label: string;
  value: string | number | boolean;
  analytics_id: string;
  icon?: string;
  description?: string;
  imageMediaId?: string;
}

export interface LgComponentConfig {
  type: string;
  question_id: string;
  question_key?: string;
  internal_field?: string;
  answer_type?: string;
  required?: boolean;
  valid_values?: Array<string | number | boolean>;
  choices?: LgChoice[];
  conditional?: LgConditional;
  props: Record<string, unknown>;
  client_validation?: Record<string, unknown>;
  default_answer?: { value: unknown; answer_source: "default_applied" };
}

export interface LgSectionConfig {
  section_public_id: string;
  section_index: number;
  headline: string;
  subheadline?: string;
  continue_mode: string; // "button" | "auto_advance" (sections.ts vocabulary)
  address_validation_enabled: boolean;
  section_mapping_version: number;
  answer_mapping_version: string;
  components: LgComponentConfig[];
}

export interface LgPublicConfig {
  quote_id: string;
  funnel_id: string;
  funnel_variant_id: string;
  funnel_name: string;
  content_version: number;
  funnel_design_id: string;
  design_tokens: Record<string, unknown>;
  section_order_hash: string;
  ga4_measurement_id: string | null;
  funnel_ab_test_id: string;
  funnel_ab_test_revision: number;
  variant_label: string;
  traffic_allocation_bp: number;
  assignment_reason: string;
  sections: LgSectionConfig[];
}

// ---------------------------------------------------------------------------
// §3.4 runtime state shape (normative)
// ---------------------------------------------------------------------------

export type LgAnswerSource = "default_applied" | "user_selected" | "user_confirmed_default";

export interface LgAnswerEntry {
  value: unknown;
  answer_source: LgAnswerSource;
  question_id: string;
  section_public_id: string;
  answered_at: number;
}

export type LgAuctionStatus = "idle" | "pending" | "filled" | "unfilled" | "error";

export interface LgRuntimeState {
  session_id: string; // ko_sid cookie (existing session convention)
  page_view_id: string; // minted per page load
  funnel_attempt_id: string; // from /lg/attempt
  signed_config_token: string; // held in memory, sent ONLY to /lg/auction
  section_index: number;
  back_stack: number[];
  answers: Record<string /*internal_field*/, LgAnswerEntry>;
  auction: {
    status: LgAuctionStatus;
    auction_result_id?: string;
    banner_render_id?: string;
  };
}

// The attempt-binding tuple persisted WITH the snapshot; restore requires an
// exact match against the current config (see module header).
export interface LgBindingTuple {
  funnel_variant_id: string;
  section_order_hash: string;
  content_version: number;
}

// Persisted snapshot (versioned; NEVER carries signed_config_token — §3.4
// keeps the token in memory only — nor session/page ids, which are re-derived
// per load).
export interface LgPersistedSnapshot {
  v: 1;
  tuple: LgBindingTuple;
  section_index: number;
  back_stack: number[];
  answers: Record<string, LgAnswerEntry>;
  saved_at: number;
}

// ---------------------------------------------------------------------------
// Injected adapters
// ---------------------------------------------------------------------------

export interface LgStorageAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

export interface LgStateAdapters {
  storage: LgStorageAdapter;
  now: () => number;
}

const STORAGE_PREFIX = "lg:";

export function storageKeyForAttempt(funnelAttemptId: string): string {
  return `${STORAGE_PREFIX}${funnelAttemptId}`;
}

// Value equality for the §3.4 same-value-click test. Scalars compare strictly
// (the typed choice value round-trips through the config lookup, so a number
// stays a number); arrays (multi-select) compare element-wise.
export function answersEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  return a === b;
}

export interface LgAnswerWrite {
  entry: LgAnswerEntry;
  // Source transition the write produced (the engine fires answer events from
  // this): "default" = default_applied written; "confirmed" =
  // default→user_confirmed_default; "selected" = user_selected (new or
  // changed); "unchanged" = same user value re-clicked (no event needed
  // beyond answer_click itself).
  transition: "default" | "confirmed" | "selected" | "unchanged";
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class LgStateStore {
  private readonly adapters: LgStateAdapters;
  readonly state: LgRuntimeState;
  private tuple: LgBindingTuple;

  constructor(adapters: LgStateAdapters) {
    this.adapters = adapters;
    this.tuple = { funnel_variant_id: "", section_order_hash: "", content_version: 0 };
    this.state = {
      session_id: "",
      page_view_id: "",
      funnel_attempt_id: "",
      signed_config_token: "",
      section_index: 0,
      back_stack: [],
      answers: {},
      auction: { status: "idle" },
    };
  }

  bindIdentity(ids: {
    session_id: string;
    page_view_id: string;
    funnel_attempt_id: string;
    signed_config_token: string;
    tuple: LgBindingTuple;
  }): void {
    this.state.session_id = ids.session_id;
    this.state.page_view_id = ids.page_view_id;
    this.state.funnel_attempt_id = ids.funnel_attempt_id;
    this.state.signed_config_token = ids.signed_config_token;
    this.tuple = ids.tuple;
  }

  getTuple(): LgBindingTuple {
    return this.tuple;
  }

  // §3.4: apply a config default ONCE — a field that already has ANY entry
  // (restored or user-written) is never overwritten. Returns the write when
  // applied, null when skipped.
  applyDefault(
    internalField: string,
    value: unknown,
    meta: { question_id: string; section_public_id: string },
  ): LgAnswerWrite | null {
    if (Object.prototype.hasOwnProperty.call(this.state.answers, internalField)) return null;
    const entry: LgAnswerEntry = {
      value,
      answer_source: "default_applied",
      question_id: meta.question_id,
      section_public_id: meta.section_public_id,
      answered_at: this.adapters.now(),
    };
    this.state.answers[internalField] = entry;
    return { entry, transition: "default" };
  }

  // §3.4 user write: SAME value over a default → user_confirmed_default; a
  // different value → user_selected; same value over an existing user answer
  // → unchanged (source kept).
  recordUserAnswer(
    internalField: string,
    value: unknown,
    meta: { question_id: string; section_public_id: string },
  ): LgAnswerWrite {
    const existing = this.state.answers[internalField];
    let source: LgAnswerSource = "user_selected";
    let transition: LgAnswerWrite["transition"] = "selected";
    if (existing !== undefined) {
      const same = answersEqual(existing.value, value);
      if (
        same &&
        (existing.answer_source === "default_applied" ||
          existing.answer_source === "user_confirmed_default")
      ) {
        source = "user_confirmed_default";
        transition = existing.answer_source === "default_applied" ? "confirmed" : "unchanged";
      } else if (same && existing.answer_source === "user_selected") {
        source = "user_selected";
        transition = "unchanged";
      }
    }
    const entry: LgAnswerEntry = {
      value,
      answer_source: source,
      question_id: meta.question_id,
      section_public_id: meta.section_public_id,
      answered_at: this.adapters.now(),
    };
    this.state.answers[internalField] = entry;
    return { entry, transition };
  }

  getAnswer(internalField: string): LgAnswerEntry | undefined {
    return this.state.answers[internalField];
  }

  // The dependency/validation evaluation space: internal_field → raw value
  // (mirrors the server's normalized-answers map shape).
  answerValues(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(this.state.answers)) {
      const entry = this.state.answers[key];
      if (entry !== undefined) out[key] = entry.value;
    }
    return out;
  }

  // §3.6 auction projection over the SERIALIZABLE (dependency-visible) set:
  // internal_field → {value, answer_source}. Hidden answers are excluded the
  // same way serialization excludes them.
  auctionAnswers(
    hiddenFields: ReadonlySet<string>,
  ): Record<string, { value: unknown; answer_source: LgAnswerSource }> {
    const out: Record<string, { value: unknown; answer_source: LgAnswerSource }> = {};
    for (const key of Object.keys(this.state.answers)) {
      if (hiddenFields.has(key)) continue;
      const entry = this.state.answers[key];
      if (entry !== undefined) out[key] = { value: entry.value, answer_source: entry.answer_source };
    }
    return out;
  }

  pushBack(index: number): void {
    this.state.back_stack.push(index);
  }

  popBack(): number | undefined {
    return this.state.back_stack.pop();
  }

  setSectionIndex(index: number): void {
    this.state.section_index = index;
  }

  setAuction(auction: LgRuntimeState["auction"]): void {
    this.state.auction = auction;
  }

  // -------------------------------------------------------------------------
  // Persistence (§3.2 state.ts row): sessionStorage["lg:{funnel_attempt_id}"]
  // -------------------------------------------------------------------------

  // Serialize EXCLUDING dependency-hidden answers (§3.5.3) — hidden entries
  // stay in memory only.
  serialize(hiddenFields: ReadonlySet<string>): string {
    const answers: Record<string, LgAnswerEntry> = {};
    for (const key of Object.keys(this.state.answers)) {
      if (hiddenFields.has(key)) continue;
      const entry = this.state.answers[key];
      if (entry !== undefined) answers[key] = entry;
    }
    const snapshot: LgPersistedSnapshot = {
      v: 1,
      tuple: this.tuple,
      section_index: this.state.section_index,
      back_stack: [...this.state.back_stack],
      answers,
      saved_at: this.adapters.now(),
    };
    return JSON.stringify(snapshot);
  }

  persist(hiddenFields: ReadonlySet<string>): void {
    if (this.state.funnel_attempt_id === "") return;
    this.adapters.storage.set(
      storageKeyForAttempt(this.state.funnel_attempt_id),
      this.serialize(hiddenFields),
    );
  }

  // Cleared on quote_complete (§3.2).
  clearPersisted(): void {
    if (this.state.funnel_attempt_id === "") return;
    this.adapters.storage.remove(storageKeyForAttempt(this.state.funnel_attempt_id));
  }

  // Adopt a restored snapshot (answers/pointer/back-stack). Identity fields
  // (session/page/attempt/token) are NOT part of a snapshot and stay as bound.
  adoptSnapshot(snapshot: LgPersistedSnapshot): void {
    this.state.section_index = snapshot.section_index;
    this.state.back_stack = [...snapshot.back_stack];
    this.state.answers = { ...snapshot.answers };
  }
}

// ---------------------------------------------------------------------------
// Restore scan (module-level pure helpers — directly unit-testable)
// ---------------------------------------------------------------------------

function isAnswerEntryLike(v: unknown): v is LgAnswerEntry {
  if (v === null || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    (e["answer_source"] === "default_applied" ||
      e["answer_source"] === "user_selected" ||
      e["answer_source"] === "user_confirmed_default") &&
    typeof e["question_id"] === "string" &&
    typeof e["section_public_id"] === "string" &&
    typeof e["answered_at"] === "number"
  );
}

// Parse one persisted value; malformed/corrupt → null (dedicated try/catch —
// the caller deletes the corrupt entry and falls through, the JSON-parse
// safety idiom).
export function parseSnapshot(raw: string | null): LgPersistedSnapshot | null {
  if (raw === null || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const s = parsed as Record<string, unknown>;
  if (s["v"] !== 1) return null;
  const tuple = s["tuple"];
  if (tuple === null || typeof tuple !== "object") return null;
  const t = tuple as Record<string, unknown>;
  if (
    typeof t["funnel_variant_id"] !== "string" ||
    typeof t["section_order_hash"] !== "string" ||
    typeof t["content_version"] !== "number"
  ) {
    return null;
  }
  if (typeof s["section_index"] !== "number") return null;
  if (!Array.isArray(s["back_stack"]) || !s["back_stack"].every((n) => typeof n === "number")) {
    return null;
  }
  const answersRaw = s["answers"];
  if (answersRaw === null || typeof answersRaw !== "object" || Array.isArray(answersRaw)) {
    return null;
  }
  const answers: Record<string, LgAnswerEntry> = {};
  for (const key of Object.keys(answersRaw as Record<string, unknown>)) {
    const entry = (answersRaw as Record<string, unknown>)[key];
    if (!isAnswerEntryLike(entry)) return null;
    answers[key] = entry;
  }
  return {
    v: 1,
    tuple: {
      funnel_variant_id: t["funnel_variant_id"],
      section_order_hash: t["section_order_hash"],
      content_version: t["content_version"],
    },
    section_index: s["section_index"],
    back_stack: s["back_stack"] as number[],
    answers,
    saved_at: typeof s["saved_at"] === "number" ? s["saved_at"] : 0,
  };
}

export function tupleMatches(a: LgBindingTuple, b: LgBindingTuple): boolean {
  return (
    a.funnel_variant_id === b.funnel_variant_id &&
    a.section_order_hash === b.section_order_hash &&
    a.content_version === b.content_version
  );
}

export interface LgRestoreHit {
  key: string;
  snapshot: LgPersistedSnapshot;
}

// Scan `lg:*` entries for a snapshot whose binding tuple matches the CURRENT
// config tuple (§3.5.1 restore rule — see module header for why the attempt
// id itself cannot key the lookup across reloads). Corrupt entries are
// DELETED; non-matching (stale-tuple) entries are deleted too, so storage
// never accumulates dead funnels. Returns the newest match by saved_at.
export function scanForRestorableSnapshot(
  storage: LgStorageAdapter,
  currentTuple: LgBindingTuple,
): LgRestoreHit | null {
  let best: LgRestoreHit | null = null;
  for (const key of storage.keys()) {
    if (!key.startsWith(STORAGE_PREFIX)) continue;
    const snapshot = parseSnapshot(storage.get(key));
    if (snapshot === null) {
      storage.remove(key); // corrupt → delete → fall through (safety idiom)
      continue;
    }
    if (!tupleMatches(snapshot.tuple, currentTuple)) {
      storage.remove(key); // different funnel shape → stale, discard
      continue;
    }
    if (best === null || snapshot.saved_at > best.snapshot.saved_at) {
      best = { key, snapshot };
    }
  }
  return best;
}
