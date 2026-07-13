// Section Builder v3.1 REMEDIATION — phase R1, Test C: REAL-INPUT browser proof
// (register root rule + M1: synthetic dispatchEvent is INADMISSIBLE — real
// hit-tested input only). Firefox lane (*.gesture.spec.ts → the firefox project;
// page.mouse drags complete under Juggler where CDP hangs). Boots a LIVE seeded
// funnel (the leadgen-live-funnel.spec.ts boot pattern; webServer auto-launches
// wrangler dev :8787 + the mock provider :8788) and drives, with trusted input
// only (locator.selectOption / page.mouse / locator.click — ZERO dispatchEvent):
//   * E1-NEW-4: a TwoButtonYesNo default paints its button SELECTED on entry.
//   * E1-NEW-1: selecting a dropdown option RECORDS the answer (+ an
//     answer_change beacon on the real POST /lg/track).
//   * S2-3: a REAL page.mouse drag of the slider moves the visible value text +
//     filled track AND records the dragged value (store == DOM, monotonic).

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { seedActiveSite } from "./listicles-p6-seed";
import { MOCK_PROVIDER_ENDPOINT, BANNER_URL_TEMPLATE } from "./leadgen-fix-p1-seed";

const ORIGIN = "http://127.0.0.1:8787";
const LG_API = "/api/admin/leadgen";
const REAL_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// This is the FIRST firefox-lane spec that must reach a TENANT funnel host
// (the studio/admin firefox specs use 127.0.0.1 directly). Chromium's
// --host-resolver-rules is a no-op on Firefox, so the tenant `.e2e.test` host
// (Host header preserved for the worker's site match) is mapped to loopback via
// the Firefox `network.dns.localDomains` pref instead. A DETERMINISTIC host is
// required because test.use launch prefs are resolved at collection time,
// before beforeAll mints anything; the fresh-D1 preamble makes the fixed host
// collision-free per run.
const TENANT_HOST = "lg-r1inputs.e2e.test";

test.use({
  launchOptions: { firefoxUserPrefs: { "network.dns.localDomains": TENANT_HOST } },
  userAgent: REAL_CHROME_UA,
});

async function json<T>(res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> }, label: string): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

interface SeededInputsFunnel { host: string; slug: string; variantId: string; }

// Seed a funnel with (s1) a TwoButtonYesNo DEFAULT section + (s2) a dropdown +
// slider section. Reuses the p1 offer/auction/activation flow verbatim (proven
// to activate cleanly) so activation is a clean 200; only the SECTIONS differ.
async function seedInputsFunnel(request: APIRequestContext): Promise<SeededInputsFunnel> {
  const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const host = TENANT_HOST; // deterministic (mapped to loopback by the firefox pref above)
  const placementExternalId = `plc-r1-${uniq}`;
  const siteId = await seedActiveSite(request, host, `LeadGen R1 Inputs ${uniq}`);

  const offer = await json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/offers`, {
      data: { offer_name: `R1 Offer ${uniq}`, provider: "mockprov", activity: "quote_funnel", vertical: "life", conversion_tracking_method: "s2s_postback", offer_type: "cpc", placements: [placementExternalId], calls_provider_api: true, bid_source: "response", cap_enabled: false },
    }),
    "offer create",
  );
  const detail = await json<{ placements?: Array<{ id: number; placement_id: string }> }>(await request.get(`${LG_API}/offers/${offer.id}`), "offer detail");
  const placement = (detail.placements ?? []).find((p) => p.placement_id === placementExternalId)!;
  await json(await request.patch(`${LG_API}/offers/${offer.id}`, {
    data: { endpoint_production: MOCK_PROVIDER_ENDPOINT, endpoint_staging: MOCK_PROVIDER_ENDPOINT, request_method: "POST", banner_url_template: BANNER_URL_TEMPLATE, headers: [{ header_name: "X-R1", value_kind: "static", value_text: `r1-${uniq}` }] },
  }), "offer patch");
  await json(await request.post(`${LG_API}/offers/${offer.id}/payload-schemas`, {
    data: {
      schema_json: { version: 1, root: { type: "object", children: [
        { path: "lead.homeowner_status", name: "homeowner_status", type: "string", required: true, source: "answer", internal_field: "homeowner", value_map: { true: "own", false: "rent" } },
      ] } },
      carrier_parse_json: { carriers_path: "carriers", fields: { provider_id: "id", carrier_name: "name", carrier_logo: "logo", bid: "bid", bid_currency: "currency", headline: "headline", tracking_id: "tracking" } },
    },
  }), "payload schema");
  const testRun = await json<{ status_code?: number | null }>(await request.post(`${LG_API}/offers/${offer.id}/test`, {
    data: { environment: "staging", sample_answers: { homeowner: "true" } },
  }), "offer test run");
  if (testRun.status_code != null && (testRun.status_code < 200 || testRun.status_code >= 300)) {
    throw new Error(`seed: test-tool run did not PASS (${testRun.status_code}) — is the mock provider up on :8788?`);
  }

  const quote = await json<{ id: number; public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, { data: { quote_name: `R1 Quote ${uniq}`, activity: "quote_funnel", verticals: ["life"] } }),
    "quote create",
  );
  const variantId = quote.funnels[0]!.variants[0]!.public_id;

  // s1: the DEFAULT yes/no section (E1-NEW-4). Required + mapped so activation passes.
  const s1 = await json<{ id: number }>(await request.post(`${LG_API}/sections`, {
    data: {
      section_name: `R1 s1 homeowner ${uniq}`, activity: "quote_funnel", vertical: "life",
      headline_text: "Do you own your home?", continue_mode: "auto_advance", status: "active",
      content_json: { components: [
        { type: "QuestionHeadline", question_id: "s1_head", props: { text: "Do you own your home?" } },
        { type: "TwoButtonYesNo", question_id: "q_homeowner", question_key: "homeowner_yn", internal_field: "homeowner", answer_type: "boolean", props: { yesLabel: "Yes, I own", noLabel: "No, I rent", auto_advance: true, defaultValue: "true" } },
      ] },
      selected_offers: [offer.id],
      answer_maps: [{ question_id: "q_homeowner", offer_id: offer.id, offer_payload_field_path: "lead.homeowner_status", provider_expected_type: "string", required_for_offer: true, internal_field: "homeowner", answer_type: "boolean", output_value_map: { true: "own", false: "rent" } }],
    },
  }), "section 1");

  // s2: the DROPDOWN + SLIDER section (E1-NEW-1 + S2-3). continue_mode so the
  // page stays put while we interact; neither field is required/mapped.
  const s2 = await json<{ id: number }>(await request.post(`${LG_API}/sections`, {
    data: {
      section_name: `R1 s2 inputs ${uniq}`, activity: "quote_funnel", vertical: "life",
      headline_text: "Tell us about the loan", continue_mode: "button", status: "active",
      content_json: { components: [
        { type: "BackButton", question_id: "s2_back" },
        { type: "QuestionHeadline", question_id: "s2_head", props: { text: "Tell us about the loan" } },
        { type: "DropdownQuestion", question_id: "q_coverage", question_key: "coverage_q", internal_field: "coverage", answer_type: "enum",
          choices: [{ label: "Auto", value: "auto", analytics_id: "cov_auto" }, { label: "Home", value: "home", analytics_id: "cov_home" }],
          props: { placeholder: "Select coverage" } },
        { type: "RangeQuestion", question_id: "q_loan", question_key: "loan_q", internal_field: "loan_amount", answer_type: "number",
          props: { min: 0, max: 100000, step: 5000, default: 0, currency: "$", format: "currency" } },
        { type: "ContinueButton", question_id: "s2_continue", props: { label: "See my quotes" } },
      ] },
    },
  }), "section 2");

  const auction = await json<{ id: number }>(await request.post(`${LG_API}/auctions`, {
    data: { auction_name: `R1 Auction ${uniq}`, quote_id: quote.id, auction_type: "dynamic", winner_logic: "highest_bid", floor_type: "percentage_of_max", floor_value: 10, multi_offer: "enabled", banner_slots_count: 5, max_carriers_per_offer: 3, max_total_carriers: 10, timeout_ms: 2500, status: "active" },
  }), "auction");
  await json(await request.put(`${LG_API}/auctions/${auction.id}/offers`, { data: { offers: [{ offer_placement_id: placement.id, static_order: 0 }] } }), "auction offers");
  await json(await request.put(`${LG_API}/variants/${variantId}`, { data: { auction_id: auction.id, sections: [{ section_id: s1.id, position: 0 }, { section_id: s2.id, position: 1 }] } }), "variant");

  const slug = `r1-inputs-${uniq}`;
  const act = await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug } });
  if (!act.ok()) throw new Error(`seed: activation blocked HTTP ${act.status()} — ${await act.text()}`);
  return { host, slug, variantId };
}

let seeded: SeededInputsFunnel;
test.beforeAll(async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  seeded = await seedInputsFunnel(ctx);
  await ctx.dispose();
});

function shellUrl(): string { return `http://${seeded.host}:8787/lg/${seeded.slug}`; }
function sectionAt(page: Page, i: number) { return page.locator(`[data-lg-section][data-lg-index="${i}"]`); }

type TrackedEvent = Record<string, unknown>;
async function installTrackCapture(page: Page): Promise<TrackedEvent[]> {
  const events: TrackedEvent[] = [];
  await page.addInitScript(() => {
    try { delete (Navigator.prototype as unknown as Record<string, unknown>)["sendBeacon"]; } catch { /* sealed */ }
    try { Object.defineProperty(navigator, "sendBeacon", { get: () => undefined }); } catch { /* keep */ }
  });
  page.on("request", (req) => {
    if (req.method() !== "POST" || !req.url().includes("/lg/track")) return;
    const body = req.postData();
    if (body === null) return;
    try { const p = JSON.parse(body) as { events?: TrackedEvent[] }; if (Array.isArray(p.events)) events.push(...p.events); } catch { /* ignore */ }
  });
  return events;
}
function ofType(events: TrackedEvent[], type: string): TrackedEvent[] { return events.filter((e) => e["event_type"] === type); }

async function gotoReady(page: Page): Promise<void> {
  await page.goto(shellUrl(), { waitUntil: "load" });
  await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 10_000 });
}
function answers(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => (window as unknown as { __LG_ENGINE__?: { getAnswers(): Record<string, unknown> } }).__LG_ENGINE__?.getAnswers() ?? {});
}

test.describe("R1 Test C — real-input runtime answer integrity (firefox)", () => {
  test("E1-NEW-4: the TwoButtonYesNo default renders SELECTED on section entry (no click)", async ({ page }) => {
    await gotoReady(page);
    const yes = sectionAt(page, 0).locator('[data-lg-choice="true"]');
    await expect(yes).toBeVisible();
    // The default_applied answer paints the button selected on entry.
    await expect(yes).toHaveClass(/lg-selected/);
    await expect(yes).toHaveAttribute("aria-pressed", "true");
    await expect(sectionAt(page, 0).locator('[data-lg-choice="false"]')).not.toHaveClass(/lg-selected/);
  });

  test("E1-NEW-1: selecting a dropdown option RECORDS the answer + fires answer_change", async ({ page }) => {
    const events = await installTrackCapture(page);
    await gotoReady(page);
    // advance to s2 (real click on the default yes → auto_advance)
    await sectionAt(page, 0).locator('[data-lg-choice="true"]').click();
    await expect(sectionAt(page, 1)).toBeVisible();

    const select = sectionAt(page, 1).locator("select.lg-dropdown");
    await expect(select).toBeVisible();
    await select.selectOption("home"); // trusted native selection (real change)

    // recorded into the engine store…
    await expect.poll(async () => (await answers(page))["coverage"]).toBe("home");
    // …and a REAL answer_change beacon rode POST /lg/track for this field.
    await expect
      .poll(() => ofType(events, "answer_change").filter((e) => e["internal_field"] === "coverage").length, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(1);
  });

  test("S2-3: a REAL page.mouse slider drag moves the visible value + fill AND records the value", async ({ page }) => {
    await gotoReady(page);
    await sectionAt(page, 0).locator('[data-lg-choice="true"]').click();
    await expect(sectionAt(page, 1)).toBeVisible();

    const wrap = sectionAt(page, 1).locator(".lg-range");
    const rangeInput = wrap.locator('input[type="range"]');
    await expect(rangeInput).toBeVisible();

    // initial paint: default 0 → "$0", fill 0%
    const valueEl = wrap.locator(".lg-range-value");
    const fillEl = wrap.locator(".lg-range-fill");
    const beforeText = (await valueEl.textContent())?.trim() ?? "";
    expect(beforeText).toBe("$0");

    // REAL drag: page.mouse from ~10% to ~75% of the track width (Firefox).
    const box = (await rangeInput.boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.1, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.4, y);
    await page.mouse.move(box.x + box.width * 0.75, y);
    await page.mouse.up();

    // The recorded value equals the input's live value (store == DOM), and is a
    // real increase from the 0 default (a genuine drag effect, not a bare delta).
    await expect.poll(async () => {
      const domValue = await rangeInput.inputValue();
      const stored = String((await answers(page))["loan_amount"] ?? "");
      return domValue !== "0" && domValue === stored;
    }).toBe(true);
    const stored = Number((await answers(page))["loan_amount"]);
    expect(stored).toBeGreaterThan(0);

    // the visible value text + fill width both moved off their initial state.
    const afterText = (await valueEl.textContent())?.trim() ?? "";
    expect(afterText).not.toBe("$0");
    expect(afterText).toBe(`$${stored.toLocaleString("en-US")}`); // byte-identical to server formatRangeValue
    const fillWidth = await fillEl.evaluate((el) => (el as HTMLElement).style.width);
    expect(fillWidth).not.toBe("0%");
    expect(fillWidth).not.toBe("");
  });
});
