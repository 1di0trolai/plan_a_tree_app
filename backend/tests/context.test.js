/** Kiểm thử việc rút gọn ngữ cảnh AI vẫn giữ câu hỏi hiện tại, ảnh tham chiếu và bằng chứng chăm sóc mà không sửa dữ liệu gốc. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactCareRequest } from '../context.js';
import { validateRequest } from '../contracts.js';

import { image } from './fixtures.js';
const plant = { id: 'one', name: 'Test plant', crop: 'other', phase: 'growing' };

test('provider excerpts even an older mobile client while preserving current question, two photos and source data', () => {
  const request = validateRequest('chat', {
    plant, referenceImages: [image, image], referencePhotoDates: ['2026-10-29 10:00', '2026-10-28 10:00'],
    history: Array.from({ length: 12 }, (_, index) => ({ date: `2026-10-${29 - index}`, summary: 'H'.repeat(1500) })),
    careEvents: Array.from({ length: 20 }, () => ({ date: '2026-10-29', type: 'water', note: 'E'.repeat(700) })),
    messages: Array.from({ length: 20 }, (_, index) => ({ role: index === 19 ? 'user' : 'assistant', text: `${index}:` + 'Q'.repeat(2997) })),
  });
  const compact = compactCareRequest('chat', request);
  assert.equal(compact.history.length, 6);
  assert.equal(compact.careEvents.length, 10);
  assert.equal(compact.messages.length, 8);
  assert.equal(compact.messages.at(-1).text, request.messages.at(-1).text);
  assert.equal(compact.messages[0].text.length, 600);
  assert.equal(compact.history[0].summary.length, 400);
  assert.equal(compact.careEvents[0].note.length, 240);
  assert.equal(compact.referenceImages, request.referenceImages);
  assert.deepEqual(compact.referencePhotoDates, request.referencePhotoDates);
  assert.equal(request.history[0].summary.length, 1500);
  assert.equal(request.messages.length, 20);
  assert.ok(JSON.stringify({ ...compact, referenceImages: [] }).length < 16000);
  assert.deepEqual(compact.contextWindow, {
    history: { included: 6, received: 12 }, careEvents: { included: 10, received: 20 }, messages: { included: 8, received: 20 },
  });
});

test('reference photo dates are optional for older clients, bounded and paired with actual images', () => {
  const messages = [{ role: 'user', text: 'What next?' }];
  assert.equal(validateRequest('chat', { plant, messages, referenceImages: [image] }).referencePhotoDates, undefined);
  assert.deepEqual(validateRequest('chat', { plant, messages, referenceImages: [image], referencePhotoDates: ['2026-10-29 10:00'] }).referencePhotoDates, ['2026-10-29 10:00']);
  for (const referencePhotoDates of [[], ['x'.repeat(81)], ['one', 'two']])
    assert.throws(() => validateRequest('chat', { plant, messages, referenceImages: [image], referencePhotoDates }), { code: 'INVALID_REQUEST' });
});

test('analysis retains its mandatory current scan and identity tasks are not compacted', () => {
  const request = validateRequest('analyze', { plant, image });
  assert.equal(compactCareRequest('analyze', request).image, request.image);
  assert.equal(compactCareRequest('identify', request), request);
  assert.equal(compactCareRequest('recognize', request), request);
});

test('analysis also bounds repeated text while keeping more inspection evidence than ordinary chat', () => {
  const request = validateRequest('analyze', {
    plant, image, referenceImages: [image],
    history: Array.from({ length: 12 }, () => ({ date: '2026-10-29', summary: 'H'.repeat(1500) })),
    careEvents: Array.from({ length: 20 }, () => ({ date: '2026-10-29', type: 'observe', note: 'E'.repeat(700) })),
  });
  const compact = compactCareRequest('analyze', request);
  assert.equal(compact.history.length, 8);
  assert.equal(compact.history[0].summary.length, 600);
  assert.equal(compact.careEvents.length, 12);
  assert.equal(compact.careEvents[0].note.length, 400);
  assert.equal(compact.image, request.image);
  assert.equal(compact.referenceImages, request.referenceImages);
});
