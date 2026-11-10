/** Kiểm thử chặn cấu hình bản dựng không hợp lệ, chỉ chấp nhận địa chỉ HTTPS và không làm lộ giá trị bí mật. */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const { validatePersonalConfig } = require('../build/personalConfig.js') as {
  validatePersonalConfig: (env: Record<string, string>) => void;
};
const valid = { EXPO_PUBLIC_PAT_API_URL: 'https://pat-test.private.ts.net', EXPO_PUBLIC_PAT_API_TOKEN: 'a'.repeat(32) };

test('personal APK guard accepts a private HTTPS origin without returning configuration secrets', () => {
  assert.equal(validatePersonalConfig(valid), undefined);
  assert.equal(validatePersonalConfig({ ...valid, EXPO_PUBLIC_PAT_API_URL: `${valid.EXPO_PUBLIC_PAT_API_URL}/` }), undefined);
});

test('personal APK guard rejects missing, HTTP, loopback and non-origin URLs with safe errors', () => {
  for (const url of ['', 'http://192.168.1.2:3001', 'https://localhost', 'https://dev.localhost', 'https://127.0.0.1',
    'https://[::1]', 'https://[::]', 'https://0.0.0.0', 'https://localhost.', 'https://a.localhost.',
    'https://[::ffff:127.0.0.1]', 'https://[::ffff:0.0.0.0]', 'https://pat.example?', 'https://pat.example#',
    'https://user:do-not-leak@pat.example', 'https://pat.example/api', 'https://pat.example?secret=do-not-leak',
    'https://pat.example#secret']) {
    assert.throws(() => validatePersonalConfig({ ...valid, EXPO_PUBLIC_PAT_API_URL: url }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes('do-not-leak'), false);
      return true;
    });
  }
});

test('personal APK guard rejects short or unsafe header tokens without echoing them', () => {
  for (const token of ['', 'short', 'a'.repeat(23), `a${'b'.repeat(24)} c`, `${'a'.repeat(24)}\nheader`, 'Đ'.repeat(24)])
    assert.throws(() => validatePersonalConfig({ ...valid, EXPO_PUBLIC_PAT_API_TOKEN: token }));
});

test('dynamic config preserves app.json for development and validates personal builds only', () => {
  const source = readFileSync(new URL('../app.config.js', import.meta.url), 'utf8');
  for (const env of [{}, { EAS_BUILD_PROFILE: 'development' }, { ...valid, EAS_BUILD_PROFILE: 'personal' },
    { ...valid, PAT_PERSONAL_BUILD_CHECK: '1' }]) {
    const exports = { exports: undefined as unknown };
    runInNewContext(source, { module: exports, process: { env }, require: () => ({ validatePersonalConfig }) });
    const config = { name: 'PAT', plugins: ['expo-router'], extra: { existing: true } };
    const result = (exports.exports as (input: { config: typeof config }) => unknown)({ config });
    assert.equal(result, config);
    assert.equal(JSON.stringify(result).includes(valid.EXPO_PUBLIC_PAT_API_TOKEN), false);
  }
});
