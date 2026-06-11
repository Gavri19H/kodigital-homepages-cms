// Admin Media library (T31 [B10] media library port).
// mediaListPage — legacy media-grid port: card grid with
// preview/filename/size, upload modal (multipart wire fields: file,
// alt_text, caption, site_id) posting to POST /api/admin/media/upload,
// and a details modal backed by GET/DELETE /api/admin/media/:id.
// Retained KoDigital tenant features: Site filter dropdown (All sites /
// Global only / per-site, name="site_id"), Kind filter
// (image/video/document), and the "Global" badge on rows whose
// site_id IS NULL. Inline scripts are ES5-only (es5-inline-scripts);
// every dynamic value rendered into modal innerHTML goes through
// escapeHtmlJs first.

import { adminLayout, escapeHtml } from "./layout";

export interface SiteOption {
  id: string;
  name?: string;
}

export interface MediaListEntry {
  id?: string;
  filename: string;
  preview_url?: string | null;
  site?: string;
  site_id?: string | null;
  kind?: string;
  size?: number | string | null;
  uploaded_at?: string | null;
}

export interface MediaBranding {
  userEmail?: string;
}

const KIND_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "image", label: "image" },
  { value: "video", label: "video" },
  { value: "document", label: "document" },
];

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) { return str; }
  return str.slice(0, maxLen - 3) + "...";
}

function renderSiteOptions(sites: ReadonlyArray<SiteOption>, selected?: string | null): string {
  const head = `<option value="">All sites</option><option value="__global__">Global only</option>`;
  const opts = sites.map(function (s: SiteOption): string {
    const sel = (selected ?? "") === s.id ? " selected" : "";
    return `<option value="${escapeHtml(s.id)}"${sel}>${escapeHtml(s.name ?? s.id)}</option>`;
  }).join("");
  return head + opts;
}

function renderUploadSiteOptions(sites: ReadonlyArray<SiteOption>): string {
  const head = `<option value="">Global (all sites)</option>`;
  const opts = sites.map(function (s: SiteOption): string {
    return `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name ?? s.id)}</option>`;
  }).join("");
  return head + opts;
}

function renderKindOptions(): string {
  const head = `<option value="">All kinds</option>`;
  const opts = KIND_OPTIONS.map(function (k): string {
    return `<option value="${escapeHtml(k.value)}">${escapeHtml(k.label)}</option>`;
  }).join("");
  return head + opts;
}

function renderToolbar(sites: ReadonlyArray<SiteOption>, selectedSiteId?: string | null): string {
  return `<div class="toolbar">
  <div class="toolbar-search"><input type="search" id="media-search" name="search" class="form-input" placeholder="Search media..." /></div>
  <div class="toolbar-filters">
    <select id="filter-site" name="site_id" class="form-select" data-filter="site" aria-label="Site filter">
      ${renderSiteOptions(sites, selectedSiteId ?? "")}
    </select>
    <select id="filter-kind" name="kind" class="form-select" data-filter="kind" aria-label="Kind filter">
      ${renderKindOptions()}
    </select>
  </div>
  <button type="button" class="btn btn-primary" onclick="openUploadModal()">Upload media</button>
</div>`;
}

function renderMediaCard(m: MediaListEntry): string {
  const id = escapeHtml(m.id ?? "");
  const filename = escapeHtml(m.filename);
  const kind = escapeHtml(m.kind ?? "");
  const size = escapeHtml(m.size ?? "");
  const uploaded = escapeHtml(m.uploaded_at ?? "");
  const hasSite = m.site_id != null && m.site_id !== "";
  const siteBadge = hasSite
    ? `<span class="badge media-site">${escapeHtml(m.site ?? m.site_id ?? "")}</span>`
    : `<span class="badge global-template" data-global="true">Global</span>`;
  const url = m.preview_url ?? "";
  const preview = url && (m.kind ?? "") === "image"
    ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(m.filename)}" loading="lazy" />`
    : `<div class="media-placeholder" aria-hidden="true">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
      </div>`;
  return `<div class="media-item" data-media-id="${id}" data-kind="${kind}" data-filename="${filename}" onclick="showMediaDetails('${id}')">
  <div class="media-preview">${preview}</div>
  <div class="media-info">
    <p class="media-filename" title="${filename}">${escapeHtml(truncate(m.filename, 24))}</p>
    <p class="media-meta">${size}${uploaded ? ` · ${uploaded}` : ""} ${siteBadge}</p>
  </div>
</div>`;
}

function renderMediaGrid(items: ReadonlyArray<MediaListEntry>): string {
  if (items.length === 0) {
    return `<div class="card"><div class="empty-state" data-empty="No media yet">
  <p>No media files yet</p>
  <button type="button" class="btn btn-primary" onclick="openUploadModal()">Upload Your First Image</button>
</div></div>`;
  }
  return `<div class="card">
  <div class="media-grid" aria-label="Media library">
    ${items.map(renderMediaCard).join("")}
  </div>
</div>`;
}

function renderUploadModal(sites: ReadonlyArray<SiteOption>): string {
  return `<div id="uploadModal" class="modal" style="display: none;">
  <div class="modal-backdrop" onclick="closeUploadModal()"></div>
  <div class="modal-content">
    <h2 class="modal-title">Upload Media</h2>
    <form id="uploadForm" enctype="multipart/form-data">
      <div class="upload-dropzone" id="dropzone">
        <p>Drag and drop a file here, or click to select</p>
        <p class="form-help">Supports: JPEG, PNG, GIF, WebP, AVIF, SVG (max 10MB)</p>
        <input type="file" id="fileInput" name="file" accept="image/*" style="display: none;" />
      </div>
      <div id="uploadPreview" class="upload-preview" style="display: none;">
        <img id="previewImage" src="" alt="Preview" />
        <div id="previewInfo"></div>
      </div>
      <div class="form-group">
        <label class="form-label" for="upload-site">Site</label>
        <select id="upload-site" name="site_id" class="form-select">
          ${renderUploadSiteOptions(sites)}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="altText">Alt Text</label>
        <input type="text" id="altText" name="alt_text" class="form-input" placeholder="Describe the image for accessibility..." />
      </div>
      <div class="form-group">
        <label class="form-label" for="caption">Caption</label>
        <input type="text" id="caption" name="caption" class="form-input" placeholder="Optional caption to display with the image..." />
      </div>
      <div id="uploadProgress" class="upload-progress" style="display: none;">
        <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
        <p id="progressText">Uploading...</p>
      </div>
      <div id="uploadError" class="alert alert-error" style="display: none;"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" onclick="closeUploadModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="uploadBtn" disabled>Upload</button>
      </div>
    </form>
  </div>
</div>`;
}

function renderDetailsModal(): string {
  return `<div id="mediaModal" class="modal" style="display: none;">
  <div class="modal-backdrop" onclick="closeMediaModal()"></div>
  <div class="modal-content modal-content-wide">
    <h2 class="modal-title">Media Details</h2>
    <div id="mediaDetails">Loading...</div>
    <div class="modal-actions modal-actions-split">
      <div>
        <button type="button" class="btn btn-secondary" id="copyUrlBtn">Copy URL</button>
        <button type="button" class="btn btn-secondary" id="insertBtn">Copy HTML</button>
      </div>
      <div>
        <button type="button" class="btn btn-danger" id="deleteMediaBtn">Delete</button>
        <button type="button" class="btn btn-secondary" onclick="closeMediaModal()">Close</button>
      </div>
    </div>
  </div>
</div>`;
}

const MEDIA_STYLES = `
.media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; }
.media-item { border: 1px solid var(--color-border, #e2e8f0); border-radius: 8px; overflow: hidden; cursor: pointer; transition: border-color 0.2s, box-shadow 0.2s; }
.media-item:hover { border-color: var(--color-primary, #2563eb); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); }
.media-preview { aspect-ratio: 1; background: var(--color-bg-alt, #f1f5f9); display: flex; align-items: center; justify-content: center; overflow: hidden; }
.media-preview img { width: 100%; height: 100%; object-fit: cover; }
.media-placeholder { color: var(--color-text-muted, #64748b); }
.media-info { padding: 12px; }
.media-filename { font-size: 13px; font-weight: 500; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.media-meta { font-size: 12px; color: var(--color-text-muted, #64748b); }
.modal { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; }
.modal-backdrop { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.5); }
.modal-content { position: relative; background: var(--color-bg, #ffffff); border-radius: 8px; padding: 24px; width: 100%; max-width: 480px; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1); }
.modal-content-wide { max-width: 600px; }
.modal-title { font-size: 18px; font-weight: 600; margin-bottom: 16px; }
.modal-actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px; }
.modal-actions-split { justify-content: space-between; }
.upload-dropzone { border: 2px dashed var(--color-border, #e2e8f0); border-radius: 8px; padding: 40px 24px; text-align: center; cursor: pointer; transition: border-color 0.2s, background-color 0.2s; margin-bottom: 16px; }
.upload-dropzone:hover, .upload-dropzone.dragover { border-color: var(--color-primary, #2563eb); background: var(--color-bg-alt, #f1f5f9); }
.upload-preview { margin-bottom: 16px; text-align: center; }
.upload-preview img { max-width: 100%; max-height: 200px; border-radius: 4px; margin-bottom: 8px; }
.upload-progress { margin: 16px 0; }
.progress-bar { height: 8px; background: var(--color-bg-alt, #f1f5f9); border-radius: 4px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--color-primary, #2563eb); width: 0%; transition: width 0.3s; }
.media-detail-preview { text-align: center; margin-bottom: 16px; }
.media-detail-preview img { max-width: 100%; max-height: 300px; border-radius: 4px; }
.detail-row { display: flex; margin-bottom: 8px; }
.detail-label { width: 110px; font-weight: 500; color: var(--color-text-muted, #64748b); }
.detail-value { flex: 1; word-break: break-all; }
`;

// ES5 only — no arrows, no let/const, no template literals, no
// async/await (es5-inline-scripts rule).
const MEDIA_SCRIPTS = `
var currentMediaId = null;
var currentMediaData = null;
var selectedFile = null;

function escapeHtmlJs(text) {
  var div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function formatFileSizeJs(bytes) {
  if (!bytes) { return '0 Bytes'; }
  var k = 1024;
  var sizes = ['Bytes', 'KB', 'MB', 'GB'];
  var i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function openUploadModal() {
  document.getElementById('uploadModal').style.display = 'flex';
  resetUploadForm();
}
window.openUploadModal = openUploadModal;

function closeUploadModal() {
  document.getElementById('uploadModal').style.display = 'none';
  resetUploadForm();
}
window.closeUploadModal = closeUploadModal;

function resetUploadForm() {
  document.getElementById('uploadForm').reset();
  document.getElementById('uploadPreview').style.display = 'none';
  document.getElementById('uploadProgress').style.display = 'none';
  document.getElementById('uploadError').style.display = 'none';
  document.getElementById('uploadBtn').disabled = true;
  document.getElementById('dropzone').style.display = '';
  selectedFile = null;
}

var dropzone = document.getElementById('dropzone');
var fileInput = document.getElementById('fileInput');

dropzone.addEventListener('click', function () { fileInput.click(); });
dropzone.addEventListener('dragover', function (e) {
  e.preventDefault();
  dropzone.classList.add('dragover');
});
dropzone.addEventListener('dragleave', function () {
  dropzone.classList.remove('dragover');
});
dropzone.addEventListener('drop', function (e) {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer.files.length > 0) { handleFileSelect(e.dataTransfer.files[0]); }
});
fileInput.addEventListener('change', function (e) {
  if (e.target.files.length > 0) { handleFileSelect(e.target.files[0]); }
});

function handleFileSelect(file) {
  var validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml'];
  if (validTypes.indexOf(file.type) === -1) {
    showUploadError('Invalid file type. Please select an image file.');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showUploadError('File too large. Maximum size is 10MB.');
    return;
  }
  selectedFile = file;
  document.getElementById('uploadError').style.display = 'none';
  var preview = document.getElementById('uploadPreview');
  var previewImage = document.getElementById('previewImage');
  if (file.type.indexOf('image/') === 0 && file.type !== 'image/svg+xml') {
    var reader = new FileReader();
    reader.onload = function (e) {
      previewImage.src = e.target.result;
      preview.style.display = 'block';
      dropzone.style.display = 'none';
    };
    reader.readAsDataURL(file);
  } else {
    previewImage.src = '';
    preview.style.display = 'block';
    dropzone.style.display = 'none';
  }
  document.getElementById('previewInfo').innerHTML =
    '<strong>' + escapeHtmlJs(file.name) + '</strong><br>' +
    '<span>' + formatFileSizeJs(file.size) + ' · ' + escapeHtmlJs(file.type) + '</span>';
  document.getElementById('uploadBtn').disabled = false;
}

function showUploadError(message) {
  var errorEl = document.getElementById('uploadError');
  errorEl.textContent = message;
  errorEl.style.display = 'block';
}

document.getElementById('uploadForm').addEventListener('submit', function (e) {
  e.preventDefault();
  if (!selectedFile) { return; }
  var formData = new FormData();
  formData.append('file', selectedFile);
  formData.append('alt_text', document.getElementById('altText').value);
  formData.append('caption', document.getElementById('caption').value);
  var siteSelect = document.getElementById('upload-site');
  if (siteSelect && siteSelect.value) { formData.append('site_id', siteSelect.value); }

  document.getElementById('uploadProgress').style.display = 'block';
  document.getElementById('uploadBtn').disabled = true;
  document.getElementById('progressFill').style.width = '0%';
  document.getElementById('progressText').textContent = 'Uploading...';

  var xhr = new XMLHttpRequest();
  xhr.upload.addEventListener('progress', function (e) {
    if (e.lengthComputable) {
      var percent = Math.round((e.loaded / e.total) * 100);
      document.getElementById('progressFill').style.width = percent + '%';
      document.getElementById('progressText').textContent = 'Uploading... ' + percent + '%';
    }
  });
  xhr.onload = function () {
    if (xhr.status >= 200 && xhr.status < 300) {
      document.getElementById('progressText').textContent = 'Upload complete!';
      setTimeout(function () { window.location.reload(); }, 500);
    } else {
      var message = 'Upload failed';
      try {
        var parsed = JSON.parse(xhr.responseText);
        if (parsed && parsed.error) { message = parsed.error; }
      } catch (parseErr) { /* keep generic message */ }
      showUploadError(message);
      document.getElementById('uploadProgress').style.display = 'none';
      document.getElementById('uploadBtn').disabled = false;
    }
  };
  xhr.onerror = function () {
    showUploadError('Network error');
    document.getElementById('uploadProgress').style.display = 'none';
    document.getElementById('uploadBtn').disabled = false;
  };
  xhr.open('POST', '/api/admin/media/upload');
  xhr.send(formData);
});

function renderDetailRow(label, value) {
  return '<div class="detail-row"><span class="detail-label">' + label +
    ':</span><span class="detail-value">' + value + '</span></div>';
}

function showMediaDetails(id) {
  currentMediaId = id;
  document.getElementById('mediaModal').style.display = 'flex';
  document.getElementById('mediaDetails').innerHTML = 'Loading...';
  fetch('/api/admin/media/' + id)
    .then(function (response) {
      return response.json().then(function (data) {
        return { ok: response.ok, data: data };
      });
    })
    .then(function (result) {
      if (!result.ok || !result.data.item) {
        document.getElementById('mediaDetails').innerHTML = 'Error loading media details';
        return;
      }
      currentMediaData = result.data.item;
      var item = result.data.item;
      var html = '';
      if (item.mime_type && item.mime_type.indexOf('image/') === 0) {
        html += '<div class="media-detail-preview"><img src="/media/' + escapeHtmlJs(item.storage_key) +
          '" alt="' + escapeHtmlJs(item.alt_text || item.filename) + '" /></div>';
      }
      html += renderDetailRow('Filename', escapeHtmlJs(item.filename));
      html += renderDetailRow('Size', formatFileSizeJs(item.size_bytes));
      html += renderDetailRow('Type', escapeHtmlJs(item.mime_type));
      if (item.width) {
        html += renderDetailRow('Dimensions', item.width + ' × ' + item.height + 'px');
      }
      html += renderDetailRow('Site', item.site_id ? escapeHtmlJs(item.site_id) : 'Global');
      html += renderDetailRow('Alt Text', item.alt_text ? escapeHtmlJs(item.alt_text) : '(none)');
      html += renderDetailRow('Caption', item.caption ? escapeHtmlJs(item.caption) : '(none)');
      if (item.created_at) {
        var created = typeof item.created_at === 'number'
          ? new Date(item.created_at * 1000)
          : new Date(item.created_at);
        html += renderDetailRow('Uploaded', created.toLocaleString());
      }
      html += renderDetailRow('URL', '<span class="detail-url">/media/' + escapeHtmlJs(item.storage_key) + '</span>');
      document.getElementById('mediaDetails').innerHTML = html;
    })
    .catch(function () {
      document.getElementById('mediaDetails').innerHTML = 'Error loading media details';
    });
}
window.showMediaDetails = showMediaDetails;

function closeMediaModal() {
  document.getElementById('mediaModal').style.display = 'none';
  currentMediaId = null;
  currentMediaData = null;
}
window.closeMediaModal = closeMediaModal;

document.getElementById('copyUrlBtn').addEventListener('click', function () {
  if (!currentMediaData) { return; }
  var btn = this;
  var url = window.location.origin + '/media/' + currentMediaData.storage_key;
  navigator.clipboard.writeText(url).then(function () {
    var originalText = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(function () { btn.textContent = originalText; }, 2000);
  });
});

document.getElementById('insertBtn').addEventListener('click', function () {
  if (!currentMediaData) { return; }
  var btn = this;
  var item = currentMediaData;
  var html = '<img src="/media/' + item.storage_key + '"';
  if (item.alt_text) { html += ' alt="' + item.alt_text + '"'; }
  if (item.width && item.height) {
    html += ' width="' + item.width + '" height="' + item.height + '"';
  }
  html += ' loading="lazy">';
  navigator.clipboard.writeText(html).then(function () {
    var originalText = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(function () { btn.textContent = originalText; }, 2000);
  });
});

document.getElementById('deleteMediaBtn').addEventListener('click', function () {
  if (!currentMediaId) { return; }
  if (!window.confirmDelete('Are you sure you want to delete this media file?')) { return; }
  fetch('/api/admin/media/' + currentMediaId, { method: 'DELETE' })
    .then(function (response) {
      return response.json().then(function (data) {
        return { ok: response.ok, data: data };
      });
    })
    .then(function (result) {
      if (result.ok) {
        window.location.reload();
      } else {
        alert('Error: ' + (result.data.error || 'Failed to delete media'));
      }
    })
    .catch(function () { alert('Error: Failed to delete media'); });
});

// Site filter: reload scoped to the chosen site (server-side predicate —
// site rows + globals). "Global only" and "All sites" stay client-visible
// distinctions on the badge.
var siteFilter = document.getElementById('filter-site');
if (siteFilter) {
  siteFilter.addEventListener('change', function () {
    var value = siteFilter.value;
    if (value && value !== '__global__') {
      window.location.href = '/admin/media?site_id=' + encodeURIComponent(value);
    } else {
      window.location.href = '/admin/media';
    }
  });
}

// Kind filter + search: client-side card visibility.
function applyClientFilters() {
  var kindSelect = document.getElementById('filter-kind');
  var searchInput = document.getElementById('media-search');
  var kind = kindSelect ? kindSelect.value : '';
  var needle = searchInput ? searchInput.value.toLowerCase() : '';
  var cards = document.querySelectorAll('.media-item');
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    var cardKind = card.getAttribute('data-kind') || '';
    var cardName = (card.getAttribute('data-filename') || '').toLowerCase();
    var kindOk = !kind || cardKind === kind;
    var nameOk = !needle || cardName.indexOf(needle) !== -1;
    card.style.display = kindOk && nameOk ? '' : 'none';
  }
}
var kindFilter = document.getElementById('filter-kind');
if (kindFilter) { kindFilter.addEventListener('change', applyClientFilters); }
var mediaSearch = document.getElementById('media-search');
if (mediaSearch) { mediaSearch.addEventListener('input', applyClientFilters); }
`;

export function mediaListPage(
  items: ReadonlyArray<MediaListEntry>,
  sites: ReadonlyArray<SiteOption>,
  branding: MediaBranding = {},
  selectedSiteId?: string | null,
): string {
  const content = `${renderToolbar(sites, selectedSiteId)}${renderMediaGrid(items)}${renderUploadModal(sites)}${renderDetailsModal()}`;
  return adminLayout({
    title: "Media",
    activePath: "/admin/media",
    userEmail: branding.userEmail,
    content,
    styles: MEDIA_STYLES,
    scripts: MEDIA_SCRIPTS,
  });
}
