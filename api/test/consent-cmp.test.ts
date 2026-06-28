// rescue-7: the consent/CMP loader (e.g. InMobi Choice) is a SCRIPT setting
// (consent_head_html) emitted FIRST in <head> — before the ad provider (gpt.js)
// — so the IAB __tcfapi/__gpp/__uspapi stubs exist and GPT waits for / reads
// consent. Asserts the loader survives the allowScript sanitiser intact and is
// positioned before the ad script.
import { describe, it, expect } from "vitest";
import { renderConsentHead } from "../src/settings/custom-html";
import { renderLayout } from "../src/public/templates/layout";

// Representative IAB CMP loader (InMobi Choice shape): an async external loader +
// inline __tcfapi/__gpp/__uspapi stubs. Uses addEventListener (NOT inline on*=),
// so it must pass the allowScript sanitiser byte-intact.
const CMP_TAG =
  `<script type="text/javascript" async=true>` +
  `(function(){var el=document.createElement('script');` +
  `el.src='https://cmp.inmobi.com'.concat('/choice/','r3NbPNJPMxRHy','/',window.location.hostname,'/choice.js?tag_version=V3');` +
  `document.getElementsByTagName('script')[0].parentNode.insertBefore(el,null);` +
  `function makeStub(){window.__tcfapi=function(){};window.addEventListener('message',function(){},false);}makeStub();` +
  `function makeGppStub(){window.__gpp=function(){};}makeGppStub();` +
  `window.__uspapi=function(){};})();` +
  `</script>`;

describe("consent CMP head (rescue-7)", () => {
  it("emits the CMP loader and preserves the IAB stub markers (sanitiser-safe)", () => {
    const out = renderConsentHead({ consent_head_html: CMP_TAG });
    expect(out).toContain("cmp.inmobi.com");
    expect(out).toContain("__tcfapi");
    expect(out).toContain("__gpp");
    expect(out).toContain("__uspapi");
    expect(out).toContain("addEventListener"); // stub wiring preserved (no on*= stripping)
    expect(out).toContain("<script");
  });

  it("is empty when unset, so the head stays byte-identical on non-CMP sites", () => {
    expect(renderConsentHead({})).toBe("");
  });

  it("renders the CMP BEFORE the ad provider (gpt.js) so GPT waits for consent", () => {
    const html = renderLayout({
      site: { name: "T", hostname: "t.example" },
      meta: { title: "T" },
      body: "<p>x</p>",
      consentHead: `<!-- cmp --><script src="https://cmp.inmobi.com/x"></script>`,
      extraHead: `<script src="https://securepubads.g.doubleclick.net/tag/js/gpt.js"></script>`,
    });
    const cmpPos = html.indexOf("cmp.inmobi.com");
    const gptPos = html.indexOf("gpt.js");
    expect(cmpPos).toBeGreaterThan(-1);
    expect(gptPos).toBeGreaterThan(-1);
    expect(cmpPos).toBeLessThan(gptPos);
  });
});
