// The banner creative of a "Static — no provider request" Offer (0060).
//
// OWNER 2026-09-27: "allow building the banner properties (Creative), similar
// to the fields that are available to the offers that do send a request. In
// the current situation, only the URL is available which leads to a very
// 'thin' creative that looks bad and will most likely drive users away from
// clicking the button." — his screenshot: the Fora card rendered as the word
// "Impact" (the affiliate network, taken from the Provider field) over a
// VIEW MY RATE button, while the Fundera card beside it had a logo, a brand
// and copy.
//
// WHY THEY DIFFERED: a provider-request Offer's card is filled from its
// response parser — carrier name, logo, headline, subheadline, disclaimer
// (ui-payload-builder.ts CARRIER_PARSE_FIELDS). A static Offer has no
// response, and engine.ts staticCarrier() only ever set carrier_name to the
// Provider field; logo/headline/subheadline/disclaimer were hard-coded null.
// These five fields are exactly the parser's creative fields, authored
// directly because there is no response to read them from. The click
// destination is unchanged (Banner URL template / fallback URL), and the CTA
// label stays auction-level (Banner builder), as it is for every Offer.
//
// ONE place for the rules, shared by the Offer API (validation), the live
// auction (engine.ts) and the Offer editor's preview, so what an operator
// saves, what the preview shows and what a visitor sees cannot drift apart.

export const STATIC_CREATIVE_FIELDS = [
  "static_brand_name",
  "static_logo_url",
  "static_headline",
  "static_subheadline",
  "static_disclaimer",
] as const;
export type StaticCreativeField = (typeof STATIC_CREATIVE_FIELDS)[number];
export type StaticCreative = Record<StaticCreativeField, string | null>;

export const STATIC_CREATIVE_LIMITS: Readonly<Record<StaticCreativeField, number>> = {
  static_brand_name: 80,
  static_logo_url: 1024,
  static_headline: 140,
  static_subheadline: 280,
  static_disclaimer: 600,
};

const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/; // newlines/tabs allowed in copy
const URL_CONTROL_RE = /[\u0000- \u007f]/;
// A Media-library object as the picker stores it: the path the Worker serves.
const MEDIA_PATH_RE = /^\/media\/[A-Za-z0-9._~\-/]+$/;

// Validate one field. null/"" clears it. A logo is an absolute http(s) URL or
// a Media-library path (/media/<key>) — resolved per request, see below.
export function validateStaticCreativeField(
  field: StaticCreativeField,
  raw: unknown,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: `${field} must be text` };
  const v = field === "static_logo_url" ? raw.trim() : raw.replace(/\r\n/g, "\n").trim();
  if (v === "") return { ok: true, value: null };
  const max = STATIC_CREATIVE_LIMITS[field];
  if (v.length > max) return { ok: false, error: `${labelOf(field)} must be at most ${max} characters` };
  if (field === "static_logo_url") {
    if (URL_CONTROL_RE.test(v)) return { ok: false, error: "Logo must be a single URL without spaces" };
    if (MEDIA_PATH_RE.test(v) && !v.includes("..")) return { ok: true, value: v };
    try {
      const u = new URL(v);
      if (u.protocol === "https:" || u.protocol === "http:") return { ok: true, value: v };
    } catch {
      /* fall through */
    }
    return { ok: false, error: "Logo must be an image from the Media library or an https:// image URL" };
  }
  if (CONTROL_RE.test(v)) return { ok: false, error: `${labelOf(field)} contains an invalid character` };
  if (field === "static_brand_name" && v.includes("\n")) return { ok: false, error: "Brand name must be one line" };
  return { ok: true, value: v };
}

export function labelOf(field: StaticCreativeField): string {
  switch (field) {
    case "static_brand_name":
      return "Brand name";
    case "static_logo_url":
      return "Logo";
    case "static_headline":
      return "Headline";
    case "static_subheadline":
      return "Subheadline";
    case "static_disclaimer":
      return "Disclaimer";
  }
}

// The banner only ever emits an ABSOLUTE http(s) logo (banner.ts). A
// Media-library path is therefore made absolute against the origin the page
// is served from — the funnel's own domain at auction time, the admin host in
// the editor preview — so a picked image works on every tenant site without
// pinning one domain into the Offer. No origin ⇒ no logo (never a broken one).
export function resolveCreativeLogo(logo: string | null | undefined, origin: string | null): string | null {
  const v = (logo ?? "").trim();
  if (v === "") return null;
  if (MEDIA_PATH_RE.test(v)) return origin !== null && /^https?:\/\/[^/]+$/.test(origin) ? `${origin}${v}` : null;
  return /^https?:\/\//i.test(v) ? v : null;
}

export function requestOrigin(url: string | null | undefined): string | null {
  if (url === null || url === undefined || url === "") return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

// The display half of a static Offer's carrier: the authored creative, with
// the brand falling back to what the card showed before (Provider, then the
// Offer name) so an Offer nobody has edited renders exactly as it did.
export function staticCreativeDisplay(
  offer: { provider: string | null; offer_name: string | null } & Partial<Record<StaticCreativeField, string | null>>,
  origin: string | null,
): { carrier_name: string | null; carrier_logo: string | null; headline: string | null; subheadline: string | null; disclaimer: string | null } {
  return {
    carrier_name: text(offer.static_brand_name) ?? text(offer.provider) ?? text(offer.offer_name),
    carrier_logo: resolveCreativeLogo(offer.static_logo_url ?? null, origin),
    headline: text(offer.static_headline),
    subheadline: text(offer.static_subheadline),
    disclaimer: text(offer.static_disclaimer),
  };
}
