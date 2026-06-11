// Admin AI Generations list template.
// Renders the paged ai_generations table at /admin/ai-generations.
// Columns: task, model, prompt_version, status, target_type,
// created_at, error_message. The detail link points to
// /admin/ai-generations/:id which renders aiGenerationDetailPage.
//
// The HTML row exposes data-ai-generation-id (and column data-key
// `ai_generation_id`) so admin tabs that need to deep-link to the
// generation record from articles / pages / provisioning jobs can read
// it from the DOM via a single selector.

import { adminLayout, escapeHtml } from "./layout";

export interface AiGenerationListEntry {
  id: string;
  task: string;
  model: string;
  prompt_version: string;
  status: string;
  target_type: string | null;
  created_at: number | string | null;
  error_message: string | null;
}

export interface AiGenerationsListBranding {
  userEmail?: string;
}

export interface AiGenerationsPaging {
  page: number;
  page_size: number;
  total: number;
  next_url?: string | null;
  prev_url?: string | null;
}

function renderRow(g: AiGenerationListEntry): string {
  const id = escapeHtml(g.id);
  const task = escapeHtml(g.task);
  const model = escapeHtml(g.model);
  const promptVersion = escapeHtml(g.prompt_version);
  const status = escapeHtml(g.status);
  const targetType = escapeHtml(g.target_type ?? "");
  const createdAt = escapeHtml(g.created_at ?? "");
  const err = escapeHtml(g.error_message ?? "");
  const detailHref = `/admin/ai-generations/${id}`;
  // data-ai-generation-id + the column with data-key="ai_generation_id"
  // give DOM consumers a stable selector for cross-tab deep links.
  return `<tr data-ai-generation-id="${id}">
  <td data-key="ai_generation_id"><a href="${detailHref}">${id}</a></td>
  <td>${task}</td>
  <td>${model}</td>
  <td>${promptVersion}</td>
  <td><span class="badge badge-${status}">${status}</span></td>
  <td>${targetType}</td>
  <td>${createdAt}</td>
  <td>${err}</td>
</tr>`;
}

function renderTable(rows: ReadonlyArray<AiGenerationListEntry>): string {
  const body =
    rows.length === 0
      ? `<tr><td colspan="8" class="empty-state">No AI generations recorded yet</td></tr>`
      : rows.map(renderRow).join("");
  return `<div class="card">
  <div class="table-wrapper">
    <table class="table ai-generations-list" aria-label="AI generations list">
      <thead><tr>
        <th scope="col">ai_generation_id</th>
        <th scope="col">Task</th>
        <th scope="col">Model</th>
        <th scope="col">Prompt version</th>
        <th scope="col">Status</th>
        <th scope="col">Target type</th>
        <th scope="col">Created</th>
        <th scope="col">Error</th>
      </tr></thead>
      <tbody id="ai-generations-list-body" data-empty="No AI generations recorded yet">${body}</tbody>
    </table>
  </div>
</div>`;
}

function renderPaging(p: AiGenerationsPaging): string {
  const prev =
    p.prev_url && p.page > 1
      ? `<a class="btn btn-sm btn-secondary" href="${escapeHtml(p.prev_url)}">&larr; Previous</a>`
      : `<span class="btn btn-sm btn-secondary" aria-disabled="true">&larr; Previous</span>`;
  const lastPage = Math.max(1, Math.ceil(p.total / Math.max(1, p.page_size)));
  const next =
    p.next_url && p.page < lastPage
      ? `<a class="btn btn-sm btn-secondary" href="${escapeHtml(p.next_url)}">Next &rarr;</a>`
      : `<span class="btn btn-sm btn-secondary" aria-disabled="true">Next &rarr;</span>`;
  return `<nav class="paging" aria-label="Pagination">
  ${prev}
  <span class="paging-info">Page ${p.page} of ${lastPage} (${p.total} total)</span>
  ${next}
</nav>`;
}

export function aiGenerationsListPage(
  rows: ReadonlyArray<AiGenerationListEntry>,
  paging: AiGenerationsPaging,
  branding: AiGenerationsListBranding = {},
): string {
  const content = `${renderTable(rows)}${renderPaging(paging)}`;
  return adminLayout({
    title: "AI Generations",
    activePath: "/admin/ai-generations",
    userEmail: branding.userEmail,
    content,
  });
}
