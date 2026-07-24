// LEADGEN-REWORK-03 — P6 acceptance (slice S6.1b): the §11 terminal journeys for
// #1 (grid-free palette + geometry + migration render), #2A (answer provenance),
// #2B (Image2 rebuild), #2C (live dependency), #3 (probes across answer types),
// #4 (✓-in-selected per theme AND per question). Real system only: real admin
// CRUD through the live admin API, real composed /lg shells, real gestures + real
// /lg/track beacons + the real /lg/auction endpoint with the mock provider
// (:8788) as the downstream sink — never injected content, never a unit shortcut.
// Each test is named with its §11 AC id.
//
// CROSS-ENGINE (registered in playwright.config.ts CROSS_ENGINE_GESTURE_SPECS by
// this slice): the studio / matrix authoring assertions drive the admin UI only
// (plain click/fill/select + canvas-srcdoc gestures — the U13 delivery fix makes
// them run on chromium AND firefox). Each dynamic {uniq}.e2e.test live /lg leg is
// guarded by S6.1a's liveLegChromiumOnly() (firefox records a documented skip;
// the both-engine assertions before it run on both). Same shape as
// leadgen-operator-acceptance / leadgen-rework-acceptance-builder.
//
// Run per-file (worktree-isolated, fresh D1, this worktree's port):
//   cd api && npm run db:reset:local
//   PW_PORT=8901 npx playwright test test-ui/leadgen-rework-acceptance-components.gesture.spec.ts --workers=1
// (append --project=chromium or --project=firefox to run one engine.)

import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { realClick } from "./utils/real-input";
import {
  LG_API,
  ORIGIN,
  REAL_CHROME_UA,
  json,
  createSection,
  ready,
  passSharedPage,
  liveLegChromiumOnly,
  uniqueTag,
} from "./leadgen-rework-acceptance-helpers";
import {
  installTrackCapture,
  ofType,
  resetMockProvider,
  readMockPayloads,
  flattenPaths,
  frameOf,
  canvasRender,
  openStudioEdit,
  openInspectorTab,
  palette,
  fetchSection,
  sectionAt,
  seedSimpleFunnel,
  seedAuctionFunnel,
  shellUrlFor,
  captureResponsive,
  type AuctionSchemaChild,
} from "./leadgen-rework-acceptance-helpers-b";

test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
  viewport: { width: 1280, height: 900 },
});

const PORT = new URL(ORIGIN).port;

let apiCtx: APIRequestContext;
test.beforeAll(async () => {
  apiCtx = await playwrightRequest.newContext({ baseURL: ORIGIN });
});
test.afterAll(async () => {
  await apiCtx.dispose();
});

// A ButtonAnswerGroup with 2 choices (+ optional default / selected_marker).
function buttons(qid: string, field: string, extra: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  return {
    type: "ButtonAnswerGroup",
    question_id: qid,
    internal_field: field,
    answer_type: "enum",
    props: { label: field, ...props },
    choices: [
      { label: "Alpha", value: "alpha", analytics_id: `${field}_alpha` },
      { label: "Beta", value: "beta", analytics_id: `${field}_beta` },
    ],
    ...extra,
  };
}

// ===========================================================================
// #1 — grid-free palette + geometry + migration render (contract §2 #1 / §6.1 /
// §4.1 / M6). Deeper sibling gates: test/leadgen-rework-matrix.test.ts (the
// §6.2 control matrix — each type shows EXACTLY its controls) and
// leadgen-rework-p2-studio.gesture.spec.ts (a: ghost geometry; d: §4.1 starter).
// The migration invariants (field-universe / answer-map / ids) are the terminal
// data record test/leadgen-rework-acceptance-migrations.test.ts; the row-label→
// props.label mapping is test/leadgen-rework-content-migrations.test.ts M6 (a).
// ===========================================================================
test.describe("#1 — grid-free palette, add-affordance geometry, migration render", () => {
  test("#1 the palette has NO one-unit grid / other-group tile; the 'Questions on one screen' starter inserts N INDEPENDENT components, each individually inspectable (no shared row controls)", async ({ page }) => {
    const s = await createSection(apiCtx, `ACC6B 1palette ${uniqueTag("p")}`, [
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await openStudioEdit(page, s.public_id);

    // The removed §10 types have NO palette tile (a multi-question screen is N
    // independent components, never a one-unit grid).
    await expect(palette(page, "MultiQuestionGrid"), "no MultiQuestionGrid tile").toHaveCount(0);
    await expect(palette(page, "OtherGroupSelector"), "no OtherGroupSelector tile").toHaveCount(0);

    // The §4.1 starter is the ONLY multi-question affordance — one click inserts
    // 2 INDEPENDENT TwoButtonYesNo (cite p2-studio (d) for the persisted fields).
    const starter = page.locator('[data-add-starter="questions_one_screen"]');
    await expect(starter, "the starter tile is offered").toBeVisible();
    await expect(starter).toContainText("Questions on one screen");
    await realClick(starter);
    await page.waitForTimeout(500); // afterModelChange re-render debounce
    const yesNo = canvasRender(page).locator('[data-component-type="TwoButtonYesNo"]');
    await expect(yesNo, "2 independent components, not a grid unit").toHaveCount(2);
    await expect(canvasRender(page)).toContainText("Question 1");
    await expect(canvasRender(page)).toContainText("Question 2");

    // Each inserted component is INDIVIDUALLY selectable with its OWN label+helper
    // inspector control — there is no shared grid Helper/Answer-format/Sub-questions
    // block (the §6.2 matrix proves this per type; here it is proven live that the
    // two questions do not share one inspector).
    await yesNo.nth(0).click();
    await openInspectorTab(page, "content");
    await expect(page.locator("[data-field-label-wrap]"), "component 1 has its OWN label+helper control").toBeVisible();
    await yesNo.nth(1).click();
    await openInspectorTab(page, "content");
    await expect(page.locator("[data-field-label-wrap]"), "component 2 has its OWN label+helper control").toBeVisible();
  });

  test("#1 the '+ Add choice' affordance is a DOM sibling AFTER the component root (outside the box), and adding a choice never changes the component's own width (cite p2-studio (a))", async ({ page }) => {
    const s = await createSection(apiCtx, `ACC6B 1geom ${uniqueTag("g")}`, [
      buttons("q_pick", "geom_pick"),
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await openStudioEdit(page, s.public_id);

    const root = canvasRender(page).locator('[data-question-id="q_pick"]');
    await expect(root).toBeVisible();
    await expect(canvasRender(page).locator('[data-choice-ghost="q_pick"]'), "the + Add choice ghost renders").toHaveCount(1);

    // DOM relation: the ghost is NEVER a descendant of root (never a grid cell /
    // inside the border, §6.1) and comes AFTER it in document order.
    const relation = await page.evaluate(() => {
      const doc = (document.getElementById("lg-studio-canvas-frame") as HTMLIFrameElement | null)?.contentDocument;
      const rootEl = doc?.querySelector('[data-question-id="q_pick"]');
      const ghostEl = doc?.querySelector('[data-add-ghost-row="q_pick"]');
      if (!rootEl || !ghostEl) return { isDescendant: true, isAfter: false };
      const pos = rootEl.compareDocumentPosition(ghostEl);
      return { isDescendant: !!(pos & Node.DOCUMENT_POSITION_CONTAINED_BY), isAfter: !!(pos & Node.DOCUMENT_POSITION_FOLLOWING) };
    });
    expect(relation.isDescendant, "ghost is OUTSIDE the component box (not a descendant)").toBe(false);
    expect(relation.isAfter, "ghost comes AFTER root in document order").toBe(true);

    // Width stability across an add (the component's width is governed by its
    // card, not choice count — the ghost being outside the box means clicking it
    // never resizes the component).
    const widthBefore = (await root.boundingBox())!.width;
    await realClick(canvasRender(page).locator('[data-choice-ghost="q_pick"]'));
    await page.waitForTimeout(500);
    const rootAfter = canvasRender(page).locator('[data-question-id="q_pick"]');
    const widthAfter = (await rootAfter.boundingBox())!.width;
    expect(Math.abs(widthAfter - widthBefore), `width stable: before=${widthBefore} after=${widthAfter}`).toBeLessThanOrEqual(2);
  });

  test("#1 migration render: a section shaped like M6's output (independent components each carrying the grid row's label) renders each label as a per-question label, live", async ({ page, browserName }) => {
    // M6 maps each grid row → an independent component with props.label =
    // row.label and question_id = `<nodeQid>::<field>` (the projected id every
    // answer-map/rule already references). The data invariants (field universe /
    // answer-map count / ids preserved) are the terminal record
    // test/leadgen-rework-acceptance-migrations.test.ts; the props.label←row.label
    // mapping is test/leadgen-rework-content-migrations.test.ts M6 (a). This is
    // the RENDER half of §11 #1 ("row labels preserved as rendered per-question
    // labels"): the migrated shape renders each label live.
    const s = await createSection(apiCtx, `ACC6B 1mig ${uniqueTag("m")}`, [
      { type: "ProgressBar", question_id: "mg_progress", props: { mode: "step" } },
      {
        type: "ButtonAnswerGroup",
        question_id: "m6grid::homeowner",
        internal_field: "homeowner",
        answer_type: "enum",
        props: { label: "Homeowner?" },
        choices: [{ label: "Yes", value: "yes", analytics_id: "ho_yes" }, { label: "No", value: "no", analytics_id: "ho_no" }],
      },
      {
        type: "ButtonAnswerGroup",
        question_id: "m6grid::married",
        internal_field: "married",
        answer_type: "enum",
        props: { label: "Marital status" },
        choices: [{ label: "Single", value: "single", analytics_id: "ms_single" }, { label: "Married", value: "married", analytics_id: "ms_married" }],
      },
      { type: "ContinueButton", question_id: "mg_cont", props: { label: "Continue" } },
    ]);

    if (!liveLegChromiumOnly(browserName, "#1 migration-render live /lg shell needs chromium --host-resolver-rules; the migration data invariants are test/leadgen-rework-acceptance-migrations.test.ts.")) return;

    const seed = await seedSimpleFunnel(apiCtx, "1mig", [s.id]);
    await page.goto(shellUrlFor(seed.host, seed.slug), { waitUntil: "load" });
    await ready(page);
    await passSharedPage(page);
    // both migrated row labels render as per-question labels, each above its OWN
    // independent control ("::"-ids flow through the runtime unchanged).
    await expect(sectionAt(page, 1).getByText("Homeowner?")).toBeVisible();
    await expect(sectionAt(page, 1).getByText("Marital status")).toBeVisible();
    await expect(sectionAt(page, 1).locator('[data-lg-question="m6grid::homeowner"]')).toBeVisible();
    await expect(sectionAt(page, 1).locator('[data-lg-question="m6grid::married"]')).toBeVisible();
  });
});

// ===========================================================================
// #2A — answer model provenance (contract §2 #2A / §4.2). Click marks (selected,
// no navigation); Continue advances only when the screen validates; an untouched
// default records default_applied; a changed answer records user_selected. The
// provenance rides the REAL POST /lg/track beacon (E4). Deeper sibling:
// leadgen-live-funnel.spec.ts "default applies … user_confirmed_default …" +
// "Continue blocks … dependency reveals/hides" (the user_selected transition).
// ===========================================================================
test.describe("#2A — click marks, Continue validates, default_applied vs user_selected", () => {
  test("#2A untouched default → default_applied; changed answer → user_selected; click marks w/o navigation; Continue advances only when the screen validates", async ({ page, browserName }) => {
    const provSection = await createSection(
      apiCtx,
      `ACC6B 2a prov ${uniqueTag("2a")}`,
      [
        { type: "ProgressBar", question_id: "p2a_progress", props: { mode: "step" } },
        buttons("q_prov_default", "prov_default", {}, { label: "Kept default", defaultValue: "alpha" }),
        buttons("q_prov_change", "prov_change", {}, { label: "Changed", defaultValue: "alpha" }),
        buttons("q_prov_req", "prov_required", { required: true }, { label: "Required, no default" }),
        { type: "ValidationError", question_id: "p2a_req_err", internal_field: "prov_required" },
        { type: "ContinueButton", question_id: "p2a_cont", props: { label: "Continue" } },
      ],
      { continue_mode: "button" },
    );
    const page2 = await createSection(apiCtx, `ACC6B 2a p2 ${uniqueTag("2a2")}`, [
      { type: "QuestionHeadline", question_id: "p2a2_head", props: { text: "Page two" } },
      { type: "ContinueButton", question_id: "p2a2_cont", props: { label: "Continue" } },
    ]);

    if (!liveLegChromiumOnly(browserName, "#2A provenance rides the live /lg funnel (chromium --host-resolver-rules); the beacon provenance is also proven in leadgen-live-funnel.spec.ts.")) return;

    const seed = await seedSimpleFunnel(apiCtx, "2a", [provSection.id, page2.id]);
    const events = await installTrackCapture(page);
    await page.goto(shellUrlFor(seed.host, seed.slug), { waitUntil: "load" });
    await ready(page);
    await passSharedPage(page);

    const s1 = sectionAt(page, 1);
    await expect(s1).toBeVisible();

    // Both node-authored defaults applied ONCE on entry as default_applied.
    await expect.poll(() => ofType(events, "answer_default_applied").length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    const defaults = ofType(events, "answer_default_applied");
    expect(defaults.some((e) => e["internal_field"] === "prov_default" && e["answer_source"] === "default_applied"), "prov_default recorded default_applied").toBe(true);

    // Click a DIFFERENT value on the defaulted q_prov_change → marks (selected),
    // does NOT navigate (still on section 1), records user_selected.
    const beta = s1.locator('[data-lg-question="q_prov_change"] [data-lg-choice="beta"]');
    await beta.click();
    await expect(beta, "click marks the choice selected").toHaveClass(/lg-selected/);
    await expect(s1, "clicking a choice does not navigate").toBeVisible();
    await expect
      .poll(() => ofType(events, "answer_click").filter((e) => e["internal_field"] === "prov_change" && e["answer_source"] === "user_selected").length, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(1);

    // Continue with the required (no-default) field empty → blocked: no advance +
    // visible inline error (§4.2 "blocks Continue" ≡ no advance + visible error).
    await s1.locator("[data-lg-continue]").click();
    await expect.poll(() => ofType(events, "validation_error").filter((e) => e["internal_field"] === "prov_required").length, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    await expect(s1.locator('[data-lg-error-for="prov_required"]'), "inline error is visible").toBeVisible();
    await expect(s1, "blocked — still on section 1").toBeVisible();
    await expect(sectionAt(page, 2), "did not advance").toBeHidden();

    // Answer the required field → Continue now validates and advances.
    await s1.locator('[data-lg-question="q_prov_req"] [data-lg-choice="alpha"]').click();
    await s1.locator("[data-lg-continue]").click();
    await expect(sectionAt(page, 2), "advanced once the screen validates").toBeVisible();
  });
});

// ===========================================================================
// #2B — Image2 rebuilt 1:1 (contract §2 #2B): Q1 = labeled Yes/No + Q2 = labeled
// "Credit Score" dropdown, each mapped to a DIFFERENT offer field. The mapping is
// proven end-to-end: the real provider payload (mock :8788) carries BOTH fields
// at DISTINCT offer_payload_field_path. Fixture parity: the matrix suite validates
// test/fixtures/leadgen-rework/image2-two-questions.json.
// ===========================================================================
test.describe("#2B — Image2 (Yes/No + Credit Score dropdown → distinct offer fields)", () => {
  const image2Components = [
    { type: "ProgressBar", question_id: "i2_progress", props: { mode: "step" } },
    { type: "TwoButtonYesNo", question_id: "q_homeowner", internal_field: "is_homeowner", answer_type: "boolean", required: true, props: { label: "Are you a homeowner?", yesLabel: "Yes", noLabel: "No" } },
    {
      type: "DropdownQuestion",
      question_id: "q_credit_score",
      internal_field: "credit_score_band",
      answer_type: "enum",
      required: true,
      props: { label: "Credit Score", placeholder: "Select your range" },
      choices: [
        { label: "Excellent (750+)", value: "excellent", analytics_id: "credit_excellent" },
        { label: "Good (700-749)", value: "good", analytics_id: "credit_good" },
      ],
    },
    { type: "ContinueButton", question_id: "q_continue", props: { label: "Continue" } },
  ];

  test("#2B both questions render their per-question labels on the studio canvas with distinct internal fields (both engines)", async ({ page }) => {
    const s = await createSection(apiCtx, `ACC6B 2b studio ${uniqueTag("2bs")}`, image2Components);
    await openStudioEdit(page, s.public_id);
    await expect(canvasRender(page), "Q1 label").toContainText("Are you a homeowner?");
    await expect(canvasRender(page), "Q2 label").toContainText("Credit Score");
    await expect(frameOf(page).locator('[data-component-type="TwoButtonYesNo"]'), "Q1 is a Yes/No").toHaveCount(1);
    await expect(frameOf(page).locator('[data-component-type="DropdownQuestion"]'), "Q2 is a dropdown").toHaveCount(1);
    const detail = await fetchSection(apiCtx, s.public_id);
    const fields = detail.content_json.components.filter((c) => typeof c["internal_field"] === "string").map((c) => c["internal_field"]);
    expect(fields, "the two questions carry distinct internal fields").toEqual(expect.arrayContaining(["is_homeowner", "credit_score_band"]));
    expect(new Set(fields).size, "no field collision").toBe(fields.length);
  });

  test("#2B live: the composed screen renders both labels and the auction payload carries the two answers at DIFFERENT offer field paths", async ({ page, browserName }) => {
    if (!liveLegChromiumOnly(browserName, "#2B live /lg + auction needs chromium --host-resolver-rules; the two-fields-distinct-paths payload build is unit-proven in test/leadgen-answers.test.ts 'multi-field payload'.")) return;
    test.setTimeout(90_000);

    const schema: AuctionSchemaChild[] = [
      { path: "lead.homeowner", name: "homeowner", type: "string", required: true, source: "answer", internal_field: "is_homeowner" },
      { path: "lead.credit_band", name: "credit_band", type: "string", required: true, source: "answer", internal_field: "credit_score_band" },
    ];
    const seed = await seedAuctionFunnel(apiCtx, {
      tag: "2b",
      sections: [
        {
          name: `ACC6B 2b live ${uniqueTag("2bl")}`,
          components: image2Components,
          answerMaps: (offerId) => [
            { question_id: "q_homeowner", offer_id: offerId, offer_payload_field_path: "lead.homeowner", provider_expected_type: "string", required_for_offer: true, internal_field: "is_homeowner", answer_type: "boolean" },
            { question_id: "q_credit_score", offer_id: offerId, offer_payload_field_path: "lead.credit_band", provider_expected_type: "string", required_for_offer: true, internal_field: "credit_score_band", answer_type: "enum" },
          ],
        },
      ],
      schemaChildren: schema,
      sampleAnswers: { is_homeowner: "true", credit_score_band: "good" },
    });

    await resetMockProvider(apiCtx);
    await page.goto(shellUrlFor(seed.host, seed.slug), { waitUntil: "load" });
    await ready(page);
    await passSharedPage(page);

    const s1 = sectionAt(page, 1);
    await expect(s1.getByText("Are you a homeowner?"), "Image2 Q1 label renders live").toBeVisible();
    await expect(s1.getByText("Credit Score"), "Image2 Q2 label renders live").toBeVisible();
    await captureResponsive(page, "2b-image2"); // §11 visual evidence at 1280 + 375

    await s1.locator('[data-lg-question="q_homeowner"] [data-lg-choice="true"]').click();
    // the DropdownQuestion's <select> IS the [data-lg-question] element (hydration()
    // stamps it on the component's own root), not a wrapper containing a <select>.
    await s1.locator('[data-lg-question="q_credit_score"]').selectOption("good");

    const [auctionReq] = await Promise.all([
      page.waitForRequest((r) => r.url().includes("/lg/auction") && r.method() === "POST", { timeout: 20_000 }),
      page.waitForResponse((r) => r.url().includes("/lg/auction"), { timeout: 20_000 }),
      s1.locator("[data-lg-continue]").click(),
    ]);
    const body = auctionReq.postDataJSON() as { answers: Record<string, { value: unknown }> };
    expect(body.answers["is_homeowner"]?.value, "Q1 in the auction projection").toBe("true");
    expect(body.answers["credit_score_band"]?.value, "Q2 in the auction projection").toBe("good");

    // the real provider payload (mock sink) carries BOTH answers at DISTINCT paths.
    await expect
      .poll(async () => (await readMockPayloads(apiCtx)).length, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(1);
    const payloads = await readMockPayloads(apiCtx);
    const flat = flattenPaths(payloads[payloads.length - 1]);
    expect(Object.keys(flat), "distinct offer field paths").toEqual(expect.arrayContaining(["lead.homeowner", "lead.credit_band"]));
    expect(flat["lead.homeowner"], "Q1 mapped value").toBe("true");
    expect(flat["lead.credit_band"], "Q2 mapped value").toBe("good");
  });
});

// ===========================================================================
// #2C — live dependency (contract §2 #2C / §4.2 hiddenAnswerFields; Image3):
// Insured = Yes reveals a required insurer dropdown. hidden ⇒ not required, not
// collected (ABSENT from the auction projection AND the provider payload),
// Continue unblocked; shown+required ⇒ blocks with a visible error; shown+required
// WITH a default ⇒ does not block; flipping back re-hides and unblocks. Proven
// live. Fixture parity: image3-insured-dependency.json (matrix suite).
// ===========================================================================
test.describe("#2C — dependency reveal/hide, auction-projection absence, blocking", () => {
  // TwoButtonYesNo stores the STRING "true"/"false" at runtime, so the
  // conditional value is the string form (the leadgen-fix-p1-seed idiom).
  function insuredInsurerSection(tag: string, opts: { insurerDefault?: string; insuredDefault?: string }) {
    const insurerProps: Record<string, unknown> = { label: "Who is your insurer?", placeholder: "Select your insurer" };
    if (opts.insurerDefault !== undefined) insurerProps["defaultValue"] = opts.insurerDefault;
    const yesNoProps: Record<string, unknown> = { label: "Are you currently insured?", yesLabel: "Yes", noLabel: "No" };
    if (opts.insuredDefault !== undefined) yesNoProps["defaultValue"] = opts.insuredDefault;
    return {
      name: `ACC6B 2c ${tag} ${uniqueTag(tag)}`,
      components: [
        { type: "ProgressBar", question_id: "i3_progress", props: { mode: "step" } },
        { type: "TwoButtonYesNo", question_id: "q_insured", internal_field: "currently_insured", answer_type: "boolean", required: true, props: yesNoProps },
        {
          type: "DropdownQuestion",
          question_id: "q_insurer",
          internal_field: "current_insurer",
          answer_type: "enum",
          required: true,
          props: insurerProps,
          choices: [
            { label: "GEICO", value: "geico", analytics_id: "insurer_geico" },
            { label: "Progressive", value: "progressive", analytics_id: "insurer_progressive" },
          ],
          conditional: { when: "currently_insured", op: "eq", value: "true" },
        },
        { type: "ValidationError", question_id: "i3_ins_err", internal_field: "current_insurer" },
        { type: "ContinueButton", question_id: "q_continue", props: { label: "Continue" } },
      ],
    };
  }
  const insurerSchema: AuctionSchemaChild[] = [
    { path: "lead.currently_insured", name: "currently_insured", type: "string", required: true, source: "answer", internal_field: "currently_insured" },
    { path: "lead.current_insurer", name: "current_insurer", type: "string", source: "answer", internal_field: "current_insurer" },
  ];
  const insuredAnswerMap = (offerId: number) => [
    { question_id: "q_insured", offer_id: offerId, offer_payload_field_path: "lead.currently_insured", provider_expected_type: "string", required_for_offer: true, internal_field: "currently_insured", answer_type: "boolean" },
  ];

  test("#2C hidden ⇒ not collected: Insured = No keeps the insurer hidden, Continue is unblocked, and current_insurer is ABSENT from the auction projection AND the provider payload", async ({ page, browserName }) => {
    if (!liveLegChromiumOnly(browserName, "#2C live dependency + auction needs chromium --host-resolver-rules.")) return;
    test.setTimeout(90_000);
    // No default anywhere — the contract's "not collected" case: a hidden field
    // the visitor never provided is simply absent from the projection/payload.
    const sec = insuredInsurerSection("hidden", {});
    const seed = await seedAuctionFunnel(apiCtx, { tag: "2chid", sections: [{ ...sec, answerMaps: insuredAnswerMap }], schemaChildren: insurerSchema, sampleAnswers: { currently_insured: "false" } });

    await resetMockProvider(apiCtx);
    await page.goto(shellUrlFor(seed.host, seed.slug), { waitUntil: "load" });
    await ready(page);
    await passSharedPage(page);

    const s1 = sectionAt(page, 1);
    await s1.locator('[data-lg-question="q_insured"] [data-lg-choice="false"]').click();
    await expect(s1.locator('[data-lg-question="q_insurer"]'), "insurer hidden when not insured").toBeHidden();

    const [auctionReq] = await Promise.all([
      page.waitForRequest((r) => r.url().includes("/lg/auction") && r.method() === "POST", { timeout: 20_000 }),
      page.waitForResponse((r) => r.url().includes("/lg/auction"), { timeout: 20_000 }),
      s1.locator("[data-lg-continue]").click(), // unblocked — hidden insurer is not required
    ]);
    const body = auctionReq.postDataJSON() as { answers: Record<string, unknown> };
    expect(body.answers["currently_insured"], "the answered field IS in the projection").toBeTruthy();
    expect(body.answers["current_insurer"], "the hidden field is ABSENT from the auction projection").toBeUndefined();

    await expect.poll(async () => (await readMockPayloads(apiCtx)).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
    const flat = flattenPaths((await readMockPayloads(apiCtx)).at(-1));
    expect(flat["lead.currently_insured"], "answered field present in the provider payload").toBeTruthy();
    expect("lead.current_insurer" in flat, "hidden field ABSENT from the provider payload").toBe(false);
  });

  test("#2C shown+required WITH a default ⇒ does not block: Insured defaults Yes, the insurer default satisfies required, Continue advances, and current_insurer is PRESENT in the projection + payload", async ({ page, browserName }) => {
    if (!liveLegChromiumOnly(browserName, "#2C default-satisfies + auction needs chromium --host-resolver-rules.")) return;
    test.setTimeout(90_000);
    // Both defaults applied on ENTRY (insured=true reveals the insurer, whose
    // default geico satisfies required) — no user action needed to advance.
    const sec = insuredInsurerSection("shown", { insuredDefault: "true", insurerDefault: "geico" });
    const seed = await seedAuctionFunnel(apiCtx, { tag: "2cshow", sections: [{ ...sec, answerMaps: insuredAnswerMap }], schemaChildren: insurerSchema, sampleAnswers: { currently_insured: "true", current_insurer: "geico" } });

    await resetMockProvider(apiCtx);
    await page.goto(shellUrlFor(seed.host, seed.slug), { waitUntil: "load" });
    await ready(page);
    await passSharedPage(page);

    const s1 = sectionAt(page, 1);
    await expect(s1.locator('[data-lg-question="q_insurer"]'), "insurer shown when insured (default true)").toBeVisible();

    const [auctionReq] = await Promise.all([
      page.waitForRequest((r) => r.url().includes("/lg/auction") && r.method() === "POST", { timeout: 20_000 }),
      page.waitForResponse((r) => r.url().includes("/lg/auction"), { timeout: 20_000 }),
      s1.locator("[data-lg-continue]").click(), // NOT blocked — the default satisfies required
    ]);
    const body = auctionReq.postDataJSON() as { answers: Record<string, { value: unknown; answer_source: string }> };
    expect(body.answers["current_insurer"]?.value, "shown+defaulted field present in the projection").toBe("geico");
    expect(body.answers["current_insurer"]?.answer_source, "recorded as default_applied").toBe("default_applied");

    await expect.poll(async () => (await readMockPayloads(apiCtx)).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
    const flat = flattenPaths((await readMockPayloads(apiCtx)).at(-1));
    expect(flat["lead.current_insurer"], "shown+defaulted field present in the provider payload").toBe("geico");
  });

  test("#2C shown+required (no default) ⇒ BLOCKS with a visible error; flipping Insured back to No re-hides the insurer and unblocks Continue", async ({ page, browserName }) => {
    if (!liveLegChromiumOnly(browserName, "#2C blocking/re-hide needs the live /lg funnel (chromium --host-resolver-rules).")) return;
    const sec = insuredInsurerSection("block", {}); // no defaults anywhere
    const page2 = await createSection(apiCtx, `ACC6B 2c p2 ${uniqueTag("2cp2")}`, [
      { type: "QuestionHeadline", question_id: "i3p2_head", props: { text: "Page two" } },
      { type: "ContinueButton", question_id: "i3p2_cont", props: { label: "Continue" } },
    ]);
    const secCreated = await createSection(apiCtx, sec.name, sec.components);
    const seed = await seedSimpleFunnel(apiCtx, "2cblk", [secCreated.id, page2.id]);

    await page.goto(shellUrlFor(seed.host, seed.slug), { waitUntil: "load" });
    await ready(page);
    await passSharedPage(page);

    const s1 = sectionAt(page, 1);
    // Insured = Yes reveals the required insurer; empty → Continue BLOCKS + error.
    await s1.locator('[data-lg-question="q_insured"] [data-lg-choice="true"]').click();
    await expect(s1.locator('[data-lg-question="q_insurer"]'), "insurer revealed").toBeVisible();
    await s1.locator("[data-lg-continue]").click();
    await expect(s1.locator('[data-lg-error-for="current_insurer"]'), "visible inline error").toBeVisible();
    await expect(s1, "blocked — no advance").toBeVisible();
    await expect(sectionAt(page, 2)).toBeHidden();

    // Flip Insured → No: the insurer re-hides and Continue is unblocked.
    await s1.locator('[data-lg-question="q_insured"] [data-lg-choice="false"]').click();
    await expect(s1.locator('[data-lg-question="q_insurer"]'), "insurer re-hidden").toBeHidden();
    await s1.locator("[data-lg-continue]").click();
    await expect(sectionAt(page, 2), "unblocked once the dependency is hidden again").toBeVisible();
  });
});

// ===========================================================================
// #3 — the SAME probes pass on Buttons, Cards, Dropdown, Yes/No, and a mixed
// screen (contract §2 #3). The §6.2 matrix (each type shows EXACTLY its controls)
// is the executable test test/leadgen-rework-matrix.test.ts. Here the answer
// BEHAVIOUR (mark on click + Continue validates + records) is proven across all
// four answer families on one mixed screen, live.
// ===========================================================================
test.describe("#3 — mark/validate/record across Buttons, Cards, Dropdown, Yes/No (mixed screen)", () => {
  const mixed = [
    { type: "ProgressBar", question_id: "m3_progress", props: { mode: "step" } },
    { type: "ButtonAnswerGroup", question_id: "q_btn", internal_field: "m3_buttons", answer_type: "enum", required: true, props: { label: "Buttons" }, choices: [{ label: "B1", value: "b1", analytics_id: "b1" }, { label: "B2", value: "b2", analytics_id: "b2" }] },
    { type: "IconCardAnswerGrid", question_id: "q_card", internal_field: "m3_cards", answer_type: "enum", required: true, props: { label: "Cards" }, choices: [{ label: "C1", value: "c1", icon: "user", analytics_id: "c1" }, { label: "C2", value: "c2", icon: "briefcase", analytics_id: "c2" }] },
    { type: "DropdownQuestion", question_id: "q_drop", internal_field: "m3_dropdown", answer_type: "enum", required: true, props: { label: "Dropdown", placeholder: "Pick" }, choices: [{ label: "D1", value: "d1", analytics_id: "d1" }, { label: "D2", value: "d2", analytics_id: "d2" }] },
    { type: "TwoButtonYesNo", question_id: "q_yn", internal_field: "m3_yesno", answer_type: "boolean", required: true, props: { label: "Yes/No", yesLabel: "Yes", noLabel: "No" } },
    { type: "ValidationError", question_id: "m3_yn_err", internal_field: "m3_yesno" },
    { type: "ContinueButton", question_id: "m3_cont", props: { label: "Continue" } },
  ];

  test("#3 all four answer types are authorable and render as independent components on the studio canvas (both engines)", async ({ page }) => {
    const s = await createSection(apiCtx, `ACC6B 3studio ${uniqueTag("3s")}`, mixed);
    await openStudioEdit(page, s.public_id);
    for (const t of ["ButtonAnswerGroup", "IconCardAnswerGrid", "DropdownQuestion", "TwoButtonYesNo"]) {
      await expect(frameOf(page).locator(`[data-component-type="${t}"]`), `${t} renders on canvas`).toHaveCount(1);
    }
  });

  test("#3 live mixed screen: each type marks on click, Continue blocks until ALL validate, then advances (cite the §6.2 matrix test for per-type controls)", async ({ page, browserName }) => {
    if (!liveLegChromiumOnly(browserName, "#3 mixed-screen probes ride the live /lg funnel (chromium --host-resolver-rules).")) return;
    const s = await createSection(apiCtx, `ACC6B 3live ${uniqueTag("3l")}`, mixed, { continue_mode: "button" });
    const page2 = await createSection(apiCtx, `ACC6B 3 p2 ${uniqueTag("3p2")}`, [{ type: "ContinueButton", question_id: "m3p2_cont", props: { label: "Continue" } }]);
    const seed = await seedSimpleFunnel(apiCtx, "3mix", [s.id, page2.id]);

    await page.goto(shellUrlFor(seed.host, seed.slug), { waitUntil: "load" });
    await ready(page);
    await passSharedPage(page);
    const s1 = sectionAt(page, 1);

    // Continue with nothing answered → blocked (no advance).
    await s1.locator("[data-lg-continue]").click();
    await expect(sectionAt(page, 2), "blocked — required fields empty").toBeHidden();

    // Buttons — mark on click.
    const btn = s1.locator('[data-lg-question="q_btn"] [data-lg-choice="b1"]');
    await btn.click();
    await expect(btn, "buttons mark selected").toHaveClass(/lg-selected/);
    // Cards — mark on click.
    const card = s1.locator('[data-lg-question="q_card"] [data-lg-choice="c1"]');
    await card.click();
    await expect(card, "cards mark selected").toHaveClass(/lg-selected/);
    // Dropdown — records the selection (the <select> IS the [data-lg-question] node).
    await s1.locator('[data-lg-question="q_drop"]').selectOption("d1");
    // Yes/No — mark on click.
    const yes = s1.locator('[data-lg-question="q_yn"] [data-lg-choice="true"]');
    await yes.click();
    await expect(yes, "yes/no marks selected").toHaveClass(/lg-selected/);

    // All four validate → Continue advances.
    await s1.locator("[data-lg-continue]").click();
    await expect(sectionAt(page, 2), "advances once all four types validate").toBeVisible();
  });
});

// ===========================================================================
// #4 — ✓-in-selected, selectable per THEME and per QUESTION (contract §2 #4 /
// §6.6; Image4). Per-theme live re-render is the terminal record S6.1a #11E
// (leadgen-rework-acceptance-builder) + leadgen-rework-p4-themes + test/
// leadgen-rework-render.test.ts. This slice proves the per-QUESTION override on
// BOTH buttons and cards (props.selected_marker overrides the theme's axis).
// ===========================================================================
test.describe("#4 — ✓-in-selected per question (buttons + cards)", () => {
  test("#4 the selected-marker control is offered for a choice group and NOT for a dropdown (per-question selectability; cite the §6.2 matrix test)", async ({ page }) => {
    const s = await createSection(apiCtx, `ACC6B 4studio ${uniqueTag("4s")}`, [
      buttons("q_marker_btn", "marker_btn"),
      { type: "DropdownQuestion", question_id: "q_marker_drop", internal_field: "marker_drop", answer_type: "enum", props: { label: "Drop", placeholder: "Pick" }, choices: [{ label: "One", value: "one", analytics_id: "one" }] },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await openStudioEdit(page, s.public_id);
    // The one selected-marker control (§6.6) is REVEALED per the §6.2 capability:
    // the island toggles its `hidden` attribute on selection (cap selected_marker).
    // Assert the attribute state (tab-independent), selecting distinct nodes.
    await canvasRender(page).locator('[data-component-type="DropdownQuestion"]').click();
    await expect(page.locator("[data-selected-marker-wrap][hidden]"), "a dropdown has NO ✓-in-selected control (matrix: selected_marker=false)").toHaveCount(1);
    await canvasRender(page).locator('[data-component-type="ButtonAnswerGroup"]').click();
    await expect(page.locator("[data-selected-marker-wrap]:not([hidden])"), "buttons offer the ✓-in-selected control (§6.6)").toHaveCount(1);
  });

  test("#4 live: a per-question 'mark' override renders the ✓ (hollow rest + filled badge) on a ButtonAnswerGroup AND an IconCardAnswerGrid, while a sibling 'wash' question shows no check glyph", async ({ page, browserName }) => {
    const s = await createSection(apiCtx, `ACC6B 4live ${uniqueTag("4l")}`, [
      { type: "ButtonAnswerGroup", question_id: "q_mark_btn", internal_field: "mark_btn", answer_type: "enum", props: { label: "Mark buttons", selected_marker: "mark" }, choices: [{ label: "M1", value: "m1", analytics_id: "m1" }, { label: "M2", value: "m2", analytics_id: "m2" }] },
      { type: "ButtonAnswerGroup", question_id: "q_wash_btn", internal_field: "wash_btn", answer_type: "enum", props: { label: "Wash buttons", selected_marker: "wash" }, choices: [{ label: "W1", value: "w1", analytics_id: "w1" }, { label: "W2", value: "w2", analytics_id: "w2" }] },
      { type: "IconCardAnswerGrid", question_id: "q_mark_card", internal_field: "mark_card", answer_type: "enum", props: { label: "Mark cards", selected_marker: "mark" }, choices: [{ label: "K1", value: "k1", icon: "user", analytics_id: "k1" }, { label: "K2", value: "k2", icon: "briefcase", analytics_id: "k2" }] },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);

    if (!liveLegChromiumOnly(browserName, "#4 per-question marker rides the live /lg funnel (chromium --host-resolver-rules); the per-theme axis is S6.1a #11E + test/leadgen-rework-render.test.ts.")) return;

    const seed = await seedSimpleFunnel(apiCtx, "4mark", [s.id]);
    await page.goto(shellUrlFor(seed.host, seed.slug), { waitUntil: "load" });
    await ready(page);
    await passSharedPage(page);
    const s1 = sectionAt(page, 1);

    // A per-node 'mark' emits the ✓ markup (hollow rest + badge) on every choice;
    // a 'wash' sibling emits NONE (selectedMarkerMarkup returns "" for wash) —
    // the per-QUESTION override, distinct on the SAME live screen.
    // Buttons render the §6.6 selectedMarkerMarkup (.lg-check-hollow rest +
    // .lg-check-badge); cards render their own markCheck (.lg-card-check ✓).
    // A per-node 'mark' emits it on every choice; a 'wash' sibling emits NONE.
    expect(await s1.locator('[data-lg-question="q_mark_btn"] .lg-check-hollow').count(), "mark buttons carry the ✓ markup").toBeGreaterThan(0);
    expect(await s1.locator('[data-lg-question="q_wash_btn"] .lg-check-hollow').count(), "wash buttons carry NO check glyph").toBe(0);
    expect(await s1.locator('[data-lg-question="q_mark_card"] .lg-card-check').count(), "mark cards carry the ✓ markup").toBeGreaterThan(0);

    // Selecting a choice reveals the ✓ on the selected pill — on buttons AND cards.
    await s1.locator('[data-lg-question="q_mark_btn"] [data-lg-choice="m1"]').click();
    await expect(s1.locator('[data-lg-question="q_mark_btn"] [data-lg-choice="m1"] .lg-check-badge'), "selected button shows the filled ✓").toBeVisible();
    await s1.locator('[data-lg-question="q_mark_card"] [data-lg-choice="k1"]').click();
    await expect(s1.locator('[data-lg-question="q_mark_card"] [data-lg-choice="k1"] .lg-card-check'), "selected card shows the ✓").toBeVisible();
    // the wash sibling never carries a badge, even after its own selection.
    await s1.locator('[data-lg-question="q_wash_btn"] [data-lg-choice="w1"]').click();
    expect(await s1.locator('[data-lg-question="q_wash_btn"] .lg-check-badge').count(), "wash node shows no ✓ badge").toBe(0);
    await captureResponsive(page, "4-marker"); // §11 visual evidence at 1280 + 375 (Image4)
  });
});
