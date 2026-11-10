/** Gọi API đồng bộ bản lưu, ảnh và hòm thư bằng phiên tài khoản PAT, không dùng mã truy cập AI chung; kiểm tra phản hồi và phiên bản dữ liệu. */
export interface CloudSnapshot { revision: number; state: unknown | null; updatedAt: string | null; appliedRevision?: number; replayed?: boolean }
export interface CloudAsset { assetId: string; contentType: string; dataBase64: string; size?: number }
export interface MailAction { requestId: string; revision: number; claimIds?: string[]; readIds?: string[]; deleteIds?: string[] }
export interface CloudSyncPort {
  getState(token: string): Promise<CloudSnapshot>;
  saveState(token: string, input: { revision: number; requestId: string; state: unknown }): Promise<CloudSnapshot>;
  uploadAsset(token: string, input: { contentType: string; dataBase64: string }): Promise<{ assetId: string }>;
  getAsset(token: string, id: string): Promise<CloudAsset>;
  mailAction(token: string, input: MailAction): Promise<CloudSnapshot>;
}
export class CloudSyncError extends Error {
  constructor(public code: string, message: string, public status?: number) { super(message); this.name = 'CloudSyncError'; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RESPONSE = 15 * 1024 * 1024;
const messages: Record<string, string> = {
  SYNC_CONFLICT: 'Dữ liệu đã thay đổi trên thiết bị khác. Bản lưu trên máy này vẫn được giữ lại.',
  AUTH_REQUIRED: 'Vui lòng đăng nhập lại để đồng bộ.', SESSION_EXPIRED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  MAIL_GIFT_UNCLAIMED: 'Nhận quà trước khi xóa thư.', RATE_LIMITED: 'Thao tác quá nhanh. Hãy thử lại sau.',
  ASSET_TOO_LARGE: 'Ảnh quá lớn để đồng bộ. Hãy dùng ảnh nhỏ hơn.', STATE_TOO_LARGE: 'Dữ liệu vượt giới hạn đồng bộ.',
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function validCloudSnapshot(value: unknown): CloudSnapshot {
  if (!object(value) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 ||
      !(value.state === null || object(value.state)) ||
      !(value.updatedAt === null || typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt))))
    throw new CloudSyncError('INVALID_RESPONSE', 'Dữ liệu đồng bộ từ máy chủ chưa hợp lệ.');
  if ((value.appliedRevision !== undefined && (!Number.isSafeInteger(value.appliedRevision) ||
      (value.appliedRevision as number) < 0 || (value.appliedRevision as number) > (value.revision as number))) ||
      (value.replayed !== undefined && typeof value.replayed !== 'boolean'))
    throw new CloudSyncError('INVALID_RESPONSE', 'Biên nhận đồng bộ chưa hợp lệ.');
  return { revision: value.revision as number, state: value.state, updatedAt: value.updatedAt as string | null,
    ...(typeof value.appliedRevision === 'number' ? { appliedRevision: value.appliedRevision } : {}),
    ...(typeof value.replayed === 'boolean' ? { replayed: value.replayed } : {}) };
}

export function createCloudSync(dependencies: { baseUrl: string; fetch?: typeof fetch; timeoutMs?: number }): CloudSyncPort {
  const send = dependencies.fetch ?? fetch;
  async function request(path: string, token: string, payload?: unknown, method = 'POST'): Promise<unknown> {
    let base: URL;
    try { base = new URL(dependencies.baseUrl); }
    catch { throw new CloudSyncError('NOT_CONFIGURED', 'Chưa cấu hình máy chủ đồng bộ.'); }
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/')
      throw new CloudSyncError('HTTPS_REQUIRED', 'Đồng bộ cần địa chỉ máy chủ HTTPS hợp lệ.');
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new CloudSyncError('AUTH_REQUIRED', messages.AUTH_REQUIRED);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => {
      controller.abort(); reject(new CloudSyncError('TIMEOUT', 'Đồng bộ quá lâu. Dữ liệu trên máy vẫn được giữ lại.'));
    }, dependencies.timeoutMs ?? 30_000); });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await send(`${base.origin}/api/${path}`, { method,
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}`,
            ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
          signal: controller.signal, redirect: 'error', credentials: 'omit' });
        const announced = Number(response.headers.get('content-length'));
        if (announced > MAX_RESPONSE) throw new CloudSyncError('INVALID_RESPONSE', 'Phản hồi đồng bộ quá lớn.');
        let raw = '';
        if (response.body?.getReader && typeof TextDecoder !== 'undefined') {
          const reader = response.body.getReader(); const decoder = new TextDecoder(); let size = 0;
          try { for (;;) { const part = await reader.read(); if (part.done) break;
            size += part.value.byteLength;
            if (size > MAX_RESPONSE) { void reader.cancel().catch(() => {}); throw new CloudSyncError('INVALID_RESPONSE', 'Phản hồi đồng bộ quá lớn.'); }
            raw += decoder.decode(part.value, { stream: true });
          } raw += decoder.decode(); } finally { reader.releaseLock(); }
        } else raw = await response.text();
        if (raw.length > MAX_RESPONSE) throw new CloudSyncError('INVALID_RESPONSE', 'Phản hồi đồng bộ quá lớn.');
        let body: unknown;
        try { body = JSON.parse(raw); } catch { throw new CloudSyncError('INVALID_RESPONSE', 'Phản hồi đồng bộ chưa hợp lệ.'); }
        if (!response.ok) {
          const code = object(body) && object(body.error) && typeof body.error.code === 'string' ? body.error.code : '';
          const known = Object.hasOwn(messages, code);
          throw new CloudSyncError(known ? code : response.status === 409 ? 'SYNC_CONFLICT' : 'SERVER_ERROR',
            known ? messages[code] : response.status === 409 ? messages.SYNC_CONFLICT : 'Chưa đồng bộ được. Dữ liệu trên máy vẫn được giữ lại.', response.status);
        }
        return body;
      })()]);
    } catch (cause) {
      if (cause instanceof CloudSyncError) throw cause;
      throw new CloudSyncError('NETWORK', 'Chưa kết nối được máy chủ. Dữ liệu trên máy đang chờ đồng bộ.');
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
  return {
    getState: async token => validCloudSnapshot(await request('sync/state', token, undefined, 'GET')),
    saveState: async (token, input) => validCloudSnapshot(await request('sync/state', token, input, 'PUT')),
    mailAction: async (token, input) => validCloudSnapshot(await request('mailbox/actions', token, input)),
    async uploadAsset(token, input) {
      const body = await request('sync/assets', token, input);
      if (!object(body) || typeof body.assetId !== 'string' || !UUID.test(body.assetId))
        throw new CloudSyncError('INVALID_RESPONSE', 'Máy chủ chưa xác nhận lưu ảnh.');
      return { assetId: body.assetId };
    },
    async getAsset(token, id) {
      if (!UUID.test(id)) throw new CloudSyncError('INVALID_ASSET', 'Mã ảnh chưa hợp lệ.');
      const body = await request(`sync/assets/${id}`, token, undefined, 'GET');
      if (!object(body) || body.assetId !== id || typeof body.contentType !== 'string' ||
          !['image/jpeg', 'image/png'].includes(body.contentType) || typeof body.dataBase64 !== 'string' ||
          body.dataBase64.length < 4 || body.dataBase64.length > 8_388_608 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.dataBase64))
        throw new CloudSyncError('INVALID_RESPONSE', 'Ảnh từ máy chủ chưa hợp lệ.');
      return { assetId: id, contentType: body.contentType, dataBase64: body.dataBase64,
        ...(typeof body.size === 'number' ? { size: body.size } : {}) };
    },
  };
}

export const cloudSync = createCloudSync({ baseUrl: process.env.EXPO_PUBLIC_PAT_API_URL?.trim() ?? '' });
