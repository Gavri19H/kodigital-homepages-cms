// Listicles admin UI — Offers tab (design contract §8 / §9 / §13 / §23 / §26).
//
// Fully functional this phase: toolbar (+ Create an Offer → modal, search,
// provider·vertical·activity·status filters, timeframe), the §9 management
// table (Offer name · Provider · Vertical · Activity · Tracking method ·
// Payout · Cap · Status) + after-paint-hydrated analytics columns
// (impressions · clicks · unique_clicks · conversions · ctr · cvr · revenue ·
// rpc · rpm), row actions (Edit · Delete · View attribution to Sections ·
// Analytics), renderListPager pagination, and the Create/Edit modal with the
// 32 §9.4 macro chips, {clickid}→{click_id} normalization feedback, In-site
// and cap conditional reveals, the /offers/search-fed cap-fallback picker
// (§13 search behavior), §23-mirroring client validation (server stays
// authoritative — its field-keyed errors render inline), the 409 in-use
// dialog with "Archive instead", and the beforeunload dirty guard (§8).
//
// Inline scripts are strict ES5 — asserted by test/listicles-ui-es5.test.ts.

import {
  adminLayout,
  escapeHtml,
  renderListPager,
  listFilterScript,
} from "../templates/layout";
import { CANONICAL_MACROS } from "../../listicles/macros";
import {
  TRACKING_METHODS,
  PAYOUT_METHODS,
  OFFER_STATUSES,
  CAP_COUNT_BY,
} from "../../listicles/validation";
import type { OfferRow } from "./offers-handlers";
import type { Paging } from "./shared";
import {
  renderListiclesTabs,
  renderTimeframeSelect,
  renderDialogShell,
  renderAnalyticsHeaderCells,
  renderAnalyticsSkeletonCells,
  ENTITY_ANALYTICS_COLUMNS,
  statusBadgeClass,
  LISTICLES_STYLES,
  LST_SHARED_SCRIPT,
  type Timeframe,
} from "./ui-shared";

export interface OffersPageFilters {
  search: string;
  provider: string;
  vertical: string;
  activity: string;
  status: string;
  range: string;
}

export interface OffersFilterOptions {
  providers: ReadonlyArray<string>;
  verticals: ReadonlyArray<string>;
  activities: ReadonlyArray<string>;
}

export interface OffersPageProps {
  offers: ReadonlyArray<OfferRow>;
  paging: Paging;
  filters: OffersPageFilters;
  filterOptions: OffersFilterOptions;
  timeframe: Timeframe;
  loadError: string | null;
}

export interface ListiclesBranding {
  userEmail?: string;
  conversionsUiEnabled?: boolean;
}

// UI labels for the §9 enums (values are the validation.ts wire literals).
const TRACKING_METHOD_LABELS: Readonly<Record<string, string>> = {
  s2s_postback: "S2S postback",
  browser_side_pixel: "Browser-side pixel",
  script: "Script",
};

const PAYOUT_METHOD_LABELS: Readonly<Record<string, string>> = {
  in_site: "In-site",
  offsite: "Offsite",
};

const CAP_COUNT_BY_LABELS: Readonly<Record<string, string>> = {
  clicks: "Clicks",
  conversions: "Conversions",
};

// Curated IANA timezone choices for the cap window (§9; server accepts any
// non-empty string, so this list is a UI convenience, not a contract).
const CAP_TIMEZONES: ReadonlyArray<string> = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Jerusalem",
];

const PAYOUT_CURRENCIES: ReadonlyArray<string> = ["USD", "EUR", "GBP", "ILS"];

function options(
  values: ReadonlyArray<string>,
  labels: Readonly<Record<string, string>> | null,
  selected: string,
  blankLabel: string | null,
): string {
  const blank =
    blankLabel !== null ? `<option value="">${escapeHtml(blankLabel)}</option>` : "";
  const opts = values
    .map((v) => {
      const sel = v === selected ? " selected" : "";
      const label = labels !== null && labels[v] !== undefined ? labels[v] : v;
      return `<option value="${escapeHtml(v)}"${sel}>${escapeHtml(label)}</option>`;
    })
    .join("");
  return blank + opts;
}

// §9 toolbar: + Create an Offer FIRST (top-left, opens the modal — no
// navigation), then search, then filters, then the timeframe select.
function renderToolbar(props: OffersPageProps): string {
  const f = props.filters;
  const o = props.filterOptions;
  return `<div class="toolbar">
  <button type="button" class="btn btn-primary" data-open-offer-modal>+ Create an Offer</button>
  <div class="toolbar-search"><input type="search" name="search" class="form-input" placeholder="Search offers…" value="${escapeHtml(f.search)}" aria-label="Search offers" /></div>
  <div class="toolbar-filters">
    <select name="provider" class="form-select" aria-label="Provider filter">${options(o.providers, null, f.provider, "All providers")}</select>
    <select name="vertical" class="form-select" aria-label="Vertical filter">${options(o.verticals, null, f.vertical, "All verticals")}</select>
    <select name="activity" class="form-select" aria-label="Activity filter">${options(o.activities, null, f.activity, "All activities")}</select>
    <select name="status" class="form-select" aria-label="Status filter">${options(OFFER_STATUSES, null, f.status, "All statuses")}</select>
    ${renderTimeframeSelect(props.timeframe.key)}
  </div>
</div>`;
}

function payoutCell(o: OfferRow): string {
  const label = PAYOUT_METHOD_LABELS[o.payout_method] ?? o.payout_method;
  if (o.payout_method === "in_site" && o.payout_value !== null) {
    const currency = o.payout_currency ?? "";
    return escapeHtml(`${label} · ${currency} ${o.payout_value}`);
  }
  return escapeHtml(label);
}

function capCell(o: OfferRow): string {
  if (o.cap_enabled !== 1) return "—";
  const parts = [
    `${o.cap_amount ?? "?"} ${o.cap_count_by ?? ""}`.trim(),
    o.cap_timezone ?? "",
  ].filter((p) => p !== "");
  const fallback =
    o.cap_fallback_offer_id !== null || o.cap_fallback_url !== null
      ? " · fallback set"
      : "";
  return escapeHtml(parts.join(" · ") + fallback);
}

function renderOfferRow(o: OfferRow): string {
  const name = escapeHtml(o.offer_name);
  return `<tr data-entity-id="${o.id}" data-entity-name="${name}" data-offer-public-id="${escapeHtml(o.public_id)}">
  <td>${name}</td>
  <td>${escapeHtml(o.provider)}</td>
  <td>${escapeHtml(o.vertical)}</td>
  <td>${escapeHtml(o.activity)}</td>
  <td>${escapeHtml(TRACKING_METHOD_LABELS[o.conversion_tracking_method] ?? o.conversion_tracking_method)}</td>
  <td>${payoutCell(o)}</td>
  <td>${capCell(o)}</td>
  <td><span class="${statusBadgeClass(o.status)}">${escapeHtml(o.status)}</span></td>
  ${renderAnalyticsSkeletonCells(ENTITY_ANALYTICS_COLUMNS)}
  <td><div class="table-actions">
    <button type="button" class="btn btn-sm btn-secondary" data-offer-edit="${o.id}">Edit</button>
    <button type="button" class="btn btn-sm btn-danger" data-offer-delete="${o.id}" data-offer-name="${name}">Delete</button>
    <button type="button" class="btn btn-sm btn-outline" data-offer-attribution="${o.id}" data-offer-name="${name}" title="View attribution to Sections">Attribution to Sections</button>
    <button type="button" class="btn btn-sm btn-outline" data-lst-analytics-action>Analytics</button>
  </div></td>
</tr>`;
}

const OFFER_COLUMN_COUNT = 8 + ENTITY_ANALYTICS_COLUMNS.length + 1;

function renderEmptyRow(hasActiveFilters: boolean): string {
  const inner = hasActiveFilters
    ? `<div class="empty-state"><p>No offers match the current filters.</p></div>`
    : `<div class="empty-state"><p>No offers yet.</p><button type="button" class="btn btn-primary" data-open-offer-modal>+ Create an Offer</button></div>`;
  return `<tr><td colspan="${OFFER_COLUMN_COUNT}">${inner}</td></tr>`;
}

function renderOffersTable(props: OffersPageProps): string {
  const f = props.filters;
  const hasActiveFilters =
    f.search !== "" || f.provider !== "" || f.vertical !== "" ||
    f.activity !== "" || f.status !== "";
  const rows =
    props.offers.length === 0
      ? renderEmptyRow(hasActiveFilters)
      : props.offers.map(renderOfferRow).join("");
  return `<div class="card">
  <div class="table-wrapper">
    <table class="table offers-list" aria-label="Offers list"
      data-lst-analytics
      data-analytics-url-prefix="/api/admin/listicles/offers/"
      data-analytics-from="${escapeHtml(props.timeframe.from)}"
      data-analytics-to="${escapeHtml(props.timeframe.to)}">
      <thead><tr>
        <th scope="col">Offer name</th>
        <th scope="col">Provider</th>
        <th scope="col">Vertical</th>
        <th scope="col">Activity</th>
        <th scope="col">Tracking method</th>
        <th scope="col">Payout</th>
        <th scope="col">Cap</th>
        <th scope="col">Status</th>
        ${renderAnalyticsHeaderCells(ENTITY_ANALYTICS_COLUMNS)}
        <th scope="col">Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>`;
}

function fieldError(name: string): string {
  return `<span class="form-error" data-error-for="${name}" hidden></span>`;
}

// §9.4: clickable macro chips — one per CANONICAL macro (32), rendered from
// the registry module so the UI can never drift from the validator.
function renderMacroChips(): string {
  const chips = CANONICAL_MACROS.map(
    (m) =>
      `<button type="button" class="macro-chip" data-macro="${escapeHtml(m)}">{${escapeHtml(m)}}</button>`,
  ).join("");
  return `<div class="macro-chips" id="offer-macro-chips" role="group" aria-label="Insert URL macro">${chips}</div>`;
}

// §9 Create/Edit Offer modal. EXPORTED (Phase 4): the Section editor embeds
// the same modal so the §13 Offer picker's "＋ New Offer" opens THIS form
// inline and returns the created offer pre-selected (no duplicated form).
export function renderOfferModal(): string {
  return `<div id="offer-modal" class="modal hidden" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="offer-modal-title" aria-hidden="true">
  <div class="modal-content">
    <h2 id="offer-modal-title" class="modal-title">Create an Offer</h2>
    <form id="offer-form" novalidate>
      <p id="offer-modal-error" class="alert alert-error" hidden role="alert"></p>
      <p id="offer-modal-status" class="form-status" role="status" aria-live="polite"></p>
      <div class="form-group">
        <label for="offer-name" class="form-label">Offer name *</label>
        <input id="offer-name" name="offer_name" type="text" class="form-input" required aria-required="true" />
        ${fieldError("offer_name")}
      </div>
      <div class="form-group">
        <label for="offer-provider" class="form-label">Provider *</label>
        <input id="offer-provider" name="provider" type="text" class="form-input" required aria-required="true" />
        ${fieldError("provider")}
      </div>
      <div class="form-group">
        <label for="offer-activity" class="form-label">Activity *</label>
        <input id="offer-activity" name="activity" type="text" class="form-input" required aria-required="true" />
        ${fieldError("activity")}
      </div>
      <div class="form-group">
        <label for="offer-vertical" class="form-label">Vertical *</label>
        <input id="offer-vertical" name="vertical" type="text" class="form-input" required aria-required="true" />
        ${fieldError("vertical")}
      </div>
      <div class="form-group">
        <label for="offer-tag" class="form-label">Tag</label>
        <input id="offer-tag" name="tag" type="text" class="form-input" />
        ${fieldError("tag")}
      </div>
      <div class="form-group">
        <label for="offer-tracking-method" class="form-label">Conversion tracking method *</label>
        <select id="offer-tracking-method" name="conversion_tracking_method" class="form-select" required aria-required="true">
          ${options(TRACKING_METHODS, TRACKING_METHOD_LABELS, "", "Choose a tracking method…")}
        </select>
        ${fieldError("conversion_tracking_method")}
      </div>
      <div class="form-group">
        <label for="offer-url-template" class="form-label">Offer URL template *</label>
        <textarea id="offer-url-template" name="offer_url_template" class="form-textarea" rows="2" required aria-required="true" placeholder="https://provider.example/c?cid={click_id}&amp;src={utm_source}"></textarea>
        <span id="offer-url-normalize-note" class="form-help" hidden>{clickid} is an accepted alias — it will be normalized to {click_id} on save.</span>
        <span id="offer-url-unknown-warn" class="form-error" hidden></span>
        ${fieldError("offer_url_template")}
        ${renderMacroChips()}
      </div>
      <div class="form-group">
        <label for="offer-payout-method" class="form-label">Payout method *</label>
        <select id="offer-payout-method" name="payout_method" class="form-select" required aria-required="true">
          ${options(PAYOUT_METHODS, PAYOUT_METHOD_LABELS, "", "Choose a payout method…")}
        </select>
        ${fieldError("payout_method")}
      </div>
      <div id="offer-payout-conditional" hidden>
        <div class="form-group">
          <label for="offer-payout-currency" class="form-label">Payout currency *</label>
          <select id="offer-payout-currency" name="payout_currency" class="form-select">
            ${options(PAYOUT_CURRENCIES, null, "", "Choose a currency…")}
          </select>
          ${fieldError("payout_currency")}
        </div>
        <div class="form-group">
          <label for="offer-payout-value" class="form-label">Payout value *</label>
          <input id="offer-payout-value" name="payout_value" type="number" step="0.01" min="0" class="form-input" />
          ${fieldError("payout_value")}
        </div>
      </div>
      <div class="form-group">
        <label for="offer-cap-enabled" class="form-label"><input id="offer-cap-enabled" name="cap_enabled" type="checkbox" value="1" /> Enable offer cap</label>
        ${fieldError("cap_enabled")}
      </div>
      <div id="offer-cap-conditional" hidden>
        <div class="form-group">
          <label for="offer-cap-amount" class="form-label">Cap amount *</label>
          <input id="offer-cap-amount" name="cap_amount" type="number" step="1" min="1" class="form-input" />
          ${fieldError("cap_amount")}
        </div>
        <div class="form-group">
          <label for="offer-cap-timezone" class="form-label">Cap timezone *</label>
          <select id="offer-cap-timezone" name="cap_timezone" class="form-select">
            ${options(CAP_TIMEZONES, null, "", "Choose a timezone…")}
          </select>
          ${fieldError("cap_timezone")}
        </div>
        <div class="form-group">
          <label for="offer-cap-count-by" class="form-label">Count cap by *</label>
          <select id="offer-cap-count-by" name="cap_count_by" class="form-select">
            ${options(CAP_COUNT_BY, CAP_COUNT_BY_LABELS, "", "Choose…")}
          </select>
          ${fieldError("cap_count_by")}
        </div>
        <fieldset class="form-group">
          <legend class="form-label">When capped, fall back to…</legend>
          <label for="offer-fallback-search" class="form-label">Fallback offer</label>
          <input id="offer-fallback-search" type="search" class="form-input" placeholder="Search active offers…" autocomplete="off" aria-label="Search fallback offers" />
          <div id="offer-fallback-results" class="lst-fallback-results" hidden></div>
          <p id="offer-fallback-selected" class="lst-fallback-selected" hidden></p>
          <input type="hidden" id="offer-cap-fallback-offer-id" name="cap_fallback_offer_id" value="" />
          ${fieldError("cap_fallback_offer_id")}
          <label for="offer-cap-fallback-url" class="form-label">Fallback URL (optional)</label>
          <input id="offer-cap-fallback-url" name="cap_fallback_url" type="text" class="form-input" placeholder="https://… or /path" />
          ${fieldError("cap_fallback_url")}
        </fieldset>
      </div>
      <div class="form-group" id="offer-status-group" hidden>
        <label for="offer-status" class="form-label">Status</label>
        <select id="offer-status" name="status" class="form-select">
          ${options(OFFER_STATUSES, null, "active", null)}
        </select>
        ${fieldError("status")}
      </div>
      <div class="modal-actions">
        <button type="submit" id="offer-modal-save" class="btn btn-primary">Save Offer</button>
        <button type="button" id="offer-modal-cancel" class="btn btn-secondary">Cancel</button>
      </div>
    </form>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Offer modal inline script (strict ES5) — EXPORTED (Phase 4)
// ---------------------------------------------------------------------------
// The Create/Edit-Offer modal machinery, shared by the Offers page and the
// Section editor (§13 "＋ New Offer" inline). Exposes
// window.lstOfferModal = { openCreate, openEdit }. When
// window._lstOfferModalOnSaved is set (the §13 picker sets it), a successful
// CREATE calls that hook with the created offer instead of reloading.

export const OFFER_MODAL_SCRIPT = `
(function () {
  var modal = document.getElementById('offer-modal');
  var form = document.getElementById('offer-form');
  if (!modal || !form) { return; }
  var saveBtn = document.getElementById('offer-modal-save');
  var cancelBtn = document.getElementById('offer-modal-cancel');
  var errEl = document.getElementById('offer-modal-error');
  var statusEl = document.getElementById('offer-modal-status');
  var titleEl = document.getElementById('offer-modal-title');
  var urlInput = document.getElementById('offer-url-template');
  var normalizeNote = document.getElementById('offer-url-normalize-note');
  var unknownWarn = document.getElementById('offer-url-unknown-warn');
  var payoutSelect = document.getElementById('offer-payout-method');
  var payoutConditional = document.getElementById('offer-payout-conditional');
  var capToggle = document.getElementById('offer-cap-enabled');
  var capConditional = document.getElementById('offer-cap-conditional');
  var fallbackSearch = document.getElementById('offer-fallback-search');
  var fallbackResults = document.getElementById('offer-fallback-results');
  var fallbackSelected = document.getElementById('offer-fallback-selected');
  var fallbackIdInput = document.getElementById('offer-cap-fallback-offer-id');
  var statusGroup = document.getElementById('offer-status-group');
  var getJson = window.lstUi.getJson;
  var mode = 'create';
  var editingId = '';
  var dirty = false;

  function fieldByName(name) { return form.querySelector('[name="' + name + '"]'); }
  function setTopError(msg) { if (errEl) { errEl.hidden = !msg; errEl.textContent = msg || ''; } }
  function setStatus(msg) { if (statusEl) { statusEl.textContent = msg || ''; } }
  function setFieldError(name, message) {
    var el = form.querySelector('[data-error-for="' + name + '"]');
    if (el) { el.hidden = !message; el.textContent = message || ''; }
  }
  function clearFieldErrors() {
    var els = form.querySelectorAll('.form-error');
    var i;
    for (i = 0; i < els.length; i++) { els[i].hidden = true; els[i].textContent = ''; }
  }

  // --- macro chips + {clickid} normalization feedback (§9.4) ---------------
  function knownMacroSet() {
    var chips = document.querySelectorAll('#offer-macro-chips .macro-chip');
    var set = { clickid: 1 }; // accepted alias — normalized on save
    var i, m;
    for (i = 0; i < chips.length; i++) {
      m = chips[i].getAttribute('data-macro');
      if (m) { set[m] = 1; }
    }
    return set;
  }
  function unknownMacrosIn(value) {
    var known = knownMacroSet();
    var unknown = [];
    String(value).replace(/\\{([a-zA-Z0-9_]+)\\}/g, function (token, name) {
      if (!known[name] && unknown.indexOf(name) === -1) { unknown.push(name); }
      return token;
    });
    return unknown;
  }
  function macroFeedback() {
    if (!urlInput) { return []; }
    var value = urlInput.value || '';
    if (normalizeNote) { normalizeNote.hidden = value.indexOf('{clickid}') === -1; }
    var unknown = unknownMacrosIn(value);
    if (unknownWarn) {
      if (unknown.length > 0) {
        unknownWarn.hidden = false;
        unknownWarn.textContent = 'Unknown macros: {' + unknown.join('}, {') + '} — the macro registry rejects these on save.';
      } else {
        unknownWarn.hidden = true;
        unknownWarn.textContent = '';
      }
    }
    return unknown;
  }
  function insertAtCaret(input, text) {
    var start = input.selectionStart;
    var end = input.selectionEnd;
    var v = input.value;
    if (typeof start === 'number' && typeof end === 'number') {
      input.value = v.slice(0, start) + text + v.slice(end);
      var pos = start + text.length;
      input.selectionStart = pos;
      input.selectionEnd = pos;
    } else {
      input.value = v + text;
    }
    input.focus();
  }
  var chipsEl = document.getElementById('offer-macro-chips');
  if (chipsEl) {
    chipsEl.addEventListener('click', function (e) {
      var chip = e.target && e.target.closest ? e.target.closest('.macro-chip') : null;
      if (!chip || !urlInput) { return; }
      insertAtCaret(urlInput, '{' + chip.getAttribute('data-macro') + '}');
      dirty = true;
      macroFeedback();
    });
  }
  if (urlInput) { urlInput.addEventListener('input', macroFeedback); }

  // --- conditional reveals (§9/§23) ----------------------------------------
  function setRequired(name, required) {
    var el = fieldByName(name);
    if (!el) { return; }
    if (required) { el.setAttribute('required', ''); el.setAttribute('aria-required', 'true'); }
    else { el.removeAttribute('required'); el.setAttribute('aria-required', 'false'); }
  }
  function applyPayoutState() {
    var inSite = payoutSelect && payoutSelect.value === 'in_site';
    if (payoutConditional) { payoutConditional.hidden = !inSite; }
    setRequired('payout_currency', !!inSite);
    setRequired('payout_value', !!inSite);
  }
  function applyCapState() {
    var capped = !!(capToggle && capToggle.checked);
    if (capConditional) { capConditional.hidden = !capped; }
    setRequired('cap_amount', capped);
    setRequired('cap_timezone', capped);
    setRequired('cap_count_by', capped);
  }
  if (payoutSelect) { payoutSelect.addEventListener('change', applyPayoutState); }
  if (capToggle) { capToggle.addEventListener('change', applyCapState); }

  // --- cap fallback offer picker (fed by /offers/search, §13 behavior) -----
  function clearFallbackResults() {
    if (!fallbackResults) { return; }
    while (fallbackResults.firstChild) { fallbackResults.removeChild(fallbackResults.firstChild); }
    fallbackResults.hidden = true;
  }
  function selectFallback(id, label) {
    if (fallbackIdInput) { fallbackIdInput.value = id ? String(id) : ''; }
    if (fallbackSelected) {
      while (fallbackSelected.firstChild) { fallbackSelected.removeChild(fallbackSelected.firstChild); }
      if (label) {
        fallbackSelected.appendChild(document.createTextNode('Fallback offer: ' + label + ' '));
        var clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'btn btn-sm btn-outline';
        clearBtn.setAttribute('data-fallback-clear', '');
        clearBtn.appendChild(document.createTextNode('Clear'));
        fallbackSelected.appendChild(clearBtn);
        fallbackSelected.hidden = false;
      } else {
        fallbackSelected.hidden = true;
      }
    }
    clearFallbackResults();
  }
  var searchTimer = null;
  function runFallbackSearch() {
    if (!fallbackSearch || !fallbackResults) { return; }
    var q = fallbackSearch.value || '';
    getJson('GET', '/api/admin/listicles/offers/search?q=' + encodeURIComponent(q)).then(function (res) {
      clearFallbackResults();
      if (!res.ok || !res.body) { return; }
      var offers = res.body.offers || [];
      var i, o, btn;
      var shown = 0;
      for (i = 0; i < offers.length && shown < 8; i++) {
        o = offers[i];
        if (mode === 'edit' && String(o.id) === String(editingId)) { continue; } // an offer cannot be its own fallback
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'lst-fallback-result';
        btn.setAttribute('data-fallback-offer-id', String(o.id));
        btn.setAttribute('data-fallback-offer-name', o.offer_name || '');
        btn.appendChild(document.createTextNode(
          (o.offer_name || '') + ' \\u00b7 ' + (o.provider || '') + ' \\u00b7 ' + (o.vertical || '')
        ));
        fallbackResults.appendChild(btn);
        shown++;
      }
      fallbackResults.hidden = shown === 0;
    }).catch(function () {
      // §8 error state — a failed search never strands stale results.
      clearFallbackResults();
      if (window.showToast) { window.showToast('Failed to search offers', 'error'); }
    });
  }
  if (fallbackSearch) {
    fallbackSearch.addEventListener('input', function () {
      if (searchTimer) { window.clearTimeout(searchTimer); }
      searchTimer = window.setTimeout(runFallbackSearch, 250);
    });
  }
  if (fallbackResults) {
    fallbackResults.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-fallback-offer-id]') : null;
      if (btn) {
        selectFallback(btn.getAttribute('data-fallback-offer-id'), btn.getAttribute('data-fallback-offer-name'));
        dirty = true;
      }
    });
  }
  if (fallbackSelected) {
    fallbackSelected.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-fallback-clear]') : null;
      if (btn) { selectFallback('', ''); dirty = true; }
    });
  }

  // --- modal open / close / reset -------------------------------------------
  function openModal() {
    modal.style.display = 'flex';
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
  }
  function closeModal() {
    modal.style.display = 'none';
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    dirty = false;
  }
  function resetForm() {
    form.reset();
    clearFieldErrors();
    setTopError('');
    setStatus('');
    selectFallback('', '');
    macroFeedback();
    applyPayoutState();
    applyCapState();
    dirty = false;
  }
  function openCreate() {
    mode = 'create';
    editingId = '';
    resetForm();
    if (titleEl) { titleEl.textContent = 'Create an Offer'; }
    if (statusGroup) { statusGroup.hidden = true; }
    openModal();
    var first = document.getElementById('offer-name');
    if (first) { first.focus(); }
  }
  // Discard-guard: Escape/backdrop/Cancel on a DIRTY modal confirm() before
  // discarding (the beforeunload guard below only covers navigation).
  function requestCloseModal() {
    if (dirty && !window.confirm('Discard unsaved offer changes?')) { return; }
    closeModal();
  }
  if (cancelBtn) { cancelBtn.addEventListener('click', requestCloseModal); }
  modal.addEventListener('click', function (e) { if (e.target === modal) { requestCloseModal(); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { requestCloseModal(); } });

  // §8 unsaved-changes guard: warn on navigation while the modal is dirty.
  form.addEventListener('input', function () { dirty = true; });
  form.addEventListener('change', function () { dirty = true; });
  window.addEventListener('beforeunload', function (e) {
    if (dirty && !modal.classList.contains('hidden')) {
      e.preventDefault();
      e.returnValue = 'You have unsaved offer changes.';
      return 'You have unsaved offer changes.';
    }
    return undefined;
  });

  // --- edit prefill ----------------------------------------------------------
  function setValue(name, v) {
    var el = fieldByName(name);
    if (!el) { return; }
    if (el.type === 'checkbox') {
      el.checked = !!v && String(v) !== '0';
    } else {
      el.value = v === null || v === undefined ? '' : String(v);
    }
  }
  function fillForm(offer) {
    setValue('offer_name', offer.offer_name);
    setValue('provider', offer.provider);
    setValue('activity', offer.activity);
    setValue('vertical', offer.vertical);
    setValue('tag', offer.tag);
    setValue('conversion_tracking_method', offer.conversion_tracking_method);
    setValue('offer_url_template', offer.offer_url_template);
    setValue('payout_method', offer.payout_method);
    setValue('payout_currency', offer.payout_currency);
    setValue('payout_value', offer.payout_value);
    setValue('cap_enabled', offer.cap_enabled);
    setValue('cap_amount', offer.cap_amount);
    setValue('cap_timezone', offer.cap_timezone);
    setValue('cap_count_by', offer.cap_count_by);
    setValue('cap_fallback_url', offer.cap_fallback_url);
    setValue('status', offer.status);
    if (offer.cap_fallback_offer_id) {
      selectFallback(offer.cap_fallback_offer_id, 'Offer #' + offer.cap_fallback_offer_id);
      // Resolve the fallback offer's display name asynchronously.
      getJson('GET', '/api/admin/listicles/offers/' + encodeURIComponent(String(offer.cap_fallback_offer_id))).then(function (res) {
        if (res.ok && res.body && res.body.offer) {
          selectFallback(res.body.offer.id, res.body.offer.offer_name);
        }
      }).catch(function () {
        // handled state: the 'Offer #<id>' placeholder label set above stands
      });
    } else {
      selectFallback('', '');
    }
    macroFeedback();
    applyPayoutState();
    applyCapState();
  }
  function openEdit(id) {
    getJson('GET', '/api/admin/listicles/offers/' + encodeURIComponent(id)).then(function (res) {
      if (!res.ok || !res.body || !res.body.offer) {
        window.showToast('Failed to load offer' + (res.body && res.body.error ? ': ' + res.body.error : ''), 'error');
        return;
      }
      mode = 'edit';
      editingId = String(res.body.offer.id);
      resetForm();
      fillForm(res.body.offer);
      if (titleEl) { titleEl.textContent = 'Edit Offer'; }
      if (statusGroup) { statusGroup.hidden = false; }
      openModal();
      dirty = false;
    }).catch(function () {
      window.showToast('Failed to load offer', 'error');
    });
  }

  // --- client validation mirroring §23 (server stays authoritative) ----------
  function collectBody() {
    var fd = new FormData(form);
    var capEnabled = capToggle && capToggle.checked ? 1 : 0;
    var body = {
      offer_name: String(fd.get('offer_name') || ''),
      provider: String(fd.get('provider') || ''),
      activity: String(fd.get('activity') || ''),
      vertical: String(fd.get('vertical') || ''),
      tag: fd.get('tag') ? String(fd.get('tag')) : null,
      conversion_tracking_method: String(fd.get('conversion_tracking_method') || ''),
      offer_url_template: String(fd.get('offer_url_template') || ''),
      payout_method: String(fd.get('payout_method') || ''),
      payout_currency: null,
      payout_value: null,
      cap_enabled: capEnabled,
      cap_amount: null,
      cap_timezone: null,
      cap_count_by: null,
      cap_fallback_offer_id: null,
      cap_fallback_url: null
    };
    if (body.payout_method === 'in_site') {
      body.payout_currency = String(fd.get('payout_currency') || '') || null;
      var pv = parseFloat(String(fd.get('payout_value') || ''));
      body.payout_value = isNaN(pv) ? null : pv;
    }
    if (capEnabled === 1) {
      var ca = parseInt(String(fd.get('cap_amount') || ''), 10);
      body.cap_amount = isNaN(ca) ? null : ca;
      body.cap_timezone = String(fd.get('cap_timezone') || '') || null;
      body.cap_count_by = String(fd.get('cap_count_by') || '') || null;
      var fbRaw = fallbackIdInput ? fallbackIdInput.value : '';
      var fb = parseInt(fbRaw, 10);
      if (!isNaN(fb) && fb > 0) { body.cap_fallback_offer_id = fb; }
      var fbUrl = String(fd.get('cap_fallback_url') || '');
      if (fbUrl.replace(/^\\s+|\\s+$/g, '') !== '') { body.cap_fallback_url = fbUrl; }
    }
    if (mode === 'edit') { body.status = String(fd.get('status') || 'active'); }
    return body;
  }
  function validateClient(body) {
    var errors = {};
    function requireText(key, label) {
      if (!body[key] || body[key].replace(/^\\s+|\\s+$/g, '') === '') { errors[key] = label + ' is required'; }
    }
    requireText('offer_name', 'Offer name');
    requireText('provider', 'Provider');
    requireText('activity', 'Activity');
    requireText('vertical', 'Vertical');
    if (!body.conversion_tracking_method) { errors.conversion_tracking_method = 'Conversion tracking method is required'; }
    var url = (body.offer_url_template || '').replace(/^\\s+|\\s+$/g, '');
    if (url === '') {
      errors.offer_url_template = 'Offer URL template is required';
    } else if (!/^https?:\\/\\//i.test(url)) {
      errors.offer_url_template = 'Offer URL template must be an absolute http(s) URL';
    } else {
      var unknown = unknownMacrosIn(url);
      if (unknown.length > 0) {
        errors.offer_url_template = 'Unknown macros: {' + unknown.join('}, {') + '}';
      }
    }
    if (!body.payout_method) { errors.payout_method = 'Payout method is required'; }
    if (body.payout_method === 'in_site') {
      if (!body.payout_currency) { errors.payout_currency = 'Payout currency is required for In-site payout'; }
      if (body.payout_value === null || body.payout_value < 0) { errors.payout_value = 'Payout value (a number >= 0) is required for In-site payout'; }
    }
    if (body.cap_enabled === 1) {
      if (body.cap_amount === null || body.cap_amount <= 0) { errors.cap_amount = 'Cap amount (a positive integer) is required when the cap is enabled'; }
      if (!body.cap_timezone) { errors.cap_timezone = 'Cap timezone is required when the cap is enabled'; }
      if (!body.cap_count_by) { errors.cap_count_by = 'Count-by is required when the cap is enabled'; }
    }
    return errors;
  }
  function renderErrors(errors) {
    clearFieldErrors();
    var keys = [];
    var k;
    for (k in errors) {
      if (Object.prototype.hasOwnProperty.call(errors, k)) { keys.push(k); }
    }
    if (keys.length === 0) { return false; }
    var i;
    for (i = 0; i < keys.length; i++) { setFieldError(keys[i], errors[keys[i]]); }
    setTopError('Please fix the highlighted field' + (keys.length === 1 ? '' : 's') + ' (' + keys.length + ').');
    setStatus('Validation failed');
    var firstField = fieldByName(keys[0]);
    if (firstField && firstField.focus) { firstField.focus(); }
    return true;
  }

  // --- submit: Saving… → toast → reload (§8) ---------------------------------
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    setTopError('');
    setStatus('');
    var body = collectBody();
    if (renderErrors(validateClient(body))) { return; }
    if (saveBtn) { saveBtn.disabled = true; }
    setStatus('Saving\\u2026');
    var url = mode === 'edit'
      ? '/api/admin/listicles/offers/' + encodeURIComponent(editingId)
      : '/api/admin/listicles/offers';
    var method = mode === 'edit' ? 'PATCH' : 'POST';
    getJson(method, url, body).then(function (res) {
      if (saveBtn) { saveBtn.disabled = false; }
      if (res.ok) {
        dirty = false;
        setStatus('');
        // §13 "＋ New Offer" inline: when the Offer picker registered a
        // saved-hook, hand the created offer back (pre-selected) instead of
        // reloading the page.
        var savedOffer = res.body && res.body.offer;
        if (mode === 'create' && savedOffer && window._lstOfferModalOnSaved) {
          var onSaved = window._lstOfferModalOnSaved;
          window._lstOfferModalOnSaved = null;
          window.showToast('Offer created', 'success');
          closeModal();
          onSaved(savedOffer);
          return;
        }
        window.showToast(mode === 'edit' ? 'Offer saved' : 'Offer created', 'success');
        closeModal();
        window.setTimeout(function () { window.location.reload(); }, 600);
        return;
      }
      // Server is authoritative: render its field-keyed errors inline (§23).
      if (res.body && res.body.fields && renderErrors(res.body.fields)) {
        setStatus('Validation failed');
        return;
      }
      setTopError((res.body && res.body.error) || ('Error ' + res.status));
      setStatus('Save failed');
    }).catch(function () {
      if (saveBtn) { saveBtn.disabled = false; }
      setTopError('Network error — the offer was not saved.');
      setStatus('Save failed');
    });
  });

  applyPayoutState();
  applyCapState();
  macroFeedback();

  // --- modal open triggers + the shared entry points --------------------------
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) { return; }
    if (t.closest('[data-open-offer-modal]')) { openCreate(); return; }
    var editBtn = t.closest('[data-offer-edit]');
    if (editBtn) { openEdit(editBtn.getAttribute('data-offer-edit')); return; }
  });
  window.lstOfferModal = { openCreate: openCreate, openEdit: openEdit };
}());
`;

// ---------------------------------------------------------------------------
// Offers page row actions (strict ES5) — delete + 409 dialog + attribution
// ---------------------------------------------------------------------------

const OFFERS_LIST_ACTIONS_SCRIPT = `
(function () {
  var getJson = window.lstUi.getJson;

  // --- delete + 409 usage dialog + Archive instead (§8/§9/§26) --------------
  function archiveOffer(id) {
    getJson('PATCH', '/api/admin/listicles/offers/' + encodeURIComponent(id), { status: 'archived' }).then(function (res) {
      if (res.ok) {
        window.lstUi.closeDialog();
        window.showToast('Offer archived', 'success');
        window.setTimeout(function () { window.location.reload(); }, 600);
      } else {
        window.showToast('Failed to archive offer' + (res.body && res.body.error ? ': ' + res.body.error : ''), 'error');
      }
    }).catch(function () {
      window.showToast('Failed to archive offer', 'error');
    });
  }
  function showUsageDialog(id, name, body) {
    var bodyEl = window.lstUi.openDialog('Offer in use');
    if (!bodyEl) { return; }
    var p = document.createElement('p');
    p.appendChild(document.createTextNode((body && body.error) || ('"' + name + '" is referenced and cannot be hard-deleted.')));
    bodyEl.appendChild(p);
    var usage = (body && body.usage) || [];
    if (usage.length > 0) {
      var ul = document.createElement('ul');
      ul.className = 'lst-usage-list';
      var i, u, li, text;
      for (i = 0; i < usage.length; i++) {
        u = usage[i];
        li = document.createElement('li');
        if (u.kind === 'section') {
          text = 'Section: ' + (u.section_name || u.public_id || u.id);
          if (u.status) { text += ' (' + u.status + ')'; }
        } else {
          text = 'Cap fallback of offer: ' + (u.offer_name || u.public_id || u.id);
        }
        li.appendChild(document.createTextNode(text));
        ul.appendChild(li);
      }
      bodyEl.appendChild(ul);
    }
    var hint = document.createElement('p');
    hint.className = 'form-help';
    hint.appendChild(document.createTextNode((body && body.suggestion) || 'Archive the offer instead.'));
    bodyEl.appendChild(hint);
    var actions = document.createElement('div');
    actions.className = 'modal-actions';
    var archiveBtn = document.createElement('button');
    archiveBtn.type = 'button';
    archiveBtn.className = 'btn btn-primary';
    archiveBtn.setAttribute('data-archive-instead', String(id));
    archiveBtn.appendChild(document.createTextNode('Archive instead'));
    archiveBtn.addEventListener('click', function () { archiveOffer(id); });
    actions.appendChild(archiveBtn);
    bodyEl.appendChild(actions);
  }
  function onDelete(id, name) {
    if (!window.confirmDelete('Delete offer "' + name + '"? This cannot be undone.')) { return; }
    getJson('DELETE', '/api/admin/listicles/offers/' + encodeURIComponent(id)).then(function (res) {
      if (res.ok) {
        window.showToast('Offer deleted', 'success');
        window.setTimeout(function () { window.location.reload(); }, 600);
        return;
      }
      if (res.status === 409) {
        showUsageDialog(id, name, res.body);
        return;
      }
      window.showToast('Failed to delete offer' + (res.body && res.body.error ? ': ' + res.body.error : ''), 'error');
    }).catch(function () {
      window.showToast('Failed to delete offer', 'error');
    });
  }

  // --- View attribution to Sections (§9 row action) --------------------------
  function showAttribution(id, name) {
    var bodyEl = window.lstUi.openDialog('Attribution to Sections' + (name ? ' \\u2014 ' + name : ''));
    if (!bodyEl) { return; }
    var loading = document.createElement('p');
    loading.appendChild(document.createTextNode('Loading\\u2026'));
    bodyEl.appendChild(loading);
    function showAttributionError() {
      // §8 error state — never leave the dialog stuck on "Loading…".
      if (loading.parentNode) { loading.parentNode.removeChild(loading); }
      var err = document.createElement('p');
      err.className = 'alert alert-error';
      err.appendChild(document.createTextNode('Failed to load attribution.'));
      bodyEl.appendChild(err);
      if (window.showToast) { window.showToast('Failed to load attribution', 'error'); }
    }
    getJson('GET', '/api/admin/listicles/offers/' + encodeURIComponent(id) + '/usage').then(function (res) {
      if (loading.parentNode) { loading.parentNode.removeChild(loading); }
      if (!res.ok || !res.body) {
        showAttributionError();
        return;
      }
      var usage = res.body.usage || [];
      if (usage.length === 0) {
        var none = document.createElement('p');
        none.className = 'empty-state';
        none.appendChild(document.createTextNode('No sections reference this offer yet.'));
        bodyEl.appendChild(none);
        return;
      }
      var ul = document.createElement('ul');
      ul.className = 'lst-usage-list';
      var i, s, li;
      for (i = 0; i < usage.length; i++) {
        s = usage[i];
        li = document.createElement('li');
        li.appendChild(document.createTextNode((s.section_name || s.public_id) + (s.status ? ' (' + s.status + ')' : '')));
        ul.appendChild(li);
      }
      bodyEl.appendChild(ul);
    }).catch(showAttributionError);
  }

  // --- row action delegation ---------------------------------------------------
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) { return; }
    var delBtn = t.closest('[data-offer-delete]');
    if (delBtn) { onDelete(delBtn.getAttribute('data-offer-delete'), delBtn.getAttribute('data-offer-name') || 'this offer'); return; }
    var attrBtn = t.closest('[data-offer-attribution]');
    if (attrBtn) { showAttribution(attrBtn.getAttribute('data-offer-attribution'), attrBtn.getAttribute('data-offer-name') || ''); return; }
  });
}());
`;

// The two atoms concatenated — the Offers page's full inline script.
const OFFERS_PAGE_SCRIPT = OFFER_MODAL_SCRIPT + OFFERS_LIST_ACTIONS_SCRIPT;


export function listiclesOffersPage(
  props: OffersPageProps,
  branding: ListiclesBranding = {},
): string {
  const pager = renderListPager(
    {
      page: props.paging.page,
      per_page: props.paging.page_size,
      total: props.paging.total,
    },
    {
      search: props.filters.search,
      provider: props.filters.provider,
      vertical: props.filters.vertical,
      activity: props.filters.activity,
      status: props.filters.status,
      range: props.filters.range,
    },
  );
  const loadErrorHtml = props.loadError
    ? `<p class="alert alert-error" role="alert">${escapeHtml(props.loadError)}</p>`
    : "";
  const content = `${renderListiclesTabs("offers")}
${loadErrorHtml}
${renderToolbar(props)}
${renderOffersTable(props)}
${pager}
${renderOfferModal()}
${renderDialogShell()}`;
  return adminLayout({
    title: "Listicles",
    activePath: "/admin/listicles/offers",
    userEmail: branding.userEmail,
    conversionsUiEnabled: branding.conversionsUiEnabled,
    content,
    styles: LISTICLES_STYLES,
    scripts: LST_SHARED_SCRIPT + OFFERS_PAGE_SCRIPT + listFilterScript,
  });
}
