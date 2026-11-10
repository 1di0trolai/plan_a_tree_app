/** Kiểm thử quyền sở hữu tài khoản và hợp đồng HTTP cho đồng bộ/hòm thư, lỗi xung đột và giới hạn yêu cầu. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../app.js';
import { ApiError } from '../contracts.js';

const session = 'A'.repeat(43);
const player = { id: 'verified-player', username: 'Người chăm vườn' };

async function server(t, options = {}) {
  const calls = [];
  const auth = { async me(value) {
    if (value !== session) throw new ApiError(401, 'AUTH_REQUIRED', 'Vui lòng đăng nhập lại.');
    return { user: player };
  } };
  const cloud = Object.fromEntries(['getState', 'saveState', 'uploadAsset', 'getAsset', 'listMail', 'updateMail'].map(method => [method,
    async (owner, body) => { calls.push({ method, owner, body }); return { method, revision: 1 }; },
  ]));
  const app = createApp({ token: 'shared-ai-token-not-a-player-session', auth, cloud, ...options });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); });
  const call = async (path, { method = 'GET', body, bearer = session, headers = {} } = {}) => {
    const response = await fetch(`http://127.0.0.1:${app.address().port}${path}`, {
      method, headers: { authorization: `Bearer ${bearer}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  return { call, calls };
}

test('sync and mailbox require an active PAT session, never the shared AI token', async t => {
  const { call, calls } = await server(t);
  for (const path of ['/api/sync/state', '/api/mailbox']) {
    assert.equal((await call(path, { bearer: '' })).status, 401);
    assert.equal((await call(path, { bearer: 'shared-ai-token-not-a-player-session' })).status, 401);
    assert.equal((await call(path, { bearer: 'B'.repeat(43) })).status, 401);
  }
  assert.equal(calls.length, 0);
  assert.equal((await call('/api/health')).body.status, 'ok');
});

test('all six cloud operations use the server-verified owner', async t => {
  const { call, calls } = await server(t);
  const assetId = '11223344-5566-7788-9900-aabbccddeeff';
  for (const [path, method, body, operation] of [
    ['/api/sync/state', 'GET', undefined, 'getState'],
    ['/api/sync/state', 'PUT', { revision: 0, userId: 'victim', state: {} }, 'saveState'],
    ['/api/sync/assets', 'POST', { userId: 'victim', dataBase64: 'bytes' }, 'uploadAsset'],
    [`/api/sync/assets/${assetId}`, 'GET', undefined, 'getAsset'],
    ['/api/mailbox', 'GET', undefined, 'listMail'],
    ['/api/mailbox/actions', 'POST', { userId: 'victim', readIds: ['one'] }, 'updateMail'],
  ]) {
    assert.equal((await call(path, { method, body })).status, 200);
    assert.equal(calls.at(-1).method, operation);
    assert.deepEqual(calls.at(-1).owner, player);
  }
  assert.equal(calls[3].body, assetId);
});

test('cloud routes reject incorrect methods, MIME and oversized bodies before mutations', async t => {
  const { call, calls } = await server(t, { maxBodyBytes: 128 });
  assert.equal((await call('/api/sync/state', { method: 'POST', body: {} })).status, 404);
  assert.equal((await call('/api/sync/assets', { method: 'GET' })).status, 404);
  assert.equal((await call('/api/mailbox', { method: 'DELETE' })).status, 404);
  assert.equal((await call('/api/sync/state', { method: 'PUT', body: {}, headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await call('/api/sync/state', { method: 'PUT', body: { data: 'x'.repeat(128) } })).status, 413);
  assert.equal((await call('/api/mailbox/actions', { method: 'POST', body: { data: 'x'.repeat(65536) } })).status, 413);
  assert.equal(calls.length, 0);
});

test('CAS conflicts expose only the safe current revision, not server internals', async t => {
  const error = new ApiError(409, 'SYNC_CONFLICT', 'Dữ liệu đã thay đổi trên thiết bị khác.');
  error.revision = 8;
  error.details = { revision: 8, sql: 'private database details' };
  const { call } = await server(t, { cloud: { async saveState() { throw error; } } });
  assert.deepEqual(await call('/api/sync/state', { method: 'PUT', body: {} }), {
    status: 409, body: { error: { code: 'SYNC_CONFLICT', message: error.message, revision: 8 } },
  });
});

test('failed sync releases concurrency and does not consume account-route capacity', async t => {
  let attempts = 0;
  const { call } = await server(t, { maxSyncConcurrent: 1, cloud: { async getState() {
    if (++attempts === 1) throw new Error('private failure');
    return { revision: 2 };
  } } });
  assert.equal((await call('/api/sync/state')).status, 500);
  assert.deepEqual(await call('/api/sync/state'), { status: 200, body: { revision: 2 } });
  assert.deepEqual((await call('/api/auth/me')).body.user, player);
});

test('admin handler is mounted before ordinary API routes without exposing cloud to public requests', async t => {
  const { call, calls } = await server(t, { adminHandler: async (req, res) => {
    if (req.url !== '/admin-test') return false;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ privateConsole: true }));
    return true;
  } });
  assert.deepEqual((await call('/admin-test', { bearer: '' })).body, { privateConsole: true });
  assert.equal((await call('/api/sync/state', { bearer: '' })).status, 401);
  assert.equal(calls.length, 0);
});
