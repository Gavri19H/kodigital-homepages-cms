import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCacheStats, recordEdgeCacheStatus } from "../src/cache/cache-stats";
import { runSpeedAlarms } from "../src/edge/speed-alarms";
import type { Env } from "../src/env";
import worker from "../src/index";
import { buildLeadgenEnv, ctxCapture, d1FromSqlite, makeKvStub } from "./helpers/leadgen-analytics-harness";
import { addSite, createDb, hasSqlite, type SqliteDb } from "./helpers/x06-a2-sqlite";

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const noon = Date.UTC(2026, 11, 1, 12);
const firstTick = noon + hour + 5 * minute;
const monday = Date.UTC(2026, 10, 30, 6);
const webhook = "https://hooks.slack.test/services/test-speed";
const botSecrets = { SLACK_BOT_TOKEN: "test-only-speed-bot-token", SLACK_ALERT_CHANNEL: "C123TEST" };
const release = "current-worker-ab14";

interface Sample {
  site?: string;
  page?: string;
  lcp?: number;
  fcp?: number;
  inp?: number;
  cls?: number;
  ttfb?: number;
}

describe.skipIf(!hasSqlite)("scheduled site speed monitoring", () => {
  let db: SqliteDb;
  let env: Env;
  let store: Map<string, string>;
  const send = vi.fn<typeof fetch>();

  beforeEach(() => {
    db = createDb();
    addSite(db, "site-1", "First site", "home");
    const cache = makeKvStub();
    store = cache.store;
    // The shared fake supports single-key reads. Weekly counter reads use KV's
    // bulk text API, which returns a Map and accepts up to 100 keys per call.
    Object.assign(cache.kv, {
      async get(key: string | string[]) {
        if (!Array.isArray(key)) return store.get(key) ?? null;
        if (key.length > 100) throw new Error("oversized KV bulk read");
        return new Map(key.map(k => [k, store.get(k) ?? null]));
      },
    });
    env = buildLeadgenEnv(d1FromSqlite(db), cache.kv);
    env.CF_VERSION_METADATA = { id: release };
    env.SLACK_WEBHOOK_URL = webhook;
    send.mockReset().mockImplementation(async () => new Response("ok"));
    vi.stubGlobal("fetch", send);
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function seed(count: number, at: number, sample: Sample) {
    const insert = db.prepare(`INSERT INTO vitals_samples
      (created_at, site_id, page_type, ttfb_ms, fcp_ms, lcp_ms, inp_ms, cls, worker_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (let i = 0; i < count; i++) {
      insert.run(Math.floor(at / 1000), sample.site ?? "site-1", sample.page ?? "article",
        sample.ttfb ?? null, sample.fcp ?? null, sample.lcp ?? null, sample.inp ?? null,
        sample.cls ?? null, "sample-worker-old");
    }
  }

  function counters(site: string, utcHour: string, hitSamples: number, missSamples: number) {
    store.set(`edgehit:v1:${site}:${utcHour}:HIT`, String(hitSamples * 10));
    store.set(`edgehit:v1:${site}:${utcHour}:MISS`, String(missSamples * 10));
  }

  const checkHour = (offset = 0) => runSpeedAlarms(env, firstTick + offset * hour);

  async function scheduled(at: number) {
    const { ctx, promises } = ctxCapture();
    await worker.scheduled({ cron: "* * * * *", scheduledTime: at, noRetry() {} }, env, ctx);
    await Promise.all(promises);
  }

  function messages(transport: "webhook" | "bot" = "webhook"): string[] {
    return send.mock.calls.map(([url, init]) => {
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("content-type")).toMatch(/application\/json/i);
      const body = JSON.parse(String(init?.body)) as { text: string };
      if (transport === "bot") {
        expect(String(url)).toBe("https://slack.com/api/chat.postMessage");
        expect(headers.get("authorization")).toBe(`Bearer ${botSecrets.SLACK_BOT_TOKEN}`);
        expect(body).toEqual({ channel: botSecrets.SLACK_ALERT_CHANNEL, text: expect.any(String) });
      } else {
        expect(String(url)).toBe(webhook);
        expect(headers.get("authorization")).toBeNull();
        expect(body).toEqual({ text: expect.any(String) });
      }
      return body.text;
    });
  }

  it("posts the nearest-rank p75 from the last complete UTC hour through the Worker cron", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(firstTick + 9 * minute); // The minute job started late.
    seed(20, noon - 1000, { lcp: 7777 });
    seed(14, noon, { lcp: 2100 });
    seed(1, noon + minute, { lcp: 2501 }); // Rank 15 of 20.
    seed(5, noon + hour - 1000, { lcp: 9000 });
    seed(20, noon + hour, { lcp: 8888 });

    await scheduled(firstTick);
    const posts = messages();
    expect(posts).toHaveLength(1);
    const text = posts[0]!;
    for (const field of ["site-1", "article", "2501", "2500", release]) expect(text).toContain(field);
    expect(text).toMatch(/p75\s+LCP/i);
    expect(text).toMatch(/\b20 samples\b/i);
    expect(text).not.toContain("sample-worker-old");
  });

  it("announces a breach, a recovery and a new breach once each across repeated or sparse hours", async () => {
    for (const [offset, count, lcp] of [
      [0, 20, 2800], [1, 20, 2900], [2, 19, 2000], [3, 20, 2700],
      [4, 20, 2500], [5, 20, 2000], [6, 20, 2600],
    ] as const) {
      seed(count, noon + offset * hour, { page: "quote", lcp });
    }

    for (const offset of [0, 0, 1, 2, 3]) await checkHour(offset);
    expect(messages()).toEqual([expect.stringMatching(/alarm.*quote.*2800/is)]);
    // A late observation makes hour 2 healthy. Its delayed replay must not
    // announce recovery after hour 3 already observed the sustained alarm.
    seed(1, noon + 2 * hour, { page: "quote", lcp: 2000 });
    await checkHour(2);
    expect(messages()).toHaveLength(1);
    for (const offset of [4, 4, 5]) await checkHour(offset);
    expect(messages()[1]).toMatch(/recover.*quote.*2500/is);
    await checkHour(6);
    expect(messages()).toHaveLength(3);
    expect(messages()[2]).toMatch(/alarm.*quote.*2600/is);
  });

  it("keeps sites, page types and metrics independent and applies LCP targets to the four named types", async () => {
    addSite(db, "site-2", "Second site", "home");
    seed(20, noon, { page: "home", lcp: 2600 });
    seed(20, noon, { page: "listicle", lcp: 2700 });
    seed(20, noon, { site: "site-2", page: "home", lcp: 2800 });
    seed(20, noon, { page: "category", lcp: 9000, fcp: 9999, inp: 201, cls: 0.021, ttfb: 801 });
    seed(20, noon, { page: "quote", lcp: 2500, inp: 200, cls: 0.02, ttfb: 800 });

    await checkHour();
    const posts = messages();
    expect(posts).toHaveLength(6);
    for (const [site, page, metric, value, threshold] of [
      ["site-1", "home", "LCP", "2600", "2500"],
      ["site-1", "listicle", "LCP", "2700", "2500"],
      ["site-2", "home", "LCP", "2800", "2500"],
      ["site-1", "category", "INP", "201", "200"],
      ["site-1", "category", "CLS", "0.021", "0.02"],
      ["site-1", "category", "TTFB", "801", "800"],
    ] as const) {
      const post = posts.find(text => text.includes(site) && text.includes(page) && text.includes(metric));
      expect(post).toBeDefined();
      expect(post).toContain(value);
      expect(post).toContain(threshold);
    }
  });

  it("requires 20 non-null observations of an individual vital on the same site and page type", async () => {
    addSite(db, "site-2", "Second site", "home");
    seed(19, noon, { page: "tag", inp: 600 });
    seed(22, noon, { page: "tag", fcp: 1500 });
    seed(1, noon, { page: "page", inp: 600 });
    seed(1, noon, { site: "site-2", page: "tag", inp: 600 });
    await checkHour();
    expect(send).not.toHaveBeenCalled();
  });

  it("uses 50 actual edge samples per site and recovers at exactly 90% HIT share", async () => {
    addSite(db, "site-2", "Second site", "home");
    counters("site-1", "2026120112", 44, 5);
    counters("site-2", "2026120112", 0, 1);
    await checkHour();
    expect(send).not.toHaveBeenCalled();

    // Drive the recorder itself, then let the next cron read its weighted keys.
    vi.spyOn(Date, "now").mockReturnValue(noon + hour);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { ctx, promises } = ctxCapture();
    for (let i = 0; i < 50; i++) {
      recordEdgeCacheStatus(env, i < 44 ? "HIT" : "MISS", ctx, "site-1");
      await Promise.all(promises.splice(0));
    }
    await checkHour(1);
    expect(messages()).toHaveLength(1);
    const alarm = messages()[0]!;
    for (const field of ["site-1", "HIT", "88%", "90%", "50 samples", release]) expect(alarm).toContain(field);
    expect(alarm).toMatch(/all pages/i);

    counters("site-1", "2026120114", 0, 50);
    counters("site-1", "2026120116", 45, 5);
    for (const offset of [1, 2, 3]) await checkHour(offset);
    expect(messages()).toHaveLength(1);
    await checkHour(4);
    await checkHour(4);
    expect(messages()).toHaveLength(2);
    expect(messages()[1]).toMatch(/recover.*HIT.*90%/is);
  });

  it("logs the alarm once when Slack delivery is unconfigured", async () => {
    delete env.SLACK_WEBHOOK_URL;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    seed(20, noon, { ttfb: 950 });
    await checkHour();
    await checkHour();
    expect(send).not.toHaveBeenCalled();
    const alarms = log.mock.calls.map(args => args.join(" ")).filter(text => text.includes("TTFB"));
    expect(alarms).toHaveLength(1);
    for (const field of ["site-1", "article", "950", "800", "20 samples", release]) {
      expect(alarms[0]).toContain(field);
    }
  });

  it.each(["SLACK_BOT_TOKEN", "SLACK_ALERT_CHANNEL"] as const)(
    "uses the webhook when only %s is set for the bot", async key => {
      env[key] = botSecrets[key];
      seed(20, noon, { inp: 333 });
      await checkHour();
      expect(messages()).toEqual([expect.stringContaining("p75 INP 333 ms")]);
    },
  );

  it("prefers the bot and retries an ok:false alarm the next hour", async () => {
    Object.assign(env, botSecrets);
    seed(20, noon, { inp: 333 });
    seed(20, noon + hour, { inp: 350 });
    send.mockResolvedValueOnce(Response.json({ ok: false, error: "not_in_channel" }))
      .mockResolvedValueOnce(Response.json({ ok: true }));

    await checkHour();
    const firstAlarm = expect.stringMatching(/Speed ALARM.*p75 INP 333 ms/);
    expect(messages("bot")).toEqual([firstAlarm]);
    const state = "speed:v1:state:site-1:article:INP";
    expect(store.has(state)).toBe(false);

    await checkHour(1);
    await checkHour(1);
    expect(messages("bot")).toEqual([firstAlarm, expect.stringMatching(/Speed ALARM.*p75 INP 350 ms/)]);
    expect(store.get(state)).toBe(`alarm ${noon + 2 * hour}`);
  });

  it("keeps the bot token out of logs even if Slack or fetch echoes it", async () => {
    Object.assign(env, botSecrets);
    const logs = (["log", "info", "warn", "error", "debug"] as const)
      .map(level => vi.spyOn(console, level).mockImplementation(() => {}));
    send.mockResolvedValueOnce(Response.json({ ok: false, error: botSecrets.SLACK_BOT_TOKEN }))
      .mockRejectedValue(new Error(botSecrets.SLACK_BOT_TOKEN));
    seed(20, noon, { inp: 333 });
    await checkHour();
    await checkHour();
    expect(messages("bot")).toHaveLength(3);
    expect(inspect(logs.flatMap(log => log.mock.calls), { depth: null })).not.toContain(botSecrets.SLACK_BOT_TOKEN);
  });

  it("leaves an unsuccessful Slack delivery eligible to retry and settles the scheduled invocation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(firstTick);
    seed(20, noon, { inp: 333 });
    send.mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
    await expect(scheduled(firstTick)).resolves.toBeUndefined();
    expect(messages()).toHaveLength(1);
    await checkHour();
    await checkHour();
    expect(messages()).toHaveLength(2);
    expect(messages()[1]).toBe(messages()[0]);
  });

  it("delivers the second metric even if KV cannot record the first delivered alarm", async () => {
    seed(20, noon, { lcp: 3200, ttfb: 920 });
    let rejected = false;
    const put = env.CACHE.put.bind(env.CACHE);
    vi.spyOn(env.CACHE, "put").mockImplementation(async (key, value, options) => {
      if (!rejected && send.mock.calls.length === 1) {
        rejected = true;
        throw new Error("alarm state write unavailable");
      }
      await put(key, value, options);
    });
    await checkHour();
    expect(rejected).toBe(true);
    const posts = messages();
    expect(posts).toHaveLength(2);
    expect(posts).toEqual(expect.arrayContaining([
      expect.stringMatching(/site-1.*article.*LCP 3200/i),
      expect.stringMatching(/site-1.*article.*TTFB 920/i),
    ]));
  });

  it("does no monitoring I/O on ordinary minute ticks or at 06:00 on other days", async () => {
    const sql = vi.spyOn(env.DB, "prepare");
    const read = vi.spyOn(env.CACHE, "get");
    for (const time of [monday - day, monday - hour, monday - minute, monday + minute, monday + day]) {
      await runSpeedAlarms(env, time);
    }
    expect(sql).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it.each([["hourly", firstTick], ["weekly", monday]] as const)(
    "skips the %s alarm when an ordinary cron tick arrives one minute late", async (_alarm, wallTime) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(wallTime);
      const read = vi.spyOn(env.CACHE, "get");
      await scheduled(wallTime - minute);
      expect(read).not.toHaveBeenCalledWith(expect.stringMatching(/^speed:v1:/));
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("retries a rate-limited weekly webhook on Monday's tick and remembers its successful delivery", async () => {
    send.mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "Retry-After": "0" } }));
    await runSpeedAlarms(env, monday);
    const attempts = messages();
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatch(/weekly speed report/i);
    expect(attempts[1]).toBe(attempts[0]);
    await runSpeedAlarms(env, monday);
    expect(messages()).toEqual(attempts);
  });

  it("posts one Monday 06:00 UTC report for the previous seven days, including sites with only cache traffic", async () => {
    addSite(db, "site-2", "Second site", "home");
    addSite(db, "site-3", "Third site", "home");
    addSite(db, "site-4", "Fourth site", "home");
    const start = monday - 7 * day;
    const article = { fcp: 1177, inp: 166, cls: 0.013, ttfb: 456 };
    seed(14, start, { ...article, lcp: 1000 });
    seed(6, monday - 1000, { ...article, lcp: 2607 });
    seed(20, start + day, { page: "quote", lcp: 1250, fcp: 612, inp: 321, cls: 0.015, ttfb: 704 });
    seed(20, start + day, { site: "site-4", page: "home", lcp: 2500, inp: 200, cls: 0.02, ttfb: 800 });
    seed(40, start - 1000, { lcp: 9777 });
    seed(40, monday, { lcp: 9888 });
    counters("site-1", "2026112305", 0, 100);
    counters("site-1", "2026112306", 40, 0);
    counters("site-1", "2026113005", 6, 4);
    counters("site-1", "2026113006", 100, 0);
    counters("site-2", "2026113005", 0, 49);
    counters("site-3", "2026113005", 40, 10);
    counters("site-4", "2026113005", 45, 5);
    const keys = [...store.keys()].sort().map(name => ({ name }));
    const list = vi.spyOn(env.CACHE, "list")
      .mockResolvedValueOnce({ keys: keys.slice(0, 2), list_complete: false, cursor: "next-page", cacheStatus: null })
      .mockResolvedValueOnce({ keys: keys.slice(2), list_complete: true, cacheStatus: null });

    await runSpeedAlarms(env, monday);
    await runSpeedAlarms(env, monday);
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenNthCalledWith(2, expect.objectContaining({ prefix: "edgehit:v1:", cursor: "next-page" }));
    const posts = messages();
    expect(posts).toHaveLength(1);
    const report = posts[0]!;
    expect(report).toMatch(/weekly speed report/i);
    for (const target of ["2500", "200", "0.02", "800", "90%"]) expect(report).toContain(target);
    for (const metric of ["LCP", "FCP", "INP", "CLS", "TTFB", "HIT"]) expect(report).toContain(metric);
    const lines = report.split("\n");
    expect(lines.find(line => line.includes("site-1"))).toMatch(/92%/);
    expect(lines.find(line => line.includes("site-2"))).toMatch(/insufficient traffic.*49/i);
    const missedHit = lines.find(line => line.includes("site-3"));
    expect(missedHit).toContain("80%");
    expect(missedHit).toContain("!");
    const atHitTarget = lines.find(line => line.includes("site-4"));
    expect(atHitTarget).toContain("90%");
    expect(atHitTarget).not.toContain("!");
    const articleRow = lines.find(line => line.includes("article") && line.includes("2607"));
    for (const value of ["1177", "166", "0.013", "456"]) expect(articleRow).toContain(value);
    expect(articleRow).toContain("2607!");
    const quoteRow = lines.find(line => line.includes("quote") && line.includes("1250"));
    for (const value of ["612", "321", "0.015", "704"]) expect(quoteRow).toContain(value);
    expect(quoteRow).toContain("321!");
    const atVitalTargets = lines.find(line => /^home\s*\|/.test(line) && line.includes("2500"));
    for (const value of ["2500", "200", "0.02", "800"]) expect(atVitalTargets).toContain(value);
    expect(atVitalTargets).not.toContain("!");
    expect(report).not.toMatch(/9777|9888/);
  });

  it("reports all 200 sites in one Slack message with fewer than 1,000 binding reads", async () => {
    const sites = ["site-1"];
    for (let n = 1; n < 200; n++) {
      const id = `fleet-${String(n).padStart(3, "0")}`;
      addSite(db, id, id, "home");
      sites.push(id);
    }
    // These sites straddle the first 50-site batch in the sorted fleet.
    seed(20, monday - hour, { site: "fleet-050", lcp: 3004 });
    seed(20, monday - hour, { site: "fleet-051", lcp: 1783 });
    counters("fleet-050", "2026113005", 44, 6);
    counters("fleet-051", "2026113005", 49, 1);
    const sql = vi.spyOn(env.DB, "prepare");
    const kvRead = vi.spyOn(env.CACHE, "get");
    const kvList = vi.spyOn(env.CACHE, "list");

    await runSpeedAlarms(env, monday);
    const posts = messages();
    expect(posts).toHaveLength(1);
    const report = posts[0]!;
    expect(report.length).toBeLessThan(40_000);
    expect(sites.filter(id => !report.includes(id))).toEqual([]);
    expect(report).toMatch(/omitted page types[^\n]*fewer than 20 samples/i);
    expect(sql.mock.calls.length + kvRead.mock.calls.length + kvList.mock.calls.length).toBeLessThan(1000);

    const lines = report.split("\n");
    for (const [site, lcp, hits] of [["fleet-050", "3004!", "88%!"], ["fleet-051", "1783", "98%"]] as const) {
      const row = lines.findIndex(line => line.includes("article") && line.includes(lcp));
      expect(row).toBeGreaterThan(0);
      const heading = lines.slice(0, row + 1).reverse().find(line => line.includes("edge HIT share"));
      expect(heading).toContain(site);
      expect(heading).toContain(hits);
    }
  });

  it.each(["webhook", "bot"] as const)("sends one bounded Slack report and logs every qualifying row when full tables exceed 40,000 characters (%s)", async transport => {
    if (transport === "bot") {
      delete env.SLACK_WEBHOOK_URL;
      Object.assign(env, botSecrets);
      send.mockImplementation(async () => Response.json({ ok: true }));
    }
    const pages = ["home", "article", "category", "tag", "page", "listicle", "quote", "other"];
    const sites = ["site-1"];
    for (let n = 1; n < 200; n++) {
      const id = `tenant-${String(n).padStart(3, "0")}`;
      addSite(db, id, id, "home");
      sites.push(id);
    }
    for (const site of sites) counters(site, "2026113005", 46, 4);
    // One statement seeds 20 visits per site/page. Distinct site and page values
    // let us verify every percentile cell in the full report.
    db.prepare(`WITH RECURSIVE visits(n) AS (
      VALUES (1) UNION ALL SELECT n + 1 FROM visits WHERE n < ?
    ) INSERT INTO vitals_samples (created_at, site_id, page_type, lcp_ms, fcp_ms, inp_ms, cls, ttfb_ms)
    SELECT ?, site.value, page.value, 3000 + site.key, 1200 + page.key, 188, 0.019, 550 + site.key
    FROM json_each(?) AS site CROSS JOIN json_each(?) AS page CROSS JOIN visits`)
      .run(20, (monday - hour) / 1000, JSON.stringify(sites), JSON.stringify(pages));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await runSpeedAlarms(env, monday);
    const posts = messages(transport);
    expect(posts).toHaveLength(1);
    const report = posts[0]!;
    expect(report.length).toBeLessThanOrEqual(40_000);
    expect(report).toMatch(/Workers Logs[^\n]*qualifying page rows omitted/i);
    const postedRows = report.split("\n").filter(line => pages.includes(line.split("|", 1)[0]!));
    expect(postedRows.length).toBeLessThan(sites.length * pages.length);

    const tables = log.mock.calls.map(args => args.join(" "));
    for (const [i, id] of sites.entries()) {
      const table = tables.find(text => text.includes(`(${id})`));
      expect(table).toContain("92% (50 samples)");
      const expected = pages.map((page, j) => {
        const missed = ["home", "article", "listicle", "quote"].includes(page) ? "!" : "";
        return `${page}|${3000 + i}${missed}|${1200 + j}|188|0.019|${550 + i}`;
      });
      expect(new Set(table?.split("\n").slice(1))).toEqual(new Set(expected));
    }
  });

  it("prunes strictly older than fourteen days with one bound DELETE per hourly run", async () => {
    const cutoff = firstTick - 14 * day;
    seed(1, cutoff - 1000, {});
    seed(1, cutoff, {});
    seed(1, firstTick, {});
    const sql = vi.spyOn(env.DB, "prepare");
    const deletes = () => sql.mock.calls.map(([query]) => query).filter(query => /DELETE\s+FROM\s+vitals_samples/i.test(query));
    const times = () => db.prepare("SELECT created_at FROM vitals_samples ORDER BY created_at").all();
    await checkHour();
    expect(deletes()).toHaveLength(1);
    expect(deletes()[0]).toMatch(/created_at\s*<\s*\?/i);
    expect(times()).toEqual([{ created_at: cutoff / 1000 }, { created_at: firstTick / 1000 }]);

    seed(1, cutoff - 2000, {});
    await checkHour();
    expect(deletes()).toHaveLength(1);
    expect(times()).toHaveLength(3);
    await checkHour(1);
    expect(deletes()).toHaveLength(2);
    expect(times()).toEqual([{ created_at: firstTick / 1000 }]);
  });

  it("executes at most one retention DELETE when the first hourly marker write fails", async () => {
    seed(1, firstTick - 15 * day, {});
    const sql = vi.spyOn(env.DB, "prepare");
    const marker = vi.spyOn(env.CACHE, "put").mockRejectedValueOnce(new Error("retention marker unavailable"));
    await checkHour();
    await checkHour();
    expect(marker).toHaveBeenCalled();
    const deletes = sql.mock.calls.filter(([query]) => /DELETE\s+FROM\s+vitals_samples/i.test(query));
    expect(deletes).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM vitals_samples").get()).toEqual({ n: 0 });
  });

  it("samples global and site counters together and rolls site keys over at UTC midnight", async () => {
    const midnight = Date.UTC(2026, 11, 1);
    const clock = vi.spyOn(Date, "now").mockReturnValue(midnight - 1);
    const draw = vi.spyOn(Math, "random").mockReturnValue(0.099);
    const { ctx, promises } = ctxCapture();
    async function record(status: string, site?: string) {
      recordEdgeCacheStatus(env, status, ctx, site);
      await Promise.all(promises.splice(0));
    }
    await record("hit", "site-1");
    await record("HIT", "site-1");
    await record("MISS", "site-2");
    await record("MISS");
    clock.mockReturnValue(midnight);
    await record("MISS", "site-1");
    await record("BYPASS", "site-2");
    draw.mockReturnValue(0.1);
    await record("HIT", "site-1");

    expect(Object.fromEntries([...store].filter(([k]) => k.startsWith("edgehit:")))).toEqual({
      "edgehit:v1:site-1:2026113023:HIT": "20",
      "edgehit:v1:site-2:2026113023:MISS": "10",
      "edgehit:v1:site-1:2026120100:MISS": "10",
    });
    expect(await readCacheStats(env)).toEqual({ hits: 20, misses: 30, total: 50, hit_rate: 0.4 });
  });
});
