// LeadGen event enrichment — the server-resolved names, answer words and
// contact-data hashing every Athena `leadgen.events` / `leadgen.sessions` row
// carries (OWNER 2026-10-08: "we don't save the user answers per section,
// should be field 'section name' and a field with 'answer lable' … we also need
// to save the 'quote name' the 'template' …"; R3 "Hash them in Athena").
//
// Names are NEVER taken from the client: /lg/track resolves them from D1 by the
// ids the event already carries (quote_id / funnel_id / funnel_variant_id /
// section_id / question_id), through a small per-isolate cache (5 min TTL,
// bounded size). An unknown id leaves the name "" — never a guess, never a
// throw. Every lookup is FAIL-OPEN: a D1 error or a slow D1 can only leave a
// name empty; it never drops or blocks the event (enrichTrackEvents runs under
// a time budget and the contact-data hashing runs regardless).
//
// Answer words mirror the admin rules builder's rule (rule-fields.ts
// questionRuleFields: the question's own label, else the Question headline it
// is asked under, else its section's name — here the section's stored headline
// sits between the last two). The admin function lives in an admin UI module
// whose import graph (admin router / handlers / templates) must not be pulled
// into the public beacon + auction path, so the walk is mirrored here over the
// SAME shared primitives (answers.fieldsOf, presets.leadgenAddressAnswerFields,
// content-schema.flattenComponents).

import type { Env } from "../env";
import type { LeadgenEvent } from "./leadgen-events";
import { resolveSiteByHostname } from "../site/site-context";
import { fieldsOf } from "../leadgen/answers";
import { deriveFbc } from "../leadgen/s2s-dispatch";
import {
  LEADGEN_ADDRESS_FIELD_KINDS,
  flattenComponents,
  isChildrenBearingType,
  type LeadgenComponentNode,
} from "../public/leadgen/components/content-schema";
import {
  collectAnswerKeyClaims,
  foreignAnswerKeysIn,
  leadgenAddressAnswerFields,
} from "../public/leadgen/components/presets";
import {
  hashMetaUserData,
  hashMetaValue,
  metaKeyForFieldName,
  readFbcCookie,
  readFbpCookie,
  sha256Hex,
  sniffMetaContactKind,
  type MetaContactKind,
  type MetaUserData,
  type MetaUserDataKey,
} from "../leadgen/meta-hash";

// ---------------------------------------------------------------------------
// Per-isolate TTL cache (bounded; oldest-first eviction)
// ---------------------------------------------------------------------------

export const ENRICH_CACHE_TTL_MS = 5 * 60 * 1000;
export const ENRICH_CACHE_MAX_ENTRIES = 500;
// The longest /lg/track enrichment may take before the events go out with
// whatever resolved (names empty). Contact hashing is applied either way.
export const ENRICH_BUDGET_MS = 2000;

// A loader resolves `null` for "not found" (cached) and `undefined` for "could
// not tell" (a D1 error — NOT cached, so the next event retries).
class TtlCache<T> {
  private readonly entries = new Map<string, { exp: number; value: Promise<T | null | undefined> }>();

  async get(key: string, now: number, load: () => Promise<T | null | undefined>): Promise<T | null | undefined> {
    const hit = this.entries.get(key);
    if (hit !== undefined && hit.exp > now) return hit.value;
    if (hit !== undefined) this.entries.delete(key);
    const entry = { exp: now + ENRICH_CACHE_TTL_MS, value: load().catch(() => undefined) };
    this.entries.set(key, entry);
    while (this.entries.size > ENRICH_CACHE_MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    const value = await entry.value;
    if (value === undefined && this.entries.get(key) === entry) this.entries.delete(key);
    return value;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

interface QuoteFacts {
  quote_name: string;
}
interface FunnelFacts {
  funnel_name: string;
  frame_template_id: number | null;
  quote_public_id: string;
  quote_name: string;
}
interface VariantFacts {
  frame_template_id: number | null;
  funnel_public_id: string;
}
interface TemplateFacts {
  template_id: string;
  template_name: string;
}

const quoteCache = new TtlCache<QuoteFacts>();
const funnelCache = new TtlCache<FunnelFacts>();
const variantCache = new TtlCache<VariantFacts>();
const templateCache = new TtlCache<TemplateFacts>();
const siteCache = new TtlCache<string>();
const sectionCache = new TtlCache<SectionFacts>();
// Parsed section indexes keyed by `${section public id}@${content_version}` —
// a content edit bumps content_version, so a stale index is never reused.
const sectionIndexCache = new TtlCache<SectionFacts>();

// Test seam: every cache emptied (each test starts cold).
export function resetLeadgenEnrichCaches(): void {
  for (const c of [quoteCache, funnelCache, variantCache, templateCache, siteCache, sectionCache, sectionIndexCache]) {
    (c as TtlCache<unknown>).clear();
  }
}

// Test seam: the bounded size of one cache (proves the bound holds).
export function leadgenEnrichCacheSizes(): Record<string, number> {
  return {
    quote: quoteCache.size,
    funnel: funnelCache.size,
    variant: variantCache.size,
    template: templateCache.size,
    site: siteCache.size,
    section: sectionCache.size,
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function intOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ---------------------------------------------------------------------------
// D1 lookups (parameterized; each fail-open)
// ---------------------------------------------------------------------------

function loadQuote(db: D1Database, publicId: string, now: number): Promise<QuoteFacts | null | undefined> {
  return quoteCache.get(publicId, now, async () => {
    const row = await db
      .prepare("SELECT quote_name FROM leadgen_quotes WHERE public_id = ? LIMIT 1")
      .bind(publicId)
      .first<{ quote_name: string | null }>();
    return row === null ? null : { quote_name: str(row.quote_name) };
  });
}

function loadFunnel(db: D1Database, publicId: string, now: number): Promise<FunnelFacts | null | undefined> {
  return funnelCache.get(publicId, now, async () => {
    const row = await db
      .prepare(
        "SELECT f.funnel_name AS funnel_name, f.frame_template_id AS frame_template_id, q.public_id AS quote_public_id, q.quote_name AS quote_name FROM leadgen_funnels f LEFT JOIN leadgen_quotes q ON q.id = f.quote_id WHERE f.public_id = ? LIMIT 1",
      )
      .bind(publicId)
      .first<{ funnel_name: string | null; frame_template_id: number | null; quote_public_id: string | null; quote_name: string | null }>();
    if (row === null) return null;
    return {
      funnel_name: str(row.funnel_name),
      frame_template_id: intOrNull(row.frame_template_id),
      quote_public_id: str(row.quote_public_id),
      quote_name: str(row.quote_name),
    };
  });
}

function loadVariant(db: D1Database, publicId: string, now: number): Promise<VariantFacts | null | undefined> {
  return variantCache.get(publicId, now, async () => {
    const row = await db
      .prepare(
        "SELECT v.frame_template_id AS frame_template_id, f.public_id AS funnel_public_id FROM leadgen_funnel_variants v LEFT JOIN leadgen_funnels f ON f.id = v.funnel_id WHERE v.public_id = ? LIMIT 1",
      )
      .bind(publicId)
      .first<{ frame_template_id: number | null; funnel_public_id: string | null }>();
    if (row === null) return null;
    return { frame_template_id: intOrNull(row.frame_template_id), funnel_public_id: str(row.funnel_public_id) };
  });
}

function loadTemplateById(db: D1Database, id: number, now: number): Promise<TemplateFacts | null | undefined> {
  return templateCache.get(`id:${id}`, now, async () => {
    const row = await db
      .prepare("SELECT public_id, name FROM leadgen_frame_templates WHERE id = ? LIMIT 1")
      .bind(id)
      .first<{ public_id: string | null; name: string | null }>();
    return row === null ? null : { template_id: str(row.public_id), template_name: str(row.name) };
  });
}

// The quote's own default template (migration 0055) — the resolver's final
// fallback when neither the variant nor the funnel names a template.
function loadQuoteDefaultTemplate(db: D1Database, quotePublicId: string, now: number): Promise<TemplateFacts | null | undefined> {
  return templateCache.get(`quote:${quotePublicId}`, now, async () => {
    const row = await db
      .prepare(
        "SELECT ft.public_id AS public_id, ft.name AS name FROM leadgen_quote_default_template qdt JOIN leadgen_frame_templates ft ON ft.id = qdt.frame_template_id WHERE qdt.quote_public_id = ? LIMIT 1",
      )
      .bind(quotePublicId)
      .first<{ public_id: string | null; name: string | null }>();
    return row === null ? null : { template_id: str(row.public_id), template_name: str(row.name) };
  });
}

// host → site exactly as the public site middleware maps it
// (resolveSiteContextFromRequest → resolveSiteByHostname).
function loadSiteIdByHost(env: Env, hostname: string, now: number): Promise<string | null | undefined> {
  return siteCache.get(hostname, now, async () => {
    const site = await resolveSiteByHostname(env.DB, hostname, env);
    return site === null ? null : String(site.site_id);
  });
}

export interface LeadgenFunnelNames {
  quote_id: string; // the quote public id the names belong to
  quote_name: string;
  funnel_name: string;
  template_id: string;
  template_name: string;
}

// quote / funnel / template names for one (quote, funnel, variant) id triple.
// Template precedence = the resolver's (resolveSavedFrameTemplateDefaultsFor):
// variant.frame_template_id ?? funnel.frame_template_id ?? the quote's default.
// Never throws; unknown ids leave their names "".
export async function resolveLeadgenFunnelNames(
  db: D1Database,
  ids: { quote_id?: string; funnel_id?: string; funnel_variant_id?: string },
  now: number = Date.now(),
): Promise<LeadgenFunnelNames> {
  const out: LeadgenFunnelNames = { quote_id: "", quote_name: "", funnel_name: "", template_id: "", template_name: "" };
  try {
    const variantId = str(ids.funnel_variant_id);
    const variant = variantId !== "" ? await loadVariant(db, variantId, now) : null;
    const funnelId = str(ids.funnel_id) !== "" ? str(ids.funnel_id) : (variant?.funnel_public_id ?? "");
    const funnel = funnelId !== "" ? await loadFunnel(db, funnelId, now) : null;
    if (funnel !== null && funnel !== undefined) out.funnel_name = funnel.funnel_name;

    const quoteId = str(ids.quote_id) !== "" ? str(ids.quote_id) : (funnel?.quote_public_id ?? "");
    out.quote_id = quoteId;
    if (str(ids.quote_id) !== "") {
      const quote = await loadQuote(db, quoteId, now);
      if (quote !== null && quote !== undefined) out.quote_name = quote.quote_name;
    } else if (funnel !== null && funnel !== undefined) {
      out.quote_name = funnel.quote_name;
    }

    const ftid = variant?.frame_template_id ?? funnel?.frame_template_id ?? null;
    let template: TemplateFacts | null | undefined = null;
    if (ftid !== null) template = await loadTemplateById(db, ftid, now);
    else if (quoteId !== "") template = await loadQuoteDefaultTemplate(db, quoteId, now);
    if (template !== null && template !== undefined) {
      out.template_id = template.template_id;
      out.template_name = template.template_name;
    }
  } catch {
    // fail-open: whatever resolved stays, the rest is ""
  }
  return out;
}

// ---------------------------------------------------------------------------
// Section content → per-field facts (labels, choices, contact kind)
// ---------------------------------------------------------------------------

export interface FieldFacts {
  field: string; // the answer key (question_key)
  question_id: string;
  question_label: string;
  choices: ReadonlyMap<string, string>; // String(stored value) → the words shown
  contact: MetaContactKind | null;
  // true ⇒ the answer is personal contact data: stored hashed, never plain.
  hashed: boolean;
  component_type: string;
  dob_hint: boolean; // a DateQuestion whose key/label says date of birth
}

export interface SectionFacts {
  section_name: string;
  by_question: ReadonlyMap<string, readonly FieldFacts[]>;
  by_field: ReadonlyMap<string, FieldFacts>;
}

// The contact kinds stored HASHED in Athena (R3). ZIP / city / state stay plain.
const HASHED_KINDS: ReadonlySet<MetaContactKind> = new Set<MetaContactKind>(["em", "ph", "fn", "ln", "db", "street", "text"]);

const ROLE_WORDS: Readonly<Record<string, string>> = {
  street: "Street",
  city: "City",
  state: "State",
  zip: "ZIP",
  first: "First",
  last: "Last",
  min: "Min",
  max: "Max",
};

const CELL_LAYOUTS: ReadonlySet<string> = new Set(["Columns", "GridContainer"]);

function trimmed(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

// The Question headline each leaf is asked under (the admin rules builder's
// headlinesOfLeaves scoping: a headline names the questions after it in its
// own container; Columns / GridContainer cells are separate scopes). A
// headline bound to the section headline reads the section's stored headline.
function headlinesOfLeaves(nodes: readonly LeadgenComponentNode[], sectionHeadline: string): Map<LeadgenComponentNode, string> {
  const out = new Map<LeadgenComponentNode, string>();
  const walk = (level: readonly LeadgenComponentNode[], inherited: string): void => {
    let current = inherited;
    for (const node of level) {
      if (node === null || typeof node !== "object") continue;
      const type = (node as { type?: unknown }).type;
      if (type === "QuestionHeadline") {
        const text = trimmed(node.props?.["text"]);
        if (text !== "") current = text;
        else if ((node as { bind?: unknown }).bind === "section_headline" && sectionHeadline !== "") current = sectionHeadline;
      } else if (isChildrenBearingType(type)) {
        const children = (node as { children?: unknown }).children;
        if (!Array.isArray(children)) continue;
        if (typeof type === "string" && CELL_LAYOUTS.has(type)) {
          for (const cell of children as LeadgenComponentNode[]) walk([cell], current);
        } else {
          walk(children as LeadgenComponentNode[], current);
        }
      } else {
        out.set(node, current);
      }
    }
  };
  walk(nodes, "");
  return out;
}

function namePartsOf(node: LeadgenComponentNode): [string, string] {
  const raw = node.props?.["fields"];
  const parts = Array.isArray(raw) ? raw : [];
  const first = typeof parts[0] === "string" && parts[0].trim() !== "" ? parts[0].trim() : "first";
  const last = typeof parts[1] === "string" && parts[1].trim() !== "" ? parts[1].trim() : "last";
  return [first, last];
}

// The address keys ONE role's box can carry (the renderer's own resolution,
// probed one role at a time — with the section context and without it, which
// also covers the `{base}_{role}` hedge normalizeAnswers accepts).
function addressRoleKeys(node: LeadgenComponentNode, kind: string, foreign: ReadonlySet<string>): string[] {
  const probe = { ...node, props: { ...(node.props ?? {}), fields: [{ field: kind }] } } as LeadgenComponentNode;
  return [...leadgenAddressAnswerFields(probe, foreign), ...leadgenAddressAnswerFields(probe)];
}

// Which role of its owning question an answer key is (null: none / unknown).
function roleOf(node: LeadgenComponentNode, own: string, field: string, foreign: ReadonlySet<string>): string | null {
  if (node.type === "AddressAutocompleteQuestion") {
    let role: string | null = null;
    for (const kind of LEADGEN_ADDRESS_FIELD_KINDS) {
      if (kind === "full_address") continue;
      if (addressRoleKeys(node, kind, foreign).includes(field)) role = kind;
    }
    if (role !== null) return role;
    return addressRoleKeys(node, "full_address", foreign).includes(field) ? "full_address" : null;
  }
  if (node.type === "NameFieldsGroup") {
    const [first, last] = namePartsOf(node);
    if (field === first) return "first";
    if (field === last) return "last";
    return null;
  }
  if (node.type === "NumberRangeQuestion" && own !== "") {
    if (field === `${own}_min`) return "min";
    if (field === `${own}_max`) return "max";
  }
  return null;
}

// The contact kind of one answer key (R3 + the Meta user_data keys).
function contactKindOf(node: LeadgenComponentNode, role: string | null, key: string): MetaContactKind | null {
  switch (node.type) {
    case "EmailInputQuestion":
      return "em";
    case "PhoneInputQuestion":
      return "ph";
    case "NameFieldsGroup":
      return role === "last" ? "ln" : "fn";
    case "DateQuestion":
      // Every date answer is treated as a possible date of birth (owner: "treat
      // every DateQuestion answer as hashed if you cannot tell").
      return "db";
    case "AddressAutocompleteQuestion":
      if (role === "city") return "ct";
      if (role === "state") return "st";
      if (role === "zip") return "zp";
      return "street"; // street line, the whole-address composite, or unknown ⇒ hashed
    case "ZIPInputQuestion":
      return "zp";
    case "FreeTextQuestion":
      // Fix round 1 (review M1): the operator's "Personal data — store hashed"
      // switch (props.pii, the section editor), else a field NAME that says
      // what it holds ("email", "phone_number", "first_name" … — the ONE list
      // in meta-hash.ts the browser map and the auction use too).
      if (node.props?.["pii"] === true) return "text";
      return metaKeyForFieldName(key);
    default:
      return null;
  }
}

// Every answer key this node can record (union of the canonical derivation,
// the address hedge and the name parts — the client posts whichever renders).
function answerKeysOf(node: LeadgenComponentNode, foreign: ReadonlySet<string>): string[] {
  const keys: string[] = [];
  const add = (k: string): void => {
    if (k !== "" && !keys.includes(k)) keys.push(k);
  };
  for (const spec of fieldsOf(node, foreign)) add(spec.field);
  for (const spec of fieldsOf(node)) add(spec.field);
  if (node.type === "AddressAutocompleteQuestion") {
    for (const k of leadgenAddressAnswerFields(node, foreign)) add(k);
    for (const k of leadgenAddressAnswerFields(node)) add(k);
  }
  if (node.type === "NameFieldsGroup") {
    for (const k of namePartsOf(node)) add(k);
  }
  return keys;
}

// String(stored value) → the words the visitor saw: the authored choices (+ an
// "Other" group's choices); a Yes / No question's two answer labels.
function choiceWordsOf(node: LeadgenComponentNode): Map<string, string> {
  const out = new Map<string, string>();
  if (node.type === "TwoButtonYesNo") {
    const yes = trimmed(node.props?.["yesLabel"]);
    const no = trimmed(node.props?.["noLabel"]);
    out.set("true", yes !== "" ? yes : "Yes");
    out.set("false", no !== "" ? no : "No");
  }
  const lists: unknown[] = [node.choices];
  const other = node.props?.["other"];
  if (other !== null && typeof other === "object") lists.push((other as { choices?: unknown }).choices);
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const c of list) {
      if (c === null || typeof c !== "object") continue;
      const v = (c as { value?: unknown }).value;
      if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
      const label = trimmed((c as { label?: unknown }).label);
      if (label === "" || out.has(String(v))) continue;
      out.set(String(v), label);
    }
  }
  return out;
}

const DOB_WORDS = /birth|dob|born/i;

// Build one section's field index from its stored content (pure).
export function buildSectionFacts(row: {
  section_name: string;
  headline_text: string;
  content_json: string | null;
}): SectionFacts {
  let components: LeadgenComponentNode[] = [];
  try {
    const parsed = JSON.parse(row.content_json ?? "") as unknown;
    const list = parsed !== null && typeof parsed === "object" ? (parsed as { components?: unknown }).components : undefined;
    if (Array.isArray(list)) components = list as LeadgenComponentNode[];
  } catch {
    components = [];
  }
  const sectionName = row.section_name.trim();
  const sectionHeadline = row.headline_text.trim();
  const claims = collectAnswerKeyClaims(components);
  const headlines = headlinesOfLeaves(components, sectionHeadline);
  const byQuestion = new Map<string, FieldFacts[]>();
  const byField = new Map<string, FieldFacts>();
  for (const leaf of flattenComponents(components)) {
    if (leaf === null || typeof leaf !== "object") continue;
    if (leaf.type === "ValidationError") continue;
    const foreign = foreignAnswerKeysIn(claims, leaf);
    const keys = answerKeysOf(leaf, foreign);
    if (keys.length === 0) continue;
    const own = typeof leaf.internal_field === "string" ? leaf.internal_field : "";
    const ownLabel = trimmed(leaf.props?.["label"]);
    const asked = headlines.get(leaf) ?? "";
    const base = ownLabel !== "" ? ownLabel : asked !== "" ? asked : sectionHeadline !== "" ? sectionHeadline : sectionName;
    const choices = choiceWordsOf(leaf);
    const questionId = typeof leaf.question_id === "string" ? leaf.question_id : "";
    const dobHint = DOB_WORDS.test(own) || DOB_WORDS.test(ownLabel);
    for (const key of keys) {
      const role = roleOf(leaf, own, key, foreign);
      const contact = contactKindOf(leaf, role, key);
      const word = role !== null ? ROLE_WORDS[role] : undefined;
      const facts: FieldFacts = {
        field: key,
        question_id: questionId,
        question_label: key !== own && word !== undefined ? `${base} — ${word}` : base,
        choices,
        contact,
        hashed: contact !== null && HASHED_KINDS.has(contact),
        component_type: typeof leaf.type === "string" ? leaf.type : "",
        dob_hint: dobHint,
      };
      if (!byField.has(key)) byField.set(key, facts);
      if (questionId !== "") {
        const list = byQuestion.get(questionId) ?? [];
        list.push(facts);
        byQuestion.set(questionId, list);
      }
    }
  }
  return { section_name: sectionName, by_question: byQuestion, by_field: byField };
}

function loadSection(db: D1Database, publicId: string, now: number): Promise<SectionFacts | null | undefined> {
  return sectionCache.get(publicId, now, async () => {
    const row = await db
      .prepare("SELECT section_name, headline_text, content_version, content_json FROM leadgen_sections WHERE public_id = ? LIMIT 1")
      .bind(publicId)
      .first<{ section_name: string | null; headline_text: string | null; content_version: number | null; content_json: string | null }>();
    if (row === null) return null;
    const version = intOrNull(row.content_version) ?? 0;
    return sectionIndexCache.get(`${publicId}@${version}`, now, async () =>
      buildSectionFacts({
        section_name: str(row.section_name),
        headline_text: str(row.headline_text),
        content_json: row.content_json,
      }),
    );
  });
}

// ---------------------------------------------------------------------------
// Answer words + contact hashing for one event
// ---------------------------------------------------------------------------

const ANSWER_EVENT_TYPES: ReadonlySet<string> = new Set(["answer_click", "answer_change", "answer_default_applied"]);

// The words of the answer the visitor saw: the choice label (a multi-select's
// labels joined ", "), else the value itself (typed text / a number).
export function answerWordsFor(choices: ReadonlyMap<string, string>, value: string): string {
  if (value === "") return "";
  const direct = choices.get(value);
  if (direct !== undefined) return direct;
  if (choices.size > 0 && value.includes(",")) {
    const parts = value.split(",").map((p) => p.trim()).filter((p) => p !== "");
    return parts.map((p) => choices.get(p) ?? p).join(", ");
  }
  return value;
}

// True when the stored value is one of the field's own authored choices (a
// multi-select's "a,b" when every part is one) — a picked choice, not typing.
function isChoiceValue(choices: ReadonlyMap<string, string>, value: string): boolean {
  if (choices.size === 0 || value === "") return false;
  if (choices.has(value)) return true;
  const parts = value.split(",").map((p) => p.trim()).filter((p) => p !== "");
  return parts.length > 1 && parts.every((p) => choices.has(p));
}

async function hashAnswer(e: LeadgenEvent, kind: MetaContactKind): Promise<void> {
  const raw = e.answer_value_normalized;
  let hashed = raw === "" ? "" : await hashMetaValue(kind, raw);
  // A non-empty value the Meta rule cannot normalise (e.g. an unparseable
  // date) is still hashed — trimmed + lowercased — never kept plain.
  if (hashed === "" && raw.trim() !== "") hashed = await sha256Hex(raw.trim().toLowerCase());
  e.answer_value_normalized = hashed;
  e.answer_value_raw = "";
  e.answer_label = "";
  e.answer_hashed = true;
}

function pickField(section: SectionFacts | null, questionId: string, internalField: string): FieldFacts | null {
  if (section === null) return null;
  const candidates = questionId !== "" ? section.by_question.get(questionId) ?? [] : [];
  if (candidates.length > 0) {
    return candidates.find((f) => f.field === internalField) ?? candidates[0] ?? null;
  }
  if (internalField !== "") return section.by_field.get(internalField) ?? null;
  return null;
}

// ---------------------------------------------------------------------------
// /lg/track enrichment
// ---------------------------------------------------------------------------

export interface TrackEnrichItem {
  event: LeadgenEvent;
  // The client's `internal_field` hint — used ONLY to pick among the
  // server-known answer keys of the resolved question, never stored as-is.
  internal_field: string;
}

export interface TrackRequestFacts {
  hostname: string;
  cookieHeader: string | null;
  now: number;
}

interface TrackLookups {
  names: Map<string, LeadgenFunnelNames>;
  sections: Map<string, SectionFacts | null>;
  siteId: string;
}

function namesKey(e: LeadgenEvent): string {
  return `${e.quote_id}\u0000${e.funnel_id}\u0000${e.funnel_variant_id}`;
}

async function resolveTrackLookups(env: Env, items: readonly TrackEnrichItem[], req: TrackRequestFacts): Promise<TrackLookups> {
  const db = env.DB;
  const names = new Map<string, LeadgenFunnelNames>();
  const sections = new Map<string, SectionFacts | null>();
  let siteId = "";
  const work: Promise<unknown>[] = [];
  const nameKeys = new Set<string>();
  const sectionIds = new Set<string>();
  let needSite = false;
  for (const { event: e } of items) {
    if (e.quote_id !== "" || e.funnel_id !== "" || e.funnel_variant_id !== "") nameKeys.add(namesKey(e));
    if (e.section_id !== "") sectionIds.add(e.section_id);
    if (e.site_id === "") needSite = true;
  }
  for (const key of nameKeys) {
    const [quote_id, funnel_id, funnel_variant_id] = key.split("\u0000");
    work.push(
      resolveLeadgenFunnelNames(db, { quote_id, funnel_id, funnel_variant_id }, req.now).then((n) => {
        names.set(key, n);
      }),
    );
  }
  for (const id of sectionIds) {
    work.push(
      loadSection(db, id, req.now).then(
        (s) => {
          sections.set(id, s ?? null);
        },
        () => {
          sections.set(id, null);
        },
      ),
    );
  }
  if (needSite && req.hostname !== "") {
    work.push(
      loadSiteIdByHost(env, req.hostname, req.now).then(
        (s) => {
          siteId = s ?? "";
        },
        () => undefined,
      ),
    );
  }
  await Promise.all(work);
  return { names, sections, siteId };
}

function withBudget<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([p.catch(() => null), timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

// Enrich /lg/track events IN PLACE. Never throws.
//   1. names the client claimed are cleared (server-owned) and the Meta
//      browser ids are stamped: fbp from the _fbp cookie; fbc (when the event
//      has none) from the _fbc cookie, else derived from fbclid exactly as the
//      runtime context derives it;
//   2. D1 lookups (cached) under ENRICH_BUDGET_MS: quote/funnel/template
//      names, site_id from the Host when empty, section name + the question's
//      key/label + the answer's words;
//   3. contact answers are hashed (R3) — ALWAYS, even when step 2 failed.
//      Fix round 1 (review M1/M2), narrowed by fix round 2 (review N2): every
//      TYPED answer value (answer_change, not one of the field's own choices)
//      not already hashed is sniffed (meta-hash.ts sniffMetaContactKind —
//      capped to 254 chars, linear patterns): one that LOOKS like an email /
//      phone number is hashed whatever question it answered — choice clicks
//      and picked choice values are never sniffed; and a typed answer whose
//      section / question cannot be resolved (unknown or empty section_id, a
//      question the section no longer holds, D1 over its time budget) is
//      hashed too — fail closed: never plain, answer_label "".
export async function enrichTrackEvents(
  env: Env,
  items: readonly TrackEnrichItem[],
  req: TrackRequestFacts,
  opts: { budgetMs?: number } = {},
): Promise<void> {
  if (items.length === 0) return;
  const fbp = readFbpCookie(req.cookieHeader);
  const fbcCookie = readFbcCookie(req.cookieHeader);
  for (const { event: e } of items) {
    e.quote_name = "";
    e.funnel_name = "";
    e.section_name = "";
    e.question_key = "";
    e.question_label = "";
    e.answer_label = "";
    e.answer_hashed = false;
    e.template_id = "";
    e.template_name = "";
    e.bids_count = null;
    e.fbp = fbp;
    if (e.fbc === "") e.fbc = fbcCookie !== "" ? fbcCookie : deriveFbc(e.fbclid, "", req.now);
  }

  let lookups: TrackLookups | null = null;
  try {
    lookups = await withBudget(resolveTrackLookups(env, items, req), opts.budgetMs ?? ENRICH_BUDGET_MS);
  } catch {
    lookups = null;
  }

  for (const { event: e, internal_field } of items) {
    try {
      if (lookups !== null) {
        if (e.site_id === "" && lookups.siteId !== "") e.site_id = lookups.siteId;
        const n = lookups.names.get(namesKey(e));
        if (n !== undefined) {
          e.quote_name = n.quote_name;
          e.funnel_name = n.funnel_name;
          e.template_id = n.template_id;
          e.template_name = n.template_name;
        }
      }
      const section = e.section_id !== "" ? lookups?.sections.get(e.section_id) ?? null : null;
      if (section !== null) e.section_name = section.section_name;
      const field = pickField(section, e.question_id, internal_field);
      if (field !== null) {
        e.question_key = field.field;
        e.question_label = field.question_label;
      }
      if (!ANSWER_EVENT_TYPES.has(e.event_type)) continue;
      if (field !== null && field.hashed && field.contact !== null) {
        await hashAnswer(e, field.contact);
        continue;
      }
      // Fix round 2 (review N2): the sniff and the fail-closed hash apply to
      // TYPED answers only — an answer_change whose value is not one of the
      // answered field's own choices. A choice click (answer_click), a default
      // (answer_default_applied) or a picked choice value is never sniffed: an
      // income band "50000-100000" is a choice, not a phone number.
      const typed = e.event_type === "answer_change" && !(field !== null && isChoiceValue(field.choices, e.answer_value_normalized));
      if (typed) {
        // M1: a contact-looking typed value is hashed whatever question it answered.
        const sniffed = sniffMetaContactKind(e.answer_value_normalized);
        if (sniffed !== null) {
          await hashAnswer(e, sniffed);
          continue;
        }
        // M2: fail closed — a typed answer we cannot place is never kept plain.
        if (field === null) {
          await hashAnswer(e, "text");
          continue;
        }
      }
      if (field !== null) e.answer_label = answerWordsFor(field.choices, e.answer_value_normalized);
    } catch {
      // one event's enrichment never affects another, nor the batch
    }
  }
}

// ---------------------------------------------------------------------------
// Auction-time Meta user_data (persisted hashed in the auction's macro snapshot)
// ---------------------------------------------------------------------------

function answerText(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

// The visitor's Meta user_data, HASHED (each value = lowercase hex SHA-256 of
// the Meta-normalised answer; absent keys omitted; `country` "us" only when at
// least one answer-derived key exists). Inputs are the server-normalized
// answers of the sections the visitor passed through + (fallback for ct/st/zp)
// the ZIP-derived location facet. Never throws (returns {} on any failure).
export async function buildAuctionMetaUserData(
  sections: ReadonlyArray<{ section_name?: string | null; headline_text?: string | null; content_json: string | null }>,
  answers: Readonly<Record<string, unknown>>,
  facet?: Readonly<Record<string, unknown>>,
): Promise<MetaUserData> {
  try {
    const plain: Partial<Record<MetaUserDataKey, string>> = {};
    const take = (key: MetaUserDataKey, value: unknown): void => {
      const text = answerText(value);
      if (text !== "" && plain[key] === undefined) plain[key] = text;
    };
    for (const s of sections) {
      const facts = buildSectionFacts({
        section_name: str(s.section_name),
        headline_text: str(s.headline_text),
        content_json: s.content_json,
      });
      for (const f of facts.by_field.values()) {
        if (f.contact === null || f.contact === "street" || f.contact === "text") continue;
        if (f.contact === "db" && !f.dob_hint) continue; // a date that is not a birth date
        take(f.contact, answers[f.field]);
      }
    }
    // Conventional answer keys, read when no typed component claimed the Meta
    // key — by the ONE name list (meta-hash.ts META_CONTACT_FIELD_PATTERNS).
    for (const [field, value] of Object.entries(answers)) {
      const key = metaKeyForFieldName(field);
      if (key !== null) take(key, value);
    }
    if (facet !== undefined) {
      take("zp", facet["zip"]);
      take("st", facet["state"]);
      take("ct", facet["city"]);
    }
    const hashed = await hashMetaUserData(plain);
    if (Object.keys(hashed).length === 0) return {};
    return { ...hashed, ...(await hashMetaUserData({ country: "us" })) };
  } catch {
    return {};
  }
}
