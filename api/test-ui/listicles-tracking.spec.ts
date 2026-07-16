// Listicles Phase 7 — tracking + experimentation runtime e2e (§15.3 / §16 /
// §31.3–§31.6 / §31.9) against the REAL worker under wrangler dev (real
// HTMLRewriter injection, real KV cache, real /lc resolver over local D1).
//
// Composition of the fixture article (built from the shared p6 seed's 6
// sections via the pages override):
//   page 0 — ab_test 50/50 (sections[0] / sections[1])
//   page 1 — rule_based: rule device=desktop → sections[2]; fallback →
//            sections[3]  (fires DETERMINISTICALLY under Desktop Chrome)
//   page 2 — rule_based: rule device=mobile  → sections[4]; fallback →
//            sections[5]  (the fallback case under Desktop Chrome)
//
// OBSERVABILITY NOTES (Playwright/Chromium constraints, not product ones):
//   * navigator.sendBeacon rides Chromium's ping loader, which Playwright's
//     request events/route interception CANNOT see — so every tracking test
//     disables sendBeacon via addInitScript, forcing the §31.6 chain onto
//     its SECOND leg (keepalive fetch), which IS observable. That both
//     exercises the fallback chain and exposes the payloads.
//   * Requests that CONTINUE a redirect chain are not interceptable either,
//     so the seeded offer template points at the worker's own any-host
//     /health route on the mapped test domain (http://offers.e2e.test:<PW_PORT>,
//     default 8787) — the /lc 302 lands on a real local response, no
//     route.fulfill needed.
//   * Captured events are deduped by event_id: a keepalive fetch the
//     browser reports aborted is re-queued and re-sent BY DESIGN with the
//     SAME event_id (that is §31.6's idempotency working); observation must
//     collapse replays exactly like the server's KV seen-set does.

import { test, expect, type Page, type Request as PwRequest } from "@playwright/test";
import { seedPublishedListicle, type SeededListicle } from "./listicles-p6-seed";
import { request as playwrightRequest } from "@playwright/test";
import { PW_PORT } from "./utils/base-url";

test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
});

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;

let seeded: SeededListicle;

test.beforeAll(async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  seeded = await seedPublishedListicle(ctx, {
    hostPrefix: "lst-p7-track",
    slug: "p7-tracking",
    // Locally-reachable provider destination (see the observability notes).
    offerUrlTemplate: `http://offers.e2e.test:${PW_PORT}/health?cid={click_id}&geo={country}`,
    pages: (sectionIds) => [
      {
        page_index: 0,
        selection_mode: "ab_test",
        ab_test_id: "ab_p7_0",
        candidates: [
          { section_id: sectionIds[0], traffic_allocation: 50, label: "A" },
          { section_id: sectionIds[1], traffic_allocation: 50, label: "B" },
        ],
      },
      {
        page_index: 1,
        selection_mode: "rule_based",
        candidates: [
          {
            section_id: sectionIds[2],
            label: "A",
            rule: { priority: 10, conditions: { sets: { device: ["desktop"] } } },
          },
          { section_id: sectionIds[3], label: "B", is_fallback: true },
        ],
      },
      {
        page_index: 2,
        selection_mode: "rule_based",
        candidates: [
          {
            section_id: sectionIds[4],
            label: "A",
            rule: { priority: 10, conditions: { sets: { device: ["mobile"] } } },
          },
          { section_id: sectionIds[5], label: "B", is_fallback: true },
        ],
      },
    ],
  });
  await ctx.dispose();
});

function publicUrl(extra = ""): string {
  return `http://${seeded.host}:${PW_PORT}/${seeded.slug}${extra}`;
}

interface TrackedEvent {
  event_type: string;
  event_id: string;
  session_id: string;
  page_view_id: string;
  section_id?: string;
  offer_id?: string;
  link_instance_id?: string;
  selection_reason?: string;
  page_index?: number;
  page_candidate_id?: string;
  utm_source?: string;
  fbclid?: string;
  [key: string]: unknown;
}

async function collectBeacons(page: Page): Promise<TrackedEvent[]> {
  // Force the §31.6 chain onto the observable keepalive-fetch leg — see the
  // observability notes at the top of this file.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "sendBeacon", { value: undefined, configurable: true });
  });
  const events: TrackedEvent[] = [];
  const seen = new Set<string>();
  page.on("request", (req: PwRequest) => {
    if (!req.url().includes("/api/lst/track")) return;
    const data = req.postData();
    if (data === null) return;
    try {
      const parsed = JSON.parse(data) as { events?: TrackedEvent[] };
      const batch = Array.isArray(parsed.events) ? parsed.events : [parsed as unknown as TrackedEvent];
      for (const event of batch) {
        // event_id replay-dedupe — mirrors the server's KV seen-set.
        if (event.event_id !== undefined && seen.has(event.event_id)) continue;
        if (event.event_id !== undefined) seen.add(event.event_id);
        events.push(event);
      }
    } catch {
      /* non-JSON beacon */
    }
  });
  return events;
}

async function waitForEvent(
  page: Page,
  events: TrackedEvent[],
  type: string,
  timeoutMs = 8000,
): Promise<TrackedEvent> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = events.find((e) => e.event_type === type);
    if (hit !== undefined) return hit;
    await page.waitForTimeout(100);
  }
  throw new Error(`no ${type} beacon within ${timeoutMs}ms (saw: ${events.map((e) => e.event_type).join(",")})`);
}

test.describe("landing: cookies + ids + page_view beacon (§16/§31.3/§31.4)", () => {
  test("?utm_source=x&fbclid=y sets ko_ctx; _LST_SID/_LST_PVID present; page_view observed with acquisition dims", async ({ page }) => {
    const events = await collectBeacons(page);
    await page.goto(publicUrl("?utm_source=x&fbclid=y"), { waitUntil: "load" });

    // ko_ctx cookie captured the landing params (+fbc derived from fbclid).
    const cookies = await page.context().cookies(`http://${seeded.host}:${PW_PORT}/`);
    const koCtx = cookies.find((c) => c.name === "ko_ctx");
    expect(koCtx).toBeTruthy();
    const parsedCtx = JSON.parse(decodeURIComponent(koCtx!.value)) as Record<string, string>;
    expect(parsedCtx.utm_source).toBe("x");
    expect(parsedCtx.fbclid).toBe("y");
    expect(parsedCtx.fbc).toMatch(/^fb\.1\.\d+\.y$/);
    expect(parsedCtx.lander_v).toBe(seeded.versionPublicId);

    // §31.3/§31.4: edge sid injected + pvid minted.
    const ids = await page.evaluate(() => {
      const w = window as unknown as { _LST_SID?: string; _LST_PVID?: string; __LST_CTX?: unknown };
      return { sid: w._LST_SID ?? "", pvid: w._LST_PVID ?? "", hasCtx: typeof w.__LST_CTX === "object" };
    });
    expect(ids.sid).not.toBe("");
    expect(ids.pvid).not.toBe("");
    expect(ids.hasCtx).toBe(true);
    const koSid = cookies.find((c) => c.name === "ko_sid");
    expect(koSid?.value).toBe(ids.sid); // edge cookie == injected sid

    // page_view beacon with session dims + acquisition dims.
    const pv = await waitForEvent(page, events, "page_view");
    expect(pv.session_id).toBe(ids.sid);
    expect(pv.page_view_id).toBe(ids.pvid);
    expect(pv.utm_source).toBe("x");
    expect(pv.fbclid).toBe("y");
    expect(pv.article_id).toBe(seeded.articlePublicId);
    expect(pv.lander_v).toBe(seeded.versionPublicId);

    // §31.9: every governed anchor got pv= stamped.
    const stamped = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href^="/lc/"]'));
      return anchors.every((a) => (a.getAttribute("href") ?? "").includes("pv="));
    });
    expect(stamped).toBe(true);
  });
});

test.describe("§15.3 selection: one candidate per page, zero CLS, sticky, rules", () => {
  test("exactly one candidate visible per page; zero CLS; rule page picks desktop; mobile-rule page falls back", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __clsTotal: number }).__clsTotal = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) {
          if (!entry.hadRecentInput) {
            (window as unknown as { __clsTotal: number }).__clsTotal += entry.value;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.setViewportSize({ width: 1014, height: 857 });
    await page.goto(publicUrl(), { waitUntil: "load" });

    // exactly ONE visible candidate per page.
    for (const idx of [0, 1, 2]) {
      await expect(
        page.locator(`.lst-page[data-page-index="${idx}"] .lst-cand:visible`),
        `page ${idx}`,
      ).toHaveCount(1);
    }

    const chosen = await page.evaluate(() => {
      const w = window as unknown as {
        __LST_CHOSEN: Record<string, { id: string; reason: string; rule_id: string }>;
      };
      return w.__LST_CHOSEN;
    });
    // page 1: the device=desktop rule fires deterministically under Desktop Chrome.
    expect(chosen["1"]?.reason).toBe("rule_match");
    expect(chosen["1"]?.rule_id).not.toBe("");
    // page 2: only a device=mobile rule exists → the fallback candidate.
    expect(chosen["2"]?.reason).toBe("fallback");
    expect(chosen["2"]?.rule_id).toBe("");
    // page 0: hash-based ab pick.
    expect(chosen["0"]?.reason).toBe("ab_hash");

    // the visible candidate IS the chosen one, page by page.
    for (const idx of [0, 1, 2]) {
      const visibleCand = await page
        .locator(`.lst-page[data-page-index="${idx}"] .lst-cand:visible`)
        .getAttribute("data-cand");
      expect(visibleCand).toBe(chosen[String(idx)]?.id);
    }

    await page.waitForTimeout(400);
    const cls = await page.evaluate(() => (window as unknown as { __clsTotal: number }).__clsTotal);
    console.log(`[p7-cls-evidence] layout-shift total=${cls}`);
    expect(cls).toBeLessThan(0.02);
  });

  test("sticky across reloads: same sid → same candidates every time", async ({ page }) => {
    await page.goto(publicUrl(), { waitUntil: "load" });
    const first = await page.evaluate(() =>
      JSON.stringify(
        Object.entries(
          (window as unknown as { __LST_CHOSEN: Record<string, { id: string }> }).__LST_CHOSEN,
        ).map(([k, v]) => [k, v.id]),
      ),
    );
    for (let i = 0; i < 3; i++) {
      await page.reload({ waitUntil: "load" });
      const again = await page.evaluate(() =>
        JSON.stringify(
          Object.entries(
            (window as unknown as { __LST_CHOSEN: Record<string, { id: string }> }).__LST_CHOSEN,
          ).map(([k, v]) => [k, v.id]),
        ),
      );
      expect(again).toBe(first);
    }
  });
});

test.describe("§31.5 impressions on scroll — once per (pv, entity)", () => {
  test("section_impression + offer_impression fire once; re-scroll never re-fires", async ({ page }) => {
    const events = await collectBeacons(page);
    await page.setViewportSize({ width: 1014, height: 857 });
    await page.goto(publicUrl(), { waitUntil: "load" });

    // Scroll page 1's section into view and dwell past 1000ms.
    const target = page.locator('.lst-page[data-page-index="1"] .lst-cand:visible').first();
    await target.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1400); // > 1000ms section dwell (+ 500ms offer)

    const section = await waitForEvent(page, events, "section_impression");
    expect(section.section_id).not.toBe("");
    expect(section.page_view_id).not.toBe("");
    const offer = await waitForEvent(page, events, "offer_impression");
    expect(offer.offer_id).toBe(
      // the seeded offer public id rides every governed anchor's /lc href.
      (await page
        .locator('a[href^="/lc/"]')
        .first()
        .getAttribute("href"))!.match(/^\/lc\/([^?]+)/)?.[1],
    );
    expect(offer.link_instance_id).not.toBe("");

    const sectionCountAfterFirst = events.filter((e) => e.event_type === "section_impression").length;
    const offerCountAfterFirst = events.filter((e) => e.event_type === "offer_impression").length;

    // Scroll away and back — dedupe holds per (pv, entity).
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await target.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1400);

    const sectionEvents = events.filter((e) => e.event_type === "section_impression");
    const offerEvents = events.filter((e) => e.event_type === "offer_impression");
    // No NEW impression for the SAME entities.
    const distinctSections = new Set(sectionEvents.map((e) => e.section_id));
    expect(sectionEvents.length).toBe(distinctSections.size); // once per entity
    const distinctAnchors = new Set(offerEvents.map((e) => `${e.link_instance_id}|${e.section_block_id}`));
    expect(offerEvents.length).toBe(distinctAnchors.size);
    expect(sectionEvents.length).toBeGreaterThanOrEqual(sectionCountAfterFirst);
    expect(offerEvents.length).toBeGreaterThanOrEqual(offerCountAfterFirst);
  });
});

test.describe("§7.3/§31.9 /lc click → 302 + click_id + pv", () => {
  test("a governed click 302s through /lc with pv=; a second click mints a NEW click_id", async ({ page }) => {
    // The seeded provider URL (http://offers.e2e.test:<PW_PORT>/health,
    // default 8787) resolves to the local worker, so the 302 lands on a real
    // response — redirect-
    // chain requests are not interceptable (observability notes above).
    const lcResponses: Array<{ url: string; location: string }> = [];
    page.on("response", (res) => {
      if (res.url().includes("/lc/") && res.status() === 302) {
        lcResponses.push({ url: res.url(), location: res.headers()["location"] ?? "" });
      }
    });

    await page.goto(publicUrl(), { waitUntil: "load" });
    const pvid = await page.evaluate(() => (window as unknown as { _LST_PVID: string })._LST_PVID);

    const anchor = page.locator('a[href^="/lc/"]:visible').first();
    const href = await anchor.getAttribute("href");
    expect(href).toContain(`pv=${pvid}`); // §31.9 stamped before click
    await anchor.click();
    await page.waitForURL("**offers.e2e.test**");

    expect(lcResponses.length).toBe(1);
    expect(lcResponses[0]!.url).toContain(`pv=${pvid}`);
    const firstCid = new URL(lcResponses[0]!.location).searchParams.get("cid") ?? "";
    expect(firstCid).toMatch(/^[0-9a-f-]{36}$/); // server-minted click_id (UUID)

    // Second click on the SAME offer → new click_id.
    await page.goBack({ waitUntil: "load" });
    await page.locator('a[href^="/lc/"]:visible').first().click();
    await page.waitForURL("**offers.e2e.test**");
    expect(lcResponses.length).toBe(2);
    const secondCid = new URL(lcResponses[1]!.location).searchParams.get("cid") ?? "";
    expect(secondCid).toMatch(/^[0-9a-f-]{36}$/);
    expect(secondCid).not.toBe(firstCid);
  });
});
