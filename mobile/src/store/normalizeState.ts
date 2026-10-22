import { createSeedState, localDateKey } from '../data/seed';
import type {
  AiTone, Analysis, AnalysisLevel, AppState, Beast, CaptureSource, CheckIn,
  InventoryItem, Plant, PlantAnalysisRecord, PlantChibi, PlantPhoto,
} from '../types/app';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableString(value: unknown, fallback: string | null): string | null {
  return value === null ? null : typeof value === 'string' ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberValue(value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function isAnalysisLevel(value: unknown): value is AnalysisLevel {
  return value === 'Tốt' || value === 'Chú ý' || value === 'Cảnh báo';
}

function isAiTone(value: unknown): value is AiTone {
  return value === 'funny' || value === 'gentle' || value === 'expert' || value === 'minimal';
}

function cloneAnalysis(analysis: Analysis): Analysis {
  return { ...analysis, actions: [...analysis.actions] };
}

function normalizeAnalysis(value: unknown, fallback: Analysis): Analysis {
  if (!isRecord(value)) return cloneAnalysis(fallback);
  const actions = Array.isArray(value.actions)
    ? value.actions.filter((action): action is string => typeof action === 'string')
    : fallback.actions;

  return {
    level: isAnalysisLevel(value.level) ? value.level : fallback.level,
    title: stringValue(value.title, fallback.title),
    summary: stringValue(value.summary, fallback.summary),
    actions: actions.length > 0 ? [...actions] : [...fallback.actions],
  };
}

function blankPlant(index: number): Plant {
  return {
    id: `restored-plant-${index}`,
    name: 'Cây của tôi',
    species: 'Chưa xác định',
    plantedAt: localDateKey(),
    stage: 'Cây non',
    progress: 0,
    health: 'Chưa đánh giá',
    mood: 'Đang chờ ảnh',
    streak: 0,
    bestStreak: 0,
    lastCheckIn: null,
  };
}

function normalizePlant(value: UnknownRecord, fallback: Plant, index: number): Plant {
  const streak = Math.trunc(numberValue(value.streak, fallback.streak));
  return {
    id: stringValue(value.id, fallback.id || `restored-plant-${index}`),
    name: stringValue(value.name, fallback.name),
    species: stringValue(value.species, fallback.species),
    plantedAt: stringValue(value.plantedAt, fallback.plantedAt),
    stage: stringValue(value.stage, fallback.stage),
    progress: numberValue(value.progress, fallback.progress, 0, 100),
    health: stringValue(value.health, fallback.health),
    mood: stringValue(value.mood, fallback.mood),
    streak,
    bestStreak: Math.max(streak, Math.trunc(numberValue(value.bestStreak, fallback.bestStreak))),
    lastCheckIn: nullableString(value.lastCheckIn, fallback.lastCheckIn),
  };
}

const FALLBACK_ANALYSIS: Analysis = {
  level: 'Tốt',
  title: 'Cây đang chờ lần kiểm tra mới',
  summary: 'Hãy thêm một ảnh để nhận kết quả mô phỏng.',
  actions: ['Chụp cây trong điều kiện đủ sáng'],
};

function captureSource(value: unknown): CaptureSource {
  return value === 'camera' ? 'camera' : 'library';
}

function normalizeCheckIns(value: unknown): CheckIn[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry, index) => ({
    id: stringValue(entry.id, `restored-checkin-${index}`),
    plantId: stringValue(entry.plantId, ''),
    photoId: stringValue(entry.photoId, ''),
    analysisId: stringValue(entry.analysisId, ''),
    date: stringValue(entry.date, localDateKey()),
    time: stringValue(entry.time, '08:00'),
  })).filter((entry) => entry.plantId && entry.photoId && entry.analysisId);
}

function normalizePhotos(value: unknown): PlantPhoto[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry, index) => ({
    id: stringValue(entry.id, `restored-photo-${index}`),
    plantId: stringValue(entry.plantId, ''),
    imageUri: stringValue(entry.imageUri, ''),
    date: stringValue(entry.date, localDateKey()),
    time: stringValue(entry.time, '08:00'),
    source: captureSource(entry.source),
  })).filter((entry) => entry.plantId);
}

function normalizeAnalyses(value: unknown): PlantAnalysisRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry, index) => ({
    id: stringValue(entry.id, `restored-analysis-${index}`),
    plantId: stringValue(entry.plantId, ''),
    photoId: stringValue(entry.photoId, ''),
    date: stringValue(entry.date, localDateKey()),
    time: stringValue(entry.time, '08:00'),
    result: normalizeAnalysis(entry.result, FALLBACK_ANALYSIS),
  })).filter((entry) => entry.plantId && entry.photoId);
}

function migrateLegacyPlantRecords(rawPlants: UnknownRecord[]) {
  const checkIns: CheckIn[] = [];
  const plantPhotos: PlantPhoto[] = [];
  const plantAnalyses: PlantAnalysisRecord[] = [];

  rawPlants.forEach((rawPlant, plantIndex) => {
    const plantId = stringValue(rawPlant.id, `restored-plant-${plantIndex}`);
    const history = Array.isArray(rawPlant.history) ? rawPlant.history.filter(isRecord) : [];
    history.forEach((entry, entryIndex) => {
      const checkInId = stringValue(entry.id, `legacy-${plantId}-${entryIndex}`);
      const photoId = `${checkInId}-photo`;
      const analysisId = `${checkInId}-analysis`;
      const date = stringValue(entry.date, localDateKey());
      const time = stringValue(entry.time, '08:00');
      checkIns.push({ id: checkInId, plantId, photoId, analysisId, date, time });
      plantPhotos.push({
        id: photoId,
        plantId,
        imageUri: stringValue(entry.imageUri, ''),
        date,
        time,
        source: 'library',
      });
      plantAnalyses.push({
        id: analysisId,
        plantId,
        photoId,
        date,
        time,
        result: normalizeAnalysis(entry.analysis, FALLBACK_ANALYSIS),
      });
    });
  });

  return { checkIns, plantPhotos, plantAnalyses };
}

function normalizeChibis(
  value: unknown,
  plants: Plant[],
  rawPlants: UnknownRecord[],
  seeds: PlantChibi[],
): PlantChibi[] {
  const saved = Array.isArray(value) ? value.filter(isRecord) : [];
  return plants.map((plant) => {
    const match = saved.find((entry) => entry.plantId === plant.id);
    const seed = seeds.find((entry) => entry.plantId === plant.id);
    const rawPlant = rawPlants.find((entry) => entry.id === plant.id);
    return {
      id: match ? stringValue(match.id, `chibi-${plant.id}`) : seed?.id ?? `chibi-${plant.id}`,
      plantId: plant.id,
      sourcePhotoId: match
        ? nullableString(match.sourcePhotoId, null)
        : seed?.sourcePhotoId ?? null,
      imageUri: match ? nullableString(match.imageUri, null) : seed?.imageUri ?? null,
      fallbackEmoji: match
        ? stringValue(match.fallbackEmoji, seed?.fallbackEmoji ?? '🪴')
        : stringValue(rawPlant?.emoji, seed?.fallbackEmoji ?? '🪴'),
      updatedAt: match ? nullableString(match.updatedAt, null) : seed?.updatedAt ?? null,
    };
  });
}

function normalizeBeasts(value: unknown, seeds: Beast[]): Beast[] {
  const saved = Array.isArray(value) ? value.filter(isRecord) : [];
  return seeds.map((seed) => {
    const match = saved.find((entry) => entry.id === seed.id);
    if (!match) return { ...seed };
    const quantity = Math.trunc(numberValue(match.quantity, seed.quantity));
    return {
      ...seed,
      level: Math.max(1, Math.trunc(numberValue(match.level, seed.level, 1))),
      experience: Math.trunc(numberValue(match.experience, seed.experience)),
      quantity,
      owned: quantity > 0,
    };
  });
}

function normalizeItems(value: unknown, seeds: InventoryItem[]): InventoryItem[] {
  const saved = Array.isArray(value) ? value.filter(isRecord) : [];
  return seeds.map((seed) => {
    const match = saved.find((entry) => entry.id === seed.id);
    return {
      ...seed,
      quantity: match ? Math.trunc(numberValue(match.quantity, seed.quantity)) : seed.quantity,
    };
  });
}

export function normalizePersistedState(value: unknown): AppState {
  const seed = createSeedState();
  if (!isRecord(value)) return seed;

  const rawAuth = isRecord(value.auth) ? value.auth : {};
  const remember = booleanValue(rawAuth.remember, false);
  const rawProfile = isRecord(value.profile) ? value.profile : {};
  const rawInventory = isRecord(value.inventory) ? value.inventory : {};
  const rawSettings = isRecord(value.settings) ? value.settings : {};
  const rawDaily = isRecord(value.daily) ? value.daily : {};
  const rawPlants = Array.isArray(value.plants) ? value.plants.filter(isRecord) : [];
  const plants =
    rawPlants.length > 0
      ? rawPlants.map((plant, index) =>
          normalizePlant(plant, seed.plants[index] ?? blankPlant(index), index),
        )
      : seed.plants;
  const hasSeparatedPlantData = value.version === 2 || Array.isArray(value.checkIns);
  const legacyPlantData = hasSeparatedPlantData
    ? null
    : migrateLegacyPlantRecords(rawPlants);
  const checkIns = hasSeparatedPlantData
    ? normalizeCheckIns(value.checkIns)
    : legacyPlantData?.checkIns ?? [];
  const plantPhotos = hasSeparatedPlantData
    ? normalizePhotos(value.plantPhotos)
    : legacyPlantData?.plantPhotos ?? [];
  const plantAnalyses = hasSeparatedPlantData
    ? normalizeAnalyses(value.plantAnalyses)
    : legacyPlantData?.plantAnalyses ?? [];
  const plantChibis = normalizeChibis(
    value.plantChibis,
    plants,
    rawPlants,
    seed.plantChibis,
  );
  const beasts = normalizeBeasts(rawInventory.beasts, seed.inventory.beasts);
  const requestedCompanion = nullableString(rawInventory.companionId, seed.inventory.companionId);
  const companionId = beasts.some((beast) => beast.id === requestedCompanion && beast.owned)
    ? requestedCompanion
    : beasts.find((beast) => beast.owned)?.id ?? null;
  const requestedPlantId = stringValue(value.activePlantId, plants[0].id);

  return {
    version: 2,
    auth: {
      // A non-remembered session intentionally ends whenever the app is reloaded.
      loggedIn: booleanValue(rawAuth.loggedIn, false) && remember,
      remember,
      identity: stringValue(rawAuth.identity, seed.auth.identity),
    },
    profile: {
      name: stringValue(rawProfile.name, seed.profile.name),
      title: stringValue(rawProfile.title, seed.profile.title),
      avatar: stringValue(rawProfile.avatar, seed.profile.avatar),
      avatarImageUri: nullableString(rawProfile.avatarImageUri, seed.profile.avatarImageUri),
    },
    plants,
    checkIns,
    plantPhotos,
    plantAnalyses,
    plantChibis,
    activePlantId: plants.some((plant) => plant.id === requestedPlantId)
      ? requestedPlantId
      : plants[0].id,
    inventory: {
      beasts,
      items: normalizeItems(rawInventory.items, seed.inventory.items),
      companionId,
    },
    settings: {
      notifications: booleanValue(rawSettings.notifications, seed.settings.notifications),
      reminderTime: stringValue(rawSettings.reminderTime, seed.settings.reminderTime),
      lightAR: booleanValue(rawSettings.lightAR, seed.settings.lightAR),
      music: booleanValue(rawSettings.music, seed.settings.music),
      aiTone: isAiTone(rawSettings.aiTone) ? rawSettings.aiTone : seed.settings.aiTone,
    },
    daily: {
      lastCatchDate: nullableString(rawDaily.lastCatchDate, null),
      lastCatchPlantId: nullableString(rawDaily.lastCatchPlantId, null),
    },
    battleNotify: booleanValue(value.battleNotify, seed.battleNotify),
  };
}
