import { describe, it, expect } from "vitest";
import {
  sanitizeSvg,
  SVG_MAX_BYTES,
  SVG_MAX_ELEMENTS,
  type SanitizeSvgResult,
} from "../src/lib/svg-sanitizer";

// Round-4 P5c — the SVG sanitizer adversarial corpus (the security core).
//
// The battery below asserts a VERDICT for every entry: a malicious construct
// MUST reject with a plain reason, and a legitimate logo MUST pass. This is
// the gate that keeps a stored-XSS SVG off the live /media serve path.

const XMLNS = 'xmlns="http://www.w3.org/2000/svg"';

interface Case {
  name: string;
  input: unknown;
  verdict: "accept" | "reject";
  reason?: RegExp; // substring the rejection reason must contain
}

const REJECT_CASES: Case[] = [
  {
    name: "inline <script>",
    input: `<svg ${XMLNS}><script>alert(1)</script></svg>`,
    verdict: "reject",
    reason: /disallowed element: script/i,
  },
  {
    name: "nested <script> inside a group",
    input: `<svg ${XMLNS}><g><rect/><script>steal()</script></g></svg>`,
    verdict: "reject",
    reason: /disallowed element: script/i,
  },
  {
    name: "onload handler on the root",
    input: `<svg ${XMLNS} onload="alert(1)"><rect/></svg>`,
    verdict: "reject",
    reason: /event-handler attribute/i,
  },
  {
    name: "onclick handler on a child",
    input: `<svg ${XMLNS}><rect onclick="x()"/></svg>`,
    verdict: "reject",
    reason: /event-handler attribute/i,
  },
  {
    name: "<a> with xlink:href=javascript:",
    input: `<svg ${XMLNS}><a xlink:href="javascript:alert(1)"><rect/></a></svg>`,
    verdict: "reject",
    reason: /disallowed element: a/i,
  },
  {
    name: "href=javascript: on an allowed element",
    input: `<svg ${XMLNS}><rect href="javascript:alert(1)"/></svg>`,
    verdict: "reject",
    reason: /unsafe href/i,
  },
  {
    name: "href=data:text/html on an allowed element",
    input: `<svg ${XMLNS}><rect href="data:text/html,<script>alert(1)</script>"/></svg>`,
    verdict: "reject",
    reason: /unsafe href/i,
  },
  {
    name: "<foreignObject> wrapping an <iframe>",
    input: `<svg ${XMLNS}><foreignObject><iframe src="https://evil.example"></iframe></foreignObject></svg>`,
    verdict: "reject",
    reason: /disallowed element: foreignobject/i,
  },
  {
    name: "external <use> reference",
    input: `<svg ${XMLNS}><use href="https://evil.example/x.svg#a"/></svg>`,
    verdict: "reject",
    reason: /disallowed element: use/i,
  },
  {
    name: "<image> element (external/data ref carrier)",
    input: `<svg ${XMLNS}><image href="https://evil.example/x.png"/></svg>`,
    verdict: "reject",
    reason: /disallowed element: image/i,
  },
  {
    name: "<style> element (CSS injection vector)",
    input: `<svg ${XMLNS}><style>* { fill: url(https://evil.example) }</style><rect/></svg>`,
    verdict: "reject",
    reason: /disallowed element: style/i,
  },
  {
    name: "SMIL <animate>",
    input: `<svg ${XMLNS}><rect><animate attributeName="x" to="9"/></rect></svg>`,
    verdict: "reject",
    reason: /disallowed element: animate/i,
  },
  {
    name: "DOCTYPE entity bomb (XXE)",
    input: `<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg ${XMLNS}><text>&xxe;</text></svg>`,
    verdict: "reject",
    reason: /DOCTYPE/i,
  },
  {
    name: "external url() paint-server in fill",
    input: `<svg ${XMLNS}><rect fill="url(https://evil.example/p)"/></svg>`,
    verdict: "reject",
    reason: /external url\(\)/i,
  },
  {
    name: "entity-obfuscated javascript: in fill",
    input: `<svg ${XMLNS}><rect fill="&#106;avascript:alert(1)"/></svg>`,
    verdict: "reject",
    reason: /javascript: URI/i,
  },
  {
    // minor-3: a quote inside an attribute-NAME position (not a value) must
    // not be silently absorbed into the name and re-emitted unescaped — that
    // would re-open a live onload= handler in the sanitizer's OWN output.
    name: "attribute-name injection: a quote breaks out into a bogus onload=",
    input: `<svg ${XMLNS}><rect data-x"onload="alert(1)"/></svg>`,
    verdict: "reject",
    reason: /malformed attribute/i,
  },
  {
    // minor-3: an angle bracket inside an attribute-NAME position must not be
    // silently absorbed either — that would re-open a live <script in output.
    name: "attribute-name injection: an angle bracket breaks out into <script",
    input: `<svg ${XMLNS}><rect aria-x<script=""/></svg>`,
    verdict: "reject",
    reason: /malformed attribute/i,
  },
  {
    name: "disallowed attribute (style) on a shape",
    input: `<svg ${XMLNS}><rect style="background:url(https://evil.example)"/></svg>`,
    verdict: "reject",
    reason: /disallowed attribute: style/i,
  },
  {
    name: "non-<svg> root (allowed element, wrong root)",
    input: `<g><rect/></g>`,
    verdict: "reject",
    reason: /root element must be <svg>/i,
  },
  {
    name: "oversize (> 512KB)",
    input: `<svg ${XMLNS}><desc>${"a".repeat(SVG_MAX_BYTES + 10)}</desc></svg>`,
    verdict: "reject",
    reason: /size limit/i,
  },
  {
    name: "too many elements (DoS bound)",
    input: `<svg ${XMLNS}>${"<rect/>".repeat(SVG_MAX_ELEMENTS + 100)}</svg>`,
    verdict: "reject",
    reason: /element limit/i,
  },
  {
    name: "empty string",
    input: "   ",
    verdict: "reject",
    reason: /empty/i,
  },
  {
    name: "not a string",
    input: null,
    verdict: "reject",
    reason: /not a string/i,
  },
];

const ACCEPT_CASES: Case[] = [
  {
    name: "minimal path logo",
    input: `<svg ${XMLNS} viewBox="0 0 24 24"><path d="M1 1 L2 2 Z" fill="#f00"/></svg>`,
    verdict: "accept",
  },
  {
    name: "gradient with a LOCAL url(#id) paint ref",
    input: `<svg ${XMLNS} viewBox="0 0 100 100"><defs><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><circle cx="50" cy="50" r="40" fill="url(#g)"/></svg>`,
    verdict: "accept",
  },
  {
    name: "group + transform + multiple shapes",
    input: `<svg ${XMLNS} viewBox="0 0 24 24"><g transform="rotate(45 12 12)" opacity="0.8"><rect x="0" y="0" width="10" height="10" rx="2"/><circle cx="5" cy="5" r="3" stroke="#000" stroke-width="2"/><polyline points="0,0 5,5 10,0" fill="none"/></g></svg>`,
    verdict: "accept",
  },
  {
    name: "title + desc + text + tspan",
    input: `<svg ${XMLNS} viewBox="0 0 50 20"><title>Acme Logo</title><desc>Brand mark</desc><text x="0" y="15" font-size="12" text-anchor="start">Hi<tspan fill="#00f">!</tspan></text></svg>`,
    verdict: "accept",
  },
  {
    name: "safe data:image/png in href (the single carve-out)",
    input: `<svg ${XMLNS}><rect href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="/></svg>`,
    verdict: "accept",
  },
  {
    name: "aria/role/data attributes",
    input: `<svg ${XMLNS} role="img" aria-label="Acme" data-brand="acme"><rect width="4" height="4"/></svg>`,
    verdict: "accept",
  },
  {
    name: "large-but-valid (under both DoS bounds)",
    input: `<svg ${XMLNS}>${'<rect x="0" y="0" width="1" height="1"/>'.repeat(500)}</svg>`,
    verdict: "accept",
  },
];

function run(input: unknown): SanitizeSvgResult {
  return sanitizeSvg(input);
}

describe("sanitizeSvg — reject battery", () => {
  for (const c of REJECT_CASES) {
    it(`rejects: ${c.name}`, () => {
      const res = run(c.input);
      expect(res.ok, `expected REJECT for "${c.name}"`).toBe(false);
      if (!res.ok && c.reason) {
        expect(res.reason).toMatch(c.reason);
      }
    });
  }
});

describe("sanitizeSvg — accept battery", () => {
  for (const c of ACCEPT_CASES) {
    it(`accepts: ${c.name}`, () => {
      const res = run(c.input);
      expect(res.ok, `expected ACCEPT for "${c.name}"`).toBe(true);
      if (res.ok) {
        // A passed SVG never carries a script/handler/foreignObject after
        // re-serialization.
        expect(res.svg).not.toMatch(/<script/i);
        expect(res.svg).not.toMatch(/onload=/i);
        expect(res.svg).not.toMatch(/<foreignobject/i);
        expect(res.svg.startsWith("<svg")).toBe(true);
      }
    });
  }
});

describe("sanitizeSvg — re-serialization guarantees", () => {
  it("strips comments and the <?xml?> processing instruction", () => {
    const res = run(`<?xml version="1.0" encoding="UTF-8"?><!-- author note --><svg ${XMLNS}><rect/></svg>`);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.svg).not.toContain("<!--");
      expect(res.svg).not.toContain("<?xml");
      expect(res.svg).toContain("<rect");
    }
  });

  it("injects a root xmlns when the upload omits it", () => {
    const res = run(`<svg viewBox="0 0 10 10"><path d="M0 0 L1 1"/></svg>`);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    }
  });

  it("preserves case-sensitive element + attribute names", () => {
    const res = run(
      `<svg ${XMLNS} viewBox="0 0 2 2"><defs><radialGradient id="r"><stop offset="0" stop-color="#000"/></radialGradient></defs><rect fill="url(#r)" width="2" height="2"/></svg>`,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      // lowercasing these would break rendering in an XML (image/svg+xml) doc.
      expect(res.svg).toContain("radialGradient");
      expect(res.svg).toContain("viewBox");
      expect(res.svg).toContain("url(#r)");
    }
  });

  it("keeps a local url(#id) paint ref but the same shape rejects an external url()", () => {
    const good = run(`<svg ${XMLNS}><rect fill="url(#grad)"/></svg>`);
    const bad = run(`<svg ${XMLNS}><rect fill="url(http://evil.example)"/></svg>`);
    expect(good.ok).toBe(true);
    expect(bad.ok).toBe(false);
  });

  it("neutralizes an attribute-value quote so it cannot break out", () => {
    // A crafted value that tries to inject onload= via a quote/entity is
    // decoded, validated, then re-escaped — the emitted attribute is inert.
    const res = run(`<svg ${XMLNS}><rect id="a&quot;b" width="1" height="1"/></svg>`);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.svg).not.toMatch(/onload/i);
      expect(res.svg).toContain("&quot;");
    }
  });

  // minor-3 control: well-formed aria-/data- attribute NAMES (the identifier
  // charset [A-Za-z0-9:_-]) survive the attribute-name hardening completely
  // unaffected — the hardening only rejects a NAME containing a character
  // outside that set (a quote, an angle bracket, …), never a legitimate one.
  it("valid data-/aria- attributes pass through byte-verbatim (attribute-name hardening control)", () => {
    const res = run(
      `<svg ${XMLNS}><rect data-brand="acme-mark" aria-label="Acme logo" width="4" height="4"/></svg>`,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.svg).toContain('data-brand="acme-mark"');
      expect(res.svg).toContain('aria-label="Acme logo"');
    }
  });
});
