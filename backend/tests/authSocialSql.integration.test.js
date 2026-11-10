/** Kiểm thử tích hợp liên kết danh tính ngoài trong SQL bằng tài khoản tạm và chứng thực giả; không gọi Google/Facebook thật. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createAuthService } from '../auth.js';
import { createSqlAuthRepository } from '../authSql.js';

// Explicit opt-in. Uses generated temporary accounts only; always removes them.
// Provider credentials are injected: this test never contacts Google or Facebook.
test('SQL social identity roundtrip preserves local accounts and refuses email-only linking',
  { skip: process.env.PAT_AUTH_SOCIAL_SQL_SMOKE !== '1' }, async () => {
    const require = createRequire(import.meta.url), sql = require('mssql/msnodesqlv8');
    const { connectDB } = require('../../database/db.js');
    const database = process.env.AUTH_DB_NAME?.trim() || process.env.DB_NAME?.trim();
    const marker = randomUUID(), email = `pat-oauth-${marker}@example.invalid`;
    const localEmail = `pat-local-${marker}@example.invalid`, facebookEmail = `pat-facebook-${marker}@example.invalid`;
    const repository = createSqlAuthRepository({ connect: () => connectDB({ database }) });
    const identities = new Map([
      ['google', { provider: 'google', subject: `g-${marker}`, email, emailVerified: true, username: 'Tài khoản Google' }],
      ['local-google', { provider: 'google', subject: `gl-${marker}`, email: localEmail, emailVerified: true, username: 'Tên Google' }],
      ['facebook-link', { provider: 'facebook', subject: `fb-${marker}`, email: null, emailVerified: false, username: 'Tên Facebook' }],
      ['facebook-new', { provider: 'facebook', subject: `fbn-${marker}`, email: facebookEmail, emailVerified: false, username: 'Tài khoản Facebook' }],
    ]);
    const service = createAuthService({ repository, socialVerifier: { availability: () => ({ google: true, facebook: true }),
      async verify({ token }) { return identities.get(token); } },
      // Only the generated temporary local account uses this fast fixture hash.
      hash: async () => `test-only-${randomUUID()}`, verify: async () => false,
    });
    const credentials = (token, provider = 'google') => ({ provider, tokenType: provider === 'google' ? 'id_token' : 'access_token', token });
    let cleanup;
    try {
      cleanup = await connectDB({ database });
      const external = await service.socialLogin(credentials('google'));
      assert.equal(external.user.hasPassword, false); assert.deepEqual(external.user.providers, ['google']);
      assert.deepEqual(await service.me(external.session.token), { user: external.user });
      const repeat = await service.socialLogin(credentials('google'));
      assert.equal(repeat.user.id, external.user.id);
      const linked = await service.socialLink(external.session.token, credentials('facebook-link', 'facebook'));
      assert.deepEqual(linked.user.providers, ['google', 'facebook']);
      const facebookLogin = await service.socialLogin(credentials('facebook-link', 'facebook'));
      assert.equal(facebookLogin.user.id, external.user.id);
      const profile = await service.updateProfile(external.session.token, { username: 'Tên mới' });
      assert.equal(profile.user.email, email); assert.deepEqual(profile.user.providers, ['google', 'facebook']);
      const local = await service.register({ email: localEmail, username: 'Tài khoản gốc', password: 'abcdefgh' });
      await assert.rejects(service.socialLogin(credentials('local-google')), { code: 'SOCIAL_LINK_REQUIRED' });
      const localLinked = await service.socialLink(local.session.token, credentials('local-google'));
      assert.equal(localLinked.user.id, local.user.id); assert.equal(localLinked.user.username, 'Tài khoản gốc');
      assert.equal(localLinked.user.hasPassword, true); assert.deepEqual(localLinked.user.providers, ['google']);
      assert.equal((await service.socialLogin(credentials('local-google'))).user.id, local.user.id);
      await assert.rejects(service.socialLink(local.session.token, credentials('facebook-link', 'facebook')), { code: 'SOCIAL_IDENTITY_IN_USE' });
      await assert.rejects(service.socialLink(external.session.token, credentials('local-google')), { code: 'SOCIAL_IDENTITY_IN_USE' });
      const newFacebook = await service.socialLogin(credentials('facebook-new', 'facebook'));
      assert.equal(newFacebook.user.hasPassword, false); assert.deepEqual(newFacebook.user.providers, ['facebook']);
      const stored = await cleanup.request().input('email', sql.NVarChar(320), facebookEmail)
        .query('SELECT AuthProviderCode,PasswordHash,EmailConfirmedAtUtc FROM auth.Users WHERE NormalizedEmail=UPPER(@email)');
      assert.equal(stored.recordset[0].AuthProviderCode, 'EXTERNAL'); assert.equal(stored.recordset[0].PasswordHash, null);
      assert.equal(stored.recordset[0].EmailConfirmedAtUtc, null);
      assert.equal(await repository.findCredential(facebookEmail), undefined);
      assert.equal(await repository.findCredential(email), undefined);
      await service.logout(external.session.token);
      await assert.rejects(service.me(external.session.token), { code: 'SESSION_EXPIRED' });
    } finally {
      try {
        if (cleanup) await cleanup.request().input('email', sql.NVarChar(320), email)
          .input('localEmail', sql.NVarChar(320), localEmail).input('facebookEmail', sql.NVarChar(320), facebookEmail).query(`
            SET XACT_ABORT ON; BEGIN TRANSACTION;
            DECLARE @ids TABLE (UserId UNIQUEIDENTIFIER PRIMARY KEY);
            INSERT @ids SELECT UserId FROM auth.Users WHERE Email IN (@email,@localEmail,@facebookEmail);
            DELETE FROM auth.ExternalIdentities WHERE UserId IN (SELECT UserId FROM @ids);
            DELETE FROM auth.RefreshTokens WHERE UserId IN (SELECT UserId FROM @ids);
            DELETE FROM auth.UserActionTokens WHERE UserId IN (SELECT UserId FROM @ids);
            DELETE FROM app.UserSettings WHERE UserId IN (SELECT UserId FROM @ids);
            DELETE FROM app.UserProfiles WHERE UserId IN (SELECT UserId FROM @ids);
            DELETE FROM auth.Users WHERE UserId IN (SELECT UserId FROM @ids);
            COMMIT TRANSACTION;`);
      } finally { await service.close(); await cleanup?.close(); }
    }
  });
