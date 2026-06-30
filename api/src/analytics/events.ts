// User-interaction analytics events for the homepage CMS.
//
// Mirrors the reference analytics pipeline: client JS -> worker
// POST /api/track -> AWS Kinesis Firehose (stream `homepage-events`, us-east-1)
// -> S3 -> Athena table `homepage.events`. The event JSON keys below are the
// EXACT lowercase Athena column names — do NOT rename them.
//
// The whole firehose path is fire-and-forget: emitEvents never throws into the
// request path, and is a no-op when AWS creds / stream are absent (tests, local
// dev). The beacon response is decoupled from delivery success.

import { sendToFirehose } from "./firehose";
import type { Env } from "../env";

// One row in the Athena `homepage.events` table. Keys MUST stay exactly these
// lowercase names — they map 1:1 to the Athena schema. All fields are strings
// except `received_at` (epoch ms, Number).
export interface HomepageEvent {
  session_id: string;
  site: string;
  url: string;
  referer: string;
  ua: string;
  ip: string;
  device: string;
  os: string;
  event: string;
  // Set only for impressions; empty string otherwise.
  advertiser: string;
  // Epoch milliseconds (Date.now()).
  received_at: number;
}

// Derive a coarse device class + OS family from a User-Agent string using
// simple, order-sensitive heuristics. device ∈ {mobile,tablet,desktop,bot};
// os ∈ {ios,android,windows,macos,linux,other}. Defaults: desktop / other.
export function parseDeviceOs(ua: string): { device: string; os: string } {
  const s = typeof ua === "string" ? ua.toLowerCase() : "";

  // OS family. iOS is checked before macOS (iPad/iPhone UAs also say "mac os")
  // and Android before Linux (Android UAs also contain "linux").
  let os = "other";
  if (/iphone|ipad|ipod/.test(s)) {
    os = "ios";
  } else if (/android/.test(s)) {
    os = "android";
  } else if (/windows/.test(s)) {
    os = "windows";
  } else if (/mac os|macintosh/.test(s)) {
    os = "macos";
  } else if (/linux|x11|cros/.test(s)) {
    os = "linux";
  }

  // Device class. Bots first (a crawler UA may also contain "mobile"), then
  // tablet before mobile (an iPad UA contains neither "mobile" nor "android"
  // in the phone sense), then phones, default desktop.
  let device = "desktop";
  if (/bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headless/.test(s)) {
    device = "bot";
  } else if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(s)) {
    device = "tablet";
  } else if (/mobi|iphone|ipod|android.*mobile|phone/.test(s)) {
    device = "mobile";
  }

  return { device, os };
}

// Build the firehose config from env and, when creds + stream are present,
// dispatch the batch on ctx.waitUntil so delivery runs in the background
// without blocking the beacon response. No-op (and never throws) otherwise.
export function emitEvents(
  env: Env,
  ctx: ExecutionContext,
  events: HomepageEvent[],
): void {
  if (events.length === 0) return;

  const accessKeyId = env.AWS_ACCESS_KEY_ID ?? "";
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY ?? "";
  const streamName = env.EVENTS_FIREHOSE_STREAM ?? "";
  // No creds or no stream configured -> nothing to do (tests / local dev).
  if (!accessKeyId || !secretAccessKey || !streamName) return;

  const config = {
    accessKeyId,
    secretAccessKey,
    region: env.AWS_REGION ?? "us-east-1",
    streamName,
  };

  try {
    // sendToFirehose already swallows its own errors; the extra catch on the
    // promise + the try around waitUntil guarantee a delivery failure can never
    // surface in the request path.
    ctx.waitUntil(
      sendToFirehose(config, events).catch((err) => {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(`[analytics] firehose dispatch failed: ${message.substring(0, 500)}`);
      }),
    );
  } catch {
    // waitUntil can be unavailable in some contexts; tracking must never break
    // the request, so we deliberately drop the batch rather than throw.
  }
}
