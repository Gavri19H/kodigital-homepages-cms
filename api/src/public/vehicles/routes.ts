// F18 Vehicle database: the two public lookups (plan Section 3, part D).
//
//   GET /api/vehicles/v1/{snapshot}/makes            → every make in the snapshot (L1)
//   GET /api/vehicles/v1/{snapshot}/makes/{make_id}  → that make's models and model years (L2 + L3)
//
// Read-only, public, no personal data. Each answer is a ready-made file from
// R2 (binding MEDIA), returned as stored. Every address carries the snapshot
// id and a snapshot never changes, so a found answer is cached for a year as
// immutable — in the browser and in this data center's cache (caches.default),
// which is checked before R2. A new snapshot means new addresses, so no purge
// is ever needed. Mounted on every host before the admin-host safety net, so
// the funnel calls it on its own domain (no extra DNS / TLS / CORS) and the
// Studio preview works on the admin host too.

import { Hono, type Context } from "hono";
import type { Env } from "../../env";
import { MEDIA_CACHE_CONTROL } from "../../media/serve";
import { isSnapshotId, parseMakeIdParam, vehicleMakeKey, vehicleMakesKey } from "../../leadgen/vehicles/format";
import { readVehicleFileText } from "../../leadgen/vehicles/store";

const ERROR_CACHE_CONTROL = "public, max-age=60";

type VehicleContext = Context<{ Bindings: Env }>;

function jsonError(error: string, status: 400 | 404 | 503): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status === 404 ? ERROR_CACHE_CONTROL : "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function edgeCache(): Cache | null {
  try {
    return typeof caches !== "undefined" && caches.default ? caches.default : null;
  } catch {
    return null;
  }
}

/** Cache key: the address without its query string, so ?anything can't split or poison the cache. */
function cacheKeyOf(url: string): Request {
  const u = new URL(url);
  u.search = "";
  u.hash = "";
  return new Request(u.toString(), { method: "GET" });
}

function stripQuotes(etag: string): string {
  return etag.replace(/^W\//, "").replace(/^"|"$/g, "");
}

async function serveFile(c: VehicleContext, key: string, onMissing: () => Promise<Response>): Promise<Response> {
  const cache = edgeCache();
  const cacheKey = cacheKeyOf(c.req.url);
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return withConditional(c, hit);
    } catch {
      // A cache failure only costs an R2 read.
    }
  }
  const file = await readVehicleFileText(c.env, key);
  if (!file) return onMissing();
  const res = new Response(file.text, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": MEDIA_CACHE_CONTROL,
      ETag: file.etag,
      "X-Content-Type-Options": "nosniff",
    },
  });
  if (cache) {
    const put = cache.put(cacheKey, res.clone()).catch(() => undefined);
    try {
      c.executionCtx.waitUntil(put);
    } catch {
      // No execution context (tests): the put still runs.
    }
  }
  return withConditional(c, res);
}

function withConditional(c: VehicleContext, res: Response): Response {
  const inm = c.req.header("If-None-Match");
  const etag = res.headers.get("ETag");
  if (inm && etag && inm.split(",").some((t) => stripQuotes(t.trim()) === stripQuotes(etag))) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": MEDIA_CACHE_CONTROL },
    });
  }
  return res;
}

export const vehiclesPublicRouter = new Hono<{ Bindings: Env }>();

vehiclesPublicRouter.get("/api/vehicles/v1/:snapshot/makes", async (c) => {
  const snapshot = c.req.param("snapshot");
  if (!isSnapshotId(snapshot)) return jsonError("unknown_snapshot", 404);
  return serveFile(c, vehicleMakesKey(snapshot), async () => jsonError("unknown_snapshot", 404));
});

vehiclesPublicRouter.get("/api/vehicles/v1/:snapshot/makes/:make_id", async (c) => {
  const snapshot = c.req.param("snapshot");
  const makeId = parseMakeIdParam(c.req.param("make_id"));
  if (makeId === null) return jsonError("invalid_param", 400);
  if (!isSnapshotId(snapshot)) return jsonError("unknown_snapshot", 404);
  return serveFile(c, vehicleMakeKey(snapshot, makeId), async () => {
    // Tell an unknown make apart from an unknown snapshot.
    const makes = await readVehicleFileText(c.env, vehicleMakesKey(snapshot));
    return jsonError(makes ? "unknown_make" : "unknown_snapshot", 404);
  });
});
