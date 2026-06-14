// Shared HTML-escape + <img> primitives for the public template modules.
// Attribute values go through escAttr (quotes included); text nodes through
// escText. imgTag renders nothing when src is absent so callers can splice
// the result without an emptiness check.

export function escAttr(input: string | null | undefined): string {
  if (input === null || input === undefined) return "";
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escText(input: string | null | undefined): string {
  if (input === null || input === undefined) return "";
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function imgTag(
  src: string | null | undefined,
  alt: string | null | undefined,
  attrs: string,
): string {
  if (src === null || src === undefined || src.length === 0) return "";
  return `<img src="${escAttr(src)}" alt="${escAttr(alt ?? "")}"${attrs}>`;
}
