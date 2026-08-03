import { chromium } from '@playwright/test';
const URL = 'http://127.0.0.1:8901/admin/leadgen/quotes/lgq_01KZ271383Y0MPV4BM2WKKCC4W/edit';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.lg-board-shell');
await p.waitForTimeout(500);
for (const w of [375, 1280]) {
  await p.setViewportSize({ width: w, height: 900 });
  await p.waitForTimeout(300);
  const r = await p.evaluate(() => {
    const g = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width) }; };
    const shell = document.querySelector('.lg-board-shell');
    let chain = []; let el = shell;
    while (el && el !== document.body) { const bb = el.getBoundingClientRect(); chain.push((el.tagName + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 2).join('.') : '')) + ' [' + Math.round(bb.left) + '-' + Math.round(bb.right) + ']'); el = el.parentElement; }
    return { shell: g('.lg-board-shell'), left: g('.lg-board-left'), center: g('.lg-board-center'), right: g('.lg-board-right'), board: g('[data-board]'), chain };
  });
  console.log(w, JSON.stringify(r, null, 1));
}
await b.close();
