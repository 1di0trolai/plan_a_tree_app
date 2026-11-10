/** Đối chiếu cấu hình, địa chỉ kết nối, tình trạng API và phiên bản máy chủ; chỉ xuất các trường chẩn đoán không chứa bí mật. */
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'dotenv';
import { runtimeRevision } from './runtime.js';

/** Only deliberately selected non-secret fields may leave this diagnostic. */
export function inspectConfiguration(server, mobile, addresses) {
  const token = server.API_AUTH_TOKEN?.trim();
  const mobileToken = mobile.EXPO_PUBLIC_PAT_API_TOKEN?.trim();
  const host = server.API_HOST?.trim() || '127.0.0.1';
  const port = Number(server.API_PORT || 3001);
  const model = server.GEMINI_MODEL?.trim();
  let endpoint;
  try {
    const url = new URL(mobile.EXPO_PUBLIC_PAT_API_URL?.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw new Error('invalid URL');
    endpoint = { origin: url.origin, hostname: url.hostname, pathname: url.pathname.replace(/\/+$/, '') };
  } catch { /* Never echo a malformed URL: it could contain credentials. */ }
  const localAddresses = [...new Set(addresses)];
  const configured = Boolean(token && server.GEMINI_API_KEY?.trim() && model && /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,100}$/.test(model));
  const validPort = Number.isInteger(port) && port > 0 && port < 65536;
  const lanBinding = !['127.0.0.1', '::1', 'localhost'].includes(host);
  const tokensMatch = Boolean(token && mobileToken && token === mobileToken);
  const phoneUsesLoopback = endpoint && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  const privateIpv4 = endpoint && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(endpoint.hostname);
  return {
    configured,
    validPort,
    lanBinding,
    lanTokenLongEnough: !lanBinding || Boolean(token && token.length >= 24),
    tokensMatch,
    endpoint: endpoint ? `${endpoint.origin}${endpoint.pathname}` : null,
    localHealth: validPort ? `http://127.0.0.1:${port}/api/health` : null,
    phoneUsesLoopback: Boolean(phoneUsesLoopback),
    possibleStaleLanIp: Boolean(privateIpv4 && !localAddresses.includes(endpoint.hostname)),
    localAddresses,
  };
}

export async function checkHealth(url, fetchImpl = fetch) {
  if (!url) return { reachable: false };
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(3500), redirect: 'error' });
    const body = await response.json().catch(() => null);
    return {
      reachable: response.ok && body?.status === 'ok' && body?.provider === 'gemini',
      status: response.status,
      configured: body?.configured === true,
    };
  } catch { return { reachable: false }; }
}

/** The runtime endpoint requires the mobile token. Never report its raw body. */
export async function checkRuntime(endpoint, token, expected, fetchImpl = fetch) {
  if (!endpoint || !token) return { reachable: false };
  try {
    const response = await fetchImpl(`${endpoint}/api/runtime`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3500), redirect: 'error',
    });
    const body = await response.json().catch(() => null);
    const valid = response.ok && body?.provider === 'gemini'
      && typeof body.model === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,100}$/.test(body.model)
      && typeof body.revision === 'string' && /^[a-f0-9]{16}$/.test(body.revision)
      && Number.isInteger(body.timeoutMs);
    if (!valid) return { reachable: false, status: response.status, restartRequired: response.status === 404 };
    const matchesConfiguration = body.model === expected.model && body.timeoutMs === expected.timeoutMs;
    const matchesCode = body.revision === expected.revision;
    return { reachable: true, status: response.status, activeModel: body.model, matchesConfiguration, matchesCode,
      restartRequired: !matchesConfiguration || !matchesCode };
  } catch { return { reachable: false }; }
}

async function main() {
  const readEnv = async (path) => {
    try { return parse(await readFile(path, 'utf8')); }
    catch { return {}; }
  };
  const [server, mobile] = await Promise.all([readEnv('.env'), readEnv('mobile/.env')]);
  const addresses = Object.values(networkInterfaces()).flatMap(entries => (entries ?? [])
    .filter(entry => entry.family === 'IPv4' && !entry.internal).map(entry => entry.address));
  const config = inspectConfiguration(server, mobile, addresses);
  const [local, mobileEndpoint, runtime] = await Promise.all([
    checkHealth(config.localHealth),
    checkHealth(config.endpoint ? `${config.endpoint}/api/health` : null),
    checkRuntime(config.endpoint, mobile.EXPO_PUBLIC_PAT_API_TOKEN?.trim(), {
      model: server.GEMINI_MODEL?.trim(), timeoutMs: Number(server.GEMINI_TIMEOUT_MS || 35000), revision: runtimeRevision(),
    }),
  ]);
  console.log(JSON.stringify({ config, health: { local, mobileEndpoint }, runtime }, null, 2));
  console.log('SQL Server is not required. This check does not call Gemini or validate provider quota.');
  if (!local.reachable) console.log('Start the backend in another terminal: npm run api');
  if (config.possibleStaleLanIp)
    console.log('The mobile API URL is not on an active computer IPv4. A local health response can still succeed on a disconnected adapter; the phone may not reach it. Check EXPO_PUBLIC_PAT_API_URL against localAddresses and use the same Wi-Fi.');
  if (config.phoneUsesLoopback) console.log('A physical phone needs the computer LAN IPv4, not localhost.');
  if (!config.tokensMatch) console.log('Set the same developer token in the root .env and mobile/.env.');
  if (runtime.restartRequired) console.log('The running backend is outdated. In its terminal press Ctrl+C, then run npm run api again.');
  console.log('After changing mobile/.env, restart Expo: npm start -- --clear');
  process.exitCode = config.configured && config.validPort && config.lanTokenLongEnough && config.tokensMatch
    && local.reachable && mobileEndpoint.reachable && runtime.reachable && !runtime.restartRequired ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(() => { console.error('Unable to check AI configuration. No credentials were printed.'); process.exitCode = 1; });
