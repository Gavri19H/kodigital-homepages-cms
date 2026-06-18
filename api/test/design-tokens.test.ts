// T17 (BCL-059) / RC-031 — design tokens EXACTLY match the design contract.
//
// T17-AC1 (behavioral): the rendered public stylesheet (publicCss, served at
// /assets/public.css) MUST carry the full `--tw-*` token set with the EXACT
// values pinned in docs/design-contract.md §1 (colors), §2 (typography +
// type scale), §3 (layout/shape) and §4 (motion) — not the Tailwind-slate
// defaults the sheet originally shipped (e.g. ink #0f172a, text #1f2937,
// ease cubic-bezier(0.4,0,0.2,1)). Per-site brand_tokens (C3) override only
// the brand family at render time; everything else here is the contract.
//
// These are assertions against the SERVED stylesheet string (the rendered
// CSS the browser receives), scoped to the `:root` declaration block so a
// value match in an unrelated rule can never satisfy the contract — not a
// loose source grep. They fail if any token value drifts from the contract
// or if a placeholder/missing-token marker leaks into the output.
//
// The `[api/test/design-tokens.test.ts]` literal in each it() title is the
// deterministic binding for the required_evidence_plan RC-031
// parse_test_output route (expected_test_name_regex =
// api/test/design-tokens.test.ts).

import { describe, it, expect } from "vitest";
import { publicCss } from "../src/public/assets/public-css";

// Extract the `:root { ... }` declaration block so every token assertion is
// scoped to the canonical token-definition set (the block has no nested
// braces, so [^}]* captures it whole).
function rootBlock(): string {
  const match = publicCss.match(/:root\s*\{([^}]*)\}/);
  expect(match, "publicCss defines a :root token block").not.toBeNull();
  return match === null ? "" : (match[1] ?? "");
}

describe("design-tokens (T17 / RC-031)", () => {
  it("§1 color tokens EXACTLY match the design contract [api/test/design-tokens.test.ts]", () => {
    const root = rootBlock();
    // docs/design-contract.md §1 — every value verbatim.
    const colors: Record<string, string> = {
      "--tw-ink": "#1a1d23",
      "--tw-text": "#2a2f38",
      "--tw-text-muted": "#5a6270",
      "--tw-text-light": "#8a93a3",
      "--tw-rule": "#e8ecf2",
      "--tw-rule-soft": "#f1f4f8",
      "--tw-bg": "#ffffff",
      "--tw-bg-soft": "#f7f9fc",
      "--tw-bg-tint": "#eef5f8",
      "--tw-brand": "#1ba8c8",
      "--tw-brand-deep": "#0f8aa6",
      "--tw-brand-soft": "#d6eef5",
      "--tw-brand-tint": "#f0f9fc",
      "--tw-accent": "#f0a830",
      "--tw-success": "#10b981",
    };
    for (const [token, value] of Object.entries(colors)) {
      expect(root, `${token} = ${value}`).toContain(`${token}: ${value};`);
    }
  });

  it("§2 typography uses Nunito display + Nunito Sans body and pins the full type scale [api/test/design-tokens.test.ts]", () => {
    const root = rootBlock();
    // Nunito (display) + Nunito Sans (body) — the contract §2 font stacks.
    expect(root).toContain(`--tw-font-sans: "Nunito Sans", "Inter", system-ui;`);
    expect(root).toContain(`--tw-font-display: "Nunito", "Nunito Sans", system-ui;`);
    // §2 type scale (rem at root 16) — every step verbatim.
    const scale: Record<string, string> = {
      "--tw-fs-xs": "0.75rem",
      "--tw-fs-sm": "0.875rem",
      "--tw-fs-base": "1rem",
      "--tw-fs-md": "1.0625rem",
      "--tw-fs-lg": "1.25rem",
      "--tw-fs-xl": "1.625rem",
      "--tw-fs-2xl": "2rem",
      "--tw-fs-3xl": "2.625rem",
      "--tw-fs-4xl": "3.25rem",
    };
    for (const [token, value] of Object.entries(scale)) {
      expect(root, `${token} = ${value}`).toContain(`${token}: ${value};`);
    }
  });

  it("§3 layout/shape tokens match — containers 1200/920, radii, shadows, --tw-header-h:72px [api/test/design-tokens.test.ts]", () => {
    const root = rootBlock();
    const layout: Record<string, string> = {
      "--tw-container": "1200px",
      "--tw-container-narrow": "920px",
      "--tw-radius-sm": "6px",
      "--tw-radius": "10px",
      "--tw-radius-lg": "16px",
      "--tw-radius-pill": "999px",
      "--tw-header-h": "72px",
    };
    for (const [token, value] of Object.entries(layout)) {
      expect(root, `${token} = ${value}`).toContain(`${token}: ${value};`);
    }
    // Contract §3 shadows — full value strings.
    expect(root).toContain(
      "--tw-shadow-sm: 0 1px 2px rgba(20,30,50,0.04), 0 1px 1px rgba(20,30,50,0.03);",
    );
    expect(root).toContain(
      "--tw-shadow: 0 2px 8px rgba(20,30,50,0.05), 0 1px 2px rgba(20,30,50,0.04);",
    );
    expect(root).toContain(
      "--tw-shadow-md: 0 8px 24px rgba(20,30,50,0.08), 0 2px 4px rgba(20,30,50,0.04);",
    );
  });

  it("§4 motion tokens match the contract — ease cubic-bezier(.2,.7,.2,1), 200ms [api/test/design-tokens.test.ts]", () => {
    const root = rootBlock();
    // Contract §4: cubic-bezier(.2,.7,.2,1) — numerically equal to the value
    // written here; NOT the old cubic-bezier(0.4, 0, 0.2, 1) default.
    expect(root).toContain("--tw-ease: cubic-bezier(0.2, 0.7, 0.2, 1);");
    expect(root).toContain("--tw-dur: 200ms;");
  });

  it("the rendered CSS carries no placeholder / superseded-token markers [api/test/design-tokens.test.ts]", () => {
    // No placeholder shell markers.
    expect(publicCss).not.toContain("Phase 1 admin shell");
    expect(publicCss).not.toMatch(/PLACEHOLDER|TODO|FIXME/);
    // The superseded non-contract values must be GONE from the sheet entirely
    // (proves the tokens were corrected in place, not merely duplicated).
    expect(publicCss).not.toContain("#0f172a"); // old ink
    expect(publicCss).not.toContain("#1f2937"); // old text
    expect(publicCss).not.toContain("cubic-bezier(0.4, 0, 0.2, 1)"); // old ease
  });
});
