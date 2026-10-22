import { Directory, File, Paths } from 'expo-file-system';

const photoDirectory = new Directory(Paths.document, 'pat-check-ins');

// Pickers return temporary files. Keep a private copy only after confirmation.
export function persistCheckInPhoto(uri: string): string {
  photoDirectory.create({ idempotent: true, intermediates: true });
  const source = new File(uri);
  const extension = source.extension || '.jpg';
  const target = new File(photoDirectory, `${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`);
  source.copy(target);
  return target.uri;
}

export function deleteCheckInPhoto(uri: string): void {
  // Never delete the original library photo, a remote URL, or another app file.
  const prefix = `${photoDirectory.uri.replace(/\/$/, '')}/`;
  if (!uri.startsWith(prefix)) return;
  if (!/^\d+-[a-z0-9]+\.[a-z0-9]+$/i.test(uri.slice(prefix.length))) return;
  const file = new File(uri);
  if (file.exists) file.delete();
}
