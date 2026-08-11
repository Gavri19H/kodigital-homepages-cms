// LeadGen — "The Zip box behave weird … doesn't allow you to type the 2nd [char]".
//
// Owner, 2026-08-11, on the LIVE insurissimo funnel: the ZIP box shows warning
// signs after one character and refuses the next; "the only option is to paste a
// 5 digit number into it."
//
// ROOT CAUSE, measured on the live page (not inferred): Google's Places
// Autocomplete validates the API key's HTTP referrer on its FIRST PREDICTION
// REQUEST — which is the visitor's first keystroke. `insurissimo.com` is not in
// that key's allowlist, so `RefererNotAllowedMapError` fired and GOOGLE's default
// auth-failure handler reached into the input we handed its widget:
//     disabled = true                        ← no 2nd character possible
//     class   += " gm-err-autocomplete"
//     style    = background-image:…/icon_error.png   ← tiles across the box = the "signs"
//     placeholder = "Oops! Something went wrong."
// and the disable BLURRED the field, so even after re-enabling, keystrokes went to
// the document. A paste still worked because one paste delivers all five digits in
// a single event.
//
// Nothing in this repo sets `disabled` on a leadgen field. runtime/maps.ts already
// degrades gracefully when the SDK is ABSENT or fails to LOAD; the third case — it
// loads and then REJECTS the key — had no answer, and it is the one that kills the
// FIRST field of an address funnel for every visitor.
//
// THE FIX: the shell installs Google's documented `gm_authFailure` hook next to
// the key it injects, snapshots each enhanced input BEFORE Google can touch it, and
// on failure hands the field back — enabled, exactly as authored, with the caret
// where the visitor left it. Autocomplete is a convenience; the box is the product.
//
// DRIVEN (recorded here because this lane is not a browser): on the real
// production funnel with the real failure firing (hook called: 1), typing
// 9-0-2-1-0 with NO clicks produced "90210", the field stayed enabled and focused,
// and class/placeholder/style matched their pre-Google values byte for byte.

import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";

import { MAPS_AUTH_GUARD_JS } from "../src/public/leadgen/serve";

// The served-bytes half of this fix — that the guard reaches the page, and ONLY
// when a browser key does — is asserted in test/leadgen-runtime-api.test.ts, next
// to the existing key-splice tests, where the activated-funnel harness lives.
// This file is about what the shipped string DOES.

describe("the guard's shape (the three things a broken widget does, all undone)", () => {
  it("undoes disable, Google's class, and its injected background, and returns the caret", () => {
    expect(MAPS_AUTH_GUARD_JS).toContain("window.gm_authFailure=");
    expect(MAPS_AUTH_GUARD_JS).toContain("e.disabled=false");
    expect(MAPS_AUTH_GUARD_JS).toContain("gm-err-autocomplete");
    expect(MAPS_AUTH_GUARD_JS).toContain("e.style.backgroundImage=''");
    expect(MAPS_AUTH_GUARD_JS).toContain("setSelectionRange");
    // it must snapshot BEFORE Google can touch anything — either immediately or
    // at DOMContentLoaded, never lazily at failure time (too late by then).
    expect(MAPS_AUTH_GUARD_JS).toContain("DOMContentLoaded");
  });
});

// ---------------------------------------------------------------------------
// 2. The guard EXECUTED against Google's exact mutation.
//
// No DOM library is available in this suite (environment: "node", and adding a
// dependency for a test is not on the table), so the document is a minimal stub
// and the GUARD is the real exported string the shell splices — not a copy. That
// is the E11 split: the artifact under test is real, the harness around it is not.
// The pixel half is the conductor's live drive, quoted in the banner above.
// ---------------------------------------------------------------------------

interface StubInput {
  disabled: boolean;
  placeholder: string;
  className: string;
  value: string;
  style: { backgroundImage: string };
  attrs: Record<string, string | null>;
  classList: { remove: (c: string) => void };
  getAttribute: (n: string) => string | null;
  setAttribute: (n: string, v: string) => void;
  removeAttribute: (n: string) => void;
  addEventListener: (t: string, fn: () => void) => void;
  focus: () => void;
  setSelectionRange: (a: number, b: number) => void;
  focused: boolean;
  caret: [number, number] | null;
}

function stubInput(style: string | null, placeholder: string, className: string, value = ""): StubInput {
  const el: StubInput = {
    disabled: false,
    placeholder,
    className,
    value,
    style: { backgroundImage: "" },
    attrs: { style },
    classList: {
      remove: (c: string) => {
        el.className = el.className
          .split(" ")
          .filter((x) => x !== c && x !== "")
          .join(" ");
      },
    },
    getAttribute: (n: string) => (n in el.attrs ? (el.attrs[n] ?? null) : null),
    setAttribute: (n: string, v: string) => {
      el.attrs[n] = v;
    },
    removeAttribute: (n: string) => {
      el.attrs[n] = null;
    },
    addEventListener: () => {
      /* the live path also seeds `f` from activeElement; see the guard */
    },
    focus: () => {
      el.focused = true;
    },
    setSelectionRange: (a: number, b: number) => {
      el.caret = [a, b];
    },
    focused: false,
    caret: null,
  };
  return el;
}

/** The shipped string itself — no copy, no paraphrase. */
function servedGuard(): string {
  return MAPS_AUTH_GUARD_JS;
}

/** Google's documented auth-failure damage, applied exactly as measured live. */
function googleBreaksIt(el: StubInput): void {
  el.disabled = true;
  el.className += " gm-err-autocomplete";
  el.placeholder = "Oops! Something went wrong.";
  el.setAttribute("style", "padding-left:42px;background-image:url(icon_error.png)");
  el.style.backgroundImage = "url(icon_error.png)";
  el.focused = false; // disabling blurs it — the reason the caret needed restoring
}

describe("the guard, executed against Google's exact mutation", () => {
  const run = (opts: { autofocused: boolean; style?: string | null }) => {
    const guard = servedGuard();
    const el = stubInput(opts.style === undefined ? "padding-left:42px" : opts.style, "ZIP code", "lg-input pac-target-input", "9");
    const doc = {
      readyState: "complete",
      activeElement: opts.autofocused ? (el as unknown) : null,
      body: { BODY: true },
      querySelectorAll: (sel: string) => {
        expect(sel).toBe("[data-lg-maps] [data-lg-input]");
        return [el];
      },
      addEventListener: () => {
        /* not used at readyState complete */
      },
    };
    const sandbox: Record<string, unknown> = { document: doc };
    sandbox["window"] = sandbox;
    runInNewContext(guard, sandbox);
    // the snapshot has been taken; NOW Google fails
    googleBreaksIt(el);
    doc.activeElement = doc.body as unknown; // focus orphaned by the disable
    (sandbox["gm_authFailure"] as () => void)();
    return el;
  };

  it("hands the field back: enabled, authored placeholder, authored class, authored style", () => {
    const el = run({ autofocused: true });
    expect(el.disabled, "the visitor can type again").toBe(false);
    expect(el.placeholder, "not left saying 'Oops! Something went wrong.'").toBe("ZIP code");
    expect(el.className, "Google's error class is gone, ours intact").toBe("lg-input pac-target-input");
    expect(el.getAttribute("style"), "the authored inline style, exactly").toBe("padding-left:42px");
    expect(el.style.backgroundImage, "no tiled error icon").toBe("");
  });

  it("returns the caret so the NEXT keystroke lands (the autofocus case)", () => {
    const el = run({ autofocused: true });
    // An address funnel autofocuses its first field, and focus() on an
    // already-focused input fires NO focus event — so a focus LISTENER alone left
    // this null and the visitor's 2nd/3rd characters still went to the document
    // (measured live before this line existed).
    expect(el.focused, "refocused after Google's disable blurred it").toBe(true);
    expect(el.caret, "caret at the end of what was already typed").toEqual([1, 1]);
  });

  it("does NOT steal focus when the visitor has moved elsewhere", () => {
    // never focused ⇒ nothing to return the caret to; the field is still repaired
    const el = run({ autofocused: false });
    expect(el.disabled).toBe(false);
    expect(el.focused, "no focus theft").toBe(false);
  });

  it("an input with no inline style is restored to having none", () => {
    const el = run({ autofocused: true, style: null });
    expect(el.getAttribute("style")).toBeNull();
  });
});
