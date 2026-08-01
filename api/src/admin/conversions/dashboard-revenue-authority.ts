import {
  parseCanonicalMembershipCapabilities,
  type ConversionMembershipRole,
} from "./permanent-authority";

export const DASHBOARD_REVENUE_CAPABILITY = "conversions.dashboard.revenue.read" as const;

export function projectDashboardRevenueCapabilities(
  capabilitiesJson: unknown,
  role: ConversionMembershipRole,
): ReadonlyArray<typeof DASHBOARD_REVENUE_CAPABILITY> | undefined {
  const capabilities = parseCanonicalMembershipCapabilities(capabilitiesJson, role);
  return capabilities?.includes(DASHBOARD_REVENUE_CAPABILITY)
    ? Object.freeze([DASHBOARD_REVENUE_CAPABILITY])
    : undefined;
}
