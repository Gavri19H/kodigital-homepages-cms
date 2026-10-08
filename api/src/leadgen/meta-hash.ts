// Meta (Facebook) contact-data normalisation + SHA-256 hashing, and the Meta
// browser-identifier cookies (_fbp / _fbc).
//
// OWNER 2026-10-08 R3 ("Hash them in Athena"): typed email / phone / name /
// street / date-of-birth answers are stored as SHA-256 of the Meta-normalised
// value, never as plain text. R2: contact details from the funnel go to Meta
// HASHED for matching (browser + server events). One module so the Athena
// event stream, the auction's persisted meta_user_data and the Meta senders
// hash the SAME normalised value — a mismatch would silently break matching.
//
// Pure: no imports, no I/O. crypto.subtle + TextEncoder exist in workerd, Node
// and browsers, so any caller (server or a bundled script) can import it.

// Lowercase hex SHA-256 of the exact string given (callers normalise first).
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let out = "";
  for (const byte of new Uint8Array(digest)) out += byte.toString(16).padStart(2, "0");
  return out;
}

// The Meta user_data keys this product fills (customer-information parameters).
export type MetaUserDataKey = "em" | "ph" | "fn" | "ln" | "db" | "ct" | "st" | "zp" | "country";

// The contact kinds a funnel answer can be. The Meta keys plus `street` (an
// address line — hashed in Athena, not a Meta user_data key) and `text` (a
// free-text answer the operator marked as personal data: hashed trimmed +
// lowercased).
export type MetaContactKind = MetaUserDataKey | "street" | "text";

export type MetaUserData = Partial<Record<MetaUserDataKey, string>>;

function asText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return "";
}

// email: trim + lowercase.
export function normalizeMetaEmail(raw: unknown): string {
  return asText(raw).trim().toLowerCase();
}

// phone: digits only; a 10-digit (US national) number gets the leading 1.
export function normalizeMetaPhone(raw: unknown): string {
  const digits = asText(raw).replace(/[^0-9]/g, "");
  if (digits.length === 10) return `1${digits}`;
  return digits;
}

// first / last name: lowercase, trimmed.
export function normalizeMetaName(raw: unknown): string {
  return asText(raw).trim().toLowerCase();
}

// street line: lowercase, trimmed.
export function normalizeMetaStreet(raw: unknown): string {
  return asText(raw).trim().toLowerCase();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function validYmd(y: number, m: number, d: number): string {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return "";
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return "";
  return `${y}${pad2(m)}${pad2(d)}`;
}

const DOB_YMD = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s])/;
const DOB_MDY = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/;
const DOB_COMPACT = /^(\d{4})(\d{2})(\d{2})$/;

// date of birth: YYYYMMDD. Accepts the shapes a date answer arrives in
// (ISO YYYY-MM-DD[...], YYYY/MM/DD, MM/DD/YYYY, MM-DD-YYYY, YYYYMMDD). An
// unparseable value normalises to "" (never a guessed date).
export function normalizeMetaDob(raw: unknown): string {
  const s = asText(raw).trim();
  let m = s.match(DOB_YMD);
  if (m !== null) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(DOB_MDY);
  if (m !== null) return validYmd(Number(m[3]), Number(m[1]), Number(m[2]));
  m = s.match(DOB_COMPACT);
  if (m !== null) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  return "";
}

// city: lowercase letters only.
export function normalizeMetaCity(raw: unknown): string {
  return asText(raw).toLowerCase().replace(/[^a-z]/g, "");
}

const US_STATE_CODES: Readonly<Record<string, string>> = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca", colorado: "co",
  connecticut: "ct", delaware: "de", districtofcolumbia: "dc", florida: "fl", georgia: "ga",
  hawaii: "hi", idaho: "id", illinois: "il", indiana: "in", iowa: "ia", kansas: "ks",
  kentucky: "ky", louisiana: "la", maine: "me", maryland: "md", massachusetts: "ma",
  michigan: "mi", minnesota: "mn", mississippi: "ms", missouri: "mo", montana: "mt",
  nebraska: "ne", nevada: "nv", newhampshire: "nh", newjersey: "nj", newmexico: "nm",
  newyork: "ny", northcarolina: "nc", northdakota: "nd", ohio: "oh", oklahoma: "ok",
  oregon: "or", pennsylvania: "pa", rhodeisland: "ri", southcarolina: "sc", southdakota: "sd",
  tennessee: "tn", texas: "tx", utah: "ut", vermont: "vt", virginia: "va", washington: "wa",
  westvirginia: "wv", wisconsin: "wi", wyoming: "wy", puertorico: "pr",
};

// state: the 2-letter code, lowercase. A full US state name maps to its code;
// anything else that is not exactly two letters normalises to "".
export function normalizeMetaState(raw: unknown): string {
  const letters = asText(raw).toLowerCase().replace(/[^a-z]/g, "");
  if (letters.length === 2) return letters;
  return US_STATE_CODES[letters] ?? "";
}

// zip: the first 5 digits ("" when fewer than 5).
export function normalizeMetaZip(raw: unknown): string {
  const digits = asText(raw).replace(/[^0-9]/g, "");
  return digits.length >= 5 ? digits.slice(0, 5) : "";
}

// country: 2-letter lowercase ISO code.
export function normalizeMetaCountry(raw: unknown): string {
  const letters = asText(raw).toLowerCase().replace(/[^a-z]/g, "");
  return letters.length === 2 ? letters : "";
}

// The Meta normalisation for one contact kind ("" = nothing usable).
export function normalizeMetaValue(kind: MetaContactKind, raw: unknown): string {
  switch (kind) {
    case "em":
      return normalizeMetaEmail(raw);
    case "ph":
      return normalizeMetaPhone(raw);
    case "fn":
    case "ln":
      return normalizeMetaName(raw);
    case "db":
      return normalizeMetaDob(raw);
    case "ct":
      return normalizeMetaCity(raw);
    case "st":
      return normalizeMetaState(raw);
    case "zp":
      return normalizeMetaZip(raw);
    case "country":
      return normalizeMetaCountry(raw);
    case "street":
      return normalizeMetaStreet(raw);
    case "text":
      return asText(raw).trim().toLowerCase();
  }
}

// SHA-256 of the Meta-normalised value; "" when the value normalises to "".
export async function hashMetaValue(kind: MetaContactKind, raw: unknown): Promise<string> {
  const normalized = normalizeMetaValue(kind, raw);
  return normalized === "" ? "" : sha256Hex(normalized);
}

const META_USER_DATA_KEYS: readonly MetaUserDataKey[] = ["em", "ph", "fn", "ln", "db", "ct", "st", "zp", "country"];

// Hash a plain user_data map key by key. Keys whose value normalises to ""
// are OMITTED (never an empty / hash-of-empty entry). Hashed values only.
export async function hashMetaUserData(plain: Partial<Record<MetaUserDataKey, unknown>>): Promise<MetaUserData> {
  const out: MetaUserData = {};
  for (const key of META_USER_DATA_KEYS) {
    if (plain[key] === undefined) continue;
    const hashed = await hashMetaValue(key, plain[key]);
    if (hashed !== "") out[key] = hashed;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Meta browser identifiers
// ---------------------------------------------------------------------------

// Meta's _fbp cookie: fb.<subdomain index>.<creation ms>.<random>.
export const META_FBP_RE = /^fb\.[0-9]\.[0-9]{10,16}\.[0-9]{1,24}$/;
// Meta's _fbc cookie: fb.<subdomain index>.<creation ms>.<fbclid>.
export const META_FBC_RE = /^fb\.[0-9]\.[0-9]{10,16}\.[A-Za-z0-9_\-.]{1,500}$/;

// One cookie's raw value from a Cookie header ("" when absent).
export function readCookieValue(cookieHeader: string | null | undefined, name: string): string {
  if (typeof cookieHeader !== "string" || cookieHeader === "") return "";
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return "";
}

// The request's _fbp cookie when it has Meta's shape, else "".
export function readFbpCookie(cookieHeader: string | null | undefined): string {
  const value = readCookieValue(cookieHeader, "_fbp");
  return META_FBP_RE.test(value) ? value : "";
}

// The request's _fbc cookie when it has Meta's shape, else "".
export function readFbcCookie(cookieHeader: string | null | undefined): string {
  const value = readCookieValue(cookieHeader, "_fbc");
  return META_FBC_RE.test(value) ? value : "";
}
