import { WorkerEntrypoint } from "cloudflare:workers";
import { applyEdgeCacheHeaders, EDGE_CACHE_CONTROL } from "../cache/cache-control";
import { D1Timing, elapsedMs, renderReadDb, timingNow } from "../db/read-session";
import type { Env } from "../env";
import { sha256Hex } from "../leadgen/meta-hash";
import { perfstageEnv } from "./perfstage";
import { buildSiteSnapshot } from "./snapshot";
import { hostTag, mergeTags, siteTag, snapTag } from "./tags";
import type { PublicPageProps } from "./types";

export const BUILD_COLO_HEADER = "x-cms-build-colo";

// Perfstage recovers metadata from first() and raw() by changing how they read.
// In production time the original method, and observe metadata only when D1 returns it.
function timeBuildDb(db: D1Database, timing: D1Timing): D1Database {
  const originals = new WeakMap<object, object>();
  async function measure<T>(execute: () => Promise<T>, observe?: (value: T) => void): Promise<T> {
    // Keep even a synchronous binding error with its one invocation. If the collector
    // fails after dispatch, return the original query's result or rejection.
    let query: Promise<T> | undefined;
    const run = async () => execute();
    try {
      return await timing.measure(() => (query = run()), observe);
    } catch {
      return query ?? run();
    }
  }
  function wrap<T extends object>(target: T): T {
    // A separate view also permits observing methods on a frozen binding.
    const view: T = Object.create(target);
    const wrapped = new Proxy(view, {
      get(_view, key) {
        const method: unknown = Reflect.get(target, key);
        if (typeof method !== "function") return method;
        switch (key) {
          case "withSession":
          case "prepare":
          case "bind":
            return (...args: unknown[]) => {
              const next = Reflect.apply(method, target, args);
              return next && wrap(next);
            };
          case "batch":
            return (statements: D1PreparedStatement[]) => measure(
              () => Reflect.apply(method, target, [statements.map(stmt => originals.get(stmt) ?? stmt)]),
              (results: D1Result[]) => results.forEach(timing.recordResult),
            );
          case "all":
          case "run":
            return (...args: unknown[]) => measure(() => Reflect.apply(method, target, args), timing.recordResult);
          case "first":
          case "raw":
          case "exec":
          case "dump":
            return (...args: unknown[]) => measure(() => Reflect.apply(method, target, args));
          default:
            return method.bind(target);
        }
      },
    });
    originals.set(wrapped, target);
    return wrapped;
  }
  return wrap(db);
}

async function buildPublicPage(
  request: Request, innerEnv: Env, ctx: ExecutionContext<PublicPageProps>, { hostname, pathname }: URL, stageTiming?: D1Timing,
): Promise<Response> {
  const { siteKey, variantKey } = ctx.props;
  if (pathname === "/__snap") {
    if (siteKey !== `host:${hostname}`) {
      return new Response(null, { status: 400, headers: { "Cache-Control": EDGE_CACHE_CONTROL.private } });
    }
    try {
      const snapshot = await buildSiteSnapshot(innerEnv, hostname, stageTiming);
      if (snapshot === null) {
        return new Response(null, {
          status: 404,
          headers: { "Cache-Control": EDGE_CACHE_CONTROL.notFound, "Cache-Tag": hostTag(hostname) },
        });
      }
      const text = JSON.stringify(snapshot);
      const response = new Response(text, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": EDGE_CACHE_CONTROL.publicPage,
          "Cache-Tag": mergeTags([siteTag(snapshot.siteId), snapTag(snapshot.siteId)]).join(","),
        },
      });
      try {
        response.headers.set("ETag", '"' + await sha256Hex(text) + '"');
      } catch {
        // The gateway also accepts snapshots without a memo key.
      }
      return response;
    } catch {
      return new Response(null, { status: 503, headers: { "Cache-Control": EDGE_CACHE_CONTROL.private } });
    }
  }

  innerEnv.DB = renderReadDb(innerEnv.DB, request.headers.get("x-cms-bookmark"), stageTiming);
  const inner = new Request(request);
  if (innerEnv.PERFSTAGE !== "true") inner.headers.delete(BUILD_COLO_HEADER);
  inner.headers.set("x-cms-variant", variantKey);
  const { honoFetch } = await import("../index");
  const response = await honoFetch(inner, innerEnv, ctx);
  return applyEdgeCacheHeaders(response, {
    siteId: siteKey,
    path: pathname,
    extraTags: request.headers.get("x-cms-tags")?.split(","),
  });
}

export class PublicPage extends WorkerEntrypoint<Env, PublicPageProps> {
  override async fetch(request: Request): Promise<Response> {
    const started = timingNow();
    const perfstage = this.env.PERFSTAGE === "true";
    const url = new URL(request.url);
    const innerEnv = { ...perfstageEnv(this.env), EDGE_INNER: "1" };
    let timing: D1Timing | undefined;
    try {
      timing = new D1Timing();
      if (!perfstage) innerEnv.DB = timeBuildDb(innerEnv.DB, timing);
    } catch {
      // A build can still use the original binding if observation is unavailable.
      timing = undefined;
    }

    let response: Response | undefined;
    try {
      response = await buildPublicPage(request, innerEnv, this.ctx, url, perfstage ? timing : undefined);
      if (!perfstage) response.headers.delete("Server-Timing");
      return response;
    } finally {
      if (timing) {
        try {
          const snap = url.pathname === "/__snap";
          const firstRegion = timing.regions.values().next().value ?? "none";
          const buildMs = Math.round(elapsedMs(started));
          const d1Ms = Math.round(timing.wallMs);
          if (perfstage) {
            const prefix = snap ? "snap-" : "";
            const region = firstRegion.replace(/[^\x20-\x7e]/g, "?").replace(/["\\]/g, "\\$&");
            const desc = `rounds=${timing.rounds} calls=${timing.calls} primary=${timing.primary} replica=${timing.replica} region=${region}`;
            response?.headers.append("Server-Timing",
              `${prefix}build;dur=${buildMs}, ${prefix}d1;dur=${d1Ms};desc="${desc}"`);
          } else {
            console.log(JSON.stringify({
              evt: "edge-build", host: url.hostname, path: url.pathname, variant: this.ctx.props.variantKey, snap,
              build_ms: buildMs, d1_ms: d1Ms, rounds: timing.rounds, calls: timing.calls,
              primary: timing.primary, replica: timing.replica, region: firstRegion,
              colo: request.headers.get(BUILD_COLO_HEADER) ?? request.cf?.colo ?? null,
            }));
          }
        } catch {
          // Diagnostics must preserve the original response or rejection.
        }
      }
    }
  }

  async purgeTags(tags: string[]): Promise<{ success: boolean; errors: unknown[] }> {
    try {
      const cache = this.ctx.cache;
      if (!cache) return { success: false, errors: ["no-cache-context"] };
      return await cache.purge({ tags: mergeTags(tags) });
    } catch (error) {
      const message = error instanceof Error ? error.message : error;
      return { success: false, errors: [typeof message === "string" ? message : "cache-purge-failed"] };
    }
  }
}
