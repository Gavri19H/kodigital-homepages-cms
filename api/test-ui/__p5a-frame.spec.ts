// LeadGen Round-4 P5a probe spec (temporary; final consolidation lands in P7).
// Proves the authorable FRAME ELEMENTS v2 (10C/10E/10F/10G/10H) END TO END on
// the REAL served funnel, driven with real fill/click (ZERO dispatchEvent):
//   * FREE TEXT above + below with PAGE TARGETING honored LIVE across a 2-page
//     funnel — a `first`-targeted block rides the EXISTING [data-show-on]
//     engine toggle (render.ts updateFooterVisibility) and HIDES on page 2,
//     while an `all`-targeted block stays (zero new engine bytes);
//   * BRAND LOGOS render a ROW at desktop (1280) and a GRID at mobile (375) —
//     asserted via the browser computed `display`;
//   * DISCLOSURE v2 top + bottom simultaneously; the bottom `hover` entry's
//     CSS-only tooltip fades in on hover (computed opacity);
//   * a CTA in EACH of the four slots (tel: links); a state-CONDITIONED slot
//     server-renders HIDDEN carrying the EXISTING evaluator hook
//     (data-lg-node) + the compiled group (data-lg-cta-condition). LIVE
//     toggling of a FRAME-scope condition is a runtime engine seam (engine.ts
//     only evaluates PER-SECTION conditionals today) — asserted as
//     hidden+hook, NOT as a live toggle (documented in the dispatch report);
//   * each PROGRESS style renders VISUALLY DISTINCT — a browser computed-style
//     signature per style, asserted pairwise-unique;
//   * FOOTER v2 blocks with an own palette SCOPE (footer background != page);
//   * a TRUST ROW icon+text with a CSS-only hover tooltip.
//
// chromium-only (playwright.config.ts: firefox testMatch is the gesture set;
// this non-gesture spec is picked up by chromium alone, like __p3a-pages /
// __p4a-routing). The dynamic {uniq}.e2e.test host needs chromium's
// --host-resolver-rules.

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { seedActiveSite } from "./listicles-p6-seed";
import { PW_PORT } from "./utils/base-url";

test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] } });

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const LG_API = "/api/admin/leadgen";
const SHOT_DIR = "test-artifacts/leadgen-p5a";

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

const CONTINUE = { type: "ContinueButton", question_id: "cont", props: { label: "Continue" } };
function yesNoSection(name: string, field: string) {
  return {
    section_name: name,
    headline_text: name,
    content_json: JSON.stringify({
      components: [
        { type: "TwoButtonYesNo", question_id: `q_${field}`, question_key: field, internal_field: field, answer_type: "boolean", required: true },
        CONTINUE,
      ],
    }),
  };
}

interface Seeded {
  host: string;
  slug: string;
  variantId: string;
  funnelId: string;
}

// Seed an ACTIVE tenant + a funnel whose pages hold the given fixed sections,
// then assign the given P5a frame config (through the REAL PUT /funnels/:id/
// frame validate gate) and activate it.
async function seedFrameFunnel(
  request: APIRequestContext,
  tag: string,
  frameConfig: Record<string, unknown>,
  pageCount: 1 | 2,
): Promise<Seeded> {
  const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  // hostnames + slugs forbid underscores (e.g. the icon_on_track style tag).
  const safe = tag.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  const host = `lg-p5a-${safe}-${uniq}.e2e.test`;
  const siteId = await seedActiveSite(request, host, `P5a ${safe} ${uniq}`);
  const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, { data: { quote_name: `P5a ${tag} ${uniq}`, activity: "quote_funnel", verticals: ["life"] } }),
    "quote create",
  );
  const funnelId = quote.funnels[0]!.public_id;
  const variantId = quote.funnels[0]!.variants[0]!.public_id;

  const mkSection = async (name: string, field: string): Promise<string> => {
    const created = await json<{ public_id: string }>(
      await request.post(`${LG_API}/sections`, { data: { activity: "quote_funnel", vertical: "life", status: "active", ...yesNoSection(name, field) } }),
      `section create (${name})`,
    );
    return created.public_id;
  };

  const field = safe.replace(/-/g, "_");
  const s1 = await mkSection(`${safe}-p1`, `f_${field}_1`);
  const pages: Array<Record<string, unknown>> = [{ name: "Page 1", slots: [{ kind: "fixed", section_id: s1 }] }];
  if (pageCount === 2) {
    const s2 = await mkSection(`${safe}-p2`, `f_${field}_2`);
    pages.push({ name: "Page 2", slots: [{ kind: "fixed", section_id: s2 }] });
  }
  await json(await request.put(`${LG_API}/variants/${variantId}`, { data: { pages } }), "variant pages");
  await json(
    await request.put(`${LG_API}/funnels/${funnelId}/frame`, { data: { frame_config_json: frameConfig } }),
    "funnel frame",
  );
  await json(await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug: safe } }), "activation");
  return { host, slug: safe, variantId, funnelId };
}

const shellUrl = (s: Seeded) => `http://${s.host}:${PW_PORT}/lg/${s.slug}`;

async function ready(page: Page): Promise<void> {
  await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 8_000 });
}

async function answerPageAndContinue(page: Page): Promise<void> {
  const sections = page.locator("[data-lg-section]:not([hidden])");
  const count = await sections.count();
  for (let i = 0; i < count; i++) await sections.nth(i).locator('[data-lg-choice="true"]').click();
  await page.locator("[data-lg-continue]:visible").click();
}

const RICH_FRAME: Record<string, unknown> = {
  version: 1,
  template: "centered",
  progress: { style: "numbered", show_label: true },
  free_text: [
    { id: "ft_first", slot: "above_section", pages: { mode: "first" }, blocks: [{ type: "paragraph", html: "<strong>Shown only on page 1</strong>" }] },
    { id: "ft_all", slot: "below_section", pages: { mode: "all" }, blocks: [{ type: "list", style: "check", items: ["Free to use", "No obligation"] }] },
  ],
  brand_logos: {
    enabled: true,
    layout: "row",
    slot: "above_header",
    items: [
      { url: "/media/logo-a.png", alt: "Partner A" },
      { url: "/media/logo-b.png", alt: "Partner B" },
      { url: "/media/logo-c.png", alt: "Partner C" },
    ],
  },
  cta_slots: [
    { slot: "header_right", label: "Call now", tel: "+1 555 111 0000" },
    { slot: "under_header", label: "Talk to an agent", tel: "+1 555 111 0001" },
    { slot: "section_bottom", label: "Get my quote", href: "https://example.com/quote" },
    { slot: "footer", label: "Questions? Call", tel: "+1 555 111 0002" },
    { id: "cta_ca_only", slot: "under_header", label: "California hotline", tel: "+1 555 999 0000", condition: { match: "all", conditions: [{ when: "__state", op: "eq", value: "CA" }] } },
  ],
  trust_rows: [
    { slot: "below_section", items: [{ icon: "shield-check", text: "Bank-level security", tooltip: "256-bit AES encryption" }, { icon: "star", text: "Rated 4.9/5" }] },
  ],
  disclosure: {
    enabled: true,
    entries: [
      { location: "top", text: "This is an advertisement.", mode: "full", align: "center" },
      { location: "bottom", text: "We may be compensated by our partners.", mode: "hover", link_label: "Advertising Disclosure" },
    ],
  },
  footer: {
    enabled: true,
    palette_scope: { background: "brand_primary", text: "card_background", link: "accent" },
    typography_scope: { size: "s" },
    blocks: [
      { type: "about_paragraph", text: "Operated by Acme Insure Inc." },
      { type: "link_row", links_source: "manual", links: [{ label: "Privacy", href: "/privacy" }] },
      { type: "logo" },
    ],
  },
};

test.beforeAll(() => {
  mkdirSync(SHOT_DIR, { recursive: true });
});

test.describe("P5a — authorable frame elements v2 on the live funnel", () => {
  let rich: Seeded;

  test.beforeAll(async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    rich = await seedFrameFunnel(ctx, "rich", RICH_FRAME, 2);
    await ctx.dispose();
  });

  test("10E free text: page targeting honored LIVE across a 2-page funnel", async ({ page }) => {
    await page.goto(shellUrl(rich), { waitUntil: "load" });
    await ready(page);
    const ftFirst = page.locator('[data-free-text-id="ft_first"]');
    const ftAll = page.locator('[data-free-text-id="ft_all"]');
    // page 1: both visible; the first block's rich text is sanitized+rendered.
    await expect(ftFirst).toBeVisible();
    await expect(ftAll).toBeVisible();
    await expect(ftFirst.locator("strong")).toHaveText("Shown only on page 1");
    await expect(ftAll.locator("li")).toHaveCount(2);
    await page.screenshot({ path: `${SHOT_DIR}/page1.png`, fullPage: true });
    // advance to page 2 → the `first` block HIDES (engine data-show-on toggle),
    // the `all` block stays. This is the zero-engine-byte live proof.
    await answerPageAndContinue(page);
    await expect(page.locator('[data-lg-progress]').first()).toHaveAttribute("data-lg-progress-current", "2");
    await expect(ftFirst).toBeHidden();
    await expect(ftAll).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/page2.png`, fullPage: true });
  });

  test("10F brand logos: ROW at desktop (1280), GRID at mobile (375)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(shellUrl(rich), { waitUntil: "load" });
    await ready(page);
    const strip = page.locator(".lg-frame-brand-logos .lg-logo-strip");
    await expect(strip).toBeVisible();
    await expect(strip.locator("img.lg-logo-strip-img")).toHaveCount(3);
    const desktopDisplay = await strip.evaluate((el) => getComputedStyle(el).display);
    expect(desktopDisplay, "desktop row = flex").toBe("flex");
    await page.setViewportSize({ width: 375, height: 800 });
    // re-evaluate the computed display at the mobile breakpoint.
    const mobileDisplay = await strip.evaluate((el) => getComputedStyle(el).display);
    expect(mobileDisplay, "mobile grid").toBe("grid");
    await page.screenshot({ path: `${SHOT_DIR}/logos-mobile.png`, fullPage: true });
  });

  test("10H-adjacent disclosure v2: top full + bottom hover tooltip", async ({ page }) => {
    await page.goto(shellUrl(rich), { waitUntil: "load" });
    await ready(page);
    await expect(page.locator(".lg-frame-disc2-region--top")).toContainText("This is an advertisement.");
    const hover = page.locator(".lg-frame-disc2--hover").first();
    await expect(hover).toBeVisible();
    const tip = hover.locator(".lg-frame-disc2-tip");
    // CSS-only: tooltip is transparent until hover, opaque on hover.
    expect(await tip.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
    await hover.hover();
    await expect.poll(async () => tip.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  });

  test("10C CTA/phone: a slot in EACH placement; a state-conditioned slot is hidden+hooked", async ({ page }) => {
    await page.goto(shellUrl(rich), { waitUntil: "load" });
    await ready(page);
    for (const slot of ["header_right", "under_header", "section_bottom", "footer"]) {
      await expect(page.locator(`.lg-frame-cta--${slot}`).first()).toBeAttached();
    }
    // tel: links present.
    await expect(page.locator('a[href="tel:+1 555 111 0000"]')).toBeVisible();
    // header_right respects logo_align via the has-right modifier.
    await expect(page.locator(".lg-frame-header--has-right")).toBeAttached();
    // the state-conditioned slot: server-rendered HIDDEN with the EXISTING
    // evaluator hook + the compiled group (live toggle = engine seam).
    const cond = page.locator('[data-lg-node="cta_ca_only"]');
    await expect(cond).toBeHidden();
    await expect(cond).toHaveAttribute("data-lg-cta-condition", /__state/);
  });

  test("10G trust row: icon + text + CSS-only hover tooltip", async ({ page }) => {
    await page.goto(shellUrl(rich), { waitUntil: "load" });
    await ready(page);
    const row = page.locator(".lg-frame-trustrow").first();
    await expect(row).toBeVisible();
    await expect(row.locator(".lg-frame-trustrow-icon svg")).toHaveCount(2);
    const item = row.locator(".lg-frame-trustrow-item").first();
    const tip = item.locator(".lg-frame-trustrow-tip");
    expect(await tip.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
    await item.hover();
    await expect.poll(async () => tip.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  });

  test("10H footer v2: blocks render with an OWN palette scope (footer bg != page bg)", async ({ page }) => {
    await page.goto(shellUrl(rich), { waitUntil: "load" });
    await ready(page);
    const footer = page.locator(".lg-frame-footer2");
    await expect(footer).toBeVisible();
    await expect(footer.locator(".lg-frame-footer2-about")).toContainText("Acme Insure Inc.");
    await expect(footer.locator(".lg-frame-footer2-links a")).toContainText("Privacy");
    // scoped palette: the footer background differs from the page background.
    const footerBg = await footer.evaluate((el) => getComputedStyle(el).backgroundColor);
    const pageBg = await page.locator("#lg-funnel-root").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(footerBg).not.toBe("rgba(0, 0, 0, 0)"); // a real scoped color, not transparent
    expect(footerBg).not.toBe(pageBg);
    await page.screenshot({ path: `${SHOT_DIR}/footer.png`, fullPage: true });
  });
});

test.describe("P5a — 10D/B-4.7 progress styles are visually DISTINCT (browser computed styles)", () => {
  const STYLES = ["bar", "dots", "numbered", "percent", "icon_on_track"] as const;
  const seeded: Record<string, Seeded> = {};

  test.beforeAll(async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    for (const style of STYLES) {
      seeded[style] = await seedFrameFunnel(
        ctx,
        `prog-${style}`,
        { version: 1, template: "centered", progress: { style, show_label: true } },
        1,
      );
    }
    await ctx.dispose();
  });

  test("each progress style produces a UNIQUE computed-style signature", async ({ page }) => {
    const sigOf = async (style: string): Promise<string> => {
      await page.goto(shellUrl(seeded[style]!), { waitUntil: "load" });
      await ready(page);
      const region = page.locator('[data-frame-region="progress"]').first();
      return region.evaluate((el) => {
        const has = (sel: string) => el.querySelector(sel) !== null;
        const fill = el.querySelector(".lg-progress-fill");
        const thumb = fill ? getComputedStyle(fill as Element, "::after").content : "none";
        const label = el.querySelector(".lg-progress-text");
        const labelPos = label ? getComputedStyle(label as Element).position : "none";
        const mode = el.querySelector("[data-lg-progress]")?.getAttribute("data-mode") ?? "none";
        return JSON.stringify({
          track: has(".lg-progress-track"),
          numbered: has(".lg-steps--numbered"),
          dots: has(".lg-steps") && !has(".lg-steps--numbered"),
          thumb: thumb !== "none" && thumb !== "normal",
          labelPos,
          mode,
        });
      });
    };
    const sigs: Record<string, string> = {};
    for (const style of STYLES) sigs[style] = await sigOf(style);
    // every signature is unique — no style renders identically to another
    // (the old `numbered`==`bar` fake alias is gone).
    const unique = new Set(Object.values(sigs));
    expect(unique.size, `signatures: ${JSON.stringify(sigs, null, 2)}`).toBe(STYLES.length);
    // numbered specifically must NOT equal bar (the B-4.7 fix).
    expect(sigs.numbered).not.toBe(sigs.bar);
  });
});
