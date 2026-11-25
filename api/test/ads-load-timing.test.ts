import { createContext, runInContext, runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { SETTINGS_SCRIPT, settingsPage } from "../src/admin/templates/settings";
import {
  AD_SLOT_DIMENSIONS,
  parseAdsConfig,
  renderAdManagerScript,
  renderAdProviderHead,
  type AdsConfig,
} from "../src/public/ads";
import { publicCss } from "../src/public/assets/public-css";
import { renderAdSlot } from "../src/public/templates/components";
import { renderLayout } from "../src/public/templates/layout";
import { ALLOWED_SETTINGS_KEYS, renderConsentHead } from "../src/settings/custom-html";
import { miniDocument } from "./helpers/mini-dom";

const gamUrl = "https://securepubads.g.doubleclick.net/tag/js/gpt.js";
const publisher = "ca-pub-1234567890123456";
const adsenseUrl = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisher}`;
const providers = [
  {
    provider: "gam",
    url: gamUrl,
    legacyHead: `<script async src="${gamUrl}" crossorigin="anonymous"></script>` +
      "<script>window.googletag=window.googletag||{cmd:[]};</script>",
  },
  {
    provider: "adsense",
    url: adsenseUrl,
    legacyHead: `<script async src="${adsenseUrl}" crossorigin="anonymous"></script>`,
  },
] as const;

function adConfig(provider: AdsConfig["provider"], timing?: string) {
  return parseAdsConfig({
    ad_provider: provider,
    ads_enabled: "1",
    ads_load_timing: timing,
    gam_network_code: "12345",
    gam_unit_leaderboard: "home",
    adsense_publisher_id: publisher,
    ad_unit_leaderboard: "1234567890",
  });
}

const consentScript = "window.consentStarted=true;";

function bootAdPage(config: AdsConfig, readyState: string) {
  const document = miniDocument(renderLayout({
    site: { name: "News", hostname: "news.example" },
    meta: { title: "News" },
    body: renderAdSlot({ type: "leaderboard", slotId: "home", ads: config }),
    consentHead: renderConsentHead({ consent_head_html: `<script>${consentScript}</script>` }),
    extraHead: `${renderAdProviderHead(config)}\n${renderAdManagerScript(config)}`,
  }));
  document.readyState = readyState;
  const window: EventTarget & { googletag?: { cmd: unknown[] }; adsbygoogle?: unknown[] } =
    new EventTarget();
  const head = document.head!;
  const initialScripts = head.querySelectorAll("script");
  const append = vi.spyOn(head, "appendChild");
  const context = createContext({ document, window });
  for (const script of initialScripts) {
    if (!script.hasAttribute("src") && !script.hasAttribute("type")) {
      runInContext(script.textContent, context);
    }
  }
  return { document, window, initialScripts, append };
}

describe.each(providers)("P4-T7 $provider loader", ({ provider, url, legacyHead }) => {
  it("restores the exact original provider markup in legacy mode", () => {
    expect(renderAdProviderHead(adConfig(provider, "legacy"))).toBe(legacyHead);
  });

  it("queues the slot at DOM ready and inserts one async, anonymous provider script on load", () => {
    const config = adConfig(provider, "after_content");
    expect(renderAdManagerScript(config)).toBe(renderAdManagerScript(adConfig(provider, "legacy")));
    const { document, window, initialScripts, append } = bootAdPage(config, "loading");
    expect(initialScripts[0]?.textContent).toBe(consentScript);
    expect(initialScripts.filter(script => script.hasAttribute("src"))).toHaveLength(0);
    expect(append).not.toHaveBeenCalled();

    document.readyState = "interactive";
    document.root.fire("DOMContentLoaded");
    const queue = provider === "gam" ? window.googletag?.cmd : window.adsbygoogle;
    expect(queue).toEqual(provider === "gam" ? [expect.any(Function)] : [{}]);
    expect(append).not.toHaveBeenCalled();

    document.readyState = "complete";
    window.dispatchEvent(new Event("load"));
    window.dispatchEvent(new Event("load"));
    expect(append).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      tagName: "SCRIPT", src: url, async: true, crossOrigin: "anonymous",
    }));
    expect(provider === "gam" ? window.googletag?.cmd : window.adsbygoogle).toBe(queue);
    expect(queue).toHaveLength(1);
  });

  it("starts immediately if load already happened", () => {
    const { append } = bootAdPage(adConfig(provider), "complete");
    expect(append).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ src: url }));
  });

  it("uses after_content for missing and unrecognized settings", () => {
    const afterContent = renderAdProviderHead(adConfig(provider, "after_content"));
    expect(renderAdProviderHead(adConfig(provider))).toBe(afterContent);
    expect(renderAdProviderHead(adConfig(provider, "unknown"))).toBe(afterContent);
  });
});

const site = { id: "example", name: "News" };

describe("P4-T7 ad timing setting", () => {
  it("reserves every in-page slot's height in the public stylesheet", () => {
    for (const [type, { height }] of Object.entries(AD_SLOT_DIMENSIONS)) {
      const rule = new RegExp(`\\.ad-slot\\[data-ad-type="${type}"\\]\\s*\\{[^}]*min-height:\\s*${height}px\\b`);
      expect(publicCss).toMatch(rule);
    }
  });

  it.each([
    [undefined, "after_content"],
    ["unknown", "after_content"],
    ["legacy", "legacy"],
  ])("shows the two timing choices in the Ads tab for stored value %s", (stored, expected) => {
    const document = miniDocument(settingsPage([site], { ads_load_timing: stored }, site.id));
    const selects = document.querySelectorAll('#tab-ads select[name="ads_load_timing"]');
    expect(selects).toHaveLength(1);
    const select = selects[0]!;
    expect(select.value).toBe(expected);
    expect(select.querySelectorAll("option").map(option => [option.value, option.textContent])).toEqual([
      ["after_content", "After page content (faster)"], ["legacy", "Old timing"],
    ]);
  });

  it("submits Old timing for the selected site under an allowed PATCH key", () => {
    expect(ALLOWED_SETTINGS_KEYS.has("ads_load_timing")).toBe(true);
    const document = miniDocument(settingsPage([site], {}, site.id));
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
    runInNewContext(SETTINGS_SCRIPT, {
      document, fetch: send,
      FormData: class {
        get(key: string) { return document.querySelector(`[name="${key}"]`)?.value ?? null; }
      },
    });
    document.getElementById("setting-ads_load_timing")!.value = "legacy";
    document.getElementById("settings-editor-form")!.fire("submit");
    expect(send).toHaveBeenCalledExactlyOnceWith("/api/admin/settings", expect.objectContaining({ method: "PATCH" }));
    expect(JSON.parse(String(send.mock.calls[0]![1]?.body))).toMatchObject({
      site_id: site.id, updates: { ads_load_timing: "legacy" },
    });
  });
});
