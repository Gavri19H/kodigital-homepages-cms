// Round-4 P6a — THEME v2 (operator decision D-7), LIVE funnel proof (chromium).
//
// Seeds two ACTIVATED funnels through the REAL admin API (quote → sections →
// variant pages → frame → theme → activation), then drives the live
// GET /lg/:slug shell and reads COMPUTED styles — proving the P6a theme reaches
// the public render through serve.ts's existing wiring (the resolved-design
// object carries the font slots, the display-XXL headline size, and the
// button-style stash to funnelChromeCss + the section renderers alike):
//   • themed  — display font Poppins + display_size:xxl + button_defaults
//               {fill:soft, layout:list, selected:mark};
//   • control — the SAME frame/section with NO theme (the pre-P6 look).
//
// Asserts: the headline computes to ~72px in the display font; the served CSS
// carries the Poppins @font-face as a same-origin data: URL and the page makes
// ZERO external font requests; and each button style is visually DISTINCT from
// the control (computed-style signatures).
//
// Runs against the playwright.config.ts webServer (wrangler dev on :PW_PORT
// with DEV_BYPASS_AUTH). Every resource is unique-suffixed. ZERO dispatchEvent.

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { seedActiveSite } from "./listicles-p6-seed";
import { PW_PORT } from "./utils/base-url";

test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] } });

const LG_API = "/api/admin/leadgen";

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

// A section exercising the three button-style surfaces: a QuestionHeadline
// (display font + display-XXL), an IconCardAnswerGrid (mark check + soft card),
// a ButtonAnswerGroup (list layout + soft chip), and the ContinueButton (fill).
function richSection(name: string, field: string): Record<string, unknown> {
  return {
    section_name: name,
    headline_text: name,
    activity: "quote_funnel",
    vertical: "life",
    status: "active",
    content_json: JSON.stringify({
      components: [
        { type: "QuestionHeadline", question_id: `q_${field}_h`, bind: "section_headline", props: {} },
        {
          type: "IconCardAnswerGrid",
          question_id: `q_${field}_c`,
          question_key: `${field}_c`,
          internal_field: `${field}_c`,
          choices: [
            { label: "Home", value: "home", analytics_id: `${field}_home`, icon: "home", subtitle: "Own or rent" },
            { label: "Auto", value: "auto", analytics_id: `${field}_auto`, icon: "car", subtitle: "One or more" },
          ],
          props: { columns: 2 },
        },
        {
          type: "ButtonAnswerGroup",
          question_id: `q_${field}_b`,
          question_key: `${field}_b`,
          internal_field: `${field}_b`,
          choices: [
            { label: "Yes", value: "yes", analytics_id: `${field}_yes` },
            { label: "No", value: "no", analytics_id: `${field}_no` },
          ],
        },
        { type: "ContinueButton", question_id: `q_${field}_cont`, props: { label: "Continue" } },
      ],
    }),
  };
}

interface Seeded {
  host: string;
  slug: string;
}

const FRAME_CONFIG = { version: 1, template: "centered" };
// The P6a inline theme: a new display font, the display-XXL ramp, and all three
// button-style axes at once (soft fill + list layout + mark selected).
const P6_THEME = {
  version: 1,
  typography: { display: "poppins", display_size: "xxl" },
  button_defaults: { fill: "soft", layout: "list", selected: "mark" },
};

// Seed an activated funnel with the rich section + frame, optionally assigning
// the P6a theme (control = no theme).
async function seedFunnel(request: APIRequestContext, tag: string, withTheme: boolean): Promise<Seeded> {
  const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const safe = tag.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  const host = `lg-p6a-${safe}-${uniq}.e2e.test`;
  const siteId = await seedActiveSite(request, host, `P6a ${safe} ${uniq}`);
  const quote = await json<{
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  }>(
    await request.post(`${LG_API}/quotes`, {
      data: { quote_name: `P6a ${tag} ${uniq}`, activity: "quote_funnel", verticals: ["life"] },
    }),
    "quote create",
  );
  const funnelId = quote.funnels[0]!.public_id;
  const variantId = quote.funnels[0]!.variants[0]!.public_id;

  const field = `f_${safe.replace(/-/g, "_")}`;
  const section = await json<{ public_id: string }>(
    await request.post(`${LG_API}/sections`, { data: richSection(`${safe}-q1`, field) }),
    "section create",
  );
  await json(
    await request.put(`${LG_API}/variants/${variantId}`, {
      data: { pages: [{ name: "Page 1", slots: [{ kind: "fixed", section_id: section.public_id }] }] },
    }),
    "variant pages",
  );
  await json(
    await request.put(`${LG_API}/funnels/${funnelId}/frame`, { data: { frame_config_json: FRAME_CONFIG } }),
    "funnel frame",
  );
  if (withTheme) {
    await json(
      await request.put(`${LG_API}/funnels/${funnelId}/theme`, { data: { theme_json: P6_THEME } }),
      "funnel theme",
    );
  }
  await json(
    await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug: safe } }),
    "activation",
  );
  return { host, slug: safe };
}

const shellUrl = (s: Seeded): string => `http://${s.host}:${PW_PORT}/lg/${s.slug}`;

// computed style of the first matching element.
async function computed(page: Page, selector: string, prop: string): Promise<string> {
  return page.locator(selector).first().evaluate(
    (el, p) => getComputedStyle(el).getPropertyValue(p),
    prop,
  );
}

let themed: Seeded;
let control: Seeded;

test.beforeAll(async ({ playwright }) => {
  const request = await playwright.request.newContext();
  themed = await seedFunnel(request, "themed", true);
  control = await seedFunnel(request, "control", false);
  await request.dispose();
});

test.describe("P6a THEME v2 — live funnel", () => {
  test("headline renders in the display font at the display-XXL ~72px size", async ({ page }) => {
    await page.goto(shellUrl(themed), { waitUntil: "load" });
    await page.locator(".lg-headline").first().waitFor();
    const size = Number.parseFloat(await computed(page, ".lg-headline", "font-size"));
    // 31px base × 2.3 (display_size xxl) ≈ 71.3px — the operator's Image37 ramp.
    expect(size).toBeGreaterThan(68);
    expect(size).toBeLessThan(76);
    const family = await computed(page, ".lg-headline", "font-family");
    expect(family).toContain("Poppins");

    // control headline stays at the base ~31px in the base display family.
    await page.goto(shellUrl(control), { waitUntil: "load" });
    await page.locator(".lg-headline").first().waitFor();
    const baseSize = Number.parseFloat(await computed(page, ".lg-headline", "font-size"));
    expect(baseSize).toBeLessThan(40);
    expect(await computed(page, ".lg-headline", "font-family")).not.toContain("Poppins");
  });

  test("the Poppins @font-face is same-origin (data:) and the page makes ZERO external font requests", async ({ page }) => {
    const external: string[] = [];
    page.on("request", (r) => {
      const u = r.url();
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(u)) external.push(u);
      if (/\.woff2?(\?|$)/i.test(u) && !u.startsWith("data:")) external.push(u);
    });
    await page.goto(shellUrl(themed), { waitUntil: "load" });
    await page.locator(".lg-headline").first().waitFor();

    const html = await page.content();
    expect(html).toContain("@font-face");
    expect(html).toContain("font-family:'Poppins'");
    expect(html).toContain("data:font/woff2;base64,");
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain("fonts.gstatic.com");
    expect(external, `no external font requests, saw: ${external.join(", ")}`).toHaveLength(0);
  });

  test("each button style is visually distinct from the control (computed-style signatures)", async ({ page }) => {
    // --- themed signatures ---
    await page.goto(shellUrl(themed), { waitUntil: "load" });
    await page.locator(".lg-continue").first().waitFor();

    // soft fill — the continue button is a pill (large border-radius) vs base 10px.
    const themedRadius = Number.parseFloat(await computed(page, ".lg-continue", "border-top-left-radius"));
    // list layout — the answer group collapses to a SINGLE grid column.
    const themedCols = (await computed(page, ".lg-answer-group", "grid-template-columns")).trim().split(/\s+/).length;
    // mark selected — the check badge element is rendered into every card.
    const themedChecks = await page.locator(".lg-card-check").count();

    // --- control signatures (no theme) ---
    await page.goto(shellUrl(control), { waitUntil: "load" });
    await page.locator(".lg-continue").first().waitFor();
    const ctrlRadius = Number.parseFloat(await computed(page, ".lg-continue", "border-top-left-radius"));
    const ctrlCols = (await computed(page, ".lg-answer-group", "grid-template-columns")).trim().split(/\s+/).length;
    const ctrlChecks = await page.locator(".lg-card-check").count();

    // soft: themed pill radius clearly exceeds the base ~10px.
    expect(themedRadius).toBeGreaterThan(40);
    expect(ctrlRadius).toBeLessThan(20);
    expect(themedRadius).toBeGreaterThan(ctrlRadius);

    // list: themed = 1 column; control = 2 columns.
    expect(themedCols).toBe(1);
    expect(ctrlCols).toBe(2);

    // mark: themed renders check badges; control renders none.
    expect(themedChecks).toBeGreaterThan(0);
    expect(ctrlChecks).toBe(0);
  });
});
