import { describe, expect, it } from "vitest";
import { safeErrorCode, safeErrorName } from "../src/safety/safe-error";

describe("safe error taxonomy", () => {
  it("keeps only allowlisted names and never copies a message", () => {
    const secret = "secret-in-url";
    const builtIn = new TypeError(`fetch https://provider.test/?token=${secret}`);
    expect(safeErrorName(builtIn)).toBe("TypeError");
    expect(safeErrorCode("provider_fetch_failed", builtIn)).toBe(
      "provider_fetch_failed:TypeError",
    );
    expect(safeErrorCode("provider_fetch_failed", builtIn)).not.toContain(secret);
  });

  it("maps custom names, primitives, and throwing name getters to UnknownError", () => {
    const custom = new Error("contains secret");
    custom.name = "SecretName-contains-secret";
    const hostile = Object.create(null, {
      name: { get: () => { throw new Error("getter secret"); } },
    });

    expect(safeErrorName(custom)).toBe("UnknownError");
    expect(safeErrorName("raw secret string")).toBe("UnknownError");
    expect(safeErrorName(hostile)).toBe("UnknownError");
  });

  it("preserves AbortError for timeout classification", () => {
    expect(safeErrorName({ name: "AbortError", message: "secret" })).toBe("AbortError");
  });
});
