import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("conversions admin accessibility browser contract", () => {
  const product = readFileSync(new URL("../src/admin/conversions/app/product.tsx", import.meta.url), "utf8");
  const reporting = readFileSync(new URL("../src/admin/reporting/app/product.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../src/admin/conversions/app/styles.css", import.meta.url), "utf8");

  it("announces async state and preserves semantic table relationships", () => {
    expect(product).toContain('role="status" aria-live="polite"');
    expect(product).toContain('aria-busy="true"');
    expect(product).toContain('<th scope="col">');
    expect(product).toContain('<th scope="row">');
    expect(reporting).toContain('role="status" aria-live="polite"');
    expect(reporting).toContain("Not available");
  });

  it("has visible keyboard focus, compact cards, forced colors and reduced motion", () => {
    expect(styles).toContain(":focus-visible");
    expect(styles).toContain("outline:3px solid #111827");
    expect(styles).toContain("@media (max-width:768px)");
    expect(styles).toContain(".ko-resource-table{display:none}");
    expect(styles).toContain(".ko-resource-cards{display:grid");
    expect(styles).toContain("@media (forced-colors:active)");
    expect(styles).toContain("@media (prefers-reduced-motion:reduce)");
  });

  it("labels disabled activation and sending controls with visible context", () => {
    expect(product).toContain("Activation is unavailable in local mode.");
    expect(reporting).toContain("Recipient verification sending is unavailable in local-only mode.");
    expect(reporting).toContain("Schedules remain disabled and sending is unavailable in local-only mode.");
  });
});
