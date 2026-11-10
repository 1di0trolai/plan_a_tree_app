/** Kiểm thử đăng ký, đăng nhập, chính sách mật khẩu, hồ sơ và vòng đời phiên bằng kho tài khoản giả trong bộ nhớ. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService, hashPassword, verifyPassword, sessionToken } from '../auth.js';
import { createApp } from '../app.js';

const PASSWORD = 'ASufficientlyLongPassword1';
const NEXT_PASSWORD = 'ANewSufficientlyLongPassword2';
function fixture() {
  const users = new Map(), sessions = new Map();
  let time = new Date('2026-11-04T00:00:00Z');
  const key = hash => hash.toString('hex');
  const publicUser = user => ({ id: user.id, email: user.email, username: user.username });
  const add = (user, values) => { sessions.set(key(values.tokenHash), { userId: user.id, expiresAt: values.expiresAt }); return publicUser(user); };
  const session = hash => {
    const value = sessions.get(key(hash));
    return value && value.expiresAt > time ? value : undefined;
  };
  const repository = {
    async register(values) {
      if ([...users.values()].some(user => user.email === values.email)) throw Object.assign(new Error('private SQL duplicate'), { number: 50905 });
      const user = { id: '11111111-1111-4111-8111-111111111111', ...values };
      users.set(user.id, user); return add(user, values);
    },
    async findCredential(email) { return [...users.values()].find(user => user.email === email); },
    async createSession(values) { const user = users.get(values.userId); return user?.passwordHash === values.expectedHash ? add(user, values) : undefined; },
    async getSession(hash) { const found = session(hash); return found ? { user: publicUser(users.get(found.userId)), expiresAt: found.expiresAt } : undefined; },
    async updateProfile(hash, username) { const found = session(hash); if (!found) return undefined; const user = users.get(found.userId); user.username = username; return publicUser(user); },
    async changePassword(values) {
      const user = users.get(values.userId);
      if (!session(values.currentTokenHash) || user?.passwordHash !== values.expectedHash) return undefined;
      user.passwordHash = values.passwordHash;
      for (const [id, value] of sessions) if (value.userId === user.id) sessions.delete(id);
      return add(user, values);
    },
    async logout(hash) { sessions.delete(key(hash)); },
  };
  // Fast injected verifier keeps protocol tests focused; a separate test exercises real scrypt.
  const service = createAuthService({ repository, now: () => time, hash: async value => `hashed:${value}`, verify: async (value, encoded) => encoded === `hashed:${value}` });
  const register = (extra = {}) => service.register({ email: ' USER@example.com ', username: ' Người chăm vườn ', password: PASSWORD, ...extra });
  return { service, repository, users, sessions, register, advance: ms => { time = new Date(time.getTime() + ms); } };
}

test('real scrypt hashes are salted, versioned and verify exact Unicode/spaces without plaintext storage', async () => {
  const value = ' Một mật khẩu đủ dài 1 ';
  const hash = await hashPassword(value);
  assert.match(hash, /^scrypt\$1\$/);
  assert.equal(hash.includes(value), false);
  assert.equal(await verifyPassword(value, hash), true);
  assert.equal(await verifyPassword(value.trim(), hash), false);
  assert.equal(await verifyPassword(value, 'scrypt$999$malformed$payload'), false);
});

test('registration signs in, normalizes email and exposes only the sole username', async () => {
  const f = fixture(), result = await f.register();
  assert.deepEqual(result.user, { id: '11111111-1111-4111-8111-111111111111', email: 'user@example.com', username: 'Người chăm vườn', hasPassword: true, providers: [] });
  assert.match(result.session.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.session.expiresAt, '2026-11-05T00:00:00.000Z');
  assert.equal(JSON.stringify(result).includes('hashed:'), false);
  assert.equal([...f.sessions.keys()].includes(result.session.token), false);
  assert.deepEqual(await f.service.me(result.session.token), { user: result.user });
});

test('remembered sessions last 30 days; duplicate email is an actionable conflict', async () => {
  const f = fixture(), result = await f.register({ rememberMe: true });
  assert.equal(result.session.expiresAt, '2026-12-04T00:00:00.000Z');
  await assert.rejects(f.register(), { status: 409, code: 'EMAIL_ALREADY_EXISTS' });
});

test('new passwords enforce 8–128 characters and username is 2–40 Unicode characters', async () => {
  for (const patch of [{ password: 'sixsix' }, { password: 'a'.repeat(129) }, { username: 'a' }, { username: 'a'.repeat(41) }, { username: 'bad\nname' }, { email: 'bad' }, { rememberMe: 'yes' }])
    await assert.rejects(fixture().register(patch), { status: 400 });
});

test('new password policy accepts 8 ASCII characters without requiring every class; rejects 7 or 129', async () => {
  const message = 'Mật khẩu cần từ 8 đến 128 ký tự và chỉ gồm A–Z, a–z, 0–9.';
  for (const password of ['Abc1234', 'a'.repeat(129)])
    await assert.rejects(fixture().register({ password }), { status: 400, code: 'INVALID_PASSWORD', message });
  for (const password of ['abcdefgh', 'ABCDEFGH', '12345678', 'Abcdef12', 'minhthu2026', 'a'.repeat(128)]) {
    const f = fixture(), registered = await f.register({ password });
    assert.equal(f.users.get(registered.user.id).passwordHash, `hashed:${password}`);
  }
});

test('new passwords reject spaces, Unicode, symbols and trailing linebreaks without sanitizing', async () => {
  for (const password of [' Abcdef12', 'Abcdef12 ', 'Abcd ef12', 'Abcdef12\n', 'Abcdef12\r\n',
    'Đấtxanh12', 'Abcd١٢٣٤', 'Abcde🌱12', 'Abcd123_', 'Abcd123!', 'Ａbcdef12', 'Abcdef12\u00a0']) {
    const f = fixture();
    await assert.rejects(f.register({ password }), { code: 'INVALID_PASSWORD' });
    assert.equal(f.users.size, 0);
  }
});

test('legacy Unicode/space credentials still log in and are never trimmed or normalized', async () => {
  const f = fixture(), registered = await f.register();
  const legacy = ' Aá1e\u0301🌱xy ';
  f.users.get(registered.user.id).passwordHash = `hashed:${legacy}`;
  const loggedIn = await f.service.login({ email: registered.user.email, password: legacy });
  for (const changed of [legacy.trim(), legacy.normalize('NFC')])
    await assert.rejects(f.service.login({ email: registered.user.email, password: changed }), { code: 'INVALID_CREDENTIALS' });
  const changed = await f.service.changePassword(loggedIn.session.token, { currentPassword: legacy, newPassword: 'abcdefgh' });
  assert.equal(changed.user.id, registered.user.id);
  assert.equal(f.users.get(registered.user.id).passwordHash, 'hashed:abcdefgh');
});

test('legacy shorter passwords can still log in and authenticate a change to the new policy', async () => {
  const f = fixture(), registered = await f.register();
  f.users.get(registered.user.id).passwordHash = 'hashed:old';
  const loggedIn = await f.service.login({ email: registered.user.email, password: 'old' });
  for (const newPassword of ['Abc1234', 'Abcdef12 ', 'Abcdef12!', 'Đấtxanh12'])
    await assert.rejects(f.service.changePassword(loggedIn.session.token, { currentPassword: 'old', newPassword }), { code: 'INVALID_PASSWORD' });
  assert.equal(f.users.get(registered.user.id).passwordHash, 'hashed:old');
  const changed = await f.service.changePassword(loggedIn.session.token, { currentPassword: 'old', newPassword: '12345678' });
  assert.equal(changed.user.id, registered.user.id);
  assert.equal(f.users.get(registered.user.id).passwordHash, 'hashed:12345678');
});

test('login verifies passwords, never falls back and reports unknown email/wrong password identically', async () => {
  const f = fixture(); await f.register();
  for (const patch of [{ email: 'unknown@example.com', password: PASSWORD }, { email: 'user@example.com', password: 'wrong' }])
    await assert.rejects(f.service.login(patch), { status: 401, code: 'INVALID_CREDENTIALS', message: 'Email hoặc mật khẩu không đúng.' });
  const login = await f.service.login({ email: 'USER@example.com', password: PASSWORD });
  assert.equal(login.user.username, 'Người chăm vườn');
  f.repository.createSession = async () => undefined;
  await assert.rejects(f.service.login({ email: 'user@example.com', password: PASSWORD }), { status: 401, code: 'INVALID_CREDENTIALS' });
});

test('profile update changes only username, ignoring attempts to change email or credentials', async () => {
  const f = fixture(), registered = await f.register();
  const updated = await f.service.updateProfile(registered.session.token, { username: 'Tên mới', email: 'attacker@example.com', password: 'nope' });
  assert.equal(updated.user.username, 'Tên mới');
  assert.equal(updated.user.email, 'user@example.com');
  assert.equal(f.users.get(updated.user.id).passwordHash, `hashed:${PASSWORD}`);
});

test('password change requires the old password, rotates current session and revokes every prior session', async () => {
  const f = fixture(), first = await f.register({ rememberMe: true });
  const second = await f.service.login({ email: first.user.email, password: PASSWORD });
  await assert.rejects(f.service.changePassword(first.session.token, { currentPassword: 'wrong', newPassword: NEXT_PASSWORD }), { code: 'CURRENT_PASSWORD_INCORRECT' });
  await assert.rejects(f.service.changePassword(first.session.token, { currentPassword: PASSWORD, newPassword: PASSWORD }), { code: 'PASSWORD_UNCHANGED' });
  const changed = await f.service.changePassword(first.session.token, { currentPassword: PASSWORD, newPassword: NEXT_PASSWORD });
  assert.notEqual(changed.session.token, first.session.token);
  assert.equal(changed.session.expiresAt, first.session.expiresAt);
  for (const old of [first, second]) await assert.rejects(f.service.me(old.session.token), { status: 401, code: 'SESSION_EXPIRED' });
  await assert.rejects(f.service.login({ email: first.user.email, password: PASSWORD }), { code: 'INVALID_CREDENTIALS' });
  assert.equal((await f.service.login({ email: first.user.email, password: NEXT_PASSWORD })).user.id, first.user.id);
});

test('expired sessions, logout and database failure cannot authenticate', async () => {
  const f = fixture(), first = await f.register();
  assert.deepEqual(await f.service.logout(first.session.token), { ok: true });
  await assert.rejects(f.service.me(first.session.token), { code: 'SESSION_EXPIRED' });
  const login = await f.service.login({ email: first.user.email, password: PASSWORD });
  f.advance(86400001);
  await assert.rejects(f.service.me(login.session.token), { code: 'SESSION_EXPIRED' });
  f.repository.findCredential = async () => { throw new Error('SQL secret database path'); };
  await assert.rejects(f.service.login({ email: first.user.email, password: PASSWORD }), error => error.code === 'AUTH_UNAVAILABLE' && !error.message.includes('secret'));
});

test('session parser rejects shared proxy tokens, missing headers and malformed input', () => {
  for (const value of [undefined, '', 'Bearer shared-proxy-token', `Basic ${'a'.repeat(43)}`, `Bearer ${'a'.repeat(42)}`, `Bearer ${'a'.repeat(43)} `])
    assert.throws(() => sessionToken(value), { status: 401, code: 'AUTH_REQUIRED' });
  assert.equal(sessionToken(`Bearer ${'a'.repeat(43)}`), 'a'.repeat(43));
});

async function server(t, options = {}) {
  const f = fixture(), app = createApp({ auth: f.service, ...options });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); });
  const call = async (path, method = 'POST', body, bearer) => {
    const response = await fetch(`http://127.0.0.1:${app.address().port}/api/auth/${path}`, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  return { f, call };
}
test('HTTP account routes work independently of AI configuration and use session-specific authorization', async t => {
  const { call } = await server(t);
  const response = await call('register', 'POST', { email: 'user@example.com', username: 'Tên người dùng', password: PASSWORD });
  assert.equal(response.status, 201);
  const token = response.body.session.token;
  assert.equal((await call('me', 'GET', undefined, token)).status, 200);
  assert.equal((await call('me', 'GET')).body.error.code, 'AUTH_REQUIRED');
  const updated = await call('profile', 'PATCH', { username: 'Tên mới' }, token);
  assert.equal(updated.body.user.username, 'Tên mới');
  assert.equal((await call('logout', 'POST', undefined, token)).status, 200);
  assert.equal((await call('me', 'GET', undefined, token)).body.error.code, 'SESSION_EXPIRED');
});
test('HTTP auth body-size, missing configuration and rate limits fail safely', async t => {
  const unavailable = await server(t, { auth: undefined });
  assert.equal((await unavailable.call('login', 'POST', {})).body.error.code, 'AUTH_UNAVAILABLE');
  const limited = await server(t, { authRequestsPerMinute: 1 });
  assert.equal((await limited.call('login', 'POST', {})).status, 400);
  assert.equal((await limited.call('login', 'POST', {})).body.error.code, 'AUTH_RATE_LIMITED');
  const bounded = await server(t);
  assert.equal((await bounded.call('login', 'POST', { password: 'x'.repeat(17000) })).status, 413);
});
