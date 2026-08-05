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
//         answer + a second yes/no-choice source, §10/S5.1: was an MQG row),
//         save 2xx, reload round-trips both rows + the ALL toggle; LIVE the
//         Dropdown stays hidden until BOTH hold.
//   AC-2  flip the group to ANY, persists; LIVE either answer alone reveals
//         the Dropdown.
//   AC-3  [LeadGen Rework §10/§6.9 rewrite] the phone-preset picker (Israel/
//         International country list) this AC originally proved is a §10 dead
//         feature — the country list is REMOVED, replaced by the M8 mask
//         builder (a digit-group Format input + live scaffold preview, no
//         country selector at all). Rewritten to prove the MASK builder
//         instead (pattern -> scaffold preview round-trips through the real
//         PATCH), the same journey shape leadgen-rework-p2-studio.gesture
//         .spec.ts's test (b) already proves end to end — this AC keeps the
//         narrower "picker persists through Section Studio" leg so the P6
//         acceptance close's full mask journey (invalid-pattern A-10 error,
//         prefill chips, live scaffold-fill validation) isn't duplicated here.
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

// R2 P8 M6/R4 (ui-section-studio.ts:7888-7930, updateCanvasHiddenList /
// hiddenPickHandler): the canvas paints only the RESTING state (no simulated
// answers — normalizeAnswers is called with `{}`), so a component gated by a
// conditional whose conditions are not met by an EMPTY answer set renders
// NOTHING inside `#lg-studio-canvas-render` — MEASURED live: a section
// seeded with an authored 2-condition group never shows the gated Dropdown
// in the iframe, on first load OR after a reload. This is deliberate, not a
// regression: the shipped, documented alternative lives in the PARENT page,
// outside the iframe — a "Not on the page at the start..." list renders one
// `[data-canvas-hidden-pick="<question_id>"]` button per gated-and-hidden
// question, and clicking it calls the SAME `selectComponent(qid)` a canvas
// click would (own in-file comment: "exactly as a canvas click would").
// Try the real canvas click first (the common, unconditional-node path every
// other spec in this file still exercises); fall back to the hidden-pick
// button when the node is gated and its conditions are currently unmet.
async function selectDropdownQuestion(page: Page, questionId: string): Promise<void> {
  try {
    await canvas(page).locator('[data-component-type="DropdownQuestion"]').click({ timeout: 3_000 });
  } catch {
    await page.locator(`[data-canvas-hidden-pick="${questionId}"]`).click();
  }
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
  // LeadGen Rework §4.3-1/§4.3-15 (P1, own-hand-verified): activation now
  // preflights "the shared first page needs at least one section" — this
  // pre-M2 helper predates that requirement. Seed a TRIVIAL pass-through
  // shared page (a single ContinueButton, no questions) so every live leg
  // advances through it in one click (passSharedPage below) before reaching
  // the funnel content under test.
  const trivialShared = await createSection(request, {
    section_name: `P2c shared ${tag} ${u}`,
    headline_text: "Shared",
    content_json: JSON.stringify({ components: [{ type: "ContinueButton", question_id: "q_shared_cont", props: { label: "Continue" } }] }),
  });
  await json(
    await request.post(`${LG_API}/quotes/${quote.public_id}/shared-page`, { data: { sections: [{ section_id: trivialShared.id }] } }),
    "shared page create",
  );
  await json(await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug: tag } }), "activation");
  return { host, slug: tag };
}

// Click the trivial shared-page's Continue button once (see activateFunnel's
// own comment) so a live leg lands on the funnel content under test.
async function passSharedPage(page: Page): Promise<void> {
  const cont = page.locator("[data-lg-continue]").first();
  await expect(cont, "the shared page's Continue is reachable").toBeVisible({ timeout: 8_000 });
  await cont.click();
}

const shellUrl = (s: { host: string; slug: string }) => `http://${s.host}:${PW_PORT}/lg/${s.slug}`;

async function ready(page: Page): Promise<void> {
  await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 8_000 });
}

test.beforeAll(() => {
  mkdirSync(SHOT_DIR, { recursive: true });
});

// The shared section shape for AC-1/AC-2's LIVE legs: a boolean Yes/No
// ("insured"), a SECOND independent yes/no-choice source ("prior_claims",
// sharing the SAME "yes"/"no" value vocabulary a MultiQuestionGrid row once
// used — §10/S5.1: MultiQuestionGrid is retired, replaced here with a
// ButtonAnswerGroup carrying the identical choices; data-lg-field/
// data-lg-choice render the same way, so every selector below is unaffected),
// a target Dropdown whose show/hide is the composed group under test, and a
// Continue. Only the target's `conditional` differs between callers.
function groupTargetContent(conditional: unknown) {
  return {
    components: [
      { type: "TwoButtonYesNo", question_id: "q_yn", internal_field: "insured", answer_type: "boolean", props: { yesLabel: "Yes", noLabel: "No" } },
      {
        type: "ButtonAnswerGroup",
        question_id: "q_mqg",
        internal_field: "prior_claims",
        answer_type: "enum",
        choices: [
          { label: "Yes", value: "yes", analytics_id: "mqg_yes" },
          { label: "No", value: "no", analytics_id: "mqg_no" },
        ],
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
    // §10/S5.1: the second source's label — a plain ButtonAnswerGroup carries
    // NO custom per-field label (unlike the retired MQG row's own "Prior
    // claims?" text) — sectionFieldLabels falls back to the component's OWN
    // type label ("Simple answer buttons") here, not an arbitrary string.
    await expect(sentence).toContainText("Simple answer buttons");
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
    // The persisted 2-condition ALL group is unmet by the canvas's empty
    // resting-state answers, so the Dropdown no longer paints in the iframe
    // (see selectDropdownQuestion) — reselect it via the shipped hidden-pick.
    await selectDropdownQuestion(page, "q_dd");
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
    await passSharedPage(page);
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
    // Seeded WITH the 2-condition ALL group already active — unmet by the
    // canvas's empty resting-state answers, so the Dropdown never paints in
    // the iframe on this first load either (see selectDropdownQuestion).
    await selectDropdownQuestion(page, "q_dd");
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
    await passSharedPage(page);
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
    await passSharedPage(page);
    const dropdown = page.locator('[data-lg-question="q_dd"]');
    await expect(dropdown).toBeHidden();
    await page.locator('[data-lg-field="prior_claims"] [data-lg-choice="yes"]').click();
    await expect(dropdown, "the MQG row alone satisfies ANY").toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/ac2-live-any-mqg-revealed.png` });
  });
});

// ---------------------------------------------------------------------------
// AC-3 — LeadGen Rework §10/§6.9: the phone-preset country-list journey this
// AC used to prove is a §10 DEAD FEATURE (data-phone-format-preset no longer
// exists — the country list is removed, own-hand-verified against
// ui-section-studio.ts's renderPhoneFormatControls). Rewritten around the
// REPLACEMENT mechanism, the M8 mask builder: a Format pattern input sets a
// digit-group mask, round-trips through the real PATCH. This is the
// narrower "Section Studio persists the picker" leg; the fuller mask journey
// (invalid-pattern A-10 error inline, prefill chips, live scaffold-fill
// validation blocking/passing Continue) is proven end to end by
// leadgen-rework-p2-studio.gesture.spec.ts's test (b) and is the P6
// acceptance close's terminal artifact for §11 AC#5 — not duplicated here.
// ---------------------------------------------------------------------------
test.describe("P2c AC-3 — Mask builder: a Format pattern persists through Section Studio", () => {
  test("typing a mask pattern persists props.phone_format.mask.pattern; reload round-trips", async ({ page }) => {
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

    const pattern = page.locator("[data-phone-mask-pattern]");
    await expect(pattern).toBeVisible();
    await pattern.fill("(3) 3-4");
    await pattern.blur();
    await expect(page.locator("[data-phone-mask-preview]"), "the scaffold preview updates").toHaveText("(___) ___-____");
    await expect(page.locator("[data-phone-mask-error]"), "no error on a valid pattern").toBeHidden();
    await page.screenshot({ path: `${SHOT_DIR}/ac3-mask-pattern.png` });

    await saveStudio(page);

    const savedDetail = await fetchSection(page.request, section.public_id);
    const phoneNode = savedDetail.content_json.components.find((c) => c["question_id"] === "q1") as {
      props?: { phone_format?: { mask?: { pattern?: string } } };
    };
    expect(phoneNode?.props?.phone_format?.mask?.pattern).toBe("(3) 3-4");

    // Reload round-trip.
    await expect(page.locator("#lg-section-name")).toBeVisible();
    await canvas(page).locator('[data-component-type="PhoneInputQuestion"]').click();
    await page.locator('[data-studio-inspector-tab="content"]').click();
    await expect(page.locator("[data-phone-mask-pattern]")).toHaveValue("(3) 3-4");
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
    // Seeded WITH the bare conditional already active — unmet by the
    // canvas's empty resting-state answers (see selectDropdownQuestion).
    await selectDropdownQuestion(page, "q_dd");
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
