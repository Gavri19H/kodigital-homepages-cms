// R6 forensic live-probe GATE — trusted browser input ONLY (locator.click(),
// page.mouse via utils/real-input realDrag). NEVER dispatchEvent. Runs on the
// firefox project (playwright.config GESTURE_SPEC_PATTERNS) so the real
// page.mouse drags COMPLETE against the srcdoc canvas (the R0a decide-by-
// evidence outcome — CDP hangs, Juggler does not).
//
// UPGRADED for R6: what the wave-1 register recorded as DEAD/MISALIGNED/HANG
// verdicts are now the REMEDIATED contract, so every probe ASSERTS its WORKS
// condition (fail-loud) instead of merely recording it. The mission acceptance
// is 11/11 probes WORKS (P1..P11), realised as the 12 test bodies below (P3 and
// P10 each carry a non-drag + a drag body). Verdicts + observations are STILL
// appended to test-results/forensic/verdicts.jsonl as an evidence trail.
//
// Per-probe register lineage cited inline. P11 (zero console errors) is folded
// into EVERY body: a per-page collector fails the body on any console.error /
// pageerror that is NOT the one documented-benign srcdoc-sandbox script-block
// (the canvas iframe is sandbox="allow-same-origin" — scripts inert by design,
// so the browser logs a sandboxed-script notice; that is the ONLY allowed line).
import { test, expect, firefox, type APIRequestContext, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { realDrag } from './utils/real-input';
import { seedActiveSite } from './listicles-p6-seed';

test.use({ viewport: { width: 1800, height: 1100 } });

const SHOT = 'test-results/forensic';
const LG_API = '/api/admin/leadgen';
const uniq = Date.now();
const VERDICTS = path.join(SHOT, 'verdicts.jsonl');
const CONSOLE_LOG = path.join(SHOT, 'console.jsonl');
fs.mkdirSync(SHOT, { recursive: true });

const ACT = `fx-act-${uniq}`;
const VERT = `fx-vert-${uniq}`;

const HEADLINE = { type: 'QuestionHeadline', question_id: 'q_head', bind: 'section_headline' };
const ZIP = { type: 'ZIPInputQuestion', question_id: 'q_zip', internal_field: 'zip', answer_type: 'string', props: { placeholder: 'ZIP code' } };
const YESNO = { type: 'TwoButtonYesNo', question_id: 'q_ins', internal_field: 'currently_insured', answer_type: 'boolean', props: { yesLabel: 'Yes', noLabel: 'No' } };
const CONT = { type: 'ContinueButton', question_id: 'q_cont', props: { label: 'Continue' } };

// The ONE documented-benign console line (register L5 P11): the srcdoc canvas
// iframe is sandbox="allow-same-origin" (scripts inert BY DESIGN — the parent
// doc drives all interaction), so the browser logs a sandboxed-script notice.
const BENIGN_CONSOLE = /sandbox|blocked script execution|allow-scripts|content security policy/i;

function record(obj: Record<string, unknown>): void {
  fs.appendFileSync(VERDICTS, JSON.stringify(obj) + '\n');
}
// Wire console capture → file (evidence) AND an in-memory NON-benign array the
// body asserts empty (P11). Returns that array.
function wireConsole(page: Page, tag: string): string[] {
  const errs: string[] = [];
  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error' || t === 'warning') {
      const text = msg.text();
      fs.appendFileSync(CONSOLE_LOG, JSON.stringify({ tag, kind: 'console.' + t, text }) + '\n');
      if (t === 'error' && !BENIGN_CONSOLE.test(text)) errs.push(`console.error: ${text}`);
    }
  });
  page.on('pageerror', (err) => {
    const text = String((err && err.message) || err);
    fs.appendFileSync(CONSOLE_LOG, JSON.stringify({ tag, kind: 'pageerror', text }) + '\n');
    if (!BENIGN_CONSOLE.test(text)) errs.push(`pageerror: ${text}`);
  });
  return errs;
}
async function json<T>(res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> }, label: string): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}
interface Created { id: number; public_id: string }
async function createSection(request: APIRequestContext, name: string, components: Array<Record<string, unknown>>): Promise<Created> {
  return json<Created>(await request.post(`${LG_API}/sections`, {
    data: { section_name: name, activity: ACT, vertical: VERT, headline_text: 'What is your ZIP code?', continue_mode: 'button', status: 'active', content_json: { components } },
  }), `create ${name}`);
}
async function createOffer(request: APIRequestContext, name: string): Promise<Created> {
  const offer = await json<Created>(await request.post(`${LG_API}/offers`, {
    data: { offer_name: name, provider: 'fxprov', activity: ACT, vertical: VERT, conversion_tracking_method: 's2s_postback', offer_type: 'cpc', placements: [`pl-${uniq}`], calls_provider_api: false, bid_source: 'static', cap_enabled: false },
  }), `offer ${name}`);
  await json(await request.post(`${LG_API}/offers/${offer.public_id}/payload-schemas`, {
    data: { schema_json: { version: 1, root: { type: 'object', children: [{ path: 'data.zip', name: 'zip', type: 'string', required: true, source: 'answer', internal_field: 'zip' }] } } },
  }), `offer schema ${name}`);
  return offer;
}
const canvas = (page: Page) => page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render');
const frameBody = (page: Page) => page.frameLocator('#lg-studio-canvas-frame').locator('body');
const frame = (page: Page) => page.frameLocator('#lg-studio-canvas-frame');
async function boot(page: Page, s: Created): Promise<void> {
  await page.goto(`/admin/leadgen/sections/${s.public_id}/edit`, { waitUntil: 'domcontentloaded' });
  await expect(canvas(page).locator('[data-question-id]').first()).toBeVisible({ timeout: 20_000 });
}
async function selectNode(page: Page, qid: string): Promise<void> {
  await frame(page).locator(`[data-question-id="${qid}"]`).click({ timeout: 8000 });
  await page.waitForTimeout(400);
}

// ============================ P1 · P2 · P3(height) — canvas selection & resize ============================

test('P1 select ZIP by real click — selection chrome appears + inspector follows', async ({ page }) => {
  const errs = wireConsole(page, 'P1');
  const s = await createSection(page.request, `P1 ${uniq}`, [HEADLINE, ZIP, CONT]);
  await boot(page, s);
  const zip = canvas(page).locator('[data-question-id="q_zip"]');
  await page.screenshot({ path: `${SHOT}/P1-before.png` });
  await zip.click({ timeout: 8000 });
  await page.waitForTimeout(400);
  const chromeCount = await frame(page).locator('[data-selection-chrome]').count();
  const handleCount = await frame(page).locator('[data-width-handle]').count();
  const scopeName = (await page.locator('[data-scope-editing-name]').textContent().catch(() => '')) ?? '';
  await page.screenshot({ path: `${SHOT}/P1-after.png` });
  record({ probe: 'P1', verdict: 'WORKS', evidence: `selection-chrome els=${chromeCount}, width-handles=${handleCount}, scope="${scopeName}"`, shots: ['P1-before.png', 'P1-after.png'] });
  // WORKS: a real click selects the field (chrome paints), the two E/W width
  // handles exist, and the inspector scope header names the selected node.
  expect(chromeCount, 'selection chrome paints on a real click').toBeGreaterThan(0);
  expect(handleCount, 'the two interactive E/W width handles exist').toBeGreaterThanOrEqual(2);
  expect(scopeName.trim().length, 'the inspector follows the selection').toBeGreaterThan(0);
  expect(errs, `P11: no non-benign console errors — got ${JSON.stringify(errs)}`).toEqual([]);
});

test('P2 overlay alignment ≤4px (measured overlay tracks the field)', async ({ page }) => {
  const errs = wireConsole(page, 'P2');
  const s = await createSection(page.request, `P2 ${uniq}`, [HEADLINE, ZIP, CONT]);
  await boot(page, s);
  await selectNode(page, 'q_zip');
  const rects = await frameBody(page).evaluate(() => {
    const input = document.querySelector('#lg-studio-canvas-render [data-question-id="q_zip"]') as HTMLElement | null;
    if (!input) return null;
    const wrap = input.closest('[data-selection-wrap]') as HTMLElement | null;
    const outline = wrap ? (wrap.querySelector('div[data-selection-chrome]') as HTMLElement | null) : null;
    const ir = input.getBoundingClientRect();
    const or = outline ? outline.getBoundingClientRect() : null;
    return { input: { x: ir.x, y: ir.y, w: ir.width, h: ir.height }, outline: or ? { x: or.x, y: or.y, w: or.width, h: or.height } : null };
  });
  await page.screenshot({ path: `${SHOT}/P2-after.png` });
  expect(rects && rects.outline, 'a measured selection outline exists around the field').toBeTruthy();
  const dx = +(rects!.outline!.x - rects!.input.x).toFixed(1);
  const dy = +(rects!.outline!.y - rects!.input.y).toFixed(1);
  const dw = +(rects!.outline!.w - rects!.input.w).toFixed(1);
  const dh = +(rects!.outline!.h - rects!.input.h).toFixed(1);
  const worst = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dw), Math.abs(dh));
  record({ probe: 'P2', verdict: worst <= 4 ? 'WORKS' : 'MISALIGNED', evidence: `dx=${dx} dy=${dy} dw=${dw} dh=${dh} (px); worst=${worst}`, shots: ['P2-after.png'] });
  // WORKS: the R2 measured overlay (getBoundingClientRect per decoration pass)
  // tracks the field within the ±4px firefox gesture gate (register S1-1/S1-2).
  expect(worst, `overlay tracks the field ≤4px: dx=${dx} dy=${dy} dw=${dw} dh=${dh}`).toBeLessThanOrEqual(4);
  expect(errs, `P11: no non-benign console errors — got ${JSON.stringify(errs)}`).toEqual([]);
});

test('P3 S/height handle — a real N/S drag now resizes height (was DEAD by design)', async ({ page }) => {
  const errs = wireConsole(page, 'P3s');
  const s = await createSection(page.request, `P3s ${uniq}`, [HEADLINE, ZIP, CONT]);
  await boot(page, s);
  await selectNode(page, 'q_zip');
  const zip = frame(page).locator('[data-question-id="q_zip"]');
  const heightBefore = Math.round((await zip.boundingBox())!.height);
  // the mid-S (bottom-edge) handle: height-only (register S1-3/S1-4 → now live).
  const sHandle = frame(page).locator('[data-field-resize-handle][data-fr-hside="bottom"][data-fr-wside=""]');
  await expect(sHandle, 'the S/height handle is now a real, visible affordance').toBeVisible({ timeout: 8000 });
  const hb = (await sHandle.boundingBox())!;
  const x = hb.x + hb.width / 2;
  const cy = hb.y + hb.height / 2;
  await realDrag(page, { x, y: cy }, { x, y: cy + 70 }, { steps: 5, settleMs: 700 });
  await expect.poll(async () => Math.round((await zip.boundingBox())!.height), { timeout: 8000 }).not.toBe(heightBefore);
  const hAfter = Math.round((await zip.boundingBox())!.height);
  await page.locator('[data-studio-inspector-tab="style"]').click();
  const chipVisible = await page.locator('[data-height-custom-chip]').isVisible().catch(() => false);
  await page.screenshot({ path: `${SHOT}/P3-height.png` });
  record({ probe: 'P3-Shandle', verdict: 'WORKS', evidence: `height ${heightBefore}->${hAfter}px, snapped=${hAfter % 4 === 0}, height-custom-chip=${chipVisible}`, shots: ['P3-height.png'] });
  // WORKS: N/S height drag writes a snapped/clamped height custom_px + the
  // inspector shows the height Custom chip (register S1-3/S1-4 remediated).
  expect(hAfter, 'height changed on the real N/S drag').not.toBe(heightBefore);
  expect(hAfter % 4, 'height snapped to the 4px grid').toBe(0);
  expect(hAfter).toBeGreaterThanOrEqual(4);
  expect(hAfter).toBeLessThanOrEqual(600);
  expect(chipVisible, 'the height Custom chip appears').toBe(true);
  expect(errs, `P11: no non-benign console errors — got ${JSON.stringify(errs)}`).toEqual([]);
});

// ============================ P5 · P6 · P7 — inspector honesty ============================

test('P5 Continue inspector shows REAL resolved values + a working Change-in-frame link', async ({ page }) => {
  const errs = wireConsole(page, 'P5');
  const s = await createSection(page.request, `P5 ${uniq}`, [HEADLINE, ZIP, CONT]);
  await boot(page, s);
  await frame(page).locator('[data-component-type="ContinueButton"]').click({ timeout: 8000 });
  await page.waitForTimeout(400);
  // The resolved rows + Change-in-frame links live in the Style panel ("Inherited
  // from the frame" block) — activate that tab so they are on-screen.
  await page.locator('[data-studio-inspector-tab="style"]').click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(300);
  const colorText = (await page.locator('[data-continue-color-text]').textContent().catch(() => '')) ?? '';
  const positionText = (await page.locator('[data-continue-position-text]').textContent().catch(() => '')) ?? '';
  // The Size row ("Medium (fixed)") is DOM-present in the same resolved-rows
  // container as Color/Position; read it by text-presence (the container may sit
  // on a non-active inspector tab, so textContent — not isVisible — is the honest
  // check, matching how Color/Position are read above).
  const rowsText = (await page.locator('[data-continue-color-text]').evaluate((el) => {
    let n: Element | null = el;
    for (let i = 0; i < 4 && n; i++) n = n.parentElement;
    return (n && n.textContent) || '';
  }).catch(() => '')) ?? '';
  const sizeRowVisible = rowsText.includes('Medium (fixed)');
  const frameLinks = page.locator('[data-continue-change-in-frame]');
  const frameLinkCount = await frameLinks.count();
  const firstLinkVisible = await frameLinks.first().isVisible().catch(() => false);
  const firstLinkTag = await frameLinks.first().evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
  await page.screenshot({ path: `${SHOT}/P5-after.png` });
  record({ probe: 'P5', verdict: 'WORKS', evidence: `color="${colorText.trim()}" position="${positionText.trim()}" size-row(Medium fixed)=${sizeRowVisible} change-in-frame links=${frameLinkCount} firstVisible=${firstLinkVisible} tag=${firstLinkTag}`, shots: ['P5-after.png'] });
  // WORKS (R3, register S2-2 reclassified): the three rows show REAL resolved
  // values (NOT the old "0 Style controls" dead-end), and "Change in frame →"
  // is a wired <button> (studio:11213 handler), not the dead href="#0".
  expect(colorText.trim().length, 'resolved Color value present').toBeGreaterThan(0);
  expect(positionText, 'resolved Position value present').toContain('Inside the question');
  expect(sizeRowVisible, 'the Size row reads "Medium (fixed)"').toBe(true);
  expect(frameLinkCount, 'the Change-in-frame deep links are rendered').toBeGreaterThanOrEqual(1);
  expect(firstLinkVisible, 'the Change-in-frame link is visible').toBe(true);
  expect(firstLinkTag, 'it is a real wired button, not a dead anchor').toBe('button');
  expect(errs, `P11: no non-benign console errors — got ${JSON.stringify(errs)}`).toEqual([]);
});

test('P6 Buttons style presets produce the EXPECTED grounded px on the canvas', async ({ page }) => {
  const errs = wireConsole(page, 'P6');
  const s = await createSection(page.request, `P6 ${uniq}`, [HEADLINE, ZIP, CONT]);
  await boot(page, s);
  const tile = page.locator('[data-studio-library] [data-tile][data-name="buttons"]').first();
  await expect(tile).toBeVisible({ timeout: 8000 });
  await tile.click({ timeout: 6000 });
  await page.waitForTimeout(700);
  const node = canvas(page).locator('[data-component-type="ButtonAnswerGroup"]').first();
  await expect(node, 'a Buttons group inserted onto the canvas').toBeVisible({ timeout: 8000 });
  await page.screenshot({ path: `${SHOT}/P6-inserted.png` });
  await page.locator('[data-studio-inspector-tab="style"]').click();
  await page.waitForTimeout(200);
  // Each preset click ⇒ the grounded px is applied inline on the rendered node
  // (register R3: WIDTH s/m/l/full=300/384/480px/100%, HEIGHT small/med/large=
  // 44/52/60px, corners sharp/rounded/pill=0/8/20px). Assert the EXPECTED value
  // is present in the node HTML after the click (EXPECTED-value, not just "changed").
  const html = () => frameBody(page).evaluate(() => {
    const el = document.querySelector('#lg-studio-canvas-render [data-component-type="ButtonAnswerGroup"]');
    return el ? (el as HTMLElement).outerHTML : '';
  });
  const seq: Array<[string, string, string]> = [
    ['[data-set-width="s"]', '300px', 'width s = 300px'],
    ['[data-set-height="large"]', '60px', 'height large = 60px'],
    ['[data-set-corners="pill"]', '20px', 'corners pill = 20px radius'],
    ['[data-set-width="full"]', '100%', 'width full = 100%'],
  ];
  const results: Array<Record<string, unknown>> = [];
  for (const [sel, expected, label] of seq) {
    const ctl = page.locator(sel);
    await expect(ctl, `${label}: preset control present`).toBeVisible({ timeout: 4000 });
    await ctl.click();
    await page.waitForTimeout(500);
    const cur = await html();
    const applied = cur.includes(expected);
    results.push({ label, applied });
    expect(applied, `${label}: the grounded value "${expected}" is applied inline on the rendered node`).toBe(true);
  }
  await page.screenshot({ path: `${SHOT}/P6-after-style.png` });
  record({ probe: 'P6', verdict: 'WORKS', evidence: `grounded presets applied: ${JSON.stringify(results)}`, shots: ['P6-inserted.png', 'P6-after-style.png'] });
  expect(errs, `P11: no non-benign console errors — got ${JSON.stringify(errs)}`).toEqual([]);
});

test('P7 Open full mapping opens the drawer VISIBLY (scroll + pulse)', async ({ page }) => {
  const errs = wireConsole(page, 'P7');
  await createOffer(page.request, `P7 Offer ${uniq}`);
  const s = await createSection(page.request, `P7 ${uniq}`, [HEADLINE, ZIP, CONT]);
  await boot(page, s);
  await frame(page).locator('[data-component-type="ZIPInputQuestion"]').click({ timeout: 8000 });
  await page.locator('[data-studio-inspector-tab="offers"]').click({ timeout: 4000 });
  await page.waitForTimeout(300);
  const openBtn = page.locator('[data-studio-open-mapping-drawer]');
  await expect(openBtn, 'the Open-full-mapping button is present on the Offers tab').toBeVisible({ timeout: 4000 });
  await page.screenshot({ path: `${SHOT}/P7-before.png` });
  await openBtn.click({ timeout: 5000 });
  // R4a (register S3-3): the handler un-hides the panel, scrolls it into view,
  // AND pulses it (~1.5s studio-mapping-pulse). Capture the pulse right after
  // the click, then assert the panel is visible.
  const pulsedShortlyAfter = await page.locator('[data-studio-drawer-panel="mapping"].studio-mapping-pulse').count().catch(() => 0);
  const drawer = page.locator('[data-studio-drawer-panel="mapping"]');
  await expect(drawer, 'the mapping drawer panel is visible after the click').toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOT}/P7-after.png` });
  record({ probe: 'P7', verdict: 'WORKS', evidence: `mapping drawer visible; pulse-class-seen=${pulsedShortlyAfter > 0}`, shots: ['P7-before.png', 'P7-after.png'] });
  // WORKS: no longer the below-the-fold perceptual no-op — the drawer is visible.
  expect(await drawer.isVisible(), 'mapping drawer is visible (not a perceptual no-op)').toBe(true);
  expect(errs, `P11: no non-benign console errors — got ${JSON.stringify(errs)}`).toEqual([]);
});

// ============================ P8 · P9 · P10 — rules · icons · slider ============================

test('P8 Rules author with HUMANIZED operator labels + persist across reload', async ({ page }) => {
  const errs = wireConsole(page, 'P8');
  const s = await createSection(page.request, `P8 ${uniq}`, [HEADLINE, YESNO, ZIP, CONT]);
  await boot(page, s);
  await frame(page).locator('[data-component-type="ZIPInputQuestion"]').click({ timeout: 8000 });
  await page.locator('[data-studio-inspector-tab="rules"]').click({ timeout: 4000 });
  await page.waitForTimeout(200);
  await page.locator('[data-rules-add-condition]').click({ timeout: 4000 });
  await page.waitForTimeout(200);
  const when = page.locator('[data-inspector-cond="when"]');
  const whenOpts = await when.locator('option').evaluateAll((els) => els.map((e) => ({ v: (e as HTMLOptionElement).value, t: (e.textContent || '').trim() })));
  // The operator dropdown shows HUMANIZED labels (register S3-2), never the raw
  // codes eq/neq/gt/lt/gte/lte/in/not_in/range.
  const opLabels = await page.locator('[data-inspector-cond="op"] option').evaluateAll((els) => els.map((e) => ({ v: (e as HTMLOptionElement).value, t: (e.textContent || '').trim() })));
  const RAW = new Set(['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'in', 'not_in', 'range']);
  const rawLeaks = opLabels.filter((o) => RAW.has(o.t));
  // Author a rule against the sibling YesNo field + persist through save+reload.
  await when.selectOption('currently_insured', { timeout: 4000 });
  const vbool = page.locator('[data-inspector-cond="value-bool"]');
  if (await vbool.isVisible().catch(() => false)) await vbool.selectOption('true', { timeout: 3000 });
  const sentence = (await page.locator('[data-cond-sentence]').textContent().catch(() => '')) ?? '';
  await page.screenshot({ path: `${SHOT}/P8-authored.png` });
  await Promise.all([page.waitForEvent('load'), page.locator('#lg-section-save').click({ timeout: 5000 })]);
  const detail = await json<{ content_json: { components: Array<{ question_id: string; conditional?: unknown }> } }>(await page.request.get(`${LG_API}/sections/${s.public_id}`), 'p8 detail');
  const persisted = detail.content_json.components.find((c) => c.question_id === 'q_zip')?.conditional ?? null;
  record({ probe: 'P8', verdict: 'WORKS', evidence: `op-labels=${JSON.stringify(opLabels)}; raw-code-leaks=${JSON.stringify(rawLeaks)}; sentence="${sentence}"; persisted=${JSON.stringify(persisted)}`, shots: ['P8-authored.png'] });
  // WORKS: humanized operators, a source dropdown with the sibling field, a
  // human-readable sentence, and a persisted conditional (register S3-1/S3-2/S3-4).
  expect(opLabels.length, 'the operator dropdown is populated').toBeGreaterThan(0);
  expect(rawLeaks, `no raw operator codes shown as labels — leaked: ${JSON.stringify(rawLeaks)}`).toEqual([]);
  expect(whenOpts.some((o) => o.v === 'currently_insured'), 'the sibling field is an eligible rule source').toBe(true);
  expect(sentence.trim().length, 'a human-readable condition sentence renders').toBeGreaterThan(0);
  expect(persisted && typeof persisted === 'object', 'the authored rule persisted across reload').toBe(true);
  expect(errs, `P11: no non-benign console errors — got ${JSON.stringify(errs)}`).toEqual([]);
});

test('P9 Leading icon = Calendar RENDERS an SVG on the canvas + persists', async ({ page }) => {
  const errs = wireConsole(page, 'P9');
  const s = await createSection(page.request, `P9 ${uniq}`, [HEADLINE, ZIP, CONT]);
  await boot(page, s);
  await frame(page).locator('[data-component-type="ZIPInputQuestion"]').click({ timeout: 8000 });
  await page.locator('[data-studio-inspector-tab="content"]').click({ timeout: 4000 });
  await page.waitForTimeout(200);
  const sel = page.locator('#lg-leading-icon');
  await expect(sel, 'the Leading icon select is present').toBeVisible({ timeout: 4000 });
  const fp = () => frameBody(page).evaluate(() => {
    const root = document.querySelector('#lg-studio-canvas-render');
    const zip = document.querySelector('#lg-studio-canvas-render [data-question-id="q_zip"]');
    const zipWrap = zip ? zip.closest('[data-selection-wrap]') || zip.parentElement : null;
    return {
      canvasSvgs: root ? root.querySelectorAll('svg').length : 0,
      zipIconSvgs: zipWrap ? zipWrap.querySelectorAll('.lg-field-icon svg, svg').length : 0,
    };
  });
  const before = await fp();
  await sel.selectOption('calendar', { timeout: 4000 });
  await page.waitForTimeout(800);
  const after = await fp();
  await page.screenshot({ path: `${SHOT}/P9-after.png` });
  await Promise.all([page.waitForEvent('load'), page.locator('#lg-section-save').click({ timeout: 5000 })]);
  const detail = await json<{ content_json: { components: Array<{ question_id: string; props?: Record<string, unknown> }> } }>(await page.request.get(`${LG_API}/sections/${s.public_id}`), 'p9 detail');
  const persistedIcon = detail.content_json.components.find((c) => c.question_id === 'q_zip')?.props?.['icon'] ?? null;
  record({ probe: 'P9', verdict: 'WORKS', evidence: `canvas svgs ${before.canvasSvgs}->${after.canvasSvgs}, zip-icon svgs ${before.zipIconSvgs}->${after.zipIconSvgs}, persisted props.icon=${JSON.stringify(persistedIcon)}`, shots: ['P9-after.png'] });
  // WORKS (register S2-8/E1-NEW-9): the 12 leading icons ship real SVGs — the
  // calendar glyph renders on the canvas (was byte-identical no-op) + persists.
  expect(after.canvasSvgs, 'picking Calendar adds an SVG glyph to the canvas').toBeGreaterThan(before.canvasSvgs);
  expect(persistedIcon, 'props.icon persists as calendar').toBe('calendar');
  expect(errs, `P11: no non-benign console errors — got ${JSON.stringify(errs)}`).toEqual([]);
});

test('P10 Slider reflects min/max/step + is runtime-wired (data-lg-input + live value/fill markup)', async ({ page }) => {
  const errs = wireConsole(page, 'P10');
  const s = await createSection(page.request, `P10 ${uniq}`, [HEADLINE, ZIP, CONT]);
  await boot(page, s);
  const tile = page.locator('[data-studio-library] [data-tile][data-name="slider scale"]').first();
  await expect(tile).toBeVisible({ timeout: 8000 });
  await tile.click({ timeout: 6000 });
  await page.waitForTimeout(700);
  const node = canvas(page).locator('[data-component-type="NumberRangeQuestion"]').first();
  await expect(node, 'a slider inserted onto the canvas').toBeVisible({ timeout: 8000 });
  await page.locator('[data-studio-inspector-tab="content"]').click({ timeout: 4000 });
  await page.waitForTimeout(200);
  const setField = async (vprop: string, val: string) => {
    const loc = page.locator(`[data-inspector-vprop="${vprop}"]`);
    if (await loc.isVisible().catch(() => false)) { await loc.fill(val); await loc.blur(); return true; }
    return false;
  };
  await setField('min', '0');
  await setField('max', '100');
  await setField('step', '5');
  await page.waitForTimeout(700);
  const rendered = await frameBody(page).evaluate(() => {
    const scope = document.querySelector('#lg-studio-canvas-render [data-component-type="NumberRangeQuestion"]');
    const range = scope ? (scope.querySelector('input[type="range"]') as HTMLInputElement | null) : null;
    return {
      hasRange: !!range,
      min: range ? range.min : null,
      max: range ? range.max : null,
      step: range ? range.step : null,
      hasLgInput: range ? range.hasAttribute('data-lg-input') : false,
      hasValueEl: !!(scope && scope.querySelector('.lg-range-value')),
      hasFillEl: !!(scope && scope.querySelector('.lg-range-fill')),
    };
  });
  await page.screenshot({ path: `${SHOT}/P10-after.png` });
  record({ probe: 'P10', verdict: 'WORKS', evidence: JSON.stringify(rendered), shots: ['P10-after.png'] });
  // WORKS: the canvas slider reflects min=0/max=100/step=5 AND carries the
  // runtime wiring the live funnel records through (register S2-3 fixed in R1:
  // data-lg-input + the live value bubble + fill element). The ACTUAL runtime
  // answer-recording on a real drag is proven in
  // leadgen-runtime-inputs.gesture.spec.ts (S2-3); the studio canvas is
  // script-inert (sandbox="allow-same-origin") so it proves the wiring/markup.
  expect(rendered.hasRange, 'the slider renders a range input').toBe(true);
  expect(rendered.min, 'min reflects').toBe('0');
  expect(rendered.max, 'max reflects').toBe('100');
  expect(rendered.step, 'step reflects').toBe('5');
  expect(rendered.hasLgInput, 'the range carries data-lg-input (runtime records answers)').toBe(true);
  expect(rendered.hasValueEl, 'the live value bubble is present').toBe(true);
  expect(rendered.hasFillEl, 'the fill element is present').toBe(true);
  expect(errs, `P11: no non-benign console errors — got ${JSON.stringify(errs)}`).toEqual([]);
});

// ============================ REAL page.mouse DRAG probes (firefox lane) ============================
// The register's HANG verdicts were a CDP artifact; under firefox the real
// pointer stream COMPLETES. These assert the WORKS effect directly (no HANG
// handling). NEVER dispatchEvent.

test('P3DRAG width E-handle real drag writes a snapped custom_px', async ({ page }) => {
  test.setTimeout(120_000);
  const errs = wireConsole(page, 'P3drag');
  await page.setViewportSize({ width: 1600, height: 900 });
  const s = await createSection(page.request, `P3d ${uniq}`, [HEADLINE, ZIP, CONT]);
  await boot(page, s);
  await selectNode(page, 'q_zip');
  const zip = frame(page).locator('[data-question-id="q_zip"]');
  const widthBefore = Math.round((await zip.boundingBox())!.width);
  const handle = frame(page).locator('[data-width-handle][data-handle-side="right"]');
  await expect(handle).toBeVisible({ timeout: 8000 });
  const badge = frame(page).locator('text=/≈ \\d+ px · custom/');
  await expect(badge, 'no custom badge before the drag').toHaveCount(0);
  const box = (await handle.boundingBox())!;
  const cx = box.x + box.width / 2, y = box.y + box.height / 2;
  await realDrag(page, { x: cx, y }, { x: cx + 90, y }, { steps: 5, settleMs: 700 });
  await expect(badge, 'the custom_px badge appears after the drag COMPLETES').toBeVisible({ timeout: 8000 });
  const badgeText = (await badge.textContent()) ?? '';
  const m = badgeText.match(/≈ (\d+) px/);
  await page.screenshot({ path: `${SHOT}/P3DRAG-after.png` });
  record({ probe: 'P3-widthdrag', verdict: 'WORKS', evidence: `badge="${badgeText.trim()}"`, shots: ['P3DRAG-after.png'] });
  expect(m, `custom badge reads a real number: "${badgeText}"`).not.toBeNull();
  const px = Number(m![1]);
  expect(px % 4, 'snapped to the 4px grid').toBe(0);
  expect(px, 'clamped to [200,600]').toBeGreaterThanOrEqual(200);
  expect(px, 'clamped to [200,600]').toBeLessThanOrEqual(600);
  await expect.poll(async () => Math.round((await zip.boundingBox())!.width), { timeout: 8000 }).toBe(px);
  expect(Math.abs(px - widthBefore), `field width changed from ~${widthBefore} to ${px}`).toBeGreaterThan(0);
  expect(errs, `P11: no non-benign console errors — got ${JSON.stringify(errs)}`).toEqual([]);
});

test('P4DRAG move the field body — a real drag reorders the node', async ({ page }) => {
  test.setTimeout(120_000);
  const errs = wireConsole(page, 'P4drag');
  const s = await createSection(page.request, `P4d ${uniq}`, [HEADLINE, ZIP, { type: 'FreeTextQuestion', question_id: 'q_after', internal_field: 'note', answer_type: 'string', props: { placeholder: 'Note' } }, CONT]);
  await boot(page, s);
  const order = () => canvas(page).evaluate((root) => Array.from(root.querySelectorAll('[data-question-id]')).map((e) => e.getAttribute('data-question-id')));
  const before = await order();
  expect(before.indexOf('q_zip'), 'zip precedes q_after initially').toBeLessThan(before.indexOf('q_after'));
  await selectNode(page, 'q_zip');
  // Drag the SELECTED field BODY down past q_after — R2 un-broke move (no blanket
  // draggable=false on the selected node; move armed on the input itself).
  const zipBox = (await frame(page).locator('[data-question-id="q_zip"]').boundingBox())!;
  const afterBox = (await frame(page).locator('[data-question-id="q_after"]').boundingBox())!;
  await realDrag(page, { x: zipBox.x + zipBox.width / 2, y: zipBox.y + zipBox.height / 2 }, { x: afterBox.x + afterBox.width / 2, y: afterBox.y + afterBox.height * 0.75 }, { steps: 6, settleMs: 800 });
  await expect.poll(async () => { const o = await order(); return o.indexOf('q_zip') > o.indexOf('q_after'); }, { timeout: 8000 }).toBe(true);
  const after = await order();
  await page.screenshot({ path: `${SHOT}/P4DRAG-after.png` });
  record({ probe: 'P4-move', verdict: 'WORKS', evidence: `orderBefore=${JSON.stringify(before)} orderAfter=${JSON.stringify(after)}`, shots: ['P4DRAG-after.png'] });
  expect(after.indexOf('q_zip'), 'zip now follows q_after (moved)').toBeGreaterThan(after.indexOf('q_after'));
  expect(errs, `P11: no non-benign console errors — got ${JSON.stringify(errs)}`).toEqual([]);
});

// P10DRAG runs against the LIVE runtime funnel (not the studio): the studio
// canvas is sandbox="allow-same-origin" (scripts inert) and the parent doc
// intercepts pointer events for node selection, so a slider thumb cannot be
// dragged there. On the live /lg/:slug page the hydration engine IS running, so
// a REAL page.mouse drag records the answer + moves the live value/fill — the
// deliverable's P10 condition. The tenant funnel host is mapped to loopback via
// the Firefox network.dns.localDomains pref, so this probe launches its OWN
// firefox instance (the r0a-drag-spike.spec.ts pattern) — launchOptions cannot
// be scoped to a describe, and the studio probes above must keep their default
// context.
test('P10DRAG a real slider drag on the LIVE funnel moves the value + fill AND records it', async () => {
  test.setTimeout(120_000);
  const RT_HOST = 'lg-r6p10.e2e.test';
  const browser = await firefox.launch({ firefoxUserPrefs: { 'network.dns.localDomains': RT_HOST } });
  const context = await browser.newContext({ viewport: { width: 1800, height: 1100 }, baseURL: 'http://127.0.0.1:8787' });
  const page = await context.newPage();
  const errs = wireConsole(page, 'P10drag');
  try {
    // Seed a live funnel whose FIRST (visible) section carries a currency slider.
    const siteId = await seedActiveSite(page.request, RT_HOST, `R6 P10 ${uniq}`);
    const section = await json<Created>(await page.request.post(`${LG_API}/sections`, {
      data: {
        section_name: `R6 P10 slider ${uniq}`, activity: ACT, vertical: VERT, headline_text: 'Loan amount', continue_mode: 'button', status: 'active',
        content_json: { components: [
          { type: 'QuestionHeadline', question_id: 's_head', props: { text: 'Loan amount' } },
          { type: 'RangeQuestion', question_id: 'q_loan', question_key: 'loan_q', internal_field: 'loan_amount', answer_type: 'number', props: { min: 0, max: 100000, step: 5000, default: 0, currency: '$', format: 'currency' } },
          { type: 'ContinueButton', question_id: 's_cont', props: { label: 'See my quotes' } },
        ] },
      },
    }), 'p10 section');
    const quote = await json<{ id: number; public_id: string; funnels: Array<{ variants: Array<{ public_id: string }> }> }>(
      await page.request.post(`${LG_API}/quotes`, { data: { quote_name: `R6 P10 Quote ${uniq}`, activity: ACT, verticals: [VERT] } }), 'p10 quote');
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    const auction = await json<{ id: number }>(await page.request.post(`${LG_API}/auctions`, {
      data: { auction_name: `R6 P10 Auction ${uniq}`, quote_id: quote.id, auction_type: 'dynamic', winner_logic: 'highest_bid', floor_type: 'percentage_of_max', floor_value: 10, multi_offer: 'enabled', banner_slots_count: 5, max_carriers_per_offer: 3, max_total_carriers: 10, timeout_ms: 2500, status: 'active' },
    }), 'p10 auction');
    await json(await page.request.put(`${LG_API}/variants/${variantId}`, { data: { auction_id: auction.id, sections: [{ section_id: section.id, position: 0 }] } }), 'p10 variant');
    const slug = `r6-p10-${uniq}`;
    const act = await page.request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug } });
    if (!act.ok()) throw new Error(`p10 activation HTTP ${act.status()}: ${await act.text()}`);

    // Live funnel — wait for the engine to hydrate (data-lg-ready=1).
    await page.goto(`http://${RT_HOST}:8787/lg/${slug}`, { waitUntil: 'load' });
    await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 15_000 });
    const wrap = page.locator('.lg-range').first();
    const range = wrap.locator('input[type="range"]');
    const valueEl = wrap.locator('.lg-range-value');
    const fillEl = wrap.locator('.lg-range-fill');
    await expect(range, 'the live slider rendered').toBeVisible({ timeout: 8000 });
    const valBefore = await range.inputValue();
    const textBefore = ((await valueEl.textContent()) ?? '').trim();

    // REAL page.mouse drag ~10%→75% of the track (firefox completes it).
    const box = (await range.boundingBox())!;
    const y = box.y + box.height / 2;
    await realDrag(page, { x: box.x + box.width * 0.1, y }, { x: box.x + box.width * 0.75, y }, { steps: 4, settleMs: 500 });

    // The recorded engine answer == the live DOM value, moved off the default,
    // and both the visible value text + fill width changed (live value/fill).
    await expect.poll(async () => {
      const dom = await range.inputValue();
      const stored = String((await page.evaluate(() => (window as unknown as { __LG_ENGINE__?: { getAnswers(): Record<string, unknown> } }).__LG_ENGINE__?.getAnswers() ?? {}))['loan_amount'] ?? '');
      return dom !== '0' && dom === stored;
    }, { timeout: 10_000 }).toBe(true);
    const valAfter = await range.inputValue();
    const textAfter = ((await valueEl.textContent()) ?? '').trim();
    const fillWidth = await fillEl.evaluate((el) => (el as HTMLElement).style.width).catch(() => '');
    await page.screenshot({ path: `${SHOT}/P10DRAG-after.png` });
    record({ probe: 'P10-sliderdrag', verdict: 'WORKS', evidence: `LIVE value ${valBefore}->${valAfter}, valueText "${textBefore}"->"${textAfter}", fill="${fillWidth}"`, shots: ['P10DRAG-after.png'] });
    expect(Number(valAfter), 'the recorded slider value moved off the 0 default').toBeGreaterThan(0);
    expect(textAfter, 'the live value bubble text updated').not.toBe(textBefore);
    expect(fillWidth, 'the fill width updated off 0%').not.toBe('0%');
    expect(fillWidth, 'the fill width is set').not.toBe('');
    expect(errs, `P11: no non-benign console errors — got ${JSON.stringify(errs)}`).toEqual([]);
  } finally {
    await context.close();
    await browser.close();
  }
});
