/** Cập nhật hồ sơ, ảnh, hội thoại và nhật ký chăm cây; quản lý lượt kiểm tra hằng ngày và mở thẻ thưởng theo giới hạn kho thú nuôi. */

import { localDateKey, localTimeKey, offsetLocalDate, PET_SPECIES } from '../data/seed';
import { t } from '../i18n/core';
import type {
  AiMode, Analysis, AppState, CaptureSource, CardRarity, CareEvent,
  DailyGardenRound, DailyPetPack, Plant, PlantChatMessage, PlantJourney,
  PlantPhase, PlantPhoto,
  StreakFoodReward,
} from '../types/app';
import { createId } from '../utils/id';
import { awardInspectionEconomy, creditPackBonus, rollPackBonus } from './economyActions';
import { createPetInstance } from './petCollection';
import { PET_CAPACITY } from '../data/petProgression';

export class PetCapacityError extends Error {
  constructor() {
    super(t('Kho thú nuôi đã đầy ({count}/{capacity}). Hãy dọn kho; hộp quà vẫn được giữ.', { count: PET_CAPACITY, capacity: PET_CAPACITY }));
    this.name = 'PetCapacityError';
  }
}

export interface ReferencePhotoInput {
  plantId: string;
  imageUri: string;
  source: CaptureSource;
  phase?: PlantPhase;
}
export interface CreateJourneyInput {
  name: string;
  species: string;
  emoji?: string;
  journey: PlantJourney;
  photo?: { imageUri: string; source: CaptureSource };
  assistantMessage?: string;
  mode?: AiMode;
}
export interface InspectionInput extends ReferencePhotoInput {
  analysis: Analysis;
  mode: 'gemini' | 'demo';
  /** AI candidates are suggestions; the selected record must be confirmed. */
  identityConfirmed: boolean;
}
export interface ChatMessageInput {
  plantId: string;
  role: 'user' | 'assistant';
  content: string;
  mode: AiMode;
  photoId?: string;
}
export interface CareEventInput {
  plantId: string;
  kind: CareEvent['kind'];
  note: string;
}
export interface InspectionResult {
  analysis: Analysis;
  firstToday: boolean;
  /** Planning profiles can receive care advice without joining daily rewards. */
  countsForDailyRound: boolean;
  photoId: string;
  round: DailyGardenRound | null;
  pack: DailyPetPack | null;
  goldAwarded: number;
  streakReward: StreakFoodReward | null;
}

export const CARD_POOL: readonly { beastId: string; rarity: CardRarity; weight: number }[] = [
  { beastId: 'caterpillar', rarity: 'Common', weight: 60 },
  { beastId: 'ladybug', rarity: 'Uncommon', weight: 25 },
  { beastId: 'hunter-bee', rarity: 'Rare', weight: 10 },
  { beastId: 'moon-moth', rarity: 'Epic', weight: 4 },
  { beastId: 'mantis', rarity: 'Legendary', weight: 1 },
];

export const PHASE_LABELS: Record<PlantPhase, string> = {
  planning: 'Chuẩn bị trồng', germinating: 'Đang ươm hạt', seedling: 'Cây con',
  growing: 'Đang lớn', flowering: 'Ra hoa', fruiting: 'Có quả',
};

export function eligibleGardenPlants(state: AppState): Plant[] {
  return visibleGardenPlants(state).filter((plant) => plant.journey.phase !== 'planning');
}

/** A planning profile still belongs in the garden, even before daily checks. */
export function visibleGardenPlants(state: AppState): Plant[] {
  return state.plants.filter((plant) => !plant.archived);
}

export function archivedGardenPlants(state: AppState): Plant[] {
  return state.plants.filter((plant) => plant.archived);
}

function requirePlant(state: AppState, id: string): Plant {
  const plant = state.plants.find((entry) => entry.id === id);
  if (!plant) throw new Error('Không tìm thấy hồ sơ cây.');
  return plant;
}

export function createPlantJourney(current: AppState, input: CreateJourneyInput, now = new Date()) {
  const name = input.name.trim();
  if (!name || !input.species.trim()) throw new Error('Hãy xác nhận tên cây và loại cây.');
  const plant: Plant = {
    id: createId('plant'), name, species: input.species.trim(), plantedAt: localDateKey(now),
    stage: PHASE_LABELS[input.journey.phase], progress: 0, health: 'Chưa đánh giá',
    mood: 'Hành trình mới', streak: 0, bestStreak: 0, lastCheckIn: null,
    journey: { ...input.journey }, archived: false,
  };
  let state: AppState = {
    ...current, activePlantId: plant.id, plants: [...current.plants, plant],
    plantChibis: [...current.plantChibis, { id: createId('chibi'), plantId: plant.id,
      sourcePhotoId: null, imageUri: null, fallbackEmoji: input.emoji || '🌱', updatedAt: null }],
  };
  let photoId: string | undefined;
  if (input.photo?.imageUri.trim()) {
    const added = addJourneyReference(state, { ...input.photo, plantId: plant.id }, now);
    state = added.state;
    photoId = added.photo.id;
  }
  const message = input.assistantMessage?.trim() ||
    t('Đây là hồ sơ riêng của {name}. Hãy ghi lại cách trồng, vị trí và ảnh theo từng giai đoạn. Chưa có đánh giá tình trạng từ ảnh.', { name: plant.name });
  state = appendPlantChat(state, { plantId: plant.id, role: 'assistant', content: message,
    mode: input.mode ?? 'demo', photoId }, now).state;
  return { state, plant };
}

export function updatePlantJourney(current: AppState, plantId: string, updates: Partial<PlantJourney>, now = new Date()) {
  const plant = requirePlant(current, plantId);
  const round = current.dailyRounds.find((entry) => entry.date === localDateKey(now));
  if (updates.phase === 'planning' && round?.plantIds.includes(plantId) && !round.inspectedPlantIds.includes(plantId)) {
    throw new Error('Cây này đã tham gia nhiệm vụ hôm nay. Hãy kiểm tra trước khi chuyển về chuẩn bị trồng.');
  }
  const journey = { ...plant.journey, ...updates };
  return { ...current, plants: current.plants.map((entry) => entry.id === plantId
    ? { ...entry, journey, stage: PHASE_LABELS[journey.phase] } : entry) };
}

export function addJourneyReference(current: AppState, input: ReferencePhotoInput, now = new Date()) {
  const plant = requirePlant(current, input.plantId);
  if (!input.imageUri.trim()) throw new Error('Cần ảnh thật làm tham chiếu.');
  const photo: PlantPhoto = {
    id: createId('photo'), plantId: plant.id, imageUri: input.imageUri, source: input.source,
    date: localDateKey(now), time: localTimeKey(now), purpose: 'reference',
    phase: input.phase ?? plant.journey.phase,
  };
  return { state: { ...current, plantPhotos: [photo, ...current.plantPhotos] }, photo };
}

export function appendPlantChat(current: AppState, input: ChatMessageInput, now = new Date()) {
  requirePlant(current, input.plantId);
  if (!input.content.trim()) throw new Error('Tin nhắn không được để trống.');
  if (input.photoId && !current.plantPhotos.some((photo) => photo.id === input.photoId && photo.plantId === input.plantId)) {
    throw new Error('Ảnh đính kèm không thuộc hồ sơ cây này.');
  }
  const message: PlantChatMessage = { ...input, id: createId('chat'), content: input.content.trim(), createdAt: now.toISOString() };
  return { state: { ...current, chatMessages: [...current.chatMessages, message] }, message };
}

export function addCareEvent(current: AppState, input: CareEventInput, now = new Date()) {
  requirePlant(current, input.plantId);
  const event: CareEvent = { ...input, id: createId('care'), note: input.note.trim(), createdAt: now.toISOString() };
  return { state: { ...current, careEvents: [event, ...current.careEvents] }, event };
}

/** Snapshot once. Additions after this point join the next day's round. */
export function beginDailyGardenRound(current: AppState, now = new Date()) {
  const date = localDateKey(now);
  const existing = current.dailyRounds.find((round) => round.date === date);
  if (existing) return { state: current, round: existing };
  const plantIds = eligibleGardenPlants(current).map((plant) => plant.id);
  if (!plantIds.length) return { state: current, round: null };
  const round: DailyGardenRound = { id: createId('round'), date, plantIds,
    inspectedPlantIds: [], createdAt: now.toISOString(), completedAt: null, packId: null };
  return { state: { ...current, dailyRounds: [...current.dailyRounds, round] }, round };
}

function awardCompletedRound(current: AppState, round: DailyGardenRound, now: Date, random: () => number, economyRandom: () => number) {
  if (!round.plantIds.length || !round.plantIds.every((id) => round.inspectedPlantIds.includes(id))) return current;
  if (round.packId || current.daily.lastCatchDate === round.date || current.dailyPacks.some((pack) => pack.date === round.date)) return current;
  const candidates = CARD_POOL.filter((card) => PET_SPECIES.some((pet) => pet.id === card.beastId));
  if (!candidates.length) return current;
  const total = candidates.reduce((sum, card) => sum + card.weight, 0);
  const sample = random();
  let ticket = (Number.isFinite(sample) ? Math.min(1 - Number.EPSILON, Math.max(0, sample)) : 0) * total;
  const selected = candidates.find((card) => (ticket -= card.weight) < 0) ?? candidates[candidates.length - 1];
  const beast = PET_SPECIES.find((pet) => pet.id === selected.beastId)!;
  const demo = round.plantIds.some((plantId) => current.plantAnalyses.some((entry) =>
    entry.plantId === plantId && entry.date === round.date && entry.mode !== 'gemini'));
  const pack: DailyPetPack = { id: createId('pack'), roundId: round.id, date: round.date,
    beastId: beast.id, rarity: selected.rarity, isNew: !current.inventory.pets.some((pet) => pet.speciesId === beast.id), earnedAt: now.toISOString(),
    revealedAt: null, creditedAt: null, demo, bonusFoodItemId: rollPackBonus(economyRandom) };
  pack.petInstanceId = `pet-${pack.id}`;
  return { ...current,
    dailyRounds: current.dailyRounds.map((entry) => entry.id === round.id
      ? { ...entry, packId: pack.id, completedAt: now.toISOString() } : entry),
    dailyPacks: [...current.dailyPacks, pack],
    daily: { lastCatchDate: round.date, lastCatchPlantId: null },
  } satisfies AppState;
}

export function recordPlantInspection(current: AppState, input: InspectionInput, now = new Date(), random = Math.random, economyRandom = Math.random): { state: AppState; result: InspectionResult } {
  const plant = requirePlant(current, input.plantId);
  if (plant.archived) throw new Error('Hãy khôi phục cây về vườn trước khi kiểm tra.');
  if (!input.identityConfirmed) throw new Error('Hãy xác nhận đúng hồ sơ cây trước khi lưu kiểm tra.');
  if (input.phase && input.phase !== plant.journey.phase) throw new Error('Giai đoạn cây đã thay đổi. Hãy xác nhận lại ảnh.');
  if (!input.imageUri.trim()) throw new Error('Cần ảnh để kiểm tra cây hôm nay.');
  if (!input.analysis.title.trim() || !input.analysis.summary.trim()) throw new Error('Chưa có kết quả phân tích hợp lệ.');
  const today = localDateKey(now);
  const time = localTimeKey(now);
  const countsForDailyRound = plant.journey.phase !== 'planning';
  const firstToday = countsForDailyRound && plant.lastCheckIn !== today;
  const streak = firstToday ? (plant.lastCheckIn === offsetLocalDate(-1, now) ? plant.streak + 1 : 1) : plant.streak;
  let state = countsForDailyRound ? beginDailyGardenRound(current, now).state : current;
  const photo: PlantPhoto = { id: createId('photo'), plantId: plant.id, imageUri: input.imageUri,
    source: input.source, date: today, time, purpose: countsForDailyRound ? 'checkin' : 'reference', phase: plant.journey.phase };
  const analysis = { ...input.analysis, actions: [...input.analysis.actions] };
  const analysisId = createId('analysis');
  state = { ...state, activePlantId: plant.id,
    plants: state.plants.map((entry) => entry.id === plant.id ? { ...entry, streak,
      bestStreak: countsForDailyRound ? Math.max(entry.bestStreak, streak) : entry.bestStreak,
      lastCheckIn: countsForDailyRound ? today : entry.lastCheckIn,
      health: input.mode === 'demo' ? 'Chưa đánh giá bằng trợ lý thông minh' : analysis.level === 'Tốt' ? (countsForDailyRound ? 'Đã kiểm tra' : 'Đã quan sát') : 'Cần theo dõi',
      mood: analysis.title } : entry),
    plantPhotos: [photo, ...state.plantPhotos],
    plantAnalyses: [{ id: analysisId, plantId: plant.id, photoId: photo.id, date: today, time, result: analysis, mode: input.mode }, ...state.plantAnalyses],
    checkIns: countsForDailyRound ? [{ id: createId('checkin'), plantId: plant.id, photoId: photo.id, analysisId, date: today, time }, ...state.checkIns] : state.checkIns,
    plantChibis: state.plantChibis.map((entry) => entry.plantId === plant.id ? { ...entry, sourcePhotoId: photo.id, updatedAt: now.toISOString() } : entry),
    dailyRounds: state.dailyRounds.map((round) => countsForDailyRound && round.date === today && round.plantIds.includes(plant.id)
      ? { ...round, inspectedPlantIds: [...new Set([...round.inspectedPlantIds, plant.id])] } : round),
  };
  const actions = analysis.actions.length
    ? `\n\n${t('Việc cần làm tiếp theo:')}\n${analysis.actions.map((action, index) => `${index + 1}. ${action}`).join('\n')}`
    : '';
  state = appendPlantChat(state, { plantId: plant.id, role: 'assistant',
    content: `${analysis.title}\n\n${analysis.summary}${actions}`, mode: input.mode, photoId: photo.id }, now).state;
  const rewards = firstToday ? awardInspectionEconomy(state, plant.id, plant.bestStreak, now, economyRandom)
    : { state, goldAwarded: 0, streakReward: null };
  state = rewards.state;
  const round = state.dailyRounds.find((entry) => entry.date === today) ?? null;
  if (countsForDailyRound && round) state = awardCompletedRound(state, round, now, random, economyRandom);
  return { state, result: { analysis, firstToday, countsForDailyRound, photoId: photo.id,
    goldAwarded: rewards.goldAwarded, streakReward: rewards.streakReward,
    round: state.dailyRounds.find((entry) => entry.date === today) ?? null,
    pack: state.dailyPacks.find((entry) => entry.date === today) ?? null } };
}

/** Frozen packs never take a slot until opened. Legacy packs were credited at earning. */
export function revealDailyPack(current: AppState, packId: string, now = new Date()) {
  const pack = current.dailyPacks.find((entry) => entry.id === packId);
  if (!pack) return { state: current, pack: null };
  if (pack.revealedAt) return { state: current, pack };
  const undelivered = pack.creditedAt === null;
  if (undelivered && current.inventory.pets.length >= PET_CAPACITY) throw new PetCapacityError();
  const petId = pack.petInstanceId ?? `pet-${pack.id}`;
  if (undelivered && current.inventory.pets.some((pet) => pet.id === petId)) throw new Error('Mã thú nuôi bị trùng. Hộp quà vẫn được giữ.');
  const revealed = { ...pack, petInstanceId: petId, revealedAt: now.toISOString(),
    creditedAt: pack.creditedAt ?? (undelivered ? now.toISOString() : pack.earnedAt) };
  const credited = creditPackBonus(undelivered ? { ...current, inventory: { ...current.inventory,
    pets: [...current.inventory.pets, createPetInstance(pack.beastId, petId)] } } : current, pack.bonusFoodItemId);
  return { state: { ...credited, dailyPacks: credited.dailyPacks.map((entry) => entry.id === packId ? revealed : entry) }, pack: revealed };
}

export function archivePlantJourney(current: AppState, plantId: string, now = new Date()) {
  requirePlant(current, plantId);
  const round = current.dailyRounds.find((entry) => entry.date === localDateKey(now));
  if (round?.plantIds.includes(plantId) && !round.inspectedPlantIds.includes(plantId)) {
    return { state: current, result: { ok: false, message: 'Cây này thuộc danh sách kiểm tra hôm nay. Hãy kiểm tra trước khi lưu trữ.' } };
  }
  const plants = current.plants.map((plant) => plant.id === plantId ? { ...plant, archived: true } : plant);
  return { state: { ...current, plants, activePlantId: current.activePlantId === plantId
    ? plants.find((plant) => !plant.archived)?.id ?? plantId : current.activePlantId },
  result: { ok: true, message: 'Đã lưu trữ hồ sơ; ảnh và lịch sử vẫn được giữ.' } };
}

/** Restore the same record, never create another plant or rebuild today's quota. */
export function restorePlantJourney(current: AppState, plantId: string, now = new Date()) {
  const plant = requirePlant(current, plantId);
  if (!plant.archived) {
    return { state: current, result: { ok: true, message: 'Cây này đã có trong vườn.' } };
  }
  const round = current.dailyRounds.find((entry) => entry.date === localDateKey(now));
  const joinsTomorrow = plant.journey.phase !== 'planning' && round && !round.plantIds.includes(plantId);
  return {
    state: { ...current, activePlantId: plantId,
      plants: current.plants.map((entry) => entry.id === plantId ? { ...entry, archived: false } : entry) },
    result: { ok: true, message: joinsTomorrow
      ? 'Đã khôi phục cây về vườn. Cây tham gia nhiệm vụ từ ngày mai vì danh sách hôm nay đã chốt.'
      : 'Đã khôi phục cây về vườn; ảnh, trò chuyện và chuỗi chăm sóc được giữ nguyên.' },
  };
}
