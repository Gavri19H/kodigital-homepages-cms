// rescue-6 (agent-readiness M2/M5): render an article as clean markdown for AI
// agents that send `Accept: text/markdown` (coding agents + pasted-URL flows).
// Built from the PARSED content blocks (not an HTML scrape) so it is faithful.
// NOTE: this is a low-cost bonus — the AI SEARCH crawlers that drive referral
// traffic read your normal HTML, not markdown; this serves coding agents.
import type { BodyBlock } from "./view-models/article";

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function blockToMarkdown(b: BodyBlock): string {
  switch (b.type) {
    case "paragraph":
      return b.text;
    case "heading":
      return (b.level === 2 ? "## " : "### ") + b.text;
    case "image":
      return `![${b.alt}](${b.src})` + (b.caption ? `\n\n*${b.caption}*` : "");
    case "quote":
      return (
        b.text.split("\n").map((l) => `> ${l}`).join("\n") +
        (b.cite ? `\n>\n> — ${b.cite}` : "")
      );
    case "list":
      return b.items
        .map((it, i) => (b.ordered ? `${i + 1}. ${it}` : `- ${it}`))
        .join("\n");
    case "code":
      return "```" + (b.language ?? "") + "\n" + b.code + "\n```";
    case "callout": {
      const lines: string[] = [];
      if (b.title) lines.push(`> **${b.title}**`);
      if (b.text) lines.push(`> ${b.text}`);
      for (const it of b.items) lines.push(`> - ${it}`);
      return lines.join("\n");
    }
    case "affiliate": {
      const parts: string[] = [];
      if (b.title) parts.push(`**${b.title}**`);
      if (b.description) parts.push(b.description);
      if (b.url) parts.push(`[${b.cta}](${b.url})`);
      return parts.join("\n\n");
    }
    case "faq":
      return `**${b.question}**\n\n${b.answer}`;
    case "html":
      return stripTags(b.html);
    default:
      return "";
  }
}

export function renderArticleMarkdown(input: {
  title: string;
  subtitle?: string;
  body: ReadonlyArray<BodyBlock>;
}): string {
  const out: string[] = [`# ${input.title}`];
  if (input.subtitle && input.subtitle.trim().length > 0) {
    out.push(`*${input.subtitle.trim()}*`);
  }
  for (const b of input.body) {
    const md = blockToMarkdown(b);
    if (md.length > 0) out.push(md);
  }
  return out.join("\n\n") + "\n";
}
