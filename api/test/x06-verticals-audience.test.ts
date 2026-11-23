// X06 SEO Fixes, Part A2 — the Verticals screen's "Audience" (plan v3).
//
// Covers (plan X06 §3 Part A, §4 Design, §8 "Done when" → Verticals screen):
//   - Migration 0070 gives the 9 Verticals the Q1 default audiences.
//   - GET /api/admin/verticals returns each Vertical's audience.
//   - PATCH /api/admin/verticals/:id { audience } saves, clears (empty → NULL),
//     refuses "{{"/"}}" with the exact message, refuses > 200 characters, 404s
//     an unknown id.
//   - POST /api/admin/verticals takes an optional audience (same checks).
//   - The screen: "Audience" column between Slug and Sites (muted, one line,
//     full text in a title, "—" when empty), "Edit audience" next to "Delete",
//     the edit modal, and the "Add vertical" Audience field under Slug.
//   - The screen's script: "Edit audience" → modal "Audience for <name>" →
//     PATCH → row updates, toast; "{{" refused on screen without a request.

import { describe, it, expect, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { miniDocument, type MiniNode } from "./helpers/mini-dom";
import { hasSqlite, createDb, call, page, type SqliteDb } from "./helpers/x06-a2-sqlite";
import { verticalsListPage } from "../src/admin/templates";

const describeDb = hasSqlite ? describe : describe.skip;
const MSG = "Remove the {{…}} placeholder before saving.";

const Q1_DEFAULTS: Record<string, string> = {
  home: "homeowners and renters looking after their homes",
  finance: "people who want to make smarter everyday money decisions",
  travel: "people planning their next trip",
  health: "adults looking for clear, practical health information",
  parenting: "parents raising young children",
  food: "home cooks looking for easy, reliable recipes",
  tech: "everyday people choosing and using technology",
  lifestyle: "adults looking for practical ideas for everyday life",
  jobs: "job seekers and people growing their careers",
};

function vid(sdb: SqliteDb, slug: string): number {
  return (sdb.prepare("SELECT id FROM verticals WHERE slug = ?").get(slug) as { id: number }).id;
}
function audienceOf(sdb: SqliteDb, slug: string): string | null {
  return (sdb.prepare("SELECT audience FROM verticals WHERE slug = ?").get(slug) as { audience: string | null }).audience;
}

describeDb("X06 migration 0070 — Vertical audiences", () => {
  it("gives the 9 Verticals the Q1 default audiences", () => {
    const sdb = createDb();
    const rows = sdb.prepare("SELECT slug, audience FROM verticals ORDER BY slug").all() as Array<{ slug: string; audience: string | null }>;
    expect(rows).toHaveLength(9);
    for (const r of rows) expect(r.audience, r.slug).toBe(Q1_DEFAULTS[r.slug]);
  });
});

describeDb("X06 Verticals API — audience", () => {
  it("GET /api/admin/verticals returns each Vertical's audience", async () => {
    const sdb = createDb();
    const list = await call(sdb, "GET", "/api/admin/verticals");
    const rows = list.json.resource as Array<{ slug: string; audience: string | null }>;
    expect(rows).toHaveLength(9);
    for (const r of rows) expect(r.audience, r.slug).toBe(Q1_DEFAULTS[r.slug]);
  });

  it("PATCH saves a new audience (trimmed) and returns the row", async () => {
    const sdb = createDb();
    const id = vid(sdb, "finance");
    const res = await call(sdb, "PATCH", `/api/admin/verticals/${id}`, { audience: "  young savers  " });
    expect(res.status).toBe(200);
    expect(res.json.resource).toMatchObject({ id, slug: "finance", audience: "young savers" });
    expect(audienceOf(sdb, "finance")).toBe("young savers");
    // Only that Vertical changed.
    expect(audienceOf(sdb, "travel")).toBe(Q1_DEFAULTS.travel);
  });

  it("PATCH with an empty string or null clears it (NULL)", async () => {
    const sdb = createDb();
    for (const audience of ["", "   ", null]) {
      await call(sdb, "PATCH", `/api/admin/verticals/${vid(sdb, "food")}`, { audience: "x" });
      const res = await call(sdb, "PATCH", `/api/admin/verticals/${vid(sdb, "food")}`, { audience });
      expect(res.status, JSON.stringify(audience)).toBe(200);
      expect(audienceOf(sdb, "food")).toBeNull();
    }
  });

  it("PATCH refuses \"{{\" / \"}}\" with the exact message and changes nothing", async () => {
    const sdb = createDb();
    for (const audience of ["{{audience}}", "readers }} of"]) {
      const res = await call(sdb, "PATCH", `/api/admin/verticals/${vid(sdb, "health")}`, { audience });
      expect(res.status).toBe(400);
      expect(res.json.error).toBe(MSG);
      expect(audienceOf(sdb, "health")).toBe(Q1_DEFAULTS.health);
    }
  });

  it("PATCH refuses more than 200 characters, a missing audience and non-text", async () => {
    const sdb = createDb();
    const id = vid(sdb, "tech");
    const ok = await call(sdb, "PATCH", `/api/admin/verticals/${id}`, { audience: "a".repeat(200) });
    expect(ok.status).toBe(200);
    const long = await call(sdb, "PATCH", `/api/admin/verticals/${id}`, { audience: "a".repeat(201) });
    expect(long.status).toBe(400);
    expect(long.json.code).toBe("AUDIENCE_TOO_LONG");
    expect((await call(sdb, "PATCH", `/api/admin/verticals/${id}`, {})).status).toBe(400);
    expect((await call(sdb, "PATCH", `/api/admin/verticals/${id}`, { audience: 5 })).status).toBe(400);
    expect(audienceOf(sdb, "tech")).toBe("a".repeat(200));
  });

  it("PATCH 404s an unknown Vertical and 400s a bad id", async () => {
    const sdb = createDb();
    const missing = await call(sdb, "PATCH", "/api/admin/verticals/9999", { audience: "anyone" });
    expect(missing.status).toBe(404);
    expect(missing.json.error).toBe("Vertical not found");
    expect((await call(sdb, "PATCH", "/api/admin/verticals/abc", { audience: "anyone" })).status).toBe(400);
  });

  it("POST create saves an optional audience; without one it is NULL", async () => {
    const sdb = createDb();
    const withAud = await call(sdb, "POST", "/api/admin/verticals", { name: "Insurance", slug: "insurance", audience: " people comparing insurance " });
    expect(withAud.status).toBe(201);
    expect(withAud.json.resource).toMatchObject({ slug: "insurance", audience: "people comparing insurance" });
    expect(audienceOf(sdb, "insurance")).toBe("people comparing insurance");

    const without = await call(sdb, "POST", "/api/admin/verticals", { name: "Pets", slug: "pets" });
    expect(without.status).toBe(201);
    expect(audienceOf(sdb, "pets")).toBeNull();
    const blank = await call(sdb, "POST", "/api/admin/verticals", { name: "Cars", slug: "cars", audience: "" });
    expect(blank.status).toBe(201);
    expect(audienceOf(sdb, "cars")).toBeNull();
  });

  it("POST create refuses \"{{\" and > 200 characters, adding nothing", async () => {
    const sdb = createDb();
    const bad = await call(sdb, "POST", "/api/admin/verticals", { name: "Pets", slug: "pets", audience: "{{audience}}" });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe(MSG);
    const long = await call(sdb, "POST", "/api/admin/verticals", { name: "Pets", slug: "pets", audience: "a".repeat(201) });
    expect(long.status).toBe(400);
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM verticals").get() as { n: number }).n).toBe(9);
  });

  it("the Verticals screen shows the saved audiences", async () => {
    const sdb = createDb();
    const html = await page(sdb, "/admin/verticals");
    const doc = miniDocument(html);
    const cell = doc.querySelector(`[data-vertical-audience-cell="${vid(sdb, "jobs")}"]`) as MiniNode;
    expect(cell.textContent).toBe(Q1_DEFAULTS.jobs);
    expect(cell.getAttribute("title")).toBe(Q1_DEFAULTS.jobs);
  });
});

// ---------------------------------------------------------------------------
// The screen (HTML) and its script
// ---------------------------------------------------------------------------

const ROWS = [
  { id: 2, slug: "finance", name: "Finance", audience: "people who want to make smarter everyday money decisions", site_count: 2, category_count: 3, article_count: 40 },
  { id: 9, slug: "jobs", name: "Jobs & Employment", audience: null, site_count: 1, category_count: 1, article_count: 10 },
];

describe("X06 Verticals screen (HTML)", () => {
  const html = verticalsListPage(ROWS);
  const doc = miniDocument(html);

  it("has the Audience column between Slug and Sites", () => {
    const heads = doc.querySelectorAll("table.verticals-list th").map((n) => n.textContent);
    expect(heads).toEqual(["Name", "Slug", "Audience", "Sites", "Categories", "Articles", "Actions"]);
    const cells = (doc.querySelector('tr[data-vertical-id="2"]') as MiniNode).querySelectorAll("td");
    expect(cells[2]!.textContent).toBe(ROWS[0]!.audience);
    expect(cells[3]!.textContent).toBe("2");
  });

  it("the cell is muted, one line, cut with … and has the full text on hover; empty shows —", () => {
    const full = doc.querySelector('[data-vertical-audience-cell="2"]') as MiniNode;
    expect(full.className).toBe("vertical-audience");
    expect(full.getAttribute("title")).toBe(ROWS[0]!.audience);
    expect(html).toContain(".vertical-audience{max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--c-muted)}");
    const empty = doc.querySelector('[data-vertical-audience-cell="9"]') as MiniNode;
    expect(empty.textContent).toBe("—");
    expect(empty.getAttribute("title")).toBeNull();
  });

  it("has an \"Edit audience\" button next to \"Delete\" on every row", () => {
    for (const r of ROWS) {
      const row = doc.querySelector(`tr[data-vertical-id="${r.id}"]`) as MiniNode;
      const buttons = row.querySelectorAll("button");
      expect(buttons.map((b) => b.textContent)).toEqual(["Edit audience", "Delete"]);
      expect(buttons[0]!.className).toBe("btn btn-secondary btn-sm");
      expect(buttons[0]!.getAttribute("data-edit-audience")).toBe(String(r.id));
      expect(buttons[0]!.getAttribute("data-vertical-audience")).toBe(r.audience ?? "");
    }
  });

  it("has the edit modal with one Audience field and Save", () => {
    const modal = doc.getElementById("audience-vertical-modal") as MiniNode;
    expect(modal).not.toBeNull();
    const input = doc.getElementById("audience-vertical-input") as MiniNode;
    expect(input.getAttribute("maxlength")).toBe("200");
    expect(modal.querySelector('button[type="submit"]')!.textContent).toBe("Save");
  });

  it("\"Add vertical\" has an optional Audience field under Slug, with the help text", () => {
    const form = doc.getElementById("new-vertical-form") as MiniNode;
    const ids = form.querySelectorAll("input").map((n) => n.getAttribute("id"));
    expect(ids).toEqual(["new-vertical-name", "new-vertical-slug", "new-vertical-audience"]);
    const aud = doc.getElementById("new-vertical-audience") as MiniNode;
    expect(aud.hasAttribute("required")).toBe(false);
    expect(aud.getAttribute("maxlength")).toBe("200");
    expect(form.textContent).toContain("Default for new sites in this Vertical. Each site can change its own in Settings → General. Empty = \"readers interested in");
  });
});

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}
const flush = () => new Promise((r) => setTimeout(r, 0));

function scriptOf(html: string): string {
  const all = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  const own = all.find((s) => s.includes("var SLUG_RE"));
  if (!own) throw new Error("no Verticals script");
  return own;
}

function boot(respond: (url: string, body: Record<string, unknown>) => Promise<unknown>) {
  const html = verticalsListPage(ROWS);
  const doc = miniDocument(html);
  const fetches: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
  const toasts: Array<[string, string]> = [];
  const fetchStub = vi.fn((url: string, init: { method?: string; body?: string }) => {
    const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
    fetches.push({ url, method: String(init.method), body });
    return respond(url, body);
  });
  const windowObj = {
    location: { reload: vi.fn() },
    showToast: (m: string, t: string) => { toasts.push([m, t]); },
    generateSlug: (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    confirmDelete: () => false,
    api: vi.fn(),
  };
  runInNewContext(scriptOf(html), { window: windowObj, document: doc, fetch: fetchStub, JSON, String, parseInt, encodeURIComponent });
  // The page's <script> also carries the shell helpers, which replace
  // window.showToast with the real (DOM-drawing) one; record calls instead.
  windowObj.showToast = (m: string, t: string) => { toasts.push([m, t]); };
  const el = (id: string) => doc.getElementById(id) as MiniNode;
  return { doc, el, fetches, toasts };
}

describe("X06 Verticals screen script — Edit audience", () => {
  it("opens \"Audience for <name>\", PATCHes, updates the row and shows a toast", async () => {
    const { doc, el, fetches, toasts } = boot((_u, body) =>
      jsonResponse(200, { resource: { id: 9, slug: "jobs", name: "Jobs & Employment", audience: body.audience } }),
    );
    (doc.querySelector('button[data-edit-audience="9"]') as MiniNode).click();
    expect(el("audience-vertical-modal").getAttribute("aria-hidden")).toBe("false");
    expect(el("audience-vertical-modal-title").textContent).toBe("Audience for Jobs & Employment");
    expect(el("audience-vertical-help").textContent).toContain('Empty = "readers interested in Jobs & Employment".');
    expect(el("audience-vertical-input").value).toBe("");

    el("audience-vertical-input").value = "  people looking for work ";
    el("audience-vertical-form").fire("submit");
    expect(fetches).toEqual([{ url: "/api/admin/verticals/9", method: "PATCH", body: { audience: "people looking for work" } }]);
    await flush();
    await flush();
    const cell = doc.querySelector('[data-vertical-audience-cell="9"]') as MiniNode;
    expect(cell.textContent).toBe("people looking for work");
    expect(cell.getAttribute("title")).toBe("people looking for work");
    expect(el("audience-vertical-error").textContent).toBe("");
    expect(toasts).toEqual([["Audience saved", "success"]]);
    expect(el("audience-vertical-modal").getAttribute("aria-hidden")).toBe("true");
  });

  it("refuses \"{{\" on screen without a request", () => {
    const { doc, el, fetches } = boot(() => jsonResponse(200, {}));
    (doc.querySelector('button[data-edit-audience="2"]') as MiniNode).click();
    el("audience-vertical-input").value = "{{audience}}";
    el("audience-vertical-form").fire("submit");
    expect(fetches).toEqual([]);
    expect(el("audience-vertical-error").textContent).toBe(MSG);
    expect(el("audience-vertical-error").hidden).toBe(false);
    expect(el("audience-vertical-input").className).toContain("is-invalid");
  });

  it("\"Add vertical\" sends the Audience and refuses \"{{\"", () => {
    const { el, fetches } = boot(() => new Promise(() => undefined));
    // mini-dom has no form.reset(); the real one clears the fields.
    (el("new-vertical-form") as unknown as { reset: () => void }).reset = () => undefined;
    el("open-new-vertical-modal").click();
    el("new-vertical-name").value = "Insurance";
    el("new-vertical-name").fire("input");
    expect(el("new-vertical-audience-name").textContent).toBe("Insurance");
    el("new-vertical-audience").value = "{{audience}}";
    el("new-vertical-form").fire("submit");
    expect(fetches).toEqual([]);
    expect(el("new-vertical-audience-error").textContent).toBe(MSG);

    el("new-vertical-audience").value = "people comparing insurance";
    el("new-vertical-form").fire("submit");
    expect(fetches).toEqual([
      { url: "/api/admin/verticals", method: "POST", body: { name: "Insurance", slug: "insurance", audience: "people comparing insurance" } },
    ]);
  });
});
