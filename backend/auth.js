/** Xử lý đăng ký, đăng nhập, hồ sơ, đổi/khôi phục mật khẩu và liên kết Google/Facebook; phát hành và thu hồi phiên tài khoản PAT. */
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { ApiError } from './contracts.js';
import { normalizeLocale } from './locale.js';

const deriveKey = promisify(scrypt);
const SCRYPT = Object.freeze({ N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 });
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const PASSWORD_MIN_LENGTH = 8;

function invalid(code, message) { throw new ApiError(400, code, message); }
function input(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('INVALID_REQUEST', 'Thông tin tài khoản không hợp lệ.');
  return body;
}
function email(value) {
  if (typeof value !== 'string' || value.trim().length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))
    invalid('INVALID_EMAIL', 'Nhập email đăng nhập hợp lệ.');
  return value.trim().toLowerCase();
}
function username(value) {
  if (typeof value !== 'string' || [...value.trim()].length < 2 || [...value.trim()].length > 40 || /[\u0000-\u001f\u007f]/.test(value))
    invalid('INVALID_USERNAME', 'Tên người dùng cần từ 2 đến 40 ký tự.');
  return value.trim();
}
function password(value, fresh = true) {
  if (typeof value !== 'string' || [...value].length < (fresh ? PASSWORD_MIN_LENGTH : 1) || [...value].length > 128
    || (fresh && /[^A-Za-z0-9]/.test(value)))
    invalid('INVALID_PASSWORD', fresh ? 'Mật khẩu cần từ 8 đến 128 ký tự và chỉ gồm A–Z, a–z, 0–9.' : 'Nhập mật khẩu của bạn.');
  return value; // Never trim/normalize: legacy credentials must remain exact.
}
function remembered(value) {
  if (value !== undefined && typeof value !== 'boolean') invalid('INVALID_REQUEST', 'Lựa chọn ghi nhớ không hợp lệ.');
  return value === true;
}
export function sessionToken(header) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ') || !TOKEN_PATTERN.test(header.slice(7)))
    throw new ApiError(401, 'AUTH_REQUIRED', 'Vui lòng đăng nhập lại.');
  return header.slice(7);
}
export const hashSessionToken = token => createHash('sha256').update(token).digest();

export async function hashPassword(value) {
  const salt = randomBytes(16);
  const key = await deriveKey(value, salt, 64, SCRYPT);
  return `scrypt$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
export async function verifyPassword(value, encoded) {
  // Strict version/length checking avoids attacker-controlled work factors or allocations.
  const parts = typeof encoded === 'string' ? encoded.split('$') : [];
  if (parts.length !== 4 || parts[0] !== 'scrypt' || parts[1] !== '1' || !/^[A-Za-z0-9_-]{22}$/.test(parts[2]) || !/^[A-Za-z0-9_-]{86}$/.test(parts[3])) return false;
  const expected = Buffer.from(parts[3], 'base64url');
  const key = await deriveKey(value, Buffer.from(parts[2], 'base64url'), expected.length, SCRYPT);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Repository persists only password/session hashes. No password or token logging. */
export function createAuthService({ repository, now = () => new Date(), hash = hashPassword, verify = verifyPassword, resetMailer, socialVerifier, onDiagnostic = () => {} }) {
  let dummyHash;
  const resetRequests = new Map(), resetJobs = new Set();
  const socialChallenges = new Map();
  const resetAccepted = () => ({ ok: true, message: 'Nếu email đã đăng ký, hãy kiểm tra thư để lấy mã khôi phục.' });
  const resetInvalid = () => new ApiError(400, 'RESET_TOKEN_INVALID', 'Mã khôi phục không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu mã mới.');
  const report = code => { try { onDiagnostic({ code }); } catch { /* Diagnostics must never expose or interrupt account operations. */ } };
  const publicUser = user => ({ id: user.id, email: user.email, username: user.username,
    hasPassword: user.hasPassword !== false, providers: ['google', 'facebook'].filter(provider => user.providers?.includes(provider)) });
  const invalidSession = () => new ApiError(401, 'SESSION_EXPIRED', 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  function newSession(rememberMe) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now().getTime() + (rememberMe ? 30 : 1) * 86400000);
    return { token, expiresAt, tokenHash: hashSessionToken(token) };
  }
  const result = (user, session) => ({ user: publicUser(user), session: { token: session.token, expiresAt: session.expiresAt.toISOString() } });
  async function run(work) {
    try { return await work(); }
    catch (error) {
      if (error instanceof ApiError) throw error;
      if ([50905, 2601, 2627].includes(error?.number)) throw new ApiError(409, 'EMAIL_ALREADY_EXISTS', 'Email này đã có tài khoản. Hãy đăng nhập.');
      throw new ApiError(503, 'AUTH_UNAVAILABLE', 'Chưa kết nối được dịch vụ tài khoản. Kiểm tra máy chủ và cơ sở dữ liệu rồi thử lại.');
    }
  }
  async function current(token) {
    const session = await run(() => repository.getSession(hashSessionToken(token)));
    if (!session || new Date(session.expiresAt).getTime() <= now().getTime()) throw invalidSession();
    return session;
  }
  function socialInput(body, purpose, userId) {
    input(body);
    if (!['google', 'facebook'].includes(body.provider)
      || !['id_token', 'access_token', 'authentication_token'].includes(body.tokenType)
      || typeof body.token !== 'string' || !body.token || body.token.length > 12000)
      invalid('INVALID_AUTH_REQUEST', 'Thông tin đăng nhập liên kết không hợp lệ.');
    const credentials = { provider: body.provider, tokenType: body.tokenType, token: body.token };
    if (body.provider === 'facebook' && body.tokenType === 'authentication_token') {
      const challenge = socialChallenges.get(body.challengeId);
      // Consume before verification: the nonce is single-use even when verification fails.
      socialChallenges.delete(body.challengeId);
      if (!challenge || challenge.expiresAt <= now().getTime() || challenge.purpose !== purpose || challenge.userId !== userId)
        invalid('SOCIAL_CHALLENGE_EXPIRED', 'Phiên xác thực đã hết hạn. Vui lòng đăng nhập lại bằng Facebook.');
      credentials.nonce = challenge.nonce;
    }
    return credentials;
  }
  async function verifySocial(credentials) {
    if (!socialVerifier) throw new ApiError(503, 'SOCIAL_PROVIDER_UNAVAILABLE', 'Máy chủ chưa cấu hình đăng nhập liên kết.');
    return socialVerifier.verify(credentials);
  }
  return {
    async socialProviders() {
      return { providers: socialVerifier?.availability() ?? { google: false, facebook: false } };
    },
    async socialChallenge(body, token) {
      input(body);
      if (!['login', 'link'].includes(body.purpose)) invalid('INVALID_AUTH_REQUEST', 'Mục đích xác thực không hợp lệ.');
      if (!socialVerifier?.availability().facebook)
        throw new ApiError(503, 'SOCIAL_PROVIDER_UNAVAILABLE', 'Máy chủ chưa cấu hình đăng nhập Facebook.');
      const userId = body.purpose === 'link' ? (await current(token)).user.id : undefined;
      const time = now().getTime();
      for (const [key, value] of socialChallenges) if (value.expiresAt <= time) socialChallenges.delete(key);
      if (socialChallenges.size >= 1000) throw new ApiError(429, 'AUTH_RATE_LIMITED', 'Có quá nhiều yêu cầu xác thực. Vui lòng thử lại sau.');
      const challengeId = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('base64url');
      const expiresAt = time + 5 * 60000;
      socialChallenges.set(challengeId, { nonce, expiresAt, purpose: body.purpose, userId });
      return { challengeId, nonce, expiresAt: new Date(expiresAt).toISOString() };
    },
    async socialLogin(body) {
      const credentials = socialInput(body, 'login');
      const rememberMe = remembered(body.rememberMe);
      const identity = await verifySocial(credentials);
      const session = newSession(rememberMe);
      const user = await run(() => repository.socialLogin({ identity, tokenHash: session.tokenHash, expiresAt: session.expiresAt }));
      if (!user) throw new ApiError(401, 'SOCIAL_TOKEN_INVALID', 'Không xác thực được tài khoản liên kết.');
      return result(user, session);
    },
    async socialLink(token, body) {
      const existing = await current(token);
      const credentials = socialInput(body, 'link', existing.user.id);
      const identity = await verifySocial(credentials);
      // Re-check the PAT session in the repository transaction after provider verification.
      const user = await run(() => repository.linkSocialIdentity({ identity, currentTokenHash: hashSessionToken(token), userId: existing.user.id }));
      if (!user) throw invalidSession();
      return { user: publicUser(user) };
    },
    async register(body) {
      input(body);
      const identity = email(body.email), name = username(body.username), secret = password(body.password);
      const session = newSession(remembered(body.rememberMe));
      const passwordHash = await hash(secret);
      const user = await run(() => repository.register({ email: identity, username: name, passwordHash, tokenHash: session.tokenHash, expiresAt: session.expiresAt }));
      return result(user, session);
    },
    async login(body) {
      input(body);
      const identity = email(body.email), secret = password(body.password, false), rememberMe = remembered(body.rememberMe);
      const credential = await run(() => repository.findCredential(identity));
      // Keep unknown email and wrong password on the same expensive verification path.
      if (!credential) dummyHash ??= hash(randomBytes(32).toString('base64url'));
      const valid = await verify(secret, credential?.passwordHash ?? await dummyHash);
      if (!credential || !valid) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng.');
      const session = newSession(rememberMe);
      const user = await run(() => repository.createSession({ userId: credential.id, expectedHash: credential.passwordHash, tokenHash: session.tokenHash, expiresAt: session.expiresAt }));
      if (!user) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng.');
      return result(user, session);
    },
    async forgotPassword(body, { locale = 'vi' } = {}) {
      input(body);
      const identity = email(body.email);
      if (!resetMailer?.configured) throw new ApiError(503, 'RESET_NOT_CONFIGURED', 'Chưa cấu hình dịch vụ gửi email khôi phục. Vui lòng thử lại sau.');
      const time = now().getTime(), identityKey = hashSessionToken(identity).toString('hex');
      for (const [key, until] of resetRequests) if (until <= time) resetRequests.delete(key);
      if (resetRequests.has(identityKey))
        throw new ApiError(429, 'RESET_RATE_LIMITED', 'Vui lòng đợi một phút rồi yêu cầu mã khôi phục mới.');
      if (resetRequests.size >= 10000)
        throw new ApiError(429, 'AUTH_RATE_LIMITED', 'Có quá nhiều yêu cầu tài khoản. Vui lòng thử lại sau một phút.');
      resetRequests.set(identityKey, time + 60000);
      // SMTP occupancy depends on whether previous accounts exist. Never expose it
      // as a public status/timing signal: overload gets the same conditional reply.
      if (resetJobs.size >= 2) {
        report('RESET_DELIVERY_BUSY');
        return resetAccepted();
      }
      // The identical public path never waits for account lookup or SMTP. In particular,
      // delivery failure must not reveal whether an email address has an account.
      const job = new Promise(resolve => setImmediate(resolve)).then(async () => {
        let tokenHash;
        try {
          const credential = await repository.findCredential(identity);
          if (!credential) return;
          const token = randomBytes(32).toString('base64url');
          tokenHash = hashSessionToken(token);
          const created = await repository.createPasswordReset({ userId: credential.id, expectedHash: credential.passwordHash, tokenHash });
          if (!created) return;
          await resetMailer.sendReset({ to: credential.email, token, ...(normalizeLocale(locale) === 'vi' ? {} : { locale: normalizeLocale(locale) }) });
        } catch {
          report('RESET_DELIVERY_FAILED');
          if (tokenHash) {
            try { await repository.revokePasswordReset(tokenHash); }
            catch { report('RESET_REVOKE_FAILED'); }
          }
        }
      });
      resetJobs.add(job);
      void job.finally(() => resetJobs.delete(job));
      return resetAccepted();
    },
    async resetPassword(body) {
      input(body);
      if (typeof body.token !== 'string' || !TOKEN_PATTERN.test(body.token)) throw resetInvalid();
      const secret = password(body.newPassword);
      const passwordHash = await hash(secret);
      const reset = await run(() => repository.resetPassword({ tokenHash: hashSessionToken(body.token), passwordHash }));
      if (!reset) throw resetInvalid();
      // Do not sign in automatically: all prior sessions were revoked atomically.
      return { ok: true };
    },
    async me(token) { return { user: publicUser((await current(token)).user) }; },
    async updateProfile(token, body) {
      input(body);
      const name = username(body.username);
      const user = await run(() => repository.updateProfile(hashSessionToken(token), name));
      if (!user) throw invalidSession();
      return { user: publicUser(user) };
    },
    async changePassword(token, body) {
      input(body);
      const oldPassword = password(body.currentPassword, false), newPassword = password(body.newPassword);
      if (oldPassword === newPassword) invalid('PASSWORD_UNCHANGED', 'Mật khẩu mới cần khác mật khẩu hiện tại.');
      const existing = await current(token);
      if (existing.user.hasPassword === false)
        throw new ApiError(400, 'SOCIAL_PASSWORD_MANAGED', 'Tài khoản này đăng nhập bằng Google hoặc Facebook. Hãy đổi mật khẩu tại dịch vụ đó.');
      const credential = await run(() => repository.findCredential(existing.user.email));
      if (!credential || !await verify(oldPassword, credential.passwordHash))
        throw new ApiError(400, 'CURRENT_PASSWORD_INCORRECT', 'Mật khẩu hiện tại không đúng.');
      // Preserve the current session's remaining lifetime, never silently opt into 30 days.
      const replacement = newSession(false);
      replacement.expiresAt = new Date(existing.expiresAt);
      const passwordHash = await hash(newPassword);
      const user = await run(() => repository.changePassword({ userId: credential.id, expectedHash: credential.passwordHash, passwordHash, currentTokenHash: hashSessionToken(token), tokenHash: replacement.tokenHash, expiresAt: replacement.expiresAt }));
      if (!user) throw invalidSession();
      return result(user, replacement);
    },
    async logout(token) {
      await run(() => repository.logout(hashSessionToken(token)));
      return { ok: true };
    },
    async close() { socialChallenges.clear(); await Promise.all([...resetJobs]); await repository.close?.(); },
  };
}
