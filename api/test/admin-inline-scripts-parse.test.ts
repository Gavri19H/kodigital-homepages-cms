// Admin inline-script parse gate.
//
// Every admin page ships its client JS as ONE inline <script> block
// (adminLayout: `<script>${ADMIN_SCRIPTS}${scripts}</script>`). The scripts are
// authored as server-side template literals, which tsc treats as opaque
// strings — a client-side syntax error (e.g. a `\'` that the template literal
// collapses to `'`) ships silently and kills ALL JS on the page (June 22
// regression: editor-scripts.ts FAQ onclick emitted `removeFaqRow('' + bid …`,
// one SyntaxError disabled the entire article editor in production).
//
// This suite parses the EMITTED bytes with `node --check` (pure syntax parse,
// no evaluation): first every exported script atom individually (precise
// attribution), then every assembled admin page (covers concatenation glue and
// the module-private ADMIN_SCRIPTS).

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { editorScripts } from "../src/editor/editor-scripts";
import { blockEditorMountScript } from "../src/editor/mount";
import { aiAssistantScripts } from "../src/admin/templates/ai-panel-script";
import { heroImageScripts } from "../src/admin/templates/hero-image-script";
import { workflowPanelScripts } from "../src/admin/templates/workflow-panel-script";
import { PRESET_FORM_SCRIPT } from "../src/admin/templates/presets-form-script";
import { SETTINGS_SCRIPT } from "../src/admin/templates/settings";
import { listFilterScript } from "../src/admin/templates/layout";
import {
  articleFormPage,
  articlesListPage,
  categoriesListPage,
  dashboardPage,
  domainsPage,
  mediaListPage,
  pageFormPage,
  pagesListPage,
  presetFormPage,
  presetsListPage,
  settingsPage,
  tagsListPage,
} from "../src/admin/templates";

const scratchDir = mkdtempSync(join(tmpdir(), "admin-script-parse-"));
let fileSeq = 0;

/** Parse `source` as a standalone script with node --check; return the error text or null. */
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

const SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

function pageScriptErrors(label: string, html: string): string[] {
  const errors: string[] = [];
  let blocks = 0;
  for (const match of html.matchAll(SCRIPT_RE)) {
    blocks += 1;
    const err = parseError(`${label}#script${blocks}`, match[1] ?? "");
    if (err) errors.push(err);
  }
  if (blocks === 0) errors.push(`${label}: expected at least one inline <script> block, found none`);
  return errors;
}

describe("admin inline-script parse gate", () => {
  it("every exported inline-script atom parses as standalone JavaScript", () => {
    const atoms: Record<string, string> = {
      editorScripts,
      blockEditorMountScript: blockEditorMountScript("placeholder"),
      aiAssistantScripts,
      heroImageScripts,
      workflowPanelScripts,
      PRESET_FORM_SCRIPT,
      SETTINGS_SCRIPT,
      listFilterScript,
    };
    const errors = Object.entries(atoms)
      .map(([label, source]) => parseError(label, source))
      .filter((e): e is string => e !== null);
    expect(errors).toEqual([]);
  });

  it("every assembled admin page's inline scripts parse as JavaScript", () => {
    const branding = { userEmail: "gate@test.local" };
    const site = { id: "st_test", name: "Test Site" };
    const category = { id: "1", name: "Test Category" };
    const editArticle = {
      id: "42",
      title: "T",
      slug: "t",
      content_json: "[]",
      status: "draft",
      site_id: "st_test",
    } as Parameters<typeof articleFormPage>[0];

    const pages: Record<string, () => string> = {
      "articleForm(new)": () => articleFormPage(null, [site], [category], branding),
      "articleForm(edit)": () => articleFormPage(editArticle, [site], [category], branding),
      articlesList: () =>
        articlesListPage([], [site], [], [category], branding, undefined as never),
      "pageForm(new)": () => pageFormPage(null, [site], branding),
      pagesList: () => pagesListPage([], [site], branding),
      categoriesList: () => categoriesListPage([], [site], branding),
      tagsList: () => tagsListPage([], [site], branding),
      mediaList: () => mediaListPage([], [site], branding, null),
      presetsList: () => presetsListPage([], branding),
      "presetForm(new)": () => presetFormPage(null, branding),
      settings: () => settingsPage([site], {}, null, branding),
      dashboard: () => dashboardPage({} as never, [] as never, branding),
      domains: () => domainsPage([] as never, [] as never, branding),
    };

    const errors: string[] = [];
    for (const [label, render] of Object.entries(pages)) {
      let html: string;
      try {
        html = render();
      } catch (err) {
        errors.push(`${label}: page render threw: ${String(err).slice(0, 200)}`);
        continue;
      }
      errors.push(...pageScriptErrors(label, html));
    }
    expect(errors).toEqual([]);
  });
});
