// Governed /lc click-URL builder + render-time anchor rewrite (§7.2 + §30.7
// + §31.9).
//
// Stored listicle content NEVER carries a provider URL (§12): governed
// anchors are emitted by editor/listicle-blocks.ts with data-offer /
// data-link-instance / data-block-id / data-link-role and NO href. THIS
// module is the render-time pass that mints the first-party /lc URL into
// each governed anchor:
//
//   /lc/{offer_public_id}?a={article}&lv={lander_v}&p={page_index}
//      &s={section_public_id}&c={page_candidate_id}&m={page_selection_mode}
//      &r={page_rule_id}&lnk={link_instance_id}&blk={block_id}&role={link_role}
//      &pv=
//
// `pv` (§31.9 page_view_id) is a PLACEHOLDER: the page-view id is minted
// client-side per view, so the shell (cached, shared) carries an empty pv=
// that the Phase-7 beacon/selector stamps before navigation. The /lc
// resolver itself is Phase 7 — shell links point at it already (§7.2).

export interface GovernedUrlContext {
  articlePublicId: string;
  landerV: string;
  pageIndex: number;
  sectionPublicId: string;
  candidatePublicId: string;
  selectionMode: string;
  // The candidate's own rule public id (rule_based candidates have 0..1 rule;
  // fallback candidates have none → empty). §15.7's runtime "matched rule"
  // semantics for non-default selections are Phase-7 client concerns.
  ruleId: string;
}

export interface GovernedLinkAttrs {
  offerPublicId: string;
  linkInstanceId: string;
  blockId: string;
  linkRole: string;
}

export function buildGovernedUrl(link: GovernedLinkAttrs, ctx: GovernedUrlContext): string {
  const q = new URLSearchParams();
  q.set("a", ctx.articlePublicId);
  q.set("lv", ctx.landerV);
  q.set("p", String(ctx.pageIndex));
  q.set("s", ctx.sectionPublicId);
  q.set("c", ctx.candidatePublicId);
  q.set("m", ctx.selectionMode);
  q.set("r", ctx.ruleId);
  q.set("lnk", link.linkInstanceId);
  q.set("blk", link.blockId);
  q.set("role", link.linkRole);
  q.set("pv", ""); // §31.9 page_view_id placeholder — stamped client-side (Phase 7)
  return `/lc/${encodeURIComponent(link.offerPublicId)}?${q.toString()}`;
}

// ---------------------------------------------------------------------------
// Render-time anchor rewrite
// ---------------------------------------------------------------------------

// Matches an opening governed <a …data-offer="…"…> tag emitted by the
// listicle block renderers (attribute emission order is deterministic there,
// but this matcher reads attributes independently of order).
const GOVERNED_ANCHOR_RE = /<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

function readAttr(attrs: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i");
  const m = attrs.match(re);
  return m === null ? null : (m[1] ?? "");
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Rewrite every governed anchor in `html` with its minted /lc href.
// `offerPublicIdByRef` maps EVERY acceptable data-offer value (the off_…
// public id AND the legacy internal numeric id) to the off_… public id; an
// anchor whose offer cannot be resolved keeps NO href (inert, fail-safe —
// never a broken/guessable URL).
export function rewriteGovernedAnchors(
  html: string,
  ctx: GovernedUrlContext,
  offerPublicIdByRef: ReadonlyMap<string, string>,
): string {
  return html.replace(GOVERNED_ANCHOR_RE, (whole: string, attrs: string) => {
    const offerRef = readAttr(attrs, "data-offer");
    if (offerRef === null || offerRef === "") return whole; // not governed
    const offerPublicId = offerPublicIdByRef.get(offerRef);
    if (offerPublicId === undefined) return whole; // unresolvable → inert
    const href = buildGovernedUrl(
      {
        offerPublicId,
        linkInstanceId: readAttr(attrs, "data-link-instance") ?? "",
        blockId: readAttr(attrs, "data-block-id") ?? "",
        linkRole: readAttr(attrs, "data-link-role") ?? "",
      },
      ctx,
    );
    // Drop any pre-existing href defensively (stored content never carries
    // one per §12; a hostile one must not survive the rewrite).
    const cleaned = attrs.replace(/\shref\s*=\s*("[^"]*"|'[^']*')/gi, "");
    return `<a href="${escapeAttr(href)}"${cleaned}>`;
  });
}

// Collect every data-offer reference present in `html` (deduped) so the
// caller can resolve legacy numeric refs to off_… public ids in ONE query.
export function collectOfferRefs(html: string): string[] {
  const refs = new Set<string>();
  for (const m of html.matchAll(GOVERNED_ANCHOR_RE)) {
    const ref = readAttr(m[1] ?? "", "data-offer");
    if (ref !== null && ref !== "") refs.add(ref);
  }
  return [...refs];
}
