// F18 Vehicle database: how a question stores "Source: Vehicle database".
//
// A Buttons (ButtonAnswerGroup), Cards (IconCardAnswerGrid / ImageCardAnswerGrid)
// or Dropdown (DropdownQuestion / SearchableDropdownQuestion) question can take
// its choices from the vehicle database instead of its typed `choices` list.
// The setting lives in flat keys on `node.props` (the Studio inspector writes
// props one key at a time). `props.source` is NOT used: it already means the
// Image / Logo source on ImageBlock.
//
//   props.choice_source          "vehicle"  (absent or "typed" = today's typed choices)
//   props.vehicle_asks           "make" | "year" | "model"
//   props.vehicle_make_field     internal_field of the Make question   (Year, Model)
//   props.vehicle_year_field     internal_field of the Year question   (Model)
//   props.vehicle_featured_makes make_ids shown as cards, in order    (Make on Buttons / Cards)
//   props.vehicle_year_cards     newest N years shown as cards         (Year on Buttons / Cards; default 6)
//   props.vehicle_other_label    label of the "Other" card             (default "Other make" / "Older year")
//
// Saved answers (spec L4): Make → the make_id as a string ("448"); Year → the
// model year as a number (2023); Model → the model_id ("m_…"). When the year /
// model lookup fails, the question becomes a short text box (owner decision
// Q6) and the answer is the visitor's own text. The snapshot the visitor was
// shown is saved next to the Make answer (vehicleSnapshotFieldOf).
// Pure functions, no I/O.

export type VehicleAsks = "make" | "year" | "model";

/** Component kinds that may use the vehicle database. */
export const VEHICLE_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "ButtonAnswerGroup",
  "IconCardAnswerGrid",
  "ImageCardAnswerGrid",
  "DropdownQuestion",
  "SearchableDropdownQuestion",
]);

/** Kinds that show cards / buttons (featured makes, newest-N years, "Other"). */
export const VEHICLE_CARD_TYPES: ReadonlySet<string> = new Set([
  "ButtonAnswerGroup",
  "IconCardAnswerGrid",
  "ImageCardAnswerGrid",
]);

/** Kinds whose Make cards carry the make's logo. */
export const VEHICLE_LOGO_CARD_TYPES: ReadonlySet<string> = new Set([
  "IconCardAnswerGrid",
  "ImageCardAnswerGrid",
]);

/** Owner decision Q8: the pre-filled featured makes (by display name; resolved to make_ids against the live list). */
export const VEHICLE_DEFAULT_FEATURED_MAKE_NAMES: readonly string[] = [
  "Toyota",
  "Honda",
  "Ford",
  "Chevrolet",
  "Nissan",
  "Jeep",
  "Hyundai",
  "Kia",
];

export const VEHICLE_DEFAULT_YEAR_CARDS = 6;
export const VEHICLE_YEAR_CARDS_MIN = 1;
export const VEHICLE_YEAR_CARDS_MAX = 12;
export const VEHICLE_FEATURED_MAKES_MAX = 24;
export const VEHICLE_OTHER_LABEL_MAX = 60;
/** Longest typed answer accepted when the lookup failed and the question became a text box (Q6). */
export const VEHICLE_TYPED_ANSWER_MAX = 80;
/**
 * The answer field that records the snapshot the visitor was shown (spec L4):
 * a Make question with internal_field "vehicle_make" also records
 * "vehicle_make_snapshot". Year and Model questions use their Make question's.
 */
export function vehicleSnapshotFieldOf(makeField: string): string {
  return `${makeField}_snapshot`;
}
/** Owner decision Q6: how long the visitor waits for the year / model lookup before the text box. */
export const VEHICLE_LOOKUP_TIMEOUT_MS = 1000;

export interface VehicleSourceConfig {
  asks: VehicleAsks;
  make_field: string | null;
  year_field: string | null;
  featured_makes: number[];
  year_cards: number;
  other_label: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** True when the node's props say "Source: Vehicle database" (regardless of whether the rest is valid). */
export function isVehicleSource(props: unknown): boolean {
  return isRecord(props) && props["choice_source"] === "vehicle";
}

/** Parse the featured-makes prop: an array of positive whole numbers (strings of digits accepted), de-duplicated, order kept. */
export function parseFeaturedMakes(v: unknown): number[] {
  const raw: unknown[] = Array.isArray(v)
    ? v
    : typeof v === "string"
      ? v.split(",")
      : [];
  const out: number[] = [];
  for (const item of raw) {
    const n = typeof item === "number" ? item : typeof item === "string" && /^\s*\d+\s*$/.test(item) ? Number(item) : NaN;
    if (Number.isSafeInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

function parseYearCards(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN;
  if (!Number.isInteger(n)) return VEHICLE_DEFAULT_YEAR_CARDS;
  return Math.min(VEHICLE_YEAR_CARDS_MAX, Math.max(VEHICLE_YEAR_CARDS_MIN, n));
}

/**
 * The vehicle settings of a node, or null when the node uses typed choices or
 * its "This question asks for" is missing / unknown. Lenient: the save rules in
 * content-schema.ts report what is wrong; readers just need a usable shape.
 */
export function readVehicleSource(type: string, props: unknown): VehicleSourceConfig | null {
  if (!VEHICLE_SOURCE_TYPES.has(type) || !isVehicleSource(props) || !isRecord(props)) return null;
  const asks = props["vehicle_asks"];
  if (asks !== "make" && asks !== "year" && asks !== "model") return null;
  const defaultOther = asks === "year" ? "Older year" : asks === "make" ? "Other make" : "Other";
  return {
    asks,
    make_field: asks === "make" ? null : str(props["vehicle_make_field"]),
    year_field: asks === "model" ? str(props["vehicle_year_field"]) : null,
    featured_makes: asks === "make" ? parseFeaturedMakes(props["vehicle_featured_makes"]).slice(0, VEHICLE_FEATURED_MAKES_MAX) : [],
    year_cards: parseYearCards(props["vehicle_year_cards"]),
    other_label: (str(props["vehicle_other_label"]) ?? defaultOther).slice(0, VEHICLE_OTHER_LABEL_MAX),
  };
}

/** Does an answer value look like a database id for this kind of question (vs. typed text from the Q6 fallback)? */
export function isVehicleIdShaped(asks: VehicleAsks, value: unknown): boolean {
  if (asks === "make") return (typeof value === "string" && /^[1-9]\d{0,8}$/.test(value)) || (typeof value === "number" && Number.isSafeInteger(value) && value > 0);
  if (asks === "year") return (typeof value === "number" && Number.isInteger(value)) || (typeof value === "string" && /^\d{4}$/.test(value));
  return typeof value === "string" && /^m_[0-9a-f]{10}$/.test(value);
}
