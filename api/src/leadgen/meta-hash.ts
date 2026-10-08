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

// Fix round 1 (review m2): a contact value is capped to 254 characters (an
// email address's maximum) before any pattern runs on it — here and in the
// funnel shell's browser normaliser alike, so both halves hash the same text.
// (A free-text answer the operator marked personal — kind "text" — is hashed
// whole: it is never matched against a pattern.)
const META_VALUE_MAX_CHARS = 254;
function contactText(raw: unknown): string {
  return asText(raw).slice(0, META_VALUE_MAX_CHARS);
}

// email: trim + lowercase.
export function normalizeMetaEmail(raw: unknown): string {
  return contactText(raw).trim().toLowerCase();
}

// phone (Meta's rule — the funnel shell's browser normaliser does the SAME,
// serve.ts metaPixelShellScript `norm`): digits only; leading zeros (an
// international "00" prefix included) stripped; a 10-digit number (US
// national) gets the leading 1. Fewer than 7 digits is not a phone number ⇒ "".
export function normalizeMetaPhone(raw: unknown): string {
  let digits = contactText(raw).replace(/[^0-9]/g, "").replace(/^0+/, "");
  if (digits.length === 10) digits = `1${digits}`;
  return digits.length >= 7 ? digits : "";
}

// Any character that is not a Unicode letter (punctuation, spaces, digits,
// combining marks, symbols).
const NON_LETTER_RE = /[^\p{L}]/gu;

// first / last name (Meta's rule — the browser normaliser does the SAME):
// lowercase letters only. Unicode letters are kept ("Zoë" → "zoë"), everything
// else — punctuation, spaces, digits — is removed ("Mary-Jane O'Neil" →
// "maryjaneoneil").
export function normalizeMetaName(raw: unknown): string {
  return contactText(raw).toLowerCase().replace(NON_LETTER_RE, "");
}

// street line: lowercase, trimmed.
export function normalizeMetaStreet(raw: unknown): string {
  return contactText(raw).trim().toLowerCase();
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
  const s = contactText(raw).trim();
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
  return contactText(raw).toLowerCase().replace(/[^a-z]/g, "");
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
  const letters = contactText(raw).toLowerCase().replace(/[^a-z]/g, "");
  if (letters.length === 2) return letters;
  return US_STATE_CODES[letters] ?? "";
}

// zip: the first 5 digits ("" when fewer than 5).
export function normalizeMetaZip(raw: unknown): string {
  const digits = contactText(raw).replace(/[^0-9]/g, "");
  return digits.length >= 5 ? digits.slice(0, 5) : "";
}

// country: 2-letter lowercase ISO code.
export function normalizeMetaCountry(raw: unknown): string {
  const letters = contactText(raw).toLowerCase().replace(/[^a-z]/g, "");
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

// ---------------------------------------------------------------------------
// The ONE answer-key → Meta-key list (fix round 1, review M1)
// ---------------------------------------------------------------------------

// A funnel answer whose internal field NAME says what contact detail it holds
// (a free-text "email" box, an answer keyed "telephone", ...). Used by: the
// Athena enrichment (leadgen-enrich.ts — such a free-text answer is hashed),
// the auction's hashed Meta user data (leadgen-enrich.ts
// buildAuctionMetaUserData) and the funnel shell's browser field map
// (serve.ts metaMatchFieldMap). One list, so the three never disagree.
// The Meta keys a field name can stand for (every user_data key but country).
export type MetaContactFieldKey = Exclude<MetaUserDataKey, "country">;

export const META_CONTACT_FIELD_PATTERNS: ReadonlyArray<readonly [RegExp, MetaContactFieldKey]> = [
  [/^e_?mail(_?address)?$/i, "em"],
  [/^(phone|phone_?number|telephone|mobile|mobile_?phone|cell|cell_?phone)$/i, "ph"],
  [/^(first_?name|fname|given_name)$/i, "fn"],
  [/^(last_?name|lname|surname|family_name)$/i, "ln"],
  [/^(dob|date_of_birth|birth_?date|birthday)$/i, "db"],
  [/^(zip|zip_?code|postal_?code)$/i, "zp"],
  [/^city$/i, "ct"],
  [/^state$/i, "st"],
];

// The Meta key an answer's internal field name stands for, or null.
export function metaKeyForFieldName(field: unknown): MetaContactFieldKey | null {
  if (typeof field !== "string") return null;
  const name = field.trim();
  if (name === "" || name.length > 64) return null;
  for (const [re, key] of META_CONTACT_FIELD_PATTERNS) {
    if (re.test(name)) return key;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Contact-value sniff (fix round 1, review M1 + m2)
// ---------------------------------------------------------------------------

// Values are capped to this many characters BEFORE any regex runs (an email
// address is at most 254 characters), so no answer — however long — can make
// a pattern below run long. Both patterns are linear: the email one has a
// single way to split (labels exclude "."), the phone one is a bounded class.
export const META_SNIFF_MAX_CHARS = META_VALUE_MAX_CHARS;
const EMAIL_SNIFF_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const PHONE_SNIFF_RE = /^[+()\-.\s\d]{7,24}$/;

// What a typed value LOOKS like, whatever question it answered: an email
// address, a phone number (10 or 11 digits), or neither (null).
export function sniffMetaContactKind(value: unknown): "em" | "ph" | null {
  const v = asText(value).trim().slice(0, META_SNIFF_MAX_CHARS);
  if (v === "") return null;
  if (EMAIL_SNIFF_RE.test(v)) return "em";
  if (PHONE_SNIFF_RE.test(v)) {
    const digits = v.replace(/[^0-9]/g, "").length;
    if (digits === 10 || digits === 11) return "ph";
  }
  return null;
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
