// §13 Offer-selection modal — THE single reusable component enforcing
// "no free-text URL". Triggers (Phase 4): the clickable-headline toggle, the
// inline-link toolbar action, the button / choice-button / linked-image /
// final-CTA offer fields, and the CTA-inventory replace/bulk-replace actions.
//
// Anatomy (contract §13): debounced search over name/provider/vertical/
// activity → GET /api/admin/listicles/offers/search?q= (active-only, ≤50);
// quick filters + recently-used pinned (localStorage, ES5); compact result
// rows (name · provider · vertical · payout · Select); "＋ New Offer" opens
// the Phase-3 Create-Offer modal inline and returns the created offer
// pre-selected; keyboard: search focus → ↑/↓ → Enter selects → Esc closes.
//
// The component returns ONLY an Offer reference ({id, public_id, offer_name,
// …}) through opts.onSelect — it has no URL input and never produces one.
//
// Inline script is strict ES5 (var-only, DOM built via createElement) —
// asserted by test/listicles-editor-es5.test.ts.

export function renderOfferPickerModal(): string {
  return `<div id="lst-offer-picker" class="modal hidden" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="lst-offer-picker-title" aria-hidden="true">
  <div class="modal-content lst-picker-content">
    <h2 id="lst-offer-picker-title" class="modal-title">Choose an Offer</h2>
    <div class="lst-picker-searchrow">
      <input id="lst-offer-picker-search" type="search" class="form-input" placeholder="Search offers by name, provider, vertical, activity…" autocomplete="off" aria-label="Search offers" />
      <button type="button" id="lst-offer-picker-new" class="btn btn-secondary">＋ New Offer</button>
    </div>
    <div class="lst-picker-filters" role="group" aria-label="Quick filters">
      <select id="lst-picker-filter-provider" class="form-select" aria-label="Filter by provider"><option value="">All providers</option></select>
      <select id="lst-picker-filter-vertical" class="form-select" aria-label="Filter by vertical"><option value="">All verticals</option></select>
      <select id="lst-picker-filter-activity" class="form-select" aria-label="Filter by activity"><option value="">All activities</option></select>
    </div>
    <p id="lst-offer-picker-status" class="form-status" role="status" aria-live="polite"></p>
    <div id="lst-offer-picker-results" class="lst-picker-results" role="listbox" aria-label="Offer results"></div>
    <div class="modal-actions">
      <button type="button" id="lst-offer-picker-cancel" class="btn btn-secondary">Cancel</button>
    </div>
  </div>
</div>`;
}

export const OFFER_PICKER_STYLES = `
.lst-picker-content{max-width:560px}
.lst-picker-searchrow{display:flex;gap:8px;margin-bottom:8px}
.lst-picker-searchrow .form-input{flex:1}
.lst-picker-filters{display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap}
.lst-picker-results{border:1px solid var(--c-border);border-radius:6px;max-height:320px;overflow-y:auto;display:flex;flex-direction:column}
.lst-picker-group{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--c-muted);padding:6px 12px 2px;background:var(--c-bg-alt)}
.lst-picker-row{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 12px;border:0;border-bottom:1px solid var(--c-border);background:none;font-size:13px;cursor:pointer}
.lst-picker-row:last-child{border-bottom:0}
.lst-picker-row:hover,.lst-picker-row.active{background:var(--c-bg-alt)}
.lst-picker-row.active{outline:2px solid var(--c-primary);outline-offset:-2px}
.lst-picker-name{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lst-picker-meta{color:var(--c-muted);white-space:nowrap}
.lst-picker-select{color:var(--c-primary);font-weight:600}
.lst-picker-empty{padding:16px;text-align:center;color:var(--c-muted);font-size:13px}
`;

export const OFFER_PICKER_SCRIPT = `
(function () {
  var root = document.getElementById('lst-offer-picker');
  if (!root) { return; }
  var searchInput = document.getElementById('lst-offer-picker-search');
  var resultsEl = document.getElementById('lst-offer-picker-results');
  var statusEl = document.getElementById('lst-offer-picker-status');
  var titleEl = document.getElementById('lst-offer-picker-title');
  var newBtn = document.getElementById('lst-offer-picker-new');
  var cancelBtn = document.getElementById('lst-offer-picker-cancel');
  var filterEls = {
    provider: document.getElementById('lst-picker-filter-provider'),
    vertical: document.getElementById('lst-picker-filter-vertical'),
    activity: document.getElementById('lst-picker-filter-activity')
  };
  var getJson = window.lstUi.getJson;

  var current = null;        // { onSelect, title }
  var offers = [];           // last search results (active-only, <=50)
  var visibleRows = [];      // flattened row metadata for keyboard nav
  var activeIndex = -1;
  var searchTimer = null;
  var requestSeq = 0;

  var RECENT_KEY = 'lst_recent_offers';
  var RECENT_MAX = 8;

  function readRecent() {
    try {
      var raw = window.localStorage.getItem(RECENT_KEY);
      if (!raw) { return []; }
      var parsed = JSON.parse(raw);
      return Object.prototype.toString.call(parsed) === '[object Array]' ? parsed : [];
    } catch (e) { return []; }
  }
  function writeRecent(list) {
    try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) { /* private mode */ }
  }
  function rememberRecent(offer) {
    var list = readRecent();
    var next = [offer];
    var i;
    for (i = 0; i < list.length && next.length < RECENT_MAX; i++) {
      if (list[i] && list[i].public_id !== offer.public_id) { next.push(list[i]); }
    }
    writeRecent(next);
  }

  function setStatus(msg) {
    while (statusEl.firstChild) { statusEl.removeChild(statusEl.firstChild); }
    if (msg) { statusEl.appendChild(document.createTextNode(msg)); }
  }

  function payoutText(o) {
    if (o.payout_method === 'in_site' && (o.payout_value !== null && o.payout_value !== undefined)) {
      return 'In-site \\u00b7 ' + (o.payout_currency || '') + ' ' + o.payout_value;
    }
    return o.payout_method === 'in_site' ? 'In-site' : 'Offsite';
  }

  function filterValue(name) {
    var el = filterEls[name];
    return el && el.value ? el.value : '';
  }

  function passesFilters(o) {
    var p = filterValue('provider');
    var v = filterValue('vertical');
    var a = filterValue('activity');
    if (p && o.provider !== p) { return false; }
    if (v && o.vertical !== v) { return false; }
    if (a && o.activity !== a) { return false; }
    return true;
  }

  function updateFilterOptions() {
    var names = ['provider', 'vertical', 'activity'];
    var n, el, seen, i, o, val, opt, prev;
    for (n = 0; n < names.length; n++) {
      el = filterEls[names[n]];
      if (!el) { continue; }
      prev = el.value;
      while (el.options.length > 1) { el.remove(1); }
      seen = {};
      for (i = 0; i < offers.length; i++) {
        o = offers[i];
        val = o[names[n]];
        if (val && !seen[val]) {
          seen[val] = 1;
          opt = document.createElement('option');
          opt.value = val;
          opt.appendChild(document.createTextNode(val));
          el.appendChild(opt);
        }
      }
      el.value = seen[prev] ? prev : '';
    }
  }

  function pick(offer) {
    rememberRecent({
      id: offer.id,
      public_id: offer.public_id,
      offer_name: offer.offer_name,
      provider: offer.provider,
      vertical: offer.vertical,
      activity: offer.activity,
      payout_method: offer.payout_method,
      payout_currency: offer.payout_currency,
      payout_value: offer.payout_value
    });
    var cb = current && current.onSelect;
    close();
    if (cb) { cb(offer); }
  }

  function makeRow(offer) {
    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'lst-picker-row';
    row.setAttribute('role', 'option');
    row.setAttribute('data-offer-public-id', offer.public_id || '');
    var name = document.createElement('span');
    name.className = 'lst-picker-name';
    name.appendChild(document.createTextNode(offer.offer_name || offer.public_id || ''));
    var meta = document.createElement('span');
    meta.className = 'lst-picker-meta';
    meta.appendChild(document.createTextNode(
      (offer.provider || '') + ' \\u00b7 ' + (offer.vertical || '') + ' \\u00b7 ' + payoutText(offer)
    ));
    var select = document.createElement('span');
    select.className = 'lst-picker-select';
    select.appendChild(document.createTextNode('Select'));
    row.appendChild(name);
    row.appendChild(meta);
    row.appendChild(select);
    row.addEventListener('click', function () { pick(offer); });
    return row;
  }

  function setActive(index) {
    var i;
    for (i = 0; i < visibleRows.length; i++) {
      if (visibleRows[i].el.classList) {
        visibleRows[i].el.classList.toggle('active', i === index);
      }
    }
    activeIndex = index;
    if (index >= 0 && visibleRows[index] && visibleRows[index].el.scrollIntoView) {
      visibleRows[index].el.scrollIntoView({ block: 'nearest' });
    }
  }

  function renderResults() {
    while (resultsEl.firstChild) { resultsEl.removeChild(resultsEl.firstChild); }
    visibleRows = [];
    activeIndex = -1;
    var query = (searchInput.value || '').replace(/^\\s+|\\s+$/g, '');
    var shownIds = {};
    var i, offer, group;

    // Recently-used pinned (§13) — on an empty query, above the results.
    if (query === '') {
      var recent = readRecent();
      var pinned = [];
      for (i = 0; i < recent.length; i++) {
        offer = recent[i];
        if (offer && offer.public_id && passesFilters(offer)) { pinned.push(offer); }
      }
      if (pinned.length > 0) {
        group = document.createElement('div');
        group.className = 'lst-picker-group';
        group.appendChild(document.createTextNode('Recently used'));
        resultsEl.appendChild(group);
        for (i = 0; i < pinned.length; i++) {
          var pinnedRow = makeRow(pinned[i]);
          pinnedRow.setAttribute('data-picker-pinned', '1');
          resultsEl.appendChild(pinnedRow);
          visibleRows.push({ el: pinnedRow, offer: pinned[i] });
          shownIds[pinned[i].public_id] = 1;
        }
      }
    }

    var matches = [];
    for (i = 0; i < offers.length; i++) {
      offer = offers[i];
      if (offer.public_id && shownIds[offer.public_id]) { continue; }
      if (!passesFilters(offer)) { continue; }
      matches.push(offer);
    }
    if (matches.length > 0) {
      group = document.createElement('div');
      group.className = 'lst-picker-group';
      group.appendChild(document.createTextNode(query === '' ? 'Active offers' : 'Results'));
      resultsEl.appendChild(group);
      for (i = 0; i < matches.length; i++) {
        var row = makeRow(matches[i]);
        resultsEl.appendChild(row);
        visibleRows.push({ el: row, offer: matches[i] });
      }
    }

    if (visibleRows.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'lst-picker-empty';
      empty.appendChild(document.createTextNode('No active offers match. Try another search or create a new Offer.'));
      resultsEl.appendChild(empty);
    }
  }

  function runSearch() {
    var q = (searchInput.value || '').replace(/^\\s+|\\s+$/g, '');
    var seq = ++requestSeq;
    setStatus('Searching\\u2026');
    getJson('GET', '/api/admin/listicles/offers/search?q=' + encodeURIComponent(q)).then(function (res) {
      if (seq !== requestSeq) { return; } // a newer search superseded this one
      if (!res.ok || !res.body) {
        setStatus('Search failed');
        offers = [];
        renderResults();
        return;
      }
      offers = res.body.offers || [];
      setStatus(offers.length === 0 ? '' : offers.length + ' active offer' + (offers.length === 1 ? '' : 's'));
      updateFilterOptions();
      renderResults();
    }).catch(function () {
      if (seq !== requestSeq) { return; }
      setStatus('Search failed');
      offers = [];
      renderResults();
    });
  }

  function scheduleSearch() {
    if (searchTimer) { window.clearTimeout(searchTimer); }
    searchTimer = window.setTimeout(runSearch, 250);
  }

  function onKeydown(e) {
    if (root.classList.contains('hidden')) { return; }
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (visibleRows.length > 0) { setActive(Math.min(visibleRows.length - 1, activeIndex + 1)); }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (visibleRows.length > 0) { setActive(Math.max(0, activeIndex - 1)); }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      var index = activeIndex >= 0 ? activeIndex : 0;
      if (visibleRows[index]) { pick(visibleRows[index].offer); }
    }
  }

  function open(opts) {
    current = opts || {};
    if (titleEl) {
      while (titleEl.firstChild) { titleEl.removeChild(titleEl.firstChild); }
      titleEl.appendChild(document.createTextNode(current.title || 'Choose an Offer'));
    }
    searchInput.value = '';
    offers = [];
    setStatus('');
    renderResults();
    root.style.display = 'flex';
    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');
    searchInput.focus();
    runSearch();
  }

  function close() {
    current = null;
    root.style.display = 'none';
    root.classList.add('hidden');
    root.setAttribute('aria-hidden', 'true');
  }

  searchInput.addEventListener('input', scheduleSearch);
  var filterNames = ['provider', 'vertical', 'activity'];
  var fi;
  for (fi = 0; fi < filterNames.length; fi++) {
    (function (el) {
      if (el) { el.addEventListener('change', renderResults); }
    }(filterEls[filterNames[fi]]));
  }
  if (cancelBtn) { cancelBtn.addEventListener('click', close); }
  root.addEventListener('click', function (e) { if (e.target === root) { close(); } });
  // Capture-phase so Escape closes the PICKER only (not underlying dialogs).
  document.addEventListener('keydown', onKeydown, true);

  // §13 "＋ New Offer": open the Phase-3 Create-Offer modal inline; on save
  // the created offer comes back pre-selected through the modal's hook.
  if (newBtn) {
    newBtn.addEventListener('click', function () {
      if (!window.lstOfferModal) {
        if (window.showToast) { window.showToast('The Offer form is not available on this page', 'error'); }
        return;
      }
      var opts = current;
      close();
      window._lstOfferModalOnSaved = function (offer) {
        var cb = opts && opts.onSelect;
        rememberRecent({
          id: offer.id, public_id: offer.public_id, offer_name: offer.offer_name,
          provider: offer.provider, vertical: offer.vertical, activity: offer.activity,
          payout_method: offer.payout_method, payout_currency: offer.payout_currency,
          payout_value: offer.payout_value
        });
        if (cb) { cb(offer); }
      };
      window.lstOfferModal.openCreate();
    });
  }

  window.lstOfferPicker = { open: open, close: close };
}());
`;
