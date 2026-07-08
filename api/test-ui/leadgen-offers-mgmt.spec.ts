// LeadGen fix-contract v2.4 Phase 3 — the §7.7 OFFER-MANAGEMENT BROWSER flows
// (F4 audit remediation: the contract mandated Playwright flows; the shipped
// substitute was vitest HTML-string checks, which is exactly how two dead UI
// flows went green). Every scenario here drives the REAL admin pages in a
// REAL browser against the wrangler-dev webServer — no HTML string checks:
//
//   ① Duplicate (A2, §7.3): kebab → Duplicate; blank default-placement submit
//     is blocked INLINE with zero POSTs; a filled submit navigates the browser
//     to the NEW lgo_ editor (?duplicated_from=) with the "Duplicated from"
//     banner; the list shows the copy as paused + Untested.
//   ② Delete clean (A1, §7.2): type-the-offer-name-to-confirm gates the
//     button; confirm hard-deletes and the row leaves the list.
//   ③ Usage (A3, §7.4): an offer REFERENCED by a Section (selected through
//     the real sections admin API) → the Usage dialog lists the referencing
//     Section by name with its editor link.
//   ④ Delete blocked (A1/A3, §7.2/§7.4): hard delete of the referenced offer
//     → the blocked modal renders the usage report with the NON-ZERO kind
//     count + the clickable item link + "Archive instead", which archives.
//   ⑤ Region rules (D1/D2/D3, §7.5): the two labeled behaviors, the
//     "Evaluation order" label + help, ZIP paste-multiple with per-token
//     rejection, and chip persistence across Save + fresh SSR.
//   ⑥ Simulate (S1, §7.6): a REAL eligible dynamic offer (seedFixP1Funnel —
//     provider-log R4 row via the real Test tool against the :8788 mock) →
//     the auction Simulator renders the redacted payload preview (real JSON),
//     the lgp_ parser id, the parser FIELD-NAME chips (not config keys), and
//     the "No writes; staging-only carrier resolve." note.
//
// Seeding rides the REAL admin HTTP APIs only (the leadgen-p4-seed /
// leadgen-fix-p1-seed convention; no direct DB writes). Runs against the
// playwright.config.ts webServer (wrangler dev on :8787 with
// DEV_BYPASS_AUTH:true + ADMIN_HOST:127.0.0.1) plus the :8788 mock provider.
// Local D1 must be migrated + seeded once: `npm run db:migrate:local &&
// npm run seed:local`.
//
// Screenshots (1280×800) land in test-artifacts/leadgen-offers-mgmt/.

import { createHash } from 'node:crypto';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { MINIMAL_PAYLOAD_SCHEMA, SAMPLE_CARRIER_PARSE } from './leadgen-p4-seed';
import { seedFixP1Funnel } from './leadgen-fix-p1-seed';

test.use({ viewport: { width: 1280, height: 800 } });

const SHOT_DIR = 'test-artifacts/leadgen-offers-mgmt';
const LG_API = '/api/admin/leadgen';
const uniq = Date.now();

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) {
    throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

interface CreatedOffer {
  id: number;
  public_id: string;
}

// A minimal unreferenced STATIC offer through the real §10.1 create API.
async function createBareOffer(
  request: APIRequestContext,
  name: string,
  placement: string,
): Promise<CreatedOffer> {
  return json<CreatedOffer>(
    await request.post(`${LG_API}/offers`, {
      data: {
        offer_name: name,
        provider: 'e2eprov',
        activity: 'quote_funnel',
        vertical: 'life',
        conversion_tracking_method: 's2s_postback',
        offer_type: 'cpc',
        placements: [placement],
        calls_provider_api: false,
        bid_source: 'static',
        cap_enabled: false,
      },
    }),
    `bare offer create (${name})`,
  );
}

// §7.3 duplicate source: a DYNAMIC offer with TWO placements + an ACTIVE
// payload schema (POST /payload-schemas pins active_payload_schema_id).
async function createDuplicableOffer(
  request: APIRequestContext,
  name: string,
  placements: [string, string],
): Promise<CreatedOffer> {
  const offer = await json<CreatedOffer>(
    await request.post(`${LG_API}/offers`, {
      data: {
        offer_name: name,
        provider: 'e2eprov',
        activity: 'quote_funnel',
        vertical: 'life',
        conversion_tracking_method: 's2s_postback',
        offer_type: 'cpc',
        placements,
        calls_provider_api: true,
        bid_source: 'response',
        cap_enabled: false,
      },
    }),
    `duplicable offer create (${name})`,
  );
  await json(
    await request.patch(`${LG_API}/offers/${offer.public_id}`, {
      data: {
        endpoint_production: 'https://provider.e2e.example/api/quotes',
        endpoint_staging: 'https://staging.provider.e2e.example/api/quotes',
        request_method: 'POST',
      },
    }),
    'duplicable offer endpoints patch',
  );
  await json(
    await request.post(`${LG_API}/offers/${offer.public_id}/payload-schemas`, {
      data: { schema_json: MINIMAL_PAYLOAD_SCHEMA, carrier_parse_json: SAMPLE_CARRIER_PARSE },
    }),
    'duplicable offer payload schema create',
  );
  return offer;
}

// A Section that SELECTS the offer through the real sections admin API
// (selected_offers → leadgen_section_available_offers — the §7.4
// sections_available reference kind). Mirrors the fix-p1 seed's section-1
// component shape; no answer maps needed for a selection reference.
async function createReferencingSection(
  request: APIRequestContext,
  name: string,
  offerId: number,
): Promise<{ id: number; public_id: string }> {
  return json<{ id: number; public_id: string }>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: name,
        activity: 'quote_funnel',
        vertical: 'life',
        headline_text: 'Do you own your home?',
        continue_mode: 'auto_advance',
        status: 'active',
        content_json: {
          components: [
            { type: 'ProgressBar', question_id: 's1_progress', props: { mode: 'step' } },
            { type: 'QuestionHeadline', question_id: 's1_head', props: { text: 'Do you own your home?' } },
            {
              type: 'TwoButtonYesNo',
              question_id: 'q_homeowner',
              question_key: 'homeowner_yn',
              internal_field: 'homeowner',
              answer_type: 'boolean',
              props: { yesLabel: 'Yes, I own', noLabel: 'No, I rent', auto_advance: true },
            },
          ],
        },
        selected_offers: [offerId],
      },
    }),
    `referencing section create (${name})`,
  );
}

// ③ seeds the referenced offer; ④ consumes the SAME reference then archives
// it (serial suite — the shared state is the point: one reference fixture,
// both §7.4 consumers).
let referencedOffer: CreatedOffer;
let referencedOfferName = '';
let referencingSection: { id: number; public_id: string };
let referencingSectionName = '';

test.describe.serial('LeadGen Offers — §7.7 management browser flows (A1–A3, D1–D3, S1)', () => {
  test('① duplicate (A2): blank placement blocked inline with no POST; create draft navigates to the new lgo_ editor with the banner; list shows paused/untested', async ({ page }) => {
    test.setTimeout(60_000);
    const srcName = `E2E Mgmt Dup Src ${uniq}`;
    const copyName = `E2E Mgmt Dup Copy ${uniq}`;
    const src = await createDuplicableOffer(page.request, srcName, [
      `pl-mgmt-src-${uniq}`,
      `pl-mgmt-src2-${uniq}`,
    ]);

    await page.goto(`/admin/leadgen/offers?search=${uniq}`, { waitUntil: 'domcontentloaded' });
    const row = page.locator(`tr[data-entity-name="${srcName}"]`);
    await expect(row).toBeVisible();

    // Any POST to the duplicate endpoint is recorded — the blank submit below
    // must produce ZERO (client-side inline block, §7.3).
    const dupPosts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/duplicate')) dupPosts.push(r.url());
    });

    // §7.1 kebab → Duplicate.
    await row.getByRole('button', { name: /More actions/i }).click();
    await row.locator('[data-offer-duplicate]').click();
    const modal = page.locator('#lg-offer-duplicate-modal');
    await expect(modal).toBeVisible();
    // Name prefilled "<name> (copy)"; the default placement id starts EMPTY
    // (source placement ids are never offered verbatim).
    await expect(page.locator('#lg-dup-name')).toHaveValue(`${srcName} (copy)`);
    await expect(page.locator('#lg-dup-placement')).toHaveValue('');

    // Submit with the blank placement → inline field error, no POST.
    await page.locator('#lg-dup-submit').click();
    const placementError = modal.locator('[data-error-for="default_placement_id"]');
    await expect(placementError).toBeVisible();
    await expect(placementError).toContainText('required');
    await expect(page.locator('#lg-dup-status')).toHaveText('Validation failed');
    expect(dupPosts, 'blank-placement submit must not POST /duplicate').toHaveLength(0);
    await page.screenshot({ path: `${SHOT_DIR}/01-duplicate-blank-placement-error.png` });

    // Fill the name + a NEW placement id → Create draft → the browser
    // NAVIGATES to the new offer's editor carrying ?duplicated_from=.
    await page.locator('#lg-dup-name').fill(copyName);
    await page.locator('#lg-dup-placement').fill(`pl-mgmt-copy-${uniq}`);
    await page.locator('#lg-dup-submit').click();
    await page.waitForURL(/\/admin\/leadgen\/offers\/lgo_[^/?]+\/edit\?.*duplicated_from=/);
    const url = new URL(page.url());
    expect(url.pathname, 'navigates to the NEW offer, not the source').not.toContain(src.public_id);
    expect(url.searchParams.get('duplicated_from')).toBe(srcName);
    // The server-rendered "Duplicated from" banner + the new editor identity.
    const banner = page.locator('[data-dup-banner]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(`Duplicated from ${srcName}`);
    await expect(page.locator('.lg-editor-title')).toHaveText(copyName);
    // The second source placement was copied as a BLANK "needs value" row —
    // the banner's pending line says so (§7.3).
    await expect(banner.locator('[data-dup-pending="1"]')).toContainText('1 additional placement copied blank');
    await page.screenshot({ path: `${SHOT_DIR}/02-duplicated-editor-banner.png` });

    // Back on the list the copy renders paused (the draft/inactive state) and
    // Untested (§7.3: test status never copied — R4 keeps it out of auctions).
    await page.goto(`/admin/leadgen/offers?search=${uniq}`, { waitUntil: 'domcontentloaded' });
    const copyRow = page.locator(`tr[data-entity-name="${copyName}"]`);
    await expect(copyRow).toBeVisible();
    await expect(copyRow.locator('.badge', { hasText: 'paused' })).toBeVisible();
    await expect(copyRow.locator('[data-offer-test-status="untested"]')).toHaveText('Untested');
    await page.screenshot({ path: `${SHOT_DIR}/03-duplicated-list-row.png` });
  });

  test('② delete clean (A1): type-name-to-confirm gates the button; confirm removes the row', async ({ page }) => {
    const name = `E2E Mgmt Del Clean ${uniq}`;
    await createBareOffer(page.request, name, `pl-mgmt-del-${uniq}`);

    await page.goto(`/admin/leadgen/offers?search=${uniq}`, { waitUntil: 'domcontentloaded' });
    const row = page.locator(`tr[data-entity-name="${name}"]`);
    await row.getByRole('button', { name: /More actions/i }).click();
    await row.locator('[data-offer-delete]').click();
    const modal = page.locator('#lg-offer-delete-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('[data-delete-offer-name]').first()).toHaveText(name);

    // §7.2 type-to-confirm: disabled empty, disabled on a WRONG name, enabled
    // only on the exact offer name.
    const submit = page.locator('#lg-del-submit');
    await expect(submit).toBeDisabled();
    await page.locator('#lg-del-confirm').fill(`${name} nope`);
    await expect(submit).toBeDisabled();
    await page.locator('#lg-del-confirm').fill(name);
    await expect(submit).toBeEnabled();
    await page.screenshot({ path: `${SHOT_DIR}/04-delete-confirm-enabled.png` });

    await submit.click();
    await expect(page.locator('.toast')).toContainText('Offer deleted');
    // The flow reloads the list — the row is gone.
    await expect(page.locator(`tr[data-entity-name="${name}"]`)).toHaveCount(0);
    // Fresh SSR proves the delete (server truth, not DOM residue).
    await page.goto(`/admin/leadgen/offers?search=${uniq}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator(`tr[data-entity-name="${name}"]`)).toHaveCount(0);
    await page.screenshot({ path: `${SHOT_DIR}/05-deleted-row-gone.png` });
  });

  test('③ usage (A3): the dialog lists the referencing Section by name with its editor link', async ({ page }) => {
    referencedOfferName = `E2E Mgmt Referenced ${uniq}`;
    referencingSectionName = `E2E Mgmt Section ${uniq}`;
    referencedOffer = await createBareOffer(page.request, referencedOfferName, `pl-mgmt-ref-${uniq}`);
    referencingSection = await createReferencingSection(
      page.request,
      referencingSectionName,
      referencedOffer.id,
    );

    await page.goto(`/admin/leadgen/offers?search=${uniq}`, { waitUntil: 'domcontentloaded' });
    const row = page.locator(`tr[data-entity-name="${referencedOfferName}"]`);
    await row.getByRole('button', { name: /More actions/i }).click();
    await row.locator('[data-offer-usage]').click();

    const dialog = page.locator('#lg-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.locator('#lg-dialog-title')).toContainText(`Usage — ${referencedOfferName}`);
    // Referenced → the delete-eligibility verdict reads blocked.
    await expect(dialog.locator('[data-usage-verdict="blocked"]')).toBeVisible();
    // The sections_available kind carries the referencing Section BY NAME with
    // a link into its editor (§7.4 items[{name, link}]).
    const kind = dialog.locator('[data-usage-kind="sections_available"]');
    await expect(kind).toBeVisible();
    await expect(kind.locator('.lg-usage-count')).toHaveText('(1)');
    const item = kind.locator('.lg-usage-list li a', { hasText: referencingSectionName });
    await expect(item).toBeVisible();
    await expect(item).toHaveAttribute(
      'href',
      `/admin/leadgen/sections/${referencingSection.public_id}/edit`,
    );
    await page.screenshot({ path: `${SHOT_DIR}/06-usage-dialog-referencing-section.png` });
  });

  test('④ delete blocked (A1/A3): the 409 modal renders the usage report + item link; Archive instead archives', async ({ page }) => {
    // The SAME referenced offer ③ seeded.
    expect(referencedOffer, '③ must have seeded the referenced offer').toBeDefined();
    await page.goto(`/admin/leadgen/offers?search=${uniq}`, { waitUntil: 'domcontentloaded' });
    const row = page.locator(`tr[data-entity-name="${referencedOfferName}"]`);
    await row.getByRole('button', { name: /More actions/i }).click();
    await row.locator('[data-offer-delete]').click();
    await page.locator('#lg-del-confirm').fill(referencedOfferName);
    await expect(page.locator('#lg-del-submit')).toBeEnabled();
    await page.locator('#lg-del-submit').click();

    // Hard delete refused (409 offer_in_use) → the blocked modal renders the
    // §7.4 usage report: non-zero kind count + the clickable item link.
    const dialog = page.locator('#lg-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.locator('#lg-dialog-title')).toContainText(`Cannot delete — ${referencedOfferName}`);
    await expect(dialog.locator('[data-usage-verdict="blocked"]')).toContainText(
      'This offer is in use and cannot be deleted',
    );
    const kind = dialog.locator('[data-usage-kind="sections_available"]');
    await expect(kind.locator('.lg-usage-count')).toHaveText('(1)');
    const item = kind.locator('.lg-usage-list li a', { hasText: referencingSectionName });
    await expect(item).toBeVisible();
    await expect(item).toHaveAttribute(
      'href',
      `/admin/leadgen/sections/${referencingSection.public_id}/edit`,
    );
    await page.screenshot({ path: `${SHOT_DIR}/07-delete-blocked-usage-report.png` });

    // "Archive instead" primary CTA → confirm → the offer becomes archived.
    const archiveInstead = dialog.locator('[data-usage-archive]');
    await expect(archiveInstead).toHaveText('Archive instead');
    page.once('dialog', (d) => void d.accept());
    await archiveInstead.click();
    await expect(page.locator('.toast')).toContainText('Offer archived');
    await expect(
      page.locator(`tr[data-entity-name="${referencedOfferName}"] .badge-archived`),
    ).toHaveText('archived');
    await page.screenshot({ path: `${SHOT_DIR}/08-archived-instead.png` });
  });

  test('⑤ region rules (D1/D2/D3): two labeled behaviors + Evaluation order; ZIP paste rejects bad tokens; chips persist across save', async ({ page }) => {
    const name = `E2E Mgmt Region ${uniq}`;
    const offer = await createBareOffer(page.request, name, `pl-mgmt-region-${uniq}`);

    await page.goto(`/admin/leadgen/offers/${offer.public_id}/edit`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-lg-tab-btn="region"]').click();

    // D1/D2 panel copy: the provider-scope line + the "Evaluation order"
    // label with its §7.5 help text.
    await expect(page.locator('[data-region-scope-help]')).toContainText(
      'These are provider region-block rules only. Answer-based Offer participation rules are configured in Auction.',
    );
    const orderHelp = page.locator('[data-region-order-help]');
    await expect(orderHelp).toContainText('Evaluation order');
    await expect(orderHelp).toContainText(
      'Rules run lowest number first; the first blocking rule wins. Default 100.',
    );

    // Add a rule row: the behavior select offers exactly the two labeled
    // behaviors (D1) and the priority field is labeled "Evaluation order" (D2).
    await page.locator('#lg-region-add').click();
    const row = page.locator('#lg-region-rows [data-region-rule]').last();
    await expect(row).toBeVisible();
    await expect(row.locator('[data-rule-field="action"] option')).toContainText([
      'Allow only these regions',
      'Block these regions',
    ]);
    await expect(row.locator('.lg-region-order')).toContainText('Evaluation order');

    // D3 ZIP chips: paste "90210, 1234, 10001" → two chips; the invalid token
    // is rejected with a VISIBLE per-token message.
    await row.locator('[data-rule-field="dimension"]').selectOption('zip');
    await row.locator('[data-rule-field="action"]').selectOption({ label: 'Block these regions' });
    await row.locator('[data-region-paste-toggle]').click();
    await row.locator('[data-region-paste-box]').fill('90210, 1234, 10001');
    await row.locator('[data-region-paste-apply]').click();
    const chips = row.locator('[data-region-chips] .lg-chip');
    await expect(chips).toHaveCount(2);
    await expect(row.locator('[data-region-chips]')).toContainText('90210');
    await expect(row.locator('[data-region-chips]')).toContainText('10001');
    const invalid = row.locator('[data-region-invalid]');
    await expect(invalid).toBeVisible();
    await expect(invalid).toContainText('Rejected 1 invalid zip token');
    await expect(invalid).toContainText('1234');
    await page.screenshot({ path: `${SHOT_DIR}/09-region-zip-paste-rejection.png` });

    // Save → fresh SSR: the rule row comes back with BOTH chips, the zip
    // dimension and the canonical exclude behavior (never a legacy alias).
    await page.locator('#lg-editor-save').click();
    await expect(page.locator('.toast')).toContainText('Offer saved');
    await page.goto(`/admin/leadgen/offers/${offer.public_id}/edit`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-lg-tab-btn="region"]').click();
    const saved = page.locator('#lg-region-rows [data-region-rule][data-rule-public-id]');
    await expect(saved).toHaveCount(1);
    await expect(saved.locator('[data-rule-field="dimension"]')).toHaveValue('zip');
    await expect(saved.locator('[data-rule-field="action"]')).toHaveValue('exclude');
    await expect(saved.locator('[data-region-chips] .lg-chip')).toHaveCount(2);
    await expect(saved.locator('[data-region-chips]')).toContainText('90210');
    await expect(saved.locator('[data-region-chips]')).toContainText('10001');
    await page.screenshot({ path: `${SHOT_DIR}/10-region-chips-persisted.png` });
  });

  test('⑥ simulate (S1): the trace panel renders the redacted payload preview, parser id, field-name chips and the dry-run note', async ({ page }) => {
    test.setTimeout(90_000);
    // The proven fix-p1 seed: dynamic offer (staging endpoint → the :8788
    // mock), REAL Test-tool run (the R4 provider-log row), auction with the
    // participating placement — all through the real admin APIs.
    const seed = await seedFixP1Funnel(page.request, {
      hostPrefix: 'lg-mgmt-sim',
      slug: `mgmt-sim-${uniq}`,
    });

    await page.goto(`/admin/leadgen/auction/${seed.auctionId}/edit`, { waitUntil: 'domcontentloaded' });
    await page.locator('.lg-atab[data-tab="simulator"]').click();
    // §7.6 panel note (SSR).
    await expect(page.locator('[data-simulator-dryrun]')).toContainText(
      'No writes; staging-only carrier resolve.',
    );

    await page.locator('#lg-sim-answers').fill('{"homeowner":"true","zip":"90210"}');
    await page.locator('#lg-a-simulate').click();
    const results = page.locator('#lg-sim-results');
    await expect(results).toBeVisible();
    // The dry-run note rides the results too.
    await expect(results.locator('[data-sim-dryrun-note]')).toContainText(
      'no writes; staging-only carrier resolve.',
    );

    // The considered offer's explainability card (offers_payload_explain).
    const card = results.locator(`[data-sim-offer="${seed.offerPublicId}"]`);
    await expect(card).toBeVisible();
    await expect(card.locator('[data-sim-verdict="eligible"]')).toHaveText('Eligible');
    // Parser id = the lgp_ schema-version public id, with its version.
    await expect(card).toContainText(/Parser: lgp_[A-Za-z0-9]+ \(v1\)/);

    // Expected response fields = the PARSER's FIELD NAMES (F3 fix), never the
    // config keys ("carriers_path"/"fields") the audited bug rendered.
    const chipTexts = await card.locator('.lg-sim-chip').allTextContents();
    expect(chipTexts).toEqual(
      expect.arrayContaining(['provider_id', 'carrier_name', 'carrier_logo', 'bid', 'headline']),
    );
    expect(chipTexts).not.toContain('carriers_path');
    expect(chipTexts).not.toContain('fields');

    // The payload preview is the REAL generated payload — non-empty JSON with
    // the value-mapped answer (homeowner "true" → "own") — passed through
    // leadgen/redact.ts (§7.6): the PII-named zip renders as the §30.3
    // deterministic sha256 mask, never the raw value.
    const pre = card.locator('[data-sim-payload]');
    await expect(pre).toBeVisible();
    const preText = (await pre.textContent()) ?? 'null';
    const payload = JSON.parse(preText) as {
      lead?: { homeowner_status?: string; zip?: string };
      meta?: { placement_id?: string };
    } | null;
    expect(payload, 'payload preview parses as JSON').not.toBeNull();
    expect(payload?.lead?.homeowner_status).toBe('own');
    // §30.3 hash: lowercased, trimmed, SHA-256, "sha256:"-prefixed.
    const zipMask = `sha256:${createHash('sha256').update('90210').digest('hex')}`;
    expect(payload?.lead?.zip, 'zip is PII → masked, not raw').toBe(zipMask);
    expect(preText, 'the raw zip never appears in the preview').not.toContain('"90210"');
    expect(payload?.meta?.placement_id).toBe(seed.placementExternalId);
    await page.screenshot({ path: `${SHOT_DIR}/11-simulate-trace-panel.png` });
  });
});
