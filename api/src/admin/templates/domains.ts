// Admin Domains template. Renders the /admin/domains shell with a
// 9-column table, a toolbar with the + New Site button, and the
// Create-Site modal (legacy form classes: .modal, .modal-content,
// .form-group, .form-input, .form-select). Submit posts to
// /api/admin/sites; Escape and Cancel close the modal.
//
// Important contract: this file MUST NOT contain ES6 lexical
// declarations or arrow functions in the source text (T4 ES5 check).
// Use `var` and `function` everywhere.

import { adminLayout } from "./layout";

export interface DomainEntry {
  id?: string;
  domain: string;
  name?: string;
  vertical?: string;
  activity?: string;
  status?: string;
  articles?: number;
  created?: string;
  last_provisioned?: string;
}

export interface VerticalEntry {
  slug: string;
  label?: string;
}

export interface DomainsBranding {
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

function renderRow(d: DomainEntry): string {
  var domain = escapeHtml(d.domain);
  var siteName = escapeHtml(d.name);
  var vertical = escapeHtml(d.vertical);
  var activity = escapeHtml(d.activity || "main");
  var status = escapeHtml(d.status || "active");
  var articles = typeof d.articles === "number" ? String(d.articles) : "0";
  var created = escapeHtml(d.created);
  var lastProvisioned = escapeHtml(d.last_provisioned);
  return '<tr data-domain="' + domain + '">'
    + '<td>' + domain + '</td>'
    + '<td>' + siteName + '</td>'
    + '<td>' + vertical + '</td>'
    + '<td>' + activity + '</td>'
    + '<td><span class="badge">' + status + '</span></td>'
    + '<td>' + articles + '</td>'
    + '<td>' + created + '</td>'
    + '<td>' + lastProvisioned + '</td>'
    + '<td><button type="button" class="btn btn-sm btn-secondary" data-row-action="actions">Actions</button></td>'
    + '</tr>';
}

function renderRows(domains: ReadonlyArray<DomainEntry>): string {
  if (!domains || domains.length === 0) {
    return '<tr><td colspan="9" class="empty-state">No sites yet</td></tr>';
  }
  return domains.map(function (d: DomainEntry): string {
    return renderRow(d);
  }).join("");
}

function renderVerticalOptions(verticals: ReadonlyArray<VerticalEntry>): string {
  if (!verticals || verticals.length === 0) { return ""; }
  return verticals.map(function (v: VerticalEntry): string {
    var label = escapeHtml(v.label || v.slug);
    return '<option value="' + escapeHtml(v.slug) + '">' + label + '</option>';
  }).join("");
}

function renderToolbar(): string {
  return '<div class="toolbar">'
    + '<button type="button" id="open-new-site-modal" class="btn btn-primary">+ New Site</button>'
    + '</div>';
}

function renderTable(rows: string): string {
  return '<div class="card">'
    + '<div class="table-wrapper">'
    + '<table class="table domains-list" aria-label="Domains list">'
    + '<thead><tr>'
    + '<th scope="col">Domain</th>'
    + '<th scope="col">Site name</th>'
    + '<th scope="col">Vertical</th>'
    + '<th scope="col">Activity</th>'
    + '<th scope="col">Status</th>'
    + '<th scope="col">Articles</th>'
    + '<th scope="col">Created</th>'
    + '<th scope="col">Last provisioned</th>'
    + '<th scope="col">Actions</th>'
    + '</tr></thead>'
    + '<tbody id="domains-list-body" data-empty="No sites yet">' + rows + '</tbody>'
    + '</table>'
    + '</div>'
    + '</div>';
}

function renderModal(verticalOptions: string): string {
  return '<div id="new-site-modal" class="modal hidden" style="display:none;" role="dialog" aria-labelledby="new-site-modal-title" aria-hidden="true">'
    + '<div class="modal-content">'
    + '<h2 id="new-site-modal-title" class="modal-title">Add New Site</h2>'
    + '<form id="new-site-form" data-action="submit-new-site">'
    + '<div class="form-group">'
    + '<label for="new-site-domain" class="form-label">Domain</label>'
    + '<input id="new-site-domain" name="domain" type="text" class="form-input" autocomplete="off" required />'
    + '</div>'
    + '<div class="form-group">'
    + '<label for="new-site-site-name" class="form-label">Site name</label>'
    + '<input id="new-site-site-name" name="name" type="text" class="form-input" required />'
    + '</div>'
    + '<div class="form-group">'
    + '<label for="new-site-vertical" class="form-label">Vertical</label>'
    + '<select id="new-site-vertical" name="vertical_slug" class="form-select" required>' + verticalOptions + '</select>'
    + '</div>'
    + '<div class="form-group">'
    + '<label for="new-site-activity" class="form-label">Activity</label>'
    + '<select id="new-site-activity" name="activity" class="form-select"><option value="main" selected>main</option></select>'
    + '</div>'
    + '<p id="new-site-error" class="alert alert-error" hidden role="alert"></p>'
    + '<div class="modal-actions">'
    + '<button type="submit" class="btn btn-primary">Create site</button>'
    + '<button type="button" id="new-site-cancel" class="btn btn-secondary">Cancel</button>'
    + '</div>'
    + '</form>'
    + '</div>'
    + '</div>';
}

var MODAL_STYLES = '.modal{position:fixed;inset:0;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;z-index:1000}'
  + '.modal.hidden{display:none}'
  + '.modal-content{background:#fff;border-radius:8px;padding:24px;max-width:520px;width:90%;max-height:90vh;overflow-y:auto;box-shadow:0 10px 25px rgba(0,0,0,0.15)}'
  + '.modal-title{margin-bottom:16px;font-size:18px;font-weight:600}'
  + '.modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}';

var MODAL_SCRIPT = '(function(){'
  + 'var modal=document.getElementById("new-site-modal");'
  + 'var opener=document.getElementById("open-new-site-modal");'
  + 'var cancel=document.getElementById("new-site-cancel");'
  + 'if(!modal||!opener){return;}'
  + 'function openModal(){modal.style.display="flex";modal.classList.remove("hidden");modal.setAttribute("aria-hidden","false");}'
  + 'function closeModal(){modal.style.display="none";modal.classList.add("hidden");modal.setAttribute("aria-hidden","true");}'
  + 'function showError(msg){var err=document.getElementById("new-site-error");if(err){err.hidden=false;err.textContent=msg;}}'
  + 'function clearError(){var err=document.getElementById("new-site-error");if(err){err.hidden=true;err.textContent="";}}'
  + 'function escapeText(s){var d=document.createElement("div");d.appendChild(document.createTextNode(String(s==null?"":s)));return d.innerHTML;}'
  + 'function appendDomainRow(d){'
  + 'var tbody=document.getElementById("domains-list-body");'
  + 'if(!tbody){return;}'
  + 'var placeholder=tbody.querySelector("tr td.empty-state");'
  + 'if(placeholder&&placeholder.parentNode){placeholder.parentNode.removeChild(placeholder);}'
  + 'var tr=document.createElement("tr");'
  + 'tr.setAttribute("data-domain",d.domain||"");'
  + 'tr.setAttribute("data-site-id",d.id||"");'
  + 'tr.innerHTML="<td>"+escapeText(d.domain)+"</td><td>"+escapeText(d.name)+"</td><td>"+escapeText(d.vertical_slug)+"</td><td>"+escapeText(d.activity||"main")+"</td><td>provisioning</td><td>0</td><td>"+escapeText(d.created)+"</td><td></td><td></td>";'
  + 'tbody.appendChild(tr);'
  + '}'
  + 'function startProvisioningPanel(siteId,domain){'
  + 'var existing=document.getElementById("provisioning-status-panel");'
  + 'if(existing&&existing.parentNode){existing.parentNode.removeChild(existing);}'
  + 'var panel=document.createElement("section");'
  + 'panel.id="provisioning-status-panel";'
  + 'panel.className="card provisioning-status";'
  + 'panel.setAttribute("data-site-id",siteId||"");'
  + 'panel.innerHTML="<h3>Provisioning "+escapeText(domain)+"</h3><p data-status>Starting...</p><ul data-steps></ul>";'
  + 'var toolbar=document.querySelector(".toolbar");'
  + 'if(toolbar&&toolbar.parentNode){toolbar.parentNode.insertBefore(panel,toolbar.nextSibling);}else{document.body.appendChild(panel);}'
  + 'var statusEl=panel.querySelector("[data-status]");'
  + 'var stepsEl=panel.querySelector("[data-steps]");'
  + 'function poll(){'
  + 'fetch("/api/admin/sites/"+encodeURIComponent(siteId||"")+"/provision",{method:"GET",credentials:"same-origin",headers:{"Accept":"application/json"}})'
  + '.then(function(r){return r.json().then(function(j){return{ok:r.ok,status:r.status,body:j};},function(){return{ok:r.ok,status:r.status,body:null};});})'
  + '.then(function(res){'
  + 'if(!res.ok){if(statusEl){statusEl.textContent="Error: "+res.status;}return;}'
  + 'var body=res.body||{};'
  + 'var state=body.state||body.status||"pending";'
  + 'if(statusEl){statusEl.textContent="Status: "+state;}'
  + 'var steps=body.steps||[];'
  + 'if(stepsEl&&steps&&steps.length){var html="";for(var i=0;i<steps.length;i++){var s=steps[i]||{};html+="<li>"+escapeText(s.name||s.id||("step "+i))+": "+escapeText(s.state||s.status||"")+"</li>";}stepsEl.innerHTML=html;}'
  + 'if(state!=="completed"&&state!=="failed"&&state!=="ready"){window.setTimeout(poll,1500);}'
  + '})'
  + '.catch(function(){if(statusEl){statusEl.textContent="Network error";}window.setTimeout(poll,2500);});'
  + '}'
  + 'poll();'
  + '}'
  + 'opener.addEventListener("click",function(){clearError();openModal();});'
  + 'if(cancel){cancel.addEventListener("click",closeModal);}'
  + 'document.addEventListener("keydown",function(e){if(e.key==="Escape"){closeModal();}});'
  + 'modal.addEventListener("click",function(e){if(e.target===modal){closeModal();}});'
  + 'var form=document.getElementById("new-site-form");'
  + 'if(form){form.addEventListener("submit",function(e){'
  + 'e.preventDefault();'
  + 'clearError();'
  + 'var fd=new FormData(form);'
  + 'var body={domain:fd.get("domain"),"name":fd.get("name"),vertical_slug:fd.get("vertical_slug"),activity:fd.get("activity")};'
  + 'fetch("/api/admin/sites",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),credentials:"same-origin"})'
  + '.then(function(r){return r.json().then(function(j){return{ok:r.ok,status:r.status,body:j};},function(){return{ok:r.ok,status:r.status,body:null};});})'
  + '.then(function(res){'
  + 'if(res.ok){'
  + 'closeModal();'
  + 'var rb=res.body||{};'
  + 'var siteId=rb.id||rb.site_id||(rb.site&&rb.site.id)||"";'
  + 'var rowData={id:siteId,domain:body.domain,name:body.name,vertical_slug:body.vertical_slug,activity:body.activity,created:rb.created||rb.created_at||""};'
  + 'appendDomainRow(rowData);'
  + 'startProvisioningPanel(siteId,rowData.domain);'
  + '}else{showError((res.body&&(res.body.error||res.body.message))||("Error: "+res.status));}'
  + '})'
  + '.catch(function(){showError("Network error");});'
  + '});}'
  + '}());';

export function domainsPage(
  domains: ReadonlyArray<DomainEntry>,
  verticals: ReadonlyArray<VerticalEntry>,
  branding: DomainsBranding = {},
): string {
  var rows = renderRows(domains);
  var options = renderVerticalOptions(verticals);
  var content = renderToolbar() + renderTable(rows) + renderModal(options);
  return adminLayout({
    title: "Domains",
    activePath: "/admin/domains",
    userEmail: branding.userEmail,
    content: content,
    styles: MODAL_STYLES,
    scripts: MODAL_SCRIPT,
  });
}
