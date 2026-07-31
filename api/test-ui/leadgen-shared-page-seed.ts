// LeadGen Rework §4.3-1 / §4.3-15 — shared-first-page fixture helper (NOT a spec).
//
// WHY THIS EXISTS. The rework made the quote-owned shared first page MANDATORY for
// activation: `computeReworkActivationProblems` (quotes-handlers.ts) emits the
// error-severity problem
//
//     activation.shared_page — "The shared first page needs at least one section."
//
// whenever `readSharedPageRow` is null or the quote owns zero
// `leadgen_funnel_variant_sections` rows, and `hasBlockingProblems` turns that into a
// deterministic 409 `quote_activation_blocked` on
// `PUT /quotes/:id/activation/:site_id`. Every pre-rework fixture that built "quote →
// one variant → sections → activate" therefore 409s at seed time, before its own
// assertions ever run.
//
// THE COMPOSITION RULE THAT MAKES THIS SAFE. resolver.ts:1601 composes the visitor
// flow as `pages = [...sharedPages, ...variantPages]` — the shared page is simply the
// funnel's FIRST page. So a fixture satisfies the ruled gate with ZERO change to what
// the visitor sees by moving its own first section OFF the variant and ONTO the shared
// page: composed order, `section_index`, `[data-lg-index="0"]` and every progress
// denominator stay byte-identical. That is `seedSharedFirstPage` below, and it is the
// preferred call: it re-points the fixture at the ruled model instead of bolting an
// extra page in front of the drive.
//
// The gate has a second half — "every active funnel needs at least one page with a
// section" — so the variant must KEEP at least one section. A fixture whose funnel is a
// single section therefore cannot just move it; it pairs `seedSharedFirstPage` with
// `createPassThroughSection` to give the variant a trailing no-question page. Page 1
// (the page such fixtures actually assert on) is still the real section.
//
// Uses `PUT /quotes/:id/shared-page` (idempotent authoring — creates the page when it
// does not exist, replace-sets the section order when it does), so a helper may be
// called once or repeatedly. ORDERING MATTERS: `sharedPageUniquenessErrors` (§4.3-13)
// rejects a section that is also in an active variant's plan, so the variant PUT must
// already exclude the sections handed to `seedSharedFirstPage`.

import { type APIRequestContext } from "@playwright/test";

const LG_API = "/api/admin/leadgen";

async function ok(
  res: { ok(): boolean; status(): number; text(): Promise<string> },
  label: string,
): Promise<void> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
}

/**
 * Put `sectionIds` on the quote's shared first page, in the given order.
 *
 * The sections MUST NOT also sit in an active variant's section order (§4.3-13
 * uniqueness) — call this INSTEAD of listing them in `PUT /variants/:id`.
 */
export async function seedSharedFirstPage(
  request: APIRequestContext,
  quotePublicId: string,
  /** numeric row ids or `lgs_` public ids — `resolveSectionOrder` resolves both */
  sectionIds: Array<number | string>,
  name = "Shared first page",
): Promise<void> {
  await ok(
    await request.put(`${LG_API}/quotes/${quotePublicId}/shared-page`, {
      data: { name, sections: sectionIds.map((section_id, position) => ({ section_id, position })) },
    }),
    `shared first page (${sectionIds.join(",")})`,
  );
}

/**
 * Create a question-free pass-through Section (a single ContinueButton).
 *
 * For single-section fixtures: the real section moves to the shared page and this one
 * becomes the variant's page, so the composed flow is [real, pass-through] and page 1
 * — the page the fixture asserts on — is unchanged.
 */
export async function createPassThroughSection(
  request: APIRequestContext,
  label: string,
  opts: { activity?: string; vertical?: string } = {},
): Promise<number> {
  const res = await request.post(`${LG_API}/sections`, {
    data: {
      section_name: `${label} pass-through`,
      activity: opts.activity ?? "quote_funnel",
      vertical: opts.vertical ?? "life",
      headline_text: "Continue",
      status: "active",
      content_json: JSON.stringify({
        components: [{ type: "ContinueButton", question_id: "shared_pt_continue", props: { label: "Continue" } }],
      }),
    },
  });
  await ok(res, `pass-through section create (${label})`);
  return ((await res.json()) as { id: number }).id;
}
