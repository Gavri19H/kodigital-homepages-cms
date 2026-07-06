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
  pageParam,
  renderLeadgenTabs,
  statusBadge,
  type ListBody,
  type UiContext,
} from "./ui";
import type { Paging } from "./router";
import {
  QUESTION_BUILDER_SCRIPT,
  QUESTION_BUILDER_STYLES,
  renderBuilderCanvas,
  renderComponentPalette,
  renderComponentSeedData,
  renderInspector,
  renderPreviewToggle,
  type AnswerMapView,
  type MappingSummary,
} from "./ui-question-builder";
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

interface AnswerMapApiRow {
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
}

// The derived available-offer row (§12.1 rebuild output) carries the per-Offer
// mapping_state + the required-field counts the §12.11 publish verdict reads.
interface AvailableOfferRow {
  offer_id: number;
  selected: boolean;
  mapping_state: string;
  required_fields_total: number;
  required_fields_mapped: number;
}

type SectionDetail = LeadgenSectionApi & {
  available_offers: AvailableOfferRow[];
  answer_maps: AnswerMapApiRow[];
};

// §12.11 / §35: derive the section-level publish verdict + missing-required
// count from the persisted available-offer rows — the SAME derived truth
// sectionValidationStatus() consumes (a Section is publishable ⇔ no Offer is
// `invalid` AND every provider-required field is mapped). Reads the truth
// machine's output; never re-implements the completeness logic.
function mappingSummaryOf(availableOffers: readonly AvailableOfferRow[]): MappingSummary {
  let requiredMissing = 0;
  let publishable = true;
  for (const o of availableOffers) {
    const total = o.required_fields_total ?? 0;
    const mapped = o.required_fields_mapped ?? 0;
    if (total > mapped) requiredMissing += total - mapped;
    if (o.mapping_state === "invalid" || total > mapped) publishable = false;
  }
  return { publishable, status: publishable ? "ok" : "error", required_missing_total: requiredMissing };
}

interface SectionOffersBody {
  offers: Array<{ id: number; public_id: string; offer_name: string; status: string; has_active_schema: boolean }>;
  mappings: AnswerMapApiRow[];
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const LG_SECTIONS_STYLES = `
.lg-editor-head{display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap}
.lg-editor-title{margin:0;font-size:20px}
.lg-editor-pubid{color:var(--c-muted);font-size:12px}
.lg-editor-spacer{flex:1}
.lg-section-scalars{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
@media (max-width:640px){.lg-section-scalars{grid-template-columns:1fr}}
.lg-maps-note{color:var(--c-muted);font-size:12px}
${QUESTION_BUILDER_STYLES}
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
    <button type="button" class="btn btn-sm btn-outline" data-section-usage="${escapeHtml(s.public_id)}">Usage</button>
    <button type="button" class="btn btn-sm btn-danger" data-section-archive="${escapeHtml(s.public_id)}"${s.status === "archived" ? " disabled" : ""}>Archive</button>
  </td>
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

  // row actions: archive (confirm + DELETE), usage (fetch + alert summary)
  document.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) { return; }
    var archiveId = el.getAttribute('data-section-archive');
    if (archiveId) {
      if (!window.confirm('Archive this Section?')) { return; }
      fetch('/api/admin/leadgen/sections/' + encodeURIComponent(archiveId), {
        method: 'DELETE', credentials: 'same-origin', headers: { 'Accept': 'application/json' }
      }).then(function () { window.location.reload(); });
      return;
    }
    var usageId = el.getAttribute('data-section-usage');
    if (usageId) {
      fetch('/api/admin/leadgen/sections/' + encodeURIComponent(usageId) + '/usage', {
        credentials: 'same-origin', headers: { 'Accept': 'application/json' }
      }).then(function (r) { return r.json(); }).then(function (body) {
        var variants = (body && body.usage && body.usage.variants) ? body.usage.variants : [];
        window.alert(variants.length === 0 ? 'Not used by any funnel variant.' : 'Used by ' + variants.length + ' funnel variant(s).');
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
      ? `<tr><td colspan="${SECTION_LIST_COLUMNS.length}"><div class="empty-state"><p>No sections yet.</p><p class="form-help">Create a Section to build a quote slide.</p></div></td></tr>`
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
// Editor page (03 §9.3) — full-page builder
// ---------------------------------------------------------------------------

interface EditorData {
  section: SectionDetail | null; // null = new
  offerLabelById: Map<number, string>;
  maps: AnswerMapView[];
  summary: MappingSummary;
  // §30.2: whether the operator-owned browser Maps key is configured. false ⇒
  // the editor shows "Maps key not configured — autofill disabled".
  mapsKeyConfigured: boolean;
}

function toAnswerMapViews(rows: AnswerMapApiRow[]): AnswerMapView[] {
  return rows.map((m) => ({
    question_id: m.question_id,
    question_key: m.question_key,
    internal_field: m.internal_field,
    answer_type: typeof m.answer_type === "string" ? m.answer_type : "",
    offer_id: m.offer_id,
    offer_payload_field_path: m.offer_payload_field_path,
    provider_expected_type: m.provider_expected_type,
    output_value_map: m.output_value_map,
    value_transform: m.value_transform,
    required_for_offer: m.required_for_offer,
    default_value: m.default_value,
    fallback_value: m.fallback_value,
    mapping_status: m.mapping_status,
  }));
}

// An empty summary for the /new editor (no offers, nothing to publish yet).
const EMPTY_SUMMARY: MappingSummary = { publishable: true, status: "ok", required_missing_total: 0 };

// The #lg-section-data JSON state blob. Serialized + `<`-escaped so a hostile
// author value can never break out of the <script type="application/json">.
function sectionDataBlob(section: SectionDetail | null): string {
  const contentJson = section !== null && section.content_json !== null ? section.content_json : { components: [] };
  const data = {
    public_id: section?.public_id ?? null,
    content: contentJson,
    answer_maps: section !== null ? section.answer_maps : [],
    continue_mode: section?.continue_mode ?? "button",
    address_validation_enabled: section?.address_validation_enabled ?? false,
  };
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function renderSectionScalarForm(section: SectionDetail | null, mapsKeyConfigured: boolean): string {
  const s = section;
  const continueMode = s?.continue_mode ?? "button";
  const addressOn = s?.address_validation_enabled ?? false;
  // §30.2: surface the operator-owned browser Maps key's ACTUAL state. Absent ⇒
  // autofill disabled (the validate/geocode leg no-ops); the key VALUE is never
  // embedded here — only its presence.
  const mapsKeyNote = mapsKeyConfigured
    ? `<span class="lg-maps-note" data-maps-key="configured">Maps key configured (operator-owned browser key) — autofill available.</span>`
    : `<span class="lg-maps-note" data-maps-key="absent">Maps key not configured — autofill disabled (§30.2 no-op).</span>`;
  return `<form id="lg-section-form" novalidate>
  <div class="lg-section-scalars">
    <div class="form-group">
      <label class="form-label" for="lg-section-name">Section name *</label>
      <input id="lg-section-name" name="section_name" class="form-input" required aria-required="true" value="${escapeHtml(s?.section_name ?? "")}" />
    </div>
    <div class="form-group">
      <label class="form-label" for="lg-section-headline">Headline (the question) *</label>
      <input id="lg-section-headline" name="headline_text" class="form-input" required aria-required="true" value="${escapeHtml(s?.headline_text ?? "")}" />
    </div>
    <div class="form-group">
      <label class="form-label" for="lg-section-activity">Activity *</label>
      <input id="lg-section-activity" name="activity" class="form-input" required aria-required="true" value="${escapeHtml(s?.activity ?? "")}" />
    </div>
    <div class="form-group">
      <label class="form-label" for="lg-section-vertical">Vertical *</label>
      <input id="lg-section-vertical" name="vertical" class="form-input" required aria-required="true" value="${escapeHtml(s?.vertical ?? "")}" />
    </div>
    <div class="form-group">
      <label class="form-label" for="lg-section-subheadline">Subheadline</label>
      <input id="lg-section-subheadline" name="subheadline_text" class="form-input" value="${escapeHtml(s?.subheadline_text ?? "")}" />
    </div>
    <fieldset class="form-group">
      <legend class="form-label">Continue mode (§12.5)</legend>
      <label class="lg-check"><input type="radio" name="continue_mode" value="button"${continueMode === "button" ? " checked" : ""} /> Button (validate, then Continue)</label>
      <label class="lg-check"><input type="radio" name="continue_mode" value="auto_advance"${continueMode === "auto_advance" ? " checked" : ""} /> Auto-advance (navigate on click)</label>
    </fieldset>
  </div>
  <div class="form-group">
    <label class="lg-check"><input type="checkbox" id="lg-address-validation" name="address_validation_enabled"${addressOn ? " checked" : ""} /> Google-Maps address / ZIP validation (§12.8)</label>
    <span class="lg-maps-note">The Maps key is a wrangler secret (GOOGLE_MAPS_BROWSER_KEY) — never embedded in cached HTML. Absent key ⇒ the validation leg no-ops.</span>
    ${mapsKeyNote}
  </div>
</form>`;
}

function sectionEditorHtml(data: EditorData, brand: { userEmail?: string }): string {
  const s = data.section;
  const isNew = s === null;
  const title = isNew ? "New Section" : (s as SectionDetail).section_name;
  const head = `<div class="lg-editor-head">
    <a href="/admin/leadgen/sections" class="btn btn-outline">&#8592; Sections</a>
    <h2 class="lg-editor-title">${escapeHtml(title)}</h2>
    ${isNew ? "" : `<code class="lg-editor-pubid">${escapeHtml((s as SectionDetail).public_id)}</code>${statusBadge((s as SectionDetail).status)}`}
    <span class="lg-editor-spacer"></span>
    <button type="button" id="lg-section-save" class="btn btn-primary">Save</button>
    <button type="button" id="lg-section-archive" class="btn btn-danger"${isNew || (s as SectionDetail).status === "archived" ? " disabled" : ""}>Archive</button>
  </div>`;

  const content = `${renderLeadgenTabs("sections")}
<div id="lg-section-editor"${isNew ? "" : ` data-section-id="${(s as SectionDetail).id}" data-section-public-id="${escapeHtml((s as SectionDetail).public_id)}"`}>
  ${head}
  <p id="lg-section-error" class="alert alert-error" hidden role="alert"></p>
  ${renderSectionScalarForm(s, data.mapsKeyConfigured)}
  <div class="lg-editor-grid">
    <div class="card">${renderComponentPalette()}</div>
    <div class="card">
      ${renderBuilderCanvas(s !== null ? s.content_json : { components: [] })}
      ${renderPreviewToggle()}
    </div>
    <div class="card">${renderInspector(data.maps, data.offerLabelById, data.summary)}</div>
  </div>
  <script type="application/json" id="lg-section-data">${sectionDataBlob(s)}</script>
  ${renderComponentSeedData()}
</div>`;

  return leadgenPageShell({
    activePath: "/admin/leadgen/sections",
    userEmail: brand.userEmail,
    content,
    styles: LG_SECTIONS_STYLES,
    scripts: QUESTION_BUILDER_SCRIPT,
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

// /admin/leadgen/sections/new — the editor with an empty Section.
export async function leadgenSectionsNewPage(c: UiContext): Promise<Response> {
  return c.html(
    sectionEditorHtml(
      {
        section: null,
        offerLabelById: new Map(),
        maps: [],
        summary: EMPTY_SUMMARY,
        mapsKeyConfigured: resolveBrowserMapsKey(c.env) !== null,
      },
      branding(c),
    ),
  );
}

// /admin/leadgen/sections/:id/edit — the full-page editor.
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
  const encodedId = encodeURIComponent(section.public_id);
  const offersRes = await apiJson<SectionOffersBody>(
    c.env,
    `/api/admin/leadgen/sections/${encodedId}/offers`,
  );
  const offerLabelById = new Map<number, string>();
  if (offersRes.ok) {
    for (const o of offersRes.body.offers) offerLabelById.set(o.id, o.offer_name);
  }
  // Any mapped Offer not in the activity/vertical list still needs a label.
  for (const m of section.answer_maps) {
    if (!offerLabelById.has(m.offer_id)) offerLabelById.set(m.offer_id, `#${m.offer_id}`);
  }

  return c.html(
    sectionEditorHtml(
      {
        section,
        offerLabelById,
        maps: toAnswerMapViews(section.answer_maps),
        summary: mappingSummaryOf(section.available_offers ?? []),
        mapsKeyConfigured: resolveBrowserMapsKey(c.env) !== null,
      },
      branding(c),
    ),
  );
}
