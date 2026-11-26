import { injectAssignment } from "../public/leadgen/serve";
import { sessionCookie } from "../public/listicle/experiment-pick";
import type { LeadgenSelection } from "./leadgen-select";

export async function injectLeadgenAssignment(
  response: Response,
  selection: Extract<LeadgenSelection, { kind: "render" }>,
): Promise<Response> {
  if (response.body === null) return response;

  const html = injectAssignment(await response.text(), selection.assignment, selection.funnelVariantId);
  const body = new TextEncoder().encode(html);
  const result = new Response(body, response);
  if (result.headers.has("Content-Length")) {
    result.headers.set("Content-Length", String(body.byteLength));
  }
  return result;
}

export function leadgenGatewayCookies(sid: string, sidWasAbsent: boolean): string[] {
  return sidWasAbsent ? [sessionCookie("ko_sid", sid)] : [];
}
