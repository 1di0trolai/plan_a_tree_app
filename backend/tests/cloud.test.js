/** Kiểm thử bản lưu, ảnh riêng tư, xung đột phiên bản và nhận thư/quà đúng một lần bằng kho đồng bộ giả. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCloudService, validateCloudAsset, validateCloudState } from '../cloud.js';
import { overlayPublisherMail } from '../mailbox.js';

const user = { id: '11111111-1111-4111-8111-111111111111' };
const other = { id: '22222222-2222-4222-8222-222222222222' };
const admin = { id: '33333333-3333-4333-8333-333333333333' };
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0X8AAAAASUVORK5CYII=';
function state() {
  return { version: 5, auth: { loggedIn: true, identity: 'private@example.invalid' }, profile: { name: 'Người trồng cây', avatarImageUri: null },
    plants: [], checkIns: [], plantPhotos: [], plantAnalyses: [], plantChibis: [], chatMessages: [], careEvents: [], dailyRounds: [], dailyPacks: [],
    economy: { gold: 10 }, mailbox: [], activePlantId: '', inventory: { pets: [], items: [{ id: 'berry-bites', quantity: 1 }] },
    settings: { musicUri: 'file:///private/music.mp3', musicName: 'my file' }, daily: {}, battleNotify: false };
}

function fixture() {
  const records = new Map(), receipts = new Map(), assets = new Map(), publications = new Map();
  let queue = Promise.resolve();
  const get = id => structuredClone(records.get(id) ?? { revision: 0, state: null, updatedAt: null, mailbox: [] });
  const exclusive = work => { const result = queue.then(work); queue = result.catch(() => {}); return result; };
  const repository = {
    read: async id => get(id),
    mutate: (id, receipt, reduce) => exclusive(async () => {
      const key = `${id}:${receipt.requestId}`, previous = receipts.get(key);
      if (previous) {
        if (previous.digest !== receipt.digest || previous.operation !== receipt.operation) throw Object.assign(new Error('reused'), { code: 'REQUEST_ID_REUSED', status: 409 });
        const current = get(id);
        return { ...current, state: overlayPublisherMail(current.state, current.mailbox), mailbox: current.mailbox.filter(mail => !mail.deletedAt), appliedRevision: previous.revision, replayed: true };
      }
      const result = await reduce(get(id));
      records.set(id, structuredClone(result.record)); receipts.set(key, { ...receipt, revision: result.response.revision });
      return { ...result.response, appliedRevision: result.response.revision, replayed: false };
    }),
    async assertAssets(id, ids) { if (ids.some(asset => assets.get(asset)?.userId !== id)) throw Object.assign(new Error('private'), { code: 'ASSET_NOT_FOUND', status: 400 }); },
    async putAsset(userId, value) {
      const existing = [...assets.values()].find(asset => asset.userId === userId && asset.sha256 === value.sha256);
      if (existing) return existing;
      const asset = { ...value, userId, id: randomUUID() }; assets.set(asset.id, asset); return asset;
    },
    async getAsset(id, assetId) { const asset = assets.get(assetId); return asset?.userId === id ? asset : undefined; },
    async listUsers() { return [user, other].map(entry => ({ ...entry, email: 'person@example.invalid', username: 'Người trồng cây' })); },
    async publish(value) {
      const key = `${value.adminId}:${value.requestId}`, previous = publications.get(key);
      if (previous) {
        if (previous.digest !== value.digest) throw Object.assign(new Error('reused'), { code: 'REQUEST_ID_REUSED' });
        return { ...previous.response, replayed: true };
      }
      const id = randomUUID(), users = value.target === 'all' ? [user.id, other.id] : value.userIds;
      for (const userId of users) {
        const current = get(userId);
        current.mailbox.push({ id: randomUUID(), source: 'publisher', sourceRef: id, title: value.title, body: value.body,
          attachments: value.attachments, createdAt: value.createdAt, readAt: null, claimedAt: null, deletedAt: null });
        records.set(userId, current);
      }
      const response = { publicationId: id, recipientCount: users.length };
      publications.set(key, { digest: value.digest, response }); return { ...response, replayed: false };
    },
    async listPublications() { return []; },
  };
  return { service: createCloudService({ repository, now: () => new Date('2026-11-06T01:00:00Z') }), records, receipts };
}

test('first cloud upload strips auth/device audio, restores complete state on another session and isolates accounts', async () => {
  const { service } = fixture();
  assert.equal((await service.getState(user)).state, null);
  const input = state(); input.careEvents.push({ id: 'care', note: 'Đã tưới', plantId: 'tree' });
  const saved = await service.saveState(user, { revision: 0, requestId: 'upload_first', state: input });
  assert.equal(saved.revision, 1); assert.equal(saved.state.auth, undefined);
  assert.equal(saved.state.settings.musicUri, null); assert.equal(saved.state.settings.musicName, null);
  assert.equal(input.settings.musicUri, 'file:///private/music.mp3');
  assert.deepEqual((await service.getState({ ...user })).state.careEvents, input.careEvents);
  assert.equal((await service.getState(other)).state, null);
});

test('CAS prevents stale-phone overwrite and request IDs make lost-response retry idempotent', async () => {
  const { service } = fixture(), input = state();
  const first = await service.saveState(user, { revision: 0, requestId: 'save_first1', state: input });
  const retry = await service.saveState(user, { revision: 0, requestId: 'save_first1', state: input });
  assert.equal(retry.replayed, true); assert.equal(retry.revision, 1); assert.equal(retry.appliedRevision, 1);
  const changed = state(); changed.economy.gold = 42;
  await assert.rejects(service.saveState(user, { revision: 0, requestId: 'save_first2', state: changed }), { code: 'SYNC_CONFLICT', revision: 1 });
  await assert.rejects(service.saveState(user, { revision: 0, requestId: 'save_first1', state: changed }), { code: 'REQUEST_ID_REUSED' });
  const race = await Promise.allSettled([service.saveState(user, { revision: first.revision, requestId: 'save_race_1', state: changed }),
    service.saveState(user, { revision: first.revision, requestId: 'save_race_2', state: input })]);
  assert.equal(race.filter(entry => entry.status === 'fulfilled').length, 1);
  assert.equal((await service.getState(user)).state.economy.gold, 42);
  // A very late retry returns current balance, not its old 10-gold response.
  const lateReplay = await service.saveState(user, { revision: 0, requestId: 'save_first1', state: input });
  assert.equal(lateReplay.state.economy.gold, 42);
  // Client must treat this as a conflict while it has queued local edits.
  assert.equal(lateReplay.appliedRevision, 1); assert.equal(lateReplay.revision, 2);
});

test('private photo upload is deduplicated by owner/hash and rejects forged, foreign and local URI references', async () => {
  const { service } = fixture();
  const asset = await service.uploadAsset(user, { contentType: 'image/png', dataBase64: png });
  assert.equal((await service.uploadAsset(user, { contentType: 'image/png', dataBase64: png })).assetId, asset.assetId);
  const fetched = await service.getAsset(user, asset.assetId);
  assert.equal(fetched.dataBase64, png); assert.equal(fetched.base64, undefined);
  await assert.rejects(service.getAsset(other, asset.assetId), { status: 404 });
  const input = state(); input.plantPhotos.push({ imageUri: `pat-asset:${asset.assetId}` });
  await service.saveState(user, { revision: 0, requestId: 'save_photos1', state: input });
  await assert.rejects(service.saveState(other, { revision: 0, requestId: 'save_photos2', state: input }), { code: 'ASSET_NOT_FOUND' });
  input.plantPhotos[0].imageUri = 'file:///phone/private.jpg';
  assert.throws(() => validateCloudState(input), { code: 'INVALID_REQUEST' });
  assert.throws(() => validateCloudAsset({ contentType: 'image/jpeg', dataBase64: png }), { code: 'INVALID_REQUEST' });
  assert.throws(() => validateCloudAsset({ contentType: 'image/svg+xml', dataBase64: Buffer.from('<svg/>').toString('base64') }), { code: 'INVALID_REQUEST' });
  assert.throws(() => validateCloudAsset({ contentType: 'image/png', dataBase64: png + '=' }), { code: 'INVALID_REQUEST' });
});

test('publisher delivery is durable and cannot be forged, edited, silently removed or preclaimed from snapshots', async () => {
  const { service } = fixture();
  await service.saveState(user, { revision: 0, requestId: 'save_for_mail', state: state() });
  const sent = await service.publishMail(admin, { requestId: 'publish_once', target: 'all', title: 'Quà mới', body: 'Chúc bạn chăm cây vui vẻ!', attachments: [{ kind: 'gold', quantity: 50 }] });
  assert.equal(sent.recipientCount, 2);
  const again = await service.publishMail(admin, { requestId: 'publish_once', target: 'all', title: 'Quà mới', body: 'Chúc bạn chăm cây vui vẻ!', attachments: [{ kind: 'gold', quantity: 50 }] });
  assert.equal(again.replayed, true); assert.equal((await service.listMail(user)).mailbox.length, 1);
  const current = await service.getState(user), real = current.state.mailbox[0];
  current.state.mailbox = [{ ...real, title: 'forged', claimedAt: '2026-01-01', attachments: [{ kind: 'gold', quantity: 999999 }] },
    { ...real, id: randomUUID(), sourceRef: 'fake', source: 'publisher' }];
  const saved = await service.saveState(user, { revision: 1, requestId: 'save_editmail', state: current.state });
  assert.equal(saved.state.mailbox.length, 1); assert.equal(saved.state.mailbox[0].title, 'Quà mới');
  assert.equal(saved.state.mailbox[0].claimedAt, null); assert.equal(saved.state.economy.gold, 10);
});

test('mail gift claims atomically credit one time, CAS protects another phone and deleted letters stay deleted', async () => {
  const { service } = fixture();
  await service.saveState(user, { revision: 0, requestId: 'save_claim01', state: state() });
  await service.publishMail(admin, { requestId: 'publish_claim', target: 'users', userIds: [user.id], title: 'Quà', body: 'Mời nhận', attachments: [{ kind: 'gold', quantity: 50 }, { kind: 'food', itemId: 'berry-bites', quantity: 3 }] });
  const mailId = (await service.listMail(user)).mailbox[0].id;
  await assert.rejects(service.updateMail(user, { revision: 1, requestId: 'delete_early', deleteIds: [mailId] }), { code: 'MAIL_UNCLAIMED' });
  assert.equal((await service.getState(user)).revision, 1);
  const claims = await Promise.allSettled([service.updateMail(user, { revision: 1, requestId: 'claim_first1', claimIds: [mailId] }),
    service.updateMail(user, { revision: 1, requestId: 'claim_second', claimIds: [mailId] })]);
  assert.equal(claims.filter(value => value.status === 'fulfilled').length, 1);
  const claim = claims.find(value => value.status === 'fulfilled').value;
  assert.equal(claim.state.economy.gold, 60); assert.equal(claim.state.inventory.items[0].quantity, 4);
  const repeated = await service.updateMail(user, { revision: 2, requestId: 'claim_again1', claimIds: [mailId] });
  assert.equal(repeated.state.economy.gold, 60); assert.equal(repeated.state.inventory.items[0].quantity, 4);
  const deleted = await service.updateMail(user, { revision: 3, requestId: 'delete_claim', deleteIds: [mailId] });
  assert.deepEqual(deleted.state.mailbox, []); assert.deepEqual((await service.listMail(user)).mailbox, []);
  await assert.rejects(service.updateMail(other, { revision: 0, requestId: 'claim_stolen', claimIds: [mailId] }), { code: 'SYNC_REQUIRED' });
});

test('secrets, malformed requests and unsupported gift catalogs are rejected before writes', async () => {
  const { service, records } = fixture();
  const input = state(); input.profile.password = 'must-not-backup';
  assert.throws(() => validateCloudState(input), { code: 'INVALID_REQUEST' });
  await assert.rejects(service.saveState(user, { revision: -1, requestId: 'badrequest1', state: state() }), { code: 'INVALID_REQUEST' });
  await assert.rejects(service.getState({ id: 'fake' }), { status: 401 });
  await assert.rejects(service.publishMail(admin, { requestId: 'publish_bad1', target: 'users', userIds: [user.id], title: 'Quà', body: 'Quà', attachments: [{ kind: 'food', itemId: 'fake-item', quantity: 1 }] }), { code: 'INVALID_REQUEST' });
  assert.equal(records.size, 0);
});
