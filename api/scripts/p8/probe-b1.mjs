/**
 * probe-b1.mjs — B1 (contract R1-1) acceptance probe. MISSION EVIDENCE TOOLING.
 * Not wired into CI / package.json / verify:all.
 *
 * Contract B1 acceptance: "on a driven multi-field address page with a real Maps
 * key, the Autocomplete constructor is invoked >=1 (intercept it), typing produces
 * suggestions, and choosing one fills the mapped fields. Plus: no Maps JS is loaded
 * when no job is enabled."
 *
 * Drives the REAL visitor page on the local worker. The Autocomplete constructor is
 * intercepted by wrapping window.google as it is defined by the SDK loader, so the
 * count is of REAL constructor invocations by the REAL runtime (never a stub of the
 * product side). Google's own remote SDK is left untouched: whether Google ACCEPTS
 * the supplied key is recorded from its actual response, never assumed.
 *
 * Usage: node scripts/p8/probe-b1.mjs [--base http://127.0.0.1:8901] [--slug r2fix]
 */
import { chromium } from "playwright";

const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const BASE = argOf("--base", "http://127.0.0.1:8901");
const SLUG = argOf("--slug", "r2fix");
const HOST = argOf("--host", "r2fix.e2e.test");
const PORT = new URL(BASE).port || "80";
const REAL_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Wraps window.google at definition time so EVERY Autocomplete construction by the
// real runtime is counted. Also records SDK-level errors Google reports (gm_authFailure
// fires for a rejected key) so the verdict cites Google's real answer.
const INTERCEPT = `
window.__p8 = { ctorCalls: 0, ctorArgs: [], authFailure: false, consoleErrors: [] };
window.gm_authFailure = function () { window.__p8.authFailure = true; };
(function () {
  var real;
  function wrap(g) {
    try {
      if (g && g.maps && g.maps.places && g.maps.places.Autocomplete && !g.maps.places.Autocomplete.__p8wrapped) {
        var Orig = g.maps.places.Autocomplete;
        var Wrapped = function (input, opts) {
          window.__p8.ctorCalls++;
          try { window.__p8.ctorArgs.push({ id: input && input.id, fields: opts && opts.fields }); } catch (e) {}
          return new Orig(input, opts);
        };
        Wrapped.prototype = Orig.prototype;
        Wrapped.__p8wrapped = true;
        g.maps.places.Autocomplete = Wrapped;
      }
    } catch (e) {}
    return g;
  }
  Object.defineProperty(window, 'google', {
    configurable: true,
    get: function () { return real; },
    set: function (v) { real = wrap(v); setTimeout(function () { wrap(real); }, 0); }
  });
  // The modern loader (loading=async) materialises google.maps.places LATE, so a
  // one-shot wrap at assignment time can miss the real constructor entirely and
  // under-report. Keep polling until it exists, then wrap it.
  var tries = 0;
  var iv = setInterval(function () {
    tries++;
    if (real) wrap(real);
    if ((real && real.maps && real.maps.places && real.maps.places.Autocomplete &&
         real.maps.places.Autocomplete.__p8wrapped) || tries > 400) clearInterval(iv);
  }, 25);

  // Polling alone races the product: the runtime constructs its Autocomplete inside
  // the SDK ready-callback, microseconds after Places materialises. So intercept the
  // product's OWN ready hook (runtime/maps.ts LG_MAPS_CALLBACK) — wrap first, then
  // hand control to the real callback, guaranteeing every construction is counted.
  var readyFn;
  Object.defineProperty(window, '__LG_MAPS_ON_READY__', {
    configurable: true,
    get: function () {
      return readyFn === undefined ? undefined : function () {
        wrap(real);
        window.__p8.readyCallbackFired = true;
        return readyFn.apply(this, arguments);
      };
    },
    set: function (fn) { readyFn = fn; }
  });
})();
`;

async function drive(label, url, { expectSdk }) {
  const browser = await chromium.launch({
    headless: true,
    args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`],
  });
  const ctx = await browser.newContext({ userAgent: REAL_UA, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const sdkRequests = [];
  page.on("request", (r) => {
    if (r.url().includes("maps.googleapis.com")) sdkRequests.push(r.url());
  });
  const sdkResponses = [];
  page.on("response", (r) => {
    if (r.url().includes("maps.googleapis.com")) sdkResponses.push({ status: r.status(), url: r.url() });
  });
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });
  await page.addInitScript(INTERCEPT);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  // The address question is NOT on the funnel's first (shared) page: the visitor
  // reaches it by advancing. Walk forward until a VISIBLE [data-lg-maps] field is
  // on screen (or we run out of Continue buttons) — the ctor count must be taken
  // on the page the visitor actually sees the address on.
  const walk = [];
  for (let hop = 0; hop < 4; hop++) {
    const visibleNow = await page.evaluate(
      () => [...document.querySelectorAll("[data-lg-maps]")].filter((el) => el.offsetWidth || el.offsetHeight).length,
    );
    walk.push({ hop, visibleMapsFields: visibleNow });
    if (visibleNow > 0) break;
    const advanced = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button, .lg-continue, [data-lg-continue]")].find(
        (b) => (b.offsetWidth || b.offsetHeight) && /continue|next/i.test(b.textContent || ""),
      );
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!advanced) break;
    await page.waitForTimeout(1800);
  }
  await page.waitForTimeout(1200);

  // --- typing leg: does a REAL keystroke produce REAL Google predictions, and does
  // choosing one fill the sibling fields the operator mapped? (contract B1 acceptance)
  const typing = { attempted: false, predictions: 0, chosen: null, filledAfter: null, filledBefore: null };
  const streetSel = '[data-lg-maps] input';
  if (await page.locator(streetSel).count()) {
    typing.attempted = true;
    typing.filledBefore = await page.evaluate(() =>
      Object.fromEntries([...document.querySelectorAll('input[data-lg-input]')].map((i) => [i.getAttribute('id') || i.name, i.value])));
    await page.click(streetSel);
    await page.type(streetSel, '1600 Amphitheatre Pkwy', { delay: 120 });
    await page.waitForTimeout(2500);
    typing.predictions = await page.evaluate(() =>
      [...document.querySelectorAll('.pac-container .pac-item')].filter((e) => e.offsetWidth || e.offsetHeight).length);
    if (typing.predictions > 0) {
      typing.chosen = await page.evaluate(() => (document.querySelector('.pac-container .pac-item')?.textContent || '').slice(0, 80));
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2000);
      typing.filledAfter = await page.evaluate(() =>
        Object.fromEntries([...document.querySelectorAll('input[data-lg-input]')].map((i) => [i.getAttribute('id') || i.name, i.value])));
    }
  }

  const shotDir = "../docs/leadgen/r2/evidence/p8/b1";
  const slugLabel = label.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40);
  await page.screenshot({ path: `${shotDir}/${slugLabel}-1280.png` });
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${shotDir}/${slugLabel}-375.png` });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(400);

  const dom = await page.evaluate(() => {
    const fields = [...document.querySelectorAll("[data-lg-maps]")].map((el) => ({
      field: el.getAttribute("data-lg-field"),
      cfg: el.getAttribute("data-lg-maps"),
      inputId: el.querySelector("input")?.id ?? null,
      visible: !!(el.offsetWidth || el.offsetHeight),
    }));
    return {
      mapsFields: fields,
      p8: { ctorCalls: window.__p8.ctorCalls, ctorArgs: window.__p8.ctorArgs, authFailure: window.__p8.authFailure, readyCallbackFired: !!window.__p8.readyCallbackFired },
      // Product-side signals INDEPENDENT of the interceptor: Google itself creates a
      // .pac-container per live Autocomplete widget, and the runtime marks wired inputs.
      pacContainers: document.querySelectorAll('.pac-container').length,
      placesCtorPresent: !!(window.google && window.google.maps && window.google.maps.places && window.google.maps.places.Autocomplete),
      ctorWrapped: !!(window.google && window.google.maps && window.google.maps.places && window.google.maps.places.Autocomplete && window.google.maps.places.Autocomplete.__p8wrapped),
      sdkScripts: [...document.querySelectorAll('script[src*="maps.googleapis.com"]')].length,
    };
  });

  const redact = (u) => u.replace(/key=[^&]*/, "key=REDACTED");
  const out = {
    label,
    url: url.replace(/\?_cb=\d+/, "?_cb=<ts>"),
    mapsFieldCount: dom.mapsFields.length,
    visibleMapsFields: dom.mapsFields.filter((f) => f.visible).length,
    firstCfg: dom.mapsFields[0]?.cfg ?? null,
    sdkScriptTags: dom.sdkScripts,
    sdkRequests: sdkRequests.map(redact),
    sdkResponses: sdkResponses.map((r) => ({ status: r.status, url: redact(r.url) })),
    walk,
    pacContainers: dom.pacContainers,
    placesCtorPresent: dom.placesCtorPresent,
    ctorWrapped: dom.ctorWrapped,
    readyCallbackFired: dom.p8?.readyCallbackFired ?? false,
    autocompleteCtorCalls: dom.p8?.ctorCalls ?? 0,
    ctorArgs: dom.p8?.ctorArgs ?? [],
    googleAuthFailure: dom.p8?.authFailure ?? false,
    typing,
    consoleErrors: consoleErrors.slice(0, 6),
    expectSdk,
  };
  await browser.close();
  return out;
}

const cb = () => `?_cb=${Date.now()}`;
const results = [];
results.push(
  await drive("multi-field address (autocomplete job ON)", `http://${HOST}:${PORT}/lg/${SLUG}${cb()}`, {
    expectSdk: true,
  }),
);

console.log("\n=== B1 PROBE (contract R1-1 acceptance) ===");
for (const r of results) {
  console.log(`\n--- ${r.label} ---`);
  console.log(`url:                       ${r.url}`);
  console.log(`[data-lg-maps] fields:     ${r.mapsFieldCount} (visible ${r.visibleMapsFields})`);
  console.log(`funnel walk:               ${JSON.stringify(r.walk)}`);
  console.log(`served config (field 1):   ${r.firstCfg}`);
  console.log(`SDK <script> tags:         ${r.sdkScriptTags}`);
  console.log(`SDK requests:              ${r.sdkRequests.length}`);
  for (const u of r.sdkRequests) console.log(`   -> ${u.slice(0, 140)}`);
  for (const s of r.sdkResponses) console.log(`   <- HTTP ${s.status}`);
  console.log(`places ctor present:       ${r.placesCtorPresent}   (interceptor attached: ${r.ctorWrapped})`);
  console.log(`ready-callback intercepted: ${r.readyCallbackFired}`);
  console.log(`.pac-container elements:   ${r.pacContainers}   <-- Google's own per-widget signal`);
  console.log(`Autocomplete ctor calls:   ${r.autocompleteCtorCalls}   <-- the B1 measurement`);
  console.log(`ctor args:                 ${JSON.stringify(r.ctorArgs).slice(0, 300)}`);
  console.log(`google gm_authFailure:     ${r.googleAuthFailure}`);
  console.log(`typing leg:                attempted=${r.typing.attempted} predictions=${r.typing.predictions}`);
  console.log(`  chosen prediction:       ${r.typing.chosen ?? '(none)'}`);
  console.log(`  fields BEFORE:           ${JSON.stringify(r.typing.filledBefore)}`);
  console.log(`  fields AFTER:            ${JSON.stringify(r.typing.filledAfter)}`);
  if (r.consoleErrors.length) {
    console.log(`console errors:`);
    for (const e of r.consoleErrors) console.log(`   ! ${e}`);
  }
}
console.log("\n(evidence tooling — conductor runs this as the authoritative pass)");
