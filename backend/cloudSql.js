/** Lưu bản đồng bộ, ảnh riêng tư và thư/quà trong SQL Server; khóa theo tài khoản và dùng giao dịch cho các cập nhật đồng thời. */
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { ApiError } from './contracts.js';
import { overlayPublisherMail } from './mailbox.js';

const require = createRequire(import.meta.url);
const sql = require('mssql/msnodesqlv8');
const { connectDB } = require('../database/db.js');
const types = { userId: sql.UniqueIdentifier, id: sql.UniqueIdentifier, adminId: sql.UniqueIdentifier,
  requestId: sql.VarChar(128), operation: sql.VarChar(16), digest: sql.Char(64), json: sql.NVarChar(sql.MAX),
  state: sql.NVarChar(sql.MAX), revision: sql.Int, updatedAt: sql.DateTime2(3), mimeType: sql.VarChar(32),
  sha256: sql.Char(64), size: sql.Int, bytes: sql.VarBinary(sql.MAX), search: sql.NVarChar(220), limit: sql.Int,
  title: sql.NVarChar(160), body: sql.NVarChar(4000), attachments: sql.NVarChar(sql.MAX), count: sql.Int,
  readAt: sql.DateTime2(3), claimedAt: sql.DateTime2(3), deletedAt: sql.DateTime2(3) };
const timestamp = value => value ? new Date(value).toISOString() : null;
const active = "IsActive=1 AND DeletedAtUtc IS NULL AND AuthProviderCode IN ('LOCAL','EXTERNAL')";

/** All mutations use a per-owner lock, then snapshot/mailbox locks, in that order. */
export function createSqlCloudRepository({ connect = () => connectDB({ database: process.env.AUTH_DB_NAME?.trim() || undefined }) } = {}) {
  let connection;
  async function pool() {
    if (!connection) connection = connect().then(value => {
      value.on('error', () => { connection = undefined; void value.close().catch(() => {}); });
      return value;
    }).catch(error => { connection = undefined; throw error; });
    return connection;
  }
  function request(tx, values) {
    const req = new sql.Request(tx);
    for (const [key, value] of Object.entries(values)) req.input(key, types[key], value);
    return req;
  }
  async function query(values, text) { return request(await pool(), values).query(text); }
  async function transaction(work) {
    const tx = new sql.Transaction(await pool());
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try { const result = await work(tx); await tx.commit(); return result; }
    catch (error) { await tx.rollback().catch(() => {}); throw error; }
  }
  async function lockOwner(tx, userId) {
    const found = (await request(tx, { userId }).query(`SELECT UserId FROM auth.Users WITH(UPDLOCK,HOLDLOCK) WHERE UserId=@userId AND ${active}`)).recordset[0];
    if (!found) throw new ApiError(401, 'AUTH_REQUIRED', 'Tài khoản không còn hoạt động.');
  }
  async function readRecord(tx, userId) {
    const result = await request(tx, { userId }).query(`SELECT Revision AS revision,StateJson AS state,UpdatedAtUtc AS updatedAt FROM cloud.Snapshots WHERE UserId=@userId;
      SELECT m.MailId AS id,p.PublicationId AS sourceRef,p.Title AS title,p.Body AS body,p.AttachmentsJson AS attachments,
        p.CreatedAtUtc AS createdAt,m.ReadAtUtc AS readAt,m.ClaimedAtUtc AS claimedAt,m.DeletedAtUtc AS deletedAt
      FROM cloud.Mailbox m JOIN cloud.Publications p ON p.PublicationId=m.PublicationId WHERE m.UserId=@userId ORDER BY p.CreatedAtUtc,m.MailId;`);
    const row = result.recordsets[0][0];
    return { revision: row?.revision ?? 0, state: row ? JSON.parse(row.state) : null, updatedAt: timestamp(row?.updatedAt),
      mailbox: result.recordsets[1].map(mail => ({ ...mail, source: 'publisher', id: mail.id.toLowerCase(), sourceRef: mail.sourceRef.toLowerCase(),
        attachments: JSON.parse(mail.attachments), createdAt: timestamp(mail.createdAt), readAt: timestamp(mail.readAt), claimedAt: timestamp(mail.claimedAt), deletedAt: timestamp(mail.deletedAt) })) };
  }
  async function persist(tx, userId, before, after) {
    if (after.revision !== before.revision + 1) throw new Error('Cloud revision must advance exactly once.');
    const values = { userId, state: JSON.stringify(after.state), revision: after.revision, updatedAt: new Date(after.updatedAt) };
    await request(tx, values).query(`
      INSERT cloud.SnapshotHistory(UserId,Revision,StateJson,UpdatedAtUtc)
        SELECT UserId,Revision,StateJson,UpdatedAtUtc FROM cloud.Snapshots WHERE UserId=@userId;
      UPDATE cloud.Snapshots SET Revision=@revision,StateJson=@state,UpdatedAtUtc=@updatedAt WHERE UserId=@userId;
      IF @@ROWCOUNT=0 INSERT cloud.Snapshots(UserId,Revision,StateJson,UpdatedAtUtc) VALUES(@userId,@revision,@state,@updatedAt);
      DELETE cloud.SnapshotHistory WHERE UserId=@userId AND Revision<@revision-10;
      DELETE cloud.Requests WHERE UserId=@userId AND CreatedAtUtc<DATEADD(DAY,-30,SYSUTCDATETIME());`);
    for (const mail of after.mailbox) {
      const previous = before.mailbox.find(entry => entry.id === mail.id);
      if (previous && ['readAt', 'claimedAt', 'deletedAt'].some(key => mail[key] !== previous[key])) {
        await request(tx, { userId, id: mail.id, readAt: mail.readAt ? new Date(mail.readAt) : null,
          claimedAt: mail.claimedAt ? new Date(mail.claimedAt) : null, deletedAt: mail.deletedAt ? new Date(mail.deletedAt) : null })
          .query('UPDATE cloud.Mailbox SET ReadAtUtc=@readAt,ClaimedAtUtc=@claimedAt,DeletedAtUtc=@deletedAt WHERE UserId=@userId AND MailId=@id;');
      }
    }
  }
  return {
    async read(userId) { return transaction(async tx => { await lockOwner(tx, userId); return readRecord(tx, userId); }); },
    async mutate(userId, receipt, reduce) {
      return transaction(async tx => {
        await lockOwner(tx, userId);
        const values = { userId, requestId: receipt.requestId, operation: receipt.operation, digest: receipt.digest };
        const previous = (await request(tx, values).query('SELECT Operation AS operation,RequestDigest AS digest,ResponseJson AS response FROM cloud.Requests WHERE UserId=@userId AND RequestId=@requestId')).recordset[0];
        if (previous) {
          if (previous.digest !== receipt.digest || previous.operation !== receipt.operation) throw new ApiError(409, 'REQUEST_ID_REUSED', 'Mã yêu cầu đã được dùng cho nội dung khác.');
          // Receipts store no duplicate 10 MB snapshot. Replay returns the latest
          // canonical account, never an old balance after another phone progressed.
          const current = await readRecord(tx, userId);
          return { revision: current.revision, state: overlayPublisherMail(current.state, current.mailbox),
            updatedAt: current.updatedAt, mailbox: current.mailbox.filter(mail => !mail.deletedAt).map(({ deletedAt: _deleted, ...mail }) => mail),
            appliedRevision: JSON.parse(previous.response).revision, replayed: true };
        }
        const before = await readRecord(tx, userId);
        const { record: after, response } = await reduce(before);
        await persist(tx, userId, before, after);
        await request(tx, { ...values, json: JSON.stringify({ revision: response.revision, updatedAt: response.updatedAt }) }).query('INSERT cloud.Requests(UserId,RequestId,Operation,RequestDigest,ResponseJson) VALUES(@userId,@requestId,@operation,@digest,@json)');
        return { ...response, appliedRevision: response.revision, replayed: false };
      });
    },
    async assertAssets(userId, ids) {
      if (!ids.length) return;
      // Photos are immutable and never deleted, so this independent read cannot race ownership changes.
      const rows = (await query({ userId, json: JSON.stringify(ids) }, `SELECT AssetId AS id FROM cloud.Assets WHERE UserId=@userId
        AND AssetId IN (SELECT TRY_CONVERT(UNIQUEIDENTIFIER,value) FROM OPENJSON(@json))`)).recordset;
      if (rows.length !== ids.length) throw new ApiError(400, 'ASSET_NOT_FOUND', 'Bản đồng bộ có ảnh chưa tải lên hoặc không thuộc tài khoản này.');
    },
    async putAsset(userId, asset) {
      return transaction(async tx => {
        await lockOwner(tx, userId);
        const previous = (await request(tx, { userId, sha256: asset.sha256 }).query('SELECT AssetId AS id,ContentType AS mimeType,Sha256 AS sha256,ByteLength AS size FROM cloud.Assets WHERE UserId=@userId AND Sha256=@sha256')).recordset[0];
        if (previous) return previous;
        const used = (await request(tx, { userId }).query('SELECT COALESCE(SUM(CAST(ByteLength AS BIGINT)),0) AS bytes,COUNT(*) AS count FROM cloud.Assets WHERE UserId=@userId')).recordset[0];
        if (used.count >= 1500 || Number(used.bytes) + asset.size > 512 * 1024 * 1024) throw new ApiError(413, 'ASSET_QUOTA_EXCEEDED', 'Kho ảnh tài khoản đã đạt giới hạn 512 MB hoặc 1.500 ảnh.');
        const id = randomUUID();
        await request(tx, { userId, id, ...asset }).query('INSERT cloud.Assets(AssetId,UserId,ContentType,Sha256,ByteLength,Content) VALUES(@id,@userId,@mimeType,@sha256,@size,@bytes)');
        return { id, ...asset };
      });
    },
    async getAsset(userId, id) {
      return (await query({ userId, id }, 'SELECT AssetId AS id,ContentType AS mimeType,Sha256 AS sha256,ByteLength AS size,Content AS bytes FROM cloud.Assets WHERE UserId=@userId AND AssetId=@id')).recordset[0];
    },
    async listUsers({ search, limit }) {
      return (await query({ search: `%${search.replace(/[\[\]%_]/g, value => `[${value}]`)}%`, limit }, `SELECT TOP(@limit) u.UserId AS id,u.Email AS email,p.DisplayName AS username
        FROM auth.Users u JOIN app.UserProfiles p ON p.UserId=u.UserId WHERE u.${active.replaceAll(' AND ', ' AND u.')} AND (u.Email LIKE @search OR p.DisplayName LIKE @search) ORDER BY u.CreatedAtUtc,u.UserId`)).recordset;
    },
    async publish(values) {
      return transaction(async tx => {
        const previous = (await request(tx, { adminId: values.adminId, requestId: values.requestId }).query('SELECT PublicationId AS publicationId,RecipientCount AS recipientCount,RequestDigest AS digest FROM cloud.Publications WITH(UPDLOCK,HOLDLOCK) WHERE AdminId=@adminId AND RequestId=@requestId')).recordset[0];
        if (previous) {
          if (previous.digest !== values.digest) throw new ApiError(409, 'REQUEST_ID_REUSED', 'Mã yêu cầu đã được dùng cho nội dung khác.');
          return { publicationId: previous.publicationId, recipientCount: previous.recipientCount, replayed: true };
        }
        const recipients = (await request(tx, { json: JSON.stringify(values.userIds) }).query(`SELECT UserId AS id FROM auth.Users WHERE ${active}
          ${values.target === 'users' ? 'AND UserId IN (SELECT TRY_CONVERT(UNIQUEIDENTIFIER,value) FROM OPENJSON(@json))' : ''}`)).recordset;
        if (!recipients.length || (values.target === 'users' && recipients.length !== values.userIds.length)) throw new ApiError(400, 'RECIPIENT_NOT_FOUND', 'Không tìm thấy đầy đủ người nhận đang hoạt động.');
        const id = randomUUID();
        await request(tx, { id, adminId: values.adminId, requestId: values.requestId, digest: values.digest,
          title: values.title, body: values.body, attachments: JSON.stringify(values.attachments), updatedAt: new Date(values.createdAt), count: recipients.length })
          .query('INSERT cloud.Publications(PublicationId,AdminId,RequestId,RequestDigest,Title,Body,AttachmentsJson,CreatedAtUtc,RecipientCount) VALUES(@id,@adminId,@requestId,@digest,@title,@body,@attachments,@updatedAt,@count)');
        await request(tx, { id, json: JSON.stringify(recipients.map(entry => entry.id)) }).query(`INSERT cloud.Mailbox(MailId,PublicationId,UserId)
          SELECT NEWID(),@id,TRY_CONVERT(UNIQUEIDENTIFIER,value) FROM OPENJSON(@json)`);
        return { publicationId: id, recipientCount: recipients.length, replayed: false };
      });
    },
    async listPublications({ limit }) {
      return (await query({ limit }, 'SELECT TOP(@limit) PublicationId AS id,Title AS title,CreatedAtUtc AS createdAt,RecipientCount AS recipientCount FROM cloud.Publications ORDER BY CreatedAtUtc DESC,PublicationId DESC')).recordset.map(row => ({ ...row, createdAt: timestamp(row.createdAt) }));
    },
    async close() { const value = await connection; connection = undefined; if (value) await value.close(); },
  };
}
