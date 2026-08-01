import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  collectionFromPayload,
  initialProductState,
  productReducer,
} from "../src/admin/conversions/app/product-state";

describe("functional conversions and reporting source", () => {
  it("models loading, empty, error and populated states without losing prior rows", () => {
    const initial = initialProductState<Record<string, unknown>>();
    expect(productReducer(initial, { type: "load" }).state).toBe("loading");
    expect(productReducer(initial, { type: "loaded", items: [] }).state).toBe("empty");
    const loaded = productReducer(initial, { type: "loaded", items: [{ id: "one" }] });
    expect(loaded.state).toBe("ready");
    expect(productReducer(loaded, { type: "failed", message: "offline" }).items).toHaveLength(1);
    expect(collectionFromPayload({ items: [{ id: "one" }] })).toHaveLength(1);
  });

  it("uses only the same-origin proxy and stable idempotency helper", () => {
    const source = readFileSync(new URL("../src/admin/conversions/app/api-client.ts", import.meta.url), "utf8");
    expect(source).toContain('const API_PREFIX = "/api/admin/conversions/v1"');
    expect(source).toContain('headers.set("Idempotency-Key", stableKey(action))');
    expect(source).toContain("pendingIdempotencyKeys.delete(action)");
    expect(source).not.toMatch(/https?:\/\/(?!local\.kodigital\.invalid)/);
  });

  it("keeps newer visible Flow edits dirty when an older autosave response arrives", () => {
    const source = readFileSync(new URL("../src/admin/conversions/app/flows.tsx", import.meta.url), "utf8");
    expect(source).toContain("const savedCurrentDraft = draftRef.current === current");
    expect(source).toMatch(/if \(savedCurrentDraft\) \{[\s\S]*setDirty\(false\)/u);
    expect(source).toMatch(/else \{[\s\S]*setDirty\(true\)[\s\S]*saving your latest changes/u);
    expect(source).toContain("disabled={saving || !draftMutable || (step !== STEPS.length - 1 && !canManage)}");
  });

  it("loads canonical Activity through server filters, cursor pages, health, and bound replay preview", () => {
    const source = readFileSync(new URL("../src/admin/conversions/app/activity.tsx", import.meta.url), "utf8");
    expect(source).toContain('"/api/admin/conversions/v1/activity/health"');
    expect(source).toContain('{ outcome: runOutcome }');
    expect(source).toContain('{ delivery_state: eventDeliveryState }');
    expect(source).toContain('{ state: deliveryState }');
    expect(source).toContain('onClick={() => void loadMore("runs")}');
    expect(source).toContain('onClick={() => void loadMore("events")}');
    expect(source).toContain('onClick={() => void loadMore("deliveries")}');
    expect(source).toContain("Load more history");
    expect(source).toContain("/api/admin/conversions/v1/replays/preview");
    expect(source).toContain("preview_token: preview.preview_token");
    expect(source).toContain("typed_count_confirmation: Number(typedCount)");
    expect(source).toContain("Reporting-only replay is the default and cannot contact a provider.");
    expect(source).not.toContain("visibleRuns");
    expect(source).not.toContain("visibleDeliveries");
  });

  it("wires all five product sections and preview-only reporting delivery", () => {
    const conversions = readFileSync(new URL("../src/admin/conversions/app/product.tsx", import.meta.url), "utf8");
    const reporting = readFileSync(new URL("../src/admin/reporting/app/product.tsx", import.meta.url), "utf8");
    for (const label of ["connections", "flows", "activity", "controls"]) expect(conversions).toContain(label);
    for (const label of ["Conversions", "Deliveries", "Runs", "CSV", "XLSX", "PDF", "Calculated measure"]) {
      expect(reporting).toContain(label);
    }
    expect(reporting).toContain("this screen never sends email");
    expect(reporting).toContain("No cron expression, secret, activation, or email sending");
  });

  it("exposes the contract-shaped Reporting interactions rather than placeholder controls", () => {
    const reporting = readFileSync(new URL("../src/admin/reporting/app/product.tsx", import.meta.url), "utf8");
    expect(reporting).toContain("Add parenthesized operation");
    expect(reporting).toContain("Calculated formula preview");
    expect(reporting).toContain("The server validates the structured formula");
    expect(reporting).toContain("Pivot preview from exact server-grouped rows");
    expect(reporting).toContain("Allow controlled drill-through");
    expect(reporting).toContain("View details");
    expect(reporting).toContain("/drill-through");
    expect(reporting).not.toMatch(/\beval\s*\(|new Function\s*\(/u);
  });
});
