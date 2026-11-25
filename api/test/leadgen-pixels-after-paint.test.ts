import { createHash } from "node:crypto";
import { createContext, runInContext } from "node:vm";
import { expect, it } from "vitest";
import leadgenRouter from "../src/public/leadgen/runtime-routes";
import { parseHtml } from "./helpers/mini-dom";
import { addSite, createDb, env } from "./helpers/x06-a2-sqlite";

const host = "quotes.example";
const gaId = "G-QUOTE123";
const metaId = "656145712939950";

async function renderShell(
  { ga4, meta, logo }: { ga4?: string; meta?: string; logo?: string } = {},
): Promise<string> {
  const db = createDb();
  const id = (prefix: string) => prefix + "_" + "1".padStart(26, "0");
  try {
    addSite(db, "quotes", "Home Quotes", "health");
    db.prepare("INSERT INTO domains (site_id, hostname, status) VALUES ('quotes', ?, 'active')").run(host);
    if (logo !== undefined) {
      db.prepare("INSERT INTO site_settings (site_id, key, value) VALUES ('quotes', 'site_logo_url', ?)").run(logo);
    }
    db.prepare(`INSERT INTO leadgen_quotes (id, public_id, quote_name, activity, verticals_json, status)
      VALUES (1, ?, 'Home', 'quote_funnel', '[]', 'active')`).run(id("lgq"));
    db.prepare(`INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug, settings_overrides_json)
      VALUES ('quotes', 1, 1, 'home', ?)`).run(JSON.stringify({ ga4_measurement_id: ga4 }));
    db.prepare(`INSERT INTO leadgen_funnels (id, public_id, quote_id, funnel_name, status, meta_pixel_id)
      VALUES (1, ?, 1, 'Home', 'active', ?)`).run(id("lgf"), meta ?? null);
    db.prepare(`INSERT INTO leadgen_funnel_variants (id, public_id, funnel_id, variant_label, traffic_allocation_bp)
      VALUES (1, ?, 1, 'A', 10000)`).run(id("lgn"));
    db.prepare(`INSERT INTO leadgen_sections (id, public_id, section_name, activity, vertical, headline_text, content_json)
      VALUES (1, ?, 'Home', 'quote_funnel', 'health', 'Do you own your home?', '{"components":[]}')`).run(id("lgs"));
    db.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (1, 1, 0)").run();

    const res = await leadgenRouter.request(`https://${host}/lg/home`, {
      headers: { "x-cms-variant": "lg:" + id("lgn") },
    }, { ...env(db), EDGE_INNER: "1" });
    if (res.status !== 200) throw new Error(`Funnel returned ${res.status}: ${await res.text()}`);
    return await res.text();
  } finally {
    db.close();
  }
}

type ScriptTag = { tag: string; async: boolean; src: string };
type QueuedCall = ArrayLike<unknown>;

// URLs and attributes captured from the original parser-loaded GA tag and
// Meta's original insertBefore call for this activation.
const expectedLoaders: ScriptTag[] = [
  { tag: "script", async: true, src: "https://www.googletagmanager.com/gtag/js?id=G-QUOTE123" },
  { tag: "script", async: true, src: "https://connect.facebook.net/en_US/fbevents.js" },
];

function executeHead(html: string, dataLayer?: QueuedCall[]) {
  const head = parseHtml(html).querySelector("head")!;
  const scripts = head.querySelectorAll("script");
  for (const script of scripts) {
    expect(script.getAttribute("src") ?? "").not.toMatch(/gtag\/js|fbevents\.js/);
  }

  const inserted: ScriptTag[] = [];
  const insert = (script: ScriptTag) => inserted.push(script);
  const document = Object.assign(new EventTarget(), {
    cookie: "ko_sid=returning",
    createElement: (tag: string): ScriptTag => ({ tag, async: false, src: "" }),
    head: { appendChild: insert },
    getElementsByTagName: () => [{ parentNode: { insertBefore: insert } }],
  });
  const windowEvents = new EventTarget();
  const frames: Array<() => void> = [];
  const timers: Array<() => void> = [];
  const window = createContext({
    Date, document, dataLayer,
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    requestAnimationFrame: (fn: () => void) => frames.push(fn),
    setTimeout(fn: () => void, delay: number) {
      expect(delay).toBe(0);
      timers.push(fn);
    },
  });
  window.window = window;
  for (const script of scripts) runInContext(script.textContent, window);
  return {
    window, inserted,
    domReady: () => document.dispatchEvent(new Event("DOMContentLoaded")),
    load: () => windowEvents.dispatchEvent(new Event("load")),
    frame: () => frames.splice(0).forEach(fn => fn()),
    timers: () => timers.splice(0).forEach(fn => fn()),
  };
}

const calls = (queue: QueuedCall[]) => Array.from(queue, args => Array.from(args));

it("queues the original calls in the head and inserts both async loaders after the first frame and timer", async () => {
  const existingLayer = [["existing entry"]];
  const run = executeHead(await renderShell({ ga4: gaId, meta: metaId }), existingLayer);
  const { window } = run;
  expect(window.dataLayer).toBe(existingLayer);
  expect(typeof window.gtag).toBe("function");
  expect(window.fbq).toBeTypeOf("function");
  expect(window.fbq).toBe(window._fbq);
  window.gtag("event", "quote_start", { step: 1 });
  window.__lgOnEvent({ event_type: "answer_click", funnel_attempt_id: "attempt-1" });
  const gaCalls = calls(window.dataLayer);
  const metaCalls = calls(window.fbq.queue);
  expect(gaCalls).toEqual([
    ["existing entry"], ["js", expect.any(Date)], ["config", gaId], ["event", "quote_start", { step: 1 }],
  ]);
  expect(metaCalls).toEqual([
    ["dataProcessingOptions", []], ["init", metaId, { external_id: "returning" }],
    ["trackSingle", metaId, "PageView", {}, { eventID: expect.stringMatching(/^lgp_[A-Za-z0-9]{20}$/) }],
    ["trackSingle", metaId, "Lead", {}, { eventID: expect.stringMatching(/^lgl_[A-Za-z0-9]{20}$/) }],
  ]);

  run.frame();
  run.timers();
  expect(run.inserted).toEqual([]);
  run.domReady();
  run.timers();
  expect(run.inserted).toEqual([]);
  run.frame();
  expect(run.inserted).toEqual([]);
  run.timers();
  expect(run.inserted).toEqual(expectedLoaders);
  run.load();
  expect(run.inserted).toEqual(expectedLoaders);

  // Requests have started. Calls during the SDK downloads still append to the original queues.
  window.gtag("event", "next_step", { step: 2 });
  window.fbq("trackCustom", "NextStep", { step: 2 });
  expect(calls(window.dataLayer)).toEqual([...gaCalls, ["event", "next_step", { step: 2 }]]);
  expect(calls(window.fbq.queue)).toEqual([...metaCalls, ["trackCustom", "NextStep", { step: 2 }]]);
});

it("uses load when the animation frame is stalled, and the later frame cannot insert either loader twice", async () => {
  const run = executeHead(await renderShell({ ga4: gaId, meta: metaId }));
  run.domReady();
  expect(run.inserted).toEqual([]);
  run.load();
  expect(run.inserted).toEqual(expectedLoaders);
  run.frame();
  run.timers();
  expect(run.inserted).toEqual(expectedLoaders);
});

it("URL-encodes the measurement id for the SDK and queues its original trimmed value for config", async () => {
  const id = `G-QUOTE'"&</script>`;
  const run = executeHead(await renderShell({ ga4: " " + id + " " }));
  expect(calls(run.window.dataLayer)[1]).toEqual(["config", id]);
  run.load();
  expect(run.inserted).toEqual([
    { tag: "script", async: true, src: "https://www.googletagmanager.com/gtag/js?id=G-QUOTE'%22%26%3C%2Fscript%3E" },
  ]);
});

it("pins the complete shell when neither pixel nor a logo is configured", async () => {
  const html = await renderShell();
  // The complete 3720f666 fixture with the attempt kickoff and v16 runtime URLs.
  expect(createHash("sha256").update(html).digest("hex")).toBe("e03a440412ced1d263270f3157d3fd44897493f95659056e6a0f78f4bb07f266");
});

it.each(["/media/logo.png", `https://${host}/media/logo.png`])("resizes the same-origin OG logo %s on the funnel host", async logo => {
  const html = await renderShell({ logo: logo + "?v=1&lang=en" });
  expect(html).toContain(`<meta property="og:image" content="https://${host}/cdn-cgi/image/width=1200,fit=scale-down/media/logo.png?v=1&amp;lang=en">`);
});

it("keeps the original OG behavior for off-origin media and other local images", async () => {
  expect(await renderShell({ logo: "https://cdn.example/media/logo.png" })).not.toContain('property="og:image"');
  expect(await renderShell({ logo: "/brand/logo.png" })).toContain(`<meta property="og:image" content="https://${host}/brand/logo.png">`);
});
