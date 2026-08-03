import { chromium } from '@playwright/test';
const URL = 'http://127.0.0.1:8901/admin/leadgen/quotes/lgq_01KZ271383Y0MPV4BM2WKKCC4W/edit';

const CSS = `
.lg-board-shell{--lg-rail-l:292px;--lg-rail-r:344px;--lg-col-w:288px;--lg-col-gap:14px;--lg-board-pad:16px}
@media (max-width:1599px){.lg-board-shell{--lg-rail-l:256px;--lg-rail-r:308px;--lg-col-w:248px;--lg-col-gap:12px;--lg-board-pad:14px}}
@media (max-width:1439px){.lg-board-shell{--lg-rail-l:216px;--lg-rail-r:276px;--lg-col-w:216px;--lg-col-gap:12px;--lg-board-pad:12px}}
.lg-board-left{flex:0 0 var(--lg-rail-l);width:var(--lg-rail-l)}
.lg-board-right{flex:0 0 var(--lg-rail-r);width:var(--lg-rail-r)}
.lg-board{padding:var(--lg-board-pad)}
.lg-board-cols{gap:var(--lg-col-gap)}
.lg-col{flex:0 0 var(--lg-col-w);width:var(--lg-col-w)}
.lg-stub-col{flex:0 0 var(--lg-col-w);width:var(--lg-col-w)}
.lg-col-shared{position:static;z-index:auto;box-shadow:none;border:0;border-bottom:1px solid var(--c-border);border-radius:0;background:#fff;max-height:none;width:auto;flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:10px 14px}
.lg-col-shared .lg-col-head{flex:1 1 210px;min-width:170px;max-width:300px;padding:0;border:0;background:none;border-radius:0}
.lg-col-shared .lg-col-body{flex:4 1 300px;min-width:0;padding:0;overflow:visible;display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.lg-col-shared .lg-col-meta{margin-top:4px}
.lg-col-shared .lg-page-card{flex:3 1 240px;min-width:0;margin:0;display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.lg-col-shared .lg-page-head{margin:0}
.lg-col-shared .lg-chip-list{flex:1 1 180px;min-width:0;flex-direction:row;flex-wrap:wrap;gap:6px}
.lg-col-shared .lg-sec-chip{margin-bottom:0;max-width:100%}
.lg-col-shared .lg-add-section{padding:0}
.lg-col-shared .lg-hint-neutral{flex:1 1 150px;min-width:0;margin:0}
`;

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.lg-board-shell');
await p.waitForTimeout(600);
await p.evaluate((css) => {
  const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
  const shared = document.querySelector('[data-shared-col]');
  const center = document.querySelector('.lg-board-center');
  shared.className = 'lg-col-shared';
  center.insertBefore(shared, center.firstChild);
}, CSS);
await p.waitForTimeout(300);

for (const w of [375, 1280, 1440, 1600, 1920]) {
  await p.setViewportSize({ width: w, height: 900 });
  await p.waitForTimeout(350);
  const m = await p.evaluate(() => {
    const board = document.querySelector('[data-board]');
    const br = board.getBoundingClientRect();
    const cols = Array.from(document.querySelectorAll('[data-funnel-col]')).map((c) => {
      const r = c.getBoundingClientRect();
      return { id: c.getAttribute('data-funnel-public-id').slice(-6), l: Math.round(r.left), r: Math.round(r.right), full: r.left >= br.left - 0.5 && r.right <= br.right + 0.5 };
    });
    const rail = document.querySelector('.lg-board-right');
    const rr = rail.getBoundingClientRect();
    const band = document.querySelector('.lg-col-shared').getBoundingClientRect();
    const railOver = Array.from(rail.querySelectorAll('*')).filter((el) => el.getBoundingClientRect().right > rr.right + 1).length;
    const bandOver = Array.from(document.querySelectorAll('.lg-col-shared *')).filter((el) => el.getBoundingClientRect().right > band.right + 1).length;
    return {
      board: { l: Math.round(br.left), r: Math.round(br.right), w: Math.round(br.width) },
      railW: Math.round(rr.width), railOver, bandH: Math.round(band.height), bandOver,
      slack: Math.round(br.width - 2 * (cols[1].r - cols[1].l) - (cols[1].l - cols[0].r) - 2 * parseFloat(getComputedStyle(board).paddingLeft)),
      full: cols.filter((c) => c.full).length, cols: cols.map((c) => c.id + '[' + c.l + '-' + c.r + (c.full ? '*' : '') + ']').join(' '),
    };
  });
  console.log(w, JSON.stringify(m));
}
await p.setViewportSize({ width: 1280, height: 900 });
await p.waitForTimeout(300);
await p.screenshot({ path: '.scratch-proto-1280.png' });
await p.setViewportSize({ width: 375, height: 800 });
await p.waitForTimeout(300);
await p.screenshot({ path: '.scratch-proto-375.png' });
await b.close();
