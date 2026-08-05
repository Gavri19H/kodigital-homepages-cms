// Drives ONE case: typed max=40, then a real pointer drag started at the MIN
// half of the stacked blob (handle centre - 7px). Prints the computed clip so
// the with/without-partition runs are self-labelling.
import { chromium } from "playwright";
const HOST="r2fix.e2e.test",PORT="8901",SLUG="r2fix";
const UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const ZIP='[data-lg-field="p8_addr_zip"] input',MAXB='[data-lg-field="p8n_fromto_band_max"] input.lg-input',MINB='[data-lg-field="p8n_fromto_band_min"] input.lg-input';
const RMIN='[data-lg-field="p8n_fromto_band_min"] input.lg-range-input-dual',RMAX='[data-lg-field="p8n_fromto_band_max"] input.lg-range-input-dual';
const say=l=>console.log(l);
async function poll(p,d,f,n=12,ms=2000){for(let i=1;i<=n;i++){const o=await f();say(`  poll[${d}] ${i}/${n} -> ${o}`);if(o)return true;await p.waitForTimeout(ms);}return false;}
const cont=p=>p.evaluate(()=>{const b=[...document.querySelectorAll("button,[data-lg-continue],.lg-continue")].filter(x=>(x.offsetWidth||x.offsetHeight)&&/continue|next|go|submit|see|get/i.test(x.textContent||""));const t=b[b.length-1];if(!t)return false;t.click();return true;});
async function type(p,s,v){await p.click(s);await p.keyboard.press("End");for(let i=0;i<12;i++)await p.keyboard.press("Backspace");await p.keyboard.type(v,{delay:25});await p.keyboard.press("Tab");}
const want=process.argv[2]; // "clip" | "none"
const br=await chromium.launch({args:[`--host-resolver-rules=MAP ${HOST} 127.0.0.1`]});
const ctx=await br.newContext({userAgent:UA,viewport:{width:1280,height:950}});const p=await ctx.newPage();
const auctions=[];p.on("request",r=>{if(r.url().includes("/lg/auction")){try{auctions.push(JSON.parse(r.postData()??"null"));}catch{auctions.push(r.postData());}}});
try{
 let ok=false;
 for(let attempt=1;attempt<=10&&!ok;attempt++){
  say(`attempt ${attempt}/10 loading funnel (want clip=${want})`);
  await p.goto(`http://${HOST}:${PORT}/lg/${SLUG}?_cb=${Date.now()}-${attempt}`,{waitUntil:"domcontentloaded"});
  if(!await poll(p,"ready",()=>p.evaluate(()=>document.getElementById("lg-funnel-root")?.getAttribute("data-lg-ready")==="1"),6,1500))continue;
  await cont(p);await p.waitForTimeout(700);
  await poll(p,"addr",()=>p.evaluate(s=>!!document.querySelector(s),ZIP),6,1500);
  await p.fill(ZIP,"90210");
  for(let i=0;i<3;i++){await cont(p);await p.waitForTimeout(700);}
  if(!await poll(p,"ft",()=>p.evaluate(s=>{const e=document.querySelector(s);return !!e&&(e.offsetWidth>0||e.offsetHeight>0);},MINB),6,1500))continue;
  const clip=await p.evaluate(()=>getComputedStyle(document.querySelectorAll(".lg-range-from-to input.lg-range-input-dual")[1]).clipPath);
  say(`  served clipPath on the MAX rail = ${clip}`);
  ok = want==="none" ? clip==="none" : clip!=="none";
  if(!ok) say("  wrong sheet still served (wrangler reload pending) — retrying");
 }
 if(!ok)throw new Error(`STOP: server never served the ${want} sheet`);
 await type(p,MAXB,"40");
 const g=await p.evaluate(()=>{const w=document.querySelector(".lg-range-from-to");const r=e=>{const b=e.getBoundingClientRect();return{x:Math.round(b.x*10)/10,w:Math.round(b.width*10)/10,cx:Math.round((b.x+b.width/2)*10)/10,cy:Math.round((b.y+b.height/2)*10)/10};};
  return{hMin:r(w.querySelector(".lg-range-handle-min")),hMax:r(w.querySelector(".lg-range-handle-max")),track:r(w.querySelector(".lg-range-track")),clip:[...w.querySelectorAll("input.lg-range-input-dual")].map(x=>getComputedStyle(x).clipPath)};});
 say(`GEOM ${JSON.stringify(g)}`);
 say(`BEFORE DRAG ${JSON.stringify(await p.evaluate(({a,b,c,d})=>({numMin:document.querySelector(a).value,numMax:document.querySelector(b).value,railMin:document.querySelector(c).value,railMax:document.querySelector(d).value}),{a:MINB,b:MAXB,c:RMIN,d:RMAX}))}`);
 const x=g.hMin.cx-7,to=g.track.x+g.track.w*0.5;
 say(`DRAG down x=${x} (MIN half of the blob at ${g.hMin.cx}) -> up x=${Math.round(to)}`);
 await p.mouse.move(x,g.hMin.cy);await p.mouse.down();
 for(let i=1;i<=10;i++){await p.mouse.move(x+(to-x)*i/10,g.hMin.cy,{steps:1});await p.waitForTimeout(20);}
 await p.mouse.up();await p.waitForTimeout(250);
 say(`AFTER DRAG ${JSON.stringify(await p.evaluate(({a,b,c,d})=>({numMin:document.querySelector(a).value,numMax:document.querySelector(b).value,railMin:document.querySelector(c).value,railMax:document.querySelector(d).value}),{a:MINB,b:MAXB,c:RMIN,d:RMAX}))}`);
 await p.evaluate(()=>document.querySelector('[data-value="acme_insurance"]')?.click());await p.waitForTimeout(400);
 await poll(p,"auction",async()=>{if(auctions.length)return true;await cont(p);await p.waitForTimeout(1200);return auctions.length>0;},8,1500);
 const a=auctions.length&&auctions[auctions.length-1]?.answers?auctions[auctions.length-1].answers:null;
 say(`POST /lg/auction answers: min=${a?JSON.stringify(a["p8n_fromto_band_min"]?.value??"(absent)"):"(none)"} max=${a?JSON.stringify(a["p8n_fromto_band_max"]?.value??"(absent)"):"(none)"}`);
}catch(e){say(`ERROR ${e.message}`);}finally{await ctx.close();await br.close();}
