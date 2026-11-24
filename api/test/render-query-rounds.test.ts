import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PublicSiteContext } from "../src/public/middleware";
import { renderArticleHtml, renderHomepageHtml } from "../src/public/render-pages";
import { API_ROOT, d1FromSqlite, loadDatabaseSync, type SqliteDb } from "./helpers/leadgen-analytics-harness";

const site: PublicSiteContext = {
  siteId: "journal",
  site_id: "journal",
  hostname: "journal.example",
  vertical_slug: "travel",
  status: "active",
  content_version: 1,
  settings_version: 1,
};

function seedPages(): SqliteDb {
  const DatabaseSync = loadDatabaseSync();
  if (!DatabaseSync) throw new Error("The render query fixtures require node:sqlite");
  const sqlite = new DatabaseSync(":memory:");
  const migrations = join(API_ROOT, "migrations");
  for (const name of readdirSync(migrations).filter((file) => file.endsWith(".sql")).sort()) {
    (sqlite.exec as (sql: string) => void)(readFileSync(join(migrations, name), "utf8"));
  }
  const insertSite = sqlite.prepare(
    "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES (?, ?, ?, 'travel', 'active')",
  );
  insertSite.run(site.siteId, "Journal", site.hostname);
  insertSite.run("neighbour", "Neighbour", "neighbour.example");

  const settings = {
    site_name: "Field & Stream Journal",
    tagline: "Notes from the field",
    site_description: "Stories, maps and interviews.",
    logo_media_id: "brand/logo.svg",
    favicon_media_id: "brand/icon.png",
    brand_tokens_json: '{"--tw-brand":"#215e52","ignored":7}',
    hero_image_media_id: "brand/banner.jpg",
    newsletter_settings_json: '{"heading":"Field notes","description":"Our weekly dispatch."}',
    social_instagram_url: "https://example.org/journal",
    org_same_as: "https://example.org/journal, https://example.net/journal",
    ads_enabled: "1",
    ad_provider: "adsense",
    adsense_publisher_id: "ca-pub-1234567890123456",
    ad_unit_leaderboard: "123",
    ad_unit_in_feed: "234",
    ad_unit_rect: "345",
    custom_head_html: '<meta name="journal-edition" content="morning">',
    custom_footer_html: "<p>Filed by the night desk.</p>",
    consent_head_html: "<script>window.journalConsent=true;</script>",
  };
  const insertSetting = sqlite.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?)");
  for (const [key, value] of Object.entries(settings)) insertSetting.run(site.siteId, key, value);
  insertSetting.run("neighbour", "site_name", "Other tenant");

  const category = sqlite.prepare("INSERT INTO categories (id, slug, name, show_on_homepage) VALUES (?, ?, ?, 1)");
  const attachCategory = sqlite.prepare("INSERT INTO site_categories (site_id, category_id, display_order) VALUES (?, ?, ?)");
  category.run(701, "field-guides", "Field Guides");
  category.run(702, "dispatches", "Dispatches");
  attachCategory.run(site.siteId, 701, 2);
  attachCategory.run(site.siteId, 702, 1);

  const media = sqlite.prepare(
    "INSERT INTO media (id, site_id, filename, storage_key, mime_type, alt_text) VALUES (?, ?, ?, ?, 'image/jpeg', ?)",
  );
  const article = sqlite.prepare(
    "INSERT INTO articles (id, site_id, slug, title, subtitle, content_json, content_html, category_id, status, " +
      "published_at, updated_at, author_name, featured_image_id, is_featured, is_trending) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1735689600, 'Lee Rivers', ?, ?, ?)",
  );
  // Equal dates exercise the id tie-break. The newer draft and same-slug
  // article on a different site must stay out of both related-article lists.
  const stories = [
    [1, "journal", "ridge-walk", "Ridge Walk", 701, "published", 100],
    [2, "journal", "camp-log", "Camp Log", 701, "published", 200],
    [3, "journal", "river-notes", "River Notes", 701, "published", 200],
    [4, "journal", "by-rail", "By Rail", 702, "published", 300],
    [5, "journal", "open-road", "Open Road", null, "published", 400],
    [6, "journal", "draft", "Unpublished", 701, "draft", 500],
    [7, "neighbour", "ridge-walk", "Neighbour's story", 702, "published", 600],
  ] as const;
  for (const [id, tenant, slug, title, categoryId, status, date] of stories) {
    const filename = `${slug}-${id}.jpg`;
    media.run(id, tenant, filename, `photos/${filename}`, `${title} photo`);
    const blocks = JSON.stringify({ blocks: [
      { type: "p", text: `A dispatch from ${title}.` },
      { type: "faq", question: "What did we see?", answer: "The first light." },
    ] });
    article.run(id, tenant, slug, title, `Notes on ${title}`, blocks, `<p>${title} in the field.</p>`,
      categoryId, status, 1700000000 + date, id, Number(id === 1), Number(id === 4));
  }
  return sqlite;
}

function countReads(sqlite: SqliteDb) {
  const reads: string[][] = [];
  let wave: string[] | undefined;
  const db = d1FromSqlite({
    // The D1 shim prepares SQLite statements when first/all/run execute.
    // Binding arguments alone never counts as a read.
    prepare(sql) {
      if (!wave) {
        wave = [];
        reads.push(wave);
        // A caller awaiting a result resumes after this microtask.
        queueMicrotask(() => { wave = undefined; });
      }
      wave.push(sql);
      return sqlite.prepare(sql);
    },
    close: () => sqlite.close(),
  });
  // The harness's write batch returns only change metadata. A D1 read
  // batch returns rows for each SELECT, all dispatched in the same round.
  db.batch = <T>(statements: D1PreparedStatement[]) =>
    Promise.all(statements.map((stmt) => stmt.all<T>()));
  return { db, reads };
}

describe("public HTML cache-MISS builders", () => {
  let sqlite: SqliteDb;
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-15T00:00:00Z"));
    sqlite = seedPages();
  });
  afterAll(() => {
    sqlite?.close();
    vi.useRealTimers();
  });

  it("counts a parallel wave and a subsequent batch as two rounds", async () => {
    const { db, reads } = countReads(sqlite);
    const select = () => db.prepare("SELECT ? AS value").bind(1);
    await Promise.all([select().first(), select().all()]);
    await db.batch([select(), select()]);
    expect(reads.map((round) => round.length)).toEqual([2, 2]);
  });

  it.each(["/", "ridge-walk", "open-road"])(
    "%s builds in one D1 round and matches the pre-change HTML byte for byte",
    async (slug) => {
      const { db, reads } = countReads(sqlite);
      // These are the router's render thunks, after host resolution and the
      // article's pre-cache publication check.
      const html = slug === "/"
        ? await renderHomepageHtml(db, site)
        : await renderArticleHtml(db, site, slug);
      expect(reads).toHaveLength(1);
      expect(reads.flat().filter((sql) => sql.includes("FROM site_settings"))).toHaveLength(1);
      expect(html).toBe(preChangeHtml[slug]);
    },
  );
});

// Full UTF-8 HTML rendered at 7dfb84fc with the seed and fixed clock above.
// The three documents share their layout and ad script, so compress them
// together to keep the inline fixture small. Comparison uses the complete text.
const preChangeHtml: Record<string, string> = JSON.parse(
  brotliDecompressSync(Buffer.from(`
W0s1EUXNYKScRRRUKKD1AR3XywYKd3PyPinqN4bxQhuSjktIHkonf+1OplACcYTGPsm9X+7tdK0P01AzplOTNTmlxl/4WeKPUCU0CBfPzjSUvK2o
VBNtZdUqwCffCCx7HzZAtIF9wKMn6ptUZUqkZdOm05pTZwzi3Kkr6m3FVs+RfPRQ8H3VNq3arv4rneLQZ4ZFFCcRxg+nYOna/9m02reRYQmzzQLG
6DZKpz/Uf2pJ1rNle1DDWgCsX7+6y9aQ7QGA6Iiixew4DIDiC/KLgjas9xCD8NSNUaiWT0X9NoGAWoZq1dn/amh7sUFghhAS4NywGFNjlglZHQqI
iIiDu8f2yxBhCHPQGpiWDCq4roNVgfWAFn5taiBe2sFB+cHSlhrvMN5BphlnyD0ZQLlODULkXaekbjvBhvmQq438y+/6V6CevHl5eXcr9493kll4
jzmGeKa53EWDP3BkLNltlH9gzNFhl3lqJahAUVojiYyxFRomHNxDP4r1f/x3LAp9T73JL42Iwmw+WW9M+igNyVVQ9dPuIIueK1Y+8QQOWVDvopXf
JCKX0/rcvSUif7KDqbvN7dpbzi1xJ4wFDWVHZpwPexykdCt9n9Kkh40Ry1PxQGEhaswL2YvniesgoDF1EPY4PyC2kdaVEalGxmGind+SHI2ICUL9
iwYQkY/EkD5h47xIlTA2yqqALlPtTRNGKBZZQ5+Wz6NwUfuc1TNMj01L3NuHxrYwLs7tE1FbZTqofOBVd43NsUuNKWXuupmEsGElMTSv9cNBwoql
jiqngS8JyzqpOB6LPDMWA74sFXT8Y71HHIe+vfTKWPLqTB0FdkFqOC9aVcUT7HHW4kNTxmc7YHsK0jmYPhfRbr02NMDXlHSFXtDFrojXXjqzJOyA
gQjYk4b+qUms931UfqJ0JMRD0AN7TBBDEsLmsY4lBAcHko6u7vIUv373pkq07vbI/drjApivwHwDXLfy9OQVRe31T/uD7TevcyRfWbfX+Z4hdI0h
U9eY8y7whkze3u5kf7btwx4JusTOOMx0n4dZu/7FI9Y05XPNvg84e5MR8dLBytgtZeQ1852ww0sT1sLMNyuCnfDh6Dmi7HTusWFHMMyNIpMYaWgS
dBgGlgEnmRVfqemC7W1us73F5S2x/bk4SAkKMQHn7HC98lwn/wmTVPl9V1zn7I0AsQw89vm4Y6EQI9dOjDdfCgdEE1eYwvvS3AKK5oXH0NAaecr3
C38KQkYEkeiQi/+GzYcJGVx+x36lKwyJgBEKsr25uZJbzd6uckQH72AfEMm+wuIaJmCtJdtU4uYfqnZ4PxfiuHgScUvIZw3ok0+Jgnrb2nkw0O9j
JsFjQzMgIUhvbttAGwwDXhLcoTHZRkKR/nnbjgpx5EBTpDgguQKSHm47Q6+Iw/BK3RVkKo8haLhiuQ7TNafQP6RTIQKPYtA991JV84OgoOPr1X2p
XsUMwAKwDRA7PY1Wy6tFEL2QwONHcMuIWEs8q3mOUhu8CvAh2fdHxBD7YWgDN6mQ+riX8Me+vj7K1hjFRV/A1uNo6z/znDrU/au0WfmzK3s1MjNs
gCRomJLodudcPp6h4N/jezz293QTvBpnvWiioPzRhJQkTWtiSiGH3xU4yZVAtrZ0YJETCqRIWvV+nT+tawGraFYsDuVhg+NQrgCkvUYMSzr9muXU
3u6Nuamyl4Oq3+EIi5B4/u7cx4l744gUri/Vddza1xkXXkKwDHMco0TqFY7XyR1ukjlMUKo57qYnkHtO4QH5xrbAmIyeHZJFvQ3Jdau17fw2lydT
SjLybjTpdluBbBCEqi5U/WW7PIwf9zlYjneruNHC8ry835JEmM59f3UrVV9FIWaXgxXEtCShJ7PtzjLDn8PZKMZEb5A34iLY7b8LF9+/ivPonyJZ
Ll2DV5NQjsvyL5Lx+ZcZHYE30ZiYHBtkY0ubZafEKDeHwjvd7Xe0g+2tfh3IdbsoCkQeJ55fETZ6m/K2A9j4vvoI8lHknsHqctq0Kn0JHGYUszlJ
IesQZH4Ht+8lnqMKvDay7/C6icw5cit9leXtGXAs8AoJuWdpjOGwsaMdSDhxJwPdz5eYiD/ZQuhOyKaCUaA9iSlqYPitlClvMBAgviWJu9dk/Z1G
mYNbvBZ8YwJt8pJs44BUrP1/iYLlx6tdyW1+kE/bOGuk2f/RgNA9iKb3z/RBdFzi8EUf3Zs3vPShyF0tsmJEpjFEugBpsEVBiMbqnOEOZBO6Q2/C
NbfKikszyLrbGHJSd4WqbjXWmlhvtTBHmLmG5PFeLqR14Bh2ixyIwAnkXcufte9fHwRSJ/VwTpO49AnnMlIWZBHk222Gzv5tX3qJ2ge4gJoQiuH3
+/oZ5P2cgkBCwp7USTB78YgnCZkutR7NOP1YL8n1NCKjzwGu38eAd0D4UT/GIO2n5ASXo5XWDGAF1x8BG+FUElgn0XgRH+XDan96G5RJXjQ5ktZz
pzgNfbSkhz/IJpmAS1Lm3gUzdxAxH1cBUHgFO+Oifk1/8aHFxR4iyRBWA/varwLIVt2VpMeJw9r8ZKkkAAXa5umDjjSxfqCjd1ZLwuwpkOLQe2PM
FZCySqC7VFoozDwBHNmDGuQ17FraFF0iqTEpJSVV5ZVoXM0q4hVKG5S7uoE3CMDmYAZw/WVRFReqI8TlAaFx5Q5lRZkroqcsH87/h4dLvo7S2lAs
r6yGKe260g8x+L6vlG89vzjNt3i+tmU4bnFBx2iT1GkS11vWePH31NFCDr93UFRibvJOUUg6TylndlT5lTyn4Az+2RJrGWI1bz1mWW3VPoacs8lW
3yDZbtw/+woRoJ9xxJgmT8u8x14n4wHRXNqFjlSISAlqyu4OSIVrIExTa1yt4DXzg4UphdAISPQQcOG34SVGyz72shQmFVEMoa5CVi6juQt+0iwA
7aVhCCGxt4bTBnTsUs+IBQiQf3KK+A1zy9o3pLcQdnFKLCIzkNb2Okq+MJGaHDhx0jCmrSArueNeLzbiAyKvPOCubgLltCb4wKlemb3Wowjzi8HV
XnmNz9u533FL1AUiPCraXc3n+aqWEpIXqVeOHjRVfGpan/rLxp3+S2ON/xKWng5+Niuenr/6SeSGCblR4C/B1PPM7IQpPFIFb8StEHsb5VZAa+GW
9S6pj1syyqNH3/vp8xJGQbE+x33KiC8NqQjg8uO8kpJyJbFnbuGFBNYNMTAfVSh7V3Z/cjguoRYQXpHTwyT3Q94ZWi4kkXDbYM/ZhVENNGlriK4L
giBBn5gFAbZqQRgn7VCV9pQFWhrrCSC61d5XU1CJOLwPRfj9C38EStRMHEnOtgmucWE9HKJADK4j4a6pm1fFLFfkuA44PFJbVwrqtZ6XrubDI4Kt
VHJ18tenU3uHg2rjquIAp0D52X/klsyF6Kk4KIOS3tLvEn+dkj6sKdP82iB/Jqgu494WNev3gsu6Pl4CX8I2zDrmcVt3Ol7QDrXemdNPR0VxDZyE
Eu9UPqWbusdpBCkCabDfeJs8sSGLl7Y41Ta7MBBCh9uIVBtrhjadql7fj/7tjbYkPpilxQgyv/IqYOH0YyuBpzP1Fv1qsbNrIaY/x76xcmdtTJN+
PQnYmtxrmLdnBT2PsMWsQIQF7snLWHyhgj93u3NR65DVTcGqAd8TrIVM6NdspO17sOhuifJK+Wb3+6Ug7NEUdHKuNWs/9KTzy0rM04inDINQ1R5j
NsMYj03BZhzRoQ4BV7Aexw3lG36iniB6O3aMB0sz+vGFy4QhXZvBjzO+ONpAg5ScYd5OzziE36lFZ1rz7sLMTtA5PNApvCfijBMCful7JNSH1KWb
I+54cClyMA2ywJKyeGZmIYOReSgUf5Aqc/SQuN8/93vUugtysED3UvS3PX/M+zifOK6nFH5npkdS+lrqK8m9yaf3mgo5++uNe95IfrVJJPPLcvEm
EvuS2KbxQgqqGEWKcqGdLzH5371ooRKmalvpvmxGrJq1tQSLVoWT4ds1q0kFVq1IUeyLcu4kaaLnCl989jkAebdPzdNvvAIH28LxdGUIYVt9ajcr
2XVUiDemlFksQEdMq2JnKatESdjtsNTQaSEhsX03hRjx4ub0RiC90c/0RiNNb/SS3siS2NiQ3ggUM5OrROJiSM/bYubOQHRhlKololTt36DpELbj
p/ZrPnHw8dhXiuqbpN0m6nmdZROHdsZc3Tqh5TB0uJJkulgLCafiknBLFMUQ97CcfpofV9aCqwZCsyLBMKc2KmMuoHw6aWYTI/JXrmk+7Jv3Ft7j
W2HxOh6aJ2TvPiRPT4T+q6EG0yXA5d8zYSpnLqrck1EkiUDQ7H5MwMaeGmzE6UEvycFe0oNe0oMN6UFDJUHGYS0ogiSuB3MLDZbxcQmM4Nj9GBsb
dXqjsaY3eklv9JLe6CW90ZDeaKiekTGkC4jGpezsMyWKkH5VNtRbsOBK0oWCMcV0n2AbVtcJ2Zik28T/TNH68d9StH5kT1nLqOBI8cEOE7RldgMd
x47VH8UXPBQnH7RgaLXLxaFdIe0mIRFhwPZqkMA1JhEMr73bFNzH59LALsXO6NenvqUoGyPzJSQBQbL7MQMbd3rQaNODXtKCvaQHvaQHDUnBhgqC
zC6ygAiStEmhLA5mJwIT4EWeZHjFyPQiR2K+4cBh52vo+jtFBCBXsH3Xy/towZJnSi9VOztJXV61NEHFYCzrUDpZR1w98vXJusBHrNt+7Bi7a7Yl
ooP9tjlZ0TVhbO+mo2ENX76xfVsT4aTDasDNxRRsTZHeqeNbvSCutLVDS4VYso+Z6uUIjHFuqDVndOAucI3Dx35QW68pDcqVyGn07ZE9eZRuGw0j
Aw+zSzjmDO6kYKfYFbblcGTYLvgqrtHD9ofeJiqUVo7U2neG/CaIK3a4OmbxDFgsrVYqjhDkiK6lLgeApC0KYYdzxFJxA6lEk18xuA7QhJSNY0c2
Poai/dPWRWDY4kz0I2wMqO9ivEoQeBIHaucQCB4zZ/FyUENbepy8B1Ei01SkKgZuN+gPrsS9SGxFBccQiDuOGo0wajxMmCappLYh2shSCGuBIJg5
g4GKIddwdcPYtG1C20hnfzxTiA2GcwJenQimU1kv4AM6ODgwQ78B3SYgbeZRsmQaeUTVxJkxLJJ4BYj9wjf41XjrNR+yAibO1WpirJHdbDM+1QIw
S1Wm55j5ie/cJOaDiMS8wxThg9xX5ll0M4NSi0mq4k0wV1IDXEqZkHm6rj/yLDWZaiz+OGJ1kdQGZEqwQrkukAExO0deDzIoWD5rpTPiIn2mCVR3
M7YVajg9dKTVkwztv/yp5RMmQXcjRnzdTWKnCgYIZkTDGFQtOLAtoLV+vB6VGuNK5Neo+ZB9JqgiEPtMoZdRuaQ4mMIAy0Ym+qcyG58oFd+MY3J1
63knQxkx2Z1VRv2UbJGrJtqutT5W7v4km6S0a6GjI6lx85OJKiOH1YzWPPk5FmAo39Vfz7kuuZQ5K2i5f/br+PLwW2333IRrXF2S1Z1I5dKRJP0R
5W7uP5XVc8sQN5ICi12tEqPS6GCetzG6rD/3Q5vWEZ893oynczIp4cG0dhd8feL63VL/0FB8pyDOaKO5Tu8tYeK2XQFcacXSwinBEE1M/n1+ycq8
d8v1RM+J/Egu4LUpoKhXe7aX5aC9NOw6E9z+gOf5TMR6AJB3jUA2D/rHytk4wX2NRV2fqXFMfEwMCVDs9E8e/n4gjtXDSDMImdlPzIBF/kD3ywjI
MdhuHpJwj9m/v27/ZlGf0OQb96gAKLnjmULaW+O4cTfFtn+b8e996JaWfqb9Ff7o37+3F7Sp4baAa+6j3LPW7whVtwLZhTa7Kt2rwD3H/8TWLmaA
a3ZBfcfd4v/STbmxjpRQ8veMhj1uHVTdo9uB4K93BqMu7q0BCvlnk439BsGQDc5kQL0O/3mNGv22ogvLG/vr6/RbN/Y3m+Uv+gLI/e2q2z2uK+2L
pG0kPwRnruj9e2J6jCM747pHZ5SdLZ99rXbBhJT9ZqlXRzftqMsdsrfCvqR+424IIH2XXDvTPGPQvh6RMh28yuvh+2sr4xWUApmsWSYrvNmFG/Lq
np/ZArDrwXJYfJVzSRqI/bLrpu/CCPqxxxLZlxtGKnev1zdMUjdhC6idLUZEbuGKexldNU0BmQzcdgySpW0BCy1wZxjk0uIJyGOghoYXXIevFmhj
/DFgRSP+ByzksDMTGhIduDuoCNj6+cpeNzDdmMt+yNUPuSTnzPUu8YNYdGXCVYeo0XqGhM7jGweTJv98IbUFUKVCjN4BJP20Gdkxgy644SeNY/zX
GJXfJ7rXVhMxS4QiF0/XtxSfJ9oMArkFPL5PoCmFycFSkHZxPCTEn+/wDNq8AcUQZ9ilJbuq4chbg1E7j70BXb4HDXuf2SuUW6aCtGmC+jV7uXBX
NmS+SNoEZgxWfSRhtBOcZYyo0+6XfU1YWgqzHN/iCFULtLygkwUyjOFTKCESERh3u4AYe8R1dRoS1QYW2hpcBpZIA/fnKNgARR8244u3bs/AgRQ2
5JMjSYZIRStiUEPka2EYf0Gi1j3m5Fx6ZJ7E4+qDdeCsSOScSpnsra3TRbw0Y+N1K1+VsvkSE1/7KjOD2GMpDjDT8Sxid7XSoyXxvbL5sqpyPD0B
y2uCfqvckJx7eWHFMhm8LcUMva/H4KyFtUkvEskiLE4m/gsgeQ5IAH48Hd+0fb4mM56AfAKuEiqeIRPbDNDfaBuI5FqfV74iKjbzb6My5iYdNWyL
qxeQFz/h0WUixDIqO3Uh5mHh0ie+yX606/v1HTphhTW4e0ELV0m6rPlgIWF8QCm2xKav6aygiZyXpDNqKq7NOQEx5WxPqKXiqWpMz1MJU+SsCCnV
tFf1nEuFGPZGEgKXRd9r1AXrtHWWsTdnGdOuJ7fnrOPbhbWqcnTdLvCoLLGuTiyW6TYbuamiJLt6vDacm4SteDbyPXeenMSBwbizWOhzcqieZ3tU
MFmrtTqpOKh4PTLWW7XTNWlw9frUSCs7vZMuPHcRDP5cnkQ8hohBuebyYdHghyAZkJGvP6gtauPxeIPHQIMZgjjKXX9eTll9g1OJljWNJfhV2sws
KfLkRfeyIb1ty6cGiNkeksDmhs0PSaP3r9FHQh29lKf/EAhAidIn+nJ1mJ5m4wZATswwmOnONLH47EVGcZa8yzBhQCOJWZvkujd246AMGjJ4GLh8
InJmb2fTRljhDtk0JcKD3Tua6eRa3mP4Sti47WuwrjIiszjJhji6mXMPRc0tNF9twhnXhRzLZaQzQV2CEuItX3ZP2wws8gYLQZo5aAC/RK/tZvyR
izKYyYsclxuFxrwdp34WyPplT8cu9uNmL4l+OqBHwqDbpL3tUuCAvEDgsO/c+MsQA5K13RFTzI6naqYD6lkYZJ/4eqYRIbaJJmMrfGhL3GSaJ58m
7yFL9t2UlvuWe4I0Sc5FoD4JtD50NaWNQcKOnQHbc+q0+ZzPg0SDItWAq86AAptm7+B5pZP1EzKPXSdJS/wozyOepSBLqgHqGtpYGV0n3jf4Ek9O
EtdBltYwNPM43owH8b9E9mN4yfhGeacrU4H8u7Cq2Ricc04OlwnaGCYnyyvfVxRyIdASBOuTS1AagifF+hmNflD3lT1Hxk3fyoXLiJ9Jjr7hPr+Z
DPA+eEL2LbH9C0tYYNzHyPi9FU0fa7S+vvgjL6XR5b9mZSRsdjTuNzmSBEOEm54ttIb/TZyamWiezddpKNbjZdmX7P6BVp5MxSiWoUgwTviSMo1l
06OBwRtZ1sGx4ht99SzWOblwLab/T4yXUyZhr83CbdSNr0Qpm01GuprzhZIdkzTfzgWAYHeo5xxs686P9vW4X2HG/DjsmwaebGQoadWmFB+xBJ87
ytOhWnvZqRRrsUX1X/PBhEgv6TOJ5KKGFcs6WdWkSb0NOb5jVMKeDUXGvBc3LCpmTNI6pDO45oRbdWEw5+cOtpa5PZYEmmzlPO9LNRzPta8VQ1bj
XldizGknudD7lPrbdpaXJZwzY3P5QryW5I4JkVeL9yYTSrf55KaU3UX23FVHJJOPKKyTOtqdljG3Ee/ERjmxMU2kR0vBNvHL4KXMp0YvCUuL0j3R
42PQ5S0PBd2k+LgiKCbTX+gyWPBhN8glmOrXvtESbDdkCTbeErDFtIHczZXx5k+FcbgfZsBu1XzJEKNKMS6zRMhC9u3QDcKmGlG3jNnRNEQGqelM
2hN4GpoqxlGUhk4n+pzqLEsleelJCQQ2+rxV4hzl05zstlruy6AtDYyyx+RnCchMa4FN2JQp0YHlrlCDTyX5W6v0b63i38K9MXe+ncMDb1PYW2/O
Mn7zjDFB4fdc45gVcKLTpBM1Z/HE1H+3J88Kvd1N29E4ogKQ1b+xq7X4E0Tqd+mfX5YnehykQCP+k/fqN2iFEgaMihJIQhchwrteTIifLgUfncyV
zO+wqm3URc9QuSjWNlrrgnRF4+FnRwEAn0VscZCFzXy+pISJu8JKOjU3KQkAlVXiFelV+j6r7lBMD4CsxQyYc9RfpeIw9yEYS+iotpKuJVOpA+Ki
Hkqis1mjpMPRSmL5ktS/VikOMqYY7xJHx89oCgDAgBe+xXB7CAIpQYBti9MrXRVUsqxjPqFSAPeKl5SsxPj8S/3zTXGQCGOhSslwWrhTMiQXdJWk
FT71piTmXEBSMmgW/1BS3JZkYL3pS9mydeOcHoFVVBElJTaZzUrKaVL0KQ9TpYRw/qO4Hv6YaQcrdGhei+jXHfOkZKfySqBSv7SKf2lWyrnz5Tl9
YRnoWxKZEbiznw4pqVX5IN6cyF5ABPDmAZtOdng9r7aoUrF+Fk+iSlgMqLjZn50wAPDR5Bc=
`, "base64")).toString("utf8"),
);
