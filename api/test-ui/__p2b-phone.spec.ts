// LeadGen Round-4 Remediation — Phase P2 slice P2b probe spec (temporary; final
// consolidation lands in P7). Proves the phone-format presets (A-6b) end to end
// on the REAL served funnel: a Phone field is AUTHORED with each preset through
// the admin API (the studio Accept/preset picker lands in P2c), the funnel is
// activated on a tenant host, and the LIVE runtime is driven with real
// fill/click (ZERO dispatchEvent) — an invalid number blocks Continue with the
// PRESET'S message; a valid one advances. Four presets: nanp | e164_intl | il |
// {custom}. The whole pipeline runs: content-schema save-gate → config-dto
// compile (client_validation.phone) → runtime generic checker.
//
// chromium-only (playwright.config.ts: firefox testMatch is the gesture set;
// this non-gesture spec is picked up by chromium alone, like __p1b-render). The
// dynamic {uniq}.e2e.test host needs chromium's --host-resolver-rules.

import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { seedActiveSite } from "./listicles-p6-seed";
import { PW_PORT } from "./utils/base-url";

test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] } });

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const LG_API = "/api/admin/leadgen";
const SHOT_DIR = "test-artifacts/leadgen-p2b";

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

interface Seeded { host: string; slug: string; }

const CONTINUE = { type: "ContinueButton", question_id: "cont", props: { label: "Continue" } };
// A trivial SECOND section so a passing Continue has somewhere to advance TO
// (the last section's Continue triggers funnel completion, not a section bump).
const NEXT = {
  section_name: "Next",
  headline_text: "Step 2",
  content_json: JSON.stringify({ components: [{ type: "TwoButtonYesNo", question_id: "qn9", internal_field: "z9" }] }),
};

// Seed an ACTIVE tenant + activated funnel carrying a phone section (the given
// preset) then the NEXT section — the leadgen-p4b-validation seeding recipe. The
// POST /sections itself IS the save-gate proof: an unaccepted phone_format would
// 400 here (content-schema.validateNewFieldProps).
async function seedPhoneFunnel(request: APIRequestContext, tag: string, phoneFormat: unknown): Promise<Seeded> {
  const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const host = `lg-p2b-${tag}-${uniq}.e2e.test`;
  const siteId = await seedActiveSite(request, host, `P2b ${tag} ${uniq}`);
  const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
    await request.post(`${LG_API}/quotes`, { data: { quote_name: `P2b ${tag} ${uniq}`, activity: "quote_funnel", verticals: ["life"] } }),
    "quote create",
  );
  const variantId = quote.funnels[0]!.variants[0]!.public_id;
  const phoneSection = await json<{ id: number }>(
    await request.post(`${LG_API}/sections`, {
      data: {
        activity: "quote_funnel",
        vertical: "life",
        status: "active",
        section_name: `Phone ${tag}`,
        headline_text: "Your phone",
        content_json: JSON.stringify({
          components: [
            { type: "PhoneInputQuestion", question_id: "q1", internal_field: "phone", required: true, props: { phone_format: phoneFormat } },
            CONTINUE,
          ],
        }),
      },
    }),
    `phone section create (${tag})`,
  );
  const nextSection = await json<{ id: number }>(
    await request.post(`${LG_API}/sections`, { data: { activity: "quote_funnel", vertical: "life", status: "active", ...NEXT } }),
    "NEXT section create",
  );
  await json(
    await request.put(`${LG_API}/variants/${variantId}`, {
      data: { sections: [{ section_id: phoneSection.id }, { section_id: nextSection.id }] },
    }),
    "variant sections",
  );
  await json(await request.put(`${LG_API}/quotes/${quote.public_id}/activation/${siteId}`, { data: { enabled: true, slug: tag } }), "activation");
  return { host, slug: tag };
}

const shellUrl = (s: Seeded) => `http://${s.host}:${PW_PORT}/lg/${s.slug}`;

function sectionIndex(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __LG_ENGINE__: { getState(): { section_index: number } } }).__LG_ENGINE__.getState().section_index);
}
async function ready(page: Page): Promise<void> {
  await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 8_000 });
}

test.beforeAll(() => { mkdirSync(SHOT_DIR, { recursive: true }); });

// [tag, preset, invalidInput, validInput, messageSubstring]
const PRESETS: Array<[string, unknown, string, string, string]> = [
  ["nanp", "nanp", "1111111111", "(415) 555-1234", "valid US phone"],
  ["e164intl", "e164_intl", "0541234567", "+972541234567", "country code"],
  ["il", "il", "+972541234567", "054-123-4567", "Israeli"],
  ["custom", { custom: { regex: "^[0-9]{4}$", mask: "____", message: "Enter your 4-digit PIN." } }, "12", "1234", "4-digit PIN"],
];

for (const [tag, preset, invalidInput, validInput, msgSubstring] of PRESETS) {
  test.describe(`P2b A-6b — phone preset '${tag}' blocks invalid / passes valid on the LIVE funnel`, () => {
    let seeded: Seeded;
    test.beforeAll(async () => {
      const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
      seeded = await seedPhoneFunnel(ctx, tag, preset);
      await ctx.dispose();
    });

    test(`invalid ${JSON.stringify(invalidInput)} blocks Continue with the preset message; valid ${JSON.stringify(validInput)} advances`, async ({ page }) => {
      await page.goto(shellUrl(seeded), { waitUntil: "load" });
      await ready(page);
      expect(await sectionIndex(page), "start on the phone section").toBe(0);

      // invalid → blocked + the preset's message paints the auto error slot.
      await page.locator('[data-lg-index="0"] [data-lg-input]').first().fill(invalidInput);
      await page.locator('[data-lg-index="0"] [data-lg-continue]').first().click();
      await page.waitForTimeout(300);
      expect(await sectionIndex(page), `invalid ${tag} phone must block Continue`).toBe(0);
      const slot = page.locator('[data-lg-index="0"] [data-lg-error-for="phone"]');
      await expect(slot).toBeVisible();
      await expect(slot).toContainText(msgSubstring);
      await page.screenshot({ path: `${SHOT_DIR}/${tag}-invalid.png`, fullPage: true });

      // valid → the error clears and the funnel advances to the NEXT section.
      await page.locator('[data-lg-index="0"] [data-lg-input]').first().fill(validInput);
      await page.locator('[data-lg-index="0"] [data-lg-continue]').first().click();
      await expect.poll(() => sectionIndex(page), { timeout: 5_000 }).toBe(1);
    });
  });
}
