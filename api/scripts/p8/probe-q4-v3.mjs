import { chromium } from "playwright";
const HOST="r2fix.e2e.test",PORT="8901",SLUG="r2fix";
const UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const ZIP='[data-lg-field="p8_addr_zip"] input', MINB='[data-lg-field="p8n_fromto_band_min"] input.lg-input';
const RMIN='[data-lg-field="p8n_fromto_band_min"] input.lg-range-input-dual', RMAX='[data-lg-field="p8n_fromto_band_max"] input.lg-range-input-dual';
const say=l=>console.log(l);
async function poll(p,d,f,n=10,ms=1500){for(let i=1;i<=n;i++){const o=await f();say(`  poll[${d}] ${i}/${n} -> ${o}`);if(o)return true;await p.waitForTimeout(ms);}return false;}
const cont=p=>p.evaluate(()=>{const b=[...document.querySelectorAll("button,[data-lg-continue],.lg-continue")].filter(x=>(x.offsetWidth||x.offsetHeight)&&/continue|next|go|submit|see|get/i.test(x.textContent||""));const t=b[b.length-1];if(!t)return false;t.click();return true;});
async function drive(p){const u=`${Date.now()}-${Math.random().toString(36).slice(2)}`;await p.goto(`http://${HOST}:${PORT}/lg/${SLUG}?_cb=${u}`,{waitUntil:"domcontentloaded"});
 if(!await poll(p,"ready",()=>p.evaluate(()=>document.getElementById("lg-funnel-root")?.getAttribute("data-lg-ready")==="1")))throw new Error("not ready");
 await cont(p);await p.waitForTimeout(700);await poll(p,"addr",()=>p.evaluate(s=>!!document.querySelector(s),ZIP),8);await p.fill(ZIP,"90210");
 for(let i=0;i<3;i++){await cont(p);await p.waitForTimeout(700);}
 await poll(p,"ft",()=>p.evaluate(s=>{const e=document.querySelector(s);return !!e&&(e.offsetWidth>0||e.offsetHeight>0);},MINB),8);
 await p.evaluate(()=>document.querySelector(".lg-range-from-to").scrollIntoView({block:"center"}));await p.waitForTimeout(300);}
const geom=p=>p.evaluate(()=>{const w=document.querySelector(".lg-range-from-to");const r=e=>{const b=e.getBoundingClientRect();return{x:Math.round(b.x*10)/10,w:Math.round(b.width*10)/10,cx:Math.round((b.x+b.width/2)*10)/10,cy:Math.round((b.y+b.height/2)*10)/10};};
 return{track:r(w.querySelector(".lg-range-track")),hMin:r(w.querySelector(".lg-range-handle-min")),hMax:r(w.querySelector(".lg-range-handle-max")),clip:[...w.querySelectorAll("input.lg-range-input-dual")].map(x=>getComputedStyle(x).clipPath)};});
const st=p=>p.evaluate(({a,b})=>({railMin:document.querySelector(a).value,railMax:document.querySelector(b).value}),{a:RMIN,b:RMAX});
async function drag(p,x,y,to){await p.mouse.move(x,y);await p.mouse.down();for(let i=1;i<=10;i++){await p.mouse.move(x+(to-x)*i/10,y,{steps:1});await p.waitForTimeout(20);}await p.mouse.up();await p.waitForTimeout(200);}
const br=await chromium.launch({args:[`--host-resolver-rules=MAP ${HOST} 127.0.0.1`]});
try{
 for(const c of [{n:"AT-REST drag MAX handle (100%) -> 30%",h:"hMax",f:0.3},{n:"AT-REST drag MIN handle (0%) -> 20%",h:"hMin",f:0.2}]){
  say(`\n=== ${c.n} ===`);const ctx=await br.newContext({userAgent:UA,viewport:{width:1280,height:950}});const p=await ctx.newPage();
  try{await drive(p);const g=await geom(p);say(`GEOM ${JSON.stringify(g)}`);say(`BEFORE ${JSON.stringify(await st(p))}`);
   const h=g[c.h],to=g.track.x+g.track.w*c.f;say(`DRAG down ${h.cx},${h.cy} -> ${Math.round(to)}`);await drag(p,h.cx,h.cy,to);
   say(`AFTER ${JSON.stringify(await st(p))}`);
   const fo=await p.evaluate(({a,b})=>{const m=document.querySelector(a),x=document.querySelector(b);m.focus();const om=getComputedStyle(m).outline;x.focus();const ox=getComputedStyle(x).outline;return{minOutline:om,maxOutline:ox};},{a:RMIN,b:RMAX});
   say(`FOCUS OUTLINE ${JSON.stringify(fo)}`);
  }catch(e){say(`ERROR ${e.message}`);}finally{await ctx.close();}}
}finally{await br.close();}
