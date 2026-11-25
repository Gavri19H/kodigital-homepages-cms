import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runFingerprintCron } from "../src/edge/fingerprint-cron";
import type { Env } from "../src/env";
import worker from "../src/index";
import { PROTECTED_DOMAINS } from "../src/safety/protected-domains";
import * as provisioning from "../src/site-provisioning/cloudflare-interfaces";
import { ctxCapture } from "./helpers/leadgen-analytics-harness";
import { addSite, createDb, env as sqliteEnv, hasSqlite, type SqliteDb } from "./helpers/x06-a2-sqlite";

const zones = "https://api.cloudflare.com/client/v4/zones";
const webhook = "https://hooks.slack.test/services/zone-speed";
const token = "test-provisioning-token";
const due = Date.UTC(2026, 10, 25, 3, 10);
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
      ...sqliteEnv(db), SITE_PROVISIONING_DRY_RUN: "false", SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "true",
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

  async function scheduled(at: number) {
    const { ctx, promises } = ctxCapture();
    await worker.scheduled({ cron: "* * * * *", scheduledTime: at, noRetry() {} }, env, ctx);
    await Promise.all(promises);
  }

  const mixedZones: Record<string, string>[] = [
    { "settings/min_tls_version": "1.0", "argo/tiered_caching": "off" },
    { "settings/always_use_https": "off", "settings/early_hints": "off" },
  ];
  it.each(mixedZones)("patches exactly the drifted settings after live route attachment for %j", async drift => {
    const hostname = "news.build.test";
    addSite(db, "build", "New site", "home");
    domain("build", hostname, "pending");
    zone("build.test", "z1", drift);

    const step = await attach(hostname);
    expect(step.status).toBe("completed");
    const results = Object.entries(targets).map(([path, target]) => ({
      setting: path.split("/")[1], before: drift[path] ?? target, after: target, ok: true,
    }));
    expect(JSON.parse(step.output)).toMatchObject({ attached: true, cf_route_id: "route-1", zone_speed_settings: results });
    expect(requests().slice(0, 2)).toEqual([`GET ${lookup("build.test")}`, `POST ${zones}/z1/workers/routes`]);
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

  it("completes the attach on a 403 and repairs that setting on the next daily sweep", async () => {
    addSite(db, "build", "New site", "home");
    domain("build", "build.test", "pending");
    zone("build.test", "z1", { "settings/early_hints": "off" });
    const patch = `PATCH ${zones}/z1/settings/early_hints`;
    replies.set(patch, () => denied("Early Hints write denied"));

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
    expect(requests()).not.toContain(`POST ${webhook}`);

    replies.delete(patch);
    send.mockClear();
    await scheduled(due);
    expect(requests()).toEqual([
      `GET ${lookup("build.test")}`, ...Object.keys(targets).map(path => `GET ${zones}/z1/${path}`), patch,
    ]);
    expect(values.get(`${zones}/z1/settings/early_hints`)).toBe("on");
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
    ["missing token", "false", "true", undefined, "build.test", "failed"],
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

  it("sweeps active canonical domains of active sites and checks a shared zone once", async () => {
    site("a", "news.alpha.test");
    site("b", "offers.alpha.test");
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

  it("runs at the controller's 03:10 UTC tick each day and skips PERFSTAGE", async () => {
    site("a", "alpha.test");
    zone("alpha.test", "za");
    for (const offsetMinutes of [-60, -1, 1, 60]) await scheduled(due + offsetMinutes * 60_000);
    env.PERFSTAGE = "true";
    await scheduled(due);
    expect(send).toHaveBeenCalledTimes(0);
    env.PERFSTAGE = "false";
    const checks = [`GET ${lookup("alpha.test")}`, ...Object.keys(targets).map(path => `GET ${zones}/za/${path}`)];
    await scheduled(due);
    await scheduled(due + 24 * 3_600_000);
    expect(requests()).toEqual([...checks, ...checks]);
  });

  it("continues later cron tasks when the daily sweep throws", async () => {
    const sweep = vi.spyOn(provisioning, "runZoneSpeedSettingsSweep").mockRejectedValueOnce(new Error("D1 unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(runFingerprintCron).mockClear();
    await expect(scheduled(due)).resolves.toBeUndefined();
    expect(sweep).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("[zone-speed-settings] Daily sweep failed");
    expect(runFingerprintCron).toHaveBeenCalledOnce();
  });

  it("posts one Slack notice with every affected site, domain, setting and Cloudflare error", async () => {
    site("a", "news.alpha.test");
    site("b", "offers.alpha.test");
    site("c", "bravo.test");
    site("d", "healthy.test");
    zone("alpha.test", "za", { "argo/tiered_caching": "off" });
    zone("healthy.test", "zh");
    replies.set(`GET ${zones}/za/settings/min_tls_version`, () => denied("TLS read denied"));
    replies.set(`PATCH ${zones}/za/argo/tiered_caching`, () => denied("Tiered Cache write denied"));
    replies.set(`GET ${lookup("bravo.test")}`, () => denied("Zone access denied"));
    await scheduled(due);

    const posts = send.mock.calls.filter(([url]) => url === webhook);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.[1]?.method).toBe("POST");
    const { text } = JSON.parse(String(posts[0]?.[1]?.body)) as { text: string };
    const lines = text.split("\n").slice(1);
    for (const [id, hostname] of [["a", "news.alpha.test"], ["b", "offers.alpha.test"]]) {
      const prefix = `Site ${id} (${id}) · ${hostname} · `;
      expect(lines).toContain(prefix + "min_tls_version · GET HTTP 403 · 10000 TLS read denied");
      expect(lines).toContain(prefix + "tiered_caching · PATCH HTTP 403 · 10000 Tiered Cache write denied");
    }
    for (const path of Object.keys(targets)) {
      expect(lines).toContain(`Site c (c) · bravo.test · ${path.split("/")[1]} · zone lookup HTTP 403 · 10000 Zone access denied`);
    }
    expect(lines).toHaveLength(8);
    expect(requests()).toContain(`GET ${zones}/zh/argo/tiered_caching`);
    expect(requests().at(-1)).toBe(`POST ${webhook}`);
  });
});
