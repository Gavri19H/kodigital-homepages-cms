import { LEADGEN_TEMPLATE_VERSION } from "../cache/cache-keys";
import type { Env } from "../env";
import { PUBLIC_FONT_FILES } from "../public/assets/public-fonts.generated";
import { LEADGEN_FONT_FILES } from "../public/leadgen/designs/fonts.generated";
import { LEADGEN_RUNTIME_JS } from "../public/leadgen/runtime/engine-bundle.generated";
import { currentPublicAssetPath } from "../public/templates/layout";
import { isAdminHost } from "../site/site-context";

type HonoFetch = (request: Request, env: Env, ctx?: ExecutionContext) => Response | Promise<Response>;

const seededRuntimes = new Set<string>();

export function seedLeadgenRuntime(origin: string, ctx: ExecutionContext): void {
  if (typeof caches === "undefined") return;
  const key = `${origin}/lg/runtime/${LEADGEN_TEMPLATE_VERSION}.js`;
  if (seededRuntimes.has(key)) return;
  // Claim the key before the lookup so overlapping shells schedule only one fill.
  seededRuntimes.add(key);
  ctx.waitUntil((async () => {
    try {
      const cache = caches.default;
      if (await cache.match(key)) return;
      // Older Workers can read this entry even when their runtime route returns 404.
      await cache.put(key, new Response(LEADGEN_RUNTIME_JS, {
        headers: {
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        },
      }));
    } catch {
      // A failed cache operation leaves the next shell free to try again.
      seededRuntimes.delete(key);
    }
  })());
}

export async function serveStatic(
  request: Request, env: Env, ctx: ExecutionContext | undefined, honoFetch: HonoFetch,
): Promise<Response | null> {
  const head = request.method === "HEAD";
  if ((!head && request.method !== "GET") || typeof caches === "undefined") return null;

  const url = new URL(request.url);
  const versionedPath = currentPublicAssetPath(url);
  if (!versionedPath && !PUBLIC_FONT_FILES.has(url.pathname) && !LEADGEN_FONT_FILES.has(url.pathname) &&
      !url.pathname.startsWith("/media/") && !url.pathname.startsWith("/lg/runtime/") &&
      !/^\/assets\/public\.[a-z0-9]+\.(?:css|js)$/.test(url.pathname)) return null;
  if (isAdminHost(url.hostname, env)) return null;

  const cache = caches.default;
  const key = url.origin + (versionedPath ?? url.pathname);
  // Cache API matches GET keys and uses the visitor's validators and Range on reads.
  const hit = await cache.match(new Request(key, { headers: request.headers }));
  let response = hit;
  if (!response) {
    // Hono suppresses the body of HEAD responses. Fill the shared GET key with the full file.
    response = await honoFetch(head ? new Request(request, { method: "GET" }) : request, env, ctx);
    const control = response.headers.get("Cache-Control") ?? "";
    if (ctx && response.status === 200 && !response.headers.has("Set-Cookie") &&
        /(?:^|,)\s*immutable\s*(?:,|$)/i.test(control) &&
        !/(?:^|,)\s*(?:private|no-store|no-cache)\b/i.test(control)) {
      ctx.waitUntil(cache.put(key, response.clone()));
    }
  }

  const outgoing = new Response(head ? null : response.body, response);
  if (head) void response.body?.cancel();
  outgoing.headers.set("x-edge-cache", hit ? "HIT" : "MISS");
  return outgoing;
}
