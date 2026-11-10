/** Phục vụ giao diện quản trị và các tuyến API quản trị; giới hạn tài nguyên tĩnh, kiểm tra nguồn truy cập, cookie phiên và CSRF. */
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { ApiError } from './contracts.js';
import { adminCsrfToken } from './adminAuth.js';

const assets = new Map([
  ['/admin', [new URL('./admin-web/index.html', import.meta.url), 'text/html; charset=utf-8']],
  ['/admin/', [new URL('./admin-web/index.html', import.meta.url), 'text/html; charset=utf-8']],
  ['/admin/admin.css', [new URL('./admin-web/admin.css', import.meta.url), 'text/css; charset=utf-8']],
  ['/admin/admin.js', [new URL('./admin-web/admin.js', import.meta.url), 'text/javascript; charset=utf-8']],
  // Reuse the shipped artwork without exposing either asset directory as a route.
  ['/admin/assets/pat-logo.png', [new URL('../mobile/assets/logo/pat-logo.png', import.meta.url), 'image/png']],
  ['/admin/assets/gold-coin.png', [new URL('../mobile/assets/money/gold-coin.png', import.meta.url), 'image/png']],
  ['/admin/assets/berry-bites.png', [new URL('../mobile/assets/food/berry-bites.png', import.meta.url), 'image/png']],
  ['/admin/assets/rice-bowl.png', [new URL('../mobile/assets/food/rice-bowl.png', import.meta.url), 'image/png']],
  ['/admin/assets/honey-cake.png', [new URL('../mobile/assets/food/honey-cake.png', import.meta.url), 'image/png']],
  ['/admin/assets/forest-milk.png', [new URL('../mobile/assets/food/forest-milk.png', import.meta.url), 'image/png']],
  ['/admin/assets/ramen-bowl.png', [new URL('../mobile/assets/food/ramen-bowl.png', import.meta.url), 'image/png']],
  ['/admin/assets/star-snack.png', [new URL('../mobile/assets/food/star-snack.png', import.meta.url), 'image/png']],
]);
const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
const csrfEqual = (provided, token) => {
  if (typeof provided !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(provided)) return false;
  const expected = Buffer.from(adminCsrfToken(token)), actual = Buffer.from(provided);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};
function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
async function json(req) {
  if (!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type'] ?? ''))
    throw new ApiError(415, 'ADMIN_JSON_REQUIRED', 'Yêu cầu cần dùng application/json.');
  const max = 32768;
  if (Number(req.headers['content-length']) > max) throw new ApiError(413, 'ADMIN_BODY_TOO_LARGE', 'Nội dung quá dài.');
  // Keep draining oversized bodies so the client receives the 413 response.
  const raw = await new Promise((resolve, reject) => {
    const chunks = []; let size = 0, settled = false;
    req.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > max) { settled = true; reject(new ApiError(413, 'ADMIN_BODY_TOO_LARGE', 'Nội dung quá dài.')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks).toString('utf8')); } });
    req.on('error', () => { if (!settled) { settled = true; reject(new ApiError(400, 'ADMIN_JSON_INVALID', 'Không đọc được nội dung.')); } });
    req.on('aborted', () => { if (!settled) { settled = true; reject(new ApiError(400, 'ADMIN_JSON_INVALID', 'Yêu cầu đã bị hủy.')); } });
  });
  let body;
  try { body = JSON.parse(raw); }
  catch { throw new ApiError(400, 'ADMIN_JSON_INVALID', 'Nội dung không hợp lệ.'); }
  if (!body || Array.isArray(body) || typeof body !== 'object') throw new ApiError(400, 'ADMIN_JSON_INVALID', 'Nội dung không hợp lệ.');
  return body;
}
function cookies(req, name) {
  const matches = (req.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  if (matches.length !== 1) return undefined;
  const token = matches[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
}

/** Call before player/API routing. Returns false when this is not an admin URL. */
export function createAdminHandler({ service, origins = [], allowLocalHttp = true }) {
  const trusted = origins.map(value => {
    const parsed = new URL(value);
    if (parsed.origin !== value || parsed.username || parsed.password || !['https:', 'http:'].includes(parsed.protocol)) throw new TypeError('Admin origins must be exact HTTP(S) origins.');
    if (parsed.protocol === 'http:' && (!allowLocalHttp || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) throw new TypeError('Admin HTTP is allowed only on loopback.');
    return parsed;
  });
  const rate = new Map();
  let active = 0;
  return async (req, res) => {
    let parsed;
    try { parsed = new URL(req.url ?? '/', 'http://admin.invalid'); } catch { return false; }
    if (!(parsed.pathname === '/admin' || parsed.pathname.startsWith('/admin/') || parsed.pathname === '/api/admin' || parsed.pathname.startsWith('/api/admin/'))) return false;
    let counted = false;
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
    try {
      const origin = trusted.find(value => value.host.toLowerCase() === String(req.headers.host ?? '').toLowerCase()
        && (value.protocol === 'https:' || loopback(req.socket.remoteAddress)));
      if (!origin || (origin.protocol === 'https:' && !req.socket.encrypted && !loopback(req.socket.remoteAddress)))
        throw new ApiError(403, 'ADMIN_HOST_DENIED', 'Trang quản trị chỉ dùng qua địa chỉ riêng đã cấu hình.');
      if (origin.protocol === 'https:') res.setHeader('strict-transport-security', 'max-age=31536000');
      if (parsed.search && !parsed.pathname.startsWith('/api/admin/users')) throw new ApiError(404, 'ADMIN_NOT_FOUND', 'Không tìm thấy trang.');
      const asset = assets.get(parsed.pathname);
      if (asset && req.method === 'GET') {
        const content = await readFile(asset[0]);
        res.writeHead(200, { 'content-type': asset[1] }); res.end(content); return true;
      }
      if (!service) throw new ApiError(503, 'ADMIN_UNAVAILABLE', 'Chưa kết nối dịch vụ quản trị.');
      const time = Date.now();
      for (const [key, entry] of rate) if (entry.until <= time) rate.delete(key);
      const address = req.socket.remoteAddress ?? 'unknown';
      const entry = rate.get(address) ?? { count: 0, until: time + 60000 };
      rate.set(address, entry);
      if (++entry.count > 90 || rate.size > 5000 || active >= 8) throw new ApiError(429, 'ADMIN_RATE_LIMITED', 'Quá nhiều yêu cầu. Hãy thử lại sau một phút.');
      active++; counted = true;
      const name = origin.protocol === 'https:' ? '__Host-pat_admin' : 'pat_admin_local';
      const token = cookies(req, name);
      const mutating = req.method !== 'GET';
      if (mutating && (req.headers.origin !== origin.origin || req.headers['sec-fetch-site'] === 'cross-site'))
        throw new ApiError(403, 'ADMIN_ORIGIN_DENIED', 'Yêu cầu không đến từ trang quản trị.');
      const setCookie = (value, maxAge) => res.setHeader('set-cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${origin.protocol === 'https:' ? '; Secure' : ''}`);
      if (parsed.pathname === '/api/admin/login' && req.method === 'POST') {
        const result = await service.login(await json(req), address);
        setCookie(result.token, Math.max(0, Math.floor((Date.parse(result.expiresAt) - Date.now()) / 1000)));
        const { token: secret, ...safe } = result; void secret;
        send(res, 200, safe); return true;
      }
      if (!token) throw new ApiError(401, 'ADMIN_AUTH_REQUIRED', 'Hãy đăng nhập tài khoản quản trị.');
      if (mutating && !csrfEqual(req.headers['x-csrf-token'], token)) throw new ApiError(403, 'ADMIN_CSRF_INVALID', 'Phiên trang đã thay đổi. Tải lại trang rồi thử lại.');
      if (parsed.pathname === '/api/admin/me' && req.method === 'GET') send(res, 200, await service.me(token));
      else if (parsed.pathname === '/api/admin/logout' && req.method === 'POST') { await service.logout(token); setCookie('', 0); send(res, 200, { ok: true }); }
      else if (parsed.pathname === '/api/admin/password' && req.method === 'POST') { const result = await service.changePassword(token, await json(req)); setCookie('', 0); send(res, 200, result); }
      else if (parsed.pathname === '/api/admin/users' && req.method === 'GET') send(res, 200, await service.listUsers(token, { search: parsed.searchParams.get('search') ?? '', cursor: parsed.searchParams.get('cursor') ?? undefined, limit: 100 }));
      else if (parsed.pathname === '/api/admin/publications' && req.method === 'GET') send(res, 200, await service.history(token));
      else if (parsed.pathname === '/api/admin/publications' && req.method === 'POST') send(res, 201, await service.publish(token, await json(req)));
      else throw new ApiError(404, 'ADMIN_NOT_FOUND', 'Không tìm thấy trang.');
    } catch (cause) {
      if (res.destroyed || res.writableEnded) return true;
      const error = cause instanceof ApiError ? cause : new ApiError(503, 'ADMIN_UNAVAILABLE', 'Chưa kết nối được dịch vụ quản trị. Kiểm tra máy chủ và SQL rồi thử lại.');
      send(res, error.status, { error: { code: error.code, message: error.message } });
    } finally { if (counted) active--; }
    return true;
  };
}
