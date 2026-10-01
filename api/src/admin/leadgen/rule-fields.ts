// LeadGen admin — the field list the rules condition builders offer.
//
// OWNER 2026-10-01 (product manager feedback on Auction → Rules):
//   * "The custom fields aren't mapped only to the answers of the relevant
//     vertical, instead it shows a mix of different verticals" — the Funnel
//     eligibility pop-up listed every active section of the activity. Here a
//     variant's fields are exactly the questions its funnel can ask: its own
//     sections (page-slot candidates included) plus the quote's shared first
//     page. An auction's fields are those of every variant that uses it.
//   * "Remove the section's ID from the dropdown" — labels are the question's
//     own words (the section name when the question has none), never a key.
//   * "Answer from the funnel question" — each choice carries the value a rule
//     must store to match it (stored_choices, normalized like the auction does).
//   * "Support other conditions such as (Date, State, Time of day, OS, UTM
//     Source, FB Placement)" — VISITOR_RULE_FIELDS, the facts runAuction puts in
//     every rule's context (engine.ts visitorFacts). Clock: US Eastern.

import type { AdminContext } from "./offers-handlers";
import { ruleFieldEntriesOfContent } from "./ui-quotes";
import { LEADGEN_COMPONENT_OPERATOR_NAMES } from "../../public/leadgen/components/content-schema";

export interface RuleBuilderChoice {
  value: string;
  label: string;
}

export interface RuleBuilderField {
  internal_field: string;
  label: string;
  group: "question" | "visitor";
  // value → label, for reading a stored rule back as words
  choices?: RuleBuilderChoice[];
  // label → the exact value a rule stores (typed), for the answers dropdown
  stored_choices?: Array<{ label: string; stored: string | number | boolean }>;
  hint?: string;
  // PM follow-up: a calendar / clock picker instead of a typed number. The
  // stored value stays a number — date YYYYMMDD (20261031), time HHMM (930).
  input?: "date" | "time";
}

const listed = (pairs: ReadonlyArray<readonly [string, string]>) => ({
  choices: pairs.map(([value, label]) => ({ value, label })),
  stored_choices: pairs.map(([value, label]) => ({ label, stored: value })),
});

// Measured 2026-10-01 in production auction logs: the FB placement arrives as
// the `placement` landing parameter with these values.
const FB_PLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ["Facebook_Mobile_Feed", "Facebook mobile feed"],
  ["Facebook_Mobile_Reels", "Facebook mobile reels"],
  ["Facebook_Desktop_Feed", "Facebook desktop feed"],
  ["Facebook_Stories", "Facebook stories"],
  ["Instagram_Reels", "Instagram reels"],
  ["Threads_Feed", "Threads feed"],
];

export const VISITOR_RULE_FIELDS: readonly RuleBuilderField[] = [
  { internal_field: "state", label: "State", group: "visitor", hint: "two-letter code, e.g. CA" },
  { internal_field: "device", label: "Device", group: "visitor", ...listed([["mobile", "Mobile"], ["tablet", "Tablet"], ["desktop", "Desktop"]]) },
  {
    internal_field: "os",
    label: "OS",
    group: "visitor",
    ...listed([["ios", "iOS"], ["android", "Android"], ["windows", "Windows"], ["macos", "macOS"], ["linux", "Linux"], ["other", "Other"]]),
  },
  { internal_field: "utm_source", label: "UTM Source", group: "visitor" },
  { internal_field: "utm_medium", label: "UTM Medium", group: "visitor" },
  { internal_field: "utm_campaign", label: "UTM Campaign", group: "visitor" },
  { internal_field: "utm_content", label: "UTM Content", group: "visitor" },
  { internal_field: "placement", label: "FB Placement", group: "visitor", ...listed(FB_PLACEMENTS) },
  { internal_field: "date_et", label: "Date (US Eastern)", group: "visitor", input: "date" },
  // hour_et stays in every rule's context (engine.ts) for rules saved before
  // time_et; new rules pick the minute-level time.
  { internal_field: "time_et", label: "Time of day (US Eastern)", group: "visitor", input: "time" },
  {
    internal_field: "weekday_et",
    label: "Day of week (US Eastern)",
    group: "visitor",
    ...listed([
      ["monday", "Monday"], ["tuesday", "Tuesday"], ["wednesday", "Wednesday"], ["thursday", "Thursday"],
      ["friday", "Friday"], ["saturday", "Saturday"], ["sunday", "Sunday"],
    ]),
  },
];

interface SectionRow {
  id: number;
  section_name: string;
  content_json: string | null;
}

function parseContent(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

// The question fields of these sections, in order, one per answer key, with
// operator words for labels: the question's label, else the Question headline
// it is asked under, else its section's name. Words two fields share get their
// section's name (different sections) or their question type (one section:
// "… (Yes / No)" vs "… (Buttons)"), then a number.
export function questionRuleFields(sections: readonly SectionRow[]): RuleBuilderField[] {
  const seen = new Set<string>();
  const raw: Array<{ entry: ReturnType<typeof ruleFieldEntriesOfContent>[number]; section: string }> = [];
  for (const section of sections) {
    for (const entry of ruleFieldEntriesOfContent(parseContent(section.content_json))) {
      if (seen.has(entry.internal_field)) continue;
      seen.add(entry.internal_field);
      raw.push({ entry, section: section.section_name });
    }
  }
  const baseOf = (r: (typeof raw)[number]): string => {
    const own = typeof r.entry.label === "string" ? r.entry.label.trim() : "";
    if (own !== "") return own;
    const asked = typeof r.entry.headline === "string" ? r.entry.headline.trim() : "";
    return asked !== "" ? asked : r.section;
  };
  const typeOf = (r: (typeof raw)[number]): string => {
    const t = r.entry.component_type ?? "";
    return (LEADGEN_COMPONENT_OPERATOR_NAMES as Readonly<Record<string, string>>)[t] ?? t;
  };
  const byBase = new Map<string, Array<(typeof raw)[number]>>();
  for (const r of raw) byBase.set(baseOf(r), [...(byBase.get(baseOf(r)) ?? []), r]);
  const used = new Map<string, number>();
  return raw.map((r) => {
    const base = baseOf(r);
    const twins = byBase.get(base) ?? [];
    let label = base;
    if (twins.length > 1) {
      const sectionsDiffer = new Set(twins.map((t) => t.section)).size > 1;
      const typesDiffer = new Set(twins.map(typeOf)).size > 1;
      if (sectionsDiffer && base !== r.section) label = `${base} (${r.section})`;
      else if (typesDiffer && typeOf(r) !== "") label = `${base} (${typeOf(r)})`;
    }
    const n = (used.get(label) ?? 0) + 1;
    used.set(label, n);
    if (n > 1) label = `${label} (${n})`;
    const stored = r.entry.stored_choices ?? [];
    // a Yes / No question has no choices array: its readback words are its
    // own answer labels ("I own" for true)
    const choices = r.entry.choices.length > 0 ? r.entry.choices : stored.filter((c) => typeof c.stored === "boolean").map((c) => ({ value: String(c.stored), label: c.label }));
    return {
      internal_field: r.entry.internal_field,
      label,
      group: "question" as const,
      ...(choices.length > 0 ? { choices } : {}),
      ...(stored.length > 0 ? { stored_choices: stored } : {}),
    };
  });
}

// The sections a variant's funnel can show: its own (every page and slot
// candidate) and the quote's shared first page (0047 quote-owned rows).
async function sectionsForVariants(db: D1Database, variantIds: readonly number[]): Promise<SectionRow[]> {
  const out: SectionRow[] = [];
  const seen = new Set<number>();
  for (const variantId of variantIds) {
    const rows = await db
      .prepare(
        `SELECT s.id AS id, s.section_name AS section_name, s.content_json AS content_json
         FROM leadgen_funnel_variant_sections fvs
         JOIN leadgen_sections s ON s.id = fvs.section_id
         WHERE fvs.variant_id = ?
            OR fvs.quote_id = (SELECT f.quote_id FROM leadgen_funnel_variants v JOIN leadgen_funnels f ON f.id = v.funnel_id WHERE v.id = ?)
         ORDER BY (fvs.quote_id IS NULL) ASC, fvs.position ASC, fvs.id ASC`,
      )
      .bind(variantId, variantId)
      .all<SectionRow>();
    for (const r of rows.results ?? []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
  }
  return out;
}

// A route param → row id (numeric id or public id). Fixed SQL per table.
const ID_SQL = {
  variant: {
    byId: "SELECT id FROM leadgen_funnel_variants WHERE id = ? LIMIT 1",
    byPublic: "SELECT id FROM leadgen_funnel_variants WHERE public_id = ? LIMIT 1",
  },
  auction: {
    byId: "SELECT id FROM leadgen_auctions WHERE id = ? LIMIT 1",
    byPublic: "SELECT id FROM leadgen_auctions WHERE public_id = ? LIMIT 1",
  },
} as const;

async function resolveId(db: D1Database, kind: keyof typeof ID_SQL, param: string): Promise<number | null> {
  const p = param.trim();
  const numeric = /^\d+$/.test(p);
  const row = await db
    .prepare(numeric ? ID_SQL[kind].byId : ID_SQL[kind].byPublic)
    .bind(numeric ? Number(p) : p)
    .first<{ id: number }>();
  return row?.id ?? null;
}

// The questions, then the visitor facts — minus a fact whose key a question
// already answers (an answered `state` IS the rule's state: the engine lets
// the declared answer win), so the dropdown never lists the same key twice.
function withVisitorFacts(questions: RuleBuilderField[]): RuleBuilderField[] {
  const asked = new Set(questions.map((q) => q.internal_field));
  return [...questions, ...VISITOR_RULE_FIELDS.filter((f) => !asked.has(f.internal_field))];
}

// GET /variants/:id/rule-fields — the Funnel eligibility pop-up's fields.
export async function variantRuleFieldsHandler(c: AdminContext): Promise<Response> {
  const variantId = await resolveId(c.env.DB, "variant", c.req.param("id") ?? "");
  if (variantId === null) return c.json({ error: "Not Found" }, 404);
  const questions = questionRuleFields(await sectionsForVariants(c.env.DB, [variantId]));
  return c.json({ fields: withVisitorFacts(questions) });
}

// GET /auctions/:id/rule-fields — the auction "Add a rule" form's fields: the
// questions of every funnel variant that runs this auction.
export async function auctionRuleFieldsHandler(c: AdminContext): Promise<Response> {
  const auctionId = await resolveId(c.env.DB, "auction", c.req.param("id") ?? "");
  if (auctionId === null) return c.json({ error: "Not Found" }, 404);
  const variants = await c.env.DB.prepare("SELECT id FROM leadgen_funnel_variants WHERE auction_id = ? ORDER BY id ASC")
    .bind(auctionId)
    .all<{ id: number }>();
  const questions = questionRuleFields(await sectionsForVariants(c.env.DB, (variants.results ?? []).map((v: { id: number }) => v.id)));
  return c.json({ fields: withVisitorFacts(questions) });
}
