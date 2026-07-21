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
// http(s)/tel/mailto after entities are decoded to a FIXPOINT (repeated
// decode-until-stable, not editor/sanitize.ts's single composed pass) — an
// href hidden behind nested/duplicated entity-encoding (the double-encoding
// class the iframe/srcdoc payload above exploited) cannot slip an
// unrecognized scheme past a single-decode check. Because the scheme check
// is an ALLOWLIST (not "reject javascript:"), a scheme that decodes into
// something OTHER than exactly http(s)/tel/mailto is rejected regardless —
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

// href scheme allowlist — ONLY http(s)/tel/mailto (no javascript:/data:/file:/
// anything else). Checked against the FIXPOINT-DECODED value.
const SAFE_HREF_SCHEME_RE = /^(https?:|tel:|mailto:)/i;

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
const ENTITY_RE = /&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/gi;

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
    switch (b) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      case "nbsp":
        return " ";
      default:
        return m as string;
    }
  });
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
