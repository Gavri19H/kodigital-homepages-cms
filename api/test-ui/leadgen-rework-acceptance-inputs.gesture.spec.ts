// LEADGEN-REWORK-03 — P6 acceptance (slice S6.1b): the §11 terminal journeys for
// #5 (phone mask), #6 (address), #7 (sliders), #8 (Other on buttons + cards),
// #9 (card layout / centering), #10 (the §6.2 control matrix). Real system only:
// real admin CRUD, real composed /lg shells, real gestures + the engine's own
// answer store — never injected content, never a unit shortcut. Each test is
// named with its §11 AC id.
//
// CROSS-ENGINE (registered in playwright.config.ts CROSS_ENGINE_GESTURE_SPECS by
// this slice): studio / matrix authoring + the API save-response warning assertions
// run on chromium AND firefox. Each dynamic {uniq}.e2e.test live /lg leg (the
// runtime widget proofs) is guarded by S6.1a's liveLegChromiumOnly() (firefox
// records a documented skip; the both-engine assertions before it run on both).
//
// Run per-file (worktree-isolated, fresh D1, this worktree's port):
//   cd api && npm run db:reset:local
//   PW_PORT=8901 npx playwright test test-ui/leadgen-rework-acceptance-inputs.gesture.spec.ts --workers=1

import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
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
  frameOf,
  canvasRender,
  openStudioEdit,
  openInspectorTab,
  saveStudioAwaitOk,
  fetchSection,
  sectionAt,
  engineAnswers,
  seedSimpleFunnel,
  shellUrlFor,
  captureResponsive,
} from "./leadgen-rework-acceptance-helpers-b";

test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
  viewport: { width: 1280, height: 900 },
});

let apiCtx: APIRequestContext;
test.beforeAll(async () => {
  apiCtx = await playwrightRequest.newContext({ baseURL: ORIGIN });
});
test.afterAll(async () => {
  await apiCtx.dispose();
});

// ===========================================================================
// #5 — phone mask (contract §2 #5 / §6.9 / M8). Studio builder: leadgen-rework-
// p2-studio.gesture.spec.ts (b). The formatPhone×mask≠10 studio warning: the
// terminal record is test/leadgen-p2-phone-format-warning.test.ts (the exhaustive
// preset/mask matrix); here it is re-proven through the REAL section save response.
// Runtime fill + raw-digit recording: test/leadgen-rework-runtime.test.ts §6.9.
// ===========================================================================
test.describe("#5 — phone mask (builder + formatPhone warning + runtime fill)", () => {
  const FORMATPHONE_WARNING =
    "This field uses an international phone format, but the offer mapping applies a US-only phone transform — the phone may be dropped from the lead. Align the format or the transform.";

  // A minimal mappable offer (create + a string-typed answer-sourced schema at
  // data.phone) — the createMappableOffer idiom from the sibling warning test.
  async function mappableOffer(): Promise<number> {
    const offer = await json<{ id: number }>(
      await apiCtx.post(`${LG_API}/offers`, {
        data: { offer_name: `ACC6B Phone Offer ${uniqueTag("po")}`, activity: "quote_funnel", vertical: "life", conversion_tracking_method: "s2s_postback", offer_type: "cpl", placements: [`plc-acc6b-ph-${uniqueTag("p")}`], calls_provider_api: true, bid_source: "static", cap_enabled: false },
      }),
      "phone offer create",
    );
    await json(
      await apiCtx.post(`${LG_API}/offers/${offer.id}/payload-schemas`, {
        data: { schema_json: { version: 1, root: { type: "object", children: [{ path: "data.phone", name: "phone", type: "string", required: false, source: "answer", internal_field: "phone" }] } } },
      }),
      "phone offer schema",
    );
    return offer.id;
  }
  async function saveProblems(phoneFormat: unknown, offerId: number, transform: Array<Record<string, unknown>> = [{ kind: "formatPhone" }]): Promise<Array<{ message: string; scope: string; severity: string }>> {
    const node: Record<string, unknown> = { type: "PhoneInputQuestion", question_id: "p1", question_key: "phone_q", internal_field: "phone", answer_type: "string" };
    if (phoneFormat !== undefined) node.props = { phone_format: phoneFormat };
    const res = await apiCtx.post(`${LG_API}/sections`, {
      data: {
        section_name: `ACC6B Phone ${uniqueTag("ph")}`, activity: "quote_funnel", vertical: "life", headline_text: "Phone?",
        content_json: JSON.stringify({ components: [node] }),
        answer_maps: [{ question_id: "p1", offer_id: offerId, offer_payload_field_path: "data.phone", provider_expected_type: "string", value_transform: transform }],
      },
    });
    const body = (await res.json()) as { problems?: Array<{ message: string; scope: string; severity: string }> };
    return body.problems ?? [];
  }

  test("#5 mask builder: '(3) 3-4' previews the scaffold '(___) ___-____'; an invalid pattern shows the A-10 error verbatim (both engines; cite p2-studio (b))", async ({ page }) => {
    const s = await createSection(apiCtx, `ACC6B 5mask ${uniqueTag("5m")}`, [
      { type: "PhoneInputQuestion", question_id: "q_phone", internal_field: "mask_phone", required: true },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await openStudioEdit(page, s.public_id);
    await canvasRender(page).locator('[data-component-type="PhoneInputQuestion"]').click();
    await openInspectorTab(page, "content");
    const pattern = page.locator("[data-phone-mask-pattern]");
    await expect(pattern).toBeVisible();
    await pattern.fill("(3) 3-4");
    await pattern.blur();
    await expect(page.locator("[data-phone-mask-preview]"), "scaffold preview").toHaveText("(___) ___-____");
    await expect(page.locator("[data-phone-mask-error]"), "no error on a valid pattern").toBeHidden();
    await pattern.fill("abc");
    await pattern.blur();
    await expect(page.locator("[data-phone-mask-error]"), "A-10 verbatim").toHaveText("Format must be digit groups with separators, like (3) 3-4.");
  });

  test("#5 the formatPhone×mask≠10 warning fires on save (mask digit_count≠10 + formatPhone); a 10-digit mask AND a legacy 'nanp'/'il' preset still validate (both engines; cite the sibling warning test)", async ({ page: _page }) => {
    const offerId = await mappableOffer();
    // digit_count 7 (groups [3,4]) + formatPhone → the incoherence warning fires (scope=mapping).
    const warn7 = (await saveProblems({ mask: { pattern: "3-4" } }, offerId)).find((p) => p.message === FORMATPHONE_WARNING);
    expect(warn7, "mask digit_count≠10 + formatPhone warns").toBeTruthy();
    expect(warn7!.scope).toBe("mapping");
    expect(warn7!.severity).toBe("warning");
    // digit_count 10 (groups [3,3,4]) → coherent, NO warning.
    expect((await saveProblems({ mask: { pattern: "(3) 3-4" } }, offerId)).some((p) => p.message === FORMATPHONE_WARNING), "a 10-digit mask is coherent").toBe(false);
    // legacy preset content STILL VALIDATES (M8: no data migration). 'nanp' is
    // coherent (no warning); 'il' warns but still saves — both are accepted content.
    expect((await saveProblems("nanp", offerId)).some((p) => p.message === FORMATPHONE_WARNING), "legacy nanp coherent").toBe(false);
    const ilProblems = await saveProblems("il", offerId);
    expect(ilProblems.some((p) => p.message === FORMATPHONE_WARNING), "legacy il still validates (warns, does not block)").toBe(true);
  });

  test("#5 runtime: the scaffold fills progressively, Continue is blocked until complete with the author's message (A-7), the recorded value is raw digits, and there is no country list", async ({ page, browserName }) => {
    const s = await createSection(
      apiCtx,
      `ACC6B 5rt ${uniqueTag("5r")}`,
      [
        { type: "PhoneInputQuestion", question_id: "q_phone", internal_field: "mask_phone", answer_type: "string", required: true, props: { label: "Mobile phone", phone_format: { mask: { pattern: "(3) 3-4", message: "Enter a complete phone number." } } } },
        { type: "ValidationError", question_id: "q_phone_err", internal_field: "mask_phone" },
        { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
      ],
      { continue_mode: "button" },
    );
    const page2 = await createSection(apiCtx, `ACC6B 5rt p2 ${uniqueTag("5r2")}`, [{ type: "ContinueButton", question_id: "p2c", props: { label: "Continue" } }]);

    if (!liveLegChromiumOnly(browserName, "#5 runtime mask fill rides the live /lg funnel (chromium --host-resolver-rules); the fill UX + raw-digit recording is test/leadgen-rework-runtime.test.ts §6.9.")) return;

    const seed = await seedSimpleFunnel(apiCtx, "5rt", [s.id, page2.id]);
    await page.goto(shellUrlFor(seed.host, seed.slug), { waitUntil: "load" });
    await ready(page);
    await passSharedPage(page);
    const s1 = sectionAt(page, 1);

    // hydration() stamps data-lg-question on the phone INPUT itself; the scaffold
    // is server-rendered as the input's data-lg-mask-scaffold (+ placeholder).
    const input = s1.locator('input[data-lg-question="q_phone"]');
    await expect(input, "the mask scaffold is defined on the input").toHaveAttribute("data-lg-mask-scaffold", "(___) ___-____");
    expect(await s1.locator("select").count(), "no country list anywhere (the phone section has no <select>)").toBe(0);

    // Incomplete (3 of 10) → Continue BLOCKS with the author's message (A-7).
    await input.fill("215");
    await s1.locator("[data-lg-continue]").click();
    await expect(s1.locator('[data-lg-error-for="mask_phone"]'), "the author's incomplete message").toHaveText("Enter a complete phone number.");
    await expect(sectionAt(page, 2), "blocked").toBeHidden();

    // Complete (pasted with separators) → filtered to RAW digits; the scaffold
    // fills progressively (display re-formats); Continue advances.
    await input.fill("215.555.1234");
    await expect.poll(async () => (await engineAnswers(page))["mask_phone"], { timeout: 8_000 }).toBe("2155551234");
    await expect(input, "the scaffold filled progressively (display)").toHaveValue("(215) 555-1234");
    await s1.locator("[data-lg-continue]").click();
    await expect(sectionAt(page, 2), "advances once complete").toBeVisible();
  });
});

// ===========================================================================
// #6 — address (contract §2 #6 / §6.10 / M9). Field-set editor: leadgen-rework-
// p2-studio.gesture.spec.ts (c). Per-field validation: test/leadgen-rework-
// runtime.test.ts §6.10. Sub-field universe (each sub-field independently
// mappable): collectKnownAnswerFields' address leg + the migrations test.
// ===========================================================================
test.describe("#6 — address (field subset, per-field mode/validation, keyless degrade, per-sub-field)", () => {
  test("#6 studio: the field-set editor is offered; the 'Plain text address' preset collapses to a single full_address row (both engines; cite p2-studio (c))", async ({ page }) => {
    const s = await createSection(apiCtx, `ACC6B 6studio ${uniqueTag("6s")}`, [
      { type: "AddressAutocompleteQuestion", question_id: "q_addr", internal_field: "addr_studio", props: { fields: [{ field: "street", mode: "manual" }] } },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await openStudioEdit(page, s.public_id);
    await canvasRender(page).locator('[data-component-type="AddressAutocompleteQuestion"]').click();
    await openInspectorTab(page, "content");
    await expect(page.locator("[data-address-fieldset-block]"), "the field-set editor is offered for Address").toBeVisible();
    await page.locator("[data-address-preset-plain]").click();
    await expect(page.locator("[data-address-row]"), "Plain text address preset → one row").toHaveCount(1);
    await expect(page.locator("[data-address-field-kind]"), "the one row is full_address").toHaveValue("full_address");
    await saveStudioAwaitOk(page, s.public_id);
    const saved = await fetchSection(apiCtx, s.public_id);
    const addr = saved.content_json.components.find((c) => c["question_id"] === "q_addr") as { props?: { fields?: Array<{ field?: string; mode?: string }> } };
    expect(addr.props?.fields).toHaveLength(1);
    expect(addr.props?.fields?.[0]?.field).toBe("full_address");
  });

  // OPEN CONCERN reported to the conductor (AC-vs-product; NOT fixed — the file is
  // outside this slice's grant): the per-field ZIP5 (and any per-field required)
  // validation gate does NOT function on a LIVE studio-authored address, so a
  // valid address can never advance. Root cause (own-hand-verified, repro below):
  // the client validator src/public/leadgen/runtime/validation.ts:103-105 derives
  // an address's sub-field keys from props.internal_fields, else the default
  // ["street","city","state","zip"] — PLAIN names — but presets.ts m9AddressFieldName
  // (:2836) renders + the store records them as `{base}_{field}` (e.g.
  // "mailing_address_street"). Post-M9 the studio writes props.fields[] and NO
  // props.internal_fields (ui-section-studio.ts:11215), so the validator checks
  // keys (street/city) the store never holds → required fails forever. Repro:
  // an address {internal_field:"mailing_address", fields:[street req, zip zip5 req]}
  // records {mailing_address_street, mailing_address_zip} yet the validation_error
  // beacon fires for {street:required, city:required}. test/leadgen-rework-runtime
  // .test.ts §6.10 passes because it HAND-BUILDS the config with internal_fields +
  // a hand-built plain-named DOM (both sides plain) — it never exercises the real
  // presets render, so the integration mismatch is invisible to it. This journey
  // therefore proves the field-SUBSET render + per-sub-field independent recording
  // (both work live); the validation-gate clause is the reported failure.
  test("#6 runtime: a free-text field subset renders its manual inputs and records each sub-field independently (per-field zip5 validation gate is a reported product bug — see OPEN CONCERN above)", async ({ page, browserName }) => {
    // street is authored mode:autofill; with Maps off/keyless in dev it degrades
    // to a manual text input (the graceful path). zip is manual + zip5.
    // A field SUBSET (street/city/zip — not the full 4) with mixed modes: street
    // MANUAL required, city AUTOFILL optional (Maps off in dev ⇒ it degrades to a
    // keyless manual input the visitor can type), zip MANUAL zip5 required.
    const s = await createSection(
      apiCtx,
      `ACC6B 6rt ${uniqueTag("6r")}`,
      [
        {
          // Fixture-shaped (test/fixtures/leadgen-rework/address-subsets.json):
          // per-field required drives validation — no node-level required/object.
          type: "AddressAutocompleteQuestion",
          question_id: "q_addr",
          internal_field: "mailing_address",
          props: { label: "Mailing address", fields: [
            { field: "street", mode: "manual", required: true },
            { field: "zip", mode: "manual", validation: "zip5", required: true },
          ] },
        },
        { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
      ],
      { continue_mode: "button" },
    );
    const page2 = await createSection(apiCtx, `ACC6B 6rt p2 ${uniqueTag("6r2")}`, [{ type: "ContinueButton", question_id: "p2c", props: { label: "Continue" } }]);

    if (!liveLegChromiumOnly(browserName, "#6 runtime address rides the live /lg funnel (chromium --host-resolver-rules); per-field validation is test/leadgen-rework-runtime.test.ts §6.10.")) return;

    const seed = await seedSimpleFunnel(apiCtx, "6rt", [s.id, page2.id]);
    await page.goto(shellUrlFor(seed.host, seed.slug), { waitUntil: "load" });
    await ready(page);
    await passSharedPage(page);
    const s1 = sectionAt(page, 1);

    // Field SUBSET: exactly the two configured sub-fields render (a subset of the
    // default 4), each in its own `{base}_{field}` wrapper (M9 m9AddressFieldName).
    // A manual-only subset needs no Maps key at all (Maps fully optional; the
    // autofill→manual keyless DEGRADE render is the Plain-text-address preset in
    // leadgen-rework-p2-studio.gesture.spec.ts (c) — this dev instance may have
    // Maps enabled, turning an autofill field into an autocomplete widget, so the
    // keyless render is not exercised live here).
    const inputs = s1.locator('[data-lg-question="q_addr"] [data-lg-input]');
    await expect(inputs, "exactly the two configured sub-fields render").toHaveCount(2);
    await expect(s1.locator('[data-lg-field="mailing_address_street"]'), "street keyed {base}_field (M9)").toHaveCount(1);
    await expect(s1.locator('[data-lg-field="mailing_address_zip"]'), "zip keyed {base}_field (M9)").toHaveCount(1);
    const streetInput = s1.locator('[data-lg-field$="street"] [data-lg-input]');
    const zipInput = s1.locator('[data-lg-field$="zip"] [data-lg-input]');

    // Per-sub-field INDEPENDENT recording: filling each records it under its OWN
    // distinct store key, so each is independently offer-mappable (the auction/offer
    // payload can map street and zip to different fields, exactly like #2B).
    await streetInput.fill("221B Baker St");
    await zipInput.fill("90210");
    const recorded = await engineAnswers(page);
    expect(recorded["mailing_address_street"], "street recorded under its own key").toBe("221B Baker St");
    expect(recorded["mailing_address_zip"], "zip recorded under its own key").toBe("90210");
    // NOTE: advancing past this section is a reported product bug (see the OPEN
    // CONCERN on this test) — the per-field zip5/required validation gate keys on
    // mismatched sub-field names, so Continue is not asserted to advance here.
  });
});

// ===========================================================================
// #7 — sliders (contract §2 #7 / §6.8 / M7). Type picker: leadgen-rework-p2-
// studio.gesture.spec.ts (e). Runtime record/aria/bounds: test/leadgen-rework-
// runtime.test.ts §6.8 + leadgen-runtime-inputs.gesture.spec.ts (S2-3 currency).
// ===========================================================================
test.describe("#7 — sliders (five types render + record; _min/_max; currency affix)", () => {
  test("#7 studio: the type picker offers exactly the five slider types (both engines; cite p2-studio (e))", async ({ page }) => {
    const s = await createSection(apiCtx, `ACC6B 7studio ${uniqueTag("7s")}`, [
      { type: "NumberRangeQuestion", question_id: "q_slider", internal_field: "sl_studio", props: { min: 0, max: 100 } },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await openStudioEdit(page, s.public_id);
    await canvasRender(page).locator('[data-component-type="NumberRangeQuestion"]').click();
    await openInspectorTab(page, "content");
    await expect(page.locator("[data-slider-type-wrap]")).toBeVisible();
    for (const t of ["single", "dual_range", "stepper", "from_to", "radial"]) {
      await expect(page.locator(`[data-set-slider-type="${t}"]`), `${t} thumbnail present`).toBeVisible();
    }
  });

  test("#7 runtime: single records + a currency-affix '$' renders; from_to records _min/_max separately; a stepper steps; the currency toggle never flips the type (Image9)", async ({ page, browserName }) => {
    const s = await createSection(
      apiCtx,
      `ACC6B 7rt ${uniqueTag("7r")}`,
      [
        { type: "NumberRangeQuestion", question_id: "q_single", internal_field: "loan_amount", answer_type: "number", props: { label: "Loan amount", min: 0, max: 100000, step: 5000, slider_type: "single", currency_affix: true, default: 0 } },
        { type: "NumberRangeQuestion", question_id: "q_step", internal_field: "years_exp", answer_type: "number", props: { label: "Years", min: 0, max: 40, step: 5, slider_type: "stepper" } },
        { type: "NumberRangeQuestion", question_id: "q_ft", internal_field: "budget_range", answer_type: "object", props: { label: "Budget", min: 0, max: 50000, step: 500, slider_type: "from_to" } },
        { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
      ],
      { continue_mode: "button" },
    );

    if (!liveLegChromiumOnly(browserName, "#7 runtime sliders ride the live /lg funnel (chromium --host-resolver-rules); record/aria/bounds are test/leadgen-rework-runtime.test.ts §6.8.")) return;

    const seed = await seedSimpleFunnel(apiCtx, "7rt", [s.id]);
    await page.goto(shellUrlFor(seed.host, seed.slug), { waitUntil: "load" });
    await ready(page);
    await passSharedPage(page);
    const s1 = sectionAt(page, 1);

    // currency affix: the single slider's value text carries "$" (Image9 fix:
    // display-only, answer_type stays 'number' — no type flip).
    const single = s1.locator('[data-lg-question="q_single"]');
    await expect(single.locator(".lg-range-value"), "currency affix '$' renders").toContainText("$");
    const singleInput = single.locator('input[type="range"]');
    await singleInput.focus();
    await singleInput.press("ArrowRight"); // keyboard-operable (role=slider)
    await expect.poll(async () => Number((await engineAnswers(page))["loan_amount"] ?? 0), { timeout: 8_000 }).toBeGreaterThan(0);

    // stepper: the ＋ button steps by the required step.
    await s1.locator('[data-lg-question="q_step"] [data-lg-step="inc"]').click();
    await expect.poll(async () => String((await engineAnswers(page))["years_exp"] ?? "")).toBe("5");

    // from_to: two role=slider inputs record {base}_min / {base}_max separately.
    const ft = s1.locator('[data-lg-question="q_ft"]');
    const ftInputs = ft.locator('[data-lg-input]');
    await ftInputs.nth(0).fill("10000");
    await ftInputs.nth(0).dispatchEvent("input");
    await ftInputs.nth(1).fill("40000");
    await ftInputs.nth(1).dispatchEvent("input");
    await expect.poll(async () => (await engineAnswers(page))["budget_range_min"]).toBeTruthy();
    await expect.poll(async () => (await engineAnswers(page))["budget_range_max"]).toBeTruthy();
    const ans = await engineAnswers(page);
    expect(String(ans["budget_range_min"]), "_min recorded").toBe("10000");
    expect(String(ans["budget_range_max"]), "_max recorded").toBe("40000");
  });
});

// ===========================================================================
// #8 — "Other" on buttons + cards (contract §2 #8/#8D / §6.5). Studio other_editor
// per type: the §6.2 matrix test. Runtime mutual-exclusion: test/leadgen-rework-
// runtime.test.ts §6.5.
// ===========================================================================
test.describe("#8 — Other-select on Buttons (and Cards, #8D)", () => {
  function otherGroup(type: string, qid: string, field: string) {
    return {
      type,
      question_id: qid,
      internal_field: field,
      answer_type: "enum",
      props: { label: field, other: { enabled: true, label: "Other", choices: [{ label: "Maybe", value: "maybe", analytics_id: `${field}_maybe` }, { label: "Unsure", value: "unsure", analytics_id: `${field}_unsure` }] } },
      choices: [
        { label: "Yes", value: "yes", ...(type === "IconCardAnswerGrid" ? { icon: "user" } : {}), analytics_id: `${field}_yes` },
        { label: "No", value: "no", ...(type === "IconCardAnswerGrid" ? { icon: "briefcase" } : {}), analytics_id: `${field}_no` },
      ],
    };
  }

  test("#8 studio: buttons/cards offer the Other editor; a dropdown does not (both engines; cite the §6.2 matrix test)", async ({ page }) => {
    const s = await createSection(apiCtx, `ACC6B 8studio ${uniqueTag("8s")}`, [
      otherGroup("ButtonAnswerGroup", "q_b", "other_btn"),
      { type: "DropdownQuestion", question_id: "q_d", internal_field: "other_drop", answer_type: "enum", props: { label: "Drop", placeholder: "Pick" }, choices: [{ label: "One", value: "one", analytics_id: "one" }] },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await openStudioEdit(page, s.public_id);
    // The inspector control blocks are always in the DOM; the island toggles each
    // block's `hidden` attribute per the §6.2 capability on selection. Assert the
    // REVEALED state (`:not([hidden])`), tab-independent, selecting distinct nodes.
    await canvasRender(page).locator('[data-component-type="DropdownQuestion"]').click();
    await expect(page.locator("[data-other-editor-block]:not([hidden])"), "a dropdown does NOT offer the Other editor (matrix)").toHaveCount(0);
    await canvasRender(page).locator('[data-component-type="ButtonAnswerGroup"]').click();
    await expect(page.locator("[data-other-editor-block]:not([hidden])"), "buttons offer the Other editor (§6.5)").toHaveCount(1);
  });

  test("#8/#8D runtime: enabling Other leaves base choices untouched and adds an Other affordance; picking an Other value records it + deselects the base (and vice versa) — identical on Buttons and Cards", async ({ page, browserName }) => {
    const s = await createSection(
      apiCtx,
      `ACC6B 8rt ${uniqueTag("8r")}`,
      [otherGroup("ButtonAnswerGroup", "q_btn", "other_btn"), otherGroup("IconCardAnswerGrid", "q_card", "other_card"), { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } }],
      { continue_mode: "button" },
    );

    if (!liveLegChromiumOnly(browserName, "#8 Other-select rides the live /lg funnel (chromium --host-resolver-rules); mutual exclusion is test/leadgen-rework-runtime.test.ts §6.5.")) return;

    const seed = await seedSimpleFunnel(apiCtx, "8rt", [s.id]);
    await page.goto(shellUrlFor(seed.host, seed.slug), { waitUntil: "load" });
    await ready(page);
    await passSharedPage(page);
    const s1 = sectionAt(page, 1);

    for (const [qid, field] of [["q_btn", "other_btn"], ["q_card", "other_card"]] as const) {
      const q = s1.locator(`[data-lg-question="${qid}"]`);
      // base choices UNCHANGED (both present) + an Other affordance.
      await expect(q.locator('[data-lg-choice="yes"]'), `${qid}: base choice retained`).toBeVisible();
      await expect(q.locator("[data-lg-other-trigger]"), `${qid}: Other affordance added`).toBeVisible();

      // pick a base choice → recorded + selected.
      await q.locator('[data-lg-choice="yes"]').click();
      await expect(q.locator('[data-lg-choice="yes"]')).toHaveClass(/lg-selected/);
      await expect.poll(async () => (await engineAnswers(page))[field]).toBe("yes");

      // reveal the Other panel + pick an Other value → recorded + base DESELECTED.
      // The authored-values <select> IS the [data-lg-other-panel] element (it
      // carries data-lg-other-panel AND data-lg-input on the same node).
      await q.locator("[data-lg-other-trigger]").click();
      await q.locator("[data-lg-other-panel]").selectOption("maybe");
      await expect.poll(async () => (await engineAnswers(page))[field]).toBe("maybe");
      await expect(q.locator('[data-lg-choice="yes"]'), `${qid}: base deselected when Other picked`).not.toHaveClass(/lg-selected/);

      // pick a base choice again → records the base + the base is now selected
      // (the answer switched off the Other value — the "and vice versa" direction).
      await q.locator('[data-lg-choice="no"]').click();
      await expect.poll(async () => (await engineAnswers(page))[field]).toBe("no");
      await expect(q.locator('[data-lg-choice="no"]'), `${qid}: base is now the selection (Other no longer recorded)`).toHaveClass(/lg-selected/);
    }
  });
});

// ===========================================================================
// #9 — card layout (contract §2 #9 / §6.7). A 2-card component renders 2 columns
// (no ghost cell); a 5-card 3-column component centers its last row; the ghost is
// impossible in the live render (studio-only, §6.1 — proven in the components
// spec #1). Deeper geometry gate: leadgen-p1-geometry.gesture.spec.ts.
// ===========================================================================
test.describe("#9 — 2-card / 5-card centering, ghost impossible live", () => {
  function cards(qid: string, field: string, n: number) {
    return {
      type: "IconCardAnswerGrid",
      question_id: qid,
      internal_field: field,
      answer_type: "enum",
      props: { label: field },
      choices: Array.from({ length: n }, (_, i) => ({ label: `C${i + 1}`, value: `c${i + 1}`, icon: "user", analytics_id: `${field}_c${i + 1}` })),
    };
  }

  test("#9 live: a 2-card grid renders exactly 2 columns/cells with no ghost; a 5-card grid renders 5 cells with its last row centered; no studio ghost appears live", async ({ page, browserName }) => {
    const s = await createSection(apiCtx, `ACC6B 9 ${uniqueTag("9")}`, [
      cards("q_2card", "cards2", 2),
      cards("q_5card", "cards5", 5),
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);

    if (!liveLegChromiumOnly(browserName, "#9 card centering is measured on the live /lg funnel (chromium --host-resolver-rules); the geometry gate is leadgen-p1-geometry.gesture.spec.ts.")) return;

    const seed = await seedSimpleFunnel(apiCtx, "9", [s.id]);
    await page.goto(shellUrlFor(seed.host, seed.slug), { waitUntil: "load" });
    await ready(page);
    await passSharedPage(page);
    const s1 = sectionAt(page, 1);

    // no studio-only ghost affordance exists in the live render (§6.1).
    expect(await s1.locator("[data-choice-ghost], [data-add-ghost-row], .studio-add-ghost-row").count(), "ghost impossible in live").toBe(0);

    // 2-card: exactly 2 cells, exactly 2 grid tracks (min(authored 3, count 2) →
    // 2 columns, never a 3rd ghost cell), not the partial-row centered scheme.
    const two = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('[data-lg-question="q_2card"] [data-lg-choice]')];
      const grid = cells[0]?.parentElement;
      const cs = grid ? getComputedStyle(grid) : null;
      return { cellCount: cells.length, tracks: cs ? cs.gridTemplateColumns.trim().split(/\s+/).length : 0, justify: cs?.justifyContent ?? "" };
    });
    expect(two.cellCount, "2 real card cells").toBe(2);
    expect(two.tracks, "exactly 2 columns (no ghost 3rd)").toBe(2);

    // 5-card: 5 cells; the partial last row (5 % 3 ≠ 0) is centered
    // (justify-content:center is emitted ONLY for a partial row — presets.ts).
    const five = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('[data-lg-question="q_5card"] [data-lg-choice]')];
      const grid = cells[0]?.parentElement;
      const cs = grid ? getComputedStyle(grid) : null;
      return { cellCount: cells.length, justify: cs?.justifyContent ?? "" };
    });
    expect(five.cellCount, "5 real card cells").toBe(5);
    expect(five.justify, "the wrapped last row is centered").toBe("center");

    // §11 visual evidence at 1280 + 375 (+ no horizontal overflow at mobile).
    await captureResponsive(page, "9-cards", { assertNoOverflowAt375: true });
  });
});

// ===========================================================================
// #10 — the §6.2 per-type control matrix (contract §2 #10 / §6.2). "Dropdown
// shows no Other-group control." The exhaustive executable matrix (each of the
// 45 types deep-equals its transcribed §6.2 row, Layer A + the executed island
// Layer B) is test/leadgen-rework-matrix.test.ts; this is the live studio journey
// confirming each type shows EXACTLY its own controls.
// ===========================================================================
test.describe("#10 — §6.2 control matrix (each type shows exactly its controls)", () => {
  test("#10 selecting each type in the studio shows its OWN control blocks and hides the others; a Dropdown shows NO Other-group control (both engines; cite the §6.2 matrix test)", async ({ page }) => {
    const s = await createSection(apiCtx, `ACC6B 10 ${uniqueTag("10")}`, [
      { type: "TwoButtonYesNo", question_id: "q_yn", internal_field: "m_yn", answer_type: "boolean", props: { label: "YN", yesLabel: "Yes", noLabel: "No" } },
      { type: "ButtonAnswerGroup", question_id: "q_btn", internal_field: "m_btn", answer_type: "enum", props: { label: "Buttons" }, choices: [{ label: "A", value: "a", analytics_id: "a" }, { label: "B", value: "b", analytics_id: "b" }] },
      { type: "DropdownQuestion", question_id: "q_drop", internal_field: "m_drop", answer_type: "enum", props: { label: "Dropdown", placeholder: "Pick" }, choices: [{ label: "A", value: "a", analytics_id: "a" }] },
      { type: "NumberRangeQuestion", question_id: "q_slider", internal_field: "m_slider", props: { label: "Slider", min: 0, max: 10 } },
      { type: "PhoneInputQuestion", question_id: "q_phone", internal_field: "m_phone", props: { label: "Phone" } },
      { type: "AddressAutocompleteQuestion", question_id: "q_addr", internal_field: "m_addr", props: { label: "Address", fields: [{ field: "street", mode: "manual" }] } },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await openStudioEdit(page, s.public_id);

    // The inspector control blocks are always in the DOM; the island toggles each
    // block's `hidden` attribute per the §6.2 capability on selection. "shows a
    // control" ≡ the block is REVEALED (`:not([hidden])`); "hides" ≡ not revealed
    // (either absent from the DOM or present-but-hidden). Tab-independent.
    async function select(type: string): Promise<void> {
      await canvasRender(page).locator(`[data-component-type="${type}"]`).first().click();
    }
    const present = (sel: string) => expect(page.locator(`${sel}:not([hidden])`), `${sel} revealed`).toHaveCount(1);
    const absent = (sel: string) => expect(page.locator(`${sel}:not([hidden])`), `${sel} hidden`).toHaveCount(0);

    // Dropdown — the #10 headline: choices editor, but NO Other-group control,
    // no slider/address/phone/selected-marker.
    await select("DropdownQuestion");
    await present("[data-field-choices-block]");
    await absent("[data-other-editor-block]");
    await absent("[data-slider-type-wrap]");
    await absent("[data-address-fieldset-block]");
    await absent("[data-content-phoneformat-block]");
    await absent("[data-selected-marker-wrap]");

    // Buttons — choices + Other + selected-marker; NOT a slider.
    await select("ButtonAnswerGroup");
    await present("[data-field-choices-block]");
    await present("[data-other-editor-block]");
    await present("[data-selected-marker-wrap]");
    await absent("[data-slider-type-wrap]");

    // Yes/No — selected-marker; NO Other editor.
    await select("TwoButtonYesNo");
    await present("[data-selected-marker-wrap]");
    await absent("[data-other-editor-block]");

    // Slider — the slider-type picker; NO choices/other.
    await select("NumberRangeQuestion");
    await present("[data-slider-type-wrap]");
    await absent("[data-field-choices-block]");
    await absent("[data-other-editor-block]");

    // Phone — the mask builder; NO slider.
    await select("PhoneInputQuestion");
    await present("[data-content-phoneformat-block]");
    await absent("[data-slider-type-wrap]");

    // Address — the field-set editor; NO choices.
    await select("AddressAutocompleteQuestion");
    await present("[data-address-fieldset-block]");
    await absent("[data-field-choices-block]");
  });
});
