// LeadGen admin UI — Quotes editor, A/B tab module. LEADGEN-REWORK-03 §8.5:
// the consolidated per-funnel test view (traffic allocation + template A/B +
// lifecycle). Rework M1 (§4.3-10): NO control concept — with no running test a
// funnel has exactly one active variant; the deterministic head (variant_label
// ASC) is just the "base" arm, never a "control". All "(control)" / "Differs
// from control" / "Same as control" copy is REMOVED (plain variant labels +
// what each arm overrides). §8.5 also ADDS the delete-variant affordance
// (DELETE /variants/:id + its running-test / last-active guards → the island
// renders the server's 409 message); this closes the known gap.

import { escapeHtml } from "../../templates/layout";
import {
  type VariantNode,
  type StructureBody,
  OVERRIDE_GROUP_LABELS,
  primaryVariantOf,
} from "./shared";


// §4.5 — the operator labels of the groups a sparse frame_overrides_json patch
// overrides (frame groups + `theme` palette; version/template are funnel-level
// and never listed). No control comparison — this is purely "what THIS arm
// changes from the funnel baseline".
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


// One arm's "what this arm changes" line — plain, no control vocabulary. Lists
// this arm's frame/theme override groups and whether it carries an A/B template
// override (M5 frame_template_id). The base (first-by-label) arm just reads
// "Base variant".
function variantVariesLine(primary: VariantNode | null, variant: VariantNode): string {
  const parts: string[] = [];
  const groups = overriddenGroupLabels(variant.frame_overrides_json);
  if (groups.length > 0) parts.push(groups.join(" & "));
  if (variant.frame_template_id !== null && variant.frame_template_id !== undefined) {
    if (primary === null || variant.frame_template_id !== primary.frame_template_id) parts.push("template");
  }
  if (primary !== null && variant.public_id === primary.public_id && parts.length === 0) return "Base variant";
  return parts.length > 0 ? `Varies: ${parts.join(", ")}` : "No layout or template changes yet";
}


// A/B panel (§8.5) — per-variant percent allocation (stored as basis points), a
// live Σ indicator, the test lifecycle (create / start / stop), per-arm
// delete, and an assignment preview. Scoped to the SELECTED variant's funnel
// (its arms). No control label anywhere; the funnel's single active variant
// with no running test is just its one arm.
export function renderAbPanel(structure: StructureBody, selected: VariantNode): string {
  const funnel =
    structure.funnels.find((f) => f.funnel_id === selected.funnel_id) ?? structure.funnels[0] ?? null;
  const variants = funnel?.variants ?? [];
  const primary = primaryVariantOf(variants);
  const tests = funnel?.ab_tests ?? [];
  const running = tests.find((t) => t.status === "running") ?? null;
  const activeTest = running ?? tests[0] ?? null; // ab_tests are newest-first
  const canDeleteArm = variants.length > 1 && running === null;

  // P6 fixes3 (E1) — the ADJ-A9 treatment applied to "Add variant". The server
  // (quotes-handlers.ts forkVariantHandler) allows a SECOND active variant only
  // as the bootstrap of a RUNNING test's 2nd arm; every other state 409s with
  // "…set one up from the A/B tab" — which is where the operator already IS.
  // Same shape the owner rejected once as ADJ-A9 (a requirement only learnable
  // by triggering the failure), so it gets the same fix: state the requirement
  // BEFORE the failing action. The button now carries the server's own
  // precondition, and the required order is written on the tab.
  const activeVariants = variants.filter((v) => (v.status ?? "active") === "active");
  const addVariantState =
    activeVariants.length === 0 || (running !== null && activeVariants.length === 1)
      ? "ready" // matches forkVariantHandler: no active variant at all, or the 1→2 arm bootstrap
      : running !== null
        ? "arms-frozen" // a running test's arm SET is frozen (a 3rd arm is never allowed)
        : activeTest !== null
          ? "not-running" // a test exists but is draft/stopped — start it first
          : "no-test"; // the pre-A/B state — create the test first
  const ADD_VARIANT_REASONS: Record<string, string> = {
    "no-test":
      'a second variant exists only as an arm of a RUNNING A/B test, and this funnel has no test yet — press "Create A/B test", then "Start A/B test", then add the variant.',
    "not-running": `a second variant exists only as an arm of a RUNNING A/B test, and this funnel's test is ${activeTest?.status ?? "not running"} — press "Start A/B test" first, then add the variant.`,
    "arms-frozen": `this running test already has its ${activeVariants.length} arms and the arm set is frozen while it runs — press "Stop A/B test" first, then change the arms.`,
  };
  const addVariantReason = ADD_VARIANT_REASONS[addVariantState] ?? "";
  const addVariantAttrs =
    addVariantState === "ready"
      ? ""
      : ` disabled aria-disabled="true" aria-describedby="lg-add-variant-why" title="${escapeHtml(addVariantReason)}"`;
  const addVariantWhy =
    addVariantState === "ready"
      ? ""
      : `\n    <p class="form-help lg-ab-add-why" id="lg-add-variant-why" data-add-variant-blocked="${escapeHtml(addVariantState)}" role="status">&#9888; <strong>Add variant is unavailable:</strong> ${escapeHtml(addVariantReason)}</p>`;

  const allocRows = variants
    .map((v) => {
      const pct = v.traffic_allocation_bp / 100;
      const groups = overriddenGroupLabels(v.frame_overrides_json);
      const overridesLine =
        groups.length > 0
          ? `<p class="form-help" data-arm-overrides="${escapeHtml(v.public_id)}">Funnel-layout overrides: ${escapeHtml(groups.join(", "))}</p>`
          : `<p class="form-help" data-arm-overrides="${escapeHtml(v.public_id)}">Same layout as funnel (no overrides)</p>`;
      const variesLine = `<p class="form-help" data-arm-varies="${escapeHtml(v.public_id)}">${escapeHtml(variantVariesLine(primary, v))}</p>`;
      // §8.5 delete-variant: hard-guarded server-side (running test → 409; the
      // funnel's last active variant → 409). Offered only when a delete could
      // possibly succeed; the island still renders the server's message if the
      // race loses. Absent (not disabled) when it can't apply — no dead control.
      const deleteBtn = canDeleteArm
        ? `<button type="button" class="btn btn-sm btn-danger" data-delete-variant="${escapeHtml(v.public_id)}" data-variant-label="${escapeHtml(v.variant_label)}">Delete variant</button>`
        : "";
      return `<div class="lg-alloc-row" data-variant="${escapeHtml(v.public_id)}">
    <span class="lg-alloc-label"><strong>${escapeHtml(v.variant_label)}</strong></span>
    <label class="lg-alloc-pct"><input type="number" class="form-input lg-alloc-input" data-alloc-input
      data-variant-id="${escapeHtml(v.public_id)}" data-variant-label="${escapeHtml(v.variant_label)}"
      min="0" max="100" step="0.01" value="${escapeHtml(String(pct))}" /> %</label>
    ${overridesLine}
    ${variesLine}
    ${deleteBtn}
    <p class="form-help lg-hidden" data-delete-variant-err="${escapeHtml(v.public_id)}" role="alert"></p>
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
    <p class="form-help">Test this funnel against variants of itself — a different template, theme, sections, or rules. Add a variant, change what you want on it, then split the traffic below (must sum to <strong>100%</strong>; stored as basis points, per-test Σ == 10000) before a test can start. Equal arms; no control.</p>
    <div id="lg-ab-variant-list" class="lg-alloc-list">${allocRows || `<p class="form-help">No variants.</p>`}</div>
    <p class="lg-alloc-summary">Σ = <strong data-alloc-sum>&mdash;</strong> <span data-alloc-sum-note class="form-help"></span></p>
    <div class="toolbar">
      <button type="button" id="lg-save-allocations" class="btn btn-primary">Save allocations</button>
      <button type="button" id="lg-add-variant" class="btn btn-secondary" data-add-variant-state="${escapeHtml(addVariantState)}"${addVariantAttrs}>Add variant&#8230;</button>
      ${lifecycle}
    </div>
    <p class="form-help lg-ab-order" data-ab-order>Order to A/B this funnel: <strong>1.</strong> Create A/B test &rarr; <strong>2.</strong> Start A/B test &rarr; <strong>3.</strong> Add variant (it becomes the test&#39;s second arm, split 50/50). Until a test is running the funnel keeps exactly one variant.</p>${addVariantWhy}
  </div>
  ${preview}
</div>`;
}
