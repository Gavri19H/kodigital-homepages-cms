// Round-4 P5a security fix (adversarial review MAJOR-1: STORED XSS) —
// hand-rolled ALLOWLIST inline-HTML re-serializer for the frame FREE-TEXT
// sink (designs/frame.ts frameInlineBody/frameInlineItem; designs/frames.ts
// validateFreeText).
//
// WHY a NEW sanitizer, not editor/sanitize.ts's sanitizeHtml: that module is
// a STRIP/BLOCKLIST sanitizer (enumerate DANGEROUS_TAGS to remove + a generic
// on* attribute regex) shared with the ARTICLES product — its exported
// behavior must not change for that consumer (touching it would be an
// undisclosed behavioral change to a shared module the mission's own rules
// forbid). The reviewer broke it live on the frame free-text sink with FIVE
// payloads that survive verbatim and execute on every visitor:
//   - <img src="x"onerror="alert(1)">   no space before on* — the blocklist's
//     stripEventHandlers regex requires `\s+on[a-z]+=`, so a quote-adjacent
//     onerror (no leading whitespace) slips through untouched.
//   - <img/onerror="alert(1)" src="x">  a '/' immediately before the
//     attribute name is (per real HTML5 tokenizing) just a separator, not a
//     self-close — same root gap as above, different spelling.
//   - <audio src="x"onerror="alert(1)"> `audio` isn't in DANGEROUS_TAGS at all
//     (an enumerated blocklist can only ever cover tags someone thought of).
//   - <iframe srcdoc="&amp;lt;script&amp;gt;...">  `iframe` isn't blocked;
//     `srcdoc` isn't a gated URL attribute; and the blocklist's entity
//     decoder is a SINGLE composed pass, so a DOUBLE-encoded payload (which a
//     srcdoc's own browser-side re-parse-as-HTML would reveal a SECOND time)
//     is never fully decoded before the (absent) srcdoc check would run.
//   - <iframe src="https://evil">  arbitrary embed / phishing — no tag or
//     attribute in the blocklist model gates this at all.
//
// STRATEGY (mirrors lib/svg-sanitizer.ts — the proven, already-shipped
// model): a SOUND, hand-rolled parser over a SMALL element/attribute
// ALLOWLIST. Parse the raw string; every construct is checked against the
// allowlist; the output is RE-SERIALIZED from what this module itself
// explicitly emits — never a copy/filter of the input. A strip/blocklist
// sanitizer can always miss an unlisted-bad construct (exactly what
// happened above); a re-serializer that only ever emits ALLOWLISTED
// elements/attributes cannot leak a construct it never built — `script`,
// `iframe`, `img`, `audio`, `onerror`, `srcdoc`, … simply never appear in the
// output, regardless of spelling, casing, spacing, or nesting depth.
//
// ALLOWLIST — the free-text authoring model (10E: bold/italic/link/lists;
// the AUTHOR only ever supplies INLINE content — the block-level <p>/<h2>/
// <ul>/<li> wrapper tags are built by designs/frame.ts's OWN renderer code,
// never sanitized from author input, so they are out of this module's
// concern entirely):
//   p, strong, b, em, i, a (href ONLY — every other attribute on every tag is
//   dropped), ul, ol, li, br (always void), span (forward coverage; unused
//   by the current renderer, kept per the allowlist spec).
// `a`'s href is the ONE attribute preserved anywhere, restricted to
// http(s)://absolute, root-relative /path, #fragment, tel:, mailto:
// (R2 P3 tail item 3 — the SAME SAFE_HREF_RE class designs/frames.ts already
// gates every other authored link against) after entities are decoded to a
// FIXPOINT (repeated decode-until-stable, not editor/sanitize.ts's single
// composed pass) — an href hidden behind nested/duplicated entity-encoding
// (the double-encoding class the iframe/srcdoc payload above exploited)
// cannot slip an unrecognized scheme past a single-decode check. Because the
// check is an ALLOWLIST (not "reject javascript:"), anything that decodes
// into something OTHER than exactly that class is rejected regardless —
// there is no enumerable blocklist to be incomplete.
//
// DISALLOWED elements (everything not in the set above, including every tag
// used in the five payloads) are DROPPED ENTIRELY: no opening delimiter, no
// attributes, no closing delimiter ever reach the output. Their own INNER
// text (if the input has a matching close tag) is walked normally as plain
// text and rendered inert — e.g. `<script>alert(1)</script>` becomes the
// harmless literal text "alert(1)", never an executing `<script>` element.
//
// PURE, never throws, ALWAYS returns a string — a drop-in replacement for
// sanitizeHtml at both of this sink's call sites (frame.ts's RENDER path and
// frames.ts's STORE-time validateFreeText, which runs this same function
// and OVERWRITES the authored html/items with its output before the caller
// persists — see frames.ts for why that mutation is sound: frame-handlers.ts
// PUT /funnels/:id/frame calls validateFrameConfig(raw) and THEN
// JSON.stringify(raw) to persist, so mutating fields reachable from `raw`
// during validation changes exactly what gets stored — "the raw string
// never persists"). Render-time re-invocation is deliberate defense-in-depth
// (any already-stored pre-fix data, or a future write path that bypasses
// validateFrameConfig, is still sanitized at the point it reaches a browser).

const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  "p",
  "strong",
  "b",
  "em",
  "i",
  "a",
  "ul",
  "ol",
  "li",
  "br",
  "span",
]);
const VOID_TAGS: ReadonlySet<string> = new Set(["br"]);

// href allowlist — http(s):// absolute, root-relative "/path" (the negative
// lookahead excludes protocol-relative "//host"), "#fragment", tel:, mailto:
// (no javascript:/data:/file:/anything else). R2 P3 tail (item 3): widened
// from scheme-only to match designs/frames.ts's own SAFE_HREF_RE class
// EXACTLY (the sibling free-text link gate every other footer/header href in
// this product is checked against) — a rich-text-authored relative link to a
// legal page (e.g. `<a href="/licenses">`) was being silently stripped down
// to a bare, non-navigable `<a>` before this widening; it now survives,
// still gated against javascript:/data:/protocol-relative //host. Checked
// against the FIXPOINT-DECODED value.
const SAFE_HREF_SCHEME_RE = /^(https?:\/\/|\/(?!\/)|#|tel:|mailto:)/i;

const NAME_START_RE = /[A-Za-z]/;
const NAME_CHAR_RE = /[A-Za-z0-9]/; // the allowlisted tag names are plain ascii
const WS_RE = /\s/;
const ATTR_NAME_STOP_RE = /[\s=/>]/;
const UNQUOTED_STOP_RE = /[\s>]/;

// Decode the small set of HTML entities an attacker can use to obfuscate a
// scheme/tag, REPEATEDLY (to a fixpoint) rather than a single composed pass —
// closes the double-encoding class (&amp;lt; -> &lt; -> <) a single-pass
// decoder (or a browser re-parse sink like srcdoc) can otherwise reveal a
// SECOND time, after a check already ran once against the once-decoded form.
//
// OWNER 2026-09-28 ("Renter&#39;s" on a results card): the same decoder also
// knows every HTML 4 named reference provider copy arrives with (&eacute;,
// &rsquo;, &reg;, …). None of them decodes to a markup character, so the
// markup-significant names in CASELESS_ENTITIES stay the only ones that ever
// could.
const ENTITY_RE = /&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]{1,31});/gi;

// Maps, not object literals: a name like `&constructor;` must miss, not
// read the prototype. Case-insensitive, as before: the markup-significant
// set + nbsp.
const CASELESS_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
]);

// Case-sensitive (HTML names are): the complete HTML 4.01 named character
// reference set (Latin-1, symbols/Greek, specials — 252 names, generated
// from the W3C list) minus the five names above; nbsp stays in the caseless
// set and keeps decoding to a plain space, as it always has. Each one
// is a printable character or a spacing/format mark; none is '<', '>', '"',
// '&' or '\''.
const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["iexcl", "\u{A1}"],
  ["cent", "\u{A2}"],
  ["pound", "\u{A3}"],
  ["curren", "\u{A4}"],
  ["yen", "\u{A5}"],
  ["brvbar", "\u{A6}"],
  ["sect", "\u{A7}"],
  ["uml", "\u{A8}"],
  ["copy", "\u{A9}"],
  ["ordf", "\u{AA}"],
  ["laquo", "\u{AB}"],
  ["not", "\u{AC}"],
  ["shy", "\u{AD}"],
  ["reg", "\u{AE}"],
  ["macr", "\u{AF}"],
  ["deg", "\u{B0}"],
  ["plusmn", "\u{B1}"],
  ["sup2", "\u{B2}"],
  ["sup3", "\u{B3}"],
  ["acute", "\u{B4}"],
  ["micro", "\u{B5}"],
  ["para", "\u{B6}"],
  ["middot", "\u{B7}"],
  ["cedil", "\u{B8}"],
  ["sup1", "\u{B9}"],
  ["ordm", "\u{BA}"],
  ["raquo", "\u{BB}"],
  ["frac14", "\u{BC}"],
  ["frac12", "\u{BD}"],
  ["frac34", "\u{BE}"],
  ["iquest", "\u{BF}"],
  ["Agrave", "\u{C0}"],
  ["Aacute", "\u{C1}"],
  ["Acirc", "\u{C2}"],
  ["Atilde", "\u{C3}"],
  ["Auml", "\u{C4}"],
  ["Aring", "\u{C5}"],
  ["AElig", "\u{C6}"],
  ["Ccedil", "\u{C7}"],
  ["Egrave", "\u{C8}"],
  ["Eacute", "\u{C9}"],
  ["Ecirc", "\u{CA}"],
  ["Euml", "\u{CB}"],
  ["Igrave", "\u{CC}"],
  ["Iacute", "\u{CD}"],
  ["Icirc", "\u{CE}"],
  ["Iuml", "\u{CF}"],
  ["ETH", "\u{D0}"],
  ["Ntilde", "\u{D1}"],
  ["Ograve", "\u{D2}"],
  ["Oacute", "\u{D3}"],
  ["Ocirc", "\u{D4}"],
  ["Otilde", "\u{D5}"],
  ["Ouml", "\u{D6}"],
  ["times", "\u{D7}"],
  ["Oslash", "\u{D8}"],
  ["Ugrave", "\u{D9}"],
  ["Uacute", "\u{DA}"],
  ["Ucirc", "\u{DB}"],
  ["Uuml", "\u{DC}"],
  ["Yacute", "\u{DD}"],
  ["THORN", "\u{DE}"],
  ["szlig", "\u{DF}"],
  ["agrave", "\u{E0}"],
  ["aacute", "\u{E1}"],
  ["acirc", "\u{E2}"],
  ["atilde", "\u{E3}"],
  ["auml", "\u{E4}"],
  ["aring", "\u{E5}"],
  ["aelig", "\u{E6}"],
  ["ccedil", "\u{E7}"],
  ["egrave", "\u{E8}"],
  ["eacute", "\u{E9}"],
  ["ecirc", "\u{EA}"],
  ["euml", "\u{EB}"],
  ["igrave", "\u{EC}"],
  ["iacute", "\u{ED}"],
  ["icirc", "\u{EE}"],
  ["iuml", "\u{EF}"],
  ["eth", "\u{F0}"],
  ["ntilde", "\u{F1}"],
  ["ograve", "\u{F2}"],
  ["oacute", "\u{F3}"],
  ["ocirc", "\u{F4}"],
  ["otilde", "\u{F5}"],
  ["ouml", "\u{F6}"],
  ["divide", "\u{F7}"],
  ["oslash", "\u{F8}"],
  ["ugrave", "\u{F9}"],
  ["uacute", "\u{FA}"],
  ["ucirc", "\u{FB}"],
  ["uuml", "\u{FC}"],
  ["yacute", "\u{FD}"],
  ["thorn", "\u{FE}"],
  ["yuml", "\u{FF}"],
  ["OElig", "\u{152}"],
  ["oelig", "\u{153}"],
  ["Scaron", "\u{160}"],
  ["scaron", "\u{161}"],
  ["Yuml", "\u{178}"],
  ["fnof", "\u{192}"],
  ["circ", "\u{2C6}"],
  ["tilde", "\u{2DC}"],
  ["Alpha", "\u{391}"],
  ["Beta", "\u{392}"],
  ["Gamma", "\u{393}"],
  ["Delta", "\u{394}"],
  ["Epsilon", "\u{395}"],
  ["Zeta", "\u{396}"],
  ["Eta", "\u{397}"],
  ["Theta", "\u{398}"],
  ["Iota", "\u{399}"],
  ["Kappa", "\u{39A}"],
  ["Lambda", "\u{39B}"],
  ["Mu", "\u{39C}"],
  ["Nu", "\u{39D}"],
  ["Xi", "\u{39E}"],
  ["Omicron", "\u{39F}"],
  ["Pi", "\u{3A0}"],
  ["Rho", "\u{3A1}"],
  ["Sigma", "\u{3A3}"],
  ["Tau", "\u{3A4}"],
  ["Upsilon", "\u{3A5}"],
  ["Phi", "\u{3A6}"],
  ["Chi", "\u{3A7}"],
  ["Psi", "\u{3A8}"],
  ["Omega", "\u{3A9}"],
  ["alpha", "\u{3B1}"],
  ["beta", "\u{3B2}"],
  ["gamma", "\u{3B3}"],
  ["delta", "\u{3B4}"],
  ["epsilon", "\u{3B5}"],
  ["zeta", "\u{3B6}"],
  ["eta", "\u{3B7}"],
  ["theta", "\u{3B8}"],
  ["iota", "\u{3B9}"],
  ["kappa", "\u{3BA}"],
  ["lambda", "\u{3BB}"],
  ["mu", "\u{3BC}"],
  ["nu", "\u{3BD}"],
  ["xi", "\u{3BE}"],
  ["omicron", "\u{3BF}"],
  ["pi", "\u{3C0}"],
  ["rho", "\u{3C1}"],
  ["sigmaf", "\u{3C2}"],
  ["sigma", "\u{3C3}"],
  ["tau", "\u{3C4}"],
  ["upsilon", "\u{3C5}"],
  ["phi", "\u{3C6}"],
  ["chi", "\u{3C7}"],
  ["psi", "\u{3C8}"],
  ["omega", "\u{3C9}"],
  ["thetasym", "\u{3D1}"],
  ["upsih", "\u{3D2}"],
  ["piv", "\u{3D6}"],
  ["ensp", "\u{2002}"],
  ["emsp", "\u{2003}"],
  ["thinsp", "\u{2009}"],
  ["zwnj", "\u{200C}"],
  ["zwj", "\u{200D}"],
  ["lrm", "\u{200E}"],
  ["rlm", "\u{200F}"],
  ["ndash", "\u{2013}"],
  ["mdash", "\u{2014}"],
  ["lsquo", "\u{2018}"],
  ["rsquo", "\u{2019}"],
  ["sbquo", "\u{201A}"],
  ["ldquo", "\u{201C}"],
  ["rdquo", "\u{201D}"],
  ["bdquo", "\u{201E}"],
  ["dagger", "\u{2020}"],
  ["Dagger", "\u{2021}"],
  ["bull", "\u{2022}"],
  ["hellip", "\u{2026}"],
  ["permil", "\u{2030}"],
  ["prime", "\u{2032}"],
  ["Prime", "\u{2033}"],
  ["lsaquo", "\u{2039}"],
  ["rsaquo", "\u{203A}"],
  ["oline", "\u{203E}"],
  ["frasl", "\u{2044}"],
  ["euro", "\u{20AC}"],
  ["image", "\u{2111}"],
  ["weierp", "\u{2118}"],
  ["real", "\u{211C}"],
  ["trade", "\u{2122}"],
  ["alefsym", "\u{2135}"],
  ["larr", "\u{2190}"],
  ["uarr", "\u{2191}"],
  ["rarr", "\u{2192}"],
  ["darr", "\u{2193}"],
  ["harr", "\u{2194}"],
  ["crarr", "\u{21B5}"],
  ["lArr", "\u{21D0}"],
  ["uArr", "\u{21D1}"],
  ["rArr", "\u{21D2}"],
  ["dArr", "\u{21D3}"],
  ["hArr", "\u{21D4}"],
  ["forall", "\u{2200}"],
  ["part", "\u{2202}"],
  ["exist", "\u{2203}"],
  ["empty", "\u{2205}"],
  ["nabla", "\u{2207}"],
  ["isin", "\u{2208}"],
  ["notin", "\u{2209}"],
  ["ni", "\u{220B}"],
  ["prod", "\u{220F}"],
  ["sum", "\u{2211}"],
  ["minus", "\u{2212}"],
  ["lowast", "\u{2217}"],
  ["radic", "\u{221A}"],
  ["prop", "\u{221D}"],
  ["infin", "\u{221E}"],
  ["ang", "\u{2220}"],
  ["and", "\u{2227}"],
  ["or", "\u{2228}"],
  ["cap", "\u{2229}"],
  ["cup", "\u{222A}"],
  ["int", "\u{222B}"],
  ["there4", "\u{2234}"],
  ["sim", "\u{223C}"],
  ["cong", "\u{2245}"],
  ["asymp", "\u{2248}"],
  ["ne", "\u{2260}"],
  ["equiv", "\u{2261}"],
  ["le", "\u{2264}"],
  ["ge", "\u{2265}"],
  ["sub", "\u{2282}"],
  ["sup", "\u{2283}"],
  ["nsub", "\u{2284}"],
  ["sube", "\u{2286}"],
  ["supe", "\u{2287}"],
  ["oplus", "\u{2295}"],
  ["otimes", "\u{2297}"],
  ["perp", "\u{22A5}"],
  ["sdot", "\u{22C5}"],
  ["lceil", "\u{2308}"],
  ["rceil", "\u{2309}"],
  ["lfloor", "\u{230A}"],
  ["rfloor", "\u{230B}"],
  ["lang", "\u{2329}"],
  ["rang", "\u{232A}"],
  ["loz", "\u{25CA}"],
  ["spades", "\u{2660}"],
  ["clubs", "\u{2663}"],
  ["hearts", "\u{2665}"],
  ["diams", "\u{2666}"],
]);

function codePoint(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return "";
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

function decodeEntitiesOnce(s: string): string {
  return s.replace(ENTITY_RE, (m, body: string) => {
    const b = (body as string).toLowerCase();
    if (b.startsWith("#x")) return codePoint(parseInt(b.slice(2), 16));
    if (b.startsWith("#")) return codePoint(parseInt(b.slice(1), 10));
    return NAMED_ENTITIES.get(body) ?? CASELESS_ENTITIES.get(b) ?? (m as string);
  });
}

// Display decode for PLAIN text that is about to be escaped again
// (auction/banner.ts card copy) — to the same fixpoint the rich path uses, so
// a double-encoded provider string ("Renter&amp;#39;s") reads the same in a
// headline as in a description. Safe because the caller escapes the result.
export function decodeHtmlEntities(s: string): string {
  return decodeEntitiesFixpoint(s);
}

// A generous bound — real payloads never nest encoding this deep; this only
// guards against a pathological adversarial loop, never trims a real input.
const MAX_DECODE_ITERATIONS = 8;

function decodeEntitiesFixpoint(s: string): string {
  let prev = s;
  for (let iter = 0; iter < MAX_DECODE_ITERATIONS; iter += 1) {
    const next = decodeEntitiesOnce(prev);
    if (next === prev) return next;
    prev = next;
  }
  return prev;
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
interface ParsedTag {
  nameLower: string;
  attrs: ParsedAttr[];
  selfClosing: boolean;
  nextIndex: number;
}

// Parse a single OPEN (or self-closing) tag beginning at `start` (the '<').
// Returns null when the construct does NOT parse as a well-formed tag (a
// stray '<' in prose, or an unterminated construct) — the caller then treats
// '<' as literal text (forgiving of casual authoring; NEVER silently accepts
// a malformed construct as a "safe" tag).
//
// HTML5-tolerant slash handling (the "slash-adjacent" payload's exact gap): a
// '/' immediately followed by (optional whitespace then) '>' is a self-close
// marker; a '/' ANYWHERE ELSE (e.g. <img/onerror=...>) is real browsers'
// documented tokenizer behavior — an attribute-boundary separator, not a
// terminator — so scanning continues and the NEXT attribute name (e.g.
// "onerror") is parsed normally. A parser that instead bails out on a
// malformed self-close (this module's model, lib/svg-sanitizer.ts, does
// exactly that — correct for an all-or-nothing SVG upload, wrong here) would
// misjudge the tag's own end boundary and risk leaking attribute text as
// separate content; treating it the way a real browser does keeps the
// boundary — and therefore what gets INCLUDED IN vs. DROPPED FROM the
// tag — always correct.
function parseTag(raw: string, start: number): ParsedTag | null {
  const n = raw.length;
  let i = start + 1;
  if (i >= n || !NAME_START_RE.test(raw[i]!)) return null;
  const nameStart = i;
  while (i < n && NAME_CHAR_RE.test(raw[i]!)) i += 1;
  const name = raw.slice(nameStart, i);
  const nameLower = name.toLowerCase();
  const attrs: ParsedAttr[] = [];
  while (i < n) {
    while (i < n && WS_RE.test(raw[i]!)) i += 1;
    if (i >= n) return null; // unterminated — caller falls back to literal text
    const ch = raw[i]!;
    if (ch === ">") {
      return { nameLower, attrs, selfClosing: false, nextIndex: i + 1 };
    }
    if (ch === "/") {
      let j = i + 1;
      while (j < n && WS_RE.test(raw[j]!)) j += 1;
      if (raw[j] === ">") {
        return { nameLower, attrs, selfClosing: true, nextIndex: j + 1 };
      }
      i += 1; // a lone '/' is a separator — keep scanning for the next attr
      continue;
    }
    const anStart = i;
    while (i < n && !ATTR_NAME_STOP_RE.test(raw[i]!)) i += 1;
    const aname = raw.slice(anStart, i);
    if (aname === "") return null; // defensive — the ch checks above make this unreachable
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
        if (i >= n) return null; // unterminated value — fail safe to literal text
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
  return null; // unterminated tag
}

function lastIndexOfLower(stack: string[], lower: string): number {
  for (let k = stack.length - 1; k >= 0; k -= 1) {
    if (stack[k] === lower) return k;
  }
  return -1;
}

/**
 * Sanitize AUTHOR-SUPPLIED inline HTML for the frame free-text sink (10E) —
 * an ALLOWLIST re-serializer: parse -> validate each tag/attr against the
 * allowlist -> RE-EMIT escaped. An element/attribute this module never
 * explicitly builds can NEVER appear in the output, regardless of how the
 * input spells, cases, or spaces it.
 */
export function sanitizeFrameInlineHtml(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return "";
  const n = raw.length;
  let i = 0;
  let out = "";
  const openStack: string[] = [];

  while (i < n) {
    const lt = raw.indexOf("<", i);
    if (lt === -1) {
      out += escapeText(decodeEntitiesFixpoint(raw.slice(i)));
      break;
    }
    if (lt > i) out += escapeText(decodeEntitiesFixpoint(raw.slice(i, lt)));

    if (raw.startsWith("<!--", lt)) {
      const end = raw.indexOf("-->", lt + 4);
      i = end === -1 ? n : end + 3; // strip the comment (or consume to EOF)
      continue;
    }
    if (raw.startsWith("<!", lt) || raw.startsWith("<?", lt)) {
      // DOCTYPE / CDATA / processing-instruction — never legitimate inline
      // authoring content; consume to the next '>' (or EOF), emit nothing.
      const end = raw.indexOf(">", lt);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (raw.startsWith("</", lt)) {
      const gt = raw.indexOf(">", lt);
      if (gt === -1) {
        out += escapeText(decodeEntitiesFixpoint(raw.slice(lt))); // unterminated -> literal text
        i = n;
        continue;
      }
      const closeLower = raw.slice(lt + 2, gt).trim().toLowerCase();
      if (ALLOWED_TAGS.has(closeLower) && !VOID_TAGS.has(closeLower)) {
        const idx = lastIndexOfLower(openStack, closeLower);
        if (idx !== -1) {
          // auto-close any intervening mismatched tags — never leaves a
          // dangling open tag whose matching close was skipped.
          for (let k = openStack.length - 1; k >= idx; k -= 1) out += `</${openStack[k]}>`;
          openStack.length = idx;
        }
        // a stray close with nothing open is silently dropped.
      }
      // a disallowed (or void) close tag is silently dropped — never emitted.
      i = gt + 1;
      continue;
    }

    const tag = parseTag(raw, lt);
    if (tag === null) {
      out += "&lt;"; // not a well-formed tag construct — the '<' is literal prose
      i = lt + 1;
      continue;
    }
    if (!ALLOWED_TAGS.has(tag.nameLower)) {
      // Disallowed element — DROP ENTIRELY. No output for its delimiters or
      // attributes (both consumed as part of computing tag.nextIndex); its
      // own inner text (if any, up to a later close tag) is walked normally
      // as plain content, so it renders as harmless text, never executable.
      i = tag.nextIndex;
      continue;
    }

    let openMarkup: string;
    if (tag.nameLower === "a") {
      const hrefAttr = tag.attrs.find((a) => a.name.toLowerCase() === "href");
      let hrefOut = "";
      if (hrefAttr !== undefined) {
        const decoded = decodeEntitiesFixpoint(hrefAttr.value).trim();
        if (SAFE_HREF_SCHEME_RE.test(decoded)) {
          hrefOut = ` href="${escapeAttr(decoded)}"`;
        }
        // an unsafe/unrecognized scheme -> the <a> renders with NO href
        // (inert, non-navigable text) rather than any fallback guess.
      }
      openMarkup = `<a${hrefOut}>`;
    } else {
      // every other allowed tag: NO attributes are ever preserved.
      openMarkup = `<${tag.nameLower}>`;
    }
    out += openMarkup;
    if (VOID_TAGS.has(tag.nameLower)) {
      // br: always void in the output, regardless of authored syntax; never
      // pushed to the open-tag stack (no matching close is ever expected).
    } else if (tag.selfClosing) {
      out += `</${tag.nameLower}>`; // explicitly self-closed -> immediately empty
    } else {
      openStack.push(tag.nameLower);
    }
    i = tag.nextIndex;
  }

  // Auto-close any tags still open at EOF — never leaves dangling markup
  // that could otherwise swallow whatever the caller concatenates next.
  for (let k = openStack.length - 1; k >= 0; k -= 1) out += `</${openStack[k]}>`;
  return out;
}
