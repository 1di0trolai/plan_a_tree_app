/** Nạp và lưu dữ liệu trên thiết bị, chuyển đổi bản lưu cũ có sao lưu và hoàn tất dọn ảnh hoặc nhạc theo kế hoạch đã lưu để tránh mất dữ liệu khi gián đoạn. */

import { createInitialState } from '../data/seed';
import type { AppState } from '../types/app';
import { normalizePersistedState } from './normalizeState';

export const STORAGE_KEY = 'PAT_MOBILE_STATE_V1';
export const LEGACY_PET_BACKUP_KEY = 'PAT_MOBILE_STATE_V3_PET_BACKUP';
// The requested clean start runs once, not on every launch or AppState migration.
export const FRESH_START_EPOCH = 'fresh-user-2026-10-26';

export interface StoredUserData {
  storageEpoch: typeof FRESH_START_EPOCH;
  state: AppState;
  pendingPhotoCleanup: string[];
  /** Optional for older envelopes; new private audio uses the same durable cleanup discipline. */
  pendingMusicCleanup?: string[];
  /** Account-scoped outbox, atomically committed with the game snapshot. */
  cloudSync?: unknown;
}

export interface UserStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  listPhotos: () => string[];
  deletePhoto: (uri: string) => void;
  listMusic?: () => string[];
  deleteMusic?: (uri: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasStoredStateShape(value: unknown): boolean {
  if (!isRecord(value) || ![3, 4, 5].includes(value.version as number)) return false;
  const collections = ['plants', 'checkIns', 'plantPhotos', 'plantAnalyses', 'plantChibis',
    'chatMessages', 'careEvents', 'dailyRounds', 'dailyPacks'];
  if (!collections.every((key) => Array.isArray(value[key]))) return false;
  if (!isRecord(value.auth) || !isRecord(value.profile) || !isRecord(value.settings)
      || !isRecord(value.daily) || !isRecord(value.inventory)) return false;
  return typeof value.activePlantId === 'string' && typeof value.battleNotify === 'boolean'
    && typeof value.auth.loggedIn === 'boolean' && typeof value.auth.remember === 'boolean'
    && typeof value.auth.identity === 'string'
    && typeof value.profile.name === 'string' && typeof value.profile.title === 'string'
    && typeof value.profile.avatar === 'string'
    && (value.profile.avatarImageUri === null || typeof value.profile.avatarImageUri === 'string')
    && Array.isArray(value.version === 4 || value.version === 5 ? value.inventory.pets : value.inventory.beasts)
    && Array.isArray(value.inventory.items);
}

export function statePhotoUris(state: AppState): string[] {
  return [...new Set([
    ...state.plantPhotos.map((photo) => photo.imageUri),
    ...state.plantChibis.flatMap((chibi) => chibi.imageUri ? [chibi.imageUri] : []),
    ...(state.profile.avatarImageUri ? [state.profile.avatarImageUri] : []),
  ])];
}

/** Old files may only be removed after the replacement data is durably saved. */
async function finishPhotoCleanup(port: UserStorage, record: StoredUserData): Promise<StoredUserData> {
  const referenced = new Set(statePhotoUris(record.state));
  const pending: string[] = [];
  for (const uri of record.pendingPhotoCleanup) {
    if (referenced.has(uri)) continue;
    try { port.deletePhoto(uri); }
    catch { pending.push(uri); }
  }
  const pendingMusic: string[] = [];
  for (const uri of record.pendingMusicCleanup ?? []) {
    if (uri === record.state.settings.musicUri) continue;
    try {
      if (!port.deleteMusic) throw new Error('Trình dọn nhạc chưa sẵn sàng.');
      port.deleteMusic(uri);
    } catch { pendingMusic.push(uri); }
  }
  if (pending.length === record.pendingPhotoCleanup.length
      && pendingMusic.length === (record.pendingMusicCleanup?.length ?? 0)) return record;

  const updated = { ...record, pendingPhotoCleanup: pending,
    ...(record.pendingMusicCleanup !== undefined ? { pendingMusicCleanup: pendingMusic } : {}) };
  try {
    await port.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    // Keep the already-durable cleanup plan. Retrying a deleted file is harmless;
    // losing the plan could strand old photos after a crash or failed write.
    return record;
  }
}

export async function clearStoredUserData(port: UserStorage): Promise<StoredUserData> {
  // Listing must succeed BEFORE overwriting state, so every private copy is
  // recorded, including orphaned files no longer referenced by a plant.
  const record: StoredUserData = {
    storageEpoch: FRESH_START_EPOCH,
    state: createInitialState(),
    pendingPhotoCleanup: [...new Set(port.listPhotos())],
    ...(port.listMusic ? { pendingMusicCleanup: [...new Set(port.listMusic())] } : {}),
  };
  // State, reset marker and cleanup plan share one SQLite write. A crash cannot
  // leave a missing marker that wipes the user's newly created garden later.
  await port.setItem(LEGACY_PET_BACKUP_KEY, 'null');
  await port.setItem(STORAGE_KEY, JSON.stringify(record));
  return finishPhotoCleanup(port, record);
}

export async function loadStoredUserData(port: UserStorage): Promise<StoredUserData> {
  // A read error must not be treated as an empty database and overwrite data.
  const raw = await port.getItem(STORAGE_KEY);
  if (raw === null) return clearStoredUserData(port);
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !('storageEpoch' in parsed)
      || parsed.storageEpoch !== FRESH_START_EPOCH) {
    return clearStoredUserData(port);
  }
  if (!('state' in parsed) || !hasStoredStateShape(parsed.state)) {
    throw new Error('Dữ liệu PAT bị lỗi. Không tự động ghi đè dữ liệu đã lưu.');
  }
  if (!('pendingPhotoCleanup' in parsed) || !Array.isArray(parsed.pendingPhotoCleanup)
      || !parsed.pendingPhotoCleanup.every((uri: unknown) => typeof uri === 'string')) {
    throw new Error('Danh sách ảnh chờ xóa bị lỗi. Không tự động bỏ qua bước dọn ảnh.');
  }
  const pending = parsed.pendingPhotoCleanup.filter((uri): uri is string => typeof uri === 'string');
  const pendingMusic: unknown = 'pendingMusicCleanup' in parsed ? parsed.pendingMusicCleanup : undefined;
  if (pendingMusic !== undefined && (!Array.isArray(pendingMusic) || !pendingMusic.every((uri) => typeof uri === 'string'))) {
    throw new Error('Danh sách nhạc chờ xóa bị lỗi. Không tự động bỏ qua bước dọn tệp.');
  }
  let record: StoredUserData = {
    storageEpoch: FRESH_START_EPOCH,
    state: normalizePersistedState(parsed.state),
    pendingPhotoCleanup: [...new Set(pending)],
    ...(Array.isArray(pendingMusic) ? { pendingMusicCleanup: [...new Set(pendingMusic as string[])] } : {}),
    ...('cloudSync' in parsed ? { cloudSync: parsed.cloudSync } : {}),
  };
  if (isRecord(parsed.state) && parsed.state.version === 3) {
    // Preserve the original inventory before the first individual-pet save.
    // A failed backup or migration write must leave the old main save recoverable.
    await port.setItem(LEGACY_PET_BACKUP_KEY, JSON.stringify({ version: 3, inventory: parsed.state.inventory }));
    await port.setItem(STORAGE_KEY, JSON.stringify(record));
  }
  // The soundtrack is bundled now. Retire only the old PAT copy, after its
  // replacement metadata and cleanup plan have been saved in the same write.
  const oldMusic = record.state.settings.musicUri;
  if (oldMusic || record.state.settings.musicName) {
    record = {
      ...record,
      state: { ...record.state, settings: { ...record.state.settings, musicUri: null, musicName: null } },
      pendingMusicCleanup: [...new Set([...(record.pendingMusicCleanup ?? []), ...(oldMusic ? [oldMusic] : [])])],
    };
    await port.setItem(STORAGE_KEY, JSON.stringify(record));
  }
  return finishPhotoCleanup(port, record);
}

export async function saveStoredUserData(
  port: UserStorage,
  previous: StoredUserData,
  state: AppState,
): Promise<StoredUserData> {
  const currentPhotos = new Set(statePhotoUris(state));
  const removed = statePhotoUris(previous.state).filter((uri) => !currentPhotos.has(uri));
  const oldMusic = previous.state.settings.musicUri;
  const removedMusic = oldMusic && oldMusic !== state.settings.musicUri ? [oldMusic] : [];
  const pendingMusic = [...new Set([...(previous.pendingMusicCleanup ?? []), ...removedMusic])];
  const record: StoredUserData = {
    storageEpoch: FRESH_START_EPOCH,
    state,
    ...(previous.cloudSync !== undefined ? { cloudSync: previous.cloudSync } : {}),
    pendingPhotoCleanup: [...new Set([...previous.pendingPhotoCleanup, ...removed])],
    ...(previous.pendingMusicCleanup !== undefined || pendingMusic.length ? { pendingMusicCleanup: pendingMusic } : {}),
  };
  await port.setItem(STORAGE_KEY, JSON.stringify(record));
  return finishPhotoCleanup(port, record);
}
