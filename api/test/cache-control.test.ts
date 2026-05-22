import { describe, it, expect } from "vitest";
import {
  publicHtmlCacheHeaders,
  adminCacheHeaders,
  feedCacheHeaders,
  robotsAdsCacheHeaders,
  offAdminHostHeaders,
  notFoundCacheHeaders,
  CACHE_CONTROL_VALUES,
} from "../src/cache/cache-control";

// Wire literals — the AC1/AC2/AC3 greps assert these exact strings in
// the module source; the tests assert that they're the actual header
// values returned at runtime (so a future "tidy" refactor that swaps
// the constants doesn't silently change the wire shape).
const PUBLIC_SWR = "public, max-age=300, stale-while-revalidate=86400";
const ADMIN_NO_STORE = "private, no-store";
const ROBOTS_ADS = "public, max-age=3600";
const NOT_FOUND_60 = "public, max-age=60";

describe("cache-control: publicHtmlCacheHeaders", () => {
  it("sets the public/max-age=300/SWR Cache-Control value", () => {
    const h = publicHtmlCacheHeaders();
    expect(h.get("Cache-Control")).toBe(PUBLIC_SWR);
  });

  it("always sets X-Content-Type-Options: nosniff", () => {
    const h = publicHtmlCacheHeaders();
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("defaults Content-Type to text/html; charset=utf-8", () => {
    const h = publicHtmlCacheHeaders();
    expect(h.get("Content-Type")).toBe("text/html; charset=utf-8");
  });

  it("threads through the ETag option when provided", () => {
    const h = publicHtmlCacheHeaders({ etag: '"abc1234567890def"' });
    expect(h.get("ETag")).toBe('"abc1234567890def"');
  });

  it("omits ETag when the option is absent", () => {
    const h = publicHtmlCacheHeaders();
    expect(h.get("ETag")).toBeNull();
  });

  it("allows overriding Content-Type (e.g. text/plain for ASCII variants)", () => {
    const h = publicHtmlCacheHeaders({ contentType: "text/plain; charset=utf-8" });
    expect(h.get("Content-Type")).toBe("text/plain; charset=utf-8");
  });
});

describe("cache-control: adminCacheHeaders", () => {
  it("sets Cache-Control: private, no-store (no caching by intermediaries)", () => {
    const h = adminCacheHeaders();
    expect(h.get("Cache-Control")).toBe(ADMIN_NO_STORE);
  });

  it("sets X-Robots-Tag: noindex, nofollow so admin URLs stay out of search", () => {
    const h = adminCacheHeaders();
    expect(h.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("always sets X-Content-Type-Options: nosniff", () => {
    const h = adminCacheHeaders();
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("does not emit a public Cache-Control directive", () => {
    const h = adminCacheHeaders();
    expect(h.get("Cache-Control")).not.toContain("public");
  });
});

describe("cache-control: feedCacheHeaders", () => {
  it("uses the same public/SWR Cache-Control as HTML (T12 contract)", () => {
    const h = feedCacheHeaders();
    expect(h.get("Cache-Control")).toBe(PUBLIC_SWR);
  });

  it("defaults Content-Type to application/xml; charset=utf-8", () => {
    const h = feedCacheHeaders();
    expect(h.get("Content-Type")).toBe("application/xml; charset=utf-8");
  });

  it("threads through the ETag option when provided", () => {
    const h = feedCacheHeaders({ etag: '"feed-etag-abcd"' });
    expect(h.get("ETag")).toBe('"feed-etag-abcd"');
  });

  it("allows overriding Content-Type (e.g. application/atom+xml)", () => {
    const h = feedCacheHeaders({ contentType: "application/atom+xml; charset=utf-8" });
    expect(h.get("Content-Type")).toBe("application/atom+xml; charset=utf-8");
  });

  it("always sets X-Content-Type-Options: nosniff", () => {
    const h = feedCacheHeaders();
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("cache-control: robotsAdsCacheHeaders", () => {
  it("uses public/max-age=3600 (longer than HTML — settings_version rarely bumps)", () => {
    const h = robotsAdsCacheHeaders();
    expect(h.get("Cache-Control")).toBe(ROBOTS_ADS);
  });

  it("defaults Content-Type to text/plain; charset=utf-8", () => {
    const h = robotsAdsCacheHeaders();
    expect(h.get("Content-Type")).toBe("text/plain; charset=utf-8");
  });

  it("always sets X-Content-Type-Options: nosniff", () => {
    const h = robotsAdsCacheHeaders();
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("cache-control: offAdminHostHeaders", () => {
  it("returns private, no-store so off-host /admin can't be cached anywhere", () => {
    const h = offAdminHostHeaders();
    expect(h.get("Cache-Control")).toBe(ADMIN_NO_STORE);
  });

  it("sets X-Robots-Tag: noindex (no need for nofollow on a stub)", () => {
    const h = offAdminHostHeaders();
    expect(h.get("X-Robots-Tag")).toBe("noindex");
  });

  it("always sets X-Content-Type-Options: nosniff", () => {
    const h = offAdminHostHeaders();
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("cache-control: notFoundCacheHeaders (non-AC helper)", () => {
  it("uses public/max-age=60 to limit 404-storm DB impact", () => {
    const h = notFoundCacheHeaders();
    expect(h.get("Cache-Control")).toBe(NOT_FOUND_60);
  });

  it("always sets X-Content-Type-Options: nosniff", () => {
    const h = notFoundCacheHeaders();
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("cache-control: CACHE_CONTROL_VALUES wire literals", () => {
  it("exposes the canonical Cache-Control values as a const map", () => {
    expect(CACHE_CONTROL_VALUES.publicHtml).toBe(PUBLIC_SWR);
    expect(CACHE_CONTROL_VALUES.admin).toBe(ADMIN_NO_STORE);
    expect(CACHE_CONTROL_VALUES.feed).toBe(PUBLIC_SWR);
    expect(CACHE_CONTROL_VALUES.robotsAds).toBe(ROBOTS_ADS);
    expect(CACHE_CONTROL_VALUES.notFound).toBe(NOT_FOUND_60);
    expect(CACHE_CONTROL_VALUES.offAdmin).toBe(ADMIN_NO_STORE);
  });
});
