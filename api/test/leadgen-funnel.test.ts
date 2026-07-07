// LeadGen §15 / §15.5 / §17 pure funnel-domain logic — branch-complete unit
// tests. Covers builder validation (contiguous/gap/empty/duplicate/max-position
// auction entry), rule validation (redirect_direct_offer target requirement;
// raw redirect_url gating by allowlist + host; every rule_type; conditions;
// priority; redirect_pct ?? 0), site activation (one-root-per-site both sides,
// duplicate quote/slug), and the funnel_id ≠ funnel_variant_id identity (G4).

import { describe, expect, it } from "vitest";
import {
  validateFunnelBuilder,
  auctionEntryPosition,
  validateFunnelRule,
  resolveRedirectPct,
  validateActivation,
  toFunnelId,
  toFunnelVariantId,
  toQuoteId,
  isFunnelId,
  isFunnelVariantId,
  resolveFunnelIdentity,
  type FunnelRuleInput,
  type ActivationRowInput,
} from "../src/leadgen/funnel";
import { mintPublicId } from "../src/leadgen/ids";

const ALLOWLIST = ["partner.example.com", "Offers.Example.ORG"];

// ---------------------------------------------------------------------------
// §15.3 builder
// ---------------------------------------------------------------------------

describe("validateFunnelBuilder — §15.3 ordered sections", () => {
  it("contiguous 0..n passes and reports the max position as the auction entry", () => {
    const r = validateFunnelBuilder([{ position: 0 }, { position: 1 }, { position: 2 }]);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.auction_entry_position).toBe(2);
  });

  it("a single section is valid; it is itself the auction entry (position 0)", () => {
    const r = validateFunnelBuilder([{ position: 0 }]);
    expect(r.ok).toBe(true);
    expect(r.auction_entry_position).toBe(0);
  });

  it("an empty section set cannot publish (no_sections) and has no auction entry", () => {
    const r = validateFunnelBuilder([]);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain("no_sections");
    expect(r.auction_entry_position).toBeNull();
  });

  it("a gap in positions fails as not-contiguous", () => {
    const r = validateFunnelBuilder([{ position: 0 }, { position: 1 }, { position: 3 }]);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain("positions_not_contiguous");
  });

  it("positions not zero-based fails as not-contiguous", () => {
    const r = validateFunnelBuilder([{ position: 1 }, { position: 2 }]);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain("positions_not_contiguous");
  });

  it("duplicate positions fail", () => {
    const r = validateFunnelBuilder([{ position: 0 }, { position: 1 }, { position: 1 }]);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain("duplicate_position");
  });

  it("negative and non-integer positions fail", () => {
    expect(validateFunnelBuilder([{ position: -1 }, { position: 0 }]).errors.map((e) => e.code)).toContain(
      "negative_position",
    );
    expect(validateFunnelBuilder([{ position: 0.5 }, { position: 1 }]).errors.map((e) => e.code)).toContain(
      "non_integer_position",
    );
  });
});

describe("auctionEntryPosition — the auction runs after the MAX position (no 'final' flag)", () => {
  it("returns the max position regardless of input order", () => {
    expect(auctionEntryPosition([{ position: 2 }, { position: 0 }, { position: 1 }])).toBe(2);
  });
  it("returns null for an empty set", () => {
    expect(auctionEntryPosition([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §15.5 funnel rules
// ---------------------------------------------------------------------------

const OK_CONDITIONS = { groups: [{ field: "homeowner", op: "eq", value: false }] };

describe("validateFunnelRule — §15.5 redirect safety", () => {
  it("redirect_direct_offer REQUIRES target_offer_id", () => {
    const missing: FunnelRuleInput = { rule_type: "redirect_direct_offer", conditions_json: OK_CONDITIONS };
    expect(validateFunnelRule(missing, ALLOWLIST).errors.map((e) => e.code)).toContain(
      "redirect_offer_missing_target",
    );
    const ok: FunnelRuleInput = {
      rule_type: "redirect_direct_offer",
      target_offer_id: 42,
      conditions_json: OK_CONDITIONS,
    };
    expect(validateFunnelRule(ok, ALLOWLIST).ok).toBe(true);
  });

  it("a raw redirect_url is rejected when NOT allowlisted", () => {
    const rule: FunnelRuleInput = {
      rule_type: "eligibility",
      redirect_url: "https://partner.example.com/go",
      redirect_url_allowlisted: 0,
      conditions_json: OK_CONDITIONS,
    };
    expect(validateFunnelRule(rule, ALLOWLIST).errors.map((e) => e.code)).toContain("raw_redirect_not_allowlisted");
  });

  it("a raw redirect_url allowlisted but host NOT on the admin allowlist is rejected", () => {
    const rule: FunnelRuleInput = {
      rule_type: "eligibility",
      redirect_url: "https://evil.example.net/go",
      redirect_url_allowlisted: 1,
      conditions_json: OK_CONDITIONS,
    };
    expect(validateFunnelRule(rule, ALLOWLIST).errors.map((e) => e.code)).toContain(
      "raw_redirect_host_not_on_allowlist",
    );
  });

  it("a raw redirect_url allowlisted AND host on the allowlist passes (host match is case-insensitive)", () => {
    const rule: FunnelRuleInput = {
      rule_type: "eligibility",
      redirect_url: "https://offers.example.org/lp",
      redirect_url_allowlisted: 1,
      conditions_json: OK_CONDITIONS,
    };
    expect(validateFunnelRule(rule, ALLOWLIST).ok).toBe(true);
  });

  it("an allowlisted-but-malformed redirect_url is rejected", () => {
    const rule: FunnelRuleInput = {
      rule_type: "eligibility",
      redirect_url: "not-a-url",
      redirect_url_allowlisted: 1,
      conditions_json: OK_CONDITIONS,
    };
    expect(validateFunnelRule(rule, ALLOWLIST).errors.map((e) => e.code)).toContain("raw_redirect_url_invalid");
  });

  it("accepts every valid rule_type", () => {
    for (const rule_type of [
      "skip_section",
      "show_section",
      "eligibility",
      "disqualification",
      "auction_entry",
    ]) {
      const r = validateFunnelRule({ rule_type, conditions_json: OK_CONDITIONS }, ALLOWLIST);
      expect(r.ok, rule_type).toBe(true);
    }
  });

  it("rejects an unknown rule_type", () => {
    expect(validateFunnelRule({ rule_type: "teleport" }, ALLOWLIST).errors.map((e) => e.code)).toContain(
      "unknown_rule_type",
    );
  });

  it("rejects malformed conditions_json (bad op + bad shape)", () => {
    const badOp: FunnelRuleInput = {
      rule_type: "eligibility",
      conditions_json: { groups: [{ field: "x", op: "approx" }] },
    };
    expect(validateFunnelRule(badOp, ALLOWLIST).errors.map((e) => e.code)).toContain("condition_op_invalid");
    const badShape: FunnelRuleInput = { rule_type: "eligibility", conditions_json: { groups: "nope" } };
    expect(validateFunnelRule(badShape, ALLOWLIST).errors.map((e) => e.code)).toContain("conditions_invalid");
  });

  it("rejects a non-integer priority", () => {
    const rule: FunnelRuleInput = { rule_type: "eligibility", priority: 1.5, conditions_json: OK_CONDITIONS };
    expect(validateFunnelRule(rule, ALLOWLIST).errors.map((e) => e.code)).toContain("priority_invalid");
  });
});

// A javascript:/data:/mailto: URL is a VALID URL whose hostname is EMPTY. Before
// the scheme guard, an empty host skipped the host-on-allowlist check entirely,
// so such a URL validated OK when redirect_url_allowlisted=1 (a redirect
// allowlist bypass). Contract 04 §10.5: a raw redirect_url MUST be an absolute
// http(s) URL — a non-http(s) scheme (or an empty host) can NEVER validate,
// regardless of the allowlist flag or contents.
describe("validateFunnelRule — §10.5 non-http(s) redirect scheme guard (B2)", () => {
  const NON_HTTP = [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "mailto:evil@example.com",
  ] as const;

  for (const rawUrl of NON_HTTP) {
    const label = rawUrl.slice(0, rawUrl.indexOf(":"));
    it(`rejects a ${label}: redirect_url even when redirect_url_allowlisted=1`, () => {
      const rule: FunnelRuleInput = {
        rule_type: "eligibility",
        redirect_url: rawUrl,
        redirect_url_allowlisted: 1,
        conditions_json: OK_CONDITIONS,
      };
      const verdict = validateFunnelRule(rule, ALLOWLIST);
      expect(verdict.ok).toBe(false);
      expect(verdict.errors.map((e) => e.code)).toContain("raw_redirect_url_invalid");
    });

    it(`rejects a ${label}: redirect_url with an EMPTY allowlist too`, () => {
      const rule: FunnelRuleInput = {
        rule_type: "eligibility",
        redirect_url: rawUrl,
        redirect_url_allowlisted: 1,
        conditions_json: OK_CONDITIONS,
      };
      expect(validateFunnelRule(rule, []).errors.map((e) => e.code)).toContain("raw_redirect_url_invalid");
    });
  }

  it("no regression: an http(s) URL whose host IS on the allowlist still validates", () => {
    const rule: FunnelRuleInput = {
      rule_type: "eligibility",
      redirect_url: "https://partner.example.com/go",
      redirect_url_allowlisted: 1,
      conditions_json: OK_CONDITIONS,
    };
    expect(validateFunnelRule(rule, ALLOWLIST).ok).toBe(true);
  });

  it("no regression: an http(s) URL whose host is NOT on the allowlist is still rejected", () => {
    const rule: FunnelRuleInput = {
      rule_type: "eligibility",
      redirect_url: "https://evil.example.net/go",
      redirect_url_allowlisted: 1,
      conditions_json: OK_CONDITIONS,
    };
    expect(validateFunnelRule(rule, ALLOWLIST).errors.map((e) => e.code)).toContain(
      "raw_redirect_host_not_on_allowlist",
    );
  });
});

describe("resolveRedirectPct — §15.5 `?? 0` (explicit 0 = no redirect)", () => {
  it("absent → 0", () => {
    expect(resolveRedirectPct({})).toBe(0);
    expect(resolveRedirectPct({ redirect_pct: null })).toBe(0);
  });
  it("explicit 0 stays 0 (not conflated with absent)", () => {
    expect(resolveRedirectPct({ redirect_pct: 0 })).toBe(0);
  });
  it("a positive pct passes through", () => {
    expect(resolveRedirectPct({ redirect_pct: 50 })).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// §17 site activation
// ---------------------------------------------------------------------------

describe("validateActivation — §17.1 one enabled root per site + uniqueness", () => {
  const existingRoot: ActivationRowInput = { id: 1, site_id: "s1", quote_id: 10, enabled: 1, slug: null };

  it("the first enabled root activation is valid (no existing rows)", () => {
    const r = validateActivation([], { site_id: "s1", quote_id: 10, enabled: 1, slug: null });
    expect(r.ok).toBe(true);
  });

  it("activating a SECOND enabled root while one is enabled errors (root_conflict)", () => {
    const r = validateActivation([existingRoot], { site_id: "s1", quote_id: 20, enabled: 1, slug: null });
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain("root_conflict");
  });

  it("re-saving the SAME enabled root (self by id) is not a conflict", () => {
    const r = validateActivation([existingRoot], { id: 1, site_id: "s1", quote_id: 10, enabled: 1, slug: null });
    expect(r.ok).toBe(true);
  });

  it("an enabled activation WITH a slug is not a root conflict", () => {
    const r = validateActivation([existingRoot], { site_id: "s1", quote_id: 30, enabled: 1, slug: "auto" });
    expect(r.errors.map((e) => e.code)).not.toContain("root_conflict");
    expect(r.ok).toBe(true);
  });

  it("a second enabled root is fine once the first is disabled", () => {
    const disabledRoot: ActivationRowInput = { id: 1, site_id: "s1", quote_id: 10, enabled: 0, slug: null };
    const r = validateActivation([disabledRoot], { site_id: "s1", quote_id: 20, enabled: 1, slug: null });
    expect(r.ok).toBe(true);
  });

  it("duplicate (site_id, quote_id) errors", () => {
    const r = validateActivation([existingRoot], { site_id: "s1", quote_id: 10, enabled: 1, slug: "x" });
    expect(r.errors.map((e) => e.code)).toContain("duplicate_site_quote");
  });

  it("duplicate (site_id, slug) errors", () => {
    const withSlug: ActivationRowInput = { id: 2, site_id: "s1", quote_id: 40, enabled: 1, slug: "auto" };
    const r = validateActivation([withSlug], { site_id: "s1", quote_id: 50, enabled: 1, slug: "auto" });
    expect(r.errors.map((e) => e.code)).toContain("duplicate_slug");
  });

  it("scopes uniqueness per site — a same slug on a different site is fine", () => {
    const otherSite: ActivationRowInput = { id: 3, site_id: "s2", quote_id: 40, enabled: 1, slug: "auto" };
    const r = validateActivation([otherSite], { site_id: "s1", quote_id: 50, enabled: 1, slug: "auto" });
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §15.1 funnel_id ≠ funnel_variant_id identity (G4)
// ---------------------------------------------------------------------------

describe("funnel identity — funnel_id (lgf_) and funnel_variant_id (lgn_) stay distinct (G4)", () => {
  const lgf = mintPublicId("funnel");
  const lgn = mintPublicId("funnel_variant");
  const lgq = mintPublicId("quote");

  it("toFunnelId accepts an lgf_ id and REJECTS an lgn_ id", () => {
    expect(toFunnelId(lgf)).toBe(lgf);
    expect(() => toFunnelId(lgn)).toThrow();
  });

  it("toFunnelVariantId accepts an lgn_ id and REJECTS an lgf_ id", () => {
    expect(toFunnelVariantId(lgn)).toBe(lgn);
    expect(() => toFunnelVariantId(lgf)).toThrow();
  });

  it("predicates discriminate the two prefixes", () => {
    expect(isFunnelId(lgf)).toBe(true);
    expect(isFunnelId(lgn)).toBe(false);
    expect(isFunnelVariantId(lgn)).toBe(true);
    expect(isFunnelVariantId(lgf)).toBe(false);
  });

  it("resolveFunnelIdentity returns a triple whose funnel_id and funnel_variant_id are distinct", () => {
    const id = resolveFunnelIdentity(lgq, lgf, lgn);
    expect(id.funnel_id).toBe(lgf);
    expect(id.funnel_variant_id).toBe(lgn);
    expect(toQuoteId(lgq)).toBe(lgq);
    expect(id.funnel_id as string).not.toBe(id.funnel_variant_id as string);
  });

  it("resolveFunnelIdentity throws if a variant id is passed as the funnel id", () => {
    expect(() => resolveFunnelIdentity(lgq, lgn, lgf)).toThrow();
  });
});
