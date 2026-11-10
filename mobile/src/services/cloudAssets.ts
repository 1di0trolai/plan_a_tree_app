/** Đọc, nén và mã hóa ảnh để đồng bộ; ghi ảnh tải về vào thư mục riêng theo tài khoản và kiểm tra định dạng, kích thước tệp. */

import { Directory, File, Paths } from 'expo-file-system';
import type { CloudAsset } from './cloudSync';

export interface CloudAssetFiles {
  read(uri: string): Promise<{ contentType: string; dataBase64: string }>;
  exists(uri: string): boolean;
  write(userId: string, asset: CloudAsset): Promise<string>;
}
const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
const MAX_BASE64_LENGTH = 4 * Math.ceil(MAX_UPLOAD_BYTES / 3);
const MAX_REMOTE_SOURCE_BYTES = 20 * 1024 * 1024;
const uuid = /^[0-9a-f-]{36}$/i;

async function encodeJpeg(uri: string) {
  const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
  const context = ImageManipulator.manipulate(uri, { maxWidth: 2048, maxHeight: 2048 });
  let temporaryUri: string | undefined;
  try {
    const rendered = await context.renderAsync();
    try {
      const encoded = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
      temporaryUri = encoded.uri;
      if (!encoded.base64 || encoded.base64.length > MAX_BASE64_LENGTH) throw new Error('Ảnh vẫn quá lớn sau khi nén.');
      return { contentType: 'image/jpeg', dataBase64: encoded.base64 };
    } finally { rendered.release(); }
  } finally {
    context.release();
    if (temporaryUri && temporaryUri !== uri && temporaryUri.startsWith(`${Paths.cache.uri.replace(/\/$/, '')}/`)) {
      try { const temporary = new File(temporaryUri); if (temporary.exists) temporary.delete(); } catch {}
    }
  }
}

export const cloudAssetFiles: CloudAssetFiles = {
  async read(uri) {
    if (/^https:\/\//i.test(uri)) {
      const source = new URL(uri);
      if (source.username || source.password) throw new Error('Địa chỉ ảnh chưa hợp lệ.');
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30_000);
      const temporary = new File(Paths.cache, `pat-cloud-upload-${Date.now()}-${Math.random().toString(36).slice(2)}.part`);
      try {
        // Never forward a PAT bearer credential to a generated-image host.
        const response = await fetch(uri, { signal: controller.signal, redirect: 'error', credentials: 'omit' });
        const contentType = response.headers.get('content-type')?.split(';')[0].trim() ?? '';
        if (!response.ok || !/^image\/(jpeg|png|webp|heic|heif)$/.test(contentType) ||
            Number(response.headers.get('content-length')) > MAX_REMOTE_SOURCE_BYTES)
          throw new Error('Chưa tải được ảnh gốc để đồng bộ.');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.byteLength || bytes.byteLength > MAX_REMOTE_SOURCE_BYTES) throw new Error('Ảnh gốc quá lớn để đồng bộ.');
        await temporary.write(bytes);
        if (!extensions[contentType] || bytes.byteLength > MAX_UPLOAD_BYTES) return await encodeJpeg(temporary.uri);
        return { contentType, dataBase64: await temporary.base64() };
      } finally { clearTimeout(timer); try { if (temporary.exists) temporary.delete(); } catch {} }
    }
    if (!/^(file|content):\/\//i.test(uri)) throw new Error('Đường dẫn ảnh trên máy chưa hợp lệ.');
    const file = new File(uri);
    if (!file.exists || !file.size) throw new Error('Ảnh chưa có trên máy để đồng bộ.');
    const contentType = file.type || (/\.png$/i.test(uri) ? 'image/png' : /\.jpe?g$/i.test(uri) ? 'image/jpeg' : '');
    if (file.size > MAX_UPLOAD_BYTES || !extensions[contentType]) return encodeJpeg(uri);
    return { contentType, dataBase64: await file.base64() };
  },
  exists: uri => { try { return new File(uri).exists; } catch { return false; } },
  async write(userId, asset) {
    if (!uuid.test(userId) || !uuid.test(asset.assetId) || !extensions[asset.contentType]) throw new Error('Mã ảnh chưa hợp lệ.');
    const directory = new Directory(Paths.document, 'pat-cloud', userId.toLowerCase());
    directory.create({ intermediates: true, idempotent: true });
    const target = new File(directory, `${asset.assetId}.${extensions[asset.contentType]}`);
    if (target.exists && target.size > 0 && (asset.size === undefined || target.size === asset.size)) return target.uri;
    const temporary = new File(directory, `${asset.assetId}-${Date.now()}.part`);
    try {
      await temporary.write(asset.dataBase64, { encoding: 'base64' });
      if (!temporary.exists || !temporary.size || (asset.size !== undefined && temporary.size !== asset.size))
        throw new Error('Ảnh tải về chưa đầy đủ.');
      if (target.exists) target.delete();
      await temporary.move(target);
      return target.uri;
    } catch (cause) { try { if (temporary.exists) temporary.delete(); } catch {} throw cause; }
  },
};
