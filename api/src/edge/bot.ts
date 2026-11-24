import type { EdgeRequestSignals } from "../analytics/listicle-quality";
import { isDatacenterAsn, isDeclaredBotUA } from "../safety/ivt";

export function botFromCfSignals(cf: EdgeRequestSignals | undefined, userAgent?: string | null): boolean {
  if (cf === undefined) return false;
  if (cf.verifiedBot === true) {
    // Verified search engines get the same page as humans, even on a hosting ASN.
    const category = cf.verifiedBotCategory;
    return typeof category === "string" && category.toLowerCase().includes("ai");
  }
  const score = cf.botManagement?.score;
  // A zero score means Bot Management has no score for this request.
  return (typeof score === "number" && score > 0 && score < 30)
    || isDatacenterAsn(cf.asn)
    || isDeclaredBotUA(userAgent);
}

export function requestIsBot(request: Request): boolean {
  return botFromCfSignals(request.cf as EdgeRequestSignals | undefined, request.headers.get("User-Agent"));
}

export function edgeBotVariant(request: Request, pathname: string): boolean {
  const adBearingPage = pathname === "/" || /^\/article\/[^/]+$/.test(pathname)
    || /^\/category\/[^/]+(?:\/page\/\d+)?$/.test(pathname);
  return adBearingPage && requestIsBot(request);
}
