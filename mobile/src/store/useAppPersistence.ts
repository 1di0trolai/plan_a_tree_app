/** Điều phối ghi dữ liệu bền vững, mở kết nối đám mây và lịch tự đồng bộ; giữ các khóa phiên và hàng đợi ghi dùng chung. */
import { useCallback, useEffect, useMemo } from 'react';
import { AppState as NativeAppState } from 'react-native';
import type { AuthEnvelope } from '../services/accountAuth';
import { cloudAssetFiles } from '../services/cloudAssets';
import { cloudSync } from '../services/cloudSync';
import type { AppState } from '../types/app';
import { createCloudStorage } from './cloudStorage';
import type { MessageResult } from './petActions';
import { saveStoredUserData, type StoredUserData, type UserStorage } from './storageLifecycle';
import type { AppRuntime } from './useAppRuntime';

export function useAppPersistence(runtime: AppRuntime) {
  const {
    state, ready, syncStatus, stateRef, setState, setSyncStatus, setReady,
    setStorageError, setHydrationAttempt, setPendingRewardAction,
    activeStorage: activeStorageRef, storagePort, cloud: cloudRef, session: sessionRef, resetting: resettingRef, writeQueue: writeQueueRef,
    persistedRecord: persistedRecordRef, economySession: economySessionRef, rewardIntent: rewardIntentRef, purchaseIntent: purchaseIntentRef, petIntent: petIntentRef,
    backgroundSyncBusy: backgroundSyncBusyRef, syncRetryAttempt: syncRetryAttemptRef, authOperation: authOperationRef,
  } = runtime;

  const persistSnapshot = useCallback((snapshotState: AppState) => {
    if (resettingRef.current) return Promise.reject(new Error('PAT đang xử lý dữ liệu.'));
    const port = activeStorageRef.current ?? storagePort;
    const controller = cloudRef.current;
    // Catch previous failures so a later explicit retry can still save.
    const write = writeQueueRef.current.catch(() => {}).then(async () => {
      const previous = persistedRecordRef.current;
      if (!previous) throw new Error('Dữ liệu PAT chưa tải xong.');
      persistedRecordRef.current = await saveStoredUserData(port, previous, snapshotState);
      // Local durability succeeds independently of connectivity. The outbox is
      // atomic with that save and survives a force-close before a network retry.
      if (controller && snapshotState.auth.loggedIn) {
        try {
          const synced = await controller.flush(() => stateRef.current === snapshotState);
          if (cloudRef.current === controller) {
            persistedRecordRef.current = synced;
            if (stateRef.current === snapshotState && JSON.stringify(synced.state) !== JSON.stringify(snapshotState)) {
              stateRef.current = synced.state; setState(synced.state);
            }
          }
        } catch { /* Sync status exposes the durable pending save. */ }
      }
    });
    writeQueueRef.current = write;
    return write;
  }, [activeStorageRef, cloudRef, persistedRecordRef, resettingRef, setState, stateRef, storagePort, writeQueueRef]);

  const openCloud = useCallback(async (loaded: { port: UserStorage; record: StoredUserData }, envelope: AuthEnvelope) => {
    const controller = createCloudStorage({ ...loaded, api: cloudSync, files: cloudAssetFiles,
      user: () => sessionRef.current?.user.id === envelope.user.id ? sessionRef.current.user : envelope.user,
      token: () => sessionRef.current?.user.id === envelope.user.id ? sessionRef.current.session.token : envelope.session.token,
      onStatus: status => { if (cloudRef.current === controller) setSyncStatus(status); },
    });
    const record = await controller.open();
    return { port: controller.port, record, cloud: controller };
  }, [cloudRef, sessionRef, setSyncStatus]);

  const persistNow = useCallback(async () => {
    const intent = rewardIntentRef.current;
    await persistSnapshot(stateRef.current);
    // Card opening uses a synchronous transition, then this durable boundary.
    if (intent?.key.startsWith('pack:') && rewardIntentRef.current === intent) {
      rewardIntentRef.current = null;
      setPendingRewardAction(false);
    }
  }, [persistSnapshot, rewardIntentRef, setPendingRewardAction, stateRef]);

  const retryStorage = useCallback(() => {
    economySessionRef.current += 1;
    resettingRef.current = true;
    setStorageError(null);
    setReady(false);
    setHydrationAttempt((attempt) => attempt + 1);
  }, [economySessionRef, resettingRef, setHydrationAttempt, setReady, setStorageError]);

  useEffect(() => {
    if (!ready || resettingRef.current) return;
    void persistSnapshot(stateRef.current).catch((error: unknown) => {
      console.warn('Không thể lưu dữ liệu PAT.', error);
    });
  }, [persistSnapshot, ready, resettingRef, state, stateRef]);

  const synchronize = useCallback(async (force = false, background = false): Promise<MessageResult> => {
    const controller = cloudRef.current; const epoch = economySessionRef.current;
    if (!controller || !sessionRef.current || resettingRef.current)
      return { ok: false, message: 'Hãy đăng nhập hoặc đợi thao tác hiện tại.' };
    if (purchaseIntentRef.current || petIntentRef.current || rewardIntentRef.current)
      return { ok: false, message: 'Hãy hoàn tất lưu giao dịch đang chờ trước.' };
    if (background && controller.status().phase === 'conflict') return { ok: false, message: 'Hãy xử lý xung đột đồng bộ trước.' };
    if (background && (backgroundSyncBusyRef.current || controller.status().phase === 'syncing'))
      return { ok: false, message: 'Đang đồng bộ…' };
    // Freeze local mutations while replacing a clean snapshot. This also keeps
    // a late download from overwriting an action made on this phone meanwhile.
    const before = stateRef.current;
    if (background) backgroundSyncBusyRef.current = true;
    const write = persistSnapshot(before);
    if (!background) resettingRef.current = true;
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
      if (economySessionRef.current !== epoch || cloudRef.current !== controller) throw new Error('Phiên sử dụng đã thay đổi.');
      persistedRecordRef.current = record;
      if (!background || stable && stateRef.current === guardState) { stateRef.current = record.state; setState(record.state); }
      return { ok: true, message: 'Đã đồng bộ dữ liệu.' };
    } catch (cause) { return { ok: false, message: cause instanceof Error ? cause.message : 'Chưa đồng bộ được. Dữ liệu trên máy vẫn được giữ lại.' }; }
    finally {
      if (background) backgroundSyncBusyRef.current = false;
      if (!background && economySessionRef.current === epoch) resettingRef.current = false;
    }
  }, [backgroundSyncBusyRef, cloudRef, economySessionRef, persistSnapshot, persistedRecordRef, petIntentRef, purchaseIntentRef, resettingRef, rewardIntentRef, sessionRef, setState, stateRef]);
  const retrySync = useCallback(() => synchronize(), [synchronize]);
  const reloadCloud = useCallback(() => synchronize(true), [synchronize]);

  useEffect(() => {
    if (!ready || !state.auth.loggedIn || syncStatus.phase === 'synced') syncRetryAttemptRef.current = 0;
    if (!ready || !state.auth.loggedIn || !syncStatus.retryable) return;
    const controller = cloudRef.current;
    const epoch = economySessionRef.current;
    if (!controller) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const retry = () => {
      if (!active || cloudRef.current !== controller || economySessionRef.current !== epoch
        || !sessionRef.current || NativeAppState.currentState !== 'active') return;
      if (resettingRef.current || authOperationRef.current || backgroundSyncBusyRef.current
        || purchaseIntentRef.current || petIntentRef.current || rewardIntentRef.current
        || controller.status().phase === 'syncing') {
        timer = setTimeout(retry, 3_000);
        return;
      }
      syncRetryAttemptRef.current += 1;
      void synchronize(false, true);
    };
    const delays = [3_000, 10_000, 30_000];
    timer = setTimeout(retry, delays[Math.min(syncRetryAttemptRef.current, delays.length - 1)]);
    return () => { active = false; clearTimeout(timer); };
  }, [authOperationRef, backgroundSyncBusyRef, cloudRef, economySessionRef, petIntentRef, purchaseIntentRef, ready, resettingRef, rewardIntentRef, sessionRef, state.auth.loggedIn, syncRetryAttemptRef, syncStatus, synchronize]);

  useEffect(() => {
    const listener = NativeAppState.addEventListener('change', status => {
      if (status === 'active' && sessionRef.current && !resettingRef.current) void synchronize(false, true);
    });
    return () => listener.remove();
  }, [resettingRef, sessionRef, synchronize]);

  useEffect(() => {
    if (!ready || !state.auth.loggedIn) return;
    const timer = setInterval(() => {
      if (NativeAppState.currentState === 'active' && sessionRef.current && !resettingRef.current && !authOperationRef.current)
        void synchronize(false, true);
    }, 60_000);
    return () => clearInterval(timer);
  }, [authOperationRef, ready, resettingRef, sessionRef, state.auth.loggedIn, synchronize]);

  return useMemo(() => ({
    persistSnapshot, openCloud, persistNow, retryStorage, synchronize, retrySync, reloadCloud,
  }), [openCloud, persistNow, persistSnapshot, reloadCloud, retryStorage, retrySync, synchronize]);
}

export type AppPersistence = ReturnType<typeof useAppPersistence>;
