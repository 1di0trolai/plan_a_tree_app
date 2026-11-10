/** Gộp các danh mục dịch Việt, Anh và Nhật; quản lý ngôn ngữ hiện hành, thay tham số trong câu và định dạng số theo ngôn ngữ. */

import { accountMessages } from './account';
import { gardenMessages } from './garden';
import { inventoryMessages } from './inventory';
import { commonMessages } from './common';
import { actionMessages } from './actionMessages';

export type Locale = 'vi' | 'en' | 'ja';
export type TranslationParams = Record<string, string | number>;
export const LANGUAGES: readonly { code: Locale; name: string }[] = [
  { code: 'vi', name: 'Tiếng Việt' }, { code: 'en', name: 'English' }, { code: 'ja', name: '日本語' },
];
export const LOCALE_TAGS = { vi: 'vi-VN', en: 'en-US', ja: 'ja-JP' } as const;
export const isLocale = (value: unknown): value is Locale => value === 'vi' || value === 'en' || value === 'ja';
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
export const messages: Readonly<Record<string, readonly [string, string]>> = Object.fromEntries(
  Object.entries({ ...accountMessages, ...gardenMessages, ...inventoryMessages, ...actionMessages, ...commonMessages })
    .map(([source, translations]) => [normalize(source), translations]));

let locale: Locale = 'vi';
const listeners = new Set<() => void>();
export const getLocale = () => locale;
export const getLocaleTag = () => LOCALE_TAGS[locale];
export function subscribeLocale(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
/** Internal commit: call only after the device preference has been written. */
export function commitLocale(value: Locale) {
  if (!isLocale(value)) throw new Error('Unsupported language');
  if (value === locale) return;
  locale = value; for (const listener of listeners) listener();
}
/** Explicit UI source keys only. Never pass user notes, names or chat history here. */
export function t(source: string, params: TranslationParams = {}): string {
  const translated = locale === 'vi' ? source : messages[normalize(source)]?.[locale === 'en' ? 0 : 1] ?? source;
  return translated.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g,
    (placeholder, key: string) => Object.hasOwn(params, key) ? String(params[key]) : placeholder);
}
export const formatNumber = (value: number) => new Intl.NumberFormat(getLocaleTag()).format(value);
