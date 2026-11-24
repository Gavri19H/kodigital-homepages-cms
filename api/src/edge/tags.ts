export function siteTag(id: string): string {
  return `site:${id}`.toLowerCase();
}

export function snapTag(id: string): string {
  return `snap:${id}`.toLowerCase();
}

export function nfTag(id: string): string {
  return `nf:${id}`.toLowerCase();
}

export function listingTag(id: string): string {
  return `listing:${id}`.toLowerCase();
}

export function slugTag(siteId: string, slug: string): string {
  return `slug:${siteId}:${slug}`.toLowerCase();
}

export function listicleTag(id: string): string {
  return `listicle:${id}`.toLowerCase();
}

export function quoteTag(id: string): string {
  return `quote:${id}`.toLowerCase();
}

export function siteQuoteTag(siteId: string, quoteId: string | number): string {
  return `quote:${siteId}:${quoteId}`.toLowerCase();
}

export function hostTag(hostname: string): string {
  return `host:${hostname}`.toLowerCase();
}

export function mergeTags(...lists: string[][]): string[] {
  const tags = new Set<string>();
  for (const list of lists) {
    for (const tag of list) {
      if (tag === "") continue;
      tags.add(tag.toLowerCase());
      if (tags.size === 100) return [...tags];
    }
  }
  return [...tags];
}
