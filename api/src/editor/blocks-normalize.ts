// Normalizes ANY stored content_json block into the editor/publish nested
// vocabulary ({type, data:{…}}). The site-provisioning pipeline historically
// wrote FLAT blocks (top-level fields — steps.ts buildArticleContentJson):
//   paragraph{text} · heading{level,text} · list{ordered,items} ·
//   quote{text,cite} · callout{title,text,items} · affiliate{…} ·
//   image{src,alt,caption} · faq{question,answer}
// while the block editor and the publish renderer (blocks.ts) read nested
// `data` with `style` (not ordered), `caption` (not cite), `url` (not src)
// and ONE faqgroup{items:[{q,a}]} instead of per-item faq blocks.
//
// This module is the SERVER twin of the editor's load-time normalizer
// (editor-scripts.ts loadFromInput) — the two mappings MUST stay identical;
// test/vocabulary-equivalence.test.ts pins both against the frozen
// article-345 fixture. Nested blocks pass through untouched (idempotent).

interface RawBlock {
  [key: string]: unknown;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function collectExtraFields(b: RawBlock): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) {
    if (k === "type" || k === "id" || k === "data") continue;
    data[k] = v;
  }
  return data;
}

export function normalizeDocumentBlocks(blocks: ReadonlyArray<unknown>): unknown[] {
  const out: unknown[] = [];
  let pendingFaqItems: Array<{ q: string; a: string }> | null = null;

  const flushFaqs = () => {
    if (pendingFaqItems && pendingFaqItems.length > 0) {
      out.push({ type: "faqgroup", data: { items: pendingFaqItems } });
    }
    pendingFaqItems = null;
  };

  for (const raw of blocks) {
    if (!isObject(raw)) continue;
    const b = raw as RawBlock;
    const type = str(b.type).toLowerCase();

    // Already-nested block: pass through untouched (idempotence).
    if (isObject(b.data)) {
      flushFaqs();
      out.push(raw);
      continue;
    }

    if (type === "faq") {
      const q = str(b.question);
      const a = str(b.answer);
      if (q.length > 0 || a.length > 0) {
        if (!pendingFaqItems) pendingFaqItems = [];
        pendingFaqItems.push({ q, a });
      }
      continue;
    }
    flushFaqs();

    switch (type) {
      case "paragraph":
      case "p":
      case "text":
        out.push({ type: "paragraph", data: { text: str(b.text) } });
        break;
      case "heading":
      case "h2":
      case "h3": {
        const level =
          typeof b.level === "number" && Number.isFinite(b.level)
            ? b.level
            : type === "h3"
              ? 3
              : 2;
        out.push({ type: "heading", data: { text: str(b.text), level } });
        break;
      }
      case "list":
      case "ul":
      case "ol": {
        const items = Array.isArray(b.items)
          ? b.items.filter((x): x is string => typeof x === "string")
          : [];
        const ordered = type === "ol" || b.ordered === true || b.style === "ordered";
        out.push({
          type: "list",
          data: { style: ordered ? "ordered" : "unordered", items },
        });
        break;
      }
      case "quote":
      case "blockquote":
        out.push({
          type: "quote",
          data: { text: str(b.text), caption: str(b.cite) || str(b.caption) },
        });
        break;
      case "image":
      case "img":
        out.push({
          type: "image",
          data: {
            url: str(b.src) || str(b.url),
            alt: str(b.alt),
            caption: str(b.caption),
          },
        });
        break;
      case "callout": {
        const items = Array.isArray(b.items)
          ? b.items.filter((x): x is string => typeof x === "string")
          : [];
        out.push({
          type: "callout",
          data: { title: str(b.title), text: str(b.text), items },
        });
        break;
      }
      case "affiliate":
        out.push({
          type: "affiliate",
          data: {
            title: str(b.title),
            description: str(b.description),
            url: typeof b.url === "string" ? b.url : null,
            cta: str(b.cta),
          },
        });
        break;
      case "html":
        out.push({ type: "html", data: { html: str(b.html) } });
        break;
      default:
        // Unknown flat type: never destroyed — every field preserved into data.
        out.push({ type: str(b.type), data: collectExtraFields(b) });
        break;
    }
  }
  flushFaqs();
  return out;
}
