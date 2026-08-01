import { requestConversionsApi } from "./api-client";
import { CoreWireError, unwrapCorePage } from "./product-state";

type FlowImpact = Readonly<Record<string, unknown>>;
type ImpactPageRequester = (operationKey: string, path: string) => Promise<unknown>;

const FLOW_LIST_PATH = "/api/admin/conversions/v1/flows";
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PAGE_LIMIT = 100;
const MAX_PAGES = 1_000;

function connectionIds(flow: FlowImpact): ReadonlyArray<string> {
  const ids = flow.connection_ids;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !UUID_V7.test(id))) {
    throw new CoreWireError(
      "invalid_response",
      "The service returned an invalid Flow archive-impact response.",
    );
  }
  return ids;
}

export async function loadConnectionArchiveImpacts(
  connectionId: string,
  requestPage: ImpactPageRequester = requestConversionsApi,
): Promise<ReadonlyArray<FlowImpact>> {
  const impacts: FlowImpact[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let pageNumber = 0;
  do {
    pageNumber += 1;
    if (pageNumber > MAX_PAGES) {
      throw new CoreWireError("invalid_response", "The Flow archive-impact result did not terminate.");
    }
    const path = cursor === null
      ? `${FLOW_LIST_PATH}?limit=${PAGE_LIMIT}`
      : `${FLOW_LIST_PATH}?limit=${PAGE_LIMIT}&cursor=${encodeURIComponent(cursor)}`;
    const page = unwrapCorePage(
      await requestPage(`flows.for-connection-impact:${pageNumber}`, path),
    );
    for (const flow of page.items) {
      if (connectionIds(flow).includes(connectionId)) impacts.push(flow);
    }
    cursor = page.nextCursor;
    if (cursor !== null) {
      if (seenCursors.has(cursor)) {
        throw new CoreWireError("invalid_response", "The Flow archive-impact cursor repeated.");
      }
      seenCursors.add(cursor);
    }
  } while (cursor !== null);
  return Object.freeze(impacts);
}
