/** Kiểm tra cấu trúc JPEG/PNG và kích thước ảnh dùng chung cho AI/đồng bộ, luôn giới hạn bộ nhớ giải nén PNG theo chính sách của nơi gọi. */
import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const MAX_PNG_OUTPUT_BYTES = 64 * 1024 * 1024;
const JPEG_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function validDimensions(width, height) {
  return width > 0 && height > 0 && width <= 12000 && height <= 12000 && width * height <= 20000000;
}

function validPng(bytes, boundOutputToDimensions) {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
    || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') return false;
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!validDimensions(width, height)) return false;
  const maxOutputLength = boundOutputToDimensions
    ? Math.min(MAX_PNG_OUTPUT_BYTES, height * (width * 8 + 1)) : MAX_PNG_OUTPUT_BYTES;
  let offset = 8;
  const compressed = [];
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    if (size > bytes.length - offset - 12) return false;
    const kind = bytes.toString('ascii', offset + 4, offset + 8);
    if (kind === 'IDAT') compressed.push(bytes.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
    if (kind === 'IEND') {
      if (!compressed.length || size !== 0 || offset !== bytes.length) return false;
      try {
        inflateSync(Buffer.concat(compressed), { maxOutputLength });
        return true;
      } catch { return false; }
    }
  }
  return false;
}

function validJpeg(bytes) {
  if (bytes.length < 20 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return false;
  let offset = 2, hasDimensions = false;
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda) return hasDimensions; // Pixel decoding belongs to the image consumer; EOI is checked above.
    if (marker === 0xd9 || marker === 0x00) return false;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    if (JPEG_FRAME_MARKERS.has(marker)) {
      if (length < 8 || !validDimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3))) return false;
      hasDimensions = true;
    }
    offset += length;
  }
  return false;
}

// Cloud retains its fixed 64 MB allowance; AI also caps output by the encoded dimensions.
// These structural checks do not replace full pixel decoding or validate PNG CRCs.
export function isValidImageBytes(bytes, mimeType, { boundPngOutputToDimensions = true } = {}) {
  if (!Buffer.isBuffer(bytes)) return false;
  if (mimeType === 'image/png') return validPng(bytes, boundPngOutputToDimensions);
  if (mimeType === 'image/jpeg') return validJpeg(bytes);
  return false;
}
