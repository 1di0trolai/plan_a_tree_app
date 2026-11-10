/** Kiểm thử tải ảnh riêng tư lên/xuống, chuẩn hóa định dạng và giới hạn dung lượng với bộ nhớ đệm theo tài khoản. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import type { CloudAssetFiles } from '../src/services/cloudAssets';
const compiled = ts.transpileModule(readFileSync(new URL('../src/services/cloudAssets.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture(remote?: { contentType: string; bytes: number }, encodedLength?: number) {
  const disk = new Map<string, Buffer>([['file:///private/source.png', Buffer.from('pixels')]]);
  const deleted: string[] = []; const moved: string[] = [];
  const converted: string[] = []; let imageReleased = 0; let contextReleased = 0;
  let partial = false;
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) { this.uri = parts.map(part => typeof part === 'string' ? part : part.uri).join('/'); }
    create() {}
  }
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) { this.uri = parts.map(part => typeof part === 'string' ? part : part.uri).join('/'); }
    get exists() { return disk.has(this.uri); }
    get size() { return disk.get(this.uri)?.byteLength ?? 0; }
    get type() { return this.uri.endsWith('.png') ? 'image/png' : this.uri.endsWith('.webp') ? 'image/webp'
      : this.uri.endsWith('.heic') ? 'image/heic' : 'image/jpeg'; }
    base64() { return Promise.resolve(disk.get(this.uri)!.toString('base64')); }
    async write(data: string | Uint8Array, options?: { encoding: string }) {
      disk.set(this.uri, partial ? Buffer.from('x') : typeof data === 'string' ? Buffer.from(data, options?.encoding === 'base64' ? 'base64' : 'utf8') : Buffer.from(data));
    }
    async move(target: File) { disk.set(target.uri, disk.get(this.uri)!); disk.delete(this.uri); moved.push(target.uri); }
    delete() { disk.delete(this.uri); deleted.push(this.uri); }
  }
  const result = {} as { cloudAssetFiles: CloudAssetFiles };
  runInNewContext(compiled, { exports: result, URL, AbortController, setTimeout, clearTimeout,
    fetch: async () => new Response(Buffer.alloc(remote?.bytes ?? 4), { headers: { 'content-type': remote?.contentType ?? 'image/png' } }),
    require: (id: string) => {
      if (id === 'expo-file-system') return { Directory, File, Paths: { document: { uri: 'file:///documents' }, cache: { uri: 'file:///cache' } } };
      if (id === 'expo-image-manipulator') return { SaveFormat: { JPEG: 'jpeg' }, ImageManipulator: { manipulate: (uri: string) => {
        converted.push(uri);
        return { release: () => { contextReleased++; }, renderAsync: async () => ({
          release: () => { imageReleased++; },
          saveAsync: async () => {
            const output = 'file:///cache/converted.jpg'; disk.set(output, Buffer.from('jpeg'));
            return { uri: output, base64: encodedLength ? 'a'.repeat(encodedLength) : Buffer.from('jpeg').toString('base64') };
          },
        }) };
      } } };
      throw new Error(id);
    } });
  return { files: result.cloudAssetFiles, disk, deleted, moved, converted,
    released: () => ({ image: imageReleased, context: contextReleased }), partial: () => { partial = true; } };
}
const user = '11111111-1111-4111-8111-111111111111';
const asset = { assetId: '22222222-2222-4222-8222-222222222222', contentType: 'image/png', dataBase64: Buffer.from('pixels').toString('base64'), size: 6 };

test('private photo upload reads real bytes and never deletes the original', async () => {
  const f = fixture(); const payload = await f.files.read('file:///private/source.png');
  assert.equal(payload.contentType, 'image/png'); assert.equal(payload.dataBase64, asset.dataBase64); assert.deepEqual(f.deleted, []);
  await assert.rejects(f.files.read('http://example.com/photo.png'), /chưa hợp lệ/);
});

test('download cache is account scoped, committed only after complete bytes, and reusable', async () => {
  const f = fixture(); const uri = await f.files.write(user, asset);
  assert.match(uri, /pat-cloud\/11111111-1111-4111-8111-111111111111\/22222222/);
  assert.equal(f.disk.get(uri)?.toString(), 'pixels'); assert.equal(f.moved.length, 1);
  assert.equal(await f.files.write(user, asset), uri); assert.equal(f.moved.length, 1);
});

test('partial downloads keep the old journal untouched and remove only the generated temporary file', async () => {
  const f = fixture(); f.partial(); await assert.rejects(f.files.write(user, asset), /chưa đầy đủ/);
  assert.equal(f.disk.get('file:///private/source.png')?.toString(), 'pixels'); assert.equal(f.moved.length, 0);
  assert.equal(f.deleted.length, 1); assert.match(f.deleted[0], /\.part$/);
});

test('local WebP/HEIC and JPEG/PNG above the server 6 MiB limit normalize into a JPEG upload copy', async () => {
  for (const [extension, bytes] of [['webp', 4], ['heic', 4], ['jpg', 6 * 1024 * 1024 + 1], ['png', 7 * 1024 * 1024]] as const) {
    const f = fixture(); const uri = `file:///private/original.${extension}`; f.disk.set(uri, Buffer.alloc(bytes));
    const payload = await f.files.read(uri);
    assert.equal(payload.contentType, 'image/jpeg'); assert.equal(payload.dataBase64, Buffer.from('jpeg').toString('base64'));
    assert.deepEqual(f.converted, [uri]); assert.equal(f.disk.get(uri)?.byteLength, bytes);
    assert.deepEqual(f.released(), { image: 1, context: 1 }); assert.equal(f.disk.has('file:///cache/converted.jpg'), false);
  }
});

test('remote WebP and oversized JPEG also normalize before upload and remove only disposable caches', async () => {
  for (const remote of [{ contentType: 'image/webp', bytes: 4 }, { contentType: 'image/jpeg', bytes: 7 * 1024 * 1024 }]) {
    const f = fixture(remote); const payload = await f.files.read('https://images.example.com/generated');
    assert.equal(payload.contentType, 'image/jpeg'); assert.equal(f.converted.length, 1);
    assert.equal(f.disk.has('file:///private/source.png'), true);
    assert.equal([...f.disk.keys()].some(key => key.startsWith('file:///cache/')), false);
  }
});

test('normalized base64 cannot exceed the exact 6 MiB server cap', async () => {
  const f = fixture(undefined, 8_388_609); const uri = 'file:///private/original.webp'; f.disk.set(uri, Buffer.from('webp'));
  await assert.rejects(f.files.read(uri), /quá lớn/);
  assert.equal(f.disk.has(uri), true); assert.deepEqual(f.released(), { image: 1, context: 1 });
});
