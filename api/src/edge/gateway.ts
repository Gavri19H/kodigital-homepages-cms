import { getPath } from "hono/utils/url";
import { readCfSignals } from "../analytics/listicle-quality";
import { CACHE_CONTROL_VALUES, EDGE_CACHE_CONTROL } from "../cache/cache-control";
import { recordEdgeCacheStatus } from "../cache/cache-stats";
import { matchesIfNoneMatch } from "../cache/edge-cache";
import { elapsedMs, timingNow } from "../db/read-session";
import type { Env } from "../env";
import { sha256Hex } from "../leadgen/meta-hash";
import { genSessionId, readCookie } from "../public/listicle/experiment-pick";
import { isReservedPath } from "../public/reserved";
import { acceptPrefersMarkdown } from "../public/router";
import { normalizeHostname } from "../safety/protected-domains";
import { isAdminHost, type SiteContext } from "../site/site-context";
import { edgeBotVariant } from "./bot";
import { injectLeadgenAssignment, leadgenGatewayCookies } from "./leadgen-gateway";
import { selectLeadgenEntry, type LeadgenSelection } from "./leadgen-select";
import { buildListicleGatewayOutput, injectListicleGateway } from "./listicle-gateway";
import { pickListicle, type ListiclePick } from "./listicle-select";
import { perfstageRequest } from "./perfstage";
import { PublicPage } from "./public-page";
import { parseSiteSnapshot } from "./snapshot";
import { serveStatic } from "./static-cache";
import { listicleTag, siteQuoteTag } from "./tags";
import type { GatewayRequestInput, PublicPageProps, SiteSnapshot } from "./types";

interface PageExports {
  PublicPage(options: { props: PublicPageProps }): { fetch(request: Request): Promise<Response> };
}

type HonoFetch = (request: Request, env: Env, ctx?: ExecutionContext) => Response | Promise<Response>;
type CachedRoute = { kind: "page" | "article" } | { kind: "slug" | "leadgen"; key: string };

const tickKey = "edge:tick:v1";
const tickIntervalMs = 50_000;
const tickAfter = new WeakMap<KVNamespace, number>();

async function runEdgeTick(env: Env, ctx: ExecutionContext): Promise<void> {
  // KV has no atomic compare-and-set. Reuse one indexed log row to arbitrate cold
  // isolates on the D1 primary. Only its winner needs to access the shared KV epoch.
  const claim = await env.DB.prepare(`INSERT INTO cache_purge_log (id, action, status, dry_run, created_at)
    VALUES ((SELECT id FROM cache_purge_log WHERE status = 'completed' AND action = ? LIMIT 1),
            ?, 'completed', 0, unixepoch('subsec'))
    ON CONFLICT(id) DO UPDATE SET created_at = excluded.created_at
      WHERE created_at <= excluded.created_at - ? RETURNING created_at`)
    .bind(tickKey, tickKey, tickIntervalMs / 1000).first<{ created_at: number }>();
  if (!claim) {
    const last = await env.DB.prepare(
      "SELECT created_at FROM cache_purge_log WHERE status = 'completed' AND action = ? LIMIT 1",
    ).bind(tickKey).first<{ created_at: number }>();
    if (last) tickAfter.set(env.CACHE, Math.round(last.created_at * 1000) + tickIntervalMs);
    return;
  }
  const now = Math.round(claim.created_at * 1000);
  const stored = await env.CACHE.get(tickKey);
  const lastRun = stored === null ? NaN : Number(stored);
  if (Number.isSafeInteger(lastRun) && lastRun <= now && lastRun > now - tickIntervalMs) {
    tickAfter.set(env.CACHE, lastRun + tickIntervalMs);
    return;
  }
  tickAfter.set(env.CACHE, now + tickIntervalMs);
  await env.CACHE.put(tickKey, String(now));
  try {
    const { runEdgePurgeCron } = await import("./public-change");
    await runEdgePurgeCron(env, ctx);
  } finally {
    const { runFingerprintCron } = await import("./fingerprint-cron");
    await runFingerprintCron(env, ctx);
  }
}

const fixedPages = new Set([
  "/", "/feed.xml", "/rss", "/atom.xml", "/sitemap.xml", "/robots.txt", "/ads.txt",
  "/llms.txt", "/favicon.ico", "/site-icon.svg",
]);
const otherAppHeads = new Set(["newsletter", "lc", "lst-cand", "v"]);
const leadgenRuntimeHeads = new Set(["attempt", "ck", "auction", "track", "lc", "pb", "runtime", "config", "px"]);
// The loopback routes by Host. Forwarding, method and version overrides can also
// partition Workers Cache entries for an otherwise identical GET.
const innerHeaderExclusions = [
  "Cookie", "If-None-Match", "Forwarded", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Forwarded-For",
  "X-Forwarded-Port", "X-Forwarded-Scheme", "X-Host", "X-Original-Host", "X-Original-URL", "X-Rewrite-URL",
  "X-HTTP-Method", "X-HTTP-Method-Override", "X-Method-Override", "Cloudflare-Workers-Version-Key",
  "X-Perfstage-Direct",
];

function cachedRoute(path: string): CachedRoute | null {
  if (/%2f/i.test(path)) return null;
  if (fixedPages.has(path) || /^\/page\/[^/]+$/.test(path) ||
      /^\/(?:category|tag)\/[^/]+(?:\/page\/\d+)?$/.test(path)) return { kind: "page" };
  if (/^\/article\/[^/]+$/.test(path)) return { kind: "article" };
  if (path === "/lg") return { kind: "leadgen", key: "/lg" };

  const match = /^\/(lg\/)?([^/]+)$/.exec(path);
  if (!match) return null;
  const key = decodeURIComponent(match[2]!);
  if (match[1]) return leadgenRuntimeHeads.has(key) ? null : { kind: "leadgen", key };
  return isReservedPath(key) || otherAppHeads.has(key) ? null : { kind: "slug", key };
}

function cmsHeaderNames(headers: Headers): string[] {
  return Array.from(headers.keys()).filter(name => name.toLowerCase().startsWith("x-cms-"));
}

function copyVisitorRequest(request: Request): Request {
  const copy = new Request(request);
  // Standard Fetch runtimes can omit the Workers metadata when copying a request.
  if (copy.cf === undefined && request.cf !== undefined) copy.cf = request.cf;
  return copy;
}

interface GatewayTiming {
  snap: string;
  inner: string;
}

interface PageFetchContext {
  pages: PageExports;
  env: Env;
  ctx: ExecutionContext;
  hedgeMs: number;
}

async function fetchDirectPage({ env, ctx }: PageFetchContext, props: PublicPageProps, request: Request): Promise<Response> {
  // Supply the same entrypoint props locally. Native context methods and getters need their original receiver.
  const pageCtx: ExecutionContext<PublicPageProps> = {
    props,
    waitUntil: promise => ctx.waitUntil(promise),
    passThroughOnException: () => ctx.passThroughOnException(),
    get exports() { return ctx.exports; },
    get tracing() { return ctx.tracing; },
    get access() { return ctx.access; },
    get cache() { return ctx.cache; },
  };
  return PublicPage.prototype.fetch.call({ env, ctx: pageCtx }, request);
}

function hedgeDelayMs(value = "50"): number {
  const ms = Number(value);
  return /^\d+$/.test(value) && ms <= 2_147_483_647 ? ms : 50;
}

function needsLiveFallback(response: Response): boolean {
  return response.status >= 500 || response.headers.has("Set-Cookie");
}

type HedgeWinner = "cache" | "direct";

async function fetchWithHedge(
  cached: Promise<Response>, context: PageFetchContext, props: PublicPageProps, request: Request,
): Promise<{ response: Response; hedge?: HedgeWinner }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const early = await Promise.race([cached, new Promise<void>(resolve => {
      timer = setTimeout(resolve, context.hedgeMs);
    })]);
    if (early) return { response: early };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  async function candidate(pending: Promise<Response>, hedge: HedgeWinner) {
    const response = await pending;
    // Snapshot read failures become a 503. A stale variant can produce a live cookie-setting shell.
    if (needsLiveFallback(response)) {
      void response.body?.cancel().catch(() => {});
      throw new Error("PublicPage requires live fallback");
    }
    return { response, hedge };
  }

  const direct = fetchDirectPage(context, props, request);
  const winner = await Promise.any([candidate(cached, "cache"), candidate(direct, "direct")]);
  if (winner.hedge === "direct") {
    // Drain to EOF under waitUntil so both cache tiers can finish filling without buffering the page here.
    context.ctx.waitUntil(cached.then(response => response.body?.pipeTo(new WritableStream())).catch(() => {}));
    winner.response.headers.set("cf-cache-status", "MISS");
  } else {
    context.ctx.waitUntil(direct.then(response => response.body?.cancel()).catch(() => {}));
  }
  return winner;
}

async function fetchPublicPage(
  context: PageFetchContext, props: PublicPageProps, request: Request, timing?: GatewayTiming, direct = false,
): Promise<Response> {
  let hedge: HedgeWinner | undefined;
  const fetchPage = async () => {
    if (direct) return fetchDirectPage(context, props, request);
    const cached = context.pages.PublicPage({ props }).fetch(request);
    if (context.hedgeMs === 0) return cached;
    const result = await fetchWithHedge(cached, context, props, request);
    hedge = result.hedge;
    return result.response;
  };
  if (!timing) return fetchPage();
  const started = timingNow();
  let response: Response | undefined;
  try {
    response = await fetchPage();
    return response;
  } finally {
    try {
      const ms = Math.round(elapsedMs(started));
      const hit = !direct && response?.headers.get("cf-cache-status")?.toUpperCase() === "HIT";
      const build = hit ? null : response?.headers.get("Server-Timing");
      const fresh = build ? ", " + build : "";
      const outcome = hedge ? `, gw-hedge;desc="${hedge}"` : "";
      if (props.variantKey === "snap") {
        timing.snap = `gw-snap;dur=${ms};desc="${hit ? "HIT" : "MISS"}"${outcome}${fresh}`;
      } else {
        timing.inner = `${direct ? "gw-direct" : "gw-inner"};dur=${ms}${outcome}${fresh}`;
      }
    } catch {
      // Diagnostics must preserve the original fetch result or rejection.
    }
  }
}

function withGatewayTiming(response: Response, timing: GatewayTiming, liveFallback = false): Response {
  try {
    const value = timing.snap + ", " + timing.inner;
    if (liveFallback) {
      // Hono can return an immutable redirect with its own timing entries.
      const live = new Response(response.body, response);
      live.headers.append("Server-Timing", value);
      return live;
    }
    // The mutable gateway headers may still contain a cached build's timings.
    response.headers.delete("Server-Timing");
    response.headers.set("Server-Timing", value);
  } catch {
    // Return the original response if timing headers are unavailable.
  }
  return response;
}

interface VersionedSnapshot {
  snapshot: SiteSnapshot;
  version: string;
}

// Each validated text can be up to 1 Mi UTF-16 code units. Bound what one isolate retains.
const snapshotVersions = new Map<string, string>();
const maxSnapshotVersions = 8;

async function readHostSnapshot(url: URL, context: PageFetchContext, timing?: GatewayTiming): Promise<VersionedSnapshot | null> {
  const snapshotResponse = await fetchPublicPage(context, { siteKey: `host:${url.hostname}`, variantKey: "snap" },
    new Request(`https://${url.hostname}/__snap`, { redirect: "manual" }), timing);
  if (!snapshotResponse.ok) return null;
  const text = await snapshotResponse.text();
  const snapshot = parseSiteSnapshot(text);
  if (!snapshot || snapshot.status !== "active" || snapshot.hostname.toLowerCase() !== normalizeHostname(url.hostname)) {
    return null;
  }
  let version = snapshotVersions.get(text);
  if (version === undefined) {
    const { builtAt: _builtAt, ...content } = snapshot;
    version = await sha256Hex(JSON.stringify(content));
    if (snapshotVersions.size >= maxSnapshotVersions) snapshotVersions.delete(snapshotVersions.keys().next().value!);
    snapshotVersions.set(text, version);
  }
  return { snapshot, version };
}

async function serveCachedPage(
  request: Request, url: URL, route: CachedRoute, context: PageFetchContext, cf: GatewayRequestInput["cf"],
  { snapshot, version }: VersionedSnapshot, timing?: GatewayTiming, direct = false,
): Promise<Response | null> {
  const session = readCookie(request.headers.get("Cookie"), "ko_sid");
  const sidWasAbsent = session === "";
  const input: GatewayRequestInput = {
    url, headers: request.headers, cookies: {}, cf, sid: session || genSessionId(), nowMs: Date.now(),
  };
  const validator = request.headers.get("If-None-Match");
  const innerHeaders = new Headers(request.headers);
  for (const name of innerHeaderExclusions) innerHeaders.delete(name);
  // If-None-Match takes precedence over the date. Resolve it on the complete shell.
  if (validator !== null) innerHeaders.delete("If-Modified-Since");
  innerHeaders.set("Host", url.host);
  innerHeaders.set("x-cms-snap-version", version);
  if (snapshot.writeBookmark) innerHeaders.set("x-cms-bookmark", snapshot.writeBookmark);

  let variantKey = "human";
  let listicle: ListiclePick | null = null;
  let leadgen: Extract<LeadgenSelection, { kind: "render" }> | undefined;
  if (route.kind === "article" && acceptPrefersMarkdown(request.headers.get("Accept"))) {
    variantKey = "md";
  } else if (edgeBotVariant(request, getPath(request))) {
    variantKey = "bot";
  } else if (route.kind === "slug" && Object.hasOwn(snapshot.listicles, route.key)) {
    listicle = pickListicle(snapshot.listicles[route.key], input.sid);
    if (!listicle) return null;
    variantKey = "lst:" + listicle.versionPublicId;
    innerHeaders.set("x-cms-tags", listicleTag(listicle.listicleId));
  } else if (route.kind === "leadgen" && Object.hasOwn(snapshot.leadgen, route.key)) {
    const selection = selectLeadgenEntry(snapshot.leadgen[route.key], input);
    if (selection.kind === "fallback") return null;
    if (selection.kind === "redirect") {
      const headers = new Headers({
        Location: selection.location, "Cache-Control": EDGE_CACHE_CONTROL.private, "X-Content-Type-Options": "nosniff",
      });
      for (const cookie of leadgenGatewayCookies(input.sid, sidWasAbsent)) headers.append("Set-Cookie", cookie);
      return new Response(null, { status: selection.status, headers });
    }
    leadgen = selection;
    variantKey = "lg:" + leadgen.funnelVariantId;
    innerHeaders.set("x-cms-tags", siteQuoteTag(snapshot.siteId, leadgen.quoteId));
  }

  innerHeaders.set("Accept", variantKey === "md" ? "text/markdown" : "text/html");
  // Fetch the original representation and its validator before browser compression.
  if (variantKey === "human" || variantKey === "bot") innerHeaders.set("Accept-Encoding", "identity");
  if (snapshot.verticalSlug !== undefined) {
    innerHeaders.set("x-cms-site-context", JSON.stringify({
      site_id: snapshot.siteId,
      hostname: snapshot.hostname,
      vertical_slug: snapshot.verticalSlug,
      status: snapshot.status,
      content_version: snapshot.contentVersion,
      settings_version: snapshot.settingsVersion,
    } satisfies SiteContext));
  }
  const inner = await fetchPublicPage(context, { siteKey: snapshot.siteId, variantKey },
    new Request(url.origin + url.pathname, { method: "GET", headers: innerHeaders, redirect: "manual" }), timing, direct);
  // A stale assignment can send the renderer down its live, cookie-setting path.
  // Retry with the visitor's actual cookies and query in that case.
  if (needsLiveFallback(inner)) return null;

  let response = inner;
  const publicHtml = inner.status === 200 && !listicle && !leadgen &&
    /^text\/html(?:\s*;|$)/i.test(inner.headers.get("Content-Type") ?? "") &&
    inner.headers.get("Cache-Control")?.startsWith("public,");
  let etag = inner.headers.get("ETag");
  if (publicHtml) {
    if (etag === null) {
      // Bot HTML can arrive without a renderer ETag. Hash the cached bytes
      // because the snapshot may already describe a later publish.
      const bytes = await inner.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      etag = 'W/"' + btoa(String.fromCharCode(...new Uint8Array(digest))) + '"';
      response = new Response(bytes, inner);
    } else if (!etag.startsWith("W/") && (inner.headers.has("Content-Encoding") ||
        (request.headers.get("Accept-Encoding") || "identity").toLowerCase() !== "identity")) {
      etag = "W/" + etag;
    }
  }
  const notModified = inner.status === 200 && etag !== null &&
    (publicHtml ? matchesIfNoneMatch(validator, etag.replace(/^W\//, "")) : validator === etag);
  const sendBody = request.method !== "HEAD" && !notModified;
  let cookies: string[] = [];
  if (inner.status === 200 && listicle) {
    const output = buildListicleGatewayOutput({
      pick: listicle, input, sidWasAbsent, siteTimeZone: snapshot.timeZone ?? "", siteLanguage: snapshot.language ?? "",
    });
    cookies = output.setCookies;
    if (sendBody) response = injectListicleGateway(inner, output.contextScript);
  } else if (inner.status === 200 && leadgen) {
    cookies = leadgenGatewayCookies(input.sid, sidWasAbsent);
    if (sendBody) response = await injectLeadgenAssignment(inner, leadgen);
  }

  const headers = new Headers(response.headers);
  for (const name of cmsHeaderNames(headers)) headers.delete(name);
  if (publicHtml && etag !== null) headers.set("ETag", etag);
  headers.set("x-edge-cache", direct ? "DIRECT" : inner.headers.get("cf-cache-status") ?? "none");
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  if (inner.status === 200 && (listicle || leadgen)) {
    // PublicPage maps the degraded quote renderer's no-store to the private edge policy.
    const shellIsPrivate = inner.headers.get("Cache-Control") === EDGE_CACHE_CONTROL.private;
    headers.set("Cache-Control", shellIsPrivate ? "no-store" : CACHE_CONTROL_VALUES.publicHtml);
    // The listicle transform streams a longer body. HEAD also skips the transform.
    if (listicle || !sendBody) headers.delete("Content-Length");
  }
  if (direct) headers.set("Cache-Control", EDGE_CACHE_CONTROL.private);
  if (!sendBody) void response.body?.cancel().catch(() => {});
  return new Response(sendBody ? response.body : null, {
    headers, status: notModified ? 304 : inner.status, statusText: notModified ? "Not Modified" : inner.statusText,
  });
}

export async function gatewayFetch(
  request: Request, env: Env, ctx: ExecutionContext | undefined, honoFetch: HonoFetch,
): Promise<Response> {
  // Use Hono's route decoding so an escaped reserved head has the same boundary.
  const path = getPath(request);
  const pending = dispatchGatewayRequest(request, env, ctx, honoFetch, path);
  if (path !== "/__edge/tick" && !request.headers.has("Cloudflare-Workers-Version-Overrides")) return pending;

  const response = await pending;
  // A cached response or a redirect can have immutable headers.
  const versioned = new Response(response.body, response);
  versioned.headers.set("x-worker-version", env.CF_VERSION_METADATA?.id ?? "unknown");
  return versioned;
}

async function dispatchGatewayRequest(
  request: Request, env: Env, ctx: ExecutionContext | undefined, honoFetch: HonoFetch, path: string,
): Promise<Response> {
  if (path === "/__edge/tick") {
    const headers = { "Cache-Control": EDGE_CACHE_CONTROL.private };
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } });
    const now = Date.now();
    if (ctx && now >= (tickAfter.get(env.CACHE) ?? 0)) {
      tickAfter.set(env.CACHE, now + tickIntervalMs);
      ctx.waitUntil(runEdgeTick(env, ctx).catch(error => console.error("edge tick failed", error)));
    }
    return new Response("ok", { status: 202, headers });
  }
  const names = cmsHeaderNames(request.headers);
  if (names.length) {
    const clean = copyVisitorRequest(request);
    for (const name of names) clean.headers.delete(name);
    request = clean;
  }
  request = perfstageRequest(request, env);
  let timing: GatewayTiming | undefined;
  try {
    if (path === "/__snap" || path.startsWith("/__snap/")) {
      return new Response(null, { status: 404, headers: { "Cache-Control": EDGE_CACHE_CONTROL.private } });
    }
    let response = await serveStatic(request, env, ctx, honoFetch);
    const pages = ctx?.exports as PageExports | undefined;
    if (!response && ctx && typeof pages?.PublicPage === "function" && (request.method === "GET" || request.method === "HEAD")) {
      const url = new URL(request.url);
      const route = cachedRoute(path);
      const attempt = request.method === "GET" && path === "/lg/attempt";
      if ((route || attempt) && !isAdminHost(url.hostname, env)) {
        // HEAD needs only metadata. Runtime endpoints can consult the snapshot but never hedge.
        const hedgeMs = route && request.method === "GET" ? hedgeDelayMs(env.EDGE_HEDGE_MS) : 0;
        const context = { env, ctx, pages, hedgeMs };
        // Entry-rule redirects and failed host lookups can skip the inner fetch.
        if (route) timing = { snap: 'gw-snap;dur=0;desc="MISS"', inner: "gw-inner;dur=0" };
        const hostSnapshot = await readHostSnapshot(url, context, timing);
        if (hostSnapshot && route) {
          const direct = env.PERFSTAGE === "true" && request.headers.get("x-perfstage-direct") === "1";
          response = await serveCachedPage(request, url, route, context, readCfSignals(request), hostSnapshot, timing, direct);
        } else if (hostSnapshot && attempt) {
          const { snapshot, version } = hostSnapshot;
          const inner = copyVisitorRequest(request);
          inner.headers.set("x-cms-site-id", snapshot.siteId);
          inner.headers.set("x-cms-snap-version", version);
          // The attempt router still uses this header to trust the gateway's site ID.
          inner.headers.set("x-cms-snap-built-at", String(snapshot.builtAt));
          inner.headers.set("x-cms-bookmark", snapshot.writeBookmark ?? "");
          request = inner;
        }
      }
    }
    if (response) {
      recordEdgeCacheStatus(env, response.headers.get("x-edge-cache"), ctx);
      return timing ? withGatewayTiming(response, timing) : response;
    }
  } catch {
    // Snapshot, binding, and rendering failures all use the original visitor URL and method.
  }
  const live = honoFetch(request, env, ctx);
  return timing ? withGatewayTiming(await live, timing, true) : live;
}
