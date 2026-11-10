/** Kiểm thử mật khẩu, phiên và quyền quản trị; xác nhận giới hạn thử đăng nhập, thu hồi phiên và ngăn tài khoản thường gửi thư. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminService, hashAdminPassword, verifyAdminPassword, adminTokenHash } from '../adminAuth.js';

const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const password = 'A private admin password 124';
const hash = await hashAdminPassword(password);
function fixture(options = {}) {
  let currentHash = hash;
  const sessions = new Map(), calls = [];
  const account = () => ({ id: adminId, username: 'garden-admin', active: true, passwordHash: currentHash });
  const repository = {
    async findAccount(name) { return name === 'GARDEN-ADMIN' ? account() : undefined; },
    async createSession(values) { if (values.expectedHash !== currentHash) return false; sessions.set(values.tokenHash.toString('hex'), { id: adminId, username: 'garden-admin', expiresAt: values.expiresAt }); return true; },
    async getSession(value) { return sessions.get(value.toString('hex')); },
    async revokeSession(value) { sessions.delete(value.toString('hex')); },
    async changePassword(values) { if (currentHash !== values.expectedHash || !sessions.has(values.tokenHash.toString('hex'))) return false; currentHash = values.passwordHash; sessions.clear(); return true; },
  };
  const cloud = {
    async listUsers(filters) { calls.push(['users', filters]); return { users: [] }; },
    async publishMail(admin, body) { calls.push(['publish', admin, body]); return { publicationId: 'id', recipientCount: 2, replayed: false }; },
    async listPublications(filters) { calls.push(['history', filters]); return { publications: [] }; },
  };
  return { service: createAdminService({ repository, cloud, ...options }), sessions, calls };
}
test('admin passwords use salted scrypt and reject malformed or incorrect hashes', async () => {
  assert.match(hash, /^scrypt\$32768\$8\$3\$/);
  assert.equal(await verifyAdminPassword(password, hash), true);
  assert.equal(await verifyAdminPassword('wrong', hash), false);
  assert.equal(await verifyAdminPassword(password, 'scrypt$999999999$8$3$bad$bad'), false);
  await assert.rejects(hashAdminPassword('short'), { code: 'ADMIN_PASSWORD_INVALID' });
});
test('login issues opaque hashed SQL sessions and logout revokes them', async () => {
  const { service, sessions } = fixture();
  const result = await service.login({ username: 'garden-admin', password }, 'local');
  assert.match(result.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(result.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(sessions.has(result.token), false);
  assert.equal(sessions.has(adminTokenHash(result.token).toString('hex')), true);
  assert.equal((await service.me(result.token)).admin.id, adminId);
  assert.equal(JSON.stringify(await service.me(result.token)).includes('passwordHash'), false);
  await service.logout(result.token);
  await assert.rejects(service.me(result.token), { code: 'ADMIN_AUTH_REQUIRED' });
});
test('unknown admin and wrong password return the same public error', async () => {
  const { service } = fixture();
  await assert.rejects(service.login({ username: 'missing-admin', password }, 'local'), { code: 'ADMIN_LOGIN_FAILED' });
  await assert.rejects(service.login({ username: 'garden-admin', password: 'wrong' }, 'local'), { code: 'ADMIN_LOGIN_FAILED' });
});
test('login brute force is bounded and expired sessions are not accepted', async () => {
  let time = Date.now();
  const { service } = fixture({ now: () => time, sessionMs: 1000 });
  const result = await service.login({ username: 'garden-admin', password }, 'first');
  time += 1001;
  await assert.rejects(service.me(result.token), { code: 'ADMIN_AUTH_REQUIRED' });
  for (let index = 0; index < 8; index++) await assert.rejects(service.login({ username: 'missing-admin', password: 'wrong' }, 'blocked'), { code: 'ADMIN_LOGIN_FAILED' });
  await assert.rejects(service.login({ username: 'missing-admin', password }, 'blocked'), { code: 'ADMIN_RATE_LIMITED' });
});
test('changing password requires current proof and revokes every admin session', async () => {
  const { service } = fixture();
  const first = await service.login({ username: 'garden-admin', password }, 'a');
  const second = await service.login({ username: 'garden-admin', password }, 'b');
  await assert.rejects(service.changePassword(first.token, { currentPassword: 'wrong', newPassword: 'a long new password' }), { code: 'ADMIN_PASSWORD_WRONG' });
  await service.changePassword(first.token, { currentPassword: password, newPassword: 'a long new password' });
  await assert.rejects(service.me(first.token), { code: 'ADMIN_AUTH_REQUIRED' });
  await assert.rejects(service.me(second.token), { code: 'ADMIN_AUTH_REQUIRED' });
  await service.login({ username: 'garden-admin', password: 'a long new password' }, 'c');
});
test('player bearer tokens cannot query users or publish messages, admin proof can', async () => {
  const { service, calls } = fixture();
  await assert.rejects(service.publish('p'.repeat(43), {}), { code: 'ADMIN_AUTH_REQUIRED' });
  assert.equal(calls.length, 0);
  const login = await service.login({ username: 'garden-admin', password }, 'local');
  const body = { requestId: 'test-request', title: 'Chào bạn', body: 'Chúc khu vườn xanh', target: 'all', attachments: [] };
  await service.publish(login.token, body);
  assert.deepEqual(calls[0], ['publish', { id: adminId, username: 'garden-admin' }, body]);
  await service.listUsers(login.token, { search: 'test' });
  await service.history(login.token);
});
