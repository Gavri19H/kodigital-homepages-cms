import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadPreparedFunnelBundle } from "../src/public/leadgen/bundle";
import leadgenRouter from "../src/public/leadgen/runtime-routes";
import {
  buildLeadgenEnv, createLeadgenDb, d1FromSqlite, loadDatabaseSync, makeKvStub, type SqliteDb,
} from "./helpers/leadgen-analytics-harness";

const origin = "https://one.example.com";
const landing = origin + "/lg/life?utm_source=paid";
const redirect = "https://partner.example/start";
const now = Date.UTC(2026, 0, 15, 12);
const sid = "returning";
const headers = { Cookie: "ko_sid=" + sid, "User-Agent": "iPhone" };

function publicId(prefix: string, id: number): string {
  return prefix + "_" + String(id).padStart(26, "0");
}

function seed(sql: SqliteDb): void {
  // Bring the analytics fixture up to the columns used by the live entry routes.
  for (const file of ["0055_leadgen_quote_default_template.sql", "0058_leadgen_offer_clickout_meta.sql",
    "0061_leadgen_routing_present_only_offer.sql"]) {
    (sql.exec as (s: string) => void)(readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"));
  }
  if (typeof sql.function !== "function") throw new Error("SQLite clock override required for row parity");
  sql.function("unixepoch", () => now / 1000);
  sql.prepare("CREATE TABLE site_settings (site_id TEXT, key TEXT, value TEXT)").run();
  sql.prepare("INSERT INTO site_settings VALUES ('site-1', 'site_name', 'Example Quotes')").run();
  sql.prepare(`INSERT INTO leadgen_quotes (id, public_id, quote_name, activity, verticals_json, status, default_funnel_id)
    VALUES (1, ?, 'Life', 'quote_funnel', '["life"]', 'active', 1)`).run(publicId("lgq", 1));
  sql.prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug) VALUES ('site-1', 1, 1, 'life')").run();
  sql.prepare(`INSERT INTO leadgen_funnels (id, public_id, funnel_name, quote_id, status)
    VALUES (1, ?, 'Family', 1, 'active')`).run(publicId("lgf", 1));
  sql.prepare(`INSERT INTO leadgen_funnel_ab_tests (public_id, funnel_id, name, revision, status)
    VALUES (?, 1, 'Split', 7, 'running')`).run(publicId("lgx", 1));
  sql.prepare(`INSERT INTO leadgen_auctions (id, public_id, auction_name, auction_type, carrier_normalization_version)
    VALUES (1, ?, 'Offers', 'static', 3)`).run(publicId("lga", 1));
  const variant = sql.prepare(`INSERT INTO leadgen_funnel_variants
    (id, public_id, funnel_id, variant_label, traffic_allocation_bp, auction_id) VALUES (?, ?, 1, ?, 5000, 1)`);
  variant.run(1, publicId("lgn", 1), "A");
  variant.run(2, publicId("lgn", 2), "B");

  const ctas = [{ id: "mobile_line", slot: "under_header", label: "Talk to us", tel: "+15551234567",
    condition: { match: "all", conditions: [{ when: "__state", op: "eq", value: "CA" }] } }];
  sql.prepare("UPDATE leadgen_frame_templates SET frame_json = json_set(frame_json, '$.cta_slots', json(?)) WHERE id = 1")
    .run(JSON.stringify(ctas));
  sql.prepare("INSERT INTO leadgen_quote_default_template VALUES (?, 1)").run(publicId("lgq", 1));

  const rule = sql.prepare(`INSERT INTO leadgen_quote_routing_rules
    (public_id, quote_id, rule_name, priority, conditions_hash, conditions_json, target_funnel_id,
     feed_name, value_multiplier, redirect_pct, redirect_url, redirect_url_allowlisted)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const condition = (field: string, value: string) => JSON.stringify({ groups: [{ field, op: "eq", value }] });
  rule.run(publicId("lgqr", 1), "Partner redirect", 1, "redirect", condition("utm_source", "partner"),
    null, null, null, 100, redirect, 1);
  rule.run(publicId("lgqr", 2), "Paid feed", 2, "paid", condition("utm_source", "paid"),
    null, "paid_life", 1.75, null, null, 0);
  rule.run(publicId("lgqr", 3), "Checkpoint", 3, "answer", condition("zip", "90001"),
    1, null, null, null, null, 0);

  // Interleave slotted and direct shared pages. Page IDs and insertion order
  // deliberately disagree with page/section position order.
  const page = sql.prepare(`INSERT INTO leadgen_funnel_pages (id, public_id, quote_id, variant_id, position)
    VALUES (?, ?, ?, ?, ?)`);
  page.run(30, publicId("lgpg", 30), 1, null, 0);
  page.run(10, publicId("lgpg", 10), 1, null, 1);
  page.run(20, publicId("lgpg", 20), 1, null, 2);
  const slot = sql.prepare("INSERT INTO leadgen_funnel_page_slots (id, page_id, position) VALUES (?, ?, 0)");
  slot.run(10, 10);
  const section = sql.prepare(`INSERT INTO leadgen_sections
    (id, public_id, section_name, activity, vertical, headline_text, content_json)
    VALUES (?, ?, ?, 'quote_funnel', 'life', ?, ?)`);
  const attach = sql.prepare(`INSERT INTO leadgen_funnel_variant_sections
    (id, section_id, quote_id, variant_id, page_id, slot_id, position) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const [id, pageId, slotId, position] of [[2, 30, null, 1], [3, 10, 10, 2], [4, 20, null, 3], [1, 30, null, 0]] as const) {
    const components = id === 3 ? [{ type: "ZIPInputQuestion", question_id: "q_zip", question_key: "zip", internal_field: "zip" }] : [];
    section.run(id, publicId("lgs", id), "Shared " + id, "Shared " + id, JSON.stringify({ components }));
    attach.run(id, id, 1, null, pageId, slotId, position);
  }
  for (const arm of [1, 2]) {
    const id = 40 + arm;
    page.run(id, publicId("lgpg", id), null, arm, 0);
    slot.run(id, id);
    section.run(id, publicId("lgs", id), "Arm " + arm, "Arm " + arm, '{"components":[]}');
    attach.run(id, id, null, arm, id, id, 0);
  }
}

// Hold each D1 reply until the next event-loop turn. Statements issued before
// the same reply are one round. Awaiting that reply starts a new round. Count
// executions (including writes), excluding fixture setup and inspection.
function measure(sql: SqliteDb) {
  const db = d1FromSqlite(sql);
  const rounds: string[][] = [];
  let reply: Promise<void> | undefined;
  function send(query: string): Promise<void> {
    if (!reply) {
      rounds.push([]);
      reply = new Promise<void>((resolve) => setImmediate(() => {
        reply = undefined;
        resolve();
      }));
    }
    rounds[rounds.length - 1]!.push(query);
    return reply;
  }
  const prepare = db.prepare.bind(db);
  db.prepare = (query) => {
    const stmt = prepare(query);
    const { first, all, run } = stmt; // harness bind() returns this same statement
    stmt.first = async <T>(column?: string) => {
      await send(query);
      return column === undefined ? first<T>() : first<T>(column);
    };
    stmt.all = async <T>() => { await send(query); return all<T>(); };
    stmt.run = async <T>() => { await send(query); return run<T>(); };
    return stmt;
  };
  return { db, rounds };
}

const variant = publicId("lgn", 2);
const bundlePrefix = `lgbundle:site-1:${variant}:`;
const attemptUrl = origin + "/lg/attempt?vid=" + variant + "&u=" + encodeURIComponent(landing);

let sql: SqliteDb;
let trace: ReturnType<typeof measure>;
let env: ReturnType<typeof buildLeadgenEnv>;
let buildStart: number;
let buildEnd: number;

beforeEach(() => {
  const DatabaseSync = loadDatabaseSync();
  if (!DatabaseSync) throw new Error("node:sqlite is required to measure bundle misses");
  vi.useFakeTimers({ toFake: ["Date"], now });
  vi.spyOn(crypto, "getRandomValues").mockImplementation((bytes) => {
    if (bytes instanceof Uint8Array) bytes.fill(7);
    return bytes;
  });
  sql = createLeadgenDb(DatabaseSync);
  seed(sql);
  trace = measure(sql);

  // Measure from the cold bundle lookup through storage of the completed build.
  // The shell resolves its host before the lookup. A paid attempt records its
  // routing outcome on the primary after the definition has been stored.
  buildStart = buildEnd = -1;
  const { kv, store } = makeKvStub();
  Object.assign(kv, {
    async get(name: string) {
      if (name.startsWith(bundlePrefix)) {
        expect(store.has(name)).toBe(false);
        buildStart = trace.rounds.length;
      }
      return store.get(name) ?? null;
    },
    async put(name: string, value: string) {
      if (name.startsWith(bundlePrefix)) buildEnd = trace.rounds.length;
      store.set(name, value);
    },
    async getWithMetadata(name: string) { return { value: store.get(name) ?? null, metadata: null }; },
  });
  env = buildLeadgenEnv(trace.db, kv);
});
afterEach(() => {
  sql.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function edgeHeaders() {
  return new Headers({ ...headers, "x-cms-site-id": "site-1", "x-cms-snap-built-at": String(now),
    "x-cms-snap-version": "a".repeat(64), "x-cms-bookmark": "bookmark-001" });
}

// Complete output bytes from 19bc4063 under TZ=UTC, with the attempt kickoff
// and runtime preload added to the shell.
// Store them losslessly in this test so parity also covers omitted fields and key order.
const original = {
  bundle:
    "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",
  shell:
    "H4sIAAAAAAAAE+1925bjNpLge30FLa87U21RqWtelJU1U7YzbZ91eTxd1dPd463NQ0lUil0UKZNUXqzOc+Yj9mV/YH9h3/dT5ks2InAhQIKSeCnbPac903YKACMCgUAgEAgEXn4yD2fJ09q1lsnKf/US/235TnB3" +
    "1XKDFvx2nfmrlys3cazZ0oliN7lqbZKFfQ518Szy1smr7SwM4sS69+ZXLf8uuO0V/TNoXT54wTx86N7efvf17et3767f/PDu9ofb26stfN1ZT46d+CmYHbevXm2T6IkDjtz4ynlwvMRauMlsedw68e9OnCRxV+vk" +
    "nwjr524wC+fuH//w7Zfhah0GbpAcQ0X789bvNuZaP5w5iRcG3WXkLtqdLXRwGc4nra+v37U62Gc3iidbZzZz18mk5azXvsc+OPlrHAat584scucAyHP8eNKKnZVrh5F35wWtzsyZLd1JKwjtOAkjt/XcvozcZBMF" +
    "2JFu+OGfWF/wB8I6bk+Cje8/A/jZcstbUslz+7j9/PzyhLP5pe8FH+Az/6q1hn+HzrxlOfFVi1W3LOzJFfEm2gBhK/ekPwYMLT56AdB41br33Id1GEFz4G0CHbhqPXjzZHk1d++9mWvTj47lBR52zY5nju9e9XUY" +
    "UTgNk1iBEIQwqu4jtEq8xHdfXT86q7XvWv+6CRM3fnnCShX6Pfi0ZaHUwd8r5849ie/vPn9c+bIXsZe4NjbrQk3r1QsVf7J0gd2z0A8jhYhP+1PnfEZimTwBuh/nTuLYi00QuL49d2PvLrhqzd2Fs/ETXtx6v506" +
    "sw93UbgJ5gzg5NOb8c3ZzetL/qv/un8zPL1cABZ74aw8/2ly9DaMnKNO/BSDBNobr/M6AlZ1YieI7diNvMXlygvspevdLZNJv9e7X17atn9nryPoavQEML8Yvh5/qRXacyf6MPm0dzMYjXqsBmUvSCafXp+Pvxqc" +
    "srKZE82BQvqHlUzDCER18ulXg68ursesLN7Ap3EM4K7Pvhy+ZoVuFGF/vhoObgY3Ou4HJ14inuvrmxGHsHZAFh7jSa87GEfuSi2NV1CaLVzNJ/1MkX836efaPfqTQbYIyoayLHLm3iZGJKfrR60IUfQyZYhjlClD" +
    "FNl2C5hOkwv4R5THSwfUEPXF6q8frSH8L7qbOseDs874vHMx6HR7p22tLeDvWYDMOt/fFujqUbvByND4XG8MBAMR0F1rZADd7+mt7/zwgQMfDmTz4aBzMewMz6H9gLdPIhBID1UW6CF3PRn2eqs4V0US1R+bqqZJ" +
    "AJw01ayj8C5CCRul1dDadp3YC+4ms83Um9lT92fPjY67w1EH5OC00z2FPzht07W9CqeeD4LjPE5G53K8oCJeOb7PyntqeeIFT1Q8PBsrxTCzPyQhwPOCyelI/QBUmUvF/R4Ow/OLgzSC1cV5xpTKFtAxjTg5JVpg" +
    "uoCKt313kUycTRKKgojmOpWsnfkcmcBlfxo+2rH3M5awqQozthQpP23cWI6Uoq6kGuAaAKU4Dn1vbn16fXH91c2QV/ApMEEBY9SQHAn5TCWu1wEhGo+YxIlejFB+RySbPfF9tjcaV2C9mB3bfev3FmNAW2dRrroy" +
    "K6xXAORz6/dbDh9kYNI/LznMAMdeO1DQBLTpHYNle1AYNQER6qPwYTv34rXvPE0Wvvt4eeesJyjOl44PH9qwTK7iSZxEaBmVhw1Ush9bBD7pW32rR8sXk/repYYb/2XPvcid4TBMYIncrIIaSNmHUDgFxRG/Jxps" +
    "EG+QToaLyif3TnTM1jDespTUGHES88B0Shwwhd5vVV4SYqpoCguu426UQcMKm0LhBnNTN6C4HIYtaflFGK00rgeb+Z3bsQKwnXFCC6UIxs1n5eDLEfddZ/F+snTiY1akTO/3Py69OdjW79tS8hFxGUTMgDcZd0xn" +
    "SiUNKshSNbXQjTtsgnXIVkGYdN7sw9MlTuze5c82mcCwYOpTJj/kl3/dwJeLJ7HIiOLEfUzYcFaQDdZhpnm26eBcZhewsrQxE23qJg+uG5DuQZaVocwP78KtZj5/Bxgj+BxMaLKWqRJWFRfWTDIiqeCB2c9nvZ40" +
    "xZnZTHyauzMwwmkYysoGEsSN6y2HzEzsUroeJEtdjJEIsRIDwZsoBrhr2BYhUzmWs/557+JU6W6ve342lh3m7PGCJXAlkSKaypMXwAbKtYuGDgdHmOvKBmRU0vTBTk2W4T3Ikcb3MjCA4pkfxpvIbYJHRRzKCgLg" +
    "cCNk0aXvxfA57gJLS0dK+mQCMjj94CGOxPF82IHAHg3YUlUpqaA5KDHNWq2KgBobKPshctZbqdtglw5MvXezwjf1w9mHGhh+DNeg2LM1ZDalyJ0pGLKbxJVKddgjLUvGI6o1sKvAJG1fksU5BjWXrlr0F9Du/vnY" +
    "hpr2JdN+qAc5sxWdCNPk+GJw/9CxRrhlbBfYt4cZ3efXX94MskZ3z2h0F2wK1VVJXQ6wm5cPS/SIkD4GyYtgk1RmGMSOTVij0zBJwhXtxauAwc0gKECuYs7XKo9sqVTJn6AzhO/BUWoXuJFlK30lEhae729TL8tn" +
    "6jChrDoRmJKAFb19F725e9fhE6Tz6eD1uHfea5tpS/e5E5ISSxpChh1w24I9byktkLIQBlifuZraO8uuhLCAXyp7Ca7qy213EvcujJ62mnrtD8amRdd3E9DLJHAokwPkDIpkOtU267UbzaD7l9oyeqmLWH9Qbv1B" +
    "SwaHT7cZvncf4ohsnLzVMIRZmOMUaSshHd3+WBoRp8PBaJE3tlgJqqjJ1PGdYObyfsCc7VkgF1avTC/izVTviOA2YzYn5nR41ju7MRCjoB72msHdH5cbBxjmO9e+d/yNe6j5NuiaRUl3pRb2lozxUj1lNDJdlF+6" +
    "qmqn8hSQKsovX7Q89fgGwaypbF0BNEPO0gnmvltEEFGANBUsnLRudtTFE51Egn7626g31VVS685kmK6ScvlUlsSB2ac6GBetx9xmtN17kJ+Y2ZVy/1WVXegp3LIRqw7CedxKHleGwuZcfvSyJlCPO9gOsoI06wHV" +
    "3OVBi4CqRaV9AprEusiJwalZBrSNd53BKWKUmGWmzhO75PrtdHpt6/eW3f+sXcqDlB3jnZSQE5g5O3cRhYNo2altMe1AQRvJq0bdIgpXYBdklFKnLJj5xvGzig3tZgcEIbLxwE7sBFByLtMqPJmbaN89v/hnWW1p" +
    "NdZxaoJfoCG/bV4qzJMF/hiQ17k8g71gvUm2YkvogO3jRGgmMPWT/W2evThJUy85+d5BHIE0oWlVirG6fans4k3S9Bc+v5WJR3VrJ2JbHWZHpDupih1PN8Mx6HGc9NDQmfpi9TXjr45sFf6sre5Nw9c7kyw3q+nB" +
    "Y1txUVTHpcAL0gi/qC+/ORpJs2wNK3cdeAUDmcGCGrkmlix7G8FAkm29soDhAcx3+s8rM99mvre21w4MqRfEbnKMG4OelWqRE2sAEECrHmdWu89NKwzTMDbTMPhtr9exFDjZBTPbnuBUWKNAXaOFpPmgdzucd3gF" +
    "ucWi7IhVpQo6let6+DGoQCsema9xqmTP3w536Atved39jUJKbmcmFHx1qNMk2B7oYS7oJ9M1I0XX0N/sHG0ZecEHUCJGvxgpmEG6OxDbhry/rchPws9udDs16wvIuJoVB092I2ZRvEMtZnKXrNaHwc3pzesmbDpS" +
    "GXWNOraiZicOnu+LKSP3FpVpZsorzh9d9zOTtuxxEscCpZ7rz9VT6/0n1bkjEn7IXQm/70zx1HzPJuo0dX+MXo/Hp+fVOFp6yJNwW+2Iln2O0xSWnQNYalATeU+MDMXCiEKatmdadJeD5/owU8rGR6jE2iFY2ZHB" +
    "DcT4INc0hQxpXZsrjcZSxbWg5hLA6WLHu0Vd1De7alfUjabC7zatjYIJVT/f6wziKrwe53rpgShXTgXOoYzjV+58+pW5XuhO07Z0+EeB1V1go7CNXy54Sqs1M9fYcekBM/rH0r1jFCbo5ZMjiicjeDwCpqGyrWRO" +
    "ilLi0BZUV1g2pIDjJtvM6Z7wpyrhDapTNe0hdTjEg4vkCQWniU0HI3CyCGebGNaNZKm5HjQVpDk3yYUPA8odzqVO4mtbZmy9Y5Nlj2cuPXzEw0kKFlSCCMaD3OZRNeF6xvjoNB5aXSUvhmfmVVI30swybjTdjAd0" +
    "wLy2sveRwamlZNNszrEg7bJwnBmqaiW+ikLrj4Eh56VpAqlA38u8Y5X67kcn8hxbfHzVSqKN23q/lTOleypGIQjxiMYPH9xS8WMofl4A2xJN1xvDkYaDnq4ZB6eHxdcqI6EN7/SuIzYQpfiJQG1nfo/+nW3TwJHp" +
    "LLwtdHB2CZ6LSm5F3nuxN/V8HITyB+IIJl4z06BqaMpeOrMI1HAQMcAwqYU+ptU5u7vTQidwzPnhV97plFnvnMBbsRAfPN0ESsACOI0tdshvecECb6tAf//5g/u0iJyVG1u84Rbs4NzKNzyl5e45+8F648fuFtZx" +
    "ZUYMx6VcxYDpwcW4g3Czlry6i7z5Jf7LxhtLuLzazHhWIltpTxZ3rMhdu06SrrvQEEoH7Y7FnCfHvY7VX0TtdjsNBK5m6Kuksq9myxBvALExjK9a/UxEaemYWBUFhkOXUVcUmo1Mww+3xD3GNBaam3LubsZKOhbO" +
    "5Pal2tRV5zE0hN+8WcnJIaYB65FRTfDOkqZgkt7OHHznZwS/tMOFnrWWAGmDy+/3dETbtrYEKt8ZF0FkIojOnqWSWtViiFgk1X4YnDlmXpFzpB5+trDNlu7sQ7qulVwcMxDp09j1YbfbEEgKzeAA97JKxCdkDmTr" +
    "jRIzXmmxgf0MGKuoQQ3+N15jh4tF7CaTkgE8/xVGZ7fMyrIYLySgELPRKrfxmTrzO/dQAx+VfXqAo8Yd8jt+eX+jyV6XRn5PGPlcAjmUfGxy6R7Rpc2tDlbbk5cKZXJnGB/aEKuEui3FKtyNYwyb7sYznUVU7ZjG" +
    "MT4Fq3OM3f2s6LpTN4zVJW2ksI9iXcnWr3W/gXfLJFxKICAOU13OUQAiUH74nQXDhjYX9VaFEDBLYwfkfofgnSlnYOX82KAy42TqRAZBoSBIChH6Jc+6BEFozeFCsd0vtNVuaklECKSsUmlUCaSUNKgy6XpLnETe" +
    "usmh7Y5rDW5KlO2t7uhaLe8bzVm2g6HtfTj9Kww4GL+An0UPpZ687vm41DxK3HVc5/BW8d2KYOZuaUUPRMijmNQvrHjPdnjOy/sMER2/GEj+Junkyfv/Sl+UxZ1Vg5vaYdGmtqcKW3XOS5o/0u6W7mNXW2Z3umsH" +
    "6vJbc7NoctkeuHdVc1iMNNuRAtgzR+r5cPpff5tKqQ1+2Z0poqy93SEgtXc4CKXUltPIA76xqbMPpWH4ZbaeKfuzTu6ynJMudsUXOK7pHacMLKnq0MeD5WUprd/Icqh3SFQUWlPPmibqKO+PegelUTuZUECL2Y4b" +
    "NuWDLhhbyxopVTDYMGgzdxn687xjvewheaqsiVbDWbnczc2deOnm1hMliL846O4sH2xVuuPxZsrEQvSYnSHkb7ZlTvJLRS7TBMvFSZSmlfkdCo6jOZU81N9I88Bw76IMESzGycgoYRaVvY1P5006xH2zJ4OywsVD" +
    "kEZ+ZROtlF+HBhZaoJxFFtwtElYO5rzpK36kZi2xgbiymNGLmSvu+gFC5la/IcimNEPYwiwXZOWKvm4olAbMlmEvuAcllh41113zeLi7qjg1bVXqZnoUrufhQ1AY909R3/suAygRpJTIbrKJ/OMWEjHREtt1XsIf" +
    "FvwRxFdHyyRZT05OHh4eug/DbhjdnQx6vR42PbJYNr6j/umRxcaa/Y15+74IH6+OMKCkfwr/f/TqJUaEW3ij5uros8Fw/Pq0f3Z+ZM2vjt6MrFN/ZMH/2aOfj05evUTYr1rqPRGb7cqgF/wvtS5VnUgBS04movvY" +
    "BOFH8rgzqMJ0MEudaLbcZqd16U3eJorcYPZUU9lzKPY6chfeY+HNSVQHO25Oiss4RU4imuY1o5EkqTxUio8G0VfmNj/bFiDEMFniPW/6rR60TvrWiWWXWuDJwt1qs7vYX1n1FvvS9dfZed88Ft+9w3sXZUyhbilP" +
    "DSlG3elX7qwFfkQH+fkV36yIvhkp0TckNnQqXs6nN90sFrBIoaf8UL9H3k2g+Xv2UZceKjSSWU92IBfdooa15O41cHtgVGQPpIEtu251G4Ja+rmQlprGXtpByjUhI2m1hEuascWyI1RkIhj2BWjknNTyHhyIhgcm" +
    "YaQWyddVa+0GKAZAgayLmey9rxIBtQuBLujqZCvDJFhjV5Td9+90pgj6P6IcSRS/nBhtAjSd3Hl2kCqMsgQ+CzHxceKSf5kr6tkHWY0/KsmoovO3+zYkXM8MNKdtPgrYFJZfUz65gZO9nlAQy2vI45bZ8Oy4uKX6" +
    "lCl9LSXi6aSx10ppeR7vdBur4d078gHXzVPHKUGfKbpvDUlU6gP/ZdyyvuvMQUMHyW9ddIvS26r5LrXsqEZx5TwoPxysPfQgXK1gBXKz+2aVbzzXUoYrr2/O8vKJ3DSliS5PIEvmyHkxUo4zT/Fvw9GtzGNU9ob0" +
    "HoYU0XSq0HRWNm6NgROpnwtGXGQuY0fpTvD0ALunClOPEmZsDSvo7uRJRjdYQ9rANmesOqvnT+ewCxNiaeD5RktMbOGZwVko/iY9NPOd1XoyuFQa4PML6BGH8Um8mePXyTGXp5lLojdbspNjfaeQydVXD5W1KZO2" +
    "xfB96G+zl+aYf8CUV7AmretKN9A5IMoA6Xirnbv52httMa8TxxAEkbkEZTgvL0x6l78wZbRodt2YKHZD5xepQ+5Qma9H0Z32WobQLj5WuA11uG7PIquSqHcnsv39+6o/uu6X8n9zQOzwaP+9O+Ppkk0nBIdk9lLl" +
    "4vTcHIqoJu7i7wBkD/0MCcIKJT+TGhJ2peVWWorwO8BzVRomay7BXLWWsCj8jLYINMtuvqPwIRMUVxFf47nk87AbyiCfB9xM3ngTM+hBglyMVelnCrhDmucROyT8LBttdjejgDN7bgw5qx1mphPI43ZIn1+10OoF" +
    "FlSik91mMp/3l7uTSegynMtk4qjoYOSwuXbFRe+qNe6djHuFnQaeI9/rIjntnYyKkQwByaA+klHv5LQYCSCwhvWRnPVOhsVIziogkW+a6O8A7L9Ya859XZDoutSCeJfN8C1dQxkjXfNbpg8zZG8XVEFOMT35xZby" +
    "aRUnFdD2tPflZp7+Hky9E8qfDg2+1dXbXkOzNA32T1t1O1z9LRAyNTJHLuWOATEbdO4GQ+U3LXJPZZS7i97EyyK1R0jyhKguE/OYfkndK3MtouyioRCJnpviMLtqQNnNqjIdEF6URu92ZAlq9JJXChx3K8YdZpWt" +
    "rsEvk78waNzkZjaipWLcwjAxzONKV9YKb6ZRprHcWw0ZD7OajCLjKSlvdslusVs+O+/i7LtT1ahgpoThc5ymAIKDCauOdte7B0aPpnzbpSLOjx3NofrEPmcxj0rygzKaWIf0e3oi61UOYrs6SO1uTDOUSXA1yXLp" +
    "hbNmaGKwShEknuaoOYIKmEaGL0NWpbEroKnawGUIKj9qBdRUGDK641d3xnEYzcw1haBqs8xATcX5pZBSYWYZ6KgwQLp7pOZI5YA1MmRGEiuN3U76qg2ikbjyo7mTMj6sakrY0je8WK6ezw9P8mNmTfbF1FJ0NLQC" +
    "N738NrH2Nrrw1l51dy+56viVfL9GvFBVcwQVMI2MYIasSiNYQFO1EcwQVH4EC6gxjOBpuREUOQ1qjqACppERzJBVaQQLaKo2ghmCyo9gATUVlug0OUPNQdMANTJsOdIqDVwhXdWGLkdU+cErpKjC8HHPb12VKaE0" +
    "ozE1oqopTCNFFfWlRk4FdWmkpcJg0e3AmkMlYDQyUCpBlYbJRE21QVJJKT9EJjoMy1mJoEDxDHnleG0t/2U3TjZzLxR5SO6WYVzKQ58a2SZIhotb6nVR+fzgqMoj4LzYcIecuyR1B6XBs1z5LhbzFrh4+5GxlN8k" +
    "ni2V/Eaqj3/HFSglpnikvWCnuoa5czAfIKOEavYPlqFd5INoiuQINbMh7MTC7pAbXMj8qvEqDEI6ESsj2aufYHKt1slTlbmRJTcPjB1haAlnioWvKGZPi54rvJI5LGfeUrZgO3LvQLgMx9mVHhtgMNPDixTuwnt0" +
    "5/KIWgCvndE+i1ApuyOptKeRE8xv15EHE/epZu6oQ7HFLuibeRYfe6q5WXzObEaXEWoFFu5HI1IxatGSpS967sfDbt1qMYulL9bvx7J27txbRUi1w7bxzVm5B47248P1rhBf6WQHh4xWtAAtePsA2iUjGmWTsB0g" +
    "8aSz9DGjizDNokE9aJ7FpZPtHIhstcnkz61wY+AA9m2SJAxEz26ndx9fRekY6Ybix5ZIjlPqxWw/yz8rthNnnDwJXfwx2amgub3DRTujitkVaFtUHfcpW3+Hk9HhC0Kpy0sS9y8eAsYws3ANG8NkE28mPahqTBir" +
    "qg4a430UwDzkLGvIVwtH1jExg2o/rgohExoelnnksC6VDFfOsI58MdIto91OuigdXZEHvTKB7ndLB1DkIftmyMMGiE75kc2FhgmdP/FW6zBKnHIv8O7kjSnlWmNo/EI0o2Z6A8tB5MSGFcFwR7VWeuU0sRsLWrLK" +
    "p8xhhCfOHd3FkzfFdgQZlY8xUnnzXyBETe0OXVoLwVp0qS79yWOc82FFla9OMrwiWEL1YhlloX78qI7Qth/kbdjywbH18C42vr/NXLyW/a0DOlly3SaL2HOoQh9UcQdo0Fc7oJd83tIA3d8BvV/ywnMWfBCy1HwZ" +
    "FGjqVvWA6ig0wNnUXzXBsmTfjcG0DX4QnS+YO8RgJ9dZTIzIpfm/Bz2zixtEz7wke7Ayv0mDWLnTZA9a5kZpEG2am7cYKfOqNIg041LZg545WRpEn/Gw7ENP/zQ60qnDZa+UoQumyalFy+O+8SaPTINYVXfMPmVC" +
    "DpqmcZN3Zg9mZqY0yeuss+YX16N5380vLesGV84+Esi5U4eEKXvl3WS38QsT2WRhTRuSSIGNuURtsCrCh1vKylzvVoUCV44j/rRisL5Zztm6p7YqDjZuEotpg3dgSiPtTSnO/mougNgPk/zVTn6JRQxpQyOIuNAc" +
    "j7eZl1urg1ptM+nrqoNSdwjjXg1QPB9/gyybOnx/+NPGjeXzFar8GF493fccak+9SVhNrBl14WJha/vJMpljTcBWKrBhNYcEXZPKqqIKE9cN3IWXGJRpbvpVxMCuFTG/myk3O7v7ySdiM9cbc4j1bVkuC5F4FiDj" +
    "Mdj/pFkuEiHNa86QL6QrvoILnsNIfSamUSp5S8vQ7ZyTrOpIK84dZOIt3lIsvmQokijk7hnuoJAFw4h1V5zwjyrEDxhoNTuoikwCkthseqgdbkHd+yZ6UmHPrVK+CueOn7cRMlO3FqNY8AZFic3dxPH8OMMm9M3+" +
    "GK7BhmhvmxoR6ld2PFJE5pHKxIGk2YCKU5BTUqAOywwkaRdHWxfaC+wsd2yhRaO95qjfYMds8CND1st+r21491FPYGdw4NbISCYenGdGUfY1+VqmpgZaK6lyP2VLOjTvU5Ke72y93CoIz47SgnlmhPNFqeDOE/mI" +
    "YFpD/g2Zkz0tz7gghJdBaZHxEkgpUbGmG3n5cLHSH2YgC7M4rVC3w1I+MtW0Y5XqRwGa3VSaGJnf9xmoN2zNpGJXFz6UWTtO71znK1dKZrZcpZ9meMzVPfoV8g4xHQOtmISTK35bYypl4bEZ08R2LYXJcksoIKmg" +
    "GkQ2Htu6t+F1eKutIc1eDXi+fuRbl7xHHV51aKSTM1F+ld97MYNNw/k44KqRfClgHrfH4VUN2UvhiQC9yo8wZAEa3r+oAy4bcidORytG26WAs7F12rFrPY4qQXRynKrFzykCxaLlBF8rBsql8LSwuMrPzxmhsvi3" +
    "mie+Ss9zgW7NzVJDRFtjcmAKXRPAK0atLSLX5Q8DGPcv/dIOzeovD+oU2WkSXEs+uKfvUiuIq4S+NEDXNvLfuw9xRMEJYitf+RWGDGrfixMDdj2pcFUviorEZu+lbulvihBkQRsapgprhwmJ5XuGyH1Dn+q/ObeT" +
    "iMlk6sLmDd93Z7E+rf8xOOsPW4aMsKz7ppc6qz3Jyj1luE6TNylublLVIiMN0/o4D5jXIg6Pch6yFGaIktnhHyf8UYWaKNmFLzNX9udAHXVkOkCW7JQezqucPnbfeO17NrV6ssBDMNv8lEKJU2wexSrbv+ZR+Fp8" +
    "YqWQIQy5a26ZbGALCASxvF//FQIBsTN8/665gqpGYuLBB6iWxrVdQUbLX0Spi05p3okmw9GzCJhrobnocAkfeW6wF6rnl6xqbqYUFb35XXNvIBEksMjkjRBxvIFnzockpjc/VZJ/OiCbDz97oGBKAnya0QBMARhy" +
    "2MvX2013JtX3EnhDqz/orWLpOq9gt2uCozwvYOCxIK7C2YKOhZ5x+ghY6AXb39ZKQiSRYtw/KUvnFFZRoC1jPN3lB2WGNan+TSGG2o6N1PBDnNP0iaOLksl5NCSrHUi0h5ToR2U0/g40A/UNqUHZt4RVmP9QWTVU" +
    "Vjqncvoq5W5dNcLgZzVVI/Dx4HQgLuX/qhFvjBKbbi/sOzmvkW1WQ8aeKjxMGYon6vAN5aoIYadyd5d7sqkwYW++55URHzbHe7/CNM5Ex/0Kc1gVhtwsTvlXe5ZxDNl53AgGtqcaqCE22fCj6V1HiY9rFwcpecHS" +
    "jbxEfR8p2woLM+24SzUHD+rSlnracKFB8jErKgTYB9iPsZTFbFUsAluyFexNllyxODDO4/ArxvJx3ttMTxz8rnhufPBrpKSDdFcOEZN05CqsVzJBaCWHsA7eHFxX4vm9ElAzjycr8sIlq3pv5t69N09fBu6Z096D" +
    "7sdJ8yVOmVRDgUSqN9/ZHjZ2/UWV15p0spxpuDGdH9Q/GxEIWKIjfijOjw2ileNf5pDWYa6MViy828kXwQax1k7O3zQxW7OqxapUNWatAFNrpb6Dy2ENJUHgYnddQJu6DKTyXuWkj+OLw5nn+L/cmwkG5JWGoVqs" +
    "uECMF59hvdNCT3rnhucn9Xk9PGBxVl0JKKZVT9ikPMSJcoZoS2vRA3trnj1OzM+Q5jTTRz3UzOP45c80jTT86keakiyR6sG4CcoeUWXumSsnVrxVnXB9vgyyj/nriNj51vvKZka6IjUJlS+mTYLkmqNJkChwjcID" +
    "STHAqx9JWTz64jHPpse/NlyTBNQGapKB2kBzUlAfYlYO5JOrDTiti2WBjq2aF4W6YE2SUBemSRDqwszJQW2AWTHgABsIWtYs+yZVGLdKTVqsyRPXYvprTz5TD+T8ayqxWDH9dYXGRL6Qm+ZOpNMr5U0G/GehNhWi" +
    "r6SV2aymbsTzDlCalrSs9NuduUf/GqXs0FcjC6jih1rnypnWee6x9TE9xVpwZzyTSDt/68Zw3SF3cbPys5I7+WNOCHTAzVPh8/xoibFsGx+mz+aqqffe7iEYGCfyWxtxPY9tcbh3OH/o+Bft0BH2QnkGFSQH57Ig" +
    "TgtKvcWc7RgGk9zC/7NMUrRPl5Xo6V86wV3dvFUaDlMDTMqVwQ1c+QBTZOb4s2O8Svi5Jf0IOfra1u+tQQU3UjkKVzsoPP9NUOjvoBCTg/2SJGbmojxvJWLyVDBS29bJR6OB50qTD47z+Fwx/XYxplYesV0UpQcC" +
    "pCkLeJMS8rlwkX0sHlEamh2vtFcOaj4Y+2TiLBI6XeYeJJPzKOKPWghNyxbeQqkSq3FxA9NN6vQitWEBL85XfGFMV2xY8mVs62GPg9d4WqCA+ZMgTI6LWtnzMGmbhifr4Tt8fPZM/d+jE3YsB+vA1rtHTi6RJlsK" +
    "VtbpBy8BkPEHm0XMA0v4X5fmUu0b2XFp9BgKtS9odefPMF7mSuqOLN7r2zFkGiUUeDPZRP5xC3FO6PdJfH/3+ePK73w2/BL+/GzQgx9B/Nnwq6Nlkqw/G77+bHAD///w8NB9GHbDCJrcDHq9HvwH2h/BB/iqxxfh" +
    "I34CpVjTG4zoX0efDa8B7tpJlvB7ji3ejOGvft/vd8f2qDt+PcCG/Cv8Xx/+d97Fz8fLs+7AMdX3uxf07/F3ffqjv+w7fV6ntcP/3Y/ydTaVLO3+veFDWWmqgk/s/jfnxd99c1r8mZESrDJUsMpl/+fVoEsVy4vu" +
    "uQ/Nh9+cd/s+IRv+/OYM2w27Y6ffHRBPBgoAORrEz2wL+T8b6n9e9env2nCOUFxo1JmAwN+t9uU/5O8f8vcryl9tLRsv6amxvytF2yfR9c9xoO5Pu4MZth91z+whse68e2FjXb/XPYeZcG73scA+7fbh31j4b2P/" +
    "3B7+9if0x+xn/eWZjkn/ruTmonuK7Drrjnx7bJO6JK4Rg4mlnLH2Oeg/mpJn3dPfvpw02a/6CiX5e7Pb2DTrnvoDWv3G9O/TLvwXZtUZTTniL60Wp92RPQbuDvHfyFlWA7Nu9N2A2gGDffja7l789iXnF+561fxm" +
    "lXxITBq9xL3Fc7DizXkTLx99VDL5zDl433lWZtsJjQvyeBpmKkX8ZH+nn/PSPELqI8i6iiu/HVXqsvtOpareHrPuQM02cRKuftvCVEzjPySpOUnac5yyz/nIEjt/FLQHeR3FO2E5njMWUqRd9vGy4Ri9gcydNx53" +
    "xP+6o3Hb6lmj9WO+rtfGcut8/VjLsjCfWJEPXHE5Up8sioAk52Pl7EraYxwZWuhVEfI2iieV27+JA8Tc42laMX/T6WO8oZa+bXYwxlpPnC2duOg9tbIH8HRV0Z66yYPrBjWimjkRLNwg+5pQeXAU8Ln0gsSQO3Zf" +
    "1P7OTNHaVTB5l3Cg51rPXhCrnSx91zM0B0Uy8FiUGWrQ94bnFfSU48asGx+f6gOPgpp4jHL30zo1WcoTtOos5YUfg6U76a7A1KqZGY0PBtXkJc9pq/OSFzbLy2JyK7CwajJK8+tHNXnIs//qPOSFzfJwB70VmFg1" +
    "AafpLaeaLOSJknUW8sJmWVhIbQUGVk05uvtdqpqs5BmldVbywmZZeQDdFZhaNd3q7te26jJVS4ylx4U1y9QD6K7C1Kb0T5pvtvbCQ3nLswsPFTatNHcTXWn5qZZjN2teUOfrqk7t+SMtaW/T1lAhuVV0Z82Nr+GN" +
    "t7qWOsuIn7HUWWGzjNxHdBVDvWKWMxNllFS5JjNFSLXGTF74EZhZSHIFVtaPjzY/mfD3s5E8hPJfcTOZz6T9d7O6H0j7r7fCGzKJ12Wu9miTlpX84zB3H+1VmMuTqP/zyp17jnWcOpys0Xlv/djelqBdvPEt89qU" +
    "dOjpT9zJB4DO+QNAFmbi1R4Mp5MRu2/9nl5AlGnXovTYJK2sTAgmirE+l8liWC6Ukgl7EQ57i6kJaNM7Bot5XpuAGG+m6EfFU4cqjxLJ0c++ajQomVcQ6jGBbXGaoLIdYwCBRewHQZ70rb5V1jucAcQ+hMKpE3vx" +
    "+zpwt2nkcdn0GnLM1Iwa5d+aAfx3LrmdHX7zg/3NIVJuRbV46oDq6I/LjQRDsojCFUgGSO56k8TbatfvpKRVywEO3H7ALFegAtfbKkJFsxnzpW/NSdP7i3IPhAlwlJKKQDJI7HSIJZBQi11gf1k5gzELxFuTkm3p" +
    "/cKymTkZONYepmm4WgFR7vyqlUQbtxilmqbzrCRKYMbsA2suVcNVaxlG3s94jgzNzHqjDA7OZTqWhpVyZ058eUB+N8Oq2F51rH67Y8lM+Ralyq+Onn3HkkletXDAoYuVSMJvSxHC4bIPVuHU892rFg1AIQklhV69" +
    "+GzbK3xs2a350jIlK7YbhBTPwPpiaWeNLzWIPKvpWw00VZs86N33bMThTzgM9j/hYHh1osbB7N7nJ8qRW/uEeNfhtZ5660AUKQaQX9Yv2UX9+bcSC1we6MoEtN8twYs8TN8Mc1iLUOUVisz7HWi4l36BfhcnTA+E" +
    "NIDAL0Qwqt0DplNQOWUVTRVlZQCNklsIukwG8wNhF+vFghdsCrIdVKdK0c8foc9m6L/8aqCRlgZghevD0oyYP6esyrdMB9aB40yhv7ebwEvqQPGCW9ry788VW5dnynAa3rluiqO7sWzZDV572GBnRPFH6AErEEQf" +
    "miOiFApRL5AcejV5n0w2zCAupsWEfwS68dHoZmmmF675JfLm6UXnoo2Rv/bUBS1IyJtRMHn7PMVSVwGZu+IG7uIjwGWbno/JlI+EIR3bj4Qg99B9s5LftGzmMTQumIZO1JfKPND647mTFx8DfJPCmIeek0SuMWHN" +
    "Tg9L1pG7cCPYVLrzzcydQ0OyVCz2u70t4U7bLAASBv7Ha7YjdQJvxXIu4zHOxo9dq989jS3XiWHTHtjhJrG8YOGBfLnGo9Pn55cnlCv41csTXHBfvZyG86dXL+feveXNr1rYVUZZBPxrWTPfiWNWjBywUkYxM92d" +
    "t6wD+qO1YXgWt72if/p6+3sn8mB7xb8Lir8b8O9+2sDQ8+Y/7UfDbXAbTPSYvIcSP5NY7osQOQOhy4xfGd7Y6QlayqbpnTF2TGvAkkkvAIeGl106umqlX7Us5ITNLjlwpyqMI9BiJohBSHFxCyvnAmH9ypfz7XWu" +
    "HLYusw9PRmLxE6ApXjtBjhwCt3B8H3tU/LVF/AAROvwJvHPt1ZT+cC0fqxu/Ph2d9fQY/NOb85svRMYcvJUyd+KlO7c+ve5fn15fZwLu6cEVcep4hk8/wqYfu3h/Z5H/GuRl3LKYR4D9zW98XrXw2stgBP/fsvCo" +
    "9aqFe3nzKOKGxoJPhi3r6ap12pKwzxXYUBlBmwHyKAo/AJM+PX99MXw9FAW2+Kp73jp59RJvllowDd4MrYslQjrsM7z0ysbw1fehRZcg//M//peFV3k81C/WWxgB/ImXkuIutMem8j8Hy6O81JMrsWEyRabiBzFb" +
    "TZWYRc1Unr8uYGoVhOwmkVEyRbPc1JcVQpes1jDGIIrJ0xoY/QOv/sKJpHLip8ionwjJbQaGAtXirvY5OdrdNYx/iHND1E8RLInTveNv3JUHpPa0EgfkZayWBOEDabi0BKMyrlpvAbzVt8KFNS7sJLvgVVyNQp7v" +
    "BI0ln9Q8h2WVHFdS1ZkELKUQOmMggUb2ldJHDdbhIjtLHO2HrW1ejaIDrVKCAhpKdnZyi/1Oq2ZsKZp77Ahr+ztcxi5huZ8t2Z8T9h9QoOyPDvuP/CbmzX7knz4s3UD78vY2TmAh074O11oT9yetluRDa/Dla/bf" +
    "5/fPoJhIh7166eT4Jl7khTZgDoGWc/3J5/3xeNwfDEfj07PWq3eO/8FKQmsTvzxxygwB7lT1XzaLyMiUPajKgBWBGs8XhouFjXo5Ww7GC4xptpStQDx7sGm4Y+aZusXmBYZCtkc4FfRfNslxtgzNWm6UFloKvGLp" +
    "xUkYPcnlVq4zLGjIYtqJ/VCtPAVEVpV9AVVf8A+KNJnyOQcmJr52J45rH5qUDLCwGQxL4+8+PR9fDC758mJh65cnjHIhNivHU80NvkSkhKxAzSSAgQ2NLC74zS3HeL/lCN9QAjhSuuxcdha5biB61utb/+//Wm+X" +
    "DoaO9XPSoAUUpeqNk9EgvYMcvX0zvQOF3kE6v38lsoc5sgdmsocK2cNDyc7aqJh1CZ9lxC1NxgSlMwP4hOJTlG/od4tPJmXlyU6df//2h2+x6b9yEkwT6Kfbn711tuKDC8ZgWk5v/QWOz4hVa3j0CkOHZxDBXco8" +
    "AU5HIvqsghF9sujfzO4INivYhM5aFliTiP6q9T/m2zFof7AtfDe4Q8MRTYa1whi6dWSJP2yKUuCmi+O7USIUgHePxkzogz0phk0Swj5dhBEnUFck7C4SSt86Y3l+BEEc5QRxaBbEkSKIo197/ozy035kJnuMZL+O" +
    "VtXnvN6axfjE6kpABRK4abWX3g7lM1EkZIOJEFoxm9gkQ7lZnXOhFOyhmQCtjV/SxH71Bg0xJOUp3MDmDDZWeNYCBia9jRf/53/8HxJFM4h4M2VQvsQcXQgl3EQwoaIEQzUDN3kIow8WyDpCj6wpMNsK12TUMQE3" +
    "8Av2K2QcqsYlKzFySydNNOWde7d0gg9xSgBTJ/EnuS7J72SP/uRas3Djz4P//I//ncA2N5hbjsXI4OAsFl4BG4+u0pkTXLTL2H3MoZf9bdvxMnwAs8y8b2ONhNRjSyzF1q9ecoAKXiqYyq1aVo3fUP3OrRzHB/1i" +
    "f+k7DJh23jrh64WzXvvejLx5J3+NcVHgDjgwXxbeXevVtkWOrFtv3prs82R1WsxZJhrv9K7JxtyzJj7a6VqTHwXQT2h+Q2+ZQjG3tm65+6w16cumzBvIwHOPIHzAS5PwgxvErcm2pdYLj2GnFYMgzhAT+VPdYOZa" +
    "rI6tBPHSdRPreOU66I+dt+ELdLIhvHRrSY9RAgh+yxLaoNDKUnaLiJe+FXH0sprdjOHV36EQyypux0JPofecFZPW0dswco468RPs1Vf2xuu8Bv76nRimE2jtyFvwD75idgV+8R2orQiE6ajztRtGd57TEQ1hM/8N" +
    "OX6gWb/Xu1+2njts9cM+ckcG9YL2ydh/VvaVE33AcvYKcVr+HQfGN9RQwe6oYxG7YC6LvsF4BSz/qj+67iNs0vvISPoHCpiXjNrQ1TZZJNFcn19/eYOCw69xE010BxvKaHWnr9lCLqn8kxMv+dfXN6O0/OtlGBNY" +
    "djlBkirR3Vzf9K6/gHIl8vSLO07z65uzTI0kX3Zdqf3aDx9Q8ih5znDQuRh2huedXrc/aOMoYJYSXKhgHB6xWzxjB3Z1RT/5rxWyrM/+9pGUvqh59OHXgP9NP4YcAIVTQsvz9aP4+YbcBVg4gELAz1yTiJ7wnVJT" +
    "hqxHfzNkI/qboWLl+HI4/LqAfxgklqdHQtqVIlyg6In8QeY2hLpH9RjglWt03hY0ATKg3BoZQPV72OqOjQIDhsFcVmZAxHhw70vB1BcSy524f0nHhJf8WR0Zrs7eOI9/Ql8VsrfHmEdbf/jNN/8o749vOf/2cU6k" +
    "e4KW3HveIW/3jaY+UmUglIBo89b7mQSgK6SJl/9JaIizXo8Xp9pN6AUsfU2TRdZxoQfeTdNtPfAPbBMcY1rapbbJqDtOS697fsZ5Ro92Z/EC7PS8DGHvg7YbltjUA6BVfmxCtLRiZdBGXOL5EH/lxh/AXlMHmtek" +
    "k4uPPyi6H1gVzpsRv2bEa/7AZx6bXECWsAG+JP2oCqBZW6bvJX96fXH91c1QVqag2XzWpYvmUzpTeh2YBOORmCm5XmJkojWi6aXxQfZWvz+FPZFeaOjFUogV00Lk9lVkh2tmdPeK0gN9uLnOclWUXZiF6LJbQ1/Q" +
    "c6JCY/IJT95ToFVfgb93H+KI1EE6iYSYpewZ9pk65BWpDPB7MrxOzq5TNrsAY7okd/tjdYr0T4eD0YJ35HVWVWT6IbRvesFK9CSdDgOpkDiG0+FZ7+zmQAzDHkMBBqZ7F8LiT0cbOST9gam7XJm4uN9/K9a61kCO" +
    "0ztxNwlKN2tMBefErkqqXFMzVKULWHDnSm8IUEWO5n3KUDbi9A/ksitrMl2gcoO5h/L8jUHG82KJMu7O32kTQErnJjBVy/mRLDerqaCVY8EiaXsMs891yBaaFpH4GMBUKQzMC/Fg3Gb2I+hDGves2fosrapU80/N" +
    "KGc7l9GRqlv+nOou1XYdM7lRlPaQK1Q6DErnXq/3mUEZsqa0KuhckeYtrDLOFEbhX9gb3CTYhaZ51hSXU+Fi58wP6XHJt9yHMEG3AYoxbD5gdXNgb/KFM+ebD4Oml1ZvZnUQlqy5zyqjewWMxsu9cnQlGk2XylLz" +
    "2n3nrOUccB+d1dqHCbNGln0N+yvyBrDFFQ9+B3iPaZO4sYXuPUzNRGrMncESfwP6YCcX0n1CRS6c55gwyDMhnSwqE+RWrkD9FXPhL8gBL0BtR3t1y4st1mGmwWlr8xbP1ZoafW1SZWwQ83hjKe/UkLGEv4a6T6Mq" +
    "zaSFKecBr8yrzxX0GLbaeebyihuDoD2jht3ECXpPgE+M39zkwniOr5UBOECo940nW3ekqf/MjOC3GJyvoBemINaBrpQqizMRi1Wlcj42QsaD+W+DOfpy2N58HkpuslFTpQsq8ysFSySw1/zhBD9zFoHJ+XXkzblt" +
    "jfekpIUz7Iiid6gboVMDWSI0bl8Qlu5Xi9Axf2AGGcFkEAYj0c/cXlVQqs2O3NOUhdO/wJ7WnCO6iZvKVeIlviqM2eKMsUDleWnPTy6zvmFLFHWiqNI8/2PXd2eJcEnkv5X12uepFR7ONvEfWMfDTYLGpKXwl6dM" +
    "sXgVHndjIA/riWnpxLEg70yGHu6owSGlYy90QqUcx60G91mUGuWBZoing6QO8GjEG0FHi5i0g2KQDLzUuAx9tTI1heZRuAaLiqwgL1iCakyQNNZLmDVL9z4CEbi/u/HIe4JBZf2zc/wU7Etv7ggjlmh4p6opSQFV" +
    "mfSiXELyCm/p+msjwZQagIV8kOcG9M8N7Hi+Dd7EZPn3+GaVvHhU1h9j2TQJ0qJBjxddOzEbw9lm6s3sqfuz50bH3eGoA/P/tNM9hT9oj8n3h8gFgjACCOhAACvowzr0goSoYbEtoE2xxTmbmfHKgW9YEd+wJ17w" +
    "xEpgvWGyyHTXGw+3NacjaSK6rKTfExtVdphEigg6+cUuadO27Mo2Pt3gyzXA5BtUQJq8hMXexa+F50os3UbPFVthhFUs1BiWfZOan1SGPnfdDSQWOlGT0WWzxCnYQ0BN3jUGhVnFC0Xvdmz1lM5+mcVl5BVahoxh" +
    "kpRsdZauZ+kOpRX7z7qrFUreqosXLj6p/oBf36nDi99LnysAxmvGX4o79Y0j2LGUysUzYwRlPxDNSVoDtnenDdPbVnYH1UrdXVSAdI17SsENc/uKHVbqI8059WVVzg2fVuU98Wndu/SRAWihPDnQEr7m7zEEdsIi" +
    "YUXZ2wN8z6zlmwM80Kzld4f4oVnTPx/kjWZO97epw50VvFHc7qzkO8X5zkr+rLjg+Zr5Vi6aA80/l7H3efF33PiwBpklVnUnsuOWZ3U4pOR8zDH/gY7dlDM2pcpwSiVchGldwbMGBuehaPJaHFwVfcpUUIefX6mf" +
    "8k7mPjxnDkvWvw7ngeJb5VPbSheMrCuYcteTLsEw9IwywSJNm2CBok7wp6ZPCIaqsdghB98/FZjFhx1xlDi3KD4N0ZRXwQaK7ZPzmzZW/q3RjBbOBOO2rpFlzWyGQYViFeCSzV0s3B3wlvflAKfAQsYJ5EdK3/S/" +
    "Y0cSuUmsbWa6mo8is1ljEPiio22RzacsorsYnGvwmeAW3XD+jcXGIXlm7h+KeKUe3S7Z/JqPx+eno+H5+cXUuTgbOouLYW82Hl2M+qfueDqYOf3F6Wjeu+iNRhfuYj4enQ7cwbjvjM8X85E7HVJ/R7f8eH/l8iiF" +
    "AFYyGV7gTG8TN5bhC48HxTyIjyIXExCg4X6GdjwLhGAXACatL6jTzmLhzW7BdA1ZmMbtFHgNC2sPNsQxxjAQWegEpIM9gEydlxwBsftxK9mz3kx9AMeJ3RldmvKU4rZak5565NGSAaVsfmLSq1uM1YMqHtELBM7n" +
    "aKzfpjuUWzegvV5rsnD82E1xrJz1GkRNC+BgG/58VYuMSxEXgx18/9yp0MdBvo99Ux8Hf8d9HOb7ODD1cfib6OO2hWFJUJMLVk0POVmnWRApbQjXaMcqp6C3H1xUj6xeRKveUpgpL36uxstRnpdDEy9HvwleVurj" +
    "yDAnRlofWYTmb6OD7/EiKYWzvXr5iW1/9/Xt67dvv/36e9sWYW6vjkHjErLj9hYUrPXT1QN0K3zo3t5C8x/+cP3NX776w+t317f/+sfrP17f3l79+P5yHs42qFW70JXrewrvicEAcaPj1gy4+KHVkUBdBjW5crsJ" +
    "LIVucuktjj9J/vY3lONwYSVdjD0Aufzk6qolvmq1IzfZRMElfur6V7LRcetHeRFnGXoz930nLeD8ft9qEw7XV6HgRdkrSTfQce3TevXF07fz4+yFWgKAf/3ud/hvbP46SSIPhtBl705SRkUY86dW++oKA/UFrp+6" +
    "6028PN66/sT1O8nkKydxu0H4cNx+bl8+d/BICv7bPm5fpiOTHQnr+KFjzdvW9sXRJnbx9p83S44uX3gL6/iTufW3v1mfzLswmaOnt+R0DKPXvg/NLU6D9fwCu/yHP35vXVlHkty5HW0CAIN1sesGULl9Zj+ZZxsK" +
    "cOW+fCEJIcIlYCvtDOKQrbz4GwplVZvOuzy8FdhjYa+R7HmX0gl5vpc80WEM1R6xlkcaTLwY4xLAJHpKwT50QQxQ3t9CPexoECrRbD1bMwpnBYlLm4sqBXC4BkGdf0Ev+h1H2Jb4AX3nKC91jJ98chxbv/udFaMU" +
    "fJu4q+Mj/+42mk+OrM+tqAuqtN0uwE6TOYMeX/77FyJhJ3Ic6hjrY+iwGW3HOuofEWoNuYYNvv3DJiBR7lh0rQylimQ6VmUaREXUMzGL09GZ4bUc9LweIbOVCsbJbCkpACgmPuQQqdKIMeFH0AvqxAsXr8nzT8CU" +
    "DO/dHV/RF3o/vz+OOlaA3UOWBsjTqEvQsjPl+OhHBV7w/qjdsTwQ+jCyjj34rHdpedZLANFlFyfg5+efY3eC+EfvfZeZ7+x665X1lm5xHAcGin6gEWbTLUnJobjYjrWGkr5lQym9PHdiHUddliQ6xrTHsNTIoSDx" +
    "I0b+AIu5GyVPJBlayfERz/Jqr4GnnKo3TrLsrrzguN+x2N8sueW63W5nCZ75sNN+561AiZNgIuqom2CBBbqZphKWP3Rly3CTiCYATTS+Ms06EO81DpCUQdJlUXcOixVJCv1lMVVxqRNzKTi3SyzWDqjKORMMIfVd" +
    "Ve4v1c4uPD75X7BuSjKkAuXDQtIgpAtGRIzr5QvRIzENoEib22zwTv7njz374rX974798639ftvvnPee/9tJFzc3gHcaeaDnYXhZO6w/VarxdmIbqWRKYd6dheEHD9lEymB2xZQBQoE/jrrsJ129hJ+XMOaP9us7" +
    "92oInfgBxv/q5NJ666xcvBl+9Z3zCL9oO3yUUWAoGCiN/kKMCKcg6qKns0tznBYBvEoAWy9Wxz8Qak9lOA1PluOoOaIuG7n88oXMZ2uNGAwbiGEzxomTS/5fpPBSgpH06hL0Qsy9Il3ExYdpI5XwhHrKpzEKN1sq" +
    "+WIcsS6YxEebDNQ6XSaxreDIZY1uc15Sq5cgqgiXi7YKVsgvqYCZ6/nHUumQnlHFOiUcl9pETHNkg9AhoE8GY9AiDEhb51cY/Jtc4ivw7TA+ceVhkhxFELgcSn5Jrh6uTF6w4b/MKco3MNUV6yQ/M9PJV3buacYK" +
    "Hcrj2Ln36dzBeWaeL+49KhP3XtjajFMJcjtrb5NSPxKYaBX/JLWzj5w0C/RRW0d2cmK9ttCQg+X0KLbAMrBIIaB7LXBhP2I5mEaHsv+xGiQfTEEgxgks4J7vuRGCwasg/FuSx2TpkoFkTd0lXlE69hIA6dx7d8x/" +
    "x6CD3T3DTCAn/t2JP2t3Xygjclmo0KW+lgZKTmFr65XzxNSV/A6L2GfI7dlOA0PjXgfnJJNA9ItZXsdyOnj7y80bHbOs0fHCgcoZGh6X9ImUayELQNV/d5/YaB7h6LMybqJhTBiZYvxbR9/LMKEXrfATCVHMs30o" +
    "YEGIvAOQ8HZ4WbYIFX6OYJxiPY1NpM1okc2IX3IGK2aKYLnDFqK0kbBlsB9U0qWIhXQuK4XHWcv+WV/VYHrSSijn5855SHZcbhpe6dMQm6SzUDVUkVnvaS4SNAC+jnBaJV+xO1nYg1wh26lxaQbdx6YD9EHTLFnR" +
    "jxLaMkiNk9sDw36hrVmFuipCfc+2GRMy6DsvuGU7wduUsfttkBiAquPM24OkgF46ghHv99oAxRcQd3wJbeRnL9A02vcFtkm/QF7t+wKlUNCGR6T8MxDlg77kc4AjRIuKf6YpEk2LqIIwW4J00LblBaq5CVMIHbZS" +
    "zuVPXCXkD1rUJ1wB0fsrFqzguDDCHy+ecVUEolCl7SR/4QhWMavzku0lc24gpmRh2FKXBk2QzIwBeWkXgnA2jzugKMK7CwidjD0mKzfYHAaHFrfAfbDY5WsQbApLimHlerLkVhgmiQcqJNoEAV4TPsYFz44wRiJq" +
    "T2gZC/05wkIrl61a1JcYVD+sa9ggxkRteFd/tU54E5p5gMli0o8fd2kCcveMqro+YWVyoaNlipWBesTjLLYX4qYSpV7BJV7ZZb5CgxE379DPH2n835M26mNhxk1i2KNpvgWJUbU6FbBW//KFdDJFl+n2Krvpzdtr" +
    "Op7UG8GqyLCVQFRLNm9KZjcJe/wT2p7AaNsbTGSwjDPqdOYEqSEMCNFwyLvvVF3PbacixwQByfomhJ4mF0VeV6tLY6rgsTHzIAHFc8P0Sd11syVeBgFmqAY+9PTB8BWadXiLOz/jmDjC6oiiiIsVOq/hs4wRrxl0" +
    "FfmG+/7DePeCeWcKmSfdMEZ3mMEXlnOEFU1iPocRNbOIxJgUT2iL+8mUWYFfaHOe/o9zjpLq7GUdz/wgJA4U1/chjEcMFkTMQFi4F16ChY+DCwtJmJr4XFPO0LYn63+9huGzlm7E1RejgXOdOtrL7/oeum82CZn5" +
    "/zKN3QgAiUmzClEZgErONznG2dXOD7OGUc6RVdgN2YecJGLc1potPX+O4jthnupnxkXO6hc0y7/FY7J7xyeM6TRnsxv+ah+zY5OOJQ4Z8h5+K4aNYQu3LbBwoA456Y+7f8UEHHh3/lXa/ISl+zxZJiv/1f8HGjvb" +
    "35yFAQA=",
  attempt:
    "H4sIAAAAAAAAE62TX2+bPBTGv4uvswkMdE3ukhIorHYGJYA9TYh/IQaboAKBUPW7vyJ9J20X26Soliz7WEePfn6Onldw6Os651HcdblouohlYAXirosk+ashubpjSlKgmFvZ/fLzBAvQsqLOsyg91QdWRN2pymuw" +
    "Amf4Ob/YIgu0ngbjIRPGJQ6MPjOWDX2w7iwx1gm/H5C+/vtmVmvVmBPFbRKoHRLFrmhoH2LTmOKrjiNjr4BYR+pO54x4lYKgIXYeGsi0l3aeM2Kxl0lpl8QzBC7dCunVgHVHowGtsOdAJPYX7BlH7B0F1V1OSsSe" +
    "HuwygZpEA00KFcrTGjcJVNmu3LaWoHIiNJ4Yy2P26PIk3Egh5JVVnhgJXSmc1uOzRIZ95brutB78CT+6nvGMp02IpMxAvqVYbGAp9KcU8nPC//ektnn26F8SwXt6sVpLGH2qZDzly46EmyEOtDqEx2MKC7Zj1kgm" +
    "u0TlXkUl0ojAFS1tQctNiadCQxMVuMTlzltDUu5lKrYKFo6KJuOIJkshwlHIZHA02QLplkb1+e6zmYuEfpmZV67ZAxEH2SET/uXKyqw7692flgRadWVS/EtyncVRyh43047dnxOo8SfhqySQh8Tc9wQuuyc41k9w" +
    "bKjYR1nodqGCz1lol9STBxLw6uqJadTUXw6JafS//pV6RMJ6KtGyGKm5nchkQayTEUNHwVOhIogGLLYj8jaClsfjzjQE9hyZmtsBmUjeeVsFQ8yRTjQqcIV1S7Vq6fO3L58OpiPfJ4naq99yRw7jr+sEvmh34eWg" +
    "ORF2wmcv9WC4HcACpN0IVq+g7eIuByvwsAYLkOVnls6VOCWM5+BtAZq4yKOGxzVYfX99r65R4kVTRNIfliLNWeKn99h9khegzdOOneqo6RPO0p8S7R8VJBksQNzOeRR53UUvedye5iwe2Jhn4G1xKwu8gQV+FIv8" +
    "G4ss3cCifBQL/N0X9QYW9aNYVPgri3rDjNR/zOjHAqRNC1bf/+Xu3JjOfe8RiDir8/mxzdt2BrqSvORd/1KzugBv/wGq4kqZaQYAAA==",
};

function buildRounds() {
  expect(buildStart).toBeGreaterThanOrEqual(0);
  expect(buildEnd).toBeGreaterThan(buildStart);
  return trace.rounds.slice(buildStart, buildEnd);
}

function expectOriginalBuild(kind: keyof typeof original, bytes: string) {
  const rounds = buildRounds();
  expect(bytes).toBe(gunzipSync(Buffer.from(original[kind], "base64")).toString("utf8"));
  expect(rounds.length).toBeLessThanOrEqual(3);
  // One definition read followed by the three concurrent binding/shell reads.
  expect(rounds.map(round => round.length)).toEqual([1, 3]);
}

it("preserves the complete freshly resolved bundle", async () => {
  const bundle = await loadPreparedFunnelBundle(env, edgeHeaders(), "site-1", variant, undefined, "life");
  expect(bundle?.resolved.variant.public_id).toBe(variant);
  expectOriginalBuild("bundle", JSON.stringify(bundle));
});

it.each(["shell", "attempt"] as const)("rebuilds a cold %s bundle in at most three D1 rounds", async kind => {
  const h = edgeHeaders();
  if (kind === "shell") h.set("x-cms-variant", "lg:" + variant);
  const req = Object.assign(new Request(kind === "shell" ? landing : attemptUrl, { headers: h }), {
    cf: { regionCode: "CA" },
  });
  const res = await leadgenRouter.request(req, undefined, kind === "shell" ? { ...env, EDGE_INNER: "1" } : env);
  expect(res.status).toBe(200);
  expectOriginalBuild(kind, await res.text());
  expect(trace.rounds.slice(0, buildStart)).toEqual(kind === "shell"
    ? [[expect.stringContaining("FROM domains d INNER JOIN sites")]] : []);
  expect(trace.rounds.slice(buildEnd)).toEqual(kind === "attempt"
    ? [[expect.stringContaining("INSERT OR REPLACE INTO leadgen_routing_outcomes")]] : []);
});

it("loads only the serving site's published footer picks in the dependent round", async () => {
  sql.prepare(`CREATE TABLE pages (id INTEGER PRIMARY KEY, site_id TEXT, slug TEXT, page_type TEXT,
    status TEXT, show_in_footer INTEGER, display_order INTEGER)`).run();
  const add = sql.prepare("INSERT INTO pages (site_id, slug, page_type, status) VALUES (?, ?, ?, ?)");
  const picks = Array.from({ length: 85 }, (_, i) => ({ page_type: "legal", slug: "page-" + i, label: "Page " + i }));
  for (const pick of picks) add.run("site-1", pick.slug, pick.page_type, "published");
  add.run("site-2", "another-site", "privacy", "published");
  add.run("site-1", "draft", "privacy", "draft");
  const footer = { enabled: true, blocks: [{ type: "link_row", links_source: "picked", picks: [
    ...picks, { page_type: "privacy", label: "Privacy", manual_url: "/fallback" },
  ] }] };
  sql.prepare("UPDATE leadgen_frame_templates SET frame_json = json_set(frame_json, '$.footer', json(?)) WHERE id = 1")
    .run(JSON.stringify(footer));
  const bundle = await loadPreparedFunnelBundle(env, edgeHeaders(), "site-1", variant, undefined, "life");
  expect(bundle?.resolved.site_branding?.legal_links).toEqual([
    ...picks.map(pick => ({ label: pick.label, href: "/" + pick.slug })), { label: "Privacy", href: "/fallback" },
  ]);
  const rounds = buildRounds();
  expect(rounds.map(round => round.length)).toEqual([1, 1, 3]);
  expect(rounds[1]![0]).toContain("FROM pages");
});

it("requires the correct site, explicit root slug and served arm before loading a bundle", async () => {
  sql.prepare("UPDATE leadgen_funnel_ab_tests SET status = 'stopped'").run();
  const control = publicId("lgn", 1);
  for (const [site, arm, slug] of [["site-1", variant, "life"], ["site-2", control, "life"], ["site-1", control, null]] as const) {
    expect(await loadPreparedFunnelBundle(env, edgeHeaders(), site, arm, undefined, slug)).toBeNull();
  }
  expect(trace.rounds.map(round => round.length)).toEqual([1, 1, 1]);
  // Old rows without page records still form one shared first page, then one
  // synthetic page per variant placement, with the original negative slot ids.
  sql.prepare("DELETE FROM leadgen_funnel_pages").run();
  sql.prepare("UPDATE leadgen_site_quotes SET slug = NULL").run();
  const bundle = await loadPreparedFunnelBundle(env, edgeHeaders(), "site-1", control, undefined, null);
  expect(bundle?.resolved.assignment.assignment_reason).toBe("single_control");
  expect(bundle?.resolved.pages?.map(page => [page.public_id, page.slots.map(slot => slot.id)])).toEqual([
    ["lgpg_shared_q1", [-1000001, -1000002, -1000003, -1000004]], ["lgpg_v41", [-1]],
  ]);
  expect(bundle?.resolved.sections.map(row => row.section.id)).toEqual([1, 2, 3, 4, 41]);
});

it("reads a large page tree in one definition query and preserves full-precision routing values", async () => {
  const add = sql.prepare(`INSERT INTO leadgen_sections (id, public_id, section_name, activity, vertical, headline_text, content_json)
    VALUES (?, ?, 'Question', 'quote_funnel', 'life', 'Question', '{"components":[]}')`);
  const attach = sql.prepare(`INSERT INTO leadgen_funnel_variant_sections (quote_id, page_id, section_id, position)
    VALUES (1, 20, ?, ?)`);
  const extraIds = Array.from({ length: 156 }, (_, i) => 100 + i);
  for (const id of extraIds) {
    add.run(id, publicId("lgs", id));
    attach.run(id, id);
  }
  const multiplier = 1.2345678901234567;
  const percent = 12.345678901234567;
  sql.prepare("UPDATE leadgen_quote_routing_rules SET value_multiplier = ?, redirect_pct = ? WHERE conditions_hash = 'paid'")
    .run(multiplier, percent);

  const bundle = await loadPreparedFunnelBundle(env, edgeHeaders(), "site-1", variant);
  expect(bundle?.resolved.sections.map(row => row.section.id)).toEqual([1, 2, 3, 4, ...extraIds, 42]);
  expect(Object.keys(bundle!.shell.answerMapVersions)).toHaveLength(161);
  expect(bundle?.resolved.routing_rules?.find(rule => rule.hash === "paid")).toMatchObject({
    value_multiplier: multiplier, redirect_pct: percent,
  });
  const rounds = buildRounds();
  expect(rounds[0]).toHaveLength(1);
  expect(rounds[0]![0]).toContain("FROM leadgen_funnel_variants");
  for (const query of rounds.slice(2).flat()) expect(query).toContain("FROM leadgen_section_answer_maps");
  console.info(`161 distinct sections: ${rounds.length} build rounds, ${rounds.flat().length} D1 calls`);
});
