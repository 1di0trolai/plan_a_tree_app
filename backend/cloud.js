/** Kiểm tra bản lưu và ảnh đồng bộ, quản lý phiên bản chống ghi đè, xử lý thư/quà và bảo đảm yêu cầu thử lại không nhận quà trùng. */
import { createHash } from 'node:crypto';
import { ApiError } from './contracts.js';
import { isValidImageBytes } from './imageValidation.js';
import { creditPublisherAttachments, overlayPublisherMail, validateMailAttachments } from './mailbox.js';

export const MAX_CLOUD_STATE_BYTES = 10 * 1024 * 1024;
export const MAX_CLOUD_ASSET_BYTES = 6 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOP_KEYS = new Set(['version', 'profile', 'plants', 'checkIns', 'plantPhotos', 'plantAnalyses', 'plantChibis',
  'chatMessages', 'careEvents', 'dailyRounds', 'dailyPacks', 'economy', 'mailbox', 'activePlantId', 'inventory', 'settings', 'daily', 'battleNotify']);
const COLLECTIONS = ['plants', 'checkIns', 'plantPhotos', 'plantAnalyses', 'plantChibis', 'chatMessages', 'careEvents', 'dailyRounds', 'dailyPacks', 'mailbox'];
const SECRET_KEYS = /^(password|passwordhash|accesstoken|refreshtoken|token|session|apikey|smtp_pass|clientsecret|appsecret)$/i;
const invalid = message => { throw new ApiError(400, 'INVALID_REQUEST', message); };
const hash = value => createHash('sha256').update(value).digest('hex');
function identifier(value, label = 'Mã yêu cầu') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) invalid(`${label} không hợp lệ.`);
  return value;
}
function owner(user) {
  if (!user || !UUID.test(user.id)) throw new ApiError(401, 'AUTH_REQUIRED', 'Hãy đăng nhập để đồng bộ.');
  return user.id.toLowerCase();
}
function expectedRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) invalid('Phiên bản dữ liệu không hợp lệ.');
  return value;
}
function conflict(revision) {
  const error = new ApiError(409, 'SYNC_CONFLICT', 'Dữ liệu trên máy chủ đã thay đổi. Dữ liệu trên máy này vẫn được giữ lại.');
  error.revision = revision;
  error.details = { revision };
  throw error;
}
function boundedText(value, limit, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) invalid(`${label} không hợp lệ.`);
  return value.trim();
}
function scan(value, assets, depth = 0) {
  if (depth > 40) invalid('Dữ liệu lồng quá nhiều cấp.');
  if (typeof value === 'string') {
    if (value.startsWith('pat-asset:')) {
      const asset = value.slice(10);
      if (!UUID.test(asset)) invalid('Mã ảnh không hợp lệ.');
      assets.add(asset.toLowerCase());
    }
    return;
  }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) invalid('Dữ liệu số không hợp lệ.'); return; }
  if (Array.isArray(value)) {
    if (value.length > 30000) invalid('Danh sách dữ liệu quá dài.');
    for (const entry of value) scan(entry, assets, depth + 1);
    return;
  }
  if (!value || typeof value !== 'object') invalid('Dữ liệu không hợp lệ.');
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEYS.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) invalid('Không được lưu thông tin xác thực trong bản đồng bộ.');
    scan(entry, assets, depth + 1);
  }
}

export function validateCloudState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 5) invalid('Phiên bản dữ liệu chưa được hỗ trợ.');
  const state = Object.fromEntries(Object.entries(value).filter(([key]) => TOP_KEYS.has(key)));
  const object = entry => !!entry && typeof entry === 'object' && !Array.isArray(entry);
  if (!COLLECTIONS.every(key => Array.isArray(state[key])) || !object(state.economy) || !object(state.profile) || !object(state.settings)
    || !object(state.inventory) || !Array.isArray(state.inventory.pets) || !Array.isArray(state.inventory.items)
    || !object(state.daily) || typeof state.activePlantId !== 'string' || typeof state.battleNotify !== 'boolean') invalid('Bản đồng bộ thiếu dữ liệu.');
  if (!Number.isSafeInteger(state.economy.gold) || state.economy.gold < 0) invalid('Số dư vàng không hợp lệ.');
  const itemIds = new Set();
  for (const item of state.inventory.items) {
    if (!object(item) || typeof item.id !== 'string' || !item.id || item.id.length > 100 || itemIds.has(item.id)
      || !Number.isSafeInteger(item.quantity) || item.quantity < 0) invalid('Kho vật phẩm không hợp lệ.');
    itemIds.add(item.id);
  }
  const petIds = new Set();
  for (const pet of state.inventory.pets) {
    if (!object(pet) || typeof pet.id !== 'string' || !pet.id || pet.id.length > 150 || petIds.has(pet.id)
      || typeof pet.speciesId !== 'string' || !Number.isSafeInteger(pet.level) || pet.level < 1 || ![1, 2, 3].includes(pet.stars)
      || !Number.isSafeInteger(pet.experience) || pet.experience < 0) invalid('Kho thú nuôi không hợp lệ.');
    petIds.add(pet.id);
  }
  // Playback files and consent/permissions belong to this phone, not to another phone.
  state.settings = { ...state.settings, musicUri: null, musicName: null };
  state.mailbox = state.mailbox.filter(mail => mail?.source === 'system');
  const assets = new Set();
  scan(state, assets);
  for (const uri of [...state.plantPhotos.map(entry => entry?.imageUri), ...state.plantChibis.map(entry => entry?.imageUri), state.profile.avatarImageUri]) {
    if (uri !== null && uri !== undefined && (typeof uri !== 'string' || !uri.startsWith('pat-asset:'))) invalid('Ảnh phải được tải lên trước khi đồng bộ.');
  }
  const serialized = JSON.stringify(state);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_CLOUD_STATE_BYTES) throw new ApiError(413, 'SYNC_TOO_LARGE', 'Dữ liệu đồng bộ vượt 10 MB.');
  return { state: JSON.parse(serialized), assets: [...assets] };
}

export function validateCloudAsset(value) {
  const mimeType = value?.contentType, base64 = value?.dataBase64;
  if (!['image/png', 'image/jpeg'].includes(mimeType) || typeof base64 !== 'string') invalid('Chỉ hỗ trợ ảnh JPEG hoặc PNG.');
  if (base64.length > Math.ceil(MAX_CLOUD_ASSET_BYTES / 3) * 4) throw new ApiError(413, 'ASSET_TOO_LARGE', 'Mỗi ảnh tối đa 6 MB.');
  // Avoid a repeated-group regular expression over multi-megabyte data (stack exhaustion).
  if (!base64.length || base64.length % 4 || /[^A-Za-z0-9+/=]/.test(base64) || !/^[^=]*={0,2}$/.test(base64)) invalid('Ảnh base64 không hợp lệ.');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.toString('base64') !== base64 || !isValidImageBytes(bytes, mimeType, { boundPngOutputToDimensions: false })) invalid('Nội dung ảnh không hợp lệ.');
  return { mimeType, bytes, sha256: hash(bytes), size: bytes.length };
}
function envelope(record) {
  return { revision: record.revision, state: overlayPublisherMail(record.state, record.mailbox),
    updatedAt: record.updatedAt ?? null, mailbox: record.mailbox.filter(mail => !mail.deletedAt).map(({ deletedAt: _deleted, ...mail }) => mail) };
}

/** The caller MUST pass a user returned by auth.me(), never an ID from a request body. */
export function createCloudService({ repository, now = () => new Date() }) {
  return {
    async getState(user) { return envelope(await repository.read(owner(user))); },
    async saveState(user, body) {
      const userId = owner(user), revision = expectedRevision(body?.revision), requestId = identifier(body?.requestId);
      const { state, assets } = validateCloudState(body?.state);
      return repository.mutate(userId, { operation: 'save', requestId, digest: hash(JSON.stringify({ revision, state })) }, async record => {
        if (record.revision !== revision) conflict(record.revision);
        await repository.assertAssets(userId, assets);
        const updated = { ...record, revision: revision + 1, state, updatedAt: now().toISOString() };
        return { record: updated, response: envelope(updated) };
      });
    },
    async uploadAsset(user, body) {
      const asset = await repository.putAsset(owner(user), validateCloudAsset(body));
      return { assetId: asset.id.toLowerCase(), contentType: asset.mimeType, sha256: asset.sha256, size: asset.size };
    },
    async getAsset(user, id) {
      if (!UUID.test(id)) throw new ApiError(404, 'ASSET_NOT_FOUND', 'Không tìm thấy ảnh.');
      const asset = await repository.getAsset(owner(user), id);
      if (!asset) throw new ApiError(404, 'ASSET_NOT_FOUND', 'Không tìm thấy ảnh.');
      const base64 = asset.bytes.toString('base64');
      return { assetId: asset.id.toLowerCase(), contentType: asset.mimeType, sha256: asset.sha256, size: asset.size, dataBase64: base64 };
    },
    async listMail(user) { return { mailbox: envelope(await repository.read(owner(user))).mailbox }; },
    async updateMail(user, body) {
      const userId = owner(user), revision = expectedRevision(body?.revision), requestId = identifier(body?.requestId);
      const actions = {};
      for (const key of ['readIds', 'deleteIds', 'claimIds']) {
        const ids = body[key] ?? [];
        if (!Array.isArray(ids) || ids.length > 500 || ids.some(id => typeof id !== 'string' || !UUID.test(id))) invalid('Danh sách thư không hợp lệ.');
        actions[key] = [...new Set(ids.map(id => id.toLowerCase()))];
      }
      return repository.mutate(userId, { operation: 'mail', requestId, digest: hash(JSON.stringify({ revision, ...actions })) }, record => {
        if (record.revision !== revision) conflict(record.revision);
        if (!record.state) throw new ApiError(409, 'SYNC_REQUIRED', 'Hãy đồng bộ dữ liệu trước.');
        const byId = new Map(record.mailbox.filter(mail => !mail.deletedAt).map(mail => [mail.id.toLowerCase(), mail]));
        for (const id of [...actions.readIds, ...actions.deleteIds, ...actions.claimIds]) if (!byId.has(id)) throw new ApiError(404, 'MAIL_NOT_FOUND', 'Không tìm thấy thư.');
        const timestamp = now().toISOString();
        const claimed = actions.claimIds.map(id => byId.get(id)).filter(mail => mail.attachments.length && !mail.claimedAt);
        const state = creditPublisherAttachments(record.state, claimed);
        const claimSet = new Set(actions.claimIds), readSet = new Set([...actions.readIds, ...actions.claimIds]), deleteSet = new Set(actions.deleteIds);
        const mailbox = record.mailbox.map(mail => {
          const id = mail.id.toLowerCase();
          const updated = { ...mail, ...(readSet.has(id) ? { readAt: mail.readAt ?? timestamp } : {}),
            ...(claimSet.has(id) && mail.attachments.length ? { claimedAt: mail.claimedAt ?? timestamp } : {}) };
          if (deleteSet.has(id)) {
            if (updated.attachments.length && !updated.claimedAt) throw new ApiError(409, 'MAIL_UNCLAIMED', 'Nhận quà trước khi xóa thư.');
            updated.deletedAt = timestamp;
          }
          return updated;
        });
        const updated = { ...record, revision: revision + 1, state, mailbox, updatedAt: timestamp };
        return { record: updated, response: envelope(updated) };
      });
    },
    async listUsers({ search = '', limit = 100 } = {}) {
      if (typeof search !== 'string' || search.length > 100 || !Number.isInteger(limit) || limit < 1 || limit > 200) invalid('Bộ lọc người dùng không hợp lệ.');
      return { users: await repository.listUsers({ search: search.trim(), limit }), nextCursor: null };
    },
    async publishMail(admin, body) {
      const requestId = identifier(body?.requestId);
      if (!UUID.test(admin?.id)) invalid('Tài khoản quản trị không hợp lệ.');
      const title = boundedText(body.title, 160, 'Tiêu đề'), message = boundedText(body.body, 4000, 'Nội dung');
      const attachments = validateMailAttachments(body.attachments);
      if (!['all', 'users'].includes(body.target)) invalid('Người nhận không hợp lệ.');
      const userIds = body.target === 'all' ? [] : body.userIds;
      if (!Array.isArray(userIds) || (body.target === 'users' && !userIds.length) || userIds.length > 1000 || userIds.some(id => !UUID.test(id))) invalid('Danh sách người nhận không hợp lệ.');
      const values = { adminId: admin.id, requestId, title, body: message, attachments, target: body.target,
        userIds: [...new Set(userIds.map(id => id.toLowerCase()))], createdAt: now().toISOString() };
      return repository.publish({ ...values, digest: hash(JSON.stringify({ ...values, createdAt: undefined })) });
    },
    async listPublications({ limit = 50 } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) invalid('Giới hạn không hợp lệ.');
      return { publications: await repository.listPublications({ limit }) };
    },
  };
}
