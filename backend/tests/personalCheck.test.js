/** Kiểm thử công cụ kiểm tra vận hành cá nhân dùng yêu cầu chỉ đọc, SQL tùy chọn và kết quả đã loại bỏ cấu hình nhạy cảm. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkAccountRoute, checkPersonalSql, inspectPersonalReadiness, parsePersonalArgs,
  personalHttpsOrigin, runPersonalCheck } from '../personalCheck.js';

const TOKEN = 'private-token-at-least-24-characters';
const KEY = 'private-gemini-key-do-not-print';
const REVISION = 'abcdef0123456789';
const server = { API_HOST: '127.0.0.1', API_PORT: '3001', API_AUTH_TOKEN: TOKEN,
  GEMINI_API_KEY: KEY, GEMINI_MODEL: 'gemini-test-model', GEMINI_TIMEOUT_MS: '35000',
  DB_NAME: 'PAT', AUTH_DB_NAME: 'PAT_AUTH' };
const mobile = { EXPO_PUBLIC_PAT_API_URL: 'https://private-machine.example.ts.net', EXPO_PUBLIC_PAT_API_TOKEN: TOKEN };

function readyFetch(calls = [], override) {
  return async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.method ?? 'GET', 'GET');
    assert.equal(options.body, undefined);
    assert.equal(options.redirect, 'error');
    const replacement = override?.(url, options);
    if (replacement) return replacement;
    if (url.endsWith('/api/health')) return Response.json({ status: 'ok', provider: 'gemini', configured: true, secret: KEY });
    if (url.endsWith('/api/runtime')) {
      assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
      return Response.json({ provider: 'gemini', model: server.GEMINI_MODEL, timeoutMs: 35000, revision: REVISION, secret: TOKEN });
    }
    assert.ok(url.endsWith('/api/auth/me'));
    assert.equal(options.headers, undefined);
    return Response.json({ error: { code: 'AUTH_REQUIRED', message: 'private SQL/path/email@example.com' } }, { status: 401 });
  };
}
const inspect = options => inspectPersonalReadiness({ server, mobile, revision: REVISION, fetchImpl: readyFetch(), ...options });

test('personal readiness uses GET-only PC checks and never calls SQL, Gemini generation or SMTP by default', async () => {
  const calls = [];
  const result = await inspect({ fetchImpl: readyFetch(calls), connectSql: () => assert.fail('SQL is opt-in') });
  assert.equal(result.ready, true);
  assert.equal(result.smtpConfigured, false);
  assert.deepEqual(result.sql, { requested: false });
  assert.ok(Object.values(result.checks).every(value => value === true));
  assert.equal(calls.length, 6);
  assert.ok(calls.every(call => /\/api\/(health|runtime|auth\/me)$/.test(call.url)));
  assert.ok(result.notes.some(note => note.includes('chưa chứng minh điện thoại/APK')));
  const printed = JSON.stringify(result);
  for (const secret of [TOKEN, KEY, 'private-machine', server.GEMINI_MODEL, 'email@example.com', 'private SQL/path'])
    assert.equal(printed.includes(secret), false);
});

test('strict APK origin permits trusted HTTPS origins but rejects paths, credentials and loopback variants', () => {
  assert.equal(personalHttpsOrigin(' https://private-machine.example.ts.net/ '), 'https://private-machine.example.ts.net');
  assert.equal(personalHttpsOrigin('https://api.example.com:8443'), 'https://api.example.com:8443');
  for (const value of [undefined, 'http://192.168.1.2:3001', 'https://localhost', 'https://sub.localhost',
    'https://localhost.localdomain', 'https://localhost.', 'https://sub.localhost.', 'https://localhost.localdomain.',
    'https://127.1.2.3', 'https://2130706433', 'https://[::1]', 'https://[::]',
    'https://[::ffff:127.0.0.1]', 'https://[::ffff:127.1.2.3]', 'https://[::ffff:0.0.0.0]',
    'https://0.0.0.0', 'https://api.example.com/api', 'https://api.example.com?', 'https://api.example.com#',
    'https://user:private-secret@api.example.com', 'private-secret invalid URL'])
    assert.equal(personalHttpsOrigin(value), null);
});

test('invalid APK URL is not fetched or echoed; a token mismatch/missing key fails readiness', async () => {
  const calls = [];
  const result = await inspect({ server: { ...server, GEMINI_API_KEY: '' },
    mobile: { EXPO_PUBLIC_PAT_API_URL: 'https://private-secret@host.test?key=private-secret', EXPO_PUBLIC_PAT_API_TOKEN: 'mismatch' },
    fetchImpl: readyFetch(calls) });
  assert.equal(result.ready, false);
  assert.equal(result.checks.apkUsesHttpsOrigin, false);
  assert.equal(result.checks.apkTokenMatches, false);
  assert.equal(result.checks.geminiKeyConfigured, false);
  assert.equal(calls.length, 3);
  assert.equal(JSON.stringify(result).includes('private-secret'), false);
});

test('invalid API host/port/model/timeout are safe booleans, never echoed', async () => {
  const result = await inspect({ server: { ...server, API_HOST: 'private-secret/host', API_PORT: 'private-secret',
    GEMINI_MODEL: 'https://private-secret/model', GEMINI_TIMEOUT_MS: 'private-secret' } });
  assert.equal(result.ready, false);
  assert.equal(result.checks.apiHostValid, false);
  assert.equal(result.checks.apiPortValid, false);
  assert.equal(result.checks.geminiModelConfigured, false);
  assert.equal(result.checks.geminiTimeoutValid, false);
  assert.equal(JSON.stringify(result).includes('private-secret'), false);
});

test('APK token must be long printable ASCII without whitespace; unsafe headers are never sent', async () => {
  for (const token of ['short', 'unsafe space token at least 24 chars', 'unsafe\ntoken'.repeat(4), 'TiếngViệt'.repeat(5)]) {
    const calls = [];
    const result = await inspect({ server: { ...server, API_AUTH_TOKEN: token }, mobile: { ...mobile, EXPO_PUBLIC_PAT_API_TOKEN: token },
      fetchImpl: readyFetch(calls, url => url.endsWith('/api/runtime') ? Response.json({}, { status: 401 }) : undefined) });
    assert.equal(result.ready, false);
    assert.equal(result.checks.apiTokenStrongEnough, false);
    if (/[^\x21-\x7E]/.test(token)) assert.equal(calls.some(call => call.url.endsWith('/api/runtime')), false);
    assert.equal(JSON.stringify(result).includes(token), false);
  }
});

test('missing account router or stale authenticated runtime fails readiness with restart hint', async () => {
  const result = await inspect({ fetchImpl: readyFetch([], url => {
    if (url.endsWith('/api/auth/me')) return Response.json({ private: KEY }, { status: 404 });
    if (url.endsWith('/api/runtime')) return Response.json({ provider: 'gemini', model: server.GEMINI_MODEL,
      timeoutMs: 35000, revision: '0000000000000000', private: TOKEN });
  }) });
  assert.equal(result.ready, false);
  assert.equal(result.checks.localAccountRouteReady, false);
  assert.equal(result.checks.localApiCurrent, false);
  assert.ok(result.notes.some(note => note.includes('Ctrl+C')));
});

test('account probe distinguishes auth-required, unavailable and stale responses without a session or body', async () => {
  assert.deepEqual(await checkAccountRoute('https://api.test', readyFetch()), { ready: true, outdated: false, unavailable: false });
  assert.deepEqual(await checkAccountRoute('https://api.test', async () => Response.json({ private: KEY }, { status: 503 })),
    { ready: false, outdated: false, unavailable: true });
  assert.deepEqual(await checkAccountRoute('https://api.test', async () => { throw new Error(KEY); }),
    { ready: false, outdated: false, unavailable: false });
  assert.equal((await checkAccountRoute('https://api.test', async () => Response.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 }))).ready, false);
});

test('network/JSON errors only produce failed checks, never response bodies/errors/secrets', async () => {
  const result = await inspect({ fetchImpl: async url => {
    if (url.endsWith('/api/health')) throw new Error(`private ${KEY} ${TOKEN}`);
    return new Response(`malformed ${KEY} ${TOKEN}`, { status: 500 });
  } });
  assert.equal(result.ready, false);
  assert.equal(result.checks.httpsApiReachable, false);
  assert.equal(JSON.stringify(result).includes(KEY), false);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
});

test('optional SQL check chooses AUTH_DB_NAME and only reads zero rows, closing the pool', async () => {
  let closed = false;
  const result = await inspect({ sql: true, connectSql: async options => {
    assert.deepEqual(options, { database: 'PAT_AUTH' });
    return { request: () => ({ async query(text) {
      assert.match(text, /^SELECT TOP \(0\)/);
      assert.equal(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|EXEC)\b/i.test(text), false);
      return { recordset: [{ private: KEY }] };
    } }), async close() { closed = true; } };
  } });
  assert.equal(result.ready, true);
  assert.equal(closed, true);
  assert.deepEqual(result.sql, { requested: true, connected: true, accountTablesReadable: true });
  assert.equal(JSON.stringify(result).includes(KEY), false);
});

test('optional SQL failures are sanitized and fail readiness without writing anything', async () => {
  let closed = false;
  const result = await inspect({ sql: true, connectSql: async () => ({
    request: () => ({ query: async () => { throw new Error(`SQL credentials ${KEY}`); } }), async close() { closed = true; },
  }) });
  assert.equal(result.ready, false); assert.equal(closed, true);
  assert.deepEqual(result.sql, { requested: true, connected: true, accountTablesReadable: false });
  assert.equal(JSON.stringify(result).includes(KEY), false);
  assert.deepEqual(await checkPersonalSql(server, async () => { throw new Error(TOKEN); }),
    { requested: true, connected: false, accountTablesReadable: false });
});

test('SMTP is configuration-only, optional, and never prints sender/password', async () => {
  const result = await inspect({ server: { ...server, SMTP_USER: 'private-sender@gmail.com', SMTP_PASS: 'private-app-password',
    SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465', SMTP_SECURE: 'true' } });
  assert.equal(result.ready, true); assert.equal(result.smtpConfigured, true);
  assert.equal(JSON.stringify(result).includes('private-sender'), false);
  assert.equal(JSON.stringify(result).includes('private-app-password'), false);
});

test('CLI supports explicit preview env input and shell overrides; invalid args never echoed', async () => {
  assert.deepEqual(parsePersonalArgs(['--mobile-env', 'mobile/.env.preview', '--sql']), { mobileEnvPath: 'mobile/.env.preview', sql: true });
  for (const args of [['private-secret'], ['--mobile-env'], ['--mobile-env', '--sql']])
    assert.throws(() => parsePersonalArgs(args), error => error.message === 'INVALID_ARGUMENTS');
  const paths = [];
  const result = await runPersonalCheck({ args: ['--mobile-env', 'mobile/.env.preview'], env: mobile, root: 'C:/fake-root', revision: REVISION,
    readFileImpl: async path => { paths.push(path); return Object.entries(path.endsWith('.env.preview') ? { ...mobile, EXPO_PUBLIC_PAT_API_URL: 'http://localhost:3001' } : server)
      .map(([key, value]) => `${key}=${value}`).join('\n'); }, fetchImpl: readyFetch() });
  assert.equal(paths.length, 2);
  assert.ok(paths.some(path => path.endsWith('.env.preview')));
  assert.equal(result.ready, true);
});
