/** Truy cập SQL Server cho tài khoản, phiên, mã khôi phục và danh tính đăng nhập ngoài; dùng giao dịch để cập nhật thông tin xác thực an toàn. */
import { createRequire } from 'node:module';
import { ApiError } from './contracts.js';

const require = createRequire(import.meta.url);
const sql = require('mssql/msnodesqlv8');
const { connectDB } = require('../database/db.js');

const USER_COLUMNS = 'u.UserId AS id, u.Email AS email, p.DisplayName AS username, CAST(CASE WHEN u.PasswordHash IS NOT NULL THEN 1 ELSE 0 END AS BIT) AS hasPassword';
const ACTIVE_USER = "u.IsActive = 1 AND u.DeletedAtUtc IS NULL AND u.AuthProviderCode IN ('LOCAL','EXTERNAL')";
const LOCAL_USER = `${ACTIVE_USER} AND u.AuthProviderCode = 'LOCAL' AND u.PasswordHash IS NOT NULL`;
const ACTIVE_SESSION = `t.ExpiresAtUtc > SYSUTCDATETIME() AND t.RevokedAtUtc IS NULL AND ${ACTIVE_USER}`;
function parameters(request, values) {
  const types = { email: sql.NVarChar(320), username: sql.NVarChar(80), userId: sql.UniqueIdentifier,
    passwordHash: sql.NVarChar(500), expectedHash: sql.NVarChar(500), tokenHash: sql.Binary(32), currentTokenHash: sql.Binary(32), expiresAt: sql.DateTime2(3),
    provider: sql.VarChar(16), subject: sql.NVarChar(255), emailVerified: sql.Bit };
  for (const [name, value] of Object.entries(values)) request.input(name, types[name], value);
  return request;
}

/** Uses the existing schema. Never creates/resets tables or connects from the phone. */
export function createSqlAuthRepository({ connect = () => connectDB({ database: process.env.AUTH_DB_NAME?.trim() || undefined }) } = {}) {
  let connection;
  let externalSchemaReady = false;
  async function pool() {
    if (!connection) connection = connect().then(value => {
      value.on('error', () => { connection = undefined; void value.close().catch(() => {}); });
      return value;
    }).catch(error => { connection = undefined; throw error; });
    return connection;
  }
  async function query(values, text) { return parameters((await pool()).request(), values).query(text); }
  async function transaction(work) {
    const tx = new sql.Transaction(await pool());
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try { const result = await work(tx); await tx.commit(); return result; }
    catch (error) { await tx.rollback().catch(() => {}); throw error; }
  }
  const request = (tx, values) => parameters(new sql.Request(tx), values);
  async function schemaReady(tx, required = false) {
    if (!externalSchemaReady) externalSchemaReady = Boolean((await request(tx, {}).query("SELECT CAST(CASE WHEN OBJECT_ID(N'auth.ExternalIdentities',N'U') IS NULL THEN 0 ELSE 1 END AS BIT) AS ready")).recordset[0]?.ready);
    if (required && !externalSchemaReady)
      throw new ApiError(503, 'SOCIAL_SCHEMA_REQUIRED', 'Máy chủ cần cập nhật cơ sở dữ liệu để dùng đăng nhập Google và Facebook.');
    return externalSchemaReady;
  }
  async function withProviders(tx, row) {
    if (!row) return undefined;
    const providers = await schemaReady(tx) ? (await request(tx, { userId: row.id }).query('SELECT ProviderCode AS provider FROM auth.ExternalIdentities WHERE UserId=@userId')).recordset.map(value => value.provider) : [];
    return { ...row, hasPassword: Boolean(row.hasPassword), providers };
  }
  const user = async (tx, userId) => withProviders(tx, (await request(tx, { userId }).query(`SELECT ${USER_COLUMNS} FROM auth.Users u JOIN app.UserProfiles p ON p.UserId=u.UserId WHERE u.UserId=@userId AND ${ACTIVE_USER}`)).recordset[0]);
  const issue = (tx, values) => request(tx, values).query(`INSERT auth.RefreshTokens (UserId,TokenHash,ExpiresAtUtc) VALUES (@userId,@tokenHash,@expiresAt);
    UPDATE auth.Users SET LastLoginAtUtc=SYSUTCDATETIME(),UpdatedAtUtc=SYSUTCDATETIME() WHERE UserId=@userId;`);
  return {
    async socialLogin(values) {
      return transaction(async tx => {
        await schemaReady(tx, true);
        const { identity } = values;
        const key = { provider: identity.provider, subject: identity.subject };
        const linked = (await request(tx, key).query(`SELECT UserId AS userId FROM auth.ExternalIdentities WITH (UPDLOCK,HOLDLOCK)
          WHERE ProviderCode=@provider AND ProviderSubject=@subject`)).recordset[0];
        let userId = linked?.userId;
        if (userId) {
          const found = (await request(tx, { userId }).query(`SELECT u.UserId FROM auth.Users u WITH (UPDLOCK,HOLDLOCK) WHERE u.UserId=@userId AND ${ACTIVE_USER}`)).recordset[0];
          if (!found) throw new ApiError(401, 'SOCIAL_TOKEN_INVALID', 'Tài khoản liên kết hiện không thể đăng nhập.');
        } else {
          if (!identity.email || (identity.provider === 'google' && identity.emailVerified !== true))
            throw new ApiError(409, 'SOCIAL_EMAIL_REQUIRED', 'Dịch vụ chưa cung cấp email phù hợp. Hãy tạo hoặc đăng nhập tài khoản PAT bằng email rồi liên kết trong Hồ sơ.');
          const email = identity.email.trim().toLowerCase();
          const conflict = (await request(tx, { email }).query('SELECT UserId FROM auth.Users WITH (UPDLOCK,HOLDLOCK) WHERE NormalizedEmail=UPPER(@email) AND DeletedAtUtc IS NULL')).recordset[0];
          if (conflict) throw new ApiError(409, 'SOCIAL_LINK_REQUIRED', 'Email này đã có tài khoản PAT. Hãy đăng nhập tài khoản đó rồi liên kết Google hoặc Facebook trong Hồ sơ.');
          const cleanName = [...(identity.username || 'Người yêu cây').replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, 40).join('');
          const username = [...cleanName].length >= 2 ? cleanName : 'Người yêu cây';
          userId = (await request(tx, { email, emailVerified: identity.emailVerified === true }).query(`INSERT auth.Users (Email,NormalizedEmail,AuthProviderCode,EmailConfirmedAtUtc)
            OUTPUT inserted.UserId AS userId VALUES (@email,UPPER(@email),'EXTERNAL',CASE WHEN @emailVerified=1 THEN SYSUTCDATETIME() ELSE NULL END)`)).recordset[0].userId;
          await request(tx, { userId, username }).query('INSERT app.UserProfiles (UserId,DisplayName) VALUES (@userId,@username); INSERT app.UserSettings (UserId) VALUES (@userId);');
          await request(tx, { ...key, userId }).query('INSERT auth.ExternalIdentities (UserId,ProviderCode,ProviderSubject) VALUES (@userId,@provider,@subject)');
        }
        await issue(tx, { userId, tokenHash: values.tokenHash, expiresAt: values.expiresAt });
        return user(tx, userId);
      });
    },
    async linkSocialIdentity(values) {
      return transaction(async tx => {
        await schemaReady(tx, true);
        const { identity, userId } = values;
        // Match socialLogin's identity -> user lock order to avoid a login/link deadlock.
        const linked = (await request(tx, { provider: identity.provider, subject: identity.subject }).query(`SELECT UserId AS userId FROM auth.ExternalIdentities WITH (UPDLOCK,HOLDLOCK)
          WHERE ProviderCode=@provider AND ProviderSubject=@subject`)).recordset[0];
        const session = (await request(tx, { userId, currentTokenHash: values.currentTokenHash }).query(`SELECT u.UserId FROM auth.Users u WITH (UPDLOCK,HOLDLOCK)
          JOIN auth.RefreshTokens t ON t.UserId=u.UserId WHERE u.UserId=@userId AND t.TokenHash=@currentTokenHash AND ${ACTIVE_SESSION}`)).recordset[0];
        if (!session) return undefined;
        if (linked && linked.userId.toLowerCase() !== userId.toLowerCase())
          throw new ApiError(409, 'SOCIAL_IDENTITY_IN_USE', 'Tài khoản Google hoặc Facebook này đã liên kết với một tài khoản PAT khác.');
        const existing = (await request(tx, { userId, provider: identity.provider }).query(`SELECT ProviderSubject AS subject FROM auth.ExternalIdentities WITH (UPDLOCK,HOLDLOCK)
          WHERE UserId=@userId AND ProviderCode=@provider`)).recordset[0];
        if (existing && existing.subject !== identity.subject)
          throw new ApiError(409, 'SOCIAL_PROVIDER_ALREADY_LINKED', 'Tài khoản PAT đã liên kết với một tài khoản khác của dịch vụ này.');
        if (!linked) await request(tx, { userId, provider: identity.provider, subject: identity.subject }).query('INSERT auth.ExternalIdentities (UserId,ProviderCode,ProviderSubject) VALUES (@userId,@provider,@subject)');
        return user(tx, userId);
      });
    },
    async register(values) {
      return transaction(async tx => {
        const result = await new sql.Request(tx)
          .input('Email', sql.NVarChar(320), values.email)
          .input('PasswordHash', sql.NVarChar(500), values.passwordHash)
          .input('DisplayName', sql.NVarChar(80), values.username)
          .input('PasswordHashVersion', sql.SmallInt, 1)
          .output('UserId', sql.UniqueIdentifier)
          .execute('auth.usp_RegisterLocalUser');
        const userId = result.output.UserId;
        await issue(tx, { userId, tokenHash: values.tokenHash, expiresAt: values.expiresAt });
        return user(tx, userId);
      });
    },
    async findCredential(email) {
      return (await query({ email }, `SELECT ${USER_COLUMNS},u.PasswordHash AS passwordHash FROM auth.Users u JOIN app.UserProfiles p ON p.UserId=u.UserId
        WHERE u.NormalizedEmail=UPPER(@email) AND ${LOCAL_USER}`)).recordset[0];
    },
    async createPasswordReset(values) {
      return transaction(async tx => {
        // Lock the user first, in the same order as password changes/session creation.
        // Comparing the credential version prevents issuing a token across a password change.
        const found = (await request(tx, { userId: values.userId, expectedHash: values.expectedHash }).query(`SELECT u.UserId FROM auth.Users u WITH (UPDLOCK,HOLDLOCK)
          WHERE u.UserId=@userId AND u.PasswordHash COLLATE Latin1_General_100_BIN2=@expectedHash COLLATE Latin1_General_100_BIN2 AND ${LOCAL_USER}`)).recordset[0];
        if (!found) return false;
        const recent = (await request(tx, { userId: values.userId }).query(`SELECT TOP (1) UserActionTokenId FROM auth.UserActionTokens
          WHERE UserId=@userId AND PurposeCode='RESET_PASSWORD' AND CreatedAtUtc>DATEADD(SECOND,-60,SYSUTCDATETIME())`)).recordset[0];
        if (recent) return false;
        await request(tx, { userId: values.userId, tokenHash: values.tokenHash }).query(`DECLARE @now DATETIME2(3)=SYSUTCDATETIME();
          UPDATE auth.UserActionTokens SET RevokedAtUtc=@now WHERE UserId=@userId AND PurposeCode='RESET_PASSWORD' AND ConsumedAtUtc IS NULL AND RevokedAtUtc IS NULL;
          INSERT auth.UserActionTokens (UserId,PurposeCode,TokenHash,CreatedAtUtc,ExpiresAtUtc) VALUES (@userId,'RESET_PASSWORD',@tokenHash,@now,DATEADD(MINUTE,10,@now));`);
        return true;
      });
    },
    async revokePasswordReset(tokenHash) {
      await query({ tokenHash }, `UPDATE auth.UserActionTokens SET RevokedAtUtc=SYSUTCDATETIME()
        WHERE TokenHash=@tokenHash AND PurposeCode='RESET_PASSWORD' AND ConsumedAtUtc IS NULL AND RevokedAtUtc IS NULL`);
    },
    async resetPassword(values) {
      // This initial read is outside the transaction so no token lock is held when
      // acquiring the user lock. Validity is checked again by the atomic UPDATE below.
      const match = (await query({ tokenHash: values.tokenHash }, `SELECT UserId AS userId FROM auth.UserActionTokens
        WHERE TokenHash=@tokenHash AND PurposeCode='RESET_PASSWORD' AND ConsumedAtUtc IS NULL AND RevokedAtUtc IS NULL AND ExpiresAtUtc>SYSUTCDATETIME()`)).recordset[0];
      if (!match) return false;
      return transaction(async tx => {
        const found = (await request(tx, { userId: match.userId }).query(`SELECT u.UserId FROM auth.Users u WITH (UPDLOCK,HOLDLOCK) WHERE u.UserId=@userId AND ${LOCAL_USER}`)).recordset[0];
        if (!found) return false;
        const consumed = (await request(tx, { userId: match.userId, tokenHash: values.tokenHash }).query(`UPDATE auth.UserActionTokens WITH (UPDLOCK,HOLDLOCK)
          SET ConsumedAtUtc=SYSUTCDATETIME() OUTPUT inserted.UserActionTokenId
          WHERE UserId=@userId AND TokenHash=@tokenHash AND PurposeCode='RESET_PASSWORD' AND ConsumedAtUtc IS NULL AND RevokedAtUtc IS NULL AND ExpiresAtUtc>SYSUTCDATETIME()`)).recordset[0];
        if (!consumed) return false;
        await request(tx, { userId: match.userId, passwordHash: values.passwordHash }).query(`DECLARE @now DATETIME2(3)=SYSUTCDATETIME();
          UPDATE auth.Users SET PasswordHash=@passwordHash,PasswordHashVersion=1,UpdatedAtUtc=@now WHERE UserId=@userId;
          UPDATE auth.RefreshTokens SET RevokedAtUtc=@now WHERE UserId=@userId AND RevokedAtUtc IS NULL;
          UPDATE auth.UserActionTokens SET RevokedAtUtc=@now WHERE UserId=@userId AND PurposeCode='RESET_PASSWORD' AND ConsumedAtUtc IS NULL AND RevokedAtUtc IS NULL;`);
        return true;
      });
    },
    async createSession(values) {
      return transaction(async tx => {
        const found = (await request(tx, { userId: values.userId, expectedHash: values.expectedHash }).query(`SELECT u.UserId FROM auth.Users u WITH (UPDLOCK,HOLDLOCK)
          WHERE u.UserId=@userId AND u.PasswordHash COLLATE Latin1_General_100_BIN2=@expectedHash COLLATE Latin1_General_100_BIN2 AND ${LOCAL_USER}`)).recordset[0];
        if (!found) return undefined;
        await issue(tx, { userId: values.userId, tokenHash: values.tokenHash, expiresAt: values.expiresAt });
        return user(tx, values.userId);
      });
    },
    async getSession(tokenHash) {
      const row = (await query({ tokenHash }, `SELECT ${USER_COLUMNS},t.ExpiresAtUtc AS expiresAt FROM auth.RefreshTokens t
        JOIN auth.Users u ON u.UserId=t.UserId JOIN app.UserProfiles p ON p.UserId=u.UserId WHERE t.TokenHash=@tokenHash AND ${ACTIVE_SESSION}`)).recordset[0];
      if (!row) return undefined;
      const { expiresAt, ...account } = row;
      return { user: await withProviders(await pool(), account), expiresAt };
    },
    async updateProfile(tokenHash, username) {
      return transaction(async tx => {
        const row = (await request(tx, { tokenHash }).query(`SELECT u.UserId AS userId FROM auth.Users u WITH (UPDLOCK,HOLDLOCK)
          JOIN auth.RefreshTokens t ON t.UserId=u.UserId WHERE t.TokenHash=@tokenHash AND ${ACTIVE_SESSION}`)).recordset[0];
        if (!row) return undefined;
        await request(tx, { userId: row.userId, username }).query('UPDATE app.UserProfiles SET DisplayName=@username,UpdatedAtUtc=SYSUTCDATETIME() WHERE UserId=@userId');
        return user(tx, row.userId);
      });
    },
    async changePassword(values) {
      return transaction(async tx => {
        const found = (await request(tx, { userId: values.userId, expectedHash: values.expectedHash, currentTokenHash: values.currentTokenHash }).query(`SELECT u.UserId FROM auth.Users u WITH (UPDLOCK,HOLDLOCK)
          JOIN auth.RefreshTokens t ON t.UserId=u.UserId WHERE u.UserId=@userId AND t.TokenHash=@currentTokenHash AND ${ACTIVE_SESSION}
          AND u.PasswordHash COLLATE Latin1_General_100_BIN2=@expectedHash COLLATE Latin1_General_100_BIN2`)).recordset[0];
        if (!found) return undefined;
        await request(tx, { userId: values.userId, passwordHash: values.passwordHash }).query(`UPDATE auth.Users SET PasswordHash=@passwordHash,PasswordHashVersion=1,UpdatedAtUtc=SYSUTCDATETIME() WHERE UserId=@userId;
          UPDATE auth.RefreshTokens SET RevokedAtUtc=SYSUTCDATETIME() WHERE UserId=@userId AND RevokedAtUtc IS NULL;
          UPDATE auth.UserActionTokens SET RevokedAtUtc=SYSUTCDATETIME() WHERE UserId=@userId AND PurposeCode='RESET_PASSWORD' AND ConsumedAtUtc IS NULL AND RevokedAtUtc IS NULL;`);
        await issue(tx, { userId: values.userId, tokenHash: values.tokenHash, expiresAt: values.expiresAt });
        return user(tx, values.userId);
      });
    },
    async logout(tokenHash) { await query({ tokenHash }, 'UPDATE auth.RefreshTokens SET RevokedAtUtc=SYSUTCDATETIME() WHERE TokenHash=@tokenHash AND RevokedAtUtc IS NULL'); },
    async close() { if (connection) await (await connection).close(); connection = undefined; },
  };
}
