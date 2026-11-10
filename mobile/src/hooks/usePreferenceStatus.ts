/** Đăng ký theo dõi trạng thái nhạc và lời nhắc bên ngoài React để giao diện nhận cập nhật mà không tự thực hiện tác vụ hệ thống. */

import { useSyncExternalStore } from 'react';
import { getPreferenceStatus, subscribePreferenceStatus } from '../services/preferenceStatus';

export function usePreferenceStatus() {
  return useSyncExternalStore(subscribePreferenceStatus, getPreferenceStatus, getPreferenceStatus);
}
