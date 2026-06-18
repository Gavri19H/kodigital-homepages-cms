// T25 [RC-045] — Brand tokens: UX pickers, not JSON.
//
// Every it() title embeds the literal [api/test/brand-tokens.test.ts] and the
// L2 disambiguation marker so the parse_test_output evidence parser routes the
// receipt to RC-045 (T25-AC1). The file's own evidence_command runs this whole
// file (`npx vitest run test/brand-tokens.test.ts`).
//
// T25-AC1 (RC-045): "Settings renders color pickers + font selects (no raw JSON
// editing) and composes brand_tokens_json; picking a primary color -> the public
// --tw-brand reflects it (brand family only; other tokens stay the contract)".
//
// The AC is proven against the SHIPPED code — NOT a grep of the source:
//   1. settingsPage() renders the four color pickers + two font selects (and no
//      raw brand_tokens_json textarea), pre-populated from the stored value.
//   2. the REAL settings client script (SETTINGS_SCRIPT), run in a vm with a DOM
//      + fetch stub, composes brand_tokens_json from the pickers — writing only
//      the brand-family key the operator changed, preserving unknown keys, and
//      leaving every other design token out (so it stays the contract).
//   3. the REAL public consumer (renderBrandTokensStyle, used by renderLayout)
//      turns that composed map into the inline `:root` override: the public
//      --tw-brand reflects the picked color, while the structural design tokens
//      (--tw-ink / --tw-fs-base / --tw-radius / --tw-rule) are NOT emitted, so
//      they keep their public-css.ts contract values.
//
// This closes the negative_fail_condition (AC passing while the user-facing
// outcome is broken): if the compose dropped tw-brand, clobbered structural
// tokens, or lost unknown keys, one of the assertions below fails.

import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
import { settingsPage, SETTINGS_SCRIPT } from "../src/admin/templates/settings";
import { renderBrandTokensStyle } from "../src/public/templates/layout";

const nodeRequire = createRequire(import.meta.url);
const vm = nodeRequire("node:vm") as typeof import("node:vm");

// ---------------------------------------------------------------------------
// Minimal DOM stub — just enough surface to RUN the shipped ES5 script.
// ---------------------------------------------------------------------------
class FakeNode {
  tag: string;
  attrs: Record<string, string> = {};
  children: FakeNode[] = [];
  listeners: Record<string, Array<(e?: unknown) => void>> = {};
  value = "";
  hidden = false;
  disabled = false;
  className = "";
  nodeValue = "";

  constructor(tag: string) {
    this.tag = tag;
  }
  get firstChild(): FakeNode | null {
    return this.children.length ? this.children[0]! : null;
  }
  appendChild(n: FakeNode): FakeNode {
    this.children.push(n);
    return n;
  }
  removeChild(n: FakeNode): FakeNode {
    const i = this.children.indexOf(n);
    if (i >= 0) this.children.splice(i, 1);
    return n;
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = String(v);
  }
  getAttribute(k: string): string | null {
    return k in this.attrs ? this.attrs[k]! : null;
  }
  addEventListener(type: string, fn: (e?: unknown) => void): void {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  focus(): void {}
  // Test helper: dispatch a registered listener.
  fire(type: string, e?: unknown): void {
    (this.listeners[type] || []).forEach((fn) => fn.call(this, e));
  }
}

// Ids the settings client script touches. The four required ids
// (form/filter/hidden/status) must exist or the script returns early before it
// registers the submit handler. Brand pickers + the hidden raw field are the
// T25 surface under test.
const SETTINGS_IDS = [
  "settings-editor-form",
  "filter-site",
  "settings-site-id",
  "settings-editor-status",
  "settings-form-error",
  "newsletter_enabled",
  "newsletter_provider",
  "setting-brand_tokens_json",
  "brand-color-primary",
  "brand-color-accent",
  "brand-color-background",
  "brand-color-text",
  "brand-font-heading",
  "brand-font-body",
];

interface FetchCall {
  url: string;
  init: { method?: string; body?: unknown } | undefined;
}

function bootSettings(): { el: (id: string) => FakeNode; calls: FetchCall[] } {
  const ids: Record<string, FakeNode> = {};
  for (const id of SETTINGS_IDS) ids[id] = new FakeNode("div");
  const doc = {
    getElementById: (id: string) => ids[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [] as FakeNode[],
    createElement: (tag: string) => new FakeNode(tag),
    createTextNode: (text: string) => {
      const n = new FakeNode("#text");
      n.nodeValue = String(text);
      return n;
    },
  };
  const calls: FetchCall[] = [];
  const fetchStub = (url: string, init?: { method?: string; body?: unknown }) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ settings_version: 2 }),
    });
  };
  class FakeFormData {
    constructor(_form?: unknown) {}
    append(_k: string, _v: unknown) {}
    get() {
      return null;
    }
  }
  vm.runInNewContext(SETTINGS_SCRIPT, {
    document: doc,
    fetch: fetchStub,
    FormData: FakeFormData,
    window: { location: { href: "" } },
  });
  const el = (id: string): FakeNode => {
    const n = ids[id];
    if (!n) throw new Error("missing test node: " + id);
    return n;
  };
  return { el, calls };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

// Pull the composed brand_tokens_json out of the PATCH the script sent.
function composedBrandTokens(calls: FetchCall[]): Record<string, string> {
  const patch = calls.find((c) => c.url.indexOf("/api/admin/settings") > -1);
  expect(patch, "settings save POSTs to /api/admin/settings").toBeDefined();
  const sent = JSON.parse(String(patch!.init!.body)) as {
    updates: { brand_tokens_json: string };
  };
  return JSON.parse(sent.updates.brand_tokens_json) as Record<string, string>;
}

const SITES = [{ id: "site-1", name: "Acme News" }];

// ===========================================================================
// Render: pickers + selects, NO raw JSON textarea, pre-populated, round-trip.
// ===========================================================================
describe("T25-AC1 Settings renders brand pickers, not raw JSON (RC-045)", () => {
  it("[api/test/brand-tokens.test.ts] T25-AC1: the Brand Tokens card renders color pickers + font selects (no raw JSON textarea) pre-populated from the stored value L2_AUTO_DISAMBIGUATION:T25-AC1:RC-045", () => {
    const stored = JSON.stringify({ "tw-brand": "#aa0011", "tw-success": "#123456" });
    const html = settingsPage(SITES, { brand_tokens_json: stored }, "site-1", {});

    // Friendly card heading kept (no "(JSON)" raw editor).
    expect(html).toContain('<h3 class="card-title">Brand Tokens</h3>');

    // Four color pickers + two font selects, each bound to its brand key.
    expect(html).toContain('id="brand-color-primary"');
    expect(html).toContain('id="brand-color-accent"');
    expect(html).toContain('id="brand-color-background"');
    expect(html).toContain('id="brand-color-text"');
    expect(html).toContain('type="color"');
    expect(html).toContain('data-brand-key="tw-brand"');
    expect(html).toContain('id="brand-font-heading"');
    expect(html).toContain('id="brand-font-body"');
    expect(html).toContain('data-brand-key="tw-font-display"');

    // The primary picker is PRE-POPULATED from the stored brand token.
    expect(html).toMatch(/id="brand-color-primary"[^>]*value="#aa0011"/);

    // No raw JSON editing surface for brand tokens.
    expect(html).not.toMatch(/<textarea[^>]*name="brand_tokens_json"/);
    expect(html).not.toContain("Brand Tokens (JSON)");

    // A hidden raw field still carries the canonical key for round-trip.
    expect(html).toMatch(/<input type="hidden"[^>]*name="brand_tokens_json"/);
  });
});

// ===========================================================================
// Behavioral chain: pick primary -> composed brand_tokens_json -> public
// --tw-brand reflects it; brand family ONLY (other tokens stay the contract).
// ===========================================================================
describe("T25-AC1 picking a primary color reaches the public --tw-brand (RC-045)", () => {
  it("[api/test/brand-tokens.test.ts] T25-AC1: changing the primary picker composes tw-brand into brand_tokens_json (unknown keys preserved, structural tokens untouched) and renderBrandTokensStyle emits --tw-brand only L2_AUTO_DISAMBIGUATION:T25-AC1:RC-045", async () => {
    const { el, calls } = bootSettings();
    el("settings-site-id").value = "site-1";
    // A pre-existing UNKNOWN key the pickers don't expose — must round-trip.
    el("setting-brand_tokens_json").value = JSON.stringify({ "tw-success": "#123456" });
    // Operator picks a new primary color; everything else left untouched.
    el("brand-color-primary").value = "#aa0011";

    el("settings-editor-form").fire("submit", { preventDefault() {} });
    await flush();

    const tokens = composedBrandTokens(calls);
    // Brand family: the picked primary is written.
    expect(tokens["tw-brand"]).toBe("#aa0011");
    // Unknown key preserved (the hidden raw field round-trip).
    expect(tokens["tw-success"]).toBe("#123456");
    // Brand family ONLY — untouched brand fields are NOT written...
    expect("tw-accent" in tokens).toBe(false);
    expect("tw-bg" in tokens).toBe(false);
    expect("tw-text" in tokens).toBe(false);
    expect("tw-font-display" in tokens).toBe(false);
    // ...and structural design tokens are NEVER composed.
    expect("tw-ink" in tokens).toBe(false);
    expect("tw-fs-base" in tokens).toBe(false);
    expect("tw-radius" in tokens).toBe(false);

    // The public consumer turns the composed map into the inline override:
    // --tw-brand reflects the picked color; structural tokens stay the contract.
    const style = renderBrandTokensStyle(tokens);
    expect(style).toContain("--tw-brand: #aa0011;");
    expect(style).toContain("--tw-success: #123456;"); // unknown key flows through
    expect(style).not.toContain("--tw-ink");
    expect(style).not.toContain("--tw-fs-base");
    expect(style).not.toContain("--tw-radius");
    expect(style).not.toContain("--tw-rule");
  });

  it("[api/test/brand-tokens.test.ts] T25-AC1: leaving the primary at the design-contract default composes NO tw-brand key, so the public token stays the contract (renderBrandTokensStyle emits nothing) L2_AUTO_DISAMBIGUATION:T25-AC1:RC-045", async () => {
    const { el, calls } = bootSettings();
    el("settings-site-id").value = "site-1";
    el("setting-brand_tokens_json").value = "";
    // The picker sits on the contract default (#1ba8c8) — no operator change.
    el("brand-color-primary").value = "#1ba8c8";

    el("settings-editor-form").fire("submit", { preventDefault() {} });
    await flush();

    const tokens = composedBrandTokens(calls);
    expect("tw-brand" in tokens).toBe(false);
    // No overrides at all -> the public side emits no <style> block, so EVERY
    // token (brand family included) keeps its public-css.ts contract value.
    expect(renderBrandTokensStyle(tokens)).toBe("");
  });

  it("[api/test/brand-tokens.test.ts] T25-AC1: choosing a heading font composes tw-font-display and the public --tw-font-display reflects it L2_AUTO_DISAMBIGUATION:T25-AC1:RC-045", async () => {
    const { el, calls } = bootSettings();
    el("settings-site-id").value = "site-1";
    el("setting-brand_tokens_json").value = "";
    el("brand-font-heading").value = '"Playfair Display", Georgia, serif';

    el("settings-editor-form").fire("submit", { preventDefault() {} });
    await flush();

    const tokens = composedBrandTokens(calls);
    expect(tokens["tw-font-display"]).toBe('"Playfair Display", Georgia, serif');
    const style = renderBrandTokensStyle(tokens);
    expect(style).toContain('--tw-font-display: "Playfair Display", Georgia, serif;');
  });
});
