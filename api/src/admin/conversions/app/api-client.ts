const API_PREFIX = "/api/admin/conversions/v1";
const UI_CONTEXT_PATH = "/api/admin/conversions/ui-context";
const META_PROVIDER_PATH = /^\/api\/admin\/conversions\/provider-connections\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/meta$/u;
/** Plain-English messages for the service's error reasons (error.reason) on a draft save. */
export const ERROR_REASON_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  visitor_lookup_consent_required: "Tick the consent box in 'Find our visitor' to send visitor details to Facebook.",
  time_timezone_invalid: "Choose a time zone from the list.",
});
const pendingIdempotencyKeys = new Map<string, string>();
let fallbackSequence = 0;

export class ConversionsApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ConversionsApiError";
    this.status = status;
    this.code = code;
  }
}

function stableKey(action: string): string {
  const existing = pendingIdempotencyKeys.get(action);
  if (existing !== undefined) return existing;
  fallbackSequence += 1;
  const generated = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `ko-local-${Date.now().toString(36)}-${fallbackSequence.toString(36)}`;
  pendingIdempotencyKeys.set(action, generated);
  return generated;
}

function requirePath(path: string, method: string): string {
  const metaProviderPath = META_PROVIDER_PATH.test(path);
  // The Meta provider settings path accepts only GET and PUT; PUT is accepted nowhere else.
  if (metaProviderPath ? method !== "GET" && method !== "PUT" : method === "PUT") {
    throw new ConversionsApiError(0, "invalid_path", "The requested local API path is invalid.");
  }
  if (!path.startsWith(`${API_PREFIX}/`) && path !== API_PREFIX && path !== UI_CONTEXT_PATH && !metaProviderPath) {
    throw new ConversionsApiError(0, "invalid_path", "The requested local API path is invalid.");
  }
  const parsed = new URL(path, "https://local.kodigital.invalid");
  if (parsed.origin !== "https://local.kodigital.invalid" || parsed.pathname.includes("..")) {
    throw new ConversionsApiError(0, "invalid_path", "The requested local API path is invalid.");
  }
  return `${parsed.pathname}${parsed.search}`;
}

export async function requestConversionsApi<T>(
  action: string,
  path: string,
  options: { method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const mutation = method !== "GET";
  const headers = new Headers({ Accept: "application/json" });
  if (mutation) {
    headers.set("Content-Type", "application/json");
    headers.set("Idempotency-Key", stableKey(action));
  }
  let response: Response;
  try {
    response = await fetch(requirePath(path, method), {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: "error",
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ConversionsApiError(0, "dependency_unavailable", "The local service is unavailable. Try again.");
  }
  const contentType = response.headers.get("content-type") ?? "";
  let payload: unknown = null;
  if (response.status !== 204) {
    try {
      payload = contentType.includes("application/json") ? await response.json() : await response.text();
    } catch {
      throw new ConversionsApiError(response.status, "invalid_response", "The service returned an unreadable response.");
    }
  }
  if (!response.ok) {
    const candidate = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const nestedError = candidate.error && typeof candidate.error === "object"
      ? candidate.error as Record<string, unknown>
      : null;
    const code = typeof nestedError?.code === "string"
      ? nestedError.code
      : typeof candidate.error_code === "string"
        ? candidate.error_code
        : typeof candidate.error === "string" ? candidate.error : "request_failed";
    const serviceMessage = typeof nestedError?.message === "string" ? nestedError.message : null;
    const reason = typeof nestedError?.reason === "string" ? nestedError.reason : "";
    throw new ConversionsApiError(
      response.status,
      code,
      response.status === 403
        ? "This action is unavailable with the current local capability."
        : Object.hasOwn(ERROR_REASON_MESSAGES, reason)
          ? ERROR_REASON_MESSAGES[reason] as string
        : code === "connection_name_taken"
          ? "A connection with this name already exists. Choose another name."
        : response.status === 409 || response.status === 412 || code === "resource_changed"
          ? "This item changed. Refresh it before trying again."
          : code === "precondition_failed"
            ? "A required readiness check blocked this action. Review the emergency stop, ownership, and Connection test status."
          : serviceMessage ?? "The request could not be completed. Try again.",
    );
  }
  if (mutation) pendingIdempotencyKeys.delete(action);
  return payload as T;
}

export function clearCompletedIdempotencyKey(action: string): void {
  pendingIdempotencyKeys.delete(action);
}
