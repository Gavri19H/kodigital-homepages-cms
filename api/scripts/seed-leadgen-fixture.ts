#!/usr/bin/env tsx
// LeadGen R2 fixing mission — P0 slice S0-C: a reusable, product-neutral
// leadgen seed fixture every later phase authors on top of.
//
// Seeds a minimal leadgen baseline THROUGH THE REAL ADMIN APIs only (the
// proven test-ui/leadgen-c-seed.ts / leadgen-fix-p1-seed.ts convention) —
// NEVER a direct DB write, so the fixture can never drift from the schema:
//   1. one activity + one vertical (free-text tags this fixture owns —
//      r2fix_activity / r2fix_vertical — materialized the moment a
//      quote/offer/section references them; there is no dedicated
//      create-an-activity endpoint, only GET /activities / GET /verticals
//      distinct-value listings);
//   2. one Quote with its default funnel + a shared first page carrying
//      ContinueButton pass-through section (>=1 section — the S0-B1
//      activation preflight requires it);
//   3. one Buttons (ButtonAnswerGroup) section on the funnel's own variant,
//      recording to internal_field r2fix_carrier, 3 choices;
//   4. one dynamic Offer (calls_provider_api, bid_source:"response") with an
//      ACTIVE payload schema mapping lead.r2fix_carrier <- source:"answer"
//      internal_field:r2fix_carrier, PLUS the section-level selected_offers +
//      answer_maps edge (leadgen_section_available_offers /
//      leadgen_section_answer_maps — the admin-side mapping/usage record);
//   5. activation of the quote on the fixture site (the B1-fixed path).
//
// GROUND-TRUTH NOTE (verified against source, not the paraphrase): a LIVE
// /lg/auction only ever calls a provider for an offer that is BOTH (a)
// attached to the variant's AUCTION via leadgen_auction_offers (PUT
// /auctions/:id/offers — auction/engine.ts's `candidates`/`callsProvider`
// gate reads THIS table, not the section-level selected_offers) and (b)
// R4-eligible per src/leadgen/validation.ts dynamicAuctionEligibility: a
// valid active payload schema AND a PASSED Test-tool run (leadgen_provider_
// request_log, auction_instance_id IS NULL, status_code 2xx) AND a non-empty
// endpoint_production. This script therefore also creates an Auction, wires
// the offer's placement into it, and starts a tiny throw-away local HTTP
// "provider" (127.0.0.1, ephemeral port, torn down on exit) so the Test-tool
// run genuinely passes and the live auction has a real endpoint to call —
// no product source changes, no new dependency, no external process.
//
// IDEMPOTENCE: every entity is looked up first (stable r2fix- names/slugs,
// no timestamps) and reused when found; only a missing entity is created.
// The mock provider's endpoint is RE-PATCHED onto the Offer on every run
// (its ephemeral port changes per process), so a later `--drive` run always
// has a live endpoint even though the base-seed process that created the
// Offer has long since exited.
//
// Usage (from the api/ cwd, dev server already up on LG_BASE):
//   npm run seed:leadgen-fixture            # ensure the baseline, print ids
//   npm run seed:leadgen-fixture -- --drive # + drive one real visitor
//                                            #   attempt through /lg/auction
//
// Env: LG_BASE overrides the dev server origin (default http://127.0.0.1:8901).

import http from "node:http";

const LG_BASE = (process.env.LG_BASE ?? "http://127.0.0.1:8901").replace(/\/+$/, "");

// Fail-closed host guard: only local dev servers permitted. Pointing at a
// non-local origin would create/modify offers/sites on a remote system.
const url = new URL(LG_BASE);
if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
  console.error(`LG_BASE rejected: hostname "${url.hostname}" is not a local dev server`);
  process.exit(1);
}

const LG = "/api/admin/leadgen";

const ACTIVITY = "r2fix_activity";
const VERTICAL = "r2fix_vertical";
const SITE_DOMAIN = "r2fix.e2e.test";
const SITE_NAME = "R2Fix Fixture Site";
const OFFER_NAME = "R2Fix Fixture Offer";
const OFFER_PLACEMENT_EXT_ID = "r2fix-placement";
const QUOTE_NAME = "R2Fix Fixture Quote";
const SHARED_SECTION_NAME = "R2Fix Fixture Shared Continue";
const BUTTONS_SECTION_NAME = "R2Fix Fixture Carrier Buttons";
const AUCTION_NAME = "R2Fix Fixture Auction";
const FUNNEL_SLUG = "r2fix";
const FIELD_NAME = "r2fix_carrier";
// A realistic desktop Chrome UA (test-ui/leadgen-rework-acceptance-helpers.ts
// REAL_CHROME_UA convention) — the live /lg/auction runtimeRequestGuard 403s
// a headless/empty UA in dev (no request.cf locally, so only UA heuristics fire).
const REAL_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const CHOICES: ReadonlyArray<{ label: string; value: string }> = [
  { label: "Acme Insurance", value: "acme_insurance" },
  { label: "Beta Mutual", value: "beta_mutual" },
  { label: "Gamma Direct", value: "gamma_direct" },
];

// ---------------------------------------------------------------------------
// Admin API helper — every fixture write rides a REAL admin HTTP endpoint.
// ---------------------------------------------------------------------------

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${LG_BASE}${path}`, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 800)}`);
  }
  if (text === "") return undefined as T;
  return JSON.parse(text) as T;
}

// ---------------------------------------------------------------------------
// Site (seedActiveSite convention: create -> activate domain -> walk site
// status draft -> provisioning -> active), made idempotent by a domain lookup.
// ---------------------------------------------------------------------------

interface SiteListItem {
  id: string;
  domain: string;
  status: string;
}

async function ensureSite(): Promise<string> {
  const list = await call<{ resource: SiteListItem[] }>("GET", "/api/admin/sites");
  const existing = list.resource.find((s) => s.domain === SITE_DOMAIN);
  if (existing !== undefined) {
    if (existing.status !== "active") {
      await call("PATCH", `/api/admin/sites/${existing.id}`, { status: "provisioning" });
      await call("PATCH", `/api/admin/sites/${existing.id}`, { status: "active" });
    }
    return existing.id;
  }
  const created = await call<{ resource: { id: string } }>("POST", "/api/admin/sites", {
    domain: SITE_DOMAIN,
    name: SITE_NAME,
    vertical_slug: "finance",
    activity: "main",
  });
  const siteId = created.resource.id;
  const domains = await call<{ resource: Array<{ id: number; hostname: string }> }>(
    "GET",
    `/api/admin/domains?site_id=${encodeURIComponent(siteId)}`,
  );
  const domain = domains.resource.find((d) => d.hostname === SITE_DOMAIN);
  if (domain === undefined) throw new Error(`ensureSite: no domain row for ${SITE_DOMAIN}`);
  await call("PATCH", `/api/admin/domains/${domain.id}`, { status: "active" });
  await call("PATCH", `/api/admin/sites/${siteId}`, { status: "provisioning" });
  await call("PATCH", `/api/admin/sites/${siteId}`, { status: "active" });
  return siteId;
}

// ---------------------------------------------------------------------------
// Offer + placement (idempotent lookup by vertical + name).
// ---------------------------------------------------------------------------

interface OfferPlacement {
  id: number;
  public_id: string;
  placement_id: string;
}

interface OfferDetail {
  id: number;
  public_id: string;
  active_payload_schema_id: number | null;
  placements: OfferPlacement[];
}

interface EnsuredOffer {
  id: number;
  publicId: string;
  placementId: number;
  hasActiveSchema: boolean;
}

async function ensureOffer(): Promise<EnsuredOffer> {
  const list = await call<{ items: Array<{ id: number; offer_name: string }> }>(
    "GET",
    `${LG}/offers?vertical=${encodeURIComponent(VERTICAL)}`,
  );
  const found = list.items.find((o) => o.offer_name === OFFER_NAME);
  let id: number;
  if (found !== undefined) {
    id = found.id;
  } else {
    const created = await call<{ id: number }>("POST", `${LG}/offers`, {
      offer_name: OFFER_NAME,
      provider: "r2fixprov",
      activity: ACTIVITY,
      vertical: VERTICAL,
      conversion_tracking_method: "s2s_postback",
      offer_type: "cpc",
      placements: [OFFER_PLACEMENT_EXT_ID],
      calls_provider_api: true,
      bid_source: "response",
      cap_enabled: false,
    });
    id = created.id;
  }
  const detail = await call<OfferDetail>("GET", `${LG}/offers/${id}`);
  const placement = detail.placements.find((p) => p.placement_id === OFFER_PLACEMENT_EXT_ID);
  if (placement === undefined) {
    throw new Error(`ensureOffer: no placement row for ${OFFER_PLACEMENT_EXT_ID}`);
  }
  return {
    id: detail.id,
    publicId: detail.public_id,
    placementId: placement.id,
    hasActiveSchema: detail.active_payload_schema_id !== null,
  };
}

// Re-point the offer's endpoints at THIS run's mock provider (always — the
// mock's ephemeral port changes every process), pin an active payload schema
// mapping lead.<field> <- source:"answer" internal_field:<field> when the
// offer does not already carry one, then run a REAL Test-tool call so the
// R4 eligibility gate (dynamicAuctionEligibility: schema valid + test PASSED
// + endpoint present) is genuinely satisfied.
async function ensureOfferEndpointsAndSchema(offer: EnsuredOffer, mockUrl: string): Promise<void> {
  await call("PATCH", `${LG}/offers/${offer.id}`, {
    endpoint_production: mockUrl,
    endpoint_staging: mockUrl,
    request_method: "POST",
  });
  if (!offer.hasActiveSchema) {
    await call("POST", `${LG}/offers/${offer.id}/payload-schemas`, {
      schema_json: {
        version: 1,
        root: {
          type: "object",
          children: [
            {
              path: `lead.${FIELD_NAME}`,
              name: FIELD_NAME,
              type: "string",
              required: true,
              source: "answer",
              internal_field: FIELD_NAME,
            },
          ],
        },
      },
      carrier_parse_json: {
        carriers_path: "carriers",
        fields: {
          provider_id: "id",
          carrier_name: "name",
          carrier_logo: "logo",
          bid: "bid",
          bid_currency: "currency",
          headline: "headline",
        },
      },
    });
  }
  const firstChoice = CHOICES[0];
  const sampleValue = firstChoice === undefined ? "acme_insurance" : firstChoice.value;
  // payload-builder-handlers.ts testOfferHandler's LIVE response nests the
  // provider's HTTP status under response.status (there is no top-level
  // status_code key — test-ui/leadgen-fix-p1-seed.ts's own `status_code`
  // read is a latent no-op for the same reason; verified against source).
  const testRun = await call<{ response?: { status?: number | null } }>("POST", `${LG}/offers/${offer.id}/test`, {
    environment: "staging",
    sample_answers: { [FIELD_NAME]: sampleValue },
  });
  const statusCode = testRun.response?.status ?? null;
  if (statusCode === null || statusCode < 200 || statusCode >= 300) {
    throw new Error(`ensureOfferEndpointsAndSchema: test-tool run did not pass (status ${String(statusCode)})`);
  }
}

// ---------------------------------------------------------------------------
// Quote + auto-created funnel/variant (idempotent lookup by the fixture's
// own r2fix_activity tag — nothing else in the system uses that value).
// ---------------------------------------------------------------------------

interface QuoteFunnelVariant {
  public_id: string;
}
interface QuoteFunnel {
  public_id: string;
  variants: QuoteFunnelVariant[];
}
interface EnsuredQuote {
  id: number;
  publicId: string;
  funnelPublicId: string;
  variantPublicId: string;
}

async function ensureQuote(): Promise<EnsuredQuote> {
  const list = await call<{ items: Array<{ id: number; public_id: string }> }>(
    "GET",
    `${LG}/quotes?activity=${encodeURIComponent(ACTIVITY)}`,
  );
  const existing = list.items[0];
  let id: number;
  let publicId: string;
  if (existing !== undefined) {
    id = existing.id;
    publicId = existing.public_id;
  } else {
    const created = await call<{ id: number; public_id: string }>("POST", `${LG}/quotes`, {
      quote_name: QUOTE_NAME,
      activity: ACTIVITY,
      verticals: [VERTICAL],
    });
    id = created.id;
    publicId = created.public_id;
  }
  const structure = await call<{ funnels: QuoteFunnel[] }>("GET", `${LG}/quotes/${publicId}/structure`);
  const funnel = structure.funnels[0];
  if (funnel === undefined) throw new Error("ensureQuote: quote has no funnel");
  const variant = funnel.variants[0];
  if (variant === undefined) throw new Error("ensureQuote: funnel has no variant");
  return { id, publicId, funnelPublicId: funnel.public_id, variantPublicId: variant.public_id };
}

// ---------------------------------------------------------------------------
// Sections (idempotent lookup by vertical + exact section_name).
// ---------------------------------------------------------------------------

interface CreatedSection {
  id: number;
  public_id: string;
}

async function findSection(name: string): Promise<CreatedSection | null> {
  const list = await call<{ items: Array<{ id: number; public_id: string; section_name: string }> }>(
    "GET",
    `${LG}/sections?vertical=${encodeURIComponent(VERTICAL)}`,
  );
  const found = list.items.find((s) => s.section_name === name);
  return found === undefined ? null : { id: found.id, public_id: found.public_id };
}

// A ContinueButton-only pass-through section — the S0-B1 activation preflight
// requires the shared first page to carry >=1 section; this is the trivial one.
async function ensureSharedSection(): Promise<CreatedSection> {
  const existing = await findSection(SHARED_SECTION_NAME);
  if (existing !== null) return existing;
  return call<CreatedSection>("POST", `${LG}/sections`, {
    section_name: SHARED_SECTION_NAME,
    activity: ACTIVITY,
    vertical: VERTICAL,
    headline_text: "Continue",
    status: "active",
    content_json: {
      components: [{ type: "ContinueButton", question_id: "r2fix_shared_cont", props: { label: "Continue" } }],
    },
  });
}

// The Buttons (ButtonAnswerGroup) section: 3 choices recording to
// internal_field r2fix_carrier, carrying selected_offers + the answer_maps
// edge (leadgen_section_available_offers / leadgen_section_answer_maps —
// the section-level offer-mapping record) that names the Offer + the
// output_value_map per choice.
async function ensureButtonsSection(offerId: number): Promise<CreatedSection> {
  const existing = await findSection(BUTTONS_SECTION_NAME);
  if (existing !== null) return existing;
  return call<CreatedSection>("POST", `${LG}/sections`, {
    section_name: BUTTONS_SECTION_NAME,
    activity: ACTIVITY,
    vertical: VERTICAL,
    headline_text: "Which carrier do you want a quote from?",
    continue_mode: "button",
    status: "active",
    content_json: {
      components: [
        {
          type: "QuestionHeadline",
          question_id: "r2fix_q_head",
          props: { text: "Which carrier do you want a quote from?" },
        },
        {
          type: "ButtonAnswerGroup",
          question_id: "r2fix_q_carrier",
          question_key: FIELD_NAME,
          internal_field: FIELD_NAME,
          answer_type: "enum",
          required: true,
          choices: CHOICES.map((c) => ({ label: c.label, value: c.value, analytics_id: `r2fix_${c.value}` })),
        },
        { type: "ContinueButton", question_id: "r2fix_q_cont", props: { label: "Continue" } },
      ],
    },
    selected_offers: [offerId],
    answer_maps: [
      {
        question_id: "r2fix_q_carrier",
        offer_id: offerId,
        offer_payload_field_path: `lead.${FIELD_NAME}`,
        provider_expected_type: "string",
        required_for_offer: true,
        internal_field: FIELD_NAME,
        answer_type: "enum",
        output_value_map: Object.fromEntries(CHOICES.map((c) => [c.value, c.value.toUpperCase()])),
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Auction (idempotent lookup by quote id + exact auction_name) + wiring.
// ---------------------------------------------------------------------------

async function ensureAuction(quoteId: number): Promise<{ id: number }> {
  const list = await call<{ items: Array<{ id: number; auction_name: string }> }>(
    "GET",
    `${LG}/auctions?quote=${quoteId}`,
  );
  const existing = list.items.find((a) => a.auction_name === AUCTION_NAME);
  if (existing !== undefined) return { id: existing.id };
  const created = await call<{ id: number }>("POST", `${LG}/auctions`, {
    auction_name: AUCTION_NAME,
    quote_id: quoteId,
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
  });
  return { id: created.id };
}

// PUT /auctions/:id/offers is a REPLACE-SET (idempotent-safe every run).
async function wireAuctionOffers(auctionId: number, placementId: number): Promise<void> {
  const res = await call<{ warnings?: Array<{ eligible?: boolean; reasons?: string[] }> }>(
    "PUT",
    `${LG}/auctions/${auctionId}/offers`,
    { offers: [{ offer_placement_id: placementId, static_order: 0, enabled: true }] },
  );
  const flagged = (res.warnings ?? []).find((w) => w.eligible === false);
  if (flagged !== undefined) {
    throw new Error(`wireAuctionOffers: offer flagged ineligible: ${JSON.stringify(flagged.reasons ?? [])}`);
  }
}

// PUT /variants/:id is a REPLACE-SET (idempotent-safe every run).
async function wireVariant(variantPublicId: string, auctionId: number, buttonsSectionId: number): Promise<void> {
  await call("PUT", `${LG}/variants/${variantPublicId}`, {
    auction_id: auctionId,
    sections: [{ section_id: buttonsSectionId, position: 0 }],
  });
}

// POST creates (409s on a second call — a quote has exactly one shared
// page); PUT replaces. Probe first so a re-run uses the correct verb.
async function ensureSharedPage(quotePublicId: string, sharedSectionId: number): Promise<void> {
  const existing = await call<{ shared_page: unknown }>("GET", `${LG}/quotes/${quotePublicId}/shared-page`);
  if (existing.shared_page === null || existing.shared_page === undefined) {
    await call("POST", `${LG}/quotes/${quotePublicId}/shared-page`, { sections: [{ section_id: sharedSectionId }] });
  } else {
    await call("PUT", `${LG}/quotes/${quotePublicId}/shared-page`, { sections: [{ section_id: sharedSectionId }] });
  }
}

async function ensureDefaultFunnel(quotePublicId: string, funnelPublicId: string): Promise<void> {
  await call("PUT", `${LG}/quotes/${quotePublicId}/default-funnel`, { funnel_id: funnelPublicId });
}

// The B1-fixed path: PUT /quotes/:id/activation/:site_id. Asserts enabled=1.
async function activateQuote(quotePublicId: string, siteId: string): Promise<void> {
  const res = await call<{ enabled?: number | boolean }>(
    "PUT",
    `${LG}/quotes/${quotePublicId}/activation/${siteId}`,
    { enabled: true, slug: FUNNEL_SLUG },
  );
  const isEnabled = res.enabled === 1 || res.enabled === true;
  if (!isEnabled) {
    throw new Error(`activateQuote: activation did not report enabled=1 (got ${JSON.stringify(res.enabled)})`);
  }
}

// ---------------------------------------------------------------------------
// Throw-away local "provider" — no product source changes, no external
// process: a plain node:http server on an OS-picked ephemeral port that
// always answers 200 with one canned carrier (matches carrier_parse_json
// above). Torn down before the script exits.
// ---------------------------------------------------------------------------

interface MockProvider {
  url: string;
  close: () => Promise<void>;
}

function startMockProvider(): Promise<MockProvider> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      req.on("data", () => {
        /* drain the request body; the canned response never depends on it */
      });
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            carriers: [
              {
                id: "r2fix-carrier-1",
                name: "R2Fix Mock Carrier",
                logo: "http://127.0.0.1/r2fix-logo.png",
                bid: 5.5,
                currency: "USD",
                headline: "See your R2Fix quote",
              },
            ],
          }),
        );
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("startMockProvider: failed to bind an ephemeral port"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/mock`,
        close: () => new Promise<void>((res2) => server.close(() => res2())),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// --drive: a real visitor attempt through the seeded funnel — real UA, GET
// the funnel shell, GET /lg/config + GET /lg/attempt (the v2 mint, matching
// test/leadgen-r1-auction-roundtrip.test.ts's mintLiveAttempt), answer the
// Buttons question, POST /lg/auction. Node's global fetch() silently drops a
// caller-supplied Host header (verified: undici enforces the forbidden-
// header list), so this uses node:http directly with an explicit Host
// header — the SAME mechanism chromium's --host-resolver-rules achieves for
// the Playwright *.e2e.test suites, just without needing a DNS override.
// ---------------------------------------------------------------------------

function rawRequest(opts: {
  hostname: string;
  port: number;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { hostname: opts.hostname, port: opts.port, path: opts.path, method: opts.method, headers: opts.headers },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          data += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: data }));
      },
    );
    request.on("error", reject);
    if (opts.body !== undefined) request.write(opts.body);
    request.end();
  });
}

function parseJsonOrThrow<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label}: response was not JSON: ${text.slice(0, 300)}`);
  }
}

async function driveVisitor(variantPublicId: string): Promise<void> {
  const target = new URL(LG_BASE);
  const hostname = target.hostname;
  const port = Number(target.port !== "" ? target.port : target.protocol === "https:" ? 443 : 80);
  const headers: Record<string, string> = { Host: SITE_DOMAIN, "User-Agent": REAL_UA };

  const shell = await rawRequest({ hostname, port, path: `/lg/${FUNNEL_SLUG}`, method: "GET", headers });
  if (shell.status !== 200) {
    throw new Error(`drive: GET /lg/${FUNNEL_SLUG} -> HTTP ${shell.status}: ${shell.text.slice(0, 300)}`);
  }
  console.log(`DRIVE: GET /lg/${FUNNEL_SLUG} -> HTTP ${shell.status}`);

  const config = await rawRequest({
    hostname,
    port,
    path: `/lg/config/${variantPublicId}`,
    method: "GET",
    headers,
  });
  if (config.status !== 200) {
    throw new Error(`drive: GET /lg/config -> HTTP ${config.status}: ${config.text.slice(0, 300)}`);
  }
  const configJson = parseJsonOrThrow<{ section_order_hash: string }>(config.text, "GET /lg/config");
  console.log(`DRIVE: GET /lg/config/${variantPublicId} -> HTTP ${config.status}`);

  const landingUrl = encodeURIComponent(`http://${SITE_DOMAIN}/lg/${FUNNEL_SLUG}`);
  const attempt = await rawRequest({
    hostname,
    port,
    path: `/lg/attempt?funnel_variant_id=${variantPublicId}&u=${landingUrl}`,
    method: "GET",
    headers,
  });
  if (attempt.status !== 200) {
    throw new Error(`drive: GET /lg/attempt -> HTTP ${attempt.status}: ${attempt.text.slice(0, 300)}`);
  }
  const attemptJson = parseJsonOrThrow<{ funnel_attempt_id: string; signed_config_token: string; session_id: string }>(
    attempt.text,
    "GET /lg/attempt",
  );
  console.log(`DRIVE: GET /lg/attempt -> HTTP ${attempt.status} funnel_attempt_id=${attemptJson.funnel_attempt_id}`);

  const answeredChoice = CHOICES[1] ?? CHOICES[0];
  if (answeredChoice === undefined) throw new Error("drive: no fixture choice defined");
  const requestBody = JSON.stringify({
    funnel_variant_id: variantPublicId,
    funnel_attempt_id: attemptJson.funnel_attempt_id,
    section_order_hash: configJson.section_order_hash,
    signed_config_token: attemptJson.signed_config_token,
    session_id: attemptJson.session_id,
    page_view_id: "r2fix-drive-pv-1",
    answers: { [FIELD_NAME]: { value: answeredChoice.value, answer_source: "user_selected" } },
  });
  const auction = await rawRequest({
    hostname,
    port,
    path: "/lg/auction",
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(requestBody)),
    },
    body: requestBody,
  });
  console.log(`DRIVE: POST /lg/auction -> HTTP ${auction.status} body=${auction.text.slice(0, 500)}`);
  if (auction.status !== 200) {
    throw new Error(`drive: POST /lg/auction -> HTTP ${auction.status}: ${auction.text.slice(0, 500)}`);
  }
  console.log(`DRIVE: answered ${FIELD_NAME}=${answeredChoice.value}`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const drive = process.argv.includes("--drive");
  const mock = await startMockProvider();
  try {
    const siteId = await ensureSite();
    const offer = await ensureOffer();
    await ensureOfferEndpointsAndSchema(offer, mock.url);
    const quote = await ensureQuote();
    const sharedSection = await ensureSharedSection();
    const buttonsSection = await ensureButtonsSection(offer.id);
    const auction = await ensureAuction(quote.id);
    await wireAuctionOffers(auction.id, offer.placementId);
    await wireVariant(quote.variantPublicId, auction.id, buttonsSection.id);
    await ensureSharedPage(quote.publicId, sharedSection.id);
    await ensureDefaultFunnel(quote.publicId, quote.funnelPublicId);
    await activateQuote(quote.publicId, siteId);

    console.log("R2Fix leadgen fixture ready:");
    console.log(`  activity=${ACTIVITY} vertical=${VERTICAL}`);
    console.log(`  site_id=${siteId} domain=${SITE_DOMAIN}`);
    console.log(`  offer_id=${offer.id} offer_public_id=${offer.publicId} placement_id=${offer.placementId}`);
    console.log(`  quote_id=${quote.id} quote_public_id=${quote.publicId}`);
    console.log(`  funnel_public_id=${quote.funnelPublicId} variant_public_id=${quote.variantPublicId}`);
    console.log(`  shared_section_id=${sharedSection.id} buttons_section_id=${buttonsSection.id}`);
    console.log(`  auction_id=${auction.id}`);
    console.log(`  funnel_slug=${FUNNEL_SLUG} field=${FIELD_NAME}`);
    console.log("ACTIVATED");

    if (drive) {
      await driveVisitor(quote.variantPublicId);
    }
  } finally {
    await mock.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
