// X15 (D3) — pasting a Google Docs / Word document into the PAGE editor keeps
// headings, lists, bold, italics and links (it used to flatten every line
// into a plain paragraph). Runs the REAL BlockEditor class from
// editor-scripts.ts in node:vm over the mini DOM, and renders the result
// with the real publish renderer.

import { describe, it, expect } from "vitest";
import { runInNewContext } from "node:vm";
import { editorScripts } from "../src/editor/editor-scripts";
import { blockEditorMountScript } from "../src/editor/mount";
import { blocksToHtml } from "../src/editor/blocks-to-html";
import { miniDocument } from "./helpers/mini-dom";

type Block = { id: string; type: string; data: Record<string, unknown> };
type Editor = {
  options: Record<string, unknown>;
  _richPasteBlocks(html: string): Block[] | null;
};

function makeEditor(): Editor {
  const doc = miniDocument("<html><body></body></html>");
  const out: { BE?: { prototype: object } } = {};
  const DOMParser = class {
    parseFromString(html: string): unknown {
      return miniDocument(/<body[\s>]/i.test(html) ? html : `<html><body>${html}</body></html>`);
    }
  };
  runInNewContext(`${editorScripts}\n;__out.BE = BlockEditor;`, {
    window: {},
    document: doc,
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    DOMParser,
    __out: out,
    console,
  });
  const ed = Object.create((out.BE as { prototype: object }).prototype) as Editor;
  ed.options = { richPaste: true, listicle: null };
  return ed;
}

const GOOGLE_DOC =
  '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1">' +
  '<h1 dir="ltr"><span style="font-size:20pt;">Privacy Policy</span></h1>' +
  '<p dir="ltr"><span style="font-weight:700;">Bold</span><span> and </span><span style="font-style:italic;">italic</span><span> </span>' +
  '<a href="https://example.com/a"><span>link</span></a></p>' +
  '<h2 dir="ltr"><span>What we collect</span></h2>' +
  '<ul><li dir="ltr"><p dir="ltr"><span>One</span></p></li><li dir="ltr"><p dir="ltr"><span>Two</span></p></li></ul>' +
  '<h4><span>Deep heading</span></h4>' +
  "</b>";

describe("X15 D3 rich paste on the Page editor", () => {
  it("a Google Docs paste keeps headings, lists, bold, italics and links", () => {
    const blocks = makeEditor()._richPasteBlocks(GOOGLE_DOC);
    expect(blocks).not.toBeNull();
    const b = blocks as Block[];
    expect(b.map((x) => x.type)).toEqual(["heading", "paragraph", "heading", "list", "heading"]);
    expect(b[0]?.data).toMatchObject({ text: "Privacy Policy", level: 1 });
    expect(b[1]?.data.html).toBe('<strong>Bold</strong> and <em>italic</em> <a href="https://example.com/a">link</a>');
    expect(b[3]?.data).toMatchObject({ style: "unordered", items: ["One", "Two"] });
    expect(b[4]?.data).toMatchObject({ text: "Deep heading", level: 3 });
    expect(blocksToHtml({ blocks: b })).toBe(
      '<h1>Privacy Policy</h1><p><strong>Bold</strong> and <em>italic</em> <a href="https://example.com/a">link</a></p>' +
        "<h2>What we collect</h2><ul><li>One</li><li>Two</li></ul><h3>Deep heading</h3>",
    );
  });

  it("a Word-style paste of several paragraphs becomes several paragraphs", () => {
    const blocks = makeEditor()._richPasteBlocks(
      '<html><body><p class="MsoNormal"><b>Title line</b></p><p class="MsoNormal">Body text</p><ol><li>First</li></ol></body></html>',
    ) as Block[];
    expect(blocks.map((x) => x.type)).toEqual(["paragraph", "paragraph", "list"]);
    expect(blocks[0]?.data.html).toBe("<strong>Title line</strong>");
    expect(blocks[2]?.data).toMatchObject({ style: "ordered", items: ["First"] });
  });

  it("a single run of text has no structure, so it falls back to the plain-text paste", () => {
    expect(makeEditor()._richPasteBlocks("<span>just some words</span>")).toBeNull();
  });

  it("unsafe links lose their address but keep their text", () => {
    const blocks = makeEditor()._richPasteBlocks('<p><a href="javascript:alert(1)">click</a></p><p>after</p>') as Block[];
    expect(blocks).toHaveLength(2);
    expect(String(blocks[0]?.data.html ?? "")).not.toContain("javascript");
    expect(blocks[0]?.data.text).toBe("click");
  });

  it("only the Page form turns rich paste on; the Articles mount bytes are unchanged", () => {
    expect(blockEditorMountScript("Start writing your article...")).not.toContain("richPaste");
    expect(blockEditorMountScript("Start writing your page...", { richPaste: true })).toContain(",richPaste:true}");
    expect(editorScripts).toContain("richPaste: options.richPaste === true");
    expect(editorScripts).toContain("if (rich && this.options.richPaste");
  });
});
