/** Kiểm thử tích hợp tài khoản SQL khi được bật rõ ràng: đăng ký, đổi/khôi phục mật khẩu và thu hồi phiên; dọn tài khoản tạm sau chạy. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createApp } from '../app.js';
import { createAuthService } from '../auth.js';
import { createSqlAuthRepository } from '../authSql.js';

// Explicit opt-in only. A unique temporary account is removed in finally.
test('SQL account roundtrip: register, change/recover password, consume once, revoke sessions and clean up',
  { skip: process.env.PAT_AUTH_SQL_SMOKE !== '1' }, async () => {
    const require = createRequire(import.meta.url);
    const { connectDB } = require('../../database/db.js');
    const sql = require('mssql/msnodesqlv8');
    const database = process.env.AUTH_DB_NAME?.trim() || process.env.DB_NAME?.trim();
    const email = `pat-auth-check-${randomUUID()}@example.invalid`;
    const password = randomUUID().replaceAll('-', '') + 'Old1';
    const nextPassword = randomUUID().replaceAll('-', '') + 'New2';
    const recoveredPassword = randomUUID().replaceAll('-', '') + 'Recovered3';
    const repository = createSqlAuthRepository({ connect: () => connectDB({ database }) });
    const sent = [], diagnostics = [];
    let delivered;
    const mailDelivered = new Promise(resolve => { delivered = resolve; });
    // Capture only: this opt-in SQL test never connects to a mail provider.
    const auth = createAuthService({ repository, resetMailer: { configured: true, async sendReset(message) { sent.push(message); delivered(); } },
      onDiagnostic: event => diagnostics.push(event) });
    const server = createApp({ auth });
    let cleanup;
    try {
      cleanup = await connectDB({ database });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const origin = `http://127.0.0.1:${server.address().port}`;
      async function call(path, body, token, method = 'POST') {
        const response = await fetch(`${origin}/api/auth/${path}`, { method,
          headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, body: await response.json() };
      }
      const registration = await call('register', { email, password, username: 'Kiểm tra tài khoản' });
      assert.equal(registration.status, 201);
      const first = registration.body.session.token;
      assert.equal((await call('login', { email, password: 'wrong' })).status, 401);
      assert.equal((await call('password', { currentPassword: 'wrong', newPassword: nextPassword }, first)).status, 400);
      const changed = await call('password', { currentPassword: password, newPassword: nextPassword }, first);
      assert.equal(changed.status, 200);
      assert.notEqual(changed.body.session.token, first);
      assert.equal((await call('me', undefined, first, 'GET')).status, 401);
      assert.equal((await call('login', { email, password })).status, 401);
      const loggedIn = await call('login', { email, password: nextPassword });
      assert.equal(loggedIn.status, 200);
      const profile = await call('profile', { username: 'Đã đổi tên', email: 'wrong@example.invalid' }, loggedIn.body.session.token, 'PATCH');
      assert.equal(profile.status, 200); assert.equal(profile.body.user.email, email); assert.equal(profile.body.user.username, 'Đã đổi tên');
      const stored = await cleanup.request().input('email', sql.NVarChar(320), email)
        .query('SELECT PasswordHash FROM auth.Users WHERE NormalizedEmail=UPPER(@email)');
      assert.match(stored.recordset[0].PasswordHash, /^scrypt\$1\$/);
      assert.equal(stored.recordset[0].PasswordHash.includes(nextPassword), false);
      assert.equal((await call('reset-password', { token: 'invalid', newPassword: recoveredPassword })).body.error.code, 'RESET_TOKEN_INVALID');
      const requested = await call('forgot-password', { email });
      assert.deepEqual(requested, { status: 200, body: { ok: true, message: 'Nếu email đã đăng ký, hãy kiểm tra thư để lấy mã khôi phục.' } });
      let mailTimeout;
      try {
        await Promise.race([mailDelivered, new Promise((_, reject) => { mailTimeout = setTimeout(() => reject(new Error('Captured recovery mail was not produced')), 10000); })]);
      } finally { clearTimeout(mailTimeout); }
      assert.equal(sent.length, 1); assert.equal(sent[0].to, email);
      const reset = await Promise.all([
        call('reset-password', { token: sent[0].token, newPassword: recoveredPassword }),
        call('reset-password', { token: sent[0].token, newPassword: recoveredPassword }),
      ]);
      assert.deepEqual(reset.map(response => response.status).sort(), [200, 400]);
      assert.equal(reset.find(response => response.status === 400).body.error.code, 'RESET_TOKEN_INVALID');
      assert.deepEqual(reset.find(response => response.status === 200).body, { ok: true });
      for (const token of [changed.body.session.token, loggedIn.body.session.token])
        assert.equal((await call('me', undefined, token, 'GET')).status, 401);
      assert.equal((await call('reset-password', { token: sent[0].token, newPassword: password })).body.error.code, 'RESET_TOKEN_INVALID');
      assert.equal((await call('login', { email, password: nextPassword })).status, 401);
      const recovered = await call('login', { email, password: recoveredPassword });
      assert.equal(recovered.status, 200);
      const resetStored = await cleanup.request().input('email', sql.NVarChar(320), email).query(`SELECT t.TokenHash,t.ConsumedAtUtc,u.PasswordHash
        FROM auth.UserActionTokens t JOIN auth.Users u ON u.UserId=t.UserId WHERE u.NormalizedEmail=UPPER(@email) AND t.PurposeCode='RESET_PASSWORD'`);
      assert.equal(resetStored.recordset.length, 1);
      assert.ok(resetStored.recordset[0].ConsumedAtUtc);
      assert.match(resetStored.recordset[0].PasswordHash, /^scrypt\$1\$/);
      assert.equal(resetStored.recordset[0].PasswordHash.includes(recoveredPassword), false);
      assert.equal(diagnostics.length, 0);
      assert.equal((await call('logout', undefined, recovered.body.session.token)).status, 200);
      assert.equal((await call('me', undefined, loggedIn.body.session.token, 'GET')).status, 401);
    } finally {
      try {
        if (cleanup) {
          await cleanup.request().input('email', sql.NVarChar(320), email).query(`
            SET XACT_ABORT ON; BEGIN TRANSACTION;
            DECLARE @id UNIQUEIDENTIFIER = (SELECT UserId FROM auth.Users WHERE NormalizedEmail=UPPER(@email) AND AuthProviderCode='LOCAL');
            IF @id IS NOT NULL BEGIN
              DELETE auth.RefreshTokens WHERE UserId=@id;
              DELETE auth.UserActionTokens WHERE UserId=@id;
              DELETE app.UserSettings WHERE UserId=@id;
              DELETE app.UserProfiles WHERE UserId=@id;
              DELETE auth.Users WHERE UserId=@id AND NormalizedEmail=UPPER(@email);
            END;
            COMMIT TRANSACTION;`);
          const remaining = await cleanup.request().input('email', sql.NVarChar(320), email)
            .query('SELECT COUNT(*) AS count FROM auth.Users WHERE NormalizedEmail=UPPER(@email)');
          assert.equal(remaining.recordset[0].count, 0);
        }
      } finally {
        await new Promise(resolve => server.close(resolve));
        await auth.close(); await cleanup?.close();
      }
    }
  });
