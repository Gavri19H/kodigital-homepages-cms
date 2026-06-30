// Unit tests for the analytics events module + the inline tracking script.
//   - parseDeviceOs heuristics across representative User-Agent strings.
//   - emitEvents is a no-op (no throw, no network) when AWS creds are absent.
//   - ANALYTICS_TRACKING_SCRIPT carries the contract markers (/api/track,
//     ko_sid, page_view).

import { describe, it, expect } from "vitest";
import { parseDeviceOs, emitEvents, type HomepageEvent } from "../src/analytics/events";
import { ANALYTICS_TRACKING_SCRIPT } from "../src/analytics/tracking-script";
import type { Env } from "../src/env";

const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const UA_ANDROID_PHONE =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const UA_IPAD =
  "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1";
const UA_WINDOWS_DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const UA_MAC_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const UA_LINUX_DESKTOP =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const UA_GOOGLEBOT =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

describe("parseDeviceOs", () => {
  it("classifies an iPhone as mobile / ios", () => {
    expect(parseDeviceOs(UA_IPHONE)).toEqual({ device: "mobile", os: "ios" });
  });

  it("classifies an Android phone as mobile / android", () => {
    expect(parseDeviceOs(UA_ANDROID_PHONE)).toEqual({
      device: "mobile",
      os: "android",
    });
  });

  it("classifies an iPad as tablet / ios", () => {
    expect(parseDeviceOs(UA_IPAD)).toEqual({ device: "tablet", os: "ios" });
  });

  it("classifies a Windows desktop as desktop / windows", () => {
    expect(parseDeviceOs(UA_WINDOWS_DESKTOP)).toEqual({
      device: "desktop",
      os: "windows",
    });
  });

  it("classifies a Mac desktop as desktop / macos", () => {
    expect(parseDeviceOs(UA_MAC_DESKTOP)).toEqual({
      device: "desktop",
      os: "macos",
    });
  });

  it("classifies a Linux desktop as desktop / linux", () => {
    expect(parseDeviceOs(UA_LINUX_DESKTOP)).toEqual({
      device: "desktop",
      os: "linux",
    });
  });

  it("classifies Googlebot as a bot", () => {
    expect(parseDeviceOs(UA_GOOGLEBOT).device).toBe("bot");
  });

  it("defaults to desktop / other for an empty or unknown UA", () => {
    expect(parseDeviceOs("")).toEqual({ device: "desktop", os: "other" });
    expect(parseDeviceOs("some-random-client/1.0")).toEqual({
      device: "desktop",
      os: "other",
    });
  });
});

describe("emitEvents (creds absent)", () => {
  // Capturing ExecutionContext (mirrors the provisioning-async test helper).
  function makeCtx(): { ctx: ExecutionContext; scheduled: Promise<unknown>[] } {
    const scheduled: Promise<unknown>[] = [];
    const ctx = {
      waitUntil(p: Promise<unknown>) {
        scheduled.push(p);
      },
      passThroughOnException() {},
    };
    return { ctx: ctx as unknown as ExecutionContext, scheduled };
  }

  const sampleEvent: HomepageEvent = {
    session_id: "s1",
    site: "example.com",
    url: "https://example.com/",
    referer: "",
    ua: "ua",
    ip: "1.2.3.4",
    device: "desktop",
    os: "other",
    event: "page_view",
    advertiser: "",
    received_at: 123,
  };

  it("is a no-op (no throw, nothing scheduled) when AWS creds/stream are absent", () => {
    const env = {} as Env; // no AWS_* / EVENTS_FIREHOSE_STREAM
    const { ctx, scheduled } = makeCtx();
    expect(() => emitEvents(env, ctx, [sampleEvent])).not.toThrow();
    expect(scheduled).toHaveLength(0);
  });

  it("does not schedule when there are no events", () => {
    const env = {
      AWS_ACCESS_KEY_ID: "AKIA",
      AWS_SECRET_ACCESS_KEY: "secret",
      EVENTS_FIREHOSE_STREAM: "homepage-events",
    } as Env;
    const { ctx, scheduled } = makeCtx();
    expect(() => emitEvents(env, ctx, [])).not.toThrow();
    expect(scheduled).toHaveLength(0);
  });

  it("schedules a background dispatch when creds + stream are present", () => {
    const env = {
      AWS_ACCESS_KEY_ID: "AKIA",
      AWS_SECRET_ACCESS_KEY: "secret",
      AWS_REGION: "us-east-1",
      EVENTS_FIREHOSE_STREAM: "homepage-events",
    } as Env;
    const { ctx, scheduled } = makeCtx();
    expect(() => emitEvents(env, ctx, [sampleEvent])).not.toThrow();
    expect(scheduled).toHaveLength(1);
  });
});

describe("ANALYTICS_TRACKING_SCRIPT", () => {
  it("is a self-contained <script> tag", () => {
    expect(ANALYTICS_TRACKING_SCRIPT.startsWith("<script>")).toBe(true);
    expect(ANALYTICS_TRACKING_SCRIPT.endsWith("</script>")).toBe(true);
  });

  it("posts to /api/track", () => {
    expect(ANALYTICS_TRACKING_SCRIPT).toContain("/api/track");
  });

  it("resolves the ko_sid session cookie", () => {
    expect(ANALYTICS_TRACKING_SCRIPT).toContain("ko_sid");
  });

  it("fires a page_view event", () => {
    expect(ANALYTICS_TRACKING_SCRIPT).toContain("page_view");
  });

  it("wires GPT impressionViewable -> impression", () => {
    expect(ANALYTICS_TRACKING_SCRIPT).toContain("impressionViewable");
    expect(ANALYTICS_TRACKING_SCRIPT).toContain("impression");
  });

  it("does NOT contain a backtick (safe for verbatim embedding)", () => {
    expect(ANALYTICS_TRACKING_SCRIPT).not.toContain("`");
  });
});
