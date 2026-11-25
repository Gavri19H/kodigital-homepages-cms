import { convertIPv6ToBinary, distinctRemoteAddr } from "hono/utils/ipaddr";
import type { Env } from "../env";
import { sha256Hex } from "../leadgen/meta-hash";
import { isAdminHost } from "../site/site-context";
import type { WaitUntilContext } from "../wait-until-context";

// Static browser code shared by the public renderers. Strip indentation once per
// isolate. All timings are relative to navigation (or activation for prerenders).
// CLS uses the largest shift session. INP groups event durations by interaction
// and discards one slow interaction per 50 interactions before taking the worst.
export const VITALS_BEACON = `<script data-vitals>(()=>{
  if(Math.random()>=.2||!globalThis.navigator?.sendBeacon||!globalThis.performance)return;
  const d=document,p=performance,{min,max}=Math;
  const m={page_type:d.documentElement.dataset.pt},flush=[],times=new Map();
  const visible=d.visibilityState!=="hidden"||d.prerendering;
  let sent=false,start,last,score=0,lcp,low=Infinity,high=0;
  function watch(type,visit,opts={}){
    try{
      if(!PerformanceObserver.supportedEntryTypes.includes(type))return;
      const o=new PerformanceObserver(list=>list.getEntries().forEach(visit));
      o.observe({type,buffered:true,...opts});
      flush.push(()=>{o.takeRecords().forEach(visit);o.disconnect()});
      return true;
    }catch{}
  }
  watch("largest-contentful-paint",e=>{lcp=e.startTime});
  if(watch("layout-shift",e=>{
    if(e.hadRecentInput)return;
    const t=e.startTime;
    if(!score||t-last>=1000||t-start>=5000){start=t;score=0}
    last=t;score+=e.value;m.cls=min(5,max(m.cls,score));
  }))m.cls=0;
  function track(e){
    const id=e.interactionId;
    if(id){low=min(low,id);high=max(high,id);times.set(id,max(times.get(id)||0,e.duration))}
  }
  watch("event",track,{durationThreshold:16});watch("first-input",track);
  function send(){
    if(sent)return;
    sent=true;flush.forEach(read=>read());
    const nav=p.getEntriesByType("navigation")[0],base=nav?.activationStart||0;
    const paint=p.getEntriesByName("first-contentful-paint","paint")[0];
    function ms(key,n){if(Number.isFinite(n))m[key]=min(60000,max(0,n))}
    ms("ttfb_ms",nav?.responseStart-base);
    if(visible){ms("fcp_ms",paint?.startTime-base);ms("lcp_ms",lcp-base)}
    if(times.size){
      const count=p.interactionCount||1+(high-low)/7;
      ms("inp_ms",[...times.values()].sort((a,b)=>b-a)[min(times.size-1,Math.floor(count/50))]);
    }
    if(Object.keys(m).length<2)return;
    const edge=nav?.transferSize>0&&nav.serverTiming?.find(t=>t.name==="edge")?.description;
    if(edge==="HIT"||edge==="MISS")m.edge=edge;
    navigator.sendBeacon(location.origin+"/v/vitals",new Blob([JSON.stringify(m)],{type:"application/json"}));
  }
  addEventListener("pagehide",send);
  d.addEventListener("visibilitychange",()=>{if(d.visibilityState==="hidden")send()});
})()</script>`.replace(/\n\s*/g, "");

const pageTypes = new Set(["home", "article", "category", "tag", "page", "listicle", "quote", "other"]);
const metrics = ["ttfb_ms", "fcp_ms", "lcp_ms", "inp_ms", "cls"] as const;
type Metric = typeof metrics[number];
type Sample = { page_type: string; edge?: "HIT" | "MISS" } & Partial<Record<Metric, number | null>>;
const maxBodyBytes = 1024;

function validSample(value: unknown): value is Sample {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const sample = value as Record<string, unknown>;
  if (typeof sample.page_type !== "string" || !pageTypes.has(sample.page_type)) return false;
  if (sample.edge !== undefined && sample.edge !== "HIT" && sample.edge !== "MISS") return false;
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

function deviceFromHeaders(headers: Headers): "mobile" | "tablet" | "desktop" {
  if (headers.get("Sec-CH-UA-Mobile") === "?1") return "mobile";
  const ua = headers.get("User-Agent") ?? "";
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  return /Mobi|Android|iPhone|iPod/i.test(ua) ? "mobile" : "desktop";
}

function sourceFromIp(ip: string | null): string {
  if (!ip) return "unknown";
  if (distinctRemoteAddr(ip) === "IPv4") return ip;
  try {
    const prefix = (convertIPv6ToBinary(ip) >> 64n).toString(16).padStart(16, "0");
    return prefix.match(/.{4}/g)!.join(":");
  } catch {
    return "unknown";
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

  const source = sourceFromIp(request.headers.get("CF-Connecting-IP"));
  if (env.VITALS_RATE_LIMITER) {
    try {
      const { success } = await env.VITALS_RATE_LIMITER.limit({ key: source });
      if (!success) return new Response(null, { status: 429, headers });
    } catch {
      console.error("[vitals] rate limiter failed");
    }
  }

  const country = request.cf?.country;
  const device = deviceFromHeaders(request.headers);
  const utcDate = new Date().toISOString().slice(0, 10);
  // A browser-cached navigation can report zero without measuring network TTFB.
  if (sample.ttfb_ms != null && sample.ttfb_ms <= 0) sample.ttfb_ms = null;
  const insert = sha256Hex(`${source}|${utcDate}|${siteId}`).then(hash => {
    const clientKey = hash.slice(0, 16);
    return env.DB.prepare(`INSERT INTO vitals_samples
      (created_at, site_id, page_type, country, ttfb_ms, fcp_ms, lcp_ms, inp_ms, cls, worker_version, device, client_key, edge)
      VALUES (unixepoch(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(siteId, sample.page_type, typeof country === "string" ? country : null,
        ...metrics.map(key => sample[key] ?? null), env.CF_VERSION_METADATA?.id ?? null, device, clientKey, sample.edge ?? null).run();
  }).catch(() => console.error("[vitals] insert failed", siteId));
  if (ctx) ctx.waitUntil(insert);
  else await insert;
  return new Response(null, { status: 204, headers });
}
