// rescue-6 (agent-readiness, IVT Layer 1): free, open-source SERVER-SIDE
// invalid-traffic signals for a Cloudflare Worker. Two signals, both free and
// bundled (no paid plan, no third-party service, no runtime network):
//   1. Datacenter / hosting ASN — Cloudflare gives us `cf.asn` free on every
//      plan; ad impressions from cloud/colo IPs are textbook GIVT. The set
//      below is a curated subset of the MIT lists brianhama/bad-asn-list and
//      X4BNet/lists_vpn (expand it from those via a build step). It deliberately
//      EXCLUDES mixed eyeball+service ASNs (e.g. Google 15169) to avoid
//      false-positives on real users.
//   2. Declared-bot user-agent — a vendored subset of isbot (Unlicense) /
//      monperrus crawler-user-agents (MIT) + common non-browser HTTP clients.
//
// Both are SOFT signals: the caller SUPPRESSES ADS (never blocks a human), and
// verified search engines are excluded UPSTREAM (router botFromCfSignals) so
// this never cloaks Googlebot. Honest ceiling: this is GIVT-grade. Sophisticated
// human-like traffic (SIVT) is not detectable from these signals and is left to
// the ad network's own filtering.

// Curated datacenter / hosting ASNs (predominantly non-eyeball networks).
export const DATACENTER_ASNS: ReadonlySet<number> = new Set<number>([
  16509, // Amazon AWS (AMAZON-02)
  14618, // Amazon AWS (AMAZON-AES)
  396982, // Google Cloud Platform (NOT 15169, which mixes eyeball/service)
  14061, // DigitalOcean
  16276, // OVH
  24940, // Hetzner
  63949, // Linode / Akamai Connected Cloud
  20473, // Vultr / Choopa
  51167, // Contabo
  12876, // Scaleway / Online SAS
  31898, // Oracle Cloud (OCI)
  9009, // M247 (hosting/VPN, heavy bot source)
  36352, // ColoCrossing (heavy bot source)
  53667, // FranTech / BuyVM (PONYNET)
]);

export function isDatacenterAsn(asn: number | undefined | null): boolean {
  return typeof asn === "number" && DATACENTER_ASNS.has(asn);
}

// Vendored declared-bot UA regex (subset of isbot / crawler-user-agents) plus
// common non-browser HTTP clients. Used ONLY to suppress ads, never to block,
// and only for requests Cloudflare has not verified as a good bot.
const BOT_UA_RE =
  /bot\b|crawl|spider|slurp|mediapartners|facebookexternalhit|embedly|bitlybot|baiduspider|yandex|sogou|exabot|ia_archiver|semrush|ahrefs|mj12bot|dotbot|petalbot|bytespider|gptbot|ccbot|claudebot|perplexity|headlesschrome|python-requests|curl|wget|go-http-client|java\/|okhttp|scrapy|httpclient/i;

export function isDeclaredBotUA(userAgent: string | undefined | null): boolean {
  return (
    typeof userAgent === "string" &&
    userAgent.length > 0 &&
    BOT_UA_RE.test(userAgent)
  );
}
