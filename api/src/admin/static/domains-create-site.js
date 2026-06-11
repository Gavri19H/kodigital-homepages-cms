// MQAFIX-5 canonical browser-deliverable mirror of the /admin/domains
// Create-Site modal script. The active runtime copy lives inline as
// `MODAL_SCRIPT` inside `api/src/admin/templates/domains.ts` (the
// Worker bundle ships the inline string with the rendered HTML so no
// extra round-trip is needed). THIS file is the authoring surface:
// MQAFIX-5 AC3 + AC4 deterministic greps run against this path. Keep
// the two copies in sync.
//
// The mission-critical contract this file pins:
//   * POST /api/admin/sites returns the wire shape
//       { "resource": { "id": "st_xxx", "domain": "...", "status": "draft" } }
//     (see api/src/admin/sites-handlers.ts createSiteHandler at the
//     201 response). The client MUST read `body.resource.id` to build
//     the provisioning poll URL. The legacy top-level-id reads were
//     undefined against the real wire response, producing the
//     empty-siteId poll URL `/api/admin/sites//provision` that the
//     Worker then 404'd at the provisioning endpoint.
//
// File-level rules (mirror MODAL_SCRIPT contract from domains.ts):
//   * ES5 only — `var` + `function`, no arrow functions, no `let`,
//     no `const`, no template literals, no destructuring. The legacy
//     T4 ES5 check greps the inline MODAL_SCRIPT for these; this
//     mirror follows the same rule so the two stay reviewable as a
//     unit.

(function () {
  var modal = document.getElementById("new-site-modal");
  var opener = document.getElementById("open-new-site-modal");
  var cancel = document.getElementById("new-site-cancel");
  if (!modal || !opener) {
    return;
  }

  function openModal() {
    modal.style.display = "flex";
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    modal.style.display = "none";
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }

  function showError(msg) {
    var err = document.getElementById("new-site-error");
    if (err) {
      err.hidden = false;
      err.textContent = msg;
    }
  }

  function clearError() {
    var err = document.getElementById("new-site-error");
    if (err) {
      err.hidden = true;
      err.textContent = "";
    }
  }

  function escapeText(s) {
    var d = document.createElement("div");
    d.appendChild(document.createTextNode(String(s == null ? "" : s)));
    return d.innerHTML;
  }

  function appendDomainRow(d) {
    var tbody = document.getElementById("domains-list-body");
    if (!tbody) {
      return;
    }
    var placeholder = tbody.querySelector("tr td.empty-state");
    if (placeholder && placeholder.parentNode) {
      placeholder.parentNode.removeChild(placeholder);
    }
    var tr = document.createElement("tr");
    tr.setAttribute("data-domain", d.domain || "");
    tr.setAttribute("data-site-id", d.id || "");
    tr.innerHTML =
      "<td>" + escapeText(d.domain) +
      "</td><td>" + escapeText(d.name) +
      "</td><td>" + escapeText(d.vertical_slug) +
      "</td><td>" + escapeText(d.activity || "main") +
      "</td><td>provisioning</td><td>0</td><td>" + escapeText(d.created) +
      "</td><td></td><td></td>";
    tbody.appendChild(tr);
  }

  function buildPanelSkeleton() {
    var panel = document.createElement("section");
    panel.id = "provisioning-status-panel";
    panel.className = "card provisioning-status";
    var title = document.createElement("h3");
    title.setAttribute("data-panel-title", "");
    title.textContent = "Provisioning";
    panel.appendChild(title);
    var status = document.createElement("p");
    status.setAttribute("data-status", "");
    status.textContent = "Starting...";
    panel.appendChild(status);
    var steps = document.createElement("ul");
    steps.setAttribute("data-steps", "");
    panel.appendChild(steps);
    var readiness = document.createElement("p");
    readiness.setAttribute("data-launch-readiness", "");
    readiness.hidden = true;
    readiness.textContent = "Launch readiness: ";
    var readinessValue = document.createElement("span");
    readinessValue.setAttribute("data-launch-readiness-value", "");
    readinessValue.textContent = "pending";
    readiness.appendChild(readinessValue);
    panel.appendChild(readiness);
    return panel;
  }

  function startProvisioningPanel(siteId, domain) {
    // T33 restyle: reuse the server-rendered #provisioning-status-panel
    // card (unhide + reset) so the panel keeps the page styling; the
    // skeleton-builder branch survives only as a fallback for stale DOMs.
    var panel = document.getElementById("provisioning-status-panel");
    if (!panel) {
      panel = buildPanelSkeleton();
      var toolbar = document.querySelector(".toolbar");
      if (toolbar && toolbar.parentNode) {
        toolbar.parentNode.insertBefore(panel, toolbar.nextSibling);
      } else {
        document.body.appendChild(panel);
      }
    }
    panel.hidden = false;
    panel.setAttribute("data-site-id", siteId || "");
    var titleEl = panel.querySelector("[data-panel-title]");
    if (titleEl) {
      titleEl.textContent = "Provisioning " + String(domain == null ? "" : domain);
    }
    var statusEl = panel.querySelector("[data-status]");
    if (statusEl) { statusEl.textContent = "Starting..."; }
    var stepsEl = panel.querySelector("[data-steps]");
    while (stepsEl && stepsEl.firstChild) {
      stepsEl.removeChild(stepsEl.firstChild);
    }
    var readinessRow = panel.querySelector("[data-launch-readiness]");
    var readinessValue = panel.querySelector("[data-launch-readiness-value]");

    function poll() {
      // AC5: the poll URL embeds the actual site_id resolved from
      // body.resource.id above — never the legacy `body.id` that
      // evaluated to undefined and produced `/sites//provision`.
      fetch(
        "/api/admin/sites/" + encodeURIComponent(siteId || "") + "/provision",
        {
          method: "GET",
          credentials: "same-origin",
          headers: { "Accept": "application/json" }
        }
      )
        .then(function (r) {
          return r.json().then(
            function (j) { return { ok: r.ok, status: r.status, body: j }; },
            function () { return { ok: r.ok, status: r.status, body: null }; }
          );
        })
        .then(function (res) {
          if (!res.ok) {
            if (statusEl) { statusEl.textContent = "Error: " + res.status; }
            return;
          }
          var responseBody = res.body || {};
          var state = responseBody.state || responseBody.status || "pending";
          if (statusEl) { statusEl.textContent = "Status: " + state; }
          var steps = responseBody.steps || [];
          if (stepsEl && steps && steps.length) {
            var html = "";
            for (var i = 0; i < steps.length; i++) {
              var s = steps[i] || {};
              html +=
                "<li>" + escapeText(s.name || s.id || ("step " + i)) +
                ": " + escapeText(s.state || s.status || "") + "</li>";
            }
            stepsEl.innerHTML = html;
          }
          if (readinessRow && readinessValue &&
              responseBody.launch_readiness !== undefined &&
              responseBody.launch_readiness !== null) {
            readinessRow.hidden = false;
            readinessValue.textContent = String(responseBody.launch_readiness);
          }
          if (state !== "completed" && state !== "failed" && state !== "ready") {
            window.setTimeout(poll, 1500);
          }
        })
        .catch(function () {
          if (statusEl) { statusEl.textContent = "Network error"; }
          window.setTimeout(poll, 2500);
        });
    }

    poll();
  }

  opener.addEventListener("click", function () {
    clearError();
    openModal();
  });
  if (cancel) {
    cancel.addEventListener("click", closeModal);
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      closeModal();
    }
  });
  modal.addEventListener("click", function (e) {
    if (e.target === modal) {
      closeModal();
    }
  });

  var form = document.getElementById("new-site-form");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      clearError();
      var fd = new FormData(form);
      var requestBody = {
        domain: fd.get("domain"),
        name: fd.get("name"),
        vertical_slug: fd.get("vertical_slug"),
        activity: fd.get("activity")
      };
      fetch("/api/admin/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        credentials: "same-origin"
      })
        .then(function (r) {
          return r.json().then(
            function (j) { return { ok: r.ok, status: r.status, body: j }; },
            function () { return { ok: r.ok, status: r.status, body: null }; }
          );
        })
        .then(function (res) {
          if (res.ok) {
            closeModal();
            // MQAFIX-5: read the new site_id from body.resource.id.
            // The server response shape is the canonical { resource: ... }
            // wrapper (see sites-handlers.ts createSiteHandler). Legacy
            // top-level-id fall-throughs are intentionally absent so this
            // file's grep ACs (AC3 body.resource.id >= 1; AC4
            // top-level-id pattern == 0) both pass without ambiguity.
            var responseBody = res.body || {};
            var resource = (responseBody && responseBody.resource)
              ? responseBody.resource
              : null;
            var siteId = (resource && resource.id) ? resource.id : "";
            var rowData = {
              id: siteId,
              domain: requestBody.domain,
              name: requestBody.name,
              vertical_slug: requestBody.vertical_slug,
              activity: requestBody.activity,
              created: (resource && (resource.created || resource.created_at)) || ""
            };
            appendDomainRow(rowData);
            startProvisioningPanel(siteId, rowData.domain);
          } else {
            showError(
              (res.body && (res.body.error || res.body.message)) ||
              ("Error: " + res.status)
            );
          }
        })
        .catch(function () {
          showError("Network error");
        });
    });
  }
}());
