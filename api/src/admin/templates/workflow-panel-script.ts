// Admin Article editor — Publish workflow panel inline script (T14c legacy
// port). Re-exported through ./workflow-panel so callers keep a single
// import. Split out of workflow-panel.ts to keep each module focused
// (matches the ai-panel.ts / hero-image.ts decomposition).
//
// HARD CONTRACT (es5-inline-scripts rule / L-014): this is an ES5-only string
// — no arrow functions, no const/let, no template literals INSIDE the
// literal.
//
// Wires every publish-workflow control to its admin endpoint:
//   - publish / unpublish / archive  -> POST /api/admin/articles/:id/<action>
//   - schedule    -> POST /api/admin/articles/:id/schedule {scheduled_at}
//   - cancel-schedule -> POST /api/admin/articles/:id/cancel-schedule
//   - version history -> GET /api/admin/articles/:id/versions, then each row
//     Restore -> POST /api/admin/articles/:id/versions/:vid/restore.
// Status-mutating actions read the JSON 2xx response and reflect the new
// status into the badge; a restore reloads the editor so the restored
// content_json is shown.

export const workflowPanelScripts = `
(function () {
  var panel = document.getElementById('workflow-panel');
  if (!panel) { return; }
  var articleId = panel.getAttribute('data-article-id');
  if (!articleId) { return; }
  var base = '/api/admin/articles/' + articleId;

  var statusBadge = document.getElementById('workflow-status-value');
  var scheduleInput = document.getElementById('workflow-schedule-at');
  var errEl = document.getElementById('workflow-error');
  var statusEl = document.getElementById('workflow-status');

  var modal = document.getElementById('workflow-versions-modal');
  var openVersions = document.getElementById('workflow-versions-open');
  var closeVersions = document.getElementById('workflow-versions-close');
  var cancelVersions = document.getElementById('workflow-versions-cancel');
  var versionsList = document.getElementById('workflow-versions-list');
  var versionsStatus = document.getElementById('workflow-versions-status');
  var versionsError = document.getElementById('workflow-versions-error');

  function setText(el, msg) {
    if (!el) { return; }
    while (el.firstChild) { el.removeChild(el.firstChild); }
    if (msg) { el.appendChild(document.createTextNode(msg)); }
  }
  function setError(el, msg) {
    if (!el) { return; }
    el.hidden = !msg;
    setText(el, msg || '');
  }
  function applyStatus(status) {
    if (!statusBadge || !status) { return; }
    setText(statusBadge, status);
    statusBadge.className = 'badge badge-' + status;
    panel.setAttribute('data-status', status);
  }

  // ---- Publish-workflow transitions: POST /api/admin/articles/:id/<action>
  function runAction(action) {
    setError(errEl, '');
    var url = base + '/' + action;
    var opts = { method: 'POST', credentials: 'same-origin' };
    var body = null;
    if (action === 'schedule') {
      var raw = scheduleInput && scheduleInput.value ? scheduleInput.value : '';
      var epoch = raw ? Math.floor(new Date(raw).getTime() / 1000) : NaN;
      if (!raw || !isFinite(epoch) || epoch <= 0) {
        setError(errEl, 'Pick a date and time to schedule');
        if (scheduleInput) { scheduleInput.focus(); }
        return;
      }
      body = JSON.stringify({ scheduled_at: epoch });
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = body;
    }
    setText(statusEl, 'Working\\u2026');
    fetch(url, opts).then(function (res) {
      return res.json().then(function (json) {
        return { ok: res.ok, status: res.status, body: json };
      });
    }).then(function (res) {
      if (!res.ok) {
        setText(statusEl, '');
        setError(errEl, (res.body && res.body.error) || ('Action failed (HTTP ' + res.status + ')'));
        return;
      }
      if (res.body && res.body.status) { applyStatus(res.body.status); }
      setText(statusEl, action.replace(/-/g, ' ') + ' done');
    }).catch(function () {
      setText(statusEl, '');
      setError(errEl, 'Network error');
    });
  }
  var actionButtons = panel.querySelectorAll('.workflow-action');
  var i;
  for (i = 0; i < actionButtons.length; i++) {
    actionButtons[i].addEventListener('click', function () {
      runAction(this.getAttribute('data-workflow-action'));
    });
  }

  // ---- Version history modal: GET /api/admin/articles/:id/versions ----
  function openModal() {
    if (!modal) { return; }
    setError(versionsError, '');
    modal.hidden = false;
    loadVersions();
  }
  function closeModal() {
    if (modal) { modal.hidden = true; }
  }
  if (openVersions) { openVersions.addEventListener('click', openModal); }
  if (closeVersions) { closeVersions.addEventListener('click', closeModal); }
  if (cancelVersions) { cancelVersions.addEventListener('click', closeModal); }
  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal) { closeModal(); }
    });
  }

  function loadVersions() {
    if (!versionsList) { return; }
    setError(versionsError, '');
    setText(versionsStatus, 'Loading\\u2026');
    while (versionsList.firstChild) { versionsList.removeChild(versionsList.firstChild); }
    fetch(base + '/versions', { credentials: 'same-origin' }).then(function (res) {
      return res.json().then(function (json) {
        return { ok: res.ok, status: res.status, body: json };
      });
    }).then(function (res) {
      setText(versionsStatus, '');
      if (!res.ok) {
        setError(versionsError, (res.body && res.body.error) || ('Could not load versions (HTTP ' + res.status + ')'));
        return;
      }
      var rows = (res.body && res.body.versions) || [];
      if (!rows.length) {
        setText(versionsStatus, 'No versions yet');
        return;
      }
      var j;
      for (j = 0; j < rows.length; j++) {
        versionsList.appendChild(renderVersionRow(rows[j]));
      }
    }).catch(function () {
      setText(versionsStatus, '');
      setError(versionsError, 'Network error');
    });
  }

  function renderVersionRow(row) {
    var li = document.createElement('li');
    li.className = 'workflow-version';
    li.setAttribute('data-version-id', String(row.id));
    var meta = document.createElement('span');
    meta.className = 'workflow-version-meta';
    var num = document.createElement('span');
    num.className = 'workflow-version-num';
    num.appendChild(document.createTextNode('v' + row.version_number));
    meta.appendChild(num);
    var summary = row.change_summary ? (' — ' + row.change_summary) : '';
    var who = row.created_by ? (' by ' + row.created_by) : '';
    meta.appendChild(document.createTextNode(' (' + (row.status || '') + ')' + summary + who));
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary btn-sm workflow-restore';
    btn.setAttribute('data-version-id', String(row.id));
    btn.appendChild(document.createTextNode('Restore'));
    btn.addEventListener('click', function () {
      restoreVersion(this.getAttribute('data-version-id'));
    });
    li.appendChild(meta);
    li.appendChild(btn);
    return li;
  }

  // ---- Restore: POST /api/admin/articles/:id/versions/:vid/restore ----
  function restoreVersion(versionId) {
    if (!versionId) { return; }
    setError(versionsError, '');
    setText(versionsStatus, 'Restoring\\u2026');
    fetch(base + '/versions/' + versionId + '/restore', {
      method: 'POST',
      credentials: 'same-origin'
    }).then(function (res) {
      return res.json().then(function (json) {
        return { ok: res.ok, status: res.status, body: json };
      });
    }).then(function (res) {
      if (!res.ok) {
        setText(versionsStatus, '');
        setError(versionsError, (res.body && res.body.error) || ('Restore failed (HTTP ' + res.status + ')'));
        return;
      }
      setText(versionsStatus, 'Restored — reloading\\u2026');
      window.location.reload();
    }).catch(function () {
      setText(versionsStatus, '');
      setError(versionsError, 'Network error');
    });
  }
}());
`;
