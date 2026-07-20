// LeadGen Round-4 Remediation — Phase P2 slice P2c probe spec (temporary; final
// consolidation lands in P7). Proves the ANY/ALL group builder + the phone-
// format picker end to end on the REAL Section Studio + the REAL live funnel
// (real click/fill/selectOption — ZERO dispatchEvent), building on P1a's own
// "author on the real panel, live page reacts" split: the STUDIO leg proves
// the picker writes/reads the right JSON through the real PATCH; the LIVE leg
// (seeded directly with the target content_json — the SAME split
// leadgen-p4c-rules.gesture.spec.ts's legs 1-3 already establish) proves the
// runtime evaluator reacts to it. P2a/P2b already prove the evaluator/schema
// mechanics in isolation; this spec is the STUDIO's first authoring surface.
//
//   AC-1  author a 2-condition ALL group on a Dropdown's show/hide (a Yes/No
//         answer + an MQG row), save 2xx, reload round-trips both rows + the
//         ALL toggle; LIVE the Dropdown stays hidden until BOTH hold.
//   AC-2  flip the group to ANY, persists; LIVE either answer alone reveals
//         the Dropdown.
//   AC-3  phone format picker sets Israel on a Phone field, round-trips;
//         LIVE an IL-valid number passes, a US-shaped one blocks with the
//         Israeli message (reuses __p2b-phone.spec.ts's live-driving idiom).
//   AC-4  a legacy bare conditional (seeded via API, pre-group) renders as a
//         single row; saving WITHOUT touching it persists the bare shape
//         byte-identically — no silent migration to the composed shape.
//
// chromium-only (playwright.config.ts: firefox testMatch is the gesture set;
// this non-gesture spec is picked up by chromium alone, like __p1a/__p1b/
// __p2b). The dynamic {uniq}.e2e.test host needs chromium's
// --host-resolver-rules.

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { seedActiveSite } from "./listicles-p6-seed";
import { PW_PORT } from "./utils/base-url";

test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] } });

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const LG_API = "/api/admin/leadgen";
const SHOT_DIR = "test-artifacts/leadgen-p2c";
const uniq = Date.now();

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

interface CreatedSection {
  id: number;
  public_id: string;
}

async function createSection(request: APIRequestContext, body: Record<string, unknown>): Promise<CreatedSection> {
  return json<CreatedSection>(
    await request.post(`${LG_API}/sections`, { data: { activity: "quote_funnel", vertical: "life", status: "active", ...body } }),
    "section create",
  );
}

async function fetchSection(request: APIRequestContext, publicId: string): Promise<{ content_json: { components: Array<Record<string, unknown>> } }> {
  return json(await request.get(`${LG_API}/sections/${publicId}`), "section detail");
}

async function openEdit(page: Page, publicId: string): Promise<void> {
  await page.goto(`/admin/leadgen/sections/${publicId}/edit`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#lg-section-name")).toBeVisible();
}

function canvas(page: Page) {
  return page.frameLocator("#lg-studio-canvas-frame").locator("#lg-studio-canvas-render");
}

async function saveStudio(page: Page): Promise<void> {
  await Promise.all([page.waitForEvent("load"), page.locator("#lg-section-save").click()]);
}

// A trivial SECOND section so a passing Continue has somewhere to advance TO
// (the last section's Continue triggers funnel completion, not a section
// bump) — mirrors __p2b-phone.spec.ts's own NEXT fixture exactly.
function nextSectionBody(tag: string) {
  return {
    section_name: `P2c next ${tag} ${uniq}`,
    headline_text: "Step 2",
    content_json: JSON.stringify({ components: [{ type: "TwoButtonYesNo", question_id: "qn9", internal_field: `z9_${tag}` }] }),
  };
}

async function activateFunnel(
  request: APIRequestContext,
  tag: string,
  sectionId: number,
): Promise<{ host: string; slug: string }> {
  const u = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const host = `lg-p2c-${tag}-${u}.e2e.test`;
  const siteId = await seedActiveSite(request, host, `P2c ${tag} ${u}`);
  const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, { data: { quote_name: `P2c ${tag} ${u}`, activity: "quote_funnel", verticals: ["life"] } }),
    "quote create",
  );
  const variantId = quote.funnels[0]!.variants[0]!.public_id;
  const next = await createSection(request, nextSectionBody(tag));
  await json(
    await request.put(`${LG_API}/variants/${variantId}`, { data: { sections: [{ section_id: sectionId }, { section_id: next.id }] } }),
    "variant sections",
  );
  await json(await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug: tag } }), "activation");
  return { host, slug: tag };
}

const shellUrl = (s: { host: string; slug: string }) => `http://${s.host}:${PW_PORT}/lg/${s.slug}`;

async function ready(page: Page): Promise<void> {
  await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 8_000 });
}
function sectionIndex(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __LG_ENGINE__: { getState(): { section_index: number } } }).__LG_ENGINE__.getState().section_index);
}

test.beforeAll(() => {
  mkdirSync(SHOT_DIR, { recursive: true });
});

// The shared section shape for AC-1/AC-2's LIVE legs: a boolean Yes/No
// ("insured"), an MQG row ("prior_claims", sharing a Yes/No pill set), a
// target Dropdown whose show/hide is the composed group under test, and a
// Continue. Only the target's `conditional` differs between callers.
function groupTargetContent(conditional: unknown) {
  return {
    components: [
      { type: "TwoButtonYesNo", question_id: "q_yn", internal_field: "insured", answer_type: "boolean", props: { yesLabel: "Yes", noLabel: "No" } },
      {
        type: "MultiQuestionGrid",
        question_id: "q_mqg",
        choices: [
          { label: "Yes", value: "yes", analytics_id: "mqg_yes" },
          { label: "No", value: "no", analytics_id: "mqg_no" },
        ],
        props: { rows: [{ label: "Prior claims?", internal_field: "prior_claims" }] },
      },
      {
        type: "DropdownQuestion",
        question_id: "q_dd",
        internal_field: "plan",
        answer_type: "enum",
        choices: [
          { label: "See my quote", value: "quote", analytics_id: "dd_quote" },
          { label: "Not now", value: "later", analytics_id: "dd_later" },
        ],
        conditional,
      },
      { type: "ContinueButton", question_id: "q_cont" },
    ],
  };
}

// ---------------------------------------------------------------------------
// AC-1 — author a 2-condition ALL group via real clicks; reload round-trips
// ---------------------------------------------------------------------------
test.describe("P2c AC-1 — ANY/ALL group builder: author a 2-condition ALL group, reload round-trips", () => {
  test("Show-if group (Yes/No + MQG row), ALL by default: both rows + toggle survive a reload", async ({ page }) => {
    const section = await createSection(page.request, {
      section_name: `P2c AC1 ${uniq}`,
      headline_text: "Are you currently insured?",
      content_json: JSON.stringify(groupTargetContent(undefined)),
    });
    await openEdit(page, section.public_id);

    await canvas(page).locator('[data-component-type="DropdownQuestion"]').click();
    await page.locator('[data-studio-inspector-tab="rules"]').click();
    await page.locator("[data-rules-add-condition]").click();

    // Row 0: insured is Yes (boolean picker).
    const when0 = page.locator('[data-inspector-cond="when"]').nth(0);
    await when0.selectOption("insured");
    await page.locator('[data-inspector-cond="op"]').nth(0).selectOption("eq");
    const bool0 = page.locator('[data-inspector-cond="value-bool"]').nth(0);
    await expect(bool0).toBeVisible();
    await bool0.selectOption("true");

    // The ANY/ALL toggle + the "+ Add condition" affordance are collapsed
    // until a 2nd row exists.
    await expect(page.locator("[data-rules-match-group]")).toBeHidden();

    // "+ Add condition" appends row 1 (the MQG row).
    await page.locator("[data-rules-add-row]").click();
    await expect(page.locator("[data-rules-match-group]")).toBeVisible();
    const when1 = page.locator('[data-inspector-cond="when"]').nth(1);
    await expect(when1).toHaveCount(1);
    await when1.selectOption("prior_claims");
    await page.locator('[data-inspector-cond="op"]').nth(1).selectOption("eq");
    const enum1 = page.locator('[data-inspector-cond="value-enum"]').nth(1);
    await expect(enum1).toBeVisible();
    await enum1.selectOption("yes");

    // ALL is the default active side of the toggle.
    await expect(page.locator('[data-set-rules-match="all"]')).toHaveClass(/active/);
    const sentence = page.locator("[data-cond-sentence]");
    await expect(sentence).toContainText("AND");
    await expect(sentence).toContainText("Prior claims?");
    await page.screenshot({ path: `${SHOT_DIR}/ac1-authored-all.png` });

    await saveStudio(page);

    const savedDetail = await fetchSection(page.request, section.public_id);
    const dd = savedDetail.content_json.components.find((c) => c["question_id"] === "q_dd");
    expect(dd?.["conditional"]).toEqual({
      match: "all",
      conditions: [
        { when: "insured", op: "eq", value: true },
        { when: "prior_claims", op: "eq", value: "yes" },
      ],
    });

    // Reload round-trip: the clean save already hard-navigated back here.
    await expect(page.locator("#lg-section-name")).toBeVisible();
    await canvas(page).locator('[data-component-type="DropdownQuestion"]').click();
    await page.locator('[data-studio-inspector-tab="rules"]').click();
    await expect(page.locator('[data-inspector-cond="when"]')).toHaveCount(2);
    await expect(page.locator('[data-inspector-cond="when"]').nth(0)).toHaveValue("insured");
    await expect(page.locator('[data-inspector-cond="value-bool"]').nth(0)).toHaveValue("true");
    await expect(page.locator('[data-inspector-cond="when"]').nth(1)).toHaveValue("prior_claims");
    await expect(page.locator('[data-inspector-cond="value-enum"]').nth(1)).toHaveValue("yes");
    await expect(page.locator("[data-rules-match-group]")).toBeVisible();
    await expect(page.locator('[data-set-rules-match="all"]')).toHaveClass(/active/);
    await page.screenshot({ path: `${SHOT_DIR}/ac1-reload-roundtrip.png` });
  });
});

test.describe("P2c AC-1 LIVE — ALL group: the Dropdown stays hidden until BOTH answers hold", () => {
  test("neither -> hidden; ONE of two -> still hidden; BOTH -> visible", async ({ page }) => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    const section = await createSection(ctx, {
      section_name: `P2c AC1 live ${uniq}`,
      headline_text: "Are you currently insured?",
      content_json: JSON.stringify(
        groupTargetContent({
          match: "all",
          conditions: [
            { when: "insured", op: "eq", value: true },
            { when: "prior_claims", op: "eq", value: "yes" },
          ],
        }),
      ),
    });
    const seeded = await activateFunnel(ctx, "all", section.id);
    await ctx.dispose();

    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await ready(page);
    const dropdown = page.locator('[data-lg-question="q_dd"]');
    await expect(dropdown, "hidden before any answer").toBeHidden();

    await page.locator('[data-lg-question="q_yn"] [data-lg-choice="true"]').click();
    await expect(dropdown, "still hidden with only 1 of 2 conditions met (AND)").toBeHidden();

    await page.locator('[data-lg-field="prior_claims"] [data-lg-choice="yes"]').click();
    await expect(dropdown, "visible once BOTH conditions hold").toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/ac1-live-all-revealed.png` });
  });
});

// ---------------------------------------------------------------------------
// AC-2 — flip the SAME group to ANY; persists; LIVE either answer reveals it
// ---------------------------------------------------------------------------
test.describe("P2c AC-2 — flip an authored group to ANY via a real click; persists", () => {
  test("clicking 'Match ANY of these' persists match:'any' over the existing 2 conditions", async ({ page }) => {
    const section = await createSection(page.request, {
      section_name: `P2c AC2 ${uniq}`,
      headline_text: "Are you currently insured?",
      content_json: JSON.stringify(
        groupTargetContent({
          match: "all",
          conditions: [
            { when: "insured", op: "eq", value: true },
            { when: "prior_claims", op: "eq", value: "yes" },
          ],
        }),
      ),
    });
    await openEdit(page, section.public_id);
    await canvas(page).locator('[data-component-type="DropdownQuestion"]').click();
    await page.locator('[data-studio-inspector-tab="rules"]').click();

    await expect(page.locator("[data-rules-match-group]")).toBeVisible();
    await expect(page.locator('[data-set-rules-match="all"]')).toHaveClass(/active/);

    await page.locator('[data-set-rules-match="any"]').click();
    await expect(page.locator('[data-set-rules-match="any"]')).toHaveClass(/active/);
    await expect(page.locator('[data-set-rules-match="all"]')).not.toHaveClass(/active/);
    const sentence = page.locator("[data-cond-sentence]");
    await expect(sentence).toContainText("OR");
    await page.screenshot({ path: `${SHOT_DIR}/ac2-flipped-any.png` });

    await saveStudio(page);

    const savedDetail = await fetchSection(page.request, section.public_id);
    const dd = savedDetail.content_json.components.find((c) => c["question_id"] === "q_dd");
    expect(dd?.["conditional"]).toEqual({
      match: "any",
      conditions: [
        { when: "insured", op: "eq", value: true },
        { when: "prior_claims", op: "eq", value: "yes" },
      ],
    });
  });
});

test.describe("P2c AC-2 LIVE — ANY group: either answer alone reveals the Dropdown", () => {
  const ANY_CONDITIONAL = {
    match: "any",
    conditions: [
      { when: "insured", op: "eq", value: true },
      { when: "prior_claims", op: "eq", value: "yes" },
    ],
  };

  test("the Yes/No answer ALONE reveals it", async ({ page }) => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    const section = await createSection(ctx, {
      section_name: `P2c AC2 live yn ${uniq}`,
      headline_text: "Are you currently insured?",
      content_json: JSON.stringify(groupTargetContent(ANY_CONDITIONAL)),
    });
    const seeded = await activateFunnel(ctx, "anyyn", section.id);
    await ctx.dispose();

    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await ready(page);
    const dropdown = page.locator('[data-lg-question="q_dd"]');
    await expect(dropdown).toBeHidden();
    await page.locator('[data-lg-question="q_yn"] [data-lg-choice="true"]').click();
    await expect(dropdown, "the Yes/No answer alone satisfies ANY").toBeVisible();
  });

  test("the MQG row ALONE reveals it", async ({ page }) => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    const section = await createSection(ctx, {
      section_name: `P2c AC2 live mqg ${uniq}`,
      headline_text: "Are you currently insured?",
      content_json: JSON.stringify(groupTargetContent(ANY_CONDITIONAL)),
    });
    const seeded = await activateFunnel(ctx, "anymqg", section.id);
    await ctx.dispose();

    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await ready(page);
    const dropdown = page.locator('[data-lg-question="q_dd"]');
    await expect(dropdown).toBeHidden();
    await page.locator('[data-lg-field="prior_claims"] [data-lg-choice="yes"]').click();
    await expect(dropdown, "the MQG row alone satisfies ANY").toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/ac2-live-any-mqg-revealed.png` });
  });
});

// ---------------------------------------------------------------------------
// AC-3 — phone format picker sets Israel; round-trips; LIVE IL passes /
// US-shaped blocks with the Israeli message
// ---------------------------------------------------------------------------
test.describe("P2c AC-3 — Phone format picker: Israel, round-trips, LIVE behavior", () => {
  test("setting 'Israel' persists props.phone_format='il'; reload round-trips; LIVE IL-valid passes, US-shaped invalid blocks with the Israeli message", async ({ page }) => {
    const section = await createSection(page.request, {
      section_name: `P2c AC3 ${uniq}`,
      headline_text: "Your phone",
      content_json: JSON.stringify({
        components: [
          { type: "PhoneInputQuestion", question_id: "q1", internal_field: "phone", required: true },
          { type: "ContinueButton", question_id: "q_cont" },
        ],
      }),
    });
    await openEdit(page, section.public_id);
    await canvas(page).locator('[data-component-type="PhoneInputQuestion"]').click();
    await page.locator('[data-studio-inspector-tab="content"]').click();

    const preset = page.locator("[data-phone-format-preset]");
    await expect(preset).toBeVisible();
    await expect(preset).toHaveValue("nanp");
    await preset.selectOption("il");
    await expect(page.locator("[data-phone-format-custom]")).toBeHidden();
    await page.screenshot({ path: `${SHOT_DIR}/ac3-picker-israel.png` });

    await saveStudio(page);

    const savedDetail = await fetchSection(page.request, section.public_id);
    const phoneNode = savedDetail.content_json.components.find((c) => c["question_id"] === "q1");
    expect(phoneNode?.["props"]).toMatchObject({ phone_format: "il" });

    // Reload round-trip.
    await expect(page.locator("#lg-section-name")).toBeVisible();
    await canvas(page).locator('[data-component-type="PhoneInputQuestion"]').click();
    await page.locator('[data-studio-inspector-tab="content"]').click();
    await expect(page.locator("[data-phone-format-preset]")).toHaveValue("il");

    // LIVE: activate a funnel against THIS section (now saved with
    // phone_format='il') and drive it — reuses __p2b-phone.spec.ts's own
    // fill/click/error-slot idiom verbatim.
    const seeded = await activateFunnel(page.request, "il", section.id);
    await page.goto(`http://${seeded.host}:${PW_PORT}/lg/${seeded.slug}`, { waitUntil: "load" });
    await ready(page);
    expect(await sectionIndex(page), "start on the phone section").toBe(0);

    // US-shaped invalid (no leading 0, 10 digits) blocks with the Israeli message.
    await page.locator('[data-lg-index="0"] [data-lg-input]').first().fill("4155551234");
    await page.locator('[data-lg-index="0"] [data-lg-continue]').first().click();
    await page.waitForTimeout(300);
    expect(await sectionIndex(page), "US-shaped phone must block Continue under the IL preset").toBe(0);
    const slot = page.locator('[data-lg-index="0"] [data-lg-error-for="phone"]');
    await expect(slot).toBeVisible();
    await expect(slot).toContainText("Israeli");
    await page.screenshot({ path: `${SHOT_DIR}/ac3-live-invalid.png` });

    // IL-valid (leading 0, Israeli mobile shape) advances.
    await page.locator('[data-lg-index="0"] [data-lg-input]').first().fill("0541234567");
    await page.locator('[data-lg-index="0"] [data-lg-continue]').first().click();
    await expect.poll(() => sectionIndex(page), { timeout: 5_000 }).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC-4 — a legacy bare conditional renders as ONE row; an untouched save
// persists the bare shape byte-identically (no silent migration)
// ---------------------------------------------------------------------------
test.describe("P2c AC-4 — legacy bare conditional: single row, untouched save is byte-identical", () => {
  test("a pre-group bare conditional (seeded via API) shows exactly one row; saving without touching it leaves content_json unchanged", async ({ page }) => {
    const BARE_CONDITIONAL = { when: "has_pet", op: "eq", value: true };
    const section = await createSection(page.request, {
      section_name: `P2c AC4 ${uniq}`,
      headline_text: "Do you have a pet?",
      content_json: JSON.stringify({
        components: [
          { type: "TwoButtonYesNo", question_id: "q_yn", internal_field: "has_pet", answer_type: "boolean" },
          {
            type: "DropdownQuestion",
            question_id: "q_dd",
            internal_field: "pet_type",
            answer_type: "enum",
            choices: [
              { label: "Dog", value: "dog", analytics_id: "dd_dog" },
              { label: "Cat", value: "cat", analytics_id: "dd_cat" },
            ],
            conditional: BARE_CONDITIONAL,
          },
          { type: "ContinueButton", question_id: "q_cont" },
        ],
      }),
    });
    const before = await fetchSection(page.request, section.public_id);
    const beforeDd = before.content_json.components.find((c) => c["question_id"] === "q_dd");
    expect(beforeDd?.["conditional"]).toEqual(BARE_CONDITIONAL);

    await openEdit(page, section.public_id);
    await canvas(page).locator('[data-component-type="DropdownQuestion"]').click();
    await page.locator('[data-studio-inspector-tab="rules"]').click();

    // Exactly ONE row — no extra rows, the ANY/ALL toggle stays collapsed.
    await expect(page.locator('[data-inspector-cond="when"]')).toHaveCount(1);
    await expect(page.locator("[data-cond-extra-row]")).toHaveCount(0);
    await expect(page.locator("[data-rules-match-group]")).toBeHidden();
    await expect(page.locator('[data-inspector-cond="when"]')).toHaveValue("has_pet");
    await expect(page.locator('[data-inspector-cond="value-bool"]')).toHaveValue("true");
    await page.screenshot({ path: `${SHOT_DIR}/ac4-single-row.png` });

    // Save WITHOUT touching the rule (only navigating tabs/selecting the
    // node, never firing an input/change on any [data-inspector-cond] control).
    await saveStudio(page);

    const after = await fetchSection(page.request, section.public_id);
    const afterDd = after.content_json.components.find((c) => c["question_id"] === "q_dd");
    expect(afterDd?.["conditional"], "byte-identical bare shape — no silent migration to {match,conditions}").toEqual(BARE_CONDITIONAL);
  });
});
