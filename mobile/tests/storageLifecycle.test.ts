/** Kiểm thử vòng đời lưu trữ, di chuyển dữ liệu và dọn ảnh riêng tư theo trình tự an toàn khi có lỗi. */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createInitialState } from '../src/data/seed';
import { addCareEvent, appendPlantChat, createPlantJourney } from '../src/store/journeyActions';
import {
  clearStoredUserData, FRESH_START_EPOCH, loadStoredUserData, saveStoredUserData,
  statePhotoUris, STORAGE_KEY, LEGACY_PET_BACKUP_KEY, type StoredUserData, type UserStorage,
} from '../src/store/storageLifecycle';
import type { AppState } from '../src/types/app';
import { createPetInstance } from '../src/store/petCollection';
import { createGardenFixture } from './fixtures/gardenFixture';

const oldPhoto = 'file:///private/pat-check-ins/100-old.jpg';
const orphanPhoto = 'file:///private/pat-check-ins/101-orphan.jpg';
const newPhoto = 'file:///private/pat-check-ins/200-new.jpg';

function envelope(state = createInitialState(), pendingPhotoCleanup: string[] = []): StoredUserData {
  return { storageEpoch: FRESH_START_EPOCH, state, pendingPhotoCleanup };
}

function fakeStorage(initial: string | null, photos: string[] = []) {
  let raw = initial;
  let reads = 0;
  let lists = 0;
  let attempts = 0;
  let readError = false;
  let listError = false;
  let writeGate: Promise<void> | null = null;
  const files = new Set(photos);
  const events: string[] = [];
  const writes: StoredUserData[] = [];
  const deleted: string[] = [];
  const failWrites = new Set<number>();
  const failDeletes = new Set<string>();
  const backups = new Map<string, string>();
  const port: UserStorage = {
    getItem: async (key) => {
      assert.equal(key, STORAGE_KEY);
      reads++;
      events.push('read');
      if (readError) throw new Error('read failed');
      return raw;
    },
    setItem: async (key, value) => {
      if (key === LEGACY_PET_BACKUP_KEY) { backups.set(key, value); return; }
      assert.equal(key, STORAGE_KEY);
      const attempt = ++attempts;
      events.push(`write-attempt:${attempt}`);
      if (writeGate) await writeGate;
      if (failWrites.has(attempt)) throw new Error('write failed');
      raw = value;
      writes.push(JSON.parse(value) as StoredUserData);
      events.push(`write-saved:${attempt}`);
    },
    listPhotos: () => {
      lists++;
      events.push('list');
      if (listError) throw new Error('list failed');
      return [...files];
    },
    deletePhoto: (uri) => {
      events.push(`delete:${uri}`);
      if (failDeletes.has(uri)) throw new Error('delete failed');
      deleted.push(uri);
      files.delete(uri); // Already-deleted files are safe to retry.
    },
  };
  return {
    port, files, events, writes, deleted, failWrites, failDeletes, backups,
    raw: () => raw, reads: () => reads, lists: () => lists, attempts: () => attempts,
    failRead: () => { readError = true; },
    failList: () => { listError = true; },
    deferWrites: (gate: Promise<void>) => { writeGate = gate; },
  };
}

function newUserState(): AppState {
  const now = new Date('2026-10-26T03:00:00Z');
  const created = createPlantJourney(createInitialState(), {
    name: 'Ớt của Linh', species: 'Ớt', mode: 'gemini',
    journey: { crop: 'chili', phase: 'seedling', method: 'seedling', startedAt: now.toISOString(), location: 'Ban công', light: 'Nắng sáng', notes: 'Chậu thoát nước tốt' },
    photo: { imageUri: newPhoto, source: 'camera' }, assistantMessage: 'Hãy kiểm tra đất trực tiếp trước khi tưới.',
  }, now);
  let state = appendPlantChat(created.state, { plantId: created.plant.id, role: 'user', content: 'Đất còn ẩm hôm nay.', mode: 'gemini', photoId: created.state.plantPhotos[0].id }, now).state;
  state = addCareEvent(state, { plantId: created.plant.id, kind: 'observe', note: 'Chưa cần tưới.' }, now).state;
  state.auth = { loggedIn: true, remember: true, identity: 'linh@example.test' };
  state.profile = { ...state.profile, name: 'Linh', title: 'Vườn ban công', avatar: '🌱', avatarImageUri: 'file:///private/pat-check-ins/201-avatar.jpg' };
  state.inventory.pets = [{ ...createPetInstance('ladybug', 'my-ladybug'), level: 4, experience: 30 },
    createPetInstance('ladybug', 'my-other-ladybug')];
  state.inventory.items[0].quantity = 3;
  state.plantChibis[0].imageUri = 'file:///private/pat-check-ins/202-chibi.jpg';
  return state;
}

test('legacy raw state resets once and atomically saves epoch, empty state and the complete cleanup plan', async () => {
  const previous = JSON.stringify(createGardenFixture());
  const storage = fakeStorage(previous, [oldPhoto, orphanPhoto]);
  const reset = await loadStoredUserData(storage.port);
  assert.deepEqual(storage.writes[0], envelope(createInitialState(), [oldPhoto, orphanPhoto]));
  assert.deepEqual(storage.events.slice(0, 4), ['read', 'list', 'write-attempt:1', 'write-saved:1']);
  assert.ok(storage.events.indexOf(`delete:${oldPhoto}`) > storage.events.indexOf('write-saved:1'));
  assert.deepEqual(reset.state, createInitialState());
  assert.deepEqual(reset.pendingPhotoCleanup, []);
  assert.deepEqual(storage.deleted, [oldPhoto, orphanPhoto]);
  const writes = storage.writes.length;
  await loadStoredUserData(storage.port);
  assert.equal(storage.lists(), 1);
  assert.equal(storage.writes.length, writes);
  assert.deepEqual(storage.deleted, [oldPhoto, orphanPhoto]);
});

test('an absent record initializes once and does not skip orphaned private photo cleanup', async () => {
  const storage = fakeStorage(null, [orphanPhoto]);
  const loaded = await loadStoredUserData(storage.port);
  assert.deepEqual(storage.writes[0].pendingPhotoCleanup, [orphanPhoto]);
  assert.deepEqual(loaded.state, createInitialState());
  assert.deepEqual(storage.deleted, [orphanPhoto]);
  await loadStoredUserData(storage.port);
  assert.equal(storage.lists(), 1);
});

test('no photo deletion can occur while the atomic replacement write is unresolved', async () => {
  const storage = fakeStorage(JSON.stringify(createGardenFixture()), [oldPhoto]);
  let release = () => {};
  storage.deferWrites(new Promise<void>((resolve) => { release = resolve; }));
  const pending = clearStoredUserData(storage.port);
  await Promise.resolve();
  assert.deepEqual(storage.deleted, []);
  assert.equal(storage.writes.length, 0);
  assert.ok(storage.files.has(oldPhoto));
  release();
  await pending;
  assert.deepEqual(storage.deleted, [oldPhoto]);
});

test('new account, garden, conversation, pet progress and stock survive later loads without relisting photos', async () => {
  const state = newUserState();
  const storage = fakeStorage(JSON.stringify(envelope(state)), statePhotoUris(state));
  const first = await loadStoredUserData(storage.port);
  const second = await loadStoredUserData(storage.port);
  assert.deepEqual(first.state, state);
  assert.deepEqual(second.state, state);
  assert.equal(storage.reads(), 2);
  assert.equal(storage.lists(), 0);
  assert.equal(storage.attempts(), 0);
  assert.deepEqual(storage.deleted, []);
  assert.deepEqual([...storage.files], statePhotoUris(state));
});

test('read failure never becomes an empty account, overwrite, photo list or deletion', async () => {
  const initial = JSON.stringify(envelope(newUserState()));
  const storage = fakeStorage(initial, [newPhoto]);
  storage.failRead();
  await assert.rejects(loadStoredUserData(storage.port), /read failed/);
  assert.equal(storage.raw(), initial);
  assert.equal(storage.attempts(), 0);
  assert.equal(storage.lists(), 0);
  assert.deepEqual(storage.deleted, []);
});

test('listing failure leaves the legacy state and every photo untouched', async () => {
  const initial = JSON.stringify(createGardenFixture());
  const storage = fakeStorage(initial, [oldPhoto]);
  storage.failList();
  await assert.rejects(loadStoredUserData(storage.port), /list failed/);
  assert.equal(storage.raw(), initial);
  assert.equal(storage.attempts(), 0);
  assert.deepEqual(storage.deleted, []);
  assert.ok(storage.files.has(oldPhoto));
});

test('failed initial write never deletes photos or marks the reset complete', async () => {
  const initial = JSON.stringify(createGardenFixture());
  const storage = fakeStorage(initial, [oldPhoto]);
  storage.failWrites.add(1);
  await assert.rejects(loadStoredUserData(storage.port), /write failed/);
  assert.equal(storage.raw(), initial);
  assert.deepEqual(storage.deleted, []);
  assert.ok(storage.files.has(oldPhoto));
  storage.failWrites.clear();
  assert.deepEqual((await loadStoredUserData(storage.port)).state, createInitialState());
  assert.equal(storage.lists(), 2);
  assert.deepEqual(storage.deleted, [oldPhoto]);
});

test('corrupt JSON and a corrupt marked state fail without overwriting new user data', async () => {
  const valid = createInitialState();
  const missingPlants = Object.fromEntries(Object.entries(valid).filter(([key]) => key !== 'plants'));
  const malformedStates: unknown[] = [
    null, [], {}, { version: 3 }, missingPlants,
    { ...valid, version: 2 },
    { ...valid, plants: null },
    { ...valid, plantPhotos: {} },
    { ...valid, chatMessages: undefined },
    { ...valid, dailyPacks: 'not-an-array' },
    { ...valid, auth: null },
    { ...valid, profile: [] },
    { ...valid, settings: false },
    { ...valid, daily: null },
    { ...valid, inventory: {} },
    { ...valid, inventory: { ...valid.inventory, pets: null } },
    { ...valid, inventory: { ...valid.inventory, items: {} } },
  ];
  for (const initial of [
    '{broken',
    ...malformedStates.map((state) => JSON.stringify({ storageEpoch: FRESH_START_EPOCH, state })),
  ]) {
    const storage = fakeStorage(initial, [newPhoto]);
    await assert.rejects(loadStoredUserData(storage.port));
    assert.equal(storage.raw(), initial);
    assert.equal(storage.attempts(), 0);
    assert.equal(storage.lists(), 0);
    assert.deepEqual(storage.deleted, []);
  }
});

test('a corrupt marked cleanup plan is not silently discarded or overwritten', async () => {
  for (const pendingPhotoCleanup of [undefined, null, {}, 'not-an-array', [oldPhoto, 42]]) {
    const raw = JSON.stringify({ ...envelope(newUserState()), pendingPhotoCleanup });
    const storage = fakeStorage(raw, [oldPhoto]);
    await assert.rejects(loadStoredUserData(storage.port), /chờ xóa bị lỗi/);
    assert.equal(storage.raw(), raw);
    assert.equal(storage.attempts(), 0);
    assert.equal(storage.lists(), 0);
    assert.deepEqual(storage.deleted, []);
  }
});

test('failed cleanup retains a durable pending plan and retries it without deleting new records or photos', async () => {
  const storage = fakeStorage(JSON.stringify(createGardenFixture()), [oldPhoto, orphanPhoto]);
  storage.failDeletes.add(orphanPhoto);
  const reset = await loadStoredUserData(storage.port);
  assert.deepEqual(reset.pendingPhotoCleanup, [orphanPhoto]);
  assert.deepEqual((JSON.parse(storage.raw()!) as StoredUserData).pendingPhotoCleanup, [orphanPhoto]);
  const state = newUserState();
  for (const uri of statePhotoUris(state)) storage.files.add(uri);
  const saved = await saveStoredUserData(storage.port, reset, state);
  assert.deepEqual(saved.state, state);
  assert.deepEqual(saved.pendingPhotoCleanup, [orphanPhoto]);
  storage.failDeletes.clear();
  const retried = await loadStoredUserData(storage.port);
  assert.deepEqual(retried.state, state);
  assert.deepEqual(retried.pendingPhotoCleanup, []);
  assert.equal(storage.lists(), 1);
  assert.deepEqual([...storage.files], statePhotoUris(state));
  assert.deepEqual(storage.deleted, [oldPhoto, orphanPhoto]);
});

test('failure to save a shortened cleanup plan retains the original durable plan for a later retry', async () => {
  const storage = fakeStorage(JSON.stringify(createGardenFixture()), [oldPhoto, orphanPhoto]);
  storage.failDeletes.add(orphanPhoto);
  storage.failWrites.add(2);
  const first = await loadStoredUserData(storage.port);
  assert.deepEqual(first.pendingPhotoCleanup, [oldPhoto, orphanPhoto]);
  assert.deepEqual((JSON.parse(storage.raw()!) as StoredUserData).pendingPhotoCleanup, [oldPhoto, orphanPhoto]);
  assert.equal(storage.files.has(oldPhoto), false);
  assert.equal(storage.files.has(orphanPhoto), true);
  storage.failDeletes.clear();
  storage.failWrites.clear();
  const retried = await loadStoredUserData(storage.port);
  assert.deepEqual(retried.pendingPhotoCleanup, []);
  assert.equal(storage.lists(), 1);
  assert.deepEqual(storage.deleted, [oldPhoto, oldPhoto, orphanPhoto]);
});

test('explicit reset after real data clears that account once with a new durable cleanup plan', async () => {
  const state = newUserState();
  const storage = fakeStorage(JSON.stringify(envelope(state)), statePhotoUris(state));
  const reset = await clearStoredUserData(storage.port);
  assert.deepEqual(reset.state, createInitialState());
  assert.deepEqual(storage.writes[0], envelope(createInitialState(), statePhotoUris(state)));
  assert.deepEqual([...storage.files], []);
  assert.deepEqual(storage.deleted, statePhotoUris(state));
  await loadStoredUserData(storage.port);
  assert.equal(storage.lists(), 1);
});

test('pending cleanup never deletes a photo newly referenced by the garden, avatar or chibi', async () => {
  const state = newUserState();
  const protectedUris = statePhotoUris(state);
  const storage = fakeStorage(JSON.stringify(envelope(state, [...protectedUris, oldPhoto])), [...protectedUris, oldPhoto]);
  const loaded = await loadStoredUserData(storage.port);
  assert.deepEqual(storage.deleted, [oldPhoto]);
  assert.deepEqual([...storage.files], protectedUris);
  assert.deepEqual(loaded.pendingPhotoCleanup, []);
  assert.deepEqual(loaded.state, state);
});

test('saving removed photos persists the replacement state before any physical deletion', async () => {
  const previous = envelope(newUserState());
  const storage = fakeStorage(JSON.stringify(previous), statePhotoUris(previous.state));
  const next = structuredClone(previous.state);
  next.plantPhotos = [];
  const saved = await saveStoredUserData(storage.port, previous, next);
  assert.deepEqual(storage.writes[0].state, next);
  assert.deepEqual(storage.writes[0].pendingPhotoCleanup, [newPhoto]);
  assert.ok(storage.events.indexOf('write-saved:1') < storage.events.indexOf(`delete:${newPhoto}`));
  assert.deepEqual(saved.state, next);
  assert.deepEqual(storage.deleted, [newPhoto]);
  assert.equal(storage.lists(), 0);
});

test('a failed save leaves the old record and all removed photos unchanged', async () => {
  const previous = envelope(newUserState());
  const initial = JSON.stringify(previous);
  const storage = fakeStorage(initial, statePhotoUris(previous.state));
  storage.failWrites.add(1);
  const next = structuredClone(previous.state);
  next.plantPhotos = [];
  await assert.rejects(saveStoredUserData(storage.port, previous, next), /write failed/);
  assert.equal(storage.raw(), initial);
  assert.deepEqual(storage.deleted, []);
  assert.deepEqual([...storage.files], statePhotoUris(previous.state));
});

test('state photo references are deduplicated across original images, chibis and avatar', () => {
  const state = newUserState();
  state.profile.avatarImageUri = newPhoto;
  state.plantChibis[0].imageUri = newPhoto;
  state.plantPhotos.push({ ...state.plantPhotos[0], id: 'duplicate-photo' });
  assert.deepEqual(statePhotoUris(state), [newPhoto]);
});

test('saving a state that reuses a pending photo protects it while cleaning only obsolete files', async () => {
  const previous = envelope(createInitialState(), [oldPhoto, newPhoto]);
  const state = newUserState();
  const storage = fakeStorage(JSON.stringify(previous), [oldPhoto, ...statePhotoUris(state)]);
  const saved = await saveStoredUserData(storage.port, previous, state);
  assert.deepEqual(storage.deleted, [oldPhoto]);
  assert.deepEqual(saved.pendingPhotoCleanup, []);
  assert.ok(storage.files.has(newPhoto));
  assert.deepEqual(saved.state, state);
});

test('reset includes private music in the durable cleanup plan before deleting any audio', async () => {
  const state = newUserState();
  const musicUri = 'file:///private/pat-music/300-track.mp3';
  state.settings.musicUri = musicUri;
  const storage = fakeStorage(JSON.stringify(envelope(state)), statePhotoUris(state));
  const deletedMusic: string[] = [];
  storage.port.listMusic = () => [musicUri];
  storage.port.deleteMusic = (uri) => {
    assert.deepEqual(storage.writes[0].pendingMusicCleanup, [musicUri]);
    assert.equal(storage.writes[0].state.settings.musicUri, null);
    deletedMusic.push(uri);
  };
  const reset = await clearStoredUserData(storage.port);
  assert.deepEqual(deletedMusic, [musicUri]);
  assert.deepEqual(reset.pendingMusicCleanup, []);
  assert.equal(reset.storageEpoch, FRESH_START_EPOCH);
});

test('replacing a music file deletes only the old private copy after the new selection is saved', async () => {
  const state = createInitialState();
  state.settings.musicUri = 'file:///private/pat-music/300-old.mp3';
  const previous = { ...envelope(state), pendingMusicCleanup: [] };
  const storage = fakeStorage(JSON.stringify(previous));
  const deleted: string[] = [];
  storage.port.deleteMusic = (uri) => {
    assert.equal(storage.writes[0].state.settings.musicUri, 'file:///private/pat-music/301-new.mp3');
    deleted.push(uri);
  };
  const next = structuredClone(state);
  next.settings.musicUri = 'file:///private/pat-music/301-new.mp3';
  const saved = await saveStoredUserData(storage.port, previous, next);
  assert.deepEqual(deleted, ['file:///private/pat-music/300-old.mp3']);
  assert.deepEqual(saved.pendingMusicCleanup, []);
});

test('failed music cleanup is retried from its durable plan while preserving the current user garden', async () => {
  const state = newUserState();
  const oldMusic = 'file:///private/pat-music/300-old.mp3';
  const storage = fakeStorage(JSON.stringify({ ...envelope(state), pendingMusicCleanup: [oldMusic] }));
  storage.port.deleteMusic = () => { throw new Error('busy audio file'); };
  const pending = await loadStoredUserData(storage.port);
  assert.deepEqual(pending.pendingMusicCleanup, [oldMusic]);
  assert.deepEqual(pending.state, state);
  const deleted: string[] = [];
  storage.port.deleteMusic = (uri) => { deleted.push(uri); };
  const finished = await loadStoredUserData(storage.port);
  assert.deepEqual(finished.pendingMusicCleanup, []);
  assert.deepEqual(finished.state, state);
  assert.deepEqual(deleted, [oldMusic]);
});

test('a failed reset write does not delete private music, and failed listing never overwrites state', async () => {
  const raw = JSON.stringify(envelope(newUserState()));
  const storage = fakeStorage(raw);
  storage.port.listMusic = () => ['file:///private/pat-music/300-track.mp3'];
  const deleted: string[] = [];
  storage.port.deleteMusic = (uri) => { deleted.push(uri); };
  storage.failWrites.add(1);
  await assert.rejects(clearStoredUserData(storage.port), /write failed/);
  assert.deepEqual(deleted, []);
  assert.equal(storage.raw(), raw);
  storage.failWrites.clear();
  storage.port.listMusic = () => { throw new Error('music listing failed'); };
  await assert.rejects(clearStoredUserData(storage.port), /music listing failed/);
  assert.deepEqual(deleted, []);
  assert.equal(storage.raw(), raw);
});

test('bundled soundtrack migration retires the old copy after a durable write and rejects corrupt cleanup plans', async () => {
  const state = createInitialState();
  state.settings.musicUri = 'file:///private/pat-music/300-track.mp3';
  const storage = fakeStorage(JSON.stringify({ ...envelope(state), pendingMusicCleanup: [state.settings.musicUri] }));
  const deleted: string[] = [];
  storage.port.deleteMusic = (uri) => {
    assert.equal(storage.writes[0].state.settings.musicUri, null);
    assert.ok(storage.writes[0].pendingMusicCleanup?.includes(uri));
    deleted.push(uri);
  };
  const migrated = await loadStoredUserData(storage.port);
  assert.deepEqual(migrated.pendingMusicCleanup, []);
  assert.equal(migrated.state.settings.musicUri, null);
  assert.deepEqual(deleted, [state.settings.musicUri]);
  for (const pendingMusicCleanup of [null, 42, 'not-array', [state.settings.musicUri, 42]]) {
    const raw = JSON.stringify({ ...envelope(state), pendingMusicCleanup });
    const invalid = fakeStorage(raw);
    await assert.rejects(loadStoredUserData(invalid.port), /nhạc chờ xóa bị lỗi/);
    assert.equal(invalid.raw(), raw);
    assert.equal(invalid.attempts(), 0);
  }
});

test('a failed soundtrack migration keeps the old copy and existing garden for retry', async () => {
  const state = newUserState();
  state.settings = { ...state.settings, music: true, musicConsent: true,
    musicUri: 'file:///private/pat-music/300-track.mp3', musicName: 'Old soundtrack' };
  const raw = JSON.stringify(envelope(state));
  const storage = fakeStorage(raw, statePhotoUris(state));
  const deleted: string[] = [];
  storage.port.deleteMusic = (uri) => { deleted.push(uri); };
  storage.failWrites.add(1);
  await assert.rejects(loadStoredUserData(storage.port), /write failed/);
  assert.equal(storage.raw(), raw);
  assert.deepEqual(deleted, []);
  storage.failWrites.clear();
  const migrated = await loadStoredUserData(storage.port);
  assert.deepEqual(migrated.state.plants, state.plants);
  assert.equal(migrated.state.settings.music, true);
  assert.equal(migrated.state.settings.musicConsent, true);
  assert.equal(migrated.state.settings.musicUri, null);
  assert.equal(migrated.state.settings.musicName, null);
  assert.deepEqual(deleted, [state.settings.musicUri]);
});
