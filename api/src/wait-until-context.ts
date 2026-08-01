// Internal background-work boundary shared by Worker and Hono request contexts.
// Business helpers only need waitUntil; depending on the full platform
// ExecutionContext would couple them to unrelated runtime fields.
export interface WaitUntilContext {
  waitUntil(promise: Promise<unknown>): void;
}
