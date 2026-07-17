// LeadGen admin UI — Sections tab (contract 03 §9.3 + 05 §12–§14, Phase-5
// Stage B). The Sections tab goes LIVE: the list (Create + filters + timeframe
// + after-paint analytics hydration) and the full-page editor at
// /admin/leadgen/sections/:id/edit — LEFT question/answer builder canvas,
// RIGHT inspector (curated §14.8 tokens + the §12.4/§12.11 answer→Offer mapping
// grid), a Desktop/Mobile preview toggle, a states simulator, the Google-Maps
// address-validation toggle (§12.8 — the key is a secret, never embedded), and
// continue-mode + default-boolean controls. SSR drives the JSON API in-process
// via ui.ts's apiJson. Inline scripts are strict ES5 (layout.ts constraint,
// asserted by the ES5 parse test). Every author value is escapeHtml-escaped.

import { escapeHtml, renderListPager, listFilterScript } from "../templates/layout";
import { resolveTimeframe, renderTimeframeSelect, type Timeframe } from "../listicles/ui-shared";
import {
  apiJson,
  branding,
  EMPTY_PAGING,
  EM_DASH,
  leadgenPageShell,
  leadgenStandalonePageShell,
  pageParam,
  renderLeadgenTabs,
  statusBadge,
  studioActivePill,
  type ListBody,
  type UiContext,
} from "./ui";
import type { Paging } from "./router";
// Phase 4 (fix-contract v2.4 08, Slices D1+D2): the editor page assembles the
// Section STUDIO — ui-question-builder.ts is DELETED (the D2 §8.7 mapping
// panel removed its last consumer; the §12.11 grid assertions are ported to
// the studio suite).
import {
  SECTION_STUDIO_SCRIPT,
  SECTION_STUDIO_STYLES,
  renderSectionStudio,
  seededNewSectionContent,
  type StudioMappingSummary as MappingSummary,
  type StudioSectionView,
} from "./ui-section-studio";
// PC-9 (register, P1c): the "New Section" chrome badge below needs the REAL
// topbar height so it floats clear of renderStudioTopBar's 56px bar (that
// function lives in ui-section-studio.ts and is NOT this slice's to touch —
// studio-tokens.ts is a separate, already-exported shared module, so reading
// its token here carries no ownership conflict and can't drift out of sync).
import { STUDIO_GEOMETRY } from "./studio-tokens";
// §30.2 operator-owned browser Maps key — read ONLY to surface the absent-state
// note in the editor (the key value is NEVER embedded; the live geocode is P7).
import { resolveBrowserMapsKey } from "../../leadgen/maps";
import type { LeadgenSectionApi } from "./db-types";

// ---------------------------------------------------------------------------
// API shapes (sections-handlers.ts)
// ---------------------------------------------------------------------------

type SectionListItem = LeadgenSectionApi & {
  question_count: number;
  mapped_offer_count: number;
  completeness: "complete" | "incomplete" | "invalid" | "none";
};

export interface AnswerMapApiRow {
  question_id: string;
  question_key: string;
  internal_field: string;
  // §12.7 normalized answer_type — feeds the §12.11 type_mismatch cell text.
  answer_type: string;
  offer_id: number;
  offer_payload_field_path: string;
  provider_expected_type: string;
  // §8.5 API names (the parsed JSON columns) — NOT the DB `_json` column names.
  output_value_map: unknown;
  value_transform: unknown;
  required_for_offer: boolean;
  default_value: string | null;
  fallback_value: string | null;
  mapping_status: string;
  payload_schema_public_id?: string;
}

// The derived available-offer row (§12.1 rebuild output) carries the per-Offer
// mapping_state + the required-field counts the §12.11 publish verdict reads.
export interface AvailableOfferRow {
  offer_id: number;
  selected: boolean;
  mapping_state: string;
  required_fields_total: number;
  required_fields_mapped: number;
}

// v2.5 07 §7.3 / 12 §12.2 (DEV-55): the per-Offer provider-value projection —
// one row per SELECTED offer; `fields` keys are internal_fields, each carrying
// that offer's mapping path + parsed output_value_map. Chip data ONLY.
export interface OfferValueProjectionRow {
  offer_id: number;
  offer_public_id: string | null;
  offer_name: string;
  fields: Record<string, { path: string; values: Record<string, unknown> | null }>;
}

type SectionDetail = LeadgenSectionApi & {
  available_offers: AvailableOfferRow[];
  answer_maps: AnswerMapApiRow[];
  offer_values?: OfferValueProjectionRow[];
};

// §12.11 / §35: derive the section-level publish verdict + missing-required
// count. This MUST agree with sectionValidationStatus() (the authoritative
// gate), which flags an Offer `error` on EITHER an aggregated unmapped-required
// count OR a per-edge non-`complete` mapping_status (missing_required /
// type_mismatch / orphaned). Reading only the aggregated available-offer row
// misses the edge-level errors, so this also scans the loaded answer-map edges.
export function mappingSummaryOf(
  availableOffers: readonly AvailableOfferRow[],
  answerMaps: readonly AnswerMapApiRow[],
): MappingSummary {
  let requiredMissing = 0;
  let requiredMappedTotal = 0;
  let requiredFieldsTotal = 0;
  let publishable = true;
  for (const o of availableOffers) {
    const total = o.required_fields_total ?? 0;
    const mapped = o.required_fields_mapped ?? 0;
    requiredFieldsTotal += total;
    requiredMappedTotal += mapped;
    if (total > mapped) requiredMissing += total - mapped;
    if (o.mapping_state === "invalid" || total > mapped) publishable = false;
  }
  // Per-edge errors (sectionValidationStatus parity): any edge that is not
  // `complete` makes the Section unpublishable, exactly as the truth machine
  // pushes an `error` reason per non-complete edge.
  for (const m of answerMaps) {
    if (m.mapping_status !== "complete") publishable = false;
  }
  return {
    publishable,
    status: publishable ? "ok" : "error",
    required_missing_total: requiredMissing,
    // v3.1 §4.1: the top-bar "Mapping k / n complete" badge's real numbers.
    required_mapped_total: requiredMappedTotal,
    required_fields_total: requiredFieldsTotal,
  };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const LG_SECTIONS_STYLES = `
/* R5 grant 1 (register S4-A1/A9/A10): the full-bleed Section Studio editor
   has NO admin-shell chrome to host these above the studio any more — golden
   is a self-contained full-screen editor with nothing above it. Both the
   error surfaces AND the /new "New Section" label now float as small,
   unobtrusive fixed-position affordances instead of pushing content down:
   [hidden] (ADMIN_STYLES' global rule) keeps them at zero layout impact in
   the (overwhelmingly common) no-error case — the golden look is untouched;
   an actual error/warning appears as a floating banner ON TOP of the studio,
   never as chrome ABOVE it.
   PC-9 fix (register, P1c): the pubid badge used to float at top:14px, which
   sits INSIDE renderStudioTopBar's 56px bar (ui-section-studio.ts) and
   painted directly over its "← Sections" back link — the operator's Image8
   overlap. renderStudioTopBar belongs to a different slice's owned region;
   its name input has no placeholder to lean on instead (verified —
   #lg-section-name emits only a value attr, blank for a brand-new
   Section), so dropping the badge would silently remove the "you are
   creating, not editing" signal with nothing replacing it. The safe,
   in-scope fix: keep the badge but clear the topbar entirely by dropping it
   BELOW the bar (topBarHeight + the original 14px margin) instead of the
   page's very top edge — still a floating, non-content-pushing affordance,
   now never over topbar chrome at any viewport width (the bar's height is
   fixed regardless of width). */
.lg-editor-pubid{position:fixed;top:${STUDIO_GEOMETRY.topBarHeight + 14}px;left:14px;z-index:500;color:var(--c-muted);font-size:11px;background:#fff;border:1px solid var(--c-border);border-radius:6px;padding:3px 8px;box-shadow:0 1px 3px rgba(16,24,40,.08)}
#lg-section-error,[data-studio-save-problems]{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:600;max-width:560px;width:calc(100% - 28px);box-shadow:0 4px 16px rgba(16,24,40,.12)}
#lg-section-error{margin:0}
[data-studio-save-problems]{margin:0}
[data-studio-save-problems][hidden]{display:none!important}
/* R4a E3-S1: the row "Usage" action — an inline expandable panel replacing
   window.alert() (same data: GET .../usage, now readable + dismissible). */
.lg-usage-row td{background:var(--c-surface);border-top:0}
.lg-usage-panel{font-size:12.5px;color:var(--c-text)}
.lg-usage-panel ul{margin:6px 0 0;padding-left:18px}
.lg-usage-panel li{margin:2px 0}
${SECTION_STUDIO_STYLES}
`;

// ---------------------------------------------------------------------------
// List page (03 §9.3)
// ---------------------------------------------------------------------------

const SECTION_LIST_COLUMNS: ReadonlyArray<{ label: string; numeric?: boolean; metric?: string }> = [
  { label: "Name" },
  { label: "Activity / Vertical" },
  { label: "Questions", numeric: true },
  { label: "Mapped Offers", numeric: true },
  { label: "Mapping completeness" },
  { label: "Status" },
  { label: "Views", numeric: true, metric: "views" },
  { label: "Continue rate", numeric: true, metric: "continue_rate" },
  { label: "Validation-error rate", numeric: true, metric: "validation_error_rate" },
  { label: "Actions" },
];

function completenessBadge(c: SectionListItem["completeness"]): string {
  const map: Record<string, { cls: string; label: string }> = {
    complete: { cls: "badge badge-published", label: "complete" },
    incomplete: { cls: "badge badge-scheduled", label: "incomplete" },
    invalid: { cls: "badge badge-archived", label: "invalid" },
    none: { cls: "badge badge-draft", label: "no offers" },
  };
  const chosen = map[c] ?? { cls: "badge badge-draft", label: "no offers" };
  return `<span class="${chosen.cls}" data-completeness="${escapeHtml(c)}">${escapeHtml(chosen.label)}</span>`;
}

function renderSectionListRow(s: SectionListItem): string {
  // R4a E3-NEW-9: the server supports reactivating via the same general
  // PATCH {status} the editor's Advanced surfaces already use
  // (sections-handlers.ts patchSectionHandler; "status" rides
  // SECTION_PATCH_FIELDS) — an archived row gets a real Reactivate action
  // instead of a disabled Archive button promising nothing.
  const archiveOrReactivate =
    s.status === "archived"
      ? `<button type="button" class="btn btn-sm btn-secondary" data-section-reactivate="${escapeHtml(s.public_id)}">Reactivate</button>`
      : `<button type="button" class="btn btn-sm btn-danger" data-section-archive="${escapeHtml(s.public_id)}">Archive</button>`;
  return `<tr data-entity-id="${s.id}" data-entity-name="${escapeHtml(s.section_name)}">
  <td>${escapeHtml(s.section_name)}</td>
  <td>${escapeHtml(s.activity)} / ${escapeHtml(s.vertical)}</td>
  <td class="lg-num">${s.question_count}</td>
  <td class="lg-num">${s.mapped_offer_count}</td>
  <td>${completenessBadge(s.completeness)}</td>
  <td>${statusBadge(s.status)}</td>
  <td class="lg-num" data-metric="views"><span class="skel" aria-hidden="true"></span></td>
  <td class="lg-num" data-metric="continue_rate"><span class="skel" aria-hidden="true"></span></td>
  <td class="lg-num" data-metric="validation_error_rate"><span class="skel" aria-hidden="true"></span></td>
  <td>
    <a href="/admin/leadgen/sections/${escapeHtml(s.public_id)}/edit" class="btn btn-sm btn-secondary">Edit</a>
    <button type="button" class="btn btn-sm btn-outline" data-section-usage="${escapeHtml(s.public_id)}" aria-expanded="false">Usage</button>
    ${archiveOrReactivate}
  </td>
</tr>
<tr class="lg-usage-row" data-section-usage-row="${escapeHtml(s.public_id)}" hidden>
  <td colspan="${SECTION_LIST_COLUMNS.length}"><div class="lg-usage-panel" data-section-usage-panel role="status" aria-live="polite"></div></td>
</tr>`;
}

function renderSectionsToolbar(
  filters: { search: string; activity: string; vertical: string; status: string },
  verticals: string[],
  activities: string[],
  timeframe: Timeframe,
): string {
  const options = (values: string[], selected: string): string =>
    values
      .map((v) => `<option value="${escapeHtml(v)}"${v === selected ? " selected" : ""}>${escapeHtml(v)}</option>`)
      .join("");
  return `<div class="toolbar">
  <a href="/admin/leadgen/sections/new" class="btn btn-primary" data-create-section>+ Create a Section</a>
  <div class="toolbar-search"><input type="search" name="search" class="form-input" placeholder="Search sections…" value="${escapeHtml(filters.search)}" aria-label="Search sections" /></div>
  <div class="toolbar-filters">
    <select name="activity" class="form-select" aria-label="Activity"><option value="">All activities</option>${options(activities, filters.activity)}</select>
    <select name="vertical" class="form-select" aria-label="Vertical"><option value="">All verticals</option>${options(verticals, filters.vertical)}</select>
    <select name="status" class="form-select" aria-label="Status"><option value="">All statuses</option><option value="active"${filters.status === "active" ? " selected" : ""}>active</option><option value="archived"${filters.status === "archived" ? " selected" : ""}>archived</option></select>
    ${renderTimeframeSelect(timeframe.key)}
  </div>
</div>`;
}

// The list-page analytics hydrator + row actions (strict ES5).
const SECTION_LIST_SCRIPT = `
(function () {
  function fmtInt(v) { var n = Number(v); if (!isFinite(n)) { n = 0; } return String(Math.round(n)); }
  function fmtPct(v) { var n = Number(v); if (!isFinite(n)) { n = 0; } return (n * 100).toFixed(2) + '%'; }
  var FORMATS = { views: fmtInt, continue_rate: fmtPct, validation_error_rate: fmtPct };

  function clearChildren(el) { while (el.firstChild) { el.removeChild(el.firstChild); } }

  function fillRow(table, row) {
    var id = row.getAttribute('data-entity-id');
    if (!id) { return; }
    var prefix = table.getAttribute('data-analytics-url-prefix') || '';
    var from = table.getAttribute('data-analytics-from') || '';
    var to = table.getAttribute('data-analytics-to') || '';
    var url = prefix + encodeURIComponent(id) + '/analytics?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
    fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      var cells = row.querySelectorAll('td[data-metric]');
      var i, key, has, metrics;
      metrics = (res.ok && res.body && res.body.analytics) ? res.body.analytics : {};
      for (i = 0; i < cells.length; i++) {
        key = cells[i].getAttribute('data-metric');
        has = metrics[key] !== undefined && metrics[key] !== null;
        clearChildren(cells[i]);
        cells[i].appendChild(document.createTextNode(has ? (FORMATS[key] || fmtInt)(metrics[key]) : '\\u2014'));
      }
    }).catch(function () {
      var cells = row.querySelectorAll('td[data-metric]');
      var i;
      for (i = 0; i < cells.length; i++) { clearChildren(cells[i]); cells[i].appendChild(document.createTextNode('\\u2014')); }
    });
  }

  var tables = document.querySelectorAll('table[data-lg-analytics]');
  var t, rows, j;
  for (t = 0; t < tables.length; t++) {
    rows = tables[t].querySelectorAll('tbody tr[data-entity-id]');
    for (j = 0; j < rows.length; j++) { fillRow(tables[t], rows[j]); }
  }

  // row actions: archive/reactivate (confirm + response.ok-checked PATCH/
  // DELETE), usage (inline expandable panel — R4a E3-S1, replaces alert())
  document.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) { return; }
    var archiveId = el.getAttribute('data-section-archive');
    if (archiveId) {
      if (!window.confirm('Archive this Section? It can be reactivated later from this list.')) { return; }
      fetch('/api/admin/leadgen/sections/' + encodeURIComponent(archiveId), {
        method: 'DELETE', credentials: 'same-origin', headers: { 'Accept': 'application/json' }
      }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, body: j }; });
      }).then(function (res) {
        // R4a E3-NEW-9: check response.ok — a failure shows an error, no
        // silent redirect (previously this .then() had no ok-check at all).
        if (!res.ok) { window.alert((res.body && res.body.error) || 'Archive failed'); return; }
        window.location.reload();
      }).catch(function () { window.alert('Archive request failed'); });
      return;
    }
    // R4a E3-NEW-9: reactivate — the server already supports flipping
    // status back to 'active' via the general PATCH (patchSectionHandler);
    // this is the ONLY new client action, no new server work needed.
    var reactivateId = el.getAttribute('data-section-reactivate');
    if (reactivateId) {
      if (!window.confirm('Reactivate this Section?')) { return; }
      fetch('/api/admin/leadgen/sections/' + encodeURIComponent(reactivateId), {
        method: 'PATCH', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ status: 'active' })
      }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, body: j }; });
      }).then(function (res) {
        if (!res.ok) { window.alert((res.body && res.body.error) || 'Reactivate failed'); return; }
        window.location.reload();
      }).catch(function () { window.alert('Reactivate request failed'); });
      return;
    }
    var usageId = el.getAttribute('data-section-usage');
    if (usageId) {
      var panelRow = document.querySelector('[data-section-usage-row="' + usageId + '"]');
      if (!panelRow) { return; }
      var wasHidden = panelRow.hidden;
      // toggle: a second click on the SAME row collapses it again.
      panelRow.hidden = !wasHidden;
      el.setAttribute('aria-expanded', wasHidden ? 'true' : 'false');
      if (!wasHidden) { return; }
      var panel = panelRow.querySelector('[data-section-usage-panel]');
      if (!panel || panel.getAttribute('data-loaded') === 'true') { return; }
      panel.appendChild(document.createTextNode('Loading usage\\u2026'));
      fetch('/api/admin/leadgen/sections/' + encodeURIComponent(usageId) + '/usage', {
        credentials: 'same-origin', headers: { 'Accept': 'application/json' }
      }).then(function (r) { return r.json(); }).then(function (body) {
        var variants = (body && body.usage && body.usage.variants) ? body.usage.variants : [];
        clearChildren(panel);
        panel.setAttribute('data-loaded', 'true');
        if (variants.length === 0) {
          panel.appendChild(document.createTextNode('Not used by any funnel variant.'));
          return;
        }
        var head = document.createElement('p');
        head.appendChild(document.createTextNode('Used by ' + variants.length + ' funnel variant(s):'));
        panel.appendChild(head);
        var list = document.createElement('ul');
        var i, v, li;
        for (i = 0; i < variants.length; i++) {
          v = variants[i];
          li = document.createElement('li');
          li.appendChild(document.createTextNode(
            (v.quote_name || 'Quote') + ' \\u203A ' + (v.funnel_name || v.funnel_public_id || 'Funnel') + ' \\u203A Variant ' + (v.variant_label || '?')
          ));
          list.appendChild(li);
        }
        panel.appendChild(list);
      }).catch(function () {
        clearChildren(panel);
        panel.appendChild(document.createTextNode('Failed to load usage.'));
      });
    }
  });
}());
`;

export async function leadgenSectionsListPage(c: UiContext): Promise<Response> {
  const page = pageParam(c);
  const search = c.req.query("search")?.trim() ?? "";
  const activity = c.req.query("activity")?.trim() ?? "";
  const vertical = c.req.query("vertical")?.trim() ?? "";
  const status = c.req.query("status")?.trim() ?? "";
  const timeframe = resolveTimeframe(c.req.query("range"));

  const qs = new URLSearchParams();
  if (page !== "") qs.set("page", page);
  if (search !== "") qs.set("search", search);
  if (activity !== "") qs.set("activity", activity);
  if (vertical !== "") qs.set("vertical", vertical);
  if (status !== "") qs.set("status", status);
  const query = qs.toString();

  const listed = await apiJson<ListBody<SectionListItem>>(
    c.env,
    `/api/admin/leadgen/sections${query === "" ? "" : `?${query}`}`,
  );
  const verticalsRes = await apiJson<{ items: string[] }>(c.env, "/api/admin/leadgen/verticals");
  const activitiesRes = await apiJson<{ items: string[] }>(c.env, "/api/admin/leadgen/activities");

  const items = listed.ok ? listed.body.items : [];
  const paging: Paging = listed.ok ? listed.body.paging : EMPTY_PAGING;
  const rows =
    items.length === 0
      ? `<tr><td colspan="${SECTION_LIST_COLUMNS.length}"><div class="empty-state"><p>No sections yet.</p><p class="form-help">Create a Section to build a reusable question unit.</p></div></td></tr>`
      : items.map(renderSectionListRow).join("");

  const headerCells = SECTION_LIST_COLUMNS.map((col) => {
    const cls = col.numeric === true ? ' class="lg-num"' : "";
    return `<th scope="col"${cls}>${escapeHtml(col.label)}</th>`;
  }).join("");

  const loadErrorHtml = listed.ok
    ? ""
    : `<p class="alert alert-error" role="alert">${escapeHtml(listed.error)}</p>`;

  const content = `${renderLeadgenTabs("sections")}
${loadErrorHtml}
${renderSectionsToolbar({ search, activity, vertical, status }, verticalsRes.ok ? verticalsRes.body.items : [], activitiesRes.ok ? activitiesRes.body.items : [], timeframe)}
<div class="card">
  <div class="table-wrapper">
    <table class="table leadgen-sections-list" aria-label="Sections list" data-lg-analytics data-analytics-url-prefix="/api/admin/leadgen/sections/" data-analytics-from="${escapeHtml(timeframe.from)}" data-analytics-to="${escapeHtml(timeframe.to)}">
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>
${renderListPager({ page: paging.page, per_page: paging.page_size, total: paging.total }, { page })}`;

  return c.html(
    leadgenPageShell({
      activePath: "/admin/leadgen/sections",
      userEmail: branding(c).userEmail,
      content,
      styles: LG_SECTIONS_STYLES,
      scripts: SECTION_LIST_SCRIPT + listFilterScript,
    }),
  );
}

// ---------------------------------------------------------------------------
// Editor page (03 §9.3 → fix-contract v2.4 08) — the Section STUDIO
// ---------------------------------------------------------------------------

interface EditorData {
  section: SectionDetail | null; // null = new
  summary: MappingSummary;
  // §30.2: whether the operator-owned browser Maps key is configured. false ⇒
  // the editor shows "Maps key not configured — autofill disabled".
  mapsKeyConfigured: boolean;
  // FIX 8c (§8.4): whether the admin AI image route is usable — false hides
  // the media picker's "Generate with AI" affordance.
  aiImageAvailable: boolean;
}

// An empty summary for the /new editor (no offers, nothing to publish yet).
const EMPTY_SUMMARY: MappingSummary = {
  publishable: true,
  status: "ok",
  required_missing_total: 0,
  required_mapped_total: 0,
  required_fields_total: 0,
};

// The #lg-section-data JSON state blob. Serialized + `<`-escaped so a hostile
// author value can never break out of the <script type="application/json">.
// D2 (§8.7): `selected_offers` rides along — the island's save body persists
// the SELECTED set explicitly (a selected-but-unmapped Offer survives a
// studio save; the save path's parseAnswerMaps already consumed it).
// v2.5 §5.2: a NEW Section (null) seeds the BOUND QuestionHeadline +
// Subheadline pair — the blob and the SSR view use the SAME seed so the
// island model matches the served canvas.
function sectionDataBlob(section: SectionDetail | null): string {
  const contentJson =
    section === null
      ? seededNewSectionContent()
      : section.content_json !== null
        ? section.content_json
        : { components: [] };
  const data = {
    public_id: section?.public_id ?? null,
    content: contentJson,
    answer_maps: section !== null ? section.answer_maps : [],
    selected_offers: (section?.available_offers ?? []).filter((o) => o.selected).map((o) => o.offer_id),
    continue_mode: section?.continue_mode ?? "button",
    address_validation_enabled: section?.address_validation_enabled ?? false,
    // v2.5 wave 2: DEV-55 per-Offer provider-value projection (07 §7.3 chip) +
    // the §9.5 Section-level overrides (Design-overrides drawer mode) — both
    // ADDITIVE keys; the island defaults them when absent (legacy blobs).
    offer_values: section?.offer_values ?? [],
    design_overrides: section?.design_overrides_json ?? null,
  };
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

// Project the API SectionDetail into the studio's view model. The parsed
// content_json (already an object from the API) is coerced defensively — a
// corrupt/absent body renders the empty studio rather than crashing SSR.
// v2.5 §5.2: NEW Sections seed the bound headline/subheadline nodes.
function toStudioView(section: SectionDetail | null): StudioSectionView {
  const rawContent = section?.content_json;
  const components =
    section === null
      ? seededNewSectionContent().components
      : typeof rawContent === "object" && rawContent !== null && Array.isArray((rawContent as { components?: unknown }).components)
        ? ((rawContent as { components: unknown[] }).components as StudioSectionView["content"]["components"])
        : [];
  return {
    public_id: section?.public_id ?? null,
    section_name: section?.section_name ?? "",
    status: section?.status ?? "active",
    activity: section?.activity ?? "",
    vertical: section?.vertical ?? "",
    headline_text: section?.headline_text ?? "",
    subheadline_text: section?.subheadline_text ?? null,
    continue_mode: section?.continue_mode ?? "button",
    address_validation_enabled: section?.address_validation_enabled ?? false,
    content: { components },
  };
}

// R5 census split (register §A M2 / E.5b): sectionEditorHtml itself
// legitimately calls the golden renderSectionStudio (ui-section-studio.ts),
// but the small chrome it wraps around that call — the "New Section" pubid
// label and the two error/warning alert surfaces — has no golden depiction
// (golden's static mockup shows no new/unsaved/error state). Its OWN
// top-level render* block so golden-allowlist.mjs's scanner can classify it
// independently of the (golden-legit) call to renderSectionStudio.
function renderSectionEditorChrome(isNew: boolean): string {
  return `${isNew ? `<span class="lg-editor-pubid">New Section</span>` : ""}
  <p id="lg-section-error" class="alert alert-error" hidden role="alert"></p>
  <div class="alert alert-warning" data-studio-save-problems hidden role="status" aria-live="polite"></div>`;
}

function sectionEditorHtml(data: EditorData, brand: { userEmail?: string }): string {
  const s = data.section;
  const isNew = s === null;
  const view = toStudioView(s);
  // §7.4 "Normal designers see NO ids": the top bar carries the status badge
  // only — the public id lives on the Advanced surfaces (inspector Advanced
  // tab / debug drawer), never in normal-mode chrome.
  // R5 D7 (register S4-B5): the STUDIO topbar uses the golden dot+pill
  // treatment (studioActivePill), not the shared list-page statusBadge —
  // the Sections LIST page (renderSectionListRow above) is UNCHANGED.
  const statusPillHtml = isNew ? "" : studioActivePill((s as SectionDetail).status);

  // R5 grant 1 (register S4-A1/A9/A10): the editor route is a self-contained
  // full-bleed page — no LeadGen sub-tabs row (that belonged to the admin-
  // shell tab strip, gone with the shell) and no visible chrome above the
  // studio (the pubid label + error/warning surfaces float — see
  // LG_SECTIONS_STYLES, renderSectionEditorChrome above). "← Sections" (the
  // studio's OWN top-bar back link, renderStudioTopBar) is the one working
  // way back to the list, matching golden.
  const content = `<div id="lg-section-editor"${isNew ? "" : ` data-section-id="${(s as SectionDetail).id}" data-section-public-id="${escapeHtml((s as SectionDetail).public_id)}"`}>
  ${renderSectionEditorChrome(isNew)}
  ${renderSectionStudio(view, data.summary, statusPillHtml, data.mapsKeyConfigured, s !== null ? (s.answer_maps ?? []).length : 0, data.aiImageAvailable)}
  <script type="application/json" id="lg-section-data">${sectionDataBlob(s)}</script>
</div>`;

  return leadgenStandalonePageShell({
    content,
    styles: LG_SECTIONS_STYLES,
    scripts: SECTION_STUDIO_SCRIPT,
  });
}

// In-shell 404 (mirrors leadgenOfferNotFoundPage).
function sectionNotFoundPage(brand: { userEmail?: string }): string {
  const content = `${renderLeadgenTabs("sections")}
<div class="card"><div class="empty-state">
  <p>Section not found.</p>
  <a href="/admin/leadgen/sections" class="btn btn-primary">Back to Sections</a>
</div></div>`;
  return leadgenPageShell({
    activePath: "/admin/leadgen/sections",
    userEmail: brand.userEmail,
    content,
    styles: LG_SECTIONS_STYLES,
  });
}

// /admin/leadgen/sections/new — the studio with an empty Section.
export async function leadgenSectionsNewPage(c: UiContext): Promise<Response> {
  return c.html(
    sectionEditorHtml(
      {
        section: null,
        summary: EMPTY_SUMMARY,
        mapsKeyConfigured: resolveBrowserMapsKey(c.env) !== null,
        aiImageAvailable: typeof c.env.OPENAI_API_KEY === "string" && c.env.OPENAI_API_KEY !== "",
      },
      branding(c),
    ),
  );
}

// /admin/leadgen/sections/:id/edit — the full-page Section Studio. (The
// per-Offer labels fetch the old mapping grid needed returns with the D2
// §8.7 mapping panel; D1 renders the summary + preserves answer_maps.)
export async function leadgenSectionEditorPage(c: UiContext): Promise<Response> {
  const idParam = c.req.param("id") ?? "";
  const got = await apiJson<SectionDetail>(
    c.env,
    `/api/admin/leadgen/sections/${encodeURIComponent(idParam)}`,
  );
  if (!got.ok) {
    return c.html(sectionNotFoundPage(branding(c)), 404);
  }
  const section = got.body;

  return c.html(
    sectionEditorHtml(
      {
        section,
        summary: mappingSummaryOf(section.available_offers ?? [], section.answer_maps ?? []),
        mapsKeyConfigured: resolveBrowserMapsKey(c.env) !== null,
        aiImageAvailable: typeof c.env.OPENAI_API_KEY === "string" && c.env.OPENAI_API_KEY !== "",
      },
      branding(c),
    ),
  );
}
