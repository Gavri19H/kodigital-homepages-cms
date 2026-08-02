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

// One blocking reason in the operator's own words. Blocks reuse the preflight
// card's composition ("Section: ZIP · Offer: NextInsure · Missing required
// provider fields: …"); problems use the server's own message.
export function publishBlockingReasons(
  preflight: ActivationPreflight,
): ReadonlyArray<{ text: string; fixUrl: string }> {
  const out: Array<{ text: string; fixUrl: string }> = [];
  for (const b of preflight.blocks) {
    const parts: string[] = [];
    if (b.section_name !== "") parts.push(`Section: ${b.section_name}`);
    if (b.offer_name !== "") parts.push(`Offer: ${b.offer_name}`);
    const fields = (b.fields ?? []).map((f) => (b.code === "offer_ineligible" ? eligibilityReasonLabel(f) : f));
    parts.push(preflightCodeLabel(b.code) + (fields.length > 0 ? `: ${fields.join(", ")}` : ""));
    out.push({ text: parts.join(" · "), fixUrl: b.fix_links?.section_mapping ?? "" });
  }
  for (const p of preflight.problems ?? []) {
    if (p.severity !== "error") continue;
    out.push({ text: p.message, fixUrl: typeof p.fix_url === "string" ? p.fix_url : "" });
  }
  return out;
}


function renderPublishReasons(preflight: ActivationPreflight): string {
  const reasons = publishBlockingReasons(preflight);
  if (reasons.length === 0) return "";
  const rows = reasons
    .map((r) => {
      const fix =
        r.fixUrl !== ""
          ? `<a class="lg-publish-why-fix" href="${escapeHtml(r.fixUrl)}">${escapeHtml(problemFixLabel(r.fixUrl))}</a>`
          : "";
      return `<li data-publish-reason>${escapeHtml(r.text)}${fix}</li>`;
    })
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
