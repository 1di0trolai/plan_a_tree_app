/** Lưu tài khoản, phiên và nhật ký thao tác quản trị trong SQL Server bằng truy vấn có tham số. */
import { createRequire } from 'node:module';
import { ApiError } from './contracts.js';
const require = createRequire(import.meta.url);
const sql = require('mssql/msnodesqlv8');
const { connectDB } = require('../database/db.js');

export function createSqlAdminRepository({ connect = () => connectDB({ database: process.env.AUTH_DB_NAME?.trim() || undefined }) } = {}) {
  let connection;
  async function pool() {
    if (!connection) connection = connect().then(value => {
      value.on('error', () => { connection = undefined; void value.close().catch(() => {}); });
      return value;
    }).catch(error => { connection = undefined; throw error; });
    return connection;
  }
  function request(source, values = {}) {
    const types = { username: sql.NVarChar(80), normalized: sql.NVarChar(80), passwordHash: sql.VarChar(500), expectedHash: sql.VarChar(500),
      adminId: sql.UniqueIdentifier, tokenHash: sql.Binary(32), expiresAt: sql.DateTime2(3) };
    const result = new sql.Request(source);
    for (const [key, value] of Object.entries(values)) result.input(key, types[key], value);
    return result;
  }
  async function ready(source) {
    const row = (await request(source).query("SELECT OBJECT_ID(N'admin.Accounts',N'U') AS accounts,OBJECT_ID(N'admin.Sessions',N'U') AS sessions,OBJECT_ID(N'admin.Audit',N'U') AS audit")).recordset[0];
    if (!row?.accounts || !row.sessions || !row.audit)
      throw new ApiError(503, 'ADMIN_SCHEMA_REQUIRED', 'Máy chủ cần cập nhật bảng quản trị trước khi sử dụng.');
  }
  async function query(values, text) { const source = await pool(); await ready(source); return request(source, values).query(text); }
  async function transaction(work) {
    const source = await pool(); await ready(source);
    const tx = new sql.Transaction(source); await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try { const result = await work(tx); await tx.commit(); return result; }
    catch (error) { await tx.rollback().catch(() => {}); throw error; }
  }
  const active = 'a.IsActive=1 AND s.RevokedAtUtc IS NULL AND s.ExpiresAtUtc>SYSUTCDATETIME()';
  return {
    async createFirstAccount({ username, passwordHash }) {
      return transaction(async tx => {
        const existing = (await request(tx).query('SELECT TOP(1) AdminId FROM admin.Accounts WITH(UPDLOCK,HOLDLOCK)')).recordset[0];
        if (existing) throw new ApiError(409, 'ADMIN_EXISTS', 'Đã có tài khoản quản trị. Đăng nhập trên web để tiếp tục.');
        return (await request(tx, { username, normalized: username.toUpperCase(), passwordHash }).query('INSERT admin.Accounts(Username,NormalizedUsername,PasswordHash) OUTPUT inserted.AdminId AS id,inserted.Username AS username VALUES(@username,@normalized,@passwordHash)')).recordset[0];
      });
    },
    async findAccount(normalized) { return (await query({ normalized }, 'SELECT AdminId AS id,Username AS username,PasswordHash AS passwordHash,IsActive AS active FROM admin.Accounts WHERE NormalizedUsername=@normalized')).recordset[0]; },
    async createSession(values) {
      return transaction(async tx => {
        const account = (await request(tx, values).query('SELECT AdminId FROM admin.Accounts WITH(UPDLOCK,HOLDLOCK) WHERE AdminId=@adminId AND IsActive=1 AND PasswordHash COLLATE Latin1_General_100_BIN2=@expectedHash COLLATE Latin1_General_100_BIN2')).recordset[0];
        if (!account) return false;
        await request(tx, values).query("DELETE admin.Sessions WHERE ExpiresAtUtc<DATEADD(DAY,-7,SYSUTCDATETIME()); INSERT admin.Sessions(AdminId,TokenHash,ExpiresAtUtc) VALUES(@adminId,@tokenHash,@expiresAt); INSERT admin.Audit(AdminId,ActionCode) VALUES(@adminId,'LOGIN');");
        return true;
      });
    },
    async getSession(tokenHash) { return (await query({ tokenHash }, `SELECT a.AdminId AS id,a.Username AS username,s.ExpiresAtUtc AS expiresAt FROM admin.Sessions s JOIN admin.Accounts a ON a.AdminId=s.AdminId WHERE s.TokenHash=@tokenHash AND ${active}`)).recordset[0]; },
    async revokeSession(tokenHash, adminId) { await query({ tokenHash, adminId }, "UPDATE admin.Sessions SET RevokedAtUtc=SYSUTCDATETIME() WHERE TokenHash=@tokenHash AND AdminId=@adminId AND RevokedAtUtc IS NULL; INSERT admin.Audit(AdminId,ActionCode) VALUES(@adminId,'LOGOUT');"); },
    async changePassword(values) {
      return transaction(async tx => {
        const found = (await request(tx, values).query(`SELECT a.AdminId FROM admin.Accounts a WITH(UPDLOCK,HOLDLOCK) JOIN admin.Sessions s ON s.AdminId=a.AdminId WHERE a.AdminId=@adminId AND a.PasswordHash COLLATE Latin1_General_100_BIN2=@expectedHash COLLATE Latin1_General_100_BIN2 AND s.TokenHash=@tokenHash AND ${active}`)).recordset[0];
        if (!found) return false;
        await request(tx, values).query("UPDATE admin.Accounts SET PasswordHash=@passwordHash,UpdatedAtUtc=SYSUTCDATETIME() WHERE AdminId=@adminId; UPDATE admin.Sessions SET RevokedAtUtc=SYSUTCDATETIME() WHERE AdminId=@adminId AND RevokedAtUtc IS NULL; INSERT admin.Audit(AdminId,ActionCode) VALUES(@adminId,'PASSWORD_CHANGED');");
        return true;
      });
    },
    async close() { const source = connection && await connection; connection = undefined; if (source) await source.close(); },
  };
}
