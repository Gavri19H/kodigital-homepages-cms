// LeadGen Round-4 Remediation — Phase P1 slice P1d probe spec (temporary;
// final consolidation lands in P7). Drives the REAL admin list pages with
// REAL input (locator.click / API seeding — ZERO dispatchEvent), asserting
// this slice's deliverables end-to-end:
//   AC-1  per list (all six: LeadGen Offers/Sections/Quotes/Auction +
//         Listicles Sections/Articles): no page-level hidden overflow
//         (body scrollWidth == body clientWidth) AND — where the table is
//         wider than the viewport — the wrapper itself scrolls, and the
//         LAST column header becomes reachable by scrolling the wrapper to
//         its max scrollLeft (A-1/P-1, rows R4-01/R4-37).
//   AC-2  sections + quotes rows expose the shared kebab with the specified
//         items; Duplicate on a section creates a "(copy)" row after
//         reload; a quote's Archive -> Reactivate round-trips its status
//         badge (A-2/P-2, rows R4-02/R4-38). Review-round addition: the same
//         Archive -> Reactivate round-trip for auctions, PLUS Usage
//         rendering the referencing leg and a guarded Delete's 409 — the
//         auction kebab lifecycle previously had API-level coverage only,
//         no UI click-through proof.
//   AC-3  a guarded Delete (a quote carrying a live site activation) surfaces
//         the server's plain-language 409 message verbatim, not a raw error.
//   AC-4  renderHeaderCta with {enabled, tel, no label} defaults the label to
//         "Call now" and derives href="tel:..." (P-10d, row R4-36) — a direct
//         unit assertion (frame.ts's own pure-function contract), not a
//         browser page.
//
// chromium-only: every action is a plain click / API call — no
// gesture/drag machinery.

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { renderHeaderCta } from "../src/public/leadgen/designs/frame";

test.use({ viewport: { width: 1440, height: 900 } });

const LG_API = "/api/admin/leadgen";
const uniq = Date.now();

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

interface Created {
  id: number;
  public_id: string;
}

async function createSection(request: APIRequestContext, name: string): Promise<Created> {
  return json<Created>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: name,
        activity: `p1d-act-${uniq}`,
        vertical: `p1d-vert-${uniq}`,
        headline_text: "P1d",
        continue_mode: "button",
        status: "active",
        content_json: {
          components: [{ type: "QuestionHeadline", question_id: "qh", bind: "section_headline" }],
        },
      },
    }),
    `p1d section create (${name})`,
  );
}

async function createQuote(request: APIRequestContext, name: string): Promise<Created & { status: string }> {
  return json<Created & { status: string }>(
    await request.post(`${LG_API}/quotes`, {
      data: {
        quote_name: name,
        activity: `p1d-act-${uniq}`,
        verticals: [`p1d-vert-${uniq}`],
        status: "active",
      },
    }),
    `p1d quote create (${name})`,
  );
}

// createQuoteHandler's own response (quoteDetailJson) nests the auto-created
// funnel + control variant — needed only by the rules-usage test below, so a
// separate helper rather than widening createQuote's shape for every caller.
interface QuoteWithVariant extends Created {
  status: string;
  funnels: Array<{ variants: Array<{ public_id: string }> }>;
}
async function createQuoteWithVariant(request: APIRequestContext, name: string): Promise<QuoteWithVariant> {
  return json<QuoteWithVariant>(
    await request.post(`${LG_API}/quotes`, {
      data: {
        quote_name: name,
        activity: `p1d-act-${uniq}`,
        verticals: [`p1d-vert-${uniq}`],
        status: "active",
      },
    }),
    `p1d quote+variant create (${name})`,
  );
}

async function createAuction(request: APIRequestContext, name: string, quoteId: number): Promise<Created & { status: string }> {
  return json<Created & { status: string }>(
    await request.post(`${LG_API}/auctions`, {
      data: { auction_name: name, quote_id: quoteId, auction_type: "static" },
    }),
    `p1d auction create (${name})`,
  );
}

// Module-level counter: this file creates more than one site (AC-1's
// Listicles-Articles gate + AC-3's activation seed), and `domain` carries a
// UNIQUE constraint server-side — `uniq` alone (one Date.now() per file load)
// is not enough to keep two sites' domains distinct.
let siteSeq = 0;
async function createSite(request: APIRequestContext, name: string): Promise<{ id: string }> {
  siteSeq += 1;
  const res = await request.post("/api/admin/sites", {
    data: {
      domain: `p1d-${uniq}-${siteSeq}.example`,
      name,
      vertical_slug: "finance",
      activity: "main",
    },
  });
  const body = await json<{ resource: { id: string } }>(res, `p1d site create (${name})`);
  return { id: body.resource.id };
}

// ---------------------------------------------------------------------------
// AC-1 — every list: no unreachable page-level overflow + the wrapper's own
// scrollbar reaches the last column (A-1/P-1)
// ---------------------------------------------------------------------------

async function assertOverflowFixed(page: Page, tableSelector: string): Promise<void> {
  const bodyDims = await page.evaluate(() => ({
    scrollWidth: document.body.scrollWidth,
    clientWidth: document.body.clientWidth,
  }));
  expect(
    bodyDims.scrollWidth,
    `body scrollWidth(${bodyDims.scrollWidth}) must not exceed clientWidth(${bodyDims.clientWidth}) — no page-level hidden overflow`,
  ).toBeLessThanOrEqual(bodyDims.clientWidth);

  const wrapper = page.locator(`.table-wrapper:has(${tableSelector})`).first();
  await expect(wrapper).toBeVisible();
  const wrapperDims = await wrapper.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));

  // Only meaningful where the table is actually wider than the viewport
  // (every one of the six lists qualifies at 1440px — this is the class of
  // table the fix targets — but the check stays conditional per the AC's own
  // "where the table is wider than the viewport" framing).
  if (wrapperDims.scrollWidth <= wrapperDims.clientWidth) {
    return;
  }
  expect(
    wrapperDims.scrollWidth,
    `wrapper scrollWidth(${wrapperDims.scrollWidth}) > clientWidth(${wrapperDims.clientWidth}) — its OWN scrollbar must be the one that engages`,
  ).toBeGreaterThan(wrapperDims.clientWidth);

  await wrapper.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  const lastHeader = page.locator(`${tableSelector} thead th:last-child`);
  const box = await lastHeader.boundingBox();
  const viewport = page.viewportSize();
  expect(box, "last column header must have a bounding box after scrolling the wrapper to max").not.toBeNull();
  expect(viewport).not.toBeNull();
  if (box && viewport) {
    expect(
      box.x,
      `last header left edge (${box.x}) must be reachable within the viewport width (${viewport.width}) after scrolling the wrapper to max`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      box.x,
      `last header left edge (${box.x}) must be within the viewport width (${viewport.width})`,
    ).toBeLessThan(viewport.width);
  }
}

test.describe("P1d AC-1 — no unreachable list overflow, all six lists", () => {
  let siteId = "";
  test.beforeAll(async ({ request }) => {
    siteId = (await createSite(request, `P1d AC1 Site ${uniq}`)).id;
  });

  const cases: Array<{ name: string; url: () => string; table: string }> = [
    { name: "LeadGen Offers", url: () => "/admin/leadgen/offers", table: "table.leadgen-offers-list" },
    { name: "LeadGen Sections", url: () => "/admin/leadgen/sections", table: "table.leadgen-sections-list" },
    { name: "LeadGen Quotes", url: () => "/admin/leadgen/quotes", table: "table.leadgen-quotes-list" },
    { name: "LeadGen Auction", url: () => "/admin/leadgen/auction", table: "table.leadgen-auctions-list" },
    { name: "Listicles Sections", url: () => "/admin/listicles/sections", table: "table.sections-list" },
    {
      name: "Listicles Articles",
      url: () => `/admin/listicles/articles?site_id=${encodeURIComponent(siteId)}`,
      table: "table.articles-list",
    },
  ];

  for (const c of cases) {
    test(`${c.name}: body has no hidden overflow; wrapper scrolls; last column reaches the viewport`, async ({
      page,
    }) => {
      await page.goto(c.url(), { waitUntil: "domcontentloaded" });
      await assertOverflowFixed(page, c.table);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-2 — sections + quotes kebab items; Duplicate + Archive/Reactivate (A-2)
// ---------------------------------------------------------------------------

test.describe("P1d AC-2 — sections kebab + Duplicate; quotes kebab + Archive/Reactivate", () => {
  test("sections list row: Edit + kebab(Duplicate/Usage/Archive/Delete); Duplicate creates a '(copy)' row after reload", async ({
    page,
  }) => {
    const name = `P1d sec ${uniq}`;
    const section = await createSection(page.request, name);
    await page.goto(`/admin/leadgen/sections?search=${uniq}`, { waitUntil: "domcontentloaded" });

    const row = page.locator(`tr[data-entity-id="${section.id}"]`);
    await expect(row.getByRole("link", { name: "Edit" })).toBeVisible();
    await row.getByRole("button", { name: /More actions/i }).click();
    // Opening the kebab REPARENTS its menu to <body> (a portal — escapes
    // .table-wrapper's forced overflow-y clip and .admin-main's isolated
    // stacking context; see layout.ts kebabMenuScript's own doc comment), so
    // once open its items are document-level, not row-scoped — locate them
    // via page.locator(the exact public-id value) from here on; the toggle
    // button and Edit link stay in the row untouched.
    const duplicateBtn = page.locator(`[data-section-duplicate="${section.public_id}"]`);
    await expect(duplicateBtn).toBeVisible();
    await expect(page.locator(`[data-section-usage="${section.public_id}"]`)).toBeVisible();
    await expect(page.locator(`[data-section-archive="${section.public_id}"]`)).toBeVisible();
    await expect(page.locator(`[data-section-delete="${section.public_id}"]`)).toBeVisible();

    await duplicateBtn.click();
    await expect(
      page.locator(`tr[data-entity-name="${name} (copy)"]`),
      "a '(copy)' row appears in the list after reload",
    ).toBeVisible({ timeout: 10_000 });
  });

  test("quotes list row: Edit + kebab(Duplicate/Usage/Archive/Delete); Archive -> Reactivate round-trips status", async ({
    page,
  }) => {
    const quote = await createQuote(page.request, `P1d quote ${uniq}`);
    await page.goto(`/admin/leadgen/quotes?search=${uniq}`, { waitUntil: "domcontentloaded" });

    const row = page.locator(`tr[data-entity-id="${quote.public_id}"]`);
    await expect(row.getByRole("link", { name: "Edit" })).toBeVisible();
    await row.getByRole("button", { name: /More actions/i }).click();
    // Opening the kebab REPARENTS its menu to <body> (a portal — escapes
    // .table-wrapper's forced overflow-y clip and .admin-main's isolated
    // stacking context; see layout.ts kebabMenuScript's own doc comment), so
    // once open its items are document-level, not row-scoped — locate them
    // via page.locator(the exact public-id value) from here on; the toggle
    // button and Edit link stay in the row untouched.
    const archiveBtn = page.locator(`[data-quote-archive="${quote.public_id}"]`);
    await expect(page.locator(`[data-quote-duplicate="${quote.public_id}"]`)).toBeVisible();
    await expect(page.locator(`[data-quote-usage="${quote.public_id}"]`)).toBeVisible();
    await expect(archiveBtn).toBeVisible();
    await expect(page.locator(`[data-quote-delete="${quote.public_id}"]`)).toBeVisible();

    // The quotes list renders NO status badge cell (QUOTE_LIST_COLUMNS has no
    // "Status" column — "A/B status" is a different field, ab_status). The
    // round-trip proof is therefore (a) the kebab's conditional item flipping
    // Archive <-> Reactivate after each reload, and (b) an API read-back of
    // the actual server status — the same two-part proof
    // leadgen-r4a-pipeline.spec.ts already uses for sections' reactivate.
    page.once("dialog", (d) => void d.accept());
    await archiveBtn.click();
    // window.location.reload() fires after the PATCH resolves — the reload
    // closes any open kebab, so re-open it before checking the flipped item.
    const rowAfterArchive = page.locator(`tr[data-entity-id="${quote.public_id}"]`);
    await expect(rowAfterArchive.getByRole("button", { name: /More actions/i })).toBeVisible({ timeout: 10_000 });
    await rowAfterArchive.getByRole("button", { name: /More actions/i }).click();
    const reactivateBtn = page.locator(`[data-quote-reactivate="${quote.public_id}"]`);
    await expect(reactivateBtn, "Archive flips to a Reactivate item after reload").toBeVisible();
    await expect(page.locator(`[data-quote-archive="${quote.public_id}"]`)).toHaveCount(0);
    const archivedReadBack = await json<{ status: string }>(
      await page.request.get(`${LG_API}/quotes/${quote.public_id}`),
      "p1d quote read-back after archive",
    );
    expect(archivedReadBack.status, "server status is archived").toBe("archived");

    page.once("dialog", (d) => void d.accept());
    await reactivateBtn.click();
    const rowAfterReactivate = page.locator(`tr[data-entity-id="${quote.public_id}"]`);
    await expect(rowAfterReactivate.getByRole("button", { name: /More actions/i })).toBeVisible({ timeout: 10_000 });
    await rowAfterReactivate.getByRole("button", { name: /More actions/i }).click();
    await expect(
      page.locator(`[data-quote-archive="${quote.public_id}"]`),
      "Reactivate flips back to an Archive item after reload",
    ).toBeVisible();
    await expect(page.locator(`[data-quote-reactivate="${quote.public_id}"]`)).toHaveCount(0);
    const reactivatedReadBack = await json<{ status: string }>(
      await page.request.get(`${LG_API}/quotes/${quote.public_id}`),
      "p1d quote read-back after reactivate",
    );
    expect(reactivatedReadBack.status, "server status round-trips back to active").toBe("active");
  });

  // Review-round finding: the auction kebab lifecycle (Archive/Reactivate/
  // Usage/guarded Delete) had API-level coverage (test/leadgen-p1c-lifecycle
  // .test.ts) but no UI click-through proof — a typo in AUCTION_LIST_SCRIPT's
  // handlers would pass every gate. Mirrors the quotes case above, plus
  // exercises the non-empty Usage leg and the Delete guard on the SAME
  // referenced auction (seeding a referencing variant is cheap: one PUT).
  test("auction list row: Edit + kebab(Usage/Archive/Delete, no Duplicate); Archive -> Reactivate round-trips status; Usage shows the referencing leg; guarded Delete surfaces the 409 verbatim", async ({
    page,
  }) => {
    const quote = await createQuoteWithVariant(page.request, `P1d auction quote ${uniq}`);
    const variantPublicId = quote.funnels[0]?.variants[0]?.public_id;
    expect(variantPublicId, "quote create seeded a control variant").toBeTruthy();
    const auction = await createAuction(page.request, `P1d auction ${uniq}`, quote.id);

    // Reference the auction from the quote's own control variant
    // (leadgen_funnel_variants.auction_id) — the SAME field
    // auctionReferencingVariants (auctions-handlers.ts) checks for both the
    // DELETE guard and the Usage "variants_referencing" kind.
    const refRes = await page.request.put(`${LG_API}/variants/${variantPublicId}`, {
      data: { auction_id: auction.id },
    });
    expect(refRes.ok(), `auction reference attach HTTP ${refRes.status()}`).toBeTruthy();

    await page.goto(`/admin/leadgen/auction?search=${uniq}`, { waitUntil: "domcontentloaded" });
    const row = page.locator(`tr[data-entity-id="${auction.public_id}"]`);
    await expect(row.getByRole("link", { name: "Edit" })).toBeVisible();
    await row.getByRole("button", { name: /More actions/i }).click();
    // Opening the kebab REPARENTS its menu to <body> (a portal — see
    // layout.ts kebabMenuScript's own doc comment) — locate items via
    // page.locator(the exact public-id value) from here on. No Duplicate —
    // auctions have no duplicate endpoint (router.ts).
    const archiveBtn = page.locator(`[data-auction-archive="${auction.public_id}"]`);
    await expect(page.locator(`[data-auction-usage="${auction.public_id}"]`)).toBeVisible();
    await expect(archiveBtn).toBeVisible();
    await expect(page.locator(`[data-auction-delete="${auction.public_id}"]`)).toBeVisible();
    await expect(page.locator(`[data-auction-duplicate="${auction.public_id}"]`)).toHaveCount(0);

    // Archive -> Reactivate round-trips status. Both are the unconditional
    // PATCH {status} leg — they succeed regardless of the reference just
    // established; only Delete guards.
    page.once("dialog", (d) => void d.accept());
    await archiveBtn.click();
    const rowAfterArchive = page.locator(`tr[data-entity-id="${auction.public_id}"]`);
    await expect(rowAfterArchive.getByRole("button", { name: /More actions/i })).toBeVisible({ timeout: 10_000 });
    await rowAfterArchive.getByRole("button", { name: /More actions/i }).click();
    const reactivateBtn = page.locator(`[data-auction-reactivate="${auction.public_id}"]`);
    await expect(reactivateBtn, "Archive flips to a Reactivate item after reload").toBeVisible();
    await expect(page.locator(`[data-auction-archive="${auction.public_id}"]`)).toHaveCount(0);
    const archivedReadBack = await json<{ status: string }>(
      await page.request.get(`${LG_API}/auctions/${auction.public_id}`),
      "p1d auction read-back after archive",
    );
    expect(archivedReadBack.status, "server status is archived").toBe("archived");

    page.once("dialog", (d) => void d.accept());
    await reactivateBtn.click();
    const rowAfterReactivate = page.locator(`tr[data-entity-id="${auction.public_id}"]`);
    await expect(rowAfterReactivate.getByRole("button", { name: /More actions/i })).toBeVisible({ timeout: 10_000 });
    await rowAfterReactivate.getByRole("button", { name: /More actions/i }).click();
    await expect(
      page.locator(`[data-auction-archive="${auction.public_id}"]`),
      "Reactivate flips back to an Archive item after reload",
    ).toBeVisible();
    await expect(page.locator(`[data-auction-reactivate="${auction.public_id}"]`)).toHaveCount(0);
    const reactivatedReadBack = await json<{ status: string }>(
      await page.request.get(`${LG_API}/auctions/${auction.public_id}`),
      "p1d auction read-back after reactivate",
    );
    expect(reactivatedReadBack.status, "server status round-trips back to active").toBe("active");

    // Usage: the auction IS referenced (the variant's own auction_id, set
    // above) — the panel must render the non-empty "referencing" leg, not
    // the empty-state copy. The kebab is ALREADY open here (the archive-flip
    // check above opened it and nothing since has closed it) — the toggle
    // button toggles, so clicking it again would close it, not re-open it.
    await page.locator(`[data-auction-usage="${auction.public_id}"]`).click();
    const usagePanel = page.locator(`[data-auction-usage-row="${auction.public_id}"] [data-auction-usage-panel]`);
    await expect(usagePanel).toContainText("Funnel variants referencing this auction: 1");
    await expect(usagePanel).not.toContainText("Not referenced by any live funnel variant");

    // Delete on a referenced auction is guarded — the server's
    // plain-language 409 message surfaces verbatim, not a raw error.
    let alertMessage = "";
    page.on("dialog", (d) => {
      if (d.type() === "alert") alertMessage = d.message();
      void d.accept();
    });
    await rowAfterReactivate.getByRole("button", { name: /More actions/i }).click();
    await page.locator(`[data-auction-delete="${auction.public_id}"]`).click();
    await expect
      .poll(() => alertMessage, { timeout: 10_000, message: "the 409 alert must have fired" })
      .toBe("This auction is used by a live funnel variant — archive it instead");
  });
});

// ---------------------------------------------------------------------------
// Fix-round: Usage-panel coherence (P1c's sectionUsageHandler shape carries
// TWO independent, non-cascading references — variants AND rules; the SAME
// two legs deleteSectionHandler's guard checks) — a section blocked ONLY by
// a funnel rule's target_section_id must show it in Usage, not the
// variants-only "not used" copy the pre-fix-round panel rendered.
// ---------------------------------------------------------------------------

test.describe("P1d fix-round — sections Usage panel shows the rules leg (usage coherence)", () => {
  test("a section referenced ONLY by a rule's target_section_id (never placed in a variant's own section order) shows 'Used by 1 funnel rule(s)' in Usage", async ({
    page,
  }) => {
    const quote = await createQuoteWithVariant(page.request, `P1d rule-usage quote ${uniq}`);
    const section = await createSection(page.request, `P1d rule-usage sec ${uniq}`);
    const variantPublicId = quote.funnels[0]?.variants[0]?.public_id;
    expect(variantPublicId, "quote create seeded a control variant").toBeTruthy();

    // Mirrors test/leadgen-p1c-lifecycle.test.ts's "referenced ONLY by a
    // funnel rule's target_section_id" seed via HTTP: attach a rule
    // targeting the section WITHOUT ever placing it in the variant's own
    // `sections` order — the two references are independent.
    const ruleRes = await page.request.put(`${LG_API}/variants/${variantPublicId}`, {
      data: { rules: [{ rule_type: "skip_section", target_section_id: section.id }] },
    });
    expect(ruleRes.ok(), `rule attach HTTP ${ruleRes.status()}`).toBeTruthy();

    // Server truth first (the same guard Usage must agree with): DELETE
    // 409s with usage.rules populated and usage.variants empty.
    const guarded = await page.request.delete(`${LG_API}/sections/${section.public_id}`);
    expect(guarded.status(), "DELETE is guarded by the rule reference").toBe(409);
    const guardedBody = await guarded.json();
    expect(guardedBody.usage.variants).toHaveLength(0);
    expect(guardedBody.usage.rules).toHaveLength(1);

    // The list's Usage panel must show the SAME fact, not "not used".
    await page.goto(`/admin/leadgen/sections?search=${uniq}`, { waitUntil: "domcontentloaded" });
    const row = page.locator(`tr[data-entity-id="${section.id}"]`);
    await row.getByRole("button", { name: /More actions/i }).click();
    await page.locator(`[data-section-usage="${section.public_id}"]`).click();
    const panel = page.locator(`[data-section-usage-row="${section.public_id}"] [data-section-usage-panel]`);
    await expect(panel).toContainText("Used by 1 funnel rule(s)");
    // the pre-formatted rule name (readSectionRuleReferences, sections-
    // handlers.ts) embeds the owning Quote's name — proves the panel is
    // rendering the REAL row.name text, not just a bare count.
    await expect(panel).toContainText(`P1d rule-usage quote ${uniq}`);
    await expect(panel).not.toContainText("Not used by any funnel variant or rule.");
  });
});

// ---------------------------------------------------------------------------
// AC-3 — a guarded Delete surfaces the server's plain-language 409 verbatim
// ---------------------------------------------------------------------------

test.describe("P1d AC-3 — guarded quote Delete surfaces the plain-language 409", () => {
  test("deleting a quote with a live site activation shows the server's message verbatim, not a raw error", async ({
    page,
  }) => {
    const quote = await createQuote(page.request, `P1d guarded ${uniq}`);
    const site = await createSite(page.request, `P1d Guard Site ${uniq}`);
    const activation = await page.request.put(`${LG_API}/quotes/${quote.public_id}/activation/${site.id}`, {
      data: { slug: `p1d-guarded-${uniq}` },
    });
    expect(activation.ok(), `activation seed HTTP ${activation.status()}`).toBeTruthy();

    await page.goto(`/admin/leadgen/quotes?search=${uniq}`, { waitUntil: "domcontentloaded" });
    const row = page.locator(`tr[data-entity-id="${quote.public_id}"]`);

    let alertMessage = "";
    // A persistent handler (not .once twice) — the confirm() fires first,
    // then the window.alert() carrying the server's verbatim 409 message;
    // both must be accepted, but only the alert's text is the assertion.
    page.on("dialog", (d) => {
      if (d.type() === "alert") alertMessage = d.message();
      void d.accept();
    });
    await row.getByRole("button", { name: /More actions/i }).click();
    // Opening the kebab reparents its menu to <body> (a portal — see
    // layout.ts kebabMenuScript's doc comment) — locate the item via
    // page.locator(the exact public-id value), not row-scoped.
    await page.locator(`[data-quote-delete="${quote.public_id}"]`).click();

    await expect
      .poll(() => alertMessage, { timeout: 10_000, message: "the 409 alert must have fired" })
      .toBe("This quote has live history — archive it instead");
  });
});

// ---------------------------------------------------------------------------
// AC-4 — renderHeaderCta phone-only default label (P-10d, row R4-36)
// ---------------------------------------------------------------------------

test.describe("P1d AC-4 — renderHeaderCta defaults a phone-only CTA's label to 'Call now'", () => {
  test("enabled + tel set + no label renders an anchor with 'Call now' and href=tel:...", () => {
    const html = renderHeaderCta({ enabled: true, label: "", href: null, tel: "+1 555-123-4567" });
    // Fail-before (verified by reading frame.ts at the parent commit, before
    // this slice's fix): `if (label === "" || href === null) return "";` —
    // an empty label short-circuited the WHOLE anchor even with a valid tel,
    // so this exact input rendered "" at the parent commit (no "Call now",
    // no href) — the defect the P-10d probe reproduced (Part C P-10d).
    expect(html).toContain(">Call now</a>");
    expect(html).toContain('href="tel:+1 555-123-4567"');
  });

  test("enabled + tel set + an explicit label keeps the author's label (no regression)", () => {
    const html = renderHeaderCta({ enabled: true, label: "Ring us", href: null, tel: "+15551234567" });
    expect(html).toContain(">Ring us</a>");
    expect(html).toContain('href="tel:+15551234567"');
  });

  test("enabled + href only (no tel, no label) still renders nothing — no sensible default text exists", () => {
    const html = renderHeaderCta({ enabled: true, label: "", href: "https://example.com/call", tel: null });
    expect(html).toBe("");
  });

  test("disabled CTA renders nothing regardless of tel/label", () => {
    const html = renderHeaderCta({ enabled: false, label: "", href: null, tel: "+15551234567" });
    expect(html).toBe("");
  });
});
