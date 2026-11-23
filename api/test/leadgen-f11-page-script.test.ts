// F11 — the funnel page's small redirect script (redirect/page-script.ts),
// driven in the repo's mini-DOM (test/helpers/mini-dom.ts) against the REAL
// redirect screen markup (redirect/screen.ts over real cards from
// auction/banner.ts), with a fake clock, fake timers, a cookie jar and a
// sessionStorage. Plan Section 3 D/H, Section 8 "the page script".
//
//   1. countdown → the lg_rc mark is set → THEN .click() on the card's own link
//      (one click, the link unchanged, the mark's value = that link's brid.slot);
//   2. a visitor's own click first: the countdown stops, no mark, no 2nd click;
//      the same for a middle-click / context menu (no second counted click);
//   3. "Stay here" under none / offer / carrier: shows the other cards in order,
//      hides what the Auction says, counts and writes nothing;
//   4. the card opens by itself at most once per funnel attempt; Back from the
//      partner (page restored from the back/forward cache) shows today's page;
//   5. the countdown pauses while the tab is hidden;
//   6. "Only the animation": no card on screen, the same click at 0, and
//      "Show me all offers" works like "Stay here";
//   7. the script ships in the shell, outside the visitor bundle, as ES5; the
//      visitor bundle is unchanged.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { renderBanners, type BannerRenderCarrier } from "../src/public/leadgen/auction/banner";
import { getBannerDesign } from "../src/public/leadgen/designs/registry";
import { renderRedirectScreen } from "../src/public/leadgen/redirect/screen";
import { REDIRECT_PAGE_SCRIPT } from "../src/public/leadgen/redirect/page-script";
import { REDIRECT_MARK_COOKIE, type RedirectAfterInstruction } from "../src/public/leadgen/redirect/types";
import { LEADGEN_RUNTIME_JS } from "../src/public/leadgen/runtime/engine-bundle.generated";
import { miniDocument, type MiniNode } from "./helpers/mini-dom";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// The real screen over real cards (3 cards: two of Offer B on slots 2 and 3 —
// slot 3 shares the chosen card's Carrier key under another Offer).
// ---------------------------------------------------------------------------

function entry(key: string, name: string, slot: number, offer: string): BannerRenderCarrier {
  return {
    carrier: {
      carrier_key: key,
      carrier_name: name,
      carrier_logo: `https://cdn.example.com/${key}.png`,
      headline: `Headline ${key}`,
      subheadline: "Sub line",
      click_url: `https://partner.example.com/${key}`,
      bid: 2,
      bid_currency: "USD",
      tracking_id: null,
      disclaimer: null,
      pricing_model: null,
      carrier_key_source: "provider_id",
    },
    offer_public_id: offer,
    slot,
    source: slot === 1 ? "winner" : "multi_offer",
    bid: 2,
  };
}

const CARDS = renderBanners(
  [
    entry("alpha", "Alpha Co", 1, "lgo_a"),
    entry("beta", "Beta Co", 2, "lgo_b"),
    entry("beta2", "Beta Two", 3, "lgo_b"),
    entry("beta", "Beta Co (other offer)", 4, "lgo_c"),
  ],
  { auction_instance_id: "ai_1", funnel_attempt_id: "fa_1" },
  { mode: "automatic" },
  getBannerDesign(null),
  { mintId: () => "01JBRIDXYZ" },
).html;

function screenHtml(over: Partial<RedirectAfterInstruction> = {}): string {
  const instruction: RedirectAfterInstruction = {
    rule_public_id: "lfr_1",
    offer_public_id: "lgo_b",
    slot: 2,
    carrier_key: "beta",
    seconds: 5,
    display: "banner",
    brand: "Beta Co",
    logo_url: "https://cdn.example.com/beta.png",
    stay_hides: { mode: "offer", offer_public_id: "lgo_b" },
    banner_render_id: "01JBRIDXYZ",
    ...over,
  };
  const out = renderRedirectScreen({ banners_html: CARDS, instruction, look: null });
  expect(out).not.toBe(CARDS);
  return out;
}

// ---------------------------------------------------------------------------
// The page: a mount like the shell's, the script, a fake clock + timers.
// ---------------------------------------------------------------------------

interface Page {
  doc: ReturnType<typeof miniDocument>;
  cookieWrites: string[];
  storage: Map<string, string>;
  clicks: Array<{ slot: string | null; cookieAtClick: string[]; href: string | null }>;
  advance(ms: number): void;
  inject(html: string): MiniNode;
  root(): MiniNode;
  card(slot: number): MiniNode;
  run(): string | null;
  setHidden(hidden: boolean): void;
  pageshow(persisted: boolean): void;
  timersPending(): number;
}

function page(opts: { storage?: Map<string, string>; hidden?: boolean } = {}): Page {
  const doc = miniDocument(
    '<html><body><div id="lg-funnel-root"><div class="lg-banners" data-lg-banners hidden></div></div></body></html>',
  );
  let clock = 1_700_000_000_000;
  let nextId = 1;
  let timers: Array<{ id: number; at: number; fn: () => void; every: number | null }> = [];
  const setTimeout = (fn: () => void, ms: number): number => {
    const id = nextId++;
    timers.push({ id, at: clock + Math.max(0, ms), fn, every: null });
    return id;
  };
  const setInterval = (fn: () => void, ms: number): number => {
    const id = nextId++;
    timers.push({ id, at: clock + ms, fn, every: ms });
    return id;
  };
  const clearTimeout = (id: number): void => {
    timers = timers.filter((t) => t.id !== id);
  };
  const advance = (ms: number): void => {
    const end = clock + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      clock = due.at;
      if (due.every !== null) due.at += due.every;
      else timers = timers.filter((t) => t !== due);
      due.fn();
    }
    clock = end;
  };
  const cookieWrites: string[] = [];
  Object.defineProperty(doc, "cookie", {
    get: () => cookieWrites.map((c) => c.split(";")[0]).join("; "),
    set: (v: string) => void cookieWrites.push(String(v)),
  });
  const d = doc as unknown as { hidden: boolean; visibilityState: string };
  d.hidden = opts.hidden === true;
  d.visibilityState = opts.hidden === true ? "hidden" : "visible";
  const storage = opts.storage ?? new Map<string, string>();
  const winListeners: Record<string, Array<(ev: unknown) => void>> = {};
  let observerCallback: (() => void) | null = null;
  class FakeMutationObserver {
    constructor(cb: () => void) {
      observerCallback = cb;
    }
    observe(): void {}
  }
  const win = {
    setTimeout,
    clearTimeout,
    setInterval,
    sessionStorage: {
      getItem: (k: string) => (storage.has(k) ? (storage.get(k) as string) : null),
      setItem: (k: string, v: string) => void storage.set(k, String(v)),
    },
    MutationObserver: FakeMutationObserver,
    addEventListener: (t: string, fn: (ev: unknown) => void) => void (winListeners[t] ??= []).push(fn),
  };
  runInNewContext(REDIRECT_PAGE_SCRIPT, { window: win, document: doc, Date: { now: () => clock } });

  const clicks: Page["clicks"] = [];
  const mount = doc.querySelector("[data-lg-banners]") as MiniNode;
  const inject = (html: string): MiniNode => {
    // what render.ts injectBanners does, then the mutation the observer sees
    mount.innerHTML = html;
    mount.hidden = false;
    for (const a of mount.querySelectorAll("a.lg-banner")) {
      a.addEventListener("click", () => {
        clicks.push({ slot: a.getAttribute("data-slot"), cookieAtClick: [...cookieWrites], href: a.getAttribute("href") });
      });
    }
    if (observerCallback !== null) observerCallback();
    return mount.querySelector("[data-lg-redirect]") as MiniNode;
  };
  const root = (): MiniNode => mount.querySelector("[data-lg-redirect]") as MiniNode;
  return {
    doc,
    cookieWrites,
    storage,
    clicks,
    advance,
    inject,
    root,
    card: (slot: number) => mount.querySelector(`a.lg-banner[data-slot="${slot}"]`) as MiniNode,
    run: () => root().getAttribute("data-lg-rd-run"),
    setHidden(hidden: boolean) {
      d.hidden = hidden;
      d.visibilityState = hidden ? "hidden" : "visible";
      doc.root.fire("visibilitychange");
    },
    pageshow(persisted: boolean) {
      for (const fn of winListeners["pageshow"] ?? []) fn({ persisted });
    },
    timersPending: () => timers.length,
  };
}

const MARK = `${REDIRECT_MARK_COOKIE}=01JBRIDXYZ.2; Max-Age=30; Path=/; SameSite=Lax; Secure`;
const seconds = (p: Page): string[] => p.root().querySelectorAll("[data-lg-rd-n]").map((n) => n.textContent);
const hiddenSlots = (p: Page): string[] =>
  p.root().querySelectorAll("a.lg-banner[data-lg-rd-hide]").map((a) => a.getAttribute("data-slot") as string);

// ===========================================================================


// F11 review fix: a visitor's own card click clears any mark an earlier page
// click left behind (its navigation never reached /lg/lc), so these tests
// assert "no mark SET", and that the only other write is the clear.
const CLEAR = "lg_rc=; Max-Age=0; Path=/; SameSite=Lax; Secure";
function marksSet(p: { cookieWrites: string[] }): string[] {
  return p.cookieWrites.filter((w) => /^lg_rc=[^;]/.test(w));
}

describe("F11 page script — the countdown, then the mark, then ONE click on the card's own link", () => {
  it("claims the screen, counts 5→1, sets lg_rc and only THEN clicks the chosen card, once", () => {
    const p = page();
    const original = p.inject(screenHtml());
    expect(p.run()).toBe("countdown");
    expect(original.getAttribute("data-lg-rd-live")).toBe("");
    expect(seconds(p)).toEqual(["5", "5"]);
    const hrefBefore = p.card(2).getAttribute("href");

    p.advance(1000);
    expect(seconds(p)).toEqual(["4", "4"]);
    p.advance(3000);
    expect(seconds(p)).toEqual(["1", "1"]);
    expect(p.clicks, "nothing before 0").toEqual([]);
    expect(p.cookieWrites).toEqual([]);

    p.advance(1000);
    expect(p.cookieWrites).toEqual([MARK]);
    expect(p.clicks).toHaveLength(1);
    expect(p.clicks[0]!.slot).toBe("2");
    expect(p.clicks[0]!.cookieAtClick, "the mark is set BEFORE the click").toEqual([MARK]);
    // the mark names exactly the clicked link's own brid + slot (what click.ts compares)
    const params = new URLSearchParams((p.clicks[0]!.href ?? "").split("?")[1]);
    expect(`${params.get("brid")}.${params.get("slot")}`).toBe("01JBRIDXYZ.2");
    expect(p.card(2).getAttribute("href"), "the card's link is unchanged").toBe(hrefBefore);
    expect(p.run()).toBe("opened");
    expect(p.storage.get("lg_rd:fa_1")).toBe("1");

    p.advance(60_000);
    expect(p.clicks, "never a second click").toHaveLength(1);
    expect(p.cookieWrites).toHaveLength(1);
    expect(p.timersPending()).toBe(0);
  });

  it("honours the rule's seconds (2 → clicks at 2s, not before)", () => {
    const p = page();
    p.inject(screenHtml({ seconds: 2 }));
    p.advance(1999);
    expect(p.clicks).toHaveLength(0);
    p.advance(1);
    expect(p.clicks).toHaveLength(1);
  });
});

describe("F11 page script — a visitor's own click first is the normal click", () => {
  it("click on the card: the countdown stops for good, no mark, no page click", () => {
    const p = page();
    p.inject(screenHtml());
    p.advance(2000);
    p.card(2).fire("click"); // the visitor's click (the browser then follows the link)
    expect(p.run()).toBe("clicked");
    p.advance(60_000);
    expect(p.clicks, "only the visitor's own click").toHaveLength(1);
    expect(marksSet(p), "a visitor's click never sets the mark").toEqual([]);
    expect(p.cookieWrites, "it only clears any mark left behind").toEqual([CLEAR]);
    expect(p.storage.get("lg_rd:fa_1"), "the attempt is used up").toBe("1");
  });

  it("middle-click or the context menu (a new tab) also stops it: no second counted click", () => {
    for (const type of ["auxclick", "contextmenu"]) {
      const p = page();
      p.inject(screenHtml());
      p.advance(1500);
      p.card(2).fire(type);
      p.advance(60_000);
      expect(p.clicks, type).toHaveLength(0);
      expect(marksSet(p), type).toEqual([]);
      expect(p.run(), type).toBe("clicked");
    }
  });
});

describe('F11 page script — "Stay here" follows the Auction\'s "Remove clicked offers"', () => {
  const cases: Array<[RedirectAfterInstruction["stay_hides"], string[]]> = [
    [{ mode: "none" }, []],
    [{ mode: "offer", offer_public_id: "lgo_b" }, ["2", "3"]],
    [{ mode: "carrier", carrier_key: "beta" }, ["2", "4"]],
  ];
  for (const [stay, hidden] of cases) {
    it(`${stay.mode}: hides [${hidden.join(", ")}], shows the rest in order, counts and writes nothing`, () => {
      const p = page();
      p.inject(screenHtml({ stay_hides: stay }));
      p.advance(2000);
      const btn = p.root().querySelector("button[data-lg-rd-stay]") as MiniNode;
      expect(btn.textContent).toBe("Stay here");
      btn.fire("click");
      expect(p.run()).toBe("stayed");
      expect(p.root().getAttribute("data-lg-rd-live"), "the banner is removed").toBeNull();
      expect(hiddenSlots(p)).toEqual(hidden);
      const shown = p.root().querySelectorAll("a.lg-banner").filter((a) => !a.hasAttribute("data-lg-rd-hide"));
      expect(shown.map((a) => a.getAttribute("data-slot"))).toEqual(["1", "2", "3", "4"].filter((s) => !hidden.includes(s)));
      expect(shown[0]!.focused, "focus moves to the first card shown").toBe(true);
      p.advance(60_000);
      expect(p.clicks).toEqual([]);
      expect(p.cookieWrites).toEqual([]);
      expect([...p.storage.keys()], "Stay here writes nothing").toEqual([]);
      // a later click on a card is a plain visitor click: still no mark
      p.card(1).fire("click");
      expect(marksSet(p)).toEqual([]);
    });
  }
});

describe("F11 page script — at most once per funnel attempt; Back shows today's page", () => {
  it("an attempt that already opened its card gets no countdown (today's results instead)", () => {
    const p = page({ storage: new Map([["lg_rd:fa_1", "1"]]) });
    p.inject(screenHtml());
    expect(p.run()).toBe("back");
    expect(p.root().getAttribute("data-lg-rd-live")).toBeNull();
    p.advance(60_000);
    expect(p.clicks).toEqual([]);
    expect(p.cookieWrites).toEqual([]);
  });

  it("the same screen injected again on the same page (a re-render) never starts a second countdown", () => {
    const p = page();
    p.inject(screenHtml());
    p.advance(1000);
    p.inject(screenHtml());
    expect(p.run()).toBe("back");
    p.advance(60_000);
    expect(p.clicks).toEqual([]);
  });

  it("Back from the partner (page restored from the back/forward cache): no countdown, today's page", () => {
    const p = page();
    p.inject(screenHtml());
    p.advance(5000);
    expect(p.clicks).toHaveLength(1);
    p.pageshow(false); // a normal load event: nothing changes
    expect(p.run()).toBe("opened");
    p.pageshow(true);
    expect(p.run()).toBe("back");
    expect(p.root().getAttribute("data-lg-rd-live")).toBeNull();
    expect(hiddenSlots(p), "today's page: every card").toEqual([]);
    p.advance(60_000);
    expect(p.clicks).toHaveLength(1);
  });
});

describe("F11 page script — the countdown pauses while the tab is hidden", () => {
  it("hidden at 2s for a minute: no click; visible again → 3 more seconds", () => {
    const p = page();
    p.inject(screenHtml());
    p.advance(2000);
    p.setHidden(true);
    expect(p.root().getAttribute("data-lg-rd-paused"), "the CSS animation pauses too").toBe("");
    p.advance(60_000);
    expect(p.clicks).toEqual([]);
    expect(seconds(p)).toEqual(["3", "3"]);
    p.setHidden(false);
    expect(p.root().getAttribute("data-lg-rd-paused")).toBeNull();
    p.advance(2999);
    expect(p.clicks).toEqual([]);
    p.advance(1);
    expect(p.clicks).toHaveLength(1);
  });

  it("a screen that arrives while the tab is hidden waits for the visitor", () => {
    const p = page({ hidden: true });
    p.inject(screenHtml());
    p.advance(30_000);
    expect(p.clicks).toEqual([]);
    p.setHidden(false);
    p.advance(5000);
    expect(p.clicks).toHaveLength(1);
  });
});

describe('F11 page script — "Only the animation"', () => {
  it("no card on screen; at 0 the same card link is clicked once, with the mark", () => {
    const p = page();
    p.inject(screenHtml({ display: "animation" }));
    expect(p.root().className).toContain("lg-rd--only");
    expect(p.run()).toBe("countdown");
    p.advance(5000);
    expect(p.clicks).toHaveLength(1);
    expect(p.clicks[0]!.slot).toBe("2");
    expect(p.clicks[0]!.cookieAtClick).toEqual([MARK]);
  });

  it('"Show me all offers" works like "Stay here"', () => {
    const p = page();
    p.inject(screenHtml({ display: "animation", stay_hides: { mode: "none" } }));
    const btn = p.root().querySelector("button[data-lg-rd-stay]") as MiniNode;
    expect(btn.textContent).toBe("Show me all offers");
    btn.fire("click");
    expect(p.run()).toBe("stayed");
    p.advance(60_000);
    expect(p.clicks).toEqual([]);
    expect(p.cookieWrites).toEqual([]);
  });
});

describe("F11 page script — ships in the shell, outside the visitor bundle", () => {
  it("is old-style JavaScript (ES5) and parses standalone", () => {
    expect(REDIRECT_PAGE_SCRIPT).not.toMatch(/=>/);
    expect(REDIRECT_PAGE_SCRIPT).not.toMatch(/\bconst\b/);
    expect(REDIRECT_PAGE_SCRIPT).not.toMatch(/\blet\b/);
    expect(REDIRECT_PAGE_SCRIPT).not.toContain("`");
    expect(REDIRECT_PAGE_SCRIPT).not.toContain("</");
    expect(() => new Function(REDIRECT_PAGE_SCRIPT)).not.toThrow();
  });

  it("the funnel shell embeds it as its own inline script, after the pre-hydration stub and before the bundle", () => {
    const serve = readFileSync(join(HERE, "../src/public/leadgen/serve.ts"), "utf8");
    const pre = serve.indexOf("`<script>${LEADGEN_PREHYDRATE_JS}</script>` +");
    const own = serve.indexOf("`<script>${REDIRECT_PAGE_SCRIPT}</script>` +");
    const bundle = serve.indexOf("`<script src=\"/lg/runtime/${LEADGEN_TEMPLATE_VERSION}.js\" defer></script>` +");
    expect(pre).toBeGreaterThan(-1);
    expect(own).toBeGreaterThan(pre);
    expect(bundle).toBeGreaterThan(own);
  });

  // The page script never rides the visitor bundle: the bundle's exact size is
  // pinned (53,315 at F11; 56,944 since F18 added the vehicle lookups and the
  // {make}/{year} headline names, 2026-11-23) and it carries no redirect code.
  it("the visitor bundle is unchanged by the page script: same 56,944 bytes, and it knows nothing of the redirect", () => {
    expect(LEADGEN_RUNTIME_JS.length).toBe(56944);
    expect(LEADGEN_RUNTIME_JS).not.toContain("lg_rc");
    expect(LEADGEN_RUNTIME_JS).not.toContain("data-lg-redirect");
  });
});

describe("F11 page script — review fixes (stale mark, no results mount)", () => {
  it("a mark left by a page click whose navigation never happened is cleared before the visitor's own click", () => {
    const p = page();
    p.inject(screenHtml());
    p.advance(5000); // the page's own click: mark set, then .click()
    expect(marksSet(p)).toHaveLength(1);
    // the navigation never reached /lg/lc (aborted); the visitor now clicks the same card
    p.card(2).fire("click");
    // The browser follows the link only after the click event finished
    // dispatching (target, then the bubbling listener that clears the mark),
    // so the /lg/lc request carries no mark.
    expect(p.cookieWrites[p.cookieWrites.length - 1], "cleared before the browser follows the link").toBe(CLEAR);
  });
});

