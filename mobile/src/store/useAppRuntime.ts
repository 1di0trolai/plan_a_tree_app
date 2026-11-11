/** Sở hữu trạng thái và các cổng dùng chung của một AppProvider; không đăng nhập, tải dữ liệu hay lập lịch đồng bộ. */
import storage from 'expo-sqlite/kv-store';
import { useCallback, useMemo, useRef, useState } from 'react';
import { createInitialState } from '../data/seed';
import type { AuthEnvelope, AuthUser, RememberedLogin } from '../services/accountAuth';
import { deleteBackgroundMusicFile, listBackgroundMusicUris } from '../services/preferences';
import { deleteCheckInPhoto, listCheckInPhotoUris } from '../utils/checkInPhotos';
import type { AppState } from '../types/app';
import type { CloudStorage, SyncStatus } from './cloudStorage';
import type { FoodPurchaseInput } from './economyActions';
import type { PurchaseResult, RewardIntent } from './economyTransactions';
import type { PetTransactionInput } from './petActions';
import { statePhotoUris, type StoredUserData, type UserStorage } from './storageLifecycle';

export function useAppRuntime() {
  const [state, setState] = useState<AppState>(() => createInitialState());
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ phase: 'idle', message: '' });
  const [hydrationAttempt, setHydrationAttempt] = useState(0);
  const [pendingFoodPurchase, setPendingFoodPurchase] = useState<FoodPurchaseInput | null>(null);
  const [pendingPetTransaction, setPendingPetTransaction] = useState<PetTransactionInput | null>(null);
  const [pendingRewardAction, setPendingRewardAction] = useState(false);
  const [account, setAccount] = useState<AuthUser | null>(null);
  const [rememberedEmail, setRememberedEmail] = useState('');
  const [rememberedPassword, setRememberedPassword] = useState('');
  const [rememberLogin, setRememberLogin] = useState(false);

  const stateRef = useRef(state);
  const writeQueue = useRef(Promise.resolve());
  const persistedRecord = useRef<StoredUserData | null>(null);
  const legacyRecord = useRef<StoredUserData | null>(null);
  const activeStorage = useRef<UserStorage | null>(null);
  const cloud = useRef<CloudStorage | null>(null);
  const session = useRef<AuthEnvelope | null>(null);
  const rememberedLogin = useRef<RememberedLogin | null>(null);
  const authOperation = useRef(false);
  const sessionWrites = useRef(Promise.resolve());
  const resetting = useRef(true);
  const backgroundSyncBusy = useRef(false);
  const syncRetryAttempt = useRef(0);
  const purchaseIntent = useRef<FoodPurchaseInput | null>(null);
  const petIntent = useRef<PetTransactionInput | null>(null);
  const rewardIntent = useRef<RewardIntent | null>(null);
  const rewardWrite = useRef<Promise<PurchaseResult> | null>(null);
  // Mỗi lần đổi tài khoản vô hiệu hóa phản hồi muộn của phiên cũ.
  const economySession = useRef(0);

  const storagePort = useMemo<UserStorage>(() => ({
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => storage.setItem(key, value),
    listPhotos: listCheckInPhotoUris,
    deletePhoto: (uri) => {
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

  return {
    state, setState, stateRef, ready, setReady, storageError, setStorageError,
    syncStatus, setSyncStatus, hydrationAttempt, setHydrationAttempt,
    pendingFoodPurchase, setPendingFoodPurchase, purchaseIntent,
    pendingPetTransaction, setPendingPetTransaction, petIntent,
    pendingRewardAction, setPendingRewardAction, rewardIntent, rewardWrite,
    account, setAccount, rememberedEmail, setRememberedEmail,
    rememberedPassword, setRememberedPassword, rememberLogin, setRememberLogin,
    rememberedLogin, session, sessionWrites, authOperation, economySession,
    activeStorage, persistedRecord, legacyRecord, writeQueue, storagePort,
    cloud, resetting, backgroundSyncBusy, syncRetryAttempt, commit,
  };
}

export type AppRuntime = ReturnType<typeof useAppRuntime>;
