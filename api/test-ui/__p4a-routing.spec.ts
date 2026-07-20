// LeadGen Round-4 P4a probe spec (temporary; final consolidation lands in
// P7). Proves the FULL routing-rules model (D-2) end to end on the REAL
// served funnel, driven with real fill/click (ZERO dispatchEvent):
//   * an ENTRY routing rule (utm_source=facebook -> variant B) routes BEFORE
//     the shell ever renders variant A's content — a spoofable query param,
//     unlike CF geo, so this is a LIVE, not-echo-only proof (unlike P3a's
//     CA-state slot-rule case, which the local wrangler-dev harness cannot
//     spoof at the browser layer);
//   * a CHECKPOINT routing rule (age>=65 -> variant C) switches MID-FUNNEL:
//     answers carry over (age, already given, is never re-asked), the
//     skipped page's content never renders, and progress re-baselines to the
//     TARGET variant's OWN page count.
//
// ARCHITECTURE NOTE (documented, not a workaround): a mid-funnel switch
// mutates the CLIENT's resolved plan in place (engine.ts maybeSwitch) but
// does NOT fetch new HTML — the shell was already rendered for the ENTRY
// variant's OWN candidate catalog. So the CHECKPOINT target (variant C) is
// built by FORKING the entry variant (P3a's own admin lifecycle: fork clones
// page/slot rows referencing the SAME underlying leadgen_sections rows) then
// editing its `pages` to DROP the middle page — its remaining winning
// sections (age, fin) are therefore ALREADY present, hidden, in variant A's
// own served shell, so the switch renders correctly. This is the ROOT reason
// P4a's server-side routing constrains a rule's target to a variant of the
// SAME funnel (resolver.ts getActiveVariantByIdOnFunnel) — an open concern
// (documented in the P4a dispatch report) for cross-FUNNEL routing targets,
// which would need a harder client-side navigation this program does not
// implement.
//
// The route_funnel_variant rule itself is seeded via `wrangler d1 execute
// --local` DIRECTLY against the schema (the listicles-analytics-mirror.spec.ts
// precedent for seeding ahead of an admin surface): P4b (the rules-builder
// admin UI) is a separate, not-yet-landed dispatch — FUNNEL_RULE_TYPES in
// quotes-handlers.ts does not accept this rule_type yet.
//
// chromium-only (playwright.config.ts: firefox testMatch is the gesture set;
// this non-gesture spec is picked up by chromium alone, like __p1b-render /
// __p3a-pages). The dynamic {uniq}.e2e.test host needs chromium's
// --host-resolver-rules.

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { seedActiveSite } from "./listicles-p6-seed";
import { PW_PORT } from "./utils/base-url";

test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] } });

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const LG_API = "/api/admin/leadgen";
const SHOT_DIR = "test-artifacts/leadgen-p4a";

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

// Direct local-D1 write (the listicles-analytics-mirror.spec.ts precedent) —
// bypasses the admin API's own validation, which is exactly what's needed to
// seed a rule_type the admin surface doesn't recognize yet (P4b's job).
function d1Local(command: string): void {
  execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "kodigital-homepages-cms-db", "--local", "--command", command],
    { cwd: process.cwd(), stdio: "pipe", timeout: 120_000 },
  );
}

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

async function ready(page: Page): Promise<void> {
  await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 8_000 });
}

test.beforeAll(() => {
  mkdirSync(SHOT_DIR, { recursive: true });
});

// ===========================================================================
// Journey 1 — ENTRY routing: a UTM-conditioned rule routes to variant B live
// ===========================================================================

interface EntrySeed {
  host: string;
}

const CONT = { type: "ContinueButton", question_id: "cont", props: { label: "Continue" } };
// QuestionHeadline is UNBOUND (props.text) here — a bare `headline_text`
// column on the section does NOT itself render as visible text; it only
// surfaces via a bound {bind:"section_headline"} component (presets.ts
// renderQuestionHeadline). An explicit unbound headline is the simplest way
// to get distinctive, assertable visible text per section.
function headline(text: string): { type: string; question_id: string; props: { text: string } } {
  return { type: "QuestionHeadline", question_id: `h_${text.replace(/\W+/g, "_")}`, props: { text } };
}

test.describe("P4a — ENTRY routing rule (D-2): UTM-conditioned route to variant B, live", () => {
  let seeded: EntrySeed;

  test.beforeAll(async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const host = `lg-p4a-entry-core-${uniq}.e2e.test`;
    const siteId = await seedActiveSite(ctx, host, `P4a Entry Core ${uniq}`);

    const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
      await ctx.post(`${LG_API}/quotes`, { data: { quote_name: `P4a Entry Core ${uniq}`, activity: "quote_funnel", verticals: ["life"] } }),
      "quote create",
    );
    const funnelId = quote.funnels[0]!.public_id;
    const variantA = quote.funnels[0]!.variants[0]!.public_id;

    const secA = await json<{ public_id: string }>(
      await ctx.post(`${LG_API}/sections`, {
        data: {
          activity: "quote_funnel", vertical: "life", status: "active",
          section_name: "DefaultFlow", headline_text: "Default Flow Headline",
          content_json: JSON.stringify({ components: [headline("Default Flow Headline"), { type: "TwoButtonYesNo", question_id: "q_a", question_key: "a", internal_field: "f_a", answer_type: "boolean" }, CONT] }),
        },
      }),
      "section A create",
    );
    const secB = await json<{ public_id: string }>(
      await ctx.post(`${LG_API}/sections`, {
        data: {
          activity: "quote_funnel", vertical: "life", status: "active",
          section_name: "FacebookFlow", headline_text: "Facebook Flow Headline",
          content_json: JSON.stringify({ components: [headline("Facebook Flow Headline"), { type: "TwoButtonYesNo", question_id: "q_b", question_key: "b", internal_field: "f_b", answer_type: "boolean" }, CONT] }),
        },
      }),
      "section B create",
    );
    await json(
      await ctx.put(`${LG_API}/variants/${variantA}`, { data: { pages: [{ name: "P1", slots: [{ kind: "fixed", section_id: secA.public_id }] }] } }),
      "variant A pages",
    );
    const variantB = await json<{ public_id: string }>(
      await ctx.post(`${LG_API}/funnels/${funnelId}/variants`, { data: { variant_label: "B" } }),
      "variant B create",
    );
    await json(
      await ctx.put(`${LG_API}/variants/${variantB.public_id}`, { data: { pages: [{ name: "P1", slots: [{ kind: "fixed", section_id: secB.public_id }] }] } }),
      "variant B pages",
    );
    await json(await ctx.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true } }), "activation");

    const rowsA = JSON.parse(
      execFileSync("npx", ["wrangler", "d1", "execute", "kodigital-homepages-cms-db", "--local", "--json", "--command", `SELECT id FROM leadgen_funnel_variants WHERE public_id='${esc(variantA)}';`], { cwd: process.cwd(), timeout: 120_000 }).toString(),
    ) as Array<{ results: Array<{ id: number }> }>;
    const rowsB = JSON.parse(
      execFileSync("npx", ["wrangler", "d1", "execute", "kodigital-homepages-cms-db", "--local", "--json", "--command", `SELECT id FROM leadgen_funnel_variants WHERE public_id='${esc(variantB.public_id)}';`], { cwd: process.cwd(), timeout: 120_000 }).toString(),
    ) as Array<{ results: Array<{ id: number }> }>;
    const aRowId = rowsA[0]!.results[0]!.id;
    const bRowId = rowsB[0]!.results[0]!.id;

    d1Local(
      `INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash, priority, status, target_funnel_variant_id, rule_name, enabled) VALUES ('lgfr_pw_${uniq}', ${aRowId}, 'route_funnel_variant', '{"groups":[{"field":"utm_source","op":"eq","value":"facebook"}]}', 'h_pw_${uniq}', 10, 'active', ${bRowId}, 'Facebook route', 1);`,
    );

    seeded = { host };
  });

  test("no utm_source -> the control (Default Flow) renders, unrouted", async ({ page }) => {
    await page.goto(`http://${seeded.host}:${PW_PORT}/lg`, { waitUntil: "load" });
    await ready(page);
    await expect(page.locator("body")).toContainText("Default Flow Headline");
    await expect(page.locator("body")).not.toContainText("Facebook Flow Headline");
    await page.screenshot({ path: `${SHOT_DIR}/entry-unrouted.png`, fullPage: true });
  });

  test("utm_source=facebook -> variant B (Facebook Flow) renders LIVE, pre-A/B", async ({ page }) => {
    await page.goto(`http://${seeded.host}:${PW_PORT}/lg?utm_source=facebook`, { waitUntil: "load" });
    await ready(page);
    await expect(page.locator("body")).toContainText("Facebook Flow Headline");
    await expect(page.locator("body")).not.toContainText("Default Flow Headline");
    await page.screenshot({ path: `${SHOT_DIR}/entry-routed.png`, fullPage: true });
  });
});

// ===========================================================================
// Journey 2 — CHECKPOINT routing: an age-answer rule switches mid-funnel,
// answers carried, progress re-baselined
// ===========================================================================

interface CheckpointSeed {
  host: string;
}

test.describe("P4a — CHECKPOINT routing rule (D-2): age-answer switch mid-funnel, live", () => {
  let seeded: CheckpointSeed;

  test.beforeAll(async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const host = `lg-p4a-ckpt-core-${uniq}.e2e.test`;
    const siteId = await seedActiveSite(ctx, host, `P4a Ckpt Core ${uniq}`);

    const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
      await ctx.post(`${LG_API}/quotes`, { data: { quote_name: `P4a Ckpt Core ${uniq}`, activity: "quote_funnel", verticals: ["life"] } }),
      "quote create",
    );
    const funnelId = quote.funnels[0]!.public_id;
    const variantA = quote.funnels[0]!.variants[0]!.public_id;

    // Minimal frame so a [data-lg-progress] mount renders (baseFrameDefaults'
    // progress.style:"bar" default) — the frameless legacy shell has none
    // (the __p3a-pages.spec.ts precedent).
    await json(
      await ctx.put(`${LG_API}/funnels/${funnelId}/frame`, { data: { frame_config_json: { version: 1, template: "centered" } } }),
      "funnel frame",
    );

    const secAge = await json<{ public_id: string }>(
      await ctx.post(`${LG_API}/sections`, {
        data: {
          activity: "quote_funnel", vertical: "life", status: "active",
          section_name: "AgeQuestion", headline_text: "How old are you?",
          content_json: JSON.stringify({ components: [headline("How old are you"), { type: "NumberInputQuestion", question_id: "q_age", question_key: "age", internal_field: "age", required: true }, CONT] }),
        },
      }),
      "section age create",
    );
    const secMid = await json<{ public_id: string }>(
      await ctx.post(`${LG_API}/sections`, {
        data: {
          activity: "quote_funnel", vertical: "life", status: "active",
          section_name: "MiddleSection", headline_text: "Middle Section Marker",
          content_json: JSON.stringify({ components: [headline("Middle Section Marker"), { type: "TwoButtonYesNo", question_id: "q_mid", question_key: "mid", internal_field: "mid_field", answer_type: "boolean", required: true }, CONT] }),
        },
      }),
      "section mid create",
    );
    const secFin = await json<{ public_id: string }>(
      await ctx.post(`${LG_API}/sections`, {
        data: {
          activity: "quote_funnel", vertical: "life", status: "active",
          section_name: "FinalSection", headline_text: "Final Section Marker",
          // required:true so the prefix-rule resume LANDS here (not "all-
          // satisfied -> straight to auction") -- a visible proof that the
          // switch renders the target's OWN remaining page, not just that it
          // eventually completes.
          content_json: JSON.stringify({ components: [headline("Final Section Marker"), { type: "TwoButtonYesNo", question_id: "q_fin", question_key: "fin", internal_field: "fin_field", answer_type: "boolean", required: true }, CONT] }),
        },
      }),
      "section fin create",
    );

    // Entry variant A: 3 pages [age, mid, fin].
    await json(
      await ctx.put(`${LG_API}/variants/${variantA}`, {
        data: {
          pages: [
            { name: "Age", slots: [{ kind: "fixed", section_id: secAge.public_id }] },
            { name: "Mid", slots: [{ kind: "fixed", section_id: secMid.public_id }] },
            { name: "Fin", slots: [{ kind: "fixed", section_id: secFin.public_id }] },
          ],
        },
      }),
      "variant A pages",
    );

    // Fork A -> C (clones the SAME underlying section rows via P3a's fork
    // lifecycle), THEN edit C's pages to DROP `mid` — [age, fin] only. Since
    // age/fin are the SAME leadgen_sections rows A's own shell already
    // renders (hidden), the switch is client-renderable (see file header).
    const forked = await json<{ public_id: string }>(await ctx.post(`${LG_API}/variants/${variantA}/fork`, { data: {} }), "fork");
    const variantC = forked.public_id;
    await json(
      await ctx.put(`${LG_API}/variants/${variantC}`, {
        data: {
          pages: [
            { name: "Age", slots: [{ kind: "fixed", section_id: secAge.public_id }] },
            { name: "Fin", slots: [{ kind: "fixed", section_id: secFin.public_id }] },
          ],
        },
      }),
      "variant C pages",
    );

    await json(await ctx.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true } }), "activation");

    const rowsA = JSON.parse(
      execFileSync("npx", ["wrangler", "d1", "execute", "kodigital-homepages-cms-db", "--local", "--json", "--command", `SELECT id FROM leadgen_funnel_variants WHERE public_id='${esc(variantA)}';`], { cwd: process.cwd(), timeout: 120_000 }).toString(),
    ) as Array<{ results: Array<{ id: number }> }>;
    const rowsC = JSON.parse(
      execFileSync("npx", ["wrangler", "d1", "execute", "kodigital-homepages-cms-db", "--local", "--json", "--command", `SELECT id FROM leadgen_funnel_variants WHERE public_id='${esc(variantC)}';`], { cwd: process.cwd(), timeout: 120_000 }).toString(),
    ) as Array<{ results: Array<{ id: number }> }>;
    const aRowId = rowsA[0]!.results[0]!.id;
    const cRowId = rowsC[0]!.results[0]!.id;

    d1Local(
      `INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash, priority, status, target_funnel_variant_id, value_multiplier, rule_name, enabled) VALUES ('lgfr_pwckpt_${uniq}', ${aRowId}, 'route_funnel_variant', '{"groups":[{"field":"age","op":"gte","value":65}]}', 'h_pwckpt_${uniq}', 10, 'active', ${cRowId}, 2.0, 'Senior route', 1);`,
    );

    seeded = { host };
  });

  // The server renders EVERY candidate section up front (hidden), per the
  // "visitor-invariant cacheable shell" design — a bare body-text check would
  // find ALL sections' headlines regardless of visibility. Scope to the
  // VISIBLE section(s) only (P3a's own proven pattern), matching what a real
  // visitor actually sees.
  function visibleText(page: Page): Promise<string> {
    return page.locator("[data-lg-section]:not([hidden])").evaluateAll((els) => els.map((el) => el.textContent ?? "").join(" "));
  }

  test("age >= 65 switches mid-funnel: `mid` never renders, `fin` renders, progress re-baselines to 2 of 2", async ({ page }) => {
    await page.goto(`http://${seeded.host}:${PW_PORT}/lg`, { waitUntil: "load" });
    await ready(page);

    // Capture EVERY /lg/track beacon POST body from here on (fix round: the
    // post-switch beacon envelope re-stamp) — the events.ts default flush
    // delay is 800ms, so events land in ONE OR MORE later batches, not
    // synchronously with the switch itself. page.route (not the passive
    // page.on("request") listener) reliably captures navigator.sendBeacon
    // traffic too (browserSender's preferred transport) — it must
    // route.continue() so the beacon still actually sends.
    const trackedBatches: Array<Record<string, unknown>[]> = [];
    await page.route("**/lg/track", async (route) => {
      const data = route.request().postData();
      if (data !== null) {
        try {
          const parsed = JSON.parse(data) as { events?: unknown };
          if (Array.isArray(parsed.events)) trackedBatches.push(parsed.events as Record<string, unknown>[]);
        } catch {
          /* ignore unparsable batches */
        }
      }
      await route.continue();
    });

    // Page 1 (age): fill 70, capture the /lg/ck response live (ANY
    // continue-click on this page posts to /lg/ck since it's the
    // derived checkpoint anchor — match or not — so both journeys wait on it).
    await page.locator("[data-lg-section]:not([hidden]) [data-lg-input]").first().fill("70");
    const [ckptResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/lg/ck")),
      page.locator("[data-lg-continue]:visible").click(),
    ]);
    const ckptBody = (await ckptResponse.json()) as { sw: boolean; v: string; r: string };
    expect(ckptBody.sw, "the checkpoint call reports a real switch").toBe(true);

    await page.waitForTimeout(300); // let the engine apply the switch + enterPage

    // `mid`'s marker text NEVER appears (skipped by the switch); `fin`'s does.
    const shown = await visibleText(page);
    expect(shown).not.toContain("Middle Section Marker");
    expect(shown).toContain("Final Section Marker");

    // Progress re-baselined to the TARGET's OWN plan (2 pages), not the
    // entry variant's original 3.
    const progress = page.locator("[data-lg-progress]").first();
    const total = await progress.getAttribute("data-lg-progress-total");
    expect(total, "progress denominator re-baselines to variant C's 2 pages, not A's 3").toBe("2");
    await expect(progress).toHaveAttribute("data-lg-progress-current", "2");

    // Fix round (coordinator): a client event (section_view fires on
    // entering `fin` via enterPage, immediately after the switch) carries the
    // TARGET variant id + routed_from_variant in its payload — the FULL
    // client event stream, not just the final auction call. Wait past the
    // 800ms flush delay so the batch actually lands, then inspect it.
    await page.waitForTimeout(1200);
    const allEvents = trackedBatches.flat();
    const routedEvent = allEvents.find(
      (e) => e["funnel_variant_id"] === ckptBody.v && typeof e["routed_from_variant"] === "string" && e["routed_from_variant"] !== "",
    );
    expect(
      routedEvent,
      `expected a post-switch beacon event stamped funnel_variant_id=${ckptBody.v} + a non-empty routed_from_variant; captured events: ${JSON.stringify(allEvents.map((e) => ({ event_type: e["event_type"], funnel_variant_id: e["funnel_variant_id"], routed_from_variant: e["routed_from_variant"] })))}`,
    ).toBeDefined();
    // routed_from_variant must be the ORIGIN, i.e. genuinely different from
    // the (target) funnel_variant_id on the SAME event — never a self-loop.
    expect(routedEvent?.["routed_from_variant"]).not.toBe(ckptBody.v);
    // assignment_reason on the SAME event carries the routing_rule:<hash>
    // attribution (§16.3), not a stale pre-switch value.
    expect(routedEvent?.["assignment_reason"]).toMatch(/^routing_rule:/);

    await page.screenshot({ path: `${SHOT_DIR}/checkpoint-switched.png`, fullPage: true });
  });

  test("age < 65 does NOT switch: the entry variant's own `mid` page renders normally (no skip)", async ({ page }) => {
    await page.goto(`http://${seeded.host}:${PW_PORT}/lg`, { waitUntil: "load" });
    await ready(page);
    await page.locator("[data-lg-section]:not([hidden]) [data-lg-input]").first().fill("20");
    const [ckptResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/lg/ck")),
      page.locator("[data-lg-continue]:visible").click(),
    ]);
    const ckptBody = (await ckptResponse.json()) as { sw: boolean };
    expect(ckptBody.sw, "age=20 does not satisfy age>=65 -> no switch").toBe(false);
    await page.waitForTimeout(300);
    const shown = await visibleText(page);
    expect(shown).toContain("Middle Section Marker");
    const progress = page.locator("[data-lg-progress]").first();
    await expect(progress).toHaveAttribute("data-lg-progress-total", "3"); // unrouted -> A's own 3 pages
  });
});
