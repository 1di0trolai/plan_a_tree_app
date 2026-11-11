/** Điều phối đăng nhập, ghi nhớ bảo mật, hồ sơ và mật khẩu; giữ các thao tác bất đồng bộ gắn với đúng phiên tài khoản. */
import { useCallback, useMemo } from 'react';
import { t } from '../i18n/core';
import { accountAuth, AccountAuthError, type AuthEnvelope, type SocialProvider } from '../services/accountAuth';
import { cancelDailyReminders } from '../services/preferences';
import { setPreferenceError } from '../services/preferenceStatus';
import { resetSocialLoginSession, startSocialLogin } from '../services/socialLogin';
import { validateAccountProfile, type AccountProfileInput } from '../utils/profilePreferences';
import { loadAccountData } from './accountStorage';
import type { ActionResult } from './appStoreTypes';
import type { MessageResult } from './petActions';
import { STORAGE_KEY } from './storageLifecycle';
import type { AppRuntime } from './useAppRuntime';
import type { AppPersistence } from './useAppPersistence';

export function useAccountActions(runtime: AppRuntime, persistence: AppPersistence) {
  const {
    ready, resetting: resettingRef, authOperation: authOperationRef, economySession: economySessionRef, session: sessionRef, sessionWrites: sessionWritesRef,
    rememberedLogin: rememberedLoginRef, setRememberedEmail, setRememberedPassword, setRememberLogin,
    stateRef, setState, setAccount, activeStorage: activeStorageRef, persistedRecord: persistedRecordRef, legacyRecord: legacyRecordRef,
    cloud: cloudRef, setSyncStatus, writeQueue: writeQueueRef, storagePort, purchaseIntent: purchaseIntentRef,
    setPendingFoodPurchase, petIntent: petIntentRef, setPendingPetTransaction,
    rewardIntent: rewardIntentRef, setPendingRewardAction, setStorageError, commit,
  } = runtime;
  const { persistNow, openCloud } = persistence;

  const storeSession = useCallback((value: AuthEnvelope | null, epoch?: number) => {
    const write = sessionWritesRef.current.catch(() => {}).then(async () => {
      if (epoch !== undefined && epoch !== economySessionRef.current) throw new Error('Phiên sử dụng đã thay đổi.');
      await accountAuth.saveSession(value);
      if (epoch !== undefined && epoch !== economySessionRef.current) {
        if (value) await accountAuth.saveSession(null);
        throw new Error('Phiên sử dụng đã thay đổi.');
      }
    });
    sessionWritesRef.current = write;
    return write;
  }, [economySessionRef, sessionWritesRef]);

  const storeRememberedLogin = useCallback((email: string | null, epoch?: number, password?: string | null) => {
    const write = sessionWritesRef.current.catch(() => {}).then(async () => {
      if (epoch !== undefined && epoch !== economySessionRef.current) throw new Error('Phiên sử dụng đã thay đổi.');
      const previous = rememberedLoginRef.current;
      await accountAuth.saveRememberedLogin(email, password);
      if (epoch !== undefined && epoch !== economySessionRef.current) {
        await accountAuth.saveRememberedLogin(previous?.email ?? null, previous?.password ?? null);
        throw new Error('Phiên sử dụng đã thay đổi.');
      }
      const matchingPassword = password === undefined && previous?.email === email ? previous.password : password;
      rememberedLoginRef.current = email === null ? null : { email,
        ...(typeof matchingPassword === 'string' ? { password: matchingPassword } : {}) };
      setRememberedEmail(email ?? '');
      setRememberedPassword(rememberedLoginRef.current?.password ?? '');
      setRememberLogin(email !== null);
    });
    sessionWritesRef.current = write;
    return write;
  }, [economySessionRef, rememberedLoginRef, sessionWritesRef, setRememberedEmail, setRememberedPassword, setRememberLogin]);

  const updateRememberLogin = useCallback(async (enabled: boolean): Promise<ActionResult> => {
    if (!ready || resettingRef.current || authOperationRef.current)
      return { ok: false, message: 'Vui lòng đợi thao tác hiện tại hoàn tất.' };
    authOperationRef.current = true;
    const epoch = economySessionRef.current;
    const active = sessionRef.current;
    const email = enabled ? active?.user.email ?? rememberedLoginRef.current?.email ?? '' : null;
    try {
      // Bỏ ghi nhớ chỉ xóa thông tin lưu bền, không xóa phiên đang chạy trong bộ nhớ.
      if (!enabled) await storeSession(null, epoch);
      await storeRememberedLogin(email, epoch);
      if (enabled && active) await storeSession(active, epoch);
      if (epoch !== economySessionRef.current) throw new Error('Phiên sử dụng đã thay đổi.');
      commit(current => ({ ...current, auth: { ...current.auth, remember: enabled } }));
      return { ok: true };
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : 'Chưa lưu được lựa chọn ghi nhớ đăng nhập.' };
    } finally { authOperationRef.current = false; }
  }, [authOperationRef, commit, economySessionRef, ready, rememberedLoginRef, resettingRef, sessionRef, storeRememberedLogin, storeSession]);

  const enterAccount = useCallback(async (envelope: AuthEnvelope, remember: boolean, epoch: number, password: string | null) => {
    if (epoch !== economySessionRef.current) throw new Error('Phiên sử dụng đã thay đổi.');
    await persistNow();
    if (epoch !== economySessionRef.current) throw new Error('Phiên sử dụng đã thay đổi.');
    resettingRef.current = true;
    try {
      await writeQueueRef.current;
      const original = legacyRecordRef.current;
      if (!original) throw new Error('Dữ liệu chưa tải xong.');
      const loaded = await openCloud(await loadAccountData(storagePort, envelope.user, original), envelope);
      loaded.record = { ...loaded.record, state: { ...loaded.record.state,
        auth: { ...loaded.record.state.auth, remember } } };
      await loaded.port.setItem(STORAGE_KEY, JSON.stringify(loaded.record));
      await storeRememberedLogin(remember ? envelope.user.email : null, epoch, remember ? password : null);
      await storeSession(remember ? envelope : null, epoch);
      sessionRef.current = envelope;
      setAccount(envelope.user);
      activeStorageRef.current = loaded.port;
      cloudRef.current = loaded.cloud;
      setSyncStatus(loaded.cloud.status());
      persistedRecordRef.current = loaded.record;
      purchaseIntentRef.current = null; setPendingFoodPurchase(null);
      petIntentRef.current = null; setPendingPetTransaction(null);
      rewardIntentRef.current = null; setPendingRewardAction(false);
      economySessionRef.current += 1;
      stateRef.current = loaded.record.state;
      setState(loaded.record.state);
    } finally { resettingRef.current = false; }
  }, [activeStorageRef, cloudRef, economySessionRef, legacyRecordRef, openCloud, persistNow, persistedRecordRef,
    petIntentRef, purchaseIntentRef, resettingRef, rewardIntentRef, sessionRef, setAccount, setPendingFoodPurchase,
    setPendingPetTransaction, setPendingRewardAction, setState, setSyncStatus, stateRef, storagePort,
    storeRememberedLogin, storeSession, writeQueueRef]);

  const signIn = useCallback(async (request: () => Promise<AuthEnvelope | null>, remember: boolean, password: string | null = null): Promise<ActionResult> => {
    if (!ready || resettingRef.current || authOperationRef.current) return { ok: false, message: 'Vui lòng đợi thao tác hiện tại hoàn tất.' };
    authOperationRef.current = true;
    const epoch = economySessionRef.current;
    let envelope: AuthEnvelope | null | undefined;
    try {
      envelope = await request();
      if (!envelope) return { ok: false, cancelled: true };
      await enterAccount(envelope, remember, epoch, password);
      return { ok: true };
    } catch (cause) {
      if (envelope) void accountAuth.logout(envelope.session.token).catch(() => {});
      return { ok: false, message: cause instanceof Error ? cause.message : 'Chưa thể đăng nhập. Hãy thử lại.' };
    } finally { authOperationRef.current = false; }
  }, [authOperationRef, economySessionRef, enterAccount, ready, resettingRef]);

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
      // Nhà cung cấp chấp thuận chưa có nghĩa PAT đã đăng nhập thành công.
      // Xóa thông tin bị từ chối để lần sau có thể chọn tài khoản khác.
      await resetSocialLoginSession(provider).catch(() => {});
      throw cause;
    }
  }, remember), [signIn]);

  // Khôi phục không tạo phiên hoặc ghi dữ liệu tài khoản/trò chơi trên thiết bị.
  const recoverPassword = useCallback(async (request: () => Promise<void>, message: string,
    afterSuccess?: (epoch: number) => Promise<void>): Promise<MessageResult> => {
    if (!ready || resettingRef.current || authOperationRef.current || sessionRef.current)
      return { ok: false, message: 'Vui lòng đăng xuất hoặc đợi thao tác hiện tại hoàn tất.' };
    authOperationRef.current = true;
    const epoch = economySessionRef.current;
    try {
      await request();
      if (epoch !== economySessionRef.current) throw new Error('Phiên sử dụng đã thay đổi.');
      await afterSuccess?.(epoch);
      if (epoch !== economySessionRef.current) throw new Error('Phiên sử dụng đã thay đổi.');
      return { ok: true, message };
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : 'Chưa thể khôi phục mật khẩu. Hãy thử lại.' };
    } finally { authOperationRef.current = false; }
  }, [authOperationRef, economySessionRef, ready, resettingRef, sessionRef]);

  const requestPasswordReset = useCallback((email: string) => recoverPassword(
    () => accountAuth.requestPasswordReset(email),
    'Nếu email đã đăng ký, hãy kiểm tra thư để lấy mã khôi phục.',
  ), [recoverPassword]);
  const resetPassword = useCallback((token: string, newPassword: string) => recoverPassword(
    () => accountAuth.resetPassword(token, newPassword),
    'Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới.',
    // Mã khôi phục không xác định email tại máy; chỉ giữ gợi ý email, xóa mật khẩu cũ.
    epoch => storeRememberedLogin(rememberedLoginRef.current?.email ?? null, epoch, null),
  ), [recoverPassword, rememberedLoginRef, storeRememberedLogin]);

  const logout = useCallback(() => {
    if (resettingRef.current) return;
    const previousSession = sessionRef.current;
    cloudRef.current = null;
    setSyncStatus({ phase: 'idle', message: '' });
    sessionRef.current = null;
    setAccount(null);
    economySessionRef.current += 1;
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
  }, [cloudRef, commit, economySessionRef, resettingRef, sessionRef, setAccount, setStorageError, setSyncStatus, storeSession]);

  const linkSocial = useCallback(async (provider: SocialProvider): Promise<ActionResult> => {
    const active = sessionRef.current;
    if (!active || authOperationRef.current || resettingRef.current)
      return { ok: false, message: 'Vui lòng đăng nhập lại hoặc đợi thao tác hiện tại.' };
    authOperationRef.current = true;
    const epoch = economySessionRef.current;
    try {
      const providers = await accountAuth.socialProviders();
      if (!providers[provider]) throw new Error(t('Máy chủ chưa cấu hình đăng nhập {provider}.', { provider: provider === 'google' ? 'Google' : 'Facebook' }));
      const challenge = provider === 'facebook' ? await accountAuth.socialChallenge('link', active.session.token) : undefined;
      const credential = await startSocialLogin(provider, challenge);
      if (!credential) return { ok: false, cancelled: true };
      if (epoch !== economySessionRef.current) throw new Error('Phiên sử dụng đã thay đổi.');
      const user = await accountAuth.linkSocial(active.session.token, credential).catch(async (cause: unknown) => {
        await resetSocialLoginSession(provider).catch(() => {});
        throw cause;
      });
      if (epoch !== economySessionRef.current || user.id.toLowerCase() !== active.user.id.toLowerCase())
        throw new Error('Phiên sử dụng đã thay đổi.');
      sessionRef.current = { ...active, user };
      setAccount(user);
      if (stateRef.current.auth.remember) await storeSession(sessionRef.current);
      if (epoch !== economySessionRef.current) throw new Error('Phiên sử dụng đã thay đổi.');
      return { ok: true, message: 'Đã liên kết tài khoản.' };
    } catch (cause) {
      if (cause instanceof AccountAuthError && cause.status === 401 &&
          ['AUTH_REQUIRED', 'SESSION_EXPIRED', 'INVALID_SESSION', 'UNAUTHORIZED'].includes(cause.code)) logout();
      return { ok: false, message: cause instanceof Error ? cause.message : 'Chưa thể liên kết tài khoản.' };
    } finally { authOperationRef.current = false; }
  }, [authOperationRef, economySessionRef, logout, resettingRef, sessionRef, setAccount, stateRef, storeSession]);

  const updateAccountProfile = useCallback(async (updates: AccountProfileInput): Promise<ActionResult> => {
    const validated = validateAccountProfile(updates);
    if (!validated.ok) return validated;
    const active = sessionRef.current;
    if (!active || authOperationRef.current) return { ok: false, message: 'Vui lòng đăng nhập lại hoặc đợi thao tác hiện tại.' };
    authOperationRef.current = true;
    const epoch = economySessionRef.current;
    try {
      const user = await accountAuth.updateProfile(active.session.token, validated.value.name);
      if (epoch !== economySessionRef.current || user.id.toLowerCase() !== active.user.id.toLowerCase()) throw new Error('Phiên sử dụng đã thay đổi.');
      sessionRef.current = { ...active, user };
      setAccount(user);
      if (stateRef.current.auth.remember) await storeSession(sessionRef.current);
      if (epoch !== economySessionRef.current) throw new Error('Phiên sử dụng đã thay đổi.');
      commit((current) => ({ ...current, profile: { ...current.profile, name: user.username,
        email: user.email, phone: validated.value.phone } }));
      await persistNow();
      return { ok: true };
    } catch (cause) {
      if (cause instanceof AccountAuthError && cause.status === 401) logout();
      return { ok: false, message: cause instanceof Error ? cause.message : 'Chưa thể lưu hồ sơ.' };
    }
    finally { authOperationRef.current = false; }
  }, [authOperationRef, commit, economySessionRef, logout, persistNow, sessionRef, setAccount, stateRef, storeSession]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string): Promise<MessageResult> => {
    const active = sessionRef.current;
    if (!active || authOperationRef.current) return { ok: false, message: 'Vui lòng đăng nhập lại hoặc đợi thao tác hiện tại.' };
    authOperationRef.current = true;
    const epoch = economySessionRef.current;
    let changed = false;
    try {
      const replacement = await accountAuth.changePassword(active.session.token, currentPassword, newPassword);
      changed = true;
      if (epoch !== economySessionRef.current || replacement.user.id.toLowerCase() !== active.user.id.toLowerCase()) {
        void accountAuth.logout(replacement.session.token).catch(() => {});
        throw new Error('Phiên sử dụng đã thay đổi.');
      }
      sessionRef.current = replacement;
      setAccount(replacement.user);
      if (stateRef.current.auth.remember && rememberedLoginRef.current?.email === replacement.user.email)
        await storeRememberedLogin(replacement.user.email, epoch, newPassword);
      await storeSession(stateRef.current.auth.remember ? replacement : null);
      if (epoch !== economySessionRef.current) throw new Error('Phiên sử dụng đã thay đổi.');
      return { ok: true, message: 'Đã đổi mật khẩu. Các phiên đăng nhập cũ đã được đăng xuất.' };
    } catch (cause) {
      if (changed && epoch === economySessionRef.current) {
        logout();
        return { ok: true, message: cause instanceof AccountAuthError && cause.code === 'STORAGE'
          ? 'Đã đổi mật khẩu nhưng chưa lưu được thông tin ghi nhớ. Vui lòng đăng nhập lại bằng mật khẩu mới.'
          : 'Đã đổi mật khẩu. Vui lòng đăng nhập lại bằng mật khẩu mới.' };
      }
      if (cause instanceof AccountAuthError && cause.status === 401) logout();
      return { ok: false, message: cause instanceof Error ? cause.message : 'Chưa thể đổi mật khẩu.' };
    } finally { authOperationRef.current = false; }
  }, [authOperationRef, economySessionRef, logout, rememberedLoginRef, sessionRef, setAccount, stateRef, storeRememberedLogin, storeSession]);

  return useMemo(() => ({
    login, register, loginSocial, linkSocial, logout, updateRememberLogin,
    updateAccountProfile, changePassword, requestPasswordReset, resetPassword,
  }), [changePassword, linkSocial, login, loginSocial, logout, register, requestPasswordReset,
    resetPassword, updateAccountProfile, updateRememberLogin]);
}
