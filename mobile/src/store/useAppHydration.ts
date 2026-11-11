/** Khôi phục dữ liệu và phiên đã lưu khi mở ứng dụng; tuần tự hóa khởi tạo và chỉ công bố kết quả của lần tải còn hiệu lực. */
import { useEffect } from 'react';
import { t } from '../i18n/core';
import { accountAuth, AccountAuthError } from '../services/accountAuth';
import { withPreferenceReset } from '../services/preferences';
import { withCheckInPhotoReset } from '../utils/checkInPhotos';
import { loadAccountData } from './accountStorage';
import { loadStoredUserData } from './storageLifecycle';
import type { AppPersistence } from './useAppPersistence';
import type { AppRuntime } from './useAppRuntime';

export function useAppHydration(runtime: AppRuntime, persistence: AppPersistence) {
  const {
    hydrationAttempt, storagePort, resetting: resettingRef, writeQueue: writeQueueRef, legacyRecord: legacyRecordRef,
    session: sessionRef, setAccount, rememberedLogin: rememberedLoginRef, setRememberedEmail,
    setRememberedPassword, setRememberLogin, activeStorage: activeStorageRef, cloud: cloudRef,
    setSyncStatus, persistedRecord: persistedRecordRef, purchaseIntent: purchaseIntentRef, setPendingFoodPurchase,
    petIntent: petIntentRef, setPendingPetTransaction, rewardIntent: rewardIntentRef, setPendingRewardAction,
    stateRef, setState, setStorageError, setReady,
  } = runtime;
  const { openCloud } = persistence;

  useEffect(() => {
    let mounted = true;
    resettingRef.current = true;

    async function hydrate() {
      try {
        // Serialize initialization too: React Strict Mode may mount the effect
        // twice, but no late initializer may overwrite a newly created garden.
        const load = writeQueueRef.current.catch(() => {}).then(async () => {
          if (mounted) setReady(false);
          const original = await withPreferenceReset(() => withCheckInPhotoReset(() => loadStoredUserData(storagePort)), false);
          legacyRecordRef.current = original;
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
        writeQueueRef.current = load.then(() => {}, () => {});
        const loaded = await load;
        const record = loaded.record;
        if (!mounted) return;
        sessionRef.current = loaded.session;
        setAccount(loaded.session?.user ?? null);
        rememberedLoginRef.current = loaded.remembered;
        setRememberedEmail(loaded.remembered?.email ?? '');
        setRememberedPassword(loaded.remembered?.password ?? '');
        setRememberLogin(loaded.remembered !== null);
        activeStorageRef.current = loaded.port;
        cloudRef.current = 'cloud' in loaded ? loaded.cloud : null;
        setSyncStatus(cloudRef.current?.status() ?? { phase: 'idle', message: '' });
        persistedRecordRef.current = record;
        purchaseIntentRef.current = null;
        setPendingFoodPurchase(null);
        petIntentRef.current = null;
        setPendingPetTransaction(null);
        rewardIntentRef.current = null;
        setPendingRewardAction(false);
        stateRef.current = record.state;
        setState(record.state);
        if (record.pendingPhotoCleanup.length > 0 || (record.pendingMusicCleanup?.length ?? 0) > 0) {
          setStorageError('Dữ liệu cũ đã được xóa, nhưng một số bản sao ảnh hoặc nhạc chưa xóa được. Hãy thử lại để hoàn tất.');
          return;
        }
        resettingRef.current = false;
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
  }, [activeStorageRef, cloudRef, hydrationAttempt, legacyRecordRef, openCloud, persistedRecordRef, petIntentRef, purchaseIntentRef, rememberedLoginRef, resettingRef, rewardIntentRef, sessionRef, setAccount, setPendingFoodPurchase, setPendingPetTransaction, setPendingRewardAction, setReady, setRememberedEmail, setRememberedPassword, setRememberLogin, setState, setStorageError, setSyncStatus, stateRef, storagePort, writeQueueRef]);
}
