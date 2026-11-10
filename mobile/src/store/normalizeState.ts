/** Chuẩn hóa toàn bộ bản lưu thành trạng thái ứng dụng hiện tại, kiểm tra các trường dữ liệu và chuyển đổi cấu trúc cũ cho cây, kho đồ, kinh tế và cài đặt. */

import { createInitialState, localDateKey, PET_SPECIES } from '../data/seed';
import { MAX_PURCHASE_QUANTITY, SHOP_CATALOG, STREAK_REWARDS } from '../data/economy';
import { createEconomyState } from './economyActions';
import { isGardenerOutfit, parseReminderTime } from '../utils/profilePreferences';
import { migrateLegacyPets, normalizePetInstances } from './normalizePets';
import { normalizePetTransactions } from './normalizePetTransactions';
import { normalizeGiftDock, normalizeLoginVisits, normalizeMailbox, normalizeQuickSaleRarities } from './normalizeMailbox';
import type {
  AiTone, Analysis, AnalysisLevel, AppState, Beast, CaptureSource, CheckIn,
  InventoryItem, Plant, PlantAnalysisRecord, PlantChibi, PlantPhoto,
  AiMode, CardRarity, CareEvent, DailyGardenRound, DailyPetPack, PlantChatMessage,
  PlantJourney, PlantPhase, EconomyState,
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

function aiMode(value: unknown): AiMode {
  return value === 'gemini' || value === 'demo' ? value : 'legacy';
}

function plantPhase(value: unknown, fallback: PlantPhase = 'growing'): PlantPhase {
  return value === 'planning' || value === 'germinating' || value === 'seedling'
    || value === 'growing' || value === 'flowering' || value === 'fruiting' ? value : fallback;
}

function normalizeJourney(value: unknown, fallback: PlantJourney): PlantJourney {
  const raw = isRecord(value) ? value : {};
  return {
    crop: raw.crop === 'mango' || raw.crop === 'tomato' || raw.crop === 'chili' ? raw.crop : 'other',
    phase: plantPhase(raw.phase, fallback.phase),
    method: raw.method === 'seed' ? 'seed' : 'seedling',
    startedAt: stringValue(raw.startedAt, fallback.startedAt),
    location: stringValue(raw.location, ''), light: stringValue(raw.light, ''), notes: stringValue(raw.notes, ''),
  };
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
    // An empty list can correctly mean that no intervention is needed today.
    actions: [...actions],
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
    journey: { crop: 'other', phase: 'growing', method: 'seedling', startedAt: localDateKey(), location: '', light: '', notes: '' },
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
    journey: normalizeJourney(value.journey, { ...fallback.journey,
      startedAt: stringValue(value.plantedAt, fallback.plantedAt) }),
    archived: booleanValue(value.archived, false),
  };
}

const FALLBACK_ANALYSIS: Analysis = {
  level: 'Chú ý',
  title: 'Cây đang chờ lần kiểm tra mới',
  summary: 'Chưa có kết quả phân tích hợp lệ. Hãy thêm ảnh rõ nét để kiểm tra cây.',
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
    purpose: entry.purpose === 'reference' ? 'reference' as const : 'checkin' as const,
    phase: plantPhase(entry.phase),
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
    mode: aiMode(entry.mode),
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
        purpose: 'checkin',
        phase: 'growing',
      });
      plantAnalyses.push({
        id: analysisId,
        plantId,
        photoId,
        date,
        time,
        result: normalizeAnalysis(entry.analysis, FALLBACK_ANALYSIS),
        mode: 'legacy',
      });
    });
  });

  return { checkIns, plantPhotos, plantAnalyses };
}

function normalizeChibis(
  value: unknown,
  plants: Plant[],
  rawPlants: UnknownRecord[],
): PlantChibi[] {
  const saved = Array.isArray(value) ? value.filter(isRecord) : [];
  return plants.map((plant) => {
    const match = saved.find((entry) => entry.plantId === plant.id);
    const rawPlant = rawPlants.find((entry) => entry.id === plant.id);
    return {
      id: match ? stringValue(match.id, `chibi-${plant.id}`) : `chibi-${plant.id}`,
      plantId: plant.id,
      sourcePhotoId: match
        ? nullableString(match.sourcePhotoId, null)
        : null,
      imageUri: match ? nullableString(match.imageUri, null) : null,
      fallbackEmoji: match
        ? stringValue(match.fallbackEmoji, '🪴')
        : stringValue(rawPlant?.emoji, '🪴'),
      updatedAt: match ? nullableString(match.updatedAt, null) : null,
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

function savedRecords(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function normalizeChatMessages(value: unknown, plants: Plant[], photos: PlantPhoto[]): PlantChatMessage[] {
  return savedRecords(value).filter((entry) => plants.some((plant) => plant.id === entry.plantId)
    && typeof entry.content === 'string' && entry.content.trim()
    && (entry.role === 'user' || entry.role === 'assistant')).map((entry, index) => ({
    id: stringValue(entry.id, `restored-chat-${index}`), plantId: stringValue(entry.plantId, ''),
    role: entry.role === 'user' ? 'user' : 'assistant', content: stringValue(entry.content, ''),
    createdAt: stringValue(entry.createdAt, new Date().toISOString()), mode: aiMode(entry.mode),
    photoId: typeof entry.photoId === 'string' && photos.some((photo) => photo.id === entry.photoId && photo.plantId === entry.plantId)
      ? entry.photoId : undefined,
  }));
}

function normalizeCareEvents(value: unknown, plants: Plant[]): CareEvent[] {
  return savedRecords(value).filter((entry) => plants.some((plant) => plant.id === entry.plantId)).map((entry, index) => ({
    id: stringValue(entry.id, `restored-care-${index}`), plantId: stringValue(entry.plantId, ''),
    kind: entry.kind === 'water' || entry.kind === 'fertilize' || entry.kind === 'repot'
      || entry.kind === 'prune' || entry.kind === 'observe' ? entry.kind : 'other',
    note: stringValue(entry.note, ''), createdAt: stringValue(entry.createdAt, new Date().toISOString()),
  }));
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && !!entry))] : [];
}

function normalizeRounds(value: unknown): DailyGardenRound[] {
  const dates = new Set<string>();
  return savedRecords(value).filter((entry) => {
    if (typeof entry.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || dates.has(entry.date)) return false;
    dates.add(entry.date);
    return true;
  }).map((entry, index) => {
    // Retain even missing targets: deleting a record must not complete a round.
    const plantIds = stringIds(entry.plantIds);
    return { id: stringValue(entry.id, `restored-round-${index}`), date: stringValue(entry.date, ''), plantIds,
      inspectedPlantIds: stringIds(entry.inspectedPlantIds).filter((id) => plantIds.includes(id)),
      createdAt: stringValue(entry.createdAt, new Date().toISOString()),
      completedAt: nullableString(entry.completedAt, null), packId: nullableString(entry.packId, null) };
  });
}

function normalizePacks(value: unknown, beasts: readonly Beast[], sourceVersion: unknown): DailyPetPack[] {
  const rarities: CardRarity[] = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
  const dates = new Set<string>();
  return savedRecords(value).filter((entry) => {
    if (typeof entry.date !== 'string' || dates.has(entry.date)
      || !beasts.some((pet) => pet.id === entry.beastId) || !rarities.includes(entry.rarity as CardRarity)) return false;
    dates.add(entry.date);
    return true;
  }).map((entry, index) => ({
    id: stringValue(entry.id, `restored-pack-${index}`), roundId: stringValue(entry.roundId, ''),
    date: stringValue(entry.date, ''), beastId: stringValue(entry.beastId, ''), rarity: entry.rarity as CardRarity,
    isNew: booleanValue(entry.isNew, false), earnedAt: stringValue(entry.earnedAt, new Date().toISOString()),
    revealedAt: nullableString(entry.revealedAt, null), demo: booleanValue(entry.demo, true),
    ...(typeof entry.petInstanceId === 'string' ? { petInstanceId: entry.petInstanceId } : {}),
    creditedAt: sourceVersion === 5 ? nullableString(entry.creditedAt, null)
      : nullableString(entry.creditedAt, stringValue(entry.earnedAt, new Date().toISOString())),
    // Legacy packs retain the missing field: hydration never rolls or credits food.
    ...(Object.prototype.hasOwnProperty.call(entry, 'bonusFoodItemId') ? {
      bonusFoodItemId: typeof entry.bonusFoodItemId === 'string' && SHOP_CATALOG.some((food) => food.itemId === entry.bonusFoodItemId)
        ? entry.bonusFoodItemId : null,
    } : {}),
  }));
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function positiveInteger(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max;
}

function uniqueRecords(value: unknown, key: (entry: UnknownRecord) => string, valid: (entry: UnknownRecord) => boolean) {
  const seen = new Set<string>();
  return savedRecords(value).filter((entry) => {
    const id = key(entry);
    if (!valid(entry) || !id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Add the economy without replaying old inspections or changing existing assets. */
function normalizeEconomy(value: unknown): EconomyState {
  if (!isRecord(value)) return createEconomyState();
  const isFood = (id: unknown): id is string => typeof id === 'string' && SHOP_CATALOG.some((entry) => entry.itemId === id);
  const loginClaims = uniqueRecords(value.loginClaims, (entry) => String(entry.date ?? ''), (entry) =>
    validDate(entry.date) && isFood(entry.itemId) && positiveInteger(entry.cycleDay, 7) && typeof entry.claimedAt === 'string')
    .map((entry) => ({ date: entry.date as string, cycleDay: entry.cycleDay as number, itemId: entry.itemId as string, claimedAt: entry.claimedAt as string }));
  const inspectionRewards = uniqueRecords(value.inspectionRewards, (entry) => JSON.stringify([entry.plantId, entry.date]), (entry) =>
    typeof entry.plantId === 'string' && !!entry.plantId && validDate(entry.date)
    && typeof entry.gold === 'number' && Number.isSafeInteger(entry.gold) && entry.gold >= 0 && entry.gold <= 50)
    .map((entry) => ({ plantId: entry.plantId as string, date: entry.date as string, gold: entry.gold as number }));
  const streakRewards = uniqueRecords(value.streakRewards, (entry) => JSON.stringify([entry.plantId, entry.milestone]), (entry) =>
    typeof entry.plantId === 'string' && !!entry.plantId && typeof entry.claimedAt === 'string'
    && STREAK_REWARDS.some((reward) => reward.milestone === entry.milestone && reward.itemId === entry.itemId))
    .map((entry) => ({ plantId: entry.plantId as string, milestone: entry.milestone as number, itemId: entry.itemId as string, claimedAt: entry.claimedAt as string }));
  const purchases = uniqueRecords(value.purchases, (entry) => String(entry.requestId ?? ''), (entry) =>
    typeof entry.requestId === 'string' && !!entry.requestId.trim() && entry.requestId.length <= 200
    && positiveInteger(entry.quantity, MAX_PURCHASE_QUANTITY) && typeof entry.createdAt === 'string'
    // Receipts keep the historical price: later price tuning must not erase a
    // completed purchase and make its request ID spendable for a second time.
    && isFood(entry.itemId) && positiveInteger(entry.unitPrice) && positiveInteger(entry.totalGold)
    && entry.unitPrice * entry.quantity === entry.totalGold)
    .map((entry) => ({ requestId: entry.requestId as string, itemId: entry.itemId as string, quantity: entry.quantity as number,
      unitPrice: entry.unitPrice as number, totalGold: entry.totalGold as number, createdAt: entry.createdAt as string }));
  const petTransactions = normalizePetTransactions(value.petTransactions, purchases);
  return { gold: typeof value.gold === 'number' && Number.isSafeInteger(value.gold) && value.gold >= 0 ? value.gold : 0,
    ...(typeof value.demoMailGrantedAt === 'string' && Number.isFinite(Date.parse(value.demoMailGrantedAt))
      ? { demoMailGrantedAt: value.demoMailGrantedAt } : {}),
    loginClaims, loginVisits: normalizeLoginVisits(value.loginVisits, loginClaims),
    inspectionRewards, streakRewards, purchases, petTransactions };
}

export function normalizePersistedState(value: unknown): AppState {
  const seed = createInitialState();
  if (!isRecord(value)) return seed;

  const rawAuth = isRecord(value.auth) ? value.auth : {};
  const remember = booleanValue(rawAuth.remember, false);
  const rawProfile = isRecord(value.profile) ? value.profile : {};
  const rawInventory = isRecord(value.inventory) ? value.inventory : {};
  const rawSettings = isRecord(value.settings) ? value.settings : {};
  const rawDaily = isRecord(value.daily) ? value.daily : {};
  const rawPlants = Array.isArray(value.plants) ? value.plants.filter(isRecord) : [];
  const plants = rawPlants.map((plant, index) => normalizePlant(plant, blankPlant(index), index));
  const hasSeparatedPlantData = value.version === 2 || value.version === 3 || value.version === 4 || value.version === 5 || Array.isArray(value.checkIns);
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
  );
  const pets = value.version === 4 || value.version === 5 ? normalizePetInstances(rawInventory.pets) : migrateLegacyPets(rawInventory.beasts);
  const requestedPlantId = stringValue(value.activePlantId, plants[0]?.id ?? '');

  return {
    version: 5,
    auth: {
      // A non-remembered session intentionally ends whenever the app is reloaded.
      loggedIn: booleanValue(rawAuth.loggedIn, false) && remember,
      remember,
      identity: stringValue(rawAuth.identity, seed.auth.identity),
      ...(typeof rawAuth.userId === 'string' && rawAuth.userId.trim() ? { userId: rawAuth.userId } : {}),
    },
    profile: {
      // Keep the old display name first; fall back to the legacy handle only
      // when a saved profile did not have a meaningful name.
      name: stringValue(rawProfile.name, '').trim() || stringValue(rawProfile.username, '').trim() || seed.profile.name,
      title: stringValue(rawProfile.title, seed.profile.title),
      avatar: stringValue(rawProfile.avatar, seed.profile.avatar),
      avatarImageUri: nullableString(rawProfile.avatarImageUri, seed.profile.avatarImageUri),
      email: stringValue(rawProfile.email, ''),
      phone: stringValue(rawProfile.phone, ''),
      outfit: isGardenerOutfit(rawProfile.outfit) ? rawProfile.outfit : 'leaf',
    },
    plants,
    checkIns,
    plantPhotos,
    plantAnalyses,
    plantChibis,
    chatMessages: normalizeChatMessages(value.chatMessages, plants, plantPhotos),
    careEvents: normalizeCareEvents(value.careEvents, plants),
    dailyRounds: normalizeRounds(value.dailyRounds),
    dailyPacks: normalizePacks(value.dailyPacks, PET_SPECIES, value.version),
    economy: normalizeEconomy(value.economy),
    mailbox: normalizeMailbox(value.mailbox),
    activePlantId: plants.some((plant) => plant.id === requestedPlantId)
      ? requestedPlantId
      : plants[0]?.id ?? '',
    inventory: {
      pets,
      items: normalizeItems(rawInventory.items, seed.inventory.items),
    },
    settings: {
      notifications: rawSettings.notificationConsent === true && rawSettings.notifications === true,
      notificationConsent: rawSettings.notificationConsent === true,
      reminderTime: typeof rawSettings.reminderTime === 'string' && parseReminderTime(rawSettings.reminderTime)
        ? rawSettings.reminderTime.trim() : seed.settings.reminderTime,
      lightAR: booleanValue(rawSettings.lightAR, seed.settings.lightAR),
      music: rawSettings.musicConsent === true && rawSettings.music === true,
      musicConsent: rawSettings.musicConsent === true,
      musicUri: nullableString(rawSettings.musicUri, null),
      musicName: nullableString(rawSettings.musicName, null),
      aiTone: isAiTone(rawSettings.aiTone) ? rawSettings.aiTone : seed.settings.aiTone,
      giftDock: normalizeGiftDock(rawSettings.giftDock),
      quickSaleRarities: normalizeQuickSaleRarities(rawSettings.quickSaleRarities),
    },
    daily: {
      lastCatchDate: nullableString(rawDaily.lastCatchDate, null),
      lastCatchPlantId: nullableString(rawDaily.lastCatchPlantId, null),
    },
    battleNotify: booleanValue(value.battleNotify, seed.battleNotify),
  };
}
