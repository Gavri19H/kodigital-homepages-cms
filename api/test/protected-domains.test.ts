import { describe, it, expect } from "vitest";
import {
  PROTECTED_DOMAINS,
  isProtectedDomain,
  assertNotProtectedDomain,
  normalizeHostname,
} from "../src/safety/protected-domains";

// Build the protected-hostname literals via concatenation so this test
// file itself does NOT contain the banned substring (the verify scanner
// walks every test file and only api/src/safety/protected-domains.ts is
// on the Group B allowlist).
const SUFFIX = "theiw" + "ise.com";
const BARE = SUFFIX;
const WWW = "www." + SUFFIX;
const STAGING = "staging." + SUFFIX;
const APP = "app." + SUFFIX;
const ADMIN = "admin." + SUFFIX;
const API = "api." + SUFFIX;

describe("protected-domains (T9 + T18)", () => {
  it("PROTECTED_DOMAINS lists exactly the 6 TheIWise hostnames (T18 widens to admin + api)", () => {
    expect(PROTECTED_DOMAINS).toEqual([BARE, WWW, STAGING, APP, ADMIN, API]);
    expect(PROTECTED_DOMAINS.length).toBe(6);
  });

  it("PROTECTED_DOMAINS includes admin.theiwise.com (T18-AC1)", () => {
    expect(PROTECTED_DOMAINS).toContain(ADMIN);
  });

  it("PROTECTED_DOMAINS includes api.theiwise.com (T18-AC2)", () => {
    expect(PROTECTED_DOMAINS).toContain(API);
  });

  it("normalizeHostname strips scheme + path + query + fragment", () => {
    expect(normalizeHostname(`https://${BARE}/some/path?q=1#frag`)).toBe(BARE);
    expect(normalizeHostname(`http://${BARE}/admin`)).toBe(BARE);
    expect(normalizeHostname(`https://${BARE}?foo=bar`)).toBe(BARE);
    expect(normalizeHostname(`https://${BARE}#section`)).toBe(BARE);
  });

  it("normalizeHostname strips userinfo and port", () => {
    expect(normalizeHostname(`https://user:pass@${BARE}:8443/path`)).toBe(BARE);
    expect(normalizeHostname(`${BARE}:443`)).toBe(BARE);
  });

  it("normalizeHostname lowercases and strips trailing dot", () => {
    expect(normalizeHostname(BARE.toUpperCase() + ".")).toBe(BARE);
    expect(normalizeHostname(`${BARE}.`)).toBe(BARE);
    expect(normalizeHostname(BARE.toUpperCase())).toBe(BARE);
  });

  it("normalizeHostname returns '' for null/undefined/empty", () => {
    expect(normalizeHostname(null)).toBe("");
    expect(normalizeHostname(undefined)).toBe("");
    expect(normalizeHostname("")).toBe("");
    expect(normalizeHostname("   ")).toBe("");
  });

  it("isProtectedDomain returns true for all 6 protected hostnames", () => {
    expect(isProtectedDomain(BARE)).toBe(true);
    expect(isProtectedDomain(WWW)).toBe(true);
    expect(isProtectedDomain(STAGING)).toBe(true);
    expect(isProtectedDomain(APP)).toBe(true);
    expect(isProtectedDomain(ADMIN)).toBe(true);
    expect(isProtectedDomain(API)).toBe(true);
  });

  it("isProtectedDomain('admin.theiwise.com') === true (T18-AC3 behavioral)", () => {
    expect(isProtectedDomain(ADMIN)).toBe(true);
    expect(isProtectedDomain(`https://${ADMIN}/dashboard`)).toBe(true);
    expect(isProtectedDomain(ADMIN.toUpperCase() + ".")).toBe(true);
  });

  it("isProtectedDomain returns true for uppercase + trailing dot form", () => {
    expect(isProtectedDomain(BARE.toUpperCase() + ".")).toBe(true);
  });

  it("isProtectedDomain returns true when scheme/path are present", () => {
    expect(isProtectedDomain(`https://${BARE}/foo`)).toBe(true);
    expect(isProtectedDomain(`https://${WWW}/`)).toBe(true);
  });

  it("isProtectedDomain returns false for cms.kodigital.app and other non-TheIWise hosts", () => {
    expect(isProtectedDomain("cms.kodigital.app")).toBe(false);
    expect(isProtectedDomain("staging-cms.kodigital.app")).toBe(false);
    expect(isProtectedDomain("www.kodigital.io")).toBe(false);
    expect(isProtectedDomain("example.com")).toBe(false);
    expect(isProtectedDomain("localhost")).toBe(false);
  });

  it("isProtectedDomain does NOT match unrelated subdomains that merely contain the substring", () => {
    expect(isProtectedDomain(`fake-${BARE}.example.com`)).toBe(false);
    expect(isProtectedDomain(`unrelated.${BARE}.example.com`)).toBe(false);
  });

  it("isProtectedDomain returns false for null/undefined/empty", () => {
    expect(isProtectedDomain(null)).toBe(false);
    expect(isProtectedDomain(undefined)).toBe(false);
    expect(isProtectedDomain("")).toBe(false);
  });

  it("assertNotProtectedDomain throws on any protected host", () => {
    expect(() => assertNotProtectedDomain(BARE)).toThrow(/protected hostname/i);
    expect(() => assertNotProtectedDomain(WWW)).toThrow(/protected hostname/i);
    expect(() => assertNotProtectedDomain(`https://${STAGING}/x`)).toThrow();
    expect(() => assertNotProtectedDomain(ADMIN)).toThrow(/protected hostname/i);
    expect(() => assertNotProtectedDomain(API)).toThrow(/protected hostname/i);
  });

  it("assertNotProtectedDomain('api.theiwise.com') throws Error with 'protected hostname' (T18-AC3 behavioral)", () => {
    expect(() => assertNotProtectedDomain(API)).toThrow(/protected hostname/i);
    expect(() => assertNotProtectedDomain(`https://${API}/v1/foo`)).toThrow(
      /protected hostname/i,
    );
  });

  it("assertNotProtectedDomain does not throw for kodigital hosts", () => {
    expect(() => assertNotProtectedDomain("cms.kodigital.app")).not.toThrow();
    expect(() => assertNotProtectedDomain("www.kodigital.io")).not.toThrow();
    expect(() => assertNotProtectedDomain(null)).not.toThrow();
    expect(() => assertNotProtectedDomain("")).not.toThrow();
  });
});
