// LeadGen runtime — auction client (fix-contract v2.4 03 §3.6 + §3.2
// auction-client.ts row).
//
// Final-section submit: POST /lg/auction with the FULL binding tuple, render
// the returned banners, fire impressions via IntersectionObserver, and leave
// click-through alone (banner links are governed /lg/lc hrefs composed
// server-side — NO client URL construction, ever).
//
// Impression discipline (R7 / §3.6): one IntersectionObserver per impression
// target; ≥50% visible for ≥1s; each impressions[] entry beacons EXACTLY ONCE
// per (page_view_id, banner_render_id, slot_index) — enforced client-side by
// a fired-set (event_type is part of the key because one slot legitimately
// carries BOTH carrier_impression and offer_impression rows). Re-render/back
// re-uses the same banner_render_id, so the fired-set also collapses those.
//
// BROWSER module (fetch/IntersectionObserver INSIDE functions only).

import type { LgAnswerSource } from "./state";

export const LG_AUCTION_URL = "/lg/auction";

// §3.6 request (additive contract — field names normative).
export interface LgAuctionRequest {
  funnel_attempt_id: string;
  signed_config_token: string;
  funnel_variant_id: string;
  content_version: number;
  section_order_hash: string;
  answers: Record<string, { value: unknown; answer_source: LgAnswerSource }>;
  answer_mapping_versions: Record<string, string>;
  session_id: string;
  page_view_id: string;
}

// §3.6 response additions (serve-auction.ts).
export interface LgAuctionImpression {
  event_type: "carrier_impression" | "offer_impression";
  offer_id: string;
  placement_id: string;
  carrier_key?: string;
  slot_index: number;
  auction_result_id: string;
  banner_render_id: string;
}

export interface LgAuctionResponse {
  banners_html: string;
  auction_result_id: string;
  banner_render_id: string;
  impressions: LgAuctionImpression[];
  unfilled?: true;
}

export type LgAuctionOutcome =
  | { ok: true; response: LgAuctionResponse }
  | { ok: false; kind: "network" | "http" | "tampered" | "malformed"; status?: number };

function coerceResponse(raw: unknown): LgAuctionResponse | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const impressionsRaw = Array.isArray(r["impressions"]) ? r["impressions"] : [];
  const impressions: LgAuctionImpression[] = [];
  for (const item of impressionsRaw) {
    if (item === null || typeof item !== "object") continue;
    const i = item as Record<string, unknown>;
    if (i["event_type"] !== "carrier_impression" && i["event_type"] !== "offer_impression") continue;
    impressions.push({
      event_type: i["event_type"],
      offer_id: typeof i["offer_id"] === "string" ? i["offer_id"] : "",
      placement_id: typeof i["placement_id"] === "string" ? i["placement_id"] : "",
      ...(typeof i["carrier_key"] === "string" ? { carrier_key: i["carrier_key"] } : {}),
      slot_index: typeof i["slot_index"] === "number" ? i["slot_index"] : 0,
      auction_result_id: typeof i["auction_result_id"] === "string" ? i["auction_result_id"] : "",
      banner_render_id: typeof i["banner_render_id"] === "string" ? i["banner_render_id"] : "",
    });
  }
  return {
    banners_html: typeof r["banners_html"] === "string" ? r["banners_html"] : "",
    auction_result_id: typeof r["auction_result_id"] === "string" ? r["auction_result_id"] : "",
    banner_render_id: typeof r["banner_render_id"] === "string" ? r["banner_render_id"] : "",
    impressions,
    ...(r["unfilled"] === true ? { unfilled: true as const } : {}),
  };
}

// POST /lg/auction once. §3.5.8 retry policy is the CALLER's (engine retries
// ×2 with backoff on network/5xx; a 422 `tampered` is terminal — re-posting
// an invalid binding can never heal).
export async function postAuction(body: LgAuctionRequest): Promise<LgAuctionOutcome> {
  let res: Response;
  try {
    res = await fetch(LG_AUCTION_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, kind: "network" };
  }
  if (res.status === 422) return { ok: false, kind: "tampered", status: 422 };
  if (res.status >= 500) return { ok: false, kind: "network", status: res.status };
  if (!res.ok) return { ok: false, kind: "http", status: res.status };
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { ok: false, kind: "malformed" };
  }
  const response = coerceResponse(raw);
  if (response === null) return { ok: false, kind: "malformed" };
  return { ok: true, response };
}

// ---------------------------------------------------------------------------
// Impressions (R7)
// ---------------------------------------------------------------------------

export const IMPRESSION_VISIBLE_RATIO = 0.5;
export const IMPRESSION_DWELL_MS = 1000;

export function impressionFireKey(
  pageViewId: string,
  imp: LgAuctionImpression,
): string {
  return `${pageViewId}|${imp.banner_render_id}|${imp.slot_index}|${imp.event_type}`;
}

// Resolve the DOM target for a slot: prefer an explicit [data-lg-slot="{i}"]
// inside the banners mount (presets/serve-auction may stamp it); then the
// LIVE wire shape — banner.ts renderCard stamps `data-slot="{slot}"` on each
// governed `<a class="lg-banner">` card (1-based render slots) inside the
// `<div class="lg-banners">` wrapper banners_html carries — and finally fall
// back to the mount's i-th element child (banners rendered in slot order,
// unwrapped). Without the data-slot leg NO observer could attach on a real
// funnel (the wrapper is the mount's only child and the slots are 1-based),
// silently zeroing R7 impressions — caught by the 11 §11.2 live suite.
export function slotTarget(mount: Element, slotIndex: number): Element | null {
  const explicit =
    mount.querySelector(`[data-lg-slot="${String(slotIndex)}"]`) ??
    mount.querySelector(`[data-slot="${String(slotIndex)}"]`);
  if (explicit !== null) return explicit;
  const children = mount.children;
  return slotIndex >= 0 && slotIndex < children.length ? (children[slotIndex] ?? null) : null;
}

export interface LgImpressionHooks {
  pageViewId: string;
  // Called once per un-fired impression entry when its slot satisfies the
  // ≥50%-for-≥1s rule; the engine beacons carrier_impression/offer_impression.
  fire: (impression: LgAuctionImpression) => void;
  // Shared fired-set — lives at engine scope so a banners re-render (back/
  // forward) with the SAME banner_render_id can never double-fire (§3.6).
  firedSet: Set<string>;
}

// Attach one IntersectionObserver per impression target. Returns the number
// of observers attached. No IntersectionObserver in the UA → attach nothing
// (honest undercount — the ≥50%/≥1s rule must never degrade to fire-on-load).
export function observeImpressions(
  mount: Element,
  impressions: readonly LgAuctionImpression[],
  hooks: LgImpressionHooks,
): number {
  if (typeof IntersectionObserver === "undefined") return 0;

  // Group impression rows by slot: one target/observer per slot, N events.
  const bySlot = new Map<number, LgAuctionImpression[]>();
  for (const imp of impressions) {
    const list = bySlot.get(imp.slot_index);
    if (list !== undefined) list.push(imp);
    else bySlot.set(imp.slot_index, [imp]);
  }

  let attached = 0;
  bySlot.forEach((rows, slotIndex) => {
    const pending = rows.filter((imp) => !hooks.firedSet.has(impressionFireKey(hooks.pageViewId, imp)));
    if (pending.length === 0) return;
    const target = slotTarget(mount, slotIndex);
    if (target === null) return;

    let dwellTimer: unknown = null;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= IMPRESSION_VISIBLE_RATIO) {
            if (dwellTimer === null) {
              dwellTimer = setTimeout(() => {
                dwellTimer = null;
                for (const imp of pending) {
                  const key = impressionFireKey(hooks.pageViewId, imp);
                  if (hooks.firedSet.has(key)) continue;
                  hooks.firedSet.add(key);
                  hooks.fire(imp);
                }
                observer.disconnect();
              }, IMPRESSION_DWELL_MS);
            }
          } else if (dwellTimer !== null) {
            // Left the ≥50% band before the 1s dwell — reset.
            clearTimeout(dwellTimer as ReturnType<typeof setTimeout>);
            dwellTimer = null;
          }
        }
      },
      { threshold: IMPRESSION_VISIBLE_RATIO },
    );
    observer.observe(target);
    attached += 1;
  });
  return attached;
}
