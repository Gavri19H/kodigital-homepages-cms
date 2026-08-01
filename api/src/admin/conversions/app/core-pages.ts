import { CoreWireError, unwrapCorePage } from "./product-state";

const MAX_CORE_PAGES = 100;

export async function collectCorePages(
  loadPage: (cursor: string | null, pageNumber: number) => Promise<unknown>,
): Promise<ReadonlyArray<Record<string, unknown>>> {
  const items: Array<Record<string, unknown>> = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (let pageNumber = 1; pageNumber <= MAX_CORE_PAGES; pageNumber += 1) {
    const page = unwrapCorePage(await loadPage(cursor, pageNumber));
    items.push(...page.items);
    if (page.nextCursor === null) return Object.freeze(items);
    if (seenCursors.has(page.nextCursor)) {
      throw new CoreWireError("invalid_response", "The service repeated a page while loading this collection.");
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new CoreWireError("invalid_response", "The collection exceeded the safe page limit.");
}
