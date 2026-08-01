import { describe, expect, it } from "vitest";
import { loadConnectionArchiveImpacts } from "../src/admin/conversions/app/connection-archive-impact";

const CONNECTION_ID = "0198f0aa-0000-7000-8000-000000000001";
const OTHER_CONNECTION_ID = "0198f0aa-0000-7000-8000-000000000002";

describe("Connection archive impact", () => {
  it("exhausts every Flow page and matches only exact graph connection IDs", async () => {
    const paths: string[] = [];
    const impacts = await loadConnectionArchiveImpacts(CONNECTION_ID, async (_operation, path) => {
      paths.push(path);
      if (paths.length === 1) {
        return {
          items: [
            { flow_id: "flow-name-only", name: CONNECTION_ID, connection_ids: [OTHER_CONNECTION_ID] },
            { flow_id: "flow-exact", name: "Exact reference", connection_ids: [CONNECTION_ID] },
          ],
          next_cursor: "cursor-page-2",
        };
      }
      return {
        items: [
          { flow_id: "flow-second-page", name: "Second page", connection_ids: [CONNECTION_ID] },
        ],
        next_cursor: null,
      };
    });

    expect(paths).toEqual([
      "/api/admin/conversions/v1/flows?limit=100",
      "/api/admin/conversions/v1/flows?limit=100&cursor=cursor-page-2",
    ]);
    expect(impacts.map((flow) => flow.flow_id)).toEqual(["flow-exact", "flow-second-page"]);
  });

  it("fails closed when a Flow row omits the exact graph field", async () => {
    await expect(loadConnectionArchiveImpacts(CONNECTION_ID, async () => ({
      items: [{ flow_id: "missing-graph" }],
      next_cursor: null,
    }))).rejects.toThrow(/invalid Flow archive-impact response/u);
  });

  it("fails closed on a repeated pagination cursor", async () => {
    await expect(loadConnectionArchiveImpacts(CONNECTION_ID, async () => ({
      items: [],
      next_cursor: "same-cursor",
    }))).rejects.toThrow(/cursor repeated/u);
  });
});
