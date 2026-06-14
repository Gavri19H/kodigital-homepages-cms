import { describe, it, expect } from "vitest";
import {
  calculatePagination,
  escapeHtml,
  generateSlug,
  isValidId,
  parsePaginationParams,
} from "../src/admin/types";
import { buildWhereClause } from "../src/admin/query-filters";

// T23 / [B2] Shared admin helpers acceptance:
//   T23.AC2 — legacy slug-generation helper semantics (export from types.ts)
//             + pagination math
//   T23.AC3 — list-filter where-clause builder (export from query-filters.ts)
//             callable and importable

describe("generateSlug (legacy semantics)", () => {
  it("lowercases, trims, and hyphenates spaces", () => {
    expect(generateSlug("  Hello World  ")).toBe("hello-world");
  });

  it("strips non-word characters except spaces and hyphens", () => {
    expect(generateSlug("What's New? (2026 Edition!)")).toBe("whats-new-2026-edition");
  });

  it("collapses repeated separators into a single hyphen", () => {
    expect(generateSlug("a  --  b")).toBe("a-b");
  });

  it("removes leading and trailing hyphens", () => {
    expect(generateSlug("---hello---")).toBe("hello");
  });

  it("caps output at 100 chars by default and honors a custom maxLength", () => {
    expect(generateSlug("x".repeat(250))).toHaveLength(100);
    expect(generateSlug("hello world", 5)).toBe("hello");
  });

  it("keeps underscores and digits (word characters)", () => {
    expect(generateSlug("snake_case_title 42")).toBe("snake_case_title-42");
  });
});

describe("pagination math", () => {
  it("parsePaginationParams defaults to page 1 / perPage 20 / offset 0", () => {
    expect(parsePaginationParams({})).toEqual({ page: 1, perPage: 20, offset: 0 });
  });

  it("parsePaginationParams computes offset = (page - 1) * perPage", () => {
    expect(parsePaginationParams({ page: "3", per_page: "25" })).toEqual({
      page: 3,
      perPage: 25,
      offset: 50,
    });
  });

  it("parsePaginationParams clamps page to >= 1 and perPage to 1..100", () => {
    expect(parsePaginationParams({ page: "0" }).page).toBe(1);
    expect(parsePaginationParams({ page: "-4" }).page).toBe(1);
    // legacy `|| 20` semantics: a parsed 0 is falsy and falls back to the default
    expect(parsePaginationParams({ per_page: "0" }).perPage).toBe(20);
    expect(parsePaginationParams({ per_page: "-5" }).perPage).toBe(1);
    expect(parsePaginationParams({ per_page: "500" }).perPage).toBe(100);
  });

  it("parsePaginationParams falls back to defaults on non-numeric input", () => {
    expect(parsePaginationParams({ page: "abc", per_page: "xyz" })).toEqual({
      page: 1,
      perPage: 20,
      offset: 0,
    });
  });

  it("calculatePagination reports totals and prev/next flags", () => {
    expect(calculatePagination(2, 20, 45)).toEqual({
      page: 2,
      per_page: 20,
      total: 45,
      total_pages: 3,
      has_prev: true,
      has_next: true,
    });
    expect(calculatePagination(3, 20, 45).has_next).toBe(false);
    expect(calculatePagination(1, 20, 45).has_prev).toBe(false);
  });

  it("calculatePagination keeps total_pages at 1 for an empty result set", () => {
    expect(calculatePagination(1, 20, 0)).toEqual({
      page: 1,
      per_page: 20,
      total: 0,
      total_pages: 1,
      has_prev: false,
      has_next: false,
    });
  });
});

describe("escapeHtml", () => {
  it("escapes &, <, >, double and single quotes", () => {
    expect(escapeHtml(`<a href="x" title='y'>Tom & Jerry</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#039;y&#039;&gt;Tom &amp; Jerry&lt;/a&gt;"
    );
  });

  it("leaves safe text untouched", () => {
    expect(escapeHtml("plain text 123")).toBe("plain text 123");
  });
});

describe("isValidId", () => {
  it("accepts positive canonical integers", () => {
    expect(isValidId("1")).toBe(true);
    expect(isValidId("42")).toBe(true);
  });

  it("rejects zero, negatives, decimals, suffixes, and non-canonical forms", () => {
    for (const bad of ["0", "-1", "1.5", "12abc", "abc", "", "007", " 7"]) {
      expect(isValidId(bad), `expected isValidId(${JSON.stringify(bad)}) to be false`).toBe(false);
    }
  });
});

describe("buildWhereClause (list-filter builder)", () => {
  it("is importable and callable, returning 1=1 with no active filters", () => {
    expect(typeof buildWhereClause).toBe("function");
    expect(buildWhereClause([])).toEqual({ clause: "1=1", params: [] });
    expect(
      buildWhereClause([{ when: false, clause: "status = ?", params: ["draft"] }])
    ).toEqual({ clause: "1=1", params: [] });
  });

  it("joins active conditions with AND and flattens params in order", () => {
    const result = buildWhereClause([
      { when: true, clause: "site_id = ?", params: [7] },
      { when: false, clause: "status = ?", params: ["draft"] },
      { when: true, clause: "title LIKE ?", params: ["%news%"] },
      { when: true, clause: "is_active = 1", params: [] },
    ]);
    expect(result.clause).toBe("site_id = ? AND title LIKE ? AND is_active = 1");
    expect(result.params).toEqual([7, "%news%"]);
  });
});
