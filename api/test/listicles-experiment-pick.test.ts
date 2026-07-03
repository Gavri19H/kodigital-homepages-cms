// §15.2 edge sticky Version pick — stickiness + distribution + control
// fallback + cookie plumbing.

import { describe, it, expect } from "vitest";
import {
  stickyPick,
  controlVersion,
  readCookie,
  sessionCookie,
  genSessionId,
  SESSION_COOKIE_MAX_AGE_SECONDS,
} from "../src/public/listicle/experiment-pick";

const versions = [
  { public_id: "ver_A", traffic_allocation: 50, is_control: 1 },
  { public_id: "ver_B", traffic_allocation: 50, is_control: 0 },
];

describe("stickyPick (§15.2)", () => {
  it("same sid + same experiment → the SAME Version on every call", () => {
    for (let i = 0; i < 50; i++) {
      const sid = `sid-sticky-${i}`;
      const first = stickyPick(sid, "exp_1", versions);
      for (let call = 0; call < 5; call++) {
        expect(stickyPick(sid, "exp_1", versions).public_id).toBe(first.public_id);
      }
    }
  });

  it("distributes across Versions per allocation over many sids", () => {
    const counts: Record<string, number> = { ver_A: 0, ver_B: 0 };
    const N = 20_000;
    for (let i = 0; i < N; i++) {
      const pick = stickyPick(`sid-dist-${i}`, "exp_1", versions);
      counts[pick.public_id] = (counts[pick.public_id] ?? 0) + 1;
    }
    // 50/50 within ±2% at 20k draws (loose sanity bound; the rigorous ±50bps
    // + chi-square acceptance lives in listicles-ab-hash.test.ts).
    expect(Math.abs((counts.ver_A ?? 0) / N - 0.5)).toBeLessThan(0.02);
    expect(Math.abs((counts.ver_B ?? 0) / N - 0.5)).toBeLessThan(0.02);
  });

  it("different experiment id ⇒ an independent assignment universe", () => {
    let differs = 0;
    for (let i = 0; i < 200; i++) {
      const sid = `sid-exp-${i}`;
      const a = stickyPick(sid, "exp_1", versions).public_id;
      const b = stickyPick(sid, "exp_2", versions).public_id;
      if (a !== b) differs += 1;
    }
    expect(differs).toBeGreaterThan(0); // ~50% expected
  });
});

describe("controlVersion (no running experiment)", () => {
  it("serves the is_control Version", () => {
    expect(controlVersion(versions)?.public_id).toBe("ver_A");
  });

  it("no control flag (defensive) → first stored Version", () => {
    const noControl = versions.map((v) => ({ ...v, is_control: 0 }));
    expect(controlVersion(noControl)?.public_id).toBe("ver_A");
  });

  it("empty list → null", () => {
    expect(controlVersion([])).toBeNull();
  });
});

describe("ko_sid cookie plumbing (same semantics as the tracking script)", () => {
  it("readCookie parses the named cookie out of a header", () => {
    expect(readCookie("a=1; ko_sid=abc-123; b=2", "ko_sid")).toBe("abc-123");
    expect(readCookie("ko_sid=solo", "ko_sid")).toBe("solo");
    expect(readCookie("other=1", "ko_sid")).toBe("");
    expect(readCookie(null, "ko_sid")).toBe("");
  });

  it("sessionCookie emits path=/, max-age=1800, SameSite=Lax", () => {
    const cookie = sessionCookie("ko_sid", "abc");
    expect(cookie).toBe("ko_sid=abc; Path=/; Max-Age=1800; SameSite=Lax");
    expect(SESSION_COOKIE_MAX_AGE_SECONDS).toBe(1800);
  });

  it("genSessionId yields distinct non-empty ids", () => {
    const a = genSessionId();
    const b = genSessionId();
    expect(a).not.toBe("");
    expect(a).not.toBe(b);
  });
});
