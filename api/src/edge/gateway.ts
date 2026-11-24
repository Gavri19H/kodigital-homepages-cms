import { getPath } from "hono/utils/url";
import { readCfSignals } from "../analytics/listicle-quality";
import { EDGE_CACHE_CONTROL } from "../cache/cache-control";
import { recordEdgeCacheStatus } from "../cache/cache-stats";
import { matchesIfNoneMatch } from "../cache/edge-cache";
import type { Env } from "../env";
import { genSessionId, readCookie } from "../public/listicle/experiment-pick";
import { isReservedPath } from "../public/reserved";
import { acceptPrefersMarkdown } from "../public/router";
import { normalizeHostname } from "../safety/protected-domains";
import { isAdminHost } from "../site/site-context";
import { edgeBotVariant } from "./bot";
import { injectLeadgenAssignment, leadgenGatewayCookies } from "./leadgen-gateway";
import { selectLeadgenEntry, type LeadgenSelection } from "./leadgen-select";
import { buildListicleGatewayOutput, injectListicleGateway } from "./listicle-gateway";
import { pickListicle, type ListiclePick } from "./listicle-select";
import { perfstageRequest } from "./perfstage";
import { parseSiteSnapshot } from "./snapshot";
import { serveStatic } from "./static-cache";
import { listicleTag, siteQuoteTag } from "./tags";
import type { GatewayRequestInput, PublicPageProps } from "./types";

interface PageExports {
  PublicPage(options: { props: PublicPageProps }): { fetch(request: Request): Promise<Response> };
}

type HonoFetch = (request: Request, env: Env, ctx?: ExecutionContext) => Response | Promise<Response>;
type CachedRoute = { kind: "page" | "article" } | { kind: "slug" | "leadgen"; key: string };

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

async function serveCachedPage(
  request: Request, url: URL, route: CachedRoute, pages: PageExports, cf: GatewayRequestInput["cf"],
): Promise<Response | null> {
  const snapshotResponse = await pages.PublicPage({
    props: { siteKey: `host:${url.hostname}`, variantKey: "snap" },
  }).fetch(new Request(`https://${url.hostname}/__snap`, { redirect: "manual" }));
  if (!snapshotResponse.ok) return null;
  const snapshot = parseSiteSnapshot(await snapshotResponse.text());
  if (!snapshot || snapshot.status !== "active" || snapshot.hostname.toLowerCase() !== normalizeHostname(url.hostname)) {
    return null;
  }

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
  const inner = await pages.PublicPage({ props: { siteKey: snapshot.siteId, variantKey } }).fetch(
    new Request(url.origin + url.pathname, { method: "GET", headers: innerHeaders, redirect: "manual" }),
  );
  // A stale assignment can send the renderer down its live, cookie-setting path.
  // Retry with the visitor's actual cookies and query in that case.
  if (inner.status >= 500 || inner.headers.has("Set-Cookie")) return null;

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
  headers.set("x-edge-cache", inner.headers.get("cf-cache-status") ?? "none");
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  if (inner.status === 200 && (listicle || leadgen)) {
    headers.set("Cache-Control", EDGE_CACHE_CONTROL.private);
    // The listicle transform streams a longer body. HEAD also skips the transform.
    if (listicle || !sendBody) headers.delete("Content-Length");
  }
  if (!sendBody) void response.body?.cancel().catch(() => {});
  return new Response(sendBody ? response.body : null, {
    headers, status: notModified ? 304 : inner.status, statusText: notModified ? "Not Modified" : inner.statusText,
  });
}

export async function gatewayFetch(
  request: Request, env: Env, ctx: ExecutionContext | undefined, honoFetch: HonoFetch,
): Promise<Response> {
  const names = cmsHeaderNames(request.headers);
  if (names.length) {
    const clean = new Request(request);
    for (const name of names) clean.headers.delete(name);
    // Standard Fetch runtimes can omit the Workers metadata when copying a request.
    if (clean.cf === undefined && request.cf !== undefined) clean.cf = request.cf;
    request = clean;
  }
  request = perfstageRequest(request, env);
  try {
    // Use Hono's route decoding so an escaped reserved head has the same boundary.
    const path = getPath(request);
    if (path === "/__snap" || path.startsWith("/__snap/")) {
      return new Response(null, { status: 404, headers: { "Cache-Control": EDGE_CACHE_CONTROL.private } });
    }
    let response = await serveStatic(request, env, ctx, honoFetch);
    const pages = ctx?.exports as PageExports | undefined;
    if (!response && typeof pages?.PublicPage === "function" && (request.method === "GET" || request.method === "HEAD")) {
      const url = new URL(request.url);
      const route = cachedRoute(path);
      if (route && !isAdminHost(url.hostname, env)) {
        response = await serveCachedPage(request, url, route, pages, readCfSignals(request));
      }
    }
    if (response) {
      recordEdgeCacheStatus(env, response.headers.get("x-edge-cache"), ctx);
      return response;
    }
  } catch {
    // Snapshot, binding, and rendering failures all use the original visitor URL and method.
  }
  return honoFetch(request, env, ctx);
}
