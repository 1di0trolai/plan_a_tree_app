/** Kiểm thử sao chép, liệt kê và xóa ảnh kiểm tra riêng tư, không làm mất ảnh gốc khi lưu lỗi. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';

type PhotoModule = {
  persistCheckInPhoto: (uri: string) => Promise<string>;
  withCheckInPhotoReset: <T>(operation: () => Promise<T>) => Promise<T>;
  listCheckInPhotoUris: () => string[];
  deleteCheckInPhoto: (uri: string) => void;
};

// Load the actual adapter, but replace its one native import with an in-memory
// filesystem. Node cannot import Expo native modules; no production test hooks
// or different copy implementation are needed.
const compiled = ts.transpileModule(
  readFileSync(resolve(__dirname, '../src/utils/checkInPhotos.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function mockPhotoFiles(options: { missingAfterCopy?: boolean; partialCopy?: boolean; cleanupThrows?: boolean;
  directoryMissing?: boolean; listingError?: Error } = {}) {
  const original = 'file:///camera/original.jpg';
  const directory = 'file:///documents/pat-check-ins';
  const files = new Map<string, boolean>([[original, true]]);
  const deleted: string[] = [];
  const deleteAttempts: string[] = [];
  const copies: { source: string; target: string }[] = [];
  const directoriesCreated: string[] = [];
  const listed: string[] = [];
  const entries: unknown[] = [];
  const copyControls: { promise: Promise<void>; complete: () => void; fail: (reason: Error) => void }[] = [];
  const deferredCopy = () => {
    let complete!: () => void;
    let fail!: (reason: Error) => void;
    const promise = new Promise<void>((resolveCopy, rejectCopy) => { complete = resolveCopy; fail = rejectCopy; });
    return { promise, complete, fail };
  };

  class MockDirectory {
    uri: string;
    constructor(parent: string, name: string) { this.uri = `${parent}/${name}`; }
    get exists() { return !options.directoryMissing; }
    create() { directoriesCreated.push(this.uri); }
    list() {
      listed.push(this.uri);
      if (options.listingError) throw options.listingError;
      return entries;
    }
  }
  class MockFile {
    uri: string;
    constructor(parent: string | MockDirectory, name?: string) {
      this.uri = name ? `${(parent as MockDirectory).uri}/${name}` : parent as string;
    }
    get extension() { return /\.[a-z0-9]+$/i.exec(this.uri)?.[0] ?? ''; }
    get exists() { return files.get(this.uri) === true; }
    async copy(target: MockFile) {
      const control = deferredCopy();
      copyControls.push(control);
      copies.push({ source: this.uri, target: target.uri });
      if (options.partialCopy) { files.set(target.uri, true); entries.push(target); }
      await control.promise;
      if (!options.missingAfterCopy) {
        files.set(target.uri, true);
        if (!entries.includes(target)) entries.push(target);
      }
    }
    delete() {
      deleteAttempts.push(this.uri);
      if (options.cleanupThrows) throw new Error('Cleanup failed');
      files.delete(this.uri);
      deleted.push(this.uri);
    }
  }

  const exports = {} as PhotoModule;
  runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      assert.equal(name, 'expo-file-system');
      return { Directory: MockDirectory, File: MockFile, Paths: { document: 'file:///documents' } };
    },
  }, { filename: 'checkInPhotos.native-mock.js' });
  return { api: exports, original, directory, files, deleted, deleteAttempts, copies, directoriesCreated, listed, entries,
    complete: (index = 0) => copyControls[index].complete(),
    fail: (reason: Error, index = 0) => copyControls[index].fail(reason),
    file: (uri: string, exists = true) => { files.set(uri, exists); return new MockFile(uri); },
    folder: (name: string) => new MockDirectory(directory, name),
  };
}

test('photo persistence waits for async file copy before returning the private URI', async () => {
  const fs = mockPhotoFiles();
  let settled = false;
  const result = fs.api.persistCheckInPhoto(fs.original).then((uri) => { settled = true; return uri; });
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(settled, false);
  assert.deepEqual(fs.directoriesCreated, [fs.directory]);
  assert.equal(fs.copies.length, 1);
  assert.equal(fs.copies[0].source, fs.original);
  assert.ok(fs.copies[0].target.startsWith(`${fs.directory}/`));
  assert.deepEqual(fs.deleted, []);

  fs.complete();
  const uri = await result;
  assert.equal(uri, fs.copies[0].target);
  assert.equal(fs.files.get(uri), true);
  assert.equal(fs.files.get(fs.original), true);
  assert.deepEqual(fs.deleted, []);
});

test('a rejected copy removes only its partial private destination, never the original', async () => {
  const fs = mockPhotoFiles({ partialCopy: true });
  const result = fs.api.persistCheckInPhoto(fs.original);
  const copyError = new Error('Storage is full');
  const rejected = assert.rejects(result, (error) => error === copyError);
  fs.fail(copyError);
  await rejected;
  assert.deepEqual(fs.deleted, [fs.copies[0].target]);
  assert.equal(fs.files.has(fs.copies[0].target), false);
  assert.equal(fs.files.get(fs.original), true);
});

test('a resolved copy with no destination fails rather than saving a broken image URI', async () => {
  const fs = mockPhotoFiles({ missingAfterCopy: true });
  const result = fs.api.persistCheckInPhoto(fs.original);
  const rejected = assert.rejects(result, /Ảnh chưa được lưu đầy đủ/);
  fs.complete();
  await rejected;
  assert.deepEqual(fs.deleted, []);
  assert.equal(fs.files.get(fs.original), true);
});

test('partial-file cleanup failures do not replace the original async copy error', async () => {
  const fs = mockPhotoFiles({ partialCopy: true, cleanupThrows: true });
  const result = fs.api.persistCheckInPhoto(fs.original);
  const copyError = new Error('Source is no longer available');
  const rejected = assert.rejects(result, (error) => error === copyError);
  fs.fail(copyError);
  await rejected;
  assert.deepEqual(fs.deleteAttempts, [fs.copies[0].target]);
  assert.equal(fs.files.get(fs.original), true);
});

test('photo cleanup rejects original, remote, sibling and traversal paths but accepts its own completed copy', async () => {
  const fs = mockPhotoFiles();
  const result = fs.api.persistCheckInPhoto(fs.original);
  fs.complete();
  const owned = await result;
  for (const uri of [fs.original, 'https://example.com/original.jpg', 'file:///documents/other/123-abc.jpg',
    `${fs.directory}/../original.jpg`, `${fs.directory}/subfolder/123-abc.jpg`, `${fs.directory}/unrelated.jpg`]) {
    fs.files.set(uri, true);
    fs.api.deleteCheckInPhoto(uri);
    assert.equal(fs.files.get(uri), true);
  }
  assert.deepEqual(fs.deleteAttempts, []);
  fs.api.deleteCheckInPhoto(owned);
  assert.deepEqual(fs.deleted, [owned]);
  assert.equal(fs.files.get(fs.original), true);
});

test('photo listing returns only existing flat private File instances with owned generated names', () => {
  const fs = mockPhotoFiles();
  const first = `${fs.directory}/1700000000000-abc123.jpg`;
  const second = `${fs.directory}/123-aB12.PNG`;
  fs.entries.push(fs.file(first), fs.file(second));
  const rejected = [
    fs.original, 'https://example.com/123-abc.jpg', 'file:///documents/other/123-abc.jpg',
    `${fs.directory}-backup/123-abc.jpg`, `${fs.directory}/../123-abc.jpg`,
    `${fs.directory}/subfolder/123-abc.jpg`, `${fs.directory}/unrelated.jpg`,
    `${fs.directory}/123-.jpg`, `${fs.directory}/123-abc`, `${fs.directory}/123-abc..jpg`,
    `${fs.directory}/123-abc%2Ejpg`,
  ];
  fs.entries.push(...rejected.map((uri) => fs.file(uri)), fs.folder('123-looksLikePhoto.jpg'),
    { uri: `${fs.directory}/123-fake.jpg`, exists: true }, fs.file(`${fs.directory}/123-missing.jpg`, false));
  assert.deepEqual(Array.from(fs.api.listCheckInPhotoUris()), [first, second]);
  assert.deepEqual(fs.listed, [fs.directory]);
  assert.deepEqual(fs.directoriesCreated, []);
  assert.equal(fs.copies.length, 0);
  assert.deepEqual(fs.deleteAttempts, []);
  assert.deepEqual(fs.deleted, []);
  assert.equal(fs.files.get(fs.original), true);
  for (const uri of [first, second, ...rejected]) assert.equal(fs.files.get(uri), true);
});

test('photo listing of a missing private directory returns empty without creating or deleting anything', () => {
  const fs = mockPhotoFiles({ directoryMissing: true });
  assert.deepEqual(Array.from(fs.api.listCheckInPhotoUris()), []);
  assert.deepEqual(fs.listed, []);
  assert.deepEqual(fs.directoriesCreated, []);
  assert.deepEqual(fs.deleteAttempts, []);
  assert.equal(fs.files.get(fs.original), true);
});

test('photo listing propagates native errors rather than reporting a successful empty snapshot', () => {
  const listingError = new Error('Private photo folder cannot be listed');
  const fs = mockPhotoFiles({ listingError });
  const owned = `${fs.directory}/1700000000000-abc123.jpg`;
  fs.entries.push(fs.file(owned));
  assert.throws(() => fs.api.listCheckInPhotoUris(), (error) => error === listingError);
  assert.deepEqual(fs.listed, [fs.directory]);
  assert.deepEqual(fs.deleteAttempts, []);
  assert.deepEqual(fs.deleted, []);
  assert.equal(fs.files.get(owned), true);
  assert.equal(fs.files.get(fs.original), true);
});

test('photo reset waits for every native copy before listing and running its operation', async () => {
  const fs = mockPhotoFiles();
  const first = fs.api.persistCheckInPhoto(fs.original);
  const second = fs.api.persistCheckInPhoto(fs.original);
  let operationCalls = 0;
  const reset = fs.api.withCheckInPhotoReset(async () => {
    operationCalls++;
    assert.deepEqual(Array.from(fs.api.listCheckInPhotoUris()).sort(), fs.copies.map((copy) => copy.target).sort());
    return 'reset saved';
  });
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(operationCalls, 0);
  assert.deepEqual(fs.listed, []);

  fs.complete(0);
  await first;
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(operationCalls, 0);
  assert.deepEqual(fs.listed, []);

  fs.complete(1);
  await second;
  assert.equal(await reset, 'reset saved');
  assert.equal(operationCalls, 1);
  assert.equal(fs.files.get(fs.original), true);
  assert.deepEqual(fs.deleteAttempts, []);

  const future = fs.api.persistCheckInPhoto(fs.original);
  fs.complete(2);
  assert.equal(await future, fs.copies[2].target);
});

test('photo reset rejects new copies and concurrent resets until the operation has finished', async () => {
  const fs = mockPhotoFiles();
  let release!: () => void;
  const held = new Promise<void>((resolveOperation) => { release = resolveOperation; });
  let operationStarted = false;
  const reset = fs.api.withCheckInPhotoReset(async () => { operationStarted = true; await held; });
  await assert.rejects(fs.api.persistCheckInPhoto(fs.original), /Đang đặt lại dữ liệu/);
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(operationStarted, true);
  await assert.rejects(fs.api.persistCheckInPhoto(fs.original), /Đang đặt lại dữ liệu/);
  await assert.rejects(fs.api.withCheckInPhotoReset(async () => assert.fail('a second reset must not run')), /Đang đặt lại dữ liệu/);
  assert.equal(fs.copies.length, 0);
  assert.deepEqual(fs.directoriesCreated, []);
  assert.deepEqual(fs.deleteAttempts, []);
  release();
  await reset;

  const future = fs.api.persistCheckInPhoto(fs.original);
  fs.complete();
  assert.equal(await future, fs.copies[0].target);
});

test('photo reset locks immediately while draining an already running copy', async () => {
  const fs = mockPhotoFiles();
  const copy = fs.api.persistCheckInPhoto(fs.original);
  const reset = fs.api.withCheckInPhotoReset(async () => undefined);
  await assert.rejects(fs.api.persistCheckInPhoto(fs.original), /Đang đặt lại dữ liệu/);
  assert.equal(fs.copies.length, 1);
  assert.equal(fs.directoriesCreated.length, 1);
  fs.complete();
  await copy;
  await reset;
});

test('photo reset drains failed native copies and their cleanup before listing', async () => {
  for (const cleanupThrows of [false, true]) {
    const fs = mockPhotoFiles({ partialCopy: true, cleanupThrows });
    const copy = fs.api.persistCheckInPhoto(fs.original);
    const copyError = new Error('Native copy failed');
    const rejected = assert.rejects(copy, (error) => error === copyError);
    let operationCalled = false;
    const reset = fs.api.withCheckInPhotoReset(async () => {
      operationCalled = true;
      assert.deepEqual(fs.deleteAttempts, [fs.copies[0].target]);
      assert.deepEqual(Array.from(fs.api.listCheckInPhotoUris()), cleanupThrows ? [fs.copies[0].target] : []);
    });
    await new Promise<void>((done) => setImmediate(done));
    assert.equal(operationCalled, false);
    fs.fail(copyError);
    await rejected;
    await reset;
    assert.equal(operationCalled, true);
    assert.equal(fs.files.get(fs.original), true);
  }
});

test('failed copy tracking does not create an unhandled rejecting promise', async () => {
  const fs = mockPhotoFiles({ partialCopy: true });
  // Intentionally no caller rejection handler: the adapter's drain observer must
  // not leave either the copy or a rejecting .finally() chain unobserved.
  void fs.api.persistCheckInPhoto(fs.original);
  const reset = fs.api.withCheckInPhotoReset(async () => undefined);
  fs.fail(new Error('Copy was abandoned by a stale screen'));
  await reset;
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(fs.files.get(fs.original), true);
});

test('photo reset releases its lock after synchronous or asynchronous operation failure', async () => {
  for (const failAsynchronously of [false, true]) {
    const fs = mockPhotoFiles();
    const operationError = new Error('Reset could not be saved');
    const reset = fs.api.withCheckInPhotoReset(() => {
      if (failAsynchronously) return Promise.reject(operationError);
      throw operationError;
    });
    await assert.rejects(reset, (error) => error === operationError);
    const future = fs.api.persistCheckInPhoto(fs.original);
    fs.complete();
    assert.equal(await future, fs.copies[0].target);
    assert.equal(await fs.api.withCheckInPhotoReset(async () => 'retry succeeded'), 'retry succeeded');
    assert.equal(fs.files.get(fs.original), true);
  }
});
