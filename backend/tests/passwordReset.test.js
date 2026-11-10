/** Kiểm thử mã khôi phục dùng một lần, thời hạn, chống dò email, thu hồi phiên và thư SMTP/UTF-8 bằng kho và kết nối giả. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { createAuthService, hashSessionToken } from '../auth.js';
import { createPasswordResetMailer } from '../passwordResetMail.js';
import { createApp } from '../app.js';

const EMAIL = 'user@example.com';
const OLD = 'TheOriginalLongPassword1', NEXT = 'TheReplacementLongPassword2';
const accepted = { ok: true, message: 'Nếu email đã đăng ký, hãy kiểm tra thư để lấy mã khôi phục.' };

function fixture({ configured = true, sendFailure = false, lookup } = {}) {
  let time = new Date('2026-11-05T00:00:00Z');
  const user = { id: '11111111-1111-4111-8111-111111111111', email: EMAIL, username: 'Chăm vườn', passwordHash: `hashed:${OLD}` };
  const tokens = new Map(), sessions = new Set(['session-one', 'session-two']), sent = [], diagnostics = [];
  const key = value => value.toString('hex');
  const repository = {
    async findCredential(email) { return lookup ? lookup(email) : email === EMAIL ? { ...user } : undefined; },
    async createPasswordReset(values) {
      if (values.expectedHash !== user.passwordHash) return false;
      if ([...tokens.values()].some(token => token.createdAt.getTime() > time.getTime() - 60000)) return false;
      for (const token of tokens.values()) if (!token.consumed && !token.revoked) token.revoked = true;
      tokens.set(key(values.tokenHash), { ...values, createdAt: new Date(time), expiresAt: new Date(time.getTime() + 600000) });
      return true;
    },
    async revokePasswordReset(hash) { const token = tokens.get(key(hash)); if (token && !token.consumed) token.revoked = true; },
    async resetPassword(values) {
      const token = tokens.get(key(values.tokenHash));
      if (!token || token.consumed || token.revoked || token.expiresAt <= time) return false;
      // No await between validation and consumption: models the repository's atomic CAS.
      token.consumed = true;
      user.passwordHash = values.passwordHash;
      sessions.clear();
      for (const other of tokens.values()) if (!other.consumed && !other.revoked) other.revoked = true;
      return true;
    },
    async close() {},
  };
  const resetMailer = { configured, async sendReset(message) { if (sendFailure) throw new Error(`SMTP private failure ${message.token} ${EMAIL}`); sent.push(message); } };
  const service = createAuthService({ repository, resetMailer, now: () => time,
    hash: async value => `hashed:${value}`, onDiagnostic: event => diagnostics.push(event) });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return { service, repository, resetMailer, user, tokens, sessions, sent, diagnostics, flush,
    advance: ms => { time = new Date(time.getTime() + ms); } };
}

test('recovery returns the same public response for registered/unknown addresses without awaiting delivery', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const f = fixture({ lookup: async () => waiting });
  assert.deepEqual(await f.service.forgotPassword({ email: EMAIL }), accepted);
  assert.deepEqual(await f.service.forgotPassword({ email: 'unknown@example.com' }), accepted);
  assert.equal(f.sent.length, 0);
  release(undefined);
  await f.service.close();
});

test('recovery generates a strong one-use code, stores only SHA-256 and expires after ten minutes', async () => {
  const f = fixture();
  const result = await f.service.forgotPassword({ email: ' USER@example.com ' });
  await f.flush();
  assert.deepEqual(result, accepted);
  assert.equal(f.sent[0].to, EMAIL);
  const token = f.sent[0].token;
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual([...f.tokens.keys()], [hashSessionToken(token).toString('hex')]);
  assert.equal(JSON.stringify([...f.tokens.values()]).includes(token), false);
  assert.equal([...f.tokens.values()][0].expiresAt.toISOString(), '2026-11-05T00:10:00.000Z');
  assert.equal(JSON.stringify(result).includes(token), false);
});

test('valid reset consumes the token, changes the hash, revokes all sessions and does not auto-login', async () => {
  const f = fixture();
  await f.service.forgotPassword({ email: EMAIL }); await f.flush();
  assert.deepEqual(await f.service.resetPassword({ token: f.sent[0].token, newPassword: NEXT }), { ok: true });
  assert.equal(f.user.passwordHash, `hashed:${NEXT}`);
  assert.equal(f.sessions.size, 0);
  assert.equal([...f.tokens.values()][0].consumed, true);
  await assert.rejects(f.service.resetPassword({ token: f.sent[0].token, newPassword: OLD }), { status: 400, code: 'RESET_TOKEN_INVALID' });
  assert.equal(f.user.passwordHash, `hashed:${NEXT}`);
});

test('two concurrent resets of one token have exactly one successful commit', async () => {
  const f = fixture();
  await f.service.forgotPassword({ email: EMAIL }); await f.flush();
  const responses = await Promise.allSettled([
    f.service.resetPassword({ token: f.sent[0].token, newPassword: NEXT }),
    f.service.resetPassword({ token: f.sent[0].token, newPassword: 'DifferentSufficientlyLongPassword3' }),
  ]);
  assert.equal(responses.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(responses.find(result => result.status === 'rejected').reason.code, 'RESET_TOKEN_INVALID');
});

test('expired, revoked, unknown and malformed codes fail with the same safe error', async () => {
  const f = fixture();
  await f.service.forgotPassword({ email: EMAIL }); await f.flush();
  f.advance(600000);
  for (const token of [f.sent[0].token, 'x'.repeat(43), '', 'bad', null, 'a'.repeat(44)])
    await assert.rejects(f.service.resetPassword({ token, newPassword: NEXT }), { status: 400, code: 'RESET_TOKEN_INVALID' });
  assert.equal(f.user.passwordHash, `hashed:${OLD}`);
  assert.equal(f.sessions.size, 2);
});

test('new recovery request revokes earlier code and preserves current password/session until valid reset', async () => {
  const f = fixture();
  await f.service.forgotPassword({ email: EMAIL }); await f.flush();
  f.advance(60000);
  await f.service.forgotPassword({ email: EMAIL }); await f.flush();
  assert.notEqual(f.sent[0].token, f.sent[1].token);
  await assert.rejects(f.service.resetPassword({ token: f.sent[0].token, newPassword: NEXT }), { code: 'RESET_TOKEN_INVALID' });
  assert.equal(f.user.passwordHash, `hashed:${OLD}`);
  assert.equal(f.sessions.size, 2);
  await f.service.resetPassword({ token: f.sent[1].token, newPassword: NEXT });
});

test('per-address throttle applies identically to unknown emails and is case insensitive', async () => {
  for (const email of [EMAIL, 'unknown@example.com']) {
    const f = fixture();
    await f.service.forgotPassword({ email }); await f.flush();
    await assert.rejects(f.service.forgotPassword({ email: email.toUpperCase() }), { status: 429, code: 'RESET_RATE_LIMITED' });
    f.advance(60000);
    assert.deepEqual(await f.service.forgotPassword({ email }), accepted);
    await f.service.close();
  }
});

test('missing SMTP configuration fails before account lookup for every address', async () => {
  const f = fixture({ configured: false });
  f.repository.findCredential = () => { assert.fail('must not query accounts'); };
  for (const email of [EMAIL, 'unknown@example.com'])
    await assert.rejects(f.service.forgotPassword({ email }), { status: 503, code: 'RESET_NOT_CONFIGURED' });
  assert.equal(f.tokens.size, 0);
});

test('SMTP failure revokes the new code, does not change password and logs no sensitive data', async () => {
  const f = fixture({ sendFailure: true });
  assert.deepEqual(await f.service.forgotPassword({ email: EMAIL }), accepted); await f.flush();
  assert.equal([...f.tokens.values()][0].revoked, true);
  assert.equal(f.user.passwordHash, `hashed:${OLD}`);
  assert.deepEqual(f.diagnostics, [{ code: 'RESET_DELIVERY_FAILED' }]);
});

test('SQL failure in async recovery only emits a safe diagnostic, never account details', async () => {
  const f = fixture();
  f.repository.findCredential = async () => { throw new Error('private SQL user@example.com'); };
  assert.deepEqual(await f.service.forgotPassword({ email: EMAIL }), accepted); await f.flush();
  assert.deepEqual(f.diagnostics, [{ code: 'RESET_DELIVERY_FAILED' }]);
});

test('reset validates password policy and never changes account state on validation errors', async () => {
  const f = fixture();
  await f.service.forgotPassword({ email: EMAIL }); await f.flush();
  for (const newPassword of ['short', 'a'.repeat(129), null, 'Abc1234', 'Abcdef12 ', 'Abcdef12\n', 'Abcd123!', 'Đấtxanh12'])
    await assert.rejects(f.service.resetPassword({ token: f.sent[0].token, newPassword }), { code: 'INVALID_PASSWORD' });
  assert.equal([...f.tokens.values()][0].consumed, undefined);
  assert.deepEqual(await f.service.resetPassword({ token: f.sent[0].token, newPassword: '12345678' }), { ok: true });
  assert.equal(f.user.passwordHash, 'hashed:12345678');
});

test('only two background recovery jobs run concurrently, overload stays generic and close waits', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const f = fixture({ lookup: async () => waiting });
  await f.service.forgotPassword({ email: 'first@example.com' });
  await f.service.forgotPassword({ email: 'second@example.com' });
  assert.deepEqual(await f.service.forgotPassword({ email: 'third@example.com' }), accepted);
  assert.deepEqual(f.diagnostics, [{ code: 'RESET_DELIVERY_BUSY' }]);
  let closed = false;
  const close = f.service.close().then(() => { closed = true; });
  await f.flush(); assert.equal(closed, false);
  release(undefined); await close; assert.equal(closed, true);
});

test('a third public probe cannot enumerate target email from pending SMTP worker occupancy', async () => {
  const probeResults = [];
  for (const targetExists of [false, true]) {
    let release;
    const waiting = new Promise(resolve => { release = resolve; });
    let f;
    f = fixture({ lookup: async email => email === 'first@example.com' || (email === 'target@example.com' && targetExists)
      ? { ...f.user, email } : undefined });
    f.repository.createPasswordReset = async () => true;
    f.resetMailer.sendReset = async message => { f.sent.push(message); await waiting; };
    await f.service.forgotPassword({ email: 'first@example.com' }); await f.flush();
    await f.service.forgotPassword({ email: 'target@example.com' }); await f.flush();
    probeResults.push(await f.service.forgotPassword({ email: 'fresh-probe@example.com' }));
    release(); await f.service.close();
  }
  assert.deepEqual(probeResults, [accepted, accepted]);
});

test('forgot/reset HTTP endpoints need no bearer, share account rate/body limits and expose no token', async t => {
  const f = fixture(), app = createApp({ auth: f.service });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); await f.service.close(); });
  const call = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${app.address().port}/api/auth/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  assert.deepEqual(await call('forgot-password', { email: EMAIL }), { status: 200, body: accepted });
  await f.flush();
  assert.deepEqual(await call('reset-password', { token: f.sent[0].token, newPassword: NEXT }), { status: 200, body: { ok: true } });
  assert.equal((await call('reset-password', { token: f.sent[0].token, newPassword: OLD })).body.error.code, 'RESET_TOKEN_INVALID');
  assert.equal((await call('forgot-password', { email: 'x'.repeat(17000) })).status, 413);
});

test('SMTP transport uses authenticated TLS, bounded timeouts and plain copyable code without links', async () => {
  let settings, message, closed = false;
  const mailer = createPasswordResetMailer({ env: { SMTP_USER: 'sender@gmail.com', SMTP_PASS: 'app-secret' },
    createTransport: options => { settings = options; return {
      async sendMail(value) { message = value; return { accepted: [EMAIL] }; }, close() { closed = true; },
    }; } });
  assert.equal(mailer.configured, true);
  await mailer.sendReset({ to: EMAIL, token: 'a'.repeat(43) });
  assert.equal(settings.host, 'smtp.gmail.com'); assert.equal(settings.port, 465);
  assert.equal(settings.secure, true); assert.equal(settings.requireTLS, true);
  assert.equal(settings.tls.rejectUnauthorized, true);
  assert.equal(settings.connectionTimeout, 10000); assert.equal(settings.socketTimeout, 10000);
  assert.equal(settings.logger, false); assert.equal(settings.debug, false);
  assert.match(message.text, /a{43}/); assert.match(message.text, /10 phút/);
  assert.equal(message.text.includes('http'), false);
  assert.equal(message.text.includes('app-secret'), false);
  assert.equal(message.textEncoding, 'base64');
  assert.equal(message.html, undefined); assert.equal(closed, true);
});

test('generated reset MIME preserves Vietnamese subject and body as UTF-8 without SMTP access', async () => {
  let raw;
  const mailer = createPasswordResetMailer({ env: { SMTP_USER: 'sender@gmail.com', SMTP_PASS: 'app-secret' },
    createTransport: () => ({
      async sendMail(message) {
        // Stream transport only composes bytes locally: no network, credentials or real recipients are used.
        const result = await nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' }).sendMail(message);
        raw = result.message.toString('ascii');
        return { accepted: [EMAIL] };
      },
      close() {},
    }) });
  const token = 'a'.repeat(43);
  await mailer.sendReset({ to: EMAIL, token });
  const separator = raw.indexOf('\r\n\r\n');
  assert.notEqual(separator, -1);
  const headers = raw.slice(0, separator).replace(/\r\n[ \t]+/g, ' ');
  assert.match(headers, /Content-Type: text\/plain; charset=utf-8/i);
  assert.match(headers, /Content-Transfer-Encoding: base64/i);
  const subject = headers.match(/^Subject: (.+)$/m)?.[1];
  assert.ok(subject);
  const decodedSubject = subject.replace(/(\?=)[ \t]+(=\?)/g, '$1$2')
    .replace(/=\?UTF-8\?([BQ])\?([^?]+)\?=/gi, (_, encoding, value) => {
      if (encoding.toUpperCase() === 'B') return Buffer.from(value, 'base64').toString('utf8');
      const bytes = value.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
      return Buffer.from(bytes, 'latin1').toString('utf8');
    });
  assert.equal(decodedSubject, 'Mã khôi phục mật khẩu PAT');
  const decodedBody = Buffer.from(raw.slice(separator + 4).replace(/\s/g, ''), 'base64').toString('utf8').replace(/\r\n/g, '\n');
  assert.equal(decodedBody.trimEnd(), `Bạn vừa yêu cầu khôi phục mật khẩu PAT.\n\nSao chép toàn bộ mã dưới đây và dán vào ứng dụng:\n\n${token}\n\nMã có hiệu lực trong 10 phút và chỉ dùng được một lần.\nKhông chia sẻ mã này với bất kỳ ai. Nếu bạn không yêu cầu, hãy bỏ qua thư này; mật khẩu hiện tại không thay đổi.`);
  assert.equal(decodedBody.includes('\uFFFD'), false);
  assert.equal(decodedBody.includes('?'), false);
});

test('bad SMTP settings never create a transport, and SMTP rejection is not treated as delivery', async () => {
  for (const env of [{}, { SMTP_USER: 'a@gmail.com' }, { SMTP_USER: 'a@gmail.com', SMTP_PASS: 'secret', SMTP_SECURE: 'false' },
    { SMTP_USER: 'a@gmail.com', SMTP_PASS: 'secret', SMTP_FROM: 'bad\nheader' }]) {
    const mailer = createPasswordResetMailer({ env, createTransport: () => assert.fail('must not connect') });
    assert.equal(mailer.configured, false);
    await assert.rejects(mailer.sendReset({ to: EMAIL, token: 'a'.repeat(43) }));
  }
  const rejected = createPasswordResetMailer({ env: { SMTP_USER: 'a@gmail.com', SMTP_PASS: 'secret' },
    createTransport: () => ({ async sendMail() { return { accepted: [] }; }, close() {} }) });
  await assert.rejects(rejected.sendReset({ to: EMAIL, token: 'a'.repeat(43) }), { message: 'RESET_MAIL_REJECTED' });
});
