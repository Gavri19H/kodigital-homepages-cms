// F11 — the funnel page's small redirect script (plan Section 3 D/E/H). It
// ships INLINE in the funnel shell (serve.ts), OUTSIDE the visitor bundle
// (runtime/**, which must not change), as old-style JavaScript (ES5: var,
// function, no arrow functions, no template literals — GUARDRAILS L-014).
//
// What it does, and only this:
//   * It notices the redirect screen the auction injected into the banners
//     mount (redirect/screen.ts markup, [data-lg-redirect]) and claims it
//     (data-lg-rd-live: until then the markup is inert, so an old cached shell
//     without this script simply shows today's results).
//   * It runs the countdown: every [data-lg-rd-n] shows the seconds left (the
//     line "Taking you to {brand} in {n}…" is role="status"), and --lg-ra-p
//     carries the elapsed share for the "Reduce motion" still state.
//   * At 0 it sets the hidden redirect mark — the first-party cookie
//     `lg_rc=<brid>.<slot>; Max-Age=30; Path=/; SameSite=Lax; Secure`
//     (redirect/types.ts REDIRECT_MARK_COOKIE) — and THEN calls .click() on
//     the chosen card's own <a class="lg-banner">. The bundle and the shell's
//     own click handling run as for any click: the same link, the same tab,
//     the same Meta event, one counted click. The link is never touched.
//   * A visitor's own click (or middle-click / context menu) on the card first
//     stops the countdown for good and never sets the mark.
//   * "Stay here" / "Show me all offers" (a real <button>) stops the
//     countdown, removes the banner or animation and shows the other cards in
//     order, hiding what the Auction's "Remove clicked offers" says
//     (data-lg-rd-hides: none / offer / carrier). It counts and writes nothing.
//   * Back from the partner's site (a page restored from the back/forward
//     cache) shows today's results page with no countdown, and the card opens
//     by itself at most once per funnel attempt (sessionStorage, keyed by the
//     card's own faid).
//   * The countdown (and the CSS animation) pauses while the tab is hidden.
//
// STATIC: nothing is interpolated into it.

// The source below is indented for reading; the shell ships it with the
// indentation stripped (newlines kept, so statement boundaries never change).
const REDIRECT_PAGE_SCRIPT_SOURCE = `(function (w, d) {
  'use strict';
  if (!d || !d.querySelectorAll) { return; }
  var RUN = 'data-lg-rd-run';
  var seen = {};
  var active = null;
  function now() { return Date.now(); }
  function isHidden() { return d.hidden === true || d.visibilityState === 'hidden'; }
  function store() { try { return w.sessionStorage || null; } catch (e) { return null; } }
  function openedBefore(r) { var s = store(); try { return !!(s && s.getItem('lg_rd:' + r.key)); } catch (e) { return false; } }
  function markOpened(r) { var s = store(); try { if (s) { s.setItem('lg_rd:' + r.key, '1'); } } catch (e) {} }
  function setRun(root, state) {
    root.setAttribute(RUN, state);
    if (state === 'countdown' || state === 'opened' || state === 'clicked') { root.setAttribute('data-lg-rd-live', ''); }
    else { root.removeAttribute('data-lg-rd-live'); }
  }
  function setN(r, n) {
    var ns = r.root.querySelectorAll('[data-lg-rd-n]'), i;
    for (i = 0; i < ns.length; i++) { ns[i].textContent = String(n); }
  }
  function setP(r) {
    var st = r.root.style, p = 1 - r.left / (r.seconds * 1000);
    if (st && st.setProperty) { st.setProperty('--lg-ra-p', String(Math.min(1, Math.max(0, p)))); }
  }
  function clearTimer(r) { if (r.timer !== null) { w.clearTimeout(r.timer); r.timer = null; } }
  function stop(r, state) {
    if (!r.done) { r.done = true; clearTimer(r); r.root.removeAttribute('data-lg-rd-paused'); }
    setRun(r.root, state);
  }
  function fire(r) {
    if (r.done) { return; }
    r.left = 0; setN(r, 0); setP(r);
    stop(r, 'opened');
    markOpened(r);
    if (/^[0-9A-Za-z_-]{1,80}$/.test(r.brid) && /^[0-9]{1,6}$/.test(r.slot)) {
      try { d.cookie = 'lg_rc=' + r.brid + '.' + r.slot + '; Max-Age=30; Path=/; SameSite=Lax; Secure'; } catch (e) {}
    }
    r.self = true;
    try { r.card.click(); } finally { r.self = false; }
  }
  function pause(r) {
    if (r.done || r.paused) { return; }
    var t = now();
    r.left -= t - r.last; r.last = t; r.paused = true;
    clearTimer(r);
    r.root.setAttribute('data-lg-rd-paused', '');
  }
  function tick() {
    var r = active;
    if (!r || r.done) { return; }
    r.timer = null;
    if (isHidden()) { pause(r); return; }
    var t = now();
    r.left -= t - r.last; r.last = t;
    if (r.left <= 0) { fire(r); return; }
    setN(r, Math.ceil(r.left / 1000)); setP(r);
    r.timer = w.setTimeout(tick, Math.min(250, r.left));
  }
  function onVisibility() {
    var r = active;
    if (!r || r.done) { return; }
    if (isHidden()) { pause(r); return; }
    if (!r.paused) { return; }
    r.paused = false; r.last = now();
    r.root.removeAttribute('data-lg-rd-paused');
    tick();
  }
  function clearMark() { try { d.cookie = 'lg_rc=; Max-Age=0; Path=/; SameSite=Lax; Secure'; } catch (e) {} }
  function onCard(r, ev) {
    if (r.self) { return; }
    var t = ev && ev.target;
    if (!t || typeof t.closest !== 'function' || !t.closest('a.lg-banner')) { return; }
    // A visitor's own click is never a redirect click, even if an earlier
    // page click left the mark behind (its navigation never reached /lg/lc).
    clearMark();
    if (r.done) { return; }
    stop(r, 'clicked');
    markOpened(r);
  }
  function stay(r) {
    stop(r, 'stayed');
    var cs = r.root.querySelectorAll('a.lg-banner'), first = null, i, a, hide;
    for (i = 0; i < cs.length; i++) {
      a = cs[i]; hide = false;
      if (r.stayKey !== '' && r.stay === 'offer') { hide = a.getAttribute('data-offer') === r.stayKey; }
      if (r.stayKey !== '' && r.stay === 'carrier') { hide = a.getAttribute('data-carrier-key') === r.stayKey; }
      if (hide) { a.setAttribute('data-lg-rd-hide', ''); } else if (first === null) { first = a; }
    }
    if (first !== null && first.focus) { try { first.focus(); } catch (e) {} }
  }
  function onClick(r, ev) {
    var t = ev && ev.target;
    if (t && typeof t.closest === 'function' && t.closest('[data-lg-rd-stay]')) {
      if (ev.preventDefault) { ev.preventDefault(); }
      stay(r);
      return;
    }
    onCard(r, ev);
  }
  function start(root) {
    if (root.getAttribute(RUN) !== null) { return; }
    var r = {
      root: root,
      seconds: parseInt(root.getAttribute('data-lg-rd-seconds') || '', 10),
      slot: root.getAttribute('data-lg-rd-slot') || '',
      brid: root.getAttribute('data-lg-rd-brid') || '',
      stay: root.getAttribute('data-lg-rd-hides') || 'none',
      stayKey: root.getAttribute('data-lg-rd-hides-key') || '',
      card: root.querySelector('a.lg-banner[data-lg-rd-chosen]'),
      done: false, paused: false, self: false, timer: null, left: 0, last: 0
    };
    r.key = root.getAttribute('data-lg-rd-faid') || r.brid;
    root.addEventListener('click', function (ev) { onClick(r, ev); });
    root.addEventListener('auxclick', function (ev) { onCard(r, ev); });
    root.addEventListener('contextmenu', function (ev) { onCard(r, ev); });
    // A new screen replaces any countdown still running (a re-render): the old
    // one never clicks, and the same attempt never starts a second one.
    if (active !== null && !active.done) { stop(active, 'back'); }
    if (!r.card || !(r.seconds > 0) || seen[r.key] === 1 || openedBefore(r)) { r.done = true; setRun(root, 'back'); return; }
    seen[r.key] = 1;
    active = r;
    r.left = r.seconds * 1000; r.last = now();
    setRun(root, 'countdown');
    setN(r, r.seconds); setP(r);
    if (isHidden()) { r.paused = true; root.setAttribute('data-lg-rd-paused', ''); return; }
    r.timer = w.setTimeout(tick, 250);
  }
  function scan() {
    var roots = d.querySelectorAll('[data-lg-redirect]'), i;
    for (i = 0; i < roots.length; i++) { if (roots[i].getAttribute(RUN) === null) { start(roots[i]); } }
  }
  d.addEventListener('visibilitychange', onVisibility);
  w.addEventListener('pageshow', function (ev) {
    if (!ev || !ev.persisted) { return; }
    clearMark();
    var roots = d.querySelectorAll('[data-lg-redirect]'), i, st;
    for (i = 0; i < roots.length; i++) {
      st = roots[i].getAttribute(RUN);
      if (st === 'countdown' || st === 'opened' || st === 'clicked') {
        if (active !== null && active.root === roots[i]) { stop(active, 'back'); } else { setRun(roots[i], 'back'); }
      }
    }
  });
  var mounts = d.querySelectorAll('[data-lg-banners]'), i;
  // No results mount on this page: no redirect screen can ever appear here.
  if (mounts.length === 0) { return; }
  if (w.MutationObserver) {
    var mo = new w.MutationObserver(scan);
    for (i = 0; i < mounts.length; i++) { mo.observe(mounts[i], { childList: true }); }
  } else {
    w.setInterval(scan, 250);
  }
  scan();
})(window, document);`;

export const REDIRECT_PAGE_SCRIPT = REDIRECT_PAGE_SCRIPT_SOURCE.replace(/\n[ ]+/g, "\n");
