import storage from 'expo-sqlite/kv-store';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import {
  createSeedState,
  experienceForNextLevel,
  localDateKey,
  localTimeKey,
  offsetLocalDate,
} from '../data/seed';
import type {
  AiTone,
  Analysis,
  AnalysisLevel,
  AppState,
  Beast,
  CaptureSource,
  CheckIn,
  InventoryItem,
  Plant,
  PlantAnalysisRecord,
  PlantChibi,
  PlantPhoto,
  Profile,
  Settings,
} from '../types/app';

export const STORAGE_KEY = 'PAT_MOBILE_STATE_V1';

type ActionResult = { ok: boolean; message?: string };
type MessageResult = { ok: boolean; message: string };
type CheckInResult = { analysis: Analysis; firstToday: boolean };
type CatchResult = { beast: Beast; isNew: boolean };

export interface AppContextValue {
  ready: boolean;
  state: AppState;
  activePlantIndex: number;
  activePlant: Plant;
  setActivePlantIndex: (index: number) => void;
  login: (identity: string, password: string, remember: boolean) => ActionResult;
  register: (name: string, email: string, password: string) => ActionResult;
  forgotPassword: (identity: string) => MessageResult;
  logout: () => void;
  addPlant: (plant: { name: string; species: string; emoji: string }) => void;
  removePlant: (id: string) => void;
  checkIn: (input: { plantId: string; imageUri: string; source: CaptureSource }) => CheckInResult;
  catchCreature: (plantId: string) => CatchResult | null;
  selectCompanion: (id: string) => void;
  feedPet: (petId: string, itemId: string) => MessageResult;
  updateProfile: (updates: Partial<Profile>) => void;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  toggleBattleNotify: () => void;
  resetDemo: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

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
  return {
    id: stringValue(value.id, fallback.id || `restored-plant-${index}`),
    name: stringValue(value.name, fallback.name),
    species: stringValue(value.species, fallback.species),
    plantedAt: stringValue(value.plantedAt, fallback.plantedAt),
    stage: stringValue(value.stage, fallback.stage),
    progress: numberValue(value.progress, fallback.progress, 0, 100),
    health: stringValue(value.health, fallback.health),
    mood: stringValue(value.mood, fallback.mood),
    streak: Math.trunc(numberValue(value.streak, fallback.streak)),
    bestStreak: Math.trunc(numberValue(value.bestStreak, fallback.bestStreak)),
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
  return plants.map((plant, index) => {
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
      owned: quantity > 0 || booleanValue(match.owned, seed.owned),
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

function normalizePersistedState(value: unknown): AppState {
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

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function fakeAnalysis(plantId: string, date: string): Analysis {
  const results: Analysis[] = [
    {
      level: 'Tốt',
      title: 'Cây trông rất khỏe',
      summary: 'Lá có màu đồng đều và chưa thấy dấu hiệu sâu bệnh rõ ràng.',
      actions: ['Giữ lịch tưới hiện tại', 'Tiếp tục đặt cây ở nơi sáng tán xạ'],
    },
    {
      level: 'Chú ý',
      title: 'Cây có dấu hiệu thiếu nước nhẹ',
      summary: 'Một vài mép lá hơi rũ. Đây là kết quả mô phỏng từ ảnh bạn chọn.',
      actions: ['Kiểm tra độ ẩm đất', 'Tưới chậm nếu 2–3 cm mặt đất đã khô'],
    },
    {
      level: 'Chú ý',
      title: 'Nên bổ sung ánh sáng',
      summary: 'Tán lá có vẻ đang hướng về một phía để tìm nguồn sáng.',
      actions: ['Đưa cây gần cửa sổ hơn', 'Xoay chậu 1/4 vòng sau mỗi 3 ngày'],
    },
    {
      level: 'Cảnh báo',
      title: 'Phát hiện đốm lá cần theo dõi',
      summary: 'Ảnh có vùng màu bất thường. Hãy kiểm tra trực tiếp trước khi xử lý.',
      actions: ['Cách ly lá có đốm nếu lan rộng', 'Giữ lá khô và tăng thông thoáng'],
    },
  ];
  return cloneAnalysis(results[hashText(`${plantId}:${date}`) % results.length]);
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function stageForProgress(progress: number): string {
  if (progress >= 90) return 'Trưởng thành';
  if (progress >= 65) return 'Đang lớn';
  return 'Cây non';
}

function validIdentity(identity: string): boolean {
  const compact = identity.replace(/[\s.-]/g, '');
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity);
  const isPhone = /^(?:\+?84|0)\d{9}$/.test(compact);
  return isEmail || isPhone;
}

export function AppProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AppState>(() => createSeedState());
  const [ready, setReady] = useState(false);
  const stateRef = useRef(state);

  const commit = useCallback((update: (current: AppState) => AppState) => {
    const next = update(stateRef.current);
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function hydrate() {
      let next = createSeedState();
      try {
        const stored = await storage.getItem(STORAGE_KEY);
        if (stored) next = normalizePersistedState(JSON.parse(stored) as unknown);
      } catch (error) {
        console.warn('Không thể đọc dữ liệu PAT, đang dùng dữ liệu mẫu.', error);
      }

      if (!mounted) return;
      stateRef.current = next;
      setState(next);
      setReady(true);
    }

    void hydrate();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    void storage.setItem(STORAGE_KEY, JSON.stringify(state)).catch((error: unknown) => {
      console.warn('Không thể lưu dữ liệu PAT.', error);
    });
  }, [ready, state]);

  const activePlantIndex = Math.max(
    0,
    state.plants.findIndex((plant) => plant.id === state.activePlantId),
  );
  const activePlant = state.plants[activePlantIndex] ?? state.plants[0]!;

  const setActivePlantIndex = useCallback(
    (index: number) => {
      commit((current) => {
        const safeIndex = Math.max(0, Math.min(Math.trunc(index), current.plants.length - 1));
        const plant = current.plants[safeIndex];
        return plant ? { ...current, activePlantId: plant.id } : current;
      });
    },
    [commit],
  );

  const login = useCallback(
    (identity: string, password: string, remember: boolean): ActionResult => {
      const cleanIdentity = identity.trim().toLowerCase();
      if (!validIdentity(cleanIdentity)) {
        return { ok: false, message: 'Hãy nhập email hoặc số điện thoại hợp lệ.' };
      }
      if (password.length < 6) {
        return { ok: false, message: 'Mật khẩu cần có ít nhất 6 ký tự.' };
      }

      commit((current) => ({
        ...current,
        auth: { loggedIn: true, remember, identity: cleanIdentity },
      }));
      return { ok: true };
    },
    [commit],
  );

  const register = useCallback(
    (name: string, email: string, password: string): ActionResult => {
      const cleanName = name.trim();
      const cleanEmail = email.trim().toLowerCase();
      if (cleanName.length < 2) return { ok: false, message: 'Tên cần có ít nhất 2 ký tự.' };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return { ok: false, message: 'Email chưa đúng định dạng.' };
      }
      if (password.length < 6) {
        return { ok: false, message: 'Mật khẩu cần có ít nhất 6 ký tự.' };
      }

      commit((current) => ({
        ...current,
        auth: { loggedIn: true, remember: false, identity: cleanEmail },
        profile: { ...current.profile, name: cleanName },
      }));
      return { ok: true };
    },
    [commit],
  );

  const forgotPassword = useCallback((identity: string): MessageResult => {
    const cleanIdentity = identity.trim().toLowerCase();
    if (!validIdentity(cleanIdentity)) {
      return { ok: false, message: 'Hãy nhập email hoặc số điện thoại hợp lệ.' };
    }
    return {
      ok: true,
      message: 'Đây là bản demo: yêu cầu đặt lại mật khẩu đã được mô phỏng thành công.',
    };
  }, []);

  const logout = useCallback(() => {
    commit((current) => ({
      ...current,
      auth: { ...current.auth, loggedIn: false, remember: false },
    }));
  }, [commit]);

  const addPlant = useCallback(
    ({ name, species, emoji }: { name: string; species: string; emoji: string }) => {
      const plant: Plant = {
        id: createId('plant'),
        name: name.trim() || 'Cây của tôi',
        species: species.trim() || 'Chưa xác định',
        plantedAt: localDateKey(),
        stage: 'Cây non',
        progress: 5,
        health: 'Chưa đánh giá',
        mood: 'Đang chờ ảnh đầu tiên',
        streak: 0,
        bestStreak: 0,
        lastCheckIn: null,
      };
      const chibi: PlantChibi = {
        id: createId('chibi'),
        plantId: plant.id,
        sourcePhotoId: null,
        imageUri: null,
        fallbackEmoji: emoji.trim() || '🪴',
        updatedAt: null,
      };
      commit((current) => ({
        ...current,
        plants: [...current.plants, plant],
        plantChibis: [...current.plantChibis, chibi],
        activePlantId: plant.id,
      }));
    },
    [commit],
  );

  const removePlant = useCallback(
    (id: string) => {
      commit((current) => {
        if (current.plants.length <= 1 || !current.plants.some((plant) => plant.id === id)) {
          return current;
        }
        const plants = current.plants.filter((plant) => plant.id !== id);
        return {
          ...current,
          plants,
          checkIns: current.checkIns.filter((entry) => entry.plantId !== id),
          plantPhotos: current.plantPhotos.filter((entry) => entry.plantId !== id),
          plantAnalyses: current.plantAnalyses.filter((entry) => entry.plantId !== id),
          plantChibis: current.plantChibis.filter((entry) => entry.plantId !== id),
          activePlantId:
            current.activePlantId === id ? plants[0].id : current.activePlantId,
        };
      });
    },
    [commit],
  );

  const checkIn = useCallback(
    ({ plantId, imageUri, source }: { plantId: string; imageUri: string; source: CaptureSource }): CheckInResult => {
      const current = stateRef.current;
      const plant = current.plants.find((entry) => entry.id === plantId) ?? current.plants[0];
      const today = localDateKey();
      const time = localTimeKey();
      const analysis = fakeAnalysis(plant.id, today);
      const firstToday = plant.lastCheckIn !== today;
      const streak = firstToday
        ? plant.lastCheckIn === offsetLocalDate(-1)
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

      commit((latest) => ({
        ...latest,
        activePlantId: plant.id,
        plants: latest.plants.map((entry) => (entry.id === plant.id ? nextPlant : entry)),
        checkIns: [checkInEntry, ...latest.checkIns],
        plantPhotos: [photo, ...latest.plantPhotos],
        plantAnalyses: [analysisRecord, ...latest.plantAnalyses],
        plantChibis: latest.plantChibis.map((chibi) =>
          chibi.plantId === plant.id
            ? { ...chibi, sourcePhotoId: photo.id, updatedAt: `${today}T${time}` }
            : chibi,
        ),
      }));
      return { analysis, firstToday };
    },
    [commit],
  );

  const catchCreature = useCallback((plantId: string): CatchResult | null => {
    const current = stateRef.current;
    const today = localDateKey();
    if (current.daily.lastCatchDate === today) return null;

    const pool = current.inventory.beasts;
    const selected = pool[hashText(`creature:${today}`) % pool.length];
    const isNew = !selected.owned;
    const caught: Beast = {
      ...selected,
      owned: true,
      quantity: selected.quantity + 1,
      level: Math.max(1, selected.level),
    };

    commit((latest) => ({
      ...latest,
      inventory: {
        ...latest.inventory,
        beasts: latest.inventory.beasts.map((beast) => (beast.id === caught.id ? caught : beast)),
      },
      daily: { lastCatchDate: today, lastCatchPlantId: plantId },
    }));
    return { beast: caught, isNew };
  }, [commit]);

  const selectCompanion = useCallback(
    (id: string) => {
      commit((current) =>
        current.inventory.beasts.some((beast) => beast.id === id && beast.owned)
          ? {
              ...current,
              inventory: { ...current.inventory, companionId: id },
            }
          : current,
      );
    },
    [commit],
  );

  const feedPet = useCallback(
    (petId: string, itemId: string): MessageResult => {
      const current = stateRef.current;
      const pet = current.inventory.beasts.find((entry) => entry.id === petId);
      const item = current.inventory.items.find((entry) => entry.id === itemId);
      if (!pet || !pet.owned) return { ok: false, message: 'Không tìm thấy pet trong bộ sưu tập.' };
      if (!item) return { ok: false, message: 'Không tìm thấy vật phẩm.' };
      if (item.quantity <= 0) return { ok: false, message: 'Vật phẩm này đã hết.' };
      if (item.experienceGain <= 0) return { ok: false, message: 'Vật phẩm này không phải thức ăn cho pet.' };

      let nextLevel = pet.level;
      let nextExperience = pet.experience + item.experienceGain;
      let levelUps = 0;
      while (nextExperience >= experienceForNextLevel(nextLevel)) {
        nextExperience -= experienceForNextLevel(nextLevel);
        nextLevel += 1;
        levelUps += 1;
      }

      commit((latest) => {
        const items = latest.inventory.items.map((entry) =>
          entry.id === itemId ? { ...entry, quantity: Math.max(0, entry.quantity - 1) } : entry,
        );
        return {
          ...latest,
          inventory: {
            ...latest.inventory,
            items,
            beasts: latest.inventory.beasts.map((entry) =>
              entry.id === petId
                ? { ...entry, level: nextLevel, experience: nextExperience }
                : entry,
            ),
          },
        };
      });

      const levelMessage = levelUps > 0 ? ` và lên Lv.${nextLevel}!` : '.';
      return {
        ok: true,
        message: `${pet.name} nhận +${item.experienceGain} EXP${levelMessage}`,
      };
    },
    [commit],
  );

  const updateProfile = useCallback(
    (updates: Partial<Profile>) => {
      commit((current) => ({
        ...current,
        profile: {
          ...current.profile,
          ...updates,
          name: updates.name?.trim() || current.profile.name,
          title: updates.title?.trim() || current.profile.title,
        },
      }));
    },
    [commit],
  );

  const updateSetting = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      commit((current) => ({
        ...current,
        settings: { ...current.settings, [key]: value },
      }));
    },
    [commit],
  );

  const toggleBattleNotify = useCallback(() => {
    commit((current) => ({ ...current, battleNotify: !current.battleNotify }));
  }, [commit]);

  const resetDemo = useCallback(() => {
    const next = createSeedState();
    stateRef.current = next;
    setState(next);
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      ready,
      state,
      activePlantIndex,
      activePlant,
      setActivePlantIndex,
      login,
      register,
      forgotPassword,
      logout,
      addPlant,
      removePlant,
      checkIn,
      catchCreature,
      selectCompanion,
      feedPet,
      updateProfile,
      updateSetting,
      toggleBattleNotify,
      resetDemo,
    }),
    [
      activePlant,
      activePlantIndex,
      addPlant,
      catchCreature,
      checkIn,
      feedPet,
      forgotPassword,
      login,
      logout,
      ready,
      register,
      removePlant,
      selectCompanion,
      setActivePlantIndex,
      state,
      toggleBattleNotify,
      updateProfile,
      updateSetting,
      resetDemo,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider.');
  return context;
}
