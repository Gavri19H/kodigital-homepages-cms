// Analytics ingest router. Mounted at "/" BEFORE publicRouter (see
// src/index.ts) so POST /api/track is not swallowed by publicRouter's /:slug
// catch-all.
//
// POST /api/track is a fire-and-forget beacon: it accepts either a single
// event object or {events:[...]} (capped at 20/request), enriches each event
// with server-side signals (ip / ua / device / os / site / received_at),
// validates the event type, and ALWAYS responds 204 — a malformed body, an
// unknown event type, or a firehose hiccup can never error the beacon.

import { Hono } from "hono";
import type { Env } from "../env";
import { emitEvents, parseDeviceOs, type HomepageEvent } from "./events";

const analyticsRouter = new Hono<{ Bindings: Env }>();

// The 3 event types the Athena schema accepts.
const ALLOWED_EVENTS: ReadonlySet<string> = new Set<string>([
  "page_view",
  "impression",
  "click",
]);

// Max events accepted per request (cheap abuse / payload-size bound).
const MAX_EVENTS_PER_REQUEST = 20;

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// Resolve the `site` for an event: prefer the request Host header, else fall
// back to the event url's hostname, else empty string.
function resolveSite(hostHeader: string, url: string): string {
  if (hostHeader.length > 0) return hostHeader;
  if (url.length > 0) {
    try {
      return new URL(url).hostname;
    } catch {
      // url not absolute / malformed -> no site.
    }
  }
  return "";
}

analyticsRouter.post("/api/track", async (c) => {
  // Server-side enrichment signals (read once per request).
  const ip = c.req.header("cf-connecting-ip") ?? "";
  const ua = c.req.header("user-agent") ?? "";
  const hostHeader = c.req.header("host") ?? "";

  // Parse the body defensively — any failure falls through to a 204 so the
  // beacon never errors.
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.body(null, 204);
  }

  // Accept a single event object OR {events:[...]}.
  let incoming: unknown[];
  if (Array.isArray(raw)) {
    incoming = raw;
  } else if (
    raw !== null &&
    typeof raw === "object" &&
    Array.isArray((raw as { events?: unknown }).events)
  ) {
    incoming = (raw as { events: unknown[] }).events;
  } else if (raw !== null && typeof raw === "object") {
    incoming = [raw];
  } else {
    return c.body(null, 204);
  }

  const capped = incoming.slice(0, MAX_EVENTS_PER_REQUEST);
  const events: HomepageEvent[] = [];

  for (const item of capped) {
    if (item === null || typeof item !== "object") continue;
    const payload = item as Record<string, unknown>;

    const event = asString(payload.event);
    if (!ALLOWED_EVENTS.has(event)) continue; // drop unknown / missing types

    const url = asString(payload.url);

    // device / os come from the payload when present, otherwise derived from
    // the server-observed User-Agent.
    let device = asString(payload.device);
    let os = asString(payload.os);
    if (device.length === 0 || os.length === 0) {
      const derived = parseDeviceOs(ua);
      if (device.length === 0) device = derived.device;
      if (os.length === 0) os = derived.os;
    }

    // advertiser only meaningful for impressions; empty string otherwise.
    const advertiser =
      event === "impression" ? asString(payload.advertiser) : "";

    events.push({
      session_id: asString(payload.session_id),
      site: resolveSite(hostHeader, url),
      url,
      referer: asString(payload.referer),
      ua,
      ip,
      device,
      os,
      event,
      advertiser,
      received_at: Date.now(),
    });
  }

  // Fire-and-forget to firehose (no-op when creds/stream absent). emitEvents
  // never throws into the request path.
  emitEvents(c.env, c.executionCtx, events);

  return c.body(null, 204);
});

export { analyticsRouter };
export default analyticsRouter;
