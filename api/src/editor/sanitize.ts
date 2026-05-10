// Hand-rolled HTML sanitizer for editor html-block output and any other
// path that renders user-authored HTML. The hard rules (per past CMS XSS
// postmortems L-054 + L-070) are:
//
//   1. Strip null bytes FIRST, then decode HTML entities, BEFORE any
//      regex-based tag/attribute matching. Attackers use `&#106;avascript:`
//      and `\x00` mid-tag to evade naive regex sanitizers.
//   2. Drop a fixed set of DANGEROUS_TAGS (script, style, object, embed,
//      form, applet, base, link, meta, noscript, template) along with
//      their inner content. Removing only the tags but keeping inner
//      text leaves payloads intact.
//   3. Iterate the dangerous-tag stripping pass until the string stops
//      changing — a single pass is bypassable with reconstructed-tag
//      tricks like `<scrip<script></script>t>`.
//   4. Strip HTML comments (<!-- ... -->) before tag processing — they
//      can interact with browser parsing quirks.
//   5. Generic `on*` attribute prefix check (not an enumerated list) —
//      onclick, onmouseover, onerror, onanything-future.
//   6. URL allowlist for href/src protocols (http, https, mailto, tel,
//      relative paths). NEVER a blocklist (javascript:, data:, vbscript:
//      can't all be enumerated).
//   7. Case-insensitive matching at every stage.

const DANGEROUS_TAGS = [
  "script",
  "style",
  "object",
  "embed",
  "form",
  "applet",
  "base",
  "link",
  "meta",
  "noscript",
  "template",
];

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

// Decode HTML entities so attackers cannot smuggle `<` or `:` past the
// regex layer via `&lt;`, `&#60;`, or `&#x3c;`. Any malformed entity
// passes through untouched.
function decodeEntities(html: string): string {
  return html.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, body) => {
    const inner = body as string;
    if (inner.startsWith("#x") || inner.startsWith("#X")) {
      const code = parseInt(inner.slice(2), 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    if (inner.startsWith("#")) {
      const code = parseInt(inner.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    const named = NAMED_ENTITIES[inner.toLowerCase()];
    return named ?? match;
  });
}

function stripHtmlComments(html: string): string {
  // Match the comment opener through the closer, including malformed
  // unterminated comments that some browsers tolerate.
  return html.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
}

function stripDangerousTags(html: string): string {
  let prev = "";
  let current = html;
  // Iterate until the input stabilizes — defends against reconstructed
  // tag bypasses like `<scrip<script>...` where one strip pass leaves
  // a fresh dangerous tag behind.
  while (prev !== current) {
    prev = current;
    for (const tag of DANGEROUS_TAGS) {
      // Drop the tag AND its inner content.
      const paired = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
      current = current.replace(paired, "");
      // Drop self-closing / void variants (e.g., <link rel=...>).
      const standalone = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
      current = current.replace(standalone, "");
    }
  }
  return current;
}

function stripEventHandlers(html: string): string {
  // Generic `on*=value` attribute removal. Handles double-quoted,
  // single-quoted, and unquoted values. Case-insensitive.
  let out = html.replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, "");
  out = out.replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, "");
  out = out.replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, "");
  return out;
}

const URL_ATTRS = ["href", "src", "action", "formaction", "xlink:href"];
const SAFE_PROTOCOL_RE = /^(https?:|mailto:|tel:|\/|#|\?|[a-z0-9._-]+(?:\/|$))/i;

function stripUnsafeUrls(html: string): string {
  let out = html;
  for (const attr of URL_ATTRS) {
    const re = new RegExp(`(\\s${attr}\\s*=\\s*)("([^"]*)"|'([^']*)')`, "gi");
    out = out.replace(re, (match, prefix, _quoted, dq, sq) => {
      const value = (dq ?? sq ?? "").trim();
      if (value === "" || SAFE_PROTOCOL_RE.test(value)) return match;
      return "";
    });
  }
  return out;
}

export function sanitizeHtml(input: string): string {
  if (typeof input !== "string" || input.length === 0) return "";
  // 1. null byte strip — must be FIRST per L-070.
  let html = input.replace(/\x00/g, "");
  // 2. entity decode — must precede regex tag/attr matching per L-070.
  html = decodeEntities(html);
  // 3. comments out before tag processing per L-054.
  html = stripHtmlComments(html);
  // 4. iterative dangerous-tag stripping per L-054.
  html = stripDangerousTags(html);
  // 5. event handlers + unsafe URLs.
  html = stripEventHandlers(html);
  html = stripUnsafeUrls(html);
  return html;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  if (typeof text !== "string") return "";
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}
