// Error objects crossing an outbound boundary are untrusted data. Fetch and
// provider libraries can echo a full request URL (including query tokens) in
// `message`, and callers can supply a custom `name`. Persist or log only this
// closed taxonomy; never copy arbitrary exception fields into logs, D1, or an
// API response.

export type SafeErrorName =
  | "AbortError"
  | "AggregateError"
  | "Error"
  | "NetworkError"
  | "RangeError"
  | "ReferenceError"
  | "SyntaxError"
  | "TimeoutError"
  | "TypeError"
  | "URIError"
  | "UnknownError";

const SAFE_ERROR_NAMES: ReadonlySet<string> = new Set<SafeErrorName>([
  "AbortError",
  "AggregateError",
  "Error",
  "NetworkError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TimeoutError",
  "TypeError",
  "URIError",
  "UnknownError",
]);

export function safeErrorName(reason: unknown): SafeErrorName {
  try {
    if (typeof reason !== "object" || reason === null) return "UnknownError";
    const name = (reason as { name?: unknown }).name;
    return typeof name === "string" && SAFE_ERROR_NAMES.has(name)
      ? (name as SafeErrorName)
      : "UnknownError";
  } catch {
    // A hostile object can expose a throwing `name` getter.
    return "UnknownError";
  }
}

export function safeErrorCode(prefix: string, reason: unknown): string {
  return `${prefix}:${safeErrorName(reason)}`;
}
