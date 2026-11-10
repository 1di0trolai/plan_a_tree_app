/** Cung cấp bộ giả lập xác thực tài khoản có thể điều khiển lỗi và độ trễ cho các kiểm thử kho trạng thái. */

import type { AccountAuthPort, AuthEnvelope, RememberedLogin } from '../../src/services/accountAuth';
import type { AppState } from '../../src/types/app';

export class AuthFault extends Error {
  constructor(public code: string, message: string, public status?: number) { super(message); }
}
export function accountAuthFixture(initial: AppState) {
  const user = { id: '11111111-1111-4111-8111-111111111111', email: initial.auth.identity || 'test@pat.vn', username: initial.profile.name };
  const envelope = (): AuthEnvelope => ({ user: { ...user }, session: { token: 'a'.repeat(43), expiresAt: '2099-01-01T00:00:00Z' } });
  const io = { saved: initial.auth.loggedIn ? envelope() : null as AuthEnvelope | null,
    remembered: initial.auth.remember ? { email: user.email } : null as RememberedLogin | null,
    meError: null as Error | null, loginError: null as Error | null, passwordError: null as Error | null,
    recoveryError: null as Error | null, linkError: null as Error | null,
    loginGate: null as Promise<void> | null, rememberGate: null as Promise<void> | null,
    rememberError: null as Error | null,
    savedTokens: [] as (string | null)[], calls: [] as string[] };
  const port: AccountAuthPort = {
    async socialProviders() { return { google: true, facebook: true }; },
    async socialChallenge() { return { challengeId: 'c'.repeat(43), nonce: 'n'.repeat(43), expiresAt: '2099-01-01T00:00:00Z' }; },
    async socialLogin() { io.calls.push('social-login'); if (io.loginGate) await io.loginGate; if (io.loginError) throw io.loginError; return envelope(); },
    async linkSocial(_token, credential) { io.calls.push('social-link'); if (io.linkError) throw io.linkError; return { ...user, hasPassword: true, providers: [credential.provider] }; },
    async loadSession() { return io.saved; },
    async saveSession(value) { io.saved = value; io.savedTokens.push(value?.session.token ?? null); },
    async loadRememberedLogin() { return io.remembered; },
    async saveRememberedLogin(email, password) {
      // Mirror the real SecureStore port's contract: a secret cannot be saved
      // without a bound, opted-in email, including an explicit null email.
      if (typeof password === 'string' && !email)
        throw new AuthFault('INVALID_INPUT', 'Nhập email trước khi ghi nhớ mật khẩu.');
      if (io.rememberGate) await io.rememberGate;
      if (io.rememberError) throw io.rememberError;
      const secret = password === undefined && io.remembered?.email === email ? io.remembered.password : password;
      io.remembered = email === null ? null : { email, ...(typeof secret === 'string' ? { password: secret } : {}) };
    },
    async me() { if (io.meError) throw io.meError; return { ...user }; },
    async login(email) { io.calls.push('login'); if (io.loginGate) await io.loginGate; if (io.loginError) throw io.loginError; return { ...envelope(), user: { ...user, email } }; },
    async register(username, email) { return { ...envelope(), user: { ...user, username, email } }; },
    async logout(token) { io.calls.push(`logout:${token}`); },
    async updateProfile(_token, username) { return { ...user, username }; },
    async changePassword(token) { io.calls.push(`password:${token}`); if (io.passwordError) throw io.passwordError; return { ...envelope(), session: { ...envelope().session, token: 'b'.repeat(43) } }; },
    async requestPasswordReset() { io.calls.push('forgot-password'); if (io.recoveryError) throw io.recoveryError; },
    async resetPassword() { io.calls.push('reset-password'); if (io.recoveryError) throw io.recoveryError; },
  };
  return { io, port };
}
