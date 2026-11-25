import { describe, expect, it } from "vitest";
import { parseImageSize } from "../src/media/image-size";

const ascii = (text: string) => new TextEncoder().encode(text);

// File prefixes through the last size field. The remaining image data is never needed.
const png = Uint8Array.of(
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...ascii("IHDR"),
  0, 0, 2, 1, 0, 0, 0, 129,
);
const gif = (version: string) => Uint8Array.of(...ascii(version), 0x34, 0x02, 0x23, 0x01);

function webp(chunk: string, payload: number[]) {
  const head = new Uint8Array(20 + payload.length);
  const view = new DataView(head.buffer);
  head.set(ascii("RIFF"));
  view.setUint32(4, 12 + payload.length + payload.length % 2, true);
  head.set(ascii("WEBP" + chunk), 8);
  view.setUint32(16, payload.length, true);
  head.set(payload, 20);
  return head;
}

const vp8 = webp("VP8 ", [0x10, 0, 0, 0x9d, 1, 0x2a, 0x34, 0x42, 0x23, 0x81]);
const vp8l = webp("VP8L", [0x2f, 0, 1, 0x80, 0x10]);
const vp8x = webp("VP8X", [0x10, 0, 0, 0, 2, 1, 1, 4, 2, 0]);

function jpeg(frameMarker: number, metadataBytes = 0) {
  // SOI, a length-delimited comment, then a one-component SOFn.
  const frame = [0xff, frameMarker, 0, 11, 8, 1, 0x2c, 4, 0, 1, 1, 0x11, 0];
  const bytes = new Uint8Array(6 + metadataBytes + frame.length);
  bytes.set([0xff, 0xd8, 0xff, 0xfe]);
  new DataView(bytes.buffer).setUint16(4, metadataBytes + 2);
  if (metadataBytes >= frame.length) bytes.set([0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1], 6);
  bytes.set(frame, 6 + metadataBytes);
  return bytes;
}

describe("intrinsic image size", () => {
  it.each([
    ["PNG IHDR", png, 513, 129],
    ["GIF87a", gif("GIF87a"), 564, 291],
    ["GIF89a", gif("GIF89a"), 564, 291],
    ["lossy WebP", vp8, 564, 291],
    ["lossless WebP", vp8l, 257, 513],
    ["extended WebP canvas", vp8x, 65795, 517],
    ["baseline JPEG", jpeg(0xc0), 1024, 300],
    ["progressive JPEG after 48 KiB of metadata", jpeg(0xc2, 48 * 1024), 1024, 300],
    ["lossless JPEG", jpeg(0xc3), 1024, 300],
    ["arithmetic JPEG", jpeg(0xca), 1024, 300],
  ] as const)("reads %s", (_name, bytes, width, height) => {
    expect(parseImageSize(bytes.buffer)).toEqual({ width, height });
  });

  it("can read the final size byte at 64 KiB and never scans further", () => {
    // Six bytes precede the comment payload and nine frame bytes end with the width.
    const lastComment = 65536 - 6 - 9;
    expect(parseImageSize(jpeg(0xc2, lastComment).buffer)).toEqual({ width: 1024, height: 300 });
    expect(parseImageSize(jpeg(0xc2, lastComment + 1).buffer)).toBeNull();
  });

  it("honors a typed array's offset and length", () => {
    const wrapped = Uint8Array.of(0, ...png, 0);
    expect(parseImageSize(wrapped.subarray(1, -1))).toEqual({ width: 513, height: 129 });
    expect(parseImageSize(wrapped.subarray(1, -2))).toBeNull();
  });

  it.each([
    ["attribute lengths", '<svg height="24px" width="90.5" viewBox="0 0 1 1"/>', 90.5, 24],
    ["absolute units", "<svg width='1in' height='12pt'/>", 96, 16],
    ["viewBox only", '<?xml version="1.0"?><!-- <svg width="1" height="1"/> -->\n' +
      '<!DOCTYPE svg SYSTEM "logo.dtd"><svg viewBox="-10, 4, 315, 71"><path/></svg>', 315, 71],
    ["relative lengths with a viewBox", '<svg width="100%" height="100%" viewBox="0 0 300 50"/>', 300, 50],
    ["one absolute length and a viewBox", '<svg width="1e2" viewBox="0 0 120 30"/>', 100, 25],
  ] as const)("reads SVG %s", (_name, svg, width, height) => {
    expect(parseImageSize(ascii(svg))).toEqual({ width, height });
  });

  it("reads a UTF-16 SVG with a byte-order mark", () => {
    const svg = Buffer.from('\ufeff<svg width="42" height="9"/>', "utf16le");
    expect(parseImageSize(svg)).toEqual({ width: 42, height: 9 });
  });

  it.each([
    ["PNG", png.subarray(0, 23)],
    ["GIF", gif("GIF89a").subarray(0, 9)],
    ["VP8", vp8.subarray(0, 29)],
    ["VP8L", vp8l.subarray(0, 24)],
    ["VP8X", vp8x.subarray(0, 29)],
    ["JPEG", jpeg(0xc2).subarray(0, 14)],
    ["SVG opening tag", ascii('<svg width="10" height="3"')],
  ] as const)("returns null for truncated %s", (_name, bytes) => {
    expect(parseImageSize(bytes)).toBeNull();
  });

  it("rejects invalid headers and images with no intrinsic size", () => {
    const wrongPngChunk = png.slice();
    wrongPngChunk.set(ascii("IDAT"), 12);
    const wrongVp8StartCode = vp8.slice();
    wrongVp8StartCode[23] = 0;
    const jpegScan = jpeg(0xda, 16);
    jpegScan.set([0xff, 0xc0], 20); // frame-like bytes inside the comment
    for (const bytes of [
      new Uint8Array(), ascii("other file"), wrongPngChunk, wrongVp8StartCode,
      gif("GIF80a"), Uint8Array.of(...ascii("GIF89a"), 0, 0, 10, 0),
      Uint8Array.of(0xff, 0xd8, 0xff, 0xe1, 0, 1), jpegScan,
      ascii('<svg><rect width="20" height="5"/></svg>'),
      ascii('<svg data-width="20" aria-label=\'height="5"\'/>'),
      ascii('<html><svg width="20" height="5"/></html>'),
      ascii('<svg viewBox="0 0 -20 5"/>'), ascii('<svg width="100%" height="auto"/>'),
    ]) {
      expect(parseImageSize(bytes)).toBeNull();
    }
  });
});
