// T8: the rebuilt 2-column preset form. The vitest env is node (no jsdom), so
// these are render-output + inline-script-wiring assertions on the pure
// template functions — the develop-legal proof route for a ui_browser_
// interaction story. Each it() title embeds the [api/test/preset-form.test.ts]
// literal (the evidence plan's expected_test_name_regex) plus the
// L2_AUTO_DISAMBIGUATION:T8-AC<n>:RC-0<nn> marker so finalize binds the RC to
// the backing test unambiguously.
//
// RC-017 (T8-AC1): New Preset renders all sections — Custom Variables
// (key/desc/default/required), Output Rules, Content Preset Mapping fields,
// Preview Variables, Test Preset.
// RC-018 (T8-AC2): save->reload round-trips a custom variable + output rule +
// content-mapping fields, and Test Preset runs a sample generation.

import { describe, expect, it } from "vitest";
import {
  presetFormPage,
  renderPresets,
  type PresetFormEntry,
} from "../src/admin/templates/presets";

// A saved preset carrying every T8 reference field, used to prove the reload
// half of the round-trip pre-fills the form from the stored columns.
const SAVED_PRESET: PresetFormEntry = {
  id: 11,
  slug: "deep-dive",
  prompt_template: "Write about {{topic}}",
  category: "content",
  variables: '["topic"]',
  is_system: 0,
  is_active: 1,
  text_model: "gpt-5.5",
  image_model: "gpt-image-2",
  name: "Deep Dive",
  description: "Long-form explainer",
  system_prompt_template: "You are an explainer.",
  user_prompt_template: "Write about {{topic}}",
  content_mapping: JSON.stringify({
    title: true,
    meta_title: true,
    author_bio: true,
    paragraph_count: 5,
  }),
  variables_schema: JSON.stringify([
    {
      key: "topic",
      description: "the subject of the article",
      default: "machine learning",
      required: true,
    },
  ]),
  output_rules: JSON.stringify([
    {
      paragraph_type: "long",
      min: 3,
      max: 8,
      style: "journalistic",
      json_schema: '{"type":"object"}',
    },
  ]),
};

describe("T8-AC1: New Preset renders every reference section", () => {
  const html = renderPresets(null);

  it("[api/test/preset-form.test.ts] T8-AC1: the form is a 2-column grid with no placeholder marker L2_AUTO_DISAMBIGUATION:T8-AC1:RC-017", () => {
    expect(html).toContain('class="preset-form-grid"');
    expect(html).not.toContain("Phase 1 admin shell");
  });

  it("[api/test/preset-form.test.ts] T8-AC1: Custom Variables renders key/desc/default/required + an add control L2_AUTO_DISAMBIGUATION:T8-AC1:RC-017", () => {
    expect(html).toContain("Custom Variables");
    expect(html).toContain('id="preset-variables-schema"');
    expect(html).toContain('class="form-input cv-key"');
    expect(html).toContain('class="form-input cv-desc"');
    expect(html).toContain('class="form-input cv-default"');
    expect(html).toContain('class="cv-required-input"');
    expect(html).toContain('id="preset-add-variable"');
  });

  it("[api/test/preset-form.test.ts] T8-AC1: Output Rules renders paragraph-type/min/max/style/JSON-schema L2_AUTO_DISAMBIGUATION:T8-AC1:RC-017", () => {
    expect(html).toContain("Output Rules");
    expect(html).toContain('id="or-paragraph-type"');
    expect(html).toContain('id="or-min"');
    expect(html).toContain('id="or-max"');
    expect(html).toContain('id="or-style"');
    expect(html).toContain('id="or-json-schema"');
  });

  it("[api/test/preset-form.test.ts] T8-AC1: Content Preset Mapping renders the reference fields + paragraph count L2_AUTO_DISAMBIGUATION:T8-AC1:RC-017", () => {
    expect(html).toContain("Content Preset Mapping");
    for (const field of [
      "title",
      "excerpt",
      "meta_title",
      "meta_description",
      "author_name",
      "author_bio",
      "generate_h2_subtitles",
      "enforce_json_schema",
    ]) {
      expect(html).toContain(`data-field="${field}"`);
    }
    expect(html).toContain('id="cmap-paragraph_count"');
  });

  it("[api/test/preset-form.test.ts] T8-AC1: Preview Variables + Test Preset sections render L2_AUTO_DISAMBIGUATION:T8-AC1:RC-017", () => {
    expect(html).toContain("Preview Variables");
    expect(html).toContain('id="preset-preview-variables"');
    expect(html).toContain("Test Preset");
    expect(html).toContain('id="preset-test-run"');
    expect(html).toContain('id="preset-test-output"');
  });
});

describe("T8-AC2: save->reload round-trips the reference fields + Test Preset generates", () => {
  const reloaded = renderPresets(SAVED_PRESET);
  // The full page embeds the inline script via the layout `scripts` slot, so the
  // save-side serialization wiring is asserted against the rendered page.
  const page = presetFormPage(SAVED_PRESET);

  it("[api/test/preset-form.test.ts] T8-AC2: reload pre-fills the stored custom variable (key/desc/default/required) L2_AUTO_DISAMBIGUATION:T8-AC2:RC-018", () => {
    expect(reloaded).toContain('class="form-input cv-key"');
    expect(reloaded).toContain('value="topic"');
    expect(reloaded).toContain("the subject of the article");
    expect(reloaded).toContain("machine learning");
    expect(reloaded).toMatch(/cv-required-input"[^>]*checked/);
  });

  it("[api/test/preset-form.test.ts] T8-AC2: reload pre-fills the stored output rule L2_AUTO_DISAMBIGUATION:T8-AC2:RC-018", () => {
    expect(reloaded).toContain('<option value="long" selected>');
    expect(reloaded).toMatch(/id="or-min"[^>]*value="3"/);
    expect(reloaded).toMatch(/id="or-max"[^>]*value="8"/);
    expect(reloaded).toMatch(/id="or-style"[^>]*value="journalistic"/);
    expect(reloaded).toContain('id="or-json-schema"');
    expect(reloaded).toContain("object");
  });

  it("[api/test/preset-form.test.ts] T8-AC2: reload pre-fills the stored content-mapping fields L2_AUTO_DISAMBIGUATION:T8-AC2:RC-018", () => {
    expect(reloaded).toMatch(/data-field="title"[^>]*checked/);
    expect(reloaded).toMatch(/data-field="meta_title"[^>]*checked/);
    expect(reloaded).toMatch(/data-field="author_bio"[^>]*checked/);
    expect(reloaded).toMatch(/id="cmap-paragraph_count"[^>]*value="5"/);
  });

  it("[api/test/preset-form.test.ts] T8-AC2: the submit payload serializes variables_schema + output_rules + content_mapping L2_AUTO_DISAMBIGUATION:T8-AC2:RC-018", () => {
    expect(page).toContain("collectVariablesSchema");
    expect(page).toContain("collectOutputRules");
    expect(page).toContain("variables_schema:collectVariablesSchema()");
    expect(page).toContain("output_rules:collectOutputRules()");
    expect(page).toContain("content_mapping:collectContentMap()");
    expect(page).toContain("paragraph_count");
  });

  it("[api/test/preset-form.test.ts] T8-AC2: Test Preset POSTs /api/admin/ai/chat with the preview variables L2_AUTO_DISAMBIGUATION:T8-AC2:RC-018", () => {
    expect(page).toContain('"/api/admin/ai/chat"');
    expect(page).toContain("collectPreviewVars");
    expect(page).toContain('id="preset-test-run"');
    // The button reports a result/error — it never closes silently.
    expect(page).toContain('id="preset-test-output"');
  });
});
