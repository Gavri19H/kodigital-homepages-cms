// §15.4 / §31.3 — post-cache per-request context injection.
//
// The cached per-Version shell is BYTE-IDENTICAL for every visitor (geo /
// device / session are NEVER part of the cache key). This module injects the
// per-request script
//   <script data-lst="ctx">window._LST_SID="…";window.__LST_CTX={…};
//                          window.__LST_EXP={…}</script>
// into the response AFTER the shell has been read from KV/Cache-API (or
// freshly rendered — the KV copy stays pristine either way), immediately
// BEFORE the §15.3 selector script so the selector sees the sid + rule
// context at pre-paint time.
//
//   * _LST_SID   — §31.3: the request's ko_sid (the same value the edge just
//     minted/echoed via Set-Cookie); the client generates a sid ONLY when
//     this injection is absent.
//   * __LST_CTX  — §15.4 cache-safe rule context: request-time geo/device
//     from CF + UA (country/state/city/device/os/browser), hour in the SITE
//     timezone (register Q13), and the acquisition dims read from the
//     ko_ctx cookie / landing query (traffic_source/placement/utm_*/
//     language/cpc/fbc/fbclid/sub1–5) — exactly the RuleContext dims the
//     rules engine + beacon consume.
//   * __LST_EXP  — authored addition (documented): the §15.7 article-layer
//     experiment dims (article_experiment_id / variant id / label / split).
//     They are REQUEST-TIME state (an experiment can start/stop while a
//     shell stays cached), so they ride the injection, not the shell.
//
// Mechanism: HTMLRewriter on the response stream (the contract-mandated
// post-cache transform). HTMLRewriter is a workerd global — absent in the
// vitest node environment — so a byte-equivalent string-splice fallback runs
// there (and ONLY there); the Playwright e2e exercises the real HTMLRewriter
// path under `wrangler dev`. Both paths inject the IDENTICAL script text.
//
// NOTE deliverable wording "inject the beacon + selector scripts refs": the
// selector/beacon RUNTIMES are static ES5 atoms and live inside the cached
// shell itself (§22.3 "a few KB inline ES5" — they are visitor-invariant);
// only this per-request context script is injected post-cache.

import type { KoCtx } from "./ko-ctx";
import { SELECTOR_SCRIPT_MARKER } from "./runtime";

export interface InjectedExperimentDims {
  experiment_id: string;
  variant_id: string;
  variant_label: string;
  split: number | null;
}

// The __LST_CTX payload — string dims + the numeric site-tz hour.
export interface InjectedRuleContext {
  hour?: number;
  [dim: string]: string | number | undefined;
}

export interface ListicleContextPayload {
  sid: string;
  ctx: InjectedRuleContext;
  exp: InjectedExperimentDims | null;
}

// JSON safe for inline-script embedding (< escaped so </script> can never
// terminate the tag from a data value).
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function buildContextScript(payload: ListicleContextPayload): string {
  const parts = [
    `window._LST_SID=${safeJson(payload.sid)};`,
    `window.__LST_CTX=${safeJson(payload.ctx)};`,
  ];
  if (payload.exp !== null) {
    parts.push(`window.__LST_EXP=${safeJson(payload.exp)};`);
  }
  return `<script data-lst="ctx">${parts.join("")}</script>`;
}

// Compose the __LST_CTX dims from the request-time signals + acquisition
// cookie. Only non-empty values are emitted (missing dim = "any" for rules).
export function buildRuleContext(input: {
  geo: { country: string; state: string; city: string };
  ua: { device: string; os: string; browser: string };
  hourSiteTz: number;
  koCtx: KoCtx;
}): InjectedRuleContext {
  const ctx: InjectedRuleContext = {};
  const put = (key: string, value: string | undefined): void => {
    if (typeof value === "string" && value !== "") ctx[key] = value;
  };
  put("country", input.geo.country);
  put("state", input.geo.state);
  put("city", input.geo.city);
  put("device", input.ua.device);
  put("os", input.ua.os);
  put("browser", input.ua.browser);
  put("traffic_source", input.koCtx.traffic_source);
  put("placement", input.koCtx.placement);
  put("utm_source", input.koCtx.utm_source);
  put("utm_medium", input.koCtx.utm_medium);
  put("utm_content", input.koCtx.utm_content);
  put("language", input.koCtx.language);
  put("cpc", input.koCtx.cpc);
  put("fbc", input.koCtx.fbc);
  put("fbclid", input.koCtx.fbclid);
  put("sub1", input.koCtx.sub1);
  put("sub2", input.koCtx.sub2);
  put("sub3", input.koCtx.sub3);
  put("sub4", input.koCtx.sub4);
  put("sub5", input.koCtx.sub5);
  ctx.hour = input.hourSiteTz;
  return ctx;
}

// Inject the context script into an HTML response, post-cache. Returns a NEW
// Response; the input body/KV entry is never mutated. Injection point: right
// before the §15.3 selector script (its marker tag); a shell without the
// marker (stale Phase-6 cache entry within its TTL) degrades to a </head>
// injection so the sid still reaches the beacon.
export function injectListicleContext(
  response: Response,
  payload: ListicleContextPayload,
): Response {
  const script = buildContextScript(payload);

  if (typeof HTMLRewriter !== "undefined") {
    let injected = false;
    const rewriter = new HTMLRewriter()
      .on('script[data-lst="selector"]', {
        element(el) {
          injected = true;
          el.before(script, { html: true });
        },
      })
      // Fallback anchor for marker-less (stale Phase-6) shells: prepend into
      // <head>. Guarded so a marker hit wins (before() runs in document
      // order: head fires first, so we instead append at head END only when
      // the selector never appears — handled by onEndTag below).
      .on("head", {
        element(el) {
          const endHandler = (end: { before(html: string, opts?: { html?: boolean }): void }): void => {
            if (!injected) end.before(script, { html: true });
          };
          // workers-types: Element.onEndTag is available in workerd.
          (el as unknown as { onEndTag(cb: (end: never) => void): void }).onEndTag(
            endHandler as unknown as (end: never) => void,
          );
        },
      });
    return rewriter.transform(response);
  }

  // Node/vitest fallback (no HTMLRewriter global): identical bytes via
  // string splice. The e2e suite proves the HTMLRewriter path in workerd.
  return injectByString(response, script);
}

async function readBody(response: Response): Promise<string> {
  return response.text();
}

function injectByString(response: Response, script: string): Response {
  // Response bodies from this repo's serve path are strings; splice
  // synchronously via a piped promise Response to keep the signature sync.
  const transformed = (async (): Promise<string> => {
    const html = await readBody(response);
    const markerIdx = html.indexOf(SELECTOR_SCRIPT_MARKER);
    if (markerIdx >= 0) {
      return html.slice(0, markerIdx) + script + html.slice(markerIdx);
    }
    const headIdx = html.indexOf("</head>");
    if (headIdx >= 0) {
      return html.slice(0, headIdx) + script + html.slice(headIdx);
    }
    return script + html;
  })();

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  void transformed.then(async (html) => {
    const writer = writable.getWriter();
    await writer.write(new TextEncoder().encode(html));
    await writer.close();
  });
  return new Response(readable, {
    status: response.status,
    headers: new Headers(response.headers),
  });
}
