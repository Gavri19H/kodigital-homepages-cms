// Admin Article editor — Hero image card + AI hero-image modal (T14b legacy
// port). Composed into articleFormPage (./articles) below the editor body,
// matching the legacy hero card.
//
// The card shows the current hero image (articles.featured_image_id ->
// media), lets an editor UPLOAD a file (POST /admin/media, multipart `file`,
// the same endpoint the block editor uses) OR open the AI hero-image modal to
// GENERATE one. The hidden `featured_image_id` input is the SINGLE wire name:
// it equals the admin handler-read field name (api.ts patch/post body) AND
// the DB column (articles.featured_image_id) — apply/upload set this hidden
// input so the article form submit persists the chosen hero image.
//
// AI hero-image modal contract (matches the legacy hero card):
//   - a preset select fed by GET /api/admin/ai/presets?active_only=true,
//   - auto-detected {{variable}} chips + a live interpolated prompt-preview,
//   - size / style / quality controls,
//   - a Generate button that POSTs to /api/admin/ai/image
//     {prompt, site_id?, size, style, quality, alt_text} -> {ok, model,
//     media_id, image_url, ...},
//   - a preview of the generated image + an error region,
//   - an Apply button that places the generated image into the article
//     (sets featured_image_id + the card preview, then closes the modal).
//
// HARD CONTRACT (es5-inline-scripts rule / L-014): heroImageScripts is an
// ES5-only string — no arrow functions, no const/let, no template literals
// INSIDE the literal. Regex backslashes are DOUBLE-escaped (`\\{` -> `\{`).

import { SUPPORTED_IMAGE_MODELS } from "../../ai/models";
import { escapeHtml } from "./layout";

export { heroImageScripts } from "./hero-image-script";

const SIZE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "1024x1024", label: "Square (1024×1024)" },
  { value: "1536x1024", label: "Landscape (1536×1024)" },
  { value: "1024x1536", label: "Portrait (1024×1536)" },
  { value: "auto", label: "Auto" },
];

const STYLE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "natural", label: "Natural" },
  { value: "vivid", label: "Vivid" },
];

const QUALITY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "standard", label: "Standard" },
  { value: "high", label: "High" },
];

function renderSelect(
  id: string,
  label: string,
  options: ReadonlyArray<{ value: string; label: string }>,
): string {
  const opts = options
    .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
    .join("");
  return `<div class="form-group">
          <label for="${id}" class="form-label">${escapeHtml(label)}</label>
          <select id="${id}" class="form-select">${opts}</select>
        </div>`;
}

// The hero image card + the AI hero-image modal. `featuredImageId` /
// `imageUrl` pre-populate the hidden wire input and the card preview in
// edit mode; both are empty for a new article.
export function renderHeroImageCard(
  featuredImageId?: number | string | null,
  imageUrl?: string | null,
): string {
  const idVal = featuredImageId == null ? "" : String(featuredImageId);
  const previewSrc = imageUrl ? escapeHtml(imageUrl) : "";
  const previewHidden = previewSrc ? "" : " hidden";
  const imageModels = escapeHtml(SUPPORTED_IMAGE_MODELS.join(", "));
  return `<section class="card hero-image-card" id="hero-image-card">
  <div class="card-header"><h3 class="card-title">Hero image</h3></div>
  <input type="hidden" id="hero-image-input" name="featured_image_id" value="${escapeHtml(idVal)}" />
  <div id="heroImageContainer" class="hero-image-container">
    <div id="hero-image-preview-wrap" class="hero-image-preview-wrap"${previewSrc ? "" : " hidden"}>
      <img id="hero-image-preview" class="hero-image-preview" src="${previewSrc}" alt="Hero image preview" />
      <div class="hero-image-overlay">
        <button type="button" id="hero-image-remove" class="btn btn-sm btn-danger hero-image-remove-btn">Remove</button>
      </div>
    </div>
    <div id="hero-image-empty" class="hero-image-uploader"${previewSrc ? " hidden" : ""}>
      <input id="hero-image-upload" type="file" accept="image/*" class="hero-image-upload-input" hidden />
      <div class="hero-image-options">
        <label for="hero-image-upload" class="hero-image-dropzone">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
          <p>Upload Image</p>
          <small>Click or drag</small>
        </label>
        <div id="hero-image-ai-generate" class="hero-image-ai-generate">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
          <p>Generate with AI</p>
          <small>Use presets</small>
        </div>
      </div>
      <small class="hero-image-hint">Recommended: 1200×630px (landscape)</small>
    </div>
  </div>
  <p id="hero-image-error" class="alert alert-error" hidden role="alert"></p>
  <p id="hero-image-status" class="form-status" role="status" aria-live="polite"></p>

  <div class="hero-ai-overlay" id="hero-ai-modal" hidden role="dialog" aria-modal="true" aria-labelledby="hero-ai-modal-title">
    <div class="hero-ai-modal">
      <div class="hero-ai-modal-header">
        <h3 class="card-title" id="hero-ai-modal-title">AI hero image</h3>
        <button type="button" id="hero-ai-close" class="hero-ai-close" aria-label="Close">&times;</button>
      </div>
      <div class="form-group">
        <label for="hero-ai-preset" class="form-label">Preset</label>
        <select id="hero-ai-preset" class="form-select hero-ai-preset" aria-label="Hero image preset">
          <option value="">Select a preset&hellip;</option>
        </select>
      </div>
      <div class="hero-ai-variables" id="hero-ai-variables" aria-label="Preset variables"></div>
      <div class="hero-ai-controls">
        ${renderSelect("hero-ai-size", "Size", SIZE_OPTIONS)}
        ${renderSelect("hero-ai-style", "Style", STYLE_OPTIONS)}
        ${renderSelect("hero-ai-quality", "Quality", QUALITY_OPTIONS)}
      </div>
      <div class="form-group">
        <label for="hero-ai-prompt" class="form-label">Prompt</label>
        <textarea id="hero-ai-prompt" class="form-textarea" rows="3" placeholder="Describe the hero image&hellip;"></textarea>
      </div>
      <div class="form-group hero-ai-preview-group">
        <label for="hero-ai-preview" class="form-label">Prompt preview</label>
        <pre class="hero-ai-prompt-preview" id="hero-ai-preview" aria-live="polite"></pre>
      </div>
      <div class="hero-ai-models">Image model: <code>${imageModels}</code></div>
      <p id="hero-ai-error" class="alert alert-error" hidden role="alert"></p>
      <p id="hero-ai-status" class="form-status" role="status" aria-live="polite"></p>
      <div class="hero-ai-result" id="hero-ai-result" hidden>
        <img id="hero-ai-result-image" class="hero-ai-result-image" src="" alt="Generated hero image preview" />
      </div>
      <div class="hero-ai-modal-actions">
        <button type="button" id="hero-ai-cancel" class="btn btn-secondary btn-sm">Cancel</button>
        <button type="button" id="hero-ai-generate-btn" class="btn btn-primary btn-sm">Generate image</button>
        <button type="button" id="hero-ai-apply-btn" class="btn btn-primary btn-sm" hidden>Apply to article</button>
      </div>
    </div>
  </div>
</section>`;
}

export const heroImageStyles = `
.hero-image-card{margin-top:16px}
.hero-image-container{margin:8px 0}
.hero-image-preview-wrap{position:relative;border-radius:8px;overflow:hidden}
.hero-image-preview-wrap[hidden]{display:none}
.hero-image-preview{display:block;width:100%;height:auto;border-radius:8px}
.hero-image-overlay{position:absolute;top:8px;right:8px;opacity:0;transition:opacity .2s}
.hero-image-preview-wrap:hover .hero-image-overlay{opacity:1}
.hero-image-uploader[hidden]{display:none}
.hero-image-options{display:flex;gap:12px}
.hero-image-dropzone,.hero-image-ai-generate{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:24px 16px;border:2px dashed var(--color-border,#e5e7eb);border-radius:8px;cursor:pointer;text-align:center;color:var(--color-text-muted,#6b7280);transition:border-color .2s,background .2s}
.hero-image-dropzone:hover{border-color:var(--color-primary,#2563eb);background:var(--color-primary-light,#dbeafe)}
.hero-image-ai-generate{background:linear-gradient(135deg,rgba(147,51,234,.05),rgba(59,130,246,.05))}
.hero-image-ai-generate:hover{border-color:#9333ea}
.hero-image-dropzone p,.hero-image-ai-generate p{margin:0;font-weight:600;font-size:13px;color:var(--color-text,#111827)}
.hero-image-dropzone small,.hero-image-ai-generate small{font-size:11px}
.hero-image-hint{display:block;margin-top:8px;font-size:12px;color:var(--color-text-muted,#6b7280)}
.hero-image-status{font-size:13px;color:var(--c-muted);min-height:1em;margin:8px 0 0}
.hero-ai-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;padding:16px;z-index:1000}
.hero-ai-overlay[hidden]{display:none}
.hero-ai-modal{background:var(--c-surface,#fff);border-radius:8px;padding:16px;max-width:520px;width:100%;max-height:90vh;overflow:auto}
.hero-ai-modal-header{display:flex;align-items:center;justify-content:space-between}
.hero-ai-close{background:none;border:0;font-size:24px;line-height:1;cursor:pointer;color:var(--c-muted)}
.hero-ai-variables{display:flex;flex-direction:column;gap:8px;margin:8px 0}
.hero-ai-var-chip{display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--c-muted)}
.hero-ai-var-name{font-family:monospace}
.hero-ai-controls{display:flex;gap:12px}
.hero-ai-controls .form-group{flex:1}
.hero-ai-prompt-preview{white-space:pre-wrap;word-break:break-word;background:var(--c-bg,#f6f7f9);padding:8px 10px;border-radius:6px;font-size:12px;min-height:1.5em;margin:0}
.hero-ai-models{font-size:12px;color:var(--c-muted);margin:8px 0}
.hero-ai-result{margin:8px 0}
.hero-ai-result-image{max-width:100%;border-radius:6px;display:block}
.hero-ai-modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
`;
