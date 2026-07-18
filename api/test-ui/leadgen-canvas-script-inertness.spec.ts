// Section Builder v3.1 — U13 canvas script-inertness gate (2026-07-15).
//
// The U13 fix grants the studio canvas srcdoc iframe sandbox="allow-scripts"
// so Chromium delivers held-button page.mouse streams (the operator's dead-drag
// root cause). That scripting grant would be a fresh XSS surface WITHOUT the
// in-document CSP that neutralizes it, so this gate proves — end to end,
// through the REAL producer (POST /sections) → studio render → live canvas —
// that a section carrying hostile author payloads is fully inert:
//   (i)   the canvas srcdoc head's FIRST element after the charset meta is the
//         Content-Security-Policy meta, with EXACTLY the three directives
//         (script-src 'none'; object-src 'none'; base-uri 'none'); only our own
//         fixed bytes precede it (all author content lands in <body>).
//   (ii)  NONE of the payload __pwned flags exist on the top window — no inline
//         <script>, on* handler, javascript: URL or <svg><script> executed.
//   (iii) every payload renders ESCAPED (primary defense intact) — it appears as
//         literal text and NO <script> element exists anywhere in the canvas.
//   (iv)  clicking the rendered hostile text still SELECTS the component — a
//         discrete click delivers across the boundary (delivery works), which
//         is the whole point of the sandbox change.
//
// PLAIN .spec.ts → runs ONLY under the chromium project (the engine whose
// scripting-grant XSS surface this must close; firefox's testMatch pins the
// gesture-only lane and does not include this file).
//
// Run per-file (from api/), with the fresh-D1 preamble:
//   pkill -f "wrangler dev"; pkill -f workerd; pkill -f cms-panel; sleep 2; \
//   npm run db:reset:local
//   npx playwright test test-ui/leadgen-canvas-script-inertness.spec.ts \
//     --project=chromium --workers=1 --reporter=line --timeout=60000
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const LG_API = "/api/admin/leadgen";
const uniq = Date.now();

// Each payload targets a distinct script vector; its __pwnedN flag is what a
// SUCCESSFUL injection would set on window.top. All must stay unset.
const PAYLOADS: ReadonlyArray<{ qid: string; flag: string; text: string }> = [
  { qid: "q_x1", flag: "__pwned", text: "<script>window.top.__pwned=1</script>" },
  { qid: "q_x2", flag: "__pwned2", text: 'tap onclick="window.top.__pwned2=1" now' },
  { qid: "q_x3", flag: "__pwned3", text: '<img src=x onerror="window.top.__pwned3=1">' },
  { qid: "q_x4", flag: "__pwned4", text: '<a href="javascript:window.top.__pwned4=1">js</a>' },
  { qid: "q_x5", flag: "__pwned5", text: "<svg><script>window.top.__pwned5=1</script></svg>" },
];

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}
interface Created { id: number; public_id: string; }

async function createHostileSection(request: APIRequestContext): Promise<Created> {
  return json<Created>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: `u13-inertness-${uniq}`,
        activity: `u13-act-${uniq}`,
        vertical: `u13-vert-${uniq}`,
        headline_text: "Pick your coverage",
        subheadline_text: "Choose one",
        continue_mode: "button",
        status: "active",
        content_json: {
          components: [
            { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
            ...PAYLOADS.map((p) => ({ type: "TextBlock", question_id: p.qid, props: { text: p.text, role: "body" } })),
            { type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip", answer_type: "string", props: { placeholder: "ZIP code" } },
            { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
          ],
        },
      },
    }),
    "hostile section create",
  );
}

async function boot(page: Page, s: Created): Promise<void> {
  await page.goto(`/admin/leadgen/sections/${s.public_id}/edit`, { waitUntil: "domcontentloaded" });
  await expect(page.frameLocator("#lg-studio-canvas-frame").locator('[data-question-id="q_x3"]')).toBeVisible({ timeout: 20_000 });
}

test.describe("U13 — canvas script-inertness: allow-scripts + script-src 'none' CSP is safe", () => {
  test("hostile author payloads are inert (CSP present, no __pwned flags, escaped render), yet clicks still select", async ({ page, request }) => {
    const s = await createHostileSection(request);
    await boot(page, s);

    // Read the canvas srcdoc head structure + body text + script count from the
    // same-origin contentDocument in one pass.
    const probe = await page.evaluate(() => {
      const iframe = document.getElementById("lg-studio-canvas-frame") as HTMLIFrameElement | null;
      const doc = iframe && iframe.contentDocument;
      if (!doc || !doc.head) return { ok: false as const };
      const headEls = Array.from(doc.head.children);
      const charsetIdx = headEls.findIndex((el) => el.tagName === "META" && el.hasAttribute("charset"));
      const afterCharset = charsetIdx >= 0 ? headEls[charsetIdx + 1] : null;
      const isCsp =
        !!afterCharset &&
        afterCharset.tagName === "META" &&
        afterCharset.getAttribute("http-equiv") === "Content-Security-Policy";
      return {
        ok: true as const,
        charsetIsFirst: charsetIdx === 0,
        cspIsFirstAfterCharset: isCsp,
        cspContent: isCsp ? afterCharset!.getAttribute("content") : null,
        scriptCount: doc.querySelectorAll("script").length,
        bodyText: doc.body ? doc.body.textContent || "" : "",
      };
    });
    expect(probe.ok, "canvas contentDocument is same-origin readable (sandbox allow-same-origin)").toBe(true);
    if (!probe.ok) return;

    // (i) CSP meta is FIRST after the (head-first) charset meta, exactly 3 directives.
    expect(probe.charsetIsFirst, "the charset meta is the head's first child (only our own fixed bytes precede the CSP)").toBe(true);
    expect(probe.cspIsFirstAfterCharset, "the CSP meta is the FIRST element after the charset meta").toBe(true);
    expect(probe.cspContent).toBe("script-src 'none'; object-src 'none'; base-uri 'none'");
    const directives = (probe.cspContent || "").split(";").map((d) => d.trim()).filter(Boolean);
    expect(directives, `exactly three directives: ${directives.join(" | ")}`).toEqual([
      "script-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
    ]);

    // (iii) primary defense: every payload renders ESCAPED (as literal text) and
    // NO <script> element exists anywhere in the canvas.
    expect(probe.scriptCount, "no <script> element was injected into the canvas (author text was escaped)").toBe(0);
    for (const p of PAYLOADS) {
      expect(probe.bodyText.includes(p.text), `payload for ${p.qid} renders ESCAPED (literal text present): ${p.text}`).toBe(true);
    }

    // (ii) no __pwned flag was set on the top window by ANY vector.
    const flagsSet = await page.evaluate(
      (flags) => flags.filter((f) => (window as unknown as Record<string, unknown>)[f] !== undefined),
      PAYLOADS.map((p) => p.flag),
    );
    expect(flagsSet, `no injection flag set on window.top (any present = XSS): [${flagsSet.join(",")}]`).toEqual([]);

    // (iv) clicking the rendered hostile text still SELECTS the component
    // (discrete click delivery across the boundary — the reason the sandbox
    // change is safe AND functional).
    const frame = page.frameLocator("#lg-studio-canvas-frame");
    await frame.locator('[data-question-id="q_x3"]').click({ timeout: 8000 });
    await expect(
      frame.locator('[data-question-id="q_x3"]'),
      "the clicked hostile TextBlock becomes the selected node (studio-selected-node)",
    ).toHaveClass(/studio-selected-node/, { timeout: 8000 });
  });
});
