/** Khởi động API PAT, đọc cấu hình môi trường và kết nối các dịch vụ Gemini, tài khoản, đồng bộ, hòm thư và quản trị. */
import 'dotenv/config';
import { createApp } from './app.js';
import { createGeminiProvider } from './gemini.js';
import { runtimeRevision } from './runtime.js';
import { createAuthService } from './auth.js';
import { createSqlAuthRepository } from './authSql.js';
import { createPasswordResetMailer } from './passwordResetMail.js';
import { createSocialIdentityVerifier } from './socialIdentity.js';
import { createCloudService } from './cloud.js';
import { createSqlCloudRepository } from './cloudSql.js';
import { createAdminService } from './adminAuth.js';
import { createSqlAdminRepository } from './adminSql.js';
import { createAdminHandler } from './adminHttp.js';

const host = process.env.API_HOST?.trim() || '127.0.0.1';
const port = Number(process.env.API_PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_PORT must be 1–65535.');
const token = process.env.API_AUTH_TOKEN?.trim();
const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS || 35000);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 90000) throw new Error('GEMINI_TIMEOUT_MS must be 1000–90000.');
if (!['127.0.0.1', '::1', 'localhost'].includes(host) && (!token || token.length < 24)) throw new Error('LAN binding requires API_AUTH_TOKEN with at least 24 characters. This is developer-only authentication.');
const provider = createGeminiProvider({ key: process.env.GEMINI_API_KEY?.trim(), model: process.env.GEMINI_MODEL?.trim(), timeoutMs,
  onDiagnostic: event => console.info(`[PAT AI] ${JSON.stringify(event)}`),
});
const resetMailer = createPasswordResetMailer();
const socialVerifier = createSocialIdentityVerifier({
  googleClientIds: [process.env.GOOGLE_WEB_CLIENT_ID?.trim() || process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim()].filter(Boolean),
  facebookAppId: process.env.FACEBOOK_APP_ID?.trim() || process.env.EXPO_PUBLIC_FACEBOOK_APP_ID?.trim(),
  facebookAppSecret: process.env.FACEBOOK_APP_SECRET?.trim(),
});
const auth = createAuthService({ repository: createSqlAuthRepository(), resetMailer, socialVerifier,
  onDiagnostic: event => console.warn(`[PAT Account] ${JSON.stringify(event)}`),
});
const cloudRepository = createSqlCloudRepository();
const cloud = createCloudService({ repository: cloudRepository });
const adminRepository = createSqlAdminRepository();
const admin = createAdminService({ repository: adminRepository, cloud });
const adminOrigins = [...new Set([
  `http://localhost:${port}`, `http://127.0.0.1:${port}`,
  ...(process.env.ADMIN_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean) ?? []),
])];
const adminHandler = createAdminHandler({ service: admin, origins: adminOrigins });
const app = createApp({ provider, token, auth, cloud, adminHandler, runtime: {
  model: process.env.GEMINI_MODEL?.trim(), timeoutMs, revision: runtimeRevision(),
} });
app.requestTimeout = 45000;
app.headersTimeout = 15000;
app.keepAliveTimeout = 5000;
app.listen(port, host, () => {
  console.log(`PAT API listening on ${host}:${port}; Gemini ${provider && token ? 'configured' : 'not configured'}.`);
  console.log('Accounts, cloud saves, private photos and mailbox require SQL Server. Use HTTPS outside a trusted local network.');
  console.log(`Password recovery email ${resetMailer.configured ? 'configured' : 'not configured'}.`);
  console.log(`Social login configured: Google ${socialVerifier.availability().google ? 'yes' : 'no'}, Facebook ${socialVerifier.availability().facebook ? 'yes' : 'no'}.`);
  console.log('Private admin console: /admin (create a separate account with npm run admin:create).');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close(async () => {
  await Promise.allSettled([auth.close(), cloudRepository.close(), adminRepository.close()]);
  process.exit(0);
}));
