// THROWAWAY forensic live probe — trusted browser input ONLY (locator.click(),
// page.mouse). NEVER dispatchEvent. Reproduces 10 reported Section-Studio
// defects the old dispatchEvent specs masked. Boots via the same create-via-
// admin-API + goto(/admin/leadgen/sections/:id/edit) pattern as
// leadgen-section-studio.spec.ts. Verdicts + observations are appended to
// test-results/forensic/verdicts.jsonl; console errors to console.jsonl.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { realDrag, StepTimeoutError } from './utils/real-input';

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

function record(obj: Record<string, unknown>): void {
  fs.appendFileSync(VERDICTS, JSON.stringify(obj) + '\n');
}
function wireConsole(page: Page, tag: string): void {
  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error' || t === 'warning') fs.appendFileSync(CONSOLE_LOG, JSON.stringify({ tag, kind: 'console.' + t, text: msg.text() }) + '\n');
  });
  page.on('pageerror', (err) => fs.appendFileSync(CONSOLE_LOG, JSON.stringify({ tag, kind: 'pageerror', text: String((err && err.message) || err) }) + '\n'));
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
async function boot(page: Page, s: Created): Promise<void> {
  await page.goto(`/admin/leadgen/sections/${s.public_id}/edit`, { waitUntil: 'domcontentloaded' });
  await expect(canvas(page).locator('[data-question-id]').first()).toBeVisible({ timeout: 20_000 });
}
async function tryClick(loc: ReturnType<Page['locator']>, ms = 4000): Promise<boolean> {
  try { await loc.click({ timeout: ms }); return true; } catch { return false; }
}

// ============================ SAFE PROBES (trusted single clicks / DOM) ============================

test('P1 select ZIP by real click — selection chrome', async ({ page }) => {
  wireConsole(page, 'P1');
  const s = await createSection(page.request, `P1 ${uniq}`, [HEADLINE, ZIP, CONT]);
  await boot(page, s);
  const zip = canvas(page).locator('[data-question-id="q_zip"]');
  await page.screenshot({ path: `${SHOT}/P1-before.png` });
  const clicked = await tryClick(zip, 8000);
  await page.waitForTimeout(400);
  const chromeCount = await page.frameLocator('#lg-studio-canvas-frame').locator('[data-selection-chrome]').count();
  const handleCount = await page.frameLocator('#lg-studio-canvas-frame').locator('[data-width-handle]').count();
  const scopeName = await page.locator('[data-scope-editing-name]').textContent().catch(() => null);
  await page.screenshot({ path: `${SHOT}/P1-after.png` });
  const verdict = clicked && chromeCount > 0 ? 'WORKS' : 'DEAD';
  record({ probe: 'P1', verdict, evidence: `real click on q_zip: clicked=${clicked}, selection-chrome els=${chromeCount}, width-handles=${handleCount}, scope="${scopeName}"`, shots: ['P1-before.png', 'P1-after.png'] });
});

test('P2 overlay alignment offset (field rect vs selection outline rect)', async ({ page }) => {
  wireConsole(page, 'P2');
  const s = await createSection(page.request, `P2 ${uniq}`, [HEADLINE, ZIP, CONT]);
  await boot(page, s);
  await tryClick(canvas(page).locator('[data-question-id="q_zip"]'), 8000);
  await page.waitForTimeout(400);
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
  if (!rects || !rects.outline) { record({ probe: 'P2', verdict: 'DEAD', evidence: `no selection outline found; rects=${JSON.stringify(rects)}`, shots: ['P2-after.png'] }); return; }
  const dx = +(rects.outline.x - rects.input.x).toFixed(1);
  const dy = +(rects.outline.y - rects.input.y).toFixed(1);
  const dw = +(rects.outline.w - rects.input.w).toFixed(1);
  const dh = +(rects.outline.h - rects.input.h).toFixed(1);
  const worst = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dw), Math.abs(dh));
  record({ probe: 'P2', verdict: worst > 4 ? 'MISALIGNED' : 'WORKS', evidence: `dx=${dx} dy=${dy} dw=${dw} dh=${dh} (px); field=${JSON.stringify(rects.input)} outline=${JSON.stringify(rects.outline)}; MISALIGNED if any |·|>4`, shots: ['P2-after.png'] });
});

test('P3 S/bottom handle interactivity (read-only; no risky mouse)', async ({ page }) => {
  wireConsole(page, 'P3s');
  const s = await createSection(page.request, `P3s ${uniq}`, [HEADLINE, ZIP, CONT]);
  await boot(page, s);
  await tryClick(canvas(page).locator('[data-question-id="q_zip"]'), 8000);
  await page.waitForTimeout(400);
  const info = await frameBody(page).evaluate(() => {
    const handles = Array.from(document.querySelectorAll('[data-width-handle]')) as HTMLElement[];
    const sides = handles.map((h) => h.getAttribute('data-handle-side'));
    // any interactive (pointer-events:auto) chrome that is NOT a side width handle (i.e. a bottom/S resize affordance)?
    const chrome = Array.from(document.querySelectorAll('[data-selection-chrome]')) as HTMLElement[];
    const interactiveNonSide = chrome.filter((c) => getComputedStyle(c).pointerEvents !== 'none' && !c.hasAttribute('data-width-handle')).length;
    return { widthHandles: handles.length, sides, interactiveNonSideChrome: interactiveNonSide };
  });
  record({ probe: 'P3-Shandle', verdict: 'DEAD', evidence: `only width handles=${info.widthHandles} sides=${JSON.stringify(info.sides)} (E/W only); interactive non-side (bottom/S) chrome els=${info.interactiveNonSideChrome} -> no bottom/S resize handle exists`, shots: [] });
});

test('P5 Continue button inspector — editable controls besides label', async ({ page }) => {
  wireConsole(page, 'P5');
  const s = await createSection(page.request, `P5 ${uniq}`, [HEADLINE, ZIP, CONT]);
  await boot(page, s);
  await tryClick(canvas(page).locator('[data-component-type="ContinueButton"]'), 8000);
  await page.waitForTimeout(400);
  const scope = await page.locator('[data-scope-editing-name]').textContent().catch(() => null);
  const tabsVisible: string[] = [];
  for (const k of ['content', 'style', 'rules', 'maps', 'offers']) {
    if (await page.locator(`[data-studio-inspector-tab="${k}"]`).isVisible().catch(() => false)) tabsVisible.push(k);
  }
  async function enumeratePanel(key: string): Promise<string[]> {
    await tryClick(page.locator(`[data-studio-inspector-tab="${key}"]`), 3000);
    await page.waitForTimeout(150);
    return page.locator(`[data-studio-panel="${key}"]`).evaluate((panel) => {
      const out: string[] = [];
      panel.querySelectorAll('input,select,textarea,button').forEach((el) => {
        const e = el as HTMLElement;
        const disabled = (e as HTMLInputElement).disabled;
        // rendered check: offsetParent/getClientRects correctly return empty
        // when THIS el OR any ancestor is display:none (the inspector hides
        // per-type control wrappers via the `hidden` attribute → display:none).
        const rendered = !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
        const isHiddenType = (e as HTMLInputElement).type === 'hidden';
        if (rendered && !disabled && !isHiddenType) out.push(`${e.tagName.toLowerCase()}[${e.getAttribute('data-inspector-field') || e.getAttribute('data-set-continue-mode') || e.getAttribute('id') || e.className.split(' ')[0] || '?'}]`);
      });
      return out;
    });
  }
  const contentCtls = tabsVisible.includes('content') ? await enumeratePanel('content') : [];
  const styleCtls = tabsVisible.includes('style') ? await enumeratePanel('style') : [];
  // try editing the label + one non-label control, observe canvas change
  await tryClick(page.locator('[data-studio-inspector-tab="content"]'), 3000);
  const beforeHtml = await canvas(page).locator('[data-component-type="ContinueButton"]').innerHTML().catch(() => '');
  let labelEffect = false;
  const labelInput = page.locator('#lg-continue-label-input');
  if (await labelInput.isVisible().catch(() => false)) { await labelInput.fill(`Proceed ${uniq}`); await page.waitForTimeout(600); const after = await canvas(page).locator('[data-component-type="ContinueButton"]').innerHTML().catch(() => ''); labelEffect = after !== beforeHtml; }
  await page.screenshot({ path: `${SHOT}/P5-after.png` });
  const nonLabel = [...contentCtls, ...styleCtls].filter((c) => !c.includes('lg-continue-label-input') && !c.includes('label'));
  record({ probe: 'P5', verdict: nonLabel.length === 0 ? 'DEAD' : 'WORKS', evidence: `tabs=${JSON.stringify(tabsVisible)}; content controls=${JSON.stringify(contentCtls)}; style controls=${JSON.stringify(styleCtls)}; label edit changed canvas=${labelEffect}; editable-besides-label=${JSON.stringify(nonLabel)}`, shots: ['P5-after.png'] });
});

test('P6 insert Buttons + Style clicks effect-assertion', async ({ page }) => {
  wireConsole(page, 'P6');
  const s = await createSection(page.request, `P6 ${uniq}`, [HEADLINE, ZIP, CONT]);
  await boot(page, s);
  const tile = page.locator('[data-studio-library] [data-tile][data-name="buttons"]').first();
  const inserted = await tryClick(tile, 6000);
  await page.waitForTimeout(700);
  const node = canvas(page).locator('[data-component-type="ButtonAnswerGroup"]').first();
  const nodeVisible = await node.isVisible().catch(() => false);
  await page.screenshot({ path: `${SHOT}/P6-inserted.png` });
  async function snap() {
    return frameBody(page).evaluate(() => {
      const root = document.querySelector('#lg-studio-canvas-render');
      const html = root ? root.innerHTML : '';
      let h = 0; for (let i = 0; i < html.length; i++) { h = (Math.imul(h, 31) + html.charCodeAt(i)) | 0; }
      const el = document.querySelector('#lg-studio-canvas-render [data-component-type="ButtonAnswerGroup"]') as HTMLElement | null;
      const cs = el ? getComputedStyle(el) : null;
      return { hash: h, width: cs ? cs.width : '', height: cs ? cs.height : '', radius: cs ? cs.borderRadius : '' };
    });
  }
  await tryClick(page.locator('[data-studio-inspector-tab="style"]'), 3000);
  await page.waitForTimeout(200);
  const seq: Array<[string, string, string]> = [
    ['width', 's', '[data-set-width="s"]'], ['width', 'full', '[data-set-width="full"]'],
    ['height', 'small', '[data-set-height="small"]'], ['height', 'large', '[data-set-height="large"]'],
    ['corners', 'sharp', '[data-set-corners="sharp"]'], ['corners', 'pill', '[data-set-corners="pill"]'],
  ];
  const results: Array<Record<string, unknown>> = [];
  let prev = await snap();
  for (const [k, v, sel] of seq) {
    const did = await tryClick(page.locator(sel), 4000);
    await page.waitForTimeout(500);
    const cur = await snap();
    const changed = did && (cur.hash !== prev.hash || cur.width !== prev.width || cur.height !== prev.height || cur.radius !== prev.radius);
    results.push({ click: `${k}=${v}`, clickable: did, changed, w: cur.width, h: cur.height, r: cur.radius });
    prev = cur;
  }
  await page.screenshot({ path: `${SHOT}/P6-after-style.png` });
  const anyChange = results.some((r) => r.changed);
  record({ probe: 'P6', verdict: !inserted || !nodeVisible ? 'DEAD' : anyChange ? 'WORKS' : 'DEAD', evidence: `inserted=${inserted} nodeVisible=${nodeVisible}; per-click=${JSON.stringify(results)}`, shots: ['P6-inserted.png', 'P6-after-style.png'] });
});

test('P7 Offers tab Open full mapping drawer', async ({ page }) => {
  wireConsole(page, 'P7');
  await createOffer(page.request, `P7 Offer ${uniq}`);
  const s = await createSection(page.request, `P7 ${uniq}`, [HEADLINE, ZIP, CONT]);
  await boot(page, s);
  await tryClick(canvas(page).locator('[data-component-type="ZIPInputQuestion"]'), 8000);
  const offersTabVisible = await page.locator('[data-studio-inspector-tab="offers"]').isVisible().catch(() => false);
  await tryClick(page.locator('[data-studio-inspector-tab="offers"]'), 4000);
  await page.waitForTimeout(300);
  const openBtn = page.locator('[data-studio-open-mapping-drawer]');
  const btnVisible = await openBtn.isVisible().catch(() => false);
  await page.screenshot({ path: `${SHOT}/P7-before.png` });
  const reqs: string[] = [];
  const onReq = (r: { url(): string }) => { const u = r.url(); if (u.includes('/api/')) reqs.push(u.replace(/^https?:\/\/[^/]+/, '')); };
  page.on('request', onReq);
  const clicked = await tryClick(openBtn, 5000);
  await page.waitForTimeout(2000);
  page.off('request', onReq);
  const drawerMappingVisible = await page.locator('[data-studio-drawer-panel="mapping"]').isVisible().catch(() => false);
  await page.screenshot({ path: `${SHOT}/P7-after.png` });
  record({ probe: 'P7', verdict: clicked && drawerMappingVisible ? 'WORKS' : 'DEAD', evidence: `offersTab=${offersTabVisible} openBtnVisible=${btnVisible} clicked=${clicked}; mapping drawer panel visible after=${drawerMappingVisible}; api reqs in 2s=${JSON.stringify(reqs.slice(0, 6))}`, shots: ['P7-before.png', 'P7-after.png'] });
});

test('P8 Rules author + persist across reload', async ({ page }) => {
  wireConsole(page, 'P8');
  const s = await createSection(page.request, `P8 ${uniq}`, [HEADLINE, YESNO, ZIP, CONT]);
  await boot(page, s);
  await tryClick(canvas(page).locator('[data-component-type="ZIPInputQuestion"]'), 8000);
  await tryClick(page.locator('[data-studio-inspector-tab="rules"]'), 4000);
  await page.waitForTimeout(200);
  await tryClick(page.locator('[data-rules-add-condition]'), 4000);
  await page.waitForTimeout(200);
  const when = page.locator('[data-inspector-cond="when"]');
  const whenOpts = await when.locator('option').evaluateAll((els) => els.map((e) => ({ v: (e as HTMLOptionElement).value, t: (e.textContent || '').trim() })));
  let authored = false;
  try {
    await when.selectOption('currently_insured', { timeout: 4000 });
    const vbool = page.locator('[data-inspector-cond="value-bool"]');
    if (await vbool.isVisible().catch(() => false)) await vbool.selectOption('true', { timeout: 3000 });
    authored = true;
  } catch { authored = false; }
  const sentence = await page.locator('[data-cond-sentence]').textContent().catch(() => null);
  await page.screenshot({ path: `${SHOT}/P8-authored.png` });
  let persisted: unknown = 'not-saved';
  try {
    await Promise.all([page.waitForEvent('load'), page.locator('#lg-section-save').click({ timeout: 5000 })]);
    const detail = await json<{ content_json: { components: Array<{ question_id: string; conditional?: unknown }> } }>(await page.request.get(`${LG_API}/sections/${s.public_id}`), 'p8 detail');
    persisted = detail.content_json.components.find((c) => c.question_id === 'q_zip')?.conditional ?? null;
  } catch (e) { persisted = `save-failed:${String((e as Error).message).slice(0, 80)}`; }
  const ok = authored && persisted && persisted !== 'not-saved' && typeof persisted === 'object';
  record({ probe: 'P8', verdict: ok ? 'WORKS' : 'DEAD', evidence: `when-options=${JSON.stringify(whenOpts)}; authored=${authored}; sentence="${sentence}"; persisted conditional on q_zip=${JSON.stringify(persisted)}`, shots: ['P8-authored.png'] });
});

test('P9 Content Leading icon = Calendar renders on canvas', async ({ page }) => {
  wireConsole(page, 'P9');
  const s = await createSection(page.request, `P9 ${uniq}`, [HEADLINE, ZIP, CONT]);
  await boot(page, s);
  await tryClick(canvas(page).locator('[data-component-type="ZIPInputQuestion"]'), 8000);
  await tryClick(page.locator('[data-studio-inspector-tab="content"]'), 4000);
  await page.waitForTimeout(200);
  const sel = page.locator('#lg-leading-icon');
  const selVisible = await sel.isVisible().catch(() => false);
  // full-canvas fingerprint (hash + svg count) before/after — icon could render anywhere
  const fp = () => frameBody(page).evaluate(() => {
    const root = document.querySelector('#lg-studio-canvas-render');
    const html = root ? root.innerHTML : '';
    let h = 0; for (let i = 0; i < html.length; i++) { h = (Math.imul(h, 31) + html.charCodeAt(i)) | 0; }
    const zip = document.querySelector('#lg-studio-canvas-render [data-question-id="q_zip"]');
    return { hash: h, canvasSvgs: root ? root.querySelectorAll('svg').length : 0, zipHtmlLen: zip ? (zip as HTMLElement).outerHTML.length : 0, zipParentHtmlLen: zip && zip.parentElement ? zip.parentElement.outerHTML.length : 0 };
  });
  const before = await fp();
  let picked = false;
  try { await sel.selectOption('calendar', { timeout: 4000 }); picked = true; } catch { picked = false; }
  await page.waitForTimeout(800);
  const after = await fp();
  await page.screenshot({ path: `${SHOT}/P9-after.png` });
  // persistence: save + reload, does the node carry props.icon and does the canvas then render it?
  let persistedIcon: unknown = 'not-saved';
  try {
    await Promise.all([page.waitForEvent('load'), page.locator('#lg-section-save').click({ timeout: 5000 })]);
    const detail = await json<{ content_json: { components: Array<{ question_id: string; props?: Record<string, unknown> }> } }>(await page.request.get(`${LG_API}/sections/${s.public_id}`), 'p9 detail');
    persistedIcon = detail.content_json.components.find((c) => c.question_id === 'q_zip')?.props?.['icon'] ?? null;
  } catch (e) { persistedIcon = `save-failed:${String((e as Error).message).slice(0, 60)}`; }
  const canvasChanged = picked && (before.hash !== after.hash || before.canvasSvgs !== after.canvasSvgs);
  record({ probe: 'P9', verdict: !selVisible ? 'DEAD' : canvasChanged ? 'WORKS' : 'DEAD', evidence: `select visible=${selVisible}; picked=${picked}; canvas hash ${before.hash}->${after.hash}, svgCount ${before.canvasSvgs}->${after.canvasSvgs}, zipHtmlLen ${before.zipHtmlLen}->${after.zipHtmlLen}, zipParentHtmlLen ${before.zipParentHtmlLen}->${after.zipParentHtmlLen}; canvas rendered-change=${canvasChanged}; persisted props.icon after save+reload=${JSON.stringify(persistedIcon)}`, shots: ['P9-after.png'] });
});

test('P10 insert Slider + set Step/Min/Max + preview reflects', async ({ page }) => {
  wireConsole(page, 'P10');
  const s = await createSection(page.request, `P10 ${uniq}`, [HEADLINE, ZIP, CONT]);
  await boot(page, s);
  const tile = page.locator('[data-studio-library] [data-tile][data-name="slider scale"]').first();
  const inserted = await tryClick(tile, 6000);
  await page.waitForTimeout(700);
  const node = canvas(page).locator('[data-component-type="NumberRangeQuestion"]').first();
  const nodeVisible = await node.isVisible().catch(() => false);
  await page.screenshot({ path: `${SHOT}/P10-inserted.png` });
  await tryClick(page.locator('[data-studio-inspector-tab="content"]'), 4000);
  await page.waitForTimeout(200);
  const setField = async (vprop: string, val: string) => {
    const loc = page.locator(`[data-inspector-vprop="${vprop}"]`);
    if (await loc.isVisible().catch(() => false)) { await loc.fill(val).catch(() => {}); await loc.blur().catch(() => {}); return true; }
    return false;
  };
  const setMin = await setField('min', '0');
  const setMax = await setField('max', '100');
  const setStep = await setField('step', '5');
  await page.waitForTimeout(700);
  // does the canvas preview reflect min/max/step on the rendered range control?
  const rendered = await frameBody(page).evaluate(() => {
    const scope = document.querySelector('#lg-studio-canvas-render [data-component-type="NumberRangeQuestion"]');
    const range = scope ? (scope.querySelector('input[type="range"]') as HTMLInputElement | null) : null;
    const anyRange = document.querySelector('#lg-studio-canvas-render input[type="range"]') as HTMLInputElement | null;
    const r = range || anyRange;
    return { hasRangeInput: !!r, min: r ? r.min : null, max: r ? r.max : null, step: r ? r.step : null, scopeHtmlLen: scope ? scope.outerHTML.length : 0 };
  });
  // visual quality: does the selection name-tag overlap the field box? (z / geometry)
  const overlap = await frameBody(page).evaluate(() => {
    const scope = document.querySelector('#lg-studio-canvas-render [data-component-type="NumberRangeQuestion"]') as HTMLElement | null;
    const wrap = scope ? scope.closest('[data-selection-wrap]') as HTMLElement | null : null;
    const tag = wrap ? Array.from(wrap.querySelectorAll('div[data-selection-chrome]')).find((d) => (d.textContent || '').length > 0) as HTMLElement | undefined : undefined;
    if (!scope || !tag) return null;
    const sr = scope.getBoundingClientRect(); const tr = tag.getBoundingClientRect();
    const overlaps = !(tr.bottom <= sr.top || tr.top >= sr.bottom || tr.right <= sr.left || tr.left >= sr.right);
    return { overlaps, tagText: (tag.textContent || '').slice(0, 40), tag: { x: +tr.x.toFixed(0), y: +tr.y.toFixed(0), b: +tr.bottom.toFixed(0) }, field: { y: +sr.y.toFixed(0), b: +sr.bottom.toFixed(0) } };
  });
  await page.screenshot({ path: `${SHOT}/P10-after.png` });
  const reflects = rendered.hasRangeInput && rendered.min === '0' && rendered.max === '100' && rendered.step === '5';
  record({ probe: 'P10', verdict: !inserted || !nodeVisible ? 'DEAD' : reflects ? 'WORKS' : 'MISALIGNED', evidence: `inserted=${inserted} nodeVisible=${nodeVisible}; setMin=${setMin} setMax=${setMax} setStep=${setStep}; canvas range input=${JSON.stringify(rendered)}; nametag-overlap=${JSON.stringify(overlap)}`, shots: ['P10-inserted.png', 'P10-after.png'] });
});

// ============================ RISKY DRAG PROBES (page.mouse into srcdoc iframe) ============================
// Each isolated; a HANG on the 2nd page.mouse.move into the same-origin srcdoc
// iframe IS the finding (real-input drag impossible). Drag sequences go
// through utils/real-input.ts's realDrag(), whose per-step timeout guards
// turn a harness hang into a fast, typed StepTimeoutError (recorded here as
// verdict 'HANG') instead of wedging the run out to the 120s test timeout.
// NEVER falls back to dispatchEvent. Run these with --grep MOUSEDRAG in
// their own invocation(s).

test('P3DRAG width E-handle real page.mouse drag [MOUSEDRAG]', async ({ page }) => {
  test.setTimeout(120_000);
  wireConsole(page, 'P3drag');
  const s = await createSection(page.request, `P3d ${uniq}`, [HEADLINE, ZIP, CONT]);
  await boot(page, s);
  await tryClick(canvas(page).locator('[data-question-id="q_zip"]'), 8000);
  await page.waitForTimeout(400);
  const handle = page.frameLocator('#lg-studio-canvas-frame').locator('[data-width-handle][data-handle-side="right"]');
  await expect(handle).toBeVisible({ timeout: 8000 });
  const box = await handle.boundingBox();
  if (!box) { record({ probe: 'P3-widthdrag', verdict: 'DEAD', evidence: 'E handle has no bounding box', shots: [] }); return; }
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  record({ probe: 'P3-widthdrag', verdict: 'ATTEMPT', evidence: `about to realDrag E handle at (${cx.toFixed(0)},${cy.toFixed(0)}) +60px, 3 per-step-guarded moves (5s/step — prior evidence: hangs at the 2nd move); a guard firing records HANG instead of wedging to the 120s test timeout`, shots: [] });
  try {
    await realDrag(page, { x: cx, y: cy }, { x: cx + 60, y: cy }, { steps: 3, perStepGuardMs: 5000, settleMs: 600 });
  } catch (e) {
    if (e instanceof StepTimeoutError) {
      record({ probe: 'P3-widthdrag', verdict: 'HANG', evidence: `real-input per-step guard fired (fails fast, not a wedged run): ${e.message}`, shots: [] });
      return;
    }
    throw e;
  }
  const badge = await page.frameLocator('#lg-studio-canvas-frame').locator('text=/≈ \\d+ px · custom/').textContent().catch(() => null);
  await page.screenshot({ path: `${SHOT}/P3DRAG-after.png` });
  record({ probe: 'P3-widthdrag', verdict: badge ? 'WORKS' : 'DEAD', evidence: `realDrag completed WITHOUT hang; custom badge="${badge}"`, shots: ['P3DRAG-after.png'] });
});

test('P4DRAG move field body 100px down real page.mouse [MOUSEDRAG]', async ({ page }) => {
  test.setTimeout(120_000);
  wireConsole(page, 'P4drag');
  const s = await createSection(page.request, `P4d ${uniq}`, [HEADLINE, YESNO, ZIP, CONT]);
  await boot(page, s);
  const orderBefore = await frameBody(page).evaluate(() => Array.from(document.querySelectorAll('#lg-studio-canvas-render [data-question-id]')).map((e) => e.getAttribute('data-question-id')));
  const body = page.frameLocator('#lg-studio-canvas-frame').locator('[data-question-id="q_ins"]');
  const box = await body.boundingBox();
  if (!box) { record({ probe: 'P4-move', verdict: 'DEAD', evidence: 'q_ins body has no bounding box', shots: [] }); return; }
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  record({ probe: 'P4-move', verdict: 'ATTEMPT', evidence: `about to realDrag q_ins body from (${cx.toFixed(0)},${cy.toFixed(0)}) +100px down, 3 per-step-guarded moves (5s/step); orderBefore=${JSON.stringify(orderBefore)}; a guard firing records HANG instead of wedging to the 120s test timeout`, shots: [] });
  try {
    await realDrag(page, { x: cx, y: cy }, { x: cx, y: cy + 100 }, { steps: 3, perStepGuardMs: 5000, settleMs: 600 });
  } catch (e) {
    if (e instanceof StepTimeoutError) {
      record({ probe: 'P4-move', verdict: 'HANG', evidence: `real-input per-step guard fired (fails fast, not a wedged run): ${e.message}`, shots: [] });
      return;
    }
    throw e;
  }
  const orderAfter = await frameBody(page).evaluate(() => Array.from(document.querySelectorAll('#lg-studio-canvas-render [data-question-id]')).map((e) => e.getAttribute('data-question-id')));
  await page.screenshot({ path: `${SHOT}/P4DRAG-after.png` });
  const moved = JSON.stringify(orderBefore) !== JSON.stringify(orderAfter);
  record({ probe: 'P4-move', verdict: moved ? 'WORKS' : 'DEAD', evidence: `realDrag completed WITHOUT hang; orderBefore=${JSON.stringify(orderBefore)} orderAfter=${JSON.stringify(orderAfter)}; moved=${moved}`, shots: ['P4DRAG-after.png'] });
});

test('P10DRAG slider handle real page.mouse drag [MOUSEDRAG]', async ({ page }) => {
  test.setTimeout(120_000);
  wireConsole(page, 'P10drag');
  const s = await createSection(page.request, `P10d ${uniq}`, [HEADLINE, ZIP, CONT]);
  await boot(page, s);
  await tryClick(page.locator('[data-studio-library] [data-tile][data-name="slider scale"]').first(), 6000);
  await page.waitForTimeout(700);
  const range = page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render input[type="range"]').first();
  const has = await range.count();
  if (!has) { record({ probe: 'P10-sliderdrag', verdict: 'DEAD', evidence: 'no input[type=range] rendered in the studio canvas (design surface, not interactive runtime)', shots: [] }); return; }
  const box = await range.boundingBox();
  if (!box) { record({ probe: 'P10-sliderdrag', verdict: 'DEAD', evidence: 'range has no bounding box', shots: [] }); return; }
  const cy = box.y + box.height / 2;
  const valBefore = await range.inputValue().catch(() => null);
  record({ probe: 'P10-sliderdrag', verdict: 'ATTEMPT', evidence: `about to realDrag slider handle, 2 per-step-guarded moves (5s/step); valBefore=${valBefore}; a guard firing records HANG instead of wedging to the 120s test timeout`, shots: [] });
  try {
    await realDrag(page, { x: box.x + 4, y: cy }, { x: box.x + box.width * 0.8, y: cy }, { steps: 2, perStepGuardMs: 5000, settleMs: 400 });
  } catch (e) {
    if (e instanceof StepTimeoutError) {
      record({ probe: 'P10-sliderdrag', verdict: 'HANG', evidence: `real-input per-step guard fired (fails fast, not a wedged run): ${e.message}`, shots: [] });
      return;
    }
    throw e;
  }
  const valAfter = await range.inputValue().catch(() => null);
  await page.screenshot({ path: `${SHOT}/P10DRAG-after.png` });
  record({ probe: 'P10-sliderdrag', verdict: valBefore !== valAfter ? 'WORKS' : 'DEAD', evidence: `realDrag completed WITHOUT hang; value ${valBefore}->${valAfter}`, shots: ['P10DRAG-after.png'] });
});
