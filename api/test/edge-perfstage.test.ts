import { afterEach, describe, expect, it, vi } from "vitest";
import * as loader from "../src/analytics/event-loader";
import * as reconciliation from "../src/analytics/listicle-reconciliation";
import * as fingerprint from "../src/edge/fingerprint-cron";
import * as gateway from "../src/edge/gateway";
import { perfstageEnv, perfstageRequest } from "../src/edge/perfstage";
import * as purge from "../src/edge/public-change";
import { PublicPage } from "../src/edge/public-page";
import * as snapshots from "../src/edge/snapshot";
import * as speed from "../src/edge/speed-alarms";
import type { PublicPageProps, SiteSnapshot } from "../src/edge/types";
import type { Env } from "../src/env";
import worker, * as entry from "../src/index";
import * as leadgenAnalytics from "../src/leadgen/mirror-sync";
import * as leadgenRevenue from "../src/leadgen/revenue-recon";
import * as retention from "../src/leadgen/retention";
import * as listicleAnalytics from "../src/listicles/mirror-sync";
import * as listicleRevenue from "../src/listicles/revenue-recon";
import * as provisioning from "../src/site-provisioning";
import * as workflow from "../src/workflow";
import { buildEnv, makeFakeDb } from "./helpers/admin-test-kit";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    constructor(readonly ctx: ExecutionContext, readonly env: Env) {}
  },
}));

const workerHost = "kodigital-homepages-cms-worker-perfstage.haikov1989.workers.dev";
const tenantHost = "news.example";
const env: Env = {
  ...buildEnv(makeFakeDb().db),
  PERFSTAGE: "true", APP_ENV: "perfstage", ADMIN_HOST: workerHost,
};
const errorMessage = "perfstage: R2 writes disabled";
const snapshot: SiteSnapshot = {
  v: 1, siteId: "news", hostname: tenantHost, status: "active", contentVersion: 1,
  settingsVersion: 1, writeBookmark: "bookmark", timeZone: null, language: null,
  builtAt: 1, listicles: {}, leadgen: {},
};

function context<Props>(props: Props, exports: Cloudflare.Exports = {}): ExecutionContext<Props> {
  return {
    props, exports, waitUntil: vi.fn(), passThroughOnException() {},
    get tracing(): never { throw new Error("unexpected tracing access"); },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("perfstageRequest", () => {
  it("replaces the host and removes the override while retaining the visitor request", async () => {
    const cf = { regionCode: "CA" };
    const request = Object.assign(new Request(`https://${workerHost}:8443/path%2Fpart?a=1&a=2`, {
      method: "POST", body: "payload", redirect: "manual",
      headers: { "X-Perfstage-Host": "News.EXAMPLE.", Cookie: "ko_sid=visitor", "x-custom": "keep" },
    }), { cf });
    const rewritten = perfstageRequest(request, env);
    expect(rewritten.url).toBe("https://news.example/path%2Fpart?a=1&a=2");
    expect(rewritten.method).toBe("POST");
    expect(rewritten.redirect).toBe("manual");
    expect(await rewritten.text()).toBe("payload");
    expect(rewritten.headers.get("Cookie")).toBe("ko_sid=visitor");
    expect(rewritten.headers.get("x-custom")).toBe("keep");
    expect(rewritten.headers.has("x-perfstage-host")).toBe(false);
    expect(rewritten.cf).toEqual(cf);
    expect(request.headers.get("x-perfstage-host")).toBe("News.EXAMPLE.");
  });

  it("rewrites both the URL host and the incoming workers.dev Host header to the tenant", () => {
    const request = new Request(`https://${workerHost}/`, {
      headers: { Host: workerHost, "x-perfstage-host": tenantHost },
    });
    const rewritten = perfstageRequest(request, env);
    expect(new URL(rewritten.url).host).toBe(tenantHost);
    expect(rewritten.headers.get("Host")).toBe(tenantHost);
  });

  it.each([
    undefined, "", "https://news.example", "news.example:443", "a@news.example", "news.example/path",
    "news.example?x", "news.example#x", "a.example, b.example", "a..example", "-a.example",
    "a-.example", "x".repeat(64) + ".example", Array(5).fill("x".repeat(60)).join("."),
    "tenant.123", "0x7f000001",
  ])("preserves the request for absent or invalid override %s", host => {
    const request = new Request(`https://${workerHost}/`, {
      headers: host === undefined ? {} : { "x-perfstage-host": host },
    });
    expect(perfstageRequest(request, env)).toBe(request);
  });
});

it.each([
  ["production", undefined], ["staging", "false"], ["perfstage", undefined], ["perfstage", "TRUE"],
] as const)("keeps both identities for APP_ENV=%s and PERFSTAGE=%s", (APP_ENV, PERFSTAGE) => {
  const bindings = { ...env, APP_ENV, PERFSTAGE };
  const request = new Request(`https://${workerHost}/`, {
    headers: { Host: workerHost, "x-perfstage-host": tenantHost },
  });
  expect(perfstageRequest(request, bindings)).toBe(request);
  expect(request.headers.get("Host")).toBe(workerHost);
  expect(request.headers.get("x-perfstage-host")).toBe(tenantHost);
  expect(perfstageEnv(bindings)).toBe(bindings);
});

it("passes R2 reads with their native receiver and blocks every write before it reaches MEDIA", async () => {
  const object = { key: "photo" };
  const listing = { objects: [object], truncated: false, delimitedPrefixes: [] };
  const bucket = {
    head: vi.fn().mockResolvedValue(object), get: vi.fn().mockResolvedValue(object),
    list: vi.fn().mockResolvedValue(listing), put: vi.fn(), delete: vi.fn(),
    createMultipartUpload: vi.fn(), resumeMultipartUpload: vi.fn(),
  } satisfies R2Bucket;
  const bindings = { ...env, MEDIA: bucket };
  const wrapped = perfstageEnv(bindings);
  expect(wrapped.DB).toBe(bindings.DB);
  expect(wrapped.CACHE).toBe(bindings.CACHE);
  expect(bindings.MEDIA).toBe(bucket);
  const options = { onlyIf: { etagMatches: "v1" } };
  expect(await wrapped.MEDIA.get("photo", options)).toBe(object);
  expect(await wrapped.MEDIA.head("photo")).toBe(object);
  expect(await wrapped.MEDIA.list({ prefix: "photos/" })).toBe(listing);
  expect(bucket.get).toHaveBeenCalledWith("photo", options);
  expect(bucket.head).toHaveBeenCalledWith("photo");
  expect(bucket.list).toHaveBeenCalledWith({ prefix: "photos/" });
  for (const read of [bucket.get, bucket.head, bucket.list]) expect(read.mock.contexts[0]).toBe(bucket);

  await expect(wrapped.MEDIA.put("photo", "data")).rejects.toThrow(errorMessage);
  await expect(wrapped.MEDIA.delete(["a", "b"])).rejects.toThrow(errorMessage);
  await expect(wrapped.MEDIA.createMultipartUpload("photo")).rejects.toThrow(errorMessage);
  expect(() => wrapped.MEDIA.resumeMultipartUpload("photo", "upload")).toThrow(errorMessage);
  for (const write of [bucket.put, bucket.delete, bucket.createMultipartUpload, bucket.resumeMultipartUpload]) {
    expect(write).not.toHaveBeenCalled();
  }
});

it("resolves the tenant snapshot and shell from the workers.dev fetch entrypoint", async () => {
  const fetchPage = vi.fn((props: PublicPageProps, request: Request) => {
    if (props.variantKey === "snap") return Response.json(snapshot);
    expect(request.headers.get("x-cms-bookmark")).toBe("bookmark");
    expect(request.headers.has("x-cms-variant")).toBe(false);
    expect(request.headers.has("x-perfstage-host")).toBe(false);
    return new Response("news home", { headers: { "cf-cache-status": "HIT" } });
  });
  const ctx = context({}, {
    PublicPage: ({ props }: { props: PublicPageProps }) => ({ fetch: (req: Request) => fetchPage(props, req) }),
  });
  const dispatch = vi.spyOn(gateway, "gatewayFetch");
  const response = await worker.fetch(new Request(`https://${workerHost}/?utm_source=probe`, {
    headers: { Host: workerHost, "x-perfstage-host": tenantHost, "x-cms-variant": "forged" },
  }), env, ctx);
  expect(response.status).toBe(200);
  expect(response.headers.get("x-edge-cache")).toBe("HIT");
  expect(await response.text()).toBe("news home");
  expect(fetchPage.mock.calls.map(([props, req]) => [props, req.url])).toEqual([
    [{ siteKey: "host:news.example", variantKey: "snap" }, "https://news.example/__snap"],
    [{ siteKey: "news", variantKey: "human" }, "https://news.example/"],
  ]);
  expect(fetchPage.mock.calls[1]![1].headers.get("Host")).toBe(tenantHost);
  await expect(dispatch.mock.calls[0]![1].MEDIA.put("photo", null)).rejects.toThrow(errorMessage);
});

it("guards the independent PublicPage binding for both snapshots and Hono renders", async () => {
  const build = vi.spyOn(snapshots, "buildSiteSnapshot").mockResolvedValue(snapshot);
  const render = vi.spyOn(entry, "honoFetch").mockResolvedValue(new Response("rendered"));
  const snap = new PublicPage(context({ siteKey: "host:news.example", variantKey: "snap" }), env);
  const page = new PublicPage(context({ siteKey: "news", variantKey: "human" }), env);
  expect((await snap.fetch(new Request("https://news.example/__snap"))).status).toBe(200);
  expect(await (await page.fetch(new Request("https://news.example/"))).text()).toBe("rendered");
  await expect(build.mock.calls[0]![0].MEDIA.delete("key")).rejects.toThrow(errorMessage);
  const bindings = render.mock.calls[0]![1];
  if (!bindings || !("MEDIA" in bindings)) throw new Error("missing renderer media binding");
  await expect(bindings.MEDIA.delete("key")).rejects.toThrow(errorMessage);
});

it.each(["resolve", "reject"])("runs only the three perfstage cron jobs through waitUntil when jobs %s", async outcome => {
  const publish = vi.spyOn(workflow, "processScheduledArticles").mockResolvedValue({ due: 0, published: [], failed: [] });
  const edge = vi.spyOn(purge, "runEdgePurgeCron").mockResolvedValue(undefined);
  const fingerprints = vi.spyOn(fingerprint, "runFingerprintCron").mockResolvedValue(undefined);
  if (outcome === "reject") {
    for (const job of [publish, edge, fingerprints]) job.mockRejectedValue(new Error("cron job failed"));
  }
  const excluded = [
    vi.spyOn(provisioning, "driveInProgressProvisioning"), vi.spyOn(loader, "runEventLoader"),
    vi.spyOn(listicleAnalytics, "syncListicleAnalytics"), vi.spyOn(reconciliation, "listicleDailyReconciliation"),
    vi.spyOn(listicleRevenue, "runListicleRevenueCron"), vi.spyOn(retention, "pruneLeadgenRetention"),
    vi.spyOn(leadgenAnalytics, "syncLeadgenAnalytics"), vi.spyOn(leadgenRevenue, "runLeadgenRevenueCron"),
    vi.spyOn(speed, "runSpeedAlarms"),
  ];
  for (const job of excluded) job.mockRejectedValue(new Error("unexpected job"));
  const ctx = context({});
  await worker.scheduled({ cron: "* * * * *", scheduledTime: Date.UTC(2026, 10, 23, 6), noRetry() {} }, env, ctx);
  const bindings = publish.mock.calls[0]![0];
  expect(publish).toHaveBeenCalledTimes(1);
  for (const job of [edge, fingerprints]) {
    expect(job).toHaveBeenCalledTimes(1);
    const [jobEnv, jobCtx] = job.mock.calls[0]!;
    expect(jobEnv).toBe(bindings);
    expect(jobCtx).toBe(ctx);
  }
  await expect(bindings.MEDIA.put("photo", null)).rejects.toThrow(errorMessage);
  for (const job of excluded) expect(job).not.toHaveBeenCalled();
  expect(ctx.waitUntil).toHaveBeenCalledExactlyOnceWith(expect.any(Promise));
  await vi.mocked(ctx.waitUntil).mock.calls[0]![0];
});
