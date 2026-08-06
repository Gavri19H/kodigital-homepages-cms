// R2 P5 S5c — the DRIVEN PRODUCT for Maps honesty (SRC-6 item 4 / ADJ-A9),
// the standalone Phone tile (ADJ-A6 / D6 RULED yes), and the output-format
// control (SRC-7B, after S5b's formatCurrency landed at cd4ccc8).
//
// D8 (RULED): production carries both Maps secrets; LOCALLY there is no key
// (wrangler dev has none configured in this worktree) — that is the REAL,
// unforced state this spec drives against for the keyless-degrade proof
// (never faked). The real-autocomplete leg itself stays INCONCLUSIVE-pending
// -key, resolved post-deploy at cutover per D8 — not attempted here.
//
// Nothing here hand-builds both sides of a boundary (E10/E11): sections are
// authored through the REAL admin HTTP endpoints; the studio drives are real
// clicks (ZERO dispatchEvent); the phone drive is a REAL live /lg funnel.

import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { seedActiveSite } from "./listicles-p6-seed";
import { PW_PORT } from "./utils/base-url";

const LG_API = "/api/admin/leadgen";
const PORT = PW_PORT;
const uniq = Date.now();
const EVIDENCE_DIR = "../docs/leadgen/r2/evidence/p5/s5c";
mkdirSync(EVIDENCE_DIR, { recursive: true });

const REAL_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
});

// ---------------------------------------------------------------------------
// Shared helpers — cribbed verbatim in shape from leadgen-round4-acceptance
// .gesture.spec.ts (createStudioSection/openEdit/palette/canvasRender/
// openInspectorTab/seedLiveFunnel/passSharedPage/ready), the established
// per-file-local-copy convention this test-ui/ directory already uses.
// ---------------------------------------------------------------------------

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

interface Created {
  id: number;
  public_id: string;
}

async function createStudioSection(
  request: APIRequestContext,
  name: string,
  components: unknown[],
  extra: Record<string, unknown> = {},
): Promise<Created> {
  return json<Created>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: name,
        activity: "quote_funnel",
        vertical: "life",
        headline_text: name,
        continue_mode: "button",
        status: "active",
        content_json: { components },
        ...extra,
      },
    }),
    `section create (${name})`,
  );
}

const frameOf = (page: Page) => page.frameLocator("#lg-studio-canvas-frame");
const canvasRender = (page: Page) => frameOf(page).locator("#lg-studio-canvas-render");

async function openEdit(page: Page, publicId: string): Promise<void> {
  await page.goto(`/admin/leadgen/sections/${publicId}/edit`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#lg-section-name")).toBeVisible({ timeout: 15_000 });
  await expect(frameOf(page).locator("[data-question-id]").first()).toBeVisible({ timeout: 15_000 });
}

async function saveStudioAwaitOk(page: Page, publicId: string): Promise<void> {
  const loaded = page.waitForEvent("load", { timeout: 15_000 }).catch(() => null);
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes(`/sections/${publicId}`) && r.request().method() === "PATCH"),
    page.locator("#lg-section-save").click(),
  ]);
  if (!res.ok()) throw new Error(`save PATCH ${res.status()}: ${await res.text().catch(() => "")}`);
  await loaded;
}

async function openInspectorTab(page: Page, key: string): Promise<void> {
  const tab = page.locator(`[data-studio-inspector-tab="${key}"]`);
  await expect(tab).toBeVisible();
  await tab.click();
}

function palette(page: Page, type: string): Locator {
  return page.locator(`[data-add-component="${type}"]`);
}

async function seedLiveFunnel(request: APIRequestContext, tag: string, sectionIds: number[]): Promise<{ host: string; slug: string }> {
  const u = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const host = `r5c-${tag}-${u}.e2e.test`;
  const slug = `r5c-${tag}`;
  const siteId = await seedActiveSite(request, host, `S5C ${tag} ${u}`);
  const quote = await json<{ public_id: string; funnels: Array<{ variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, { data: { quote_name: `S5C ${tag} ${u}`, activity: "quote_funnel", verticals: ["life"] } }),
    "quote create",
  );
  const variantId = quote.funnels[0]!.variants[0]!.public_id;
  await json(
    await request.put(`${LG_API}/variants/${variantId}`, { data: { sections: sectionIds.map((section_id) => ({ section_id })) } }),
    "variant sections",
  );
  const trivialShared = await createStudioSection(request, `S5C shared ${tag} ${u}`, [
    { type: "ContinueButton", question_id: "q_shared_cont", props: { label: "Continue" } },
  ]);
  await json(
    await request.post(`${LG_API}/quotes/${quote.public_id}/shared-page`, { data: { sections: [{ section_id: trivialShared.id }] } }),
    "shared page create",
  );
  await json(
    await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug } }),
    "activation",
  );
  return { host, slug };
}
const shellUrl = (s: { host: string; slug: string }) => `http://${s.host}:${PORT}/lg/${s.slug}`;
async function ready(page: Page): Promise<void> {
  await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 10_000 });
}
async function passSharedPage(page: Page): Promise<void> {
  const cont = page.locator("[data-lg-continue]").first();
  await expect(cont, "the shared page's Continue is reachable").toBeVisible({ timeout: 8_000 });
  await cont.click();
}

// ===========================================================================
// #1 — Maps honesty: keyless-degrade states plainly (D8: no key locally, real
// unforced state) + the per-field Mode select degrades to Manual-only.
// ===========================================================================
test.describe("S5C #1 — Maps keyless-degrade honesty", () => {
  test("no Maps key locally -> the field-set note says so PLAINLY and the Mode select still offers the renderer's real Autofill default (R6-4, both screenshotted)", async ({ page, request }) => {
    const s = await createStudioSection(request, `S5C keyless ${uniq}`, [
      { type: "AddressAutocompleteQuestion", question_id: "q_addr", internal_field: "addr" },
    ]);
    await openEdit(page, s.public_id);
    await canvasRender(page).locator('[data-component-type="AddressAutocompleteQuestion"]').click();
    await openInspectorTab(page, "content");

    const note = page.locator("[data-address-maps-note]");
    await expect(note).toBeVisible();
    // D8: locally there is no browser key -> the plain, honest keyless copy.
    // R2 P8-6 jargon sweep (~70 sites; review-p8-5b/ + review-p8-ship/, jargon
    // gate TOTAL 0 in verify:all) rewrote this note's exact sentence —
    // MEASURED live at ui-section-studio.ts:13087. Re-minted to the shipped
    // copy, same two claims (no key configured / falls back to manual entry).
    await expect(note).toContainText("this site has no Google-Maps key yet");
    await expect(note).toContainText("visitors type every field themselves for now");

    // R2 P8 R6-4 (owner A.1 #6, cited verbatim in-file at
    // ui-section-studio.ts:12796-12922; P8-REGISTER.md M4 row, DEVIATES
    // evidence: "studio shows 4x Manual for renderer default 4x autofill"):
    // the pre-R6-4 premise this test pinned — a keyless site locks every row
    // to Manual-only — was ITSELF the defect R6-4 fixed. The Mode select now
    // mirrors what the RENDERER actually honours (presets.ts
    // readAddressFieldSpecs: anything not the literal 'manual' IS autofill),
    // and the studio's own comment is explicit that "the Maps browser key is
    // deliberately NOT part of this test — a key is a deployment fact, not an
    // authoring one." An unconfigured Address (no props.maps at all, this
    // fixture's exact shape) defaults every row to Autofill, enabled and
    // selected, matching ADDRESS_DEFAULT_FIELDS — MEASURED live:
    // options=["Manual","Autofill"], the "autofill" option carries no
    // `disabled` attribute, and the select's value is "autofill".
    const modeSelects = page.locator("[data-address-field-mode]");
    await expect(modeSelects.first()).toBeVisible();
    const count = await modeSelects.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const options = await modeSelects.nth(i).locator("option").allTextContents();
      expect(options, `field ${i} mode options`).toEqual(["Manual", "Autofill"]);
      const autoOpt = modeSelects.nth(i).locator('option[value="autofill"]');
      await expect(autoOpt, `field ${i} Autofill option is offered, never withheld`).not.toHaveAttribute("disabled", "");
      await expect(modeSelects.nth(i), `field ${i} defaults to the renderer's real autofill default`).toHaveValue("autofill");
    }

    // Scroll the honest keyless note itself into frame (centered, so it
    // survives a viewport resize's own reflow) for the evidence screenshot.
    await note.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: `${EVIDENCE_DIR}/1-keyless-degrade-1280.png` });
    await page.setViewportSize({ width: 375, height: 812 });
    await note.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: `${EVIDENCE_DIR}/1-keyless-degrade-375.png` });
  });
});

// ===========================================================================
// #2 — ADJ-A9: the "pick a job" activation-preflight friction is discoverable
// from the top of the Studio (not just a bare 409 at activation).
// ===========================================================================
test.describe("S5C #2 — ADJ-A9 Maps job-risk discoverability", () => {
  test("a Maps-enabled zero-job field shows the tree-wide risk banner; Fix it jumps to the field; picking a job clears it", async ({ page, request }) => {
    const s = await createStudioSection(request, `S5C a9 ${uniq}`, [
      {
        type: "ZIPInputQuestion",
        question_id: "q_zip",
        internal_field: "zip_a9",
        props: { maps: { enabled: true, jobs: { validate: false, auction: false, autocomplete: false } } },
      },
      { type: "FreeTextQuestion", question_id: "q_other", internal_field: "other_a9" },
    ]);
    await openEdit(page, s.public_id);
    // Select a DIFFERENT node first — the risk is discoverable WITHOUT the
    // offending node being selected (that is the whole point of ADJ-A9).
    await canvasRender(page).locator('[data-component-type="FreeTextQuestion"]').click();

    const riskBanner = page.locator("[data-studio-maps-job-risk-banner]");
    await expect(riskBanner, "the tree-wide job-risk banner is visible pre-emptively").toBeVisible();
    await expect(riskBanner).toContainText("BLOCK activation");
    await page.screenshot({ path: `${EVIDENCE_DIR}/2-a9-job-risk-banner-1280.png` });

    // Fix it -> selects the offending ZIP field: the Maps tab's job
    // checkboxes become interactable, which only happens once that SPECIFIC
    // node is selected (populateMapsTab keys off the current selection).
    await page.locator("[data-maps-job-risk-jump]").click();
    await openInspectorTab(page, "maps");
    await expect(page.locator("[data-maps-job]").first()).toBeVisible();

    // Pick a job -> the risk clears.
    await page.locator('[data-maps-job="validate"]').click();
    await expect(riskBanner, "picking a job clears the risk").toBeHidden();
  });
});

// ===========================================================================
// #3 — ADJ-A6 / D6 RULED yes: the standalone Phone palette tile authors a
// WORKING masked PhoneInputQuestion (the type + mask machinery are unchanged
// — this proves the NEW insert entry point, not the mask logic itself).
// ===========================================================================
test.describe("S5C #3 — standalone Phone tile", () => {
  test("the Phone tile inserts a real PhoneInputQuestion; the live funnel accepts a valid number and blocks an invalid one", async ({ page, request }) => {
    const s = await createStudioSection(request, `S5C phone ${uniq}`, [
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await openEdit(page, s.public_id);
    await palette(page, "PhoneInputQuestion").click();
    const phoneNode = canvasRender(page).locator('[data-component-type="PhoneInputQuestion"]');
    // The Phone tile inserts a REAL PhoneInputQuestion (makeNode auto-seeds
    // internal_field since it is REQUIRED_FIELDS-required for this type — the
    // SAME mechanism every other required-internal_field tile already uses).
    await expect(phoneNode, "the Phone tile inserts a PhoneInputQuestion").toHaveCount(1);
    await saveStudioAwaitOk(page, s.public_id);

    // A trivial SECOND section so a passing Continue has somewhere to
    // advance TO (the last section's Continue triggers funnel completion,
    // not a section bump — __p2b-phone.spec.ts's own "NEXT" precedent).
    const next = await createStudioSection(request, `S5C phone next ${uniq}`, [
      { type: "TwoButtonYesNo", question_id: "q_next", internal_field: "phone_next" },
    ]);
    // seedLiveFunnel's OWN trivial shared page occupies index 0, so the
    // phone section (first of sectionIds) is index 1, next is index 2.
    const seed = await seedLiveFunnel(request, "phone", [s.id, next.id]);
    await page.goto(shellUrl(seed), { waitUntil: "load" });
    await ready(page);
    await passSharedPage(page);
    const phoneInput = page.locator("[data-lg-index='1'] [data-lg-input]").first();
    await expect(phoneInput).toBeVisible();
    // invalid -> Continue blocked.
    await phoneInput.fill("123");
    await page.locator("[data-lg-index='1'] [data-lg-continue]").click();
    await expect(page.locator("[data-lg-index='2']")).toBeHidden();
    // valid US number -> Continue advances (default nanp preset).
    await phoneInput.fill("2125551234");
    await page.locator("[data-lg-index='1'] [data-lg-continue]").click();
    await expect(page.locator("[data-lg-index='2']")).toBeVisible();
  });
});

// ===========================================================================
// #4 — SRC-7B output-format control (after S5b's formatCurrency landed at
// cd4ccc8): authored through the REAL UI, never raw JSON.
// ===========================================================================
test.describe("S5C #4 — output-format control (currency / number / string)", () => {
  test("picking Currency string writes the formatCurrency transform, previews $170,000, and PERSISTS through the real save", async ({ page, request }) => {
    // A linked Section carrying a NUMBER-typed answer field (the output-format
    // panel is additive to dtype==='number' && source==='answer' — see
    // applyEditorVisibility) — the answer picker needs a real field to link.
    const section = await createStudioSection(request, `S5C outputformat section ${uniq}`, [
      { type: "NumberInputQuestion", question_id: "q_amt", internal_field: "amount_s5c", answer_type: "number" },
    ]);
    const offer = await json<{ id: number; public_id: string }>(
      await request.post(`${LG_API}/offers`, {
        data: {
          offer_name: `S5C outputformat ${uniq}`,
          activity: "quote_funnel",
          vertical: "life",
          conversion_tracking_method: "s2s_postback",
          offer_type: "cpc",
          placements: [`plc-s5c-${uniq}`],
          cap_enabled: false,
          calls_provider_api: true,
          bid_source: "response",
        },
      }),
      "offer create",
    );
    // Link the Section to the Offer (selected_offers) so builder_context
    // linked_fields carries amount_s5c into the answer picker.
    await json(
      await request.patch(`${LG_API}/sections/${section.public_id}`, {
        data: { selected_offers: [offer.id] },
      }),
      "link section to offer",
    );

    await page.goto(`/admin/leadgen/offers/${offer.public_id}/edit`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-lg-tab-btn="payload"]').click();
    await expect(page.locator("[data-pb-shell]")).toBeVisible({ timeout: 15_000 });

    await page.locator("#lg-pb-add-field").click();
    const nameInput = page.locator('#lg-pb-editor [data-pb-field="name"]');
    await nameInput.fill("amount");
    await nameInput.press("Enter");
    await page.locator('#lg-pb-editor [data-pb-field="type"]').selectOption("number");
    await page.locator("#lg-pb-editor [data-pb-answer-picker]").selectOption("amount_s5c");

    const outputFormat = page.locator('#lg-pb-editor [data-pb-field="output_format"]');
    await expect(outputFormat, "the output-format control is visible for a number answer field").toBeVisible();
    // Sample FIRST, then pick the format — the format select's own change
    // handler reads whatever the sample field holds at that moment to paint
    // the live preview (matching the date panel's own "type a sample, THEN
    // its preview reflects the CURRENT format" idiom).
    const sample = page.locator("[data-pb-outputformat-sample]");
    await sample.fill("170000");
    await outputFormat.selectOption("formatCurrency");
    // ui-payload-builder.ts updateOutputFormatPreview/outputFormatJsonLiteral
    // (:2854-2879): the preview deliberately shows the EXACT JSON bytes the
    // provider receives, quotes included — "the shape half of the truth the
    // operator needs: '170000' is NOT 170000" (own in-file comment). The
    // owner's own D9 shape (commit cd4ccc8, SRC-7B) is quoted the same way:
    // `170000 -> "$170,000"`. Re-minted to the shipped (quoted-string) output.
    await expect(page.locator("[data-pb-outputformat-preview]")).toHaveText('170000 → "$170,000"');
    await page.screenshot({ path: `${EVIDENCE_DIR}/4-output-format-currency-1280.png` });

    const [saveRes] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/payload-schemas")),
      page.locator("#lg-schema-save").click(),
    ]);
    expect(saveRes.status(), await saveRes.text().catch(() => "")).toBe(201);

    // PERSISTS: the stored schema's node carries the REAL formatCurrency
    // transform (never hand-typed JSON — authored purely through clicks/fills).
    const listRes = await page.request.get(`${LG_API}/offers/${offer.public_id}/payload-schemas`);
    expect(listRes.ok()).toBe(true);
    const list = (await listRes.json()) as { items: Array<{ schema_json: { root: { children: Array<Record<string, unknown>> } } }> };
    const amountNode = list.items[0]!.schema_json.root.children.find((n) => n["name"] === "amount");
    expect(amountNode?.["transform"]).toEqual([{ kind: "formatCurrency" }]);
  });
});
