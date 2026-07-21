// Round-4 P5c - hand-rolled allowlist SVG sanitizer (the security core).
//
// WHY this is the security boundary. A user-uploaded brand-logo SVG is served
// at GET /media/<key> with Content-Type image/svg+xml (media/serve.ts, which
// now also sets `X-Content-Type-Options: nosniff` as defense-in-depth). An
// <img>-embedded SVG cannot run script in any modern browser, BUT anyone who
// NAVIGATES directly to /media/<key> loads the SVG as a TOP-LEVEL document in
// the serving origin - where an inline <script>, an on* handler, a
// javascript: href, a <foreignObject><iframe>, an external <use>, or a
// DOCTYPE entity would execute / exfiltrate. nosniff narrows (a browser will
// not content-sniff a mislabeled response into HTML) but does NOT neutralize
// a document correctly served AS image/svg+xml and then navigated to
// directly - sanitizing at UPLOAD remains the boundary that must hold, on
// EVERY upload route (see sanitizeSvgUpload below - the SAME gate closes both
// admin/leadgen/assets-handlers.ts's brand-logo endpoint and
// admin/media-crud-handlers.ts's generic media-library upload).
//
// STRATEGY - mirrors payload.ts isCatastrophicRegexShape: a SOUND, hand-rolled
// parser over a SMALL allowlist. Reject anything outside the allowlist, then
// RE-SERIALIZE from the parsed token stream: the output contains ONLY what
// this module explicitly emits. A pass-through filter can be defeated by a
// parser-differential trick (the browser parses what the filter missed); a
// re-serializer cannot emit a construct it never built. No new runtime
// dependency - the allowlist is small, and a DOM/XML parser library would be a
// larger attack surface than the thing it guards.

export interface SanitizeSvgOk {
  ok: true;
  svg: string;
}
export interface SanitizeSvgErr {
  ok: false;
  reason: string;
}
export type SanitizeSvgResult = SanitizeSvgOk | SanitizeSvgErr;

// DoS bounds. 512KB is generous for a brand logo (typical marks are <30KB) and
// small enough that decode + walk stays cheap; the element cap stops a
// structurally-nested "billion elements" input (entity bombs are rejected
// outright via the DOCTYPE gate below).
export const SVG_MAX_BYTES = 512 * 1024;
export const SVG_MAX_ELEMENTS = 2000;

// Element allowlist (matched case-INSENSITIVELY, emitted case-PRESERVED so
// case-sensitive SVG names - linearGradient, radialGradient, clipPath - keep
// rendering). Deliberately EXCLUDES script / foreignObject / use / image / a /
// style / animate* / set / symbol / pattern / metadata: an upload using them
// is rejected with a plain reason (the safe-side over-rejection trade-off, like
// isCatastrophicRegexShape). Authors export "presentation attribute" SVGs.
const ALLOWED_ELEMENTS_LC: ReadonlySet<string> = new Set([
  "svg",
  "g",
  "defs",
  "title",
  "desc",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "lineargradient",
  "radialgradient",
  "stop",
  "clippath",
  "mask",
  "text",
  "tspan",
]);

// Attribute allowlist (matched case-INSENSITIVELY, emitted case-PRESERVED so
// viewBox / preserveAspectRatio / gradientUnits keep working). `style` is NOT
// here (a CSS injection / external-url() vector). href / xlink:href are NOT
// here - they get a dedicated stricter policy (safe embedded raster only).
const ALLOWED_ATTRS_LC: ReadonlySet<string> = new Set([
  // structural / identity
  "id",
  "class",
  "xmlns",
  "xmlns:xlink",
  "version",
  "viewbox",
  "preserveaspectratio",
  "role",
  // geometry
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "width",
  "height",
  "d",
  "points",
  "dx",
  "dy",
  "transform",
  "pathlength",
  "gradientunits",
  "gradienttransform",
  "spreadmethod",
  "fx",
  "fy",
  "offset",
  "clippathunits",
  "maskunits",
  "maskcontentunits",
  // paint / presentation
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "opacity",
  "color",
  "stop-color",
  "stop-opacity",
  "display",
  "visibility",
  "vector-effect",
  "paint-order",
  "clip-path",
  "clip-rule",
  "mask",
  // text presentation
  "text-anchor",
  "dominant-baseline",
  "alignment-baseline",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "baseline-shift",
  "writing-mode",
  "direction",
]);

// href / xlink:href are allowed ONLY as a safe embedded raster (data:image/png
// or data:image/jpeg base64) - the single carve-out the brief names. Every
// other scheme (javascript:, data:text/html, external http(s), file:) rejects.
const SAFE_DATA_IMAGE_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=\s]+$/i;

// A url(...) reference is allowed ONLY as a LOCAL fragment (url(#grad)) - an
// external url(http://...) paint-server / mask is an SSRF / privacy leak.
const EXTERNAL_URL_REF_RE = /url\(\s*['"]?(?!#)/i;

// NUL and other C0 control chars. Tab, LF and CR are excluded: they are
// legal whitespace inside points="..." / d="..." values.
const CONTROL_CHAR_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

function err(reason: string): SanitizeSvgErr {
  return { ok: false, reason };
}

function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

// Decode the small set of XML/HTML entities an attacker can use to obfuscate a
// scheme (&#106;avascript: -> javascript:). We validate the DECODED value and
// then emit the decoded-then-re-escaped value, so what we checked == what we
// serialize (no filter/serializer divergence). &amp; is decoded LAST to avoid
// the classic &amp;lt; double-decode.
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => codePoint(parseInt(d, 10)))
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}
function codePoint(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return "";
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface ParsedAttr {
  name: string;
  value: string;
}
interface ParsedTagOk {
  ok: true;
  name: string;
  nameLower: string;
  attrs: ParsedAttr[];
  selfClosing: boolean;
  nextIndex: number;
}
type ParsedTag = ParsedTagOk | SanitizeSvgErr;

const NAME_CHAR_RE = /[A-Za-z0-9:_-]/;
const WS_RE = /\s/;
const ATTR_NAME_STOP_RE = /[\s=/>]/;
const UNQUOTED_STOP_RE = /[\s>]/;

// Parse a single open / self-closing tag beginning at `start` (the '<').
function parseTag(raw: string, start: number): ParsedTag {
  const n = raw.length;
  let i = start + 1;
  const nameStart = i;
  while (i < n && NAME_CHAR_RE.test(raw[i]!)) i += 1;
  const name = raw.slice(nameStart, i);
  if (name === "") return err("malformed tag (no element name)");
  const attrs: ParsedAttr[] = [];
  while (i < n) {
    while (i < n && WS_RE.test(raw[i]!)) i += 1;
    if (i >= n) return err("unterminated tag");
    const ch = raw[i]!;
    if (ch === ">") {
      return { ok: true, name, nameLower: name.toLowerCase(), attrs, selfClosing: false, nextIndex: i + 1 };
    }
    if (ch === "/") {
      i += 1;
      while (i < n && WS_RE.test(raw[i]!)) i += 1;
      if (raw[i] !== ">") return err("malformed self-closing tag");
      return { ok: true, name, nameLower: name.toLowerCase(), attrs, selfClosing: true, nextIndex: i + 1 };
    }
    const anStart = i;
    while (i < n && !ATTR_NAME_STOP_RE.test(raw[i]!)) i += 1;
    const aname = raw.slice(anStart, i);
    if (aname === "") return err("malformed attribute");
    while (i < n && WS_RE.test(raw[i]!)) i += 1;
    let avalue = "";
    if (raw[i] === "=") {
      i += 1;
      while (i < n && WS_RE.test(raw[i]!)) i += 1;
      const q = raw[i];
      if (q === '"' || q === "'") {
        i += 1;
        const vStart = i;
        while (i < n && raw[i] !== q) i += 1;
        if (i >= n) return err("unterminated attribute value");
        avalue = raw.slice(vStart, i);
        i += 1;
      } else {
        const vStart = i;
        while (i < n && !UNQUOTED_STOP_RE.test(raw[i]!)) i += 1;
        avalue = raw.slice(vStart, i);
      }
    }
    attrs.push({ name: aname, value: avalue });
  }
  return err("unterminated tag");
}

interface CheckedAttrOk {
  ok: true;
  name: string;
  value: string;
}
type CheckedAttr = CheckedAttrOk | SanitizeSvgErr;

function checkAttr(name: string, rawValue: string): CheckedAttr {
  const lower = name.toLowerCase();
  // Event handlers (onload, onclick, onmouseover, ...) - never allowed.
  if (lower.startsWith("on")) {
    return err(`event-handler attribute is not allowed: ${name}`);
  }
  const decoded = decodeEntities(rawValue);
  if (CONTROL_CHAR_RE.test(decoded)) {
    return err(`control character in attribute: ${name}`);
  }
  // href / xlink:href - safe embedded raster only.
  if (lower === "href" || lower === "xlink:href") {
    if (SAFE_DATA_IMAGE_RE.test(decoded.trim())) {
      return { ok: true, name, value: escapeAttr(decoded.trim()) };
    }
    return err(`unsafe ${name} (only a data:image/png or data:image/jpeg value is permitted)`);
  }
  const allowed =
    ALLOWED_ATTRS_LC.has(lower) || lower.startsWith("aria-") || lower.startsWith("data-");
  if (!allowed) {
    return err(`disallowed attribute: ${name}`);
  }
  if (/javascript:/i.test(decoded)) {
    return err(`javascript: URI in attribute: ${name}`);
  }
  if (EXTERNAL_URL_REF_RE.test(decoded)) {
    return err(`external url() reference in attribute: ${name} (only local url(#id) is allowed)`);
  }
  return { ok: true, name, value: escapeAttr(decoded) };
}

function lastIndexOfLower(stack: string[], lower: string): number {
  for (let k = stack.length - 1; k >= 0; k -= 1) {
    if (stack[k]!.toLowerCase() === lower) return k;
  }
  return -1;
}

/**
 * Sanitize a raw SVG string against a strict allowlist and RE-SERIALIZE it.
 *
 * Returns { ok: true, svg } with a re-built SVG that contains only allowlisted
 * elements + attributes (comments / PIs stripped, an xmlns injected on the
 * root if absent), or { ok: false, reason } with a plain-language reason for
 * the first violation encountered.
 */
export function sanitizeSvg(raw: unknown): SanitizeSvgResult {
  if (typeof raw !== "string") return err("not a string");
  if (raw.trim() === "") return err("empty SVG");
  const byteLen = utf8ByteLength(raw);
  if (byteLen > SVG_MAX_BYTES) {
    return err(`SVG exceeds the ${Math.round(SVG_MAX_BYTES / 1024)}KB size limit`);
  }

  const n = raw.length;
  let i = 0;
  let out = "";
  let elementCount = 0;
  let rootSeen = false;
  const openStack: string[] = [];

  while (i < n) {
    const lt = raw.indexOf("<", i);
    if (lt === -1) {
      out += escapeText(raw.slice(i));
      break;
    }
    if (lt > i) {
      out += escapeText(raw.slice(i, lt));
    }
    if (raw.startsWith("<!--", lt)) {
      const end = raw.indexOf("-->", lt + 4);
      if (end === -1) return err("unterminated comment");
      i = end + 3; // strip the comment
      continue;
    }
    if (raw.startsWith("<!", lt)) {
      // DOCTYPE / ENTITY / CDATA / any SGML declaration - the XXE / entity-bomb
      // vector. Rejected outright (no logo needs one).
      return err("DOCTYPE or SGML declaration is not allowed");
    }
    if (raw.startsWith("<?", lt)) {
      const end = raw.indexOf("?>", lt + 2);
      if (end === -1) return err("unterminated processing instruction");
      i = end + 2; // strip the PI (incl. the <?xml ...?> declaration)
      continue;
    }
    if (raw.startsWith("</", lt)) {
      const gt = raw.indexOf(">", lt);
      if (gt === -1) return err("unterminated closing tag");
      const closeLower = raw.slice(lt + 2, gt).trim().toLowerCase();
      if (!ALLOWED_ELEMENTS_LC.has(closeLower)) {
        return err(`disallowed element: ${closeLower}`);
      }
      const idx = lastIndexOfLower(openStack, closeLower);
      const emitName = idx !== -1 ? openStack[idx]! : closeLower;
      out += `</${emitName}>`;
      if (idx !== -1) openStack.splice(idx, 1);
      i = gt + 1;
      continue;
    }

    const tag = parseTag(raw, lt);
    if (!tag.ok) return tag;
    if (!ALLOWED_ELEMENTS_LC.has(tag.nameLower)) {
      return err(`disallowed element: ${tag.nameLower}`);
    }
    if (!rootSeen) {
      if (tag.nameLower !== "svg") return err("root element must be <svg>");
      rootSeen = true;
    }
    elementCount += 1;
    if (elementCount > SVG_MAX_ELEMENTS) {
      return err(`SVG exceeds the ${SVG_MAX_ELEMENTS}-element limit`);
    }
    let attrStr = "";
    let hasXmlns = false;
    for (const a of tag.attrs) {
      const checked = checkAttr(a.name, a.value);
      if (!checked.ok) return checked;
      if (a.name.toLowerCase() === "xmlns") hasXmlns = true;
      attrStr += ` ${checked.name}="${checked.value}"`;
    }
    // A root <svg> with no xmlns won't render as a standalone image/svg+xml
    // document - inject the canonical namespace (a fixed, safe constant).
    if (tag.nameLower === "svg" && !hasXmlns) {
      attrStr = ` xmlns="http://www.w3.org/2000/svg"${attrStr}`;
    }
    out += `<${tag.name}${attrStr}${tag.selfClosing ? "/>" : ">"}`;
    if (!tag.selfClosing) openStack.push(tag.name);
    i = tag.nextIndex;
  }

  if (!rootSeen) return err("no <svg> root element found");
  return { ok: true, svg: out };
}

// ============================================================
// Shared upload gate — ONE sanitize-or-reject path for every route that may
// receive an SVG.
// ============================================================

export interface SvgUploadNotSvg {
  isSvg: false;
}
export interface SvgUploadAccepted {
  isSvg: true;
  ok: true;
  // Re-serialized (sanitized) bytes — NEVER the caller's original bytes.
  bytes: ArrayBuffer;
  mime: "image/svg+xml";
}
export interface SvgUploadRejected {
  isSvg: true;
  ok: false;
  reason: string;
}
export type SvgUploadOutcome = SvgUploadNotSvg | SvgUploadAccepted | SvgUploadRejected;

const SVG_MIME_TYPE = "image/svg+xml";

/**
 * The shared sanitize-or-reject gate for EVERY upload route that may receive
 * an SVG (B-2 10F). Detects an SVG-shaped upload (declared mime, OR an empty/
 * generic mime with a `.svg` filename fallback) and, if so, runs it through
 * `sanitizeSvg` and re-encodes the sanitized markup as bytes. A non-SVG
 * upload returns `{ isSvg: false }` so the caller's own raster/other
 * validation applies unchanged.
 *
 * BOTH admin/leadgen/assets-handlers.ts (the brand-logo endpoint) AND
 * admin/media-crud-handlers.ts (the generic media-library upload) call this
 * SAME function — one security boundary maintained once, not two
 * independently-drifting copies of it.
 */
export async function sanitizeSvgUpload(
  declaredMime: string,
  filename: string,
  readText: () => Promise<string>,
): Promise<SvgUploadOutcome> {
  const mime = typeof declaredMime === "string" ? declaredMime.toLowerCase().trim() : "";
  const isSvg = mime === SVG_MIME_TYPE || (mime === "" && /\.svg$/i.test(filename));
  if (!isSvg) return { isSvg: false };
  const raw = await readText();
  const result = sanitizeSvg(raw);
  if (!result.ok) return { isSvg: true, ok: false, reason: result.reason };
  return {
    isSvg: true,
    ok: true,
    bytes: new TextEncoder().encode(result.svg).buffer as ArrayBuffer,
    mime: SVG_MIME_TYPE,
  };
}
