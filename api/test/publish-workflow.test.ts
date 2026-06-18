// T12 — Publish workflow: edit-only but functional (D9).
//
// Two behavioral claims, both proven against the SHIPPED code (not a source
// grep). Every it() title embeds the literal [api/test/publish-workflow.test.ts]
// plus the L2 disambiguation marker so the parse_test_output evidence parser
// routes each receipt to its claim:
//   RC-023  ->  T12-AC1  (edit-only publish panel)
//   RC-024  ->  T12-AC2  (publish/schedule call their real endpoints + take
//                         effect: the article becomes live / scheduled_at set)
//
// AC2 is proven at BOTH layers so the AC cannot pass while the user-facing
// outcome is broken (negative_fail_condition):
//   - client: the shipped ES5 panel script (workflowPanelScripts) is RUN in a
//     vm with a DOM stub + routing fetch stub — clicking Publish/Schedule POSTs
//     to the article's real endpoint and the returned status is reflected into
//     the status badge.
//   - server: the real /api/admin/articles/:id/{publish,schedule} routes
//     (admin.request) actually flip the article row (UPDATE ... status =
//     'published') / set scheduled_at, and return the new status.

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { articleFormPage, type SiteOption } from "../src/admin/templates/articles";
import { workflowPanelScripts } from "../src/admin/templates/workflow-panel";
import admin from "../src/admin/router";
import { buildEnv, makeFakeDb } from "./helpers/admin-test-kit";

const nodeRequire = createRequire(import.meta.url);
const vm = nodeRequire("node:vm") as typeof import("node:vm");

const SITES: ReadonlyArray<SiteOption> = [{ id: "site-1", name: "Demo Site" }];

// ---------------------------------------------------------------------------
// T12-AC1 (RC-023): the publish panel is EDIT-ONLY. Asserted against the full
// articleFormPage() output the admin handler emits — the same render path the
// browser receives. The panel markup (id="workflow-panel", the "Publish
// workflow" heading, data-workflow-action="…") is unique to the RENDERED
// section; the always-included inline script/CSS reference the panel only by
// getElementById('workflow-panel') / .workflow-panel{…}, so these markers
// positively distinguish "panel rendered" from "panel omitted".
// ---------------------------------------------------------------------------
describe("T12-AC1 publish panel is edit-only", () => {
  const newPage = articleFormPage(null, SITES, [], {});
  const editPage = articleFormPage(
    { id: "42", title: "Existing", site_id: "site-1", status: "draft" },
    SITES,
    [],
    {},
  );

  it("[api/test/publish-workflow.test.ts] T12-AC1: New Article renders NO publish panel L2_AUTO_DISAMBIGUATION:T12-AC1:RC-023", () => {
    // The new editor is in new mode (Save first) ...
    expect(newPage).toContain('data-mode="new"');
    // ... and the publish panel section is absent in every form.
    expect(newPage).not.toContain('id="workflow-panel"');
    expect(newPage).not.toContain("<h3 class=\"card-title\">Publish workflow</h3>");
    expect(newPage).not.toContain('data-workflow-action="publish"');
    expect(newPage).not.toContain('data-workflow-action="schedule"');
  });

  it("[api/test/publish-workflow.test.ts] T12-AC1: an Edit context renders the publish panel L2_AUTO_DISAMBIGUATION:T12-AC1:RC-023", () => {
    expect(editPage).toContain('data-mode="edit"');
    // The panel section renders, bound to the persisted article id + status.
    expect(editPage).toContain('id="workflow-panel"');
    expect(editPage).toContain('<h3 class="card-title">Publish workflow</h3>');
    expect(editPage).toContain('data-status="draft"');
    // Every transition control is present and wired to its endpoint key.
    expect(editPage).toContain('data-workflow-action="publish"');
    expect(editPage).toContain('data-workflow-action="unpublish"');
    expect(editPage).toContain('data-workflow-action="archive"');
    expect(editPage).toContain('data-workflow-action="schedule"');
    expect(editPage).toContain('data-workflow-action="cancel-schedule"');
  });
});

// ---------------------------------------------------------------------------
// A tiny DOM stub — just enough surface to RUN the shipped ES5 panel script.
// ---------------------------------------------------------------------------
class FakeEl {
  attrs: Record<string, string> = {};
  children: FakeEl[] = [];
  listeners: Record<string, Array<() => void>> = {};
  value = "";
  hidden = false;
  className = "";
  nodeValue = "";

  get firstChild(): FakeEl | null {
    return this.children.length ? this.children[0]! : null;
  }
  appendChild(n: FakeEl): FakeEl {
    this.children.push(n);
    return n;
  }
  removeChild(n: FakeEl): FakeEl {
    const i = this.children.indexOf(n);
    if (i >= 0) this.children.splice(i, 1);
    return n;
  }
  getAttribute(k: string): string | null {
    return k in this.attrs ? this.attrs[k]! : null;
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = String(v);
  }
  addEventListener(type: string, fn: () => void): void {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  focus(): void {}
  get text(): string {
    return this.children.map((c) => c.nodeValue).join("");
  }
  // querySelectorAll is only called on the panel for '.workflow-action'.
  querySelectorAll(sel: string): FakeEl[] {
    return sel.indexOf("workflow-action") >= 0 ? this._actions : [];
  }
  _actions: FakeEl[] = [];
  fire(type: string): void {
    (this.listeners[type] || []).forEach((fn) => fn.call(this));
  }
}

interface FetchCall {
  url: string;
  init: { method?: string; body?: unknown } | undefined;
}

const WORKFLOW_ACTIONS = [
  "publish",
  "unpublish",
  "archive",
  "schedule",
  "cancel-schedule",
];

// Boot the shipped workflowPanelScripts in a vm with the DOM + a routing fetch
// stub. `respond` lets each test choose the JSON the endpoint returns.
function bootPanel(
  articleId: string,
  respond: (url: string) => { ok: boolean; status: number; body: unknown },
) {
  const ids: Record<string, FakeEl> = {};
  const mk = (id: string) => (ids[id] = new FakeEl());
  const panel = mk("workflow-panel");
  panel.setAttribute("data-article-id", articleId);
  panel.setAttribute("data-status", "draft");
  mk("workflow-status-value");
  mk("workflow-schedule-at");
  mk("workflow-error");
  mk("workflow-status");

  const actions: FakeEl[] = WORKFLOW_ACTIONS.map((a) => {
    const btn = new FakeEl();
    btn.setAttribute("data-workflow-action", a);
    btn.className = "btn workflow-action";
    return btn;
  });
  panel._actions = actions;
  const actionByName: Record<string, FakeEl> = {};
  actions.forEach((b, i) => (actionByName[WORKFLOW_ACTIONS[i]!] = b));

  const doc = {
    getElementById: (id: string) => ids[id] || null,
    createTextNode: (text: string) => {
      const n = new FakeEl();
      n.nodeValue = String(text);
      return n;
    },
  };

  const calls: FetchCall[] = [];
  const fetchStub = (url: string, init?: { method?: string; body?: unknown }) => {
    calls.push({ url, init });
    const r = respond(url);
    return Promise.resolve({
      ok: r.ok,
      status: r.status,
      json: () => Promise.resolve(r.body),
    });
  };

  vm.runInNewContext(workflowPanelScripts, { document: doc, fetch: fetchStub });

  return { panel, ids, actionByName, calls };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// T12-AC2 (RC-024) — client wiring: each action calls its real endpoint and
// the returned status is reflected into the badge.
// ---------------------------------------------------------------------------
describe("T12-AC2 publish panel calls its endpoints + updates state (client)", () => {
  it("[api/test/publish-workflow.test.ts] T12-AC2: Publish POSTs to the article's publish endpoint and reflects the returned status into the badge L2_AUTO_DISAMBIGUATION:T12-AC2:RC-024", async () => {
    const { panel, ids, actionByName, calls } = bootPanel("42", () => ({
      ok: true,
      status: 200,
      body: { ok: true, status: "published", published_at: 1700, scheduled_at: null },
    }));

    actionByName["publish"]!.fire("click");
    await flush();
    await flush();

    const call = calls.find((c) => c.url.indexOf("/publish") > -1);
    expect(call, "Publish posts to the publish endpoint").toBeDefined();
    expect(call!.url).toBe("/api/admin/articles/42/publish");
    expect(call!.init!.method).toBe("POST");
    // Badge + panel reflect the new live status returned by the endpoint.
    const badge = ids["workflow-status-value"]!;
    expect(badge.text).toBe("published");
    expect(badge.className).toBe("badge badge-published");
    expect(panel.getAttribute("data-status")).toBe("published");
  });

  it("[api/test/publish-workflow.test.ts] T12-AC2: Schedule POSTs scheduled_at (epoch) to the schedule endpoint and the badge becomes scheduled L2_AUTO_DISAMBIGUATION:T12-AC2:RC-024", async () => {
    const { panel, ids, actionByName, calls } = bootPanel("42", () => ({
      ok: true,
      status: 200,
      body: { ok: true, status: "scheduled", published_at: null, scheduled_at: 1 },
    }));

    const when = "2031-03-04T09:30";
    const expectedEpoch = Math.floor(new Date(when).getTime() / 1000);
    ids["workflow-schedule-at"]!.value = when;

    actionByName["schedule"]!.fire("click");
    await flush();
    await flush();

    const call = calls.find((c) => c.url.indexOf("/schedule") > -1);
    expect(call, "Schedule posts to the schedule endpoint").toBeDefined();
    expect(call!.url).toBe("/api/admin/articles/42/schedule");
    expect(call!.init!.method).toBe("POST");
    const sent = JSON.parse(String(call!.init!.body)) as { scheduled_at: number };
    expect(sent.scheduled_at).toBe(expectedEpoch);
    expect(ids["workflow-status-value"]!.text).toBe("scheduled");
    expect(panel.getAttribute("data-status")).toBe("scheduled");
  });

  it("[api/test/publish-workflow.test.ts] T12-AC2: Schedule with no date does NOT call the endpoint (input is validated, not silently fired) L2_AUTO_DISAMBIGUATION:T12-AC2:RC-024", async () => {
    const { ids, actionByName, calls } = bootPanel("42", () => ({
      ok: true,
      status: 200,
      body: { ok: true, status: "scheduled" },
    }));
    // No date entered.
    actionByName["schedule"]!.fire("click");
    await flush();
    expect(calls.find((c) => c.url.indexOf("/schedule") > -1)).toBeUndefined();
    expect(ids["workflow-error"]!.hidden).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T12-AC2 (RC-024) — server outcome: the real routes actually take effect.
// ---------------------------------------------------------------------------
const ARTICLE_ROW = {
  id: 42,
  slug: "hello",
  title: "Hello",
  content_json: '{"blocks":[{"type":"paragraph","data":{"text":"hi"}}]}',
  content_html: null,
  category_id: null,
  status: "draft",
  published_at: null,
  scheduled_at: null,
  author_name: null,
  featured_image_id: null,
  is_featured: 0,
  is_trending: 0,
  created_at: 0,
  updated_at: 0,
  site_id: "site-1",
};

describe("T12-AC2 publish/schedule take effect (server)", () => {
  it("[api/test/publish-workflow.test.ts] T12-AC2: POST /publish flips a draft article to published (becomes live) and returns status=published L2_AUTO_DISAMBIGUATION:T12-AC2:RC-024", async () => {
    const { db, calls } = makeFakeDb([
      { match: "SELECT * FROM articles WHERE id = ?", row: { ...ARTICLE_ROW } },
    ]);
    const res = await admin.request(
      "/api/admin/articles/42/publish",
      { method: "POST" },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; published_at: number };
    expect(body.status).toBe("published");
    expect(typeof body.published_at).toBe("number");
    // The article row is actually flipped to published (the live write).
    const upd = calls.find(
      (c) => c.sql.indexOf("UPDATE articles SET status = 'published'") >= 0,
    );
    expect(upd, "publish writes status='published'").toBeDefined();
    expect(upd!.binds[upd!.binds.length - 1]).toBe(42); // WHERE id = ?
  });

  it("[api/test/publish-workflow.test.ts] T12-AC2: POST /schedule sets scheduled_at on the article and returns it L2_AUTO_DISAMBIGUATION:T12-AC2:RC-024", async () => {
    const { db, calls } = makeFakeDb([
      { match: "SELECT * FROM articles WHERE id = ?", row: { ...ARTICLE_ROW } },
    ]);
    const scheduledAt = 1900000000;
    const res = await admin.request(
      "/api/admin/articles/42/schedule",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scheduled_at: scheduledAt }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; scheduled_at: number };
    expect(body.status).toBe("scheduled");
    expect(body.scheduled_at).toBe(scheduledAt);
    const upd = calls.find(
      (c) =>
        c.sql.indexOf("UPDATE articles SET status = 'scheduled'") >= 0 &&
        c.sql.indexOf("scheduled_at = ?") >= 0,
    );
    expect(upd, "schedule writes scheduled_at").toBeDefined();
    expect(upd!.binds[0]).toBe(scheduledAt); // first bind is scheduled_at
    expect(upd!.binds[upd!.binds.length - 1]).toBe(42); // WHERE id = ?
  });

  it("[api/test/publish-workflow.test.ts] T12-AC2: an illegal transition (publish an archived article) is rejected 409 — actions are state-checked L2_AUTO_DISAMBIGUATION:T12-AC2:RC-024", async () => {
    const { db } = makeFakeDb([
      {
        match: "SELECT * FROM articles WHERE id = ?",
        row: { ...ARTICLE_ROW, status: "archived" },
      },
    ]);
    const res = await admin.request(
      "/api/admin/articles/42/publish",
      { method: "POST" },
      buildEnv(db),
    );
    expect(res.status).toBe(409);
  });
});
