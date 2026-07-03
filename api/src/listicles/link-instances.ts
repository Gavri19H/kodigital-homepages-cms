// Governed link-instance extraction + rebuild (design contract §30.7 + §5.4).
//
// A Section's monetized placements are represented as
// `listicle_section_link_instances` rows (one per governed link/button/
// headline), and `listicle_section_offers` is a DERIVED summary rebuilt from
// those instances inside every Section-save transaction.
//
// PR2 scope: the clickable headline (block_id "__headline__") plus a
// forward-compatible scan of content_json blocks for `offer_id` /
// inline-`offerlink` (`<a data-offer="off_…">`) bindings, so the PR4 block
// types (button / choice_button / final_text_cta / linked images) are picked
// up by this same extractor when they arrive.

import { mintPublicId } from "./ids";
import type { SectionBlock } from "./validation";

export type LinkRole =
  | "headline"
  | "inline"
  | "linked_image"
  | "button"
  | "choice_button"
  | "final_text_cta";

// Reserved block ids (§30.7): "__headline__" is the Section's clickable
// headline row; "__article_title__" is held for a future Article-title link.
export const HEADLINE_BLOCK_ID = "__headline__";

export interface ExtractedLinkInstance {
  block_id: string;
  link_role: LinkRole;
  position_index: number;
  // Exactly one of the two is set: block-level bindings carry the internal
  // numeric offer id; inline `data-offer` marks carry the off_… public id
  // (§12) and are resolved to internal ids by the handler before the write.
  offer_id: number | null;
  offer_public_id: string | null;
  anchor_text: string | null;
  button_style_id: string | null;
  button_group_id: string | null;
  analytics_label: string | null;
}

// A link instance whose offer reference has been resolved to the internal id
// and whose public identity (lnk_…) has been assigned.
export interface ResolvedLinkInstance {
  public_id: string;
  block_id: string;
  link_role: LinkRole;
  position_index: number;
  offer_id: number;
  anchor_text: string | null;
  anchor_text_hash: string | null;
  button_style_id: string | null;
  button_group_id: string | null;
  analytics_label: string | null;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asPositiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

// An offer reference is either the legacy internal integer id (Phase-2 API
// writes) or the off_… public id string (§30.5 shapes store strings).
function offerRef(value: unknown): { id: number | null; publicId: string | null } {
  const id = asPositiveInt(value);
  if (id !== null) return { id, publicId: null };
  const publicId = asOptionalString(value);
  if (publicId !== null) return { id: null, publicId };
  return { id: null, publicId: null };
}

// Role for a block-level offer binding, from the block type. Unknown block
// types default to 'button' — a block-level Offer binding is a CTA.
function blockRole(type: string): LinkRole {
  switch (type) {
    case "button":
      return "button";
    case "choice_button":
      return "choice_button";
    case "final_text_cta":
      return "final_text_cta";
    case "image":
    case "linked_image":
      return "linked_image";
    case "heading":
      // §30.2 LinkedSectionHeading — a governed link inside content; the
      // §30.7 'headline' role is reserved for the Section headline field.
      return "inline";
    default:
      return "button";
  }
}

// Inline offerlink mark (§12): `<a data-offer="off_…">text</a>` — no href is
// ever stored; the renderer mints the /lc URL at render time.
const OFFERLINK_RE = /<a\b[^>]*\bdata-offer\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

export interface SectionLinkSource {
  headline_text: string | null;
  headline_offer_id: number | null;
  blocks: SectionBlock[];
}

// Extract every governed link instance from a Section, in document order.
// The clickable headline (when headline_offer_id is set) is always the first
// instance: block_id "__headline__", link_role 'headline', position_index 0
// (§30.7). Content instances continue the position counter.
export function extractLinkInstances(source: SectionLinkSource): ExtractedLinkInstance[] {
  const instances: ExtractedLinkInstance[] = [];
  let position = 0;

  if (source.headline_offer_id !== null && source.headline_offer_id > 0) {
    instances.push({
      block_id: HEADLINE_BLOCK_ID,
      link_role: "headline",
      position_index: 0,
      offer_id: source.headline_offer_id,
      offer_public_id: null,
      anchor_text: source.headline_text,
      button_style_id: null,
      button_group_id: null,
      analytics_label: null,
    });
    position = 1;
  }

  source.blocks.forEach((block, blockIndex) => {
    // §30.7 block_id = the content_json block id; blocks without an editor-
    // assigned id fall back to a positional id (stable for a given document).
    const blockId =
      block.id ?? asOptionalString(block.data.id) ?? `blk_${blockIndex}`;

    // (a) Block-level binding: data.offer_id (internal numeric id or off_…
    // public id — §30.5 shapes store strings).
    const blockOffer = offerRef(block.data.offer_id);
    if (blockOffer.id !== null || blockOffer.publicId !== null) {
      instances.push({
        block_id: blockId,
        link_role: blockRole(block.type),
        position_index: position++,
        offer_id: blockOffer.id,
        offer_public_id: blockOffer.publicId,
        anchor_text:
          asOptionalString(block.data.text) ??
          asOptionalString(block.data.cta) ??
          asOptionalString(block.data.title) ??
          asOptionalString(block.data.alt),
        button_style_id:
          asOptionalString(block.data.style_id) ?? asOptionalString(block.data.style),
        button_group_id: asOptionalString(block.data.group_id),
        analytics_label: asOptionalString(block.data.analytics_label),
      });
    }

    // (b) Nested button lists (§30.5 choice-button groups): data.buttons[] /
    // data.items[] entries carrying their own offer_id.
    for (const listKey of ["buttons", "items"] as const) {
      const list = block.data[listKey];
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
        const item = entry as Record<string, unknown>;
        const itemOffer = offerRef(item.offer_id);
        if (itemOffer.id === null && itemOffer.publicId === null) continue;
        instances.push({
          block_id: blockId,
          link_role: block.type.includes("choice") ? "choice_button" : blockRole(block.type),
          position_index: position++,
          offer_id: itemOffer.id,
          offer_public_id: itemOffer.publicId,
          anchor_text: asOptionalString(item.text) ?? asOptionalString(item.cta),
          button_style_id:
            asOptionalString(item.style_id) ?? asOptionalString(item.style),
          button_group_id: asOptionalString(block.data.group_id) ?? blockId,
          analytics_label: asOptionalString(item.analytics_label),
        });
      }
    }

    // (c) Inline offerlink marks inside the block's rich html — and, for
    // list blocks, inside each string item (items support inline marks).
    for (const html of inlineHtmlSources(block)) {
      for (const match of html.matchAll(OFFERLINK_RE)) {
        const publicId = match[1];
        if (typeof publicId !== "string" || publicId.trim() === "") continue;
        instances.push({
          block_id: blockId,
          link_role: "inline",
          position_index: position++,
          offer_id: null,
          offer_public_id: publicId.trim(),
          anchor_text: stripTags(match[2] ?? "") || null,
          button_style_id: null,
          button_group_id: null,
          analytics_label: null,
        });
      }
    }
  });

  return instances;
}

// The inline-mark carriers of one block, in document order: data.html first,
// then each STRING entry of data.items (list items). Object items (choice
// buttons) are block-level bindings, not inline carriers.
function inlineHtmlSources(block: SectionBlock): string[] {
  const sources: string[] = [];
  if (typeof block.data.html === "string" && block.data.html !== "") {
    sources.push(block.data.html);
  }
  if (Array.isArray(block.data.items)) {
    for (const item of block.data.items) {
      if (typeof item === "string" && item !== "") sources.push(item);
    }
  }
  return sources;
}

// SHA-256 hex of the anchor text (anchor_text_hash — §30.7 carries it through
// events/analytics so CTA copy changes are separable).
export async function anchorTextHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export interface ExistingLinkInstanceRow {
  public_id: string;
  block_id: string;
  link_role: string;
  position_index: number;
  offer_id: number;
}

// Assign public ids (lnk_…): reuse the existing row's public_id when the
// SAME placement (block_id + link_role + offer_id + position_index) survives
// the save — link_instance_id is an analytics identity and must stay stable
// across content-neutral saves. New placements mint fresh ids.
export async function resolveLinkInstances(
  extracted: ExtractedLinkInstance[],
  offerIdByPublicId: ReadonlyMap<string, number>,
  existing: ExistingLinkInstanceRow[],
): Promise<ResolvedLinkInstance[]> {
  const available = new Map<string, string[]>();
  for (const row of existing) {
    const key = `${row.block_id} ${row.link_role} ${row.offer_id} ${row.position_index}`;
    const bucket = available.get(key);
    if (bucket === undefined) available.set(key, [row.public_id]);
    else bucket.push(row.public_id);
  }

  const resolved: ResolvedLinkInstance[] = [];
  for (const instance of extracted) {
    const offerId =
      instance.offer_id ??
      (instance.offer_public_id !== null
        ? offerIdByPublicId.get(instance.offer_public_id) ?? null
        : null);
    if (offerId === null) {
      // The handler validates every reference before calling this; a miss
      // here is a programming error, not a user error.
      throw new Error(
        `unresolved offer reference for block ${instance.block_id} (${instance.link_role})`,
      );
    }
    const key = `${instance.block_id} ${instance.link_role} ${offerId} ${instance.position_index}`;
    const bucket = available.get(key);
    const reused = bucket !== undefined ? bucket.shift() : undefined;
    resolved.push({
      public_id: reused ?? mintPublicId("link_instance"),
      block_id: instance.block_id,
      link_role: instance.link_role,
      position_index: instance.position_index,
      offer_id: offerId,
      anchor_text: instance.anchor_text,
      anchor_text_hash:
        instance.anchor_text !== null ? await anchorTextHash(instance.anchor_text) : null,
      button_style_id: instance.button_style_id,
      button_group_id: instance.button_group_id,
      analytics_label: instance.analytics_label,
    });
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Enrichment (§30.5/§30.9): write the RESOLVED link_instance_id back into the
// stored content_json so every governed link/button/image/text-CTA carries
// its lnk_… id, and normalize every offer reference to the off_… public id
// (the §30.5 shapes store strings; legacy numeric ids are canonicalized).
// ---------------------------------------------------------------------------
//
// The walk MIRRORS extractLinkInstances exactly — headline first, then per
// block: (a) block-level binding, (b) buttons[]/items[] entries, (c) inline
// offerlink anchors in data.html + string list items — consuming `resolved`
// sequentially. Parity is pinned by test/listicles-link-extraction.test.ts
// (extract → resolve → apply → re-extract must line up 1:1).

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedOfferRef(
  value: unknown,
  offerPublicIdById: ReadonlyMap<number, string>,
): unknown {
  const id = asPositiveInt(value);
  if (id !== null) {
    const publicId = offerPublicIdById.get(id);
    return publicId !== undefined ? publicId : value;
  }
  return value;
}

// Rewrite the Nth offerlink anchor's opening tag to carry the given
// data-link-instance (replacing any stale value).
function stampInlineAnchors(html: string, ids: string[]): string {
  let index = 0;
  return html.replace(OFFERLINK_RE, (whole) => {
    const id = ids[index++];
    if (id === undefined) return whole;
    const openEnd = whole.indexOf(">");
    if (openEnd < 0) return whole;
    let openTag = whole.slice(0, openEnd + 1);
    const rest = whole.slice(openEnd + 1);
    openTag = openTag.replace(/\s+data-link-instance\s*=\s*("[^"]*"|'[^']*')/gi, "");
    openTag = `${openTag.slice(0, -1)} data-link-instance="${id}">`;
    return openTag + rest;
  });
}

// Enrich a validated Section's blocks with their resolved link-instance ids.
// Returns a NEW blocks array (deep copy); `source.blocks` is not mutated.
export function applyLinkInstances(
  source: SectionLinkSource,
  resolved: ResolvedLinkInstance[],
  offerPublicIdById: ReadonlyMap<number, string>,
): SectionBlock[] {
  const blocks = JSON.parse(JSON.stringify(source.blocks)) as SectionBlock[];
  let cursor = 0;
  const take = (): ResolvedLinkInstance | undefined => resolved[cursor++];

  if (source.headline_offer_id !== null && source.headline_offer_id > 0) {
    // The headline instance is DB-only (block_id "__headline__"); nothing to
    // write into blocks — consume its slot to stay aligned with extraction.
    take();
  }

  for (const block of blocks) {
    const data = block.data;

    // (a) block-level binding
    const blockOffer = offerRef(data.offer_id);
    if (blockOffer.id !== null || blockOffer.publicId !== null) {
      const instance = take();
      if (instance !== undefined) {
        data.link_instance_id = instance.public_id;
        data.offer_id = normalizedOfferRef(data.offer_id, offerPublicIdById);
      }
    }

    // (b) nested button lists
    for (const listKey of ["buttons", "items"] as const) {
      const list = data[listKey];
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        if (!isPlainObject(entry)) continue;
        const itemOffer = offerRef(entry.offer_id);
        if (itemOffer.id === null && itemOffer.publicId === null) continue;
        const instance = take();
        if (instance !== undefined) {
          entry.link_instance_id = instance.public_id;
          entry.offer_id = normalizedOfferRef(entry.offer_id, offerPublicIdById);
        }
      }
    }

    // (c) inline offerlink anchors: data.html first, then string list items —
    // matching inlineHtmlSources() order.
    if (typeof data.html === "string" && data.html !== "") {
      const count = [...data.html.matchAll(OFFERLINK_RE)].length;
      if (count > 0) {
        const ids: string[] = [];
        for (let i = 0; i < count; i++) {
          const instance = take();
          ids.push(instance !== undefined ? instance.public_id : "");
        }
        data.html = stampInlineAnchors(data.html, ids);
      }
    }
    if (Array.isArray(data.items)) {
      data.items = (data.items as unknown[]).map((item) => {
        if (typeof item !== "string" || item === "") return item;
        const count = [...item.matchAll(OFFERLINK_RE)].length;
        if (count === 0) return item;
        const ids: string[] = [];
        for (let i = 0; i < count; i++) {
          const instance = take();
          ids.push(instance !== undefined ? instance.public_id : "");
        }
        return stampInlineAnchors(item, ids);
      });
    }
  }

  return blocks;
}

// Aggregate instances into the derived listicle_section_offers rows:
// one row per (offer_id, link_role) with the occurrence count (§5.4/§30.7).
export function aggregateSectionOffers(
  instances: ResolvedLinkInstance[],
): Array<{ offer_id: number; link_role: LinkRole; occurrences: number }> {
  const counts = new Map<string, { offer_id: number; link_role: LinkRole; occurrences: number }>();
  for (const instance of instances) {
    const key = `${instance.offer_id} ${instance.link_role}`;
    const entry = counts.get(key);
    if (entry === undefined) {
      counts.set(key, {
        offer_id: instance.offer_id,
        link_role: instance.link_role,
        occurrences: 1,
      });
    } else {
      entry.occurrences += 1;
    }
  }
  return [...counts.values()];
}

// Statements that rebuild the section's link graph — DELETE + reINSERT of
// listicle_section_link_instances and the derived listicle_section_offers.
// They are meant to ride in the SAME env.DB.batch as the Section INSERT/
// UPDATE (§5.4 "rebuilt inside the Section-save transaction").
//
// `sectionRef` supports both save shapes:
//   * { id }        — the section row already exists (PATCH),
//   * { public_id } — the section row is INSERTed earlier in the same batch;
//                     rows attach via a scalar subselect on the fresh unique
//                     public_id (D1 batch statements cannot pass values
//                     forward, but they CAN subselect committed-in-batch rows).
export function buildLinkGraphStatements(
  db: D1Database,
  sectionRef: { id: number } | { public_id: string },
  instances: ResolvedLinkInstance[],
): D1PreparedStatement[] {
  const byId = "id" in sectionRef;
  const sectionExpr = byId ? "?" : "(SELECT id FROM listicle_sections WHERE public_id = ?)";
  const sectionBind: number | string = byId ? sectionRef.id : sectionRef.public_id;

  const statements: D1PreparedStatement[] = [
    db
      .prepare(`DELETE FROM listicle_section_link_instances WHERE section_id = ${sectionExpr}`)
      .bind(sectionBind),
    db
      .prepare(`DELETE FROM listicle_section_offers WHERE section_id = ${sectionExpr}`)
      .bind(sectionBind),
  ];

  for (const instance of instances) {
    statements.push(
      db
        .prepare(
          `INSERT INTO listicle_section_link_instances
             (public_id, section_id, offer_id, block_id, link_role, position_index,
              anchor_text, anchor_text_hash, button_style_id, button_group_id,
              analytics_label, updated_at)
           VALUES (?, ${sectionExpr}, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`,
        )
        .bind(
          instance.public_id,
          sectionBind,
          instance.offer_id,
          instance.block_id,
          instance.link_role,
          instance.position_index,
          instance.anchor_text,
          instance.anchor_text_hash,
          instance.button_style_id,
          instance.button_group_id,
          instance.analytics_label,
        ),
    );
  }

  for (const row of aggregateSectionOffers(instances)) {
    statements.push(
      db
        .prepare(
          `INSERT INTO listicle_section_offers (section_id, offer_id, link_role, occurrences)
           VALUES (${sectionExpr}, ?, ?, ?)`,
        )
        .bind(sectionBind, row.offer_id, row.link_role, row.occurrences),
    );
  }

  return statements;
}
