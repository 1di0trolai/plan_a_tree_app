/** Cung cấp bộ giả lập dịch tiếng Việt ổn định cho kiểm thử giao diện trong môi trường máy ảo JavaScript. */
const translate = (source: string, params: Record<string, string | number> = {}) => source.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g,
  (placeholder, key: string) => Object.hasOwn(params, key) ? String(params[key]) : placeholder);
export const viI18n = {
  t: translate,
  getLocale: () => 'vi' as const,
  getLocaleTag: () => 'vi-VN',
  locale: 'vi' as const,
  useI18n: () => ({ locale: 'vi' as const, t: translate, setLocale: async () => {} }),
};
export const i18nFixture = viI18n;
