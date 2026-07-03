// Listicles Phase 7 — the inline ES5 client runtime (design contract §15.3
// pre-paint selector, §31.2 hash twin, §31.3 sid, §31.4 page_view_id,
// §31.5 impression semantics, §31.6 durable delivery, §22.3 sendBeacon).
//
// Everything here is emitted VERBATIM into the cached per-Version shell
// (static for every visitor — the per-request context arrives separately via
// the post-cache HTMLRewriter injection, see ctx-inject.ts). All sources are
// STRICT ES5 (no const/let/arrow/template-literal/spread) — asserted by
// test/listicles-inline-es5.test.ts (token checks + `node --check`
// byte-parse) exactly like every other inline script in this repo.
//
// SECURITY NOTE on document.write: §15.3's pre-paint selector is SPECIFIED
// as a document.write of a <style> block (the only synchronous pre-paint
// style-injection primitive during head parse). The written payload is built
// EXCLUSIVELY from server-minted candidate public ids (`cand_` ULIDs from
// our own shell boot data — never user/query input), so no untrusted byte
// can reach the write.
//
// Two script bodies:
//   * SELECTOR (head, pre-paint): §15.3 faithfully — resolves the sid
//     (window._LST_SID, client-generated ONLY when absent, §31.3), evaluates
//     every page's selection (single → candidates[0] `single_default`;
//     ab_test → §31.2 hash over sid|ab_test_id `ab_hash`; rule_based →
//     priority-ordered first-match over window.__LST_CTX `rule_match`, else
//     the fallback candidate `fallback`), records window.__LST_CHOSEN
//     [page_index] = {id, rule_id, reason, …beacon dims}, and pre-paints the
//     visibility <style>. It also defines window.__lstMat(pageIndex) — the
//     per-page materializer the shell calls right after each page's markup
//     so a chosen NON-default candidate is stamped out of its inert
//     <template> during parse (before that region ever paints → zero CLS),
//     and over-budget placeholders are re-pointed at the CHOSEN candidate's
//     /lst-cand fragment.
//   * BEACON (end of body): mints window._LST_PVID (§31.4), stamps pv= into
//     every governed /lc anchor, sends page_view on load, page_reach when
//     the LAST page first intersects the viewport, section_impression /
//     offer_impression per §31.5 (IntersectionObserver threshold 0.5, dwell
//     1000ms / 500ms, paused while document.hidden, once per
//     (page_view_id, entity)), all delivered via the §31.6 chain
//     (sendBeacon → keepalive fetch → localStorage retry queue flushed on
//     load/visibilitychange→visible/online with cap ~50 + exponential
//     backoff; event_id UUID per event as the idempotency key).
//
// CSS-cascade note (authored, documented). Three rules interact:
//   1. the shell's STATIC stylesheet hides every candidate with the SCOPED
//      rule `[data-layout] .lst-cand{display:none}` — specificity (0,2,0);
//   2. the selector's document.write emits its own base hide
//      `.lst-cand{display:none}` — UNSCOPED, specificity (0,1,0) (this is
//      §15.3's literal base rule; it is WEAKER than rule 1, so it is inert /
//      harmless — rule 1 already does the hiding);
//   3. the selector's per-chosen show-rules are emitted SCOPED as
//      `[data-layout] .lst-cand[data-cand="…"]{display:block}` —
//      specificity (0,3,0) — so they beat rule 1 (0,2,0) and reveal exactly
//      the chosen candidate. (§15.3's pseudo-code writes the show-rule
//      unscoped as `[data-cand="…"]{display:block}` (0,1,0), which would
//      LOSE to rule 1; scoping it to (0,3,0) is the faithful adaptation.)

// ---------------------------------------------------------------------------
// Shared ES5 helpers (embedded in BOTH scripts; also vm-tested standalone)
// ---------------------------------------------------------------------------

// §31.2 hash twin: byte-parity with src/public/listicle/ab-hash.ts —
// FNV-1a 32-bit over the UTF-8 bytes of `${sid}|${testId}`, bucket 0..9999
// bps. lstUtf8 mirrors TextEncoder semantics exactly (surrogate pairs →
// 4-byte sequences; lone surrogates → U+FFFD), proven by the frozen §31.2
// vectors (6174/3907/1875) + a fuzz parity loop in
// test/listicles-es5-hash-parity.test.ts.
export const LST_ES5_HELPERS = [
  "function lstReadCookie(n){var m=document.cookie.match(new RegExp('(?:^|; )'+n+'=([^;]*)'));return m?decodeURIComponent(m[1]):'';}",
  "function lstGenId(){try{if(window.crypto&&crypto.randomUUID){return crypto.randomUUID();}}catch(e){}",
  "var s='',i,r;for(i=0;i<36;i++){if(i===8||i===13||i===18||i===23){s+='-';}else if(i===14){s+='4';}else{r=Math.floor(Math.random()*16);if(i===19){r=(r&3)|8;}s+=r.toString(16);}}return s;}",
  "function lstUtf8(s){var out=[],i,c,c2;for(i=0;i<s.length;i++){c=s.charCodeAt(i);",
  "if(c>=0xd800&&c<=0xdbff){c2=(i+1<s.length)?s.charCodeAt(i+1):0;if(c2>=0xdc00&&c2<=0xdfff){c=0x10000+((c-0xd800)<<10)+(c2-0xdc00);i++;}else{c=0xfffd;}}",
  "else if(c>=0xdc00&&c<=0xdfff){c=0xfffd;}",
  "if(c<0x80){out.push(c);}else if(c<0x800){out.push(0xc0|(c>>6),0x80|(c&63));}else if(c<0x10000){out.push(0xe0|(c>>12),0x80|((c>>6)&63),0x80|(c&63));}else{out.push(0xf0|(c>>18),0x80|((c>>12)&63),0x80|((c>>6)&63),0x80|(c&63));}}",
  "return out;}",
  "function lstBucket(sid,testId){var bytes=lstUtf8(sid+'|'+testId);var h=0x811c9dc5;for(var i=0;i<bytes.length;i++){h^=bytes[i];h=(h+((h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24)))>>>0;}return h%10000;}",
  "function lstPickArm(bucket,arms){var cum=0,i;for(i=0;i<arms.length;i++){cum+=(arms[i].allocation||0)*100;if(cum>bucket){return i;}}return arms.length-1;}",
  // Client port of listicles/rules.ts evaluation: case-insensitive set
  // membership + half-open [start,end) hour intervals; missing dim = "any".
  "function lstInSet(values,v){if(typeof v!=='string'||v===''){return false;}var n=v.toLowerCase(),i;for(i=0;i<values.length;i++){if(String(values[i]).toLowerCase()===n){return true;}}return false;}",
  "function lstRuleMatches(conds,ctx){conds=conds||{};var sets=conds.sets,k;",
  "if(sets){for(k in sets){if(Object.prototype.hasOwnProperty.call(sets,k)){if(!lstInSet(sets[k],ctx[k])){return false;}}}}",
  "var ranges=conds.ranges,ints=[],j;",
  "if(ranges){if(ranges.hour){ints.push(ranges.hour);}if(ranges.daypart){for(j=0;j<ranges.daypart.length;j++){ints.push(ranges.daypart[j]);}}}",
  "if(ints.length>0){var h=ctx.hour;if(typeof h!=='number'||!isFinite(h)){return false;}var ok=false,m;for(m=0;m<ints.length;m++){if(h>=ints[m][0]&&h<ints[m][1]){ok=true;break;}}if(!ok){return false;}}",
  "return true;}",
].join("");

// ---------------------------------------------------------------------------
// §15.3 pre-paint selector (head)
// ---------------------------------------------------------------------------

const SELECTOR_MAIN = [
  "(function(){",
  "try{",
  // §31.3: use the edge-injected sid; generate ONLY if absent (edge miss),
  // never override an edge-assigned one. §15.3 cookie semantics on generate.
  "var sid=window._LST_SID||lstReadCookie('ko_sid');",
  "if(!sid){sid=lstGenId();try{document.cookie='ko_sid='+sid+';path=/;max-age=1800;SameSite=Lax';}catch(e){}}",
  "window._LST_SID=sid;",
  "var ctx=window.__LST_CTX||{};",
  "var pages=window.__LST_PAGES||[];",
  "window.__LST_CHOSEN=window.__LST_CHOSEN||{};",
  "var css='',i,p,cands,chosen,reason,ruleId;",
  "for(i=0;i<pages.length;i++){",
  "p=pages[i];cands=p.candidates||[];",
  "if(cands.length===0){continue;}",
  "chosen=null;reason='single_default';ruleId='';",
  "if(p.mode==='ab_test'){",
  "chosen=cands[lstPickArm(lstBucket(sid,String(p.ab_test_id||'')),cands)];reason='ab_hash';",
  "}else if(p.mode==='rule_based'){",
  "var ruled=[],fb=null,c,j;",
  "for(j=0;j<cands.length;j++){c=cands[j];if(c.is_fallback){if(!fb){fb=c;}}else if(c.rule){ruled.push(c);}}",
  "ruled.sort(function(a,b){return (a.rule.priority||0)-(b.rule.priority||0);});",
  "for(j=0;j<ruled.length;j++){if(lstRuleMatches(ruled[j].rule.conditions,ctx)){chosen=ruled[j];break;}}",
  "if(chosen){reason='rule_match';ruleId=chosen.rule.id||'';}else{chosen=fb||cands[0];reason='fallback';}",
  "}else{chosen=cands[0];reason='single_default';}",
  // Scoped show-rule (see the cascade note in the module header).
  "css+='[data-layout] .lst-cand[data-cand=\"'+chosen.id+'\"]{display:block}';",
  "window.__LST_CHOSEN[p.page_index]={id:chosen.id,rule_id:ruleId,reason:reason,",
  "section_id:chosen.section_id||'',section_name:chosen.section_name||'',",
  "allocation:(chosen.allocation===0||chosen.allocation)?chosen.allocation:null,",
  "rule_priority:(reason==='rule_match'&&chosen.rule&&(chosen.rule.priority===0||chosen.rule.priority))?chosen.rule.priority:null,",
  "rule_hash:(reason==='rule_match'&&chosen.rule)?(chosen.rule.hash||''):''};",
  "}",
  // §15.3 pre-paint style write (server-minted cand_ ids only — no user
  // input can reach this sink; see the module-header security note).
  "document.write('<style data-lst=\"chosen\">.lst-cand{display:none}'+css+'</style>');",
  // Per-page materializer: called by the shell right after each page's
  // markup parses. A chosen candidate that shipped as an inert <template>
  // is stamped into a live .lst-cand div DURING parse (pre-paint for that
  // region → zero CLS); an over-budget placeholder is re-pointed at the
  // chosen candidate's cached /lst-cand fragment.
  "window.__lstMat=function(idx){",
  "try{",
  "var ch=window.__LST_CHOSEN[idx];if(!ch){return;}",
  "var pageEl=document.querySelector('.lst-page[data-page-index=\"'+idx+'\"]');if(!pageEl){return;}",
  "if(pageEl.querySelector('.lst-cand[data-cand=\"'+ch.id+'\"]')){return;}",
  "var pending=pageEl.querySelector('.lst-cand-pending');",
  "if(pending){pending.setAttribute('data-cand',ch.id);pending.setAttribute('data-lst-lazy','/lst-cand/'+encodeURIComponent(ch.id));if(ch.section_id){pending.setAttribute('data-section',ch.section_id);}return;}",
  "var tpl=pageEl.querySelector('template[data-cand=\"'+ch.id+'\"]');",
  "if(!tpl){return;}",
  "var div=document.createElement('div');div.className='lst-cand';",
  "div.setAttribute('data-cand',ch.id);div.setAttribute('data-section',tpl.getAttribute('data-section')||'');",
  "if(tpl.content){div.appendChild(tpl.content.cloneNode(true));}else{div.innerHTML=tpl.innerHTML;}",
  "tpl.parentNode.insertBefore(div,tpl);",
  "}catch(e){}",
  "};",
  "}catch(e){}",
  "})();",
].join("");

export function listicleSelectorScriptBody(): string {
  return LST_ES5_HELPERS + SELECTOR_MAIN;
}

// ---------------------------------------------------------------------------
// Beacon runtime (end of body)
// ---------------------------------------------------------------------------

const BEACON_MAIN = [
  "(function(){",
  "try{",
  "var EP='/api/lst/track';",
  "var QKEY='lst_evq';var QMAX=50;",
  "var SID=window._LST_SID||lstReadCookie('ko_sid');",
  "if(!SID){SID=lstGenId();try{document.cookie='ko_sid='+SID+';path=/;max-age=1800;SameSite=Lax';}catch(e){}window._LST_SID=SID;}",
  // §31.4: one page_view_id per view, stamped on every event.
  "var PVID=lstGenId();window._LST_PVID=PVID;",
  "var BOOT=window.__LST_BOOT||{};var CTX=window.__LST_CTX||{};var EXP=window.__LST_EXP||{};",
  "var PAGES=window.__LST_PAGES||[];var CHOSEN=window.__LST_CHOSEN||{};",
  // ---- §31.6 durable delivery -------------------------------------------
  "function loadQ(){try{var raw=localStorage.getItem(QKEY);if(!raw){return [];}var q=JSON.parse(raw);return (q&&q.length)?q:[];}catch(e){return [];}}",
  "function saveQ(q){try{if(q.length>QMAX){q=q.slice(q.length-QMAX);}localStorage.setItem(QKEY,JSON.stringify(q));}catch(e){}}",
  "function backoffMs(n){var ms=5000,i;for(i=0;i<n;i++){ms=ms*2;if(ms>=600000){return 600000;}}return ms;}",
  "function tryBeacon(body){if(navigator.sendBeacon){try{var blob=new Blob([body],{type:'application/json'});if(navigator.sendBeacon(EP,blob)){return true;}}catch(e){}}return false;}",
  "function tryFetch(body,onOk,onFail){",
  "if(!window.fetch){onFail();return;}",
  "try{fetch(EP,{method:'POST',headers:{'Content-Type':'application/json'},body:body,keepalive:true}).then(function(res){if(res&&res.ok){onOk();}else{onFail();}},function(){onFail();});}catch(e){onFail();}",
  "}",
  "function enqueue(events){var q=loadQ(),i;for(i=0;i<events.length;i++){q.push({e:events[i],n:0,t:Date.now()+backoffMs(0)});}saveQ(q);setTimeout(flushQ,backoffMs(0)+100);}",
  "var flushing=false;",
  "function removeFromQ(items){var q=loadQ(),keep=[],i,j,found;for(i=0;i<q.length;i++){found=false;for(j=0;j<items.length;j++){if(q[i].e&&items[j].e&&q[i].e.event_id===items[j].e.event_id){found=true;break;}}if(!found){keep.push(q[i]);}}saveQ(keep);}",
  "function bumpInQ(items){var q=loadQ(),i,j;for(i=0;i<q.length;i++){for(j=0;j<items.length;j++){if(q[i].e&&items[j].e&&q[i].e.event_id===items[j].e.event_id){q[i].n=(q[i].n||0)+1;q[i].t=Date.now()+backoffMs(q[i].n);}}}saveQ(q);}",
  "function flushQ(){",
  "if(flushing){return;}",
  "var q=loadQ();if(q.length===0){return;}",
  "var now=Date.now(),due=[],i;",
  "for(i=0;i<q.length;i++){if(q[i].t<=now&&due.length<20){due.push(q[i]);}}",
  "if(due.length===0){return;}",
  "flushing=true;",
  "var events=[],j;for(j=0;j<due.length;j++){events.push(due[j].e);}",
  "var body=JSON.stringify({events:events});",
  "function ok(){removeFromQ(due);flushing=false;}",
  "function fail(){bumpInQ(due);flushing=false;}",
  "if(tryBeacon(body)){ok();return;}",
  "tryFetch(body,ok,fail);",
  "}",
  "window.addEventListener('load',flushQ);",
  "document.addEventListener('visibilitychange',function(){if(!document.hidden){flushQ();}});",
  "window.addEventListener('online',flushQ);",
  // §31.6 send chain for fresh events: sendBeacon -> keepalive fetch -> queue.
  "function lstSend(events){",
  "if(!events||events.length===0){return;}",
  "var body=JSON.stringify({events:events});",
  "if(tryBeacon(body)){return;}",
  "tryFetch(body,function(){},function(){enqueue(events);});",
  "}",
  // ---- §16 event assembly -------------------------------------------------
  "function baseEvent(type){",
  "var e={record_kind:'event',session_id:SID,event_id:lstGenId(),event_type:type,timestamp:Date.now(),received_at:0,",
  "site_id:BOOT.site_id||'',article_id:BOOT.article_id||'',article_name:BOOT.article_name||'',article_url:BOOT.article_url||'',lander_v:BOOT.lander_v||'',",
  "article_version_id:BOOT.lander_v||'',article_version_revision:BOOT.article_version_revision||0,",
  "article_experiment_id:EXP.experiment_id||'',article_variant_id:EXP.variant_id||BOOT.lander_v||'',article_variant_label:EXP.variant_label||'',",
  "article_split_percentage:(EXP.split===0||EXP.split)?EXP.split:null,",
  "page:'',page_index:null,page_selection_mode:'',section_id:'',section_name:'',page_candidate_id:'',ab_test_id:'',ab_split_percentage:null,",
  "page_rule_set_id:'',page_rule_id:'',page_rule_priority:null,selection_reason:'',matched_rule_json_hash:'',",
  "offer_id:'',offer_name:'',click_id:'',",
  "link_instance_id:'',section_block_id:'',link_role:'',link_position_index:null,button_style_id:'',button_group_id:'',anchor_text_hash:'',analytics_label:'',",
  "utm_source:CTX.utm_source||'',utm_medium:CTX.utm_medium||'',utm_content:CTX.utm_content||'',traffic_source:CTX.traffic_source||'',placement:CTX.placement||'',",
  "cpc:CTX.cpc||'',fbc:CTX.fbc||'',fbclid:CTX.fbclid||'',",
  "sub1:CTX.sub1||'',sub2:CTX.sub2||'',sub3:CTX.sub3||'',sub4:CTX.sub4||'',sub5:CTX.sub5||'',",
  "device:CTX.device||'',os:CTX.os||'',os_version:'',browser:CTX.browser||'',browser_version:'',",
  "country:CTX.country||'',state:CTX.state||'',city:CTX.city||'',ip:'',ua:'',",
  "url:location.href,referer:document.referrer,language:CTX.language||'',",
  "page_view_id:PVID,is_bot:false,is_internal:false,is_preview:false,traffic_quality_flag:''};",
  "return e;",
  "}",
  "function findPage(idx){var i;for(i=0;i<PAGES.length;i++){if(PAGES[i].page_index===idx){return PAGES[i];}}return null;}",
  "function stampPageDims(e,idx){",
  "var p=findPage(idx),ch=CHOSEN[idx]||{};",
  "e.page=String(idx);e.page_index=idx;",
  "if(p){e.page_selection_mode=p.mode||'';e.ab_test_id=p.ab_test_id||'';e.page_rule_set_id=p.rule_set_id||'';}",
  "e.page_candidate_id=ch.id||'';e.selection_reason=ch.reason||'';e.page_rule_id=ch.rule_id||'';",
  "e.section_id=ch.section_id||'';e.section_name=ch.section_name||'';",
  "if(ch.reason==='ab_hash'){e.ab_split_percentage=(ch.allocation===0||ch.allocation)?ch.allocation:null;}",
  "if(ch.reason==='rule_match'){e.page_rule_priority=(ch.rule_priority===0||ch.rule_priority)?ch.rule_priority:null;e.matched_rule_json_hash=ch.rule_hash||'';}",
  "return e;",
  "}",
  "function pageIndexOf(el){",
  "var node=el;while(node&&node!==document){if(node.getAttribute&&node.className&&(' '+node.className+' ').indexOf(' lst-page ')>=0){var v=parseInt(node.getAttribute('data-page-index'),10);return isFinite(v)?v:-1;}node=node.parentNode;}return -1;",
  "}",
  // ---- §31.4 dedupe + §31.5 dwell machinery -------------------------------
  "var SENT={};var REG={};var TIMERS={};",
  "function clearTimer(key){if(TIMERS[key]){clearTimeout(TIMERS[key]);delete TIMERS[key];}}",
  "function startTimer(key){",
  "var reg=REG[key];if(!reg||SENT[key]||TIMERS[key]){return;}",
  "TIMERS[key]=setTimeout(function(){delete TIMERS[key];if(SENT[key]||document.hidden){return;}SENT[key]=1;reg.fire(reg.el);},reg.dwell);",
  "}",
  // §31.5 eligibility: >=50% of the element visible. Authored guard
  // (documented): an element TALLER than the viewport can never reach ratio
  // 0.5, so it also counts as eligible while it covers >=50% of the viewport.
  "function eligible(en){",
  "if(!en.isIntersecting){return false;}",
  "if(en.intersectionRatio>=0.5){return true;}",
  "try{var rb=en.rootBounds;if(rb&&rb.height&&en.boundingClientRect.height>rb.height&&en.intersectionRect.height>=rb.height*0.5){return true;}}catch(e){}",
  "return false;",
  "}",
  "function onEntries(entries){",
  "var i,en,key;",
  "for(i=0;i<entries.length;i++){",
  "en=entries[i];key=en.target.getAttribute('data-lst-obs-key');",
  "if(!key||SENT[key]||!REG[key]){continue;}",
  "REG[key].elig=eligible(en);",
  "if(REG[key].elig&&!document.hidden){startTimer(key);}else{clearTimer(key);}",
  "}",
  "}",
  // §31.5: do not count while document.hidden — pause dwell on
  // visibilitychange, resume for still-eligible targets on return.
  "document.addEventListener('visibilitychange',function(){",
  "var k;",
  "if(document.hidden){for(k in TIMERS){if(Object.prototype.hasOwnProperty.call(TIMERS,k)){clearTimer(k);}}}",
  "else{for(k in REG){if(Object.prototype.hasOwnProperty.call(REG,k)){if(REG[k].elig&&!SENT[k]){startTimer(k);}}}}",
  "});",
  "var IO=window.IntersectionObserver?new IntersectionObserver(onEntries,{threshold:[0,0.5]}):null;",
  "function observe(el,key,dwell,fire){",
  "if(!IO||SENT[key]||REG[key]){return;}",
  "el.setAttribute('data-lst-obs-key',key);REG[key]={el:el,dwell:dwell,fire:fire,elig:false};IO.observe(el);",
  "}",
  // ---- event emitters ------------------------------------------------------
  "function sendPageView(){lstSend([baseEvent('page_view')]);}",
  // page_reach (authored definition, documented): fired ONCE per
  // page_view_id when the LAST page of the article first intersects the
  // viewport (threshold 0 — reach is arrival at the end of the article, not
  // attention; attention is section_impression's 50%/1000ms job).
  "function watchPageReach(){",
  "if(!IO){return;}",
  "var pagesEls=document.querySelectorAll('.lst-page');",
  "if(pagesEls.length===0){return;}",
  "var last=pagesEls[pagesEls.length-1];",
  "var ro=new IntersectionObserver(function(entries){",
  "var i;for(i=0;i<entries.length;i++){if(entries[i].isIntersecting&&!SENT['reach']){SENT['reach']=1;",
  "var e=stampPageDims(baseEvent('page_reach'),pageIndexOf(entries[i].target));lstSend([e]);ro.disconnect();}}",
  "},{threshold:0});",
  "ro.observe(last);",
  "}",
  "function fireSection(el){",
  "var idx=pageIndexOf(el);if(idx<0){return;}",
  "var e=stampPageDims(baseEvent('section_impression'),idx);",
  "var sec=el.getAttribute('data-section');if(sec){e.section_id=sec;}",
  "lstSend([e]);",
  "}",
  "function offerIdFromHref(href){var m=(href||'').match(/^\\/lc\\/([^?]+)/);if(!m){return '';}try{return decodeURIComponent(m[1]);}catch(e){return m[1];}}",
  "function fireOffer(a){",
  "var idx=pageIndexOf(a);",
  "var e=stampPageDims(baseEvent('offer_impression'),idx<0?-1:idx);",
  "if(idx<0){e.page='';e.page_index=null;}",
  "e.offer_id=offerIdFromHref(a.getAttribute('href'));",
  "e.link_instance_id=a.getAttribute('data-link-instance')||'';",
  "e.section_block_id=a.getAttribute('data-block-id')||'';",
  "e.link_role=a.getAttribute('data-link-role')||'';",
  "e.button_style_id=a.getAttribute('data-btn-style')||'';",
  "e.analytics_label=a.getAttribute('data-analytics-label')||'';",
  "var node=a,sec='';while(node&&node!==document){if(node.getAttribute&&node.getAttribute('data-section')){sec=node.getAttribute('data-section');break;}node=node.parentNode;}",
  "if(sec){e.section_id=sec;}",
  "lstSend([e]);",
  "}",
  // pv= stamping (§31.9) + observer wiring. Idempotent: re-runnable after
  // lazy hydration inserts new content (data-lst-pv marker + REG dedupe).
  "function scan(){",
  "var anchors=document.querySelectorAll('a[data-offer][href]'),i,a,href;",
  "for(i=0;i<anchors.length;i++){",
  "a=anchors[i];href=a.getAttribute('href')||'';",
  "if(href.indexOf('/lc/')!==0){continue;}",
  "if(a.getAttribute('data-lst-pv')!==PVID){",
  "if(/([?&])pv=[^&]*/.test(href)){href=href.replace(/([?&])pv=[^&]*/,'$1pv='+PVID);}else{href=href+(href.indexOf('?')>=0?'&':'?')+'pv='+PVID;}",
  "a.setAttribute('href',href);a.setAttribute('data-lst-pv',PVID);",
  "}",
  // §31.5/§9.3: every governed anchor observed INDIVIDUALLY; entity =
  // the link instance (falls back to offer+block+ordinal), 50% / 500ms.
  "var okey='off|'+(a.getAttribute('data-link-instance')||offerIdFromHref(href)+'|'+(a.getAttribute('data-block-id')||'')+'|'+i);",
  "observe(a,okey,500,fireOffer);",
  "}",
  // §31.5 sections: the CHOSEN candidate box per page, 50% / 1000ms; once
  // per (page_view_id, entity).
  "var k,ch,el;",
  "for(k in CHOSEN){",
  "if(!Object.prototype.hasOwnProperty.call(CHOSEN,k)){continue;}",
  "ch=CHOSEN[k];if(!ch||!ch.id){continue;}",
  "el=document.querySelector('.lst-page[data-page-index=\"'+k+'\"] .lst-cand[data-cand=\"'+ch.id+'\"]');",
  "if(el){observe(el,'sec|'+(ch.section_id||ch.id),1000,fireSection);}",
  "}",
  "}",
  "window.__lstScan=scan;",
  "sendPageView();",
  "scan();",
  "watchPageReach();",
  "flushQ();",
  "}catch(e){}",
  "})();",
].join("");

export function listicleBeaconScriptBody(): string {
  return LST_ES5_HELPERS + BEACON_MAIN;
}

// ---------------------------------------------------------------------------
// Script-tag assembly for the shell (render.ts)
// ---------------------------------------------------------------------------

// Serialize boot data for inline <script> embedding: JSON with `<` escaped
// (valid JSON AND valid JS) so `</script>`-shaped content can never break
// out of the tag.
export function safeInlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export const SELECTOR_SCRIPT_MARKER = '<script data-lst="selector">';

export function selectorScriptTag(): string {
  return `${SELECTOR_SCRIPT_MARKER}${listicleSelectorScriptBody()}</script>`;
}

export function beaconScriptTag(): string {
  return `<script data-lst="beacon">${listicleBeaconScriptBody()}</script>`;
}
