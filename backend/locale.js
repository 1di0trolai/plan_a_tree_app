/** Chọn ngôn ngữ Việt/Anh/Nhật từ danh sách cho phép và ưu tiên Accept-Language, không đưa văn bản tùy ý vào lời nhắc AI. */
export const SUPPORTED_LOCALES = Object.freeze(['vi', 'en', 'ja']);
export const normalizeLocale = value => SUPPORTED_LOCALES.includes(value) ? value : 'vi';

/** Header values select an allowlisted language only, never arbitrary prompt text. */
export function requestLocale(header) {
  if (typeof header !== 'string' || header.length > 512) return 'vi';
  const choices = header.split(',').slice(0, 10).map((part, index) => {
    const match = /^\s*(vi|en|ja)(?:-[a-z0-9]{2,8})?(?:\s*;\s*q=(0(?:\.\d{1,3})?|1(?:\.0{1,3})?))?\s*$/i.exec(part);
    return match ? { locale: match[1].toLowerCase(), quality: match[2] === undefined ? 1 : Number(match[2]), index } : null;
  }).filter(value => value && value.quality > 0).sort((a, b) => b.quality - a.quality || a.index - b.index);
  return choices[0]?.locale ?? 'vi';
}
