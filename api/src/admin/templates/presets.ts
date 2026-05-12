// Admin AI Presets templates.
// presetsListPage — read-only list of registered AI presets (id, label,
// model, scope). Renders inside the legacy adminLayout shell so the
// sidebar nav (Dashboard, Domains, Articles, Pages, Media, Categories,
// Tags, AI Presets, Settings) and brand 'KoDigital CMS' stay consistent
// with the other admin tabs. No site filter — presets are global today.

import { adminLayout } from "./layout";

export interface PresetListEntry {
  id?: string;
  label: string;
  model?: string;
  scope?: string;
  description?: string;
}

export interface PresetsBranding {
  userEmail?: string;
}

function escapeHtml(input: string | number | undefined | null): string {
  if (input === undefined || input === null) { return ""; }
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderPresetRow(p: PresetListEntry): string {
  const id = escapeHtml(p.id ?? "");
  const label = escapeHtml(p.label);
  const model = escapeHtml(p.model ?? "");
  const scope = escapeHtml(p.scope ?? "");
  const description = escapeHtml(p.description ?? "");
  return `<tr data-preset-id="${id}">
  <td>${label}</td>
  <td>${model}</td>
  <td>${scope}</td>
  <td>${description}</td>
</tr>`;
}

function renderPresetsTable(presets: ReadonlyArray<PresetListEntry>): string {
  const rows = presets.length === 0
    ? `<tr><td colspan="4" class="empty-state">No presets registered yet</td></tr>`
    : presets.map(renderPresetRow).join("");
  return `<div class="card">
  <div class="table-wrapper">
    <table class="table presets-list" aria-label="AI presets list">
      <thead><tr>
        <th scope="col">Label</th>
        <th scope="col">Model</th>
        <th scope="col">Scope</th>
        <th scope="col">Description</th>
      </tr></thead>
      <tbody id="presets-list-body" data-empty="No presets registered yet">${rows}</tbody>
    </table>
  </div>
</div>`;
}

export function presetsListPage(
  presets: ReadonlyArray<PresetListEntry>,
  branding: PresetsBranding = {},
): string {
  const content = renderPresetsTable(presets);
  return adminLayout({
    title: "AI Presets",
    activePath: "/admin/presets",
    userEmail: branding.userEmail,
    content,
  });
}
