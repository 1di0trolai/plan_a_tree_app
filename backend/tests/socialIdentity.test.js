/** Kiểm thử chữ ký, người nhận, thời hạn, nonce và liên kết ứng dụng của Google/Facebook bằng khóa thử và phản hồi HTTP giả. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createSocialIdentityVerifier } from '../socialIdentity.js';

const NOW = new Date('2026-11-06T00:00:00Z');
const SECONDS = NOW.getTime() / 1000;
const AUDIENCE = 'server-web-client.apps.googleusercontent.com';
const APP_ID = '123456789012345';
const APP_SECRET = 'server-only-test-secret';
const NONCE = 'challenge-from-server-123456789012345';
const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
const localKeys = createLocalJWKSet({ keys: [jwk] });

function fixture(extra = {}) {
  return createSocialIdentityVerifier({
    googleClientIds: [AUDIENCE], facebookAppId: APP_ID, facebookAppSecret: APP_SECRET,
    now: () => NOW, googleJwks: localKeys, facebookJwks: localKeys, ...extra,
  });
}
function jwt(provider = 'google', claims = {}, { key = privateKey, alg = 'RS256', kid = 'test-key' } = {}) {
  return new SignJWT({
    iss: provider === 'google' ? 'https://accounts.google.com' : 'https://www.facebook.com',
    aud: provider === 'google' ? AUDIENCE : APP_ID,
    sub: provider === 'google' ? 'google-subject' : 'facebook-subject',
    iat: SECONDS, exp: SECONDS + 3600,
    email: 'Person@Example.com', name: 'Người chăm vườn',
    ...(provider === 'google' ? { email_verified: true } : { nonce: NONCE }), ...claims,
  }).setProtectedHeader({ alg, kid }).sign(key);
}
function credential(token, provider = 'google', extra = {}) {
  return { provider, token, tokenType: provider === 'google' ? 'id_token' : 'authentication_token', ...extra };
}
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }); }
function graphFixture({ debug = {}, profile = {}, fetchImpl } = {}) {
  const calls = [];
  const verify = fixture({ fetchImpl: fetchImpl ?? (async (url, options) => {
    calls.push({ url: new URL(url), options });
    return url.pathname.endsWith('/debug_token')
      ? json({ data: { is_valid: true, app_id: APP_ID, type: 'USER', user_id: 'facebook-subject', expires_at: SECONDS + 3600, data_access_expires_at: SECONDS + 86400, ...debug } })
      : json({ id: 'facebook-subject', email: 'Person@Example.com', name: 'Người chăm vườn', ...profile });
  }) });
  const input = credential('opaque-user-token', 'facebook', { tokenType: 'access_token' });
  return { verify: () => verify.verify(input), calls };
}

test('availability requires audiences and Facebook server App Secret, not client token', () => {
  assert.deepEqual(createSocialIdentityVerifier().availability(), { google: false, facebook: false });
  assert.deepEqual(fixture().availability(), { google: true, facebook: true });
  assert.equal(fixture({ facebookAppSecret: '' }).availability().facebook, false);
  assert.equal(fixture({ facebookAppId: 'bad' }).availability().facebook, false);
});

test('Google checks signed identity and returns only the minimal provider profile', async () => {
  const token = await jwt('google', { picture: 'https://unused.example/avatar', azp: 'android-client.apps.googleusercontent.com' });
  assert.deepEqual(await fixture().verify(credential(token)), {
    provider: 'google', subject: 'google-subject', email: 'person@example.com', emailVerified: true, username: 'Người chăm vườn',
  });
  assert.equal(await fixture().verify(credential(await jwt('google', { iss: 'accounts.google.com' }))).then(x => x.subject), 'google-subject');
});

test('Google rejects wrong audience/issuer, expired or future-issued token, missing expiry/subject and invalid signature', async () => {
  const missingExpiry = { exp: undefined };
  for (const claims of [{ aud: 'other-client' }, { iss: 'https://attacker.example' }, { exp: SECONDS - 60 }, { iat: SECONDS + 60 }, { sub: '' }, { sub: 'bad subject' }, missingExpiry]) {
    await assert.rejects(fixture().verify(credential(await jwt('google', claims))), { status: 401, code: 'SOCIAL_TOKEN_INVALID' });
  }
  const other = await generateKeyPair('RS256');
  await assert.rejects(fixture().verify(credential(await jwt('google', {}, { key: other.privateKey }))), { status: 401, code: 'SOCIAL_TOKEN_INVALID' });
  const secret = new TextEncoder().encode('only-for-hmac-algorithm-confusion-test');
  await assert.rejects(fixture().verify(credential(await jwt('google', {}, { key: secret, alg: 'HS256' }))), { status: 401, code: 'SOCIAL_TOKEN_INVALID' });
});

test('Google email verification is strict boolean and missing email is not fabricated', async () => {
  for (const value of [false, 'true', undefined]) {
    const result = await fixture().verify(credential(await jwt('google', { email_verified: value })));
    assert.equal(result.emailVerified, false);
  }
  const result = await fixture().verify(credential(await jwt('google', { email: undefined, name: '\n' })));
  assert.equal(result.email, null);
  assert.equal(result.emailVerified, false);
  assert.equal(result.username, 'Người dùng Google');
});

test('Google downloads JWKS only from fixed provider endpoint and caches the verified key', async () => {
  const calls = [];
  const verifier = fixture({ googleJwks: undefined, fetchImpl: async (url, options) => {
    calls.push({ url: String(url), options });
    return json({ keys: [jwk] });
  } });
  const input = credential(await jwt());
  await verifier.verify(input);
  await verifier.verify(input);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://www.googleapis.com/oauth2/v3/certs');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(JSON.stringify(calls).includes(input.token), false);
});

test('JWKS/network errors are sanitized and never include input credentials', async () => {
  const token = await jwt();
  const verifier = fixture({ googleJwks: undefined, fetchImpl: async () => { throw new Error(`private upstream URL ${token}`); } });
  await assert.rejects(verifier.verify(credential(token)), error => error.status === 502 && error.code === 'SOCIAL_PROVIDER_ERROR' && !error.message.includes(token));
});

test('Facebook Limited Login verifies RS256, issuer, audience, subject and raw server nonce', async () => {
  const result = await fixture().verify(credential(await jwt('facebook'), 'facebook', { nonce: NONCE }));
  assert.deepEqual(result, { provider: 'facebook', subject: 'facebook-subject', email: 'person@example.com', emailVerified: false, username: 'Người chăm vườn' });
  for (const extra of [{}, { nonce: 'wrong-server-challenge-123456789' }])
    await assert.rejects(fixture().verify(credential(await jwt('facebook'), 'facebook', extra)), { status: 401, code: 'SOCIAL_TOKEN_INVALID' });
  for (const claims of [{ aud: 'another-facebook-app' }, { iss: 'https://limited.facebook.com' }, { exp: SECONDS - 30 }, { sub: '' }, { nonce: undefined }])
    await assert.rejects(fixture().verify(credential(await jwt('facebook', claims), 'facebook', { nonce: NONCE })), { status: 401, code: 'SOCIAL_TOKEN_INVALID' });
});

test('Facebook Limited Login fetches only the fixed Meta public JWKS endpoint', async () => {
  const calls = [];
  const verifier = fixture({ facebookJwks: undefined, fetchImpl: async url => { calls.push(String(url)); return json({ keys: [jwk] }); } });
  await verifier.verify(credential(await jwt('facebook'), 'facebook', { nonce: NONCE }));
  assert.deepEqual(calls, ['https://limited.facebook.com/.well-known/oauth/openid/jwks/']);
});

test('Facebook Android validates app/user binding before requesting profile with app-secret proof', async () => {
  const f = graphFixture();
  assert.deepEqual(await f.verify(), { provider: 'facebook', subject: 'facebook-subject', email: 'person@example.com', emailVerified: false, username: 'Người chăm vườn' });
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].url.href, 'https://graph.facebook.com/v26.0/debug_token?input_token=opaque-user-token');
  assert.equal(f.calls[0].options.headers.authorization, `Bearer ${APP_ID}|${APP_SECRET}`);
  assert.equal(f.calls[1].url.origin, 'https://graph.facebook.com');
  assert.equal(f.calls[1].url.pathname, '/v26.0/me');
  assert.equal(f.calls[1].url.searchParams.get('appsecret_proof'), createHmac('sha256', APP_SECRET).update('opaque-user-token').digest('hex'));
  assert.equal(f.calls[1].options.headers.authorization, 'Bearer opaque-user-token');
  assert.equal(f.calls[1].url.href.includes(APP_SECRET), false);
  assert.equal(f.calls[1].options.redirect, 'error');
});

test('Facebook Android rejects invalid, wrong-app, non-user and expired credentials before profile', async () => {
  for (const debug of [{ is_valid: false }, { is_valid: 'true' }, { app_id: 'wrong-app' }, { type: 'PAGE' }, { user_id: '' }, { expires_at: SECONDS - 1 }, { expires_at: undefined }, { data_access_expires_at: SECONDS - 1 }, { expires_at: '9999999999' }]) {
    const f = graphFixture({ debug });
    await assert.rejects(f.verify(), { status: 401, code: 'SOCIAL_TOKEN_INVALID' });
    assert.equal(f.calls.length, 1);
  }
  await assert.rejects(graphFixture({ profile: { id: 'not-debugged-user' } }).verify(), { status: 401, code: 'SOCIAL_TOKEN_INVALID' });
});

test('Facebook Android allows absent email for an already linked identity, never invents an email', async () => {
  const result = await graphFixture({ profile: { email: undefined, name: 'a' } }).verify();
  assert.equal(result.email, null);
  assert.equal(result.emailVerified, false);
  assert.equal(result.username, 'Người dùng Facebook');
});

test('provider failures, malformed response and large body do not leak upstream details', async () => {
  for (const response of [json({ error: { message: 'private upstream token' } }, 401), json({}, 503), new Response('{not-json'), json({ pad: 'x'.repeat(70_000) })]) {
    const f = graphFixture({ fetchImpl: async () => response });
    await assert.rejects(f.verify(), error => [401, 502].includes(error.status) && !error.message.includes('private upstream'));
  }
  await assert.rejects(graphFixture({ fetchImpl: async () => { throw new Error(APP_SECRET); } }).verify(), { status: 502, code: 'SOCIAL_PROVIDER_ERROR' });
});

test('invalid provider/type/token shape is rejected before provider calls', async () => {
  let calls = 0;
  const verifier = fixture({ fetchImpl: async () => { calls++; throw new Error('never'); } });
  for (const input of [null, {}, credential('x', 'apple'), credential('x', 'google', { tokenType: 'access_token' }), credential('x', 'facebook', { tokenType: 'id_token' }), credential(' '), credential('x'.repeat(13_000))])
    await assert.rejects(verifier.verify(input), { status: 400, code: 'INVALID_AUTH_REQUEST' });
  assert.equal(calls, 0);
  await assert.rejects(fixture({ googleClientIds: [] }).verify(credential('x')), { status: 503, code: 'SOCIAL_PROVIDER_UNAVAILABLE' });
});
