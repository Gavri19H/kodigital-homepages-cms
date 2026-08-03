// B5 board drive: measures fully-visible funnel columns at 5 widths, shared-col
// sticky x at scroll 0 / max, a REAL pointer drag into the furthest column,
// the keyboard target funnel, touch handler presence, console errors.
import { chromium } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:8901';
const QUOTE = 'lgq_01KZ271383Y0MPV4BM2WKKCC4W';
const URL = `${ORIGIN}/admin/leadgen/quotes/${QUOTE}/edit`;
const TAG = process.argv[2] || 'run';

const measure = () => {
  const board = document.querySelector('[data-board]');
  const br = board.getBoundingClientRect();
  const shared = document.querySelector('[data-shared-col]');
  const sr = shared ? shared.getBoundingClientRect() : null;
  // visible viewport of the board's scroll port, minus what the sticky shared
  // column overlays (a funnel column hidden UNDER the pinned shared col is not
  // "fully visible").
  const leftEdge = sr && getComputedStyle(shared).position === 'sticky'
    ? Math.max(br.left, sr.right) : br.left;
  const cols = Array.from(document.querySelectorAll('[data-funnel-col]'));
  const rects = cols.map((c) => {
    const r = c.getBoundingClientRect();
    return {
      id: c.getAttribute('data-funnel-public-id').slice(-6),
      left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
      full: r.left >= leftEdge - 0.5 && r.right <= br.right + 0.5,
    };
  });
  return {
    board: { left: Math.round(br.left), right: Math.round(br.right), w: Math.round(br.width) },
    sharedX: sr ? Math.round(sr.left) : null,
    sharedW: sr ? Math.round(sr.width) : null,
    sharedPos: shared ? getComputedStyle(shared).position : null,
    scrollLeft: Math.round(board.scrollLeft),
    scrollW: Math.round(board.scrollWidth),
    clientW: Math.round(board.clientWidth),
    hScrollbar: board.offsetHeight - board.clientHeight,
    fullCount: rects.filter((r) => r.full).length,
    cols: rects,
  };
};

const run = async () => {
  const browser = await chromium.launch();
  const out = { tag: TAG, widths: {}, errors: [] };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-board]');
  await page.waitForTimeout(700);

  for (const w of [375, 1280, 1440, 1600, 1920]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(350);
    const m = await page.evaluate(measure);
    out.widths[w] = m;
  }

  // shared col x at scroll 0 and max, at 1280
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);
  const atZero = await page.evaluate(() => {
    const b = document.querySelector('[data-board]'); b.scrollLeft = 0;
    const s = document.querySelector('[data-shared-col]');
    return { scrollLeft: b.scrollLeft, sharedX: Math.round(s.getBoundingClientRect().left) };
  });
  const atMax = await page.evaluate(() => {
    const b = document.querySelector('[data-board]');
    b.scrollLeft = b.scrollWidth; // clamps to max
    const s = document.querySelector('[data-shared-col]');
    return { scrollLeft: Math.round(b.scrollLeft), sharedX: Math.round(s.getBoundingClientRect().left) };
  });
  out.sharedSticky = { atZero, atMax };
  await page.evaluate(() => { document.querySelector('[data-board]').scrollLeft = 0; });

  // touch handler presence (does the island register pointer/touch drag?)
  out.touchHandlers = await page.evaluate(() => {
    const s = Array.from(document.querySelectorAll('script')).map((x) => x.textContent || '').join('\n');
    return {
      touchstart: (s.match(/touchstart/g) || []).length,
      pointerdown: (s.match(/pointerdown/g) || []).length,
      scrollBy: (s.match(/scrollBy/g) || []).length,
      scrollLeftAssign: (s.match(/scrollLeft\s*=/g) || []).length,
      touchAction: getComputedStyle(document.querySelector('[data-lib-card]')).touchAction,
    };
  });

  // REAL pointer drag: library card -> the FURTHEST funnel column (last one),
  // which at 1280 needs horizontal scroll to reach.
  const before = await page.evaluate(() => {
    const cols = Array.from(document.querySelectorAll('[data-funnel-col]'));
    const last = cols[cols.length - 1];
    return {
      lastId: last.getAttribute('data-funnel-public-id'),
      lastChips: last.querySelectorAll('[data-sec-chip]').length,
      lastRight: Math.round(last.getBoundingClientRect().right),
      boardRight: Math.round(document.querySelector('[data-board]').getBoundingClientRect().right),
      scrollLeft: Math.round(document.querySelector('[data-board]').scrollLeft),
    };
  });
  out.dragBefore = before;

  const card = page.locator('[data-lib-card]').first();
  const cardBox = await card.boundingBox();
  const boardBox = await page.locator('[data-board]').boundingBox();
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  // walk toward the board's RIGHT edge in real steps
  const targetX = boardBox.x + boardBox.width - 12;
  const targetY = boardBox.y + boardBox.height / 2;
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      cardBox.x + (targetX - cardBox.x) * (i / steps),
      cardBox.y + (targetY - cardBox.y) * (i / steps),
    );
    await page.waitForTimeout(30);
  }
  // hold at the edge to see whether anything auto-scrolls
  const holdStart = await page.evaluate(() => Math.round(document.querySelector('[data-board]').scrollLeft));
  await page.waitForTimeout(1800);
  const holdEnd = await page.evaluate(() => Math.round(document.querySelector('[data-board]').scrollLeft));
  await page.mouse.move(targetX, targetY);
  const hover = await page.evaluate(() => {
    const t = document.querySelector('.lg-drop-target');
    return {
      dropTarget: t ? (t.getAttribute('data-funnel-public-id') || t.className) : null,
      dropTargetFunnel: t ? (t.closest('[data-funnel-col]') ? t.closest('[data-funnel-col]').getAttribute('data-funnel-public-id') : null) : null,
      hint: (document.querySelector('[data-board-hint]') || {}).textContent || null,
    };
  });
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => {
    const cols = Array.from(document.querySelectorAll('[data-funnel-col]'));
    const last = cols[cols.length - 1];
    const err = document.querySelector('.lg-board-inline-err');
    return {
      lastId: last.getAttribute('data-funnel-public-id'),
      lastChips: last.querySelectorAll('[data-sec-chip]').length,
      scrollLeft: Math.round(document.querySelector('[data-board]').scrollLeft),
      inlineErr: err ? err.textContent : null,
      allChipCounts: cols.map((c) => c.getAttribute('data-funnel-public-id').slice(-6) + ':' + c.querySelectorAll('[data-sec-chip]').length),
    };
  });
  out.dragAutoScroll = { holdStart, holdEnd, moved: holdEnd - holdStart };
  out.dragHover = hover;
  out.dragAfter = after;

  // keyboard path target
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-board]');
  await page.waitForTimeout(500);
  const kbBefore = await page.evaluate(() => Array.from(document.querySelectorAll('[data-funnel-col]'))
    .map((c) => c.getAttribute('data-funnel-public-id').slice(-6) + ':' + c.querySelectorAll('[data-sec-chip]').length));
  out.kbSelectedTarget = await page.evaluate(() => {
    const sel = document.querySelector('[data-kb-target]');
    return sel ? sel.value : null;
  });
  await page.locator('[data-lib-card]').first().focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  const kbAfter = await page.evaluate(() => Array.from(document.querySelectorAll('[data-funnel-col]'))
    .map((c) => c.getAttribute('data-funnel-public-id').slice(-6) + ':' + c.querySelectorAll('[data-sec-chip]').length));
  out.keyboard = { kbBefore, kbAfter };

  out.errors = errs;
  await browser.close();
  console.log(JSON.stringify(out, null, 2));
};
run().catch((e) => { console.error('DRIVE-FAIL', e); process.exit(1); });
