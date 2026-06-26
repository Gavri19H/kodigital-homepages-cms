// rescue-6 (agent-readiness M1.1): renderLayout must advertise the RSS + Atom
// feeds via <link rel="alternate"> on every public page so readers and agents
// discover them from the <head> without guessing the path. The feed URLs are
// absolute and built from the resolved TENANT host (never the admin host).
import { describe, it, expect } from "vitest";
import { renderLayout } from "../src/public/templates/layout";

const BASE = {
  site: { name: "Demo Site", hostname: "demo.example" },
  meta: {
    title: "Home",
    description: "A demo tagline",
    canonicalUrl: "https://demo.example/",
  },
  body: "<p>hi</p>",
};

describe("renderLayout feed auto-discovery (agent-readiness M1.1)", () => {
  it("advertises RSS + Atom feeds via <link rel=alternate> with absolute tenant-host URLs", () => {
    const html = renderLayout(BASE);
    expect(html).toContain('rel="alternate" type="application/rss+xml"');
    expect(html).toContain('href="https://demo.example/feed.xml"');
    expect(html).toContain('rel="alternate" type="application/atom+xml"');
    expect(html).toContain('href="https://demo.example/atom.xml"');
  });

  it("never points the feed links at a non-tenant (admin) host", () => {
    const html = renderLayout(BASE);
    expect(html).not.toContain("cms.kodigital.app/feed.xml");
    expect(html).not.toContain("cms.kodigital.app/atom.xml");
  });
});
