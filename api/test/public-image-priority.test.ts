import { afterEach, beforeEach, describe, expect, it } from "vitest";
import publicRouter from "../src/public/router";
import { renderLayout } from "../src/public/templates/layout";
import { parseHtml, type MiniNode } from "./helpers/mini-dom";
import { addSite, createDb, env, type SqliteDb } from "./helpers/x06-a2-sqlite";

const hostname = "journal.example";
const origin = `https://${hostname}`;
const outside = "https://photos.example/media/lead.jpg?edition=1&view=wide";
const local = "/media/lead.jpg?edition=1&view=wide";

function onlyHighPriorityImage(doc: MiniNode): MiniNode {
  const hints = doc.querySelectorAll(
    'img[fetchpriority="high"], link[rel="preload"][as="image"][fetchpriority="high"]',
  );
  expect(hints).toHaveLength(1);
  return hints[0]!;
}

describe("image priority on the public routes", () => {
  let sqlite: SqliteDb;

  beforeEach(() => {
    sqlite = createDb();
    addSite(sqlite, "journal", "Journal", "travel");
    sqlite.prepare("INSERT INTO domains (site_id, hostname, status) VALUES ('journal', ?, 'active')").run(hostname);
    sqlite.prepare(`INSERT INTO site_settings (site_id, key, value) VALUES
      ('journal', 'logo_media_id', 'logo.png'), ('journal', 'hero_image_media_id', 'brand/banner.jpg')`).run();
    sqlite.prepare("INSERT INTO categories (id, slug, name) VALUES (701, 'guides', 'Guides')").run();
    sqlite.prepare("INSERT INTO tags (id, site_id, slug, name) VALUES (701, 'journal', 'guides', 'Guides')").run();
    const media = sqlite.prepare(`INSERT INTO media (id, site_id, filename, storage_key, mime_type, alt_text)
      VALUES (?, 'journal', ?, ?, 'image/jpeg', ?)`);
    const article = sqlite.prepare(`INSERT INTO articles
      (id, site_id, slug, title, content_json, category_id, status, published_at, featured_image_id)
      VALUES (?, 'journal', ?, ?, '{}', 701, 'published', ?, ?)`);
    const tag = sqlite.prepare("INSERT INTO article_tags (article_id, tag_id) VALUES (?, 701)");
    for (const [id, slug] of [[3, "lead"], [2, "second"], [1, "third"]] as const) {
      media.run(id, `${slug}.jpg`, `${slug}.jpg`, slug);
      article.run(id, slug, slug, 1700000000 + id, id);
      tag.run(id);
    }
  });
  afterEach(() => sqlite.close());

  async function visit(path: string): Promise<MiniNode> {
    const response = await publicRouter.request(origin + path, {}, { ...env(sqlite), EDGE_INNER: "1" });
    expect(response.status).toBe(200);
    return parseHtml(await response.text());
  }

  it.each([
    [local, `/cdn-cgi/image/width=1600,quality=78,format=auto${local}`],
    [outside, outside],
  ])("preloads the exact CSS hero URL for %s", async (source, expected) => {
    sqlite.prepare("UPDATE media SET storage_key = ? WHERE id = 3").run(source);
    const doc = await visit("/");
    const preload = onlyHighPriorityImage(doc);
    expect(preload).toBe(doc.querySelector('head link[rel="preload"][as="image"]'));
    expect(preload.getAttribute("href")).toBe(expected);
    expect(doc.querySelector(".hero-bg")?.getAttribute("style")).toContain(`url(${expected})`);
  });

  it("gives the first pictured Editor's Pick priority on a gradient-only home", async () => {
    sqlite.prepare("UPDATE articles SET featured_image_id = NULL WHERE slug = 'lead'").run();
    const doc = await visit("/");
    expect(doc.querySelector(".hero-bg")?.hasAttribute("style")).toBe(false);
    expect(doc.querySelector('link[rel="preload"][as="image"]')).toBeNull();
    const pick = onlyHighPriorityImage(doc);
    expect(pick).toBe(doc.querySelector(".picks-grid img"));
    expect(pick.getAttribute("loading")).toBe("eager");
  });

  it.each(["/category/guides", "/tag/guides"])("%s prioritizes the first card image", async (path) => {
    const doc = await visit(path);
    const cards = doc.querySelectorAll(".card-img img");
    expect(cards.map((img) => img.getAttribute("alt"))).toEqual(["lead", "second", "third"]);
    expect(onlyHighPriorityImage(doc)).toBe(cards[0]);
    expect(cards.map((img) => img.getAttribute("loading"))).toEqual(["eager", "lazy", "lazy"]);
  });

  it.each(["/category/guides", "/tag/guides"])("%s keeps later cards lazy when the first card has a placeholder", async (path) => {
    sqlite.prepare("UPDATE articles SET featured_image_id = NULL WHERE slug = 'lead'").run();
    const doc = await visit(path);
    expect(doc.querySelector(".card-img .ph")).not.toBeNull();
    const images = doc.querySelectorAll(".card-img img");
    expect(images.map((img) => img.getAttribute("alt"))).toEqual(["second", "third"]);
    expect(doc.querySelector('[fetchpriority="high"]')).toBeNull();
    expect(images.map((img) => img.getAttribute("loading"))).toEqual(["lazy", "lazy"]);
  });

  it("gives only the article hero high priority", async () => {
    const doc = await visit("/article/lead");
    const hero = onlyHighPriorityImage(doc);
    expect(hero).toBe(doc.querySelector(".article-hero-img img"));
    expect(hero.getAttribute("loading")).toBe("eager");
  });
});

describe("Open Graph image URL", () => {
  const resized = `${origin}/cdn-cgi/image/width=1200,fit=scale-down,format=auto${local}`;
  it.each([
    [local, resized],
    [`https://JOURNAL.example:443${local}`, resized],
    [`//${hostname}${local}`, resized],
    [outside, outside],
    [`//photos.example${local}`, `//photos.example${local}`],
    [`http://${hostname}${local}`, `http://${hostname}${local}`],
    [`${origin}:8443${local}`, `${origin}:8443${local}`],
    ["/assets/photo.jpg", `${origin}/assets/photo.jpg`],
  ])("selects the share URL for %s", (image, expected) => {
    const doc = parseHtml(renderLayout({
      site: { hostname, name: "Journal" }, meta: { title: "Guides", ogImage: image }, body: "",
    }));
    expect(doc.querySelector('meta[property="og:image"]')?.getAttribute("content")).toBe(expected);
  });
});
