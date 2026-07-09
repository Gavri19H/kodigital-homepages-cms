// LeadGen fix-contract v2.4 Phase 4 Slice F — the ACCEPTANCE evidence pack for
// the Section Studio:
//
//   §8.11  ALL FOUR capability patterns authored THROUGH THE UI (library
//          click-to-add + "+ After" insertion points + tabbed inspectors —
//          never seeded JSON, never the Advanced raw-JSON surface), under the
//          DEFAULT design, screenshot-tested desktop + mobile
//          (test-artifacts/fix-p4/pattern-N-{desktop,mobile}.png), with the
//          saved content_json asserted to contain ONLY catalog types +
//          tokenized props (the model has no custom-CSS field — asserted).
//   §8.12  the browser flows NOT already covered by the studio spec's ①–⑦
//          (leadgen-section-studio.spec.ts): create Yes/No slide · dependent
//          dropdown via the Dependencies tab + the dependency SIM proof ·
//          ZIP validation slide · personal-details slide · icon card grid ·
//          range slider · main/Other values (choiceDisplay via the Choices
//          tab) · dependency + validation-state sims VISIBLY differ ·
//          desktop AND mobile previews at REAL widths (§9.4 test).
//   §9.4   the viewport toggle round-trip regression: desktop screenshot →
//          mobile (REAL 375px iframe, no transform scale — asserted) →
//          desktop again; first/last pixel dimensions equal + changed-pixel
//          ratio within the repo's visual-test budget (≤0.10% desktop,
//          listicles-visual.spec.ts §31.1 thresholds + its in-browser canvas
//          diff — no new deps).
//   §8.13  legacy-lossless: a PRE-P4 flat content_json (fixture copied from
//          test/leadgen-sample-answers.test.ts linkSectionWithComponents)
//          seeded via the REAL admin API, opened in the Studio, saved with NO
//          edits, re-fetched — SEMANTICALLY lossless (deep-equal) and
//          byte-equal (the save path JSON.parse→JSON.stringify chain
//          preserves key order; asserted).
//
// Determinism notes:
//   * every preview document swap is detected by marking the CURRENT iframe
//     root data-lg-stale="1" and waiting for an unmarked root — never by
//     timeouts racing the POST /sections/preview round trip;
//   * screenshots/DOM assertions wait for the runtime's hydration-complete
//     marker (data-lg-ready="1", engine.ts §3.5.1) so the pixel state is the
//     settled post-boot state.
//
// Seeding rides the REAL admin HTTP APIs only. Runs against the
// playwright.config.ts webServer (wrangler dev on :8787 with
// DEV_BYPASS_AUTH:true + ADMIN_HOST:127.0.0.1). Local D1 must be migrated +
// seeded once:
// `rm -rf .wrangler/state/v3/d1 && npm run db:migrate:local && npm run seed:local`.
//
// Screenshots (1280×800 page viewport) land in test-artifacts/fix-p4/.

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 } });

const SHOT_DIR = 'test-artifacts/fix-p4';
const LG_API = '/api/admin/leadgen';
const uniq = Date.now();

// One shared activity/vertical vocabulary for the whole file — the §8.2
// dropdowns are sourced from Offers, so a feeder Offer with this pair makes
// the pair pickable on /sections/new.
const ACT = `fixp4-act-${uniq}`;
const VERT = `fixp4-vert-${uniq}`;

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) {
    throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

interface StudioNode {
  type: string;
  question_id: string;
  question_key?: string;
  internal_field?: string;
  answer_type?: string;
  required?: boolean;
  choices?: Array<Record<string, unknown>>;
  choiceDisplay?: Record<string, unknown>;
  conditional?: Record<string, unknown>;
  props?: Record<string, unknown>;
  children?: StudioNode[];
  [key: string]: unknown;
}

interface SectionDetail {
  id: number;
  public_id: string;
  content_version: number;
  content_json: { components: StudioNode[] };
  [key: string]: unknown;
}

let feederSeeded = false;
// E1: the Activity/Vertical dropdowns are sourced from Offers — one static
// feeder Offer makes the file's ACT/VERT pair pickable on /sections/new.
async function ensureFeederOffer(request: APIRequestContext): Promise<void> {
  if (feederSeeded) return;
  await json(
    await request.post(`${LG_API}/offers`, {
      data: {
        offer_name: `FixP4 Feeder ${uniq}`,
        provider: 'fixp4prov',
        activity: ACT,
        vertical: VERT,
        conversion_tracking_method: 's2s_postback',
        offer_type: 'cpc',
        placements: [`pl-fixp4-${uniq}`],
        calls_provider_api: false,
        bid_source: 'static',
        cap_enabled: false,
      },
    }),
    'fixp4 feeder offer create',
  );
  feederSeeded = true;
}

async function createSection(
  request: APIRequestContext,
  name: string,
  contentJson: unknown,
  over: Record<string, unknown> = {},
): Promise<{ id: number; public_id: string }> {
  return json(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: name,
        activity: ACT,
        vertical: `${VERT}-seeded`,
        headline_text: name,
        continue_mode: 'button',
        status: 'active',
        content_json: contentJson,
        ...over,
      },
    }),
    `fixp4 section create (${name})`,
  );
}

async function fetchSection(request: APIRequestContext, publicId: string): Promise<SectionDetail> {
  return json<SectionDetail>(
    await request.get(`${LG_API}/sections/${publicId}`),
    `fixp4 section detail (${publicId})`,
  );
}

// ---------------------------------------------------------------------------
// Studio driving helpers (the operator's controls only — no raw JSON)
// ---------------------------------------------------------------------------

function pFrame(page: Page) {
  return page.frameLocator('#lg-preview-frame');
}

async function markPreviewStale(page: Page): Promise<void> {
  const root = pFrame(page).locator('#lg-funnel-root');
  if ((await root.count()) > 0) {
    await root.evaluate((el) => {
      el.setAttribute('data-lg-stale', '1');
    });
  }
}

async function waitFreshPreview(page: Page, viewport: 'desktop' | 'mobile'): Promise<void> {
  // a NEW srcdoc document (no stale marker) at the requested viewport…
  await expect(
    pFrame(page).locator(`#lg-funnel-root[data-viewport="${viewport}"]:not([data-lg-stale])`),
  ).toBeAttached({ timeout: 20_000 });
  // …hydrated to completion (engine.ts sets data-lg-ready after enterSection)
  await expect(
    pFrame(page).locator('#lg-funnel-root[data-lg-ready="1"]:not([data-lg-stale])'),
  ).toBeAttached({ timeout: 20_000 });
}

async function waitBootPreview(page: Page): Promise<void> {
  await expect(pFrame(page).locator('#lg-funnel-root[data-lg-ready="1"]')).toBeAttached({
    timeout: 20_000,
  });
}

async function refreshPreview(page: Page): Promise<void> {
  await markPreviewStale(page);
  await page.locator('#lg-preview-refresh').click();
  await waitFreshPreview(page, 'desktop');
}

async function setPreviewViewport(page: Page, viewport: 'desktop' | 'mobile'): Promise<void> {
  await markPreviewStale(page);
  await page.locator(`[data-preview-viewport="${viewport}"]`).click();
  await waitFreshPreview(page, viewport);
}

// The preview boot posts its would-fire view events (quote_view +
// section_view) to the §8.9 events panel a beat AFTER hydration (beacon batch
// → postMessage). The panel's unbreakable compact-JSON lines USED TO stretch
// the whole admin layout past the viewport; the §8.1/E6 studio layout-hygiene
// fix (ui-section-studio.ts: .studio-events-list li overflow-wrap:anywhere +
// word-break, and .admin-main{min-width:0}) has since landed and contains them
// — the pin at the bottom of this file now GUARDS that fix. The panel's
// compact-JSON content still varies a few chars per boot (per-boot ids), so
// every preview measurement/screenshot first WAITS for the events to land
// (deterministic sequencing of the async side effect) and then removes that
// per-boot-varying content, so the § under test gets a clean, stable signal.
// Idempotent per preview document (marker on the srcdoc root).
async function waitForStudioEvents(page: Page): Promise<void> {
  await expect
    .poll(async () => page.locator('[data-studio-events-list] li').count(), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2);
}

async function settleEventsNoise(page: Page): Promise<void> {
  const root = pFrame(page).locator('#lg-funnel-root');
  if ((await root.getAttribute('data-lg-noise-consumed')) === '1') return;
  await waitForStudioEvents(page);
  await page.evaluate(() => {
    document.querySelectorAll('[data-studio-events-list] li').forEach((li) => li.remove());
  });
  await root.evaluate((el) => {
    el.setAttribute('data-lg-noise-consumed', '1');
  });
}

async function shootPreview(page: Page, file: string): Promise<Buffer> {
  await settleEventsNoise(page);
  await page.waitForTimeout(200); // paint settle (listicles-visual idiom)
  return page.locator('#lg-preview-frame').screenshot({ path: `${SHOT_DIR}/${file}` });
}

// Open /sections/new with the feeder pair picked + name/headline filled and
// the boot preview document hydrated (so later stale-marking is race-free).
async function openNewStudio(page: Page, name: string): Promise<void> {
  await ensureFeederOffer(page.request);
  await page.goto('/admin/leadgen/sections/new', { waitUntil: 'domcontentloaded' });
  const activity = page.locator('#lg-section-activity');
  await expect(activity.locator(`option[value="${ACT}"]`)).toHaveCount(1);
  await activity.selectOption(ACT);
  const vertical = page.locator('#lg-section-vertical');
  await expect(vertical.locator(`option[value="${VERT}"]`)).toHaveCount(1);
  await vertical.selectOption(VERT);
  await page.fill('#lg-section-name', name);
  await page.fill('#lg-section-headline', name);
  await waitBootPreview(page);
}

// Library click-to-add. addFromLibrary drops INTO the selected container (or
// appends at root) and moves the selection to the new node — asserted via the
// inspector target line ("Editing q_… (<Type>)").
async function addComponent(page: Page, type: string): Promise<void> {
  const target = page.locator('#lg-inspector-target');
  const before = (await target.textContent()) ?? '';
  await page.locator(`[data-add-component="${type}"]`).click();
  await expect(target).toContainText(`(${type})`);
  const after = (await target.textContent()) ?? '';
  expect(after, `selection moved to the newly added ${type}`).not.toBe(before);
}

// Arm the "+ After" insertion point on the CURRENT selection, then add — the
// §8.4 way to append the next SIBLING inside the same container.
async function addAfterSelected(page: Page, type: string): Promise<void> {
  await page.locator('[data-studio-act="add-after"]').click();
  await expect(page.locator('[data-studio-act="add-after"]')).toHaveAttribute('aria-pressed', 'true');
  await addComponent(page, type);
}

async function openInspectorTab(page: Page, key: string): Promise<void> {
  await page.locator(`[data-studio-inspector-tab="${key}"]`).click();
}

// §8.6 Content tab copy field (data-inspector-field hooks are key-unique).
async function setContentField(page: Page, key: string, value: string): Promise<void> {
  await openInspectorTab(page, 'content');
  await page.locator(`input[data-inspector-field="${key}"]`).fill(value);
}

// §8.6 Advanced tab internal_field (the sanctioned rename surface).
async function setInternalField(page: Page, value: string): Promise<void> {
  await openInspectorTab(page, 'advanced');
  await page.locator('input[data-inspector-field="internal_field"]').fill(value);
}

// §8.6 Validation tab rule input (min/max/step/maxLen).
async function setValidationProp(page: Page, key: string, value: string): Promise<void> {
  await openInspectorTab(page, 'validation');
  await page.locator(`[data-inspector-vprop="${key}"]`).fill(value);
}

// §8.5 Layout tab container prop (scoped by container group — keys repeat
// across groups; only the selected type's group is visible).
function containerGroup(page: Page, type: string) {
  return page.locator(`[data-container-group="${type}"]`);
}

function choiceRows(page: Page) {
  return page.locator('[data-inspector-choices] [data-choice-row]');
}

async function fillChoiceRow(page: Page, index: number, fields: Record<string, string>): Promise<void> {
  const row = choiceRows(page).nth(index);
  for (const [key, value] of Object.entries(fields)) {
    await row.locator(`input[data-choice-field="${key}"]`).fill(value);
  }
}

async function saveStudio(page: Page): Promise<void> {
  await Promise.all([page.waitForEvent('load'), page.locator('#lg-section-save').click()]);
}

function publicIdFromUrl(page: Page): string {
  const m = page.url().match(/\/sections\/(lgs_[^/]+)\/edit/);
  if (!m || m[1] === undefined) throw new Error(`no section public id in ${page.url()}`);
  return m[1];
}

// ---------------------------------------------------------------------------
// §8.11 "no custom CSS anywhere" — the saved model carries ONLY catalog types
// + the typed node keys; props are tokenized values, never stylesheet text.
// ---------------------------------------------------------------------------

const NODE_KEYS = new Set([
  'type',
  'question_id',
  'question_key',
  'internal_field',
  'answer_type',
  'required',
  'valid_values',
  'choices',
  'choiceDisplay',
  'conditional',
  'design_preset',
  'design_overrides',
  'props',
  'children',
  'container_id',
]);

function collectNodes(nodes: StudioNode[], out: StudioNode[] = []): StudioNode[] {
  for (const node of nodes) {
    out.push(node);
    if (Array.isArray(node.children)) collectNodes(node.children, out);
  }
  return out;
}

function assertTokenizedModel(content: { components: StudioNode[] }, allowedTypes: string[]): void {
  for (const node of collectNodes(content.components)) {
    expect(allowedTypes, `node type '${node.type}' is one of the authored catalog types`).toContain(
      node.type,
    );
    for (const key of Object.keys(node)) {
      expect(NODE_KEYS.has(key), `node key '${key}' belongs to the typed content model`).toBe(true);
    }
    for (const propKey of Object.keys(node.props ?? {})) {
      expect(propKey).not.toMatch(/^(style|css|class|classname|customcss)$/i);
    }
  }
  // No stylesheet text can hide in any authored value.
  const raw = JSON.stringify(content);
  expect(raw).not.toMatch(/style\s*=|!important|<style|font-family\s*:|customCss/i);
}

// ---------------------------------------------------------------------------
// §9.4 pixel helpers — PNG dims from the header + the listicles-visual
// in-browser canvas changed-pixel ratio (identical thresholds, no new deps).
// ---------------------------------------------------------------------------

function pngDims(buf: Buffer): { w: number; h: number } {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

async function pixelDiffRatio(page: Page, aPng: Buffer, bPng: Buffer): Promise<number> {
  return page.evaluate(
    async ([a, b]) => {
      function load(src: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src;
        });
      }
      const ia = await load(`data:image/png;base64,${a}`);
      const ib = await load(`data:image/png;base64,${b}`);
      if (ia.width !== ib.width || ia.height !== ib.height) return 1;
      const draw = (img: HTMLImageElement): ImageData => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx2d = canvas.getContext('2d')!;
        ctx2d.drawImage(img, 0, 0);
        return ctx2d.getImageData(0, 0, img.width, img.height);
      };
      const da = draw(ia).data;
      const db = draw(ib).data;
      let diff = 0;
      const total = ia.width * ia.height;
      for (let i = 0; i < da.length; i += 4) {
        if (
          Math.abs(da[i]! - db[i]!) > 8 ||
          Math.abs(da[i + 1]! - db[i + 1]!) > 8 ||
          Math.abs(da[i + 2]! - db[i + 2]!) > 8
        ) {
          diff += 1;
        }
      }
      return diff / total;
    },
    [aPng.toString('base64'), bPng.toString('base64')] as const,
  );
}

// ---------------------------------------------------------------------------
// §8.11 — the four capability patterns, authored through the UI
// ---------------------------------------------------------------------------

// NOT .serial: every test seeds its own data (workers:1 keeps execution
// sequential anyway), so a red product-finding test never masks the evidence
// of the tests behind it.
test.describe('LeadGen Studio §8.11 — four capability patterns authored through the UI (Slice F)', () => {
  test('pattern 1 — centered question card: progress, headline, subheadline, answer buttons, trust/logo area', async ({ page }) => {
    test.setTimeout(150_000);
    await openNewStudio(page, `P1 Centered Card ${uniq}`);

    // progress chrome at root
    await addComponent(page, 'ProgressBar');
    // the centered card — token props only (§8.5 CardPanel enums)
    await addComponent(page, 'CardPanel');
    await openInspectorTab(page, 'layout');
    const card = containerGroup(page, 'CardPanel');
    await card.locator('select[data-container-prop="width"]').selectOption('m');
    await card.locator('select[data-container-prop="shadow"]').selectOption('md');
    await card.locator('select[data-container-prop="padding"]').selectOption('m');
    // headline INTO the selected CardPanel
    await addComponent(page, 'QuestionHeadline');
    await setContentField(page, 'text', 'Are you currently insured?');
    // subheadline as the next sibling inside the card ("+ After")
    await addAfterSelected(page, 'Subheadline');
    await setContentField(page, 'text', 'It takes under 2 minutes to compare quotes.');
    // the answer buttons inside the card
    await addAfterSelected(page, 'ButtonAnswerGroup');
    await openInspectorTab(page, 'choices');
    await fillChoiceRow(page, 0, { label: 'Yes, I have coverage', value: 'yes', analytics_id: 'p1_yes' });
    await fillChoiceRow(page, 1, { label: 'Not yet', value: 'no', analytics_id: 'p1_no' });
    await setInternalField(page, 'currently_insured');
    // trust/logo area at root (selection is a leaf → root append)
    await addComponent(page, 'ReassuranceBadge');
    await setContentField(page, 'text', 'Get your offers in 2 minutes or less.');
    await addComponent(page, 'LogoStrip');

    // the PREVIEW (§8.9 drawer, default design) shows the pattern's pieces
    await refreshPreview(page);
    const f = pFrame(page);
    await expect(f.locator('[data-component-type="ProgressBar"]')).toBeVisible();
    await expect(f.locator('.lg-card-panel [data-component-type="QuestionHeadline"]')).toHaveText(
      'Are you currently insured?',
    );
    await expect(f.locator('.lg-card-panel [data-component-type="Subheadline"]')).toBeVisible();
    await expect(f.locator('.lg-card-panel .lg-answer-group button[data-lg-choice="yes"]')).toHaveText(
      'Yes, I have coverage',
    );
    await expect(f.locator('.lg-card-panel .lg-answer-group button[data-lg-choice="no"]')).toHaveText(
      'Not yet',
    );
    await expect(f.locator('[data-component-type="ReassuranceBadge"]')).toContainText(
      'Get your offers in 2 minutes or less.',
    );
    // LogoStrip has no logos authoring surface (see the pattern-3 note) — the
    // logo AREA is structurally present.
    await expect(f.locator('[data-component-type="LogoStrip"]')).toHaveCount(1);
    await shootPreview(page, 'pattern-1-desktop.png');

    await setPreviewViewport(page, 'mobile');
    await expect(f.locator('.lg-card-panel [data-component-type="QuestionHeadline"]')).toBeVisible();
    expect(Math.round((await page.locator('#lg-preview-frame').boundingBox())!.width)).toBeLessThanOrEqual(377);
    await shootPreview(page, 'pattern-1-mobile.png');

    // save through the UI → the persisted model is catalog types + tokens only
    await saveStudio(page);
    const detail = await fetchSection(page.request, publicIdFromUrl(page));
    const comps = detail.content_json.components;
    expect(comps.map((c) => c.type)).toEqual(['ProgressBar', 'CardPanel', 'ReassuranceBadge', 'LogoStrip']);
    const cardNode = comps[1]!;
    expect((cardNode.children ?? []).map((c) => c.type)).toEqual([
      'QuestionHeadline',
      'Subheadline',
      'ButtonAnswerGroup',
    ]);
    expect(cardNode.props, 'CardPanel props are exactly the picked §8.5 tokens').toEqual({
      width: 'm',
      shadow: 'md',
      padding: 'm',
    });
    const group = (cardNode.children ?? [])[2]!;
    expect(group.internal_field).toBe('currently_insured');
    expect((group.choices ?? []).map((c) => c['value'])).toEqual(['yes', 'no']);
    assertTokenizedModel(detail.content_json, [
      'ProgressBar',
      'CardPanel',
      'QuestionHeadline',
      'Subheadline',
      'ButtonAnswerGroup',
      'ReassuranceBadge',
      'LogoStrip',
    ]);
  });

  test('pattern 2 — branded HeaderBar/FooterBar, stacked buttons, Back, secure/trust messaging', async ({ page }) => {
    test.setTimeout(150_000);
    await openNewStudio(page, `P2 Branded Frame ${uniq}`);

    // branded top header (layout leaf — token/structured props only)
    await addComponent(page, 'HeaderBar');
    await openInspectorTab(page, 'layout');
    const header = containerGroup(page, 'HeaderBar');
    await header.locator('input[data-container-prop="logoMediaId"]').fill('media_brand_logo');
    await header.locator('input[data-container-prop="logoAlt"]').fill('Acme Insurance');
    await header.locator('input[data-container-prop="secure"]').check();
    await header.locator('input[data-container-prop="secureText"]').fill('Your information is secure');

    await addComponent(page, 'QuestionHeadline');
    await setContentField(page, 'text', 'Which coverage do you want to compare?');

    // stacked buttons: a vertical Stack (§8.5 token props) holding the group
    await addComponent(page, 'Stack');
    await openInspectorTab(page, 'layout');
    const stack = containerGroup(page, 'Stack');
    await stack.locator('select[data-container-prop="direction"]').selectOption('vertical');
    await stack.locator('select[data-container-prop="gap"]').selectOption('s');
    await stack.locator('select[data-container-prop="align"]').selectOption('stretch');
    await addComponent(page, 'ButtonAnswerGroup'); // INTO the selected Stack
    await openInspectorTab(page, 'choices');
    await fillChoiceRow(page, 0, { label: 'Home coverage', value: 'home', analytics_id: 'p2_home' });
    await fillChoiceRow(page, 1, { label: 'Auto coverage', value: 'auto', analytics_id: 'p2_auto' });
    await page.locator('#lg-choice-add').click();
    await fillChoiceRow(page, 2, { label: 'Life coverage', value: 'life', analytics_id: 'p2_life' });
    await setInternalField(page, 'coverage_type');

    // Back + secure trust messaging + branded footer at root
    await addComponent(page, 'BackButton');
    await setContentField(page, 'label', 'Back');
    await addComponent(page, 'SecureFormBadge');
    await setContentField(page, 'text', '256-bit SSL encrypted');
    await addComponent(page, 'FooterBar');
    await openInspectorTab(page, 'layout');
    const footer = containerGroup(page, 'FooterBar');
    await footer.locator('input[data-container-prop="legalHtml"]').fill('© 2026 Acme Insurance. Terms apply.');
    await footer.locator('textarea[data-container-prop="trustMessages"]').fill('SSL secured\nNo spam, ever');
    await footer.locator('textarea[data-container-prop="links"]').fill('Privacy|/privacy\nTerms|/terms');

    await refreshPreview(page);
    const f = pFrame(page);
    await expect(f.locator('.lg-headerbar img.lg-headerbar-logo')).toHaveAttribute('src', 'media_brand_logo');
    await expect(f.locator('.lg-headerbar .lg-headerbar-secure')).toContainText('Your information is secure');
    await expect(
      f.locator('[data-component-type="Stack"][data-direction="vertical"] .lg-answer-group button[data-lg-choice]'),
    ).toHaveCount(3);
    await expect(f.locator('[data-component-type="BackButton"]')).toBeVisible();
    await expect(f.locator('.lg-secure-badge')).toContainText('256-bit SSL encrypted');
    await expect(f.locator('.lg-footerbar .lg-footerbar-legal')).toContainText('© 2026 Acme Insurance.');
    await expect(f.locator('.lg-footerbar .lg-footerbar-link')).toHaveCount(2);
    await expect(f.locator('.lg-footerbar .lg-footerbar-trust-item')).toHaveCount(2);
    await shootPreview(page, 'pattern-2-desktop.png');

    await setPreviewViewport(page, 'mobile');
    await expect(f.locator('.lg-headerbar')).toBeVisible();
    await shootPreview(page, 'pattern-2-mobile.png');

    await saveStudio(page);
    const detail = await fetchSection(page.request, publicIdFromUrl(page));
    const comps = detail.content_json.components;
    expect(comps.map((c) => c.type)).toEqual([
      'HeaderBar',
      'QuestionHeadline',
      'Stack',
      'BackButton',
      'SecureFormBadge',
      'FooterBar',
    ]);
    expect(comps[0]!.props).toEqual({
      logoMediaId: 'media_brand_logo',
      logoAlt: 'Acme Insurance',
      secure: true,
      secureText: 'Your information is secure',
    });
    expect(comps[2]!.props).toEqual({ direction: 'vertical', gap: 's', align: 'stretch' });
    expect((comps[2]!.children ?? []).map((c) => c.type)).toEqual(['ButtonAnswerGroup']);
    expect(comps[5]!.props).toEqual({
      legalHtml: '© 2026 Acme Insurance. Terms apply.',
      trustMessages: ['SSL secured', 'No spam, ever'],
      links: [
        { label: 'Privacy', href: '/privacy' },
        { label: 'Terms', href: '/terms' },
      ],
    });
    assertTokenizedModel(detail.content_json, [
      'HeaderBar',
      'QuestionHeadline',
      'Stack',
      'ButtonAnswerGroup',
      'BackButton',
      'SecureFormBadge',
      'FooterBar',
    ]);
  });

  test('pattern 3 — header with logo + call CTA, large question, answer buttons, bottom trust bar', async ({ page }) => {
    test.setTimeout(150_000);
    await openNewStudio(page, `P3 Call CTA Header ${uniq}`);

    await addComponent(page, 'HeaderBar');
    await openInspectorTab(page, 'layout');
    const header = containerGroup(page, 'HeaderBar');
    await header.locator('input[data-container-prop="logoMediaId"]').fill('media_brand_logo');
    await header.locator('input[data-container-prop="logoAlt"]').fill('Acme');
    // the call CTA rides the §8.5 cta{label,tel} shape — pickers/inputs only
    await header.locator('input[data-container-cta="label"]').fill('Call (800) 555-0199');
    await header.locator('input[data-container-cta="tel"]').fill('+18005550199');

    await addComponent(page, 'QuestionHeadline');
    await setContentField(page, 'text', 'How much coverage do you need?');

    await addComponent(page, 'ButtonAnswerGroup');
    await openInspectorTab(page, 'choices');
    await fillChoiceRow(page, 0, { label: 'Up to $250,000', value: 'lt_250k', analytics_id: 'p3_lt250' });
    await fillChoiceRow(page, 1, { label: '$250,000 – $1M', value: '250k_1m', analytics_id: 'p3_250_1m' });
    await page.locator('#lg-choice-add').click();
    await fillChoiceRow(page, 2, { label: 'More than $1M', value: 'gt_1m', analytics_id: 'p3_gt1m' });
    await setInternalField(page, 'coverage_band');

    // bottom trust bar. NOTE (§8.5 vs studio surface): TrustBar's icon/text
    // PAIRS have no inspector control (contract 08 §8.5 lists them as
    // authorable props) — the component is placeable and renders its (empty)
    // bar; the item-authoring gap is reported in the slice report.
    await addComponent(page, 'TrustBar');

    await refreshPreview(page);
    const f = pFrame(page);
    const cta = f.locator('.lg-headerbar .lg-headerbar-cta');
    await expect(cta).toHaveText('Call (800) 555-0199');
    expect(await cta.getAttribute('href')).toContain('8005550199');
    await expect(f.locator('[data-component-type="QuestionHeadline"]')).toHaveText(
      'How much coverage do you need?',
    );
    await expect(f.locator('.lg-answer-group button[data-lg-choice]')).toHaveCount(3);
    await expect(f.locator('[data-component-type="TrustBar"]')).toHaveCount(1);
    await shootPreview(page, 'pattern-3-desktop.png');

    await setPreviewViewport(page, 'mobile');
    await expect(f.locator('.lg-headerbar .lg-headerbar-cta')).toBeAttached();
    await shootPreview(page, 'pattern-3-mobile.png');

    await saveStudio(page);
    const detail = await fetchSection(page.request, publicIdFromUrl(page));
    const comps = detail.content_json.components;
    expect(comps.map((c) => c.type)).toEqual(['HeaderBar', 'QuestionHeadline', 'ButtonAnswerGroup', 'TrustBar']);
    expect(comps[0]!.props).toEqual({
      logoMediaId: 'media_brand_logo',
      logoAlt: 'Acme',
      cta: { label: 'Call (800) 555-0199', tel: '+18005550199' },
    });
    assertTokenizedModel(detail.content_json, ['HeaderBar', 'QuestionHeadline', 'ButtonAnswerGroup', 'TrustBar']);
  });

  test('pattern 4 — full-background design with centered card, step indicator, answer cards with title+subtext, Back, legal footer', async ({ page }) => {
    test.setTimeout(150_000);
    await openNewStudio(page, `P4 Background Card ${uniq}`);

    // the full background (§8.5 BackgroundPanel — approved gradient token)
    await addComponent(page, 'BackgroundPanel');
    await openInspectorTab(page, 'layout');
    await containerGroup(page, 'BackgroundPanel')
      .locator('select[data-container-prop="gradient"]')
      .selectOption('primary');
    // the centered card INTO the background panel
    await addComponent(page, 'CardPanel');
    await openInspectorTab(page, 'layout');
    const card = containerGroup(page, 'CardPanel');
    await card.locator('select[data-container-prop="width"]').selectOption('m');
    await card.locator('select[data-container-prop="padding"]').selectOption('m');
    // multi-step progress INTO the card: steps/current authored through the
    // §8.6 Layout-tab numeric inputs (the P4 fix closed the §8.11 "multi-step"
    // authoring gap — a genuine steps=4/current=2 indicator, not the 1-dot
    // default).
    await addComponent(page, 'StepIndicator');
    await openInspectorTab(page, 'layout');
    const stepCtl = containerGroup(page, 'StepIndicator');
    await stepCtl.locator('input[data-container-prop="steps"]').fill('4');
    await stepCtl.locator('input[data-container-prop="current"]').fill('2');
    await addAfterSelected(page, 'QuestionHeadline');
    await setContentField(page, 'text', 'Who is the coverage for?');
    // answer cards with title + subtext (icon card grid choices carry
    // label + description — both edited via the Choices tab)
    await addAfterSelected(page, 'IconCardAnswerGrid');
    await openInspectorTab(page, 'choices');
    await fillChoiceRow(page, 0, {
      label: 'For me',
      value: 'self',
      analytics_id: 'p4_self',
      icon: '🙋',
      description: 'Coverage for yourself',
    });
    await fillChoiceRow(page, 1, {
      label: 'For my family',
      value: 'family',
      analytics_id: 'p4_family',
      icon: '👪',
      description: 'Protect the whole household',
    });
    await setInternalField(page, 'coverage_for');
    // Back control inside the card
    await addAfterSelected(page, 'BackButton');
    // legal footer at root, after the background panel
    await addComponent(page, 'FooterBar');
    await openInspectorTab(page, 'layout');
    await containerGroup(page, 'FooterBar')
      .locator('input[data-container-prop="legalHtml"]')
      .fill('Rates depend on underwriting. © 2026 Acme.');

    await refreshPreview(page);
    const f = pFrame(page);
    const stepsEl = f.locator('.lg-bg-panel .lg-card-panel .lg-steps[role="progressbar"]');
    await expect(stepsEl).toBeAttached();
    // the AUTHORED multi-step state renders: 4 dots, the 2nd active, with the
    // a11y value mirrors (renderStepIndicator contract)
    await expect(stepsEl).toHaveAttribute('aria-valuemax', '4');
    await expect(stepsEl).toHaveAttribute('aria-valuenow', '2');
    await expect(stepsEl.locator('.lg-step')).toHaveCount(4);
    await expect(stepsEl.locator('.lg-step[data-active="true"]')).toHaveCount(1);
    await expect(stepsEl.locator('.lg-step').nth(1)).toHaveAttribute('data-active', 'true');
    await expect(f.locator('.lg-bg-panel .lg-card-panel [data-component-type="QuestionHeadline"]')).toHaveText(
      'Who is the coverage for?',
    );
    const cards = f.locator('.lg-bg-panel .lg-card-panel .lg-card-grid button.lg-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).locator('.lg-card-title')).toHaveText('For me');
    await expect(cards.nth(0).locator('.lg-card-desc')).toHaveText('Coverage for yourself');
    await expect(cards.nth(1).locator('.lg-card-title')).toHaveText('For my family');
    await expect(cards.nth(1).locator('.lg-card-desc')).toHaveText('Protect the whole household');
    await expect(f.locator('.lg-card-panel [data-component-type="BackButton"]')).toBeVisible();
    await expect(f.locator('.lg-footerbar .lg-footerbar-legal')).toContainText('Rates depend on underwriting.');
    await shootPreview(page, 'pattern-4-desktop.png');

    await setPreviewViewport(page, 'mobile');
    await expect(f.locator('.lg-bg-panel .lg-card-panel')).toBeVisible();
    await shootPreview(page, 'pattern-4-mobile.png');

    await saveStudio(page);
    const detail = await fetchSection(page.request, publicIdFromUrl(page));
    const comps = detail.content_json.components;
    expect(comps.map((c) => c.type)).toEqual(['BackgroundPanel', 'FooterBar']);
    expect(comps[0]!.props).toEqual({ gradient: 'primary' });
    const cardNode = (comps[0]!.children ?? [])[0]!;
    expect(cardNode.type).toBe('CardPanel');
    expect(cardNode.props).toEqual({ width: 'm', padding: 'm' });
    expect((cardNode.children ?? []).map((c) => c.type)).toEqual([
      'StepIndicator',
      'QuestionHeadline',
      'IconCardAnswerGrid',
      'BackButton',
    ]);
    expect(
      (cardNode.children ?? [])[0]!.props,
      'StepIndicator persisted the authored steps/current numerics',
    ).toEqual({ steps: 4, current: 2 });
    const grid = (cardNode.children ?? [])[2]!;
    expect((grid.choices ?? []).map((c) => [c['value'], c['icon'], c['description']])).toEqual([
      ['self', '🙋', 'Coverage for yourself'],
      ['family', '👪', 'Protect the whole household'],
    ]);
    assertTokenizedModel(detail.content_json, [
      'BackgroundPanel',
      'CardPanel',
      'StepIndicator',
      'QuestionHeadline',
      'IconCardAnswerGrid',
      'BackButton',
      'FooterBar',
    ]);
  });
});

// ---------------------------------------------------------------------------
// §8.12 — the remaining browser flows (①–⑦ live in the studio spec)
// ---------------------------------------------------------------------------

test.describe('LeadGen Studio §8.12 — remaining flows (Slice F)', () => {
  test('create a Yes/No slide: TwoButtonYesNo via the library, labels via the Content tab', async ({ page }) => {
    test.setTimeout(120_000);
    await openNewStudio(page, `YesNo Slide ${uniq}`);

    await addComponent(page, 'TwoButtonYesNo');
    await setContentField(page, 'yesLabel', 'Yes, I am');
    await setContentField(page, 'noLabel', 'Not yet');
    await setInternalField(page, 'currently_insured');

    // the CANVAS re-renders via the REAL preset renderer (§8.4)
    const canvas = page.locator('#lg-studio-canvas-render');
    await expect(canvas.locator('.lg-yesno button[data-lg-choice="true"]')).toHaveText('Yes, I am');
    await expect(canvas.locator('.lg-yesno button[data-lg-choice="false"]')).toHaveText('Not yet');
    await page.screenshot({ path: `${SHOT_DIR}/flow-yesno-slide.png` });

    await saveStudio(page);
    const detail = await fetchSection(page.request, publicIdFromUrl(page));
    const node = detail.content_json.components[0]!;
    expect(node.type).toBe('TwoButtonYesNo');
    expect(node.internal_field).toBe('currently_insured');
    expect(node.props).toMatchObject({ yesLabel: 'Yes, I am', noLabel: 'Not yet' });
  });

  test('dependent dropdown: insured=yes → insurer dropdown authored on the Dependencies tab; the dependency SIM shows the dropdown only with the answer', async ({ page }) => {
    test.setTimeout(150_000);
    await ensureFeederOffer(page.request);
    const section = await createSection(page.request, `Dependent Dropdown ${uniq}`, {
      components: [
        {
          type: 'TwoButtonYesNo',
          question_id: 'q_ins',
          internal_field: 'currently_insured',
          answer_type: 'boolean',
          props: { yesLabel: 'Yes', noLabel: 'No' },
        },
        {
          type: 'DropdownQuestion',
          question_id: 'q_insurer',
          internal_field: 'insurer',
          answer_type: 'enum',
          choices: [
            { label: 'Acme Mutual', value: 'acme', analytics_id: 'i_acme' },
            { label: 'Globex', value: 'globex', analytics_id: 'i_globex' },
          ],
          props: { placeholder: 'Pick your insurer' },
        },
      ],
    });

    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });
    await waitBootPreview(page);

    // author the §6.10 IF/THEN dependency through the visual builder ONLY
    await page.locator('#lg-studio-canvas-render [data-component-type="DropdownQuestion"]').click();
    await expect(page.locator('#lg-inspector-target')).toContainText('(DropdownQuestion)');
    await openInspectorTab(page, 'dependencies');
    await page.locator('[data-inspector-cond="when"]').selectOption('currently_insured');
    const boolValue = page.locator('[data-inspector-cond="value-bool"]');
    await expect(boolValue, 'boolean when-field switches the value input to a true/false picker').toBeVisible();
    await boolValue.selectOption('true');

    await saveStudio(page);
    const detail = await fetchSection(page.request, section.public_id);
    const insurer = detail.content_json.components.find((c) => c.question_id === 'q_insurer');
    expect(insurer?.conditional, 'the authored §6.10 conditional persisted').toEqual({
      when: 'currently_insured',
      op: 'eq',
      value: true,
    });

    // dependency SIM (§9.2 server-rendered): unmet answer → the dropdown is
    // NOT in the preview markup at all (renderSectionComponentsVisible)
    await waitBootPreview(page);
    const f = pFrame(page);
    await markPreviewStale(page);
    await page.locator('[data-sim-state="dependency"]').click();
    await waitFreshPreview(page, 'desktop');
    await page.locator('#lg-dependency-answers').fill('{ "currently_insured": false }');
    await markPreviewStale(page);
    await page.locator('#lg-dependency-apply').click();
    await waitFreshPreview(page, 'desktop');
    await expect(f.locator('[data-component-type="DropdownQuestion"]')).toHaveCount(0);
    await expect(page.locator('[data-dependency-status]')).toContainText('Visible: 1 component');
    await shootPreview(page, 'flow-dependent-dropdown-unmet.png');

    // met answer → the dropdown IS server-rendered into the sim markup
    await page.locator('#lg-dependency-answers').fill('{ "currently_insured": true }');
    await markPreviewStale(page);
    await page.locator('#lg-dependency-apply').click();
    await waitFreshPreview(page, 'desktop');
    await expect(f.locator('[data-component-type="DropdownQuestion"]')).toHaveCount(1);
    await expect(page.locator('[data-dependency-status]')).toContainText('Visible: 2 component');
    await shootPreview(page, 'flow-dependent-dropdown-met.png');
  });

  test('§9.2/§14.9 dependency-satisfied reveal stays VISIBLE to the operator (regression guard — DEV-46/F2 static sims)', async ({ page }) => {
    test.setTimeout(120_000);
    // 09 §9.2: "All sims are SERVER-rendered into the srcdoc (… dependency-
    // satisfied reveals)". The server renders the satisfied dropdown into the
    // sim document (proven by the previous test's toHaveCount(1)). This was a
    // real defect once: the §9.1 runtime bundle hydrated with an EMPTY answer
    // store and re-applied visibility (engine.ts enterSection →
    // applyComponentVisibility), re-`hidden`-ing the very component the sim
    // revealed. FIXED in Fix-P4 slice F2 (DEV-46): non-default sims now render
    // as STATIC, script-free documents — no engine hydrates, so nothing can
    // re-hide the server-revealed node. This test GUARDS that: it fails again
    // the moment a non-default sim regains a hydrating runtime.
    await ensureFeederOffer(page.request);
    const section = await createSection(page.request, `Reveal Pin ${uniq}`, {
      components: [
        {
          type: 'TwoButtonYesNo',
          question_id: 'q_ins',
          internal_field: 'currently_insured',
          answer_type: 'boolean',
          props: { yesLabel: 'Yes', noLabel: 'No' },
        },
        {
          type: 'DropdownQuestion',
          question_id: 'q_insurer',
          internal_field: 'insurer',
          answer_type: 'enum',
          choices: [
            { label: 'Acme Mutual', value: 'acme', analytics_id: 'r_acme' },
            { label: 'Globex', value: 'globex', analytics_id: 'r_globex' },
          ],
          conditional: { when: 'currently_insured', op: 'eq', value: true },
        },
      ],
    });
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });
    await waitBootPreview(page);
    const f = pFrame(page);
    await markPreviewStale(page);
    await page.locator('[data-sim-state="dependency"]').click();
    await waitFreshPreview(page, 'desktop');
    await page.locator('#lg-dependency-answers').fill('{ "currently_insured": true }');
    await markPreviewStale(page);
    await page.locator('#lg-dependency-apply').click();
    await waitFreshPreview(page, 'desktop');
    // server-rendered into the sim document (green — the §9.2 server leg)
    await expect(f.locator('[data-component-type="DropdownQuestion"]')).toHaveCount(1);
    // …and VISIBLE to the operator: the static sim doc has no engine to
    // re-hide it (DEV-46/F2). Regresses the instant a non-default sim rehydrates.
    await expect(f.locator('[data-component-type="DropdownQuestion"]')).toBeVisible();
  });

  test('ZIP validation slide: required ZIP authored via inspectors; error + validation-error sims render the runtime messages', async ({ page }) => {
    test.setTimeout(120_000);
    await openNewStudio(page, `ZIP Slide ${uniq}`);

    await addComponent(page, 'ZIPInputQuestion');
    await setContentField(page, 'placeholder', 'ZIP code');
    await openInspectorTab(page, 'validation');
    await page.locator('[data-studio-panel="validation"] input[data-inspector-field="required"]').check();
    await setInternalField(page, 'zip');

    await saveStudio(page);
    const detail = await fetchSection(page.request, publicIdFromUrl(page));
    const zip = detail.content_json.components[0]!;
    expect(zip.type).toBe('ZIPInputQuestion');
    expect(zip.required).toBe(true);
    expect(zip.props).toMatchObject({ placeholder: 'ZIP code' });

    // §9.2 error sim (required-but-empty): runtime-verbatim message
    await waitBootPreview(page);
    const f = pFrame(page);
    await markPreviewStale(page);
    await page.locator('[data-sim-state="error"]').click();
    await waitFreshPreview(page, 'desktop');
    await page.locator('#lg-dependency-answers').fill('{}');
    await markPreviewStale(page);
    await page.locator('#lg-dependency-apply').click();
    await waitFreshPreview(page, 'desktop');
    await expect(f.locator('[data-component-type="ZIPInputQuestion"]')).toHaveClass(/lg-error/);
    await expect(f.locator('[data-component-type="ZIPInputQuestion"]')).toHaveAttribute('aria-invalid', 'true');
    await expect(f.locator('[data-lg-error-for="zip"]')).toHaveText('This field is required.');
    await shootPreview(page, 'flow-zip-error-sim.png');

    // §9.2 validation_error sim: the invalid-format message
    await markPreviewStale(page);
    await page.locator('[data-sim-state="validation_error"]').click();
    await waitFreshPreview(page, 'desktop');
    await expect(f.locator('[data-lg-error-for="zip"]')).toHaveText('The value has an invalid format.');
  });

  test('personal-details slide: NameFieldsGroup + Email + Phone via the library', async ({ page }) => {
    test.setTimeout(120_000);
    await openNewStudio(page, `Personal Details ${uniq}`);

    await addComponent(page, 'NameFieldsGroup');
    await addComponent(page, 'EmailInputQuestion');
    await setContentField(page, 'placeholder', 'you@example.com');
    await setInternalField(page, 'email');
    await addComponent(page, 'PhoneInputQuestion');
    await setContentField(page, 'placeholder', '(555) 000-0000');
    await setInternalField(page, 'phone');

    await refreshPreview(page);
    const f = pFrame(page);
    await expect(f.locator('[data-component-type="NameFieldsGroup"] input')).toHaveCount(2);
    await expect(f.locator('input[inputmode="email"]')).toHaveCount(1);
    await expect(f.locator('input[inputmode="tel"]')).toHaveCount(1);
    await shootPreview(page, 'flow-personal-details.png');

    await saveStudio(page);
    const detail = await fetchSection(page.request, publicIdFromUrl(page));
    expect(detail.content_json.components.map((c) => c.type)).toEqual([
      'NameFieldsGroup',
      'EmailInputQuestion',
      'PhoneInputQuestion',
    ]);
    expect(detail.content_json.components.map((c) => c.internal_field ?? null)).toEqual([
      null,
      'email',
      'phone',
    ]);
  });

  test('icon card grid: choices with icons edited via the Choices tab', async ({ page }) => {
    test.setTimeout(120_000);
    await openNewStudio(page, `Icon Grid ${uniq}`);

    await addComponent(page, 'IconCardAnswerGrid');
    await openInspectorTab(page, 'choices');
    await fillChoiceRow(page, 0, { label: 'Sole proprietor', value: 'sole', analytics_id: 'b_sole', icon: '🏢' });
    await fillChoiceRow(page, 1, { label: 'LLC', value: 'llc', analytics_id: 'b_llc', icon: '🏛' });
    await page.locator('#lg-choice-add').click();
    await fillChoiceRow(page, 2, { label: 'Partnership', value: 'partner', analytics_id: 'b_partner', icon: '🤝' });
    await setInternalField(page, 'business_type');

    await refreshPreview(page);
    const f = pFrame(page);
    const cards = f.locator('.lg-card-grid button.lg-card');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0).locator('.lg-card-icon')).toHaveText('🏢');
    await expect(cards.nth(0).locator('.lg-card-title')).toHaveText('Sole proprietor');
    await expect(cards.nth(2).locator('.lg-card-icon')).toHaveText('🤝');
    await shootPreview(page, 'flow-icon-card-grid.png');

    await saveStudio(page);
    const detail = await fetchSection(page.request, publicIdFromUrl(page));
    const grid = detail.content_json.components[0]!;
    expect(grid.type).toBe('IconCardAnswerGrid');
    expect((grid.choices ?? []).map((c) => [c['value'], c['icon']])).toEqual([
      ['sole', '🏢'],
      ['llc', '🏛'],
      ['partner', '🤝'],
    ]);
  });

  test('range slider: min/max/step via the Validation tab, labels via the Content tab', async ({ page }) => {
    test.setTimeout(120_000);
    await openNewStudio(page, `Range Slider ${uniq}`);

    await addComponent(page, 'RangeQuestion');
    await setContentField(page, 'minLabel', 'Low');
    await setContentField(page, 'maxLabel', 'High');
    await setValidationProp(page, 'min', '10');
    await setValidationProp(page, 'max', '500');
    await setValidationProp(page, 'step', '5');
    await setInternalField(page, 'coverage_amount');

    await refreshPreview(page);
    const f = pFrame(page);
    const input = f.locator('.lg-range input.lg-range-input[type="range"]');
    await expect(input).toHaveAttribute('min', '10');
    await expect(input).toHaveAttribute('max', '500');
    await expect(input).toHaveAttribute('step', '5');
    await expect(f.locator('.lg-range-minmax span').nth(0)).toHaveText('Low');
    await expect(f.locator('.lg-range-minmax span').nth(1)).toHaveText('High');
    await shootPreview(page, 'flow-range-slider.png');

    await saveStudio(page);
    const detail = await fetchSection(page.request, publicIdFromUrl(page));
    const range = detail.content_json.components[0]!;
    expect(range.type).toBe('RangeQuestion');
    expect(range.internal_field).toBe('coverage_amount');
    expect(range.props).toMatchObject({ min: 10, max: 500, step: 5, minLabel: 'Low', maxLabel: 'High' });
  });

  test('main/Other values: choiceDisplay authored via the Choices tab; the preview shows main choices + the Other trigger', async ({ page }) => {
    test.setTimeout(120_000);
    await openNewStudio(page, `Main Other ${uniq}`);

    await addComponent(page, 'ButtonAnswerGroup');
    await openInspectorTab(page, 'choices');
    await fillChoiceRow(page, 0, { label: 'Toyota', value: 'toyota', analytics_id: 'm_toyota' });
    await fillChoiceRow(page, 1, { label: 'Honda', value: 'honda', analytics_id: 'm_honda' });
    await page.locator('#lg-choice-add').click();
    await fillChoiceRow(page, 2, { label: 'Kia', value: 'kia', analytics_id: 'm_kia' });
    await page.locator('#lg-choice-add').click();
    await fillChoiceRow(page, 3, { label: 'Tesla', value: 'tesla', analytics_id: 'm_tesla' });
    // B9 §6.4 grouping controls on the same tab
    await page.locator('[data-choicedisplay="otherGroupEnabled"]').check();
    await page.locator('[data-choicedisplay="otherGroupLabel"]').fill('Other brands');
    // mark the two mains (their change events fold the display config into
    // the model — collectChoices reads the group controls)
    await choiceRows(page).nth(0).locator('[data-choice-main]').check();
    await choiceRows(page).nth(1).locator('[data-choice-main]').check();
    await setInternalField(page, 'car_make');

    await refreshPreview(page);
    const f = pFrame(page);
    // main choices render as answer buttons; the OTHER tail is ONE trigger
    // (deliberately no data-lg-choice) + the hidden panel of REAL values
    await expect(f.locator('.lg-answer-group button[data-lg-choice="toyota"]')).toBeVisible();
    await expect(f.locator('.lg-answer-group button[data-lg-choice="honda"]')).toBeVisible();
    const trigger = f.locator('[data-lg-other-trigger]');
    await expect(trigger).toBeVisible();
    await expect(trigger).toContainText('Other brands');
    const panel = f.locator('[data-lg-other-panel]');
    await expect(panel).toBeAttached();
    await expect(panel).toBeHidden();
    await expect(panel.locator('button[data-lg-choice="kia"]')).toHaveCount(1);
    await expect(panel.locator('button[data-lg-choice="tesla"]')).toHaveCount(1);
    await shootPreview(page, 'flow-main-other.png');

    await saveStudio(page);
    const detail = await fetchSection(page.request, publicIdFromUrl(page));
    const group = detail.content_json.components[0]!;
    expect((group.choices ?? []).map((c) => c['value'])).toEqual(['toyota', 'honda', 'kia', 'tesla']);
    expect(group.choiceDisplay).toEqual({
      otherGroupEnabled: true,
      mainValues: ['toyota', 'honda'],
      otherGroupLabel: 'Other brands',
    });
  });

  test('choiceDisplay-only edit persists: toggling ONLY "Enable Other group" then saving must not lose the setting', async ({ page }) => {
    test.setTimeout(120_000);
    // The §8.6 Choices tab owns main/Other grouping (B9). An operator whose
    // LAST edit is the group toggle itself (no subsequent choice-row edit)
    // must not silently lose it on save — order independence.
    await ensureFeederOffer(page.request);
    const section = await createSection(page.request, `ChoiceDisplay Only ${uniq}`, {
      components: [
        {
          type: 'ButtonAnswerGroup',
          question_id: 'q_make',
          internal_field: 'car_make',
          answer_type: 'enum',
          choices: [
            { label: 'Toyota', value: 'toyota', analytics_id: 'c_toyota' },
            { label: 'Honda', value: 'honda', analytics_id: 'c_honda' },
          ],
        },
      ],
    });

    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });
    await waitBootPreview(page);
    await page.locator('#lg-studio-canvas-render [data-component-type="ButtonAnswerGroup"]').click();
    await expect(page.locator('#lg-inspector-target')).toContainText('(ButtonAnswerGroup)');
    await openInspectorTab(page, 'choices');
    await page.locator('[data-choicedisplay="otherGroupEnabled"]').check();

    await saveStudio(page);
    const detail = await fetchSection(page.request, section.public_id);
    const group = detail.content_json.components[0]!;
    expect(
      group.choiceDisplay?.['otherGroupEnabled'],
      'the checked "Enable Other group" survives a save with no further choice-row edits',
    ).toBe(true);
  });

  test('dependency + validation-state sims produce VISIBLY different section markup (§8.9/§14.9)', async ({ page }) => {
    test.setTimeout(150_000);
    await ensureFeederOffer(page.request);
    const section = await createSection(page.request, `Sim States ${uniq}`, {
      components: [
        {
          type: 'TwoButtonYesNo',
          question_id: 'q_ins',
          internal_field: 'currently_insured',
          answer_type: 'boolean',
          required: true,
          props: { yesLabel: 'Yes', noLabel: 'No' },
        },
        {
          type: 'DropdownQuestion',
          question_id: 'q_insurer',
          internal_field: 'insurer',
          answer_type: 'enum',
          choices: [
            { label: 'Acme Mutual', value: 'acme', analytics_id: 's_acme' },
            { label: 'Globex', value: 'globex', analytics_id: 's_globex' },
          ],
          conditional: { when: 'currently_insured', op: 'eq', value: true },
        },
      ],
    });

    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });
    await waitBootPreview(page);
    const f = pFrame(page);

    // capture the SECTION markup (scripts excluded — the runtime bundle text
    // contains every state token and would defeat substring checks)
    const sectionHtml = (): Promise<string> =>
      f.locator('[data-lg-section]').evaluate((el) => el.innerHTML);

    const runSim = async (state: string, answersJson: string | null): Promise<string> => {
      const btn = page.locator(`[data-sim-state="${state}"]`);
      if ((await btn.getAttribute('aria-pressed')) !== 'true') {
        await markPreviewStale(page);
        await btn.click();
        await waitFreshPreview(page, 'desktop');
      }
      if (answersJson !== null) {
        await page.locator('#lg-dependency-answers').fill(answersJson);
        await markPreviewStale(page);
        await page.locator('#lg-dependency-apply').click();
        await waitFreshPreview(page, 'desktop');
      }
      await shootPreview(page, `flow-sim-${state}.png`);
      return sectionHtml();
    };

    const byState: Record<string, string> = {};
    byState['default'] = await runSim('default', null);
    byState['selected'] = await runSim('selected', '{ "currently_insured": true }');
    byState['error'] = await runSim('error', '{}');
    byState['dependency'] = await runSim('dependency', '{ "currently_insured": false }');
    byState['validation_success'] = await runSim('validation_success', '{ "currently_insured": true }');
    byState['validation_error'] = await runSim('validation_error', '{ "currently_insured": true }');

    // each sim's DISTINGUISHING marker is present exactly where it should be
    expect(byState['default']).toContain('q_insurer'); // classic full render
    expect(byState['selected']).toContain('lg-selected');
    expect(byState['default']).not.toContain('lg-selected');
    expect(byState['error']).toContain('This field is required.');
    expect(byState['dependency']).not.toContain('q_insurer'); // unmet → filtered out
    expect(byState['dependency']).not.toContain('This field is required.');
    expect(byState['validation_success']).toContain('lg-valid');
    expect(byState['default']).not.toContain('lg-valid');
    expect(byState['validation_error']).toContain('The value has an invalid format.');
    expect(byState['error']).not.toContain('The value has an invalid format.');

    // and the six documents are pairwise DIFFERENT (visibly differ, §8.12)
    const states = Object.keys(byState);
    for (let i = 0; i < states.length; i++) {
      for (let j = i + 1; j < states.length; j++) {
        expect(
          byState[states[i]!]! !== byState[states[j]!]!,
          `sim '${states[i]}' and sim '${states[j]}' render different section markup`,
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §9.4 viewport round-trip + §8.13 legacy-lossless
// ---------------------------------------------------------------------------

test.describe('LeadGen Studio §9.4 + §8.13 (Slice F)', () => {
  // §9.4 measures the VIEWPORT TOGGLE's own geometry, so each measurement
  // first settles the events-panel noise (see the file-scope helper — the
  // panel's compact-JSON content varies a few chars per boot, which would
  // otherwise leak into the desktop-width restoration comparison). The E6
  // layout-hygiene fix (guarded by the test below) now contains that content
  // within the viewport; the settle step remains as deterministic sequencing
  // of the async event side effect, not masking.
  const ROUNDTRIP_CONTENT = {
    components: [
      {
        type: 'TwoButtonYesNo',
        question_id: 'q_ins',
        internal_field: 'currently_insured',
        answer_type: 'boolean',
        props: { yesLabel: 'Yes', noLabel: 'No' },
      },
      { type: 'ZIPInputQuestion', question_id: 'q_zip', internal_field: 'zip', props: { placeholder: 'ZIP code' } },
      {
        type: 'RangeQuestion',
        question_id: 'q_amount',
        internal_field: 'amount',
        props: { min: 0, max: 100, default: 60 },
      },
    ],
  };

  test('§9.4 viewport round-trip: desktop → REAL-375px mobile (no transform scale) → desktop restores pixel-identically', async ({ page }) => {
    test.setTimeout(150_000);
    await ensureFeederOffer(page.request);
    const section = await createSection(page.request, `Viewport Roundtrip ${uniq}`, ROUNDTRIP_CONTENT);

    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });
    await waitBootPreview(page);
    await settleEventsNoise(page);
    const iframeEl = page.locator('#lg-preview-frame');
    const f = pFrame(page);

    // DESKTOP first state — a real unscaled width
    await expect(f.locator('#lg-funnel-root')).toHaveAttribute('data-viewport', 'desktop');
    const desktopBox = (await iframeEl.boundingBox())!;
    expect(desktopBox.width, 'desktop preview is a real wide iframe').toBeGreaterThan(700);
    const desktopInnerW = await f.locator('#lg-funnel-root').evaluate(() => window.innerWidth);
    // inner width == layout width − the 2×1px iframe border (± subpixel):
    // the desktop document really lays out at the iframe's size — no scaling
    expect(
      Math.abs(desktopInnerW - desktopBox.width),
      'desktop iframe inner width equals its layout width (unscaled)',
    ).toBeLessThanOrEqual(3);
    expect(await iframeEl.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
    expect(
      await f.locator('#lg-funnel-root').evaluate((el) => getComputedStyle(el).transform),
    ).toBe('none');
    const shotBefore = await shootPreview(page, '9-4-desktop-before.png');

    // MOBILE — the REAL 375px wrapper (§9.4: never transform:scale)
    await setPreviewViewport(page, 'mobile');
    await settleEventsNoise(page);
    await expect(iframeEl).toHaveClass(/lg-preview-frame-mobile/);
    const mobileBox = (await iframeEl.boundingBox())!;
    expect(Math.abs(mobileBox.width - 375), 'mobile iframe lays out at 375 CSS px').toBeLessThanOrEqual(2);
    const mobileInnerW = await f.locator('#lg-funnel-root').evaluate(() => window.innerWidth);
    expect(Math.abs(mobileInnerW - 375), 'mobile document inner width is the REAL 375px').toBeLessThanOrEqual(3);
    // no scaling anywhere on the chain: outer iframe, body, wrapper
    expect(await iframeEl.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
    expect(
      await f.locator('#lg-funnel-root').evaluate((el) => getComputedStyle(el).transform),
    ).toBe('none');
    expect(
      await f.locator('#lg-funnel-root').evaluate(() => getComputedStyle(document.body).transform),
    ).toBe('none');
    await expect(f.locator('#lg-funnel-root')).toHaveClass(/lg-preview-mobile/);
    await shootPreview(page, '9-4-mobile.png');

    // BACK TO DESKTOP — the first and last states match pixel-for-pixel
    await setPreviewViewport(page, 'desktop');
    await settleEventsNoise(page);
    await expect(iframeEl).not.toHaveClass(/lg-preview-frame-mobile/);
    const afterBox = (await iframeEl.boundingBox())!;
    expect(Math.round(afterBox.width)).toBe(Math.round(desktopBox.width));
    const shotAfter = await shootPreview(page, '9-4-desktop-after.png');

    const dimsBefore = pngDims(shotBefore);
    const dimsAfter = pngDims(shotAfter);
    expect(dimsAfter, 'restored desktop screenshot has identical pixel dimensions').toEqual(dimsBefore);
    const ratio = await pixelDiffRatio(page, shotBefore, shotAfter);
    console.log(`[9.4-roundtrip] changed-pixel ratio desktop-before vs desktop-after = ${ratio}`);
    // listicles-visual §31.1 desktop budget: ≤0.10% changed pixels
    expect(ratio, 'desktop → mobile → desktop restores the first state').toBeLessThanOrEqual(0.001);
  });

  test('§8.1/E6 studio layout hygiene: preview events must not stretch the studio past the viewport (known-defect pin)', async ({ page }) => {
    test.setTimeout(120_000);
    // The §8.9 events panel renders each would-fire event as ONE compact-JSON
    // line (~840 chars, no spaces). WITHOUT wrap opportunities its min-content
    // width would propagate up the admin shell's flex chain and stretch the
    // whole studio layout past the viewport the moment the boot events arrive
    // (historically ~3034px at a 1280 viewport, proven by remove-and-measure:
    // deleting the events <li> nodes shrank .admin-main 3034 → 1030). The
    // §8.1/E6 layout-hygiene fix has since landed in the studio styles
    // (ui-section-studio.ts: .studio-events-list li overflow-wrap:anywhere +
    // word-break, and .admin-main{min-width:0} so the flex item may shrink
    // below its content's intrinsic width). This test now GUARDS that fix:
    // once the boot events land, .admin-main must stay within the viewport.
    await ensureFeederOffer(page.request);
    const section = await createSection(page.request, `Overflow Pin ${uniq}`, ROUNDTRIP_CONTENT);
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });
    await waitBootPreview(page);
    await waitForStudioEvents(page);
    const widths = await page.evaluate(() => ({
      adminMain: Math.round(document.querySelector('.admin-main')!.getBoundingClientRect().width),
      iframe: Math.round(document.getElementById('lg-preview-frame')!.getBoundingClientRect().width),
      viewport: document.documentElement.clientWidth,
    }));
    expect(
      widths.adminMain,
      `the studio layout must stay within the viewport once events land (admin-main ${widths.adminMain}px, preview iframe ${widths.iframe}px, viewport ${widths.viewport}px)`,
    ).toBeLessThanOrEqual(widths.viewport);
  });

  test('§8.13 legacy-lossless: a PRE-P4 flat content_json opens, renders, and a no-edit save round-trips byte-identically', async ({ page }) => {
    test.setTimeout(150_000);
    // Fixture copied from test/leadgen-sample-answers.test.ts
    // (linkSectionWithComponents): 7 flat components, NO containers — a
    // realistic pre-§8.5 Section body.
    const LEGACY_FLAT_CONTENT = {
      components: [
        {
          type: 'ButtonAnswerGroup',
          question_id: 'q-carrier',
          internal_field: 'carrier',
          answer_type: 'enum',
          choices: [
            { label: 'Acme', value: 'acme', analytics_id: 'c-acme' },
            { label: 'Globex', value: 'globex', analytics_id: 'c-globex' },
          ],
        },
        { type: 'TwoButtonYesNo', question_id: 'q-home', internal_field: 'homeowner' },
        { type: 'DateQuestion', question_id: 'q-dob', internal_field: 'dob' },
        { type: 'ZIPInputQuestion', question_id: 'q-zip', internal_field: 'zip' },
        { type: 'EmailInputQuestion', question_id: 'q-email', internal_field: 'email' },
        { type: 'PhoneInputQuestion', question_id: 'q-phone', internal_field: 'phone' },
        { type: 'RangeQuestion', question_id: 'q-age', internal_field: 'age', props: { min: 18, max: 99 } },
      ],
    };
    await ensureFeederOffer(page.request);
    // Seed through the REAL admin API with an explicit JSON STRING — the
    // stored column is the validator's JSON.stringify(JSON.parse(sent)).
    const created = await createSection(
      page.request,
      `Legacy Flat ${uniq}`,
      JSON.stringify(LEGACY_FLAT_CONTENT),
    );

    const before = await fetchSection(page.request, created.public_id);
    const beforeStr = JSON.stringify(before.content_json);
    expect(before.content_json.components).toHaveLength(7);

    // the legacy Section OPENS in the Studio and RENDERS (§8.13: flat legacy
    // arrays render as the implicit root list — canvas + hydrated preview)
    await page.goto(`/admin/leadgen/sections/${created.public_id}/edit`, { waitUntil: 'domcontentloaded' });
    const canvas = page.locator('#lg-studio-canvas-render');
    await expect(canvas.locator('[data-component-type]')).toHaveCount(7);
    await expect(canvas.locator('[data-component-type="ButtonAnswerGroup"] button[data-lg-choice="acme"]')).toBeVisible();
    await expect(canvas.locator('[data-component-type="RangeQuestion"]')).toBeAttached();
    await waitBootPreview(page);
    await expect(pFrame(page).locator('button[data-lg-choice="acme"]')).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/8-13-legacy-open.png` });

    // NO edits — straight Save (PATCH through the island's unchanged body)
    await saveStudio(page);

    const after = await fetchSection(page.request, created.public_id);
    // SEMANTICALLY lossless: same components, same fields, same order
    expect(after.content_json).toEqual(before.content_json);
    // and byte-identical (the save chain is parse→stringify with key order
    // preserved end-to-end — asserted so any reordering regression surfaces)
    expect(JSON.stringify(after.content_json), 'no-edit save is byte-lossless').toBe(beforeStr);
    // the server detected NO content change (content_version untouched)
    expect(after.content_version).toBe(before.content_version);
  });
});
