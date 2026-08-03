// P8-1 F8 — the per-arm theme override must survive the product's OWN readers.
//
// v3.1 §10.1 (owner text): "A funnel variant overrides it for A/B via
// leadgen_funnel_variants.frame_overrides_json.theme_id." §11.1 lists that
// column as holding "A/B frame + theme_id overrides".
//
// The defect (P8 contract §4 R1 — "Two sides of one feature are written to
// different contracts"): the WRITER (PUT /variants/:id) destructures
// `theme_id` out and validates it itself, so the value stores fine — but the
// READERS pass the whole document to validateFrameConfig, which only knew the
// FRAME key set. Live, before this fix, on the running fixture:
//
//   PUT  /api/admin/leadgen/variants/lgn_01KZ279RW7WYQ9361MMFF0D2SW
//        {"frame_overrides_json":{"theme_id":"thm_p8-repro"}}      -> 200
//        stored column: {"theme_id": "thm_p8-repro"}
//   GET  /api/admin/leadgen/quotes/lgq_01KZ271383Y0MPV4BM2WKKCC4W/activation
//        -> [error] frame.theme_id :: Variant 'A': 'theme_id' isn't a
//           recognised frame setting.              <- FALSE publish blocker
//   POST /api/admin/leadgen/variants/<id>/preview
//        {"draft_frame_overrides":{"theme_id":"thm_p8-repro"}}     -> 400
//
// and the SILENT twin: the serve resolver got `config === null` from the same
// rejection and dropped the ENTIRE overrides patch at render time.
//
// E10/E11 — the producer side of this boundary is REAL: the override key and
// its payload shape are extracted from the shipped admin editor source (the
// "A/B this theme" / apply-with-override writers), never hand-typed here. The
// consumer side is the real validator plus the real serve-side frame
// resolver.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateFrameConfig } from "../src/public/leadgen/designs/frames";
import { resolveEffectiveFrameOnly } from "../src/public/leadgen/resolver";
import { winningThemeId } from "../src/public/leadgen/designs/theme";

const HERE = dirname(fileURLToPath(import.meta.url));
const PRODUCER_SRC = join(HERE, "..", "src", "admin", "leadgen", "quotes-tabs", "funnel.ts");

// The REAL producer: the admin editor's per-arm theme writers. Both the
// "A/B this theme" one-click and the apply-with-override patch build the SAME
// payload. The override key is READ OUT of that source rather than asserted
// from memory, so if the product ever renames it this test follows the
// product instead of silently guarding a stale name.
function producedOverrideKey(): string {
  const src = readFileSync(PRODUCER_SRC, "utf8");
  const writes = [...src.matchAll(/frame_overrides_json(?:\s*=|:)\s*\{\s*([a-z_]+)\s*:/g)].map(
    (m) => m[1] as string,
  );
  // Both known write sites must be present — if the editor stops writing a
  // per-arm theme override at all, this fixture is no longer real.
  expect(writes.length).toBeGreaterThanOrEqual(2);
  expect(new Set(writes).size).toBe(1);
  return writes[0] as string;
}

// A stored column exactly as the product wrote it during the live drive above.
function producedOverridesColumn(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ [producedOverrideKey()]: "thm_p8-repro", ...extra });
}

const UNRECOGNISED = /isn't a recognised frame setting/;

describe("P8-1 F8 — frame_overrides_json.theme_id (v3.1 §10.1) is one contract, not two", () => {
  it("the real editor writes the per-arm theme override as frame_overrides_json.theme_id", () => {
    expect(producedOverrideKey()).toBe("theme_id");
  });

  it("the reader split the preflight/resolver use accepts what the product stored — no problem, no false blocker", () => {
    // Byte-for-byte the readers' own transformation: parse the column, lift
    // the `theme` palette part out, hand the rest to validateFrameConfig.
    const parsed = JSON.parse(producedOverridesColumn()) as Record<string, unknown>;
    const { theme: _theme, ...frameParts } = parsed;
    const { config, problems } = validateFrameConfig(frameParts);

    expect(problems).toEqual([]);
    expect(config).not.toBeNull();
    // The exact operator-facing string the activation preflight raised.
    expect(problems.map((p) => p.message).filter((m) => UNRECOGNISED.test(m))).toEqual([]);
    expect(JSON.stringify(problems)).not.toContain("'theme_id' isn't a recognised frame setting");
  });

  it("validation is NOT blunted: a genuinely unknown top-level key is still reported", () => {
    const { config, problems } = validateFrameConfig({ not_a_frame_key: 1 });
    expect(problems).toEqual([
      {
        path: "frame.not_a_frame_key",
        scope: "frame",
        severity: "error",
        message: "'not_a_frame_key' isn't a recognised frame setting.",
      },
    ]);
    expect(config).toBeNull();
    // …and still reported when it rides ALONGSIDE the legitimate theme_id, so
    // the new branch cannot be used as a way in.
    const mixed = validateFrameConfig({ theme_id: "thm_p8-repro", not_a_frame_key: 1 });
    expect(mixed.config).toBeNull();
    expect(mixed.problems.map((p) => p.path)).toEqual(["frame.not_a_frame_key"]);
  });

  it("a malformed theme_id is still an error (recognised is not the same as unchecked)", () => {
    for (const bad of [42, "", "   ", null, { theme_id: "thm_x" }]) {
      const { config, problems } = validateFrameConfig({ theme_id: bad });
      expect(config, `theme_id=${JSON.stringify(bad)}`).toBeNull();
      expect(problems.map((p) => p.path)).toEqual(["frame.theme_id"]);
      // Never the "unrecognised key" wording — the key IS recognised.
      expect(UNRECOGNISED.test(problems[0]?.message ?? "")).toBe(false);
    }
  });

  it("the SILENT twin: the serve resolver no longer drops the whole overrides patch", () => {
    // The same document the editor writes, plus one ordinary frame override
    // riding with it. Before the fix validateFrameConfig returned config=null
    // for this patch, so resolveEffectiveFrameOnly discarded ALL of it and
    // the arm rendered with the funnel's baseline chrome.
    const frame = resolveEffectiveFrameOnly({
      frame_config_json: JSON.stringify({ version: 1, template: "centered", header: { sticky: false } }),
      theme_json: null,
      frame_overrides_json: producedOverridesColumn({ header: { sticky: true } }),
    });
    expect(frame).not.toBeNull();
    expect(frame?.header?.sticky).toBe(true);
  });

  it("the theme layer still resolves the stored reference (the feature actually runs)", () => {
    const parsed = JSON.parse(producedOverridesColumn()) as Record<string, unknown>;
    expect(winningThemeId({ theme_id: "thm_funnel_default" }, parsed)).toBe("thm_p8-repro");
  });
});
