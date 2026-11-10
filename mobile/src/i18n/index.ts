/** Nạp và lưu lựa chọn ngôn ngữ riêng trên thiết bị, cung cấp hook để giao diện cập nhật khi đổi ngôn ngữ; không đưa tùy chọn này vào bản lưu trò chơi. */

import { useSyncExternalStore } from 'react';
import storage from 'expo-sqlite/kv-store';
import { commitLocale, getLocale, isLocale, subscribeLocale, t, type Locale } from './core';

export * from './core';
export const LANGUAGE_STORAGE_KEY = 'PAT_UI_LANGUAGE_V1';
let writes = Promise.resolve();
let loading: Promise<void> | undefined;

/** Language is an installation preference, not part of a game/cloud snapshot. */
export function loadLanguage(): Promise<void> {
  if (!loading) loading = storage.getItem(LANGUAGE_STORAGE_KEY).then(value => {
    if (isLocale(value)) commitLocale(value);
  }).catch(() => { /* Keep Vietnamese usable; a later explicit choice can retry storage. */ });
  return loading;
}
export function setLocale(locale: Locale): Promise<void> {
  if (!isLocale(locale)) return Promise.reject(new Error('Unsupported language'));
  const operation = writes.catch(() => {}).then(async () => {
    // Finish hydration before writing a choice so a slow read cannot overwrite it.
    await loadLanguage();
    try { await storage.setItem(LANGUAGE_STORAGE_KEY, locale); }
    catch { throw new Error(t('Chưa lưu được ngôn ngữ. Hãy thử lại.')); }
    commitLocale(locale);
  });
  writes = operation;
  return operation;
}
export function useI18n() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, () => 'vi' as const);
  return { locale, t, setLocale };
}
