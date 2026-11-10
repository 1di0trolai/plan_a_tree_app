/** Kiểm thử chuẩn hóa dữ liệu đã lưu, sửa giá trị không hợp lệ và di chuyển dữ liệu cũ mà không mất tiến trình. */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizePersistedState } from '../src/store/normalizeState';
import { createGardenFixture } from './fixtures/gardenFixture';

test('hydration ends sessions unless remember was enabled', () => {
  const saved = createGardenFixture();
  saved.auth.loggedIn = true;
  assert.equal(normalizePersistedState(saved).auth.loggedIn, false);
  saved.auth.remember = true;
  assert.equal(normalizePersistedState(saved).auth.loggedIn, true);
});

test('legacy plant history is migrated rather than discarded', () => {
  const state = normalizePersistedState({ plants: [{
    id: 'legacy-plant', name: 'Legacy plant', emoji: '🌿',
    history: [{ id: 'old-checkin', imageUri: 'file:///legacy.jpg', date: '2026-10-20', time: '08:00' }],
  }] });
  assert.equal(state.version, 5);
  assert.equal(state.checkIns[0].plantId, 'legacy-plant');
  assert.equal(state.plantPhotos[0].imageUri, 'file:///legacy.jpg');
  assert.equal(state.plantChibis[0].fallbackEmoji, '🌿');
});

test('hydration repairs invalid selection, quantities and streak record', () => {
  const saved = createGardenFixture();
  saved.activePlantId = 'missing';
  saved.plants[0].bestStreak = 1;
  saved.inventory.items[0].quantity = -5;
  const state = normalizePersistedState(saved);
  assert.equal(state.activePlantId, state.plants[0].id);
  assert.equal(state.plants[0].bestStreak, state.plants[0].streak);
  assert.equal(state.inventory.items[0].quantity, 0);
  assert.deepEqual(state.inventory.pets, saved.inventory.pets);
  assert.equal(normalizePersistedState(null).plants.length, 0);
});

test('old pet saves split once without inventing copies, EXP, food or gold', () => {
  const saved = createGardenFixture();
  const legacy = { ...saved, version: 3, inventory: { items: saved.inventory.items,
    beasts: [{ id: 'ladybug', quantity: 3, level: 15, experience: 420 }] } };
  const hydrated = normalizePersistedState(legacy);
  assert.equal(hydrated.inventory.pets.length, 3);
  assert.ok(hydrated.inventory.pets.every((pet) => pet.stars === 1));
  assert.equal(hydrated.inventory.pets[0].level, 15);
  assert.equal(hydrated.inventory.pets[1].level, 1);
  assert.deepEqual(normalizePersistedState(hydrated).inventory, hydrated.inventory);
  assert.deepEqual(hydrated.economy, saved.economy);
});

test('valid individual progress survives hydration; corrupt individual saves are not overwritten', () => {
  const state = createGardenFixture();
  state.inventory.pets[0].stars = 2;
  state.inventory.pets[1].stars = 3;
  const hydrated = normalizePersistedState(state);
  assert.deepEqual(hydrated.inventory, state.inventory);
  for (const invalid of [-2, 0, 1.5, 4, Infinity, '3', null]) {
    const raw = { ...state, inventory: { ...state.inventory, pets: [{ ...state.inventory.pets[0], stars: invalid }] } };
    assert.throws(() => normalizePersistedState(raw), /thú nuôi bị lỗi/);
  }
});
