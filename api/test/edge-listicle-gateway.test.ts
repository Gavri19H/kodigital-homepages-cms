import { readFileSync, writeFileSync } from "node:fs";
import { Hono } from "hono";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { buildListicleGatewayOutput, injectListicleGateway } from "../src/edge/listicle-gateway";
import { buildListicleSnapshot, pickListicle } from "../src/edge/listicle-select";
import type { GatewayRequestInput } from "../src/edge/types";
import { publicSiteContextMiddleware, type PublicSiteVariables } from "../src/public/middleware";
import { readCookie } from "../src/public/listicle/experiment-pick";
import { SELECTOR_SCRIPT_MARKER } from "../src/public/listicle/runtime";
import { tryServePublishedListicle } from "../src/public/listicle/serve";
import { addSite, createDb, env, type SqliteDb } from "./helpers/x06-a2-sqlite";

const fixture = new URL("./fixtures/listicle-gateway-golden.json", import.meta.url);
const nowMs = Date.parse("2026-11-24T05:37:42.123Z");
const mintedSid = "6bcfd486-e75e-46ff-8510-000000000001";
const sites = {
  west: { siteTimeZone: " America/Los_Angeles ", siteLanguage: "" },
  east: { siteTimeZone: "Asia/Tokyo", siteLanguage: " ja " },
};
const routes = [
  { id: 11, site: "west", slug: "guide", experiment: "running" },
  { id: 12, site: "east", slug: "guide", experiment: null },
  { id: 13, site: "west", slug: "stopped", experiment: "stopped" },
  { id: 14, site: "east", slug: "no-arms", experiment: "running" },
  { id: 15, site: "east", slug: "no-control", experiment: null },
] as const;

function seed(db: SqliteDb): void {
  const domain = db.prepare("INSERT INTO domains (hostname, site_id, status) VALUES (?, ?, 'active')");
  const setting = db.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?)");
  for (const [site, { siteTimeZone, siteLanguage }] of Object.entries(sites)) {
    addSite(db, site, site, "home");
    domain.run(site + ".example", site);
    setting.run(site, "site_timezone", siteTimeZone);
    setting.run(site, "site_language", siteLanguage);
  }
  const article = db.prepare(
    `INSERT INTO listicle_articles (id, public_id, site_id, slug, article_name, status, active_experiment_id)
     VALUES (?, ?, ?, ?, 'Fixture', ?, ?)`,
  );
  const experiment = db.prepare(
    "INSERT INTO listicle_article_experiments (id, public_id, article_id, name, status) VALUES (?, ?, ?, 'Split', ?)",
  );
  for (const route of routes) {
    article.run(route.id, "art_" + route.id, route.site, route.slug, "published", route.experiment && route.id);
    if (route.experiment) experiment.run(route.id, "exp_" + route.id, route.id, route.experiment);
  }
  const version = db.prepare(
    `INSERT INTO listicle_article_versions
       (article_id, public_id, experiment_id, variant_label, is_control, traffic_allocation, status, headline, intro_paragraph)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Headline', 'Intro')`,
  );
  version.run(11, "ver_outside", null, "Outside", 0, 100, "active");
  version.run(11, "ver_archived", 11, "Archived", 0, 100, "archived");
  version.run(11, "ver_Z", 11, "Z", 0, 35, "active");
  version.run(11, "ver_A", 11, "A", 1, 65, "active");
  version.run(12, "ver_east", null, "Control", 1, 100, "active");
  version.run(13, "ver_stopped_B", 13, "B", 0, 90, "active");
  version.run(13, "ver_stopped_A", 13, "A", 1, 10, "active");
  version.run(14, "ver_inactive_arm", 14, "Old", 0, 100, "archived");
  version.run(14, "ver_fallback", null, "Fallback", 1, 80, "active");
  version.run(15, "ver_first", null, "Z", 0, 25, "active");
  version.run(15, "ver_second", null, "A", 0, 75, "active");

  for (const [index, status] of ["draft", "scheduled", "archived", "published"].entries()) {
    const id = 21 + index;
    article.run(id, "art_" + id, "west", "excluded-" + id, status, null);
    version.run(id, "ver_" + id, null, "A", 1, 100, status === "published" ? "archived" : "active");
  }
}

interface RequestShape {
  name: string;
  site: keyof typeof sites;
  url: string;
  headers: Record<string, string>;
  cf: GatewayRequestInput["cf"];
}

interface GoldenRecord extends RequestShape {
  setCookies: string[];
  contextScript: string;
}

function requestShapes(): RequestShape[] {
  const prior = "ko_ctx=" + encodeURIComponent(JSON.stringify({
    utm_source: "old", traffic_source: "original", fbc: "fb.1.123.old", sub2: "kept", language: "nl",
    lander_v: "ver_previous",
  }));
  const desktop = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0.0.0 Safari/537.36 Edg/129.0";
  const mobile = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Version/17.5 Mobile/15E148 Safari/604.1";
  const visitors: {
    name: string; query?: string; headers?: Record<string, string>; cf?: GatewayRequestInput["cf"];
  }[] = [
    { name: "first visit" },
    {
      name: "mobile ad landing",
      query: "utm_source=feed&utm_medium=cpc&utm_content=spring+sale&fbclid=F9&sub1=one&sub2=2&sub3=3&sub4=4&sub5=5&lang=es-MX",
      headers: { "User-Agent": mobile, "Accept-Language": "it-IT" },
      cf: { country: "US", region: "California", regionCode: "CA", city: "San José", timezone: "Pacific/Honolulu" },
    },
    {
      name: "returning desktop",
      headers: { Cookie: "ko_ver=obsolete; ko_sid=desktop-1", "User-Agent": desktop, "Accept-Language": "de-DE,de;q=0.8" },
      cf: { country: "DE", region: "Bavaria", city: "München" },
    },
    {
      name: "internal navigation",
      headers: { Cookie: "ko_sid=return-2; " + prior, "Accept-Language": "sv-SE" },
    },
    {
      name: "new campaign over stored context",
      query: "utm_source=new&fbclid=new-click&sub1=fresh&sub2=&lang=fr",
      headers: { Cookie: prior + "; ko_sid=return-3", "User-Agent": mobile },
    },
    {
      name: "explicit attribution and language",
      query: "traffic_source=paid&utm_source=email&placement=story&cpc=0.45&fbc=fb.1.456.given&fbclid=independent&lang=it&language=he",
      headers: { Cookie: "ko_sid=return-4", "Accept-Language": "tr" },
      cf: { country: "IL", regionCode: "", region: "Tel Aviv", city: "Tel Aviv" },
    },
    {
      name: "repeated and encoded parameters",
      query: "utm%5Fsource=first&utm_source=second&sub1=a+b%2Bc&sub2=%E4%ZZ&language=&lang=skipped",
      headers: { Cookie: "ko_sid=first-sid; ko_sid=second-sid", "Accept-Language": "pt-BR;q=0.9,en" },
    },
    {
      name: "empty session and corrupt context",
      query: "fbclid=click-on-return",
      headers: { Cookie: "ko_sid=; ko_ctx=%E0%A4%A", "Accept-Language": "*;q=0.9" },
    },
    {
      name: "unicode session and inline script escaping",
      query: "utm_content=%3C%2Fscript%3E&sub3=%24%26&placement=caf%C3%A9",
      headers: { Cookie: "ko_sid=" + encodeURIComponent("visité/日"), "User-Agent": desktop },
      cf: { country: "JP", regionCode: "13", city: "東京" },
    },
    {
      name: "encoded prior context and clamped value",
      query: "sub5=" + "x".repeat(205),
      headers: { Cookie: "ko_ctx=" + encodeURIComponent('{"sub4":"a%2Bb","language":"fr-CA"}') + "; ko_sid=last; " + prior },
    },
  ];
  return routes.flatMap(({ site, slug }) => visitors.map(({ name, query, headers, cf }) => ({
    name: `${site}/${slug} — ${name}`, site,
    url: `https://${site}.example/${slug}` + (query ? "?" + query : ""),
    headers: headers ?? {}, cf: cf ?? {},
  })));
}

// GOLDEN_WRITE=1 runs the existing renderer. Only its response supplies the expected bytes.
async function recordGoldens(bindings: Env): Promise<GoldenRecord[]> {
  bindings.DB.batch = <T>(statements: D1PreparedStatement[]) => Promise.all(statements.map(s => s.all<T>()));
  const cache = new Map<string, string>();
  Object.assign(bindings.CACHE, {
    async getWithMetadata(key: string) { return { value: cache.get(key) ?? null, metadata: null }; },
    async put(key: string, value: string) { cache.set(key, value); },
  });
  const app = new Hono<{ Bindings: Env; Variables: PublicSiteVariables }>();
  app.use(publicSiteContextMiddleware);
  app.get("/:slug", async (c) => (await tryServePublishedListicle(c)) ?? c.notFound());
  const records: GoldenRecord[] = [];
  for (const shape of requestShapes()) {
    const request = new Request(shape.url, { headers: shape.headers });
    Object.defineProperty(request, "cf", { value: shape.cf });
    const response = await app.request(request, undefined, bindings);
    expect(response.status, shape.name).toBe(200);
    const body = await response.text();
    const contextScript = body.match(/<script data-lst="ctx">[\s\S]*?<\/script>/)?.[0];
    if (!contextScript) throw new Error("Missing listicle context for " + shape.name);
    expect(body).toContain(contextScript + SELECTOR_SCRIPT_MARKER);
    expect([...cache.values()]).toContain(body.replace(contextScript, ""));
    records.push({ ...shape, setCookies: response.headers.getSetCookie(), contextScript });
  }
  return records;
}

if (process.env.GOLDEN_WRITE === "1") {
  it("records 50 requests to tryServePublishedListicle", async () => {
    const db = createDb();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(nowMs);
    const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue(mintedSid);
    try {
      seed(db);
      const records = await recordGoldens(env(db));
      expect(records).toHaveLength(50);
      writeFileSync(fixture, JSON.stringify(records, null, 2) + "\n");
    } finally {
      uuid.mockRestore();
      vi.useRealTimers();
      db.close();
    }
  });
} else {
  describe("gateway parity with tryServePublishedListicle", () => {
    const records: GoldenRecord[] = JSON.parse(readFileSync(fixture, "utf8"));
    const snapshots: Record<string, Record<string, unknown>> = {};
    beforeAll(async () => {
      const db = createDb();
      try {
        seed(db);
        const { DB } = env(db);
        for (const site of Object.keys(sites)) {
          snapshots[site] = JSON.parse(JSON.stringify(await buildListicleSnapshot(DB, site)));
        }
      } finally {
        db.close(); // Every pick and response below runs from the serialized snapshot alone.
      }
    });

    it("covers all 50 request shapes and both running arms", () => {
      expect(records).toHaveLength(50);
      expect(records.map(({ setCookies, contextScript, ...shape }) => shape)).toEqual(requestShapes());
      const versions = records.filter((record) => record.url.startsWith("https://west.example/guide"))
        .flatMap((record) => record.setCookies.filter((cookie) => cookie.startsWith("ko_ver=")))
        .map((cookie) => readCookie(cookie, "ko_ver"));
      expect(new Set(versions)).toEqual(new Set(["ver_Z", "ver_A"]));
    });

    it.each(records)("$name", async (record) => {
      const url = new URL(record.url);
      const headers = new Headers(record.headers);
      const cookies = {
        ko_sid: readCookie(headers.get("Cookie"), "ko_sid"),
        ko_ctx: readCookie(headers.get("Cookie"), "ko_ctx"),
      };
      const sid = cookies.ko_sid || mintedSid;
      const pick = pickListicle(snapshots[record.site]![url.pathname.slice(1)], sid);
      expect(pick).not.toBeNull();
      const { setCookies, contextScript } = buildListicleGatewayOutput({
        pick: pick!, input: { url, headers, cookies, cf: record.cf, nowMs, sid },
        sidWasAbsent: cookies.ko_sid === "", ...sites[record.site],
      });
      expect(setCookies).toEqual(record.setCookies);
      expect(contextScript).toBe(record.contextScript);

      const before = "<html><head><title>Listicle</title>";
      const after = SELECTOR_SCRIPT_MARKER + "select()</script></head><body>Cached</body></html>";
      const shell = new Response(before + after, { headers: { ETag: '"version"', "cf-cache-status": "HIT" } });
      const visitor = injectListicleGateway(shell.clone(), contextScript);
      expect(await visitor.text()).toBe(before + record.contextScript + after);
      expect(visitor.headers.get("ETag")).toBe('"version"');
      expect(visitor.headers.get("cf-cache-status")).toBe("HIT");
      expect(await shell.text()).toBe(before + after);
      expect(shell.headers.has("Set-Cookie")).toBe(false);
    });

    it("includes only servable listicles in their own tenant", () => {
      expect(Object.keys(snapshots.west!).sort()).toEqual(["guide", "stopped"]);
      expect(Object.keys(snapshots.east!).sort()).toEqual(["guide", "no-arms", "no-control"]);
      for (const { site, slug, id } of routes) {
        expect(pickListicle(snapshots[site]![slug], mintedSid)?.listicleId).toBe("art_" + id);
      }
    });

    it("returns null for incomplete controls, experiments and arms", () => {
      const publishedVersion = { public_id: "ver_A", variant_label: "A", is_control: 1, traffic_allocation: 100 };
      const entry = { listicleId: "art_11", publishedVersion, experiment: null };
      const malformed = [
        undefined, null, [], {}, { ...entry, listicleId: "" }, { ...entry, publishedVersion: null },
        { ...entry, publishedVersion: { ...publishedVersion, public_id: "" } }, { ...entry, experiment: {} },
        { ...entry, experiment: { publicId: "", versions: [] } },
        { ...entry, experiment: { publicId: "exp_11", versions: [publishedVersion, null] } },
        { ...entry, experiment: { publicId: "exp_11", versions: [{ ...publishedVersion, traffic_allocation: "50" }] } },
      ];
      for (const value of malformed) expect(pickListicle(value, mintedSid)).toBeNull();
    });

    it("uses the closing head or the start of a marker-less Node shell", async () => {
      const script = records[0]!.contextScript;
      expect(await injectListicleGateway(new Response("<head></head>"), script).text()).toBe("<head>" + script + "</head>");
      expect(await injectListicleGateway(new Response("shell"), script).text()).toBe(script + "shell");
      const conditional = injectListicleGateway(new Response(null, { status: 304 }), script);
      expect(conditional.status).toBe(304);
      expect(conditional.body).toBeNull();
    });
  });
}
