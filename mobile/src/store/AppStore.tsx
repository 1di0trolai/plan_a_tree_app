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

import { createSeedState, localDateKey } from '../data/seed';
import type { AppState, Plant, PlantChibi, Profile, Settings } from '../types/app';
import { isIdentityValid } from '../utils/validation';
import { deleteCheckInPhoto } from '../utils/checkInPhotos';
import { normalizePersistedState } from './normalizeState';
import { createId } from './demoHelpers';
import {
  consumePetFood,
  recordCheckIn,
  recordHunt,
  type CheckInInput,
  type CheckInResult,
  type CatchResult,
  type MessageResult,
} from './demoActions';

export const STORAGE_KEY = 'PAT_MOBILE_STATE_V1';

type ActionResult = { ok: boolean; message?: string };

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
  checkIn: (input: CheckInInput) => CheckInResult;
  catchCreature: (plantId: string) => CatchResult | null;
  selectCompanion: (id: string) => void;
  feedPet: (petId: string, itemId: string) => MessageResult;
  updateProfile: (updates: Partial<Profile>) => void;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  toggleBattleNotify: () => void;
  resetDemo: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);
export function AppProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AppState>(() => createSeedState());
  const [ready, setReady] = useState(false);
  const stateRef = useRef(state);
  const writeQueue = useRef(Promise.resolve());
  const persistedPhotoUris = useRef<string[]>([]);

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
      persistedPhotoUris.current = next.plantPhotos.map((photo) => photo.imageUri);
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
    // Preserve write order when several actions happen before SQLite finishes.
    const snapshot = JSON.stringify(state);
    const photoUris = state.plantPhotos.map((photo) => photo.imageUri);
    writeQueue.current = writeQueue.current.then(async () => {
      await storage.setItem(STORAGE_KEY, snapshot);
      const removedUris = persistedPhotoUris.current.filter((uri) => !photoUris.includes(uri));
      persistedPhotoUris.current = photoUris;
      for (const uri of removedUris) {
        if (stateRef.current.plantPhotos.some((photo) => photo.imageUri === uri)) continue;
        try {
          deleteCheckInPhoto(uri);
        } catch (error) {
          console.warn('Không thể xóa bản sao ảnh check-in.', error);
        }
      }
    }).catch((error: unknown) => {
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
        return plant && plant.id !== current.activePlantId
          ? { ...current, activePlantId: plant.id }
          : current;
      });
    },
    [commit],
  );

  const login = useCallback(
    (identity: string, password: string, remember: boolean): ActionResult => {
      const cleanIdentity = identity.trim().toLowerCase();
      if (!isIdentityValid(cleanIdentity)) {
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
        auth: { loggedIn: false, remember: false, identity: cleanEmail },
        profile: { ...current.profile, name: cleanName },
      }));
      return { ok: true };
    },
    [commit],
  );

  const forgotPassword = useCallback((identity: string): MessageResult => {
    const cleanIdentity = identity.trim().toLowerCase();
    if (!isIdentityValid(cleanIdentity)) {
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

  const checkIn = useCallback((input: CheckInInput): CheckInResult => {
    const { state: next, result } = recordCheckIn(stateRef.current, input);
    commit(() => next);
    return result;
  }, [commit]);

  const catchCreature = useCallback((plantId: string): CatchResult | null => {
    const { state: next, result } = recordHunt(stateRef.current, plantId);
    commit(() => next);
    return result;
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

  const feedPet = useCallback((petId: string, itemId: string): MessageResult => {
    const { state: next, result } = consumePetFood(stateRef.current, petId, itemId);
    commit(() => next);
    return result;
  }, [commit]);

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
