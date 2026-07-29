// R2 P3 FIX-FIRST — the DRIVEN acceptance for the adversarial review's
// 2 BLOCKERS + 3 MAJORS. Every action below is a REAL Playwright gesture
// (Locator.click / fill / selectOption / check — NEVER dispatchEvent, L-189),
// and every assertion reads the REAL product: the live /lg/:slug visitor route
// (serve.ts serveFunnelShell) and the real admin editor SSR + islands.
//
// Journeys:
//   A  the reviewer's WIPE repro, end to end — apply a saved template with 8
//      footer blocks, serve it, reopen Templates (the editor must now hydrate
//      the 8 rows it used to show as 0), change "Text size", Save, and prove
//      the visitor STILL gets the whole footer.
//   B  Image28 rebuilt through the real editor: SIX DISTINCT legal links on a
//      STOCK-seeded site (four of whose pages share page_type "legal") with
//      " | " separators, at 1280 AND 375.
//   C  Image45 rebuilt through the real editor: LEFT-ALIGNED body column,
//      underlined links, a styled list, a constrained centred logo, at 1280
//      AND 375.
//   D  the D2 two-site drive: the SAME saved pick set resolves per serving
//      site.
//
// Run (per-file, fresh D1, worktree-isolated, this worktree's dedicated port):
//   pkill -f "wrangler dev.*8901"; sleep 1
//   npm run db:reset:local
//   PW_PORT=8901 npx playwright test test-ui/leadgen-p3-fixround-footer.gesture.spec.ts \
//     --project=chromium --workers=1 --reporter=line --timeout=180000
//   (repeat with --project=firefox for the second engine)
//
// ENGINE NOTE: registered in playwright.config.ts's CROSS_ENGINE_GESTURE_SPECS
// (R2 P3 tail-2, item 1) — runs on BOTH chromium and firefox. Every visitor
// assertion navigates a dynamic {uniq}.e2e.test tenant host (the worker's
// site-match reads the Host header, so 127.0.0.1 alone will not do): chromium
// resolves it via the wildcard --host-resolver-rules launch arg below;
// firefox's network.dns.localDomains pref has no wildcard form (an exact,
// static, comma-separated host list only — resolved at module-load, before
// any beforeAll mints a runtime value, the SAME ordering constraint
// leadgen-runtime-inputs.gesture.spec.ts's own doc comment names), so E2E_HOSTS
// below enumerates every literal *.e2e.test host this file visits (built from
// `uniq`, computed ONE line earlier so it exists before test.use() reads it).

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join } from "node:path";
import { PW_PORT } from "./utils/base-url";
import { seedActiveSite } from "./listicles-p6-seed";

const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
// Every *.e2e.test host visitFooter() navigates to, below — kept as literal
// prefixes (not derived) so a new journey that forgets to add its host here
// fails LOUDLY on firefox (NS_ERROR_UNKNOWN_HOST) rather than silently.
const E2E_HOSTS = [
  `p3fx-wipe-${uniq}.e2e.test`,
  `p3fx-i28-${uniq}.e2e.test`,
  `p3fx-i45-${uniq}.e2e.test`,
  `p3fx-d2a-${uniq}.e2e.test`,
  `p3fx-d2b-${uniq}.e2e.test`,
].join(",");

test.use({
  launchOptions: {
    args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"],
    firefoxUserPrefs: { "network.dns.localDomains": E2E_HOSTS },
  },
  viewport: { width: 1280, height: 900 },
});
test.describe.configure({ mode: "serial" });

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const LG_API = "/api/admin/leadgen";
const EVIDENCE = join(process.cwd(), "..", "docs", "leadgen", "r2", "evidence", "p3", "fixround");

mkdirSync(EVIDENCE, { recursive: true });

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

const CONTINUE = { type: "ContinueButton", question_id: "cont", props: { label: "Continue" } };

interface SeededQuote {
  quotePublicId: string;
  funnelPublicId: string;
  variantPublicId: string;
  activity: string;
  vertical: string;
}

// A quote + funnel + control variant carrying ONE real section, plus the
// mandatory shared first page — all through the REAL admin API.
async function seedQuote(request: APIRequestContext, tag: string): Promise<SeededQuote> {
  const u = `${uniq}${tag}`;
  const activity = `p3fx_${tag}_${uniq}`;
  const vertical = `p3fx_${tag}`;
  const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, { data: { quote_name: `P3FX ${tag} ${u}`, activity, verticals: [vertical] } }),
    "quote create",
  );
  const funnelPublicId = quote.funnels[0]!.public_id;
  const variantPublicId = quote.funnels[0]!.variants[0]!.public_id;
  const section = await json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: `P3FX ${tag} step ${u}`,
        activity,
        vertical,
        status: "active",
        headline_text: "Insurance Details",
        continue_mode: "button",
        content_json: { components: [{ type: "TwoButtonYesNo", question_id: `q_${tag}`, question_key: `f_${tag}`, internal_field: `f_${tag}`, answer_type: "boolean", required: true }, CONTINUE] },
      },
    }),
    "section create",
  );
  await json(
    await request.put(`${LG_API}/variants/${variantPublicId}`, { data: { sections: [{ section_id: section.id, position: 0 }] } }),
    "variant sections",
  );
  const shared = await json<{ id: number }>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: `P3FX ${tag} shared ${u}`,
        activity,
        vertical,
        status: "active",
        headline_text: "Get started",
        continue_mode: "button",
        content_json: { components: [{ type: "ContinueButton", question_id: "shared_cont", props: { label: "Continue" } }] },
      },
    }),
    "shared section create",
  );
  await json(await request.post(`${LG_API}/quotes/${quote.public_id}/shared-page`, { data: { sections: [{ section_id: shared.id }] } }), "shared page");
  return { quotePublicId: quote.public_id, funnelPublicId, variantPublicId, activity, vertical };
}

async function activateOn(request: APIRequestContext, quotePublicId: string, siteId: string, slug: string): Promise<void> {
  await json(await request.put(`${LG_API}/quotes/${quotePublicId}/activation/${siteId}`, { data: { enabled: true, slug } }), "activation");
}

// The BLOCKER-2 collision shape, reproduced deterministically.
//
// A real stock site auto-seeds privacy-policy / terms / do-not-sell / contact
// (site-provisioning legal-renderer LEGAL_TEMPLATE_SLUGS) — and the reviewer's
// live picker feed showed FOUR rows sharing page_type "legal" on top of that.
// Provisioning runs on its own schedule though, so these fixtures carry a
// per-run slug prefix and are asserted by IDENTITY, never by a total count: the
// auto-seeded rows may or may not be present and the proof does not depend on
// it. FOUR of the six deliberately share page_type "legal" — that is the exact
// non-unique-identity collision under test.
const PAGE_PREFIX = `p3fx-${uniq}-`;
const STOCK_PAGES: Array<{ slug: string; title: string; page_type: string }> = [
  { slug: `${PAGE_PREFIX}contact`, title: "Contact", page_type: "legal" },
  { slug: `${PAGE_PREFIX}do-not-sell`, title: "Your Privacy Choices", page_type: "legal" },
  { slug: `${PAGE_PREFIX}state-law-privacy-notice`, title: "State Law Privacy Notice", page_type: "legal" },
  { slug: `${PAGE_PREFIX}licenses-disclosure`, title: "Licenses & Disclosure", page_type: "legal" },
  { slug: `${PAGE_PREFIX}privacy-policy`, title: "Privacy Policy", page_type: "legal" },
  { slug: `${PAGE_PREFIX}terms`, title: "Terms of Use", page_type: "legal" },
];

async function seedStockLegalPages(request: APIRequestContext, siteId: string): Promise<void> {
  for (const p of STOCK_PAGES) {
    await json(
      await request.post("/api/admin/pages", {
        data: { site_id: siteId, slug: p.slug, title: p.title, page_type: p.page_type, status: "published", show_in_footer: false },
      }),
      `page ${p.slug}`,
    );
  }
}

// A REAL 2000px-wide PNG uploaded through the REAL admin media API. MINOR-7's
// regression ("a 2000px logo is constrained") cannot be proven with a broken
// <img> — its box collapses to the alt text and any max-height passes
// vacuously. This uploads an actual oversized asset so the constraint is
// measured on a LOADED image, and it drives MINOR-10's media leg with a real
// storage key at the same time.
async function uploadWideLogo(request: APIRequestContext, siteId: string): Promise<string> {
  const png = buildWidePng(2000, 400);
  const res = await request.post("/api/admin/media/upload", {
    multipart: {
      file: { name: `p3fx-${uniq}-become-2000px.png`, mimeType: "image/png", buffer: png },
      alt_text: "Become",
      site_id: siteId,
    },
  });
  const body = await json<{ item: { storage_key: string } }>(res, "media upload");
  return body.item.storage_key;
}

// A minimal valid truecolour PNG, generated here (no binary fixture in the repo).
function buildWidePng(width: number, height: number): Buffer {
  const crcTable: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td), 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const off = y * (1 + width * 3);
    raw[off] = 0;
    for (let x = 0; x < width; x++) {
      raw[off + 1 + x * 3] = 40;
      raw[off + 2 + x * 3] = 20;
      raw[off + 3 + x * 3] = 70;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function openTemplatesTab(page: Page, quotePublicId: string): Promise<void> {
  // R2 P3 flake-fix (4b) — the navigation is now DETERMINISTIC.
  //
  // It used to race page.goto against a waitForResponse for the page-load GET
  // .../frame-template-records inside ONE Promise.all. When the previous
  // document was a live /lg funnel (its own subresources still in flight,
  // firefox), the 20s response wait expired with the browser STILL on /lg
  // (2/158 runs): the admin navigation had not committed yet, so the event it
  // waited for could not have arrived — the wait failed the test for a
  // condition it had made impossible.
  //
  // That wait is also redundant now. templates.ts's init() fires the GET on
  // every page load and renderApplyChoices() reads the in-memory `templates`
  // array it fills, but applyTemplate() below waits for the applied
  // template's OWN chip first — rendered from that same array, i.e. the real
  // commit signal for "the array is populated", not a network-timing guess.
  //
  // Sequence (no fixed sleep, no retry, nothing hidden):
  //   1. about:blank — ends the previous document's in-flight loads so the
  //      admin navigation can never queue behind them;
  //   2. an AWAITED goto with an explicit navigation timeout;
  //   3. assert the URL actually COMMITTED to the editor — the old failure
  //      mode ("still on /lg") now fails on exactly that, loudly;
  //   4. the tab + panel signals the page itself emits.
  await page.goto("about:blank");
  await page.goto(`/admin/leadgen/quotes/${quotePublicId}/edit`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await expect(page, "the editor navigation must COMMIT (fail-before: still on /lg)").toHaveURL(
    new RegExp(`/admin/leadgen/quotes/${quotePublicId}/edit`),
    { timeout: 20_000 },
  );
  await page.locator('[data-tab="templates"]').click();
  await expect(page.locator('[data-panel="templates"]')).toHaveClass(/active/);
  await expect(page.locator('[data-tplbox-panel="progress"]')).toBeVisible({ timeout: 20_000 });
}

async function openFooterBox(page: Page): Promise<void> {
  await page.locator('[data-tplbox-pick="footer"]').first().click();
  await expect(page.locator('[data-tplbox-panel="footer"]')).toHaveClass(/active/, { timeout: 10_000 });
}

// "+ New template" → name → Create: the REAL Templates-bar affordance, which
// POSTs the island's LIVE draft (currentEffectiveFrameForDraft) — i.e. exactly
// what the operator is looking at, including every block just authored above.
async function saveCurrentDesignAsTemplate(page: Page, name: string): Promise<{ public_id: string }> {
  await page.locator("#lg-tpl-new-btn").click();
  await expect(page.locator("#lg-tpl-new-form")).toBeVisible();
  await page.locator("#lg-tpl-new-name").fill(name);
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/frame-template-records") && r.request().method() === "POST", { timeout: 30_000 }),
    page.locator("#lg-tpl-new-save").click(),
  ]);
  expect(res.status(), `template create: ${await res.text()}`).toBe(201);
  await expect(page.locator("#lg-tpl-bar-error")).toHaveClass(/lg-hidden/);
  return (await res.json()) as { public_id: string };
}

// Apply a saved template to this funnel through the REAL apply dialog.
// `funnelPublicId` is the funnel the journey expects the apply to land on —
// asserted below (R2 P3 flake-fix 4a), never assumed.
async function applyTemplate(page: Page, templatePublicId: string, funnelPublicId: string): Promise<void> {
  // R2 P3 tail-2 (item 1) — the Apply dialog's renderApplyChoices() reads the
  // SAME in-memory `templates` array loadTemplates() (a page-load GET) fills;
  // it does not re-fetch on open. Right after a fresh reload (this template
  // was frequently just created via the real "+ New template" UI moments
  // ago), the network response landing is NOT the same instant as that array
  // being populated — waiting for THIS template's own chip in the templates
  // bar (rendered from that same array) is the precise signal, instead of a
  // flaky race between "Apply" clicked and loadTemplates()'s .then() running.
  await expect(page.locator(`[data-tpl-chip="${templatePublicId}"]`)).toBeVisible({ timeout: 20_000 });
  await page.locator("#lg-tpl-apply-btn").click();
  const dlg = page.locator("#lg-tpl-apply-dialog");
  await expect(dlg).toBeVisible();
  // the choice list is painted from an async loadTemplates() — wait for THIS
  // template's own card (the one about to be clicked), not merely "a card".
  await expect(dlg.locator(`[data-apply-choice="${templatePublicId}"]`)).toBeVisible({ timeout: 20_000 });
  await page.locator(`[data-apply-choice="${templatePublicId}"]`).click();
  await expect(dlg.locator('[data-apply-state="confirm"]')).toBeVisible({ timeout: 15_000 });
  const [applyRes] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/funnels/${funnelPublicId}/apply-template`) && r.request().method() === "POST",
    ),
    page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => null),
    page.locator("#lg-tpl-apply-confirm-btn").click(),
  ]);
  // R2 P3 flake-fix (4a): the apply POST's outcome used to be UNASSERTED — a
  // real 503 (or a 404 on another funnel) passed silently and the journey
  // then measured an empty footer as though the operator's template had been
  // applied. Both halves are now asserted: the status, and the funnel the
  // POST actually targeted (the URL the waiter matched, echoed here so a
  // future edit to the predicate cannot quietly widen it).
  expect(applyRes.status(), `apply-template POST ${applyRes.url()}`).toBe(200);
  expect(applyRes.url(), "the apply must target THIS funnel").toContain(`/funnels/${funnelPublicId}/apply-template`);
}

// The visitor's own footer, read off the LIVE /lg/:slug route.
interface FooterProbe {
  present: boolean;
  height: number;
  childCount: number;
  linkHrefs: string[];
  linkLabels: string[];
  linkDecorations: string[];
  separators: string[];
  blockAligns: Array<{ cls: string; align: string | null; textAlign: string; justify: string }>;
  listPaddingLeft: string;
  listStylePosition: string;
  logoBox: { w: number; h: number; natural: number } | null;
  headingTags: string[];
  overflow: boolean;
}

async function probeFooter(page: Page): Promise<FooterProbe> {
  return page.evaluate(() => {
    const f = document.querySelector(".lg-frame-footer2") as HTMLElement | null;
    if (f === null) {
      return {
        present: false, height: 0, childCount: 0, linkHrefs: [], linkLabels: [], linkDecorations: [], separators: [],
        blockAligns: [], listPaddingLeft: "", listStylePosition: "", logoBox: null, headingTags: [],
        overflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    }
    const links = Array.from(f.querySelectorAll("a.lg-frame-footer2-link")) as HTMLAnchorElement[];
    const list = f.querySelector(".lg-frame-footer2-list") as HTMLElement | null;
    const logo = f.querySelector(".lg-frame-footer2-logo-img") as HTMLImageElement | null;
    return {
      present: true,
      height: Math.round(f.getBoundingClientRect().height),
      childCount: f.children.length,
      linkHrefs: links.map((a) => new URL(a.href, location.href).pathname),
      linkLabels: links.map((a) => (a.textContent ?? "").trim()),
      linkDecorations: links.map((a) => getComputedStyle(a).textDecorationLine),
      separators: Array.from(f.querySelectorAll(".lg-frame-footer2-link-sep")).map((s) => s.textContent ?? ""),
      blockAligns: Array.from(f.children).map((el) => {
        const cs = getComputedStyle(el as HTMLElement);
        return {
          cls: (el.className || "").toString().split(" ").find((c) => c.startsWith("lg-frame-footer2-")) ?? "",
          align: el.getAttribute("data-align"),
          textAlign: cs.textAlign,
          justify: cs.justifyContent,
        };
      }),
      listPaddingLeft: list === null ? "" : getComputedStyle(list).paddingLeft,
      listStylePosition: list === null ? "" : getComputedStyle(list).listStylePosition,
      logoBox: logo === null ? null : { w: Math.round(logo.getBoundingClientRect().width), h: Math.round(logo.getBoundingClientRect().height), natural: logo.naturalWidth },
      headingTags: Array.from(f.querySelectorAll(".lg-frame-footer2-heading")).map((h) => h.tagName.toLowerCase()),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
}

async function visitFooter(page: Page, host: string, slug: string, width: number): Promise<FooterProbe> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`http://${host}:${PW_PORT}/lg/${slug}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#lg-funnel-root")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(300);
  return probeFooter(page);
}

let apiCtx: APIRequestContext;
test.beforeAll(async () => {
  apiCtx = await playwrightRequest.newContext({ baseURL: ORIGIN });
});
test.afterAll(async () => {
  await apiCtx.dispose();
});

// ===========================================================================
// A — BLOCKER-1: one benign save can never wipe the served footer
// ===========================================================================

test.describe("R2 P3 FIX-FIRST A — the wipe repro no longer wipes (BLOCKER-1)", () => {
  test("apply a saved template with 8 footer blocks → editor hydrates 8 rows → change Text size → Save → the visitor STILL gets the whole footer", async ({ page }) => {
    const host = `p3fx-wipe-${uniq}.e2e.test`;
    const siteId = await seedActiveSite(apiCtx, host, `P3FX wipe ${uniq}`);
    const seed = await seedQuote(apiCtx, "wipe");
    const slug = `p3fx-wipe-${uniq}`;
    await activateOn(apiCtx, seed.quotePublicId, siteId, slug);

    // The saved template the operator applies — 8 element-J footer blocks.
    const tpl = await json<{ id: number; public_id: string }>(
      await apiCtx.post(`${LG_API}/frame-template-records`, {
        data: {
          name: `P3FX Wipe ${uniq}`,
          frame_json: {
            template: "centered",
            version: 1,
            footer: {
              enabled: true,
              typography_scope: { size: "s" },
              blocks: [
                { type: "heading", align: "left", html: "Equal Opportunity Notice", level: 4 },
                { type: "about_paragraph", align: "left", text: "P3FX-WIPE-BLOCK-2", html: "P3FX-WIPE-BLOCK-2" },
                { type: "heading", align: "left", html: "Licensing &amp; Regulatory Status", level: 4 },
                { type: "about_paragraph", align: "left", text: "P3FX-WIPE-BLOCK-4", html: "P3FX-WIPE-BLOCK-4" },
                { type: "list", align: "left", items: ["P3FX-WIPE-ITEM-A", "P3FX-WIPE-ITEM-B"], list_style: "unordered" },
                { type: "link_row", align: "center", links_source: "manual", links: [{ label: "Terms And Conditions", href: "/terms" }] },
                { type: "disclosure", align: "center", text: "P3FX-WIPE-BLOCK-7", html: "P3FX-WIPE-BLOCK-7" },
                { type: "address", align: "center", text: "P3FX-WIPE-BLOCK-8" },
              ],
            },
          },
        },
      }),
      "wipe template create",
    );

    await openTemplatesTab(page, seed.quotePublicId);
    await applyTemplate(page, tpl.public_id, seed.funnelPublicId);

    // 1) the visitor is served the full footer.
    const before = await visitFooter(page, host, slug, 1280);
    expect(before.present, "the applied template's footer must serve").toBe(true);
    expect(before.childCount, "all 8 blocks serve before the save").toBe(8);
    expect(before.height, "a real footer band, not a 48px stripe").toBeGreaterThan(120);

    // 2) reopen Templates — the editor must hydrate what the visitor gets.
    await openTemplatesTab(page, seed.quotePublicId);
    await openFooterBox(page);
    const hydratedRows = page.locator('[data-tplbox-list="footer.blocks"] [data-footer-block-row]');
    await expect(hydratedRows, "FAIL-BEFORE: the editor showed 0 hydrated rows here").toHaveCount(8, { timeout: 15_000 });

    // 3) the reviewer's exact benign edit: change "Text size", then Save.
    await page.locator('[data-tplbox-panel="footer"] [data-frame-key="footer.typography_scope.size"]').selectOption("l");
    const [savePut] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/funnels/${seed.funnelPublicId}/frame`) && r.request().method() === "PUT", { timeout: 30_000 }),
      page.locator("#lg-variant-save").click(),
    ]);
    expect(savePut.status(), "the Save PUT is accepted").toBeLessThan(300);

    // what actually landed in the funnel's stored config
    const stored = await json<{ frame_config: { footer?: { blocks?: unknown[]; typography_scope?: { size?: string } } } | null }>(
      await apiCtx.get(`${LG_API}/funnels/${seed.funnelPublicId}/frame`),
      "frame after save",
    );
    expect(stored.frame_config?.footer?.typography_scope?.size, "the edit the operator MADE landed").toBe("l");
    expect(
      (stored.frame_config?.footer?.blocks ?? []).length,
      'FAIL-BEFORE: this stored {"typography_scope":{"size":"l"},"blocks":[]}',
    ).toBe(8);

    // 4) the visitor STILL gets the whole footer.
    const after = await visitFooter(page, host, slug, 1280);
    expect(after.present).toBe(true);
    expect(after.childCount, "the served block set survived the save").toBe(8);
    expect(after.height).toBeGreaterThan(120);
    await page.screenshot({ path: join(EVIDENCE, "fix-wipe-after-textsize-save-1280.png"), fullPage: true });

    const after375 = await visitFooter(page, host, slug, 375);
    expect(after375.childCount).toBe(8);
    expect(after375.overflow, "no horizontal overflow at 375").toBe(false);
    await page.screenshot({ path: join(EVIDENCE, "fix-wipe-after-textsize-save-375.png"), fullPage: true });
  });
});

// ===========================================================================
// B — Image28 rebuilt through the real editor
// ===========================================================================

test.describe("R2 P3 FIX-FIRST B — Image28 rebuilt through the real editor", () => {
  test("SIX DISTINCT legal links picked on a STOCK site (4 pages share page_type 'legal') with ' | ' separators, at 1280 and 375", async ({ page }) => {
    const host = `p3fx-i28-${uniq}.e2e.test`;
    const siteId = await seedActiveSite(apiCtx, host, `P3FX i28 ${uniq}`);
    await seedStockLegalPages(apiCtx, siteId);
    const seed = await seedQuote(apiCtx, "i28");
    const slug = `p3fx-i28-${uniq}`;
    await activateOn(apiCtx, seed.quotePublicId, siteId, slug);

    await openTemplatesTab(page, seed.quotePublicId);
    // the Templates canvas previews under a chosen site — pick ours so the
    // picker's "Load pages…" reads THIS site's own pages.
    await page.locator("#lg-tpl-site-select").selectOption(siteId);
    await openFooterBox(page);

    // --- author the link row through the REAL picker ------------------------
    await page.locator('[data-tplbox-add="footer.blocks"]').click();
    const row = page.locator('[data-tplbox-list="footer.blocks"] [data-footer-block-row]').first();
    await row.locator("[data-footer-block-type]").selectOption("link_row");
    await row.locator("[data-footer-block-align]").selectOption("center");
    await row.locator("[data-footer-block-linksource]").selectOption("picked");
    await row.locator("[data-footer-picks-load]").click();

    const pickRows = row.locator("[data-footer-pick-row]");
    await expect(pickRows.first(), "the picker feeds this site's candidates").toBeVisible({ timeout: 15_000 });
    const titles = await pickRows.locator("[data-footer-pick-title]").allTextContents();
    // BLOCKER-2, operator-visible half: SIX pages, all page_type "legal", must
    // be TELLABLE APART in the picker. Before the fix every one of them read
    // identically (title only, with page_type as the sole stored identity).
    expect(new Set(titles).size, "every picker option is distinguishable").toBe(titles.length);
    for (const p of STOCK_PAGES) {
      expect(titles.join("  ||  "), `the picker must identify /${p.slug}`).toContain(`(/${p.slug})`);
    }
    // Check exactly OUR six (the site may also carry provisioning's own
    // auto-seeded legal pages — this proof is by identity, never by count).
    for (const p of STOCK_PAGES) {
      const r = pickRows.filter({ has: page.locator(`[data-footer-pick-title]:text-is("${p.title} (/${p.slug})")`) });
      await expect(r, `one picker row for /${p.slug}`).toHaveCount(1);
      await r.locator("[data-footer-pick-checked]").check();
      await r.locator("[data-footer-pick-label]").fill(p.title);
    }

    // --- the Image28 separator ---------------------------------------------
    const footerBox = page.locator('[data-tplbox-panel="footer"]');
    await footerBox.locator('[data-frame-key="footer.link_separator"]').fill(" | ");
    await footerBox.locator('[data-frame-key="footer.enabled"]').check();

    // --- save the template, then apply it to the funnel ---------------------
    const saved = await saveCurrentDesignAsTemplate(page, `P3FX Image28 ${uniq}`);

    await openTemplatesTab(page, seed.quotePublicId);
    await applyTemplate(page, saved.public_id, seed.funnelPublicId);

    // --- the visitor -------------------------------------------------------
    for (const width of [1280, 375]) {
      const probe = await visitFooter(page, host, slug, width);
      expect(probe.present, `footer serves at ${width}`).toBe(true);
      expect(probe.linkHrefs, `six links at ${width}`).toHaveLength(6);
      expect(new Set(probe.linkHrefs).size, `FAIL-BEFORE: all six pointed at ONE page (${width})`).toBe(6);
      expect([...probe.linkHrefs].sort(), `the six picked pages at ${width}`).toEqual(STOCK_PAGES.map((p) => `/${p.slug}`).sort());
      // The BLOCKER-2 claim itself: each LABEL must point at ITS OWN page.
      // (Row order follows the picker's own listPickableLegalPages sort, not
      // the STOCK_PAGES literal — the pairing is what the defect broke.)
      const served = new Map(probe.linkLabels.map((l, i) => [l, probe.linkHrefs[i]!]));
      for (const p of STOCK_PAGES) {
        expect(served.get(p.title), `FAIL-BEFORE: "${p.title}" pointed at another page (${width})`).toBe(`/${p.slug}`);
      }
      expect(probe.separators, `n-1 separators at ${width}`).toHaveLength(5);
      expect(new Set(probe.separators)).toEqual(new Set([" | "]));
      expect(probe.overflow, `no horizontal overflow at ${width}`).toBe(false);
      await page.screenshot({ path: join(EVIDENCE, `fix-image28-${width}.png`), fullPage: true });
    }
  });
});

// ===========================================================================
// C — Image45 rebuilt through the real editor
// ===========================================================================

test.describe("R2 P3 FIX-FIRST C — Image45 rebuilt through the real editor", () => {
  test("LEFT-ALIGNED body, underlined links, a styled list and a constrained centred logo, at 1280 and 375", async ({ page }) => {
    const host = `p3fx-i45-${uniq}.e2e.test`;
    const siteId = await seedActiveSite(apiCtx, host, `P3FX i45 ${uniq}`);
    const seed = await seedQuote(apiCtx, "i45");
    const slug = `p3fx-i45-${uniq}`;
    await activateOn(apiCtx, seed.quotePublicId, siteId, slug);

    const logoKey = await uploadWideLogo(apiCtx, siteId);

    await openTemplatesTab(page, seed.quotePublicId);
    await page.locator("#lg-tpl-site-select").selectOption(siteId);
    await openFooterBox(page);
    const footerBox = page.locator('[data-tplbox-panel="footer"]');
    await footerBox.locator('[data-frame-key="footer.enabled"]').check();
    // MAJOR-5 — the owner's pin shows UNDERLINED legal links.
    await footerBox.locator('[data-frame-key="footer.link_underline"]').check();

    // The Image45 anatomy, authored block by block through the real editor.
    const rows = page.locator('[data-tplbox-list="footer.blocks"] [data-footer-block-row]');
    interface Block { type: string; align: string; text?: string; items?: string; level?: string }
    const BLOCKS: Block[] = [
      { type: "about_paragraph", align: "left", text: "Become Co Ltd. is a free online lead-generator that connects users with independent providers." },
      { type: "heading", align: "left", text: "Equal Opportunity Notice", level: "4" },
      { type: "about_paragraph", align: "left", text: "Become does not discriminate on the basis of race, color, religion, national origin, gender, marital status, or age." },
      { type: "heading", align: "left", text: "Licensing and Regulatory Status", level: "4" },
      { type: "list", align: "left", items: "Not a security provider\nNot an equipment manufacturer\nNot a licensed installer" },
      { type: "link_row", align: "center" },
      { type: "disclosure", align: "center", text: "2026 Become \u2013 All Rights Reserved." },
      { type: "logo", align: "center" },
    ];
    for (let i = 0; i < BLOCKS.length; i++) {
      const b = BLOCKS[i]!;
      await page.locator('[data-tplbox-add="footer.blocks"]').click();
      const row = rows.nth(i);
      await row.locator("[data-footer-block-type]").selectOption(b.type);
      await row.locator("[data-footer-block-align]").selectOption(b.align);
      if (b.text !== undefined) await row.locator("[data-footer-block-text]").fill(b.text);
      if (b.level !== undefined) await row.locator("[data-footer-block-level]").selectOption(b.level);
      if (b.items !== undefined) await row.locator("[data-footer-block-items]").fill(b.items);
      if (b.type === "link_row") {
        await row.locator("[data-footer-block-linksource]").selectOption("manual");
        for (const link of [
          { label: "Terms And Conditions", href: "/terms" },
          { label: "Privacy Policy", href: "/privacy-policy" },
        ]) {
          await row.locator("[data-footer-block-link-add]").click();
          const lr = row.locator("[data-footer-link-row]").last();
          await lr.locator("[data-footer-link-label]").fill(link.label);
          await lr.locator("[data-footer-link-href]").fill(link.href);
        }
      }
      if (b.type === "logo") {
        await row.locator("[data-footer-block-logosource]").selectOption("manual");
        // The REAL Media-library affordance: "Choose…" opens the shared
        // #lg-media-picker overlay and the operator clicks the asset. (The
        // media_id input itself is type=hidden by design — filling it would
        // bypass the very gesture under test.)
        await row.locator("[data-media-choose]").click();
        const picker = page.locator("#lg-media-picker");
        await expect(picker).toBeVisible({ timeout: 15_000 });
        await picker.locator(`[data-media-pick="${logoKey}"]`).click();
        await expect(picker).toBeHidden({ timeout: 10_000 });
        await expect(row.locator('[data-list-field="logo_media_id"]')).toHaveValue(logoKey);
        await row.locator("[data-footer-block-logoalt]").fill("Become");
      }
    }

    const saved = await saveCurrentDesignAsTemplate(page, `P3FX Image45 ${uniq}`);

    await openTemplatesTab(page, seed.quotePublicId);
    await applyTemplate(page, saved.public_id, seed.funnelPublicId);

    for (const width of [1280, 375]) {
      const probe = await visitFooter(page, host, slug, width);
      expect(probe.present, `footer serves at ${width}`).toBe(true);

      // MAJOR-3 — the per-block alignment control is LIVE: the left blocks
      // compute text-align:left while their centred siblings stay centred.
      const lefts = probe.blockAligns.filter((b) => b.align === "left");
      const centers = probe.blockAligns.filter((b) => b.align === "center");
      expect(lefts.length, `left-aligned blocks at ${width}`).toBeGreaterThanOrEqual(5);
      for (const b of lefts) {
        expect(b.textAlign, `FAIL-BEFORE: ${b.cls} rendered centered (${width})`).toBe("left");
      }
      for (const b of centers) {
        if (b.cls === "lg-frame-footer2-links") expect(b.justify, `${b.cls} @${width}`).toBe("center");
        else expect(b.textAlign, `${b.cls} @${width}`).toBe("center");
      }

      // MAJOR-4 — the list ships real CSS: no UA 40px indent, markers inside.
      expect(probe.listPaddingLeft, `list padding at ${width}`).toBe("0px");
      expect(probe.listStylePosition, `list marker position at ${width}`).toBe("inside");
      // …and the heading level the operator chose actually rendered.
      expect(probe.headingTags, `heading levels at ${width}`).toEqual(["h4", "h4"]);
      // MINOR-7 — the logo is constrained inside the band.
      expect(probe.logoBox, `logo present at ${width}`).not.toBeNull();
      expect(probe.logoBox!.natural, `the 2000px asset actually LOADED at ${width}`).toBe(2000);
      expect(probe.logoBox!.h, `FAIL-BEFORE: 400px tall, unconstrained (${width})`).toBeLessThanOrEqual(80);
      expect(probe.logoBox!.w, `FAIL-BEFORE: 2000px wide blew the band out (${width})`).toBeLessThanOrEqual(width);

      // MAJOR-5 — the underline axis is live on the real anchors.
      expect(probe.linkDecorations.length, `links at ${width}`).toBe(2);
      for (const d of probe.linkDecorations) expect(d, `FAIL-BEFORE: text-decoration:none (${width})`).toContain("underline");

      expect(probe.overflow, `no horizontal overflow at ${width}`).toBe(false);
      await page.screenshot({ path: join(EVIDENCE, `fix-image45-${width}.png`), fullPage: true });
    }
  });
});

// ===========================================================================
// D — the D2 two-site drive still resolves per serving site
// ===========================================================================

test.describe("R2 P3 FIX-FIRST D — one saved pick set, two serving sites (D2)", () => {
  test("the SAME saved template serves each site's OWN pages — shared slugs resolve by slug, a site that RENAMED its page still resolves by page_type, and a site missing one degrades without borrowing", async ({ page }) => {
    const hostA = `p3fx-d2a-${uniq}.e2e.test`;
    const hostB = `p3fx-d2b-${uniq}.e2e.test`;
    const siteA = await seedActiveSite(apiCtx, hostA, `P3FX D2A ${uniq}`);
    const siteB = await seedActiveSite(apiCtx, hostB, `P3FX D2B ${uniq}`);
    await seedStockLegalPages(apiCtx, siteA);

    // Site B is deliberately NOT a slug-for-slug clone — it is the real-world
    // case D2 exists for: the same page TYPES, this site's OWN addresses.
    // Two of A's six slugs are SHARED (the slug leg must resolve to B's OWN
    // rows, not A's) and four are B-unique (the page_type leg must find B's own
    // differently-slugged page). Every slug is per-run prefixed, so site
    // provisioning's auto-seeded legal set cannot satisfy any of them by
    // accident — the resolution proven here is the resolver's, not the seeder's.
    const B_PAGES = [
      { slug: `${PAGE_PREFIX}contact`, title: "Contact B", page_type: "legal", footer: true },
      { slug: `${PAGE_PREFIX}do-not-sell`, title: "Choices B", page_type: "legal", footer: false },
      { slug: `${PAGE_PREFIX}b-state-notice`, title: "State Notice B", page_type: "legal", footer: false },
      { slug: `${PAGE_PREFIX}b-datenschutz`, title: "Privacy B", page_type: "legal", footer: false },
      { slug: `${PAGE_PREFIX}b-terms-of-use`, title: "Terms B", page_type: "legal", footer: false },
    ];
    for (const p of B_PAGES) {
      await json(
        await apiCtx.post("/api/admin/pages", {
          data: { site_id: siteB, slug: p.slug, title: p.title, page_type: p.page_type, status: "published", show_in_footer: p.footer },
        }),
        `siteB page ${p.slug}`,
      );
    }

    const picks = STOCK_PAGES.map((p) => ({ page_type: p.page_type, slug: p.slug, label: p.title }));
    const tpl = await json<{ public_id: string }>(
      await apiCtx.post(`${LG_API}/frame-template-records`, {
        data: {
          name: `P3FX D2 ${uniq}`,
          frame_json: {
            template: "centered",
            version: 1,
            footer: { enabled: true, link_separator: " | ", blocks: [{ type: "link_row", align: "center", links_source: "picked", picks }] },
          },
        },
      }),
      "d2 template create",
    );

    const seedA = await seedQuote(apiCtx, "d2a");
    const seedB = await seedQuote(apiCtx, "d2b");
    const slugA = `p3fx-d2a-${uniq}`;
    const slugB = `p3fx-d2b-${uniq}`;
    await activateOn(apiCtx, seedA.quotePublicId, siteA, slugA);
    await activateOn(apiCtx, seedB.quotePublicId, siteB, slugB);
    for (const s of [seedA, seedB]) {
      await openTemplatesTab(page, s.quotePublicId);
      await applyTemplate(page, tpl.public_id, s.funnelPublicId);
    }

    const a = await visitFooter(page, hostA, slugA, 1280);
    expect(a.linkHrefs, "site A serves its own six, all distinct").toEqual(STOCK_PAGES.map((p) => `/${p.slug}`));
    await page.screenshot({ path: join(EVIDENCE, "fix-d2-siteA-1280.png"), fullPage: true });

    const b = await visitFooter(page, hostB, slugB, 1280);
    writeFileSync(
      join(EVIDENCE, "d2-two-site-hrefs.txt"),
      [
        "R2 P3 FIX-FIRST — D2 two-site drive (ONE saved pick set, driven on the live /lg route)",
        `saved picks (slug|page_type|label): ${picks.map((p) => `${p.slug}|${p.page_type}|${p.label}`).join("  ,  ")}`,
        "",
        `site A (${hostA}) serves: ${JSON.stringify(a.linkHrefs)}`,
        `site A publishes:         ${JSON.stringify(STOCK_PAGES.map((p) => `/${p.slug}`))}`,
        "",
        `site B (${hostB}) serves: ${JSON.stringify(b.linkHrefs)}`,
        `site B publishes:         ${JSON.stringify(B_PAGES.map((p) => `/${p.slug}`))}`,
        "",
        "B shares 2 of A's 6 slugs (slug leg) and publishes its OWN addresses for the rest",
        "(page_type leg). Zero B hrefs point at a page only A publishes.",
      ].join("\n") + "\n",
    );
    // ONE saved pick set; site B's OWN addresses. Order follows the operator's
    // authored order. Every href must be a page site B ITSELF publishes with
    // this run's prefix — a borrowed site-A row, or a provisioning-seeded
    // bare slug, would fail here.
    const bSlugs = new Set(B_PAGES.map((p) => `/${p.slug}`));
    for (const href of b.linkHrefs) {
      expect(bSlugs.has(href), `B href ${href} must be one of B's OWN pages`).toBe(true);
    }
    // the two SHARED slugs resolve through the slug leg — to B's rows
    expect(b.linkHrefs[0], "shared slug → slug leg, on B's own row").toBe(`/${PAGE_PREFIX}contact`);
    expect(b.linkHrefs[1], "shared slug → slug leg, on B's own row").toBe(`/${PAGE_PREFIX}do-not-sell`);
    // the four B-unique ones fall to the page_type leg and still land on B
    for (const href of b.linkHrefs.slice(2)) {
      expect(bSlugs.has(href), `page_type leg stayed on site B (${href})`).toBe(true);
    }
    // …and NOTHING resolved to a page only site A publishes.
    for (const a4 of STOCK_PAGES.slice(2).map((p) => `/${p.slug}`)) {
      expect(b.linkHrefs, `B must never serve A's ${a4}`).not.toContain(a4);
    }
    await page.screenshot({ path: join(EVIDENCE, "fix-d2-siteB-1280.png"), fullPage: true });
  });
});
