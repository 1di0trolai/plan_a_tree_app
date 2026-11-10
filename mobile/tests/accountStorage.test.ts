/** Kiểm thử phân tách dữ liệu lưu theo tài khoản, nhập dữ liệu cũ an toàn và bảo toàn hàng đợi đồng bộ. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState } from '../src/data/seed';
import { accountStorage, loadAccountData } from '../src/store/accountStorage';
import { FRESH_START_EPOCH, STORAGE_KEY, type StoredUserData, type UserStorage } from '../src/store/storageLifecycle';
const a = { id: '11111111-1111-4111-8111-111111111111', email: 'a@example.com', username: 'Người trồng cây' };
const b = { ...a, id: '22222222-2222-4222-8222-222222222222', email: 'b@example.com' };
function fixture() {
  const data = new Map<string, string>(); const deleted: string[] = [];
  let fail = false;
  const port: UserStorage = { getItem: async key => data.get(key) ?? null,
    setItem: async (key, value) => { if (fail && key.includes('PAT_ACCOUNT_V1')) throw new Error('Disk'); data.set(key, value); },
    listPhotos: () => { throw new Error('Must not enumerate unrelated photos'); }, deletePhoto: uri => { deleted.push(uri); } };
  const state = createInitialState(); state.auth.identity = a.email; state.economy.gold = 123;
  const legacy: StoredUserData = { storageEpoch: FRESH_START_EPOCH, state, pendingPhotoCleanup: [] };
  return { data, port, legacy, deleted, fail: (value: boolean) => { fail = value; } };
}
test('matching account keeps legacy progress once; other accounts get separate fresh saves', async () => {
  const f = fixture(), first = await loadAccountData(f.port, a, f.legacy);
  assert.equal(first.record.state.economy.gold, 123); assert.equal(first.record.state.profile.name, a.username);
  const other = await loadAccountData(f.port, b, f.legacy);
  assert.equal(other.record.state.economy.gold, 0); assert.equal(other.record.state.auth.identity, b.email);
  first.record.state.economy.gold = 456; await first.port.setItem(STORAGE_KEY, JSON.stringify(first.record));
  assert.equal((await loadAccountData(f.port, a, f.legacy)).record.state.economy.gold, 456);
  assert.equal(f.legacy.state.economy.gold, 123); assert.deepEqual(f.deleted, []);
});
test('failed import can retry without another account taking the legacy backup', async () => {
  const f = fixture(); f.fail(true); await assert.rejects(loadAccountData(f.port, a, f.legacy)); f.fail(false);
  assert.equal((await loadAccountData(f.port, { ...b, email: a.email }, f.legacy)).record.state.economy.gold, 0);
  assert.equal((await loadAccountData(f.port, a, f.legacy)).record.state.economy.gold, 123);
});
test('corrupt or misowned namespaced data fails closed and is never overwritten', async () => {
  const f = fixture(), port = accountStorage(f.port, a.id);
  await port.setItem(STORAGE_KEY, '{bad'); await assert.rejects(loadAccountData(f.port, a, f.legacy));
  assert.equal(await port.getItem(STORAGE_KEY), '{bad');
  assert.throws(() => accountStorage(f.port, '../wrong'));
});
test('account hydration preserves the durable cloud outbox and never resets its revision', async () => {
  const f = fixture(); const loaded = await loadAccountData(f.port, a, f.legacy);
  const marker = { version: 1, revision: 7, generation: 9, dirty: true, pending: { requestId: 'pending-exact-payload' } };
  await loaded.port.setItem(STORAGE_KEY, JSON.stringify({ ...loaded.record, cloudSync: marker }));
  const reopened = await loadAccountData(f.port, a, f.legacy);
  assert.deepEqual(reopened.record.cloudSync, marker);
  assert.equal(reopened.record.state.economy.gold, 123);
});
