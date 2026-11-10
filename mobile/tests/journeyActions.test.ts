/** Kiểm thử hành trình trồng cây, ghi nhận kiểm tra, lịch sử chăm sóc và quy tắc thưởng theo ngày Việt Nam. */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';

import { localDateKey, localTimeKey, offsetLocalDate } from '../src/data/seed';
import { createGardenFixture } from './fixtures/gardenFixture';
import { normalizePersistedState } from '../src/store/normalizeState';
import {
  addCareEvent, addJourneyReference, appendPlantChat, archivePlantJourney,
  beginDailyGardenRound, CARD_POOL, createPlantJourney, recordPlantInspection,
  revealDailyPack, updatePlantJourney, type InspectionInput,
} from '../src/store/journeyActions';
import type { AppState, PlantJourney } from '../src/types/app';

const now = new Date('2026-10-25T03:00:00Z');
// Seed dates and transition clocks must share a fixture day, not the host's date.
// Otherwise yesterday's seeded DEMO analysis can contaminate a fixed-day AI round.
beforeEach(() => {
  mock.timers.enable({ apis: ['Date'], now });
});
afterEach(() => {
  mock.timers.reset();
});

const journey: PlantJourney = { crop: 'tomato', phase: 'planning', method: 'seed',
  startedAt: '2026-10-25', location: 'Ban công', light: 'Nắng sáng', notes: 'Ươm từ quả' };
const input: InspectionInput = { plantId: 'plant-map', imageUri: 'file:///inspection.jpg',
  source: 'camera', mode: 'gemini', identityConfirmed: true,
  analysis: { level: 'Tốt', title: 'Chưa cần can thiệp', summary: 'Tiếp tục theo dõi và kiểm tra độ ẩm trực tiếp.', actions: [] } };

function inspectGarden(state = createGardenFixture(), at = now, random = () => 0): AppState {
  for (const plant of state.plants.filter((entry) => !entry.archived && entry.journey.phase !== 'planning')) {
    state = recordPlantInspection(state, { ...input, plantId: plant.id }, at, random, () => 0.99).state;
  }
  return state;
}

test('garden date and time use Vietnam UTC+7 independent of host timezone', () => {
  assert.equal(localDateKey(new Date('2026-10-24T16:59:59Z')), '2026-10-24');
  assert.equal(localDateKey(new Date('2026-10-24T17:00:00Z')), '2026-10-25');
  assert.equal(localTimeKey(new Date('2026-10-24T17:00:00Z')), '00:00');
});

test('enrolling a photographed fruit creates one persistent journey and dedicated chat, not a check-in', () => {
  const before = createGardenFixture();
  const enrolled = createPlantJourney(before, { name: 'Cà chua của tôi', species: 'Cà chua',
    journey, photo: { imageUri: 'file:///fruit.jpg', source: 'camera' },
    assistantMessage: 'Hãy xác nhận cách ươm trước khi bắt đầu.', mode: 'gemini' }, now);
  assert.equal(enrolled.plant.journey.phase, 'planning');
  assert.equal(enrolled.plant.streak, 0);
  assert.equal(enrolled.state.checkIns.length, before.checkIns.length);
  assert.equal(enrolled.state.plantPhotos[0].purpose, 'reference');
  assert.equal(enrolled.state.plantPhotos[0].phase, 'planning');
  const chat = enrolled.state.chatMessages[0];
  assert.equal(chat.plantId, enrolled.plant.id);
  assert.equal(chat.photoId, enrolled.state.plantPhotos[0].id);
  assert.deepEqual(enrolled.state.dailyRounds, []);
  assert.deepEqual(enrolled.state.dailyPacks, []);
  assert.equal(before.chatMessages.length, 0);
});

test('growth transitions keep the original identity and references from each phase', () => {
  const enrolled = createPlantJourney(createGardenFixture(), { name: 'Ớt bé', species: 'Ớt', journey,
    photo: { imageUri: 'file:///fruit.jpg', source: 'library' } }, now);
  const planted = updatePlantJourney(enrolled.state, enrolled.plant.id, { phase: 'germinating' });
  const referenced = addJourneyReference(planted, { plantId: enrolled.plant.id,
    imageUri: 'file:///seed-tray.jpg', source: 'camera' }, now).state;
  assert.equal(referenced.plants.at(-1)!.id, enrolled.plant.id);
  assert.equal(referenced.plants.at(-1)!.stage, 'Đang ươm hạt');
  assert.deepEqual(referenced.plantPhotos.slice(0, 2).map((photo) => photo.phase), ['germinating', 'planning']);
  assert.equal(referenced.plants.at(-1)!.lastCheckIn, null);
});

test('missing identity or plant, outdated phase, blank photos and archived records cannot save inspections', () => {
  const state = createGardenFixture();
  assert.throws(() => recordPlantInspection(state, { ...input, plantId: 'missing' }, now));
  assert.throws(() => recordPlantInspection(state, { ...input, identityConfirmed: false }, now));
  assert.throws(() => recordPlantInspection(state, { ...input, phase: 'fruiting' }, now));
  assert.throws(() => recordPlantInspection(state, { ...input, imageUri: ' ' }, now));
  state.plants[0].archived = true;
  assert.throws(() => recordPlantInspection(state, input, now));
  assert.deepEqual(state.dailyRounds, []);
});

test('a care scan atomically stores the observed photo and full advice in the plant chat', () => {
  const initial = createGardenFixture();
  const analysis = { ...input.analysis, actions: ['Kiểm tra độ ẩm đất.', 'Quan sát lại vào ngày mai.'] };
  const { state, result } = recordPlantInspection(initial, { ...input, analysis }, now);
  assert.equal(result.countsForDailyRound, true);
  const message = state.chatMessages.at(-1)!;
  const photo = state.plantPhotos.find((entry) => entry.id === result.photoId)!;
  assert.equal(message.plantId, input.plantId);
  assert.equal(message.photoId, photo.id);
  assert.equal(message.mode, 'gemini');
  assert.match(message.content, /Chưa cần can thiệp/);
  assert.match(message.content, /Tiếp tục theo dõi/);
  assert.match(message.content, /1\. Kiểm tra độ ẩm đất\./);
  assert.match(message.content, /2\. Quan sát lại vào ngày mai\./);
  assert.equal(state.plantAnalyses[0].photoId, message.photoId);
  assert.equal(photo.imageUri, input.imageUri);
  const restored = normalizePersistedState(JSON.parse(JSON.stringify(state)) as unknown);
  assert.deepEqual(restored.chatMessages.at(-1), message);
  assert.equal(restored.plantPhotos.find((entry) => entry.id === message.photoId)?.imageUri, input.imageUri);
  assert.equal(initial.chatMessages.length, 0);
});

test('planning profiles receive observed care advice without check-ins, streaks or a daily round', () => {
  const initial = createGardenFixture();
  initial.plants.forEach((plant) => { plant.journey.phase = 'planning'; });
  const before = initial.plants[0];
  let rolls = 0;
  const { state, result } = recordPlantInspection(initial, input, now, () => { rolls++; return 0; });
  assert.equal(result.countsForDailyRound, false);
  assert.equal(result.firstToday, false);
  assert.equal(result.round, null);
  assert.equal(result.pack, null);
  assert.equal(state.plants[0].lastCheckIn, before.lastCheckIn);
  assert.equal(state.plants[0].streak, before.streak);
  assert.equal(state.plants[0].bestStreak, before.bestStreak);
  assert.equal(state.plants[0].journey.phase, 'planning');
  assert.equal(state.plants[0].health, 'Đã quan sát');
  assert.deepEqual(state.checkIns, initial.checkIns);
  assert.deepEqual(state.dailyRounds, []);
  assert.deepEqual(state.dailyPacks, []);
  assert.deepEqual(state.inventory, initial.inventory);
  assert.equal(rolls, 0);
  assert.equal(state.plantPhotos[0].purpose, 'reference');
  assert.equal(state.plantAnalyses[0].photoId, result.photoId);
  assert.equal(state.chatMessages.at(-1)?.photoId, result.photoId);
});

test('a planning observation preserves an existing frozen garden round and its reward quota', () => {
  const initial = createGardenFixture();
  initial.plants[0].journey.phase = 'planning';
  const started = beginDailyGardenRound(initial, now).state;
  const observed = recordPlantInspection(started, input, now).state;
  assert.deepEqual(observed.dailyRounds, started.dailyRounds);
  assert.deepEqual(observed.daily, started.daily);
  assert.deepEqual(observed.dailyPacks, started.dailyPacks);
  assert.ok(!observed.dailyRounds[0].plantIds.includes(input.plantId));
});

test('empty garden or only planning profiles never earn a 0/0 reward', () => {
  const state = createGardenFixture();
  state.plants.forEach((plant) => { plant.journey.phase = 'planning'; });
  assert.equal(beginDailyGardenRound(state, now).round, null);
  assert.deepEqual(state.dailyPacks, []);
  state.plants = [];
  assert.equal(beginDailyGardenRound(state, now).round, null);
});

test('first inspection snapshots all eligible plants, not just the selected plant', () => {
  const state = createGardenFixture();
  state.plants[2].journey.phase = 'planning';
  const first = recordPlantInspection(state, input, now).state;
  assert.deepEqual(first.dailyRounds[0].plantIds, ['plant-map', 'plant-mint']);
  assert.deepEqual(first.dailyRounds[0].inspectedPlantIds, ['plant-map']);
  assert.deepEqual(first.dailyPacks, []);
  assert.equal(first.daily.lastCatchDate, null);
});

test('duplicate inspections save history but count once and never increase virtual growth', () => {
  const first = recordPlantInspection(createGardenFixture(), input, now).state;
  const repeated = recordPlantInspection(first, input, now).state;
  assert.deepEqual(repeated.dailyRounds[0].inspectedPlantIds, ['plant-map']);
  assert.equal(repeated.plants[0].streak, first.plants[0].streak);
  assert.equal(repeated.plants[0].progress, first.plants[0].progress);
  assert.equal(repeated.plants[0].journey.phase, first.plants[0].journey.phase);
  assert.equal(repeated.plantPhotos.length, first.plantPhotos.length + 1);
  assert.deepEqual(repeated.plantAnalyses[0].result.actions, []);
});

test('first daily inspection advances only the selected plant streak without mutating input', () => {
  const before = createGardenFixture();
  before.plants[0].lastCheckIn = offsetLocalDate(-1, now);
  const { state, result } = recordPlantInspection(before, input, now);
  assert.equal(result.firstToday, true);
  assert.equal(state.plants[0].streak, before.plants[0].streak + 1);
  assert.deepEqual(state.plants[1], before.plants[1]);
  assert.equal(before.plants[0].streak, 16);
});

test('missed day restarts the inspected plant streak but preserves its best record', () => {
  const before = createGardenFixture();
  before.plants[0].lastCheckIn = offsetLocalDate(-2, now);
  const { state } = recordPlantInspection(before, input, now);
  assert.equal(state.plants[0].streak, 1);
  assert.equal(state.plants[0].bestStreak, 16);
});

test('inspection links separate photo, analysis and chibi records without fabricating chibi art', () => {
  const { state } = recordPlantInspection(createGardenFixture(), input, now);
  const checkIn = state.checkIns[0];
  const photo = state.plantPhotos.find((entry) => entry.id === checkIn.photoId)!;
  const analysis = state.plantAnalyses.find((entry) => entry.id === checkIn.analysisId)!;
  const chibi = state.plantChibis.find((entry) => entry.plantId === checkIn.plantId)!;
  assert.equal(photo.imageUri, input.imageUri);
  assert.equal(analysis.photoId, photo.id);
  assert.equal(chibi.sourcePhotoId, photo.id);
  assert.equal(chibi.imageUri, null);
});

test('all-garden completion rolls once and persists a closed pack without taking an inventory slot', () => {
  let rolls = 0;
  const initial = createGardenFixture();
  const completed = inspectGarden(initial, now, () => { rolls++; return 0.99; });
  assert.equal(rolls, 1);
  assert.equal(completed.dailyPacks.length, 1);
  assert.equal(completed.dailyPacks[0].rarity, 'Legendary');
  assert.equal(completed.dailyPacks[0].revealedAt, null);
  assert.equal(completed.inventory.pets.filter((pet) => pet.speciesId === 'mantis').length, 0);
  assert.deepEqual(completed.inventory.pets, initial.inventory.pets);
  assert.equal(completed.dailyPacks[0].creditedAt, null);
  assert.equal(completed.daily.lastCatchDate, '2026-10-25');
  const repeated = recordPlantInspection(completed, input, now, () => { rolls++; return 0; }).state;
  assert.equal(rolls, 1);
  assert.deepEqual(repeated.dailyPacks, completed.dailyPacks);
  assert.deepEqual(repeated.inventory, completed.inventory);
  assert.equal(initial.inventory.pets.filter((pet) => pet.speciesId === 'mantis').length, 0);
});

test('every rarity has one demo pet with the documented weighted boundaries', () => {
  assert.equal(CARD_POOL.reduce((sum, entry) => sum + entry.weight, 0), 100);
  for (const [sample, rarity] of [[0, 'Common'], [0.6, 'Uncommon'], [0.85, 'Rare'], [0.95, 'Epic'], [0.99, 'Legendary']] as const) {
    assert.equal(inspectGarden(createGardenFixture(), now, () => sample).dailyPacks[0].rarity, rarity);
  }
});

test('pending packs survive hydration and reopening never rerolls or duplicates inventory', () => {
  const completed = inspectGarden();
  const restored = normalizePersistedState(JSON.parse(JSON.stringify(completed)) as unknown);
  assert.deepEqual(restored.dailyPacks, completed.dailyPacks);
  const first = revealDailyPack(restored, restored.dailyPacks[0].id, now);
  const second = revealDailyPack(first.state, first.pack!.id, new Date('2026-10-26T03:00:00Z'));
  assert.equal(first.pack!.revealedAt, now.toISOString());
  assert.equal(second.state, first.state);
  assert.equal(first.state.inventory.pets.length, completed.inventory.pets.length + 1);
  assert.equal(first.state.inventory.pets.at(-1)?.id, first.pack!.petInstanceId);
  assert.equal(first.pack!.creditedAt, now.toISOString());
  assert.deepEqual(second.state.inventory, first.state.inventory);
  assert.equal(revealDailyPack(restored, 'missing', now).pack, null);
});

test('adding plants after the first inspection defers their quota requirement until tomorrow', () => {
  const first = recordPlantInspection(createGardenFixture(), input, now).state;
  const added = createPlantJourney(first, { name: 'Xoài mới', species: 'Xoài',
    journey: { ...journey, crop: 'mango', phase: 'seedling' } }, now);
  const completed = inspectGarden(added.state);
  assert.equal(completed.dailyRounds[0].plantIds.length, 3);
  assert.equal(completed.dailyPacks.length, 1);
  const tomorrow = new Date('2026-10-26T03:00:00Z');
  const round = beginDailyGardenRound(completed, tomorrow).round!;
  assert.equal(round.plantIds.length, 4);
  assert.equal(round.inspectedPlantIds.length, 0);
});

test('archiving an unchecked target cannot unlock a pack; checked profiles retain their history', () => {
  const first = recordPlantInspection(createGardenFixture(), input, now).state;
  const denied = archivePlantJourney(first, 'plant-mint', now);
  assert.equal(denied.result.ok, false);
  assert.equal(denied.state, first);
  const allowed = archivePlantJourney(first, 'plant-map', now);
  assert.equal(allowed.result.ok, true);
  assert.equal(allowed.state.plants[0].archived, true);
  assert.deepEqual(allowed.state.plantPhotos, first.plantPhotos);
  assert.deepEqual(allowed.state.dailyRounds[0].plantIds, first.dailyRounds[0].plantIds);
  const next = beginDailyGardenRound(allowed.state, new Date('2026-10-26T03:00:00Z')).round!;
  assert.equal(next.plantIds.includes('plant-map'), false);
});

test('legacy used-today quota blocks a second reward after migration', () => {
  const legacy = { ...createGardenFixture(), version: 2, daily: { lastCatchDate: '2026-10-25', lastCatchPlantId: 'plant-map' } };
  const completed = inspectGarden(normalizePersistedState(legacy));
  assert.equal(completed.dailyRounds[0].inspectedPlantIds.length, 3);
  assert.deepEqual(completed.dailyPacks, []);
  const tomorrow = inspectGarden(completed, new Date('2026-10-26T03:00:00Z'));
  assert.equal(tomorrow.dailyPacks.length, 1);
});

test('manual checks are labelled demo and never claim healthy status or a fabricated diagnosis', () => {
  const result = recordPlantInspection(createGardenFixture(), { ...input, mode: 'demo' }, now).state;
  assert.equal(result.plants[0].health, 'Chưa đánh giá bằng trợ lý thông minh');
  const completed = inspectGarden(result);
  assert.equal(completed.dailyPacks[0].demo, true);
  const actual = inspectGarden();
  assert.equal(actual.dailyPacks[0].demo, false);
});

test('separate plant chats and care events cannot attach another plant photo', () => {
  const first = addJourneyReference(createGardenFixture(), { plantId: 'plant-map', imageUri: 'file:///leaf.jpg', source: 'camera' }, now);
  assert.throws(() => appendPlantChat(first.state, { plantId: 'plant-mint', role: 'user', content: 'Ảnh này?', mode: 'gemini', photoId: first.photo.id }, now));
  const chatted = appendPlantChat(first.state, { plantId: 'plant-map', role: 'user', content: 'Hôm nay có cần tưới?', mode: 'gemini', photoId: first.photo.id }, now);
  const cared = addCareEvent(chatted.state, { plantId: 'plant-map', kind: 'observe', note: 'Đất còn ẩm, không tưới' }, now).state;
  assert.equal(cared.chatMessages[0].plantId, 'plant-map');
  assert.equal(cared.careEvents[0].kind, 'observe');
  assert.equal(cared.plants[0].lastCheckIn, first.state.plants[0].lastCheckIn);
});

test('v2 migration preserves photos, inventory, quota and empty no-action advice without inventing inspections', () => {
  const old = createGardenFixture();
  old.plantAnalyses[0].result.actions = [];
  const serialized = JSON.parse(JSON.stringify(old)) as Record<string, unknown>;
  serialized.version = 2;
  serialized.inventory = { items: old.inventory.items, beasts: [
    { id: 'ladybug', quantity: 1, level: 15, experience: 420 },
    { id: 'caterpillar', quantity: 2, level: 8, experience: 75 },
  ] };
  delete serialized.chatMessages;
  delete serialized.careEvents;
  delete serialized.dailyRounds;
  delete serialized.dailyPacks;
  const restored = normalizePersistedState(serialized);
  assert.equal(restored.version, 5);
  assert.deepEqual(restored.inventory.items, old.inventory.items);
  assert.deepEqual(restored.inventory.pets.map((pet) => [pet.speciesId, pet.level, pet.experience]),
    [['ladybug', 15, 420], ['caterpillar', 8, 75], ['caterpillar', 1, 0]]);
  assert.equal(restored.plantPhotos[0].imageUri, old.plantPhotos[0].imageUri);
  assert.deepEqual(restored.plantAnalyses[0].result.actions, []);
  assert.deepEqual(restored.dailyRounds, []);
  assert.equal(restored.plants[0].journey.phase, old.plants[0].journey.phase);
});

test('hydration retains missing round targets instead of silently completing them', () => {
  const state = recordPlantInspection(createGardenFixture(), input, now).state;
  state.plants = state.plants.filter((plant) => plant.id !== 'plant-mint');
  const restored = normalizePersistedState(state);
  assert.ok(restored.dailyRounds[0].plantIds.includes('plant-mint'));
  assert.equal(inspectGarden(restored).dailyPacks.length, 0);
});

test('empty owned collection can earn a pet without requiring a seeded inventory catalog', () => {
  const state = createGardenFixture();
  state.inventory.pets = [];
  const completed = inspectGarden(state);
  assert.equal(completed.dailyPacks.length, 1);
  assert.equal(completed.inventory.pets.length, 0);
  const opened = revealDailyPack(completed, completed.dailyPacks[0].id, now);
  assert.equal(opened.state.inventory.pets.length, 1);
  assert.equal(completed.dailyPacks[0].isNew, true);
});

test('Vietnam midnight starts a fresh snapshot and reward even with yesterday pack unopened', () => {
  const beforeMidnight = new Date('2026-10-25T16:59:59Z');
  const afterMidnight = new Date('2026-10-25T17:00:00Z');
  const yesterday = inspectGarden(createGardenFixture(), beforeMidnight);
  const today = inspectGarden(yesterday, afterMidnight);
  assert.equal(today.dailyPacks.length, 2);
  assert.equal(today.dailyRounds.length, 2);
  assert.deepEqual(today.dailyPacks.map((pack) => pack.date), ['2026-10-25', '2026-10-26']);
  assert.ok(today.dailyPacks.every((pack) => pack.revealedAt === null));
  assert.equal(today.plants[0].streak, yesterday.plants[0].streak + 1);
  const openedYesterday = revealDailyPack(today, yesterday.dailyPacks[0].id, afterMidnight).state;
  assert.equal(openedYesterday.daily.lastCatchDate, '2026-10-26');
  assert.equal(openedYesterday.dailyPacks[1].revealedAt, null);
});

test('returning an unchecked daily target to planning cannot make the frozen round impossible', () => {
  const first = recordPlantInspection(createGardenFixture(), input, now).state;
  assert.throws(() => updatePlantJourney(first, 'plant-mint', { phase: 'planning' }, now));
  assert.equal(updatePlantJourney(first, 'plant-map', { phase: 'planning' }, now).plants[0].journey.phase, 'planning');
});
