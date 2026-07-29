// LeadGen R2 P1 FIX-FIRST — the DRIVEN-PRODUCT smoke for the three blockers
// the adversarial review found on the owner's 18.30.25 scenario.
//
// Nothing here is hand-built: the grid is AUTHORED through the real studio UI
// (a real click on the library tile, real per-character typing into the
// question-label input, real selects for type/field/default/dependency, the
// real Save), and it is then DRIVEN as a visitor on the real public runtime.
//
//   B1  the label the operator types is the label that lands (the pre-fix
//       editor rebuilt itself on every keystroke and ate the text)
//   B2  a UI-authored dropdown default is the visitor's answer: the popped-in
//       question shows it preselected and Continue is allowed UNTOUCHED
//   B3  answering "No" makes the dependent question not exist: it is not in
//       the DOM, not in the /lg/auction envelope, and not in the payload the
//       provider receives (leadgen_provider_request_log)
//
// Prerequisites (the mission's own smoke lane, not CI): a local wrangler dev
// on PW_PORT with the r2fix fixture seeded (npm run seed:leadgen-fixture) and
// a live mock provider wired to the fixture Offer.

import { test, expect, request as playwrightRequest, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { PW_PORT } from "./utils/base-url";

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const SITE_HOST = "r2fix.e2e.test";
const FUNNEL_SLUG = "r2fix";
const SHOT_DIR = "test-artifacts/r2p1-fixround";
const TYPED_LABEL = "Are you currently insured?";
const INSURER_LABEL = "Who is your current insurer?";
const TRIGGER_FIELD = "r2p1_currently_insured";
const DEPENDENT_FIELD = "r2p1_current_insurer";

const REAL_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
});
test.describe.configure({ mode: "serial" });

interface SectionRow {
  id: number;
  public_id: string;
  section_name: string;
}
let SECTION: SectionRow;
let defaultChoiceValue = "";

type ApiCtx = Awaited<ReturnType<typeof playwrightRequest.newContext>>;
async function fixtureOfferId(ctx: ApiCtx): Promise<number> {
  const res = (await (await ctx.get("/api/admin/leadgen/offers?activity=r2fix_activity")).json()) as {
    items: Array<{ id: number; offer_name: string }>;
  };
  const offer = res.items.find((o) => o.offer_name === "R2Fix Fixture Offer");
  if (offer === undefined) throw new Error("fixture offer missing — run npm run seed:leadgen-fixture");
  return offer.id;
}

test.beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  const res = await ctx.get("/api/admin/leadgen/sections?activity=r2fix_activity");
  const body = (await res.json()) as { items: SectionRow[] };
  const found = body.items.find((s) => s.section_name === "R2Fix Fixture Carrier Buttons");
  if (found === undefined) throw new Error("fixture buttons section missing — run npm run seed:leadgen-fixture");
  SECTION = found;
  // Re-run safety: author from the fixture's own baseline content every time,
  // so a previous run's grid is never duplicated (duplicate internal_field
  // would be a legitimate save refusal and mask the real journey).
  const reset = await ctx.patch(`/api/admin/leadgen/sections/${SECTION.public_id}`, {
    data: {
      content_json: JSON.stringify({
        components: [
          { type: "QuestionHeadline", question_id: "r2fix_q_head", props: { text: "Which carrier do you want a quote from?" } },
          {
            type: "ButtonAnswerGroup",
            question_id: "r2fix_q_carrier",
            question_key: "r2fix_carrier",
            internal_field: "r2fix_carrier",
            answer_type: "enum",
            required: true,
            choices: [
              { label: "Acme Insurance", value: "acme_insurance", analytics_id: "r2fix_acme_insurance" },
              { label: "Beta Mutual", value: "beta_mutual", analytics_id: "r2fix_beta_mutual" },
              { label: "Gamma Direct", value: "gamma_direct", analytics_id: "r2fix_gamma_direct" },
            ],
          },
          { type: "ContinueButton", question_id: "r2fix_q_cont", props: { label: "Continue" } },
        ],
      }),
      // the maps must be reset in the SAME call — a stale map pointing at a
      // removed question_id is a legitimate save refusal
      selected_offers: [await fixtureOfferId(ctx)],
      answer_maps: [
        {
          question_id: "r2fix_q_carrier",
          offer_id: await fixtureOfferId(ctx),
          offer_payload_field_path: "lead.r2fix_carrier",
          provider_expected_type: "string",
          required_for_offer: true,
          internal_field: "r2fix_carrier",
          answer_type: "enum",
        },
      ],
    },
  });
  if (reset.status() !== 200) throw new Error(`baseline reset failed: ${reset.status()} ${await reset.text()}`);
  await ctx.dispose();
});

// ONE authoring journey: insert the grid, type the label (B1), make question 2
// the dependent dropdown with a UI-authored default (B2), Save.
test("B1 + B2 authoring — the operator types a real label and authors a defaulted dependent dropdown, then Saves", async ({
  page,
}) => {
  await page.goto(`${ORIGIN}/admin/leadgen/sections/${SECTION.public_id}/edit`, { waitUntil: "domcontentloaded" });
  // real click on the library tile — the operator's own insertion path
  await page.locator('[data-add-component="QuestionGrid"]').first().click();
  const rows = page.locator("[data-grid-question-row]");
  await expect(rows.first()).toBeVisible();

  const labelIn = rows.nth(0).locator('[data-grid-q-field="label"]');
  await labelIn.click();
  await labelIn.press("ControlOrMeta+a");
  await labelIn.press("Backspace");
  // REAL keystrokes, one at a time — the pre-fix editor lost them here
  await labelIn.pressSequentially(TYPED_LABEL, { delay: 15 });
  await expect(labelIn).toHaveValue(TYPED_LABEL);
  // focus never left the field the operator is typing in
  const focusedAttr = await page.evaluate(() => document.activeElement?.getAttribute("data-grid-q-field") ?? "");
  expect(focusedAttr).toBe("label");
  console.log(`SMOKE-B1 typed-label="${await labelIn.inputValue()}" focus="${focusedAttr}"`);
  await page.screenshot({ path: `${SHOT_DIR}/b1-typed-label.png`, fullPage: false });

  // field name for the trigger question
  const fieldIn = rows.nth(0).locator('[data-grid-q-field="internal_field"]');
  await fieldIn.click();
  await fieldIn.press("ControlOrMeta+a");
  await fieldIn.fill(TRIGGER_FIELD);
  await fieldIn.blur();
  // the trigger must be a Yes/No question
  await rows.nth(0).locator('[data-grid-q-field="type"]').selectOption("TwoButtonYesNo");
  await expect(page.locator("[data-grid-question-row]").nth(0).locator('[data-grid-q-field="label"]')).toHaveValue(
    TYPED_LABEL,
  );

  // question 2 becomes the dependent dropdown
  const row2 = rows.nth(1);
  await row2.locator('[data-grid-q-field="type"]').selectOption("DropdownQuestion");
  const label2 = page.locator("[data-grid-question-row]").nth(1).locator('[data-grid-q-field="label"]');
  await label2.click();
  await label2.press("ControlOrMeta+a");
  await label2.pressSequentially(INSURER_LABEL, { delay: 10 });
  await expect(label2).toHaveValue(INSURER_LABEL);
  const field2 = page.locator("[data-grid-question-row]").nth(1).locator('[data-grid-q-field="internal_field"]');
  await field2.click();
  await field2.press("ControlOrMeta+a");
  await field2.fill(DEPENDENT_FIELD);
  await field2.blur();
  // required — the owner's pinned Q2 is required
  const req2 = page.locator("[data-grid-question-row]").nth(1).locator('[data-grid-q-field="required"]');
  if (!(await req2.isChecked())) await req2.check();

  // the DEFAULT, authored in the UI (the B2 producer)
  const def2 = page.locator("[data-grid-question-row]").nth(1).locator('[data-grid-q-field="default"]');
  const options = await def2.locator("option").evaluateAll((els) =>
    els.map((e) => ({ value: (e as HTMLOptionElement).value, label: e.textContent ?? "" })),
  );
  const pick = options.find((o) => o.value !== "");
  expect(pick, "the dropdown offers its authored answers as defaults").toBeTruthy();
  defaultChoiceValue = pick!.value;
  await def2.selectOption(defaultChoiceValue);

  // the dependency, in question terms: show it when the trigger is Yes
  const dep2 = page.locator(`[data-grid-dep-row]`).nth(1);
  await dep2.locator('[data-grid-dep="when"]').selectOption(TRIGGER_FIELD);
  await dep2.locator('[data-grid-dep="op"]').selectOption("eq");
  await dep2.locator('[data-grid-dep="value-bool"]').selectOption("true");

  // remove any extra starter questions so the screen is exactly the pin
  const extra = page.locator("[data-grid-question-row]");
  while ((await extra.count()) > 2) {
    await extra.nth(2).locator("[data-grid-q-remove]").click();
  }
  await page.screenshot({ path: `${SHOT_DIR}/b2-authored-grid.png`, fullPage: false });
  await Promise.all([page.waitForEvent("load"), page.locator("#lg-section-save").click()]);

  // API read-back: the canonical default key is on the stored child
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  const saved = (await (await ctx.get(`/api/admin/leadgen/sections/${SECTION.public_id}`)).json()) as {
    content_json: { components: Array<Record<string, unknown>> };
  };
  const grid = saved.content_json.components.find((c) => c["type"] === "QuestionGrid") as
    | { children: Array<Record<string, unknown>> }
    | undefined;
  expect(grid, "the authored grid persisted").toBeTruthy();
  const kids = grid!.children;
  const trigger = kids.find((k) => k["internal_field"] === TRIGGER_FIELD) as { props: Record<string, unknown> };
  const dependent = kids.find((k) => k["internal_field"] === DEPENDENT_FIELD) as {
    props: Record<string, unknown>;
    conditional?: unknown;
  };
  expect(trigger.props["label"]).toBe(TYPED_LABEL);
  expect(dependent.props["defaultValue"]).toBe(defaultChoiceValue);
  expect(dependent.conditional).toEqual({ when: TRIGGER_FIELD, op: "eq", value: true });
  console.log(
    `SMOKE-AUTHORED trigger.label="${String(trigger.props["label"])}" dependent.defaultValue="${String(dependent.props["defaultValue"])}"`,
  );

  // wire both grid fields into the Offer payload so the provider log can prove
  // presence/absence (the fixture only mapped the carrier field)
  const offerRes = (await (await ctx.get("/api/admin/leadgen/offers?activity=r2fix_activity")).json()) as {
    items: Array<{ id: number; offer_name: string }>;
  };
  const offerId = offerRes.items.find((o) => o.offer_name === "R2Fix Fixture Offer")!.id;
  const patch = await ctx.patch(`/api/admin/leadgen/sections/${SECTION.public_id}`, {
    data: {
      selected_offers: [offerId],
      answer_maps: [
        {
          question_id: "r2fix_q_carrier",
          offer_id: offerId,
          offer_payload_field_path: "lead.r2fix_carrier",
          provider_expected_type: "string",
          required_for_offer: true,
          internal_field: "r2fix_carrier",
          answer_type: "enum",
        },
        {
          question_id: String(trigger["question_id"]),
          offer_id: offerId,
          offer_payload_field_path: `lead.${TRIGGER_FIELD}`,
          provider_expected_type: "boolean",
          internal_field: TRIGGER_FIELD,
          answer_type: "boolean",
        },
        {
          question_id: String(dependent["question_id"]),
          offer_id: offerId,
          offer_payload_field_path: `lead.${DEPENDENT_FIELD}`,
          provider_expected_type: "string",
          internal_field: DEPENDENT_FIELD,
          answer_type: "enum",
        },
      ],
    },
  });
  expect(patch.status(), await patch.text()).toBe(200);
  await ctx.dispose();
});

// ---------------------------------------------------------------------------
// the visitor drive
// ---------------------------------------------------------------------------

interface AuctionPost {
  answers: Record<string, unknown>;
}
function captureAuction(page: Page): AuctionPost[] {
  const posts: AuctionPost[] = [];
  page.on("request", (req) => {
    if (req.method() !== "POST" || !req.url().includes("/lg/auction")) return;
    const body = req.postData();
    if (body === null) return;
    try {
      posts.push(JSON.parse(body) as AuctionPost);
    } catch {
      /* non-JSON body is not ours */
    }
  });
  return posts;
}

async function openFunnel(page: Page): Promise<void> {
  // cache-bust the shell: the authoring above bumped content_version + the
  // section's answer-mapping version, and a cached shell would bake a stale
  // #lg-config whose hash no longer matches the freshly minted attempt token
  // (RED LINE 2 tampered/422) — a harness artifact, not a product defect.
  await page.goto(`http://${SITE_HOST}:${PW_PORT}/lg/${FUNNEL_SLUG}?_cb=${Date.now()}`, {
    waitUntil: "domcontentloaded",
  });
  // the shell renders every section (only the current one visible), so advance
  // through the shared pass-through page(s) until the question screen SHOWS.
  for (let i = 0; i < 4; i += 1) {
    if (await page.getByText(TYPED_LABEL).first().isVisible()) break;
    await page.locator("[data-lg-continue]:visible").first().click();
    await page.waitForTimeout(700);
  }
  await expect(page.getByText(TYPED_LABEL).first()).toBeVisible();
}

test("B2 + B3 drive — YES shows the default and Continue is allowed UNTOUCHED; NO makes the question not exist", async ({
  page,
}) => {
  const posts = captureAuction(page);

  // ---- YES: the dependent question pops in WITH its authored default -------
  await openFunnel(page);
  await page.locator('[data-lg-choice="true"]').first().click();
  const dropdown = page.locator("select[data-lg-input]").first();
  await expect(dropdown).toBeVisible();
  const shown = await dropdown.inputValue();
  console.log(`SMOKE-B2 popped-in dropdown value (untouched) = "${shown}"`);
  expect(shown, "the authored default is preselected — the visitor never touched it").toBe(defaultChoiceValue);
  await page.screenshot({ path: `${SHOT_DIR}/b2-yes-default-shown.png` });
  // answer the OTHER required question (the fixture's carrier buttons), then
  // Continue WITHOUT touching the dropdown
  await page.locator('[data-lg-choice="acme_insurance"]').first().click();
  await page.locator("[data-lg-continue]:visible").first().click();
  await expect(page.getByText(TYPED_LABEL).first()).toBeHidden({ timeout: 10_000 });
  await page.screenshot({ path: `${SHOT_DIR}/b2-continue-allowed.png` });
  await page.waitForTimeout(1500);

  // ---- NO: the dependent question does not exist --------------------------
  const page2 = await page.context().newPage();
  const posts2 = captureAuction(page2);
  await openFunnel(page2);
  await page2.locator('[data-lg-choice="false"]').first().click();
  await expect(page2.getByText(INSURER_LABEL)).toBeHidden();
  await page2.screenshot({ path: `${SHOT_DIR}/b3-no-hidden.png` });
  await page2.locator('[data-lg-choice="acme_insurance"]').first().click();
  await page2.locator("[data-lg-continue]:visible").first().click();
  await page2.waitForTimeout(2500);

  const yesPost = posts.find((p) => p.answers !== undefined);
  const noPost = posts2.find((p) => p.answers !== undefined);
  console.log(`SMOKE-YES /lg/auction answers = ${JSON.stringify(yesPost?.answers ?? null)}`);
  console.log(`SMOKE-NO  /lg/auction answers = ${JSON.stringify(noPost?.answers ?? null)}`);
  expect(yesPost, "the YES drive posted an auction").toBeTruthy();
  expect(noPost, "the NO drive posted an auction").toBeTruthy();
  expect(String(JSON.stringify(yesPost!.answers))).toContain(DEPENDENT_FIELD);
  expect(
    Object.prototype.hasOwnProperty.call(noPost!.answers, DEPENDENT_FIELD),
    "the client omits the hidden question — and the server may not add it back",
  ).toBe(false);
});
