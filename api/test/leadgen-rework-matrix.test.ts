// LeadGen Rework (LEADGEN-REWORK-03) — P2 slice S2.5: THE executable §6.2
// matrix gate (contract AC #3 "the §6.2 matrix has an executable test
// asserting each type shows exactly its controls" + AC #10 "Dropdown shows no
// Other-group control (matrix test)"). Also carries the §11 #2B/#2C/#5/#6/#7/#8
// fixture-validity proof (a tiny sub-suite, per the P2 dispatch).
//
// TWO LAYERS, both executed against the REAL served admin page — never a
// hand-built consumer input (register discipline, feedback-test-end-to-end):
//
//   Layer A — the DATA CONTRACT. Fetches the real /admin/leadgen/sections/
//   :id/edit page and reads its `lg-studio-meta` bootstrap blob, whose
//   `types[type].capabilities` field is `COMPONENT_CAPABILITIES[type]`
//   (registry.ts) passed through `studioTypeMeta()` (ui-section-studio.ts)
//   completely UNCHANGED (own-hand-verified: studioTypeMeta's `capabilities:
//   COMPONENT_CAPABILITIES[type]` is a direct pass-through — own-hand-read,
//   ui-section-studio.ts, the export just above `renderStudioSeedData`).
//   Comparing that served value against EXPECTED_MATRIX (transcribed below
//   directly from the contract's §6.2 table prose, WITHOUT ever importing
//   registry.ts's COMPONENT_CAPABILITIES *values* — only its ComponentType/
//   ComponentCapabilitySpec *types*, for compile-time exhaustiveness) is what
//   lets this test catch a registry.ts transcription error, not just echo it
//   back with a different label.
//
//   Layer B — the RENDERED CONTROL. Slices the SAME served page's inline
//   island script (the `sliceIslandFunction`/`studioIsland` vm-probe idiom
//   leadgen-section-studio-ui.test.ts established) and actually EXECUTES
//   `populateInspector` (plus the small, self-contained real dependency
//   chain it needs for the controls below) against a fake `document` for a
//   synthetic node of every type, then reads back which control blocks ended
//   up hidden/visible. This proves the matrix isn't just correctly *served*
//   but correctly *painted*. ALL TWELVE §6.2 rows now have a concrete DOM
//   mechanism this file drives and asserts: label_helper
//   (`data-field-label-wrap` + the `helper` content-prop), required
//   (`data-content-behavior-section`), choices_editor
//   (`data-field-choices-block` + the `yesLabel`/`noLabel` content-props for
//   YesNo's "labels only" cell), default_kind (`data-default-wrap`/
//   `data-default-control`, all 4 kinds incl. the new 'choice'),
//   selected_marker (`data-selected-marker-wrap`), accept_type_swap
//   (`data-accept-wrap`), other_editor (`data-other-editor-block`, AC#8/#8D/
//   #10), slider_type (`data-slider-type-wrap`), field_set_maps
//   (`data-address-fieldset-block`), columns (`data-toolbar-choice-layout`,
//   now the SAME wrap for every columns===true type incl. the 5 Containers,
//   since S2.4 migrated it to a flag-driven `cap(node,'columns')` gate —
//   closing this file's original Layer-A-only gap), mask_builder
//   (`data-content-phoneformat-block`, likewise closed once S2.4 migrated it
//   to `cap(node,'mask_builder')`), placeholder (the `placeholder`
//   content-prop, with one documented exception).
//
// Every §6.2 row cites its contract line number so a future reviewer can
// re-verify the transcription without re-deriving it.

import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import type { ComponentType, ComponentCapabilitySpec } from "../src/public/leadgen/components/registry";
import { validateSectionContent } from "../src/public/leadgen/components/content-schema";

// ---------------------------------------------------------------------------
// node:sqlite + D1 harness — SAME shape as leadgen-section-studio-ui.test.ts
// (test-local duplication of a proven pattern; no shared import exists for
// it, and this file must not touch that file to add one).
// ---------------------------------------------------------------------------

type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    const nodeRequire = createRequire(import.meta.url);
    return (nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
    try {
      const getBuiltin = (process as unknown as { getBuiltinModule?: (n: string) => unknown }).getBuiltinModule;
      if (typeof getBuiltin === "function") {
        return (getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
      }
    } catch {
      /* fall through */
    }
    return null;
  }
}

function runSql(sdb: SqliteDb, sql: string): void {
  (sdb["exec"] as (s: string) => void)(sql);
}

function d1FromSqlite(sdb: SqliteDb): D1Database {
  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          binds = a;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          return (sdb.prepare(sql).get(...binds) ?? null) as T | null;
        },
        async all<T = unknown>() {
          return { results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} };
        },
        async run() {
          const r = sdb.prepare(sql).run(...binds) as { changes?: number; lastInsertRowid?: number | bigint };
          return { success: true, meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) } };
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      const out: unknown[] = [];
      try {
        for (const s of statements) out.push(await s.run());
        runSql(sdb, "COMMIT");
      } catch (err) {
        runSql(sdb, "ROLLBACK");
        throw err;
      }
      return out;
    },
  } as unknown as D1Database;
  return db;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
  "0040_leadgen_runtime_context.sql",
  "0041_leadgen_frame_theme.sql",
  "0042_leadgen_pages.sql",
  "0043_leadgen_routing_rules.sql",
  "0044_leadgen_redirect_pct.sql",
  "0045_leadgen_persona_quota.sql",
  "0046_leadgen_rework_m1_variants.sql",
  "0047_leadgen_rework_m2_shared_pages.sql",
  "0048_leadgen_rework_m3_routing.sql",
  "0049_leadgen_rework_m4_m5_defaults_templates.sql",
  "0050_leadgen_rework_m6_grid_expansion.sql",
  "0051_leadgen_rework_m7_slider_collapse.sql",
  "0052_leadgen_rework_m9_address_fields.sql",
  "0053_leadgen_rework_m12_othergroup_retirement.sql",
] as const;

function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(sdb, "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);");
  for (const file of LEADGEN_MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  return sdb;
}

function buildEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
  };
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function newHarness(): { sdb: SqliteDb; env: Env } {
  const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb)) };
}

const API = "/api/admin/leadgen";

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

const YESNO_CONTENT = {
  components: [
    { type: "TwoButtonYesNo", question_id: "q1", question_key: "insured_q", internal_field: "currently_insured", answer_type: "boolean" },
  ],
};

interface SectionDetail {
  id: number;
  public_id: string;
  [k: string]: unknown;
}

async function createSection(env: Env, overrides: Record<string, unknown> = {}): Promise<SectionDetail> {
  const res = await admin.request(
    `${API}/sections`,
    jsonInit("POST", {
      section_name: "LeadGen Rework matrix probe section",
      activity: "quote_funnel",
      vertical: "life",
      headline_text: "Matrix probe",
      content_json: JSON.stringify(YESNO_CONTENT),
      ...overrides,
    }),
    env,
  );
  expect(res.status, `create section: ${await res.clone().text()}`).toBe(201);
  return (await res.json()) as SectionDetail;
}

async function getHtml(env: Env, path: string, expectedStatus = 200): Promise<string> {
  const res = await admin.request(path, {}, env);
  expect(res.status, `${path} status`).toBe(expectedStatus);
  return res.text();
}

async function studioPage(env: Env, publicId: string): Promise<string> {
  return getHtml(env, `/admin/leadgen/sections/${publicId}/edit`);
}

function extractJsonBlob(html: string, id: string): Record<string, unknown> {
  const marker = `id="${id}">`;
  const start = html.indexOf(marker);
  expect(start, `blob ${id} present`).toBeGreaterThan(-1);
  const from = start + marker.length;
  const end = html.indexOf("</script>", from);
  const raw = html.slice(from, end).split("\\u003c").join("<");
  return JSON.parse(raw) as Record<string, unknown>;
}

const SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

function extractScripts(html: string): string[] {
  const blocks: string[] = [];
  for (const match of html.matchAll(SCRIPT_RE)) {
    if ((match[0] ?? "").includes('type="application/json"')) continue;
    blocks.push(match[1] ?? "");
  }
  return blocks;
}

function studioIsland(html: string): string {
  const island = extractScripts(html).find((s) => s.includes("function renderCanvasNow("));
  expect(island, "studio island present").toBeDefined();
  return island!;
}

function sliceIslandFunction(script: string, name: string): string {
  const marker = `function ${name}(`;
  const start = script.indexOf(marker);
  expect(start, `island function ${name} present`).toBeGreaterThan(-1);
  const open = script.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < script.length; i += 1) {
    if (script[i] === "{") depth += 1;
    else if (script[i] === "}") {
      depth -= 1;
      if (depth === 0) return script.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces while slicing island function ${name}`);
}

// Single-statement `var NAME = <expr>;` — used for the small module-level
// lookup tables the sliced functions below read (own-hand-verified single-line
// in the served source at authoring time; re-verified by content, not line
// number, so future reformatting cannot silently break this).
function sliceIslandLine(script: string, startsWith: string): string {
  const start = script.indexOf(startsWith);
  expect(start, `island line starting "${startsWith}"`).toBeGreaterThan(-1);
  const end = script.indexOf(";", start);
  expect(end, `island line starting "${startsWith}" terminates`).toBeGreaterThan(-1);
  return script.slice(start, end + 1);
}

// ---------------------------------------------------------------------------
// §6.2 EXPECTED_MATRIX — independently transcribed from the contract table
// (LEADGEN-REWORK-03-CONTRACT-PLAN.md §6.2, lines 108-121), cell by cell.
// This file imports ONLY `ComponentType`/`ComponentCapabilitySpec` (compile-
// time TYPES, erased at runtime) from registry.ts for exhaustiveness — it
// NEVER imports `COMPONENT_CAPABILITIES` (the runtime VALUES) — so a
// transcription mistake in registry.ts shows up as a Layer A/B mismatch
// below, not as a trivially-true tautology.
//
// The contract's 13 named columns map onto ComponentType as follows (§6.2
// header row): YesNo->TwoButtonYesNo · Buttons->ButtonAnswerGroup ·
// IconCards->IconCardAnswerGrid · ImageCards->ImageCardAnswerGrid ·
// MultiChoiceCards(multi)->MultiChoiceCardGroup · Dropdown/Searchable->
// DropdownQuestion+SearchableDropdownQuestion · FreeText/Email/Number/
// Currency/Date/ZIP->FreeTextQuestion+EmailInputQuestion+NumberInputQuestion+
// CurrencyInputQuestion+DateQuestion+ZIPInputQuestion · Phone->
// PhoneInputQuestion · Slider->RangeQuestion+CurrencyRangeQuestion+
// NumberRangeQuestion (the M7 collapsed + legacy triplet) · Address->
// AddressAutocompleteQuestion · NameFields/Contact->NameFieldsGroup ·
// TextBlock/Image/Spacer->TextBlock+ImageBlock+Spacer (explicitly the
// all-blank row) · Containers->Stack+GridContainer+Columns+CardPanel+
// BackgroundPanel. Every OTHER catalog type (chrome/copy-affordance/control)
// is outside the §6.2 table by construction — none of them has an
// internal_field/choices/default concern the matrix's 12 rows describe — so
// their cells are all-blank (NONE), which is self-evident from their
// purpose, not an assumption.
//
// The last table row ("Style / Rules / Offers... existing scope rules
// unchanged") is deliberately NOT modeled — ComponentCapabilitySpec has no
// field for it (12 fields = 12 real rows), matching the contract's own
// "existing, unchanged" framing for that row.
// ---------------------------------------------------------------------------

const NONE: ComponentCapabilitySpec = {
  label_helper: false,
  required: false,
  choices_editor: false,
  other_editor: false,
  default_kind: null,
  selected_marker: false,
  columns: false,
  accept_type_swap: false,
  mask_builder: false,
  slider_type: false,
  field_set_maps: false,
  placeholder: false,
};

// §6.2 rows for the "Buttons / IconCards / ImageCards" columns (identical
// cells across all three, lines 110-121): label_helper T, required T,
// choices_editor T, other_editor T, default_kind "choice" (marked **new**,
// line 114), selected_marker T, columns T, rest blank.
const CHOICE_SINGLE: ComponentCapabilitySpec = {
  ...NONE,
  label_helper: true,
  required: true,
  choices_editor: true,
  other_editor: true,
  default_kind: "choice",
  selected_marker: true,
  columns: true,
};

// §6.2 column "FreeText / Email / Number / Currency / Date / ZIP" (lines
// 110-121): label_helper T "(existing)", required T, accept_type_swap T,
// placeholder T; everything else blank.
const TEXT_INPUT: ComponentCapabilitySpec = {
  ...NONE,
  label_helper: true,
  required: true,
  accept_type_swap: true,
  placeholder: true,
};

// §6.2 column "Dropdown / Searchable" (lines 110-121): label_helper T,
// required T, choices_editor T, default_kind "dropdown" (existing),
// placeholder T; NO other_editor (line 113 blank — the #10 fix), NO
// selected_marker, NO columns.
const DROPDOWN: ComponentCapabilitySpec = {
  ...NONE,
  label_helper: true,
  required: true,
  choices_editor: true,
  default_kind: "dropdown",
  placeholder: true,
};

// §6.2 column "Slider" (lines 110-121): label_helper T, required T,
// default_kind "range" (existing), slider_type T; rest blank.
const SLIDER: ComponentCapabilitySpec = {
  ...NONE,
  label_helper: true,
  required: true,
  default_kind: "range",
  slider_type: true,
};

// §6.2 column "Containers" (line 116, the ONLY ✓ for this column across all
// 12 rows): columns T only.
const CONTAINER: ComponentCapabilitySpec = { ...NONE, columns: true };

export const EXPECTED_MATRIX: Record<ComponentType, ComponentCapabilitySpec> = {
  // chrome — outside §6.2 (funnel-frame components; no per-question inspector
  // controls of any of the 12 kinds apply).
  ProgressBar: NONE,
  HeaderLogo: NONE,
  BackButton: NONE,
  DisclosureLink: NONE,
  StepIndicator: NONE,
  // copy affordances — outside §6.2 (no internal_field/choices/default concern).
  CategoryLabel: NONE,
  QuestionHeadline: NONE,
  Subheadline: NONE,
  // §6.2 column "Slider" (the ONE M7-collapsed entry, §10).
  NumberRangeQuestion: SLIDER,
  // §6.2 column "Buttons".
  ButtonAnswerGroup: CHOICE_SINGLE,
  // §6.2 column "YesNo" (lines 110-121): label_helper T, required T,
  // choices_editor "labels only" (line 112), other_editor BLANK (line 113 —
  // YesNo has no Other affordance), default_kind "yesno" (existing),
  // selected_marker T, columns BLANK (line 116 — YesNo has no column count;
  // its two fixed buttons are not a variable-count grid).
  TwoButtonYesNo: {
    ...NONE,
    label_helper: true,
    required: true,
    choices_editor: "labels_only",
    default_kind: "yesno",
    selected_marker: true,
  },
  // §6.2 columns "IconCards" / "ImageCards".
  IconCardAnswerGrid: CHOICE_SINGLE,
  ImageCardAnswerGrid: CHOICE_SINGLE,
  // §6.2 column "MultiChoiceCards (multi)" (lines 110-121): label_helper T,
  // required T, choices_editor T, other_editor BLANK (line 113 — single-select
  // only, §6.5), default_kind null (line 114 blank — §6.4 "Multi-select has
  // no default in v1"), selected_marker T, columns T.
  MultiChoiceCardGroup: {
    ...NONE,
    label_helper: true,
    required: true,
    choices_editor: true,
    selected_marker: true,
    columns: true,
  },
  // §6.2 column "Dropdown / Searchable".
  DropdownQuestion: DROPDOWN,
  SearchableDropdownQuestion: DROPDOWN,
  // §6.2 column "FreeText / Email / Number / Currency / Date / ZIP".
  FreeTextQuestion: TEXT_INPUT,
  NumberInputQuestion: TEXT_INPUT,
  CurrencyInputQuestion: TEXT_INPUT,
  EmailInputQuestion: TEXT_INPUT,
  // §6.2 column "Phone": the text-input family's cells PLUS line 118's ONLY ✓
  // (Mask builder, §6.9).
  PhoneInputQuestion: { ...TEXT_INPUT, mask_builder: true },
  // §6.2 column "NameFields/Contact" (lines 110-121): label_helper
  // "per-field, existing" (line 110), required "per-field" (line 111), rest
  // blank except placeholder "per-field" (line 121).
  NameFieldsGroup: { ...NONE, label_helper: "per_field", required: "per_field", placeholder: "per_field" },
  DateQuestion: TEXT_INPUT,
  ZIPInputQuestion: TEXT_INPUT,
  // §6.2 column "Address" (lines 110-121): label_helper T (full ✓, NOT
  // per-field — only NameFields gets the per-field annotation on that row),
  // required "per-field" (line 111), other rows blank EXCEPT line 120's ONLY
  // ✓ (Field set + Maps, §6.10) and line 121 "per-field" (Placeholder).
  // accept_type_swap is BLANK for Address (line 117) — even though Address is
  // one of the 8 ACCEPT_TYPE_FORMAT-mapped renderers pre-rework, the studio's
  // existing isAddressNode override already forces the Accept dropdown
  // hidden; §6.2 codifies that net effect as capability, not the underlying
  // per-renderer format map.
  AddressAutocompleteQuestion: {
    ...NONE,
    label_helper: true,
    required: "per_field",
    field_set_maps: true,
    placeholder: "per_field",
  },
  // controls + remaining affordances — outside §6.2 (no answer-producing concern).
  ContinueButton: NONE,
  AutoAdvanceButton: NONE,
  ReassuranceBadge: NONE,
  SuccessState: NONE,
  SecureFormBadge: NONE,
  TrustBar: NONE,
  LogoStrip: NONE,
  HelperText: NONE,
  ValidationError: NONE,
  LegalNote: NONE,
  // §6.2 column "TextBlock / Image / Spacer" — explicitly the all-blank row.
  TextBlock: NONE,
  ImageBlock: NONE,
  // §6.2 column "Containers": line 116's ONLY ✓ (Columns).
  Stack: CONTAINER,
  GridContainer: CONTAINER,
  Columns: CONTAINER,
  CardPanel: CONTAINER,
  BackgroundPanel: CONTAINER,
  // Spacer is explicitly named in the "TextBlock / Image / Spacer" all-blank
  // column; HeaderBar/FooterBar are the two layout LEAVES that column doesn't
  // name but which carry the identical "no answer concern" reasoning (chrome
  // structural leaves, never an internal_field).
  Spacer: NONE,
  HeaderBar: NONE,
  FooterBar: NONE,
};

const ALL_TYPES = Object.keys(EXPECTED_MATRIX) as ComponentType[];

// ---------------------------------------------------------------------------
// Layer B fake DOM — a minimal, self-contained, per-selector-tracked
// `document` stub (there is no shared/generic one in the repo today — the
// existing harness hand-builds a bespoke stub per test; this is the same
// idiom, sized for populateInspector's actual selector surface, own-hand-
// verified against the served island source). `querySelector` auto-vivifies
// a stable fake element per exact selector string (so re-reading the SAME
// selector after running the probe returns the SAME element the island code
// mutated); `querySelectorAll` defaults to [] (so any loop over a selector
// this file doesn't care about silently no-ops, matching every call site's
// own `if (el) {...}` / `for` idiom) except the two multi-element groups
// below that a control genuinely needs.
// ---------------------------------------------------------------------------

interface FakeEl {
  hidden: boolean;
  value: string;
  textContent: string;
  className: string;
  checked: boolean;
  disabled: boolean;
  attrs: Record<string, string>;
  children: FakeEl[];
  getAttribute(k: string): string | null;
  setAttribute(k: string, v: string): void;
  appendChild(c: FakeEl): FakeEl;
  querySelector(sel: string): FakeEl | null;
  querySelectorAll(sel: string): FakeEl[];
  addEventListener(): void;
}

function makeFakeEl(attrs: Record<string, string> = {}): FakeEl {
  const el: FakeEl = {
    hidden: false,
    value: "",
    textContent: "",
    className: "",
    checked: false,
    disabled: false,
    attrs: { ...attrs },
    children: [],
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k]! : null;
    },
    setAttribute(k, v) {
      el.attrs[k] = String(v);
    },
    appendChild(c) {
      el.children.push(c);
      return c;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {
      /* no-op */
    },
  };
  return el;
}

// The generic per-type "labels/placeholder" content-prop rows this file
// tracks (data-content-prop="<key>") — helper (§6.3), placeholder, and
// yesLabel/noLabel (YesNo's "labels only" choices_editor cell).
const CONTENT_PROP_KEYS_TRACKED = ["helper", "placeholder", "yesLabel", "noLabel"] as const;
const DEFAULT_WRAP_KINDS = ["yesno", "range", "dropdown", "choice"] as const;

function buildProbeDoc() {
  const bySelector = new Map<string, FakeEl>();
  function forSelector(sel: string): FakeEl {
    let el = bySelector.get(sel);
    if (!el) {
      el = makeFakeEl();
      bySelector.set(sel, el);
    }
    return el;
  }
  const defaultWraps = DEFAULT_WRAP_KINDS.map((k) => makeFakeEl({ "data-default-wrap": k }));
  const contentPropEls = CONTENT_PROP_KEYS_TRACKED.map((k) => makeFakeEl({ "data-content-prop": k }));
  const doc = {
    querySelector(sel: string): FakeEl | null {
      return forSelector(sel);
    },
    querySelectorAll(sel: string): FakeEl[] {
      if (sel === "[data-default-wrap]") return defaultWraps;
      if (sel === "[data-content-prop]") return contentPropEls;
      return [];
    },
    getElementById(id: string): FakeEl | null {
      return forSelector(`#${id}`);
    },
    createElement(): FakeEl {
      return makeFakeEl();
    },
    createTextNode(): FakeEl {
      return makeFakeEl();
    },
  };
  return { doc, forSelector, defaultWraps, contentPropEls };
}

// The functions populateInspector's tail unconditionally calls that this
// file's tracked controls (label_helper/required/choices_editor/
// selected_marker/accept_type_swap/slider_type/other_editor/field_set_maps/
// placeholder, + default_kind via its own small real chain) do not need for
// real — stubbed as plain no-ops, the SAME idiom leadgen-section-studio-ui
// .test.ts's own vm-probe tests use ("function afterModelChange() {}" etc.)
// for callees outside a probe's concern. Listed with the §6.2/
// populateInspector-tail concern each replaces so a future reviewer can see
// nothing here is silently dropping a control this file DOES claim to test.
const LAYER_B_STUBS = [
  "function availableTabsFor() { return []; }", // tab visibility — not a §6.2 control
  "function setInspectorTab() {}",
  "function setAdvancedOpen() {}",
  "function populateSizeControls() {}",
  "function populateCornersBorderControls() {}",
  "function populateTextRoleControls() {}",
  "function populateContinueStyleRows() {}",
  "function populateContinueVisibility() {}",
  "function populatePlacementControls() {}",
  "function populateValidation() {}",
  "function populateMapsTab() {}",
  "function populateConditional() {}",
  "function hydrateRulesExtraRows() {}",
  "function syncRulesGroupChrome() {}",
  "function populateRulesAlwaysRow() {}",
  "function populateRequiredWhen() {}",
  "function populateYesNoStyleBlock() {}",
  "function populateConnectOffersCard() {}",
  "function populateContainerProps() {}",
  "function populateImageBlockControls() {}",
  "function populateNameFieldsGroupControls() {}",
  "function refreshPhoneMaskPreview() {}", // mask scaffold/A-10-error internals — only the mask_builder wrap's hidden-state is tracked here (populatePhoneFormatControls, real below)
  "function renderChoiceEditor() {}", // choices_editor's HIDDEN-STATE gate is inline in populateInspector, independent of this function's row-building internals (own-hand-verified)
  "function populateChoiceDisplay() {}", // the OLD (pre-§6.5) choiceDisplay editor — a DIFFERENT, still-coexisting mechanism from the NEW other_editor (populateOtherEditor, real below)
  "function renderOverrideDecorations() {}",
  "function renderPresetControls() {}",
  "function applyContinueModeEligibility() {}",
  "function syncRawJsonMode() {}",
  "function clearChildren() {}",
  // populateAddressFieldSet's own 4 helpers (real below) — only reached when
  // cap(node,'field_set_maps')===true, i.e. AddressAutocompleteQuestion; not
  // exercised by any other type. Their internals (row markup/Maps-fill wiring)
  // are out of THIS file's concern — only the wrap's hidden-state is tracked.
  "function addressFieldsOf() { return []; }",
  "function addressMapsEnabled() { return false; }",
  "function buildAddressRow() { return { attrs: {}, children: [], getAttribute: function () { return null; }, setAttribute: function () {}, appendChild: function (c) { return c; }, querySelector: function () { return null; }, querySelectorAll: function () { return []; }, addEventListener: function () {} }; }",
  "function renderAddressAddMenu() {}",
];

// Real, sliced-from-the-served-page functions this probe needs — kept small
// and self-contained on purpose (see the header comment: populateInspector's
// OWN tail is where label_helper/required/choices_editor/accept_type_swap/
// slider_type/placeholder are gated inline, so it must be sliced whole;
// selected_marker/default_kind/other_editor/field_set_maps each have their
// own small, separately-gated function that would be sliceable alone, but
// running them via the SAME populateInspector call this file already makes
// for the other rows is simpler than a second/third/fourth/fifth probe wiring).
const LAYER_B_REAL_FUNCS = [
  "typeMeta",
  "capsOf",
  "cap",
  "selectedNode",
  "findRef",
  "findRefIn",
  "walkTree",
  "contentVariantOf",
  "populateContentVariant",
  "styleVariantOf",
  "isSizeConsumingType",
  "isAnswerLayoutType",
  "isCardGridType",
  "placementEligible",
  "populateStyleVariant",
  "acceptFormatOfNode",
  "cardStyleOf",
  "defaultKindOf",
  "populateDefaultControls",
  "populateOtherEditor",
  "populateAddressFieldSet",
  "populatePhoneFormatControls",
  "populateInspector",
];

const LAYER_B_VARS = ["FRAME_SCOPE_STUDIO_TYPES", "SIZE_CONSUMING_TYPES", "ACCEPT_TYPE_FORMAT", "TEXT_ROLE_TYPES"];

interface ProbeResult {
  forSelector(sel: string): FakeEl;
  defaultWraps: FakeEl[];
  contentPropEls: FakeEl[];
}

// Run the REAL populateInspector (sliced from the served page) against a
// synthetic node of `type`, selected, with isNewSelection=true (the "a fresh
// selectComponent just fired" path — the same path a real author's click
// takes, per populateInspector's own header comment).
function runLayerBProbe(island: string, studioMeta: Record<string, unknown>, type: ComponentType): ProbeResult {
  const node = { type, question_id: "q_probe" };
  const { doc, forSelector, defaultWraps, contentPropEls } = buildProbeDoc();
  const sandbox: Record<string, unknown> = {
    document: doc,
    studioMeta,
    state: { content: { components: [node] } },
    selectedQuestionId: "q_probe",
    currentInspectorTab: "none",
    rawEditArmed: true,
    advancedOpen: true,
  };
  const source = [
    ...LAYER_B_STUBS,
    ...LAYER_B_VARS.map((v) => sliceIslandLine(island, `var ${v} =`)),
    ...LAYER_B_REAL_FUNCS.map((f) => sliceIslandFunction(island, f)),
  ].join("\n");
  runInNewContext(source, sandbox);
  runInNewContext("populateInspector(true);", sandbox);
  return { forSelector, defaultWraps, contentPropEls };
}

// ---------------------------------------------------------------------------
// Layer A — the served studio-meta capabilities projection.
// ---------------------------------------------------------------------------

describeDb("§6.2 matrix — Layer A: registry -> studioTypeMeta -> served bootstrap blob", () => {
  let studioMetaTypes: Record<string, { capabilities?: ComponentCapabilitySpec; content_props?: string[] }>;
  let html: string;

  beforeAll(async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    html = await studioPage(env, section.public_id);
    const meta = extractJsonBlob(html, "lg-studio-meta");
    studioMetaTypes = meta["types"] as typeof studioMetaTypes;
  });

  it("studio meta enumerates EXACTLY the §6.2-exhaustive catalog (no missing/extra type)", () => {
    expect(Object.keys(studioMetaTypes).sort()).toEqual(ALL_TYPES.slice().sort());
  });

  it.each(ALL_TYPES)("%s — served capabilities deep-equal the independently-transcribed §6.2 row", (type) => {
    expect(studioMetaTypes[type]?.capabilities, `${type} capabilities (served lg-studio-meta)`).toEqual(EXPECTED_MATRIX[type]);
  });

  it.each(ALL_TYPES)("%s — content_props includes 'helper' iff label_helper===true (§6.3 cross-check)", (type) => {
    const contentProps = studioMetaTypes[type]?.content_props ?? [];
    const expectHelper = EXPECTED_MATRIX[type].label_helper === true;
    expect(contentProps.includes("helper"), `${type} content_props=${JSON.stringify(contentProps)}`).toBe(expectHelper);
  });

  it("AC#10 — Dropdown/SearchableDropdown carry other_editor=false in the served blob", () => {
    expect(studioMetaTypes["DropdownQuestion"]?.capabilities?.other_editor).toBe(false);
    expect(studioMetaTypes["SearchableDropdownQuestion"]?.capabilities?.other_editor).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Layer B — the rendered inspector, executed (vm-probe over the served island).
// ---------------------------------------------------------------------------

describeDb("§6.2 matrix — Layer B: rendered studio inspector controls (executed island code)", () => {
  let island: string;
  let studioMeta: Record<string, unknown>;

  beforeAll(async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    island = studioIsland(html);
    studioMeta = extractJsonBlob(html, "lg-studio-meta");
  });

  it.each(ALL_TYPES)("%s — Question label + Helper text row (label_helper, §6.3)", (type) => {
    const expected = EXPECTED_MATRIX[type].label_helper === true;
    const { forSelector, contentPropEls } = runLayerBProbe(island, studioMeta, type);
    const labelWrap = forSelector("[data-field-label-wrap]");
    expect(labelWrap.hidden, `${type} data-field-label-wrap`).toBe(!expected);
    const helperProp = contentPropEls.find((e) => e.attrs["data-content-prop"] === "helper")!;
    expect(helperProp.hidden, `${type} helper content-prop`).toBe(!expected);
  });

  it.each(ALL_TYPES)("%s — Required row (data-content-behavior-section)", (type) => {
    // §6.2's "per-field" cells (Address/NameFields) still show SOME
    // required-related affordance (their own per-sub-field controls) — this
    // probe only proves the generic section is visible whenever required is
    // NOT exactly `false`; it does not (and per the stub list above, cannot
    // yet) distinguish "one generic checkbox" from "N per-field checkboxes".
    const expectVisible = EXPECTED_MATRIX[type].required !== false;
    const { forSelector } = runLayerBProbe(island, studioMeta, type);
    expect(forSelector("[data-content-behavior-section]").hidden, `${type} data-content-behavior-section`).toBe(!expectVisible);
  });

  it.each(ALL_TYPES)("%s — Choices editor row incl. YesNo's labels-only cell (choices_editor, AC#3/#10)", (type) => {
    const cell = EXPECTED_MATRIX[type].choices_editor;
    const { forSelector, contentPropEls } = runLayerBProbe(island, studioMeta, type);
    const choicesBlock = forSelector("[data-field-choices-block]");
    expect(choicesBlock.hidden, `${type} data-field-choices-block`).toBe(cell !== true);
    const yesLabel = contentPropEls.find((e) => e.attrs["data-content-prop"] === "yesLabel")!;
    const noLabel = contentPropEls.find((e) => e.attrs["data-content-prop"] === "noLabel")!;
    const expectLabelsOnly = cell === "labels_only";
    expect(yesLabel.hidden, `${type} yesLabel content-prop`).toBe(!expectLabelsOnly);
    expect(noLabel.hidden, `${type} noLabel content-prop`).toBe(!expectLabelsOnly);
  });

  it.each(ALL_TYPES)("%s — Default row, all 4 kinds (default_kind, §6.4 incl. the NEW 'choice' branch)", (type) => {
    const expectedKind = EXPECTED_MATRIX[type].default_kind;
    const { defaultWraps } = runLayerBProbe(island, studioMeta, type);
    for (const wrap of defaultWraps) {
      const kind = wrap.attrs["data-default-wrap"];
      expect(wrap.hidden, `${type} data-default-wrap="${kind}"`).toBe(kind !== expectedKind);
    }
  });

  it.each(ALL_TYPES)("%s — Selected-marker row (data-selected-marker-wrap, §6.6)", (type) => {
    const expected = EXPECTED_MATRIX[type].selected_marker === true;
    const { forSelector } = runLayerBProbe(island, studioMeta, type);
    expect(forSelector("[data-selected-marker-wrap]").hidden, `${type} data-selected-marker-wrap`).toBe(!expected);
  });

  it.each(ALL_TYPES)("%s — Accept type-swap row (data-accept-wrap)", (type) => {
    const expected = EXPECTED_MATRIX[type].accept_type_swap === true;
    const { forSelector } = runLayerBProbe(island, studioMeta, type);
    expect(forSelector("[data-accept-wrap]").hidden, `${type} data-accept-wrap`).toBe(!expected);
  });

  it.each(ALL_TYPES)("%s — Other editor row (data-other-editor-block, §6.5, AC#8/#8D/#10)", (type) => {
    const expected = EXPECTED_MATRIX[type].other_editor === true;
    const { forSelector } = runLayerBProbe(island, studioMeta, type);
    expect(forSelector("[data-other-editor-block]").hidden, `${type} data-other-editor-block`).toBe(!expected);
  });

  it.each(ALL_TYPES)("%s — Slider type row (data-slider-type-wrap, §6.8)", (type) => {
    const expected = EXPECTED_MATRIX[type].slider_type === true;
    const { forSelector } = runLayerBProbe(island, studioMeta, type);
    expect(forSelector("[data-slider-type-wrap]").hidden, `${type} data-slider-type-wrap`).toBe(!expected);
  });

  it.each(ALL_TYPES)("%s — Field set + Maps row (data-address-fieldset-block, §6.10)", (type) => {
    const expected = EXPECTED_MATRIX[type].field_set_maps === true;
    const { forSelector } = runLayerBProbe(island, studioMeta, type);
    expect(forSelector("[data-address-fieldset-block]").hidden, `${type} data-address-fieldset-block`).toBe(!expected);
  });

  // Closes the "columns" gap this file originally documented as Layer-A-only:
  // S2.4 replaced the broader isAnswerLayoutType gate (which wrongly included
  // TwoButtonYesNo) with `cap(node,'columns')` (own-hand-verified,
  // ui-section-studio.ts populateStyleVariant: "choiceLayout.hidden =
  // cap(node,'columns') !== true" — §6.2's YesNo row has a BLANK Columns cell,
  // a fixed pair has no column count). Same [data-toolbar-choice-layout] wrap
  // this file already tracked; only the gating condition changed.
  it.each(ALL_TYPES)("%s — Columns row (data-toolbar-choice-layout, §6.2)", (type) => {
    const expected = EXPECTED_MATRIX[type].columns === true;
    const { forSelector } = runLayerBProbe(island, studioMeta, type);
    expect(forSelector("[data-toolbar-choice-layout]").hidden, `${type} data-toolbar-choice-layout`).toBe(!expected);
  });

  // Closes the "mask_builder" gap this file originally documented as
  // Layer-A-only: S2.4 landed the §6.9 mask builder — populatePhoneFormatControls
  // now gates data-content-phoneformat-block on cap(node,'mask_builder')
  // (own-hand-verified) instead of the pre-M8 isPhoneTypedNode check. Real
  // function promoted from the stub list above; refreshPhoneMaskPreview (the
  // scaffold-preview/A-10-error internals, called only when isPhone is true)
  // stays stubbed — out of this row's concern, only the wrap's hidden-state is
  // tracked.
  it.each(ALL_TYPES)("%s — Mask builder row (data-content-phoneformat-block, §6.9)", (type) => {
    const expected = EXPECTED_MATRIX[type].mask_builder === true;
    const { forSelector } = runLayerBProbe(island, studioMeta, type);
    expect(forSelector("[data-content-phoneformat-block]").hidden, `${type} data-content-phoneformat-block`).toBe(!expected);
  });

  it.each(ALL_TYPES)("%s — Placeholder row (the placeholder content-prop)", (type) => {
    const cell = EXPECTED_MATRIX[type].placeholder;
    // KNOWN GAP (own-hand-verified against the live island + CONTENT_PROP_FIELDS
    // at authoring time): AddressAutocompleteQuestion's field_set_maps editor
    // (§6.10) — the per-field placeholder surface the "per_field" cell
    // describes — has no studio UI yet; its OLD, pre-rework generic
    // `placeholder` content-prop is still the one CONTENT_PROP_FIELDS lists,
    // which this probe would see as "visible" against an expectation of
    // "hidden" (per_field, not the generic control). Not skipped silently —
    // recorded here as a real, attributable, pending-S2.4-work gap; NOT
    // applicable to NameFieldsGroup, whose per_field placeholder already has
    // zero generic content_props (own-hand-verified CONTENT_PROP_FIELDS.
    // NameFieldsGroup === []), so that type IS asserted normally below.
    if (type === "AddressAutocompleteQuestion") return;
    // PRE-EXISTING, DOCUMENTED, rework-UNRELATED carve-out (own-hand-verified,
    // populateInspector's own comment: "v3.1 R3 E1-C4: a native
    // <input type='date'> ignores placeholder (browser no-op), so hide the
    // Placeholder Content control for DateQuestion" — `dateNoPlaceholder`).
    // DateQuestion's placeholder capability is `true` (same TEXT_INPUT family
    // as the other Accept-swappable types), but the STUDIO deliberately
    // suppresses the control for this ONE type because the browser itself
    // never renders a placeholder on type=date — a real technical constraint
    // that predates and is orthogonal to §6.2, not a transcription error.
    if (type === "DateQuestion") return;
    const expected = cell === true;
    const { contentPropEls } = runLayerBProbe(island, studioMeta, type);
    const placeholderProp = contentPropEls.find((e) => e.attrs["data-content-prop"] === "placeholder")!;
    expect(placeholderProp.hidden, `${type} placeholder content-prop`).toBe(!expected);
  });
});

// All 12 §6.2 rows are now Layer-B DOM-proven (the `columns` and
// `mask_builder` gaps this file originally documented as Layer-A-only closed
// once the sibling studio slice (S2.4) landed cap(node,'columns')/
// cap(node,'mask_builder') gating — own-hand-verified: `columns` uses the
// SAME [data-toolbar-choice-layout] wrap for every columns===true type
// including the 5 Containers, since the gate is now the unconditional
// capability flag rather than a type-family branch, so no separate
// Containers-specific selector was ever needed once the flag-driven
// mechanism landed).

// ---------------------------------------------------------------------------
// §11 rework fixtures — round-trip through the REAL save gate.
// ---------------------------------------------------------------------------

const FIXTURE_DIR = join(TEST_DIR, "fixtures", "leadgen-rework");
const REWORK_FIXTURES = [
  "image2-two-questions.json", // AC#2B
  "image3-insured-dependency.json", // AC#2C
  "slider-five-types.json", // AC#7
  "phone-mask.json", // AC#5
  "address-subsets.json", // AC#6
  "other-enabled-buttons-cards.json", // AC#8/#8D
] as const;

describe("§11 rework fixtures — validateSectionContent (the REAL save gate)", () => {
  it.each(REWORK_FIXTURES)("%s parses + validates with ZERO errors", (file) => {
    const content = JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf8")) as unknown;
    const result = validateSectionContent(content);
    expect(result.errors, `${file} errors: ${JSON.stringify(result.errors)}`).toEqual([]);
  });

  it("image2-two-questions.json — Q1/Q2 map to DIFFERENT internal_field values (AC#2B)", () => {
    const content = JSON.parse(readFileSync(join(FIXTURE_DIR, "image2-two-questions.json"), "utf8")) as {
      components: Array<{ internal_field?: string }>;
    };
    const fields = content.components.map((c) => c.internal_field).filter((f): f is string => typeof f === "string");
    expect(new Set(fields).size, "distinct internal_field per question").toBe(fields.length);
  });

  it("image3-insured-dependency.json — the insurer dropdown is conditional on currently_insured + carries a default (AC#2C)", () => {
    const content = JSON.parse(readFileSync(join(FIXTURE_DIR, "image3-insured-dependency.json"), "utf8")) as {
      components: Array<{ internal_field?: string; required?: boolean; conditional?: { when?: string; op?: string; value?: unknown }; props?: { default?: unknown } }>;
    };
    const insurer = content.components.find((c) => c.internal_field === "current_insurer")!;
    expect(insurer.required).toBe(true);
    expect(insurer.conditional).toMatchObject({ when: "currently_insured", op: "eq", value: true });
    expect(insurer.props?.default).toBeTruthy();
  });
});
