/** Kiểm thử hợp đồng nhận diện, phân tích và hội thoại chăm cây, loại phản hồi sai cấu trúc hoặc vượt giới hạn. */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createGardenFixture } from './fixtures/gardenFixture';
import { imagePayloadWithinBudget, imageResize, pickCurrentPhotos, validateAiResponse } from '../src/services/plantAiContracts';
import type { PlantPhoto } from '../src/types/app';

const identity = { crop: 'tomato', label: 'Cà chua', species: 'Solanum lycopersicum',
  phase: 'planning', summary: 'Có thể là quả cà chua; hãy xác nhận.', guide: ['Chọn hạt hoặc cây giống.'], warnings: [] };
const analysis = { analysis: { level: 'Tốt', title: 'Chưa cần can thiệp', summary: 'Hãy tiếp tục theo dõi.', actions: [] }, questions: [], limitations: ['Ảnh không đo độ ẩm.'] };

test('valid identify, no-action analysis and chat responses match the backend contract', () => {
  assert.equal(validateAiResponse('identify', identity), true);
  assert.equal(validateAiResponse('analyze', analysis), true);
  assert.equal(validateAiResponse('chat', { content: 'Hãy kiểm tra đất trước khi tưới.' }), true);
  assert.equal(validateAiResponse('chat', { content: 'Trả lời', questions: [], limitations: [] }), true);
});

test('other is a compatible crop group, not a rejection of a recognized species such as starfruit', () => {
  assert.equal(validateAiResponse('identify', {
    ...identity, crop: 'other', label: 'Khế', species: 'Averrhoa carambola',
    phase: 'planning', summary: 'Có thể là quả khế rời; hãy xác nhận tên trước khi tạo hồ sơ.',
  }), true);
});

test('missing fields, nulls, false enums and wrong list types fail closed', () => {
  for (const invalid of [null, [], {}, { ...identity, crop: 'apple' }, { ...identity, phase: 'fruit' },
    { ...identity, label: '  ' }, { ...identity, guide: 'not-array' }, { ...identity, warnings: [null] }]) {
    assert.equal(validateAiResponse('identify', invalid), false);
  }
  assert.equal(validateAiResponse('analyze', { ...analysis, analysis: { ...analysis.analysis, level: 'healthy' } }), false);
  assert.equal(validateAiResponse('analyze', { ...analysis, analysis: { ...analysis.analysis, actions: [42] } }), false);
  assert.equal(validateAiResponse('chat', { content: 'Okay', questions: null }), false);
  assert.equal(validateAiResponse('chat', { content: 'Okay', limitations: [false] }), false);
  assert.equal(validateAiResponse('identify', { ...identity, guide: Array(2) }), false);
});

test('output strings and arrays respect server bounds', () => {
  assert.equal(validateAiResponse('identify', { ...identity, label: 'x'.repeat(150) }), true);
  assert.equal(validateAiResponse('identify', { ...identity, label: 'x'.repeat(151) }), false);
  assert.equal(validateAiResponse('identify', { ...identity, summary: 'x'.repeat(600) }), true);
  assert.equal(validateAiResponse('identify', { ...identity, summary: 'x'.repeat(601) }), false);
  assert.equal(validateAiResponse('identify', { ...identity, guide: Array(3).fill('step') }), true);
  assert.equal(validateAiResponse('identify', { ...identity, guide: Array(4).fill('step') }), false);
  assert.equal(validateAiResponse('identify', { ...identity, guide: ['x'.repeat(301)] }), false);
  assert.equal(validateAiResponse('identify', { ...identity, warnings: Array(3).fill('warning') }), false);
  assert.equal(validateAiResponse('identify', { ...identity, warnings: ['x'.repeat(301)] }), false);
  assert.equal(validateAiResponse('analyze', { analysis: { ...analysis.analysis, title: 'x'.repeat(201) } }), false);
  assert.equal(validateAiResponse('analyze', { analysis: { ...analysis.analysis, summary: 'x'.repeat(4001) } }), false);
  assert.equal(validateAiResponse('chat', { content: 'x'.repeat(6000) }), true);
  assert.equal(validateAiResponse('chat', { content: 'x'.repeat(6001) }), false);
});

test('recognition candidates must be unique and belong to the submitted garden', () => {
  const candidate = { decision: 'candidate', candidateIds: ['plant-1'], explanation: 'Cần bạn xác nhận.' };
  assert.equal(validateAiResponse('recognize', candidate, ['plant-1']), true);
  assert.equal(validateAiResponse('recognize', candidate, ['plant-2']), false);
  assert.equal(validateAiResponse('recognize', candidate), false);
  assert.equal(validateAiResponse('recognize', { ...candidate, candidateIds: [] }, ['plant-1']), false);
  assert.equal(validateAiResponse('recognize', { ...candidate, candidateIds: ['plant-1', 'plant-1'] }, ['plant-1']), false);
  assert.equal(validateAiResponse('recognize', { ...candidate, candidateIds: ['plant-1', 'plant-2'] }, ['plant-1', 'plant-2']), false);
});

test('ambiguous requires two or three IDs while unknown/retake require none', () => {
  for (const count of [2, 3]) {
    const ids = Array.from({ length: count }, (_, index) => `plant-${index}`);
    assert.equal(validateAiResponse('recognize', { decision: 'ambiguous', candidateIds: ids, explanation: 'Hai chậu giống nhau.' }, ids), true);
  }
  assert.equal(validateAiResponse('recognize', { decision: 'ambiguous', candidateIds: ['one'], explanation: 'Không chắc.' }, ['one']), false);
  for (const decision of ['unknown', 'retake']) {
    assert.equal(validateAiResponse('recognize', { decision, candidateIds: [], explanation: 'Cần chụp lại.' }), true);
    assert.equal(validateAiResponse('recognize', { decision, candidateIds: ['one'], explanation: 'Cần chụp lại.' }, ['one']), false);
  }
});

test('photo selection skips seed placeholders, nonlocal URIs, wrong plants and old stages', () => {
  const plant = createGardenFixture().plants[0];
  const photo = (id: string, imageUri: string, date: string, changes: Partial<PlantPhoto> = {}): PlantPhoto => ({
    id, plantId: plant.id, imageUri, date, time: '08:00', source: 'camera',
    purpose: 'reference', phase: plant.journey.phase, ...changes,
  });
  const photos = [photo('old', 'file:///old.jpg', '2026-10-20'), photo('blank', '', '2026-10-25'),
    photo('remote', 'https://private.example/photo.jpg', '2026-10-25'), photo('space', '  file:///space.jpg', '2026-10-25'),
    photo('wrong-plant', 'file:///other.jpg', '2026-10-25', { plantId: 'other' }),
    photo('wrong-stage', 'file:///fruit.jpg', '2026-10-25', { phase: 'planning' }),
    photo('new', 'content://media/new', '2026-10-24'), photo('newest', 'ph://asset/newest', '2026-10-25')];
  const order = photos.map((entry) => entry.id);
  assert.deepEqual(pickCurrentPhotos(plant, photos).map((entry) => entry.id), ['newest', 'new']);
  assert.deepEqual(photos.map((entry) => entry.id), order);
  assert.deepEqual(pickCurrentPhotos(plant, createGardenFixture().plantPhotos), []);
});

test('resizing bounds the long side, keeps small sources small and supports extreme panoramas', () => {
  assert.deepEqual(imageResize(4000, 3000), { width: 960, height: 720 });
  assert.deepEqual(imageResize(3000, 4000), { width: 720, height: 960 });
  assert.deepEqual(imageResize(200, 12000), { width: 16, height: 960 });
  assert.deepEqual(imageResize(12000, 1), { width: 960, height: 1 });
  assert.deepEqual(imageResize(200, 100), { width: 200, height: 100 });
  assert.deepEqual(imageResize(960, 960), { width: 960, height: 960 });
  assert.deepEqual(imageResize(4000, 3000, 768), { width: 768, height: 576 });
  assert.deepEqual(imageResize(100, 50, 768), { width: 100, height: 50 });
  for (const maximum of [0, 961, NaN, Infinity, 3.5]) assert.throws(() => imageResize(4000, 3000, maximum));
  for (const size of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => imageResize(size, 100));
});

test('image budgets use decoded bytes including base64 padding and sum repeated references', () => {
  const image = { mimeType: 'image/jpeg', base64: 'AAAA'.repeat(1024 * 1024 / 4) };
  // One shared object still appears eight separate times on the JSON wire.
  assert.equal(imagePayloadWithinBudget({ images: Array(8).fill(image) }), true);
  assert.equal(imagePayloadWithinBudget({ images: Array(11).fill(image) }), false);
  for (const base64 of ['AA==', 'AAA=', 'AAAA']) assert.equal(imagePayloadWithinBudget({ image: { base64 } }), true);
  for (const base64 of ['', 'A', 'A===', 'AA=A', 'AAAA!', 'data:image/jpeg;base64,AAAA']) {
    assert.equal(imagePayloadWithinBudget({ image: { base64 } }), false);
  }
});

test('JSON budget counts UTF-8 bytes, not UTF-16 string length', () => {
  assert.equal(imagePayloadWithinBudget({ text: 'a'.repeat(12 * 1024 * 1024 - 11) }), true);
  assert.equal(imagePayloadWithinBudget({ text: 'a'.repeat(12 * 1024 * 1024 - 10) }), false);
  assert.equal(imagePayloadWithinBudget({ text: '🌱'.repeat(3 * 1024 * 1024) }), false);
  assert.equal(imagePayloadWithinBudget({ text: 'ớ'.repeat(7 * 1024 * 1024) }), false);
});

test('exactly eight MiB of decoded image bytes fit but one extra byte does not', () => {
  const atLimit = Buffer.alloc(8 * 1024 * 1024).toString('base64');
  const overLimit = Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64');
  assert.equal(imagePayloadWithinBudget({ image: { base64: atLimit } }), true);
  assert.equal(imagePayloadWithinBudget({ image: { base64: overLimit } }), false);
});

test('cycles, unsupported JSON values and excessive nesting fail without throwing', () => {
  const cycle: { child?: unknown } = {};
  cycle.child = cycle;
  assert.equal(imagePayloadWithinBudget(cycle), false);
  assert.equal(imagePayloadWithinBudget({ value: BigInt(1) }), false);
  assert.equal(imagePayloadWithinBudget(undefined), false);
  let nested: unknown = {};
  for (let index = 0; index < 70; index++) nested = { nested };
  assert.equal(imagePayloadWithinBudget(nested), false);
  assert.equal(imagePayloadWithinBudget({ plant: { id: 'one' }, messages: [{ text: 'Đất còn ẩm.' }] }), true);
});
