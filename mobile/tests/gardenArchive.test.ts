/** Kiểm thử thêm, lưu trữ và khôi phục cây mà không mất lịch sử hoặc làm thay đổi mục tiêu thưởng đã chốt. */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createInitialState } from '../src/data/seed';
import {
  addCareEvent, archivedGardenPlants, archivePlantJourney, beginDailyGardenRound,
  createPlantJourney, eligibleGardenPlants, recordPlantInspection,
  restorePlantJourney, visibleGardenPlants,
} from '../src/store/journeyActions';
import { normalizePersistedState } from '../src/store/normalizeState';
import type { AppState, PlantPhase } from '../src/types/app';

const today = new Date('2026-10-26T03:00:00Z');
const tomorrow = new Date('2026-10-27T03:00:00Z');
const analysis = { level: 'Tốt' as const, title: 'Tiếp tục theo dõi', summary: 'Quan sát cây và kiểm tra độ ẩm thực tế.', actions: [] };

function addStarfruit(state = createInitialState(), phase: PlantPhase = 'planning') {
  return createPlantJourney(state, {
    name: 'Sao5Canh', species: 'Khế', mode: 'demo',
    journey: { crop: 'other', phase, method: 'seed', startedAt: '2026-10-26', location: '', light: '', notes: '' },
    photo: { imageUri: 'file:///my-starfruit.jpg', source: 'library' },
  }, today);
}

function inspect(state: AppState, plantId: string) {
  return recordPlantInspection(state, { plantId, source: 'camera', imageUri: `file:///${plantId}-today.jpg`,
    identityConfirmed: true, mode: 'gemini', analysis }, today, () => 0).state;
}

test('manual Khế enrollment is visible immediately with its exact species, without granting inventory or checks', () => {
  const initial = createInitialState();
  const created = addStarfruit(initial);
  assert.equal(created.plant.archived, false);
  assert.equal(created.plant.species, 'Khế');
  assert.equal(created.state.activePlantId, created.plant.id);
  assert.deepEqual(visibleGardenPlants(created.state), [created.plant]);
  assert.deepEqual(eligibleGardenPlants(created.state), []);
  assert.deepEqual(archivedGardenPlants(created.state), []);
  assert.deepEqual(created.state.inventory, initial.inventory);
  assert.deepEqual(created.state.checkIns, []);
  assert.deepEqual(created.state.dailyRounds, []);
  assert.deepEqual(created.state.dailyPacks, []);
  const hydrated = normalizePersistedState(JSON.parse(JSON.stringify(created.state)) as unknown);
  assert.equal(visibleGardenPlants(hydrated)[0].id, created.plant.id);
  assert.equal(visibleGardenPlants(hydrated)[0].species, 'Khế');
});

test('an archived-only garden exposes the saved record rather than treating the account as recordless', () => {
  const created = addStarfruit();
  const archived = archivePlantJourney(created.state, created.plant.id, today).state;
  assert.deepEqual(visibleGardenPlants(archived), []);
  assert.equal(archivedGardenPlants(archived).length, 1);
  assert.equal(archivedGardenPlants(archived)[0].name, 'Sao5Canh');
  assert.equal(archived.plants.length, 1);
  const restored = restorePlantJourney(archived, created.plant.id, today);
  assert.equal(restored.result.ok, true);
  assert.equal(visibleGardenPlants(restored.state)[0].id, created.plant.id);
  assert.deepEqual(archivedGardenPlants(restored.state), []);
  assert.equal(restored.state.activePlantId, created.plant.id);
  assert.equal(restored.state.plants.length, 1);
});

test('restoring preserves the same identity, photos, analysis, chat, care records, streak and inventory', () => {
  const created = addStarfruit(createInitialState(), 'growing');
  const checked = inspect(created.state, created.plant.id);
  const cared = addCareEvent(checked, { plantId: created.plant.id, kind: 'observe', note: 'Đất còn ẩm.' }, today).state;
  const archived = archivePlantJourney(cared, created.plant.id, today).state;
  const saved = normalizePersistedState(JSON.parse(JSON.stringify(archived)) as unknown);
  const restored = restorePlantJourney(saved, created.plant.id, today).state;
  assert.deepEqual(restored.plants[0], { ...saved.plants[0], archived: false });
  for (const key of ['plantPhotos', 'plantAnalyses', 'plantChibis', 'chatMessages', 'careEvents', 'checkIns', 'dailyRounds', 'dailyPacks', 'inventory', 'daily'] as const) {
    assert.deepEqual(restored[key], saved[key], key);
  }
  assert.equal(restored.plants[0].streak, 1);
  assert.equal(restored.plantPhotos.length, 2);
  assert.equal(restored.chatMessages.length, created.state.chatMessages.length + 1);
});

test('restoring before the daily snapshot includes a growing plant but not a planning record', () => {
  const growing = addStarfruit(createInitialState(), 'growing');
  const planning = addStarfruit(growing.state);
  const archived = archivePlantJourney(planning.state, growing.plant.id, today).state;
  const restored = restorePlantJourney(archived, growing.plant.id, today).state;
  assert.equal(visibleGardenPlants(restored).length, 2);
  assert.deepEqual(beginDailyGardenRound(restored, today).round?.plantIds, [growing.plant.id]);
});

test('restoring after the snapshot joins tomorrow, never edits the frozen target set', () => {
  const first = addStarfruit(createInitialState(), 'growing');
  const second = addStarfruit(first.state, 'growing');
  const archived = archivePlantJourney(second.state, second.plant.id, today).state;
  const snapshot = beginDailyGardenRound(archived, today).state;
  const restored = restorePlantJourney(snapshot, second.plant.id, today);
  assert.match(restored.result.message, /ngày mai/);
  assert.deepEqual(restored.state.dailyRounds, snapshot.dailyRounds);
  const checkedRestored = inspect(restored.state, second.plant.id);
  assert.deepEqual(checkedRestored.dailyRounds[0].plantIds, [first.plant.id]);
  assert.deepEqual(checkedRestored.dailyRounds[0].inspectedPlantIds, []);
  assert.deepEqual(checkedRestored.dailyPacks, []);
  assert.equal(checkedRestored.daily.lastCatchDate, null);
  const completed = inspect(checkedRestored, first.plant.id);
  assert.equal(completed.dailyPacks.length, 1);
  assert.deepEqual(beginDailyGardenRound(completed, tomorrow).round?.plantIds, [first.plant.id, second.plant.id]);
});

test('archive/restore cannot reroll or re-award a completed daily pack', () => {
  const created = addStarfruit(createInitialState(), 'seedling');
  const completed = inspect(created.state, created.plant.id);
  const archived = archivePlantJourney(completed, created.plant.id, today).state;
  const restored = restorePlantJourney(archived, created.plant.id, today).state;
  const repeated = inspect(restored, created.plant.id);
  assert.deepEqual(repeated.dailyPacks, completed.dailyPacks);
  assert.deepEqual(repeated.inventory, completed.inventory);
  assert.deepEqual(repeated.daily, completed.daily);
  assert.equal(repeated.plants[0].streak, completed.plants[0].streak);
});

test('restoring is idempotent and cannot invent an unknown plant', () => {
  const created = addStarfruit();
  assert.equal(restorePlantJourney(created.state, created.plant.id, today).state, created.state);
  assert.throws(() => restorePlantJourney(created.state, 'missing-id', today), /Không tìm thấy/);
  assert.equal(created.state.plants.length, 1);
});
