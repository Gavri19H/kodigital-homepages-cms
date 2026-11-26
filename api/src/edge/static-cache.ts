import { LEADGEN_TEMPLATE_VERSION } from "../cache/cache-keys";
import type { Env } from "../env";
import { PUBLIC_FONT_FILES } from "../public/assets/public-fonts.generated";
import { sha256Hex } from "../public/leadgen/auction/parse";
import { LEADGEN_FONT_FILES } from "../public/leadgen/designs/fonts.generated";
import { LEADGEN_RUNTIME_JS } from "../public/leadgen/runtime/engine-bundle.generated";
import { leadgenPublicRouter } from "../public/leadgen/runtime-routes";
import publicRouter from "../public/router";
import { currentPublicAssetPath, PUBLIC_CSS_PATH, PUBLIC_JS_PATH } from "../public/templates/layout";
import { isAdminHost } from "../site/site-context";

type HonoFetch = (request: Request, env: Env, ctx?: ExecutionContext) => Response | Promise<Response>;

const runtimePath = `/lg/runtime/${LEADGEN_TEMPLATE_VERSION}.js`;
const assetPaths = [
  runtimePath, PUBLIC_CSS_PATH, PUBLIC_JS_PATH, ...PUBLIC_FONT_FILES.keys(), ...LEADGEN_FONT_FILES.keys(),
];
const assetSetHash = sha256Hex(assetPaths.join("\n"));
const hostAssetFills = new Map<string, Promise<void> | true>();
const legacyFontPaths = new Set([
  ...Array.from(PUBLIC_FONT_FILES.keys(), path => path.replace("/lg/runtime/fonts/", "/assets/fonts/")),
  ...Array.from(LEADGEN_FONT_FILES.keys(), path => path.replace("/lg/runtime/lgfonts/", "/lg/fonts/")),
]);

export function seedStaticAssets(origin: string, env: Env): Promise<void> | undefined {
  if (typeof caches === "undefined") return;
  const memoKey = origin + "/" + assetSetHash;
  const existing = hostAssetFills.get(memoKey);
  if (existing === true) return;
  if (existing) return existing;

  const fill = Promise.allSettled(assetPaths.map(async path => {
    const key = origin + path;
    const cache = caches.default;
    const hit = await cache.match(key);
    if (hit) {
      void hit.body?.cancel().catch(() => {});
      return;
    }
    // The font and public bundle handlers are local and run before site lookup.
    // Build the quote runtime directly to avoid its site-specific middleware.
    const router = LEADGEN_FONT_FILES.has(path) ? leadgenPublicRouter : publicRouter;
    const response = path === runtimePath ? new Response(LEADGEN_RUNTIME_JS, {
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    }) : await router.request(key, undefined, env);
    if (response.status !== 200) throw new Error("Missing static asset " + path);
    await cache.put(key, response);
  })).then(results => {
    // Finish all writes before releasing waiting pages. A later page retries
    // a partial fill and its matches preserve the successful entries.
    if (results.some(result => result.status === "rejected")) hostAssetFills.delete(memoKey);
    else hostAssetFills.set(memoKey, true);
  });
  hostAssetFills.set(memoKey, fill);
  return fill;
}

export async function serveStatic(
  request: Request, env: Env, ctx: ExecutionContext | undefined, honoFetch: HonoFetch,
): Promise<Response | null> {
  const head = request.method === "HEAD";
  if ((!head && request.method !== "GET") || typeof caches === "undefined") return null;

  const url = new URL(request.url);
  const versionedPath = currentPublicAssetPath(url);
  if (!versionedPath && !legacyFontPaths.has(url.pathname) &&
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
