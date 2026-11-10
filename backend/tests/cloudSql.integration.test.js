/** Kiểm thử tích hợp SQL cho đồng bộ, chống lặp yêu cầu, cách ly ảnh và nhận quà nguyên tử; chỉ chạy khi bật và dọn dữ liệu tạm. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createCloudService } from '../cloud.js';
import { createSqlCloudRepository } from '../cloudSql.js';

/** Explicit opt-in after migration 08; unique test rows only, removed in finally.
 * Run: $env:PAT_CLOUD_SQL_SMOKE='1'; node --test backend/tests/cloudSql.integration.test.js
 */
test('SQL cloud CAS, receipt replay, photo isolation and atomic publisher gift claim',
  { skip: process.env.PAT_CLOUD_SQL_SMOKE !== '1' }, async () => {
    const require = createRequire(import.meta.url), sql = require('mssql/msnodesqlv8');
    const { connectDB } = require('../../database/db.js');
    const database = process.env.AUTH_DB_NAME?.trim() || process.env.DB_NAME?.trim();
    const user = { id: randomUUID() }, admin = { id: randomUUID() }, email = `pat-cloud-${randomUUID()}@example.invalid`;
    const repository = createSqlCloudRepository({ connect: () => connectDB({ database }) });
    const service = createCloudService({ repository });
    let cleanup;
    try {
      cleanup = await connectDB({ database });
      await cleanup.request().input('id', sql.UniqueIdentifier, user.id).input('email', sql.NVarChar(320), email).query(`
        SET XACT_ABORT ON; BEGIN TRANSACTION;
        INSERT auth.Users(UserId,Email,NormalizedEmail,AuthProviderCode,PasswordHash) VALUES(@id,@email,UPPER(@email),'LOCAL','cloud-test-not-a-login-hash');
        INSERT app.UserProfiles(UserId,DisplayName) VALUES(@id,N'Kiểm tra đồng bộ');
        COMMIT TRANSACTION;`);
      const users = await service.listUsers({ search: email, limit: 10 });
      assert.equal(users.users.length, 1);
      assert.equal(users.users[0].id.toLowerCase(), user.id);
      assert.equal(users.users[0].email, email);
      assert.equal(users.users[0].username, 'Kiểm tra đồng bộ');
      assert.equal(users.nextCursor, null);
      // SQL wildcard characters in search must be literals, not an all-users filter.
      const wildcardSearch = await service.listUsers({ search: '%', limit: 200 });
      assert.equal(wildcardSearch.users.some(entry => entry.id.toLowerCase() === user.id), false);
      const state = { version: 5, profile: { name: 'Kiểm tra', avatarImageUri: null }, plants: [], checkIns: [], plantPhotos: [],
        plantAnalyses: [], plantChibis: [], chatMessages: [], careEvents: [{ id: 'care-1', note: 'Đã tưới' }], dailyRounds: [], dailyPacks: [],
        economy: { gold: 10 }, mailbox: [], activePlantId: '', inventory: { pets: [], items: [{ id: 'berry-bites', quantity: 1 }] },
        settings: {}, daily: {}, battleNotify: false };
      const races = await Promise.allSettled([
        service.saveState(user, { revision: 0, requestId: 'cloud_first_save_1', state }),
        service.saveState(user, { revision: 0, requestId: 'cloud_first_save_2', state }),
      ]);
      assert.equal(races.filter(entry => entry.status === 'fulfilled').length, 1);
      assert.equal(races.find(entry => entry.status === 'rejected').reason.code, 'SYNC_CONFLICT');
      const winning = races[0].status === 'fulfilled' ? 'cloud_first_save_1' : 'cloud_first_save_2';
      const retry = await service.saveState(user, { revision: 0, requestId: winning, state });
      assert.equal(retry.replayed, true); assert.equal(retry.revision, 1); assert.equal(retry.appliedRevision, 1);
      const image = { contentType: 'image/png', dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0X8AAAAASUVORK5CYII=' };
      const asset = await service.uploadAsset(user, image);
      assert.equal((await service.uploadAsset(user, image)).assetId, asset.assetId);
      assert.equal((await service.getAsset(user, asset.assetId)).dataBase64, image.dataBase64);
      await assert.rejects(service.getAsset({ id: randomUUID() }, asset.assetId), { code: 'ASSET_NOT_FOUND' });
      const sent = await service.publishMail(admin, { requestId: 'cloud_publish_smoke', target: 'users', userIds: [user.id], title: 'Thư kiểm tra', body: 'Quà kiểm tra', attachments: [{ kind: 'gold', quantity: 25 }, { kind: 'food', itemId: 'berry-bites', quantity: 2 }] });
      assert.equal(sent.recipientCount, 1);
      const history = await service.listPublications({ limit: 100 });
      const publication = history.publications.find(entry => entry.id.toLowerCase() === sent.publicationId.toLowerCase());
      assert.ok(publication);
      assert.equal(publication.title, 'Thư kiểm tra'); assert.equal(publication.recipientCount, 1);
      assert.ok(Number.isFinite(Date.parse(publication.createdAt)));
      assert.equal((await service.publishMail(admin, { requestId: 'cloud_publish_smoke', target: 'users', userIds: [user.id], title: 'Thư kiểm tra', body: 'Quà kiểm tra', attachments: [{ kind: 'gold', quantity: 25 }, { kind: 'food', itemId: 'berry-bites', quantity: 2 }] })).replayed, true);
      const current = await service.getState(user), mailId = current.mailbox[0].id;
      const claimed = await service.updateMail(user, { revision: 1, requestId: 'cloud_claim_smoke', claimIds: [mailId] });
      assert.equal(claimed.revision, 2); assert.equal(claimed.state.economy.gold, 35);
      assert.equal(claimed.state.inventory.items[0].quantity, 3);
      const replay = await service.updateMail(user, { revision: 1, requestId: 'cloud_claim_smoke', claimIds: [mailId] });
      assert.equal(replay.replayed, true); assert.equal(replay.state.economy.gold, 35);
      const stored = await cleanup.request().input('id', sql.UniqueIdentifier, user.id).query(`
        SELECT StateJson FROM cloud.Snapshots WHERE UserId=@id;
        SELECT COUNT(*) AS count FROM cloud.SnapshotHistory WHERE UserId=@id;
        SELECT ResponseJson FROM cloud.Requests WHERE UserId=@id;`);
      assert.equal(JSON.parse(stored.recordsets[0][0].StateJson).economy.gold, 35);
      assert.equal(stored.recordsets[1][0].count, 1);
      assert.ok(stored.recordsets[2].every(row => !Object.hasOwn(JSON.parse(row.ResponseJson), 'state')));
    } finally {
      if (cleanup) {
        try {
          await cleanup.request().input('id', sql.UniqueIdentifier, user.id).input('admin', sql.UniqueIdentifier, admin.id).input('email', sql.NVarChar(320), email).query(`
            SET XACT_ABORT ON; BEGIN TRANSACTION;
            IF EXISTS(SELECT 1 FROM auth.Users WHERE UserId=@id AND Email=@email) BEGIN
              DELETE cloud.Mailbox WHERE UserId=@id;
              DELETE cloud.Requests WHERE UserId=@id;
              DELETE cloud.SnapshotHistory WHERE UserId=@id;
              DELETE cloud.Snapshots WHERE UserId=@id;
              DELETE cloud.Assets WHERE UserId=@id;
              DELETE app.UserProfiles WHERE UserId=@id;
              DELETE auth.Users WHERE UserId=@id AND Email=@email;
            END;
            DELETE cloud.Publications WHERE AdminId=@admin;
            COMMIT TRANSACTION;`);
          const removed = await cleanup.request().input('id', sql.UniqueIdentifier, user.id).input('admin', sql.UniqueIdentifier, admin.id).query(`
            SELECT (SELECT COUNT(*) FROM auth.Users WHERE UserId=@id)
              +(SELECT COUNT(*) FROM cloud.Snapshots WHERE UserId=@id)
              +(SELECT COUNT(*) FROM cloud.Assets WHERE UserId=@id)
              +(SELECT COUNT(*) FROM cloud.Mailbox WHERE UserId=@id)
              +(SELECT COUNT(*) FROM cloud.Publications WHERE AdminId=@admin) AS remaining;`);
          assert.equal(removed.recordset[0].remaining, 0, 'Temporary cloud SQL test rows must be removed.');
        } finally { await cleanup.close(); }
      }
      await repository.close();
    }
  });
