// LeadGen Phase 5 Stage C — shared e2e seed helper (NOT a spec).
//
// Seeds ONE representative funnel Section THROUGH THE REAL admin API
// (POST /api/admin/leadgen/sections — no direct DB writes, the
// listicles-p6-seed / leadgen-p4-seed convention). The Section's
// content_json exercises every §14.10 component the visual suite asserts on:
//   ProgressBar · HeaderLogo · CategoryLabel · QuestionHeadline · Subheadline ·
//   IconCardAnswerGrid (the §14.4 Sole-Proprietor/Partnership/LLC/C-Corp/S-Corp
//   example) · TwoButtonYesNo (§13.2 "Are you insured?" Yes/No answer buttons) ·
//   CurrencyRangeQuestion (§14.5 BUSINESS LOAN / "How much do you
//   need?" / $330,000 / $10k / $1M+) · MultiChoiceCardGroup · DropdownQuestion ·
//   ContinueButton · ReassuranceBadge ("Get your offers in 2 minutes or less.")
//   · FreeText / Email / Phone / Name / ZIP PII inputs · Helper.
//
// The Section maps NO answers to Offers (a pure VISUAL section), so it needs
// no available Offers — create succeeds with an empty answer-map graph
// (sections.ts prepareSave → empty derived indexes). The visual suite drives
// the REAL server-render via POST /sections/preview (the same Stage-A
// renderSectionComponents + funnelChromeCss path the editor iframe uses), so
// the seeded content_json is what the spec renders and asserts against.
//
// Runs against the playwright.config.ts webServer (wrangler dev on :8787 with
// DEV_BYPASS_AUTH:true + ADMIN_HOST:127.0.0.1). Every resource is
// unique-suffixed so parallel/local leftovers can never collide.
//
// NO banned legacy product identifiers anywhere (assert-no-legacy-prod-refs):
// the design is named "default-funnel" / "reference funnel" only.

import { type APIRequestContext } from "@playwright/test";

// ---------------------------------------------------------------------------
// transient-socket retry (the listicles-p6-seed idiom — seed calls only)
// ---------------------------------------------------------------------------

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) {
    throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

async function withTransientRetry<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/ECONNRESET|ECONNREFUSED|socket hang up/i.test(message)) throw err;
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log(`[seed-retry] ${label}: transient socket error, retrying once`);
    return run();
  }
}

function retryingRequest(request: APIRequestContext): APIRequestContext {
  const verbs = new Set(["get", "post", "patch", "put", "delete"]);
  return new Proxy(request, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver) as unknown;
      if (typeof prop !== "string" || !verbs.has(prop) || typeof original !== "function") {
        return original;
      }
      const fn = original as (...args: unknown[]) => Promise<unknown>;
      return (...args: unknown[]) =>
        withTransientRetry(`${prop} ${String(args[0] ?? "")}`, () => fn.apply(target, args));
    },
  });
}

// ---------------------------------------------------------------------------
// the representative Section content_json (§14.10 component coverage)
// ---------------------------------------------------------------------------

// One component node in a Section body (the content-schema.ts shape, kept
// local so the seed has no runtime import from src/).
interface SeedChoice {
  label: string;
  value: string | number | boolean;
  analytics_id: string;
  icon?: string;
  description?: string;
}
interface SeedNode {
  type: string;
  question_id: string;
  internal_field?: string;
  required?: boolean;
  choices?: SeedChoice[];
  props?: Record<string, unknown>;
  design_overrides?: Record<string, unknown>;
}
export interface SeedSectionContent {
  components: SeedNode[];
}

// The §14.4 example choices — Sole Proprietor / Partnership / LLC / C-Corp /
// S-Corp. Each carries the per-choice icon §14.4 requires.
const BUSINESS_TYPE_CHOICES: SeedChoice[] = [
  { label: "Sole Proprietor", value: "sole_proprietor", analytics_id: "biz_type_sole", icon: "\u{1F464}" },
  { label: "Partnership", value: "partnership", analytics_id: "biz_type_partner", icon: "\u{1F91D}" },
  { label: "Limited Liability Company (LLC)", value: "llc", analytics_id: "biz_type_llc", icon: "\u{1F3E2}" },
  { label: "C Corporation", value: "c_corp", analytics_id: "biz_type_ccorp", icon: "\u{1F3DB}" },
  { label: "S Corporation", value: "s_corp", analytics_id: "biz_type_scorp", icon: "\u{1F4CA}" },
];

// The full representative body. RUN-STABLE literals only (fixed copy, fixed
// range default) so the §14.10 screenshot self-baseline is byte-identical
// across runs — no dates / counts / random ids reach the render.
export function buildVisualSectionContent(): SeedSectionContent {
  return {
    components: [
      { type: "HeaderLogo", question_id: "q_header", props: { logoMediaId: "lgm_default_funnel", siteName: "DefaultFunnel", accent: "Quotes" } },
      { type: "ProgressBar", question_id: "q_progress", props: { mode: "step", step: 2, totalSteps: 5, label: "Step 2 of 5" } },
      { type: "CategoryLabel", question_id: "q_category", props: { text: "BUSINESS LOAN" } },
      { type: "QuestionHeadline", question_id: "q_headline", props: { text: "How much do you need?" } },
      { type: "Subheadline", question_id: "q_subheadline", props: { text: "Choose an amount to see your matched offers." } },
      {
        type: "IconCardAnswerGrid",
        question_id: "q_business_type",
        internal_field: "business_type",
        required: true,
        choices: BUSINESS_TYPE_CHOICES,
        props: { columns: 3 },
      },
      // §13.2 "Are you insured? [Yes][No]" — the TwoButtonYesNo answer-button
      // pair the visual suite drives to prove the §14.6 selected/hover state
      // (navy border + wash bg on aria-checked; wash — NOT navy fill — on hover).
      {
        type: "TwoButtonYesNo",
        question_id: "q_insured",
        internal_field: "currently_insured",
        required: true,
        props: { yesLabel: "Yes", noLabel: "No", auto_advance: false },
      },
      {
        type: "CurrencyRangeQuestion",
        question_id: "q_loan_amount",
        internal_field: "loan_amount",
        required: true,
        props: {
          min: 10000,
          max: 1000000,
          step: 5000,
          default: 330000,
          currency: "$",
          format: "currency",
          minLabel: "$10,000",
          maxLabel: "$1M+",
          ariaLabel: "How much do you need?",
        },
      },
      {
        type: "MultiChoiceCardGroup",
        question_id: "q_goals",
        internal_field: "loan_goals",
        choices: [
          { label: "Expand operations", value: "expand", analytics_id: "goal_expand" },
          { label: "Hire staff", value: "hire", analytics_id: "goal_hire" },
          { label: "Buy equipment", value: "equipment", analytics_id: "goal_equipment" },
          { label: "Improve cash flow", value: "cash_flow", analytics_id: "goal_cash_flow" },
        ],
        props: { min: 1, max: 3 },
      },
      {
        type: "DropdownQuestion",
        question_id: "q_industry",
        internal_field: "industry",
        choices: [
          { label: "Retail", value: "retail", analytics_id: "industry_retail" },
          { label: "Professional services", value: "services", analytics_id: "industry_services" },
          { label: "Manufacturing", value: "manufacturing", analytics_id: "industry_manufacturing" },
        ],
        props: { placeholder: "Select your industry" },
      },
      { type: "FreeTextQuestion", question_id: "q_company", internal_field: "company_name", props: { placeholder: "Legal business name", maxLen: 120 } },
      { type: "EmailInputQuestion", question_id: "q_email", internal_field: "email", required: true },
      { type: "PhoneInputQuestion", question_id: "q_phone", internal_field: "phone", required: true },
      { type: "NameFieldsGroup", question_id: "q_name", props: { firstLabel: "First name", lastLabel: "Last name" } },
      { type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip", props: { validate: true } },
      { type: "ContinueButton", question_id: "q_continue", props: { label: "Continue", loadingLabel: "Finding offers…" } },
      { type: "ReassuranceBadge", question_id: "q_badge", props: { icon: "✓", text: "Get your offers in 2 minutes or less." } },
      { type: "HelperText", question_id: "q_helper", props: { text: "Your information is secure and never sold to unrelated third parties." } },
    ],
  };
}

// ---------------------------------------------------------------------------
// seed entry point
// ---------------------------------------------------------------------------

export interface SeededVisualSection {
  sectionId: number;
  sectionPublicId: string;
  sectionName: string;
  activity: string;
  vertical: string;
  content: SeedSectionContent;
}

// Create the representative Section through the REAL admin API and return the
// ids + the exact content_json the spec renders through POST /sections/preview.
export async function seedVisualSection(
  rawRequest: APIRequestContext,
  uniq: number | string,
): Promise<SeededVisualSection> {
  const request = retryingRequest(rawRequest);
  const sectionName = `E2E LG Visual ${uniq}`;
  const activity = "quote_funnel";
  const vertical = "business_loan";
  const content = buildVisualSectionContent();

  const created = await json<{ id: number; public_id: string }>(
    await request.post("/api/admin/leadgen/sections", {
      data: {
        section_name: sectionName,
        activity,
        vertical,
        headline_text: "How much do you need?",
        subheadline_text: "Choose an amount to see your matched offers.",
        content_json: content,
        continue_mode: "button",
        status: "active",
      },
    }),
    "visual section create",
  );

  return {
    sectionId: created.id,
    sectionPublicId: created.public_id,
    sectionName,
    activity,
    vertical,
    content,
  };
}
