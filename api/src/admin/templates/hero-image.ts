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
  <div class="hero-image-preview-wrap">
    <img id="hero-image-preview" class="hero-image-preview" src="${previewSrc}" alt="Hero image preview"${previewHidden} />
    <p id="hero-image-empty" class="hero-image-empty"${previewSrc ? " hidden" : ""}>No hero image selected.</p>
  </div>
  <div class="hero-image-actions">
    <label for="hero-image-upload" class="btn btn-secondary btn-sm">Upload image</label>
    <input id="hero-image-upload" type="file" accept="image/*" class="hero-image-upload-input" hidden />
    <button type="button" id="hero-image-ai-generate" class="btn btn-primary btn-sm hero-image-ai-generate">Generate with AI</button>
    <button type="button" id="hero-image-remove" class="btn btn-danger btn-sm" hidden>Remove</button>
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
.hero-image-preview-wrap{margin:8px 0}
.hero-image-preview{max-width:100%;border-radius:6px;display:block}
.hero-image-empty{color:var(--c-muted);font-size:13px;margin:8px 0}
.hero-image-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
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
