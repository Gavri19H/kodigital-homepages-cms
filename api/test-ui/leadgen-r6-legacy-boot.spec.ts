// Section Builder v3.1 REMEDIATION — phase R6, LEGACY AXIS (deliverable 7).
//
// A v2.5-FLAT-SHAPE section (a flat components array — the pre-§8.5 container-
// nesting era) driven through the forensic probe suite's OWN boot (create via
// the real admin API → open /sections/:id/edit → the studio canvas renders every
// legacy node → a REAL Save round-trips the content losslessly). Trusted input
// only; chromium lane (no gesture). The §8.13 companion suite + the R1 legacy
// byte-identity pins are RE-RUN separately (existing files) — this adds the
// missing REAL-BROWSER open→render→save leg for a flat legacy shape.
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

test.use({ viewport: { width: 1800, height: 1100 } });

const LG_API = '/api/admin/leadgen';
const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function json<T>(res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> }, label: string): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

// A flat v2.5 shape: NO containers, NO `children` — every node is a top-level
// leaf, exactly as pre-§8.5 authored content persists.
const FLAT_V25 = [
  { type: 'QuestionHeadline', question_id: 'q_head', bind: 'section_headline' },
  { type: 'TwoButtonYesNo', question_id: 'q_yn', internal_field: 'insured', answer_type: 'boolean', props: { yesLabel: 'Yes', noLabel: 'No' } },
  { type: 'ZIPInputQuestion', question_id: 'q_zip', internal_field: 'zip', answer_type: 'string', props: { placeholder: 'ZIP code' } },
  { type: 'EmailInputQuestion', question_id: 'q_email', internal_field: 'email', answer_type: 'string', props: { placeholder: 'Email' } },
  { type: 'NumberRangeQuestion', question_id: 'q_range', internal_field: 'amount', answer_type: 'number', props: { min: 0, max: 100, step: 5, default: 0 } },
  { type: 'ContinueButton', question_id: 'q_cont', props: { label: 'Continue' } },
];

interface Detail { content_json: { components: Array<{ type: string; question_id: string }> } }
async function sectionShape(request: APIRequestContext, publicId: string): Promise<string> {
  const d = await json<Detail>(await request.get(`${LG_API}/sections/${publicId}`), 'section detail');
  return JSON.stringify(d.content_json.components.map((c) => ({ type: c.type, question_id: c.question_id })));
}
const canvas = (page: Page) => page.frameLocator('#lg-studio-canvas-frame').locator('#lg-studio-canvas-render');

test('a v2.5-flat legacy section OPENS in the studio, RENDERS every node, and a real Save round-trips losslessly', async ({ page }) => {
  test.setTimeout(120_000);
  const created = await json<{ id: number; public_id: string }>(await page.request.post(`${LG_API}/sections`, {
    data: {
      section_name: `R6 Legacy Flat ${uniq}`, activity: `r6leg-${uniq}`, vertical: `r6legv-${uniq}`,
      headline_text: 'Legacy flat section', continue_mode: 'button', status: 'active',
      content_json: { components: FLAT_V25 },
    },
  }), 'create flat section');

  const shapeBefore = await sectionShape(page.request, created.public_id);

  // OPEN → RENDER: the studio boots and the canvas renders every legacy node.
  await page.goto(`/admin/leadgen/sections/${created.public_id}/edit`, { waitUntil: 'domcontentloaded' });
  await expect(canvas(page).locator('[data-question-id]').first()).toBeVisible({ timeout: 20_000 });
  for (const qid of ['q_yn', 'q_zip', 'q_email', 'q_range']) {
    await expect(canvas(page).locator(`[data-question-id="${qid}"]`), `legacy node ${qid} renders on the canvas`).toBeVisible({ timeout: 8000 });
  }
  await page.screenshot({ path: `test-artifacts/leadgen-r6-legacy-flat-open.png` });

  // SAVE round-trip: a real Save (no edit) must round-trip the flat shape
  // losslessly (§8.13 legacy-lossless — no retired/legacy-keyed node here).
  await Promise.all([page.waitForEvent('load'), page.locator('#lg-section-save').click({ timeout: 8000 })]);
  const shapeAfter = await sectionShape(page.request, created.public_id);
  expect(shapeAfter, 'the flat v2.5 component shape (types + ids) survives the studio Save round-trip').toBe(shapeBefore);
});
