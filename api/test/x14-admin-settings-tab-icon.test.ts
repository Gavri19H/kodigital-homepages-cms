// X14 (admin half) — Settings screen: the new "Tab icon" field
// (favicon_media_id) and the Logo preview fix.
//
// Each case fails on the code before X14: there was no Tab icon field, the
// key was not on the PATCH allow-list, and the Logo preview read only
// site_logo_url (empty for "Generate with AI" logos, so it went blank).

import vm from "node:vm";
import { describe, it, expect } from "vitest";
import { settingsPage, SETTINGS_SCRIPT } from "../src/admin/templates/settings";
import { ALLOWED_SETTINGS_KEYS } from "../src/settings/custom-html";

const HELP =
  "The small picture in the browser tab and on phone home screens. Use a square picture, at least 180 × 180 (512 × 512 is best). With none, the site's badge is used.";
const SQUARE_NOTE = "Square pictures look best: this one will be fitted inside a square.";
const AI_NOTE =
  "This logo was made by AI at site setup. Public pages show the site's badge until you upload a logo.";

const SITES = [{ id: "site-1", name: "Playful Path" }];

function page(values: Record<string, string>): string {
  return settingsPage(SITES, values, "site-1");
}

// Pull one element's opening tag by id, so attribute checks stay local to it.
function tagById(html: string, id: string): string {
  const m = html.match(new RegExp(`<[a-z]+[^>]*\\sid="${id}"[^>]*>`));
  expect(m, `element #${id} is rendered`).not.toBeNull();
  return m![0];
}

// The bare `hidden` attribute (not aria-hidden="...").
function isHidden(tag: string): boolean {
  return /\shidden(?=[\s/>])/.test(tag);
}

describe("X14 Settings — Tab icon field", () => {
  it("favicon_media_id is accepted by the settings PATCH allow-list", () => {
    expect(ALLOWED_SETTINGS_KEYS.has("favicon_media_id")).toBe(true);
  });

  it("renders the Tab icon field directly under the Logo card, with the exact help text", () => {
    const html = page({});
    expect(html).toContain('<h3 class="card-title">Tab icon</h3>');
    expect(html).toContain('<label class="form-label" for="faviconFileInput">Tab icon</label>');
    expect(html).toContain(`<small class="form-help">${HELP}</small>`);
    // Directly after the Site Logo card, before Brand Tokens.
    const logoAt = html.indexOf('<h3 class="card-title">Site Logo</h3>');
    const iconAt = html.indexOf('<h3 class="card-title">Tab icon</h3>');
    const aiPanelAt = html.indexOf('data-panel="ai-logo"');
    expect(logoAt).toBeGreaterThan(-1);
    expect(iconAt).toBeGreaterThan(aiPanelAt);
    expect(tagById(html, "faviconFileInput")).toContain(
      'accept="image/png,image/jpeg,image/webp,image/svg+xml"',
    );
    // The square note is present but hidden until an upload proves non-square.
    expect(isHidden(tagById(html, "favicon-square-note"))).toBe(true);
    expect(html).toContain(SQUARE_NOTE);
  });

  it("with no tab icon: the badge shows, the picture and Remove are hidden, the hidden input is empty", () => {
    const html = page({ site_name: "Playful Path" });
    expect(tagById(html, "setting-favicon_media_id")).toContain('name="favicon_media_id"');
    expect(tagById(html, "setting-favicon_media_id")).toContain('value=""');
    expect(isHidden(tagById(html, "favicon-preview-badge"))).toBe(false);
    expect(isHidden(tagById(html, "favicon-preview-img"))).toBe(true);
    expect(tagById(html, "favicon-preview-img")).not.toContain("src=");
    expect(isHidden(tagById(html, "favicon-remove"))).toBe(true);
    // The badge carries the site's glyph svg (white glyph on the teal square).
    expect(html).toMatch(/id="favicon-preview-badge"[^>]*><svg class="brand-glyph"/);
  });

  it("with a tab icon: the preview shows /media/<favicon_media_id> and the badge is hidden", () => {
    const html = page({ favicon_media_id: "2026/11/22/icon.png" });
    expect(tagById(html, "favicon-preview-img")).toContain('src="/media/2026/11/22/icon.png"');
    expect(isHidden(tagById(html, "favicon-preview-img"))).toBe(false);
    expect(isHidden(tagById(html, "favicon-preview-badge"))).toBe(true);
    expect(tagById(html, "setting-favicon_media_id")).toContain('value="2026/11/22/icon.png"');
    expect(isHidden(tagById(html, "favicon-remove"))).toBe(false);
  });

  it("escapes a hostile stored value instead of emitting raw HTML", () => {
    const html = page({ favicon_media_id: '"><script>alert(1)</script>' });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });
});

describe("X14 Settings — Logo preview", () => {
  it("shows the logo_media_id picture when site_logo_url is empty (AI-made logos)", () => {
    const html = page({ logo_media_id: "2026/08/18/abc.png", site_logo_url: "" });
    expect(html).toMatch(
      /id="logo-upload-preview"[^>]*><img src="\/media\/2026\/08\/18\/abc\.png" alt="Current logo" \/>/,
    );
  });

  it("prefers logo_media_id over the old site_logo_url, and falls back to site_logo_url", () => {
    const both = page({ logo_media_id: "2026/08/18/new.png", site_logo_url: "/media/old.png" });
    expect(both).toContain('<img src="/media/2026/08/18/new.png" alt="Current logo" />');
    const legacy = page({ logo_media_id: "", site_logo_url: "/media/old.png" });
    expect(legacy).toContain('<img src="/media/old.png" alt="Current logo" />');
  });

  it("shows the AI-logo note only for an AI-made setup logo", () => {
    const ai = page({ logo_media_id: "ai/site-1/logo/site-1.png" });
    expect(ai).toContain('<img src="/media/ai/site-1/logo/site-1.png" alt="Current logo" />');
    expect(isHidden(tagById(ai, "logo-ai-note"))).toBe(false);
    expect(ai).toContain(AI_NOTE);

    const uploaded = page({ logo_media_id: "2026/08/18/abc.png" });
    expect(isHidden(tagById(uploaded, "logo-ai-note"))).toBe(true);

    const none = page({});
    expect(isHidden(tagById(none, "logo-ai-note"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Client behavior: run the shipped inline script against a tiny fake DOM.
// ---------------------------------------------------------------------------
class FakeNode {
  tag: string;
  value = "";
  hidden = false;
  disabled = false;
  checked = false;
  nodeValue = "";
  files: unknown[] | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  onload: (() => void) | null = null;
  children: FakeNode[] = [];
  attrs: Record<string, string> = {};
  listeners: Record<string, Array<(e?: unknown) => void>> = {};
  constructor(tag: string) {
    this.tag = tag;
  }
  get firstChild(): FakeNode | null {
    return this.children[0] ?? null;
  }
  appendChild(n: FakeNode): FakeNode {
    this.children.push(n);
    return n;
  }
  removeChild(n: FakeNode): FakeNode {
    this.children = this.children.filter((c) => c !== n);
    return n;
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = String(v);
  }
  getAttribute(k: string): string | null {
    return k in this.attrs ? this.attrs[k]! : null;
  }
  removeAttribute(k: string): void {
    delete this.attrs[k];
  }
  addEventListener(type: string, fn: (e?: unknown) => void): void {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  focus(): void {}
  get textContent(): string {
    if (this.tag === "#text") return this.nodeValue;
    return this.children.map((c) => c.textContent).join("");
  }
  fire(type: string, e?: unknown): void {
    (this.listeners[type] || []).forEach((fn) => fn.call(this, e));
  }
}

const IDS = [
  "settings-editor-form",
  "filter-site",
  "settings-site-id",
  "settings-editor-status",
  "settings-form-error",
  "faviconFileInput",
  "setting-favicon_media_id",
  "favicon-preview-img",
  "favicon-preview-badge",
  "favicon-remove",
  "favicon-upload-status",
  "favicon-square-note",
  "logoFileInput",
  "setting-site_logo_url",
  "setting-logo_media_id",
  "logo-upload-preview",
  "logo-upload-status",
  "logo-ai-note",
];

function boot(mediaBody: unknown) {
  const ids: Record<string, FakeNode> = {};
  for (const id of IDS) ids[id] = new FakeNode(id === "favicon-preview-img" ? "img" : "div");
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchStub = (url: string, init?: { body?: unknown }) => {
    calls.push({ url, body: init?.body });
    const body = url.indexOf("/admin/media") > -1 ? mediaBody : { ok: true, settings_version: 2 };
    return Promise.resolve({
      ok: true,
      status: 200,
      type: "basic",
      redirected: false,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  };
  // The submit handler reads named inputs through FormData(form).get(key);
  // model that with the hidden inputs' current values.
  class FakeFormData {
    constructor(_form?: unknown) {}
    append(): void {}
    get(k: string): string | null {
      const n = ids["setting-" + k];
      return n ? n.value : null;
    }
  }
  vm.runInNewContext(SETTINGS_SCRIPT, {
    document: {
      getElementById: (id: string) => ids[id] || null,
      querySelector: () => null,
      querySelectorAll: () => [] as FakeNode[],
      createElement: (tag: string) => new FakeNode(tag),
      createTextNode: (text: string) => {
        const n = new FakeNode("#text");
        n.nodeValue = String(text);
        return n;
      },
    },
    fetch: fetchStub,
    FormData: FakeFormData,
    window: { location: { href: "" } },
  });
  return { el: (id: string) => ids[id]!, calls };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("X14 Settings — Tab icon client script", () => {
  it("uploads through POST /admin/media, stores the storage_key, swaps badge for picture, and saves favicon_media_id", async () => {
    const { el, calls } = boot({ id: 9, storage_key: "2026/11/22/icon.png" });
    el("favicon-preview-img").hidden = true;
    el("favicon-remove").hidden = true;
    el("faviconFileInput").files = [{ type: "image/png", name: "icon.png" }];
    el("faviconFileInput").fire("change");
    await flush();
    await flush();

    const upload = calls.find((c) => c.url === "/admin/media");
    expect(upload, "uploads through the same media call as the logo").toBeDefined();
    expect(el("setting-favicon_media_id").value).toBe("2026/11/22/icon.png");
    expect(el("favicon-preview-img").getAttribute("src")).toBe("/media/2026/11/22/icon.png");
    expect(el("favicon-preview-img").hidden).toBe(false);
    expect(el("favicon-preview-badge").hidden).toBe(true);
    expect(el("favicon-remove").hidden).toBe(false);

    // Saving sends the key with the other settings.
    el("settings-site-id").value = "site-1";
    el("settings-editor-form").fire("submit", { preventDefault() {} });
    await flush();
    const save = calls.find((c) => c.url === "/api/admin/settings");
    expect(save).toBeDefined();
    const sent = JSON.parse(String(save!.body)) as { updates: Record<string, string> };
    expect(sent.updates.favicon_media_id).toBe("2026/11/22/icon.png");
  });

  it("shows the square note only when the uploaded picture is not square", async () => {
    const { el } = boot({ storage_key: "2026/11/22/wide.png" });
    el("favicon-square-note").hidden = true;
    el("faviconFileInput").files = [{ type: "image/png" }];
    el("faviconFileInput").fire("change");
    await flush();
    await flush();
    const img = el("favicon-preview-img");
    img.naturalWidth = 400;
    img.naturalHeight = 200;
    img.onload!();
    expect(el("favicon-square-note").hidden).toBe(false);

    img.naturalWidth = 512;
    img.naturalHeight = 512;
    img.onload!();
    expect(el("favicon-square-note").hidden).toBe(true);
  });

  it("Remove clears the value and brings the badge back; saving then sends an empty favicon_media_id", async () => {
    const { el, calls } = boot({});
    el("setting-favicon_media_id").value = "2026/11/22/icon.png";
    el("favicon-preview-img").setAttribute("src", "/media/2026/11/22/icon.png");
    el("favicon-preview-badge").hidden = true;
    el("favicon-remove").fire("click");
    expect(el("setting-favicon_media_id").value).toBe("");
    expect(el("favicon-preview-img").getAttribute("src")).toBeNull();
    expect(el("favicon-preview-img").hidden).toBe(true);
    expect(el("favicon-preview-badge").hidden).toBe(false);
    expect(el("favicon-remove").hidden).toBe(true);

    el("settings-site-id").value = "site-1";
    el("settings-editor-form").fire("submit", { preventDefault() {} });
    await flush();
    const save = calls.find((c) => c.url === "/api/admin/settings");
    const sent = JSON.parse(String(save!.body)) as { updates: Record<string, string> };
    expect(sent.updates.favicon_media_id).toBe("");
  });

  it("refuses a file type other than PNG, JPG, WEBP or SVG without uploading", async () => {
    const { el, calls } = boot({ storage_key: "x.gif" });
    el("faviconFileInput").files = [{ type: "image/gif" }];
    el("faviconFileInput").fire("change");
    await flush();
    expect(calls.find((c) => c.url === "/admin/media")).toBeUndefined();
    expect(el("setting-favicon_media_id").value).toBe("");
    expect(el("favicon-upload-status").textContent).toBe("Please choose a PNG, JPG, WEBP or SVG picture.");
  });

  it("an uploaded logo hides the AI-logo note", async () => {
    const { el } = boot({ storage_key: "2026/11/22/logo.png" });
    el("logo-ai-note").hidden = false;
    el("logoFileInput").files = [{ type: "image/png" }];
    el("logoFileInput").fire("change");
    await flush();
    await flush();
    expect(el("setting-logo_media_id").value).toBe("2026/11/22/logo.png");
    expect(el("logo-ai-note").hidden).toBe(true);
  });
});
