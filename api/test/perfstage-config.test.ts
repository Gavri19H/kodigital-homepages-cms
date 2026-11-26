import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkInfraContract } from "../scripts/verify/infra-contract";
import { checkWorkerConfig, tableBodies } from "../scripts/verify/worker-config";

const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const perfstageD1 = "a3fe7c6b-1bff-4b07-8a7c-a783401ab4ce";
const productionD1 = "caa649b9-128e-4912-97c8-3e3d4a394800";
const perfstageKv = "356e20e0b4f14177a0e814ebe87e04ee";
const productionKv = "77bb281de4fb4008a06b0993eb8b1774";

function expectRejected(original: string, replacement: string, section: string): void {
  const changed = toml.replace(original, replacement);
  expect(changed).not.toBe(toml);
  expect(checkWorkerConfig(changed).map(failure => failure.block)).toContain(`[${section}]`);
  expect(checkInfraContract(changed).map(failure => failure.name)).toContain(section);
}

describe("perfstage deployment contract", () => {
  it("passes both verifiers for the real Worker configuration", () => {
    expect(checkWorkerConfig(toml)).toEqual([]);
    expect(checkInfraContract(toml)).toEqual([]);
  });

  it.each([
    ["ADMIN_ALLOW_IP", "", "192.0.2.207"],
    ["SITE_PROVISIONING_DRY_RUN", "true", "false"],
    ["SITE_PROVISIONING_ALLOW_ROUTE_MUTATION", "false", "true"],
  ])("rejects an unsafe perfstage value for %s", (key, safe, unsafe) => {
    const block = "[env.perfstage.vars]";
    const [vars = ""] = tableBodies(toml, block);
    const changed = toml.replace(vars, vars.replace(`${key} = "${safe}"`, `${key} = "${unsafe}"`));
    expect(changed).not.toBe(toml);
    expect(checkWorkerConfig(changed)).toContainEqual({
      block,
      key,
      reason: `expected "${safe}", got "${unsafe}"`,
    });
  });

  it("rejects the production D1 ID in the perfstage DB binding", () => {
    expectRejected(perfstageD1, productionD1, "[env.perfstage.d1_databases]");
  });

  it("rejects the production KV ID in the perfstage CACHE binding", () => {
    expectRejected(perfstageKv, productionKv, "[env.perfstage.kv_namespaces]");
  });

  it("rejects sharing the perfstage KV namespace from production", () => {
    const production = '[[env.production.kv_namespaces]]\nbinding = "CACHE"\nid = ';
    expectRejected(production + `"${productionKv}"`, production + `"${perfstageKv}"`, "[env.perfstage.kv_namespaces]");
  });

  it.each([
    ["workers.dev disabled", "workers_dev = true", "workers_dev = false", "env.perfstage"],
    ["a custom route", "workers_dev = true", 'workers_dev = true\nroute = "example.test/*"', "env.perfstage.routes"],
    ["a route table", "[env.perfstage.vars]", '[[env.perfstage.routes]]\npattern = "example.test/*"\n[env.perfstage.vars]', "env.perfstage.routes"],
    ["an inherited route", "[version_metadata]", 'routes = ["example.test/*"]\n[version_metadata]', "env.perfstage.routes"],
    ["a service", "workers_dev = true\nservices = []", 'workers_dev = true\nservices = [{ binding = "CORE", service = "core" }]', "env.perfstage"],
    ["the wrong app environment", 'APP_ENV = "perfstage"', 'APP_ENV = "staging"', "env.perfstage.vars"],
    ["a disabled perfstage flag", 'PERFSTAGE = "true"', 'PERFSTAGE = "false"', "env.perfstage.vars"],
    ["a disabled cache", "[env.perfstage.cache]\nenabled = true", "[env.perfstage.cache]\nenabled = false", "env.perfstage.cache"],
    ["a missing gateway export", "[env.perfstage.exports.default]", "[env.perfstage.exports.Other]", "env.perfstage.exports.default"],
    ["a missing PublicPage export", "[env.perfstage.exports.PublicPage]", "[env.perfstage.exports.Other]", "env.perfstage.exports.PublicPage"],
  ])("rejects %s", (_case, original, replacement, section) => {
    expectRejected(original, replacement, section);
  });

  it.each(["", "env.staging.", "env.production.", "env.perfstage."])(
    "requires CF_VERSION_METADATA in [%sversion_metadata]", prefix => {
      const name = `${prefix}version_metadata`;
      expectRejected(`[${name}]\nbinding = "CF_VERSION_METADATA"`, `[${name}]\nbinding = "WRONG"`, name);
    },
  );

  it("requires version metadata when a named environment is added", () => {
    expectRejected("[env.perfstage]", "[env.preview]\nworkers_dev = true\n\n[env.perfstage]", "env.preview.version_metadata");
  });
});
