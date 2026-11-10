/** Kiểm thử giới hạn kho thú, giữ nguyên gói quà chưa mở khi đầy và nhận thưởng sau khi đã dọn chỗ. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PET_CAPACITY, PET_UPGRADE_FOOD_IDS } from '../src/data/petProgression';
import { recordPlantInspection, revealDailyPack, PetCapacityError, type InspectionInput } from '../src/store/journeyActions';
import { normalizePersistedState } from '../src/store/normalizeState';
import { sellPetCopies } from '../src/store/petActions';
import { createPetInstance } from '../src/store/petCollection';
import type { AppState } from '../src/types/app';
import { createGardenFixture } from './fixtures/gardenFixture';

const now = new Date('2026-11-01T03:00:00Z');
const tomorrow = new Date('2026-11-02T03:00:00Z');
function garden(count: number): AppState {
  const state = createGardenFixture();
  state.auth = { loggedIn: true, remember: true, identity: 'keeper@example.test' };
  state.plants = [{ ...state.plants[0], streak: 0, bestStreak: 0, lastCheckIn: null }];
  state.plantAnalyses = [];
  state.inventory.pets = Array.from({ length: count }, (_, index) => createPetInstance('caterpillar', `owned-${index}`));
  state.inventory.items = state.inventory.items.map((food) => ({ ...food, quantity: 0 }));
  return state;
}
const inspection: InspectionInput = { plantId: 'plant-map', imageUri: 'file:///actual-tree.jpg', source: 'camera',
  mode: 'gemini', identityConfirmed: true,
  analysis: { level: 'Tốt', title: 'Đã quan sát', summary: 'Kiểm tra đất trực tiếp trước khi tưới.', actions: [] } };
function finish(state: AppState, at = now, random = () => 0.99) {
  return recordPlantInspection(state, inspection, at, random, () => 0).state;
}

test('completing a full garden still earns a fixed unopened pack without reserving a pet slot', () => {
  const initial = garden(PET_CAPACITY);
  let rolls = 0;
  const earned = finish(initial, now, () => { rolls++; return 0.99; });
  assert.equal(rolls, 1);
  assert.equal(earned.inventory.pets.length, 30);
  assert.deepEqual(earned.inventory, initial.inventory);
  assert.equal(earned.dailyPacks[0].rarity, 'Legendary');
  assert.equal(earned.dailyPacks[0].creditedAt, null);
  assert.equal(earned.dailyPacks[0].revealedAt, null);
  assert.equal(earned.dailyPacks[0].bonusFoodItemId, 'berry-bites');
  const snapshot = JSON.stringify(earned);
  assert.throws(() => revealDailyPack(earned, earned.dailyPacks[0].id, now), PetCapacityError);
  assert.equal(JSON.stringify(earned), snapshot);
  assert.equal(earned.inventory.items[0].quantity, 0);
});

test('pending packs and exact outcomes survive multiple days while full, then open after a sale', () => {
  let state = finish(garden(30));
  const first = state.dailyPacks[0];
  state = finish(normalizePersistedState(JSON.parse(JSON.stringify(state))), tomorrow, () => 0.6);
  const second = state.dailyPacks[1];
  assert.equal(state.dailyPacks.length, 2);
  assert.equal(second.rarity, 'Uncommon');
  assert.equal(state.dailyPacks.every((pack) => pack.creditedAt === null && pack.revealedAt === null), true);
  assert.equal(state.inventory.pets.length, 30);
  assert.throws(() => revealDailyPack(state, first.id, tomorrow), PetCapacityError);
  const sold = sellPetCopies(state, { requestId: 'make-room', petId: 'owned-0', petIds: ['owned-0'] }, tomorrow).state;
  assert.equal(sold.inventory.pets.length, 29);
  const opened = revealDailyPack(sold, first.id, tomorrow);
  assert.equal(opened.state.inventory.pets.length, 30);
  assert.equal(opened.state.inventory.pets.at(-1)?.speciesId, 'mantis');
  assert.equal(opened.state.inventory.pets.at(-1)?.id, first.petInstanceId);
  assert.equal(opened.pack?.creditedAt, tomorrow.toISOString());
  assert.equal(opened.pack?.rarity, 'Legendary');
  assert.equal(opened.state.inventory.items[0].quantity, 1);
  assert.equal(opened.state.daily.lastCatchDate, '2026-11-02');
  assert.equal(opened.state.dailyPacks[1].revealedAt, null);
  const hydrated = normalizePersistedState(JSON.parse(JSON.stringify(opened.state)));
  assert.equal(revealDailyPack(hydrated, first.id, tomorrow).state, hydrated);
  assert.throws(() => revealDailyPack(hydrated, second.id, tomorrow), PetCapacityError);
  assert.equal(hydrated.inventory.items[0].quantity, 1);
});

test('29 to 30 is allowed and a 3-star individual occupies one slot rather than six base copies', () => {
  const initial = garden(29);
  initial.inventory.pets[0] = { ...initial.inventory.pets[0], level: 36, stars: 3,
    baseCopies: 6, upgradeGoldSpent: 700,
    upgradeFoodSpent: Object.fromEntries(PET_UPGRADE_FOOD_IDS.map((id) => [id, 3])) };
  const earned = finish(initial);
  const opened = revealDailyPack(earned, earned.dailyPacks[0].id, now).state;
  assert.equal(opened.inventory.pets.length, 30);
  assert.equal(opened.inventory.pets[0].stars, 3);
  assert.equal(opened.inventory.pets[0].baseCopies, 6);
});

test('over-capacity preexisting inventories are preserved, not reset or truncated, and block new packs', () => {
  const initial = garden(35);
  const restored = normalizePersistedState(JSON.parse(JSON.stringify(initial)));
  assert.equal(restored.inventory.pets.length, 35);
  assert.deepEqual(restored.inventory.pets, initial.inventory.pets);
  const earned = finish(restored);
  assert.equal(earned.dailyPacks.length, 1);
  assert.throws(() => revealDailyPack(earned, earned.dailyPacks[0].id), PetCapacityError);
  assert.equal(earned.inventory.pets.length, 35);
});

test('legacy v4 credited packs never recreate a pet sold before migration, even when opened at capacity', () => {
  const earned = finish(garden(30));
  const raw = JSON.parse(JSON.stringify(earned));
  raw.version = 4;
  delete raw.dailyPacks[0].creditedAt;
  const restored = normalizePersistedState(raw);
  assert.equal(restored.dailyPacks[0].creditedAt, restored.dailyPacks[0].earnedAt);
  assert.equal(restored.inventory.pets.some((pet) => pet.id === restored.dailyPacks[0].petInstanceId), false);
  const opened = revealDailyPack(restored, restored.dailyPacks[0].id, tomorrow).state;
  assert.equal(opened.inventory.pets.length, 30);
  assert.equal(opened.inventory.pets.some((pet) => pet.speciesId === 'mantis'), false);
  assert.equal(opened.inventory.items[0].quantity, 1);
  const normalized = normalizePersistedState(opened);
  assert.equal(revealDailyPack(normalized, normalized.dailyPacks[0].id, tomorrow).state, normalized);
});

test('v5 pending pack delivery is atomic if food validation fails, and a retry keeps the same pet outcome', () => {
  const earned = finish(garden(29));
  const invalid = { ...earned, inventory: { ...earned.inventory,
    items: earned.inventory.items.filter((item) => item.id !== earned.dailyPacks[0].bonusFoodItemId) } };
  const snapshot = JSON.stringify(invalid);
  assert.throws(() => revealDailyPack(invalid, invalid.dailyPacks[0].id, now), /Thức ăn/);
  assert.equal(JSON.stringify(invalid), snapshot);
  const opened = revealDailyPack(earned, earned.dailyPacks[0].id, tomorrow).state;
  assert.equal(opened.inventory.pets.length, 30);
  assert.equal(opened.inventory.pets.at(-1)?.speciesId, earned.dailyPacks[0].beastId);
});

test('a stale repeated inspection at capacity cannot create a second daily pack or reroll', () => {
  const earned = finish(garden(30));
  const repeated = finish(earned, now, () => { throw new Error('Must not reroll a completed round'); });
  assert.deepEqual(repeated.dailyPacks, earned.dailyPacks);
  assert.deepEqual(repeated.inventory, earned.inventory);
});
