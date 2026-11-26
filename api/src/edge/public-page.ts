import { WorkerEntrypoint } from "cloudflare:workers";
import { applyEdgeCacheHeaders, EDGE_CACHE_CONTROL } from "../cache/cache-control";
import { D1Timing, elapsedMs, renderReadDb, timingNow } from "../db/read-session";
import type { Env } from "../env";
import { sha256Hex } from "../leadgen/meta-hash";
import { perfstageEnv } from "./perfstage";
import { buildSiteSnapshot } from "./snapshot";
import { hostTag, mergeTags, siteTag, snapTag } from "./tags";
import type { PublicPageProps } from "./types";

export class PublicPage extends WorkerEntrypoint<Env, PublicPageProps> {
  override async fetch(request: Request): Promise<Response> {
    const timing = this.env.PERFSTAGE === "true" ? new D1Timing() : undefined;
    const started = timing ? timingNow() : 0;
    const { siteKey, variantKey } = this.ctx.props;
    const { hostname, pathname } = new URL(request.url);
    const withTiming = (response: Response): Response => {
      if (!timing) {
        response.headers.delete("Server-Timing");
        return response;
      }
      try {
        const prefix = pathname === "/__snap" ? "snap-" : "";
        const firstRegion = timing.regions.values().next().value ?? "none";
        const region = firstRegion.replace(/[^\x20-\x7e]/g, "?").replace(/["\\]/g, "\\$&");
        const desc = `rounds=${timing.rounds} calls=${timing.calls} primary=${timing.primary} replica=${timing.replica} region=${region}`;
        response.headers.append("Server-Timing",
          `${prefix}build;dur=${Math.round(elapsedMs(started))}, ${prefix}d1;dur=${Math.round(timing.wallMs)};desc="${desc}"`);
      } catch {
        // A diagnostic header must never prevent delivery of the built response.
      }
      return response;
    };
    const innerEnv = { ...perfstageEnv(this.env), EDGE_INNER: "1" };
    if (pathname === "/__snap") {
      if (siteKey !== `host:${hostname}`) {
        return withTiming(new Response(null, { status: 400, headers: { "Cache-Control": EDGE_CACHE_CONTROL.private } }));
      }
      try {
        const snapshot = await buildSiteSnapshot(innerEnv, hostname, timing);
        if (snapshot === null) {
          return withTiming(new Response(null, {
            status: 404,
            headers: { "Cache-Control": EDGE_CACHE_CONTROL.notFound, "Cache-Tag": hostTag(hostname) },
          }));
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
        return withTiming(response);
      } catch {
        return withTiming(new Response(null, { status: 503, headers: { "Cache-Control": EDGE_CACHE_CONTROL.private } }));
      }
    }

    innerEnv.DB = renderReadDb(this.env.DB, request.headers.get("x-cms-bookmark"), timing);
    const inner = new Request(request);
    inner.headers.set("x-cms-variant", variantKey);
    const { honoFetch } = await import("../index");
    const response = await honoFetch(inner, innerEnv, this.ctx);
    return withTiming(applyEdgeCacheHeaders(response, {
      siteId: siteKey,
      path: pathname,
      extraTags: request.headers.get("x-cms-tags")?.split(","),
    }));
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
