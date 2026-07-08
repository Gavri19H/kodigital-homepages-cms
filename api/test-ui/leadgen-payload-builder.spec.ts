// LeadGen fix-contract v2.4 Phase 2 — G5 payload-builder Playwright suite
// (06 §6.13 Playwright rows + §6.14 acceptance; 11 §11.4 G5 Phase-2 rows).
//
// The Phase-2 exit evidence: a NON-TECHNICAL OPERATOR authors everything
// visually with ZERO raw JSON typed. Every test drives the REAL three-pane
// builder at /admin/leadgen/offers/:id/edit (payload tab) through clicks,
// dropdowns and typed values only — never a JSON textarea — then proves the
// STORED schema (via the admin API) contains exactly the shapes the visual
// editing implies.
//
//   ① Zero-JSON authoring E2E — object node with children + array-of-objects
//     (toolbar Add object/Add array + child builders), answer field with a
//     value map (Add many "internal=provider" + Import CSV with a main
//     column, main/Other grouping, count chips), date field with a format
//     pick (live input→output preview), boolean field with a preset (chips),
//     a condition (field+op+value dropdowns, live preview sentence), a
//     Static default + a Computed-registry fallback; SAVE → 201; stored
//     schema asserted node-by-node; a focus tracker proves no [data-raw-json]
//     input was ever focused.
//   ② §6.11 — five broken fields → "Schema has 5 issues."; collapse the
//     parent, Jump → ancestors expand, the node pulses, inline badge +
//     per-control focus; fix one via the answer dropdown → count drops to 4
//     live.
//   ③ Advanced drawer round-trip — the per-field raw JSON reflects the
//     visual edits of ①; a small valid raw edit applies back into the
//     visual value-map table.
//   ④ §6.14 structural — the RENDERED page in normal mode exposes NO raw
//     JSON inputs: every [data-raw-json] sits inside a collapsed
//     details[data-lg-advanced]; zero are visible; the only visible textarea
//     in the payload panel is the notes field.
//   ⑤ §6.12/C1 Test tab — generated sample-answer form renders per-kind
//     inputs (enum dropdown preselected / boolean pair / date input / zip
//     preset), draft persistence across reload, simulated-context defaults,
//     placement picker (>1 placements) with the used placement echoed,
//     production-confirm behavior, staging RUN → masked result + context_used
//     — and the provider hit lands on the :8788 mock (GET /__requests).
//
// Seeds (fresh unique names, REAL admin APIs only): test-ui/leadgen-fix-p2-seed.ts.
// Runs against the playwright.config.ts webServers (wrangler dev :8787 with
// DEV_BYPASS_AUTH + ADMIN_HOST:127.0.0.1; mock provider :8788). Local D1 must
// be migrated + seeded once before the run (the conductor's D1 ritual).
// Screenshots (desktop 1280) land in test-artifacts/fix-p2/.

import {
  test,
  expect,
  request as playwrightRequest,
  type Page,
} from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  seedFixP2AuthoringOffer,
  seedFixP2TestOffer,
  MOCK_PROVIDER_ORIGIN,
  type SeededFixP2AuthoringOffer,
  type SeededFixP2TestOffer,
} from "./leadgen-fix-p2-seed";

const ORIGIN = "http://127.0.0.1:8787";
const SHOT_DIR = "test-artifacts/fix-p2";
const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

test.use({ viewport: { width: 1280, height: 900 } });

let offerA: SeededFixP2AuthoringOffer; // zero-JSON authoring target (no schema yet)
let offerB: SeededFixP2TestOffer; // Test-tab target (mock endpoints + 2 placements + active schema)

test.beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  offerA = await seedFixP2AuthoringOffer(ctx, uniq);
  offerB = await seedFixP2TestOffer(ctx, uniq);
  await ctx.dispose();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openPayloadTab(page: Page, offerPublicId: string): Promise<void> {
  await page.goto(`/admin/leadgen/offers/${offerPublicId}/edit`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-lg-tab-btn="payload"]').click();
  await expect(page.locator("[data-pb-shell]")).toBeVisible();
}

// Rename the currently-selected node through the editor's Name input (the
// §6.1 atomic rename — Enter commits the change event) and wait for the tree
// to show the new path.
async function renameSelected(page: Page, newName: string, expectedPath: string): Promise<void> {
  const nameInput = page.locator('#lg-pb-editor [data-pb-field="name"]');
  await nameInput.fill(newName);
  await nameInput.press("Enter");
  await expect(page.locator(`[data-pb-path="${expectedPath}"]`)).toBeVisible();
}

// Commit a text input value with a change event (fill + Tab).
async function fillAndCommit(page: Page, selector: string, value: string): Promise<void> {
  const input = page.locator(selector);
  await input.fill(value);
  await input.press("Tab");
}

// Every [data-raw-json] element in the RENDERED DOM must sit inside an
// Advanced drawer (details[data-lg-advanced]) — §6.14. Returns the ids of
// violators (empty = compliant).
async function rawJsonOrphans(page: Page): Promise<string[]> {
  return page.locator("[data-raw-json]").evaluateAll((els) =>
    els
      .filter((el) => el.closest("details[data-lg-advanced]") === null)
      .map((el) => (el.id !== "" ? el.id : (el.getAttribute("aria-label") ?? "unnamed"))),
  );
}

// The §6.13 CSV fixture: header + 10 carrier rows, 2 marked main via the
// main column (a third is marked through the row action in the modal).
const CARRIERS_CSV = [
  "carrier,provider_code,is_main",
  "geico,GEICO,yes",
  "progressive,PROGRESSIVE,yes",
  "statefarm,STATE_FARM,",
  "allstate,ALLSTATE,",
  "libertymutual,LIBERTY,",
  "farmers,FARMERS,",
  "nationwide,NATIONWIDE,",
  "usaa,USAA,",
  "travelers,TRAVELERS,",
  "amfam,AMFAM,",
].join("\n");

const CSV_INTERNALS = [
  "geico",
  "progressive",
  "statefarm",
  "allstate",
  "libertymutual",
  "farmers",
  "nationwide",
  "usaa",
  "travelers",
  "amfam",
];

interface StoredNode {
  path: string;
  name?: string;
  type?: string;
  source?: string;
  internal_field?: string;
  required?: boolean;
  value?: unknown;
  value_map?: Record<string, unknown>;
  transform?: Array<{ kind: string; format?: string }>;
  conditional?: { when?: string; op?: string; value?: unknown; values?: unknown[] };
  choiceDisplay?: { mainValues?: string[]; otherGroupEnabled?: boolean; searchableOther?: boolean };
  default?: unknown;
  fallback?: unknown;
}

interface StoredSchema {
  version: number;
  root: { type: string; children: StoredNode[] };
}

test.describe.serial("LeadGen fix-P2 — payload builder (G5, 06 §6.13/§6.14)", () => {
  // -------------------------------------------------------------------------
  // ① Zero-JSON authoring E2E
  // -------------------------------------------------------------------------
  test("① zero-JSON authoring: nested object + array-of-objects + value map (Add many + CSV + main/Other) + date + boolean preset + condition + default/fallback → save → stored schema matches the visual edits", async ({ page }) => {
    test.setTimeout(150_000);

    // ZERO-JSON PROOF (part 1): count every focus landing on a raw-JSON
    // input for the WHOLE authoring session — must stay 0.
    await page.addInitScript(() => {
      (window as unknown as { __rawJsonFocused: number }).__rawJsonFocused = 0;
      document.addEventListener(
        "focusin",
        (e) => {
          const t = e.target as Element | null;
          if (t !== null && typeof t.matches === "function" && t.matches("[data-raw-json]")) {
            (window as unknown as { __rawJsonFocused: number }).__rawJsonFocused += 1;
          }
        },
        true,
      );
    });

    await openPayloadTab(page, offerA.offerPublicId);
    await expect(page.locator("#lg-pb-tree")).toContainText("No fields yet");

    // --- lead (object node) -------------------------------------------------
    await page.locator("#lg-pb-add-object").click();
    await renameSelected(page, "lead", "lead");

    // --- lead.homeowner_status — boolean field + §6.7 preset ---------------
    await page.locator("#lg-pb-add-field").click();
    await renameSelected(page, "homeowner_status", "lead.homeowner_status");
    await page.locator('#lg-pb-editor [data-pb-field="type"]').selectOption("boolean");
    await page.locator("#lg-pb-editor [data-pb-answer-picker]").selectOption("homeowner");
    await page.locator('#lg-pb-editor [data-pb-field="bool_preset"]').selectOption("yn");
    await expect(page.locator("#lg-pb-editor [data-pb-bool-chip-true]")).toHaveText("Y");
    await expect(page.locator("#lg-pb-editor [data-pb-bool-chip-false]")).toHaveText("N");

    // §6.10 F-1 — author the contract's own example DIRECTLY: "Show this
    // field when homeowner = true". A fresh condition stores {op:'eq',
    // value:''} and renders as the is-empty sugar with no value input;
    // picking "=" must STICK (no snap-back to "is empty") and render the
    // typed value control.
    await page.locator("#lg-pb-editor [data-pb-condition-add]").click();
    await page.locator("#lg-pb-editor [data-pb-cond-field]").selectOption("homeowner");
    await expect(page.locator("#lg-pb-editor [data-pb-cond-op]")).toHaveValue("is_empty");
    await expect(page.locator("#lg-pb-editor [data-pb-cond-value]")).toHaveCount(0);
    await page.locator("#lg-pb-editor [data-pb-cond-op]").selectOption("eq");
    await expect(page.locator("#lg-pb-editor [data-pb-cond-op]")).toHaveValue("eq");
    // The value input APPEARS on picking "=" — homeowner is a boolean linked
    // field, so it is the true/false dropdown.
    await expect(page.locator("#lg-pb-editor [data-pb-cond-value]")).toBeVisible();
    await page.locator("#lg-pb-editor [data-pb-cond-value]").selectOption("true");
    await expect(page.locator("#lg-pb-editor [data-pb-cond-preview]")).toHaveText(
      "Send this field when homeowner = true.",
    );

    // --- lead.carrier — §6.3 value map (Add many + CSV) + §6.4 Other -------
    await page.locator("#lg-pb-add-field").click();
    await renameSelected(page, "carrier", "lead.carrier");
    await page.locator("#lg-pb-editor [data-pb-answer-picker]").selectOption("carrier");
    // A new string answer field starts in free-text mode — leave it to enable
    // mapping (visual toggle, §6.5).
    await page.locator('#lg-pb-editor [data-pb-field="free_text"]').click();
    await expect(page.locator("#lg-pb-editor [data-pb-valuemap-open]")).toBeVisible();
    // §6.4 Other grouping controls (before opening the editor so the modal's
    // derived Other column renders).
    await page.locator('#lg-pb-editor [data-pb-field="otherGroupEnabled"]').click();
    await page.locator('#lg-pb-editor [data-pb-field="searchableOther"]').click();

    await page.locator("#lg-pb-editor [data-pb-valuemap-open]").click();
    const vmModal = page.locator("#lg-pb-valuemap-modal");
    await expect(vmModal).toBeVisible();

    // Add many — "internal=provider" lines.
    await vmModal.locator("[data-vm-add-many]").click();
    await vmModal
      .locator("[data-vm-add-many-text]")
      .fill("aaa_ins=AAA Insurance\nbbb_mut=BBB Mutual");
    await vmModal.locator("[data-vm-add-many-apply]").click();
    await expect(vmModal.locator("[data-vm-rows] tr")).toHaveCount(2);

    // Import CSV — 10 rows, columns mapped on upload, 2 marked main by the
    // is_main column.
    await vmModal.locator("[data-vm-csv]").setInputFiles({
      name: "carriers.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(CARRIERS_CSV, "utf8"),
    });
    await expect(vmModal.locator("[data-vm-csv-map]")).toBeVisible();
    await vmModal.locator('[data-vm-csv-col="internal"]').selectOption("0");
    await vmModal.locator('[data-vm-csv-col="output"]').selectOption("1");
    await vmModal.locator('[data-vm-csv-col="main"]').selectOption("2");
    await vmModal.locator("[data-vm-csv-apply]").click();
    await expect(vmModal.locator("[data-vm-rows] tr")).toHaveCount(12);

    // Third main via the row action (row 0 = aaa_ins).
    await vmModal.locator('tr[data-vm-row="0"] [data-vm-row-act="main"]').click();
    // §6.4 count chips + derived Other column (col 5; col 4 is the Main
    // checkbox): non-main rows read "Other", main rows read "".
    await expect(vmModal.locator("[data-vm-count-chips]")).toHaveText("3 main · 9 in Other");
    await expect(vmModal.locator('tr[data-vm-row="1"] td').nth(5)).toHaveText("Other");
    await expect(vmModal.locator('tr[data-vm-row="0"] td').nth(5)).toHaveText("");
    await page.screenshot({ path: `${SHOT_DIR}/01-value-map-modal.png` });

    await vmModal.locator("[data-vm-apply]").click();
    await expect(vmModal).toBeHidden();
    await expect(page.locator("#lg-pb-editor [data-pb-choice-chips]")).toHaveText(
      "3 main · 9 in Other",
    );

    // §6.10 condition — field + operator + value through dropdowns, live
    // preview sentence.
    await page.locator("#lg-pb-editor [data-pb-condition-add]").click();
    await page.locator("#lg-pb-editor [data-pb-cond-field]").selectOption("state");
    await page.locator("#lg-pb-editor [data-pb-cond-op]").selectOption("in");
    await fillAndCommit(page, "#lg-pb-editor [data-pb-cond-list]", "CA, TX");
    await expect(page.locator("#lg-pb-editor [data-pb-cond-preview]")).toHaveText(
      "Send this field when state is one of [CA, TX].",
    );

    // --- lead.dob — §6.6 date mode + live input→output preview + §6.9
    // Computed fallback -------------------------------------------------------
    await page.locator("#lg-pb-add-field").click();
    await renameSelected(page, "dob", "lead.dob");
    await page.locator('#lg-pb-editor [data-pb-field="type"]').selectOption("date");
    await page.locator("#lg-pb-editor [data-pb-answer-picker]").selectOption("dob");
    const datePreview = page.locator("#lg-pb-editor [data-pb-date-preview]");
    await expect(datePreview).toHaveText("1996-07-08 → 1996-07-08");
    await page.locator('#lg-pb-editor [data-pb-field="date_format"]').selectOption("MM/DD/YYYY");
    await expect(datePreview).toHaveText("1996-07-08 → 07/08/1996");
    // Live: a different sample date re-previews on input.
    await page.locator("#lg-pb-editor [data-pb-date-sample]").fill("2001-12-31");
    await expect(datePreview).toHaveText("2001-12-31 → 12/31/2001");
    // Fallback when invalid: Computed value from the registry dropdown.
    await page.locator("#lg-pb-editor [data-pb-fallback-mode]").selectOption("computed");
    await page.locator("#lg-pb-editor [data-pb-fallback-computed]").selectOption("today_date_utc");

    // --- lead.zip — required + Static default (typed input) ----------------
    await page.locator("#lg-pb-add-field").click();
    await renameSelected(page, "zip", "lead.zip");
    await page.locator("#lg-pb-editor [data-pb-answer-picker]").selectOption("zip");
    await page.locator('#lg-pb-editor [data-pb-field="required"]').click();
    await page.locator("#lg-pb-editor [data-pb-default-mode]").selectOption("static");
    await fillAndCommit(page, '#lg-pb-editor [data-pb-default-value="text"]', "90210");

    // --- lead.drivers — §6.8 array of objects via Add array + child builders
    await page.locator("#lg-pb-add-array").click();
    await renameSelected(page, "drivers", "lead.drivers");
    // With the array selected, Add object creates the numeric item child.
    await page.locator("#lg-pb-add-object").click();
    await expect(page.locator('[data-pb-path="lead.drivers.0"]')).toBeVisible();
    // The tree shows array items as "item N".
    await expect(
      page.locator('[data-pb-path="lead.drivers.0"] .lg-pb-node-label'),
    ).toHaveText("item 1");

    await page.locator("#lg-pb-add-field").click();
    await renameSelected(page, "age", "lead.drivers.0.age");
    await page.locator('#lg-pb-editor [data-pb-field="type"]').selectOption("number");
    await page.locator("#lg-pb-editor [data-pb-source-select]").selectOption("static");
    await fillAndCommit(page, '#lg-pb-editor [data-pb-static="number"]', "34");

    await page.locator("#lg-pb-add-field").click();
    await renameSelected(page, "licensed", "lead.drivers.0.licensed");
    await page.locator('#lg-pb-editor [data-pb-field="type"]').selectOption("boolean");
    await page.locator("#lg-pb-editor [data-pb-source-select]").selectOption("static");
    await page.locator('#lg-pb-editor [data-pb-static="boolean"]').selectOption("true");

    // --- clean validation + three-pane screenshot + SAVE --------------------
    await expect(page.locator("#lg-pb-validation-summary")).toHaveText(
      "✓ No issues — the schema looks good.",
    );
    await page.screenshot({ path: `${SHOT_DIR}/02-three-pane-authored.png`, fullPage: true });

    const [saveRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().includes("/payload-schemas"),
      ),
      page.locator("#lg-schema-save").click(),
    ]);
    expect(saveRes.status()).toBe(201);
    await expect(page.locator("#lg-payload-meta")).toContainText("Active schema: v1");

    // ZERO-JSON PROOF (part 2): no raw-JSON input was ever focused, and none
    // is visible in normal mode.
    const rawFocusCount = await page.evaluate(
      () => (window as unknown as { __rawJsonFocused?: number }).__rawJsonFocused ?? 0,
    );
    expect(rawFocusCount).toBe(0);
    await expect(page.locator("[data-raw-json]:visible")).toHaveCount(0);

    // --- the STORED schema contains exactly the shapes the visual editing
    // implies (admin API GET — the §6.13 storage assertion) -------------------
    const listRes = await page.request.get(
      `/api/admin/leadgen/offers/${offerA.offerId}/payload-schemas`,
    );
    expect(listRes.ok()).toBe(true);
    const list = (await listRes.json()) as {
      items: Array<{ version: number; schema_json: StoredSchema }>;
    };
    expect(list.items.length).toBe(1);
    const stored = list.items[0]!.schema_json;
    writeFileSync(`${SHOT_DIR}/stored-schema-v1.json`, JSON.stringify(stored, null, 2));

    // Path-set equality: renames were atomic, no stray default names remain.
    const paths = stored.root.children.map((n) => n.path).sort();
    expect(paths).toEqual(
      [
        "lead",
        "lead.homeowner_status",
        "lead.carrier",
        "lead.dob",
        "lead.zip",
        "lead.drivers",
        "lead.drivers.0",
        "lead.drivers.0.age",
        "lead.drivers.0.licensed",
      ].sort(),
    );
    const byPath = new Map(stored.root.children.map((n) => [n.path, n]));

    // Nested object node.
    expect(byPath.get("lead")?.type).toBe("object");

    // Boolean preset — §6.7 "Y"/"N" value_map, answer-sourced.
    const homeowner = byPath.get("lead.homeowner_status")!;
    expect(homeowner.type).toBe("boolean");
    expect(homeowner.source).toBe("answer");
    expect(homeowner.internal_field).toBe("homeowner");
    expect(homeowner.value_map).toEqual({ true: "Y", false: "N" });
    // §6.10 F-1 — the directly-authored "= true" condition stores the
    // evaluator-exact typed boolean (the builder emits `true`, not "true").
    expect(homeowner.conditional).toEqual({ when: "homeowner", op: "eq", value: true });

    // Value map + choiceDisplay + conditional.
    const carrier = byPath.get("lead.carrier")!;
    expect(carrier.source).toBe("answer");
    expect(carrier.internal_field).toBe("carrier");
    expect(Object.keys(carrier.value_map ?? {}).sort()).toEqual(
      ["aaa_ins", "bbb_mut", ...CSV_INTERNALS].sort(),
    );
    expect(carrier.value_map?.["aaa_ins"]).toBe("AAA Insurance");
    expect(carrier.value_map?.["geico"]).toBe("GEICO");
    expect(carrier.value_map?.["amfam"]).toBe("AMFAM");
    expect((carrier.choiceDisplay?.mainValues ?? []).sort()).toEqual(
      ["aaa_ins", "geico", "progressive"].sort(),
    );
    expect(carrier.choiceDisplay?.otherGroupEnabled).toBe(true);
    expect(carrier.choiceDisplay?.searchableOther).toBe(true);
    expect(carrier.conditional).toEqual({ when: "state", op: "in", values: ["CA", "TX"] });

    // Date mode — the existing formatDate transform, no transform JSON typed.
    const dob = byPath.get("lead.dob")!;
    expect(dob.type).toBe("string");
    expect(dob.internal_field).toBe("dob");
    expect(dob.transform).toEqual([{ kind: "formatDate", format: "MM/DD/YYYY" }]);
    // §6.9 typed computed reference.
    expect(dob.fallback).toEqual({ source: "computed", key: "today_date_utc" });

    // Static default, typed; required rides the toggle.
    const zip = byPath.get("lead.zip")!;
    expect(zip.internal_field).toBe("zip");
    expect(zip.required).toBe(true);
    expect(zip.default).toBe("90210");

    // Array of objects with numeric-segment children (§6.8 storage model).
    expect(byPath.get("lead.drivers")?.type).toBe("array");
    expect(byPath.get("lead.drivers.0")?.type).toBe("object");
    const age = byPath.get("lead.drivers.0.age")!;
    expect(age.type).toBe("number");
    expect(age.source).toBe("static");
    expect(age.value).toBe(34);
    const licensed = byPath.get("lead.drivers.0.licensed")!;
    expect(licensed.type).toBe("boolean");
    expect(licensed.value).toBe(true);
  });

  // -------------------------------------------------------------------------
  // ② "Schema has 5 issues." + Jump (§6.11)
  // -------------------------------------------------------------------------
  test('② validation panel: five broken fields → "Schema has 5 issues."; Jump expands ancestors, pulses + badges the node; fixing one drops the count to 4 live', async ({ page }) => {
    test.setTimeout(90_000);
    await openPayloadTab(page, offerA.offerPublicId);

    // The saved v1 loads clean.
    await expect(page.locator("#lg-pb-validation-summary")).toHaveText(
      "✓ No issues — the schema looks good.",
    );

    // A group + five answer fields with no Section answer picked = exactly
    // five blocking answer_missing_internal_field issues.
    await page.locator("#lg-pb-add-object").click();
    await expect(page.locator('[data-pb-path="group"]')).toBeVisible();
    for (let i = 0; i < 5; i += 1) {
      await page.locator("#lg-pb-add-field").click();
    }
    await expect(page.locator('[data-pb-path="group.field_5"]')).toBeVisible();
    await expect(page.locator("#lg-pb-validation-summary")).toHaveText("Schema has 5 issues.");
    await expect(page.locator("#lg-pb-validation-list [data-pb-jump]")).toHaveCount(5);

    // Collapse the parent so Jump has ancestors to expand.
    await page.locator('[data-pb-toggle="group"]').click();
    await expect(page.locator('[data-pb-path="group.field"]')).toHaveCount(0);

    await page.screenshot({ path: `${SHOT_DIR}/03-schema-has-5-issues.png`, fullPage: true });

    // Jump to the first issue: ancestors expand, the node scrolls/pulses,
    // inline badge + editor error + control focus.
    await page.locator('#lg-pb-validation-list [data-pb-jump="group.field"]').click();
    const jumpedRow = page.locator('[data-pb-path="group.field"]');
    await expect(jumpedRow).toBeVisible();
    await expect(jumpedRow).toHaveClass(/lg-pb-pulse/);
    await expect(jumpedRow.locator(".lg-pb-badge-error")).toBeVisible();
    await expect(page.locator("#lg-pb-editor [data-pb-node-error]")).toBeVisible();
    await expect(page.locator("#lg-pb-editor [data-pb-node-error]")).toContainText(
      "pick which answer feeds this field",
    );
    // The offending control is highlighted (JUMP_CONTROL mapping).
    await expect(page.locator("#lg-pb-editor [data-pb-answer-picker]")).toHaveClass(
      /lg-pb-pulse/,
    );

    // Fix the jumped field through the visual picker → live count drops to 4.
    await page.locator("#lg-pb-editor [data-pb-answer-picker]").selectOption("homeowner");
    await expect(page.locator("#lg-pb-validation-summary")).toHaveText("Schema has 4 issues.");
    await expect(page.locator("#lg-pb-validation-list [data-pb-jump]")).toHaveCount(4);
    // Client-side only — nothing was saved; v1 stays the active version.
    await expect(page.locator("#lg-payload-meta")).toContainText("Active schema: v1");
  });

  // -------------------------------------------------------------------------
  // ③ Advanced drawer round-trip
  // -------------------------------------------------------------------------
  test("③ Advanced drawer round-trip: raw field JSON reflects the visual edits; a small valid raw edit applies back into the visual value-map table", async ({ page }) => {
    test.setTimeout(90_000);
    await openPayloadTab(page, offerA.offerPublicId);

    // Select the value-map field authored in ①.
    await page.locator('[data-pb-select="lead.carrier"]').click();
    await expect(page.locator("#lg-pb-editor [data-pb-valuemap-compact]")).toBeVisible();

    // Open the per-field Advanced drawer — raw JSON REFLECTS the visual edits.
    await page.locator("#lg-pb-editor details[data-pb-advanced] summary").click();
    const rawTa = page.locator("#lg-pb-editor [data-pb-field-raw]");
    await expect(rawTa).toBeVisible();
    // The details toggle event queues an async editor re-render (advOpen
    // bookkeeping) that swaps the drawer DOM and resets the textarea from the
    // node — let it land before editing or the fill is rolled back.
    await page.waitForTimeout(500);
    const rawNode = JSON.parse(await rawTa.inputValue()) as StoredNode;
    expect(rawNode.path).toBe("lead.carrier");
    expect(rawNode.value_map?.["geico"]).toBe("GEICO");
    expect((rawNode.choiceDisplay?.mainValues ?? []).length).toBe(3);
    expect(rawNode.conditional?.op).toBe("in");

    // Small valid raw edit → apply → the visual table reflects it.
    rawNode.value_map!["geico"] = "GEICO-PREF";
    await rawTa.fill(JSON.stringify(rawNode, null, 2));
    await expect(rawTa).toHaveValue(/GEICO-PREF/);
    await page.locator("#lg-pb-editor [data-pb-field-raw-apply]").click();
    await expect(page.locator("#lg-pb-editor [data-pb-valuemap-compact]")).toContainText(
      "GEICO-PREF",
    );
    // Everything in the node is representable — the field is NOT flagged
    // advanced-managed by the round-trip.
    await expect(page.locator("#lg-pb-editor [data-pb-advanced-managed]")).toBeHidden();
    // The full editor modal shows the edited output too (row values live in
    // inputs — read them, textContent cannot see input values).
    await page.locator("#lg-pb-editor [data-pb-valuemap-open]").click();
    const vmModal = page.locator("#lg-pb-valuemap-modal");
    await expect(vmModal).toBeVisible();
    await expect(vmModal.locator("[data-vm-rows] tr")).toHaveCount(12);
    const modalRows = await vmModal.locator("tr[data-vm-row]").evaluateAll((rows) =>
      rows.map((r) => ({
        internal: (r.querySelector('[data-vm-in="internal"]') as HTMLInputElement | null)?.value ?? "",
        output: (r.querySelector('[data-vm-in="output"]') as HTMLInputElement | null)?.value ?? "",
      })),
    );
    expect(modalRows.find((r) => r.internal === "geico")?.output).toBe("GEICO-PREF");
    await page.keyboard.press("Escape");
    await expect(vmModal).toBeHidden();
  });

  // -------------------------------------------------------------------------
  // ④ §6.14 structural — no raw JSON inputs in normal mode (rendered page)
  // -------------------------------------------------------------------------
  test("④ §6.14: the rendered page exposes raw JSON only inside collapsed Advanced drawers — payload and Test tabs, with and without a field selected", async ({ page }) => {
    await openPayloadTab(page, offerA.offerPublicId);

    // Every [data-raw-json] input sits inside a details[data-lg-advanced]
    // drawer (template content is not part of the rendered DOM).
    expect(await rawJsonOrphans(page)).toEqual([]);
    await expect(page.locator("[data-raw-json]:visible")).toHaveCount(0);

    // With a field selected, the per-field drawer's raw textarea exists but
    // stays collapsed; the ONLY visible textarea in the panel is the notes
    // field.
    await page.locator('[data-pb-select="lead.carrier"]').click();
    await expect(page.locator("#lg-pb-editor [data-pb-field-raw]")).toHaveCount(1);
    await expect(page.locator("[data-raw-json]:visible")).toHaveCount(0);
    const visibleTextareas = page.locator('[data-lg-tab-panel="payload"] textarea:visible');
    await expect(visibleTextareas).toHaveCount(1);
    await expect(visibleTextareas.first()).toHaveAttribute("data-pb-field", "notes");
    expect(await rawJsonOrphans(page)).toEqual([]);

    // Test tab: the raw-answers editor lives behind its own collapsed drawer.
    await page.locator('[data-lg-tab-btn="test"]').click();
    await expect(page.locator("#lg-test-form")).toBeVisible();
    await expect(page.locator("#lg-test-answers")).toBeHidden();
    await expect(page.locator("[data-raw-json]:visible")).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // ⑤ Test tab (C1 / §6.12) — offer B
  // -------------------------------------------------------------------------
  test("⑤ Test tab: generated per-kind form + draft persistence + simulated context + placement picker + production confirm + staging run → masked result, context echo, provider hit on the mock", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`/admin/leadgen/offers/${offerB.offerPublicId}/edit`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator('[data-lg-tab-btn="test"]').click();

    // --- §6.12.1 generated sample-answer form: one input per answer field,
    // per-kind widgets --------------------------------------------------------
    await expect(page.locator("#lg-test-form [data-test-field]")).toHaveCount(4);

    // enum → dropdown with the first Section choice preselected.
    const enumSel = page.locator('[data-test-field="prior_coverage"] select[data-test-input]');
    await expect(enumSel).toBeVisible();
    await expect(enumSel).toHaveValue("insured");

    // boolean → yes/no pair, Yes preselected (sample true).
    await expect(
      page.locator('[data-test-field="homeowner"] input[type="radio"][value="true"]'),
    ).toBeChecked();

    // date → date input, DOB-like names sample today−30y (UTC).
    const dobInput = page.locator('[data-test-field="dob"] input[data-test-input]');
    await expect(dobInput).toHaveAttribute("type", "date");
    const now = new Date();
    const expectedDob = new Date(
      Date.UTC(now.getUTCFullYear() - 30, now.getUTCMonth(), now.getUTCDate()),
    )
      .toISOString()
      .slice(0, 10);
    await expect(dobInput).toHaveValue(expectedDob);

    // zip → test preset.
    const zipInput = page.locator('[data-test-field="zip"] input[data-test-input]');
    await expect(zipInput).toHaveValue("90210");
    // Each row hints its payload path.
    await expect(page.locator('[data-test-field="zip"] .form-help')).toContainText("lead.zip");

    // --- draft persistence: edit → Save draft → reload → edits survive ------
    await zipInput.fill("60614");
    await page.locator("#lg-test-save-draft").click();
    await expect(page.locator("#lg-test-draft-status")).toHaveText("Draft saved.");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[data-lg-tab-btn="test"]').click();
    await expect(
      page.locator('[data-test-field="zip"] input[data-test-input]'),
    ).toHaveValue("60614");

    // --- §6.12.2 simulated-context panel: collapsed by default, opens with
    // the realistic US defaults ----------------------------------------------
    const contextPanel = page.locator("#lg-test-context");
    await expect(page.locator('[data-test-ctx="country"]')).toBeHidden();
    await contextPanel.locator("summary").click();
    await expect(page.locator('[data-test-ctx="country"]')).toHaveValue("US");
    await expect(page.locator('[data-test-ctx="state"]')).toHaveValue("CA");
    await expect(page.locator('[data-test-ctx="city"]')).toHaveValue("Los Angeles");
    await expect(page.locator('[data-test-ctx="utm_source"]')).toHaveValue("facebook");

    // --- §6.12.3 placement picker: visible with >1 placements, default
    // preselected; pick the SECOND so the echo proves the choice ------------
    const placementWrap = page.locator("#lg-test-placement-wrap");
    await expect(placementWrap).toBeVisible();
    await expect(placementWrap).toHaveAttribute("data-test-placement-count", "2");
    const placementSel = page.locator("#lg-test-placement");
    await expect(placementSel).toHaveValue(offerB.placementDefaultPublicId);
    await placementSel.selectOption(offerB.placementSecondPublicId);

    await page.screenshot({ path: `${SHOT_DIR}/04-test-tab-form.png`, fullPage: true });

    // --- §6.12.4 environment select: production requires an explicit
    // confirm — dismissing it sends NOTHING -----------------------------------
    await page.locator("#lg-test-environment").selectOption("production");
    let confirmMessage = "";
    page.once("dialog", (dialog) => {
      confirmMessage = dialog.message();
      void dialog.dismiss();
    });
    let testPostCount = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().endsWith(`/offers/${offerB.offerPublicId}/test`)) {
        testPostCount += 1;
      }
    });
    await page.locator("#lg-test-run").click();
    await page.waitForTimeout(500);
    expect(confirmMessage).toContain("PRODUCTION");
    expect(testPostCount).toBe(0);

    // --- staging RUN → 200, masked result view, context_used echo ----------
    await page.locator("#lg-test-environment").selectOption("staging");
    const [testRes] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          r.url().endsWith(`/offers/${offerB.offerPublicId}/test`),
      ),
      page.locator("#lg-test-run").click(),
    ]);
    expect(testRes.status()).toBe(200);
    const testBody = (await testRes.json()) as {
      environment: string;
      response: { status: number | null };
      context_used: {
        placement_id: string | null;
        placement_public_id: string | null;
        macros: Record<string, string>;
      };
    };
    expect(testBody.environment).toBe("staging");
    expect(testBody.response.status).toBe(200);
    // §4.5 echo: the operator-picked placement fed the build.
    expect(testBody.context_used.placement_id).toBe(offerB.placementSecondExternalId);
    expect(testBody.context_used.placement_public_id).toBe(offerB.placementSecondPublicId);
    // The simulated-context overrides fed the SAME runtime context builder.
    expect(testBody.context_used.macros["utm_source"]).toBe("facebook");
    expect(testBody.context_used.macros["country"]).toBe("US");

    // Result view renders without touching JSON.
    await expect(page.locator("#lg-test-results")).toBeVisible();
    await expect(page.locator("#lg-test-status-line")).toContainText("status 200");
    await expect(page.locator("#lg-test-context-used")).toContainText("environment: staging");
    await expect(page.locator("#lg-test-context-used")).toContainText(
      `placement: ${offerB.placementSecondExternalId}`,
    );
    await expect(page.locator("#lg-test-request-payload")).toContainText("60614");
    await expect(page.locator("#lg-test-response-body")).toContainText("mockref-a7x42");
    // The last-test chip flips to passed (payload-tab side pane element).
    await expect(page.locator("#lg-pb-test-chip")).toHaveAttribute("data-test-status", "passed");

    await page.screenshot({ path: `${SHOT_DIR}/05-test-tab-result.png`, fullPage: true });

    // --- the provider hit landed on the :8788 mock with the BUILT payload ---
    const capturedRes = await page.request.get(`${MOCK_PROVIDER_ORIGIN}/__requests`);
    expect(capturedRes.ok()).toBe(true);
    const captured = (await capturedRes.json()) as Array<{ body: string }>;
    interface BuiltPayload {
      lead: {
        homeowner_status: string;
        prior_coverage: string;
        dob: string;
        zip: string;
      };
      traffic: { utm_source: string };
      meta: { placement_id: string; request_timestamp: number };
    }
    const mine = captured
      .map((r) => {
        try {
          return JSON.parse(r.body) as BuiltPayload;
        } catch {
          return null;
        }
      })
      .filter(
        (b): b is BuiltPayload =>
          b !== null && b.meta?.placement_id === offerB.placementSecondExternalId,
      );
    expect(mine.length).toBe(1);
    const sent = mine[0]!;
    expect(sent.lead.zip).toBe("60614"); // the operator's edited draft value
    expect(sent.lead.homeowner_status).toBe("own"); // value_map true → own
    expect(sent.lead.prior_coverage).toBe("I"); // value_map insured → I
    expect(sent.lead.dob).toBe(expectedDob); // formatDate YYYY-MM-DD
    expect(sent.traffic.utm_source).toBe("facebook"); // simulated context macro
    expect(typeof sent.meta.request_timestamp).toBe("number"); // computed
  });
});
