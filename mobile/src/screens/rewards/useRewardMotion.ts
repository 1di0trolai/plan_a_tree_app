/** Xác định khi nào được chạy hiệu ứng thưởng dựa trên tùy chọn giảm chuyển động và trạng thái tiền cảnh. */

import { useEffect, useState } from "react";
import { AccessibilityInfo, AppState } from "react-native";

/** Default to calm until the OS preference is known; stop idle motion in background. */
export function useRewardMotion(enabled = true) {
  const [reduced, setReduced] = useState(true);
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    let mounted = true;
    let changed = false;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted && !changed) setReduced(value);
    }).catch(() => { /* Keep static on unavailable preferences. */ });
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => { changed = true; setReduced(value); });
    const app = AppState.addEventListener("change", (value) => setActive(value === "active"));
    return () => { mounted = false; motion.remove(); app.remove(); };
  }, []);
  return enabled && !reduced && active;
}
