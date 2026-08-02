// LeadGen admin UI — Quotes editor, ACTIVATION tab module (LEADGEN-REWORK-03
// §12 P3a mechanical split of ui-quotes.ts). The §17/05 §5.2 preflight panel
// (per-site activation rows + preflight blocks/problems) and the publish-chip
// renderer the composer's persistent head bar embeds (renderPublishBadge).
// PURE MOVE from ui-quotes.ts — zero logic/behavior change (P3a phase gate:
// test/leadgen-p3a-split-parity.test.ts asserts byte-identical SSR output).

import { escapeHtml } from "../../templates/layout";
import { eligibilityReasonLabel } from "../ui-offers";
import { type Problem } from "../../../public/leadgen/designs/theme";
import {
  type ActivationPreflightBlock,
  type ActivationPreflight,
  type ActivationBody,
  PREFLIGHT_BLOCK_CODE_LABELS,
  PROBLEM_SCOPE_ORDER,
  PROBLEM_SCOPE_LABELS,
  PREFLIGHT_PASS_CHECKS,
} from "./shared";


function preflightCodeLabel(code: string): string {
  return PREFLIGHT_BLOCK_CODE_LABELS[code] ?? code.replace(/_/g, " ");
}


// The deep-link label derives from the server-provided fix_url (§14.1 copy
// table: [Open Quote Builder] · [Review slide] · site Settings). Kept in
// lockstep with the island's ES5 problemFixLabel.
export function problemFixLabel(fixUrl: string): string {
  if (fixUrl.startsWith("/admin/settings")) return "Open site settings";
  if (fixUrl.includes("/sections/")) return "Review slide";
  if (fixUrl.includes("/quotes/")) return "Open Quote Builder";
  return "Fix";
}


// ---------------------------------------------------------------------------
// 14 §14.2 — the publish chip: "Blocked (2 errors)" / "Ready (3 warnings)".
// Counts: preflight blocks are error-class + the additive §3.6 problems split
// by severity. The ES5 re-renderer mirrors this EXACT copy.
// ---------------------------------------------------------------------------

function publishChipCounts(preflight: ActivationPreflight | null): { errors: number; warnings: number } {
  if (preflight === null) return { errors: 0, warnings: 0 };
  const problems = preflight.problems ?? [];
  return {
    errors: preflight.blocks.length + problems.filter((p) => p.severity === "error").length,
    warnings: problems.filter((p) => p.severity === "warning").length,
  };
}


function publishChipLabel(counts: { errors: number; warnings: number }): string {
  if (counts.errors > 0) return `Blocked (${counts.errors} ${counts.errors === 1 ? "error" : "errors"})`;
  if (counts.warnings > 0) return `Ready (${counts.warnings} ${counts.warnings === 1 ? "warning" : "warnings"})`;
  return "Ready";
}


// One 05 §5.2 blocking card — EXACTLY the operator copy pattern:
// "Section: ZIP · Offer: NextInsure · Missing required provider fields:
// current_insurance.carrier, current_insurance.carrier_months ·
// [Open Section Mapping] [Open Offer Payload Schema]".
function renderPreflightBlockCard(b: ActivationPreflightBlock): string {
  const parts: string[] = [];
  if (b.section_name !== "") parts.push(`Section: ${b.section_name}`);
  if (b.offer_name !== "") parts.push(`Offer: ${b.offer_name}`);
  const fields = (b.fields ?? []).map((f) => (b.code === "offer_ineligible" ? eligibilityReasonLabel(f) : f));
  parts.push(preflightCodeLabel(b.code) + (fields.length > 0 ? `: ${fields.join(", ")}` : ""));
  const links: string[] = [];
  if (b.fix_links?.section_mapping !== undefined && b.fix_links.section_mapping !== "") {
    links.push(
      `<a class="btn btn-sm btn-secondary" href="${escapeHtml(b.fix_links.section_mapping)}">Open Section Mapping</a>`,
    );
  }
  if (b.fix_links?.offer_schema !== undefined && b.fix_links.offer_schema !== "") {
    links.push(
      `<a class="btn btn-sm btn-secondary" href="${escapeHtml(b.fix_links.offer_schema)}">Open Offer Payload Schema</a>`,
    );
  }
  return `<div class="lg-preflight-block" data-preflight-code="${escapeHtml(b.code)}"><span>${escapeHtml(parts.join(" · "))}</span>${links.join("")}</div>`;
}


// One 14 §14.2 problem row: severity chip + operator message + the server
// fix_url as a deep link.
function renderProblemRow(p: Problem): string {
  const fixUrl = typeof p.fix_url === "string" ? p.fix_url : "";
  const fix =
    fixUrl !== ""
      ? `<a class="btn btn-sm btn-secondary" href="${escapeHtml(fixUrl)}">${escapeHtml(problemFixLabel(fixUrl))}</a>`
      : "";
  return `<div class="lg-problem-row" data-problem-severity="${escapeHtml(p.severity)}" data-problem-path="${escapeHtml(p.path)}"><span class="lg-problem-chip" data-severity="${escapeHtml(p.severity)}">${p.severity === "error" ? "Error" : "Warning"}</span><span class="lg-problem-msg">${escapeHtml(p.message)}</span>${fix}</div>`;
}


// The 14 §14.2 problems[] section: rows grouped by scope (frame / theme /
// section / component …) in the fixed order, unknown scopes appended.
function renderProblemsSection(problems: Problem[]): string {
  if (problems.length === 0) return "";
  const scopes: string[] = [...PROBLEM_SCOPE_ORDER];
  for (const p of problems) if (!scopes.includes(p.scope)) scopes.push(p.scope);
  const groups = scopes
    .map((scope) => {
      const rows = problems.filter((p) => p.scope === scope);
      if (rows.length === 0) return "";
      return `<div class="lg-problem-group" data-problem-scope="${escapeHtml(scope)}"><h4 class="lg-problem-group-title">${escapeHtml(PROBLEM_SCOPE_LABELS[scope] ?? scope)}</h4>${rows.map(renderProblemRow).join("")}</div>`;
    })
    .filter((g) => g !== "")
    .join("");
  return `<div id="lg-preflight-problems" data-problem-count="${problems.length}">${groups}</div>`;
}


// The 05 §5.2 UI preflight panel body: blocking cards when the server verdict
// fails; green itemized checks when clean; the 14 §14.2 problems[] groups
// appended whenever the additive rows exist (C2 LIVE: an error-severity
// problem is blocking — same rule as the activation PUT's 409).
// Server-verdict-driven only — the same markup the ES5 re-renderer rebuilds
// after variant save / activation PUT (including the 409 report body).
function renderPreflightPanelBody(preflight: ActivationPreflight | null): string {
  if (preflight === null) {
    return `<p class="form-help">Activation preflight is unavailable.</p>`;
  }
  const problems = preflight.problems ?? [];
  const problemsHtml = renderProblemsSection(problems);
  const hasErrorProblems = problems.some((p) => p.severity === "error");
  if (preflight.ok && !hasErrorProblems) {
    const items = PREFLIGHT_PASS_CHECKS.map(
      (check) => `<li data-preflight-check="${escapeHtml(check.id)}">&#10003; ${escapeHtml(check.label)}</li>`,
    ).join("");
    return `<p class="lg-preflight-ok-title">Ready to activate — all preflight checks pass.</p>
<ul class="lg-preflight-pass">${items}</ul>${problemsHtml}`;
  }
  const cards = preflight.blocks.map(renderPreflightBlockCard).join("");
  return `<p class="lg-preflight-blocked-title">Cannot activate this Quote.</p>${cards}${problemsHtml}`;
}


// blocked ⇔ the activation PUT would 409: blocks OR any error-severity
// problem (C2 LIVE); warnings never block.
function preflightStateAttr(preflight: ActivationPreflight | null): string {
  if (preflight === null) return "unknown";
  const hasErrorProblems = (preflight.problems ?? []).some((p) => p.severity === "error");
  return preflight.ok && !hasErrorProblems ? "pass" : "blocked";
}


// The head publish chip (05 §5.2 advisory → authoritative verdict, re-labeled
// per v2.5 14 §14.2 with counts: "Blocked (2 errors)" / "Ready (3 warnings)").
// Same id + data-publish-verdict contract the ES5 re-renderer updates.
export function renderPublishBadge(preflight: ActivationPreflight | null): string {
  if (preflight === null) return "";
  const counts = publishChipCounts(preflight);
  const verdict = preflight.ok && counts.errors === 0 ? "ok" : "blocked";
  return `<span id="lg-publish-badge" class="lg-chip lg-publish-chip" data-publish-verdict="${verdict}" data-publish-errors="${counts.errors}" data-publish-warnings="${counts.warnings}">${escapeHtml(publishChipLabel(counts))}</span>${renderPublishReasons(preflight)}`;
}


// ---------------------------------------------------------------------------
// R2 P7 (owner: "Blocked (2 errors)" — "what ARE the two errors?").
//
// The count alone is not an affordance: the reasons existed ONLY inside the
// Activation tab's preflight panel, so the operator had to leave the tab they
// were standing on to learn why they were blocked. This is the SAME shape P5
// already closed for ADJ-A9 (a bare 409 the operator could not predict): state
// the requirement BEFORE / WITHOUT the failing action. So the head bar now
// spells the reasons out next to the chip, with each reason's own deep link.
//
// Reason ORDER is the chip's own count order — preflight blocks first, then
// error-severity problems — so "Blocked (N errors)" and the list always agree
// on N. The ES5 re-renderer (quotes-tabs/funnel.ts updatePublishBadge) rebuilds
// this EXACT structure from the same two arrays.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// R2 P7 FIX-FIRST (owner, D1). The first cut of this panel labelled EVERY
// self-referential fix_url "Open Quote Builder" — offered to an operator who is
// ALREADY standing in the Quote Builder, on the very tab that holds the thing
// to fix. That is the SAME ADJ-A9 shape the owner rejected once ("set one up
// from the A/B tab", shown while on the A/B tab), reproduced by the fix for it.
//
// So a reason now carries a TARGET: the in-page control that CLEARS it (an
// editor sub-tab + a CSS selector + the operator copy naming that control).
// The island reveals it — switch tabs ONLY when the target lives on another
// tab, then scroll/focus/flash the affordance itself.
//
// Where no single control clears a reason, the reason carries NO target and NO
// link: a link that lands on the screen the operator is already on is worse
// than no link. `activation.section_uniqueness` (the same section sits on two
// pages — either copy can go, so there are two candidate controls, not one) is
// the deliberate no-target case.
// ---------------------------------------------------------------------------

export interface PublishFixTarget {
  tab: string; // the editor sub-tab that owns the control ("" = already here)
  sel: string; // CSS selector of the control that clears the reason
  label: string; // the operator copy naming that control
}

// A fix_url that IS this editor page. `problemFixLabel` calls it "Open Quote
// Builder"; on the Quote Builder itself it is a link to nowhere.
export function isQuoteEditorSelfLink(fixUrl: string): boolean {
  return /^\/admin\/leadgen\/quotes\/[A-Za-z0-9_-]+\/edit$/.test(fixUrl);
}

// public_ids are ULID-shaped (`lgf_01H…`); anything else never reaches a
// selector — an unexpected id degrades to "no target" rather than injecting.
function safeId(id: string): string {
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : "";
}

// The audited path → control map. Every error-severity `Problem.path` the
// activation preflight can emit is listed; `""` (a preflight block, which has
// no path) and any unlisted path fall through to null and keep their genuine
// cross-screen fix_link (Open Section Mapping / Review slide / site settings).
export function publishFixTarget(path: string, fixUrl: string): PublishFixTarget | null {
  if (path === "activation.shared_page") {
    return {
      tab: "builder",
      sel: "[data-shared-col] [data-add-shared-section]",
      label: "Add the shared page's first section",
    };
  }
  if (path.indexOf("activation.funnel.") === 0) {
    const pid = safeId(path.slice("activation.funnel.".length));
    if (pid === "") return null;
    // querySelector returns the FIRST match in document order: a funnel that
    // HAS a page card resolves to that card's "＋ section"; an empty funnel
    // column has no page card, so it resolves to its "+ Add page".
    const col = `[data-funnel-col][data-funnel-public-id="${pid}"]`;
    return { tab: "builder", sel: `${col} [data-add-section],${col} [data-add-page]`, label: "Add a section to this funnel" };
  }
  if (path === "activation.default_funnel") {
    // "Set as default" lives in a funnel column's own kebab menu, so the
    // control is per-funnel: land on the first funnel column's options button
    // (the operator still chooses WHICH funnel is default).
    return { tab: "builder", sel: "[data-funnel-col] [data-funnel-kebab]", label: "Set a default funnel" };
  }
  if (path.indexOf("activation.rule.") === 0) {
    const pid = safeId(path.slice("activation.rule.".length));
    if (pid === "") return null;
    return { tab: "builder", sel: `[data-qr-card][data-rule-public-id="${pid}"]`, label: "Open this rule" };
  }
  // Schema/validation rows on the funnel layout and theme. Their paths address
  // CONFIG keys (`frame.trust_strip.logos[0].alt`, `theme.palette.accent`),
  // and the Templates/Themes panels key their controls on a different
  // vocabulary (data-frame-key / data-role-pick), so the honest target is the
  // owning tab — still a real jump AWAY from where the operator stands.
  if (path === "frame" || path.indexOf("frame.") === 0) {
    return { tab: "templates", sel: '.lg-qpanel[data-panel="templates"]', label: "Open the Templates tab" };
  }
  if (path === "theme" || path.indexOf("theme.") === 0) {
    return { tab: "themes", sel: '.lg-qpanel[data-panel="themes"]', label: "Open the Themes tab" };
  }
  void fixUrl;
  return null;
}

// One blocking reason in the operator's own words. Blocks reuse the preflight
// card's composition ("Section: ZIP · Offer: NextInsure · Missing required
// provider fields: …"); problems use the server's own message.
export function publishBlockingReasons(
  preflight: ActivationPreflight,
): ReadonlyArray<{ text: string; fixUrl: string; target: PublishFixTarget | null }> {
  const out: Array<{ text: string; fixUrl: string; target: PublishFixTarget | null }> = [];
  for (const b of preflight.blocks) {
    const parts: string[] = [];
    if (b.section_name !== "") parts.push(`Section: ${b.section_name}`);
    if (b.offer_name !== "") parts.push(`Offer: ${b.offer_name}`);
    const fields = (b.fields ?? []).map((f) => (b.code === "offer_ineligible" ? eligibilityReasonLabel(f) : f));
    parts.push(preflightCodeLabel(b.code) + (fields.length > 0 ? `: ${fields.join(", ")}` : ""));
    const fixUrl = b.fix_links?.section_mapping ?? "";
    out.push({ text: parts.join(" · "), fixUrl, target: publishFixTarget("", fixUrl) });
  }
  for (const p of preflight.problems ?? []) {
    if (p.severity !== "error") continue;
    const fixUrl = typeof p.fix_url === "string" ? p.fix_url : "";
    out.push({ text: p.message, fixUrl, target: publishFixTarget(p.path, fixUrl) });
  }
  return out;
}


// The reason's affordance: the in-page target button when one exists, else the
// genuine cross-screen link, else NOTHING (never a link back to this page).
// The ES5 re-renderer builds the same three branches.
export function renderPublishReasonFix(r: { fixUrl: string; target: PublishFixTarget | null }): string {
  if (r.target !== null) {
    return `<button type="button" class="lg-publish-why-fix" data-publish-fix-tab="${escapeHtml(r.target.tab)}" data-publish-fix-sel="${escapeHtml(r.target.sel)}">${escapeHtml(r.target.label)}</button>`;
  }
  if (r.fixUrl !== "" && !isQuoteEditorSelfLink(r.fixUrl)) {
    return `<a class="lg-publish-why-fix" href="${escapeHtml(r.fixUrl)}">${escapeHtml(problemFixLabel(r.fixUrl))}</a>`;
  }
  return "";
}


function renderPublishReasons(preflight: ActivationPreflight): string {
  const reasons = publishBlockingReasons(preflight);
  if (reasons.length === 0) return "";
  const rows = reasons
    .map((r) => `<li data-publish-reason>${escapeHtml(r.text)}${renderPublishReasonFix(r)}</li>`)
    .join("");
  return `<div id="lg-publish-why" class="lg-publish-why" data-publish-why-count="${reasons.length}" role="group" aria-label="Why this Quote cannot be published"><span class="lg-publish-why-title">To publish, fix ${reasons.length === 1 ? "this" : `these ${reasons.length}`}:</span><ol class="lg-publish-why-list">${rows}</ol></div>`;
}


// Activation panel (§17 per-site + the 05 §5.2 preflight panel).
export function renderActivationPanel(activation: ActivationBody | null): string {
  const preflight = activation?.activation_preflight ?? null;
  const sites = activation?.sites ?? [];
  const rows = sites
    .map(
      (s) => `<div class="lg-activation-row" data-site-id="${escapeHtml(s.site_id)}">
  <label class="lg-check"><input type="checkbox" data-site-enabled${s.enabled ? " checked" : ""} /> ${escapeHtml(s.site_name)}</label>
  <input class="form-input" data-site-slug placeholder="slug (blank = root /lg)" value="${escapeHtml(s.slug ?? "")}" />
  <a href="${escapeHtml(s.preview_url)}" class="form-help" data-preview-url target="_blank" rel="noopener">${escapeHtml(s.preview_url)}</a>
  <button type="button" class="btn btn-sm btn-secondary" data-save-activation>Save</button>
  <button type="button" class="btn btn-sm btn-outline" data-deactivate>Deactivate</button>
</div>`,
    )
    .join("");
  return `<div class="lg-qpanel" data-panel="activation">
  <div class="card">
    <h3>Activation preflight (§5.2)</h3>
    <div id="lg-preflight-panel" data-preflight-state="${preflightStateAttr(preflight)}">${renderPreflightPanelBody(preflight)}</div>
  </div>
  <div class="card">
    <h3>Site activation (§17)</h3>
    <p class="form-help">At most one enabled root (blank slug) per site (§17.1). Activating a second root while one is enabled is rejected — disable it or set a slug.</p>
    <div id="lg-activation-list">${rows || `<p class="form-help" data-empty-activation>No sites available.</p>`}</div>
  </div>
</div>`;
}
