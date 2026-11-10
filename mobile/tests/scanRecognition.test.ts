/** Kiểm thử đối chiếu kết quả quét với cây trong vườn, yêu cầu xác nhận và loại kết quả mơ hồ hoặc lỗi thời. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGardenFixture } from './fixtures/gardenFixture';
import {
  confirmScanCandidate,
  mergeRecognitionBatches,
  resolveScanRecognition,
  type RecognitionResult,
} from '../src/utils/scanRecognition';

const plants = createGardenFixture().plants;
const match = (id: string): RecognitionResult => ({
  decision: 'candidate', candidateIds: [id], explanation: 'Chậu và lá tương tự. Hãy xác nhận cây.',
});

test('a single garden plant is not selected without a scan result and explicit confirmation', () => {
  const garden = [plants[0]];
  assert.equal(confirmScanCandidate(null, plants[0].id, garden), null);
  const suggestion = resolveScanRecognition(match(plants[0].id), garden);
  assert.deepEqual(suggestion.candidateIds, [plants[0].id]);
  assert.equal('confirmedPlantId' in suggestion, false);
  assert.equal(confirmScanCandidate(suggestion, plants[1].id, garden), null);
  assert.equal(confirmScanCandidate(suggestion, plants[0].id, garden), plants[0]);
  // Resetting the scan result must not recover the previous garden selection.
  assert.equal(confirmScanCandidate(null, plants[0].id, garden), null);
});

test('unknown and retake cannot retain candidate IDs or confirm any garden plant', () => {
  for (const decision of ['unknown', 'retake'] as const) {
    const result = { ...match(plants[0].id), decision };
    assert.deepEqual(resolveScanRecognition(result, plants).candidateIds, []);
    assert.equal(confirmScanCandidate(result, plants[0].id, plants), null);
  }
});

test('ambiguous results require a deliberate choice inside the returned candidate set', () => {
  const result: RecognitionResult = {
    decision: 'ambiguous', candidateIds: [plants[0].id, plants[1].id], explanation: 'Hai chậu tương tự.',
  };
  assert.equal(confirmScanCandidate(result, plants[2].id, plants), null);
  assert.equal(confirmScanCandidate(result, plants[1].id, plants), plants[1]);
});

test('archived or removed candidates cannot be confirmed from stale scan output', () => {
  const result = match(plants[0].id);
  for (const garden of [plants.slice(1), plants.map((plant) => ({ ...plant, archived: plant.id === plants[0].id }))]) {
    assert.equal(resolveScanRecognition(result, garden).decision, 'retake');
    assert.equal(confirmScanCandidate(result, plants[0].id, garden), null);
  }
  const ambiguous: RecognitionResult = {
    decision: 'ambiguous', candidateIds: [plants[0].id, plants[1].id], explanation: 'Hai cây tương tự.',
  };
  assert.equal(confirmScanCandidate(ambiguous, plants[1].id, plants.slice(1)), null);
});

test('malformed single or ambiguous suggestions fail closed', () => {
  assert.equal(resolveScanRecognition({ ...match(plants[0].id), candidateIds: [] }, plants).decision, 'retake');
  assert.equal(resolveScanRecognition({ ...match(plants[0].id), decision: 'ambiguous' }, plants).decision, 'retake');
  assert.equal(resolveScanRecognition({ ...match(plants[0].id), candidateIds: plants.map((plant) => plant.id) }, plants).decision, 'retake');
});

test('a scan phase snapshot accepts unchanged candidates and rejects changed or missing phases', () => {
  const plant = plants[0];
  const result = match(plant.id);
  const phases = { [plant.id]: plant.journey.phase };
  assert.equal(resolveScanRecognition(result, plants, phases).decision, 'candidate');
  assert.equal(confirmScanCandidate(result, plant.id, plants, phases), plant);
  const changedGarden = plants.map((entry) => entry.id === plant.id
    ? { ...entry, journey: { ...entry.journey, phase: 'growing' as const } } : entry);
  assert.equal(resolveScanRecognition(result, changedGarden, phases).decision, 'retake');
  assert.equal(confirmScanCandidate(result, plant.id, changedGarden, phases), null);
  assert.equal(resolveScanRecognition(result, plants, {}).decision, 'retake');
  assert.equal(confirmScanCandidate(result, plant.id, plants, {}), null);
});

test('phase changes in an ambiguous candidate set require a new scan, not silent narrowing', () => {
  const result: RecognitionResult = {
    decision: 'ambiguous', candidateIds: [plants[0].id, plants[1].id], explanation: 'Hai cây tương tự.',
  };
  const phases = Object.fromEntries(plants.map((plant) => [plant.id, plant.journey.phase]));
  const changedGarden = plants.map((plant) => plant.id === plants[0].id
    ? { ...plant, journey: { ...plant.journey, phase: 'flowering' as const } } : plant);
  assert.equal(resolveScanRecognition(result, changedGarden, phases).decision, 'retake');
  assert.equal(confirmScanCandidate(result, plants[1].id, changedGarden, phases), null);
});

test('whole-garden merging preserves all plausible candidates instead of choosing the first batch', () => {
  const garden = Array.from({ length: 8 }, (_, index) => ({ ...plants[0], id: `plant-${index}` }));
  const merged = mergeRecognitionBatches(garden.map((plant) => match(plant.id)), garden);
  assert.equal(merged.decision, 'ambiguous');
  assert.deepEqual(merged.candidateIds, garden.map((plant) => plant.id));
});

test('a low-quality batch invalidates an earlier candidate; unknown batches do not invent a match', () => {
  const retake: RecognitionResult = { decision: 'retake', candidateIds: [], explanation: 'Ảnh quá mờ.' };
  assert.deepEqual(mergeRecognitionBatches([match(plants[0].id), retake], plants), retake);
  const unknown: RecognitionResult = { decision: 'unknown', candidateIds: [], explanation: 'Không giống ảnh tham chiếu.' };
  assert.deepEqual(mergeRecognitionBatches([unknown, unknown], plants), unknown);
  assert.deepEqual(mergeRecognitionBatches([unknown, match(plants[1].id)], plants), match(plants[1].id));
});
