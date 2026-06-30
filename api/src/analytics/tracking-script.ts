// Inline first-party analytics tracking script, injected into the human page
// HTML by renderLayout (just before </body>). It is intentionally framework-
// free and ES5-safe so it runs everywhere without a build step.
//
// What it does:
//   - resolves a 30-minute session id (cookie `ko_sid`), generating one when
//     absent (crypto.randomUUID with a fallback).
//   - koTrack(ev, extra): fires-and-forgets a beacon to POST /api/track with
//     {session_id, url, referer, event, ...extra} via navigator.sendBeacon,
//     falling back to fetch(keepalive:true).
//   - sends a `page_view` on load.
//   - listens for GPT `impressionViewable` and sends `impression` (advertiser
//     = the slot's advertiserId if exposed, else 'adx').
//   - delegated click listener fires `click` on `a[href]` / `.gpt-slot` clicks.
//
// IMPORTANT: this is a plain string (no template-literal backticks) so it
// embeds verbatim into the page without any interpolation hazard. It is wrapped
// in its own <script> tag and an IIFE so it never leaks globals (beyond the
// googletag bootstrap, which is the GPT-standard global).
const SCRIPT_BODY = [
  "(function(){",
  "try{",
  // --- session id (cookie ko_sid, 30-min window) ---
  "function readCookie(name){",
  "var m=document.cookie.match(new RegExp('(?:^|; )'+name+'=([^;]*)'));",
  "return m?decodeURIComponent(m[1]):'';",
  "}",
  "function genId(){",
  "try{if(window.crypto&&crypto.randomUUID){return crypto.randomUUID();}}catch(e){}",
  "return 'ko-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);",
  "}",
  "var sid=readCookie('ko_sid');",
  "if(!sid){",
  "sid=genId();",
  "try{document.cookie='ko_sid='+sid+';path=/;max-age=1800;SameSite=Lax';}catch(e){}",
  "}",
  // --- beacon ---
  "function koTrack(ev,extra){",
  "try{",
  "var payload={session_id:sid,url:location.href,referer:document.referrer,event:ev};",
  "if(extra){for(var k in extra){if(Object.prototype.hasOwnProperty.call(extra,k)){payload[k]=extra[k];}}}",
  "var body=JSON.stringify(payload);",
  "if(navigator.sendBeacon){",
  "try{var blob=new Blob([body],{type:'application/json'});if(navigator.sendBeacon('/api/track',blob)){return;}}catch(e){}",
  "}",
  "if(window.fetch){fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:body,keepalive:true}).catch(function(){});}",
  "}catch(e){}",
  "}",
  "window.koTrack=koTrack;",
  // --- page_view on load ---
  "koTrack('page_view');",
  // --- GPT impressions (AdX today; easy to extend for prebid later) ---
  "window.googletag=window.googletag||{cmd:[]};",
  "googletag.cmd.push(function(){",
  "try{",
  "googletag.pubads().addEventListener('impressionViewable',function(e){",
  "var advertiser='adx';",
  "try{if(e&&e.advertiserId){advertiser=String(e.advertiserId);}}catch(err){}",
  "koTrack('impression',{advertiser:advertiser});",
  "});",
  "}catch(err){}",
  "});",
  // --- delegated clicks on links / ad slots (no PII captured) ---
  "document.addEventListener('click',function(e){",
  "try{",
  "var t=e.target;",
  "while(t&&t!==document){",
  "if(t.tagName==='A'&&t.getAttribute('href')){koTrack('click');return;}",
  "if(t.classList&&t.classList.contains('gpt-slot')){koTrack('click');return;}",
  "t=t.parentNode;",
  "}",
  "}catch(err){}",
  "},true);",
  "}catch(e){}",
  "})();",
].join("");

export const ANALYTICS_TRACKING_SCRIPT: string = "<script>" + SCRIPT_BODY + "</script>";
