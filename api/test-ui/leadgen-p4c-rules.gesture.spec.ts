// Product-core P4c (register PC-12) — rules UX honesty + conditional
// Continue, LIVE legs.
//
// Proves, through the REAL served studio + the REAL live funnel (never a
// hand-built fixture consumed in isolation, matching this program's own
// "test end-to-end, not the consumer alone" doctrine):
//   1. The Show-if "when" picker lists HUMAN component names (typeLabel /
//      the section headline for its first field) — never the raw
//      internal_field id — while the option VALUE stays the internal_field
//      (the stored contract is unchanged); the sentence renders human too.
//   2. A section-level Continue-visibility rule, authored on the REAL
//      CONTINUE inspector panel (select the ContinueButton on canvas, Style
//      tab, "Continue visibility" block) — same naming + sentence
//      discipline as (1) — persists via the real PATCH.
//   3. LIVE: the authored continue_visible_when hides [data-lg-continue]
//      until the trigger question is answered to match, reveals it once
//      met, hides it again if un-met, and Continue genuinely advances once
//      shown.
//
// CROSS-ENGINE (playwright.config.ts CROSS_ENGINE_GESTURE_SPECS, the p2a/
// p3a/p4b shape): the studio-authoring legs (1)/(2) carry NO dynamic
// e2e.test host dependency, so they run on BOTH chromium and firefox. Leg
// (3) drives a dynamic `{uniq}.e2e.test` host, which needs chromium's
// `--host-resolver-rules` — firefox cannot resolve it, so it test.skip()s
// there with a documented reason (the SAME split leadgen-p3a-placement /
// leadgen-p4b-validation already establish).
//
// TRIGGER FIELD CHOICE (investigation note, register PC-12): the trigger
// question below is a ButtonAnswerGroup with STRING choice values ("yes"/
// "no"), not a TwoButtonYesNo. A TwoButtonYesNo's live-clicked answer is the
// RAW STRING "true"/"false" (no `choices` array to type-resolve against in
// engine.ts handleChoiceActivation), while ANY typed studio picker
// (buildConditional/typedScalar) stores a REAL BOOLEAN for a boolean-typed
// `when` field — so a conditional authored via the studio against a
// TwoButtonYesNo field can never match a live click (pre-existing,
// documented elsewhere — see leadgen-p3a-placement.gesture.spec.ts's own
// "grounded via a live debug probe" comment, and this phase's engine.ts
// handleChoiceActivation investigation note). A choice-bearing field (like
// this ButtonAnswerGroup) has no such gap: both the live click
// (handleChoiceActivation resolves choiceConfig.value) and the studio's
// typed picker (typedScalar's non-boolean/non-number branch returns the
// choice's own string value unchanged) agree on the SAME value — so this
// spec proves the REAL mechanism without being confounded by that separate,
// already-flagged issue (see the phase report for the full finding).
import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { seedActiveSite } from "./listicles-p6-seed";
import { PW_PORT } from "./utils/base-url";

test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] } });

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const LG_API = "/api/admin/leadgen";
const SHOT_DIR = "test-artifacts/leadgen-p4c";

async function json<T>(res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> }, label: string): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

interface CreatedSection { id: number; public_id: string }

async function createSection(request: APIRequestContext, body: Record<string, unknown>): Promise<CreatedSection> {
  return json<CreatedSection>(
    await request.post(`${LG_API}/sections`, { data: { activity: "quote_funnel", vertical: "life", status: "active", ...body } }),
    "section create",
  );
}

test.beforeAll(() => { mkdirSync(SHOT_DIR, { recursive: true }); });

// ---------------------------------------------------------------------------
// 1 — Show-if "when" picker: human names, human sentence (studio-only, both engines)
// ---------------------------------------------------------------------------

test.describe("PC-12 leg 1 — Show-if picker lists human names; the sentence speaks human too", () => {
  test("a compound section (headline'd Yes/No + a sibling ZIP): the 'when' options show typeLabel/headline text, never the raw internal_field; the authored sentence is human; the rule round-trips", async ({ page }) => {
    const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const section = await createSection(page.request, {
      section_name: `PC12 rules ${uniq}`,
      headline_text: "Are you currently insured?",
      content_json: JSON.stringify({
        components: [
          { type: "TwoButtonYesNo", question_id: "q_ins", internal_field: "currently_insured", answer_type: "boolean", props: { yesLabel: "Yes", noLabel: "No" } },
          { type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip", props: { placeholder: "ZIP code" } },
          { type: "ContinueButton", question_id: "q_cont" },
        ],
      }),
    });

    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: "domcontentloaded" });
    await page.frameLocator("#lg-studio-canvas-frame").locator('#lg-studio-canvas-render [data-component-type="ZIPInputQuestion"]').click();
    await page.locator('[data-studio-inspector-tab="rules"]').click();
    await page.locator("[data-rules-add-condition]").click();

    const whenSel = page.locator('[data-inspector-cond="when"]');
    const options = await whenSel.locator("option").evaluateAll((els) =>
      els.map((e) => ({ value: (e as HTMLOptionElement).value, text: (e.textContent || "").trim() })),
    );
    const insuredOpt = options.find((o) => o.value === "currently_insured");
    expect(insuredOpt, `options were: ${JSON.stringify(options)}`).toBeDefined();
    // PC-12: the option VALUE is unchanged (still the internal_field) —
    // ONLY the visible TEXT changes. This section's FIRST field pairs with
    // the section headline (the common one-question-per-section case).
    expect(insuredOpt!.text).toBe("Are you currently insured?");
    expect(insuredOpt!.text).not.toBe("currently_insured");

    await whenSel.selectOption("currently_insured");
    const boolValue = page.locator('[data-inspector-cond="value-bool"]');
    await expect(boolValue).toBeVisible();
    await boolValue.selectOption("true");

    // The sentence is the FIRST thing on the tab (moved out of the fieldset
    // into the always-visible summary row, PC-12 discoverability fix) and
    // speaks the human name + the field's own yesLabel wording.
    const sentence = page.locator("[data-cond-sentence]");
    await expect(sentence).toHaveText("Show this question when Are you currently insured? is Yes");
    await page.screenshot({ path: `${SHOT_DIR}/leg1-sentence.png` });

    await Promise.all([page.waitForEvent("load"), page.locator("#lg-section-save").click()]);
    const detail = await json<{ content_json: { components: Array<{ question_id: string; conditional?: { when: string; op: string; value: unknown } }> } }>(
      await page.request.get(`${LG_API}/sections/${section.public_id}`),
      "leg1 detail",
    );
    const zipNode = detail.content_json.components.find((c) => c.question_id === "q_zip");
    // The STORED contract is unchanged: internal_field value, real boolean
    // (the studio's typed picker), never a display string.
    expect(zipNode?.conditional).toEqual({ when: "currently_insured", op: "eq", value: true });
  });
});

// ---------------------------------------------------------------------------
// 2 — Continue visibility: author on the REAL Continue inspector panel
// (studio-only, both engines)
// ---------------------------------------------------------------------------

test.describe("PC-12 leg 2 — Continue visibility authored on the real CONTINUE panel", () => {
  test("selecting the ContinueButton, Style tab: the 'Continue visibility' block lists human names, renders a human sentence, and persists continue_visible_when via the real PATCH", async ({ page }) => {
    const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const section = await createSection(page.request, {
      section_name: `PC12 continue ${uniq}`,
      headline_text: "Are you interested in a quote?",
      content_json: JSON.stringify({
        components: [
          {
            type: "ButtonAnswerGroup",
            question_id: "q_int",
            internal_field: "interested",
            answer_type: "enum",
            choices: [
              { label: "Yes", value: "yes", analytics_id: "int_yes" },
              { label: "No", value: "no", analytics_id: "int_no" },
            ],
          },
          { type: "ContinueButton", question_id: "q_cont" },
        ],
      }),
    });

    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: "domcontentloaded" });
    await page.frameLocator("#lg-studio-canvas-frame").locator('#lg-studio-canvas-render [data-component-type="ContinueButton"]').click();
    await page.locator('[data-studio-inspector-tab="style"]').click();

    // The picker fieldset is collapsed by default (mirrors the Rules-tab
    // Show-if picker exactly) — "+ Add a show/hide rule" reveals it.
    await page.locator("[data-continuecond-add]").click();

    const whenSel = page.locator('[data-inspector-continuecond="when"]');
    await expect(whenSel).toBeVisible();
    const options = await whenSel.locator("option").evaluateAll((els) =>
      els.map((e) => ({ value: (e as HTMLOptionElement).value, text: (e.textContent || "").trim() })),
    );
    const interestedOpt = options.find((o) => o.value === "interested");
    expect(interestedOpt, `options were: ${JSON.stringify(options)}`).toBeDefined();
    // This section's ONLY field pairs with the section headline.
    expect(interestedOpt!.text).toBe("Are you interested in a quote?");
    expect(interestedOpt!.text).not.toBe("interested");

    await whenSel.selectOption("interested");
    const enumValue = page.locator('[data-inspector-continuecond="value-enum"]');
    await expect(enumValue).toBeVisible();
    // Choice VALUES show their labels, never the raw stored value.
    const enumOptions = await enumValue.locator("option").evaluateAll((els) => els.map((e) => (e.textContent || "").trim()));
    expect(enumOptions).toContain("Yes");
    await enumValue.selectOption("yes");

    const sentence = page.locator("[data-continuecond-sentence]");
    await expect(sentence).toHaveText("Show Continue when Are you interested in a quote? is Yes");
    await page.screenshot({ path: `${SHOT_DIR}/leg2-continue-sentence.png` });

    // Unlike a clean save (which redirects/reloads), a save that surfaces a
    // NEW non-blocking problem (here: the continue_visibility_risk WARNING
    // this phase added) STAYS on the page so the operator can read it — no
    // "load" event fires. Wait for the save PATCH's response instead (robust
    // either way), then assert the warning banner + the persisted content.
    const [patchRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/sections/${section.public_id}`) && r.request().method() === "PATCH"),
      page.locator("#lg-section-save").click(),
    ]);
    expect(patchRes.ok(), await patchRes.text()).toBe(true);
    await expect(page.getByText("only way to advance, and it is now conditional")).toBeVisible();

    const detail = await json<{ content_json: { continue_visible_when?: { when: string; op: string; value: unknown } } }>(
      await page.request.get(`${LG_API}/sections/${section.public_id}`),
      "leg2 detail",
    );
    expect(detail.content_json.continue_visible_when).toEqual({ when: "interested", op: "eq", value: "yes" });
  });
});

// ---------------------------------------------------------------------------
// 3 — LIVE: continue_visible_when hides/shows [data-lg-continue] and gates
// advance (chromium; firefox test.skip()s — dynamic e2e.test host)
// ---------------------------------------------------------------------------

test.describe("PC-12 leg 3 — LIVE: conditional Continue hides until met, shows once met, advances", () => {
  async function seedLiveFunnel(request: APIRequestContext, tag: string): Promise<{ host: string; slug: string }> {
    const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const host = `lg-p4c-${tag}-${uniq}.e2e.test`;
    const siteId = await seedActiveSite(request, host, `P4c ${tag} ${uniq}`);
    const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
      await request.post(`${LG_API}/quotes`, { data: { quote_name: `P4c ${tag} ${uniq}`, activity: "quote_funnel", verticals: ["life"] } }),
      "quote create",
    );
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    // continue_visible_when authored here via the SAME shape the real
    // studio panel writes (leg 2 above proves the AUTHORING mechanism
    // through the real panel; this leg proves the LIVE ENGINE mechanism —
    // together they cover "author on the real panel, live page reacts").
    const section = await createSection(request, {
      section_name: `PC12 live ${uniq}`,
      headline_text: "Are you interested in a quote?",
      content_json: JSON.stringify({
        components: [
          {
            type: "ButtonAnswerGroup",
            question_id: "q_int",
            internal_field: "interested",
            answer_type: "enum",
            choices: [
              { label: "Yes", value: "yes", analytics_id: "int_yes" },
              { label: "No", value: "no", analytics_id: "int_no" },
            ],
          },
          { type: "ContinueButton", question_id: "q_cont", props: { label: "See my quotes" } },
        ],
        continue_visible_when: { when: "interested", op: "eq", value: "yes" },
      }),
    });
    const next = await createSection(request, {
      section_name: `PC12 live next ${uniq}`,
      headline_text: "You made it",
      content_json: JSON.stringify({ components: [{ type: "TwoButtonYesNo", question_id: "q9", internal_field: "z" }] }),
    });
    await json(await request.put(`${LG_API}/variants/${variantId}`, { data: { sections: [{ section_id: section.id }, { section_id: next.id }] } }), "variant sections");
    await json(await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug: tag } }), "activation");
    return { host, slug: tag };
  }

  const shellUrl = (s: { host: string; slug: string }) => `http://${s.host}:${PW_PORT}/lg/${s.slug}`;
  const sectionIndex = (page: Page): Promise<number> =>
    page.evaluate(() => (window as unknown as { __LG_ENGINE__: { getState(): { section_index: number } } }).__LG_ENGINE__.getState().section_index);

  test("unanswered on load → Continue hidden; 'No' keeps it hidden; 'Yes' shows it and clicking it advances", async ({ page, browserName }) => {
    test.skip(
      browserName === "firefox",
      "live /lg leg needs chromium --host-resolver-rules; firefox cannot resolve the dynamic e2e host — legs 1/2 above (studio-authoring) are the both-engine proof for this phase",
    );
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    const seeded = await seedLiveFunnel(ctx, "cont");
    await ctx.dispose();

    await page.goto(shellUrl(seeded), { waitUntil: "load" });
    await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 8_000 });
    expect(await sectionIndex(page)).toBe(0);

    const cont = page.locator('[data-lg-index="0"] [data-lg-continue]').first();
    // Fail-closed: an unanswered trigger never satisfies the condition.
    await expect(cont).toBeHidden();
    await page.screenshot({ path: `${SHOT_DIR}/leg3-hidden.png`, fullPage: true });

    // "No" does not meet the rule — Continue stays hidden.
    await page.locator('[data-lg-index="0"] [data-lg-choice="no"]').first().click();
    await page.waitForTimeout(200);
    await expect(cont).toBeHidden();

    // "Yes" meets it — Continue reveals.
    await page.locator('[data-lg-index="0"] [data-lg-choice="yes"]').first().click();
    await expect(cont).toBeVisible({ timeout: 3_000 });
    await page.screenshot({ path: `${SHOT_DIR}/leg3-shown.png`, fullPage: true });

    // Switching back to "No" hides it again (live re-evaluation, not just on entry).
    await page.locator('[data-lg-index="0"] [data-lg-choice="no"]').first().click();
    await expect(cont).toBeHidden({ timeout: 3_000 });

    // Back to "Yes", then Continue genuinely advances the funnel.
    await page.locator('[data-lg-index="0"] [data-lg-choice="yes"]').first().click();
    await expect(cont).toBeVisible({ timeout: 3_000 });
    await cont.click();
    await expect.poll(() => sectionIndex(page), { timeout: 5_000 }).toBe(1);
    await page.screenshot({ path: `${SHOT_DIR}/leg3-advanced.png`, fullPage: true });
  });
});
