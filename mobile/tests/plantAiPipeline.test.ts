/** Kiểm thử chuẩn bị ảnh, gửi yêu cầu trợ lý, hủy và hết thời gian, kèm dọn tài nguyên tạm an toàn. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';

import * as lifecycle from '../src/services/aiRequestLifecycle';
import * as contracts from '../src/services/plantAiContracts';
import { PHASE_LABELS } from '../src/store/journeyActions';
import * as scanRecognition from '../src/utils/scanRecognition';
import type { CareEvent, Plant, PlantAnalysisRecord, PlantChatMessage, PlantPhoto } from '../src/types/app';
import { createGardenFixture } from './fixtures/gardenFixture';
import { viI18n } from './fixtures/i18nFixture';

const compiled = ts.transpileModule(
  readFileSync(resolve(__dirname, '../src/services/plantAi.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

type PlantAiModule = typeof import('../src/services/plantAi');
const identity = {
  crop: 'other', label: 'Khế', species: 'Averrhoa carambola', phase: 'planning',
  summary: 'Có thể là quả khế. Hãy xác nhận tên và giai đoạn.',
  guide: ['Chọn hạt có nguồn rõ ràng hoặc cây giống.'], warnings: [],
};
const tick = () => new Promise<void>((resolveTick) => setImmediate(resolveTick));

function deferred<T>() {
  let complete!: (value: T) => void;
  const promise = new Promise<T>((resolveValue) => { complete = resolveValue; });
  return { promise, complete };
}

function mockAi(options: {
  dimensions?: Promise<{ width: number; height: number }>;
  dimensionsAt?: (uri: string) => Promise<{ width: number; height: number }>;
  save?: Promise<{ uri: string; base64: string }>;
  base64?: string;
  fetch?: typeof fetch;
  configured?: boolean;
} = {}) {
  const api = {} as PlantAiModule;
  const deleted: string[] = [];
  const dimensions: string[] = [];
  const decoded: unknown[] = [];
  const requests: { url: string; options: RequestInit }[] = [];
  const released: string[] = [];
  const source = 'file:///photos/source.jpg';
  const temporary = 'file:///cache/manipulator/prepared.jpg';
  class MockFile {
    uri: string;
    constructor(uri: string) { this.uri = uri; }
    get exists() { return true; }
    delete() { deleted.push(this.uri); }
  }
  runInNewContext(compiled, {
    exports: api, __DEV__: true,
    process: { env: options.configured === false ? {} : {
      EXPO_PUBLIC_PAT_API_URL: 'http://local-proxy.test:3001',
      EXPO_PUBLIC_PAT_API_TOKEN: 'fake-test-token',
    } },
    URL, console: { info: () => undefined },
    fetch: async (url: string, request: RequestInit) => {
      requests.push({ url, options: request });
      return options.fetch ? options.fetch(url, request)
        : new Response(JSON.stringify({ mode: 'gemini', result: identity }));
    },
    require: (name: string) => {
      if (name === './aiRequestLifecycle') return lifecycle;
      if (name === '../i18n/core') return viI18n;
      if (name === './plantAiContracts') return contracts;
      if (name === '../store/journeyActions') return { PHASE_LABELS };
      if (name === '../utils/scanRecognition') return scanRecognition;
      if (name === 'expo-file-system') return { File: MockFile, Paths: { cache: { uri: 'file:///cache' } } };
      if (name === 'react-native') return { Image: { getSize: async (uri: string) => {
        dimensions.push(uri);
        return options.dimensionsAt ? options.dimensionsAt(uri) : options.dimensions ?? { width: 4000, height: 3000 };
      } } };
      if (name === 'expo-image-manipulator') return { SaveFormat: { JPEG: 'jpeg' }, ImageManipulator: {
        manipulate: (uri: string, bounds: unknown) => {
          decoded.push({ uri, bounds });
          return {
            resize: (size: unknown) => decoded.push(size), release: () => released.push('context'),
            renderAsync: async () => ({
              saveAsync: async () => options.save ?? { uri: temporary, base64: options.base64 ?? 'AAAA' },
              release: () => released.push('rendered'),
            }),
          };
        },
      } };
      throw new Error(`Unexpected native import: ${name}`);
    },
  }, { filename: 'plantAi.native-mock.js' });
  return { api, source, temporary, deleted, dimensions, decoded, requests, released };
}

test('identify keeps a free starfruit name and reports preparation before the real request', async () => {
  const ai = mockAi();
  const progress: lifecycle.AiProgress[] = [];
  const result = await ai.api.identifyPhoto(ai.source, { onProgress: (phase) => progress.push(phase) });
  assert.equal(result.crop, 'other');
  assert.equal(result.label, 'Khế');
  assert.equal(result.species, 'Averrhoa carambola');
  assert.equal(result.phase, 'planning');
  assert.deepEqual(progress, ['preparing', 'requesting']);
  assert.equal(ai.requests.length, 1);
  const body = JSON.parse(ai.requests[0].options.body as string);
  assert.deepEqual(body, { image: { mimeType: 'image/jpeg', base64: 'AAAA' } });
  assert.equal(ai.requests[0].options.signal?.aborted, false);
  assert.deepEqual(ai.deleted, [ai.temporary]);
  assert.deepEqual(ai.released, ['rendered', 'context']);
  assert.equal(JSON.stringify(body).includes(ai.source), false);
});

test('cancellation before preparation performs no native decoding or upload', async () => {
  const ai = mockAi();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(ai.api.identifyPhoto(ai.source, { signal: controller.signal }), { code: 'CANCELLED' });
  assert.deepEqual(ai.dimensions, []);
  assert.equal(ai.requests.length, 0);
});

test('cancelling a native preparation releases the UI and cleans up its eventual temporary file', async () => {
  const saved = deferred<{ uri: string; base64: string }>();
  const ai = mockAi({ save: saved.promise });
  const controller = new AbortController();
  const operation = ai.api.identifyPhoto(ai.source, { signal: controller.signal });
  await tick();
  const cancelled = assert.rejects(operation, { code: 'CANCELLED' });
  controller.abort();
  await cancelled;
  assert.equal(ai.requests.length, 0);
  saved.complete({ uri: ai.temporary, base64: 'AAAA' });
  await tick();
  assert.equal(ai.requests.length, 0);
  assert.deepEqual(ai.deleted, [ai.temporary]);
  assert.deepEqual(ai.released, ['rendered', 'context']);
  assert.equal(ai.deleted.includes(ai.source), false);
});

test('the total timeout includes a slow native image-size lookup, not just fetch', async () => {
  const dimensions = deferred<{ width: number; height: number }>();
  const ai = mockAi({ dimensions: dimensions.promise });
  const progress: lifecycle.AiProgress[] = [];
  await assert.rejects(ai.api.identifyPhoto(ai.source, {
    timeoutMs: 10, onProgress: (phase) => progress.push(phase),
  }), { code: 'TIMEOUT' });
  assert.deepEqual(progress, ['preparing']);
  dimensions.complete({ width: 100, height: 100 });
  await tick();
  assert.deepEqual(ai.decoded, []);
  assert.equal(ai.requests.length, 0);
});

test('cancellation aborts the request signal and is not shown as a Wi-Fi or timeout error', async () => {
  let networkSignal: AbortSignal | undefined;
  const ai = mockAi({ fetch: async (_url, request) => {
    networkSignal = request?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      networkSignal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  } });
  const controller = new AbortController();
  const operation = ai.api.identifyPhoto(ai.source, { signal: controller.signal });
  await tick();
  assert.ok(networkSignal);
  const cancelled = assert.rejects(operation, { code: 'CANCELLED' });
  controller.abort();
  await cancelled;
  assert.equal(networkSignal.aborted, true);
});

test('missing configuration and bad bearer-token responses stay actionable without echoing private errors', async () => {
  const missing = mockAi({ configured: false });
  await assert.rejects(missing.api.identifyPhoto(missing.source), { code: 'NOT_CONFIGURED' });
  assert.equal(missing.dimensions.length, 0);
  const unauthorized = mockAi({ fetch: async () => new Response(JSON.stringify({
    error: { code: 'UNAUTHORIZED', message: 'private upstream echo' },
  }), { status: 401 }) });
  await assert.rejects(unauthorized.api.identifyPhoto(unauthorized.source), (error: unknown) =>
    error instanceof lifecycle.AiServiceError && error.code === 'UNAUTHORIZED'
      && error.message.includes('người quản lý ứng dụng') && !error.message.includes('private'));
});

test('the public service still fails closed on non-AI mode and invalid free species/phase output', async () => {
  for (const body of [
    { mode: 'demo', result: identity },
    { mode: 'gemini', result: { ...identity, phase: 'fruit' } },
    { mode: 'gemini', result: { ...identity, species: '' } },
  ]) {
    const ai = mockAi({ fetch: async () => new Response(JSON.stringify(body)) });
    await assert.rejects(ai.api.identifyPhoto(ai.source), { code: 'INVALID_RESPONSE' });
    assert.deepEqual(ai.deleted, [ai.temporary]);
  }
});

function recognitionGarden(count: number) {
  const sample = createGardenFixture().plants[0];
  const plants: Plant[] = Array.from({ length: count }, (_, index) => ({ ...sample, id: `plant-${index}` }));
  const photos: PlantPhoto[] = plants.map((plant) => ({
    id: `photo-${plant.id}`, plantId: plant.id, imageUri: `file:///photos/${plant.id}.jpg`,
    date: '2026-10-26', time: '10:00', source: 'camera', purpose: 'reference', phase: plant.journey.phase,
  }));
  return { plants, photos };
}

function recognitionResponse(decision: 'candidate' | 'ambiguous' | 'unknown' | 'retake', candidateIds: string[] = []) {
  return new Response(JSON.stringify({ mode: 'gemini', result: {
    decision, candidateIds, explanation: 'Đối chiếu ảnh và xác nhận đúng hồ sơ.',
  } }));
}

test('recognition checks every referenced garden plant beyond six and encodes the scan image only once', async () => {
  const { plants, photos } = recognitionGarden(8);
  const batches: string[][] = [];
  const ai = mockAi({ fetch: async (_url, request) => {
    const ids = JSON.parse(request?.body as string).candidates.map((entry: { plant: { id: string } }) => entry.plant.id);
    batches.push(ids);
    return ids.includes(plants[7].id) ? recognitionResponse('candidate', [plants[7].id]) : recognitionResponse('unknown');
  } });
  const result = await ai.api.recognizePhoto(ai.source, plants, photos);
  assert.deepEqual(batches.map((batch) => batch.length), [6, 2]);
  assert.deepEqual(batches.flat(), plants.map((plant) => plant.id));
  assert.equal(result.decision, 'candidate');
  assert.deepEqual(result.candidateIds, [plants[7].id]);
  assert.equal(ai.dimensions.filter((uri) => uri === ai.source).length, 1);
});

test('recognition merges matches across batches as ambiguous instead of returning the first match', async () => {
  const { plants, photos } = recognitionGarden(8);
  const ai = mockAi({ fetch: async (_url, request) => {
    const candidates = JSON.parse(request?.body as string).candidates;
    return recognitionResponse('candidate', [candidates[0].plant.id]);
  } });
  const result = await ai.api.recognizePhoto(ai.source, plants, photos);
  assert.equal(result.decision, 'ambiguous');
  assert.deepEqual(result.candidateIds, [plants[0].id, plants[6].id]);
});

test('recognition excludes archived profiles and explains missing current-phase references', async () => {
  const { plants, photos } = recognitionGarden(3);
  plants[0].archived = true;
  photos[1].phase = 'planning';
  const ai = mockAi({ fetch: async () => recognitionResponse('candidate', [plants[2].id]) });
  const result = await ai.api.recognizePhoto(ai.source, plants, photos);
  const candidates = JSON.parse(ai.requests[0].options.body as string).candidates;
  assert.deepEqual(candidates.map((candidate: { plant: { id: string } }) => candidate.plant.id), [plants[2].id]);
  assert.match(result.explanation, /1 hồ sơ chưa có ảnh đúng giai đoạn/);
  assert.equal(ai.dimensions.includes(photos[0].imageUri), false);
  assert.equal(ai.dimensions.includes(photos[1].imageUri), false);
});

test('empty or reference-less gardens fail with NO_REFERENCES without an AI request or fake unknown', async () => {
  const { plants } = recognitionGarden(1);
  for (const garden of [[], plants]) {
    const ai = mockAi();
    await assert.rejects(ai.api.recognizePhoto(ai.source, garden, []), { code: 'NO_REFERENCES' });
    assert.equal(ai.requests.length, 0);
    assert.equal(ai.dimensions.length, 0);
  }
});

test('a later batch network failure rejects the whole scan rather than returning an earlier match', async () => {
  const { plants, photos } = recognitionGarden(8);
  let requestCount = 0;
  const ai = mockAi({ fetch: async () => {
    if (++requestCount === 1) return recognitionResponse('candidate', [plants[0].id]);
    throw new Error('network unavailable');
  } });
  await assert.rejects(ai.api.recognizePhoto(ai.source, plants, photos), { code: 'NETWORK' });
  assert.equal(requestCount, 2);
});

test('cancelling a later recognition batch returns CANCELLED and never the earlier candidate', async () => {
  const { plants, photos } = recognitionGarden(8);
  const startedSecond = deferred<void>();
  const controller = new AbortController();
  let requestCount = 0;
  const ai = mockAi({ fetch: async (_url, request) => {
    if (++requestCount === 1) return recognitionResponse('candidate', [plants[0].id]);
    startedSecond.complete();
    return new Promise<Response>((_resolve, reject) => {
      request!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  } });
  const operation = ai.api.recognizePhoto(ai.source, plants, photos, { signal: controller.signal });
  await startedSecond.promise;
  const cancelled = assert.rejects(operation, { code: 'CANCELLED' });
  controller.abort();
  await cancelled;
  assert.equal(requestCount, 2);
  assert.equal(ai.requests[1].options.signal?.aborted, true);
});

test('each recognition response is restricted to that batch, not merely any garden ID', async () => {
  const { plants, photos } = recognitionGarden(8);
  const ai = mockAi({ fetch: async () => recognitionResponse('candidate', [plants[0].id]) });
  await assert.rejects(ai.api.recognizePhoto(ai.source, plants, photos), { code: 'INVALID_RESPONSE' });
  assert.equal(ai.requests.length, 2);
});

test('a later retake decision clears an earlier candidate and preserves retry guidance', async () => {
  const { plants, photos } = recognitionGarden(8);
  let requestCount = 0;
  const ai = mockAi({ fetch: async () => ++requestCount === 1
    ? recognitionResponse('candidate', [plants[0].id]) : recognitionResponse('retake') });
  const result = await ai.api.recognizePhoto(ai.source, plants, photos);
  assert.equal(result.decision, 'retake');
  assert.deepEqual(result.candidateIds, []);
});

test('all recognition batches share one total timeout instead of resetting it per request', async () => {
  const { plants, photos } = recognitionGarden(8);
  let requestCount = 0;
  const ai = mockAi({ fetch: async (_url, request) => {
    if (++requestCount === 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      return recognitionResponse('candidate', [plants[0].id]);
    }
    return new Promise<Response>((_resolve, reject) => {
      request!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  } });
  await assert.rejects(ai.api.recognizePhoto(ai.source, plants, photos, { timeoutMs: 50 }), { code: 'TIMEOUT' });
  assert.equal(requestCount, 2);
  assert.equal(ai.requests[0].options.signal, ai.requests[1].options.signal);
});

test('large reference images split below the upload budget without ignoring garden candidates', async () => {
  const { plants, photos } = recognitionGarden(6);
  const twoPerPlant = photos.flatMap((photo) => [photo, { ...photo, id: `${photo.id}-extra`, time: '11:00' }]);
  const ai = mockAi({ base64: 'A'.repeat(1_400_000), fetch: async () => recognitionResponse('unknown') });
  const result = await ai.api.recognizePhoto(ai.source, plants, twoPerPlant);
  assert.equal(result.decision, 'unknown');
  const bodies = ai.requests.map((request) => JSON.parse(request.options.body as string));
  assert.deepEqual(bodies.map((body) => body.candidates.length), [3, 3]);
  assert.equal(bodies.every((body) => contracts.imagePayloadWithinBudget(body)), true);
  assert.deepEqual(bodies.flatMap((body) => body.candidates.map((entry: { plant: { id: string } }) => entry.plant.id)), plants.map((plant) => plant.id));
});

test('chat uses bounded journal context and can answer without an unreadable optional reference', async () => {
  const { plants: [plant], photos } = recognitionGarden(1);
  const ai = mockAi({
    dimensionsAt: async () => { throw new Error('missing old cached photo'); },
    fetch: async () => new Response(JSON.stringify({ mode: 'gemini', result: {
      content: 'Hãy kiểm tra độ ẩm đất trước khi tưới.', questions: [], limitations: [],
    } })),
  });
  const result = await ai.api.chatWithPlant(plant, photos, [], [], [], 'Hôm nay cần làm gì?');
  assert.equal(ai.requests.length, 1);
  assert.match(ai.requests[0].url, /\/api\/chat$/);
  const body = JSON.parse(ai.requests[0].options.body as string);
  assert.deepEqual(body.referenceImages, []);
  assert.deepEqual(body.photoContext, { selected: 1, unavailable: 1 });
  assert.deepEqual(body.messages, [{ role: 'user', text: 'Hôm nay cần làm gì?' }]);
  assert.match(result.content, /1 ảnh nhật ký gần đây không đọc được/);
  assert.match(result.content, /không dựa trên các ảnh đó/);
  assert.equal(JSON.stringify(body).includes(photos[0].imageUri), false);
});

test('chat keeps the upstream error code but presents localized public copy without server details', async () => {
  const { plants: [plant] } = recognitionGarden(1);
  const message = 'Dịch vụ Gemini tạm thời gặp lỗi (HTTP 503 · UNAVAILABLE). Hãy thử lại sau.';
  const ai = mockAi({ fetch: async () => new Response(JSON.stringify({
    error: { code: 'AI_PROVIDER_UNAVAILABLE', message },
  }), { status: 502 }) });
  await assert.rejects(() => ai.api.chatWithPlant(plant, [], [], [], [], 'Hôm nay cần làm gì?'), error =>
    error instanceof lifecycle.AiServiceError && error.code === 'AI_PROVIDER_UNAVAILABLE'
    && error.message === 'Dịch vụ trợ lý tạm thời gián đoạn. Vui lòng thử lại sau.');
  assert.equal(ai.requests.length, 1, 'do not silently issue more billable requests');
});

test('assistant errors never expose upstream configuration instructions or arbitrary error codes', async () => {
  for (const failure of [
    { status: 503, code: 'AI_NOT_CONFIGURED', expectedCode: 'AI_NOT_CONFIGURED' },
    { status: 500, code: { debug: 'secret' }, expectedCode: 'HTTP_500' },
  ]) {
    const ai = mockAi({ fetch: async () => new Response(JSON.stringify({ error: {
      code: failure.code, message: 'Set GEMINI_API_KEY=secret in .env; restart Expo with npm run api',
    } }), { status: failure.status }) });
    await assert.rejects(ai.api.identifyPhoto(ai.source), error => {
      assert.ok(error instanceof lifecycle.AiServiceError);
      assert.equal(error.code, failure.expectedCode);
      assert.doesNotMatch(error.message, /secret|\.env|Expo|npm|GEMINI_API_KEY/);
      return true;
    });
    assert.equal(ai.requests.length, 1);
  }
});

test('when an older optional photo fails, each remaining image keeps its own matching capture date', async () => {
  const { plants: [plant], photos } = recognitionGarden(1);
  const missing = { ...photos[0], id: 'missing-newer', imageUri: 'file:///photos/missing-newer.jpg', date: '2026-10-29' };
  const ai = mockAi({
    dimensionsAt: async uri => {
      if (uri === missing.imageUri) throw new Error('optional photo missing');
      return { width: 1200, height: 800 };
    },
    fetch: async () => new Response(JSON.stringify({ mode: 'gemini', result: { content: 'Kiểm tra đất trước.', questions: [], limitations: [] } })),
  });
  const reply = await ai.api.chatWithPlant(plant, [photos[0], missing], [], [], [], 'Hôm nay cần làm gì?');
  const body = JSON.parse(ai.requests[0].options.body as string);
  assert.equal(body.referenceImages.length, 1);
  assert.deepEqual(body.referencePhotoDates, ['2026-10-26 10:00']);
  assert.deepEqual(body.photoContext, { selected: 2, unavailable: 1 });
  assert.match(reply.content, /1 ảnh nhật ký gần đây không đọc được/);
});

test('chat includes only this plant latest two dated images and compact recent journal excerpts', async () => {
  const { plants: [plant], photos } = recognitionGarden(1);
  const stamp = (index: number) => `2026-10-${String(index + 1).padStart(2, '0')}`;
  const analyses: PlantAnalysisRecord[] = Array.from({ length: 25 }, (_, index) => ({
    id: `analysis-${index}`, plantId: plant.id, photoId: 'reference', date: stamp(index), time: '08:00', mode: 'gemini',
    result: { level: 'Chú ý', title: 'Ghi nhận', summary: `Quan sát ${index}`, actions: [] },
  }));
  const events: CareEvent[] = Array.from({ length: 25 }, (_, index) => ({
    id: `event-${index}`, plantId: plant.id, kind: 'observe', note: `Nhật ký ${index}`, createdAt: `${stamp(index)}T08:00:00.000Z`,
  }));
  const messages: PlantChatMessage[] = Array.from({ length: 25 }, (_, index) => ({
    id: `message-${index}`, plantId: plant.id, role: 'assistant', content: `Tin ${index}`, createdAt: `${stamp(index)}T09:00:00.000Z`, mode: 'gemini',
  }));
  const selectedPhotos = Array.from({ length: 4 }, (_, index) => ({ ...photos[0], id: `photo-${index}`, imageUri: `file:///photos/latest-${index}.jpg`, date: stamp(index) }));
  const otherPlant = { ...analyses[0], id: 'foreign-analysis', plantId: 'other-plant', result: { ...analyses[0].result, summary: 'PRIVATE OTHER PLANT' } };
  const ai = mockAi({ fetch: async () => new Response(JSON.stringify({ mode: 'gemini', result: { content: 'Kiểm tra độ ẩm.', questions: [], limitations: [] } })) });
  await ai.api.chatWithPlant(plant, [...selectedPhotos, { ...photos[0], plantId: 'other-plant' }], [...analyses, otherPlant],
    [...events, { ...events[0], plantId: 'other-plant', note: 'PRIVATE OTHER PLANT' }],
    [...messages, { ...messages[0], plantId: 'other-plant', content: 'PRIVATE OTHER PLANT' }], 'Câu hỏi hiện tại');
  const body = JSON.parse(ai.requests[0].options.body as string);
  assert.equal(body.referenceImages.length, 2);
  assert.deepEqual(body.referencePhotoDates, ['2026-10-04 10:00', '2026-10-03 10:00']);
  assert.deepEqual(ai.dimensions, [selectedPhotos[3].imageUri, selectedPhotos[2].imageUri]);
  assert.equal(body.history.length, contracts.CHAT_CONTEXT_LIMITS.analyses);
  assert.match(body.history[0].summary, /Quan sát 24/);
  assert.equal(body.careEvents.length, contracts.CHAT_CONTEXT_LIMITS.careEvents);
  assert.equal(body.careEvents[0].note, 'Nhật ký 24');
  assert.equal(body.messages.length, contracts.CHAT_CONTEXT_LIMITS.messages);
  assert.equal(body.messages.at(-1).text, 'Câu hỏi hiện tại');
  assert.equal(JSON.stringify(body).includes('PRIVATE OTHER PLANT'), false);
  assert.ok(ai.decoded.some(entry => (entry as { bounds?: { maxWidth: number } }).bounds?.maxWidth === 768));
});

test('chat shortens older text before upload but preserves the latest complete question and original journal', async () => {
  const { plants: [plant], photos } = recognitionGarden(1);
  const latestQuestion = 'Q'.repeat(3000);
  const analyses: PlantAnalysisRecord[] = Array.from({ length: 20 }, (_, index) => ({
    id: `a-${index}`, plantId: plant.id, photoId: photos[0].id, date: '2026-10-29', time: '10:00', mode: 'gemini',
    result: { level: 'Chú ý', title: 'Ghi nhận', summary: 'A'.repeat(1500), actions: [] },
  }));
  const events: CareEvent[] = Array.from({ length: 20 }, (_, index) => ({
    id: `e-${index}`, plantId: plant.id, kind: 'observe', note: 'E'.repeat(700), createdAt: '2026-10-29T10:00:00Z',
  }));
  const messages: PlantChatMessage[] = Array.from({ length: 20 }, (_, index) => ({
    id: `m-${index}`, plantId: plant.id, role: 'assistant', content: 'M'.repeat(3000), createdAt: '2026-10-29T10:00:00Z', mode: 'gemini',
  }));
  const ai = mockAi({ fetch: async () => new Response(JSON.stringify({ mode: 'gemini', result: { content: 'Kiểm tra đất trước.', questions: [], limitations: [] } })) });
  await ai.api.chatWithPlant(plant, photos, analyses, events, messages, latestQuestion);
  const body = JSON.parse(ai.requests[0].options.body as string);
  assert.equal(body.messages.at(-1).text, latestQuestion);
  assert.ok(body.messages.slice(0, -1).every((message: { text: string }) => message.text.length <= 600));
  assert.ok(body.history.every((entry: { summary: string }) => entry.summary.length <= 400));
  assert.ok(body.careEvents.every((entry: { note: string }) => entry.note.length <= 240));
  assert.ok(JSON.stringify({ ...body, referenceImages: [] }).length < 16000);
  assert.equal(analyses[0].result.summary.length, 1500);
  assert.equal(events[0].note.length, 700);
  assert.equal(messages[0].content.length, 3000);
  assert.equal(body.referenceImages.length, 1);
});

test('a fresh scan still uploads its current image when an optional older reference is missing', async () => {
  const { plants: [plant], photos } = recognitionGarden(1);
  const ai = mockAi({
    dimensionsAt: async (uri) => {
      if (uri === photos[0].imageUri) throw new Error('missing older photo');
      return { width: 800, height: 600 };
    },
    fetch: async () => new Response(JSON.stringify({ mode: 'gemini', result: {
      analysis: { level: 'Chú ý', title: 'Kiểm tra đất', summary: 'Quan sát ảnh mới.', actions: [] },
      questions: [], limitations: [],
    } })),
  });
  const result = await ai.api.analyzePhoto(ai.source, plant, [], [], photos);
  const body = JSON.parse(ai.requests[0].options.body as string);
  assert.equal(body.image.base64, 'AAAA');
  assert.deepEqual(body.referenceImages, []);
  assert.match(result.analysis.summary, /1 ảnh nhật ký gần đây không đọc được/);
  assert.deepEqual(ai.deleted, [ai.temporary]);
});

test('an unreadable current scan remains a failure and never uploads or creates a fake analysis', async () => {
  const { plants: [plant], photos } = recognitionGarden(1);
  const ai = mockAi({ dimensionsAt: async (uri) => {
    if (uri.includes('source')) throw new Error('missing current scan');
    return { width: 800, height: 600 };
  } });
  await assert.rejects(ai.api.analyzePhoto(ai.source, plant, [], [], photos), { code: 'PHOTO_UNREADABLE' });
  assert.equal(ai.requests.length, 0);
});

test('optional reference preparation never swallows cancellation or timeout', async () => {
  const { plants: [plant], photos } = recognitionGarden(1);
  const dimensions = deferred<{ width: number; height: number }>();
  const ai = mockAi({ dimensions: dimensions.promise });
  await assert.rejects(ai.api.chatWithPlant(plant, photos, [], [], [], 'Tôi cần làm gì?', { timeoutMs: 10 }), { code: 'TIMEOUT' });
  dimensions.complete({ width: 800, height: 600 });
  await tick();
  assert.equal(ai.requests.length, 0);
});
