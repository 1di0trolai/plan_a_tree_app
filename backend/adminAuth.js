/** Quản lý xác thực quản trị: băm mật khẩu, phiên đăng nhập, chống thử mật khẩu liên tục và kiểm tra quyền gửi thư/quà. */
import { createHash, randomBytes, scrypt as callbackScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { ApiError } from './contracts.js';

const scrypt = promisify(callbackScrypt);
const SCRYPT = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
export const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
export const adminTokenHash = token => createHash('sha256').update(token).digest();
export const adminCsrfToken = token => createHash('sha256').update(`PAT-admin-csrf:${token}`).digest('base64url');

function validToken(token) { return typeof token === 'string' && tokenPattern.test(token); }
export function validateAdminUsername(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(value))
    throw new ApiError(400, 'ADMIN_NAME_INVALID', 'Tên quản trị gồm 3–80 chữ cái, chữ số, dấu chấm, gạch dưới hoặc gạch ngang.');
  return value;
}
export function validateAdminPassword(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value))
    throw new ApiError(400, 'ADMIN_PASSWORD_INVALID', 'Mật khẩu quản trị cần từ 12 đến 128 ký tự.');
  return value;
}
export async function hashAdminPassword(password) {
  validateAdminPassword(password);
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$32768$8$3$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
export async function verifyAdminPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 128 || typeof encoded !== 'string') return false;
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts.slice(0, 4).join('$') !== 'scrypt$32768$8$3') return false;
  const salt = Buffer.from(parts[4], 'base64url'), expected = Buffer.from(parts[5], 'base64url');
  if (salt.length !== 16 || expected.length !== 64) return false;
  const actual = await scrypt(password, salt, 64, SCRYPT);
  return timingSafeEqual(actual, expected);
}

/** SQL stores only hashes of session tokens; admin identities never share player auth. */
export function createAdminService({ repository, cloud, now = Date.now, sessionMs = ADMIN_SESSION_MS }) {
  if (!repository) throw new TypeError('Admin repository is required.');
  let dummyPasswordHash;
  const attempts = new Map();
  let activeLogins = 0;
  const publicAdmin = account => ({ id: account.id, username: account.username });
  const unauthorized = () => new ApiError(401, 'ADMIN_AUTH_REQUIRED', 'Hãy đăng nhập tài khoản quản trị.');
  async function session(token) {
    if (!validToken(token)) throw unauthorized();
    const found = await repository.getSession(adminTokenHash(token));
    if (!found || new Date(found.expiresAt).getTime() <= now()) throw unauthorized();
    return found;
  }
  function loginLimit(address, username) {
    const time = now();
    for (const [key, entry] of attempts) if (entry.until <= time) attempts.delete(key);
    const keys = [`address:${address}`, `name:${username.toUpperCase()}`];
    if (attempts.size > 5000 || activeLogins >= 2 || keys.some(key => (attempts.get(key)?.count ?? 0) >= 8))
      throw new ApiError(429, 'ADMIN_RATE_LIMITED', 'Đăng nhập quá nhiều lần. Hãy chờ 15 phút rồi thử lại.');
    for (const key of keys) {
      const entry = attempts.get(key) ?? { count: 0, until: time + 15 * 60 * 1000 };
      entry.count++; attempts.set(key, entry);
    }
  }
  return {
    async login(body, address = 'unknown') {
      const username = validateAdminUsername(body?.username);
      if (typeof body?.password !== 'string' || body.password.length < 1 || body.password.length > 128)
        throw new ApiError(400, 'ADMIN_LOGIN_INVALID', 'Nhập tên và mật khẩu quản trị.');
      loginLimit(address, username);
      activeLogins++;
      try {
        const account = await repository.findAccount(username.toUpperCase());
        dummyPasswordHash ??= hashAdminPassword(randomBytes(24).toString('base64url'));
        const valid = await verifyAdminPassword(body.password, account?.passwordHash ?? await dummyPasswordHash);
        if (!account?.active || !valid) throw new ApiError(401, 'ADMIN_LOGIN_FAILED', 'Tên hoặc mật khẩu quản trị không đúng.');
        const token = randomBytes(32).toString('base64url');
        const expiresAt = new Date(now() + sessionMs);
        const created = await repository.createSession({ adminId: account.id, expectedHash: account.passwordHash, tokenHash: adminTokenHash(token), expiresAt });
        if (!created) throw new ApiError(401, 'ADMIN_LOGIN_FAILED', 'Tên hoặc mật khẩu quản trị không đúng.');
        attempts.delete(`name:${username.toUpperCase()}`);
        return { admin: publicAdmin(account), token, csrfToken: adminCsrfToken(token), expiresAt: expiresAt.toISOString() };
      } finally { activeLogins--; }
    },
    async me(token) {
      const found = await session(token);
      return { admin: publicAdmin(found), csrfToken: adminCsrfToken(token), expiresAt: new Date(found.expiresAt).toISOString() };
    },
    async logout(token) { const found = await session(token); await repository.revokeSession(adminTokenHash(token), found.id); return { ok: true }; },
    async changePassword(token, body) {
      const found = await session(token);
      const password = validateAdminPassword(body?.newPassword);
      const current = await repository.findAccount(found.username.toUpperCase());
      if (!current || !await verifyAdminPassword(body?.currentPassword, current.passwordHash))
        throw new ApiError(400, 'ADMIN_PASSWORD_WRONG', 'Mật khẩu hiện tại không đúng.');
      const changed = await repository.changePassword({ adminId: found.id, tokenHash: adminTokenHash(token), expectedHash: current.passwordHash, passwordHash: await hashAdminPassword(password) });
      if (!changed) throw unauthorized();
      return { ok: true, signedOut: true };
    },
    async listUsers(token, filters) { await session(token); return cloud.listUsers(filters); },
    async publish(token, body) {
      const found = await session(token);
      // The cloud service revalidates payloads and writes recipients + audit atomically.
      return cloud.publishMail(publicAdmin(found), body);
    },
    async history(token) { await session(token); return cloud.listPublications({ limit: 50 }); },
  };
}
