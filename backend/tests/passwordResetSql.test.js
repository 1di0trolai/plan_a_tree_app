/** Kiểm thử thứ tự khóa/giao dịch và điều kiện SQL cho khôi phục mật khẩu bằng trình điều khiển giả, không kết nối cơ sở dữ liệu. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Run the real repository against a scripted SQL driver, never a database. This
// verifies transaction/lock order and conditional SQL, not SQL Server semantics.
const source = readFileSync(new URL('../authSql.js', import.meta.url), 'utf8');
function fixture(steps) {
  const queries = [], events = [];
  class Request {
    constructor(tx) { this.tx = tx; this.values = {}; }
    input(name, _type, value) { this.values[name] = value; return this; }
    async query(text) {
      const query = { text, values: this.values, tx: this.tx };
      queries.push(query);
      assert.ok(steps.length, 'unexpected SQL query');
      const next = steps.shift();
      return { recordset: typeof next === 'function' ? next(query) : next };
    }
  }
  class Transaction {
    async begin(level) { events.push(['begin', level]); }
    async commit() { events.push(['commit']); }
    async rollback() { events.push(['rollback']); }
  }
  const sql = { Request, Transaction, NVarChar: value => value, Binary: value => value,
    UniqueIdentifier: 'id', DateTime2: value => value, ISOLATION_LEVEL: { SERIALIZABLE: 'serializable' } };
  const createRepository = new Function('sql', `${source.slice(source.indexOf('const USER_COLUMNS')).replace('export function', 'function')}; return createSqlAuthRepository;`)(sql);
  const repository = createRepository({ connect: async () => ({ on() {}, request: () => new Request(), async close() {} }) });
  return { repository, queries, events, done() { assert.equal(steps.length, 0); } };
}
const values = { userId: '11111111-1111-4111-8111-111111111111', expectedHash: 'scrypt-version-old',
  tokenHash: Buffer.alloc(32, 7), passwordHash: 'scrypt-version-new' };

test('SQL issue locks credential version before tokens and persists a ten-minute hash only', async () => {
  const f = fixture([[{ UserId: values.userId }], [], []]);
  assert.equal(await f.repository.createPasswordReset(values), true);
  assert.deepEqual(f.events, [['begin', 'serializable'], ['commit']]);
  assert.match(f.queries[0].text, /auth\.Users u WITH \(UPDLOCK,HOLDLOCK\)/);
  assert.match(f.queries[0].text, /PasswordHash COLLATE Latin1_General_100_BIN2=@expectedHash/);
  assert.match(f.queries[1].text, /CreatedAtUtc>DATEADD\(SECOND,-60,SYSUTCDATETIME\(\)\)/);
  const insert = f.queries[2];
  assert.match(insert.text, /PurposeCode='RESET_PASSWORD' AND ConsumedAtUtc IS NULL AND RevokedAtUtc IS NULL/);
  assert.match(insert.text, /DATEADD\(MINUTE,10,@now\)/);
  assert.deepEqual(insert.values, { userId: values.userId, tokenHash: values.tokenHash });
  assert.ok(f.queries.every(query => query.tx)); f.done();
});

test('SQL issue cannot cross a password change or bypass durable per-user resend throttle', async () => {
  for (const steps of [[[]], [[{ UserId: values.userId }], [{ UserActionTokenId: 'recent' }]]]) {
    const f = fixture(steps);
    assert.equal(await f.repository.createPasswordReset(values), false);
    assert.equal(f.queries.some(query => /INSERT/.test(query.text)), false);
    assert.deepEqual(f.events, [['begin', 'serializable'], ['commit']]); f.done();
  }
});

test('SQL reset rechecks validity with CAS after locking user, then revokes all old credentials atomically', async () => {
  const f = fixture([[{ userId: values.userId }], [{ UserId: values.userId }], [{ UserActionTokenId: 'consumed' }], []]);
  assert.equal(await f.repository.resetPassword(values), true);
  assert.equal(f.queries[0].tx, undefined);
  assert.match(f.queries[0].text, /PurposeCode='RESET_PASSWORD'/);
  assert.match(f.queries[1].text, /auth\.Users u WITH \(UPDLOCK,HOLDLOCK\)/);
  const consume = f.queries[2];
  assert.match(consume.text, /UPDATE auth\.UserActionTokens WITH \(UPDLOCK,HOLDLOCK\)/);
  assert.match(consume.text, /SET ConsumedAtUtc=SYSUTCDATETIME\(\) OUTPUT inserted\.UserActionTokenId/);
  assert.match(consume.text, /ConsumedAtUtc IS NULL AND RevokedAtUtc IS NULL AND ExpiresAtUtc>SYSUTCDATETIME\(\)/);
  assert.deepEqual(consume.values, { userId: values.userId, tokenHash: values.tokenHash });
  const changes = f.queries[3];
  assert.match(changes.text, /UPDATE auth\.Users SET PasswordHash=@passwordHash,PasswordHashVersion=1/);
  assert.match(changes.text, /UPDATE auth\.RefreshTokens SET RevokedAtUtc=@now WHERE UserId=@userId AND RevokedAtUtc IS NULL/);
  assert.match(changes.text, /UPDATE auth\.UserActionTokens SET RevokedAtUtc=@now/);
  assert.deepEqual(changes.values, { userId: values.userId, passwordHash: values.passwordHash });
  assert.deepEqual(f.events, [['begin', 'serializable'], ['commit']]); f.done();
});

test('SQL unknown/expired/used/inactive reset never updates password or sessions', async () => {
  for (const steps of [[[]], [[{ userId: values.userId }], []], [[{ userId: values.userId }], [{ UserId: values.userId }], []]]) {
    const f = fixture(steps);
    assert.equal(await f.repository.resetPassword(values), false);
    assert.equal(f.queries.some(query => /UPDATE auth\.Users SET PasswordHash/.test(query.text)), false); f.done();
  }
});

test('SQL reset write failure rolls back token consumption together with password/session changes', async () => {
  const f = fixture([[{ userId: values.userId }], [{ UserId: values.userId }], [{ UserActionTokenId: 'consumed' }],
    () => { throw new Error('simulated write failed'); }]);
  await assert.rejects(f.repository.resetPassword(values), { message: 'simulated write failed' });
  assert.deepEqual(f.events, [['begin', 'serializable'], ['rollback']]); f.done();
});

test('SQL delivery failure revokes only the issued unconsumed reset code', async () => {
  const f = fixture([[]]);
  await f.repository.revokePasswordReset(values.tokenHash);
  assert.match(f.queries[0].text, /TokenHash=@tokenHash AND PurposeCode='RESET_PASSWORD' AND ConsumedAtUtc IS NULL AND RevokedAtUtc IS NULL/);
  assert.deepEqual(f.queries[0].values, { tokenHash: values.tokenHash });
  assert.equal(f.queries[0].tx, undefined); f.done();
});
