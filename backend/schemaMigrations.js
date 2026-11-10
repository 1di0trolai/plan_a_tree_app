/** Chuẩn bị và áp dụng migration SQL theo phiên bản/checksum; khóa đồng thời và ghi lịch sử trong cùng giao dịch. */
import { createHash } from 'node:crypto';

export class MigrationError extends Error {
  constructor(code, message) { super(message); this.name = 'MigrationError'; this.code = code; }
}

function normalizeSource(source) { return source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'); }

/** Chỉ tách GO ở ngoài chuỗi, tên định danh và chú thích; không thực thi lệnh SQLCMD hoặc GO lặp. */
export function splitSqlBatches(source) {
  const batches = [], current = [];
  let quote = null, commentDepth = 0;
  for (const line of normalizeSource(source).split('\n')) {
    if (!quote && !commentDepth) {
      const separator = /^\s*GO(?:\s+(\d+))?\s*(?:--.*)?$/i.exec(line);
      if (separator) {
        if (separator[1] && separator[1] !== '1')
          throw new MigrationError('MIGRATION_BATCH_REPEAT', 'Migration không hỗ trợ GO lặp; hãy viết rõ từng batch.');
        if (current.join('\n').trim()) batches.push(current.join('\n'));
        current.length = 0;
        continue;
      }
      if (/^\s*[:!]/.test(line))
        throw new MigrationError('MIGRATION_SQLCMD_UNSUPPORTED', 'Migration phải là T-SQL thuần, không chứa chỉ thị SQLCMD.');
    }
    current.push(line);
    for (let index = 0; index < line.length; index++) {
      const char = line[index], next = line[index + 1];
      if (commentDepth) {
        if (char === '/' && next === '*') { commentDepth++; index++; }
        else if (char === '*' && next === '/') { commentDepth--; index++; }
      } else if (quote) {
        const end = quote === '[' ? ']' : quote;
        if (char === end) {
          if (next === end) index++;
          else quote = null;
        }
      } else if (char === '-' && next === '-') break;
      else if (char === '/' && next === '*') { commentDepth++; index++; }
      else if (char === "'" || char === '"' || char === '[') quote = char;
    }
  }
  if (quote || commentDepth)
    throw new MigrationError('MIGRATION_SQL_UNTERMINATED', 'Migration có chuỗi, định danh hoặc chú thích chưa đóng.');
  if (current.join('\n').trim()) batches.push(current.join('\n'));
  return batches;
}

/** Chuẩn bị mọi nguồn trước khi kết nối SQL; khác biệt BOM/CRLF không làm sai checksum khi đổi máy. */
export function prepareMigrations(definitions) {
  const versions = new Set();
  let previous = -1n;
  return definitions.map(({ version, file, source }) => {
    if (!/^\d{3,32}$/.test(version) || versions.has(version) || BigInt(version) <= previous
      || typeof file !== 'string' || !file || file.length > 260 || typeof source !== 'string')
      throw new MigrationError('MIGRATION_PLAN_INVALID', 'Danh sách migration phải có phiên bản duy nhất và tăng dần.');
    versions.add(version); previous = BigInt(version);
    const normalized = normalizeSource(source), batches = splitSqlBatches(normalized);
    if (!batches.length)
      throw new MigrationError('MIGRATION_PLAN_INVALID', `Migration ${version} không có nội dung.`);
    return { version, file, batches, checksum: createHash('sha256').update(normalized, 'utf8').digest('hex') };
  });
}

/** Kiểm toàn bộ lịch sử trước batch cập nhật đầu tiên, kể cả migration mới đứng trước file bị sửa. */
export function pendingMigrations(plan, history) {
  const known = new Map(plan.map(migration => [migration.version, migration]));
  const applied = new Set();
  for (const row of history) {
    const migration = known.get(row.version);
    if (!migration)
      throw new MigrationError('MIGRATION_UNKNOWN_VERSION', `Database có migration ${row.version} mà bộ mã nguồn này chưa biết.`);
    if (migration.checksum !== row.checksum || migration.file !== row.file || applied.has(row.version))
      throw new MigrationError('MIGRATION_CHECKSUM_MISMATCH', `Migration ${row.version} đã thay đổi sau khi áp dụng. Giữ nguyên file cũ và tạo phiên bản mới.`);
    applied.add(row.version);
  }
  let gap = false;
  for (const migration of plan) {
    if (!applied.has(migration.version)) gap = true;
    else if (gap)
      throw new MigrationError('MIGRATION_OUT_OF_ORDER', 'Lịch sử migration bị thiếu phiên bản trước; hãy thêm thay đổi bằng phiên bản mới sau cùng.');
  }
  return plan.filter(migration => !applied.has(migration.version));
}

const lockSql = `
  SET XACT_ABORT ON;
  DECLARE @lockResult INT;
  EXEC @lockResult = sys.sp_getapplock @Resource=N'PAT:server-data:migrations',
    @LockMode=N'Exclusive', @LockOwner=N'Transaction', @LockTimeout=10000;
  IF @lockResult < 0 THROW 50982, 'Cannot acquire PAT migration lock.', 1;`;

const ledgerSql = `
  IF OBJECT_ID(N'dbo.PatSchemaMigrations', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.PatSchemaMigrations (
      Version VARCHAR(32) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT PK_PatSchemaMigrations PRIMARY KEY,
      FileName NVARCHAR(260) NOT NULL,
      Checksum CHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
      AppliedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_PatSchemaMigrations_Applied DEFAULT SYSUTCDATETIME()
    );
  END;`;

/** Toàn bộ batch và ledger cùng commit hoặc rollback; khóa được giữ tới khi kết thúc giao dịch. */
export async function applyMigrations({ sql, pool, plan, beforeApply = async () => {}, verify = async () => {} }) {
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    await new sql.Request(transaction).query(lockSql);
    await new sql.Request(transaction).query(ledgerSql);
    const history = (await new sql.Request(transaction).query(`
      SELECT Version AS [version], FileName AS [file], Checksum AS [checksum]
      FROM dbo.PatSchemaMigrations WITH (UPDLOCK, HOLDLOCK) ORDER BY Version;`)).recordset;
    const pending = pendingMigrations(plan, history);
    const baseline = await beforeApply(transaction);
    for (const migration of pending) {
      for (const batch of migration.batches) await new sql.Request(transaction).batch(batch);
      await new sql.Request(transaction)
        .input('version', sql.VarChar(32), migration.version)
        .input('file', sql.NVarChar(260), migration.file)
        .input('checksum', sql.Char(64), migration.checksum)
        .query('INSERT dbo.PatSchemaMigrations(Version,FileName,Checksum) VALUES(@version,@file,@checksum);');
    }
    await verify(transaction, baseline);
    await transaction.commit();
    const applied = new Set(pending.map(migration => migration.version));
    return {
      applied: pending.map(migration => migration.file),
      skipped: plan.filter(migration => !applied.has(migration.version)).map(migration => migration.file),
    };
  } catch (error) {
    await transaction.rollback().catch(() => {});
    throw error;
  }
}
