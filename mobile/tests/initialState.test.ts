/** Kiểm thử dữ liệu khởi tạo trống, độc lập và không tự cấp cây, thú nuôi hoặc tài nguyên mẫu. */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createInitialState } from '../src/data/seed';
import { createPetInstance } from '../src/store/petCollection';
import { addCareEvent, createPlantJourney, recordPlantInspection, revealDailyPack, updatePlantJourney } from '../src/store/journeyActions';
import { normalizePersistedState } from '../src/store/normalizeState';
import type { AppState } from '../src/types/app';
import { createGardenFixture } from './fixtures/gardenFixture';

const recordCollections = [
  'plants', 'checkIns', 'plantPhotos', 'plantAnalyses', 'plantChibis',
  'chatMessages', 'careEvents', 'dailyRounds', 'dailyPacks', 'mailbox',
] as const;

function assertEmptyAccount(state: AppState) {
  for (const collection of recordCollections) assert.deepEqual(state[collection], [], collection);
  assert.equal(state.activePlantId, '');
  assert.deepEqual(state.auth, { loggedIn: false, remember: false, identity: '' });
  assert.equal(state.profile.avatarImageUri, null);
  assert.equal(state.daily.lastCatchDate, null);
  assert.equal(state.daily.lastCatchPlantId, null);
  assert.equal(state.battleNotify, false);
  assert.deepEqual(state.inventory.pets, []);
  assert.ok(state.inventory.items.length > 0);
  for (const item of state.inventory.items) assert.equal(item.quantity, 0, item.id);
}

test('new users start with no provided records, pet ownership, stock or account identity', () => {
  const state = createInitialState();
  assertEmptyAccount(state);
  assert.equal(state.version, 5);
  assert.deepEqual(state.economy.loginVisits, []);
  assert.equal(state.profile.name, 'Người trồng cây');
  assert.equal(state.profile.title, 'Bắt đầu hành trình');
  assert.doesNotMatch(JSON.stringify(state), /Lâm Chill|Bé Mập|Minty|Gai Nhỏ|demo@pat\.vn|plant-map/);
});

test('initial factories return independent catalogs, preferences and record arrays', () => {
  const first = createInitialState();
  first.inventory.pets.push(createPetInstance('ladybug', 'first-pet'));
  first.inventory.items[0].quantity = 7;
  first.profile.name = 'Changed';
  first.settings.music = true;
  assertEmptyAccount(createInitialState());
  assert.equal(createInitialState().settings.music, false);
});

test('valid empty state survives repeated normalization without reseeding plants or rewards', () => {
  const state = createInitialState();
  const hydrated = normalizePersistedState(JSON.parse(JSON.stringify(state)) as unknown);
  assert.deepEqual(hydrated, state);
  assertEmptyAccount(normalizePersistedState(hydrated));
});

test('invalid or absent persistence repairs to an empty account, not a demo garden', () => {
  for (const value of [null, undefined, false, 42, [], {}, { version: 3, plants: [null, false, 42] }]) {
    assertEmptyAccount(normalizePersistedState(value));
  }
});

test('legacy empty gardens stay empty through v1/v2 migration', () => {
  for (const version of [1, 2]) {
    const state = normalizePersistedState({ version, plants: [], activePlantId: 'removed-plant' });
    assertEmptyAccount(state);
  }
});

test('normalization preserves legitimate saved ownership and profile even when the garden is empty', () => {
  const saved = createInitialState();
  saved.auth = { loggedIn: true, remember: true, identity: 'new-person@example.test' };
  saved.profile.name = 'Người dùng thật';
  saved.inventory.pets = [{ ...createPetInstance('ladybug', 'my-pet'), level: 3, experience: 10 }];
  saved.inventory.items[0].quantity = 4;
  saved.daily.lastCatchDate = '2026-10-25';
  const restored = normalizePersistedState(saved);
  assert.deepEqual(restored.plants, []);
  assert.equal(restored.activePlantId, '');
  assert.deepEqual(restored.auth, saved.auth);
  assert.deepEqual(restored.profile, saved.profile);
  assert.deepEqual(restored.inventory, saved.inventory);
  assert.deepEqual(restored.daily, saved.daily);
});

test('a first real journey starts without streak or unrelated data and can earn exactly one first pet', () => {
  const now = new Date('2026-10-26T03:00:00Z');
  const created = createPlantJourney(createInitialState(), {
    name: 'Cà chua của An', species: 'Cà chua', mode: 'gemini',
    journey: { crop: 'tomato', phase: 'planning', method: 'seed', startedAt: now.toISOString(), location: 'Ban công', light: 'Nắng sáng', notes: '' },
    photo: { imageUri: 'file:///my-tomato.jpg', source: 'camera' },
    assistantMessage: 'Xác nhận điều kiện trồng trước khi bắt đầu.',
  }, now);
  assert.equal(created.state.plants.length, 1);
  assert.equal(created.state.plants[0].streak, 0);
  assert.equal(created.state.plantPhotos[0].purpose, 'reference');
  assert.deepEqual(created.state.checkIns, []);
  assert.deepEqual(created.state.plantAnalyses, []);
  assert.deepEqual(created.state.dailyPacks, []);
  assert.equal(created.state.chatMessages.length, 1);
  const growing = updatePlantJourney(created.state, created.plant.id, { phase: 'germinating' }, now);
  const checked = recordPlantInspection(growing, { plantId: created.plant.id,
    imageUri: 'file:///my-seed-tray.jpg', source: 'camera', phase: 'germinating',
    identityConfirmed: true, mode: 'gemini', analysis: {
      level: 'Tốt', title: 'Theo dõi khay ươm', summary: 'Tiếp tục quan sát điều kiện thực tế.', actions: [],
    } }, now, () => 0).state;
  assert.equal(checked.dailyPacks.length, 1);
  assert.equal(checked.dailyPacks[0].isNew, true);
  assert.equal(checked.inventory.pets.length, 0);
  assert.equal(checked.dailyPacks[0].creditedAt, null);
  const opened = revealDailyPack(checked, checked.dailyPacks[0].id, now).state;
  assert.equal(opened.inventory.pets.length, 1);
  assert.equal(opened.inventory.pets[0].level, 1);
  assert.ok(checked.inventory.items.every((item) => item.quantity === 0));
  assert.deepEqual(normalizePersistedState(JSON.parse(JSON.stringify(checked)) as unknown), checked);
});

test('normalization does not reset user-created photos, conversations, care history or progress', () => {
  const fixture = createGardenFixture();
  fixture.auth = { loggedIn: true, remember: true, identity: 'saved@example.test' };
  const cared = addCareEvent(fixture, { plantId: fixture.plants[0].id, kind: 'observe', note: 'Đất còn ẩm, không tưới.' }).state;
  const normalized = normalizePersistedState(JSON.parse(JSON.stringify(cared)) as unknown);
  assert.deepEqual(normalized.plants, cared.plants.map((plant) => ({ ...plant, archived: plant.archived ?? false })));
  assert.deepEqual(normalized.plantPhotos, cared.plantPhotos);
  assert.deepEqual(normalized.plantAnalyses, cared.plantAnalyses);
  assert.deepEqual(normalized.careEvents, cared.careEvents);
  assert.deepEqual(normalized.inventory, cared.inventory);
  assert.deepEqual(normalized.profile, cared.profile);
});
