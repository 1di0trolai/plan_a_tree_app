/** Ghép các module trạng thái, tài khoản, lưu trữ và nghiệp vụ thành API useApp dùng chung cho giao diện. */
import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import type { AppContextValue } from './appStoreTypes';
import { createEconomyTransactions } from './economyTransactions';
import { useAccountActions } from './useAccountActions';
import { useAppHydration } from './useAppHydration';
import { useAppPersistence } from './useAppPersistence';
import { useAppRuntime } from './useAppRuntime';
import { usePlantActions } from './usePlantActions';

export type { AppContextValue } from './appStoreTypes';
export type { PurchaseResult, ClaimLoginResult, PetTransactionResult } from './economyTransactions';

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: PropsWithChildren) {
  const runtime = useAppRuntime();
  const persistence = useAppPersistence(runtime);
  useAppHydration(runtime, persistence);
  const accountActions = useAccountActions(runtime, persistence);
  const plantActions = usePlantActions(runtime);

  const {
    ready, storageError, syncStatus, state, account, rememberedEmail, rememberedPassword, rememberLogin,
    pendingFoodPurchase, pendingPetTransaction, pendingRewardAction,
    stateRef, commit, resetting, economySession, purchaseIntent, petIntent, rewardIntent, rewardWrite,
    setPendingFoodPurchase, setPendingPetTransaction, setPendingRewardAction,
    cloud, session, persistedRecord, setState,
  } = runtime;
  const { persistNow, persistSnapshot, retryStorage, retrySync, reloadCloud } = persistence;

  // Chỉ đọc ref khi thao tác thực sự chạy; không đọc dữ liệu phiên trong lúc render.
  const economyActions = useMemo(() => createEconomyTransactions(() => ({
    ready, stateRef, commit, persistNow, persistSnapshot, resetting, economySession,
    purchaseIntent, petIntent, rewardIntent, rewardWrite,
    setPendingFoodPurchase, setPendingPetTransaction, setPendingRewardAction,
    cloud, session, persistedRecord, setState,
  })), [
    ready, stateRef, commit, persistNow, persistSnapshot, resetting, economySession,
    purchaseIntent, petIntent, rewardIntent, rewardWrite,
    setPendingFoodPurchase, setPendingPetTransaction, setPendingRewardAction,
    cloud, session, persistedRecord, setState,
  ]);

  const value = useMemo<AppContextValue>(() => ({
    ready, storageError, syncStatus, state, account, rememberedEmail, rememberedPassword, rememberLogin,
    pendingFoodPurchase, pendingPetTransaction, pendingRewardAction,
    persistNow, retryStorage, retrySync, reloadCloud,
    ...accountActions,
    ...plantActions,
    ...economyActions,
  }), [
    ready, storageError, syncStatus, state, account, rememberedEmail, rememberedPassword, rememberLogin,
    pendingFoodPurchase, pendingPetTransaction, pendingRewardAction,
    persistNow, retryStorage, retrySync, reloadCloud,
    accountActions, plantActions, economyActions,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider.');
  return context;
}
