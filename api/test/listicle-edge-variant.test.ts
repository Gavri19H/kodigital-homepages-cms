import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { computeEtag } from "../src/cache/edge-cache";
import { buildListicleGatewayOutput, injectListicleGateway } from "../src/edge/listicle-gateway";
import { buildListicleSnapshot, pickListicle } from "../src/edge/listicle-select";
import type { GatewayRequestInput } from "../src/edge/types";
import type { Env } from "../src/env";
import { readCookie } from "../src/public/listicle/experiment-pick";
import { SELECTOR_SCRIPT_MARKER } from "../src/public/listicle/runtime";
import publicRouter from "../src/public/router";
import { ctxCapture } from "./helpers/leadgen-analytics-harness";
import { addSite, createDb, env, type SqliteDb } from "./helpers/x06-a2-sqlite";

const guideUrl = "https://west.example/guide";
const siteTimeZone = "America/Los_Angeles";
const nowMs = Date.parse("2026-11-24T05:37:42.123Z");
const mintedSid = "6bcfd486-e75e-46ff-8510-000000000001";

interface RecordedVisit {
  name: string;
  url: string;
  headers: Record<string, string>;
  cf: GatewayRequestInput["cf"];
  setCookies: string[];
  contextScript: string;
}
const recordedVisits: RecordedVisit[] = JSON.parse(
  readFileSync(new URL("./fixtures/listicle-gateway-golden.json", import.meta.url), "utf8"),
);

describe("edge-selected listicle versions", () => {
  let db: SqliteDb;
  let bindings: Env;

  beforeAll(() => {
    db = createDb();
    for (const site of ["west", "east"]) {
      addSite(db, site, site, "home");
      db.prepare("INSERT INTO domains (hostname, site_id, status) VALUES (?, ?, 'active')").run(site + ".example", site);
    }
    db.prepare("INSERT INTO site_settings (site_id, key, value) VALUES ('west', 'site_timezone', ?)").run(siteTimeZone);
    db.prepare(`INSERT INTO listicle_articles (id, public_id, site_id, slug, article_name, status, active_experiment_id) VALUES
      (11, 'art_11', 'west', 'guide', 'Guide', 'published', 11),
      (12, 'art_12', 'west', 'other', 'Other listicle', 'published', NULL),
      (13, 'art_13', 'east', 'guide', 'Other tenant', 'published', NULL)`).run();
    db.prepare(`INSERT INTO listicle_article_experiments (id, public_id, article_id, name, status)
      VALUES (11, 'exp_11', 11, 'Split', 'running')`).run();
    db.prepare(`INSERT INTO listicle_article_versions
      (id, public_id, article_id, experiment_id, variant_label, is_control, traffic_allocation, status, headline, intro_paragraph) VALUES
      (1, 'ver_Z', 11, 11, 'Z', 0, 35, 'active', 'Challenger headline', 'Challenger intro'),
      (2, 'ver_A', 11, 11, 'A', 1, 65, 'active', 'Control headline', 'Control intro'),
      (3, 'ver_old', 11, NULL, 'Old', 0, 0, 'archived', 'Archived headline', ''),
      (4, 'ver_other', 12, NULL, 'A', 1, 100, 'active', 'Other listicle headline', ''),
      (5, 'ver_east', 13, NULL, 'A', 1, 100, 'active', 'Other tenant headline', '')`).run();
    db.prepare(`INSERT INTO listicle_pages (id, public_id, article_version_id, page_index)
      VALUES (1, 'pg_A', 2, 0)`).run();
    db.prepare(`INSERT INTO listicle_sections (id, public_id, section_name, headline_text, content_json)
      VALUES (1, 'sec_A', 'Guide section', 'Section headline', '{"blocks":[]}')`).run();
    db.prepare(`INSERT INTO listicle_page_section_candidates (public_id, page_id, section_id)
      VALUES ('cand_A', 1, 1)`).run();
  });
  afterAll(() => db.close());

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(nowMs);
    bindings = env(db);
    const cache = new Map<string, { value: string; metadata: unknown }>();
    Object.assign(bindings.CACHE, {
      async getWithMetadata(key: string) { return cache.get(key) ?? { value: null, metadata: null }; },
      async put(key: string, value: string, options?: KVNamespacePutOptions) {
        cache.set(key, { value, metadata: options?.metadata });
      },
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("serves the chosen shell on a miss and a hit even with a different sticky pick and a matching ETag", async () => {
    const snapshot = await buildListicleSnapshot(bindings.DB, "west");
    expect(pickListicle(snapshot.guide, "return-2")?.versionPublicId).toBe("ver_A");
    const prior = encodeURIComponent(JSON.stringify({ placement: "cookie-only-placement" }));
    const etag = await computeEtag({ site_id: "west", path: "/guide:ver_Z", content_version: 1 });
    const headers = { "x-cms-variant": "lst:ver_Z", "If-None-Match": etag };
    const cold = await publicRouter.request(guideUrl + "?utm_source=query-only-source", {
      headers: { ...headers, Cookie: "ko_sid=return-2; ko_ctx=" + prior },
    }, bindings);
    expect(cold.status).toBe(200);
    expect(cold.headers.get("ETag")).toBe(etag);
    expect(cold.headers.getSetCookie()).toEqual([]);
    const html = await cold.text();
    expect(html).toContain("Challenger headline");
    expect(html).toContain('data-lander-v="ver_Z"');
    expect(html).not.toContain('<script data-lst="ctx">');
    expect(html).not.toContain("return-2");
    expect(html).not.toContain("cookie-only-placement");
    expect(html).not.toContain("query-only-source");

    const warm = await publicRouter.request(guideUrl, { headers }, bindings);
    expect(warm.status).toBe(200);
    expect(warm.headers.getSetCookie()).toEqual([]);
    expect(warm.headers.get("ETag")).toBe(etag);
    expect(await warm.text()).toBe(html);
  });

  it.each(["west/guide — mobile ad landing", "west/guide — internal navigation"])(
    "rebuilds the no-header response, including every cookie and body byte, for %s", async (name) => {
      const visit = recordedVisits.find((record) => record.name === name)!;
      const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue(mintedSid);
      const headers = new Headers(visit.headers);
      const cookies = {
        ko_sid: readCookie(headers.get("Cookie"), "ko_sid"),
        ko_ctx: readCookie(headers.get("Cookie"), "ko_ctx"),
      };
      const sid = cookies.ko_sid || mintedSid;
      const snapshot = await buildListicleSnapshot(bindings.DB, "west");
      const pick = pickListicle(snapshot.guide, sid)!;
      const inner = await publicRouter.request(guideUrl, {
        headers: { "x-cms-variant": "lst:" + pick.versionPublicId },
      }, bindings);
      expect(inner.status).toBe(200);
      expect(inner.headers.getSetCookie()).toEqual([]);
      expect(uuid).not.toHaveBeenCalled();

      const request = new Request(visit.url, { headers });
      Object.defineProperty(request, "cf", { value: visit.cf });
      const legacy = await publicRouter.fetch(request, bindings);
      const legacyBody = await legacy.text();
      expect(legacy.status).toBe(200);
      expect(legacy.headers.getSetCookie()).toEqual(visit.setCookies);
      expect(legacyBody).toContain(visit.contextScript + SELECTOR_SCRIPT_MARKER);
      expect(await inner.clone().text()).toBe(legacyBody.replace(visit.contextScript, ""));
      expect(inner.headers.get("ETag")).toBe(legacy.headers.get("ETag"));

      const { contextScript, setCookies } = buildListicleGatewayOutput({
        pick, input: { url: new URL(visit.url), headers, cookies, cf: visit.cf, nowMs, sid },
        sidWasAbsent: cookies.ko_sid === "", siteTimeZone, siteLanguage: "",
      });
      const visitor = injectListicleGateway(inner, contextScript);
      for (const cookie of setCookies) visitor.headers.append("Set-Cookie", cookie);
      expect(visitor.headers.getSetCookie()).toEqual(legacy.headers.getSetCookie());
      expect(await visitor.text()).toBe(legacyBody);
    },
  );

  it.each(["ver_unknown", "ver_old", "ver_other", "ver_east"])(
    "falls back to the visitor's own listicle and cookies for %s", async (id) => {
      const headers = { Cookie: "ko_sid=return-2" };
      const legacy = await publicRouter.request(guideUrl, { headers }, bindings);
      const variantHeaders = { ...headers, "x-cms-variant": "lst:" + id };
      const fallback = await publicRouter.request(guideUrl, { headers: variantHeaders }, bindings);
      expect(fallback.status).toBe(200);
      expect(fallback.headers.getSetCookie()).toEqual(legacy.headers.getSetCookie());
      expect(await fallback.text()).toBe(await legacy.text());
      const etag = legacy.headers.get("ETag")!;
      expect(fallback.headers.get("ETag")).toBe(etag);
      const conditional = await publicRouter.request(guideUrl, {
        headers: { ...variantHeaders, "If-None-Match": etag },
      }, bindings);
      expect(conditional.status).toBe(304);
      expect(conditional.headers.getSetCookie()).toEqual(legacy.headers.getSetCookie());
      expect(await conditional.text()).toBe("");
    },
  );

  it.each(["/guide", "/lst-cand/cand_A"])("schedules the cache write and sampled counters for %s", async (path) => {
    vi.spyOn(Math, "random").mockReturnValue(0); // Sample both the miss and the hit.
    const { ctx, promises } = ctxCapture();
    const url = new URL(path, guideUrl);
    const init = { headers: { "x-cms-variant": "lst:ver_A" } };
    expect((await publicRouter.request(url, init, bindings, ctx)).status).toBe(200);
    expect(promises).toHaveLength(2); // Miss counter and shell or fragment write.
    await Promise.all(promises);
    expect((await publicRouter.request(url, init, bindings, ctx)).status).toBe(200);
    expect(promises).toHaveLength(3); // Hit counter.
    await Promise.all(promises);
  });
});
