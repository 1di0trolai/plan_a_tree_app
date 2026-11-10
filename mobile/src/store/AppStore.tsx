/** Cung cấp trạng thái dùng chung và các thao tác tài khoản, chăm cây, kho đồ, quà và hòm thư. Điều phối lưu trên thiết bị, phiên đăng nhập và tự đồng bộ với máy chủ. */

import storage from 'expo-sqlite/kv-store';
import { t } from '../i18n/core';
import { AppState as NativeAppState } from 'react-native';
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

import { createInitialState } from '../data/seed';
import type { AppState, CareEvent, DailyPetPack, Plant, PlantChatMessage, PlantJourney, Profile, Settings } from '../types/app';
import { accountAuth, AccountAuthError, type AuthEnvelope, type AuthUser, type RememberedLogin, type SocialProvider } from '../services/accountAuth';
import { resetSocialLoginSession, startSocialLogin } from '../services/socialLogin';
import { loadAccountData } from './accountStorage';
import { cloudSync } from '../services/cloudSync';
import { cloudAssetFiles } from '../services/cloudAssets';
import { createCloudStorage, type CloudStorage, type SyncStatus } from './cloudStorage';
import { validateAccountProfile, type AccountProfileInput } from '../utils/profilePreferences';
import {
  cancelDailyReminders, deleteBackgroundMusicFile, listBackgroundMusicUris, withPreferenceReset,
} from '../services/preferences';
import { setPreferenceError } from '../services/preferenceStatus';
import { deleteCheckInPhoto, listCheckInPhotoUris, withCheckInPhotoReset } from '../utils/checkInPhotos';
import {
  STORAGE_KEY, loadStoredUserData, saveStoredUserData, statePhotoUris,
  type StoredUserData, type UserStorage,
} from './storageLifecycle';
import {
  addCareEvent, appendPlantChat, archivePlantJourney,
  createPlantJourney, recordPlantInspection,
  restorePlantJourney, updatePlantJourney,
  type CareEventInput, type ChatMessageInput, type CreateJourneyInput,
  type InspectionInput, type InspectionResult,
} from './journeyActions';
import type {
  MessageResult, PetTransactionInput, SellPetCopiesInput, UpgradePetInput, FeedPetInput, QuickFeedPetInput,
} from './petActions';
import type { FoodPurchaseInput } from './economyActions';
import {
  createEconomyTransactions, type PurchaseResult, type ClaimLoginResult,
  type PetTransactionResult, type RewardIntent,
} from './economyTransactions';
export type { PurchaseResult, ClaimLoginResult, PetTransactionResult } from './economyTransactions';

type ActionResult = { ok: boolean; message?: string; cancelled?: boolean };

export interface AppContextValue {
  ready: boolean;
  storageError: string | null;
  syncStatus: SyncStatus;
  retrySync: () => Promise<MessageResult>;
  reloadCloud: () => Promise<MessageResult>;
  retryStorage: () => void;
  state: AppState;
  activePlant: Plant | null;
  setActivePlantIndex: (index: number) => void;
  login: (identity: string, password: string, remember: boolean) => Promise<ActionResult>;
  loginSocial: (provider: SocialProvider, remember: boolean) => Promise<ActionResult>;
  linkSocial: (provider: SocialProvider) => Promise<ActionResult>;
  account: AuthUser | null;
  rememberedEmail: string;
  /** SecureStore autofill in memory only; never part of persisted AppState. */
  rememberedPassword: string;
  rememberLogin: boolean;
  updateRememberLogin: (enabled: boolean) => Promise<ActionResult>;
  register: (name: string, email: string, password: string) => Promise<ActionResult>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<MessageResult>;
  requestPasswordReset: (email: string) => Promise<MessageResult>;
  resetPassword: (token: string, newPassword: string) => Promise<MessageResult>;
  logout: () => void;
  removePlant: (id: string) => MessageResult;
  restorePlant: (id: string) => MessageResult;
  createJourney: (input: CreateJourneyInput) => Plant;
  updateJourney: (plantId: string, updates: Partial<PlantJourney>) => MessageResult;
  saveInspection: (input: InspectionInput) => InspectionResult;
  appendChatMessage: (input: ChatMessageInput) => PlantChatMessage;
  recordCareEvent: (input: CareEventInput) => CareEvent;
  openDailyPack: (packId: string) => DailyPetPack | null;
  /** Wait for the latest whole-state SQLite commit before showing rewards. */
  persistNow: () => Promise<void>;
  feedPet: (input: FeedPetInput) => Promise<PetTransactionResult>;
  quickFeedPet: (input: QuickFeedPetInput) => Promise<PetTransactionResult>;
  sellPetCopies: (input: SellPetCopiesInput) => Promise<PetTransactionResult>;
  upgradePet: (input: UpgradePetInput) => Promise<PetTransactionResult>;
  pendingPetTransaction: PetTransactionInput | null;
  purchaseFood: (input: FoodPurchaseInput) => Promise<PurchaseResult>;
  pendingFoodPurchase: FoodPurchaseInput | null;
  claimLoginReward: (giftId?: string) => Promise<ClaimLoginResult>;
  syncLoginVisit: () => Promise<PurchaseResult>;
  markMailRead: (id: string) => Promise<PurchaseResult>;
  markAllMailRead: () => Promise<PurchaseResult>;
  claimMail: (id: string) => Promise<PurchaseResult>;
  claimAllMail: () => Promise<PurchaseResult>;
  deleteMail: (id: string) => Promise<PurchaseResult>;
  deleteAllMail: () => Promise<PurchaseResult>;
  retryRewardAction: () => Promise<PurchaseResult>;
  pendingRewardAction: boolean;
  updateProfile: (updates: Partial<Profile>) => void;
  updateAccountProfile: (updates: AccountProfileInput) => Promise<ActionResult>;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

const AppContext = createContext<AppContextValue | null>(null);
export function AppProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AppState>(() => createInitialState());
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ phase: 'idle', message: '' });
  const backgroundSyncBusy = useRef(false);
  const syncRetryAttempt = useRef(0);
  const cloud = useRef<CloudStorage | null>(null);
  const [hydrationAttempt, setHydrationAttempt] = useState(0);
  const [pendingFoodPurchase, setPendingFoodPurchase] = useState<FoodPurchaseInput | null>(null);
  const purchaseIntent = useRef<FoodPurchaseInput | null>(null);
  const [pendingPetTransaction, setPendingPetTransaction] = useState<PetTransactionInput | null>(null);
  const petIntent = useRef<PetTransactionInput | null>(null);
  const rewardIntent = useRef<RewardIntent | null>(null);
  const [pendingRewardAction, setPendingRewardAction] = useState(false);
  const rewardWrite = useRef<Promise<PurchaseResult> | null>(null);
  const stateRef = useRef(state);
  const writeQueue = useRef(Promise.resolve());
  const persistedRecord = useRef<StoredUserData | null>(null);
  const legacyRecord = useRef<StoredUserData | null>(null);
  const activeStorage = useRef<UserStorage | null>(null);
  const session = useRef<AuthEnvelope | null>(null);
  const [account, setAccount] = useState<AuthUser | null>(null);
  const [rememberedEmail, setRememberedEmail] = useState('');
  const [rememberedPassword, setRememberedPassword] = useState('');
  const [rememberLogin, setRememberLogin] = useState(false);
  const rememberedLogin = useRef<RememberedLogin | null>(null);
  const authOperation = useRef(false);
  const sessionWrites = useRef(Promise.resolve());
  const resetting = useRef(true);
  // Suppress late success feedback after logout/reset or a different login.
  const economySession = useRef(0);
  const storagePort = useMemo<UserStorage>(() => ({
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => storage.setItem(key, value),
    listPhotos: listCheckInPhotoUris,
    deletePhoto: (uri) => {
      // An asynchronous save may be older than the state currently on screen.
      // Keep a file if a newer action has referenced it again.
      if (!resetting.current && statePhotoUris(stateRef.current).includes(uri)) {
        throw new Error('Ảnh vẫn đang được sử dụng.');
      }
      deleteCheckInPhoto(uri);
    },
    listMusic: listBackgroundMusicUris,
    deleteMusic: (uri) => {
      if (!resetting.current && stateRef.current.settings.musicUri === uri) {
        throw new Error('Bản nhạc vẫn đang được sử dụng.');
      }
      deleteBackgroundMusicFile(uri);
    },
  }), []);

  const commit = useCallback((update: (current: AppState) => AppState) => {
    if (resetting.current) throw new Error('PAT đang xử lý dữ liệu. Vui lòng thử lại sau.');
    if (cloud.current?.blocked() && stateRef.current.auth.loggedIn)
      throw new Error('Hãy hoàn tất đồng bộ dữ liệu đang chờ trước khi tiếp tục.');
    const next = update(stateRef.current);
    stateRef.current = next;
    setState(next);
  }, []);

  const persistSnapshot = useCallback((snapshotState: AppState) => {
    if (resetting.current) return Promise.reject(new Error('PAT đang xử lý dữ liệu.'));
    const port = activeStorage.current ?? storagePort;
    const controller = cloud.current;
    // Catch previous failures so a later explicit retry can still save.
    const write = writeQueue.current.catch(() => {}).then(async () => {
      const previous = persistedRecord.current;
      if (!previous) throw new Error('Dữ liệu PAT chưa tải xong.');
      persistedRecord.current = await saveStoredUserData(port, previous, snapshotState);
      // Local durability succeeds independently of connectivity. The outbox is
      // atomic with that save and survives a force-close before a network retry.
      if (controller && snapshotState.auth.loggedIn) {
        try {
          const synced = await controller.flush(() => stateRef.current === snapshotState);
          if (cloud.current === controller) {
            persistedRecord.current = synced;
            if (stateRef.current === snapshotState && JSON.stringify(synced.state) !== JSON.stringify(snapshotState)) {
              stateRef.current = synced.state; setState(synced.state);
            }
          }
        } catch { /* Sync status exposes the durable pending save. */ }
      }
    });
    writeQueue.current = write;
    return write;
  }, [storagePort]);

  const openCloud = useCallback(async (loaded: { port: UserStorage; record: StoredUserData }, envelope: AuthEnvelope) => {
    const controller = createCloudStorage({ ...loaded, api: cloudSync, files: cloudAssetFiles,
      user: () => session.current?.user.id === envelope.user.id ? session.current.user : envelope.user,
      token: () => session.current?.user.id === envelope.user.id ? session.current.session.token : envelope.session.token,
      onStatus: status => { if (cloud.current === controller) setSyncStatus(status); },
    });
    const record = await controller.open();
    return { port: controller.port, record, cloud: controller };
  }, []);

  const persistNow = useCallback(async () => {
    const intent = rewardIntent.current;
    await persistSnapshot(stateRef.current);
    // Card opening uses a synchronous transition, then this durable boundary.
    if (intent?.key.startsWith('pack:') && rewardIntent.current === intent) {
      rewardIntent.current = null;
      setPendingRewardAction(false);
    }
  }, [persistSnapshot]);

  const retryStorage = useCallback(() => {
    economySession.current += 1;
    resetting.current = true;
    setStorageError(null);
    setReady(false);
    setHydrationAttempt((attempt) => attempt + 1);
  }, []);

  useEffect(() => {
    let mounted = true;
    resetting.current = true;

    async function hydrate() {
      try {
        // Serialize initialization too: React Strict Mode may mount the effect
        // twice, but no late initializer may overwrite a newly created garden.
        const load = writeQueue.current.catch(() => {}).then(async () => {
          if (mounted) setReady(false);
          const original = await withPreferenceReset(() => withCheckInPhotoReset(() => loadStoredUserData(storagePort)), false);
          legacyRecord.current = original;
          let remembered = await accountAuth.loadRememberedLogin();
          let saved = await accountAuth.loadSession();
          if (saved) {
            // Earlier sessions can restore email, but cannot invent a password.
            if (!remembered) {
              remembered = { email: saved.user.email };
              await accountAuth.saveRememberedLogin(remembered.email);
            }
            try {
              const user = await accountAuth.me(saved.session.token);
              if (user.id.toLowerCase() !== saved.user.id.toLowerCase()) throw new AccountAuthError('INVALID_SESSION', 'Vui lòng đăng nhập lại.', 401);
              saved = { ...saved, user };
              const loaded = await openCloud(await loadAccountData(storagePort, user, original), saved);
              return { ...loaded, session: saved, remembered, record: { ...loaded.record,
                state: { ...loaded.record.state, auth: { ...loaded.record.state.auth, remember: true } } } };
            } catch (cause) {
              if (cause instanceof AccountAuthError && cause.status === 401) await accountAuth.saveSession(null);
              // A network outage is not a logout. Keep the credential and let
              // the existing retry action validate it again, never trust a local flag.
              else throw cause;
            }
          }
          return { port: storagePort, session: null, remembered, record: { ...original,
            state: { ...original.state, auth: { ...original.state.auth, loggedIn: false, remember: remembered !== null } } } };
        });
        writeQueue.current = load.then(() => {}, () => {});
        const loaded = await load;
        const record = loaded.record;
        if (!mounted) return;
        session.current = loaded.session;
        setAccount(loaded.session?.user ?? null);
        rememberedLogin.current = loaded.remembered;
        setRememberedEmail(loaded.remembered?.email ?? '');
        setRememberedPassword(loaded.remembered?.password ?? '');
        setRememberLogin(loaded.remembered !== null);
        activeStorage.current = loaded.port;
        cloud.current = 'cloud' in loaded ? loaded.cloud : null;
        setSyncStatus(cloud.current?.status() ?? { phase: 'idle', message: '' });
        persistedRecord.current = record;
        purchaseIntent.current = null;
        setPendingFoodPurchase(null);
        petIntent.current = null;
        setPendingPetTransaction(null);
        rewardIntent.current = null;
        setPendingRewardAction(false);
        stateRef.current = record.state;
        setState(record.state);
        if (record.pendingPhotoCleanup.length > 0 || (record.pendingMusicCleanup?.length ?? 0) > 0) {
          setStorageError('Dữ liệu cũ đã được xóa, nhưng một số bản sao ảnh hoặc nhạc chưa xóa được. Hãy thử lại để hoàn tất.');
          return;
        }
        resetting.current = false;
        setStorageError(null);
        setReady(true);
      } catch (error) {
        if (!mounted) return;
        setStorageError(error instanceof Error
          ? t('Chưa thể mở dữ liệu PAT: {message}', { message: t(error.message) })
          : 'Chưa thể mở dữ liệu PAT. Hãy thử lại; dữ liệu không bị tự động ghi đè khi đọc lỗi.');
      }
    }

    void hydrate();
    return () => {
      mounted = false;
    };
  }, [hydrationAttempt, storagePort, openCloud]);

  useEffect(() => {
    if (!ready || resetting.current) return;
    void persistSnapshot(stateRef.current).catch((error: unknown) => {
      console.warn('Không thể lưu dữ liệu PAT.', error);
    });
  }, [persistSnapshot, ready, state]);

  const synchronize = useCallback(async (force = false, background = false): Promise<MessageResult> => {
    const controller = cloud.current; const epoch = economySession.current;
    if (!controller || !session.current || resetting.current)
      return { ok: false, message: 'Hãy đăng nhập hoặc đợi thao tác hiện tại.' };
    if (purchaseIntent.current || petIntent.current || rewardIntent.current)
      return { ok: false, message: 'Hãy hoàn tất lưu giao dịch đang chờ trước.' };
    if (background && controller.status().phase === 'conflict') return { ok: false, message: 'Hãy xử lý xung đột đồng bộ trước.' };
    if (background && (backgroundSyncBusy.current || controller.status().phase === 'syncing'))
      return { ok: false, message: 'Đang đồng bộ…' };
    // Freeze local mutations while replacing a clean snapshot. This also keeps
    // a late download from overwriting an action made on this phone meanwhile.
    const before = stateRef.current;
    if (background) backgroundSyncBusy.current = true;
    const write = persistSnapshot(before);
    if (!background) resetting.current = true;
    try {
      await write;
      // A failed push already left a durable outbox. Do not immediately issue
      // another request via refresh; let the foreground backoff retry it.
      const status = controller.status();
      if (!force && ['offline', 'error', 'conflict'].includes(status.phase))
        return { ok: false, message: status.message };
      const guardState = stateRef.current;
      const stable = JSON.stringify(guardState) === JSON.stringify(controller.record().state);
      const record = await controller.refresh(force, () => stable && stateRef.current === guardState);
      if (economySession.current !== epoch || cloud.current !== controller) throw new Error('Phiên sử dụng đã thay đổi.');
      persistedRecord.current = record;
      if (!background || stable && stateRef.current === guardState) { stateRef.current = record.state; setState(record.state); }
      return { ok: true, message: 'Đã đồng bộ dữ liệu.' };
    } catch (cause) { return { ok: false, message: cause instanceof Error ? cause.message : 'Chưa đồng bộ được. Dữ liệu trên máy vẫn được giữ lại.' }; }
    finally {
      if (background) backgroundSyncBusy.current = false;
      if (!background && economySession.current === epoch) resetting.current = false;
    }
  }, [persistSnapshot]);
  const retrySync = useCallback(() => synchronize(), [synchronize]);
  const reloadCloud = useCallback(() => synchronize(true), [synchronize]);

  useEffect(() => {
    if (!ready || !state.auth.loggedIn || syncStatus.phase === 'synced') syncRetryAttempt.current = 0;
    if (!ready || !state.auth.loggedIn || !syncStatus.retryable) return;
    const controller = cloud.current;
    const epoch = economySession.current;
    if (!controller) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const retry = () => {
      if (!active || cloud.current !== controller || economySession.current !== epoch
        || !session.current || NativeAppState.currentState !== 'active') return;
      if (resetting.current || authOperation.current || backgroundSyncBusy.current
        || purchaseIntent.current || petIntent.current || rewardIntent.current
        || controller.status().phase === 'syncing') {
        timer = setTimeout(retry, 3_000);
        return;
      }
      syncRetryAttempt.current += 1;
      void synchronize(false, true);
    };
    const delays = [3_000, 10_000, 30_000];
    timer = setTimeout(retry, delays[Math.min(syncRetryAttempt.current, delays.length - 1)]);
    return () => { active = false; clearTimeout(timer); };
  }, [ready, state.auth.loggedIn, syncStatus, synchronize]);

  useEffect(() => {
    const listener = NativeAppState.addEventListener('change', status => {
      if (status === 'active' && session.current && !resetting.current) void synchronize(false, true);
    });
    return () => listener.remove();
  }, [synchronize]);

  useEffect(() => {
    if (!ready || !state.auth.loggedIn) return;
    const timer = setInterval(() => {
      if (NativeAppState.currentState === 'active' && session.current && !resetting.current && !authOperation.current)
        void synchronize(false, true);
    }, 60_000);
    return () => clearInterval(timer);
  }, [ready, state.auth.loggedIn, synchronize]);

  const activePlantIndex = Math.max(
    0,
    state.plants.findIndex((plant) => plant.id === state.activePlantId),
  );
  const activePlant = state.plants[activePlantIndex] ?? null;

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

  const storeSession = useCallback((value: AuthEnvelope | null, epoch?: number) => {
    const write = sessionWrites.current.catch(() => {}).then(async () => {
      if (epoch !== undefined && epoch !== economySession.current) throw new Error('Phiên sử dụng đã thay đổi.');
      await accountAuth.saveSession(value);
      if (epoch !== undefined && epoch !== economySession.current) {
        if (value) await accountAuth.saveSession(null);
        throw new Error('Phiên sử dụng đã thay đổi.');
      }
    });
    sessionWrites.current = write;
    return write;
  }, []);

  const storeRememberedLogin = useCallback((email: string | null, epoch?: number, password?: string | null) => {
    const write = sessionWrites.current.catch(() => {}).then(async () => {
      if (epoch !== undefined && epoch !== economySession.current) throw new Error('Phiên sử dụng đã thay đổi.');
      const previous = rememberedLogin.current;
      await accountAuth.saveRememberedLogin(email, password);
      if (epoch !== undefined && epoch !== economySession.current) {
        await accountAuth.saveRememberedLogin(previous?.email ?? null, previous?.password ?? null);
        throw new Error('Phiên sử dụng đã thay đổi.');
      }
      const matchingPassword = password === undefined && previous?.email === email ? previous.password : password;
      rememberedLogin.current = email === null ? null : { email,
        ...(typeof matchingPassword === 'string' ? { password: matchingPassword } : {}) };
      setRememberedEmail(email ?? '');
      setRememberedPassword(rememberedLogin.current?.password ?? '');
      setRememberLogin(email !== null);
    });
    sessionWrites.current = write;
    return write;
  }, []);

  const updateRememberLogin = useCallback(async (enabled: boolean): Promise<ActionResult> => {
    if (!ready || resetting.current || authOperation.current)
      return { ok: false, message: 'Vui lòng đợi thao tác hiện tại hoàn tất.' };
    authOperation.current = true;
    const epoch = economySession.current;
    const active = session.current;
    const email = enabled ? active?.user.email ?? rememberedLogin.current?.email ?? '' : null;
    try {
      // Opting out removes the durable credential, not the active in-memory session.
      if (!enabled) await storeSession(null, epoch);
      await storeRememberedLogin(email, epoch);
      if (enabled && active) await storeSession(active, epoch);
      if (epoch !== economySession.current) throw new Error('Phiên sử dụng đã thay đổi.');
      commit(current => ({ ...current, auth: { ...current.auth, remember: enabled } }));
      return { ok: true };
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : 'Chưa lưu được lựa chọn ghi nhớ đăng nhập.' };
    } finally { authOperation.current = false; }
  }, [commit, ready, storeRememberedLogin, storeSession]);

  const enterAccount = useCallback(async (envelope: AuthEnvelope, remember: boolean, epoch: number, password: string | null) => {
    if (epoch !== economySession.current) throw new Error('Phiên sử dụng đã thay đổi.');
    await persistNow();
    if (epoch !== economySession.current) throw new Error('Phiên sử dụng đã thay đổi.');
    resetting.current = true;
    try {
      await writeQueue.current;
      const original = legacyRecord.current;
      if (!original) throw new Error('Dữ liệu chưa tải xong.');
      const loaded = await openCloud(await loadAccountData(storagePort, envelope.user, original), envelope);
      loaded.record = { ...loaded.record, state: { ...loaded.record.state,
        auth: { ...loaded.record.state.auth, remember } } };
      await loaded.port.setItem(STORAGE_KEY, JSON.stringify(loaded.record));
      await storeRememberedLogin(remember ? envelope.user.email : null, epoch, remember ? password : null);
      await storeSession(remember ? envelope : null, epoch);
      session.current = envelope;
      setAccount(envelope.user);
      activeStorage.current = loaded.port;
      cloud.current = loaded.cloud;
      setSyncStatus(loaded.cloud.status());
      persistedRecord.current = loaded.record;
      purchaseIntent.current = null; setPendingFoodPurchase(null);
      petIntent.current = null; setPendingPetTransaction(null);
      rewardIntent.current = null; setPendingRewardAction(false);
      economySession.current += 1;
      stateRef.current = loaded.record.state;
      setState(loaded.record.state);
    } finally { resetting.current = false; }
  }, [persistNow, storagePort, storeRememberedLogin, storeSession, openCloud]);

  const signIn = useCallback(async (request: () => Promise<AuthEnvelope | null>, remember: boolean, password: string | null = null): Promise<ActionResult> => {
    if (!ready || resetting.current || authOperation.current) return { ok: false, message: 'Vui lòng đợi thao tác hiện tại hoàn tất.' };
    authOperation.current = true;
    const epoch = economySession.current;
    let envelope: AuthEnvelope | null | undefined;
    try {
      envelope = await request();
      if (!envelope) return { ok: false, cancelled: true };
      await enterAccount(envelope, remember, epoch, password);
      return { ok: true };
    } catch (cause) {
      if (envelope) void accountAuth.logout(envelope.session.token).catch(() => {});
      return { ok: false, message: cause instanceof Error ? cause.message : 'Chưa thể đăng nhập. Hãy thử lại.' };
    } finally { authOperation.current = false; }
  }, [enterAccount, ready]);

  const login = useCallback((identity: string, password: string, remember: boolean) =>
    signIn(() => accountAuth.login(identity, password, remember), remember, password), [signIn]);
  const register = useCallback((name: string, email: string, password: string) =>
    signIn(() => accountAuth.register(name, email, password), false), [signIn]);

  const loginSocial = useCallback((provider: SocialProvider, remember: boolean) => signIn(async () => {
    const providers = await accountAuth.socialProviders();
    if (!providers[provider]) throw new Error(t('Máy chủ chưa cấu hình đăng nhập {provider}.', { provider: provider === 'google' ? 'Google' : 'Facebook' }));
    const challenge = provider === 'facebook' ? await accountAuth.socialChallenge('login') : undefined;
    const credential = await startSocialLogin(provider, challenge);
    if (!credential) return null;
    try { return await accountAuth.socialLogin(credential, remember); }
    catch (cause) {
      // Provider approval is not a PAT login. A refused proof must not pin the
      // next explicit attempt to the same provider account.
      await resetSocialLoginSession(provider).catch(() => {});
      throw cause;
    }
  }, remember), [signIn]);

  // Recovery never creates a session or writes account/game data on the device.
  const recoverPassword = useCallback(async (request: () => Promise<void>, message: string,
    afterSuccess?: (epoch: number) => Promise<void>): Promise<MessageResult> => {
    if (!ready || resetting.current || authOperation.current || session.current)
      return { ok: false, message: 'Vui lòng đăng xuất hoặc đợi thao tác hiện tại hoàn tất.' };
    authOperation.current = true;
    const epoch = economySession.current;
    try {
      await request();
      if (epoch !== economySession.current) throw new Error('Phiên sử dụng đã thay đổi.');
      await afterSuccess?.(epoch);
      if (epoch !== economySession.current) throw new Error('Phiên sử dụng đã thay đổi.');
      return { ok: true, message };
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : 'Chưa thể khôi phục mật khẩu. Hãy thử lại.' };
    } finally { authOperation.current = false; }
  }, [ready]);

  const requestPasswordReset = useCallback((email: string) => recoverPassword(
    () => accountAuth.requestPasswordReset(email),
    'Nếu email đã đăng ký, hãy kiểm tra thư để lấy mã khôi phục.',
  ), [recoverPassword]);
  const resetPassword = useCallback((token: string, newPassword: string) => recoverPassword(
    () => accountAuth.resetPassword(token, newPassword),
    'Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới.',
    // The reset proof does not identify an email locally. Remove any saved
    // password, retaining only the opted-in email suggestion.
    epoch => storeRememberedLogin(rememberedLogin.current?.email ?? null, epoch, null),
  ), [recoverPassword, storeRememberedLogin]);

  const logout = useCallback(() => {
    if (resetting.current) return;
    const previousSession = session.current;
    cloud.current = null;
    setSyncStatus({ phase: 'idle', message: '' });
    session.current = null;
    setAccount(null);
    economySession.current += 1;
    commit((current) => ({
      ...current,
      auth: { ...current.auth, loggedIn: false, remember: false },
    }));
    void storeSession(null).catch(() => {
      setStorageError('Chưa xoá được phiên đăng nhập đã lưu. Thử mở lại PAT để đăng xuất hoàn toàn.');
    });
    if (previousSession) void accountAuth.logout(previousSession.session.token).catch(() => {});
    void cancelDailyReminders().catch(() => {
      setPreferenceError('reminder', 'Chưa hủy được nhắc thăm vườn. Mở lại PAT để thử lại hoặc tắt thông báo trong cài đặt thiết bị.');
    });
  }, [commit, setAccount, storeSession]);

  const linkSocial = useCallback(async (provider: SocialProvider): Promise<ActionResult> => {
    const active = session.current;
    if (!active || authOperation.current || resetting.current)
      return { ok: false, message: 'Vui lòng đăng nhập lại hoặc đợi thao tác hiện tại.' };
    authOperation.current = true;
    const epoch = economySession.current;
    try {
      const providers = await accountAuth.socialProviders();
      if (!providers[provider]) throw new Error(t('Máy chủ chưa cấu hình đăng nhập {provider}.', { provider: provider === 'google' ? 'Google' : 'Facebook' }));
      const challenge = provider === 'facebook' ? await accountAuth.socialChallenge('link', active.session.token) : undefined;
      const credential = await startSocialLogin(provider, challenge);
      if (!credential) return { ok: false, cancelled: true };
      if (epoch !== economySession.current) throw new Error('Phiên sử dụng đã thay đổi.');
      const user = await accountAuth.linkSocial(active.session.token, credential).catch(async (cause: unknown) => {
        await resetSocialLoginSession(provider).catch(() => {});
        throw cause;
      });
      if (epoch !== economySession.current || user.id.toLowerCase() !== active.user.id.toLowerCase())
        throw new Error('Phiên sử dụng đã thay đổi.');
      session.current = { ...active, user };
      setAccount(user);
      if (stateRef.current.auth.remember) await storeSession(session.current);
      if (epoch !== economySession.current) throw new Error('Phiên sử dụng đã thay đổi.');
      return { ok: true, message: 'Đã liên kết tài khoản.' };
    } catch (cause) {
      if (cause instanceof AccountAuthError && cause.status === 401 &&
          ['AUTH_REQUIRED', 'SESSION_EXPIRED', 'INVALID_SESSION', 'UNAUTHORIZED'].includes(cause.code)) logout();
      return { ok: false, message: cause instanceof Error ? cause.message : 'Chưa thể liên kết tài khoản.' };
    } finally { authOperation.current = false; }
  }, [logout, setAccount, storeSession]);

  const removePlant = useCallback(
    (id: string): MessageResult => {
      const { state: next, result } = archivePlantJourney(stateRef.current, id);
      commit(() => next);
      return result;
    },
    [commit],
  );

  const restorePlant = useCallback((id: string): MessageResult => {
    try {
      const { state: next, result } = restorePlantJourney(stateRef.current, id);
      commit(() => next);
      return result;
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Chưa thể khôi phục cây.' };
    }
  }, [commit]);

  const createJourney = useCallback((input: CreateJourneyInput): Plant => {
    const { state: next, plant } = createPlantJourney(stateRef.current, input);
    commit(() => next);
    return plant;
  }, [commit]);

  const updateJourney = useCallback((plantId: string, updates: Partial<PlantJourney>): MessageResult => {
    try {
      commit((current) => updatePlantJourney(current, plantId, updates));
      return { ok: true, message: 'Đã cập nhật hành trình trồng cây.' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Chưa thể cập nhật hành trình.' };
    }
  }, [commit]);

  const saveInspection = useCallback((input: InspectionInput): InspectionResult => {
    const { state: next, result } = recordPlantInspection(stateRef.current, input);
    commit(() => next);
    return result;
  }, [commit]);

  const appendChatMessage = useCallback((input: ChatMessageInput): PlantChatMessage => {
    const { state: next, message } = appendPlantChat(stateRef.current, input);
    commit(() => next);
    return message;
  }, [commit]);

  const recordCareEvent = useCallback((input: CareEventInput): CareEvent => {
    const { state: next, event } = addCareEvent(stateRef.current, input);
    commit(() => next);
    return event;
  }, [commit]);

  const {
    openDailyPack, feedPet, quickFeedPet, sellPetCopies, upgradePet, purchaseFood,
    claimLoginReward, syncLoginVisit, markMailRead, markAllMailRead,
    claimMail, claimAllMail, deleteMail, deleteAllMail, retryRewardAction,
  } = useMemo(() => createEconomyTransactions(() => ({
    ready, stateRef, commit, persistNow, persistSnapshot, resetting, economySession,
    purchaseIntent, petIntent, rewardIntent, rewardWrite,
    setPendingFoodPurchase, setPendingPetTransaction, setPendingRewardAction,
    cloud, session, persistedRecord, setState,
  })), [commit, persistNow, persistSnapshot, ready]);

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

  const updateAccountProfile = useCallback(async (updates: AccountProfileInput): Promise<ActionResult> => {
    const validated = validateAccountProfile(updates);
    if (!validated.ok) return validated;
    const active = session.current;
    if (!active || authOperation.current) return { ok: false, message: 'Vui lòng đăng nhập lại hoặc đợi thao tác hiện tại.' };
    authOperation.current = true;
    const epoch = economySession.current;
    try {
      const user = await accountAuth.updateProfile(active.session.token, validated.value.name);
      if (epoch !== economySession.current || user.id.toLowerCase() !== active.user.id.toLowerCase()) throw new Error('Phiên sử dụng đã thay đổi.');
      session.current = { ...active, user };
      setAccount(user);
      if (stateRef.current.auth.remember) await storeSession(session.current);
      if (epoch !== economySession.current) throw new Error('Phiên sử dụng đã thay đổi.');
      commit((current) => ({ ...current, profile: { ...current.profile, name: user.username,
        email: user.email, phone: validated.value.phone } }));
      await persistNow();
      return { ok: true };
    } catch (cause) {
      if (cause instanceof AccountAuthError && cause.status === 401) logout();
      return { ok: false, message: cause instanceof Error ? cause.message : 'Chưa thể lưu hồ sơ.' };
    }
    finally { authOperation.current = false; }
  }, [commit, logout, persistNow, setAccount, storeSession]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string): Promise<MessageResult> => {
    const active = session.current;
    if (!active || authOperation.current) return { ok: false, message: 'Vui lòng đăng nhập lại hoặc đợi thao tác hiện tại.' };
    authOperation.current = true;
    const epoch = economySession.current;
    let changed = false;
    try {
      const replacement = await accountAuth.changePassword(active.session.token, currentPassword, newPassword);
      changed = true;
      if (epoch !== economySession.current || replacement.user.id.toLowerCase() !== active.user.id.toLowerCase()) {
        void accountAuth.logout(replacement.session.token).catch(() => {});
        throw new Error('Phiên sử dụng đã thay đổi.');
      }
      session.current = replacement;
      setAccount(replacement.user);
      if (stateRef.current.auth.remember && rememberedLogin.current?.email === replacement.user.email)
        await storeRememberedLogin(replacement.user.email, epoch, newPassword);
      await storeSession(stateRef.current.auth.remember ? replacement : null);
      if (epoch !== economySession.current) throw new Error('Phiên sử dụng đã thay đổi.');
      return { ok: true, message: 'Đã đổi mật khẩu. Các phiên đăng nhập cũ đã được đăng xuất.' };
    } catch (cause) {
      if (changed && epoch === economySession.current) {
        logout();
        return { ok: true, message: cause instanceof AccountAuthError && cause.code === 'STORAGE'
          ? 'Đã đổi mật khẩu nhưng chưa lưu được thông tin ghi nhớ. Vui lòng đăng nhập lại bằng mật khẩu mới.'
          : 'Đã đổi mật khẩu. Vui lòng đăng nhập lại bằng mật khẩu mới.' };
      }
      if (cause instanceof AccountAuthError && cause.status === 401) logout();
      return { ok: false, message: cause instanceof Error ? cause.message : 'Chưa thể đổi mật khẩu.' };
    } finally { authOperation.current = false; }
  }, [logout, setAccount, storeRememberedLogin, storeSession]);

  const updateSetting = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      commit((current) => ({
        ...current,
        settings: { ...current.settings, [key]: value },
      }));
    },
    [commit],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      ready,
      storageError,
      syncStatus, retrySync, reloadCloud,
      retryStorage,
      state,
      activePlant,
      setActivePlantIndex,
      login,
      loginSocial,
      linkSocial,
      account,
      rememberedEmail,
      rememberedPassword,
      rememberLogin,
      updateRememberLogin,
      changePassword,
      requestPasswordReset,
      resetPassword,
      register,
      logout,
      removePlant,
      restorePlant,
      createJourney,
      updateJourney,
      saveInspection,
      appendChatMessage,
      recordCareEvent,
      openDailyPack,
      persistNow,
      feedPet,
      quickFeedPet,
      sellPetCopies,
      upgradePet,
      pendingPetTransaction,
      purchaseFood,
      pendingFoodPurchase,
      claimLoginReward,
      syncLoginVisit, markMailRead, markAllMailRead, claimMail, claimAllMail, deleteMail, deleteAllMail, retryRewardAction, pendingRewardAction,
      updateProfile,
      updateAccountProfile,
      updateSetting,
    }),
    [
      activePlant,
      feedPet,
      quickFeedPet,
      sellPetCopies,
      upgradePet,
      pendingPetTransaction,
      purchaseFood,
      pendingFoodPurchase,
      claimLoginReward,
      syncLoginVisit, markMailRead, markAllMailRead, claimMail, claimAllMail, deleteMail, deleteAllMail, retryRewardAction, pendingRewardAction,
      login,
      loginSocial,
      linkSocial,
      account,
      rememberedEmail,
      rememberedPassword,
      rememberLogin,
      updateRememberLogin,
      changePassword,
      requestPasswordReset,
      resetPassword,
      logout,
      ready,
      storageError,
      syncStatus, retrySync, reloadCloud,
      retryStorage,
      register,
      removePlant,
      restorePlant,
      createJourney,
      updateJourney,
      saveInspection,
      appendChatMessage,
      recordCareEvent,
      openDailyPack,
      persistNow,
      setActivePlantIndex,
      state,
      updateProfile,
      updateAccountProfile,
      updateSetting,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider.');
  return context;
}
