# B1 after-fix — conductor-driven acceptance (contract §5 B1 / R1-1)

Branch `leadgen-r2-p8-1`, local worker :8901, real Chromium, 2026-08-03.
Probe: `api/scripts/p8/probe-b1.mjs` (evidence tooling — not wired into CI).
Raw run: `probe-b1-after.txt`. Screenshots: `multi-field-address-autocomplete-job-on--1280.png`, `-375.png`.

## Contract acceptance, leg by leg

| Leg | Contract wording | Measured after | Verdict |
|---|---|---|---|
| Wire shape | producer nested vs consumer flat | served attr is now `{"enable_autocomplete":true,"validate":false,"fills":{city,state,zip}}` — one shape; nested emitter deleted | fixed |
| Constructor | "the `Autocomplete` constructor is invoked ≥1 (intercept it)" | **1** (was 0), args `{id:"lg-addr-p8_addr_street", fields:["address_components","formatted_address"]}` | PASS |
| Google's own signal | — | `.pac-container` = 1 (Google creates one per live widget) | corroborates |
| No wasted load | "no Maps JS is loaded when no job is enabled" | all-manual address authored via the real PATCH route → `data-lg-maps` attrs **0**, SDK `<script>` tags **0**, SDK requests **0** | PASS |
| Typing → suggestions → fill | "typing produces suggestions, and choosing one fills the mapped fields" | 0 predictions; Google returned **`gm_authFailure: true`** | INCONCLUSIVE — see below |

## Why the typing leg is INCONCLUSIVE, not FAIL

The owner supplied `GOOGLE_MAPS_SERVER_KEY` (IP-whitelisted to Cloudflare IPs) because the
browser key is URL-whitelisted to production and cannot be exercised from 127.0.0.1. Google's
own answer, recorded rather than assumed: the JS bundle loads (9 requests, all HTTP 200) and the
runtime constructs the widget, but the first Places *prediction* request trips
`gm_authFailure` — the key's restriction rejecting a localhost referer. This is Google's
verdict on the KEY, not on the product: everything on our side of the boundary is proven.

**Named resolution step (E12):** at cutover, on the live site with the URL-whitelisted browser
key, type a street address and confirm predictions appear and choosing one fills city/state/ZIP.

## Interceptor honesty note

Two earlier probe runs reported `ctorCalls: 0` while `.pac-container` was already 1. That was a
PROBE artifact — the wrap attached after the runtime had already constructed the widget. It was
NOT written up as a product failure; the probe was corrected to intercept the product's own
`__LG_MAPS_ON_READY__` hook (wrap-then-delegate), which guarantees the wrap precedes
construction. The reported 1 is a real intercepted call with real arguments.

## Finding beyond the contract (surfaced, not fixed) — see register ADJ-P8-2

When the SDK is attached and Google REJECTS the key, the street input degrades badly: typing
22 characters landed **5** (`"1600 "`), and the input carries Google's own `gm-err-autocomplete`
class with warning glyphs painted over it (visible in the 1280 screenshot).
Same-page control, same keystrokes, Maps off: street **22/22** and city **22/22** characters
landed, class plain `lg-input`. So a misconfigured/misscoped production key does not degrade to
honest manual entry — it degrades the visitor's ability to type their address at all, on the
money path. The contract's proven "keyless degrades honestly" case is a DIFFERENT state (no key
→ no SDK → plain input, which measured clean here). Owner ruling requested.
