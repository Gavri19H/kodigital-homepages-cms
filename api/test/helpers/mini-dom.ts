// A small DOM for running an admin page's own inline (ES5) script against the
// page's REAL server-rendered HTML in node:vm. jsdom / happy-dom are not
// installed (no-new-deps), so this covers just what the admin islands use:
// a tolerant HTML parser (tags, attributes, text, comments, raw <script> /
// <style>, <template> content), simple CSS selectors (tag, #id, .class,
// [attr], [attr="v"], compounds and descendant chains), form values
// (input / select / textarea / checkbox), `hidden`, bubbling events, and the
// few element methods the scripts call (closest, focus, scrollIntoView,
// cloneNode, importNode).

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "textarea"]);

function decode(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

type Listener = (ev: MiniEvent) => void;

export interface MiniEvent {
  type: string;
  target: MiniNode;
  key?: string;
  defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

export class MiniNode {
  nodeType: number;
  tagName: string;
  attrs = new Map<string, string>();
  childNodes: MiniNode[] = [];
  parentNode: MiniNode | null = null;
  text = "";
  listeners = new Map<string, Listener[]>();
  content: MiniNode | null = null; // <template>
  focused = false;
  scrolled = false;
  style: Record<string, string> = {};
  private valueProp: string | null = null;
  private checkedProp: boolean | null = null;
  disabled = false;

  constructor(tag: string, nodeType = 1) {
    this.tagName = tag.toUpperCase();
    this.nodeType = nodeType;
    if (this.tagName === "TEMPLATE") this.content = new MiniNode("#fragment", 11);
  }

  // --- attributes -----------------------------------------------------------
  getAttribute(n: string): string | null {
    return this.attrs.has(n) ? (this.attrs.get(n) as string) : null;
  }
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, String(v));
    if (n === "disabled") this.disabled = true;
  }
  removeAttribute(n: string): void {
    this.attrs.delete(n);
    if (n === "disabled") this.disabled = false;
  }
  hasAttribute(n: string): boolean {
    return this.attrs.has(n);
  }
  get id(): string {
    return this.getAttribute("id") ?? "";
  }
  get className(): string {
    return this.getAttribute("class") ?? "";
  }
  set className(v: string) {
    this.setAttribute("class", v);
  }
  get classList(): { add(c: string): void; remove(c: string): void; contains(c: string): boolean } {
    const self = this;
    const list = (): string[] => self.className.split(/\s+/).filter(Boolean);
    return {
      add(c: string) { const l = list(); if (!l.includes(c)) self.className = [...l, c].join(" "); },
      remove(c: string) { self.className = list().filter((x) => x !== c).join(" "); },
      contains(c: string) { return list().includes(c); },
    };
  }
  get hidden(): boolean {
    return this.hasAttribute("hidden");
  }
  set hidden(on: boolean) {
    if (on) this.setAttribute("hidden", "");
    else this.removeAttribute("hidden");
  }

  // --- tree -----------------------------------------------------------------
  get children(): MiniNode[] {
    return this.childNodes.filter((c) => c.nodeType === 1);
  }
  get firstChild(): MiniNode | null {
    return this.childNodes[0] ?? null;
  }
  appendChild(child: MiniNode): MiniNode {
    if (child.nodeType === 11) {
      for (const c of [...child.childNodes]) this.appendChild(c);
      return child;
    }
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  removeChild(child: MiniNode): MiniNode {
    this.childNodes = this.childNodes.filter((c) => c !== child);
    child.parentNode = null;
    return child;
  }
  get textContent(): string {
    if (this.nodeType === 3) return this.text;
    return this.childNodes.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (v !== "") {
      const t = new MiniNode("#text", 3);
      t.text = String(v);
      this.appendChild(t);
    }
  }
  cloneNode(deep = false): MiniNode {
    const copy = new MiniNode(this.tagName, this.nodeType);
    copy.text = this.text;
    for (const [k, v] of this.attrs) copy.attrs.set(k, v);
    if (deep) {
      for (const c of this.childNodes) copy.appendChild(c.cloneNode(true));
      if (this.content && copy.content) for (const c of this.content.childNodes) copy.content.appendChild(c.cloneNode(true));
    }
    return copy;
  }
  all(): MiniNode[] {
    const out: MiniNode[] = [];
    const walk = (n: MiniNode): void => {
      for (const c of n.childNodes) {
        if (c.nodeType !== 1) continue;
        out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelectorAll(selector: string): MiniNode[] {
    return this.all().filter((n) => matches(n, selector, this));
  }
  querySelector(selector: string): MiniNode | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  closest(selector: string): MiniNode | null {
    let n: MiniNode | null = this;
    while (n && n.nodeType === 1) {
      if (matches(n, selector, null)) return n;
      n = n.parentNode;
    }
    return null;
  }

  // --- form values ----------------------------------------------------------
  get value(): string {
    if (this.tagName === "SELECT") {
      const opts = this.querySelectorAll("option");
      const sel = opts.find((o) => o.hasAttribute("selected")) ?? (this.valueProp === null ? opts[0] : undefined);
      if (this.valueProp !== null) {
        const hit = opts.find((o) => o.value === this.valueProp);
        return hit ? hit.value : "";
      }
      return sel ? sel.value : "";
    }
    if (this.tagName === "OPTION") return this.getAttribute("value") ?? this.textContent;
    if (this.valueProp !== null) return this.valueProp;
    if (this.tagName === "TEXTAREA") return this.textContent;
    return this.getAttribute("value") ?? "";
  }
  set value(v: string) {
    const s = String(v);
    if (this.tagName === "OPTION") {
      this.setAttribute("value", s);
      return;
    }
    if (this.tagName === "SELECT") {
      const opts = this.querySelectorAll("option");
      for (const o of opts) o.removeAttribute("selected");
      this.valueProp = opts.some((o) => o.value === s) ? s : "\u0000none";
      return;
    }
    this.valueProp = s;
  }
  get checked(): boolean {
    return this.checkedProp ?? this.hasAttribute("checked");
  }
  set checked(on: boolean) {
    this.checkedProp = Boolean(on);
  }

  // --- behaviour ------------------------------------------------------------
  focus(): void {
    this.focused = true;
  }
  scrollIntoView(): void {
    this.scrolled = true;
  }
  getBoundingClientRect(): { left: number; right: number; top: number; bottom: number; width: number; height: number } {
    return { left: 0, right: 100, top: 0, bottom: 20, width: 100, height: 20 };
  }
  addEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  // Fires the event on this node, then bubbles it up to the document.
  fire(type: string, extra: Partial<MiniEvent> = {}): MiniEvent {
    let stopped = false;
    const ev: MiniEvent = {
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() { ev.defaultPrevented = true; },
      stopPropagation() { stopped = true; },
      ...extra,
    } as MiniEvent;
    let n: MiniNode | null = this;
    while (n && !stopped) {
      for (const fn of n.listeners.get(type) ?? []) fn.call(n, ev);
      n = n.parentNode;
    }
    return ev;
  }
  click(): MiniEvent {
    if (this.disabled) return { type: "click", target: this, defaultPrevented: false, preventDefault() {}, stopPropagation() {} };
    return this.fire("click");
  }
}

// --- selectors ------------------------------------------------------------------

interface Simple {
  tag: string | null;
  id: string | null;
  classes: string[];
  attrs: Array<{ name: string; value: string | null }>;
}

function parseSimple(sel: string): Simple {
  const out: Simple = { tag: null, id: null, classes: [], attrs: [] };
  const re = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sel)) !== null) {
    if (m[1] !== undefined) out.tag = m[1].toUpperCase();
    else if (m[2] !== undefined) out.id = m[2];
    else if (m[3] !== undefined) out.classes.push(m[3]);
    else if (m[4] !== undefined) out.attrs.push({ name: m[4], value: m[5] ?? m[6] ?? m[7] ?? null });
  }
  return out;
}

function matchesSimple(n: MiniNode, s: Simple): boolean {
  if (s.tag !== null && n.tagName !== s.tag) return false;
  if (s.id !== null && n.id !== s.id) return false;
  const cls = n.className.split(/\s+/);
  for (const c of s.classes) if (!cls.includes(c)) return false;
  for (const a of s.attrs) {
    const v = n.getAttribute(a.name);
    if (v === null) return false;
    if (a.value !== null && v !== a.value) return false;
  }
  return true;
}

function matches(n: MiniNode, selector: string, scope: MiniNode | null): boolean {
  return selector.split(",").some((part) => {
    const chain = part.trim().split(/\s+/).map(parseSimple);
    const last = chain.pop();
    if (!last || !matchesSimple(n, last)) return false;
    let anc = n.parentNode;
    for (let i = chain.length - 1; i >= 0; i--) {
      while (anc && anc !== scope?.parentNode && !(anc.nodeType === 1 && matchesSimple(anc, chain[i] as Simple))) anc = anc.parentNode;
      if (!anc || anc.nodeType !== 1) return false;
      anc = anc.parentNode;
    }
    return true;
  });
}

// --- parser ---------------------------------------------------------------------

export function parseHtml(html: string): MiniNode {
  const doc = new MiniNode("#document", 9);
  const stack: MiniNode[] = [doc];
  const top = (): MiniNode => stack[stack.length - 1] as MiniNode;
  const tagRe = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  const addText = (t: string): void => {
    if (t === "") return;
    const node = new MiniNode("#text", 3);
    node.text = decode(t);
    top().appendChild(node);
  };
  while ((m = tagRe.exec(html)) !== null) {
    addText(html.slice(last, m.index));
    last = tagRe.lastIndex;
    const [whole, closeName, openName, attrText, selfClose] = m;
    if (whole.startsWith("<!")) continue;
    if (closeName !== undefined) {
      const name = closeName.toUpperCase();
      const idx = stack.map((n) => n.tagName).lastIndexOf(name);
      if (idx > 0) stack.length = idx;
      continue;
    }
    const el = new MiniNode(openName as string);
    const attrRe = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(attrText ?? "")) !== null) {
      el.attrs.set(a[1] as string, decode(a[2] ?? a[3] ?? a[4] ?? ""));
    }
    // a <template>'s children go into its content fragment
    const parent = top();
    (parent.tagName === "TEMPLATE" && parent.content ? parent.content : parent).appendChild(el);
    const tag = el.tagName.toLowerCase();
    if (RAW.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, last);
      const body = html.slice(last, end === -1 ? html.length : end);
      if (body !== "") {
        const t = new MiniNode("#text", 3);
        t.text = tag === "textarea" ? decode(body) : body;
        el.appendChild(t);
      }
      const close = end === -1 ? html.length : html.indexOf(">", end) + 1;
      tagRe.lastIndex = close;
      last = close;
      continue;
    }
    if (VOID.has(tag) || selfClose === "/") continue;
    stack.push(tag === "template" && el.content ? el : el);
  }
  addText(html.slice(last));
  // move a template's direct children (parsed onto the template) into content
  for (const t of doc.querySelectorAll("template")) {
    for (const c of [...t.childNodes]) t.content?.appendChild(c);
  }
  return doc;
}

export interface MiniDocument {
  root: MiniNode;
  getElementById(id: string): MiniNode | null;
  querySelector(sel: string): MiniNode | null;
  querySelectorAll(sel: string): MiniNode[];
  createElement(tag: string): MiniNode;
  createTextNode(text: string): MiniNode;
  createDocumentFragment(): MiniNode;
  importNode(node: MiniNode, deep: boolean): MiniNode;
  addEventListener(type: string, fn: Listener): void;
  documentElement: MiniNode;
  head: MiniNode | null;
  body: MiniNode | null;
  readyState: string;
}

export function miniDocument(html: string): MiniDocument {
  const root = parseHtml(html);
  const doc: MiniDocument = {
    root,
    getElementById: (id) => root.all().find((n) => n.id === id) ?? null,
    querySelector: (sel) => root.querySelector(sel),
    querySelectorAll: (sel) => root.querySelectorAll(sel),
    createElement: (tag) => new MiniNode(tag),
    createTextNode: (text) => {
      const t = new MiniNode("#text", 3);
      t.text = String(text);
      return t;
    },
    createDocumentFragment: () => new MiniNode("#fragment", 11),
    importNode: (node, deep) => {
      const copy = node.nodeType === 11 ? new MiniNode("#fragment", 11) : node.cloneNode(deep);
      if (node.nodeType === 11 && deep) for (const c of node.childNodes) copy.appendChild(c.cloneNode(true));
      return copy;
    },
    addEventListener: (type, fn) => root.addEventListener(type, fn),
    documentElement: root.querySelector("html") ?? root,
    head: root.querySelector("head"),
    body: root.querySelector("body"),
    readyState: "complete",
  };
  return doc;
}
