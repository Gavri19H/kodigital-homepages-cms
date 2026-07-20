// LeadGen Round-4 Remediation — Phase P4b probe spec (temporary; final
// consolidation lands in P7). Drives the REAL unified routing-rules builder
// (ui-quotes.ts renderRulesPanel + ui-rules-builder.ts renderRoutingRulesPanel/
// ROUTING_RULES_SCRIPT) end to end with real fill/click/select (ZERO
// dispatchEvent):
//   * open the funnel builder tab, confirm the rules panel is embedded there
//     (right column) and the standalone "Rules" top tab is GONE;
//   * "+ New rule" → the Image42-shaped modal → author a routing rule (name,
//     priority, ANY/ALL match mode default, conditions: UTM source is X AND
//     an age answer at least 65, action: route to funnel variant B) → Save →
//     the table row shows it with the checkpoint AUTO-DERIVED (the age
//     condition maps to the age question's page — "Page 2");
//   * SAVE the variant (the real §15.5/P4b replace-set PUT) → RELOAD → the
//     rule (incl. the server-authoritative checkpoint_page) round-trips;
//   * toggle status → Disabled → Save → reload → persists;
//   * Duplicate → a "(copy)"-suffixed row appears;
//   * the legacy raw target_offer_id input is never VISIBLE anywhere in the
//     panel (it survives only as a hidden wire-format carrier — see ui-
//     quotes.ts renderRuleRow's P4b doc comment);
//   * a redirect_direct_offer rule authored via the offer NAME picker
//     persists the CORRECT target_offer_id (never a raw id the operator typed).
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
  variantBId: string; // fork target — the route_funnel_variant destination
  variantBLabel: string;
  introSectionId: string;
  ageSectionId: string;
  ageSectionNumericId: string; // numeric id, as a string (the by-name section picker's <option value>)
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

  // Two pages: page 1 = intro (entry-known-only checkpoint), page 2 = the age
  // question — deriveRuleCheckpointPage maps a rule conditioned on `age` to
  // page index 1 ("Page 2" in the operator-facing display).
  const pagesPut = await request.put(`${LG_API}/variants/${variantAId}`, {
    data: {
      pages: [
        { name: "Intro", slots: [{ kind: "fixed", section_id: introSection.public_id }] },
        { name: "Age", slots: [{ kind: "fixed", section_id: ageSection.public_id }] },
      ],
    },
  });
  if (!pagesPut.ok()) throw new Error(`seed pages HTTP ${pagesPut.status()}: ${await pagesPut.text()}`);

  // Variant B — the route_funnel_variant target (a fork of the control; forks
  // land ACTIVE, satisfying resolver.ts's getActiveVariantByIdOnFunnel gate).
  const fork = await json<{ public_id: string; variant_label: string }>(
    await request.post(`${LG_API}/variants/${variantAId}/fork`),
    "fork variant B",
  );

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
    variantBId: fork.public_id,
    variantBLabel: fork.variant_label,
    introSectionId: introSection.public_id,
    ageSectionId: ageSection.public_id,
    ageSectionNumericId: String(ageSection.id),
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

  test("standalone Rules tab is gone; the panel is embedded in the Funnel builder tab's right column", async ({ page }) => {
    await page.goto(`/admin/leadgen/quotes/${seed.quotePublicId}/edit`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".lg-qtabs [data-tab='builder']")).toBeVisible();
    // The five-tab era's standalone Rules tab/panel no longer exist.
    await expect(page.locator(".lg-qtabs [data-tab='rules']")).toHaveCount(0);
    await expect(page.locator("[data-panel='rules']")).toHaveCount(0);
    // The unified table+modal is inside the ACTIVE builder panel's right column.
    const builderPanel = page.locator("[data-panel='builder'].active");
    await expect(builderPanel.locator("#lg-routing-rules-root")).toBeVisible();
    await expect(builderPanel.locator("#lg-inspector-column #lg-routing-rules-root")).toHaveCount(1);
  });

  test("author a routing rule through the modal, save, reload, toggle status, duplicate — no raw target_offer_id input ever visible", async ({ page }) => {
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
    await modal.locator("#lg-modal-rule-type").selectOption("route_funnel_variant");
    // ANY/ALL default stays "ALL of the following" (match_mode -> NULL on
    // save, the migration's documented default) — left untouched here.
    await modal.locator("[data-modal-target-variant]").selectOption(seed.variantBId);

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

    // The checkpoint mirror recomputes live (client-side, resolver.ts-parity
    // formula) the instant the age condition names a mid-funnel field.
    await expect(modal.locator("#lg-modal-checkpoint")).toHaveText("Page 2");

    await page.screenshot({ path: `${SHOT_DIR}/p4b-modal-authored.png`, fullPage: true });
    await modal.locator("#lg-modal-save").click();
    await expect(modal).toBeHidden();

    // --- the table shows it, checkpoint auto-derived -------------------------
    const row = page.locator("#lg-rules-table-body [data-rules-table-row]").first();
    await expect(row.locator("[data-row-name]")).toHaveText("Kissterra 65+");
    await expect(row.locator("[data-row-priority]")).toHaveText("2");
    await expect(row.locator("[data-row-checkpoint]")).toHaveText("Page 2");
    await expect(row.locator("[data-row-type]")).toHaveText("Route to a different funnel");
    await expect(row.locator("[data-row-status-pill]")).toHaveText("Active");

    // --- SAVE the variant (the real §15.5/P4b replace-set PUT) --------------
    const putPromise = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes(`/variants/${seed.variantAId}`));
    await page.locator("#lg-variant-save").click();
    const put = await putPromise;
    expect(put.status(), `variant PUT: ${await put.text()}`).toBe(200);
    await expect(page.locator("#lg-quote-ok")).toContainText("Saved", { timeout: 20_000 });

    const putBody = put.request().postDataJSON() as { rules: Array<Record<string, unknown>> };
    const sentRule = putBody.rules.find((r) => r["rule_name"] === "Kissterra 65+");
    expect(sentRule, "the routing rule rode the PUT payload").toBeTruthy();
    expect(sentRule!["rule_type"]).toBe("route_funnel_variant");
    expect(sentRule!["target_funnel_variant_id"]).toBe(seed.variantBId);
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

    // --- RELOAD → server-authoritative round-trip (incl. checkpoint_page) ---
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#lg-routing-rules-root")).toBeVisible();
    const row2 = page.locator("#lg-rules-table-body [data-rules-table-row]").first();
    await expect(row2.locator("[data-row-name]")).toHaveText("Kissterra 65+");
    await expect(row2.locator("[data-row-checkpoint]")).toHaveText("Page 2");
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

  test("a redirect rule authored via the offer NAME picker persists target_offer_id + redirect_pct — never a raw id the operator typed", async ({ page }) => {
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

  test("a skip_section rule authored with a name round-trips it (conductor fix-round #1: full v2 persistence for every rule type)", async ({ page }) => {
    test.setTimeout(60_000);
    page.on("dialog", (d) => d.accept());
    await page.goto(`/admin/leadgen/quotes/${seed.quotePublicId}/edit`, { waitUntil: "domcontentloaded" });

    await page.locator("#lg-rule-new").click();
    const modal = page.locator("#lg-rule-modal");
    await expect(modal).toBeVisible();
    await modal.locator("#lg-modal-rule-name").fill("Skip the age question");
    await modal.locator("#lg-modal-rule-type").selectOption("skip_section");

    // Section-to-skip picker — the operator sees/picks the section by its
    // NAME (never types a raw id); the option's underlying value is the
    // section's numeric id (the existing target_section_id wire format), so
    // the test selects by that value for a robust, unambiguous match while
    // first confirming the NAME is genuinely what's rendered in the option.
    const sectionSelect = modal.locator("[data-modal-target-section]");
    await expect(sectionSelect.locator(`option[value="${seed.ageSectionNumericId}"]`)).toHaveText(new RegExp("^Age question"));
    await sectionSelect.selectOption(seed.ageSectionNumericId);

    await modal.locator("#lg-modal-save").click();
    await expect(modal).toBeHidden();

    const row = page.locator("#lg-rules-table-body [data-row-name]", { hasText: "Skip the age question" });
    await expect(row).toHaveCount(1);

    const putPromise = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes(`/variants/${seed.variantAId}`));
    await page.locator("#lg-variant-save").click();
    const put = await putPromise;
    expect(put.status(), `skip_section rule PUT: ${await put.text()}`).toBe(200);
    const putBody = put.request().postDataJSON() as { rules: Array<Record<string, unknown>> };
    const sentRule = putBody.rules.find((r) => r["rule_name"] === "Skip the age question");
    expect(sentRule, "the skip_section rule rode the PUT payload").toBeTruthy();
    expect(sentRule!["target_section_id"], "target_section_id (a NEW P4b collection — no admin picker existed for it before)").toBe(Number(seed.ageSectionNumericId));

    // RELOAD → the name (previously silently dropped for non-routing types)
    // now round-trips off the SSR'd table, straight from server data.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#lg-rules-table-body [data-row-name]", { hasText: "Skip the age question" })).toHaveCount(1);

    const rulesNow = await fetchVariantRules(seed.quotePublicId, seed.variantAId);
    const stored = rulesNow.find((r) => r["rule_name"] === "Skip the age question");
    expect(stored, `skip_section rule persisted with its name; all rules: ${JSON.stringify(rulesNow)}`).toBeTruthy();
    expect(stored!["rule_type"]).toBe("skip_section");
    expect(stored!["target_section_id"]).toBe(Number(seed.ageSectionNumericId));
    expect(stored!["status"]).toBe("active");
    expect(stored!["enabled"]).toBe(true);
  });
});
