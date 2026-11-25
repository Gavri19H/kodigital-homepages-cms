import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { ThemeFontId } from "../src/public/leadgen/designs/theme";
import leadgenRouter from "../src/public/leadgen/runtime-routes";
import { buildEnv, makeFakeDb } from "./helpers/admin-test-kit";
import { ctxCapture } from "./helpers/leadgen-analytics-harness";
import { addSite, createDb, env } from "./helpers/x06-a2-sqlite";

// SHA-256 of the decoded, pre-migration @font-face sources.
const originals = [
  ["Poppins", 400, "7d93459d86585bfcdbb7e0376056226adb25821ee54b96236fe2123e9560929f"],
  ["Poppins", 600, "f4e80d9dfd374d02989b87a27b5ed4cb78fbb177c27f1478e9a8b0afb7513149"],
  ["Poppins", 700, "9338e65fc077355c7a87ae0d64cc101e23b9bf8ad78ae65f0f319c857311b526"],
  ["Space Grotesk", 400, "65fd17fcbd2e2f522940b5f67ead3d23329e02891aa5495e74d11a499c0b0673"],
  ["Space Grotesk", 700, "35f8aec56cfd5cbfdb03cc68733a54a0b05bb3617ffcd5fd332badc0b045ca55"],
  ["Fraunces", 400, "e558f39453a9c611908be04294b50dea5f21ae6c49b41c6e47f4115e91f90209"],
  ["Fraunces", 700, "c38570d224b830056e69484bb9e768e1d3fa7ba4755c8891a3c6d366194d2ff3"],
  ["Playfair Display", 400, "1fe9ad5d8b2ebd8ecb8fbd05bed1e3fdfa52dae3f1a04e1c219918442fe9394d"],
  ["Playfair Display", 700, "28453852ea165c47b5a941be00e418402e1407002ed87507f062a1e316328fe6"],
  ["Manrope", 400, "849290ef12a2eeb9af5c11924120d11aa4ae8b435ed3347d7fc8bc240c293ca3"],
  ["Manrope", 700, "d2a12c85a831e4b5db341767d0347fa3d1361d22a1fcb3e361a16b6c90080f71"],
  ["DM Sans", 400, "4ab51eb2cd7305d177187908d6397474d4520663f6c6e572feb0a64f4fa80006"],
  ["DM Sans", 700, "35c5efa0e5daa52ee5c6500f5be354bf751fb65c4e49e1d6806c6eb5883e8fe9"],
  ["Work Sans", 400, "418b06936717d2e9b6c7a1fb61acb7e2f40030be4b230452f96505230e7b6b41"],
  ["Work Sans", 600, "c536b548fdcb2734cdc97e0ff0bf26e6719a8b067856d7021971f52ed53a874e"],
  ["Lexend", 400, "0601e0a909219a542cdd581e3f8f1ff8fb208978cbc9bca1c90df02fd8062bb1"],
  ["Lexend", 600, "c3c291158a48c5172383ec8febb21ca64075b7c9d8413553683b254a247efdda"],
] as const;
const fonts = originals.map(([family, weight, sha256]) => ({
  family, weight, sha256,
  path: `/lg/runtime/lgfonts/${family.toLowerCase().replaceAll(" ", "-")}-${weight}.${sha256.slice(0, 16)}.woff2`,
}));
const origin = "https://font-test.example";
const immutable = "public, max-age=31536000, immutable";
const noSite = makeFakeDb();
const fontEnv = buildEnv(noSite.db);

async function renderShell(display: ThemeFontId, body: ThemeFontId): Promise<string> {
  const db = createDb();
  const site = "font-test";
  const id = (prefix: string) => prefix + "_" + "1".padStart(26, "0");
  try {
    addSite(db, site, "Home Insurance", "health");
    db.prepare("INSERT INTO domains (site_id, hostname, status) VALUES (?, ?, 'active')").run(site, new URL(origin).hostname);
    db.prepare(`INSERT INTO leadgen_quotes (id, public_id, quote_name, activity, verticals_json, status)
      VALUES (1, ?, 'Home Insurance', 'quote_funnel', '[]', 'active')`).run(id("lgq"));
    db.prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug) VALUES (?, 1, 1, 'home-insurance')").run(site);
    db.prepare(`INSERT INTO leadgen_funnels (id, public_id, quote_id, funnel_name, status, theme_json)
      VALUES (1, ?, 1, 'Home', 'active', ?)`).run(id("lgf"), JSON.stringify({ typography: { display, body } }));
    db.prepare(`INSERT INTO leadgen_funnel_variants (id, public_id, funnel_id, variant_label, traffic_allocation_bp)
      VALUES (1, ?, 1, 'A', 10000)`).run(id("lgn"));
    db.prepare(`INSERT INTO leadgen_sections (id, public_id, section_name, activity, vertical, headline_text, content_json)
      VALUES (1, ?, 'Home', 'quote_funnel', 'health', 'Do you own your home?', ?)`).run(id("lgs"),
      JSON.stringify({ components: [{ type: "QuestionHeadline", question_id: "q_home", bind: "section_headline" }] }));
    db.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (1, 1, 0)").run();
    const response = await leadgenRouter.request(origin + "/lg/home-insurance", {
      headers: { "x-cms-variant": "lg:" + id("lgn") },
    }, { ...env(db), EDGE_INNER: "1" });
    expect(response.status).toBe(200);
    return await response.text();
  } finally {
    db.close();
  }
}

function fontPreloads(html: string): string[] {
  const head = html.slice(0, html.indexOf("</head>"));
  return (head.match(/<link\b[^>]*>/g) ?? []).filter(tag => tag.includes('rel="preload"') && tag.includes('as="font"'));
}

afterEach(() => {
  vi.unstubAllGlobals();
  expect(noSite.calls.splice(0)).toEqual([]);
});

describe("quote funnel font files", () => {
  it("renders only the two selected families and preloads the display headline's exact face", async () => {
    const html = await renderShell("poppins", "manrope");
    expect(html).toContain("Do you own your home?");
    expect(html).not.toMatch(/data:font|fonts\.(?:googleapis|gstatic)\.com/i);
    const faces = html.match(/@font-face\{[^}]+\}/g) ?? [];
    const selected = fonts.filter(font => font.family === "Poppins" || font.family === "Manrope");
    expect(faces).toHaveLength(selected.length);
    for (const { family, weight, path } of selected) {
      const face = faces.find(rule => rule.includes(`src:url("${path}") format("woff2")`));
      expect(face, path).toContain(`font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap`);
    }
    const preloads = fontPreloads(html);
    const displayPath = selected.find(font => font.family === "Poppins" && font.weight === 600)!.path;
    expect(preloads).toHaveLength(1);
    expect(preloads[0]).toContain(`href="${displayPath}"`);
    expect(preloads[0]).toContain('type="font/woff2"');
    expect(preloads[0]).toMatch(/\scrossorigin(?:="anonymous")?(?=\s|>)/);
  });

  it("uses the available 700 for a display family without 600, even when body and display match", async () => {
    const html = await renderShell("space_grotesk", "space_grotesk");
    expect(html.match(/@font-face\{/g)).toHaveLength(2);
    const preloads = fontPreloads(html);
    expect(preloads).toHaveLength(1);
    expect(preloads[0]).toContain('/lg/runtime/lgfonts/space-grotesk-700.35f8aec56cfd5cbf.woff2');
  });

  it("omits the preload when only the body uses a self-hosted family", async () => {
    const html = await renderShell("system", "manrope");
    expect(html).toContain("/lg/runtime/lgfonts/manrope-400.");
    expect(fontPreloads(html)).toEqual([]);
  });

  it.each(fonts)("serves the original $family $weight WOFF2 with an immutable lifetime", async ({ path, sha256 }) => {
    for (const url of [path, path.replace("/lg/runtime/lgfonts/", "/lg/fonts/")]) {
      const res = await worker.fetch(new Request(origin + url), fontEnv);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("font/woff2");
      expect(res.headers.get("Cache-Control")).toBe(immutable);
      expect(createHash("sha256").update(new Uint8Array(await res.arrayBuffer())).digest("hex")).toBe(sha256);
    }
  });

  it("serves the same font to a sandboxed Studio preview on the admin host", async () => {
    const res = await worker.fetch(new Request(`https://${fontEnv.ADMIN_HOST}${fonts[0]!.path}`, {
      headers: { Origin: "null" },
    }), fontEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(createHash("sha256").update(new Uint8Array(await res.arrayBuffer())).digest("hex")).toBe(fonts[0]!.sha256);
  });

  it("rejects an unknown legacy name or wrong hash without consulting the static cache", async () => {
    const match = vi.fn();
    vi.stubGlobal("caches", { default: { match } });
    for (const name of ["poppins-400.0000000000000000.woff2", "unknown-400.7d93459d86585bfc.woff2"]) {
      const res = await worker.fetch(new Request(origin + "/lg/fonts/" + name), fontEnv);
      expect(res.status).toBe(404);
      expect(res.headers.get("Cache-Control") ?? "").not.toContain("immutable");
    }
    expect(match).not.toHaveBeenCalled();
  });

  it("checks the shared runtime cache before returning a no-store 404 for an unknown font hash", async () => {
    const match = vi.fn().mockResolvedValue(undefined);
    const put = vi.fn();
    vi.stubGlobal("caches", { default: { match, put } });
    const url = origin + "/lg/runtime/lgfonts/poppins-400.0000000000000000.woff2";
    const res = await worker.fetch(new Request(url), fontEnv);
    expect(new Request(match.mock.calls[0]![0]).url).toBe(url);
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(put).not.toHaveBeenCalled();
  });

  it("fills the edge cache once and reuses the full font across requests", async () => {
    const files = new Map<string, Response>();
    const match = vi.fn<Cache["match"]>(async key => files.get(new Request(key).url)?.clone());
    const put = vi.fn<Cache["put"]>(async (key, response) => { files.set(new Request(key).url, response); });
    vi.stubGlobal("caches", { default: { match, put } });
    const { ctx, promises } = ctxCapture();
    const url = origin + fonts[0]!.path;
    const cold = await worker.fetch(new Request(url), fontEnv, ctx);
    expect(cold.headers.get("x-edge-cache")).toBe("MISS");
    await Promise.all(promises);
    const warm = await worker.fetch(new Request(url + "?visit=2"), fontEnv, ctx);
    expect(warm.headers.get("x-edge-cache")).toBe("HIT");
    expect(await warm.arrayBuffer()).toEqual(await cold.arrayBuffer());
    expect(put).toHaveBeenCalledTimes(1);
    expect([...files.keys()]).toEqual([url]);
  });
});
