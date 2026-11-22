// Admin Domains template. Renders the /admin/domains shell with a
// 9-column table, a toolbar with the + New Site button, and the
// Create-Site modal (legacy form classes: .modal, .modal-content,
// .form-group, .form-input, .form-select). Submit posts to
// /api/admin/sites; Escape and Cancel close the modal.
//
// Important contract: this file MUST NOT contain ES6 lexical
// declarations or arrow functions in the source text (T4 ES5 check).
// Use `var` and `function` everywhere.
//
// MQAFIX-5: the inline MODAL_SCRIPT below is the active runtime source
// that the Worker serves with the /admin/domains HTML response. The
// browser-readable mirror at `api/src/admin/static/domains-create-site.js`
// is the canonical authoring surface for the same JS body (kept in sync
// by hand) and is the file the MQAFIX-5 deterministic AC3 + AC4 greps
// run against. Both copies read `body.resource.id` from the POST
// /api/admin/sites response (server returns `{ resource: { id, ... } }`
// — see sites-handlers.ts createSiteHandler) so the provisioning poll
// URL contains the actual site_id and never produces the legacy
// "//" double-slash 404.

import { adminLayout, escapeHtml } from "./layout";
import { SITE_STATUS_NEXT } from "../site-status";
import { mediaUrl } from "../../public/view-models/media-url";

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
  // X14: the site's tab icon / logo settings (bare media storage keys).
  favicon_media_id?: string;
  logo_media_id?: string;
}

export interface VerticalEntry {
  slug: string;
  label?: string;
}

export interface DomainsBranding {
  userEmail?: string;
  conversionsUiEnabled?: boolean;
}

// T35 [BCL-068]: per-row Actions menu. The same markup is rendered into
// every server-rendered row (renderRow) AND every client-appended row
// (appendDomainRow, via JSON.stringify(actionsCell()) so there is one
// source of truth). The delegated handler in DOMAINS_ACTIONS_SCRIPT reads
// data-action off the clicked item and data-site-id off the enclosing
// <tr> to call the existing endpoint for that action — no separate lookup
// to discover the site id. ES5 only (var/function, no arrow/const/let) so
// the markup can ride inside the inline browser scripts (L-014).
var ACTIONS_MENU_MARKUP = '<button type="button" class="btn btn-sm btn-secondary" data-row-action="toggle-actions" aria-haspopup="true" aria-expanded="false">Actions</button>'
  + '<ul class="actions-menu" data-actions-menu role="menu" hidden>'
  + '<li role="none"><button type="button" role="menuitem" class="actions-menu-item" data-action="edit">Edit</button></li>'
  + '<li role="none"><button type="button" role="menuitem" class="actions-menu-item" data-action="change-status">Change status</button></li>'
  + '<li role="none"><button type="button" role="menuitem" class="actions-menu-item" data-action="reprovision">Re-provision</button></li>'
  // T39 [BCL-013]: resume a stalled build to completion + (re-)open the live
  // progress panel; "View progress" re-opens the same panel read-only.
  + '<li role="none"><button type="button" role="menuitem" class="actions-menu-item" data-action="resume">Resume build</button></li>'
  + '<li role="none"><button type="button" role="menuitem" class="actions-menu-item" data-action="view-progress">View progress</button></li>'
  + '<li role="none"><button type="button" role="menuitem" class="actions-menu-item" data-action="purge-cache">Purge cache</button></li>'
  + '<li role="none"><button type="button" role="menuitem" class="actions-menu-item" data-action="delete">Delete</button></li>'
  + '</ul>';

function actionsCell(): string {
  return '<td class="actions-cell">' + ACTIONS_MENU_MARKUP + '</td>';
}

// X14: the small picture before each site's name. Preference order: the tab
// icon, else the uploaded logo, else a teal badge with the site's first letter.
// Only same-origin /media/ pictures qualify; the logo the setup step makes with
// AI (ai/<site>/logo/) is never used (public rule, see uploadedLogoUrl in
// public/templates/components.ts), and a bare number is not a storage key.
var AI_SETUP_LOGO_PATH = /^\/media\/ai\/[^/]+\/logo\//;

function siteMediaPath(ref: string | undefined): string | null {
  var key = typeof ref === "string" ? ref.trim() : "";
  if (key.length === 0 || /^[0-9]+$/.test(key)) { return null; }
  var url = mediaUrl(key);
  return url !== null && url.indexOf("/media/") === 0 ? url : null;
}

export function siteIconHtml(d: DomainEntry): string {
  var favicon = siteMediaPath(d.favicon_media_id);
  var logo = siteMediaPath(d.logo_media_id);
  var picture = favicon !== null
    ? favicon
    : (logo !== null && !AI_SETUP_LOGO_PATH.test(logo) ? logo : null);
  if (picture !== null) {
    return '<img class="site-icon" src="' + escapeHtml(picture) + '" width="24" height="24" alt="" loading="lazy" decoding="async" />';
  }
  var label = String(d.name || d.domain || "").trim();
  var letter = label.length > 0 ? Array.from(label)[0]!.toUpperCase() : "?";
  return '<span class="site-icon site-icon-letter" aria-hidden="true">' + escapeHtml(letter) + '</span>';
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
  var siteId = escapeHtml(d.id);
  return '<tr data-domain="' + domain + '" data-site-id="' + siteId + '" data-site-status="' + status + '">'
    + '<td>' + domain + '</td>'
    + '<td><span class="site-name-cell">' + siteIconHtml(d) + '<span class="site-name-text">' + siteName + '</span></span></td>'
    + '<td>' + vertical + '</td>'
    + '<td>' + activity + '</td>'
    + '<td><span class="badge">' + status + '</span></td>'
    + '<td>' + articles + '</td>'
    + '<td>' + created + '</td>'
    + '<td>' + lastProvisioned + '</td>'
    + actionsCell()
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

// T33 restyle: the provisioning status panel is server-rendered (hidden)
// so it participates in the card styling like every other admin surface;
// the modal script unhides and reuses THIS node instead of building one
// from scratch. T39 (D6): the poll body's launch_readiness object
// (domain_attached, published_articles, media_count, cache_warmed,
// smoke_passed, content_mode) fills the data-launch-readiness summary
// row and renders one .launch-readiness-badge per field into the
// data-launch-readiness-badges list; both stay hidden until the poll
// observes a non-null launch_readiness.
function renderProvisioningPanel(): string {
  return '<section id="provisioning-status-panel" class="card provisioning-status" role="status" aria-live="polite" data-site-id="" hidden>'
    + '<h3 data-panel-title>Provisioning</h3>'
    // T39 [BCL-013]: a Close control makes the panel re-openable — the
    // "View progress" / "Resume" row actions unhide it again on demand.
    + '<button type="button" class="btn btn-sm btn-secondary provisioning-panel-close" data-panel-close aria-label="Close progress panel">Close</button>'
    + '<p data-status>Idle</p>'
    + '<ul data-steps></ul>'
    + '<p class="launch-readiness" data-launch-readiness hidden>Launch readiness: <span data-launch-readiness-value>pending</span></p>'
    + '<ul class="launch-readiness-badges" data-launch-readiness-badges hidden></ul>'
    + '</section>';
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
    + '<label for="name" class="form-label">Site name</label>'
    + '<input id="name" name="name" type="text" class="form-input" required />'
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

// X04 (owner 2026-11-18): the two Actions that can take a live site down ask
// properly instead of through a browser pop-up. Same .modal look as "Add New
// Site". Server text only ever goes in through textContent (the script).
function renderDeleteSiteModal(): string {
  return '<div id="delete-site-modal" class="modal hidden" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="delete-site-title" aria-hidden="true">'
    + '<div class="modal-content">'
    + '<h2 id="delete-site-title" class="modal-title">Delete this site?</h2>'
    + '<form id="delete-site-form" novalidate>'
    + '<p class="alert alert-error" data-delete-what></p>'
    + '<div class="form-group">'
    + '<label for="delete-site-confirm" class="form-label" data-delete-label></label>'
    + '<input id="delete-site-confirm" type="text" class="form-input" autocomplete="off" />'
    + '</div>'
    + '<p class="alert alert-error" role="alert" data-delete-error hidden></p>'
    + '<div class="modal-actions">'
    + '<button type="button" class="btn btn-secondary" data-delete-cancel>Cancel</button>'
    + '<button type="submit" class="btn btn-danger" data-delete-submit disabled aria-disabled="true">Delete</button>'
    + '</div>'
    + '</form>'
    + '</div>'
    + '</div>';
}

function renderStatusModal(): string {
  return '<div id="site-status-modal" class="modal hidden" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="site-status-title" aria-hidden="true">'
    + '<div class="modal-content">'
    + '<h2 id="site-status-title" class="modal-title">Change status</h2>'
    + '<form id="site-status-form" novalidate>'
    + '<p class="form-help" data-status-now></p>'
    + '<div class="form-group">'
    + '<label for="site-status-select" class="form-label">New status</label>'
    + '<select id="site-status-select" class="form-select"></select>'
    + '</div>'
    + '<p class="status-warning" role="alert" data-status-warning hidden></p>'
    + '<p class="alert alert-error" role="alert" data-status-error hidden></p>'
    + '<div class="modal-actions">'
    + '<button type="button" class="btn btn-secondary" data-status-cancel>Cancel</button>'
    + '<button type="submit" class="btn btn-primary" data-status-submit>Save</button>'
    + '</div>'
    + '</form>'
    + '</div>'
    + '</div>';
}

var MODAL_STYLES = '.modal{position:fixed;inset:0;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;z-index:1000}'
  + '.modal.hidden{display:none}'
  + '.modal-content{background:#fff;border-radius:8px;padding:24px;max-width:520px;width:90%;max-height:90vh;overflow-y:auto;box-shadow:0 10px 25px rgba(0,0,0,0.15)}'
  + '.modal-title{margin-bottom:16px;font-size:18px;font-weight:600}'
  + '.modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}'
  + '.launch-readiness-badges{display:flex;flex-wrap:wrap;gap:6px;list-style:none;padding:0;margin:8px 0 0}'
  // T35: Actions menu — anchored to its row cell, hidden until toggled.
  + '.actions-cell{position:relative}'
  + '.actions-menu{position:absolute;right:0;top:100%;z-index:1100;min-width:170px;list-style:none;margin:4px 0 0;padding:4px 0;background:#fff;border:1px solid var(--c-border,#e5e7eb);border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,0.12)}'
  + '.actions-menu[hidden]{display:none}'
  + '.actions-menu-item{display:block;width:100%;text-align:left;padding:8px 14px;border:0;background:none;font-size:13px;line-height:1.4;cursor:pointer;color:var(--c-text,#111827)}'
  + '.actions-menu-item:hover,.actions-menu-item:focus{background:var(--c-bg-dark,#f3f4f6)}'
  // X04: the "disabled" warning in the Change status window.
  + '.status-warning{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:6px;padding:8px 10px;font-size:13px;margin:0}'
  + '.status-warning[hidden]{display:none}'
  + '#delete-site-modal .form-help,#site-status-modal .form-help{margin:0 0 12px}'
  // X14: the small site picture before each site name.
  + '.site-name-cell{display:inline-flex;align-items:center;gap:8px;min-width:0}'
  + '.site-name-text{min-width:0;overflow-wrap:anywhere}'
  + '.site-icon{flex:0 0 24px;width:24px;height:24px;border-radius:4px;object-fit:contain}'
  + '.site-icon-letter{display:inline-flex;align-items:center;justify-content:center;background:#1ba8c8;color:#fff;font-size:12px;font-weight:600;line-height:1}';

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
  + 'tr.innerHTML="<td>"+escapeText(d.domain)+"</td><td>"+escapeText(d.name)+"</td><td>"+escapeText(d.vertical_slug)+"</td><td>"+escapeText(d.activity||"main")+"</td><td>provisioning</td><td>0</td><td>"+escapeText(d.created)+"</td><td></td>"+' + JSON.stringify(actionsCell()) + ';'
  + 'tbody.appendChild(tr);'
  + '}'
  + 'function buildPanelSkeleton(){'
  + 'var panel=document.createElement("section");'
  + 'panel.id="provisioning-status-panel";'
  + 'panel.className="card provisioning-status";'
  + 'var title=document.createElement("h3");'
  + 'title.setAttribute("data-panel-title","");'
  + 'title.textContent="Provisioning";'
  + 'panel.appendChild(title);'
  + 'var status=document.createElement("p");'
  + 'status.setAttribute("data-status","");'
  + 'status.textContent="Starting...";'
  + 'panel.appendChild(status);'
  + 'var steps=document.createElement("ul");'
  + 'steps.setAttribute("data-steps","");'
  + 'panel.appendChild(steps);'
  + 'var readiness=document.createElement("p");'
  + 'readiness.setAttribute("data-launch-readiness","");'
  + 'readiness.hidden=true;'
  + 'readiness.textContent="Launch readiness: ";'
  + 'var readinessValue=document.createElement("span");'
  + 'readinessValue.setAttribute("data-launch-readiness-value","");'
  + 'readinessValue.textContent="pending";'
  + 'readiness.appendChild(readinessValue);'
  + 'panel.appendChild(readiness);'
  + 'var badges=document.createElement("ul");'
  + 'badges.className="launch-readiness-badges";'
  + 'badges.setAttribute("data-launch-readiness-badges","");'
  + 'badges.hidden=true;'
  + 'panel.appendChild(badges);'
  + 'return panel;'
  + '}'
  // T39 (D6): one badge per launch_readiness field. Boolean fields are
  // ready when true, numeric fields when > 0, string fields when
  // non-empty; ready badges reuse .badge-published, pending ones
  // .badge-draft (layout.ts badge palette). textContent only — no
  // innerHTML with server data (XSS guardrail).
  + 'function renderReadinessBadges(panel,readiness){'
  + 'var list=panel.querySelector("[data-launch-readiness-badges]");'
  + 'if(!list||!readiness||typeof readiness!=="object"){return;}'
  + 'var keys=["domain_attached","published_articles","media_count","cache_warmed","smoke_passed","content_mode"];'
  + 'while(list.firstChild){list.removeChild(list.firstChild);}'
  + 'var shown=0;'
  + 'for(var i=0;i<keys.length;i++){'
  + 'var key=keys[i];'
  + 'var value=readiness[key];'
  + 'if(value===undefined||value===null){continue;}'
  + 'var ready;'
  + 'if(typeof value==="boolean"){ready=value;}'
  + 'else if(typeof value==="number"){ready=value>0;}'
  + 'else{ready=String(value).length>0;}'
  + 'var li=document.createElement("li");'
  + 'li.className="badge launch-readiness-badge "+(ready?"badge-published":"badge-draft");'
  + 'li.setAttribute("data-readiness-key",key);'
  + 'li.textContent=key.split("_").join(" ")+": "+String(value);'
  + 'list.appendChild(li);'
  + 'shown++;'
  + '}'
  + 'list.hidden=shown===0;'
  + '}'
  + 'function startProvisioningPanel(siteId,domain){'
  // T33 restyle: reuse the server-rendered #provisioning-status-panel
  // card (unhide + reset) so the panel keeps the page styling; the
  // skeleton-builder branch survives only as a fallback for stale DOMs.
  + 'var panel=document.getElementById("provisioning-status-panel");'
  + 'if(!panel){'
  + 'panel=buildPanelSkeleton();'
  + 'var toolbar=document.querySelector(".toolbar");'
  + 'if(toolbar&&toolbar.parentNode){toolbar.parentNode.insertBefore(panel,toolbar.nextSibling);}else{document.body.appendChild(panel);}'
  + '}'
  + 'panel.hidden=false;'
  + 'panel.setAttribute("data-site-id",siteId||"");'
  + 'var titleEl=panel.querySelector("[data-panel-title]");'
  + 'if(titleEl){titleEl.textContent="Provisioning "+String(domain==null?"":domain);}'
  + 'var statusEl=panel.querySelector("[data-status]");'
  + 'if(statusEl){statusEl.textContent="Starting...";}'
  + 'var stepsEl=panel.querySelector("[data-steps]");'
  + 'while(stepsEl&&stepsEl.firstChild){stepsEl.removeChild(stepsEl.firstChild);}'
  + 'var readinessRow=panel.querySelector("[data-launch-readiness]");'
  + 'var readinessValue=panel.querySelector("[data-launch-readiness-value]");'
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
  // T39 (D6): an object launch_readiness renders per-field badges plus a
  // "N/3 checks ready" summary over the three boolean signals; any
  // non-object value falls back to the legacy stringified display.
  + 'if(readinessRow&&readinessValue&&body.launch_readiness!==undefined&&body.launch_readiness!==null){'
  + 'readinessRow.hidden=false;'
  + 'if(typeof body.launch_readiness==="object"){'
  + 'var lr=body.launch_readiness;'
  + 'var boolKeys=["domain_attached","cache_warmed","smoke_passed"];'
  + 'var readyCount=0;'
  + 'for(var bi=0;bi<boolKeys.length;bi++){if(lr[boolKeys[bi]]===true){readyCount++;}}'
  + 'readinessValue.textContent=readyCount+"/"+boolKeys.length+" checks ready";'
  + 'renderReadinessBadges(panel,lr);'
  + '}else{'
  + 'readinessValue.textContent=String(body.launch_readiness);'
  + '}'
  + '}'
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
  // MQAFIX-5: server returns {resource:{id,domain,status,...}} from POST
  // /api/admin/sites (see sites-handlers.ts createSiteHandler). Read
  // body.resource.id FIRST so the provisioning poll URL contains the
  // freshly created site_id; the legacy fall-throughs are gone because
  // they masked the missing field and produced a "//" double-slash poll
  // URL that 404ed. AC4 forbids any reference to body.id / body["id"].
  + 'var resource=(rb&&rb.resource)?rb.resource:null;'
  + 'var siteId=(resource&&resource.id)?resource.id:"";'
  + 'var rowData={id:siteId,domain:body.domain,name:body.name,vertical_slug:body.vertical_slug,activity:body.activity,created:(resource&&(resource.created||resource.created_at))||""};'
  + 'appendDomainRow(rowData);'
  + 'startProvisioningPanel(siteId,rowData.domain);'
  + '}else{showError((res.body&&(res.body.error||res.body.message))||("Error: "+res.status));}'
  + '})'
  + '.catch(function(){showError("Network error");});'
  + '});}'
  + '}());';

// T35 [BCL-068]: the per-row Actions menu wiring. Lives in its OWN IIFE
// (NOT inside MODAL_SCRIPT, whose top guard `if(!modal||!opener)return`
// would otherwise short-circuit the whole script on pages without the
// Create-Site modal). Uses event delegation on #domains-list-body so it
// covers both server-rendered rows and rows appended after a create.
//
// Action -> existing endpoint (all under /api/admin/sites/:id):
//   Edit          -> opens /admin/settings?site_id=:id (X04; no rename here)
//   Change status -> PATCH /sites/:id    {status}  through the X04 window that
//                    lists only SITE_STATUS_NEXT[current] (updateSiteHandler
//                    enforces the same lists)
//   Re-provision  -> POST  /sites/:id/provision/next
//   Purge cache   -> POST  /sites/:id/purge-cache
//   Delete        -> DELETE /sites/:id   through the X04 window (type the
//                    domain exactly first)
// On a 2xx the row refreshes: Delete removes the <tr>; every other action
// re-fetches GET /sites/:id and repaints the name + status cells. The
// status cell is rebuilt with createElement + textContent (never innerHTML
// with server data — XSS guardrail). ES5 only (var/function, no
// arrow/const/let) — it ships inside the inline <script> block (L-014).
var DOMAINS_ACTIONS_SCRIPT = '(function(){'
  + 'var tbody=document.getElementById("domains-list-body");'
  + 'if(!tbody){return;}'
  + 'function closeMenus(){'
  + 'var menus=tbody.querySelectorAll("[data-actions-menu]");'
  + 'for(var i=0;i<menus.length;i++){menus[i].hidden=true;}'
  + 'var toggles=tbody.querySelectorAll("[data-row-action]");'
  + 'for(var j=0;j<toggles.length;j++){toggles[j].setAttribute("aria-expanded","false");}'
  + '}'
  + 'function closestAttr(node,attr){while(node&&node.nodeType===1){if(node.getAttribute&&node.getAttribute(attr)!==null){return node;}node=node.parentNode;}return null;}'
  + 'function findRow(node){while(node&&node.nodeType===1){if(node.tagName==="TR"&&node.getAttribute("data-site-id")!==null){return node;}node=node.parentNode;}return null;}'
  + 'function setRowName(row,name){var cells=row.children;if(cells[1]&&name!=null){cells[1].textContent=String(name);}}'
  + 'function setRowStatus(row,status){'
  + 'var cells=row.children;var cell=cells[4];if(!cell){return;}'
  + 'while(cell.firstChild){cell.removeChild(cell.firstChild);}'
  + 'var badge=document.createElement("span");'
  + 'badge.className="badge";'
  + 'badge.textContent=String(status==null?"":status);'
  + 'cell.appendChild(badge);'
  + 'if(status!=null){row.setAttribute("data-site-status",String(status));}'
  + '}'
  + 'function refreshRow(row,siteId){'
  + 'return fetch("/api/admin/sites/"+encodeURIComponent(siteId),{method:"GET",credentials:"same-origin",headers:{"Accept":"application/json"}})'
  + '.then(function(r){return r.ok?r.json():null;})'
  + '.then(function(j){if(!j){return;}var site=j.resource||j;setRowName(row,site.name);setRowStatus(row,site.status);})'
  + '.catch(function(){});'
  + '}'
  // X04: every call answers {ok,status,body}; nothing is swallowed any more,
  // so each action can say what happened (toast) or show the server's error.
  + 'function call(method,url,payload){'
  + 'var init={method:method,credentials:"same-origin",headers:{"Accept":"application/json"}};'
  + 'if(payload!==undefined){init.headers["Content-Type"]="application/json";init.body=JSON.stringify(payload);}'
  + 'return fetch(url,init).then(function(r){return r.json().then(function(j){return{ok:r.ok,status:r.status,body:j};},function(){return{ok:r.ok,status:r.status,body:null};});});'
  + '}'
  + 'function siteUrl(siteId,suffix){return "/api/admin/sites/"+encodeURIComponent(siteId)+(suffix||"");}'
  + 'function errText(res,fallback){return (res&&res.body&&(res.body.error||res.body.message))||(fallback+" ("+(res?res.status:"network")+")");}'
  + 'function toast(msg,kind){if(window.showToast){window.showToast(msg,kind||"success");}}'
  + 'function rowsOf(siteId){var out=[];var all=tbody.querySelectorAll("[data-site-id]");for(var i=0;i<all.length;i++){if(all[i].getAttribute("data-site-id")===siteId){out.push(all[i]);}}return out;}'
  + 'function postAction(siteId,row,suffix,label,okText){'
  + 'return call("POST",siteUrl(siteId,suffix)).then(function(res){'
  + 'if(!res.ok){toast(errText(res,label+" failed"),"error");return;}'
  + 'toast(okText(res.body||{}),"success");'
  + 'return refreshRow(row,siteId);'
  + '},function(){toast("Network error. "+label+" did not run.","error");});'
  + '}'
  // T39 [BCL-013]: the re-openable progress panel. getPanel() looks up the
  // server-rendered #provisioning-status-panel each call so closeProgressPanel
  // + openProgressPanel can hide/unhide it repeatedly (re-openable). The poll
  // reads the REAL GET /provision shape {resource:{status,step_key,
  // current_step},launch_readiness}; textContent only (no markup assignment) —
  // XSS guardrail. The poll re-schedules until the job reaches a terminal
  // status, so the panel tracks a resume drive to completion.
  + 'function getPanel(){return document.getElementById("provisioning-status-panel");}'
  + 'function setText(el,t){if(el){el.textContent=String(t==null?"":t);}}'
  + 'function closeProgressPanel(){var p=getPanel();if(p){p.hidden=true;}}'
  + 'function openProgressPanel(siteId,domain){'
  + 'var panel=getPanel();'
  + 'if(!panel||!siteId){return;}'
  + 'panel.hidden=false;'
  + 'panel.setAttribute("data-site-id",siteId);'
  + 'setText(panel.querySelector("[data-panel-title]"),"Provisioning "+String(domain==null?"":domain));'
  + 'var statusEl=panel.querySelector("[data-status]");'
  + 'setText(statusEl,"Loading...");'
  + 'var stepsEl=panel.querySelector("[data-steps]");'
  + 'while(stepsEl&&stepsEl.firstChild){stepsEl.removeChild(stepsEl.firstChild);}'
  + 'var readinessRow=panel.querySelector("[data-launch-readiness]");'
  + 'var readinessValue=panel.querySelector("[data-launch-readiness-value]");'
  + 'function poll(){'
  + 'fetch("/api/admin/sites/"+encodeURIComponent(siteId)+"/provision",{method:"GET",credentials:"same-origin",headers:{"Accept":"application/json"}})'
  + '.then(function(r){return r.ok?r.json():null;})'
  + '.then(function(body){'
  + 'if(!body){setText(statusEl,"Provisioning status not available");return;}'
  + 'var res=body.resource||{};'
  + 'var state=res.status||"pending";'
  + 'var stepKey=res.step_key||"";'
  + 'var stepIdx=(res.current_step==null)?"":res.current_step;'
  + 'setText(statusEl,"Status: "+state+(stepKey?(" \\u2014 step "+stepIdx+": "+stepKey):""));'
  + 'if(readinessRow&&readinessValue&&body.launch_readiness!=null&&typeof body.launch_readiness==="object"){'
  + 'readinessRow.hidden=false;'
  + 'var lr=body.launch_readiness;'
  + 'var boolKeys=["domain_attached","cache_warmed","smoke_passed"];'
  + 'var readyCount=0;'
  + 'for(var bi=0;bi<boolKeys.length;bi++){if(lr[boolKeys[bi]]===true){readyCount++;}}'
  + 'setText(readinessValue,readyCount+"/"+boolKeys.length+" checks ready");'
  + '}'
  + 'if(state!=="completed"&&state!=="failed"){window.setTimeout(poll,1500);}'
  + '})'
  + '.catch(function(){setText(statusEl,"Network error");window.setTimeout(poll,2500);});'
  + '}'
  + 'poll();'
  + '}'
  + 'function resumeBuild(siteId,row){'
  // Open the panel first (immediate feedback) THEN drive the resume; the
  // poll observes the build advance through to status='completed'.
  + 'openProgressPanel(siteId,row?row.getAttribute("data-domain"):"");'
  + 'return call("POST",siteUrl(siteId,"/provision/resume")).then(function(res){'
  + 'if(!res.ok){toast(errText(res,"Resume build failed"),"error");return;}'
  + 'var b=res.body||{};'
  + 'toast(b.resumed?"Build resumed":"Nothing to resume: the build is complete","success");'
  + 'return refreshRow(row,siteId);'
  + '},function(){toast("Network error. Resume build did not run.","error");});'
  + '}'
  // X04 modal plumbing (same show/hide as the Add New Site modal).
  + 'function showModal(m){if(m){m.style.display="flex";m.classList.remove("hidden");m.setAttribute("aria-hidden","false");}}'
  + 'function hideModal(m){if(m){m.style.display="none";m.classList.add("hidden");m.setAttribute("aria-hidden","true");}}'
  + 'function part(m,attr){return m?m.querySelector("["+attr+"]"):null;}'
  + 'function showErr(el,msg){if(!el){return;}el.textContent=msg||"";el.hidden=!msg;}'
  // The status the row was rendered/refreshed with (data-site-status), with
  // the badge text only as a fallback for rows appended after a create.
  + 'function currentStatus(row){var a=row?row.getAttribute("data-site-status"):null;if(a){return a;}var c=row&&row.children?row.children[4]:null;return c?String(c.textContent||"").replace(/^\\s+|\\s+$/g,""):"";}'
  // X04 Delete: type the domain exactly before "Delete" turns on.
  + 'var delModal=document.getElementById("delete-site-modal");'
  + 'var delForm=document.getElementById("delete-site-form");'
  + 'var delInput=document.getElementById("delete-site-confirm");'
  + 'var delTarget={siteId:"",domain:"",row:null};'
  + 'function syncDelete(){var b=part(delModal,"data-delete-submit");if(!b){return;}var ok=!!delInput&&delTarget.domain!==""&&String(delInput.value||"")===delTarget.domain;b.disabled=!ok;b.setAttribute("aria-disabled",ok?"false":"true");}'
  + 'function openDelete(siteId,row){'
  + 'if(!delModal){return;}'
  + 'var domain=row?String(row.getAttribute("data-domain")||""):"";'
  + 'delTarget={siteId:siteId,domain:domain,row:row};'
  + 'var what=part(delModal,"data-delete-what");if(what){what.textContent="This takes "+domain+" offline and permanently removes its articles, pages and settings. It can\'t be undone.";}'
  + 'var lab=part(delModal,"data-delete-label");if(lab){while(lab.firstChild){lab.removeChild(lab.firstChild);}lab.appendChild(document.createTextNode("Type "));var strong=document.createElement("strong");strong.textContent=domain;lab.appendChild(strong);lab.appendChild(document.createTextNode(" to confirm."));}'
  + 'showErr(part(delModal,"data-delete-error"),"");'
  + 'if(delInput){delInput.value="";}'
  + 'syncDelete();'
  + 'showModal(delModal);'
  + 'if(delInput){delInput.focus();}'
  + '}'
  + 'if(delInput){delInput.addEventListener("input",syncDelete);}'
  + 'if(delModal){delModal.addEventListener("click",function(e){if(e.target===delModal||closestAttr(e.target,"data-delete-cancel")){hideModal(delModal);}});}'
  + 'if(delForm){delForm.addEventListener("submit",function(e){'
  + 'e.preventDefault();'
  + 'var b=part(delModal,"data-delete-submit");if(!b||b.disabled){return;}'
  + 'b.disabled=true;showErr(part(delModal,"data-delete-error"),"");'
  + 'call("DELETE",siteUrl(delTarget.siteId)).then(function(res){'
  + 'if(!res.ok){syncDelete();showErr(part(delModal,"data-delete-error"),errText(res,"Delete failed"));return;}'
  + 'hideModal(delModal);'
  + 'var rows=rowsOf(delTarget.siteId);for(var i=0;i<rows.length;i++){if(rows[i].parentNode){rows[i].parentNode.removeChild(rows[i]);}}'
  + 'var pnl=getPanel();if(pnl&&pnl.getAttribute("data-site-id")===delTarget.siteId){closeProgressPanel();}'
  + 'toast("Site deleted","success");'
  + '},function(){syncDelete();showErr(part(delModal,"data-delete-error"),"Network error. The site was not deleted.");});'
  + '});}'
  // X04 Change status: only the statuses the server allows from the current
  // one (SITE_STATUS_NEXT, the same lists the PATCH handler checks); a
  // warning and a red "Disable site" before "disabled".
  + 'var NEXT=' + JSON.stringify(SITE_STATUS_NEXT) + ';'
  + 'var stModal=document.getElementById("site-status-modal");'
  + 'var stForm=document.getElementById("site-status-form");'
  + 'var stSelect=document.getElementById("site-status-select");'
  + 'var stTarget={siteId:"",domain:"",row:null};'
  + 'function syncStatus(){'
  + 'var v=stSelect?stSelect.value:"";'
  + 'var warn=part(stModal,"data-status-warning");'
  + 'var b=part(stModal,"data-status-submit");'
  + 'var dis=v==="disabled";'
  + 'if(warn){warn.textContent=dis?("Disabled takes "+stTarget.domain+" offline: every page answers \u201cGone\u201d to visitors and to Google until you set it back to active."):"";warn.hidden=!dis;}'
  + 'if(b){b.textContent=dis?"Disable site":"Save";b.className=dis?"btn btn-danger":"btn btn-primary";b.disabled=!v;}'
  + '}'
  + 'function openStatus(siteId,row){'
  + 'if(!stModal||!stSelect){return;}'
  + 'var now=currentStatus(row);'
  + 'stTarget={siteId:siteId,domain:row?String(row.getAttribute("data-domain")||""):"",row:row};'
  + 'var nowEl=part(stModal,"data-status-now");if(nowEl){nowEl.textContent=stTarget.domain+" is "+(now||"unknown")+" now.";}'
  + 'while(stSelect.firstChild){stSelect.removeChild(stSelect.firstChild);}'
  + 'var opts=NEXT[now]||[];'
  + 'for(var i=0;i<opts.length;i++){var o=document.createElement("option");o.value=opts[i];o.textContent=opts[i];stSelect.appendChild(o);}'
  + 'showErr(part(stModal,"data-status-error"),opts.length?"":"No other status is allowed from \u201c"+now+"\u201d.");'
  + 'stSelect.disabled=opts.length===0;'
  + 'syncStatus();'
  + 'showModal(stModal);'
  + 'stSelect.focus();'
  + '}'
  + 'if(stSelect){stSelect.addEventListener("change",syncStatus);}'
  + 'if(stModal){stModal.addEventListener("click",function(e){if(e.target===stModal||closestAttr(e.target,"data-status-cancel")){hideModal(stModal);}});}'
  + 'if(stForm){stForm.addEventListener("submit",function(e){'
  + 'e.preventDefault();'
  + 'var b=part(stModal,"data-status-submit");var v=stSelect?stSelect.value:"";'
  + 'if(!b||b.disabled||!v){return;}'
  + 'b.disabled=true;showErr(part(stModal,"data-status-error"),"");'
  + 'call("PATCH",siteUrl(stTarget.siteId),{status:v}).then(function(res){'
  + 'b.disabled=false;'
  + 'if(!res.ok){showErr(part(stModal,"data-status-error"),errText(res,"Status change failed"));return;}'
  + 'hideModal(stModal);'
  + 'var site=(res.body&&res.body.resource)||{};'
  + 'var rows=rowsOf(stTarget.siteId);for(var i=0;i<rows.length;i++){setRowStatus(rows[i],site.status||v);}'
  + 'toast("Status changed","success");'
  + '},function(){b.disabled=false;showErr(part(stModal,"data-status-error"),"Network error. The status was not changed.");});'
  + '});}'
  + 'document.addEventListener("keydown",function(e){if(e.key==="Escape"){hideModal(delModal);hideModal(stModal);}});'
  + 'function doAction(action,row,siteId){'
  // X04 (owner 2026-11-18): Edit opens this site's Settings; Domains renames nothing.
  + 'if(action==="edit"){window.location.href="/admin/settings?site_id="+encodeURIComponent(siteId);return;}'
  + 'if(action==="change-status"){openStatus(siteId,row);return;}'
  + 'if(action==="reprovision"){return postAction(siteId,row,"/provision/next","Re-provision",function(b){return b.completed?"Nothing to re-provision: the build is complete":"Re-provision ran step "+(b.current_step||"")+" ("+(b.status||"")+")";});}'
  + 'if(action==="resume"){return resumeBuild(siteId,row);}'
  + 'if(action==="view-progress"){openProgressPanel(siteId,row?row.getAttribute("data-domain"):"");return;}'
  + 'if(action==="purge-cache"){return postAction(siteId,row,"/purge-cache","Purge cache",function(b){var st=b.resource&&b.resource.status?b.resource.status:"";return "Cache purged"+(st?" ("+st+")":"");});}'
  + 'if(action==="delete"){openDelete(siteId,row);return;}'
  + '}'
  + 'tbody.addEventListener("click",function(e){'
  + 'var target=e.target;'
  + 'var toggle=closestAttr(target,"data-row-action");'
  + 'if(toggle){'
  + 'var trow=findRow(toggle);if(!trow){return;}'
  + 'var menu=trow.querySelector("[data-actions-menu]");'
  + 'var willOpen=menu&&menu.hidden;'
  + 'closeMenus();'
  + 'if(menu&&willOpen){menu.hidden=false;toggle.setAttribute("aria-expanded","true");}'
  + 'return;'
  + '}'
  + 'var item=closestAttr(target,"data-action");'
  + 'if(item){'
  + 'var arow=findRow(item);if(!arow){return;}'
  + 'var siteId=arow.getAttribute("data-site-id");'
  + 'closeMenus();'
  + 'if(siteId){doAction(item.getAttribute("data-action"),arow,siteId);}'
  + '}'
  + '});'
  + 'document.addEventListener("click",function(e){'
  + 'var t=e.target;'
  + 'if(!closestAttr(t,"data-actions-menu")&&!closestAttr(t,"data-row-action")){closeMenus();}'
  + '});'
  // T39 [BCL-013]: the panel Close control hides the (re-openable) panel.
  + 'var __panel=getPanel();'
  + 'if(__panel){__panel.addEventListener("click",function(e){if(closestAttr(e.target,"data-panel-close")){closeProgressPanel();}});}'
  + '}());';

export { DOMAINS_ACTIONS_SCRIPT, MODAL_SCRIPT };

export function domainsPage(
  domains: ReadonlyArray<DomainEntry>,
  verticals: ReadonlyArray<VerticalEntry>,
  branding: DomainsBranding = {},
): string {
  var rows = renderRows(domains);
  var options = renderVerticalOptions(verticals);
  var content = renderToolbar() + renderProvisioningPanel() + renderTable(rows) + renderModal(options)
    + renderDeleteSiteModal() + renderStatusModal();
  return adminLayout({
    title: "Domains",
    activePath: "/admin/domains",
    userEmail: branding.userEmail,
    conversionsUiEnabled: branding.conversionsUiEnabled,
    content: content,
    styles: MODAL_STYLES,
    scripts: MODAL_SCRIPT + DOMAINS_ACTIONS_SCRIPT,
  });
}
