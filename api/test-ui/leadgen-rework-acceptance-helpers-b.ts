// LEADGEN-REWORK-03 — P6 acceptance shared helpers (slice S6.1b).
//
// The terminal §11 component + input acceptance suites
// (leadgen-rework-acceptance-components / -inputs .gesture.spec.ts) drive the
// REAL system: real admin CRUD through the live admin API, real composed public
// /lg routes for visitor-side proofs, real page gestures + real /lg/track beacon
// interception + the real /lg/auction endpoint with the mock provider (:8788) as
// the downstream sink. Nothing here injects content or shortcuts a unit. This
// module is the ONE place S6.1b's two specs share their seed + observation
// plumbing; it imports S6.1a's helpers (READ-ONLY) for the primitives they
// already own and adds only what those two specs additionally need.
//
// GROUND TRUTH (file:line re-verified this slice):
//   • The runtime BEACONS every event over a real POST /lg/track; sendBeacon is
//     disabled per page so the engine's fetch(keepalive) fallback rides a body
//     Playwright can read (leadgen-live-funnel.spec.ts EVIDENCE DISCIPLINE).
//     answer_default_applied / answer_click / answer_change / validation_error
//     carry `internal_field`, `answer_value_normalized`, `answer_source`.
//   • answer provenance: config-dto.ts:461-464 seeds a node's props.defaultValue
//     as { answer_source: "default_applied" }; runtime/state.ts setAnswer flips a
//     changed value to "user_selected" (same value → "user_confirmed_default").
//   • The /lg/auction POST body carries `answers: Record<field,{value,
//     answer_source}>` — the auction PROJECTION (state.auctionAnswers minus
//     dependencies.ts hiddenAnswerFields): a dependency-hidden field is ABSENT
//     from it (§4.2). The worker forwards a provider payload built from that
//     projection to the offer endpoint (→ the mock :8788, captured at /__requests).
//   • The full eligible offer→schema→test-tool→auction→participation→activation
//     seed that makes the auction FILL (so the provider/mock is actually called)
//     is leadgen-fix-p1-seed.ts's proven flow — seedAuctionFunnel below adapts it
//     verbatim in shape, differing ONLY in the sections + payload schema.
//   • Studio: /admin/leadgen/sections/:public/edit; canvas srcdoc iframe
//     #lg-studio-canvas-frame → #lg-studio-canvas-render; palette insert
//     [data-add-component="<Type>"]; inspector tab [data-studio-inspector-tab];
//     save #lg-section-save (PATCH /sections/:public). (leadgen-rework-p2-studio.)

import { mkdirSync } from "node:fs";
import { expect, type APIRequestContext, type FrameLocator, type Locator, type Page } from "@playwright/test";
import { seedActiveSite } from "./listicles-p6-seed";
import { MOCK_PROVIDER_ENDPOINT, BANNER_URL_TEMPLATE } from "./leadgen-fix-p1-seed";
import { LG_API, ORIGIN, PORT, json, createSection, type Created } from "./leadgen-rework-acceptance-helpers";

export const MOCK_ORIGIN = "http://127.0.0.1:8788";

// ---------------------------------------------------------------------------
// /lg/track beacon capture (the E4 network-verified answer-provenance observable).
// Install BEFORE page.goto. Mirrors leadgen-live-funnel.spec.ts installTrackCapture.
// ---------------------------------------------------------------------------
export type TrackedEvent = Record<string, unknown>;
export async function installTrackCapture(page: Page): Promise<TrackedEvent[]> {
  const events: TrackedEvent[] = [];
  await page.addInitScript(() => {
    try {
      delete (Navigator.prototype as unknown as Record<string, unknown>)["sendBeacon"];
    } catch {
      /* prototype sealed */
    }
    try {
      Object.defineProperty(navigator, "sendBeacon", { get: () => undefined });
    } catch {
      /* keep sendBeacon */
    }
  });
  page.on("request", (req) => {
    if (req.method() !== "POST" || !req.url().includes("/lg/track")) return;
    const body = req.postData();
    if (body === null) return;
    try {
      const parsed = JSON.parse(body) as { events?: TrackedEvent[] };
      if (Array.isArray(parsed.events)) events.push(...parsed.events);
    } catch {
      /* non-JSON — ignore */
    }
  });
  return events;
}
export function ofType(events: TrackedEvent[], type: string): TrackedEvent[] {
  return events.filter((e) => e["event_type"] === type);
}

// ---------------------------------------------------------------------------
// Mock provider (:8788) sink — the downstream provider payload the worker sends
// during a live auction. scripts/leadgen-mock-provider.ts: POST /__reset (204),
// GET /__requests → [{ method, url, headers, body, received_at }].
// ---------------------------------------------------------------------------
export interface MockCapturedRequest {
  method: string;
  url: string;
  body: string;
}
export async function resetMockProvider(request: APIRequestContext): Promise<void> {
  await request.post(`${MOCK_ORIGIN}/__reset`);
}
// The parsed JSON bodies of every POST the worker made to the mock /mock endpoint
// (the provider payloads). Read-only observation.
export async function readMockPayloads(request: APIRequestContext): Promise<Array<Record<string, unknown>>> {
  const res = await request.get(`${MOCK_ORIGIN}/__requests`);
  const rows = (await res.json()) as MockCapturedRequest[];
  const payloads: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    if (r.method !== "POST" || !r.url.includes("/mock")) continue;
    try {
      payloads.push(JSON.parse(r.body) as Record<string, unknown>);
    } catch {
      /* non-JSON body — skip */
    }
  }
  return payloads;
}
// Flatten a nested payload object to dotted leaf paths (so a test can assert a
// mapped offer_payload_field_path like "lead.current_insurer" is present/absent).
export function flattenPaths(obj: unknown, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (obj === null || typeof obj !== "object") {
    if (prefix !== "") out[prefix] = obj;
    return out;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix === "" ? k : `${prefix}.${k}`;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flattenPaths(v, path));
    } else {
      out[path] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Studio (Section Studio) — open / select on canvas / inspector tab / save.
// Mirrors leadgen-rework-p2-studio.gesture.spec.ts's own helpers (engine-agnostic).
// ---------------------------------------------------------------------------
export const frameOf = (page: Page): FrameLocator => page.frameLocator("#lg-studio-canvas-frame");
export const canvasRender = (page: Page): Locator => frameOf(page).locator("#lg-studio-canvas-render");

export async function openStudioEdit(page: Page, publicId: string): Promise<void> {
  await page.goto(`/admin/leadgen/sections/${publicId}/edit`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#lg-section-name")).toBeVisible({ timeout: 15_000 });
  await expect(frameOf(page).locator("[data-question-id]").first()).toBeVisible({ timeout: 15_000 });
}
export async function openInspectorTab(page: Page, key: string): Promise<void> {
  const tab = page.locator(`[data-studio-inspector-tab="${key}"]`);
  await expect(tab).toBeVisible();
  await tab.click();
}
export function palette(page: Page, type: string): Locator {
  return page.locator(`[data-add-component="${type}"]`);
}
export async function saveStudioAwaitOk(page: Page, publicId: string): Promise<void> {
  const loaded = page.waitForEvent("load", { timeout: 15_000 }).catch(() => null);
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes(`/sections/${publicId}`) && r.request().method() === "PATCH"),
    page.locator("#lg-section-save").click(),
  ]);
  if (!res.ok()) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* body gone after navigation */
    }
    throw new Error(`save PATCH ${res.status()}: ${detail}`);
  }
  await loaded;
}
export interface SectionDetail {
  content_json: { components: Array<Record<string, unknown>> };
}
export async function fetchSection(request: APIRequestContext, publicId: string): Promise<SectionDetail> {
  return json(await request.get(`${LG_API}/sections/${publicId}`), `section detail (${publicId})`);
}

// ---------------------------------------------------------------------------
// Live-funnel section-index selector (shared page is composed index 0, so a
// funnel's own first section is index 1). Mirrors leadgen-runtime-inputs.
// ---------------------------------------------------------------------------
export function sectionAt(page: Page, i: number): Locator {
  return page.locator(`[data-lg-section][data-lg-index="${i}"]`);
}
// The engine's live answer store (client parity), for store==DOM assertions.
export function engineAnswers(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(
    () => (window as unknown as { __LG_ENGINE__?: { getAnswers(): Record<string, unknown> } }).__LG_ENGINE__?.getAnswers() ?? {},
  );
}

// ===========================================================================
// seedSimpleFunnel — a live funnel (NO auction) from pre-created section ids:
// site + quote + trivial pass-through shared page + one funnel (its variant
// carries the ordered sections) + activation. For the non-auction live proofs
// (#2A provenance, #4 marker, #9 centering, #1 render, #2C block leg, #3/#5–#10
// runtime). Mirrors leadgen-rework-p2-studio.gesture.spec.ts seedLiveFunnel.
// ===========================================================================
export interface SimpleFunnelSeed {
  host: string;
  slug: string;
  siteId: string;
  quotePublicId: string;
  variantPublicId: string;
}
export async function seedSimpleFunnel(request: APIRequestContext, tag: string, sectionIds: number[]): Promise<SimpleFunnelSeed> {
  const u = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const host = `acc6b-${tag}-${u}.e2e.test`;
  const slug = `acc6b-${tag}-${u}`.replace(/[^a-z0-9-]/gi, "").toLowerCase();
  const siteId = await seedActiveSite(request, host, `ACC6B ${tag} ${u}`);
  const quote = await json<{ public_id: string; funnels: Array<{ variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, { data: { quote_name: `ACC6B ${tag} ${u}`, activity: "quote_funnel", verticals: ["life"] } }),
    "quote create",
  );
  const variantPublicId = quote.funnels[0]!.variants[0]!.public_id;
  await json(
    await request.put(`${LG_API}/variants/${variantPublicId}`, { data: { sections: sectionIds.map((section_id) => ({ section_id })) } }),
    "variant sections",
  );
  const trivialShared = await createSection(request, `ACC6B shared ${tag} ${u}`, [
    { type: "ContinueButton", question_id: "q_shared_cont", props: { label: "Continue" } },
  ]);
  await json(
    await request.post(`${LG_API}/quotes/${quote.public_id}/shared-page`, { data: { sections: [{ section_id: trivialShared.id }] } }),
    "shared page create",
  );
  await json(
    await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug } }),
    "activation",
  );
  return { host, slug, siteId, quotePublicId: quote.public_id, variantPublicId };
}

// ===========================================================================
// seedAuctionFunnel — the FULL eligible-offer + auction live funnel (so the
// auction FILLS and the worker calls the provider → mock :8788 captures the real
// payload). Adapted verbatim in shape from leadgen-fix-p1-seed.ts; only the
// sections + payload schema are parameterised. For #2B (two fields → distinct
// offer paths) and #2C (dependency-hidden field absent from the payload).
// ===========================================================================
export interface AuctionSchemaChild {
  path: string;
  name: string;
  type: string;
  source: "answer" | "macro" | "computed" | "placement";
  internal_field?: string;
  required?: boolean;
  macro?: string;
  computed?: string;
  value_map?: Record<string, string>;
}
export interface AuctionSectionSpec {
  name: string;
  components: unknown[];
  continue_mode?: string;
  // If present, this section carries the offer answer-maps (which SELECTS the
  // offer on it — the activation preflight then demands every REQUIRED schema
  // path be mapped complete here).
  answerMaps?: (offerId: number) => Array<Record<string, unknown>>;
}
export interface AuctionSeedSpec {
  tag: string;
  sections: AuctionSectionSpec[]; // ordered funnel pages (one section each); last = auction fires after it
  schemaChildren: AuctionSchemaChild[];
  sampleAnswers: Record<string, unknown>; // covers every REQUIRED answer-sourced schema path (test-tool run)
}
export interface AuctionFunnelSeed {
  host: string;
  slug: string;
  siteId: string;
  quotePublicId: string;
  quoteId: number;
  variantPublicId: string;
  offerId: number;
  offerPublicId: string;
  sectionIds: number[];
  sectionPublicIds: string[];
  auctionId: number;
}
export async function seedAuctionFunnel(request: APIRequestContext, spec: AuctionSeedSpec): Promise<AuctionFunnelSeed> {
  const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const host = `acc6b-${spec.tag}-${uniq}.e2e.test`;
  const slug = `acc6b-${spec.tag}-${uniq}`.replace(/[^a-z0-9-]/gi, "").toLowerCase();
  const placementExternalId = `plc-acc6b-${uniq}`;
  const siteId = await seedActiveSite(request, host, `ACC6B ${spec.tag} ${uniq}`);

  // Offer (dynamic, server-mode) → mock endpoints → payload schema.
  const offer = await json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/offers`, {
      data: {
        offer_name: `ACC6B Offer ${spec.tag} ${uniq}`,
        provider: "mockprov",
        activity: "quote_funnel",
        vertical: "life",
        conversion_tracking_method: "s2s_postback",
        offer_type: "cpc",
        placements: [placementExternalId],
        calls_provider_api: true,
        bid_source: "response",
        cap_enabled: false,
      },
    }),
    "offer create",
  );
  const detail = await json<{ placements?: Array<{ id: number; placement_id: string }> }>(
    await request.get(`${LG_API}/offers/${offer.id}`),
    "offer detail",
  );
  const placement = (detail.placements ?? []).find((p) => p.placement_id === placementExternalId);
  if (placement === undefined) throw new Error(`seed: offer ${offer.public_id} has no placement row for ${placementExternalId}`);

  await json(
    await request.patch(`${LG_API}/offers/${offer.id}`, {
      data: {
        endpoint_production: MOCK_PROVIDER_ENDPOINT,
        endpoint_staging: MOCK_PROVIDER_ENDPOINT,
        request_method: "POST",
        banner_url_template: BANNER_URL_TEMPLATE,
        headers: [{ header_name: "X-Acc6b", value_kind: "static", value_text: `acc6b-${uniq}` }],
      },
    }),
    "offer patch endpoints",
  );
  await json(
    await request.post(`${LG_API}/offers/${offer.id}/payload-schemas`, {
      data: {
        schema_json: { version: 1, root: { type: "object", children: spec.schemaChildren } },
        carrier_parse_json: {
          carriers_path: "carriers",
          fields: { provider_id: "id", carrier_name: "name", carrier_logo: "logo", bid: "bid", bid_currency: "currency", headline: "headline", tracking_id: "tracking" },
        },
      },
    }),
    "payload schema create",
  );
  const testRun = await json<{ status_code?: number | null }>(
    await request.post(`${LG_API}/offers/${offer.id}/test`, { data: { environment: "staging", sample_answers: spec.sampleAnswers } }),
    "offer test run",
  );
  if (testRun.status_code !== undefined && testRun.status_code !== null && (testRun.status_code < 200 || testRun.status_code >= 300)) {
    throw new Error(`seed: test-tool run did not PASS (provider status ${testRun.status_code}) — is the mock provider up on :8788?`);
  }

  // Quote + sections (each optionally carrying the offer answer-maps).
  const quote = await json<{ id: number; public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, { data: { quote_name: `ACC6B Quote ${spec.tag} ${uniq}`, activity: "quote_funnel", verticals: ["life"] } }),
    "quote create",
  );
  const variantPublicId = quote.funnels[0]!.variants[0]!.public_id;

  const sectionIds: number[] = [];
  const sectionPublicIds: string[] = [];
  for (let i = 0; i < spec.sections.length; i++) {
    const sec = spec.sections[i]!;
    const maps = sec.answerMaps?.(offer.id);
    const created = await createSection(request, sec.name, sec.components, {
      continue_mode: sec.continue_mode ?? "button",
      ...(maps !== undefined ? { selected_offers: [offer.id], answer_maps: maps } : {}),
    });
    sectionIds.push(created.id);
    sectionPublicIds.push(created.public_id);
  }

  // Auction + participation (must NOT flag the offer ineligible or the live
  // auction is unfilled and the provider/mock never runs).
  const auction = await json<{ id: number }>(
    await request.post(`${LG_API}/auctions`, {
      data: {
        auction_name: `ACC6B Auction ${spec.tag} ${uniq}`,
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
      },
    }),
    "auction create",
  );
  const participation = await json<{ warnings?: Array<{ offer_id?: string; eligible?: boolean; reasons?: string[] }> }>(
    await request.put(`${LG_API}/auctions/${auction.id}/offers`, { data: { offers: [{ offer_placement_id: placement.id, static_order: 0 }] } }),
    "auction offers put",
  );
  const flagged = (participation.warnings ?? []).find((w) => w.offer_id === offer.public_id && w.eligible === false);
  if (flagged !== undefined) throw new Error(`seed: offer flagged ineligible at participation: ${JSON.stringify(flagged.reasons ?? [])}`);

  await json(
    await request.put(`${LG_API}/variants/${variantPublicId}`, {
      data: { auction_id: auction.id, sections: sectionIds.map((section_id, position) => ({ section_id, position })) },
    }),
    "variant sections+auction",
  );

  // Mandatory trivial shared first page (§4.3-1/§4.3-15) + activation (clean 200).
  const trivialShared = await createSection(request, `ACC6B shared ${spec.tag} ${uniq}`, [
    { type: "ContinueButton", question_id: "q_shared_cont", props: { label: "Continue" } },
  ]);
  await json(
    await request.post(`${LG_API}/quotes/${quote.public_id}/shared-page`, { data: { sections: [{ section_id: trivialShared.id }] } }),
    "shared page create",
  );
  const act = await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug } });
  if (!act.ok()) throw new Error(`seed: activation blocked HTTP ${act.status()} — ${await act.text()}`);

  return {
    host,
    slug,
    siteId,
    quotePublicId: quote.public_id,
    quoteId: quote.id,
    variantPublicId,
    offerId: offer.id,
    offerPublicId: offer.public_id,
    sectionIds,
    sectionPublicIds,
    auctionId: auction.id,
  };
}

// The dynamic *.e2e.test tenant host live-leg guard is S6.1a's liveLegChromiumOnly
// (imported READ-ONLY from ./leadgen-rework-acceptance-helpers by the two specs).
export const shellUrlFor = (host: string, slug: string, query = ""): string => `http://${host}:${PORT}/lg/${slug}${query}`;

// Visual-clause evidence (§11 "UI evidence via Playwright at 1280 + 375 where
// visual" / E6): full-page screenshots at BOTH the desktop (1280) and mobile
// (375) widths, saved under test-artifacts/acc6b/, and a no-horizontal-overflow
// assertion at 375 (scrollWidth ≤ innerWidth). Restores the 1280 viewport after.
export const ACC6B_SHOT_DIR = "test-artifacts/acc6b";
export async function captureResponsive(page: Page, name: string, opts: { assertNoOverflowAt375?: boolean } = {}): Promise<string[]> {
  mkdirSync(ACC6B_SHOT_DIR, { recursive: true });
  const out: string[] = [];
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const path = `${ACC6B_SHOT_DIR}/${name}-${width}.png`;
    await page.screenshot({ path, fullPage: true });
    out.push(path);
    if (width === 375 && opts.assertNoOverflowAt375 === true) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow, "no horizontal overflow at 375px").toBe(false);
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  return out;
}
export type { Created };
