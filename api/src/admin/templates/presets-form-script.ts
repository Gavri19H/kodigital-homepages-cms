// T8: client assets for the rebuilt 2-column preset form (split out of
// presets.ts to keep that file render-only). PRESET_FORM_STYLES scopes the
// new grid + Custom Variables / Output Rules / Preview / Test sections;
// PRESET_FORM_SCRIPT is the ES5-only inline behaviour the form embeds via the
// adminLayout `scripts` slot.
//
// The serialized payload the submit handler POSTs/PUTs now carries the full
// reference contract: variables_schema (Custom Variables key/desc/default/
// required), output_rules (paragraph-type/min/max/style/JSON-schema) and the
// expanded content_mapping (the reference fields + paragraph_count). The Test
// Preset button interpolates the User Prompt with the Preview Variables and
// POSTs /api/admin/ai/chat for a sample generation — it asserts a real
// request, never closing silently.
//
// ES5-only (var/function/promise chains — no const/let/arrow/template literals
// /optional chaining). Regex is double-escaped. DOM is built with
// createElement + textContent (never the inner-HTML property) so the security
// reminder hook stays green.

// Scoped styles injected via the layout `styles` slot (the shared admin
// stylesheet is untouched). The 2-column grid collapses to one column on
// narrow viewports; full-width sections opt in with .span-2.
export const PRESET_FORM_STYLES = `
.required{color:var(--c-error)}
.preset-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px 24px}
.preset-form-grid .span-2{grid-column:1 / -1}
@media (max-width:860px){.preset-form-grid{grid-template-columns:1fr}}
.var-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:4px}
.var-chip{font-family:monospace;font-size:12px;padding:4px 10px;border:1px solid var(--c-border);border-radius:9999px;background:var(--c-bg-alt);color:var(--c-primary);cursor:pointer}
.var-chip:hover{background:var(--c-primary-light)}
.var-chip:disabled{opacity:.5;cursor:not-allowed}
.detected-vars{font-family:monospace;color:var(--c-text)}
.content-map{display:flex;flex-wrap:wrap;gap:12px}
.cmap-item{display:flex;align-items:center;gap:6px;font-weight:400}
.image-options{display:flex;flex-direction:column;gap:12px}
.img-opt{display:flex;flex-direction:column;gap:6px}
.img-opt-toggle{display:flex;align-items:center;gap:6px;font-weight:400}
.img-opt-prompt[hidden]{display:none}
.cv-list{display:flex;flex-direction:column;gap:10px}
.cv-row{display:grid;grid-template-columns:1fr 1.4fr 1fr auto auto;gap:8px;align-items:center}
.cv-row input[type=text]{width:100%}
.cv-required{display:flex;align-items:center;gap:4px;font-size:12px;white-space:nowrap}
.cv-remove{background:none;border:1px solid var(--c-border);border-radius:6px;cursor:pointer;padding:4px 8px}
.output-rules-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.output-rules-grid .or-wide{grid-column:1 / -1}
.preview-vars{display:flex;flex-direction:column;gap:8px}
.pv-row{display:grid;grid-template-columns:160px 1fr;gap:8px;align-items:center}
.pv-row label{font-family:monospace;font-size:12px}
.test-output{white-space:pre-wrap;background:var(--c-bg-alt);border:1px solid var(--c-border);border-radius:6px;padding:10px;min-height:48px}
.test-output[hidden]{display:none}
`;

// ES5-only inline submit + interaction script. New mode (empty data-preset-id)
// POSTs /api/admin/ai/presets; edit mode PUTs /api/admin/ai/presets/:id. The
// payload carries name/slug/description/category, the split system/user
// prompt, the detected `variables` list, the structured `variables_schema`
// (Custom Variables), `output_rules` and the expanded `content_mapping`.
export const PRESET_FORM_SCRIPT = `(function(){
var form=document.getElementById("preset-form");
if(!form){return;}
var errorEl=document.getElementById("preset-form-error");
function setError(msg){if(errorEl){errorEl.hidden=!msg;errorEl.textContent=msg||"";}}
function fieldValue(id){var el=document.getElementById(id);return el?el.value:"";}
function clearChildren(node){if(!node){return;}while(node.firstChild){node.removeChild(node.firstChild);}}
var nameEl=document.getElementById("preset-name");
var slugEl=document.getElementById("preset-slug");
if(nameEl&&slugEl){
nameEl.addEventListener("input",function(){
if(slugEl.getAttribute("data-touched")==="1"){return;}
if(window.generateSlug){slugEl.value=window.generateSlug(nameEl.value);}
});
slugEl.addEventListener("input",function(){slugEl.setAttribute("data-touched","1");});
}
var lastPrompt=document.getElementById("preset-user-prompt");
function detectVarList(){
var text=fieldValue("preset-system-prompt")+" "+fieldValue("preset-user-prompt");
var matches=text.match(/\\{\\{\\s*[\\w.-]+\\s*\\}\\}/g)||[];
var found=[];var k;
for(k=0;k<matches.length;k++){
var varName=matches[k].replace(/[{}\\s]/g,"");
if(varName&&found.indexOf(varName)<0){found.push(varName);}
}
return found;
}
function declaredVarKeys(){
var keys=[];var rows=form.querySelectorAll(".cv-key");var i;
for(i=0;i<rows.length;i++){
var v=(rows[i].value||"").replace(/[{}\\s]/g,"");
if(v&&keys.indexOf(v)<0){keys.push(v);}
}
var detected=detectVarList();var j;
for(j=0;j<detected.length;j++){if(keys.indexOf(detected[j])<0){keys.push(detected[j]);}}
return keys;
}
function refreshDetected(){
var el=document.getElementById("preset-detected-vars");
if(el){var list=detectVarList();el.textContent=list.length?list.join(", "):"none";}
rebuildPreviewVars();
}
function rebuildPreviewVars(){
var box=document.getElementById("preset-preview-variables");
if(!box){return;}
var prior={};var existing=box.querySelectorAll("[data-pv-key]");var e;
for(e=0;e<existing.length;e++){prior[existing[e].getAttribute("data-pv-key")]=existing[e].value;}
clearChildren(box);
var keys=declaredVarKeys();var i;
if(!keys.length){
var note=document.createElement("p");
note.className="form-help";
note.textContent="Declare a custom variable or use a {{token}} in a prompt to preview it.";
box.appendChild(note);
return;
}
for(i=0;i<keys.length;i++){
var key=keys[i];
var row=document.createElement("div");row.className="pv-row";
var lab=document.createElement("label");lab.textContent="{{"+key+"}}";
var inp=document.createElement("input");
inp.type="text";inp.className="form-input";
inp.setAttribute("data-pv-key",key);
inp.placeholder="sample value";
if(Object.prototype.hasOwnProperty.call(prior,key)){inp.value=prior[key];}
row.appendChild(lab);row.appendChild(inp);box.appendChild(row);
}
}
function collectPreviewVars(){
var out={};var inputs=form.querySelectorAll("[data-pv-key]");var i;
for(i=0;i<inputs.length;i++){var k=inputs[i].getAttribute("data-pv-key");if(k){out[k]=inputs[i].value;}}
return out;
}
var prompts=form.querySelectorAll("[data-prompt-field]");
var pi;
for(pi=0;pi<prompts.length;pi++){
(function(t){
t.addEventListener("focus",function(){lastPrompt=t;});
t.addEventListener("input",refreshDetected);
}(prompts[pi]));
}
var chips=form.querySelectorAll(".var-chip");
var ci;
for(ci=0;ci<chips.length;ci++){
chips[ci].addEventListener("click",function(e){
var chip=e.currentTarget;
var token="{{"+(chip.getAttribute("data-var")||"")+"}}";
if(lastPrompt){
var start=lastPrompt.selectionStart;
if(typeof start==="number"){
var v=lastPrompt.value;
lastPrompt.value=v.slice(0,start)+token+v.slice(lastPrompt.selectionEnd);
lastPrompt.selectionStart=lastPrompt.selectionEnd=start+token.length;
}else{lastPrompt.value=lastPrompt.value+token;}
lastPrompt.focus();
}
refreshDetected();
});
}
function wireCustomVariables(){
var list=document.getElementById("preset-variables-schema");
var addBtn=document.getElementById("preset-add-variable");
if(!list){return;}
list.addEventListener("click",function(e){
var t=e.target;
if(t&&t.className&&t.className.indexOf("cv-remove")>=0){
var row=t;
while(row&&!(row.className&&row.className.indexOf("cv-row")>=0)){row=row.parentNode;}
if(row&&row.parentNode){row.parentNode.removeChild(row);rebuildPreviewVars();}
}
});
list.addEventListener("input",function(){rebuildPreviewVars();});
if(addBtn){addBtn.addEventListener("click",function(){
var rows=list.querySelectorAll(".cv-row");
if(!rows.length){return;}
var clone=rows[0].cloneNode(true);
var ins=clone.querySelectorAll("input");var i;
for(i=0;i<ins.length;i++){if(ins[i].type==="checkbox"){ins[i].checked=false;}else{ins[i].value="";}}
list.appendChild(clone);
});}
}
function collectVariablesSchema(){
var rows=form.querySelectorAll(".cv-row");var out=[];var i;
for(i=0;i<rows.length;i++){
var keyEl=rows[i].querySelector(".cv-key");
var key=keyEl?(keyEl.value||"").replace(/^\\s+|\\s+$/g,""):"";
if(!key){continue;}
var descEl=rows[i].querySelector(".cv-desc");
var defEl=rows[i].querySelector(".cv-default");
var reqEl=rows[i].querySelector(".cv-required-input");
out.push({key:key,description:descEl?descEl.value:"","default":defEl?defEl.value:"",required:reqEl?!!reqEl.checked:false});
}
return JSON.stringify(out);
}
function numOrNull(v){var n=parseInt(v,10);return(isFinite(n)&&v!=="")?n:null;}
function collectOutputRules(){
var pt=fieldValue("or-paragraph-type");
var mn=fieldValue("or-min");
var mx=fieldValue("or-max");
var st=fieldValue("or-style");
var js=fieldValue("or-json-schema");
if(!pt&&!mn&&!mx&&!st&&!js){return"[]";}
return JSON.stringify([{paragraph_type:pt||null,min:numOrNull(mn),max:numOrNull(mx),style:st||null,json_schema:js||null}]);
}
function collectContentMap(){
var boxes=form.querySelectorAll(".cmap-field");
var map={};var any=false;var bi;
for(bi=0;bi<boxes.length;bi++){
var f=boxes[bi].getAttribute("data-field");
if(f){map[f]=boxes[bi].checked?true:false;if(boxes[bi].checked){any=true;}}
}
var pc=document.getElementById("cmap-paragraph_count");
if(pc){var pcv=numOrNull(pc.value);if(pcv!==null){map.paragraph_count=pcv;any=true;}}
var imgBoxes=form.querySelectorAll(".img-opt-field");
var imgMap={};var imgAny=false;var ib;
for(ib=0;ib<imgBoxes.length;ib++){
var key=imgBoxes[ib].getAttribute("data-image");
if(key&&imgBoxes[ib].checked){
var ta=form.querySelector('[data-image-prompt="'+key+'"]');
imgMap[key]=ta?ta.value:"";
imgAny=true;
}
}
if(imgAny){map.image_prompts=imgMap;any=true;}
return any?JSON.stringify(map):null;
}
function wireImageOptions(){
var imgBoxes=form.querySelectorAll(".img-opt-field");
var ii;
for(ii=0;ii<imgBoxes.length;ii++){
(function(box){
function sync(){
var key=box.getAttribute("data-image");
var ta=form.querySelector('[data-image-prompt="'+key+'"]');
if(ta){ta.hidden=!box.checked;}
}
box.addEventListener("change",sync);
sync();
}(imgBoxes[ii]));
}
}
function collectVariables(){
var list=detectVarList();
return list.length?JSON.stringify(list):null;
}
function interpolate(tpl,vars){
return tpl.replace(/\\{\\{\\s*([\\w.-]+)\\s*\\}\\}/g,function(whole,key){
var val=vars[key];
return(typeof val==="string"&&val.length>0)?val:whole;
});
}
function wireTestPreset(){
var btn=document.getElementById("preset-test-run");
var outEl=document.getElementById("preset-test-output");
if(!btn){return;}
btn.addEventListener("click",function(){
var vars=collectPreviewVars();
var rawPrompt=fieldValue("preset-user-prompt")||fieldValue("preset-system-prompt");
var prompt=interpolate(rawPrompt,vars);
if(!prompt){if(outEl){outEl.hidden=false;outEl.textContent="Add a User Prompt before testing.";}return;}
var presetId=form.getAttribute("data-preset-id")||"";
var payload={prompt:prompt,variables:vars,options:{}};
if(presetId){payload.presetId=presetId;}
btn.disabled=true;
if(outEl){outEl.hidden=false;outEl.textContent="Generating sample…";}
fetch("/api/admin/ai/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),credentials:"same-origin"})
.then(function(r){return r.json().then(function(j){return{ok:r.ok,status:r.status,body:j};},function(){return{ok:r.ok,status:r.status,body:null};});})
.then(function(res){
btn.disabled=false;
if(!outEl){return;}
if(res.ok&&res.body&&typeof res.body.text==="string"){outEl.textContent=res.body.text;}
else{outEl.textContent=(res.body&&res.body.error)||("Error: "+res.status);}
})
.catch(function(){btn.disabled=false;if(outEl){outEl.textContent="Network error";}});
});
}
wireImageOptions();
wireCustomVariables();
wireTestPreset();
refreshDetected();
form.addEventListener("submit",function(e){
e.preventDefault();
setError("");
var presetId=form.getAttribute("data-preset-id")||"";
var isEdit=presetId!=="";
var activeEl=document.getElementById("preset-is-active");
var body={name:fieldValue("preset-name")||null,slug:fieldValue("preset-slug"),description:fieldValue("preset-description")||null,category:fieldValue("preset-category")||null,system_prompt_template:fieldValue("preset-system-prompt")||null,user_prompt_template:fieldValue("preset-user-prompt")||null,variables:collectVariables(),variables_schema:collectVariablesSchema(),output_rules:collectOutputRules(),content_mapping:collectContentMap(),text_model:fieldValue("preset-text-model"),image_model:fieldValue("preset-image-model"),is_active:(activeEl&&activeEl.checked)?1:0};
var url=isEdit?"/api/admin/ai/presets/"+encodeURIComponent(presetId):"/api/admin/ai/presets";
var method=isEdit?"PUT":"POST";
var submit=form.querySelector("button[type=submit]");
if(submit){submit.disabled=true;}
fetch(url,{method:method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body),credentials:"same-origin"})
.then(function(r){return r.json().then(function(j){return{ok:r.ok,status:r.status,body:j};},function(){return{ok:r.ok,status:r.status,body:null};});})
.then(function(res){
if(submit){submit.disabled=false;}
if(res.ok){window.location.href="/admin/presets";}
else{setError((res.body&&res.body.error)||("Error: "+res.status));}
})
.catch(function(){if(submit){submit.disabled=false;}setError("Network error");});
});
var del=document.getElementById("preset-delete");
if(del){del.addEventListener("click",function(){
var presetId=form.getAttribute("data-preset-id")||"";
if(!presetId){return;}
if(!window.confirm("Delete this preset?")){return;}
setError("");
del.disabled=true;
fetch("/api/admin/ai/presets/"+encodeURIComponent(presetId),{method:"DELETE",credentials:"same-origin"})
.then(function(r){
if(r.ok){window.location.href="/admin/presets";return;}
del.disabled=false;
return r.json().then(function(j){setError((j&&j.error)||("Error: "+r.status));},function(){setError("Error: "+r.status);});
})
.catch(function(){del.disabled=false;setError("Network error");});
});}
}());`;
