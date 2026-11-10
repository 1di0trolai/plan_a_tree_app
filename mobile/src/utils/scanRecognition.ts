/** Đối chiếu gợi ý nhận diện với cây và giai đoạn hiện có, gộp các lượt nhận diện và yêu cầu người dùng xác nhận trước khi chọn hồ sơ. */

import type { Plant, PlantPhase } from '../types/app';

export type RecognitionResult = {
  decision: 'candidate' | 'ambiguous' | 'unknown' | 'retake';
  candidateIds: string[];
  explanation: string;
};

/** A suggestion never selects a plant; the user must confirm a current garden record. */
export function resolveScanRecognition(
  result: RecognitionResult,
  plants: readonly Plant[],
  phases?: Readonly<Record<string, PlantPhase>>,
): RecognitionResult {
  if (result.decision === 'unknown' || result.decision === 'retake') {
    return { ...result, candidateIds: [] };
  }
  const availableIds = new Set(plants.filter((plant) => !plant.archived).map((plant) => plant.id));
  const currentPhases = new Map(plants.map((plant) => [plant.id, plant.journey.phase]));
  const candidateIds = [...new Set(result.candidateIds)];
  if (!candidateIds.length || candidateIds.some((id) => !availableIds.has(id))
    || (phases && candidateIds.some((id) => phases[id] === undefined || phases[id] !== currentPhases.get(id)))
    || (result.decision === 'candidate' && candidateIds.length !== 1)
    || (result.decision === 'ambiguous' && candidateIds.length < 2)) {
    return {
      decision: 'retake', candidateIds: [],
      explanation: 'Hồ sơ đối chiếu không còn phù hợp với vườn hiện tại. Hãy quét lại để kiểm tra đúng cây.',
    };
  }
  return { ...result, candidateIds };
}

/** Call only from a deliberate confirmation action, never on recognition completion. */
export function confirmScanCandidate(
  result: RecognitionResult | null,
  plantId: string,
  plants: readonly Plant[],
  phases?: Readonly<Record<string, PlantPhase>>,
): Plant | null {
  if (!result) return null;
  const current = resolveScanRecognition(result, plants, phases);
  if ((current.decision !== 'candidate' && current.decision !== 'ambiguous')
    || !current.candidateIds.includes(plantId)) return null;
  return plants.find((plant) => plant.id === plantId && !plant.archived) ?? null;
}

/** Merge only after EVERY batch succeeded. A partial garden scan is not a match. */
export function mergeRecognitionBatches(
  batches: readonly RecognitionResult[],
  plants: readonly Plant[],
): RecognitionResult {
  const results = batches.map((result) => resolveScanRecognition(result, plants));
  const retake = results.find((result) => result.decision === 'retake');
  if (retake) return { ...retake, candidateIds: [] };
  const matched = results.filter((result) => result.decision === 'candidate' || result.decision === 'ambiguous');
  const candidateIds = [...new Set(matched.flatMap((result) => result.candidateIds))];
  if (candidateIds.length > 1) return {
    decision: 'ambiguous', candidateIds,
    explanation: 'Có nhiều hồ sơ tương tự trong vườn. Hãy đối chiếu ảnh, chậu và vị trí trước khi xác nhận đúng cây; nếu chưa chắc, hãy quét lại.',
  };
  if (candidateIds.length === 1) return {
    decision: 'candidate', candidateIds, explanation: matched[0].explanation,
  };
  return {
    decision: 'unknown', candidateIds: [],
    explanation: results[0]?.explanation ?? 'Chưa tìm thấy hồ sơ phù hợp trong vườn.',
  };
}
