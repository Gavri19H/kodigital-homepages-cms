import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import app, { ProviderConfigurationAuthority } from "../src/index";

const coreWranglerConfig = readFileSync(
  new URL("../../../kodigital-conversions/wrangler.jsonc", import.meta.url),
  "utf8",
);

describe("CMS provider configuration Worker entrypoint", () => {
  it("keeps the main CMS handler and the named service-binding entrypoint export", () => {
    expect(typeof app.fetch).toBe("function");
    expect(typeof ProviderConfigurationAuthority).toBe("function");
    expect(typeof ProviderConfigurationAuthority.prototype.fetch).toBe("function");
  });

  it("matches both Core production and staging service-binding declarations", () => {
    expect(coreWranglerConfig.match(/"binding": "CMS_PROVIDER_AUTHORITY"/gu)).toHaveLength(2);
    expect(coreWranglerConfig.match(/"entrypoint": "ProviderConfigurationAuthority"/gu)).toHaveLength(2);
    expect(coreWranglerConfig).toContain('"service": "kodigital-homepages-cms-worker"');
    expect(coreWranglerConfig).toContain('"service": "kodigital-homepages-cms-worker-staging"');
  });
});
