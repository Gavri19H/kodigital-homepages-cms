import { describe, it, expect } from "vitest";
import type { Env } from "../src/env";
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_TEXT_MODEL,
  SUPPORTED_IMAGE_MODELS,
  SUPPORTED_TEXT_MODELS,
  assertSupportedImageModel,
  assertSupportedTextModel,
  getImageModel,
  getTextModel,
} from "../src/ai/models";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "cms.kodigital.app",
    ADMIN_BASE_URL: "https://cms.kodigital.app",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "",
    OPENAI_IMAGE_MODEL: "",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    ...overrides,
  };
}

describe("T1 AI model registry", () => {
  describe("getTextModel(env)", () => {
    it("returns env.OPENAI_TEXT_MODEL when set to a supported value", () => {
      const env = makeEnv({ OPENAI_TEXT_MODEL: "gpt-5.5" });
      expect(getTextModel(env)).toBe("gpt-5.5");
    });

    it("falls back to DEFAULT_TEXT_MODEL when env.OPENAI_TEXT_MODEL is empty", () => {
      const env = makeEnv({ OPENAI_TEXT_MODEL: "" });
      expect(getTextModel(env)).toBe(DEFAULT_TEXT_MODEL);
      expect(getTextModel(env)).toBe("gpt-5.5");
    });

    it("throws when env.OPENAI_TEXT_MODEL is unsupported", () => {
      const env = makeEnv({ OPENAI_TEXT_MODEL: "gpt-not-real" });
      expect(() => getTextModel(env)).toThrow(/Unsupported OPENAI_TEXT_MODEL/);
    });
  });

  describe("getImageModel(env)", () => {
    it("returns env.OPENAI_IMAGE_MODEL when set to a supported value", () => {
      const env = makeEnv({ OPENAI_IMAGE_MODEL: "gpt-image-2" });
      expect(getImageModel(env)).toBe("gpt-image-2");
    });

    it("falls back to DEFAULT_IMAGE_MODEL when env.OPENAI_IMAGE_MODEL is empty", () => {
      const env = makeEnv({ OPENAI_IMAGE_MODEL: "" });
      expect(getImageModel(env)).toBe(DEFAULT_IMAGE_MODEL);
      expect(getImageModel(env)).toBe("gpt-image-2");
    });

    it("throws when env.OPENAI_IMAGE_MODEL is unsupported", () => {
      const env = makeEnv({ OPENAI_IMAGE_MODEL: "dall-e-2" });
      expect(() => getImageModel(env)).toThrow(
        /Unsupported OPENAI_IMAGE_MODEL/,
      );
    });
  });

  describe("assertSupportedTextModel", () => {
    it("returns without throwing for 'gpt-5.5'", () => {
      expect(() => assertSupportedTextModel("gpt-5.5")).not.toThrow();
    });

    it("throws for 'gpt-not-real'", () => {
      expect(() => assertSupportedTextModel("gpt-not-real")).toThrow(
        /Unsupported OPENAI_TEXT_MODEL/,
      );
    });

    it("throws for an empty string", () => {
      expect(() => assertSupportedTextModel("")).toThrow(
        /Unsupported OPENAI_TEXT_MODEL/,
      );
    });
  });

  describe("assertSupportedImageModel", () => {
    it("returns without throwing for 'gpt-image-2'", () => {
      expect(() => assertSupportedImageModel("gpt-image-2")).not.toThrow();
    });

    it("throws for an unsupported model", () => {
      expect(() => assertSupportedImageModel("midjourney-v6")).toThrow(
        /Unsupported OPENAI_IMAGE_MODEL/,
      );
    });
  });

  describe("typed contract surface", () => {
    it("SUPPORTED_TEXT_MODELS contains the literal 'gpt-5.5'", () => {
      expect(SUPPORTED_TEXT_MODELS).toContain("gpt-5.5");
    });

    it("SUPPORTED_IMAGE_MODELS contains the literal 'gpt-image-2'", () => {
      expect(SUPPORTED_IMAGE_MODELS).toContain("gpt-image-2");
    });
  });
});
