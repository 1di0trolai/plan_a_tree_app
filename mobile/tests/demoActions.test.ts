import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSeedState, localDateKey, offsetLocalDate } from '../src/data/seed';
import { consumePetFood, recordCheckIn, recordHunt } from '../src/store/demoActions';
import { normalizePersistedState } from '../src/store/normalizeState';
import { isIdentityValid } from '../src/utils/validation';

const now = new Date(2026, 9, 22, 12);
const photoInput = { plantId: 'plant-map', imageUri: 'file:///test.jpg', source: 'library' as const };

test('first daily photo advances only the selected plant streak', () => {
  const before = createSeedState();
  before.plants[0].lastCheckIn = offsetLocalDate(-1, now);
  const { state, result } = recordCheckIn(before, photoInput, now);
  assert.equal(result.firstToday, true);
  assert.equal(state.plants[0].streak, before.plants[0].streak + 1);
  assert.deepEqual(state.plants[1], before.plants[1]);
  assert.equal(before.plants[0].streak, 16); // Original state is not mutated.
});

test('additional same-day photos are saved without extra streak or growth', () => {
  const first = recordCheckIn(createSeedState(), photoInput, now).state;
  const { state, result } = recordCheckIn(first, photoInput, now);
  assert.equal(result.firstToday, false);
  assert.equal(state.plants[0].streak, first.plants[0].streak);
  assert.equal(state.plants[0].progress, first.plants[0].progress);
  assert.equal(state.plantPhotos.length, first.plantPhotos.length + 1);
});

test('missed day restarts streak but preserves best record', () => {
  const before = createSeedState();
  before.plants[0].lastCheckIn = offsetLocalDate(-2, now);
  const { state } = recordCheckIn(before, photoInput, now);
  assert.equal(state.plants[0].streak, 1);
  assert.equal(state.plants[0].bestStreak, 16);
});

test('check-in links separate photo, analysis and chibi records', () => {
  const { state } = recordCheckIn(createSeedState(), photoInput, now);
  const entry = state.checkIns[0];
  const photo = state.plantPhotos.find((item) => item.id === entry.photoId)!;
  const analysis = state.plantAnalyses.find((item) => item.id === entry.analysisId)!;
  const chibi = state.plantChibis.find((item) => item.plantId === entry.plantId)!;
  assert.equal(photo.imageUri, photoInput.imageUri);
  assert.equal(analysis.photoId, photo.id);
  assert.equal(chibi.sourcePhotoId, photo.id);
  assert.equal(chibi.imageUri, null); // No fake claim of AI-generated art.
});

test('unknown plant and blank photo never create a check-in', () => {
  const before = createSeedState();
  assert.throws(() => recordCheckIn(before, { ...photoInput, plantId: 'missing' }, now));
  assert.throws(() => recordCheckIn(before, { ...photoInput, imageUri: '  ' }, now));
  assert.equal(before.checkIns.length, 3);
});

test('AR quota is shared across all plants and reopens next local day', () => {
  const first = recordHunt(createSeedState(), 'plant-map', now);
  assert.ok(first.result);
  assert.equal(first.state.daily.lastCatchDate, localDateKey(now));
  const retry = recordHunt(first.state, 'plant-mint', now);
  assert.equal(retry.result, null);
  assert.equal(retry.state, first.state);
  assert.ok(recordHunt(first.state, 'plant-mint', new Date(2026, 9, 23, 0, 1)).result);
});

test('invalid plant or empty pet catalog does not consume AR quota', () => {
  const before = createSeedState();
  assert.equal(recordHunt(before, 'missing', now).state, before);
  before.inventory.beasts = [];
  assert.equal(recordHunt(before, 'plant-map', now).result, null);
  assert.equal(before.daily.lastCatchDate, null);
});

test('feeding consumes one food and carries remaining EXP after level-up', () => {
  const before = createSeedState();
  before.inventory.beasts[0].level = 1;
  before.inventory.beasts[0].experience = 90;
  const { state, result } = consumePetFood(before, 'ladybug', 'berry-bites');
  assert.equal(result.ok, true);
  assert.equal(state.inventory.beasts[0].level, 2);
  assert.equal(state.inventory.beasts[0].experience, 15);
  assert.equal(state.inventory.items[0].quantity, 4);
  assert.deepEqual(state.plants, before.plants);
  assert.equal(before.inventory.items[0].quantity, 5);
});

test('feeding supports multiple level-ups in one meal', () => {
  const before = createSeedState();
  before.inventory.beasts[0].level = 1;
  before.inventory.beasts[0].experience = 0;
  before.inventory.items[0].experienceGain = 250;
  const pet = consumePetFood(before, 'ladybug', 'berry-bites').state.inventory.beasts[0];
  assert.equal(pet.level, 3);
  assert.equal(pet.experience, 25);
});

test('empty stock, non-food items and unowned pets cannot be fed', () => {
  const before = createSeedState();
  assert.equal(consumePetFood(before, 'moon-moth', 'berry-bites').result.ok, false);
  before.inventory.items[0].category = 'Đồ chơi';
  assert.equal(consumePetFood(before, 'ladybug', 'berry-bites').state, before);
  before.inventory.items[0].category = 'Thức ăn';
  before.inventory.items[0].quantity = 0;
  assert.equal(consumePetFood(before, 'ladybug', 'berry-bites').result.ok, false);
});

test('hydration ends sessions unless remember was enabled', () => {
  const saved = createSeedState();
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
  assert.equal(state.version, 2);
  assert.equal(state.checkIns[0].plantId, 'legacy-plant');
  assert.equal(state.plantPhotos[0].imageUri, 'file:///legacy.jpg');
  assert.equal(state.plantChibis[0].fallbackEmoji, '🌿');
});

test('hydration repairs invalid selection, quantities and streak record', () => {
  const saved = createSeedState();
  saved.activePlantId = 'missing';
  saved.plants[0].bestStreak = 1;
  saved.inventory.items[0].quantity = -5;
  saved.inventory.beasts[0].quantity = 0;
  const state = normalizePersistedState(saved);
  assert.equal(state.activePlantId, state.plants[0].id);
  assert.equal(state.plants[0].bestStreak, state.plants[0].streak);
  assert.equal(state.inventory.items[0].quantity, 0);
  assert.equal(state.inventory.beasts[0].owned, false);
  assert.notEqual(state.inventory.companionId, 'ladybug');
  assert.ok(normalizePersistedState(null).plants.length);
});

test('one shared identity validator accepts email or Vietnamese phone', () => {
  for (const value of [' demo@pat.vn ', '0912345678', '+84 912 345 678']) assert.equal(isIdentityValid(value), true);
  for (const value of ['abc', 'no@domain', '12345']) assert.equal(isIdentityValid(value), false);
});
