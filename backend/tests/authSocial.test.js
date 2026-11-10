/** Kiểm thử đăng nhập/liên kết Google/Facebook, chống trùng email và nonce dùng một lần bằng chứng thực nhà cung cấp giả. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService } from '../auth.js';
import { createApp } from '../app.js';
import { ApiError } from '../contracts.js';

function fixture() {
  let time = new Date('2026-11-06T00:00:00Z');
  const users = new Map(), sessions = new Map(), identities = new Map(), verified = [];
  const identity = { provider: 'google', subject: 'google-user-1', email: 'user@example.com', emailVerified: true, username: 'Người chăm vườn' };
  const key = hash => hash.toString('hex');
  const repository = {
    async getSession(hash) { return sessions.get(key(hash)); },
    async socialLogin(values) {
      const candidate = values.identity, linked = identities.get(`${candidate.provider}:${candidate.subject}`);
      let user = users.get(linked);
      if (!user) {
        if (!candidate.email || (candidate.provider === 'google' && !candidate.emailVerified)) throw new ApiError(409, 'SOCIAL_EMAIL_REQUIRED', 'Thiếu email xác thực.');
        if ([...users.values()].some(item => item.email === candidate.email)) throw new ApiError(409, 'SOCIAL_LINK_REQUIRED', 'Cần liên kết tài khoản.');
        user = { id: `user-${users.size + 1}`, email: candidate.email, username: candidate.username, hasPassword: false, providers: [candidate.provider] };
        users.set(user.id, user); identities.set(`${candidate.provider}:${candidate.subject}`, user.id);
      }
      sessions.set(key(values.tokenHash), { user, expiresAt: values.expiresAt });
      return user;
    },
    async linkSocialIdentity(values) {
      if (!sessions.has(key(values.currentTokenHash))) return undefined;
      const user = users.get(values.userId), candidate = values.identity;
      const linked = identities.get(`${candidate.provider}:${candidate.subject}`);
      if (linked && linked !== user.id) throw new ApiError(409, 'SOCIAL_IDENTITY_IN_USE', 'Đã liên kết tài khoản khác.');
      identities.set(`${candidate.provider}:${candidate.subject}`, user.id);
      if (!user.providers.includes(candidate.provider)) user.providers.push(candidate.provider);
      return user;
    },
    async logout(hash) { sessions.delete(key(hash)); },
  };
  const verifier = { availability: () => ({ google: true, facebook: true }), async verify(credentials) { verified.push(credentials); return { ...identity, provider: credentials.provider }; } };
  const service = createAuthService({ repository, socialVerifier: verifier, now: () => time });
  const login = (body = {}) => service.socialLogin({ provider: 'google', tokenType: 'id_token', token: 'private-provider-token', ...body });
  return { service, repository, verifier, identity, identities, users, sessions, verified, login, advance: ms => { time = new Date(time.getTime() + ms); } };
}

test('provider configuration is explicit and contains no credentials', async () => {
  assert.deepEqual(await fixture().service.socialProviders(), { providers: { google: true, facebook: true } });
  const service = createAuthService({ repository: {} });
  assert.deepEqual(await service.socialProviders(), { providers: { google: false, facebook: false } });
  await assert.rejects(service.socialLogin({ provider: 'google', tokenType: 'id_token', token: 'token' }), { code: 'SOCIAL_PROVIDER_UNAVAILABLE' });
});

test('verified identity issues a PAT session; stable subject, not changed email, identifies repeat login', async () => {
  const f = fixture(), first = await f.login({ rememberMe: true });
  assert.deepEqual(first.user, { id: 'user-1', email: 'user@example.com', username: 'Người chăm vườn', hasPassword: false, providers: ['google'] });
  assert.equal(first.session.expiresAt, '2026-12-06T00:00:00.000Z');
  assert.equal(JSON.stringify(first).includes('private-provider-token'), false);
  f.identity.email = 'different@example.com';
  const second = await f.login();
  assert.equal(second.user.id, first.user.id); assert.equal(f.users.size, 1);
  assert.deepEqual(await f.service.me(second.session.token), { user: first.user });
  await assert.rejects(f.service.changePassword(second.session.token, { currentPassword: 'oldsecret', newPassword: 'newsecret' }), { code: 'SOCIAL_PASSWORD_MANAGED' });
});

test('email collisions never silently link or create a second account', async () => {
  const f = fixture();
  f.users.set('local', { id: 'local', email: f.identity.email, providers: [], hasPassword: true });
  await assert.rejects(f.login(), { code: 'SOCIAL_LINK_REQUIRED' });
  assert.equal(f.users.size, 1); assert.equal(f.sessions.size, 0); assert.equal(f.identities.size, 0);
});

test('no contact or unverified contact cannot create an external account', async () => {
  for (const patch of [{ email: null }, { emailVerified: false }]) {
    const f = fixture(); Object.assign(f.identity, patch);
    await assert.rejects(f.login(), { code: 'SOCIAL_EMAIL_REQUIRED' });
    assert.equal(f.users.size, 0);
  }
});

test('Facebook may create a passwordless account from its provider email without claiming Google-style email verification', async () => {
  const f = fixture(); f.identity.emailVerified = false;
  const result = await f.login({ provider: 'facebook', tokenType: 'access_token' });
  assert.equal(result.user.hasPassword, false); assert.deepEqual(result.user.providers, ['facebook']);
});

test('explicit linking requires a valid PAT session and preserves its original account/email', async () => {
  const f = fixture(), first = await f.login();
  const linked = await f.service.socialLink(first.session.token, { provider: 'facebook', tokenType: 'access_token', token: 'fb-token' });
  assert.deepEqual(linked.user.providers, ['google', 'facebook']);
  assert.equal(linked.user.id, first.user.id); assert.equal(linked.user.email, first.user.email);
  await f.service.logout(first.session.token);
  await assert.rejects(f.service.socialLink(first.session.token, { provider: 'facebook', tokenType: 'access_token', token: 'fb-token' }), { code: 'SESSION_EXPIRED' });
});

test('Facebook Limited Login challenges provide a one-time nonce and expire after five minutes', async () => {
  const f = fixture(), challenge = await f.service.socialChallenge({ purpose: 'login' });
  const body = { provider: 'facebook', tokenType: 'authentication_token', token: 'signed-token', challengeId: challenge.challengeId };
  await f.login(body);
  assert.equal(f.verified[0].nonce, challenge.nonce);
  await assert.rejects(f.login(body), { code: 'SOCIAL_CHALLENGE_EXPIRED' });
  const expired = await f.service.socialChallenge({ purpose: 'login' });
  f.advance(300001);
  await assert.rejects(f.login({ ...body, challengeId: expired.challengeId }), { code: 'SOCIAL_CHALLENGE_EXPIRED' });
});

test('challenge cannot be reused for another purpose or after a failed provider verification', async () => {
  const f = fixture(), login = await f.login();
  const challenge = await f.service.socialChallenge({ purpose: 'link' }, login.session.token);
  const body = { provider: 'facebook', tokenType: 'authentication_token', token: 'signed-token', challengeId: challenge.challengeId };
  await assert.rejects(f.login(body), { code: 'SOCIAL_CHALLENGE_EXPIRED' });
  const failed = await f.service.socialChallenge({ purpose: 'login' });
  f.verifier.verify = async () => { throw new ApiError(401, 'SOCIAL_TOKEN_INVALID', 'Không hợp lệ.'); };
  await assert.rejects(f.login({ ...body, challengeId: failed.challengeId }), { code: 'SOCIAL_TOKEN_INVALID' });
  await assert.rejects(f.login({ ...body, challengeId: failed.challengeId }), { code: 'SOCIAL_CHALLENGE_EXPIRED' });
});

test('malformed OAuth input fails before provider verification', async () => {
  const f = fixture();
  for (const patch of [{ provider: 'other' }, { tokenType: 'password' }, { token: '' }, { token: 'x'.repeat(12001) }, { rememberMe: 'yes' }])
    await assert.rejects(f.login(patch), { status: 400 });
  assert.equal(f.verified.length, 0);
});

test('HTTP social routes work without shared AI token; link and link challenge require PAT authorization', async t => {
  const f = fixture(), app = createApp({ auth: f.service });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); });
  async function call(path, method = 'POST', body, token) {
    const response = await fetch(`http://127.0.0.1:${app.address().port}/api/auth/social/${path}`, { method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  assert.deepEqual((await call('providers', 'GET')).body, { providers: { google: true, facebook: true } });
  assert.equal((await call('challenge', 'POST', { purpose: 'login' })).status, 200);
  assert.equal((await call('challenge', 'POST', { purpose: 'link' })).body.error.code, 'AUTH_REQUIRED');
  assert.equal((await call('link', 'POST', { provider: 'facebook', tokenType: 'access_token', token: 'token' })).body.error.code, 'AUTH_REQUIRED');
  const loggedIn = await call('login', 'POST', { provider: 'google', tokenType: 'id_token', token: 'token' });
  assert.equal(loggedIn.status, 200);
  assert.equal((await call('link', 'POST', { provider: 'facebook', tokenType: 'access_token', token: 'token' }, loggedIn.body.session.token)).status, 200);
});
