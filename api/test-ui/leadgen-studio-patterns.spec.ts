// LeadGen v2.5.1 Phase C (DEV-67 spec supersession) — the Studio ACCEPTANCE
// evidence pack, REWRITTEN from the v2.4 Slice-F suite to the v2.5.1
// frame/unit architecture (docs/leadgen/redesign-contract-v2.5/08 §8.2 scope
// split; 01 §1.3):
//
//   §8.11  the FOUR capability patterns (08 §8.7 A–D). v2.4 authored page
//          chrome (HeaderBar/FooterBar/ProgressBar/StepIndicator/
//          BackgroundPanel) THROUGH THE SECTION PALETTE — exactly the
//          behavior v2.5.1 AMENDS away (§8.2: frame-scope types left the
//          palette; leadgen-section-builder.spec.ts ⑧ pins their absence).
//          Each pattern now authors:
//            * the FRAME via the REAL PUT /funnels/:id/frame (seed-level —
//              the Quote-Builder UI leg for template pick / region inspectors
//              / one-save persistence is already proven by
//              leadgen-quote-builder.spec.ts ②/④/⑤/⑧; re-driving it here
//              would be redundant), and
//            * the UNIT in the Section Builder through the real palette +
//              tabbed inspector (bound headline/subheadline via the §5.2
//              Question strip — the palette items insert BOUND nodes), then
//          asserts the COMPOSED result through the studio's §5.3 mode-5
//          "Preview in Quote frame" pickers (Quote → Funnel → Variant →
//          Site): the SAME capabilities the v2.4 tests asserted — progress,
//          branded header, trust/logo area, step dots, background, back
//          affordance, legal footer — as rendered markup/roles, never SSR
//          string theater. Saved units stay catalog-types + token props only.
//   §8.12  the 8 unit flows, modernized to the v2.5.1 UI with the SAME
//          behavioral assertions: §8.3 intent-first palette groups + operator
//          labels ("Yes / No", "Icon answer cards", …), the §7.1 scope header
//          ([data-scope-editing-name] replaced the old #lg-inspector-target
//          line), the scope-aware dynamic inspector tabs, and the reworked
//          Choices tab (12 §8.4 choice fields + the B9 §6.4 group controls).
//   §9.4 + §8.13 + E6: unchanged assertions. NOTE (v2.5.1 §5.3 mode-5
//          empty state): a Section used by ZERO quotes now previews inside
//          the DEFAULT template frame ({default:true} → a STATIC composed
//          document with no data-viewport/data-lg-ready markers), so every
//          test that drives unit-mode preview swaps (sims, viewport
//          round-trip) seeds its Section INTO a real Quote via
//          attachToQuote() — the shared-seed change rule 3 anticipates. The
//          assertions themselves are untouched.
//
// Determinism notes (unchanged from the v2.4 suite):
//   * every preview document swap is detected by marking the CURRENT iframe
//     root data-lg-stale="1" and waiting for an unmarked root — never by
//     timeouts racing the POST /sections/preview round trip; composed frame
//     documents are matched on their data-frame-template stamp instead of
//     data-lg-ready (they are server-rendered stills — no runtime hydrates);
//   * unit-mode screenshots/DOM assertions wait for the runtime's
//     hydration-complete marker (data-lg-ready="1", engine.ts §3.5.1).
//
// Seeding rides the REAL admin HTTP APIs only. Runs against the
// playwright.config.ts webServer (wrangler dev on :8787 with
// DEV_BYPASS_AUTH:true + ADMIN_HOST:127.0.0.1). Local D1 must be migrated +
// seeded once:
// `rm -rf .wrangler/state/v3/d1 && npm run db:migrate:local && npm run seed:local`.
//
// Screenshots (1280×800 page viewport) land in test-artifacts/fix-p4/.

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { seedActiveSite, uploadPng } from './listicles-p6-seed';

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
  bind?: string;
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
  headline_text: string;
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
// v2.5.1 frame-side seed helpers (REAL admin APIs only)
// ---------------------------------------------------------------------------

interface QuoteScaffold {
  quotePublicId: string;
  funnelPublicId: string;
  variantPublicId: string;
}

// Attach section(s) to a fresh Quote (auto-seeded funnel + control variant).
// §5.3 mode-5: a Section used by ≥1 Quote keeps the HYDRATED unit-mode
// default preview (zero-usage Sections now compose into the static default
// frame — see the header note), and the frame preview pickers gain a real
// Quote → Funnel → Variant chain to drive.
async function attachToQuote(
  request: APIRequestContext,
  quoteName: string,
  sectionIds: number[],
  vertical: string,
): Promise<QuoteScaffold> {
  const quote = await json<{
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  }>(
    await request.post(`${LG_API}/quotes`, {
      data: { quote_name: quoteName, activity: ACT, verticals: [vertical] },
    }),
    `fixp4 quote create (${quoteName})`,
  );
  const funnelPublicId = quote.funnels[0]!.public_id;
  const variantPublicId = quote.funnels[0]!.variants[0]!.public_id;
  await json(
    await request.put(`${LG_API}/variants/${variantPublicId}`, {
      data: { sections: sectionIds.map((id, position) => ({ section_id: id, position })) },
    }),
    `fixp4 variant sections (${quoteName})`,
  );
  return { quotePublicId: quote.public_id, funnelPublicId, variantPublicId };
}

// The §8.11 frame leg: attach + store the pattern's frame config through the
// REAL PUT /funnels/:id/frame (schema-legal §3.3 sparse groups — template
// defaults supply the rest, exactly the Quote Builder's own storage model).
async function createQuoteWithFrame(
  request: APIRequestContext,
  quoteName: string,
  frameConfig: Record<string, unknown>,
  sectionIds: number[],
): Promise<QuoteScaffold> {
  const sc = await attachToQuote(request, quoteName, sectionIds, VERT);
  await json(
    await request.put(`${LG_API}/funnels/${sc.funnelPublicId}/frame`, {
      data: { frame_config_json: frameConfig },
    }),
    `fixp4 frame config (${quoteName})`,
  );
  return sc;
}

async function fetchFrame(
  request: APIRequestContext,
  funnelPublicId: string,
): Promise<Record<string, unknown>> {
  const body = await json<{ frame_config: Record<string, unknown> }>(
    await request.get(`${LG_API}/funnels/${funnelPublicId}/frame`),
    `fixp4 frame read (${funnelPublicId})`,
  );
  return body.frame_config;
}

// Two filler question units so pattern variants are REAL 3-step funnels —
// the frame's automatic progress (11 §11.1: counted from the variant order)
// then shows genuine multi-step values (bar "Step 1 of 3" / 3 step dots).
let patternFillers: number[] | null = null;
async function ensurePatternFillers(request: APIRequestContext): Promise<number[]> {
  if (patternFillers) return patternFillers;
  const ids: number[] = [];
  for (let i = 0; i < 2; i += 1) {
    const created = await createSection(
      request,
      `FixP4 filler ${i + 1} ${uniq}`,
      {
        components: [
          {
            type: 'TwoButtonYesNo',
            question_id: `q_fill${i + 1}`,
            internal_field: `filler_${i + 1}`,
            answer_type: 'boolean',
            props: { yesLabel: 'Yes', noLabel: 'No' },
          },
        ],
      },
      { vertical: VERT },
    );
    ids.push(created.id);
  }
  patternFillers = ids;
  return ids;
}

// One branded CMS site (name + logo media) — the frame pickers' Site leg
// previews ITS branding (C4: any CMS site is legal, no activation required).
let brandedSite: { id: string; name: string; logoKey: string } | null = null;
async function ensureBrandedSite(
  request: APIRequestContext,
): Promise<{ id: string; name: string; logoKey: string }> {
  if (brandedSite) return brandedSite;
  const name = `FixP4 Brand Site ${uniq}`;
  const siteId = await seedActiveSite(request, `fixp4-${uniq}.e2e.test`, name);
  const logo = await uploadPng(request, `fixp4-logo-${uniq}.png`);
  await json(
    await request.patch('/api/admin/settings', {
      data: { site_id: siteId, updates: { site_name: name, logo_media_id: logo.storage_key } },
    }),
    'fixp4 site branding',
  );
  brandedSite = { id: siteId, name, logoKey: logo.storage_key };
  return brandedSite;
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
  // …hydrated to completion (engine.ts sets data-lg-ready after enterSection;
  // non-default sims are server stills that carry the marker by construction)
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

// --- §5.3 mode-5 composed-preview helpers (frame pickers) --------------------

// A composed frame document is a server-rendered STILL (renderQuoteFrame — no
// runtime, no data-viewport/data-lg-ready markers); its root carries the
// data-frame-template stamp, which is what detects the swap.
async function waitComposedPreview(page: Page, template: string): Promise<void> {
  await expect(
    pFrame(page).locator(`#lg-funnel-root[data-frame-template="${template}"]:not([data-lg-stale])`),
  ).toBeAttached({ timeout: 20_000 });
}

// Drive the §5.3 mode-5 "Preview in Quote frame" pickers: Quote → Funnel →
// Variant (progress totals ride the variant) → Site branding. Each cascade
// level's options load asynchronously — wait for the option, then select.
async function pickFrameForPreview(
  page: Page,
  sc: QuoteScaffold & { siteId?: string },
  template: string,
): Promise<void> {
  const quoteSel = page.locator('[data-frame-pick-quote]');
  await expect(quoteSel.locator(`option[value="${sc.quotePublicId}"]`)).toHaveCount(1, {
    timeout: 20_000,
  });
  // Picking the quote fires a unit-mode refresh (no funnel yet) AND the async
  // funnel/site option loads. Let that refresh land BEFORE composing so an
  // out-of-order fetch can never replace the composed document afterwards.
  await markPreviewStale(page);
  await quoteSel.selectOption(sc.quotePublicId);
  await waitFreshPreview(page, 'desktop');

  const funnelSel = page.locator('[data-frame-pick-funnel]');
  await expect(funnelSel.locator(`option[value="${sc.funnelPublicId}"]`)).toHaveCount(1, {
    timeout: 20_000,
  });
  await markPreviewStale(page);
  await funnelSel.selectOption(sc.funnelPublicId);
  await waitComposedPreview(page, template);

  const variantSel = page.locator('[data-frame-pick-variant]');
  await expect(variantSel.locator(`option[value="${sc.variantPublicId}"]`)).toHaveCount(1, {
    timeout: 20_000,
  });
  await markPreviewStale(page);
  await variantSel.selectOption(sc.variantPublicId);
  await waitComposedPreview(page, template);

  if (sc.siteId !== undefined) {
    const siteSel = page.locator('[data-frame-pick-site]');
    await expect(siteSel.locator(`option[value="${sc.siteId}"]`)).toHaveCount(1, {
      timeout: 20_000,
    });
    await markPreviewStale(page);
    await siteSel.selectOption(sc.siteId);
    await waitComposedPreview(page, template);
  }
}

async function setComposedViewport(
  page: Page,
  viewport: 'desktop' | 'mobile',
  template: string,
): Promise<void> {
  await markPreviewStale(page);
  await page.locator(`[data-preview-viewport="${viewport}"]`).click();
  await waitComposedPreview(page, template);
}

// The preview boot posts its would-fire view events (quote_view +
// section_view) to the §8.9 events panel a beat AFTER hydration (beacon batch
// → postMessage). The panel's unbreakable compact-JSON lines USED TO stretch
// the whole admin layout past the viewport; the §8.1/E6 studio layout-hygiene
// fix (ui-section-studio.ts: .studio-events-list li overflow-wrap:anywhere +
// word-break, and .admin-main{min-width:0}) has since landed and contains them
// — the pin at the bottom of this file now GUARDS that fix. The panel's
// compact-JSON content still varies a few chars per boot (per-boot ids), so
// every unit-mode preview measurement/screenshot first WAITS for the events to
// land (deterministic sequencing of the async side effect) and then removes
// that per-boot-varying content, so the § under test gets a clean, stable
// signal. Idempotent per preview document (marker on the srcdoc root).
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

// Composed frame documents are script-free stills — nothing posts events, so
// no noise settle applies; only the paint settle.
async function shootComposed(page: Page, file: string): Promise<Buffer> {
  await page.waitForTimeout(200);
  return page.locator('#lg-preview-frame').screenshot({ path: `${SHOT_DIR}/${file}` });
}

// Open /sections/new with the feeder pair picked + name/headline (+ optional
// subheadline — the §5.2 canonical strip inputs) filled and the boot preview
// document hydrated (so later stale-marking is race-free).
async function openNewStudio(
  page: Page,
  name: string,
  copy: { headline?: string; subheadline?: string } = {},
): Promise<void> {
  await ensureFeederOffer(page.request);
  await page.goto('/admin/leadgen/sections/new', { waitUntil: 'domcontentloaded' });
  const activity = page.locator('#lg-section-activity');
  await expect(activity.locator(`option[value="${ACT}"]`)).toHaveCount(1);
  await activity.selectOption(ACT);
  const vertical = page.locator('#lg-section-vertical');
  await expect(vertical.locator(`option[value="${VERT}"]`)).toHaveCount(1);
  await vertical.selectOption(VERT);
  await page.fill('#lg-section-name', name);
  await page.fill('#lg-section-headline', copy.headline ?? name);
  if (copy.subheadline !== undefined) {
    await page.fill('#lg-section-subheadline', copy.subheadline);
  }
  await waitBootPreview(page);
}

// §8.3 operator labels (STUDIO_TYPE_META) — the §7.1 scope header shows the
// LABEL of the selected component (type ids never surface). NumberRangeQuestion
// shares the SAME "Slider" label as the retired plain RangeQuestion.
const TYPE_LABELS: Record<string, string> = {
  QuestionHeadline: 'Question headline',
  Subheadline: 'Subheadline',
  ButtonAnswerGroup: 'Simple answer buttons',
  TwoButtonYesNo: 'Yes / No',
  IconCardAnswerGrid: 'Icon answer cards',
  ImageCardAnswerGrid: 'Image answer cards',
  DropdownQuestion: 'Dropdown',
  // v3.1 §5.6/§8.1: the whole 8-value Accept-swap family (FreeText/Number/
  // Currency/Email/Phone/ZIP/Date/Address) reads "Short text field" in the
  // inspector scope header — never its own concrete-type catalog label.
  ZIPInputQuestion: 'Short text field',
  EmailInputQuestion: 'Short text field',
  PhoneInputQuestion: 'Short text field',
  NameFieldsGroup: 'Name',
  NumberRangeQuestion: 'Slider',
  CurrencyRangeQuestion: 'Amount slider',
  ContinueButton: 'Continue button',
  TextBlock: 'Text',
  Stack: 'Stack',
};

// v3.1 Phase B redesign: the palette is now 20 golden TILES keyed by
// data-tile/data-name (contract §5.2/§5.5) — NOT one dedicated
// data-add-component per catalog type. Grounded directly in
// ui-section-studio.ts's own STUDIO_LIBRARY_GROUPS tile table + the
// LEADGEN_FIELD_ACCEPT_TYPE reverse map (content-schema.ts): each entry names
// the tile to click, plus (when the wanted type is not that tile's own
// §5.6 default) the swap control that reaches it.
type SwapKind = 'accept' | 'cardStyle' | 'sliderFormat' | 'searchable';
interface TileInsert {
  dataName: string;
  swap?: SwapKind;
  swapValue?: string;
}
const TYPE_INSERT: Partial<Record<string, TileInsert>> = {
  // direct tile defaults — no swap (§5.2 table)
  FreeTextQuestion: { dataName: 'short text' },
  ButtonAnswerGroup: { dataName: 'buttons' },
  IconCardAnswerGrid: { dataName: 'cards' },
  ContinueButton: { dataName: 'continue button' },
  TwoButtonYesNo: { dataName: 'yes no' },
  DropdownQuestion: { dataName: 'dropdown' },
  MultiChoiceCardGroup: { dataName: 'multi-select' },
  NumberInputQuestion: { dataName: 'number' },
  CurrencyInputQuestion: { dataName: 'amount money' },
  DateQuestion: { dataName: 'date' },
  NumberRangeQuestion: { dataName: 'slider scale' },
  AddressAutocompleteQuestion: { dataName: 'address zip location' },
  TextBlock: { dataName: 'text legal note reassurance disclosure' },
  ImageBlock: { dataName: 'image logo picture' },
  Spacer: { dataName: 'spacer gap' },
  CardPanel: { dataName: 'card panel' },
  Columns: { dataName: 'columns' },
  GridContainer: { dataName: 'grid' },
  // §5.6 the Accept-swap rule — base tile "short text" (FreeTextQuestion)
  EmailInputQuestion: { dataName: 'short text', swap: 'accept', swapValue: 'email' },
  PhoneInputQuestion: { dataName: 'short text', swap: 'accept', swapValue: 'phone' },
  ZIPInputQuestion: { dataName: 'short text', swap: 'accept', swapValue: 'us_zip' },
  // §5.6 Cards style swap — base tile "cards" (IconCardAnswerGrid)
  ImageCardAnswerGrid: { dataName: 'cards', swap: 'cardStyle', swapValue: 'image' },
  // §5.6 Slider Format $ swap — base tile "slider scale" (NumberRangeQuestion)
  CurrencyRangeQuestion: { dataName: 'slider scale', swap: 'sliderFormat' },
  // §5.5 Searchable-dropdown swap — base tile "dropdown" (DropdownQuestion)
  SearchableDropdownQuestion: { dataName: 'dropdown', swap: 'searchable' },
  // NOT in TYPE_INSERT (intentionally — see per-test rework, not a generic
  // helper case): Stack (no tile — golden §5.2 dropped it; reached via the
  // pre-existing "Group → Stack" toolbar action instead), NameFieldsGroup
  // (only reachable bundled inside the "Contact" tile's 3-node Stack), plain
  // RangeQuestion (retired — the Slider tile's family is
  // NumberRangeQuestion ⇄ CurrencyRangeQuestion only; the "range slider"
  // authoring BEHAVIOR survives via NumberRangeQuestion), ReassuranceBadge
  // (collapses into TextBlock per §5.3(b) — the specific "reassurance" role
  // has no inspector control yet, Phase C).
};

// Library click-to-add. Clicks the golden TILE (data-tile/data-name), then
// performs the §5.6 swap (Accept / Card-style / Slider-format / Searchable)
// when the wanted type isn't the tile's own default — asserted via the §7.1
// scope header (operator label) + the canvas node count (the server
// re-render carries the new node). `.first()` on the tile locator is
// deliberate: "Buttons"/"Cards"/"Short text" repeat once in the Suggested
// group (contract §5.2: "identical insert semantics") — both are always
// visible (Suggested/Answer-fields default OPEN), so `.first()`
// deterministically picks the Suggested copy (DOM order).
async function addComponent(page: Page, type: string): Promise<void> {
  const canvasNodes = page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type]');
  const before = await canvasNodes.count();
  const insert = TYPE_INSERT[type];
  if (!insert) {
    throw new Error(
      `addComponent: no §5.6 tile mapping for type "${type}" — it needs a dedicated authoring sequence (Stack/Contact/retired types), not the generic helper. See TYPE_INSERT's comment.`,
    );
  }
  await page.locator(`[data-tile][data-name="${insert.dataName}"]`).first().click();
  await expect(canvasNodes).toHaveCount(before + 1, { timeout: 20_000 });
  if (insert.swap === 'accept') {
    await page.locator('[data-toolbar-accept]').selectOption(insert.swapValue!);
  } else if (insert.swap === 'cardStyle') {
    await page.locator(`[data-card-style="${insert.swapValue}"]`).click();
  } else if (insert.swap === 'sliderFormat') {
    await page.locator('[data-toolbar-slider-format]').click();
  } else if (insert.swap === 'searchable') {
    await page.locator('[data-toolbar-searchable]').click();
  }
  await expect(page.locator('[data-scope-editing-name]')).toHaveText(TYPE_LABELS[type] ?? type);
}

// Arm the "+ After" insertion point on the CURRENT selection, then add — the
// §8.4 way to append the next SIBLING inside the same container.
async function addAfterSelected(page: Page, type: string): Promise<void> {
  await page.locator('[data-studio-act="add-after"]').click();
  await expect(page.locator('[data-studio-act="add-after"]')).toHaveAttribute('aria-pressed', 'true');
  await addComponent(page, type);
}

// §5.2 dropped "Stack" as a directly-insertable tile (contract's Layout
// group table lists only Card/Columns/Grid/Spacer). The pre-existing
// "Group → Stack" toolbar action (data-studio-act="group-stack") wraps the
// CURRENTLY SELECTED node into a new Stack container and moves the
// selection to it — the equivalent-but-reordered authoring path: insert the
// child FIRST (already selected), then group it, THEN configure the Stack's
// own layout props. End model shape is IDENTICAL to the old
// wrap-then-insert-into sequence (Stack node with the child in `.children`).
async function groupSelectionIntoStack(page: Page): Promise<void> {
  await page.locator('[data-studio-act="group-stack"]').click();
  await expect(page.locator('[data-scope-editing-name]')).toHaveText('Stack');
}

// §7.3: the tab strip is DYNAMIC per selection — a tab must be visible
// (available for the selected type) before it can be opened.
async function openInspectorTab(page: Page, key: string): Promise<void> {
  const tab = page.locator(`[data-studio-inspector-tab="${key}"]`);
  await expect(tab).toBeVisible();
  await tab.click();
}

// Content tab copy field. Panel-scoped: the §6.5 canvas toolbar carries
// sibling quick controls with the same data-inspector-field keys. v3.1 §8.3:
// "label" now resolves to THREE distinct elements in the same panel
// (Continue's "Button label", a text field's dedicated "Field label", and
// the generic CONTENT_CONTROLS "Label" row for other types) — only ONE is
// ever visible for a given selection, so scope to the visible match.
async function setContentField(page: Page, key: string, value: string): Promise<void> {
  await openInspectorTab(page, 'content');
  await page.locator(`[data-studio-panel="content"] input[data-inspector-field="${key}"]:visible`).fill(value);
}

// v3.1 §8.8: Advanced is a persistent disclosure BELOW the 5-tab strip (not
// a 6th tab/panel) — open it via its own toggle button, not openInspectorTab.
async function openAdvancedDisclosure(page: Page): Promise<void> {
  const body = page.locator('[data-studio-advanced-body]');
  if (await body.isHidden()) {
    await page.locator('[data-studio-advanced-toggle]').click();
  }
  await expect(body).toBeVisible();
}

// Advanced disclosure internal_field (the sanctioned rename surface).
async function setInternalField(page: Page, value: string): Promise<void> {
  await openAdvancedDisclosure(page);
  await page
    .locator('[data-studio-advanced-body] input[data-inspector-field="internal_field"]')
    .fill(value);
}

// v3.1 §8.2: Validation folds into the Content tab's Answer-format group.
async function setValidationProp(page: Page, key: string, value: string): Promise<void> {
  await openInspectorTab(page, 'content');
  await page.locator(`[data-inspector-vprop="${key}"]`).fill(value);
}

// v3.1 §8.2/§8.5: Layout folds into the Style tab (design_overrides.size'
// per-selection variant, field-style-block). PANEL-scoped: the §6.5 canvas
// toolbar mirrors the same data-container-prop quick controls.
function containerGroup(page: Page, type: string) {
  return page.locator(`[data-studio-panel="style"] [data-container-group="${type}"]`);
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
// `bind` is the §5.2 bound-node marker (section_headline/section_subheadline).
// ---------------------------------------------------------------------------

const NODE_KEYS = new Set([
  'type',
  'question_id',
  'question_key',
  'internal_field',
  'answer_type',
  'required',
  'valid_values',
  'bind',
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
// §8.11 — the four capability patterns (08 §8.7 A–D), frame + unit
// ---------------------------------------------------------------------------

// NOT .serial: every test seeds its own data (workers:1 keeps execution
// sequential anyway), so a red product-finding test never masks the evidence
// of the tests behind it.
test.describe('LeadGen Studio §8.11 — four capability patterns, frame(Quote) + unit(Section) (v2.5.1)', () => {
  test('pattern 1 — centered question card: progress, headline, subheadline, answer buttons, trust/logo area', async ({ page }) => {
    test.setTimeout(240_000);
    // UNIT authored through the real palette + inspector (§8.7 A unit column:
    // bound headline+sub, button answer group, Continue; in-unit reassurance).
    await openNewStudio(page, `P1 Centered Card ${uniq}`, {
      headline: 'Are you currently insured?',
      subheadline: 'It takes under 2 minutes to compare quotes.',
    });
    // §5.2/§5.4: a NEW Section already carries the BOUND QuestionHeadline +
    // Subheadline nodes (one store — the strip inputs above). v3.1 §5.4
    // retires Headline/Subheadline as PALETTE ITEMS entirely (no
    // data-add-component tile exists for them anymore) — the bound-node-
    // exists signal now lives on the STRIP's "Show" chip instead, which
    // stays HIDDEN while the bound node is present (the same mechanism this
    // assertion originally meant to pin).
    await expect(page.locator('[data-bound-chip="section_headline"]')).toBeHidden();
    await addComponent(page, 'ButtonAnswerGroup');
    await openInspectorTab(page, 'content');
    await fillChoiceRow(page, 0, { label: 'Yes, I have coverage', value: 'yes', analytics_id: 'p1_yes' });
    await fillChoiceRow(page, 1, { label: 'Not yet', value: 'no', analytics_id: 'p1_no' });
    await setInternalField(page, 'currently_insured');
    await addComponent(page, 'ContinueButton');
    // v3.1 §5.3(b): ReassuranceBadge collapses into the Text primitive
    // (TextBlock) — the retired type is no longer placeable; the in-unit
    // reassurance-COPY behavior survives via the "Text" tile. (The specific
    // "reassurance" Style→Role treatment has no inspector control yet —
    // that's Phase C; this asserts the surviving copy capability only.)
    await addComponent(page, 'TextBlock');
    await setContentField(page, 'text', 'Get your offers in 2 minutes or less.');

    // the bound copy renders on the CANVAS from the ONE store (§5.2)
    const canvas = page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render');
    await expect(canvas.locator('h1.lg-headline')).toHaveText('Are you currently insured?');
    await expect(canvas.locator('[data-component-type="Subheadline"]')).toHaveText(
      'It takes under 2 minutes to compare quotes.',
    );

    await saveStudio(page);
    const publicId = publicIdFromUrl(page);
    const saved = await fetchSection(page.request, publicId);

    // FRAME: §8.7 A `centered` — trust logo strip below unit + legal footer
    // (progress bar under header + centered card slot are the template).
    const fillers = await ensurePatternFillers(page.request);
    const site = await ensureBrandedSite(page.request);
    const sc = await createQuoteWithFrame(page.request, `P1 Quote ${uniq}`, {
      version: 1,
      template: 'centered',
      trust_strip: {
        enabled: true,
        source: 'manual',
        logos: [
          { media_id: `logos/p1-trust-a-${uniq}.png`, alt: 'Trust brand A' },
          { media_id: `logos/p1-trust-b-${uniq}.png`, alt: 'Trust brand B' },
        ],
        placement: 'below_unit',
      },
      footer: {
        enabled: true,
        links_source: 'manual',
        links: [
          { label: 'Privacy', href: '/privacy' },
          { label: 'Terms', href: '/terms' },
        ],
        trust_text: 'Licensed advisor network',
      },
    }, [saved.id, ...fillers]);

    // COMPOSED preview through the §5.3 mode-5 pickers
    await page.goto(`/admin/leadgen/sections/${publicId}/edit`, { waitUntil: 'domcontentloaded' });
    await waitBootPreview(page);
    await pickFrameForPreview(page, { ...sc, siteId: site.id }, 'centered');

    const f = pFrame(page);
    // progress chrome — REAL 3-step funnel values (variant order drives it)
    const progress = f.locator('[data-frame-region="progress"] .lg-progress[role="progressbar"]');
    await expect(progress).toBeAttached();
    await expect(progress).toHaveAttribute('aria-valuemax', '3');
    // branded logo area (site branding rode the Site picker)
    await expect(f.locator('[data-frame-region="logo"] img.lg-logo-img')).toBeVisible();
    // the centered question card = the frame's section slot in card mode
    await expect(f.locator('[data-frame-region="section_slot"]')).toHaveClass(/lg-frame-slot--card/);
    // the unit inside it: bound headline text + subheadline slot + answers
    await expect(f.locator('h1.lg-headline')).toHaveText('Are you currently insured?');
    await expect(f.locator('[data-component-type="Subheadline"]')).toBeAttached();
    await expect(f.locator('.lg-answer-group button[data-lg-choice="yes"]')).toHaveText(
      'Yes, I have coverage',
    );
    await expect(f.locator('.lg-answer-group button[data-lg-choice="no"]')).toHaveText('Not yet');
    await expect(f.locator('button.lg-continue')).toBeAttached();
    await expect(f.locator('[data-component-type="TextBlock"]')).toContainText(
      'Get your offers in 2 minutes or less.',
    );
    // trust/logo area below the unit + the legal footer
    await expect(f.locator('[data-frame-region="trust_strip"] img.lg-logo-strip-img')).toHaveCount(2);
    await expect(f.locator('[data-frame-region="footer"] .lg-footerbar-link')).toHaveCount(2);
    await expect(f.locator('[data-frame-region="footer"] .lg-footerbar-trust-item')).toHaveCount(1);
    await shootComposed(page, 'pattern-1-desktop.png');

    await setComposedViewport(page, 'mobile', 'centered');
    expect(Math.round((await page.locator('#lg-preview-frame').boundingBox())!.width)).toBeLessThanOrEqual(377);
    await expect(f.locator('h1.lg-headline')).toBeVisible();
    await shootComposed(page, 'pattern-1-mobile.png');

    // saved UNIT model: catalog types + tokens only; chrome lives in the frame
    const comps = saved.content_json.components;
    expect(comps.map((c) => c.type)).toEqual([
      'QuestionHeadline',
      'Subheadline',
      'ButtonAnswerGroup',
      'ContinueButton',
      'TextBlock',
    ]);
    expect(comps[0]!.bind, 'headline is the §5.2 bound node (one store)').toBe('section_headline');
    expect(comps[0]!.props?.['text'], 'bound node never stores duplicate text').toBeUndefined();
    expect(comps[1]!.bind).toBe('section_subheadline');
    expect(saved.headline_text).toBe('Are you currently insured?');
    const group = comps[2]!;
    expect(group.internal_field).toBe('currently_insured');
    expect((group.choices ?? []).map((c) => c['value'])).toEqual(['yes', 'no']);
    assertTokenizedModel(saved.content_json, [
      'QuestionHeadline',
      'Subheadline',
      'ButtonAnswerGroup',
      'ContinueButton',
      'TextBlock',
    ]);
    // the frame side persisted through the REAL frame API
    const frame = await fetchFrame(page.request, sc.funnelPublicId);
    expect(frame['template']).toBe('centered');
    expect(((frame['trust_strip'] as Record<string, unknown>)['logos'] as unknown[]).length).toBe(2);
  });

  test('pattern 2 — branded header/footer frame, stacked buttons, Back, secure/trust messaging', async ({ page }) => {
    test.setTimeout(240_000);
    // UNIT: headline + vertical Stack (token props) holding the answer group.
    await openNewStudio(page, `P2 Branded Frame ${uniq}`, {
      headline: 'Which coverage do you want to compare?',
    });
    // §5.2: the bound headline/subheadline nodes are pre-seeded on a NEW unit.
    // v3.1 §5.2 dropped "Stack" as a directly-insertable tile — insert the
    // answer group FIRST (root, auto-selected), THEN "Group → Stack" wraps
    // it (equivalent end model shape: Stack containing the ButtonAnswerGroup
    // — just insert-then-wrap instead of wrap-then-insert-into).
    await addComponent(page, 'ButtonAnswerGroup');
    await groupSelectionIntoStack(page);
    await openInspectorTab(page, 'style');
    const stack = containerGroup(page, 'Stack');
    await stack.locator('select[data-container-prop="direction"]').selectOption('vertical');
    await stack.locator('select[data-container-prop="gap"]').selectOption('s');
    await stack.locator('select[data-container-prop="align"]').selectOption('stretch');
    // re-select the ButtonAnswerGroup CHILD (grouping moved the selection to
    // the new Stack wrapper) before authoring its choices.
    await page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type="ButtonAnswerGroup"]').click();
    await openInspectorTab(page, 'content');
    await fillChoiceRow(page, 0, { label: 'Home coverage', value: 'home', analytics_id: 'p2_home' });
    await fillChoiceRow(page, 1, { label: 'Auto coverage', value: 'auto', analytics_id: 'p2_auto' });
    await page.locator('#lg-choice-add').click();
    await fillChoiceRow(page, 2, { label: 'Life coverage', value: 'life', analytics_id: 'p2_life' });
    await setInternalField(page, 'coverage_type');

    await saveStudio(page);
    const publicId = publicIdFromUrl(page);
    const saved = await fetchSection(page.request, publicId);

    // FRAME: §8.7 B `header-footer` — site logo + tagline + secure badge,
    // LARGE site footer (logo + links + trust text + legal), back text link
    // (template default position in_card).
    const fillers = await ensurePatternFillers(page.request);
    const site = await ensureBrandedSite(page.request);
    const sc = await createQuoteWithFrame(page.request, `P2 Quote ${uniq}`, {
      version: 1,
      template: 'header-footer',
      header: {
        tagline: 'Coverage made simple',
        secure_badge: { enabled: true, text: 'Your information is secure' },
      },
      footer: {
        enabled: true,
        links_source: 'manual',
        links: [
          { label: 'Privacy', href: '/privacy' },
          { label: 'Terms', href: '/terms' },
        ],
        trust_text: 'No spam, ever',
        description: '© 2026 Acme Insurance. Terms apply.',
      },
    }, [saved.id, ...fillers]);

    await page.goto(`/admin/leadgen/sections/${publicId}/edit`, { waitUntil: 'domcontentloaded' });
    await waitBootPreview(page);
    await pickFrameForPreview(page, { ...sc, siteId: site.id }, 'header-footer');

    const f = pFrame(page);
    // branded site header: logo image + tagline + secure messaging
    const header = f.locator('[data-frame-region="header"]');
    await expect(header.locator('img.lg-logo-img')).toBeVisible();
    await expect(header.locator('.lg-frame-tagline')).toHaveText('Coverage made simple');
    await expect(header.locator('.lg-secure-badge')).toContainText('Your information is secure');
    // progress present (template default bar under the header)
    await expect(f.locator('[data-frame-region="progress"] .lg-progress[role="progressbar"]')).toBeAttached();
    // stacked (vertical) answer buttons inside the unit
    await expect(
      f.locator('[data-component-type="Stack"][data-direction="vertical"] .lg-answer-group button[data-lg-choice]'),
    ).toHaveCount(3);
    // Back affordance — frame-owned (§11.2), rendered at its in_card position
    await expect(
      f.locator('[data-frame-region="section_slot"] [data-frame-region="back"] button.lg-back'),
    ).toBeAttached();
    // the LARGE branded footer: site logo + links + trust + legal
    const footer = f.locator('[data-frame-region="footer"]');
    await expect(footer.locator('img.lg-frame-footer-logo')).toBeAttached();
    await expect(footer.locator('.lg-footerbar-link')).toHaveCount(2);
    await expect(footer.locator('.lg-footerbar-trust-item')).toHaveCount(1);
    await expect(footer.locator('.lg-footerbar-legal')).toContainText('© 2026 Acme Insurance.');
    await shootComposed(page, 'pattern-2-desktop.png');

    await setComposedViewport(page, 'mobile', 'header-footer');
    await expect(header).toBeVisible();
    await shootComposed(page, 'pattern-2-mobile.png');

    // saved UNIT model — Stack props are exactly the picked §8.5 tokens
    // (the two §5.2 bound nodes lead every new unit)
    const comps = saved.content_json.components;
    expect(comps.map((c) => c.type)).toEqual(['QuestionHeadline', 'Subheadline', 'Stack']);
    expect(comps[2]!.props).toEqual({ direction: 'vertical', gap: 's', align: 'stretch' });
    expect((comps[2]!.children ?? []).map((c) => c.type)).toEqual(['ButtonAnswerGroup']);
    const group = (comps[2]!.children ?? [])[0]!;
    expect(group.internal_field).toBe('coverage_type');
    expect((group.choices ?? []).map((c) => c['value'])).toEqual(['home', 'auto', 'life']);
    assertTokenizedModel(saved.content_json, ['QuestionHeadline', 'Subheadline', 'Stack', 'ButtonAnswerGroup']);
    // frame persistence: tagline + secure text stored on the funnel frame
    const frame = await fetchFrame(page.request, sc.funnelPublicId);
    expect(frame['template']).toBe('header-footer');
    const storedHeader = frame['header'] as Record<string, unknown>;
    expect(storedHeader['tagline']).toBe('Coverage made simple');
    expect((storedHeader['secure_badge'] as Record<string, unknown>)['text']).toBe(
      'Your information is secure',
    );
  });

  test('pattern 3 — header with logo + call CTA, large question, ZIP + Next, disclosure + benefit bar', async ({ page }) => {
    test.setTimeout(240_000);
    // UNIT: §8.7 C — large headline/sub, ZIP input, Next button. (The §6.5
    // input-icon quick control is a REGISTERED schema-bounded gap — DEV-64b —
    // so the icon leg is not asserted.)
    await openNewStudio(page, `P3 Call CTA Header ${uniq}`, {
      headline: 'How much coverage do you need?',
      subheadline: 'Compare rates in your area.',
    });
    // §5.2: the bound headline/subheadline nodes are pre-seeded on a NEW unit
    await addComponent(page, 'ZIPInputQuestion');
    await setContentField(page, 'placeholder', 'ZIP code');
    await setInternalField(page, 'zip');
    await addComponent(page, 'ContinueButton');
    await setContentField(page, 'label', 'Next');

    await saveStudio(page);
    const publicId = publicIdFromUrl(page);
    const saved = await fetchSection(page.request, publicId);

    // FRAME: §8.7 C `header-cta` — disclosure top bar (template), call CTA,
    // benefit bar below the unit, back link below the card (template).
    const fillers = await ensurePatternFillers(page.request);
    const site = await ensureBrandedSite(page.request);
    const sc = await createQuoteWithFrame(page.request, `P3 Quote ${uniq}`, {
      version: 1,
      template: 'header-cta',
      header: {
        cta: { enabled: true, label: 'Call (800) 555-0199', tel: '+18005550199' },
      },
      disclosure: {
        enabled: true,
        location: 'top_bar',
        link_label: 'Advertising Disclosure',
        text: 'We may receive compensation from our partners.',
      },
      benefit_bar: {
        enabled: true,
        items: [
          { icon: '✓', text: 'Free quotes' },
          { icon: '⚡', text: '2-minute process' },
        ],
        placement: 'below_unit',
      },
    }, [saved.id, ...fillers]);

    await page.goto(`/admin/leadgen/sections/${publicId}/edit`, { waitUntil: 'domcontentloaded' });
    await waitBootPreview(page);
    await pickFrameForPreview(page, { ...sc, siteId: site.id }, 'header-cta');

    const f = pFrame(page);
    // disclosure top bar
    await expect(f.locator('[data-frame-region="disclosure"] .lg-disclosure').first()).toHaveText(
      'Advertising Disclosure',
    );
    // header: logo + the call CTA (tel: link derived from the config)
    await expect(f.locator('[data-frame-region="header"] img.lg-logo-img')).toBeVisible();
    const cta = f.locator('.lg-frame-header-cta');
    await expect(cta).toHaveText('Call (800) 555-0199');
    expect(await cta.getAttribute('href')).toContain('8005550199');
    // progress present
    await expect(f.locator('[data-frame-region="progress"] .lg-progress[role="progressbar"]')).toBeAttached();
    // the unit: large question + ZIP + Next
    await expect(f.locator('h1.lg-headline')).toHaveText('How much coverage do you need?');
    // the ZIP preset IS the input element (hydration attrs ride the <input>)
    const zipInput = f.locator('input[data-component-type="ZIPInputQuestion"]');
    await expect(zipInput).toHaveAttribute('inputmode', 'numeric');
    await expect(zipInput).toHaveAttribute('maxlength', '5');
    await expect(f.locator('button.lg-continue')).toHaveText('Next');
    // benefit bar below the unit (TrustBar preset over config items)
    await expect(f.locator('[data-frame-region="benefit_bar"] .lg-trustbar-item')).toHaveCount(2);
    // back link at the template's below-card position
    await expect(
      f.locator('[data-frame-region="back"].lg-frame-back--pos-below_card button.lg-back'),
    ).toBeAttached();
    await shootComposed(page, 'pattern-3-desktop.png');

    await setComposedViewport(page, 'mobile', 'header-cta');
    await expect(f.locator('.lg-frame-header-cta')).toBeAttached();
    await shootComposed(page, 'pattern-3-mobile.png');

    // saved UNIT model
    const comps = saved.content_json.components;
    expect(comps.map((c) => c.type)).toEqual([
      'QuestionHeadline',
      'Subheadline',
      'ZIPInputQuestion',
      'ContinueButton',
    ]);
    expect(comps[2]!.internal_field).toBe('zip');
    expect(comps[2]!.props).toMatchObject({ placeholder: 'ZIP code' });
    expect(comps[3]!.props).toMatchObject({ label: 'Next' });
    assertTokenizedModel(saved.content_json, [
      'QuestionHeadline',
      'Subheadline',
      'ZIPInputQuestion',
      'ContinueButton',
    ]);
    // frame persistence: the call CTA config
    const frame = await fetchFrame(page.request, sc.funnelPublicId);
    expect(frame['template']).toBe('header-cta');
    const storedCta = (frame['header'] as Record<string, unknown>)['cta'] as Record<string, unknown>;
    expect(storedCta['label']).toBe('Call (800) 555-0199');
    expect(storedCta['tel']).toBe('+18005550199');
  });

  test('pattern 4 — full-background design with centered card, step indicator, answer cards with title+subtext, Back, legal footer', async ({ page }) => {
    test.setTimeout(240_000);
    // UNIT: §8.7 D — question + answer cards with title+subtitle (§8.4 choice
    // depth via the Choices tab). The white card + step dots + background +
    // legal footer are the FRAME (template `full-background`).
    await openNewStudio(page, `P4 Background Card ${uniq}`, {
      headline: 'Who is the coverage for?',
    });
    // §5.2: the bound headline/subheadline nodes are pre-seeded on a NEW unit
    await addComponent(page, 'IconCardAnswerGrid');
    await openInspectorTab(page, 'content');
    await fillChoiceRow(page, 0, {
      label: 'For me',
      value: 'self',
      analytics_id: 'p4_self',
      icon: '🙋',
      title: 'For me',
      subtitle: 'Coverage for yourself',
    });
    await fillChoiceRow(page, 1, {
      label: 'For my family',
      value: 'family',
      analytics_id: 'p4_family',
      icon: '👪',
      title: 'For my family',
      subtitle: 'Protect the whole household',
    });
    await setInternalField(page, 'coverage_for');

    await saveStudio(page);
    const publicId = publicIdFromUrl(page);
    const saved = await fetchSection(page.request, publicId);

    // FRAME: `full-background` template = brand background + floating logo +
    // step DOTS above the white card slot (progress counts the REAL 3-slide
    // variant — the v2.5 model authors multi-step state by funnel length,
    // not hand-typed numerals) + legal footer.
    const fillers = await ensurePatternFillers(page.request);
    const site = await ensureBrandedSite(page.request);
    const sc = await createQuoteWithFrame(page.request, `P4 Quote ${uniq}`, {
      version: 1,
      template: 'full-background',
      footer: {
        enabled: true,
        links_source: 'manual',
        description: 'Rates depend on underwriting. © 2026 Acme.',
      },
    }, [saved.id, ...fillers]);

    await page.goto(`/admin/leadgen/sections/${publicId}/edit`, { waitUntil: 'domcontentloaded' });
    await waitBootPreview(page);
    await pickFrameForPreview(page, { ...sc, siteId: site.id }, 'full-background');

    const f = pFrame(page);
    // the brand background layer
    await expect(f.locator('[data-frame-region="background"]')).toHaveClass(/lg-frame-bg-style-brand/);
    // branded logo above the card
    await expect(f.locator('[data-frame-region="logo"] img.lg-logo-img')).toBeVisible();
    // step DOTS with the real multi-step values (3-slide variant, step 1)
    const steps = f.locator('[data-frame-region="progress"] .lg-steps[role="progressbar"]');
    await expect(steps).toBeAttached();
    await expect(steps).toHaveAttribute('aria-valuemax', '3');
    await expect(steps.locator('.lg-step')).toHaveCount(3);
    await expect(steps.locator('.lg-step[data-active="true"]')).toHaveCount(1);
    // the white centered card = the slot in card mode, holding the unit
    await expect(f.locator('[data-frame-region="section_slot"]')).toHaveClass(/lg-frame-slot--card/);
    await expect(f.locator('h1.lg-headline')).toHaveText('Who is the coverage for?');
    // answer cards with title + subtext (§8.4 title/subtitle slots)
    const cards = f.locator('.lg-card-grid button.lg-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).locator('.lg-card-title')).toHaveText('For me');
    await expect(cards.nth(0).locator('.lg-card-subtitle')).toHaveText('Coverage for yourself');
    await expect(cards.nth(1).locator('.lg-card-title')).toHaveText('For my family');
    await expect(cards.nth(1).locator('.lg-card-subtitle')).toHaveText('Protect the whole household');
    // Back affordance at the template's in-card position
    await expect(
      f.locator('[data-frame-region="section_slot"] [data-frame-region="back"] button.lg-back'),
    ).toBeAttached();
    // legal footer
    await expect(f.locator('[data-frame-region="footer"] .lg-footerbar-legal')).toContainText(
      'Rates depend on underwriting.',
    );
    await shootComposed(page, 'pattern-4-desktop.png');

    await setComposedViewport(page, 'mobile', 'full-background');
    await expect(f.locator('[data-frame-region="section_slot"]')).toBeVisible();
    await shootComposed(page, 'pattern-4-mobile.png');

    // saved UNIT model — §8.4 choice depth persisted (bound pair leads)
    const comps = saved.content_json.components;
    expect(comps.map((c) => c.type)).toEqual(['QuestionHeadline', 'Subheadline', 'IconCardAnswerGrid']);
    const grid = comps[2]!;
    expect(grid.internal_field).toBe('coverage_for');
    expect((grid.choices ?? []).map((c) => [c['value'], c['icon'], c['title'], c['subtitle']])).toEqual([
      ['self', '🙋', 'For me', 'Coverage for yourself'],
      ['family', '👪', 'For my family', 'Protect the whole household'],
    ]);
    assertTokenizedModel(saved.content_json, ['QuestionHeadline', 'Subheadline', 'IconCardAnswerGrid']);
    const frame = await fetchFrame(page.request, sc.funnelPublicId);
    expect(frame['template']).toBe('full-background');
  });
});

// ---------------------------------------------------------------------------
// §8.12 — the remaining browser flows, modernized to the v2.5.1 studio
// ---------------------------------------------------------------------------

test.describe('LeadGen Studio §8.12 — remaining flows (v2.5.1)', () => {
  test('create a Yes/No slide: "Yes / No" via the Answer fields palette group, labels via the Content tab', async ({ page }) => {
    test.setTimeout(120_000);
    await openNewStudio(page, `YesNo Slide ${uniq}`);

    // v3.1 §5.2: the "Answer choices" group merged into "Answer fields" (the
    // intent-first merge of the old Answer-choices + Inputs split) — the
    // "Yes / No" tile lives there under its operator label (type ids never
    // surface), keyed by data-name (§5.5), not a per-type data-add-component.
    const item = page.locator('[data-library-group="answer-fields"] [data-tile][data-name="yes no"]');
    await expect(item.locator('.studio-item-name')).toHaveText('Yes / No');
    await addComponent(page, 'TwoButtonYesNo');
    await setContentField(page, 'yesLabel', 'Yes, I am');
    await setContentField(page, 'noLabel', 'Not yet');
    await setInternalField(page, 'currently_insured');

    // the CANVAS re-renders via the REAL preset renderer (§8.4)
    const canvas = page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render');
    await expect(canvas.locator('.lg-yesno button[data-lg-choice="true"]')).toHaveText('Yes, I am');
    await expect(canvas.locator('.lg-yesno button[data-lg-choice="false"]')).toHaveText('Not yet');
    await page.screenshot({ path: `${SHOT_DIR}/flow-yesno-slide.png` });

    await saveStudio(page);
    const detail = await fetchSection(page.request, publicIdFromUrl(page));
    // the §5.2 bound headline/subheadline pair leads every UI-authored unit
    expect(detail.content_json.components.map((c) => c.type)).toEqual([
      'QuestionHeadline',
      'Subheadline',
      'TwoButtonYesNo',
    ]);
    const node = detail.content_json.components[2]!;
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
    // §5.3 mode-5: attached to a quote so the unit-mode sims keep hydrating
    await attachToQuote(page.request, `Dep Dropdown Quote ${uniq}`, [section.id], `${VERT}-seeded`);

    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: 'domcontentloaded' });
    await waitBootPreview(page);

    // author the §6.10 IF/THEN dependency through the visual builder ONLY —
    // selection is announced by the §7.1 scope header (operator label)
    await page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type="DropdownQuestion"]').click();
    await expect(page.locator('[data-scope-editing-name]')).toHaveText('Dropdown');
    await openInspectorTab(page, 'rules');
    // v3.1 §8.6: the condition fieldset is hidden behind "Always show" until
    // "+ Add a condition" reveals it (the golden's IF/THEN builder).
    await expect(page.locator('[data-rules-always-row]')).toBeVisible();
    await page.locator('[data-rules-add-condition]').click();
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
    // §5.3 mode-5: attached so unit-mode sims keep hydrating (see header)
    await attachToQuote(page.request, `Reveal Pin Quote ${uniq}`, [section.id], `${VERT}-seeded`);
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
    test.setTimeout(150_000);
    await openNewStudio(page, `ZIP Slide ${uniq}`);

    await addComponent(page, 'ZIPInputQuestion');
    await setContentField(page, 'placeholder', 'ZIP code');
    await openInspectorTab(page, 'content');
    await page.locator('[data-studio-panel="content"] input[data-inspector-field="required"]').check();
    await setInternalField(page, 'zip');

    await saveStudio(page);
    const publicId = publicIdFromUrl(page);
    const detail = await fetchSection(page.request, publicId);
    const zip = detail.content_json.components[2]!; // after the §5.2 bound pair
    expect(zip.type).toBe('ZIPInputQuestion');
    expect(zip.required).toBe(true);
    expect(zip.props).toMatchObject({ placeholder: 'ZIP code' });

    // §5.3 mode-5: attach + reload so the unit-mode sims keep hydrating
    await attachToQuote(page.request, `ZIP Quote ${uniq}`, [detail.id], VERT);
    await page.goto(`/admin/leadgen/sections/${publicId}/edit`, { waitUntil: 'domcontentloaded' });
    await waitBootPreview(page);

    // §9.2 error sim (required-but-empty): runtime-verbatim message
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

  test('personal-details slide: Name + Email + Phone via the "Contact" tile (§5.6: one tile, a 3-node Stack)', async ({ page }) => {
    test.setTimeout(120_000);
    await openNewStudio(page, `Personal Details ${uniq}`);

    // v3.1 §5.2/§5.6: the old separate "NameFieldsGroup"/"EmailInputQuestion"/
    // "PhoneInputQuestion" palette items merged into ONE "Contact" tile
    // (data-name="contact name email phone", Answer fields group) that
    // inserts all three as a Stack's children in one click (contract: "a
    // Stack of three nodes, each individually editable/deletable") — the
    // BEHAVIOR (author Name+Email+Phone) survives; the authoring path and
    // resulting model SHAPE (nested under one Stack, not 3 flat siblings)
    // both changed.
    const contactTile = page.locator('[data-library-group="answer-fields"] [data-tile][data-name="contact name email phone"]');
    await expect(contactTile.locator('.studio-item-name')).toHaveText('Contact');
    const canvasNodes = page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-component-type]');
    const before = await canvasNodes.count();
    await contactTile.click();
    // +4 canvas nodes: the Stack wrapper itself + its 3 children.
    await expect(canvasNodes).toHaveCount(before + 4, { timeout: 20_000 });
    await expect(page.locator('[data-scope-editing-name]')).toHaveText('Stack');

    const canvas = page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render');
    // select the Email child, then the Phone child, to author each field.
    await canvas.locator('input[inputmode="email"]').click();
    await setContentField(page, 'placeholder', 'you@example.com');
    await setInternalField(page, 'email');
    await canvas.locator('input[inputmode="tel"]').click();
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
    // §5.2 bound pair leads every UI-authored unit; the 3 Contact fields
    // nest under ONE Stack (the §5.6 "3-node Stack" insert), not 3 flat
    // top-level siblings.
    expect(detail.content_json.components.map((c) => c.type)).toEqual(['QuestionHeadline', 'Subheadline', 'Stack']);
    const contactStack = detail.content_json.components[2]!;
    expect((contactStack.children ?? []).map((c) => c.type)).toEqual([
      'NameFieldsGroup',
      'EmailInputQuestion',
      'PhoneInputQuestion',
    ]);
    expect((contactStack.children ?? []).map((c) => c.internal_field ?? null)).toEqual([null, 'email', 'phone']);
  });

  test('icon card grid: "Icon answer cards" choices with icons edited via the Choices tab', async ({ page }) => {
    test.setTimeout(120_000);
    await openNewStudio(page, `Icon Grid ${uniq}`);

    // v3.1 §5.2: "choices" merged into "answer-fields"; group-scoping the
    // locator picks the Answer-fields copy specifically (Suggested has its
    // OWN "cards" tile too — same data-add-component default, different
    // group). The TILE's own label is the generic "Cards" (contract §5.2) —
    // NOT the specific catalog-type label "Icon answer cards" (that's
    // STUDIO_TYPE_META's inspector-scope-header label, asserted below via
    // addComponent's TYPE_LABELS check instead).
    await expect(
      page.locator('[data-library-group="answer-fields"] [data-tile][data-name="cards"] .studio-item-name'),
    ).toHaveText('Cards');
    await addComponent(page, 'IconCardAnswerGrid');
    await openInspectorTab(page, 'content');
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
    const grid = detail.content_json.components[2]!; // after the §5.2 bound pair
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

    // v3.1 §5.6: the Slider tile's swap family is NumberRangeQuestion <->
    // CurrencyRangeQuestion ONLY (contract §5.2 table) — plain RangeQuestion
    // has no palette path anymore. The authoring BEHAVIOR fully survives via
    // NumberRangeQuestion: both share the IDENTICAL renderRange() renderer
    // (presets.ts renderRangeQuestion/renderNumberRangeQuestion both delegate
    // to renderRange(..., "number", ...)), so every render-side assertion
    // below is unaffected — only the stored TYPE STRING changes.
    await addComponent(page, 'NumberRangeQuestion');
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
    const range = detail.content_json.components[2]!; // after the §5.2 bound pair
    expect(range.type).toBe('NumberRangeQuestion');
    expect(range.internal_field).toBe('coverage_amount');
    expect(range.props).toMatchObject({ min: 10, max: 500, step: 5, minLabel: 'Low', maxLabel: 'High' });
  });

  test('main/Other values: choiceDisplay authored via the Choices tab; the preview shows main choices + the Other trigger', async ({ page }) => {
    test.setTimeout(120_000);
    await openNewStudio(page, `Main Other ${uniq}`);

    await addComponent(page, 'ButtonAnswerGroup');
    await openInspectorTab(page, 'content');
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
    const group = detail.content_json.components[2]!; // after the §5.2 bound pair
    expect(group.type).toBe('ButtonAnswerGroup');
    expect((group.choices ?? []).map((c) => c['value'])).toEqual(['toyota', 'honda', 'kia', 'tesla']);
    expect(group.choiceDisplay).toEqual({
      otherGroupEnabled: true,
      mainValues: ['toyota', 'honda'],
      otherGroupLabel: 'Other brands',
    });
  });

  test('choiceDisplay-only edit persists: toggling ONLY "Enable Other group" then saving must not lose the setting', async ({ page }) => {
    test.setTimeout(120_000);
    // The Choices tab owns main/Other grouping (B9 §6.4). An operator whose
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
    // §6.4: clicking a choice button focuses the CHOICE scope; the Component
    // pill lifts back to the component whose Choices tab carries the toggle.
    await page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render [data-lg-choice="toyota"]').click();
    await expect(page.locator('[data-scope-editing-name]')).toContainText('Answer choice');
    await page.locator('[data-scope-pill="component"]').first().click();
    await expect(page.locator('[data-scope-editing-name]')).toHaveText('Simple answer buttons');
    await openInspectorTab(page, 'content');
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
    // §5.3 mode-5: attached so unit-mode sims keep hydrating (see header)
    await attachToQuote(page.request, `Sim States Quote ${uniq}`, [section.id], `${VERT}-seeded`);

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
    // §5.3 mode-5: attached so the unit-mode viewport previews keep their
    // data-viewport/data-lg-ready markers (zero-usage Sections now compose
    // into the STATIC default frame — see the file header note)
    await attachToQuote(page.request, `Roundtrip Quote ${uniq}`, [section.id], `${VERT}-seeded`);

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

  test('§8.1/E6 studio layout hygiene: preview events must not stretch the studio past the viewport (regression guard — DEV-46 CSS containment)', async ({ page }) => {
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
    const canvas = page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render');
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
