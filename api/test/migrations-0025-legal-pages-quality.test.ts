import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// PR-3 (issue 16): the legal pages rendered "gutted" because the 0004 seed
// bodies referenced tokens the T20 renderer does NOT support — and its
// RESIDUAL_PLACEHOLDER_RE strips any unsupported {{...}} after substitution.
// 0025 rewrites all 4 legal_templates bodies (by slug) to full copy using ONLY
// the 6 SUPPORTED tokens, so nothing is stripped. This is a static SQL-shape
// guard (readFileSync + regex); the behavioural post-apply leg is proven by
// `wrangler d1 migrations apply DB --local` (the migration is anchored in
// deploy.yml so production applies it too).

const MIGRATION_PATH = resolve(
  __dirname,
  "..",
  "migrations",
  "0025_rescue4_legal_pages_quality.sql",
);

const SLUGS = ["privacy-policy", "terms", "do-not-sell", "contact"];

// The 6 tokens the renderer (api/src/site-provisioning/legal-renderer.ts)
// substitutes. Anything else is stripped → leaves a hole.
const SUPPORTED_TOKENS = [
  "site_name",
  "domain",
  "contact_email",
  "privacy_email",
  "effective_date",
  "company_name",
];

// Tokens the 0004 seed used that the renderer does NOT support — these MUST be
// absent from 0025 (their presence is exactly the "gutted page" bug).
const UNSUPPORTED_TOKENS = ["owner_email", "address", "vertical"];

describe("0025_rescue4_legal_pages_quality.sql (PR-3 / issue 16)", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  // The renderer only sees the UPDATE bodies, never the leading `--` comment
  // header (which DOCUMENTS the removed tokens by name). Strip comment lines
  // before any token scan so the documentation can't masquerade as content.
  const sqlNoComments = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  it("UPDATEs content_html for each of the 4 legal slugs (idempotent, by slug)", () => {
    for (const slug of SLUGS) {
      const re = new RegExp(
        `UPDATE legal_templates SET content_html =[\\s\\S]*?WHERE slug = '${slug}';`,
      );
      expect(re.test(sql), `missing UPDATE for slug '${slug}'`).toBe(true);
    }
    // Exactly 4 UPDATE...WHERE slug statements — no extras, no missing.
    expect((sql.match(/WHERE slug = '/g) ?? []).length).toBe(4);
    // Idempotent shape: UPDATE-by-unique-slug only (no INSERT that could
    // duplicate rows or DELETE that could drop the seed).
    expect(sql).not.toMatch(/INSERT\s+INTO\s+legal_templates/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+legal_templates/i);
  });

  it("references ONLY the 6 renderer-supported tokens (no gutted-page tokens)", () => {
    // Every {{token}} that appears must be one of the supported 6.
    const tokenRe = /\{\{([a-zA-Z0-9_]+)\}\}/g;
    let m: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((m = tokenRe.exec(sqlNoComments)) !== null) {
      seen.add(m[1]!);
    }
    // The comment header documents the supported set verbatim, so each of the
    // 6 should appear; and NONE of the unsupported tokens may appear anywhere.
    for (const tok of seen) {
      expect(SUPPORTED_TOKENS.includes(tok), `unexpected token {{${tok}}}`).toBe(true);
    }
    for (const bad of UNSUPPORTED_TOKENS) {
      expect(sqlNoComments.includes(`{{${bad}}}`), `must not use {{${bad}}}`).toBe(false);
    }
  });

  it("uses the supported tokens that make each page read complete", () => {
    // The two contact-bearing pages must reach a real email token.
    const privacyBlock = /WHERE slug = 'privacy-policy';/;
    expect(privacyBlock.test(sql)).toBe(true);
    expect(sql).toContain("{{privacy_email}}");
    expect(sql).toContain("{{contact_email}}");
    expect(sql).toContain("{{site_name}}");
    expect(sql).toContain("{{effective_date}}");
    // PR-3 fix: bodies are HTML (the renderer outputs content_html RAW, so
    // markdown headings/bullets would render as literal text). Assert real HTML.
    expect(sql).toContain("<h1>");
    expect(sql).toContain("<h2>");
    expect(sql).toContain("<li>");
    expect(sql).not.toMatch(/SET content_html = '#/);
  });
});
