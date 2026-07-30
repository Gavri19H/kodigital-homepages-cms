// LeadGen Round-4 Remediation — Phase P4b probe spec (temporary; final
// consolidation lands in P7). Drives the REAL unified routing-rules builder
// (ui-quotes.ts renderRulesPanel + ui-rules-builder.ts renderRoutingRulesPanel/
// ROUTING_RULES_SCRIPT) end to end with real fill/click/select (ZERO
// dispatchEvent):
//   * open the funnel builder tab, confirm the rules panel is embedded there
//     (right column) and the standalone "Rules" top tab is GONE;
//   * "+ New rule" → the Image42-shaped modal → author a rule (name,
//     priority, ANY/ALL match mode default, conditions: UTM source is X AND
//     an age answer at least 65, action: eligibility — Rework M3 retired
//     route_funnel_variant with no replacement action-type, so this vehicle
//     exercises the same modal/conditions/save/toggle/duplicate machinery
//     instead) → Save → the table row shows it (checkpoint auto-derivation
//     was route_funnel_variant-only and is retired too — relocated to P3b's
//     not-yet-built quote-scoped rules — so the checkpoint mirror/cell is
//     always "—" for every surviving type);
//   * SAVE the variant (the real §15.5/P4b replace-set PUT) → RELOAD → the
//     rule round-trips;
//   * toggle status → Disabled → Save → reload → persists;
//   * Duplicate → a "(copy)"-suffixed row appears;
//   * the legacy raw target_offer_id input is never VISIBLE anywhere in the
//     panel (it survives only as a hidden wire-format carrier — see ui-
//     quotes.ts renderRuleRow's P4b doc comment);
//   * a redirect_direct_offer rule authored via the offer NAME picker
//     persists the CORRECT target_offer_id (never a raw id the operator typed).
//
// Rework M3 also retired skip_section/show_section with no replacement
// action-type and no surviving action-panel UI (see the removal note at the
// bottom of this file) — this spec no longer seeds a second ("Variant B")
// arm, since nothing left here targets one and forkVariantHandler's
// single-active-variant guard (§4.3-10) would otherwise always 409 on it.
//
// chromium-only (playwright.config.ts: firefox testMatch is the gesture set;
// this non-gesture admin-UI spec is picked up by chromium alone, like
// __p3b-structure / __p4a-routing). Admin UI on 127.0.0.1 — no tenant host,
// no --host-resolver-rules.

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { PW_PORT } from "./utils/base-url";

test.use({ viewport: { width: 1280, height: 900 } });

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const LG_API = "/api/admin/leadgen";
const SHOT_DIR = "test-artifacts/leadgen-p4b";
const VERTICAL = "life";

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

interface Seeded {
  quotePublicId: string;
  variantAId: string; // control — the one the editor opens on
  introSectionId: string;
  offerId: string; // numeric id, as a string (the by-name picker's <option value>)
  offerName: string;
}

async function seedQuote(request: APIRequestContext, tag: string): Promise<Seeded> {
  const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const quote = await json<{ public_id: string; funnels: Array<{ variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, { data: { quote_name: `P4b ${tag} ${uniq}`, activity: "quote_funnel", verticals: [VERTICAL] } }),
    "quote create",
  );
  const variantAId = quote.funnels[0]!.variants[0]!.public_id;

  const introSection = await json<{ public_id: string }>(
    await request.post(`${LG_API}/sections`, {
      data: {
        activity: "quote_funnel",
        vertical: VERTICAL,
        status: "active",
        section_name: `Intro ${uniq}`,
        headline_text: "Welcome",
        content_json: { components: [{ type: "TwoButtonYesNo", question_id: "q_intro", question_key: "k_intro", internal_field: `intro_${uniq}`, answer_type: "boolean", required: true }] },
      },
    }),
    "intro section create",
  );
  const ageSection = await json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/sections`, {
      data: {
        activity: "quote_funnel",
        vertical: VERTICAL,
        status: "active",
        section_name: `Age question ${uniq}`,
        headline_text: "How old are you?",
        content_json: { components: [{ type: "TwoButtonYesNo", question_id: "q_age", question_key: "k_age", internal_field: "age", answer_type: "boolean", required: true }] },
      },
    }),
    "age section create",
  );

  // Two pages: page 1 = intro, page 2 = the age question — gives the
  // condition-builder's field picker a real mid-funnel `age` field to select
  // (checkpoint auto-derivation itself is retired post-rework; see the test
  // body's comment on #lg-modal-checkpoint/[data-row-checkpoint]).
  const pagesPut = await request.put(`${LG_API}/variants/${variantAId}`, {
    data: {
      pages: [
        { name: "Intro", slots: [{ kind: "fixed", section_id: introSection.public_id }] },
        { name: "Age", slots: [{ kind: "fixed", section_id: ageSection.public_id }] },
      ],
    },
  });
  if (!pagesPut.ok()) throw new Error(`seed pages HTTP ${pagesPut.status()}: ${await pagesPut.text()}`);

  // Rework M1 (§4.3-10)/M3: route_funnel_variant is retired from
  // leadgen_funnel_rules (no replacement action-type — routing is now
  // quote-scoped via leadgen_quote_routing_rules, a separate table/UI
  // surface). Variant B existed ONLY as that removed rule type's target, so
  // it is no longer seeded here — also sidesteps forkVariantHandler's
  // single-active-variant guard (§4.3-10: "forbid a SECOND active variant
  // when there is no running test"), which this quote's lone control
  // variant would otherwise always trip.
  const offerName = `Kissterra Offer ${uniq}`;
  const offer = await json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/offers`, {
      data: {
        offer_name: offerName,
        provider: "fxprov",
        activity: "quote_funnel",
        vertical: VERTICAL,
        conversion_tracking_method: "s2s_postback",
        offer_type: "cpc",
        placements: [`pl-${uniq}`],
        calls_provider_api: false,
        bid_source: "static",
        cap_enabled: false,
      },
    }),
    "offer create",
  );

  return {
    quotePublicId: quote.public_id,
    variantAId,
    introSectionId: introSection.public_id,
    offerId: String(offer.id),
    offerName,
  };
}

test.beforeAll(() => {
  mkdirSync(SHOT_DIR, { recursive: true });
});

// Server-authoritative re-fetch of ONE variant's persisted rules — used to
// prove a save actually landed (independent of the client's own read of its
// just-sent payload). Every rule-shaped field the conductor's fix-round asks
// to prove (enabled/status coherence, redirect_pct, rule_name on every type)
// is verified THIS way at least once.
async function fetchVariantRules(quotePublicId: string, variantPublicId: string): Promise<Array<Record<string, unknown>>> {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  const structure = await json<{ funnels: Array<{ variants: Array<{ public_id: string; rules: Array<Record<string, unknown>> }> }> }>(
    await ctx.get(`${LG_API}/quotes/${quotePublicId}/structure`),
    "structure re-fetch",
  );
  await ctx.dispose();
  const variant = structure.funnels.flatMap((f) => f.variants).find((v) => v.public_id === variantPublicId);
  return variant?.rules ?? [];
}

test.describe("P4b — unified routing-rules builder (Image42 modal + table)", () => {
  let seed: Seeded;

  test.beforeAll(async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    seed = await seedQuote(ctx, "core");
    await ctx.dispose();
  });

  // R2 P6 terminal clearance (conductor ruling R-B/R-A): this test's CLAIM —
  // "there is no standalone Rules tab; the rules surface is embedded in the
  // Funnel builder tab's RIGHT column" — is still true and still load-bearing,
  // so it is KEPT and only its mount selector is re-pointed. The P3b board
  // rewrite moved the mount from `#lg-inspector-column #lg-routing-rules-root`
  // (0 renders in src today) to `.lg-board-right[data-rules-rail]`
  // (quotes-tabs/funnel.ts:708, the ONLY `data-rules-rail` render in src).
  // Kept at least as strict: the old version asserted "visible" + "exactly one
  // inside the builder panel's inspector column"; this asserts visible + a
  // page-wide uniqueness of the mount + that the single page-wide instance is
  // the one inside the ACTIVE builder panel (so a stray mount in any other tab
  // panel fails), and additionally pins the rail to the board shell's right
  // column rather than merely "somewhere in the panel".
  test("standalone Rules tab is gone; the panel is embedded in the Funnel builder tab's right column", async ({ page }) => {
    await page.goto(`/admin/leadgen/quotes/${seed.quotePublicId}/edit`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".lg-qtabs [data-tab='builder']")).toBeVisible();
    // The five-tab era's standalone Rules tab/panel no longer exist.
    await expect(page.locator(".lg-qtabs [data-tab='rules']")).toHaveCount(0);
    await expect(page.locator("[data-panel='rules']")).toHaveCount(0);
    // The rules rail is inside the ACTIVE builder panel's right column…
    const builderPanel = page.locator("[data-panel='builder'].active");
    const rail = builderPanel.locator(".lg-board-right[data-rules-rail]");
    await expect(rail).toBeVisible();
    await expect(rail).toHaveCount(1);
    // …and it is EMBEDDED there, not merely present: exactly one mount exists
    // page-wide, and it is a direct child of the builder panel's board shell.
    await expect(page.locator("[data-rules-rail]")).toHaveCount(1);
    await expect(builderPanel.locator('.lg-board-shell[data-pin="8.2-tab-geometry"] > .lg-board-right[data-rules-rail]')).toHaveCount(1);
    // …carrying a real rules surface (the quote-scoped rail island), not an
    // empty div left behind by the move.
    await expect(rail.locator('#lg-qr-rail[data-pin="8.2-rules-rail"]')).toHaveCount(1);
  });

  // =========================================================================
  // RETIRED 2026-07-30 (R2 P6 terminal clearance, conductor ruling R-A) —
  // `.skip`ped, not deleted, so the claims stay readable beside their cover.
  //
  // WHY: the P3b board rewrite deleted the ENTIRE per-variant rules UI this
  // test drives. Measured by hand at f808e33 against `src/`:
  //   grep -rn "lg-rule-modal" src/       -> 0 hits
  //   grep -rn "lg-rule-new" src/         -> 0 hits
  //   grep -rn "lg-rules-table-body" src/ -> 0 hits
  //   grep -rn "lg-modal-rule-type" src/  -> 0 hits
  //   grep -rn "lg-routing-rules-root" src/ -> only the two removal COMMENTS
  //     in quotes-tabs/funnel.ts:1034/1037, zero renders
  // ui-quotes.ts states the removal itself: "ROUTING_RULES_SCRIPT /
  // renderRoutingRulesPanel (the OLD per-variant rules panel this phase
  // removed from render — renderInspectorColumn/renderRulesPanel, deleted with
  // the board rewrite) were CONFIRMED unreachable dead code bound to absent
  // DOM (0 real call sites anywhere) and DELETED entirely." Routing moved to
  // the QUOTE-scoped rail (leadgen_quote_routing_rules), which test 1 above
  // still pins structurally.
  //
  // WHERE EACH CLAIM IS NOW ASSERTED — all in
  // leadgen-rework-p3b-rules.gesture.spec.ts (16/16 at f808e33), whose Layer-2
  // tests hit the REAL board page, REAL API and REAL D1 (not the mock layer):
  //   * author a rule through the real modal, save, RELOAD, and read the
  //     persisted server-side values back
  //       -> "create through the real modal -> reload -> the card renders the
  //          persisted, server-side values"  (Layer 2, real round-trip)
  //   * toggle status (enable/disable) + Duplicate + delete
  //       -> "duplicate adds a copy; enable/disable flips status; delete
  //          removes the row" AND "pick variant -> create eligibility rule ->
  //          edit -> duplicate -> delete; server message on a validation
  //          failure"  (the latter is Layer 2, real server)
  //   * priority + the row/card rendering the authored rule
  //       -> "create a rule with ALL FIVE actions → saves → row appears with
  //          its sentence" AND "priority change reorders the cards (lower
  //          number first)"
  //   * "no raw target_offer_id input is ever VISIBLE — the operator picks an
  //     offer by NAME": the successor rail has no raw-id input at all; the
  //     by-NAME picker is asserted by "create a rule with ALL FIVE actions"
  //     ([data-qr-target-mode] [data-qr-mode="offer"] then
  //      [data-qr-target-offer].selectOption), and the missing-offer failure
  //     path by "pick variant -> ... server message on a validation failure"
  //     (#lg-frr-type = redirect_direct_offer with no offer chosen ->
  //      "requires target_offer_id").
  // =========================================================================
  test.skip("author a rule through the modal, save, reload, toggle status, duplicate — no raw target_offer_id input ever visible [RETIRED: per-variant rules UI deleted by the P3b board rewrite; covered by leadgen-rework-p3b-rules.gesture.spec.ts]", async ({ page }) => {
    // 3 save+reload round trips (initial / disable / re-enable) PLUS the
    // duplicate leg against a real wrangler-dev server — comfortably under
    // 120s individually, but the conductor's coherence + duplicate-endpoint
    // extensions add enough of them that the original 120s budget is tight.
    test.setTimeout(240_000);
    page.on("dialog", (d) => d.accept());
    await page.goto(`/admin/leadgen/quotes/${seed.quotePublicId}/edit`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#lg-routing-rules-root")).toBeVisible();
    // A brand-new variant has ZERO rules yet — its ONE hidden-carrier row
    // lives only inside <template id="lg-rule-row-tpl"> (inert content, not
    // part of the queryable DOM), so there is nothing to assert absence/
    // invisibility of until at least one real rule row exists (checked below,
    // right after the first rule is authored).

    // --- open the "+ New rule" modal -----------------------------------------
    await page.locator("#lg-rule-new").click();
    const modal = page.locator("#lg-rule-modal");
    await expect(modal).toBeVisible();

    await modal.locator("#lg-modal-rule-name").fill("Kissterra 65+");
    await modal.locator("#lg-modal-priority").fill("2");
    // Rework M3: route_funnel_variant no longer exists in leadgen_funnel_rules
    // (CHECK narrowed to redirect_direct_offer|eligibility|disqualification|
    // auction_entry) — eligibility is the vehicle here since this test's real
    // point is the modal/conditions/checkpoint/save/toggle/duplicate MACHINERY,
    // not the specific action type. eligibility's action panel has no extra
    // fields ("the conditions below decide who is eligible" — ui-rules-builder.ts
    // renderActionPanels), so there is no target picker to fill.
    await modal.locator("#lg-modal-rule-type").selectOption("eligibility");
    // ANY/ALL default stays "ALL of the following" (match_mode -> NULL on
    // save, the migration's documented default) — left untouched here.

    // --- conditions: UTM source is facebook AND age is at least 65 ----------
    const conditionsMount = modal.locator("#lg-modal-conditions-mount");
    await conditionsMount.getByRole("button", { name: "+ Add condition" }).click();
    await conditionsMount.locator(".lg-rb-field").nth(0).selectOption("utm_source");
    await conditionsMount.locator(".lg-rb-op").nth(0).selectOption("eq");
    await conditionsMount.locator(".lg-rb-value").nth(0).fill("facebook");

    await conditionsMount.getByRole("button", { name: "+ Add condition" }).click();
    await conditionsMount.locator(".lg-rb-field").nth(1).selectOption("age");
    await conditionsMount.locator(".lg-rb-op").nth(1).selectOption("gte");
    await conditionsMount.locator(".lg-rb-value").nth(1).fill("65");

    // Rework M3: checkpoint auto-derivation belonged ONLY to
    // route_funnel_variant (ui-rules-builder.ts updateCheckpointDisplay
    // gates on `ruleType === 'route_funnel_variant'`, an impossible value
    // post-rework) — relocated off this table entirely to P3b's quote-scoped
    // rules, not yet built. None of the 4 surviving types has ever had a
    // checkpoint (checkpointLabel is now unconditionally "—"), so the mirror
    // stays "—" even with a mid-funnel condition mounted.
    await expect(modal.locator("#lg-modal-checkpoint")).toHaveText("—");

    await page.screenshot({ path: `${SHOT_DIR}/p4b-modal-authored.png`, fullPage: true });
    await modal.locator("#lg-modal-save").click();
    await expect(modal).toBeHidden();

    // --- the table shows it (checkpoint retired post-rework — always "—") ---
    const row = page.locator("#lg-rules-table-body [data-rules-table-row]").first();
    await expect(row.locator("[data-row-name]")).toHaveText("Kissterra 65+");
    await expect(row.locator("[data-row-priority]")).toHaveText("2");
    await expect(row.locator("[data-row-checkpoint]")).toHaveText("—");
    await expect(row.locator("[data-row-type]")).toHaveText("Eligibility");
    await expect(row.locator("[data-row-status-pill]")).toHaveText("Active");

    // --- SAVE the variant (the real §15.5/P4b replace-set PUT) --------------
    const putPromise = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes(`/variants/${seed.variantAId}`));
    await page.locator("#lg-variant-save").click();
    const put = await putPromise;
    expect(put.status(), `variant PUT: ${await put.text()}`).toBe(200);
    await expect(page.locator("#lg-quote-ok")).toContainText("Saved", { timeout: 20_000 });

    const putBody = put.request().postDataJSON() as { rules: Array<Record<string, unknown>> };
    const sentRule = putBody.rules.find((r) => r["rule_name"] === "Kissterra 65+");
    expect(sentRule, "the rule rode the PUT payload").toBeTruthy();
    expect(sentRule!["rule_type"]).toBe("eligibility");
    expect(sentRule!["priority"]).toBe(2);

    // --- the legacy raw target_offer_id input is never VISIBLE ---------------
    // (now that a REAL rule row exists in #lg-rule-list — the ONLY carrier
    // before this point lived inert inside <template>, unreachable by normal
    // selectors). It survives only as a HIDDEN wire-format carrier for
    // collectRules()/pre-existing-test compatibility (see ui-quotes.ts
    // renderRuleRow's P4b doc comment) — "eliminate the legacy input" is an
    // OPERATOR-visibility contract, not a DOM-absence claim.
    const legacyOfferInputs = page.locator("[data-rule-target-offer]");
    const legacyCount = await legacyOfferInputs.count();
    expect(legacyCount, "the just-saved rule's hidden carrier exists").toBeGreaterThan(0);
    for (let i = 0; i < legacyCount; i++) {
      await expect(legacyOfferInputs.nth(i), `legacy target_offer_id input #${i} must not be visible`).not.toBeVisible();
    }

    // --- RELOAD → server-authoritative round-trip ---------------------------
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#lg-routing-rules-root")).toBeVisible();
    const row2 = page.locator("#lg-rules-table-body [data-rules-table-row]").first();
    await expect(row2.locator("[data-row-name]")).toHaveText("Kissterra 65+");
    await expect(row2.locator("[data-row-checkpoint]")).toHaveText("—");
    await expect(row2.locator("[data-row-status-pill]")).toHaveText("Active");
    await page.screenshot({ path: `${SHOT_DIR}/p4b-table-reloaded.png`, fullPage: true });
    let rulesNow = await fetchVariantRules(seed.quotePublicId, seed.variantAId);
    let stored = rulesNow.find((r) => r["rule_name"] === "Kissterra 65+")!;
    expect(stored["enabled"], `enabled coherent after initial save; row: ${JSON.stringify(stored)}`).toBe(true);
    expect(stored["status"]).toBe("active");

    // --- toggle status -> Disabled, save, reload -> persists BOTH axes -------
    // (conductor fix-round #2: prepareRules derives enabled FROM status when
    // the envelope carries status without an explicit enabled — proven here
    // server-side, not just via the client's own optimistic DOM state.)
    await row2.locator("[data-rule-toggle-status]").click();
    await expect(row2.locator("[data-row-status-pill]")).toHaveText("Disabled");
    const putPromise2 = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes(`/variants/${seed.variantAId}`));
    await page.locator("#lg-variant-save").click();
    const put2 = await putPromise2;
    expect(put2.status(), `disable PUT: ${await put2.text()}`).toBe(200);
    await page.reload({ waitUntil: "domcontentloaded" });
    const row3 = page.locator("#lg-rules-table-body [data-rules-table-row]").first();
    await expect(row3.locator("[data-row-status-pill]")).toHaveText("Disabled");
    rulesNow = await fetchVariantRules(seed.quotePublicId, seed.variantAId);
    stored = rulesNow.find((r) => r["rule_name"] === "Kissterra 65+")!;
    expect(stored["status"], `disable persists BOTH axes; row: ${JSON.stringify(stored)}`).toBe("disabled");
    expect(stored["enabled"]).toBe(false);

    // --- re-enable -> save -> reload -> restores BOTH axes -------------------
    await row3.locator("[data-rule-toggle-status]").click();
    await expect(row3.locator("[data-row-status-pill]")).toHaveText("Active");
    const putPromise3 = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes(`/variants/${seed.variantAId}`));
    await page.locator("#lg-variant-save").click();
    const put3 = await putPromise3;
    expect(put3.status(), `re-enable PUT: ${await put3.text()}`).toBe(200);
    await page.reload({ waitUntil: "domcontentloaded" });
    const row4 = page.locator("#lg-rules-table-body [data-rules-table-row]").first();
    await expect(row4.locator("[data-row-status-pill]")).toHaveText("Active");
    rulesNow = await fetchVariantRules(seed.quotePublicId, seed.variantAId);
    stored = rulesNow.find((r) => r["rule_name"] === "Kissterra 65+")!;
    expect(stored["status"], `re-enable restores BOTH axes; row: ${JSON.stringify(stored)}`).toBe("active");
    expect(stored["enabled"]).toBe(true);

    // --- Duplicate -> the SERVER endpoint actually ran (conductor #5) -------
    // The rule already has a server public_id (2 real saves so far), so the
    // client's best-effort POST /variants/:id/rules/:rule_id/duplicate fires
    // with a real id. Proven two ways: (a) the fetch itself resolves 201, and
    // (b) a RELOAD with NO further main-Save click still shows the copy —
    // that could only be true if the SERVER persisted it (the client-side DOM
    // clone alone would vanish on a fresh navigation).
    const beforeCount = await page.locator("#lg-rules-table-body [data-rules-table-row]").count();
    const dupPromise = page.waitForResponse(
      (r) => r.request().method() === "POST" && /\/rules\/.+\/duplicate$/.test(r.url()),
    );
    await row4.locator("[data-rule-duplicate]").click();
    const dupResponse = await dupPromise;
    // NOT `expect(status, \`...${await resp.text()}\`)` — the template literal
    // evaluates .text() EAGERLY regardless of whether the assertion would
    // pass, and reading the body of an already-fulfilled fetch Response a
    // second time (or after Playwright/CDP's own internal buffering finishes)
    // proved unreliable in this harness (hung past the whole test's timeout
    // even on a genuine 201). Read the body only on the failure path.
    if (dupResponse.status() !== 201) {
      throw new Error(`duplicate endpoint expected 201, got ${dupResponse.status()}: ${await dupResponse.text()}`);
    }
    await expect(page.locator("#lg-rules-table-body [data-rules-table-row]")).toHaveCount(beforeCount + 1);
    await expect(page.locator("#lg-rules-table-body [data-row-name]", { hasText: "Kissterra 65+ (copy)" })).toHaveCount(1);
    await page.screenshot({ path: `${SHOT_DIR}/p4b-duplicated.png`, fullPage: true });

    // Reload WITHOUT clicking the main Save — the copy must already be
    // server-persisted (the duplicate endpoint's own INSERT), not merely the
    // client-side DOM clone (which a fresh navigation would discard).
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#lg-rules-table-body [data-rules-table-row]")).toHaveCount(beforeCount + 1);
    await expect(page.locator("#lg-rules-table-body [data-row-name]", { hasText: "Kissterra 65+ (copy)" })).toHaveCount(1);
  });

  // RETIRED 2026-07-30 (ruling R-A) — same cause as the test above
  // (#lg-rule-new / #lg-rule-modal / [data-modal-target-offer] all render 0×
  // in src). The claim "the operator picks an offer by NAME and the correct
  // target_offer_id + redirect_pct persist — never a raw id typed by hand" is
  // asserted on the successor quote-rules rail by
  // leadgen-rework-p3b-rules.gesture.spec.ts:
  //   * by-NAME pick + persisted target: "create a rule with ALL FIVE actions
  //     → saves → row appears with its sentence" (clicks
  //     [data-qr-target-mode] [data-qr-mode="offer"], then
  //     [data-qr-target-offer].selectOption — an option list of offer NAMES);
  //   * redirect_pct as a real persisted field: the same spec's rule fixtures
  //     carry redirect_pct/target_offer_id through the API row shape
  //     (baseRule/echo at lines ~72/114-115, asserted in "priority change
  //     reorders the cards");
  //   * server-side rejection when no offer is picked: "pick variant -> create
  //     eligibility rule -> edit -> duplicate -> delete; server message on a
  //     validation failure" asserts the verbatim "requires target_offer_id".
  test.skip("a redirect rule authored via the offer NAME picker persists target_offer_id + redirect_pct — never a raw id the operator typed [RETIRED: per-variant rules modal deleted by the P3b board rewrite; covered by leadgen-rework-p3b-rules.gesture.spec.ts]", async ({ page }) => {
    test.setTimeout(60_000);
    page.on("dialog", (d) => d.accept());
    await page.goto(`/admin/leadgen/quotes/${seed.quotePublicId}/edit`, { waitUntil: "domcontentloaded" });

    await page.locator("#lg-rule-new").click();
    const modal = page.locator("#lg-rule-modal");
    await expect(modal).toBeVisible();
    await modal.locator("#lg-modal-rule-name").fill("Redirect to Kissterra");
    await modal.locator("#lg-modal-rule-type").selectOption("redirect_direct_offer");

    // The by-NAME offer <select> — its <option value> is the offer's NUMERIC
    // id (the wire format target_offer_id already used), but the operator
    // never TYPES that number; they pick the visible NAME.
    const offerSelect = modal.locator("[data-modal-target-offer]");
    await expect(offerSelect.locator(`option:text("${seed.offerName}")`)).toHaveCount(1);
    await offerSelect.selectOption({ label: seed.offerName });

    // Conductor fix-round #4: Redirect % is now a REAL, persisted field.
    await modal.locator("[data-modal-redirect-pct]").fill("50");

    await modal.locator("#lg-modal-save").click();
    await expect(modal).toBeHidden();

    const putPromise = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes(`/variants/${seed.variantAId}`));
    await page.locator("#lg-variant-save").click();
    const put = await putPromise;
    expect(put.status(), `redirect rule PUT: ${await put.text()}`).toBe(200);

    const putBody = put.request().postDataJSON() as { rules: Array<Record<string, unknown>> };
    const redirectRule = putBody.rules.find((r) => r["rule_name"] === "Redirect to Kissterra");
    expect(redirectRule, "the redirect rule rode the PUT payload").toBeTruthy();
    expect(redirectRule!["rule_type"]).toBe("redirect_direct_offer");
    expect(redirectRule!["target_offer_id"]).toBe(Number(seed.offerId));
    expect(redirectRule!["redirect_pct"]).toBe(50);

    // Stored truth round-trips off the structure endpoint (server-side,
    // independent of the client's own read of its just-sent payload).
    // Conductor fix-round #1 (full v2 persistence, unconditional): rule_name
    // now persists for EVERY rule type, incl. redirect_direct_offer — the
    // prior round's route_funnel_variant-only scoping is reversed now that
    // the 6 non-owned vitest files carry 0043+0044 in their migration lists.
    const rulesNow = await fetchVariantRules(seed.quotePublicId, seed.variantAId);
    const storedRule = rulesNow.find((r) => r["rule_name"] === "Redirect to Kissterra");
    expect(storedRule, `redirect rule persisted server-side; all rules: ${JSON.stringify(rulesNow)}`).toBeTruthy();
    expect(storedRule!["target_offer_id"]).toBe(Number(seed.offerId));
    expect(storedRule!["redirect_pct"]).toBe(50);
  });

  // Rework M3: skip_section (and show_section) is retired from
  // leadgen_funnel_rules with NO replacement action-type — the CHECK
  // constraint narrows to redirect_direct_offer|eligibility|disqualification|
  // auction_entry, none of which carry a target-section concept. The
  // "Section-to-skip picker" this test drove ([data-modal-target-section])
  // was part of skip_section/show_section's own action panel, which
  // ui-rules-builder.ts's renderActionPanels no longer renders at all (see
  // the 4 surviving `data-action-for` panels — none expose a section picker).
  // There is no surviving UI surface for this test to exercise; removed
  // rather than forced to pass against a mechanism that no longer exists.
  // (target_section_id itself remains a generic, non-type-gated backend
  // column — test/leadgen-p1c-lifecycle.test.ts's DELETE-guard coverage
  // still exercises it directly via the API — but no admin-UI picker sets
  // it post-rework.)
});
