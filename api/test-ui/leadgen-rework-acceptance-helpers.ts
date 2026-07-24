// LEADGEN-REWORK-03 — P6 acceptance shared helpers (slice S6.1a).
//
// The terminal §11 acceptance suites (leadgen-rework-acceptance-builder /
// -routing .gesture.spec.ts) drive the REAL system: real admin CRUD through
// the live admin API, real composed public /lg routes for visitor-side proofs,
// real page.mouse gestures for the board. Nothing here injects content or
// shortcuts a unit — every seed goes through the SAME admin HTTP endpoints the
// operator uses, and every visitor proof goes through the SAME activation → /lg
// path a real visitor hits. This module is the ONE place those two suites share
// their seed + journey plumbing; S6.1b will import it READ-ONLY, so it stays
// dependency-light (only @playwright/test types, node:child_process for the
// outcome read, and the shared listicles-p6-seed site provisioner) and every
// export is documented.
//
// GROUND TRUTH (all file:line re-verified this slice against origin/main):
//   • #lg-funnel-root carries data-funnel-id / data-funnel-variant-id /
//     data-quote-id (frame.ts:163-166, 1162-1165) — the ENTRY-routing observable
//     (the served funnel is chosen at shell-serve, resolver.ts deriveOs/entry
//     rules; unit-proven leadgen-rework-routing.test.ts "os SHELL-SERVE parity").
//   • The progress region re-stamps data-lg-progress-current / -total on every
//     section change (render.ts:131-132) — the §4.3-11 denominator observable.
//   • CHECKPOINT routing rides POST /lg/ck, whose response is
//     {sw, v(target variant), r(resume section), ar} (runtime-routes.ts
//     serveLeadgenCheckpoint ~440-527). serve.ts renders ONLY resolved.sections
//     (the served funnel's — line 737-738), so the robust checkpoint observable
//     is the /lg/ck network response captured in the browser, not a client
//     re-render of the target funnel's (un-served) section HTML.
//   • Routing outcomes (routed_to_funnel / feed_name / value_multiplier) land in
//     leadgen_routing_outcomes (runtime-routes.ts recordRoutingOutcome ~334-351);
//     there is no public outcomes endpoint, so a live-recorded outcome is read
//     back with `wrangler d1 execute --local` (the __p4a-routing.spec.ts idiom).
//   • Admin API shapes (re-verified quotes-handlers.ts / router.ts):
//       POST   /quotes                                   → {id, public_id, funnels:[{public_id, variants:[{public_id}]}]}
//       POST   /sections                                 → {id, public_id}
//       POST   /quotes/:id/funnels     {funnel_name}     → funnel + variants
//       POST   /quotes/:id/shared-page {sections:[{section_id}]}
//       PUT    /variants/:id           {sections|pages}
//       PUT    /quotes/:id/default-funnel {funnel_id}    (accepts numeric id or lgf_ public id)
//       POST   /quotes/:id/routing-rules {rule_name,priority,status,match_mode,conditions_json,target_funnel_id,feed_name,value_multiplier,redirect_pct,target_offer_id,redirect_url}
//       GET    /quotes/:id/routing-rules                 → {items:[…]}
//       PUT    /quotes/:id/activation/:site_id {enabled,slug}
//       GET    /quotes/:id/analytics                     → {analytics:{…,breakdowns:{by_routed_funnel,by_feed_name}}}
//     conditions_json shape (validateRoutingConditionsShape) = {groups:[{field,op,value?}]}.

import { execFileSync } from "node:child_process";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { seedActiveSite } from "./listicles-p6-seed";
import { PW_PORT } from "./utils/base-url";

export const PORT = PW_PORT;
export const ORIGIN = `http://127.0.0.1:${PORT}`;
export const LG_API = "/api/admin/leadgen";
export const LOCAL_D1_NAME = "kodigital-homepages-cms-db";

// A realistic desktop Chrome UA: the live /lg/auction runtimeRequestGuard 403s
// a headless UA in dev (no request.cf locally) — the leadgen-live-funnel.spec.ts
// DEV-GUARD contract. Inert to non-auction legs; the default UA for both suites.
export const REAL_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
// An iPhone UA: deriveOs (resolver.ts:925 match order iPhone/iPad/iPod → "ios")
// buckets it "ios" for the OS-conditioned entry-routing acceptance leg.
export const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

export interface Created {
  id: number;
  public_id: string;
}

// A unique suffix disjoint from every sibling spec's fixtures (the "acc6-"
// prefix is emitted by NO other test-ui/*.spec.ts — grep to confirm), so the
// default BOTH-project run (chromium then firefox, one persisted wrangler-dev
// D1, no inter-project reset) never collides two same-named rows.
export function uniqueTag(base: string): string {
  return `acc6-${base}-${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

// A ContinueButton-only pass-through section (a shared/first page that needs no
// answer). §4.3-15 activation preflight requires the shared page to carry ≥1
// section; this is the trivial one.
export const CONTINUE_ONLY = [{ type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } }];

// Create a studio-authorable Section through the REAL admin API. `components`
// is the content_json.components array. activity/vertical default to the
// quote_funnel/life pair every seeded quote here uses.
export async function createSection(
  request: APIRequestContext,
  name: string,
  components: unknown[],
  extra: Record<string, unknown> = {},
): Promise<Created> {
  return json<Created>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: name,
        activity: "quote_funnel",
        vertical: "life",
        headline_text: name,
        status: "active",
        content_json: { components },
        ...extra,
      },
    }),
    `section create (${name})`,
  );
}

// A section whose ButtonAnswerGroup renders a DISTINCTIVE headline + a single
// required choice question — the visitor-side "which funnel served" observable:
// each funnel gets its own, so the served funnel is identifiable by its headline
// text on the live /lg page. `field` is the question's internal_field (joins the
// rule condition + answer store); choices default to a yes/no-value pair.
export async function distinctiveSection(
  request: APIRequestContext,
  headline: string,
  field: string,
  choices: Array<{ label: string; value: string }> = [
    { label: "Yes", value: "yes" },
    { label: "No", value: "no" },
  ],
): Promise<Created> {
  return createSection(request, headline, [
    // A ProgressBar so [data-lg-progress] exists in the DOM — the engine stamps
    // data-lg-progress-total across the resolved plan (render.ts:132), the
    // §4.3-11 denominator observable.
    { type: "ProgressBar", question_id: `${field}_progress`, props: { mode: "step" } },
    { type: "QuestionHeadline", question_id: `${field}_head`, props: { text: headline } },
    {
      type: "ButtonAnswerGroup",
      question_id: `q_${field}`,
      question_key: field,
      internal_field: field,
      answer_type: "enum",
      required: true,
      choices: choices.map((ch) => ({ ...ch, analytics_id: `${field}_${ch.value}` })),
    },
    { type: "ContinueButton", question_id: `${field}_cont`, props: { label: "Continue" } },
  ]);
}

export interface SeededFunnel {
  public_id: string;
  variant_public_id: string;
  headline: string; // the distinctive section headline this funnel serves
}

export interface RoutingSeedSpec {
  tag: string;
  // The shared first page: a question (field + choices) the visitor answers, OR
  // a pass-through ContinueButton page when `sharedQuestionField` is omitted.
  sharedHeadline?: string;
  sharedQuestionField?: string;
  sharedChoices?: Array<{ label: string; value: string }>;
  // Funnels beyond the auto-created one. The auto funnel is funnels[0]; each
  // extra funnel gets a distinctive section. `pagesPerFunnel` lets a funnel
  // carry >1 page so the §4.3-11 progress denominator differs between funnels.
  funnels: Array<{ headline: string; field: string; pages?: number }>;
  defaultFunnelIndex?: number; // which funnel is the quote default (0-based)
  activate?: boolean; // PUT activation (default true)
}

export interface RoutingSeed {
  host: string;
  slug: string;
  siteId: string;
  quotePublicId: string;
  quoteId: number;
  funnels: SeededFunnel[];
  sharedHeadline: string;
  sharedField: string | null;
}

// The routing workhorse: site + quote + shared first page + N funnels (each
// with its own distinctive section) + default funnel + optional activation, all
// through the REAL admin API. Returns the identifiers the journeys observe.
// Rules are added separately (createRoutingRule) so a test can author them
// through the real modal or seed them via the API as its clause requires.
export async function seedRoutingQuote(request: APIRequestContext, s: RoutingSeedSpec): Promise<RoutingSeed> {
  const tag = s.tag;
  const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const host = `${tag}-${uniq}.e2e.test`;
  const slug = `${tag}`.replace(/[^a-z0-9-]/gi, "").toLowerCase();
  const siteId = await seedActiveSite(request, host, `ACC6 ${tag} ${uniq}`);

  const quote = await json<{
    id: number;
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  }>(
    await request.post(`${LG_API}/quotes`, {
      data: { quote_name: `ACC6 ${tag} ${uniq}`, activity: "quote_funnel", verticals: ["life"] },
    }),
    "quote create",
  );

  // Shared first page (§4.3-1) — a question when the clause needs a checkpoint
  // answer, else a pass-through Continue.
  const sharedField = s.sharedQuestionField ?? null;
  const sharedHeadline = s.sharedHeadline ?? `ACC6 shared ${tag}`;
  const sharedSection =
    sharedField !== null
      ? await distinctiveSection(request, sharedHeadline, sharedField, s.sharedChoices)
      : await createSection(request, sharedHeadline, [
          { type: "ProgressBar", question_id: "shared_progress", props: { mode: "step" } },
          { type: "QuestionHeadline", question_id: "shared_head", props: { text: sharedHeadline } },
          ...CONTINUE_ONLY,
        ]);
  await json(
    await request.post(`${LG_API}/quotes/${quote.public_id}/shared-page`, {
      data: { sections: [{ section_id: sharedSection.id }] },
    }),
    "shared page create",
  );

  // Funnel 0 = the auto-created funnel; give it the first spec funnel's section.
  const funnels: SeededFunnel[] = [];
  for (let i = 0; i < s.funnels.length; i++) {
    const f = s.funnels[i]!;
    const sec = await distinctiveSection(request, f.headline, f.field);
    const pageCount = f.pages ?? 1;
    // extra pages carry their own trivial section so the funnel spans >1 page
    // (a different §4.3-11 denominator than a 1-page funnel).
    const pages: Array<{ name: string | null; slots: Array<{ kind: string; section_id: number }> }> = [
      { name: null, slots: [{ kind: "fixed", section_id: sec.id }] },
    ];
    for (let p = 1; p < pageCount; p++) {
      const extra = await createSection(request, `${f.headline} p${p + 1}`, [
        { type: "QuestionHeadline", question_id: `xp${p}_head`, props: { text: `${f.headline} page ${p + 1}` } },
        ...CONTINUE_ONLY,
      ]);
      pages.push({ name: null, slots: [{ kind: "fixed", section_id: extra.id }] });
    }

    let funnelPublicId: string;
    let variantPublicId: string;
    if (i === 0) {
      funnelPublicId = quote.funnels[0]!.public_id;
      variantPublicId = quote.funnels[0]!.variants[0]!.public_id;
    } else {
      const created = await json<{ public_id: string; variants: Array<{ public_id: string }> }>(
        await request.post(`${LG_API}/quotes/${quote.public_id}/funnels`, { data: { funnel_name: f.headline } }),
        `funnel create (${f.headline})`,
      );
      funnelPublicId = created.public_id;
      variantPublicId = created.variants[0]!.public_id;
    }
    await json(await request.put(`${LG_API}/variants/${variantPublicId}`, { data: { pages } }), `variant pages (${f.headline})`);
    funnels.push({ public_id: funnelPublicId, variant_public_id: variantPublicId, headline: f.headline });
  }

  // Default funnel (§4.3-7): required at activation.
  const defaultIdx = s.defaultFunnelIndex ?? 0;
  await json(
    await request.put(`${LG_API}/quotes/${quote.public_id}/default-funnel`, {
      data: { funnel_id: funnels[defaultIdx]!.public_id },
    }),
    "set default funnel",
  );

  if (s.activate !== false) {
    await json(
      await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug } }),
      "activation",
    );
  }

  return { host, slug, siteId, quotePublicId: quote.public_id, quoteId: quote.id, funnels, sharedHeadline, sharedField };
}

export interface RuleActions {
  target_funnel_id?: string; // funnel public id (lgf_…)
  feed_name?: string;
  value_multiplier?: number;
  redirect_pct?: number;
  redirect_url?: string;
  target_offer_id?: number;
}

// Create a quote-scoped routing rule through the REAL admin API. conditions is
// the §21.4 {groups:[{field,op,value}]} shape.
export async function createRoutingRule(
  request: APIRequestContext,
  quotePublicId: string,
  opts: {
    rule_name: string;
    priority: number;
    conditions: { groups: Array<{ field: string; op: string; value?: unknown }> };
    match_mode?: "all" | "any";
    status?: "active" | "disabled";
  } & RuleActions,
): Promise<Record<string, unknown>> {
  return json(
    await request.post(`${LG_API}/quotes/${quotePublicId}/routing-rules`, {
      data: {
        rule_name: opts.rule_name,
        priority: opts.priority,
        status: opts.status ?? "active",
        match_mode: opts.match_mode ?? "all",
        conditions_json: opts.conditions,
        ...(opts.target_funnel_id !== undefined ? { target_funnel_id: opts.target_funnel_id } : {}),
        ...(opts.feed_name !== undefined ? { feed_name: opts.feed_name } : {}),
        ...(opts.value_multiplier !== undefined ? { value_multiplier: opts.value_multiplier } : {}),
        ...(opts.redirect_pct !== undefined ? { redirect_pct: opts.redirect_pct } : {}),
        ...(opts.redirect_url !== undefined ? { redirect_url: opts.redirect_url } : {}),
        ...(opts.target_offer_id !== undefined ? { target_offer_id: opts.target_offer_id } : {}),
      },
    }),
    `routing rule create (${opts.rule_name})`,
  );
}

// ---------------------------------------------------------------------------
// Live-funnel navigation + observation
// ---------------------------------------------------------------------------

export const shellUrl = (host: string, slug: string, query = ""): string =>
  `http://${host}:${PORT}/lg/${slug}${query}`;

// The funnel engine has hydrated when #lg-funnel-root[data-lg-ready="1"] exists.
export async function ready(page: Page): Promise<void> {
  await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 12_000 });
}

// Read a #lg-funnel-root identity attribute (data-funnel-variant-id /
// data-funnel-id / data-quote-id) — the ENTRY-routing observable.
export async function funnelRootAttr(page: Page, attr: string): Promise<string | null> {
  return page.locator("#lg-funnel-root").getAttribute(attr);
}

// The current progress denominator the engine has stamped (§4.3-11). Reads the
// first [data-lg-progress] region's data-lg-progress-total (render.ts:132).
export async function progressTotal(page: Page): Promise<number> {
  const el = page.locator("[data-lg-progress]").first();
  const raw = await el.getAttribute("data-lg-progress-total");
  return raw === null ? NaN : Number(raw);
}

// Click the shared first page's Continue once (pass-through shared page).
export async function passSharedPage(page: Page): Promise<void> {
  const cont = page.locator("[data-lg-continue]").first();
  await expect(cont, "the shared page's Continue is reachable").toBeVisible({ timeout: 8_000 });
  await cont.click();
}

// Capture every POST /lg/ck response the engine makes (the checkpoint-routing
// decision — the robust live observable for a shared/in-funnel answer rule).
// Install BEFORE navigation. Returns the growing array of parsed responses.
export interface CkResponse {
  sw: boolean;
  v?: string;
  r?: string;
  ar?: string;
}
export function captureCheckpoints(page: Page): CkResponse[] {
  const out: CkResponse[] = [];
  page.on("response", (res) => {
    if (res.request().method() !== "POST" || !res.url().includes("/lg/ck")) return;
    void res
      .json()
      .then((body) => out.push(body as CkResponse))
      .catch(() => {
        /* non-JSON — ignore */
      });
  });
  return out;
}

// The dynamic *.e2e.test tenant host resolves only under chromium's
// --host-resolver-rules; firefox's network.dns.localDomains cannot resolve a
// wildcard suffix (the repo-wide constraint every live-/lg gate documents:
// leadgen-operator-acceptance / leadgen-p1-geometry / __p2b-phone). A live leg
// guarded by this records a DOCUMENTED skip annotation on firefox and returns
// after its both-engine (admin/board/rules) assertions ran first.
export function liveLegChromiumOnly(browserName: string, reason: string): boolean {
  if (browserName === "firefox") {
    test.info().annotations.push({ type: "live-leg-skip", description: reason });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Board pointer-drag (the in-house engine — main-document streams deliver on
// BOTH engines, no srcdoc caveat). Mirrors leadgen-rework-p3b-board's helper.
// ---------------------------------------------------------------------------
export async function dragCenterToCenter(page: Page, source: Locator, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await source.scrollIntoViewIfNeeded();
  const s = await source.boundingBox();
  const t = await target.boundingBox();
  if (!s || !t) throw new Error("drag: missing bounding box");
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move(s.x + s.width / 2 + 8, s.y + s.height / 2 + 8, { steps: 4 });
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 10 });
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2 + 2, { steps: 2 });
  await page.mouse.up();
}

// Read a row from the LOCAL D1 the wrangler-dev worker writes to (the
// __p4a-routing.spec.ts idiom). Used to read a LIVE-recorded routing outcome
// (leadgen_routing_outcomes has no public endpoint). --json returns
// [{ results: [...] }]. Read-only SELECTs only.
export function d1Query<T = Record<string, unknown>>(sql: string): T[] {
  const raw = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", LOCAL_D1_NAME, "--local", "--json", "--command", sql],
    { cwd: process.cwd(), stdio: "pipe", timeout: 120_000 },
  ).toString();
  // wrangler prints a banner before the JSON; slice from the first '['.
  const start = raw.indexOf("[");
  if (start < 0) throw new Error(`d1Query: no JSON in wrangler output: ${raw.slice(0, 400)}`);
  const parsed = JSON.parse(raw.slice(start)) as Array<{ results?: T[] }>;
  return parsed[0]?.results ?? [];
}
