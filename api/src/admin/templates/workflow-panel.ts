// Admin Article editor — Publish workflow panel + version history/restore
// (T14c legacy port). Composed into articleFormPage (./articles) below the
// hero image card in EDIT mode only — the workflow actions wire to
// /api/admin/articles/:id/* and the version endpoints, so they need a
// persisted article id (a brand-new, unsaved article has nothing to publish
// or version yet, matching the legacy editor which only shows the workflow
// panel for an existing article).
//
// Workflow endpoint contract (admin/workflow-api.ts — AUTHORITATIVE):
//   POST /api/admin/articles/:id/publish
//   POST /api/admin/articles/:id/unpublish
//   POST /api/admin/articles/:id/archive
//   POST /api/admin/articles/:id/schedule          {scheduled_at: epoch sec}
//   POST /api/admin/articles/:id/cancel-schedule
//   GET  /api/admin/articles/:id/versions          -> {versions:[...]}
//   POST /api/admin/articles/:id/versions/:vid/restore
// Each control is wired to its endpoint by the inline script
// (./workflow-panel-script); the status-mutating actions assert the JSON
// 2xx response shape and reflect the new status into the badge.
//
// HARD CONTRACT (es5-inline-scripts rule / L-014): workflowPanelScripts is an
// ES5-only string — no arrow functions, no const/let, no template literals
// INSIDE the literal. (Re-exported here so callers keep one ./workflow-panel
// import, mirroring the ai-panel / hero-image decomposition.)

import { escapeHtml } from "./layout";

export { workflowPanelScripts } from "./workflow-panel-script";

// The five publish-workflow transition actions. The data-workflow-action
// value is BOTH the routing key the inline script reads AND the endpoint
// path segment (POST /api/admin/articles/:id/<action>), so the served
// markup names every wired endpoint.
const WORKFLOW_ACTIONS: ReadonlyArray<{
  action: string;
  label: string;
  variant: string;
}> = [
  { action: "publish", label: "Publish", variant: "btn-primary" },
  { action: "unpublish", label: "Unpublish", variant: "btn-secondary" },
  { action: "archive", label: "Archive", variant: "btn-danger" },
];

function renderActionButton(a: {
  action: string;
  label: string;
  variant: string;
}): string {
  return `<button type="button" class="btn ${a.variant} btn-sm workflow-action" data-workflow-action="${a.action}">${escapeHtml(a.label)}</button>`;
}

// `articleId` / `status` pre-populate the wiring + initial badge. Both are
// empty for a brand-new article — in which case the panel is omitted (the
// transitions have no target id yet). Returns "" so the caller can compose
// unconditionally.
export function renderWorkflowPanel(
  articleId?: string,
  status?: string,
): string {
  const id = articleId == null ? "" : String(articleId);
  if (!id) return "";
  const idAttr = escapeHtml(id);
  const statusVal = escapeHtml(status ?? "draft");
  const actions = WORKFLOW_ACTIONS.map(renderActionButton).join("");
  return `<section class="card workflow-panel" id="workflow-panel" data-article-id="${idAttr}" data-status="${statusVal}">
  <div class="card-header"><h3 class="card-title">Publish workflow</h3></div>
  <p class="workflow-current">Current status: <span id="workflow-status-value" class="badge badge-${statusVal}">${statusVal}</span></p>
  <div class="workflow-actions" role="group" aria-label="Publish workflow actions">
    ${actions}
  </div>
  <div class="workflow-schedule">
    <label for="workflow-schedule-at" class="form-label">Schedule publish</label>
    <div class="workflow-schedule-row">
      <input id="workflow-schedule-at" name="scheduled_at" type="datetime-local" class="form-input workflow-schedule-input" />
      <button type="button" class="btn btn-primary btn-sm workflow-action" data-workflow-action="schedule">Schedule</button>
      <button type="button" class="btn btn-secondary btn-sm workflow-action" data-workflow-action="cancel-schedule">Cancel schedule</button>
    </div>
  </div>
  <div class="workflow-history">
    <button type="button" id="workflow-versions-open" class="btn btn-secondary btn-sm">Version history</button>
  </div>
  <p id="workflow-error" class="alert alert-error" hidden role="alert"></p>
  <p id="workflow-status" class="form-status" role="status" aria-live="polite"></p>

  <div class="workflow-versions-overlay" id="workflow-versions-modal" hidden role="dialog" aria-modal="true" aria-labelledby="workflow-versions-title">
    <div class="workflow-versions-modal">
      <div class="workflow-versions-modal-header">
        <h3 class="card-title" id="workflow-versions-title">Version history</h3>
        <button type="button" id="workflow-versions-close" class="workflow-versions-close" aria-label="Close">&times;</button>
      </div>
      <p id="workflow-versions-status" class="form-status" role="status" aria-live="polite"></p>
      <p id="workflow-versions-error" class="alert alert-error" hidden role="alert"></p>
      <ul class="workflow-versions-list" id="workflow-versions-list" aria-label="Article versions"></ul>
      <div class="workflow-versions-modal-actions">
        <button type="button" id="workflow-versions-cancel" class="btn btn-secondary btn-sm">Close</button>
      </div>
    </div>
  </div>
</section>`;
}

export const workflowPanelStyles = `
.workflow-panel{margin-top:16px}
.workflow-current{font-size:13px;color:var(--c-muted);margin:0 0 8px}
.workflow-actions{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.workflow-schedule{margin:8px 0}
.workflow-schedule-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.workflow-schedule-input{max-width:240px}
.workflow-history{margin-top:12px}
.workflow-status{font-size:13px;color:var(--c-muted);min-height:1em;margin:8px 0 0}
.workflow-versions-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;padding:16px;z-index:1000}
.workflow-versions-overlay[hidden]{display:none}
.workflow-versions-modal{background:var(--c-surface,#fff);border-radius:8px;padding:16px;max-width:520px;width:100%;max-height:90vh;overflow:auto}
.workflow-versions-modal-header{display:flex;align-items:center;justify-content:space-between}
.workflow-versions-close{background:none;border:0;font-size:24px;line-height:1;cursor:pointer;color:var(--c-muted)}
.workflow-versions-list{list-style:none;margin:12px 0;padding:0;display:flex;flex-direction:column;gap:8px}
.workflow-version{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--c-border,#e5e7eb);border-radius:6px}
.workflow-version-meta{font-size:12px;color:var(--c-muted)}
.workflow-version-num{font-weight:600;color:inherit}
.workflow-versions-modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
`;
