/** Tạo tài khoản quản trị đầu tiên qua terminal tương tác, ẩn mật khẩu khi nhập và không ghi thông tin đăng nhập vào tham số lệnh. */
import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createSqlAdminRepository } from './adminSql.js';
import { hashAdminPassword, validateAdminUsername } from './adminAuth.js';

/** Local terminal only: never put credentials in command arguments, env, or logs. */
export async function createFirstAdminInteractive({ input = process.stdin, output = process.stdout, repository = createSqlAdminRepository() } = {}) {
  if (!input.isTTY || !output.isTTY) throw new Error('Hãy chạy lệnh này trong terminal tương tác trên máy chủ.');
  let hidden = false;
  const muted = new Writable({ write(chunk, encoding, done) { if (!hidden) output.write(chunk, encoding); done(); } });
  muted.isTTY = true; muted.columns = output.columns ?? 80;
  const readline = createInterface({ input, output: muted, terminal: true });
  try {
    const username = validateAdminUsername((await readline.question('Tên quản trị: ')).trim());
    output.write('Mật khẩu quản trị (12–128 ký tự, không hiển thị): '); hidden = true;
    const password = await readline.question(''); hidden = false; output.write('\n');
    output.write('Nhập lại mật khẩu: '); hidden = true;
    const repeated = await readline.question(''); hidden = false; output.write('\n');
    if (password !== repeated) throw new Error('Hai mật khẩu chưa khớp. Chưa tạo tài khoản.');
    await repository.createFirstAccount({ username, passwordHash: await hashAdminPassword(password) });
    output.write('Đã tạo quản trị viên. Mở /admin trên địa chỉ HTTPS riêng của máy chủ để đăng nhập.\n');
  } finally { hidden = false; readline.close(); await repository.close?.(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createFirstAdminInteractive().catch(error => { console.error(error?.code === 'ADMIN_EXISTS' || error?.code === 'ADMIN_SCHEMA_REQUIRED' || error?.code?.startsWith('ADMIN_') ? error.message : 'Chưa tạo được quản trị viên. Kiểm tra SQL, chạy bản cập nhật 09 và thử lại trong terminal.'); process.exitCode = 1; });
}
