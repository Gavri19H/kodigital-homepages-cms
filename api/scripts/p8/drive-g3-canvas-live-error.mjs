#!/usr/bin/env node
// P8-5 slice G3 — MISSION EVIDENCE TOOLING, never wired into CI.
//
// Drives BOTH sides of the canvas-vs-live error-state disagreement on the SAME
// authored section, for TWO field shapes, in one run:
//
//   LIVE   = the real visitor page (http://r2fix.e2e.test:8901/lg/r2fix) served
//            by the already-running wrangler dev on :8901, hydrated by the real
//            committed runtime bundle, driven with a real Continue click on an
//            empty required question so the engine's own validation calls
//            render.ts setFieldError.
//   CANVAS = the real POST /api/admin/leadgen/sections/preview response for the
//            SAME content_json with sim {state:"error"} — the request the
//            Studio island itself issues.
//
// Neither side is hand-built (E10/E11): the section content is authored ONCE
// through the real admin PATCH, and both sides read it back out of the product.
//
// SCENARIOS
//   text     — a required FreeTextQuestion. The field block IS the <input>
//              (presets hydration() stamps data-lg-field on it, and <input> is
//              void). Rows: M-3 aria-invalid · M-4 slot `hidden` · slot text ·
//              G3b-1 the slot's own `lg-error` class.
//   address  — a required-ZIP AddressAutocompleteQuestion: ONE [data-lg-field]
//              block containing FOUR [data-lg-input] descendants. G3b-3 asks
//              whether the canvas (markErrorInSlice marks every input in the
//              slice) and the live page (setFieldError marks one element) end
//              up with a different aria-invalid COUNT.
//   address_validation (G3c)
//            — the SAME authored address, but the OTHER sim: state
//              "validation_error" on the canvas vs a live visitor who types a
//              genuinely invalid ZIP ("123") and hits Continue, so the ZIP
//              spec's OWN regex rule fires (validation.ts validateAddressField
//              -> code "pattern", the spec's authored message, keyed to
//              {base}_zip). The G3b address fix was scoped to the required
//              path it drove and did NOT measure this one.
//   validation_success_text / validation_success_address (G3d)
//            — the LAST unmeasured sim state, on the same two field shapes.
//              CANVAS = the Studio's own "Validation success" request
//              ({state:"validation_success"}, no answers — the sample-answers
//              textarea is empty unless the operator fills it). LIVE = a real
//              visitor who FIRST hits Continue on the empty field (so the
//              engine's own validation demonstrably ran on this field and
//              painted its error) and THEN enters a value that SATISFIES the
//              rule ("A perfectly valid note." / ZIP "90210"), which is the
//              product moment the sim is named after. Both scenarios drive
//              Continue themselves (`click:false`) and then, AFTER the
//              measurement, click Continue once more (`after`) to prove the
//              value really passes validateSection rather than merely looking
//              unmarked.
//
// Per scenario: `sim` is the canvas request's sim block (default the required
// path's {state:"error"}), `drive` is what the live visitor does before
// Continue (default: nothing — an empty required question), `click` false
// suppresses the loop's own Continue click (the drive owns it), and `after`
// runs post-measurement and returns one diagnostic line.
//
// The section is restored to its stored baseline in a finally block.
//
// Usage: node scripts/p8/drive-g3-canvas-live-error.mjs
import { chromium } from "playwright";
import { get as httpGet } from "node:http";

const API = "http://127.0.0.1:8901/api/admin/leadgen";
const SECTION = "lgs_01KZ27138G80K46S7XBWKGA764"; // live funnel page 1 ("01 · Continue")
const SHOT_DIR = "../docs/leadgen/r2/evidence/p8/g3";
const BASELINE =
  '{"components":[{"type":"ContinueButton","question_id":"r2fix_shared_cont","props":{"label":"Continue"}}]}';
const CONTINUE = { type: "ContinueButton", question_id: "r2fix_shared_cont", props: { label: "Continue" } };

// The node shape the live "P8 Address Repro v3" section already uses (read back
// from the admin API), re-keyed onto this probe's own field. Shared by the two
// address scenarios so both sims measure the SAME authored content.
const ADDRESS_CONTENT = JSON.stringify({
  components: [
    {
      type: "AddressAutocompleteQuestion",
      question_id: "g3_q_addr",
      internal_field: "g3_probe_addr",
      required: true,
      props: {
        fields: [
          { field: "street", mode: "autofill" },
          { field: "city", mode: "autofill" },
          { field: "state", mode: "autofill" },
          {
            field: "zip",
            mode: "manual",
            required: true,
            validation: { regex: "^[0-9]{5}(-[0-9]{4})?$", message: "Enter a ZIP like 90210 or 90210-1234." },
          },
        ],
      },
    },
    CONTINUE,
  ],
});

// The plain-leaf contrast shape: the field block IS the <input> (presets
// hydration stamps data-lg-question AND data-lg-field on it). Shared by the
// "text" error scenario and the G3d success scenario.
const TEXT_CONTENT = JSON.stringify({
  components: [
    {
      type: "FreeTextQuestion",
      question_id: "g3_q_note",
      internal_field: "g3_probe_note",
      answer_type: "string",
      required: true,
      props: { placeholder: "Anything we should know?" },
    },
    CONTINUE,
  ],
});

// The live half of a G3d success drive: Continue on the still-empty field (the
// engine paints its own error — proof it validated THIS field), then the
// visitor enters a value that satisfies the rule.
const speakingNow = (page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll("[data-lg-error-for]")]
        .filter((n) => !n.hasAttribute("hidden") && (n.textContent ?? "") !== "")
        .map((n) => `${n.getAttribute("data-lg-error-for")}=${JSON.stringify(n.textContent)}`)
        .join(" ") || "(none)",
  );

const enterValid = (locate, value) => async (page) => {
  await page.locator("[data-lg-section]:not([hidden]) [data-lg-continue]").first().click();
  await page.waitForTimeout(500);
  // Printed so "live marks nothing" below cannot be "the engine never looked":
  // step 1 must show the live page's OWN validation speaking.
  console.log(`DRIVE step 1 — Continue on the EMPTY field, live speaking slots: ${await speakingNow(page)}`);
  const input = locate(page);
  await input.fill(value);
  await input.blur();
  await page.waitForTimeout(300);
  console.log(`DRIVE step 2 — after entering ${JSON.stringify(value)}, live speaking slots: ${await speakingNow(page)}`);
};

// Post-measurement: one more Continue. A value that really satisfies the rule
// makes validateSection return zero failures, so no slot speaks.
const continueAndReport = async (page) => ({
  ...(await page.evaluate(() => ({
    visibleSections: document.querySelectorAll("[data-lg-section]:not([hidden])").length,
    visibleSectionId:
      document.querySelector("[data-lg-section]:not([hidden])")?.getAttribute("data-lg-section") ?? "(none)",
  }))),
  speaking: await speakingNow(page),
});

const SCENARIOS = [
  {
    name: "text",
    field: "g3_probe_note",
    content: TEXT_CONTENT,
  },
  {
    name: "address",
    field: "g3_probe_addr",
    content: ADDRESS_CONTENT,
  },
  {
    name: "address_validation",
    field: "g3_probe_addr",
    content: ADDRESS_CONTENT,
    // The Studio's own "Validation error" button posts exactly this (see
    // ui-section-studio.ts data-sim-state="validation_error"; the sample-
    // answers textarea is empty unless the operator fills it).
    sim: { state: "validation_error" },
    // The live counterpart of "this field's format rule failed": a real value
    // that is answered (so the required leg passes) and breaks the ZIP regex.
    drive: async (page) => {
      const zip = page.locator('[data-lg-field="g3_probe_addr_zip"] input[data-lg-input]').first();
      await zip.fill("123");
      await zip.blur();
    },
  },
  {
    name: "validation_success_text",
    field: "g3_probe_note",
    content: TEXT_CONTENT,
    sim: { state: "validation_success" },
    drive: enterValid((page) => page.locator('input[data-lg-field="g3_probe_note"]').first(), "A perfectly valid note."),
    click: false,
    after: continueAndReport,
  },
  {
    name: "validation_success_address",
    field: "g3_probe_addr",
    content: ADDRESS_CONTENT,
    sim: { state: "validation_success" },
    drive: enterValid(
      (page) => page.locator('[data-lg-field="g3_probe_addr_zip"] input[data-lg-input]').first(),
      "90210",
    ),
    click: false,
    after: continueAndReport,
  },
];

const j = async (u, o) => {
  const r = await fetch(u, o);
  return { status: r.status, body: await r.json().catch(() => null) };
};
const patch = (content_json) =>
  j(`${API}/sections/${SECTION}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content_json }),
  });

// wrangler dev reloads on a source change; wait until the SERVED shell really
// carries the freshly authored field before driving it (a race here reads a
// stale page, not a product defect).
// (node:http, not fetch — undici forbids overriding the `host` header, and the
// visitor shell is resolved BY host.)
const shellHtml = () =>
  new Promise((res) => {
    httpGet(
      { host: "127.0.0.1", port: 8901, path: `/lg/r2fix?_cb=${Date.now()}`, headers: { Host: "r2fix.e2e.test" } },
      (r) => {
        let s = "";
        r.on("data", (d) => (s += d));
        r.on("end", () => res(s));
      },
    ).on("error", () => res(""));
  });

// --- the measurements, applied identically to both sides ---------------------

/** The balanced [start,end) markup of the element whose opening tag holds `token`. */
const VOID_TAGS = new Set(["input", "img", "br", "hr", "meta", "link", "source", "wbr"]);
const elementSlice = (html, token) => {
  const at = html.indexOf(token);
  if (at === -1) return "";
  const start = html.lastIndexOf("<", at);
  let first = true;
  let depth = 0;
  for (const m of html.slice(start).matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)[^>]*?>/g)) {
    const end = start + (m.index ?? 0) + m[0].length;
    const isClose = m[1] === "/";
    const isVoid = !isClose && (VOID_TAGS.has((m[2] ?? "").toLowerCase()) || m[0].endsWith("/>"));
    if (first) {
      if (isVoid) return html.slice(start, end);
      depth = 1;
      first = false;
      continue;
    }
    if (isVoid) continue;
    depth += isClose ? -1 : 1;
    if (depth === 0) return html.slice(start, end);
  }
  return "";
};

const canvasFacts = (html, field) => {
  const block = elementSlice(html, `data-lg-field="${field}"`);
  const inputs = block.match(/<(?:input|select|textarea)\b[^>]*data-lg-input[^>]*>/g) ?? [];
  const slotM = html.match(new RegExp(`<p([^>]*)data-lg-error-for="${field}"([^>]*)>([^<]*)</p>`));
  const slotOpen = slotM === null ? "" : `<p${slotM[1]}data-lg-error-for="${field}"${slotM[2]}>`;
  const cls = slotOpen.match(/\bclass="([^"]*)"/);
  return {
    blockTag: block === "" ? "<absent>" : block.slice(0, block.indexOf(">") + 1),
    ariaInvalid: /\baria-invalid="true"/.test(block.slice(0, block.indexOf(">") + 1)),
    inputCount: inputs.length,
    invalidInputs: inputs.filter((t) => t.includes('aria-invalid="true"')).length,
    slotTag: slotOpen === "" ? "<absent>" : slotOpen,
    slotHidden: / hidden[ >]/.test(slotOpen),
    slotText: slotM === null ? "" : slotM[3],
    slotClasses: cls === null ? "" : (cls[1] ?? "").split(" ").sort().join(" "),
    // every slot / input whose field is this question's field or one of its
    // `<field>_<subfield>` children, in document order
    slots: [...html.matchAll(/<p([^>]*)data-lg-error-for="([^"]*)"([^>]*)>([^<]*)<\/p>/g)]
      .filter((m) => (m[2] ?? "").startsWith(field))
      .map((m) => ({
        field: m[2],
        hidden: / hidden[ >]/.test(`<p${m[1]}x${m[3]}>`),
        text: m[4],
      })),
    inputs: [...html.matchAll(/<(?:input|select|textarea)\b[^>]*data-lg-input[^>]*>/g)]
      .map((m) => m[0])
      .filter((t) => (t.match(/data-(?:lg-field|internal-field)="([^"]*)"/)?.[1] ?? "").startsWith(field))
      .map((t) => ({
        field: t.match(/data-(?:lg-field|internal-field)="([^"]*)"/)?.[1] ?? "?",
        invalid: /\baria-invalid="true"/.test(t),
      })),
    // G3c: WHICH block each side marked. A group question renders one
    // [data-lg-field="{base}"] block AND one per authored subfield, so the
    // block-scoped counts above cannot tell "the group is lit" from "the ZIP is
    // lit". This does, element by element, in document order.
    blocks: [...html.matchAll(/data-lg-field="([^"]*)"/g)]
      .map((m) => m[1] ?? "")
      .filter((v, i, a) => v.startsWith(field) && a.indexOf(v) === i)
      .map((v) => {
        const b = elementSlice(html, `data-lg-field="${v}"`);
        const open = b.slice(0, b.indexOf(">") + 1);
        const ins = (/\bdata-lg-input\b/.test(open) ? [open] : []).concat(
          b.slice(open.length).match(/<(?:input|select|textarea)\b[^>]*data-lg-input[^>]*>/g) ?? [],
        );
        return {
          field: v,
          marked: ins.filter((t) => /\baria-invalid="true"/.test(t)).length,
          total: ins.length,
          err: /\bclass="[^"]*\blg-error\b/.test(open),
          // G3d: the success chrome preview-sim.ts markValidInSlice paints.
          valid: /\bclass="[^"]*\blg-valid\b/.test(open),
        };
      }),
    // G3d: EVERY element carrying the `.lg-valid` success class, in document
    // order, identified by its question/field. Document-scoped on purpose —
    // markValidInSlice marks the [data-lg-question] element, which for a group
    // question is not the same element as any one [data-lg-field] subfield.
    validEls: [...html.matchAll(/<[a-zA-Z][a-zA-Z0-9-]*\b[^>]*>/g)]
      .map((m) => m[0])
      .filter((t) => /\bclass="[^"]*\blg-valid\b[^"]*"/.test(t))
      .map(
        (t) =>
          `${t.match(/^<([a-zA-Z0-9-]+)/)?.[1] ?? "?"}[q=${t.match(/data-lg-question="([^"]*)"/)?.[1] ?? "-"}|f=${
            t.match(/data-lg-field="([^"]*)"/)?.[1] ?? "-"
          }]`,
      ),
  };
};

const liveFacts = (field) =>
  // eslint-disable-next-line no-undef
  ((f) => {
    const el = document.querySelector(`[data-lg-field="${f}"]`);
    const slot = document.querySelector(`[data-lg-error-for="${f}"]`);
    const inputs = el === null ? [] : [...el.querySelectorAll("[data-lg-input]")];
    const self = el !== null && el.hasAttribute("data-lg-input") ? [el] : [];
    const all = self.concat(inputs);
    const tag = (n) => (n === null ? "<absent>" : n.outerHTML.slice(0, n.outerHTML.indexOf(">") + 1));
    return {
      blockTag: tag(el),
      ariaInvalid: el !== null && el.getAttribute("aria-invalid") === "true",
      inputCount: all.length,
      invalidInputs: all.filter((n) => n.getAttribute("aria-invalid") === "true").length,
      slotTag: tag(slot),
      slotHidden: slot !== null && slot.hasAttribute("hidden"),
      slotText: slot === null ? "" : slot.textContent,
      slotClasses: slot === null ? "" : [...slot.classList].sort().join(" "),
      slotDisplay: slot === null ? "n/a" : getComputedStyle(slot).display,
      slots: [...document.querySelectorAll("[data-lg-error-for]")]
        .filter((n) => (n.getAttribute("data-lg-error-for") ?? "").startsWith(f))
        .map((n) => ({
          field: n.getAttribute("data-lg-error-for"),
          hidden: n.hasAttribute("hidden"),
          text: n.textContent,
        })),
      inputs: [...document.querySelectorAll("[data-lg-input]")]
        .filter((n) =>
          (n.getAttribute("data-lg-field") ?? n.getAttribute("data-internal-field") ?? "").startsWith(f),
        )
        .map((n) => ({
          field: n.getAttribute("data-lg-field") ?? n.getAttribute("data-internal-field"),
          invalid: n.getAttribute("aria-invalid") === "true",
        })),
      // G3c — the canvasFacts.blocks mirror (see its comment).
      blocks: [...document.querySelectorAll("[data-lg-field]")]
        .filter((n) => (n.getAttribute("data-lg-field") ?? "").startsWith(f))
        .map((n) => {
          const ins = (n.hasAttribute("data-lg-input") ? [n] : []).concat([
            ...n.querySelectorAll("[data-lg-input]"),
          ]);
          return {
            field: n.getAttribute("data-lg-field"),
            marked: ins.filter((x) => x.getAttribute("aria-invalid") === "true").length,
            total: ins.length,
            err: n.classList.contains("lg-error"),
            valid: n.classList.contains("lg-valid"),
          };
        }),
      // G3d — the canvasFacts.validEls mirror (see its comment).
      validEls: [...document.querySelectorAll(".lg-valid")].map(
        (n) =>
          `${n.tagName.toLowerCase()}[q=${n.getAttribute("data-lg-question") ?? "-"}|f=${
            n.getAttribute("data-lg-field") ?? "-"
          }]`,
      ),
      visibleSectionId:
        document.querySelector("[data-lg-section]:not([hidden])")?.getAttribute("data-lg-section") ?? "(none)",
      stillOnPage1: document.querySelectorAll("[data-lg-section]:not([hidden])").length === 1,
    };
  })(field);

let restored = false;
const restore = async () => {
  if (restored) return;
  restored = true;
  const r = await patch(BASELINE);
  const back = await j(`${API}/sections/${SECTION}`);
  console.log(
    `RESTORE: status=${r.status} content_json=${JSON.stringify(back.body?.item?.content_json ?? back.body?.content_json)}`,
  );
};

let disagreements = 0;
const ROWS_PER_SCENARIO = 8;
try {
  const b = await chromium.launch({ args: ["--host-resolver-rules=MAP r2fix.e2e.test 127.0.0.1"] });
  for (const sc of SCENARIOS) {
    console.log(`\n================ SCENARIO ${sc.name} (${sc.field}) ================`);
    const wrote = await patch(sc.content);
    console.log(`AUTHOR: PATCH ${SECTION} -> ${wrote.status}`);
    if (wrote.status !== 200) throw new Error(`author failed: ${JSON.stringify(wrote.body).slice(0, 300)}`);

    // 90s: measured — a freshly PATCHed section took over 20s to reach the
    // served shell on one run of this probe (the second scenario in a run that
    // followed a wrangler dev reload), and was present when re-checked by hand.
    let served = false;
    for (let i = 0; i < 90 && !served; i += 1) {
      served = (await shellHtml()).includes(`data-lg-field="${sc.field}"`);
      if (!served) await new Promise((res) => setTimeout(res, 1000));
    }
    console.log(`SHELL: serves the authored field = ${served}`);

    // ---- CANVAS -------------------------------------------------------------
    const sim = sc.sim ?? { state: "error" };
    const prev = await j(`${API}/sections/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content_json: sc.content, sim, viewport: "desktop" }),
    });
    const canvas = canvasFacts(prev.body?.preview?.html ?? prev.body?.preview?.desktop ?? "", sc.field);
    console.log(`CANVAS: preview status=${prev.status} sim_state=${prev.body?.preview?.sim_state}`);

    // ---- LIVE ---------------------------------------------------------------
    const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(`http://r2fix.e2e.test:8901/lg/r2fix?_cb=${Date.now()}`, { waitUntil: "domcontentloaded" });
    await p.waitForSelector(`[data-lg-field="${sc.field}"]`, { timeout: 15000 });
    if (sc.drive !== undefined) await sc.drive(p);
    if (sc.click !== false) {
      await p.locator("[data-lg-section]:not([hidden]) [data-lg-continue]").first().click();
      await p.waitForTimeout(600);
    }
    const live = await p.evaluate(liveFacts, sc.field);
    await p.screenshot({ path: `${SHOT_DIR}/g3b-live-error-${sc.name}-1280.png` });
    let post = null;
    if (sc.after !== undefined) {
      await p.locator("[data-lg-section]:not([hidden]) [data-lg-continue]").first().click();
      await p.waitForTimeout(900);
      post = await sc.after(p);
    }
    await p.close();
    console.log(`LIVE: pageerrors=${errs.length ? errs.slice(0, 2).join(" | ") : "none"}`);

    // ---- the parity table ---------------------------------------------------
    // G3c: the SPEAKING slot (which field's message a visitor actually reads)
    // and the MARKED blocks, both compared as whole ordered lists — the two
    // things "canvas mirrors live" has to mean for a group question.
    const speaking = (list) =>
      list
        .filter((s) => !s.hidden || s.text !== "")
        .map((s) => `${s.field}=${JSON.stringify(s.text)}${s.hidden ? "(hidden)" : ""}`)
        .join(" ") || "(none)";
    const blockList = (list) =>
      list
        .map((b) => `${b.field}:${b.marked}/${b.total}${b.err ? ":lg-error" : ""}${b.valid ? ":lg-valid" : ""}`)
        .join(" ") || "(none)";
    const rows = [
      ['M-3   field block aria-invalid="true"', String(canvas.ariaInvalid), String(live.ariaInvalid)],
      ["M-4   error slot carries `hidden`", String(canvas.slotHidden), String(live.slotHidden)],
      ["      error slot text", JSON.stringify(canvas.slotText), JSON.stringify(live.slotText)],
      ["G3b-1 error slot classes", canvas.slotClasses, live.slotClasses],
      [
        "G3b-3 [data-lg-input] marked / total",
        `${canvas.invalidInputs}/${canvas.inputCount}`,
        `${live.invalidInputs}/${live.inputCount}`,
      ],
      ["G3c-1 speaking slot(s) field=text", speaking(canvas.slots), speaking(live.slots)],
      ["G3c-2 per-block marked/total:class", blockList(canvas.blocks), blockList(live.blocks)],
      [
        "G3d-1 elements carrying `lg-valid`",
        canvas.validEls.join(" ") || "(none)",
        live.validEls.join(" ") || "(none)",
      ],
    ];
    console.log("\naspect | canvas | live | agree");
    console.log("---|---|---|---");
    for (const [a, c, l] of rows) {
      const ok = c === l;
      if (!ok) disagreements += 1;
      console.log(`${a} | ${c} | ${l} | ${ok ? "yes" : "NO"}`);
    }
    // G3b-3 needs to know WHICH element each side marked before either can be
    // called wrong: a group question (address) has one group-level slot plus a
    // per-subfield slot, and "1 of 4 inputs" is only a defect if the one is the
    // wrong one / the message lands nowhere a visitor reads.
    console.log("per-slot detail (field | hidden | text):");
    for (const [side, list] of [
      ["canvas", canvas.slots],
      ["live", live.slots],
    ]) {
      for (const s of list) console.log(`  ${side} | ${s.field} | hidden=${s.hidden} | ${JSON.stringify(s.text)}`);
    }
    console.log("per-input detail (field | aria-invalid):");
    for (const [side, list] of [
      ["canvas", canvas.inputs],
      ["live", live.inputs],
    ]) {
      // Measured: an address SUBFIELD input carries neither data-lg-field nor
      // data-internal-field (presets renderAddressFieldSet puts data-lg-field
      // on the wrapping <span>), so this by-name list is empty for the address
      // scenario on BOTH sides. The counted G3b-3 row above is block-scoped and
      // is the measurement to read.
      if (list.length === 0) console.log(`  ${side} | (no input carries the field name itself)`);
      for (const s of list) console.log(`  ${side} | ${s.field} | ${s.invalid}`);
    }
    console.log("per-block detail (field | marked/total inputs | lg-error on the block):");
    for (const [side, list] of [
      ["canvas", canvas.blocks],
      ["live", live.blocks],
    ]) {
      for (const b of list) console.log(`  ${side} | ${b.field} | ${b.marked}/${b.total} | ${b.err}`);
    }
    console.log(`canvas block tag: ${canvas.blockTag.slice(0, 150)}`);
    console.log(`live   block tag: ${live.blockTag.slice(0, 150)}`);
    console.log(`canvas slot  tag: ${canvas.slotTag.slice(0, 170)}`);
    console.log(`live   slot  tag: ${live.slotTag.slice(0, 170)} (display: ${live.slotDisplay})`);
    console.log(`live still on page 1 (Continue was blocked): ${live.stillOnPage1}`);
    if (post !== null) {
      console.log(
        `POST-MEASUREMENT Continue with the valid answer: visible sections=${post.visibleSections}` +
          ` · visible section ${live.visibleSectionId} -> ${post.visibleSectionId}` +
          ` · speaking error slots=${post.speaking}`,
      );
    }
  }
  await b.close();
  console.log(`\nTOTAL DISAGREEMENTS (${SCENARIOS.length} scenarios x ${ROWS_PER_SCENARIO} rows): ${disagreements}`);
} finally {
  await restore();
}
