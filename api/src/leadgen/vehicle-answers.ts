// F18 Vehicle database — the server side of a visitor's vehicle answers.
//
// Two jobs, both on the money path and both FAIL-OPEN (a vehicle file that
// can't be read never costs a lead):
//
//   1. checkVehicleRawAnswers — before an Auction (serve-auction.ts), drop an
//      answer that claims a database id the visitor's snapshot doesn't have
//      for that make (and year). Same "drop discipline" as the Maps ZIP check:
//      an invalid answer is omitted, never a new rejection. Typed text (the
//      year / model lookup failed and the question became a text box, owner
//      decision Q6) is kept, up to VEHICLE_TYPED_ANSWER_MAX characters.
//
//   2. resolveVehicleAnswerValues — what Offers receive (owner decision Q4):
//      the display name by default ("Toyota", "Corolla"), the year as a
//      number, typed text as typed; payload.ts sends the stored id instead
//      when the Offer field says "Send as: ID". The lead keeps the ids.
//
// Which snapshot: the one the visitor was shown (`${make_field}_snapshot`,
// spec L4), else the live one. Model ids are stable across refreshes (N4), so
// an old snapshot that has since been removed is checked against the live one.

import type { D1Database } from "@cloudflare/workers-types";
import { flattenComponents, type LeadgenComponentNode } from "../public/leadgen/components/content-schema";
import { isSnapshotId, modelsForYear, type VehicleMakeFile, type VehicleMakesFile } from "./vehicles/format";
import {
  VEHICLE_TYPED_ANSWER_MAX,
  isVehicleIdShaped,
  readVehicleSource,
  vehicleSnapshotFieldOf,
  type VehicleAsks,
} from "./vehicles/props";
import { readLiveSnapshotId, readMakeFile, readMakesFile, type VehicleStoreEnv } from "./vehicles/store";
import type { LeadgenVehicleAnswerValue } from "./payload";

/** One question whose Source is Vehicle database. */
export interface VehicleQuestion {
  field: string;
  asks: VehicleAsks;
  /** Year / Model: the Make question's field. */
  make_field: string | null;
  /** Model: the Year question's field. */
  year_field: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The vehicle questions in some Sections' component lists (containers and question groups walked). First one per field wins. */
export function collectVehicleQuestions(componentLists: readonly (readonly unknown[])[]): VehicleQuestion[] {
  const out: VehicleQuestion[] = [];
  const seen = new Set<string>();
  for (const list of componentLists) {
    for (const node of flattenComponents(list as readonly LeadgenComponentNode[])) {
      if (!isRecord(node) || typeof node["type"] !== "string") continue;
      const field = node["internal_field"];
      if (typeof field !== "string" || field.trim() === "" || seen.has(field)) continue;
      const cfg = readVehicleSource(node["type"], node["props"]);
      if (cfg === null) continue;
      seen.add(field);
      out.push({ field, asks: cfg.asks, make_field: cfg.make_field, year_field: cfg.year_field });
    }
  }
  return out;
}

/** The components of a stored content_json, or [] when it can't be read. */
export function componentsOfContentJson(contentJson: string | null | undefined): unknown[] {
  if (typeof contentJson !== "string" || contentJson === "") return [];
  try {
    const parsed = JSON.parse(contentJson) as unknown;
    return isRecord(parsed) && Array.isArray(parsed["components"]) ? (parsed["components"] as unknown[]) : [];
  } catch {
    return [];
  }
}

/** The vehicle questions in some stored Sections. */
export function vehicleQuestionsOfSections(sections: readonly { content_json: string | null }[]): VehicleQuestion[] {
  // A Section that never mentions the vehicle Source is not parsed at all
  // (the money path calls this for every lead).
  return collectVehicleQuestions(
    sections
      .filter((s) => typeof s.content_json === "string" && s.content_json.includes("choice_source"))
      .map((s) => componentsOfContentJson(s.content_json)),
  );
}

/**
 * The vehicle questions in every Section that maps one of these Offers through
 * a complete mapping — the Sections the admin previews (Offer Test tab,
 * Simulator) read their bindings from. Lowest Section id first.
 */
export async function vehicleQuestionsOfOffers(db: D1Database, offerIds: readonly number[]): Promise<VehicleQuestion[]> {
  const ids = [...new Set(offerIds.filter((id) => Number.isInteger(id)))];
  const sections: { id: number; content_json: string | null }[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < ids.length; i += 80) {
    const slice = ids.slice(i, i + 80);
    const rows = await db
      .prepare(
        `SELECT DISTINCT s.id, s.content_json FROM leadgen_sections s
           JOIN leadgen_section_answer_maps m ON m.section_id = s.id
          WHERE m.offer_id IN (${slice.map(() => "?").join(",")})
            AND m.mapping_status = 'complete'
          ORDER BY s.id ASC`,
      )
      .bind(...slice)
      .all<{ id: number; content_json: string | null }>();
    for (const row of rows.results ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      sections.push(row);
    }
  }
  sections.sort((a, b) => a.id - b.id);
  return vehicleQuestionsOfSections(sections);
}

// A raw answer may be a bare value or a `{ value, touched }` wrapper (answers.ts readRaw).
function answerValue(entry: unknown): unknown {
  if (isRecord(entry) && Object.prototype.hasOwnProperty.call(entry, "value")) return entry["value"];
  return entry;
}

// The vehicle files one request reads, each at most once (the store keeps a
// parsed copy per Worker instance on top of this).
class VehicleLookup {
  private live: Promise<string | null> | null = null;
  private readonly makesBySnapshot = new Map<string, Promise<VehicleMakesFile | null>>();
  private readonly makeByKey = new Map<string, Promise<VehicleMakeFile | null>>();

  constructor(private readonly env: VehicleStoreEnv) {}

  private liveSnapshot(): Promise<string | null> {
    if (this.live === null) this.live = readLiveSnapshotId(this.env).catch(() => null);
    return this.live;
  }

  makes(snapshot: string): Promise<VehicleMakesFile | null> {
    let hit = this.makesBySnapshot.get(snapshot);
    if (hit === undefined) {
      hit = readMakesFile(this.env, snapshot).catch(() => null);
      this.makesBySnapshot.set(snapshot, hit);
    }
    return hit;
  }

  make(snapshot: string, makeId: number): Promise<VehicleMakeFile | null> {
    const key = `${snapshot}/${makeId}`;
    let hit = this.makeByKey.get(key);
    if (hit === undefined) {
      hit = readMakeFile(this.env, snapshot, makeId).catch(() => null);
      this.makeByKey.set(key, hit);
    }
    return hit;
  }

  /** The makes list to judge one Make field's answers by: the visitor's snapshot, else the live one; null when neither can be read. */
  async makesFor(answers: Readonly<Record<string, unknown>>, makeField: string): Promise<VehicleMakesFile | null> {
    const shown = answerValue(answers[vehicleSnapshotFieldOf(makeField)]);
    if (isSnapshotId(shown)) {
      const file = await this.makes(shown);
      if (file !== null) return file;
    }
    const live = await this.liveSnapshot();
    return live === null ? null : this.makes(live);
  }
}

function idNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(String(value).trim());
}

function hasMake(file: VehicleMakesFile, makeId: number): boolean {
  return file.makes.some((m) => m.make_id === makeId);
}

/**
 * Drop vehicle answers whose database id doesn't exist in the visitor's
 * snapshot for that make (and year). Returns a filtered COPY of the raw
 * answers plus the fields dropped. Never throws; an unreadable file keeps the
 * answer (fail open).
 */
export async function checkVehicleRawAnswers(
  env: VehicleStoreEnv,
  questions: readonly VehicleQuestion[],
  rawAnswers: Readonly<Record<string, unknown>>,
): Promise<{ rawAnswers: Record<string, unknown>; dropped: string[] }> {
  const working: Record<string, unknown> = { ...rawAnswers };
  const dropped: string[] = [];
  if (questions.length === 0) return { rawAnswers: working, dropped };
  const drop = (field: string): void => {
    if (!Object.prototype.hasOwnProperty.call(working, field)) return;
    delete working[field];
    dropped.push(field);
  };
  const lookup = new VehicleLookup(env);
  const value = (field: string): unknown => answerValue(working[field]);
  // Make fields whose answer was checked and found missing from the list.
  const badMake = new Set<string>();

  try {
    // A typed answer longer than the text box allows, and a snapshot record
    // that isn't a snapshot id, are never stored.
    for (const q of questions) {
      if (q.asks === "make") {
        const snapField = vehicleSnapshotFieldOf(q.field);
        const shown = value(snapField);
        if (shown !== undefined && !isSnapshotId(shown)) drop(snapField);
      }
      const v = value(q.field);
      if (typeof v === "string" && !isVehicleIdShaped(q.asks, v) && v.trim().length > VEHICLE_TYPED_ANSWER_MAX) drop(q.field);
    }

    // Make: the make_id must be in the visitor's makes list.
    for (const q of questions) {
      if (q.asks !== "make") continue;
      const v = value(q.field);
      if (!isVehicleIdShaped("make", v)) continue;
      const makes = await lookup.makesFor(working, q.field);
      if (makes === null) continue; // can't read the list → keep (fail open)
      if (!hasMake(makes, idNumber(v))) {
        drop(q.field);
        badMake.add(q.field);
      }
    }

    // The make file a Year / Model answer is judged by: "bad" when the make
    // answer is known to be wrong, null when it can't be read (keep).
    const makeFileFor = async (makeField: string | null): Promise<VehicleMakeFile | "bad" | null> => {
      if (makeField === null) return null;
      if (badMake.has(makeField)) return "bad";
      const mv = value(makeField);
      if (!isVehicleIdShaped("make", mv)) return null; // no make, or typed text — nothing to check against
      const makes = await lookup.makesFor(working, makeField);
      if (makes === null) return null;
      const makeId = idNumber(mv);
      if (!hasMake(makes, makeId)) return "bad";
      return lookup.make(makes.snapshot, makeId);
    };

    // Year: the model year must be one of that make's years.
    const badYear = new Set<string>();
    for (const q of questions) {
      if (q.asks !== "year") continue;
      const v = value(q.field);
      if (!isVehicleIdShaped("year", v)) continue;
      const file = await makeFileFor(q.make_field);
      if (file === null) continue;
      if (file === "bad" || !file.years.some((y) => y.year === idNumber(v))) {
        drop(q.field);
        badYear.add(q.field);
      }
    }

    // Model: the model_id must be one of that make's models — and, when the
    // year answer is a real year of that make, one of that year's models.
    for (const q of questions) {
      if (q.asks !== "model") continue;
      const v = value(q.field);
      if (!isVehicleIdShaped("model", v)) continue;
      const file = await makeFileFor(q.make_field);
      if (file === null) continue;
      if (file === "bad" || !file.models.some((m) => m.model_id === v)) {
        drop(q.field);
        continue;
      }
      const yv = q.year_field === null || badYear.has(q.year_field) ? undefined : value(q.year_field);
      if (!isVehicleIdShaped("year", yv)) continue;
      const year = idNumber(yv);
      if (!file.years.some((y) => y.year === year)) continue;
      if (!modelsForYear(file, year).some((m) => m.model_id === v)) drop(q.field);
    }
  } catch (err) {
    // Never on the money path: keep what was checked so far.
    console.warn("[vehicles] answer check failed", err instanceof Error ? err.message : "unknown");
  }
  return { rawAnswers: working, dropped };
}

/**
 * What each answered vehicle question sends to Offers (owner decision Q4),
 * keyed by internal_field: { name, id }. Make → name "Toyota", id as stored
 * ("448"); Year → the year as a number for both; Model → name "Corolla", id
 * "m_…"; typed text → the text for both. A database id whose name can't be
 * read is left out (the stored answer is then sent as it is — fail open).
 * Never throws.
 */
export async function resolveVehicleAnswerValues(
  env: VehicleStoreEnv,
  questions: readonly VehicleQuestion[],
  answers: Readonly<Record<string, unknown>>,
): Promise<Record<string, LeadgenVehicleAnswerValue>> {
  const out: Record<string, LeadgenVehicleAnswerValue> = {};
  if (questions.length === 0) return out;
  const lookup = new VehicleLookup(env);
  try {
    for (const q of questions) {
      const v = answerValue(answers[q.field]);
      if (typeof v !== "string" && typeof v !== "number") continue;
      if (typeof v === "string" && v.trim() === "") continue;
      if (!isVehicleIdShaped(q.asks, v)) {
        out[q.field] = { name: v, id: v }; // typed text (Q6): sent as typed
        continue;
      }
      if (q.asks === "year") {
        const year = idNumber(v);
        out[q.field] = { name: year, id: year };
        continue;
      }
      const makeField = q.asks === "make" ? q.field : q.make_field;
      if (makeField === null) continue;
      const mv = q.asks === "make" ? v : answerValue(answers[makeField]);
      if (!isVehicleIdShaped("make", mv)) continue;
      const makes = await lookup.makesFor(answers, makeField);
      if (makes === null) continue;
      const makeId = idNumber(mv);
      if (q.asks === "make") {
        const entry = makes.makes.find((m) => m.make_id === makeId);
        if (entry !== undefined) out[q.field] = { name: entry.name, id: v };
        continue;
      }
      const file = await lookup.make(makes.snapshot, makeId);
      const model = file?.models.find((m) => m.model_id === v);
      if (model !== undefined) out[q.field] = { name: model.name, id: v };
    }
  } catch (err) {
    console.warn("[vehicles] name lookup failed", err instanceof Error ? err.message : "unknown");
  }
  return out;
}
