// LeadGen list date window (backlog F21).
//
// The four LeadGen list tabs (Offers · Sections · Quotes · Auction) pick the
// dates their analytics columns load with this control instead of the
// shared Listicles timeframe <select>: "‹ [dates] ›" plus a panel with
// presets and From / To dates. Listicles and the Offer / Quote editor
// Analytics tabs keep listicles/ui-shared.ts's select, untouched.
//
// The address is the state: a preset is ?range=<key> (the old today/7d/30d/
// 90d keys keep working; yesterday and 3d are new), custom dates are
// ?from=YYYY-MM-DD&to=YYYY-MM-DD. All days are UTC days — the LeadGen
// analytics mirror is stored per UTC day, so the table's
// data-analytics-from / -to pair asks the unchanged analytics routes for
// exactly those days. Bad input falls back to "Last 30 days", as a bad
// ?range did before.
//
// Presets and arrows are plain links built here on the server (they keep
// every other query param and drop `page`), so only the panel's open/close
// and its "Apply" need the inline script, which stays strict ES5 (var only,
// no arrows / template literals / let / const) like every admin island.

import { escapeHtml } from "../templates/layout";

export interface DateWindow {
  // Preset key ("today" | "yesterday" | "3d" | "7d" | "30d" | "90d"), or
  // "custom" for From / To dates that match no preset.
  key: string;
  from: string; // YYYY-MM-DD, first UTC day, inclusive
  to: string; // YYYY-MM-DD, last UTC day, inclusive
  today: string; // the UTC day the window was resolved on
  custom: boolean; // true when the address holds ?from&to
  label: string; // what the date button shows
}

interface Preset {
  key: string;
  label: string;
  days: number; // window length
  endBack: number; // how many days before today the window ends
}

// Panel order. "Last N days" includes today (today + N-1 days back), the
// rule "Last 7 days" has always used (Ido, 9 Nov 2026, Q2).
const PRESETS: ReadonlyArray<Preset> = [
  { key: "today", label: "Today", days: 1, endBack: 0 },
  { key: "yesterday", label: "Yesterday", days: 1, endBack: 1 },
  { key: "3d", label: "Last 3 days", days: 3, endBack: 0 },
  { key: "7d", label: "Last 7 days", days: 7, endBack: 0 },
  { key: "30d", label: "Last 30 days", days: 30, endBack: 0 },
  { key: "90d", label: "Last 90 days", days: 90, endBack: 0 },
];

export const DEFAULT_DATE_WINDOW_KEY = "30d";

// Longest From / To window: one year (a leap year included). Every list row
// asks the analytics routes for its own sums, so an unbounded window would
// make 25 rows each sum years of daily rows at once.
export const MAX_DATE_WINDOW_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Query params the control owns; every other param (search, filters) is
// carried as is by the links it builds.
const OWN_PARAMS = ["page", "range", "from", "to"];

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function dayMs(ymd: string): number {
  return Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
}

function addDays(ymd: string, days: number): string {
  return utcDay(dayMs(ymd) + days * DAY_MS);
}

// A real calendar day (2026-02-30 and 2026-13-01 are not).
function isRealDay(value: string): boolean {
  return DATE_RE.test(value) && utcDay(dayMs(value)) === value;
}

function lengthInDays(from: string, to: string): number {
  return Math.round((dayMs(to) - dayMs(from)) / DAY_MS) + 1;
}

// Own-key lookup: ?range=constructor / __proto__ must never resolve.
function findPreset(key: string | undefined): Preset | null {
  if (key === undefined) return null;
  for (const p of PRESETS) {
    if (p.key === key) return p;
  }
  return null;
}

function presetBounds(p: Preset, today: string): { from: string; to: string } {
  const to = addDays(today, -p.endBack);
  return { from: addDays(to, -(p.days - 1)), to };
}

// A From / To pair that is exactly a preset's window shows that preset's
// name (e.g. stepping "›" back up to today).
function matchingPreset(from: string, to: string, today: string): Preset | null {
  for (const p of PRESETS) {
    const b = presetBounds(p, today);
    if (b.from === from && b.to === to) return p;
  }
  return null;
}

function formatDay(ymd: string, withYear: boolean): string {
  const day = String(Number(ymd.slice(8, 10)));
  const month = MONTHS[Number(ymd.slice(5, 7)) - 1] ?? "";
  return withYear ? `${day} ${month} ${ymd.slice(0, 4)}` : `${day} ${month}`;
}

// "9 Nov 2026" · "7 Nov – 9 Nov 2026" · "30 Dec 2025 – 2 Jan 2026"
export function formatDateSpan(from: string, to: string): string {
  if (from === to) return formatDay(from, true);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${formatDay(from, !sameYear)} – ${formatDay(to, true)}`;
}

function build(from: string, to: string, today: string, custom: boolean): DateWindow {
  const preset = matchingPreset(from, to, today);
  const span = formatDateSpan(from, to);
  return {
    key: preset ? preset.key : "custom",
    from,
    to,
    today,
    custom,
    label: preset ? `${preset.label} · ${span}` : span,
  };
}

export interface DateWindowQuery {
  range?: string;
  from?: string;
  to?: string;
}

// ?from&to wins when both are real days, from ≤ to and to is not after
// today; otherwise a known ?range preset; otherwise "Last 30 days".
export function resolveDateWindow(query: DateWindowQuery, now: Date = new Date()): DateWindow {
  const today = utcDay(now.getTime());
  const { from, to } = query;
  if (
    from !== undefined &&
    to !== undefined &&
    isRealDay(from) &&
    isRealDay(to) &&
    from <= to &&
    to <= today &&
    lengthInDays(from, to) <= MAX_DATE_WINDOW_DAYS
  ) {
    return build(from, to, today, true);
  }
  const preset = findPreset(query.range) ?? (findPreset(DEFAULT_DATE_WINDOW_KEY) as Preset);
  const b = presetBounds(preset, today);
  return build(b.from, b.to, today, false);
}

// The params that carry this window to another page (pager links, the
// LeadGen tab links). The default window needs none.
export function dateWindowParams(w: DateWindow): Record<string, string> {
  if (w.custom) return { from: w.from, to: w.to };
  if (w.key === DEFAULT_DATE_WINDOW_KEY) return {};
  return { range: w.key };
}

// "?range=3d" / "?from=…&to=…" / "" — appended to the LeadGen tab links.
export function dateWindowSuffix(w: DateWindow): string {
  const qs = new URLSearchParams(dateWindowParams(w)).toString();
  return qs === "" ? "" : `?${qs}`;
}

// The window one step back / forward: moved by its own length. Forward stops
// at today (a window that would run past today ends today instead); null
// when the window already ends today.
export function shiftDateWindow(w: DateWindow, direction: -1): { from: string; to: string };
export function shiftDateWindow(w: DateWindow, direction: 1): { from: string; to: string } | null;
export function shiftDateWindow(w: DateWindow, direction: -1 | 1): { from: string; to: string } | null {
  const days = lengthInDays(w.from, w.to);
  if (direction === -1) {
    return { from: addDays(w.from, -days), to: addDays(w.to, -days) };
  }
  if (w.to >= w.today) return null;
  let to = addDays(w.to, days);
  if (to > w.today) to = w.today;
  return { from: addDays(to, -(days - 1)), to };
}

function hrefWith(current: URLSearchParams, set: Record<string, string>): string {
  const next = new URLSearchParams(current);
  for (const name of OWN_PARAMS) next.delete(name);
  for (const name of Object.keys(set)) next.set(name, set[name] as string);
  const qs = next.toString();
  return qs === "" ? "?" : `?${qs}`;
}

// The control: "‹", the date button, "›", and the (hidden) panel.
// `current` is the page's own query string, so the links keep search and
// filters.
export function renderDateWindowControl(w: DateWindow, current: URLSearchParams): string {
  const prev = shiftDateWindow(w, -1);
  const next = shiftDateWindow(w, 1);
  const prevHtml = `<a class="btn btn-secondary btn-sm lg-dw-arrow" href="${escapeHtml(hrefWith(current, prev))}" aria-label="Previous period" data-lg-dw-prev>‹</a>`;
  const nextHtml = next
    ? `<a class="btn btn-secondary btn-sm lg-dw-arrow" href="${escapeHtml(hrefWith(current, next))}" aria-label="Next period" data-lg-dw-next>›</a>`
    : `<button type="button" class="btn btn-secondary btn-sm lg-dw-arrow" aria-label="Next period" disabled data-lg-dw-next>›</button>`;
  const presets = PRESETS.map((p) => {
    const active = w.key === p.key; // also when From / To are exactly this preset's days
    const cls = active ? "btn btn-primary btn-sm" : "btn btn-outline btn-sm";
    const current_ = active ? ' aria-current="true"' : "";
    return `<a class="${cls}" href="${escapeHtml(hrefWith(current, { range: p.key }))}" data-lg-dw-preset="${p.key}"${current_}>${escapeHtml(p.label)}</a>`;
  }).join("");
  return `<div class="lg-dw" data-lg-dw data-lg-dw-today="${escapeHtml(w.today)}" data-lg-dw-max-days="${MAX_DATE_WINDOW_DAYS}">
    ${prevHtml}<button type="button" class="lg-dw-toggle" aria-haspopup="dialog" aria-expanded="false" aria-controls="lg-dw-panel" aria-label="Dates: ${escapeHtml(w.label)}" data-lg-dw-toggle><span class="lg-dw-label">${escapeHtml(w.label)}</span><span class="lg-dw-caret" aria-hidden="true">▾</span></button>${nextHtml}
    <div class="lg-dw-panel" id="lg-dw-panel" role="dialog" aria-label="Choose dates" data-lg-dw-panel hidden>
      <div class="lg-dw-presets">${presets}</div>
      <div class="lg-dw-dates">
        <div class="lg-dw-field"><label class="form-label" for="lg-dw-from">From</label><input type="date" id="lg-dw-from" class="form-input" value="${escapeHtml(w.from)}" max="${escapeHtml(w.today)}" data-lg-dw-from /></div>
        <div class="lg-dw-field"><label class="form-label" for="lg-dw-to">To</label><input type="date" id="lg-dw-to" class="form-input" value="${escapeHtml(w.to)}" max="${escapeHtml(w.today)}" data-lg-dw-to /></div>
      </div>
      <p class="form-help">Dates are in UTC.</p>
      <p class="form-error" role="alert" data-lg-dw-error hidden></p>
      <div class="lg-dw-actions"><button type="button" class="btn btn-secondary btn-sm" data-lg-dw-cancel>Cancel</button><button type="button" class="btn btn-primary btn-sm" data-lg-dw-apply>Apply</button></div>
    </div>
  </div>`;
}

// For a toolbar that is a GET <form> (Auction): pressing Enter in its search
// box submits only the form's own fields, so the window rides along as
// hidden inputs.
export function renderDateWindowHiddenInputs(w: DateWindow): string {
  const params = dateWindowParams(w);
  return Object.keys(params)
    .map((name) => `<input type="hidden" name="${name}" value="${escapeHtml(params[name] as string)}" />`)
    .join("");
}

export const LG_DATE_WINDOW_STYLES = `
.lg-dw{position:relative;display:flex;align-items:stretch;gap:4px}
.lg-dw-arrow{justify-content:center;min-width:36px;font-size:16px;line-height:1}
.lg-dw-arrow:disabled{opacity:.45;cursor:not-allowed}
.lg-dw-toggle{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;font-size:14px;font-family:inherit;line-height:1.4;color:var(--c-text);background:var(--c-bg);border:1px solid var(--c-border);border-radius:6px;cursor:pointer;white-space:nowrap}
.lg-dw-toggle:focus{outline:none;border-color:var(--c-primary);box-shadow:0 0 0 3px var(--c-primary-light)}
.lg-dw-caret{color:var(--c-muted);font-size:12px}
.lg-dw-panel{position:absolute;top:calc(100% + 4px);left:0;z-index:40;width:340px;max-width:calc(100vw - 32px);background:#fff;border:1px solid var(--c-border);border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,0.12);padding:12px}
.lg-dw-panel.lg-dw-panel--right{left:auto;right:0}
.lg-dw-panel[hidden]{display:none}
.lg-dw-presets{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.lg-dw-dates{display:flex;gap:8px}
.lg-dw-field{flex:1;min-width:0}
.lg-dw-field .form-label{font-size:12px;margin-bottom:4px}
.lg-dw-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
@media (max-width:480px){.lg-dw{width:100%}.lg-dw-toggle{flex:1;min-width:0;justify-content:space-between}.lg-dw-label{overflow:hidden;text-overflow:ellipsis}.lg-dw-panel{left:0;right:0;width:auto;max-width:none}}
`;

// Panel open/close + "Apply" (strict ES5 — no backslashes either: this is a
// TS template literal, so the date check uses [0-9] instead of \\d).
export const LG_DATE_WINDOW_SCRIPT = `
(function () {
  var root = document.querySelector('[data-lg-dw]');
  if (!root) { return; }
  var toggle = root.querySelector('[data-lg-dw-toggle]');
  var panel = root.querySelector('[data-lg-dw-panel]');
  var fromInput = root.querySelector('[data-lg-dw-from]');
  var toInput = root.querySelector('[data-lg-dw-to]');
  var errorBox = root.querySelector('[data-lg-dw-error]');
  var applyBtn = root.querySelector('[data-lg-dw-apply]');
  var cancelBtn = root.querySelector('[data-lg-dw-cancel]');
  if (!toggle || !panel || !fromInput || !toInput || !errorBox || !applyBtn || !cancelBtn) { return; }
  // The page's UTC "today", moved forward if the page stayed open past
  // midnight UTC (the server resolves each request with its own clock).
  var today = root.getAttribute('data-lg-dw-today') || '';
  var maxDays = Number(root.getAttribute('data-lg-dw-max-days')) || 0;
  function currentToday() {
    var now = new Date().toISOString().slice(0, 10);
    return now > today ? now : today;
  }
  function spanDays(from, to) {
    return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1;
  }
  var startFrom = fromInput.value;
  var startTo = toInput.value;
  var DAY_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
  function showError(text) { errorBox.textContent = text; errorBox.hidden = false; }
  function clearError() { errorBox.textContent = ''; errorBox.hidden = true; }
  function isOpen() { return !panel.hidden; }
  function openPanel() {
    var max = currentToday();
    fromInput.setAttribute('max', max);
    toInput.setAttribute('max', max);
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    panel.classList.remove('lg-dw-panel--right');
    var box = panel.getBoundingClientRect();
    var viewport = window.innerWidth || document.documentElement.clientWidth || 0;
    if (viewport && box.right > viewport - 8) { panel.classList.add('lg-dw-panel--right'); }
    var first = panel.querySelector('[aria-current="true"]') || fromInput;
    if (first && first.focus) { first.focus(); }
  }
  function closePanel(restoreFocus) {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    fromInput.value = startFrom;
    toInput.value = startTo;
    clearError();
    if (restoreFocus) { toggle.focus(); }
  }
  function applyDates() {
    var from = fromInput.value;
    var to = toInput.value;
    if (!DAY_RE.test(from) || !DAY_RE.test(to)) { showError('Pick both a From and a To date.'); return; }
    if (from > to) { showError('From must be on or before To.'); return; }
    if (to > currentToday()) { showError('To must be today or earlier (UTC).'); return; }
    if (maxDays && spanDays(from, to) > maxDays) { showError('Pick at most ' + maxDays + ' days.'); return; }
    var url = new URL(window.location.href);
    url.searchParams.delete('page');
    url.searchParams.delete('range');
    url.searchParams.set('from', from);
    url.searchParams.set('to', to);
    window.location.href = url.toString();
  }
  function onDateKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); applyDates(); }
  }
  toggle.addEventListener('click', function () {
    if (isOpen()) { closePanel(false); } else { openPanel(); }
  });
  applyBtn.addEventListener('click', applyDates);
  cancelBtn.addEventListener('click', function () { closePanel(true); });
  fromInput.addEventListener('keydown', onDateKey);
  toInput.addEventListener('keydown', onDateKey);
  document.addEventListener('click', function (e) {
    if (isOpen() && !root.contains(e.target)) { closePanel(false); }
  });
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Escape' || e.key === 'Esc') && isOpen()) { closePanel(true); }
  });
}());
`;
