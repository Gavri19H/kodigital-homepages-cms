// X06 SEO Fixes, Part A2 — Settings → (a site) → General → "Site Information".
//
// Covers (plan X06 §3 Part A, §4 Design, §8 "Done when" → Settings → General):
//   - "Audience" saves and reloads (server allow-list + the screen's key list).
//   - Saving "{{" or "}}" in Site Name, Audience, Tagline or Site Description is
//     refused with the exact message and nothing is written (server), and the
//     screen marks the field and sends nothing (client).
//   - The screen: Audience field under Site Name (placeholder = the audience
//     AI would use when the site has none), the two "✨ Write with AI" buttons,
//     the two counters, the Site Description help text.
//   - "✨ Write with AI" posts {site_id, field, site_name, audience} to
//     /api/admin/ai/site-text, fills the field WITHOUT saving, and on any
//     failure leaves the field unchanged and shows the toast.

import { describe, it, expect, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { miniDocument, type MiniNode } from "./helpers/mini-dom";
import { hasSqlite, createDb, addSite, call, page, type SqliteDb } from "./helpers/x06-a2-sqlite";
import { settingsPage, SETTINGS_SCRIPT, AUDIENCE_DEFAULT_HINT_KEY } from "../src/admin/templates/settings";
import { ALLOWED_SETTINGS_KEYS } from "../src/settings/custom-html";

const describeDb = hasSqlite ? describe : describe.skip;
const MSG = "Remove the {{…}} placeholder before saving.";

function settingRows(sdb: SqliteDb, siteId: string): Array<{ key: string; value: string }> {
  return sdb
    .prepare("SELECT key, value FROM site_settings WHERE site_id = ? ORDER BY key")
    .all(siteId) as Array<{ key: string; value: string }>;
}
function settingsVersion(sdb: SqliteDb, siteId: string): number {
  return (sdb.prepare("SELECT settings_version AS v FROM sites WHERE id = ?").get(siteId) as { v: number }).v;
}

describeDb("X06 Settings save — Audience and the {{…}} refusal (server)", () => {
  it("saves \"audience\" and returns it on reload", async () => {
    expect(ALLOWED_SETTINGS_KEYS.has("audience")).toBe(true);
    const sdb = createDb();
    addSite(sdb, "st_money", "moneylantern", "finance");
    const save = await call(sdb, "PATCH", "/api/admin/settings", {
      site_id: "st_money",
      updates: { audience: "first-time home buyers", tagline: "Light your path." },
    });
    expect(save.status).toBe(200);
    const back = await call(sdb, "GET", "/api/admin/settings?site_id=st_money");
    const rows = back.json.settings as Array<{ key: string; value: string }>;
    expect(rows).toContainEqual({ key: "audience", value: "first-time home buyers" });
    // The Settings screen shows it back in the field, with no placeholder.
    const html = await page(sdb, "/admin/settings?site_id=st_money");
    const field = miniDocument(html).getElementById("setting-audience") as MiniNode;
    expect(field.getAttribute("value")).toBe("first-time home buyers");
    expect(field.getAttribute("placeholder")).toBeNull();
  });

  for (const key of ["site_name", "audience", "tagline", "site_description"]) {
    for (const bad of ["for {{audience}} readers", "half }} token"]) {
      it(`refuses ${JSON.stringify(bad)} in ${key} with 400 and writes nothing`, async () => {
        const sdb = createDb();
        addSite(sdb, "st_money", "moneylantern", "finance");
        const before = settingsVersion(sdb, "st_money");
        const res = await call(sdb, "PATCH", "/api/admin/settings", {
          site_id: "st_money",
          updates: { contact_email: "hi@example.com", [key]: bad },
        });
        expect(res.status).toBe(400);
        expect(res.json.error).toBe(MSG);
        expect(res.json.key).toBe(key);
        expect(settingRows(sdb, "st_money")).toEqual([]);
        expect(settingsVersion(sdb, "st_money")).toBe(before);
      });
    }
  }

  it("still saves other fields that legitimately use braces (only the 4 site texts are checked)", async () => {
    const sdb = createDb();
    addSite(sdb, "st_money", "moneylantern", "finance");
    const res = await call(sdb, "PATCH", "/api/admin/settings", {
      site_id: "st_money",
      updates: { custom_head_html: "<style>a{{color:red}}</style>" },
    });
    expect(res.status).toBe(200);
  });

  it("an empty Audience shows the audience AI would use as the placeholder, without saving it", async () => {
    const sdb = createDb();
    addSite(sdb, "st_money", "moneylantern", "finance");
    const html = await page(sdb, "/admin/settings?site_id=st_money");
    const field = miniDocument(html).getElementById("setting-audience") as MiniNode;
    expect(field.getAttribute("value")).toBe("");
    expect(field.getAttribute("placeholder")).toBe("people who want to make smarter everyday money decisions");
    expect(settingRows(sdb, "st_money")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The screen (HTML)
// ---------------------------------------------------------------------------

const SITES = [{ id: "st_money", name: "moneylantern" }];

describe("X06 Settings → General → Site Information (HTML)", () => {
  const desc = "Clear, practical guides on budgeting, saving, credit and loans for people who want to make smarter everyday money decisions.";
  const html = settingsPage(
    SITES,
    { site_name: "moneylantern", tagline: "Light your path to smarter money.", site_description: desc, [AUDIENCE_DEFAULT_HINT_KEY]: "people who want to make smarter everyday money decisions" },
    "st_money",
  );
  const doc = miniDocument(html);

  it("has the Audience field directly under Site Name, with its help text and placeholder", () => {
    const groups = doc.querySelectorAll("[data-setting-key]").map((n) => n.getAttribute("data-setting-key"));
    expect(groups.slice(0, 4)).toEqual(["site_name", "audience", "tagline", "site_description"]);
    const aud = doc.getElementById("setting-audience") as MiniNode;
    expect(aud.getAttribute("name")).toBe("audience");
    expect(aud.getAttribute("placeholder")).toBe("people who want to make smarter everyday money decisions");
    expect(html).toContain("Who this site writes for. Every AI text for this site uses it.");
    // The hint key itself is never a form field.
    expect(html).not.toContain(`name="${AUDIENCE_DEFAULT_HINT_KEY}"`);
  });

  it("has a ✨ Write with AI button on the Tagline and the Site Description label rows", () => {
    for (const key of ["tagline", "site_description"]) {
      const btn = doc.getElementById("ai-write-" + key) as MiniNode;
      expect(btn, key).not.toBeNull();
      expect(btn.getAttribute("type")).toBe("button");
      expect(btn.className).toContain("btn btn-secondary btn-sm");
      expect(btn.getAttribute("data-ai-write")).toBe(key);
      expect(btn.textContent).toBe("✨ Write with AI");
      expect((btn.closest(".form-label-row") as MiniNode).querySelector("label")!.getAttribute("for")).toBe("setting-" + key);
    }
    expect(doc.querySelectorAll("button[data-ai-write]")).toHaveLength(2);
  });

  it("has the counters and the Site Description help text", () => {
    expect((doc.getElementById("setting-counter-tagline") as MiniNode).textContent).toBe("33 characters");
    const dc = doc.getElementById("setting-counter-site_description") as MiniNode;
    expect(dc.textContent).toBe(`${desc.length} / 160`);
    expect(dc.className).not.toContain("is-over");
    expect(html).toContain("Used for SEO and social sharing. Best length: 120–160 characters.");
    const long = settingsPage(SITES, { site_description: "x".repeat(161) }, "st_money");
    const over = miniDocument(long).getElementById("setting-counter-site_description") as MiniNode;
    expect(over.textContent).toBe("161 / 160");
    expect(over.className).toContain("is-over");
    expect(html).toMatch(/\.char-counter \{[^}]*font-size: 12px;[^}]*color: #6b7280;[^}]*text-align: right/);
    expect(html).toMatch(/\.char-counter\.is-over \{ color: #b45309; font-weight: 600; \}/);
  });

  it("has a .form-error line under each of the 4 checked fields, and the label row wraps on a phone", () => {
    for (const key of ["site_name", "audience", "tagline", "site_description"]) {
      const line = doc.getElementById("setting-error-" + key) as MiniNode;
      expect(line, key).not.toBeNull();
      expect(line.className).toBe("form-error");
      expect(line.hidden).toBe(true);
    }
    expect(html).toMatch(/\.form-label-row \{ display: flex; flex-wrap: wrap;/);
  });
});

// ---------------------------------------------------------------------------
// The screen's own script (SETTINGS_SCRIPT) against the real HTML
// ---------------------------------------------------------------------------

interface Fetched { url: string; method: string; body: Record<string, unknown> }

function boot(respond: (url: string) => Promise<unknown>, values: Record<string, string> = {}) {
  const doc = miniDocument(
    settingsPage(SITES, { site_name: "moneylantern", audience: "savers", tagline: "Old tagline", site_description: "Old description.", ...values }, "st_money"),
  );
  const fetches: Fetched[] = [];
  const fetchStub = vi.fn((url: string, init: { method?: string; body?: string }) => {
    fetches.push({ url, method: String(init.method), body: JSON.parse(String(init.body ?? "{}")) as Record<string, unknown> });
    return respond(url);
  });
  const toasts: Array<[string, string]> = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const windowObj = {
    location: { href: "" },
    showToast: (m: string, t: string) => { toasts.push([m, t]); },
  };
  class FakeFormData {
    get(k: string) {
      const n = doc.querySelector(`[name="${k}"]`);
      return n ? n.value : null;
    }
  }
  runInNewContext(SETTINGS_SCRIPT, {
    window: windowObj,
    document: doc,
    fetch: fetchStub,
    FormData: FakeFormData,
    JSON,
    String,
    setTimeout: (fn: () => void, ms: number) => { timers.push({ fn, ms }); return timers.length; },
  });
  const el = (id: string) => doc.getElementById(id) as MiniNode;
  return { doc, el, fetches, toasts, timers };
}

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("X06 ✨ Write with AI (screen script)", () => {
  it("posts {site_id, field, site_name, audience} to /api/admin/ai/site-text and fills the field without saving", async () => {
    let resolve!: (v: unknown) => void;
    const pending = new Promise((r) => { resolve = r; });
    const { el, fetches, timers } = boot(() => pending as Promise<unknown>);
    // The current (unsaved) field values are what the AI gets.
    el("setting-site_name").value = "Money Lantern";
    el("setting-audience").value = "young savers";

    const btn = el("ai-write-site_description");
    btn.click();
    expect(btn.textContent).toBe("Writing…");
    expect(btn.disabled).toBe(true);
    expect(fetches).toEqual([
      {
        url: "/api/admin/ai/site-text",
        method: "POST",
        body: { site_id: "st_money", field: "site_description", site_name: "Money Lantern", audience: "young savers" },
      },
    ]);

    const text = "Clear guides on budgeting and saving for young savers who want to make every dollar count.";
    resolve(await jsonResponse(200, { text }));
    await flush();
    await flush();

    const field = el("setting-site_description");
    expect(field.value).toBe(text);
    expect(btn.textContent).toBe("✨ Write with AI");
    expect(btn.disabled).toBe(false);
    expect(el("setting-counter-site_description").textContent).toBe(`${text.length} / 160`);
    // Blue focus ring for 2 seconds.
    expect(field.className).toContain("ai-filled");
    const ring = timers.find((t) => t.ms === 2000)!;
    expect(ring).toBeDefined();
    ring.fn();
    expect(field.className).not.toContain("ai-filled");
    // Nothing saved: the settings endpoint was never called.
    expect(fetches.map((f) => f.url)).toEqual(["/api/admin/ai/site-text"]);
  });

  it("the Tagline button sends field \"tagline\" and updates the \"N characters\" counter", async () => {
    const { el, fetches } = boot(() => jsonResponse(200, { text: "Smarter money, one step at a time." }));
    el("ai-write-tagline").click();
    await flush();
    await flush();
    expect(fetches[0]!.body.field).toBe("tagline");
    expect(el("setting-tagline").value).toBe("Smarter money, one step at a time.");
    expect(el("setting-counter-tagline").textContent).toBe("34 characters");
  });

  for (const [label, respond] of [
    ["an error answer", () => jsonResponse(502, { error: "The AI didn't answer." })],
    ["an empty answer", () => jsonResponse(200, { text: "" })],
    ["a network failure", () => Promise.reject(new Error("offline"))],
  ] as Array<[string, () => Promise<unknown>]>) {
    it(`on ${label} the field keeps its old text and a toast says so`, async () => {
      const { el, toasts, fetches } = boot(respond);
      el("ai-write-site_description").click();
      await flush();
      await flush();
      expect(el("setting-site_description").value).toBe("Old description.");
      expect(toasts).toEqual([["The AI didn't answer. Nothing was changed.", "error"]]);
      expect(el("ai-write-site_description").disabled).toBe(false);
      expect(fetches).toHaveLength(1);
    });
  }

  it("typing updates the counter, amber past 160", () => {
    const { el } = boot(() => jsonResponse(200, {}));
    const field = el("setting-site_description");
    field.value = "y".repeat(170);
    field.fire("input");
    const counter = el("setting-counter-site_description");
    expect(counter.textContent).toBe("170 / 160");
    expect(counter.className).toContain("is-over");
  });

  for (const key of ["site_name", "audience", "tagline", "site_description"]) {
    it(`Save with "{{" in ${key} marks the field and sends nothing`, () => {
      const { el, fetches } = boot(() => jsonResponse(200, {}));
      el("setting-" + key).value = "helps {{audience}} save";
      el("settings-editor-form").fire("submit");
      expect(fetches).toEqual([]);
      expect(el("setting-" + key).className).toContain("is-invalid");
      const line = el("setting-error-" + key);
      expect(line.hidden).toBe(false);
      expect(line.textContent).toBe(MSG);
    });
  }

  it("a clean Save sends the Audience with the other settings", async () => {
    const { el, fetches } = boot(() => jsonResponse(200, { ok: true }));
    el("setting-audience").value = "first-time savers";
    el("settings-editor-form").fire("submit");
    expect(fetches).toHaveLength(1);
    expect(fetches[0]!.url).toBe("/api/admin/settings");
    expect(fetches[0]!.method).toBe("PATCH");
    const updates = fetches[0]!.body.updates as Record<string, string>;
    expect(updates.audience).toBe("first-time savers");
    expect(updates.site_name).toBe("moneylantern");
  });

  it("the X06 part of the script is ES5 (admin inline-script rule)", () => {
    const start = SETTINGS_SCRIPT.indexOf("X06: Site Information");
    const end = SETTINGS_SCRIPT.indexOf("if (!form || !filter || !hidden || !status)");
    expect(start).toBeGreaterThan(0);
    const part = SETTINGS_SCRIPT.slice(start, end);
    expect(part).not.toMatch(/=>|\bconst\b|\blet\b|`/);
    expect(part).toContain(`var PLACEHOLDER_MSG = ${JSON.stringify(MSG)};`);
  });
});
