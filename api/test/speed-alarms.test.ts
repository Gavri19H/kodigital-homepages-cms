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
  client?: string | null;
  edge?: "HIT" | "MISS" | null;
  country?: string;
  device?: "mobile" | "tablet" | "desktop";
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
  let nextClient: number;
  const send = vi.fn<typeof fetch>();

  beforeEach(() => {
    db = createDb();
    if (!db.prepare("SELECT 1 FROM pragma_table_info('vitals_samples') WHERE name = 'edge'").get()) {
      db.prepare("ALTER TABLE vitals_samples ADD COLUMN edge TEXT CHECK (edge IN ('HIT','MISS'))").run();
    }
    addSite(db, "site-1", "First site", "home");
    nextClient = 0;
    const cache = makeKvStub();
    store = cache.store;
    // Alarm states use KV's bulk text API, which accepts up to 100 keys.
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
      (created_at, site_id, page_type, ttfb_ms, fcp_ms, lcp_ms, inp_ms, cls, worker_version, client_key, country, device, edge)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (let i = 0; i < count; i++) {
      const client = sample.client === undefined ? (++nextClient).toString(16).padStart(16, "0") : sample.client;
      insert.run(Math.floor(at / 1000), sample.site ?? "site-1", sample.page ?? "article",
        sample.ttfb ?? null, sample.fcp ?? null, sample.lcp ?? null, sample.inp ?? null,
        sample.cls ?? null, "sample-worker-old", client, sample.country ?? null, sample.device ?? null, sample.edge ?? null);
    }
  }

  function seedEdge(site: string, at: number, hits: number, misses: number) {
    seed(hits, at, { site, edge: "HIT" });
    seed(misses, at, { site, edge: "MISS" });
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
    for (const field of ["site-1", "article", "2501", "1500", release]) expect(text).toContain(field);
    expect(text).toMatch(/p75\s+LCP/i);
    expect(text).toMatch(/\b20 samples\b/i);
    expect(text).not.toContain("sample-worker-old");
  });

  it.each([
    [{ id: release, tag: "0123456789ab" }, `release 0123456789ab · worker ${release}`],
    [{ id: release }, `worker ${release}`],
    [{ id: release, tag: "" }, `worker ${release}`],
    [undefined, "worker unknown"],
  ] as const)("identifies the running version in the alarm and weekly report for metadata %j", async (metadata, label) => {
    env.CF_VERSION_METADATA = metadata;
    seed(20, noon, { ttfb: 950 });
    await checkHour();
    const nextMonday = monday + 7 * day;
    await runSpeedAlarms(env, nextMonday);

    const [alarm, report] = messages();
    expect(alarm).toBe(`Speed ALARM · site-1.example (site-1) · article · p75 TTFB 950 ms · target ≤ 800 ms · 20 samples · ${label}`);
    expect(report?.split("\n", 1)[0]).toBe(
      `Weekly speed report · ${new Date(monday).toISOString()} to ${new Date(nextMonday).toISOString()} · ${label}`,
    );
  });

  it("posts one DATA GAP and one resumed ALARM per episode, then stays silent until RECOVERY", async () => {
    for (const [offset, count, lcp] of [
      [0, 20, 2800], [1, 20, 2900], [2, 19, 1400], [3, 20, 2700],
      [4, 19, 1400], [5, 20, 2750], [6, 20, 1500], [7, 20, 1400], [8, 20, 2600],
    ] as const) {
      seed(count, noon + offset * hour, { page: "quote", lcp });
    }

    for (const offset of [0, 0, 1, 2, 2]) await checkHour(offset);
    const key = "speed:v1:state:site-1:quote:LCP";
    const beforeResume = [
      expect.stringMatching(/alarm.*quote.*2800/is),
      expect.stringContaining("Speed DATA GAP · site-1.example (site-1) · quote · LCP · 19 samples (minimum 20)"),
    ];
    expect(messages()).toEqual(beforeResume);
    for (const offset of [3, 3]) await checkHour(offset);
    const firstPosts = [...beforeResume,
      `Speed ALARM · data resumed · site-1.example (site-1) · quote · p75 LCP 2700 ms · target ≤ 1500 ms · 20 samples · worker ${release}`,
    ];
    expect(messages()).toEqual(firstPosts);
    expect(store.get(key)).toBe(`alarm ${noon + 4 * hour} resumed`);
    // A late observation makes hour 2 healthy. Its delayed replay must not
    // announce recovery after hour 3 already observed the sustained alarm.
    seed(1, noon + 2 * hour, { page: "quote", lcp: 1400 });
    await checkHour(2);
    expect(messages()).toEqual(firstPosts);
    await checkHour(4);
    expect(messages()).toEqual(firstPosts);
    expect(store.get(key)).toBe(`nodata ${noon + 5 * hour} resumed`);
    for (const offset of [4, 5, 5]) await checkHour(offset);
    expect(messages()).toEqual(firstPosts);
    expect(store.get(key)).toBe(`alarm ${noon + 6 * hour} resumed`);
    for (const offset of [6, 6, 7]) await checkHour(offset);
    const episode = [...firstPosts, expect.stringMatching(/recover.*quote.*1500/is)];
    expect(messages()).toEqual(episode);
    expect(store.get(key)).toBe(`healthy ${noon + 7 * hour}`);
    for (const offset of [8, 9, 9]) await checkHour(offset);
    expect(messages()).toEqual([...episode,
      expect.stringMatching(/alarm.*quote.*2600/is),
      expect.stringMatching(/Speed DATA GAP.*quote.*0 samples/),
    ]);
  });

  it("retries the resumed alarm for a legacy gap record until Slack accepts it", async () => {
    const key = "speed:v1:state:site-1:article:LCP";
    const legacy = `alarm ${noon} gap`;
    store.set(key, legacy);
    seed(20, noon, { lcp: 1800 });
    send.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await checkHour();
    const resumed = expect.stringMatching(/^Speed ALARM.*data resumed.*p75 LCP 1800 ms/);
    expect(messages()).toEqual([resumed]);
    expect(store.get(key)).toBe(legacy);
    await checkHour();
    await checkHour();
    expect(messages()).toEqual([resumed, resumed]);
    expect(store.get(key)).toBe(`alarm ${noon + hour} resumed`);
  });

  it("keeps sites, page types and metrics independent and applies LCP targets to every page type", async () => {
    addSite(db, "site-2", "Second site", "home");
    seed(20, noon, { page: "home", lcp: 2600 });
    seed(20, noon, { page: "listicle", lcp: 2700 });
    seed(20, noon, { site: "site-2", page: "home", lcp: 2800 });
    seed(20, noon, { page: "category", lcp: 1600, fcp: 9999, inp: 120, cls: 0.021, ttfb: 801 });
    for (const page of ["tag", "page", "other"]) seed(20, noon, { page, lcp: 1501 });
    seed(20, noon, { page: "quote", lcp: 1500, inp: 100, cls: 0.02, ttfb: 800 });

    await checkHour();
    const posts = messages();
    expect(posts).toHaveLength(10);
    for (const [site, page, metric, value, threshold] of [
      ["site-1", "home", "LCP", "2600", "1500"],
      ["site-1", "listicle", "LCP", "2700", "1500"],
      ["site-2", "home", "LCP", "2800", "1500"],
      ["site-1", "category", "LCP", "1600", "1500"],
      ["site-1", "tag", "LCP", "1501", "1500"],
      ["site-1", "page", "LCP", "1501", "1500"],
      ["site-1", "other", "LCP", "1501", "1500"],
      ["site-1", "category", "INP", "120", "100"],
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

  it("ignores anonymous rows and caps repeated beacons before applying the 20-sample minimum", async () => {
    seed(30, noon, { client: "0000000000000001", inp: 120 });
    seed(30, noon, { client: null, inp: 120 });
    await checkHour();
    expect(send).not.toHaveBeenCalled();

    for (let i = 1; i <= 6; i++) {
      seed(5, noon + hour, { client: i.toString(16).padStart(16, "0"), inp: 120 });
    }
    seed(30, noon + hour, { client: null, inp: 120 });
    await checkHour(1);
    expect(send).not.toHaveBeenCalled(); // Six clients contribute at most 18 samples.
    seed(2, noon + hour, { client: "0000000000000007", inp: 120 });
    await checkHour(1);
    expect(messages()).toEqual([expect.stringMatching(/Speed ALARM.*p75 INP 120 ms.*20 samples/)]);
  });

  it("uses each client's earliest three visits before ranking non-null metrics", async () => {
    for (let i = 1; i <= 7; i++) {
      const client = i.toString(16).padStart(16, "0");
      seed(9, noon + minute, { client, lcp: 9000, inp: 999 });
      seed(3, noon, { client, lcp: 1600 });
    }
    await checkHour();
    expect(messages()).toEqual([expect.stringMatching(/p75 LCP 1600 ms.*21 samples/)]);
  });

  it("reports a vanished page once, then recovers when a full hour meets the finish line", async () => {
    env.CF_VERSION_METADATA = { id: release, tag: "v5" };
    seed(20, noon, { page: "category", lcp: 1600 });
    seed(20, noon + 3 * hour, { page: "category", lcp: 1500 });
    for (const offset of [0, 1, 1, 2]) await checkHour(offset);
    const key = "speed:v1:state:site-1:category:LCP";
    expect(store.get(key)).toBe(`nodata ${noon + 2 * hour}`);
    expect(messages()).toEqual([
      expect.stringContaining("Speed ALARM"),
      `Speed DATA GAP · site-1.example (site-1) · category · LCP · 0 samples (minimum 20) · release v5 · worker ${release}`,
    ]);
    await checkHour(3);
    await checkHour(3);
    expect(messages()).toHaveLength(3);
    expect(messages()[2]).toMatch(/Speed RECOVERY.*category.*p75 LCP 1500 ms.*20 samples/);
    expect(store.get(key)).toBe(`healthy ${noon + 4 * hour}`);
  });

  it("uses 50 actual edge samples per site and recovers at exactly 90% HIT share", async () => {
    addSite(db, "site-2", "Second site", "home");
    seedEdge("site-1", noon, 44, 5);
    seedEdge("site-2", noon, 0, 1);
    await checkHour();
    expect(send).not.toHaveBeenCalled();

    seedEdge("site-1", noon + hour, 44, 6);
    expect(db.prepare(`SELECT edge, COUNT(*) AS n FROM vitals_samples WHERE site_id = ? AND created_at = ?
      GROUP BY edge ORDER BY edge`).all("site-1", (noon + hour) / 1000)).toEqual([
      { edge: "HIT", n: 44 }, { edge: "MISS", n: 6 },
    ]);
    await checkHour(1);
    expect(messages()).toHaveLength(1);
    const alarm = messages()[0]!;
    for (const field of ["site-1", "HIT", "88%", "90%", "50 samples", release]) expect(alarm).toContain(field);
    expect(alarm).toMatch(/all pages/i);

    seedEdge("site-1", noon + 2 * hour, 0, 50);
    seedEdge("site-1", noon + 4 * hour, 45, 5);
    for (const offset of [1, 2, 3]) await checkHour(offset);
    expect(messages()).toHaveLength(2);
    expect(messages()[1]).toContain("all pages · HIT · 0 samples (minimum 50)");
    await checkHour(4);
    await checkHour(4);
    expect(messages()).toHaveLength(3);
    expect(messages()[2]).toMatch(/recover.*HIT.*90%/is);
  });

  it("reads each client's earliest three known outcomes across page types and starts a new window at UTC midnight", async () => {
    const midnight = Date.UTC(2026, 11, 2);
    for (let i = 0; i < 20; i++) {
      const client = i.toString(16).padStart(16, "0");
      seed(3, midnight - hour, { client, edge: null });
      seed(2, midnight - 1000, { client, edge: "HIT" });
      seed(1, midnight - 1000, { client, page: "home", edge: "MISS" });
      seed(3, midnight - 1000, { client, page: "tag", edge: "MISS" });
      seed(3, midnight, { client, edge: "HIT" });
    }
    await runSpeedAlarms(env, midnight + 5 * minute);
    expect(messages()).toEqual([
      `Speed ALARM · site-1.example (site-1) · all pages · edge HIT share 66.667% · target ≥ 90% · 60 samples · worker ${release}`,
    ]);
    await runSpeedAlarms(env, midnight + hour + 5 * minute);
    expect(messages()).toHaveLength(2);
    expect(messages()[1]).toMatch(/Speed RECOVERY.*edge HIT share 100%.*60 samples/);
  });

  it("counts only capped, identified HIT and MISS rows toward the 50-sample minimum", async () => {
    const info = vi.spyOn(console, "info");
    seed(100, noon, { client: "0000000000000001", edge: "MISS" });
    seed(100, noon, { client: null, edge: "MISS" });
    seed(100, noon, { edge: null });
    await checkHour();
    expect(info).toHaveBeenCalledWith(expect.stringContaining("insufficient traffic from sampled real visitors (3 samples)"));
    expect(send).not.toHaveBeenCalled();

    for (let i = 0; i < 60; i++) {
      const client = (i % 12).toString(16).padStart(16, "0");
      seed(1, noon + hour, { client, edge: i < 40 ? "HIT" : "MISS" });
    }
    await checkHour(1);
    expect(info).toHaveBeenCalledWith(expect.stringContaining("insufficient traffic from sampled real visitors (36 samples)"));
    expect(send).not.toHaveBeenCalled();
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

  it("does no monitoring I/O outside hourly checks and weekly retry slots", async () => {
    const sql = vi.spyOn(env.DB, "prepare");
    const read = vi.spyOn(env.CACHE, "get");
    for (const time of [monday - day + minute, monday - hour + minute, monday - 15 * minute, monday - minute,
      monday + minute, monday + 6 * hour, monday + day + minute, monday + 2 * day + 15 * minute]) {
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

  it("skips Wednesday, retries Monday's rejected 06:00 report at 06:15 UTC and delivers that window once", async () => {
    send.mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
    await runSpeedAlarms(env, monday - 5 * day + 15 * minute);
    expect(send).not.toHaveBeenCalled();
    for (const offset of [0, 0, 1, 14]) await runSpeedAlarms(env, monday + offset * minute);
    expect(messages()).toHaveLength(1);
    expect(store.has("speed:v1:last-weekly-report")).toBe(false);
    await runSpeedAlarms(env, monday + 15 * minute);
    const sql = vi.spyOn(env.DB, "prepare");
    for (const offset of [15, 30, 60, 24 * 60]) await runSpeedAlarms(env, monday + offset * minute);
    expect(sql).not.toHaveBeenCalled();
    const attempts = messages();
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toBe(attempts[0]);
    expect(store.get("speed:v1:last-weekly-report")).toBe(String(monday));
  });

  it("can deliver at the last Monday retry slot and keeps the week boundary across a month change", async () => {
    store.set("speed:v1:last-weekly-report", String(monday - 7 * day));
    await runSpeedAlarms(env, monday - 15 * minute);
    expect(send).not.toHaveBeenCalled();
    await runSpeedAlarms(env, monday + 5 * hour + 45 * minute);
    await runSpeedAlarms(env, monday + day + 30 * minute);
    await runSpeedAlarms(env, monday + 7 * day - 15 * minute);
    expect(messages()).toEqual([expect.stringContaining(`${new Date(monday - 7 * day).toISOString()} to ${new Date(monday).toISOString()}`)]);
    await runSpeedAlarms(env, monday + 7 * day);
    expect(messages()).toHaveLength(2);
    expect(messages()[1]).toContain(`${new Date(monday).toISOString()} to ${new Date(monday + 7 * day).toISOString()}`);
  });

  it("bounds an undelivered weekly report to 24 Monday slots with two Slack attempts per slot", async () => {
    send.mockImplementation(async () => new Response("rate limited", { status: 429, headers: { "Retry-After": "0" } }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (let slot = 0; slot < 24; slot++) {
      const time = monday + slot * 15 * minute;
      await runSpeedAlarms(env, time);
      await runSpeedAlarms(env, time);
      expect(send).toHaveBeenCalledTimes((slot + 1) * 2);
    }
    await runSpeedAlarms(env, monday + 6 * hour);
    await runSpeedAlarms(env, monday + 2 * day);
    const attempts = messages();
    expect(attempts).toHaveLength(48);
    expect(new Set(attempts).size).toBe(1);
    expect(store.has("speed:v1:last-weekly-report")).toBe(false);
    expect(store.get("speed:v1:last-weekly-attempt")).toBe(String(monday + 5 * hour + 45 * minute));
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
    seed(20, start + day, { site: "site-4", page: "home", lcp: 1500, inp: 100, cls: 0.02, ttfb: 800 });
    seed(40, start - 1000, { lcp: 9777 });
    seed(40, monday, { lcp: 9888 });
    seedEdge("site-1", start - hour, 0, 100);
    seedEdge("site-1", start, 37, 0);
    const returningClient = "ffffffffffffffff";
    seed(3, start, { client: returningClient, edge: "HIT" });
    seed(20, monday - hour, { client: returningClient, page: "home", edge: "MISS" });
    seedEdge("site-1", monday - hour, 6, 4);
    seedEdge("site-1", monday, 100, 0);
    seedEdge("site-2", monday - hour, 0, 49);
    seedEdge("site-3", monday - hour, 40, 10);
    seedEdge("site-4", monday - hour, 45, 5);
    const sql = vi.spyOn(env.DB, "prepare");
    const list = vi.spyOn(env.CACHE, "list");

    await runSpeedAlarms(env, monday);
    await runSpeedAlarms(env, monday);
    const hitQueries = sql.mock.calls.filter(([query]) => query.includes("edge IS NOT NULL"));
    expect(hitQueries).toHaveLength(1);
    expect(hitQueries[0]![0]).toMatch(/FROM vitals_samples.*created_at >= \? AND created_at < \?.*GROUP BY site_id/s);
    expect(list).not.toHaveBeenCalled();
    const posts = messages();
    expect(posts).toHaveLength(1);
    const report = posts[0]!;
    expect(report).toMatch(/weekly speed report/i);
    const targetLine = report.split("\n").find(line => line.startsWith("Targets"));
    for (const target of ["LCP ≤ 1500 ms (all page types)", "INP ≤ 100 ms", "CLS ≤ 0.02", "TTFB ≤ 800 ms", "HIT ≥ 90%"]) {
      expect(targetLine).toContain(target);
    }
    for (const metric of ["LCP", "FCP", "INP", "CLS", "TTFB", "HIT"]) expect(report).toContain(metric);
    const lines = report.split("\n");
    expect(lines.find(line => line.includes("site-1"))).toMatch(/92%/);
    expect(lines.find(line => line.includes("site-2"))).toContain("insufficient traffic from sampled real visitors (49 samples)");
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
    const atVitalTargets = lines.find(line => /^home\s*\|/.test(line) && line.includes("1500"));
    for (const value of ["1500", "100", "0.02", "800"]) expect(atVitalTargets).toContain(value);
    expect(atVitalTargets).not.toContain("!");
    expect(report).not.toMatch(/9777|9888/);
  });

  it("reports each site's US mobile p75 across page types with the same per-vital sample and client rules", async () => {
    addSite(db, "site-2", "Second site", "home");
    const at = monday - day;
    const phone = { country: "US", device: "mobile" } as const;
    const low = { lcp: 1000, fcp: 500, inp: 60, cls: 0.01, ttfb: 400 };
    const high = { lcp: 1600, fcp: 630, inp: 120, cls: 0.03, ttfb: 820 };
    const outlier = { lcp: 9999, fcp: 9999, inp: 9999, cls: 3, ttfb: 9999 };
    const repeat = "abcdef0123456789";
    seed(3, at, { ...low, ...phone, client: repeat });
    seed(11, at, { ...low, ...phone });
    seed(6, at, { ...high, ...phone, page: "category" });
    seed(50, at + hour, { ...outlier, ...phone, client: repeat });
    seed(50, at, { ...outlier, ...phone, client: null });
    seed(50, at, { ...outlier, country: "CA", device: "mobile" });
    for (const device of ["desktop", "tablet", undefined] as const) seed(50, at, { ...outlier, country: "US", device });

    // Twenty-four LCP values across two page types, contributed by four clients.
    for (const page of ["home", "article"]) {
      for (let i = 0; i < 4; i++) {
        seed(3, at, { ...phone, site: "site-2", page, client: i.toString(16).padStart(16, "0"), lcp: 1600 });
      }
    }
    await runSpeedAlarms(env, monday);
    const [report] = messages();
    expect(report).toContain("fewer than 20 samples or fewer than 5 distinct clients");
    expect(report?.split("\n").filter(line => line.startsWith("US phones|"))).toEqual([
      "US phones|1600!|630|120!|0.03!|820!", "US phones|—|—|—|—|—",
    ]);
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
    seedEdge("fleet-050", monday - hour, 44, 6);
    seedEdge("fleet-051", monday - hour, 49, 1);
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
    expect(sql.mock.calls.filter(([query]) => query.includes("edge IS NOT NULL"))).toHaveLength(4);

    const lines = report.split("\n");
    for (const [site, lcp, hits] of [["fleet-050", "3004!", "88%!"], ["fleet-051", "1783!", "98%"]] as const) {
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
    for (const site of sites) seedEdge(site, monday - hour, 46, 4);
    // One statement seeds 20 visits per site/page. Distinct site and page values
    // let us verify every percentile cell in the full report.
    db.prepare(`WITH RECURSIVE visits(n) AS (
      VALUES (1) UNION ALL SELECT n + 1 FROM visits WHERE n < ?
    ) INSERT INTO vitals_samples (created_at, site_id, page_type, lcp_ms, fcp_ms, inp_ms, cls, ttfb_ms, client_key, country, device)
    SELECT ?, site.value, page.value, 3000 + site.key, 1200 + page.key, 188, 0.019, 550 + site.key,
      printf('%016x', visits.n), 'US', CASE WHEN page.value = 'category' THEN 'mobile' ELSE 'desktop' END
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
    const phoneRows = report.split("\n").filter(line => line.startsWith("US phones|"));
    expect(phoneRows).toHaveLength(sites.length);

    const tables = log.mock.calls.map(args => args.join(" "));
    for (const [i, id] of sites.entries()) {
      const table = tables.find(text => text.includes(`(${id})`));
      expect(table).toContain("92% (50 samples)");
      const expected = pages.map((page, j) => `${page}|${3000 + i}!|${1200 + j}|188!|0.019|${550 + i}`);
      const phones = `US phones|${3000 + i}!|1202|188!|0.019|${550 + i}`;
      expect(phoneRows).toContain(phones);
      expected.push(phones);
      expect(new Set(table?.split("\n").slice(1))).toEqual(new Set(expected));
    }
  });

  it("prunes vitals and edge observations strictly older than fourteen days with one hourly DELETE", async () => {
    const cutoff = firstTick - 14 * day;
    seed(1, cutoff - 1000, {});
    seed(1, cutoff, {});
    seed(1, firstTick, {});
    const oldestHour = Math.floor(cutoff / hour) * hour;
    seedEdge("site-1", oldestHour, 5, 3);
    seedEdge("site-1", oldestHour + hour, 4, 2);
    const sql = vi.spyOn(env.DB, "prepare");
    const deletes = () => sql.mock.calls.map(([query]) => query).filter(query => /^DELETE\b/i.test(query));
    const times = () => db.prepare("SELECT created_at FROM vitals_samples WHERE edge IS NULL ORDER BY created_at").all();
    const edgeRows = () => db.prepare(`SELECT created_at, edge, COUNT(*) AS n FROM vitals_samples
      WHERE edge IS NOT NULL GROUP BY created_at, edge ORDER BY created_at, edge`).all();
    await checkHour();
    expect(deletes()).toHaveLength(1);
    expect(deletes()[0]).toMatch(/DELETE FROM vitals_samples WHERE created_at\s*<\s*\?/i);
    expect(times()).toEqual([{ created_at: cutoff / 1000 }, { created_at: firstTick / 1000 }]);
    const retainedEdgeRows = [
      { created_at: (oldestHour + hour) / 1000, edge: "HIT", n: 4 },
      { created_at: (oldestHour + hour) / 1000, edge: "MISS", n: 2 },
    ];
    expect(edgeRows()).toEqual(retainedEdgeRows);

    seed(1, cutoff - 2000, {});
    await checkHour();
    expect(deletes()).toHaveLength(1);
    expect(times()).toHaveLength(3);
    expect(edgeRows()).toEqual(retainedEdgeRows);
    await checkHour(1);
    expect(deletes()).toHaveLength(2);
    expect(times()).toEqual([{ created_at: firstTick / 1000 }]);
    expect(edgeRows()).toEqual([]);
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

  it("records sampled cache outcomes across UTC midnight in the global KV counters with zero D1 calls", async () => {
    const database = env.DB;
    const getDatabase = vi.fn(() => database);
    Object.defineProperty(env, "DB", { get: getDatabase });
    const midnight = Date.UTC(2026, 11, 1);
    const clock = vi.spyOn(Date, "now").mockReturnValue(midnight - 1);
    const draw = vi.spyOn(Math, "random").mockReturnValue(0.099);
    const { ctx, promises } = ctxCapture();
    async function record(status: string) {
      recordEdgeCacheStatus(env, status, ctx);
      await Promise.all(promises.splice(0));
    }
    await record("hit");
    await record("HIT");
    await record("MISS");
    await record("MISS");
    clock.mockReturnValue(midnight);
    await record("MISS");
    await record("BYPASS");
    draw.mockReturnValue(0.1);
    await record("HIT");
    expect([...store.keys()].sort()).toEqual(["cachestat:hits", "cachestat:misses"]);
    expect(await readCacheStats(env)).toEqual({ hits: 20, misses: 30, total: 50, hit_rate: 0.4 });
    expect(getDatabase).not.toHaveBeenCalled();
  });
});
