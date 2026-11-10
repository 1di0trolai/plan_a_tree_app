/** Kiểm tra cấu trúc kết quả AI, chọn ảnh hiện tại và giới hạn ngữ cảnh, kích thước ảnh cùng dung lượng yêu cầu gửi lên máy chủ. */

import type { Plant, PlantPhoto } from '../types/app';

export type AiResponseKind = 'identify' | 'recognize' | 'analyze' | 'chat';

/** Recent excerpts only; the full journal/photos remain stored on the device. */
export const CHAT_CONTEXT_LIMITS = {
  photos: 2,
  analyses: 6, analysisCharacters: 400,
  careEvents: 10, careEventCharacters: 240,
  messages: 8, previousMessageCharacters: 600,
  photoEdge: 768,
} as const;

const CROPS = ['mango', 'tomato', 'chili', 'other'];
const PHASES = ['planning', 'germinating', 'seedling', 'growing', 'flowering', 'fruiting'];
const LEVELS = ['Tốt', 'Chú ý', 'Cảnh báo'];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_BODY_BYTES = 12 * 1024 * 1024;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function strings(value: unknown, maxItems = 8, maxLength = 1500): value is string[] {
  if (!Array.isArray(value) || value.length > maxItems) return false;
  for (const item of value) if (!text(item, maxLength)) return false;
  return true;
}

function enumValue(value: unknown, values: string[]): boolean {
  return typeof value === 'string' && values.includes(value);
}

function optionalNotes(result: Record<string, unknown>): boolean {
  return (result.questions === undefined || strings(result.questions))
    && (result.limitations === undefined || strings(result.limitations));
}

/** Mirror the server's response bounds before any native UI renders the result. */
export function validateAiResponse(kind: AiResponseKind, result: unknown, allowedIds?: string[]): boolean {
  if (!record(result)) return false;
  if (kind === 'identify') {
    return enumValue(result.crop, CROPS) && enumValue(result.phase, PHASES)
      && text(result.label, 150) && text(result.species, 150) && text(result.summary, 600)
      && strings(result.guide, 3, 300) && strings(result.warnings, 2, 300);
  }
  if (kind === 'recognize') {
    if (!enumValue(result.decision, ['candidate', 'ambiguous', 'unknown', 'retake'])
      || !strings(result.candidateIds, 3, 100) || !text(result.explanation, 3000)) return false;
    const ids = result.candidateIds;
    if (new Set(ids).size !== ids.length) return false;
    if (ids.length && (!allowedIds || ids.some((id) => !allowedIds.includes(id)))) return false;
    if (result.decision === 'candidate') return ids.length === 1;
    if (result.decision === 'ambiguous') return ids.length >= 2;
    return ids.length === 0;
  }
  if (kind === 'analyze') {
    const analysis = result.analysis;
    return record(analysis) && enumValue(analysis.level, LEVELS)
      && text(analysis.title, 200) && text(analysis.summary, 4000)
      && strings(analysis.actions) && optionalNotes(result);
  }
  if (kind === 'chat') return text(result.content, 6000) && optionalNotes(result);
  return false;
}

/** Seed placeholders and stale-stage fruit photos are not identity references. */
export function pickCurrentPhotos(plant: Plant, photos: PlantPhoto[]): PlantPhoto[] {
  return photos.filter((photo) => photo.plantId === plant.id && photo.phase === plant.journey.phase
      && /^(?:file|content|ph):\/\/\S+$/i.test(photo.imageUri))
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
    .slice(0, CHAT_CONTEXT_LIMITS.photos);
}

/** Bound both axes and do not inflate smaller source images on older devices. */
export function imageResize(width: number, height: number, maximumEdge = 960): { width: number; height: number } {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Kích thước ảnh không hợp lệ.');
  }
  if (!Number.isSafeInteger(maximumEdge) || maximumEdge < 1 || maximumEdge > 960)
    throw new Error('Giới hạn kích thước ảnh không hợp lệ.');
  const scale = Math.min(1, maximumEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function base64Bytes(value: string): number | null {
  if (!value.length || value.length % 4 || /[^A-Za-z0-9+/=]/.test(value)) return null;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  if (value.slice(0, value.length - padding).includes('=')) return null;
  return value.length / 4 * 3 - padding;
}

// React Native need not provide TextEncoder or Node's Buffer for this calculation.
function utf8Size(value: string): number {
  let size = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x80) size++;
    else if (code < 0x800) size += 2;
    else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      size += 4;
      index++;
    } else size += 3;
    if (size > MAX_BODY_BYTES) return size;
  }
  return size;
}

/** Reject oversized bodies before fetch; compare decoded bytes, not base64 length. */
export function imagePayloadWithinBudget(payload: unknown): boolean {
  let imageBytes = 0;
  let visited = 0;
  const ancestors = new WeakSet<object>();
  const inspect = (value: unknown, depth: number): boolean => {
    if (++visited > 100_000 || depth > 64 || typeof value === 'bigint') return false;
    if (!value || typeof value !== 'object') return true;
    if (ancestors.has(value)) return false;
    ancestors.add(value);
    try {
      if (record(value) && 'base64' in value) {
        if (typeof value.base64 !== 'string') return false;
        const bytes = base64Bytes(value.base64);
        if (bytes === null || (imageBytes += bytes) > MAX_IMAGE_BYTES) return false;
      }
      return Object.values(value).every((child) => inspect(child, depth + 1));
    } finally { ancestors.delete(value); }
  };
  try {
    if (!inspect(payload, 0)) return false;
    const json = JSON.stringify(payload);
    return typeof json === 'string' && utf8Size(json) <= MAX_BODY_BYTES;
  } catch { return false; }
}
