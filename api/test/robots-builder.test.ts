// rescue-6 (agent-readiness M1.1): unit coverage for buildRobotsTxt — the
// default Content-Signal preference line and the opt-in per-crawler training
// block (the `ai_block_training` lever the /robots.txt route wires in).
import { describe, it, expect } from "vitest";
import { buildRobotsTxt } from "../src/public/sitemap";

describe("buildRobotsTxt (agent-readiness M1.1)", () => {
  it("default body states the Content-Signal preference and does NOT hard-block training bots", () => {
    const body = buildRobotsTxt("https://example.test");
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Allow: /");
    expect(body).toContain("Disallow: /admin/");
    expect(body).toContain("Disallow: /api");
    expect(body).toContain("Content-Signal: search=yes, ai-input=yes, ai-train=no");
    expect(body).toContain("Sitemap: https://example.test/sitemap.xml");
    expect(body).not.toContain("User-agent: GPTBot");
  });

  it("blockTrainingCrawlers appends a named Disallow group per training-only crawler + opt-out token", () => {
    const body = buildRobotsTxt("https://example.test", {
      blockTrainingCrawlers: true,
    });
    for (const bot of [
      "GPTBot",
      "ClaudeBot",
      "CCBot",
      "Bytespider",
      "meta-externalagent",
      "Google-Extended",
      "Applebot-Extended",
    ]) {
      expect(body).toContain(`User-agent: ${bot}`);
    }
    expect(body).toContain("Disallow: /");
    // the wildcard group + content-signal + sitemap remain intact
    expect(body).toContain("Content-Signal: search=yes, ai-input=yes, ai-train=no");
    expect(body).toContain("Sitemap: https://example.test/sitemap.xml");
  });

  it("trailing-slash baseUrl is normalised in the Sitemap line", () => {
    const body = buildRobotsTxt("https://example.test/");
    expect(body).toContain("Sitemap: https://example.test/sitemap.xml");
    expect(body).not.toContain("https://example.test//sitemap.xml");
  });
});
