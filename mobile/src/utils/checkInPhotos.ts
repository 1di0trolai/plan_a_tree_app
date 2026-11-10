/** Sao chép ảnh đã xác nhận vào vùng lưu riêng và quản lý danh sách, xóa ảnh; chờ các bản sao đang chạy trước khi đặt lại dữ liệu. */

import { Directory, File, Paths } from "expo-file-system";

const photoDirectory = new Directory(Paths.document, "pat-check-ins");
const pendingCopies = new Set<Promise<void>>();
let photoResetLocked = false;

// Pickers return temporary files. Keep a private copy only after confirmation.
export function persistCheckInPhoto(uri: string): Promise<string> {
  if (photoResetLocked)
    return Promise.reject(
      new Error("Đang đặt lại dữ liệu. Vui lòng chờ trước khi lưu ảnh mới."),
    );
  const operation = copyCheckInPhoto(uri);
  // Observe both outcomes without a rejecting .finally() chain. A reset drains
  // these fulfilled promises, including the failed copy's private-file cleanup.
  const settled = operation.then(
    () => { pendingCopies.delete(settled); },
    () => { pendingCopies.delete(settled); },
  );
  pendingCopies.add(settled);
  return operation;
}

async function copyCheckInPhoto(uri: string): Promise<string> {
  photoDirectory.create({ idempotent: true, intermediates: true });
  const source = new File(uri);
  const extension = source.extension || ".jpg";
  const target = new File(
    photoDirectory,
    `${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`,
  );
  try {
    await source.copy(target);
    if (!target.exists)
      throw new Error("Ảnh chưa được lưu đầy đủ trên thiết bị. Hãy thử lại.");
    return target.uri;
  } catch (error) {
    // A failed async copy may leave a partial private file. Never touch the original.
    try {
      deleteCheckInPhoto(target.uri);
    } catch {
      /* Preserve the copy error. */
    }
    throw error;
  }
}

// Stop new copies before waiting: a native copy must not finish after the reset
// has already snapshotted/deleted old photos. Never cancel native IO or sources.
export async function withCheckInPhotoReset<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (photoResetLocked)
    throw new Error("Đang đặt lại dữ liệu. Vui lòng chờ thao tác hiện tại.");
  photoResetLocked = true;
  try {
    await Promise.all([...pendingCopies]);
    return await operation();
  } finally {
    photoResetLocked = false;
  }
}

// Snapshot private copies before resetting state. Listing is read-only: callers
// persist a cleanup queue first, then delete each guarded URI independently.
export function listCheckInPhotoUris(): string[] {
  if (!photoDirectory.exists) return [];
  const prefix = `${photoDirectory.uri.replace(/\/$/, "")}/`;
  return photoDirectory
    .list()
    .filter((entry): entry is File => entry instanceof File && entry.exists)
    .map((file) => file.uri)
    .filter(
      (uri) =>
        uri.startsWith(prefix) &&
        /^\d+-[a-z0-9]+\.[a-z0-9]+$/i.test(uri.slice(prefix.length)),
    );
}

export function deleteCheckInPhoto(uri: string): void {
  // Never delete the original library photo, a remote URL, or another app file.
  const prefix = `${photoDirectory.uri.replace(/\/$/, "")}/`;
  if (!uri.startsWith(prefix)) return;
  if (!/^\d+-[a-z0-9]+\.[a-z0-9]+$/i.test(uri.slice(prefix.length))) return;
  const file = new File(uri);
  if (file.exists) file.delete();
}
