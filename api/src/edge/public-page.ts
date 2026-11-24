import { WorkerEntrypoint } from "cloudflare:workers";
import { applyEdgeCacheHeaders, EDGE_CACHE_CONTROL } from "../cache/cache-control";
import type { Env } from "../env";
import { perfstageEnv } from "./perfstage";
import { buildSiteSnapshot } from "./snapshot";
import { hostTag, mergeTags, siteTag, snapTag } from "./tags";
import type { PublicPageProps } from "./types";

export class PublicPage extends WorkerEntrypoint<Env, PublicPageProps> {
  override async fetch(request: Request): Promise<Response> {
    const { siteKey, variantKey } = this.ctx.props;
    const { hostname, pathname } = new URL(request.url);
    if (pathname === "/__snap") {
      if (siteKey !== `host:${hostname}`) {
        return new Response(null, { status: 400, headers: { "Cache-Control": EDGE_CACHE_CONTROL.private } });
      }
      try {
        const snapshot = await buildSiteSnapshot(perfstageEnv(this.env), hostname);
        if (snapshot === null) {
          return new Response(null, {
            status: 404,
            headers: { "Cache-Control": EDGE_CACHE_CONTROL.notFound, "Cache-Tag": hostTag(hostname) },
          });
        }
        return Response.json(snapshot, {
          headers: {
            "Cache-Control": EDGE_CACHE_CONTROL.publicPage,
            "Cache-Tag": mergeTags([siteTag(snapshot.siteId), snapTag(snapshot.siteId)]).join(","),
          },
        });
      } catch {
        return new Response(null, { status: 503, headers: { "Cache-Control": EDGE_CACHE_CONTROL.private } });
      }
    }

    const inner = new Request(request);
    inner.headers.set("x-cms-variant", variantKey);
    const { honoFetch } = await import("../index");
    const response = await honoFetch(inner, perfstageEnv(this.env), this.ctx);
    return applyEdgeCacheHeaders(response, {
      siteId: siteKey,
      path: pathname,
      extraTags: request.headers.get("x-cms-tags")?.split(","),
    });
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
