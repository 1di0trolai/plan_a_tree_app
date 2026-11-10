/** Tạo máy chủ HTTP cho AI, tài khoản, đồng bộ và hòm thư; kiểm tra quyền, dữ liệu đầu vào, hạn mức và chuẩn hóa phản hồi lỗi. */
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { ApiError, MAX_BODY_BYTES, validateRequest, validateResult } from './contracts.js';
import { sessionToken } from './auth.js';
import { requestLocale } from './locale.js';

function authorized(header, token) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const provided = Buffer.from(header.slice(7)), expected = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
async function readJson(req, limit) {
  if (!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type'] ?? '')) throw new ApiError(415, 'JSON_REQUIRED', 'Chỉ nhận application/json.');
  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > limit) throw new ApiError(413, 'BODY_TOO_LARGE', 'Yêu cầu lớn hơn giới hạn 12 MB.');
  const raw = await new Promise((resolve, reject) => {
    let bytes = 0, settled = false;
    const chunks = [];
    req.on('data', chunk => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > limit) {
        settled = true;
        // Drain rather than destroy the socket, so chunked uploads receive 413 too.
        reject(new ApiError(413, 'BODY_TOO_LARGE', 'Yêu cầu lớn hơn giới hạn 12 MB.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks).toString('utf8')); } });
    req.on('error', () => { if (!settled) { settled = true; reject(new ApiError(400, 'INVALID_REQUEST', 'Không đọc được yêu cầu.')); } });
    req.on('aborted', () => { if (!settled) { settled = true; reject(new ApiError(499, 'REQUEST_CANCELLED', 'Yêu cầu đã được hủy.')); } });
  });
  try { return JSON.parse(raw); }
  catch { throw new ApiError(400, 'INVALID_JSON', 'JSON không hợp lệ.'); }
}
function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}

// Account routes use revocable SQL-backed sessions, not the shared AI-proxy token.
// HTTPS is required outside a trusted local development network.
export function createApp({ provider, token, runtime, auth, cloud, adminHandler, maxBodyBytes = MAX_BODY_BYTES, requestsPerMinute = 20, maxConcurrent = 2, authRequestsPerMinute = 30, maxAuthConcurrent = 2, syncRequestsPerMinute = 300, maxSyncConcurrent = 6 }) {
  const rate = new Map();
  const authRate = new Map();
  const syncRate = new Map();
  let active = 0;
  let authActive = 0;
  let syncActive = 0;
  return createServer(async (req, res) => {
    let counted = false;
    let authCounted = false;
    let syncCounted = false;
    const controller = new AbortController();
    const abortRequest = () => controller.abort();
    const abortDisconnectedResponse = () => { if (!res.writableEnded) controller.abort(); };
    req.once('aborted', abortRequest);
    res.once('close', abortDisconnectedResponse);
    try {
      if (adminHandler && await adminHandler(req, res)) return;
      const syncRoute = /^\/api\/(sync\/state|sync\/assets(?:\/([0-9a-f-]{36}))?|mailbox(?:\/actions)?)$/.exec(req.url ?? '');
      if (syncRoute) {
        if (!auth || !cloud) throw new ApiError(503, 'SYNC_UNAVAILABLE', 'Máy chủ chưa sẵn sàng đồng bộ dữ liệu.');
        const operation = syncRoute[1];
        const method = operation === 'sync/state' ? ['GET', 'PUT']
          : operation === 'sync/assets' || operation === 'mailbox/actions' ? ['POST'] : ['GET'];
        if (!method.includes(req.method)) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy API.');
        if (syncActive >= maxSyncConcurrent) throw new ApiError(429, 'SYNC_BUSY', 'Đồng bộ đang bận. Dữ liệu trên máy vẫn được giữ lại.');
        syncActive++; syncCounted = true;
        // Only an active PAT session determines ownership; never a submitted userId.
        const { user } = await auth.me(sessionToken(req.headers.authorization));
        const now = Date.now();
        for (const [key, entry] of syncRate) if (entry.until <= now) syncRate.delete(key);
        const entry = syncRate.get(user.id) ?? { count: 0, until: now + 60000 };
        syncRate.set(user.id, entry);
        if (++entry.count > syncRequestsPerMinute || syncRate.size > 10000)
          throw new ApiError(429, 'SYNC_BUSY', 'Bạn đang đồng bộ quá nhanh. Hãy thử lại sau một phút.');
        const body = ['POST', 'PUT'].includes(req.method)
          ? await readJson(req, operation === 'mailbox/actions' ? 65536 : maxBodyBytes) : undefined;
        controller.signal.throwIfAborted();
        let result;
        if (operation === 'sync/state') result = req.method === 'GET' ? await cloud.getState(user) : await cloud.saveState(user, body);
        else if (operation === 'sync/assets') result = await cloud.uploadAsset(user, body);
        else if (operation.startsWith('sync/assets/')) result = await cloud.getAsset(user, syncRoute[2]);
        else if (operation === 'mailbox') result = await cloud.listMail(user);
        else result = await cloud.updateMail(user, body);
        if (!controller.signal.aborted && !res.destroyed) send(res, 200, result);
        return;
      }
      const authRoute = /^\/api\/auth\/(register|login|me|profile|password|logout|forgot-password|reset-password|social\/(?:providers|challenge|login|link))$/.exec(req.url ?? '');
      if (authRoute) {
        const operation = authRoute[1];
        const method = ['me', 'social/providers'].includes(operation) ? 'GET' : operation === 'profile' ? 'PATCH' : 'POST';
        if (req.method !== method) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy API.');
        if (!auth) throw new ApiError(503, 'AUTH_UNAVAILABLE', 'Chưa kết nối được dịch vụ tài khoản. Kiểm tra máy chủ và cơ sở dữ liệu rồi thử lại.');
        const now = Date.now(), address = req.socket.remoteAddress;
        for (const [key, entry] of authRate) if (entry.until <= now) authRate.delete(key);
        const entry = authRate.get(address) ?? { count: 0, until: now + 60000 };
        authRate.set(address, entry);
        if (++entry.count > authRequestsPerMinute || authActive >= maxAuthConcurrent || authRate.size > 10000)
          throw new ApiError(429, 'AUTH_RATE_LIMITED', 'Có quá nhiều yêu cầu tài khoản. Vui lòng thử lại sau một phút.');
        authActive++; authCounted = true;
        const body = ['register', 'login', 'profile', 'password', 'forgot-password', 'reset-password', 'social/challenge', 'social/login', 'social/link'].includes(operation) ? await readJson(req, Math.min(maxBodyBytes, 16384)) : undefined;
        const requiresSession = ['me', 'profile', 'password', 'logout', 'social/link'].includes(operation)
          || (operation === 'social/challenge' && body?.purpose === 'link');
        const bearer = requiresSession ? sessionToken(req.headers.authorization) : undefined;
        controller.signal.throwIfAborted();
        let result;
        if (operation === 'register') result = await auth.register(body);
        else if (operation === 'login') result = await auth.login(body);
        else if (operation === 'me') result = await auth.me(bearer);
        else if (operation === 'profile') result = await auth.updateProfile(bearer, body);
        else if (operation === 'password') result = await auth.changePassword(bearer, body);
        else if (operation === 'forgot-password') result = await auth.forgotPassword(body, { locale: requestLocale(req.headers['accept-language']) });
        else if (operation === 'reset-password') result = await auth.resetPassword(body);
        else if (operation === 'social/providers') result = await auth.socialProviders();
        else if (operation === 'social/challenge') result = await auth.socialChallenge(body, bearer);
        else if (operation === 'social/login') result = await auth.socialLogin(body);
        else if (operation === 'social/link') result = await auth.socialLink(bearer, body);
        else result = await auth.logout(bearer);
        if (!controller.signal.aborted && !res.destroyed) send(res, operation === 'register' ? 201 : 200, result);
        return;
      }
      if (req.method === 'GET' && ['/health', '/api/health'].includes(req.url)) {
        send(res, 200, { status: 'ok', provider: 'gemini', configured: Boolean(provider && token), authRequired: true });
        return;
      }
      if (req.method === 'GET' && req.url === '/api/runtime') {
        if (!token) throw new ApiError(503, 'AI_NOT_CONFIGURED', 'Chưa cấu hình token backend.');
        if (!authorized(req.headers.authorization, token)) throw new ApiError(401, 'UNAUTHORIZED', 'Thiếu hoặc sai Bearer token thử nghiệm.');
        if (!runtime) throw new ApiError(503, 'RUNTIME_UNAVAILABLE', 'Chưa có thông tin tiến trình backend.');
        send(res, 200, { provider: 'gemini', model: runtime.model, timeoutMs: runtime.timeoutMs, revision: runtime.revision });
        return;
      }
      const route = /^\/api\/(identify|recognize|analyze|chat)$/.exec(req.url ?? '');
      if (!route || req.method !== 'POST') throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy API.');
      if (!token || !provider) throw new ApiError(503, 'AI_NOT_CONFIGURED', 'Chưa cấu hình GEMINI_API_KEY, GEMINI_MODEL và API_AUTH_TOKEN trên máy chủ.');
      if (!authorized(req.headers.authorization, token)) throw new ApiError(401, 'UNAUTHORIZED', 'Thiếu hoặc sai Bearer token thử nghiệm.');
      const now = Date.now(), address = req.socket.remoteAddress;
      for (const [key, entry] of rate) if (entry.until <= now) rate.delete(key);
      const entry = rate.get(address) ?? { count: 0, until: now + 60000 };
      if (++entry.count > requestsPerMinute || active >= maxConcurrent) throw new ApiError(429, 'RATE_LIMITED', 'Quá nhiều yêu cầu. Hãy thử lại sau.');
      rate.set(address, entry);
      active++; counted = true;
      const kind = route[1];
      const request = validateRequest(kind, await readJson(req, maxBodyBytes));
      controller.signal.throwIfAborted();
      const started = Date.now();
      const result = validateResult(kind, await provider(kind, request, { signal: controller.signal, locale: requestLocale(req.headers['accept-language']) }), request);
      if (controller.signal.aborted || res.destroyed) return;
      res.setHeader('server-timing', `ai;dur=${Date.now() - started}`);
      send(res, 200, { mode: 'gemini', result });
    } catch (error) {
      if (res.destroyed) return;
      const safe = error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR', 'Không xử lý được yêu cầu.');
      const revision = safe.code === 'SYNC_CONFLICT' && Number.isSafeInteger(safe.revision) && safe.revision >= 0
        ? { revision: safe.revision } : {};
      send(res, safe.status, { error: { code: safe.code, message: safe.message, ...revision } });
      // Do not log request bodies, inline images, chat, API key or bearer token.
    } finally {
      req.removeListener('aborted', abortRequest);
      res.removeListener('close', abortDisconnectedResponse);
      if (counted) active--;
      if (authCounted) authActive--;
      if (syncCounted) syncActive--;
    }
  });
}
