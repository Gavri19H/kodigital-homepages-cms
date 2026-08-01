import { describe, expect, it } from "vitest";
import { collectCorePages } from "../src/admin/conversions/app/core-pages";

describe("Conversions bounded Core page collection", () => {
  it("collects every page in order and passes the exact cursor forward", async () => {
    const calls: Array<readonly [string | null, number]> = [];
    const items = await collectCorePages(async (cursor, pageNumber) => {
      calls.push([cursor, pageNumber]);
      if (pageNumber === 1) {
        return { items: [{ flow_id: "first" }], next_cursor: "cursor_one" };
      }
      return { items: [{ flow_id: "second" }], next_cursor: null };
    });

    expect(calls).toEqual([[null, 1], ["cursor_one", 2]]);
    expect(items).toEqual([{ flow_id: "first" }, { flow_id: "second" }]);
  });

  it("fails closed when the service repeats a cursor", async () => {
    await expect(collectCorePages(async () => ({
      items: [],
      next_cursor: "repeated_cursor",
    }))).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("fails closed when the bounded page ceiling is exhausted", async () => {
    await expect(collectCorePages(async (_cursor, pageNumber) => ({
      items: [],
      next_cursor: `cursor_${pageNumber}`,
    }))).rejects.toMatchObject({ code: "invalid_response" });
  });
});
