import {
  extractGifDimensions, extractPngDimensions, extractWebpDimensions, type ImageDimensions,
} from "./dimensions";

export const IMAGE_SIZE_HEADER_BYTES = 64 * 1024;

function jpegSize(head: DataView): ImageDimensions | null {
  let offset = 2; // SOI
  while (offset < head.byteLength) {
    if (head.getUint8(offset++) !== 0xff) return null;
    while (offset < head.byteLength && head.getUint8(offset) === 0xff) offset++;
    if (offset === head.byteLength) return null;
    const marker = head.getUint8(offset++);
    if (marker === 0x00 || marker === 0xd9 || marker === 0xda) return null; // stuffed byte, EOI, SOS
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // standalone TEM/RST
    if (offset + 2 > head.byteLength) return null;
    const length = head.getUint16(offset); // includes the two length bytes
    if (length < 2) return null;
    // All SOFn frame types. DHT, JPG and DAC occupy the gaps in this range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (length < 8 || offset + 7 > head.byteLength) return null;
      return { width: head.getUint16(offset + 5), height: head.getUint16(offset + 3) };
    }
    offset += length;
  }
  return null;
}

function webpSize(head: DataView, data: ArrayBuffer): ImageDimensions | null {
  if (head.byteLength < 20 || head.getUint32(8) !== 0x57454250) return null; // WEBP
  const chunk = head.getUint32(12);
  const length = head.getUint32(16, true);
  if (head.getUint32(4, true) < 12 + length) return null; // chunk exceeds declared RIFF size
  if (chunk === 0x5650384c) { // VP8L needs just five payload bytes, including its signature.
    if (length < 5 || head.byteLength < 25 || head.getUint8(20) !== 0x2f) return null;
    const bits = head.getUint32(21, true);
    if ((bits >>> 29) !== 0) return null; // lossless version
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (length < 10 || head.byteLength < 30) return null;
  if (chunk === 0x56503820) { // VP8 key frame and start code
    if ((head.getUint8(20) & 1) || head.getUint16(23) !== 0x9d01 || head.getUint8(25) !== 0x2a) return null;
  } else if (chunk !== 0x56503858) { // VP8X canvas
    return null;
  }
  return extractWebpDimensions(data);
}

const svgNumber = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i;
const svgCoordinate = new RegExp(`^${svgNumber.source}$`, "i");
const svgAbsoluteLength = new RegExp(`^(${svgNumber.source})(px|in|cm|mm|q|pt|pc)?$`, "i");
const pixelsPerUnit: Readonly<Record<string, number>> = {
  "": 1, px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, pt: 96 / 72, pc: 16,
};

function svgLength(attribute: string | undefined): number | null {
  if (!attribute) return null;
  const length = svgAbsoluteLength.exec(attribute.trim());
  if (!length) return null;
  const pixels = Number(length[1]) * pixelsPerUnit[(length[2] ?? "").toLowerCase()]!;
  return Number.isFinite(pixels) && pixels > 0 ? pixels : null;
}

function svgSize(head: DataView): ImageDimensions | null {
  // An XML prefix starts with whitespace, '<', or a byte-order mark.
  if (![9, 10, 13, 32, 0x3c, 0xef, 0xff, 0xfe].includes(head.getUint8(0))) return null;
  const bom = head.getUint16(0);
  const encoding = bom === 0xfffe ? "utf-16le" : bom === 0xfeff ? "utf-16be" : "utf-8";
  let xml = new TextDecoder(encoding).decode(head).trimStart();
  // Skip XML declarations, comments and the external DOCTYPE common in older logos.
  const prolog = /^(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE\s+svg\b[^>[\]]*>)/;
  let prefix;
  while ((prefix = prolog.exec(xml))) xml = xml.slice(prefix[0].length).trimStart();
  if (!xml.startsWith("<svg")) return null;

  // Consume complete, quoted attributes of the root. Child elements and text
  // inside another attribute cannot supply dimensions.
  const attribute = /\s+([^\s"'=<>/]+)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y;
  const attrs = new Map<string, string>();
  let offset = 4;
  attribute.lastIndex = offset;
  let match;
  while ((match = attribute.exec(xml))) {
    attrs.set(match[1]!, match[2] ?? match[3]!);
    offset = attribute.lastIndex;
  }
  if (!/^\s*\/?>/.test(xml.slice(offset))) return null;
  const width = svgLength(attrs.get("width"));
  const height = svgLength(attrs.get("height"));
  if (width !== null && height !== null) return { width, height };

  const box = attrs.get("viewBox")?.trim().split(/\s*,\s*|\s+/);
  if (box?.length !== 4 || !box.every(value => svgCoordinate.test(value) && Number.isFinite(Number(value)))) return null;
  const boxWidth = Number(box[2]);
  const boxHeight = Number(box[3]);
  if (boxWidth <= 0 || boxHeight <= 0) return null;
  if (width !== null) return { width, height: width * boxHeight / boxWidth };
  if (height !== null) return { width: height * boxWidth / boxHeight, height };
  return { width: boxWidth, height: boxHeight };
}

function headerSize(data: ArrayBuffer): ImageDimensions | null {
  const head = new DataView(data, 0, Math.min(data.byteLength, IMAGE_SIZE_HEADER_BYTES));
  if (head.byteLength < 4) return null;
  if (head.getUint16(0) === 0xffd8) return jpegSize(head);
  switch (head.getUint32(0)) {
    case 0x89504e47: // PNG signature, 13-byte IHDR
      if (head.byteLength < 24 || head.getUint32(8) !== 13 || head.getUint32(12) !== 0x49484452) return null;
      return extractPngDimensions(data);
    case 0x47494638: // GIF87a / GIF89a logical screen
      if (head.byteLength < 10 || (head.getUint16(4) !== 0x3761 && head.getUint16(4) !== 0x3961)) return null;
      return extractGifDimensions(data);
    case 0x52494646: // RIFF
      return webpSize(head, data);
    default:
      return svgSize(head);
  }
}

/** Read intrinsic dimensions from a file prefix, including JPEGs with leading metadata. */
export function parseImageSize(bytes: ArrayBuffer | Uint8Array): ImageDimensions | null {
  try {
    const data = bytes instanceof Uint8Array ? new Uint8Array(bytes.subarray(0, IMAGE_SIZE_HEADER_BYTES)).buffer : bytes;
    const size = headerSize(data);
    return size && Number.isFinite(size.width) && size.width > 0 && Number.isFinite(size.height) && size.height > 0
      ? size : null;
  } catch {
    return null;
  }
}
