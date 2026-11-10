/** Kiểm tra khả năng vận hành cá nhân của cấu hình APK/API, HTTPS và SQL tùy chọn; không gọi Gemini, gửi thư hay sửa dữ liệu. */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'dotenv';
import { checkHealth, checkRuntime, inspectConfiguration } from './diagnostics.js';
import { createPasswordResetMailer } from './passwordResetMail.js';
import { runtimeRevision } from './runtime.js';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const NOTES = [
  'Chỉ kiểm tra từ máy tính: chưa chứng minh điện thoại/APK truy cập được HTTPS. Hãy mở /api/health trên điện thoại khi Tailscale đang kết nối.',
  'Không gọi Gemini, gửi email, đăng ký tài khoản hoặc sửa dữ liệu. Cấu hình đúng chưa xác nhận model/hạn mức Gemini hay SMTP gửi được thư.',
  'URL/token của APK được đóng lúc build; sửa tệp cấu hình không cập nhật APK đã cài. Cần đồng bộ biến môi trường preview trước khi build.',
];

/** Strict origin only. Never return or print an invalid URL, which may contain secrets. */
export function personalHttpsOrigin(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/\.+$/, '');
    // URL canonicalizes IPv4-mapped IPv6 into hex (127/8 => 7f00..7fff).
    const loopback = ['localhost', 'localhost.localdomain', '[::1]', '[::]', '0.0.0.0', '[::ffff:0:0]'].includes(host)
      || host.endsWith('.localhost') || /^127\./.test(host) || /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(host);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/'
      || raw.includes('?') || raw.includes('#') || loopback) return null;
    return url.origin;
  } catch { return null; }
}

/** No bearer, body or credential: recognize the account router without touching SQL. */
export async function checkAccountRoute(origin, fetchImpl = fetch) {
  if (!origin) return { ready: false, outdated: false, unavailable: false };
  try {
    const response = await fetchImpl(`${origin}/api/auth/me`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(3500) });
    const body = await response.json().catch(() => null);
    return { ready: response.status === 401 && body?.error?.code === 'AUTH_REQUIRED',
      outdated: response.status === 404, unavailable: response.status === 503 };
  } catch { return { ready: false, outdated: false, unavailable: false }; }
}

/** Explicit opt-in only; TOP (0) checks schema/access, never returns personal rows. */
export async function checkPersonalSql(server, connect) {
  let pool;
  let connected = false;
  try {
    if (!connect) {
      const require = createRequire(import.meta.url);
      connect = require('../database/db.js').connectDB;
    }
    pool = await connect({ database: server.AUTH_DB_NAME?.trim() || server.DB_NAME?.trim() || undefined });
    connected = true;
    await pool.request().query(`SELECT TOP (0) u.UserId,u.PasswordHash,p.DisplayName,r.TokenHash,a.PurposeCode
      FROM auth.Users u JOIN app.UserProfiles p ON p.UserId=u.UserId
      LEFT JOIN auth.RefreshTokens r ON r.UserId=u.UserId LEFT JOIN auth.UserActionTokens a ON a.UserId=u.UserId;`);
    return { requested: true, connected: true, accountTablesReadable: true };
  } catch { return { requested: true, connected, accountTablesReadable: false }; }
  finally { try { await pool?.close(); } catch { /* Only safe booleans leave this diagnostic. */ } }
}

export async function inspectPersonalReadiness({ server = {}, mobile = {}, sql = false, fetchImpl = fetch,
  connectSql, revision = runtimeRevision() } = {}) {
  const config = inspectConfiguration(server, mobile, []);
  const host = server.API_HOST?.trim() || '127.0.0.1';
  const apiHostValid = host === 'localhost' || Boolean(isIP(host));
  const localHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '[::1]' : isIP(host) === 6 ? `[${host}]` : host;
  const localOrigin = apiHostValid && config.validPort ? `http://${localHost}:${Number(server.API_PORT || 3001)}` : null;
  const endpoint = personalHttpsOrigin(mobile.EXPO_PUBLIC_PAT_API_URL);
  const token = server.API_AUTH_TOKEN?.trim();
  const mobileToken = mobile.EXPO_PUBLIC_PAT_API_TOKEN?.trim();
  const tokenIsHeaderSafe = value => typeof value === 'string' && /^[\x21-\x7E]+$/.test(value);
  const timeoutMs = Number(server.GEMINI_TIMEOUT_MS || 35000);
  const expected = { model: server.GEMINI_MODEL?.trim(), timeoutMs, revision };
  const [localHealth, localRuntime, localAccount, httpsHealth, httpsRuntime, httpsAccount, database] = await Promise.all([
    checkHealth(localOrigin ? `${localOrigin}/api/health` : null, fetchImpl),
    checkRuntime(localOrigin, tokenIsHeaderSafe(token) ? token : undefined, expected, fetchImpl), checkAccountRoute(localOrigin, fetchImpl),
    checkHealth(endpoint ? `${endpoint}/api/health` : null, fetchImpl),
    checkRuntime(endpoint, tokenIsHeaderSafe(mobileToken) ? mobileToken : undefined, expected, fetchImpl), checkAccountRoute(endpoint, fetchImpl),
    sql ? checkPersonalSql(server, connectSql) : Promise.resolve({ requested: false }),
  ]);
  const checks = {
    apiHostValid, apiPortValid: config.validPort,
    geminiKeyConfigured: Boolean(server.GEMINI_API_KEY?.trim()),
    geminiModelConfigured: Boolean(expected.model && /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,100}$/.test(expected.model)),
    geminiTimeoutValid: Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 90000,
    apiTokenStrongEnough: Boolean(token && token.length >= 24 && tokenIsHeaderSafe(token)),
    apkUsesHttpsOrigin: Boolean(endpoint), apkTokenMatches: config.tokensMatch,
    localApiReachable: localHealth.reachable, localAiConfigured: localHealth.configured === true,
    localApiCurrent: localRuntime.reachable && !localRuntime.restartRequired, localAccountRouteReady: localAccount.ready,
    httpsApiReachable: httpsHealth.reachable, httpsAiConfigured: httpsHealth.configured === true,
    httpsApiCurrent: httpsRuntime.reachable && !httpsRuntime.restartRequired, httpsAccountRouteReady: httpsAccount.ready,
  };
  const smtpConfigured = createPasswordResetMailer({ env: server }).configured;
  const notes = [...NOTES];
  if (host === '0.0.0.0' || host === '::') notes.push('Với Tailscale Serve, nên chỉ cho API nghe ở 127.0.0.1 thay vì mọi giao diện mạng.');
  if (!endpoint) notes.push('Đặt URL HTTPS của Serve làm origin, không kèm /api, thông tin đăng nhập, query, fragment hoặc localhost.');
  if (!config.tokensMatch) notes.push('Token mobile/preview phải khớp API_AUTH_TOKEN của máy chủ; không chia sẻ các giá trị này.');
  if (localRuntime.restartRequired || httpsRuntime.restartRequired || localAccount.outdated || httpsAccount.outdated)
    notes.push('API đang chạy có thể là mã cũ. Dừng đúng terminal API bằng Ctrl+C rồi chạy npm run api.');
  if (localAccount.unavailable || httpsAccount.unavailable) notes.push('Dịch vụ tài khoản chưa sẵn sàng; kiểm tra cấu hình API và SQL.');
  if (!smtpConfigured) notes.push('Chưa cấu hình email khôi phục. Đăng nhập/đổi mật khẩu thường vẫn dùng được; không kiểm tra gửi email ở lệnh này.');
  if (!sql) notes.push('SQL chưa được kiểm tra; thêm --sql để chỉ đọc kiểm tra kết nối và bảng tài khoản.');
  return { ready: Object.values(checks).every(Boolean) && (!sql || database.accountTablesReadable), checks, smtpConfigured, sql: database, notes };
}

export function parsePersonalArgs(args) {
  let mobileEnvPath = 'mobile/.env', sql = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--sql') sql = true;
    else if (args[index] === '--mobile-env' && args[index + 1] && !args[index + 1].startsWith('--')) mobileEnvPath = args[++index];
    else throw new Error('INVALID_ARGUMENTS');
  }
  return { mobileEnvPath, sql };
}

export async function runPersonalCheck({ args = process.argv.slice(2), env = process.env, root = PROJECT_ROOT,
  readFileImpl = readFile, fetchImpl = fetch, connectSql, revision } = {}) {
  const options = parsePersonalArgs(args);
  const load = async path => { try { return parse(await readFileImpl(path, 'utf8')); } catch { return {}; } };
  const [serverFile, mobileFile] = await Promise.all([load(resolve(root, '.env')), load(resolve(root, options.mobileEnvPath))]);
  // Match dotenv's normal precedence and allow explicit preview environment values.
  return inspectPersonalReadiness({ server: { ...serverFile, ...env }, mobile: { ...mobileFile, ...env },
    sql: options.sql, fetchImpl, connectSql, revision });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runPersonalCheck().then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ready ? 0 : 1;
  }).catch(() => {
    console.error('Không kiểm tra được cấu hình. Dùng: npm run personal:check -- [--mobile-env mobile/.env] [--sql]. Không in thông tin bí mật.');
    process.exitCode = 1;
  });
}
