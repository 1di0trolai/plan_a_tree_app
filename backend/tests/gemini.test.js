/** Kiểm thử bộ kết nối Gemini bằng HTTP giả: định dạng lời nhắc/ảnh, thời gian chờ, hủy yêu cầu và phân loại lỗi an toàn. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiProvider } from '../gemini.js';
import { validateRequest } from '../contracts.js';
import { image, plant, identity } from './fixtures.js';

test('Gemini adapter posts inline images and schema to only the official endpoint', async () => {
  let captured;
  const provider = createGeminiProvider({ key: 'fake-key', model: 'developer-selected-model', fetchImpl: async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(identity) }] } }] }));
  } });
  assert.deepEqual(await provider('identify', { image }), identity);
  assert.equal(captured.url, 'https://generativelanguage.googleapis.com/v1beta/models/developer-selected-model:generateContent');
  const body = JSON.parse(captured.options.body);
  assert.deepEqual(body.contents[0].parts.at(-1), { inlineData: { mimeType: image.mimeType, data: image.base64 } });
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.responseJsonSchema.type, 'object');
  assert.equal(body.generationConfig.responseJsonSchema.properties.guide.maxItems, 3);
  assert.equal(body.generationConfig.maxOutputTokens, 2048);
  assert.match(body.contents[0].parts[0].text, /Khế/);
  assert.match(body.contents[0].parts[0].text, /other KHÔNG đồng nghĩa/);
  assert.equal(captured.url.includes('fake-key'), false);
});

test('recognition prompt does not mistake one available profile or a known species for individual identity', async () => {
  let body;
  const result = { decision: 'unknown', candidateIds: [], explanation: 'Chưa có dấu hiệu nhận ra đúng cá thể.' };
  const provider = createGeminiProvider({ key: 'fake-key', model: 'test-model', fetchImpl: async (_url, options) => {
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(result) }] } }] }));
  } });
  assert.deepEqual(await provider('recognize', { image, candidates: [{ plant, images: [image] }] }), result);
  const task = body.contents[0].parts[0].text;
  assert.match(task, /một phần của vườn/);
  assert.match(task, /không chọn candidate chỉ vì danh sách có duy nhất một cây/);
  assert.match(task, /không coi nhận ra tên loài là đủ/);
  assert.match(task, /người dùng phải xác nhận/);
});

test('Gemini 3+ uses low thinking for mobile latency without sending unsupported minimal or changing older models', async () => {
  for (const model of ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3-flash-preview', 'gemini-4-argon', 'gemini-2.5-flash']) {
    let config;
    const provider = createGeminiProvider({ key: 'fake-key', model, fetchImpl: async (_url, options) => {
      config = JSON.parse(options.body).generationConfig;
      return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(identity) }] } }] }));
    } });
    await provider('identify', { image });
    assert.deepEqual(config.thinkingConfig, model.startsWith('gemini-2.') ? undefined : { thinkingLevel: 'low' });
    assert.equal(config.maxOutputTokens, 2048);
    assert.equal(config.responseMimeType, 'application/json');
  }
});

test('provider access and missing model failures have distinct sanitized actions', async () => {
  for (const [status, code] of [[401, 'AI_ACCESS_DENIED'], [403, 'AI_ACCESS_DENIED'], [404, 'AI_MODEL_UNAVAILABLE']]) {
    const provider = createGeminiProvider({ key: 'fake', model: 'test-model', fetchImpl: async () => new Response('private provider body', { status }) });
    await assert.rejects(() => provider('identify', { image }), error => error.status === 502 && error.code === code && !error.message.includes('private'));
  }
});

test('Gemini timeout is abortable and returns a safe 504', async () => {
  const provider = createGeminiProvider({ key: 'fake', model: 'test-model', timeoutMs: 10, fetchImpl: async (_url, options) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 1000);
      options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal.reason); }, { once: true });
    });
  } });
  await assert.rejects(() => provider('identify', { image }), { status: 504, code: 'AI_TIMEOUT' });
});

test('a transport AbortError is not mislabeled as our provider deadline', async () => {
  const diagnostics = [];
  const provider = createGeminiProvider({ key: 'fake', model: 'test-model', onDiagnostic: event => diagnostics.push(event), fetchImpl: async () => {
    throw Object.assign(new Error('private upstream information'), { name: 'AbortError' });
  } });
  await assert.rejects(() => provider('identify', { image }), error =>
    error.status === 502 && error.code === 'AI_UPSTREAM_NETWORK' && !error.message.includes('private'));
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].stage, 'waiting_headers');
  assert.equal(diagnostics[0].outcome, 'AI_UPSTREAM_NETWORK');
});

test('Gemini stages and input counts are logged safely without bodies, keys, names or upstream text', async () => {
  const diagnostics = [];
  let body;
  const secretName = 'PRIVATE PLANT NAME';
  const result = { content: 'Kiểm tra đất trước.', questions: [], limitations: [] };
  const provider = createGeminiProvider({ key: 'private-provider-key', model: 'gemini-3.6-flash', onDiagnostic: event => diagnostics.push(event), fetchImpl: async (_url, options) => {
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(result) }] } }] }));
  } });
  const request = validateRequest('chat', {
    plant: { ...plant, name: secretName }, referenceImages: [image], referencePhotoDates: ['2026-10-29 10:00'],
    messages: [{ role: 'user', text: 'PRIVATE USER QUESTION' }],
  });
  assert.deepEqual(await provider('chat', request), result);
  assert.equal(body.generationConfig.maxOutputTokens, 2048);
  assert.equal(body.generationConfig.responseJsonSchema.properties.questions.maxItems, 1);
  assert.match(body.contents[0].parts[0].text, /1200 ký tự/);
  assert.ok(body.contents[0].parts.some(part => part.text?.includes('2026-10-29 10:00')));
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].stage, 'complete');
  assert.equal(diagnostics[0].outcome, 'JSON_PARSED');
  assert.equal(diagnostics[0].imageCount, 1);
  assert.deepEqual(diagnostics[0].imageFormats, ['image/png']);
  assert.equal(diagnostics[0].messageCount, 1);
  assert.equal(diagnostics[0].status, 200);
  const logged = JSON.stringify(diagnostics);
  for (const secret of [secretName, 'PRIVATE USER QUESTION', 'private-provider-key', image.base64])
    assert.equal(logged.includes(secret), false);
});

test('provider diagnostics describe JSON parsing only, and a logging callback cannot break success', async () => {
  const provider = createGeminiProvider({ key: 'fake', model: 'test-model', onDiagnostic: () => { throw new Error('logging unavailable'); }, fetchImpl: async () => new Response(JSON.stringify({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(identity) }] } }],
  })) });
  assert.deepEqual(await provider('identify', { image }), identity);
});

test('provider body-reading timeouts are classified distinctly from successful response headers', async () => {
  const diagnostics = [];
  const provider = createGeminiProvider({ key: 'fake', model: 'test-model', timeoutMs: 10, onDiagnostic: event => diagnostics.push(event), fetchImpl: async (_url, options) => ({
    ok: true, status: 200,
    text: () => new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('test guard')), 1000);
      options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal.reason); }, { once: true });
    }),
  }) });
  await assert.rejects(() => provider('identify', { image }), { status: 504, code: 'AI_TIMEOUT' });
  assert.equal(diagnostics[0].stage, 'reading_response');
  assert.equal(diagnostics[0].status, 200);
  assert.equal(diagnostics[0].outcome, 'AI_TIMEOUT');
});

test('token exhaustion has its own retry action instead of pretending to be a timeout', async () => {
  const provider = createGeminiProvider({ key: 'fake', model: 'test-model', fetchImpl: async () => new Response(JSON.stringify({
    candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"content":' }] } }],
  })) });
  await assert.rejects(() => provider('identify', { image }), { status: 502, code: 'AI_OUTPUT_INCOMPLETE' });
});

test('Gemini error body is never forwarded, including 429/quota errors', async () => {
  for (const status of [400, 401, 403, 429, 500]) {
    const provider = createGeminiProvider({ key: 'fake', model: 'test-model', fetchImpl: async () => new Response('private upstream echo', { status }) });
    await assert.rejects(() => provider('identify', { image }), error => error.status === (status === 429 ? 429 : 502) && !error.message.includes('private'));
  }
});

test('Gemini 503 is a provider outage, not invalid credentials, quota or a disconnected backend', async () => {
  const diagnostics = [];
  const provider = createGeminiProvider({ key: 'fake', model: 'test-model', onDiagnostic: event => diagnostics.push(event), fetchImpl: async () => new Response(JSON.stringify({
    error: { code: 503, status: 'UNAVAILABLE', message: 'PRIVATE USER CONTENT and credential' },
  }), { status: 503 }) });
  await assert.rejects(() => provider('identify', { image }), error =>
    error.status === 502 && error.code === 'AI_PROVIDER_UNAVAILABLE'
    && error.message.includes('HTTP 503 · UNAVAILABLE')
    && !error.message.includes('PRIVATE') && !error.message.includes('API key'));
  assert.equal(diagnostics[0].stage, 'reading_error');
  assert.equal(diagnostics[0].status, 503);
  assert.equal(diagnostics[0].providerStatus, 'UNAVAILABLE');
  assert.equal(diagnostics[0].outcome, 'AI_PROVIDER_UNAVAILABLE');
  assert.equal(JSON.stringify(diagnostics).includes('PRIVATE'), false);
});

test('canonical provider failures have actionable codes without forwarding arbitrary details', async () => {
  const cases = [
    [400, 'INVALID_ARGUMENT', undefined, 'AI_REQUEST_REJECTED', 502],
    [400, 'FAILED_PRECONDITION', undefined, 'AI_PROJECT_PRECONDITION', 502],
    [400, 'INVALID_ARGUMENT', 'API_KEY_INVALID', 'AI_ACCESS_DENIED', 502],
    [400, 'FAILED_PRECONDITION', 'BILLING_DISABLED', 'AI_BILLING_REQUIRED', 502],
    [403, 'PERMISSION_DENIED', 'BILLING_DISABLED', 'AI_BILLING_REQUIRED', 502],
    [402, undefined, undefined, 'AI_BILLING_REQUIRED', 502],
    [500, 'INTERNAL', undefined, 'AI_PROVIDER_UNAVAILABLE', 502],
    [504, 'DEADLINE_EXCEEDED', undefined, 'AI_TIMEOUT', 504],
  ];
  for (const [status, providerStatus, reason, code, expectedStatus] of cases) {
    const diagnostics = [];
    const provider = createGeminiProvider({ key: 'fake', model: 'test-model', onDiagnostic: event => diagnostics.push(event), fetchImpl: async () => new Response(JSON.stringify({ error: {
      code: status, status: providerStatus, message: 'PRIVATE question or image', details: [
        { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason, metadata: { private: 'PRIVATE metadata' } },
      ],
    } }), { status }) });
    await assert.rejects(() => provider('identify', { image }), error =>
      error.code === code && error.status === expectedStatus && error.message.includes(`HTTP ${status}`) && !error.message.includes('PRIVATE'));
    assert.equal(diagnostics[0].providerStatus, providerStatus);
    assert.equal(diagnostics[0].providerReason, reason);
    assert.equal(JSON.stringify(diagnostics).includes('PRIVATE'), false);
  }
});

test('unknown Google status/reason, spoofed detail types and oversized errors cannot enter diagnostics', async () => {
  for (const body of [
    JSON.stringify({ error: { status: 'PRIVATE status', message: 'PRIVATE message', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'PRIVATE reason' }] } }),
    JSON.stringify({ error: { details: [{ '@type': 'PRIVATE type', reason: 'API_KEY_INVALID' }] } }),
    JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'PRIVATE'.repeat(10000) } }),
    'PRIVATE invalid JSON',
  ]) {
    const diagnostics = [];
    const provider = createGeminiProvider({ key: 'fake', model: 'test-model', onDiagnostic: event => diagnostics.push(event), fetchImpl: async () => new Response(body, { status: 400 }) });
    await assert.rejects(() => provider('identify', { image }), { status: 502, code: 'AI_REQUEST_REJECTED' });
    assert.equal(diagnostics[0].providerStatus, undefined);
    assert.equal(diagnostics[0].providerReason, undefined);
    assert.equal(JSON.stringify(diagnostics).includes('PRIVATE'), false);
  }
});

test('provider error bodies are cancelled when they exceed the bounded diagnostic read', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(16385)); },
    cancel() { cancelled = true; },
  });
  const provider = createGeminiProvider({ key: 'fake', model: 'test-model', fetchImpl: async () => new Response(body, { status: 503 }) });
  await assert.rejects(() => provider('identify', { image }), { code: 'AI_PROVIDER_UNAVAILABLE' });
  assert.equal(cancelled, true);
});

test('non-streaming error bodies are not buffered for diagnostics', async () => {
  let read = false;
  const provider = createGeminiProvider({ key: 'fake', model: 'test-model', fetchImpl: async () => ({
    ok: false, status: 503, body: null,
    text: async () => { read = true; return 'PRIVATE unbounded error'; },
  }) });
  await assert.rejects(() => provider('identify', { image }), { code: 'AI_PROVIDER_UNAVAILABLE' });
  assert.equal(read, false);
});

test('error-body reads preserve deadline and caller cancellation semantics', async () => {
  for (const callerCancelled of [false, true]) {
    const caller = new AbortController();
    let markReady;
    const ready = new Promise(resolve => { markReady = resolve; });
    const diagnostics = [];
    const provider = createGeminiProvider({ key: 'fake', model: 'test-model', timeoutMs: callerCancelled ? 1000 : 20,
      onDiagnostic: event => diagnostics.push(event),
      fetchImpl: async (_url, options) => new Response(new ReadableStream({
        start(controller) {
          options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true });
          markReady();
        },
      }), { status: 503 }),
    });
    const keepAlive = setTimeout(() => {}, 1000);
    try {
      const pending = provider('identify', { image }, { signal: caller.signal });
      await ready;
      await new Promise(resolve => setImmediate(resolve));
      if (callerCancelled) caller.abort();
      await assert.rejects(() => pending, callerCancelled
        ? { status: 499, code: 'REQUEST_CANCELLED' }
        : { status: 504, code: 'AI_TIMEOUT' });
      assert.equal(diagnostics[0].stage, 'reading_error');
    } finally { clearTimeout(keepAlive); }
  }
});

test('Gemini truncated, blocked and invalid JSON responses fail closed', async () => {
  for (const body of ['not-json', JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{}' }] } }] }), JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{broken' }] } }] })]) {
    const provider = createGeminiProvider({ key: 'fake', model: 'test-model', fetchImpl: async () => new Response(body) });
    await assert.rejects(() => provider('identify', { image }), { status: 502 });
  }
});

test('Gemini requires explicit key and model, rejects URL/path injection in model name', () => {
  assert.equal(createGeminiProvider({ key: 'fake' }), null);
  assert.equal(createGeminiProvider({ model: 'test-model' }), null);
  assert.equal(createGeminiProvider({ key: 'fake', model: '../../evil?key=oops' }), null);
});

test('caller cancellation is propagated to the provider fetch without waiting for its server timeout', async () => {
  const controller = new AbortController();
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  let providerSignal;
  const provider = createGeminiProvider({ key: 'fake', model: 'test-model', fetchImpl: async (_url, options) => {
    providerSignal = options.signal;
    started();
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  } });
  const operation = provider('identify', { image }, { signal: controller.signal });
  const rejected = assert.rejects(operation, { status: 499, code: 'REQUEST_CANCELLED' });
  await ready;
  controller.abort();
  await rejected;
  assert.equal(providerSignal.aborted, true);
});
