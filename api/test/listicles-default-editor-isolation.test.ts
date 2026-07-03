// Listicles Phase 4 — pillar-1 regression tripwire: the DEFAULT (non-listicle)
// admin editor pages carry ZERO listicle activation.
//
// The listicle grammar rides the SHARED editor atom behind `options.listicle`
// (editor-scripts.ts). This suite pins the gating from the OUTSIDE: rendering
// the existing homepage Articles/Pages editor forms must yield
//   * the canonical `editorScripts` atom byte-identically (reuse, not fork),
//   * a mount call that passes NO `listicle` configuration,
//   * page-authored scripts (atom stripped) with no listicle boot/config/
//     picker markers,
//   * DOM markup with no listicle surfaces (picker/inventory/preview/
//     edit-cards), and no curated-colour CSS rules.
// If someone un-gates a listicle branch or wires the config into a default
// page, one of these trips — without pinning brittle byte-golden output.

import { describe, expect, it } from "vitest";
import { articleFormPage } from "../src/admin/templates/articles";
import { pageFormPage } from "../src/admin/templates/pages";
import { editorScripts } from "../src/editor/editor-scripts";

const PAGES: ReadonlyArray<[string, string]> = [
  ["articles-new", articleFormPage(null, [], [], {})],
  ["pages-new", pageFormPage(null, [], {})],
];

const SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const STYLE_RE = /<style[^>]*>([\s\S]*?)<\/style>/gi;

function inlineScripts(html: string): string {
  const blocks: string[] = [];
  for (const match of html.matchAll(SCRIPT_RE)) blocks.push(match[1] ?? "");
  return blocks.join("\n;\n");
}

function inlineStyles(html: string): string {
  const blocks: string[] = [];
  for (const match of html.matchAll(STYLE_RE)) blocks.push(match[1] ?? "");
  return blocks.join("\n");
}

function domOnly(html: string): string {
  return html
    .replace(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
}

describe("default editor pages — zero listicle activation (pillar 1)", () => {
  for (const [label, html] of PAGES) {
    const script = inlineScripts(html);

    it(`${label}: embeds the SHARED editor atom byte-identically (no fork)`, () => {
      const first = script.indexOf(editorScripts);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(script.indexOf(editorScripts, first + 1)).toBe(-1);
    });

    it(`${label}: the mount call passes NO listicle configuration`, () => {
      const remainder = script.replace(editorScripts, "");
      const mount = remainder.match(/initBlockEditor\(\s*"content-editor"\s*,\s*\{[^}]*\}/);
      expect(mount, "the default mount call must exist").not.toBeNull();
      expect(mount?.[0]).not.toContain("listicle");
    });

    it(`${label}: page-authored scripts carry no listicle markers (atom stripped)`, () => {
      const remainder = script.replace(editorScripts, "");
      for (const marker of [
        "_lstEditorBoot",
        "lstOfferPicker",
        "lstOfferModal",
        "choice_button_group",
        "final_text_cta",
        "linked_image",
        "data-lst-color",
        "reference-choice-button",
        "listicleEditorClientConfig",
      ]) {
        expect(remainder, `${label} script marker: ${marker}`).not.toContain(marker);
      }
    });

    it(`${label}: DOM carries no listicle surfaces`, () => {
      const dom = domOnly(html);
      for (const marker of [
        "lst-offer-picker",
        "lst-inv-body",
        "lst-section-preview",
        "data-lst-kind",
        "lst-cta-inventory",
        "lst-headline-chip",
      ]) {
        expect(dom, `${label} DOM marker: ${marker}`).not.toContain(marker);
      }
    });

    it(`${label}: no curated colour-token CSS rules`, () => {
      const css = inlineStyles(html);
      expect(css).not.toContain("[data-lst-color=");
      expect(css).not.toContain("[data-lst-highlight=");
    });
  }
});
