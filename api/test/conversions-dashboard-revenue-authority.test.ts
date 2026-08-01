import { describe, expect, it } from "vitest";
import { projectDashboardRevenueCapabilities } from "../src/admin/conversions/dashboard-revenue-authority";

describe("dashboard revenue capability projection", () => {
  it("projects exactly the one dashboard capability and never broader CMS authority", () => {
    expect(projectDashboardRevenueCapabilities(
      '["conversions.view","connections.manage","reporting.view","conversions.dashboard.revenue.read"]',
      "administrator",
    )).toEqual(["conversions.dashboard.revenue.read"]);
    expect(projectDashboardRevenueCapabilities('["connections.manage"]', "administrator")).toBeUndefined();
    expect(projectDashboardRevenueCapabilities(
      '["conversions.dashboard.revenue.read","connections.manage"]', "administrator",
    )).toBeUndefined();
  });
});
