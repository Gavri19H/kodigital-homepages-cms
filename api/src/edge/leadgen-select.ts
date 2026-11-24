import type { GatewayRequestInput } from "./types";

export type LeadgenSelection =
  | { kind: "render"; quoteId: string; funnelVariantId: string; assignment: unknown }
  | { kind: "redirect"; location: string; status: number }
  | { kind: "fallback" };

export async function buildLeadgenSnapshot(db: D1Database, siteId: string): Promise<Record<string, unknown>> {
  throw new Error("not implemented: buildLeadgenSnapshot");
}

export function selectLeadgenEntry(entry: unknown, input: GatewayRequestInput): LeadgenSelection {
  throw new Error("not implemented: selectLeadgenEntry");
}
