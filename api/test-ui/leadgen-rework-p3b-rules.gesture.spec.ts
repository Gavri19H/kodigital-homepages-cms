// LeadGen Rework P3b (slice S3b.2) — the QUOTE-scoped routing-rules RAIL, driven
// with REAL browser input (L-189) on the ACTUAL island (QUOTE_RULES_SCRIPT) +
// the ACTUAL condition builder (RULES_BUILDER_SCRIPT / window.lgRulesBuilder).
//
// The rail renders behind an interface (quotes-tabs/funnel.ts, S3b.1, mounts it
// at the board's 344px [data-rules-rail]). To PROVE the island's gestures for
// THIS slice without coupling to that in-flight board, the spec builds the rail
// with the real renderQuoteRulesRail() SSR, injects the two real island scripts
// via setContent, and stands up an in-memory mock of the LANDED CRUD API
// (GET/POST /quotes/:id/routing-rules, PATCH/DELETE + duplicate
// /routing-rules/:rule_id). Every click/fill/select is real input; only the
// D1-backed API is mocked (it is proven server-side by the quotes-handlers
// suites). Runs on both configured engines.
//
// Proves: create a rule with ALL FIVE actions -> saves -> row appears with its
// plain-language sentence; edit -> checkpoint updates live as conditions change
// (entry -> shared -> in-funnel -> unreachable A-6); duplicate; enable/disable;
// delete; priority change reorders; A-11 on zero actions; the rail fits 1280
// (no horizontal overflow) with 1280 + 375 screenshots.

import { test, expect, type Page, type Route } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  renderQuoteRulesRail,
  QUOTE_RULES_SCRIPT,
  RULES_BUILDER_SCRIPT,
  type QuoteRulesRailData,
  type QuoteRulesRailRule,
} from "../src/admin/leadgen/ui-rules-builder";

const SHOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "__screenshots__", "rework-p3b-rules");
mkdirSync(SHOT_DIR, { recursive: true });

const QUOTE_PUB = "lgq_demo";

const FUNNELS = [
  { id: 1, public_id: "lgf_auto", name: "Auto Insurance", is_default: true, pages: [{ position: 1, fields: ["zip"] }, { position: 2, fields: ["coverage"] }] },
  { id: 2, public_id: "lgf_home", name: "Home Insurance", is_default: false, pages: [{ position: 1, fields: ["homeowner"] }] },
];
const ANSWER_FIELDS = [
  { internal_field: "zip", label: "ZIP code" },
  { internal_field: "coverage", label: "Coverage type" },
  { internal_field: "homeowner", label: "Home owner" },
];
const OFFERS = [{ id: 10, name: "Kissterra" }];
const SHARED_FIELDS = ["zip"];

function baseRule(over: Partial<QuoteRulesRailRule>): QuoteRulesRailRule {
  return {
    public_id: "lgqr_seed",
    rule_name: "Seed rule",
    priority: 50,
    status: "active",
    match_mode: "all",
    conditions_json: { groups: [{ field: "device", op: "eq", value: "desktop" }] },
    target_funnel_id: 1,
    feed_name: null,
    value_multiplier: null,
    redirect_pct: null,
    target_offer_id: null,
    redirect_url: null,
    redirect_url_allowlisted: false,
    ...over,
  };
}

function railData(rules: QuoteRulesRailRule[]): QuoteRulesRailData {
  return {
    quote_public_id: QUOTE_PUB,
    rules,
    funnels: FUNNELS,
    default_funnel_id: 1,
    shared_page_fields: SHARED_FIELDS,
    answer_fields: ANSWER_FIELDS,
    offers: OFFERS,
    feed_values: ["long_pii", "short", "medium"],
  };
}

// Public funnel id -> numeric id (mirrors the server's resolveFunnelRow leg).
function funnelIdOf(pub: unknown): number | null {
  const f = FUNNELS.find((x) => x.public_id === pub);
  return f ? f.id : null;
}

// The island posts action fields; the mock echoes them back in the API row
// shape (target_funnel_id numeric, conditions_json object, allowlisted boolean).
function toRow(store: QuoteRulesRailRule[], body: Record<string, unknown>, existing?: QuoteRulesRailRule): QuoteRulesRailRule {
  const base = existing ?? baseRule({});
  const nextPub = existing ? existing.public_id : "lgqr_" + String(store.length + 1) + "_" + String(Date.now() % 100000);
  return {
    public_id: nextPub,
    rule_name: typeof body.rule_name === "string" ? body.rule_name : base.rule_name,
    priority: typeof body.priority === "number" ? body.priority : base.priority,
    status: body.status === "disabled" ? "disabled" : body.status === "active" ? "active" : base.status,
    match_mode: typeof body.match_mode === "string" ? (body.match_mode as string) : base.match_mode,
    conditions_json: "conditions_json" in body ? body.conditions_json : base.conditions_json,
    target_funnel_id: "target_funnel_id" in body ? funnelIdOf(body.target_funnel_id) : base.target_funnel_id,
    feed_name: "feed_name" in body ? ((body.feed_name as string) || null) : base.feed_name,
    value_multiplier: "value_multiplier" in body ? ((body.value_multiplier as number) ?? null) : base.value_multiplier,
    redirect_pct: "redirect_pct" in body ? ((body.redirect_pct as number) ?? null) : base.redirect_pct,
    target_offer_id: "target_offer_id" in body ? ((body.target_offer_id as number) ?? null) : base.target_offer_id,
    redirect_url: "redirect_url" in body ? ((body.redirect_url as string) || null) : base.redirect_url,
    redirect_url_allowlisted: "redirect_url" in body ? !!body.redirect_url : base.redirect_url_allowlisted,
  };
}

// Mount the rail on a blank page with the real island scripts + a mocked API
// over an in-memory rule store (seeded to match the SSR blob).
async function mountRail(page: Page, seed: QuoteRulesRailRule[]): Promise<{ store: QuoteRulesRailRule[] }> {
  const store: QuoteRulesRailRule[] = seed.map((r) => ({ ...r }));
  page.on("dialog", (d) => void d.accept()); // window.confirm on delete

  await page.route("**/api/admin/leadgen/**", async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const json = (body: unknown, status = 200): Promise<void> =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    // GET list
    if (method === "GET" && /\/routing-rules$/.test(path)) {
      return json({ items: store.map((r) => ({ ...r })) });
    }
    // POST create
    if (method === "POST" && /\/routing-rules$/.test(path)) {
      const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      const row = toRow(store, body);
      store.push(row);
      return json(row, 201);
    }
    // POST duplicate
    const dup = path.match(/\/routing-rules\/([^/]+)\/duplicate$/);
    if (method === "POST" && dup) {
      const src = store.find((r) => r.public_id === dup[1]);
      if (src) store.push({ ...src, public_id: src.public_id + "_copy", rule_name: src.rule_name + " (copy)" });
      return json({ ok: true });
    }
    // PATCH update
    const patch = path.match(/\/routing-rules\/([^/]+)$/);
    if (method === "PATCH" && patch) {
      const idx = store.findIndex((r) => r.public_id === patch[1]);
      if (idx >= 0) store[idx] = toRow(store, (req.postDataJSON() ?? {}) as Record<string, unknown>, store[idx]);
      return json(store[idx] ?? {});
    }
    // DELETE
    if (method === "DELETE" && patch) {
      const idx = store.findIndex((r) => r.public_id === patch[1]);
      if (idx >= 0) store.splice(idx, 1);
      return json({ ok: true });
    }
    return json({ error: "unhandled " + method + " " + path }, 500);
  });

  // Navigate to the configured baseURL first so the page has a real origin —
  // the island fetches RELATIVE /api/... URLs, which need a base to resolve and
  // for page.route to intercept (a setContent-only page sits at about:blank).
  await page.goto("/");
  const html = renderQuoteRulesRail(railData(store));
  const doc =
    "<!doctype html><html><head><meta charset=\"utf-8\"><style>body{margin:0}#wrap{display:flex}#rail{flex:0 0 344px;width:344px;height:640px;border-left:1px solid #ccc}</style></head>" +
    "<body><div id=\"wrap\"><div style=\"flex:1 1 auto\"></div><div id=\"rail\">" +
    html +
    "</div></div>" +
    "<script>" + RULES_BUILDER_SCRIPT + "</script>" +
    "<script>" + QUOTE_RULES_SCRIPT + "</script>" +
    "</body></html>";
  await page.setContent(doc, { waitUntil: "load" });
  await expect(page.locator("#lg-qr-rail")).toBeVisible();
  return { store };
}

// Enable/disable an action row's toggle to a desired state.
async function setAction(page: Page, pin: string, on: boolean): Promise<void> {
  const row = page.locator(`[data-pin="${pin}"]`);
  const sw = row.locator("[data-qr-action-toggle]");
  const isOn = (await sw.getAttribute("aria-checked")) === "true";
  if (isOn !== on) await sw.click();
}

test.describe("P3b quote-rules rail — real-input gestures", () => {
  test("create a rule with ALL FIVE actions → saves → row appears with its sentence", async ({ page }) => {
    const { store } = await mountRail(page, []);
    await expect(page.locator("[data-qr-card]")).toHaveCount(0);

    await page.locator("[data-qr-new]").click();
    await expect(page.locator("#lg-qr-modal")).toBeVisible();
    await page.locator("[data-qr-modal-name]").fill("Premium desktop leads");
    await page.locator("[data-qr-modal-priority]").fill("2");

    // all five actions ON
    await setAction(page, "action-target-funnel", true);
    await page.locator("[data-qr-target-funnel]").selectOption("lgf_auto");
    await setAction(page, "action-feed-name", true);
    await page.locator("[data-qr-feed-name]").fill("long_pii");
    await setAction(page, "action-fb-multiplier", true);
    await page.locator("[data-qr-multiplier]").fill("0.2");
    await setAction(page, "action-redirect-pct", true);
    await page.locator("[data-qr-redirect-pct]").fill("100");
    await setAction(page, "action-redirect-target", true);
    await page.locator('[data-qr-target-mode] [data-qr-mode="offer"]').click();
    await page.locator("[data-qr-target-offer]").selectOption("10");

    // sentence preview reflects the draft live (action phrase for the target funnel)
    await expect(page.locator("[data-qr-sentence]")).toContainText("Auto Insurance");

    await page.locator("[data-qr-save]").click();
    await expect(page.locator("#lg-qr-modal")).toBeHidden();

    const card = page.locator("[data-qr-card]");
    await expect(card).toHaveCount(1);
    await expect(card.locator("[data-qr-name]")).toHaveText("Premium desktop leads");
    // all five actions summarised on the card
    const acts = card.locator("[data-qr-act-summ]");
    await expect(acts).toContainText("→ Auto Insurance");
    await expect(acts).toContainText("Feed long_pii");
    await expect(acts).toContainText("×0.2");
    await expect(acts).toContainText("Redirect 100% → Kissterra");
    expect(store.length).toBe(1);
  });

  test("edit → the read-only checkpoint updates live: entry → shared → in-funnel → unreachable (A-6)", async ({ page }) => {
    await mountRail(page, [baseRule({ public_id: "lgqr_seed", conditions_json: { groups: [{ field: "device", op: "eq", value: "desktop" }] } })]);
    await page.locator("[data-qr-edit]").first().click();
    await expect(page.locator("#lg-qr-modal")).toBeVisible();

    const ckpt = page.locator("[data-qr-modal-checkpoint]");
    const a6 = page.locator("[data-qr-modal-a6]");

    // entry (device only)
    await expect(ckpt).toHaveText("Entry");
    await expect(a6).toBeHidden();

    // drive the REAL condition builder (window.lgRulesBuilder mounts a row whose
    // field <select> carries the class lg-rb-field — the island builds it via
    // createElement, so it is a class, not the SSR-only data-attribute).
    // shared (zip is collected by the shared page)
    const fieldSel = page.locator("#lg-qr-cond-mount .lg-rb-field").first();
    await fieldSel.selectOption("zip");
    await expect(ckpt).toHaveText("Shared page");
    await expect(a6).toBeHidden();

    // in-funnel (coverage is only inside funnel Auto, page 2)
    await fieldSel.selectOption("coverage");
    await expect(ckpt).toHaveText("In funnel Auto Insurance — page 2");
    await expect(a6).toBeHidden();

    // unreachable (a field no funnel collects — via the builder's custom-field
    // escape; the real .fill() fires the input the builder listens for)
    await fieldSel.selectOption("__lgcustom__");
    await page.locator("#lg-qr-cond-mount .lg-rb-field-custom").first().fill("ghost_field");
    await expect(ckpt).toHaveText("In a funnel");
    await expect(a6).toBeVisible();
    await expect(a6).toContainText("This rule can never apply before a visitor enters a funnel that asks these questions.");
  });

  test("A-11: saving with zero actions shows the verbatim error and does not save", async ({ page }) => {
    const { store } = await mountRail(page, []);
    await page.locator("[data-qr-new]").click();
    // the A-11 error starts hidden (guards against a CSS [hidden]-override false pass)
    await expect(page.locator("[data-qr-action-error]")).toBeHidden();
    await page.locator("[data-qr-modal-name]").fill("No actions");
    for (const pin of ["action-target-funnel", "action-feed-name", "action-fb-multiplier", "action-redirect-pct", "action-redirect-target"]) {
      await setAction(page, pin, false);
    }
    await page.locator("[data-qr-save]").click();
    await expect(page.locator("[data-qr-action-error]")).toBeVisible();
    await expect(page.locator("[data-qr-action-error]")).toContainText("Pick at least one action for this rule.");
    await expect(page.locator("#lg-qr-modal")).toBeVisible(); // still open — not saved
    expect(store.length).toBe(0);
  });

  test("duplicate adds a copy; enable/disable flips status; delete removes the row", async ({ page }) => {
    await mountRail(page, [baseRule({ public_id: "lgqr_seed", rule_name: "Seed rule", status: "active" })]);
    await expect(page.locator("[data-qr-card]")).toHaveCount(1);

    // duplicate
    await page.locator("[data-qr-duplicate]").first().click();
    await expect(page.locator("[data-qr-card]")).toHaveCount(2);

    // disable the first card's toggle
    const firstToggle = page.locator("[data-qr-card]").first().locator("[data-qr-toggle]");
    await expect(firstToggle).toHaveAttribute("aria-checked", "true");
    await firstToggle.click();
    await expect(page.locator("[data-qr-card]").first().locator("[data-qr-toggle]")).toHaveAttribute("aria-checked", "false");

    // delete one → back to 1
    await page.locator("[data-qr-card]").first().locator("[data-qr-delete]").click();
    await expect(page.locator("[data-qr-card]")).toHaveCount(1);
  });

  test("priority change reorders the cards (lower number first)", async ({ page }) => {
    await mountRail(page, [
      baseRule({ public_id: "lgqr_a", rule_name: "Rule A", priority: 5 }),
      baseRule({ public_id: "lgqr_b", rule_name: "Rule B", priority: 10 }),
    ]);
    // initial order A(5), B(10)
    await expect(page.locator("[data-qr-card] [data-qr-name]").nth(0)).toHaveText("Rule A");
    await expect(page.locator("[data-qr-card] [data-qr-name]").nth(1)).toHaveText("Rule B");

    // edit Rule A → priority 20 (now lowest) → reorders to B, A
    await page.locator('[data-rule-public-id="lgqr_a"] [data-qr-edit]').click();
    await page.locator("[data-qr-modal-priority]").fill("20");
    await page.locator("[data-qr-save]").click();
    await expect(page.locator("#lg-qr-modal")).toBeHidden();

    await expect(page.locator("[data-qr-card] [data-qr-name]").nth(0)).toHaveText("Rule B");
    await expect(page.locator("[data-qr-card] [data-qr-name]").nth(1)).toHaveText("Rule A");
  });

  test("the rail fits 1280 with no horizontal overflow (screenshots at 1280 + 375)", async ({ page }) => {
    const seed = [
      baseRule({ public_id: "lgqr_1", rule_name: "Desktop from Google", priority: 1, feed_name: "long_pii", value_multiplier: 1 }),
      baseRule({ public_id: "lgqr_2", rule_name: "NYC ZIPs long name that must wrap inside the narrow rail", priority: 5, conditions_json: { groups: [{ field: "zip", op: "gte", value: 10000 }] }, feed_name: "short" }),
      baseRule({ public_id: "lgqr_3", rule_name: "Liability only", priority: 10, conditions_json: { groups: [{ field: "coverage", op: "eq", value: "Liability" }] }, target_funnel_id: null, redirect_pct: 100, target_offer_id: 10 }),
    ];

    await page.setViewportSize({ width: 1280, height: 800 });
    await mountRail(page, seed);
    await expect(page.locator("[data-qr-card]")).toHaveCount(3);
    const rail = page.locator("#lg-qr-rail");
    const dims = await rail.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(dims.scrollWidth, "rail content must not overflow its 344px column at 1280").toBeLessThanOrEqual(dims.clientWidth);
    const body = await page.evaluate(() => ({ scrollWidth: document.body.scrollWidth, clientWidth: document.body.clientWidth }));
    expect(body.scrollWidth, "no page-level horizontal overflow at 1280").toBeLessThanOrEqual(body.clientWidth);
    await page.screenshot({ path: join(SHOT_DIR, "rail-1280.png"), fullPage: true });

    await page.setViewportSize({ width: 375, height: 720 });
    await page.screenshot({ path: join(SHOT_DIR, "rail-375.png"), fullPage: true });
  });
});

// ===========================================================================
// §13-D5 wiring round — the RELOCATED four-type editor's live journey, against
// the REAL wrangler-dev server + REAL D1 (S1.4 variant-rule endpoints; no
// mocking here — page.request seeds through the SAME live API the browser
// will hit). Proves: pick variant -> create an eligibility rule -> edit ->
// duplicate -> delete, with the SERVER's own validation message rendered
// verbatim on a reachable failure case.
// ===========================================================================

async function apiPost(page: Page, path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await page.request.post(path, { data: body });
  return (await res.json()) as Record<string, unknown>;
}

async function seedQuoteFunnelAuction(page: Page): Promise<{ auctionPub: string; quoteName: string }> {
  const uniq = Date.now() % 100000;
  const quote = await apiPost(page, "/api/admin/leadgen/quotes", {
    quote_name: `D5 Wiring Quote ${uniq}`,
    activity: "quote_funnel",
    verticals: ["life"],
  });
  const quotePub = quote.public_id as string;
  await apiPost(page, `/api/admin/leadgen/quotes/${quotePub}/funnels`, { funnel_name: "Auto Insurance" });
  const auction = await apiPost(page, "/api/admin/leadgen/auctions", {
    auction_name: `D5 Wiring Auction ${uniq}`,
    quote_id: quote.id,
    auction_type: "dynamic",
  });
  return { auctionPub: auction.public_id as string, quoteName: quote.quote_name as string };
}

async function openRulesTab(page: Page): Promise<void> {
  await page.locator('[data-tab="rules"]').click();
  await expect(page.locator('[data-pin="d5-funnel-eligibility-rules"]')).toBeVisible();
}

async function pickVariant(page: Page): Promise<void> {
  const root = page.locator("#lg-frr-root");
  // the quote is pre-selected (this auction's own attributed quote); trigger
  // its change handler once to load funnels, then pick the funnel + variant.
  await root.locator("#lg-frr-quote").dispatchEvent("change");
  await expect(root.locator("#lg-frr-funnel option")).not.toHaveCount(1, { timeout: 10000 }); // more than just the placeholder
  await root.locator("#lg-frr-funnel").selectOption({ label: "Auto Insurance" });
  await expect(root.locator("#lg-frr-variant option")).not.toHaveCount(1);
  await root.locator("#lg-frr-variant").selectOption({ index: 1 }); // the auto-created 'A' variant
  await expect(root.locator("[data-lg-frr-body]")).toBeVisible();
}

test.describe("P3b §13-D5 relocated editor — live journey against the real server", () => {
  test("pick variant -> create eligibility rule -> edit -> duplicate -> delete; server message on a validation failure", async ({ page }) => {
    const { auctionPub } = await seedQuoteFunnelAuction(page);
    await page.goto(`/admin/leadgen/auction/${auctionPub}/edit`);
    await openRulesTab(page);
    await pickVariant(page);

    // starts empty
    await expect(page.locator("#lg-frr-table-body tr")).toHaveCount(0);

    // create an eligibility rule
    await page.locator('[data-lg-frr-new]').click();
    await expect(page.locator("#lg-frr-modal")).toBeVisible();
    await page.locator("#lg-frr-name").fill("US residents only");
    await page.locator("#lg-frr-type").selectOption("eligibility");
    await page.locator("#lg-frr-priority").fill("5");
    // The condition builder mounts empty ("No conditions — always applies.") —
    // a valid, save-able state (§21.4: empty groups = always matches). This
    // journey proves CRUD + server messages, not condition-row editing (that
    // is already covered end-to-end by leadgen-rules-builder.test.ts and the
    // rail's own live-checkpoint gesture above), so conditions stay empty.
    await expect(page.locator("#lg-frr-cond-mount")).toContainText("No conditions");
    await page.locator("[data-lg-frr-save]").click();
    await expect(page.locator("#lg-frr-modal")).toBeHidden();

    const rows = page.locator("#lg-frr-table-body tr");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("US residents only");
    await expect(rows.first()).toContainText("Eligibility");
    await expect(rows.first()).toContainText("Active");

    // edit
    await rows.first().locator("[data-frr-edit]").click();
    await expect(page.locator("#lg-frr-modal")).toBeVisible();
    await page.locator("#lg-frr-name").fill("US residents only (v2)");
    await page.locator("#lg-frr-priority").fill("7");
    await page.locator("[data-lg-frr-save]").click();
    await expect(page.locator("#lg-frr-modal")).toBeHidden();
    await expect(rows.first()).toContainText("US residents only (v2)");
    await expect(rows.first()).toContainText("7");

    // duplicate
    await rows.first().locator("[data-frr-duplicate]").click();
    await expect(rows).toHaveCount(2);

    // enable/disable via the table toggle
    const firstToggleLabel = await rows.first().locator("[data-frr-toggle]").textContent();
    expect(firstToggleLabel).toBe("Disable");
    await rows.first().locator("[data-frr-toggle]").click();
    await expect(rows.first()).toContainText("Disabled");

    // delete
    page.once("dialog", (d) => void d.accept());
    await rows.first().locator("[data-frr-delete]").click();
    await expect(rows).toHaveCount(1);

    // --- validation failure: the SERVER's own message renders verbatim -------
    await page.locator('[data-lg-frr-new]').click();
    await page.locator("#lg-frr-name").fill("Bad redirect, no offer chosen");
    await page.locator("#lg-frr-type").selectOption("redirect_direct_offer");
    // deliberately leave the offer select empty — the client does not
    // pre-validate this; the server's validateFunnelRule rejects it.
    await page.locator("[data-lg-frr-save]").click();
    await expect(page.locator("#lg-frr-error")).toBeVisible();
    await expect(page.locator("#lg-frr-error")).toContainText("requires target_offer_id");
    // the modal stayed open (not saved) and the underlying list is unchanged
    await expect(page.locator("#lg-frr-modal")).toBeVisible();
  });
});
