/** Áp dụng các bản cập nhật bổ sung bảng đồng bộ/quản trị cho SQL Server, có tùy chọn sao lưu và không đặt lại tài khoản hiện có. */
import 'dotenv/config';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigrations, prepareMigrations } from './schemaMigrations.js';

const require = createRequire(import.meta.url);
const sql = require('mssql/msnodesqlv8');
const { connectDB } = require('../database/db.js');
const migrations = [
  { version: '008', file: '08_cloud_sync.sql' },
  { version: '009', file: '09_admin_accounts.sql' },
];

/** Additive migrations only. Never run base schema/seed or reset an existing account. */
export async function setupServerData({ backup = false } = {}) {
  const plan = prepareMigrations(await Promise.all(migrations.map(async migration => ({
    ...migration, source: await readFile(new URL(`../database/${migration.file}`, import.meta.url), 'utf8'),
  }))));
  const pool = await connectDB({ database: process.env.AUTH_DB_NAME?.trim() || undefined });
  try {
    const before = (await pool.request().query(`
      IF OBJECT_ID(N'auth.Users', N'U') IS NULL THROW 50981, 'Missing PAT account schema.', 1;
      SELECT DB_NAME() AS databaseName;`)).recordset[0];
    let backupFile = null;
    if (backup) {
      const directory = (await pool.request().query("SELECT CAST(SERVERPROPERTY('InstanceDefaultBackupPath') AS NVARCHAR(4000)) AS directory")).recordset[0]?.directory;
      if (!directory) throw new Error('Chưa xác định được thư mục sao lưu SQL Server.');
      const safeName = before.databaseName.replace(/[^A-Za-z0-9_-]/g, '_');
      backupFile = path.win32.join(directory, `${safeName}-before-cloud-${randomUUID()}.bak`);
      const request = pool.request().input('backupFile', sql.NVarChar(4000), backupFile);
      request.timeout = 120000;
      await request.query(`DECLARE @command NVARCHAR(MAX) = N'BACKUP DATABASE ' + QUOTENAME(DB_NAME()) + N' TO DISK=@file WITH COPY_ONLY, CHECKSUM';
        EXEC sys.sp_executesql @command, N'@file NVARCHAR(4000)', @file=@backupFile;
        RESTORE VERIFYONLY FROM DISK=@backupFile WITH CHECKSUM;`);
    }
    const result = await applyMigrations({ sql, pool, plan,
      beforeApply: async transaction => (await new sql.Request(transaction)
        .query('SELECT COUNT_BIG(*) AS users FROM auth.Users;')).recordset[0].users,
      verify: async (transaction, expectedUsers) => {
        const after = (await new sql.Request(transaction).query('SELECT COUNT_BIG(*) AS users FROM auth.Users;')).recordset[0];
        if (String(after.users) !== String(expectedUsers)) throw new Error('Số tài khoản đã thay đổi ngoài dự kiến; đã hủy giao dịch cập nhật.');
      },
    });
    return { ready: true, database: before.databaseName, migrations: plan.map(migration => migration.file),
      ...result, accountRowsPreserved: true, backupFile };
  } finally { await pool.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(value => value !== '--backup')) { console.error('Dùng: npm run server:setup -- [--backup]'); process.exitCode = 1; }
  else setupServerData({ backup: args.includes('--backup') }).then(value => console.log(JSON.stringify(value, null, 2)))
    .catch(error => {
      console.error(error?.name === 'MigrationError' ? `${error.code}: ${error.message}`
        : 'Chưa cập nhật được SQL. Kiểm tra kết nối/quyền SQL và bản sao lưu; giao dịch chưa hoàn tất được hủy.');
      process.exitCode = 1;
    });
}
