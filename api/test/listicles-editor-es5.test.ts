// Listicles Phase 4 — ES5 discipline for the Section editor page (§25
// "ES5-only inline scripts", extending listicles-ui-es5.test.ts to the new
// pages/scripts).
//
// adminLayout emits ONE inline <script> per page, so the invariant here is:
//   1. the page's script contains the SHARED `editorScripts` atom
//      byte-identically, exactly once (the ONLY pre-existing non-ES5 code —
//      reused, not forked; pillar 1);
//   2. with that atom removed, the REMAINDER (everything Phase 4 authored:
//      shared hydration, offer modal, §13 picker, section-image script, boot
//      payload, page + mount scripts) is strict ES5 — zero arrow/const/let/
//      async/await/backtick;
//   3. the FULL emitted script byte-parses via `node --check`
//      (admin-inline-scripts-parse mechanism).

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  listiclesSectionEditorPage,
  listiclesSectionNotFoundPage,
  type SectionEditorPageProps,
} from "../src/admin/listicles/ui-section-editor";
import { editorScripts } from "../src/editor/editor-scripts";
import { OFFER_PICKER_SCRIPT } from "../src/admin/listicles/ui-offer-picker";
import { OFFER_MODAL_SCRIPT } from "../src/admin/listicles/ui-offers";
import type { SectionRow } from "../src/admin/listicles/sections-handlers";

const sectionFixture: SectionRow = {
  id: 5,
  public_id: "sec_fixture0001",
  section_name: 'Fixture <em>"Section"</em> & Co',
  headline_text: "The `headline` fixture <script>",
  headline_offer_id: 3,
  image_json: JSON.stringify({ type: "image", media_id: 9, url: "/media/x.png" }),
  content_json: JSON.stringify({
    version: 1,
    blocks: [
      { id: "p1", type: "paragraph", data: { text: "hello" } },
      {
        id: "g1",
        type: "choice_button_group",
        data: {
          layout_binding: "default.choiceButtonGroup",
          prompt: "Q?",
          items: [
            {
              id: "i1",
              link_instance_id: "lnk_X",
              text: "A `tricky` label</script>",
              offer_id: "off_A",
              style_id: "reference-choice-button",
            },
          ],
        },
      },
    ],
  }),
  content_html: "<p>hello</p>",
  ai_settings_json: JSON.stringify({ preset_id: 2, prompt: "write" }),
  content_version: 1,
  status: "active",
  created_by: null,
  created_at: 1700000000,
  updated_at: 1700000000,
};

const editProps: SectionEditorPageProps = {
  mode: "edit",
  section: sectionFixture,
  linkInstances: [
    {
      public_id: "lnk_H",
      block_id: "__headline__",
      link_role: "headline",
      offer_public_id: "off_H",
      offer_name: "Headline `Offer` <&>",
    },
    {
      public_id: "lnk_X",
      block_id: "g1",
      link_role: "choice_button",
      offer_public_id: "off_A",
      offer_name: "Choice Offer",
    },
  ],
};

const PAGES: ReadonlyArray<[string, string]> = [
  ["editor-new", listiclesSectionEditorPage({ mode: "new", section: null, linkInstances: [] })],
  ["editor-edit", listiclesSectionEditorPage(editProps, { userEmail: "a@b.c" })],
  ["editor-404", listiclesSectionNotFoundPage({})],
];

const SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

function extractScripts(html: string): string[] {
  const blocks: string[] = [];
  for (const match of html.matchAll(SCRIPT_RE)) blocks.push(match[1] ?? "");
  return blocks;
}

function assertStrictEs5(label: string, source: string): void {
  expect(source, `${label}: arrow fn`).not.toMatch(/=>/);
  expect(source, `${label}: const`).not.toMatch(/\bconst\b/);
  expect(source, `${label}: let`).not.toMatch(/\blet\b/);
  expect(source, `${label}: async`).not.toMatch(/\basync\b/);
  expect(source, `${label}: await`).not.toMatch(/\bawait\b/);
  expect(source, `${label}: template literal`).not.toContain("`");
}

describe("Section editor pages — ES5 discipline (§25)", () => {
  for (const [label, html] of PAGES) {
    const scripts = extractScripts(html);

    it(`${label}: everything OUTSIDE the shared editor atom is strict ES5`, () => {
      expect(scripts.length).toBeGreaterThan(0);
      const full = scripts.join("\n;\n");
      if (label === "editor-404") {
        // No editor on the 404 shell — the whole page must be ES5.
        assertStrictEs5(label, full);
        return;
      }
      // The ONLY non-ES5 content is the canonical editor atom, embedded
      // byte-identically exactly once.
      const first = full.indexOf(editorScripts);
      expect(first, `${label}: editorScripts atom embedded byte-identically`).toBeGreaterThanOrEqual(0);
      expect(full.indexOf(editorScripts, first + 1), `${label}: atom appears once`).toBe(-1);
      assertStrictEs5(label, full.replace(editorScripts, ""));
    });
  }

  it("the §13 picker + offer-modal atoms are strict ES5 stand-alone", () => {
    assertStrictEs5("OFFER_PICKER_SCRIPT", OFFER_PICKER_SCRIPT);
    assertStrictEs5("OFFER_MODAL_SCRIPT", OFFER_MODAL_SCRIPT);
    expect(OFFER_PICKER_SCRIPT).toContain("window.lstOfferPicker");
    expect(OFFER_MODAL_SCRIPT).toContain("window.lstOfferModal");
  });
});

// --- node --check parse gate (admin-inline-scripts-parse mechanism) ---------

const scratchDir = mkdtempSync(join(tmpdir(), "listicles-editor-parse-"));
let fileSeq = 0;

function parseError(label: string, source: string): string | null {
  const file = join(scratchDir, `${++fileSeq}-${label.replace(/[^\w-]/g, "_")}.js`);
  writeFileSync(file, source, "utf-8");
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    return null;
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? String(err);
    return `${label}: ${stderr.split("\n").slice(0, 5).join("\n")}`;
  }
}

describe("Section editor pages — emitted inline scripts parse (node --check)", () => {
  for (const [label, html] of PAGES) {
    it(`${label}: every emitted inline <script> parses as standalone JavaScript`, () => {
      const scripts = extractScripts(html);
      const errors: string[] = [];
      scripts.forEach((script, i) => {
        const err = parseError(`${label}-script${i + 1}`, script);
        if (err) errors.push(err);
      });
      expect(errors, errors.join("\n\n")).toEqual([]);
    });
  }
});
