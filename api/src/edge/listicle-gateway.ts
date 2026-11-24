import { getQueryParam } from "hono/utils/url";
import { geoFromCf, hourInTimezone, parseClientUa } from "../analytics/listicle-quality";
import { buildContextScript, buildRuleContext } from "../public/listicle/ctx-inject";
import { readCookie, sessionCookie } from "../public/listicle/experiment-pick";
import { buildKoCtx, KO_CTX_COOKIE, parseKoCtx, serializeKoCtxCookie } from "../public/listicle/ko-ctx";
import { SELECTOR_SCRIPT_MARKER } from "../public/listicle/runtime";
import type { ListiclePick } from "./listicle-select";
import type { GatewayRequestInput } from "./types";

export interface ListicleGatewayArgs {
  pick: ListiclePick;
  input: GatewayRequestInput;
  sidWasAbsent: boolean;
  siteTimeZone: string;
  siteLanguage: string;
}

export function buildListicleGatewayOutput({
  pick, input, sidWasAbsent, siteTimeZone, siteLanguage,
}: ListicleGatewayArgs): { setCookies: string[]; contextScript: string } {
  // Use the same parser as c.req.query(), including its handling of duplicate keys.
  const query = getQueryParam(input.url.href);
  const cookieHeader = input.headers.get("Cookie");
  const koCtx = buildKoCtx({
    existing: parseKoCtx(cookieHeader === null ? input.cookies[KO_CTX_COOKIE] : readCookie(cookieHeader, KO_CTX_COOKIE)),
    query: typeof query === "object" ? query : {},
    landerV: pick.versionPublicId,
    siteLanguage,
    acceptLanguage: input.headers.get("Accept-Language"),
    nowMs: input.nowMs,
  });

  const setCookies: string[] = [];
  if (sidWasAbsent) setCookies.push(sessionCookie("ko_sid", input.sid));
  setCookies.push(sessionCookie("ko_ver", pick.versionPublicId), serializeKoCtxCookie(koCtx));
  const contextScript = buildContextScript({
    sid: input.sid,
    ctx: buildRuleContext({
      geo: geoFromCf(input.cf),
      ua: parseClientUa(input.headers.get("User-Agent")),
      hourSiteTz: hourInTimezone(siteTimeZone.trim(), new Date(input.nowMs)),
      koCtx,
    }),
    exp: pick.experimentId === null ? null : {
      experiment_id: pick.experimentId,
      variant_id: pick.versionPublicId,
      variant_label: pick.variantLabel,
      split: pick.trafficAllocation,
    },
  });
  return { setCookies, contextScript };
}

export function injectListicleGateway(response: Response, contextScript: string): Response {
  if (response.body === null) return response;
  // Match injectListicleContext's anchors, using the already serialized script.
  if (typeof HTMLRewriter !== "undefined") {
    let injected = false;
    return new HTMLRewriter()
      .on('script[data-lst="selector"]', {
        element(el) {
          el.before(contextScript, { html: true });
          injected = true;
        },
      })
      .on("head", {
        element(el) {
          el.onEndTag((end) => {
            if (!injected) end.before(contextScript, { html: true });
          });
        },
      })
      .transform(response);
  }

  // Node has no HTMLRewriter. Use the renderer's string-splice anchors there.
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const html = await response.text();
      const marker = html.indexOf(SELECTOR_SCRIPT_MARKER);
      const offset = marker >= 0 ? marker : Math.max(0, html.indexOf("</head>"));
      controller.enqueue(new TextEncoder().encode(html.slice(0, offset) + contextScript + html.slice(offset)));
      controller.close();
    },
  });
  return new Response(body, response);
}
