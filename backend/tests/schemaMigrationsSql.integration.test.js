/** Kiểm thử migration trên SQL Server thật khi được bật rõ ràng; chỉ tạo và xóa database tạm riêng của lần chạy, không sửa dữ liệu PAT. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { applyMigrations, prepareMigrations } from '../schemaMigrations.js';

test('SQL migrations: apply once, reject checksum drift and roll back SQL plus ledger atomically',
  { skip: process.env.PAT_MIGRATION_SQL_SMOKE !== '1' }, async context => {
    const require = createRequire(import.meta.url);
    const { connectDB } = require('../../database/db.js');
    const sql = require('mssql/msnodesqlv8');
    const database = `PAT_MigrationSmoke_${randomUUID().replaceAll('-', '')}`;
    // Chỉ tên do bài kiểm thử sinh mới được dùng trong câu lệnh tạo/xóa database.
    const validateScratchName = () => assert.match(database, /^PAT_MigrationSmoke_[a-f0-9]{32}$/);
    validateScratchName();
    let master, pool, creationAttempted = false, phase = 'create scratch database';
    try {
      master = await connectDB({ database: 'master' });
      // Tạo database có thể cần lâu hơn timeout 15 giây của các truy vấn ứng dụng.
      master.config.requestTimeout = 60000;
      const existing = await master.request().input('database', sql.NVarChar(128), database)
        .query('SELECT DB_ID(@database) AS [id];');
      assert.equal(existing.recordset[0].id, null);
      creationAttempted = true;
      await master.request().query(`CREATE DATABASE [${database}];`);
      pool = await connectDB({ database });
      pool.config.requestTimeout = 60000;
      const identity = await pool.request().query('SELECT DB_NAME() AS [database];');
      assert.equal(identity.recordset[0].database, database);

      const initial = { version: '001', file: '001_probe.sql', source: `
        CREATE TABLE dbo.MigrationProbe (Id INT NOT NULL PRIMARY KEY);
        GO
        INSERT dbo.MigrationProbe(Id) VALUES(1);` };
      const next = { version: '002', file: '002_probe.sql', source: 'INSERT dbo.MigrationProbe(Id) VALUES(2);' };
      const failing = { version: '003', file: '003_fail.sql', source: `
        INSERT dbo.MigrationProbe(Id) VALUES(3);
        THROW 50983, 'PAT migration smoke: deliberate rollback.', 1;` };
      const run = definitions => applyMigrations({ sql, pool, plan: prepareMigrations(definitions) });
      const snapshot = async () => {
        const result = await pool.request().query(`
          SELECT Id FROM dbo.MigrationProbe ORDER BY Id;
          SELECT Version,FileName,Checksum FROM dbo.PatSchemaMigrations ORDER BY Version;`);
        return result.recordsets;
      };

      phase = 'apply first migration';
      assert.deepEqual(await run([initial]), { applied: [initial.file], skipped: [] });
      phase = 'read committed baseline';
      const baseline = await snapshot();
      assert.deepEqual(baseline[0], [{ Id: 1 }]);
      assert.equal(baseline[1].length, 1);
      assert.equal(baseline[1][0].Version, initial.version);
      assert.equal(baseline[1][0].FileName, initial.file);
      assert.equal(baseline[1][0].Checksum, prepareMigrations([initial])[0].checksum);
      // Chạy lại thực thi truy vấn lịch sử thật, bắt được lỗi alias/từ khóa SQL mà mock không phát hiện.
      phase = 'skip already applied migration';
      assert.deepEqual(await run([initial]), { applied: [], skipped: [initial.file] });
      assert.deepEqual(await snapshot(), baseline);

      phase = 'reject changed checksum';
      await assert.rejects(run([{ ...initial, source: `${initial.source}\n-- checksum changed` }, next]),
        { code: 'MIGRATION_CHECKSUM_MISMATCH' });
      assert.deepEqual(await snapshot(), baseline);

      // Migration 002 đã chạy và ghi ledger trong cùng giao dịch trước khi 003 lỗi.
      // Cả bản ghi dữ liệu lẫn ledger của 002/003 phải biến mất sau rollback.
      phase = 'roll back failed migration';
      await assert.rejects(run([initial, next, failing]), /PAT migration smoke: deliberate rollback/);
      assert.deepEqual(await snapshot(), baseline);
      phase = 'apply valid migration after rollback';
      assert.deepEqual(await run([initial, next]), { applied: [next.file], skipped: [initial.file] });
      const recovered = await snapshot();
      assert.deepEqual(recovered[0], [{ Id: 1 }, { Id: 2 }]);
      assert.deepEqual(recovered[1].map(row => row.Version), ['001', '002']);
    } catch (error) {
      context.diagnostic(`Failed phase: ${phase}`);
      throw error;
    } finally {
      try {
        // Trả ngữ cảnh kết nối về master trước khi ODBC trả kết nối xuống pool hệ thống.
        if (pool?.connected) await pool.request().query('USE master;');
        await pool?.close();
        if (creationAttempted) {
          validateScratchName();
          // CREATE có thể hoàn tất trên máy chủ dù client đã timeout; vẫn dọn đúng tên duy nhất đã kiểm tra chưa tồn tại.
          const present = await master.request().input('database', sql.NVarChar(128), database)
            .query('SELECT DB_ID(@database) AS [id];');
          // Không FORCE/SINGLE_USER: không ngắt kết nối khác và không bao giờ nhắm vào database có sẵn.
          if (present.recordset[0].id !== null) await master.request().query(`DROP DATABASE [${database}];`);
          const removed = await master.request().input('database', sql.NVarChar(128), database)
            .query('SELECT DB_ID(@database) AS [id];');
          assert.equal(removed.recordset[0].id, null);
        }
      } finally { await master?.close(); }
    }
  });
