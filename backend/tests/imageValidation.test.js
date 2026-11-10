/** Kiểm thử bộ kiểm tra ảnh dùng chung bằng ảnh hỏng, giới hạn kích thước/giải nén và hợp đồng lỗi riêng của AI với đồng bộ. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateSync } from 'node:zlib';
import { isValidImageBytes } from '../imageValidation.js';
import { validateRequest } from '../contracts.js';
import { MAX_CLOUD_ASSET_BYTES, validateCloudAsset } from '../cloud.js';
import { image } from './fixtures.js';

const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
const pngBytes = Buffer.from(image.base64, 'base64');
const jpegBytes = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0000ffd9', 'hex');

function chunk(kind, data = Buffer.alloc(0)) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length);
  bytes.write(kind, 4, 4, 'ascii');
  data.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4);
  return bytes;
}

function png({ width = 1, height = 1, data = deflateSync(Buffer.alloc(5)), includeData = true } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([pngSignature, chunk('IHDR', header), ...(includeData ? [chunk('IDAT', data)] : []), chunk('IEND')]);
}

function validateBoth(bytes, mimeType) {
  const base64 = bytes.toString('base64');
  return [
    () => validateRequest('identify', { image: { mimeType, base64 } }),
    () => validateCloudAsset({ contentType: mimeType, dataBase64: base64 }),
  ];
}

test('shared validation retains JPEG/PNG format checks and accepts the existing image fixture', () => {
  for (const [bytes, mimeType] of [[pngBytes, 'image/png'], [jpegBytes, 'image/jpeg']]) {
    assert.equal(isValidImageBytes(bytes, mimeType), true);
    for (const validate of validateBoth(bytes, mimeType)) assert.doesNotThrow(validate);
    assert.equal(isValidImageBytes(bytes, mimeType === 'image/png' ? 'image/jpeg' : 'image/png'), false);
  }
  assert.equal(isValidImageBytes(pngBytes, 'image/svg+xml'), false);
  assert.equal(isValidImageBytes(null, 'image/png'), false);
});

test('malformed PNG chunks, missing compressed data and excessive geometry are rejected by both consumers', () => {
  const badLength = Buffer.from(pngBytes);
  badLength.writeUInt32BE(0xffffffff, 33);
  const badHeader = Buffer.from(pngBytes);
  badHeader.writeUInt32BE(12, 8);
  const cases = [Buffer.alloc(0), pngBytes.subarray(0, -1), Buffer.concat([pngBytes, Buffer.from([0])]), badLength, badHeader,
    png({ width: 0 }), png({ width: 12001 }), png({ width: 5000, height: 5000 }), png({ includeData: false }), png({ data: Buffer.from('broken zlib') })];
  for (const bytes of cases) {
    for (const validate of validateBoth(bytes, 'image/png')) assert.throws(validate, { status: 400, code: 'INVALID_REQUEST' });
  }
});

test('JPEG scan framing cannot bypass dimension, segment length or end marker checks', () => {
  const noFrame = Buffer.from(jpegBytes);
  noFrame[3] = 0xe0;
  const oversized = Buffer.from(jpegBytes);
  oversized.writeUInt16BE(12001, 9);
  const badLength = Buffer.from(jpegBytes);
  badLength.writeUInt16BE(0xffff, 4);
  for (const bytes of [jpegBytes.subarray(0, -1), noFrame, oversized, badLength]) {
    for (const validate of validateBoth(bytes, 'image/jpeg')) assert.throws(validate, { status: 400, code: 'INVALID_REQUEST' });
  }
  const progressive = Buffer.from(jpegBytes);
  progressive[3] = 0xc2;
  assert.equal(isValidImageBytes(progressive, 'image/jpeg'), true);
});

test('AI retains its dimension-based PNG inflate cap while cloud retains its fixed cap', () => {
  // The storage validator historically allows more inflated bytes than dimensions predict.
  const bytes = png({ data: deflateSync(Buffer.alloc(10)) });
  const [validateAi, validateCloud] = validateBoth(bytes, 'image/png');
  assert.throws(validateAi, { status: 400, code: 'INVALID_REQUEST' });
  assert.doesNotThrow(validateCloud);
  assert.equal(isValidImageBytes(bytes, 'image/png'), false);
  assert.equal(isValidImageBytes(bytes, 'image/png', { boundPngOutputToDimensions: false }), true);
});

test('both PNG policies reject compressed data exceeding the hard 64 MB output cap', () => {
  const bytes = png({ width: 5000, height: 4000, data: deflateSync(Buffer.alloc(64 * 1024 * 1024 + 1)) });
  for (const validate of validateBoth(bytes, 'image/png')) assert.throws(validate, { status: 400, code: 'INVALID_REQUEST' });
});

test('AI and cloud preserve their distinct error messages and encoded-size limits', () => {
  const bad = Buffer.from('not an image');
  const [validateAi, validateCloud] = validateBoth(bad, 'image/png');
  assert.throws(validateAi, { message: 'image: nội dung không phải ảnh JPEG/PNG hợp lệ hoặc kích thước quá lớn.' });
  assert.throws(validateCloud, { message: 'Nội dung ảnh không hợp lệ.' });
  assert.throws(() => validateRequest('identify', { image: { mimeType: 'image/png', base64: 'A'.repeat(Math.ceil(2 * 1024 * 1024 / 3) * 4 + 4) } }),
    { status: 400, code: 'INVALID_REQUEST' });
  assert.throws(() => validateCloudAsset({ contentType: 'image/png', dataBase64: 'A'.repeat(Math.ceil(MAX_CLOUD_ASSET_BYTES / 3) * 4 + 4) }),
    { status: 413, code: 'ASSET_TOO_LARGE' });
});
