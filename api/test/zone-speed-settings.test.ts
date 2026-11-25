import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runFingerprintCron } from "../src/edge/fingerprint-cron";
import type { Env } from "../src/env";
import worker from "../src/index";
import { PROTECTED_DOMAINS } from "../src/safety/protected-domains";
import * as provisioning from "../src/site-provisioning/cloudflare-interfaces";
import { ctxCapture, makeKvStub } from "./helpers/leadgen-analytics-harness";
import { addSite, createDb, env as sqliteEnv, hasSqlite, type SqliteDb } from "./helpers/x06-a2-sqlite";

const zones = "https://api.cloudflare.com/client/v4/zones";
const webhook = "https://hooks.slack.test/services/zone-speed";
const token = "test-provisioning-token";
const due = Date.UTC(2026, 10, 25, 3, 10);
const lastSweep = "zone-speed:v1:last-sweep-date";
const targets: Record<string, string> = {
  "settings/always_use_https": "on",
  "settings/min_tls_version": "1.2",
  "settings/early_hints": "on",
  "argo/tiered_caching": "on",
};
const lookup = (name: string) => `${zones}?name=${name}&status=active`;
const success = (result: unknown) => Response.json({ success: true, result });
const denied = (message: string) => Response.json({
  success: false, errors: [{ code: 10000, message }],
}, { status: 403 });

// The fingerprint cron uses a SELECT batch outside the SQLite shim's write-batch support.
vi.mock("../src/edge/fingerprint-cron", () => ({ runFingerprintCron: vi.fn() }));

describe.skipIf(!hasSqlite)("CMS zone speed settings", () => {
  let db: SqliteDb;
  let env: Env;
  const send = vi.fn<typeof fetch>();
  const replies = new Map<string, () => Response>();
  const values = new Map<string, string>();

  beforeEach(() => {
    db = createDb();
    env = {
      ...sqliteEnv(db), CACHE: makeKvStub().kv, SITE_PROVISIONING_DRY_RUN: "false", SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "true",
      CLOUDFLARE_PROVISIONING_API_TOKEN: token, SLACK_WEBHOOK_URL: webhook,
    };
    replies.clear();
    values.clear();
    replies.set(`POST ${webhook}`, () => new Response("ok"));
    send.mockReset().mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const reply = replies.get(`${method} ${url}`);
      if (reply) return reply();
      if (values.has(url) && (method === "GET" || method === "PATCH")) {
        if (method === "PATCH") values.set(url, JSON.parse(String(init?.body)).value);
        return success({ value: values.get(url) });
      }
      throw new Error(`Unexpected request ${method} ${url}`);
    });
    vi.stubGlobal("fetch", send);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 10, 25, 12, 42));
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function zone(name: string, id: string, drift: Record<string, string> = {}) {
    replies.set(`GET ${lookup(name)}`, () => success([{ id }]));
    replies.set(`POST ${zones}/${id}/workers/routes`, () => success({ id: "route-1" }));
    for (const [path, target] of Object.entries(targets)) values.set(`${zones}/${id}/${path}`, drift[path] ?? target);
  }

  function domain(siteId: string, hostname: string, status = "active", kind = "canonical", primary = 1) {
    db.prepare("INSERT INTO domains(site_id, hostname, status, kind, is_primary) VALUES (?, ?, ?, ?, ?)")
      .run(siteId, hostname, status, kind, primary);
  }

  function site(id: string, hostname: string) {
    addSite(db, id, `Site ${id}`, "home");
    domain(id, hostname);
  }

  function attach(hostname: string) {
    return provisioning.runCloudflareRouteMutation({ env, db: env.DB }, {
      site_id: "build", hostname, action: "attach_domain_to_new_worker_or_mark_pending", payload: {},
    });
  }

  function requests() {
    return send.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`);
  }

  function slackMessages(): string[] {
    return send.mock.calls.filter(([url]) => url === webhook).map(([, init]) => {
      expect(init?.method).toBe("POST");
      return JSON.parse(String(init?.body)).text;
    });
  }

  async function scheduled(at: number, bindings = env) {
    const { ctx, promises } = ctxCapture();
    await worker.scheduled({ cron: "* * * * *", scheduledTime: at, noRetry() {} }, bindings, ctx);
    await Promise.all(promises);
  }

  const mixedZones: Record<string, string>[] = [
    { "settings/min_tls_version": "1.0", "argo/tiered_caching": "off" },
    { "settings/always_use_https": "off", "settings/early_hints": "off" },
  ];
  it.each(mixedZones)("patches exactly the drifted settings after live route attachment for %j", async drift => {
    const hostname = "www.example.com";
    addSite(db, "build", "New site", "home");
    domain("build", hostname, "pending");
    zone("example.com", "z1", drift);

    const step = await attach(hostname);
    expect(step.status).toBe("completed");
    const results = Object.entries(targets).map(([path, target]) => ({
      setting: path.split("/")[1], before: drift[path] ?? target, after: target, ok: true,
    }));
    expect(JSON.parse(step.output)).toMatchObject({ attached: true, cf_route_id: "route-1", zone_speed_settings: results });
    expect(requests().slice(0, 2)).toEqual([`GET ${lookup("example.com")}`, `POST ${zones}/z1/workers/routes`]);
    expect(send).toHaveBeenCalledTimes(8);
    for (const [path, target] of Object.entries(targets)) {
      const calls = send.mock.calls.filter(([url]) => url === `${zones}/z1/${path}`);
      const expected = drift[path] ? [["GET", undefined], ["PATCH", JSON.stringify({ value: target })]] : [["GET", undefined]];
      expect(calls.map(([, init]) => [init?.method, init?.body])).toEqual(expected);
      for (const [, init] of calls) {
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe(`Bearer ${token}`);
        expect(headers.get("content-type")).toBe("application/json");
        expect(init?.signal).toBeInstanceOf(AbortSignal);
      }
    }
  });

  it.each([[409, 10000], [400, 10020]])("recovers this Worker's existing route on HTTP %i or code %i", async (status, code) => {
    addSite(db, "build", "New site", "home");
    domain("build", "build.test", "pending");
    zone("build.test", "z1", { "settings/early_hints": "off" });
    const routes = `${zones}/z1/workers/routes`;
    replies.set(`POST ${routes}`, () => Response.json({ success: false, errors: [{ code }] }, { status }));
    replies.set(`GET ${routes}`, () => success([
      { id: "other-path", pattern: "build.test/news/*", script: provisioning.PROVISIONING_WORKER_SCRIPT_NAME },
      { id: "existing-id", pattern: "build.test/*", script: provisioning.PROVISIONING_WORKER_SCRIPT_NAME },
    ]));

    const step = await attach("build.test");
    expect(step.status).toBe("completed");
    expect(JSON.parse(step.output)).toMatchObject({ attached: true, cf_route_id: "existing-id" });
    expect(db.prepare("SELECT status, cf_route_id FROM domains WHERE site_id = ?").get("build"))
      .toEqual({ status: "active", cf_route_id: "existing-id" });
    expect(requests()).toEqual([
      `GET ${lookup("build.test")}`, `POST ${routes}`, `GET ${routes}`,
      ...Object.keys(targets).map(path => `GET ${zones}/z1/${path}`), `PATCH ${zones}/z1/settings/early_hints`,
    ]);
    expect(new Headers(send.mock.calls[2]?.[1]?.headers).get("authorization")).toBe(`Bearer ${token}`);
    expect(values.get(`${zones}/z1/settings/early_hints`)).toBe("on");
  });

  it("leaves a duplicate route on another script alone and keeps the domain pending", async () => {
    addSite(db, "build", "New site", "home");
    domain("build", "build.test", "pending");
    zone("build.test", "z1");
    const routes = `${zones}/z1/workers/routes`;
    replies.set(`POST ${routes}`, () => new Response(null, { status: 409 }));
    replies.set(`GET ${routes}`, () => success([
      { id: "other-pattern", pattern: "*.build.test/*", script: provisioning.PROVISIONING_WORKER_SCRIPT_NAME },
      { id: "other-worker", pattern: "build.test/*", script: "another-worker" },
    ]));

    expect((await attach("build.test")).status).toBe("failed");
    expect(db.prepare("SELECT status, cf_route_id FROM domains WHERE site_id = ?").get("build"))
      .toEqual({ status: "pending", cf_route_id: null });
    expect(db.prepare("SELECT status FROM cache_purge_log WHERE site_id = ?").get("build")).toEqual({ status: "failed" });
    expect(requests()).toEqual([`GET ${lookup("build.test")}`, `POST ${routes}`, `GET ${routes}`]);
  });

  it("keeps an ordinary route creation error as a failure without listing routes", async () => {
    addSite(db, "build", "New site", "home");
    domain("build", "build.test", "pending");
    zone("build.test", "z1");
    const routes = `${zones}/z1/workers/routes`;
    replies.set(`POST ${routes}`, () => denied("Route creation denied"));

    expect((await attach("build.test")).status).toBe("failed");
    expect(db.prepare("SELECT status, cf_route_id FROM domains WHERE site_id = ?").get("build"))
      .toEqual({ status: "pending", cf_route_id: null });
    expect(requests()).toEqual([`GET ${lookup("build.test")}`, `POST ${routes}`]);
  });

  it("attaches a shared-zone subdomain and reports the skip in both the build and the sweep", async () => {
    const hostname = "blog.example.com";
    addSite(db, "build", "Blog", "home");
    domain("build", hostname, "pending");
    zone("example.com", "z1", { "settings/early_hints": "off" });
    const step = await attach(hostname);
    expect(step.status).toBe("completed");
    expect(JSON.parse(step.output)).toMatchObject({
      attached: true, cf_route_id: "route-1", zone_speed_settings: { skipped: true, reason: "shared_zone" },
    });
    expect(requests()).toEqual([`GET ${lookup("example.com")}`, `POST ${zones}/z1/workers/routes`]);

    send.mockClear();
    expect(await provisioning.runZoneSpeedSettingsSweep(env, env.DB)).toEqual({
      sites_checked: 1, zones_checked: 0, settings_updated: 0, failures: [],
      skipped: [{ site_id: "build", site_name: "Blog", hostname, zone_name: "example.com", reason: "shared_zone" }],
    });
    expect(send).toHaveBeenCalledTimes(0);
  });

  it("completes the attach on a 403 and repairs that setting on the next daily sweep", async () => {
    addSite(db, "build", "New <site> & Co", "home");
    domain("build", "build.test", "pending");
    zone("build.test", "z1", { "settings/early_hints": "off" });
    const patch = `PATCH ${zones}/z1/settings/early_hints`;
    replies.set(patch, () => denied("Early Hints write denied <!channel> & retry"));

    const step = await attach("build.test");
    expect(step.status).toBe("completed");
    const { zone_speed_settings: results } = JSON.parse(step.output);
    expect(results).toHaveLength(4);
    expect(results.filter((r: { ok: boolean }) => !r.ok)).toEqual([{
      setting: "early_hints", before: "off", after: null, ok: false,
      error: expect.stringMatching(/403.*10000.*Early Hints write denied/),
    }]);
    expect(db.prepare("SELECT status, cf_route_id FROM domains WHERE site_id = ?").get("build"))
      .toEqual({ status: "active", cf_route_id: "route-1" });
    expect(slackMessages()).toEqual([[
      "Site build could not confirm zone speed settings for New &lt;site&gt; &amp; Co (build) · build.test",
      "early_hints · PATCH HTTP 403 · 10000 Early Hints write denied &lt;!channel&gt; &amp; retry",
    ].join("\n")]);

    replies.delete(patch);
    send.mockClear();
    await scheduled(due);
    expect(requests()).toEqual([
      `GET ${lookup("build.test")}`, ...Object.keys(targets).map(path => `GET ${zones}/z1/${path}`), patch,
    ]);
    expect(values.get(`${zones}/z1/settings/early_hints`)).toBe("on");
  });

  it("groups multiple failed build settings into one notice and completes even if Slack rejects it", async () => {
    addSite(db, "build", "New site", "home");
    domain("build", "build.test", "pending");
    zone("build.test", "z1");
    replies.set(`GET ${zones}/z1/settings/always_use_https`, () => denied("HTTPS read denied"));
    replies.set(`GET ${zones}/z1/argo/tiered_caching`, () => denied("Tiered Cache read denied"));
    replies.set(`POST ${webhook}`, () => new Response(null, { status: 403 }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await attach("build.test")).status).toBe("completed");
    expect(slackMessages()).toEqual([[
      "Site build could not confirm zone speed settings for New site (build) · build.test",
      "always_use_https · GET HTTP 403 · 10000 HTTPS read denied",
      "tiered_caching · GET HTTP 403 · 10000 Tiered Cache read denied",
    ].join("\n")]);
    expect(log).toHaveBeenCalledWith("[speed-alarms] Slack rejected the notification", 403);
  });

  it("isolates a transport error, unreadable JSON, and an unconfirmed write", async () => {
    zone("build.test", "z1", { "settings/early_hints": "off" });
    replies.set(`GET ${zones}/z1/settings/always_use_https`, () => { throw new Error("connection closed"); });
    replies.set(`GET ${zones}/z1/settings/min_tls_version`, () => new Response("{"));
    replies.set(`PATCH ${zones}/z1/settings/early_hints`, () => success({ value: "off" }));
    expect(await provisioning.applyZoneSpeedSettings(token, "z1")).toEqual([
      { setting: "always_use_https", before: null, after: null, ok: false, error: expect.stringContaining("connection closed") },
      { setting: "min_tls_version", before: null, after: null, ok: false, error: expect.stringMatching(/GET HTTP 200.*invalid/) },
      { setting: "early_hints", before: "off", after: "off", ok: false, error: expect.stringMatching(/off.*on/) },
      { setting: "tiered_caching", before: "on", after: "on", ok: true },
    ]);
    expect(requests()).toEqual([
      ...Object.keys(targets).map(path => `GET ${zones}/z1/${path}`), `PATCH ${zones}/z1/settings/early_hints`,
    ]);
  });

  it.each([
    ["dry-run", "true", "true", token, "build.test", "completed_dry_run"],
    ["unset dry-run flag", undefined, "true", token, "build.test", "completed_dry_run"],
    ["mistyped dry-run flag", "flase", "true", token, "build.test", "completed_dry_run"],
    ["mutation disabled", "false", "false", token, "build.test", "completed_dry_run"],
    ["protected hostname", "false", "true", token, PROTECTED_DOMAINS[1]!, "failed"],
    ["protected parent zone", "false", "true", token, `news.${PROTECTED_DOMAINS[0]}`, "failed"],
  ] as const)("makes zero outbound calls during attach and sweep with %s", async (_, dryRun, allowed, secret, host, status) => {
    Object.assign(env, {
      SITE_PROVISIONING_DRY_RUN: dryRun, SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: allowed,
      CLOUDFLARE_PROVISIONING_API_TOKEN: secret,
    });
    site("build", host);
    expect((await attach(host)).status).toBe(status);
    expect(await provisioning.runZoneSpeedSettingsSweep(env, env.DB)).toEqual({
      sites_checked: 0, zones_checked: 0, settings_updated: 0, failures: [],
    });
    expect(send).toHaveBeenCalledTimes(0);
  });

  it("alerts once when the live sweep is missing its provisioning token, with zero Cloudflare calls", async () => {
    delete env.CLOUDFLARE_PROVISIONING_API_TOKEN;
    site("build", "build.test");
    const sweep = vi.spyOn(provisioning, "runZoneSpeedSettingsSweep");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await attach("build.test")).status).toBe("failed");
    expect(send).toHaveBeenCalledTimes(0);

    await scheduled(due);
    await scheduled(due + 60_000);
    expect(sweep).toHaveBeenCalledOnce();
    expect(await sweep.mock.results[0]?.value).toEqual({
      sites_checked: 0, zones_checked: 0, settings_updated: 0, failures: [],
    });
    expect(requests()).toEqual([`POST ${webhook}`]);
    const message = "Daily zone speed sweep could not run because the Cloudflare provisioning token is missing";
    expect(slackMessages()).toEqual([message]);
    expect(log).toHaveBeenCalledWith("[zone-speed-settings]", message);
    expect(await env.CACHE.get(lastSweep)).toBeNull();

    env.CLOUDFLARE_PROVISIONING_API_TOKEN = token;
    zone("build.test", "z1");
    send.mockClear();
    await scheduled(due + 2 * 60_000);
    expect(requests()).toEqual([`GET ${lookup("build.test")}`, ...Object.keys(targets).map(path => `GET ${zones}/z1/${path}`)]);
    expect(await env.CACHE.get(lastSweep)).toBe("2026-11-25");
  });

  it("sweeps active canonical domains of active sites and checks the zone for an apex and www just once", async () => {
    site("a", "alpha.test");
    site("b", "www.alpha.test");
    site("c", "bravo.test");
    domain("a", "alias.test", "active", "alias");
    domain("a", "former.test", "active", "canonical", 0);
    site("disabled", "disabled.test");
    db.prepare("UPDATE sites SET status = ? WHERE id = ?").run("disabled", "disabled");
    addSite(db, "pending", "Awaiting attachment", "home");
    domain("pending", "pending.test", "pending");
    domain("pending", "alias-only.test", "active", "alias");
    addSite(db, "unattached", "No domain row", "home");
    zone("alpha.test", "za", { "argo/tiered_caching": "off" });
    zone("bravo.test", "zb");

    expect(await provisioning.runZoneSpeedSettingsSweep(env, env.DB)).toEqual({
      sites_checked: 3, zones_checked: 2, settings_updated: 1, failures: [],
    });
    expect(requests()).toEqual([
      `GET ${lookup("alpha.test")}`, ...Object.keys(targets).map(path => `GET ${zones}/za/${path}`),
      `PATCH ${zones}/za/argo/tiered_caching`,
      `GET ${lookup("bravo.test")}`, ...Object.keys(targets).map(path => `GET ${zones}/zb/${path}`),
    ]);
  });

  it("uses the first delivered 03:10–03:59 UTC tick per date and skips PERFSTAGE", async () => {
    site("a", "alpha.test");
    zone("alpha.test", "za");
    const minute = 60_000;
    const day = 24 * 60 * minute;
    const checks = [`GET ${lookup("alpha.test")}`, ...Object.keys(targets).map(path => `GET ${zones}/za/${path}`)];
    env.PERFSTAGE = "true";
    await scheduled(due - day);
    env.PERFSTAGE = "false";
    for (const offset of [-60, -1]) await scheduled(due + offset * minute);
    expect(send).toHaveBeenCalledTimes(0);
    expect(await env.CACHE.get(lastSweep)).toBeNull();

    await scheduled(due + minute); // First tick today is 03:11.
    expect(requests()).toEqual(checks);
    expect(await env.CACHE.get(lastSweep)).toBe("2026-11-25");
    await scheduled(due + 2 * minute);
    await scheduled(due + 49 * minute);
    expect(requests()).toEqual(checks);

    await scheduled(due + day); // 03:10 on a fresh date.
    await scheduled(due + 2 * day + 49 * minute); // 03:59 on a fresh date.
    await scheduled(due + 3 * day + 50 * minute); // 04:00 on an unswept date.
    await scheduled(due + 3 * day + 60 * minute); // 04:10 on the same unswept date.
    expect(requests()).toEqual([...checks, ...checks, ...checks]);
    expect(await env.CACHE.get(lastSweep)).toBe("2026-11-27");
  });

  it("sweeps once when overlapping ticks both read an empty KV marker", async () => {
    const first = makeKvStub();
    const second = makeKvStub();
    site("a", "alpha.test");
    zone("alpha.test", "za", { "settings/early_hints": "off" });
    const patch = `PATCH ${zones}/za/settings/early_hints`;
    const markersDuringPatch: Array<string | undefined> = [];
    replies.set(patch, () => {
      markersDuringPatch.push(first.store.get(lastSweep), second.store.get(lastSweep));
      return success({ value: "on" });
    });

    await Promise.all([
      scheduled(due, { ...env, CACHE: first.kv }),
      scheduled(due + 60_000, { ...env, CACHE: second.kv }),
    ]);
    expect(markersDuringPatch).toEqual([undefined, undefined]);
    expect([first.store.get(lastSweep), second.store.get(lastSweep)].filter(Boolean)).toEqual(["2026-11-25"]);
    expect(requests()).toEqual([
      `GET ${lookup("alpha.test")}`, ...Object.keys(targets).map(path => `GET ${zones}/za/${path}`), patch,
    ]);
  });

  it("alerts once when the sweep throws, continues later cron tasks and retries the unfinished date", async () => {
    const sweep = vi.spyOn(provisioning, "runZoneSpeedSettingsSweep")
      .mockRejectedValueOnce(new Error(`D1 unavailable <&> ${token}`));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(runFingerprintCron).mockClear();
    await expect(scheduled(due)).resolves.toBeUndefined();
    expect(sweep).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("[zone-speed-settings] Daily sweep failed");
    expect(runFingerprintCron).toHaveBeenCalledOnce();
    expect(slackMessages()).toEqual(["Daily zone speed sweep failed · D1 unavailable &lt;&amp;&gt; [redacted]"]);
    expect(await env.CACHE.get(lastSweep)).toBeNull();
    await scheduled(due + 60_000);
    expect(sweep).toHaveBeenCalledTimes(2);
    expect(await env.CACHE.get(lastSweep)).toBe("2026-11-25");
    expect(requests()).toEqual([`POST ${webhook}`]);
  });

  it("posts one Slack notice with every affected site, domain, setting and Cloudflare error", async () => {
    site("a", "alpha.test");
    site("b", "www.alpha.test");
    addSite(db, "c", "Site C & <team>", "home");
    domain("c", "bravo<&>.test");
    site("d", "healthy.test");
    site("e", "blog.alpha.test");
    zone("alpha.test", "za", { "argo/tiered_caching": "off" });
    zone("healthy.test", "zh");
    replies.set(`GET ${zones}/za/settings/min_tls_version`, () => denied("TLS read denied"));
    replies.set(`PATCH ${zones}/za/argo/tiered_caching`, () => denied("Tiered Cache write denied"));
    replies.set(`GET ${lookup(encodeURIComponent("bravo<&>.test"))}`, () => denied("Zone access denied <!channel> & more"));
    await scheduled(due);

    const messages = slackMessages();
    expect(messages).toHaveLength(1);
    const lines = messages[0]!.split("\n").slice(1);
    for (const [id, hostname] of [["a", "alpha.test"], ["b", "www.alpha.test"]]) {
      const prefix = `Site ${id} (${id}) · ${hostname} · `;
      expect(lines).toContain(prefix + "min_tls_version · GET HTTP 403 · 10000 TLS read denied");
      expect(lines).toContain(prefix + "tiered_caching · PATCH HTTP 403 · 10000 Tiered Cache write denied");
    }
    for (const path of Object.keys(targets)) {
      expect(lines).toContain(`Site C &amp; &lt;team&gt; (c) · bravo&lt;&amp;&gt;.test · ${path.split("/")[1]} · zone lookup HTTP 403 · 10000 Zone access denied &lt;!channel&gt; &amp; more`);
    }
    expect(lines).toHaveLength(8);
    expect(requests()).toContain(`GET ${zones}/zh/argo/tiered_caching`);
    expect(requests().at(-1)).toBe(`POST ${webhook}`);
  });
});
