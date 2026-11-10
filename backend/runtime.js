/** Tạo dấu vân tay từ mã máy chủ để phát hiện tiến trình đang chạy bản cũ; không đọc khóa bí mật hay dữ liệu người dùng. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Fingerprint code only, never .env, credentials, photos or user data. The
// authenticated diagnostic can then spot a process left running after edits.
export function runtimeRevision() {
  const hash = createHash('sha256');
  for (const name of ['server.js', 'app.js', 'gemini.js', 'context.js', 'contracts.js', 'runtime.js', 'auth.js', 'authSql.js', 'passwordResetMail.js', 'socialIdentity.js'])
    hash.update(readFileSync(new URL(name, import.meta.url)));
  return hash.digest('hex').slice(0, 16);
}
