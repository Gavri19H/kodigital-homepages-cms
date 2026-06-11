// Image dimension extraction (T31 media library port).
//
// Pure byte-header parsers — no decode, no deps. The admin upload
// endpoint records width/height into the media table (columns exist
// since 0001) so the library grid can show "W×H" without fetching the
// blob. Unknown/unparseable headers yield null (the columns stay NULL).

export interface ImageDimensions {
  width: number;
  height: number;
}

// PNG: signature 89 50 4E 47 0D 0A 1A 0A; IHDR dimensions at bytes 16/20.
export function extractPngDimensions(data: ArrayBuffer): ImageDimensions | null {
  const view = new DataView(data);
  if (view.byteLength < 24) return null;
  if (view.getUint32(0) !== 0x89504e47) return null;
  if (view.getUint32(4) !== 0x0d0a1a0a) return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

// JPEG: walk segment markers to SOF0 (baseline) / SOF2 (progressive).
export function extractJpegDimensions(data: ArrayBuffer): ImageDimensions | null {
  const view = new Uint8Array(data);
  if (view.length < 2 || view[0] !== 0xff || view[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 8 < view.length) {
    if (view[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = view[offset + 1]!;
    if (marker === 0xc0 || marker === 0xc2) {
      const height = (view[offset + 5]! << 8) | view[offset + 6]!;
      const width = (view[offset + 7]! << 8) | view[offset + 8]!;
      return { width, height };
    }
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2; // SOI/EOI carry no length
    } else if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 2; // RST markers carry no length
    } else {
      const length = (view[offset + 2]! << 8) | view[offset + 3]!;
      offset += 2 + length;
    }
  }
  return null;
}

// GIF: "GIF" signature; logical screen size little-endian at bytes 6/8.
export function extractGifDimensions(data: ArrayBuffer): ImageDimensions | null {
  const view = new DataView(data);
  if (view.byteLength < 10) return null;
  const sig = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2));
  if (sig !== "GIF") return null;
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

// WebP: RIFF/WEBP container; VP8 (lossy) / VP8L (lossless) / VP8X (extended).
export function extractWebpDimensions(data: ArrayBuffer): ImageDimensions | null {
  const view = new DataView(data);
  if (view.byteLength < 30) return null;
  if (view.getUint32(0) !== 0x52494646) return null; // 'RIFF'
  if (view.getUint32(8) !== 0x57454250) return null; // 'WEBP'

  const chunkType = String.fromCharCode(
    view.getUint8(12),
    view.getUint8(13),
    view.getUint8(14),
    view.getUint8(15),
  );

  if (chunkType === "VP8 ") {
    const width = view.getUint16(26, true) & 0x3fff;
    const height = view.getUint16(28, true) & 0x3fff;
    return { width, height };
  }
  if (chunkType === "VP8L") {
    if (view.getUint8(20) !== 0x2f) return null;
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunkType === "VP8X") {
    const width =
      (view.getUint8(24) | (view.getUint8(25) << 8) | (view.getUint8(26) << 16)) + 1;
    const height =
      (view.getUint8(27) | (view.getUint8(28) << 8) | (view.getUint8(29) << 16)) + 1;
    return { width, height };
  }
  return null;
}

// Dispatch on MIME type. SVG/AVIF (and anything else) → null: their
// dimensions are not in a fixed header position.
export function extractImageDimensions(
  mimeType: string,
  data: ArrayBuffer,
): ImageDimensions | null {
  switch (mimeType) {
    case "image/png":
      return extractPngDimensions(data);
    case "image/jpeg":
    case "image/jpg":
      return extractJpegDimensions(data);
    case "image/gif":
      return extractGifDimensions(data);
    case "image/webp":
      return extractWebpDimensions(data);
    default:
      return null;
  }
}
