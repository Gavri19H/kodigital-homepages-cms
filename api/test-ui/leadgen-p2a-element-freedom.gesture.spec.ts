// Section Builder product-core P2a — PER-ELEMENT FREEDOM effect gate (register
// PC-11 completion / decision R-A). The operator's case, authored via API and
// measured in the REAL render: a ButtonAnswerGroup whose "Allow" choice is
// larger + a theme-palette color + strong, next to an unstyled "Disallow" (the
// theme default), plus a deliberate OFF-THEME #hex "Delete" button.
//
// EXPECTED-VALUE assertions (never a bare "changed"), on the studio canvas (the
// surface the operator edits) AND the live /lg funnel (§12 parity — the SAME
// server renderer). Mirrors leadgen-p1-geometry.gesture.spec.ts's structure:
// studio-canvas describe runs on BOTH chromium+firefox; the live-/lg describe's
// dynamic {uniq}.e2e.test host needs chromium's --host-resolver-rules, so it
// test.skip()s on firefox (firefox's network.dns.localDomains cannot resolve a
// wildcard host — the repo-wide constraint the live-funnel specs document).
//
// WHAT THIS SLICE (P2a) PROVES GREEN, presets-only:
//   • per-choice min-height (size:l → the styled choice is taller than the
//     unstyled one — in a single-column group each button owns its own grid row);
//   • per-choice emphasis (strong → font-weight 700);
//   • per-choice text color (a DIRECT inline `color`, resting-safe);
//   • per-choice resting-bg EMISSION: the choice carries the state-safe custom
//     property --lg-answer-bg == the resolved role/#hex EXACTLY (role via the
//     §9.4 pipeline; off-theme #hex verbatim);
//   • diff-only: the unstyled sibling carries NONE of the above;
//   • the SELECTED pipeline is intact + the resting override does NOT leak into
//     it (click → the theme selected wash, not the per-choice resting color).
//
// CROSS-FILE (styles.ts, a SIBLING slice — see the P2a report): the RESTING
// background-color PAINT (computed) equals the emitted --lg-answer-bg only once
// designs/default-funnel/styles.ts's `.lg-btn.lg-btn-answer` / `.lg-card`
// RESTING rules read `background: var(--lg-answer-bg, <token>)` (the
// --lg-field-border idiom). Until then the var is EMITTED (asserted here) but
// the theme default still paints (also asserted here — the additive/back-compat
// invariant). The one computed-background PAINT assertion is documented at that
// seam. Multi-column per-choice HEIGHT variation likewise needs the grid's
// `align-items:start` (styles.ts) — this gate uses a single-column group where
// the effect is visible presets-only.
//
// Run per-file with the fresh-D1 preamble:
//   pkill -f "wrangler dev"; pkill -f workerd; sleep 2; \
//   rm -rf .wrangler/state/v3/d1 && npm run db:migrate:local && npm run seed:local
//   PW_PORT=8899 npx playwright test test-ui/leadgen-p2a-element-freedom.gesture.spec.ts \
//     --project=chromium --workers=1 --reporter=line
//   PW_PORT=8899 npx playwright test test-ui/leadgen-p2a-element-freedom.gesture.spec.ts \
//     --project=firefox --workers=1 --reporter=line
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { defaultFunnelDesign as D } from "../src/public/leadgen/designs/default-funnel/tokens";
import { baseTokenForRole } from "../src/public/leadgen/designs/theme";
import { seedActiveSite } from "./listicles-p6-seed";

const LG_API = "/api/admin/leadgen";
const uniq = Date.now();
const PORT = process.env.PW_PORT ?? "8899";

test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] } });

// Resolved through the SAME pipeline the renderer uses (no drift from tokens).
const ACCENT_HEX = baseTokenForRole(D, "accent"); // #E85D26 (the operator's orange)
const OFF_THEME_HEX = "#D92D20"; // deliberate off-theme red (not in the palette)
const RESTING_WHITE = "rgb(255, 255, 255)"; // color.card — the answer-button resting bg
const CARD_TEXT = "rgb(255, 255, 255)"; // text_color_role card_background (#FFFFFF)

// A single-column ButtonAnswerGroup so each button owns its own grid ROW → a
// per-choice min-height is honored independently (no same-row stretch-equalize;
// that multi-column case needs align-items:start in styles.ts, see header).
const COMPONENTS = [
  { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
  { type: "Subheadline", question_id: "q_sub", bind: "section_subheadline" },
  {
    type: "ButtonAnswerGroup",
    question_id: "q_perm",
    internal_field: "perm",
    answer_type: "enum",
    props: { columns: 1 },
    choices: [
      {
        label: "Allow",
        value: "allow",
        analytics_id: "al",
        style: { color_role: "accent", size: "l", emphasis: "strong", text_color_role: "card_background" },
      },
      { label: "Disallow", value: "disallow", analytics_id: "di" },
    ],
  },
  {
    type: "ButtonAnswerGroup",
    question_id: "q_warn",
    internal_field: "warn",
    answer_type: "enum",
    props: { columns: 1 },
    choices: [
      { label: "Delete", value: "del", analytics_id: "de", style: { color_hex: OFF_THEME_HEX } },
      { label: "Keep", value: "keep", analytics_id: "ke" },
    ],
  },
  { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
];

async function json<T>(res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> }, label: string): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}
interface Created { id: number; public_id: string; }
async function createSection(request: APIRequestContext, name: string): Promise<Created> {
  return json<Created>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: name,
        activity: "quote_funnel",
        vertical: "life",
        headline_text: "Delete this record?",
        subheadline_text: "This cannot be undone",
        continue_mode: "button",
        status: "active",
        content_json: { components: COMPONENTS },
      },
    }),
    `section create (${name})`,
  );
}

// Read the per-element computed facts for a choice button [data-value=v] inside
// a render root. answerBg is the CUSTOM PROPERTY value (raw, e.g. "#E85D26");
// color/backgroundColor/fontWeight are computed; height is boundingRect.
interface Facts { answerBg: string; color: string; backgroundColor: string; fontWeight: string; height: number; }
function readFacts(root: import("@playwright/test").Locator, v: string): Promise<Facts> {
  return root.locator(`[data-value="${v}"]`).evaluate((el: Element): Facts => {
    const cs = getComputedStyle(el as HTMLElement);
    return {
      answerBg: cs.getPropertyValue("--lg-answer-bg").trim(),
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      fontWeight: cs.fontWeight,
      height: (el as HTMLElement).getBoundingClientRect().height,
    };
  });
}

async function bootStudioCanvas(page: Page, s: Created): Promise<import("@playwright/test").Locator> {
  await page.goto(`/admin/leadgen/sections/${s.public_id}/edit`, { waitUntil: "domcontentloaded" });
  const frame = page.frameLocator("#lg-studio-canvas-frame");
  await expect(frame.locator('[data-value="allow"]')).toBeVisible({ timeout: 20_000 });
  // Return a Locator scoped to the canvas render root so readFacts can query it.
  return frame.locator("#lg-studio-canvas-render");
}

// ---------------------------------------------------------------------------
// STUDIO CANVAS — both engines
// ---------------------------------------------------------------------------
test.describe("P2a per-element freedom — studio canvas (both engines)", () => {
  let root: import("@playwright/test").Locator;
  test.beforeEach(async ({ page, request }) => {
    const s = await createSection(request, `p2a-canvas-${uniq}-${Math.random().toString(36).slice(2, 7)}`);
    root = await bootStudioCanvas(page, s);
  });

  test("Allow carries the resolved role as the state-safe --lg-answer-bg; Disallow carries none (diff-only)", async () => {
    const allow = await readFacts(root, "allow");
    const disallow = await readFacts(root, "disallow");
    expect(allow.answerBg).toBe(ACCENT_HEX); // role → resolved hex EXACTLY (emission)
    expect(disallow.answerBg).toBe(""); // unstyled sibling: no per-choice bg at all
  });

  test("the deliberate OFF-THEME #hex renders verbatim as --lg-answer-bg", async () => {
    expect((await readFacts(root, "del")).answerBg).toBe(OFF_THEME_HEX);
  });

  test("per-choice emphasis: Allow font-weight 700; Disallow is not bold (diff-only)", async () => {
    expect((await readFacts(root, "allow")).fontWeight).toBe("700");
    expect((await readFacts(root, "disallow")).fontWeight).not.toBe("700");
  });

  test("per-choice text color: Allow renders the resolved label color exactly", async () => {
    expect((await readFacts(root, "allow")).color).toBe(CARD_TEXT);
  });

  test("per-choice size: the styled Allow is taller than the unstyled Disallow (size:l floors 60px)", async () => {
    const allow = await readFacts(root, "allow");
    const disallow = await readFacts(root, "disallow");
    expect(allow.height).toBeGreaterThanOrEqual(60);
    expect(allow.height).toBeGreaterThan(disallow.height);
  });

  test("ADDITIVE/back-compat: emitting --lg-answer-bg does NOT change the painted resting bg (theme default until styles.ts reads the var — P2b seam)", async () => {
    // The var is EMITTED (asserted above) but the .lg-btn-answer RESTING rule
    // still paints color.card until styles.ts reads var(--lg-answer-bg,…). This
    // is the additive invariant; this assertion FLIPS to `toBe(ACCENT rgb)` the
    // moment the sibling styles.ts read lands.
    const allow = await readFacts(root, "allow");
    expect(allow.backgroundColor).toBe(RESTING_WHITE);
  });
});

// ---------------------------------------------------------------------------
// LIVE /lg FUNNEL — §12 parity + selected-state (chromium; firefox-skip)
// ---------------------------------------------------------------------------
test.describe("P2a per-element freedom — live /lg funnel (§12 parity + selected)", () => {
  test("live render carries the SAME per-element emission; selected wins while selected (resting override never leaks)", async ({ page, request, browserName }) => {
    test.skip(browserName === "firefox", "live /lg leg needs chromium --host-resolver-rules; firefox cannot resolve the dynamic e2e host — the studio-canvas describe above runs on BOTH engines");
    const host = `p2a-${uniq}.e2e.test`;
    const siteId = await seedActiveSite(request, host, `P2a Element Freedom ${uniq}`);
    const s = await createSection(request, `p2a-live-${uniq}`);
    const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
      await request.post(`${LG_API}/quotes`, { data: { quote_name: `P2a Live ${uniq}`, activity: "quote_funnel", verticals: ["life"] } }),
      "quote create",
    );
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    await json(await request.put(`${LG_API}/variants/${variantId}`, { data: { sections: [{ section_id: s.id }] } }), "variant sections");
    await json(await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug: "p2a" } }), "activation");

    await page.goto(`http://${host}:${PORT}/lg/p2a`, { waitUntil: "load" });
    const live = page.locator("body");
    await expect(live.locator('[data-value="allow"]')).toBeVisible({ timeout: 20_000 });

    // §12 parity: the live render carries the SAME per-element emission as the
    // studio canvas (the SAME server renderer).
    const allowResting = await readFacts(live, "allow");
    expect(allowResting.answerBg).toBe(ACCENT_HEX);
    expect(allowResting.fontWeight).toBe("700");
    expect(allowResting.height).toBeGreaterThan((await readFacts(live, "disallow")).height);

    // Selected pipeline INTACT + no-leak: clicking Allow marks it selected via
    // the runtime's real marker (.lg-selected class) — the styled button stays
    // interactive. And the per-choice resting color rides ONLY the
    // --lg-answer-bg channel: the styled button carries NEITHER --lg-sel-bg NOR
    // a bare `background:` inline, so it STRUCTURALLY cannot override the
    // selected-state rule (governed separately by the node's --lg-sel-bg /
    // the [aria-checked]/[data-selected] selectors) — "selected wins while
    // selected". The resting-channel var is unchanged by selection.
    const allowBtn = live.locator('[data-value="allow"]');
    await allowBtn.click();
    await expect(allowBtn).toHaveClass(/lg-selected/, { timeout: 10_000 });
    const styleAttr = (await allowBtn.getAttribute("style")) ?? "";
    expect(styleAttr).toContain("--lg-answer-bg");
    expect(styleAttr).not.toContain("--lg-sel-bg");
    expect(styleAttr).not.toContain("background:");
    expect((await readFacts(live, "allow")).answerBg).toBe(ACCENT_HEX);
  });
});
