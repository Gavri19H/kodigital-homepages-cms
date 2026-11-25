import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { LgComponentConfig, LgPublicConfig, LgSectionConfig } from "../src/public/leadgen/runtime/state";
import { miniDocument, MiniNode } from "./helpers/mini-dom";

// Like the vehicle runtime suite, load the browser entry without importing DOM
// types into the Worker TypeScript project. Boot through the real inline config.
const engineModule = "../src/public/leadgen/runtime/engine";
let boot: () => Promise<void>;
beforeAll(async () => { ({ bootLeadgenRuntime: boot } = await import(/* @vite-ignore */ engineModule)); });
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const landing = new URL("https://site.test/lg/quote?utm_source=a%20b&sub1=c");
const vid = "lgn_entry";
const requestUrl = "/lg/attempt?vid=" + vid + "&u=" + encodeURIComponent(landing.href);
const getOptions = { method: "GET", headers: { accept: "application/json" }, credentials: "same-origin", cache: "no-store" } as const;
const identity = { funnel_attempt_id: "att_minted", signed_config_token: "v2.signed", session_id: "server-sid" };
const tuple = { funnel_variant_id: vid, content_version: 1, section_order_hash: "order" };
const notice = "We're having trouble loading the next step. Please check your connection and try again.";
const zip: LgComponentConfig = { question_id: "zip", type: "ZIPInputQuestion", internal_field: "zip", required: true, props: {} };

function section(index: number, components: LgComponentConfig[] = []): LgSectionConfig {
  return {
    section_index: index, section_public_id: "sec" + index, headline: "Step " + index, continue_mode: "button",
    section_mapping_version: 1, answer_mapping_version: "1", address_validation_enabled: false, components,
  };
}

function winner(sectionIndex: number, page = sectionIndex) {
  return { page_id: "page" + page, section_public_id: "sec" + sectionIndex, slot_id: sectionIndex + 1, assignment_reason: "fixed" };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => { resolve = fulfill; });
  return { promise, resolve };
}

type EventRow = Record<string, unknown>;
interface EngineWindow {
  __LG_ATTEMPT_P__?: { vid: string; p: Promise<unknown> };
  __LG_ENGINE__?: {
    getState(): { section_index: number; back_stack: number[]; funnel_attempt_id: string };
    getAnswers(): Record<string, unknown>;
  };
}

function setup(sections = [section(0, [zip]), section(1)], vehicle?: LgPublicConfig["vehicle"]) {
  const config: LgPublicConfig = {
    ...tuple, sections, vehicle, quote_id: "lgq_quote", funnel_id: "lgf_funnel", funnel_name: "Quote",
    funnel_design_id: "default", design_tokens: {}, ga4_measurement_id: null, funnel_ab_test_id: "split",
    funnel_ab_test_revision: 2, traffic_allocation_bp: 5000, variant_label: "A", assignment_reason: "ab_hash",
  };
  const markup = sections.map((s, i) => {
    const fields = s.components.map((c) => {
      const control = c.type === "TwoButtonYesNo" ? '<button data-lg-choice="yes">Yes</button>' : '<input data-lg-input>';
      return `<div data-lg-question="${c.question_id}" data-lg-field="${c.internal_field}">${control}
        <span data-lg-error-for="${c.internal_field}" hidden></span></div>`;
    }).join("");
    return `<section data-lg-section data-lg-index="${i}" data-lg-section-id="${s.section_public_id}" ${i ? "hidden" : ""}>
      ${fields}<button data-lg-continue>Continue</button></section>`;
  }).join("");
  const doc = miniDocument(`<main id="lg-funnel-root">${markup}
    <div data-lg-node="cta" data-lg-cta-condition hidden></div></main>
    <script id="lg-config" type="application/json">${JSON.stringify(config)}</script>`);
  const root = doc.getElementById("lg-funnel-root")!;
  for (const node of doc.root.all()) Object.assign(node, { ownerDocument: doc });
  Object.assign(root, { contains: (node: MiniNode) => node === root || root.all().includes(node) });
  const storage = new Map<string, string>();
  const win: EngineWindow & { sessionStorage: unknown } = { sessionStorage: {
    get length() { return storage.size; },
    key: (i: number) => [...storage.keys()][i] ?? null,
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", Object.assign(doc, { cookie: "ko_sid=client-sid", referrer: "" }));
  vi.stubGlobal("location", landing);
  vi.stubGlobal("navigator", { language: "en" });
  for (const name of ["HTMLElement", "HTMLInputElement", "Element"]) vi.stubGlobal(name, MiniNode);

  const attempt = deferred<Response>();
  const checkpoint = deferred<Response>();
  const checkpoints: EventRow[] = [];
  const auctions: EventRow[] = [];
  const events: EventRow[] = [];
  const fetchMock = vi.fn(async (url: string, options?: RequestInit): Promise<Response> => {
    if (url.startsWith("/lg/attempt?")) return attempt.promise;
    const body = JSON.parse(String(options?.body)) as EventRow;
    if (url === "/lg/ck") { checkpoints.push(body); return checkpoint.promise; }
    if (url === "/lg/auction") { auctions.push(body); return Response.json({ unfilled: true }); }
    if (url !== "/lg/track") throw new Error("Unexpected request " + url);
    events.push(...body["events"] as EventRow[]);
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal("fetch", fetchMock);
  function type(value: string, field = "zip") {
    const input = root.querySelector(`[data-lg-question="${field}"] [data-lg-input]`)!;
    input.value = value;
    input.fire("input");
    return input;
  }
  return {
    win, root, attempt, checkpoint, storage, checkpoints, auctions, events, fetchMock, type,
    api: () => win.__LG_ENGINE__!,
    next: (index = 0) => root.querySelector(`[data-lg-index="${index}"] [data-lg-continue]`)!.click(),
    gets: () => fetchMock.mock.calls.filter(([url]) => url.startsWith("/lg/attempt?")),
  };
}

describe("quote input while /lg/attempt is in flight", () => {
  it("accepts typing and validates immediately, then honors a valid first Continue exactly once", async () => {
    const h = setup();
    const bound = boot();
    expect(h.root.getAttribute("data-lg-ready")).toBe("1");
    expect(h.gets()).toEqual([[requestUrl, getOptions]]);
    h.next();
    expect(h.root.querySelector("[data-lg-input]")?.getAttribute("aria-invalid")).toBe("true");
    expect(h.type("90210").hasAttribute("aria-invalid")).toBe(false);
    expect(h.api().getAnswers()).toEqual({ zip: "90210" });
    h.next();
    h.next();
    await vi.advanceTimersByTimeAsync(1000); // answer_change and the beacon flush window
    expect(h.api().getState().funnel_attempt_id).toBe("");
    expect(h.events).toEqual([]);
    expect(h.storage.size).toBe(0);
    expect(h.checkpoints).toEqual([]);
    expect(h.auctions).toEqual([]);

    h.attempt.resolve(Response.json({ ...identity, page_plan: [winner(0), winner(1)] }));
    await bound;
    expect(h.api().getState()).toMatchObject({ section_index: 1, back_stack: [0] });
    expect(h.root.querySelector('[data-lg-index="1"]')?.hidden).toBe(false);
    expect(h.auctions).toEqual([]);
    await vi.advanceTimersByTimeAsync(800);
    expect(h.events.map((e) => e.event_type)).toEqual([
      "quote_view", "section_view", "continue_click", "validation_error", "continue_click", "continue_click",
      "answer_change", "section_continue", "section_view",
    ]);
    const bucket = createHash("sha256").update("split:2:client-sid").digest().readUInt32BE(0) % 10000;
    for (const event of h.events) {
      expect(event).toMatchObject({
        funnel_attempt_id: identity.funnel_attempt_id, session_id: identity.session_id,
        funnel_variant_id: vid, assignment_bucket: String(bucket), utm_source: "a b",
        page_id: event.section_id === "sec0" ? "page0" : "page1",
      });
    }
  });

  it("a tap confirms a default immediately and auto-advances once on the resolved single-section page", async () => {
    const choice: LgComponentConfig = {
      type: "TwoButtonYesNo", question_id: "choice", internal_field: "choice", props: {},
      default_answer: { value: "yes", answer_source: "default_applied" },
    };
    const h = setup([{ ...section(0, [choice]), continue_mode: "auto_advance" }, section(1)]);
    const bound = boot();
    h.root.querySelector("[data-lg-choice]")!.click();
    expect(h.api().getAnswers()).toEqual({ choice: "yes" });
    expect(h.root.querySelector("[data-lg-choice]")!.getAttribute("aria-checked")).toBe("true");
    h.attempt.resolve(Response.json({ ...identity, page_plan: [winner(0), winner(1)] }));
    await bound;
    expect(h.api().getState()).toMatchObject({ section_index: 1, back_stack: [0] });
    await vi.advanceTimersByTimeAsync(800);
    expect(h.events.map((e) => e.event_type)).toEqual([
      "answer_default_applied", "quote_view", "section_view", "answer_click", "section_continue", "section_view",
    ]);
    expect(h.events.find((e) => e.event_type === "answer_click")).toMatchObject({
      answer_source: "user_confirmed_default", funnel_attempt_id: identity.funnel_attempt_id, page_id: "page0",
    });
  });

  it("reveals a follow-up question from the inline config while the attempt is still pending", async () => {
    const followUp = { ...zip, question_id: "street", internal_field: "street", type: "FreeTextQuestion",
      conditional: { when: "zip", op: "eq" as const, value: "90210" } };
    const h = setup([section(0, [zip, followUp])]);
    const bound = boot();
    const field = h.root.querySelector('[data-lg-question="street"]')!;
    expect(field.hidden).toBe(true);
    h.type("90210");
    expect(field.hidden).toBe(false);
    h.type("Main St", "street");
    expect(h.api().getAnswers()).toEqual({ zip: "90210", street: "Main St" });
    expect(h.api().getState().funnel_attempt_id).toBe("");
    h.attempt.resolve(Response.json(identity));
    await bound;
    expect(h.api().getAnswers()).toEqual({ zip: "90210", street: "Main St" });
  });

  it.each([false, true])("the same shell has a different valid next step when its sections share a page (%s)", async (grouped) => {
    const h = setup(); // Both cases serialize the identical config and section markup.
    const bound = boot();
    h.type("90210");
    h.next();
    h.attempt.resolve(Response.json({ ...identity, page_plan: [winner(0), winner(1, grouped ? 0 : 1)] }));
    await bound;
    expect(h.api().getState().section_index).toBe(grouped ? 0 : 1);
    expect(h.root.querySelector('[data-lg-index="0"]')!.hidden).toBe(!grouped);
    expect(h.root.querySelector('[data-lg-index="1"]')!.hidden).toBe(false);
    expect(h.auctions).toEqual([]);
  });

  it("uses the shell's one GET and waits for both the mint and the checkpoint before submitting the auction", async () => {
    const h = setup([section(0, [zip])]);
    h.win.__LG_ATTEMPT_P__ = { vid, p: fetch(requestUrl, getOptions).then((r) => r.json()) };
    const bound = boot();
    expect(h.win.__LG_ATTEMPT_P__).toBeUndefined();
    h.type("90210");
    h.next();
    h.next();
    expect(h.checkpoints).toEqual([]);
    expect(h.auctions).toEqual([]);
    h.attempt.resolve(Response.json({ ...identity, page_plan: [winner(0)], cps: ["sec0"], cc: ["cta"] }));
    await bound;
    expect(h.root.querySelector("[data-lg-cta-condition]")?.hidden).toBe(false);
    expect(h.gets()).toEqual([[requestUrl, getOptions]]);
    expect(h.checkpoints).toEqual([{
      f: identity.funnel_attempt_id, k: identity.signed_config_token, s: identity.session_id,
      v: vid, a: { zip: { value: "90210", answer_source: "user_selected" } },
    }]);
    expect(h.auctions).toEqual([]);
    h.checkpoint.resolve(Response.json({
      sw: true, k: "v2.switched", v: "lgn_target", so: "targetOrder", cv: 2,
      ar: "routing_rule:target", pp: [winner(0)], r: "", cc: [],
    }));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.root.querySelector("[data-lg-cta-condition]")?.hidden).toBe(true);
    expect(h.auctions).toHaveLength(1);
    expect(h.auctions[0]).toMatchObject({
      ...identity, signed_config_token: "v2.switched", funnel_variant_id: "lgn_target", content_version: 2,
      section_order_hash: "targetOrder", answers: { zip: { value: "90210", answer_source: "user_selected" } },
    });
  });

  it("an early final submit uses the newly bound id and token", async () => {
    const h = setup([section(0, [zip])]);
    const bound = boot();
    h.type("10001");
    h.next();
    expect(h.auctions).toEqual([]);
    h.attempt.resolve(Response.json(identity));
    await bound;
    expect(h.auctions).toHaveLength(1);
    expect(h.auctions[0]).toMatchObject({ ...identity, answers: { zip: { value: "10001" } } });
  });

  it("rechecks a pending submit if the visitor edits the answer again", async () => {
    const h = setup([section(0, [zip])]);
    const bound = boot();
    h.type("10001");
    h.next();
    const input = h.type("");
    h.attempt.resolve(Response.json(identity));
    await bound;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(h.api().getAnswers()).toEqual({ zip: "" });
    expect(h.auctions).toEqual([]);
  });

  it("restores the same tuple and back stack while the visitor's edited field wins", async () => {
    const h = setup();
    const saved = { answer_source: "user_selected", question_id: "zip", section_public_id: "sec0", answered_at: 1 };
    const snapshot = { v: 1, tuple, section_index: 1, back_stack: [0], saved_at: 1,
      answers: { zip: { ...saved, value: "10001" }, other: { ...saved, question_id: "other", value: "keep" } } };
    h.storage.set("lg:old", JSON.stringify(snapshot));
    h.storage.set("lg:stale", JSON.stringify({ ...snapshot, tuple: { ...tuple, content_version: 2 } }));
    const bound = boot();
    const input = h.type("90210");
    h.next();
    h.attempt.resolve(Response.json(identity));
    await bound;
    expect(h.api().getState()).toMatchObject({ section_index: 1, back_stack: [0] });
    expect(h.api().getAnswers()).toEqual({ zip: "90210", other: "keep" });
    expect(input.value).toBe("90210");
    expect([...h.storage.keys()]).toEqual(["lg:" + identity.funnel_attempt_id]);
    expect(JSON.parse([...h.storage.values()][0]!)).toMatchObject({ answers: { zip: { value: "90210" }, other: { value: "keep" } } });
    expect(h.auctions).toEqual([]); // the first page's queued click cannot submit the restored second page
  });

  it("revalidates against the winning page, its required sibling and late visitor context", async () => {
    const phone = { ...zip, type: "FreeTextQuestion", question_id: "contact", internal_field: "contact",
      conditional: { when: "__device", op: "eq" as const, value: "phone" } };
    const h = setup([section(0, [zip]), section(1, [phone]), section(2)]);
    const bound = boot();
    h.type("90210");
    h.next();
    h.attempt.resolve(Response.json({ ...identity, ctx: { device: "phone" }, page_plan: [winner(0), winner(1, 0), winner(2)] }));
    await bound;
    expect(h.api().getState().section_index).toBe(0);
    expect(h.root.querySelector('[data-lg-index="1"]')?.hidden).toBe(false);
    expect(h.root.querySelector('[data-lg-index="0"] [data-lg-continue]')?.hidden).toBe(true);
    h.next(1);
    expect(h.root.querySelector('[data-lg-question="contact"] [data-lg-input]')?.getAttribute("aria-invalid")).toBe("true");
    h.type("555", "contact");
    h.next(1);
    expect(h.api().getState().section_index).toBe(2);
  });

  it("returns to the authoritative first section when late context makes it visible", async () => {
    const gated = { ...zip, conditional: { when: "__state", op: "eq" as const, value: "CA" } };
    const h = setup([section(0, [gated]), section(1)]);
    const bound = boot();
    expect(h.api().getState().section_index).toBe(1);
    h.next(1);
    h.attempt.resolve(Response.json({ ...identity, ctx: { state: "CA" } }));
    await bound;
    expect(h.api().getState().section_index).toBe(0);
    expect(h.root.querySelector('[data-lg-index="0"]')!.hidden).toBe(false);
    expect(h.auctions).toEqual([]);
  });

  it("keeps an edit to a losing slot out of routing until its own section is selected", async () => {
    const h = setup([section(0, [zip]), section(1), section(2)]);
    const bound = boot();
    const input = h.type("90210");
    h.next();
    h.attempt.resolve(Response.json({ ...identity, page_plan: [winner(1), winner(2)], cps: ["sec1"] }));
    await bound;
    expect(h.api().getState().section_index).toBe(1);
    expect(input.value).toBe("90210");
    expect(h.checkpoints).toEqual([]);
    h.next(1);
    expect(h.checkpoints).toHaveLength(1);
    expect(h.checkpoints[0]?.a).toEqual({});
    h.checkpoint.resolve(Response.json({
      sw: true, k: "target-token", v: "lgn_target", so: "new-order", cv: 2,
      ar: "routing_rule:target", pp: [winner(0)], r: "sec0",
    }));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.api().getState().section_index).toBe(0);
    expect(h.api().getAnswers()).toEqual({ zip: "90210" });
    h.next();
    expect(h.auctions).toHaveLength(1);
    expect(h.auctions[0]).toMatchObject({
      funnel_attempt_id: identity.funnel_attempt_id, signed_config_token: "target-token",
      answers: { zip: { value: "90210", answer_source: "user_selected" } },
    });
  });

  it("a make typed before restore invalidates the old make's saved model", async () => {
    const field = (name: string) => ({
      question_id: name, type: "FreeTextQuestion", internal_field: name, required: true, props: {},
    });
    const h = setup([section(0, [field("make")]), section(1, [field("model")])], { snapshot: "v1", base: "/lg/vehicles" });
    h.root.querySelector('[data-lg-field="make"]')!.setAttribute("data-lg-vehicle", "make");
    const model = h.root.querySelector('[data-lg-field="model"]')!;
    model.setAttribute("data-lg-vehicle", "model");
    model.setAttribute("data-lg-vmake", "make");
    const saved = { answer_source: "user_selected", answered_at: 1 };
    h.storage.set("lg:old", JSON.stringify({ v: 1, tuple, section_index: 0, back_stack: [], saved_at: 1,
      answers: {
        make: { ...saved, question_id: "make", section_public_id: "sec0", value: "Toyota" },
        model: { ...saved, question_id: "model", section_public_id: "sec1", value: "Camry" },
      },
    }));
    const bound = boot();
    h.type("Honda", "make");
    h.attempt.resolve(Response.json(identity));
    await bound;
    expect(h.api().getAnswers()).toEqual({ make: "Honda", make_snapshot: "v1" });
  });

  it("keeps a mismatched shell promise and ignores a replacement even on retry", async () => {
    const h = setup();
    const other = { vid: "another", p: Promise.resolve({ funnel_attempt_id: "wrong" }) };
    h.win.__LG_ATTEMPT_P__ = other;
    h.fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const bound = boot();
    expect(h.win.__LG_ATTEMPT_P__).toBe(other);
    h.win.__LG_ATTEMPT_P__ = { vid, p: Promise.resolve({ funnel_attempt_id: "wrong-retry" }) };
    h.attempt.resolve(Response.json(identity));
    await vi.advanceTimersByTimeAsync(800);
    await bound;
    expect(h.api().getState().funnel_attempt_id).toBe(identity.funnel_attempt_id);
    expect(h.gets()).toEqual([[requestUrl, getOptions], [requestUrl, getOptions]]);
  });

  it.each([null, { funnel_attempt_id: 7 }, { funnel_attempt_id: "" }])("retries invalid prefetch JSON (%j) with a fresh GET", async (raw) => {
    const h = setup();
    h.win.__LG_ATTEMPT_P__ = { vid, p: Promise.resolve(raw) };
    const bound = boot();
    h.attempt.resolve(Response.json(identity));
    await vi.advanceTimersByTimeAsync(799);
    expect(h.gets()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await bound;
    expect(h.gets()).toEqual([[requestUrl, getOptions]]);
    expect(h.api().getState().funnel_attempt_id).toBe(identity.funnel_attempt_id);
  });

  it("retains input through the two backoffs and shows the existing failure notice", async () => {
    const h = setup([section(0, [zip])]);
    h.fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    const bound = boot();
    h.type("90210");
    h.next();
    await vi.advanceTimersByTimeAsync(799);
    expect(h.gets()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2400);
    expect(h.gets()).toHaveLength(2);
    expect(h.root.querySelector('[role="alert"]')).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await bound;
    expect(h.gets()).toHaveLength(3);
    expect(h.root.querySelector('[role="alert"]')?.textContent).toBe(notice);
    expect(h.root.getAttribute("data-lg-ready")).toBe("1");
    expect(h.api().getAnswers()).toEqual({ zip: "90210" });
    expect(h.fetchMock.mock.calls.some(([url]) => url === "/lg/ck" || url === "/lg/auction")).toBe(false);
  });
});
