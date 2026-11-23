// X06 SEO Fixes, Part B fix 3 + Part A audience: the AI panel's
// "Full article" flow, running the REAL ES5 panel script in node:vm over the
// REAL panel HTML (mini-dom), with a stubbed fetch (no network, no AI).
//
//   - The "Audience" field starts filled with the site's audience, and is
//     never overwritten once the operator types in it.
//   - A failed run (502) shows exactly the server's message and changes no
//     editor field.

import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { miniDocument, type MiniNode } from "./helpers/mini-dom";
import { aiAssistantScripts, renderAIAssistantPanel } from "../src/admin/templates/ai-panel";

const FAILED = "The AI didn't answer. Nothing was changed. Try again.";
const SITE_AUDIENCE = "people who want to make smarter everyday money decisions";
const OLD_DOC = JSON.stringify({ version: 2, blocks: [{ type: "paragraph", text: "My own words." }] });

interface Call {
  url: string;
  body: Record<string, unknown> | null;
}

function bootPanel(articleResponse: { status: number; body: unknown }) {
  const html = `<form id="article-form">
    <input name="site_id" value="site-1" />
    <input id="article-title" value="Old title" />
    <input id="article-seo-title" value="Old SEO title" />
    <input id="article-seo-description" value="Old SEO description" />
    <input id="content_json" value='${OLD_DOC}' />
    ${renderAIAssistantPanel()}
  </form>`;
  const doc = miniDocument(html);
  const calls: Call[] = [];
  const fetchStub = (url: string, init?: { body?: unknown }) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url, body });
    if (url.indexOf("/api/admin/ai/article") > -1) {
      if (body && body["lookup"] === "audience") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ audience: SITE_AUDIENCE }) });
      }
      return Promise.resolve({
        ok: articleResponse.status < 400,
        status: articleResponse.status,
        json: () => Promise.resolve(articleResponse.body),
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }) });
  };
  const windowObj = { getSelection: () => "", confirm: () => true, blockEditor: null };
  runInNewContext(aiAssistantScripts, { window: windowObj, document: doc, fetch: fetchStub, Object, String, JSON });
  const el = (id: string) => doc.getElementById(id) as MiniNode;
  const fullArticleBtn = doc.querySelector('[data-quick-action="full_article"]') as MiniNode;
  return { doc, el, calls, fullArticleBtn };
}

const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("X06 AI panel: the Audience field starts with the site's audience", () => {
  it("arming Full article fills Audience with the site's audience", async () => {
    const p = bootPanel({ status: 200, body: {} });
    expect(p.el("ai-fa-audience").value).toBe("");
    p.fullArticleBtn.click();
    await flush();
    const lookup = p.calls.find((c) => c.body && c.body["lookup"] === "audience");
    expect(lookup?.body).toEqual({ site_id: "site-1", lookup: "audience" });
    expect(p.el("ai-fa-audience").value).toBe(SITE_AUDIENCE);
  });

  it("what the operator typed is never overwritten", async () => {
    const p = bootPanel({ status: 200, body: {} });
    p.fullArticleBtn.click();
    p.el("ai-fa-audience").value = "retirees";
    p.el("ai-fa-audience").fire("input");
    await flush();
    expect(p.el("ai-fa-audience").value).toBe("retirees");
  });
});

describe("X06 AI panel: a failed Full article changes nothing", () => {
  it("shows exactly the server's message and leaves every editor field as it was", async () => {
    const p = bootPanel({ status: 502, body: { error: FAILED } });
    p.fullArticleBtn.click();
    await flush();
    p.el("ai-generate-btn").click();
    await flush();
    const gen = p.calls.find((c) => c.url.indexOf("/api/admin/ai/article") > -1 && c.body && !c.body["lookup"]);
    expect(gen, "the Full article request was sent").toBeDefined();
    expect(gen!.body!["audience"]).toBe(SITE_AUDIENCE);
    expect(p.el("ai-panel-error").hidden).toBe(false);
    expect(p.el("ai-panel-error").textContent).toBe(FAILED);
    expect(p.el("ai-panel-status").textContent).toBe("");
    expect(p.el("article-title").value).toBe("Old title");
    expect(p.el("article-seo-title").value).toBe("Old SEO title");
    expect(p.el("article-seo-description").value).toBe("Old SEO description");
    expect(p.el("content_json").value).toBe(OLD_DOC);
  });
});
