// X14 (admin half) — every admin page's <head> carries the KD brand mark as
// the browser-tab icon (a URL-encoded SVG data address). Fails before X14:
// admin pages had no <link rel="icon">.

import { describe, it, expect } from "vitest";
import { adminLayout, adminStandalonePage } from "../src/admin/templates/layout";
import { settingsPage } from "../src/admin/templates/settings";
import { domainsPage } from "../src/admin/templates/domains";

const PREFIX = '<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,';

function iconSvg(html: string): string {
  const head = html.slice(0, html.indexOf("</head>"));
  const at = head.indexOf(PREFIX);
  expect(at, "icon link sits inside <head>").toBeGreaterThan(-1);
  const href = head.slice(at + PREFIX.length, head.indexOf('"', at + PREFIX.length));
  // URL-encoded: no raw characters that would break the attribute.
  expect(href).not.toMatch(/[<>"\s#]/);
  return decodeURIComponent(href);
}

describe("X14 admin tab icon", () => {
  it("the shelled admin layout's head has the KD brand-mark icon", () => {
    const svg = iconSvg(adminLayout({ title: "T", activePath: "/admin", content: "" }));
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('fill="#2563eb"');
    expect(svg).toContain(">KD</text>");
  });

  it("the chromeless (standalone) admin page has the same icon", () => {
    const a = iconSvg(adminLayout({ title: "T", activePath: "/admin", content: "" }));
    const b = iconSvg(adminStandalonePage({ title: "Studio", content: "" }));
    expect(b).toBe(a);
  });

  it("real admin screens (Settings, Domains) carry it exactly once", () => {
    for (const html of [settingsPage([], {}, null), domainsPage([], [])]) {
      expect(html.split('rel="icon"').length - 1).toBe(1);
      iconSvg(html);
    }
  });
});
