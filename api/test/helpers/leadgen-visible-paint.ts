// R2 P8 M2 / R3 — THE VISIBLE-PAINT PROBE.
//
// WHY THIS EXISTS. The dead-control guard's original predicate was "flipping
// the key changes the stylesheet/markup BYTES". That predicate is what let
// three MIS-TARGETED keys ship green: `card_defaults.border_role` did change
// bytes — on `.lg-card-panel`, a selector no driven funnel page renders;
// `card_defaults.radius` changed bytes on `.lg-frame-disclosure--modal
// .lg-disclosure-panel`, measured 0x0 and hidden; `scales.shadow` changed bytes
// on the same hidden panel and on an `::after` of a progress style the default
// template never emits. A byte diff is not a visitor seeing something.
//
// WHAT THIS MODULE COMPUTES INSTEAD. Given the REAL emitted stylesheet and the
// REAL rendered markup of one page, it resolves — by a faithful author-sheet
// cascade — the winning declaration set for EVERY element the markup actually
// contains, DROPS every element that resolves to display:none / visibility:
// hidden (itself or via any ancestor), and returns a canonical fingerprint of
// what is left. Two fingerprints differ iff something a visitor could see at
// rest differs. That is the predicate R3 demands.
//
// WHY A HAND CASCADE RESOLVER AND NOT getComputedStyle. The vitest environment
// is "node" (api/vitest.config.ts) and jsdom / happy-dom / linkedom are NOT
// installed (supply chain: no new deps). This is the same constraint and the
// same idiom leadgen-hidden-visibility.test.ts established (see its comment at
// :41) and that leadgen-p8-m2-theme-keys.test.ts generalised from `display` to
// an arbitrary property; this module generalises it once more, from one
// property on one hand-named element to EVERY property on EVERY rendered
// element, so no probe has to hand-name the selector it expects to move.
//
// ============================================================================
// WHAT A DIFFERING FINGERPRINT PROVES — AND WHAT IT DOES NOT (read this before
// you cite it as evidence).
// ============================================================================
//
// IT PROVES: the change lands in a declaration that WINS the cascade on an
// element the real renderer actually emitted, and that element is not switched
// off by display/visibility on itself or any ancestor. A rule for a selector
// nothing renders cannot register. A rule that a more specific / later rule
// out-ranks cannot register. A rule that only paints a hidden subtree cannot
// register.
//
// IT DOES NOT PROVE — AND CANNOT, BECAUSE THIS IS NOT A BROWSER:
//   • LAYOUT. No box is measured. A visible element that computes to 0px wide
//     (the P6 theme-editor panel defect), collapses, is clipped by an
//     ancestor's overflow, or is painted underneath a sibling by stacking
//     order, still counts as visible here.
//   • STATE AND GENERATED CONTENT. Every selector carrying a pseudo (`:hover`,
//     `:focus-visible`, `:disabled`, `:checked`, `:has()`, `::after`,
//     `::-webkit-slider-thumb`, …) is treated as NON-MATCHING. This is
//     deliberate and STRICT in the direction that matters: a key whose only
//     effect is on a hover state or a generated box is NOT credited as alive.
//     It also means such a rule is never counted as out-ranking a rule that is
//     credited — a known, bounded over-credit window.
//   • INHERITANCE and CASCADE LAYERS. Inherited properties are NOT propagated
//     to descendants (a colour set on a parent is recorded on the parent, which
//     is enough for a diff, but this is not a full computed style); the sheet
//     uses no @layer. `!important` and inline styles ARE ranked correctly —
//     author-!important over inline over author — because this sheet really
//     does ship !important rules that must beat an inline style (the frame's
//     progress role colour over the fill's inline gradient).
//   • ANYTHING THE RUNTIME DOES. This is server-render output only. A class
//     the client island adds later, a value the engine substitutes, and every
//     JS-driven show/hide are outside the frame of this measurement.
//   • THE ADMIN. Nothing here looks at the operator's editor. "The control is
//     offered" is asserted by the callers, not here.
//
// The live-browser half of every claim built on this module is the conductor's
// driven re-measurement (E6/E10), never this lane.

import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// 1. The rendered page, parsed into a real element tree.
// ---------------------------------------------------------------------------

const VOID_TAGS: ReadonlySet<string> = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

// Attributes a VISITOR perceives (the picture, the destination, the caption,
// the field's own copy). Everything else — data-*, id, role hooks — is machine
// plumbing and is deliberately NOT part of the fingerprint, so a key that only
// moves plumbing is not credited as painting.
const PERCEIVABLE_ATTRS: readonly string[] = [
  "alt",
  "aria-label",
  "href",
  "placeholder",
  "src",
  "title",
  "type",
  "value",
];

export interface ParsedEl {
  index: number;
  tag: string;
  classes: Set<string>;
  attrs: Map<string, string | null>;
  inline: Map<string, string>;
  /** Direct text-node children, whitespace-collapsed. */
  text: string;
  parent: number | null;
  /** Previous ELEMENT sibling (for `+`), or null. */
  prev: number | null;
  /** Ancestor chain, nearest first. */
  ancestors: number[];
}

// A served attribute/text node is ESCAPED. Decoding is not cosmetic here: an
// inline `style="font-family:&#39;Inter&#39;,…"` carries a `;` INSIDE the
// entity, so a declaration parser that reads the raw bytes splits the font
// stack apart and reports the same value for every font — which is exactly a
// silent false "this key is dead".
function decodeEntities(raw: string): string {
  return raw
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function parseDeclarations(body: string): Map<string, string> {
  const decls = new Map<string, string>();
  for (const d of body.split(";")) {
    const i = d.indexOf(":");
    if (i > 0) decls.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
  }
  return decls;
}

/**
 * Parse a served HTML fragment into a flat, parent-linked element list in
 * document order. Tolerant by design: an unmatched close tag pops to the
 * nearest match rather than throwing, so a renderer quirk degrades the tree
 * locally instead of blinding the whole probe.
 */
export function parseDom(html: string): ParsedEl[] {
  const els: ParsedEl[] = [];
  const stack: number[] = [];
  const lastChild = new Map<number | null, number>();
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)(\/?)>/g;
  let cursor = 0;
  for (const m of html.matchAll(tagRe)) {
    const at = m.index ?? 0;
    const between = html.slice(cursor, at);
    cursor = at + m[0].length;
    if (between.trim() !== "" && stack.length > 0) {
      const owner = els[stack[stack.length - 1] as number] as ParsedEl;
      owner.text = `${owner.text} ${decodeEntities(between).replace(/\s+/g, " ").trim()}`.trim();
    }
    const closing = m[1] === "/";
    const tag = (m[2] as string).toLowerCase();
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if ((els[stack[i] as number] as ParsedEl).tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const parent = stack.length > 0 ? (stack[stack.length - 1] as number) : null;
    const classes = new Set<string>();
    const attrs = new Map<string, string | null>();
    let inline = new Map<string, string>();
    for (const a of (m[3] as string).matchAll(/([a-zA-Z_:][\w:.-]*)(?:\s*=\s*"([^"]*)")?/g)) {
      const name = (a[1] as string).toLowerCase();
      const val = a[2] === undefined ? null : decodeEntities(a[2]);
      if (name === "class" && val !== null) {
        for (const c of val.split(/\s+/)) if (c !== "") classes.add(c);
      } else if (name === "style" && val !== null) {
        inline = parseDeclarations(val);
        attrs.set("style", val);
      } else {
        attrs.set(name, val);
      }
    }
    const index = els.length;
    const el: ParsedEl = {
      index,
      tag,
      classes,
      attrs,
      inline,
      text: "",
      parent,
      prev: lastChild.get(parent) ?? null,
      ancestors: parent === null ? [] : [parent, ...(els[parent] as ParsedEl).ancestors],
    };
    lastChild.set(parent, index);
    els.push(el);
    if (!VOID_TAGS.has(tag) && m[4] !== "/") stack.push(index);
  }
  return els;
}

// ---------------------------------------------------------------------------
// 2. The stylesheet, split into the rule lists a given viewport applies.
//
// funnelChromeCss emits ONE rule PER LINE (its out.filter().join("\n")) with
// the sole `@media (max-width: 480px)` block LAST; the `@container` and
// `@keyframes` blocks are each a single self-contained line that parseRule
// rejects on its leading `@`.
// ---------------------------------------------------------------------------

export type Viewport = "desktop" | "mobile";

export interface Rule {
  selectors: string[];
  decls: Map<string, string>;
}

function parseRule(line: string): Rule | null {
  const t = line.trim();
  if (t === "" || t.startsWith("@")) return null;
  const m = t.match(/^(.+?)\{(.*)\}$/);
  if (m === null) return null;
  return {
    selectors: (m[1] as string).split(",").map((s) => s.trim()),
    decls: parseDeclarations(m[2] as string),
  };
}

/** The ordered rule list a viewport applies (media rules append after base). */
export function rulesFor(css: string, viewport: Viewport): Rule[] {
  const mediaStart = css.indexOf("\n@media");
  const base = mediaStart >= 0 ? css.slice(0, mediaStart) : css;
  const lines = base.split("\n");
  if (viewport === "mobile" && mediaStart >= 0) {
    const block = css.slice(mediaStart);
    const open = block.indexOf("{");
    lines.push(...block.slice(open + 1, block.lastIndexOf("}")).split("\n"));
  }
  const out: Rule[] = [];
  for (const line of lines) {
    const r = parseRule(line);
    if (r !== null) out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. Selector matching against the parsed tree.
//
// Supported: type / .class / [attr] / [attr="v"] / [attr~="v"] / * compounds,
// joined by descendant, `>` and `+`. A selector containing ANY pseudo is
// rejected outright (see the limitations banner at the top of this file).
// ---------------------------------------------------------------------------

export type Spec = [number, number, number]; // [id, class+attr, type]

/** Specificity contributed by ONE compound IF it matches `el`, else null. Pure. */
function matchCompound(compound: string, el: ParsedEl): Spec | null {
  const spec: Spec = [0, 0, 0];
  let pos = 0;
  if (compound === "*") return spec;
  if (compound.startsWith("*")) {
    pos = 1;
  } else if (!compound.startsWith(".") && !compound.startsWith("[") && !compound.startsWith("#")) {
    const typeM = compound.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
    if (typeM === null) return null;
    if (el.tag !== typeM[0].toLowerCase()) return null;
    spec[2] += 1;
    pos = typeM[0].length;
  }
  while (pos < compound.length) {
    const tok = compound
      .slice(pos)
      .match(/^(?:\.([A-Za-z0-9_-]+)|#([A-Za-z0-9_-]+)|\[([A-Za-z0-9_:.-]+)(?:([~|^$*]?=)"([^"]*)")?\])/);
    if (tok === null) return null;
    pos += tok[0].length;
    if (tok[1] !== undefined) {
      if (!el.classes.has(tok[1])) return null;
      spec[1] += 1;
    } else if (tok[2] !== undefined) {
      if (el.attrs.get("id") !== tok[2]) return null;
      spec[0] += 1;
    } else {
      const name = (tok[3] as string).toLowerCase();
      const have = name === "class" ? [...el.classes].join(" ") : el.attrs.get(name);
      if (have === undefined) return null;
      if (tok[4] === "=" && have !== tok[5]) return null;
      if (tok[4] === "~=" && !String(have ?? "").split(/\s+/).includes(tok[5] as string)) return null;
      spec[1] += 1;
    }
  }
  return spec;
}

/** Split a complex selector into [combinator, compound] steps, left to right. */
function selectorSteps(selector: string): Array<{ combinator: " " | ">" | "+"; compound: string }> | null {
  const steps: Array<{ combinator: " " | ">" | "+"; compound: string }> = [];
  let combinator: " " | ">" | "+" = " ";
  let buf = "";
  let inBracket = false;
  const flush = (): void => {
    if (buf !== "") {
      steps.push({ combinator, compound: buf });
      buf = "";
    }
  };
  for (const ch of selector) {
    if (ch === "[") inBracket = true;
    if (ch === "]") inBracket = false;
    if (!inBracket && (ch === " " || ch === ">" || ch === "+" || ch === "~")) {
      if (ch === "~") return null; // general sibling: not emitted by this sheet
      if (buf !== "") {
        flush();
        combinator = " ";
      }
      if (ch !== " ") combinator = ch;
      continue;
    }
    buf += ch;
  }
  flush();
  return steps.length === 0 ? null : steps;
}

/**
 * Specificity of `selector` IF it matches `el` in `els`, else null.
 * Right-to-left evaluation, exactly as a selector engine does it.
 */
export function specIfMatches(selector: string, el: ParsedEl, els: ParsedEl[]): Spec | null {
  if (selector.includes(":")) return null; // pseudo — see the limitations banner
  const steps = selectorSteps(selector);
  if (steps === null) return null;
  // Right-to-left, accumulating specificity only along a path that matches.
  const walk = (stepIdx: number, candidate: ParsedEl): Spec | null => {
    const step = steps[stepIdx] as { combinator: " " | ">" | "+"; compound: string };
    const here = matchCompound(step.compound, candidate);
    if (here === null) return null;
    if (stepIdx === 0) return here;
    const add = (rest: Spec | null): Spec | null =>
      rest === null ? null : [here[0] + rest[0], here[1] + rest[1], here[2] + rest[2]];
    if (step.combinator === ">") {
      return candidate.parent === null ? null : add(walk(stepIdx - 1, els[candidate.parent] as ParsedEl));
    }
    if (step.combinator === "+") {
      return candidate.prev === null ? null : add(walk(stepIdx - 1, els[candidate.prev] as ParsedEl));
    }
    for (const anc of candidate.ancestors) {
      const rest = walk(stepIdx - 1, els[anc] as ParsedEl);
      if (rest !== null) return add(rest);
    }
    return null;
  };
  return walk(steps.length - 1, el);
}

// ---------------------------------------------------------------------------
// 4. The cascade, then visibility, then the fingerprint.
// ---------------------------------------------------------------------------

// CSS origin/importance order, low to high: author rule < inline style <
// author `!important` < inline `!important`. The sheet DOES ship `!important`
// author rules that are meant to beat an inline style (the frame's progress
// role colour beats the fill's inline gradient), so this cannot be collapsed.
const WEIGHT_RULE = 0;
const WEIGHT_INLINE = 1;
const WEIGHT_RULE_IMPORTANT = 2;
const WEIGHT_INLINE_IMPORTANT = 3;

function splitImportant(value: string): { value: string; important: boolean } {
  const m = value.match(/^(.*?)\s*!\s*important\s*$/i);
  return m === null ? { value, important: false } : { value: (m[1] as string).trim(), important: true };
}

function better(a: Spec, oA: number, wA: number, b: Spec, oB: number, wB: number): boolean {
  if (wA !== wB) return wA > wB;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return (a[i] as number) > (b[i] as number);
  }
  return oA > oB; // later source order wins the tie
}

/** Every property that wins on `el`, with the selector that won it. */
export function computedStyle(
  rules: Rule[],
  el: ParsedEl,
  els: ParsedEl[],
): Map<string, { value: string; selector: string }> {
  const best = new Map<string, { value: string; selector: string; spec: Spec; order: number; weight: number }>();
  const offer = (prop: string, raw: string, selector: string, spec: Spec, order: number, inline: boolean): void => {
    const { value, important } = splitImportant(raw);
    const weight = important
      ? inline
        ? WEIGHT_INLINE_IMPORTANT
        : WEIGHT_RULE_IMPORTANT
      : inline
        ? WEIGHT_INLINE
        : WEIGHT_RULE;
    const cur = best.get(prop);
    if (cur === undefined || better(spec, order, weight, cur.spec, cur.order, cur.weight)) {
      best.set(prop, { value, selector, spec, order, weight });
    }
  };
  for (let order = 0; order < rules.length; order++) {
    const rule = rules[order] as Rule;
    for (const sel of rule.selectors) {
      const spec = specIfMatches(sel, el, els);
      if (spec === null) continue;
      for (const [prop, value] of rule.decls) offer(prop, value, sel, spec, order, false);
    }
  }
  for (const [prop, value] of el.inline) offer(prop, value, "style=", [1, 0, 0], 1e9, true);
  const out = new Map<string, { value: string; selector: string }>();
  for (const [prop, win] of best) out.set(prop, { value: win.value, selector: win.selector });
  return out;
}

// ---------------------------------------------------------------------------
// 4b. Custom properties are HANDLES, not paint.
//
// funnelChromeCss publishes the resolved palette as `--lg-role-*` / `--lg-*`
// custom properties on the scope root AND separately writes literal values into
// the rules that paint. A key that only moved a custom property nothing reads
// has moved NOTHING a visitor can see — crediting it would rebuild the exact
// false green this predicate exists to kill (measured: `palette.text_muted`,
// `palette.brand_secondary` and `palette.button_secondary_bg` move ONLY a
// `--lg-role-*` declaration on the root). So: custom properties are resolved
// and INHERITED down the tree, substituted into every `var()` that reads them,
// and then dropped from the fingerprint. A role that is read paints; a role
// that is only published does not.
// ---------------------------------------------------------------------------

function substituteVars(value: string, env: ReadonlyMap<string, string>, depth = 0): string {
  if (depth > 8 || !value.includes("var(")) return value;
  let out = "";
  let i = 0;
  while (i < value.length) {
    const at = value.indexOf("var(", i);
    if (at < 0) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, at);
    let level = 0;
    let end = at + 3;
    for (; end < value.length; end++) {
      if (value[end] === "(") level += 1;
      else if (value[end] === ")") {
        level -= 1;
        if (level === 0) break;
      }
    }
    const inner = value.slice(at + 4, end);
    const comma = inner.indexOf(",");
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma < 0 ? undefined : inner.slice(comma + 1).trim();
    const resolved = env.get(name) ?? fallback;
    out += resolved === undefined ? `var(${inner})` : substituteVars(resolved, env, depth + 1);
    i = end + 1;
  }
  return out;
}

export interface PaintedEl {
  /** Structural path, e.g. "0/2/1" — stable across a value flip. */
  path: string;
  tag: string;
  classes: string[];
  style: Map<string, { value: string; selector: string }>;
  text: string;
  attrs: Array<[string, string]>;
  /** The parsed element itself, so a caller can re-run selector matching on it. */
  el: ParsedEl;
}

export interface VisiblePage {
  /** Only the elements a visitor could see at rest, in document order. */
  visible: PaintedEl[];
  /** Elements dropped as display:none / visibility:hidden (self or ancestor). */
  hiddenPaths: string[];
  fingerprint: string;
  /** The whole parsed tree (selector matching needs the ancestor/sibling links). */
  els: ParsedEl[];
}

function pathOf(el: ParsedEl, els: ParsedEl[]): string {
  const parts: string[] = [];
  let cur: ParsedEl | undefined = el;
  while (cur !== undefined) {
    let n = 0;
    let sib = cur.prev;
    while (sib !== null) {
      n += 1;
      sib = (els[sib] as ParsedEl).prev;
    }
    parts.unshift(String(n));
    cur = cur.parent === null ? undefined : (els[cur.parent] as ParsedEl);
  }
  return parts.join("/");
}

/**
 * Resolve one page (real sheet + real markup) into the set of things a visitor
 * could see at rest, plus a canonical fingerprint of that set.
 */
export function visiblePage(css: string, html: string, viewport: Viewport = "desktop"): VisiblePage {
  const els = parseDom(html);
  const rules = rulesFor(css, viewport);
  const raw = els.map((el) => computedStyle(rules, el, els));
  // Custom properties inherit; document order guarantees parent-before-child.
  const envs: Array<Map<string, string>> = [];
  const styles: Array<Map<string, { value: string; selector: string }>> = [];
  for (const el of els) {
    const parentEnv = el.parent === null ? new Map<string, string>() : (envs[el.parent] as Map<string, string>);
    const env = new Map(parentEnv);
    const own = raw[el.index] as Map<string, { value: string; selector: string }>;
    for (const [prop, win] of own) {
      if (prop.startsWith("--")) env.set(prop, substituteVars(win.value, parentEnv));
    }
    envs.push(env);
    const painted = new Map<string, { value: string; selector: string }>();
    for (const [prop, win] of own) {
      if (prop.startsWith("--")) continue; // a handle, never paint (see 4b)
      painted.set(prop, { value: substituteVars(win.value, env), selector: win.selector });
    }
    styles.push(painted);
  }
  const selfHidden = styles.map(
    (s) => s.get("display")?.value === "none" || s.get("visibility")?.value === "hidden",
  );
  const visible: PaintedEl[] = [];
  const hiddenPaths: string[] = [];
  for (const el of els) {
    const path = pathOf(el, els);
    const hidden = selfHidden[el.index] === true || el.ancestors.some((a) => selfHidden[a] === true);
    if (hidden) {
      hiddenPaths.push(path);
      continue;
    }
    visible.push({
      path,
      tag: el.tag,
      classes: [...el.classes].sort(),
      style: styles[el.index] as Map<string, { value: string; selector: string }>,
      text: el.text,
      attrs: PERCEIVABLE_ATTRS.flatMap((a): Array<[string, string]> => {
        const v = el.attrs.get(a);
        return v === undefined || v === null ? [] : [[a, v]];
      }),
      el,
    });
  }
  const fingerprint = visible
    .map((v) => {
      const decls = [...v.style.entries()]
        .map(([p, w]) => `${p}:${w.value}`)
        .sort()
        .join(";");
      const attrs = v.attrs.map(([k, val]) => `${k}=${val}`).join(",");
      return `${v.path}|${v.tag}.${v.classes.join(".")}|${decls}|${attrs}|${v.text}`;
    })
    .join("\n");
  return { visible, hiddenPaths, fingerprint, els };
}

/**
 * ONE visitor-facing coordinate that moved between two renders of the SAME
 * page shape — the element it moved ON, not just its structural path.
 *
 * `prop` is a CSS property name, or one of the pseudo-properties
 * `<text>` / `<attrs>` / `<classes>` / `<element appeared|disappeared>`.
 * `el` is the element on whichever side of the diff it exists (an element that
 * appeared exists only on side b), together with `els`, its own tree — both are
 * what `specIfMatches` needs to answer "is this the element the control's
 * operator-facing label names?".
 */
export interface DiffCoord {
  viewport: Viewport;
  path: string;
  prop: string;
  tag: string;
  classes: string[];
  el: ParsedEl;
  els: ParsedEl[];
}

/** `"0/2/1|background"` — the string form `visibleDiff` has always returned. */
export function coordKey(c: DiffCoord): string {
  return `${c.path}|${c.prop}`;
}

/** `"@mobile div.lg-question-card [0/2/1] background"` — for a failure message. */
export function describeCoord(c: DiffCoord): string {
  const where = c.classes.length === 0 ? c.tag : `${c.tag}.${c.classes.join(".")}`;
  return `${c.viewport === "mobile" ? "@mobile " : ""}${where} [${c.path}] ${c.prop}`;
}

/**
 * The visible-paint diff between two renders of the SAME page shape, as
 * coordinates that still carry their element. `visibleDiff` is this function's
 * string projection — the two can never disagree.
 */
export function visibleDiffCoords(
  a: { css: string; html: string },
  b: { css: string; html: string },
  viewport: Viewport = "desktop",
): DiffCoord[] {
  const pa = visiblePage(a.css, a.html, viewport);
  const pb = visiblePage(b.css, b.html, viewport);
  const byPath = (p: VisiblePage): Map<string, PaintedEl> => new Map(p.visible.map((v) => [v.path, v]));
  const ma = byPath(pa);
  const mb = byPath(pb);
  const out: DiffCoord[] = [];
  for (const path of new Set([...ma.keys(), ...mb.keys()])) {
    const ea = ma.get(path);
    const eb = mb.get(path);
    const side = (ea ?? eb) as PaintedEl;
    const els = ea === undefined ? pb.els : pa.els;
    const at = (prop: string): DiffCoord => ({
      viewport,
      path,
      prop,
      tag: side.tag,
      classes: side.classes,
      el: side.el,
      els,
    });
    if (ea === undefined || eb === undefined) {
      out.push(at(`<element ${ea === undefined ? "appeared" : "disappeared"}>`));
      continue;
    }
    if (ea.text !== eb.text) out.push(at("<text>"));
    if (JSON.stringify(ea.attrs) !== JSON.stringify(eb.attrs)) out.push(at("<attrs>"));
    if (ea.classes.join(".") !== eb.classes.join(".")) out.push(at("<classes>"));
    for (const prop of new Set([...ea.style.keys(), ...eb.style.keys()])) {
      if (ea.style.get(prop)?.value !== eb.style.get(prop)?.value) out.push(at(prop));
    }
  }
  return out.sort((x, y) => (coordKey(x) < coordKey(y) ? -1 : coordKey(x) > coordKey(y) ? 1 : 0));
}

/**
 * The visible-paint diff between two renders of the SAME page shape: the list
 * of "path|property" coordinates whose visitor-facing value moved. EMPTY means
 * the flip changed nothing a visitor could see — the dead/mis-targeted class.
 */
export function visibleDiff(
  a: { css: string; html: string },
  b: { css: string; html: string },
  viewport: Viewport = "desktop",
): string[] {
  return visibleDiffCoords(a, b, viewport).map(coordKey);
}

/** Diff across BOTH viewports — a mobile-only key is alive too. */
export function visibleDiffAnyViewport(
  a: { css: string; html: string },
  b: { css: string; html: string },
): string[] {
  return [...visibleDiff(a, b, "desktop"), ...visibleDiff(a, b, "mobile").map((d) => `@mobile ${d}`)];
}

/** Coordinates across BOTH viewports (the `visibleDiffAnyViewport` universe). */
export function visibleDiffCoordsAnyViewport(
  a: { css: string; html: string },
  b: { css: string; html: string },
): DiffCoord[] {
  return [...visibleDiffCoords(a, b, "desktop"), ...visibleDiffCoords(a, b, "mobile")];
}

/**
 * Split a visible diff by WHERE it landed: coordinates on an element one of
 * `targetSelectors` matches, and coordinates on every other element.
 *
 * This is the machinery behind "a key must paint the element its own label
 * names, and nothing else": `onTarget` empty ⇒ the control does not reach the
 * surface it advertises; `offTarget` non-empty ⇒ it reaches a surface it does
 * not advertise (the MIS-TARGET class). A target selector carrying a pseudo can
 * never match (see the limitations banner) — callers must not pass one.
 */
export function classifyDiffByTarget(
  a: { css: string; html: string },
  b: { css: string; html: string },
  targetSelectors: readonly string[],
): { onTarget: DiffCoord[]; offTarget: DiffCoord[] } {
  const onTarget: DiffCoord[] = [];
  const offTarget: DiffCoord[] = [];
  for (const coord of visibleDiffCoordsAnyViewport(a, b)) {
    const hit = targetSelectors.some((sel) => specIfMatches(sel, coord.el, coord.els) !== null);
    (hit ? onTarget : offTarget).push(coord);
  }
  return { onTarget, offTarget };
}

/**
 * BOTH viewports' fingerprints for one page, as one string.
 *
 * The sweep compares N renders of the same page shape; resolving each render
 * ONCE and comparing strings is the same predicate as visibleDiffAnyViewport
 * (that function's output is empty exactly when these strings are equal) at a
 * fraction of the work — the diff is only needed when a leg wants to NAME the
 * coordinates that moved.
 */
export function visibleFingerprint(page: { css: string; html: string }): string {
  return `${visiblePage(page.css, page.html, "desktop").fingerprint}\n@mobile\n${
    visiblePage(page.css, page.html, "mobile").fingerprint
  }`;
}

// ---------------------------------------------------------------------------
// 5. Source-derived key enumeration.
//
// The key universe is NEVER typed into a test. It is read out of the declaring
// TypeScript interfaces, and each key's probe values are read out of the REAL
// exported constant its declared type names. Add a key to an interface and the
// probe demands it paint; add a key with no resolvable vocabulary and the probe
// throws rather than skipping it.
// ---------------------------------------------------------------------------

export interface DeclaredField {
  name: string;
  typeText: string;
  optional: boolean;
}

export function declaredFields(fileAbsPath: string, interfaceName: string): DeclaredField[] {
  const src = readFileSync(fileAbsPath, "utf8");
  const open = src.indexOf(`export interface ${interfaceName} {`);
  if (open < 0) throw new Error(`interface ${interfaceName} not found in ${fileAbsPath}`);
  const bodyStart = src.indexOf("{", open) + 1;
  const bodyEnd = src.indexOf("\n}", bodyStart);
  if (bodyEnd <= bodyStart) throw new Error(`interface ${interfaceName} does not close in ${fileAbsPath}`);
  const out: DeclaredField[] = [];
  for (const rawLine of src.slice(bodyStart, bodyEnd).split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)(\??)\s*:\s*(.+?);?$/);
    if (m === null) continue;
    out.push({
      name: m[1] as string,
      optional: m[2] === "?",
      typeText: (m[3] as string).replace(/;.*$/, "").trim(),
    });
  }
  return out;
}

/** `export type Alias = <rhs>;` — one hop of the type-alias chain. */
export function typeAliasRhs(fileAbsPath: string, alias: string): string | null {
  const src = readFileSync(fileAbsPath, "utf8");
  const m = src.match(new RegExp(`^export type ${alias} =\\s*([^;]+);`, "m"));
  return m === null ? null : (m[1] as string).trim();
}

/**
 * Resolve a declared field type to the closed list of values a probe should
 * drive it with. Walks `(typeof CONST)[number]` to the REAL exported array,
 * follows named aliases through their own declarations, and understands inline
 * string-literal unions, `boolean` and `number`. Returns null only for a genuinely
 * open type (a free string), which the caller must then decide about explicitly.
 */
export function vocabularyOf(
  typeText: string,
  files: ReadonlyArray<{ path: string; mod: Record<string, unknown> }>,
  seen: Set<string> = new Set(),
): readonly unknown[] | null {
  const t = typeText.replace(/\s*\|\s*(null|undefined)\b/g, "").trim();
  const viaTypeof = t.match(/^\(typeof\s+([A-Za-z_][A-Za-z0-9_]*)\)\[number\]$/);
  if (viaTypeof !== null) {
    const name = viaTypeof[1] as string;
    for (const f of files) {
      const value = f.mod[name];
      if (Array.isArray(value)) return value as readonly unknown[];
    }
    throw new Error(`"${name}" is named by a declared type but is not an exported array on any probed module`);
  }
  if (/^".*"(\s*\|\s*".*")*$/.test(t)) {
    return t.split("|").map((s) => s.trim().slice(1, -1));
  }
  if (t === "boolean") return [false, true];
  if (t === "number") return [14, 20];
  if (t === "string") return null;
  const named = t.match(/^[A-Za-z_][A-Za-z0-9_]*$/);
  if (named !== null && !seen.has(t)) {
    seen.add(t);
    for (const f of files) {
      const rhs = typeAliasRhs(f.path, t);
      if (rhs !== null) return vocabularyOf(rhs, files, seen);
    }
  }
  return null;
}
