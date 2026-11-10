/** Kiểm thử migration ngoại tuyến: phân batch, checksum, chạy lặp, khóa đồng thời và rollback; không kết nối database thật. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyMigrations, pendingMigrations, prepareMigrations, splitSqlBatches } from '../schemaMigrations.js';

function plan(sources = ['FIRST', 'SECOND']) {
  return prepareMigrations(sources.map((source, index) => ({
    version: `00${index + 8}`, file: `${index + 8}_change.sql`, source,
  })));
}

/** Mô phỏng ranh giới giao dịch và khóa, không mô phỏng kết quả nghiệp vụ của SQL Server. */
function database() {
  const state = { history: [], changes: [], commits: 0, rollbacks: 0, attempts: [], ledger: false };
  let lock = Promise.resolve();
  class Transaction {
    async begin() { this.pending = []; }
    async acquire() {
      const previous = lock;
      lock = new Promise(resolve => { this.release = resolve; });
      await previous;
      this.history = structuredClone(state.history);
      this.ledger = state.ledger;
    }
    async commit() {
      state.history = this.history;
      state.ledger = this.ledger;
      state.changes.push(...this.pending);
      state.commits++;
      this.release?.();
    }
    async rollback() { state.rollbacks++; this.release?.(); }
  }
  class Request {
    constructor(transaction) { this.transaction = transaction; this.values = {}; }
    input(key, _type, value) { this.values[key] = value; return this; }
    async query(text) {
      const transaction = this.transaction;
      if (text.includes('sp_getapplock')) await transaction.acquire();
      else if (text.includes('CREATE TABLE dbo.PatSchemaMigrations')) transaction.ledger = true;
      else if (/\bFROM\s+dbo\.PatSchemaMigrations\b/i.test(text)) return { recordset: structuredClone(transaction.history) };
      else if (text.includes('INSERT dbo.PatSchemaMigrations')) transaction.history.push({ ...this.values });
      else throw new Error(`Unexpected migration query: ${text}`);
      return { recordset: [] };
    }
    async batch(text) {
      state.attempts.push(text);
      if (text === 'FAIL') throw new Error('Migration failed');
      this.transaction.pending.push(text);
    }
  }
  const sql = { Transaction, Request, ISOLATION_LEVEL: { SERIALIZABLE: 4 },
    VarChar: size => size, NVarChar: size => size, Char: size => size };
  return { state, run: (migrations, verify, beforeApply) => applyMigrations({ sql, pool: {}, plan: migrations, verify, beforeApply }) };
}

test('GO inside strings, quoted identifiers and nested comments is not a batch separator', () => {
  const source = "SELECT N'a\nGO\nb''c';\n/* outer\n/* inner */\nGO\n*/\nSELECT [a\nGO\nb]],c], \"a\nGO\nb\";\nGO -- end\nSELECT 2;\ngo 1\n";
  const batches = splitSqlBatches(source);
  assert.equal(batches.length, 2);
  assert.match(batches[0], /GO\nb''c/);
  assert.equal(batches[1], 'SELECT 2;');
  assert.throws(() => splitSqlBatches('SELECT 1;\nGO 2'), { code: 'MIGRATION_BATCH_REPEAT' });
  assert.throws(() => splitSqlBatches(':r secret.sql'), { code: 'MIGRATION_SQLCMD_UNSUPPORTED' });
  assert.throws(() => splitSqlBatches("SELECT N'unclosed"), { code: 'MIGRATION_SQL_UNTERMINATED' });
});

test('BOM and Windows line endings normalize, while real source changes affect checksum', () => {
  const original = plan(['SELECT 1;\nGO\n'])[0];
  assert.equal(plan(['\uFEFFSELECT 1;\r\nGO\r\n'])[0].checksum, original.checksum);
  assert.notEqual(plan(['SELECT 2;\nGO\n'])[0].checksum, original.checksum);
  assert.throws(() => prepareMigrations([
    { version: '009', file: 'a.sql', source: 'A' }, { version: '008', file: 'b.sql', source: 'B' },
  ]), { code: 'MIGRATION_PLAN_INVALID' });
});

test('first registration applies safe scripts, next run skips every registered migration', async () => {
  const db = database(), migrations = plan();
  assert.deepEqual(await db.run(migrations), { applied: ['8_change.sql', '9_change.sql'], skipped: [] });
  assert.deepEqual(await db.run(migrations), { applied: [], skipped: ['8_change.sql', '9_change.sql'] });
  assert.deepEqual(db.state.changes, ['FIRST', 'SECOND']);
  assert.equal(db.state.history.length, 2);
  assert.equal(db.state.ledger, true);
});

test('checks all registered checksums before executing any new earlier migration', async () => {
  const db = database(), migrations = plan();
  db.state.history = [{ ...migrations[1], checksum: '0'.repeat(64) }];
  await assert.rejects(db.run(migrations), { code: 'MIGRATION_CHECKSUM_MISMATCH' });
  assert.deepEqual(db.state.attempts, []);
  assert.equal(db.state.ledger, false);
  assert.equal(db.state.commits, 0);
  assert.equal(db.state.rollbacks, 1);
  assert.throws(() => pendingMigrations(migrations, [{ version: '999', file: 'future.sql', checksum: 'a' }]),
    { code: 'MIGRATION_UNKNOWN_VERSION' });
});

test('failed later migration rolls back earlier batches and their history, allowing clean retry', async () => {
  const db = database();
  await assert.rejects(db.run(plan(['FIRST', 'FAIL'])), /Migration failed/);
  assert.deepEqual(db.state.changes, []);
  assert.deepEqual(db.state.history, []);
  assert.equal(db.state.ledger, false);
  assert.equal(db.state.rollbacks, 1);
  await db.run(plan());
  assert.deepEqual(db.state.changes, ['FIRST', 'SECOND']);
  assert.equal(db.state.history.length, 2);
});

test('does not insert an older migration before a version already recorded by the database', async () => {
  const db = database(), migrations = plan();
  db.state.history = [{ ...migrations[1] }];
  await assert.rejects(db.run(migrations), { code: 'MIGRATION_OUT_OF_ORDER' });
  assert.deepEqual(db.state.attempts, []);
  assert.equal(db.state.rollbacks, 1);
});

test('account preservation verification runs before commit and can roll back migrations', async () => {
  const db = database();
  await assert.rejects(db.run(plan(), async () => { throw new Error('Account count changed'); }), /Account count changed/);
  assert.deepEqual(db.state.changes, []);
  assert.deepEqual(db.state.history, []);
  assert.equal(db.state.commits, 0);
});

test('captures the account baseline inside the locked transaction before batches, verifies after batches', async () => {
  const db = database();
  let baselineTransaction;
  await db.run(plan(), async (transaction, baseline) => {
    assert.equal(transaction, baselineTransaction);
    assert.equal(baseline, 2);
    assert.deepEqual(transaction.pending, ['FIRST', 'SECOND']);
    assert.equal(db.state.commits, 0);
  }, async transaction => {
    baselineTransaction = transaction;
    assert.ok(transaction.release, 'migration lock must be acquired before capturing the baseline');
    assert.deepEqual(transaction.pending, []);
    return 2;
  });
  assert.equal(db.state.commits, 1);
});

test('failure while capturing baseline rolls back before any migration batch or ledger entry', async () => {
  const db = database();
  let verified = false;
  await assert.rejects(db.run(plan(), async () => { verified = true; },
    async () => { throw new Error('Cannot read accounts'); }), /Cannot read accounts/);
  assert.deepEqual(db.state.attempts, []);
  assert.deepEqual(db.state.history, []);
  assert.equal(db.state.ledger, false);
  assert.equal(db.state.rollbacks, 1);
  assert.equal(verified, false);
});

test('concurrent migration runners serialize and execute each migration only once', async () => {
  const db = database(), migrations = plan();
  const results = await Promise.all([db.run(migrations), db.run(migrations)]);
  assert.equal(results.filter(result => result.applied.length === 2).length, 1);
  assert.equal(results.filter(result => result.skipped.length === 2).length, 1);
  assert.deepEqual(db.state.attempts, ['FIRST', 'SECOND']);
  assert.equal(db.state.history.length, 2);
});

test('current 08/09 migrations prepare as pure T-SQL without opening a SQL connection', async () => {
  const migrations = await Promise.all(['08_cloud_sync.sql', '09_admin_accounts.sql'].map(async (file, index) => ({
    version: `00${index + 8}`, file,
    source: await readFile(new URL(`../../database/${file}`, import.meta.url), 'utf8'),
  })));
  const prepared = prepareMigrations(migrations);
  assert.ok(prepared.every(migration => migration.batches.length > 1 && migration.checksum.length === 64));
});
