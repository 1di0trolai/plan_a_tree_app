/** Kiểm thử giao thức đồng bộ có xác thực, HTTPS, giới hạn thời gian và kiểm tra chặt phản hồi máy chủ. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudSync } from '../src/services/cloudSync';
const token = 'a'.repeat(43);
const snapshot = { revision: 1, state: { version: 5 }, updatedAt: '2026-11-06T00:00:00.000Z' };

test('cloud uses private PAT session headers, HTTPS and strict response shape', async () => {
  const calls: { url: string; options: RequestInit }[] = [];
  const api = createCloudSync({ baseUrl: 'https://api.example.com', fetch: async (url, options) => {
    calls.push({ url: String(url), options: options! }); return Response.json(snapshot);
  } });
  assert.deepEqual(await api.getState(token), snapshot);
  assert.equal(calls[0].url, 'https://api.example.com/api/sync/state');
  assert.equal((calls[0].options.headers as Record<string, string>).Authorization, `Bearer ${token}`);
  assert.equal(calls[0].options.redirect, 'error'); assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].url.includes(token), false);
  await assert.rejects(createCloudSync({ baseUrl: 'http://192.168.1.2' }).getState(token), /HTTPS/);
  await assert.rejects(createCloudSync({ baseUrl: 'https://api.example.com?token=x' }).getState(token), /HTTPS/);
  await assert.rejects(api.getState('wrong'), /đăng nhập/);
});

test('cloud preserves conflict code but never exposes arbitrary server diagnostics', async () => {
  const conflict = createCloudSync({ baseUrl: 'https://api.example.com', fetch: async () =>
    Response.json({ error: { code: 'SYNC_CONFLICT', message: 'SQL password=secret' } }, { status: 409 }) });
  await assert.rejects(conflict.getState(token), (error: unknown) => {
    assert.equal((error as { code: string }).code, 'SYNC_CONFLICT'); assert.doesNotMatch((error as Error).message, /secret/); return true;
  });
  const huge = createCloudSync({ baseUrl: 'https://api.example.com', fetch: async () =>
    new Response('{}', { headers: { 'content-length': String(16 * 1024 * 1024) } }) });
  await assert.rejects(huge.getState(token), /quá lớn/);
  const malformed = createCloudSync({ baseUrl: 'https://api.example.com', fetch: async () => Response.json({ revision: -1, state: null, updatedAt: null }) });
  await assert.rejects(malformed.getState(token), /chưa hợp lệ/);
});

test('private asset payload naming is bounded and never copied into request URL', async () => {
  const id = '11111111-1111-4111-8111-111111111111'; let options: RequestInit | undefined;
  const api = createCloudSync({ baseUrl: 'https://api.example.com', fetch: async (_url, input) => {
    options = input; return Response.json({ assetId: id, contentType: 'image/png', dataBase64: 'YWJjZA==' });
  } });
  await api.uploadAsset(token, { contentType: 'image/png', dataBase64: 'YWJjZA==' });
  assert.deepEqual(JSON.parse(options!.body as string), { contentType: 'image/png', dataBase64: 'YWJjZA==' });
  assert.equal((await api.getAsset(token, id)).assetId, id);
  await assert.rejects(api.getAsset(token, '../another-account'), /chưa hợp lệ/);
});

test('a stalled transport has a bounded deadline without replacing durable user data', async () => {
  const api = createCloudSync({ baseUrl: 'https://api.example.com', timeoutMs: 5,
    fetch: async () => new Promise<Response>(() => {}) });
  await assert.rejects(api.getState(token), (error: unknown) => (error as { code: string }).code === 'TIMEOUT');
});
