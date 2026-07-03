// §22 listicleKey — wire shape + identity semantics (additive in
// cache-keys.ts; every other formatter stays byte-identical).

import { describe, it, expect } from "vitest";
import {
  listicleKey,
  listicleCandidateKey,
  htmlKey,
  TEMPLATE_VERSION,
} from "../src/cache/cache-keys";

describe("listicleKey (§22)", () => {
  it("wire shape: html:{site_id}:/{slug}:{lander_v}:{content_version}:{template_version}", () => {
    expect(listicleKey("st_abc", "best-offers", "ver_123", 4)).toBe(
      `html:st_abc:/best-offers:ver_123:4:${TEMPLATE_VERSION}`,
    );
  });

  it("lander_v is part of the identity: two Versions of one slug never share a key", () => {
    const a = listicleKey("st_abc", "s", "ver_A", 1);
    const b = listicleKey("st_abc", "s", "ver_B", 1);
    expect(a).not.toBe(b);
  });

  it("a Version content_version bump changes cache identity (§22.2 fan-out)", () => {
    const before = listicleKey("st_abc", "s", "ver_A", 1);
    const after = listicleKey("st_abc", "s", "ver_A", 2);
    expect(before).not.toBe(after);
  });

  it("site_id is the FIRST component after the namespace (per-site invalidate discipline)", () => {
    expect(listicleKey("st_abc", "s", "ver_A", 1).startsWith("html:st_abc:")).toBe(true);
    // …and the per-article prefix html:{site}:/{slug}: scopes one article's shells.
    expect(listicleKey("st_abc", "s", "ver_A", 1).startsWith("html:st_abc:/s:")).toBe(true);
  });

  it("empty site_id refuses fast (cross-site key can never form)", () => {
    expect(() => listicleKey("", "s", "ver_A", 1)).toThrow();
  });

  it("does NOT collide with the generic htmlKey space for the same path", () => {
    // htmlKey: html:{site}:/{slug}:{content_version}:{tv} — the listicle key
    // interposes lander_v (ver_…), so the segment counts differ.
    expect(listicleKey("st_abc", "s", "ver_A", 1)).not.toBe(htmlKey("st_abc", "/s", 1));
  });
});

describe("listicleCandidateKey (§22.4 lazy-hydration fragments)", () => {
  it("wire shape + version content_version identity", () => {
    expect(listicleCandidateKey("st_abc", "cand_9", 3)).toBe(
      `html:st_abc:/lst-cand/cand_9:3:${TEMPLATE_VERSION}`,
    );
    expect(listicleCandidateKey("st_abc", "cand_9", 3)).not.toBe(
      listicleCandidateKey("st_abc", "cand_9", 4),
    );
  });
});
