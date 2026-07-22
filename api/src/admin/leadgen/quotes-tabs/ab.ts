// LeadGen admin UI — Quotes editor, A/B tab module (LEADGEN-REWORK-03 §12
// P3a mechanical split of ui-quotes.ts). The per-funnel A/B test view
// (allocation rows + "what varies" diff between a variant and its control).
// PURE MOVE from ui-quotes.ts — zero logic/behavior change (P3a phase gate:
// test/leadgen-p3a-split-parity.test.ts asserts byte-identical SSR output).

import { escapeHtml } from "../../templates/layout";
import {
  type VariantNode,
  type StructureBody,
  OVERRIDE_GROUP_LABELS,
  primaryVariantOf,
} from "./shared";


// §4.5 — the operator labels of the groups a sparse frame_overrides_json
// patch overrides (frame groups + `theme` palette; version/template are
// funnel-level and never listed).
function overriddenGroupLabels(overrides: Record<string, unknown> | null): string[] {
  if (overrides === null || typeof overrides !== "object") return [];
  const labels: string[] = [];
  for (const key of Object.keys(overrides)) {
    if (key === "version" || key === "template") continue;
    const value = overrides[key];
    if (value === null || typeof value !== "object" || Object.keys(value as Record<string, unknown>).length === 0) continue;
    labels.push(OVERRIDE_GROUP_LABELS[key] ?? key.replace(/_/g, " "));
  }
  return labels;
}


// P6b (deliverable 5) — per-variant "what varies" summary: the SAME per-arm
// override groups overriddenGroupLabels already exposes (theme/frame keys),
// PLUS whether this arm's template (funnel_design_id), ordered sections, or
// rule set differ from the CONTROL arm — the "whole-quote template-level
// testing" reframe's promised template/theme/sections/rules comparison.
// Structural signature compares only (never content), so a re-ordered
// section list or a renamed rule that changes nothing meaningful still
// reads as "differs" — a coarse but honest (no false-negative) summary.
function sectionSignature(v: VariantNode): string {
  return v.sections.map((s) => s.section_public_id).join(",");
}


function ruleSignature(v: VariantNode): string {
  return v.rules
    .map((r) => `${r.rule_type}:${r.target_offer_id ?? ""}:${r.target_section_id ?? ""}:${r.redirect_url ?? ""}`)
    .sort()
    .join("|");
}


function variantWhatVaries(control: VariantNode, variant: VariantNode): string {
  if (variant.public_id === control.public_id) return "Control";
  const parts: string[] = [];
  if (variant.funnel_design_id !== control.funnel_design_id) parts.push("template");
  const overrideGroups = overriddenGroupLabels(variant.frame_overrides_json);
  if (overrideGroups.length > 0) parts.push(overrideGroups.join(" & "));
  if (sectionSignature(variant) !== sectionSignature(control)) parts.push("sections");
  if (ruleSignature(variant) !== ruleSignature(control)) parts.push("rules");
  return parts.length > 0 ? `Differs from control: ${parts.join(", ")}` : "Same as control (no differences yet)";
}


// A/B panel (§16.2) — per-variant percent allocation (stored as basis points),
// a live Σ indicator, the test lifecycle (create / start / stop), and an
// assignment preview. Scoped to the SELECTED variant's funnel (its arms).
//
// P6b reframe (operator restructure spec): this tab is now presented as
// WHOLE-QUOTE template-level testing, not just a "fork this variant" arm
// manager — "Add variant" (below) forks + immediately prompts the traffic
// split (the SAME §16.2 fork+allocation mechanism "Fork this variant" and
// the Themes tab's "A/B this theme" both use), and every row's what-varies
// line (variantWhatVaries) names what actually differs from control.
export function renderAbPanel(structure: StructureBody, selected: VariantNode): string {
  const funnel =
    structure.funnels.find((f) => f.funnel_id === selected.funnel_id) ?? structure.funnels[0] ?? null;
  const variants = funnel?.variants ?? [];
  // Rework M1 replacement semantics — see primaryVariantOf's doc comment.
  const control = primaryVariantOf(variants);
  const tests = funnel?.ab_tests ?? [];
  const running = tests.find((t) => t.status === "running") ?? null;
  const activeTest = running ?? tests[0] ?? null; // ab_tests are newest-first

  // Per-variant percent input. UI shows % (bp/100); the client stores bp (%*100).
  const allocRows = variants
    .map((v) => {
      const pct = v.traffic_allocation_bp / 100;
      // §4.5 — the overridden frame/theme groups of this arm (sparse
      // frame_overrides_json keys → operator labels).
      const groups = overriddenGroupLabels(v.frame_overrides_json);
      const overridesLine =
        groups.length > 0
          ? `<p class="form-help" data-arm-overrides="${escapeHtml(v.public_id)}">Funnel-layout overrides: ${escapeHtml(groups.join(", "))}</p>`
          : `<p class="form-help" data-arm-overrides="${escapeHtml(v.public_id)}">Same layout as funnel (no overrides)</p>`;
      const varianceLine =
        control !== null
          ? `<p class="form-help" data-arm-variance="${escapeHtml(v.public_id)}">${escapeHtml(variantWhatVaries(control, v))}</p>`
          : "";
      return `<div class="lg-alloc-row" data-variant="${escapeHtml(v.public_id)}">
    <span class="lg-alloc-label"><strong>${escapeHtml(v.variant_label)}</strong></span>
    <label class="lg-alloc-pct"><input type="number" class="form-input lg-alloc-input" data-alloc-input
      data-variant-id="${escapeHtml(v.public_id)}" data-variant-label="${escapeHtml(v.variant_label)}"
      min="0" max="100" step="0.01" value="${escapeHtml(String(pct))}" /> %</label>
    ${overridesLine}
    ${varianceLine}
  </div>`;
    })
    .join("");

  let lifecycle: string;
  if (running !== null) {
    lifecycle = `<span class="lg-ab-status" data-ab-status="running">Running · rev ${running.revision}</span>
      <button type="button" class="btn btn-outline" data-stop-experiment="${escapeHtml(running.public_id)}">Stop A/B test</button>`;
  } else if (activeTest !== null) {
    lifecycle = `<span class="lg-ab-status" data-ab-status="${escapeHtml(activeTest.status)}">${escapeHtml(activeTest.status)} · rev ${activeTest.revision}</span>
      <button type="button" class="btn btn-secondary" data-start-experiment="${escapeHtml(activeTest.public_id)}">Start A/B test</button>`;
  } else {
    lifecycle = `<button type="button" id="lg-create-experiment" class="btn btn-secondary" data-quote-public-id="${escapeHtml(structure.quote.public_id)}">Create A/B test</button>`;
  }

  const preview =
    activeTest !== null
      ? `<div class="card lg-ab-preview">
    <h3>Assignment preview (§16.2)</h3>
    <p class="form-help">Enter a sample session id to see which variant it deterministically buckets to (the same edge hash the runtime serves).</p>
    <div class="lg-ab-preview-row">
      <input type="text" class="form-input" id="lg-ab-preview-session" placeholder="sample ko_sid value" />
      <button type="button" class="btn btn-outline" data-preview-assignment="${escapeHtml(activeTest.public_id)}">Preview assignment</button>
    </div>
    <p class="form-help" id="lg-ab-preview-result" data-ab-preview-result></p>
  </div>`
      : "";

  return `<div class="lg-qpanel" data-panel="ab">
  <div class="card">
    <h3>Traffic allocation (§16.2)</h3>
    <p class="form-help">Test this whole quote against a variant of itself — a different template, theme, sections, or rules. Add a variant, decide what changes on it, then split the traffic below (must sum to <strong>100%</strong>; stored as basis points, per-test Σ == 10000) before a test can start.</p>
    <div id="lg-ab-variant-list" class="lg-alloc-list">${allocRows || `<p class="form-help">No variants.</p>`}</div>
    <p class="lg-alloc-summary">Σ = <strong data-alloc-sum>&mdash;</strong> <span data-alloc-sum-note class="form-help"></span></p>
    <div class="toolbar">
      <button type="button" id="lg-save-allocations" class="btn btn-primary">Save allocations</button>
      <button type="button" id="lg-add-variant" class="btn btn-secondary">Add variant&#8230;</button>
      <button type="button" class="btn btn-outline" data-fork-variant="${escapeHtml(selected.public_id)}">Fork this variant</button>
      ${lifecycle}
    </div>
  </div>
  ${preview}
</div>`;
}
