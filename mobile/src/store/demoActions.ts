import { experienceForNextLevel, localDateKey, localTimeKey, offsetLocalDate } from '../data/seed';
import type {
  AppState, Analysis, Beast, CaptureSource, CheckIn, Plant, PlantAnalysisRecord, PlantPhoto,
} from '../types/app';
import { createId, fakeAnalysis, hashText, stageForProgress } from './demoHelpers';

export type MessageResult = { ok: boolean; message: string };
export type CheckInResult = { analysis: Analysis; firstToday: boolean };
export type CatchResult = { beast: Beast; isNew: boolean };
export type CheckInInput = { plantId: string; imageUri: string; source: CaptureSource };

// Pure demo transitions; persistence stays in AppProvider.
export function recordCheckIn(current: AppState, { plantId, imageUri, source }: CheckInInput, now = new Date()) {
  const plant = current.plants.find((entry) => entry.id === plantId);
  if (!plant) throw new Error('Cây này không còn trong vườn. Hãy chọn lại cây.');
  if (!imageUri.trim()) throw new Error('Hãy chụp hoặc chọn ảnh trước khi check-in.');
  const today = localDateKey(now);
  const time = localTimeKey(now);
  const analysis = fakeAnalysis(plant.id, today);
  const firstToday = plant.lastCheckIn !== today;
  const streak = firstToday
    ? plant.lastCheckIn === offsetLocalDate(-1, now)
      ? Math.max(1, plant.streak + 1)
      : 1
    : plant.streak;
  const photo: PlantPhoto = {
    id: createId('photo'),
    plantId: plant.id,
    imageUri,
    date: today,
    time,
    source,
  };
  const analysisRecord: PlantAnalysisRecord = {
    id: createId('analysis'),
    plantId: plant.id,
    photoId: photo.id,
    date: today,
    time,
    result: analysis,
  };
  const checkInEntry: CheckIn = {
    id: createId('checkin'),
    plantId: plant.id,
    photoId: photo.id,
    analysisId: analysisRecord.id,
    date: today,
    time,
  };
  const progress = Math.min(100, plant.progress + (firstToday ? 1 : 0));
  const nextPlant: Plant = {
    ...plant,
    progress,
    stage: stageForProgress(progress),
    health: analysis.level === 'Tốt' ? 'Khỏe mạnh' : 'Cần theo dõi',
    mood: analysis.title,
    streak,
    bestStreak: Math.max(plant.bestStreak, streak),
    lastCheckIn: today,
  };

  const state: AppState = {
    ...current,
    activePlantId: plant.id,
    plants: current.plants.map((entry) => (entry.id === plant.id ? nextPlant : entry)),
    checkIns: [checkInEntry, ...current.checkIns],
    plantPhotos: [photo, ...current.plantPhotos],
    plantAnalyses: [analysisRecord, ...current.plantAnalyses],
    plantChibis: current.plantChibis.map((chibi) =>
      chibi.plantId === plant.id
        ? { ...chibi, sourcePhotoId: photo.id, updatedAt: `${today}T${time}` }
        : chibi,
    ),
  };
  return { state, result: { analysis, firstToday } satisfies CheckInResult };
}

export function recordHunt(current: AppState, plantId: string, now = new Date()): { state: AppState; result: CatchResult | null } {
  const today = localDateKey(now);
  if (current.daily.lastCatchDate === today || !current.inventory.beasts.length
      || !current.plants.some((plant) => plant.id === plantId)) return { state: current, result: null };

  const pool = current.inventory.beasts;
  const selected = pool[hashText(`creature:${today}`) % pool.length];
  const isNew = !selected.owned;
  const caught: Beast = {
    ...selected,
    owned: true,
    quantity: selected.quantity + 1,
    level: Math.max(1, selected.level),
  };

  const state: AppState = {
    ...current,
    inventory: {
      ...current.inventory,
      beasts: current.inventory.beasts.map((beast) => (beast.id === caught.id ? caught : beast)),
    },
    daily: { lastCatchDate: today, lastCatchPlantId: plantId },
  };
  return { state, result: { beast: caught, isNew } };
}

export function consumePetFood(current: AppState, petId: string, itemId: string): { state: AppState; result: MessageResult } {
  const fail = (message: string) => ({ state: current, result: { ok: false, message } });
  const pet = current.inventory.beasts.find((entry) => entry.id === petId);
  const item = current.inventory.items.find((entry) => entry.id === itemId);
  if (!pet || !pet.owned || pet.quantity <= 0) return fail('Không tìm thấy pet trong bộ sưu tập.');
  if (!item) return fail('Không tìm thấy vật phẩm.');
  if (item.quantity <= 0) return fail('Vật phẩm này đã hết.');
  if (item.category !== 'Thức ăn' || item.experienceGain <= 0) return fail('Vật phẩm này không phải thức ăn cho pet.');

  let nextLevel = pet.level;
  let nextExperience = pet.experience + item.experienceGain;
  let levelUps = 0;
  while (nextExperience >= experienceForNextLevel(nextLevel)) {
    nextExperience -= experienceForNextLevel(nextLevel);
    nextLevel += 1;
    levelUps += 1;
  }

  const items = current.inventory.items.map((entry) =>
    entry.id === itemId ? { ...entry, quantity: Math.max(0, entry.quantity - 1) } : entry,
  );
  const state: AppState = {
    ...current,
    inventory: {
      ...current.inventory,
      items,
      beasts: current.inventory.beasts.map((entry) =>
        entry.id === petId
          ? { ...entry, level: nextLevel, experience: nextExperience }
          : entry,
      ),
    },
  };

  const levelMessage = levelUps > 0 ? ` và lên Lv.${nextLevel}!` : '.';
  return {
    state,
    result: {
      ok: true,
      message: `${pet.name} nhận +${item.experienceGain} EXP${levelMessage}`,
    },
  };
}
