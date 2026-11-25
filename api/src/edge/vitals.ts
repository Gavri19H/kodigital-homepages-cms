import type { Env } from "../env";
import { isAdminHost } from "../site/site-context";
import type { WaitUntilContext } from "../wait-until-context";

// Static browser code shared by the public renderers. Strip indentation once per
// isolate. All timings are relative to navigation (or activation for prerenders).
// CLS uses the largest shift session. INP groups event durations by interaction
// and discards one slow interaction per 50 interactions before taking the worst.
export const VITALS_BEACON = `<script data-vitals>(()=>{
  if(Math.random()>=.2||!globalThis.navigator?.sendBeacon||!globalThis.performance)return;
  const m={page_type:document.documentElement.dataset.pt},flush=[],times=new Map();
  const foreground=document.visibilityState!=="hidden"||document.prerendering;
  let sent=false,start,last,score=0,lcp,low=Infinity,high=0;
  function observe(type,visit,opts={}){
    try{
      if(!PerformanceObserver.supportedEntryTypes.includes(type))return;
      const o=new PerformanceObserver(list=>list.getEntries().forEach(visit));
      o.observe({type,buffered:true,...opts});
      flush.push(()=>{o.takeRecords().forEach(visit);o.disconnect()});
      return true;
    }catch{}
  }
  observe("largest-contentful-paint",e=>{lcp=e.startTime});
  if(observe("layout-shift",e=>{
    if(e.hadRecentInput)return;
    const t=e.startTime;
    if(!score||t-last>=1000||t-start>=5000){start=t;score=0}
    last=t;score+=e.value;m.cls=Math.min(5,Math.max(m.cls,score));
  }))m.cls=0;
  function interaction(e){
    const id=e.interactionId;
    if(id){low=Math.min(low,id);high=Math.max(high,id);times.set(id,Math.max(times.get(id)||0,e.duration))}
  }
  observe("event",interaction,{durationThreshold:16});observe("first-input",interaction);
  function send(){
    if(sent)return;
    sent=true;flush.forEach(read=>read());
    const nav=performance.getEntriesByType("navigation")[0],base=nav?.activationStart||0;
    const paint=performance.getEntriesByName("first-contentful-paint","paint")[0];
    function ms(key,value){if(Number.isFinite(value))m[key]=Math.min(60000,Math.max(0,value))}
    ms("ttfb_ms",nav?.responseStart-base);
    if(foreground){ms("fcp_ms",paint?.startTime-base);ms("lcp_ms",lcp-base)}
    if(times.size){
      const count=performance.interactionCount||1+(high-low)/7;
      ms("inp_ms",[...times.values()].sort((a,b)=>b-a)[Math.min(times.size-1,Math.floor(count/50))]);
    }
    if(Object.keys(m).length>1)navigator.sendBeacon(location.origin+"/v/vitals",new Blob([JSON.stringify(m)],{type:"application/json"}));
  }
  addEventListener("pagehide",send);
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")send()});
})()</script>`.replace(/\n\s*/g, "");

const pageTypes = new Set(["home", "article", "category", "tag", "page", "listicle", "quote", "other"]);
const metrics = ["ttfb_ms", "fcp_ms", "lcp_ms", "inp_ms", "cls"] as const;
type Metric = typeof metrics[number];
type Sample = { page_type: string } & Partial<Record<Metric, number | null>>;
const maxBodyBytes = 1024;

function validSample(value: unknown): value is Sample {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const sample = value as Record<string, unknown>;
  if (typeof sample.page_type !== "string" || !pageTypes.has(sample.page_type)) return false;
  let measured = false;
  for (const key of metrics) {
    const n = sample[key];
    if (n == null) continue;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > (key === "cls" ? 5 : 60_000)) return false;
    measured = true;
  }
  return measured;
}

async function readSample(request: Request): Promise<Sample | 400 | 413> {
  if (Number(request.headers.get("Content-Length")) > maxBodyBytes) return 413;
  if (!request.body) return 400;
  const reader = request.body.getReader();
  const bytes = new Uint8Array(maxBodyBytes);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > maxBodyBytes - size) {
        void reader.cancel().catch(() => {});
        return 413;
      }
      bytes.set(value, size);
      size += value.byteLength;
    }
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes.subarray(0, size)));
    return validSample(parsed) ? parsed : 400;
  } catch {
    return 400;
  } finally {
    reader.releaseLock();
  }
}

export async function handleVitals(
  request: Request, env: Env, ctx: WaitUntilContext | undefined, resolveSiteId: (url: URL) => Promise<string | null>,
): Promise<Response> {
  const url = new URL(request.url);
  const headers = { "Cache-Control": "no-store" };
  if (isAdminHost(url.hostname, env)) return new Response(null, { status: 404, headers });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } });
  const sample = await readSample(request);
  if (typeof sample === "number") return new Response(null, { status: sample, headers });

  let siteId: string | null;
  try {
    siteId = await resolveSiteId(url);
  } catch {
    return new Response(null, { status: 503, headers });
  }
  if (!siteId) return new Response(null, { status: 404, headers });
  const country = request.cf?.country;
  const insert = env.DB.prepare(`INSERT INTO vitals_samples
    (created_at, site_id, page_type, country, ttfb_ms, fcp_ms, lcp_ms, inp_ms, cls, worker_version)
    VALUES (unixepoch(), ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(siteId, sample.page_type, typeof country === "string" ? country : null,
      ...metrics.map(key => sample[key] ?? null), env.CF_VERSION_METADATA?.id ?? null).run();
  if (ctx) ctx.waitUntil(insert);
  else await insert;
  return new Response(null, { status: 204, headers });
}
