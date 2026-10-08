// OWNER 2026-10-08 — LeadGen data written to Firehose → Athena leadgen.events:
//   1. names on every event + session record, resolved server-side from D1
//      (quote / funnel / site from Host / frame template / section);
//   2. answer events carry question_key / question_label / answer_label;
//   3. contact answers stored as SHA-256 of the Meta-normalised value (R3);
//   4. CPC banner clicks book revenue on EVERY click (R1), cpl/cpa/cpi book none,
//      plus Meta fbp from the _fbp cookie (and fbc on /lg/track);
//   5. auction_offer_response carries bid_value (best USD bid) + bids_count;
//   6. /lg/auction persists HASHED meta_user_data in the macro snapshot;
//   7. the S3→ClickHouse loader still maps records carrying the new fields.
// Driven through the REAL surfaces (POST /lg/track router, resolveLeadgenClick,
// runAuction + persistAuctionResult) against a node:sqlite D1 seeded with the
// real migrations, with Firehose + providers intercepted.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import type { Env } from "../src/env";
import { leadgenTrackRouter } from "../src/analytics/leadgen-track";
import {
  buildAuctionMetaUserData,
  buildSectionFacts,
  answerWordsFor,
  resetLeadgenEnrichCaches,
  leadgenEnrichCacheSizes,
  resolveLeadgenFunnelNames,
  ENRICH_CACHE_MAX_ENTRIES,
} from "../src/analytics/leadgen-enrich";
import {
  hashMetaUserData,
  normalizeMetaDob,
  normalizeMetaPhone,
  normalizeMetaState,
  normalizeMetaZip,
  normalizeMetaCity,
  readFbpCookie,
  readFbcCookie,
  sha256Hex,
} from "../src/leadgen/meta-hash";
import { resolveLeadgenClick, type LeadgenClickInput } from "../src/public/leadgen/click";
import { loadAuctionBundle, persistAuctionResult, runAuction } from "../src/public/leadgen/auction/engine";
import { blankLeadgenEvent, leadgenSessionFromQuoteView } from "../src/analytics/leadgen-events";
import { mapRecordToRow } from "../src/analytics/event-loader";
import type { LeadgenSectionRow } from "../src/admin/leadgen/db-types";
import {
  API_ROOT,
  attachOffer,
  buildLeadgenEnv,
  carrierBody,
  createLeadgenDb,
  ctxCapture,
  d1FromSqlite,
  loadDatabaseSync,
  makeKvStub,
  makeResolved,
  NO_BINDING,
  seedAuction,
  seedAuctionOffer,
  settle,
  stubLeadgenFetch,
  type DatabaseSyncCtor,
  type SqliteDb,
} from "./helpers/leadgen-analytics-harness";

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function sha(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

const FBP = "fb.1.1700000000000.1234567890";
const FBC = "fb.1.1700000000001.IwAR-cookie_click";

beforeEach(() => {
  resetLeadgenEnrichCaches();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

interface Seeded {
  sdb: SqliteDb;
  env: Env;
}

function harness(opts: { firehose?: boolean } = {}): Seeded {
  const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
  // 0055 (per-quote default template) is not in the shared harness list.
  (sdb["exec"] as (s: string) => void)(readFileSync(join(API_ROOT, "migrations", "0055_leadgen_quote_default_template.sql"), "utf8"));
  const { kv } = makeKvStub();
  return { sdb, env: buildLeadgenEnv(d1FromSqlite(sdb), kv, { firehose: opts.firehose ?? true }) };
}

function templateRow(sdb: SqliteDb, id: number): { public_id: string; name: string } {
  return sdb.prepare("SELECT public_id, name FROM leadgen_frame_templates WHERE id = ?").get(id) as { public_id: string; name: string };
}

// quote → funnel → variant (each with its own frame_template_id, nullable).
function seedFunnel(
  sdb: SqliteDb,
  o: { quote: string; funnel: string; variant: string; funnelTpl: number | null; variantTpl: number | null; quoteDefaultTpl?: number | null },
): void {
  sdb.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json, status) VALUES (?, ?, 'quote_funnel', '[]', 'active')").run(o.quote, `Quote ${o.quote}`);
  const q = sdb.prepare("SELECT id FROM leadgen_quotes WHERE public_id = ?").get(o.quote) as { id: number };
  sdb
    .prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status, frame_template_id) VALUES (?, ?, ?, 'active', ?)")
    .run(o.funnel, q.id, `Funnel ${o.funnel}`, o.funnelTpl);
  const f = sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?").get(o.funnel) as { id: number };
  sdb.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, frame_template_id) VALUES (?, ?, ?)").run(o.variant, f.id, o.variantTpl);
  if (o.quoteDefaultTpl !== undefined) {
    sdb.prepare("INSERT OR REPLACE INTO leadgen_quote_default_template (quote_public_id, frame_template_id) VALUES (?, ?)").run(o.quote, o.quoteDefaultTpl);
  }
}

function seedSection(sdb: SqliteDb, publicId: string, name: string, headline: string, components: unknown[]): void {
  sdb
    .prepare("INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json) VALUES (?, ?, 'quote_funnel', 'home', ?, ?)")
    .run(publicId, name, headline, JSON.stringify({ components }));
}

const CHOICE_SECTION = [
  { type: "QuestionHeadline", question_id: "qh1", props: { text: "Do you own or rent?" } },
  {
    type: "ButtonAnswerGroup",
    question_id: "q_own",
    internal_field: "homeowner",
    choices: [
      { label: "I own", value: "own", analytics_id: "a1" },
      { label: "I rent", value: "rent", analytics_id: "a2" },
    ],
  },
  {
    type: "MultiChoiceCardGroup",
    question_id: "q_cov",
    internal_field: "coverage",
    props: { label: "Coverage you want" },
    choices: [
      { label: "Fire", value: "fire", analytics_id: "c1" },
      { label: "Flood", value: "flood", analytics_id: "c2" },
      { label: "Theft", value: "theft", analytics_id: "c3" },
    ],
  },
  { type: "NumberRangeQuestion", question_id: "q_val", internal_field: "home_value", props: { min: 0, max: 1000000 } },
  { type: "TwoButtonYesNo", question_id: "q_yn", internal_field: "has_pool", props: { label: "Pool?", yesLabel: "Yes, I have one", noLabel: "No pool" } },
];

const CONTACT_SECTION = [
  { type: "EmailInputQuestion", question_id: "q_em", internal_field: "email", props: { label: "Email" } },
  { type: "PhoneInputQuestion", question_id: "q_ph", internal_field: "phone", props: { label: "Phone" } },
  { type: "NameFieldsGroup", question_id: "q_name", props: { label: "Your name" } },
  { type: "DateQuestion", question_id: "q_dob", internal_field: "date_of_birth", props: { label: "Date of birth" } },
  { type: "AddressAutocompleteQuestion", question_id: "q_addr", internal_field: "addr", props: { label: "Home address" } },
  { type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip", props: { label: "ZIP" } },
  { type: "FreeTextQuestion", question_id: "q_note", internal_field: "notes", props: { label: "Notes", pii: true } },
  { type: "FreeTextQuestion", question_id: "q_occ", internal_field: "occupation", props: { label: "Occupation" } },
];

// ---------------------------------------------------------------------------
// /lg/track driver
// ---------------------------------------------------------------------------

function trackApp(): Hono<{ Bindings: Env }> {
  const a = new Hono<{ Bindings: Env }>();
  a.route("/", leadgenTrackRouter);
  return a;
}

async function track(env: Env, events: Array<Record<string, unknown>>, headers: Record<string, string> = {}, host = "one.example.com"): Promise<{ status: number; records: Array<Record<string, unknown>> }> {
  const stub = stubLeadgenFetch();
  const cap = ctxCapture();
  const res = await trackApp().request(
    new Request(`https://${host}/lg/track`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ events }),
    }),
    undefined,
    env,
    cap.ctx,
  );
  await settle(cap.promises);
  return { status: res.status, records: stub.firehoseRecords as unknown as Array<Record<string, unknown>> };
}

let seq = 0;
function ev(eventType: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  seq += 1;
  return {
    event_type: eventType,
    event_id: `ev-${seq}-${Math.random().toString(36).slice(2)}`,
    session_id: "sid-1",
    page_view_id: "pv-1",
    funnel_attempt_id: "fa-1",
    quote_id: "lgq_home",
    funnel_id: "lgf_home",
    funnel_variant_id: "lgn_home",
    url: "https://one.example.com/lg/home-insurance?fbclid=CLICK123",
    fbclid: "CLICK123",
    timestamp: Date.now(),
    ...extra,
  };
}

function eventsOf(records: Array<Record<string, unknown>>, type?: string): Array<Record<string, unknown>> {
  return records.filter((r) => r.record_kind === "event" && (type === undefined || r.event_type === type));
}

// ---------------------------------------------------------------------------
// 1. names from D1
// ---------------------------------------------------------------------------

describeDb("1. names on every /lg/track event + session record, resolved server-side", () => {
  it("fills quote_name / funnel_name / template (variant's) / site_id from Host / section_name, ignoring client-sent names", async () => {
    const { sdb, env } = harness();
    seedFunnel(sdb, { quote: "lgq_home", funnel: "lgf_home", variant: "lgn_home", funnelTpl: 2, variantTpl: 4, quoteDefaultTpl: 6 });
    seedSection(sdb, "lgs_own", "Ownership", "Tell us about your home", CHOICE_SECTION);
    const { status, records } = await track(env, [
      ev("quote_view", { quote_name: "FAKE", funnel_name: "FAKE", site_id: "" }),
      ev("section_view", { section_id: "lgs_own", section_name: "FAKE" }),
    ]);
    expect(status).toBe(204);
    const tpl = templateRow(sdb, 4);
    const qv = eventsOf(records, "quote_view")[0]!;
    expect(qv.quote_name).toBe("Quote lgq_home");
    expect(qv.funnel_name).toBe("Funnel lgf_home");
    expect(qv.template_id).toBe(tpl.public_id);
    expect(qv.template_name).toBe("Full background");
    expect(qv.site_id).toBe("site-1");
    const sv = eventsOf(records, "section_view")[0]!;
    expect(sv.section_name).toBe("Ownership");
    expect(sv.quote_name).toBe("Quote lgq_home");
    // the session record carries the names too
    const session = records.find((r) => r.record_kind === "session")!;
    expect(session.quote_name).toBe("Quote lgq_home");
    expect(session.funnel_name).toBe("Funnel lgf_home");
    expect(session.template_name).toBe("Full background");
    expect(session.site_id).toBe("site-1");
  });

  it("template precedence: variant → funnel → the quote's default", async () => {
    const { sdb, env } = harness();
    seedFunnel(sdb, { quote: "lgq_a", funnel: "lgf_a", variant: "lgn_a", funnelTpl: 3, variantTpl: null });
    seedFunnel(sdb, { quote: "lgq_b", funnel: "lgf_b", variant: "lgn_b", funnelTpl: null, variantTpl: null, quoteDefaultTpl: 5 });
    const a = await resolveLeadgenFunnelNames(env.DB, { quote_id: "lgq_a", funnel_id: "lgf_a", funnel_variant_id: "lgn_a" });
    expect(a.template_name).toBe("Header + call CTA");
    expect(a.template_id).toBe(templateRow(sdb, 3).public_id);
    const b = await resolveLeadgenFunnelNames(env.DB, { quote_id: "lgq_b", funnel_id: "lgf_b", funnel_variant_id: "lgn_b" });
    expect(b.template_name).toBe("White + trust bar");
    // only a funnel id: the quote is found through the funnel
    const c = await resolveLeadgenFunnelNames(env.DB, { funnel_id: "lgf_a" });
    expect(c.quote_name).toBe("Quote lgq_a");
    expect(c.quote_id).toBe("lgq_a");
  });

  it("unknown ids leave every name empty without throwing (still 204, still emitted)", async () => {
    const { env } = harness();
    const { status, records } = await track(
      env,
      [ev("answer_click", { quote_id: "lgq_nope", funnel_id: "lgf_nope", funnel_variant_id: "lgn_nope", section_id: "lgs_nope", question_id: "q_nope", answer_value_normalized: "own", quote_name: "FAKE" })],
      {},
      "unknown.example.org",
    );
    expect(status).toBe(204);
    const e = eventsOf(records, "answer_click")[0]!;
    expect(e).toBeDefined();
    for (const k of ["quote_name", "funnel_name", "template_id", "template_name", "section_name", "question_key", "question_label", "answer_label", "site_id"]) {
      expect(e[k], k).toBe("");
    }
    expect(e.answer_value_normalized).toBe("own");
    expect(e.answer_hashed).toBe(false);
  });

  it("a D1 that throws never drops the event (fail-open)", async () => {
    const { env } = harness();
    const throwing = { prepare() { throw new Error("d1 down"); } } as unknown as D1Database;
    const broken = { ...env, DB: throwing } as Env;
    const { status, records } = await track(broken, [ev("quote_view")]);
    expect(status).toBe(204);
    expect(eventsOf(records, "quote_view")).toHaveLength(1);
  });

  it("the per-isolate cache is bounded", async () => {
    const { env } = harness();
    for (let i = 0; i < ENRICH_CACHE_MAX_ENTRIES + 25; i++) {
      await resolveLeadgenFunnelNames(env.DB, { quote_id: `lgq_missing_${i}` });
    }
    expect(leadgenEnrichCacheSizes().quote).toBeLessThanOrEqual(ENRICH_CACHE_MAX_ENTRIES);
  });
});

// ---------------------------------------------------------------------------
// 2. answer words
// ---------------------------------------------------------------------------

describeDb("2. answer events carry question_key / question_label / answer_label", () => {
  it("choice label, multi-select labels joined ', ', a number as itself, Yes/No words; labels via label → headline → section", async () => {
    const { sdb, env } = harness();
    seedFunnel(sdb, { quote: "lgq_home", funnel: "lgf_home", variant: "lgn_home", funnelTpl: null, variantTpl: null });
    seedSection(sdb, "lgs_own", "Ownership", "Tell us about your home", CHOICE_SECTION);
    const { records } = await track(env, [
      ev("answer_click", { section_id: "lgs_own", question_id: "q_own", answer_value_normalized: "own", question_key: "FAKE" }),
      ev("answer_click", { section_id: "lgs_own", question_id: "q_cov", answer_value_normalized: "fire,theft" }),
      ev("answer_change", { section_id: "lgs_own", question_id: "q_val", answer_value_normalized: "330000" }),
      ev("answer_default_applied", { section_id: "lgs_own", question_id: "q_yn", answer_value_normalized: "false" }),
    ]);
    const [own, cov, val, yn] = eventsOf(records);
    expect(own!.question_key).toBe("homeowner");
    expect(own!.question_label).toBe("Do you own or rent?"); // no own label → the Question headline
    expect(own!.answer_label).toBe("I own");
    expect(own!.section_name).toBe("Ownership");
    expect(cov!.question_key).toBe("coverage");
    expect(cov!.question_label).toBe("Coverage you want");
    expect(cov!.answer_label).toBe("Fire, Theft");
    expect(val!.question_key).toBe("home_value");
    expect(val!.answer_label).toBe("330000");
    expect(yn!.answer_label).toBe("No pool");
    expect(yn!.question_label).toBe("Pool?");
  });

  it("a question with no label and no headline is labelled by the section headline, then the section name", () => {
    const withHeadline = buildSectionFacts({
      section_name: "Sec name",
      headline_text: "Sec headline",
      content_json: JSON.stringify({ components: [{ type: "DropdownQuestion", question_id: "q", internal_field: "f", choices: [] }] }),
    });
    expect(withHeadline.by_field.get("f")!.question_label).toBe("Sec headline");
    const nameOnly = buildSectionFacts({
      section_name: "Sec name",
      headline_text: "",
      content_json: JSON.stringify({ components: [{ type: "DropdownQuestion", question_id: "q", internal_field: "f", choices: [] }] }),
    });
    expect(nameOnly.by_field.get("f")!.question_label).toBe("Sec name");
    expect(answerWordsFor(new Map([["a", "Alpha"]]), "a,b")).toBe("Alpha, b");
  });

  it("typed text that is not contact data is stored as its own words", async () => {
    const { sdb, env } = harness();
    seedSection(sdb, "lgs_c", "Contact", "Your details", CONTACT_SECTION);
    const { records } = await track(env, [ev("answer_change", { section_id: "lgs_c", question_id: "q_occ", answer_value_normalized: "Teacher" })]);
    const e = eventsOf(records)[0]!;
    expect(e.answer_label).toBe("Teacher");
    expect(e.answer_value_normalized).toBe("Teacher");
    expect(e.answer_hashed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. contact hashing (R3)
// ---------------------------------------------------------------------------

describeDb("3. contact answers are stored as SHA-256 of the Meta-normalised value (R3)", () => {
  it("email / phone / name parts / DOB / street / pii free text hashed; ZIP / city / state plain", async () => {
    const { sdb, env } = harness();
    seedSection(sdb, "lgs_c", "Contact", "Your details", CONTACT_SECTION);
    const at = (question_id: string, value: string, internal_field?: string): Record<string, unknown> =>
      ev("answer_change", { section_id: "lgs_c", question_id, answer_value_normalized: value, ...(internal_field !== undefined ? { internal_field } : {}) });
    const { records } = await track(env, [
      at("q_em", "  John.Doe@Example.COM "),
      at("q_ph", "(555) 123-4567"),
      at("q_name", " John ", "first"),
      at("q_name", "DOE", "last"),
      at("q_dob", "1980-02-03"),
      at("q_addr", "12 Main St", "addr_street"),
      at("q_addr", "Austin", "addr_city"),
      at("q_addr", "TX", "addr_state"),
      at("q_zip", "78701"),
      at("q_note", "My SSN is secret"),
    ]);
    const got = eventsOf(records, "answer_change");
    const byKey = new Map(got.map((e) => [String(e.question_key), e]));
    const hashed = (key: string, plain: string): void => {
      const e = byKey.get(key)!;
      expect(e, key).toBeDefined();
      expect(e.answer_value_normalized, key).toBe(sha(plain));
      expect(e.answer_hashed, key).toBe(true);
      expect(e.answer_label, key).toBe("");
      expect(e.answer_value_raw, key).toBe("");
    };
    hashed("email", "john.doe@example.com");
    hashed("phone", "15551234567");
    hashed("first", "john");
    hashed("last", "doe");
    hashed("date_of_birth", "19800203");
    hashed("addr_street", "12 main st");
    hashed("notes", "my ssn is secret");
    expect(byKey.get("first")!.question_label).toBe("Your name — First");
    for (const [key, plain] of [["addr_city", "Austin"], ["addr_state", "TX"], ["zip", "78701"]] as const) {
      const e = byKey.get(key)!;
      expect(e.answer_value_normalized, key).toBe(plain);
      expect(e.answer_hashed, key).toBe(false);
    }
    // no plain contact value anywhere in the stream
    const blob = JSON.stringify(records);
    for (const plain of ["John.Doe@Example.COM", "john.doe@example.com", "(555) 123-4567", "1980-02-03", "12 Main St", "My SSN is secret"]) {
      expect(blob.includes(plain), plain).toBe(false);
    }
  });

  it("safety net: an email/phone-looking answer whose question is unknown is still hashed", async () => {
    const { env } = harness();
    const { records } = await track(env, [
      ev("answer_change", { section_id: "lgs_unknown", question_id: "q_x", answer_value_normalized: "Someone@Mail.com" }),
      ev("answer_change", { section_id: "", question_id: "q_y", answer_value_normalized: "555-123-4567" }),
      ev("answer_change", { section_id: "", question_id: "q_z", answer_value_normalized: "330000" }),
    ]);
    const [em, ph, num] = eventsOf(records);
    expect(em!.answer_value_normalized).toBe(sha("someone@mail.com"));
    expect(em!.answer_hashed).toBe(true);
    expect(ph!.answer_value_normalized).toBe(sha("15551234567"));
    expect(num!.answer_value_normalized).toBe("330000");
    expect(num!.answer_hashed).toBe(false);
  });

  it("Meta normalisation helpers", async () => {
    expect(await sha256Hex("abc")).toBe(sha("abc"));
    expect(normalizeMetaPhone("+1 (555) 123-4567")).toBe("15551234567");
    expect(normalizeMetaPhone("555.123.4567")).toBe("15551234567");
    expect(normalizeMetaDob("02/03/1980")).toBe("19800203");
    expect(normalizeMetaDob("19800203")).toBe("19800203");
    expect(normalizeMetaDob("not a date")).toBe("");
    expect(normalizeMetaState("California")).toBe("ca");
    expect(normalizeMetaState("TX")).toBe("tx");
    expect(normalizeMetaZip("78701-1234")).toBe("78701");
    expect(normalizeMetaCity("New York")).toBe("newyork");
    expect(readFbpCookie(`a=1; _fbp=${FBP}; b=2`)).toBe(FBP);
    expect(readFbpCookie("_fbp=fb.1.123.abc")).toBe("");
    expect(readFbcCookie(`_fbc=${FBC}`)).toBe(FBC);
    expect(await hashMetaUserData({ em: " A@B.co ", ph: "", zp: "123" })).toEqual({ em: sha("a@b.co") });
  });
});

// ---------------------------------------------------------------------------
// fbp / fbc on /lg/track
// ---------------------------------------------------------------------------

describeDb("4a. /lg/track: fbp from the _fbp cookie; fbc from _fbc, else derived from fbclid", () => {
  it("stamps fbp + cookie fbc; the session record carries both", async () => {
    const { env } = harness();
    const { records } = await track(env, [ev("quote_view")], { Cookie: `_fbp=${FBP}; _fbc=${FBC}` });
    const qv = eventsOf(records, "quote_view")[0]!;
    expect(qv.fbp).toBe(FBP);
    expect(qv.fbc).toBe(FBC);
    const session = records.find((r) => r.record_kind === "session")!;
    expect(session.fbp).toBe(FBP);
    expect(session.fbc).toBe(FBC);
  });

  it("no cookies: fbc = fb.1.<ms>.<fbclid>; a malformed _fbp is ignored", async () => {
    const { env } = harness();
    const { records } = await track(env, [ev("quote_view")], { Cookie: "_fbp=garbage" });
    const qv = eventsOf(records, "quote_view")[0]!;
    expect(qv.fbp).toBe("");
    expect(String(qv.fbc)).toMatch(/^fb\.1\.\d{13}\.CLICK123$/);
  });
});

// ---------------------------------------------------------------------------
// 4. click revenue (R1)
// ---------------------------------------------------------------------------

function seedOffer(sdb: SqliteDb, publicId: string, offerType: string, staticBid: number | null = null, staticCurrency: string | null = "USD"): number {
  sdb
    .prepare(
      `INSERT INTO leadgen_offers (public_id, offer_name, activity, vertical, conversion_tracking_method, offer_type, calls_provider_api, bid_source, static_bid_value, static_bid_currency, status)
       VALUES (?, ?, 'quote_funnel', 'home', 's2s_postback', ?, ?, ?, ?, ?, 'active')`,
    )
    .run(publicId, `Offer ${publicId}`, offerType, staticBid === null ? 1 : 0, staticBid === null ? "response" : "static", staticBid, staticCurrency);
  return (sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(publicId) as { id: number }).id;
}

function seedShown(sdb: SqliteDb, aiid: string, shown: Array<{ carrier_key: string; offer_id: string; bid: number; slot: number }>): void {
  sdb
    .prepare("INSERT INTO leadgen_auction_result_log (auction_instance_id, auction_result_id, auction_config_id, funnel_id, carriers_shown_json) VALUES (?, ?, 'lga_1', 'lgf_home', ?)")
    .run(aiid, `res-${aiid}`, JSON.stringify(shown));
}

function clickInput(o: Partial<LeadgenClickInput>): LeadgenClickInput {
  return {
    offer_public_id: "lgo_cpc",
    carrier_key: "acme",
    auction_instance_id: "aiid-1",
    banner_render_id: "brid-1",
    slot: 1,
    funnel_attempt_id: "fa-1",
    session_id: "sid-1",
    carrier: { carrier_key: "acme", carrier_key_source: "slug", carrier_name: "Acme", bid: 40, bid_currency: "EUR" } as LeadgenClickInput["carrier"],
    canonical_macros: {},
    event_context: { funnel_id: "lgf_home", funnel_variant_id: "lgn_home" },
    ...o,
  };
}

describeDb("4. banner clicks: CPC books its USD bid on EVERY click; cpl/cpa/cpi book none", () => {
  it("two clicks by the same visitor → two carrier_click events, each revenue = the card's USD bid", async () => {
    const { sdb, env } = harness({ firehose: false });
    seedFunnel(sdb, { quote: "lgq_home", funnel: "lgf_home", variant: "lgn_home", funnelTpl: 1, variantTpl: null });
    seedOffer(sdb, "lgo_cpc", "cpc");
    seedShown(sdb, "aiid-1", [{ carrier_key: "acme", offer_id: "lgo_cpc", bid: 32.5, slot: 1 }]);
    const cap = ctxCapture();
    const r1 = await resolveLeadgenClick(env, cap.ctx, clickInput({ request_cookie_header: `_fbp=${FBP}` }));
    const r2 = await resolveLeadgenClick(env, cap.ctx, clickInput({}));
    await settle(cap.promises);
    for (const r of [r1, r2]) {
      const e = r.events[0]!;
      expect(e.event_type).toBe("carrier_click");
      expect(e.offer_type).toBe("cpc");
      expect(e.revenue).toBe(32.5);
      expect(e.bid_value).toBe(32.5);
      expect(e.bid_currency).toBe("USD");
      expect(e.booking_trigger).toBe("click");
      expect(e.quote_name).toBe("Quote lgq_home");
      expect(e.quote_id).toBe("lgq_home");
      expect(e.funnel_name).toBe("Funnel lgf_home");
      expect(e.template_name).toBe("Centered card");
    }
    expect(r1.events[0]!.fbp).toBe(FBP);
    expect(r2.events[0]!.fbp).toBe("");
    expect(r1.click_id).not.toBe(r2.click_id);
  });

  it("the record that reaches Firehose carries the booked revenue (not a pre-stamp copy)", async () => {
    const { sdb, env } = harness({ firehose: true });
    seedOffer(sdb, "lgo_cpc", "cpc");
    seedShown(sdb, "aiid-1", [{ carrier_key: "acme", offer_id: "lgo_cpc", bid: 7.25, slot: 1 }]);
    const stub = stubLeadgenFetch();
    const cap = ctxCapture();
    await resolveLeadgenClick(env, cap.ctx, clickInput({}));
    await settle(cap.promises);
    const clicks = (stub.firehoseRecords as unknown as Array<Record<string, unknown>>).filter((r) => r.event_type === "carrier_click");
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.revenue).toBe(7.25);
    expect(clicks[0]!.booking_trigger).toBe("click");
    expect(clicks[0]!.offer_type).toBe("cpc");
  });

  it("a static CPC offer with no stored card bid books static_bid_value; fbp falls back to the auction snapshot", async () => {
    const { sdb, env } = harness({ firehose: false });
    seedOffer(sdb, "lgo_static", "cpc", 2.5, "USD");
    const cap = ctxCapture();
    const r = await resolveLeadgenClick(
      env,
      cap.ctx,
      clickInput({ offer_public_id: "lgo_static", carrier_key: "", auction_instance_id: "", carrier: null, canonical_macros: { fbp: FBP } }),
    );
    await settle(cap.promises);
    const e = r.events[0]!;
    expect(e.event_type).toBe("offer_click");
    expect(e.revenue).toBe(2.5);
    expect(e.booking_trigger).toBe("click");
    expect(e.fbp).toBe(FBP);
  });

  it("cpl / cpa / cpi clicks: revenue null, booking_trigger ''", async () => {
    const { sdb, env } = harness({ firehose: false });
    for (const t of ["cpl", "cpa", "cpi"]) {
      seedOffer(sdb, `lgo_${t}`, t);
      seedShown(sdb, `aiid-${t}`, [{ carrier_key: "acme", offer_id: `lgo_${t}`, bid: 9, slot: 1 }]);
      const cap = ctxCapture();
      const r = await resolveLeadgenClick(env, cap.ctx, clickInput({ offer_public_id: `lgo_${t}`, auction_instance_id: `aiid-${t}`, event_context: { revenue: 5, booking_trigger: "x" } }));
      await settle(cap.promises);
      const e = r.events[0]!;
      expect(e.offer_type, t).toBe(t);
      expect(e.revenue, t).toBeNull();
      expect(e.booking_trigger, t).toBe("");
    }
  });
});

// ---------------------------------------------------------------------------
// 5. bids per offer + 6. meta_user_data
// ---------------------------------------------------------------------------

function contactResolved(): ReturnType<typeof makeResolved> {
  const resolved = makeResolved();
  resolved.sections = [
    {
      position: 0,
      section: {
        id: 1,
        public_id: "lgs_c",
        content_version: 1,
        section_name: "Contact",
        headline_text: "Your details",
        content_json: JSON.stringify({
          components: [
            { type: "EmailInputQuestion", question_id: "q_em", internal_field: "email" },
            { type: "PhoneInputQuestion", question_id: "q_ph", internal_field: "phone" },
            { type: "NameFieldsGroup", question_id: "q_name" },
            { type: "DateQuestion", question_id: "q_dob", internal_field: "date_of_birth" },
            { type: "DateQuestion", question_id: "q_start", internal_field: "policy_start" },
            { type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip" },
            { type: "DropdownQuestion", question_id: "q_st", internal_field: "state", choices: [{ label: "Texas", value: "TX", analytics_id: "s" }] },
          ],
        }),
      } as unknown as LeadgenSectionRow,
    },
  ] as unknown as typeof resolved.sections;
  return resolved;
}

const CONTACT_ANSWERS = {
  email: " John.Doe@Example.COM ",
  phone: "(555) 123-4567",
  first: "John",
  last: "Doe",
  date_of_birth: "02/03/1980",
  policy_start: "2026-11-01",
  zip: "78701",
  state: "TX",
};

describeDb("5. auction_offer_response carries bid_value (best USD bid) + bids_count", () => {
  it("2 carriers → bids_count 2, bid_value = the higher; a no-bid answer → bids_count 0, bid_value null", async () => {
    const { sdb, env } = harness({ firehose: false });
    const auction = seedAuction(sdb, { multi_offer: "enabled" });
    attachOffer(sdb, auction.id, seedAuctionOffer(sdb), 0);
    stubLeadgenFetch(() => new Response(carrierBody([{ name: "Acme", bid: 12 }, { name: "Beta", bid: 30 }]), { status: 200 }));
    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(env, { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] }, { dryRun: true });
    const resp = result.events.filter((e) => e.event_type === "auction_offer_response");
    expect(resp).toHaveLength(1);
    expect(resp[0]!.bids_count).toBe(2);
    expect(resp[0]!.bid_value).toBe(30);
    expect(resp[0]!.bid_currency).toBe("USD");
    // every other event leaves bids_count null; per-carrier rows unchanged
    const eligible = result.events.filter((e) => e.event_type === "auction_carrier_eligible");
    expect(eligible.map((e) => e.bid_value).sort()).toEqual([12, 30]);
    expect(eligible.every((e) => e.bids_count === null)).toBe(true);

    const { sdb: sdb2, env: env2 } = harness({ firehose: false });
    const auction2 = seedAuction(sdb2);
    attachOffer(sdb2, auction2.id, seedAuctionOffer(sdb2), 0);
    stubLeadgenFetch(() => new Response(JSON.stringify({ carriers: [] }), { status: 200 }));
    const bundle2 = await loadAuctionBundle(env2.DB, auction2, 1);
    const result2 = await runAuction(env2, { resolved: makeResolved(), bundle: bundle2, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] }, { dryRun: true });
    const resp2 = result2.events.filter((e) => e.event_type === "auction_offer_response");
    expect(resp2).toHaveLength(1);
    expect(resp2[0]!.bids_count).toBe(0);
    expect(resp2[0]!.bid_value).toBeNull();
  });
});

describeDb("6. /lg/auction persists HASHED meta_user_data in the macro snapshot", () => {
  it("em/ph/fn/ln/db/st/zp/country hashed from the answers; a non-birth date is not db; persisted JSON holds no plain value", async () => {
    const { sdb, env } = harness({ firehose: false });
    const auction = seedAuction(sdb);
    stubLeadgenFetch(() => new Response(JSON.stringify({ carriers: [] }), { status: 200 }));
    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(
      env,
      { resolved: contactResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: CONTACT_ANSWERS, clicked: [] },
      { dryRun: true },
    );
    expect(result.meta_user_data).toEqual({
      em: sha("john.doe@example.com"),
      ph: sha("15551234567"),
      fn: sha("john"),
      ln: sha("doe"),
      db: sha("19800203"),
      st: sha("tx"),
      zp: sha("78701"),
      country: sha("us"),
    });
    await persistAuctionResult(env, result);
    const row = sdb.prepare("SELECT macro_context_json FROM leadgen_auction_result_log WHERE auction_instance_id = ?").get(result.auction_instance_id) as { macro_context_json: string };
    const snapshot = JSON.parse(row.macro_context_json) as { meta_user_data?: Record<string, string> };
    expect(snapshot.meta_user_data?.em).toBe(sha("john.doe@example.com"));
    for (const plain of ["John.Doe", "john.doe@example.com", "555", "1980", "78701", "John"]) {
      expect(row.macro_context_json.includes(plain), plain).toBe(false);
    }
  });

  it("no contact answers → no meta_user_data key (absent keys omitted)", async () => {
    expect(await buildAuctionMetaUserData([], {})).toEqual({});
    expect(await buildAuctionMetaUserData([], { email: "a@b.co" })).toEqual({ em: sha("a@b.co"), country: sha("us") });
  });

  it("the auction persists the visitor's _fbp in the snapshot (for the click + server-side Meta event)", async () => {
    const { sdb, env } = harness({ firehose: false });
    const auction = seedAuction(sdb);
    stubLeadgenFetch(() => new Response(JSON.stringify({ carriers: [] }), { status: 200 }));
    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const req = new Request("https://one.example.com/lg/auction", { method: "POST", headers: { Cookie: `_fbp=${FBP}` } });
    const result = await runAuction(
      env,
      { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [], runtime: { source: req } },
      { dryRun: true },
    );
    expect(result.macro_context_snapshot["fbp"]).toBe(FBP);
    expect(result.events.find((e) => e.event_type === "auction_start")!.fbp).toBe(FBP);
    expect(result.events.find((e) => e.event_type === "auction_start")!.quote_name).toBe("Q");
  });
});

// ---------------------------------------------------------------------------
// 7. S3 → ClickHouse loader still accepts records with the new fields
// ---------------------------------------------------------------------------

describe("7. event-loader maps records carrying the new fields", () => {
  it("a full new-shape event + session map by the live columns (unknown fields skipped; new columns coerced when present)", () => {
    const e = blankLeadgenEvent("answer_change", 1_760_000_000_000);
    e.event_id = "ev-1";
    e.question_label = "Email";
    e.answer_label = "";
    e.answer_hashed = true;
    e.template_id = "lgft_1";
    e.template_name = "Centered card";
    e.bids_count = 3;
    e.fbp = FBP;
    const record = JSON.parse(JSON.stringify(e)) as Record<string, unknown>;
    const legacyCols = new Map<string, string>([["event_id", "String"], ["event_type", "String"], ["dt", "Date"], ["ts", "DateTime"], ["answer_value_normalized", "String"]]);
    const legacy = mapRecordToRow(record, legacyCols, {}, "event");
    expect(legacy).not.toBeNull();
    expect(Object.keys(legacy!).sort()).toEqual(["answer_value_normalized", "dt", "event_id", "event_type", "ts"]);
    const withNew = new Map<string, string>([...legacyCols, ["answer_hashed", "Bool"], ["bids_count", "Nullable(Int32)"], ["template_name", "LowCardinality(String)"], ["fbp", "String"]]);
    const row = mapRecordToRow(record, withNew, {}, "event")!;
    expect(row.answer_hashed).toBe(true);
    expect(row.bids_count).toBe(3);
    expect(row.template_name).toBe("Centered card");
    expect(row.fbp).toBe(FBP);

    e.event_type = "quote_view";
    e.session_id = "sid-1";
    const session = JSON.parse(JSON.stringify(leadgenSessionFromQuoteView(e))) as Record<string, unknown>;
    const sRow = mapRecordToRow(session, new Map([["session_id", "String"], ["dt", "Date"], ["fbp", "String"]]), {}, "session");
    expect(sRow).not.toBeNull();
    expect(sRow!.fbp).toBe(FBP);
  });
});
