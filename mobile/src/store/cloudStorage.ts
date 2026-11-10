/** Quản lý bản lưu và hàng đợi đồng bộ bền vững theo tài khoản, gồm dữ liệu, ảnh và thao tác hòm thư. Kiểm tra phiên bản để tránh ghi đè thay đổi từ thiết bị khác và giữ bản sao khi xung đột. */

import type { AuthUser } from '../services/accountAuth';
import type { CloudAssetFiles } from '../services/cloudAssets';
import { CloudSyncError, type CloudSnapshot, type CloudSyncPort, type MailAction } from '../services/cloudSync';
import type { AppState } from '../types/app';
import { normalizePersistedState } from './normalizeState';
import { normalizeMailbox } from './normalizeMailbox';
import { STORAGE_KEY, type StoredUserData, type UserStorage } from './storageLifecycle';

export interface SyncStatus {
  phase: 'idle' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'error';
  message: string;
  updatedAt?: string | null;
  retryable?: boolean;
}
type Pending = ({ kind: 'state'; state: unknown } | { kind: 'mail'; action: Omit<MailAction, 'requestId' | 'revision'> })
  & { requestId: string; revision: number; generation: number };
interface Metadata {
  version: 1; revision: number | null; generation: number; dirty: boolean;
  pending: Pending | null; assets: Record<string, string>; updatedAt: string | null;
}
export interface CloudStorage {
  port: UserStorage;
  record(): StoredUserData;
  open(): Promise<StoredUserData>;
  flush(canImport?: () => boolean): Promise<StoredUserData>;
  refresh(force?: boolean, canImport?: () => boolean): Promise<StoredUserData>;
  mail(action: Omit<MailAction, 'requestId' | 'revision'>): Promise<StoredUserData>;
  status(): SyncStatus;
  blocked(): boolean;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const assetId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const privateUri = (uri: string) => /^(file|content):\/\//i.test(uri);
const uploadableUri = (uri: string) => privateUri(uri) || /^https:\/\//i.test(uri);

function metadata(value: unknown): Metadata {
  if (value === undefined) return { version: 1, revision: null, generation: 0, dirty: false, pending: null, assets: {}, updatedAt: null };
  if (!object(value) || value.version !== 1 || !(value.revision === null || Number.isSafeInteger(value.revision) && (value.revision as number) >= 0) ||
      !Number.isSafeInteger(value.generation) || (value.generation as number) < 0 || typeof value.dirty !== 'boolean' ||
      !object(value.assets) || Object.entries(value.assets).some(([uri, id]) => !uploadableUri(uri) || typeof id !== 'string' || !assetId.test(id)) ||
      !(value.updatedAt === null || typeof value.updatedAt === 'string')) throw new Error('Hàng đợi đồng bộ chưa hợp lệ. Không tự động ghi đè.');
  if (value.pending !== null) {
    const p = value.pending;
    if (!object(p) || !['state', 'mail'].includes(p.kind as string) || typeof p.requestId !== 'string' ||
        !/^[A-Za-z0-9_-]{8,128}$/.test(p.requestId) || !Number.isSafeInteger(p.revision) || (p.revision as number) < 0 ||
        !Number.isSafeInteger(p.generation) || (p.generation as number) > (value.generation as number) ||
        (p.kind === 'state' ? !object(p.state) : !object(p.action))) throw new Error('Giao dịch đồng bộ đang chờ chưa hợp lệ.');
  }
  return clone(value as unknown as Metadata);
}

function validateState(value: unknown): AppState {
  const lists = ['plants', 'checkIns', 'plantPhotos', 'plantAnalyses', 'plantChibis', 'chatMessages', 'careEvents', 'dailyRounds', 'dailyPacks', 'mailbox'];
  if (!object(value) || value.version !== 5 || !lists.every(key => Array.isArray(value[key])) ||
      !object(value.profile) || !object(value.inventory) || !Array.isArray(value.inventory.pets) || !Array.isArray(value.inventory.items) ||
      !object(value.economy) || !object(value.settings) || !object(value.daily))
    throw new CloudSyncError('INVALID_RESPONSE', 'Bản lưu máy chủ chưa hợp lệ. Dữ liệu trên máy chưa bị thay thế.');
  return normalizePersistedState(value);
}

function imageUris(state: AppState): string[] {
  return [...new Set([...state.plantPhotos.map(photo => photo.imageUri),
    ...state.plantChibis.flatMap(chibi => chibi.imageUri ? [chibi.imageUri] : []),
    ...(state.profile.avatarImageUri ? [state.profile.avatarImageUri] : [])])];
}
function replaceImages(state: AppState, uris: Map<string, string>): AppState {
  return { ...state,
    plantPhotos: state.plantPhotos.map(photo => ({ ...photo, imageUri: uris.get(photo.imageUri) ?? photo.imageUri })),
    plantChibis: state.plantChibis.map(chibi => ({ ...chibi, imageUri: chibi.imageUri ? uris.get(chibi.imageUri) ?? chibi.imageUri : null })),
    profile: { ...state.profile, avatarImageUri: state.profile.avatarImageUri ? uris.get(state.profile.avatarImageUri) ?? state.profile.avatarImageUri : null } };
}
/** No token, login flag, identity or local audio URI is ever sent in snapshots. */
function portable(state: AppState): unknown {
  const { auth: _auth, ...data } = state;
  return { ...data, settings: { ...data.settings, musicUri: null, musicName: null },
    mailbox: data.mailbox.filter(mail => mail.source !== 'publisher') };
}
const equivalent = (a: AppState, b: AppState) => JSON.stringify(portable(a)) === JSON.stringify(portable(b));
// SQL projection and the mobile normalizer have different property order.
// Compare normalized letters, otherwise every poll creates an identical backup.
const publisherLetters = (value: unknown) => JSON.stringify(
  normalizeMailbox(object(value) ? value.mailbox : undefined)
    .filter(mail => mail.source === 'publisher').sort((a, b) => a.id.localeCompare(b.id)));

/** Local outbox and snapshot share a single SQLite envelope; remote changes use CAS. */
export function createCloudStorage(options: {
  port: UserStorage; record: StoredUserData; user: () => AuthUser; token: () => string;
  api: CloudSyncPort; files: CloudAssetFiles; onStatus?: (status: SyncStatus) => void;
  requestId?: () => string;
}): CloudStorage {
  let current = clone(options.record);
  let meta = metadata(current.cloudSync);
  let queue = Promise.resolve();
  let phase: SyncStatus = { phase: 'idle', message: '' };
  let conflict = false;
  const id = options.requestId ?? (() => `sync-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
  const publish = (next: SyncStatus) => { phase = next; options.onStatus?.(next); };
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const work = queue.catch(() => {}).then(operation); queue = work.then(() => {}, () => {}); return work;
  };
  async function write(record = current, next = meta) {
    const saved = { ...record, cloudSync: clone(next) };
    await options.port.setItem(STORAGE_KEY, JSON.stringify(saved));
    current = saved; meta = clone(next);
  }
  async function backup(reason: string) {
    // Keep every conflicting/migrated snapshot. Never erase the legacy save or its images.
    await options.port.setItem(`PAT_CLOUD_BACKUP_V1:${Date.now()}:${id()}`, JSON.stringify({ reason, record: current }));
  }
  function fail(cause: unknown): never {
    const code = cause instanceof CloudSyncError ? cause.code : '';
    if (code === 'SYNC_CONFLICT') conflict = true;
    const retryable = !conflict && cause instanceof CloudSyncError &&
      (['NETWORK', 'TIMEOUT', 'SYNC_BUSY'].includes(code) || code === 'SERVER_ERROR' && (cause.status ?? 0) >= 500);
    publish({ phase: conflict ? 'conflict' : ['NETWORK', 'TIMEOUT'].includes(code) ? 'offline' : 'error',
      message: cause instanceof Error ? cause.message : 'Chưa đồng bộ được. Dữ liệu trên máy vẫn được giữ lại.',
      updatedAt: meta.updatedAt, retryable });
    throw cause;
  }
  async function remoteState(raw: unknown): Promise<AppState> {
    const state = validateState(raw); const replacements = new Map<string, string>();
    for (const uri of imageUris(state)) {
      if (!uri.startsWith('pat-asset:')) {
        if (privateUri(uri)) throw new CloudSyncError('INVALID_RESPONSE', 'Bản lưu máy chủ còn ảnh chưa được đồng bộ.');
        continue;
      }
      const key = uri.slice('pat-asset:'.length);
      if (!assetId.test(key)) throw new CloudSyncError('INVALID_RESPONSE', 'Mã ảnh trong bản lưu chưa hợp lệ.');
      let local = Object.keys(meta.assets).find(path => meta.assets[path] === key && options.files.exists(path));
      if (!local) local = await options.files.write(options.user().id, await options.api.getAsset(options.token(), key));
      meta.assets[local] = key; replacements.set(uri, local);
    }
    const restored = replaceImages(state, replacements); const user = options.user();
    return { ...restored, auth: { ...current.state.auth, loggedIn: true, identity: user.email, userId: user.id },
      profile: { ...restored.profile, name: user.username, email: user.email },
      // Notification/audio consent belongs to this installation, not another phone.
      settings: { ...restored.settings, notifications: current.state.settings.notifications,
        notificationConsent: current.state.settings.notificationConsent,
        music: current.state.settings.music, musicConsent: current.state.settings.musicConsent,
        musicUri: current.state.settings.musicUri, musicName: current.state.settings.musicName } };
  }
  async function uploadState(state: AppState): Promise<unknown> {
    const replacements = new Map<string, string>();
    for (const uri of imageUris(state)) {
      if (!uploadableUri(uri)) {
        if (!uri.startsWith('pat-asset:')) throw new Error('Ảnh chưa có định dạng có thể đồng bộ. Bản gốc vẫn được giữ trên máy.');
        continue;
      }
      let key = meta.assets[uri];
      if (!key) {
        const asset = await options.api.uploadAsset(options.token(), await options.files.read(uri));
        key = asset.assetId; meta.assets[uri] = key;
        await write();
      }
      replacements.set(uri, `pat-asset:${key}`);
    }
    return portable(replaceImages(state, replacements));
  }
  async function accept(snapshot: CloudSnapshot, generation: number, importing = false) {
    if (!snapshot.state) throw new CloudSyncError('INVALID_RESPONSE', 'Máy chủ chưa trả bản lưu đã xác nhận.');
    const state = await remoteState(snapshot.state);
    const sameGeneration = meta.generation === generation;
    // A queued newer local edit must not be overwritten by an older PUT receipt.
    const record = sameGeneration ? { ...current, state } : current;
    await write(record, { ...meta, revision: snapshot.revision, pending: null,
      dirty: !sameGeneration, updatedAt: snapshot.updatedAt });
    if (importing) conflict = false;
  }
  async function drain(canImport: () => boolean = () => true) {
    if (conflict) throw new CloudSyncError('SYNC_CONFLICT', 'Dữ liệu khác với máy chủ. Bản lưu trên máy vẫn được giữ lại.');
    if (meta.revision === null) {
      const remote = await options.api.getState(options.token());
      if (remote.state !== null) {
        if (meta.dirty || meta.pending || !canImport()) {
          await backup('offline-before-first-sync');
          throw new CloudSyncError('SYNC_CONFLICT', 'Máy chủ đã có bản lưu khác. Dữ liệu trên máy vẫn được giữ lại.');
        }
        await backup('before-first-cloud-import');
        await accept(remote, meta.generation, true);
        return;
      }
      await write(current, { ...meta, revision: remote.revision, dirty: true });
    }
    while (meta.pending || meta.dirty) {
      if (!meta.pending) {
        const payload = await uploadState(current.state);
        // The immutable HTTP payload/request ID are durable BEFORE sending.
        await write(current, { ...meta, pending: { kind: 'state', requestId: id(), revision: meta.revision!, generation: meta.generation, state: payload } });
      }
      const pending = meta.pending!;
      const response = pending.kind === 'state'
        ? await options.api.saveState(options.token(), { revision: pending.revision, requestId: pending.requestId, state: pending.state })
        : await options.api.mailAction(options.token(), { ...pending.action, requestId: pending.requestId, revision: pending.revision });
      if (response.replayed && response.appliedRevision !== undefined && response.revision > response.appliedRevision) {
        await backup('replayed-request-followed-by-other-device');
        throw new CloudSyncError('SYNC_CONFLICT', 'Thiết bị khác đã cập nhật sau giao dịch đang chờ. Bản lưu trên máy vẫn được giữ lại.');
      }
      await accept(response, pending.generation);
    }
  }
  const guard = async <T>(operation: () => Promise<T>) => {
    publish({ phase: 'syncing', message: 'Đang đồng bộ…', updatedAt: meta.updatedAt });
    try { const result = await operation(); publish({ phase: 'synced', message: 'Đã đồng bộ', updatedAt: meta.updatedAt }); return result; }
    catch (cause) { return fail(cause); }
  };
  const port: UserStorage = { ...options.port,
    getItem: key => key === STORAGE_KEY ? Promise.resolve(JSON.stringify(current)) : options.port.getItem(key),
    setItem: (key, value) => key !== STORAGE_KEY ? options.port.setItem(key, value) : serial(async () => {
      const record = JSON.parse(value) as StoredUserData;
      const changed = !equivalent(current.state, record.state);
      await write(record, { ...meta, generation: meta.generation + (changed ? 1 : 0), dirty: meta.dirty || changed });
      if (changed) publish({ phase: conflict ? 'conflict' : 'syncing',
        message: conflict ? 'Dữ liệu đã thay đổi trên thiết bị khác. Bản lưu trên máy vẫn được giữ lại.' : 'Đang đồng bộ…', updatedAt: meta.updatedAt });
    }),
  };
  return {
    port, record: () => clone(current), status: () => ({ ...phase }), blocked: () => conflict || meta.pending?.kind === 'mail',
    open: () => serial(async () => { try { await guard(async () => {
      const hadRevision = meta.revision !== null;
      await drain();
      if (!hadRevision) return; // Initial drain already fetched/imported the canonical snapshot.
      const remote = await options.api.getState(options.token());
      if (remote.state && (remote.revision !== meta.revision || publisherLetters(remote.state) !== publisherLetters(current.state))) {
        await backup('before-newer-cloud-import'); await accept(remote, meta.generation, true);
      }
    }); } catch { /* Open local data safely while offline. */ } return clone(current); }),
    flush: canImport => serial(() => guard(async () => { await drain(canImport); return clone(current); })),
    refresh: (force, canImport = () => true) => serial(() => guard(async () => {
      if (force) {
        const remote = await options.api.getState(options.token());
        if (remote.state === null) throw new Error('Máy chủ chưa có bản lưu. Không thay thế dữ liệu trên máy.');
        await backup('user-confirmed-cloud-reload');
        await accept(remote, meta.generation, true);
      } else {
        await drain(canImport);
        const remote = await options.api.getState(options.token());
        if (remote.state && (remote.revision !== meta.revision || publisherLetters(remote.state) !== publisherLetters(current.state))) {
          if (!canImport()) {
            await backup('local-edit-during-cloud-refresh');
            throw new CloudSyncError('SYNC_CONFLICT', 'Cả hai thiết bị vừa thay đổi dữ liệu. Bản lưu trên máy vẫn được giữ lại.');
          }
          await backup('before-newer-cloud-import'); await accept(remote, meta.generation, true);
        }
      }
      return clone(current);
    })),
    mail: action => serial(() => guard(async () => {
      await drain();
      await write(current, { ...meta, pending: { kind: 'mail', action: clone(action), requestId: id(), revision: meta.revision!, generation: meta.generation } });
      await drain(); return clone(current);
    })),
  };
}
