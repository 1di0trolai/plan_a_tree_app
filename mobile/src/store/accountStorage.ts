/** Tách vùng lưu dữ liệu theo tài khoản và chuyển dữ liệu cũ sang đúng chủ sở hữu, không xóa tệp riêng của tài khoản khác. */

import { createInitialState } from '../data/seed';
import type { AuthUser } from '../services/accountAuth';
import { FRESH_START_EPOCH, STORAGE_KEY, loadStoredUserData, type StoredUserData, type UserStorage } from './storageLifecycle';

const OWNER_KEY = 'PAT_LEGACY_ACCOUNT_OWNER_V1';
const locks = new WeakMap<UserStorage, Promise<unknown>>();
const identity = (value: string) => value.trim().toLowerCase();
function accountId(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw new Error('Mã tài khoản chưa hợp lệ.');
  return value.toLowerCase();
}

/** Account saves never enumerate or delete another account's private files. */
export function accountStorage(base: UserStorage, userId: string): UserStorage {
  const prefix = `PAT_ACCOUNT_V1:${accountId(userId)}:`;
  return {
    getItem: key => base.getItem(prefix + key),
    setItem: (key, value) => base.setItem(prefix + key, value),
    listPhotos: () => [], deletePhoto: uri => base.deletePhoto(uri),
    listMusic: () => [], deleteMusic: uri => base.deleteMusic?.(uri),
  };
}

export async function loadAccountData(base: UserStorage, user: AuthUser, legacy: StoredUserData) {
  const id = accountId(user.id);
  const load = (locks.get(base) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const port = accountStorage(base, id);
    const saved = await port.getItem(STORAGE_KEY);
    let record: StoredUserData;
    if (saved !== null) {
      // Generic storage's old epoch migration can reset data. Account saves must fail closed instead.
      const parsed = JSON.parse(saved) as Partial<StoredUserData>;
      if (parsed?.storageEpoch !== FRESH_START_EPOCH || parsed.state?.auth?.userId?.toLowerCase() !== id)
        throw new Error('Dữ liệu tài khoản chưa hợp lệ. Không tự động ghi đè.');
      record = await loadStoredUserData(port);
    } else {
      const owner = await base.getItem(OWNER_KEY);
      const matchingLegacy = identity(legacy.state.auth.identity) === identity(user.email)
        && (!legacy.state.auth.userId || accountId(legacy.state.auth.userId) === id);
      const adopt = matchingLegacy && (owner === null || owner === id);
      if (adopt && owner === null) await base.setItem(OWNER_KEY, id);
      // The original envelope remains a backup, even if an account write fails.
      record = adopt ? { ...legacy, state: JSON.parse(JSON.stringify(legacy.state)) }
        : { storageEpoch: FRESH_START_EPOCH, state: createInitialState(), pendingPhotoCleanup: [] };
    }
    record = { ...record, state: { ...record.state,
      auth: { loggedIn: true, identity: user.email, userId: id, remember: false },
      profile: { ...record.state.profile, name: user.username, email: user.email },
    } };
    await port.setItem(STORAGE_KEY, JSON.stringify(record));
    return { port, record };
  });
  locks.set(base, load);
  try { return await load; }
  finally { if (locks.get(base) === load) locks.delete(base); }
}
