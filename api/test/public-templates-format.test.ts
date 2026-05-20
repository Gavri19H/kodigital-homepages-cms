// Phase 5 / T7 BEHAVIORAL guard for templates/format.ts.
// AC: truncateExcerpt with limit=12 yields a <=13 char string ending in
// an ellipsis. The +1 budget is for the appended "…".

import { describe, it, expect } from "vitest";
import {
  formatDate,
  formatReadTime,
  truncateExcerpt,
  formatRelativeDays,
  buildDateline,
} from "../src/public/templates/format";

describe("public-templates-format", () => {
  it("T7.AC2: truncateExcerpt with limit=12 yields a string of length <=13 ending in an ellipsis", () => {
    const out = truncateExcerpt(
      "This is a long form article excerpt that definitely exceeds twelve characters.",
      12,
    );
    expect(out.length).toBeLessThanOrEqual(13);
    expect(out.endsWith("…")).toBe(true);
  });

  it("truncateExcerpt returns the input verbatim when shorter than the limit", () => {
    expect(truncateExcerpt("short", 12)).toBe("short");
    expect(truncateExcerpt("", 12)).toBe("");
  });

  it("truncateExcerpt tolerates null / undefined without throwing", () => {
    expect(truncateExcerpt(null, 12)).toBe("");
    expect(truncateExcerpt(undefined, 12)).toBe("");
  });

  it("T7.AC2: truncateExcerpt clamps a negative limit to 0 and still appends the ellipsis on overflow", () => {
    const out = truncateExcerpt("hello world", -4);
    expect(out).toBe("…");
  });

  it("formatDate returns a stable Intl-formatted date for an ISO string", () => {
    const out = formatDate("2026-01-05T00:00:00Z", "en-US");
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/Jan/);
  });

  it("formatDate returns empty string for unparseable input instead of leaking Invalid Date", () => {
    expect(formatDate("not-a-date")).toBe("");
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
  });

  it("formatReadTime floors at 1 min read even for 0 words", () => {
    expect(formatReadTime(0)).toBe("1 min read");
    expect(formatReadTime("")).toBe("1 min read");
  });

  it("formatReadTime rounds up using a ~200 wpm budget", () => {
    expect(formatReadTime(199)).toBe("1 min read");
    expect(formatReadTime(201)).toBe("2 min read");
    expect(formatReadTime(600)).toBe("3 min read");
  });

  it("formatReadTime word-counts a raw text input", () => {
    const sample = Array.from({ length: 450 }, () => "word").join(" ");
    expect(formatReadTime(sample)).toBe("3 min read");
  });

  it("formatRelativeDays returns 'today' for the same calendar day", () => {
    const now = new Date("2026-05-19T12:00:00Z");
    expect(formatRelativeDays("2026-05-19T08:00:00Z", now)).toBe("today");
  });

  it("formatRelativeDays returns N days ago for older timestamps", () => {
    const now = new Date("2026-05-19T12:00:00Z");
    expect(formatRelativeDays("2026-05-18T12:00:00Z", now)).toBe("1 day ago");
    expect(formatRelativeDays("2026-05-12T12:00:00Z", now)).toBe("7 days ago");
  });

  it("buildDateline joins formatted date and read time with a middle dot", () => {
    const out = buildDateline("2026-01-05T00:00:00Z", 800, "en-US");
    expect(out).toMatch(/2026/);
    expect(out).toContain(" · ");
    expect(out).toMatch(/min read$/);
  });
});
