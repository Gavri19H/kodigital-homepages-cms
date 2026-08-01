import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import app, { ProviderConfigurationAuthority } from "../src/index";
import { HAS_CONVERSIONS_CORE, coreUrl } from "./helpers/conversions-core-root";

describe("CMS provider configuration Worker entrypoint", () => {
  it("keeps the main CMS handler and the named service-binding entrypoint export", () => {
    expect(typeof app.fetch).toBe("function");
    expect(typeof ProviderConfigurationAuthority).toBe("function");
    expect(typeof ProviderConfigurationAuthority.prototype.fetch).toBe("function");
  });

  // SKIPPED WITHOUT A CONVERSIONS CORE CHECKOUT. Core is a separate repository
  // and CI checks out only this one. What the skip costs: the proof that Core's
  // OWN wrangler.jsonc still declares the CMS_PROVIDER_AUTHORITY service binding
  // at the ProviderConfigurationAuthority entrypoint for BOTH of its
  // environments — i.e. that the export asserted above is still the one Core
  // binds to. Nothing in this repo can substitute for Core's real config; the
  // assertions below are unchanged and run verbatim whenever Core is present
  // (set CONVERSIONS_CORE_ROOT=<path to kodigital-conversions> to force it).
  it.skipIf(!HAS_CONVERSIONS_CORE)(
    "matches both Core production and staging service-binding declarations",
    () => {
      const coreWranglerConfig = readFileSync(coreUrl("wrangler.jsonc"), "utf8");
      expect(coreWranglerConfig.match(/"binding": "CMS_PROVIDER_AUTHORITY"/gu)).toHaveLength(2);
      expect(coreWranglerConfig.match(/"entrypoint": "ProviderConfigurationAuthority"/gu)).toHaveLength(2);
      expect(coreWranglerConfig).toContain('"service": "kodigital-homepages-cms-worker"');
      expect(coreWranglerConfig).toContain('"service": "kodigital-homepages-cms-worker-staging"');
    },
  );
});
