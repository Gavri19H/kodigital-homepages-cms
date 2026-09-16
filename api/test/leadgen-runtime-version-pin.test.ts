// THE ENGINE BYTES AND THE IMMUTABLE URL MUST MOVE TOGETHER.
//
// /lg/runtime/{LEADGEN_TEMPLATE_VERSION}.js is served
// `max-age=31536000, immutable` (runtime-routes.ts). The shell embeds that exact
// URL. So a browser — or a CDN PoP — that already holds the bundle keeps running
// it for up to a YEAR unless the version moves. cache-keys.ts has said so since
// v2, and v3's own comment spells out the failure: "a browser holding the
// pre-v2.5 engine at an unchanged /lg/runtime/2.js (max-age=31536000, immutable)
// would run framed funnels with dead frame-back/history … for up to a year."
//
// IT HAPPENED ANYWAY, 2026-09-16. The buffering-screen change edited the engine
// (the one line that stamps data-lg-auction="pending" before the auction POST)
// and shipped WITHOUT bumping the version. Measured on production after a green
// deploy: moneylantern.com/lg/home-security was executing a cached 53181-byte
// /lg/runtime/3.js with no pending stamp, while the origin served 53233 WITH it.
// A synchronous setAttribute interception on #lg-funnel-root recorded exactly
// ONE call for the whole funnel — "unfilled" — so the buffering state never
// existed in that browser. The server-rendered half (the mount markup and the
// CSS) had shipped instantly, because both are keyed on this same constant; only
// the year-immutable engine URL stayed put. A reviewer cannot catch this by
// reading a diff: the engine file and cache-keys.ts are not obviously coupled.
//
// So the rule is now a test instead of a comment. If you changed the engine:
//   1. bump LEADGEN_TEMPLATE_VERSION (cache-keys.ts) and LG_ENGINE_VERSION,
//   2. `npm run build:leadgen-runtime`,
//   3. update RUNTIME_BUNDLE_SHA256 below to the digest this test prints.
// Doing (3) alone is the one way to defeat this pin — which is why the message
// says what it says.

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LEADGEN_RUNTIME_JS } from "../src/public/leadgen/runtime/engine-bundle.generated";
import { LEADGEN_TEMPLATE_VERSION } from "../src/cache/cache-keys";

// engine.ts is a BROWSER module (DOM globals, compiled under
// tsconfig.runtime.json). Importing it here would drag it into the main tsc
// program, which has no DOM lib — so the constant is read from its source text
// instead of imported. Same pin, no typecheck blast radius.
const ENGINE_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/public/leadgen/runtime/engine.ts"),
  "utf8",
);
const LG_ENGINE_VERSION = /export const LG_ENGINE_VERSION = "([^"]+)"/.exec(ENGINE_SRC)?.[1];

// sha256 of the committed bundle AT LEADGEN_TEMPLATE_VERSION 4.
const RUNTIME_BUNDLE_SHA256 = "53dbaf5536461928bd1fee03a86800ebe4f7bcf841f8159bdcfabef0e231cf33";
const RUNTIME_BUNDLE_VERSION = 4;

describe("the runtime bundle is pinned to its immutable URL version", () => {
  it("engine bytes unchanged, or the version moved with them", () => {
    const actual = createHash("sha256").update(LEADGEN_RUNTIME_JS, "utf8").digest("hex");
    expect(
      actual,
      [
        "",
        "The engine bundle changed.",
        `  bundle sha256: ${actual} (${LEADGEN_RUNTIME_JS.length} bytes)`,
        `  pinned sha256: ${RUNTIME_BUNDLE_SHA256}`,
        "",
        "/lg/runtime/{version}.js is served max-age=31536000, immutable. Shipping",
        "new engine bytes at an UNCHANGED version leaves every cached browser and",
        "CDN PoP running the old engine for up to a year — the deploy looks green",
        "and the change is simply absent for returning visitors.",
        "",
        "Bump LEADGEN_TEMPLATE_VERSION (cache-keys.ts) AND LG_ENGINE_VERSION,",
        "re-run `npm run build:leadgen-runtime`, then update RUNTIME_BUNDLE_SHA256",
        "and RUNTIME_BUNDLE_VERSION in this file to the values above.",
      ].join("\n"),
    ).toBe(RUNTIME_BUNDLE_SHA256);
  });

  it("the pin's version is the version actually served", () => {
    // Catches the half-update: digest refreshed, version left behind.
    expect(LEADGEN_TEMPLATE_VERSION).toBe(RUNTIME_BUNDLE_VERSION);
  });

  it("LG_ENGINE_VERSION tracks LEADGEN_TEMPLATE_VERSION", () => {
    // engine.ts's own comment says it tracks; nothing enforced it. The engine
    // reports this value on window.__LG_ENGINE__, so a drift makes the running
    // engine misreport which bundle a visitor actually has — exactly the signal
    // you reach for when diagnosing a stale-engine report.
    expect(LG_ENGINE_VERSION).toBe(String(LEADGEN_TEMPLATE_VERSION));
  });
});
