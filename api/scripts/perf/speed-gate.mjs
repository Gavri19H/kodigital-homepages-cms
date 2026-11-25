import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import { brotliCompressSync } from "node:zlib";

const exec = promisify(execFile);
const profiles = ["mobile", "desktop"];
const requiredPages = ["home", "article", "category", "tag", "page", "listicle", "quote"];
const configUrl = new URL("./speed-gate.config.json", import.meta.url);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;

function thresholds(label, values = {}) {
  if (values === null || typeof values !== "object" || Array.isArray(values)) {
    throw new Error(label + " needs a Lighthouse thresholds object");
  }
  for (const [profile, score] of Object.entries(values)) {
    if (!profiles.includes(profile) || !positiveInteger(score) || score > 100) {
      throw new Error(label + " has an invalid " + profile + " score threshold");
    }
  }
  return values;
}

export function validateConfig(config) {
  if (!Array.isArray(config?.pages)) throw new Error("Expected a pages array");
  const defaults = { mobile: 95, desktop: 100, ...thresholds("gate", config.lighthouse) };
  const types = new Set();
  const paths = new Set();
  const pages = config.pages.map(page => {
    const { type, path, selector } = page;
    if (!type || typeof type !== "string" || types.has(type)) throw new Error("Missing or duplicate page type: " + type);
    if (typeof path !== "string" || !/^\/(?!\/)[\w/-]*$/.test(path) || paths.has(path)) {
      throw new Error(type + " needs a unique local path");
    }
    if (typeof selector !== "string" || !selector.trim()) throw new Error(type + " needs a content selector");
    types.add(type);
    paths.add(path);
    const lighthouse = { ...defaults, ...thresholds(type, page.lighthouse) };
    const caps = ["htmlBytes", "brotliBytes"];
    if (type === "quote") caps.push("quoteRuntimeBytes");
    if (type === "quote" || page.totalBytes !== undefined) caps.push("totalBytes");
    for (const cap of caps) {
      if (!positiveInteger(page[cap])) throw new Error(type + " needs a positive " + cap + " limit");
    }
    return { ...page, lighthouse };
  });
  for (const type of requiredPages) {
    if (!types.has(type)) throw new Error("Missing page type: " + type);
  }
  return pages;
}

export function containsEmbeddedFont(text) {
  return /data:\s*(?:font\b|application\/(?:x-)?font[-/])|@font-face\s*\{[^}]*url\(\s*["']?\s*data:/i.test(text);
}

export function medianScore(samples) {
  if (!samples.length || samples.length % 2 === 0 ||
      !samples.every(n => Number.isFinite(n) && n >= 0 && n <= 100)) {
    throw new Error("Expected an odd number of Lighthouse scores between 0 and 100");
  }
  return [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];
}

// This is the verdict for one real navigation. Keep collection, including all
// browser and socket use, outside it so the exact boundary can be tested offline.
export function evaluateBudgets(budget, profile, metrics) {
  const failures = [];
  const fail = (metric, actual, expected) => failures.push({ metric, actual, expected });
  const threshold = budget.lighthouse[profile];
  if (!Number.isFinite(metrics.score) || metrics.score < threshold || metrics.score > 100) {
    fail(profile, metrics.score, "score >= " + threshold);
  }
  const caps = ["htmlBytes", "brotliBytes"];
  if (budget.quoteRuntimeBytes !== undefined) caps.push("quoteRuntimeBytes");
  if (budget.totalBytes !== undefined) caps.push("totalBytes");
  for (const cap of caps) {
    if (!positiveInteger(metrics[cap]) || metrics[cap] > budget[cap]) {
      fail(cap, metrics[cap] ?? null, "1 to " + budget[cap] + " bytes");
    }
  }
  if (metrics.embeddedFonts.length) fail("embeddedFonts", metrics.embeddedFonts, "no data: fonts");
  const origin = new URL(metrics.url).origin;
  for (const img of metrics.images) {
    if (new URL(img.url, metrics.url).origin !== origin) continue;
    if (![img.width, img.height].every(n => /^\d+$/.test(n) && Number(n) > 0)) {
      fail("imageDimensions", img, "positive width and height attributes");
    }
    if (img.broken) fail("imageLoad", img.url, "a decodable local image");
  }
  const lcp = metrics.lcp;
  if (!lcp?.tag) {
    fail("lcpElement", null, "an observed LCP element");
  } else if (lcp.tag === "IMG") {
    if (lcp.loading !== "eager" || lcp.fetchPriority !== "high") {
      fail("lcpImage", lcp, "loading=eager and fetchpriority=high");
    }
  } else if (lcp.url && !lcp.preloadedHigh) {
    fail("lcpImage", lcp.url, "a matching high-priority image preload for the LCP background");
  }
  for (const sheet of metrics.stylesheets) {
    if (sheet.blocking && new URL(sheet.url, metrics.url).origin !== origin) {
      fail("renderBlockingThirdPartyCss", sheet.url, "no render-blocking third-party stylesheet");
    }
  }
  return failures;
}

// Runs in Chromium. The buffered observer includes LCP candidates painted
// before load, and retains the last candidate after fonts and images settle.
function observeLcp() {
  new PerformanceObserver(list => {
    const entry = list.getEntries().at(-1);
    const element = entry.element;
    window.__speedGateLcp = {
      tag: element?.tagName, url: entry.url, timeMs: entry.startTime,
      loading: element?.loading, fetchPriority: element?.fetchPriority,
    };
  }).observe({ type: "largest-contentful-paint", buffered: true });
}

function inspectDom({ selector, stylesheetUrls }) {
  if (!document.querySelector(selector)) throw new Error("Missing seeded content: " + selector);
  if (!("renderBlockingStatus" in PerformanceResourceTiming.prototype)) throw new Error("Missing render-blocking timing");
  const lcp = window.__speedGateLcp;
  if (lcp?.url && lcp.tag !== "IMG") {
    lcp.preloadedHigh = [...document.querySelectorAll('link[rel~="preload"][as="image"]')].some(link => {
      if (link.fetchPriority !== "high" || (link.media && !matchMedia(link.media).matches)) return false;
      // Transform URLs can contain commas. Split candidates at descriptor boundaries.
      const sources = link.imageSrcset.split(/\s+[\d.]+[wx]\s*,\s*|,\s+/).map(src => src.trim().split(/\s+/)[0]);
      return [link.href, ...sources].some(src => src && new URL(src, document.baseURI).href === lcp.url);
    });
  }
  const images = [...document.images].map(img => ({
    url: img.currentSrc || img.src || img.srcset.trim().split(/\s+/)[0],
    width: img.getAttribute("width"), height: img.getAttribute("height"),
    broken: img.complete && Boolean(img.currentSrc) && img.naturalWidth === 0,
  })).filter(img => img.url);
  const sheets = new Set([...stylesheetUrls, ...[...document.styleSheets].map(sheet => sheet.href)]);
  const stylesheets = performance.getEntriesByType("resource").filter(entry => sheets.has(entry.name))
    .map(entry => ({ url: entry.name, blocking: entry.renderBlockingStatus === "blocking" }));
  // A blocked or failed request can lack timing. Preserve the active
  // stylesheet declaration in that case. Measured async/print loads keep
  // their actual non-blocking status even if script later changed the link.
  for (const link of document.querySelectorAll('link[rel~="stylesheet" i][href]')) {
    if (!stylesheets.some(sheet => sheet.url === link.href)) {
      stylesheets.push({ url: link.href, blocking: !link.disabled && !link.relList.contains("alternate") &&
        (!link.media || matchMedia(link.media).matches) });
    }
  }
  return {
    lcp, images, stylesheets,
    inlineCss: [...document.querySelectorAll("style")].map(style => style.textContent).join("\n"),
    runtimeUrls: [...new Set([...document.scripts].map(script => script.src).filter(src => src &&
      new URL(src).origin === location.origin && /^\/lg\/runtime\/[^/]+\.js$/.test(new URL(src).pathname)))],
  };
}

export function trackTransferBytes(cdp) {
  const bytesByRequest = new Map();
  let redirectBytes = 0;
  cdp.on("Network.requestWillBeSent", ({ requestId, request, redirectResponse }) => {
    // Redirect hops reuse the request ID and have no loadingFinished event.
    if (redirectResponse && bytesByRequest.has(requestId)) redirectBytes += redirectResponse.encodedDataLength;
    if (/^https?:/.test(request.url)) bytesByRequest.set(requestId, 0);
    else bytesByRequest.delete(requestId);
  });
  // Preserve received headers and encoded chunks even if a download is cancelled.
  cdp.on("Network.responseReceived", ({ requestId, response }) => {
    if (bytesByRequest.has(requestId)) bytesByRequest.set(requestId, response.encodedDataLength);
  });
  cdp.on("Network.dataReceived", ({ requestId, encodedDataLength }) => {
    if (bytesByRequest.has(requestId)) bytesByRequest.set(requestId, bytesByRequest.get(requestId) + encodedDataLength);
  });
  cdp.on("Network.loadingFinished", ({ requestId, encodedDataLength }) => {
    if (bytesByRequest.has(requestId)) bytesByRequest.set(requestId, encodedDataLength);
  });
  return () => [...bytesByRequest.values()].reduce((sum, bytes) => sum + bytes, redirectBytes);
}

async function inspectPage(browser, device, budget, profile, url) {
  // Each page and profile starts with an empty browser cache.
  const context = await browser.newContext(device);
  try {
    const page = await context.newPage();
    const responses = new Map();
    const stylesheetUrls = new Set();
    page.on("request", req => {
      if (req.resourceType() === "stylesheet") stylesheetUrls.add(req.url());
    });
    page.on("response", res => {
      responses.set(res.url(), res);
      if (/^text\/css\b/i.test(res.headers()["content-type"])) stylesheetUrls.add(res.url());
    });
    await page.addInitScript(observeLcp);
    const cdp = await context.newCDPSession(page);
    const totalTransferBytes = trackTransferBytes(cdp);
    await cdp.send("Network.enable");
    if (profile === "mobile") {
      // Applied 4G and 4x CPU slowdown for the Playwright phone visit.
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false, latency: 150, downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8,
      });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    }
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    if (response?.status() !== 200 || page.url() !== url || !/^text\/html\b/i.test(response.headers()["content-type"])) {
      throw new Error("Expected HTTP 200 HTML at " + url + ", got " + response?.status() + " at " + page.url());
    }
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForFunction(() => Boolean(window.__speedGateLcp), null, { timeout: 10_000 });
    const { images, lcp, stylesheets, runtimeUrls, inlineCss } = await page.evaluate(inspectDom, {
      selector: budget.selector, stylesheetUrls: [...stylesheetUrls],
    });
    const html = await response.body();
    const embeddedFonts = [];
    if (containsEmbeddedFont(html.toString("utf8")) || containsEmbeddedFont(inlineCss)) embeddedFonts.push(url);
    for (const href of stylesheetUrls) {
      const sheet = responses.get(href);
      // Redirects have no stylesheet body. Chromium reports the final request separately.
      if (sheet?.status() >= 300 && sheet.status() < 400) continue;
      if (new URL(href).origin === new URL(url).origin && !sheet?.ok()) {
        throw new Error("Missing local stylesheet response at " + href);
      }
      if (sheet?.ok() && containsEmbeddedFont(await sheet.text())) embeddedFonts.push(href);
    }
    // Resource Timing names the original URL even when a local stylesheet
    // redirects. Every redirect in a blocking fetch delays the same paint.
    for (const sheet of [...stylesheets]) {
      for (let req = responses.get(sheet.url)?.request().redirectedTo(); req; req = req.redirectedTo()) {
        stylesheets.push({ url: req.url(), blocking: sheet.blocking });
      }
    }
    let quoteRuntimeBytes;
    if (budget.quoteRuntimeBytes !== undefined) {
      quoteRuntimeBytes = 0;
      for (const href of runtimeUrls) {
        const js = responses.get(href);
        if (!js?.ok() || !/(?:java|ecma)script/i.test(js.headers()["content-type"])) {
          throw new Error("Missing quote runtime JavaScript response at " + href);
        }
        quoteRuntimeBytes += (await js.body()).length;
      }
    }
    return {
      url, htmlBytes: html.length, brotliBytes: brotliCompressSync(html).length, quoteRuntimeBytes,
      totalBytes: totalTransferBytes(), images, lcp, stylesheets, embeddedFonts,
    };
  } finally {
    await context.close();
  }
}

async function lighthouseScore(url, profile, executablePath) {
  const args = [url, "--quiet", "--only-categories=performance", "--output=json", "--output-path=stdout",
    "--chrome-flags=--headless --no-sandbox --disable-dev-shm-usage"];
  // Lighthouse's mobile default and its desktop preset each supply the
  // appropriate screen, user agent, CPU and simulated network settings.
  if (profile === "desktop") args.push("--preset=desktop");
  const { stdout } = await exec("lighthouse", args, {
    env: { ...process.env, CHROME_PATH: executablePath }, maxBuffer: 32 * 1024 * 1024, timeout: 120_000,
  });
  const lhr = JSON.parse(stdout);
  if (lhr.runtimeError) throw new Error(lhr.runtimeError.message);
  if (lhr.lighthouseVersion !== "12.6.1" || lhr.configSettings?.formFactor !== profile) {
    throw new Error("Expected Lighthouse 12.6.1 " + profile);
  }
  const document = lhr.audits["network-requests"]?.details?.items?.find(item =>
    item.resourceType === "Document" && item.url === url);
  if (lhr.finalDisplayedUrl !== url || document?.statusCode !== 200) throw new Error("Lighthouse did not audit HTTP 200 " + url);
  const score = lhr.categories?.performance?.score;
  if (!Number.isFinite(score) || score < 0 || score > 1) throw new Error("Missing Lighthouse performance score");
  return Number((score * 100).toFixed(6));
}

export function fixtureHtml(heavy) {
  const script = heavy ? '<script>/*' + "X".repeat(2 * 1024 * 1024) +
    '*/const end=performance.now()+1500;while(performance.now()<end){}</script>' : "";
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" ' +
    'content="width=device-width,initial-scale=1"><title>Speed gate fixture</title>' + script +
    '</head><body><main class="page-content"><p>Local speed gate fixture</p></main></body></html>';
}

async function startFixture() {
  const server = createServer((req, res) => {
    if (req.url !== "/heavy" && req.url !== "/light") { res.writeHead(404).end(); return; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(fixtureHtml(req.url === "/heavy"));
  });
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  return server;
}

async function audit(report, selfTest) {
  let pages = validateConfig(JSON.parse(await readFile(configUrl, "utf8")));
  const { chromium, devices } = await import("@playwright/test");
  let origin = "http://localhost:" + (process.env.PW_PORT || "8787");
  let server;
  let browser;
  try {
    if (selfTest) {
      server = await startFixture();
      origin = "http://127.0.0.1:" + server.address().port;
      const page = pages.find(p => p.type === "page");
      const { totalBytes } = pages.find(p => p.type === "quote");
      pages = ["heavy", "light"].map(type => ({ ...page, type, path: "/" + type, selector: ".page-content p", totalBytes }));
    }
    browser = await chromium.launch();
    for (const budget of pages) {
      const url = new URL(budget.path, origin).href;
      for (const profile of profiles) {
        const row = { type: budget.type, url, profile, budget, samples: [], failures: [] };
        report.results.push(row);
        let stage = "Playwright";
        try {
          const device = devices[profile === "mobile" ? "Pixel 5" : "Desktop Chrome"];
          row.metrics = await inspectPage(browser, device, budget, profile, url);
          stage = "Lighthouse";
          for (let run = 0; run < (selfTest ? 1 : 3); run++) {
            row.samples.push(await lighthouseScore(url, profile, chromium.executablePath()));
          }
          row.metrics.score = medianScore(row.samples);
          row.failures = evaluateBudgets(budget, profile, row.metrics);
        } catch (error) {
          row.error = stage + ": " + error.message;
        }
        for (const miss of row.failures) {
          console.error(budget.type, profile, url, miss.metric, JSON.stringify(miss.actual), "expected", miss.expected);
        }
        if (row.error) console.error(budget.type, profile, url, row.error);
      }
    }
  } finally {
    try { await browser?.close(); }
    finally { if (server) await new Promise(resolve => server.close(resolve)); }
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    help: { type: "boolean", short: "h" }, "self-test": { type: "boolean" }, report: { type: "string" },
  } });
  if (values.help) {
    console.log("Usage: npm run perf:speed-gate -- [--self-test] [--report PATH]\n" +
      "Audit the seeded local Worker at http://localhost:8787 (PW_PORT overrides the port).\n" +
      "Uses Chromium and Lighthouse 12.6.1. Each page gets three runs per profile, with median targets of 95 mobile and 100 desktop.\n" +
      "Page fixtures and startup commands are in .github/workflows/speed-gate.yml. Budgets are in speed-gate.config.json.\n" +
      "--self-test serves a heavy page and its light control on loopback. Expect exit 1 for the heavy page.\n" +
      "--report writes JSON (default: test-artifacts/speed-gate/report.json or self-test.json).\n" +
      "Exit 0 for a pass, 1 for budget misses, 2 for incomplete measurements.");
    return;
  }
  const selfTest = Boolean(values["self-test"]);
  const path = values.report ?? ("test-artifacts/speed-gate/" + (selfTest ? "self-test.json" : "report.json"));
  const report = { mode: selfTest ? "self-test" : "worker", results: [] };
  try { await audit(report, selfTest); }
  catch (error) { report.error = error.message; console.error(report.error); }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2) + "\n");
  console.table(report.results.map(({ type, profile, samples, metrics, failures, error }) => ({
    page: type, profile, samples: samples.join(", "), score: metrics?.score,
    htmlBytes: metrics?.htmlBytes, brotliBytes: metrics?.brotliBytes, quoteRuntimeBytes: metrics?.quoteRuntimeBytes,
    totalBytes: metrics?.totalBytes,
    result: error || failures.map(f => f.metric).join(", ") || "PASS",
  })));
  console.log("JSON report:", path);
  if (report.results.some(row => row.failures.length)) process.exitCode = 1;
  else if (report.error || report.results.some(row => row.error)) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 2; });
}
