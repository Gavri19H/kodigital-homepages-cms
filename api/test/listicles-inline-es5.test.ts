// Listicles Phase 6 — inline-script discipline (hard rule "ES5 inline
// scripts"): the Disclosure interaction script + the §22.4 lazy-hydrator are
// strict ES5 and byte-parse via `node --check` (the repo's
// admin-inline-scripts-parse mechanism, extended to the PUBLIC listicle
// shell).

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  renderListicleDocument,
  type ListicleRenderInput,
  type RenderSectionRow,
} from "../src/public/listicle/render";

const SCRIPT_RE = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;

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

function section(id: number, filler: string): RenderSectionRow {
  return {
    id,
    public_id: `sec_${id}`,
    section_name: `S${id}`,
    headline_text: `Heading ${id}`,
    headline_offer_id: null,
    image_json: null,
    content_json: JSON.stringify({ blocks: [{ type: "paragraph", data: { text: filler } }] }),
  };
}

function input(pages: ListicleRenderInput["pages"], sections: Map<number, RenderSectionRow>): ListicleRenderInput {
  return {
    hostname: "t.example.com",
    brand: { siteName: "T", logoUrl: null },
    settings: {},
    article: { public_id: "art_1", slug: "s" },
    version: {
      public_id: "ver_1",
      headline: "H",
      intro_paragraph: "I",
      hero_url: null,
      byline_json: null,
      layout_style_id: "default",
      content_version: 1,
    },
    pages,
    sections,
    offerPublicIdByRef: new Map(),
  };
}

// A small under-budget shell (Disclosure script only) and an over-budget
// shell (Disclosure + lazy-hydrator).
const smallSections = new Map([[1, section(1, "small")]]);
const smallDoc = renderListicleDocument(
  input(
    [
      {
        public_id: "pg_0",
        page_index: 0,
        selection_mode: "single",
        ab_test_id: null,
        rule_set_id: null,
        candidates: [{ public_id: "cand_0", section_id: 1, is_fallback: 0, rule_public_id: null }],
      },
    ],
    smallSections,
  ),
).html;

const big = "z".repeat(45 * 1024);
const bigSections = new Map([
  [1, section(1, "small")],
  [2, section(2, big)],
  [3, section(3, "small")],
  [4, section(4, big)],
]);
const bigDoc = renderListicleDocument(
  input(
    [
      {
        public_id: "pg_0",
        page_index: 0,
        selection_mode: "ab_test",
        ab_test_id: "ab_0",
        rule_set_id: null,
        candidates: [
          { public_id: "cand_0a", section_id: 1, is_fallback: 0, rule_public_id: null },
          { public_id: "cand_0b", section_id: 2, is_fallback: 0, rule_public_id: null },
        ],
      },
      {
        public_id: "pg_1",
        page_index: 1,
        selection_mode: "ab_test",
        ab_test_id: "ab_1",
        rule_set_id: null,
        candidates: [
          { public_id: "cand_1a", section_id: 3, is_fallback: 0, rule_public_id: null },
          { public_id: "cand_1b", section_id: 4, is_fallback: 0, rule_public_id: null },
        ],
      },
    ],
    bigSections,
  ),
).html;

describe("public listicle shell — inline scripts are strict ES5", () => {
  it("the under-budget shell ships the Disclosure script (ES5)", () => {
    const scripts = extractScripts(smallDoc);
    expect(scripts.length).toBeGreaterThan(0);
    assertStrictEs5("shell", scripts.join("\n;\n"));
    expect(smallDoc).toContain("lst-disclosure");
    expect(smallDoc).not.toContain("XMLHttpRequest"); // no lazy machinery
  });

  it("the over-budget shell adds the lazy-hydrator (ES5, XHR-based)", () => {
    const scripts = extractScripts(bigDoc);
    const joined = scripts.join("\n;\n");
    assertStrictEs5("shell+lazy", joined);
    expect(joined).toContain("XMLHttpRequest");
    expect(joined).toContain("data-lst-lazy");
  });

  it("hydration is scheduled EAGER ON LOAD-IDLE (review finding 2), never on scroll", () => {
    const joined = extractScripts(bigDoc).join("\n;\n");
    // after window load…
    expect(joined).toContain("window.addEventListener('load',schedule)");
    // …already-loaded documents schedule immediately…
    expect(joined).toContain("document.readyState==='complete'");
    // …via requestIdleCallback with a bounded timeout + ES5 setTimeout(0) fallback.
    expect(joined).toContain("requestIdleCallback(hydrateAll,{timeout:2000})");
    expect(joined).toContain("setTimeout(hydrateAll,0)");
    // NO viewport/scroll trigger exists — the swap never waits for the user.
    expect(joined).not.toContain("IntersectionObserver");
    expect(joined).not.toContain("scroll");
  });
});

// --- node --check parse gate -------------------------------------------------

const scratchDir = mkdtempSync(join(tmpdir(), "listicles-p6-parse-"));
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

describe("public listicle shell — every inline <script> parses (node --check)", () => {
  for (const [label, html] of [
    ["under-budget shell", smallDoc],
    ["over-budget shell", bigDoc],
  ] as const) {
    it(`${label}: every emitted inline <script> parses as standalone JavaScript`, () => {
      const scripts = extractScripts(html);
      expect(scripts.length).toBeGreaterThan(0);
      const errors: string[] = [];
      scripts.forEach((script, i) => {
        const err = parseError(`${label}-script${i + 1}`, script);
        if (err) errors.push(err);
      });
      expect(errors, errors.join("\n\n")).toEqual([]);
    });
  }
});
