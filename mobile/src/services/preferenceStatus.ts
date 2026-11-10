/** Giữ và phát thay đổi trạng thái lỗi nhạc, lỗi lời nhắc cùng trạng thái tạm dừng tác vụ để giao diện theo dõi. */

export interface PreferenceRuntimeStatus { reminderError: string | null; musicError: string | null; effectsSuspended: boolean }
let snapshot: PreferenceRuntimeStatus = { reminderError: null, musicError: null, effectsSuspended: false };
const listeners = new Set<() => void>();

export const getPreferenceStatus = () => snapshot;
export function subscribePreferenceStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function setPreferenceError(kind: 'reminder' | 'music', message: string | null): void {
  const key = kind === 'reminder' ? 'reminderError' : 'musicError';
  if (snapshot[key] === message) return;
  snapshot = { ...snapshot, [key]: message };
  for (const listener of listeners) listener();
}

export function setPreferenceEffectsSuspended(suspended: boolean): void {
  if (snapshot.effectsSuspended === suspended) return;
  snapshot = { ...snapshot, effectsSuspended: suspended };
  for (const listener of listeners) listener();
}
