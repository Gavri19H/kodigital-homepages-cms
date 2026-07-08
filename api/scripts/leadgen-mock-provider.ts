// LeadGen fix-contract v2.4 — LOCAL mock provider for the Group-1 live-funnel
// Playwright suite (11 §11.2 / 12 Phase 1 "mock provider fixtures").
//
// WHY THIS EXISTS: the Worker's provider fetch (public/leadgen/auction/
// fetch.ts) runs SERVER-side inside wrangler dev, so Playwright's browser
// network interception can never see it. The suite therefore points the
// seeded Offer's endpoint_staging AND endpoint_production at THIS real local
// HTTP server (http://127.0.0.1:8788/mock) and asserts the payload the
// provider actually RECEIVED via GET /__requests — the user-DoD "payload
// contains real ua + traffic + computed + placement" evidence.
//
// Surface (consumed by test-ui/leadgen-live-funnel.spec.ts + the seed):
//   POST /mock        → 200, the canned realistic provider body (2 carriers +
//                       a top-level slug-ish `quote_ref` the Offer's
//                       {response:quote_ref} banner macro resolves) — and the
//                       request (method/url/headers/body) is captured.
//   GET  /__requests  → 200, JSON array of every captured /mock request
//                       ({method,url,headers,body,received_at}) in order.
//   POST /__reset     → 204, clears the captured list.
//
// Runs as the SECOND playwright.config.ts webServer entry (port 8788,
// reuseExistingServer like the wrangler entry). Node http only — no deps.
// The carriers deliberately carry NO click_url: the click resolver then
// resolves the Offer's banner_url_template (canonical macros + {response:*})
// — the exact 11 §11.2 "/lg/lc 302 with resolved macros" leg under test.

import http from "node:http";

const PORT = 8788;
const HOST = "127.0.0.1";

interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  received_at: number;
}

const captured: CapturedRequest[] = [];

// The canned provider response. Field names mirror a realistic quote-API
// shape; the seed's carrier_parse_json maps them onto the canonical Carrier
// (parse.ts). `quote_ref` is the top-level slug-ish field the banner URL
// template's {response:quote_ref} resolves from response_redacted_json.
// No click_url on purpose (see module header).
// Logo URLs point BACK at this server (GET /logos/*.png → a real 1x1 PNG):
// an unroutable logo host would log browser console errors and render broken
// images in the banner screenshots.
export const MOCK_PROVIDER_BODY = {
  status: "ok",
  quote_ref: "mockref-a7x42",
  carriers: [
    {
      id: "acme-life",
      name: "Acme Life",
      logo: "http://127.0.0.1:8788/logos/acme.png",
      bid: 12.5,
      currency: "USD",
      headline: "Acme Life — Coverage in minutes",
      tracking: "trk-acme-001",
    },
    {
      id: "zenith-shield",
      name: "Zenith Shield",
      logo: "http://127.0.0.1:8788/logos/zenith.png",
      bid: 9.75,
      currency: "USD",
      headline: "Zenith Shield — Rated A+",
      tracking: "trk-zenith-002",
    },
  ],
} as const;

// 1x1 transparent PNG for the /logos/*.png route.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(""));
  });
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  void (async () => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    const path = url.split("?")[0] ?? "/";

    if (method === "POST" && path === "/mock") {
      const body = await readBody(req);
      captured.push({
        method,
        url,
        headers: { ...req.headers },
        body,
        received_at: Date.now(),
      });
      sendJson(res, 200, MOCK_PROVIDER_BODY);
      return;
    }
    if (method === "GET" && path === "/__requests") {
      sendJson(res, 200, captured);
      return;
    }
    if (method === "POST" && path === "/__reset") {
      captured.length = 0;
      res.writeHead(204, { "cache-control": "no-store" });
      res.end();
      return;
    }
    // Banner logo assets (see MOCK_PROVIDER_BODY.carriers[].logo).
    if (method === "GET" && path.startsWith("/logos/") && path.endsWith(".png")) {
      res.writeHead(200, {
        "content-type": "image/png",
        "content-length": PNG_1PX.length,
        "cache-control": "no-store",
      });
      res.end(PNG_1PX);
      return;
    }
    // Health probe for the playwright webServer readiness check.
    if (method === "GET" && (path === "/" || path === "/health")) {
      sendJson(res, 200, { ok: true, service: "leadgen-mock-provider", captured: captured.length });
      return;
    }
    sendJson(res, 404, { error: "not found" });
  })().catch(() => {
    try {
      res.writeHead(500, { "content-type": "application/json" });
      res.end('{"error":"internal"}');
    } catch {
      /* response already sent */
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[leadgen-mock-provider] listening on http://${HOST}:${PORT} (POST /mock, GET /__requests, POST /__reset)`);
});
