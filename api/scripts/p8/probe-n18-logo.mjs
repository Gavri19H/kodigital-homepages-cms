// P8 CLOSE — N18's named INCONCLUSIVE step, executed (register row N18):
//   "on a site that HAS a logo, load the funnel at display_size m and at xxl
//    and confirm the rendered .lg-logo font-size is identical, at 1280 and 375."
// The fixture site has no logo, so this probe AUTHORS one through the real
// operator routes (the S3.8 convention: no direct DB writes, no hand-built
// render inputs — E10/E11):
//   1. GET the fixture's shared section, keep its original content_json;
//   2. PATCH the section with a HeaderLogo component prepended (the Studio's
//      own save route — content shape per test-ui/leadgen-p5-seed.ts);
//   3. PUT funnel A's inline theme typography.display_size = "m", drive the
//      real visitor page in chromium (host-resolver MAP, real Chrome UA),
//      measure getComputedStyle(.lg-logo).fontSize AND a display-ramp control
//      element at 1280x900 and 375x812, screenshot both;
//   4. same at display_size "xxl";
//   5. verdict: logo font-size IDENTICAL m vs xxl at both viewports while the
//      ramp element DIFFERS (display type still ramps — the N18 fix's two
//      halves);
//   6. restore the section's original content_json and the theme binding.
// Conventions (ports, UA, restore discipline) mirror verify-inline-theme-keys.mjs.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const PORT = process.argv.includes("--port") ? process.argv[process.argv.indexOf("--port") + 1] : "8901";
const LG_BASE = `http://127.0.0.1:${PORT}`;
const SITE_HOST = "r2fix.e2e.test";
// Fixture ULIDs are minted fresh on every seed run (the CLOSE sweep learned this
// the hard way: hardcoded mission-era ids 404 after any reseed), so BOTH the
// funnel and the quote are resolved live: quotes list -> the fixture quote by
// its seed-stable NAME -> structure -> funnel A + the shared entry page.
const FIXTURE_QUOTE_NAME = "R2Fix Fixture Quote";
const OUT_DIR = process.env.N18_OUT ?? "test-results/n18";
const REAL_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

let cb = 0;
const freshUrl = () => `http://${SITE_HOST}:${PORT}/lg/r2fix?_cb=${Date.now()}-${++cb}`;

async function j(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text === "" ? null : JSON.parse(text);
}

// The served shell can lag a section PATCH by >20s (the P8-5 G3 lesson: its
// settle loop went to 90s after a timeout killed a reviewer). Poll FRESH ?_cb
// urls in short logged steps — never one long silent wait.
async function settleUntilLogo(page, makeUrl, attempts = 12) {
  for (let i = 1; i <= attempts; i++) {
    await page.goto(makeUrl(), { waitUntil: "domcontentloaded" });
    const found = await page.locator(".lg-logo").count();
    console.log(`[n18] settle attempt ${i}/${attempts}: .lg-logo count=${found}`);
    if (found > 0) return;
    await new Promise((r) => setTimeout(r, 7000));
  }
  throw new Error(".lg-logo never appeared on the served page (settle exhausted)");
}

async function measure(page, url, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".lg-logo", { timeout: 15000 });
  return page.evaluate(() => {
    const logo = document.querySelector(".lg-logo");
    const ramp =
      document.querySelector(".lg-question-title") ??
      document.querySelector(".lg-headline") ??
      document.querySelector("h1,h2");
    return {
      logoFontSize: logo ? getComputedStyle(logo).fontSize : null,
      logoVisible: logo ? logo.getClientRects().length > 0 : false,
      rampSelector: ramp ? (ramp.className || ramp.tagName) : null,
      rampFontSize: ramp ? getComputedStyle(ramp).fontSize : null,
    };
  });
}

const main = async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1. resolve quote -> structure -> the shared entry page's section (all live, no hardcoded ids)
  const quotes = await j("GET", `${LG_BASE}/api/admin/leadgen/quotes`);
  const quote = (quotes.items ?? quotes).find((q) => q.quote_name === FIXTURE_QUOTE_NAME);
  if (!quote) throw new Error(`fixture quote "${FIXTURE_QUOTE_NAME}" not found`);
  const structure = await j("GET", `${LG_BASE}/api/admin/leadgen/quotes/${quote.public_id}/structure`);
  const funnel = structure.funnels[0];
  const funnelId = funnel.public_id;
  const THEME_API = `${LG_BASE}/api/admin/leadgen/funnels/${funnelId}/theme`;
  // NOT the shared section: the runtime SKIPS a content-empty shared page (the
  // Continue-only fixture page never serves), so the logo rides the funnel's
  // own first section — the page the visitor demonstrably gets (its question
  // renders in the served HTML).
  const variant = funnel.variants[0];
  const vSections = variant.sections ?? variant.pages?.flatMap((p) => p.sections ?? []) ?? [];
  const sectionId = vSections[0]?.section_public_id ?? vSections[0]?.public_id;
  if (!sectionId) throw new Error(`could not resolve a funnel section id (variant keys: ${Object.keys(variant)})`);
  console.log(`[n18] quote ${quote.public_id} funnel ${funnelId} funnel section ${sectionId}`);

  // 2. original content, then PATCH with HeaderLogo prepended (real Studio save route)
  const original = await j("GET", `${LG_BASE}/api/admin/leadgen/sections/${sectionId}`);
  const originalContent = original.item?.content_json ?? original.content_json;
  if (!originalContent?.components) throw new Error("section content_json has no components[]");
  const logoNode = {
    type: "HeaderLogo",
    question_id: "n18_probe_logo",
    // logoMediaId is schema-required; with no logoUrl the renderer still takes
    // the TEXT branch and paints the .lg-logo span (presets.ts:922-929, the
    // leadgen-p5-seed.ts shape) — which is exactly the element N18 measures.
    props: { logoMediaId: "lgm_default_funnel", siteName: "N18Probe", accent: "Logo" },
  };
  const patched = { ...originalContent, components: [logoNode, ...originalContent.components] };

  // 3/4. theme binding: read current, then drive m vs xxl through the real PUT
  const themeBefore = await j("GET", THEME_API);
  const boundTheme = themeBefore.item?.theme_json ?? themeBefore.theme_json ?? {};
  const withSize = (sz) => ({ ...boundTheme, typography: { ...(boundTheme.typography ?? {}), display_size: sz } });

  const browser = await chromium.launch({
    args: [`--host-resolver-rules=MAP ${SITE_HOST} 127.0.0.1`],
  });
  const page = await (await browser.newContext({ userAgent: REAL_UA })).newPage();
  const results = {};
  try {
    await j("PATCH", `${LG_BASE}/api/admin/leadgen/sections/${sectionId}`, { content_json: patched });
    await page.setViewportSize({ width: 1280, height: 900 });
    await settleUntilLogo(page, freshUrl);
    for (const size of ["m", "xxl"]) {
      await j("PUT", THEME_API, { theme_json: withSize(size) });
      for (const [label, vp] of [
        ["1280", { width: 1280, height: 900 }],
        ["375", { width: 375, height: 812 }],
      ]) {
        const m = await measure(page, freshUrl(), vp);
        results[`${size}-${label}`] = m;
        const shot = path.join(OUT_DIR, `n18-${size}-${label}.png`);
        await page.screenshot({ path: shot, fullPage: false });
        console.log(`[n18] display_size=${size} @${label}: logo=${m.logoFontSize} visible=${m.logoVisible} ramp(${m.rampSelector})=${m.rampFontSize} -> ${shot}`);
      }
    }
  } finally {
    // 6. restore — section content byte-for-byte, then the original theme binding
    await j("PATCH", `${LG_BASE}/api/admin/leadgen/sections/${sectionId}`, { content_json: originalContent });
    await j("PUT", THEME_API, { theme_json: boundTheme });
    await browser.close();
  }

  // 5. verdict
  const same = (a, b) => results[a].logoFontSize === results[b].logoFontSize;
  const visible = Object.values(results).every((r) => r.logoVisible && r.logoFontSize);
  const logoStable = same("m-1280", "xxl-1280") && same("m-375", "xxl-375");
  const rampMoves = results["m-1280"].rampFontSize !== results["xxl-1280"].rampFontSize;
  const verdict = visible && logoStable && rampMoves ? "PASS" : "FAIL";
  console.log(
    `[n18] VERDICT=${verdict} visible=${visible} logoStable(m==xxl)=${logoStable} rampMoves(m!=xxl)=${rampMoves}`,
  );
  fs.writeFileSync(path.join(OUT_DIR, "n18-verdict.json"), JSON.stringify({ verdict, results }, null, 2));
  if (verdict !== "PASS") process.exit(1);
};

main().catch((e) => {
  console.error(`[n18] FATAL: ${e.message}`);
  process.exit(2);
});
