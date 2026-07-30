// R2 P5 S5b — the DRIVEN PRODUCT for the payload SEAM (contract §5.5 SRC-7B +
// SRC-6B, owner A.1 #7B / A.1 #6, ruling D9).
//
// Nothing here hand-builds both sides of a boundary (E10/E11): the Offers, their
// payload schemas, the Section content and the per-Offer answer maps are all
// AUTHORED through the real admin HTTP endpoints; the answers are typed by a
// REAL browser visitor into the REAL public runtime; and the assertions read the
// payloads the server actually DISPATCHED — captured by the mock provider AND
// re-read from `leadgen_provider_request_log`, keyed to THIS drive's own
// auction_instance_id (the fixture-distinction guard).
//
//   #7B "…I can define that I want the currency will be passed to the offer in
//        the auction and I can define that only the number is sent, and I can
//        define that the number will be sent as string…"
//        → ONE visitor answer (170,000) reaches THREE Offers in THREE formats:
//          "$170,000" (D9, the Image10 shape) · 170000 · "170000".
//   #6  "…every component that include more than one field- each field is
//        potentially answering another offer field in different formats per
//        offer!!!"
//        → ONE Address sub-field (`p5b_addr_zip`) reaches TWO Offers in TWO
//          formats ("07032" · 7032), which is only possible because the SRC-6
//          field-name seam is closed: answers.ts fieldsOf now expands an
//          Address to the keys the RENDERER emits ({base}_{slot}, Image8), so a
//          driven visitor's address survives normalization at all.
//
// Prerequisites (mission smoke lane, not CI): local wrangler dev on PW_PORT with
// the r2fix fixture seeded (npm run seed:leadgen-fixture) — this spec builds its
// OWN quote/offers/section/slug on that fixture's site so it can never collide
// with a sibling slice's fixture rows.

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { PW_PORT } from "./utils/base-url";

// The admin plane is host-gated to ADMIN_HOST = 127.0.0.1 under the documented
// runner (playwright.config.ts launches wrangler with --var ADMIN_HOST:127.0.0.1).
const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const SITE_HOST = "r2fix.e2e.test";
const MOCK_BASE = "http://127.0.0.1:8788";
const MOCK_URL = `${MOCK_BASE}/mock`;
const EVIDENCE_DIR = "../docs/leadgen/r2/evidence/p5/s5b";

// Everything this spec owns is namespaced `p5b_` / "P5B" and lives under its own
// activity + funnel slug — never the S0-C fixture's (`r2fix*`).
const ACTIVITY = "r2p5b_activity";
const VERTICAL = "r2p5b_vertical";
const SLUG = "r2p5b";
const QUOTE_NAME = "P5B Payload Seam Quote";
const AUCTION_NAME = "P5B Payload Seam Auction";
const SECTION_NAME = "P5B Payload Seam Section";
const SHARED_SECTION_NAME = "P5B Payload Seam Shared Continue";
const HEADLINE = "P5B — one answer, three offer formats";

const AMOUNT_FIELD = "p5b_amount";
const ADDR_BASE = "p5b_addr";
const ADDR_ZIP_FIELD = `${ADDR_BASE}_zip`;
// Distinctive values (fixture-distinction guard): none exist in the seeded
// fixture. The AMOUNT lands on 170000 by a REAL keyboard step from 165000, so
// the D9 pin ($170,000) is a value the visitor produced, not a seeded default.
const AMOUNT_START = 165000;
const AMOUNT_STEP = 5000;
const AMOUNT_FINAL = 170000;
const D9_CURRENCY_STRING = "$170,000";
const ZIP_TYPED = "07032";
const STREET_TYPED = "4218 Kestrel Way";
const CITY_TYPED = "Hoboken";
const STATE_TYPED = "NJ";

const REAL_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
});
test.describe.configure({ mode: "serial" });

// ---------------------------------------------------------------------------
// The three Offers — one per SRC-7B output format. Each Offer's ACTIVE payload
// schema is what the auction feeds to buildPayload (auction/engine.ts passes
// `b.payload_schema`), so the `transform` chains below are the ones the driven
// payload actually runs. The SAME three chains are ALSO written to the Section's
// answer-map rows (`value_transform`) through the admin save, which is what
// exercises the admin-side kind allow-list.
// ---------------------------------------------------------------------------

interface OfferSpec {
  name: string;
  placementExt: string;
  // the currency-answer node
  amountPath: string;
  amountType: "string" | "number";
  amountTransform: Array<Record<string, unknown>>;
  // the SRC-6B address sub-field node (two of the three Offers take one)
  zonePath?: string;
  zoneType?: "string" | "number";
  zoneTransform?: Array<Record<string, unknown>>;
}

const OFFERS: readonly OfferSpec[] = [
  {
    name: "P5B Offer A — currency passed",
    placementExt: "p5b-placement-a",
    amountPath: "lead.p5b_amount_currency",
    amountType: "string",
    amountTransform: [{ kind: "formatCurrency" }],
    // SRC-6B format 1 for the SAME sub-field: the 5-digit string as typed.
    zonePath: "lead.p5b_zone_text",
    zoneType: "string",
    zoneTransform: [{ kind: "trim" }],
  },
  {
    name: "P5B Offer B — number only",
    placementExt: "p5b-placement-b",
    amountPath: "lead.p5b_amount_number",
    amountType: "number",
    amountTransform: [{ kind: "toNumber" }],
    // SRC-6B format 2 for the SAME sub-field: a JSON number (leading zero gone).
    zonePath: "lead.p5b_zone_num",
    zoneType: "number",
    zoneTransform: [{ kind: "toNumber" }],
  },
  {
    name: "P5B Offer C — number as string",
    placementExt: "p5b-placement-c",
    amountPath: "lead.p5b_amount_string",
    amountType: "string",
    amountTransform: [{ kind: "toString" }],
  },
];

function schemaFor(spec: OfferSpec): Record<string, unknown> {
  const children: Array<Record<string, unknown>> = [
    {
      path: spec.amountPath,
      name: spec.amountPath.split(".").slice(-1)[0],
      type: spec.amountType,
      source: "answer",
      internal_field: AMOUNT_FIELD,
      transform: spec.amountTransform,
    },
  ];
  if (spec.zonePath !== undefined) {
    children.push({
      path: spec.zonePath,
      name: spec.zonePath.split(".").slice(-1)[0],
      type: spec.zoneType ?? "string",
      source: "answer",
      internal_field: ADDR_ZIP_FIELD,
      transform: spec.zoneTransform ?? [{ kind: "trim" }],
    });
  }
  return { version: 1, root: { type: "object", children } };
}

const CARRIER_PARSE = {
  carriers_path: "carriers",
  fields: {
    provider_id: "id",
    carrier_name: "name",
    carrier_logo: "logo",
    bid: "bid",
    bid_currency: "currency",
    headline: "headline",
  },
};

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

interface Resolved {
  siteId: string;
  quotePublicId: string;
  variantPublicId: string;
  sectionPublicId: string;
  offerIds: number[];
  offerPublicIds: string[];
}
let R: Resolved;

async function api<T>(ctx: APIRequestContext, method: "get" | "post" | "put" | "patch", path: string, data?: unknown): Promise<T> {
  const res = await ctx[method](path, data === undefined ? undefined : { data });
  const text = await res.text();
  if (res.status() >= 400) throw new Error(`${method.toUpperCase()} ${path} -> HTTP ${res.status()}: ${text.slice(0, 600)}`);
  return (text === "" ? undefined : JSON.parse(text)) as T;
}

function d1<T>(sql: string): T[] {
  const raw = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "kodigital-homepages-cms-db", "--local", "--json", "--command", sql],
    { cwd: process.cwd(), timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
  ).toString();
  const parsed = JSON.parse(raw) as Array<{ results?: T[] }>;
  return parsed[0]?.results ?? [];
}

// The tenant host resolves only inside the browser (--host-resolver-rules), so
// the SSR poll speaks raw HTTP to loopback with an explicit Host header.
function rawShell(): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port: Number(PW_PORT),
        path: `/lg/${SLUG}?_cb=${Date.now()}`,
        method: "GET",
        headers: { host: SITE_HOST, "user-agent": REAL_CHROME_UA },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (body += c));
        res.on("end", () => resolve(body));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function pollShellHas(needle: string, label: string): Promise<void> {
  const t0 = Date.now();
  for (let i = 0; i < 40; i += 1) {
    const html = await rawShell();
    if (html.includes(needle)) {
      log(`SSR converged in ${Date.now() - t0}ms (${i + 1} poll(s)): ${label}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`SSR never served ${label} (${Date.now() - t0}ms)`);
}

const LOG_LINES: string[] = [];
function log(line: string): void {
  LOG_LINES.push(line);
  console.log(line);
}

// ---------------------------------------------------------------------------
// authoring (all through the REAL admin endpoints)
// ---------------------------------------------------------------------------

async function ensureOffers(ctx: APIRequestContext): Promise<{ ids: number[]; publicIds: string[]; placementIds: number[] }> {
  const ids: number[] = [];
  const publicIds: string[] = [];
  const placementIds: number[] = [];
  const list = await api<{ items: Array<{ id: number; offer_name: string }> }>(
    ctx,
    "get",
    `/api/admin/leadgen/offers?vertical=${encodeURIComponent(VERTICAL)}`,
  );
  for (const spec of OFFERS) {
    const found = list.items.find((o) => o.offer_name === spec.name);
    let id: number;
    if (found !== undefined) {
      id = found.id;
    } else {
      const created = await api<{ id: number }>(ctx, "post", "/api/admin/leadgen/offers", {
        offer_name: spec.name,
        provider: "p5bprov",
        activity: ACTIVITY,
        vertical: VERTICAL,
        conversion_tracking_method: "s2s_postback",
        offer_type: "cpc",
        placements: [spec.placementExt],
        calls_provider_api: true,
        bid_source: "response",
        cap_enabled: false,
      });
      id = created.id;
    }
    const detail = await api<{
      id: number;
      public_id: string;
      placements: Array<{ id: number; placement_id: string }>;
    }>(ctx, "get", `/api/admin/leadgen/offers/${id}`);
    const placement = detail.placements.find((p) => p.placement_id === spec.placementExt);
    if (placement === undefined) throw new Error(`offer ${spec.name}: no placement ${spec.placementExt}`);
    await api(ctx, "patch", `/api/admin/leadgen/offers/${id}`, {
      endpoint_production: MOCK_URL,
      endpoint_staging: MOCK_URL,
      request_method: "POST",
    });
    // A NEW active schema version every run — its `transform` chains are the
    // per-offer output formats under test. This POST runs payload.ts
    // validatePayloadSchema (validator #1) BEFORE it stores: a schema carrying
    // an unknown transform kind is a 400, so a green save IS the proof the
    // runtime validator accepts `formatCurrency`.
    const schemaRes = await api<{ version?: number }>(ctx, "post", `/api/admin/leadgen/offers/${id}/payload-schemas`, {
      schema_json: schemaFor(spec),
      carrier_parse_json: CARRIER_PARSE,
    });
    // The R4 eligibility gate wants a PASSED Test-tool run against the endpoint.
    const testRun = await api<{ response?: { status?: number | null } }>(ctx, "post", `/api/admin/leadgen/offers/${id}/test`, {
      environment: "staging",
      sample_answers: { [AMOUNT_FIELD]: AMOUNT_FINAL, [ADDR_ZIP_FIELD]: ZIP_TYPED },
    });
    const status = testRun.response?.status ?? null;
    if (status === null || status < 200 || status >= 300) {
      throw new Error(`${spec.name}: test-tool run did not pass (status ${String(status)})`);
    }
    log(`AUTHOR offer "${spec.name}" -> id=${id} schema_v=${String(schemaRes.version ?? "?")} test=HTTP ${status}`);
    ids.push(id);
    publicIds.push(detail.public_id);
    placementIds.push(placement.id);
  }
  return { ids, publicIds, placementIds };
}

function sectionContent(addressProps: Record<string, unknown>): Record<string, unknown> {
  return {
    components: [
      { type: "QuestionHeadline", question_id: "p5b_head", props: { text: HEADLINE } },
      {
        type: "NumberRangeQuestion",
        question_id: "p5b_amount_q",
        question_key: AMOUNT_FIELD,
        internal_field: AMOUNT_FIELD,
        answer_type: "number",
        props: {
          label: "Coverage amount",
          slider_type: "stepper",
          min: 5000,
          max: 500000,
          step: AMOUNT_STEP,
          default: AMOUNT_START,
          defaultValue: AMOUNT_START,
          currency_affix: true,
        },
      },
      {
        type: "AddressAutocompleteQuestion",
        question_id: "p5b_addr_q",
        question_key: ADDR_BASE,
        internal_field: ADDR_BASE,
        props: addressProps,
      },
      { type: "ContinueButton", question_id: "p5b_cont", props: { label: "Continue" } },
    ],
  };
}

// The Section's own per-offer answer-map rows. `value_transform` carries the
// SAME three chains the Offer schemas do — this save runs the ADMIN validator
// (sections-handlers parseTransformSteps, validator #2), so a green PATCH is
// the proof that side accepts `formatCurrency` too.
function answerMaps(offerIds: number[]): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  OFFERS.forEach((spec, i) => {
    const offerId = offerIds[i];
    if (offerId === undefined) return;
    rows.push({
      question_id: "p5b_amount_q",
      offer_id: offerId,
      offer_payload_field_path: spec.amountPath,
      provider_expected_type: spec.amountType,
      required_for_offer: false,
      internal_field: AMOUNT_FIELD,
      answer_type: "number",
      value_transform: spec.amountTransform,
    });
    if (spec.zonePath !== undefined) {
      rows.push({
        question_id: "p5b_addr_q",
        offer_id: offerId,
        offer_payload_field_path: spec.zonePath,
        provider_expected_type: spec.zoneType ?? "string",
        required_for_offer: false,
        internal_field: ADDR_ZIP_FIELD,
        answer_type: "string",
        value_transform: spec.zoneTransform ?? [{ kind: "trim" }],
      });
    }
  });
  return rows;
}

async function authorSection(ctx: APIRequestContext, addressProps: Record<string, unknown>, label: string): Promise<void> {
  const res = await ctx.patch(`/api/admin/leadgen/sections/${R.sectionPublicId}`, {
    data: {
      content_json: JSON.stringify(sectionContent(addressProps)),
      selected_offers: R.offerIds,
      answer_maps: answerMaps(R.offerIds),
    },
  });
  const body = await res.text();
  log(`AUTHOR section [${label}] -> HTTP ${res.status()}`);
  if (res.status() !== 200) throw new Error(`section save failed: ${res.status()} ${body.slice(0, 600)}`);
  // ADJ-N20 (reported by S4a, unchanged here): a SECTION save does not mint a
  // fresh lg-shell cache key — re-saving the ACTIVATION does, and its
  // updated_at is second-granular, so cross a 1.1s boundary first.
  await new Promise((r) => setTimeout(r, 1100));
  const act = await ctx.put(`/api/admin/leadgen/quotes/${R.quotePublicId}/activation/${R.siteId}`, {
    data: { enabled: true, slug: SLUG },
  });
  if (act.status() !== 200) throw new Error(`activation re-save failed: ${act.status()}`);
}

// ---------------------------------------------------------------------------
// the DRIVE
// ---------------------------------------------------------------------------

interface DriveResult {
  envelopeKeys: string[];
  envelopeAnswers: Record<string, unknown>;
  auctionInstanceId: string;
  readout: string;
}

async function driveVisitor(page: Page, shotName: string, fill: (page: Page) => Promise<string>): Promise<DriveResult> {
  let envelope: Record<string, unknown> | null = null;
  let auctionInstanceId = "";
  page.on("request", (req) => {
    if (req.url().includes("/lg/auction") && req.method() === "POST") {
      const post = req.postData();
      if (post !== null) envelope = JSON.parse(post) as Record<string, unknown>;
    }
  });
  page.on("response", (res) => {
    if (res.url().includes("/lg/auction")) {
      void res
        .json()
        .then((j: { auction_instance_id?: string }) => {
          if (typeof j.auction_instance_id === "string") auctionInstanceId = j.auction_instance_id;
        })
        .catch(() => undefined);
    }
  });

  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`http://${SITE_HOST}:${PW_PORT}/lg/${SLUG}?_cb=${Date.now()}`, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 4; i += 1) {
    if (await page.getByText(HEADLINE).first().isVisible()) break;
    await page.locator("[data-lg-continue]:visible").first().click();
    await page.waitForTimeout(600);
  }
  await expect(page.getByText(HEADLINE).first()).toBeVisible();

  // A REAL keyboard step on the REAL slider: 165,000 -> 170,000.
  const slider = page.locator('[data-lg-question="p5b_amount_q"] input[type="range"]').first();
  await slider.focus();
  await slider.press("ArrowRight");
  await page.waitForTimeout(150);
  const readout = ((await page.locator('[data-lg-question="p5b_amount_q"] .lg-range-value').first().textContent()) ?? "").trim();

  const typed = await fill(page);

  await page.waitForTimeout(150);
  // The evidence shot is the ANSWERED question page — taken BEFORE Continue, so
  // it shows the state the payloads were built from (after the auction the
  // funnel has already advanced past it).
  await page.screenshot({ path: `${EVIDENCE_DIR}/${shotName}`, fullPage: false });
  const [auctionResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/lg/auction"), { timeout: 20_000 }),
    page.locator("[data-lg-continue]:visible").first().click(),
  ]);
  expect(auctionResponse.status()).toBe(200);
  await page.waitForTimeout(500);

  if (envelope === null) throw new Error("no /lg/auction request captured");
  const answers = (envelope as { answers?: Record<string, unknown> }).answers ?? {};
  const keys = Object.keys(answers).sort();
  log(`DRIVE typed=${typed} · readout="${readout}" · visitor RECORDED keys = [${keys.join(", ")}]`);
  log(`DRIVE auction_instance_id=${auctionInstanceId}`);
  return { envelopeKeys: keys, envelopeAnswers: answers, auctionInstanceId, readout };
}

interface ProviderLogRow {
  offer_public_id: string;
  auction_instance_id: string | null;
  status_code: number | null;
  request_payload_redacted_json: string | null;
}

// Every provider-log row this drive produced, keyed to ITS OWN auction instance
// — the fixture-distinction guard: a row from the S0-C fixture, a sibling
// slice's drive, or this spec's own Test-tool runs (auction_instance_id IS NULL)
// can never enter the set.
function payloadsForInstance(instanceId: string): Map<string, Record<string, unknown>> {
  const rows = d1<ProviderLogRow>(
    `SELECT offer_public_id, auction_instance_id, status_code, request_payload_redacted_json
       FROM leadgen_provider_request_log
      WHERE auction_instance_id = '${instanceId.replace(/'/g, "''")}'`,
  );
  const out = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    expect(row.auction_instance_id).toBe(instanceId);
    out.set(row.offer_public_id, JSON.parse(row.request_payload_redacted_json ?? "{}") as Record<string, unknown>);
  }
  return out;
}

function leadOf(payload: Record<string, unknown>): Record<string, unknown> {
  return (payload["lead"] ?? {}) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------

test.beforeAll(async () => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });

  const sites = await api<{ resource?: Array<{ id: string; domain: string }> }>(ctx, "get", "/api/admin/sites");
  const site = (sites.resource ?? []).find((s) => s.domain === SITE_HOST);
  if (site === undefined) throw new Error("fixture site missing — run npm run seed:leadgen-fixture");

  const offers = await ensureOffers(ctx);

  const quotes = await api<{ items: Array<{ id: number; public_id: string; quote_name: string }> }>(
    ctx,
    "get",
    `/api/admin/leadgen/quotes?activity=${encodeURIComponent(ACTIVITY)}`,
  );
  const existingQuote = quotes.items.find((q) => q.quote_name === QUOTE_NAME);
  const quote =
    existingQuote ??
    (await api<{ id: number; public_id: string }>(ctx, "post", "/api/admin/leadgen/quotes", {
      quote_name: QUOTE_NAME,
      activity: ACTIVITY,
      verticals: [VERTICAL],
    }));
  const structure = await api<{ funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
    ctx,
    "get",
    `/api/admin/leadgen/quotes/${quote.public_id}/structure`,
  );
  const funnel = structure.funnels[0];
  const variant = funnel?.variants[0];
  if (funnel === undefined || variant === undefined) throw new Error("quote has no funnel/variant");

  const sectionList = await api<{ items: Array<{ id: number; public_id: string; section_name: string }> }>(
    ctx,
    "get",
    `/api/admin/leadgen/sections?vertical=${encodeURIComponent(VERTICAL)}`,
  );
  const findSection = (name: string) => sectionList.items.find((s) => s.section_name === name);
  const shared =
    findSection(SHARED_SECTION_NAME) ??
    (await api<{ id: number; public_id: string }>(ctx, "post", "/api/admin/leadgen/sections", {
      section_name: SHARED_SECTION_NAME,
      activity: ACTIVITY,
      vertical: VERTICAL,
      headline_text: "Continue",
      status: "active",
      content_json: { components: [{ type: "ContinueButton", question_id: "p5b_shared_cont", props: { label: "Continue" } }] },
    }));
  const section =
    findSection(SECTION_NAME) ??
    (await api<{ id: number; public_id: string }>(ctx, "post", "/api/admin/leadgen/sections", {
      section_name: SECTION_NAME,
      activity: ACTIVITY,
      vertical: VERTICAL,
      headline_text: HEADLINE,
      status: "active",
      content_json: sectionContent({}),
    }));

  const auctions = await api<{ items: Array<{ id: number; auction_name: string }> }>(
    ctx,
    "get",
    `/api/admin/leadgen/auctions?quote=${quote.id}`,
  );
  const auction =
    auctions.items.find((a) => a.auction_name === AUCTION_NAME) ??
    (await api<{ id: number }>(ctx, "post", "/api/admin/leadgen/auctions", {
      auction_name: AUCTION_NAME,
      quote_id: quote.id,
      auction_type: "dynamic",
      winner_logic: "highest_bid",
      floor_type: "percentage_of_max",
      floor_value: 10,
      multi_offer: "enabled",
      banner_slots_count: 5,
      max_carriers_per_offer: 3,
      max_total_carriers: 10,
      timeout_ms: 2500,
      status: "active",
    }));

  const wired = await api<{ warnings?: Array<{ eligible?: boolean; reasons?: string[] }> }>(
    ctx,
    "put",
    `/api/admin/leadgen/auctions/${auction.id}/offers`,
    { offers: offers.placementIds.map((pid, i) => ({ offer_placement_id: pid, static_order: i, enabled: true })) },
  );
  const ineligible = (wired.warnings ?? []).find((w) => w.eligible === false);
  if (ineligible !== undefined) throw new Error(`auction offer ineligible: ${JSON.stringify(ineligible.reasons ?? [])}`);

  await api(ctx, "put", `/api/admin/leadgen/variants/${variant.public_id}`, {
    auction_id: auction.id,
    sections: [{ section_id: section.id, position: 0 }],
  });
  const sharedPage = await api<{ shared_page: unknown }>(ctx, "get", `/api/admin/leadgen/quotes/${quote.public_id}/shared-page`);
  await api(
    ctx,
    sharedPage.shared_page === null || sharedPage.shared_page === undefined ? "post" : "put",
    `/api/admin/leadgen/quotes/${quote.public_id}/shared-page`,
    { sections: [{ section_id: shared.id }] },
  );
  await api(ctx, "put", `/api/admin/leadgen/quotes/${quote.public_id}/default-funnel`, { funnel_id: funnel.public_id });
  await api(ctx, "put", `/api/admin/leadgen/quotes/${quote.public_id}/activation/${site.id}`, { enabled: true, slug: SLUG });

  R = {
    siteId: site.id,
    quotePublicId: quote.public_id,
    variantPublicId: variant.public_id,
    sectionPublicId: section.public_id,
    offerIds: offers.ids,
    offerPublicIds: offers.publicIds,
  };
  log(`SETUP quote=${quote.public_id} variant=${variant.public_id} section=${section.public_id} slug=${SLUG}`);
  log(`SETUP offers=${offers.publicIds.join(" ")} (A currency · B number · C number-as-string)`);
  await ctx.dispose();
});

test.afterAll(() => {
  writeFileSync(`${EVIDENCE_DIR}/drive-log.txt`, `${LOG_LINES.join("\n")}\n`, "utf8");
});

// ---------------------------------------------------------------------------
// 1 + 2 — SRC-7B three formats AND SRC-6B format-per-offer, ONE visitor
// ---------------------------------------------------------------------------

test("SRC-7B/SRC-6B: one visitor, three per-offer formats of the amount and two of the SAME address sub-field", async ({ page }) => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  // The UNCONFIGURED Address (owner D3) — the visitor gets the 4-field composite.
  await authorSection(ctx, {}, "composite (unconfigured, D3 default)");
  await ctx.dispose();
  await pollShellHas(`data-lg-field="${ADDR_ZIP_FIELD}"`, "composite address + currency stepper");

  const drive = await driveVisitor(page, "composite-drive-1280.png", async (p) => {
    await p.locator(`[data-lg-field="${ADDR_BASE}_street"] input`).fill(STREET_TYPED);
    await p.locator(`[data-lg-field="${ADDR_BASE}_city"] input`).fill(CITY_TYPED);
    await p.locator(`[data-lg-field="${ADDR_BASE}_state"] input`).fill(STATE_TYPED);
    await p.locator(`[data-lg-field="${ADDR_ZIP_FIELD}"] input`).fill(ZIP_TYPED);
    return `${STREET_TYPED} / ${CITY_TYPED} / ${STATE_TYPED} / ${ZIP_TYPED}`;
  });

  // The visitor-facing shape the owner pinned (Image10) is what the widget paints.
  expect(drive.readout).toBe(D9_CURRENCY_STRING);

  // (3, composite) fieldsOf's names == the DRIVEN recorded keys.
  expect(drive.envelopeKeys).toEqual(
    [`${ADDR_BASE}_city`, `${ADDR_BASE}_state`, `${ADDR_BASE}_street`, ADDR_ZIP_FIELD, AMOUNT_FIELD].sort(),
  );

  const payloads = payloadsForInstance(drive.auctionInstanceId);
  expect(payloads.size).toBe(3);
  const [pubA, pubB, pubC] = R.offerPublicIds;
  const a = leadOf(payloads.get(pubA ?? "") ?? {});
  const b = leadOf(payloads.get(pubB ?? "") ?? {});
  const c = leadOf(payloads.get(pubC ?? "") ?? {});
  log(`PAYLOAD offer-1 (${pubA}) ${JSON.stringify(payloads.get(pubA ?? ""))}`);
  log(`PAYLOAD offer-2 (${pubB}) ${JSON.stringify(payloads.get(pubB ?? ""))}`);
  log(`PAYLOAD offer-3 (${pubC}) ${JSON.stringify(payloads.get(pubC ?? ""))}`);

  // SRC-7B — the three formats of the ONE answer the visitor gave.
  expect(a["p5b_amount_currency"]).toBe(D9_CURRENCY_STRING); // D9: EXACT string
  expect(b["p5b_amount_number"]).toBe(AMOUNT_FINAL); // a JSON number
  expect(c["p5b_amount_string"]).toBe(String(AMOUNT_FINAL)); // the number as string

  // SRC-6B — the SAME address sub-field, two formats, two offers.
  expect(a["p5b_zone_text"]).toBe(ZIP_TYPED);
  expect(b["p5b_zone_num"]).toBe(Number(ZIP_TYPED));
  expect(c["p5b_zone_text"]).toBeUndefined();

  // The answer-map rows persisted their OWN value_transform chains (the admin
  // validator accepted every kind, `formatCurrency` included).
  const rows = d1<{ internal_field: string; offer_payload_field_path: string; transform_json: string | null }>(
    `SELECT m.internal_field, m.offer_payload_field_path, m.transform_json
       FROM leadgen_section_answer_maps m
       JOIN leadgen_sections s ON s.id = m.section_id
      WHERE s.public_id = '${R.sectionPublicId.replace(/'/g, "''")}'
      ORDER BY m.offer_payload_field_path`,
  );
  const chains = rows.map((r) => `${r.offer_payload_field_path}=${r.transform_json ?? "null"}`);
  log(`ANSWER-MAP value_transform rows (${rows.length}): ${chains.join(" | ")}`);
  expect(chains).toContain('lead.p5b_amount_currency=[{"kind":"formatCurrency"}]');
  expect(chains).toContain('lead.p5b_amount_number=[{"kind":"toNumber"}]');
  expect(chains).toContain('lead.p5b_amount_string=[{"kind":"toString"}]');
});

// ---------------------------------------------------------------------------
// 3 — the seam, for every field set: free-text (full_address) and street-only
// ---------------------------------------------------------------------------

test("SRC-6 seam: a free-text (full_address) Address records the BASE key end-to-end into the payload", async ({ page }) => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  await authorSection(ctx, { fields: [{ field: "full_address", label: "Your address", mode: "autofill" }] }, "free-text (full_address)");
  await ctx.dispose();
  await pollShellHas("Your address", "free-text address");

  const composite = `${STREET_TYPED}, ${CITY_TYPED}, ${STATE_TYPED} ${ZIP_TYPED}`;
  const drive = await driveVisitor(page, "freetext-drive-1280.png", async (p) => {
    await p.locator(`[data-lg-field="${ADDR_BASE}"] input.lg-address-input`).first().fill(composite);
    return composite;
  });

  expect(drive.envelopeKeys).toEqual([ADDR_BASE, AMOUNT_FIELD].sort());
  const payloads = payloadsForInstance(drive.auctionInstanceId);
  expect(payloads.size).toBe(3);
  const a = leadOf(payloads.get(R.offerPublicIds[0] ?? "") ?? {});
  log(`PAYLOAD free-text offer-1 ${JSON.stringify(payloads.get(R.offerPublicIds[0] ?? ""))}`);
  // The amount still rides in its currency format; the address's ONE key is the
  // base — nothing maps it to lead.p5b_zone_* (that node reads {base}_zip), so
  // the zone field cleanly absents itself rather than carrying a wrong value.
  expect(a["p5b_amount_currency"]).toBe(D9_CURRENCY_STRING);
  expect(a["p5b_zone_text"]).toBeUndefined();
});

test("SRC-6 seam: a street-only Address records ONLY {base}_street end-to-end", async ({ page }) => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  await authorSection(ctx, { fields: [{ field: "street", label: "Street", mode: "manual" }] }, "street-only");
  await ctx.dispose();
  await pollShellHas(`data-lg-field="${ADDR_BASE}_street"`, "street-only address");

  const drive = await driveVisitor(page, "street-only-drive-1280.png", async (p) => {
    await p.locator(`[data-lg-field="${ADDR_BASE}_street"] input`).fill(STREET_TYPED);
    return STREET_TYPED;
  });

  expect(drive.envelopeKeys).toEqual([`${ADDR_BASE}_street`, AMOUNT_FIELD].sort());
  const payloads = payloadsForInstance(drive.auctionInstanceId);
  expect(payloads.size).toBe(3);
  const a = leadOf(payloads.get(R.offerPublicIds[0] ?? "") ?? {});
  const b = leadOf(payloads.get(R.offerPublicIds[1] ?? "") ?? {});
  log(`PAYLOAD street-only offer-1 ${JSON.stringify(payloads.get(R.offerPublicIds[0] ?? ""))}`);
  expect(a["p5b_amount_currency"]).toBe(D9_CURRENCY_STRING);
  expect(b["p5b_amount_number"]).toBe(AMOUNT_FINAL);
  // no zip field rendered ⇒ no zip answer ⇒ both zone nodes absent (never a
  // fabricated value).
  expect(a["p5b_zone_text"]).toBeUndefined();
  expect(b["p5b_zone_num"]).toBeUndefined();
});
