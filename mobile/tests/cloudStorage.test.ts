/** Kiểm thử lưu và khôi phục dữ liệu đám mây, hàng đợi bền vững, thử lại và xử lý xung đột giữa thiết bị. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState } from '../src/data/seed';
import { CloudSyncError, type CloudSnapshot, type CloudSyncPort, type MailAction } from '../src/services/cloudSync';
import { createCloudStorage } from '../src/store/cloudStorage';
import { FRESH_START_EPOCH, STORAGE_KEY, saveStoredUserData, type StoredUserData, type UserStorage } from '../src/store/storageLifecycle';
import type { AppState } from '../src/types/app';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'one@example.com', username: 'Người trồng cây' };
const asset = '22222222-2222-4222-8222-222222222222';
const date = '2026-11-06T00:00:00.000Z';
let deviceSequence = 0;
function state() { const value = createInitialState(); value.auth = { loggedIn: true, remember: true, identity: user.email, userId: user.id }; return value; }
function server(initial: AppState | null = null) {
  let snapshot: CloudSnapshot = { revision: initial ? 1 : 0, state: initial, updatedAt: initial ? date : null };
  let offline = false; let loseNext = false; const receipts = new Map<string, CloudSnapshot>();
  let replayLatest = false;
  const saves: { requestId: string; revision: number; state: unknown }[] = []; const mails: MailAction[] = [];
  const uploads: unknown[] = []; const downloads: string[] = [];
  function online() { if (offline) throw new CloudSyncError('NETWORK', 'Mất mạng.'); }
  const api: CloudSyncPort = {
    getState: async () => { online(); return clone(snapshot); },
    saveState: async (_token, input) => {
      online(); saves.push(clone(input));
      if (receipts.has(input.requestId)) return replayLatest
        ? { ...clone(snapshot), replayed: true, appliedRevision: receipts.get(input.requestId)!.revision }
        : clone(receipts.get(input.requestId)!);
      if (input.revision !== snapshot.revision) throw new CloudSyncError('SYNC_CONFLICT', 'Đã thay đổi trên thiết bị khác.', 409);
      snapshot = { revision: snapshot.revision + 1, state: clone(input.state), updatedAt: date };
      receipts.set(input.requestId, clone(snapshot));
      if (loseNext) { loseNext = false; throw new CloudSyncError('NETWORK', 'Mất phản hồi.'); }
      return clone(snapshot);
    },
    uploadAsset: async (_token, input) => { online(); uploads.push(input); return { assetId: asset }; },
    getAsset: async (_token, id) => { online(); downloads.push(id); return { assetId: id, contentType: 'image/png', dataBase64: 'YWJjZA==', size: 4 }; },
    mailAction: async (_token, input) => {
      online(); mails.push(clone(input)); if (receipts.has(input.requestId)) return clone(receipts.get(input.requestId)!);
      if (input.revision !== snapshot.revision) throw new CloudSyncError('SYNC_CONFLICT', 'Xung đột.', 409);
      const next = clone(snapshot.state) as AppState;
      if (input.claimIds?.includes('publisher-letter')) next.economy.gold += 100;
      snapshot = { revision: snapshot.revision + 1, state: next, updatedAt: date }; receipts.set(input.requestId, clone(snapshot));
      if (loseNext) { loseNext = false; throw new CloudSyncError('NETWORK', 'Mất phản hồi.'); }
      return clone(snapshot);
    },
  };
  return { api, saves, mails, uploads, downloads, snapshot: () => clone(snapshot),
    publish: (id: string) => {
      const next = clone(snapshot.state) as AppState;
      // Real SQL places source last, unlike the mobile normalization order.
      next.mailbox = [...next.mailbox, { id, sourceRef: id, title: 'Thông báo mới', body: 'Xin chào', attachments: [], createdAt: date,
        readAt: null, claimedAt: null, source: 'publisher' }]; snapshot = { ...snapshot, state: next };
    },
    offline: (next: boolean) => { offline = next; }, lose: () => { loseNext = true; }, replayLatest: () => { replayLatest = true; } };
}
function device(remote: ReturnType<typeof server>, initial = state()) {
  const deviceId = ++deviceSequence;
  let record: StoredUserData = { storageEpoch: FRESH_START_EPOCH, state: initial, pendingPhotoCleanup: [] };
  const data = new Map<string, string>([[STORAGE_KEY, JSON.stringify(record)]]); let fail = false; let sequence = 0;
  const port: UserStorage = { getItem: async key => data.get(key) ?? null, setItem: async (key, value) => {
    if (fail) throw new Error('Disk full'); data.set(key, value);
  }, listPhotos: () => [], deletePhoto() {} };
  const files = { read: async (_uri: string) => ({ contentType: 'image/png', dataBase64: 'YWJjZA==' }),
    exists: (uri: string) => uri.startsWith('file:///cloud/'),
    write: async (_userId: string, input: { assetId: string }) => `file:///cloud/${input.assetId}.png` };
  function load() {
    record = JSON.parse(data.get(STORAGE_KEY)!) as StoredUserData;
    return createCloudStorage({ port, record, user: () => user, token: () => 'a'.repeat(43), api: remote.api, files,
      requestId: () => `device-${deviceId}-request-${++sequence}` });
  }
  return { load, data, fail: (value: boolean) => { fail = value; },
    save: async (cloud: ReturnType<typeof load>, update: (value: AppState) => void) => {
      const old = cloud.record(); const next = clone(old.state); update(next); await saveStoredUserData(cloud.port, old, next); return cloud.record();
    } };
}

test('first local save uploads private photos and all progress without authentication fields', async () => {
  const remote = server(); const local = state(); local.economy.gold = 71;
  local.plantPhotos = [{ id: 'photo', plantId: 'plant', imageUri: 'file:///private/photo.png', date: '2026-11-06', time: '12:00', source: 'camera', purpose: 'reference', phase: 'planning' }];
  const phone = device(remote, local); const cloud = phone.load(); await cloud.open();
  assert.equal(cloud.status().phase, 'synced'); assert.equal(remote.saves.length, 1);
  const saved = remote.snapshot().state as AppState; assert.equal('auth' in saved, false); assert.equal(saved.economy.gold, 71);
  assert.equal(saved.plantPhotos[0].imageUri, `pat-asset:${asset}`); assert.equal(remote.uploads.length, 1);
  assert.equal(JSON.stringify(remote.snapshot()).includes('file:///'), false);
});

test('another phone restores private images and data, backing up its local save before import', async () => {
  const initial = state(); initial.economy.gold = 98;
  initial.plantPhotos = [{ id: 'photo', plantId: 'plant', imageUri: `pat-asset:${asset}`, date: '2026-11-06', time: '12:00', source: 'camera', purpose: 'reference', phase: 'planning' }];
  initial.auth = { loggedIn: true, remember: true, identity: 'attacker@example.com', userId: 'forged' };
  const remote = server(initial); const phone = device(remote); const cloud = phone.load(); const loaded = await cloud.open();
  assert.equal(loaded.state.economy.gold, 98); assert.equal(loaded.state.auth.userId, user.id);
  assert.equal(loaded.state.plantPhotos[0].imageUri, `file:///cloud/${asset}.png`);
  assert.equal(remote.downloads.length, 1); assert.equal(remote.saves.length, 0);
  assert.equal([...phone.data.keys()].filter(key => key.startsWith('PAT_CLOUD_BACKUP')).length, 1);
});

test('lost PUT response replays immutable payload after restart, never spending twice', async () => {
  const remote = server(); const phone = device(remote); let cloud = phone.load(); await cloud.open();
  await phone.save(cloud, value => { value.economy.gold = 37; }); remote.lose();
  await assert.rejects(cloud.flush()); const pending = remote.saves.at(-1)!;
  assert.equal(remote.snapshot().revision, 2);
  cloud = phone.load(); await cloud.open();
  assert.equal(remote.saves.at(-1)!.requestId, pending.requestId);
  assert.deepEqual(remote.saves.at(-1)!.state, pending.state);
  assert.equal(remote.snapshot().revision, 2); assert.equal(cloud.record().state.economy.gold, 37);
});

test('offline local saves survive restart; first-sync ambiguity cannot overwrite a nonempty server', async () => {
  const remote = server(state()); remote.offline(true); const phone = device(remote); let cloud = phone.load(); await cloud.open();
  assert.equal(cloud.status().phase, 'offline'); await phone.save(cloud, value => { value.economy.gold = 19; });
  cloud = phone.load(); remote.offline(false); await cloud.open();
  assert.equal(cloud.status().phase, 'conflict'); assert.equal(cloud.record().state.economy.gold, 19);
  assert.equal(remote.saves.length, 0); assert.equal(cloud.blocked(), true);
  await cloud.refresh(true); assert.equal(cloud.record().state.economy.gold, 0); assert.equal(cloud.blocked(), false);
  assert.ok([...phone.data.values()].some(value => value.includes('user-confirmed-cloud-reload') && value.includes('19')));
});

test('retrying an offline outbox automatically preserves newer local edits and reuses its durable request', async () => {
  const remote = server(); const phone = device(remote); const cloud = phone.load(); await cloud.open();
  remote.offline(true);
  await phone.save(cloud, value => { value.economy.gold = 12; });
  await assert.rejects(cloud.flush());
  const pending = (cloud.record().cloudSync as { pending: { requestId: string; state: AppState } }).pending;
  assert.equal(pending.state.economy.gold, 12);
  await phone.save(cloud, value => { value.economy.gold = 25; });

  remote.offline(false);
  // The lifecycle's automatic retry calls the same flush operation as a manual
  // retry. It must finish the immutable old transaction before the newer edit.
  await cloud.flush();
  assert.equal(remote.saves.at(-2)!.requestId, pending.requestId);
  assert.equal((remote.saves.at(-2)!.state as AppState).economy.gold, 12);
  assert.equal((remote.saves.at(-1)!.state as AppState).economy.gold, 25);
  assert.equal((remote.snapshot().state as AppState).economy.gold, 25);
  assert.equal(cloud.record().state.economy.gold, 25);
  assert.equal(cloud.status().phase, 'synced');
  assert.equal((cloud.record().cloudSync as { pending: unknown; dirty: boolean }).pending, null);
  assert.equal((cloud.record().cloudSync as { dirty: boolean }).dirty, false);
});

test('a normal local edit is pending sync, not offline; real connectivity failure enables automatic retry', async () => {
  const remote = server(); const phone = device(remote); const cloud = phone.load(); await cloud.open();
  await phone.save(cloud, value => { value.economy.gold = 12; });
  assert.equal(cloud.status().phase, 'syncing');
  assert.equal(cloud.status().message, 'Đang đồng bộ…');
  assert.notEqual(cloud.status().retryable, true);
  remote.offline(true);
  await assert.rejects(cloud.flush());
  assert.equal(cloud.status().phase, 'offline');
  assert.equal(cloud.status().retryable, true);
  remote.offline(false);
  await cloud.flush();
  assert.equal(cloud.status().phase, 'synced');
  assert.notEqual(cloud.status().retryable, true);
});

test('only transient transport and server failures permit automatic retry, never conflict or authentication failures', async () => {
  for (const [code, status, expected] of [
    ['NETWORK', undefined, true], ['TIMEOUT', undefined, true], ['SYNC_BUSY', 409, true],
    ['SERVER_ERROR', 503, true], ['SERVER_ERROR', 400, false], ['SERVER_ERROR', undefined, false],
    ['AUTH_REQUIRED', 401, false], ['NOT_CONFIGURED', undefined, false],
    ['INVALID_RESPONSE', undefined, false], ['SYNC_CONFLICT', 409, false],
  ] as const) {
    const remote = server(); remote.api.getState = async () => { throw new CloudSyncError(code, code, status); };
    const cloud = device(remote).load(); await cloud.open();
    assert.equal(cloud.status().retryable, expected, code);
    assert.equal(cloud.blocked(), code === 'SYNC_CONFLICT', code);
  }
});

test('CAS conflict preserves both phones and explicit reload retains a local backup', async () => {
  const remote = server(state()); const a = device(remote), b = device(remote); const first = a.load(), second = b.load();
  await first.open(); await second.open(); await a.save(first, value => { value.economy.gold = 22; }); await first.flush();
  await b.save(second, value => { value.economy.gold = 33; }); await assert.rejects(second.flush());
  assert.equal(second.blocked(), true); assert.equal(second.record().state.economy.gold, 33);
  assert.equal((remote.snapshot().state as AppState).economy.gold, 22);
  await second.refresh(true); assert.equal(second.record().state.economy.gold, 22);
});

test('publisher claim flushes local progress, survives lost receipt, and never credits locally twice', async () => {
  const remote = server(); const phone = device(remote); let cloud = phone.load(); await cloud.open();
  await phone.save(cloud, value => { value.economy.gold = 25; }); await cloud.flush(); remote.lose();
  await assert.rejects(cloud.mail({ claimIds: ['publisher-letter'] }));
  assert.equal(cloud.blocked(), true); assert.equal(cloud.record().state.economy.gold, 25);
  cloud = phone.load(); await cloud.open();
  assert.equal(cloud.record().state.economy.gold, 125); assert.equal(remote.mails.length, 2);
  assert.equal(remote.mails[0].requestId, remote.mails[1].requestId); assert.equal(cloud.blocked(), false);
});

test('retrying a lost gift response in the same session credits its contents only once', async () => {
  const remote = server(); const phone = device(remote); const cloud = phone.load(); await cloud.open();
  remote.lose();
  await assert.rejects(cloud.mail({ claimIds: ['publisher-letter'] }));
  const revision = remote.snapshot().revision;
  assert.equal(cloud.blocked(), true);
  assert.equal(cloud.record().state.economy.gold, 0);
  await cloud.flush();
  assert.equal(remote.mails.length, 2);
  assert.equal(remote.mails[0].requestId, remote.mails[1].requestId);
  assert.equal(remote.snapshot().revision, revision);
  assert.equal((remote.snapshot().state as AppState).economy.gold, 100);
  assert.equal(cloud.record().state.economy.gold, 100);
  assert.equal(cloud.blocked(), false);
  assert.equal(cloud.status().phase, 'synced');
});

test('a replay followed by another phone update cannot use the latest revision to bypass CAS', async () => {
  const remote = server(); const phone = device(remote); const first = phone.load(); await first.open();
  await phone.save(first, value => { value.economy.gold = 20; }); remote.lose(); await assert.rejects(first.flush());
  const other = device(remote); const second = other.load(); await second.open();
  await other.save(second, value => { value.economy.gold = 30; }); await second.flush();
  await phone.save(first, value => { value.economy.gold = 40; }); remote.replayLatest();
  await assert.rejects(first.flush(), /Thiết bị khác/);
  assert.equal(first.record().state.economy.gold, 40); assert.equal(first.blocked(), true);
  assert.equal((remote.snapshot().state as AppState).economy.gold, 30);
});

test('a local edit made while checking newer cloud data blocks import without changing either save', async () => {
  const remote = server(state()); const phone = device(remote); const first = phone.load(); await first.open();
  const other = device(remote); const second = other.load(); await second.open();
  await other.save(second, value => { value.economy.gold = 55; }); await second.flush();
  await assert.rejects(first.refresh(false, () => false), /Cả hai thiết bị/);
  assert.equal(first.record().state.economy.gold, 0); assert.equal(first.blocked(), true);
  assert.equal((remote.snapshot().state as AppState).economy.gold, 55);
});

test('a disk failure cannot send an unrecorded cloud transaction', async () => {
  const remote = server(); const phone = device(remote); const cloud = phone.load(); await cloud.open();
  await phone.save(cloud, value => { value.economy.gold = 9; }); phone.fail(true);
  const count = remote.saves.length; await assert.rejects(cloud.flush(), /Disk full/);
  assert.equal(remote.saves.length, count); assert.equal((remote.snapshot().state as AppState).economy.gold, 0);
});

test('new publisher mail refreshes without any local edit even when publication keeps snapshot revision', async () => {
  const remote = server(state()); const phone = device(remote); const cloud = phone.load(); await cloud.open();
  const revision = remote.snapshot().revision; remote.publish('publisher-new');
  assert.equal(remote.snapshot().revision, revision);
  const refreshed = await cloud.refresh(); assert.equal(refreshed.state.mailbox[0]?.id, 'publisher-new');
  assert.equal(remote.saves.length, 0); assert.equal(cloud.status().phase, 'synced');
  const backups = [...phone.data.keys()].filter(key => key.startsWith('PAT_CLOUD_BACKUP')).length;
  await cloud.refresh();
  assert.equal([...phone.data.keys()].filter(key => key.startsWith('PAT_CLOUD_BACKUP')).length, backups);
  remote.publish('publisher-on-restart'); const restarted = phone.load(); const opened = await restarted.open();
  assert.equal(opened.state.mailbox.some(mail => mail.id === 'publisher-on-restart'), true);
  assert.equal(remote.saves.length, 0);
});

test('own PUT and cloud refresh preserve this installation music, while uploads exclude its local path', async () => {
  const remote = server(); const local = state(); local.settings.music = true; local.settings.musicConsent = true;
  local.settings.musicUri = 'file:///private/my-song.mp3'; local.settings.musicName = 'Bản nhạc của tôi';
  const phone = device(remote, local); const cloud = phone.load(); await cloud.open();
  await phone.save(cloud, value => { value.economy.gold = 5; }); await cloud.flush();
  await cloud.refresh();
  assert.equal(cloud.record().state.settings.musicUri, 'file:///private/my-song.mp3');
  assert.equal(cloud.record().state.settings.musicName, 'Bản nhạc của tôi');
  assert.equal(cloud.record().state.settings.music, true);
  assert.equal((remote.snapshot().state as AppState).settings.musicUri, null);
  const newPhone = device(remote); const restored = await newPhone.load().open();
  assert.equal(restored.state.settings.musicUri, null); assert.equal(restored.state.settings.musicName, null);
});
