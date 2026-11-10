/** Kiểm thử phát hiện cấu hình/địa chỉ hoặc mã máy chủ cũ, đồng thời bảo đảm kết quả chẩn đoán không rò rỉ bí mật. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkHealth, checkRuntime, inspectConfiguration } from '../diagnostics.js';

const server = { GEMINI_API_KEY: 'private-key', GEMINI_MODEL: 'developer-model', API_AUTH_TOKEN: 'private-developer-token-long-enough', API_HOST: '0.0.0.0', API_PORT: '3001' };
const mobile = { EXPO_PUBLIC_PAT_API_URL: 'http://192.168.1.176:3001', EXPO_PUBLIC_PAT_API_TOKEN: server.API_AUTH_TOKEN };

test('diagnostics detect a stale LAN address and token mismatch without exposing credentials', () => {
  const result = inspectConfiguration(server, mobile, ['192.168.1.185']);
  assert.equal(result.possibleStaleLanIp, true);
  assert.equal(result.tokensMatch, true);
  assert.equal(inspectConfiguration(server, { ...mobile, EXPO_PUBLIC_PAT_API_TOKEN: 'wrong' }, []).tokensMatch, false);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(server.GEMINI_API_KEY), false);
  assert.equal(serialized.includes(server.API_AUTH_TOKEN), false);
  assert.equal(serialized.includes(server.GEMINI_MODEL), false);
});

test('diagnostics recognize a current LAN IP, invalid URLs, loopback and missing configuration', () => {
  assert.equal(inspectConfiguration(server, mobile, ['192.168.1.176']).possibleStaleLanIp, false);
  assert.equal(inspectConfiguration(server, { ...mobile, EXPO_PUBLIC_PAT_API_URL: 'http://localhost:3001' }, []).phoneUsesLoopback, true);
  for (const url of ['not a URL with private-key', 'http://secret:private-key@host', 'https://host?key=private-key', 'file:///private-key']) {
    const result = inspectConfiguration(server, { ...mobile, EXPO_PUBLIC_PAT_API_URL: url }, []);
    assert.equal(result.endpoint, null);
    assert.equal(JSON.stringify(result).includes('private-key'), false);
  }
  assert.equal(inspectConfiguration({}, {}, []).configured, false);
  assert.equal(inspectConfiguration({ ...server, API_PORT: 'bad' }, mobile, []).localHealth, null);
});

test('health checks use only GET, filter unexpected response fields and sanitize failures', async () => {
  const result = await checkHealth('http://local.test/api/health', async (url, options) => {
    assert.equal(url, 'http://local.test/api/health');
    assert.equal(options.method, undefined);
    assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify({ status: 'ok', provider: 'gemini', configured: true, token: 'private-key' }));
  });
  assert.deepEqual(result, { reachable: true, status: 200, configured: true });
  assert.equal(JSON.stringify(result).includes('private-key'), false);
  assert.deepEqual(await checkHealth('http://local.test/api/health', async () => { throw new Error('private-key'); }), { reachable: false });
  assert.equal((await checkHealth('http://local.test', async () => new Response('{}'))).reachable, false);
});

test('authenticated runtime detects stale model/code and filters secrets from unexpected response fields', async () => {
  const expected = { model: 'gemini-3.6-flash', timeoutMs: 35000, revision: 'abcdef0123456789' };
  const call = async (body, status = 200) => checkRuntime('http://local.test', 'private-token', expected, async (url, options) => {
    assert.equal(url, 'http://local.test/api/runtime');
    assert.equal(options.headers.Authorization, 'Bearer private-token');
    return new Response(JSON.stringify(body), { status });
  });
  const healthy = await call({ provider: 'gemini', ...expected, secret: 'private-token' });
  assert.equal(healthy.restartRequired, false);
  assert.equal(healthy.activeModel, expected.model);
  assert.equal(JSON.stringify(healthy).includes('private-token'), false);
  assert.equal((await call({ provider: 'gemini', ...expected, model: 'gemini-old' })).restartRequired, true);
  assert.equal((await call({ provider: 'gemini', ...expected, revision: '0000000000000000' })).restartRequired, true);
  assert.deepEqual(await call({}, 404), { reachable: false, status: 404, restartRequired: true });
  assert.deepEqual(await call({ error: 'private-token' }, 401), { reachable: false, status: 401, restartRequired: false });
  const malformed = await call({ provider: 'gemini', ...expected, model: 'https://private-token' });
  assert.equal(malformed.reachable, false);
  assert.equal(JSON.stringify(malformed).includes('private-token'), false);
});
