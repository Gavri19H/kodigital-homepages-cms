// Listicles Phase 6 — shared e2e seed helpers (NOT a spec).
//
// Seeds a fully ACTIVE tenant site + a published listicle through the REAL
// admin APIs (no direct DB writes):
//   site (unique hostname) → domain status active → site draft→provisioning→
//   active → media uploads (logo/hero/avatar/section) → settings (site_name,
//   logo, GA4 analytics_script) → offer → 6 sections mirroring the reference
//   STRUCTURE (6/2/4/4/–/3 choice-button groups; neutral OUR-OWN copy —
//   never the reference's text) → article + control Version (two-line
//   headline, byline, hero) → pages → publish.
//
// The browser reaches the tenant host via Chromium's
// --host-resolver-rules=MAP <host> 127.0.0.1 (see the spec files); Node-side
// header/caching assertions use APIRequestContext with an explicit Host
// header against 127.0.0.1:8787.

import { expect, type APIRequestContext } from "@playwright/test";

export const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

export interface SeededListicle {
  siteId: string;
  host: string;
  slug: string;
  articleId: number;
  articlePublicId: string;
  versionId: number;
  versionPublicId: string;
  offerId: number;
  sectionIds: number[];
  gaMeasurementId: string;
}

async function json<T>(res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> }, label: string): Promise<T> {
  if (!res.ok()) {
    throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

// Transient-socket retry for SEED calls only: wrangler dev (miniflare)
// occasionally resets a keep-alive socket under sustained full-suite load
// (read ECONNRESET on an otherwise-healthy server). One bounded retry after
// a short pause absorbs it; every seeded resource is unique-suffixed, so a
// rare double-apply cannot collide with another test's data.
async function withTransientRetry<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/ECONNRESET|ECONNREFUSED|socket hang up/i.test(message)) throw err;
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log(`[seed-retry] ${label}: transient socket error, retrying once`);
    return run();
  }
}

// Wrap an APIRequestContext so get/post/patch/put self-retry transient
// socket errors (seed-time only; specs keep using their own raw contexts).
function retryingRequest(request: APIRequestContext): APIRequestContext {
  const verbs = new Set(["get", "post", "patch", "put", "delete"]);
  return new Proxy(request, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver) as unknown;
      if (typeof prop !== "string" || !verbs.has(prop) || typeof original !== "function") {
        return original;
      }
      const fn = original as (...args: unknown[]) => Promise<unknown>;
      return (...args: unknown[]) =>
        withTransientRetry(`${prop} ${String(args[0] ?? "")}`, () => fn.apply(target, args));
    },
  });
}

export async function seedActiveSite(
  rawRequest: APIRequestContext,
  host: string,
  siteName: string,
): Promise<string> {
  const request = retryingRequest(rawRequest);
  const created = await json<{ resource: { id: string } }>(
    await request.post("/api/admin/sites", {
      data: { domain: host, name: siteName, vertical_slug: "finance", activity: "main" },
    }),
    "site create",
  );
  const siteId = created.resource.id;

  // Activate the domain row (admin PATCH /domains/:id), then walk the legal
  // site status chain draft → provisioning → active.
  const domains = await json<{ resource: Array<{ id: number; hostname: string }> }>(
    await request.get(`/api/admin/domains?site_id=${encodeURIComponent(siteId)}`),
    "domains list",
  );
  const domain = domains.resource.find((d) => d.hostname === host);
  expect(domain, `domain row for ${host}`).toBeTruthy();
  await json(
    await request.patch(`/api/admin/domains/${domain!.id}`, { data: { status: "active" } }),
    "domain activate",
  );
  await json(
    await request.patch(`/api/admin/sites/${siteId}`, { data: { status: "provisioning" } }),
    "site provisioning",
  );
  await json(
    await request.patch(`/api/admin/sites/${siteId}`, { data: { status: "active" } }),
    "site activate",
  );
  return siteId;
}

export async function uploadPng(
  rawRequest: APIRequestContext,
  name: string,
): Promise<{ id: number; storage_key: string }> {
  const request = retryingRequest(rawRequest);
  const res = await request.post("/api/admin/media/upload", {
    multipart: {
      file: { name, mimeType: "image/png", buffer: PNG_1PX },
    },
  });
  // Admin upload envelope: { item: <media row>, url: "/media/<key>" }.
  const body = await json<{ item: { id: number; storage_key: string } }>(res, `media upload ${name}`);
  expect(body.item.storage_key, `upload ${name} storage_key`).toBeTruthy();
  return { id: body.item.id, storage_key: body.item.storage_key };
}

// The standard GA4 loader snippet (§21): the async gtag.js script + the
// inline dataLayer/gtag bootstrap. dataLayer + gtag exist WITHOUT network —
// the e2e asserts those + the config call (the remote fetch itself is not
// asserted so the suite stays offline-safe).
export function ga4Snippet(measurementId: string): string {
  return (
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>` +
    `<script>window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}` +
    `gtag('js', new Date());gtag('config', '${measurementId}');</script>`
  );
}

interface SectionSeedSpec {
  name: string; // internal (unique per run — never rendered)
  displayHeadline: string; // rendered headline (RUN-STABLE for self-baseline)
  buttons: number; // 0 ⇒ no choice group (the reference's section 5)
  withImage: boolean;
  finalCta?: boolean;
}

async function seedSection(
  request: APIRequestContext,
  spec: SectionSeedSpec,
  offerId: number,
  offerPublicId: string,
  imageUrl: string,
): Promise<number> {
  const blocks: unknown[] = [
    {
      type: "paragraph",
      data: {
        text: "",
        html:
          'Our own neutral copy compares plans so readers can pick with confidence — see <a data-offer="' +
          offerPublicId +
          '">this comparison tool</a> for details.',
      },
    },
    {
      type: "list",
      data: {
        style: "unordered",
        marker: "check",
        items: ["Neutral benefit item one", "Neutral benefit item two", "Neutral benefit item three"],
        layout_binding: "default.listBlock",
      },
    },
    { type: "paragraph", data: { text: "Which option fits your household best?" } },
  ];
  if (spec.buttons > 0) {
    blocks.push({
      type: "choice_button_group",
      data: {
        layout_binding: "default.choiceButtonGroup",
        items: Array.from({ length: spec.buttons }, (_, i) => ({
          text: `Option ${i + 1}`,
          offer_id: offerPublicId,
        })),
      },
    });
    // The measured follow-up CTA after each group (full-width button link).
    blocks.push({
      type: "button",
      data: { text: "See all neutral options", style: "primary", align: "center", offer_id: offerPublicId },
    });
  }
  if (spec.finalCta === true) {
    blocks.push({
      type: "final_text_cta",
      data: { text: "Check availability here", offer_id: offerPublicId, link_instance_id: "" },
    });
  }
  blocks.push({
    type: "paragraph",
    data: { text: "Availability and terms vary by region.", layout_binding: "default.legalDisclosureBlock" },
  });

  const body: Record<string, unknown> = {
    section_name: spec.name,
    headline_text: spec.displayHeadline,
    headline_offer_id: offerId,
    content_json: { blocks },
  };
  if (spec.withImage) body.image = { type: "image", url: imageUrl };
  const created = await json<{ section: { id: number } }>(
    await request.post("/api/admin/listicles/sections", { data: body }),
    `section ${spec.name}`,
  );
  return created.section.id;
}

export interface SeedListicleOptions {
  hostPrefix: string;
  slug: string;
  /** paragraph filler appended per section (drives the §22.4 budget) */
  sectionFiller?: string;
  gaMeasurementId?: string;
  /** true ⇒ pages become 50/50 ab_test pairs (two Section candidates each) */
  abPairs?: boolean;
  /**
   * Phase 7: full custom pages payload built from the seeded section ids
   * (the version PUT `pages` shape — ab_test/rule_based composition for the
   * tracking e2e). Wins over abPairs when provided.
   */
  pages?: (sectionIds: number[]) => unknown[];
  /**
   * Phase 7: override the offer's URL template. The tracking e2e points it
   * at a locally-REACHABLE host (`http://offers.e2e.test:8787/health?...`,
   * the worker's own any-host route) because Playwright cannot intercept
   * requests that continue a redirect chain — a /lc 302 to an unroutable
   * provider host would strand the navigation.
   */
  offerUrlTemplate?: string;
}

// Mirrors the REFERENCE STRUCTURE (§30.8 fixture contract): two-line title,
// hero, byline, 6 sections with 6/2/4/4/–/3 button groups — all with neutral
// our-own copy.
export async function seedPublishedListicle(
  rawRequest: APIRequestContext,
  opts: SeedListicleOptions,
): Promise<SeededListicle> {
  const request = retryingRequest(rawRequest);
  const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const host = `${opts.hostPrefix}-${uniq}.e2e.test`;
  const gaMeasurementId = opts.gaMeasurementId ?? `G-E2E${uniq.slice(-6)}`;
  const siteId = await seedActiveSite(request, host, `Listicles P6 ${uniq}`);

  const logo = await uploadPng(request, `lst-p6-logo-${uniq}.png`);
  const hero = await uploadPng(request, `lst-p6-hero-${uniq}.png`);
  const avatar = await uploadPng(request, `lst-p6-avatar-${uniq}.png`);
  const sectionImg = await uploadPng(request, `lst-p6-section-${uniq}.png`);
  // LOCAL-DEV NOTE: hero/section images use ABSOLUTE 127.0.0.1 URLs so
  // responsive-img degrades to the bare <img> (no /cdn-cgi/image srcset).
  // wrangler dev has no Cloudflare image resizing, and a browser does NOT
  // fall back to src when its chosen srcset candidate 404s — bare /media/
  // keys would render broken locally. Production content stores bare keys
  // and gets the full srcset (responsive-images.test.ts pins that path).
  const heroUrl = `http://127.0.0.1:8787/media/${hero.storage_key}`;
  const sectionImgUrl = `http://127.0.0.1:8787/media/${sectionImg.storage_key}`;

  await json(
    await request.patch("/api/admin/settings", {
      data: {
        site_id: siteId,
        updates: {
          // RUN-STABLE brand text (the header/footer render it — the §31.1
          // self-baseline needs constant pixels across runs).
          site_name: "Neutral Savings Guide",
          logo_media_id: logo.storage_key,
          analytics_script: ga4Snippet(gaMeasurementId),
        },
      },
    }),
    "settings",
  );

  const offer = await json<{ offer: { id: number; public_id: string } }>(
    await request.post("/api/admin/listicles/offers", {
      data: {
        offer_name: `P6 offer ${uniq}`,
        provider: "e2eprov",
        activity: "lead",
        vertical: "finance",
        conversion_tracking_method: "browser_side_pixel",
        offer_url_template: opts.offerUrlTemplate ?? "https://offers.e2e.test/c?cid={click_id}",
        payout_method: "offsite",
      },
    }),
    "offer",
  );

  // The reference's per-section group counts: 6/2/4/4/–/3 (§30.8 fixture).
  const groupCounts = [6, 2, 4, 4, 0, 3];
  const sectionIds: number[] = [];
  for (let i = 0; i < groupCounts.length; i++) {
    sectionIds.push(
      await seedSection(
        request,
        {
          name: `Fixture section ${i + 1} (${uniq})`,
          displayHeadline: `Neutral benefit number ${i + 1} for careful shoppers`,
          buttons: groupCounts[i] ?? 0,
          withImage: true,
          finalCta: i === groupCounts.length - 1,
        },
        offer.offer.id,
        offer.offer.public_id,
        sectionImgUrl,
      ),
    );
  }
  if (opts.sectionFiller !== undefined && opts.sectionFiller !== "") {
    // Grow every section with filler paragraphs (over-budget probe): PATCH
    // re-renders + re-governs through the real save pipeline.
    for (const id of sectionIds) {
      const current = await json<{ section: { content_json: string } }>(
        await request.get(`/api/admin/listicles/sections/${id}`),
        "section read",
      );
      const doc = JSON.parse(current.section.content_json) as { blocks: unknown[] };
      doc.blocks.push({ type: "paragraph", data: { text: opts.sectionFiller } });
      await json(
        await request.patch(`/api/admin/listicles/sections/${id}`, {
          data: { content_json: doc },
        }),
        "section grow",
      );
    }
  }

  const article = await json<{
    article: { id: number; public_id: string };
    version: { id: number; public_id: string };
  }>(
    await request.post("/api/admin/listicles/articles", {
      data: {
        site_id: siteId,
        slug: opts.slug,
        article_name: `P6 fixture ${uniq}`,
        headline: "Neutral Benefits Most Households Miss\nA Practical Comparison For This Year",
        intro_paragraph:
          "Our own neutral introduction explains how the comparison below was built.\n\nEvery entry uses plain language and our own words.",
        hero_media_url: heroUrl,
        layout_style_id: "default",
      },
    }),
    "article create",
  );

  // Pages via the atomic Version PUT (one Section candidate per page —
  // page-level A/B alternates ride separate seeds where a test needs them).
  await json(
    await request.put(`/api/admin/listicles/versions/${article.version.id}`, {
      data: {
        headline: "Neutral Benefits Most Households Miss\nA Practical Comparison For This Year",
        intro_paragraph:
          "Our own neutral introduction explains how the comparison below was built.\n\nEvery entry uses plain language and our own words.",
        hero_media_url: heroUrl,
        layout_style_id: "default",
        byline: {
          enabled: true,
          author_name: "Alex Neutral",
          author_avatar_url: `/media/${avatar.storage_key}`,
          label: "Advertorial",
          updated_label: "Updated:",
          updated_date: "July 1, 2026",
        },
        pages:
          opts.pages !== undefined
            ? opts.pages(sectionIds)
            : opts.abPairs === true
            ? // 50/50 ab_test pairs: [s0,s1] [s2,s3] [s4,s5] → 3 pages with a
              // hidden alternate each (the §22.4 budget probe shape).
              Array.from({ length: Math.floor(sectionIds.length / 2) }, (_, index) => ({
                page_index: index,
                selection_mode: "ab_test",
                ab_test_id: `ab_p6_${index}`,
                candidates: [
                  { section_id: sectionIds[index * 2], traffic_allocation: 50, label: "A" },
                  { section_id: sectionIds[index * 2 + 1], traffic_allocation: 50, label: "B" },
                ],
              }))
            : sectionIds.map((sectionId, index) => ({
                page_index: index,
                selection_mode: "single",
                candidates: [{ section_id: sectionId }],
              })),
      },
    }),
    "version pages",
  );

  await json(
    await request.post(`/api/admin/listicles/articles/${article.article.id}/publish`, { data: {} }),
    "publish",
  );

  return {
    siteId,
    host,
    slug: opts.slug,
    articleId: article.article.id,
    articlePublicId: article.article.public_id,
    versionId: article.version.id,
    versionPublicId: article.version.public_id,
    offerId: offer.offer.id,
    sectionIds,
    gaMeasurementId,
  };
}

// Fork the control + start a RUNNING 50/50 experiment (for sticky tests).
export async function startFiftyFiftyExperiment(
  rawRequest: APIRequestContext,
  seeded: SeededListicle,
): Promise<{ experimentPublicId: string; versionBPublicId: string }> {
  const request = retryingRequest(rawRequest);
  const fork = await json<{ version: { id: number; public_id: string } }>(
    await request.post(`/api/admin/listicles/versions/${seeded.versionId}/fork`, {
      data: { variant_label: "B" },
    }),
    "fork",
  );
  const experiment = await json<{ experiment: { public_id: string } }>(
    await request.post(`/api/admin/listicles/articles/${seeded.articleId}/experiments`, {
      data: {
        name: "P6 sticky e2e",
        status: "running",
        versions: [
          { version_id: seeded.versionId, traffic_allocation: 50, is_control: true },
          { version_id: fork.version.id, traffic_allocation: 50 },
        ],
      },
    }),
    "experiment",
  );
  return {
    experimentPublicId: experiment.experiment.public_id,
    versionBPublicId: fork.version.public_id,
  };
}
